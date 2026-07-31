import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  AUTOMATION_FIELDS,
  AUTOMATION_IDS,
  AUTOMATION_TEXT,
} from '../../../src/shared/automationContract';
import type { PlannedAttempt } from './planSchema';

/**
 * Playwright browser driver for one attempt (M2 brief §19.7–§19.10).
 *
 * Drives the REAL operator surface — the same selects, buttons, and
 * downloads a human uses — through the automation contract's stable
 * selectors, polling semantic DOM state (never pixels). Every attempt gets
 * a fresh browser context and page (§19.5); downloads land directly in the
 * attempt directory (§19.7); a machine-readable heartbeat is appended on a
 * fixed cadence (§19.9); a stall watchdog and a wall-clock timeout convert
 * hangs into preserved failed attempts (§19.9–§19.10); and every failure
 * captures a screenshot, DOM snapshot, console/page errors, and a
 * Playwright trace before the context closes.
 */

export class AttemptFailure extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'AttemptFailure';
    this.reason = reason;
  }
}

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
  const context: BrowserContext = await browser.newContext({ acceptDownloads: true });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

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
        await context.tracing.stop({ path: join(attemptDir, 'failure-trace.zip') });
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

  const fail = async (reason: string, detail: string): Promise<never> => {
    await captureDiagnostics(reason, detail, true);
    throw new AttemptFailure(reason, detail);
  };

  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await field(page, AUTOMATION_FIELDS.workerStatus).filter({ hasText: 'ready' }).waitFor({
      timeout: 60_000,
    });

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

    if (attempt.conditionId === 'mara-model-per-decision-v1') {
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
        };
        appendFileSync(heartbeatPath, `${JSON.stringify(heartbeat)}\n`);
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
    const runIdText = await readFieldText(page, AUTOMATION_FIELDS.runId);
    const runId =
      attempt.conditionId === 'mara-model-per-decision-v1' && runIdText !== '—' && runIdText !== ''
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
    if (attempt.conditionId === 'mara-model-per-decision-v1') {
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

    // Always-saved attempt diagnostics (audit finding 6): the trace, final
    // screenshot, final DOM, and console/page errors are preserved for EVERY
    // attempt — a later finalization-stage failure can reference them even
    // though this context is already closed. A diagnostic manifest records
    // exactly what was captured and any capture failure.
    const captured: Record<string, string> = {};
    const captureFailures: Record<string, string> = {};
    const tryCapture = async (name: string, action: () => Promise<void>): Promise<void> => {
      try {
        await action();
        captured[name] = 'captured';
      } catch (captureError: unknown) {
        captureFailures[name] =
          captureError instanceof Error ? captureError.message : String(captureError);
      }
    };
    await tryCapture('attempt-trace.zip', async () => {
      await context.tracing.stop({ path: join(attemptDir, 'attempt-trace.zip') });
    });
    await tryCapture('final-screenshot.png', async () => {
      await page.screenshot({ path: join(attemptDir, 'final-screenshot.png'), fullPage: true });
    });
    await tryCapture('final-dom.html', async () => {
      writeFileSync(join(attemptDir, 'final-dom.html'), await page.content(), 'utf8');
    });
    await tryCapture('console-log.json', async () => {
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
    };
  } catch (error: unknown) {
    // Every failure path — including raw Playwright throws (selector
    // timeouts, download timeouts, navigation errors) that never went
    // through fail() — must leave §19.7 diagnostics. fail() already
    // captured; anything else captures here before rethrowing as a typed
    // failure.
    if (error instanceof AttemptFailure) throw error;
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
