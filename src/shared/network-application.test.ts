import { beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadProtocolVocabulary } from '../host/protocol-vocabulary.js';
import {
  decodeClientMessageV3 as decodeCoreClientMessageV3,
  decodeHostMessageV3 as decodeCoreHostMessageV3,
} from './wire-v3-codec.js';
import {
  isNetworkApplicationProjection,
  encodeNetworkClientMessageV3,
  decodeNetworkHostMessageV3,
  encodeNetworkHostMessageV3,
  decodeNetworkGmRequestClientMessageV3,
  encodeNetworkGmRequestClientMessageV3,
  decodeNetworkGmRequestHostMessageV3,
  encodeNetworkGmRequestHostMessageV3,
  networkWorkflowPayloadValue,
  networkGmRequestProjectionValue,
  networkGmRequestDraftValues,
  networkGmRequestWorkflowPayloadValue,
  networkGmRequestDecisionReceiptValue,
} from './network-application-codec.js';
import {
  NETWORK_APPLICATION_FORM_IDS,
  type NetworkApplicationFormId,
  type NetworkDraftRefusalV3Message,
  type NetworkGmRequestDraftRefusalV3Message,
  type Net017Projection,
  type NetworkGmRequestCandidateSummary,
  type NetworkGmRequestDecisionReceipt,
  type NetworkGmRequestDraftReplaceV3Message,
  type NetworkGmRequestDraftResultV3Message,
} from './network-application.js';
import {
  decodeNetworkClientMessageV3,
  type NetworkDraftReplaceV3Message,
  type NetworkLocalContextResumeV3Message,
} from './device-admission.js';
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
let runtimeVocabulary: WireV2Vocabulary;
beforeAll(async () => {
  runtimeVocabulary = await loadProtocolVocabulary(resolve('.'));
  const source: unknown = JSON.parse(
    readFileSync(resolve('generated/spec/atlas/forms-by-id.json'), 'utf8'),
  );
  if (source === null || typeof source !== 'object' || Array.isArray(source))
    throw new Error('Expected source-backed Atlas form map');
  const forms = source as Record<string, unknown>;
  const fixtures = new Map<string, { type: 'screen'; route: string }>();
  for (const id of ['NET-005', 'NET-017', 'CMP-006']) {
    const candidate = forms[id];
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate))
      throw new Error(`Missing Atlas ${id}`);
    const metadata = candidate as Record<string, unknown>;
    if (
      metadata['id'] !== id ||
      metadata['type'] !== 'screen' ||
      typeof metadata['route'] !== 'string' ||
      !metadata['route'].includes(':campaignId')
    )
      throw new Error(`Invalid Atlas fixture metadata ${id}`);
    fixtures.set(id, { type: 'screen', route: metadata['route'] });
  }
  // A source-contract fixture deliberately supplies only these exact presentation bindings.
  // Production vocabulary remains unchanged; this does not register any runtime family.
  vocabulary = {
    ...runtimeVocabulary,
    isPresentedForm: (formId, formType, routeTemplate, bindings) => {
      const form = fixtures.get(formId);
      if (form === undefined)
        return runtimeVocabulary.isPresentedForm(formId, formType, routeTemplate, bindings);
      const binding = bindings[0];
      return (
        form.type === formType &&
        form.route === routeTemplate &&
        bindings.length === 1 &&
        binding?.parameterIndex === 0 &&
        binding.source === 'inherited' &&
        binding.value === id(5)
      );
    },
  };
});

const draft: NetworkDraftReplaceV3Message = {
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
  const campaignId = payload['campaignIdOrNull'];
  if (campaignId !== null && typeof campaignId !== 'string')
    throw new Error('Fixture must have a valid nullable campaign ID');
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
        formType: 'screen' as const,
        availableActionKeys: [],
        routeTemplate: `/player/campaigns/:campaignId/network/${formId.toLowerCase()}`,
        routeBindings: [
          {
            parameterIndex: 0,
            source: 'inherited' as const,
            value: campaignId ?? `unbound:${scopeId}`,
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
    for (const status of ['CANCELLED', 'ACCEPTED', 'ACTIVE', 'PRIVATE_STATUS'])
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
    const decoded = decodeNetworkClientMessageV3(JSON.stringify(draft));
    expect(decoded).toEqual({ ok: true, value: draft });
    for (const values of [
      { cancelReason: 1 },
      { cancelReason: null },
      { cancelReason: 'x', reason: 'x' },
    ])
      expect(decodeNetworkClientMessageV3(JSON.stringify({ ...draft, values })).ok).toBe(false);
    expect(
      decodeNetworkClientMessageV3(
        JSON.stringify({ ...draft, scope: { ...draft.scope, sourceFormId: 'NET-003' } }),
      ).ok,
    ).toBe(false);
  });
  it('keeps immutable applied facts separate from a current view with a new executor context', () => {
    const input = result();
    input.presentation.base.roleFilteredPayload['contextId'] = id(9);
    expect(decodeNetworkHostMessageV3(JSON.stringify(input), vocabulary).ok).toBe(true);
    input.appliedDraftRevision = 2;
    expect(decodeNetworkHostMessageV3(JSON.stringify(input), vocabulary).ok).toBe(false);
  });
  it('checks role, scope, current vector, exact route binding and absence of private payloads', () => {
    expect(decodeNetworkHostMessageV3(JSON.stringify(result()), vocabulary).ok).toBe(true);
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
      expect(decodeNetworkHostMessageV3(JSON.stringify(input), vocabulary).ok).toBe(false);
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
      // Approved GM workflows still cannot enter the separate player payload decoder.
      networkWorkflowPayloadValue(
        ['UI', 'CMD', 'DEVICE', 'REQUEST', 'ACCEPT', 'TO', 'REVIEW'].join('-'),
        payload,
      ),
    ).toThrow();
  });
});

