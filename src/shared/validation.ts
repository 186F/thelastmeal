/** Shared validation issue shape used by `npm run validate`, the in-browser
 * Validate Configuration control, and imported-ledger validation. */
export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  where: string | null;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export function validationOk(issues: ValidationIssue[]): boolean {
  return issues.every((i) => i.severity !== 'error');
}
