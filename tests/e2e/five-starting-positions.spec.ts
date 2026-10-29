import { expect, test, type Page } from '@playwright/test';

import { createFiveStartingPositionsBrowserHost } from '../fixtures/five-starting-positions-e2e.js';

test.use({ channel: 'chrome' });
test.setTimeout(60_000);

const action = (page: Page, key: string) =>
  page.locator(`[data-atlas-action-key="${key}"]`).click();
const position = (page: Page, index: number) =>
  page.getByRole('group', { name: `Позиция ${String(index)}`, exact: true });
const roll = (page: Page) =>
  page.getByRole('button', {
    name: 'Зафиксировать бросок качества выбранной позиции',
    exact: true,
  });

function browserFrames(page: Page) {
  const frames: { raw: string; value: Record<string, unknown> }[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => {
      const raw =
        typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
      frames.push({ raw, value: JSON.parse(raw) as Record<string, unknown> });
    });
  });
  return frames;
}

async function chooseAll(page: Page): Promise<void> {
  for (let index = 1; index <= 5; index++) {
    await page
      .locator(`#starting-position-${String(index)}-type`)
      .selectOption(index === 5 ? 'GEN-010' : 'RES-AMM-002');
    await page
      .locator(`#starting-position-${String(index)}-quantity`)
      .fill(index === 5 ? '3' : String(index + 1));
  }
  await page.locator('#starting-position-5-description').fill('Три памятных камня');
}

async function rollPosition(
  page: Page,
  mode: 'AUTO' | 'MANUAL',
  index: number,
  face: number,
): Promise<void> {
  await page
    .getByRole('radio', { name: `Бросить за позицию ${String(index)}`, exact: true })
    .check();
  if (mode === 'MANUAL') await page.locator('#starting-position-face').fill(String(face));
  await roll(page).click();
  await expect(position(page, index)).toContainText('Позиция зафиксирована.');
}

