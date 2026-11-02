import type { AdmissionControllerBinding } from '@shared/campaign-admission-proposal.js';
import {
  campaignDayPhase,
  campaignLobbyCommandValue,
  initialCampaignTimeValue,
  type CampaignLobbyCommand,
  type CampaignLobbyCopy,
  type CampaignLobbyReceipt,
  type CampaignPeaceScene,
  type CampaignReadyProof,
  type CampaignStartPreflight,
  type InitialCampaignTime,
} from '@shared/campaign-lobby.js';
import type { GmRequestReviewScope } from './campaign-creation.js';
import type { AdmissionHistory } from './campaign-admission-player.js';
import type { CampaignCheckpoint } from './store.js';
import { networkApplicationStorage as s } from './network-local-application.js';

export type LobbyAuthority =
  | Readonly<{ kind: 'GM'; ownerDeviceId: string; gmLocalContextId: string }>
  | Readonly<{ kind: 'PLAYER'; binding: AdmissionControllerBinding }>;
export interface CampaignLobbyEvent {
  readonly schemaVersion: 1;
  readonly eventIndex: number;
  readonly previousSha256OrNull: string | null;
  readonly campaignRevision: number;
  readonly authority: LobbyAuthority;
  readonly request: CampaignLobbyCommand;
  readonly clientRequestJsonOrNull: string | null;
  readonly receipt: CampaignLobbyReceipt;
  /** Allows the public header reader to verify the same Start checkpoint, without inventing a birth. */
  readonly beforeCheckpointOrNull: CampaignCheckpoint | null;
}
export interface CampaignLobbyState {
  readonly eventRevision: number;
  readonly timeRevision: number;
  readonly readinessRevision: number;
  readonly lobbySnapshotRevision: string;
  readonly initialCampaignTimeOrNull: InitialCampaignTime | null;
  readonly copies: readonly CampaignLobbyCopy[];
  readonly includedCopies: readonly CampaignLobbyCopy[];
  readonly includedDevices: readonly string[];
  readonly readyProofs: ReadonlyMap<string, CampaignReadyProof>;
  readonly readyByDevice: readonly Readonly<{
    deviceId: string;
    includedCampaignCharacterIds: readonly string[];
    ready: boolean;
  }>[];
  readonly preflight: CampaignStartPreflight;
  readonly sceneOrNull: CampaignPeaceScene | null;
  readonly checkpoint: CampaignCheckpoint;
  readonly events: readonly CampaignLobbyEvent[];
}

/** The source is already mechanically rebuilt by the admission verifier, including every ACTIVE copy. */
export function campaignLobbyCopies(
  history: AdmissionHistory,
  revision: number,
): CampaignLobbyCopy[] {
  const copies: CampaignLobbyCopy[] = [];
  for (const current of history.decisions.values()) {
    const decision = current.playerDecisionOrNull;
    if (
      decision === null ||
      decision.receipt.campaignRevision > revision ||
      decision.request.decision !== 'ACCEPT'
    )
      continue;
    const gm = current.gmDecisionOrNull ?? s.fail();
    const proposal = gm.proposalOrNull ?? s.fail();
    for (const [index, result] of decision.receipt.copies.entries()) {
      const copy = gm.copies[index] ?? s.fail();
      const diff = proposal.fullCampaignCopyDiffs[index] ?? s.fail();
      const binding = result.controllerBindingOrNull;
      if (
        copy.campaignCharacterId !== result.campaignCharacterId ||
        diff.campaignCharacterIdOrNull !== copy.campaignCharacterId ||
        !s.same(diff.afterSheet, copy.sheet) ||
        (result.lifecycleState !== 'ACTIVE' && result.lifecycleState !== 'PROPOSED') ||
        (result.lifecycleState === 'ACTIVE') !== (diff.blockers.length === 0) ||
        !result.occupiesCampaignPlace ||
        binding === null ||
        binding.campaignCharacterId !== copy.campaignCharacterId ||
        binding.deviceId !== copy.ownerDeviceId ||
        !s.same(binding, history.controllers.get(copy.campaignCharacterId)) ||
        result.groupIdOrNull === null ||
        !history.groups.has(result.groupIdOrNull) ||
        result.locationAssignmentOrNull === null ||
        !s.same(result.locationAssignmentOrNull, copy.sheet.locationAssignmentOrNull)
      )
        return s.fail();
      copies.push({
        campaignCharacterId: copy.campaignCharacterId,
        admissionBatchId: copy.admissionBatchId,
        name: copy.sheet.identity.name,
        lifecycleState: result.lifecycleState,
        groupId: result.groupIdOrNull,
        location: result.locationAssignmentOrNull,
        controller: binding,
        blockers: diff.blockers,
        sheet: copy.sheet,
      });
    }
  }
  copies.sort((a, b) =>
    a.campaignCharacterId < b.campaignCharacterId
      ? -1
      : a.campaignCharacterId > b.campaignCharacterId
        ? 1
        : 0,
  );
  const ids = copies.map((c) => c.campaignCharacterId);
  const seats = copies.map((c) => `${c.controller.deviceId}:${c.controller.localControllerSeatId}`);
  const lanes = copies.map((c) => `${c.controller.deviceId}:${c.controller.inputLaneId}`);
  if ([ids, seats, lanes].some((values) => new Set(values).size !== values.length)) return s.fail();
  return copies;
}

