import { describe, expect, it } from 'vitest';
import { applyEvent } from '../../src/sim/events/reduce';
import { completedRun, eventsOfType, firstEventOfType, freshState, mkEvent } from '../helpers';

const TERMS = { startTick: 900, graceTick: 1020, minDurationTicks: 300 };

function createCommitment(state: ReturnType<typeof freshState>): void {
  applyEvent(
    state,
    mkEvent('CommitmentCreated', 0, {
      commitmentId: 'cmt-jonas-relieves-mara',
      kind: 'relieve-at-bench',
      debtorId: 'jonas',
      creditorId: 'mara',
      terms: TERMS,
    }),
  );
}

describe('commitment lifecycle (reducer level)', () => {
  it('creates an active commitment with original terms preserved', () => {
    const state = freshState('A');
    createCommitment(state);
    const c = state.commitments[0]!;
    expect(c.status).toBe('active');
    expect(c.terms).toEqual(TERMS);
    expect(c.originalTerms).toEqual(TERMS);
    expect(c.renegotiated).toBe(false);
  });

  it('renegotiation: proposal then independent acceptance changes terms', () => {
    const state = freshState('A');
    createCommitment(state);
    const newTerms = { startTick: 1140, graceTick: 1260, minDurationTicks: 300 };
    applyEvent(
      state,
      mkEvent('CommitmentRenegotiationProposed', 750, {
        commitmentId: 'cmt-jonas-relieves-mara',
        proposalId: 'prop-001',
        proposedByNpcId: 'jonas',
        proposedTerms: newTerms,
        reasonCode: 'care-conflict',
      }),
    );
    const pending = state.commitments[0]!.pendingProposal;
    expect(pending?.proposalId).toBe('prop-001');
    // Terms must NOT change on proposal alone (silence is never acceptance).
    expect(state.commitments[0]!.terms).toEqual(TERMS);

    applyEvent(
      state,
      mkEvent('CommitmentRenegotiationAccepted', 780, {
        commitmentId: 'cmt-jonas-relieves-mara',
        proposalId: 'prop-001',
        acceptedByNpcId: 'mara',
        newTerms,
      }),
    );
    const c = state.commitments[0]!;
    expect(c.terms).toEqual(newTerms);
    expect(c.renegotiated).toBe(true);
    expect(c.pendingProposal).toBeNull();
  });

  it('rejection clears the proposal and keeps original terms', () => {
    const state = freshState('A');
    createCommitment(state);
    applyEvent(
      state,
      mkEvent('CommitmentRenegotiationProposed', 750, {
        commitmentId: 'cmt-jonas-relieves-mara',
        proposalId: 'prop-001',
        proposedByNpcId: 'jonas',
        proposedTerms: { startTick: 1140, graceTick: 1260, minDurationTicks: 300 },
        reasonCode: 'care-conflict',
      }),
    );
    applyEvent(
      state,
      mkEvent('CommitmentRenegotiationRejected', 780, {
        commitmentId: 'cmt-jonas-relieves-mara',
        proposalId: 'prop-001',
        rejectedByNpcId: 'mara',
      }),
    );
    const c = state.commitments[0]!;
    expect(c.terms).toEqual(TERMS);
    expect(c.pendingProposal).toBeNull();
    expect(c.renegotiated).toBe(false);
  });
});

describe('commitment outcomes through full scenarios', () => {
  it('scenario A fulfills the promise inside the original window', () => {
    const run = completedRun('A');
    const fulfilled = firstEventOfType(run, 'CommitmentFulfilled');
    expect(fulfilled).toBeDefined();
    const p = fulfilled!.payload as { reliefStartTick: number };
    // Jonas takes the bench no later than the grace deadline...
    expect(p.reliefStartTick).toBeLessThanOrEqual(1020);
    // ...and works at least five continuous minutes overlapping the window.
    expect(fulfilled!.tick - p.reliefStartTick).toBeGreaterThanOrEqual(300);
    expect(eventsOfType(run, 'CommitmentBroken')).toHaveLength(0);
  });

  it('scenario C resolves the promise-versus-emergency conflict by renegotiation', () => {
    const run = completedRun('C');
    const proposed = firstEventOfType(run, 'CommitmentRenegotiationProposed');
    const accepted = firstEventOfType(run, 'CommitmentRenegotiationAccepted');
    expect(proposed).toBeDefined();
    expect(accepted).toBeDefined();
    // The proposal precedes the (original) grace deadline; Mara's acceptance
    // is her own recorded action — never inferred from silence.
    expect(proposed!.tick).toBeLessThan(1020);
    expect((accepted!.payload as { acceptedByNpcId: string }).acceptedByNpcId).toBe('mara');
    expect(run.state.commitments[0]!.status).toBe('fulfilled');
    expect(run.state.commitments[0]!.renegotiated).toBe(true);
    expect(eventsOfType(run, 'CommitmentBroken')).toHaveLength(0);
  });

  it('scenario F breaks the promise exactly once and applies the -0.15 consequence', () => {
    const run = completedRun('F');
    const broken = eventsOfType(run, 'CommitmentBroken');
    expect(broken).toHaveLength(1);
    expect(eventsOfType(run, 'CommitmentFulfilled')).toHaveLength(0);
    const rel = run.state.relationships.find(
      (r) => r.fromNpcId === 'mara' && r.toNpcId === 'jonas',
    );
    expect(rel?.valueMicro).toBe(-150_000);
    const relChange = eventsOfType(run, 'RelationshipChanged').find(
      (e) => (e.payload as { reasonCode: string }).reasonCode === 'promise-broken',
    );
    expect(relChange).toBeDefined();
    expect((relChange!.payload as { causeEventIds: string[] }).causeEventIds).toContain(
      broken[0]!.id,
    );
  });
});
