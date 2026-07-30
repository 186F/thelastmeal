import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  behaviorFingerprintSetSchema,
  comparablePairing,
  type BehaviorFingerprintSet,
} from '../../../src/shared/behaviorArtifacts';
import { compareBehaviorFingerprintSets } from '../../../src/sim/evaluation/behaviorSimilarity';
import { canonicalSerialize } from '../../../src/sim/replay/serialize';
import { readSequenceState, type SequenceState } from './sequenceState';

/**
 * Cross-run evaluation (M2 brief §19.4): regenerated at any time from the
 * immutable per-attempt fingerprints — a derived report, never new
 * evidence. Every comparable pair (same scenario + seed, or the registered
 * B1/B2 ablation) among COMPLETED executions is compared with the Phase 2
 * similarity; non-comparable pairs are listed as skipped, not guessed at.
 */

export interface SequenceEvaluation {
  sequenceId: string;
  completedExecutions: string[];
  comparisons: Array<{
    left: string;
    right: string;
    pairing: string;
    maraCompositeBp: number;
  }>;
  skippedPairs: Array<{ left: string; right: string; reason: string }>;
}

export function evaluateSequence(sequenceRoot: string): SequenceEvaluation {
  const state = readSequenceState(sequenceRoot);
  if (!state) throw new Error(`sequence-state-missing: ${sequenceRoot}`);
  return evaluateFromState(sequenceRoot, state);
}

export function evaluateFromState(sequenceRoot: string, state: SequenceState): SequenceEvaluation {
  const fingerprints: Array<{ executionId: string; set: BehaviorFingerprintSet }> = [];
  for (const execution of state.executions) {
    if (execution.status !== 'completed') continue;
    const path = join(sequenceRoot, execution.dir, 'behavior-fingerprint.json');
    if (!existsSync(path)) continue;
    fingerprints.push({
      executionId: execution.executionId,
      set: behaviorFingerprintSetSchema.parse(JSON.parse(readFileSync(path, 'utf8'))),
    });
  }
  const comparisons: SequenceEvaluation['comparisons'] = [];
  const skippedPairs: SequenceEvaluation['skippedPairs'] = [];
  for (let i = 0; i < fingerprints.length; i += 1) {
    for (let j = i + 1; j < fingerprints.length; j += 1) {
      const left = fingerprints[i]!;
      const right = fingerprints[j]!;
      const pairing = comparablePairing(
        { scenarioId: left.set.scenarioId, seed: left.set.seed },
        { scenarioId: right.set.scenarioId, seed: right.set.seed },
      );
      if (pairing === null) {
        skippedPairs.push({
          left: left.executionId,
          right: right.executionId,
          reason: 'not-comparable (different scenario/seed and not the registered ablation pair)',
        });
        continue;
      }
      const comparison = compareBehaviorFingerprintSets(left.set, right.set);
      comparisons.push({
        left: left.executionId,
        right: right.executionId,
        pairing,
        maraCompositeBp: comparison.npcs.mara.compositeBp,
      });
    }
  }
  const evaluation: SequenceEvaluation = {
    sequenceId: state.sequenceId,
    completedExecutions: fingerprints.map((entry) => entry.executionId),
    comparisons,
    skippedPairs,
  };
  writeFileSync(
    join(sequenceRoot, 'sequence-evaluation.json'),
    canonicalSerialize(evaluation),
    'utf8',
  );
  return evaluation;
}
