import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateLedgerFile } from '../../../src/sim/replay/validateLedger';
import { buildBehaviorFingerprints } from '../../../src/sim/evaluation/behaviorFingerprint';
import { prepareRunDirectory } from '../../model/prepareRun';
import { finalizeRunDirectory, type FinalizeResult } from '../../model/finalize';
import { enrichFingerprintSet, loadEvaluationEvidence } from '../../evaluation/evidence';
import { canonicalSerialize } from '../../../src/sim/replay/serialize';
import { requireContractForCondition } from '../../../src/shared/conditionContract';
import type { BehaviorFingerprintSet } from '../../../src/shared/behaviorArtifacts';
import type { ExpectedTreatment } from './planSchema';
import { AttemptFailure } from './failureTaxonomy';

/**
 * Per-attempt evidence pipeline (M2 brief §19.4; re-audit finding §12):
 * after the browser phase, the orchestrator validates and finalizes the
 * attempt's evidence and recomputes its behavior fingerprint — reusing the
 * frozen Milestone 1 pipeline (prepareRunDirectory → strict
 * finalizeRunDirectory) and the Phase 2 evidence layer verbatim.
 *
 * Every stage is TYPED: a throw inside a stage becomes a closed-taxonomy
 * `<stage>-failed` class carrying the stage name, so a post-browser
 * failure is never a generic 'error'. The stage implementations are
 * injectable for failure drills — production callers use the frozen
 * defaults.
 *
 * Deterministic (gateway-off) attempts have no run directory by design:
 * their evidence is the exported canonical ledger, fully validated, plus a
 * bare-ledger fingerprint.
 */

export type FinalizationStage =
  | 'deterministic-validation'
  | 'prepare-run'
  | 'strict-finalize'
  | 'evidence-enrichment'
  | 'fingerprint'
  | 'final-treatment-verification'
  | 'execution-seal';

/** Wraps a stage so any non-AttemptFailure throw becomes the stage's typed
 * hard-stop class (re-audit §12). AttemptFailures (e.g. a treatment
 * mismatch inside the final cross-check) pass through unchanged. */
export function guardStage<T>(stage: FinalizationStage, fn: () => T): T {
  try {
    return fn();
  } catch (error: unknown) {
    if (error instanceof AttemptFailure) throw error;
    const message = error instanceof Error ? error.message : String(error);
    // The template union `${FinalizationStage}-failed` is checked against
    // the closed taxonomy at compile time — a new stage without a
    // registered class fails typecheck.
    const reason: `${FinalizationStage}-failed` = `${stage}-failed`;
    throw new AttemptFailure(reason, message, stage);
  }
}

export interface DeterministicAttemptEvidence {
  kind: 'deterministic';
  ledgerPath: string;
  fingerprintPath: string;
  fingerprints: BehaviorFingerprintSet;
}

export interface ModelAttemptEvidence {
  kind: 'model';
  runId: string;
  runDir: string;
  finalize: FinalizeResult;
  fingerprintPath: string;
  fingerprints: BehaviorFingerprintSet;
}

export interface DeterministicFinalizeDeps {
  validateLedgerFile: typeof validateLedgerFile;
  buildBehaviorFingerprints: typeof buildBehaviorFingerprints;
}

const DETERMINISTIC_DEPS: DeterministicFinalizeDeps = {
  validateLedgerFile,
  buildBehaviorFingerprints,
};

/** Validates a deterministic attempt's exported ledger and writes its
 * bare-ledger fingerprint next to it. */
export function finalizeDeterministicAttempt(
  attemptDir: string,
  ledgerPath: string,
  deps: DeterministicFinalizeDeps = DETERMINISTIC_DEPS,
): DeterministicAttemptEvidence {
  const file = guardStage('deterministic-validation', () => {
    const validation = deps.validateLedgerFile(readFileSync(ledgerPath, 'utf8'));
    if (!validation.ok || !validation.file) {
      const first = validation.issues
        .filter((issue) => issue.severity === 'error')
        .slice(0, 3)
        .map((issue) => issue.code)
        .join('; ');
      throw new Error(`deterministic-ledger-invalid: ${first}`);
    }
    return validation.file;
  });
  return guardStage('fingerprint', () => {
    const fingerprints = deps.buildBehaviorFingerprints(file);
    const fingerprintPath = join(attemptDir, 'behavior-fingerprint.json');
    writeFileSync(fingerprintPath, canonicalSerialize(fingerprints), 'utf8');
    return { kind: 'deterministic' as const, ledgerPath, fingerprintPath, fingerprints };
  });
}

export interface ModelFinalizeDeps {
  prepareRunDirectory: typeof prepareRunDirectory;
  finalizeRunDirectory: typeof finalizeRunDirectory;
  loadEvaluationEvidence: typeof loadEvaluationEvidence;
  enrichFingerprintSet: typeof enrichFingerprintSet;
  buildBehaviorFingerprints: typeof buildBehaviorFingerprints;
}

const MODEL_DEPS: ModelFinalizeDeps = {
  prepareRunDirectory,
  finalizeRunDirectory,
  loadEvaluationEvidence,
  enrichFingerprintSet,
  buildBehaviorFingerprints,
};