/** The stopped PEACE context is the only permitted continuation of an admission checkpoint in #173. */
export function campaignStartCheckpoint(
  before: CampaignCheckpoint,
  scene: CampaignPeaceScene,
): CampaignCheckpoint {
  const snapshot = s.object(JSON.parse(before.snapshotJson) as unknown, [
    'campaign',
    'campaignCharacterCopies',
  ]);
  const campaign = s.object(snapshot['campaign'], ['campaignId', 'lifecycleState', 'payloadJson']);
  const payload = s.object(JSON.parse(s.text(campaign['payloadJson'])) as unknown);
  if (
    campaign['campaignId'] !== scene.campaignId ||
    before.campaignId !== scene.campaignId ||
    campaign['lifecycleState'] !== 'PAUSED' ||
    Object.hasOwn(payload, 'peaceScene')
  )
    return s.fail();
  return {
    campaignId: before.campaignId,
    snapshotJson: JSON.stringify({
      campaign: {
        ...campaign,
        lifecycleState: 'HOSTING',
        payloadJson: s.canonical({ ...payload, peaceScene: scene }),
      },
      campaignCharacterCopies: snapshot['campaignCharacterCopies'],
    }),
    stateRevision: s.increment(before.stateRevision),
    projectionRevision: s.increment(before.projectionRevision),
    actorVisibilityRevision: s.increment(before.actorVisibilityRevision),
  };
}

function projection(
  history: AdmissionHistory,
  checkpoint: CampaignCheckpoint,
  revision: number,
  events: readonly CampaignLobbyEvent[],
  initialTime: InitialCampaignTime | null,
  timeRevision: number,
  readinessRevision: number,
  proofs: ReadonlyMap<string, CampaignReadyProof>,
  scene: CampaignPeaceScene | null,
): CampaignLobbyState {
  const copies = campaignLobbyCopies(history, revision);
  const includedCopies = copies.filter((copy) => copy.lifecycleState === 'ACTIVE');
  // Only exact included mechanics/bindings/assignments and time invalidate a proof, not another Ready.
  const lobbySnapshotRevision = s.sha(s.canonical({ includedCopies, initialTime, timeRevision }));
  const includedDevices = [
    ...new Set(includedCopies.map((copy) => copy.controller.deviceId)),
  ].sort();
  const readyByDevice = includedDevices.map((deviceId) => {
    const includedCampaignCharacterIds = includedCopies
      .filter((copy) => copy.controller.deviceId === deviceId)
      .map((copy) => copy.campaignCharacterId);
    const proof = proofs.get(deviceId);
    return {
      deviceId,
      includedCampaignCharacterIds,
      ready:
        proof?.ready === true &&
        proof.lobbySnapshotRevision === lobbySnapshotRevision &&
        s.same(proof.includedCampaignCharacterIds, includedCampaignCharacterIds),
    };
  });
  return {
    eventRevision: events.length,
    timeRevision,
    readinessRevision,
    lobbySnapshotRevision,
    initialCampaignTimeOrNull: initialTime,
    copies,
    includedCopies,
    includedDevices,
    readyProofs: proofs,
    readyByDevice,
    preflight:
      scene !== null
        ? 'STARTED'
        : includedCopies.length === 0
          ? 'ZERO_ACTIVE_PLAYERS'
          : initialTime !== null && readyByDevice.every((device) => device.ready)
            ? 'READY_TO_START'
            : 'NOT_READY',
    sceneOrNull: scene,
    checkpoint,
    events,
  };
}

export interface LobbyAllocations {
  readonly receiptId: string;
  readonly committedAt: string;
  readonly sceneIdOrNull: string | null;
  readonly checkpointIdOrNull: string | null;
}

