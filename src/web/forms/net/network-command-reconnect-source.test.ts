import { describe, expect, it } from 'vitest';
import type { NetworkWorkflowRequest } from '@shared/network-application.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import {
  absentNetworkCommandSourceMatches,
  networkRefusalSourceMatches,
  pendingNetworkCancelSnapshotMatches,
  rememberNetworkCommandSource,
  unconfirmedNetworkCommandSourceMatches,
} from './network-command-reconnect-source.js';

const revisions = { stateRevision: 2, projectionRevision: 7, actorVisibilityRevision: 3 };
const advanced = { ...revisions, stateRevision: 3, projectionRevision: 9 };
const projection = {
  contextId: 'old-context',
  networkScopeId: 'local-scope',
  deviceId: 'owner',
  controllerSeat: 'local-seat',
  campaignIdOrNull: 'bound-campaign',
  sessionId: 'technical-session',
  requestId: 'active-request',
  requestOwnerDeviceId: 'request-owner',
  requestRevision: 1,
  draftRevision: 4,
  pendingCommandIdOrNull: null,
  cancelReason: 'Private reason',
  gmMessage: 'Private GM reply',
  batchCharacterSummaries: [{ sourceUuid: 'private-final', name: 'Private character' }],
};
const source = {
  formId: 'NET-005',
  projection,
  revisions,
  executableWorkflowCommandIds: ['UI-CMD-DEVICE-REQUEST-CANCEL'] as const,
};
const witness = rememberNetworkCommandSource(source);
const request = {
  messageType: 'command.request',
  protocolVersion: 1,
  commandKind: 'workflow-command',
  role: 'player',
  commandId: 'cancel-command',
  workflowCommandId: 'UI-CMD-DEVICE-REQUEST-CANCEL',
  expectedRevisions: revisions,
  payload: {
    networkScopeId: projection.networkScopeId,
    contextId: projection.contextId,
    expectedDraftRevision: projection.draftRevision,
    requestId: projection.requestId,
    technicalSessionId: projection.sessionId,
    requestRevision: projection.requestRevision,
    reason: projection.cancelReason,
  },
} satisfies NetworkWorkflowRequest;
const prepared = {
  ...source,
  revisions: advanced,
  projection: {
    ...projection,
    connectionState: 'CONNECTING',
    requestStatus: 'PENDING',
    pendingCommandIdOrNull: request.commandId,
    commandId: request.commandId,
  },
};
const amend = (patch: JsonObject) => ({
  ...prepared,
  projection: { ...prepared.projection, ...patch },
});

