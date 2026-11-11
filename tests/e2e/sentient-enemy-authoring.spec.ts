import { expect, test } from '@playwright/test';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import {
  createNetworkBrowserProcess,
  disposeNetworkResources,
} from '../fixtures/network-application-e2e.js';
import { enterNpcLibrary, npcAction, npcForm } from '../fixtures/npc-authoring-e2e.js';
import { createNpcPlayerPrivacyProbe } from '../fixtures/npc-privacy-e2e.js';

test.use({ channel: 'chrome' });
test('GM creates and reopens a complete sexless SENTIENT V1 with explicit empty symbionts, skills, inventory and pinned placeholder', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const host = await createNetworkBrowserProcess(0),
    errors: string[] = [],
    frames: JsonObject[] = [];
  let scenarioError: unknown,
    player: Awaited<ReturnType<typeof createNpcPlayerPrivacyProbe>> | undefined;
  const sentCommands: JsonObject[] = [];
  const transport: {
    cutCommit: boolean;
    cut: boolean;
    originalCommit: JsonObject | null;
    lostReceipt: JsonObject | null;
    probe: boolean;
    probeReplies: JsonObject[];
    send?: (message: JsonObject) => void;
  } = {
    cutCommit: false,
    cut: false,
    originalCommit: null,
    lostReceipt: null,
    probe: false,
    probeReplies: [],
  };
  await page.routeWebSocket('**/state', (route) => {
    let dropped = false;
    const server = route.connectToServer();
    transport.send = (message) => server.send(JSON.stringify(message));
    route.onMessage((message) => {
      const value = JSON.parse(String(message)) as JsonObject;
      if (
        value['messageType'] === 'command.request' &&
        ['UI-CMD-ENEMY-DRAFT-PATCH', 'UI-CMD-ENEMY-COMMIT-V1'].includes(
          value['workflowCommandId'] as string,
        )
      ) {
        sentCommands.push(value);
        if (
          value['workflowCommandId'] === 'UI-CMD-ENEMY-COMMIT-V1' &&
          transport.originalCommit === null
        )
          transport.originalCommit = value;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (dropped) return;
      const value = JSON.parse(String(message)) as JsonObject,
        receipt = value['receipt'] as JsonObject | undefined;
      if (
        transport.cutCommit &&
        value['messageType'] === 'command.result' &&
        receipt !== undefined &&
        receipt['commandId'] === transport.originalCommit?.['commandId']
      ) {
        transport.lostReceipt = receipt;
        transport.cutCommit = false;
        transport.cut = true;
        dropped = true;
        void Promise.all([
          route.close({ code: 1012, reason: 'lost enemy V1 receipt' }),
          server.close(),
        ]).catch((error) => errors.push(String(error)));
        return;
      }
      const correlated =
        receipt?.['commandId'] === transport.originalCommit?.['commandId'] ||
        (value['messageType'] === 'projection.snapshot' &&
          ((value['presentation'] as JsonObject)['assignment'] as JsonObject)['correlationId'] ===
            transport.originalCommit?.['commandId']);
      if (transport.probe && correlated) {
        transport.probeReplies.push(value);
        return;
      }
      route.send(message);
    });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) =>
    socket.on('framereceived', (frame) => {
      try {
        frames.push(JSON.parse(String(frame.payload)) as JsonObject);
      } catch {
        /* Production codec also rejects non-JSON. */
      }
    }),
  );
  const latest = () => {
    const frame = frames.findLast((frame) => frame['messageType'] === 'projection.snapshot');
    return ((frame?.['presentation'] as JsonObject)?.['base'] as JsonObject)?.[
      'roleFilteredPayload'
    ] as JsonObject;
  };
  try {
    await enterNpcLibrary(page, host.baseURL, 'ENEMY');
    const before = host.inspect();
    await npcAction(page, 'ENM-001::CTA::003', 'ENM-005');
    await page.getByLabel('Имя врага', { exact: true }).fill('  Дозорный без симбионтов  ');
    await page.getByLabel('Описание врага', { exact: true }).fill('Сохранённый полный лист V1');
    await page.getByLabel('Происхождение', { exact: true }).fill('Северная застава');
    await page.getByLabel('Принадлежность', { exact: true }).fill('Городской дозор');
    await page.getByLabel('Масса, кг', { exact: true }).fill('80.1');
    await npcAction(page, 'ENM-005::CTA::003', 'ENM-006');
    for (const stat of ['S', 'D', 'M', 'Z', 'I', 'W', 'C'])
      await page.getByLabel(`Базовая ${stat}`, { exact: true }).fill('20');
    await npcAction(page, 'ENM-006::CTA::002', 'ENM-007');
    await page.getByRole('combobox', { name: 'Раса', exact: true }).selectOption('PURE');
    await page
      .getByRole('combobox', { name: 'Класс Чистого', exact: true })
      .selectOption('SOLDIER');
    await expect(
      page.getByRole('region', { name: 'Подтверждённые хостом правила выбора', exact: true }),
    ).toContainText('Начальные слоты навыков: 10');
    await page.getByLabel('Бонус: Рукопашный бой', { exact: true }).fill('7');
    await npcAction(page, 'ENM-007::CTA::004', 'ENM-008');
    await page.getByLabel('Подтверждаю явно пустой состав симбионтов', { exact: true }).check();
    await npcAction(page, 'ENM-008::CTA::002', 'ENM-009');
    await page
      .getByRole('combobox', { name: 'Предмет из каталога', exact: true })
      .selectOption('ITM-ARM-001');
    await page.getByRole('button', { name: 'Добавить предмет', exact: true }).click();
    const armor = page.getByRole('group', { name: 'Предмет 1: Кожаный доспех', exact: true });
    await armor.getByLabel('Основание выдачи', { exact: true }).fill('Снаряжение дозорного');
    await armor.getByRole('combobox', { name: 'Зона брони', exact: true }).selectOption('HEAD');
    await armor.getByLabel('Экипирован', { exact: true }).check();
    await armor
      .getByRole('group', { name: 'Занятые места', exact: true })
      .getByLabel('Голова', { exact: true })
      .check();
    await page
      .getByRole('combobox', { name: 'Предмет из каталога', exact: true })
      .selectOption('RES-CUR-003');
    await page.getByRole('button', { name: 'Добавить предмет', exact: true }).click();
    const coins = page.getByRole('group', { name: 'Предмет 2: Золотая монета', exact: true });
    await coins.getByLabel('Количество предмета 2', { exact: true }).fill('3');
    await coins.getByLabel('Основание выдачи', { exact: true }).fill('Личные монеты дозорного');
    await page
      .getByRole('combobox', { name: 'Предмет из каталога', exact: true })
      .selectOption('RES-EQP-001');
    await page.getByRole('button', { name: 'Добавить предмет', exact: true }).click();
    const clothing = page.getByRole('group', { name: 'Предмет 3: Одежда', exact: true });
    await clothing.getByRole('button', { name: 'Задать свойства одежды', exact: true }).click();
    await clothing.getByLabel('Покрывает: Торс', { exact: true }).check();
    await clothing.getByLabel('Покрывает: Левая рука', { exact: true }).check();
    await clothing
      .getByRole('combobox', { name: 'Герметичность одежды', exact: true })
      .selectOption('false');
    await clothing
      .getByRole('combobox', { name: 'Горючесть одежды', exact: true })
      .selectOption('COMBUSTIBLE');
    await clothing.getByRole('combobox', { name: 'Качество', exact: true }).selectOption('GOOD');
    await clothing.getByLabel('Экипирован', { exact: true }).check();
    await clothing.getByLabel('Основание выдачи', { exact: true }).fill('Одежда дозорного');
    await npcAction(page, 'ENM-009::CTA::002', 'ENM-010');
    const sheet = page.getByRole('region', { name: 'Полный лист мыслящего врага', exact: true });
    await expect(sheet).toContainText('Рукопашный бой · бонус 7');
    await expect(sheet).toContainText('Кожаный доспех');
    await expect(sheet).toContainText('Золотая монета · количество 3');
    await expect(sheet).toContainText(
      'Одежда покрывает: Торс, Левая рука; герметичность: Нет; горючесть: Горючая.',
    );
    await expect(sheet).toContainText('Качество: Хорошее');
    expect(host.inspectEnemy()).toEqual({ templates: [], versions: [], history: [], pointers: [] });
    const draft = latest();
    await expect(page.locator('[data-host-projection]')).toHaveCount(0);
    expect(
      ((draft['context'] as JsonObject)['attemptOrNull'] as JsonObject)['identityOrNull'],
    ).toMatchObject({ name: 'Дозорный без симбионтов' });
    player = await createNpcPlayerPrivacyProbe(browser, host.baseURL);
    await player.refuseEnemyAccess({
      messageType: 'network.enemy-selection.replace',
      protocolVersion: 3,
      operationId: 'replaced-by-probe',
      contextId: draft['contextId']!,
      campaignId: draft['campaignId']!,
      sourceFormId: 'ENM-001',
      expectedRevisions: {
        stateRevision: draft['stateRevision']!,
        projectionRevision: draft['projectionRevision']!,
        actorVisibilityRevision: draft['actorVisibilityRevision']!,
      },
      activeTab: 'SENTIENT_ENEMIES',
      selectionOrNull: null,
    });
    await player.assertHidden([
      'Дозорный без симбионтов',
      'Северная застава',
      'symbiosis_placeholder_sentient_enemy',
      textAttemptId(draft),
    ]);
    const patch = sentCommands.find(
      (command) => command['workflowCommandId'] === 'UI-CMD-ENEMY-DRAFT-PATCH',
    )!;
    const commit: JsonObject = {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      workflowCommandId: 'UI-CMD-ENEMY-COMMIT-V1',
      commandId: patch['commandId']!,
      expectedRevisions: {
        stateRevision: draft['stateRevision']!,
        projectionRevision: draft['projectionRevision']!,
        actorVisibilityRevision: draft['actorVisibilityRevision']!,
      },
      payload: {
        campaignId: draft['campaignId']!,
        creationAttemptId: textAttemptId(draft),
        expectedAttemptRevision: ((draft['context'] as JsonObject)['attemptOrNull'] as JsonObject)[
          'revision'
        ]!,
      },
    };
    await player.refuseEnemyAuthoringAccess([patch, commit]);
    expect(host.inspectEnemy()).toEqual({ templates: [], versions: [], history: [], pointers: [] });
    transport.cutCommit = true;
    await page.locator('[data-atlas-action-key="ENM-010::CTA::004"]').click();
    await expect.poll(() => transport.cut).toBe(true);
    await expect(npcForm(page, 'ENM-010')).toBeVisible();
    expect(host.inspectEnemy().versions).toHaveLength(1);
    await page.getByRole('button', { name: 'Переподключиться', exact: true }).click();
    await expect(npcForm(page, 'ENM-020')).toBeVisible({ timeout: 20_000 });
    const replay = frames.findLast(
      (frame) =>
        frame['messageType'] === 'command.replay' &&
        (frame['receipt'] as JsonObject)['commandId'] === transport.originalCommit?.['commandId'],
    );
    expect(replay?.['receipt']).toEqual(transport.lostReceipt);
    const saved = host.inspectEnemy();
    expect(saved.templates).toHaveLength(1);
    expect(saved.versions).toHaveLength(1);
    expect(saved.history).toHaveLength(1);
    expect(saved.pointers).toHaveLength(1);
    const version = JSON.parse(saved.versions[0]!['record_json'] as string) as JsonObject;
    const image = page.getByRole('img', { name: 'Заглушка мыслящего врага', exact: true });
    const imageSource = await image.getAttribute('src');
    await expect
      .poll(() =>
        image.evaluate(
          (img: { complete: boolean; naturalWidth: number }) =>
            img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(sheet).toContainText('Обычная анатомия мыслящего');
    await npcAction(page, 'ENM-020::CTA::002', 'ENM-001');
    const user = page.getByRole('radio', { name: /Дозорный без симбионтов · V1/ });
    await expect(user).toBeChecked();
    await page.getByRole('tab', { name: 'Монстры', exact: true }).click();
    await expect(user).toHaveCount(0);
    await expect(page.locator('[data-enemy-template]')).toHaveCount(17);
    await page.getByRole('tab', { name: 'Мыслящие враги', exact: true }).click();
    await expect(page.locator('[data-enemy-template]')).toHaveCount(44);
    await expect(user).not.toBeChecked();
    await user.click();
    await expect(user).toBeChecked();
    await npcAction(page, 'ENM-001::CTA::007', 'ENM-020');
    await page.reload();
    await expect(npcForm(page, 'ENM-020')).toBeVisible({ timeout: 20_000 });
    await expect(sheet).toContainText('Кожаный доспех');
    await host.restart();
    await page.reload();
    await expect(npcForm(page, 'ENM-020')).toBeVisible({ timeout: 30_000 });
    await expect(image).toHaveAttribute('src', imageSource!);
    await expect(sheet).toContainText('Рукопашный бой · бонус 7');
    await expect(sheet).toContainText('Золотая монета · количество 3');
    expect(host.inspectEnemy()).toEqual(saved);
    await player.refreshPlayer();
    await player.assertHidden([
      'Дозорный без симбионтов',
      (version['identity'] as JsonObject)['templateId'] as string,
      (version['identity'] as JsonObject)['versionId'] as string,
      'symbiosis_placeholder_sentient_enemy',
    ]);
    await npcAction(page, 'ENM-020::CTA::002', 'ENM-001');
    await npcAction(page, 'ENM-001::CTA::013', 'GM-001');
    transport.probe = true;
    if (transport.send === undefined || transport.originalCommit === null)
      throw Error('Actual COMMIT replay channel absent');
    transport.send(transport.originalCommit);
    await expect
      .poll(() =>
        transport.probeReplies.filter((reply) => reply['messageType'] === 'command.replay'),
      )
      .toHaveLength(1);
    expect(
      transport.probeReplies.find((reply) => reply['messageType'] === 'command.replay')?.[
        'receipt'
      ],
    ).toEqual(transport.lostReceipt);
    await expect
      .poll(() =>
        transport.probeReplies.filter((reply) => reply['messageType'] === 'projection.snapshot'),
      )
      .toHaveLength(1);
    const replayView = transport.probeReplies.find(
      (reply) => reply['messageType'] === 'projection.snapshot',
    )!;
    expect(((replayView['presentation'] as JsonObject)['base'] as JsonObject)['formId']).toBe(
      'GM-001',
    );
    expect(host.inspectEnemy()).toEqual(saved);
    await expect(npcForm(page, 'GM-001')).toBeVisible();
    const after = host.inspect();
    expect(after.campaigns).toEqual(before.campaigns);
    expect(after.checkpoints).toEqual(before.checkpoints);
    expect(after.copies).toEqual([]);
    expect(host.inspectNpc().versions).toEqual([]);
    expect(host.inspectNpc().operations).toEqual([]);
    expect(errors).toEqual([]);
  } catch (error) {
    scenarioError = error;
  } finally {
    await testInfo.attach('sentient-v1-evidence', {
      body: Buffer.from(
        JSON.stringify(
          {
            errors,
            frames,
            sentCommands,
            originalCommit: transport.originalCommit,
            lostReceipt: transport.lostReceipt,
            probeReplies: transport.probeReplies,
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });
    await disposeNetworkResources(
      [...(player === undefined ? [] : [() => player!.close()]), () => host.close()],
      scenarioError,
    );
  }
});
function textAttemptId(projection: JsonObject): string {
  return ((projection['context'] as JsonObject)['attemptOrNull'] as JsonObject)[
    'attemptId'
  ] as string;
}
