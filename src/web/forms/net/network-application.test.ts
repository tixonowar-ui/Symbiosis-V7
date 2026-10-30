import { describe, expect, it } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { NetworkDraftReplaceV3Message } from '@shared/device-admission.js';
import {
  NETWORK_APPLICATION_FORM_IDS,
  type NetworkApplicationFormId,
  type NetworkDraftResultV3Message,
} from '@shared/network-application.js';
import {
  decodeNetworkProjection,
  expectedNetworkActions,
  isNetworkEditableForm,
  networkCancelPayload,
  networkDraftResultMatches,
  networkEditFromProjection,
  networkEditIsSendable,
  networkOpenPayload,
  networkSubmitPayload,
} from './network-application.js';

const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCOPE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTEXT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CAMPAIGN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SESSION = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const CHECKSUM = '1'.repeat(64);
const source = '0191c531-a155-8abc-8abc-111111111111';
const candidate = {
  sourceUuid: source,
  finalSnapshotVersion: 7,
  metadataRevision: 2,
  candidateSnapshotChecksum: CHECKSUM,
  requestedControllerSeat: SEAT,
};
const summary = { ...candidate, name: 'Алиса', sourceSnapshotId: 'final-snapshot-v8' };
const common = {
  networkScopeId: SCOPE,
  contextId: CONTEXT,
  deviceId: DEVICE,
  controllerSeat: SEAT,
  stateRevision: 8,
  projectionRevision: 10,
  actorVisibilityRevision: 0,
  draftRevision: 2,
  campaignIdOrNull: null,
  connectionState: 'NO_TECHNICAL_SESSION',
  pendingCommandIdOrNull: null,
};
const bound = { ...common, campaignIdOrNull: CAMPAIGN, connectionState: 'CONNECTED_TECHNICAL' };
const forecast = {
  campaignRevision: 0,
  activePlayerCapacity: 5,
  activePcCount: 3,
  selectedCandidateCount: 1,
  fitsCurrentCapacity: true,
};
const address = `http://192.168.1.20:3000/?campaignId=${CAMPAIGN}`;
const projections: Record<NetworkApplicationFormId, JsonObject> = {
  'NET-001': {
    ...common,
    activeRole: 'PLAYER',
    discoveryState: 'COMPLETE',
    discoveredHosts: [
      {
        campaignId: CAMPAIGN,
        title: 'Кампания',
        locator: { hostAddress: '192.168.1.20', hostPort: 3000, campaignHintOrNull: CAMPAIGN },
        campaignStatus: 'PAUSED',
        activePlayerCapacity: 5,
        activePcCount: 3,
        compatibility: 'COMPATIBLE',
      },
    ],
    discoveryTruncated: false,
    lastAddressOrNull: address,
    returnContext: 'PLAYER_MENU',
    connectionAttemptIdOrNull: null,
  },
  'NET-002': {
    ...common,
    addressOrQrPayload: address,
    parsedHost: '192.168.1.20',
    parsedPort: 3000,
    protocolVersion: 3,
    campaignHintOrNull: CAMPAIGN,
    parseStatus: 'VALID',
    parseDiagnostic: null,
    attemptId: ATTEMPT,
    commandId: null,
  },
  'NET-003': {
    ...bound,
    campaignId: CAMPAIGN,
    campaignStatus: 'PAUSED',
    sessionId: SESSION,
    connectionRevision: 0,
    eligibleFinalCandidates: [summary],
    selectedCandidates: [candidate],
    ownRequestIdOrNull: null,
    capacityForecast: forecast,
  },
  'NET-004': {
    ...bound,
    sessionId: SESSION,
    requestId: REQUEST,
    selectedLocalCharacterUuids: [source],
    snapshotChecksums: [{ localCharacterUuid: source, candidateSnapshotChecksum: CHECKSUM }],
    campaignId: CAMPAIGN,
    connectionRevision: 0,
    commandId: null,
    batchCharacterSummaries: [summary],
    capacityForecast: forecast,
  },
  'NET-005': {
    ...bound,
    sessionId: SESSION,
    requestId: REQUEST,
    requestOwnerDeviceId: DEVICE,
    batchCharacterSummaries: [summary],
    requestStatus: 'PENDING',
    gmMessage: null,
    requestRevision: 0,
    cancelReason: '',
    commandId: null,
  },
  'NET-011': {
    ...common,
    connectionState: 'UNAVAILABLE',
    attemptId: ATTEMPT,
    retryAttemptIdOrNull: REQUEST,
    activeRole: 'PLAYER',
    activeSeatOrGm: SEAT,
    lastAddressOrQrPayload: address,
    lastParsedHostPort: {
      hostAddress: '192.168.1.20',
      hostPort: 3000,
      campaignHintOrNull: CAMPAIGN,
    },
    errorCode: 'PEER_UNAVAILABLE',
    humanDiagnostic: 'Кампания сейчас недоступна.',
    retryCount: 1,
    lastConfirmedStateRevision: 8,
    lastConfirmedProjectionRevision: 10,
    resumeContextOrNull: null,
    localDataUntouched: true,
    commandId: null,
  },
  'CHR-027': {
    ...common,
    localCharacterUuid: source,
    finalSnapshotVersion: 7,
    candidateSnapshotChecksum: CHECKSUM,
    eligibleCampaignIds: [CAMPAIGN],
    selectedCampaignId: null,
    requestedControllerSeat: null,
    sourceUuidAndProvenance: {
      registryVersion: 'registry',
      catalogVersion: 'catalog',
      builtAgainstTuple: 'tuple',
      sourceUuid: source,
      sourceSnapshotId: 'final-snapshot-v8',
      metadataRevision: 2,
      sourceChecksum: CHECKSUM,
      finalSaveReceiptId: 'save-receipt-v8',
      finalSnapshotVersion: 7,
    },
    submissionStatus: 'DRAFT',
    commandId: null,
  },
};

