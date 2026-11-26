import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { ProjectionSnapshotV2Message } from '../../src/shared/wire-v2-protocol.js';
import { createHostLocalBrowserScenario } from '../fixtures/network-application-e2e.js';
import {
  atlasControl,
  createNetworkCampaign,
  networkForm,
  reviewNetworkAdmissionCopies,
  watchAdmissionWire,
} from '../fixtures/network-admission-browser.js';
import { verifyNeutralSurface } from '../fixtures/local-seat-browser.js';
import { createFreshBrowserFinal } from '../fixtures/fresh-character-browser.js';

test.use({ channel: 'chrome' });

function receivedFrames(page: Page) {
  const frames: string[] = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/state')
      socket.on('framereceived', (event) => frames.push(String(event.payload)));
  });
  return frames;
}

const click = (page: Page, key: string) => atlasControl(page, key).click();

interface RenderedCampaignImage {
  readonly tagName: string;
  readonly currentSrc: string;
  readonly isConnected: boolean;
  decode(): Promise<void>;
}

test('a fresh host-local profile creates its own FINAL, completes admission and hands the lobby back to the GM', async ({
  browser,
}, testInfo) => {
  test.setTimeout(900_000);
  const {
    host,
    master,
    participant: player,
    close,
  } = await createHostLocalBrowserScenario(browser, 2);
  const gmWire = watchAdmissionWire(master);
  const playerFrames = receivedFrames(player);
  const masterFrames = receivedFrames(master);
  const profile = 'Игрок у окна';
  const name = 'Лада Соколова';
  const foreign = [
    ...host.sourceIds,
    'network-source-0',
    'network-source-1',
    'Два независимых устройства',
  ];
  const reply = { timeout: host.operationTimeoutMs };
  let failure: unknown;
  try {
    const artwork = await readFile(
      new URL('../../generated/media/items/itm-wpn-016.png', import.meta.url),
    );
    const artChecksum = createHash('sha256').update(artwork).digest('hex');
    await createNetworkCampaign(master, host.baseURL, artwork);
    const campaign = host.inspect().campaigns[0]!;
    await click(master, 'CMP-006::CTA::001');
    await click(master, 'CMP-007::CTA::003');
    await click(master, 'CMP-008::CTA::001');
    await expect(networkForm(master, 'CMP-009')).toBeVisible();
    await expect(master.getByText('На этом компьютере нет допущенных игроков.')).toBeVisible();
    expect(host.inspect().tabs).toHaveLength(0);
    expect(host.inspectOrdinarySeats().controllers).toHaveLength(0);
    await click(master, 'CMP-009::CTA::002');
    await master.getByLabel('Метка нового профиля').fill(profile);
    await click(master, 'APP-003::CTA::011');
    await expect(master.getByText('Выбран профиль:', { exact: false })).toContainText(profile);
    await click(master, 'APP-003::CTA::013');
    await expect(networkForm(master, 'PLY-030')).toBeVisible(reply);
    const beforeAck = host.inspectOrdinarySeats().events;
    expect(beforeAck.at(-1)).toMatchObject({ kind: 'BEGIN' });
    const gmAfterCurtain = masterFrames.length;
    await host.restart();
    await player.goto(host.baseURL);
    await expect(networkForm(player, 'PLY-030')).toBeVisible(reply);
    expect(host.inspectOrdinarySeats().events).toEqual(beforeAck);
    await verifyNeutralSurface(player, playerFrames, foreign);
    await click(player, 'PLY-030::CTA::004');
    await expect(networkForm(player, 'APP-004')).toBeVisible(reply);
    await expect(player.getByRole('checkbox')).toHaveCount(0);
    await expect(atlasControl(player, 'APP-004::CTA::007')).toHaveCount(0);
    expect(host.inspect().sources).toHaveLength(2);
    await verifyNeutralSurface(player, playerFrames, foreign);
    await createFreshBrowserFinal(player, name);
    await expect(atlasControl(player, 'CHR-040::CTA::002')).toHaveCount(0);
    const original = host
      .inspect()
      .sources.filter((s) => !host.sourceIds.includes(String(s['local_character_id'])));
    expect(original).toHaveLength(1);
    expect(original[0]).toMatchObject({ lifecycle_state: 'FINAL' });
    const characterId = String(original[0]!['local_character_id']);
    await click(player, 'CHR-040::CTA::003');
    const choice = player.getByRole('checkbox', { name, exact: true });
    await choice.check();
    await click(player, 'APP-004::CTA::002');
    await click(player, 'APP-003::CTA::009');
    await expect(networkForm(player, 'NET-003')).toBeVisible(reply);
    expect(host.inspect().copies).toHaveLength(0);
    expect(host.inspectOrdinarySeats().controllers).toHaveLength(0);
    await click(player, 'NET-003::CTA::001');
    await click(player, 'NET-004::CTA::002');
    await expect(networkForm(master, 'PLY-030')).toBeVisible(reply);
    await verifyNeutralSurface(master, masterFrames.slice(gmAfterCurtain), [
      name,
      characterId,
      ...host.sourceIds,
    ]);
    await click(master, 'PLY-030::CTA::001');
    await expect(networkForm(master, 'NET-017')).toBeVisible(reply);
    const requests = host.inspect().requests;
    expect(requests).toHaveLength(1);
    const requestId = requests[0]!['request_id'];
    if (typeof requestId !== 'string') throw new Error('Submitted request has no ID');
    expect(host.inspect().sessions).toHaveLength(1);
    expect(host.inspectOrdinarySeats().controllers).toHaveLength(0);
    await master
      .getByRole('combobox', { name: 'Локальная заявка для передачи', exact: true })
      .selectOption(requestId);
    await click(master, 'NET-017::CTA::011');
    await click(player, 'PLY-030::CTA::001');
    await expect(networkForm(player, 'NET-005')).toBeVisible(reply);
    await click(player, 'NET-005::CTA::004');
    await click(master, 'PLY-030::CTA::001');
    await expect(networkForm(master, 'NET-017')).toBeVisible(reply);
    await master.getByRole('radio').check();
    await click(master, 'NET-017::CTA::007');
    await click(master, 'NET-017::CTA::010');
    await reviewNetworkAdmissionCopies(
      master,
      true,
      ['Дом у маяка'],
      host.operationTimeoutMs,
      gmWire,
    );
    await click(master, 'NET-018::CTA::004');
    await click(master, 'NET-021::CTA::005');
    await expect
      .poll(() => host.inspect().copies, reply)
      .toMatchObject([{ lifecycle_state: 'PROPOSED' }]);
    await click(master, 'NET-021::CTA::001');
    await master
      .getByRole('combobox', { name: 'Локальная заявка для передачи', exact: true })
      .selectOption(requestId);
    await click(master, 'NET-017::CTA::011');
    await expect(networkForm(player, 'PLY-030')).toBeVisible(reply);
    await click(player, 'PLY-030::CTA::001');
    await expect(networkForm(player, 'NET-027')).toBeVisible(reply);
    const publication = host.inspectAdmissionPublication();
    expect(publication.gmDecisions).toHaveLength(1);
    await host.restart();
    await player.reload();
    await expect(networkForm(player, 'NET-027')).toBeVisible(reply);
    expect(host.inspectAdmissionPublication()).toEqual(publication);
    await click(player, 'NET-027::CTA::003');
    await expect(networkForm(player, 'NET-006')).toBeVisible(reply);
    const controllers = host.inspectOrdinarySeats().controllers;
    expect(controllers).toHaveLength(1);
    expect(controllers[0]).toMatchObject({
      owner_device_id: host.deviceId,
      campaign_id: campaign['campaign_id'],
    });
    await click(player, 'NET-006::CTA::005');
    await expect(networkForm(master, 'PLY-030')).toBeVisible(reply);
    const gmArtwork = master.getByRole('img', { name: 'Арт кампании', exact: true });
    const hostOrigin = new URL(host.baseURL).origin;
    const renderedArtwork = async () => {
      // On CI the inspector recorded an empty body even though the GM image held the complete PNG.
      // Read the blob held by this document's image without issuing a second campaign-art GET.
      await expect(gmArtwork).toBeVisible(reply);
      await expect(gmArtwork).toHaveAttribute('src', /^blob:/u, reply);
      const rendered = await gmArtwork.evaluate(
        async (image: RenderedCampaignImage, origin: string) => {
          if (image.tagName !== 'IMG') throw Error('Expected a campaign image');
          const url = new URL(image.currentSrc);
          if (url.protocol !== 'blob:' || url.origin !== origin)
            throw Error('Expected a campaign artwork blob from the current document');
          await image.decode();
          const local = await fetch(url);
          const blob = await local.blob();
          const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
          if (!local.ok || !image.isConnected || image.currentSrc !== url.href)
            throw Error('The rendered campaign artwork changed during the read');
          return { type: blob.type, bytes, url: url.href };
        },
        hostOrigin,
      );
      expect(rendered.type).toBe('image/png');
      const bytes = Buffer.from(rendered.bytes);
      expect(bytes.length).toBe(artwork.length);
      expect(
        bytes.equals(artwork),
        `Rendered PNG SHA-256: ${createHash('sha256').update(bytes).digest('hex')}`,
      ).toBe(true);
      return rendered.url;
    };
    const httpHeader = (headers: Record<string, string>, name: string) =>
      Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
    // The same URL can be fetched by the old and restored documents and by successive GM grants.
    // Chrome's loader identifies a document across same-document history changes.
    const observeGmArtwork = async (action: () => Promise<unknown>, reload = false) => {
      const session = await master.context().newCDPSession(master);
      const requests = new Map<
        string,
        {
          url: string;
          frameId: string | undefined;
          loaderId: string;
          bearer: string | undefined;
          headers?: Record<string, string>;
          finished?: boolean;
        }
      >();
      session.on('Network.requestWillBeSent', ({ requestId, request, type, frameId, loaderId }) => {
        requests.delete(requestId); // A redirect can reuse the network request ID.
        const url = new URL(request.url);
        if (
          request.method === 'GET' &&
          type === 'Fetch' &&
          url.origin === hostOrigin &&
          url.pathname.startsWith('/campaign-art/') &&
          url.pathname.endsWith('/' + artChecksum)
        )
          requests.set(requestId, {
            url: request.url,
            frameId,
            loaderId,
            bearer: httpHeader(request.headers, 'authorization'),
          });
      });
      session.on('Network.responseReceived', ({ requestId, response, frameId, loaderId }) => {
        const row = requests.get(requestId);
        if (
          row &&
          row.frameId === frameId &&
          row.loaderId === loaderId &&
          row.url === response.url &&
          response.status === 200 &&
          !response.fromDiskCache &&
          !response.fromServiceWorker
        ) {
          row.headers = response.headers;
        }
      });
      session.on('Network.loadingFinished', ({ requestId }) => {
        const row = requests.get(requestId);
        if (row) row.finished = true;
      });
      try {
        await session.send('Network.enable');
        const currentFrame = async () => (await session.send('Page.getFrameTree')).frameTree.frame;
        const prior = reload ? (await currentFrame()).loaderId : undefined;
        await action();
        await expect(networkForm(master, 'NET-016')).toBeVisible(reply);
        const frame = await currentFrame();
        if (prior !== undefined) expect(frame.loaderId).not.toBe(prior);
        const blobUrl = await renderedArtwork();
        const completed = () =>
          [...requests.values()].filter(
            (row) =>
              row.loaderId === frame.loaderId &&
              row.frameId === frame.id &&
              row.finished &&
              row.headers,
          );
        await expect.poll(() => completed().length, reply).toBeGreaterThan(0);
        const matches = completed();
        expect(new Set(matches.map((row) => row.url)).size).toBe(1);
        expect(new Set(matches.map((row) => row.bearer)).size).toBe(1);
        for (const row of matches) {
          expect(httpHeader(row.headers!, 'cache-control')).toBe('no-store');
          expect(httpHeader(row.headers!, 'content-type')).toBe('image/png');
        }
        const { bearer, url } = matches[0]!;
        if (!bearer || !/^Bearer [0-9a-f]{64}$/u.test(bearer))
          throw Error('Missing scoped GM authorization on the actual artwork request');
        expect(
          await master.evaluate(
            (address) => performance.getEntriesByName(address, 'resource').length,
            url,
          ),
        ).toBeGreaterThan(0);
        expect((await currentFrame()).loaderId).toBe(frame.loaderId);
        return { bearer, url, blobUrl };
      } finally {
        await session.detach();
      }
    };
    const firstGmArt = await observeGmArtwork(() => click(master, 'PLY-030::CTA::001'));
    const events = host.inspectOrdinarySeats().events;
    const lobby = masterFrames
      .map((raw) => JSON.parse(raw) as ProjectionSnapshotV2Message)
      .findLast(
        (m) =>
          m.messageType === 'projection.snapshot' &&
          m.protocolVersion === 2 &&
          m.projectionRole === 'gm' &&
          m.presentation.base.formId === 'NET-016',
      )?.presentation.base.roleFilteredPayload;
    expect(lobby?.['campaignId']).toBe(campaign['campaign_id']);
    expect(lobby?.['campaignArtChecksumOrNull']).toBe(artChecksum);
    const gmContextId = lobby?.['contextId'];
    if (typeof gmContextId !== 'string') throw new Error('The GM lobby has no context ID');
    const artUrl = new URL('/campaign-art/' + gmContextId + '/' + artChecksum, host.baseURL);
    expect(firstGmArt.url).toBe(artUrl.href);
    const expectRevokedArt = async (url: URL, authorization: string) => {
      const response = await fetch(url, { headers: { authorization, origin: artUrl.origin } });
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'LOCAL_GM_ONLY' });
    };
    const previousGmBearer = firstGmArt.bearer;
    await host.restart();
    const restored = await observeGmArtwork(() => master.reload({ waitUntil: 'commit' }), true);
    expect(restored.url).toBe(artUrl.href);
    const { bearer: restoredGmBearer, blobUrl: artworkBlob } = restored;
    expect(host.inspectOrdinarySeats()).toMatchObject({ controllers, events });
    const seatId = controllers[0]!.local_controller_seat_id;
    const openPlayerCurtain = async (source: 'NET-016' | 'PLY-028') => {
      await master
        .getByRole('combobox', { name: 'Место для передачи', exact: true })
        .selectOption(seatId);
      await click(master, source === 'NET-016' ? 'NET-016::CTA::006' : 'PLY-028::CTA::003');
      await expect(networkForm(player, 'PLY-030')).toBeVisible(reply);
    };
    const returnFromLobby = async () => {
      await click(player, 'NET-006::CTA::005');
      await expect(networkForm(master, 'PLY-030')).toBeVisible(reply);
      await click(master, 'PLY-030::CTA::001');
      await expect(networkForm(master, 'NET-016')).toBeVisible(reply);
    };
    const surfaces = [
      { page: master, frames: masterFrames, offset: masterFrames.length },
      { page: player, frames: playerFrames, offset: playerFrames.length },
    ];
    await openPlayerCurtain('NET-016');
    await expect(networkForm(master, 'PLY-030')).toBeVisible(reply);
    await expectRevokedArt(artUrl, restoredGmBearer);
    const transitions = host.inspectOrdinarySeats().events.slice(events.length);
    expect(transitions.map((event) => event.kind)).toEqual(['BEGIN']);
    const handoffId = transitions[0]!.handoff_id;
    const privateMarkers = [
      gmContextId,
      artChecksum,
      artworkBlob,
      'Арт кампании',
      name,
      characterId,
      ...foreign,
    ];
    const curtainReason = (raw: string) => {
      const frame = JSON.parse(raw) as ProjectionSnapshotV2Message;
      if (frame.messageType !== 'projection.snapshot' || frame.protocolVersion !== 2) return null;
      const addressed = frame.presentation.layers.some(
        (layer) =>
          layer.formId === 'PLY-030' && layer.roleFilteredPayload['handoffId'] === handoffId,
      );
      return addressed ? frame.presentation.assignment.reason : null;
    };
    for (const { page, frames, offset } of surfaces) {
      // A lobby update before BEGIN still belongs to the GM. The first curtain starts the purge.
      await expect
        .poll(() => frames.slice(offset).some((raw) => curtainReason(raw) === 'RECONNECT'), reply)
        .toBe(true);
      const received = frames.slice(offset);
      const curtain = received.findIndex((raw) => curtainReason(raw) !== null);
      await verifyNeutralSurface(page, received.slice(curtain), privateMarkers);
      await expect(networkForm(page, 'NET-016')).toHaveCount(0);
    }
    await expect(gmArtwork).toHaveCount(0);
    expect(
      await master.evaluate(async (url) => {
        try {
          return (await fetch(url)).ok;
        } catch {
          return false;
        }
      }, artworkBlob),
    ).toBe(false);
    expect(host.inspectOrdinarySeats().events.slice(events.length)).toEqual(transitions);
    await click(player, 'PLY-030::CTA::001');
    await expect(networkForm(player, 'NET-006')).toBeVisible(reply);
    await expectRevokedArt(artUrl, previousGmBearer);
    // An unavailable checksum must get the same authority denial before its bytes are looked up.
    await expectRevokedArt(new URL('0'.repeat(64), artUrl), previousGmBearer);
    await click(player, 'NET-006::CTA::003');
    await expect(player.getByText('Ваше устройство готово.', { exact: true })).toBeVisible(reply);
    const newGmArt = await observeGmArtwork(returnFromLobby);
    expect(newGmArt.url).toBe(artUrl.href);
    expect(newGmArt.bearer === previousGmBearer).toBe(false);
    await expectRevokedArt(artUrl, previousGmBearer);
    await master.getByLabel('День календаря', { exact: true }).fill('2');
    await master.getByLabel('Час', { exact: true }).fill('21');
    await master.getByLabel('Минута', { exact: true }).fill('7');
    await click(master, 'NET-016::CTA::004');
    await expect(
      master
        .getByRole('region', { name: 'Кампания и лобби' })
        .getByText(`Устройство ${host.deviceId}: не готово.`, { exact: false }),
    ).toBeVisible(reply);
    await openPlayerCurtain('NET-016');
    await click(player, 'PLY-030::CTA::001');
    await expect(player.getByText('Ваше устройство не готово.', { exact: true })).toBeVisible(
      reply,
    );
    await click(player, 'NET-006::CTA::003');
    await expect(player.getByText('Ваше устройство готово.', { exact: true })).toBeVisible(reply);
    await returnFromLobby();
    await click(master, 'NET-016::CTA::002');
    await expect(networkForm(master, 'GM-001')).toBeVisible(reply);
    await click(master, 'GM-001::CTA::012');
    await click(master, 'PLY-027::CTA::004');
    await openPlayerCurtain('PLY-028');
    await click(player, 'PLY-030::CTA::001');
    await expect(networkForm(player, 'PLY-001')).toBeVisible(reply);
    await expect(player.getByRole('region', { name: 'Мирная сцена персонажа' })).toContainText(
      'День 2, 21:07',
    );
    await click(player, 'PLY-001::CTA::015');
    await click(player, 'PLY-027::CTA::004');
    await click(player, 'PLY-028::CTA::002');
    await expect(networkForm(master, 'PLY-030')).toBeVisible(reply);
    await click(master, 'PLY-030::CTA::001');
    await expect(networkForm(master, 'GM-001')).toBeVisible(reply);
    expect(host.inspectOrdinarySeats().controllers).toEqual(controllers);
    expect(host.inspect().sources).toContainEqual(original[0]);
  } catch (error) {
    failure = error;
    // Keep the actual wire sequence available without copying passwords, delivery keys or sheets.
    const summarize = (frames: readonly string[]) =>
      frames.map((raw) => {
        const frame = JSON.parse(raw) as {
          messageType?: string;
          projectionRole?: string;
          refusal?: { code?: unknown; path?: unknown };
          presentation?: {
            base?: { formId?: string; availableActionKeys?: string[] };
            layers?: { formId?: string }[];
            assignment?: { reason?: string };
          };
          revisions?: { projectionRevision?: number };
        };
        return {
          type: frame.messageType,
          role: frame.projectionRole,
          form: frame.presentation?.base?.formId,
          actions: frame.presentation?.base?.availableActionKeys,
          layers: frame.presentation?.layers?.map((layer) => layer.formId),
          reason: frame.presentation?.assignment?.reason,
          revision: frame.revisions?.projectionRevision,
          refusal: frame.refusal?.code,
          path: frame.refusal?.path,
        };
      });
    await testInfo.attach('host-seat-wire-sequence', {
      body: JSON.stringify(
        { master: summarize(masterFrames), player: summarize(playerFrames) },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    await close(failure);
  }
});
