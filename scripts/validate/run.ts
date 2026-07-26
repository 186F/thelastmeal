import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { validateExperimentData } from '../../src/sim/validation/validateData';
import type { ValidationIssue } from '../../src/shared/validation';

/**
 * `npm run validate` — static configuration and architecture validation.
 *
 * Layer 1: the shared experiment-data rules (also used by the in-browser
 * Validate Configuration control).
 * Layer 2: Node-only architecture checks — the pure simulation core must not
 * import Three.js, DOM, UI, worker, or app modules, nor use wall-clock or
 * Math.random sources; and package.json must expose every required script.
 *
 * Exits nonzero on any error.
 */

const issues: ValidationIssue[] = [];
const err = (code: string, message: string, where: string | null = null): void => {
  issues.push({ severity: 'error', code, message, where });
};

// --- Layer 1: shared experiment-data validation ------------------------------

const dataResult = validateExperimentData();
issues.push(...dataResult.issues);

// --- Layer 2a: architecture import scan over the pure core -------------------

const projectRoot = process.cwd();
const scanRoots = ['src/sim', 'src/shared'];

const forbiddenImports = [
  { pattern: /from\s+['"]three['"]/, code: 'sim-imports-three' },
  { pattern: /from\s+['"]three\//, code: 'sim-imports-three' },
  { pattern: /from\s+['"][^'"]*\/(render|ui|app|worker)\//, code: 'sim-imports-presentation' },
  { pattern: /from\s+['"]vite/, code: 'sim-imports-vite' },
];
const forbiddenTokens = [
  { pattern: /\bMath\.random\s*\(/, code: 'sim-uses-math-random' },
  { pattern: /\bDate\.now\s*\(/, code: 'sim-uses-wall-clock' },
  { pattern: /\bnew\s+Date\s*\(/, code: 'sim-uses-wall-clock' },
  { pattern: /\bperformance\.now\s*\(/, code: 'sim-uses-wall-clock' },
  { pattern: /\brequestAnimationFrame\b/, code: 'sim-uses-frame-timing' },
  { pattern: /\bsetTimeout\s*\(/, code: 'sim-uses-timers' },
  { pattern: /\bsetInterval\s*\(/, code: 'sim-uses-timers' },
  { pattern: /\bdocument\s*\./, code: 'sim-uses-dom' },
  { pattern: /\bwindow\s*\./, code: 'sim-uses-dom' },
  { pattern: /\blocalStorage\b/, code: 'sim-uses-browser-storage' },
  { pattern: /\bindexedDB\b/, code: 'sim-uses-browser-storage' },
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
}

for (const root of scanRoots) {
  const files: string[] = [];
  walk(join(projectRoot, root), files);
  for (const file of files) {
    const rel = relative(projectRoot, file).replaceAll('\\', '/');
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const { pattern, code } of forbiddenImports) {
      if (pattern.test(source)) {
        err(code, `Forbidden import in pure core module`, rel);
      }
    }
    for (const { pattern, code } of forbiddenTokens) {
      if (pattern.test(source)) {
        err(code, `Forbidden platform/nondeterminism token in pure core module`, rel);
      }
    }
  }
}

// --- Layer 2b: required npm scripts -------------------------------------------

const REQUIRED_SCRIPTS = [
  'dev',
  'build',
  'preview',
  'typecheck',
  'lint',
  'test',
  'test:run',
  'test:coverage',
  'test:e2e',
  'test:e2e:install',
  'validate',
  'batch',
];
try {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  for (const script of REQUIRED_SCRIPTS) {
    if (!pkg.scripts || !pkg.scripts[script]) {
      err('missing-npm-script', `package.json is missing required script "${script}"`);
    }
  }
} catch (e) {
  err('unreadable-package-json', (e as Error).message);
}

// --- Report ---------------------------------------------------------------------

const errors = issues.filter((i) => i.severity === 'error');
const warnings = issues.filter((i) => i.severity === 'warning');
for (const issue of issues) {
  const location = issue.where ? ` [${issue.where}]` : '';
  const line = `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}${location}`;
  if (issue.severity === 'error') console.error(line);
  else console.warn(line);
}
console.log(
  `\nValidation ${errors.length === 0 ? 'PASSED' : 'FAILED'}: ${errors.length} error(s), ${warnings.length} warning(s).`,
);
process.exit(errors.length === 0 ? 0 : 1);
