import { expect, test, type Page } from '@playwright/test';
import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '../../generated/types/local-character-portraits.js';
import { createCreationFinalizationBrowserHost } from '../fixtures/creation-finalization-e2e.js';

test.use({ channel: 'chrome' });
test.setTimeout(60000);
const action = (page: Page, key: string) =>
  page.locator(`[data-atlas-action-key="${key}"]`).click();
function browserFrames(page: Page) {
  const frames: { raw: string; value: Record<string, unknown> }[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => {
      const raw =
        typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
      frames.push({ raw, value: JSON.parse(raw) as Record<string, unknown> });
    }),
  );
  return frames;
}
for (const [race, mode] of [
  ['FREE', 'MANUAL'],
  ['PURE', 'AUTO'],
] as const) {
  test(`CHR-032/025 ${race} ${mode} keeps eight receipts through safe-return, final save replay and SQLite reopen`, async ({
    page,
  }) => {
    const host = await createCreationFinalizationBrowserHost({
      prefix: `final-e2e-${race}`,
      race,
      mode,
    });
    const frames = browserFrames(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      const original = host.checkpoint();
      await page.goto(host.baseURL);
      await expect(page.locator('[data-atlas-form-id="CHR-032"]')).toBeVisible();
      await expect(
        page.getByText('Восемь имущественных операций подтверждены', { exact: true }),
      ).toBeVisible();
      await action(page, 'CHR-032::CTA::002');
      await expect(page.locator('[data-atlas-form-id="CHR-021"]')).toBeVisible();
      await action(page, 'CHR-021::CTA::001');
      await expect(page.locator('[data-atlas-form-id="CHR-022"]')).toBeVisible();
      await action(page, race === 'PURE' ? 'CHR-022::CTA::002' : 'CHR-022::CTA::001');
      await expect(
        page.locator(`[data-atlas-form-id="${race === 'PURE' ? 'CHR-024' : 'CHR-023'}"]`),
      ).toBeVisible();
      await action(page, race === 'PURE' ? 'CHR-024::CTA::001' : 'CHR-023::CTA::001');
      await expect(page.locator('[data-atlas-form-id="CHR-038"]')).toBeVisible();
      await action(page, 'CHR-038::CTA::001');
      await expect(page.locator('[data-atlas-form-id="CHR-037"]')).toBeVisible();
      await action(page, 'CHR-037::CTA::001');
      await expect(page.locator('[data-atlas-form-id="CHR-032"]')).toBeVisible();
      expect(host.checkpoint().localCharacter.payloadJson).toBe(
        original.localCharacter.payloadJson,
      );
      expect(host.receiptAllocations()).toBe(0);
      await action(page, 'CHR-032::CTA::001');
      await expect(page.locator('[data-atlas-form-id="CHR-025"]')).toBeVisible();
      await expect(page.locator('[data-atlas-action-key="CHR-025::CTA::007"]')).toBeVisible();
      if (race === 'FREE') {
        await action(page, 'CHR-025::CTA::001');
        await expect(page.locator('[data-atlas-form-id="CHR-001"]')).toBeVisible();
        await page
          .getByLabel('Исправление: name', { exact: true })
          .fill('  Corrected final name  ');
        await page
          .getByLabel('Заглушка из каталога', { exact: true })
          .selectOption(LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS[0]);
        await page
          .getByRole('button', { name: 'Сохранить исправления идентичности', exact: true })
          .click();
        await expect(page.locator('[data-atlas-form-id="CHR-025"]')).toBeVisible();
        expect(host.checkpoint().finalizationStage!.state.identity.name).toBe(
          'Corrected final name',
        );
        expect(host.checkpoint().finalizationStage!.state.identity.artAssetKeyOrLocalFile).toEqual({
          kind: 'asset-key',
          assetKey: LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS[0],
        });
        expect(host.checkpoint().identityStage).toEqual(original.identityStage);
        expect(host.checkpoint().fiveStartingPositionsStage).toEqual(
          original.fiveStartingPositionsStage,
        );
      }
      await action(page, 'CHR-025::CTA::007');
      await expect(page.locator('[data-atlas-form-id="CHR-040"]')).toBeVisible();
      const saved = host.checkpoint();
      const receipts = host.receiptAllocations();
      expect(saved.localCharacter.lifecycleState).toBe('FINAL');
      expect(saved.localCharacter.localCharacterId).toBe(original.localCharacter.localCharacterId);
      expect(saved.nextStageEnvelope.formId).toBe('CHR-040');
      expect(saved.armorBundleStage).toEqual(original.armorBundleStage);
      expect(saved.startingWeaponStage).toEqual(original.startingWeaponStage);
      expect(saved.startingMoneyStage).toEqual(original.startingMoneyStage);
      expect(saved.fiveStartingPositionsStage).toEqual(original.fiveStartingPositionsStage);
      const reconnect = frames.find((f) => f.value['messageType'] === 'session.reconnect')!;
      const final = frames.find(
        (f) => (f.value['payload'] as { variant?: string } | undefined)?.variant === 'FINAL_SAVE',
      )!;
      expect(final).toBeDefined();
      expect(reconnect).toBeDefined();
      const replayed = await host.replay(reconnect.raw, final.raw);
      expect(replayed[0]).toMatchObject({
        messageType: 'command.replay',
        receipt: { receiptId: saved.receipt.receiptId },
      });
      expect(host.checkpoint().localCharacter).toEqual(saved.localCharacter);
      expect(host.receiptAllocations()).toBe(receipts);
      await page.reload();
      await expect(page.locator('[data-atlas-form-id="CHR-040"]')).toBeVisible();
      await host.restart();
      await page.goto(host.baseURL);
      await expect(page.locator('[data-atlas-form-id="CHR-040"]')).toBeVisible();
      expect(host.checkpoint().finalizationStage).toEqual(saved.finalizationStage);
      await expect(page.locator('[data-atlas-action-key^="CHR-025"]')).toHaveCount(0);
      await expect(page.locator('[data-atlas-form-id="CHR-040"]')).toBeVisible();
      expect(host.sampleCalls()).toBe(0);
      expect(host.rollAllocations()).toBe(0);
      expect(await page.locator('body').innerText()).not.toMatch(
        /CORE-\d|AQ2-\d|Источник|availabilityTrace|gmFinalizationData/,
      );
      expect(errors).toEqual([]);
    } finally {
      await host.close();
    }
  });
}

