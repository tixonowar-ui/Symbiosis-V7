import { expect, type Page } from '@playwright/test';

async function action(page: Page, key: string): Promise<void> {
  const control = page.locator(`[data-atlas-action-key="${key}"]`);
  const protocolError = page.getByRole('heading', { name: 'Ошибка wire-протокола', exact: true });
  await control.or(protocolError).first().waitFor({ state: 'visible' });
  if (await protocolError.isVisible())
    throw Error(
      'Wizard protocol refusal before ' +
        key +
        ': ' +
        (await protocolError.locator('..').locator('p').first().innerText()),
    );
  await control.click();
}

async function fillStartingSkills(page: Page): Promise<void> {
  const usage = page.locator('[data-skill-slot-usage]');
  const candidates = page.locator('[data-skill-candidate]');
  await expect(candidates).toBeVisible();
  const skillOptions = await candidates.locator('option').all();
  const skills = await Promise.all(skillOptions.map((option) => option.getAttribute('value')));
  for (const skill of skills) {
    if (!skill) continue;
    const counts = /([0-9]+)\s*\/\s*([0-9]+)/u.exec(await usage.innerText());
    if (!counts) throw new Error('Missing paid skill slot count at CHR-015');
    const remaining = Number(counts[2]) - Number(counts[1]);
    if (remaining === 0) break;
    await candidates.selectOption(skill);
    const levels = page.locator('[data-skill-target-bonus]');
    const rows = await levels.locator('option').all();
    const options = await Promise.all(
      rows.map(async (row) => ({
        value: (await row.getAttribute('value')) ?? '',
        cost: Number(/([0-9]+) сл\./u.exec(await row.innerText())?.[1]),
      })),
    );
    const level = options
      .filter((row) => row.cost > 0 && row.cost <= remaining)
      .sort((left, right) => right.cost - left.cost)[0];
    if (!level) continue;
    await levels.selectOption(level.value);
    await action(page, 'CHR-015::CTA::003');
    await expect(page.locator(`[data-selected-skill="${skill}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-skill-selection-validation]')).toHaveAttribute(
    'data-skill-selection-validation',
    'EXACT',
  );
  await action(page, 'CHR-015::CTA::001');
}

/** Use the same physical-dice inputs as the owning wizard fixture on a newly ACKed profile. */
export async function createFreshBrowserFinal(page: Page, name: string): Promise<void> {
  await action(page, 'APP-004::CTA::001');
  await page.locator('[data-identity-field="name"]').fill(name);
  await page.locator('[data-identity-field="age"]').fill('31');
  await page.locator('[data-identity-field="massKg"]').fill('75');
  await page.locator('[data-identity-field="sex"]').selectOption('FEMALE');
  await action(page, 'CHR-001::CTA::001');
  await action(page, 'CHR-010::CTA::006');
  await action(page, 'CHR-010::CTA::002');
  await action(page, 'CHR-036::CTA::005');
  await action(page, 'CHR-036::CTA::001');
  await action(page, 'CHR-002::CTA::003');
  await action(page, 'CHR-002::CTA::001');
  const stats = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'];
  for (const [index] of stats.entries()) {
    await page.locator(`[data-stat-roll-input="${String(index)}"]`).fill('19');
  }
  await action(page, 'CHR-003::CTA::002');
  await action(page, 'CHR-005::CTA::001');
  for (const [index, stat] of stats.entries()) {
    await page.locator(`[data-stat-assignment="${stat}"]`).selectOption(String(index));
  }
  await action(page, 'CHR-009::CTA::001');
  await action(page, 'CHR-011::CTA::003');
  await action(page, 'CHR-011::CTA::001');
  await action(page, 'CHR-012::CTA::001');
  await action(page, 'CHR-013::CTA::002');
  await fillStartingSkills(page);
  await action(page, 'CHR-017::CTA::004');

  const button = (label: string) => page.getByRole('button', { name: label, exact: true });
  await button('Добавить Кожаный доспех').click();
  await page.locator('#armor-quality-face').fill('16');
  await button('Зафиксировать один бросок качества').click();
  await action(page, 'CHR-021::CTA::001');
  await page.getByRole('radio', { name: /Кенси/u }).check();
  await page.locator('#weapon-quality-face').fill('19');
  await button('Зафиксировать один бросок качества оружия').click();
  await action(page, 'CHR-022::CTA::002');
  await action(page, 'CHR-024::CTA::001');
  await page.locator('#starting-money-face').fill('15');
  await button('Зафиксировать бросок рекомендации денег').click();
  await action(page, 'CHR-038::CTA::001');
  for (let index = 1; index <= 5; index++) {
    await page
      .locator(`#starting-position-${String(index)}-type`)
      .selectOption(index === 5 ? 'GEN-010' : 'RES-AMM-002');
    await page
      .locator(`#starting-position-${String(index)}-quantity`)
      .fill(index === 5 ? '3' : String(index + 1));
  }
  await page.locator('#starting-position-5-description').fill('Три памятных камня');
  for (let index = 1; index <= 5; index++) {
    await page
      .getByRole('radio', { name: `Бросить за позицию ${String(index)}`, exact: true })
      .check();
    await page.locator('#starting-position-face').fill('15');
    await button('Зафиксировать бросок качества выбранной позиции').click();
    await expect(
      page.getByRole('group', { name: `Позиция ${String(index)}`, exact: true }),
    ).toContainText('Позиция зафиксирована.');
  }
  await action(page, 'CHR-037::CTA::001');
  await action(page, 'CHR-032::CTA::001');
  await action(page, 'CHR-025::CTA::007');
  await expect(page.locator('[data-atlas-form-id="CHR-040"]')).toBeVisible();
}
