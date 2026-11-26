import { expect, test, type Locator, type Page } from '@playwright/test';
import { campaignPeaceSceneValue } from '../../src/shared/campaign-lobby.js';
import type { OrdinarySeatControlV3Message } from '../../src/shared/ordinary-seat.js';
import type {
  CommandRefusalMessage,
  CommandReplayMessage,
  CommandResultMessage,
  JsonObject,
  JsonValue,
  WorkflowCommandRequestMessage,
} from '../../src/shared/wire-protocol.js';
import type {
  CampaignPeerControlV3Message,
  CampaignPeerStateV3Message,
} from '../../src/shared/campaign-lifecycle.js';
import type {
  AdmissionGmHostV3Message,
  AdmissionGmViewReplaceV3Message,
} from '../../src/shared/campaign-admission-review.js';
import type {
  FormActionIntentV2Message,
  ProjectionSnapshotV2Message,
} from '../../src/shared/wire-v2-protocol.js';

export const atlasControl = (page: Page, key: string) =>
  page.locator(`[data-atlas-action-key="${key}"]`);
export const networkForm = (page: Page, id: string) => page.locator(`[data-atlas-form-id="${id}"]`);
const action = (page: Page, key: string) => atlasControl(page, key).click();

export async function createNetworkCampaign(page: Page, baseURL: string, artwork?: Buffer) {
  await page.goto(baseURL);
  await action(page, 'APP-001::CTA::002');
  await action(page, 'APP-011::CTA::006');
  await page.getByLabel('Название кампании', { exact: true }).fill('Два независимых устройства');
  if (artwork) {
    await page.getByLabel('Изображение кампании PNG или JPEG', { exact: true }).setInputFiles({
      name: 'campaign.png',
      mimeType: 'image/png',
      buffer: artwork,
    });
    await expect(
      page.getByRole('img', { name: 'Изображение кампании', exact: true }),
    ).toBeVisible();
  }
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
  await expect(networkForm(page, 'CMP-006')).toBeVisible();
}

interface ReviewEvent {
  socket: number;
  type: string;
  id?: string;
  copy?: string;
  targetSeatId?: string;
  refusal?: string;
  action?: string;
  form?: string;
  reason?: string;
  receipt?: string;
  lifecycleState?: CommandResultMessage['lifecycleState'] | CommandReplayMessage['lifecycleState'];
  proposal?: { batchId: string; checksum: string; revision: number };
  receivedAt?: number;
  clock?: JsonValue;
  startScene?: { campaignId: string; sceneId: string; includedIds: readonly string[] };
  campaignStatus?: JsonValue;
  peace?: {
    campaign: JsonValue;
    scene: JsonValue;
    scope: JsonValue;
    owner: JsonValue;
    seat: JsonValue;
    character: JsonValue;
    context: JsonValue;
    projectionRole: ProjectionSnapshotV2Message['projectionRole'];
  };
  retry?: { command: string | null; scope: string; context: string };
  peer?: {
    attempt: JsonValue;
    context: string;
    campaign: string;
    state: CampaignPeerStateV3Message['connectionState'];
    outcome: CampaignPeerStateV3Message['retryOutcome'];
    diagnostic: CampaignPeerStateV3Message['diagnosticOrNull'];
    sequence: number;
    scope: string;
    seat: string;
    owner: string;
    pin: JsonValue;
    session: JsonValue;
  };
}
export type GmReviewMonitor = readonly ReviewEvent[];

function proposalIdentity(batchId: unknown, checksum: unknown, revision: unknown) {
  return typeof batchId === 'string' && typeof checksum === 'string' && typeof revision === 'number'
    ? { proposal: { batchId, checksum, revision } }
    : {};
}

