import { describe, expect, it } from 'vitest';
import {
  campaignPeerStateValue,
  CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
  campaignPeerMatchesSnapshot,
  campaignPeerSnapshotId,
  type CampaignPeerStateV3Message,
} from './campaign-lifecycle.js';
import type { JsonObject } from './wire-protocol.js';
import { NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS } from './device-admission.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const revisions = { stateRevision: 7, projectionRevision: 9, actorVisibilityRevision: 0 };
const own = {
  formId: 'PLY-001',
  revisions,
  projection: {
    contextId: id(1),
    networkScopeId: id(2),
    campaignId: id(3),
    deviceId: id(4),
    controllerSeat: id(5),
    requestIdOrNull: id(6),
    pendingCommandIdOrNull: null,
  } as JsonObject,
};
function peer(formId: 'NET-009' | 'NET-010'): CampaignPeerStateV3Message {
  const common = {
    activeRole: 'PLAYER',
    pendingCommandIdOrNull: null,
    pendingRequestIdOrNull: id(6),
  };
  return {
    messageType: 'network.peer-state',
    protocolVersion: 3,
    subscriptionId: id(7),
    requestId: id(7),
    contextId: id(1),
    networkScopeId: id(2),
    campaignId: id(3),
    deviceId: id(4),
    controllerSeat: id(5),
    sequence: 1,
    revisions,
    connectionRevision: 4,
    connectionState: formId === 'NET-009' ? 'LOST' : 'CONNECTED',
    statusOrNull: {
      campaignId: id(3),
      deviceId: id(4),
      campaignRevision: 3,
      campaignStatus: 'HOSTING',
      pauseReasonOrNull: null,
      firstStartCompleted: true,
      disconnectOrNull: null,
    },
    retryOutcome: 'NONE',
    diagnosticOrNull: null,
    formOrNull: {
      formId,
      availableActionKeys: formId === 'NET-009' ? ['NET-009::CTA::001'] : [],
      fields:
        formId === 'NET-009'
          ? {
              ...common,
              deviceId: id(4),
              sessionId: id(8),
              requestedSeatOrGm: id(5),
              reconnectAttemptId: id(9),
              commandId: id(9),
              deviceBindingProof: {
                campaignId: id(3),
                deviceId: id(4),
                requestId: id(6),
                submitCommandId: id(10),
                technicalSessionId: id(8),
                controllerSeat: id(5),
              },
              lastConfirmedStateRevision: 7,
              lastConfirmedProjectionRevision: 9,
              resumeContextHint: 'PLY-001',
              pinnedCampaignPeerReconnectOrNull: {
                reconnectHostAddress: '127.0.0.1',
                reconnectHostPort: 31770,
                previouslyPinnedHostIdentity: {
                  ownerDeviceId: id(11),
                  keyFingerprintSha256: 'a'.repeat(64),
                },
                lastAuthenticatedEndpoint: 'http://127.0.0.1:31770',
              },
            }
          : {
              ...common,
              activeSeatOrGm: id(5),
              resumeContext: 'PEACE',
              resumeFormId: 'PLY-001',
              serverSnapshotId: campaignPeerSnapshotId(id(1), id(2), revisions),
              serverStateRevision: 7,
              serverProjectionRevision: 9,
              pendingCommandOwnerOrNull: null,
              combatPhaseOrNull: null,
              turnOrReactionWindowOrNull: null,
              observerVisibilityRevisionOrNull: 0,
              controlLeaseIdOrNull: null,
              receiptIds: [id(12), id(13)],
              reconciliationResult: 'SERVER_CONFIRMED',
            },
    },
  };
}
describe('#174 closed peer continuation anchors', () => {
  it('accepts the actual published vector and explicit paired-reconnect settlement', () => {
    const m = campaignPeerStateValue(peer('NET-010'));
    expect(campaignPeerMatchesSnapshot(m, own, id(9))).toBe(true);
    expect(campaignPeerMatchesSnapshot(m, own, null)).toBe(false);
    expect(campaignPeerMatchesSnapshot(m, { ...own, formId: 'NET-005' }, id(9))).toBe(false);
  });
  it('rejects foreign form revision, snapshot identity, request and seat', () => {
    for (const [key, value] of [
      ['serverStateRevision', 8],
      ['serverProjectionRevision', 10],
      ['serverSnapshotId', 'peer-snapshot:foreign'],
      ['activeSeatOrGm', id(99)],
    ] as const) {
      const m = peer('NET-010');
      (m.formOrNull!.fields as Record<string, unknown>)[key] = value;
      expect(() => campaignPeerStateValue(m), key).toThrow();
    }
    const m = peer('NET-009');
    (
      (m.formOrNull!.fields as Record<string, unknown>)['deviceBindingProof'] as Record<
        string,
        unknown
      >
    )['requestId'] = id(99);
    expect(() => campaignPeerStateValue(m)).toThrow();
  });
  it('refuses an internally valid frame for another request or an unpublished vector', () => {
    const m = peer('NET-009');
    (m.formOrNull!.fields as Record<string, unknown>)['pendingRequestIdOrNull'] = id(99);
    (
      (m.formOrNull!.fields as Record<string, unknown>)['deviceBindingProof'] as Record<
        string,
        unknown
      >
    )['requestId'] = id(99);
    expect(campaignPeerMatchesSnapshot(campaignPeerStateValue(m), own, null)).toBe(false);
    expect(
      campaignPeerMatchesSnapshot(
        peer('NET-009'),
        { ...own, revisions: { ...revisions, projectionRevision: 8 } },
        null,
      ),
    ).toBe(false);
  });
  it('supports direct own PLY001 without inventing session fields and checks known NET005 session', () => {
    const m = campaignPeerStateValue(peer('NET-009'));
    expect(campaignPeerMatchesSnapshot(m, own, null)).toBe(true);
    (m.formOrNull!.fields as Record<string, unknown>)['resumeContextHint'] = 'NET-005';
    const net = {
      ...own,
      formId: 'NET-005',
      projection: { ...own.projection, requestId: id(6), sessionId: id(8) },
    };
    expect(campaignPeerMatchesSnapshot(m, net, null)).toBe(true);
    expect(
      campaignPeerMatchesSnapshot(
        m,
        { ...net, projection: { ...net.projection, sessionId: id(99) } },
        null,
      ),
    ).toBe(false);
  });
  it('keeps approved transfer source vocabulary outside the implemented pinned reconnect boundary', () => {
    for (const workflow of [
      'UI-CMD-MASTER-TRANSFER-UNLOCK',
      'UI-CMD-MASTER-TRANSFER-COMMIT',
      'UI-CMD-MASTER-TRANSFER-ACK',
      'UI-CMD-MASTER-TRANSFER-CANCEL',
      'UI-CMD-MASTER-TRANSFER-RECONNECT',
    ]) {
      expect(NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS).not.toContain(workflow);
      expect(CAMPAIGN_LIFECYCLE_WORKFLOW_IDS).not.toContain(workflow);
    }
    const ordinary = peer('NET-009');
    expect(campaignPeerStateValue(ordinary)).toEqual(ordinary);
    expect(ordinary.formOrNull!.availableActionKeys).toEqual(['NET-009::CTA::001']);
    for (const actionKey of ['NET-009::CTA::003', 'NET-009::CTA::004']) {
      const source = peer('NET-009');
      const forged = {
        ...source,
        formOrNull: {
          ...source.formOrNull!,
          availableActionKeys: ['NET-009::CTA::001', actionKey],
        },
      };
      expect(() => campaignPeerStateValue(forged), actionKey).toThrow();
    }
    const proofSource = peer('NET-009');
    const forgedProof = {
      ...proofSource,
      formOrNull: {
        ...proofSource.formOrNull!,
        fields: { ...proofSource.formOrNull!.fields, transferReconnectOrNull: null },
      },
    };
    expect(() => campaignPeerStateValue(forgedProof)).toThrow();
  });
});
