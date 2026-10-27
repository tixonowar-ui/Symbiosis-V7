import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { createManualSymbiontBrowserHost } from '../fixtures/manual-symbiont-e2e.js';

test.use({ channel: 'chrome' });

async function clickAction(page: Page, actionKey: string): Promise<void> {
  await page.locator(`[data-atlas-action-key="${actionKey}"]`).click();
}

async function expectNoProtocolError(page: Page, pageErrors: readonly string[]): Promise<void> {
  await expect(page.locator('[data-client-state="protocol-error"]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
}

test('FREE MANUAL starting armor bundle rolls one manual D20 and checkpoints actionless', async ({
  page,
}) => {
  const host = await createManualSymbiontBrowserHost({
    diceInputMode: 'MANUAL',
    prefix: 'armor-e2e',
    raceChoice: 'FREE',
    sampleFaces: [],
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(host.baseURL);
    await expect(page.locator('[data-manual-form="CHR-017"]')).toBeVisible();

    await page.locator('[data-manual-open-species="EEL"]').click();
    await expect(page.locator('[data-manual-form="CHR-018"]')).toBeVisible();
    await page.locator('#manual-include-current').check();
    await clickAction(page, 'CHR-018::CTA::001');
    await expect(page.locator('[data-chr-019-composition]')).toBeVisible();

    await clickAction(page, 'CHR-019::CTA::001');
    await expect(page.locator('[aria-label="Стартовый комплект брони"]')).toBeVisible();
    await expect(page.locator('#armor-quality-face')).toBeVisible();
    await expect(page.locator('[data-atlas-action-key="CHR-021::CTA::003"]')).toHaveCount(0);
    expect(host.sampleCalls()).toBe(0);

    await page.locator('#armor-zone-ITM-ARM-001').selectOption('HEAD');
    await page.locator('button[aria-label="Добавить Кожаный доспех"]').click();
    await page.locator('#armor-zone-ITM-ARM-002').selectOption('TORSO');
    await page.locator('button[aria-label="Добавить Бригантина"]').click();
    await expect(page.locator('button[aria-label="Убрать Голова"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Убрать Корпус"]')).toBeVisible();

    await page.locator('#armor-quality-face').fill('16');
    await page.locator('button', { hasText: 'Зафиксировать один бросок качества' }).click();
    await expect(page.locator('[aria-label="Зафиксированный комплект"]')).toBeVisible();
    await expect(page.locator('[aria-label="Рекомендация качества"]')).toContainText(
      'Хорошее (15–18)',
    );
    await expect(page.locator('#armor-quality-face')).toHaveCount(0);
    expect(host.sampleCalls()).toBe(0);

    await clickAction(page, 'CHR-021::CTA::002');
    await expect(page.locator('[data-manual-form="CHR-019"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[aria-label="Зафиксированный комплект"]')).toBeVisible();

    await clickAction(page, 'CHR-021::CTA::001');
    await expect(page.locator('text=Комплект подтверждён')).toBeVisible();
    await expect(page.locator('[data-atlas-action-key^="CHR-021"]')).toHaveCount(0);
    await expect(page.locator('[data-atlas-action-key^="CHR-022"]')).toHaveCount(0);
    await expect(page.locator('#armor-quality-face')).toHaveCount(0);

    const receipts = host.receiptAllocations();
    await host.restart();
    await page.goto(host.baseURL);
    await expect(page.locator('text=Комплект подтверждён')).toBeVisible();
    expect(host.receiptAllocations()).toBe(receipts);
    expect(host.sampleCalls()).toBe(0);
    await expectNoProtocolError(page, pageErrors);
  } finally {
    await host.close();
  }
});