export function watchAdmissionWire(page: Page): GmReviewMonitor {
  const events: ReviewEvent[] = [];
  let connections = 0;
  page.on('websocket', (ws) => {
    if (new URL(ws.url()).pathname !== '/state') return;
    const socket = ++connections;
    events.push({ socket, type: 'open' });
    ws.on('close', () => events.push({ socket, type: 'closed' }));
    ws.on('framesent', ({ payload }) => {
      const text = String(payload);
      if (text.includes('"messageType":"ordinary.seat.control"')) {
        const request = JSON.parse(text) as OrdinarySeatControlV3Message;
        events.push({
          socket,
          type: request.messageType,
          id: request.requestId,
          action: request.operation,
          receivedAt: Date.now(),
          ...(request.operation === 'SELECT' ? { targetSeatId: request.targetSeatId } : {}),
        });
        return;
      }
      if (text.includes('"messageType":"network.peer-control"')) {
        const request = JSON.parse(text) as CampaignPeerControlV3Message;
        events.push({
          socket,
          type: request.messageType,
          id: request.requestId,
          action: request.operation,
          receivedAt: Date.now(),
          ...(request.operation === 'RETRY'
            ? {
                retry: {
                  command: request.commandIdOrNull,
                  scope: request.networkScopeId,
                  context: request.contextId,
                },
              }
            : {}),
        });
        return;
      }
      if (
        text.includes('"messageType":"command.request"') &&
        (text.includes('"UI-CMD-ADMISSION-GM-ACCEPT"') ||
          text.includes('"UI-CMD-CAMPAIGN-INITIAL-TIME-SET"') ||
          text.includes('"UI-CMD-CAMPAIGN-START"'))
      ) {
        const request = JSON.parse(text) as WorkflowCommandRequestMessage;
        events.push({
          socket,
          type: request.messageType,
          action: request.workflowCommandId,
          id: request.commandId,
          receivedAt: Date.now(),
          ...(request.workflowCommandId === 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET'
            ? {
                clock: {
                  dayNumber: request.payload['dayNumber'] ?? null,
                  hour: request.payload['hour'] ?? null,
                  minute: request.payload['minute'] ?? null,
                },
              }
            : {}),
        });
        return;
      }
      if (text.includes('"messageType":"navigation.form-action"')) {
        const request = JSON.parse(text) as FormActionIntentV2Message;
        events.push({
          socket,
          type: request.messageType,
          action: request.actionKey,
          id: request.navigationRequestId,
        });
        return;
      }
      if (!text.includes('"network.admission-view.replace"')) return;
      const request = JSON.parse(text) as AdmissionGmViewReplaceV3Message;
      events.push({
        socket,
        type: request.messageType,
        id: request.draftUpdateId,
        copy: request.values.selectedReviewCopyId,
      });
    });
    ws.on('framereceived', ({ payload }) => {
      const text = String(payload);
      if (text.includes('"messageType":"network.peer-state"')) {
        const message = JSON.parse(text) as CampaignPeerStateV3Message;
        const f = message.formOrNull;
        const reconnect = f?.fields['pinnedCampaignPeerReconnectOrNull'] as
          JsonObject | null | undefined;
        events.push({
          socket,
          type: message.messageType,
          id: message.requestId,
          receivedAt: Date.now(),
          ...(f === null ? {} : { form: f.formId }),
          peer: {
            attempt: f?.fields['commandId'] ?? null,
            context: message.contextId,
            campaign: message.campaignId,
            scope: message.networkScopeId,
            owner: message.deviceId,
            seat: message.controllerSeat,
            state: message.connectionState,
            outcome: message.retryOutcome,
            sequence: message.sequence,
            diagnostic: message.diagnosticOrNull,
            session: f?.fields['sessionId'] ?? null,
            pin: reconnect?.['previouslyPinnedHostIdentity'] ?? null,
          },
        });
        return;
      }
      if (
        (text.includes('"messageType":"command.result"') ||
          text.includes('"messageType":"command.replay"')) &&
        (text.includes('"UI-CMD-ADMISSION-GM-ACCEPT"') ||
          text.includes('"UI-CMD-CAMPAIGN-INITIAL-TIME-SET"') ||
          text.includes('"UI-CMD-CAMPAIGN-START"'))
      ) {
        const response = JSON.parse(text) as CommandResultMessage | CommandReplayMessage;
        const { commandId, receiptId, result } = response.receipt;
        const scene =
          result['workflowCommandId'] === 'UI-CMD-CAMPAIGN-START'
            ? campaignPeaceSceneValue(result['scene'])
            : null;
        events.push({
          socket,
          type: response.messageType,
          id: commandId,
          receipt: receiptId,
          lifecycleState: response.lifecycleState,
          receivedAt: Date.now(),
          ...(result['workflowCommandId'] === 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET'
            ? { clock: result['initialCampaignTime'] ?? null }
            : {}),
          ...(scene
            ? {
                startScene: {
                  campaignId: scene.campaignId,
                  sceneId: scene.sceneId,
                  includedIds: scene.includedCopies.map((copy) => copy.campaignCharacterId),
                },
              }
            : {}),
          ...proposalIdentity(
            result['admissionBatchId'],
            result['proposalChecksumOrNull'],
            result['proposalRevisionOrNull'],
          ),
        });
        return;
      }
      if (text.includes('"messageType":"command.refusal"')) {
        const response = JSON.parse(text) as CommandRefusalMessage;
        events.push({
          socket,
          type: response.messageType,
          id: response.commandId,
          refusal: response.refusal.code,
          receivedAt: Date.now(),
        });
        return;
      }
      if (
        text.includes('"messageType":"projection.snapshot"') &&
        text.includes('"protocolVersion":2')
      ) {
        const response = JSON.parse(text) as ProjectionSnapshotV2Message;
        // PLY-029 identifies the acknowledged owner. Native review navigation still
        // targets the underlying screen or modal (for example NET-019 or GM-019).
        const active =
          response.presentation.layers.findLast(
            (layer) =>
              layer.formId !== 'PLY-029' || layer.roleFilteredPayload['hostSeatView'] !== 'ACTIVE',
          ) ?? response.presentation.base;
        const base = response.presentation.base;
        const payload = base.roleFilteredPayload;
        const body = active.roleFilteredPayload;
        const lobby = body['lobby'] as JsonObject | undefined;
        const proposal =
          active.formId === 'NET-027'
            ? proposalIdentity(
                body['admissionBatchId'],
                body['proposalChecksum'],
                body['proposalRevision'],
              )
            : {};
        events.push({
          socket,
          type: 'projection.snapshot',
          id: response.presentation.assignment.correlationId,
          form: active.formId,
          reason: response.presentation.assignment.reason,
          receivedAt: Date.now(),
          ...(active.formId === 'NET-016'
            ? { clock: body['initialCampaignTimeOrNull'] ?? null }
            : active.formId === 'NET-006'
              ? { clock: lobby?.['initialCampaignTimeOrNull'] ?? null }
              : {}),
          ...(base.formId === 'GM-001'
            ? { campaignStatus: payload['campaignStatus'] ?? null }
            : {}),
          ...(base.formId === 'PLY-001' && payload['projectionVariant'] === 'PEACE_SNAPSHOT'
            ? {
                peace: {
                  campaign: payload['campaignId'] ?? null,
                  scene: payload['sceneId'] ?? null,
                  scope: payload['networkScopeId'] ?? null,
                  owner: payload['deviceId'] ?? null,
                  context: payload['contextId'] ?? null,
                  projectionRole: response.projectionRole,
                  seat: payload['controllerSeat'] ?? null,
                  character: payload['campaignCharacterId'] ?? null,
                },
              }
            : {}),
          ...proposal,
        });
        return;
      }
      if (text.includes('"messageType":"navigation.form-action.refusal"')) {
        const response = JSON.parse(text) as {
          navigationRequestId: string;
          refusal: { code: string };
        };
        events.push({
          socket,
          type: 'navigation.form-action.refusal',
          id: response.navigationRequestId,
          refusal: response.refusal.code,
        });
        return;
      }
      if (text.includes('"protocol.refusal"')) {
        const response = JSON.parse(text) as { refusal: { code: string } };
        events.push({ socket, type: 'protocol.refusal', refusal: response.refusal.code });
        return;
      }
      if (!text.includes('"network.admission-draft.')) return;
      const response = JSON.parse(text) as AdmissionGmHostV3Message;
      if (response.messageType === 'network.admission-draft.refusal') {
        events.push({
          socket,
          type: response.messageType,
          id: response.draftUpdateId,
          refusal: response.refusal,
        });
      } else {
        const active = response.presentation.layers.at(-1) ?? response.presentation.base;
        const selected = active.roleFilteredPayload['selectedReviewCopyId'];
        events.push({
          socket,
          type: response.messageType,
          id: response.draftUpdateId,
          ...(typeof selected === 'string' ? { copy: selected } : {}),
        });
      }
    });
  });
  return events;
}

