import { describe, expect, it } from 'vitest';
import { validateExperimentData } from '../../src/sim/validation/validateData';

describe('shared experiment-data validation', () => {
  it('the frozen v1.0 configuration validates with zero errors', () => {
    const result = validateExperimentData();
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
