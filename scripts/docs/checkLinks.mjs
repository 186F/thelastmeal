// Broken-link check for local Markdown links (documentation reorganization
// migration rule 5). Scans every tracked Markdown file for inline links and
// reference definitions whose targets are relative paths, resolves each
// against the containing file, and fails when a target does not exist.
// External (http/https/mailto) and pure-anchor links are out of scope.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import process from 'node:process';
import console from 'node:console';

const repoRoot = resolve(process.cwd());
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'artifacts',
  'coverage',
  'playwright-report',
  'test-results',
]);

function markdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) found.push(...markdownFiles(full));
    } else if (entry.toLowerCase().endsWith('.md')) {
      found.push(full);
    }
  }
  return found;
}

const INLINE_LINK = /\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g;
const REFERENCE_DEF = /^\[[^\]]+\]:\s+(\S+)/gm;

function localTargets(text) {
  const targets = [];
  for (const pattern of [INLINE_LINK, REFERENCE_DEF]) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1];
      if (/^(https?:|mailto:|#)/i.test(raw)) continue;
      const withoutAnchor = raw.split('#')[0];
      if (withoutAnchor.length === 0) continue;
      targets.push(decodeURIComponent(withoutAnchor));
    }
  }
  return targets;
}

const failures = [];
for (const file of markdownFiles(repoRoot)) {
  const text = readFileSync(file, 'utf8');
  for (const target of localTargets(text)) {
    const resolved = resolve(dirname(file), target);
    if (!existsSync(resolved)) {
      const shownFile = file
        .slice(repoRoot.length + 1)
        .split(sep)
        .join('/');
      failures.push(`${shownFile} -> ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Broken local Markdown links (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('All local Markdown links resolve.');