async function selectCopy(
  form: Locator,
  index: number,
  total: number,
  monitor?: GmReviewMonitor,
  timeout?: number,
) {
  const select = form.getByRole('combobox', { name: 'Персонаж набора', exact: true });
  const networkReply = timeout === undefined ? {} : { timeout };
  await expect(form).toBeVisible(networkReply);
  await expect(select).toBeEnabled(networkReply);
  await expect(select.locator('option')).toHaveCount(total, networkReply);
  const id = await select.locator('option').nth(index).getAttribute('value');
  if (!id) throw Error('Review copy has no host identity');
  if ((await select.inputValue()) === id) return;
  if (!monitor || timeout === undefined)
    throw Error('Changing a review copy requires the GM review observer');
  const before = monitor.length;
  const request = () =>
    monitor
      .slice(before)
      .find((entry) => entry.type === 'network.admission-view.replace' && entry.copy === id);
  const reply = () => {
    const sent = request();
    if (!sent) return undefined;
    return monitor
      .slice(monitor.indexOf(sent) + 1)
      .find(
        (entry) =>
          entry.socket === sent.socket &&
          (entry.type === 'closed' ||
            entry.type === 'protocol.refusal' ||
            (entry.type.startsWith('network.admission-draft.') && entry.id === sent.id)),
      );
  };
  try {
    await select.selectOption(id);
    await expect
      .poll(request, { timeout, message: 'GM did not send the selected review copy' })
      .toBeDefined();
    await expect
      .poll(reply, { timeout, message: 'GM host did not answer the correlated selection' })
      .toBeDefined();
    expect(reply()).toMatchObject({ type: 'network.admission-draft.result', copy: id });
    await expect(select).toHaveValue(id, { timeout });
  } catch (error) {
    await test
      .info()
      .attach('gm-review-copy-selection', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            selected: id,
            events: monitor.slice(Math.max(0, before - 6)),
          },
          null,
          2,
        ),
      })
      .catch(() => undefined);
    throw error;
  }
}

