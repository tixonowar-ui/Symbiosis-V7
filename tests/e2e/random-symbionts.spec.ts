import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { createRandomSymbiontBrowserHost } from '../fixtures/random-symbiont-e2e.js';

const RANDOM_COMMIT_LABEL = 'Зафиксировать случайное определение симбионтов';

function clientFramesSent(page: Page): () => number {
  let count = 0;
  page.on('websocket', (socket) => {
    socket.on('framesent', () => {
      count += 1;
    });
  });
  return () => count;
}

async function expectNoExcludedActions(page: Page): Promise<void> {
  await expect(page.locator('[data-atlas-action-key^="CHR-021"]')).toHaveCount(0);
  await expect(page.getByText('CHR-021', { exact: true })).toHaveCount(0);
}

test.use({ channel: 'chrome' });
test.setTimeout(60_000);

test('FREE RANDOM Eel keeps side local, commits binding only, and restores CHR-019 on reload', async ({
  page,
}) => {
  const host = await createRandomSymbiontBrowserHost({
    diceInputMode: 'AUTO',
    prefix: 'browser-free-eel',
    raceChoice: 'FREE',
    sampleFaces: [15],
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const framesSent = clientFramesSent(page);
  try {
    await page.goto(host.baseURL);
    await expect(
      page.getByRole('heading', { name: 'Каталог симбионтов', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-symbiont-species="EEL"]')).toContainText('Угорь');
    await page
      .getByRole('button', { name: 'Начать сохранённую случайную ветвь', exact: true })
      .click();
    await expect(page.locator('[data-chr-020-random]')).toHaveAttribute(
      'data-random-status',
      'NOT_STARTED',
    );
    await page.getByRole('button', { name: RANDOM_COMMIT_LABEL, exact: true }).click();
    await expect(page.locator('[data-chr-020-random]')).toHaveAttribute(
      'data-random-status',
      'BINDING',
    );
    await expect(page.locator('[data-random-side-value]')).toHaveAttribute(
      'data-random-side-value',
      'RIGHT',
    );
    expect(host.sampleCalls()).toBe(1);
    const beforeBinding = {
      rollRequests: host.rollRequestAllocations(),
      samples: host.sampleCalls(),
      wire: framesSent(),
      stateRevision: await page
        .locator('[data-chr-020-random]')
        .getAttribute('data-state-revision'),
      projectionRevision: await page
        .locator('[data-chr-020-random]')
        .getAttribute('data-projection-revision'),
      draftRevision: await page
        .locator('[data-chr-020-random]')
        .getAttribute('data-draft-revision'),
    };

    await page.getByRole('combobox', { name: 'Сторона', exact: true }).selectOption('LEFT');
    await expect(page.locator('[data-random-side-value]')).toHaveAttribute(
      'data-random-side-value',
      'LEFT',
    );
    expect(framesSent()).toBe(beforeBinding.wire);
    await expect(page.locator('[data-chr-020-random]')).toHaveAttribute(
      'data-state-revision',
      beforeBinding.stateRevision!,
    );
    await expect(page.locator('[data-chr-020-random]')).toHaveAttribute(
      'data-projection-revision',
      beforeBinding.projectionRevision!,
    );
    await expect(page.locator('[data-chr-020-random]')).toHaveAttribute(
      'data-draft-revision',
      beforeBinding.draftRevision!,
    );

    await page.getByRole('button', { name: RANDOM_COMMIT_LABEL, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Состав симбионтов только для чтения', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-composition-binding="EEL"]')).toContainText('LEFT');
    expect(host.sampleCalls()).toBe(beforeBinding.samples);
    expect(host.rollRequestAllocations()).toBe(beforeBinding.rollRequests);
    await expect(
      page.locator('[data-symbiont-modifier-total] [data-stat-modifier-kind="NO_STAT_MODIFIERS"]'),
    ).toContainText('Нет');
    await expect(page.locator('[data-symbiont-interactions="empty"]')).toHaveCount(2);
    await expect(page.locator('[data-composition-duplicates="empty"]')).toBeVisible();
    await expectNoExcludedActions(page);
    await expect(page.getByRole('button')).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Состав симбионтов только для чтения', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-composition-binding="EEL"]')).toContainText('LEFT');
    await expect(page.getByRole('button')).toHaveCount(0);
    await expectNoExcludedActions(page);
    expect(host.sampleCalls()).toBe(beforeBinding.samples);
    expect(host.rollRequestAllocations()).toBe(beforeBinding.rollRequests);
    expect(pageErrors).toEqual([]);
  } finally {
    await host.close();
  }
});

async function commitManualRoll(
  page: Page,
  face: number,
  historyCount: number,
  status: 'PENDING' | 'BINDING',
): Promise<void> {
  const input = page.locator('[data-random-manual-face]');
  await input.fill(String(face));
  await expect(input).toHaveValue(String(face));
  await page.getByRole('button', { name: RANDOM_COMMIT_LABEL, exact: true }).click();
  await expect(page.locator('[data-random-physical-roll]')).toHaveCount(historyCount);
  await expect(page.locator('[data-random-current-status]')).toHaveText(status);
}

test('UNITED ADVISER completes I/W, local exact skills, checkpoint, and durable CHR-019', async ({
  page,
}) => {
  const host = await createRandomSymbiontBrowserHost({
    diceInputMode: 'MANUAL',
    prefix: 'browser-united-advisor',
    raceChoice: 'UNITED',
    sampleFaces: [],
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const framesSent = clientFramesSent(page);
  try {
    await page.goto(host.baseURL);
    await expect(
      page.getByRole('heading', { name: 'Каталог симбионтов', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Начать сохранённую случайную ветвь', exact: true })
      .click();
    await expect(page.locator('[data-chr-020-random]')).toHaveAttribute(
      'data-random-status',
      'NOT_STARTED',
    );
    const faces = [7, 9, 8, 8, 2, 2, 3] as const;
    for (const [index, face] of faces.entries()) {
      await commitManualRoll(
        page,
        face,
        index + 1,
        index === faces.length - 1 ? 'BINDING' : 'PENDING',
      );
    }
    expect(host.sampleCalls()).toBe(0);
    const beforeBinding = {
      rollRequests: host.rollRequestAllocations(),
      wire: framesSent(),
    };
    await page.getByRole('button', { name: RANDOM_COMMIT_LABEL, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Карточка Советника при создании', exact: true }),
    ).toBeVisible();
    expect(host.rollRequestAllocations()).toBe(beforeBinding.rollRequests);
    await expect(page.locator('[data-advisor-i-value]')).toHaveText('16');
    await expect(page.locator('[data-advisor-w-value]')).toHaveText('16');
    await expect(page.locator('[data-chr-041-advisor]')).toHaveAttribute(
      'data-advisor-effects-active',
      'false',
    );
    await expect(page.locator('[data-advisor-suppression-minimum-i]')).toHaveText('2');
    await expect(page.locator('[data-advisor-suppression-b]')).toHaveText('1');
    await expect(page.locator('[data-advisor-iw-roll="0"]')).toContainText('receipt');
    await expect(page.locator('[data-advisor-iw-roll="1"]')).toContainText('receipt');
    await expect(page.locator('[data-atlas-action-key="CHR-041::CTA::003"]')).toHaveCount(0);
    await expect(page.locator('[data-atlas-action-key="CHR-041::CTA::004"]')).toHaveCount(0);
    await expect(page.locator('[data-advisor-suppression-purpose]')).toContainText(
      'Будущий неснижаемый остаток интеллекта носителя',
    );
    const suppressionRollText = await page.locator('[data-advisor-suppression-roll]').textContent();
    const suppressionRollMatch = /request\s+([^;]+);\s*receipt\s+(.+)/u.exec(
      suppressionRollText ?? '',
    );
    if (
      suppressionRollMatch === null ||
      suppressionRollMatch[1] === undefined ||
      suppressionRollMatch[2] === undefined
    ) {
      throw new Error('missing separate future intelligence floor request/receipt');
    }
    const suppressionRequestId = suppressionRollMatch[1].trim();
    const suppressionReceiptId = suppressionRollMatch[2].trim();
    expect(suppressionRequestId).toMatch(
      /^browser-united-advisor-selection-command-browser-roll-request-\d+$/u,
    );
    expect(suppressionReceiptId).toMatch(
      /^browser-united-advisor-selection-command-browser-receipt-\d+$/u,
    );
    expect(suppressionRequestId).not.toBe(suppressionReceiptId);

    const beforeAdvisorRefresh = {
      receipts: host.receiptAllocations(),
      rollRequests: host.rollRequestAllocations(),
      samples: host.sampleCalls(),
    };
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Карточка Советника при создании', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-advisor-suppression-roll]')).toHaveText(
      suppressionRollText ?? '',
    );
    await expect(page.locator('[data-advisor-suppression-purpose]')).toContainText(
      'Будущий неснижаемый остаток интеллекта носителя',
    );
    await expect(page.locator('[data-atlas-action-key="CHR-041::CTA::004"]')).toHaveCount(0);
    expect(host.receiptAllocations()).toBe(beforeAdvisorRefresh.receipts);
    expect(host.rollRequestAllocations()).toBe(beforeAdvisorRefresh.rollRequests);
    expect(host.sampleCalls()).toBe(beforeAdvisorRefresh.samples);

    const beforeSkills = {
      draftRevision: await page
        .locator('[data-chr-041-advisor]')
        .getAttribute('data-draft-revision'),
      projectionRevision: await page
        .locator('[data-chr-041-advisor]')
        .getAttribute('data-projection-revision'),
      stateRevision: await page
        .locator('[data-chr-041-advisor]')
        .getAttribute('data-state-revision'),
      rollRequests: host.rollRequestAllocations(),
      wire: framesSent(),
    };
    const candidate = page.locator('[data-advisor-skill-candidate]');
    const target = page.locator('[data-advisor-target-bonus]');
    const toggleSkill = page.getByRole('button', {
      name: 'Добавить или удалить допустимый навык Советника',
      exact: true,
    });
    await candidate.selectOption('STEALTH');
    await target.selectOption('6');
    await toggleSkill.click();
    await expect(page.locator('[data-advisor-slot-usage]')).toContainText('7 / 8');
    await expect(page.locator('[data-advisor-selection-validation="UNDERFILLED"]')).toBeVisible();
    await expect(page.locator('[data-atlas-action-key="CHR-041::CTA::001"]')).toHaveCount(0);

    await candidate.selectOption('STEALTH');
    await toggleSkill.click();
    await expect(page.locator('[data-advisor-selected-skills="empty"]')).toBeVisible();
    await expect(page.locator('[data-advisor-slot-usage]')).toContainText('0 / 8');
    expect(framesSent()).toBe(beforeSkills.wire);

    await candidate.selectOption('STEALTH');
    await target.selectOption('6');
    await toggleSkill.click();
    await candidate.selectOption('THIEVERY');
    await target.selectOption('1');
    await toggleSkill.click();
    await expect(page.locator('[data-advisor-slot-usage]')).toContainText('8 / 8');
    await expect(page.locator('[data-advisor-selection-validation="EXACT"]')).toBeVisible();
    await expect(page.locator('[data-advisor-selected-skill="STEALTH"]')).toContainText('+6');
    await expect(page.locator('[data-advisor-selected-skill="THIEVERY"]')).toContainText('+1');
    expect(framesSent()).toBe(beforeSkills.wire);
    await expect(page.locator('[data-chr-041-advisor]')).toHaveAttribute(
      'data-draft-revision',
      beforeSkills.draftRevision!,
    );
    await expect(page.locator('[data-chr-041-advisor]')).toHaveAttribute(
      'data-projection-revision',
      beforeSkills.projectionRevision!,
    );
    await expect(page.locator('[data-chr-041-advisor]')).toHaveAttribute(
      'data-state-revision',
      beforeSkills.stateRevision!,
    );

    await page.getByRole('button', { name: 'Подтвердить навыки Советника', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Состав симбионтов только для чтения', exact: true }),
    ).toBeVisible();
    expect(host.rollRequestAllocations()).toBe(beforeSkills.rollRequests);
    expect(host.sampleCalls()).toBe(0);
    for (const species of ['TROGR', 'ADVISER', 'TAIPAN', 'OWL'] as const) {
      await expect(page.locator(`[data-symbiont-instance="${species}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-composition-slot-usage]')).toHaveText('4 / 4');
    await expect(
      page.locator(
        '[data-symbiont-modifier-species="ADVISER"] [data-symbiont-modifier-effect="INACTIVE"]',
      ),
    ).toBeVisible();
    await expect(page.locator('[data-symbiont-interactions="ready"]').first()).toBeVisible();
    await expectNoExcludedActions(page);
    await expect(page.getByRole('button')).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Состав симбионтов только для чтения', exact: true }),
    ).toBeVisible();
    for (const species of ['TROGR', 'ADVISER', 'TAIPAN', 'OWL'] as const) {
      await expect(page.locator(`[data-symbiont-instance="${species}"]`)).toBeVisible();
    }
    await expect(
      page.locator(
        '[data-symbiont-modifier-species="ADVISER"] [data-symbiont-modifier-effect="INACTIVE"]',
      ),
    ).toBeVisible();
    await expectNoExcludedActions(page);
    await expect(page.getByRole('button')).toHaveCount(0);
    expect(host.rollRequestAllocations()).toBe(beforeSkills.rollRequests);
    expect(host.sampleCalls()).toBe(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await host.close();
  }
});
