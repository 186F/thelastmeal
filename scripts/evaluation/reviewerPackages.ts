import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { NPC_IDS, type NpcId } from '../../src/shared/ids';
import { readOption, readOptions } from '../cli/args';
import type { BehaviorOnlyTraceExport } from '../../src/shared/traces';
import { SCENARIOS } from '../../src/sim/scenarios/definitions';
import { buildBehaviorOnlyTraces } from '../../src/sim/traces';
import { buildBehaviorFingerprints } from '../../src/sim/evaluation/behaviorFingerprint';
import { behaviorFingerprintSetSchema, notObservable } from '../../src/shared/behaviorArtifacts';
import { cryptoShuffle, makeBlinding, token } from './blinding';
import { enrichFingerprintSet, loadEvaluationEvidence } from './evidence';

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

/**
 * Strict runtime schemas for the reviewer package and answer key (re-audit
 * §7.3): both documents are validated on WRITE by the builder and the answer
 * key is validated again on READ by the scorer — never cast. The reviewer
 * schema deliberately has no field that could carry scenario, seed,
 * condition, plan, hash, or NPC identity.
 */
const opaqueLabel = z.string().min(1);

export const reviewerPackageSchema = z
  .object({
    formatVersion: z.literal(1),
    packageId: opaqueLabel,
    note: z.string().min(1),
    runs: z
      .array(
        z
          .object({
            runLabel: opaqueLabel,
            // The behavior-only trace export is validated in depth by its
            // producer (buildBehaviorOnlyTraces); here it is shape-guarded
            // while keeping its full static type.
            traces: z.custom<BehaviorOnlyTraceExport>(
              (value) =>
                typeof value === 'object' &&
                value !== null &&
                (value as { mode?: unknown }).mode === 'behavior-only' &&
                Array.isArray((value as { traces?: unknown }).traces),
            ),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const answerKeyRunSchema = z
  .object({
    runLabel: opaqueLabel,
    sourcePath: z.string().min(1),
    scenarioId: z.string().min(1),
    seed: z.number().int(),
    /** The ledger-proven provider plan (audit finding 4): never a condition. */
    providerPlanId: z.string().min(1),
    /** Manifest-proven registered condition for strict-finalized run
     * evidence; `not-observable` for bare-ledger inputs. */
    registeredConditionId: z.union([z.string().min(1), notObservable]),
    canonicalLedgerHash: z.string().regex(/^[0-9a-f]{16}$/),
    labelByNpc: z.object({ mara: opaqueLabel, jonas: opaqueLabel, rin: opaqueLabel }).strict(),
    fingerprints: behaviorFingerprintSetSchema,
  })
  .strict();

export const answerKeySchema = z
  .object({
    formatVersion: z.literal(1),
    packageId: opaqueLabel,
    runs: z.array(answerKeyRunSchema).min(1),
  })
  .strict();

type ReviewerPackage = z.infer<typeof reviewerPackageSchema>;
type AnswerKey = z.infer<typeof answerKeySchema>;

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
    // Strict-finalized run directories prove their registered condition
    // (re-audit blocker 2), which lands ONLY in the answer key — the blinded
    // reviewer document never carries it.
    const evidence = loadEvaluationEvidence(inputPath);
    const scenario = SCENARIOS[evidence.file.scenario.id];
    const blinding = makeBlinding();
    const traces = buildBehaviorOnlyTraces(scenario, evidence.file.events, blinding);
    const ledgerOnly = buildBehaviorFingerprints(evidence.file);
    const fingerprints =
      evidence.kind === 'strict-finalized-run'
        ? enrichFingerprintSet(ledgerOnly, evidence.enrichment)
        : ledgerOnly;
    return { evidence, blinding, traces, fingerprints };
  });
  const shuffled = cryptoShuffle(prepared);
  const reviewerRuns: ReviewerPackage['runs'] = [];
  const answerRuns: AnswerKey['runs'] = [];
  shuffled.forEach((entry, index) => {
    const runLabel = `run-${String(index + 1).padStart(2, '0')}`;
    reviewerRuns.push({ runLabel, traces: entry.traces });
    answerRuns.push({
      runLabel,
      sourcePath: entry.evidence.ledgerPath,
      scenarioId: entry.evidence.file.scenario.id,
      seed: entry.evidence.file.scenario.seed,
      providerPlanId: entry.evidence.file.providerId,
      registeredConditionId:
        entry.evidence.kind === 'strict-finalized-run'
          ? entry.evidence.enrichment.registeredConditionId
          : 'not-observable',
      canonicalLedgerHash: entry.evidence.file.canonicalLedgerHash,
      labelByNpc: entry.blinding.labelByNpc,
      fingerprints: entry.fingerprints,
    });
  });
  return {
    reviewer: reviewerPackageSchema.parse({
      formatVersion: 1,
      packageId,
      note: REVIEWER_NOTE,
      runs: reviewerRuns,
    }),
    answerKey: answerKeySchema.parse({ formatVersion: 1, packageId, runs: answerRuns }),
  };
}

/**
 * Strict reviewer-score contract (Phase 2 audit §7.1). Every row carries a
 * reviewer identity; a reviewer may submit at most one guess per
 * (runLabel, actorLabel); unknown labels are typed errors. Partial response
 * sets ARE legal — a reviewer may decline judgments — and the report
 * declares that by exposing expected-versus-received completion coverage.
 */
export const reviewerScoreRowSchema = z
  .object({
    reviewerId: z.string().min(1),
    runLabel: z.string().min(1),
    actorLabel: z.string().min(1),
    guessedNpcId: z.enum(NPC_IDS),
  })
  .strict();
export const reviewerScoreFileSchema = z.array(reviewerScoreRowSchema);
export type ReviewerScoreRow = z.infer<typeof reviewerScoreRowSchema>;

const bpInt = z.number().int().min(0).max(10_000);
export const scoreReportSchema = z
  .object({
    packageId: opaqueLabel,
    reviewerCount: z.number().int().nonnegative(),
    /** Judgments a complete submission contains: runs × actors per run. */
    expectedJudgmentsPerReviewer: z.number().int().nonnegative(),
    receivedJudgments: z.number().int().nonnegative(),
    /** received / (reviewerCount × expectedJudgmentsPerReviewer), basis points. */
    completionCoverageBp: bpInt,
    correctGuesses: z.number().int().nonnegative(),
    pooledIdentificationRateBp: bpInt,
    chanceBaselineBp: bpInt,
    perReviewer: z.record(
      z.string(),
      z
        .object({
          judgments: z.number().int().nonnegative(),
          correct: z.number().int().nonnegative(),
          accuracyBp: bpInt,
        })
        .strict(),
    ),
    perNpc: z
      .object({
        mara: z.object({ guesses: z.number().int(), correct: z.number().int() }).strict(),
        jonas: z.object({ guesses: z.number().int(), correct: z.number().int() }).strict(),
        rin: z.object({ guesses: z.number().int(), correct: z.number().int() }).strict(),
      })
      .strict(),
    note: z.string().min(1),
  })
  .strict();

export type ScoreReport = z.infer<typeof scoreReportSchema>;

export function scoreReviews(answerKey: AnswerKey, scoresInput: unknown): ScoreReport {
  const scores = reviewerScoreFileSchema.parse(scoresInput);
  const perNpc = {} as ScoreReport['perNpc'];
  for (const npcId of NPC_IDS) perNpc[npcId] = { guesses: 0, correct: 0 };
  const perReviewer: ScoreReport['perReviewer'] = {};
  const seenJudgments = new Set<string>();
  let correct = 0;
  for (const score of scores) {
    const judgmentKey = JSON.stringify([score.reviewerId, score.runLabel, score.actorLabel]);
    if (seenJudgments.has(judgmentKey)) {
      throw new Error(
        `score-duplicate-judgment:${score.reviewerId}:${score.runLabel}:${score.actorLabel}`,
      );
    }
    seenJudgments.add(judgmentKey);
    const run = answerKey.runs.find((r) => r.runLabel === score.runLabel);
    if (!run) throw new Error(`score-unknown-run-label:${score.runLabel}`);
    const actualNpc = (Object.keys(run.labelByNpc) as NpcId[]).find(
      (npcId) => run.labelByNpc[npcId] === score.actorLabel,
    );
    if (!actualNpc) throw new Error(`score-unknown-actor-label:${score.actorLabel}`);
    const reviewer = (perReviewer[score.reviewerId] ??= {
      judgments: 0,
      correct: 0,
      accuracyBp: 0,
    });
    reviewer.judgments += 1;
    perNpc[actualNpc].guesses += 1;
    if (score.guessedNpcId === actualNpc) {
      perNpc[actualNpc].correct += 1;
      reviewer.correct += 1;
      correct += 1;
    }
  }
  for (const reviewer of Object.values(perReviewer)) {
    reviewer.accuracyBp =
      reviewer.judgments === 0 ? 0 : Math.round((reviewer.correct * 10_000) / reviewer.judgments);
  }
  const reviewerCount = Object.keys(perReviewer).length;
  const expectedJudgmentsPerReviewer = answerKey.runs.length * NPC_IDS.length;
  const expectedTotal = reviewerCount * expectedJudgmentsPerReviewer;
  const received = scores.length;
  return {
    packageId: answerKey.packageId,
    reviewerCount,
    expectedJudgmentsPerReviewer,
    receivedJudgments: received,
    completionCoverageBp: expectedTotal === 0 ? 0 : Math.round((received * 10_000) / expectedTotal),
    correctGuesses: correct,
    pooledIdentificationRateBp: received === 0 ? 0 : Math.round((correct * 10_000) / received),
    chanceBaselineBp: 3_333,
    perReviewer,
    perNpc,
    note:
      'Diagnostic only (M2 brief §10.12): no pass threshold without a separately ' +
      'pre-registered human-review study. Partial submissions are legal and are ' +
      'declared via completion coverage.',
  };
}

export function runReviewerPackageCli(argv: readonly string[]): number {
  const inputs = readOptions(argv, 'input');
  const outDir = readOption(argv, 'out');
  const packageId = readOption(argv, 'package-id') ?? `package-${token(6)}`;
  if (inputs.length === 0 || !outDir) {
    console.error(
      'usage: eval:reviewer-package -- --input <ledger|run-dir> [--input ...] --out <dir> [--package-id <id>]',
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
  const answersPath = readOption(argv, 'answers');
  const scoresPath = readOption(argv, 'scores');
  if (!answersPath || !scoresPath) {
    console.error(
      'usage: eval:score-reviews -- --answers <answer-key.json> --scores <scores.json>',
    );
    return 1;
  }
  // Both inputs are schema-validated on read — never cast (re-audit §7.3):
  // the answer key against its strict schema here, the score rows inside
  // scoreReviews. The produced report is parsed once more as a self-check.
  const answerKey = answerKeySchema.parse(JSON.parse(readFileSync(answersPath, 'utf8')));
  const report = scoreReportSchema.parse(
    scoreReviews(answerKey, JSON.parse(readFileSync(scoresPath, 'utf8'))),
  );
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
