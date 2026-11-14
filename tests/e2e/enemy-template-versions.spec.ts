import { expect, test, type Page } from '@playwright/test';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import { wireCodecPrimitives as w } from '../../src/shared/wire-codec.js';
import {
  campaignLifecycleGmAnchorValue,
  isCampaignLifecycleWorkflow,
} from '../../src/shared/campaign-lifecycle.js';
import { enemyAuthoringProjectionValue } from '../../src/shared/enemy-authoring.js';
import {
  createNetworkBrowserProcess,
  disposeNetworkResources,
} from '../fixtures/network-application-e2e.js';
import { enterNpcLibrary, npcAction, npcForm } from '../fixtures/npc-authoring-e2e.js';
import { createNpcPlayerPrivacyProbe } from '../fixtures/npc-privacy-e2e.js';

test.use({ channel: 'chrome' });
const object = (value: unknown): JsonObject =>
  structuredClone(w.jsonObject(value, '$.actualBrowserValue'));
const text = (value: unknown): string => {
  if (typeof value !== 'string') throw Error('Missing actual source text');
  return value;
};
const rows = (value: unknown): JsonObject[] => {
  if (!Array.isArray(value)) throw Error('Missing actual source rows');
  return value.map(object);
};
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

for (const kind of ['SENTIENT', 'CUSTOM_MONSTER'] as const) {
  test(`GM explicitly replaces the full ${kind} N+1 configuration through real controls and preserves history, lost ACK, restart and PLAYER privacy`, async ({
    page,
    browser,
  }, testInfo) => {
    // Two complete versions, explicit configuration/body confirmations and a physical restart.
    test.setTimeout(360_000);
    const host = await createNetworkBrowserProcess(0);
    const frames: JsonObject[] = [],
      commands: JsonObject[] = [],
      errors: string[] = [];
    const transport: {
      cutNext: boolean;
      cut: boolean;
      probe: boolean;
      lostRequest: JsonObject | null;
      lostReceipt: JsonObject | null;
      send?: (value: JsonObject) => void;
      replies: JsonObject[];
    } = {
      cutNext: false,
      cut: false,
      probe: false,
      lostRequest: null,
      lostReceipt: null,
      replies: [],
    };
    let failure: unknown,
      player: Awaited<ReturnType<typeof createNpcPlayerPrivacyProbe>> | undefined;
    const name = kind === 'SENTIENT' ? 'Хранитель версий заставы' : 'Советующий каменный страж';
    const reason =
      kind === 'SENTIENT'
        ? 'Смена начального обучения дозорного'
        : 'Новый текущий выбор собственной карты стража';
    try {
      await page.routeWebSocket('**/state', (route) => {
        const server = route.connectToServer();
        let dropped = false;
        transport.send = (value) => server.send(JSON.stringify(value));
        route.onMessage((message) => {
          const value = object(JSON.parse(String(message)));
          if (value['messageType'] === 'command.request') {
            commands.push(value);
            if (transport.cutNext && value['workflowCommandId'] === 'UI-CMD-ENEMY-NEW-VERSION')
              transport.lostRequest = value;
          }
          server.send(message);
        });
        server.onMessage((message) => {
          if (dropped) return;
          const value = object(JSON.parse(String(message)));
          const receipt = value['receipt'] === undefined ? null : object(value['receipt']);
          if (
            transport.cutNext &&
            value['messageType'] === 'command.result' &&
            receipt?.['commandId'] === transport.lostRequest?.['commandId']
          ) {
            transport.lostReceipt = receipt;
            transport.cutNext = false;
            transport.cut = true;
            dropped = true;
            void Promise.all([
              route.close({ code: 1012, reason: 'lost N+1 acknowledgement' }),
              server.close(),
            ]).catch((error) => errors.push(String(error)));
            return;
          }
          const replayIds = commands
            .filter((command) =>
              ['UI-CMD-ENEMY-COMMIT-V1', 'UI-CMD-ENEMY-NEW-VERSION'].includes(
                text(command['workflowCommandId']),
              ),
            )
            .map((command) => command['commandId']);
          const correlation =
            value['messageType'] === 'projection.snapshot'
              ? object(object(value['presentation'])['assignment'])['correlationId']
              : receipt?.['commandId'];
          if (transport.probe && replayIds.includes(correlation)) {
            transport.replies.push(value);
            return;
          }
          frames.push(value);
          route.send(message);
        });
      });
      page.on('pageerror', (error) => errors.push(error.message));
      const payload = () => {
        const frame = frames.findLast((value) => value['messageType'] === 'projection.snapshot');
        if (frame === undefined) throw Error('Actual projection absent');
        const presentation = object(frame['presentation']);
        const raw = object(object(presentation['base'])['roleFilteredPayload']);
        expect(frame['projectionRole']).toBe('gm');
        for (const layer of rows(presentation['layers']))
          expect(object(layer['roleFilteredPayload'])).not.toHaveProperty(
            'currentCampaignLifecycle',
          );
        const capabilities = frames.findLast(
          (value) => value['messageType'] === 'session.reconnect.capabilities',
        );
        const workflowIds = capabilities?.['executableWorkflowCommandIds'];
        if (
          !Array.isArray(workflowIds) ||
          !workflowIds.some(
            (value) => typeof value === 'string' && isCampaignLifecycleWorkflow(value),
          )
        )
          throw Error('Actual lifecycle capability negotiation absent');
        const { currentCampaignLifecycle: marker, ...body } = raw;
        const anchor = campaignLifecycleGmAnchorValue(marker);
        expect(anchor.contextId).toBe(body['contextId']);
        expect(anchor.campaignId).toBe(body['campaignId']);
        expect(anchor.campaignStatus).toBe(body['campaignStatus']);
        const revisions = object(frame['revisions']);
        for (const key of [
          'stateRevision',
          'projectionRevision',
          'actorVisibilityRevision',
        ] as const) {
          expect(anchor[key]).toBe(revisions[key]);
          expect(body[key]).toBe(revisions[key]);
        }
        // The real WS client validates this one envelope marker before its strict enemy decoder.
        return body;
      };
      const current = () => enemyAuthoringProjectionValue(payload());
      const attempt = () => {
        const value = current().context.attemptOrNull;
        if (value === null) throw Error('Actual enemy attempt absent');
        return value;
      };
      const publish = async (name: string) => {
        const revision = attempt().revision;
        await expect(button(page, name)).toBeEnabled();
        await button(page, name).click();
        await expect.poll(() => attempt().revision, { timeout: 30_000 }).toBeGreaterThan(revision);
      };
      const initialSkillLabel = (key: string) => {
        const p = current();
        const available = rows(
          p.catalog[p.kind === 'SENTIENT_ENEMY_AUTHORING' ? 'skills' : 'advisorSkills'],
        );
        const row = available.find((row) => row['skillKey'] === key);
        if (row === undefined) throw Error('Missing actual skill ' + key);
        return text(row['name']);
      };
      const customAdvisor = async (firstAcquisition: boolean, inVersion: boolean) => {
        await page.getByRole('radio', { name: 'Один обыкновенный симбионт', exact: true }).check();
        await page.getByLabel('Вид симбионта монстра', { exact: true }).selectOption('ADVISER');
        const catalogue = object(current().catalog['compositionCatalog']);
        const mandatory = rows(catalogue['nodes']).filter(
          (row) => row['speciesKey'] === 'ADVISER' && row['level'] === 1,
        );
        expect(mandatory).toHaveLength(1);
        const node = mandatory[0]!;
        await page
          .getByRole('checkbox', { name: `${text(node['label'])} · уровень 1`, exact: true })
          .check();
        await publish('Проверить выбранный состав');
        if (inVersion) await button(page, 'Обыкновенный симбионт').click();
        const prepared = attempt();
        if (prepared.kind !== 'CUSTOM_MONSTER') throw Error('Wrong actual kind');
        expect(prepared.compositionOrNull?.selection).toMatchObject({
          mode: 'ORDINARY',
          symbiont: { speciesKey: 'ADVISER', learnedNodeRefs: [node['nodeRef']] },
        });
        if (firstAcquisition) {
          await page.getByLabel('R20 I Советника', { exact: true }).fill('12');
          await page.getByLabel('R20 W Советника', { exact: true }).fill('12');
        } else {
          await expect(page.getByLabel('R20 I Советника', { exact: true })).toHaveCount(0);
          await expect(page.getByLabel('R20 W Советника', { exact: true })).toHaveCount(0);
        }
        await page
          .getByRole('checkbox', {
            name: 'Подтверждаю выбранный состав и обязательные последствия',
            exact: true,
          })
          .check();
        await publish('Подтвердить состав у хоста');
        if (inVersion) await button(page, 'Обыкновенный симбионт').click();
        if (firstAcquisition) {
          for (const [index, key, bonus] of [
            [1, 'LEARNING', '7'],
            [2, 'ACROBATICS', '1'],
          ] as const) {
            await button(page, 'Добавить навык Советника').click();
            await page.getByLabel(`Навык Советника ${index}`, { exact: true }).selectOption(key);
            await page.getByLabel(`Бонус навыка Советника ${index}`, { exact: true }).fill(bonus);
          }
        }
        await page
          .getByRole('checkbox', { name: 'Подтверждаю итоговый состав', exact: true })
          .check();
        if (inVersion) await publish('Применить поле к текущей копии');
        else await npcAction(page, 'ENM-015::CTA::003', 'ENM-016');
      };
      await enterNpcLibrary(page, host.baseURL, 'ENEMY');
      const campaignBefore = host.inspect();
      if (kind === 'SENTIENT') {
        await npcAction(page, 'ENM-001::CTA::003', 'ENM-005');
        await page.getByLabel('Имя врага', { exact: true }).fill(name);
        await page
          .getByLabel('Описание врага', { exact: true })
          .fill('Полный начальный дозорный до новой версии');
        await page.getByLabel('Происхождение', { exact: true }).fill('Застава');
        await page.getByLabel('Принадлежность', { exact: true }).fill('Дозор');
        await page.getByLabel('Масса, кг', { exact: true }).fill('80');
        await npcAction(page, 'ENM-005::CTA::003', 'ENM-006');
        for (const stat of ['S', 'D', 'M', 'Z', 'I', 'W', 'C'])
          await page.getByLabel(`Базовая ${stat}`, { exact: true }).fill('20');
        await npcAction(page, 'ENM-006::CTA::002', 'ENM-007');
        await page.getByRole('combobox', { name: 'Раса', exact: true }).selectOption('PURE');
        await page
          .getByRole('combobox', { name: 'Класс Чистого', exact: true })
          .selectOption('SOLDIER');
        await page.getByLabel('Бонус: Рукопашный бой', { exact: true }).fill('7');
        await npcAction(page, 'ENM-007::CTA::004', 'ENM-008');
        await page.getByLabel('Подтверждаю явно пустой состав симбионтов', { exact: true }).check();
        await npcAction(page, 'ENM-008::CTA::002', 'ENM-009');
        await npcAction(page, 'ENM-009::CTA::002', 'ENM-010');
        await npcAction(page, 'ENM-010::CTA::004', 'ENM-020', 30_000);
      } else {
        await page.getByRole('tab', { name: 'Монстры', exact: true }).click();
        await npcAction(page, 'ENM-001::CTA::011', 'ENM-011');
        await page.getByLabel('Имя монстра', { exact: true }).fill(name);
        await page
          .getByLabel('Описание монстра', { exact: true })
          .fill('Личность Советника сохраняется между версиями');
        await npcAction(page, 'ENM-011::CTA::002', 'ENM-012');
        for (const stat of ['S', 'D', 'M', 'Z', 'I', 'W', 'C'])
          await page.getByLabel(`Базовая ${stat}`, { exact: true }).fill('20');
        await page.getByLabel('Масса монстра, кг', { exact: true }).fill('80');
        await page.getByLabel('Возраст монстра, лет', { exact: true }).fill('10');
        await page.getByLabel('Базовый максимум HP', { exact: true }).fill('70');
        await npcAction(page, 'ENM-012::CTA::004', 'ENM-013');
        await page
          .getByLabel('Естественная броня: формула', { exact: true })
          .selectOption('CONSTANT');
        await page.getByLabel('Естественная броня: значение', { exact: true }).fill('2');
        await npcAction(page, 'ENM-013::CTA::003', 'ENM-014');
        for (const label of ['Дополнительный урон', 'Пробитие']) {
          await page.getByLabel(`${label}: формула`, { exact: true }).selectOption('CONSTANT');
          await page.getByLabel(`${label}: значение`, { exact: true }).fill('1');
        }
        await npcAction(page, 'ENM-014::CTA::002', 'ENM-015');
        await customAdvisor(true, false);
        await npcAction(page, 'ENM-016::CTA::002', 'ENM-020', 30_000);
      }
      const v1Rows = host.inspectEnemy();
      expect(v1Rows.versions).toHaveLength(1);
      const v1 = object(JSON.parse(text(v1Rows.versions[0]!['record_json'])));
      const v1Attempt = object(v1['attempt']);
      const originalCommit = commands.find(
        (command) => command['workflowCommandId'] === 'UI-CMD-ENEMY-COMMIT-V1',
      );
      if (originalCommit === undefined) throw Error('Original actual V1 command absent');
      const originalReceipt = frames.find(
        (value) =>
          value['messageType'] === 'command.result' &&
          object(value['receipt'])['commandId'] === originalCommit['commandId'],
      )?.['receipt'];
      expect(originalReceipt).toBeDefined();
      const originalCard = kind === 'CUSTOM_MONSTER' ? rows(v1Attempt['advisorCards'])[0] : null;
      if (kind === 'CUSTOM_MONSTER')
        expect(originalCard).toMatchObject({
          initialSkillsOrNull: [
            { skillKey: 'LEARNING', targetBonus: 7 },
            { skillKey: 'ACROBATICS', targetBonus: 1 },
          ],
        });
      await npcAction(page, 'ENM-020::CTA::002', 'ENM-001');
      await npcAction(page, 'ENM-001::CTA::008', 'ENM-017');
      expect(current().versionEditor?.baseSnapshot).toMatchObject({ kind });
      await page.getByLabel('Причина новой версии', { exact: true }).fill(reason);
      await publish('Сохранить причину');
      if (kind === 'SENTIENT') {
        await page.getByLabel('Новая базовая S', { exact: true }).fill('21');
        await page
          .getByLabel(`Новый начальный навык: ${initialSkillLabel('UNARMED')}`, { exact: true })
          .fill('6');
        await page
          .getByLabel(`Новый начальный навык: ${initialSkillLabel('LEARNING')}`, { exact: true })
          .fill('2');
      } else {
        await page
          .getByLabel(`Новый собственный навык Советника: ${initialSkillLabel('LEARNING')}`, {
            exact: true,
          })
          .fill('');
        await page
          .getByLabel(`Новый собственный навык Советника: ${initialSkillLabel('UNARMED')}`, {
            exact: true,
          })
          .fill('7');
      }
      await publish('Рассчитать последствия замены конфигурации');
      const preview = current().context.versionAttempt?.replacementPreviewOrNull;
      if (preview == null) throw Error('Actual host replacement preview absent');
      expect(current().versionEditor?.replacementSummaryOrNull).toEqual(preview.inputSummary);
      const consequences = page.getByRole('region', {
        name: 'Подтверждённые последствия замены конфигурации',
        exact: true,
      });
      await expect(consequences).toContainText('Прежние');
      await expect(consequences).toContainText(
        kind === 'SENTIENT' ? 'оплачено START' : 'стоимость собственных слотов',
      );
      await testInfo.attach(`${kind}-replacement-preview`, {
        body: await consequences.screenshot(),
        contentType: 'image/png',
      });
      const consent = page.getByLabel('Подтверждаю точную замену конфигурации', { exact: true });
      await consent.check();
      const changed =
        kind === 'SENTIENT'
          ? page.getByLabel('Новая базовая S', { exact: true })
          : page.getByLabel(`Новый собственный навык Советника: ${initialSkillLabel('UNARMED')}`, {
              exact: true,
            });
      await changed.fill(kind === 'SENTIENT' ? '22' : '6');
      await expect(consequences).toHaveCount(0);
      await changed.fill(kind === 'SENTIENT' ? '21' : '7');
      await expect(consent).not.toBeChecked();
      await expect(button(page, 'Подтвердить замену конфигурации')).toBeDisabled();
      expect(host.inspectEnemy()).toEqual(v1Rows);
      await consent.check();
      await publish('Подтвердить замену конфигурации');
      const confirmed = current().context.versionAttempt?.configurationConfirmation;
      expect(confirmed?.input).toEqual(preview.input);
      expect(attempt().compositionOrNull).toBeNull();
      await expect(button(page, 'Однократная генерация характеристик')).toHaveCount(
        kind === 'CUSTOM_MONSTER' ? 1 : 0,
      );
      if (kind === 'SENTIENT') {
        await button(page, 'Состав симбионтов').click();
        await page.getByLabel('Подтверждаю явно пустой состав симбионтов', { exact: true }).check();
        const calc = button(page, 'Рассчитать взаимодействия');
        if ((await calc.count()) > 0) {
          await publish('Рассчитать взаимодействия');
          await button(page, 'Состав симбионтов').click();
          await page
            .getByLabel('Подтверждаю показанные взаимодействия и обязательные приобретения', {
              exact: true,
            })
            .check();
          await publish('Подтвердить взаимодействия и приобретения');
          await button(page, 'Состав симбионтов').click();
        }
        await publish('Применить поле к текущей копии');
        await button(page, 'Имущество и экипировка').click();
        await publish('Применить поле к текущей копии');
      } else {
        await expect(button(page, 'Однократная генерация характеристик')).toBeDisabled();
        await button(page, 'Ручные характеристики').click();
        await page.getByLabel('Базовая S', { exact: true }).fill('21');
        await publish('Применить поле к текущей копии');
        await button(page, 'Обыкновенный симбионт').click();
        await customAdvisor(false, true);
      }
      expect(current().validationErrors).toEqual([]);
      const complete = attempt();
      if (complete.kind === 'SENTIENT') {
        expect(complete.baseStatsOrNull?.S).toBe(21);
        expect(complete.skillPlanState?.planOrNull?.initialSkills).toEqual(
          expect.arrayContaining([
            { skillKey: 'UNARMED', bonus: 6, source: 'SELECTED', startSlots: 7, dolphinSlots: 0 },
            { skillKey: 'LEARNING', bonus: 2, source: 'SELECTED', startSlots: 2, dolphinSlots: 0 },
          ]),
        );
      } else {
        expect(complete.statsOrNull?.baseStats.S).toBe(21);
        expect(complete.advisorCards).toHaveLength(1);
        expect(complete.advisorCards[0]).toMatchObject({
          cardId: originalCard?.['cardId'],
          iwRolls: originalCard?.['iwRolls'],
          initialSkillsOrNull: originalCard?.['initialSkillsOrNull'],
          knownSkills: [
            { skillKey: 'ACROBATICS', targetBonus: 1 },
            { skillKey: 'UNARMED', targetBonus: 7 },
          ],
        });
      }
      const changeSet = current().versionEditor?.changeSet;
      expect(changeSet?.length).toBeGreaterThan(0);
      await expect(
        page.getByRole('region', { name: 'Различия полной версии', exact: true }),
      ).toContainText('Рукопашный бой');
      player = await createNpcPlayerPrivacyProbe(browser, host.baseURL);
      const cfgCommand = commands.findLast(
        (command) => object(command['payload'])['stage'] === 'VERSION_CONFIGURATION',
      );
      if (cfgCommand === undefined) throw Error('Actual private configuration command absent');
      await player.refuseEnemyAuthoringAccess([cfgCommand]);
      await player.assertHidden([
        name,
        reason,
        preview.previewCommandId,
        complete.attemptId,
        'versionAttempt',
        'replacementPreviewOrNull',
        'inputSummary',
        'retainedMandatoryFacts',
      ]);
      transport.cutNext = true;
      await page.locator('[data-atlas-action-key="ENM-017::CTA::004"]').click();
      await expect.poll(() => transport.cut, { timeout: 30_000 }).toBe(true);
      expect(host.inspectEnemy().versions).toHaveLength(2);
      await button(page, 'Переподключиться').click();
      await expect(npcForm(page, 'ENM-020')).toBeVisible({ timeout: 30_000 });
      expect(
        frames.findLast((value) => value['messageType'] === 'command.replay')?.['receipt'],
      ).toEqual(transport.lostReceipt);
      const saved = host.inspectEnemy();
      expect(saved.versions).toHaveLength(2);
      expect(saved.history).toHaveLength(2);
      expect(saved.pointers).toHaveLength(1);
      expect(saved.versions[0]).toEqual(v1Rows.versions[0]);
      expect(saved.history[0]).toEqual(v1Rows.history[0]);
      expect(saved.templates).toEqual(v1Rows.templates);
      const v2 = object(JSON.parse(text(saved.versions[1]!['record_json'])));
      expect(v2['attempt']).toEqual(complete);
      await button(page, 'Просмотреть версию 1').click();
      await expect
        .poll(() => current().versionHistory?.selected.version, { timeout: 30_000 })
        .toBe(1);
      expect(current().versionHistory?.current.version).toBe(2);
      expect(current().sheetOrNull).toEqual(v1['sheet']);
      expect(host.inspectEnemy()).toEqual(saved);
      await testInfo.attach(`${kind}-history-current`, {
        body: await page
          .getByRole('region', { name: 'История версий шаблона', exact: true })
          .screenshot(),
        contentType: 'image/png',
      });
      await button(page, 'Просмотреть версию 2').click();
      await expect
        .poll(() => current().versionHistory?.selected.version, { timeout: 30_000 })
        .toBe(2);
      expect(current().sheetOrNull).toEqual(v2['sheet']);
      await button(page, 'Просмотреть версию 1').click();
      await expect
        .poll(() => current().versionHistory?.selected.version, { timeout: 30_000 })
        .toBe(1);
      await npcAction(page, 'ENM-020::CTA::002', 'ENM-001');
      await expect(page.getByRole('radio', { name: new RegExp(`${name} · V2`) })).toBeChecked();
      await npcAction(page, 'ENM-001::CTA::008', 'ENM-017');
      expect(current().context.versionAttempt?.origin.base.version).toBe(2);
      expect(current().versionEditor?.baseSnapshot).toEqual(v2['attempt']);
      await npcAction(page, 'ENM-017::CTA::005', 'ENM-020');
      await host.restart();
      await page.reload();
      await expect(npcForm(page, 'ENM-020')).toBeVisible({ timeout: 30_000 });
      expect(current().versionHistory?.current.version).toBe(2);
      expect(current().sheetOrNull).toEqual(v2['sheet']);
      expect(host.inspectEnemy()).toEqual(saved);
      await player.refreshPlayer();
      const v2Identity = object(v2['identity']);
      await player.assertHidden([
        name,
        reason,
        preview.previewCommandId,
        complete.attemptId,
        text(v2Identity['templateId']),
        text(v2Identity['versionId']),
        ...(originalCard === null || originalCard === undefined
          ? []
          : [
              text(originalCard['cardId']),
              text(object(rows(originalCard['iwRolls'])[0])['rollReceiptId']),
            ]),
        'versionSource',
        'configurationConfirmation',
        'retainedMandatoryFacts',
      ]);
      await npcAction(page, 'ENM-020::CTA::002', 'ENM-001');
      await npcAction(page, 'ENM-001::CTA::013', 'GM-001');
      transport.probe = true;
      if (transport.send === undefined || transport.lostRequest === null)
        throw Error('Actual replay channel absent');
      for (const [request, receipt] of [
        [originalCommit, originalReceipt],
        [transport.lostRequest, transport.lostReceipt],
      ] as const) {
        transport.send(request);
        await expect
          .poll(
            () =>
              transport.replies.filter(
                (value) =>
                  value['messageType'] === 'command.replay' &&
                  object(value['receipt'])['commandId'] === request['commandId'],
              ),
            { timeout: 30_000 },
          )
          .toHaveLength(1);
        expect(
          transport.replies.find(
            (value) =>
              value['messageType'] === 'command.replay' &&
              object(value['receipt'])['commandId'] === request['commandId'],
          )?.['receipt'],
        ).toEqual(receipt);
        await expect
          .poll(
            () =>
              transport.replies.filter(
                (value) =>
                  value['messageType'] === 'projection.snapshot' &&
                  object(object(value['presentation'])['assignment'])['correlationId'] ===
                    request['commandId'],
              ),
            { timeout: 30_000 },
          )
          .toHaveLength(1);
      }
      for (const reply of transport.replies.filter(
        (value) => value['messageType'] === 'projection.snapshot',
      ))
        expect(object(object(reply['presentation'])['base'])['formId']).toBe('GM-001');
      expect(host.inspectEnemy()).toEqual(saved);
      expect(host.inspect().campaigns).toEqual(campaignBefore.campaigns);
      expect(host.inspect().copies).toEqual([]);
      expect(host.inspectNpc().versions).toEqual([]);
      expect(errors).toEqual([]);
    } catch (error) {
      failure = error;
    } finally {
      await disposeNetworkResources(
        [
          () =>
            testInfo.attach(`${kind}-version-evidence`, {
              body: Buffer.from(
                JSON.stringify(
                  {
                    frames,
                    commands,
                    errors,
                    hostErrors: host.errors,
                    transport: { ...transport, send: undefined },
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
        failure,
      );
    }
  });
}
