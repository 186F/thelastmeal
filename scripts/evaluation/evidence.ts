import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import { NPC_IDS, type NpcId } from '../../src/shared/ids';
import {
  behaviorFingerprintSetSchema,
  type BehaviorFingerprintSet,
} from '../../src/shared/behaviorArtifacts';
import { classifyProviderId } from '../../src/shared/providerTaxonomy';
import {
  bundleManifestSchema,
  finalManifestSchema,
  finalizedTraceEntrySchema,
  type FinalManifest,
  type FinalizedTraceEntry,
} from '../../src/shared/modelArtifacts';
import { aggregateSha256, sha256OfFile } from '../model/summarize';

/**
 * Evaluation evidence loading (Phase 2 re-audit blocker 2).
 *
 * Two evidence grades, never blurred:
 *
 *  - `bare-ledger` (a ledger FILE path): the ledger proves canonical facts
 *    only. `registeredConditionId` and upstream call counts stay
 *    `not-observable`.
 *  - `strict-finalized-run` (a DIRECTORY path): the complete strict
 *    finalization artifact set is required, schema-validated, integrity-bound
 *    by `bundle-manifest.json`, and cross-checked for identity agreement.
 *    The manifest then proves the registered condition and the gateway
 *    evidence proves upstream ACTION call counts. Contradictory, degraded,
 *    or incomplete directories are refused — they never silently degrade to
 *    bare-ledger semantics.
 *
 * Policy-compilation call counts remain `not-observable` in both grades: no
 * compilation lifecycle or artifact schema exists yet (M2 Phase 5).
 *
 * The pure simulation evaluator (`buildBehaviorFingerprints`) never parses
 * filesystem artifacts; enrichment is a validated overlay applied here.
 */

export interface RunEvidenceEnrichment {
  runId: string;
  registeredConditionId: string;
  externalActionProviderId: string;
  upstreamActionCallsAttemptedByNpc: Record<NpcId, number>;
  upstreamActionCallsCompletedByNpc: Record<NpcId, number>;
  upstreamActionCallsAttemptedTotal: number;
  upstreamActionCallsCompletedTotal: number;
}

