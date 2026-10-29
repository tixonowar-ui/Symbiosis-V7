import { expect, test, type Page } from '@playwright/test';
import { createServer, type AddressInfo } from 'node:net';
import jsQR from 'jsqr';
import type { QRCode } from 'jsqr';
import { createCampaignBrowserHost } from '../fixtures/campaign-creation-e2e.js';

test.use({ channel: 'chrome' });
const action = (page: Page, key: string) =>
  page.locator(`[data-atlas-action-key="${key}"]`).click();
const form = (page: Page, id: string) => page.locator(`[data-atlas-form-id="${id}"]`);
const SECRET = 'Campaign-test-secret-170';
const decodeQr = jsQR as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => QRCode | null;
async function launch(page: Page, baseURL: string) {
  await page.goto(baseURL);
  await action(page, 'APP-001::CTA::002');
  await expect(form(page, 'APP-011')).toBeVisible();
  await action(page, 'APP-011::CTA::006');
  await expect(form(page, 'CMP-001')).toBeVisible();
}
async function coldMasterPage(previous: Page, baseURL: string, targetForm: string): Promise<Page> {
  const fresh = await previous.context().newPage();
  await previous.close();
  await fresh.goto(baseURL);
  expect(
    await fresh.evaluate(() => sessionStorage.getItem('symbiosis.gm-local-context.v1')),
  ).toBeNull();
  await action(fresh, 'APP-001::CTA::002');
  await expect(form(fresh, targetForm)).toBeVisible();
  return fresh;
}
async function metadataAndHost(page: Page, baseURL: string, title: string, withArt = false) {
  await page.getByLabel('Название кампании', { exact: true }).fill(title);
  await page
    .getByLabel('Описание кампании', { exact: true })
    .fill('Локальная кампания без активных персонажей.');
  if (withArt) {
    await page.getByLabel('Изображение кампании PNG или JPEG', { exact: true }).setInputFiles({
      name: 'campaign.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await expect(
      page.getByRole('img', { name: 'Изображение кампании', exact: true }),
    ).toBeVisible();
  }
  await action(page, 'CMP-001::CTA::001');
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
  await action(page, 'CMP-002::CTA::002');
  await expect(form(page, 'CMP-003')).toBeVisible();
}
async function configureSecret(page: Page) {
  await page.getByLabel('Секрет передачи мастера', { exact: true }).fill(SECRET);
  await page.getByLabel('Подтверждение секрета', { exact: true }).fill(SECRET);
  await expect(page.getByLabel('Секрет передачи мастера', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Подтверждение секрета', { exact: true })).toHaveValue('');
  await expect(page.locator('[data-atlas-action-key="CMP-003::CTA::002"]')).toBeVisible();
}
async function finish(page: Page, mode: 'MANUAL' | 'AUTO') {
  await action(page, 'CMP-003::CTA::002');
  await page.getByLabel('Режим будущих бросков', { exact: true }).selectOption(mode);
  await action(page, 'CMP-004::CTA::002');
  await expect(page.getByLabel('Итоговая проверка кампании', { exact: true })).toContainText(
    'Активных персонажей: 0',
  );
  await action(page, 'CMP-005::CTA::001');
  await expect(form(page, 'CMP-006')).toBeVisible();
  await expect(page.locator('[data-atlas-action-key^="CMP-006"]')).toHaveCount(0);
}

test('CMP creates one paused MANUAL campaign, exposes a real QR, replays CREATE and recovers the same receipt after SQLite reopen', async ({
  page,
}) => {
  const host = await createCampaignBrowserHost();
  const errors: string[] = [];
  const sent: { raw: string; value: Record<string, unknown> }[] = [],
    received: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => {
      const raw = String(payload);
      sent.push({ raw, value: JSON.parse(raw) as Record<string, unknown> });
    });
    ws.on('framereceived', ({ payload }) => received.push(String(payload)));
  });
  try {
    await launch(page, host.baseURL);
    await metadataAndHost(page, host.baseURL, 'Пауза и восстановление', true);
    expect(host.campaigns()).toHaveLength(0);
    await configureSecret(page);
    await finish(page, 'MANUAL');
    const rows = host.campaigns(),
      checkpoint = host.checkpoint(),
      commands = host.committedCommands();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lifecycle_state).toBe('PAUSED');
    expect(commands).toHaveLength(1);
    const stored = JSON.parse(rows[0]!.payload_json) as Record<string, unknown>;
    const qr = await page
      .getByRole('img', { name: 'QR подключения к кампании', exact: true })
      .evaluate((element) => {
        const svg = element as unknown as {
          getAttribute(name: string): string | null;
          querySelectorAll(
            selector: string,
          ): Iterable<{ getAttribute(name: string): string | null }>;
        };
        return {
          side: Number(svg.getAttribute('viewBox')!.split(' ')[2]),
          modules: [...svg.querySelectorAll('rect[fill="#000"]')].map(
            (rect) => [Number(rect.getAttribute('x')), Number(rect.getAttribute('y'))] as const,
          ),
        };
      });
    const scale = 4,
      width = qr.side * scale,
      pixels = new Uint8ClampedArray(width * width * 4).fill(255);
    for (const [x, y] of qr.modules)
      for (let row = y * scale; row < (y + 1) * scale; row++)
        for (let column = x * scale; column < (x + 1) * scale; column++) {
          const offset = 4 * (row * width + column);
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
        }
    expect(decodeQr(pixels, width, width)?.data).toBe(stored['qrPayload']);
    expect(received.join('\n')).not.toContain(SECRET);
    expect(host.containsPlaintext(SECRET)).toBe(false);
    expect(await page.locator('body').innerText()).not.toMatch(
      /verifier|masterTransferPassword|gmLocalContextId|CORE-\d+|RequiredFields/u,
    );
    const resume = sent.find((f) => f.value['messageType'] === 'campaign.local-context.resume')!;
    const create = sent.find((f) => f.value['workflowCommandId'] === 'UI-CMD-CAMPAIGN-CREATE')!;
    const allocations = host.receiptAllocations();
    const replay = await host.replay(resume.raw, create.raw);
    expect(replay[0]).toMatchObject({
      messageType: 'command.replay',
      receipt: JSON.parse(commands[0]!.receipt_json),
    });
    expect(host.receiptAllocations()).toBe(allocations);
    expect(host.campaigns()).toEqual(rows);
    expect(host.checkpoint()).toEqual(checkpoint);
    await host.restart();
    await page.reload();
    await expect(form(page, 'CMP-006')).toBeVisible();
    expect(host.checkpoint()).toEqual(checkpoint);
    expect(host.committedCommands()).toEqual(commands);
    const fresh = await coldMasterPage(page, host.baseURL, 'CMP-006');
    await expect(fresh.getByLabel('Созданная кампания', { exact: true })).toContainText(
      rows[0]!.campaign_id,
    );
    expect(host.checkpoint()).toEqual(checkpoint);
    expect(host.committedCommands()).toEqual(commands);
    expect(errors).toEqual([]);
    expect(host.errors).toEqual([]);
  } finally {
    await host.close();
  }
});