/** Approve each complete working copy through #172. The controller bindings exist only after owner ACCEPT. */
export async function reviewNetworkAdmissionCopies(
  page: Page,
  approveMass: boolean,
  locations: readonly string[],
  replyTimeoutMs?: number,
  monitor?: GmReviewMonitor,
) {
  const networkReply = replyTimeoutMs === undefined ? {} : { timeout: replyTimeoutMs };
  const navigate = async (key: string, destination: string) => {
    const start = monitor?.length ?? 0;
    await action(page, key);
    if (monitor && replyTimeoutMs !== undefined) {
      const terminal = () => {
        const sent = monitor.slice(start).find((event) => event.action === key);
        if (!sent) return undefined;
        return monitor
          .slice(monitor.indexOf(sent) + 1)
          .find(
            (event) =>
              event.socket === sent.socket &&
              (event.type === 'closed' ||
                event.type === 'protocol.refusal' ||
                event.id === sent.id),
          );
      };
      try {
        await expect
          .poll(terminal, { timeout: replyTimeoutMs, message: `Host response for ${key}` })
          .toBeDefined();
        expect(terminal()).toMatchObject({ type: 'projection.snapshot', form: destination });
      } catch (error) {
        await test
          .info()
          .attach('gm-review-navigation', {
            contentType: 'application/json',
            body: JSON.stringify(
              { key, destination, events: monitor.slice(Math.max(0, start - 2)) },
              null,
              2,
            ),
          })
          .catch(() => undefined);
        throw error;
      }
    }
    await expect(
      page.getByRole('group', { name: `AtlasForm ${destination}`, exact: true }),
    ).toBeVisible(networkReply);
  };
  await navigate('NET-018::CTA::002', 'NET-019');
  const review = page.getByRole('group', { name: 'AtlasForm NET-019', exact: true });
  const weapon = page.getByRole('group', { name: 'AtlasForm GM-019', exact: true });
  for (const [index] of locations.entries()) {
    await selectCopy(review, index, locations.length, monitor, replyTimeoutMs);
    await review.getByLabel('Масса одобрена', { exact: true }).setChecked(approveMass);
    await review.getByLabel('Деньги определены', { exact: true }).check();
    await review.getByLabel('Сумма стартовых денег', { exact: true }).fill('42');
    await review.getByLabel('Состав имущества подтверждён', { exact: true }).check();
    const unresolved = review.getByRole('button', {
      name: 'Исходные неопределённые позиции разобраны',
      exact: true,
    });
    if (await unresolved.count()) await unresolved.click();
    await review.getByRole('button', { name: 'Сохранить правки копии', exact: true }).click();
    await expect(
      review.getByRole('combobox', { name: 'Персонаж набора', exact: true }),
    ).toBeEnabled(networkReply);
    while (await atlasControl(page, 'NET-019::CTA::004').count()) {
      await navigate('NET-019::CTA::004', 'GM-019');
      await weapon
        .getByRole('combobox', { name: 'Исходная заявка', exact: true })
        .selectOption({ index: 1 });
      await weapon
        .getByRole('button', { name: 'Проверить и сохранить решение по оружию', exact: true })
        .click();
      await action(page, 'GM-019::CTA::005');
      await expect(networkForm(page, 'NET-019')).toBeVisible(networkReply);
    }
  }
  await navigate('NET-019::CTA::002', 'NET-018');
  await navigate('NET-018::CTA::003', 'NET-020');
  const assignment = page.getByRole('group', { name: 'AtlasForm NET-020', exact: true });
  for (const [index, location] of locations.entries()) {
    await selectCopy(assignment, index, locations.length, monitor, replyTimeoutMs);
    await assignment.getByRole('combobox', { name: 'Группа', exact: true }).selectOption('START');
    await assignment.getByLabel('Локация', { exact: true }).fill(location);
    await assignment.getByRole('button', { name: 'Сохранить правки копии', exact: true }).click();
    await expect(
      assignment.getByRole('combobox', { name: 'Персонаж набора', exact: true }),
    ).toBeEnabled(networkReply);
  }
  await navigate('NET-020::CTA::002', 'NET-018');
}
