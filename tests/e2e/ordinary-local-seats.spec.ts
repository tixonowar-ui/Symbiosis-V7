import { createHash } from 'node:crypto';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import { ORDINARY_SEAT_ACK } from '../../src/shared/ordinary-seat.js';
import {
  campaignLobbyPlayerProjectionValue,
  type CampaignLobbyPlayerProjection,
} from '../../src/shared/campaign-lobby-presentation.js';
import {
  atlasControl,
  createNetworkCampaign,
  type GmReviewMonitor,
  watchAdmissionWire,
  networkForm,
} from '../fixtures/network-admission-browser.js';
import {
  createNetworkBrowserScenario,
  safeNetworkInspection,
} from '../fixtures/network-application-e2e.js';
import {
  admitAndStart,
  connectOrdinaryPlayer,
  openInterruptibleLibrary,
  peacePayload,
  seatRoster,
  type SeatScenario,
  verifyNeutralSurface,
} from '../fixtures/local-seat-browser.js';

test.use({ channel: 'chrome' });

test('zero admitted seats return to the same network tab and select an existing FINAL without admission', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const scenario = await createNetworkBrowserScenario(browser, 1);
  const { masterPage, playerPage, gm, player } = scenario;
  let failure: unknown;
  try {
    await createNetworkCampaign(masterPage, gm.baseURL);
    await connectOrdinaryPlayer(scenario);
    const original = player.inspect();
    expect(original.sources).toHaveLength(1);
    expect(original.sources[0]).toMatchObject({
      local_character_id: player.sourceIds[0],
      lifecycle_state: 'FINAL',
    });
    const finalPayload = JSON.parse(String(original.sources[0]!['payload_json'])) as JsonObject;
    expect(finalPayload['receipt']).toMatchObject({ result: { finalSaveStatus: 'COMMITTED' } });
    expect(original.tabs).toHaveLength(1);
    expect(original.tabs[0]).toMatchObject({
      lifecycle_state: 'UNBOUND',
      retirement_command_id: null,
    });
    const sessions = gm.inspect().sessions;
    expect(sessions).toHaveLength(1);
    await atlasControl(playerPage, 'NET-003::CTA::004').click();
    await expect(networkForm(playerPage, 'APP-003')).toBeVisible();
    await atlasControl(playerPage, 'APP-003::CTA::004').click();
    await expect(networkForm(playerPage, 'PLY-027')).toBeVisible();
    await expect(
      playerPage.getByText('На этом устройстве пока нет допущенных игроков.', { exact: true }),
    ).toBeVisible();
    await expect(
      playerPage.locator('[data-atlas-action-key="PLY-027::CTA::003"]:enabled'),
    ).toHaveCount(0);
    await expect(atlasControl(playerPage, 'PLY-027::CTA::004')).toHaveCount(0);
    expect(gm.inspectOrdinarySeats().controllers).toEqual([]);
    expect(player.inspectOrdinarySeats().events).toEqual([]);
    await atlasControl(playerPage, 'PLY-027::CTA::005').click();
    await expect(networkForm(playerPage, 'APP-003')).toBeVisible();
    await expect(atlasControl(playerPage, 'APP-003::CTA::002')).toHaveCount(0);
    await atlasControl(playerPage, 'APP-003::CTA::004').click();
    await atlasControl(playerPage, 'PLY-027::CTA::006').click();
    await expect(networkForm(playerPage, 'APP-002')).toBeVisible();
    await atlasControl(playerPage, 'APP-002::CTA::003').click();
    await expect(networkForm(playerPage, 'NET-001')).toBeVisible();
    await playerPage.reload();
    await expect(networkForm(playerPage, 'NET-001')).toBeVisible({
      timeout: player.operationTimeoutMs,
    });
    await atlasControl(playerPage, 'NET-001::CTA::002').click();
    await expect(networkForm(playerPage, 'NET-003')).toBeVisible();
    const candidate = playerPage.getByRole('checkbox');
    await expect(candidate).toHaveCount(1);
    await candidate.check();
    await expect(candidate).toBeChecked();
    await atlasControl(playerPage, 'NET-003::CTA::004').click();
    await atlasControl(playerPage, 'APP-003::CTA::002').click();
    await expect(networkForm(playerPage, 'NET-003')).toBeVisible();
    await expect(candidate).toBeChecked();
    await candidate.uncheck();
    await expect(candidate).not.toBeChecked();
    await atlasControl(playerPage, 'NET-003::CTA::004').click();
    await atlasControl(playerPage, 'APP-003::CTA::001').click();
    const library = networkForm(playerPage, 'APP-004');
    await expect(library).toBeVisible();
    const ownFinal = library.getByRole('checkbox', { name: 'network-source-0', exact: true });
    await expect(ownFinal).toHaveValue(player.sourceIds[0]!);
    await ownFinal.check();
    await atlasControl(playerPage, 'APP-004::CTA::002').click();
    await expect(networkForm(playerPage, 'APP-003')).toBeVisible();
    await atlasControl(playerPage, 'APP-003::CTA::002').click();
    await expect(networkForm(playerPage, 'NET-003')).toBeVisible();
    await expect(candidate).toBeChecked();
    const returned = player.inspect();
    expect(returned.tabs).toHaveLength(1);
    const { record_json: beforeRecord, record_sha256: beforeHash, ...binding } = original.tabs[0]!;
    const {
      record_json: afterRecord,
      record_sha256: afterHash,
      ...returnedBinding
    } = returned.tabs[0]!;
    expect(returnedBinding).toEqual(binding);
    expect(createHash('sha256').update(String(beforeRecord)).digest('hex')).toBe(beforeHash);
    expect(createHash('sha256').update(String(afterRecord)).digest('hex')).toBe(afterHash);
    const beforeDocument = JSON.parse(String(beforeRecord)) as JsonObject;
    const { receipt, current } = player.inspectLocalTabHead(String(binding['network_scope_id']));
    expect(receipt.formId).toBe('NET-003');
    expect(receipt.revisions.stateRevision).toBeGreaterThan(
      Number(beforeDocument['stateRevision']),
    );
    expect(receipt.revisions.projectionRevision).toBeGreaterThan(
      Number(beforeDocument['projectionRevision']),
    );
    expect(receipt.revisions.actorVisibilityRevision).toBe(
      beforeDocument['actorVisibilityRevision'],
    );
    expect(JSON.parse(String(afterRecord))).toEqual({ ...beforeDocument, ...receipt.revisions });
    expect(current.tabId).toBe(binding['tab_id']);
    expect(current.selectedCandidates.map((member) => member.sourceUuid)).toEqual(player.sourceIds);
    expect(returned.sources).toEqual(original.sources);
    expect(gm.inspect().sessions).toEqual(sessions);
    expect(gm.inspectOrdinarySeats().controllers).toEqual([]);
    expect(player.inspectOrdinarySeats().events).toEqual([]);
  } catch (error) {
    failure = error;
  } finally {
    await scenario.close(failure);
  }
});

