import { expect, type Page } from '@playwright/test';

export const NPC_TEST_MASTER_SECRET = 'Npc-browser-test-secret-187';

export const npcForm = (page: Page, id: string) => page.locator(`[data-atlas-form-id="${id}"]`);
export async function npcAction(page: Page, key: string, destination: string, timeoutMs = 15_000) {
  await page.locator(`[data-atlas-action-key="${key}"]`).click();
  await expect(npcForm(page, destination)).toBeVisible({ timeout: timeoutMs });
}
export async function confirmNpcInput(page: Page) {
  await page.getByRole('button', { name: 'Подтвердить ввод', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Локальный ввод НПС', exact: true })).toHaveCount(
    0,
    { timeout: 15_000 },
  );
}

/** Creates the campaign through production controls, with no PC, admission or Start. */
export async function enterNpcLibrary(page: Page, baseURL: string) {
  await page.goto(baseURL);
  await npcAction(page, 'APP-001::CTA::002', 'APP-011');
  await npcAction(page, 'APP-011::CTA::006', 'CMP-001');
  await page.getByLabel('Название кампании', { exact: true }).fill('Библиотека до Start');
  await page.getByLabel('Описание кампании', { exact: true }).fill('Постоянные НПС без сцены.');
  await npcAction(page, 'CMP-001::CTA::001', 'CMP-002');
  await page.getByLabel('Вместимость активных персонажей', { exact: true }).fill('3');
  const loopback = page
    .getByLabel('Сетевой интерфейс', { exact: true })
    .locator('option')
    .filter({ hasText: '127.0.0.1' });
  await expect(loopback).toHaveCount(1);
  await page
    .getByLabel('Сетевой интерфейс', { exact: true })
    .selectOption(await loopback.getAttribute('value'));
  await page.getByLabel('Порт хоста', { exact: true }).fill(new URL(baseURL).port);
  await npcAction(page, 'CMP-002::CTA::002', 'CMP-003');
  const secret = NPC_TEST_MASTER_SECRET;
  await page.getByLabel('Секрет передачи мастера', { exact: true }).fill(secret);
  await page.getByLabel('Подтверждение секрета', { exact: true }).fill(secret);
  await expect(page.getByLabel('Секрет передачи мастера', { exact: true })).toHaveValue('');
  await npcAction(page, 'CMP-003::CTA::002', 'CMP-004');
  await page.getByLabel('Режим будущих бросков', { exact: true }).selectOption('MANUAL');
  await npcAction(page, 'CMP-004::CTA::002', 'CMP-005');
  await expect(page.getByLabel('Итоговая проверка кампании', { exact: true })).toContainText(
    'Активных персонажей: 0',
  );
  await npcAction(page, 'CMP-005::CTA::001', 'CMP-006');
  await npcAction(page, 'CMP-006::CTA::001', 'CMP-007');
  await npcAction(page, 'CMP-007::CTA::004', 'GM-001');
  await npcAction(page, 'GM-001::CTA::004', 'NPC-001');
  await expect(
    page.getByText('В кампании пока нет сохранённых НПС.', { exact: true }),
  ).toBeVisible();
}

/** Same explicit PURE/SEEKER input as the source-backed npc-clean-humanoid fixture. */
export async function fillOrdinaryNpc(page: Page, name: string) {
  await npcAction(page, 'NPC-001::CTA::001', 'NPC-002');
  await page.getByRole('button', { name: 'Убрать изображение', exact: true }).click();
  await expect(page.getByLabel('Имя НПС', { exact: true })).toBeEnabled();
  await page.getByLabel('Имя НПС', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Без описания', exact: true }).click();
  await page.getByLabel('Принадлежность', { exact: true }).fill('Нейтральный');
  await page.getByLabel('Роль в кампании', { exact: true }).fill('Свидетель');
  await page.getByLabel('Пол НПС', { exact: true }).selectOption({ label: 'Мужской' });
  await page.getByLabel('Масса НПС, кг', { exact: true }).fill('75');
  await confirmNpcInput(page);
  await npcAction(page, 'NPC-002::CTA::002', 'NPC-011');
  await page.getByLabel('Раса НПС', { exact: true }).selectOption({ label: 'Чистый' });
  // The class catalogue belongs to the confirmed race, so first persist that choice.
  await confirmNpcInput(page);
  await page.getByLabel('Класс НПС', { exact: true }).selectOption({ label: 'Искатель' });
  await page
    .getByLabel('Анатомия НПС', { exact: true })
    .selectOption({ label: 'Стандартная гуманоидная анатомия' });
  await confirmNpcInput(page);
  await npcAction(page, 'NPC-011::CTA::003', 'NPC-012');
  for (const label of ['Сила', 'Ловкость', 'Метаболизм', 'Здоровье', 'Интеллект', 'Харизма'])
    await page.getByLabel(label, { exact: true }).fill('10');
  await page.getByLabel('Мудрость', { exact: true }).fill('2');
  await confirmNpcInput(page);
  await npcAction(page, 'NPC-012::CTA::003', 'NPC-013');
  await page.getByRole('button', { name: 'Без симбионтов', exact: true }).click();
  await confirmNpcInput(page);
  await npcAction(page, 'NPC-013::CTA::003', 'NPC-014');
  await page.getByRole('button', { name: 'Без выбранных навыков', exact: true }).click();
  await confirmNpcInput(page);
  await npcAction(page, 'NPC-014::CTA::003', 'NPC-015');
  await page.getByRole('button', { name: 'Без предметов', exact: true }).click();
  await confirmNpcInput(page);
  await npcAction(page, 'NPC-015::CTA::003', 'NPC-016');
  await page.getByLabel('Текущие HP', { exact: true }).fill('70');
  for (const label of [
    'Подготовленные эффекты',
    'Подготовленные травмы',
    'Подготовленные раны',
    'Подготовленные особые состояния',
  ])
    await page.getByRole('button', { name: `Не выбирать: ${label}`, exact: true }).click();
  await page
    .getByLabel('Подготовленное последствие смерти', { exact: true })
    .selectOption({ label: 'Нет' });
  await confirmNpcInput(page);
  // ADR0085 requires a real explicit life assignment, including a living NPC.
  await expect(page.getByLabel('Исходное жизненное состояние', { exact: true })).toHaveValue('');
  await page
    .getByLabel('Исходное жизненное состояние', { exact: true })
    .selectOption({ label: 'Жив' });
  await page
    .getByLabel('Причина жизненного состояния', { exact: true })
    .fill('Исходное живое состояние NPC');
  await page.getByRole('button', { name: 'Подтвердить жизненное состояние', exact: true }).click();
  await npcAction(page, 'NPC-016::CTA::003', 'NPC-017');
  await expect(
    page.getByRole('region', { name: 'Предпросмотр полного листа', exact: true }),
  ).toContainText(name);
}

export async function advanceRetainedNpc(page: Page) {
  for (const [source, target] of [
    ['NPC-002', 'NPC-011'],
    ['NPC-011', 'NPC-012'],
    ['NPC-012', 'NPC-013'],
    ['NPC-013', 'NPC-014'],
    ['NPC-014', 'NPC-015'],
    ['NPC-015', 'NPC-016'],
  ] as const)
    await npcAction(page, `${source}::CTA::${source === 'NPC-002' ? '002' : '003'}`, target);
}
