import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  AUTOMATION_FIELDS,
  AUTOMATION_IDS,
  AUTOMATION_TEXT,
} from '../../../src/shared/automationContract';
import type { PlannedAttempt, TraceCaptureProfile } from './planSchema';
import { isModelBackedConditionId } from '../../../src/shared/conditionContract';
import { AttemptFailure, type FailureClass } from './failureTaxonomy';

/**
 * Playwright browser driver for one attempt (M2 brief §19.7–§19.10).
 *
 * Drives the REAL operator surface — the same selects, buttons, and
 * downloads a human uses — through the automation contract's stable
 * selectors, polling semantic DOM state (never pixels). Every attempt gets
 * a fresh browser context and page (§19.5); downloads land directly in the
 * attempt directory (§19.7); a machine-readable heartbeat is appended on a
 * fixed cadence (§19.9); a stall watchdog and a wall-clock timeout convert
 * hangs into preserved failed attempts (§19.9–§19.10); every failure
 * captures a screenshot, DOM snapshot, console/page errors, and a
 * Playwright trace before the context closes; and an unexpected page
 * reload or navigation is DETECTED and fails the attempt rather than
 * masquerading as an uninterrupted run (re-audit §13.3): a load token is
 * planted in the page after the initial load, and both a main-frame
 * navigation counter and a per-poll token check guard it.
 */

export { AttemptFailure } from './failureTaxonomy';

/**
 * Default Playwright trace-chunk rotation interval (Phase 4; focused
 * re-audit §8.2): one unbounded trace across a multi-hour 1× attempt is not
 * bounded evidence. Every chunk is retained (§19.12 — never discard raw
 * traces); rotation bounds the OPEN chunk, persists forensics early, and
 * gives the evidence forecaster real measurements.
 */
export const DEFAULT_TRACE_CHUNK_INTERVAL_MS = 10 * 60_000;

export interface BrowserAttemptOptions {
  origin: string;
  attempt: PlannedAttempt;
  attemptDir: string;
  timeouts: {
    runTimeoutMs: number;
    stallTimeoutMs: number;
    stallGraceMs: number;
    heartbeatIntervalMs: number;
  };
  /** Trace-chunk rotation (Phase 4) and the reviewed capture profile
   * (evidence-instrumentation revision). Absent means the default
   * interval and the legacy `continuous-visual-v1` capture. */
  tracing?: {
    chunkIntervalMs: number;
    captureProfile?: TraceCaptureProfile;
  };
  /** Evidence-size forecasting inputs (Phase 4): at every chunk rotation
   * the cumulative trace bytes are extrapolated to the attempt's full
   * wall-clock allowance; a projection exceeding the sequence budget fails
   * the attempt EARLY as `evidence-budget-exceeded` instead of discovering
   * the overrun after hours of spend. */
  evidenceForecast?: {
    budgetBytes: number;
    rootBytesAtStart: number;
  };
  /** Called once when the observed tick first reaches
   * `attempt.gatewayStopAtTick` (the planned mid-run gateway stop); resolves
   * with the gateway child's exit outcome so the stop is EVIDENCED. */
  onGatewayStopTick?: () => Promise<string>;
}

/** Evidence that a planned gateway stop actually fired (audit finding 8):
 * a stop-planned attempt whose trigger never fired is an invalid treatment
 * observation, never a silent completion. */
export interface GatewayStopEvidence {
  fired: boolean;
  observedTick: number | null;
  atUtc: string | null;
  acceptedResponsesAtStop: string | null;
  gatewayExit: string | null;
}

export interface BrowserAttemptResult {
  runId: string | null;
  ledgerPath: string;
  bundlePath: string | null;
  finalTick: number;
  heartbeatCount: number;
  consoleErrors: string[];
  replayVerdict: string;
  gatewayStop: GatewayStopEvidence | null;
  /** Main-frame navigations observed for the attempt (re-audit §13.3):
   * exactly 1 for an uninterrupted run. */
  navigationCount: number;
}

