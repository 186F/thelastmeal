import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateLedgerFile } from '../../../src/sim/replay/validateLedger';
import { buildBehaviorFingerprints } from '../../../src/sim/evaluation/behaviorFingerprint';
import { prepareRunDirectory } from '../../model/prepareRun';
import { finalizeRunDirectory, type FinalizeResult } from '../../model/finalize';
import { enrichFingerprintSet, loadEvaluationEvidence } from '../../evaluation/evidence';
import { canonicalSerialize } from '../../../src/sim/replay/serialize';
import type { BehaviorFingerprintSet } from '../../../src/shared/behaviorArtifacts';

/**
 * Per-attempt evidence pipeline (M2 brief §19.4): after the browser phase,
 * the orchestrator validates and finalizes the attempt's evidence and
 * recomputes its behavior fingerprint — reusing the frozen Milestone 1
 * pipeline (prepareRunDirectory → strict finalizeRunDirectory) and the
 * Phase 2 evidence layer verbatim.
 *
 * Deterministic (gateway-off) attempts have no run directory by design:
 * their evidence is the exported canonical ledger, fully validated, plus a
 * bare-ledger fingerprint.
 */

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

/** Validates a deterministic attempt's exported ledger and writes its
 * bare-ledger fingerprint next to it. */
export function finalizeDeterministicAttempt(
  attemptDir: string,
  ledgerPath: string,
): DeterministicAttemptEvidence {
  const validation = validateLedgerFile(readFileSync(ledgerPath, 'utf8'));
  if (!validation.ok || !validation.file) {
    const first = validation.issues
      .filter((issue) => issue.severity === 'error')
      .slice(0, 3)
      .map((issue) => issue.code)
      .join('; ');
    throw new Error(`deterministic-ledger-invalid: ${first}`);
  }
  const fingerprints = buildBehaviorFingerprints(validation.file);
  const fingerprintPath = join(attemptDir, 'behavior-fingerprint.json');
  writeFileSync(fingerprintPath, canonicalSerialize(fingerprints), 'utf8');
  return { kind: 'deterministic', ledgerPath, fingerprintPath, fingerprints };
}

/**
 * Model attempt: stage the browser-downloaded ledger + bundle into the
 * gateway's run directory, strict-finalize it, then load it back through
 * the Phase 2 strict-finalized evidence layer (bundle integrity, exact
 * trace-to-ledger join) and write the ENRICHED fingerprint.
 */
export function finalizeModelAttempt(args: {
  attemptDir: string;
  traceDir: string;
  runId: string;
  ledgerPath: string;
  bundlePath: string;
}): ModelAttemptEvidence {
  const runDir = join(args.traceDir, args.runId);
  if (!existsSync(runDir)) {
    throw new Error(`gateway-run-directory-missing: ${runDir}`);
  }
  prepareRunDirectory({
    runId: args.runId,
    ledgerPath: args.ledgerPath,
    bundlePath: args.bundlePath,
    destRoot: args.traceDir,
  });
  const finalize = finalizeRunDirectory(runDir, args.runId);
  const evidence = loadEvaluationEvidence(runDir);
  if (evidence.kind !== 'strict-finalized-run') {
    throw new Error(`finalized-run-not-recognized: ${runDir}`);
  }
  const fingerprints = enrichFingerprintSet(
    buildBehaviorFingerprints(evidence.file),
    evidence.enrichment,
  );
  const fingerprintPath = join(args.attemptDir, 'behavior-fingerprint.json');
  writeFileSync(fingerprintPath, canonicalSerialize(fingerprints), 'utf8');
  // Preserve a copy of the finalized bundle manifest beside the attempt for
  // quick inspection; the run directory remains the authoritative evidence.
  copyFileSync(
    join(runDir, 'bundle-manifest.json'),
    join(args.attemptDir, 'bundle-manifest.copy.json'),
  );
  return {
    kind: 'model',
    runId: args.runId,
    runDir,
    finalize,
    fingerprintPath,
    fingerprints,
  };
}
