import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { scanEvidenceTree, type SecretFinding } from './secretScan';
import { helperEnv } from './childEnv';

/**
 * Portable evidence packaging (M2 brief §19.4; Phase 3 audit finding 7;
 * re-audit findings 1 and 7):
 *
 *   secret scan (including nested trace archives, time-bounded)
 *   → SHA256 inventory (created once; an existing inventory is VERIFIED
 *     against the tree and reused — a completed root is immutable)
 *   → FRESH archive staged as a dot-tmp SIBLING of the destination (same
 *     volume, so the commit is a true atomic rename — no copy fallback)
 *   → extraction verification against the inventory (portable entry paths,
 *     no stale/extra entries, byte-exact content)
 *   → fsync, then atomic rename to a destination that MUST NOT already
 *     exist (archive names are versioned/immutable; a prior archive is
 *     never deleted or overwritten)
 *   → caller's pre-receipt hook (the orchestrator's post-package freeze
 *     check)
 *   → sibling receipt (`<zip>.sha256` + `<zip>.receipt.json`) written ONLY
 *     after the final path hashes correctly — the authoritative post-
 *     archive seal.
 *
 * The writer lock and mutable state live OUTSIDE the packaged root;
 * symlinks are refused; transient files are excluded. The zip/unzip/tar
 * helpers run under the nonsecret helper environment (re-audit finding 6).
 * Packaging failure is a hard failure — the caller records the sequence as
 * failed, never completed.
 */

export const PACKAGING_VERSION = 'm2-evidence-packaging-2.0.0';

export const INVENTORY_FILE_NAME = 'sha256-inventory.json';

const EXCLUDED_NAMES = new Set(['sequence.lock']);
const EXCLUDED_SUFFIXES = ['.tmp'];

/** Default per-nested-archive scan bound (re-audit §13.4). */
const NESTED_SCAN_TIMEOUT_MS = 300_000;
const ARCHIVE_HELPER_TIMEOUT_MS = 900_000;

export interface PackageReceiptMeta {
  sequenceId: string;
  planSha256: string;
  repositorySha: string;
  studyPlanSha256: string | null;
}

export interface PackageOptions {
  /** Runs after the archive is committed and verified at its final path,
   * BEFORE the receipt is written (re-audit finding 4: the post-package
   * freeze check). A throw aborts the receipt — the caller records
   * failure; the uncommitted receipt never exists. */
  beforeReceipt?: () => void;
  /** Provenance callback for helper spawns (control-root packaging log). */
  onHelper?: (command: string, args: readonly string[]) => void;
  /** Hard cap on the produced archive size (re-audit §13.4). */
  maxArchiveBytes?: number;
}

export interface PackageResult {
  inventoryPath: string;
  inventoryAggregateSha256: string;
  fileCount: number;
  zipPath: string;
  zipSha256: string;
  receiptPath: string;
  secretFindings: SecretFinding[];
}

export interface InventoryFile {
  files: { name: string; sha256: string }[];
  aggregateSha256: string;
}

function walkFiles(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, rel))) {
    const relPath = rel === '' ? entry : `${rel}/${entry}`;
    const stats = lstatSync(join(root, relPath));
    if (stats.isSymbolicLink()) {
      throw new Error(`evidence-tree-contains-symlink: ${relPath}`);
    }
    if (stats.isDirectory()) out.push(...walkFiles(root, relPath));
    else if (
      !EXCLUDED_NAMES.has(entry) &&
      !EXCLUDED_SUFFIXES.some((suffix) => entry.endsWith(suffix))
    ) {
      out.push(relPath);
    }
  }
  return out;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; onHelper?: PackageOptions['onHelper'] },
): Promise<void> {
  options.onHelper?.(command, args);
  return new Promise((resolve, reject) => {
    // Helpers receive the nonsecret platform environment ONLY (re-audit
    // finding 6): an exported key never reaches tar/zip/unzip.
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: 'ignore',
      windowsHide: true,
      env: helperEnv(process.env),
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command}-timeout: exceeded ${options.timeoutMs ?? 0}ms`));
    }, options.timeoutMs ?? ARCHIVE_HELPER_TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command}-failed: exit ${String(code)} (${args.join(' ')})`));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Creates a zip with PORTABLE forward-slash entries. Windows' bundled
 * bsdtar writes zip archives with forward slashes; POSIX uses `zip -r`
 * against a fresh path (an existing archive is never updated in place). */