function watchFrames(page: Page) {
  const frames: string[] = [];
  let collecting = false;
  let firstPeace: ReturnType<typeof peacePayload> = null;
  let latestLobby: CampaignLobbyPlayerProjection | null = null;
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const raw = String(payload);
      if (collecting) frames.push(raw);
      else if (raw.includes('"projectionVariant":"PEACE_SNAPSHOT"')) firstPeace = peacePayload(raw);
      else if (raw.includes('"projectionVariant":"LOBBY_SNAPSHOT"')) {
        const frame = JSON.parse(raw) as JsonObject;
        if (frame['messageType'] !== 'projection.snapshot') return;
        const base = (frame['presentation'] as JsonObject)['base'] as JsonObject;
        if (base['formId'] === 'NET-006')
          latestLobby = campaignLobbyPlayerProjectionValue(base['roleFilteredPayload']);
      }
    });
  });
  return {
    frames,
    lobby: () => latestLobby,
    startCollecting() {
      collecting = true;
      return firstPeace;
    },
  };
}

function isUnlayeredWaiting(raw: string) {
  const frame = JSON.parse(raw) as JsonObject;
  if (frame['messageType'] !== 'projection.snapshot') return false;
  const presentation = frame['presentation'] as JsonObject;
  const base = presentation['base'] as JsonObject;
  const payload = base['roleFilteredPayload'] as JsonObject;
  return (
    base['formId'] === 'APP-003' &&
    payload['ordinarySeatView'] === 'WAITING' &&
    (presentation['layers'] as readonly JsonObject[]).length === 0
  );
}

interface SeatHosts {
  scenario: SeatScenario;
  gmReview: GmReviewMonitor;
  playerWire: GmReviewMonitor;
}

