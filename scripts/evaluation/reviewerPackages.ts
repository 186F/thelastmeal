import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NPC_IDS, type NpcId } from '../../src/shared/ids';
import type { BehaviorOnlyTraceExport } from '../../src/shared/traces';
import { SCENARIOS } from '../../src/sim/scenarios/definitions';
import { buildBehaviorOnlyTraces } from '../../src/sim/traces';
import { buildBehaviorFingerprints } from '../../src/sim/evaluation/behaviorFingerprint';
import type { BehaviorFingerprintSet } from '../../src/shared/behaviorArtifacts';
import { cryptoShuffle, makeBlinding, token } from './blinding';
import { loadValidatedLedger } from './behaviorIo';

/**
 * Blinded reviewer packages for VALIDATED LIVE LEDGERS (M2 brief §10.12,
 * per the Advisor's R6 ruling — non-gating laboratory infrastructure).
 *
 * `npm run eval:reviewer-package -- --input=<ledger|run-dir> [--input=...] --out=<dir>`
 *
 * Produces:
 *   <out>/reviewer/<packageId>.json   — blinded behavior-only traces, run and
 *                                       actor labels opaque, condition labels
 *                                       hidden, run order shuffled
 *   <out>/answer-key/<packageId>.json — the ONLY place holding label→NPC,
 *                                       run→source/condition mappings, and the
 *                                       versioned behavior fingerprints
 *
 * `npm run eval:score-reviews -- --answers=<key> --scores=<file>`
 *
 * Scores are a separately imported JSON array of
 * `{ runLabel, actorLabel, guessedNpcId }`; the scorer reports identification
 * rate against the 1/3 chance baseline. Diagnostic only: per the R6 ruling,
 * no pass threshold exists without a separately pre-registered human-review
 * study, and the unbalanced Milestone 1 archives must not be used to make
 * model-discrimination claims.
 */

interface ReviewerRun {
  runLabel: string;
  traces: BehaviorOnlyTraceExport;
}

interface ReviewerPackage {
  formatVersion: 1;
  packageId: string;
  note: string;
  runs: ReviewerRun[];
}

interface AnswerKeyRun {
  runLabel: string;
  sourcePath: string;
  scenarioId: string;
  seed: number;
  conditionId: string;
  canonicalLedgerHash: string;
  labelByNpc: Record<NpcId, string>;
  fingerprints: BehaviorFingerprintSet;
}

interface AnswerKey {
  formatVersion: 1;
  packageId: string;
  runs: AnswerKeyRun[];
}

const REVIEWER_NOTE =
  'Blinded behavior-only traces from validated live ledgers. Run labels, actor ' +
  'labels, and run order are opaque and independently shuffled per run; no ' +
  'scenario, seed, condition, model, or identity information is present. ' +
  'Diagnostic instrumentation only (M2 brief §10.12) — identification rates ' +
  'carry no pass threshold without a separately pre-registered human study.';

export function buildReviewerPackage(
  inputPaths: readonly string[],
  packageId: string,
): { reviewer: ReviewerPackage; answerKey: AnswerKey } {
  if (inputPaths.length === 0) throw new Error('reviewer-package-needs-inputs');
  const prepared = inputPaths.map((inputPath) => {
    const loaded = loadValidatedLedger(inputPath);
    const scenario = SCENARIOS[loaded.file.scenario.id];
    const blinding = makeBlinding();
    const traces = buildBehaviorOnlyTraces(scenario, loaded.file.events, blinding);
    const fingerprints = buildBehaviorFingerprints(loaded.file);
    return { loaded, blinding, traces, fingerprints };
  });
  const shuffled = cryptoShuffle(prepared);
  const reviewerRuns: ReviewerRun[] = [];
  const answerRuns: AnswerKeyRun[] = [];
  shuffled.forEach((entry, index) => {
    const runLabel = `run-${String(index + 1).padStart(2, '0')}`;
    reviewerRuns.push({ runLabel, traces: entry.traces });
    answerRuns.push({
      runLabel,
      sourcePath: entry.loaded.ledgerPath,
      scenarioId: entry.loaded.file.scenario.id,
      seed: entry.loaded.file.scenario.seed,
      conditionId: entry.loaded.file.providerId,
      canonicalLedgerHash: entry.loaded.file.canonicalLedgerHash,
      labelByNpc: entry.blinding.labelByNpc,
      fingerprints: entry.fingerprints,
    });
  });
  return {
    reviewer: { formatVersion: 1, packageId, note: REVIEWER_NOTE, runs: reviewerRuns },
    answerKey: { formatVersion: 1, packageId, runs: answerRuns },
  };
}