const gmBatch: readonly NetworkGmRequestCandidateSummary[] = [
  {
    sourceUuid: 'historical-v8-source',
    snapshotChecksum: 'b'.repeat(64),
    name: 'Одинаковое имя',
    sourceSnapshotId: 'snapshot:one',
    localControllerSeatId: id(4),
  },
  {
    sourceUuid: 'another-source',
    snapshotChecksum: 'c'.repeat(64),
    name: 'Одинаковое имя',
    sourceSnapshotId: 'snapshot:two',
    localControllerSeatId: id(4),
  },
];
const gmProjection: Net017Projection = {
  contextId: id(20),
  campaignId: id(5),
  stateRevision: 1,
  projectionRevision: 2,
  requestQueueRevision: 1,
  requests: [
    {
      requestId: 'request:one',
      requestOwnerDeviceId: id(3),
      requestStatus: 'PENDING',
      requestRevision: 0,
      connectionState: 'CONNECTED_TECHNICAL',
      batchCharacterSummaries: gmBatch,
      requestedCandidateCount: 2,
      gmMessageOrNull: null,
      decisionReceiptIdOrNull: null,
    },
  ],
  selectedRequestIdOrNull: 'request:one',
  activePlayerCapacity: 3,
  occupiedActivePcCount: 2,
  decisionReason: '',
  commandId: null,
  returnContext: {
    originFormId: 'CMP-006',
    campaignId: id(5),
    creationReceiptId: 'created:receipt',
  },
};
const reviewReceipt: NetworkGmRequestDecisionReceipt = {
  receiptId: 'review:receipt',
  commandId: 'review:command',
  workflowCommandId: 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
  campaignId: id(5),
  requestId: 'request:one',
  requestOwnerDeviceId: id(3),
  beforeRequestStatus: 'PENDING',
  afterRequestStatus: 'IN_REVIEW',
  beforeRequestRevision: 0,
  requestRevision: 1,
  decisionReasonOrNull: null,
  candidateSnapshotChecksums: gmBatch.map((row) => row.snapshotChecksum),
  authoritativeGmActorId: 'authoritative:gm',
  timestamp: '2026-10-30T12:00:00.000Z',
};
const withoutField = (value: object, key: string) =>
  Object.fromEntries(Object.entries(value).filter(([field]) => field !== key));