describe('pending network command reconnect source', () => {
  it('retains capabilities and revisions independently of private projection data', () => {
    const text = JSON.stringify(witness);
    expect(witness.revisions).toEqual(revisions);
    expect(witness.executableWorkflowCommandIds).toEqual(source.executableWorkflowCommandIds);
    for (const marker of [
      projection.contextId,
      projection.networkScopeId,
      projection.controllerSeat,
      projection.cancelReason,
      projection.gmMessage,
      'Private character',
      'private-final',
      'batchCharacterSummaries',
    ]) {
      expect(text).not.toContain(marker);
    }
  });

  it('accepts an absent command on the same owner and equal content, with a freshly assigned context', () => {
    const refreshed = { ...source, projection: { ...projection, contextId: 'new-context' } };
    expect(absentNetworkCommandSourceMatches(refreshed, witness)).toBe(true);
    expect(
      absentNetworkCommandSourceMatches(
        { ...refreshed, projection: { ...refreshed.projection, gmMessage: 'changed' } },
        witness,
      ),
    ).toBe(false);
    expect(
      absentNetworkCommandSourceMatches(
        {
          ...refreshed,
          revisions: advanced,
          projection: { ...refreshed.projection, gmMessage: 'changed' },
        },
        witness,
      ),
    ).toBe(true);
    for (const key of [
      'networkScopeId',
      'deviceId',
      'controllerSeat',
      'campaignIdOrNull',
      'sessionId',
      'requestId',
      'pendingCommandIdOrNull',
    ]) {
      expect(
        absentNetworkCommandSourceMatches(
          {
            ...refreshed,
            revisions: advanced,
            projection: { ...refreshed.projection, [key]: 'other' },
          },
          witness,
        ),
        key,
      ).toBe(false);
    }
    const { sessionId: _session, ...beforeOpen } = projection;
    const open = { ...source, formId: 'NET-002', projection: beforeOpen };
    const openWitness = rememberNetworkCommandSource(open);
    expect(absentNetworkCommandSourceMatches(open, openWitness)).toBe(true);
    expect(
      absentNetworkCommandSourceMatches(
        { ...open, revisions: advanced, projection: { ...beforeOpen, sessionId: null } },
        openWitness,
      ),
    ).toBe(false);
  });

  it('compares the original cancellation context, owner, command, revision and exact private content', () => {
    expect(pendingNetworkCancelSnapshotMatches(prepared, witness, request, false)).toBe(true);
    expect(
      pendingNetworkCancelSnapshotMatches(
        amend({ contextId: 'reconnected' }),
        witness,
        request,
        true,
      ),
    ).toBe(true);
    expect(
      pendingNetworkCancelSnapshotMatches(amend({ contextId: 'other' }), witness, request, false),
    ).toBe(false);
    expect(
      pendingNetworkCancelSnapshotMatches(
        prepared,
        witness,
        { ...request, payload: { ...request.payload, contextId: 'other' } },
        true,
      ),
    ).toBe(false);
    for (const [key, value] of Object.entries({
      networkScopeId: 'other',
      deviceId: 'other',
      controllerSeat: 'other',
      draftRevision: 5,
      campaignIdOrNull: null,
      sessionId: 'other',
      requestId: 'other',
      requestRevision: 3,
      requestOwnerDeviceId: 'other',
      requestStatus: 'IN_REVIEW',
      connectionState: 'CONNECTED',
      commandId: 'other',
      pendingCommandIdOrNull: null,
      cancelReason: 'altered',
      gmMessage: null,
      batchCharacterSummaries: [{ sourceUuid: 'private-final', name: 'Another name' }],
    }))
      expect(
        pendingNetworkCancelSnapshotMatches(amend({ [key]: value }), witness, request, true),
        key,
      ).toBe(false);
    expect(
      pendingNetworkCancelSnapshotMatches(
        { ...prepared, revisions: { ...advanced, actorVisibilityRevision: 4 } },
        witness,
        request,
        true,
      ),
    ).toBe(false);
  });

  it('retains distinct revision and scope checks for refusal and an unconfirmed outcome', () => {
    const diagnostic = { ...amend({ errorCode: 'UNCONFIRMED_OUTCOME' }), formId: 'NET-011' };
    expect(unconfirmedNetworkCommandSourceMatches(diagnostic, witness, request.commandId)).toBe(
      true,
    );
    expect(unconfirmedNetworkCommandSourceMatches(diagnostic, witness, 'other')).toBe(false);
    expect(
      unconfirmedNetworkCommandSourceMatches(
        { ...diagnostic, revisions },
        witness,
        request.commandId,
      ),
    ).toBe(false);
    for (const key of ['controllerSeat', 'draftRevision', 'networkScopeId']) {
      expect(
        unconfirmedNetworkCommandSourceMatches(
          { ...diagnostic, projection: { ...diagnostic.projection, [key]: 'foreign' } },
          witness,
          request.commandId,
        ),
        key,
      ).toBe(false);
    }
    expect(networkRefusalSourceMatches(diagnostic, witness)).toBe(true);
    expect(networkRefusalSourceMatches({ ...diagnostic, formId: 'PLY-001' }, witness)).toBe(false);
    expect(networkRefusalSourceMatches(amend({ networkScopeId: 'foreign' }), witness)).toBe(false);
    expect(
      networkRefusalSourceMatches(
        { ...diagnostic, revisions: { ...revisions, stateRevision: 1 } },
        witness,
      ),
    ).toBe(false);
  });
});
