import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enrichFingerprintSet, loadEvaluationEvidence } from '../../scripts/evaluation/evidence';
import { buildBehaviorFingerprints } from '../../src/sim/evaluation/behaviorFingerprint';
import {
  rehearseGatewayStopCase,
  rehearseNormalCase,
  type RehearsalRunReport,
} from '../../scripts/model/rehearse';
import { aggregateSha256, sha256OfFile } from '../../scripts/model/summarize';
import { MODEL_CONDITION_ID } from '../../src/shared/modelExperiment';
import { NPC_IDS } from '../../src/shared/ids';

/**
 * Strict-finalized run-directory evidence enrichment (Phase 2 re-audit
 * blocker 2, §5.5): genuine keyless finalized fixtures — produced by the
 * REAL rehearsal pipeline, never synthetic insertion — prove that a
 * finalized run enriches condition and upstream-call evidence, that a
 * gateway-stop run preserves the emitted-versus-called distinction, that a
 * bare ledger stays honestly not-observable, and that contradictory,
 * tampered, or incomplete directories are refused.
 */

const SUITE_TIMEOUT = 60_000;

let outDir: string;
let normalReport: RehearsalRunReport;
let stopReport: RehearsalRunReport;
let normalDir: string;
let stopDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'evaluation-evidence-'));
  normalReport = await rehearseNormalCase(outDir, 'evidence-normal-0001');
  stopReport = await rehearseGatewayStopCase(outDir, 'evidence-stop-00001');
  normalDir = join(outDir, 'normal', 'evidence-normal-0001');
  stopDir = join(outDir, 'gateway-stop', 'evidence-stop-00001');
}, SUITE_TIMEOUT);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

/** Copies a finalized run directory so a test can tamper with its own copy. */
function copyOf(sourceDir: string, label: string): string {
  const dir = join(outDir, `tampered-${label}`);
  cpSync(sourceDir, dir, { recursive: true });
  return dir;
}

/** Reseals bundle-manifest.json over the CURRENT directory bytes, the way a
 * determined forger would, so integrity passes and the semantic cross-checks
 * are what must catch the tamper. */
function resealBundle(dir: string): void {
  const bundlePath = join(dir, 'bundle-manifest.json');
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as {
    files: { name: string; sha256: string }[];
    aggregateSha256: string;
  };
  const walk = (rel: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) out.push(...walk(relPath));
      else if (relPath !== 'bundle-manifest.json') out.push(relPath);
    }
    return out;
  };
  bundle.files = walk('')
    .sort()
    .map((name) => ({ name, sha256: sha256OfFile(join(dir, name))! }));
  bundle.aggregateSha256 = aggregateSha256(bundle.files);
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');
}

