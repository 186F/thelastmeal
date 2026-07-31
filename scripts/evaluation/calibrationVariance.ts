import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  M2_CALIBRATION_ANALYSIS_VERSION,
  calibrationVarianceReportSchema,
  entropyMilliBits,
  quantileMilliFloor,
  type CalibrationVarianceReport,
} from '../../src/shared/calibrationAnalysis';
import {
  behaviorFingerprintSetSchema,
  comparablePairing,
  type BehaviorFingerprintSet,
} from '../../src/shared/behaviorArtifacts';
import { compareBehaviorFingerprintSets } from '../../src/sim/evaluation/behaviorSimilarity';
import { canonicalSerialize } from '../../src/sim/replay/serialize';
import { modelTraceEntrySchema, finalManifestSchema } from '../../src/shared/modelArtifacts';
import { loadEvaluationEvidence } from './evidence';
import { readSequenceState, type AttemptExecution } from '../experiments/m2/sequenceState';

/**
 * The ten-run calibration variance analyzer (Phase 4 audit finding 1):
 * `m2-calibration-variance-analysis-1.0.0`.
 *
 * Input: a COMPLETED calibration sequence root (read-only). Primary
 * observations are the completed, artifact-valid, study-valid M2
 * executions; everything else is listed as excluded with its reason
 * (failed, replacement-failed, invalid-treatment, deterministic, or
 * otherwise non-primary — audit §3.5). Output: a deterministic canonical
 * JSON report (byte-identical across repeated runs on the same evidence)
 * plus a human-readable Markdown rendering, both written to a derived
 * output directory — never into the immutable root.
 *
 * Every registered R2 output is produced here; the quantile and entropy
 * algorithms are defined exactly in src/shared/calibrationAnalysis.ts.
 */

export interface DecisionPoint {
  requestId: string;
  tick: number;
  offeredIds: readonly string[];
  hardDependencyFingerprint: string;
  contextHash: string | null;
  selectedAffordanceId: string | null;
}

export interface RunEvidence {
  execution: AttemptExecution;
  fingerprints: BehaviorFingerprintSet;
  decisions: DecisionPoint[];
  manifest: {
    externalRequestsEmitted: number;
    upstreamCallsAttempted: number;
    callsCompleted: number;
    acceptedModelResponses: number;
    callsFailedByCategory: Record<string, number>;
    inputTokens: number;
    outputTokens: number;
    returnedModelIds: string[];
  };
  latenciesMs: number[];
  totalTokensPerCall: number[];
  rationaleRows: number;
  rationaleNormalizedRows: number;
  servingProviderIds: string[];
}