/**
 * Model attempt: stage the browser-downloaded ledger + bundle into the
 * gateway's run directory, strict-finalize it, then load it back through
 * the Phase 2 strict-finalized evidence layer (bundle integrity, exact
 * trace-to-ledger join) and write the ENRICHED fingerprint. Each stage is
 * typed (re-audit §12).
 */
export function finalizeModelAttempt(
  args: {
    attemptDir: string;
    traceDir: string;
    runId: string;
    ledgerPath: string;
    bundlePath: string;
  },
  deps: ModelFinalizeDeps = MODEL_DEPS,
): ModelAttemptEvidence {
  const runDir = join(args.traceDir, args.runId);
  guardStage('prepare-run', () => {
    if (!existsSync(runDir)) {
      throw new Error(`gateway-run-directory-missing: ${runDir}`);
    }
    deps.prepareRunDirectory({
      runId: args.runId,
      ledgerPath: args.ledgerPath,
      bundlePath: args.bundlePath,
      destRoot: args.traceDir,
    });
  });
  const finalize = guardStage('strict-finalize', () =>
    deps.finalizeRunDirectory(runDir, args.runId),
  );
  const evidence = guardStage('evidence-enrichment', () => {
    const loaded = deps.loadEvaluationEvidence(runDir);
    if (loaded.kind !== 'strict-finalized-run') {
      throw new Error(`finalized-run-not-recognized: ${runDir}`);
    }
    return loaded;
  });
  return guardStage('fingerprint', () => {
    const fingerprints = deps.enrichFingerprintSet(
      deps.buildBehaviorFingerprints(evidence.file),
      evidence.enrichment,
    );
    const fingerprintPath = join(args.attemptDir, 'behavior-fingerprint.json');
    writeFileSync(fingerprintPath, canonicalSerialize(fingerprints), 'utf8');
    // Preserve a copy of the finalized bundle manifest beside the attempt
    // for quick inspection; the run directory remains the authoritative
    // evidence.
    copyFileSync(
      join(runDir, 'bundle-manifest.json'),
      join(args.attemptDir, 'bundle-manifest.copy.json'),
    );
    return {
      kind: 'model' as const,
      runId: args.runId,
      runDir,
      finalize,
      fingerprintPath,
      fingerprints,
    };
  });
}

/** Budget-exhausted upstream calls recorded in the finalized manifest
 * (§23.1 per-run integrity gate; Phase 4 adversarial-review fix): the
 * strict finalizer already aggregates gateway failure categories, so the
 * gate needs no new plumbing — just an honest read. */
export function readBudgetExhaustedCalls(runDir: string): number {
  const manifest = JSON.parse(readFileSync(join(runDir, 'run-manifest.final.json'), 'utf8')) as {
    callsFailedByCategory?: Record<string, number>;
  };
  return manifest.callsFailedByCategory?.['budget-exhausted'] ?? 0;
}

/** Post-finalization manifest cross-check (audit finding 2). The frozen
 * finalizer seeds `requestedModelId` from configuration per adapter kind:
 * the model SLUG for openrouter, the adapter id (`fake-decision-adapter-v1`)
 * for the fake kind — while the public config advertises `fake-adapter` for
 * fake mode. The cross-check honors those frozen semantics. Shared by the
 * attempt pipeline and by resume-time semantic revalidation (re-audit
 * finding 5). */
export function verifyFinalManifestTreatment(
  runDir: string,
  expected: ExpectedTreatment | undefined,
  gatewayMode: 'fake' | 'live',
): void {
  if (!expected) return;
  guardStage('final-treatment-verification', () => {
    const manifest = JSON.parse(
      readFileSync(join(runDir, 'run-manifest.final.json'), 'utf8'),
    ) as Record<string, unknown>;
    const expectedManifestModel =
      gatewayMode === 'fake' ? 'fake-decision-adapter-v1' : expected.modelId;
    // The expected provider derives from the reviewed treatment's condition
    // via the registered contract (Phase 4 adversarial-review fix): the plan
    // schema already pins expected.conditionId/experimentId/experimentVersion/
    // promptVersion to the plan's registered contract, so this stays a check
    // against a REVIEWED identity, never a self-declared one — and it is
    // strictly stronger than the old M1-only constant, which failed every
    // M2 attempt at the final stage.
    const contract = requireContractForCondition(expected.conditionId);
    const checks: Array<[string, unknown, unknown]> = [
      ['requestedModelId', manifest.requestedModelId, expectedManifestModel],
      ['conditionId', manifest.conditionId, contract.conditionId],
      ['promptVersion', manifest.promptVersion, contract.promptVersion],
      ['externalProviderId', manifest.externalProviderId, contract.providerId],
      ['experimentId', manifest.experimentId, contract.experimentId],
      ['experimentVersion', manifest.experimentVersion, contract.experimentVersion],
    ];
    for (const [field, actual, wanted] of checks) {
      if (actual !== wanted) {
        throw new AttemptFailure(
          'treatment-mismatch',
          `final manifest ${field} is '${String(actual)}', reviewed plan requires '${String(wanted)}'`,
          'final-treatment-verification',
        );
      }
    }
  });
}
