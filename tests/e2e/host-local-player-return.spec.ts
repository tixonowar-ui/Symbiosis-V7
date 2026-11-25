import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { HOST_SEAT_ACK } from '../../src/shared/host-seat.js';
import type {
  FormActionRefusalV2Message,
  ProjectionSnapshotV2Message,
} from '../../src/shared/wire-v2-protocol.js';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import { verifyNeutralSurface } from '../fixtures/local-seat-browser.js';
import {
  atlasControl,
  createNetworkCampaign,
  networkForm,
} from '../fixtures/network-admission-browser.js';
import {
  createHostLocalBrowserScenario,
  createNetworkBrowserProcess,
  disposeNetworkResources,
} from '../fixtures/network-application-e2e.js';

test.use({ channel: 'chrome' });

const click = (page: Page, key: string) => atlasControl(page, key).click();
function wireText(frame: JsonObject, field: string) {
  const value = frame[field];
  if (typeof value !== 'string' || !value) throw new Error('Missing wire field ' + field);
  return value;
}
function captureFrames(page: Page) {
  const received: string[] = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/state')
      socket.on('framereceived', (frame) => received.push(String(frame.payload)));
  });
  return received;
}

test('a first GM_ONLY exit restores the native panel and its campaign QR after restart', async ({
  page: master,
}) => {
  test.setTimeout(240_000);
  const host = await createNetworkBrowserProcess(0);
  master.setDefaultTimeout(host.operationTimeoutMs);
  const reply = { timeout: host.operationTimeoutMs };
  let failure: unknown;
  try {
    await createNetworkCampaign(master, host.baseURL);
    const qr = master
      .getByRole('region', { name: 'Созданная кампания' })
      .getByRole('img', { name: 'QR подключения к кампании', exact: true });
    const qrDigest = async () =>
      createHash('sha256')
        .update(await qr.innerHTML())
        .digest('hex');
    const originalQr = await qrDigest();
    await click(master, 'CMP-006::CTA::001');
    await click(master, 'CMP-007::CTA::003');
    await click(master, 'CMP-008::CTA::001');
    await click(master, 'CMP-009::CTA::002');
    await click(master, 'APP-003::CTA::004');
    await expect(networkForm(master, 'PLY-027')).toBeVisible(reply);
    await click(master, 'PLY-027::CTA::001');
    await click(master, 'CMP-009::CTA::001');
    await expect(networkForm(master, 'CMP-008')).toBeVisible(reply);
    await host.restart();
    await master.reload();
    await expect(networkForm(master, 'CMP-008')).toBeVisible(reply);
    await click(master, 'CMP-008::CTA::009');
    await click(master, 'CMP-007::CTA::006');
    await expect(networkForm(master, 'CMP-006')).toBeVisible(reply);
    await expect(qr).toBeVisible(reply);
    expect(await qrDigest()).toBe(originalQr);
    await master.reload();
    await expect(networkForm(master, 'CMP-006')).toBeVisible(reply);
    await expect(qr).toBeVisible(reply);
    expect(await qrDigest()).toBe(originalQr);
    expect(host.inspectOrdinarySeats().controllers).toEqual([]);
  } catch (error) {
    failure = error;
  } finally {
    await disposeNetworkResources([() => host.close()], failure);
  }
});

