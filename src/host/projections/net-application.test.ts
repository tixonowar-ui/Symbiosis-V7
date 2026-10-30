import { describe, expect, it } from 'vitest';
import type { JsonObject, WorkflowCommandCapabilityId } from '../../shared/wire-protocol.js';
import { isNetworkApplicationProjection } from '../../shared/network-application-codec.js';
import {
  NETWORK_APPLICATION_FORM_IDS,
  type NetworkApplicationFormId,
} from '../../shared/network-application.js';
import type { PublicCandidateRef } from '../../shared/device-admission.js';
import type {
  LocalNetworkApplication,
  NetworkPreparedCandidate,
} from '../../persistence/network-local-application.js';
import { campaignQrPayload } from '../../shared/campaign-creation.js';
import {
  projectNetworkApplication,
  candidateSummary,
  networkCapacity,
  type NetworkProjectionInput,
} from './net-application.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HASH = 'a'.repeat(64);
const BASELINE = `sha256:${'b'.repeat(64)}`;
const SOURCE = '00000000-0000-8000-8000-000000000030';
const PRIVATE = [
  'PRIVATE_FINAL_WITNESS',
  'PRIVATE_NODE_KEY',
  'PRIVATE_GM_QUEUE',
  'PRIVATE_OWNER_JOURNAL',
];
const supported: readonly WorkflowCommandCapabilityId[] = [
  'UI-CMD-CONNECTION-OPEN',
  'UI-CMD-DEVICE-REQUEST-SUBMIT',
  'UI-CMD-DEVICE-REQUEST-CANCEL',
];

/** Projection-only fields plus private canaries exercise the allowlist, not FINAL evidence validity. */
function input(formId: NetworkApplicationFormId): NetworkProjectionInput {
  const candidate: NetworkPreparedCandidate = {
    descriptor: {
      sourceUuid: SOURCE,
      sourceSnapshotId: 'historical-final-receipt',
      finalSnapshotVersion: 26,
      metadataRevision: 2,
      sourceChecksum: HASH,
      exportChecksum: 'c'.repeat(64),
      exportBytesSha256: 'd'.repeat(64),
      baselineVersion: BASELINE,
    },
    exportDocument: {
      metadata: { name: 'Источник CORE-159 fan', description: PRIVATE[3]! },
      provenance: {
        registryVersion: BASELINE,
        catalogVersion: BASELINE,
        builtAgainstTuple: BASELINE,
        finalSaveReceiptId: 'historical-final-receipt',
      },
      mechanicsSnapshot: { privateProof: PRIVATE[1]! },
      gmQueue: { foreignRequest: PRIVATE[2]! },
    },
    canonicalWitnessText: PRIVATE[0]!,
    witnessSha256: 'e'.repeat(64),
    byteLength: 21,
  };
  const campaign = {
    campaignId: id(5),
    title: 'Кампания',
    status: 'PAUSED' as const,
    activePlayerCapacity: 3 as const,
    activePcCount: 1,
    checkpointSha256: 'f'.repeat(64),
    baselineVersion: BASELINE,
    revisions: { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 },
  };
  const ref: PublicCandidateRef = {
    sourceUuid: SOURCE,
    finalSnapshotVersion: 26,
    metadataRevision: 2,
    candidateSnapshotChecksum: HASH,
    requestedControllerSeat: id(2),
  };
  const session = {
    technicalSessionId: id(7),
    attemptId: 'opaque-attempt',
    receiptId: 'original-open-receipt',
    connectionRevision: 0,
    campaignProof: {
      campaignId: campaign.campaignId,
      revisions: campaign.revisions,
      checkpointSha256: campaign.checkpointSha256,
    },
  };
  const batch = {
    requestId: id(8),
    technicalSessionId: session.technicalSessionId,
    connectionRevision: 0,
    campaignProof: session.campaignProof,
    candidates: [candidate],
    batchSha256: HASH,
  };
  const bound = ['NET-003', 'NET-004', 'NET-005', 'CHR-027'].includes(formId);
  const state: LocalNetworkApplication = {
    schemaVersion: 1,
    networkScopeId: id(1),
    ownerDeviceId: id(3),
    tabId: id(2),
    formId,
    stateRevision: 5,
    projectionRevision: 7,
    actorVisibilityRevision: 0,
    draftRevision: 2,
    addressOrQrPayload: campaignQrPayload('127.0.0.1', 3000, campaign.campaignId),
    cancelReason: formId === 'NET-005' ? '  Передумал\nпозже  ' : '',
    selectedCandidates: bound ? [ref] : [],
    selectedCampaignIdOrNull: formId === 'CHR-027' ? campaign.campaignId : null,
    requestedControllerSeatOrNull: formId === 'CHR-027' ? id(2) : null,
    plannedAttemptIdOrNull: formId === 'NET-011' ? 'new-attempt' : 'opaque-attempt',
    lastAttemptIdOrNull: formId === 'NET-011' ? 'opaque-attempt' : null,
    preparedBatchOrNull: ['NET-004', 'NET-005'].includes(formId) ? batch : null,
    sessionOrNull: bound ? session : null,
    requestOrNull:
      formId === 'NET-005'
        ? {
            requestId: batch.requestId,
            technicalSessionId: session.technicalSessionId,
            submitCommandId: 'original-submit',
            submitReceiptId: 'original-submit-receipt',
            requestRevision: 0,
            status: 'PENDING',
            batchSha256: HASH,
            closureOrNull: null,
          }
        : null,
    pendingCommandIdOrNull: null,
    shellExitOrNull: null,
    diagnosticCodeOrNull: formId === 'NET-011' ? 'PEER_UNAVAILABLE' : null,
  };
  return {
    state,
    contextId: id(4),
    supported,
    campaign: bound ? campaign : null,
    candidates: [candidate],
    discovery: {
      offers: [{ origin: 'http://127.0.0.1:3000', campaign }],
      diagnostics: [],
      truncated: false,
    },
    discoveryUnavailable: false,
    baselineVersion: BASELINE,
    attemptCount: 2,
  };
}
const payload = (i: NetworkProjectionInput): JsonObject =>
  projectNetworkApplication(i).roleFilteredPayload;
