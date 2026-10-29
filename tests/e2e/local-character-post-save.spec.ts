import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '../../generated/types/local-character-portraits.js';
import type { PostSaveCommandResult } from '../../src/shared/local-character-post-save.js';
import type { CommandReceipt } from '../../src/shared/wire-protocol.js';
import { createCreationFinalizationBrowserHost } from '../fixtures/creation-finalization-e2e.js';

test.use({ channel: 'chrome' });
test.setTimeout(60000);
const screen = (page: Page, id: string) =>
  expect(page.locator(`[data-atlas-form-id="${id}"]`)).toBeVisible();
const action = (page: Page, key: string) =>
  page.locator(`[data-atlas-action-key="${key}"]`).click();
const forbidden =
  /CORE-\d|SYM-\d|AQ2-\d|availabilityTrace|learnedNodeRefs|masterPredicate|sourceRule/u;
function capture(page: Page) {
  const sent: { raw: string; value: Record<string, unknown> }[] = [];
  const received: Record<string, unknown>[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => {
      const raw =
        typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
      sent.push({ raw, value: JSON.parse(raw) as Record<string, unknown> });
    });
    socket.on('framereceived', (frame) => {
      const raw =
        typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
      received.push(JSON.parse(raw) as Record<string, unknown>);
    });
  });
  return { sent, received };
}

