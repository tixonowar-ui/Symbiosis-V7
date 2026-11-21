import { expect, type Page } from '@playwright/test';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import {
  campaignPeaceProjectionValue,
  type CampaignLobbyPlayerProjection,
} from '../../src/shared/campaign-lobby-presentation.js';
import { ordinarySeatViewValue } from '../../src/shared/ordinary-seat.js';
import {
  atlasControl,
  type GmReviewMonitor,
  networkForm,
  reviewNetworkAdmissionCopies,
} from './network-admission-browser.js';
import type { createNetworkBrowserScenario } from './network-application-e2e.js';

export type SeatScenario = Awaited<ReturnType<typeof createNetworkBrowserScenario>>;

export async function openInterruptibleLibrary(page: Page, baseURL: string, names: string[]) {
  let interrupted = false;
  const connections = new Set<() => Promise<void>>();
  const frames: string[] = [];
  await page.routeWebSocket('**/state', async (route) => {
    if (interrupted) {
      await route.close({ code: 1013, reason: 'library transport unavailable' });
      return;
    }
    const server = route.connectToServer();
    const close = async () => {
      await Promise.all([
        route.close({ code: 1012, reason: 'library disconnected' }),
        server.close(),
      ]);
    };
    connections.add(close);
    route.onClose(async () => {
      connections.delete(close);
      await server.close();
    });
    server.onMessage((message) => {
      frames.push(String(message));
      route.send(message);
    });
  });
  await page.goto(baseURL);
  await atlasControl(page, 'APP-001::CTA::001').click();
  await atlasControl(page, 'APP-002::CTA::002').click();
  for (const name of names)
    await expect(page.getByRole('button', { name: `Открыть: ${name}`, exact: true })).toBeVisible();
  return {
    frames,
    async disconnect() {
      interrupted = true;
      expect(connections.size).toBeGreaterThan(0);
      await Promise.all([...connections].map((close) => close()));
      frames.length = 0;
    },
    restore() {
      interrupted = false;
    },
  };
}

async function confirmedGmCommand(
  scenario: SeatScenario,
  wire: GmReviewMonitor,
  action: string,
  workflow: string,
  form: string,
) {
  const start = wire.length;
  const reply = { timeout: scenario.gm.operationTimeoutMs };
  await atlasControl(scenario.masterPage, action).click();
  const sent = () => wire.slice(start).find((event) => event.action === workflow);
  await expect.poll(sent, reply).toBeDefined();
  const request = sent()!;
  const response = () =>
    wire
      .slice(wire.indexOf(request) + 1)
      .find(
        (event) =>
          event.socket === request.socket &&
          (event.type === 'closed' ||
            event.type === 'protocol.refusal' ||
            (event.id === request.id &&
              ['command.result', 'command.refusal', 'command.replay'].includes(event.type))),
      );
  await expect.poll(response, reply).toBeDefined();
  const receipt = response()!;
  expect(receipt).toMatchObject({
    type: 'command.result',
    id: request.id,
    receipt: expect.any(String),
  });
  const destination = () =>
    wire
      .slice(start)
      .find(
        (event) =>
          event.type === 'projection.snapshot' &&
          event.id === request.id &&
          event.socket === request.socket &&
          event.reason === 'COMMAND_DESTINATION' &&
          event.form === form,
      );
  await expect.poll(destination, reply).toBeDefined();
  return { request, receipt, destination: destination()! };
}

export async function connectOrdinaryPlayer({ gm, player, playerPage }: SeatScenario) {
  await playerPage.goto(player.baseURL);
  if (player.sourceIds.length === 1) {
    await expect(networkForm(playerPage, 'CHR-040')).toBeVisible();
    await atlasControl(playerPage, 'CHR-040::CTA::003').click();
    await atlasControl(playerPage, 'APP-004::CTA::007').click();
  } else {
    await atlasControl(playerPage, 'APP-001::CTA::001').click();
  }
  await atlasControl(playerPage, 'APP-002::CTA::003').click();
  await atlasControl(playerPage, 'NET-001::CTA::001').click();
  await playerPage.getByLabel('Адрес или содержимое QR', { exact: true }).fill(gm.baseURL);
  await atlasControl(playerPage, 'NET-002::CTA::003').click();
  await expect(networkForm(playerPage, 'NET-003')).toBeVisible();
}

