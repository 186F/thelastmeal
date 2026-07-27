import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Build-secret scan (milestone 001, section 23.8): after `npm run build`,
 * the browser bundle must contain no path to the model secret and no model
 * SDK. Fails when `dist/` contains:
 *  - the canary test key used by the security suite,
 *  - `OPENAI_API_KEY` as a readable configuration path,
 *  - the OpenAI SDK / API host (the SDK must never be bundled client-side).
 */

export const CANARY_TEST_KEY = 'sk-test-thelastmeal-canary';

const FORBIDDEN = [
  { token: CANARY_TEST_KEY, code: 'dist-contains-canary-key' },
  { token: 'OPENAI_API_KEY', code: 'dist-references-openai-key' },
  { token: 'api.openai.com', code: 'dist-references-openai-host' },
];

export function scanDist(distDir: string): { code: string; file: string }[] {
  const findings: { code: string; file: string }[] = [];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs|cjs|html|css|map|json|txt)$/.test(entry)) files.push(full);
    }
  };
  walk(distDir);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const { token, code } of FORBIDDEN) {
      if (text.includes(token)) {
        findings.push({ code, file: relative(distDir, file).replaceAll('\\', '/') });
      }
    }
  }
  return findings;
}

const invokedDirectly = process.argv[1]?.replaceAll('\\', '/').endsWith('scanDist.ts') ?? false;
if (invokedDirectly) {
  const distDir = join(process.cwd(), 'dist');
  if (!existsSync(distDir)) {
    console.error('scan-dist: dist/ not found — run npm run build first');
    process.exit(1);
  }
  const findings = scanDist(distDir);
  for (const finding of findings) {
    console.error(`ERROR ${finding.code} [${finding.file}]`);
  }
  console.log(`Dist secret scan ${findings.length === 0 ? 'PASSED' : 'FAILED'}.`);
  process.exit(findings.length === 0 ? 0 : 1);
}