export type EvaluationEvidence =
  | { kind: 'bare-ledger'; sourcePath: string; ledgerPath: string; file: LedgerFile }
  | {
      kind: 'strict-finalized-run';
      sourcePath: string;
      ledgerPath: string;
      file: LedgerFile;
      enrichment: RunEvidenceEnrichment;
    };

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`);
}

function walkFiles(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkFiles(root, relPath));
    else out.push(relPath);
  }
  return out;
}

function validateLedgerAt(ledgerPath: string): LedgerFile {
  const validation = validateLedgerFile(readFileSync(ledgerPath, 'utf8'));
  if (!validation.ok || !validation.file) {
    const firstErrors = validation.issues
      .filter((issue) => issue.severity === 'error')
      .slice(0, 5)
      .map((issue) => `${issue.code} (${issue.where ?? 'unknown'})`)
      .join('; ');
    fail('ledger-validation-failed', `${ledgerPath}: ${firstErrors}`);
  }
  return validation.file;
}

/** Verifies the whole-directory evidence binding: every file the bundle
 * manifest names must exist with the exact recorded bytes, no covered file
 * may be missing, no uncovered file may have been added, and the aggregate
 * must recompute. */
function verifyBundleIntegrity(dir: string): { runId: string; status: string | null } {
  const bundleManifestPath = join(dir, 'bundle-manifest.json');
  if (!existsSync(bundleManifestPath)) {
    fail('run-directory-not-finalized', `${dir} has no bundle-manifest.json`);
  }
  const bundle = bundleManifestSchema.parse(JSON.parse(readFileSync(bundleManifestPath, 'utf8')));
  if (bundle.producer !== 'model:finalize') {
    fail('run-directory-not-finalized', `${dir} bundle manifest producer is '${bundle.producer}'`);
  }
  const onDisk = walkFiles(dir)
    .filter((name) => name !== 'bundle-manifest.json')
    .sort();
  const covered = bundle.files.map((f) => f.name).sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(covered)) {
    fail(
      'run-directory-bundle-mismatch',
      `${dir}: on-disk files do not match the bundle manifest (covered ${covered.length}, on disk ${onDisk.length})`,
    );
  }
  for (const entry of bundle.files) {
    const actual = sha256OfFile(join(dir, entry.name));
    if (actual !== entry.sha256) {
      fail(
        'run-directory-bundle-mismatch',
        `${dir}/${entry.name} sha256 does not match the bundle manifest`,
      );
    }
  }
  if (aggregateSha256(bundle.files) !== bundle.aggregateSha256) {
    fail('run-directory-bundle-mismatch', `${dir}: aggregate sha256 does not recompute`);
  }
  return { runId: bundle.runId, status: bundle.status };
}

function loadFinalManifest(dir: string): FinalManifest {
  const manifestPath = join(dir, 'run-manifest.final.json');
  if (!existsSync(manifestPath)) {
    fail('run-directory-not-finalized', `${dir} has no run-manifest.final.json`);
  }
  return finalManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
}

function loadFinalizedTrace(dir: string): FinalizedTraceEntry[] {
  const tracePath = join(dir, 'finalized-trace.jsonl');
  if (!existsSync(tracePath)) {
    fail('run-directory-not-finalized', `${dir} has no finalized-trace.jsonl`);
  }
  return readFileSync(tracePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => finalizedTraceEntrySchema.parse(JSON.parse(line)));
}

function findSingleLedger(dir: string): string {
  const candidates = readdirSync(dir).filter(
    (name) => name.startsWith('ledger-') && name.endsWith('.json'),
  );
  if (candidates.length !== 1) {
    fail('run-directory-needs-exactly-one-ledger', `found ${candidates.length} in ${dir}`);
  }
  return join(dir, candidates[0]!);
}

/** Ledger-derived count of decision requests addressed to the external
 * action authority, per the provider-source taxonomy — the same quantity the
 * fingerprint reports as `externalActionRequestsEmitted`. */
function countExternalActionRequests(file: LedgerFile): number {
  let count = 0;
  for (const event of file.events) {
    if (event.type !== 'DecisionRequested') continue;
    const providerId = (event.payload as { providerId: string }).providerId;
    if (classifyProviderId(providerId) === 'external-action-request') count += 1;
  }
  return count;
}

function loadStrictFinalizedRun(dir: string): EvaluationEvidence {
  const bundle = verifyBundleIntegrity(dir);
  if (bundle.status !== 'completed') {
    fail(
      'run-directory-not-strict-finalized',
      `${dir}: bundle status is '${String(bundle.status)}' (strict evidence requires 'completed')`,
    );
  }
  const manifest = loadFinalManifest(dir);
  if (manifest.status !== 'completed' || manifest.failedCriteria.length > 0) {
    fail(
      'run-directory-not-strict-finalized',
      `${dir}: final manifest status '${manifest.status}' with ${manifest.failedCriteria.length} failed criteria`,
    );
  }
  const ledgerPath = findSingleLedger(dir);
  const file = validateLedgerAt(ledgerPath);
  const trace = loadFinalizedTrace(dir);

  // Identity agreement: ledger, final manifest, bundle manifest, and every
  // finalized trace row must describe ONE run (re-audit §5.4 step 3).
  if (manifest.runId !== bundle.runId) {
    fail(
      'run-evidence-conflict',
      `${dir}: manifest runId ${manifest.runId} != bundle runId ${bundle.runId}`,
    );
  }
  if (manifest.scenarioId !== file.scenario.id || manifest.seed !== file.scenario.seed) {
    fail(
      'run-evidence-conflict',
      `${dir}: manifest scenario/seed ${manifest.scenarioId}/${manifest.seed} != ledger ${file.scenario.id}/${file.scenario.seed}`,
    );
  }
  if (
    manifest.worldStateHash !== file.worldStateHash ||
    manifest.canonicalLedgerHash !== file.canonicalLedgerHash
  ) {
    fail('run-evidence-conflict', `${dir}: manifest hashes do not match the validated ledger`);
  }
  if (manifest.providerPlanId !== file.providerId) {
    fail(
      'run-evidence-conflict',
      `${dir}: manifest providerPlanId ${manifest.providerPlanId} != ledger providerId ${file.providerId}`,
    );
  }
  if (classifyProviderId(manifest.externalProviderId) !== 'external-action-request') {
    fail(
      'run-evidence-conflict',
      `${dir}: externalProviderId ${manifest.externalProviderId} is not a registered external action authority`,
    );
  }
  for (const row of trace) {
    if (row.runId !== manifest.runId) {
      fail('run-evidence-conflict', `${dir}: trace row ${row.requestId} runId != manifest runId`);
    }
    if (row.conditionId !== manifest.conditionId) {
      fail(
        'run-evidence-conflict',
        `${dir}: trace row ${row.requestId} conditionId ${row.conditionId} != manifest ${manifest.conditionId}`,
      );
    }
    if (row.providerId !== manifest.externalProviderId) {
      fail(
        'run-evidence-conflict',
        `${dir}: trace row ${row.requestId} providerId ${row.providerId} != manifest external provider`,
      );
    }
    if (row.scenarioId !== manifest.scenarioId) {
      fail('run-evidence-conflict', `${dir}: trace row ${row.requestId} scenarioId != manifest`);
    }
  }

  // Count agreement. The ledger's external-action request count must equal
  // the manifest's engine-emitted count, and the gateway evidence in the
  // finalized trace must reproduce the manifest's attempted/completed
  // upstream call counts exactly (an emitted request is NOT a call — this is
  // the Run 6 distinction the evidence model exists to keep).
  const emittedFromLedger = countExternalActionRequests(file);
  if (emittedFromLedger !== manifest.externalRequestsEmitted) {
    fail(
      'run-evidence-conflict',
      `${dir}: ledger emits ${emittedFromLedger} external action requests; manifest records ${manifest.externalRequestsEmitted}`,
    );
  }
  const attemptedByNpc = {} as Record<NpcId, number>;
  const completedByNpc = {} as Record<NpcId, number>;
  for (const npcId of NPC_IDS) {
    attemptedByNpc[npcId] = 0;
    completedByNpc[npcId] = 0;
  }
  let attemptedTotal = 0;
  let completedTotal = 0;
  for (const row of trace) {
    // Mirrors computeInfraMetrics: budget failures never reached the
    // upstream adapter; every other gateway outcome was an attempted call,
    // and 'response' outcomes completed.
    if (row.gatewayOutcome === null) continue;
    if (row.gatewayOutcome !== 'budget-exhausted') {
      attemptedByNpc[row.npcId] += 1;
      attemptedTotal += 1;
    }
    if (row.gatewayOutcome === 'response') {
      completedByNpc[row.npcId] += 1;
      completedTotal += 1;
    }
  }
  if (
    attemptedTotal !== manifest.upstreamCallsAttempted ||
    completedTotal !== manifest.callsCompleted
  ) {
    fail(
      'run-evidence-conflict',
      `${dir}: finalized trace shows ${attemptedTotal} attempted / ${completedTotal} completed upstream calls; ` +
        `manifest records ${manifest.upstreamCallsAttempted} / ${manifest.callsCompleted}`,
    );
  }

  return {
    kind: 'strict-finalized-run',
    sourcePath: dir,
    ledgerPath,
    file,
    enrichment: {
      runId: manifest.runId,
      registeredConditionId: manifest.conditionId,
      externalActionProviderId: manifest.externalProviderId,
      upstreamActionCallsAttemptedByNpc: attemptedByNpc,
      upstreamActionCallsCompletedByNpc: completedByNpc,
      upstreamActionCallsAttemptedTotal: attemptedTotal,
      upstreamActionCallsCompletedTotal: completedTotal,
    },
  };
}

/**
 * Loads evaluation evidence. A FILE path is a bare validated ledger; a
 * DIRECTORY path must be a strict-finalized run directory and is refused —
 * never quietly downgraded — when its artifact set is incomplete, degraded,
 * tampered, or self-contradictory.
 */
export function loadEvaluationEvidence(inputPath: string): EvaluationEvidence {
  if (!existsSync(inputPath)) fail('input-not-found', inputPath);
  if (!statSync(inputPath).isDirectory()) {
    const file = validateLedgerAt(inputPath);
    return { kind: 'bare-ledger', sourcePath: inputPath, ledgerPath: inputPath, file };
  }
  return loadStrictFinalizedRun(inputPath);
}

/**
 * Applies a strict-finalized run's proven provenance to a ledger-derived
 * fingerprint set: the manifest-proven registered condition and the
 * trace-proven upstream ACTION call counts. With complete gateway evidence,
 * an NPC with no trace rows provably made zero upstream calls — an exact 0,
 * not `not-observable`. Policy-compilation counts stay `not-observable`.
 * The enriched set is re-validated against the strict schema.
 */
export function enrichFingerprintSet(
  set: BehaviorFingerprintSet,
  enrichment: RunEvidenceEnrichment,
): BehaviorFingerprintSet {
  const enriched: BehaviorFingerprintSet = {
    ...set,
    registeredConditionId: enrichment.registeredConditionId,
    npcs: Object.fromEntries(
      NPC_IDS.map((npcId) => [
        npcId,
        {
          ...set.npcs[npcId],
          registeredConditionId: enrichment.registeredConditionId,
          upstreamActionCallsAttempted: enrichment.upstreamActionCallsAttemptedByNpc[npcId],
          upstreamActionCallsCompleted: enrichment.upstreamActionCallsCompletedByNpc[npcId],
        },
      ]),
    ) as BehaviorFingerprintSet['npcs'],
  };
  return behaviorFingerprintSetSchema.parse(enriched);
}
