// Routine-CI compact artifact preparation (Phase 4 audit finding 4).
//
// Routine PR/main CI runs the COMPLETE keyless rehearsal and verifies its
// full evidence locally on the runner; what gets uploaded to GitHub
// Actions on routine runs is only compact PROOF — manifests, reports,
// receipts, digests, verdicts — under a registered hard size budget. Full
// sealed evidence ZIPs and Playwright trace payloads are uploaded only by
// the explicit full-evidence profile (manual dispatch or a failing run).
// Formal live evidence is never entrusted to expiring Actions artifacts:
// it is retained locally as sealed packages with independent durable
// backup.
//
// This script assembles artifacts/ci-compact/ from an explicit allowlist,
// hard-DENIES heavy payloads (any .zip evidence/trace payload, images,
// DOM snapshots, trace chunks), writes a machine-readable size report,
// and exits nonzero when the registered budget is exceeded or a denied
// payload would have been included — the pre-upload gate the workflow
// runs before the compact upload step.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import process from 'node:process';
import console from 'node:console';

/** Registered budget (audit §6.3.A): compact artifact <= 50 MiB. */
export const COMPACT_BUDGET_BYTES = 50 * 1024 * 1024;

/** Registered budget for the explicit FULL-EVIDENCE profile (re-audit):
 * unique sealed archives + sidecars + receipts + superseded drill
 * archives + control state + raw trees of never-archived sequences. The
 * pre-remediation blanket upload of artifacts/m2-sequences/ shipped every
 * archived tree TWICE (raw and inside its ZIP); this profile ships each
 * payload exactly once — measured ~2.7 GiB for the complete keyless
 * rehearsal set (three sealed archives, the packaging-recovery drill's
 * preserved superseded archive, and the failure drill's raw tree). */
export const FULL_BUDGET_BYTES = 4 * 1024 * 1024 * 1024;

/** Exact basenames the compact profile may include, wherever they appear
 * under the scanned roots. */
const ALLOWED_BASENAMES = new Set([
  'm2-rehearsal-report.json',
  'sequence-manifest.json',
  'sequence-report.json',
  'sequence-report.md',
  'sequence-state.json',
  'sha256-inventory.json',
  'trace-manifest.json',
  'diagnostics-manifest.json',
  'failure-manifest.json',
  'failure.json',
  'failure-message.txt',
  'registration-provenance.json',
  'cost-acknowledgement.json',
]);

/** Allowed suffixes: digest sidecars and receipts attest the sealed
 * archives WITHOUT carrying their payload. */
const ALLOWED_SUFFIXES = ['.zip.sha256', '.zip.receipt.json'];

/** Hard denials — a compact set containing any of these is a gate
 * failure, never a silent skip (the test fixture pins this). */
const DENIED_SUFFIXES = ['.zip', '.png', '.webm', '.html'];

function isAllowed(name) {
  if (ALLOWED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return ALLOWED_BASENAMES.has(name);
}

function isDenied(name) {
  if (ALLOWED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return false;
  return DENIED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function walk(dir, found) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, found);
    else found.push({ path: full, bytes: stats.size });
  }
  return found;
}

/**
 * Pure selection over a file listing: returns the include set and any
 * allowlist/denylist conflicts. Exported (via direct import of this
 * module under vitest) so the exclusion property is unit-tested without a
 * filesystem fixture.
 */
export function selectCompactFiles(files) {
  const included = [];
  const conflicts = [];
  for (const file of files) {
    const name = file.path.split(/[\\/]/).pop() ?? file.path;
    const allowed = isAllowed(name);
    const denied = isDenied(name);
    if (allowed && denied) conflicts.push(file.path);
    else if (allowed) included.push(file);
  }
  return { included, conflicts };
}

