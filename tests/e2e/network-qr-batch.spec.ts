import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createNetworkBrowserScenario } from '../fixtures/network-application-e2e.js';
import type { createNetworkBrowserProcess } from '../fixtures/network-application-e2e.js';

test.use({ channel: 'chrome' });
test.setTimeout(120_000);
const SECRET = 'QR-batch-private-master-secret';
const action = (page: Page, key: string) =>
  page.locator(`[data-atlas-action-key="${key}"]`).click();
const form = (page: Page, id: string) => page.locator(`[data-atlas-form-id="${id}"]`);
const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a stored/public object');
  return value as Record<string, unknown>;
};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type NetworkProcess = Awaited<ReturnType<typeof createNetworkBrowserProcess>>;
function safeInspection(process: NetworkProcess) {
  const state = process.inspect();
  return {
    deviceId: process.deviceId,
    pid: process.pid,
    campaigns: state.campaigns.map((r) => ({
      id: r['campaign_id'],
      status: r['lifecycle_state'],
      digest: digest(r),
    })),
    checkpoints: state.checkpoints.map((r) => ({ id: r['campaign_id'], digest: digest(r) })),
    sources: state.sources.map((r) => ({ id: r['local_character_id'], digest: digest(r) })),
    copies: state.copies.map((r) => ({
      id: r['campaign_character_id'],
      status: r['lifecycle_state'],
    })),
    requests: state.requests.map((r) => ({
      id: r['request_id'],
      session: r['technical_session_id'],
      closed: r['closed'],
      digest: digest(r),
    })),
    sessions: state.sessions.map((r) => ({
      id: r['technical_session_id'],
      attempt: r['attempt_id'],
    })),
    commands: state.commands.map((r) => ({ id: r['command_id'], operation: r['operation'] })),
    outbox: state.outbox.map((r) => ({
      id: r['command_id'],
      operation: r['operation'],
      acknowledged: r['acknowledged'],
    })),
    tabs: state.tabs.map((r) => ({
      id: r['tab_id'],
      scope: r['network_scope_id'],
      status: r['lifecycle_state'],
    })),
    errors: process.errors,
  };
}
function frameSummary(frame: Record<string, unknown>) {
  const presentation = frame['presentation'];
  const base = presentation === undefined ? undefined : record(presentation)['base'];
  return {
    messageType: frame['messageType'],
    protocolVersion: frame['protocolVersion'],
    commandId: frame['commandId'],
    workflowCommandId: frame['workflowCommandId'],
    actionKey: frame['actionKey'],
    formId: base === undefined ? undefined : record(base)['formId'],
    revisions: frame['revisions'],
  };
}
async function createCampaign(page: Page, baseURL: string) {
  await page.goto(baseURL);
  await action(page, 'APP-001::CTA::002');
  await action(page, 'APP-011::CTA::006');
  await page.getByLabel('Название кампании', { exact: true }).fill('QR и три локальных листа');
  await action(page, 'CMP-001::CTA::001');
  await page.getByLabel('Вместимость активных персонажей', { exact: true }).fill('3');
  const interfaces = page.getByLabel('Сетевой интерфейс', { exact: true });
  const loopback = interfaces.locator('option').filter({ hasText: '127.0.0.1' });
  await expect(loopback).toHaveCount(1);
  await interfaces.selectOption(await loopback.getAttribute('value'));
  await page.getByLabel('Порт хоста', { exact: true }).fill(new URL(baseURL).port);
  await action(page, 'CMP-002::CTA::002');
  await page.getByLabel('Секрет передачи мастера', { exact: true }).fill(SECRET);
  await page.getByLabel('Подтверждение секрета', { exact: true }).fill(SECRET);
  await action(page, 'CMP-003::CTA::002');
  await page.getByLabel('Режим будущих бросков', { exact: true }).selectOption('MANUAL');
  await action(page, 'CMP-004::CTA::002');
  await action(page, 'CMP-005::CTA::001');
  await expect(form(page, 'CMP-006')).toBeVisible();
}

