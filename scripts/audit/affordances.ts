import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { SCENARIO_IDS, type ScenarioId } from '../../src/shared/ids';
import type { EventEnvelope } from '../../src/shared/events';
import { createRun, runToCompletion } from '../../src/sim/runtime/engine';
import { buildLedgerFile } from '../../src/sim/runtime/ledgerFileBuilder';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import {
  auditEventStreamDetailed,
  auditStaticContracts,
  type DilemmaEvaluationStats,
} from '../../src/sim/audit/affordanceAudit';
import { findingSortKey, type AuditFinding } from '../../src/sim/audit/findings';
import {
  KNOWN_GAPS,
  KNOWN_GAP_REGISTRY_VERSION,
  matchKnownGap,
  type KnownGap,
} from '../../src/sim/audit/knownGaps';
import { AUDIT_CONTRACTS_VERSION } from '../../src/sim/audit/contracts';
import { readOption, readOptions } from '../cli/args';

/**
 * `npm run audit:affordances -- [--ledger <path> ...] [--out <dir>]`
 * (both `--name value` and `--name=value` spellings are accepted)
 *
 * Affordance-space and interruption-contract audit (M2 brief §27.6–§27.7,
 * remediated per the Phase 2 audit finding 2).
 *
 * Always audits: the static contract declarations, fresh deterministic runs
 * of all seven frozen scenarios (keyless, generated in-process), and every
 * committed synthetic fixture declared as registry coverage. Additional
 * `--ledger` inputs (e.g. retained live ledgers) are validated and audited
 * the same way.
 *
 * CI passes ONLY when BOTH hold:
 *   unregisteredFindings   = []  — no new or shape-changed gap observed;
 *   unobservedKnownGapIds  = []  — every registered gap was reproduced by at
 *                                  least one of its DECLARED coverage sources.
 * A registered gap that stops being observed is a regression of the audit
 * itself (a vanished gap is a shape change) and fails CI.
 */

const syntheticFixtureSchema = z
  .object({
    formatVersion: z.literal(1),
    fixtureId: z.string().min(1),
    scenarioId: z.enum(SCENARIO_IDS),
    description: z.string().min(1),
    events: z.array(z.object({ type: z.string(), tick: z.number().int() }).passthrough()).min(1),
  })
  .strict();

export interface SyntheticFixture {
  fixtureId: string;
  scenarioId: ScenarioId;
  events: EventEnvelope[];
}

/** Loads and shape-validates a committed synthetic event-stream fixture.
 * A missing or malformed fixture throws — deleting declared coverage must
 * fail the audit, never silently shrink it. */
export function loadSyntheticFixture(fixturePath: string): SyntheticFixture {
  let raw: string;
  try {
    raw = readFileSync(fixturePath, 'utf8');
  } catch {
    throw new Error(`audit-coverage-fixture-missing: ${fixturePath}`);
  }
  const parsed = syntheticFixtureSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`audit-coverage-fixture-invalid: ${fixturePath}`);
  }
  return {
    fixtureId: parsed.data.fixtureId,
    scenarioId: parsed.data.scenarioId,
    events: parsed.data.events as unknown as EventEnvelope[],
  };
}

interface ClassifiedFinding extends AuditFinding {
  classification: 'known-limitation' | 'unregistered';
  knownGapId: string | null;
}

interface SourceDilemmaStats extends DilemmaEvaluationStats {
  source: string;
}

