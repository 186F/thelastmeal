import { describe, expect, it } from 'vitest';
import { hasFlag, readOption, readOptions } from '../../scripts/cli/args';

/** Shared CLI parser (Phase 2 audit §7.4): both `--k=v` and `--k v` work. */
describe('cli args', () => {
  it('reads both spellings, in order', () => {
    expect(readOptions(['--ledger=a.json', '--ledger', 'b.json'], 'ledger')).toEqual([
      'a.json',
      'b.json',
    ]);
    expect(readOption(['--out', 'dir1', '--out=dir2'], 'out')).toBe('dir2');
    expect(readOption([], 'out')).toBeUndefined();
  });

  it('does not confuse prefixes or flags with values', () => {
    expect(readOptions(['--ledgerx=a.json'], 'ledger')).toEqual([]);
    expect(hasFlag(['--ci'], 'ci')).toBe(true);
    expect(hasFlag(['--ci=1'], 'ci')).toBe(false);
    expect(() => readOption(['--out', '--ci'], 'out')).toThrow('cli-missing-value:--out');
    expect(() => readOption(['--out'], 'out')).toThrow('cli-missing-value:--out');
  });
});