for (const mode of ['AUTO', 'MANUAL'] as const) {
  test(`CHR-037 ${mode} keeps five independent stacks through replay, safe-return and SQLite reopen`, async ({
    page,
  }) => {
    const host = await createFiveStartingPositionsBrowserHost(mode);
    const frames = browserFrames(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(host.baseURL);
      await expect(
        page.getByLabel('Рекомендация стартового достатка', { exact: true }),
      ).toBeVisible();
      if (mode === 'MANUAL') await page.locator('#starting-money-face').fill('15');
      await page
        .getByRole('button', { name: 'Зафиксировать бросок рекомендации денег', exact: true })
        .click();
      await expect(
        page.getByLabel('Зафиксированная рекомендация денег', { exact: true }),
      ).toBeVisible();
      await action(page, 'CHR-038::CTA::001');
      await expect(page.getByLabel('Пять произвольных позиций', { exact: true })).toBeVisible();
      const before = host.checkpoint();
      const initial = before.fiveStartingPositionsStage!;
      const slots = initial.slots;
      expect(slots).toHaveLength(5);
      expect(
        new Set(slots.flatMap((slot) => [slot.positionId, slot.qualityRollRequestId])).size,
      ).toBe(10);
      expect(initial.rollRecords).toHaveLength(0);
      const samplesAtEntry = host.sampleCalls();
      const allocationsAtEntry = host.rollRequestAllocations();
      const receiptsAtEntry = host.receiptAllocations();
      await expect(roll(page)).toBeDisabled();
      await expect(
        page.locator('#starting-position-1-type option[value="RES-MAG-001"]'),
      ).toHaveCount(0);
      await expect(
        page.locator('#starting-position-1-type option[value="RES-MAG-002"]'),
      ).toHaveCount(0);
      await chooseAll(page);
      await page.reload();
      await expect(page.locator('#starting-position-1-type')).toHaveValue('');
      expect(host.checkpoint().fiveStartingPositionsStage).toEqual(initial);
      await chooseAll(page);
      if (mode === 'MANUAL') await page.locator('#starting-position-face').fill('1');
      for (const quantity of ['0', '-1', '1.5']) {
        await page.locator('#starting-position-5-quantity').fill(quantity);
        await expect(roll(page)).toBeDisabled();
      }
      await page.locator('#starting-position-5-quantity').fill('3');
      await page.locator('#starting-position-5-description').fill('Скрытый CORE-173');
      await expect(roll(page)).toBeDisabled();
      await page.locator('#starting-position-5-description').fill('Три памятных камня');
      expect(host.sampleCalls()).toBe(samplesAtEntry);
      expect(host.receiptAllocations()).toBe(receiptsAtEntry);
      await rollPosition(page, mode, 1, 1);
      await expect(position(page, 1)).toContainText('Отсутствует/непригоден');
      await expect(position(page, 1)).toContainText('Стрела: 2');
      await expect(page.locator('#starting-position-1-type')).toHaveCount(0);
      await expect(page.locator('#starting-position-1-quantity')).toHaveCount(0);
      const first = host.checkpoint().fiveStartingPositionsStage!.rollRecords[0]!;
      const firstFrame = frames.find(({ value }) => {
        const payload = value['payload'] as Record<string, unknown> | undefined;
        return payload?.['variant'] === 'FIVE_STARTING_POSITIONS_ROLL';
      })!;
      expect(firstFrame).toBeDefined();
      await page.locator('#starting-position-2-type').selectOption('ITM-PHA-001');
      await page.locator('#starting-position-2-quantity').fill('9');
      await rollPosition(page, mode, 2, 5);
      const second = host.checkpoint().fiveStartingPositionsStage!;
      expect(second.rollRecords[0]).toEqual(first);
      expect(second.draftSelections[1]).toMatchObject({
        itemTypeIdOrStoryType: 'ITM-PHA-001',
        quantity: 9,
      });
      expect(second.draftSelections[4]).toMatchObject({
        kind: 'STORY',
        quantity: 3,
        storyDescriptionOrNull: 'Три памятных камня',
      });
      const samplesBeforeReplay = host.sampleCalls();
      const receiptsBeforeReplay = host.receiptAllocations();
      const reconnect = frames.find(({ value }) => value['messageType'] === 'session.reconnect')!;
      const replayed = await host.replay(reconnect.raw, firstFrame.raw);
      expect(replayed[0]).toMatchObject({ messageType: 'command.replay', receipt: first.receipt });
      expect(host.checkpoint().fiveStartingPositionsStage).toEqual(second);
      expect(host.sampleCalls()).toBe(samplesBeforeReplay);
      expect(host.receiptAllocations()).toBe(receiptsBeforeReplay);

      await action(page, 'CHR-037::CTA::002');
      await expect(page.locator('[data-atlas-form-id="CHR-038"]')).toBeVisible();
      await page.reload();
      await host.restart();
      await page.goto(host.baseURL);
      await expect(page.locator('[data-atlas-form-id="CHR-038"]')).toBeVisible();
      expect(host.checkpoint().fiveStartingPositionsStage).toEqual(second);
      await action(page, 'CHR-038::CTA::001');
      await expect(page.getByLabel('Пять произвольных позиций', { exact: true })).toBeVisible();
      await expect(position(page, 1)).toContainText('Отсутствует/непригоден');
      await expect(position(page, 2)).toContainText('Антисептик: 9');
      await expect(page.locator('#starting-position-3-quantity')).toHaveValue('4');
      expect(host.receiptAllocations()).toBe(receiptsBeforeReplay);
      expect(host.rollRequestAllocations()).toBe(allocationsAtEntry);
      expect(host.sampleCalls()).toBe(samplesBeforeReplay);
      for (const [index, face] of [
        [3, 10],
        [4, 19],
        [5, 20],
      ] as const)
        await rollPosition(page, mode, index, face);
      const five = host.checkpoint().fiveStartingPositionsStage!;
      expect(five.slots).toEqual(slots);
      expect(five.rollRecords).toHaveLength(5);
      expect(new Set(five.rollRecords.map((row) => row.receipt.receiptId)).size).toBe(5);
      expect(five.rollRecords.map((row) => row.physicalRoll.mechanical.rawFace)).toEqual([
        1, 5, 10, 19, 20,
      ]);
      expect(
        five.rollRecords.every((row) => row.receipt.result.ownershipState === 'OWNED_NOT_EQUIPPED'),
      ).toBe(true);
      await expect(position(page, 5)).toContainText('Три памятных камня');
      await expect(position(page, 5)).toContainText('Редкое');
      await expect(page.locator('#starting-position-face')).toHaveCount(0);
      await action(page, 'CHR-037::CTA::001');
      await expect(page.locator('[data-atlas-form-id="CHR-032"]')).toBeVisible();
      await expect(
        page.getByText('Восемь имущественных операций подтверждены', { exact: true }),
      ).toBeVisible();
      const completed = host.checkpoint();
      const finalReceipts = host.receiptAllocations();
      expect(completed.nextStageEnvelope.formId).toBe('CHR-032');
      expect(completed.startingMoneyStage).toEqual(before.startingMoneyStage);
      expect(completed.weaponProfileStage).toEqual(before.weaponProfileStage);
      await page.reload();
      await host.restart();
      await page.goto(host.baseURL);
      await expect(page.locator('[data-atlas-form-id="CHR-032"]')).toBeVisible();
      await expect(
        page.getByText('Восемь имущественных операций подтверждены', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-atlas-action-key^="CHR-037"]')).toHaveCount(0);
      expect(host.checkpoint().fiveStartingPositionsStage).toEqual(
        completed.fiveStartingPositionsStage,
      );
      expect(host.receiptAllocations()).toBe(finalReceipts);
      expect(host.rollRequestAllocations()).toBe(allocationsAtEntry);
      expect(host.sampleCalls()).toBe(mode === 'AUTO' ? 6 : 0);
      await expect(page.locator('[data-client-state="protocol-error"]')).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toMatch(
        /(?:CORE|AQ2|F-WPN)-\d+|Источник|availabilityTrace|masterPredicate|gmFinalization/,
      );
      expect(errors).toEqual([]);
    } finally {
      await host.close();
    }
  });
}
