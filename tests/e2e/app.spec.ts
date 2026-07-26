import { expect, test, type Page } from '@playwright/test';

/**
 * Browser end-to-end coverage (brief section 19). These tests assert semantic
 * DOM state, worker-derived data, and canonical hashes — not pixels. The
 * Three.js canvas gets a rendering smoke test plus real raycast picking.
 */

const consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors.length = 0;
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await page.goto('/');
  // The worker must connect and deliver an initial snapshot.
  await expect(page.locator('[data-field="worker-status"]')).toContainText('ready');
  await expect(page.locator('[data-field="time"]')).toContainText('tick 0');
});

async function field(page: Page, name: string) {
  return page.locator(`[data-field="${name}"]`);
}

test('boots cleanly: canvas, controls, initial snapshot, no console errors', async ({ page }) => {
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect(page.locator('#scenario-select')).toBeVisible();
  await expect(page.locator('#btn-start')).toBeEnabled();
  await expect(await field(page, 'scenario')).toContainText('A v1.0.0');
  await expect(await field(page, 'progress')).toContainText('60.00%');
  await expect(await field(page, 'meal')).toContainText('reserved for rin');
  expect(consoleErrors).toEqual([]);
});

test('start, pause, resume, step, speed change, and reset drive the run', async ({ page }) => {
  await page.locator('#btn-start').click();
  await expect(await field(page, 'status')).toHaveText('running');
  await page.locator('#btn-pause').click();
  await expect(await field(page, 'status')).toHaveText('paused');

  // Single-tick stepping while paused.
  const timeText = await (await field(page, 'time')).textContent();
  await page.locator('#btn-step').click();
  await expect(await field(page, 'time')).not.toHaveText(timeText ?? '');

  // Speed selection is reflected in the global panel.
  await page.locator('#speed-20').check();
  await expect(await field(page, 'speed')).toHaveText('20×');

  await page.locator('#btn-resume').click();
  await expect(await field(page, 'status')).toHaveText('running');
  await page.locator('#btn-pause').click();

  await page.locator('#btn-reset').click();
  await expect(await field(page, 'time')).toContainText('tick 0');
  await expect(await field(page, 'status')).toHaveText('idle');
  expect(consoleErrors).toEqual([]);
});

test('run to completion produces a final hash and matching live replay', async ({ page }) => {
  await page.locator('#btn-run-complete').click();
  await expect(await field(page, 'status')).toHaveText('complete');
  await expect(await field(page, 'time')).toContainText('45:00');
  await expect(await field(page, 'final-hash')).toContainText(/[0-9a-f]{16}/);
  await expect(await field(page, 'deadline')).toContainText('completed');

  await page.locator('#btn-replay-live').click();
  await expect(await field(page, 'replay-match')).toContainText('match');
  expect(consoleErrors).toEqual([]);
});

test('clicking an NPC in the viewport and in the HTML list updates the inspector', async ({
  page,
}) => {
  // HTML list path.
  await page.locator('#npc-tab-jonas').click();
  await expect(await field(page, 'npc-goal')).toContainText('Keep the group functioning');
  await expect(await field(page, 'npc-commitment')).toContainText('owes relief');

  // Three.js raycast path: click just below Rin's floating label.
  const label = page.locator('.npc-label[data-npc-id="rin"]');
  const canvas = page.locator('#viewport canvas');
  const canvasBox = await canvas.boundingBox();
  let picked = false;
  for (const offsetY of [18, 30, 42, 55]) {
    const labelBox = await label.boundingBox();
    if (!labelBox || !canvasBox) break;
    await page.mouse.click(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height + offsetY);
    const selected = await page.locator('#inspector-panel').getAttribute('data-selected-npc');
    if (selected === 'rin') {
      picked = true;
      break;
    }
  }
  expect(picked).toBe(true);
  await expect(await field(page, 'npc-goal')).toContainText('Protect her health');
  expect(consoleErrors).toEqual([]);
});

