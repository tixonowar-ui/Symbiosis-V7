import { expect, test } from '@playwright/test';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import {
  createNetworkBrowserProcess,
  disposeNetworkResources,
} from '../fixtures/network-application-e2e.js';
import { createNpcPlayerPrivacyProbe } from '../fixtures/npc-privacy-e2e.js';
import {
  NPC_TEST_MASTER_SECRET,
  advanceRetainedNpc,
  confirmNpcInput,
  enterNpcLibrary,
  fillOrdinaryNpc,
  npcAction,
  npcForm,
} from '../fixtures/npc-authoring-e2e.js';

test.use({ channel: 'chrome' });

test('NPC saves a full V1 before Start, retains history, replays a lost N+1 receipt and restores both versions after process restart', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const host = await createNetworkBrowserProcess(0);
  let player: Awaited<ReturnType<typeof createNpcPlayerPrivacyProbe>> | undefined;
  let scenarioError: unknown;
  const errors: string[] = [];
  const sent: { raw: string; value: JsonObject }[] = [];
  const replies: JsonObject[] = [];
  const loss: { armed: boolean; commandId: string | null; receipt: unknown; cut: boolean } = {
    armed: false,
    commandId: null,
    receipt: null,
    cut: false,
  };
  page.on('pageerror', (error) => errors.push(error.message));
  // Only drop delivery. Every request and every received projection is produced by the real host.
  await page.routeWebSocket('**/state', (route) => {
    const server = route.connectToServer();
    let cut = false;
    route.onMessage((message) => {
      const raw = String(message),
        value = JSON.parse(raw) as JsonObject;
      sent.push({ raw, value });
      if (
        loss.armed &&
        value['workflowCommandId'] === 'UI-CMD-NPC-NEW-VERSION' &&
        (value['payload'] as JsonObject)['phase'] === 'COMMIT'
      ) {
        loss.commandId = value['commandId'] as string;
        loss.armed = false;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (cut) return;
      const value = JSON.parse(String(message)) as JsonObject;
      replies.push(value);
      if (
        !loss.cut &&
        loss.commandId !== null &&
        value['messageType'] === 'command.result' &&
        (value['receipt'] as JsonObject)['commandId'] === loss.commandId
      ) {
        loss.receipt = value['receipt'];
        loss.cut = true;
        cut = true;
        void Promise.all([
          route.close({ code: 1012, reason: 'Lost NPC receipt delivery' }),
          server.close(),
        ]).catch((error: unknown) => errors.push(String(error)));
        return;
      }
      route.send(message);
    });
  });
  try {
    await enterNpcLibrary(page, host.baseURL);
    const before = host.inspect();
    expect(before.copies).toEqual([]);
    expect(before.campaigns).toHaveLength(1);
    expect(before.campaigns[0]!['lifecycle_state']).toBe('PAUSED');
    expect(host.inspectNpc().versions).toEqual([]);
    player = await createNpcPlayerPrivacyProbe(browser, host.baseURL);
    await fillOrdinaryNpc(page, 'Наблюдатель');
    expect(host.inspectNpc().versions).toEqual([]);
    await npcAction(page, 'NPC-017::CTA::002', 'NPC-003');
    const first = host.inspectNpc();
    expect(first.versions).toHaveLength(1);
    const v1 = JSON.parse(first.versions[0]!) as JsonObject;
    const snapshot = v1['snapshot'] as JsonObject;
    const sheet = snapshot['sheet'] as JsonObject;
    const input = sheet['input'] as JsonObject;
    const lifeRequests = sent.filter(
      ({ value }) =>
        value['messageType'] === 'network.npc-preparation.request' &&
        (value['preparation'] as JsonObject)['kind'] === 'LIFE_STATE_SET',
    );
    expect(lifeRequests.length).toBeGreaterThanOrEqual(1);
    expect(lifeRequests.every((frame) => frame.raw === lifeRequests[0]!.raw)).toBe(true);
    const lifeRequest = lifeRequests[0]!.value;
    const firstOperations = first.operations.map((raw) => JSON.parse(raw) as JsonObject);
    const lifeOperations = firstOperations.filter(
      (operation) => operation['operationId'] === lifeRequest['operationId'],
    );
    expect(lifeOperations).toHaveLength(1);
    expect(lifeOperations[0]!['request']).toEqual(lifeRequest);
    const commitOperations = firstOperations.filter(
      (operation) => operation['operationId'] === v1['operationId'],
    );
    expect(commitOperations).toHaveLength(1);
    expect(commitOperations[0]!['committedAt']).toBe(v1['committedAt']);
    expect(lifeRequest['preparation']).toMatchObject({
      kind: 'LIFE_STATE_SET',
      input: {
        lifeKind: 'ALIVE',
        reason: 'Исходное живое состояние NPC',
        remainingMinutesOrNull: null,
      },
    });
    const lifeState = {
      lifeKind: 'ALIVE',
      dead: false,
      severeWound: false,
      deathTimerOrNull: null,
      restrictionOrNull: null,
      anchor: {
        kind: 'GM_FORMAL_INITIAL_LIFE',
        campaignId: (v1['scope'] as JsonObject)['campaignId'],
        npcUuid: v1['npcUuid'],
        lifeKind: 'ALIVE',
        initialStateConfirmationId: lifeRequest['operationId'],
        reason: 'Исходное живое состояние NPC',
        // ADR0085 binds a published state to its actual owning COMMIT time.
        createdAt: commitOperations[0]!['committedAt'],
        severeWoundOrNull: null,
      },
    };
    expect((input['initialState'] as JsonObject)['sourceSpecificStates']).toEqual([lifeState]);
    expect(v1).toMatchObject({ version: 1, previousVersionSha256OrNull: null });
    expect(input).toMatchObject({
      identity: {
        name: 'Наблюдатель',
        description: null,
        affiliation: 'Нейтральный',
        campaignRole: 'Свидетель',
        raceCode: 'PURE',
        pureClassOrNull: 'SEEKER',
        sex: 'MALE',
        massKg: 75,
        anatomyProfileId: 'STANDARD_HUMANOID',
      },
      baseStats: { S: 10, D: 10, M: 10, Z: 10, I: 10, W: 2, C: 10 },
      symbionts: [],
      inventory: [],
      initialState: {
        currentHP: 70,
        dead: false,
        currentTraumas: [],
        currentWounds: [],
        effectInstances: [],
        sourceSpecificStates: [lifeState],
        deathTimerRollFactOrNull: null,
      },
    });
    expect(sheet).toMatchObject({
      maxHP: 100, // CORE-152 ordinary maximum; the explicit current HP remain 70.
      requiresCampaignTime: false,
      combatContext: { kind: 'ABSENT' },
    });
    await expect(page.locator('[data-npc-content="NPC-003"]')).toContainText(
      'Показана версия 1. Текущая версия: 1.',
    );
    // The independent PLAYER has been connected throughout V1 publication.
    const privateValues = [
      NPC_TEST_MASTER_SECRET,
      'Наблюдатель',
      'Исходное живое состояние NPC',
      v1['npcUuid'] as string,
      v1['npcDraftId'] as string,
      v1['operationId'] as string,
      lifeRequest['operationId'] as string,
      (v1['scope'] as JsonObject)['gmLocalContextId'] as string,
    ];
    await player.refreshPlayer();
    await player.assertHidden(privateValues);
    await expect(
      page.getByRole('img', { name: 'Изображение Наблюдатель', exact: true }),
    ).toBeVisible();
    const portrait = sent.find(
      ({ value }) =>
        value['messageType'] === 'network.npc-art.read' &&
        value['sourceFormId'] === 'NPC-003' &&
        (value['target'] as JsonObject)['kind'] === 'VERSION' &&
        (value['target'] as JsonObject)['npcUuid'] === v1['npcUuid'] &&
        (value['target'] as JsonObject)['version'] === 1 &&
        replies.some(
          (reply) =>
            reply['messageType'] === 'network.npc-art.result' &&
            reply['requestId'] === value['requestId'],
        ),
    )?.value;
    if (portrait === undefined) throw Error('Actual saved V1 portrait request absent');
    expect(
      replies.find(
        (reply) =>
          reply['messageType'] === 'network.npc-art.result' &&
          reply['requestId'] === portrait['requestId'],
      ),
    ).toMatchObject({
      ...portrait,
      messageType: 'network.npc-art.result',
    });
    await player.refuseNpcAccess(portrait);
    await player.assertHidden(privateValues);
    expect(host.inspectNpc()).toEqual(first);
    await npcAction(page, 'NPC-003::CTA::009', 'NPC-007');
    await expect(
      page.getByRole('radio', { name: 'Версия 1 — текущая', exact: true }),
    ).toBeVisible();
    const openSentStart = sent.length;
    await page.locator('[data-atlas-action-key="NPC-007::CTA::002"]').click();
    await expect(npcForm(page, 'NPC-002')).toBeVisible({ timeout: 15_000 });
    const openRequest = sent
      .slice(openSentStart)
      .find(
        ({ value }) =>
          value['workflowCommandId'] === 'UI-CMD-NPC-NEW-VERSION' &&
          (value['payload'] as JsonObject)['phase'] === 'OPEN',
      )?.value;
    expect(openRequest).toMatchObject({
      messageType: 'command.request',
      payload: {
        phase: 'OPEN',
        campaignId: (v1['scope'] as JsonObject)['campaignId'],
        npcUuid: v1['npcUuid'],
        expectedCurrentVersion: 1,
      },
    });
    const openReply = replies.find(
      (reply) =>
        reply['messageType'] === 'command.result' &&
        (reply['receipt'] as JsonObject)['commandId'] === openRequest!['commandId'],
    );
    expect(openReply).toMatchObject({
      lifecycleState: 'COMMITTED',
      receipt: {
        commandId: openRequest!['commandId'],
        result: { workflowCommandId: 'UI-CMD-NPC-NEW-VERSION', operationKind: 'OPEN' },
      },
    });
    expect(
      replies.find(
        (reply) =>
          reply['messageType'] === 'projection.snapshot' &&
          ((reply['presentation'] as JsonObject)['assignment'] as JsonObject | null)?.[
            'correlationId'
          ] === openRequest!['commandId'],
      ),
    ).toMatchObject({
      revisions: (openReply!['receipt'] as JsonObject)['revisions'],
      presentation: {
        assignment: { correlationId: openRequest!['commandId'], reason: 'COMMAND_DESTINATION' },
        base: { formId: 'NPC-002' },
      },
    });
    expect(host.inspectNpc().versions).toEqual(first.versions);
    await expect(page.getByLabel('Имя НПС', { exact: true })).toHaveValue('Наблюдатель');
    await page.getByLabel('Имя НПС', { exact: true }).fill('Наблюдатель после встречи');
    await confirmNpcInput(page);
    await advanceRetainedNpc(page);
    await page.getByLabel('Текущие HP', { exact: true }).fill('69');
    await confirmNpcInput(page);
    await npcAction(page, 'NPC-016::CTA::003', 'NPC-017');
    loss.armed = true;
    await page.locator('[data-atlas-action-key="NPC-017::CTA::002"]').click();
    await expect.poll(() => loss.cut, { timeout: 60_000 }).toBe(true);
    expect(loss.cut).toBe(true);
    const reconnect = page.getByRole('button', { name: 'Переподключиться', exact: true });
    await expect(reconnect).toBeVisible({ timeout: 15_000 });
    const reconnectSentStart = sent.length;
    await reconnect.click();
    // Resume recovers the immutable receipt before its current capabilities/snapshot pair.
    await expect
      .poll(
        () =>
          replies.find(
            (reply) =>
              reply['messageType'] === 'command.replay' &&
              (reply['receipt'] as JsonObject)['commandId'] === loss.commandId,
          )?.['receipt'],
        { timeout: 60_000 },
      )
      .toEqual(loss.receipt);
    await expect(npcForm(page, 'NPC-003')).toBeVisible({ timeout: 15_000 });
    const resume = sent
      .slice(reconnectSentStart)
      .find(({ value }) => value['messageType'] === 'campaign.local-context.resume')?.value;
    expect(resume).toMatchObject({
      protocolVersion: 3,
      gmLocalContextId: (v1['scope'] as JsonObject)['gmLocalContextId'],
      reconnectRequestId: expect.any(String),
      unacknowledgedCommandIds: [loss.commandId],
    });
    const recoveredProjection = replies.find(
      (reply) =>
        reply['messageType'] === 'projection.snapshot' &&
        ((reply['presentation'] as JsonObject)['assignment'] as JsonObject | null)?.[
          'correlationId'
        ] === resume!['reconnectRequestId'],
    );
    expect(recoveredProjection).toMatchObject({
      presentation: {
        assignment: { correlationId: resume!['reconnectRequestId'], reason: 'RECONNECT' },
        base: { formId: 'NPC-003' },
      },
    });
    expect(
      replies.find(
        (reply) =>
          reply['messageType'] === 'session.reconnect.capabilities' &&
          reply['reconnectRequestId'] === resume!['reconnectRequestId'],
      ),
    ).toMatchObject({ revisions: recoveredProjection!['revisions'] });
    await expect(page.locator('[data-atlas-action-key="NPC-003::CTA::009"]')).toBeEnabled();
    const retries = sent.filter((frame) => frame.value['commandId'] === loss.commandId);
    // A committed command can replay from its pending ID without a second SAVE request.
    expect(retries.length).toBeGreaterThanOrEqual(1);
    expect(retries.every((frame) => frame.raw === retries[0]!.raw)).toBe(true);
    expect(
      replies.find(
        (reply) =>
          reply['messageType'] === 'command.replay' &&
          (reply['receipt'] as JsonObject)['commandId'] === loss.commandId,
      )?.['receipt'],
    ).toEqual(loss.receipt);
    const saved = host.inspectNpc();
    expect(saved.versions).toHaveLength(2);
    expect(saved.versions[0]).toBe(first.versions[0]);
    const v2 = JSON.parse(saved.versions[1]!) as JsonObject;
    expect(v2).toMatchObject({ npcUuid: v1['npcUuid'], version: 2, operationId: loss.commandId });
    expect(v2['art']).toEqual(v1['art']);
    expect(((v2['snapshot'] as JsonObject)['sheet'] as JsonObject)['input']).toEqual({
      ...input,
      identity: {
        ...(input['identity'] as JsonObject),
        name: 'Наблюдатель после встречи',
        artAssetKeyOrNull: (v1['art'] as JsonObject)['assetKey'],
      },
      initialState: { ...(input['initialState'] as JsonObject), currentHP: 69 },
    });
    expect(
      saved.operations
        .map((raw) => JSON.parse(raw) as JsonObject)
        .filter((operation) => operation['operationId'] === loss.commandId),
    ).toHaveLength(1);
    // Scan the complete observation window again, including the N+1 lost-receipt replay.
    await player.assertHidden([
      ...privateValues,
      'Наблюдатель после встречи',
      v2['operationId'] as string,
      v2['previousVersionSha256OrNull'] as string,
    ]);
    await player.close();
    expect(host.inspectNpc()).toEqual(saved);
    const firstPid = host.pid;
    await host.restart();
    expect(host.pid).not.toBe(firstPid);
    await page.reload();
    await expect(npcForm(page, 'NPC-003')).toBeVisible({ timeout: 15_000 });
    expect(host.inspectNpc()).toEqual(saved);
    await expect(page.locator('[data-npc-content="NPC-003"]')).toContainText(
      'Наблюдатель после встречи',
    );
    await npcAction(page, 'NPC-003::CTA::009', 'NPC-007', 60_000);
    const selectHistoryVersion = async (version: 1 | 2, label: string) => {
      const sentStart = sent.length,
        replyStart = replies.length;
      const radio = page.getByRole('radio', { name: label, exact: true });
      // The checked value comes from the host projection, after the selection command completes.
      await radio.click();
      await expect(radio).toBeChecked({ timeout: 30_000 });
      const requests = sent
        .slice(sentStart)
        .filter(({ value }) => value['messageType'] === 'network.npc-selection.replace');
      expect(requests).toHaveLength(1);
      const request = requests[0]!.value;
      expect(request).toMatchObject({
        operationId: expect.any(String),
        campaignId: (v1['scope'] as JsonObject)['campaignId'],
        sourceFormId: 'NPC-007',
        npcUuid: v1['npcUuid'],
        version,
      });
      const result = replies
        .slice(replyStart)
        .find(
          (reply) =>
            reply['messageType'] === 'network.npc-selection.result' &&
            reply['operationId'] === request['operationId'],
        );
      expect(result).toMatchObject({
        operationId: request['operationId'],
        campaignId: request['campaignId'],
        sourceFormId: 'NPC-007',
        npcUuid: v1['npcUuid'],
        version,
      });
      expect(
        replies
          .slice(replyStart)
          .find(
            (reply) =>
              reply['messageType'] === 'projection.snapshot' &&
              ((reply['presentation'] as JsonObject)['assignment'] as JsonObject | null)?.[
                'correlationId'
              ] === request['operationId'],
          ),
      ).toMatchObject({
        revisions: result!['appliedRevisions'],
        presentation: {
          assignment: { correlationId: request['operationId'], reason: 'FORM_ACTION' },
          base: {
            formId: 'NPC-007',
            roleFilteredPayload: {
              content: {
                npcUuid: v1['npcUuid'],
                currentVersion: 2,
                selectedVersionOrNull: version,
                previewOrNull: { displayedVersion: version, currentVersion: 2 },
              },
            },
          },
        },
      });
    };
    await selectHistoryVersion(1, 'Версия 1');
    await expect(page.locator('[data-npc-content="NPC-003"]')).toContainText(
      'Показана версия 1. Текущая версия: 2.',
    );
    await expect(page.locator('[data-npc-content="NPC-003"] h3')).toHaveText('Наблюдатель');
    await selectHistoryVersion(2, 'Версия 2 — текущая');
    await expect(page.locator('[data-npc-content="NPC-003"] h3')).toHaveText(
      'Наблюдатель после встречи',
    );
    expect(host.inspectNpc().versions).toEqual(saved.versions);
    expect(host.inspect().copies).toEqual([]);
    expect(sent.some((frame) => frame.value['workflowCommandId'] === 'UI-CMD-CAMPAIGN-START')).toBe(
      false,
    );
    expect(errors).toEqual([]);
    expect(host.errors).toEqual([]);
  } catch (error) {
    scenarioError = error;
    await testInfo.attach('npc-transport', {
      body: Buffer.from(
        JSON.stringify({
          sent,
          replies,
          loss,
          errors,
          hostErrors: host.errors,
          playerFrames: player?.frames,
          playerErrors: player?.errors,
        }),
      ),
      contentType: 'application/json',
    });
    throw error;
  } finally {
    await disposeNetworkResources(
      [
        async () => {
          await player?.close();
        },
        () => host.close(),
      ],
      scenarioError,
    );
  }
});