test('original UNITED Adviser repairs a permanent body requirement before final validation without new rolls', async ({
  page,
}) => {
  const host = await createCreationFinalizationBrowserHost({
    prefix: 'final-original-adviser',
    race: 'UNITED',
    mode: 'MANUAL',
    initialAdvisorBodyLoss: true,
  });
  try {
    const original = host.checkpoint();
    expect(
      original.manualCompositionStage!.advisorSkillRecordOrNull!.learnedSkills.some(
        (skill) => skill.skillKey === 'ACTING',
      ),
    ).toBe(true);
    await page.goto(host.baseURL);
    await expect(page.locator('[data-atlas-form-id="CHR-032"]')).toBeVisible();
    await expect(
      page.getByText(
        'После подтверждения нужно заполнить освободившиеся слоты навыков Советника. Его прежние броски I и W сохраняются.',
        { exact: true },
      ),
    ).toBeVisible();
    await action(page, 'CHR-032::CTA::001');
    await expect(page.locator('[data-atlas-form-id="CHR-041"]')).toBeVisible();
    await expect(page.getByLabel('Уровень: Актёрское мастерство', { exact: true })).toHaveCount(0);
    const pending = host.checkpoint();
    expect(
      pending.finalizationStage!.state.advisorCards[0]!.learnedSkills.some(
        (skill) => skill.skillKey === 'ACTING',
      ),
    ).toBe(false);
    expect(pending.manualCompositionStage).toEqual(original.manualCompositionStage);
    await host.restart();
    await page.goto(host.baseURL);
    await expect(page.locator('[data-atlas-form-id="CHR-041"]')).toBeVisible();
    expect(host.checkpoint().finalizationStage).toEqual(pending.finalizationStage);
    await page.getByLabel('Уровень: Рукопашный бой', { exact: true }).selectOption('5');
    await page.getByRole('button', { name: 'Подтвердить навыки Советника', exact: true }).click();
    await expect(page.locator('[data-atlas-form-id="CHR-025"]')).toBeVisible();
    await action(page, 'CHR-025::CTA::007');
    await expect(page.locator('[data-atlas-form-id="CHR-040"]')).toBeVisible();
    expect(host.checkpoint().localCharacter.lifecycleState).toBe('FINAL');
    expect(host.checkpoint().manualCompositionStage).toEqual(original.manualCompositionStage);
    expect(host.checkpoint().fiveStartingPositionsStage).toEqual(
      original.fiveStartingPositionsStage,
    );
    expect(host.sampleCalls()).toBe(0);
    expect(host.rollAllocations()).toBe(0);
    await host.restart();
    await page.goto(host.baseURL);
    await expect(page.locator('[data-atlas-form-id="CHR-040"]')).toBeVisible();
    expect(host.sampleCalls()).toBe(0);
  } finally {
    await host.close();
  }
});

test('CHR-025 mass blocker has a signed identity correction path and final save stays unavailable until the correction commits', async ({
  page,
}) => {
  const host = await createCreationFinalizationBrowserHost({
    prefix: 'final-mass-e2e',
    race: 'FREE',
    mode: 'MANUAL',
    massBlocker: true,
  });
  try {
    const before = host.checkpoint();
    await page.goto(host.baseURL);
    await expect(page.locator('[data-atlas-form-id="CHR-025"]')).toBeVisible();
    await expect(page.locator('[data-atlas-action-key="CHR-025::CTA::007"]')).toHaveCount(0);
    await action(page, 'CHR-025::CTA::001');
    await expect(page.locator('[data-atlas-form-id="CHR-001"]')).toBeVisible();
    await page.getByLabel('Исправление: massKg', { exact: true }).fill('110');
    await page
      .getByRole('button', { name: 'Сохранить исправления идентичности', exact: true })
      .click();
    await expect(page.locator('[data-atlas-form-id="CHR-025"]')).toBeVisible();
    await expect(page.locator('[data-atlas-action-key="CHR-025::CTA::007"]')).toBeVisible();
    const corrected = host.checkpoint();
    expect(corrected.identityStage).toEqual(before.identityStage);
    expect(corrected.fiveStartingPositionsStage).toEqual(before.fiveStartingPositionsStage);
    await host.restart();
    await page.goto(host.baseURL);
    await expect(page.locator('[data-atlas-action-key="CHR-025::CTA::007"]')).toBeVisible();
    await action(page, 'CHR-025::CTA::007');
    await expect(page.locator('[data-atlas-form-id="CHR-040"]')).toBeVisible();
    expect(host.checkpoint().finalizationStage!.finalMechanicsSnapshotOrNull!.identity.massKg).toBe(
      110,
    );
    expect(host.sampleCalls()).toBe(0);
    expect(host.rollAllocations()).toBe(0);
  } finally {
    await host.close();
  }
});