const keys = (i: NetworkProjectionInput) => projectNetworkApplication(i).availableActionKeys;

describe('own local network public projection boundary', () => {
  it('publishes the normal confirmation actions in exact source order for the strict browser renderer', () => {
    expect(keys(input('NET-004'))).toEqual([
      'NET-004::CTA::001',
      'NET-004::CTA::002',
      'NET-004::CTA::003',
    ]);
  });

  it.each(NETWORK_APPLICATION_FORM_IDS)(
    'publishes a strict %s payload without private evidence, keys or GM queue',
    (formId) => {
      const i = input(formId),
        before = JSON.stringify(i),
        view = projectNetworkApplication(i);
      expect(isNetworkApplicationProjection(formId, view.roleFilteredPayload)).toBe(true);
      expect(JSON.stringify(i)).toBe(before);
      const text = JSON.stringify(view);
      for (const marker of [
        ...PRIVATE,
        'canonicalWitnessText',
        'exportDocument',
        'mechanicsSnapshot',
        'gmQueue',
      ])
        expect(text).not.toContain(marker);
      expect(view.availableActionKeys.some((key) => key.includes('GM'))).toBe(false);
      expect(text).not.toContain('CONNECTED_ADMITTED');
      expect(text).not.toContain('IN_REVIEW');
    },
  );

  it.each(['NET-001', 'NET-002', 'NET-011'] as const)(
    'keeps QR hints separate from the assigned unbound %s route',
    (formId) => {
      const i = input(formId),
        view = projectNetworkApplication(i);
      expect(view.roleFilteredPayload['campaignIdOrNull']).toBeNull();
      expect(view.routeBindings).toEqual([
        { parameterIndex: 0, source: 'inherited', value: `unbound:${i.state.networkScopeId}` },
      ]);
      expect(view.routeBindings[0]!.value).not.toBe(id(5));
    },
  );

  it.each(['NET-003', 'NET-004', 'NET-005'] as const)(
    'binds confirmed %s only to its actual campaign session',
    (formId) => {
      expect(projectNetworkApplication(input(formId)).routeBindings).toEqual([
        { parameterIndex: 0, source: 'inherited', value: id(5) },
      ]);
    },
  );

  it('preserves historical source identifiers, own text and exact candidate order without turning a source into a campaign/seat', () => {
    const i = input('NET-003'),
      c = i.candidates[0]!,
      second = { ...c, descriptor: { ...c.descriptor, sourceUuid: 'historical-source-two' } },
      p = payload({ ...i, candidates: [second, c] });
    const eligible = p['eligibleFinalCandidates'] as readonly JsonObject[];
    expect(eligible.map((v) => v['sourceUuid'])).toEqual(['historical-source-two', SOURCE]);
    expect(eligible[1]).toEqual(candidateSummary(c, i.state.tabId));
    expect(eligible[1]!['name']).toBe('Источник CORE-159 fan');
    expect(eligible[1]!['requestedControllerSeat']).toBe(i.state.tabId);
    expect(p['connectionState']).toBe('CONNECTED_TECHNICAL');
  });

  it('uses the immutable prepared batch rather than later candidate metadata for the submitted summary', () => {
    const i = input('NET-005'),
      original = i.candidates[0]!,
      changed = {
        ...original,
        descriptor: { ...original.descriptor, metadataRevision: 3 },
        exportDocument: { ...original.exportDocument, metadata: { name: 'Позднее имя' } },
      },
      p = payload({ ...i, candidates: [changed] }),
      summary = (p['batchCharacterSummaries'] as readonly JsonObject[])[0]!;
    expect(summary['metadataRevision']).toBe(2);
    expect(summary['name']).toBe('Источник CORE-159 fan');
    expect(p['requestStatus']).toBe('PENDING');
    expect(p['gmMessage']).toBeNull();
    expect(p['cancelReason']).toBe('  Передумал\nпозже  ');
  });

  it('keeps single-candidate identity/provenance and route tied to the owned historical source', () => {
    const i = input('CHR-027'),
      view = projectNetworkApplication(i),
      p = view.roleFilteredPayload;
    expect(view.routeTemplate).toBe('/player/characters/:localCharacterId/create/chr-027');
    expect(view.routeBindings[0]!.value).toBe(SOURCE);
    expect(p['localCharacterUuid']).toBe(SOURCE);
    expect(p['sourceUuidAndProvenance']).toMatchObject({
      sourceUuid: SOURCE,
      sourceSnapshotId: 'historical-final-receipt',
      sourceChecksum: HASH,
      metadataRevision: 2,
      finalSnapshotVersion: 26,
    });
    expect(p['submissionStatus']).toBe('DRAFT');
    expect(keys(i)).toContain('CHR-027::CTA::001');
  });

  it('renders loss of a single-candidate connection without inventing an eligible remote campaign or mutating its durable selection', () => {
    const i = input('CHR-027'),
      p = payload({ ...i, campaign: null });
    expect(p['eligibleCampaignIds']).toEqual([]);
    expect(p['selectedCampaignId']).toBeNull();
    expect(p['connectionState']).toBe('LOST');
    expect(keys({ ...i, campaign: null })).not.toContain('CHR-027::CTA::001');
    expect(keys({ ...i, campaign: null })).toContain('CHR-027::CTA::002');
    expect(i.state.selectedCampaignIdOrNull).toBe(id(5));
  });

  it('shows one current verified provenance after a metadata edit but requires reselection before sending stale CHR-027 input', () => {
    const i = input('CHR-027'),
      original = i.candidates[0]!,
      current = { ...original, descriptor: { ...original.descriptor, metadataRevision: 3 } },
      changed = { ...i, candidates: [current] },
      p = payload(changed);
    expect(p['sourceUuidAndProvenance']).toMatchObject({
      sourceUuid: SOURCE,
      sourceSnapshotId: current.descriptor.sourceSnapshotId,
      metadataRevision: 3,
      sourceChecksum: current.descriptor.sourceChecksum,
      finalSnapshotVersion: current.descriptor.finalSnapshotVersion,
    });
    expect(keys(changed)).toEqual(['CHR-027::CTA::002']);
    expect(p['eligibleCampaignIds']).toEqual([]);
    expect(p['selectedCampaignId']).toBeNull();
    expect(i.state.selectedCandidates[0]!.metadataRevision).toBe(2);
  });

  it.each([
    { finalSnapshotVersion: 25 },
    { candidateSnapshotChecksum: 'f'.repeat(64) },
    { requestedControllerSeat: id(99) },
  ])(
    'does not advertise a send from a stale single-candidate version, checksum or input lane: %j',
    (change) => {
      const i = input('CHR-027'),
        stale = {
          ...i,
          state: {
            ...i.state,
            selectedCandidates: [{ ...i.state.selectedCandidates[0]!, ...change }],
          },
        };
      expect(keys(stale)).toEqual(['CHR-027::CTA::002']);
      expect(payload(stale)['eligibleCampaignIds']).toEqual([]);
      expect(payload(stale)['selectedCampaignId']).toBeNull();
      expect(payload(stale)['sourceUuidAndProvenance']).toMatchObject({
        sourceChecksum: HASH,
        finalSnapshotVersion: 26,
        metadataRevision: 2,
      });
    },
  );

  it.each(['NET-002', 'NET-004', 'NET-005', 'NET-011'] as const)(
    'does not publish executable workflow CTAs for %s without negotiated capability',
    (formId) => {
      const blocked = keys({ ...input(formId), supported: [] });
      for (const key of [
        'NET-002::CTA::003',
        'NET-004::CTA::002',
        'NET-005::CTA::001',
        'NET-011::CTA::003',
      ])
        expect(blocked).not.toContain(key);
    },
  );

  it.each(['NET-002', 'NET-003', 'NET-004', 'NET-005', 'NET-011', 'CHR-027'] as const)(
    'prevents a second action while %s has an unresolved command',
    (formId) => {
      const i = input(formId),
        view = projectNetworkApplication({
          ...i,
          state: {
            ...i.state,
            pendingCommandIdOrNull: 'unconfirmed-command',
            ...(formId === 'NET-011'
              ? { plannedAttemptIdOrNull: i.state.lastAttemptIdOrNull }
              : {}),
          },
        });
      expect(view.availableActionKeys).toEqual([]);
      expect(view.roleFilteredPayload['pendingCommandIdOrNull']).toBe('unconfirmed-command');
    },
  );

  it('counts ACTIVE PCs only and prevents over-capacity submit/single selection without changing the immutable batch', () => {
    const i = input('NET-004'),
      campaign = { ...i.campaign!, activePcCount: 3 },
      p = payload({ ...i, campaign });
    expect(p['capacityForecast']).toMatchObject({
      activePcCount: 3,
      selectedCandidateCount: 1,
      fitsCurrentCapacity: false,
    });
    expect(keys({ ...i, campaign })).not.toContain('NET-004::CTA::002');
    expect(networkCapacity(campaign, 0).fitsCurrentCapacity).toBe(true);
    expect(() => networkCapacity(campaign, 4)).toThrow();
    expect(i.state.preparedBatchOrNull!.candidates).toHaveLength(1);
  });

  it('keeps a pending request visible after remote loss but disables cancellation until reconnection', () => {
    const i = input('NET-005'),
      p = payload({ ...i, campaign: null });
    expect(p['connectionState']).toBe('LOST');
    expect(p['requestId']).toBe(i.state.requestOrNull!.requestId);
    expect(p['requestStatus']).toBe('PENDING');
    expect(keys({ ...i, campaign: null })).toEqual([]);
  });

  it('does not advertise a full campaign as eligible for a single candidate while retaining the own back path', () => {
    const i = input('CHR-027'),
      full = { ...i, campaign: { ...i.campaign!, activePcCount: 3 } },
      p = payload(full);
    expect(p['eligibleCampaignIds']).toEqual([]);
    expect(p['selectedCampaignId']).toBeNull();
    expect(keys(full)).toEqual(['CHR-027::CTA::002']);
    expect(i.state.selectedCampaignIdOrNull).toBe(id(5));
  });

  it('requires a new confirmed retry attempt and keeps an unconfirmed attempt disabled', () => {
    const i = input('NET-011');
    expect(payload(i)['retryAttemptIdOrNull']).toBe('new-attempt');
    expect(payload(i)['retryCount']).toBe(1);
    expect(keys(i)).toContain('NET-011::CTA::003');
    const used = {
      ...i,
      state: { ...i.state, plannedAttemptIdOrNull: i.state.lastAttemptIdOrNull },
    };
    expect(payload(used)['retryAttemptIdOrNull']).toBeNull();
    expect(keys(used)).not.toContain('NET-011::CTA::003');
  });

  it.each(['no request', 'closed request'] as const)(
    'retains a confirmed unavailable session with %s without advertising a fresh OPEN attempt',
    (kind) => {
      const failed = input('NET-011'),
        connected = input('NET-003'),
        pending = input('NET-005').state.requestOrNull!;
      const known = {
        ...failed,
        state: {
          ...failed.state,
          sessionOrNull: connected.state.sessionOrNull,
          requestOrNull:
            kind === 'no request'
              ? null
              : {
                  ...pending,
                  requestRevision: 1,
                  closureOrNull: {
                    commandId: 'saved-cancel',
                    receiptId: 'saved-cancel-receipt',
                    reason: 'Передумал',
                  },
                },
        },
      };
      const p = payload(known);
      expect(p['campaignIdOrNull']).toBe(connected.state.sessionOrNull!.campaignProof.campaignId);
      expect(p['retryAttemptIdOrNull']).toBeNull();
      expect(keys(known)).toEqual(['NET-011::CTA::004', 'NET-011::CTA::005']);
      expect(known.state.sessionOrNull).toEqual(connected.state.sessionOrNull);
    },
  );

  it.each(['live', 'offline'] as const)(
    'publishes only the exact source actions for a known %s session on NET-002',
    (state) => {
      const address = input('NET-002'),
        connected = input('NET-003');
      const known = {
        ...address,
        state: { ...address.state, sessionOrNull: connected.state.sessionOrNull },
        campaign: state === 'live' ? connected.campaign : null,
      };
      expect(keys(known)).toEqual(
        state === 'live' ? ['NET-002::CTA::001', 'NET-002::CTA::002'] : ['NET-002::CTA::001'],
      );
      expect(payload(known)['connectionState']).toBe(
        state === 'live' ? 'CONNECTED_TECHNICAL' : 'LOST',
      );
      expect(payload(known)['campaignIdOrNull']).toBe(id(5));
    },
  );

  it('never enables OPEN for empty, public or non-IP addresses', () => {
    for (const address of [
      '',
      'https://127.0.0.1:3000',
      'http://8.8.8.8:3000',
      'http://example.invalid:3000',
    ]) {
      const i = input('NET-002'),
        invalid = { ...i, state: { ...i.state, addressOrQrPayload: address } };
      expect(keys(invalid)).not.toContain('NET-002::CTA::003');
      expect(payload(invalid)['parsedHost']).toBeNull();
      expect(payload(invalid)['campaignIdOrNull']).toBeNull();
    }
  });
});
