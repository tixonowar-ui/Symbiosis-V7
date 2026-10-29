import { expect, test, type Page } from '@playwright/test';
import { createCreationFinalizationBrowserHost } from '../fixtures/creation-finalization-e2e.js';

test.use({ channel: 'chrome' });
test.setTimeout(60000);
const screen = (page: Page, form: string) =>
  expect(page.locator(`[data-atlas-form-id="${form}"]`)).toBeVisible();
const action = (page: Page, key: string) =>
  page.locator(`[data-atlas-action-key="${key}"]`).click();
async function summary(page: Page, url: string) {
  await page.goto(url);
  await screen(page, 'CHR-032');
  await action(page, 'CHR-032::CTA::001');
  await screen(page, 'CHR-025');
}
async function race(page: Page, value: 'PURE' | 'FREE' | 'UNITED', mode?: 'MANUAL' | 'RANDOM') {
  await screen(page, 'CHR-025');
  await action(page, 'CHR-025::CTA::002');
  await screen(page, 'CHR-010');
  await page.getByLabel('Исправление расы', { exact: true }).selectOption(value);
  if (mode !== undefined)
    await page.getByLabel('Получение симбионтов', { exact: true }).selectOption(mode);
  await expect(
    page.getByRole('region', { name: 'Последствия изменения расы', exact: true }),
  ).toContainText('Слоты симбионтов');
  await page.getByRole('button', { name: 'Сохранить изменение расы', exact: true }).click();
}
function assertUnchangedProperty(
  host: Awaited<ReturnType<typeof createCreationFinalizationBrowserHost>>,
  before: ReturnType<typeof host.checkpoint>,
) {
  const after = host.checkpoint();
  expect(after.statRollStage).toEqual(before.statRollStage);
  expect(after.statAssignmentStage).toEqual(before.statAssignmentStage);
  expect(after.armorBundleStage).toEqual(before.armorBundleStage);
  expect(after.startingWeaponStage).toEqual(before.startingWeaponStage);
  expect(after.startingMoneyStage).toEqual(before.startingMoneyStage);
  expect(after.fiveStartingPositionsStage).toEqual(before.fiveStartingPositionsStage);
  expect(host.sampleCalls()).toBe(0);
  expect(host.rollAllocations()).toBe(0);
}

test('same PURE race opens class correction and preserves its old class until explicit replacement', async ({
  page,
}) => {
  const host = await createCreationFinalizationBrowserHost({
    prefix: 'correction-pure-class-e2e',
    race: 'PURE',
    mode: 'MANUAL',
  });
  try {
    const before = host.checkpoint();
    await summary(page, host.baseURL);
    await race(page, 'PURE');
    await screen(page, 'CHR-011');
    expect(
      host.checkpoint().finalizationStage!.state.branches.find((b) => b.raceCode === 'PURE')!
        .classCode,
    ).toBe('SEEKER');
    await page.getByLabel('Класс Чистого', { exact: true }).selectOption('SOLDIER');
    await expect(
      page.getByRole('region', { name: 'Последствия изменения класса', exact: true }),
    ).toContainText('S: +5');
    await expect(
      page.getByRole('region', { name: 'Последствия изменения класса', exact: true }),
    ).toContainText('стоимость: 1 слот');
    await page.getByRole('button', { name: 'Сохранить класс', exact: true }).click();
    await screen(page, 'CHR-025');
    const corrected = host.checkpoint();
    expect(
      corrected.finalizationStage!.state.branches.find((b) => b.raceCode === 'PURE')!.classCode,
    ).toBe('SOLDIER');
    expect(corrected.pureClassStage).toEqual(before.pureClassStage);
    await host.restart();
    await page.goto(host.baseURL);
    await screen(page, 'CHR-025');
    expect(host.checkpoint().finalizationStage).toEqual(corrected.finalizationStage);
    assertUnchangedProperty(host, before);
  } finally {
    await host.close();
  }
});

