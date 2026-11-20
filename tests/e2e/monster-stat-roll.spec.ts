import { expect, test } from '@playwright/test';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import { wireCodecPrimitives as w } from '../../src/shared/wire-codec.js';
import { enemyAuthoringProjectionValue } from '../../src/shared/enemy-authoring.js';
import {
  MONSTER_STAT_ROLL_ORDER,
  monsterStatRollReceiptValue,
} from '../../src/shared/monster-stat-roll.js';
import {
  campaignLifecycleGmAnchorValue,
  isCampaignLifecycleWorkflow,
} from '../../src/shared/campaign-lifecycle.js';
import {
  createNetworkBrowserProcess,
  disposeNetworkResources,
} from '../fixtures/network-application-e2e.js';
import { enterNpcLibrary, npcAction, npcForm } from '../fixtures/npc-authoring-e2e.js';
import { createNpcPlayerPrivacyProbe } from '../fixtures/npc-privacy-e2e.js';

test.use({ channel: 'chrome' });
const object = (value: unknown): JsonObject =>
  structuredClone(w.jsonObject(value, '$.actualBrowserValue'));
const text = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('Actual source text absent');
  return value;
};
const rows = (value: unknown) => {
  if (!Array.isArray(value)) throw new Error('Actual source rows absent');
  return value.map(object);
};