test('CHR-026 and APP-009 restore only the complete checkpoint, discard corrupt tail and retain it after SQLite reopen', async ({
  page,
}) => {
  const host = await createCreationFinalizationBrowserHost({
    prefix: 'recovery-e2e',
    race: 'FREE',
    mode: 'MANUAL',
    startSavedDraft: true,
    corruptTail: true,
  });
  const frames = capture(page),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const original = host.checkpoint();
    await page.goto(host.baseURL);
    await screen(page, 'CHR-026');
    await expect(
      page.getByText('Незавершённый хвост исключён. Полная версия сохранена.', { exact: true }),
    ).toHaveCount(0);
    await action(page, 'CHR-026::CTA::001');
    await screen(page, 'APP-009');
    await action(page, 'APP-009::CTA::003');
    await screen(page, 'CHR-032');
    await expect(
      page.getByText('Восстановлен полный checkpoint; повреждённый незавершённый хвост отброшен.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(host.checkpoint().localCharacter.payloadJson).toBe(original.localCharacter.payloadJson);
    expect(host.receiptAllocations()).toBe(1);
    const receipt = frames.received.find(
      (frame) =>
        (frame['receipt'] as { result?: { variant?: string } } | undefined)?.result?.variant ===
        'RESTORE',
    );
    expect(receipt).toMatchObject({
      messageType: 'command.result',
      receipt: {
        result: {
          restoredCheckpointOrNull: {
            corruptTailIgnored: true,
            restoreStatus: 'CORRUPT',
            checkpointId: original.checkpoint.checkpointId,
          },
        },
      },
    });
    await host.restart();
    await page.goto(host.baseURL);
    await screen(page, 'CHR-032');
    expect(host.checkpoint().localCharacter.payloadJson).toBe(original.localCharacter.payloadJson);
    expect(host.sampleCalls()).toBe(0);
    expect(host.rollAllocations()).toBe(0);
    expect(await page.locator('body').innerText()).not.toMatch(forbidden);
    expect(errors).toEqual([]);
  } finally {
    await host.close();
  }
});

test('CHR-039 cache is read-only and restores its exact validation return across reload and draft save', async ({
  page,
}) => {
  const host = await createCreationFinalizationBrowserHost({
    prefix: 'cache-e2e',
    race: 'PURE',
    mode: 'AUTO',
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(host.baseURL);
    await screen(page, 'CHR-032');
    await action(page, 'CHR-032::CTA::001');
    await screen(page, 'CHR-025');
    const before = host.checkpoint(),
      receipts = host.receiptAllocations();
    await action(page, 'CHR-025::CTA::009');
    await screen(page, 'CHR-039');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.locator('input,select')).toHaveCount(0);
    await expect(page.locator('[data-atlas-action-key="CHR-039::CTA::004"]')).toBeVisible();
    expect(host.checkpoint().localCharacter.payloadJson).toBe(before.localCharacter.payloadJson);
    await page.reload();
    await screen(page, 'CHR-039');
    await host.restart();
    await page.goto(host.baseURL);
    await screen(page, 'CHR-039');
    await action(page, 'CHR-039::CTA::004');
    await screen(page, 'CHR-025');
    expect(host.receiptAllocations()).toBe(receipts);
    await action(page, 'CHR-025::CTA::008');
    await screen(page, 'CHR-026');
    expect(host.checkpoint().localCharacter.payloadJson).toBe(before.localCharacter.payloadJson);
    await action(page, 'CHR-026::CTA::001');
    await screen(page, 'APP-009');
    await action(page, 'APP-009::CTA::003');
    await screen(page, 'CHR-025');
    expect(host.checkpoint().localCharacter.payloadJson).toBe(before.localCharacter.payloadJson);
    expect(host.sampleCalls()).toBe(0);
    expect(host.rollAllocations()).toBe(0);
    expect(await page.locator('body').innerText()).not.toMatch(forbidden);
    expect(errors).toEqual([]);
  } finally {
    await host.close();
  }
});

test('CHR-040 local metadata preserves final mechanics, exports identical bytes and creates a metadata-only variant', async ({
  page,
}) => {
  const host = await createCreationFinalizationBrowserHost({
    prefix: 'local-final-e2e',
    race: 'FREE',
    mode: 'MANUAL',
  });
  const frames = capture(page),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(host.baseURL);
    await screen(page, 'CHR-032');
    await action(page, 'CHR-032::CTA::001');
    await screen(page, 'CHR-025');
    await action(page, 'CHR-025::CTA::007');
    await screen(page, 'CHR-040');
    const final = host.checkpoint();
    expect(final.localCharacter.lifecycleState).toBe('FINAL');
    await page.getByLabel('Локальное имя', { exact: true }).fill('Локальное имя варианта');
    await page.getByLabel('Локальное описание', { exact: true }).fill('Только локальное описание');
    await page
      .getByLabel('Локальный портрет', { exact: true })
      .selectOption(LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS[1]);
    await page
      .getByRole('button', { name: 'Сохранить локальные имя, описание или арт', exact: true })
      .click();
    await expect(
      page.getByText('Локальные имя, описание и арт сохранены.', { exact: true }),
    ).toBeVisible();
    expect(host.checkpoint().localCharacter.payloadJson).toBe(final.localCharacter.payloadJson);
    expect(host.checkpoint().finalizationStage).toEqual(final.finalizationStage);
    await page.reload();
    await screen(page, 'CHR-040');
    await expect(page.getByLabel('Локальное имя', { exact: true })).toHaveValue(
      'Локальное имя варианта',
    );
    await action(page, 'CHR-040::CTA::001');
    await screen(page, 'APP-010');
    const exported: Buffer[] = [];
    for (let i = 0; i < 2; i++) {
      const downloadEvent = page.waitForEvent('download');
      await page
        .getByRole('button', { name: 'Экспортировать версионированный файл', exact: true })
        .click();
      const download = await downloadEvent,
        path = await download.path();
      expect(download.suggestedFilename()).toMatch(/\.json$/);
      expect(path).not.toBeNull();
      exported.push(await readFile(path));
      await expect(
        page.getByRole('button', { name: 'Экспортировать версионированный файл', exact: true }),
      ).toBeVisible();
    }
    expect(exported[1]).toEqual(exported[0]);
    const text = exported[0]!.toString('utf8');
    expect(text).toContain('Локальное имя варианта');
    expect(text).not.toMatch(forbidden);
    const reconnect = frames.sent.find((f) => f.value['messageType'] === 'session.reconnect')!;
    const command = frames.sent.find(
      (f) => (f.value['payload'] as { variant?: string } | undefined)?.variant === 'EXPORT',
    )!;
    const count = host.receiptAllocations();
    const replay = await host.replay(reconnect.raw, command.raw);
    expect(replay[0]).toMatchObject({ messageType: 'command.replay' });
    expect(host.receiptAllocations()).toBe(count);
    await page.getByRole('button', { name: 'Создать вариант с новым UUID', exact: true }).click();
    await expect(
      page.getByText('Новый вариант сохранён в локальной библиотеке.', { exact: true }),
    ).toBeVisible();
    expect(host.variantAllocations()).toBe(1);
    const variant = host.localCharacters().find((c) => c.lifecycleState === 'VARIANT')!;
    expect(variant).toBeDefined();
    expect(variant.localCharacterId).not.toBe(final.localCharacter.localCharacterId);
    expect(host.checkpoint().localCharacter.payloadJson).toBe(final.localCharacter.payloadJson);
    const variantCommand = frames.sent.find(
      (f) => (f.value['payload'] as { variant?: string } | undefined)?.variant === 'VARIANT_CREATE',
    )!;
    await action(page, 'APP-010::CTA::002');
    await screen(page, 'CHR-040');
    await page
      .getByLabel('Локальное имя', { exact: true })
      .fill('Обновлённое имя исходного персонажа');
    await page.getByLabel('Локальное описание', { exact: true }).fill('Описание второй версии');
    await page
      .getByRole('button', { name: 'Сохранить локальные имя, описание или арт', exact: true })
      .click();
    await expect
      .poll(
        () =>
          frames.received.filter((frame) => {
            const result = (frame['receipt'] as CommandReceipt<PostSaveCommandResult> | undefined)
              ?.result;
            return result?.variant === 'METADATA_PATCH' && result.localMetadataRevision === 2;
          }).length,
      )
      .toBe(1);
    for (const previousCommand of [command, variantCommand]) {
      const originalReceipt = frames.received.find(
        (frame) =>
          (frame['receipt'] as CommandReceipt | undefined)?.commandId ===
          previousCommand.value['commandId'],
      )!['receipt'] as CommandReceipt<PostSaveCommandResult>;
      const allocations = host.receiptAllocations();
      const historical = await host.replay(reconnect.raw, previousCommand.raw);
      expect(historical[0]).toMatchObject({
        messageType: 'command.replay',
        receipt: originalReceipt,
      });
      expect(historical[1]).toMatchObject({
        messageType: 'projection.snapshot',
        revisions: originalReceipt.revisions,
        presentation: {
          base: {
            formId: 'APP-010',
            roleFilteredPayload: {
              localMetadataRevision: 1,
              metadata: {
                name: 'Локальное имя варианта',
                description: 'Только локальное описание',
                artAssetKeyOrLocalFile: {
                  kind: 'asset-key',
                  assetKey: LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS[1],
                },
              },
            },
          },
        },
      });
      if (originalReceipt.result.variant === 'EXPORT')
        expect(Buffer.from(originalReceipt.result.downloadOrNull!.contentText, 'utf8')).toEqual(
          exported[0],
        );
      else expect(originalReceipt.result.createdVariantUuidOrNull).toBe(variant.localCharacterId);
      expect(host.receiptAllocations()).toBe(allocations);
      expect(host.variantAllocations()).toBe(1);
      expect(host.checkpoint().localCharacter.payloadJson).toBe(final.localCharacter.payloadJson);
      await screen(page, 'CHR-040');
      await expect(page.getByLabel('Локальное имя', { exact: true })).toHaveValue(
        'Обновлённое имя исходного персонажа',
      );
    }
    await page.reload();
    await screen(page, 'CHR-040');
    await expect(page.getByLabel('Локальное описание', { exact: true })).toHaveValue(
      'Описание второй версии',
    );
    await host.restart();
    await page.goto(host.baseURL);
    await screen(page, 'CHR-040');
    await expect(page.getByLabel('Локальное имя', { exact: true })).toHaveValue(
      'Обновлённое имя исходного персонажа',
    );
    await action(page, 'CHR-040::CTA::003');
    await screen(page, 'APP-004');
    await page
      .getByRole('listitem')
      .filter({ hasText: 'новый вариант' })
      .getByRole('button', { name: 'Открыть: Локальное имя варианта', exact: true })
      .click();
    await screen(page, 'CHR-001');
    await expect(page.locator('[data-identity-field="name"]')).toHaveValue(
      'Локальное имя варианта',
    );
    await expect(page.locator('[data-identity-field="description"]')).toHaveValue(
      'Только локальное описание',
    );
    for (const field of ['age', 'sex', 'massKg'])
      await expect(page.locator(`[data-identity-field="${field}"]`)).toHaveValue('');
    await expect(page.locator('[data-character-art-placeholder]')).toHaveValue(
      LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS[1],
    );
    await page.locator('[data-identity-field="age"]').fill('30');
    await page.locator('[data-identity-field="massKg"]').fill('70');
    await page.locator('[data-identity-field="sex"]').selectOption('MALE');
    await expect(page.locator('[data-atlas-action-key="CHR-001::CTA::001"]')).toBeVisible();
    await action(page, 'CHR-001::CTA::001');
    await screen(page, 'CHR-010');
    expect(
      host.localCharacters().find((c) => c.localCharacterId === variant.localCharacterId)
        ?.lifecycleState,
    ).toBe('DRAFT');
    expect(host.sampleCalls()).toBe(0);
    expect(host.rollAllocations()).toBe(0);
    expect(await page.locator('body').innerText()).not.toMatch(forbidden);
    expect(errors).toEqual([]);
  } finally {
    await host.close();
  }
});
