import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { createManualSymbiontBrowserHost } from '../fixtures/manual-symbiont-e2e.js';

test.use({ channel: 'chrome' });

async function clickAction(page: Page, key: string): Promise<void> {
  await page.locator(`[data-atlas-action-key="${key}"]`).click();
}

for (const mode of ['MANUAL', 'AUTO'] as const) {
  test(`CHR-022 ${mode} preserves weapon and armor through return, reload and restart`, async ({
    page,
  }) => {
    const host = await createManualSymbiontBrowserHost({
      compositionReplacements: [['EEL']],
      diceInputMode: mode,
      prefix: `weapon-${mode.toLowerCase()}-e2e`,
      raceChoice: 'FREE',
      sampleFaces: mode === 'AUTO' ? [16, 1] : [],
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(host.baseURL);
      await clickAction(page, 'CHR-019::CTA::001');
      await page.getByRole('button', { name: 'Добавить Кожаный доспех', exact: true }).click();
      if (mode === 'MANUAL') await page.locator('#armor-quality-face').fill('16');
      await page
        .getByRole('button', { name: 'Зафиксировать один бросок качества', exact: true })
        .click();
      await expect(page.getByLabel('Рекомендация качества', { exact: true })).toContainText(
        'Хорошее',
      );
      await clickAction(page, 'CHR-021::CTA::001');
      await expect(page.getByLabel('Стартовое оружие', { exact: true })).toBeVisible();

      const allocationsAtEntry = host.rollRequestAllocations();
      expect(allocationsAtEntry).toBe(3);
      const roll = page.getByRole('button', {
        name: 'Зафиксировать один бросок качества оружия',
        exact: true,
      });
      await expect(roll).toBeDisabled();
      await expect(page.getByRole('radio', { name: /Кенси/ })).toHaveCount(0);
      await page.getByRole('radio', { name: /Лёгкий арбалет/ }).check();
      await expect(page.getByLabel('Требования оружия', { exact: true })).toContainText('Стрельба');
      // Local selection is reversible until its first displayed roll.
      await page.reload();
      await expect(page.getByRole('radio', { name: /Лёгкий арбалет/ })).not.toBeChecked();
      await page.getByRole('radio', { name: /Лёгкий арбалет/ }).check();
      if (mode === 'MANUAL') {
        await expect(page.locator('#weapon-quality-face')).toHaveValue('');
        await expect(roll).toBeDisabled();
        await page.locator('#weapon-quality-face').fill('1');
      }
      await roll.click();
      await expect(page.getByLabel('Зафиксированное оружие', { exact: true })).toContainText(
        'Лёгкий арбалет',
      );
      await expect(page.getByLabel('Рекомендация качества оружия', { exact: true })).toContainText(
        'Отсутствует/непригоден',
      );
      await expect(page.locator('#weapon-quality-face')).toHaveCount(0);
      await expect(page.getByRole('radio')).toHaveCount(0);
      expect(host.sampleCalls()).toBe(mode === 'AUTO' ? 2 : 0);
      const receipts = host.receiptAllocations();

      await clickAction(page, 'CHR-022::CTA::003');
      await expect(page.getByLabel('Зафиксированный комплект', { exact: true })).toContainText(
        'Кожаный доспех',
      );
      await expect(page.getByLabel('Рекомендация качества', { exact: true })).toContainText(
        'Хорошее',
      );
      await expect(page.locator('[data-atlas-action-key="CHR-021::CTA::003"]')).toHaveCount(0);
      await page.reload();
      await expect(page.getByLabel('Зафиксированный комплект', { exact: true })).toBeVisible();
      await clickAction(page, 'CHR-021::CTA::001');
      await expect(page.getByLabel('Зафиксированное оружие', { exact: true })).toContainText(
        'Лёгкий арбалет',
      );
      expect(host.receiptAllocations()).toBe(receipts);
      expect(host.rollRequestAllocations()).toBe(allocationsAtEntry);

      await host.restart();
      await page.goto(host.baseURL);
      await expect(page.getByLabel('Рекомендация качества оружия', { exact: true })).toContainText(
        'Отсутствует/непригоден',
      );
      await clickAction(page, 'CHR-022::CTA::001');
      await expect(page.getByText('Оружие подтверждено.', { exact: false })).toBeVisible();
      await expect(page.locator('[data-atlas-action-key^="CHR-022"]')).toHaveCount(0);
      await expect(
        page.locator('[data-atlas-form-id="CHR-023"], [data-atlas-form-id="CHR-024"]'),
      ).toHaveCount(0);
      await page.reload();
      await expect(page.getByText('Оружие подтверждено.', { exact: false })).toBeVisible();
      await host.restart();
      await page.goto(host.baseURL);
      await expect(page.getByText('Оружие подтверждено.', { exact: false })).toBeVisible();
      expect(host.receiptAllocations()).toBe(receipts + 1);
      expect(host.rollRequestAllocations()).toBe(allocationsAtEntry);
      expect(host.sampleCalls()).toBe(mode === 'AUTO' ? 2 : 0);
      expect(await page.locator('body').innerText()).not.toMatch(
        /(?:CORE|AQ2|F-WPN)-\d+|Источник|availabilityTrace|qualityTier/,
      );
      await expect(page.locator('[data-client-state="protocol-error"]')).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await host.close();
    }
  });
}
