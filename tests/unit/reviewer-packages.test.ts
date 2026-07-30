import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildReviewerPackage,
  scoreReviews,
  type ReviewerScoreRow,
} from '../../scripts/evaluation/reviewerPackages';
import { exportedFile } from '../ledgerCorruption';
import { NPC_IDS, type NpcId } from '../../src/shared/ids';

/**
 * Blinded reviewer packages for validated live ledgers (M2 brief §10.12,
 * R6 ruling): the reviewer document must leak no identity, scenario,
 * condition, or seed information; the answer key alone resolves labels and
 * carries fingerprints; scores import separately under the strict schema
 * (Phase 2 audit §7.1) and remain diagnostic.
 */

function writeLedgerFixtures(): { dir: string; paths: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'reviewer-packages-'));
  const paths: string[] = [];
  for (const scenario of ['A', 'C'] as const) {
    const path = join(dir, `ledger-${scenario}.json`);
    writeFileSync(path, JSON.stringify(exportedFile(scenario)), 'utf8');
    paths.push(path);
  }
  return { dir, paths };
}

describe('buildReviewerPackage', () => {
  const { paths } = writeLedgerFixtures();
  const { reviewer, answerKey } = buildReviewerPackage(paths, 'package-test01');

  it('produces one blinded run per input with opaque labels', () => {
    expect(reviewer.runs.length).toBe(2);
    expect(reviewer.runs.map((r) => r.runLabel)).toEqual(['run-01', 'run-02']);
    for (const run of reviewer.runs) {
      expect(run.traces.mode).toBe('behavior-only');
      expect(run.traces.traces.length).toBe(3);
      for (const trace of run.traces.traces) {
        expect(trace.actorLabel).toMatch(/^agent-[ABC]$/);
      }
    }
  });

  it('leaks no NPC names, scenario ids, seeds, plans, or condition ids to reviewers', () => {
    const text = JSON.stringify(reviewer);
    for (const npcId of NPC_IDS) expect(text).not.toContain(`"${npcId}"`);
    expect(text).not.toContain('deterministic-utility-v1');
    // JSON keys, not prose substrings (the reviewer note legitimately names
    // the categories of information that are absent).
    expect(text).not.toContain('"scenarioId"');
    expect(text).not.toContain('"seed"');
    expect(text).not.toContain('"canonicalLedgerHash"');
    expect(text).not.toContain('"providerPlanId"');
    expect(text).not.toContain('"registeredConditionId"');
  });

  it('the answer key alone resolves everything and separates plan from condition provenance', () => {
    expect(answerKey.runs.length).toBe(2);
    for (const run of answerKey.runs) {
      expect(run.providerPlanId).toBe('deterministic-utility-v1');
      // Ledger-only evidence proves the provider plan, never a registered
      // condition (Phase 2 audit finding 4).
      expect(run.registeredConditionId).toBe('not-observable');
      expect(['A', 'C']).toContain(run.scenarioId);
      expect(run.fingerprints.fingerprintVersion).toBe('behavior-fingerprint-1.0.0');
      const labels = Object.values(run.labelByNpc).sort();
      expect(labels).toEqual(['agent-A', 'agent-B', 'agent-C']);
    }
  });
});

describe('scoreReviews (strict §7.1 contract)', () => {
  const { paths } = writeLedgerFixtures();
  const { answerKey } = buildReviewerPackage(paths, 'package-test02');

  function completeScoresFor(reviewerId: string): ReviewerScoreRow[] {
    return answerKey.runs.flatMap((run) =>
      NPC_IDS.map((npcId) => ({
        reviewerId,
        runLabel: run.runLabel,
        actorLabel: run.labelByNpc[npcId],
        guessedNpcId: npcId,
      })),
    );
  }

  it('scores perfect identification at 10_000bp with full completion coverage', () => {
    const report = scoreReviews(answerKey, completeScoresFor('reviewer-1'));
    expect(report.reviewerCount).toBe(1);
    expect(report.expectedJudgmentsPerReviewer).toBe(6);
    expect(report.receivedJudgments).toBe(6);
    expect(report.completionCoverageBp).toBe(10_000);
    expect(report.pooledIdentificationRateBp).toBe(10_000);
    expect(report.perReviewer['reviewer-1']!.accuracyBp).toBe(10_000);
    expect(report.chanceBaselineBp).toBe(3_333);
    expect(report.note).toContain('Diagnostic only');
  });

  it('reports per-reviewer accuracy and declares partial submissions via coverage', () => {
    const perfect = completeScoresFor('reviewer-1');
    const wrongGuess: Record<NpcId, NpcId> = { mara: 'jonas', jonas: 'rin', rin: 'mara' };
    const run = answerKey.runs[0]!;
    // reviewer-2 submits only one run's judgments, all wrong: partial + 0%.
    const partialWrong: ReviewerScoreRow[] = NPC_IDS.map((npcId) => ({
      reviewerId: 'reviewer-2',
      runLabel: run.runLabel,
      actorLabel: run.labelByNpc[npcId],
      guessedNpcId: wrongGuess[npcId],
    }));
    const report = scoreReviews(answerKey, [...perfect, ...partialWrong]);
    expect(report.reviewerCount).toBe(2);
    expect(report.receivedJudgments).toBe(9);
    expect(report.completionCoverageBp).toBe(7_500); // 9 of 12 expected
    expect(report.perReviewer['reviewer-1']!.accuracyBp).toBe(10_000);
    expect(report.perReviewer['reviewer-2']!.accuracyBp).toBe(0);
    expect(report.pooledIdentificationRateBp).toBe(6_667); // 6 of 9
  });

  it('rejects duplicate judgments for the same (reviewer, run, actor)', () => {
    const scores = completeScoresFor('reviewer-1');
    expect(() => scoreReviews(answerKey, [...scores, scores[0]!])).toThrow(
      'score-duplicate-judgment',
    );
    // Repeating a correct row can no longer inflate the aggregate rate.
  });

  it('rejects rows missing a reviewer identity or carrying unknown fields', () => {
    const valid = completeScoresFor('reviewer-1')[0]!;
    const missingReviewer = { ...valid } as Record<string, unknown>;
    delete missingReviewer.reviewerId;
    expect(() => scoreReviews(answerKey, [missingReviewer])).toThrow();
    expect(() => scoreReviews(answerKey, [{ ...valid, extraField: 'x' }])).toThrow();
    expect(() => scoreReviews(answerKey, [{ ...valid, guessedNpcId: 'nobody' }])).toThrow();
    expect(() => scoreReviews(answerKey, 'not-an-array')).toThrow();
  });

  it('rejects unknown run and actor labels with typed errors', () => {
    expect(() =>
      scoreReviews(answerKey, [
        { reviewerId: 'r', runLabel: 'run-99', actorLabel: 'agent-A', guessedNpcId: 'mara' },
      ]),
    ).toThrow('score-unknown-run-label');
    expect(() =>
      scoreReviews(answerKey, [
        {
          reviewerId: 'r',
          runLabel: answerKey.runs[0]!.runLabel,
          actorLabel: 'agent-Z',
          guessedNpcId: 'mara',
        },
      ]),
    ).toThrow('score-unknown-actor-label');
  });
});
