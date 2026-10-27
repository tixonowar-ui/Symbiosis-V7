import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  createManualSymbiontBrowserHost,
  type ManualSymbiontBrowserHost,
} from '../fixtures/manual-symbiont-e2e.js';

const ADD = 'CHR-018::CTA::001';
const RETURN_CARD = 'CHR-018::CTA::002';
const OPEN_SUMMARY = 'CHR-017::CTA::002';
const RETURN_CATALOG = 'CHR-019::CTA::004';
const OPEN_PREVIEW = 'CHR-019::CTA::002';
const RETURN_SUMMARY = 'CHR-042::CTA::002';
const ADVISOR_SKILLS = 'CHR-041::CTA::001';
const TOGGLE_ADVISOR_SKILL = 'CHR-041::CTA::002';
const ADVISOR_B = 'CHR-041::CTA::004';

function clientFramesSent(page: Page): () => number {
  let count = 0;
  page.on('websocket', (socket) => {
    socket.on('framesent', () => {
      count += 1;
    });
  });
  return () => count;
}

async function clickAction(page: Page, actionKey: string): Promise<void> {
  await page.locator(`[data-atlas-action-key="${actionKey}"]`).click();
}

async function expectHealthy(page: Page, pageErrors: readonly string[]): Promise<void> {
  await expect(page.locator('[data-client-state="protocol-error"]')).toHaveCount(0);
  await expect(page.locator('[data-atlas-action-key^="CHR-021"]')).toHaveCount(0);
  await expect(page.locator('[data-atlas-action-key="CHR-042::CTA::001"]')).toHaveCount(0);
  await expect(page.locator('[data-atlas-action-key="CHR-018::CTA::003"]')).toHaveCount(0);
  await expect(page.locator('[data-atlas-action-key="CHR-041::CTA::003"]')).toHaveCount(0);
  const text = await page.locator('body').textContent();
  for (const forbidden of [
    'ProfileRuleID',
    'ModifierID',
    'Rule IDs',
    'Источник',
    'sourceQuestionIds',
    'availabilityTrace',
    'randomSequenceId',
    'CHR-021',
  ]) {
    expect(text).not.toContain(forbidden);
  }
  for (const control of await page.locator('input, select').all()) {
    expect(
      await control.evaluate((element: unknown) => {
        if (typeof element !== 'object' || element === null) {
          throw new Error('expected a native form control');
        }
        const count = (element as { readonly labels?: { readonly length?: unknown } | null }).labels
          ?.length;
        if (typeof count !== 'number') throw new Error('form control has no associated label');
        return count;
      }),
    ).toBeGreaterThan(0);
  }
  for (const button of await page.locator('button').all()) {
    expect((await button.textContent())?.trim().length).toBeGreaterThan(0);
  }
  expect(pageErrors).toEqual([]);
}

async function openCard(page: Page, speciesKey: string): Promise<void> {
  await page.locator(`[data-manual-open-species="${speciesKey}"]`).click();
  await expect(page.locator('[data-manual-form="CHR-018"]')).toBeVisible();
  await expect(page.locator('[data-manual-art]')).toHaveAttribute(
    'alt',
    `Арт симбионта ${speciesKey}`,
  );
  await expect(page.locator('[data-manual-tree]')).toHaveAttribute(
    'alt',
    `Дерево развития симбионта ${speciesKey}`,
  );
  for (const image of await page.locator('[data-manual-art], [data-manual-tree]').all()) {
    await expect
      .poll(() =>
        image.evaluate((element: unknown) => {
          if (typeof element !== 'object' || element === null) throw new Error('expected an image');
          const width = (element as { readonly naturalWidth?: unknown }).naturalWidth;
          if (typeof width !== 'number') throw new Error('image has no intrinsic width');
          return width;
        }),
      )
      .toBeGreaterThan(0);
  }
}

async function includeCurrent(page: Page): Promise<void> {
  await page.locator('#manual-include-current').check();
}

async function returnToCatalog(page: Page): Promise<void> {
  await clickAction(page, RETURN_CARD);
  await expect(page.locator('[data-manual-form="CHR-017"]')).toBeVisible();
}

async function selectAdvisorComposition(page: Page, first: 'ADVISER' | 'TROGR'): Promise<void> {
  const rest = first === 'ADVISER' ? ['TAIPAN', 'WEAVER', 'OWL'] : ['ADVISER', 'TAIPAN', 'OWL'];
  const species = [first, ...rest];
  for (const [index, key] of species.entries()) {
    await openCard(page, key);
    await includeCurrent(page);
    if (index === species.length - 1) {
      await clickAction(page, ADD);
      await expect(page.locator('[data-advisor-iw-pending]')).toBeVisible();
    } else {
      await returnToCatalog(page);
    }
  }
}