export async function admitAndStart(
  scenario: SeatScenario,
  locations: readonly string[],
  gmReview: GmReviewMonitor,
  playerWire: GmReviewMonitor,
  currentLobby: () => CampaignLobbyPlayerProjection | null,
) {
  const { gm, player, masterPage, playerPage } = scenario;
  await atlasControl(masterPage, 'CMP-006::CTA::002').click();
  const candidates = playerPage.getByRole('checkbox');
  await expect(candidates).toHaveCount(locations.length);
  for (let index = 0; index < locations.length; index++) {
    await candidates.nth(index).check();
    await expect(candidates.nth(index)).toBeChecked();
  }
  await atlasControl(playerPage, 'NET-003::CTA::001').click();
  await atlasControl(playerPage, 'NET-004::CTA::002').click();
  await expect(networkForm(playerPage, 'NET-005')).toBeVisible({
    timeout: player.operationTimeoutMs,
  });
  expect(player.inspect().tabs).toHaveLength(1);
  expect(gm.inspectOrdinarySeats().controllers).toEqual([]);
  await masterPage.getByRole('radio').check();
  await atlasControl(masterPage, 'NET-017::CTA::007').click();
  await atlasControl(masterPage, 'NET-017::CTA::010').click();
  await reviewNetworkAdmissionCopies(masterPage, true, locations, gm.operationTimeoutMs, gmReview);
  await atlasControl(masterPage, 'NET-018::CTA::004').click();
  const { receipt } = await confirmedGmCommand(
    scenario,
    gmReview,
    'NET-021::CTA::005',
    'UI-CMD-ADMISSION-GM-ACCEPT',
    'NET-021',
  );
  expect(receipt.proposal).toMatchObject({
    checksum: expect.stringMatching(/^[0-9a-f]{64}$/u),
    revision: 1,
  });
  const proposed = gm.inspect().copies;
  expect(proposed).toHaveLength(locations.length);
  expect(proposed.every((row) => row['lifecycle_state'] === 'PROPOSED')).toBe(true);
  // The owner's authenticated poll starts a separate delivery on the other installation.
  await expect
    .poll(() => playerWire.find((event) => event.form === 'NET-027')?.proposal, {
      timeout: player.operationTimeoutMs,
    })
    .toEqual(receipt.proposal);
  await expect(networkForm(playerPage, 'NET-027')).toBeVisible({
    timeout: player.operationTimeoutMs,
  });
  expect(gm.inspectOrdinarySeats().controllers).toEqual([]);
  await atlasControl(masterPage, 'NET-021::CTA::001').click();
  await atlasControl(masterPage, 'NET-017::CTA::009').click();
  await atlasControl(masterPage, 'CMP-006::CTA::001').click();
  await atlasControl(masterPage, 'CMP-007::CTA::001').click();
  await atlasControl(playerPage, 'NET-027::CTA::003').click();
  await expect(networkForm(playerPage, 'NET-006')).toBeVisible({
    timeout: player.operationTimeoutMs,
  });
  const controllers = gm.inspectOrdinarySeats().controllers;
  expect(controllers).toHaveLength(locations.length);
  expect(new Set(controllers.map((c) => c.local_controller_seat_id)).size).toBe(locations.length);
  expect(
    controllers.every(
      (c) =>
        c.owner_device_id === player.deviceId && c.local_controller_seat_id === c.input_lane_id,
    ),
  ).toBe(true);
  await masterPage.getByLabel('День календаря', { exact: true }).fill('2');
  await masterPage.getByLabel('Час', { exact: true }).fill('21');
  await masterPage.getByLabel('Минута', { exact: true }).fill('7');
  const reply = { timeout: player.operationTimeoutMs };
  const lobby = playerPage.getByRole('region', { name: 'Готовность к началу кампании' });
  const time = { dayNumber: 2, hour: 21, minute: 7, campaignTimestamp: 2707 };
  const calendar = await confirmedGmCommand(
    scenario,
    gmReview,
    'NET-016::CTA::004',
    'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
    'NET-016',
  );
  expect(calendar.request.clock).toEqual({ dayNumber: 2, hour: 21, minute: 7 });
  expect(calendar.receipt.clock).toEqual(time);
  expect(calendar.destination.clock).toEqual(time);
  const lostForm = playerPage.locator(
    '[data-campaign-peer-state="LOST"] [data-atlas-form-id="NET-009"]',
  );
  const needsRecovery = async () => {
    if (
      currentLobby()?.lobby.initialCampaignTimeOrNull?.campaignTimestamp === time.campaignTimestamp
    )
      return 'DELIVERED';
    const peer = playerWire.findLast((event) => event.type === 'network.peer-state');
    if (
      peer?.form === 'NET-009' &&
      peer.peer?.diagnostic === 'PEER_UNAVAILABLE' &&
      (await lostForm.isVisible())
    )
      return 'RECONNECT';
    return null;
  };
  await expect.poll(needsRecovery, reply).not.toBeNull();
  if ((await needsRecovery()) === 'RECONNECT') {
    const original = currentLobby()!;
    const lost = playerWire.findLast((event) => event.type === 'network.peer-state')!;
    const sessions = gm.inspect().sessions.map((row) => row['technical_session_id']);
    expect(sessions).toHaveLength(1);
    expect(lost.peer).toMatchObject({
      state: 'LOST',
      diagnostic: 'PEER_UNAVAILABLE',
      scope: original.networkScopeId,
      owner: player.deviceId,
      seat: original.controllerSeat,
      session: sessions[0],
      pin: gm.publicHostIdentity(),
    });
    await expect(playerPage.getByLabel('Порт мастера', { exact: true })).toHaveValue(
      new URL(gm.baseURL).port,
    );
    const start = playerWire.length;
    await lostForm.locator('[data-atlas-action-key="NET-009::CTA::001"]').click();
    const retry = () =>
      playerWire
        .slice(start)
        .find((event) => event.type === 'network.peer-control' && event.action === 'RETRY');
    await expect.poll(retry, reply).toBeDefined();
    const result = () =>
      playerWire
        .slice(start)
        .find(
          (event) =>
            event.type === 'network.peer-state' &&
            event.id === retry()?.id &&
            event.peer?.outcome !== 'NONE',
        );
    await expect.poll(result, reply).toBeDefined();
    expect(result()?.peer).toMatchObject({
      outcome: 'CONFIRMED',
      scope: original.networkScopeId,
      owner: player.deviceId,
      seat: original.controllerSeat,
    });
    expect(gm.inspect().sessions.map((row) => row['technical_session_id'])).toEqual(sessions);
  }
  await expect.poll(() => currentLobby()?.lobby.initialCampaignTimeOrNull, reply).toEqual(time);
  await expect(
    lobby.getByText('Начало: день 2, 21:07. Часы после Start остановлены.', { exact: true }),
  ).toBeVisible(reply);
  await expect(lobby.getByText('Ваше устройство не готово.', { exact: true })).toBeVisible(reply);
  const beforeReady = currentLobby()!;
  expect(beforeReady.lobby.includedCampaignCharacterIds.toSorted()).toEqual(
    controllers.map((controller) => controller.campaign_character_id).sort(),
  );
  expect(beforeReady.pendingCommandIdOrNull).toBeNull();
  await atlasControl(playerPage, 'NET-006::CTA::003').click();
  await expect(lobby.getByText('Ваше устройство готово.', { exact: true })).toBeVisible(reply);
  await expect.poll(() => currentLobby()?.readyStatus, reply).toBe('READY');
  expect(currentLobby()?.lobby.initialCampaignTimeOrNull).toEqual(time);
  await expect(atlasControl(masterPage, 'NET-016::CTA::002')).toBeVisible({
    timeout: gm.operationTimeoutMs,
  });
  await atlasControl(masterPage, 'NET-016::CTA::002').click();
  await expect(networkForm(playerPage, 'PLY-001')).toBeVisible({
    timeout: player.operationTimeoutMs,
  });
  return controllers;
}