export interface AuditReport {
  auditContractsVersion: string;
  knownGapRegistryVersion: string;
  registeredKnownGapIds: string[];
  auditedScenarios: ScenarioId[];
  auditedFixtures: string[];
  auditedLedgers: string[];
  findings: ClassifiedFinding[];
  dilemmaStats: SourceDilemmaStats[];
  matchedKnownGapIds: string[];
  unobservedKnownGapIds: string[];
  unregisteredFindings: ClassifiedFinding[];
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

/** One audited corpus item: where its findings came from. */
export interface CorpusItem {
  source:
    | { kind: 'static-contract' }
    | { kind: 'deterministic-scenario'; scenarioId: ScenarioId }
    | { kind: 'committed-synthetic-fixture'; fixturePath: string }
    | { kind: 'supplied-ledger'; path: string };
  findings: AuditFinding[];
}

export function sourceObservesGap(gap: KnownGap, item: CorpusItem): boolean {
  const declared = gap.coverage.some((coverageSource) => {
    if (coverageSource.kind !== item.source.kind) return false;
    if (
      coverageSource.kind === 'deterministic-scenario' &&
      item.source.kind === 'deterministic-scenario'
    ) {
      return coverageSource.scenarioId === item.source.scenarioId;
    }
    if (
      coverageSource.kind === 'committed-synthetic-fixture' &&
      item.source.kind === 'committed-synthetic-fixture'
    ) {
      return coverageSource.fixturePath === item.source.fixturePath;
    }
    return coverageSource.kind === 'static-contract';
  });
  if (!declared) return false;
  return item.findings.some((finding) => matchKnownGap(finding)?.knownGapId === gap.knownGapId);
}

/** Which registered gaps were reproduced by at least one DECLARED coverage
 * source in the audited corpus (the CI coverage guarantee). */
export function coverageStatus(
  gaps: readonly KnownGap[],
  corpus: readonly CorpusItem[],
): { matchedKnownGapIds: string[]; unobservedKnownGapIds: string[] } {
  const matchedKnownGapIds: string[] = [];
  const unobservedKnownGapIds: string[] = [];
  for (const gap of gaps) {
    const observed = corpus.some((item) => sourceObservesGap(gap, item));
    if (observed) matchedKnownGapIds.push(gap.knownGapId);
    else unobservedKnownGapIds.push(gap.knownGapId);
  }
  return { matchedKnownGapIds, unobservedKnownGapIds };
}

export function runAudit(ledgerPaths: readonly string[]): AuditReport {
  const corpus: CorpusItem[] = [];
  const dilemmaStats: SourceDilemmaStats[] = [];

  corpus.push({ source: { kind: 'static-contract' }, findings: auditStaticContracts() });

  for (const scenarioId of SCENARIO_IDS) {
    const run = createRun(scenarioId);
    runToCompletion(run);
    const file = buildLedgerFile(run);
    const result = auditEventStreamDetailed(scenarioId, file.events);
    corpus.push({
      source: { kind: 'deterministic-scenario', scenarioId },
      findings: result.findings,
    });
    for (const stats of result.dilemmaStats) {
      dilemmaStats.push({ source: `scenario-${scenarioId}`, ...stats });
    }
  }

  const auditedFixtures: string[] = [];
  const fixturePaths = new Set<string>();
  for (const gap of KNOWN_GAPS) {
    for (const coverageSource of gap.coverage) {
      if (coverageSource.kind === 'committed-synthetic-fixture') {
        fixturePaths.add(coverageSource.fixturePath);
      }
    }
  }
  for (const fixturePath of [...fixturePaths].sort()) {
    const fixture = loadSyntheticFixture(fixturePath);
    const result = auditEventStreamDetailed(fixture.scenarioId, fixture.events);
    auditedFixtures.push(fixturePath);
    corpus.push({
      source: { kind: 'committed-synthetic-fixture', fixturePath },
      findings: result.findings,
    });
    for (const stats of result.dilemmaStats) {
      dilemmaStats.push({ source: `fixture-${fixture.fixtureId}`, ...stats });
    }
  }

  const auditedLedgers: string[] = [];
  for (const ledgerPath of ledgerPaths) {
    const validation = validateLedgerFile(readFileSync(ledgerPath, 'utf8'));
    if (!validation.ok || !validation.file) {
      throw new Error(`audit-input-ledger-invalid: ${ledgerPath}`);
    }
    auditedLedgers.push(ledgerPath);
    const result = auditEventStreamDetailed(validation.file.scenario.id, validation.file.events);
    corpus.push({
      source: { kind: 'supplied-ledger', path: ledgerPath },
      findings: result.findings,
    });
    for (const stats of result.dilemmaStats) {
      dilemmaStats.push({ source: `ledger-${ledgerPath}`, ...stats });
    }
  }

  // Coverage guarantee: every registered gap must be reproduced by at least
  // one of its DECLARED sources this run (supplied ledgers are extra
  // observations, never a substitute for declared coverage).
  const { matchedKnownGapIds, unobservedKnownGapIds } = coverageStatus(KNOWN_GAPS, corpus);

  const deduped = new Map<string, AuditFinding>();
  for (const item of corpus) {
    for (const finding of item.findings) deduped.set(findingSortKey(finding), finding);
  }
  const classified = classify(
    [...deduped.values()].sort((a, b) => findingSortKey(a).localeCompare(findingSortKey(b))),
  );
  const unregisteredFindings = classified.filter((f) => f.classification === 'unregistered');
  return {
    auditContractsVersion: AUDIT_CONTRACTS_VERSION,
    knownGapRegistryVersion: KNOWN_GAP_REGISTRY_VERSION,
    registeredKnownGapIds: KNOWN_GAPS.map((gap) => gap.knownGapId),
    auditedScenarios: [...SCENARIO_IDS],
    auditedFixtures,
    auditedLedgers,
    findings: classified,
    dilemmaStats,
    matchedKnownGapIds,
    unobservedKnownGapIds,
    unregisteredFindings,
    knownLimitationCount: classified.length - unregisteredFindings.length,
    unregisteredCount: unregisteredFindings.length,
    ok: unregisteredFindings.length === 0 && unobservedKnownGapIds.length === 0,
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
    `- audited: ${report.auditedScenarios.join(', ')} (deterministic) + ` +
      `${report.auditedFixtures.length} committed fixture(s) + ${report.auditedLedgers.length} supplied ledger(s)`,
  );
  lines.push(
    `- coverage: ${report.matchedKnownGapIds.length}/${report.registeredKnownGapIds.length} registered gaps observed` +
      (report.unobservedKnownGapIds.length > 0
        ? ` — UNOBSERVED: ${report.unobservedKnownGapIds.join(', ')}`
        : ''),
  );
  lines.push(
    `- verdict: ${report.ok ? 'OK' : 'FAIL'} — ${report.knownLimitationCount} known limitation(s), ` +
      `${report.unregisteredCount} unregistered finding(s), ${report.unobservedKnownGapIds.length} unobserved registered gap(s)`,
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
  lines.push('## Dilemma checkpoint evaluations');
  lines.push('');
  lines.push(
    '| source | dilemma | triggering sets | by offered modes | by pending request | resolved by refusal cooldown | missing-exit findings |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const s of report.dilemmaStats) {
    lines.push(
      `| ${s.source} | ${s.dilemmaId} | ${s.triggeringOfferSets} | ${s.satisfiedByOfferedModes} | ` +
        `${s.satisfiedByPendingRequest} | ${s.resolvedByRefusalCooldown} | ${s.missingExitFindings} |`,
    );
  }
  lines.push('');
  lines.push(
    '> Known limitations are the documented VS001 gaps, registered for resolution in ' +
      'Vertical Slice 002 (M2 brief §7.3). They are reported, never silently repaired, ' +
      'and never fail CI while they match the registry exactly AND remain observed by ' +
      'their declared coverage sources. A pending own meal-transfer request satisfies ' +
      'the lawful-acquisition exit class (acquisition in progress); the post-refusal ' +
      'cooldown is evaluated separately as the modeled consequence of an exercised and ' +
      'lawfully refused acquisition (Phase 2 audit §4.4).',
  );
  lines.push('');
  return lines.join('\n');
}

export function runAuditCli(argv: readonly string[]): number {
  const ledgerPaths = readOptions(argv, 'ledger');
  const outDir = readOption(argv, 'out') ?? join('artifacts', 'audit');
  const report = runAudit(ledgerPaths);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'audit-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'audit-report.md'), renderAuditMarkdown(report), 'utf8');
  console.log(
    `audit:affordances — ${report.ok ? 'OK' : 'FAIL'}: ` +
      `${report.knownLimitationCount} known limitation(s), ${report.unregisteredCount} unregistered, ` +
      `${report.matchedKnownGapIds.length}/${report.registeredKnownGapIds.length} registered gaps observed; ` +
      `reports in ${outDir}`,
  );
  if (!report.ok) {
    for (const f of report.unregisteredFindings) {
      console.error(`  UNREGISTERED [${f.checkId}] ${f.scenarioId}: ${f.detail}`);
    }
    for (const gapId of report.unobservedKnownGapIds) {
      console.error(
        `  UNOBSERVED registered gap: ${gapId} (declared coverage did not reproduce it)`,
      );
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
