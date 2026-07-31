import { expect, test } from '@playwright/test';
import {
  AUTOMATION_FIELDS,
  AUTOMATION_IDS,
  AUTOMATION_SPEEDS,
} from '../../src/shared/automationContract';

/**
 * Automation-contract pin (M2 brief §19.7): every selector the unattended
 * orchestrator drives must resolve in the real DOM. A UI rename fails HERE,
 * in CI, instead of stranding an unattended sequence at 2 a.m.
 */

test('every automation-contract selector resolves in the live DOM', async ({ page }) => {
  await page.goto('/');
  // Substring semantics, matching the driver: the field renders
  // 'ready — snapshot #N'.
  await expect(page.locator(`[data-field="${AUTOMATION_FIELDS.workerStatus}"]`)).toContainText(
    'ready',
    { timeout: 30_000 },
  );

  for (const [name, id] of Object.entries(AUTOMATION_IDS)) {
    if (name === 'speedRadioPrefix') continue;
    await expect(page.locator(`#${id}`), `id ${name} (#${id})`).toHaveCount(1);
  }
  for (const speed of AUTOMATION_SPEEDS) {
    await expect(
      page.locator(`#${AUTOMATION_IDS.speedRadioPrefix}${speed}`),
      `speed radio ${speed}`,
    ).toHaveCount(1);
  }
  for (const [name, fieldName] of Object.entries(AUTOMATION_FIELDS)) {
    await expect(
      page.locator(`[data-field="${fieldName}"]`),
      `field ${name} (${fieldName})`,
    ).toHaveCount(1);
  }
});