test('GM rolls exactly once in both CUSTOM_MONSTER origins, edits and saves V1 and N+1 through019, recovers lost ACKs and physical restarts, and keeps receipts private from PLAYER', async ({
  page,
  browser,
}, testInfo) => {
  // Finite analogy, not this scenario's measurement: delivered259 full Chrome S/C N+1 cases
  // took78.880/100.907s (local-n1-proof259-r2.json, source e67e4399). One setup, two full flows.
  test.setTimeout(360_000);
  const started = performance.now();
  const host = await createNetworkBrowserProcess(0);
  const frames: JsonObject[] = [],
    commands: JsonObject[] = [],
    clientFrames: JsonObject[] = [],
    errors: string[] = [];
  const phases: Record<string, number> = { hostSetupMs: performance.now() - started };
  let previous = performance.now();
  const mark = (phase: string) => {
    const now = performance.now();
    phases[phase] = now - previous;
    previous = now;
  };
  const lost: {
    readonly origin: 'ENM-012' | 'ENM-017';
    request: JsonObject | null;
    receipt: JsonObject | null;
    cut: boolean;
  }[] = [
    { origin: 'ENM-012', request: null, receipt: null, cut: false },
    { origin: 'ENM-017', request: null, receipt: null, cut: false },
  ];
  const transport: {
    cutIndex: number | null;
    probe: boolean;
    replies: JsonObject[];
    send?: (message: JsonObject) => void;
  } = { cutIndex: null, probe: false, replies: [] };
  let failure: unknown, player: Awaited<ReturnType<typeof createNpcPlayerPrivacyProbe>> | undefined;
  try {
    await page.routeWebSocket('**/state', (route) => {
      const server = route.connectToServer();
      let dropped = false;
      transport.send = (message) => server.send(JSON.stringify(message));
      route.onMessage((message) => {
        const value = object(JSON.parse(String(message)));
        clientFrames.push(value);
        if (value['messageType'] === 'command.request') {
          commands.push(value);
          if (
            value['workflowCommandId'] === 'UI-CMD-MONSTER-STATS-ROLL-ONCE' &&
            transport.cutIndex !== null
          ) {
            const flow = lost[transport.cutIndex];
            if (flow === undefined || flow.request !== null)
              throw new Error('Unexpected duplicate ordinary roll intent');
            flow.request = value;
          }
        }
        server.send(message);
      });
      server.onMessage((message) => {
        if (dropped) return;
        const value = object(JSON.parse(String(message)));
        const receipt = value['receipt'] === undefined ? null : object(value['receipt']);
        if (transport.cutIndex !== null) {
          const flow = lost[transport.cutIndex];
          if (
            flow !== undefined &&
            value['messageType'] === 'command.result' &&
            flow.request !== null &&
            receipt?.['commandId'] === flow.request['commandId']
          ) {
            flow.receipt = receipt;
            flow.cut = true;
            transport.cutIndex = null;
            dropped = true;
            void Promise.all([
              route.close({ code: 1012, reason: 'lost original monster stat receipt' }),
              server.close(),
            ]).catch((error) => errors.push(String(error)));
            return;
          }
        }
        const ids = lost.flatMap((flow) =>
          flow.request === null ? [] : [flow.request['commandId']],
        );
        const correlation =
          value['messageType'] === 'projection.snapshot'
            ? object(object(value['presentation'])['assignment'])['correlationId']
            : receipt?.['commandId'];
        if (transport.probe && ids.includes(correlation)) {
          transport.replies.push(value);
          return;
        }
        route.send(message);
      });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('websocket', (socket) =>
      socket.on('framereceived', (frame) => {
        try {
          frames.push(object(JSON.parse(String(frame.payload))));
        } catch {
          /* Production rejects non-JSON frames. */
        }
      }),
    );
    const current = () => {
      const frame = frames.findLast((value) => value['messageType'] === 'projection.snapshot');
      if (frame === undefined) throw new Error('Actual GM projection absent');
      expect(frame['projectionRole']).toBe('gm');
      const presentation = object(frame['presentation']),
        raw = object(object(presentation['base'])['roleFilteredPayload']);
      for (const layer of rows(presentation['layers']))
        expect(object(layer['roleFilteredPayload'])).not.toHaveProperty('currentCampaignLifecycle');
      const { currentCampaignLifecycle: marker, ...body } = raw;
      const anchor = campaignLifecycleGmAnchorValue(marker),
        revisions = object(frame['revisions']);
      expect(anchor.contextId).toBe(body['contextId']);
      expect(anchor.campaignId).toBe(body['campaignId']);
      expect(anchor.campaignStatus).toBe(body['campaignStatus']);
      for (const key of [
        'stateRevision',
        'projectionRevision',
        'actorVisibilityRevision',
      ] as const) {
        expect(anchor[key]).toBe(revisions[key]);
        expect(body[key]).toBe(revisions[key]);
      }
      const capabilities = frames.findLast(
        (value) => value['messageType'] === 'session.reconnect.capabilities',
      );
      const ids = capabilities?.['executableWorkflowCommandIds'];
      if (
        !Array.isArray(ids) ||
        !ids.includes('UI-CMD-MONSTER-STATS-ROLL-ONCE') ||
        !ids.some((value) => typeof value === 'string' && isCampaignLifecycleWorkflow(value))
      )
        throw new Error('Actual roll/lifecycle capability negotiation absent');
      const p = enemyAuthoringProjectionValue(body);
      if (p.kind !== 'CUSTOM_MONSTER_AUTHORING')
        throw new Error('Actual CUSTOM_MONSTER projection absent');
      return p;
    };
    const action = (key: string, destination: string) => npcAction(page, key, destination, 30_000);
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    const publish = async (name: string) => {
      const revision = current().context.attemptOrNull?.revision;
      if (revision === undefined) throw new Error('Actual current attempt absent');
      await button(name).click();
      await expect
        .poll(() => current().context.attemptOrNull?.revision, { timeout: 30_000 })
        .toBeGreaterThan(revision);
    };
    await enterNpcLibrary(page, host.baseURL, 'ENEMY');
    const before = host.inspect();
    await page.getByRole('tab', { name: 'Монстры', exact: true }).click();
    await action('ENM-001::CTA::011', 'ENM-011');
    const name = 'Дважды проверенный каменный монстр';
    await page.getByLabel('Имя монстра', { exact: true }).fill(name);
    await action('ENM-011::CTA::002', 'ENM-012');
    for (const key of MONSTER_STAT_ROLL_ORDER)
      await expect(page.getByLabel('Базовая ' + key, { exact: true })).toHaveValue('');
    expect(current().context.attemptOrNull?.statsOrNull).toBeNull();
    await action('ENM-012::CTA::005', 'ENM-018');
    const creationSeed = current().statGeneration?.generationSeed;
    expect(creationSeed).toMatch(/^[a-f0-9]{64}$/);
    await action('ENM-018::CTA::003', 'ENM-012');
    expect(
      commands.filter(
        (command) => command['workflowCommandId'] === 'UI-CMD-MONSTER-STATS-ROLL-ONCE',
      ),
    ).toHaveLength(0);
    for (const key of MONSTER_STAT_ROLL_ORDER)
      await expect(page.getByLabel('Базовая ' + key, { exact: true })).toHaveValue('');
    await action('ENM-012::CTA::005', 'ENM-018');
    expect(current().statGeneration?.generationSeed).toBe(creationSeed);
    mark('freshCreationAndUnrolledReturnMs');
    const receipts: ReturnType<typeof monsterStatRollReceiptValue>[] = [];
    let v1Rows: ReturnType<typeof host.inspectEnemy> | undefined;
    for (const [index, flow] of lost.entries()) {
      if (index === 1) {
        const beforeVersion = current();
        expect(beforeVersion.formId).toBe('ENM-017');
        expect(beforeVersion.context.monsterStatRoll).toBeUndefined();
        expect(beforeVersion.statGeneration?.rollOnceStatus).toBe('NOT_ROLLED');
        expect(beforeVersion.statGeneration?.generationSeed).toBeNull();
        expect(beforeVersion.statGeneration?.randomReceiptOrNull).toBeNull();
        await page
          .getByLabel('Причина новой версии', { exact: true })
          .fill('Новая квитанция и подтверждённые возраст, масса и здоровье');
        await publish('Сохранить причину');
        await action('ENM-017::CTA::006', 'ENM-018');
        expect(current().statGeneration?.generationSeed).toMatch(/^[a-f0-9]{64}$/);
        expect(current().statGeneration?.generationSeed).not.toBe(creationSeed);
      }
      const open = current();
      expect(open.statGeneration?.rollOnceStatus).toBe('NOT_ROLLED');
      expect(open.statGeneration?.randomReceiptOrNull).toBeNull();
      expect(open.statGeneration?.originFormId).toBe(flow.origin);
      await testInfo.attach((index === 0 ? 'CREATE' : 'VERSION') + '-generation', {
        body: await page
          .getByRole('region', { name: 'Однократные характеристики монстра', exact: true })
          .screenshot(),
        contentType: 'image/png',
      });
      transport.cutIndex = index;
      await page
        .locator(
          '[data-atlas-action-key="' +
            (index === 0 ? 'ENM-018::CTA::002' : 'ENM-018::CTA::005') +
            '"]',
        )
        .click();
      await expect.poll(() => flow.cut, { timeout: 30_000 }).toBe(true);
      await expect(npcForm(page, 'ENM-018')).toBeVisible();
      if (flow.request === null || flow.receipt === null)
        throw new Error('Original committed roll ACK absent');
      const original = monsterStatRollReceiptValue(
        object(flow.receipt['result'])['randomStatsReceipt'],
      );
      receipts.push(original);
      expect(original.randomReceiptId).toBe(flow.receipt['receiptId']);
      expect(original.operationId).toBe(flow.request['commandId']);
      expect(original.binding.originFormId).toBe(flow.origin);
      expect(original.dieFaces).toHaveLength(7);
      expect(host.inspectEnemy().versions).toHaveLength(index);
      await button('Переподключиться').click();
      await expect(npcForm(page, flow.origin)).toBeVisible({ timeout: 30_000 });
      const replays = frames.filter(
        (frame) =>
          frame['messageType'] === 'command.replay' &&
          object(frame['receipt'])['commandId'] === original.operationId,
      );
      expect(replays).toHaveLength(1);
      expect(replays[0]?.['receipt']).toEqual(flow.receipt);
      expect(
        clientFrames.some(
          (frame) =>
            frame['messageType'] === 'campaign.local-context.resume' &&
            Array.isArray(frame['unacknowledgedCommandIds']) &&
            frame['unacknowledgedCommandIds'].includes(original.operationId),
        ),
      ).toBe(true);
      expect(current().statGeneration?.randomReceiptOrNull).toEqual(original);
      if (index === 1) await button('Ручные характеристики').click();
      for (const key of MONSTER_STAT_ROLL_ORDER)
        await expect(page.getByLabel('Базовая ' + key, { exact: true })).toHaveValue(
          String(original.originalGeneratedStats[key]),
        );
      if (index === 0)
        for (const label of ['Масса монстра, кг', 'Возраст монстра, лет', 'Базовый максимум HP'])
          await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
      const rollCount = commands.length;
      await page.getByLabel('Базовая S', { exact: true }).fill('36');
      await page
        .locator(
          '[data-atlas-action-key="' +
            (index === 0 ? 'ENM-012::CTA::002' : 'ENM-017::CTA::007') +
            '"]',
        )
        .click();
      expect(commands).toHaveLength(rollCount);
      await expect(page.getByLabel('Базовая S', { exact: true })).toHaveValue('36');
      await expect(
        page.getByRole('status').filter({ hasText: 'Проверьте введённые характеристики' }),
      ).toBeVisible();
      for (const key of MONSTER_STAT_ROLL_ORDER)
        await page.getByLabel('Базовая ' + key, { exact: true }).fill('35');
      await page.getByLabel('Масса монстра, кг', { exact: true }).fill(index === 0 ? '5.1' : '6.1');
      await page
        .getByLabel('Возраст монстра, лет', { exact: true })
        .fill(index === 0 ? '17' : '18');
      await page.getByLabel('Базовый максимум HP', { exact: true }).fill(index === 0 ? '42' : '43');
      await action(index === 0 ? 'ENM-012::CTA::002' : 'ENM-017::CTA::007', 'ENM-019');
      expect(current().statGeneration?.randomReceiptOrNull).toEqual(original);
      expect(current().statGeneration?.candidateStats.baseStats).toEqual({
        S: 35,
        D: 35,
        M: 35,
        Z: 35,
        I: 35,
        W: 35,
        C: 35,
      });
      await expect(
        page
          .getByRole('region', { name: 'Однократные характеристики монстра', exact: true })
          .getByRole('row'),
      ).toHaveCount(8);
      await expect(
        page
          .getByRole('region', { name: 'Однократные характеристики монстра', exact: true })
          .locator('input'),
      ).toHaveCount(0);
      await testInfo.attach((index === 0 ? 'CREATE' : 'VERSION') + '-receipt', {
        body: await page
          .getByRole('region', { name: 'Однократные характеристики монстра', exact: true })
          .screenshot(),
        contentType: 'image/png',
      });
      await action(index === 0 ? 'ENM-019::CTA::001' : 'ENM-019::CTA::002', flow.origin);
      await host.restart();
      await page.reload();
      await expect(npcForm(page, flow.origin)).toBeVisible({ timeout: 30_000 });
      if (index === 1) await button('Ручные характеристики').click();
      for (const key of MONSTER_STAT_ROLL_ORDER)
        await expect(page.getByLabel('Базовая ' + key, { exact: true })).toHaveValue('35');
      await expect(page.getByLabel('Масса монстра, кг', { exact: true })).toHaveValue(
        index === 0 ? '5.1' : '6.1',
      );
      await expect(page.getByLabel('Возраст монстра, лет', { exact: true })).toHaveValue(
        index === 0 ? '17' : '18',
      );
      await expect(page.getByLabel('Базовый максимум HP', { exact: true })).toHaveValue(
        index === 0 ? '42' : '43',
      );
      expect(current().statGeneration?.randomReceiptOrNull).toEqual(original);
      expect(commands.filter((command) => command['commandId'] === original.operationId)).toEqual([
        flow.request,
      ]);
      if (index === 0) {
        await action('ENM-012::CTA::004', 'ENM-013');
        await page
          .getByRole('combobox', { name: 'Естественная броня: формула', exact: true })
          .selectOption('ZERO');
        await action('ENM-013::CTA::003', 'ENM-014');
        await page
          .getByRole('combobox', { name: 'Дополнительный урон: формула', exact: true })
          .selectOption('ZERO');
        await page
          .getByRole('combobox', { name: 'Пробитие: формула', exact: true })
          .selectOption('ZERO');
        await action('ENM-014::CTA::002', 'ENM-015');
        await page.getByRole('radio', { name: 'Без симбионта', exact: true }).check();
        await button('Проверить выбранный состав').click();
        await page
          .getByLabel('Подтверждаю выбранный состав и обязательные последствия', { exact: true })
          .check();
        await button('Подтвердить состав у хоста').click();
        await page.getByLabel('Подтверждаю итоговый состав без симбионта', { exact: true }).check();
        await action('ENM-015::CTA::003', 'ENM-016');
        await action('ENM-016::CTA::002', 'ENM-020');
        expect(current().statGeneration?.randomReceiptOrNull).toEqual(original);
        v1Rows = host.inspectEnemy();
        expect(v1Rows.versions).toHaveLength(1);
        expect(v1Rows.history).toHaveLength(1);
        await action('ENM-020::CTA::002', 'ENM-001');
        await action('ENM-001::CTA::008', 'ENM-017');
        mark('creationRollCorrectionReceiptRestartSaveV1Ms');
      } else {
        await publish('Применить поле к текущей копии');
        expect(current().statGeneration?.requiresBodyAcceptance).toBe(false);
        // A changed accepted body invalidates composition; reconfirm the real existing NONE path.
        expect(current().context.attemptOrNull?.compositionOrNull).toBeNull();
        expect(current().validationErrors).toEqual([
          'CUSTOM_MONSTER: symbiont stage not confirmed',
        ]);
        await button('Обыкновенный симбионт').click();
        await page.getByRole('radio', { name: 'Без симбионта', exact: true }).check();
        await publish('Проверить выбранный состав');
        await button('Обыкновенный симбионт').click();
        await page
          .getByLabel('Подтверждаю выбранный состав и обязательные последствия', { exact: true })
          .check();
        await publish('Подтвердить состав у хоста');
        await button('Обыкновенный симбионт').click();
        await page.getByLabel('Подтверждаю итоговый состав без симбионта', { exact: true }).check();
        await publish('Применить поле к текущей копии');
        expect(current().validationErrors).toEqual([]);
        expect(current().statGeneration?.randomReceiptOrNull).toEqual(original);
        expect(current().statGeneration?.rollOnceStatus).toBe('COMMITTED');
        await action('ENM-017::CTA::004', 'ENM-020');
        mark('versionRollCorrectionReceiptRestartApplySaveV2Ms');
      }
    }
    expect(receipts[0]?.binding.attemptId).not.toBe(receipts[1]?.binding.attemptId);
    expect(receipts[0]?.randomReceiptId).not.toBe(receipts[1]?.randomReceiptId);
    expect(receipts[0]?.generationSeed).not.toBe(receipts[1]?.generationSeed);
    const saved = host.inspectEnemy();
    expect(saved.versions).toHaveLength(2);
    expect(saved.history).toHaveLength(2);
    expect(saved.pointers).toHaveLength(1);
    if (v1Rows === undefined) throw new Error('Original V1 row witness absent');
    expect(saved.templates).toEqual(v1Rows.templates);
    expect(saved.versions[0]).toEqual(v1Rows.versions[0]);
    expect(saved.history[0]).toEqual(v1Rows.history[0]);
    const v1 = object(JSON.parse(text(saved.versions[0]?.['record_json']))),
      v2 = object(JSON.parse(text(saved.versions[1]?.['record_json'])));
    expect(object(v1['sheet'])['stats']).toMatchObject({
      baseStats: { S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 },
      massKg: 5.1,
      ageYears: 17,
      baseMaxHP: 42,
    });
    expect(object(v2['sheet'])['stats']).toMatchObject({
      baseStats: { S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 },
      massKg: 6.1,
      ageYears: 18,
      baseMaxHP: 43,
    });
    await button('Просмотреть версию 1').click();
    await expect
      .poll(() => current().versionHistory?.selected.version, { timeout: 30_000 })
      .toBe(1);
    expect(current().versionHistory?.current.version).toBe(2);
    expect(current().statGeneration?.randomReceiptOrNull).toEqual(receipts[0]);
    expect(host.inspectEnemy()).toEqual(saved);
    await button('Просмотреть версию 2').click();
    await expect
      .poll(() => current().versionHistory?.selected.version, { timeout: 30_000 })
      .toBe(2);
    await host.restart();
    await page.reload();
    await expect(npcForm(page, 'ENM-020')).toBeVisible({ timeout: 30_000 });
    expect(current().statGeneration?.randomReceiptOrNull).toEqual(receipts[1]);
    expect(current().sheetOrNull).toEqual(v2['sheet']);
    expect(host.inspectEnemy()).toEqual(saved);
    player = await createNpcPlayerPrivacyProbe(browser, host.baseURL);
    const actualRollRequests = lost.map(
      (flow) =>
        flow.request ??
        (() => {
          throw new Error('Original roll intent absent');
        })(),
    );
    expect(
      commands.filter(
        (command) => command['workflowCommandId'] === 'UI-CMD-MONSTER-STATS-ROLL-ONCE',
      ),
    ).toEqual(actualRollRequests);
    const actualDraftRequests = lost.map((flow) => {
      const request = commands.find((command) => {
        if (command['workflowCommandId'] !== 'UI-CMD-ENEMY-DRAFT-PATCH') return false;
        const payload = object(command['payload']);
        return (
          payload['stage'] === 'MONSTER_STAT_DRAFT' &&
          object(payload['data'])['sourceActionKey'] ===
            (flow.origin === 'ENM-012' ? 'ENM-012::CTA::005' : 'ENM-017::CTA::006')
        );
      });
      if (request === undefined) throw new Error('Actual origin-bound draft intent absent');
      return request;
    });
    await player.refuseEnemyAuthoringAccess([...actualRollRequests, ...actualDraftRequests]);
    await player.assertHidden([
      name,
      ...receipts.flatMap((receipt) => [
        receipt.binding.attemptId,
        receipt.randomReceiptId,
        receipt.operationId,
        receipt.generationSeed,
      ]),
      text(object(v1['identity'])['templateId']),
      'UI-CMD-MONSTER-STATS-ROLL-ONCE',
      'CUSTOM_MONSTER_AUTHORING',
      'monsterStatRoll',
      'randomStatsReceipt',
      'eligibleStatRanges',
      'generationSeed',
      'advisorCards',
      'Однократные характеристики монстра',
    ]);
    expect(host.inspectEnemy()).toEqual(saved);
    mark('savedHistoryRestartPlayerWireDomAriaMs');
    await action('ENM-020::CTA::002', 'ENM-001');
    await action('ENM-001::CTA::013', 'GM-001');
    // Replies to these exact raw probes are held: the normal client never applies unsolicited ACKs.
    transport.probe = true;
    if (transport.send === undefined) throw new Error('Actual raw replay channel absent');
    for (const request of actualRollRequests) transport.send(request);
    await expect
      .poll(() => transport.replies.filter((reply) => reply['messageType'] === 'command.replay'), {
        timeout: 30_000,
      })
      .toHaveLength(2);
    await expect
      .poll(
        () => transport.replies.filter((reply) => reply['messageType'] === 'projection.snapshot'),
        { timeout: 30_000 },
      )
      .toHaveLength(2);
    for (const flow of lost) {
      const id = flow.request?.['commandId'];
      const replays = transport.replies.filter(
        (reply) =>
          reply['messageType'] === 'command.replay' && object(reply['receipt'])['commandId'] === id,
      );
      expect(replays).toHaveLength(1);
      expect(replays[0]?.['receipt']).toEqual(flow.receipt);
      const views = transport.replies.filter(
        (reply) =>
          reply['messageType'] === 'projection.snapshot' &&
          object(object(reply['presentation'])['assignment'])['correlationId'] === id,
      );
      expect(views).toHaveLength(1);
      expect(object(object(views[0]?.['presentation'])['base'])['formId']).toBe('GM-001');
    }
    await expect(npcForm(page, 'GM-001')).toBeVisible();
    const after = host.inspect();
    expect(host.inspectEnemy()).toEqual(saved);
    expect(after.campaigns).toEqual(before.campaigns);
    expect(after.checkpoints).toEqual(before.checkpoints);
    expect(after.copies).toEqual([]);
    expect(host.inspectNpc().versions).toEqual([]);
    expect(host.inspectNpc().operations).toEqual([]);
    expect(errors).toEqual([]);
    expect(host.errors).toEqual([]);
    mark('originalRollRawReplayCompletionMs');
  } catch (error) {
    failure = error;
  } finally {
    await disposeNetworkResources(
      [
        ...(player === undefined ? [] : [() => player!.close()]),
        async () => {
          const cleanupStarted = performance.now();
          try {
            await host.close();
          } finally {
            phases['cleanupMs'] = performance.now() - cleanupStarted;
          }
        },
        () =>
          testInfo.attach('monster-stat-roll-evidence', {
            body: Buffer.from(
              JSON.stringify(
                {
                  phases,
                  totalMs: performance.now() - started,
                  errors,
                  hostErrors: host.errors,
                  frames,
                  clientFrames,
                  commands,
                  lost,
                  heldRawProbes: transport.replies,
                  playerFrames: player?.frames ?? [],
                  playerErrors: player?.errors ?? [],
                },
                null,
                2,
              ),
            ),
            contentType: 'application/json',
          }),
      ],
      failure,
    );
  }
});
