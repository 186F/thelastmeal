import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  INVENTORY_FILE_NAME,
  readInventory,
  validateInventory,
} from '../../../scripts/experiments/m2/packageEvidence';

/**
 * Strict inventory authentication (final audit blocker 2): the shared
 * validator schema-checks the inventory, enforces entry hygiene (relative
 * forward-slash paths, no traversal, no duplicates, canonical order,
 * well-formed SHA-256), and RECOMPUTES the aggregate from the exact
 * entries — the aggregate field is cryptographically bound to the entry
 * list, so an aggregate-preserving entry rewrite cannot self-certify.
 */

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function validInventory(): { files: { name: string; sha256: string }[]; aggregateSha256: string } {
  const files = [
    { name: 'attempt-a-e1/behavior-fingerprint.json', sha256: 'a'.repeat(64) },
    { name: 'plan.archived.json', sha256: 'b'.repeat(64) },
    { name: 'vite.log', sha256: 'c'.repeat(64) },
  ];
  return {
    files,
    aggregateSha256: sha256(files.map((file) => `${file.name}:${file.sha256}`).join('\n')),
  };
}

describe('validateInventory (final audit blocker 2 §4.3)', () => {
  it('a valid canonical inventory passes and returns the typed object', () => {
    const inventory = validInventory();
    const validated = validateInventory(inventory, 'control-case');
    expect(validated.aggregateSha256).toBe(inventory.aggregateSha256);
    expect(validated.files).toEqual(inventory.files);
  });

  it('the AGGREGATE is recomputed from the entries: an entry-hash rewrite with an unchanged aggregate refuses', () => {
    // The §4.2 bypass: alter one entry's hash (as an attacker covering a
    // mutated evidence file would) while leaving aggregateSha256 alone.
    const inventory = validInventory();
    inventory.files[2]!.sha256 = 'd'.repeat(64);
    expect(() => validateInventory(inventory, 'entry-rewrite')).toThrow(
      /inventory-invalid \(entry-rewrite\): aggregateSha256 does not recompute/,
    );
  });

  const malformedMatrix: Array<
    [string, (inv: ReturnType<typeof validInventory>) => unknown, RegExp]
  > = [
    [
      'duplicate path',
      (inv) => {
        inv.files.push({ ...inv.files[2]! });
        return inv;
      },
      /duplicate entry paths|not in canonical sorted order/,
    ],
    [
      'unsorted / noncanonical entry order',
      (inv) => {
        inv.files.reverse();
        return inv;
      },
      /not in canonical sorted order/,
    ],
    [
      'absolute POSIX path',
      (inv) => {
        inv.files[0]!.name = '/etc/passwd';
        return inv;
      },
      /entry path is absolute/,
    ],
    [
      'absolute Windows drive path',
      (inv) => {
        inv.files[0]!.name = 'C:/evil';
        return inv;
      },
      /entry path is absolute/,
    ],
    [
      'parent traversal',
      (inv) => {
        inv.files[0]!.name = '../outside.txt';
        return inv;
      },
      /not normalized/,
    ],
    [
      'dot segment',
      (inv) => {
        inv.files[0]!.name = './a.txt';
        return inv;
      },
      /not normalized/,
    ],
    [
      'backslash path',
      (inv) => {
        inv.files[0]!.name = 'attempt-a-e1\\file.json';
        return inv;
      },
      /backslashes/,
    ],
    [
      'malformed entry sha256',
      (inv) => {
        inv.files[0]!.sha256 = 'NOT-A-SHA';
        return inv;
      },
      /entry sha256 malformed/,
    ],
    [
      'malformed aggregate sha256',
      (inv) => {
        inv.aggregateSha256 = 'xyz';
        return inv;
      },
      /aggregateSha256 is not a well-formed/,
    ],
    ['extra top-level key', (inv) => ({ ...inv, planted: true }), /unexpected shape/],
    [
      'extra entry key',
      (inv) => {
        (inv.files[0] as Record<string, unknown>).extra = 1;
        return inv;
      },
      /entry has unexpected shape/,
    ],
    ['not an object', () => null, /not a JSON object/],
    ['array root', () => [], /not a JSON object/],
    [
      'empty file list',
      (inv) => {
        inv.files = [];
        return inv;
      },
      /nonempty array/,
    ],
  ];

  for (const [name, mutate, pattern] of malformedMatrix) {
    it(`${name} refuses with a typed inventory-invalid`, () => {
      const mutated = mutate(validInventory());
      expect(() => validateInventory(mutated, 'matrix')).toThrow(/inventory-invalid \(matrix\)/);
      expect(() => validateInventory(mutated, 'matrix')).toThrow(pattern);
    });
  }
});

describe('readInventory authenticates on read (§4.3: every consumer flows through the validator)', () => {
  it('a tampered on-disk inventory refuses at read time; a valid one round-trips', () => {
    const root = mkdtempSync(join(tmpdir(), 'm2-inventory-read-'));
    dirs.push(root);
    const inventory = validInventory();
    writeFileSync(
      join(root, INVENTORY_FILE_NAME),
      `${JSON.stringify(inventory, null, 2)}\n`,
      'utf8',
    );
    expect(readInventory(root)).toEqual(inventory);

    // Entry-hash rewrite with unchanged aggregate — the §4.2 bypass — is
    // refused directly at read.
    inventory.files[1]!.sha256 = 'e'.repeat(64);
    writeFileSync(
      join(root, INVENTORY_FILE_NAME),
      `${JSON.stringify(inventory, null, 2)}\n`,
      'utf8',
    );
    expect(() => readInventory(root)).toThrow(/aggregateSha256 does not recompute/);

    writeFileSync(join(root, INVENTORY_FILE_NAME), 'not json {', 'utf8');
    expect(() => readInventory(root)).toThrow(/inventory-invalid \(read\)/);
  });
});
