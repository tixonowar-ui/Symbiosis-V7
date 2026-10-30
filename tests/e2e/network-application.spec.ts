import { expect, test, type Page } from '@playwright/test';
import {
  createNetworkBrowserScenario,
  safeNetworkInspection,
} from '../fixtures/network-application-e2e.js';

test.use({ channel: 'chrome' });
test.setTimeout(120_000);
const action = (page: Page, key: string) =>
  page.locator(`[data-atlas-action-key="${key}"]`).click();
const form = (page: Page, id: string) => page.locator(`[data-atlas-form-id="${id}"]`);

async function createCampaign(page: Page, baseURL: string) {
  await page.goto(baseURL);
  await action(page, 'APP-001::CTA::002');
  await action(page, 'APP-011::CTA::006');
  await page.getByLabel('Название кампании', { exact: true }).fill('Два независимых устройства');
  await action(page, 'CMP-001::CTA::001');
  await page.getByLabel('Вместимость активных персонажей', { exact: true }).fill('3');
  const loopback = page
    .getByLabel('Сетевой интерфейс', { exact: true })
    .locator('option')
    .filter({ hasText: '127.0.0.1' });
  await page
    .getByLabel('Сетевой интерфейс', { exact: true })
    .selectOption(await loopback.getAttribute('value'));
  await page.getByLabel('Порт хоста', { exact: true }).fill(new URL(baseURL).port);
  await action(page, 'CMP-002::CTA::002');
  await page
    .getByLabel('Секрет передачи мастера', { exact: true })
    .fill('Network-test-master-secret');
  await page
    .getByLabel('Подтверждение секрета', { exact: true })
    .fill('Network-test-master-secret');
  await action(page, 'CMP-003::CTA::002');
  await page.getByLabel('Режим будущих бросков', { exact: true }).selectOption('MANUAL');
  await action(page, 'CMP-004::CTA::002');
  await action(page, 'CMP-005::CTA::001');
  await expect(form(page, 'CMP-006')).toBeVisible();
}

