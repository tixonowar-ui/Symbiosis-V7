import { randomUUID } from 'node:crypto';
import { expect, type Browser } from '@playwright/test';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import { npcAction, npcForm } from './npc-authoring-e2e.js';

/** A separate browser session on this installation enters PLAYER through normal controls. */
export async function createNpcPlayerPrivacyProbe(browser: Browser, baseURL: string) {
  const context = await browser.newContext();
  const frames: string[] = [],
    delivered: { raw: string; value: JsonObject }[] = [],
    errors: string[] = [];
  const channel: { send?: (request: JsonObject) => void } = {};
  const probeReplies = new Map<string, { raw: string; value: JsonObject }[]>();
  const expectedReplies = new Map<string, JsonObject>();
  let closed = false;
  const close = async () => {
    if (closed) return;
    await context.close();
    closed = true;
  };
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.routeWebSocket('**/state', (route) => {
      const server = route.connectToServer();
      channel.send = (request) => server.send(JSON.stringify(request));
      route.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        const raw = String(message),
          value = JSON.parse(raw) as JsonObject;
        frames.push(raw);
        const correlation =
          value['navigationRequestId'] ?? value['requestId'] ?? value['operationId'];
        const replies = typeof correlation === 'string' ? probeReplies.get(correlation) : undefined;
        if (replies !== undefined) {
          // These two hostile intents originate in the test, not the renderer's pending queue.
          // Capture their real replies for exact assertions without injecting unsolicited UI ACKs.
          replies.push({ raw, value });
          return;
        }
        delivered.push({ raw, value });
        route.send(message);
      });
    });
    await page.goto(baseURL);
    await expect(npcForm(page, 'APP-001')).toBeVisible();
    await npcAction(page, 'APP-001::CTA::001', 'APP-002');
    const playerSnapshot = () => {
      const value = delivered.findLast(
        (frame) => frame.value['messageType'] === 'projection.snapshot',
      )?.value;
      expect(value).toMatchObject({
        messageType: 'projection.snapshot',
        projectionRole: 'player',
        presentation: { base: { formId: 'APP-002' }, layers: [] },
      });
      if (value === undefined) throw Error('Real player projection absent');
      return value;
    };
    playerSnapshot();
    return {
      frames,
      errors,
      close,
      async refreshPlayer() {
        // Request a fresh production projection after SAVE as well as observing unsolicited pushes.
        await page.goto(baseURL);
        await expect(npcForm(page, 'APP-001')).toBeVisible();
        await npcAction(page, 'APP-001::CTA::001', 'APP-002');
        playerSnapshot();
      },
      async assertHidden(privateValues: readonly string[]) {
        playerSnapshot();
        await expect(npcForm(page, 'APP-002')).toBeVisible();
        await expect(page.locator('[data-npc-content], [data-atlas-form-id^="NPC-"]')).toHaveCount(
          0,
        );
        const payloads = delivered.map((frame) => frame.raw).join('\n');
        const dom = await page.content();
        const accessible = await page.locator('body').ariaSnapshot();
        for (const value of privateValues) {
          expect(typeof value).toBe('string');
          expect(value.length).toBeGreaterThan(0);
          expect(payloads, 'Private NPC values in actual player frames').not.toContain(value);
          expect(dom, 'Private NPC values in player DOM, including attributes').not.toContain(
            value,
          );
          expect(accessible, 'Private NPC values in the accessibility tree').not.toContain(value);
        }
        for (const frame of delivered)
          if (frame.value['messageType'] === 'projection.snapshot')
            expect([null, 'player']).toContain(frame.value['projectionRole']);
        for (const [id, expected] of expectedReplies) {
          const replies = probeReplies.get(id) ?? [];
          expect(replies.map((reply) => reply.value)).toEqual([expected]);
          expect(replies[0]!.raw).toBe(JSON.stringify(replies[0]!.value));
        }
        expect(errors).toEqual([]);
      },
      async refuseEnemyAccess(selection: JsonObject) {
        const navigation: JsonObject = {
          messageType: 'navigation.form-action',
          protocolVersion: 2,
          navigationRequestId: randomUUID(),
          sourceFormId: 'GM-001',
          actionKey: 'GM-001::CTA::005',
          expectedProjectionRevision: (playerSnapshot()['revisions'] as JsonObject)[
            'projectionRevision'
          ]!,
        };
        const request: JsonObject = { ...selection, operationId: randomUUID() };
        for (const [message, id, expected] of [
          [
            navigation,
            navigation['navigationRequestId'] as string,
            {
              messageType: 'navigation.form-action.refusal',
              protocolVersion: 2,
              navigationRequestId: navigation['navigationRequestId']!,
              revisions: { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 },
              presentationUnchanged: true,
              refusal: { code: 'NAVIGATION_UNAVAILABLE' },
            },
          ],
          [
            request,
            request['operationId'] as string,
            {
              messageType: 'network.enemy-selection.refusal',
              protocolVersion: 3,
              operationId: request['operationId']!,
            },
          ],
        ] as const) {
          const replies: { raw: string; value: JsonObject }[] = [];
          probeReplies.set(id, replies);
          expectedReplies.set(id, expected);
          if (channel.send === undefined) throw Error('Player channel absent');
          channel.send(message);
          await expect.poll(() => replies.map((x) => x.value)).toEqual([expected]);
        }
        await expect(
          page.locator(
            '[data-enemy-library], [data-enemy-system-card], [data-atlas-form-id^="ENM-"]',
          ),
        ).toHaveCount(0);
      },
      async refuseNpcAccess(artRequest: JsonObject) {
        expect(artRequest).toMatchObject({
          messageType: 'network.npc-art.read',
          protocolVersion: 3,
          sourceFormId: 'NPC-003',
          target: { kind: 'VERSION', version: 1 },
        });
        const actual = playerSnapshot();
        const navigation: JsonObject = {
          messageType: 'navigation.form-action',
          protocolVersion: 2,
          navigationRequestId: randomUUID(),
          sourceFormId: 'GM-001',
          actionKey: 'GM-001::CTA::004',
          expectedProjectionRevision: (actual['revisions'] as JsonObject)['projectionRevision']!,
        };
        const art: JsonObject = { ...artRequest, requestId: randomUUID() };
        const probes: readonly [JsonObject, string, JsonObject][] = [
          [
            navigation,
            navigation['navigationRequestId'] as string,
            {
              messageType: 'navigation.form-action.refusal',
              protocolVersion: 2,
              navigationRequestId: navigation['navigationRequestId']!,
              revisions: { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 },
              presentationUnchanged: true,
              refusal: { code: 'NAVIGATION_UNAVAILABLE' },
            },
          ],
          [
            art,
            art['requestId'] as string,
            {
              ...art,
              messageType: 'network.npc-art.refusal',
              code: 'NOT_AVAILABLE',
            },
          ],
        ];
        for (const [request, id, expected] of probes) {
          const replies: { raw: string; value: JsonObject }[] = [];
          probeReplies.set(id, replies);
          expectedReplies.set(id, expected);
          if (channel.send === undefined) throw Error('Real player WebSocket absent');
          channel.send(request);
          await expect.poll(() => replies.map((reply) => reply.value)).toEqual([expected]);
          // An art refusal may reflect only the exact supplied binding, never private bytes or state.
          // Canonical equality also prevents duplicate JSON keys from disappearing in the comparison.
          expect(replies[0]!.raw).toBe(JSON.stringify(replies[0]!.value));
        }
        playerSnapshot();
        await expect(npcForm(page, 'APP-002')).toBeVisible();
      },
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'NPC player privacy setup cleanup failed', {
        cause: cleanupError,
      });
    }
    throw error;
  }
}