export interface ReviewerScoreRow {
  runLabel: string;
  actorLabel: string;
  guessedNpcId: NpcId;
}

export interface ScoreReport {
  packageId: string;
  totalGuesses: number;
  correctGuesses: number;
  identificationRateBp: number;
  chanceBaselineBp: number;
  perNpc: Record<NpcId, { guesses: number; correct: number }>;
  note: string;
}

export function scoreReviews(
  answerKey: AnswerKey,
  scores: readonly ReviewerScoreRow[],
): ScoreReport {
  const perNpc = {} as ScoreReport['perNpc'];
  for (const npcId of NPC_IDS) perNpc[npcId] = { guesses: 0, correct: 0 };
  let correct = 0;
  for (const score of scores) {
    const run = answerKey.runs.find((r) => r.runLabel === score.runLabel);
    if (!run) throw new Error(`score-unknown-run-label:${score.runLabel}`);
    const actualNpc = (Object.keys(run.labelByNpc) as NpcId[]).find(
      (npcId) => run.labelByNpc[npcId] === score.actorLabel,
    );
    if (!actualNpc) throw new Error(`score-unknown-actor-label:${score.actorLabel}`);
    perNpc[actualNpc].guesses += 1;
    if (score.guessedNpcId === actualNpc) {
      perNpc[actualNpc].correct += 1;
      correct += 1;
    }
  }
  const total = scores.length;
  return {
    packageId: answerKey.packageId,
    totalGuesses: total,
    correctGuesses: correct,
    identificationRateBp: total === 0 ? 0 : Math.round((correct * 10_000) / total),
    chanceBaselineBp: 3_333,
    perNpc,
    note:
      'Diagnostic only (M2 brief §10.12): no pass threshold without a separately ' +
      'pre-registered human-review study.',
  };
}

export function runReviewerPackageCli(argv: readonly string[]): number {
  const inputs = argv
    .filter((a) => a.startsWith('--input='))
    .map((a) => a.slice('--input='.length));
  const outDir = argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);
  const packageId =
    argv.find((a) => a.startsWith('--package-id='))?.slice('--package-id='.length) ??
    `package-${token(6)}`;
  if (inputs.length === 0 || !outDir) {
    console.error(
      'usage: eval:reviewer-package -- --input=<ledger|run-dir> [--input=...] --out=<dir> [--package-id=<id>]',
    );
    return 1;
  }
  const { reviewer, answerKey } = buildReviewerPackage(inputs, packageId);
  const reviewerDir = join(outDir, 'reviewer');
  const answerDir = join(outDir, 'answer-key');
  mkdirSync(reviewerDir, { recursive: true });
  mkdirSync(answerDir, { recursive: true });
  writeFileSync(
    join(reviewerDir, `${packageId}.json`),
    `${JSON.stringify(reviewer, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(answerDir, `${packageId}.json`),
    `${JSON.stringify(answerKey, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `eval:reviewer-package — ${packageId}: ${reviewer.runs.length} blinded run(s) in ${reviewerDir}; ` +
      `answer key in ${answerDir} (KEEP SEPARATE from reviewer materials)`,
  );
  return 0;
}

export function runScoreCli(argv: readonly string[]): number {
  const answersPath = argv.find((a) => a.startsWith('--answers='))?.slice('--answers='.length);
  const scoresPath = argv.find((a) => a.startsWith('--scores='))?.slice('--scores='.length);
  if (!answersPath || !scoresPath) {
    console.error(
      'usage: eval:score-reviews -- --answers=<answer-key.json> --scores=<scores.json>',
    );
    return 1;
  }
  const answerKey = JSON.parse(readFileSync(answersPath, 'utf8')) as AnswerKey;
  const scores = JSON.parse(readFileSync(scoresPath, 'utf8')) as ReviewerScoreRow[];
  const report = scoreReviews(answerKey, scores);
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const argv = process.argv.slice(2);
    process.exitCode = argv.includes('--score-mode')
      ? runScoreCli(argv)
      : runReviewerPackageCli(argv);
  } catch (error: unknown) {
    console.error(
      `eval:reviewer-package failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
