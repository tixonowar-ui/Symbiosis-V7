import { expect, test, type Page } from '@playwright/test';
import { createManualSymbiontBrowserHost } from '../fixtures/manual-symbiont-e2e.js';

test.use({ channel: 'chrome' });
const action = (page: Page, key: string) =>
  page.locator(`[data-atlas-action-key="${key}"]`).click();
async function armorAndWeapon(page: Page, weapon: string, manual: boolean): Promise<void> {
  await page.getByRole('button', { name: 'Добавить Кожаный доспех', exact: true }).click();
  if (manual) await page.locator('#armor-quality-face').fill('16');
  await page
    .getByRole('button', { name: 'Зафиксировать один бросок качества', exact: true })
    .click();
  await action(page, 'CHR-021::CTA::001');
  await page.getByRole('radio', { name: new RegExp(weapon) }).check();
  if (manual) await page.locator('#weapon-quality-face').fill('19');
  await page
    .getByRole('button', { name: 'Зафиксировать один бросок качества оружия', exact: true })
    .click();
}
test('CHR-023 proves one complete profile, restores CHR-031 and submits without manufacturing rolls', async ({
  page,
}) => {
  const host = await createManualSymbiontBrowserHost({
    prefix: 'profile-formula-e2e',
    raceChoice: 'FREE',
    diceInputMode: 'MANUAL',
    compositionReplacements: [['EEL']],
    sampleFaces: [],
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(host.baseURL);
    await action(page, 'CHR-019::CTA::001');
    await armorAndWeapon(page, 'Лёгкий арбалет', true);
    await action(page, 'CHR-022::CTA::001');
    await expect(page.getByLabel('Формульный профиль оружия', { exact: true })).toBeVisible();
    const allocations = host.rollRequestAllocations();
    const receiptCount = host.receiptAllocations();
    await action(page, 'CHR-023::CTA::002');
    await expect(page.getByLabel('Зафиксированное оружие', { exact: true })).toContainText(
      'Лёгкий арбалет',
    );
    await page.reload();
    await action(page, 'CHR-022::CTA::001');
    expect(host.rollRequestAllocations()).toBe(allocations);
    expect(host.receiptAllocations()).toBe(receiptCount);
    const inputs = {
      commonWitness: { L: 0, Lw: 1, Ls: 0 },
      independentDice: { R12_DMG: 2, R12_RANGE: 2, R20_RS: 20 },
      formulaOutputs: { Dm: 3, Rn: 4, Rs: 1, Rd: 8 },
    };
    for (const [group, values] of Object.entries(inputs))
      for (const [key, value] of Object.entries(values))
        await page.locator(`#weapon-profile-${group}-${key}`).fill(String(value));
    await page
      .getByRole('button', { name: 'Проверить и отправить заявку профиля оружия', exact: true })
      .click();
    await expect(page.getByLabel('Причины недостижимости профиля', { exact: true })).toBeVisible();
    expect(host.rollRequestAllocations()).toBe(allocations);
    await host.restart();
    await page.goto(host.baseURL);
    await expect(page.getByLabel('Причины недостижимости профиля', { exact: true })).toBeVisible();
    await action(page, 'CHR-031::CTA::001');
    await page.reload();
    await expect(page.getByLabel('Причины недостижимости профиля', { exact: true })).toHaveCount(0);
    await page.locator('#weapon-profile-formulaOutputs-Dm').fill('2');
    await page
      .getByRole('button', { name: 'Проверить и отправить заявку профиля оружия', exact: true })
      .click();
    await expect(
      page.getByText('Заявка отправлена и ожидает решения мастера.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByLabel('Полный профиль оружия', { exact: true })).toContainText(
      'Лёгкий арбалет',
    );
    await expect(page.locator('[data-atlas-form-id="CHR-038"]')).toHaveCount(0);
    await expect(page.locator('[data-atlas-action-key^="CHR-023"]')).toHaveCount(0);
    const receipts = host.receiptAllocations();
    const witnessIds = host.rollRequestAllocations();
    await page.reload();
    await host.restart();
    await page.goto(host.baseURL);
    await expect(
      page.getByText('Заявка отправлена и ожидает решения мастера.', { exact: false }),
    ).toBeVisible();
    expect(host.receiptAllocations()).toBe(receipts);
    expect(host.rollRequestAllocations()).toBe(witnessIds);
    expect(host.sampleCalls()).toBe(0);
    expect(await page.locator('body').innerText()).not.toMatch(
      /(?:CORE|F-WPN|AQ2)-\d+|Источник|availabilityTrace|definitionId/,
    );
    expect(errors).toEqual([]);
  } finally {
    await host.close();
  }
});

test('CHR-024 PURE enters from an explicit empty-composition checkpoint and acknowledges the immutable fixed profile', async ({
  page,
}) => {
  const host = await createManualSymbiontBrowserHost({
    prefix: 'profile-pure-e2e',
    raceChoice: 'PURE',
    diceInputMode: 'AUTO',
    sampleFaces: [16, 19],
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(host.baseURL);
    // The fixture is a real historical skill checkpoint, so recovery allocates nothing.
    await action(page, 'CHR-017::CTA::006');
    await action(page, 'CHR-015::CTA::001');
    await action(page, 'CHR-017::CTA::004');
    await expect(page.getByLabel('Стартовый комплект брони', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Добавить Кожаный доспех', exact: true }).click();
    await page
      .getByRole('button', { name: 'Зафиксировать один бросок качества', exact: true })
      .click();
    const beforeReturn = host.rollRequestAllocations();
    await action(page, 'CHR-021::CTA::002');
    await expect(page.locator('[data-atlas-form-id="CHR-019"]')).toBeVisible();
    await page.reload();
    await action(page, 'CHR-019::CTA::004');
    await action(page, 'CHR-017::CTA::004');
    expect(host.rollRequestAllocations()).toBe(beforeReturn);
    await action(page, 'CHR-021::CTA::001');
    await expect(page.getByRole('radio', { name: /Лёгкий арбалет/ })).toHaveCount(0);
    await page.getByRole('radio', { name: /Кенси/ }).check();
    await page
      .getByRole('button', { name: 'Зафиксировать один бросок качества оружия', exact: true })
      .click();
    await action(page, 'CHR-022::CTA::002');
    await expect(
      page.getByLabel('Фиксированный профиль оружия Чистого', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Полный профиль оружия', { exact: true })).toContainText('Кенси');
    await expect(page.locator('input')).toHaveCount(0);
    const receiptCount = host.receiptAllocations();
    const allocations = host.rollRequestAllocations();
    await action(page, 'CHR-024::CTA::002');
    await page.reload();
    await action(page, 'CHR-022::CTA::002');
    expect(host.receiptAllocations()).toBe(receiptCount);
    expect(host.rollRequestAllocations()).toBe(allocations);
    await action(page, 'CHR-024::CTA::001');
    await expect(
      page.getByText('Фиксированный профиль подтверждён.', { exact: true }),
    ).toBeVisible();
    await host.restart();
    await page.goto(host.baseURL);
    await expect(
      page.getByText('Фиксированный профиль подтверждён.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-atlas-form-id="CHR-038"]')).toHaveCount(0);
    await expect(page.locator('[data-atlas-action-key^="CHR-024"]')).toHaveCount(0);
    expect(host.sampleCalls()).toBe(2);
    expect(host.rollRequestAllocations()).toBe(allocations);
    expect(await page.locator('body').innerText()).not.toMatch(
      /(?:CORE|F-WPN|AQ2)-\d+|Источник|availabilityTrace|definitionId/,
    );
    expect(errors).toEqual([]);
  } finally {
    await host.close();
  }
});
