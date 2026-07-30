import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { scanEvidenceTree, type SecretFinding } from './secretScan';

/**
 * Portable evidence packaging (M2 brief §19.4): secret scan → SHA256
 * inventory → portable ZIP. The inventory covers every file in the
 * sequence root (except the zip itself); the zip is produced with the
 * platform archiver (PowerShell Compress-Archive on Windows, `zip -r`
 * elsewhere) exactly like the sealed Milestone 1 archives. Packaging
 * REFUSES to run when the secret scan finds anything.
 */

export interface PackageResult {
  inventoryPath: string;
  fileCount: number;
  zipPath: string;
  zipSha256: string;
  secretFindings: SecretFinding[];
}

function walkFiles(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, rel))) {
    const relPath = rel === '' ? entry : `${rel}/${entry}`;
    if (statSync(join(root, relPath)).isDirectory()) out.push(...walkFiles(root, relPath));
    else out.push(relPath);
  }
  return out;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function zipDirectory(root: string, zipPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn(
            'powershell',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `Compress-Archive -Path '${root}\\*' -DestinationPath '${zipPath}' -Force`,
            ],
            { stdio: 'ignore', windowsHide: true },
          )
        : spawn('zip', ['-r', '-q', zipPath, '.'], { cwd: root, stdio: 'ignore' });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`zip-failed: exit ${String(code)}`)),
    );
    child.on('error', (error) => reject(error));
  });
}

export async function packageSequence(
  sequenceRoot: string,
  zipPath: string,
): Promise<PackageResult> {
  const secretFindings = scanEvidenceTree(sequenceRoot);
  if (secretFindings.length > 0) {
    throw new Error(
      `evidence-secret-scan-failed: ${secretFindings
        .map((finding) => `${finding.code}@${finding.file}`)
        .join('; ')}`,
    );
  }
  const files = walkFiles(sequenceRoot)
    .filter((name) => name !== 'sha256-inventory.json')
    .sort()
    .map((name) => ({ name, sha256: sha256(join(sequenceRoot, name)) }));
  const inventoryPath = join(sequenceRoot, 'sha256-inventory.json');
  writeFileSync(inventoryPath, `${JSON.stringify({ files }, null, 2)}\n`, 'utf8');
  await zipDirectory(sequenceRoot, zipPath);
  return {
    inventoryPath,
    fileCount: files.length,
    zipPath,
    zipSha256: sha256(zipPath),
    secretFindings: [],
  };
}
