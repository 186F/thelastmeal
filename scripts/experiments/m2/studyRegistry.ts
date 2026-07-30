import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  studyDeclarationSchema,
  studyFreezeProjection,
  type StudyDeclaration,
} from '../../../src/shared/studyRegistry';
import { canonicalSerialize } from '../../../src/sim/replay/serialize';
import { fnv1a64Hex } from '../../../src/sim/replay/hash';

/**
 * `npm run study:validate -- --study <path> [--write-hash]`
 *
 * Validates a registered study declaration (M2 brief §21.1), then prints the
 * two study-local freeze artifacts (§21.2):
 *
 *  - `planSha256` — SHA-256 of the exact study-file BYTES. This is the
 *    immutable study-plan hash; any byte change to the registered file
 *    changes it.
 *  - `configFingerprint` — fnv1a64 over the canonical serialization of the
 *    nonsecret freeze projection; it identifies the frozen configuration
 *    independent of formatting or comment-level edits.
 *
 * `--write-hash` records both next to the study file as `<study>.freeze.json`.
 */

export interface StudyFreezeRecord {
  studyId: string;
  studyVersion: string;
  planSha256: string;
  configFingerprint: string;
}

export function validateStudyFile(path: string): {
  study: StudyDeclaration;
  freeze: StudyFreezeRecord;
} {
  if (!existsSync(path)) throw new Error(`study-file-not-found: ${path}`);
  const bytes = readFileSync(path);
  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  const study = studyDeclarationSchema.parse(parsed);
  const planSha256 = createHash('sha256').update(bytes).digest('hex');
  const configFingerprint = fnv1a64Hex(canonicalSerialize(studyFreezeProjection(study)));
  return {
    study,
    freeze: {
      studyId: study.studyId,
      studyVersion: study.studyVersion,
      planSha256,
      configFingerprint,
    },
  };
}

export function runStudyRegistryCli(argv: readonly string[]): number {
  const studyArg = argv.find((a) => a.startsWith('--study='))?.slice('--study='.length);
  const writeHash = argv.includes('--write-hash');
  if (!studyArg) {
    console.error('usage: study:validate -- --study=<path> [--write-hash]');
    return 1;
  }
  const { study, freeze } = validateStudyFile(studyArg);
  console.log(
    `study:validate — ${freeze.studyId} v${freeze.studyVersion} (${study.status}) OK; ` +
      `n=${study.sampleSizeN}; liveCallBudget=${study.liveCallBudget}`,
  );
  console.log(`  planSha256:        ${freeze.planSha256}`);
  console.log(`  configFingerprint: ${freeze.configFingerprint}`);
  if (writeHash) {
    const freezePath = `${studyArg}.freeze.json`;
    writeFileSync(freezePath, `${JSON.stringify(freeze, null, 2)}\n`, 'utf8');
    console.log(`  wrote ${freezePath}`);
  }
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    process.exitCode = runStudyRegistryCli(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(
      `study:validate failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