/** Used both for a new intent and immutable journal replay; IDs are supplied once by the owning writer. */
export function planCampaignLobbyEvent(
  scope: GmRequestReviewScope,
  history: AdmissionHistory,
  before: CampaignLobbyState,
  authority: LobbyAuthority,
  request: CampaignLobbyCommand,
  allocations: LobbyAllocations,
  clientRequestJsonOrNull: string | null = null,
): CampaignLobbyEvent {
  campaignLobbyCommandValue(request);
  if (clientRequestJsonOrNull !== null) {
    const client = s.object(JSON.parse(s.text(clientRequestJsonOrNull)), [
      'messageType',
      'protocolVersion',
      'commandKind',
      'role',
      'commandId',
      'workflowCommandId',
      'expectedRevisions',
      'payload',
    ]);
    if (
      s.canonical(client) !== clientRequestJsonOrNull ||
      client['messageType'] !== 'command.request' ||
      client['protocolVersion'] !== 1 ||
      client['commandKind'] !== 'workflow-command' ||
      client['role'] !== 'gm' ||
      authority.kind !== 'GM'
    )
      return s.fail('INVALID_INPUT');
    s.vector(client['expectedRevisions']);
    const payload = s.object(client['payload']);
    if (
      Object.hasOwn(payload, 'commandId') ||
      Object.hasOwn(payload, 'workflowCommandId') ||
      !s.same(
        campaignLobbyCommandValue({
          ...payload,
          commandId: client['commandId'],
          workflowCommandId: client['workflowCommandId'],
        }),
        request,
      )
    )
      return s.fail('INVALID_INPUT');
  }
  if (authority.kind !== 'GM' && authority.kind !== 'PLAYER') return s.fail('FOREIGN_OWNER');
  const gm = authority.kind === 'GM';
  s.object(authority, gm ? ['kind', 'ownerDeviceId', 'gmLocalContextId'] : ['kind', 'binding']);
  if (gm) {
    if (
      authority.ownerDeviceId !== scope.ownerDeviceId ||
      authority.gmLocalContextId !== scope.gmLocalContextId
    )
      return s.fail('FOREIGN_OWNER');
  } else {
    const copy = before.copies.find((copy) => s.same(copy.controller, authority.binding));
    if (copy === undefined) return s.fail('FOREIGN_OWNER');
  }
  if (request.campaignId !== scope.campaignId) return s.fail('FOREIGN_OWNER');
  if (before.sceneOrNull !== null) return s.fail('UNAVAILABLE');
  if (request.expectedLobbySnapshotRevision !== before.lobbySnapshotRevision)
    return s.fail('STALE_REVISION');
  const start = request.workflowCommandId === 'UI-CMD-CAMPAIGN-START';
  if (
    start
      ? allocations.sceneIdOrNull === null || allocations.checkpointIdOrNull === null
      : allocations.sceneIdOrNull !== null || allocations.checkpointIdOrNull !== null
  )
    return s.fail('INVALID_INPUT');
  const common = {
    receiptId: s.uuid(allocations.receiptId),
    commandId: request.commandId,
    campaignId: request.campaignId,
    committedAt: s.text(allocations.committedAt),
  };
  let receipt: CampaignLobbyReceipt;
  if (request.workflowCommandId === 'UI-CMD-CAMPAIGN-READY-SET') {
    if (authority.kind !== 'PLAYER') return s.fail('FOREIGN_OWNER');
    const current = before.readyByDevice.find(
      (device) => device.deviceId === authority.binding.deviceId,
    );
    if (
      current === undefined ||
      current.includedCampaignCharacterIds.length === 0 ||
      current.ready === request.ready
    )
      return s.fail('UNAVAILABLE');
    receipt = {
      ...common,
      workflowCommandId: request.workflowCommandId,
      ownerDeviceId: authority.binding.deviceId,
      includedCampaignCharacterIds: current.includedCampaignCharacterIds,
      lobbySnapshotRevision: before.lobbySnapshotRevision,
      ready: request.ready,
      readinessRevision: s.increment(before.readinessRevision),
    };
  } else if (request.workflowCommandId === 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET') {
    if (!gm) return s.fail('FOREIGN_OWNER');
    const initialTime = initialCampaignTimeValue({
      dayNumber: request.dayNumber,
      hour: request.hour,
      minute: request.minute,
    });
    const changed = !s.same(initialTime, before.initialCampaignTimeOrNull);
    const after = projection(
      history,
      before.checkpoint,
      before.checkpoint.stateRevision,
      before.events,
      initialTime,
      changed ? s.increment(before.timeRevision) : before.timeRevision,
      changed ? s.increment(before.readinessRevision) : before.readinessRevision,
      before.readyProofs,
      null,
    );
    receipt = {
      ...common,
      workflowCommandId: request.workflowCommandId,
      initialCampaignTime: initialTime,
      lobbySnapshotRevision: after.lobbySnapshotRevision,
      readinessRevision: after.readinessRevision,
    };
  } else {
    if (!gm) return s.fail('FOREIGN_OWNER');
    if (request.expectedReadinessRevision !== before.readinessRevision)
      return s.fail('STALE_REVISION');
    const time = before.initialCampaignTimeOrNull;
    if (before.preflight !== 'READY_TO_START' || time === null) return s.fail('UNAVAILABLE');
    const scene: CampaignPeaceScene = {
      schemaVersion: 1,
      sceneId: s.uuid(allocations.sceneIdOrNull),
      checkpointId: s.uuid(allocations.checkpointIdOrNull),
      campaignId: scope.campaignId,
      sceneContext: 'PEACE',
      includedCopies: before.includedCopies.map(
        ({ campaignCharacterId, groupId, location, controller }) => ({
          campaignCharacterId,
          groupId,
          location,
          controller,
        }),
      ),
      campaignTimestamp: time.campaignTimestamp,
      clockMode: 'STOPPED',
      dayPhase: campaignDayPhase(time.campaignTimestamp),
    };
    const next = campaignStartCheckpoint(before.checkpoint, scene);
    receipt = {
      ...common,
      workflowCommandId: request.workflowCommandId,
      scene,
      lobbySnapshotRevision: before.lobbySnapshotRevision,
      readinessRevision: before.readinessRevision,
      campaignRevision: next.stateRevision,
      checkpointSha256: s.sha(next.snapshotJson),
    };
  }
  return {
    schemaVersion: 1,
    eventIndex: s.increment(before.eventRevision),
    previousSha256OrNull:
      before.events.length === 0 ? null : s.sha(s.canonical(before.events.at(-1))),
    campaignRevision: before.checkpoint.stateRevision,
    authority,
    request,
    clientRequestJsonOrNull,
    receipt,
    beforeCheckpointOrNull: start ? before.checkpoint : null,
  };
}