test('CMP cancels a real draft through its source back path, retains no secret inputs, and returns to the ordinary shell', async ({
  page,
}) => {
  const host = await createCampaignBrowserHost();
  try {
    await launch(page, host.baseURL);
    await metadataAndHost(page, host.baseURL, 'Будет отменена');
    await page.getByLabel('Секрет передачи мастера', { exact: true }).fill('Unconfirmed-secret');
    await action(page, 'CMP-003::CTA::001');
    await action(page, 'CMP-002::CTA::001');
    await expect(page.getByLabel('Название кампании', { exact: true })).toHaveValue(
      'Будет отменена',
    );
    await action(page, 'CMP-001::CTA::002');
    await expect(form(page, 'APP-011')).toBeVisible();
    expect(host.campaigns()).toHaveLength(0);
    expect(host.drafts()).toHaveLength(1);
    expect(host.drafts()[0]!.status).toBe('CANCELLED');
    expect(host.containsPlaintext('Unconfirmed-secret')).toBe(false);
    await page.reload();
    await expect(form(page, 'APP-011')).toBeVisible();
    await action(page, 'APP-011::CTA::001');
    await expect(form(page, 'APP-001')).toBeVisible();
    expect(
      await page.evaluate(() => sessionStorage.getItem('symbiosis.gm-local-context.v1')),
    ).toBeNull();
    await page.reload();
    await expect(form(page, 'APP-001')).toBeVisible();
    expect(host.errors).toEqual([]);
  } finally {
    await host.close();
  }
});

