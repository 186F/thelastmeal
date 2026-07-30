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
 * carries fingerprints; scores import separately and remain diagnostic.
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

  it('leaks no NPC names, scenario ids, seeds, or condition ids to reviewers', () => {
    const text = JSON.stringify(reviewer);
    for (const npcId of NPC_IDS) expect(text).not.toContain(`"${npcId}"`);
    expect(text).not.toContain('deterministic-utility-v1');
    // JSON keys, not prose substrings (the reviewer note legitimately names
    // the categories of information that are absent).
    expect(text).not.toContain('"scenarioId"');
    expect(text).not.toContain('"seed"');
    expect(text).not.toContain('"canonicalLedgerHash"');
    expect(text).not.toContain('"conditionId"');
  });

  it('the answer key alone resolves everything and carries versioned fingerprints', () => {
    expect(answerKey.runs.length).toBe(2);
    for (const run of answerKey.runs) {
      expect(run.conditionId).toBe('deterministic-utility-v1');
      expect(['A', 'C']).toContain(run.scenarioId);
      expect(run.fingerprints.fingerprintVersion).toBe('behavior-fingerprint-1.0.0');
      const labels = Object.values(run.labelByNpc).sort();
      expect(labels).toEqual(['agent-A', 'agent-B', 'agent-C']);
    }
  });
});

describe('scoreReviews', () => {
  const { paths } = writeLedgerFixtures();
  const { answerKey } = buildReviewerPackage(paths, 'package-test02');

  it('scores perfect identification at 10_000bp against the 3_333bp chance baseline', () => {
    const scores: ReviewerScoreRow[] = [];
    for (const run of answerKey.runs) {
      for (const npcId of NPC_IDS) {
        scores.push({
          runLabel: run.runLabel,
          actorLabel: run.labelByNpc[npcId],
          guessedNpcId: npcId,
        });
      }
    }
    const report = scoreReviews(answerKey, scores);
    expect(report.totalGuesses).toBe(6);
    expect(report.identificationRateBp).toBe(10_000);
    expect(report.chanceBaselineBp).toBe(3_333);
    expect(report.note).toContain('Diagnostic only');
  });

  it('scores systematically wrong guesses at 0 and rejects unknown labels', () => {
    const wrongGuess: Record<NpcId, NpcId> = { mara: 'jonas', jonas: 'rin', rin: 'mara' };
    const scores: ReviewerScoreRow[] = answerKey.runs.flatMap((run) =>
      NPC_IDS.map((npcId) => ({
        runLabel: run.runLabel,
        actorLabel: run.labelByNpc[npcId],
        guessedNpcId: wrongGuess[npcId],
      })),
    );
    expect(scoreReviews(answerKey, scores).identificationRateBp).toBe(0);
    expect(() =>
      scoreReviews(answerKey, [
        { runLabel: 'run-99', actorLabel: 'agent-A', guessedNpcId: 'mara' },
      ]),
    ).toThrow('score-unknown-run-label');
  });
});
