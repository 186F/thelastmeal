import { describe, expect, it } from 'vitest';
import type { ScenarioId } from '../../src/shared/ids';
import { completedRun } from '../helpers';

/**
 * Golden pin on the hash projections (adversarial-review fix).
 *
 * These are the published remediation-1.1.0 baselines from
 * documentation/AUDIT_REMEDIATION_REPORT.md. Any change to the world-state
 * projection, the canonical event-stream projection, the serializer, the
 * event vocabulary, or engine behavior fails HERE first — hash semantics can
 * never drift silently. Updating these values is a documented re-baselining
 * act under change control (new remediation/report entry), never a casual
 * test edit.
 */
const GOLDEN: Record<ScenarioId, { world: string; ledger: string }> = {
  A: { world: '8bf6de492261aa78', ledger: '2b37e828af8d8b30' },
  B1: { world: '7e06428489f9020f', ledger: '7db80afdf2565999' },
  B2: { world: '19f9352327928f64', ledger: '7e7bfb303b11655f' },
  C: { world: 'dc9e39d03bbdf240', ledger: 'a155bf545ed70250' },
  D: { world: 'f1837eb45f154f26', ledger: 'ce705feae7451f0a' },
  E: { world: '72c9d8d32e575df8', ledger: '0da42ae4ea8cf2f0' },
  F: { world: '099557a99bde1fb4', ledger: '36daff45eae4fcd3' },
};

describe('golden baseline hashes (remediation release 1.1.0)', () => {
  for (const [scenarioId, expected] of Object.entries(GOLDEN) as [
    ScenarioId,
    { world: string; ledger: string },
  ][]) {
    it(`scenario ${scenarioId} reproduces the published worldStateHash and canonicalLedgerHash`, () => {
      const run = completedRun(scenarioId);
      expect(run.worldStateHash).toBe(expected.world);
      expect(run.canonicalLedgerHash).toBe(expected.ledger);
    });
  }
});
