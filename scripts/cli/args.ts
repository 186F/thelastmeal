/**
 * Shared CLI argument parsing for the evaluation and audit scripts (Phase 2
 * audit §7.4: one parser, both spellings). Every value option accepts
 * `--name=value` and `--name value`; flags are bare `--name`.
 */

export function readOptions(argv: readonly string[], name: string): string[] {
  const out: string[] = [];
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === `--${name}`) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`cli-missing-value:--${name}`);
      }
      out.push(next);
      i += 1;
    } else if (arg.startsWith(prefix)) {
      out.push(arg.slice(prefix.length));
    }
  }
  return out;
}

/** Single-value option; the last occurrence wins, `undefined` when absent. */
export function readOption(argv: readonly string[], name: string): string | undefined {
  const values = readOptions(argv, name);
  return values.length === 0 ? undefined : values[values.length - 1];
}

export function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`);
}