describe('NET-001–005/011 and CHR-027 public application helpers', () => {
  it.each(NETWORK_APPLICATION_FORM_IDS)('accepts the exact %s public schema', (form) => {
    expect(decodeNetworkProjection(projections[form], '$.payload', form)).toEqual({
      ok: true,
      value: projections[form],
    });
  });
  it.each(NETWORK_APPLICATION_FORM_IDS)(
    'refuses private material and missing required fields in %s without echo',
    (form) => {
      for (const key of ['privateKeyPkcs8Base64', 'gmQueue', 'canonicalWitnessText']) {
        const result = decodeNetworkProjection(
          { ...projections[form], [key]: 'PRIVATE_SENTINEL' },
          '$.payload',
          form,
        );
        expect(result).toEqual({
          ok: false,
          refusal: { code: 'UNRECOGNIZED', path: '$.payload', value: null },
        });
        expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
      }
      const broken = { ...projections[form] };
      delete broken['networkScopeId'];
      expect(decodeNetworkProjection(broken, '$.payload', form).ok).toBe(false);
    },
  );
  it('refuses stale metadata, foreign input lanes and a false capacity forecast', () => {
    const p = projections['NET-003'];
    for (const selected of [
      [{ ...candidate, metadataRevision: 3 }],
      [{ ...candidate, requestedControllerSeat: CONTEXT }],
      [candidate, candidate],
    ])
      expect(
        decodeNetworkProjection({ ...p, selectedCandidates: selected }, '$', 'NET-003').ok,
      ).toBe(false);
    expect(
      decodeNetworkProjection(
        { ...p, capacityForecast: { ...forecast, activePcCount: 5 } },
        '$',
        'NET-003',
      ).ok,
    ).toBe(false);
  });
  it('keeps the original candidate checksum distinct from an export checksum', () => {
    const result = networkSubmitPayload('NET-004', projections['NET-004']);
    expect(result?.selectedCandidates).toEqual([candidate]);
    expect(result).not.toHaveProperty('exportDocument');
    expect(result).not.toHaveProperty('canonicalWitnessText');
    expect(result?.selectedCandidates[0]).not.toHaveProperty('name');
  });
  it('extracts only complete editable replacements and permits an empty local selection', () => {
    for (const form of NETWORK_APPLICATION_FORM_IDS.filter(isNetworkEditableForm)) {
      const edit = networkEditFromProjection(form, projections[form]);
      expect(edit).not.toBeNull();
      expect(networkEditIsSendable(edit!)).toBe(true);
    }
    expect(
      networkEditIsSendable({ variant: 'SELECTION', values: { selectedCandidates: [] } }),
    ).toBe(true);
    expect(
      networkEditIsSendable({
        variant: 'SELECTION',
        values: { selectedCandidates: [candidate, candidate] },
      }),
    ).toBe(false);
    expect(
      networkEditFromProjection('NET-003', { ...projections['NET-003'], gmQueue: [] }),
    ).toBeNull();
  });
  it('allows the same real input lane for three different candidates but refuses a fourth', () => {
    const selected = [0, 1, 2, 3].map((n) => ({ ...candidate, sourceUuid: `source-${n}` }));
    expect(
      networkEditIsSendable({
        variant: 'SELECTION',
        values: { selectedCandidates: selected.slice(0, 3) },
      }),
    ).toBe(true);
    expect(
      networkEditIsSendable({ variant: 'SELECTION', values: { selectedCandidates: selected } }),
    ).toBe(false);
  });
  it('builds OPEN only from the explicit unbound address or new-connect retry', () => {
    expect(networkOpenPayload('NET-002', projections['NET-002'])).toEqual({
      networkScopeId: SCOPE,
      contextId: CONTEXT,
      expectedDraftRevision: 2,
      attemptId: ATTEMPT,
      addressOrQrPayload: address,
      selectedCampaignIdOrNull: CAMPAIGN,
    });
    expect(networkOpenPayload('NET-011', projections['NET-011'])?.attemptId).toBe(REQUEST);
    expect(
      networkOpenPayload('NET-011', {
        ...projections['NET-011'],
        errorCode: 'UNCONFIRMED_OUTCOME',
      }),
    ).toBeNull();
    expect(
      networkOpenPayload('NET-002', {
        ...projections['NET-002'],
        pendingCommandIdOrNull: 'unresolved',
      }),
    ).toBeNull();
    expect(networkOpenPayload('NET-002', { ...projections['NET-002'], ...bound })).toBeNull();
    expect(networkOpenPayload('NET-003', projections['NET-003'])).toBeNull();
  });
  it('publishes neither batch nor single-candidate continuation when capacity is full', () => {
    expect(
      expectedNetworkActions(
        'NET-003',
        {
          ...projections['NET-003'],
          capacityForecast: { ...forecast, activePcCount: 5, fitsCurrentCapacity: false },
        },
        [],
      ),
    ).toEqual([]);
  });
  it('does not submit or cancel on a lost connection, unresolved command or blank reason', () => {
    expect(
      networkSubmitPayload('NET-004', { ...projections['NET-004'], connectionState: 'LOST' }),
    ).toBeNull();
    expect(
      networkSubmitPayload('NET-004', {
        ...projections['NET-004'],
        pendingCommandIdOrNull: 'unresolved',
      }),
    ).toBeNull();
    expect(
      networkSubmitPayload('NET-004', {
        ...projections['NET-004'],
        capacityForecast: { ...forecast, activePcCount: 5, fitsCurrentCapacity: false },
      }),
    ).toBeNull();
    expect(networkCancelPayload('NET-005', projections['NET-005'], ' \n ')).toBeNull();
    expect(
      networkCancelPayload(
        'NET-005',
        { ...projections['NET-005'], connectionState: 'LOST' },
        'передумал',
      ),
    ).toBeNull();
    expect(
      networkCancelPayload(
        'NET-005',
        { ...projections['NET-005'], requestStatus: 'IN_REVIEW' },
        'передумал',
      ),
    ).toBeNull();
    expect(
      networkCancelPayload('NET-005', projections['NET-005'], 'неподтверждённая причина'),
    ).toBeNull();
    expect(
      networkCancelPayload(
        'NET-005',
        { ...projections['NET-005'], cancelReason: ' передумал ' },
        ' передумал ',
      ),
    ).toEqual({
      networkScopeId: SCOPE,
      contextId: CONTEXT,
      expectedDraftRevision: 2,
      requestId: REQUEST,
      technicalSessionId: SESSION,
      requestRevision: 0,
      reason: ' передумал ',
    });
  });
  it('correlates immutable draft facts separately from a newer current projection', () => {
    const request: NetworkDraftReplaceV3Message = {
      messageType: 'network.draft.replace',
      protocolVersion: 3,
      variant: 'ADDRESS',
      draftUpdateId: 'edit',
      scope: { networkScopeId: SCOPE, contextId: CONTEXT, sourceFormId: 'NET-002' },
      expectedDraftRevision: 2,
      expectedRevisions: { stateRevision: 8, projectionRevision: 10, actorVisibilityRevision: 0 },
      values: { addressOrQrPayload: address },
    };
    const current = {
      ...projections['NET-002'],
      contextId: SESSION,
      draftRevision: 4,
      stateRevision: 12,
      projectionRevision: 16,
    };
    const message: NetworkDraftResultV3Message = {
      messageType: 'network.draft.result',
      protocolVersion: 3,
      draftUpdateId: 'edit',
      scope: request.scope,
      changed: true,
      appliedDraftRevision: 3,
      appliedRevisions: { stateRevision: 9, projectionRevision: 11, actorVisibilityRevision: 0 },
      draftRevision: 4,
      revisions: { stateRevision: 12, projectionRevision: 16, actorVisibilityRevision: 0 },
      projectionRole: 'player',
      presentation: {
        base: {
          formId: 'NET-002',
          formType: 'screen',
          availableActionKeys: [],
          roleFilteredPayload: current,
          routeBindings: [{ parameterIndex: 0, source: 'inherited', value: `unbound:${SCOPE}` }],
          routeTemplate: '/player/campaigns/:campaignId/network/net-002',
        },
        layers: [],
      },
    };
    expect(networkDraftResultMatches(message, request, current)).toBe(true);
    for (const altered of [
      { ...message, scope: { ...message.scope, contextId: SESSION } },
      { ...message, appliedDraftRevision: 4 },
      { ...message, appliedRevisions: { ...message.appliedRevisions, projectionRevision: 12 } },
      { ...message, revisions: { ...message.revisions, stateRevision: 13 } },
    ])
      expect(networkDraftResultMatches(altered, request, current)).toBe(false);
  });
  it('publishes only source-backed actions of the current player subset', () => {
    const caps = [
      'UI-CMD-CONNECTION-OPEN',
      'UI-CMD-DEVICE-REQUEST-SUBMIT',
      'UI-CMD-DEVICE-REQUEST-CANCEL',
    ] as const;
    expect(expectedNetworkActions('NET-002', projections['NET-002'], caps)).toEqual([
      'NET-002::CTA::001',
      'NET-002::CTA::003',
      'NET-002::CTA::004',
      'NET-002::CTA::005',
    ]);
    expect(expectedNetworkActions('NET-002', projections['NET-002'], [])).not.toContain(
      'NET-002::CTA::003',
    );
    expect(expectedNetworkActions('NET-003', projections['NET-003'], caps)).toEqual([
      'NET-003::CTA::001',
      'NET-003::CTA::002',
    ]);
    expect(
      expectedNetworkActions(
        'NET-003',
        { ...projections['NET-003'], ownRequestIdOrNull: REQUEST },
        caps,
      ),
    ).toEqual(['NET-003::CTA::003']);
    expect(expectedNetworkActions('NET-005', projections['NET-005'], caps)).toEqual([]);
    expect(
      expectedNetworkActions(
        'NET-005',
        { ...projections['NET-005'], cancelReason: 'Передумал' },
        caps,
      ),
    ).toEqual(['NET-005::CTA::001']);
    expect(expectedNetworkActions('NET-011', projections['NET-011'], caps)).toEqual([
      'NET-011::CTA::003',
      'NET-011::CTA::004',
      'NET-011::CTA::005',
    ]);
    for (const form of NETWORK_APPLICATION_FORM_IDS) {
      expect(
        expectedNetworkActions(
          form,
          { ...projections[form], pendingCommandIdOrNull: 'unresolved' },
          caps,
        ),
      ).toEqual([]);
      expect(expectedNetworkActions(form, projections[form], caps).join(' ')).not.toMatch(
        /NET-009|NET-012|NET-017|CMP-|APP-003/u,
      );
    }
  });
  it('keeps known-session loss editable and exitable without advertising a fresh OPEN', () => {
    const known = {
      ...projections['NET-011'],
      campaignIdOrNull: CAMPAIGN,
      retryAttemptIdOrNull: null,
    };
    expect(decodeNetworkProjection(known, '$', 'NET-011').ok).toBe(true);
    expect(expectedNetworkActions('NET-011', known, ['UI-CMD-CONNECTION-OPEN'])).toEqual([
      'NET-011::CTA::004',
      'NET-011::CTA::005',
    ]);
    expect(networkOpenPayload('NET-011', known)).toBeNull();
    expect(networkOpenPayload('NET-011', { ...known, retryAttemptIdOrNull: REQUEST })).toBeNull();
    expect(
      expectedNetworkActions('NET-011', { ...known, errorCode: 'UNCONFIRMED_OUTCOME' }, []),
    ).toEqual([]);
    expect(
      expectedNetworkActions('NET-011', { ...known, pendingCommandIdOrNull: REQUEST }, []),
    ).toEqual([]);
    expect(
      expectedNetworkActions('NET-002', { ...projections['NET-002'], ...bound }, [
        'UI-CMD-CONNECTION-OPEN',
      ]),
    ).toEqual(['NET-002::CTA::001', 'NET-002::CTA::002']);
  });
});