test('an empty host-local candidate returns before SUBMIT through the signed GM curtain and the host restores GM_ONLY', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const {
    host,
    master,
    participant: candidate,
    close,
  } = await createHostLocalBrowserScenario(browser, 2);
  const candidateFrames = captureFrames(candidate);
  const received: string[] = [],
    sent: string[] = [],
    transportErrors: string[] = [];
  const navigationIds = new Map<string, string>();
  const cut: { receipt?: JsonObject; restart?: Promise<void> } = {};
  const reply = { timeout: host.operationTimeoutMs };
  const forbidden = [
    'network-source-0',
    'network-source-1',
    ...host.sourceIds,
    'Два независимых устройства',
  ];
  async function navigateGm(key: string, form: string) {
    const start = received.length;
    navigationIds.delete(key);
    await click(master, key);
    const terminal = () => {
      const id = navigationIds.get(key);
      if (!id) return undefined;
      for (const raw of received.slice(start)) {
        const m = JSON.parse(raw) as ProjectionSnapshotV2Message | FormActionRefusalV2Message;
        if (m.messageType === 'navigation.form-action.refusal' && m.navigationRequestId === id)
          return { refusal: m.refusal.code };
        if (
          m.messageType === 'projection.snapshot' &&
          m.protocolVersion === 2 &&
          m.presentation.assignment.correlationId === id
        )
          return { form: m.presentation.base.formId };
      }
      return undefined;
    };
    await expect.poll(terminal, { ...reply, message: 'Ответ хоста на ' + key }).toBeDefined();
    expect(terminal(), 'Переход ' + key).toEqual({ form });
    await expect(networkForm(master, form)).toBeVisible(reply);
  }
  let failure: unknown;
  try {
    // Drop exactly the first durable GM ACK reply. Reconnect must transport the browser's own request again.
    await master.routeWebSocket('**/state', async (route) => {
      if (cut.restart) await cut.restart;
      const server = route.connectToServer();
      let interceptedId: string | null = null;
      let closed = false;
      route.onMessage((message) => {
        const raw = String(message),
          f = JSON.parse(raw) as JsonObject;
        if (f['messageType'] === 'navigation.form-action')
          navigationIds.set(wireText(f, 'actionKey'), wireText(f, 'navigationRequestId'));
        if (f['messageType'] === 'host.seat.control' && f['operation'] === 'ENTER_SETUP')
          navigationIds.set('CMP-009::CTA::002', wireText(f, 'requestId'));
        if (
          f['messageType'] === 'command.request' &&
          f['workflowCommandId'] === HOST_SEAT_ACK &&
          (f['payload'] as JsonObject)['decision'] === 'RETURN_INITIATOR'
        ) {
          sent.push(raw);
          if (!cut.receipt) interceptedId = wireText(f, 'commandId');
        }
        server.send(message);
      });
      server.onMessage((message) => {
        if (closed) return;
        const raw = String(message),
          f = JSON.parse(raw) as JsonObject;
        const receipt = f['receipt'] as JsonObject | undefined;
        if (
          f['messageType'] === 'command.result' &&
          receipt &&
          receipt['commandId'] === interceptedId
        ) {
          cut.receipt = receipt;
          closed = true;
          cut.restart = host.restart();
          void Promise.all([
            route.close({ code: 1012, reason: 'Local GM ACK response lost' }),
            server.close(),
          ]).catch((error) => transportErrors.push(String(error)));
          return;
        }
        received.push(raw);
        route.send(message);
      });
    });
    await createNetworkCampaign(master, host.baseURL);
    const before = host.inspect();
    await click(master, 'CMP-006::CTA::001');
    await click(master, 'CMP-007::CTA::003');
    await navigateGm('CMP-008::CTA::001', 'CMP-009');
    await navigateGm('CMP-009::CTA::002', 'APP-003');
    const profile = 'Участник до подачи заявки';
    await master.getByLabel('Метка нового профиля').fill(profile);
    await click(master, 'APP-003::CTA::011');
    await click(master, 'APP-003::CTA::013');
    await expect(networkForm(master, 'PLY-030')).toBeVisible(reply);
    await candidate.goto(host.baseURL);
    await expect(networkForm(candidate, 'PLY-030')).toContainText(profile, reply);
    await verifyNeutralSurface(candidate, candidateFrames, forbidden);
    await click(candidate, 'PLY-030::CTA::004');
    await expect(networkForm(candidate, 'APP-004')).toBeVisible(reply);
    await expect(candidate.getByRole('checkbox')).toHaveCount(0);
    await verifyNeutralSurface(candidate, candidateFrames, forbidden);
    await click(candidate, 'APP-004::CTA::002');
    await expect(atlasControl(candidate, 'APP-003::CTA::009')).toHaveCount(0);
    await click(candidate, 'APP-003::CTA::014');
    await expect(networkForm(master, 'PLY-030')).toContainText('Мастер', reply);
    await expect(networkForm(candidate, 'PLY-030')).toContainText('Мастер', reply);
    const candidateAtCurtain = candidateFrames.length;
    await verifyNeutralSurface(candidate, [], [...forbidden, profile]);
    const journal = host.inspectOrdinarySeats().events;
    const pending = journal.at(-1)!;
    expect(pending.kind).toBe('BEGIN');
    await click(master, 'PLY-030::CTA::006');
    await expect.poll(() => cut.receipt, reply).toBeDefined();
    await cut.restart;
    await expect(networkForm(master, 'CMP-009')).toBeVisible(reply);
    expect(sent.length).toBeGreaterThanOrEqual(2);
    for (const raw of sent) expect(raw).toBe(sent[0]);
    const request = JSON.parse(sent[0]!) as JsonObject;
    expect(request['payload']).toMatchObject({
      decision: 'RETURN_INITIATOR',
      handoffId: pending.handoff_id,
    });
    const replay = received
      .map((raw) => JSON.parse(raw) as JsonObject)
      .find(
        (f) =>
          f['messageType'] === 'command.replay' &&
          (f['receipt'] as JsonObject)['commandId'] === request['commandId'],
      );
    expect(replay?.['receipt']).toEqual(cut.receipt);
    const after = host.inspectOrdinarySeats();
    expect(after.events.slice(0, -1)).toEqual(journal);
    expect(after.events.at(-1)).toMatchObject({
      kind: 'ACK',
      command_id: request['commandId'],
      handoff_id: pending.handoff_id,
      receipt_id: cut.receipt!['receiptId'],
    });
    expect(after.controllers).toEqual([]);
    await verifyNeutralSurface(candidate, candidateFrames.slice(candidateAtCurtain), [
      ...forbidden,
      profile,
    ]);

    await navigateGm('CMP-009::CTA::001', 'CMP-008');
    await navigateGm('CMP-008::CTA::001', 'CMP-009');
    await navigateGm('CMP-009::CTA::002', 'APP-003');
    await click(master, 'APP-003::CTA::004');
    await expect(networkForm(master, 'PLY-027')).toContainText(
      'На этом компьютере играет только мастер. Допущенных игроков нет.',
      reply,
    );
    await expect(atlasControl(master, 'PLY-027::CTA::003')).toHaveCount(0);
    await master.reload();
    await expect(networkForm(master, 'PLY-027')).toBeVisible(reply);
    await navigateGm('PLY-027::CTA::001', 'CMP-009');
    await navigateGm('CMP-009::CTA::002', 'APP-003');
    await navigateGm('APP-003::CTA::005', 'CMP-009');
    await master.reload();
    await expect(networkForm(master, 'CMP-009')).toBeVisible(reply);
    await navigateGm('CMP-009::CTA::001', 'CMP-008');
    await master.reload();
    await expect(networkForm(master, 'CMP-008')).toBeVisible(reply);
    const final = host.inspect();
    expect(final.sources).toEqual(before.sources);
    expect(final.requests).toEqual([]);
    expect(final.copies).toEqual([]);
    expect(final.sessions).toEqual(before.sessions);
    expect(final.tabs).toEqual(before.tabs);
    expect(transportErrors).toEqual([]);
    expect(host.inspectOrdinarySeats().controllers).toEqual([]);
  } catch (error) {
    failure = error;
  } finally {
    await close(failure);
  }
});