test('CMP restores the exact SECRET checkpoint after process restart and creates an AUTO campaign without re-entering the secret', async ({
  page,
}) => {
  const host = await createCampaignBrowserHost();
  try {
    await launch(page, host.baseURL);
    await metadataAndHost(page, host.baseURL, 'Черновик переживает перезапуск');
    await configureSecret(page);
    const original = host.drafts()[0]!;
    expect(original.formId).toBe('CMP-003');
    expect(host.campaigns()).toHaveLength(0);
    await host.restart();
    await page.reload();
    await expect(form(page, 'CMP-003')).toBeVisible();
    expect(host.drafts()[0]).toEqual(original);
    await expect(page.getByLabel('Секрет передачи мастера', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Подтверждение секрета', { exact: true })).toHaveValue('');
    const fresh = await coldMasterPage(page, host.baseURL, 'CMP-003');
    expect(host.drafts()[0]).toEqual(original);
    await expect(fresh.getByLabel('Секрет передачи мастера', { exact: true })).toHaveValue('');
    await finish(fresh, 'AUTO');
    expect(host.campaigns()).toHaveLength(1);
    expect(JSON.parse(host.campaigns()[0]!.payload_json)).toMatchObject({
      defaultFutureRollMode: 'AUTO',
      status: 'PAUSED',
    });
    expect(host.containsPlaintext(SECRET)).toBe(false);
    expect(host.errors).toEqual([]);
  } finally {
    await host.close();
  }
});

test('CMP rejects a genuinely occupied port before commit and can create the same draft after correcting the address', async ({
  page,
}) => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  const occupiedPort = (occupied.address() as AddressInfo).port;
  const host = await createCampaignBrowserHost();
  try {
    await launch(page, host.baseURL);
    await metadataAndHost(page, `http://127.0.0.1:${String(occupiedPort)}`, 'Занятый порт');
    await configureSecret(page);
    await action(page, 'CMP-003::CTA::002');
    await page.getByLabel('Режим будущих бросков', { exact: true }).selectOption('AUTO');
    await action(page, 'CMP-004::CTA::002');
    await expect(page.getByLabel('Итоговая проверка кампании', { exact: true })).toContainText(
      'порт занят',
    );
    await expect(page.locator('[data-atlas-action-key="CMP-005::CTA::001"]')).toHaveCount(0);
    expect(host.persistenceCounts()).toEqual({ campaigns: 0, checkpoints: 0, credentials: 0 });
    expect(host.committedCommands()).toHaveLength(0);
    const draftId = host.drafts()[0]!.campaignDraftId;
    await action(page, 'CMP-005::CTA::002');
    await action(page, 'CMP-004::CTA::001');
    await action(page, 'CMP-003::CTA::001');
    await page.getByLabel('Порт хоста', { exact: true }).fill(new URL(host.baseURL).port);
    await action(page, 'CMP-002::CTA::002');
    await action(page, 'CMP-003::CTA::002');
    await action(page, 'CMP-004::CTA::002');
    await action(page, 'CMP-005::CTA::001');
    await expect(form(page, 'CMP-006')).toBeVisible();
    expect(host.drafts()).toHaveLength(1);
    expect(host.drafts()[0]!.campaignDraftId).toBe(draftId);
    expect(host.persistenceCounts()).toEqual({ campaigns: 1, checkpoints: 1, credentials: 1 });
    expect(host.committedCommands()).toHaveLength(1);
    expect(host.errors).toEqual([]);
  } finally {
    await host.close();
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