async function prepareSeatScene({ scenario, gmReview, playerWire }: SeatHosts, libraryPage: Page) {
  const { gm, player, playerPage, masterPage } = scenario;
  const locations = ['Башня дозорного', 'Причал картографа', 'Укрытие проводника'];
  await createNetworkCampaign(masterPage, gm.baseURL);
  const originals = player.inspect().sources;
  const originalNames = player.sourceIds.map((_, index) => `network-source-${index}`);
  const shell = watchFrames(libraryPage);
  shell.startCollecting();
  await libraryPage.goto(player.baseURL);
  await atlasControl(libraryPage, 'APP-001::CTA::001').click();
  await atlasControl(libraryPage, 'APP-002::CTA::002').click();
  const library = networkForm(libraryPage, 'APP-004');
  for (const name of originalNames)
    await expect(
      libraryPage.getByRole('button', { name: `Открыть: ${name}`, exact: true }),
    ).toBeVisible();
  const libraryWire = shell.frames.join('\n');
  for (const marker of [...originalNames, ...player.sourceIds])
    expect(libraryWire).toContain(marker);
  const source = watchFrames(playerPage);
  await connectOrdinaryPlayer(scenario);
  const controllers = await admitAndStart(scenario, locations, gmReview, playerWire, source.lobby);
  const first = source.startCollecting();
  if (first == null)
    throw Error('The local host did not deliver the first actual PEACE projection');
  return {
    gm,
    player,
    playerPage,
    libraryPage,
    locations,
    originals,
    originalNames,
    library,
    source,
    shell,
    controllers,
    first,
    playerWire,
  };
}

async function attachSeatDiagnostics(
  { scenario: { gm, player }, gmReview, playerWire }: SeatHosts,
  info: TestInfo,
) {
  try {
    await info.attach('ordinary-admission-wire', {
      contentType: 'application/json',
      body: JSON.stringify({ gm: gmReview, player: playerWire }),
    });
    await info.attach('ordinary-admission-state', {
      contentType: 'application/json',
      body: JSON.stringify({
        gm: safeNetworkInspection(gm),
        player: safeNetworkInspection(player),
        gmAdmission: gm.inspectAdmissionPublication(),
        ownerAdmission: player.inspectAdmissionPublication(),
        handoffEvents: player
          .inspectOrdinarySeats()
          .events.map(({ kind, command_id, receipt_id, handoff_id }) => ({
            kind,
            command_id,
            receipt_id,
            handoff_id,
          })),
      }),
    });
  } catch (error) {
    await info
      .attach('ordinary-admission-diagnostic-error', {
        contentType: 'text/plain',
        body: String(error),
      })
      .catch(() => undefined);
  }
}

const handoffTest = test.extend<{
  seatHosts: SeatHosts;
  preparedScene: Awaited<ReturnType<typeof prepareSeatScene>>;
}>({
  seatHosts: [
    async ({ browser }, use, info) => {
      const scenario = await createNetworkBrowserScenario(browser, 3);
      const hosts = {
        scenario,
        gmReview: watchAdmissionWire(scenario.masterPage),
        playerWire: watchAdmissionWire(scenario.playerPage),
      };
      try {
        await use(hosts);
      } finally {
        if (info.status !== info.expectedStatus) await attachSeatDiagnostics(hosts, info);
        await scenario.close();
      }
    },
    { timeout: 180_000 },
  ],
  preparedScene: [
    async ({ seatHosts, page }, use) => {
      // The two actual installations stay live while #171–#173 admit, review, and start the three PCs.
      await use(await prepareSeatScene(seatHosts, page));
    },
    { timeout: 360_000 },
  ],
});