/** Runs one capture action, recording success or failure in the shared
 * capture maps — a capture failure is evidence, never a silent absorption
 * or a mask over the original failure (re-audit §12 drill seam). */
export async function captureArtifact(
  captured: Record<string, string>,
  captureFailures: Record<string, string>,
  name: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
    captured[name] = 'captured';
  } catch (captureError: unknown) {
    captureFailures[name] =
      captureError instanceof Error ? captureError.message : String(captureError);
  }
}

function field(page: Page, name: string) {
  return page.locator(`[data-field="${name}"]`);
}

async function readTick(page: Page): Promise<number | null> {
  const text = await field(page, AUTOMATION_FIELDS.time).textContent();
  const match = text?.match(AUTOMATION_TEXT.tickPattern);
  return match ? Number(match[1]) : null;
}

async function readFieldText(page: Page, name: string): Promise<string> {
  return (await field(page, name).textContent()) ?? '';
}

export async function runBrowserAttempt(
  browser: Browser,
  options: BrowserAttemptOptions,
): Promise<BrowserAttemptResult> {
  const { attempt, attemptDir, origin, timeouts } = options;
  mkdirSync(attemptDir, { recursive: true });
  const heartbeatPath = join(attemptDir, 'heartbeat.jsonl');
  const consoleErrors: string[] = [];

  // Fresh context per attempt (§19.5): no cookies, storage, or page state
  // survives between attempts. Downloads are accepted and saved explicitly.
  // Tracing is bounded two ways (re-audit §13.4; Phase 4 §8.2): DOM
  // snapshots with no source-file embedding, AND chunked rotation so no
  // single open trace grows with attempt duration. The CAPTURE PROFILE
  // (evidence-instrumentation revision) is a reviewed plan property:
  // `semantic-trace-sparse-visual-v1` disables the continuous screenshot
  // stream — the dominant 1× evidence cost, ~2.7 MB/s of animation frames
  // — and records hashed static visual checkpoints instead; the legacy
  // `continuous-visual-v1` keeps the full stream for rehearsal parity.
  // Attempts shorter than one chunk interval produce exactly the
  // pre-Phase-4 artifact shape (one attempt-trace.zip / failure-trace.zip
  // and no trace-chunks/ directory).
  const captureProfile: TraceCaptureProfile =
    options.tracing?.captureProfile ?? 'continuous-visual-v1';
  const context: BrowserContext = await browser.newContext({ acceptDownloads: true });
  await context.tracing.start({
    screenshots: captureProfile === 'continuous-visual-v1',
    snapshots: true,
    sources: false,
  });
  await context.tracing.startChunk();
  const chunkIntervalMs = options.tracing?.chunkIntervalMs ?? DEFAULT_TRACE_CHUNK_INTERVAL_MS;
  const traceChunksDir = join(attemptDir, 'trace-chunks');
  const traceChunks: { name: string; bytes: number; endedAtUtc: string }[] = [];
  let traceChunkIndex = 0;
  let traceBytesTotal = 0;
  /** When tracing began — the byte-accumulation origin. The forecast must
   * measure rate over THIS window, not over the post-Start run clock
   * (adversarial-review fix: mismatched windows overstated the rate by
   * interval/(interval − setup) without bound). */
  const traceStartedAt = Date.now();
  let chunkStartedAt = traceStartedAt;
  let traceClosed = false;

  /** Rotates the open trace chunk into a retained bounded file. */
  const rotateTraceChunk = async (): Promise<void> => {
    traceChunkIndex += 1;
    mkdirSync(traceChunksDir, { recursive: true });
    const name = `attempt-trace-chunk-${String(traceChunkIndex).padStart(3, '0')}.zip`;
    const chunkPath = join(traceChunksDir, name);
    await context.tracing.stopChunk({ path: chunkPath });
    const bytes = statSync(chunkPath).size;
    traceBytesTotal += bytes;
    traceChunks.push({ name: `trace-chunks/${name}`, bytes, endedAtUtc: new Date().toISOString() });
    await context.tracing.startChunk();
    chunkStartedAt = Date.now();
  };

  /** Closes tracing: the final (often only) chunk lands at the contract
   * artifact name; every earlier rotated chunk is already on disk. The
   * trace manifest records the complete chunk set and the explicit
   * retention policy. Runs at most once. */
  const closeTraceInto = async (finalName: string): Promise<void> => {
    if (traceClosed) return;
    traceClosed = true;
    const finalPath = join(attemptDir, finalName);
    await context.tracing.stopChunk({ path: finalPath });
    const bytes = statSync(finalPath).size;
    traceBytesTotal += bytes;
    traceChunks.push({ name: finalName, bytes, endedAtUtc: new Date().toISOString() });
    await context.tracing.stop();
    writeFileSync(
      join(attemptDir, 'trace-manifest.json'),
      `${JSON.stringify(
        {
          captureProfile,
          chunkIntervalMs,
          retention: 'retain-all-chunks',
          totalTraceBytes: traceBytesTotal,
          chunks: traceChunks,
          visualCheckpoints,
          ...(Object.keys(checkpointCaptureFailures).length > 0
            ? { checkpointCaptureFailures }
            : {}),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  };
  const page = await context.newPage();

  /** Static visual checkpoints (evidence-instrumentation revision): under
   * the sparse profile, a hashed full-page image before Start, at every
   * rotation, and at completion — ~6–7 useful images per formal attempt
   * instead of a continuous screen recording. Every checkpoint records
   * filename, UTC timestamp, logical tick, run status, and SHA-256 in the
   * trace manifest; a capture failure is recorded evidence, never a run
   * failure or a silent absence. */
  const visualCheckpoints: {
    filename: string;
    atUtc: string;
    tick: number | null;
    runStatus: string;
    sha256: string;
  }[] = [];
  const checkpointCaptureFailures: Record<string, string> = {};
  const captureVisualCheckpoint = async (
    label: string,
    tick: number | null,
    runStatus: string,
  ): Promise<void> => {
    if (captureProfile !== 'semantic-trace-sparse-visual-v1') return;
    const filename = `visual-checkpoints/checkpoint-${String(visualCheckpoints.length + 1).padStart(3, '0')}-${label}.png`;
    try {
      const target = join(attemptDir, filename);
      mkdirSync(join(attemptDir, 'visual-checkpoints'), { recursive: true });
      await page.screenshot({ path: target, fullPage: true });
      visualCheckpoints.push({
        filename,
        atUtc: new Date().toISOString(),
        tick,
        runStatus,
        sha256: createHash('sha256').update(readFileSync(target)).digest('hex'),
      });
    } catch (error: unknown) {
      checkpointCaptureFailures[label] = error instanceof Error ? error.message : String(error);
    }
  };

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  // Navigation detection (re-audit §13.3): the initial goto is navigation
  // 1; anything after it is an unexpected reload/navigation.
  let navigationCount = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigationCount += 1;
  });

  let terminalDiagnosticsCaptured = false;

  /**
   * Diagnostics capture (§19.7). Terminal capture (any failed attempt)
   * writes failure-* artifacts and STOPS the trace into failure-trace.zip;
   * it runs at most once. Non-terminal capture (the stall grace snapshot,
   * §19.9 step 1) writes stall-* artifacts and leaves tracing RUNNING, so a
   * later terminal failure still gets the full trace and a recovered
   * attempt completes without failure-named artifacts.
   */
  const captureDiagnostics = async (
    reason: string,
    detail: string,
    terminal: boolean,
  ): Promise<void> => {
    const prefix = terminal ? 'failure' : 'stall';
    try {
      await page.screenshot({
        path: join(attemptDir, `${prefix}-screenshot.png`),
        fullPage: true,
      });
      writeFileSync(join(attemptDir, `${prefix}-dom.html`), await page.content(), 'utf8');
      writeFileSync(
        join(attemptDir, `${prefix}.json`),
        `${JSON.stringify({ reason, detail, consoleErrors }, null, 2)}\n`,
        'utf8',
      );
      if (terminal && !terminalDiagnosticsCaptured) {
        terminalDiagnosticsCaptured = true;
        writeFileSync(
          join(attemptDir, 'console-log.json'),
          `${JSON.stringify({ consoleErrors }, null, 2)}\n`,
          'utf8',
        );
        await closeTraceInto('failure-trace.zip');
        writeFileSync(
          join(attemptDir, 'diagnostics-manifest.json'),
          `${JSON.stringify(
            {
              captured: {
                [`${prefix}-screenshot.png`]: 'captured',
                [`${prefix}-dom.html`]: 'captured',
                [`${prefix}.json`]: 'captured',
                'console-log.json': 'captured',
                'failure-trace.zip': 'captured',
              },
              captureFailures: {},
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
      }
    } catch (captureError: unknown) {
      // Diagnostics capture must never mask the original failure — but a
      // capture failure is itself recorded rather than silently absorbed.
      try {
        writeFileSync(
          join(attemptDir, 'diagnostics-manifest.json'),
          `${JSON.stringify(
            {
              captured: {},
              captureFailures: {
                [reason]:
                  captureError instanceof Error ? captureError.message : String(captureError),
              },
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
      } catch {
        // Nothing more can be done without masking the original failure.
      }
    }
  };

  const fail = async (reason: FailureClass, detail: string): Promise<never> => {
    await captureDiagnostics(reason, detail, true);
    throw new AttemptFailure(reason, detail);
  };

  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await field(page, AUTOMATION_FIELDS.workerStatus).filter({ hasText: 'ready' }).waitFor({
      timeout: 60_000,
    });

    // Load-generation token (re-audit §13.3): planted once after the
    // initial load; a reload or navigation produces a fresh window object
    // without it. Checked on every poll alongside the navigation counter.
    const loadToken = `m2-load-${attempt.attemptId}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    await page.evaluate((token) => {
      (window as unknown as Record<string, unknown>).__m2LoadToken = token;
    }, loadToken);
    const baselineNavigations = navigationCount;
    const assertNoNavigation = async (): Promise<void> => {
      if (navigationCount > baselineNavigations) {
        await fail(
          'unexpected-navigation',
          `main frame navigated ${navigationCount - baselineNavigations} time(s) after setup`,
        );
      }
      const token = await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__m2LoadToken,
      );
      if (token !== loadToken) {
        await fail(
          'unexpected-navigation',
          `load token missing or changed (page reloaded): ${String(token)}`,
        );
      }
    };

    // Scenario FIRST, then condition: selecting a scenario while the model
    // condition is active can silently degrade the condition to baseline.
    await page.locator(`#${AUTOMATION_IDS.scenarioSelect}`).selectOption(attempt.scenarioId);
    await page.locator(`#${AUTOMATION_IDS.conditionSelect}`).selectOption(attempt.conditionId);
    const conditionValue = await page.locator(`#${AUTOMATION_IDS.conditionSelect}`).inputValue();
    if (conditionValue !== attempt.conditionId) {
      await fail(
        'condition-not-applied',
        `condition select holds '${conditionValue}', wanted '${attempt.conditionId}'`,
      );
    }

    // Pacing (§19.7/§19.17): select the planned operator speed and assert it.
    const speedRadio = page.locator(`#${AUTOMATION_IDS.speedRadioPrefix}${attempt.speed}`);
    await speedRadio.check();
    if (!(await speedRadio.isChecked())) {
      await fail('speed-not-applied', `speed radio ${attempt.speed} did not latch`);
    }

    if (isModelBackedConditionId(attempt.conditionId)) {
      const gatewayStatus = field(page, AUTOMATION_FIELDS.gatewayStatus);
      try {
        await gatewayStatus.filter({ hasText: AUTOMATION_TEXT.gatewayConnected }).waitFor({
          timeout: 30_000,
        });
      } catch {
        await fail(
          'gateway-not-connected',
          `gateway status is '${await readFieldText(page, AUTOMATION_FIELDS.gatewayStatus)}'`,
        );
      }
    }

    // Static visual checkpoint immediately before Start (sparse profile).
    await captureVisualCheckpoint(
      'before-start',
      await readTick(page),
      await readFieldText(page, AUTOMATION_FIELDS.runStatus),
    );

    // Start the run through the real operator control (§19.7: never
    // run-to-completion for paced attempts — model decisions are async).
    await page.locator(`#${AUTOMATION_IDS.startButton}`).click();

    // Monitor loop: heartbeat, stall watchdog, run timeout, planned
    // gateway stop, completion.
    const startedAt = Date.now();
    let lastTick = -1;
    let lastTickChangeAt = Date.now();
    let lastHeartbeatAt = 0;
    let gatewayStopFired = false;
    let stallDiagnosed = false;
    let gatewayStopEvidence: GatewayStopEvidence | null =
      attempt.gatewayStopAtTick !== undefined
        ? {
            fired: false,
            observedTick: null,
            atUtc: null,
            acceptedResponsesAtStop: null,
            gatewayExit: null,
          }
        : null;

    for (;;) {
      const now = Date.now();
      if (now - startedAt > timeouts.runTimeoutMs) {
        await fail('run-timeout', `wall clock exceeded ${timeouts.runTimeoutMs}ms`);
      }
      await assertNoNavigation();
      const status = await readFieldText(page, AUTOMATION_FIELDS.runStatus);
      const tick = await readTick(page);
      if (tick !== null && tick !== lastTick) {
        lastTick = tick;
        lastTickChangeAt = now;
        stallDiagnosed = false;
      }

      if (now - lastHeartbeatAt >= timeouts.heartbeatIntervalMs) {
        lastHeartbeatAt = now;
        const heartbeat = {
          attemptId: attempt.attemptId,
          atUtc: new Date(now).toISOString(),
          tick,
          runStatus: status,
          gatewayStatus: await readFieldText(page, AUTOMATION_FIELDS.gatewayStatus),
          pendingRequest: await readFieldText(page, AUTOMATION_FIELDS.pendingRequest),
          queuedRequests: await readFieldText(page, AUTOMATION_FIELDS.queuedRequests),
          callsAttempted: await readFieldText(page, AUTOMATION_FIELDS.callsAttempted),
          gatewayResponses: await readFieldText(page, AUTOMATION_FIELDS.gatewayResponses),
          acceptedModelResponses: await readFieldText(
            page,
            AUTOMATION_FIELDS.acceptedModelResponses,
          ),
          lastModelLatency: await readFieldText(page, AUTOMATION_FIELDS.modelLatency),
          traceChunksWritten: traceChunkIndex,
          traceBytesWritten: traceBytesTotal,
        };
        appendFileSync(heartbeatPath, `${JSON.stringify(heartbeat)}\n`);
      }

      // Trace-chunk rotation + evidence forecast (Phase 4, §8.2): rotate
      // the open chunk on the configured cadence; at each rotation,
      // extrapolate cumulative trace bytes to the attempt's full wall-clock
      // allowance and fail EARLY when the projection would exceed the
      // sequence evidence budget.
      if (now - chunkStartedAt >= chunkIntervalMs) {
        await rotateTraceChunk();
        // Static visual checkpoint at every rotation (sparse profile).
        await captureVisualCheckpoint(`rotation-${traceChunkIndex}`, tick, status);
        const forecast = options.evidenceForecast;
        if (forecast !== undefined) {
          // Rate and horizon share one origin: bytes accumulated since
          // tracing started, projected over the full tracing window the
          // attempt may use (setup already spent + the run's wall-clock
          // allowance).
          const elapsedTraceMs = Math.max(now - traceStartedAt, 1);
          const traceHorizonMs = startedAt - traceStartedAt + timeouts.runTimeoutMs;
          const projectedTraceBytes = Math.ceil(
            (traceBytesTotal * traceHorizonMs) / elapsedTraceMs,
          );
          const projectedRootBytes = forecast.rootBytesAtStart + projectedTraceBytes;
          if (projectedRootBytes > forecast.budgetBytes) {
            await fail(
              'evidence-budget-exceeded',
              `forecast: ${traceBytesTotal} trace bytes after ${elapsedTraceMs}ms project to ` +
                `${projectedRootBytes} total bytes over the ${forecast.budgetBytes}-byte budget`,
            );
          }
        }
      }

      if (
        options.onGatewayStopTick &&
        attempt.gatewayStopAtTick !== undefined &&
        !gatewayStopFired &&
        tick !== null &&
        tick >= attempt.gatewayStopAtTick
      ) {
        gatewayStopFired = true;
        const acceptedAtStop = await readFieldText(page, AUTOMATION_FIELDS.acceptedModelResponses);
        const gatewayExit = await options.onGatewayStopTick();
        gatewayStopEvidence = {
          fired: true,
          observedTick: tick,
          atUtc: new Date().toISOString(),
          acceptedResponsesAtStop: acceptedAtStop,
          gatewayExit,
        };
      }

      if (status === AUTOMATION_TEXT.runStatusComplete) break;

      // Stall watchdog (§19.9): capture diagnostics first, allow one grace
      // period, then fail the attempt. Never silently reload and continue.
      if (
        status === AUTOMATION_TEXT.runStatusRunning &&
        now - lastTickChangeAt > timeouts.stallTimeoutMs
      ) {
        if (!stallDiagnosed) {
          stallDiagnosed = true;
          await captureDiagnostics(
            'simulation-stall-diagnostics',
            `tick ${lastTick} unchanged for ${now - lastTickChangeAt}ms — grace period begins`,
            false,
          );
          await new Promise((resolve) => setTimeout(resolve, timeouts.stallGraceMs));
          continue;
        }
        await fail(
          'simulation-stall',
          `tick ${lastTick} unchanged past stall timeout + grace while status 'running'`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const finalTick = (await readTick(page)) ?? -1;
    // Static visual checkpoint at completion (sparse profile) — the
    // existing full-page final-screenshot.png is preserved separately.
    await captureVisualCheckpoint(
      'completion',
      finalTick,
      await readFieldText(page, AUTOMATION_FIELDS.runStatus),
    );
    const runIdText = await readFieldText(page, AUTOMATION_FIELDS.runId);
    const runId =
      isModelBackedConditionId(attempt.conditionId) && runIdText !== '—' && runIdText !== ''
        ? runIdText
        : null;

    // Ledger download (§19.7): straight into the attempt directory under the
    // app's own suggested filename (the ledger-*.json contract).
    const ledgerDownloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.locator(`#${AUTOMATION_IDS.exportLedgerButton}`).click();
    const ledgerDownload = await ledgerDownloadPromise;
    const ledgerPath = join(attemptDir, ledgerDownload.suggestedFilename());
    await ledgerDownload.saveAs(ledgerPath);

    // Run-bundle download: model attempts only. The export button enables
    // once the run is complete AND the gateway client is settled; the click
    // itself awaits settlement before producing the file.
    let bundlePath: string | null = null;
    if (isModelBackedConditionId(attempt.conditionId)) {
      const exportButton = page.locator(`#${AUTOMATION_IDS.exportBundleButton}`);
      try {
        await exportButton.waitFor({ state: 'visible', timeout: 10_000 });
        await pollUntil(async () => exportButton.isEnabled(), 60_000);
      } catch {
        await fail(
          'bundle-export-not-enabled',
          'run-bundle export never became enabled after completion',
        );
      }
      const bundleDownloadPromise = page.waitForEvent('download', { timeout: 120_000 });
      await exportButton.click();
      const bundleDownload = await bundleDownloadPromise;
      bundlePath = join(attemptDir, bundleDownload.suggestedFilename());
      await bundleDownload.saveAs(bundlePath);
    }

    // In-browser replay gate (§19.4/§19.7): 'Replay latest' must report a
    // hash match before the page closes.
    await page.locator(`#${AUTOMATION_IDS.replayLatestButton}`).click();
    const replayField = field(page, AUTOMATION_FIELDS.replayMatch);
    const replayDeadline = Date.now() + 120_000;
    let replayVerdict = '';
    for (;;) {
      replayVerdict = (await replayField.textContent()) ?? '';
      if (
        replayVerdict.trim() !== '' &&
        replayVerdict.trim() !== AUTOMATION_TEXT.replayVerdictPending
      ) {
        break;
      }
      if (Date.now() > replayDeadline) {
        await fail('replay-verdict-timeout', 'replay verdict never rendered');
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!replayVerdict.trim().startsWith(AUTOMATION_TEXT.replayMatchPrefix)) {
      await fail('replay-mismatch', `in-browser replay verdict: '${replayVerdict.trim()}'`);
    }
    await assertNoNavigation();

    // Always-saved attempt diagnostics (audit finding 6): the trace, final
    // screenshot, final DOM, and console/page errors are preserved for EVERY
    // attempt — a later finalization-stage failure can reference them even
    // though this context is already closed. A diagnostic manifest records
    // exactly what was captured and any capture failure.
    const captured: Record<string, string> = {};
    const captureFailures: Record<string, string> = {};
    await captureArtifact(captured, captureFailures, 'attempt-trace.zip', async () => {
      await closeTraceInto('attempt-trace.zip');
    });
    await captureArtifact(captured, captureFailures, 'final-screenshot.png', async () => {
      await page.screenshot({ path: join(attemptDir, 'final-screenshot.png'), fullPage: true });
    });
    await captureArtifact(captured, captureFailures, 'final-dom.html', async () => {
      writeFileSync(join(attemptDir, 'final-dom.html'), await page.content(), 'utf8');
    });
    await captureArtifact(captured, captureFailures, 'console-log.json', async () => {
      writeFileSync(
        join(attemptDir, 'console-log.json'),
        `${JSON.stringify({ consoleErrors }, null, 2)}\n`,
        'utf8',
      );
    });
    writeFileSync(
      join(attemptDir, 'diagnostics-manifest.json'),
      `${JSON.stringify({ captured, captureFailures }, null, 2)}\n`,
      'utf8',
    );

    return {
      runId,
      ledgerPath,
      bundlePath,
      finalTick,
      heartbeatCount: countLines(heartbeatPath),
      consoleErrors,
      replayVerdict: replayVerdict.trim(),
      gatewayStop: gatewayStopEvidence,
      navigationCount,
    };
  } catch (error: unknown) {
    // Every failure path — including raw Playwright throws (selector
    // timeouts, download timeouts, navigation errors) that never went
    // through fail(), AND typed failures thrown by caller-supplied hooks
    // like the planned-stop trigger — must leave §19.7 diagnostics.
    // fail() already captured (the terminal flag records that); anything
    // else captures here before rethrowing as a typed failure.
    if (error instanceof AttemptFailure) {
      if (!terminalDiagnosticsCaptured) {
        await captureDiagnostics(error.reason, error.message, true);
      }
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    await captureDiagnostics('browser-error', detail, true);
    throw new AttemptFailure('browser-error', detail);
  } finally {
    await context.close().catch(() => undefined);
  }
}

function countLines(path: string): number {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '').length;
  } catch {
    return 0;
  }
}

/** Polls an async predicate until true or timeout. */
async function pollUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('wait-timeout');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
