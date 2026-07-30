import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { validateLedgerFile } from '../../src/sim/replay/validateLedger';
import type { LedgerFile } from '../../src/shared/ledgerFile';
import { canonicalSerialize } from '../../src/sim/replay/serialize';
import { NPC_IDS } from '../../src/shared/ids';
import type {
  BehaviorComparison,
  BehaviorFingerprintSet,
} from '../../src/shared/behaviorArtifacts';

/**
 * Node-side IO for the behavioral-evaluation CLIs (M2 brief §10.1–10.2).
 * All simulation-pure logic lives under `src/sim/evaluation`; this module
 * only loads, validates, renders, and writes.
 */

export interface LoadedLedger {
  sourcePath: string;
  ledgerPath: string;
  file: LedgerFile;
}

/**
 * Accepts either a ledger JSON file or a run directory containing exactly one
 * `ledger-*.json` (a finalized model-run directory qualifies). The ledger is
 * fully validated — schema, semantics, isolated replay, recomputed hashes —
 * before any evaluation runs.
 */
export function loadValidatedLedger(inputPath: string): LoadedLedger {
  if (!existsSync(inputPath)) throw new Error(`input-not-found: ${inputPath}`);
  let ledgerPath = inputPath;
  if (statSync(inputPath).isDirectory()) {
    const candidates = readdirSync(inputPath).filter(
      (name) => name.startsWith('ledger-') && name.endsWith('.json'),
    );
    if (candidates.length !== 1) {
      throw new Error(
        `run-directory-needs-exactly-one-ledger: found ${candidates.length} in ${inputPath}`,
      );
    }
    ledgerPath = join(inputPath, candidates[0]!);
  }
  const validation = validateLedgerFile(readFileSync(ledgerPath, 'utf8'));
  if (!validation.ok || !validation.file) {
    const firstErrors = validation.issues
      .filter((issue) => issue.severity === 'error')
      .slice(0, 5)
      .map((issue) => `${issue.code} (${issue.where ?? 'unknown'})`)
      .join('; ');
    throw new Error(`ledger-validation-failed: ${ledgerPath}: ${firstErrors}`);
  }
  return { sourcePath: inputPath, ledgerPath, file: validation.file };
}

export function writeCanonicalJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, canonicalSerialize(value), 'utf8');
}

export function writeText(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

export function defaultOutName(ledgerPath: string, suffix: string): string {
  return `${basename(ledgerPath, '.json')}.${suffix}`;
}

const COMMITMENT_STATUS_NOTE =
  'commitmentTerminalStatus is the mechanical commitment terminal status ' +
  'produced under VS001 rules; it is not a validated attribution of moral ' +
  'responsibility or realistic blame (M2 brief §10.11).';

export function renderFingerprintMarkdown(set: BehaviorFingerprintSet): string {
  const lines: string[] = [];
  lines.push(`# Behavior fingerprints — ${set.scenarioId} seed ${set.seed}`);
  lines.push('');
  lines.push(`- fingerprintVersion: \`${set.fingerprintVersion}\``);
  lines.push(`- condition: \`${set.conditionId}\``);
  lines.push(`- scenario: ${set.scenarioId} v${set.scenarioVersion}, seed ${set.seed}`);
  lines.push(`- finalTick: ${set.finalTick}`);
  lines.push(`- worldStateHash: \`${set.worldStateHash}\``);
  lines.push(`- canonicalLedgerHash: \`${set.canonicalLedgerHash}\``);
  lines.push('');
  lines.push(`> ${COMMITMENT_STATUS_NOTE}`);
  lines.push('');
  lines.push(
    '| NPC | opportunities | starts | active ticks | top category (bp) | contribution (bp) | fallbacks | commitment status |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const npcId of NPC_IDS) {
    const f = set.npcs[npcId];
    const topCategory = Object.entries(f.timeByCategoryBp).sort((a, b) => b[1] - a[1])[0]!;
    lines.push(
      `| ${npcId} | ${f.decisionOpportunities} | ${f.actionsStarted} | ${f.activeTicks} | ` +
        `${topCategory[0]} (${topCategory[1]}) | ${f.purifierContributionBp} | ` +
        `${f.deterministicFallbackDecisions} | ${f.commitmentTerminalStatus} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function renderComparisonMarkdown(comparison: BehaviorComparison): string {
  const lines: string[] = [];
  const mara = comparison.npcs.mara;
  lines.push(
    `# Behavior similarity — ${mara.left.scenarioId}/${mara.left.conditionId} vs ` +
      `${mara.right.scenarioId}/${mara.right.conditionId}`,
  );
  lines.push('');
  lines.push(`- similarityVersion: \`${comparison.similarityVersion}\``);
  lines.push(`- pairing: ${comparison.pairing}`);
  lines.push(`- seed: ${mara.left.seed}`);
  lines.push('');
  lines.push(`> ${COMMITMENT_STATUS_NOTE}`);
  lines.push('');
  lines.push(
    '| NPC | composite | categoryTime | modeStarts | transitions | targetOrientation | outcomes |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const npcId of NPC_IDS) {
    const c = comparison.npcs[npcId];
    lines.push(
      `| ${npcId} | **${c.compositeBp}** | ${c.components.categoryTime} | ${c.components.modeStarts} | ` +
        `${c.components.transitions} | ${c.components.targetOrientation} | ${c.components.outcomes} |`,
    );
  }
  lines.push('');
  lines.push('## Outcome subcomponents');
  lines.push('');
  lines.push(
    '| NPC | task | meal | commitment | injuryWorsened | treatmentOccurred | ownership | relationships | treatmentLatency |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const npcId of NPC_IDS) {
    const s = comparison.npcs[npcId].outcomeSubcomponents;
    lines.push(
      `| ${npcId} | ${s.taskOutcomeMatch} | ${s.mealConsumerMatch} | ${s.commitmentTerminalStatusMatch} | ` +
        `${s.injuryWorsenedMatch} | ${s.treatmentOccurredMatch} | ${s.ownershipViolationSimilarity} | ` +
        `${s.relationshipDeltaSimilarity} | ${s.treatmentLatencySimilarity ?? 'n/a (not both observable)'} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