export function loadRunEvidence(sequenceRoot: string, execution: AttemptExecution): RunEvidence {
  const attemptDir = join(sequenceRoot, execution.dir);
  const fingerprints = behaviorFingerprintSetSchema.parse(
    JSON.parse(readFileSync(join(attemptDir, 'behavior-fingerprint.json'), 'utf8')),
  );
  if (execution.runId === null) {
    throw new Error(
      `calibration-analysis: ${execution.executionId} has no runId (not a model run)`,
    );
  }
  const runDir = join(attemptDir, 'gateway', execution.runId);
  // Full strict-finalized validation (bundle integrity, exact
  // trace-to-ledger bijection) before any fact is trusted.
  const evidence = loadEvaluationEvidence(runDir);
  if (evidence.kind !== 'strict-finalized-run') {
    throw new Error(`calibration-analysis: ${runDir} is not a strict-finalized run`);
  }

  const manifest = finalManifestSchema.parse(
    JSON.parse(readFileSync(join(runDir, 'run-manifest.final.json'), 'utf8')),
  );

  // Mara's decision timeline from the VALIDATED ledger: external
  // DecisionRequested facts joined with engine-accepted selections, plus
  // the per-request context hash from the finalized trace.
  const finalizedRows = readFileSync(join(runDir, 'finalized-trace.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const contextHashByRequest = new Map<string, string>(
    finalizedRows.map((row) => [String(row.requestId), String(row.contextHash)]),
  );

  const requested: DecisionPoint[] = [];
  const selectedByRequest = new Map<string, string>();
  for (const event of evidence.file.events as unknown as {
    type: string;
    tick: number;
    payload: Record<string, unknown>;
  }[]) {
    if (event.type === 'DecisionRequested' && event.payload.npcId === 'mara') {
      const providerId = String(event.payload.providerId);
      if (providerId === evidence.enrichment.externalActionProviderId) {
        requested.push({
          requestId: String(event.payload.requestId),
          tick: event.tick,
          offeredIds: (event.payload.affordanceIds as string[]) ?? [],
          hardDependencyFingerprint: String(event.payload.hardDependencyFingerprint),
          contextHash: contextHashByRequest.get(String(event.payload.requestId)) ?? null,
          selectedAffordanceId: null,
        });
      }
    }
    if (event.type === 'DecisionResponseAccepted') {
      const requestId = String(event.payload.requestId);
      const selected = String(event.payload.selectedAffordanceId);
      if (!selectedByRequest.has(requestId)) selectedByRequest.set(requestId, selected);
    }
  }
  for (const point of requested) {
    point.selectedAffordanceId = selectedByRequest.get(point.requestId) ?? null;
  }

  // Raw gateway trace: latency, tokens, rationale normalization, per row.
  // Duplicate rows per requestId keep the LAST row, matching the
  // finalizer's join rule.
  const rawRows = readFileSync(join(runDir, 'model-trace.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => modelTraceEntrySchema.parse(JSON.parse(line)));
  const lastRowByRequest = new Map<string, (typeof rawRows)[number]>();
  for (const row of rawRows) lastRowByRequest.set(row.requestId, row);
  const latenciesMs: number[] = [];
  const totalTokensPerCall: number[] = [];
  let rationaleRows = 0;
  let rationaleNormalizedRows = 0;
  for (const row of lastRowByRequest.values()) {
    latenciesMs.push(Math.floor(row.latencyMs));
    if (row.totalTokens !== null) totalTokensPerCall.push(row.totalTokens);
    if (row.rationaleNormalized !== undefined) {
      rationaleRows += 1;
      if (row.rationaleNormalized) rationaleNormalizedRows += 1;
    }
  }

  // Serving providers from routing sidecars (absent for the fake adapter).
  const servingProviderIds: string[] = [];
  const routingDir = join(runDir, 'routing');
  if (existsSync(routingDir)) {
    for (const file of readdirSync(routingDir)) {
      const entry = JSON.parse(readFileSync(join(routingDir, file), 'utf8')) as {
        upstreamProviderId: string | null;
      };
      if (entry.upstreamProviderId !== null) servingProviderIds.push(entry.upstreamProviderId);
    }
  }

  return {
    execution,
    fingerprints,
    decisions: requested,
    manifest: {
      externalRequestsEmitted: manifest.externalRequestsEmitted,
      upstreamCallsAttempted: manifest.upstreamCallsAttempted,
      callsCompleted: manifest.callsCompleted,
      acceptedModelResponses: manifest.acceptedModelResponses,
      callsFailedByCategory: manifest.callsFailedByCategory,
      inputTokens: manifest.inputTokens,
      outputTokens: manifest.outputTokens,
      returnedModelIds: manifest.returnedModelIds,
    },
    latenciesMs,
    totalTokensPerCall,
    rationaleRows,
    rationaleNormalizedRows,
    servingProviderIds,
  };
}

/** The matched-decision rule (§3.4.C; ruling §4.4): decision ordinal i is
 * comparable while BOTH runs' i-th external decisions carry an identical
 * context hash (covering semantic world context, beliefs, memories, and
 * activity state), identical hard-dependency fingerprint, and identical
 * offered-affordance id lists. The FIRST comparable ordinal where the
 * engine-accepted selections differ is the selection divergence; contexts
 * drifting apart first is a context divergence; later ordinal matching is
 * invalid after either. */
function firstDivergence(left: DecisionPoint[], right: DecisionPoint[]) {
  const limit = Math.min(left.length, right.length);
  let comparable = 0;
  for (let i = 0; i < limit; i += 1) {
    const l = left[i]!;
    const r = right[i]!;
    const contextsMatch =
      l.contextHash !== null &&
      l.contextHash === r.contextHash &&
      l.hardDependencyFingerprint === r.hardDependencyFingerprint &&
      l.offeredIds.length === r.offeredIds.length &&
      l.offeredIds.every((id, index) => id === r.offeredIds[index]);
    if (!contextsMatch) {
      return {
        comparableDecisions: comparable,
        kind: 'context-divergence' as const,
        atOrdinal: i,
        logicalTick: l.tick,
        leftRequestId: l.requestId,
        rightRequestId: r.requestId,
        leftContextFingerprint: l.contextHash,
        rightContextFingerprint: r.contextHash,
        leftSelectedAffordanceId: l.selectedAffordanceId,
        rightSelectedAffordanceId: r.selectedAffordanceId,
        laterOrdinalMatchingValid: false,
      };
    }
    comparable += 1;
    if (l.selectedAffordanceId !== r.selectedAffordanceId) {
      return {
        comparableDecisions: comparable,
        kind: 'selection-divergence' as const,
        atOrdinal: i,
        logicalTick: l.tick,
        leftRequestId: l.requestId,
        rightRequestId: r.requestId,
        leftContextFingerprint: l.contextHash,
        rightContextFingerprint: r.contextHash,
        leftSelectedAffordanceId: l.selectedAffordanceId,
        rightSelectedAffordanceId: r.selectedAffordanceId,
        laterOrdinalMatchingValid: false,
      };
    }
  }
  return {
    comparableDecisions: comparable,
    kind: 'none' as const,
    atOrdinal: null,
    logicalTick: null,
    leftRequestId: null,
    rightRequestId: null,
    leftContextFingerprint: null,
    rightContextFingerprint: null,
    leftSelectedAffordanceId: null,
    rightSelectedAffordanceId: null,
    laterOrdinalMatchingValid: true,
  };
}

function distribution(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return {
      count: 0,
      minimum: 0,
      maximum: 0,
      medianMilli: 0,
      p10Milli: 0,
      p25Milli: 0,
      p75Milli: 0,
      p90Milli: 0,
      quantileAlgorithm: 'type-7-linear-interpolation-floor-milli' as const,
    };
  }
  return {
    count: sorted.length,
    minimum: sorted[0]!,
    maximum: sorted[sorted.length - 1]!,
    medianMilli: quantileMilliFloor(sorted, 50),
    p10Milli: quantileMilliFloor(sorted, 10),
    p25Milli: quantileMilliFloor(sorted, 25),
    p75Milli: quantileMilliFloor(sorted, 75),
    p90Milli: quantileMilliFloor(sorted, 90),
    quantileAlgorithm: 'type-7-linear-interpolation-floor-milli' as const,
  };
}

function counts(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of [...values].sort()) out[value] = (out[value] ?? 0) + 1;
  return out;
}

function maraCounts(record: Record<string, number>): number[] {
  return Object.keys(record)
    .sort()
    .map((key) => record[key]!);
}

function pooledCounts(sets: readonly Record<string, number>[]): number[] {
  const pooled: Record<string, number> = {};
  for (const set of sets) {
    for (const key of Object.keys(set)) pooled[key] = (pooled[key] ?? 0) + set[key]!;
  }
  return maraCounts(pooled);
}

export function analyzeCalibrationSequence(sequenceRoot: string): CalibrationVarianceReport {
  const state = readSequenceState(sequenceRoot);
  if (state === null)
    throw new Error(`calibration-analysis: no sequence state for ${sequenceRoot}`);
  if (state.status !== 'completed') {
    throw new Error(`calibration-analysis: sequence status '${state.status}' is not completed`);
  }

  const primaries: RunEvidence[] = [];
  const excluded: { executionId: string; reason: string }[] = [];
  for (const execution of state.executions) {
    if (execution.status !== 'completed') {
      excluded.push({ executionId: execution.executionId, reason: `status:${execution.status}` });
      continue;
    }
    if (execution.artifactStatus !== 'artifact-valid' || execution.studyStatus !== 'study-valid') {
      excluded.push({
        executionId: execution.executionId,
        reason: `verdicts:${String(execution.artifactStatus)}/${String(execution.studyStatus)}`,
      });
      continue;
    }
    if (execution.runId === null) {
      excluded.push({ executionId: execution.executionId, reason: 'deterministic-non-primary' });
      continue;
    }
    primaries.push(loadRunEvidence(sequenceRoot, execution));
  }
  return buildCalibrationReport(state.sequenceId, primaries, excluded);
}

/**
 * The PURE analysis core over already-loaded evidence — every registered
 * output computed here, deterministically. Exported so the audit-required
 * synthetic ten-run fixture drives the complete computation (45 pairs,
 * quantile boundaries, entropy, divergence matrix, exclusions) without a
 * browser or filesystem.
 */
export function buildCalibrationReport(
  sequenceId: string,
  primaries: RunEvidence[],
  excluded: { executionId: string; reason: string }[],
): CalibrationVarianceReport {
  if (primaries.length < 2) {
    throw new Error(
      `calibration-analysis: ${primaries.length} primary observation(s) — nothing to pair`,
    );
  }

  const first = primaries[0]!.fingerprints;
  const pairs: CalibrationVarianceReport['pairs'] = [];
  const composites: number[] = [];
  for (let i = 0; i < primaries.length; i += 1) {
    for (let j = i + 1; j < primaries.length; j += 1) {
      const left = primaries[i]!;
      const right = primaries[j]!;
      const pairing = comparablePairing(left.fingerprints, right.fingerprints);
      if (pairing === null) {
        pairs.push({
          left: left.execution.executionId,
          right: right.execution.executionId,
          pairing: 'not-comparable',
          compositeBp: 0,
          distanceBp: 10_000,
          matchedDecisionExclusionReason: 'not-comparable: different scenario or seed',
          firstDivergence: firstDivergence([], []),
        });
        continue;
      }
      const comparison = compareBehaviorFingerprintSets(left.fingerprints, right.fingerprints);
      const compositeBp = comparison.npcs.mara.compositeBp;
      composites.push(compositeBp);
      pairs.push({
        left: left.execution.executionId,
        right: right.execution.executionId,
        pairing,
        compositeBp,
        distanceBp: 10_000 - compositeBp,
        matchedDecisionExclusionReason: null,
        firstDivergence: firstDivergence(left.decisions, right.decisions),
      });
    }
  }

  const runs: CalibrationVarianceReport['runs'] = primaries.map((run) => {
    const mara = run.fingerprints.npcs.mara;
    const coverage =
      run.manifest.externalRequestsEmitted > 0
        ? Math.floor(
            (10_000 * run.manifest.acceptedModelResponses) / run.manifest.externalRequestsEmitted,
          )
        : 0;
    return {
      executionId: run.execution.executionId,
      runId: run.execution.runId!,
      taskOutcome: mara.taskOutcome,
      taskCompletionTick: mara.taskCompletionTick,
      mealConsumedBy: mara.mealConsumedBy,
      mealViolation: mara.mealViolation,
      commitmentTerminalStatus: mara.commitmentTerminalStatus,
      treatmentOccurred: mara.firstTreatmentStartTick !== null,
      injuryWorsened: mara.injuryWorsened,
      ownershipViolations: mara.ownershipViolations,
      externalRequestsEmitted: run.manifest.externalRequestsEmitted,
      upstreamCallsAttempted: run.manifest.upstreamCallsAttempted,
      upstreamCallsCompleted: run.manifest.callsCompleted,
      acceptedModelResponses: run.manifest.acceptedModelResponses,
      acceptedModelCoverageBp: coverage,
      failureCategories: run.manifest.callsFailedByCategory,
      inputTokensTotal: run.manifest.inputTokens,
      outputTokensTotal: run.manifest.outputTokens,
      rationaleRowsTotal: run.rationaleRows,
      rationaleNormalizedRows: run.rationaleNormalizedRows,
      latencyMsDistribution: distribution(run.latenciesMs),
      totalTokensDistribution: distribution(run.totalTokensPerCall),
      returnedModelIds: [...run.manifest.returnedModelIds].sort(),
      servingProviderIds: [...new Set(run.servingProviderIds)].sort(),
      routeConsistencyVerdict:
        new Set(run.manifest.returnedModelIds).size <= 1 &&
        new Set(run.servingProviderIds).size <= 1
          ? ('consistent' as const)
          : ('inconsistent' as const),
      actionCategoryEntropyMilliBits: entropyMilliBits(maraCounts(mara.startsByCategory)),
      actionModeEntropyMilliBits: entropyMilliBits(maraCounts(mara.startsByMode)),
      categoryTransitionEntropyMilliBits: entropyMilliBits(maraCounts(mara.categoryTransitions)),
    };
  });

  const allLatencies = primaries.flatMap((run) => run.latenciesMs);
  const allTokens = primaries.flatMap((run) => run.totalTokensPerCall);
  const emittedTotal = runs.reduce((sum, run) => sum + run.externalRequestsEmitted, 0);
  const acceptedTotal = runs.reduce((sum, run) => sum + run.acceptedModelResponses, 0);
  const pooledFailureCategories: Record<string, number> = {};
  for (const run of runs) {
    for (const key of Object.keys(run.failureCategories).sort()) {
      pooledFailureCategories[key] =
        (pooledFailureCategories[key] ?? 0) + run.failureCategories[key]!;
    }
  }
  const rationaleTotal = runs.reduce((sum, run) => sum + run.rationaleRowsTotal, 0);
  const rationaleNormalized = runs.reduce((sum, run) => sum + run.rationaleNormalizedRows, 0);
  const returnedDistinct = [...new Set(runs.flatMap((run) => run.returnedModelIds))].sort();
  const servingDistinct = [...new Set(runs.flatMap((run) => run.servingProviderIds))].sort();

  const report: CalibrationVarianceReport = {
    analysisVersion: M2_CALIBRATION_ANALYSIS_VERSION,
    sequenceId,
    scenarioId: first.scenarioId,
    seed: first.seed,
    runCount: primaries.length,
    executionIds: primaries.map((run) => run.execution.executionId),
    excludedExecutions: excluded,
    pairs,
    compositeSimilarityDistribution: distribution(composites),
    entropyParameters: {
      base: 2,
      unit: 'milli-bits',
      rounding: 'floor',
      zeroCounts: 'excluded (0·log 0 = 0)',
      actionCategoryPopulation: 'Mara ActionStarted events by category (startsByCategory)',
      actionModePopulation: 'Mara ActionStarted events by mode (startsByMode)',
      transitionPopulation: 'consecutive Mara accepted-start category pairs (categoryTransitions)',
    },
    runs,
    aggregate: {
      taskOutcomeCounts: counts(runs.map((run) => run.taskOutcome)),
      mealConsumedByCounts: counts(runs.map((run) => String(run.mealConsumedBy))),
      commitmentTerminalStatusCounts: counts(runs.map((run) => run.commitmentTerminalStatus)),
      treatmentOccurredCount: runs.filter((run) => run.treatmentOccurred).length,
      injuryWorsenedCount: runs.filter((run) => run.injuryWorsened).length,
      mealViolationCount: runs.filter((run) => run.mealViolation).length,
      ownershipViolationTotal: runs.reduce((sum, run) => sum + run.ownershipViolations, 0),
      externalRequestsEmittedTotal: emittedTotal,
      upstreamCallsAttemptedTotal: runs.reduce((sum, run) => sum + run.upstreamCallsAttempted, 0),
      upstreamCallsCompletedTotal: runs.reduce((sum, run) => sum + run.upstreamCallsCompleted, 0),
      acceptedModelResponsesTotal: acceptedTotal,
      acceptedModelCoverageBp:
        emittedTotal > 0 ? Math.floor((10_000 * acceptedTotal) / emittedTotal) : 0,
      failureCategories: pooledFailureCategories,
      latencyMsDistribution: distribution(allLatencies),
      totalTokensDistribution: distribution(allTokens),
      rationaleNormalizationFrequencyBp:
        rationaleTotal > 0 ? Math.floor((10_000 * rationaleNormalized) / rationaleTotal) : 0,
      returnedModelIdsDistinct: returnedDistinct,
      servingProviderIdsDistinct: servingDistinct,
      routeConsistencyVerdict:
        returnedDistinct.length <= 1 && servingDistinct.length <= 1 ? 'consistent' : 'inconsistent',
      pooledActionCategoryEntropyMilliBits: entropyMilliBits(
        pooledCounts(primaries.map((run) => run.fingerprints.npcs.mara.startsByCategory)),
      ),
      pooledActionModeEntropyMilliBits: entropyMilliBits(
        pooledCounts(primaries.map((run) => run.fingerprints.npcs.mara.startsByMode)),
      ),
      pooledCategoryTransitionEntropyMilliBits: entropyMilliBits(
        pooledCounts(primaries.map((run) => run.fingerprints.npcs.mara.categoryTransitions)),
      ),
    },
  };
  return calibrationVarianceReportSchema.parse(report);
}

function renderMarkdown(report: CalibrationVarianceReport): string {
  const lines: string[] = [];
  lines.push(`# Calibration variance analysis — ${report.sequenceId}`);
  lines.push('');
  lines.push(`**Analysis version:** ${report.analysisVersion}`);
  lines.push(
    `**Scenario:** ${report.scenarioId} (seed ${report.seed}) · ` +
      `**Primary runs:** ${report.runCount} · **Pairs:** ${report.pairs.length}`,
  );
  lines.push('');
  const d = report.compositeSimilarityDistribution;
  lines.push('## Composite similarity distribution (Mara, basis points)');
  lines.push('');
  lines.push('| median | p10 | p25 | p75 | p90 | min | max | pairs |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  lines.push(
    `| ${d.medianMilli / 1000} | ${d.p10Milli / 1000} | ${d.p25Milli / 1000} | ` +
      `${d.p75Milli / 1000} | ${d.p90Milli / 1000} | ${d.minimum} | ${d.maximum} | ${d.count} |`,
  );
  lines.push('');
  lines.push(`Quantile algorithm: ${d.quantileAlgorithm}.`);
  lines.push('');
  lines.push('## Pairwise matrix');
  lines.push('');
  lines.push('| left | right | composite (bp) | distance (bp) | first divergence | tick |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const pair of report.pairs) {
    lines.push(
      `| ${pair.left} | ${pair.right} | ${pair.compositeBp} | ${pair.distanceBp} | ` +
        `${pair.firstDivergence.kind} | ${String(pair.firstDivergence.logicalTick ?? '—')} |`,
    );
  }
  lines.push('');
  lines.push('## Per-run facts');
  lines.push('');
  lines.push(
    '| execution | task | commitment | meal | treated | calls a/c | coverage (bp) | ' +
      'entropy cat/mode/trans (milli-bits) |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const run of report.runs) {
    lines.push(
      `| ${run.executionId} | ${run.taskOutcome} | ${run.commitmentTerminalStatus} | ` +
        `${String(run.mealConsumedBy)} | ${run.treatmentOccurred ? 'yes' : 'no'} | ` +
        `${run.upstreamCallsAttempted}/${run.upstreamCallsCompleted} | ${run.acceptedModelCoverageBp} | ` +
        `${run.actionCategoryEntropyMilliBits}/${run.actionModeEntropyMilliBits}/${run.categoryTransitionEntropyMilliBits} |`,
    );
  }
  lines.push('');
  lines.push(
    'Commitment outcomes are the mechanical terminal statuses produced under ' +
      'frozen VS001 rules — never validated moral blame.',
  );
  lines.push('');
  lines.push('## Operational aggregate');
  lines.push('');
  lines.push(
    `Rationale normalization frequency: ${report.aggregate.rationaleNormalizationFrequencyBp} bp · ` +
      `returned models: ${report.aggregate.returnedModelIdsDistinct.join(', ') || '(none)'} · ` +
      `serving providers: ${report.aggregate.servingProviderIdsDistinct.join(', ') || '(none recorded)'} · ` +
      `route consistency: ${report.aggregate.routeConsistencyVerdict}`,
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

/** Create-once writer over an already-built report — split from the
 * analyzer so the write/render path is unit-testable with the synthetic
 * fixture while the filesystem entry point is drilled on real evidence. */
export function writeCalibrationReport(
  report: CalibrationVarianceReport,
  outputDir: string,
): { jsonPath: string; markdownPath: string } {
  if (existsSync(outputDir)) {
    throw new Error(`calibration-analysis-output-exists: ${outputDir} (analysis is create-once)`);
  }
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, 'calibration-variance-analysis.json');
  const markdownPath = join(outputDir, 'calibration-variance-analysis.md');
  writeFileSync(jsonPath, canonicalSerialize(report), 'utf8');
  writeFileSync(markdownPath, renderMarkdown(report), 'utf8');
  return { jsonPath, markdownPath };
}

export function writeCalibrationAnalysis(
  sequenceRoot: string,
  outputDir: string,
): { report: CalibrationVarianceReport; jsonPath: string; markdownPath: string } {
  const report = analyzeCalibrationSequence(sequenceRoot);
  const { jsonPath, markdownPath } = writeCalibrationReport(report, outputDir);
  return { report, jsonPath, markdownPath };
}
