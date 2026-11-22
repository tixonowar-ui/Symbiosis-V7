import { describe, expect, it } from 'vitest';
import { isCampaignOwnerProjection } from '@shared/campaign-lobby-presentation.js';
import type { CommandReceipt, JsonObject } from '@shared/wire-protocol.js';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import source from '../../../../tests/fixtures/campaign-lobby-owner.json';
import {
  admissionOwnerBrowserCommand,
  admissionOwnerBrowserReceipt,
  admissionOwnerDecisionDestination,
  admissionOwnerMonotonic,
  lobbyReadyBrowserCommand,
} from './admission-client.js';
import { ownerCommandWitness, ownerReconnectCheck } from './owner-reconnect-witness.js';

type Form = 'APP-003' | 'NET-005' | 'NET-006' | 'NET-027' | 'PLY-001';
function snapshot(formId: Form, value: unknown): ConfirmedProjectionSnapshot {
  const projection = value as JsonObject;
  return {
    formId,
    projection,
    path: '/',
    layers: [],
    availableActionKeys: [],
    executableWorkflowCommandIds: [],
    revisions: {
      stateRevision: Number(projection['stateRevision']),
      projectionRevision: Number(projection['projectionRevision']),
      actorVisibilityRevision: Number(projection['actorVisibilityRevision']),
    },
  };
}
function advance(s: ConfirmedProjectionSnapshot): ConfirmedProjectionSnapshot {
  return {
    ...s,
    revisions: {
      ...s.revisions,
      stateRevision: s.revisions.stateRevision + 1,
      projectionRevision: s.revisions.projectionRevision + 1,
    },
  };
}
const admission = snapshot('NET-027', source.admissionSource);
const lobby = snapshot('NET-006', source.lobbySource);
const peace = snapshot('PLY-001', source.peace);
const receipt = source.admissionReceipt.receipt.result.remoteReceipt;
const accepted = snapshot('NET-006', {
  ...source.admissionSource,
  receiptOrNull: receipt,
  decision: receipt.decision,
  campaignRevisionOrNull: receipt.campaignRevision,
  ownCampaignCopies: receipt.copies,
  controllerBindings: receipt.controllerProofOrNull.controllerBindings,
  result: 'PLAYER_ACCEPTED',
  decisionReceiptId: receipt.receiptId,
});

describe('opaque source evidence for offline owner commands', () => {
  it('settles ACCEPT on the original copies after disconnect without retaining names, sheets or locations', () => {
    const before = snapshot('NET-027', structuredClone(source.admissionSource));
    const request = admissionOwnerBrowserCommand(
      { ...before, availableActionKeys: ['NET-027::CTA::003'] },
      'NET-027::CTA::003',
      receipt.commandId,
    );
    const terminal = structuredClone(source.admissionReceipt.receipt) as unknown as CommandReceipt;
    const witness = ownerCommandWitness(before, request);
    expect(admissionOwnerBrowserReceipt(terminal, request, before)).toEqual(terminal);
    const compact = witness.checkReceipt(terminal);
    expect(witness.checkReceipt(structuredClone(terminal)).fingerprint).toBe(compact.fingerprint);
    for (const next of [accepted, lobby, peace, waiting]) {
      expect(witness.matchesDestination(next, compact, true)).toBe(
        admissionOwnerDecisionDestination(next, request, before, terminal, true),
      );
      expect(witness.matchesDestination(next, null, true)).toBe(
        admissionOwnerDecisionDestination(next, request, before, null, true),
      );
    }
    const copy = receipt.copies[0]!;
    const retained = JSON.stringify({ witness, compact });
    for (const privateValue of [
      copy.campaignCharacterId,
      copy.groupIdOrNull,
      copy.locationAssignmentOrNull.location,
      source.admissionSource.fullCampaignCopyDiffs[0]!.characterName,
      'fullCampaignCopyDiffs',
      'mechanicalSheet',
      'publication',
      'ownerProvenance',
      'remoteReceipt',
      'controllerBindingOrNull',
    ])
      expect(retained).not.toContain(privateValue);
    for (const changed of [
      { locationAssignmentOrNull: { ...copy.locationAssignmentOrNull, location: 'foreign' } },
      { campaignCharacterId: source.peace.deviceId },
      { lifecycleState: 'PROPOSED' },
    ]) {
      const bad = {
        ...terminal,
        result: {
          ...terminal.result,
          remoteReceipt: { ...receipt, copies: [{ ...copy, ...changed }] },
        },
      };
      expect(() => admissionOwnerBrowserReceipt(bad, request, before)).toThrow();
      expect(() => witness.checkReceipt(bad)).toThrow();
    }
    Object.assign(before.projection, {
      publication: null,
      fullCampaignCopyDiffs: [],
      contextId: 'discarded',
    });
    expect(witness.matchesDestination(peace, witness.checkReceipt(terminal), true)).toBe(true);
  });

  it('requires the original Ready device set and the receipt readiness frontier after losing the source', () => {
    const before = {
      ...snapshot('NET-006', structuredClone(source.lobbySource)),
      availableActionKeys: ['NET-006::CTA::003'] as const,
      executableWorkflowCommandIds: ['UI-CMD-CAMPAIGN-READY-SET'] as const,
    };
    const request = lobbyReadyBrowserCommand(before, 'NET-006::CTA::003', receipt.commandId);
    const l = source.lobbySource.lobby;
    const ready = {
      commandId: request.commandId,
      receiptId: receipt.receiptId,
      campaignId: l.campaignId,
      workflowCommandId: 'UI-CMD-CAMPAIGN-READY-SET',
      lobbySnapshotRevision: l.lobbySnapshotRevision,
      readinessRevision: l.readinessRevision + 1,
      ownerDeviceId: l.ownerDeviceId,
      includedCampaignCharacterIds: l.includedCampaignCharacterIds,
      ready: true,
      committedAt: receipt.timestamp,
    };
    const terminal = {
      commandId: request.commandId,
      receiptId: ready.receiptId,
      revisions: {
        ...before.revisions,
        stateRevision: before.revisions.stateRevision + 2,
        projectionRevision: before.revisions.projectionRevision + 2,
      },
      result: {
        operation: 'CAMPAIGN_READY_SET',
        networkScopeId: source.lobbySource.networkScopeId,
        remoteReceipt: ready,
      },
    };
    const witness = ownerCommandWitness(before, request);
    const compact = witness.checkReceipt(terminal);
    for (const next of [before, peace])
      expect(witness.matchesDestination(next, compact, true)).toBe(
        admissionOwnerDecisionDestination(next, request, before, terminal, true),
      );
    const wrong = {
      ...terminal,
      result: {
        ...terminal.result,
        remoteReceipt: { ...ready, includedCampaignCharacterIds: [l.ownerDeviceId] },
      },
    };
    expect(() => witness.checkReceipt(wrong)).toThrow();
    Object.assign(before.projection, { lobby: null });
    expect(witness.matchesDestination(peace, witness.checkReceipt(terminal), true)).toBe(true);
    expect(JSON.stringify(compact)).not.toContain(l.selectedCopy.campaignCharacterId);
  });
});
const request = snapshot('NET-005', {
  deviceId: source.lobbySource.deviceId,
  controllerSeat: source.lobbySource.controllerSeat,
  networkScopeId: source.lobbySource.networkScopeId,
  requestId: source.lobbySource.requestIdOrNull,
  campaignIdOrNull: source.lobbySource.campaignId,
  requestStatus: 'IN_REVIEW',
  ...admission.revisions,
});
const waiting = snapshot('APP-003', { ordinarySeatView: 'WAITING', ...peace.revisions });
function check(
  before: ConfirmedProjectionSnapshot,
  after: ConfirmedProjectionSnapshot,
  expected: boolean,
) {
  const online =
    (!isCampaignOwnerProjection(before.projection) &&
      !isCampaignOwnerProjection(after.projection)) ||
    admissionOwnerMonotonic(after, before, true);
  expect(online).toBe(expected);
  expect(ownerReconnectCheck(before)(after)).toBe(online);
}

