import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { createSkillCardBrowserHost } from '../fixtures/skill-card-e2e.js';

const REQUIRED_FIELDS = [
  'characterDraftId',
  'skillId',
  'requirements',
  'skillStageValues',
  'levelsAndBonuses',
  'slotCost',
  'freeSources',
  'eligibility',
  'selectionRevision',
] as const;
const FORBIDDEN_PLAYER_TEXT =
  /SKL-|CORE-|REQ-|Q-|BeforeSymbiontBonuses|availabilityTrace|SkillID|RequirementID|RequirementSetID/u;

interface ProjectionFrame {
  readonly messageType: 'projection.snapshot';
  readonly presentation: {
    readonly base: {
      readonly availableActionKeys: readonly string[];
      readonly formId: string;
      readonly roleFilteredPayload: Readonly<Record<string, unknown>>;
    };
  };
}

function projectionFrames(page: Page): () => readonly ProjectionFrame[] {
  const frames: ProjectionFrame[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => {
      const payload =
        typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
      const value = JSON.parse(payload) as unknown;
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>)['messageType'] === 'projection.snapshot'
      ) {
        frames.push(value as ProjectionFrame);
      }
    });
  });
  return () => frames;
}

async function expectSanitizedProjection(page: Page): Promise<void> {
  await expect(page.locator('[data-client-state="protocol-error"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(FORBIDDEN_PLAYER_TEXT);
}

test.use({ channel: 'chrome' });
test.setTimeout(60_000);

test('CHR-014 eligible card keeps explicit level, partial selection, reload, and restart durable', async ({
  page,
}) => {
  const host = await createSkillCardBrowserHost('browser-skill-card-eligible');
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(host.baseURL);
    await page.locator(`[data-skill-card-open="${host.eligibleSkillId}"]`).click();
    await expect(page.locator('[data-atlas-form-id="CHR-014"]')).toBeVisible();
    const card = page.locator(`[data-skill-card="${host.eligibleSkillId}"]`);
    await expect(card).toBeVisible();
    for (const field of REQUIRED_FIELDS) {
      await expect(page.locator(`[data-host-field="${field}"]`)).toHaveCount(1);
    }
    await expect(page.locator('[data-host-field="slotCost"]')).toHaveText('null');
    await expect(page.locator('[data-host-field="freeSources"]')).toContainText('NO_FREE_SOURCE');
    await expect(page.locator('[data-host-field="eligibility"]')).toHaveText('ELIGIBLE');
    await expect(page.locator('[data-host-field="selectionRevision"]')).toHaveText(
      String(host.checkpoint().receipt.result.draftRevision),
    );
    await expect(page.locator('[data-atlas-action-key="CHR-014::CTA::001"]')).toHaveCount(0);
    await expectSanitizedProjection(page);

    await page.reload();
    await expect(card).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/create/chr-014/${host.eligibleSkillId}$`, 'u'));
    await expect(page.locator('[data-atlas-action-key="CHR-014::CTA::001"]')).toHaveCount(0);
    expect(host.receiptAllocations()).toBe(0);

    await host.restart();
    await page.goto(host.baseURL);
    await expect(card).toBeVisible();
    await expect(page.locator('[data-host-field="skillId"]')).toHaveText(host.eligibleSkillId);
    expect(host.receiptAllocations()).toBe(0);

    const level = page.getByLabel('Целевой бонус', { exact: true });
    const signedOptions = level.locator('option:not([value=""])');
    const targetBonus = await signedOptions.last().getAttribute('value');
    if (targetBonus === null) throw new Error('host supplied no signed skill level');
    await level.selectOption(targetBonus);
    await expect(page.locator('[data-skill-card-slot-cost]')).toHaveText(/^[1-9]\d*$/u);
    await page.getByRole('button', { name: 'Добавить доступный навык', exact: true }).click();
    await expect(page.locator('[data-atlas-form-id="CHR-015"]')).toBeVisible();
    await expect(page.locator('[data-selection-checkpoint="PARTIAL"]')).toBeVisible();
    await expect(page.locator(`[data-selected-skill="${host.eligibleSkillId}"]`)).toBeVisible();
    await expect(page.locator('[data-skill-selection-controls]')).toBeVisible();
    await expect(page.locator('[data-skill-selection-checkpointed]')).toHaveCount(0);
    await expect(page.locator('[data-atlas-form-id="CHR-017"]')).toHaveCount(0);
    await expect(page.getByText('CHR-017', { exact: true })).toHaveCount(0);
    expect(host.receiptAllocations()).toBe(1);
    expect(host.checkpoint().skillPresentationStage?.formId).toBe('CHR-015');
    await expectSanitizedProjection(page);

    await page.reload();
    await expect(page.locator('[data-selection-checkpoint="PARTIAL"]')).toBeVisible();
    await expect(page.locator(`[data-selected-skill="${host.eligibleSkillId}"]`)).toBeVisible();
    expect(host.receiptAllocations()).toBe(1);

    await host.restart();
    await page.goto(host.baseURL);
    await expect(page.locator('[data-selection-checkpoint="PARTIAL"]')).toBeVisible();
    await expect(page.locator(`[data-selected-skill="${host.eligibleSkillId}"]`)).toBeVisible();
    await expect(page.locator('[data-skill-selection-controls]')).toBeVisible();
    await expect(page.locator('[data-atlas-form-id="CHR-017"]')).toHaveCount(0);
    expect(host.receiptAllocations()).toBe(1);
    await expectSanitizedProjection(page);
    expect(pageErrors).toEqual([]);
  } finally {
    await host.close();
  }
});

test('CHR-014 ineligible card stays read-only and safe-return preserves selection', async ({
  page,
}) => {
  const host = await createSkillCardBrowserHost('browser-skill-card-ineligible');
  const pageErrors: string[] = [];
  const frames = projectionFrames(page);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const initialDraftRevision = host.checkpoint().receipt.result.draftRevision;
    await page.goto(host.baseURL);
    await page.locator(`[data-skill-card-open="${host.ineligibleSkillId}"]`).click();
    await expect(page.locator('[data-atlas-form-id="CHR-014"]')).toBeVisible();
    await expect(
      page.locator('section[data-skill-card-eligibility="INELIGIBLE_READ_ONLY"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-skill-card-requirement-satisfied="false"]').first(),
    ).toContainText('Нет');
    await expect(page.locator('[data-atlas-action-key="CHR-014::CTA::001"]')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Добавить доступный навык', exact: true }),
    ).toHaveCount(0);
    const cardFrame = frames().at(-1);
    expect(cardFrame?.presentation.base.formId).toBe('CHR-014');
    expect(cardFrame?.presentation.base.availableActionKeys).toEqual(['CHR-014::CTA::002']);
    expect(cardFrame?.presentation.base.roleFilteredPayload['eligibility']).toBe(
      'INELIGIBLE_READ_ONLY',
    );
    expect(host.checkpoint().skillSelectionStage).toBeNull();
    expect(host.receiptAllocations()).toBe(0);
    await expectSanitizedProjection(page);

    await page.getByRole('button', { name: 'Вернуться в каталог навыков', exact: true }).click();
    await expect(page.locator('[data-atlas-form-id="CHR-013"]')).toBeVisible();
    expect(host.checkpoint().skillSelectionStage).toBeNull();
    expect(host.checkpoint().receipt.result.draftRevision).toBe(initialDraftRevision);
    expect(host.receiptAllocations()).toBe(0);

    await host.restart();
    await page.goto(host.baseURL);
    await expect(page.locator('[data-atlas-form-id="CHR-013"]')).toBeVisible();
    expect(host.checkpoint().skillSelectionStage).toBeNull();
    expect(host.checkpoint().receipt.result.draftRevision).toBe(initialDraftRevision);
    expect(host.receiptAllocations()).toBe(0);
    await expectSanitizedProjection(page);
    expect(pageErrors).toEqual([]);
  } finally {
    await host.close();
  }
});