test('manual correction selects and caches an anatomical side without rerolling property', async ({
  page,
}) => {
  const host = await createCreationFinalizationBrowserHost({
    prefix: 'correction-manual-e2e',
    race: 'PURE',
    mode: 'MANUAL',
  });
  try {
    const before = host.checkpoint();
    await summary(page, host.baseURL);
    await race(page, 'FREE', 'MANUAL');
    await screen(page, 'CHR-019');
    await action(page, 'CHR-019::CTA::004');
    await screen(page, 'CHR-017');
    await page.getByRole('button', { name: 'Открыть: Сова', exact: true }).click();
    await screen(page, 'CHR-018');
    await page.getByRole('checkbox', { name: 'Сова (1 сл.)', exact: true }).check();
    await page.getByLabel('Сторона Сова', { exact: true }).selectOption('LEFT');
    await page.getByRole('button', { name: 'Сохранить исправленный состав', exact: true }).click();
    await screen(page, 'CHR-025');
    const branch = host
      .checkpoint()
      .finalizationStage!.state.branches.find((b) => b.raceCode === 'FREE')!;
    expect(branch.bindings[0]!.binding).toEqual({ kind: 'OWL_EYE', side: 'LEFT' });
    await race(page, 'PURE');
    await screen(page, 'CHR-025');
    await race(page, 'FREE');
    await screen(page, 'CHR-025');
    expect(
      host.checkpoint().finalizationStage!.state.branches.find((b) => b.raceCode === 'FREE'),
    ).toEqual(branch);
    await host.restart();
    await page.goto(host.baseURL);
    await screen(page, 'CHR-025');
    expect(
      host.checkpoint().finalizationStage!.state.branches.find((b) => b.raceCode === 'FREE'),
    ).toEqual(branch);
    assertUnchangedProperty(host, before);
  } finally {
    await host.close();
  }
});

test('manual dice random correction retains first result and locked side across FREE/UNITED cached branches', async ({
  page,
}) => {
  const host = await createCreationFinalizationBrowserHost({
    prefix: 'correction-random-e2e',
    race: 'PURE',
    mode: 'MANUAL',
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const before = host.checkpoint();
    await summary(page, host.baseURL);
    await race(page, 'FREE', 'RANDOM');
    await screen(page, 'CHR-020');
    const roll = async (face: number) => {
      await page.getByLabel('Результат d20', { exact: true }).fill(String(face));
      await page
        .getByRole('button', { name: 'Зафиксировать следующий бросок', exact: true })
        .click();
    };
    await roll(3);
    await page.getByLabel('Сторона Сова', { exact: true }).selectOption('LEFT');
    await page.getByRole('button', { name: 'Подтвердить стороны симбионтов', exact: true }).click();
    await screen(page, 'CHR-025');
    const free = host
      .checkpoint()
      .finalizationStage!.state.branches.find((b) => b.raceCode === 'FREE')!;
    expect(free.composition!.acceptedSpecies.map((s) => s.speciesKey)).toEqual(['OWL']);
    await race(page, 'UNITED');
    await screen(page, 'CHR-020');
    for (const face of [2, 4, 5]) {
      await roll(face);
      await expect
        .poll(
          () =>
            host
              .checkpoint()
              .finalizationStage!.state.branches.find((b) => b.raceCode === 'UNITED')!.physicalRolls
              .length,
        )
        .toBe([2, 4, 5].indexOf(face) + 1);
    }
    await expect(page.getByLabel('Сторона Сова', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Сторона Сова', { exact: true })).toHaveValue('LEFT');
    await page.getByRole('button', { name: 'Подтвердить стороны симбионтов', exact: true }).click();
    await screen(page, 'CHR-025');
    const united = host
      .checkpoint()
      .finalizationStage!.state.branches.find((b) => b.raceCode === 'UNITED')!;
    expect(united.composition!.acceptedSpecies.map((s) => s.speciesKey)).toEqual([
      'OWL',
      'TAIPAN',
      'TEACHER',
      'ARMADILLO',
    ]);
    expect(united.physicalRolls).toHaveLength(3);
    for (const value of ['FREE', 'UNITED', 'PURE', 'UNITED'] as const) {
      await race(page, value);
      await screen(page, 'CHR-025');
    }
    expect(
      host.checkpoint().finalizationStage!.state.branches.find((b) => b.raceCode === 'FREE'),
    ).toEqual(free);
    expect(
      host.checkpoint().finalizationStage!.state.branches.find((b) => b.raceCode === 'UNITED'),
    ).toEqual(united);
    await host.restart();
    await page.goto(host.baseURL);
    await screen(page, 'CHR-025');
    expect(
      host.checkpoint().finalizationStage!.state.branches.find((b) => b.raceCode === 'UNITED'),
    ).toEqual(united);
    assertUnchangedProperty(host, before);
    expect(errors).toEqual([]);
    expect(await page.locator('body').innerText()).not.toMatch(
      /CORE-\d|SYM-\d|availabilityTrace|masterPredicate/,
    );
  } finally {
    await host.close();
  }
});