async function selectExactAdvisorSkills(
  page: Page,
  host: ManualSymbiontBrowserHost,
): Promise<void> {
  for (const selected of host.advisorSkills()) {
    await page.locator('[data-advisor-skill-candidate]').selectOption(selected.skillId);
    await page.locator('[data-advisor-target-bonus]').selectOption(String(selected.targetBonus));
    await clickAction(page, TOGGLE_ADVISOR_SKILL);
    await expect(page.locator(`[data-advisor-selected-skill="${selected.skillId}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-advisor-selection-validation="EXACT"]')).toBeVisible();
}

test.use({ channel: 'chrome' });
test.setTimeout(60_000);

test('FREE manual composition loads media, replaces a species and restores host baseline', async ({
  page,
}) => {
  const host = await createManualSymbiontBrowserHost({
    diceInputMode: 'MANUAL',
    prefix: 'browser-manual-free',
    raceChoice: 'FREE',
    sampleFaces: [],
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const framesSent = clientFramesSent(page);
  try {
    await page.goto(host.baseURL);
    await expect(page.locator('[data-manual-form="CHR-017"]')).toBeVisible();
    await page.locator('[data-manual-open-species="EEL"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-manual-form="CHR-018"]')).toBeVisible();
    for (const image of await page.locator('[data-manual-art], [data-manual-tree]').all()) {
      await expect
        .poll(() =>
          image.evaluate((element: unknown) => {
            if (typeof element !== 'object' || element === null)
              throw new Error('expected an image');
            const width = (element as { readonly naturalWidth?: unknown }).naturalWidth;
            if (typeof width !== 'number') throw new Error('image has no intrinsic width');
            return width;
          }),
        )
        .toBeGreaterThan(0);
    }
    await expect(page.locator('#manual-binding-right')).toBeChecked();
    await page.locator('#manual-binding-left').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#manual-binding-left')).toBeChecked();
    await includeCurrent(page);
    await clickAction(page, ADD);
    await expect(page.locator('[data-chr-019-composition]')).toBeVisible();
    await expect(page.locator('[data-composition-binding="EEL"]')).toContainText('LEFT');
    expect(host.sampleCalls()).toBe(0);

    await clickAction(page, RETURN_CATALOG);
    await openCard(page, 'EEL');
    await expect(page.locator('[data-manual-compatibility]')).toHaveText('DUPLICATE');
    await expect(page.locator('#manual-include-current')).toHaveCount(0);
    await expect(page.locator('[data-atlas-action-key="CHR-018::CTA::001"]')).toHaveCount(0);
    await returnToCatalog(page);
    const wireBeforeRemoval = framesSent();
    await page.locator('[data-manual-remove="EEL"]').click();
    await expect(page.locator('[data-manual-draft-empty]')).toBeVisible();
    expect(framesSent()).toBe(wireBeforeRemoval);
    await openCard(page, 'OWL');
    await includeCurrent(page);
    await clickAction(page, ADD);
    await expect(page.locator('[data-symbiont-instance="OWL"]')).toBeVisible();
    await expect(page.locator('[data-symbiont-instance="EEL"]')).toHaveCount(0);

    await clickAction(page, RETURN_CATALOG);
    await page.locator('[data-manual-remove="OWL"]').click();
    await clickAction(page, OPEN_SUMMARY);
    await expect(page.locator('[data-manual-draft-empty]')).toBeVisible();
    await expect(page.locator('[data-symbiont-instance="OWL"]')).toBeVisible();
    const receipts = host.receiptAllocations();
    await page.reload();
    await expect(page.locator('[data-manual-draft-entry="OWL"]')).toBeVisible();
    await host.restart();
    await page.goto(host.baseURL);
    await expect(page.locator('[data-manual-draft-entry="OWL"]')).toBeVisible();
    expect(host.receiptAllocations()).toBe(receipts);
    expect(host.rollRequestAllocations()).toBe(0);
    expect(host.sampleCalls()).toBe(0);
    await expectHealthy(page, pageErrors);
  } finally {
    await host.close();
  }
});

test('UNITED manual Advisor uses exactly two AUTO I/W samples and exact skills', async ({
  page,
}) => {
  const host = await createManualSymbiontBrowserHost({
    diceInputMode: 'AUTO',
    prefix: 'browser-manual-advisor-auto',
    raceChoice: 'UNITED',
    sampleFaces: [3, 5],
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(host.baseURL);
    await selectAdvisorComposition(page, 'ADVISER');
    expect(host.sampleCalls()).toBe(0);
    await expect(page.locator('[data-advisor-skill-options]')).toHaveCount(0);
    await expect(page.locator('[data-advisor-slot-usage]')).toHaveCount(0);
    await page.locator('[data-manual-iw-submit]').click();
    await expect(page.locator('[data-advisor-i-value]')).toHaveText('11');
    await expect(page.locator('[data-advisor-w-value]')).toHaveText('13');
    expect(host.sampleCalls()).toBe(2);
    const beforeSkills = host.advisorRollIds();
    await selectExactAdvisorSkills(page, host);
    await clickAction(page, ADVISOR_SKILLS);
    await expect(page.locator('[data-chr-019-composition]')).toBeVisible();
    await expect(page.locator('[data-symbiont-instance="ADVISER"]')).toBeVisible();
    expect(host.sampleCalls()).toBe(2);
    await page.reload();
    await expect(page.locator('[data-chr-019-composition]')).toBeVisible();
    expect(host.advisorRollIds()).toEqual(beforeSkills);
    expect(host.sampleCalls()).toBe(2);
    await expectHealthy(page, pageErrors);
  } finally {
    await host.close();
  }
});

test('UNITED TROGR and ADVISER keeps separate MANUAL B, preview and restart', async ({ page }) => {
  const host = await createManualSymbiontBrowserHost({
    diceInputMode: 'MANUAL',
    prefix: 'browser-manual-trogr-advisor',
    raceChoice: 'UNITED',
    sampleFaces: [],
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(host.baseURL);
    await selectAdvisorComposition(page, 'TROGR');
    await page.locator('[data-manual-iw-face="I"]').fill('8');
    await page.locator('[data-manual-iw-face="W"]').fill('9');
    await page.locator('[data-manual-iw-submit]').click();
    await expect(page.locator('[data-advisor-suppression-roll-draft]')).toBeVisible();
    await expect(page.locator('[data-advisor-selection-controls]')).toHaveCount(0);
    await page.locator('[data-advisor-suppression-manual-face]').fill('2');
    await clickAction(page, ADVISOR_B);
    await expect(page.locator('[data-advisor-suppression-b]')).toHaveText('1');
    await expect(page.locator('[data-advisor-suppression-minimum-i]')).toHaveText('2');
    await expect(page.locator('[data-advisor-suppression-purpose]')).toContainText(
      'Будущий неснижаемый остаток интеллекта носителя',
    );
    expect(host.sampleCalls()).toBe(0);
    const rollIds = host.advisorRollIds();
    await selectExactAdvisorSkills(page, host);
    await clickAction(page, ADVISOR_SKILLS);
    await expect(page.locator('[data-chr-019-composition]')).toBeVisible();

    await clickAction(page, RETURN_CATALOG);
    await page.locator('[data-manual-remove="OWL"]').click();
    await openCard(page, 'TEACHER');
    await includeCurrent(page);
    await clickAction(page, ADD);
    await expect(page.locator('[data-symbiont-instance="TEACHER"]')).toBeVisible();
    const beforePreview = {
      draft: await page.locator('[data-chr-019-composition]').getAttribute('data-draft-revision'),
      state: await page.locator('[data-chr-019-composition]').getAttribute('data-state-revision'),
    };
    await clickAction(page, OPEN_PREVIEW);
    await expect(page.locator('[data-preview-status]')).toHaveText('PREVIEW');
    await expect(page.locator('[data-preview-operation="ABSORPTION"]')).toBeVisible();
    await expect(page.locator('[data-preview-operation="SPECIES_SUPPRESSION"]')).toBeVisible();
    await expect(page.locator('[data-preview-diff="TEACHER"]')).toContainText('ABSORBED');
    await expect(page.locator('section[aria-label="Состав до"]')).toContainText('OWL');
    await expect(page.locator('section[aria-label="Состав после"]')).toContainText('TEACHER');
    await clickAction(page, RETURN_SUMMARY);
    await expect(page.locator('[data-chr-019-composition]')).toBeVisible();
    const afterReturn = {
      draft: await page.locator('[data-chr-019-composition]').getAttribute('data-draft-revision'),
      state: await page.locator('[data-chr-019-composition]').getAttribute('data-state-revision'),
    };
    expect(afterReturn).toEqual(beforePreview);
    const receipts = host.receiptAllocations();
    const rollRequests = host.rollRequestAllocations();
    await page.reload();
    await expect(page.locator('[data-chr-019-composition]')).toBeVisible();
    await host.restart();
    await page.goto(host.baseURL);
    await expect(page.locator('[data-chr-019-composition]')).toBeVisible();
    expect(host.advisorRollIds()).toEqual(rollIds);
    expect(host.receiptAllocations()).toBe(receipts);
    expect(host.rollRequestAllocations()).toBe(rollRequests);
    expect(host.sampleCalls()).toBe(0);
    await expectHealthy(page, pageErrors);
  } finally {
    await host.close();
  }
});
