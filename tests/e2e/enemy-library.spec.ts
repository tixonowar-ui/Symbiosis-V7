import { createNpcPlayerPrivacyProbe } from '../fixtures/npc-privacy-e2e.js';
import { expect, test } from '@playwright/test';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import {
  createNetworkBrowserProcess,
  disposeNetworkResources,
} from '../fixtures/network-application-e2e.js';
import { enterNpcLibrary, npcAction, npcForm } from '../fixtures/npc-authoring-e2e.js';

test.use({ channel: 'chrome' });
test('GM browses separate immutable enemy catalogs, retains selection/art across reconnect and process restart before Start', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const host = await createNetworkBrowserProcess(0);
  const errors: string[] = [],
    frames: JsonObject[] = [];
  let scenarioError: unknown;
  let player: Awaited<ReturnType<typeof createNpcPlayerPrivacyProbe>> | undefined;
  const loss: {
    mode: 'BEFORE_ACK' | 'AFTER_ACK' | null;
    operationId: string | null;
    cut: boolean;
  } = { mode: null, operationId: null, cut: false };
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) =>
    socket.on('framereceived', (frame) => {
      try {
        frames.push(JSON.parse(String(frame.payload)) as JsonObject);
      } catch {
        /* Non-JSON would also fail the production client. */
      }
    }),
  );
  const latest = () => {
    const frame = frames.findLast((x) => x['messageType'] === 'projection.snapshot');
    return ((frame?.['presentation'] as JsonObject)?.['base'] as JsonObject)?.[
      'roleFilteredPayload'
    ] as JsonObject;
  };
  await page.routeWebSocket('**/state', (route) => {
    const server = route.connectToServer();
    route.onMessage((message) => {
      const value = JSON.parse(String(message)) as JsonObject;
      if (loss.mode !== null && value['messageType'] === 'network.enemy-selection.replace')
        loss.operationId = value['operationId'] as string;
      server.send(message);
    });
    server.onMessage((message) => {
      const value = JSON.parse(String(message)) as JsonObject;
      const result =
        value['messageType'] === 'network.enemy-selection.result' &&
        value['operationId'] === loss.operationId;
      const assigned =
        value['messageType'] === 'projection.snapshot' &&
        ((value['presentation'] as JsonObject)['assignment'] as JsonObject)['correlationId'] ===
          loss.operationId;
      if ((loss.mode === 'BEFORE_ACK' && result) || (loss.mode === 'AFTER_ACK' && assigned)) {
        loss.mode = null;
        loss.cut = true;
        void Promise.all([
          route.close({ code: 1012, reason: 'lost enemy selection delivery' }),
          server.close(),
        ]).catch((error) => errors.push(String(error)));
        return;
      }
      route.send(message);
    });
  });
  try {
    await enterNpcLibrary(page, host.baseURL, 'ENEMY');
    const before = host.inspect(),
      birth = JSON.parse(before.campaigns[0]!['payload_json'] as string) as JsonObject;
    expect(birth['schemaVersion']).toBe(2);
    expect(birth['defaultSentientCatalogVersion']).toBe('SYMBIOSIS_SENTIENT_DEFAULTS_V1.2');
    await expect(page.getByRole('tab', { name: 'Мыслящие враги', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-enemy-template]')).toHaveCount(44);
    await expect(
      page.getByText('Сохранённых пользовательских шаблонов нет.', { exact: true }),
    ).toBeVisible();
    for (const key of ['001', '003', '005', '006', '007', '008', '009', '010', '011', '012'])
      await expect(page.locator(`[data-atlas-action-key="ENM-001::CTA::${key}"]`)).toHaveCount(0);
    await page.getByRole('tab', { name: 'Монстры', exact: true }).click();
    await expect(page.locator('[data-enemy-template]')).toHaveCount(17);
    await expect(page.getByText('16 видов · 17 статблоков', { exact: true })).toBeVisible();
    const canonical = page.locator('[data-enemy-template="CBT-BUBUY-FEMALE"] input');
    await canonical.click();
    await expect(canonical).toBeChecked();
    await expect(page.locator('[data-atlas-action-key="ENM-001::CTA::002"]')).toHaveCount(0);
    await page.reload();
    await expect(canonical).toBeChecked({ timeout: 20_000 });
    await page.getByRole('tab', { name: 'Мыслящие враги', exact: true }).click();
    const first = page.locator('[data-enemy-template="SENT-PURE-STK-001"] input');
    const selected = page.locator('[data-enemy-template="SENT-PURE-STK-002"] input');
    loss.mode = 'BEFORE_ACK';
    loss.cut = false;
    await first.click();
    await expect.poll(() => loss.cut).toBe(true);
    await expect(first).not.toBeChecked();
    await page.reload();
    await expect(first).toBeChecked({ timeout: 20_000 });
    loss.mode = 'AFTER_ACK';
    loss.cut = false;
    await selected.click();
    await expect.poll(() => loss.cut).toBe(true);
    await expect(first).toBeChecked();
    await expect(selected).not.toBeChecked();
    await page.reload();
    await expect(selected).toBeChecked({ timeout: 20_000 });
    await npcAction(page, 'ENM-001::CTA::002', 'ENM-003');
    const image = page.getByRole('img', { name: 'Сталкер Цесмор—Эстрефорд', exact: true });
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (img: { readonly complete: boolean; readonly naturalWidth: number }) =>
            img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const source = await image.getAttribute('src'),
      card = latest();
    expect(source).toMatch(/^data:image\/png;base64,/);
    expect(card['systemTemplateArtAssetKey']).toBe('ART-SENT-002');
    player = await createNpcPlayerPrivacyProbe(browser, host.baseURL);
    await player.refuseEnemyAccess({
      messageType: 'network.enemy-selection.replace',
      protocolVersion: 3,
      operationId: 'replaced-by-probe',
      contextId: card['contextId']!,
      campaignId: card['campaignId']!,
      sourceFormId: 'ENM-001',
      expectedRevisions: {
        stateRevision: card['stateRevision']!,
        projectionRevision: card['projectionRevision']!,
        actorVisibilityRevision: card['actorVisibilityRevision']!,
      },
      activeTab: 'SENTIENT_ENEMIES',
      selectionOrNull: card['selectedOrNull']!,
    });
    await player.assertHidden([
      'SYSTEM_DEFAULT_SENTIENT',
      'SENT-PURE-STK-002',
      'ART-SENT-002',
      'CBT-BUBUY-FEMALE',
      card['contextId'] as string,
    ]);
    for (const key of [
      'groupId',
      'location',
      'subLocation',
      'location/subLocation',
      'markerRevision',
      'sceneId',
      'combatId',
    ]) {
      expect(JSON.stringify(card)).not.toContain('"' + key + '"');
      expect(await page.content()).not.toContain(key);
      expect(await page.locator('body').ariaSnapshot()).not.toContain(key);
    }
    await page.reload();
    await expect(image).toHaveAttribute('src', source!, { timeout: 20_000 });
    await host.restart();
    await page.reload();
    await expect(npcForm(page, 'ENM-003')).toBeVisible({ timeout: 30_000 });
    await expect(image).toHaveAttribute('src', source!);
    expect(latest()['selectedOrNull']).toEqual(card['selectedOrNull']);
    expect(latest()['defaultSentientCatalogVersion']).toBe(card['defaultSentientCatalogVersion']);
    await npcAction(page, 'ENM-003::CTA::001', 'ENM-001');
    await expect(selected).toBeChecked();
    await npcAction(page, 'ENM-001::CTA::004', 'ENM-003');
    await npcAction(page, 'ENM-003::CTA::001', 'ENM-001');
    await npcAction(page, 'ENM-001::CTA::013', 'GM-001');
    const after = host.inspect();
    expect(after.campaigns).toEqual(before.campaigns);
    expect(after.checkpoints).toEqual(before.checkpoints);
    expect(after.copies).toEqual([]);
    expect(host.inspectNpc().versions).toEqual([]);
    expect(host.inspectNpc().operations).toEqual([]);
    expect(errors).toEqual([]);
  } catch (error) {
    scenarioError = error;
  } finally {
    await testInfo.attach('enemy-library-evidence', {
      body: Buffer.from(JSON.stringify({ errors, frames }, null, 2)),
      contentType: 'application/json',
    });
    await disposeNetworkResources(
      [...(player === undefined ? [] : [() => player!.close()]), () => host.close()],
      scenarioError,
    );
  }
});
