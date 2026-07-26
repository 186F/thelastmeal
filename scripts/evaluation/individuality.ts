import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { SCENARIO_IDS, NPC_IDS, type NpcId, type ScenarioId } from '../../src/shared/ids';
import type { BlindingAnswerKey, BlindingMap } from '../../src/shared/traces';
import { buildBehaviorOnlyTraces } from '../../src/sim/traces';
import {
  INDIVIDUALITY_EVAL_VERSION,
  roleBalance,
  runRoleCounterbalancedEval,
} from '../../src/sim/evaluation/individuality';

/**
 * Individuality-evaluation package generator (remediation 7).
 *
 * Runs the role-counterbalanced eval harness (all six identity-role
 * permutations per scenario), then blinds each run with CRYPTOGRAPHIC
 * randomness — never the public scenario seed — and writes:
 *
 *   artifacts/individuality-eval/reviewer/<session>.json   (behavior-only)
 *   artifacts/individuality-eval/answer-key.json           (--answer-key only)
 *
 * The reviewer package contains opaque session and actor labels only; the
 * label->NPC mapping and the session->scenario/roles mapping exist solely in
 * the answer key, which is written only when explicitly requested. Blinding
 * randomness is presentation/evaluation metadata: it never touches
 * simulation state or hashes, and these runs never enter the v1.0 report.
 *
 * Usage:
 *   npm run eval:individuality -- [--scenarios=A,C,D] [--answer-key]
 */

function token(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function cryptoShuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    // Rejection sampling for an unbiased index from crypto bytes.
    let j = 0;
    for (;;) {
      const byte = randomBytes(1)[0]!;
      const limit = 256 - (256 % (i + 1));
      if (byte < limit) {
        j = byte % (i + 1);
        break;
      }
    }
    const swap = out[i]!;
    out[i] = out[j]!;
    out[j] = swap;
  }
  return out;
}

function makeBlinding(): BlindingMap {
  const labels = cryptoShuffle(['agent-A', 'agent-B', 'agent-C']);
  const labelByNpc = {} as Record<NpcId, string>;
  NPC_IDS.forEach((npcId, index) => {
    labelByNpc[npcId] = labels[index]!;
  });
  return { sessionLabel: `session-${token(6)}`, labelByNpc };
}

function main(): void {
  const args = process.argv.slice(2);
  const scenarioArg = args.find((a) => a.startsWith('--scenarios='));
  const withAnswerKey = args.includes('--answer-key');
  const scenarioIds = (
    scenarioArg
      ? scenarioArg
          .slice('--scenarios='.length)
          .split(',')
          .map((s) => s.trim())
      : [...SCENARIO_IDS]
  ) as ScenarioId[];
  for (const id of scenarioIds) {
    if (!(SCENARIO_IDS as readonly string[]).includes(id)) {
      console.error(`Unknown scenario: ${id}`);
      process.exit(1);
    }
  }

  const outRoot = path.resolve('artifacts', 'individuality-eval');
  const reviewerDir = path.join(outRoot, 'reviewer');
  mkdirSync(reviewerDir, { recursive: true });

  console.log(`Running role-counterbalanced eval (${INDIVIDUALITY_EVAL_VERSION})...`);
  const results = runRoleCounterbalancedEval(scenarioIds);
  const answerKeys: BlindingAnswerKey[] = [];

  for (const result of results) {
    const blinding = makeBlinding();
    const packageJson = buildBehaviorOnlyTraces(result.scenario, result.events, blinding);
    writeFileSync(
      path.join(reviewerDir, `${blinding.sessionLabel}.json`),
      JSON.stringify(packageJson, null, 2),
      'utf8',
    );
    answerKeys.push({
      sessionLabel: blinding.sessionLabel,
      scenarioId: result.baseScenarioId,
      seed: result.scenario.seed,
      evalVersion: result.evalVersion,
      labelByNpc: blinding.labelByNpc,
    });
  }

  if (withAnswerKey) {
    writeFileSync(
      path.join(outRoot, 'answer-key.json'),
      JSON.stringify(
        answerKeys.map((k, i) => ({ ...k, roles: results[i]!.roles })),
        null,
        2,
      ),
      'utf8',
    );
    console.log(`Answer key written (KEEP SEPARATE from reviewer packages).`);
  } else {
    console.log('Answer key NOT written (pass --answer-key to export it separately).');
  }

  const balance = roleBalance();
  console.log(`Reviewer packages: ${results.length} sessions in ${reviewerDir}`);
  console.log('Role balance per scenario (identity x role counts):');
  for (const npcId of NPC_IDS) {
    const b = balance[npcId];
    console.log(
      `  ${npcId}: benchWorker=${b.benchWorker} debtor=${b.debtor} mealOwner=${b.mealOwner}`,
    );
  }
}

main();
