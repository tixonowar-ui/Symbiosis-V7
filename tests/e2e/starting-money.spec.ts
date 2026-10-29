import { expect, test, type Page } from '@playwright/test';

import { startingMoneyStageForCheckpoint } from '../../src/host/creation-starting-money-contract.js';
import { createStartingMoneyBrowserHost } from '../fixtures/starting-money-e2e.js';
import { MONEY_PROFILE_INPUTS } from '../fixtures/starting-money-stage.js';

test.use({ channel: 'chrome' });
const action = (page: Page, key: string) =>
  page.locator(`[data-atlas-action-key="${key}"]`).click();
async function resumeThroughWeapon(page: Page, pure: boolean): Promise<void> {
  await action(page, 'CHR-038::CTA::002');
  await expect(page.locator('[data-atlas-form-id="CHR-022"]')).toBeVisible();
  await page.reload();
  await action(page, pure ? 'CHR-022::CTA::002' : 'CHR-022::CTA::001');
  await expect(
    page.locator(`[data-atlas-form-id="${pure ? 'CHR-024' : 'CHR-023'}"]`),
  ).toBeVisible();
  await action(page, pure ? 'CHR-024::CTA::001' : 'CHR-023::CTA::001');
  await expect(page.getByLabel('Рекомендация стартового достатка', { exact: true })).toBeVisible();
}

