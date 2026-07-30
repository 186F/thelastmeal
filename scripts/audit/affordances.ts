import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENARIO_IDS, type ScenarioId } from '../../src/shared/ids';
import { createRun, runToCompletion } from '../../src/sim/runtime/engine';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import { auditEventStream, auditStaticContracts } from '../../src/sim/audit/affordanceAudit';
import { findingSortKey, type AuditFinding } from '../../src/sim/audit/findings';
import {
  KNOWN_GAPS,
  KNOWN_GAP_REGISTRY_VERSION,
  matchKnownGap,
} from '../../src/sim/audit/knownGaps';
import { AUDIT_CONTRACTS_VERSION } from '../../src/sim/audit/contracts';

/**
 * `npm run audit:affordances -- [--ledger=<path> ...] [--out=<dir>] [--ci]`
 *
 * Affordance-space and interruption-contract audit (M2 brief §27.6–§27.7).
 *
 * Always audits: the static contract declarations, plus fresh deterministic
 * runs of all seven frozen scenarios (keyless, generated in-process).
 * Additional `--ledger` inputs (e.g. retained live ledgers) are validated
 * and audited the same way.
 *
 * CI behavior (§27.7):
 *   exact known-gap match  → reported as known limitation, exit 0
 *   anything else          → exit 1
 */

interface ClassifiedFinding extends AuditFinding {
  classification: 'known-limitation' | 'unregistered';
  knownGapId: string | null;
}

export interface AuditReport {
  auditContractsVersion: string;
  knownGapRegistryVersion: string;
  auditedScenarios: ScenarioId[];
  auditedLedgers: string[];
  findings: ClassifiedFinding[];
  knownLimitationCount: number;
  unregisteredCount: number;
  ok: boolean;
}

export function classify(findings: readonly AuditFinding[]): ClassifiedFinding[] {
  return findings.map((finding) => {
    const gap = matchKnownGap(finding);
    return {
      ...finding,
      classification: gap ? 'known-limitation' : 'unregistered',
      knownGapId: gap ? gap.knownGapId : null,
    };
  });
}

export function runAudit(ledgerPaths: readonly string[]): AuditReport {
  const findings: AuditFinding[] = [...auditStaticContracts()];

  for (const scenarioId of SCENARIO_IDS) {
    const run = createRun(scenarioId);
    runToCompletion(run);
    const file = buildLedgerFile(run);
    findings.push(...auditEventStream(scenarioId, file.events));
  }

  const auditedLedgers: string[] = [];
  for (const ledgerPath of ledgerPaths) {
    const validation = validateLedgerFile(readFileSync(ledgerPath, 'utf8'));
    if (!validation.ok || !validation.file) {
      throw new Error(`audit-input-ledger-invalid: ${ledgerPath}`);
    }
    auditedLedgers.push(ledgerPath);
    findings.push(...auditEventStream(validation.file.scenario.id, validation.file.events));
  }

  const deduped = new Map<string, AuditFinding>();
  for (const finding of findings) deduped.set(findingSortKey(finding), finding);
  const classified = classify(
    [...deduped.values()].sort((a, b) => findingSortKey(a).localeCompare(findingSortKey(b))),
  );
  const unregisteredCount = classified.filter((f) => f.classification === 'unregistered').length;
  return {
    auditContractsVersion: AUDIT_CONTRACTS_VERSION,
    knownGapRegistryVersion: KNOWN_GAP_REGISTRY_VERSION,
    auditedScenarios: [...SCENARIO_IDS],
    auditedLedgers,
    findings: classified,
    knownLimitationCount: classified.length - unregisteredCount,
    unregisteredCount,
    ok: unregisteredCount === 0,
  };
}

export function renderAuditMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push('# VS001 affordance and interruption-contract audit');
  lines.push('');
  lines.push(`- contracts: \`${report.auditContractsVersion}\``);
  lines.push(
    `- known-gap registry: \`${report.knownGapRegistryVersion}\` (${KNOWN_GAPS.length} registered gaps)`,
  );
  lines.push(
    `- audited: ${report.auditedScenarios.join(', ')} (deterministic) + ${report.auditedLedgers.length} supplied ledger(s)`,
  );
  lines.push(
    `- verdict: ${report.ok ? 'OK' : 'FAIL'} — ${report.knownLimitationCount} known limitation(s), ${report.unregisteredCount} unregistered finding(s)`,
  );
  lines.push('');
  lines.push('| classification | check | scenario | key | known gap |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const f of report.findings) {
    const key = Object.entries(f.key)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    lines.push(
      `| ${f.classification} | ${f.checkId} | ${f.scenarioId} | ${key} | ${f.knownGapId ?? '—'} |`,
    );
  }
  lines.push('');
  lines.push(
    '> Known limitations are the documented VS001 gaps, registered for resolution in ' +
      'Vertical Slice 002 (M2 brief §7.3). They are reported, never silently repaired, ' +
      'and never fail CI while they match the registry exactly.',
  );
  lines.push('');
  return lines.join('\n');
}

export function runAuditCli(argv: readonly string[]): number {
  const ledgerPaths = argv
    .filter((a) => a.startsWith('--ledger='))
    .map((a) => a.slice('--ledger='.length));
  const outDir =
    argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? join('artifacts', 'audit');
  const report = runAudit(ledgerPaths);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'audit-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'audit-report.md'), renderAuditMarkdown(report), 'utf8');
  console.log(
    `audit:affordances — ${report.ok ? 'OK' : 'FAIL'}: ` +
      `${report.knownLimitationCount} known limitation(s), ${report.unregisteredCount} unregistered; ` +
      `reports in ${outDir}`,
  );
  if (!report.ok) {
    for (const f of report.findings.filter((x) => x.classification === 'unregistered')) {
      console.error(`  UNREGISTERED [${f.checkId}] ${f.scenarioId}: ${f.detail}`);
    }
  }
  return report.ok ? 0 : 1;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    process.exitCode = runAuditCli(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(
      `audit:affordances failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
