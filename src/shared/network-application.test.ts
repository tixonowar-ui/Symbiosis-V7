import { beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadProtocolVocabulary } from '../host/protocol-vocabulary.js';
import { decodeClientMessageV3, decodeHostMessageV3 } from './wire-v3-codec.js';
import {
  isNetworkApplicationProjection,
  networkWorkflowPayloadValue,
} from './network-application-codec.js';
import {
  NETWORK_APPLICATION_FORM_IDS,
  type NetworkApplicationFormId,
} from './network-application.js';
import type { JsonObject, JsonValue } from './wire-protocol.js';
import type { WireV2Vocabulary } from './wire-v2-protocol.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = 'a'.repeat(64);
const common = {
  networkScopeId: id(1),
  contextId: id(2),
  deviceId: id(3),
  controllerSeat: id(4),
  stateRevision: 2,
  projectionRevision: 3,
  actorVisibilityRevision: 0,
  draftRevision: 1,
  campaignIdOrNull: null,
  connectionState: 'NO_TECHNICAL_SESSION',
  pendingCommandIdOrNull: null,
};
const ref = {
  sourceUuid: 'historical-v8-source',
  finalSnapshotVersion: 1,
  metadataRevision: 0,
  candidateSnapshotChecksum: hash,
  requestedControllerSeat: id(4),
};
const summary = { ...ref, name: 'Проверенный персонаж', sourceSnapshotId: 'historical-final' };
const bound = { ...common, campaignIdOrNull: id(5), connectionState: 'CONNECTED_TECHNICAL' };
const forecast = {
  campaignRevision: 0,
  activePlayerCapacity: 3,
  activePcCount: 1,
  selectedCandidateCount: 1,
  fitsCurrentCapacity: true,
};
const fixtures: Readonly<Record<NetworkApplicationFormId, JsonObject>> = {
  'NET-001': {
    ...common,
    activeRole: 'PLAYER',
    discoveryState: 'COMPLETE',
    discoveredHosts: [],
    discoveryTruncated: false,
    lastAddressOrNull: null,
    returnContext: 'PLAYER_MENU',
    connectionAttemptIdOrNull: null,
  },
  'NET-002': {
    ...common,
    addressOrQrPayload: 'http://127.0.0.1:3000/',
    parsedHost: '127.0.0.1',
    parsedPort: 3000,
    protocolVersion: 3,
    campaignHintOrNull: null,
    parseStatus: 'VALID',
    parseDiagnostic: null,
    attemptId: id(6),
    commandId: null,
  },
  'NET-003': {
    ...bound,
    ownRequestIdOrNull: null,
    campaignId: id(5),
    campaignStatus: 'PAUSED',
    sessionId: id(7),
    connectionRevision: 0,
    eligibleFinalCandidates: [summary],
    selectedCandidates: [ref],
    capacityForecast: forecast,
  },
  'NET-004': {
    ...bound,
    sessionId: id(7),
    requestId: id(8),
    selectedLocalCharacterUuids: [ref.sourceUuid],
    snapshotChecksums: [{ localCharacterUuid: ref.sourceUuid, candidateSnapshotChecksum: hash }],
    campaignId: id(5),
    connectionRevision: 0,
    commandId: null,
    batchCharacterSummaries: [summary],
    capacityForecast: forecast,
  },
  'NET-005': {
    ...bound,
    sessionId: id(7),
    requestId: id(8),
    requestOwnerDeviceId: id(3),
    batchCharacterSummaries: [summary],
    requestStatus: 'PENDING',
    gmMessage: null,
    requestRevision: 0,
    cancelReason: 'Хочу выбрать другого персонажа',
    commandId: null,
  },
  'NET-011': {
    ...common,
    attemptId: id(6),
    retryAttemptIdOrNull: id(10),
    activeRole: 'PLAYER',
    activeSeatOrGm: id(4),
    lastAddressOrQrPayload: 'http://127.0.0.1:3000/',
    lastParsedHostPort: { hostAddress: '127.0.0.1', hostPort: 3000, campaignHintOrNull: null },
    errorCode: 'PEER_UNAVAILABLE',
    humanDiagnostic: 'Кампания недоступна. Проверьте адрес.',
    retryCount: 1,
    connectionState: 'UNAVAILABLE',
    lastConfirmedStateRevision: 2,
    lastConfirmedProjectionRevision: 3,
    resumeContextOrNull: null,
    localDataUntouched: true,
    commandId: null,
  },
  'CHR-027': {
    ...common,
    localCharacterUuid: ref.sourceUuid,
    finalSnapshotVersion: 1,
    candidateSnapshotChecksum: hash,
    eligibleCampaignIds: [id(5)],
    selectedCampaignId: null,
    requestedControllerSeat: null,
    sourceUuidAndProvenance: {
      registryVersion: 'registry',
      catalogVersion: 'catalog',
      builtAgainstTuple: 'tuple',
      sourceUuid: ref.sourceUuid,
      sourceSnapshotId: summary.sourceSnapshotId,
      metadataRevision: 0,
      sourceChecksum: hash,
      finalSaveReceiptId: 'historical-receipt',
      finalSnapshotVersion: 1,
    },
    submissionStatus: 'DRAFT',
    commandId: null,
  },
};
let vocabulary: WireV2Vocabulary;
beforeAll(async () => {
  vocabulary = await loadProtocolVocabulary(resolve('.'));
});
const draft = {
  messageType: 'network.draft.replace',
  protocolVersion: 3,
  draftUpdateId: 'edit-1',
  expectedDraftRevision: 0,
  expectedRevisions: { stateRevision: 1, projectionRevision: 2, actorVisibilityRevision: 0 },
  scope: { networkScopeId: id(1), contextId: id(2), sourceFormId: 'NET-005' },
  variant: 'CANCEL_REASON',
  values: { cancelReason: '  Передумал  ' },
};
function result(formId: NetworkApplicationFormId = 'NET-005') {
  const payload: Record<string, JsonValue> = structuredClone(fixtures[formId]);
  const scopeId = payload['networkScopeId'];
  if (typeof scopeId !== 'string') throw new Error('Fixture must contain a network scope');
  return {
    messageType: 'network.draft.result',
    protocolVersion: 3,
    draftUpdateId: 'edit-1',
    scope: draft.scope,
    changed: true,
    appliedDraftRevision: 1,
    appliedRevisions: { stateRevision: 2, projectionRevision: 3, actorVisibilityRevision: 0 },
    draftRevision: 1,
    revisions: { stateRevision: 2, projectionRevision: 3, actorVisibilityRevision: 0 },
    projectionRole: 'player',
    presentation: {
      base: {
        formId,
        formType: 'screen',
        availableActionKeys: [],
        routeTemplate: `/player/campaigns/:campaignId/network/${formId.toLowerCase()}`,
        routeBindings: [
          {
            parameterIndex: 0,
            source: 'inherited',
            value: payload['campaignIdOrNull'] ?? `unbound:${scopeId}`,
          },
        ],
        roleFilteredPayload: payload,
      },
      layers: [],
    },
  };
}