export function buildCompactArtifact(repoRoot) {
  const roots = [
    join(repoRoot, 'artifacts', 'm2-sequences'),
    join(repoRoot, 'artifacts', 'm2-rehearsal'),
  ];
  const outDir = join(repoRoot, 'artifacts', 'ci-compact');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const listing = [];
  for (const root of roots) {
    if (existsSync(root)) walk(root, listing);
  }
  const { included, conflicts } = selectCompactFiles(listing);
  if (conflicts.length > 0) {
    throw new Error(`compact-artifact-denied-payload: ${conflicts.join(', ')}`);
  }

  let totalBytes = 0;
  const reportFiles = [];
  for (const file of included) {
    const rel = relative(repoRoot, file.path);
    const dest = join(outDir, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    copyFileSync(file.path, dest);
    totalBytes += file.bytes;
    reportFiles.push({ path: rel.split(sep).join('/'), bytes: file.bytes });
  }
  reportFiles.sort((a, b) => (a.path < b.path ? -1 : 1));

  const report = {
    profile: 'compact',
    budgetBytes: COMPACT_BUDGET_BYTES,
    totalBytes,
    withinBudget: totalBytes <= COMPACT_BUDGET_BYTES,
    fileCount: reportFiles.length,
    files: reportFiles,
    note:
      'Routine-CI compact proof only. Full sealed evidence ZIPs and Playwright ' +
      'traces upload exclusively through the explicit full-evidence profile; ' +
      'formal live evidence is retained locally with independent durable backup, ' +
      'never in expiring Actions artifacts.',
  };
  writeFileSync(
    join(outDir, 'artifact-size-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  return report;
}

/**
 * Pure full-profile selection over sequence descriptors (re-audit
 * findings on the full-evidence upload): each sequence contributes its
 * payload exactly ONCE. An archived sequence contributes the sealed ZIP +
 * digest sidecar + receipt (its raw tree is byte-identically contained in
 * the ZIP and is EXCLUDED); a never-archived sequence (e.g. the failure
 * drill) contributes its raw tree. Control state always rides along.
 */
export function selectFullPayloads(sequences) {
  const included = [];
  const dispositions = [];
  for (const sequence of sequences) {
    if (sequence.archivePath !== null) {
      included.push(...sequence.archiveFiles);
      dispositions.push({
        sequence: sequence.name,
        disposition: `archived — raw tree excluded (contained in ${sequence.archivePath})`,
      });
    } else {
      included.push(...sequence.treeFiles);
      dispositions.push({
        sequence: sequence.name,
        disposition: 'raw-tree — never archived, tree is the unique payload',
      });
    }
    included.push(...sequence.controlFiles);
  }
  return { included, dispositions };
}

/** State `archivePath` is recorded ABSOLUTE; superseded archives are bare
 * filenames sibling to the sequence root. Resolve both against the
 * sequences root / repo root. */
function readArchiveRecord(controlDir, sequencesRoot) {
  const statePath = join(controlDir, 'sequence-state.json');
  if (!existsSync(statePath)) return { archivePath: null, supersededNames: [] };
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const archivePath =
      typeof state.archivePath === 'string'
        ? isAbsolute(state.archivePath)
          ? state.archivePath
          : join(sequencesRoot, state.archivePath)
        : null;
    const superseded = Array.isArray(state.supersededArchives)
      ? state.supersededArchives
      : state.supersededArchives
        ? [state.supersededArchives]
        : [];
    return {
      archivePath,
      supersededNames: superseded
        .map((entry) => (typeof entry.archive === 'string' ? entry.archive : null))
        .filter(Boolean),
    };
  } catch {
    return { archivePath: null, supersededNames: [] };
  }
}

export function buildFullArtifact(repoRoot) {
  const sequencesRoot = join(repoRoot, 'artifacts', 'm2-sequences');
  const outDir = join(repoRoot, 'artifacts', 'ci-full');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const sequences = [];
  if (existsSync(sequencesRoot)) {
    for (const entry of readdirSync(sequencesRoot)) {
      const full = join(sequencesRoot, entry);
      if (!statSync(full).isDirectory() || entry.endsWith('.control')) continue;
      const controlDir = join(sequencesRoot, `${entry}.control`);
      const { archivePath, supersededNames } = readArchiveRecord(controlDir, sequencesRoot);
      const archiveFiles = [];
      const candidates = [];
      if (archivePath !== null) {
        candidates.push(archivePath, `${archivePath}.sha256`, `${archivePath}.receipt.json`);
      }
      // The packaging-recovery drill deliberately preserves its superseded
      // unreceipted archive beside the recovered receipted one — evidence,
      // not a duplicate (different bytes, own sidecar, no receipt).
      for (const name of supersededNames) {
        const superseded = join(sequencesRoot, name);
        candidates.push(superseded, `${superseded}.sha256`, `${superseded}.receipt.json`);
      }
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          archiveFiles.push({ path: candidate, bytes: statSync(candidate).size });
        }
      }
      const archived = archivePath !== null && existsSync(archivePath);
      sequences.push({
        name: entry,
        archivePath: archived ? relative(repoRoot, archivePath).split(sep).join('/') : null,
        archiveFiles,
        treeFiles: walk(full, []),
        controlFiles: existsSync(controlDir) ? walk(controlDir, []) : [],
      });
    }
  }
  const { included, dispositions } = selectFullPayloads(sequences);
  const rehearsalReport = join(repoRoot, 'artifacts', 'm2-rehearsal', 'm2-rehearsal-report.json');
  if (existsSync(rehearsalReport)) {
    included.push({ path: rehearsalReport, bytes: statSync(rehearsalReport).size });
  }

  let totalBytes = 0;
  const reportFiles = [];
  const seen = new Set();
  for (const file of included) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    const rel = relative(repoRoot, file.path);
    const dest = join(outDir, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    copyFileSync(file.path, dest);
    totalBytes += file.bytes;
    reportFiles.push({ path: rel.split(sep).join('/'), bytes: file.bytes });
  }
  reportFiles.sort((a, b) => (a.path < b.path ? -1 : 1));

  const report = {
    profile: 'full',
    budgetBytes: FULL_BUDGET_BYTES,
    totalBytes,
    withinBudget: totalBytes <= FULL_BUDGET_BYTES,
    fileCount: reportFiles.length,
    sequenceDispositions: dispositions,
    files: reportFiles,
    note:
      'Explicit full-evidence profile (failure diagnostics or manual dispatch): ' +
      'each sequence payload uploads exactly once — sealed ZIP + sidecar + ' +
      'receipt for archived sequences (raw tree contained in the ZIP), raw tree ' +
      'for never-archived sequences. Formal live evidence is retained locally ' +
      'with independent durable backup, never in expiring Actions artifacts.',
  };
  writeFileSync(
    join(outDir, 'artifact-size-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  return report;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split(sep).join('/'));

if (invokedDirectly || basename(process.argv[1] ?? '') === 'prepareCompactArtifact.mjs') {
  const profile = process.argv.includes('--profile')
    ? process.argv[process.argv.indexOf('--profile') + 1]
    : 'compact';
  if (profile !== 'compact' && profile !== 'full') {
    console.error(`unknown-artifact-profile: '${profile}' (compact | full)`);
    process.exit(1);
  }
  const report =
    profile === 'full' ? buildFullArtifact(process.cwd()) : buildCompactArtifact(process.cwd());
  console.log(
    `${profile} artifact: ${report.fileCount} file(s), ${report.totalBytes} bytes ` +
      `(budget ${report.budgetBytes})`,
  );
  if (!report.withinBudget) {
    console.error(`${profile}-artifact-over-budget: refusing upload`);
    process.exit(1);
  }
}