test('NET connects two real Node installations by manual address, submits own FINAL, restores it after both processes restart and cancels without copies', async ({
  browser,
}) => {
  const scenario = await createNetworkBrowserScenario(browser, 1);
  const { gm, player, masterPage, playerPage } = scenario;
  let failure: unknown;
  const errors: string[] = [],
    received: string[] = [],
    sent: Record<string, unknown>[] = [];
  for (const page of [masterPage, playerPage])
    page.on('pageerror', (error) => errors.push(error.message));
  playerPage.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => received.push(String(payload)));
    socket.on('framesent', ({ payload }) =>
      sent.push(JSON.parse(String(payload)) as Record<string, unknown>),
    );
  });
  try {
    expect(player.pid).not.toBe(gm.pid);
    expect(player.deviceId).not.toBe(gm.deviceId);
    await createCampaign(masterPage, gm.baseURL);
    const initialCampaign = gm.inspect(),
      originalSources = player.inspect().sources;
    await playerPage.goto(player.baseURL);
    await expect(form(playerPage, 'CHR-040')).toBeVisible();
    await action(playerPage, 'CHR-040::CTA::002');
    await expect(form(playerPage, 'CHR-027')).toBeVisible();
    expect(player.inspect().tabs).toHaveLength(1);
    const coldScope = player.inspect().tabs[0]!['network_scope_id'];
    await action(playerPage, 'CHR-027::CTA::002');
    await expect(form(playerPage, 'CHR-040')).toBeVisible();
    expect(player.inspect().tabs[0]!['retirement_command_id']).not.toBeNull();
    await action(playerPage, 'CHR-040::CTA::003');
    await action(playerPage, 'APP-004::CTA::007');
    await expect(form(playerPage, 'APP-002')).toBeVisible();
    await action(playerPage, 'APP-002::CTA::003');
    await expect(form(playerPage, 'NET-001')).toBeVisible();
    await action(playerPage, 'NET-001::CTA::001');
    await playerPage.getByLabel('Адрес или содержимое QR', { exact: true }).fill(gm.baseURL);
    await action(playerPage, 'NET-002::CTA::003');
    await expect(form(playerPage, 'NET-003')).toBeVisible();
    await expect(playerPage.getByRole('checkbox')).toHaveCount(1);
    await expect(playerPage.locator('[data-atlas-action-key="NET-003::CTA::001"]')).toHaveCount(0);
    await playerPage.getByRole('checkbox').check();
    await action(playerPage, 'NET-003::CTA::001');
    await expect(form(playerPage, 'NET-004')).toBeVisible();
    expect(gm.inspect().requests).toHaveLength(0);
    await action(playerPage, 'NET-004::CTA::002');
    await expect(form(playerPage, 'NET-005')).toBeVisible();
    await expect(
      playerPage.getByText('Заявка ожидает решения мастера.', { exact: true }),
    ).toBeVisible();
    const submitted = gm.inspect(),
      acknowledged = player.inspect();
    expect(submitted.requests).toHaveLength(1);
    expect(submitted.commands).toHaveLength(2);
    expect(submitted.copies).toEqual([]);
    expect(submitted.checkpoints).toEqual(initialCampaign.checkpoints);
    expect(acknowledged.sources).toEqual(originalSources);
    expect(acknowledged.outbox).toHaveLength(2);
    expect(acknowledged.outbox.every((row) => row['acknowledged'] === 1)).toBe(true);
    const sentSubmitCount = sent.filter(
      (frame) => frame['workflowCommandId'] === 'UI-CMD-DEVICE-REQUEST-SUBMIT',
    ).length;
    await gm.restart();
    await player.restart();
    await masterPage.reload();
    await expect(form(masterPage, 'CMP-006')).toBeVisible();
    await playerPage.reload();
    await expect(form(playerPage, 'NET-005')).toBeVisible();
    expect(gm.inspect().requests).toEqual(submitted.requests);
    expect(gm.inspect().commands).toEqual(submitted.commands);
    expect(player.inspect().outbox).toEqual(acknowledged.outbox);
    expect(
      sent.filter((frame) => frame['workflowCommandId'] === 'UI-CMD-DEVICE-REQUEST-SUBMIT'),
    ).toHaveLength(sentSubmitCount);
    await playerPage.getByLabel('Причина отмены', { exact: true }).fill('Выбираю другой состав');
    await action(playerPage, 'NET-005::CTA::001');
    await expect(form(playerPage, 'NET-003')).toBeVisible();
    const cancelled = gm.inspect();
    expect(cancelled.requests).toHaveLength(1);
    expect(cancelled.requests[0]!['closed']).toBe(1);
    expect(cancelled.commands).toHaveLength(3);
    expect(cancelled.copies).toEqual([]);
    expect(cancelled.checkpoints).toEqual(initialCampaign.checkpoints);
    expect(player.inspect().sources).toEqual(originalSources);
    const retainedScope = player
      .inspect()
      .tabs.find(
        (row) => row['lifecycle_state'] === 'UNBOUND' && row['retirement_command_id'] === null,
      )!['network_scope_id'];
    expect(retainedScope).not.toBe(coldScope);
    await action(playerPage, 'NET-003::CTA::002');
    await expect(form(playerPage, 'CHR-027')).toBeVisible();
    await action(playerPage, 'CHR-027::CTA::002');
    await expect(form(playerPage, 'CHR-040')).toBeVisible();
    await action(playerPage, 'CHR-040::CTA::002');
    await expect(form(playerPage, 'CHR-027')).toBeVisible();
    const retained = player
      .inspect()
      .tabs.filter(
        (row) => row['lifecycle_state'] === 'UNBOUND' && row['retirement_command_id'] === null,
      );
    expect(retained).toHaveLength(1);
    expect(retained[0]!['network_scope_id']).toBe(retainedScope);
    expect(gm.inspect().commands).toEqual(cancelled.commands);
    expect(player.inspect().sources).toEqual(originalSources);
    expect(
      /Network-test-master-secret|privateKey|keyFingerprint|originalCheckpoint|canonicalWitnessText|witnessSha256|hosted_network_peer|CORE-\d/u.test(
        received.join('\n'),
      ),
      'Only the public projection and receipt allowlist reaches the player browser',
    ).toBe(false);
    expect(await playerPage.locator('body').innerText()).not.toMatch(
      /CORE-\d|privateKey|witness|masterPredicate/u,
    );
    expect(errors).toEqual([]);
    expect(player.errors).toEqual([]);
    expect(gm.errors).toEqual([]);
  } catch (error) {
    failure = error;
    await test.info().attach('player-network-frames', {
      body: Buffer.from(JSON.stringify({ sent, received }, null, 2)),
      contentType: 'application/json',
    });
    await test.info().attach('network-databases', {
      body: Buffer.from(
        JSON.stringify(
          {
            hosted: safeNetworkInspection(gm),
            local: safeNetworkInspection(player),
            errors: { gm: gm.errors, player: player.errors },
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });
    throw error;
  } finally {
    await scenario.close(failure);
  }
});
async function submitOwnFinal(page: Page, address: string, ownAddress: string) {
  await page.goto(ownAddress);
  await expect(form(page, 'CHR-040')).toBeVisible();
  await action(page, 'CHR-040::CTA::003');
  await action(page, 'APP-004::CTA::007');
  await expect(form(page, 'APP-002')).toBeVisible();
  await action(page, 'APP-002::CTA::003');
  await action(page, 'NET-001::CTA::001');
  await expect(form(page, 'NET-002')).toBeVisible();
  await page.getByLabel('Адрес или содержимое QR', { exact: true }).fill(address);
  await action(page, 'NET-002::CTA::003');
  await expect(form(page, 'NET-003')).toBeVisible();
  await page.getByRole('checkbox').check();
  await action(page, 'NET-003::CTA::001');
  await expect(form(page, 'NET-004')).toBeVisible();
  await action(page, 'NET-004::CTA::002');
  await expect(form(page, 'NET-005')).toBeVisible();
}

test('GM reviews an actual owner request, delivers live decisions and restores the same queue after both Node processes restart', async ({
  browser,
}) => {
  const scenario = await createNetworkBrowserScenario(browser, 1);
  const { gm, player, masterPage, playerPage } = scenario;
  const frames: string[] = [];
  const errors: string[] = [];
  let failure: unknown;
  for (const page of [masterPage, playerPage]) {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('websocket', (ws) =>
      ws.on('framereceived', ({ payload }) => frames.push(String(payload))),
    );
  }
  try {
    await createCampaign(masterPage, gm.baseURL);
    const birth = gm.inspect().checkpoints,
      sources = player.inspect().sources;
    await action(masterPage, 'CMP-006::CTA::002');
    await expect(form(masterPage, 'NET-017')).toBeVisible();
    await expect(masterPage.getByText('Входящих заявок пока нет.', { exact: true })).toBeVisible();
    await submitOwnFinal(playerPage, gm.baseURL, player.baseURL);
    await expect(masterPage.getByRole('radio')).toHaveCount(1);
    await masterPage.getByRole('radio').check();
    await action(masterPage, 'NET-017::CTA::007');
    await expect(
      playerPage.getByText(
        'Мастер принял заявку к рассмотрению. Персонажи ещё не допущены в кампанию.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(playerPage.locator('[data-atlas-action-key="NET-005::CTA::001"]')).toHaveCount(0);
    await action(masterPage, 'NET-017::CTA::009');
    await expect(form(masterPage, 'CMP-006')).toBeVisible();
    await action(masterPage, 'CMP-006::CTA::002');
    await expect(masterPage.getByRole('radio')).toBeChecked();
    const accepted = gm.inspect().decisions;
    expect(accepted).toHaveLength(1);
    await gm.restart();
    await player.restart();
    await masterPage.reload();
    await playerPage.reload();
    await expect(form(masterPage, 'NET-017')).toBeVisible();
    await expect(form(playerPage, 'NET-005')).toBeVisible();
    expect(gm.inspect().decisions).toEqual(accepted);
    await masterPage
      .getByLabel('Причина отклонения заявки', { exact: true })
      .fill('Нужно уточнить состав заявки');
    await action(masterPage, 'NET-017::CTA::008');
    await expect(
      playerPage.getByText('Нужно уточнить состав заявки', { exact: true }),
    ).toBeVisible();
    await expect(playerPage.locator('[data-atlas-action-key="NET-005::CTA::003"]')).toBeVisible();
    expect(gm.inspect().decisions).toHaveLength(2);
    expect(gm.inspect().copies).toEqual([]);
    expect(gm.inspect().checkpoints).toEqual(birth);
    expect(player.inspect().sources).toEqual(sources);
    expect(frames.join('\n')).not.toMatch(
      /canonicalWitnessText|privateKeyPkcs8|keyFingerprintSha256|preparedVerifier|CORE-\d/u,
    );
    expect(errors).toEqual([]);
    expect(gm.errors).toEqual([]);
    expect(player.errors).toEqual([]);
  } catch (error) {
    failure = error;
    await test
      .info()
      .attach('gm-owner-frames', {
        body: Buffer.from(JSON.stringify(frames)),
        contentType: 'application/json',
      });
    throw error;
  } finally {
    await scenario.close(failure);
  }
});

test('owner cancellation removes the selected GM row and clears its reason without a decision, seat or campaign mutation', async ({
  browser,
}) => {
  const scenario = await createNetworkBrowserScenario(browser, 1);
  const { gm, player, masterPage, playerPage } = scenario;
  let failure: unknown;
  try {
    await createCampaign(masterPage, gm.baseURL);
    const birth = gm.inspect().checkpoints;
    await action(masterPage, 'CMP-006::CTA::002');
    await submitOwnFinal(playerPage, gm.baseURL, player.baseURL);
    await expect(masterPage.getByRole('radio')).toHaveCount(1);
    await masterPage.getByRole('radio').check();
    await masterPage
      .getByLabel('Причина отклонения заявки', { exact: true })
      .fill('Причина только этой заявки');
    await expect(masterPage.locator('[data-atlas-action-key="NET-017::CTA::008"]')).toBeVisible();
    await playerPage.getByLabel('Причина отмены', { exact: true }).fill('Отменяю свою заявку');
    await action(playerPage, 'NET-005::CTA::001');
    await expect(form(playerPage, 'NET-003')).toBeVisible();
    await expect(masterPage.getByRole('radio')).toHaveCount(0);
    await expect(masterPage.getByLabel('Причина отклонения заявки', { exact: true })).toHaveValue(
      '',
    );
    await expect(masterPage.locator('[data-atlas-action-key="NET-017::CTA::007"]')).toHaveCount(0);
    await expect(masterPage.locator('[data-atlas-action-key="NET-017::CTA::008"]')).toHaveCount(0);
    await masterPage.reload();
    await expect(form(masterPage, 'NET-017')).toBeVisible();
    await expect(masterPage.getByRole('radio')).toHaveCount(0);
    expect(gm.inspect().decisions).toEqual([]);
    expect(gm.inspect().copies).toEqual([]);
    expect(gm.inspect().checkpoints).toEqual(birth);
    expect(gm.errors).toEqual([]);
    expect(player.errors).toEqual([]);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await scenario.close(failure);
  }
});
