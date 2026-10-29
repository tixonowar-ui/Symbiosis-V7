import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createCreationFinalizationBrowserHost } from '../fixtures/creation-finalization-e2e.js';
import { canonicalPostSaveJson } from '../../src/host/local-character-export.js';

test.use({ channel: 'chrome' });
test('APP-010 GM exports only a verified immutable archive copy and preserves bytes through replay/reopen', async ({
  page,
}, testInfo) => {
  const host = await createCreationFinalizationBrowserHost({
    prefix: 'archive-browser',
    race: 'FREE',
    mode: 'MANUAL',
    gmArchiveExport: true,
  });
  const sent: { raw: string; value: Record<string, unknown> }[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => {
      const raw =
        typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
      sent.push({ raw, value: JSON.parse(raw) as Record<string, unknown> });
    }),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const original = host.archiveSnapshot();
    await page.goto(host.baseURL);
    await expect(page.locator('[data-atlas-form-id="APP-010"]')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Создать вариант с новым UUID', exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('[data-atlas-action-key="APP-010::CTA::003"]')).toHaveCount(0);
    const pendingDownload = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Экспортировать версионированный файл', exact: true })
      .click();
    const download = await pendingDownload;
    const path = testInfo.outputPath('archive-character.json');
    await download.saveAs(path);
    const bytes = await readFile(path, 'utf8');
    const dto = JSON.parse(bytes) as Record<string, unknown>;
    const { checksum, ...body } = dto;
    expect(checksum).toBe(
      createHash('sha256').update(canonicalPostSaveJson(body), 'utf8').digest('hex'),
    );
    expect(dto).toMatchObject({
      format: 'SYMBIOSIS_CHARACTER_EXPORT',
      schemaVersion: 1,
      ownerContext: 'GM_ARCHIVE_EXPORT',
      sourceKind: 'COMPLETED_CAMPAIGN_COPY',
      sourceUuid: host.archiveCopyId,
      sourceSnapshotId: `sha256:${host.archiveSourceHash()}`,
    });
    expect(bytes.endsWith('\n')).toBe(true);
    expect(bytes.startsWith('\uFEFF')).toBe(false);
    expect(bytes).not.toMatch(
      /\b(?:CORE|SYM|AQ\d?|AQA|CQA|OP|REQ)-[A-Z0-9-]+\b|availabilityTrace|Источник/u,
    );
    const reconnect = sent.find((frame) => frame.value['messageType'] === 'session.reconnect')!;
    const command = sent.find((frame) => frame.value['messageType'] === 'command.request')!;
    expect(command.value['role']).toBe('gm');
    const allocations = host.receiptAllocations();
    expect(host.archiveSnapshot()).toEqual(original);
    await host.restart();
    const replay = await host.replay(reconnect.raw, command.raw);
    expect(replay[0]?.['messageType']).toBe('command.replay');
    expect(replay[0]?.['receipt']).toMatchObject({
      result: { downloadOrNull: { contentText: bytes } },
    });
    expect(host.receiptAllocations()).toBe(allocations);
    expect(host.archiveSnapshot()).toEqual(original);
    expect(host.sampleCalls()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await host.close();
  }
});