async function createZip(
  root: string,
  zipPath: string,
  onHelper?: PackageOptions['onHelper'],
): Promise<void> {
  if (process.platform === 'win32') {
    await run('tar', ['-a', '-c', '-f', zipPath, '-C', root, '.'], { onHelper });
  } else {
    await run('zip', ['-r', '-q', zipPath, '.'], { cwd: root, onHelper });
  }
}

async function extractZip(
  zipPath: string,
  destDir: string,
  onHelper?: PackageOptions['onHelper'],
): Promise<void> {
  if (process.platform === 'win32') {
    await run('tar', ['-x', '-f', zipPath, '-C', destDir], { onHelper });
  } else {
    await run('unzip', ['-q', zipPath, '-d', destDir], { onHelper });
  }
}

/** Nested-archive scan (audit finding 7.5): Playwright traces are zips full
 * of text; each nested zip in the tree is extracted to a temp dir and its
 * text entries run through the same secret scanner. Each extraction is
 * time-bounded (re-audit §13.4). */
async function scanNestedArchives(
  root: string,
  files: readonly string[],
  onHelper?: PackageOptions['onHelper'],
): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];
  for (const file of files) {
    if (!file.endsWith('.zip')) continue;
    const scratch = mkdtempSync(join(tmpdir(), 'm2-nested-scan-'));
    try {
      await run(
        process.platform === 'win32' ? 'tar' : 'unzip',
        process.platform === 'win32'
          ? ['-x', '-f', join(root, file), '-C', scratch]
          : ['-q', join(root, file), '-d', scratch],
        { timeoutMs: NESTED_SCAN_TIMEOUT_MS, onHelper },
      );
      for (const finding of scanEvidenceTree(scratch)) {
        findings.push({ code: finding.code, file: `${file}!${finding.file}` });
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return findings;
}

export function readInventory(sequenceRoot: string): InventoryFile | null {
  const path = join(sequenceRoot, INVENTORY_FILE_NAME);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as InventoryFile;
}

/**
 * Verifies a tree byte-for-byte against an inventory: exact file set
 * (plus the inventory file itself when present in the tree) and exact
 * content hashes. Used for the post-completion immutability check, the
 * completed-resume verification, and archive extraction verification
 * (re-audit findings 1 and 5).
 */
export function verifyTreeAgainstInventory(
  root: string,
  inventory: InventoryFile,
  context: string,
): void {
  const actual = walkFiles(root).sort();
  for (const name of actual) {
    if (name.includes('\\') || name.includes('..')) {
      throw new Error(`archive-entry-not-portable: ${name} (${context})`);
    }
  }
  const hasInventoryFile = actual.includes(INVENTORY_FILE_NAME);
  const expected = [
    ...inventory.files.map((file) => file.name),
    ...(hasInventoryFile ? [INVENTORY_FILE_NAME] : []),
  ].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((name) => !actualSet.has(name)).slice(0, 3);
    const added = actual.filter((name) => !expectedSet.has(name)).slice(0, 3);
    throw new Error(
      `inventory-tree-mismatch (${context}): ${actual.length} file(s) vs inventory ` +
        `${expected.length}; missing=[${missing.join(', ')}] added=[${added.join(', ')}]`,
    );
  }
  for (const file of inventory.files) {
    if (sha256File(join(root, file.name)) !== file.sha256) {
      throw new Error(`inventory-byte-mismatch (${context}): ${file.name}`);
    }
  }
}

/** Next free versioned archive path: `<sequenceId>-evidence-NNN.zip` in
 * `dir` (re-audit finding 7: formal archive names are immutable/versioned,
 * never overwritten). */
export function nextArchivePath(dir: string, sequenceId: string): string {
  for (let index = 1; index < 1000; index += 1) {
    const candidate = join(dir, `${sequenceId}-evidence-${String(index).padStart(3, '0')}.zip`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`archive-index-exhausted: ${dir}`);
}

/** Staged sibling path on the DESTINATION volume, excluded from any
 * evidence walk by its .tmp suffix. */
export function stagedArchivePath(zipPath: string): string {
  return join(
    dirname(zipPath),
    `.${basename(zipPath)}.${process.pid}-${Math.floor(Math.random() * 1e9)}.tmp`,
  );
}

export async function packageSequence(
  sequenceRoot: string,
  zipPath: string,
  receipt: PackageReceiptMeta,
  options: PackageOptions = {},
): Promise<PackageResult> {
  // 0. Versioned destinations are immutable: never delete or overwrite.
  if (existsSync(zipPath)) {
    throw new Error(
      `archive-destination-exists: ${zipPath} — archives are versioned and immutable; ` +
        'package to the next index instead',
    );
  }

  // 1. Secret scan — the flat tree AND every nested archive's text entries.
  const flatFindings = scanEvidenceTree(sequenceRoot);
  const files = walkFiles(sequenceRoot).sort();
  const nestedFindings = await scanNestedArchives(sequenceRoot, files, options.onHelper);
  const secretFindings = [...flatFindings, ...nestedFindings];
  if (secretFindings.length > 0) {
    throw new Error(
      `evidence-secret-scan-failed: ${secretFindings
        .map((finding) => `${finding.code}@${finding.file}`)
        .join('; ')}`,
    );
  }

  // 2. Inventory: created exactly once. Repackaging a root that already
  // carries an inventory VERIFIES the tree against it instead of writing —
  // a completed evidence root is immutable (re-audit finding 1).
  const inventoryPath = join(sequenceRoot, INVENTORY_FILE_NAME);
  let inventory = readInventory(sequenceRoot);
  if (inventory) {
    verifyTreeAgainstInventory(sequenceRoot, inventory, 'repackage-existing-inventory');
  } else {
    const inventoried = files
      .filter((name) => name !== INVENTORY_FILE_NAME)
      .map((name) => ({ name, sha256: sha256File(join(sequenceRoot, name)) }));
    const aggregateSha256 = createHash('sha256')
      .update(inventoried.map((file) => `${file.name}:${file.sha256}`).join('\n'))
      .digest('hex');
    inventory = { files: inventoried, aggregateSha256 };
    writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  }

  // 3. Fresh archive staged as a SIBLING on the destination volume — the
  // later commit is a same-volume atomic rename, never a copy (re-audit
  // finding 7).
  const stagedZip = stagedArchivePath(zipPath);
  try {
    await createZip(sequenceRoot, stagedZip, options.onHelper);

    if (options.maxArchiveBytes !== undefined) {
      const size = statSync(stagedZip).size;
      if (size > options.maxArchiveBytes) {
        throw new Error(`archive-size-exceeds-budget: ${size} bytes > ${options.maxArchiveBytes}`);
      }
    }

    // 4. Extraction verification: portable paths, exact file set, exact
    // bytes. A stale entry, a backslash path, or a traversal cannot survive.
    const verifyDir = mkdtempSync(join(tmpdir(), 'm2-package-verify-'));
    try {
      await extractZip(stagedZip, verifyDir, options.onHelper);
      verifyTreeAgainstInventory(verifyDir, inventory, 'staged-archive-extraction');
    } finally {
      rmSync(verifyDir, { recursive: true, force: true });
    }

    // 5. Durability + atomic commit: fsync the staged bytes, then rename to
    // the fresh destination. No prior archive existed at the destination
    // (checked above) and none is ever deleted.
    const stagedSha256 = sha256File(stagedZip);
    const fd = openSync(stagedZip, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(stagedZip, zipPath);

    // 6. The final path must hash exactly as staged before any receipt
    // exists; the caller's pre-receipt hook (post-package freeze check)
    // runs first — a throw leaves the archive committed but UNRECEIPTED.
    const zipSha256 = sha256File(zipPath);
    if (zipSha256 !== stagedSha256) {
      throw new Error(`archive-commit-hash-mismatch: ${zipPath}`);
    }
    options.beforeReceipt?.();
    writeFileSync(`${zipPath}.sha256`, `${zipSha256}  ${basename(zipPath)}\n`, 'utf8');
    const receiptPath = `${zipPath}.receipt.json`;
    writeFileSync(
      receiptPath,
      `${JSON.stringify(
        {
          sequenceId: receipt.sequenceId,
          planSha256: receipt.planSha256,
          repositorySha: receipt.repositorySha,
          studyPlanSha256: receipt.studyPlanSha256,
          archive: basename(zipPath),
          archiveSha256: zipSha256,
          inventoryAggregateSha256: inventory.aggregateSha256,
          fileCount: inventory.files.length,
          packagingVersion: PACKAGING_VERSION,
          createdAtUtc: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    return {
      inventoryPath,
      inventoryAggregateSha256: inventory.aggregateSha256,
      fileCount: inventory.files.length,
      zipPath,
      zipSha256,
      receiptPath,
      secretFindings: [],
    };
  } finally {
    rmSync(stagedZip, { force: true });
  }
}

/**
 * Completed-archive verification (re-audit finding 1, §5.3): the archive
 * exists, hashes as recorded, its sidecar and receipt agree on every
 * identity field, and its extracted content verifies byte-for-byte against
 * the inventory. Read-only; typed refusals.
 */
export async function verifyCompletedArchive(args: {
  zipPath: string;
  expectedSha256: string;
  inventory: InventoryFile;
  receiptMeta: PackageReceiptMeta;
}): Promise<void> {
  const { zipPath, expectedSha256 } = args;
  if (!existsSync(zipPath)) {
    throw new Error(`completed-resume-verification-failed: archive missing (${zipPath})`);
  }
  const actualSha = sha256File(zipPath);
  if (actualSha !== expectedSha256) {
    throw new Error(
      `completed-resume-verification-failed: archive sha ${actualSha} != recorded ${expectedSha256}`,
    );
  }
  const sidecarPath = `${zipPath}.sha256`;
  if (!existsSync(sidecarPath) || !readFileSync(sidecarPath, 'utf8').startsWith(expectedSha256)) {
    throw new Error(
      `completed-resume-verification-failed: .sha256 sidecar missing or disagrees (${sidecarPath})`,
    );
  }
  const receiptPath = `${zipPath}.receipt.json`;
  if (!existsSync(receiptPath)) {
    throw new Error(`completed-resume-verification-failed: receipt missing (${receiptPath})`);
  }
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
  const expectations: Array<[string, unknown]> = [
    ['sequenceId', args.receiptMeta.sequenceId],
    ['planSha256', args.receiptMeta.planSha256],
    ['repositorySha', args.receiptMeta.repositorySha],
    ['studyPlanSha256', args.receiptMeta.studyPlanSha256],
    ['archiveSha256', expectedSha256],
    ['inventoryAggregateSha256', args.inventory.aggregateSha256],
    ['packagingVersion', PACKAGING_VERSION],
  ];
  for (const [field, wanted] of expectations) {
    if (receipt[field] !== wanted) {
      throw new Error(
        `completed-resume-verification-failed: receipt ${field} is ` +
          `'${String(receipt[field])}', expected '${String(wanted)}'`,
      );
    }
  }
  const verifyDir = mkdtempSync(join(tmpdir(), 'm2-resume-verify-'));
  try {
    await extractZip(zipPath, verifyDir);
    verifyTreeAgainstInventory(verifyDir, args.inventory, 'completed-resume-extraction');
  } finally {
    rmSync(verifyDir, { recursive: true, force: true });
  }
}
