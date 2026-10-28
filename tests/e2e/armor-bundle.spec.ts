import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { createManualSymbiontBrowserHost } from '../fixtures/manual-symbiont-e2e.js';
import { createRandomSymbiontBrowserHost } from '../fixtures/random-symbiont-e2e.js';

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
    await clickAction(page, 'CHR-019::CTA::004');
    await expect(page.locator('[data-manual-form="CHR-017"]')).toBeVisible();
    await clickAction(page, 'CHR-017::CTA::002');
    await expect(page.locator('[data-manual-form="CHR-019"]')).toBeVisible();
    await clickAction(page, 'CHR-019::CTA::001');
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

test('UNITED confirms the exact interaction diff before entering starting armor', async ({
  page,
}) => {
  const host = await createManualSymbiontBrowserHost({
    compositionReplacements: [
      ['TROGR', 'OWL', 'WEAVER', 'CRICKET'],
      ['TROGR', 'TEACHER', 'WEAVER', 'CRICKET'],
    ],
    diceInputMode: 'MANUAL',
    prefix: 'armor-interaction-e2e',
    raceChoice: 'UNITED',
    sampleFaces: [],
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(host.baseURL);
    await expect(page.locator('[data-chr-019-composition]')).toBeVisible();
    await expect(page.locator('[data-atlas-action-key="CHR-019::CTA::001"]')).toHaveCount(0);
    await clickAction(page, 'CHR-019::CTA::002');
    await expect(page.locator('[data-manual-form="CHR-042"]')).toBeVisible();
    await expect(page.locator('[data-preview-operation="ABSORPTION"]')).toBeVisible();
    await expect(page.locator('[data-atlas-action-key="CHR-042::CTA::001"]')).toBeVisible();

    const receiptsBefore = host.receiptAllocations();
    await clickAction(page, 'CHR-042::CTA::001');
    await expect(page.locator('[aria-label="Стартовый комплект брони"]')).toBeVisible();
    expect(host.receiptAllocations()).toBe(receiptsBefore + 1);
    expect(host.rollRequestAllocations()).toBe(2);
    await expectNoProtocolError(page, pageErrors);

    const receipts = host.receiptAllocations();
    await host.restart();
    await page.goto(host.baseURL);
    await expect(page.locator('[aria-label="Стартовый комплект брони"]')).toBeVisible();
    expect(host.receiptAllocations()).toBe(receipts);
    expect(host.rollRequestAllocations()).toBe(2);
    await expectNoProtocolError(page, pageErrors);
  } finally {
    await host.close();
  }
});

test('FREE RANDOM safe-returns and resumes the same armor bundle without a new request', async ({
  page,
}) => {
  const host = await createRandomSymbiontBrowserHost({
    diceInputMode: 'AUTO',
    prefix: 'armor-random-e2e',
    raceChoice: 'FREE',
    sampleFaces: [15, 16],
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(host.baseURL);
    await page
      .getByRole('button', { name: 'Начать сохранённую случайную ветвь', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: 'Зафиксировать случайное определение симбионтов',
        exact: true,
      })
      .click();
    await expect(page.locator('[data-chr-020-random]')).toHaveAttribute(
      'data-random-status',
      'BINDING',
    );
    await page
      .getByRole('button', {
        name: 'Зафиксировать случайное определение симбионтов',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Состав симбионтов только для чтения', exact: true }),
    ).toBeVisible();

    await clickAction(page, 'CHR-019::CTA::001');
    await expect(page.locator('[aria-label="Стартовый комплект брони"]')).toBeVisible();
    await page.locator('button[aria-label="Добавить Кожаный доспех"]').click();
    await page.locator('button', { hasText: 'Зафиксировать один бросок качества' }).click();
    await expect(page.locator('[aria-label="Зафиксированный комплект"]')).toBeVisible();
    expect(host.sampleCalls()).toBe(2);
    const rollRequests = host.rollRequestAllocations();
    const receipts = host.receiptAllocations();

    await clickAction(page, 'CHR-021::CTA::002');
    await expect(
      page.getByRole('heading', { name: 'Состав симбионтов только для чтения', exact: true }),
    ).toBeVisible();
    await clickAction(page, 'CHR-019::CTA::001');
    await expect(page.locator('[aria-label="Зафиксированный комплект"]')).toBeVisible();
    expect(host.rollRequestAllocations()).toBe(rollRequests);
    expect(host.receiptAllocations()).toBe(receipts);
    expect(host.sampleCalls()).toBe(2);

    await clickAction(page, 'CHR-021::CTA::001');
    await expect(page.locator('text=Комплект подтверждён')).toBeVisible();
    await expect(page.locator('[data-atlas-action-key^="CHR-021"]')).toHaveCount(0);
    await expect(page.locator('[data-atlas-action-key^="CHR-022"]')).toHaveCount(0);
    await expectNoProtocolError(page, pageErrors);
  } finally {
    await host.close();
  }
});