/** Admission checkpoints remain exact; each lobby proof is checked against its actual historical roster. */
export function replayCampaignLobby(
  scope: GmRequestReviewScope,
  history: AdmissionHistory,
  admissionCheckpoints: ReadonlyMap<number, CampaignCheckpoint>,
  records: readonly CampaignLobbyEvent[],
): CampaignLobbyState {
  const latest = history.checkpoint;
  let time: InitialCampaignTime | null = null;
  let timeRevision = 0,
    readinessRevision = 0,
    priorCampaignRevision = 0;
  let scene: CampaignPeaceScene | null = null;
  let checkpoint = latest;
  const proofs = new Map<string, CampaignReadyProof>();
  const events: CampaignLobbyEvent[] = [];
  const identities = new Set<string>();
  for (const record of records) {
    s.object(record, [
      'schemaVersion',
      'eventIndex',
      'previousSha256OrNull',
      'campaignRevision',
      'authority',
      'request',
      'clientRequestJsonOrNull',
      'receipt',
      'beforeCheckpointOrNull',
    ]);
    const anchor = admissionCheckpoints.get(record.campaignRevision) ?? s.fail();
    if (scene !== null || record.campaignRevision < priorCampaignRevision) return s.fail();
    const before = projection(
      history,
      anchor,
      anchor.stateRevision,
      events,
      time,
      timeRevision,
      readinessRevision,
      proofs,
      null,
    );
    const start =
      record.receipt.workflowCommandId === 'UI-CMD-CAMPAIGN-START' ? record.receipt.scene : null;
    const expected = planCampaignLobbyEvent(
      scope,
      history,
      before,
      record.authority,
      record.request,
      {
        receiptId: record.receipt.receiptId,
        committedAt: record.receipt.committedAt,
        sceneIdOrNull: start?.sceneId ?? null,
        checkpointIdOrNull: start?.checkpointId ?? null,
      },
      record.clientRequestJsonOrNull,
    );
    if (!s.same(expected, record)) return s.fail();
    for (const id of [
      record.request.commandId,
      record.receipt.receiptId,
      ...(start === null ? [] : [start.sceneId, start.checkpointId]),
    ]) {
      if (identities.has(id)) return s.fail();
      identities.add(id);
    }
    const receipt = expected.receipt;
    if (receipt.workflowCommandId === 'UI-CMD-CAMPAIGN-READY-SET') {
      proofs.set(receipt.ownerDeviceId, {
        ownerDeviceId: receipt.ownerDeviceId,
        includedCampaignCharacterIds: receipt.includedCampaignCharacterIds,
        lobbySnapshotRevision: receipt.lobbySnapshotRevision,
        ready: receipt.ready,
      });
    } else if (receipt.workflowCommandId === 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET') {
      if (!s.same(time, receipt.initialCampaignTime)) timeRevision = s.increment(timeRevision);
      time = receipt.initialCampaignTime;
    } else {
      if (!s.same(anchor, latest)) return s.fail();
      scene = receipt.scene;
      checkpoint = campaignStartCheckpoint(anchor, scene);
    }
    readinessRevision = receipt.readinessRevision;
    events.push(expected);
    priorCampaignRevision = record.campaignRevision;
  }
  return projection(
    history,
    checkpoint,
    latest.stateRevision,
    events,
    time,
    timeRevision,
    readinessRevision,
    proofs,
    scene,
  );
}
