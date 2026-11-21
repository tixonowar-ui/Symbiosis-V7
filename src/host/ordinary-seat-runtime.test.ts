import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectionSnapshotV2Message } from '@shared/wire-v2-protocol.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import { confirmOrdinaryRosterSource, peaceSource } from './ordinary-seat-runtime.js';

describe('ordinary roster source after its technical session goes idle', () => {
  const revision = { projectionRevision: 4, stateRevision: 4, actorVisibilityRevision: 4 };
  const payload = {
    projectionVariant: 'PEACE_SNAPSHOT',
    technicalSessionAvailable: true,
    pendingCommandIdOrNull: null,
    controllerSeat: randomUUID(),
    contextId: randomUUID(),
    networkScopeId: randomUUID(),
    campaignId: randomUUID(),
    sceneId: randomUUID(),
    campaignCharacterId: randomUUID(),
    currentHP: 6,
    ...revision,
  };
  const snapshot = (
    changes: JsonObject = {},
    revisions = revision,
  ): ProjectionSnapshotV2Message => ({
    protocolVersion: 2,
    messageType: 'projection.snapshot',
    projectionRole: 'player',
    revisions,
    presentation: {
      assignment: { reason: 'RECONNECT', correlationId: randomUUID() },
      base: {
        formId: 'PLY-001',
        formType: 'screen',
        routeTemplate: '/campaigns/:campaignId/player/:campaignCharacterId',
        availableActionKeys: [],
        routeBindings: [
          { parameterIndex: 0, source: 'inherited', value: payload.campaignId },
          { parameterIndex: 1, source: 'inherited', value: payload.campaignCharacterId },
        ],
        roleFilteredPayload: { ...payload, ...revisions, ...changes },
      },
      layers: [],
    },
  });
  const source = peaceSource(snapshot())!;
  const disconnected = () => snapshot({ technicalSessionAvailable: false });

  it('repins the original source before selecting another seat and keeps a live source local', async () => {
    const restore = vi.fn(() => Promise.resolve(snapshot()));
    expect(peaceSource(disconnected())).toBeNull();
    expect(await confirmOrdinaryRosterSource(source, disconnected(), restore)).toEqual(source);
    expect(await confirmOrdinaryRosterSource(source, snapshot(), restore)).toEqual(source);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it.each([
    'sceneId',
    'contextId',
    'networkScopeId',
    'campaignId',
    'controllerSeat',
    'pendingCommandIdOrNull',
  ])('refuses a changed %s before touching the disconnected transport', async (field) => {
    const restore = vi.fn(() => Promise.resolve(snapshot()));
    const different = snapshot({ [field]: randomUUID(), technicalSessionAvailable: false });
    expect(await confirmOrdinaryRosterSource(source, different, restore)).toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });

  it('refuses an offline peer, a changed sheet, or a new revision after reconnection', async () => {
    const results = [
      disconnected(),
      snapshot({ currentHP: payload.currentHP - 1 }),
      snapshot({ campaignCharacterId: randomUUID() }),
      snapshot({ contextId: randomUUID() }),
      snapshot({}, { ...revision, stateRevision: revision.stateRevision + 1 }),
      snapshot({}, { ...revision, actorVisibilityRevision: revision.actorVisibilityRevision + 1 }),
      snapshot({}, { ...revision, projectionRevision: revision.projectionRevision + 1 }),
    ];
    for (const result of results) {
      expect(
        await confirmOrdinaryRosterSource(source, disconnected(), () => Promise.resolve(result)),
      ).toBeNull();
    }
    const failed = () => Promise.reject(new Error('Peer unavailable'));
    await expect(confirmOrdinaryRosterSource(source, disconnected(), failed)).rejects.toThrow(
      'Peer unavailable',
    );
  });
});
