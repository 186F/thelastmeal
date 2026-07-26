/**
 * Canonical numeric conventions.
 *
 * All normalized 0..1 quantities (needs, injury severity, relationship values,
 * confidence) are stored canonically as integer MICRO units: 1.0 == 1_000_000.
 * This keeps every canonical value an exact integer so hashing and replay are
 * platform independent. Values are formatted to decimals for display only.
 *
 * Purifier repair progress uses its own integer scale (REPAIR units, defined in
 * the sim config) so that every fixed repair rate from the brief is an exact
 * integer per tick.
 */
export const MICRO = 1_000_000;

/** Basis points used for decision confidence display (0..10000). */
export const BASIS_POINTS = 10_000;

/** One logical tick is exactly one simulated second. */
export const TICKS_PER_MINUTE = 60;

export function microToNumber(micro: number): number {
  return micro / MICRO;
}

export function formatMicro(micro: number, decimals = 2): string {
  return (micro / MICRO).toFixed(decimals);
}

export function formatMicroPercent(micro: number, decimals = 0): string {
  return ((micro / MICRO) * 100).toFixed(decimals) + '%';
}

export function minutesToTicks(minutes: number): number {
  return minutes * TICKS_PER_MINUTE;
}

export function formatTickClock(tick: number): string {
  const m = Math.floor(tick / TICKS_PER_MINUTE);
  const s = tick % TICKS_PER_MINUTE;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