describe('owner reconnect witness against the confirmed #173 transition contract', () => {
  it('covers the request, publication, accepted receipt, lobby and PEACE in both directions', () => {
    for (const next of [lobby, peace]) {
      for (const previous of [request, admission, accepted]) check(previous, next, true);
      check(next, request, false);
      check(waiting, next, false);
      check(next, waiting, false);
    }
    const laterAdmission = { ...accepted, revisions: advance(lobby).revisions };
    check(lobby, laterAdmission, true);
    check(peace, { ...accepted, revisions: advance(peace).revisions }, false);
    check(lobby, peace, true);
    check(peace, { ...lobby, revisions: advance(peace).revisions }, false);
    check(admission, waiting, true);
  });

  it('requires matching request ownership, permitted status, strict advancement and equal visibility', () => {
    for (const change of [
      { requestId: 'foreign' },
      { campaignIdOrNull: 'foreign' },
      { requestStatus: 'REJECTED' },
      { deviceId: 'foreign' },
      { controllerSeat: 'foreign' },
      { networkScopeId: 'foreign' },
    ]) {
      check(snapshot('NET-005', { ...request.projection, ...change }), peace, false);
    }
    check(
      request,
      {
        ...peace,
        revisions: { ...peace.revisions, projectionRevision: request.revisions.projectionRevision },
      },
      false,
    );
    check(
      request,
      { ...peace, revisions: { ...peace.revisions, actorVisibilityRevision: 1 } },
      false,
    );
  });

  it('keeps the complete sheet, extras and equal-vector fields fixed while permitting executor reconnection', () => {
    const before = snapshot('PLY-001', structuredClone(source.peace));
    const compare = ownerReconnectCheck(before);
    const reconnected = snapshot('PLY-001', {
      ...source.peace,
      contextId: source.lobbySource.deviceId,
      technicalSessionAvailable: false,
    });
    check(before, reconnected, true);
    check(
      before,
      advance(snapshot('PLY-001', { ...source.peace, groupNameOrNull: 'changed group name' })),
      false,
    );
    const pending = snapshot('PLY-001', {
      ...source.peace,
      pendingCommandIdOrNull: source.peace.sceneId,
    });
    check(before, pending, false);
    check(before, advance(pending), true);
    Object.assign(before.projection, { groupNameOrNull: 'mutated old projection' });
    Object.assign(before.revisions, {
      projectionRevision: before.revisions.projectionRevision + 1,
    });
    expect(compare(reconnected)).toBe(true);
  });

  it.each(['campaignRevision', 'lobbyEventRevision', 'readinessRevision'] as const)(
    'rejects a backwards lobby %s even when the local vector advances',
    (counter) => {
      const previous = snapshot('NET-006', {
        ...source.lobbySource,
        lobby: {
          ...source.lobbySource.lobby,
          [counter]: source.lobbySource.lobby[counter] + 1,
        },
      });
      check(previous, advance(lobby), false);
    },
  );
});
