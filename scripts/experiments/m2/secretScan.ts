import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CANARY_TEST_KEY, OPENROUTER_CANARY_TEST_KEY } from '../../security/scanDist';

/**
 * Evidence secret scan (M2 brief §19.4/§19.15): before a sequence is
 * packaged, every text artifact in the sequence root is scanned for
 * credential shapes and key references. This is defense in depth — the
 * gateway never logs its key and the orchestrator never reads it — so any
 * hit here is a hard packaging failure, never a warning.
 */

export const SECRET_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: 'evidence-contains-canary-key', pattern: new RegExp(CANARY_TEST_KEY) },
  {
    code: 'evidence-contains-openrouter-canary-key',
    pattern: new RegExp(OPENROUTER_CANARY_TEST_KEY),
  },
  // Live OpenRouter/OpenAI key shapes. sk-or-v1- keys are 64 hex chars; a
  // generic sk- long-token pattern catches OpenAI-style keys.
  { code: 'evidence-contains-openrouter-key-shape', pattern: /sk-or-v1-[0-9a-f]{16,}/ },
  { code: 'evidence-contains-openai-key-shape', pattern: /sk-[A-Za-z0-9_-]{24,}/ },
  { code: 'evidence-contains-authorization-header', pattern: /authorization["':\s]+bearer\s+\S+/i },
  { code: 'evidence-references-env-gateway', pattern: /\.env\.gateway/ },
  { code: 'evidence-references-openai-key-var', pattern: /OPENAI_API_KEY\s*=/ },
  { code: 'evidence-references-openrouter-key-var', pattern: /OPENROUTER_API_KEY\s*=/ },
];

const TEXT_EXTENSIONS = /\.(json|jsonl|md|txt|log|html|csv)$/;

export interface SecretFinding {
  code: string;
  file: string;
}

export function scanEvidenceTree(root: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (TEXT_EXTENSIONS.test(entry)) {
        const text = readFileSync(full, 'utf8');
        for (const { code, pattern } of SECRET_PATTERNS) {
          if (pattern.test(text)) {
            findings.push({ code, file: relative(root, full).replaceAll('\\', '/') });
          }
        }
      }
    }
  };
  walk(root);
  return findings;
}