test('scenario E visibly reports the stale-action rejection', async ({ page }) => {
  await page.locator('#scenario-select').selectOption('E');
  await expect(await field(page, 'scenario')).toContainText('E v1.0.0');
  // Step deterministically past the scripted meal removal (tick 200) and the
  // stale-eat rejection at arrival (tick 210): four operator steps of 60.
  await page.locator('#step-count').selectOption('60');
  for (let i = 0; i < 4; i += 1) {
    await page.locator('#btn-step').click();
  }
  await expect(await field(page, 'time')).toContainText('tick 240');
  await expect(await field(page, 'meal')).toContainText('removed');
  const rejectionRow = page
    .locator('#event-log-body .event-row[data-event-type="ActionRejected"]')
    .first();
  await expect(rejectionRow).toBeVisible();
  await expect(rejectionRow).toContainText('meal-missing');

  await page.locator('#btn-run-complete').click();
  await expect(await field(page, 'status')).toHaveText('complete');
  await expect(await field(page, 'final-hash')).toContainText(/[0-9a-f]{16}/);
  expect(consoleErrors).toEqual([]);
});

test('scenario F visibly reports provider failure and fallback while continuing', async ({
  page,
}) => {
  await page.locator('#scenario-select').selectOption('F');
  await expect(await field(page, 'scenario')).toContainText('F v1.0.0');
  // Step to just past the provider-failure activation at minute 10 (tick 600).
  await page.locator('#step-count').selectOption('300');
  await page.locator('#btn-step').click();
  await page.locator('#btn-step').click();
  await page.locator('#btn-step').click();
  await expect(await field(page, 'time')).toContainText('tick 900');
  await page.locator('#btn-run-complete').click();
  await expect(await field(page, 'status')).toHaveText('complete');
  // Fallback decisions are visible in the event log and inspector.
  await page.locator('#npc-tab-mara').click();
  await expect(await field(page, 'npc-decision')).toContainText('fallback');
  await expect(
    page.locator('#event-log-body .event-row[data-event-type="DecisionProviderFailed"]').first(),
  ).toBeVisible();
  await expect(
    page.locator('#event-log-body .event-row[data-event-type="FallbackDecisionUsed"]').first(),
  ).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('export, import, and replay round-trip to a matching hash', async ({ page }) => {
  await page.locator('#btn-run-complete').click();
  await expect(await field(page, 'status')).toHaveText('complete');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#btn-export-ledger').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^ledger-A-.*\.json$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const fileText = Buffer.concat(chunks).toString('utf8');
  expect(fileText).toContain('"finalStateHash"');

  await page.locator('#import-file').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(fileText, 'utf8'),
  });
  await expect(await field(page, 'import-status')).toContainText('valid (scenario A)');

  await page.locator('#btn-replay-imported').click();
  await expect(await field(page, 'replay-match')).toContainText('match');
  expect(consoleErrors).toEqual([]);
});

test('a corrupted import is rejected without touching the run', async ({ page }) => {
  await page.locator('#btn-step').click();
  await expect(await field(page, 'time')).toContainText('tick 1');
  const eventCount = await (await field(page, 'event-count')).textContent();
  await page.locator('#import-file').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"formatVersion": 1, "truncated": tru', 'utf8'),
  });
  await expect(await field(page, 'import-status')).toContainText('rejected');
  await expect(await field(page, 'event-count')).toHaveText(eventCount ?? '');
  await expect(page.locator('#btn-replay-imported')).toBeDisabled();
});

test('in-browser batch, validation, and diagnostics leave canonical state untouched', async ({
  page,
}) => {
  await page.locator('#btn-step').click();
  await expect(await field(page, 'time')).toContainText('tick 1');
  const stateVersion = await (await field(page, 'state-version')).textContent();
  const eventCount = await (await field(page, 'event-count')).textContent();

  // Validate Configuration uses the same shared rules as `npm run validate`.
  await page.locator('#btn-validate').click();
  await expect(await field(page, 'validation-status')).toContainText('valid (0 errors)');

  // Run the complete in-browser batch.
  await page.locator('#btn-run-batch').click();
  await expect(await field(page, 'batch-status')).toContainText('PASS — 7 scenarios', {
    timeout: 60_000,
  });

  // Toggling diagnostics changes nothing canonical.
  await page.locator('#toggle-scores').click();
  await page.locator('#toggle-event-log').click();
  await page.locator('#toggle-event-log').click();
  await expect(await field(page, 'state-version')).toHaveText(stateVersion ?? '');
  await expect(await field(page, 'event-count')).toHaveText(eventCount ?? '');

  // Batch report export produces both files.
  const first = page.waitForEvent('download');
  await page.locator('#btn-export-batch-report').click();
  const download = await first;
  expect(['batch-report.json', 'batch-report.md']).toContain(download.suggestedFilename());
  expect(consoleErrors).toEqual([]);
});