describe('closed #171 public projection boundary', () => {
  it.each(NETWORK_APPLICATION_FORM_IDS)(
    '%s accepts its complete own public shape and refuses every missing/extra top-level field',
    (formId) => {
      const input = fixtures[formId];
      expect(isNetworkApplicationProjection(formId, input)).toBe(true);
      for (const key of Object.keys(input)) {
        const missing = { ...input };
        delete missing[key];
        expect(isNetworkApplicationProjection(formId, missing), `${formId}:${key}`).toBe(false);
      }
      for (const key of [
        'privateKeyPkcs8Base64',
        'masterSecretVerifier',
        'gmQueue',
        'canonicalWitnessText',
        'campaignCharacterId',
      ])
        expect(isNetworkApplicationProjection(formId, { ...input, [key]: 'private' })).toBe(false);
    },
  );
  it('retains the assigned lane and exact selected versions without treating candidate count as actor seats', () => {
    const p = fixtures['NET-003'];
    const second = { ...summary, sourceUuid: 'second', name: 'Второй' };
    const selected = [ref, { ...ref, sourceUuid: 'second' }];
    expect(
      isNetworkApplicationProjection('NET-003', {
        ...p,
        eligibleFinalCandidates: [summary, second],
        selectedCandidates: selected,
        capacityForecast: { ...forecast, selectedCandidateCount: 2 },
      }),
    ).toBe(true);
    expect(
      isNetworkApplicationProjection('NET-003', {
        ...p,
        selectedCandidates: [{ ...ref, metadataRevision: 1 }],
      }),
    ).toBe(false);
    expect(
      isNetworkApplicationProjection('NET-003', {
        ...p,
        selectedCandidates: [{ ...ref, requestedControllerSeat: id(9) }],
      }),
    ).toBe(false);
    expect(
      isNetworkApplicationProjection('NET-003', {
        ...p,
        capacityForecast: { ...forecast, activePcCount: 3 },
      }),
    ).toBe(false);
  });
  it('rejects changed pinned order/checksums, foreign request owner and unsupported GM/authority states', () => {
    expect(
      isNetworkApplicationProjection('NET-004', {
        ...fixtures['NET-004'],
        selectedLocalCharacterUuids: ['other'],
      }),
    ).toBe(false);
    expect(
      isNetworkApplicationProjection('NET-004', {
        ...fixtures['NET-004'],
        snapshotChecksums: [
          { localCharacterUuid: ref.sourceUuid, candidateSnapshotChecksum: 'b'.repeat(64) },
        ],
      }),
    ).toBe(false);
    expect(
      isNetworkApplicationProjection('NET-005', {
        ...fixtures['NET-005'],
        requestOwnerDeviceId: id(9),
      }),
    ).toBe(false);
    for (const status of ['IN_REVIEW', 'REJECTED', 'PROPOSED', 'CANCELLED'])
      expect(
        isNetworkApplicationProjection('NET-005', {
          ...fixtures['NET-005'],
          requestStatus: status,
        }),
      ).toBe(false);
    for (const formId of NETWORK_APPLICATION_FORM_IDS)
      expect(
        isNetworkApplicationProjection(formId, {
          ...fixtures[formId],
          connectionState: 'CONNECTED_ADMITTED',
        }),
      ).toBe(false);
  });
  it('rejects a claimed valid parser with absent host, wrong protocol and a forged source provenance', () => {
    expect(
      isNetworkApplicationProjection('NET-002', { ...fixtures['NET-002'], parsedHost: null }),
    ).toBe(false);
    expect(
      isNetworkApplicationProjection('NET-002', { ...fixtures['NET-002'], protocolVersion: 4 }),
    ).toBe(false);
    expect(
      isNetworkApplicationProjection('CHR-027', {
        ...fixtures['CHR-027'],
        selectedCampaignId: id(9),
      }),
    ).toBe(false);
    expect(
      isNetworkApplicationProjection('CHR-027', {
        ...fixtures['CHR-027'],
        sourceUuidAndProvenance: {
          ...(fixtures['CHR-027']['sourceUuidAndProvenance'] as JsonObject),
          sourceChecksum: 'b'.repeat(64),
        },
      }),
    ).toBe(false);
  });
});
describe('network wire-v3 application drafts', () => {
  it('stores the exact local cancellation reason as input without a workflow execution', () => {
    const decoded = decodeClientMessageV3(JSON.stringify(draft), vocabulary);
    expect(decoded).toEqual({ ok: true, value: draft });
    for (const values of [
      { cancelReason: 1 },
      { cancelReason: null },
      { cancelReason: 'x', reason: 'x' },
    ])
      expect(decodeClientMessageV3(JSON.stringify({ ...draft, values }), vocabulary).ok).toBe(
        false,
      );
    expect(
      decodeClientMessageV3(
        JSON.stringify({ ...draft, scope: { ...draft.scope, sourceFormId: 'NET-003' } }),
        vocabulary,
      ).ok,
    ).toBe(false);
  });
  it('keeps immutable applied facts separate from a current view with a new executor context', () => {
    const input = result();
    input.presentation.base.roleFilteredPayload['contextId'] = id(9);
    expect(decodeHostMessageV3(JSON.stringify(input), vocabulary).ok).toBe(true);
    input.appliedDraftRevision = 2;
    expect(decodeHostMessageV3(JSON.stringify(input), vocabulary).ok).toBe(false);
  });
  it('checks role, scope, current vector, exact route binding and absence of private payloads', () => {
    expect(decodeHostMessageV3(JSON.stringify(result()), vocabulary).ok).toBe(true);
    const mutations = [
      (x: ReturnType<typeof result>) => {
        x.projectionRole = 'gm';
      },
      (x: ReturnType<typeof result>) => {
        x.presentation.base.roleFilteredPayload['networkScopeId'] = id(9);
      },
      (x: ReturnType<typeof result>) => {
        x.presentation.base.roleFilteredPayload['stateRevision'] = 1;
      },
      (x: ReturnType<typeof result>) => {
        x.presentation.base.routeBindings[0]!.value = id(9);
      },
      (x: ReturnType<typeof result>) => {
        x.presentation.base.roleFilteredPayload['canonicalWitnessText'] = 'private';
      },
    ];
    for (const mutate of mutations) {
      const input = result();
      mutate(input);
      expect(decodeHostMessageV3(JSON.stringify(input), vocabulary).ok).toBe(false);
    }
  });
  it('accepts only the exact source workflow payload and preserves nonblank reason bytes', () => {
    const payload = {
      networkScopeId: id(1),
      contextId: id(2),
      expectedDraftRevision: 1,
      requestId: id(8),
      technicalSessionId: id(7),
      requestRevision: 0,
      reason: '  Передумал  ',
    };
    expect(networkWorkflowPayloadValue('UI-CMD-DEVICE-REQUEST-CANCEL', payload)).toEqual(payload);
    expect(() =>
      networkWorkflowPayloadValue('UI-CMD-DEVICE-REQUEST-CANCEL', { ...payload, reason: '   ' }),
    ).toThrow();
    expect(() =>
      networkWorkflowPayloadValue('UI-CMD-DEVICE-REQUEST-CANCEL', { ...payload, role: 'gm' }),
    ).toThrow();
    expect(() =>
      // A rejected proposal is negative input, not a claim of an existing Atlas reference.
      networkWorkflowPayloadValue(
        ['UI', 'CMD', 'DEVICE', 'REQUEST', 'ACCEPT', 'TO', 'REVIEW'].join('-'),
        payload,
      ),
    ).toThrow();
  });
});
