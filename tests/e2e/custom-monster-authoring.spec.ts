import { expect, test } from '@playwright/test';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import {
  createNetworkBrowserProcess,
  disposeNetworkResources,
} from '../fixtures/network-application-e2e.js';
import { enterNpcLibrary, npcAction, npcForm } from '../fixtures/npc-authoring-e2e.js';
import { createNpcPlayerPrivacyProbe } from '../fixtures/npc-privacy-e2e.js';

test.use({ channel: 'chrome' });
test('GM saves a manual CUSTOM_MONSTER NONE V1, replays a lost receipt, restores its full sheet after process restart and keeps it private from PLAYER', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const host = await createNetworkBrowserProcess(0),
    errors: string[] = [],
    frames: JsonObject[] = [],
    commands: JsonObject[] = [];
  let scenarioError: unknown,
    player: Awaited<ReturnType<typeof createNpcPlayerPrivacyProbe>> | undefined;
  const transport: {
    cutCommit: boolean;
    cut: boolean;
    originalCommit: JsonObject | null;
    lostReceipt: JsonObject | null;
    probe: boolean;
    replies: JsonObject[];
    send?: (message: JsonObject) => void;
  } = {
    cutCommit: false,
    cut: false,
    originalCommit: null,
    lostReceipt: null,
    probe: false,
    replies: [],
  };
  try {
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
          commands.push(value);
          if (value['workflowCommandId'] === 'UI-CMD-ENEMY-COMMIT-V1')
            transport.originalCommit ??= value;
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
          receipt?.['commandId'] === transport.originalCommit?.['commandId']
        ) {
          transport.lostReceipt = receipt ?? null;
          transport.cutCommit = false;
          transport.cut = true;
          dropped = true;
          void Promise.all([
            route.close({ code: 1012, reason: 'lost custom monster V1 receipt' }),
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
          frames.push(JSON.parse(String(frame.payload)) as JsonObject);
        } catch {
          /* Non-JSON frames are rejected by the production decoder. */
        }
      }),
    );
    const latest = () => {
      const frame = frames.findLast((value) => value['messageType'] === 'projection.snapshot');
      return ((frame?.['presentation'] as JsonObject)?.['base'] as JsonObject)?.[
        'roleFilteredPayload'
      ] as JsonObject;
    };
    await enterNpcLibrary(page, host.baseURL, 'ENEMY');
    const before = host.inspect();
    await page.getByRole('tab', { name: 'Монстры', exact: true }).click();
    await expect(page.locator('[data-enemy-template]')).toHaveCount(17);
    await npcAction(page, 'ENM-001::CTA::011', 'ENM-011');
    await page.getByLabel('Имя монстра', { exact: true }).fill('  Каменный страж без симбионта  ');
    await page
      .getByLabel('Описание монстра', { exact: true })
      .fill('Ручной полный лист без бросков');
    await npcAction(page, 'ENM-011::CTA::002', 'ENM-012');
    for (const stat of ['S', 'D', 'M', 'Z', 'I', 'W', 'C'])
      await page.getByLabel(`Базовая ${stat}`, { exact: true }).fill(stat === 'S' ? '35' : '20');
    await page.getByLabel('Масса монстра, кг', { exact: true }).fill('10000');
    await page.getByLabel('Возраст монстра, лет', { exact: true }).fill('700');
    await page.getByLabel('Базовый максимум HP', { exact: true }).fill('7');
    await expect(
      page.getByRole('button', { name: 'Однократная генерация недоступна', exact: true }),
    ).toBeDisabled();
    await npcAction(page, 'ENM-012::CTA::004', 'ENM-013');
    const armor = page.getByRole('combobox', { name: 'Естественная броня: формула', exact: true });
    await expect(armor.locator('option')).toHaveCount(11);
    await armor.selectOption('CONSTANT');
    await page.getByLabel('Естественная броня: значение', { exact: true }).fill('2.5');
    await page.getByLabel('Размер — описание', { exact: true }).fill('Высокий');
    await page.getByLabel('Передвижение — описание', { exact: true }).fill('Шагает');
    await page.getByLabel('Физические теги', { exact: true }).fill('камень\nстраж');
    await npcAction(page, 'ENM-013::CTA::003', 'ENM-014');
    await page
      .getByRole('combobox', { name: 'Дополнительный урон: формула', exact: true })
      .selectOption('R20*2+X');
    await page.getByLabel('Дополнительный урон: значение', { exact: true }).fill('3');
    await page
      .getByRole('combobox', { name: 'Пробитие: формула', exact: true })
      .selectOption('R4+X');
    await page.getByLabel('Пробитие: значение', { exact: true }).fill('2');
    await npcAction(page, 'ENM-014::CTA::002', 'ENM-015');
    await page.getByRole('radio', { name: 'Без симбионта', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Без симбионта', exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Проверить выбранный состав', exact: true }).click();
    await expect(
      page.getByLabel('Подтверждаю выбранный состав и обязательные последствия', { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel('Подтверждаю выбранный состав и обязательные последствия', { exact: true })
      .check();
    await page.getByRole('button', { name: 'Подтвердить состав у хоста', exact: true }).click();
    await page.getByLabel('Подтверждаю итоговый состав без симбионта', { exact: true }).check();
    await npcAction(page, 'ENM-015::CTA::003', 'ENM-016');
    const sheet = page.getByRole('region', {
      name: 'Полный лист произвольного монстра',
      exact: true,
    });
    await expect(sheet).toContainText('Каменный страж без симбионта');
    await expect(sheet).toContainText('7/7 HP (базовый максимум 7)');
    await expect(sheet).toContainText('R20*2+3');
    await expect(sheet).toContainText('R4+2');
    await expect(sheet).toContainText('только торс');
    await expect(sheet).toContainText('Симбионта нет.');
    await expect(page.getByRole('combobox', { name: 'Раса', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('combobox', { name: 'Предмет из каталога', exact: true }),
    ).toHaveCount(0);
    expect(host.inspectEnemy()).toEqual({ templates: [], versions: [], history: [], pointers: [] });
    const draft = latest(),
      context = draft['context'] as JsonObject,
      attempt = context['attemptOrNull'] as JsonObject;
    expect(attempt).toMatchObject({
      kind: 'CUSTOM_MONSTER',
      identityOrNull: { name: 'Каменный страж без симбионта' },
    });
    const patch = commands.find(
      (command) => (command['payload'] as JsonObject)['stage'] === 'MONSTER_STATS',
    );
    if (patch === undefined) throw Error('Actual manual monster PATCH absent');
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
        creationAttemptId: attempt['attemptId']!,
        expectedAttemptRevision: attempt['revision']!,
      },
    };
    player = await createNpcPlayerPrivacyProbe(browser, host.baseURL);
    await player.refuseEnemyAuthoringAccess([
      patch,
      commit,
      {
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId: 'replaced-by-probe',
        sourceFormId: 'ENM-001',
        actionKey: 'ENM-001::CTA::011',
        expectedProjectionRevision: draft['projectionRevision']!,
      },
    ]);
    await player.assertHidden([
      'Каменный страж без симбионта',
      attempt['attemptId'] as string,
      'symbiosis_placeholder_monster',
      'CUSTOM_MONSTER_AUTHORING',
      'naturalArmorDefinition',
      'advisorCards',
    ]);
    expect(host.inspectEnemy()).toEqual({ templates: [], versions: [], history: [], pointers: [] });
    transport.cutCommit = true;
    await page.locator('[data-atlas-action-key="ENM-016::CTA::002"]').click();
    await expect.poll(() => transport.cut).toBe(true);
    await expect(npcForm(page, 'ENM-016')).toBeVisible();
    expect(host.inspectEnemy().versions).toHaveLength(1);
    await page.getByRole('button', { name: 'Переподключиться', exact: true }).click();
    await expect(npcForm(page, 'ENM-020')).toBeVisible({ timeout: 20_000 });
    expect(
      frames.findLast((frame) => frame['messageType'] === 'command.replay')?.['receipt'],
    ).toEqual(transport.lostReceipt);
    const saved = host.inspectEnemy();
    expect(saved.templates).toHaveLength(1);
    expect(saved.versions).toHaveLength(1);
    expect(saved.history).toHaveLength(1);
    expect(saved.pointers).toHaveLength(1);
    const version = JSON.parse(saved.versions[0]!['record_json'] as string) as JsonObject;
    expect(version['sheet']).toEqual(draft['sheetOrNull']);
    const image = page.getByRole('img', { name: 'Заглушка произвольного монстра', exact: true }),
      imageSource = await image.getAttribute('src');
    await expect
      .poll(() =>
        image.evaluate(
          (img: { complete: boolean; naturalWidth: number }) =>
            img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await npcAction(page, 'ENM-020::CTA::002', 'ENM-001');
    const user = page.getByRole('radio', { name: /Каменный страж без симбионта · V1/ });
    await expect(user).toBeChecked();
    await page.getByRole('tab', { name: 'Мыслящие враги', exact: true }).click();
    await expect(user).toHaveCount(0);
    await expect(page.locator('[data-enemy-template]')).toHaveCount(44);
    await page.getByRole('tab', { name: 'Монстры', exact: true }).click();
    await expect(page.locator('[data-enemy-template]')).toHaveCount(17);
    await user.click();
    await expect(user).toBeChecked();
    await npcAction(page, 'ENM-001::CTA::007', 'ENM-020');
    await host.restart();
    await page.reload();
    await expect(npcForm(page, 'ENM-020')).toBeVisible({ timeout: 30_000 });
    await expect(image).toHaveAttribute('src', imageSource!);
    await expect(sheet).toContainText('7/7 HP (базовый максимум 7)');
    await expect(sheet).toContainText('R20*2+3');
    expect(latest()['sheetOrNull']).toEqual(draft['sheetOrNull']);
    expect(host.inspectEnemy()).toEqual(saved);
    await player.refreshPlayer();
    await player.assertHidden([
      'Каменный страж без симбионта',
      attempt['attemptId'] as string,
      (version['identity'] as JsonObject)['templateId'] as string,
      (version['identity'] as JsonObject)['versionId'] as string,
      'symbiosis_placeholder_monster',
      'naturalArmorDefinition',
      'advisorCards',
    ]);
    await npcAction(page, 'ENM-020::CTA::002', 'ENM-001');
    await npcAction(page, 'ENM-001::CTA::013', 'GM-001');
    transport.probe = true;
    if (transport.send === undefined || transport.originalCommit === null)
      throw Error('Actual monster COMMIT replay channel absent');
    transport.send(transport.originalCommit);
    await expect
      .poll(() => transport.replies.filter((reply) => reply['messageType'] === 'command.replay'))
      .toHaveLength(1);
    expect(
      transport.replies.find((reply) => reply['messageType'] === 'command.replay')?.['receipt'],
    ).toEqual(transport.lostReceipt);
    await expect
      .poll(() =>
        transport.replies.filter((reply) => reply['messageType'] === 'projection.snapshot'),
      )
      .toHaveLength(1);
    const replayView = transport.replies.find(
      (reply) => reply['messageType'] === 'projection.snapshot',
    )!;
    expect(((replayView['presentation'] as JsonObject)['base'] as JsonObject)['formId']).toBe(
      'GM-001',
    );
    expect(host.inspectEnemy()).toEqual(saved);
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
    await disposeNetworkResources(
      [
        () =>
          testInfo.attach('custom-monster-v1-evidence', {
            body: Buffer.from(
              JSON.stringify(
                {
                  errors,
                  frames,
                  commands,
                  originalCommit: transport.originalCommit,
                  lostReceipt: transport.lostReceipt,
                  probeReplies: transport.replies,
                },
                null,
                2,
              ),
            ),
            contentType: 'application/json',
          }),
        ...(player === undefined ? [] : [() => player!.close()]),
        () => host.close(),
      ],
      scenarioError,
    );
  }
});
