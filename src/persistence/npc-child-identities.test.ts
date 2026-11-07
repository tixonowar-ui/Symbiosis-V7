import { describe, expect, it } from 'vitest';
import { networkApplicationStorage as s } from './network-local-application.js';
import {
  npcChildAllocationsValue,
  npcChildIdentities,
  npcAttemptReadContext,
  npcPublishedChildGraphValue,
  verifyNpcPublishedChildren,
  type NpcChildAllocation,
  type NpcChildIdentity,
  type NpcCustomProfileBinding,
} from './npc-child-identities.js';
import {
  npcAttemptEventEnvelopeValue,
  type NpcAttempt,
  type NpcAttemptEvent,
  type NpcOperation,
  type NpcVersion,
} from './npc-library-records.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { campaignId: id(1), ownerDeviceId: id(2), gmLocalContextId: id(3) };
const hash = (value: unknown) => s.sha(s.canonical(value));
const attempt = (draft = 4, revision = 1): NpcAttempt => ({
  scope,
  npcDraftId: id(draft),
  candidateNpcUuid: id(5),
  revision,
  mode: 'CREATE_V1',
  targetOrNull: null,
  stage: 'NPC-015',
  status: 'OPEN',
  values: {},
});
/** Header-only fixture: full stage/source and SQLite integration is tested by the owning suite. */
function pair(allocations: readonly NpcChildAllocation[], operationNumber = 6, a = attempt()) {
  const event: NpcAttemptEvent = {
    format: 'NPC_ATTEMPT_EVENT_V2',
    operationId: id(operationNumber),
    previousSha256OrNull: 'a'.repeat(64),
    attempt: a,
    childAllocations: allocations,
  };
  const revisions = { stateRevision: 0, projectionRevision: 2, actorVisibilityRevision: 0 };
  const checkpoint = { campaignId: scope.campaignId, snapshotJson: '{}', ...revisions };
  const operation: NpcOperation = {
    operationId: event.operationId,
    receiptId: id(operationNumber + 100),
    kind: 'REPLACE',
    scope,
    request: {
      messageType: 'network.npc-preparation.request',
      preparation: { kind: 'ITEM_RESERVE' },
    },
    attemptEventSha256: hash(event),
    versionOrNull: null,
    anchorOrNull: null,
    beforeGmSource: {
      sourceFormId: 'NPC-015',
      revisions,
      sourceSnapshotSha256: 'b'.repeat(64),
      queuePrefix: { eventId: 'checked-by-owning-GM-reader', recordSha256: 'c'.repeat(64) },
    },
    beforeCheckpoint: checkpoint,
    afterCheckpoint: checkpoint,
    committedAt: '2026-11-06T00:00:00.000Z',
  };
  return { event, operation };
}
function child(n = 10, draft = 4): NpcChildIdentity {
  const p = pair([{ kind: 'ITEM', id: id(n) }], n + 100, attempt(draft));
  const result = npcChildIdentities([p.event], [p.operation])[0];
  if (result === undefined) throw Error('item');
  return result;
}
const version = (draft = 4): NpcVersion => ({
  scope,
  npcUuid: id(5),
  version: 1,
  libraryRevision: 1,
  operationId: id(20),
  npcDraftId: id(draft),
  attemptRevision: 5,
  previousVersionSha256OrNull: null,
  snapshot: {},
  lifetimeFacts: {},
  art: { assetKey: 'fixture', sha256: 'd'.repeat(64) },
  committedAt: '2026-11-06T00:00:00.000Z',
});
describe('NPC child allocation immutable envelopes', () => {
  it('preserves exact legacy event shape and accepts the separate closed V2 shape', () => {
    const p = pair([{ kind: 'ITEM', id: id(10) }]);
    expect(npcAttemptEventEnvelopeValue(p.event)).toEqual(p.event);
    const legacy = {
      operationId: p.event.operationId,
      previousSha256OrNull: null,
      attempt: p.event.attempt,
    };
    expect(npcAttemptEventEnvelopeValue(legacy)).toEqual(legacy);
    expect(Object.hasOwn(npcAttemptEventEnvelopeValue(legacy), 'childAllocations')).toBe(false);
  });
  it.each([
    { ...pair([]).event, format: 'NPC_ATTEMPT_EVENT_V3' },
    { ...pair([]).event, unknown: true },
    { operationId: id(6), previousSha256OrNull: null, attempt: attempt(), childAllocations: [] },
  ])('refuses an unrecognized or mixed event grammar %#', (value) => {
    expect(() => npcAttemptEventEnvelopeValue(value)).toThrow();
  });
  it.each(
    [
      [{ kind: 'EFFECT', id: id(10) }],
      [{ kind: 'ITEM', id: id(10), ownerNpcUuid: id(5) }],
      [
        { kind: 'ITEM', id: id(10) },
        { kind: 'ITEM', id: id(10) },
      ],
      [
        {
          kind: 'WEAPON_PROFILE_VERSION',
          id: id(10),
          itemInstanceId: id(11),
          weaponVariantId: 'UNKNOWN',
        },
      ],
      [{ kind: 'ITEM', id: 'NPC_ITEM/1' }],
    ].map((value) => ({ value })),
  )(
    'rejects unknown allocation kinds, extra authority, collisions and UUID aliases %#',
    ({ value }) => {
      expect(() => npcChildAllocationsValue(value)).toThrow();
    },
  );
  it('rejects sparse/accessor arrays without running an array getter', () => {
    let calls = 0;
    const value: unknown[] = [];
    Object.defineProperty(value, '0', {
      enumerable: true,
      get: () => {
        calls++;
        return { kind: 'ITEM', id: id(10) };
      },
    });
    expect(() => npcChildAllocationsValue(value)).toThrow();
    expect(() => npcChildAllocationsValue(new Array(1))).toThrow();
    expect(calls).toBe(0);
  });
  it('binds exactly one ITEM allocation to the same reserve event and source form', () => {
    const p = pair([{ kind: 'ITEM', id: id(10) }]);
    expect(npcChildIdentities([p.event], [p.operation])).toEqual([
      {
        allocation: { kind: 'ITEM', id: id(10) },
        scope,
        ownerNpcUuid: id(5),
        originDraftId: id(4),
        originOperationId: id(6),
        originEventSha256: hash(p.event),
        originRevision: 1,
        ordinal: 1,
      },
    ]);
    expect(() =>
      npcChildIdentities(
        [p.event],
        [{ ...p.operation, request: { messageType: 'network.npc-editor.replace' } }],
      ),
    ).toThrow();
    expect(() =>
      npcChildIdentities(
        [p.event],
        [
          {
            ...p.operation,
            beforeGmSource: { ...p.operation.beforeGmSource, sourceFormId: 'NPC-014' },
          },
        ],
      ),
    ).toThrow();
    expect(() => npcChildIdentities([p.event], [{ ...p.operation, kind: 'COMMIT_V1' }])).toThrow();
    const two = pair([
      { kind: 'ITEM', id: id(10) },
      { kind: 'ITEM', id: id(11) },
    ]);
    expect(() => npcChildIdentities([two.event], [two.operation])).toThrow();
  });
});
describe('NPC per-attempt physical identity ownership', () => {
  it('excludes another draft even for the same NPC and excludes future revisions', () => {
    const owned = child(),
      foreign = child(11, 8),
      future = { ...child(12), originRevision: 3 };
    const context = npcAttemptReadContext(attempt(), id(6), [owned, foreign, future], null);
    expect(context.itemBindings.map((b) => b.itemInstanceId)).toEqual([id(10)]);
    expect(context.pendingItemOrNull).toBeNull();
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.itemBindings[0])).toBe(true);
  });
  it('represents one pending APPLY item separately without fabricating an event hash', () => {
    const context = npcAttemptReadContext(attempt(), id(6), [child()], null, id(11));
    expect(context.itemBindings.map((b) => b.itemInstanceId)).toEqual([id(10)]);
    expect(context.pendingItemOrNull).toEqual({
      itemInstanceId: id(11),
      operationId: id(6),
      npcDraftId: id(4),
    });
    expect(Object.hasOwn(context.pendingItemOrNull ?? {}, 'originEventSha256')).toBe(false);
    expect(() => npcAttemptReadContext(attempt(), id(6), [child()], null, id(10))).toThrow();
  });
  it('inherits only exact published base items, never other cancelled reservations of that NPC', () => {
    const a: NpcAttempt = {
      ...attempt(8, 0),
      mode: 'APPEND_N_PLUS_ONE',
      targetOrNull: { npcUuid: id(5), expectedCurrentVersion: 1 },
    };
    const context = npcAttemptReadContext(a, id(30), [child(), child(11)], {
      version: version(),
      graph: {
        wounds: [],
        symbionts: [],
        traumas: [],
        effects: [],
        items: [{ itemInstanceId: id(10), profileVersions: [] }],
      },
    });
    expect(context.itemBindings.map((b) => b.itemInstanceId)).toEqual([id(10)]);
    expect(context.inheritedVersionOrNull).toEqual({
      npcUuid: id(5),
      version: 1,
      sha256: hash(version()),
    });
    expect(() => npcAttemptReadContext(a, id(30), [child()], null)).toThrow();
    expect(() =>
      npcAttemptReadContext(a, id(30), [child()], {
        version: { ...version(), version: 2 },
        graph: { wounds: [], symbionts: [], traumas: [], effects: [], items: [] },
      }),
    ).toThrow();
  });
});
describe('NPC restored unconfirmed custom carrier context', () => {
  it('retains checked preparation identity without accepting an unconfirmed published profile', () => {
    const item = child();
    const profile: NpcChildIdentity = {
      ...item,
      ordinal: 2,
      allocation: {
        kind: 'CUSTOM_PROFILE',
        id: id(50),
        itemInstanceId: id(10),
        profileKind: 'CAMPAIGN_CUSTOM_PROFILE',
      },
    };
    const profileVersion: NpcChildIdentity = {
      ...item,
      ordinal: 3,
      allocation: {
        kind: 'CUSTOM_PROFILE_VERSION',
        id: id(51),
        itemInstanceId: id(10),
        profileId: id(50),
        version: 1,
        previousVersionIdOrNull: null,
      },
    };
    const binding: NpcCustomProfileBinding = {
      itemInstanceId: id(10),
      reference: {
        kind: 'CAMPAIGN_CUSTOM_PROFILE',
        profileId: id(50),
        profileVersionId: id(51),
        version: 1,
        reservationOperationId: item.originOperationId,
      },
      confirmedContentOrNull: null,
    };
    const items = [{ itemInstanceId: id(10), profileVersions: [] }];
    const readContext = (selected: NpcCustomProfileBinding, published: boolean) =>
      npcAttemptReadContext(
        {
          ...attempt(8),
          mode: 'APPEND_N_PLUS_ONE',
          targetOrNull: { npcUuid: id(5), expectedCurrentVersion: 1 },
        },
        id(30),
        [item, profile, profileVersion],
        {
          version: version(),
          graph: {
            wounds: [],
            symbionts: [],
            traumas: [],
            effects: [],
            items: published ? items : [],
            ...(published ? { customProfiles: [selected] } : {}),
          },
        },
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        published ? null : { items, customProfiles: [selected] },
      );
    const restored = readContext(binding, false);
    expect(restored.customProfiles).toEqual([binding]);
    expect(restored.itemBindings.map((row) => row.itemInstanceId)).toEqual([id(10)]);
    expect(restored.customProfiles?.[0]?.confirmedContentOrNull).toBeNull();
    expect(() => readContext(binding, true)).toThrow();
    expect(() => readContext({ ...binding, itemInstanceId: id(99) }, false)).toThrow();
  });
});
describe('NPC publication identity edges after the separate full sheet recomputation', () => {
  const item = child();
  const profile: NpcChildIdentity = {
    ...item,
    allocation: {
      kind: 'WEAPON_PROFILE_VERSION',
      id: id(12),
      itemInstanceId: id(10),
      weaponVariantId: 'DEFAULT',
    },
    originOperationId: id(20),
    originRevision: 5,
    originEventSha256: 'f'.repeat(64),
    ordinal: 1,
  };
  const graph = {
    wounds: [],
    symbionts: [],
    traumas: [],
    effects: [],
    items: [
      {
        itemInstanceId: id(10),
        profileVersions: [{ weaponProfileVersionId: id(12), weaponVariantId: 'DEFAULT' }],
      },
    ],
  } as const;
  it('accepts the exact newly committed profile edge and unchanged N+1 edge', () => {
    expect(npcPublishedChildGraphValue(graph)).toEqual(graph);
    const context = npcAttemptReadContext(
      { ...attempt(), revision: 5 },
      id(20),
      [item, profile],
      null,
    );
    expect(() =>
      verifyNpcPublishedChildren(version(), graph, null, [item, profile], context),
    ).not.toThrow();
    const later = { ...version(8), operationId: id(30), version: 2 };
    const laterAttempt: NpcAttempt = {
      ...attempt(8, 5),
      mode: 'APPEND_N_PLUS_ONE',
      targetOrNull: { npcUuid: id(5), expectedCurrentVersion: 1 },
    };
    const laterContext = npcAttemptReadContext(laterAttempt, id(30), [item, profile], {
      version: version(),
      graph,
    });
    expect(() =>
      verifyNpcPublishedChildren(later, graph, graph, [item, profile], laterContext),
    ).not.toThrow();
    expect(() =>
      verifyNpcPublishedChildren(later, graph, graph, [item, profile], context),
    ).toThrow();
  });
  it('refuses cross-owner, cross-item, variant, operation and unused allocation changes', () => {
    const context = npcAttemptReadContext(
      { ...attempt(), revision: 5 },
      id(20),
      [item, profile],
      null,
    );
    for (const bad of [
      { ...profile, ownerNpcUuid: id(99) },
      { ...profile, originOperationId: id(99) },
      { ...profile, allocation: { ...profile.allocation, itemInstanceId: id(99) } },
      { ...profile, allocation: { ...profile.allocation, weaponVariantId: 'TWO_HAND' } },
    ] as NpcChildIdentity[])
      expect(() =>
        verifyNpcPublishedChildren(version(), graph, null, [item, bad], context),
      ).toThrow();
    const orphan = { ...profile, allocation: { ...profile.allocation, id: id(13) } };
    expect(() =>
      verifyNpcPublishedChildren(version(), graph, null, [item, profile, orphan], context),
    ).toThrow();
  });
  it('refuses publication while a coating allocation is still pending', () => {
    const context = npcAttemptReadContext(
      { ...attempt(), revision: 5 },
      id(20),
      [item, profile],
      null,
    );
    expect(() =>
      verifyNpcPublishedChildren(version(), graph, null, [item, profile], context),
    ).not.toThrow();
    expect(() =>
      verifyNpcPublishedChildren(version(), graph, null, [item, profile], {
        ...context,
        pendingCoatingOrNull: {
          coatingInstanceId: id(40),
          itemInstanceId: id(10),
          sourceInstanceId: id(41),
          operationId: id(20),
          npcDraftId: id(4),
        },
      }),
    ).toThrow();
  });
  it('refuses reused item/profile identities and repeated variants in the graph', () => {
    expect(() =>
      npcPublishedChildGraphValue({
        wounds: [],
        symbionts: [],
        traumas: [],
        effects: [],
        items: [...graph.items, ...graph.items],
      }),
    ).toThrow();
    expect(() =>
      npcPublishedChildGraphValue({
        wounds: [],
        symbionts: [],
        traumas: [],
        effects: [],
        items: [{ itemInstanceId: id(12), profileVersions: graph.items[0].profileVersions }],
      }),
    ).toThrow();
    expect(() =>
      npcPublishedChildGraphValue({
        wounds: [],
        symbionts: [],
        traumas: [],
        effects: [],
        items: [
          {
            itemInstanceId: id(10),
            profileVersions: [
              ...graph.items[0].profileVersions,
              { weaponProfileVersionId: id(13), weaponVariantId: 'DEFAULT' },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});

describe('disease reservation identity proof, distinct from a materialized effect', () => {
  function diseaseChild(draft = 4, n = 40): NpcChildIdentity {
    const p = pair([{ kind: 'EFFECT_INSTANCE', id: id(n), diseaseId: 'DIS-RHINITIS' }], n + 100, {
      ...attempt(draft),
      stage: 'NPC-016',
    });
    const operation = {
      ...p.operation,
      request: {
        messageType: 'network.npc-preparation.request',
        preparation: { kind: 'DISEASE_RESERVE', diseaseId: 'DIS-RHINITIS' },
      },
      beforeGmSource: { ...p.operation.beforeGmSource, sourceFormId: 'NPC-016' as const },
    };
    return npcChildIdentities([p.event], [operation])[0]!;
  }
  it('records a closed disease intent and no runtime timestamp/payload', () => {
    const c = diseaseChild();
    expect(c.allocation).toEqual({
      kind: 'EFFECT_INSTANCE',
      id: id(40),
      diseaseId: 'DIS-RHINITIS',
    });
    expect(() =>
      npcChildAllocationsValue([{ ...c.allocation, startsAt: { campaignTimestamp: 1 } }]),
    ).toThrow();
    expect(() => npcChildAllocationsValue([{ ...c.allocation, diseaseId: 'UNKNOWN' }])).toThrow();
  });
  it('does not borrow reservations from another attempt and keeps pending proof separate', () => {
    const own = diseaseChild(),
      foreign = diseaseChild(8, 41),
      context = npcAttemptReadContext(attempt(), id(6), [own, foreign], null, null, {
        effectInstanceId: id(42),
        diseaseId: 'DIS-POISONING',
      });
    expect(context.effectBindings.map((b) => b.effectInstanceId)).toEqual([id(40)]);
    expect(context.pendingEffectOrNull).toEqual({
      effectInstanceId: id(42),
      diseaseId: 'DIS-POISONING',
      operationId: id(6),
      npcDraftId: id(4),
    });
    expect(Object.hasOwn(context.pendingEffectOrNull ?? {}, 'originEventSha256')).toBe(false);
    expect(() =>
      npcAttemptReadContext(attempt(), id(6), [own], null, null, {
        effectInstanceId: id(40),
        diseaseId: 'DIS-RHINITIS',
      }),
    ).toThrow();
    expect(() =>
      npcAttemptReadContext(attempt(), id(6), [own], null, id(43), {
        effectInstanceId: id(42),
        diseaseId: 'DIS-RHINITIS',
      }),
    ).toThrow();
    expect(() => npcAttemptReadContext(attempt(), id(6), [own], null, id(40))).toThrow();
    expect(() =>
      npcAttemptReadContext(attempt(), id(6), [child()], null, null, {
        effectInstanceId: id(10),
        diseaseId: 'DIS-RHINITIS',
      }),
    ).toThrow();
  });
  it('requires a real new COMMIT origin and retains the exact published origin for N+1', () => {
    const c = diseaseChild(),
      graph = {
        items: [],
        wounds: [],
        symbionts: [],
        traumas: [],
        effects: [
          { effectInstanceId: id(40), diseaseId: 'DIS-RHINITIS', originCommitOperationId: id(20) },
        ],
      } as const;
    const current = { ...attempt(), revision: 5 },
      context = npcAttemptReadContext(current, id(20), [c], null);
    expect(() => verifyNpcPublishedChildren(version(), graph, null, [c], context)).not.toThrow();
    expect(() =>
      verifyNpcPublishedChildren(
        version(),
        {
          ...graph,
          wounds: [],
          symbionts: [],
          traumas: [],
          effects: [{ ...graph.effects[0], originCommitOperationId: id(99) }],
        },
        null,
        [c],
        context,
      ),
    ).toThrow();
    const next: NpcAttempt = {
      ...attempt(8, 5),
      mode: 'APPEND_N_PLUS_ONE',
      targetOrNull: { npcUuid: id(5), expectedCurrentVersion: 1 },
    };
    const inherited = npcAttemptReadContext(next, id(30), [c, diseaseChild(4, 41)], {
      version: version(),
      graph,
    });
    expect(inherited.effectBindings.map((b) => b.effectInstanceId)).toEqual([id(40)]);
    expect(() =>
      verifyNpcPublishedChildren(
        { ...version(8), operationId: id(30), version: 2 },
        graph,
        graph,
        [c],
        inherited,
      ),
    ).not.toThrow();
    expect(npcPublishedChildGraphValue(graph)).toEqual(graph);
  });
  it('refuses mixed child identities, repeated disease and forged materialization origins', () => {
    const c = diseaseChild(),
      effect = {
        effectInstanceId: id(40),
        diseaseId: 'DIS-RHINITIS',
        originCommitOperationId: id(20),
      } as const,
      graph = { items: [], wounds: [], symbionts: [], traumas: [], effects: [effect] };
    expect(() =>
      npcPublishedChildGraphValue({
        items: [{ itemInstanceId: id(40), profileVersions: [] }],
        wounds: [],
        symbionts: [],
        traumas: [],
        effects: [effect],
      }),
    ).toThrow();
    expect(() =>
      npcPublishedChildGraphValue({
        items: [],
        wounds: [],
        symbionts: [],
        traumas: [],
        effects: [effect, { ...effect, effectInstanceId: id(41) }],
      }),
    ).toThrow();
    const current = { ...attempt(), revision: 5 },
      context = npcAttemptReadContext(current, id(20), [c], null);
    for (const forged of [
      { ...c, ownerNpcUuid: id(99) },
      { ...c, originDraftId: id(99) },
      { ...c, originEventSha256: 'f'.repeat(64) },
      { ...c, allocation: { ...c.allocation, diseaseId: 'DIS-POISONING' } },
    ] as NpcChildIdentity[])
      expect(() => verifyNpcPublishedChildren(version(), graph, null, [forged], context)).toThrow();
  });
  it('cannot republish a removed or never-published reservation through a later attempt', () => {
    const original = diseaseChild(),
      unselected = diseaseChild(4, 41),
      oldEffect = {
        effectInstanceId: id(40),
        diseaseId: 'DIS-RHINITIS',
        originCommitOperationId: id(20),
      } as const,
      oldGraph = { items: [], wounds: [], symbionts: [], traumas: [], effects: [oldEffect] },
      removedGraph = { items: [], wounds: [], symbionts: [], traumas: [], effects: [] },
      next: NpcAttempt = {
        ...attempt(8, 5),
        mode: 'APPEND_N_PLUS_ONE',
        targetOrNull: { npcUuid: id(5), expectedCurrentVersion: 1 },
      },
      later = { ...version(8), operationId: id(30), version: 2 };
    const retained = npcAttemptReadContext(next, id(30), [original, unselected], {
      version: version(),
      graph: oldGraph,
    });
    expect(() =>
      verifyNpcPublishedChildren(
        later,
        {
          ...oldGraph,
          wounds: [],
          symbionts: [],
          traumas: [],
          effects: [{ ...oldEffect, originCommitOperationId: id(30) }],
        },
        oldGraph,
        [original, unselected],
        retained,
      ),
    ).toThrow();
    const afterRemoval = npcAttemptReadContext(next, id(30), [original, unselected], {
      version: version(),
      graph: removedGraph,
    });
    expect(afterRemoval.effectBindings).toEqual([]);
    for (const effectInstanceId of [id(40), id(41)])
      expect(() =>
        verifyNpcPublishedChildren(
          later,
          {
            items: [],
            wounds: [],
            symbionts: [],
            traumas: [],
            effects: [{ ...oldEffect, effectInstanceId }],
          },
          removedGraph,
          [original, unselected],
          afterRemoval,
        ),
      ).toThrow();
  });
});

describe('trauma reservation identities have no assigned mechanics', () => {
  const traumaInput = (n = 50) =>
    ({
      traumaInstanceId: id(n),
      input: {
        regionId: { kind: 'ENTERED', value: 'ARM_L' },
        traumaValue: { kind: 'ENTERED', value: 10 },
        reason: { kind: 'ENTERED', value: 'saved GM assignment' },
      },
      head: { kind: 'UNSET' },
    }) as const;
  function traumaPair(draft = 4, n = 50) {
    const p = pair([{ kind: 'TRAUMA_INSTANCE', id: id(n) }], n + 100, {
      ...attempt(draft),
      stage: 'NPC-016',
    });
    return {
      event: p.event,
      operation: {
        ...p.operation,
        request: {
          messageType: 'network.npc-preparation.request',
          preparation: { kind: 'TRAUMA_RESERVE' },
        },
        beforeGmSource: { ...p.operation.beforeGmSource, sourceFormId: 'NPC-016' as const },
      },
    };
  }
  const from = (draft = 4, n = 50) => {
    const p = traumaPair(draft, n);
    return npcChildIdentities([p.event], [p.operation])[0]!;
  };
  it('keeps a closed UUID-only reservation and rejects mechanics, alias and mixed identity collisions', () => {
    const child = from();
    expect(child.allocation).toEqual({ kind: 'TRAUMA_INSTANCE', id: id(50) });
    expect(npcChildAllocationsValue([child.allocation])).toEqual([child.allocation]);
    for (const extra of [
      { regionId: 'HEAD' },
      { traumaValue: 20 },
      { reason: 'assigned' },
      { sourceOperationId: id(20) },
      { startsAt: { campaignTimestamp: 1 } },
    ])
      expect(() => npcChildAllocationsValue([{ ...child.allocation, ...extra }])).toThrow();
    expect(() => npcChildAllocationsValue([{ kind: 'TRAUMA_INSTANCE', id: 'TRAUMA/1' }])).toThrow();
    expect(() =>
      npcChildAllocationsValue([child.allocation, { kind: 'ITEM', id: id(50) }]),
    ).toThrow();
  });
  it('binds exactly one TRAUMA_INSTANCE to NPC016 REPLACE and an exact empty preparation', () => {
    const p = traumaPair();
    expect(npcChildIdentities([p.event], [p.operation])).toHaveLength(1);
    for (const changed of [
      { ...p.operation, kind: 'COMMIT' as const },
      {
        ...p.operation,
        beforeGmSource: { ...p.operation.beforeGmSource, sourceFormId: 'NPC-015' as const },
      },
      {
        ...p.operation,
        request: {
          ...p.operation.request,
          preparation: { kind: 'TRAUMA_RESERVE', traumaValue: 1 },
        },
      },
    ])
      expect(() => npcChildIdentities([p.event], [changed])).toThrow();
    for (const facts of [
      [],
      [{ kind: 'ITEM', id: id(50) }],
      [
        { kind: 'TRAUMA_INSTANCE', id: id(50) },
        { kind: 'TRAUMA_INSTANCE', id: id(51) },
      ],
    ] as const) {
      const event = {
        ...p.event,
        format: 'NPC_ATTEMPT_EVENT_V2' as const,
        childAllocations: facts,
      };
      expect(() =>
        npcChildIdentities([event], [{ ...p.operation, attemptEventSha256: hash(event) }]),
      ).toThrow();
    }
  });
  it('separates pending and immutable proof and rejects foreign attempts, future revisions and mixed pending kinds', () => {
    const own = from(),
      foreign = from(8, 51),
      future = { ...from(4, 52), originRevision: 99 };
    const context = npcAttemptReadContext(
      attempt(),
      id(20),
      [own, foreign, future],
      null,
      null,
      null,
      id(53),
    );
    expect(context.traumaBindings).toEqual([
      {
        traumaInstanceId: id(50),
        originOperationId: own.originOperationId,
        originDraftId: id(4),
        originEventSha256: own.originEventSha256,
        retainedRowOrNull: null,
      },
    ]);
    expect(context.pendingTraumaOrNull).toEqual({
      traumaInstanceId: id(53),
      operationId: id(20),
      npcDraftId: id(4),
    });
    expect(Object.hasOwn(context.pendingTraumaOrNull ?? {}, 'originEventSha256')).toBe(false);
    expect(Object.isFrozen(context.traumaBindings[0])).toBe(true);
    for (const run of [
      () => npcAttemptReadContext(attempt(), id(20), [own], null, null, null, id(50)),
      () => npcAttemptReadContext(attempt(), id(20), [child()], null, null, null, id(10)),
      () => npcAttemptReadContext(attempt(), id(20), [own], null, id(50)),
      () =>
        npcAttemptReadContext(attempt(), id(20), [own], null, null, {
          effectInstanceId: id(50),
          diseaseId: 'DIS-RHINITIS',
        }),
      () => npcAttemptReadContext(attempt(), id(20), [], null, id(60), null, id(53)),
      () =>
        npcAttemptReadContext(
          attempt(),
          id(20),
          [],
          null,
          null,
          { effectInstanceId: id(60), diseaseId: 'DIS-RHINITIS' },
          id(53),
        ),
    ])
      expect(run).toThrow();
  });
  it('retains exact original COMMIT origin, refuses forged ownership and cannot revive removed or unselected IDs', () => {
    const own = from(),
      unselected = from(4, 51),
      trauma = { traumaInstanceId: id(50), originCommitOperationId: id(20), input: traumaInput() },
      graph = { items: [], effects: [], wounds: [], symbionts: [], traumas: [trauma] },
      first = version(),
      current = { ...attempt(), revision: 5 },
      context = npcAttemptReadContext(current, id(20), [own], null);
    expect(() => verifyNpcPublishedChildren(first, graph, null, [own], context)).not.toThrow();
    for (const changed of [
      { ...own, ownerNpcUuid: id(99) },
      { ...own, originDraftId: id(99) },
      { ...own, originEventSha256: 'f'.repeat(64) },
    ])
      expect(() => verifyNpcPublishedChildren(first, graph, null, [changed], context)).toThrow();
    const next: NpcAttempt = {
        ...attempt(8, 5),
        mode: 'APPEND_N_PLUS_ONE',
        targetOrNull: { npcUuid: first.npcUuid, expectedCurrentVersion: 1 },
      },
      second = { ...version(8), operationId: id(30), version: 2 },
      inherited = npcAttemptReadContext(next, id(30), [own, unselected], { version: first, graph });
    expect(inherited.traumaBindings.map((b) => b.traumaInstanceId)).toEqual([id(50)]);
    expect(inherited.traumaBindings[0]?.retainedRowOrNull).toEqual(traumaInput());
    expect(Object.isFrozen(inherited.traumaBindings[0]?.retainedRowOrNull?.input)).toBe(true);
    expect(() =>
      verifyNpcPublishedChildren(second, graph, graph, [own, unselected], inherited),
    ).not.toThrow();
    expect(() =>
      verifyNpcPublishedChildren(
        second,
        {
          ...graph,
          wounds: [],
          symbionts: [],
          traumas: [{ ...trauma, originCommitOperationId: id(30) }],
        },
        graph,
        [own, unselected],
        inherited,
      ),
    ).toThrow();
    const removed = { ...graph, wounds: [], symbionts: [], traumas: [] },
      afterRemoval = npcAttemptReadContext(next, id(30), [own, unselected], {
        version: first,
        graph: removed,
      });
    expect(afterRemoval.traumaBindings).toEqual([]);
    for (const traumaInstanceId of [id(50), id(51)])
      expect(() =>
        verifyNpcPublishedChildren(
          second,
          { ...graph, wounds: [], symbionts: [], traumas: [{ ...trauma, traumaInstanceId }] },
          removed,
          [own, unselected],
          afterRemoval,
        ),
      ).toThrow();
  });
  it('closes the recomputed graph and rejects duplicates across every child namespace', () => {
    const trauma = {
        traumaInstanceId: id(50),
        originCommitOperationId: id(20),
        input: traumaInput(),
      },
      graph = { items: [], effects: [], wounds: [], symbionts: [], traumas: [trauma] };
    expect(npcPublishedChildGraphValue(graph)).toEqual(graph);
    for (const changed of [
      { items: [], effects: [] },
      { ...graph, wounds: [], symbionts: [], traumas: [trauma, trauma] },
      { ...graph, wounds: [], symbionts: [], traumas: [{ ...trauma, traumaValue: 1 }] },
      { ...graph, wounds: [], symbionts: [], traumas: [{ ...trauma, input: traumaInput(51) }] },
      { ...graph, items: [{ itemInstanceId: id(50), profileVersions: [] }] },
      {
        ...graph,
        effects: [
          { effectInstanceId: id(50), diseaseId: 'DIS-RHINITIS', originCommitOperationId: id(20) },
        ],
      },
    ])
      expect(() => npcPublishedChildGraphValue(changed)).toThrow();
  });
});