test('NET reads the actual GM QR screenshot locally, waits for explicit connect and submits three own FINALs through one counted input tab', async ({
  browser,
}) => {
  const scenario = await createNetworkBrowserScenario(browser, 3);
  const { gm, player, masterPage, playerPage } = scenario;
  let failure: unknown;
  const errors: string[] = [],
    received: Record<string, unknown>[] = [],
    sent: Record<string, unknown>[] = [];
  for (const page of [masterPage, playerPage])
    page.on('pageerror', (error) => errors.push(error.message));
  playerPage.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) =>
      received.push(record(JSON.parse(String(payload)) as unknown)),
    );
    socket.on('framesent', ({ payload }) =>
      sent.push(record(JSON.parse(String(payload)) as unknown)),
    );
  });
  try {
    expect(player.pid).not.toBe(gm.pid);
    expect(player.deviceId).not.toBe(gm.deviceId);
    expect(player.sourceIds).toHaveLength(3);
    expect(new Set(player.sourceIds).size).toBe(3);
    await createCampaign(masterPage, gm.baseURL);
    const initial = gm.inspect(),
      originalSources = player.inspect().sources;
    expect(initial.campaigns).toHaveLength(1);
    const campaign = initial.campaigns[0]!,
      campaignId = campaign['campaign_id'];
    const stored = record(JSON.parse(String(campaign['payload_json'])) as unknown),
      qrPayload = stored['qrPayload'];
    expect(typeof campaignId).toBe('string');
    expect(qrPayload).toBe(`${new URL(gm.baseURL).origin}/?campaignId=${String(campaignId)}`);
    const qr = masterPage.getByRole('img', { name: 'QR подключения к кампании', exact: true });
    await expect(qr).toBeVisible();
    const qrPng = await qr.screenshot({ type: 'png' });
    await test
      .info()
      .attach('actual-gm-campaign-qr.png', { body: qrPng, contentType: 'image/png' });

    await playerPage.goto(player.baseURL);
    await expect(form(playerPage, 'APP-001')).toBeVisible();
    await action(playerPage, 'APP-001::CTA::001');
    await expect(form(playerPage, 'APP-002')).toBeVisible();
    await action(playerPage, 'APP-002::CTA::003');
    await expect(form(playerPage, 'NET-001')).toBeVisible();
    const entered = player.inspect();
    expect(entered.tabs).toHaveLength(1);
    const tabId = entered.tabs[0]!['tab_id'];
    expect(entered.tabs[0]!['lifecycle_state']).toBe('UNBOUND');
    // Discovery is allowed to be unavailable; this scenario proves the independent QR route.
    await action(playerPage, 'NET-001::CTA::001');
    await expect(form(playerPage, 'NET-002')).toBeVisible();
    await expect(playerPage.getByLabel('Адрес или содержимое QR', { exact: true })).toHaveValue('');
    const choosing = playerPage.waitForEvent('filechooser');
    await action(playerPage, 'NET-002::CTA::005');
    await (
      await choosing
    ).setFiles({ name: 'actual-gm-qr.png', mimeType: 'image/png', buffer: qrPng });
    await expect(playerPage.getByLabel('Адрес или содержимое QR', { exact: true })).toHaveValue(
      String(qrPayload),
    );
    await expect(playerPage.getByText(/Распознан адрес: 127\.0\.0\.1, порт/u)).toBeVisible();
    await expect(playerPage.locator('[data-atlas-action-key="NET-002::CTA::003"]')).toBeVisible();
    await expect(form(playerPage, 'NET-002')).toBeVisible();
    expect(gm.inspect().sessions).toEqual([]);
    expect(gm.inspect().requests).toEqual([]);
    expect(player.inspect().outbox).toEqual([]);
    expect(sent.filter((f) => f['workflowCommandId'] === 'UI-CMD-CONNECTION-OPEN')).toEqual([]);

    await action(playerPage, 'NET-002::CTA::003');
    await expect(form(playerPage, 'NET-003')).toBeVisible();
    const checkboxes = playerPage.getByRole('checkbox');
    await expect(checkboxes).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      await checkboxes.nth(index).check();
      await expect(checkboxes.nth(index)).toBeChecked();
    }
    await action(playerPage, 'NET-003::CTA::001');
    await expect(form(playerPage, 'NET-004')).toBeVisible();
    await expect(
      playerPage.getByLabel('Проверка заявки устройства', { exact: true }),
    ).toContainText('Заявка будет отправлена только после явного подтверждения.');
    expect(gm.inspect().requests).toEqual([]);
    expect(player.inspect().tabs.map((r) => r['tab_id'])).toEqual([tabId]);
    await action(playerPage, 'NET-004::CTA::002');
    // Three complete source histories are checked within the configured transfer/RPC budgets.
    await expect(form(playerPage, 'NET-005')).toBeVisible({ timeout: player.operationTimeoutMs });
    await expect(
      playerPage.getByText('Заявка ожидает решения мастера.', { exact: true }),
    ).toBeVisible();

    const hosted = gm.inspect(),
      local = player.inspect();
    expect(hosted.sessions).toHaveLength(1);
    expect(hosted.requests).toHaveLength(1);
    expect(hosted.commands.map((r) => r['operation'])).toEqual(['OPEN', 'SUBMIT']);
    const request = record(JSON.parse(String(hosted.requests[0]!['record_json'])) as unknown),
      batch = record(request['batch']);
    expect(request['status']).toBe('PENDING');
    const candidates = batch['candidates'] as readonly Record<string, unknown>[];
    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => record(c['descriptor'])['sourceUuid']).sort()).toEqual(
      [...player.sourceIds].sort(),
    );
    const submit = sent.find((f) => f['workflowCommandId'] === 'UI-CMD-DEVICE-REQUEST-SUBMIT');
    expect(submit).toBeDefined();
    const selected = record(submit!['payload'])['selectedCandidates'] as readonly Record<
      string,
      unknown
    >[];
    expect(selected).toHaveLength(3);
    expect(candidates.map((c) => record(c['descriptor'])['sourceUuid'])).toEqual(
      selected.map((c) => c['sourceUuid']),
    );
    expect(selected.every((c) => c['requestedControllerSeat'] === tabId)).toBe(true);
    expect(local.tabs).toHaveLength(1);
    expect(local.tabs[0]).toMatchObject({ tab_id: tabId, lifecycle_state: 'PROVISIONAL' });
    expect(local.outbox.map((r) => r['operation'])).toEqual(['OPEN', 'SUBMIT']);
    expect(local.outbox.every((r) => r['acknowledged'] === 1)).toBe(true);
    expect(hosted.copies).toEqual([]);
    expect(digest(hosted.campaigns)).toBe(digest(initial.campaigns));
    expect(digest(hosted.checkpoints)).toBe(digest(initial.checkpoints));
    expect(digest(local.sources)).toBe(digest(originalSources));
    expect(local.copies).toEqual([]);
    const publicText = JSON.stringify(received);
    expect(publicText.includes(SECRET), 'GM secret must not enter the player browser').toBe(false);
    expect(
      /canonicalWitnessText|exportDocument|privateKey|keyFingerprint|originalCheckpoint|hosted_network_peer|gmLocalContextId|masterTransferPassword|learnedNodeRefs|CORE-\d/iu.test(
        publicText,
      ),
      'Only the public projection/receipt allowlist reaches the browser',
    ).toBe(false);
    const dom = await playerPage.locator('body').innerText();
    expect(/privateKey|witness|masterPredicate|CORE-\d/iu.test(dom)).toBe(false);
    await expect(form(playerPage, 'NET-017')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(player.errors).toEqual([]);
    expect(gm.errors).toEqual([]);
  } catch (error) {
    failure = error;
    await test.info().attach('qr-batch-public-frame-headers', {
      body: Buffer.from(
        JSON.stringify(
          { sent: sent.map(frameSummary), received: received.map(frameSummary) },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });
    await test.info().attach('qr-batch-database-summary', {
      body: Buffer.from(
        JSON.stringify(
          { hosted: safeInspection(gm), local: safeInspection(player), errors },
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