describe('Atlas 1.6 separate GM request-review values', () => {
  it('accepts all four own request statuses without admitting a foreign owner or widening player capabilities', () => {
    for (const requestStatus of ['PENDING', 'IN_REVIEW', 'REJECTED', 'PROPOSED']) {
      const payload = { ...fixtures['NET-005'], requestStatus, gmMessage: 'Публичный ответ' };
      expect(isNetworkApplicationProjection('NET-005', payload)).toBe(true);
      expect(
        isNetworkApplicationProjection('NET-005', { ...payload, requestOwnerDeviceId: id(9) }),
      ).toBe(false);
      expect(
        isNetworkApplicationProjection('NET-005', { ...payload, requests: gmProjection.requests }),
      ).toBe(false);
    }
    expect(NETWORK_APPLICATION_FORM_IDS).not.toContain('NET-017');
    expect(isNetworkApplicationProjection('NET-005', gmProjection)).toBe(false);
    expect(() => networkGmRequestProjectionValue(fixtures['NET-005'])).toThrow();
  });
  it('accepts a genuinely empty queue and preserves duplicate display names without reserving capacity', () => {
    expect(networkGmRequestProjectionValue(gmProjection)).toEqual(gmProjection);
    // Two candidates exceed one remaining slot, but preliminary review is not admission.
    expect(gmProjection.requests[0]!.requestedCandidateCount).toBe(2);
    const empty = { ...gmProjection, requests: [], selectedRequestIdOrNull: null };
    expect(networkGmRequestProjectionValue(empty)).toEqual(empty);
    expect(() =>
      networkGmRequestProjectionValue({ ...empty, selectedRequestIdOrNull: 'request:one' }),
    ).toThrow();
  });
  it('rejects every missing top-level field and every player, private, or authority substitution', () => {
    for (const key of Object.keys(gmProjection))
      expect(() => networkGmRequestProjectionValue(withoutField(gmProjection, key))).toThrow();
    for (const key of [
      'networkScopeId',
      'deviceId',
      'controllerSeat',
      'actorVisibilityRevision',
      'draftRevision',
      'role',
      'masterAuthorityRevision',
      'canonicalWitnessText',
      'privateKeyPkcs8Base64',
    ]) {
      expect(() =>
        networkGmRequestProjectionValue({ ...gmProjection, [key]: 'private-marker' }),
      ).toThrow();
    }
    for (const key of [
      'stateRevision',
      'projectionRevision',
      'requestQueueRevision',
      'occupiedActivePcCount',
    ]) {
      for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
        expect(() => networkGmRequestProjectionValue({ ...gmProjection, [key]: value })).toThrow();
    }
  });
  it('closes each queue row and candidate summary, rejecting cancelled rows, changed counts and duplicate IDs', () => {
    const row = gmProjection.requests[0]!;
    for (const key of Object.keys(row))
      expect(() =>
        networkGmRequestProjectionValue({ ...gmProjection, requests: [withoutField(row, key)] }),
      ).toThrow();
    for (const change of [
      { requestStatus: 'CANCELLED' },
      { requestRevision: -1 },
      { connectionState: 'IN_REVIEW' },
      { requestedCandidateCount: 1 },
      { requestedCandidateCount: 0 },
      { privateSecret: 'private' },
    ]) {
      expect(() =>
        networkGmRequestProjectionValue({ ...gmProjection, requests: [{ ...row, ...change }] }),
      ).toThrow();
    }
    expect(() =>
      networkGmRequestProjectionValue({ ...gmProjection, requests: [row, row] }),
    ).toThrow();
    for (const batch of [[], [...gmBatch, ...gmBatch], [gmBatch[0], gmBatch[0]]])
      expect(() =>
        networkGmRequestProjectionValue({
          ...gmProjection,
          requests: [
            { ...row, batchCharacterSummaries: batch, requestedCandidateCount: batch.length },
          ],
        }),
      ).toThrow();
    for (const key of Object.keys(gmBatch[0]!)) {
      const batch = [withoutField(gmBatch[0]!, key), gmBatch[1]!];
      expect(() =>
        networkGmRequestProjectionValue({
          ...gmProjection,
          requests: [{ ...row, batchCharacterSummaries: batch }],
        }),
      ).toThrow();
    }
    for (const change of [
      { snapshotChecksum: 'B'.repeat(64) },
      { localControllerSeatId: 'invented-seat' },
      { campaignCharacterId: id(50) },
      { candidateSnapshotChecksum: hash },
      { sourceChecksum: hash },
    ]) {
      expect(() =>
        networkGmRequestProjectionValue({
          ...gmProjection,
          requests: [
            { ...row, batchCharacterSummaries: [{ ...gmBatch[0], ...change }, gmBatch[1]] },
          ],
        }),
      ).toThrow();
    }
  });
  it('accepts only the three closed host return contexts bound to this campaign', () => {
    for (const returnContext of [
      gmProjection.returnContext,
      { originFormId: 'GM-002', campaignId: id(5) },
      { originFormId: 'CMP-009', campaignId: id(5) },
    ]) {
      expect(
        networkGmRequestProjectionValue({ ...gmProjection, returnContext }).returnContext,
      ).toEqual(returnContext);
    }
    for (const returnContext of [
      { originFormId: 'CMP-006', campaignId: id(5) },
      { ...gmProjection.returnContext, campaignId: id(9) },
      { ...gmProjection.returnContext, returnTo: 'NET-021' },
      { originFormId: 'GM-002', campaignId: id(5), creationReceiptId: 'extra' },
      { originFormId: 'CMP-007', campaignId: id(5) },
    ]) {
      expect(() => networkGmRequestProjectionValue({ ...gmProjection, returnContext })).toThrow();
    }
  });
  it('keeps draft values nonexecuting and preserves exact reason bytes until the reject command validates them', () => {
    for (const decisionReason of ['', '  ', '  Публичная причина\nвторая строка  ']) {
      const values = { selectedRequestIdOrNull: null, decisionReason };
      expect(networkGmRequestDraftValues(values)).toEqual(values);
    }
    for (const values of [
      { selectedRequestIdOrNull: null },
      { selectedRequestIdOrNull: '', decisionReason: '' },
      { selectedRequestIdOrNull: null, decisionReason: 1 },
      { selectedRequestIdOrNull: null, decisionReason: '', contextId: id(20) },
    ]) {
      expect(() => networkGmRequestDraftValues(values)).toThrow();
    }
  });
  it('accepts exactly the two source payloads, rejecting guessed scope/authority and blank rejection', () => {
    const accept = { campaignId: id(5), requestId: 'request:one', requestRevision: 0 };
    const reject = { ...accept, reason: '  Публичная причина  ' };
    expect(
      networkGmRequestWorkflowPayloadValue('UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW', accept),
    ).toEqual(accept);
    expect(networkGmRequestWorkflowPayloadValue('UI-CMD-DEVICE-REQUEST-REJECT', reject)).toEqual(
      reject,
    );
    for (const [workflow, value] of [
      ['UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW', accept],
      ['UI-CMD-DEVICE-REQUEST-REJECT', reject],
    ] as const) {
      for (const key of Object.keys(value))
        expect(() =>
          networkGmRequestWorkflowPayloadValue(workflow, withoutField(value, key)),
        ).toThrow();
      for (const key of [
        'networkScopeId',
        'contextId',
        'role',
        'authoritativeGmActorId',
        'masterAuthorityRevision',
        'requestedControllerSeat',
      ])
        expect(() =>
          networkGmRequestWorkflowPayloadValue(workflow, { ...value, [key]: id(50) }),
        ).toThrow();
      for (const requestRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
        expect(() =>
          networkGmRequestWorkflowPayloadValue(workflow, { ...value, requestRevision }),
        ).toThrow();
    }
    expect(() =>
      networkGmRequestWorkflowPayloadValue('UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW', reject),
    ).toThrow();
    expect(() =>
      networkGmRequestWorkflowPayloadValue('UI-CMD-DEVICE-REQUEST-REJECT', {
        ...reject,
        reason: ' \n\t',
      }),
    ).toThrow();
    expect(() =>
      networkGmRequestWorkflowPayloadValue('UI-CMD-DEVICE-REQUEST-CANCEL', reject),
    ).toThrow();
  });
  it('binds receipt transition, one request revision and ordered exact submitted export digests', () => {
    expect(networkGmRequestDecisionReceiptValue(reviewReceipt, gmBatch)).toEqual(reviewReceipt);
    for (const beforeRequestStatus of ['PENDING', 'IN_REVIEW']) {
      const rejected = {
        ...reviewReceipt,
        workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
        beforeRequestStatus,
        afterRequestStatus: 'REJECTED',
        decisionReasonOrNull: '  Публичная причина  ',
      };
      expect(networkGmRequestDecisionReceiptValue(rejected, gmBatch)).toEqual(rejected);
    }
    for (const key of Object.keys(reviewReceipt))
      expect(() =>
        networkGmRequestDecisionReceiptValue(withoutField(reviewReceipt, key), gmBatch),
      ).toThrow();
    for (const change of [
      { beforeRequestStatus: 'IN_REVIEW' },
      { afterRequestStatus: 'PROPOSED' },
      { decisionReasonOrNull: 'not applicable' },
      { requestRevision: 0 },
      { requestRevision: 2 },
      { beforeRequestRevision: Number.MAX_SAFE_INTEGER, requestRevision: Number.MAX_SAFE_INTEGER },
      { candidateSnapshotChecksums: [] },
      { candidateSnapshotChecksums: [hash, hash] },
      { candidateSnapshotChecksums: [...reviewReceipt.candidateSnapshotChecksums].reverse() },
      { candidateSnapshotChecksums: [gmBatch[0]!.snapshotChecksum] },
      { campaignCharacterId: id(50) },
      { controllerSeat: id(4) },
    ]) {
      expect(() =>
        networkGmRequestDecisionReceiptValue({ ...reviewReceipt, ...change }, gmBatch),
      ).toThrow();
    }
    for (const beforeRequestStatus of ['REJECTED', 'CANCELLED', 'PROPOSED'])
      expect(() =>
        networkGmRequestDecisionReceiptValue(
          {
            ...reviewReceipt,
            workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
            beforeRequestStatus,
            afterRequestStatus: 'REJECTED',
            decisionReasonOrNull: 'reason',
          },
          gmBatch,
        ),
      ).toThrow();
    expect(() =>
      networkGmRequestDecisionReceiptValue(
        {
          ...reviewReceipt,
          workflowCommandId: 'UI-CMD-DEVICE-REQUEST-REJECT',
          afterRequestStatus: 'REJECTED',
          decisionReasonOrNull: '  ',
        },
        gmBatch,
      ),
    ).toThrow();
  });
});

const gmDraftScope = {
  gmLocalContextId: id(20),
  campaignId: id(5),
  sourceFormId: 'NET-017',
} as const;
const gmDraftMessage: NetworkGmRequestDraftReplaceV3Message = {
  messageType: 'network.gm-request-draft.replace',
  protocolVersion: 3,
  draftUpdateId: 'gm-edit:one',
  scope: gmDraftScope,
  expectedRevisions: { stateRevision: 1, projectionRevision: 2, actorVisibilityRevision: 0 },
  expectedRequestQueueRevision: 1,
  values: {
    selectedRequestIdOrNull: 'request:one',
    decisionReason: '  Публичная причина\nвторая строка  ',
  },
};
function gmWireResult(
  formId: 'NET-017' | 'CMP-006' = 'NET-017',
): NetworkGmRequestDraftResultV3Message {
  const revisions = { stateRevision: 4, projectionRevision: 8, actorVisibilityRevision: 0 };
  const payload: JsonObject =
    formId === 'NET-017'
      ? { ...gmProjection, ...{ stateRevision: 4, projectionRevision: 8, requestQueueRevision: 3 } }
      : {
          gmLocalContextId: id(20),
          hostDeviceId: id(60),
          masterAuthorityRevision: 0,
          routeIdentityKind: 'CAMPAIGN',
          campaignId: id(5),
          sourceCampaignDraftId: 'created-draft',
          status: 'PAUSED',
          createdAt: '2026-10-30T12:00:00.000Z',
          hostAddress: '127.0.0.1',
          hostPort: 41337,
          networkInterface: 'Loopback',
          qrPayload: 'http://127.0.0.1:41337/?campaignId=' + id(5),
          activePlayerCapacity: 3,
          creationReceiptId: 'created:receipt',
          creationCommandId: 'created:command',
          hostBindRecovery: { status: 'RESERVED', reasonCode: null },
        };
  return {
    messageType: 'network.gm-request-draft.result',
    protocolVersion: 3,
    draftUpdateId: gmDraftMessage.draftUpdateId,
    scope: gmDraftScope,
    changed: true,
    appliedRevisions: gmDraftMessage.expectedRevisions,
    appliedRequestQueueRevision: 1,
    revisions,
    requestQueueRevision: 3,
    projectionRole: 'gm',
    presentation: {
      base: {
        formId,
        formType: 'screen',
        availableActionKeys: [],
        routeTemplate:
          formId === 'NET-017'
            ? '/master/campaigns/:campaignId/network/net-017'
            : '/master/campaigns/:campaignId/campaign/cmp-006',
        routeBindings: [{ parameterIndex: 0, source: 'inherited', value: id(5) }],
        roleFilteredPayload: payload,
      },
      layers: [],
    },
  };
}
const decodeGmClient = (value: unknown) =>
  decodeNetworkGmRequestClientMessageV3(JSON.stringify(value));
const decodeGmHost = (value: unknown) =>
  decodeNetworkGmRequestHostMessageV3(JSON.stringify(value), vocabulary);

describe('separate GM request-review wire v3 family', () => {
  it('round-trips exact GM draft values without a player scope or a separate draft revision', () => {
    const encoded = encodeNetworkGmRequestClientMessageV3(gmDraftMessage);
    expect(encoded.ok).toBe(true);
    const decoded = decodeGmClient(gmDraftMessage);
    expect(decoded).toEqual({ ok: true, value: gmDraftMessage });
    expect(gmDraftMessage.values.decisionReason).toBe('  Публичная причина\nвторая строка  ');
    for (const key of Object.keys(gmDraftMessage))
      expect(decodeGmClient(withoutField(gmDraftMessage, key)).ok).toBe(false);
    for (const key of Object.keys(gmDraftScope))
      expect(decodeGmClient({ ...gmDraftMessage, scope: withoutField(gmDraftScope, key) }).ok).toBe(
        false,
      );
    for (const key of ['networkScopeId', 'controllerSeat', 'contextId', 'masterAuthorityRevision'])
      expect(
        decodeGmClient({ ...gmDraftMessage, scope: { ...gmDraftScope, [key]: id(40) } }).ok,
      ).toBe(false);
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      expect(decodeGmClient({ ...gmDraftMessage, expectedRequestQueueRevision: value }).ok).toBe(
        false,
      );
    expect(decodeGmClient({ ...gmDraftMessage, expectedDraftRevision: 0 }).ok).toBe(false);
    expect(
      decodeGmClient({ ...gmDraftMessage, scope: { ...gmDraftScope, sourceFormId: 'NET-005' } }).ok,
    ).toBe(false);
    expect(
      decodeGmClient({ ...gmDraftMessage, values: { ...gmDraftMessage.values, role: 'gm' } }).ok,
    ).toBe(false);
  });
  it('does not parse GM messages as player drafts or accept a different outer protocol version', () => {
    expect(decodeGmClient({ ...gmDraftMessage, messageType: 'network.draft.replace' }).ok).toBe(
      false,
    );
    expect(decodeGmClient({ ...draft, messageType: 'network.gm-request-draft.replace' }).ok).toBe(
      false,
    );
    for (const version of [1, 2, 4])
      expect(decodeGmClient({ ...gmDraftMessage, protocolVersion: version }).ok).toBe(false);
    const failed = decodeGmClient({
      ...gmDraftMessage,
      scope: { ...gmDraftScope, privateKey: 'private-gm-sentinel' },
    });
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('private-gm-sentinel');
    expect(decodeGmClient(gmWireResult()).ok).toBe(false);
    expect(decodeGmHost(gmDraftMessage).ok).toBe(false);
  });
  it.each(['NET-017', 'CMP-006'] as const)(
    'keeps old applied facts while delivering current same-scope %s',
    (form) => {
      const value = gmWireResult(form),
        decoded = decodeGmHost(value);
      expect(decoded).toEqual({ ok: true, value });
      expect(encodeNetworkGmRequestHostMessageV3(value, vocabulary).ok).toBe(true);
      expect(value.appliedRevisions.projectionRevision).toBe(2);
      expect(value.revisions.projectionRevision).toBe(8);
      for (const key of Object.keys(value))
        expect(decodeGmHost(withoutField(value, key)).ok).toBe(false);
      expect(decodeGmHost({ ...value, scope: { ...value.scope, campaignId: id(9) } }).ok).toBe(
        false,
      );
      expect(
        decodeGmHost({ ...value, scope: { ...value.scope, gmLocalContextId: id(9) } }).ok,
      ).toBe(false);
      expect(
        decodeGmHost({
          ...value,
          presentation: {
            ...value.presentation,
            base: {
              ...value.presentation.base,
              routeBindings: [{ parameterIndex: 0, source: 'inherited', value: id(9) }],
            },
          },
        }).ok,
      ).toBe(false);
      const payload = value.presentation.base.roleFilteredPayload;
      for (const key of Object.keys(payload))
        expect(
          decodeGmHost({
            ...value,
            presentation: {
              ...value.presentation,
              base: { ...value.presentation.base, roleFilteredPayload: withoutField(payload, key) },
            },
          }).ok,
        ).toBe(false);
      expect(
        decodeGmHost({
          ...value,
          presentation: {
            ...value.presentation,
            base: {
              ...value.presentation.base,
              roleFilteredPayload: { ...payload, canonicalWitnessText: 'private-gm-sentinel' },
            },
          },
        }).ok,
      ).toBe(false);
    },
  );
  it('rejects current vector/queue regression, mismatched inner vectors and other projection families', () => {
    const value = gmWireResult();
    for (const change of [
      { changed: 'yes' },
      { projectionRole: 'player' },
      { requestQueueRevision: 0 },
      { revisions: { ...value.revisions, stateRevision: 0 } },
      { revisions: { ...value.revisions, projectionRevision: 1 } },
      { appliedRevisions: { ...value.appliedRevisions, actorVisibilityRevision: 1 } },
      { appliedRequestQueueRevision: 4 },
      { draftRevision: 1 },
    ])
      expect(decodeGmHost({ ...value, ...change }).ok).toBe(false);
    for (const change of [
      { stateRevision: 3 },
      { projectionRevision: 7 },
      { requestQueueRevision: 2 },
    ])
      expect(
        decodeGmHost({
          ...value,
          presentation: {
            ...value.presentation,
            base: {
              ...value.presentation.base,
              roleFilteredPayload: { ...value.presentation.base.roleFilteredPayload, ...change },
            },
          },
        }).ok,
      ).toBe(false);
    expect(
      decodeGmHost({
        ...value,
        presentation: { ...value.presentation, layers: [value.presentation.base] },
      }).ok,
    ).toBe(false);
    expect(decodeGmHost({ ...value, presentation: result().presentation }).ok).toBe(false);
    expect(
      decodeGmHost({
        ...value,
        presentation: {
          ...value.presentation,
          base: { ...value.presentation.base, formId: 'APP-011' },
        },
      }).ok,
    ).toBe(false);
  });
  it('keeps refusal codes closed and binds stale actual revisions to the current envelope', () => {
    const revisions = { stateRevision: 4, projectionRevision: 8, actorVisibilityRevision: 0 };
    const message = {
      messageType: 'network.gm-request-draft.refusal',
      protocolVersion: 3,
      draftUpdateId: gmDraftMessage.draftUpdateId,
      scope: gmDraftScope,
      revisions,
      presentationUnchanged: true,
    };
    const refusals = [
      { code: 'INVALID_FIELD', field: 'selectedRequestIdOrNull', reason: 'INVALID_VALUE' },
      { code: 'INVALID_FIELD', field: 'decisionReason', reason: 'INVALID_VALUE' },
      { code: 'STALE_REVISION', expected: gmDraftMessage.expectedRevisions, actual: revisions },
      { code: 'STALE_QUEUE', expected: 1, actual: 3 },
      { code: 'IDEMPOTENCY_CONFLICT' },
      { code: 'DRAFT_UNAVAILABLE' },
      { code: 'REVISION_OVERFLOW' },
    ];
    for (const refusal of refusals) {
      const value = { ...message, refusal };
      expect(decodeGmHost(value)).toEqual({ ok: true, value });
      for (const key of Object.keys(refusal))
        expect(decodeGmHost({ ...message, refusal: withoutField(refusal, key) }).ok).toBe(false);
      expect(
        decodeGmHost({ ...message, refusal: { ...refusal, detail: 'private-gm-sentinel' } }).ok,
      ).toBe(false);
    }
    for (const refusal of [
      { code: 'STALE_DRAFT', expected: 0, actual: 1 },
      { code: 'STALE_QUEUE', expected: -1, actual: 3 },
      {
        code: 'STALE_REVISION',
        expected: gmDraftMessage.expectedRevisions,
        actual: gmDraftMessage.expectedRevisions,
      },
      { code: 'INVALID_FIELD', field: 'controllerSeat', reason: 'INVALID_VALUE' },
      { code: 'INVALID_FIELD', field: 'decisionReason', reason: 'INVALID_VERIFIER' },
    ])
      expect(decodeGmHost({ ...message, refusal }).ok).toBe(false);
    expect(
      decodeGmHost({
        ...message,
        presentationUnchanged: false,
        refusal: { code: 'DRAFT_UNAVAILABLE' },
      }).ok,
    ).toBe(false);
  });
});

const playerRefusal: NetworkDraftRefusalV3Message = {
  protocolVersion: 3,
  messageType: 'network.draft.refusal',
  draftUpdateId: draft.draftUpdateId,
  scope: draft.scope,
  revisions: draft.expectedRevisions,
  presentationUnchanged: true,
  refusal: { code: 'DRAFT_UNAVAILABLE' },
};
const gmRefusal: NetworkGmRequestDraftRefusalV3Message = {
  protocolVersion: 3,
  messageType: 'network.gm-request-draft.refusal',
  draftUpdateId: gmDraftMessage.draftUpdateId,
  scope: gmDraftMessage.scope,
  revisions: gmDraftMessage.expectedRevisions,
  presentationUnchanged: true,
  refusal: { code: 'DRAFT_UNAVAILABLE' },
};
const resume: NetworkLocalContextResumeV3Message = {
  protocolVersion: 3,
  messageType: 'network.local-context.resume',
  networkScopeId: id(1),
  reconnectRequestId: 'source-resume',
  knownRevisions: {
    stateRevision: common.stateRevision,
    projectionRevision: common.projectionRevision,
    actorVisibilityRevision: common.actorVisibilityRevision,
  },
  supportedWorkflowCommandIds: [
    'UI-CMD-CONNECTION-OPEN',
    'UI-CMD-DEVICE-REQUEST-SUBMIT',
    'UI-CMD-DEVICE-REQUEST-CANCEL',
  ],
  unacknowledgedCommandIds: [],
};
describe('standalone network codecs without core wire-v3 registration', () => {
  it('round-trips both player client contracts and both host reply kinds through their standalone codecs', () => {
    for (const message of [draft, resume]) {
      const encoded = encodeNetworkClientMessageV3(message);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) throw new Error('Expected standalone encoding');
      expect(decodeNetworkClientMessageV3(encoded.text)).toEqual({ ok: true, value: message });
    }
    for (const message of [result(), playerRefusal]) {
      const decoded = decodeNetworkHostMessageV3(JSON.stringify(message), vocabulary);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) throw new Error('Expected standalone decoding');
      const encoded = encodeNetworkHostMessageV3(decoded.value, vocabulary);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) throw new Error('Expected standalone encoding');
      expect(decodeNetworkHostMessageV3(encoded.text, vocabulary)).toEqual({
        ok: true,
        value: message,
      });
    }
    const gmEncoded = encodeNetworkGmRequestClientMessageV3(gmDraftMessage);
    expect(gmEncoded.ok).toBe(true);
    if (!gmEncoded.ok) throw new Error('Expected GM encoding');
    expect(decodeNetworkGmRequestClientMessageV3(gmEncoded.text)).toEqual({
      ok: true,
      value: gmDraftMessage,
    });
    for (const message of [gmWireResult(), gmWireResult('CMP-006'), gmRefusal]) {
      const encoded = encodeNetworkGmRequestHostMessageV3(message, vocabulary);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) throw new Error('Expected GM encoding');
      expect(decodeNetworkGmRequestHostMessageV3(encoded.text, vocabulary)).toEqual({
        ok: true,
        value: message,
      });
    }
  });
  it('keeps every new network message family rejected by the existing core wire-v3 decoder', () => {
    for (const message of [draft, resume, gmDraftMessage])
      expect(decodeCoreClientMessageV3(JSON.stringify(message), vocabulary).ok).toBe(false);
    for (const message of [
      result(),
      playerRefusal,
      gmWireResult(),
      gmWireResult('CMP-006'),
      gmRefusal,
    ])
      expect(decodeCoreHostMessageV3(JSON.stringify(message), vocabulary).ok).toBe(false);
  });
  it('limits the fixture vocabulary to exact Atlas type, route, campaign and inherited binding', () => {
    const forms = [
      result().presentation.base,
      gmWireResult().presentation.base,
      gmWireResult('CMP-006').presentation.base,
    ];
    for (const base of forms) {
      expect(
        vocabulary.isPresentedForm(
          base.formId,
          base.formType,
          base.routeTemplate,
          base.routeBindings,
        ),
      ).toBe(true);
      expect(
        vocabulary.isPresentedForm(base.formId, 'dialog', base.routeTemplate, base.routeBindings),
      ).toBe(false);
      expect(
        vocabulary.isPresentedForm(
          base.formId,
          base.formType,
          base.routeTemplate + '/extra',
          base.routeBindings,
        ),
      ).toBe(false);
      for (const bindings of [
        [],
        [{ parameterIndex: 0, source: 'inherited' as const, value: id(9) }],
        [{ parameterIndex: 1, source: 'inherited' as const, value: id(5) }],
        [{ parameterIndex: 0, source: 'executor-allocated' as const, value: id(5) }],
      ])
        expect(
          vocabulary.isPresentedForm(base.formId, base.formType, base.routeTemplate, bindings),
        ).toBe(false);
    }
    for (const base of forms.slice(0, 2))
      expect(
        runtimeVocabulary.isPresentedForm(
          base.formId,
          base.formType,
          base.routeTemplate,
          base.routeBindings,
        ),
      ).toBe(false);
    expect(vocabulary.isPresentedForm('APP-001', 'screen', '/', [])).toBe(
      runtimeVocabulary.isPresentedForm('APP-001', 'screen', '/', []),
    );
  });
  it('rejects raw non-string decoder input without coercion or diagnostic reflection', () => {
    const decoders: readonly ((source: string) => unknown)[] = [
      decodeNetworkClientMessageV3,
      (source) => decodeNetworkHostMessageV3(source, vocabulary),
      decodeNetworkGmRequestClientMessageV3,
      (source) => decodeNetworkGmRequestHostMessageV3(source, vocabulary),
    ];
    for (const decode of decoders) {
      const toString = () => {
        throw new Error('private-coercion-sentinel');
      };
      for (const input of [null, undefined, 1, true, [], { toString }]) {
        const parsed: unknown = Reflect.apply(decode, undefined, [input]);
        expect(parsed).toMatchObject({
          ok: false,
          refusal: { code: 'INVALID_SHAPE', path: '$', expected: 'JSON string' },
        });
        expect(JSON.stringify(parsed)).not.toContain('private-coercion-sentinel');
      }
      const malformed = decode('{"private-key-sentinel":');
      expect(malformed).toMatchObject({ ok: false, refusal: { code: 'MALFORMED_JSON' } });
      expect(JSON.stringify(malformed)).not.toContain('private-key-sentinel');
    }
  });
  it('redacts private unrecognized input fields for decoding and encoding in each standalone family', () => {
    const malformedPlayer = {
      ...draft,
      values: { cancelReason: 'Public', privateKey: 'private-source-sentinel' },
    };
    const malformedGm = {
      ...gmDraftMessage,
      values: { ...gmDraftMessage.values, privateKey: 'private-source-sentinel' },
    };
    const malformedHost = { ...result(), privateKey: 'private-source-sentinel' },
      malformedGmHost = { ...gmWireResult(), privateKey: 'private-source-sentinel' };
    const failures: readonly unknown[] = [
      decodeNetworkClientMessageV3(JSON.stringify(malformedPlayer)),
      decodeNetworkHostMessageV3(JSON.stringify(malformedHost), vocabulary),
      decodeNetworkGmRequestClientMessageV3(JSON.stringify(malformedGm)),
      decodeNetworkGmRequestHostMessageV3(JSON.stringify(malformedGmHost), vocabulary),
      Reflect.apply(encodeNetworkClientMessageV3, undefined, [malformedPlayer]),
      Reflect.apply(encodeNetworkHostMessageV3, undefined, [malformedHost, vocabulary]),
      Reflect.apply(encodeNetworkGmRequestClientMessageV3, undefined, [malformedGm]),
      Reflect.apply(encodeNetworkGmRequestHostMessageV3, undefined, [malformedGmHost, vocabulary]),
    ];
    for (const failure of failures) {
      expect(failure).toMatchObject({ ok: false });
      expect(JSON.stringify(failure)).not.toContain('private-source-sentinel');
    }
  });
  it('redacts unknown property names when the encoder JSON prewalk refuses non-JSON values', () => {
    const secretKey = 'private-property-name-sentinel',
      secretValue = 'private-property-value-sentinel';
    const circular: Record<string, unknown> = { secretValue };
    circular[secretKey] = circular;
    const nonJsonValues: readonly unknown[] = [
      undefined,
      1n,
      () => secretValue,
      Symbol(secretValue),
      circular,
    ];
    const families: readonly {
      message: object;
      encode: (value: unknown) => unknown;
    }[] = [
      {
        message: draft,
        encode: (value) => {
          const failure: unknown = Reflect.apply(encodeNetworkClientMessageV3, undefined, [value]);
          return failure;
        },
      },
      {
        message: result(),
        encode: (value) => {
          const failure: unknown = Reflect.apply(encodeNetworkHostMessageV3, undefined, [
            value,
            vocabulary,
          ]);
          return failure;
        },
      },
      {
        message: gmDraftMessage,
        encode: (value) => {
          const failure: unknown = Reflect.apply(encodeNetworkGmRequestClientMessageV3, undefined, [
            value,
          ]);
          return failure;
        },
      },
      {
        message: gmWireResult(),
        encode: (value) => {
          const failure: unknown = Reflect.apply(encodeNetworkGmRequestHostMessageV3, undefined, [
            value,
            vocabulary,
          ]);
          return failure;
        },
      },
    ];
    for (const { message, encode } of families) {
      for (const value of nonJsonValues) {
        for (const malformed of [
          { ...message, [secretKey]: value },
          { ...message, [secretKey]: { [secretKey]: value } },
        ]) {
          const failure = encode(malformed);
          expect(failure).toMatchObject({
            ok: false,
            refusal: { code: 'INVALID_SHAPE', path: '$' },
          });
          expect(JSON.stringify(failure)).not.toContain(secretKey);
          expect(JSON.stringify(failure)).not.toContain(secretValue);
        }
      }
    }
  });
});
