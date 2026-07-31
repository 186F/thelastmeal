import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { scanEvidenceTree, type SecretFinding } from './secretScan';

/**
 * Portable evidence packaging (M2 brief §19.4; Phase 3 audit finding 7):
 *
 *   secret scan (including nested trace archives)
 *   → SHA256 inventory
 *   → FRESH archive in a temporary path (never an in-place ZIP update)
 *   → extraction verification against the inventory (portable entry paths,
 *     no stale/extra entries, byte-exact content)
 *   → atomic rename into place
 *   → sibling receipt (`<zip>.sha256` + `<zip>.receipt.json`)
 *
 * The writer lock lives OUTSIDE the packaged root; symlinks are refused;
 * transient files are excluded. Packaging failure is a hard failure — the
 * caller records the sequence as failed, never completed.
 */

export const PACKAGING_VERSION = 'm2-evidence-packaging-1.1.0';

const EXCLUDED_NAMES = new Set(['sequence.lock']);
const EXCLUDED_SUFFIXES = ['.tmp'];

export interface PackageReceiptMeta {
  sequenceId: string;
  planSha256: string;
  repositorySha: string;
}

export interface PackageResult {
  inventoryPath: string;
  fileCount: number;
  zipPath: string;
  zipSha256: string;
  receiptPath: string;
  secretFindings: SecretFinding[];
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

function run(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'ignore', windowsHide: true });
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command}-failed: exit ${String(code)} (${args.join(' ')})`)),
    );
    child.on('error', (error) => reject(error));
  });
}

/** Creates a zip with PORTABLE forward-slash entries. Windows' bundled
 * bsdtar writes zip archives with forward slashes; POSIX uses `zip -r`
 * against a fresh path (an existing archive is never updated in place). */
async function createZip(root: string, zipPath: string): Promise<void> {
  if (process.platform === 'win32') {
    await run('tar', ['-a', '-c', '-f', zipPath, '-C', root, '.']);
  } else {
    await run('zip', ['-r', '-q', zipPath, '.'], root);
  }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  if (process.platform === 'win32') {
    await run('tar', ['-x', '-f', zipPath, '-C', destDir]);
  } else {
    await run('unzip', ['-q', zipPath, '-d', destDir]);
  }
}

/** Nested-archive scan (audit finding 7.5): Playwright traces are zips full
 * of text; each nested zip in the tree is extracted to a temp dir and its
 * text entries run through the same secret scanner. */
async function scanNestedArchives(
  root: string,
  files: readonly string[],
): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];
  for (const file of files) {
    if (!file.endsWith('.zip')) continue;
    const scratch = mkdtempSync(join(tmpdir(), 'm2-nested-scan-'));
    try {
      await extractZip(join(root, file), scratch);
      for (const finding of scanEvidenceTree(scratch)) {
        findings.push({ code: finding.code, file: `${file}!${finding.file}` });
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return findings;
}

export async function packageSequence(
  sequenceRoot: string,
  zipPath: string,
  receipt: PackageReceiptMeta,
): Promise<PackageResult> {
  // 1. Secret scan — the flat tree AND every nested archive's text entries.
  const flatFindings = scanEvidenceTree(sequenceRoot);
  const files = walkFiles(sequenceRoot).sort();
  const nestedFindings = await scanNestedArchives(sequenceRoot, files);
  const secretFindings = [...flatFindings, ...nestedFindings];
  if (secretFindings.length > 0) {
    throw new Error(
      `evidence-secret-scan-failed: ${secretFindings
        .map((finding) => `${finding.code}@${finding.file}`)
        .join('; ')}`,
    );
  }

  // 2. Inventory over everything except the inventory itself.
  const inventoried = files
    .filter((name) => name !== 'sha256-inventory.json')
    .map((name) => ({ name, sha256: sha256File(join(sequenceRoot, name)) }));
  const inventoryAggregate = createHash('sha256')
    .update(inventoried.map((file) => `${file.name}:${file.sha256}`).join('\n'))
    .digest('hex');
  const inventoryPath = join(sequenceRoot, 'sha256-inventory.json');
  writeFileSync(
    inventoryPath,
    `${JSON.stringify({ files: inventoried, aggregateSha256: inventoryAggregate }, null, 2)}\n`,
    'utf8',
  );

  // 3. Fresh archive in a temporary path — never an in-place update.
  const staging = mkdtempSync(join(tmpdir(), 'm2-package-'));
  const stagedZip = join(staging, basename(zipPath));
  try {
    await createZip(sequenceRoot, stagedZip);

    // 4. Extraction verification: portable paths, exact file set, exact
    // bytes. A stale entry, a backslash path, or a traversal cannot survive.
    const verifyDir = mkdtempSync(join(tmpdir(), 'm2-package-verify-'));
    try {
      await extractZip(stagedZip, verifyDir);
      const extracted = walkFiles(verifyDir).sort();
      for (const name of extracted) {
        if (name.includes('\\') || name.includes('..')) {
          throw new Error(`archive-entry-not-portable: ${name}`);
        }
      }
      const expected = [...inventoried.map((file) => file.name), 'sha256-inventory.json'].sort();
      if (JSON.stringify(extracted) !== JSON.stringify(expected)) {
        throw new Error(
          `archive-content-mismatch: archive holds ${extracted.length} file(s), inventory expects ${expected.length}`,
        );
      }
      for (const file of inventoried) {
        if (sha256File(join(verifyDir, file.name)) !== file.sha256) {
          throw new Error(`archive-byte-mismatch: ${file.name}`);
        }
      }
    } finally {
      rmSync(verifyDir, { recursive: true, force: true });
    }

    // 5. Atomic move into place + sibling receipt.
    rmSync(zipPath, { force: true });
    try {
      renameSync(stagedZip, zipPath);
    } catch {
      // Cross-volume temp dirs cannot rename: fall back to copy-then-verify.
      writeFileSync(zipPath, readFileSync(stagedZip));
    }
    const zipSha256 = sha256File(zipPath);
    writeFileSync(`${zipPath}.sha256`, `${zipSha256}  ${basename(zipPath)}\n`, 'utf8');
    const receiptPath = `${zipPath}.receipt.json`;
    writeFileSync(
      receiptPath,
      `${JSON.stringify(
        {
          sequenceId: receipt.sequenceId,
          planSha256: receipt.planSha256,
          repositorySha: receipt.repositorySha,
          archive: basename(zipPath),
          archiveSha256: zipSha256,
          inventoryAggregateSha256: inventoryAggregate,
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
      fileCount: inventoried.length,
      zipPath,
      zipSha256,
      receiptPath,
      secretFindings: [],
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