handoffTest(
  'three admitted controller seats switch through a private curtain and recover the lost ACK on the addressed browser after restart',
  async ({ browser, preparedScene }) => {
    handoffTest.setTimeout(180_000);
    const {
      gm,
      player,
      playerPage,
      libraryPage,
      locations,
      originals,
      originalNames,
      library,
      source,
      shell,
      controllers,
      first,
      playerWire,
    } = preparedScene;
    const targetContext = await browser.newContext();
    try {
      const previous = controllers.find(
        (c) => c.campaign_character_id === first.campaignCharacterId,
      );
      const target = controllers.find((c) => c.campaign_character_id !== first.campaignCharacterId);
      if (!previous || !target) throw Error('Expected two different confirmed controller bindings');
      expect(first.effectiveController.localControllerSeatId).toBe(
        previous.local_controller_seat_id,
      );
      expect(locations).toContain(first.location.location);
      const privateValues = [
        ...locations,
        ...originalNames,
        ...player.sourceIds,
        ...controllers.map((c) => c.campaign_character_id),
      ];
      await expect(library).toBeVisible();
      const offlinePage = await targetContext.newPage();
      const offlineLibrary = await openInterruptibleLibrary(
        offlinePage,
        player.baseURL,
        originalNames,
      );
      await offlineLibrary.disconnect();
      await expect(networkForm(offlinePage, 'APP-004')).toHaveCount(0);
      const shellBeforeRoster = shell.frames.length;
      await atlasControl(playerPage, 'PLY-001::CTA::015').click();
      await expect(networkForm(playerPage, 'PLY-027')).toBeVisible({
        timeout: player.operationTimeoutMs,
      });
      const picker = playerPage.getByRole('combobox', { name: 'Место для передачи', exact: true });
      const roster = seatRoster(source.frames);
      expect(roster.activeSeatIdOrNull).toBe(previous.local_controller_seat_id);
      expect(roster.roster.map((entry) => entry.seatId).sort()).toEqual(
        controllers.map((c) => c.local_controller_seat_id).sort(),
      );
      expect(roster.roster.map((entry) => entry.ordinal)).toEqual([1, 2, 3]);
      const eligible = controllers
        .filter((controller) => controller.campaign_character_id !== first.campaignCharacterId)
        .map((controller) => controller.local_controller_seat_id)
        .sort();
      expect(roster.eligibleTargetSeatIds?.toSorted()).toEqual(eligible);
      const choices = await picker.locator('option[value]').all();
      const renderedTargets = (
        await Promise.all(choices.map((option) => option.getAttribute('value')))
      )
        .filter(Boolean)
        .sort();
      expect(renderedTargets).toEqual(eligible);
      const targetOrdinal = roster.roster.find(
        (entry) => entry.seatId === target.local_controller_seat_id,
      )!.ordinal;
      const chooserEvents = player.inspectOrdinarySeats().events;
      expect(chooserEvents.map((event) => event.kind)).toEqual(['ROSTER']);
      await expect(networkForm(libraryPage, 'APP-003')).toBeVisible({
        timeout: player.operationTimeoutMs,
      });
      expect(shell.frames.slice(shellBeforeRoster).some(isUnlayeredWaiting)).toBe(true);
      await expect(library).toHaveCount(0);
      for (const name of originalNames)
        await expect(
          libraryPage.getByRole('button', { name: `Открыть: ${name}`, exact: true }),
        ).toHaveCount(0);
      await verifyNeutralSurface(libraryPage, shell.frames.slice(shellBeforeRoster), privateValues);
      await verifyNeutralSurface(offlinePage, offlineLibrary.frames, privateValues);
      expect(player.inspect().sources).toEqual(originals);
      await verifyNeutralSurface(playerPage, source.frames, privateValues);
      const preReloadCount = source.frames.length;
      await playerPage.reload();
      await expect(networkForm(playerPage, 'PLY-027')).toBeVisible({
        timeout: player.operationTimeoutMs,
      });
      const reconnected = source.frames.slice(preReloadCount);
      expect(seatRoster(reconnected)).toEqual(roster);
      await verifyNeutralSurface(playerPage, reconnected, privateValues);
      expect(player.inspectOrdinarySeats().events).toEqual(chooserEvents);
      const beforeSelect = playerWire.length;
      await picker.selectOption(target.local_controller_seat_id);
      await expect(atlasControl(playerPage, 'PLY-027::CTA::004')).toHaveCount(0);
      await atlasControl(playerPage, 'PLY-027::CTA::003').click();
      const selectRequest = () =>
        playerWire
          .slice(beforeSelect)
          .find(
            (event) =>
              event.type === 'ordinary.seat.control' &&
              event.action === 'SELECT' &&
              event.targetSeatId === target.local_controller_seat_id,
          );
      const operation = { timeout: player.operationTimeoutMs };
      await expect.poll(selectRequest, operation).toBeDefined();
      const sent = selectRequest()!;
      const selectionResponse = () =>
        playerWire
          .slice(playerWire.indexOf(sent) + 1)
          .find(
            (entry) =>
              entry.socket === sent.socket &&
              (entry.type === 'closed' ||
                entry.type === 'protocol.refusal' ||
                entry.id === sent.id),
          );
      // The host confirms the source with its peer before committing BEGIN.
      // The journal entry and its curtain share a deadline so a refusal is immediately visible.
      const deadline = performance.now() + 2 * player.operationTimeoutMs;
      const remaining = () => ({ timeout: Math.max(1, Math.ceil(deadline - performance.now())) });
      await expect
        .poll(
          () =>
            selectionResponse() !== undefined ||
            player
              .inspectOrdinarySeats()
              .events.some((event) => event.kind === 'BEGIN' && event.command_id === sent.id),
          remaining(),
        )
        .toBe(true);
      await expect.poll(selectionResponse, remaining()).toBeDefined();
      expect(selectionResponse()).toMatchObject({
        type: 'projection.snapshot',
        form: 'PLY-030',
        reason: 'FORM_ACTION',
      });
      await expect(networkForm(playerPage, 'PLY-030')).toBeVisible({
        timeout: player.operationTimeoutMs,
      });
      await verifyNeutralSurface(playerPage, source.frames, privateValues);
      const beforeAck = player.inspectOrdinarySeats().events;
      expect(beforeAck.map((event) => event.kind)).toEqual(['ROSTER', 'BEGIN']);
      expect(beforeAck[0]).toEqual(chooserEvents[0]);
      expect(beforeAck[1]?.command_id).toBe(sent.id);
      const handoffId = beforeAck[1]!.handoff_id;

      offlineLibrary.restore();
      await offlinePage.reload();
      await expect(networkForm(offlinePage, 'PLY-030')).toBeVisible({
        timeout: player.operationTimeoutMs,
      });
      await verifyNeutralSurface(offlinePage, offlineLibrary.frames, privateValues);
      await offlinePage.close();
      const targetPage = await targetContext.newPage();
      const received: string[] = [],
        acknowledgements: string[] = [],
        transportErrors: string[] = [];
      const cut: { receipt?: JsonObject; refusal?: JsonObject; restart?: Promise<void> } = {};
      await targetPage.routeWebSocket('**/state', async (route) => {
        if (cut.restart !== undefined) await cut.restart;
        const server = route.connectToServer();
        let intercept = false;
        route.onMessage((message) => {
          const raw = String(message);
          const packet = JSON.parse(raw) as JsonObject;
          if (
            packet['messageType'] === 'command.request' &&
            packet['workflowCommandId'] === ORDINARY_SEAT_ACK
          ) {
            acknowledgements.push(raw);
            intercept = cut.receipt === undefined;
          }
          server.send(message);
        });
        server.onMessage((message) => {
          const raw = String(message),
            frame = JSON.parse(raw) as JsonObject;
          if (intercept) {
            if (
              frame['messageType'] === 'command.refusal' ||
              frame['messageType'] === 'protocol.refusal'
            ) {
              cut.refusal = frame;
              route.send(message);
              return;
            }
            if (cut.receipt === undefined && frame['messageType'] === 'command.result') {
              const receipt = frame['receipt'] as JsonObject;
              const expected = JSON.parse(acknowledgements[0]!) as JsonObject;
              if (receipt['commandId'] === expected['commandId']) {
                cut.receipt = receipt;
                cut.restart = player.restart();
                void Promise.all([
                  route.close({ code: 1012, reason: 'committed seat ACK response lost' }),
                  server.close(),
                ]).catch((error) => transportErrors.push(String(error)));
                return;
              }
            }
            // Drop only the transport that lost its confirmed reply. Earlier frames must be observable.
            if (cut.receipt !== undefined) return;
          }
          received.push(raw);
          route.send(message);
        });
      });
      await targetPage.goto(player.baseURL);
      await expect(networkForm(targetPage, 'PLY-030')).toBeVisible({
        timeout: player.operationTimeoutMs,
      });
      await expect(networkForm(targetPage, 'PLY-030')).toContainText(
        `Передайте устройство игроку ${targetOrdinal}.`,
      );
      await verifyNeutralSurface(targetPage, received, privateValues);
      expect(player.inspectOrdinarySeats().events).toEqual(beforeAck);
      const preActivationCount = source.frames.length;
      await atlasControl(targetPage, 'PLY-030::CTA::001').click();
      await expect
        .poll(() => cut.refusal ?? cut.receipt, { timeout: player.operationTimeoutMs })
        .toBeDefined();
      expect(cut.refusal, 'The addressed curtain must accept its original command').toBeUndefined();
      if (!cut.restart) throw Error('The ACK never triggered a physical restart');
      await cut.restart;
      await expect(networkForm(targetPage, 'PLY-001')).toBeVisible({
        timeout: player.operationTimeoutMs,
      });
      const last = received.map(peacePayload).findLast((p) => p !== null);
      if (last == null)
        throw Error('The addressed browser did not receive its confirmed PEACE sheet');
      expect(last.campaignCharacterId).toBe(target.campaign_character_id);
      expect(last.effectiveController.localControllerSeatId).toBe(target.local_controller_seat_id);
      expect(last.location.location).not.toBe(first.location.location);
      await expect(
        targetPage.getByRole('region', { name: 'Мирная сцена персонажа' }),
      ).toContainText(last.location.location);
      const request = JSON.parse(acknowledgements[0]!) as JsonObject;
      await expect(networkForm(targetPage, 'PLY-029')).toContainText(
        `Активное место: игрок ${targetOrdinal}.`,
      );
      await expect(
        networkForm(targetPage, 'PLY-029').getByRole('heading', {
          name: 'Индикатор активного локального места',
          exact: true,
        }),
      ).toBeVisible();
      const destinations = received
        .filter((raw) => peacePayload(raw) !== null)
        .map((raw) => (JSON.parse(raw) as JsonObject)['presentation'] as JsonObject)
        .filter(
          (presentation) =>
            (presentation['assignment'] as JsonObject)['reason'] === 'COMMAND_DESTINATION',
        );
      expect(destinations).toHaveLength(1);
      expect(destinations[0]!['assignment']).toMatchObject({ correlationId: request['commandId'] });
      expect(destinations[0]!['layers']).toEqual([
        expect.objectContaining({
          formId: 'PLY-029',
          roleFilteredPayload: expect.objectContaining({
            ordinarySeatView: 'ACTIVE',
            seatId: target.local_controller_seat_id,
            ordinal: targetOrdinal,
          }),
        }),
      ]);
      expect(request['payload'] as JsonObject).toMatchObject({
        handoffId,
        targetSeatId: target.local_controller_seat_id,
        decision: 'ACTIVATE_TARGET',
      });
      const replay = received
        .map((raw) => JSON.parse(raw) as JsonObject)
        .find(
          (frame) =>
            frame['messageType'] === 'command.replay' &&
            (frame['receipt'] as JsonObject)['commandId'] === request['commandId'],
        );
      expect(replay?.['receipt']).toEqual(cut.receipt);
      const replayIndex = received.findIndex((raw) => {
        const frame = JSON.parse(raw) as JsonObject;
        return (
          frame['messageType'] === 'command.replay' &&
          (frame['receipt'] as JsonObject)['commandId'] === request['commandId']
        );
      });
      expect(replayIndex).toBeGreaterThan(-1);
      expect(received.slice(0, replayIndex).some((raw) => peacePayload(raw) !== null)).toBe(false);
      expect(acknowledgements.length).toBeGreaterThanOrEqual(2);
      for (const raw of acknowledgements) expect(raw).toBe(acknowledgements[0]);
      const afterAck = player.inspectOrdinarySeats().events;
      expect(afterAck.map((event) => event.kind)).toEqual(['ROSTER', 'BEGIN', 'ACK']);
      expect(afterAck.slice(0, 2)).toEqual(beforeAck);
      expect(afterAck[2]).toMatchObject({
        command_id: request['commandId'],
        handoff_id: handoffId,
        receipt_id: (replay?.['receipt'] as JsonObject)['receiptId'],
      });
      await expect
        .poll(() => source.frames.slice(preActivationCount).some(isUnlayeredWaiting), {
          timeout: player.operationTimeoutMs,
        })
        .toBe(true);
      await verifyNeutralSurface(playerPage, source.frames, privateValues);
      await verifyNeutralSurface(libraryPage, shell.frames.slice(shellBeforeRoster), privateValues);
      expect(player.inspect().sources).toEqual(originals);
      const targetOutput = [
        received.join('\n'),
        await targetPage.content(),
        await targetPage.locator('body').ariaSnapshot(),
        await targetPage.evaluate(() => JSON.stringify(sessionStorage)),
      ].join('\n');
      for (const other of controllers.filter(
        (c) => c.campaign_character_id !== last.campaignCharacterId,
      ))
        expect(targetOutput).not.toContain(other.campaign_character_id);
      for (const location of locations.filter((x) => x !== last.location.location))
        expect(targetOutput).not.toContain(location);
      expect(gm.inspectOrdinarySeats().controllers).toEqual(controllers);
      expect(transportErrors).toEqual([]);
    } finally {
      await targetContext.close();
    }
  },
);
