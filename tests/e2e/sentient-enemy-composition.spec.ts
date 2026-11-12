import { expect, test } from '@playwright/test';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import {
  createNetworkBrowserProcess,
  disposeNetworkResources,
} from '../fixtures/network-application-e2e.js';
import { enterNpcLibrary, npcAction, npcForm } from '../fixtures/npc-authoring-e2e.js';
import { createNpcPlayerPrivacyProbe } from '../fixtures/npc-privacy-e2e.js';

test.use({ channel: 'chrome' });
const requiredText = (value: unknown): string => {
  if (typeof value !== 'string') throw Error('Expected source-bound text');
  return value;
};
for (const mode of ['ORDINARY', 'MONSTER'] as const) {
  test(`GM confirms ${mode} SENTIENT composition through real nodes and preserves its original receipt, full resources and V1 after physical restart`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const host = await createNetworkBrowserProcess(0),
      errors: string[] = [],
      frames: JsonObject[] = [],
      commands: JsonObject[] = [],
      privatePlanFacts: string[] = [];
    let scenarioError: unknown,
      player: Awaited<ReturnType<typeof createNpcPlayerPrivacyProbe>> | undefined;
    const delivery: {
      cut: boolean;
      armed: boolean;
      request: JsonObject | null;
      receipt: JsonObject | null;
    } = { cut: false, armed: false, request: null, receipt: null };
    page.on('pageerror', (error) => errors.push(error.message));
    await page.routeWebSocket('**/state', (route) => {
      const server = route.connectToServer();
      let dropped = false;
      route.onMessage((message) => {
        const value = JSON.parse(String(message)) as JsonObject;
        if (value['messageType'] === 'command.request') {
          commands.push(value);
          const data = (value['payload'] as JsonObject)?.['data'] as JsonObject | undefined;
          if (
            delivery.armed &&
            delivery.request === null &&
            (mode === 'ORDINARY'
              ? data?.['operation'] === 'CONFIRM'
              : value['workflowCommandId'] === 'UI-CMD-ENEMY-COMMIT-V1')
          )
            delivery.request = value;
        }
        server.send(message);
      });
      server.onMessage((message) => {
        if (dropped) return;
        const value = JSON.parse(String(message)) as JsonObject;
        const receipt = value['receipt'] as JsonObject | undefined;
        if (
          delivery.armed &&
          receipt !== undefined &&
          value['messageType'] === 'command.result' &&
          receipt['commandId'] === delivery.request?.['commandId']
        ) {
          delivery.receipt = receipt;
          delivery.armed = false;
          delivery.cut = true;
          dropped = true;
          void Promise.all([
            route.close({ code: 1012, reason: 'lost composition reply' }),
            server.close(),
          ]).catch((error) => errors.push(String(error)));
          return;
        }
        frames.push(value);
        route.send(message);
      });
    });
    const latest = () =>
      (
        (
          frames.findLast((frame) => frame['messageType'] === 'projection.snapshot')?.[
            'presentation'
          ] as JsonObject
        )['base'] as JsonObject
      )['roleFilteredPayload'] as JsonObject;
    const name = mode === 'ORDINARY' ? 'Дозорный с Совой и Клещом' : 'Дозорный с Химерой';
    try {
      await enterNpcLibrary(page, host.baseURL, 'ENEMY');
      const before = host.inspect();
      await npcAction(page, 'ENM-001::CTA::003', 'ENM-005');
      await page.getByLabel('Имя врага', { exact: true }).fill(name);
      await page
        .getByLabel('Описание врага', { exact: true })
        .fill('Начальный состав без XP и накопленных историй');
      await page.getByLabel('Происхождение', { exact: true }).fill('Застава');
      await page.getByLabel('Принадлежность', { exact: true }).fill('Дозор');
      await page.getByLabel('Масса, кг', { exact: true }).fill('80');
      await npcAction(page, 'ENM-005::CTA::003', 'ENM-006');
      for (const stat of ['S', 'D', 'M', 'Z', 'I', 'W', 'C'])
        await page.getByLabel(`Базовая ${stat}`, { exact: true }).fill('20');
      await npcAction(page, 'ENM-006::CTA::002', 'ENM-007');
      await page
        .getByRole('combobox', { name: 'Раса', exact: true })
        .selectOption(mode === 'ORDINARY' ? 'FREE' : 'UNITED');
      await expect(
        page.getByRole('region', { name: 'Подтверждённые хостом правила выбора', exact: true }),
      ).toContainText('Начальные слоты навыков: 10');
      await page.getByLabel('Бонус: Рукопашный бой', { exact: true }).fill('7');
      await page.getByLabel('Бонус: Акробатика', { exact: true }).fill('1');
      await npcAction(page, 'ENM-007::CTA::004', 'ENM-008');
      await page
        .getByRole('combobox', { name: 'Режим состава симбионтов', exact: true })
        .selectOption(mode === 'ORDINARY' ? 'ORDINARY_SYMBIONTS' : 'SYMBIOTIC_MONSTER');
      if (mode === 'ORDINARY') {
        for (const species of ['OWL', 'DOLPHIN']) {
          await page
            .getByRole('combobox', { name: 'Добавляемый вид симбионта', exact: true })
            .selectOption(species);
          await page.getByRole('button', { name: 'Добавить выбранный вид', exact: true }).click();
        }
        await page
          .getByRole('combobox', { name: 'Сторона привязки: Сова', exact: true })
          .selectOption('LEFT');
        await page
          .getByRole('combobox', { name: 'Целевой уровень: Сова', exact: true })
          .selectOption('2');
        await page
          .getByRole('checkbox', { name: 'Изучить: Абсолютное ночное зрение', exact: true })
          .click();
        await expect(
          page.getByRole('checkbox', { name: 'Изучить: Абсолютное ночное зрение', exact: true }),
        ).toBeChecked();
        const sourceCatalog = (latest()['catalog'] as JsonObject)[
          'compositionCatalog'
        ] as JsonObject;
        const dolphinName = (sourceCatalog['species'] as JsonObject[]).find(
          (row) => row['speciesKey'] === 'DOLPHIN',
        )?.['name'];
        expect(typeof dolphinName).toBe('string');
        await page
          .getByRole('combobox', {
            name: 'Целевой уровень: ' + requiredText(dolphinName),
            exact: true,
          })
          .selectOption('6');
        for (const node of (sourceCatalog['nodes'] as JsonObject[]).filter(
          (row) =>
            row['speciesKey'] === 'DOLPHIN' &&
            Number(row['level']) > 1 &&
            Number(row['level']) <= 6,
        )) {
          expect(typeof node['label']).toBe('string');
          const control = page.getByRole('checkbox', {
            name: 'Изучить: ' + requiredText(node['label']),
            exact: true,
          });
          await control.click();
          await expect(control).toBeChecked();
        }
      } else {
        await page
          .getByRole('combobox', { name: 'Профиль симбиотического чудовища', exact: true })
          .selectOption('LVL-CHIMERA-4');
        for (const label of ['Дублирование органов', 'Безразличная плоть', 'Выносливость хищника'])
          await page.getByRole('checkbox', { name: `Изучить: ${label}`, exact: true }).click();
        await expect(
          page.getByRole('checkbox', { name: 'Изучить: Выносливость хищника', exact: true }),
        ).toBeChecked();
      }
      await page.getByRole('button', { name: 'Рассчитать взаимодействия', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Подтверждённый хостом расчёт', exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-atlas-action-key="ENM-008::CTA::002"]')).toHaveCount(0);
      const prepared = latest();
      player = await createNpcPlayerPrivacyProbe(browser, host.baseURL);
      const previewRequest = commands.findLast(
        (command) =>
          ((command['payload'] as JsonObject)?.['data'] as JsonObject)?.['operation'] === 'PREVIEW',
      )!;
      await player.refuseEnemyAuthoringAccess([previewRequest]);
      await player.assertHidden([
        name,
        'Абсолютное ночное зрение',
        'Выносливость хищника',
        prepared['contextId'] as string,
      ]);
      expect(host.inspectEnemy().versions).toHaveLength(0);
      await page
        .getByRole('checkbox', {
          name: 'Подтверждаю показанные взаимодействия и обязательные приобретения',
          exact: true,
        })
        .click();
      if (mode === 'ORDINARY') {
        await page.getByLabel('Результат: дополнительный слот', { exact: true }).fill('3');
        delivery.armed = true;
      }
      await page
        .getByRole('button', { name: 'Подтвердить взаимодействия и приобретения', exact: true })
        .click();
      if (mode === 'ORDINARY') {
        await expect.poll(() => delivery.cut).toBe(true);
        await page.getByRole('button', { name: 'Переподключиться', exact: true }).click();
        await expect
          .poll(() =>
            frames.some(
              (frame) =>
                frame['messageType'] === 'command.replay' &&
                (frame['receipt'] as JsonObject)['commandId'] === delivery.request?.['commandId'],
            ),
          )
          .toBe(true);
        expect(
          frames.findLast((frame) => frame['messageType'] === 'command.replay')?.['receipt'],
        ).toEqual(delivery.receipt);
        await expect(
          page.getByText('Сохранённый R6 второго слота: 3.', { exact: false }),
        ).toBeVisible();
      }
      if (mode === 'ORDINARY') {
        await page.getByLabel('Навыки Мирного воина: Рукопашный бой', { exact: true }).fill('8');
        await page.getByLabel('Навыки Мирного воина: Акробатика', { exact: true }).fill('4');
      }
      await npcAction(page, 'ENM-008::CTA::002', 'ENM-009');
      await npcAction(page, 'ENM-009::CTA::002', 'ENM-010');
      const sheet = page.getByRole('region', { name: 'Полный лист мыслящего врага', exact: true });
      await expect(sheet).toContainText('Подтверждённый состав и приобретения');
      await expect(sheet).toContainText('Начальные истории пожирания, спутников и стаи пусты');
      let full = latest()['sheetOrNull'] as JsonObject,
        facts = full['compositionFacts'] as JsonObject;
      let specimens = facts['specimens'] as JsonObject[];
      expect(specimens).toHaveLength(mode === 'ORDINARY' ? 2 : 1);
      for (const specimen of specimens) {
        expect(specimen['currentOE']).toBe(specimen['maxOE']);
        expect(specimen['specialHistories']).toEqual({
          devourings: [],
          companions: [],
          ratpack: [],
        });
      }
      expect(full['progressionPolicy']).toBe('NO_XP_PROGRESSION');
      if (mode === 'MONSTER') {
        expect(full['maxHP']).toBe(200); // CORE-152 base100 + learned MON-012 +100.
        expect((full['permanentStats'] as JsonObject)['M']).toBe(35);
      }
      if (mode === 'ORDINARY') {
        const originalPlan = (full['skillPlanState'] as JsonObject)['planOrNull'] as JsonObject;
        const paid = (originalPlan['accountingOrNull'] as JsonObject)[
          'knownSkills'
        ] as JsonObject[];
        expect(paid.find((row) => row['skillKey'] === 'UNARMED')).toMatchObject({
          bonus: 8,
          startSlots: 9,
          dolphinSlots: 2,
        });
        expect(paid.find((row) => row['skillKey'] === 'ACROBATICS')).toMatchObject({
          bonus: 4,
          startSlots: 1,
          dolphinSlots: 3,
        });
        const originalFree = (
          ((latest()['context'] as JsonObject)['attemptOrNull'] as JsonObject)[
            'compositionAcquisitions'
          ] as JsonObject
        )['freeSlotOrNull'];
        await npcAction(page, 'ENM-010::CTA::005', 'ENM-009');
        await npcAction(page, 'ENM-009::CTA::001', 'ENM-007');
        await page
          .getByRole('button', {
            name: 'Рассчитать явную пересборку начального плана',
            exact: true,
          })
          .click();
        const consequences = page.getByRole('region', {
          name: 'Последствия явной пересборки',
          exact: true,
        });
        await expect(consequences).toContainText('START 9, Мирный воин 2');
        await expect(consequences).toContainText('START 1, Мирный воин 3');
        await expect(consequences).toContainText('Сохраняется исходный R6: 3');
        const rebuildRequest = commands.findLast(
          (command) =>
            ((command['payload'] as JsonObject)?.['data'] as JsonObject)?.['operation'] ===
            'PREVIEW_REBUILD',
        )!;
        const freeReceiptId = ((originalFree as JsonObject)['roll'] as JsonObject)['rollReceiptId'];
        expect(typeof originalPlan['planId']).toBe('string');
        expect(typeof rebuildRequest['commandId']).toBe('string');
        expect(typeof freeReceiptId).toBe('string');
        privatePlanFacts.push(
          requiredText(originalPlan['planId']),
          requiredText(rebuildRequest['commandId']),
          requiredText(freeReceiptId),
        );
        await player.refuseEnemyAuthoringAccess([rebuildRequest]);
        await player.assertHidden([requiredText(originalPlan['planId']), name]);
        await page
          .getByRole('checkbox', {
            name: 'Подтверждаю показанную пересборку и повторное подтверждение зависимых этапов',
            exact: true,
          })
          .click();
        await npcAction(page, 'ENM-007::CTA::004', 'ENM-008');
        await page
          .getByRole('combobox', { name: 'Режим состава симбионтов', exact: true })
          .selectOption('EMPTY');
        await page
          .getByRole('checkbox', { name: 'Подтверждаю явно пустой состав симбионтов', exact: true })
          .click();
        await page.getByRole('button', { name: 'Рассчитать взаимодействия', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Подтверждённый хостом расчёт', exact: true }),
        ).toBeVisible();
        expect(
          ((commands.at(-1)!['payload'] as JsonObject)['data'] as JsonObject)['operation'],
        ).toBe('PREVIEW');
        await page
          .getByRole('checkbox', {
            name: 'Подтверждаю показанные взаимодействия и обязательные приобретения',
            exact: true,
          })
          .click();
        await expect(
          page.getByLabel('Результат: дополнительный слот', { exact: true }),
        ).toHaveCount(0);
        await page
          .getByRole('button', { name: 'Подтвердить взаимодействия и приобретения', exact: true })
          .click();
        await npcAction(page, 'ENM-008::CTA::002', 'ENM-009');
        expect(
          ((commands.at(-1)!['payload'] as JsonObject)['data'] as JsonObject)['operation'],
        ).toBe('FINISH');
        await npcAction(page, 'ENM-009::CTA::002', 'ENM-010');
        const emptyFull = latest()['sheetOrNull'] as JsonObject;
        expect((emptyFull['compositionFacts'] as JsonObject)['specimens']).toEqual([]);
        expect(
          (emptyFull['skills'] as JsonObject[]).find((row) => row['skillKey'] === 'UNARMED'),
        ).toMatchObject({ bonus: 7, slotCost: 9 });
        expect(
          (emptyFull['skills'] as JsonObject[]).find((row) => row['skillKey'] === 'ACROBATICS'),
        ).toMatchObject({ bonus: 1, slotCost: 1 });
        await npcAction(page, 'ENM-010::CTA::005', 'ENM-009');
        await npcAction(page, 'ENM-009::CTA::003', 'ENM-008');
        await page
          .getByRole('combobox', { name: 'Режим состава симбионтов', exact: true })
          .selectOption('ORDINARY_SYMBIONTS');
        for (const species of ['OWL', 'TICK']) {
          await page
            .getByRole('combobox', { name: 'Добавляемый вид симбионта', exact: true })
            .selectOption(species);
          await page.getByRole('button', { name: 'Добавить выбранный вид', exact: true }).click();
        }
        await page
          .getByRole('combobox', { name: 'Сторона привязки: Сова', exact: true })
          .selectOption('LEFT');
        await page
          .getByRole('combobox', { name: 'Целевой уровень: Сова', exact: true })
          .selectOption('2');
        await page
          .getByRole('checkbox', { name: 'Изучить: Абсолютное ночное зрение', exact: true })
          .click();
        await expect(
          page.getByRole('checkbox', { name: 'Изучить: Абсолютное ночное зрение', exact: true }),
        ).toBeChecked();
        await page.getByRole('button', { name: 'Рассчитать взаимодействия', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Подтверждённый хостом расчёт', exact: true }),
        ).toBeVisible();
        await page
          .getByRole('checkbox', {
            name: 'Подтверждаю показанные взаимодействия и обязательные приобретения',
            exact: true,
          })
          .click();
        await expect(
          page.getByLabel('Результат: дополнительный слот', { exact: true }),
        ).toHaveCount(0);
        await page
          .getByRole('button', { name: 'Подтвердить взаимодействия и приобретения', exact: true })
          .click();
        await npcAction(page, 'ENM-008::CTA::002', 'ENM-009');
        await npcAction(page, 'ENM-009::CTA::002', 'ENM-010');
        full = latest()['sheetOrNull'] as JsonObject;
        facts = full['compositionFacts'] as JsonObject;
        specimens = facts['specimens'] as JsonObject[];
        expect(specimens).toHaveLength(2);
        for (const specimen of specimens) {
          expect(specimen['currentOE']).toBe(specimen['maxOE']);
          expect(specimen['specialHistories']).toEqual({
            devourings: [],
            companions: [],
            ratpack: [],
          });
        }
        const currentPlan = (full['skillPlanState'] as JsonObject)['planOrNull'] as JsonObject;
        expect(currentPlan['revision']).toBe(2);
        expect(currentPlan['planId']).not.toBe(originalPlan['planId']);
        expect(
          (
            ((latest()['context'] as JsonObject)['attemptOrNull'] as JsonObject)[
              'compositionAcquisitions'
            ] as JsonObject
          )['freeSlotOrNull'],
        ).toEqual(originalFree);
      }
      const finalPlanId = ((full['skillPlanState'] as JsonObject)['planOrNull'] as JsonObject)[
        'planId'
      ];
      expect(typeof finalPlanId).toBe('string');
      privatePlanFacts.push(requiredText(finalPlanId));
      delivery.armed = mode === 'MONSTER';
      await page.locator('[data-atlas-action-key="ENM-010::CTA::004"]').click();
      if (mode === 'MONSTER') {
        await expect.poll(() => delivery.cut).toBe(true);
        await page.getByRole('button', { name: 'Переподключиться', exact: true }).click();
        await expect
          .poll(() =>
            frames.some(
              (frame) =>
                frame['messageType'] === 'command.replay' &&
                (frame['receipt'] as JsonObject)['commandId'] === delivery.request?.['commandId'],
            ),
          )
          .toBe(true);
        expect(
          frames.findLast((frame) => frame['messageType'] === 'command.replay')?.['receipt'],
        ).toEqual(delivery.receipt);
      }
      await expect(npcForm(page, 'ENM-020')).toBeVisible({ timeout: 20_000 });
      const saved = host.inspectEnemy();
      expect(saved.versions).toHaveLength(1);
      expect(saved.history).toHaveLength(1);
      await host.restart();
      await page.reload();
      await expect(npcForm(page, 'ENM-020')).toBeVisible({ timeout: 30_000 });
      expect(latest()['sheetOrNull']).toEqual(full);
      await expect(sheet).toContainText(mode === 'ORDINARY' ? 'Сова' : 'Химера');
      await player.refreshPlayer();
      await player.assertHidden([
        name,
        'symbiosis_placeholder_sentient_enemy',
        specimens[0]!['symbiontInstanceId'] as string,
        ...privatePlanFacts,
        'skillPlanState',
        'legacySkillPlanPreview',
        'advisorInitialFillHistory',
        'preparedSkillState',
      ]);
      const after = host.inspect();
      expect(host.inspectEnemy()).toEqual(saved);
      expect(after.campaigns).toEqual(before.campaigns);
      expect(after.checkpoints).toEqual(before.checkpoints);
      expect(after.copies).toEqual([]);
      expect(host.inspectNpc().versions).toEqual([]);
      expect(errors).toEqual([]);
    } catch (error) {
      scenarioError = error;
    } finally {
      try {
        await testInfo.attach('sentient-composition-evidence', {
          body: Buffer.from(JSON.stringify({ mode, errors, frames, commands, delivery }, null, 2)),
          contentType: 'application/json',
        });
      } finally {
        await disposeNetworkResources(
          [...(player === undefined ? [] : [() => player!.close()]), () => host.close()],
          scenarioError,
        );
      }
    }
  });
}
