import type { ScenarioId } from '../../shared/ids';

/**
 * Audit finding shape shared by the static contract checks and the
 * event-stream checks (M2 brief §27.6–§27.7). `key` is the exact-match
 * identity used by the known-gap registry: a registered gap matches a
 * finding only when `checkId`, scenario applicability, and every key/value
 * pair match exactly — a gap that "changes shape" therefore stops matching
 * and fails CI.
 */
export interface AuditFinding {
  checkId: string;
  /** `'static'` for declaration-level findings independent of any run. */
  scenarioId: ScenarioId | 'static';
  key: Record<string, string>;
  detail: string;
}

export function findingSortKey(finding: AuditFinding): string {
  const keyText = Object.keys(finding.key)
    .sort()
    .map((k) => `${k}=${finding.key[k]}`)
    .join(',');
  return `${finding.checkId}|${finding.scenarioId}|${keyText}`;
}