describe('strict-finalized run enrichment', () => {
  it('a normal finalized run proves its registered condition and upstream call counts', () => {
    const evidence = loadEvaluationEvidence(normalDir);
    expect(evidence.kind).toBe('strict-finalized-run');
    if (evidence.kind !== 'strict-finalized-run') return;
    expect(evidence.enrichment.registeredConditionId).toBe(MODEL_CONDITION_ID);
    const set = enrichFingerprintSet(buildBehaviorFingerprints(evidence.file), evidence.enrichment);
    expect(set.registeredConditionId).toBe(MODEL_CONDITION_ID);
    const mara = set.npcs.mara;
    expect(mara.registeredConditionId).toBe(MODEL_CONDITION_ID);
    expect(mara.externalActionRequestsEmitted).toBe(normalReport.externalRequestsEmitted);
    expect(mara.upstreamActionCallsAttempted).toBe(normalReport.upstreamCallsAttempted);
    // The normal rehearsal answers every dispatched call.
    expect(mara.upstreamActionCallsCompleted).toBe(normalReport.upstreamCallsAttempted);
    for (const npcId of ['jonas', 'rin'] as const) {
      expect(set.npcs[npcId].upstreamActionCallsAttempted).toBe(0);
      expect(set.npcs[npcId].upstreamActionCallsCompleted).toBe(0);
    }
    // No compilation lifecycle exists yet: those counts stay not-observable.
    for (const npcId of NPC_IDS) {
      expect(set.npcs[npcId].upstreamPolicyCompilationCallsAttempted).toBe('not-observable');
      expect(set.npcs[npcId].upstreamPolicyCompilationCallsCompleted).toBe('not-observable');
    }
  });

  it('a gateway-stop finalized run preserves the emitted-versus-called distinction', () => {
    const evidence = loadEvaluationEvidence(stopDir);
    expect(evidence.kind).toBe('strict-finalized-run');
    if (evidence.kind !== 'strict-finalized-run') return;
    const set = enrichFingerprintSet(buildBehaviorFingerprints(evidence.file), evidence.enrichment);
    const mara = set.npcs.mara;
    expect(mara.externalActionRequestsEmitted).toBe(stopReport.externalRequestsEmitted);
    expect(mara.upstreamActionCallsAttempted).toBe(stopReport.upstreamCallsAttempted);
    // The Run 6 shape: the engine kept emitting after the gateway stopped,
    // so emitted requests strictly exceed attempted upstream calls.
    expect(mara.externalActionRequestsEmitted).toBeGreaterThan(
      mara.upstreamActionCallsAttempted as number,
    );
    expect(mara.upstreamActionCallsCompleted as number).toBeLessThanOrEqual(
      mara.upstreamActionCallsAttempted as number,
    );
  });

  it('a bare ledger file stays honestly not-observable', () => {
    const ledgerName = readdirSync(normalDir).find(
      (name) => name.startsWith('ledger-') && name.endsWith('.json'),
    )!;
    const evidence = loadEvaluationEvidence(join(normalDir, ledgerName));
    expect(evidence.kind).toBe('bare-ledger');
    const set = buildBehaviorFingerprints(evidence.file);
    expect(set.registeredConditionId).toBe('not-observable');
    expect(set.npcs.mara.upstreamActionCallsAttempted).toBe('not-observable');
    expect(set.npcs.mara.upstreamActionCallsCompleted).toBe('not-observable');
  });
});

describe('contradictory, tampered, and incomplete directories are refused', () => {
  it('an unresealed tamper fails bundle integrity', () => {
    const dir = copyOf(normalDir, 'integrity');
    const manifestPath = join(dir, 'run-manifest.final.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.conditionId = 'forged-condition-v1';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    expect(() => loadEvaluationEvidence(dir)).toThrow('run-directory-bundle-mismatch');
  });

  it('a resealed manifest/ledger condition conflict fails the cross-checks', () => {
    const dir = copyOf(normalDir, 'condition');
    const manifestPath = join(dir, 'run-manifest.final.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.conditionId = 'forged-condition-v1';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    resealBundle(dir);
    expect(() => loadEvaluationEvidence(dir)).toThrow('run-evidence-conflict');
  });

  it('a resealed trace count inconsistent with the manifest fails', () => {
    const dir = copyOf(normalDir, 'trace-count');
    const tracePath = join(dir, 'finalized-trace.jsonl');
    const rows = readFileSync(tracePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const kept = rows.filter((line, index) => {
      if (index !== rows.length - 1) return true;
      return !(JSON.parse(line) as { gatewayOutcome: string | null }).gatewayOutcome;
    });
    expect(kept.length).toBeLessThan(rows.length); // the last row carried gateway evidence
    writeFileSync(tracePath, `${kept.join('\n')}\n`, 'utf8');
    resealBundle(dir);
    expect(() => loadEvaluationEvidence(dir)).toThrow('run-evidence-conflict');
  });

  it('a directory missing its final manifest is not finalized evidence', () => {
    const dir = copyOf(normalDir, 'incomplete');
    unlinkSync(join(dir, 'run-manifest.final.json'));
    resealBundle(dir);
    expect(() => loadEvaluationEvidence(dir)).toThrow('run-directory-not-finalized');
  });

  it('a degraded finalization cannot masquerade as strict evidence', () => {
    const dir = copyOf(normalDir, 'degraded');
    const manifestPath = join(dir, 'run-manifest.final.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.status = 'degraded';
    manifest.failedCriteria = ['induced-for-test'];
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    resealBundle(dir);
    expect(() => loadEvaluationEvidence(dir)).toThrow('run-directory-not-strict-finalized');
  });
});