export function peacePayload(raw: string) {
  if (!raw.includes('"projectionVariant":"PEACE_SNAPSHOT"')) return null;
  const frame = JSON.parse(raw) as JsonObject;
  if (frame['messageType'] !== 'projection.snapshot') return null;
  const presentation = frame['presentation'] as JsonObject;
  const base = presentation['base'] as JsonObject;
  const body = base['roleFilteredPayload'] as JsonObject;
  return body['projectionVariant'] === 'PEACE_SNAPSHOT' ? campaignPeaceProjectionValue(body) : null;
}

export function seatRoster(frames: readonly string[]) {
  const raw = frames.findLast((value) => value.includes('"ordinarySeatView":"ROSTER"'));
  if (!raw) throw Error('No confirmed seat roster arrived over the socket');
  const frame = JSON.parse(raw) as JsonObject;
  const presentation = frame['presentation'] as JsonObject;
  const layers = presentation['layers'] as readonly JsonObject[];
  const view = ordinarySeatViewValue(
    layers.find((layer) => layer['formId'] === 'PLY-027')?.['roleFilteredPayload'],
  );
  if (view.ordinarySeatView !== 'ROSTER') throw Error('PLY-027 did not deliver a roster');
  return view;
}

export async function verifyNeutralSurface(
  page: Page,
  frames: readonly string[],
  forbidden: readonly string[],
) {
  const values = {
    transport: frames.join('\n'),
    dom: await page.content(),
    accessibility: await page.locator('body').ariaSnapshot(),
    persistentBrowserState: JSON.stringify(await page.context().storageState({ indexedDB: true })),
    sessionStorage: await page.evaluate(() => JSON.stringify(sessionStorage)),
  };
  for (const [surface, content] of Object.entries(values)) {
    for (const value of forbidden)
      expect(content, surface + ' contains private seat data').not.toContain(value);
    expect(content, surface + ' contains private sheet data').not.toMatch(
      /"projectionVariant"\s*:\s*"PEACE_SNAPSHOT"|"mechanicalSheet"\s*:|"fullCampaignCopyDiffs"\s*:|Network-test-master-secret|"projectionRole"\s*:\s*"gm"/u,
    );
  }
  await expect(
    page.locator('[data-atlas-form-id="PLY-001"],[data-atlas-form-id^="GM-"]'),
  ).toHaveCount(0);
}
