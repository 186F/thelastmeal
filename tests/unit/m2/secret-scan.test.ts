import { describe, expect, it, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanEvidenceTree } from '../../../scripts/experiments/m2/secretScan';

/**
 * Evidence secret scan (M2 brief §19.15): credential shapes, authorization
 * headers, and `.env.gateway` references anywhere in a sequence tree are
 * hard findings; clean evidence passes.
 */

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function treeWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'm2-secret-scan-'));
  dirs.push(root);
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return root;
}

describe('evidence secret scan', () => {
  it('passes clean evidence', () => {
    const root = treeWith({
      'sequence-state.json': '{"status":"completed"}',
      'attempt-a/heartbeat.jsonl': '{"tick":100}\n',
      'attempt-a/gateway/run-1/model-trace.jsonl': '{"providerId":"openrouter-mara-action-v1"}\n',
    });
    expect(scanEvidenceTree(root)).toEqual([]);
  });

  it('flags key shapes, canaries, authorization headers, and .env.gateway references', () => {
    const cases: Array<[string, string, string]> = [
      [
        'openrouter-key.json',
        `{"k":"sk-or-v1-${'a1b2'.repeat(16)}"}`,
        'evidence-contains-openrouter-key-shape',
      ],
      [
        'openai-key.log',
        'leaked sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
        'evidence-contains-openai-key-shape',
      ],
      ['canary.txt', 'sk-test-thelastmeal-canary', 'evidence-contains-canary-key'],
      ['auth.md', 'Authorization: Bearer abc123', 'evidence-contains-authorization-header'],
      ['env-ref.txt', 'copied from .env.gateway', 'evidence-references-env-gateway'],
      ['env-var.log', 'OPENROUTER_API_KEY=abc', 'evidence-references-openrouter-key-var'],
    ];
    for (const [name, content, expectedCode] of cases) {
      const root = treeWith({ [name]: content });
      const codes = scanEvidenceTree(root).map((finding) => finding.code);
      expect(codes, name).toContain(expectedCode);
    }
  });

  it('ignores binary extensions but scans jsonl and logs', () => {
    const root = treeWith({
      'evidence.bin.png': 'sk-or-v1-not-scanned-binary-extension-0123456789abcdef',
      'notes.log': 'harmless',
    });
    expect(scanEvidenceTree(root)).toEqual([]);
  });
});
