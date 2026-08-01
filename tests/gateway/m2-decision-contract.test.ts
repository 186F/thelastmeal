import { describe, expect, it } from 'vitest';
import {
  M2_CONFIDENCE_COMPATIBILITY_VALUE,
  parseM2Choice,
} from '../../gateway/adapters/m2DecisionContract';
import { M2_RATIONALE_TRACE_MAX_CHARS } from '../../src/shared/m2Experiment';
import {
  M2_SYSTEM_INSTRUCTION,
  buildM2ChoiceJsonSchema,
} from '../../gateway/prompts/maraActionSelectionM2';
import {
  SYSTEM_INSTRUCTION as M1_SYSTEM_INSTRUCTION,
  buildModelChoiceJsonSchema,
} from '../../gateway/prompts/maraActionSelection';

/**
 * The M2 revised diagnostic-output contract (brief §17.5; ruling R7 §9.1,
 * R7 §9.2): structural fields gate strictly; rationale and self-reported
 * confidence are normalized diagnostics that can NEVER convert a
 * structurally valid choice into invalid-model-output — the exact defect
 * that caused Milestone 1's seven rationale-length live failures.
 */

const OFFERED = ['aff:work:bench', 'aff:rest:bunk'] as const;

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    selectedAffordanceId: 'aff:work:bench',
    reasonCode: 'goal',
    confidenceBp: 7200,
    rationale: 'Repairs stay on schedule.',
    ...overrides,
  };
}

describe('parseM2Choice — structural fields gate strictly', () => {
  it('accepts a fully populated choice without normalization', () => {
    const result = parseM2Choice(valid(), OFFERED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choice.selectedAffordanceId).toBe('aff:work:bench');
    expect(result.choice.reasonCode).toBe('goal');
    expect(result.choice.rationale).toBe('Repairs stay on schedule.');
    expect(result.choice.selfReportedConfidenceBp).toBe(7200);
    expect(result.choice.rationaleNormalized).toBe(false);
  });

  it('refuses an unoffered affordance, a bad reason code, and non-objects', () => {
    expect(parseM2Choice(valid({ selectedAffordanceId: 'aff:unoffered' }), OFFERED).ok).toBe(false);
    expect(parseM2Choice(valid({ reasonCode: 'vibes' }), OFFERED).ok).toBe(false);
    expect(parseM2Choice('not-an-object', OFFERED).ok).toBe(false);
    expect(parseM2Choice(null, OFFERED).ok).toBe(false);
    expect(parseM2Choice(undefined, OFFERED).ok).toBe(false);
  });

  it('refuses an empty offered set at construction', () => {
    expect(() => parseM2Choice(valid(), [])).toThrow(/m2-choice-schema-empty-offer/);
  });
});

describe('parseM2Choice — rationale is a normalized diagnostic, never a gate (§17.5)', () => {
  it('a MISSING rationale is accepted, normalized to null, and flagged', () => {
    const choice = valid();
    delete choice.rationale;
    const result = parseM2Choice(choice, OFFERED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choice.rationale).toBeNull();
    // §17.5 lists missing among the normalization cases; the flag records it
    // so the R2 rationale-normalization frequency counts absent rationales.
    expect(result.choice.rationaleNormalized).toBe(true);
  });

  it('a NON-STRING rationale is accepted, normalized to null, and flagged', () => {
    for (const bad of [42, { text: 'x' }, ['x'], true, null]) {
      const result = parseM2Choice(valid({ rationale: bad }), OFFERED);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.choice.rationale).toBeNull();
      expect(result.choice.rationaleNormalized).toBe(true);
    }
  });

  it('an OVERLONG rationale is accepted, truncated to the fixed trace limit, and flagged — the Milestone 1 killer', () => {
    const overlong = 'x'.repeat(M2_RATIONALE_TRACE_MAX_CHARS + 500);
    const result = parseM2Choice(valid({ rationale: overlong }), OFFERED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choice.rationale).toHaveLength(M2_RATIONALE_TRACE_MAX_CHARS);
    expect(result.choice.rationaleNormalized).toBe(true);
  });

  it('a rationale exactly at the limit passes untouched', () => {
    const exact = 'y'.repeat(M2_RATIONALE_TRACE_MAX_CHARS);
    const result = parseM2Choice(valid({ rationale: exact }), OFFERED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choice.rationale).toBe(exact);
    expect(result.choice.rationaleNormalized).toBe(false);
  });
});

describe('parseM2Choice — confidence is diagnostic only (ruling R7 §9.2)', () => {
  it('missing, fractional, out-of-range, or mistyped confidence normalizes to null without rejection', () => {
    for (const bad of [undefined, 3.5, -1, 10_001, '7200', null]) {
      const choice = valid();
      if (bad === undefined) delete choice.confidenceBp;
      else choice.confidenceBp = bad;
      const result = parseM2Choice(choice, OFFERED);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.choice.selfReportedConfidenceBp).toBeNull();
    }
  });

  it('the compatibility value for an absent claim is a fixed deterministic constant', () => {
    expect(M2_CONFIDENCE_COMPATIBILITY_VALUE).toBe(0);
  });

  it('unknown extra fields are tolerated and never stored', () => {
    const result = parseM2Choice(valid({ hiddenReasoning: 'chain of thought' }), OFFERED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.choice).sort()).toEqual([
      'rationale',
      'rationaleNormalized',
      'reasonCode',
      'selectedAffordanceId',
      'selfReportedConfidenceBp',
    ]);
  });
});

describe('the M2 prompt module is a NEW parallel version, the M1 module frozen', () => {
  it('M2 requires only the structural fields upstream; M1 requires all four', () => {
    const m2Schema = buildM2ChoiceJsonSchema([...OFFERED]) as { required: string[] };
    expect([...m2Schema.required].sort()).toEqual(['reasonCode', 'selectedAffordanceId']);
    const m1Schema = buildModelChoiceJsonSchema([...OFFERED]) as { required: string[] };
    expect([...m1Schema.required].sort()).toEqual([
      'confidenceBp',
      'rationale',
      'reasonCode',
      'selectedAffordanceId',
    ]);
  });

  it('both instructions forbid hidden reasoning; the M2 instruction marks rationale and confidence optional and diagnostic', () => {
    expect(M2_SYSTEM_INSTRUCTION).toMatch(/Do not reveal or produce hidden reasoning/);
    expect(M1_SYSTEM_INSTRUCTION).toMatch(/Do not reveal or produce hidden reasoning/);
    expect(M2_SYSTEM_INSTRUCTION).toMatch(/optional diagnostic notes/);
    expect(M2_SYSTEM_INSTRUCTION).toMatch(/never\s+affect what happens in the simulation/);
  });
});