test('CHR-038 binds one new MANUAL money request to a submitted formula profile and survives safe-return and SQLite reopen', async ({
  page,
}) => {
  const host = await createStartingMoneyBrowserHost({
    prefix: 'money-manual-e2e',
    raceChoice: 'FREE',
    diceInputMode: 'MANUAL',
    sampleFaces: [],
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(host.baseURL);
    await expect(page.getByLabel('Формульный профиль оружия', { exact: true })).toBeVisible();
    for (const [group, values] of Object.entries(MONEY_PROFILE_INPUTS))
      for (const [key, value] of Object.entries(values as Record<string, number>))
        await page.locator(`#weapon-profile-${group}-${key}`).fill(String(value));
    await page
      .getByRole('button', { name: 'Проверить и отправить заявку профиля оружия', exact: true })
      .click();
    await expect(
      page.getByLabel('Рекомендация стартового достатка', { exact: true }),
    ).toBeVisible();
    const pending = host.checkpoint();
    const money = pending.startingMoneyStage!;
    expect(money.entryMode).toBe('ATOMIC_PROFILE');
    expect(money.rollRecordOrNull).toBeNull();
    expect(pending.weaponProfileStage!.records.at(-1)!.receipt.result['moneyRollRequestId']).toBe(
      money.moneyRollRequestId,
    );
    const profile = pending.weaponProfileStage;
    const allocations = host.rollRequestAllocations();
    const receiptCount = host.receiptAllocations();
    const button = page.getByRole('button', {
      name: 'Зафиксировать бросок рекомендации денег',
      exact: true,
    });
    await expect(button).toBeDisabled();
    for (const invalid of ['0', '21', '1.5']) {
      await page.locator('#starting-money-face').fill(invalid);
      await expect(button).toBeDisabled();
    }
    expect(host.receiptAllocations()).toBe(receiptCount);
    await resumeThroughWeapon(page, false);
    expect(host.checkpoint().startingMoneyStage).toEqual(money);
    expect(host.checkpoint().weaponProfileStage).toEqual(profile);
    expect(host.rollRequestAllocations()).toBe(allocations);
    expect(host.receiptAllocations()).toBe(receiptCount);
    await host.restart();
    await page.goto(host.baseURL);
    await expect(
      page.getByLabel('Рекомендация стартового достатка', { exact: true }),
    ).toBeVisible();
    expect(host.checkpoint().startingMoneyStage).toEqual(money);
    await page.locator('#starting-money-face').fill('19');
    await button.click();
    await expect(
      page.getByLabel('Зафиксированная рекомендация денег', { exact: true }),
    ).toContainText('исключительная');
    await expect(
      page.getByText('Итоговое количество денег обязательно определит мастер позднее.', {
        exact: false,
      }),
    ).toBeVisible();
    const rolled = host.checkpoint().startingMoneyStage;
    expect(rolled!.rollRecordOrNull!.physicalRoll.mechanical.rawFace).toBe(19);
    expect(host.sampleCalls()).toBe(0);
    await resumeThroughWeapon(page, false);
    expect(host.checkpoint().startingMoneyStage).toEqual(rolled);
    expect(host.checkpoint().weaponProfileStage).toEqual(profile);
    expect(host.rollRequestAllocations()).toBe(allocations);
    await action(page, 'CHR-038::CTA::001');
    await expect(
      page.getByText('Рекомендация денег подтверждена.', { exact: false }),
    ).toBeVisible();
    const completed = host.checkpoint();
    const finalReceipts = host.receiptAllocations();
    expect(completed.nextStageEnvelope.formId).toBe('CHR-037');
    await page.reload();
    await host.restart();
    await page.goto(host.baseURL);
    await expect(
      page.getByText('Рекомендация денег подтверждена.', { exact: false }),
    ).toBeVisible();
    await expect(page.locator('[data-atlas-form-id="CHR-037"]')).toHaveCount(0);
    await expect(page.locator('[data-atlas-action-key^="CHR-038"]')).toHaveCount(0);
    expect(host.checkpoint().startingMoneyStage).toEqual(completed.startingMoneyStage);
    expect(host.checkpoint().weaponProfileStage).toEqual(profile);
    expect(host.receiptAllocations()).toBe(finalReceipts);
    expect(host.rollRequestAllocations()).toBe(allocations);
    expect(host.sampleCalls()).toBe(0);
    expect(await page.locator('body').innerText()).not.toMatch(
      /(?:CORE|AQ2)-\d+|Источник|availabilityTrace|finalAmount|masterApproval/,
    );
    expect(errors).toEqual([]);
  } finally {
    await host.close();
  }
});

test('CHR-038 restores a legacy PURE profile without writes and commits exactly one AUTO recommendation across restart', async ({
  page,
}) => {
  const host = await createStartingMoneyBrowserHost({
    prefix: 'money-auto-legacy-e2e',
    raceChoice: 'PURE',
    diceInputMode: 'AUTO',
    legacyCompletedProfile: true,
    sampleFaces: [20],
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const legacy = host.checkpoint();
    const originalCharacter = legacy.localCharacter;
    const profile = legacy.weaponProfileStage;
    const derived = startingMoneyStageForCheckpoint(legacy)!;
    expect(derived.entryMode).toBe('DERIVED_PROFILE_RECEIPT');
    expect(legacy.startingMoneyStage ?? null).toBeNull();
    await page.goto(host.baseURL);
    await expect(
      page.getByLabel('Рекомендация стартового достатка', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('#starting-money-face')).toHaveCount(0);
    await page.reload();
    await host.restart();
    await page.goto(host.baseURL);
    await expect(
      page.getByLabel('Рекомендация стартового достатка', { exact: true }),
    ).toBeVisible();
    expect(host.checkpoint().localCharacter).toEqual(originalCharacter);
    expect(startingMoneyStageForCheckpoint(host.checkpoint())).toEqual(derived);
    expect(host.rollRequestAllocations()).toBe(0);
    expect(host.receiptAllocations()).toBe(0);
    expect(host.sampleCalls()).toBe(0);
    await page
      .getByRole('button', { name: 'Зафиксировать бросок рекомендации денег', exact: true })
      .click();
    await expect(
      page.getByLabel('Зафиксированная рекомендация денег', { exact: true }),
    ).toContainText('редкое состояние');
    const rolled = host.checkpoint().startingMoneyStage!;
    expect(rolled.moneyRollRequestId).toBe(derived.moneyRollRequestId);
    expect(rolled.entryMode).toBe('DERIVED_PROFILE_RECEIPT');
    expect(host.checkpoint().weaponProfileStage).toEqual(profile);
    expect(host.sampleCalls()).toBe(1);
    expect(host.rollRequestAllocations()).toBe(0);
    const receipts = host.receiptAllocations();
    await host.restart();
    await page.goto(host.baseURL);
    await expect(
      page.getByLabel('Зафиксированная рекомендация денег', { exact: true }),
    ).toContainText('редкое состояние');
    await resumeThroughWeapon(page, true);
    expect(host.checkpoint().startingMoneyStage).toEqual(rolled);
    expect(host.checkpoint().weaponProfileStage).toEqual(profile);
    expect(host.receiptAllocations()).toBe(receipts);
    expect(host.sampleCalls()).toBe(1);
    await action(page, 'CHR-038::CTA::001');
    await expect(
      page.getByText('Рекомендация денег подтверждена.', { exact: false }),
    ).toBeVisible();
    await page.reload();
    await host.restart();
    await page.goto(host.baseURL);
    await expect(
      page.getByText('Рекомендация денег подтверждена.', { exact: false }),
    ).toBeVisible();
    await expect(page.locator('[data-atlas-form-id="CHR-037"]')).toHaveCount(0);
    await expect(page.locator('[data-atlas-action-key^="CHR-038"]')).toHaveCount(0);
    expect(host.sampleCalls()).toBe(1);
    expect(host.rollRequestAllocations()).toBe(0);
    expect(host.checkpoint().weaponProfileStage).toEqual(profile);
    expect(errors).toEqual([]);
  } finally {
    await host.close();
  }
});
