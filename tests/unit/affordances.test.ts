import { describe, expect, it } from 'vitest';
import { generateAffordances } from '../../src/sim/actions/affordances';
import { createRun, stepTick } from '../../src/sim/runtime/engine';

describe('affordance generation', () => {
  it('offers Mara continue-work, break request, requests, and rest family at tick 1', () => {
    const run = createRun('A');
    stepTick(run);
    const affs = generateAffordances(run.state, 'mara', 1, run.state.stateVersion);
    const modes = affs.map((a) => a.mode);
    expect(modes).toContain('request-break'); // hunger 0.72 >= moderate while working
    expect(modes).toContain('request-transfer');
    expect(modes).toContain('rest');
    expect(modes).toContain('routine-work');
    expect(modes).toContain('wait');
    expect(affs.some((a) => a.continuesActionId !== null && a.mode === 'work')).toBe(true);
    // Bench already hers: no fresh work affordance, no relieve-self.
    expect(affs.filter((a) => a.mode === 'work' && a.continuesActionId === null)).toHaveLength(0);
    expect(modes).not.toContain('relieve');
  });

  it('flags the eat affordance as a violation for non-owners', () => {
    const run = createRun('A');
    stepTick(run);
    const mara = generateAffordances(run.state, 'mara', 1, run.state.stateVersion);
    const maraEat = mara.find((a) => a.category === 'eat-meal');
    expect(maraEat?.mode).toBe('eat-violation');
    expect(maraEat?.violation).toBe(true);
    expect(maraEat?.targetNpcId).toBe('rin');

    const rin = generateAffordances(run.state, 'rin', 1, run.state.stateVersion);
    const rinEat = rin.find((a) => a.category === 'eat-meal');
    expect(rinEat?.mode).toBe('eat');
    expect(rinEat?.violation).toBe(false);
  });

  it('offers Jonas the relieve affordance while Mara holds the bench', () => {
    const run = createRun('A');
    stepTick(run);
    const affs = generateAffordances(run.state, 'jonas', 1, run.state.stateVersion);
    const relieve = affs.find((a) => a.mode === 'relieve');
    expect(relieve).toBeDefined();
    expect(relieve!.targetNpcId).toBe('mara');
    expect(relieve!.commitmentId).toBe('cmt-jonas-relieves-mara');
    expect(relieve!.reservations).toContain('workbench-slot');
  });

  it('offers treatment only while someone is injured and untreated', () => {
    const run = createRun('C');
    for (let i = 0; i < 719; i += 1) stepTick(run);
    expect(
      generateAffordances(run.state, 'jonas', 719, run.state.stateVersion).some(
        (a) => a.mode === 'treat',
      ),
    ).toBe(false);
    stepTick(run); // injury at 720
    const affs = generateAffordances(run.state, 'jonas', 720, run.state.stateVersion);
    const treat = affs.find((a) => a.mode === 'treat');
    expect(treat).toBeDefined();
    expect(treat!.targetNpcId).toBe('rin');
    expect(treat!.requiredLocationId).toBe('medical-cot');
    expect(treat!.durationTicks).toBe(240);
    // Rin cannot treat herself in this slice.
    const rinAffs = generateAffordances(run.state, 'rin', 720, run.state.stateVersion);
    expect(rinAffs.some((a) => a.mode === 'treat')).toBe(false);
  });

  it('incapacitated NPCs receive no affordances at all', () => {
    const run = createRun('F');
    for (let i = 0; i < 1400; i += 1) stepTick(run);
    expect(run.state.npcs.rin.incapacitated).toBe(true);
    expect(generateAffordances(run.state, 'rin', 1400, run.state.stateVersion)).toHaveLength(0);
  });

  it('every affordance carries the structured fields needed for validation and execution', () => {
    const run = createRun('A');
    stepTick(run);
    for (const npcId of ['mara', 'jonas', 'rin'] as const) {
      for (const a of generateAffordances(run.state, npcId, 1, run.state.stateVersion)) {
        expect(a.id).toMatch(/^aff:/);
        expect(a.actorId).toBe(npcId);
        expect(a.durationTicks).toBeGreaterThan(0);
        expect(a.stateVersion).toBe(run.state.stateVersion);
        expect(typeof a.violation).toBe('boolean');
        expect(Array.isArray(a.preconditions)).toBe(true);
        expect(Array.isArray(a.reservations)).toBe(true);
      }
    }
  });
});
