import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import type { ActionKey } from '@generated/types/atlas.js';
import {
  HOST_OWNER_PROFILE_CREATE,
  HOST_SEAT_ACK,
  hostSeatAckPayloadValue,
  hostSeatViewValue,
  type HostSeatEntry,
  type HostSeatApplicant,
  type HostSeatControlV3Message,
} from '../shared/host-seat.js';
import type { JsonObject, WorkflowCommandId, CommandReceipt } from '../shared/wire-protocol.js';
import type { NetworkWorkflowRequest } from '../shared/network-application.js';
import type {
  FormActionIntentV2Message,
  PresentationAssignmentReason,
  ProjectionSnapshotV2Message,
} from '../shared/wire-v2-protocol.js';
import { loadDeviceId } from '../persistence/index.js';
import {
  readCampaignCreationCursor,
  readLocalGmContext,
  readActiveLocalGmContext,
  type GmRequestReviewScope,
} from '../persistence/campaign-creation.js';
import { readHostLocalRoster } from '../persistence/local-seat-roster.js';
import { NetworkApplicationStoreError } from '../persistence/network-local-application.js';
import {
  readHostLocalSeatHandoff,
  hostLocalSeatPresentAtStartup,
  openHostLocalSeatSetup,
  createHostSeatProfile,
  selectHostSeatProfile,
  selectHostLocalFinals,
  beginHostLocalSeatHandoff,
  ackHostLocalSeatHandoff,
  readHostLocalProfileScope,
  readHostLocalTerminalApplicant,
  readHostLocalTerminalApplicants,
  readHostLocalTerminalTarget,
  hostLocalProfileReturnedBeforeSubmit,
  readHostLocalOwnedCharacters,
  promoteHostLocalSeat,
  returnHostSeatSetup,
  cancelHostLocalCandidateCurtain,
  markHostLocalGmDestination,
  type HostLocalSeatHandoff,
  type HostLocalSeatTarget,
  type HostSeatOrigin,
  type HostSeatRequest,
} from '../persistence/host-local-seat.js';
import type { CampaignConnection } from './campaign-creation.js';
import type {
  LocalNetworkClientMessage,
  LocalNetworkHostMessage,
  LocalNetworkConnection,
  createLocalNetworkRuntime,
} from './network-application.js';
import {
  hostSeatLayer,
  hostSeatRecipient,
  hostSeatSnapshot,
  hostSeatVector,
} from './host-local-seat-presentation.js';

type Snapshot = ProjectionSnapshotV2Message;
type Reason = PresentationAssignmentReason;
type RestoreReason = Exclude<Reason, 'ADDRESSABLE_ROUTE'>;
type Grant =
  | { role: 'LEGACY' }
  | { role: 'WAITING' }
  | { role: 'GM'; gmContextId: string; campaignId: string }
  | {
      role: 'CANDIDATE';
      targetLocalOwnerId: string;
      candidateAckReceiptId: string;
      handoffId: string;
      networkScopeIdOrNull: string | null;
    }
  | { role: 'PLAYER'; targetLocalOwnerId: string; networkScopeId: string; seatId: string };
export interface HostSeatClient {
  readonly network: LocalNetworkConnection;
  readonly campaign: CampaignConnection;
  readonly trusted: () => boolean;
  readonly send: (message: LocalNetworkHostMessage) => void;
  readonly revoke: (scope: 'CONNECTION' | 'HANDOFF') => void;
  readonly characterContextId: () => string | null;
  readonly replayReceipts: (
    role: 'GM' | 'CANDIDATE',
    ids: readonly string[],
  ) => readonly CommandReceipt[];
  readonly capabilities: (
    role: 'GM' | 'CANDIDATE' | 'PLAYER' | null,
  ) => readonly WorkflowCommandId[];
  readonly restoreGm: (
    origin: HostSeatOrigin,
    formId: string,
    correlationId: string,
    reason: RestoreReason,
  ) => Promise<Snapshot>;
  readonly openOwnedLibrary: (
    ownerId: string,
    correlationId: string,
    reason: RestoreReason,
  ) => Promise<Snapshot>;
}
function deliverySource(view: Snapshot) {
  const base = view.presentation.base,
    p = base.roleFilteredPayload;
  const badge = view.presentation.layers.find((l) => l.formId === 'PLY-029')?.roleFilteredPayload;
  const hostView = badge?.['hostSeatView'] === 'ACTIVE' ? hostSeatViewValue(badge) : null;
  return {
    formId: base.formId,
    revision: view.revisions.projectionRevision,
    virtual: typeof p['hostSeatView'] === 'string',
    terminalResultReadOnly:
      hostView?.hostSeatView === 'ACTIVE' && hostView.terminalResultReadOnly === true,
    campaignId: typeof p['campaignId'] === 'string' ? p['campaignId'] : null,
    applicantIds:
      hostView?.hostSeatView === 'ACTIVE'
        ? (hostView.applicants ?? []).map((x) => x.requestId)
        : [],
    forms: [base, ...view.presentation.layers].map((f) => ({
      id: f.formId,
      actions: f.availableActionKeys,
    })),
  };
}
type NativeOrigin = { formId: string; revision: number };
type ConnectionState = {
  hostWorkflows: readonly WorkflowCommandId[];
  proof: string | null;
  last: ReturnType<typeof deliverySource> | null;
  addressed: string | null;
  manageOrigin: HostSeatOrigin | null;
  nativeOrigin: NativeOrigin | null;
};
class HostSeatPublicationError extends Error {}
const denied = (): never => {
  throw new NetworkApplicationStoreError('UNAVAILABLE');
};
const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
function profileId(commandId: string): string {
  const b = Buffer.from(digest('host-local-profile\0' + commandId), 'hex');
  b[6] = (b[6]! & 15) | 64;
  b[8] = (b[8]! & 63) | 128;
  const id = b.subarray(0, 16).toString('hex');
  return (
    id.slice(0, 8) +
    '-' +
    id.slice(8, 12) +
    '-' +
    id.slice(12, 16) +
    '-' +
    id.slice(16, 20) +
    '-' +
    id.slice(20)
  );
}
type Dependencies = {
  db: Database.Database;
  network: ReturnType<typeof createLocalNetworkRuntime>;
  heldNetworkConfiguration: (id: string) => { hostAddress: string; hostPort: number } | null;
  conflictingOperationPending: (id: string) => boolean;
  readApplicant: (origin: HostSeatOrigin, requestId: string) => HostSeatRequest | null;
  readScene: (origin: HostSeatOrigin) => { sceneId: string; included: readonly string[] } | null;
};

export function createHostLocalSeatRuntime(d: Dependencies) {
  const db = d.db,
    owner = () => loadDeviceId(db);
  let enabled = hostLocalSeatPresentAtStartup(db),
    epoch = 0;
  let state: HostLocalSeatHandoff | null = enabled ? readHostLocalSeatHandoff(db, owner()) : null;
  const sockets = new Map<HostSeatClient, ConnectionState>();
  const fresh = () => (state = readHostLocalSeatHandoff(db, owner()));
  function entry(c: HostSeatClient) {
    let item = sockets.get(c);
    if (!item) {
      item = {
        proof: null,
        last: null,
        addressed: null,
        manageOrigin: null,
        nativeOrigin: null,
        hostWorkflows: [],
      };
      sockets.set(c, item);
    }
    return item;
  }
  function authority(c: HostSeatClient): Grant {
    if (!enabled) return { role: 'LEGACY' };
    const k = sockets.get(c)?.proof;
    if (!c.trusted() || !state || !k || k !== state.activeProof || !state.active)
      return { role: 'WAITING' };
    const t = state.active;
    if (t.kind === 'GM')
      return { role: 'GM', gmContextId: t.origin.gmContextId, campaignId: t.origin.campaignId };
    if (t.kind === 'CANDIDATE')
      return {
        role: 'CANDIDATE',
        targetLocalOwnerId: t.profile.targetLocalOwnerId,
        handoffId: state.activeHandoffIdOrNull ?? denied(),
        candidateAckReceiptId: state.candidateAckReceiptIdOrNull ?? denied(),
        networkScopeIdOrNull:
          state.candidateSelectionOrNull?.formId === 'NET-003' ? t.networkScopeIdOrNull : null,
      };
    return {
      role: 'PLAYER',
      targetLocalOwnerId: t.profile.targetLocalOwnerId,
      networkScopeId: t.networkScopeId,
      seatId: t.localControllerSeatId,
    };
  }
  function checkOrigin(origin: HostSeatOrigin) {
    const gm = readLocalGmContext(db, origin.gmContextId),
      cursor = readCampaignCreationCursor(db, origin.gmContextId);
    if (
      gm.ownerDeviceId !== owner() ||
      readActiveLocalGmContext(db, gm.ownerDeviceId)?.gmLocalContextId !== origin.gmContextId ||
      cursor.ownerDeviceId !== gm.ownerDeviceId ||
      !['QUEUE', 'ADMISSION', 'CAMPAIGN'].includes(cursor.kind) ||
      cursor.targetId !== origin.campaignId
    )
      denied();
  }
  function safe(origin: HostSeatOrigin) {
    checkOrigin(origin);
    if (
      !d.heldNetworkConfiguration(origin.campaignId) ||
      d.conflictingOperationPending(origin.campaignId)
    )
      denied();
  }
  function roster(s: HostLocalSeatHandoff, origin: HostSeatOrigin): HostSeatEntry[] {
    return readHostLocalRoster(db, owner(), origin.campaignId).map(
      ({ binding, profileOwnerId }, i) => {
        const profile = s.profiles.find((p) => p.targetLocalOwnerId === profileOwnerId) ?? denied();
        return { ...profile, localControllerSeatId: binding.localControllerSeatId, ordinal: i + 1 };
      },
    );
  }
  function player(s: HostLocalSeatHandoff, origin: HostSeatOrigin, seatId: string) {
    const row =
      readHostLocalRoster(db, owner(), origin.campaignId).find(
        (r) => r.binding.localControllerSeatId === seatId,
      ) ?? denied();
    return playerFromRosterRow(s, origin, row);
  }
  function playerFromRosterRow(
    s: HostLocalSeatHandoff,
    origin: HostSeatOrigin,
    row: ReturnType<typeof readHostLocalRoster>[number],
  ): Extract<HostLocalSeatTarget, { kind: 'PLAYER' }> {
    const profile = s.profiles.find((p) => p.targetLocalOwnerId === row.profileOwnerId) ?? denied();
    const scope = { ownerDeviceId: owner(), networkScopeId: row.binding.networkScopeId };
    d.network.hostScopeIdle(scope);
    const currentScene = d.readScene(origin);
    const scene = currentScene?.included.includes(row.binding.campaignCharacterId)
      ? currentScene.sceneId
      : null;
    return {
      kind: 'PLAYER',
      origin,
      profile,
      networkScopeId: scope.networkScopeId,
      localControllerSeatId: row.binding.localControllerSeatId,
      admissionReceiptId: row.binding.admissionReceiptId,
      destinationFormId: scene === null ? 'NET-006' : 'PLY-001',
      sceneIdOrNull: scene,
    };
  }
  function applicant(
    s: HostLocalSeatHandoff,
    origin: HostSeatOrigin,
    id: string,
    verifyTerminalDecision = false,
  ): Extract<HostLocalSeatTarget, { kind: 'CANDIDATE' }> | null {
    const retired = readHostLocalTerminalApplicants(db, owner(), origin.campaignId).find(
      (row) => row.requestId === id,
    );
    if (retired) {
      const target =
        (verifyTerminalDecision
          ? readHostLocalTerminalApplicant(db, owner(), retired.ownerId, origin.campaignId, id)
              ?.target
          : readHostLocalTerminalTarget(db, owner(), retired.ownerId, origin.campaignId, id)) ??
        denied();
      if (
        !isDeepStrictEqual(target.origin, origin) ||
        !s.profiles.some((profile) => isDeepStrictEqual(profile, target.profile))
      )
        return denied();
      return target;
    }
    const request = d.readApplicant(origin, id);
    if (!request) return null;
    for (const profile of s.profiles) {
      const link = readHostLocalProfileScope(
        db,
        owner(),
        profile.targetLocalOwnerId,
        origin.campaignId,
      );
      if (!link) continue;
      const app = d.network.hostScopeIdle({
        ownerDeviceId: owner(),
        networkScopeId: link.networkScopeId,
      });
      if (
        app.requestOrNull?.requestId === id &&
        app.requestOrNull.submitReceiptId === request.submitReceiptId &&
        app.sessionOrNull?.technicalSessionId === request.technicalSessionId
      ) {
        return {
          kind: 'CANDIDATE',
          origin,
          profile,
          networkScopeIdOrNull: link.networkScopeId,
          requestOrNull: request,
        };
      }
    }
    return null;
  }
  function verifyTarget(s: HostLocalSeatHandoff, t: HostLocalSeatTarget) {
    safe(t.origin);
    if (
      t.kind === 'GM' &&
      ['GM-001', 'NET-016'].includes(t.destinationFormId) &&
      (d.readScene(t.origin) === null) !== (t.destinationFormId === 'NET-016')
    )
      return denied();
    if (t.kind === 'PLAYER' && !isDeepStrictEqual(player(s, t.origin, t.localControllerSeatId), t))
      denied();
    if (
      t.kind === 'CANDIDATE' &&
      t.requestOrNull &&
      !isDeepStrictEqual(applicant(s, t.origin, t.requestOrNull.requestId, true), t)
    )
      denied();
  }
  function terminalResult(t: HostLocalSeatTarget | null) {
    if (t?.kind !== 'CANDIDATE' || !t.requestOrNull) return null;
    const record = readHostLocalTerminalApplicant(
      db,
      owner(),
      t.profile.targetLocalOwnerId,
      t.origin.campaignId,
      t.requestOrNull.requestId,
    );
    if (record && !isDeepStrictEqual(record.target, t)) return denied();
    return record;
  }
  function isTerminalSource(t: HostLocalSeatTarget | null) {
    if (t?.kind !== 'CANDIDATE' || !t.requestOrNull) return false;
    const target = readHostLocalTerminalTarget(
      db,
      owner(),
      t.profile.targetLocalOwnerId,
      t.origin.campaignId,
      t.requestOrNull.requestId,
    );
    if (target && !isDeepStrictEqual(target, t)) return denied();
    return target !== null;
  }
  function assign(c: HostSeatClient, view: Snapshot) {
    const binding = entry(c);
    const { base, layers, assignment } = view.presentation;
    if (layers[0]?.formId === 'PLY-030' && !binding.hostWorkflows.includes(HOST_SEAT_ACK)) {
      binding.addressed = null;
      view = hostSeatSnapshot(
        { hostSeatView: 'WAITING', revision: view.revisions.projectionRevision },
        assignment.correlationId,
        assignment.reason,
      );
    } else if (
      base.roleFilteredPayload['hostSeatView'] === 'SETUP' &&
      !binding.hostWorkflows.includes(HOST_OWNER_PROFILE_CREATE)
    ) {
      view = {
        ...view,
        presentation: {
          ...view.presentation,
          base: {
            ...base,
            availableActionKeys: base.availableActionKeys.filter(
              (key) => key !== 'APP-003::CTA::011',
            ),
          },
        },
      };
    }
    const delivered = deliverySource(view);
    binding.last = delivered;
    try {
      c.send(view);
    } catch (cause) {
      throw new HostSeatPublicationError('Host-local projection publication failed', { cause });
    }
    if (
      delivered.formId !== 'NET-007' ||
      !delivered.terminalResultReadOnly ||
      view.presentation.base.availableActionKeys.includes('NET-007::CTA::005')
    )
      return;
    const issuedEpoch = epoch,
      proof = binding.proof,
      receipt = state?.activeReceiptIdOrNull;
    const campaignId = state?.active?.origin.campaignId;
    if (!proof || !receipt || !campaignId) return;
    d.network.awaitHostReturnBoundary(c.network, () => {
      if (
        epoch !== issuedEpoch ||
        !c.trusted() ||
        sockets.get(c) !== binding ||
        binding.proof !== proof ||
        binding.last !== delivered
      )
        return true;
      if (d.conflictingOperationPending(campaignId)) return false;
      const current = fresh();
      if (
        current.activeProof !== proof ||
        current.activeReceiptIdOrNull !== receipt ||
        current.active?.origin.campaignId !== campaignId
      )
        return true;
      const archived = terminalResult(current.active);
      if (
        !archived ||
        c.network.networkScopeId !== archived.target.networkScopeIdOrNull ||
        c.network.contextId !== archived.target.profile.targetLocalOwnerId
      )
        return true;
      const id =
        'network-owner-view:' +
        digest(JSON.stringify([receipt, delivered.revision, 'NET-007::CTA::005']));
      const native = d.network.hostTerminalSnapshot(
        c.network,
        archived,
        'NET-007',
        id,
        'HOST_SYSTEM_EVENT',
      );
      const next = decorate(c, native, true) ?? denied();
      assign(c, next);
      return true;
    });
  }
  function neutral(c: HostSeatClient, s: HostLocalSeatHandoff, id: string, reason: RestoreReason) {
    const pending = s.pending;
    entry(c).addressed = pending?.handoffId ?? null;
    if (!pending)
      return hostSeatSnapshot({ hostSeatView: 'WAITING', revision: s.revision }, id, reason);
    const target = hostSeatRecipient(pending.target);
    const returning =
      pending.target.kind === 'GM' && pending.target.destinationFormId === 'CMP-009';
    return hostSeatSnapshot(
      {
        hostSeatView: 'CURTAIN',
        revision: s.revision,
        handoffId: pending.handoffId,
        signedReturnContext: pending.signedReturnContext,
        target,
        decision: returning ? 'RETURN_INITIATOR' : 'ACTIVATE_TARGET',
      },
      id,
      reason,
      returning
        ? ['PLY-030::CTA::006']
        : pending.target.kind === 'CANDIDATE' && !pending.target.requestOrNull
          ? ['PLY-030::CTA::004', 'PLY-030::CTA::008']
          : ['PLY-030::CTA::001'],
    );
  }
  function revoke() {
    ++epoch;
    for (const [socket, b] of sockets) {
      b.last = null;
      b.proof = null;
      b.addressed = null;
      b.manageOrigin = null;
      b.nativeOrigin = null;
      const negotiatedAck = b.hostWorkflows.includes(HOST_SEAT_ACK);
      socket.revoke('HANDOFF');
      b.hostWorkflows =
        negotiatedAck && socket.capabilities(null).includes(HOST_SEAT_ACK) ? [HOST_SEAT_ACK] : [];
    }
  }
  function broadcast(s: HostLocalSeatHandoff, except: HostSeatClient, id: string) {
    for (const socket of sockets.keys())
      if (socket !== except && socket.trusted())
        assign(socket, neutral(socket, s, id, 'HOST_SYSTEM_EVENT'));
  }
  function setup(s: HostLocalSeatHandoff, id: string, reason: RestoreReason) {
    const prep = s.setupOrNull ?? denied();
    const keys: ActionKey[] = ['APP-003::CTA::005', 'APP-003::CTA::010', 'APP-003::CTA::011'];
    if (roster(s, prep.origin).length === 0) keys.push('APP-003::CTA::004');
    if (s.profiles.length) keys.push('APP-003::CTA::012');
    if (
      prep.selectedProfileOrNull &&
      !readHostLocalOwnedCharacters(db, owner(), prep.selectedProfileOrNull.targetLocalOwnerId)
        .length &&
      !readHostLocalProfileScope(
        db,
        owner(),
        prep.selectedProfileOrNull.targetLocalOwnerId,
        prep.origin.campaignId,
      )
    )
      keys.push('APP-003::CTA::013');
    return hostSeatSnapshot(
      {
        hostSeatView: 'SETUP',
        revision: s.revision,
        profiles: s.profiles.map((p) => ({ ...p })),
        selectedProfileOrNull: prep.selectedProfileOrNull && { ...prep.selectedProfileOrNull },
      },
      id,
      reason,
      keys,
    );
  }
  function manage(
    c: HostSeatClient,
    s: HostLocalSeatHandoff,
    origin: HostSeatOrigin,
    id: string,
    reason: RestoreReason,
  ) {
    checkOrigin(origin);
    const binding = entry(c),
      cursor = readCampaignCreationCursor(db, origin.gmContextId);
    binding.manageOrigin = origin;
    binding.nativeOrigin = { formId: cursor.formId, revision: cursor.revisions.projectionRevision };
    const seats = roster(s, origin);
    const returnedProfiles =
      s.active?.kind === 'GM' && seats.length < 3
        ? s.profiles
            .filter((profile) =>
              hostLocalProfileReturnedBeforeSubmit(
                db,
                owner(),
                profile.targetLocalOwnerId,
                origin.campaignId,
              ),
            )
            .map((profile) => ({ ...profile }))
        : [];
    return hostSeatSnapshot(
      {
        hostSeatView: 'MANAGE',
        revision: s.revision,
        campaignId: origin.campaignId,
        gmContextId: origin.gmContextId,
        seats,
        ...(returnedProfiles.length ? { returnedProfiles } : {}),
      },
      id,
      reason,
      [
        'CMP-009::CTA::001',
        ...(seats.length < 3 ? ['CMP-009::CTA::002' as const] : []),
        ...(returnedProfiles.length ? ['CMP-009::CTA::004' as const] : []),
      ],
    );
  }
  function admission(s: HostLocalSeatHandoff, id: string, reason: RestoreReason) {
    const t = s.active;
    if (t?.kind !== 'CANDIDATE') return denied();
    const selectedSourceUuids = s.candidateSelectionOrNull?.selectedSourceUuids ?? [];
    const keys: ActionKey[] = ['APP-003::CTA::014'];
    if (selectedSourceUuids.length < 3) keys.unshift('APP-003::CTA::001');
    if (selectedSourceUuids.length) keys.push('APP-003::CTA::009');
    return hostSeatSnapshot(
      {
        hostSeatView: 'ADMISSION',
        revision: s.revision,
        profile: { ...t.profile },
        selectedSourceUuids,
      },
      id,
      reason,
      keys,
    );
  }
  function begin(
    c: HostSeatClient,
    s: HostLocalSeatHandoff,
    t: HostLocalSeatTarget,
    id: string,
    reason: RestoreReason = 'FORM_ACTION',
    resumeId?: string,
    retire?: FormActionIntentV2Message,
  ) {
    const held = entry(c).proof;
    if (!held || held !== s.activeProof || !c.trusted()) return denied();
    const source = s.active;
    const sourceScope =
      source?.kind === 'CANDIDATE'
        ? source.networkScopeIdOrNull
        : source?.kind === 'PLAYER'
          ? source.networkScopeId
          : null;
    const check = () => {
      if (!c.trusted() || entry(c).proof !== held) denied();
      verifyTarget(s, t);
      if (sourceScope !== null && !isTerminalSource(source))
        d.network.hostScopeIdle({ ownerDeviceId: owner(), networkScopeId: sourceScope });
    };
    beginHostLocalSeatHandoff(
      db,
      owner(),
      {
        commandId: 'host-seat-begin:' + id,
        expectedRevision: s.revision,
        activeProof: held,
        target: t,
        ...(retire && (retire.sourceFormId === 'NET-003' || retire.sourceFormId === 'NET-007')
          ? {
              retireReturnFrom: retire.sourceFormId,
              retireNavigation: {
                navigationRequestId: retire.navigationRequestId,
                expectedProjectionRevision: retire.expectedProjectionRevision,
              },
            }
          : {}),
      },
      check,
    );
    const now = fresh();
    revoke();
    broadcast(now, c, id);
    const view = neutral(c, now, resumeId ?? id, resumeId ? 'RECONNECT' : reason);
    if (!resumeId) assign(c, view);
    return view;
  }
  function promote(
    c: HostSeatClient,
    s: HostLocalSeatHandoff,
    view: Snapshot,
  ): HostLocalSeatHandoff {
    const t = s.active;
    if (
      t?.kind !== 'CANDIDATE' ||
      !t.networkScopeIdOrNull ||
      !['NET-006', 'PLY-001'].includes(view.presentation.base.formId)
    )
      return s;
    const row = readHostLocalRoster(db, owner(), t.origin.campaignId).find(
      (r) =>
        r.binding.networkScopeId === t.networkScopeIdOrNull &&
        r.profileOwnerId === t.profile.targetLocalOwnerId,
    );
    if (!row) return denied();
    const target = playerFromRosterRow(s, t.origin, row);
    promoteHostLocalSeat(
      db,
      owner(),
      {
        commandId: 'host-seat-promote:' + row.binding.admissionReceiptId,
        expectedRevision: s.revision,
        activeProof: s.activeProof,
        target,
      },
      () => {
        if (!c.trusted() || !s.activeProof || entry(c).proof !== s.activeProof) denied();
      },
    );
    return fresh();
  }
  function decorate(
    c: HostSeatClient,
    view: Snapshot,
    terminalResultReadOnly = false,
  ): Snapshot | null {
    const b = entry(c);
    if (!c.trusted()) return null;
    if (b.last?.terminalResultReadOnly && !terminalResultReadOnly) return null;
    if (
      view.presentation.assignment.reason === 'HOST_SYSTEM_EVENT' &&
      b.last?.forms.some(
        (form) => form.id === 'CMP-009' || form.id === 'PLY-027' || form.id === 'PLY-028',
      )
    )
      return null;
    let s = enabled ? fresh() : null;
    const grant = authority(c),
      base = view.presentation.base,
      p = base.roleFilteredPayload;
    if (grant.role === 'WAITING') return null;
    const keys = new Set(base.availableActionKeys);
    const gm = grant.role === 'GM' || (grant.role === 'LEGACY' && view.projectionRole === 'gm');
    if (
      gm &&
      base.formId === 'CMP-008' &&
      view.presentation.layers.length === 0 &&
      p['safeBoundary'] === true &&
      c.campaign.gmLocalContextId !== null &&
      c.campaign.executableReview?.includes(HOST_SEAT_ACK) &&
      c.campaign.executableReview.includes(HOST_OWNER_PROFILE_CREATE)
    )
      keys.add('CMP-008::CTA::001');
    if (grant.role === 'LEGACY') {
      const result = {
        ...view,
        presentation: { ...view.presentation, base: { ...base, availableActionKeys: [...keys] } },
      };
      b.last =
        gm && (base.formId === 'CMP-008' || base.formId === 'NET-017')
          ? deliverySource(result)
          : null;
      return result;
    }
    if (!s || !s.active) return null;
    if (gm !== (view.projectionRole === 'gm')) return null;
    if (
      grant.role === 'CANDIDATE' &&
      view.projectionRole === 'player' &&
      grant.networkScopeIdOrNull !== null &&
      (p['networkScopeId'] !== grant.networkScopeIdOrNull ||
        c.network.networkScopeId !== grant.networkScopeIdOrNull)
    )
      return null;
    if (
      grant.role === 'PLAYER' &&
      (p['networkScopeId'] !== grant.networkScopeId ||
        c.network.networkScopeId !== grant.networkScopeId)
    )
      return null;
    if (grant.role === 'CANDIDATE') s = promote(c, s, view);
    const active = s.active ?? denied(),
      origin = active.origin;
    if (active.kind === 'CANDIDATE') {
      if (base.formId === 'CHR-040') keys.delete('CHR-040::CTA::002');
      if (base.formId === 'NET-007') keys.delete('NET-007::CTA::003');
      if (base.formId === 'NET-011') keys.delete('NET-011::CTA::005');
    }
    if (gm && c.campaign.gmLocalContextId !== origin.gmContextId) return null;
    const boundary =
      view.presentation.layers.length === 0 && !d.conflictingOperationPending(origin.campaignId);
    let applicants: HostSeatApplicant[] | undefined;
    if (boundary) {
      if (gm && base.formId === 'NET-017') {
        keys.add('NET-017::CTA::006');
        applicants = [];
        for (const profile of s.profiles) {
          const link = readHostLocalProfileScope(
            db,
            owner(),
            profile.targetLocalOwnerId,
            origin.campaignId,
          );
          if (!link) continue;
          const app = d.network.hostScopeIdle({
            ownerDeviceId: owner(),
            networkScopeId: link.networkScopeId,
          });
          const id = app.requestOrNull?.requestId;
          if (
            id &&
            d.readApplicant(origin, id)?.submitReceiptId === app.requestOrNull?.submitReceiptId
          )
            applicants.push({ ...profile, requestId: id });
        }
        for (const { requestId, ownerId } of readHostLocalTerminalApplicants(
          db,
          owner(),
          origin.campaignId,
        )) {
          const profile = s.profiles.find((p) => p.targetLocalOwnerId === ownerId) ?? denied();
          if (applicants.some((row) => row.requestId === requestId)) return denied();
          applicants.push({ ...profile, requestId });
        }
        if (applicants.length) keys.add('NET-017::CTA::011');
      }
      if (
        gm &&
        base.formId === 'NET-016' &&
        p['panelVariant'] === 'PRE_START' &&
        roster(s, origin).length
      )
        keys.add('NET-016::CTA::006');
      if (gm && base.formId === 'GM-001' && roster(s, origin).length) keys.add('GM-001::CTA::012');
      if (
        active.kind === 'PLAYER' &&
        base.formId === 'NET-006' &&
        p['pendingCommandIdOrNull'] == null
      )
        keys.add('NET-006::CTA::005');
      if (
        active.kind === 'PLAYER' &&
        base.formId === 'PLY-001' &&
        p['technicalSessionAvailable'] === true &&
        p['pendingCommandIdOrNull'] === null
      )
        keys.add('PLY-001::CTA::015');
      if (
        active.kind === 'CANDIDATE' &&
        base.formId === 'NET-005' &&
        p['pendingCommandIdOrNull'] == null
      )
        keys.add('NET-005::CTA::004');
      if (
        active.kind === 'CANDIDATE' &&
        base.formId === 'NET-007' &&
        p['pendingCommandIdOrNull'] == null
      )
        keys.add('NET-007::CTA::005');
      if (active.kind === 'CANDIDATE' && base.formId === 'NET-003' && active.networkScopeIdOrNull) {
        const app = d.network.hostScopeIdle({
          ownerDeviceId: owner(),
          networkScopeId: active.networkScopeIdOrNull,
        });
        if (
          app.requestOrNull?.closureOrNull ||
          app.requestReviewOrNull?.requestStatus === 'CANCELLED'
        )
          keys.add('NET-003::CTA::005');
        else if (app.requestOrNull === null) keys.add('NET-003::CTA::004');
      }
    }
    const context = gm
      ? origin.gmContextId
      : (p['contextId'] ?? c.characterContextId() ?? c.network.contextId);
    if (typeof context !== 'string') return null;
    const scope =
      active.kind === 'PLAYER'
        ? active.networkScopeId
        : grant.role === 'CANDIDATE'
          ? grant.networkScopeIdOrNull
          : null;
    const badges =
      s.activeReceiptIdOrNull === null && gm
        ? []
        : [
            hostSeatLayer(
              'PLY-029',
              {
                hostSeatView: 'ACTIVE',
                revision: s.revision,
                target: hostSeatRecipient(active),
                receiptId: s.activeReceiptIdOrNull ?? denied(),
                contextId: context,
                networkScopeIdOrNull: scope,
                ...(terminalResultReadOnly ? { terminalResultReadOnly: true as const } : {}),
                ...(keys.has('NET-016::CTA::006') ? { seats: roster(s, origin) } : {}),
                ...(applicants?.length ? { applicants } : {}),
                ...(active.kind === 'CANDIDATE' && base.formId === 'APP-004'
                  ? { selectedSourceUuids: s.candidateSelectionOrNull?.selectedSourceUuids ?? [] }
                  : {}),
              },
              [],
            ),
          ];
    const result = {
      ...view,
      presentation: {
        ...view.presentation,
        base: { ...base, availableActionKeys: [...keys] },
        layers: [...view.presentation.layers, ...badges],
      },
    };
    b.last = deliverySource(result);
    return result;
  }
  function licensed(c: HostSeatClient, s: HostLocalSeatHandoff) {
    if (!c.trusted() || !s.activeProof || entry(c).proof !== s.activeProof) return denied();
  }
  function currentNav(c: HostSeatClient, revision: number, key: ActionKey, form?: string) {
    const b = entry(c),
      dest = b.last ?? denied();
    if (
      dest.revision !== revision ||
      !dest.forms.some((x) => (form === undefined || form === x.id) && x.actions.includes(key))
    )
      denied();
    if (dest.virtual && fresh().revision !== dest.revision) return denied();
    if (dest.terminalResultReadOnly) {
      const record = terminalResult(fresh().active) ?? denied();
      if (
        c.network.networkScopeId !== record.target.networkScopeIdOrNull ||
        c.network.contextId !== record.target.profile.targetLocalOwnerId ||
        record.application.projectionRevision !== revision
      )
        return denied();
      return record;
    }
    const source = dest.virtual ? b.nativeOrigin : dest;
    if (!source) return null;
    if (['CMP-008', 'NET-016', 'NET-017', 'GM-001'].includes(source.formId)) {
      const gmId = c.campaign.gmLocalContextId ?? denied(),
        cursor = readCampaignCreationCursor(db, gmId);
      if (
        cursor.ownerDeviceId !== owner() ||
        cursor.formId !== source.formId ||
        cursor.revisions.projectionRevision !== source.revision
      )
        return denied();
    } else if (['NET-003', 'NET-005', 'NET-006', 'NET-007', 'PLY-001'].includes(source.formId)) {
      if (d.network.currentVector(c.network).projectionRevision !== source.revision)
        return denied();
    }
    return null;
  }
  function gmManage(c: HostSeatClient, id: string, reason: RestoreReason) {
    const s = fresh(),
      b = entry(c),
      base = b.last ?? denied();
    const cid = base.campaignId,
      gmId = c.campaign.gmLocalContextId;
    if (
      !c.trusted() ||
      !gmId ||
      typeof cid !== 'string' ||
      !['LEGACY', 'GM'].includes(authority(c).role)
    )
      return denied();
    const origin = s.active?.origin ?? {
      gmContextId: gmId,
      campaignId: cid,
      returnFormId: 'CMP-009',
      gmDeliveryProof: digest(randomUUID()),
    };
    if (gmId !== origin.gmContextId || cid !== origin.campaignId) return denied();
    safe(origin);
    assign(c, manage(c, s, origin, id, reason));
  }
  function activeManage(
    c: HostSeatClient,
    s: HostLocalSeatHandoff,
    id: string,
    reason: RestoreReason,
  ) {
    const gm = s.active;
    if (gm?.kind !== 'GM') return denied();
    const result = manage(c, s, gm.origin, id, reason);
    if (!s.activeReceiptIdOrNull) return result;
    const badge = hostSeatLayer(
      'PLY-029',
      {
        hostSeatView: 'ACTIVE',
        revision: s.revision,
        target: { kind: 'GM' },
        receiptId: s.activeReceiptIdOrNull,
        contextId: gm.origin.gmContextId,
        networkScopeIdOrNull: null,
      },
      [],
    );
    return { ...result, presentation: { ...result.presentation, layers: [badge] } };
  }
  function confirmNativeGm(s: HostLocalSeatHandoff, verify: () => void) {
    const ack = s.activeReceiptIdOrNull;
    const setupReturn = s.setupReturnReceiptIdOrNull;
    // A new setup return can retain the same GM ACK while issuing a new proof.
    const anchor = setupReturn
      ? { commandId: 'host-local-setup-shown:' + setupReturn, setupReturnReceiptId: setupReturn }
      : ack
        ? { commandId: 'host-local-shown:' + ack, ackReceiptId: ack }
        : denied();
    markHostLocalGmDestination(
      db,
      owner(),
      { ...anchor, expectedRevision: s.revision, activeProof: s.activeProof },
      verify,
    );
    fresh();
  }
  async function destination(
    c: HostSeatClient,
    s: HostLocalSeatHandoff,
    id: string,
    reason: RestoreReason,
    unacknowledged: readonly string[] = [],
  ) {
    const b = entry(c);
    if (!b.proof || s.activeProof !== b.proof) return neutral(c, s, id, reason);
    if (s.setupOrNull) return setup(s, id, reason);
    const t = s.active ?? denied(),
      verify = () => {
        licensed(c, s);
        if (state?.activeProof !== s.activeProof) denied();
      };
    let native: Snapshot;
    if (t.kind === 'GM') {
      const virtual =
        !s.gmDestinationConfirmed && ['CMP-009', 'PLY-027'].includes(t.destinationFormId);
      const desired = s.gmDestinationConfirmed
        ? 'CURRENT'
        : virtual
          ? 'CMP-008'
          : t.destinationFormId;
      native = await c.restoreGm(t.origin, desired, id, reason);
      verify();
      if (virtual)
        return t.destinationFormId === 'CMP-009'
          ? activeManage(c, s, id, reason)
          : hostSeatSnapshot({ hostSeatView: 'GM_ONLY', revision: s.revision }, id, reason, [
              'PLY-027::CTA::001',
            ]);
      if (!s.gmDestinationConfirmed) {
        if (native.presentation.base.formId !== desired) return denied();
        confirmNativeGm(s, verify);
      }
    } else if (
      t.kind === 'CANDIDATE' &&
      (t.networkScopeIdOrNull === null || s.candidateSelectionOrNull?.formId !== 'NET-003')
    ) {
      if (s.candidateSelectionOrNull?.formId === 'APP-003') return admission(s, id, reason);
      native = await c.openOwnedLibrary(t.profile.targetLocalOwnerId, id, reason);
      verify();
    } else {
      const scopeId = (t.kind === 'PLAYER' ? t.networkScopeId : t.networkScopeIdOrNull) ?? denied();
      const archived = terminalResult(t);
      if (archived) {
        verify();
        return (
          decorate(
            c,
            d.network.hostTerminalSnapshot(c.network, archived, 'NET-007', id, reason),
            true,
          ) ?? denied()
        );
      }
      const selection = s.candidateSelectionOrNull;
      if (t.kind === 'CANDIDATE' && selection?.networkEntry) {
        const nav: FormActionIntentV2Message = {
          protocolVersion: 2,
          messageType: 'navigation.form-action',
          sourceFormId: 'APP-003',
          actionKey: 'APP-003::CTA::009',
          ...selection.networkEntry,
        };
        if (
          !d.network.hostCandidateEntryComplete(
            { ownerDeviceId: owner(), networkScopeId: scopeId },
            nav,
            selection.selectedSourceUuids,
          )
        ) {
          await d.network.enterHostCandidate(
            c.network,
            t.origin,
            b.proof,
            selection.selectedSourceUuids,
            nav,
            d.heldNetworkConfiguration(t.origin.campaignId) ?? denied(),
            verify,
          );
          verify();
        }
      }
      native = await d.network.hostSnapshot(
        c.network,
        scopeId,
        t.profile.targetLocalOwnerId,
        id,
        reason,
        verify,
      );
      verify();
      if (t.kind === 'CANDIDATE' && !t.requestOrNull) {
        const app = d.network.hostScopeIdle({ ownerDeviceId: owner(), networkScopeId: scopeId });
        if (
          app.requestOrNull &&
          !app.requestOrNull.closureOrNull &&
          app.requestOrNull.submitReceiptId
        ) {
          if (unacknowledged.includes(app.requestOrNull.submitCommandId)) {
            const [receipt] = d.network.hostSeatReceipts(c.network, [
              app.requestOrNull.submitCommandId,
            ]);
            if (!receipt) return denied();
            c.send({
              messageType: 'command.replay',
              protocolVersion: 1,
              lifecycleState: 'IDEMPOTENT_REPLAY',
              receipt,
            });
          }
          return begin(
            c,
            s,
            { kind: 'GM', origin: t.origin, destinationFormId: 'NET-017' },
            app.requestOrNull.submitCommandId,
            'COMMAND_DESTINATION',
            id,
          );
        }
      }
      if (
        t.kind === 'PLAYER' &&
        (!['PLY-001', 'NET-006', 'NET-007'].includes(native.presentation.base.formId) ||
          native.presentation.base.roleFilteredPayload['networkScopeId'] !== scopeId)
      )
        return denied();
    }
    const shown = decorate(c, native) ?? denied();
    if (t.kind !== 'GM' && c.network.networkScopeId !== null) {
      const issuedEpoch = epoch;
      const ownsDelivery = () =>
        epoch === issuedEpoch &&
        state?.activeProof === s.activeProof &&
        state?.activeReceiptIdOrNull === s.activeReceiptIdOrNull &&
        c.trusted() &&
        sockets.get(c)?.proof === s.activeProof;
      // The network poll compares native projections. The host-only return action also
      // depends on external work which can start and finish without a lobby revision.
      d.network.watchHostSeat(
        c.network,
        native,
        (message) => {
          if (ownsDelivery()) {
            if (message.messageType === 'projection.snapshot' && message.protocolVersion === 2) {
              const next = decorate(c, message);
              if (next) c.send(next);
            } else c.send(message);
          }
        },
        (view) => {
          const last = b.last;
          if (
            !ownsDelivery() ||
            state?.active?.kind !== 'PLAYER' ||
            c.network.networkScopeId !== state.active.networkScopeId ||
            view.presentation.base.formId !== 'NET-006' ||
            view.presentation.base.roleFilteredPayload['pendingCommandIdOrNull'] != null ||
            last?.formId !== 'NET-006' ||
            last.virtual
          )
            return false;
          const available =
            view.presentation.layers.length === 0 &&
            !d.conflictingOperationPending(t.origin.campaignId);
          return last.forms[0]?.actions.includes('NET-006::CTA::005') !== available;
        },
      );
    }
    return shown;
  }
  async function resume(
    c: HostSeatClient,
    m: Extract<HostSeatControlV3Message, { operation: 'RESUME' }>,
  ) {
    if (!enabled || !c.trusted()) return denied();
    const s = fresh(),
      b = entry(c),
      key = m.deliveryKeyOrNull ? digest(m.deliveryKeyOrNull) : null;
    b.last = null;
    b.addressed = null;
    b.manageOrigin = null;
    b.nativeOrigin = null;
    const supportsHandoff = m.supportedWorkflowCommandIds.includes(HOST_SEAT_ACK);
    b.proof = supportsHandoff && key && key === s.activeProof ? key : null;
    b.hostWorkflows = [];
    function publish(view: Snapshot, executable: readonly WorkflowCommandId[]) {
      c.send({
        protocolVersion: 2,
        messageType: 'session.reconnect.capabilities',
        reconnectRequestId: m.requestId,
        executableWorkflowCommandIds: executable,
        revisions: view.revisions,
      });
      b.hostWorkflows = executable.filter(
        (id) => id === HOST_SEAT_ACK || id === HOST_OWNER_PROFILE_CREATE,
      );
      assign(c, view);
    }
    function waitWithoutGrant() {
      b.proof = null;
      b.addressed = null;
      b.manageOrigin = null;
      b.nativeOrigin = null;
      c.revoke('CONNECTION');
      publish(
        hostSeatSnapshot(
          { hostSeatView: 'WAITING', revision: state?.revision ?? s.revision },
          m.requestId,
          'RECONNECT',
        ),
        [],
      );
    }
    const grant = authority(c);
    const role =
      b.proof && s.setupOrNull
        ? 'GM'
        : grant.role === 'GM' || grant.role === 'PLAYER' || grant.role === 'CANDIDATE'
          ? grant.role
          : null;
    if (!supportsHandoff || !c.capabilities(role).includes(HOST_SEAT_ACK))
      return waitWithoutGrant();
    const view = await destination(c, s, m.requestId, 'RECONNECT', m.unacknowledgedCommandIds);
    const historical = deliverySource(view).terminalResultReadOnly;
    const executable = c
      .capabilities(state?.pending ? null : role)
      .filter(
        (id) =>
          m.supportedWorkflowCommandIds.includes(id) &&
          (!historical || id === HOST_SEAT_ACK) &&
          (!s.setupOrNull || id === HOST_SEAT_ACK || id === HOST_OWNER_PROFILE_CREATE),
      );
    if (!executable.includes(HOST_SEAT_ACK)) return waitWithoutGrant();
    if (b.proof && state?.activeProof === b.proof && state.active) {
      const now = authority(c);
      const ids = m.unacknowledgedCommandIds;
      if (ids.length) {
        const receipts = historical
          ? []
          : now.role === 'PLAYER' || (now.role === 'CANDIDATE' && now.networkScopeIdOrNull !== null)
            ? d.network.hostSeatReceipts(c.network, ids)
            : now.role === 'GM' || now.role === 'CANDIDATE'
              ? c.replayReceipts(now.role, ids)
              : [];
        for (const id of ids) {
          const found = receipts.find((r) => r.commandId === id);
          if (found)
            c.send({
              protocolVersion: 1,
              messageType: 'command.replay',
              lifecycleState: 'IDEMPOTENT_REPLAY',
              receipt: found,
            });
          else
            c.send({
              protocolVersion: 1,
              messageType: 'command.refusal',
              commandId: id,
              lastLifecycleState: null,
              revisions: view.revisions,
              refusal: { code: 'GUARD_REJECTED' },
            });
        }
      }
    }
    publish(view, executable);
  }
  const idVector = (value: {
    projectionRevision: number;
    actorVisibilityRevision: number;
    stateRevision: number;
  }) => {
    if (
      value.projectionRevision !== value.stateRevision ||
      value.stateRevision !== value.actorVisibilityRevision
    )
      return denied();
    return value.stateRevision;
  };
  function result(
    c: HostSeatClient,
    out: ReturnType<typeof createHostSeatProfile>,
    data: JsonObject,
  ) {
    const r = out.receipt,
      receipt = {
        commandId: r.commandId,
        receiptId: r.receiptId,
        revisions: hostSeatVector(r.revision),
        result: { receiptId: r.receiptId, ...data },
      };
    c.send(
      out.replayed
        ? {
            messageType: 'command.replay',
            protocolVersion: 1,
            lifecycleState: 'IDEMPOTENT_REPLAY',
            receipt,
          }
        : {
            messageType: 'command.result',
            protocolVersion: 1,
            lifecycleState: 'COMMITTED',
            receipt,
          },
    );
  }
  async function process(c: HostSeatClient, m: LocalNetworkClientMessage) {
    const b = entry(c),
      control = m.messageType === 'host.seat.control' ? m : null,
      nav = m.messageType === 'navigation.form-action' ? m : null;
    const command =
      m.messageType === 'command.request' && m.commandKind === 'workflow-command' ? m : null;
    const ack = command?.workflowCommandId === HOST_SEAT_ACK ? command : null,
      create = command?.workflowCommandId === HOST_OWNER_PROFILE_CREATE ? command : null;
    if (!enabled && !control && !create && !nav) return false;
    const key = nav?.actionKey;
    if (
      !enabled &&
      !control &&
      !create &&
      key !== 'CMP-008::CTA::001' &&
      key !== 'CMP-009::CTA::001' &&
      key !== 'NET-017::CTA::006'
    )
      return false;
    let completed = false;
    try {
      if (!c.trusted()) return denied();
      if (
        enabled &&
        (m.messageType === 'session.reconnect' ||
          m.messageType === 'campaign.local-context.resume' ||
          m.messageType === 'network.local-context.resume')
      ) {
        await resume(c, {
          messageType: 'host.seat.control',
          protocolVersion: 3,
          operation: 'RESUME',
          deliveryKeyOrNull: null,
          requestId: m.reconnectRequestId,
          supportedWorkflowCommandIds: m.supportedWorkflowCommandIds,
          unacknowledgedCommandIds: [],
        });
        return true;
      }
      if (control?.operation === 'RESUME') {
        await resume(c, control);
        return true;
      }
      if (nav && (key === 'CMP-008::CTA::001' || key === 'NET-017::CTA::006')) {
        currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId);
        gmManage(c, nav.navigationRequestId, 'FORM_ACTION');
        return true;
      }
      const s = fresh();
      if (nav && key === 'CMP-009::CTA::001') {
        currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId);
        const origin = b.manageOrigin ?? denied();
        safe(origin);
        const snap = await c.restoreGm(origin, 'CMP-008', nav.navigationRequestId, 'FORM_ACTION');
        if (s.active?.kind === 'GM' && !s.gmDestinationConfirmed) {
          if (snap.projectionRole !== 'gm' || snap.presentation.base.formId !== 'CMP-008')
            return denied();
          confirmNativeGm(s, () => licensed(c, s));
        }
        const checked = decorate(c, snap) ?? denied();
        assign(c, checked);
        return true;
      }
      if (control?.operation === 'ENTER_SETUP') {
        currentNav(c, control.expectedProjectionRevision, 'CMP-009::CTA::002', 'CMP-009');
        const grant = authority(c),
          origin = b.manageOrigin ?? denied();
        if (
          (grant.role !== 'GM' && grant.role !== 'LEGACY') ||
          c.campaign.gmLocalContextId !== origin.gmContextId
        )
          return denied();
        const key = digest(control.deliveryKey);
        const sourceWorkflows =
          grant.role === 'LEGACY' ? (c.campaign.executableReview ?? []) : b.hostWorkflows;
        const scoped = { ...origin, gmDeliveryProof: s.active?.origin.gmDeliveryProof ?? key };
        openHostLocalSeatSetup(
          db,
          owner(),
          {
            commandId: control.requestId,
            expectedRevision: s.revision,
            activeProof: b.proof,
            origin: scoped,
            setupProof: key,
          },
          () => {
            if (!c.trusted() || c.campaign.gmLocalContextId !== origin.gmContextId) denied();
            safe(origin);
          },
        );
        completed = true;
        enabled = true;
        d.network.hostLocalSetupCommitted();
        const next = fresh();
        revoke();
        b.proof = key;
        b.hostWorkflows = c
          .capabilities('GM')
          .filter(
            (id) =>
              (id === HOST_SEAT_ACK || id === HOST_OWNER_PROFILE_CREATE) &&
              sourceWorkflows.includes(id),
          );
        broadcast(next, c, control.requestId);
        assign(c, setup(next, control.requestId, 'FORM_ACTION'));
        return true;
      }
      if (!enabled) return false;
      if (ack) {
        const payload = hostSeatAckPayloadValue(ack.payload),
          revision = idVector(ack.expectedRevisions),
          freshAck = s.revision === revision;
        const guard = (actual: HostLocalSeatHandoff, phase: 'APPLY' | 'REPLAY') => {
          if (!c.trusted()) denied();
          if (phase === 'REPLAY') return;
          const p = actual.pending ?? denied();
          const returning = p.target.kind === 'GM' && p.target.destinationFormId === 'CMP-009';
          if (
            !b.hostWorkflows.includes(HOST_SEAT_ACK) ||
            !freshAck ||
            b.addressed !== p.handoffId ||
            p.handoffId !== payload.handoffId ||
            p.signedReturnContext !== payload.signedReturnContext ||
            payload.decision !== (returning ? 'RETURN_INITIATOR' : 'ACTIVATE_TARGET') ||
            ack.role !== (p.target.kind === 'GM' ? 'gm' : 'player')
          )
            denied();
          verifyTarget(actual, p.target);
        };
        const out = ackHostLocalSeatHandoff(
          db,
          owner(),
          {
            commandId: ack.commandId,
            expectedRevision: revision,
            handoffId: payload.handoffId,
            signedReturnContext: payload.signedReturnContext,
            decision: payload.decision,
            role: ack.role,
            recipientProof: digest(payload.deliveryKey),
          },
          guard,
        );
        completed = true;
        if (!out.replayed) {
          const next = fresh();
          revoke();
          broadcast(next, c, ack.commandId);
        }
        result(c, out, { handoffId: payload.handoffId, decision: payload.decision });
        return true;
      }
      const guard = () => licensed(c, s);
      if (create) {
        const prep = s.setupOrNull ?? denied(),
          label = create.payload['targetProfileLabel'];
        if (
          create.role !== 'gm' ||
          Object.keys(create.payload).length !== 1 ||
          typeof label !== 'string' ||
          !label.trim()
        )
          return denied();
        guard();
        const profile = {
          targetLocalOwnerId: profileId(create.commandId),
          targetProfileLabel: label,
        };
        const out = createHostSeatProfile(
          db,
          owner(),
          {
            commandId: create.commandId,
            expectedRevision: idVector(create.expectedRevisions),
            origin: prep.origin,
            activeProof: b.proof,
            profile,
          },
          (_actual, phase) => {
            guard();
            if (phase === 'APPLY' && !b.hostWorkflows.includes(HOST_OWNER_PROFILE_CREATE)) denied();
          },
        );
        completed = true;
        result(c, out, profile);
        assign(c, setup(fresh(), create.commandId, 'COMMAND_DESTINATION'));
        return true;
      }
      if (control?.operation === 'RESUME_PROFILE') {
        currentNav(c, control.expectedProjectionRevision, 'CMP-009::CTA::004', 'CMP-009');
        const origin = b.manageOrigin ?? denied(),
          profile =
            s.profiles.find((p) => p.targetLocalOwnerId === control.targetLocalOwnerId) ?? denied();
        if (
          s.active?.kind !== 'GM' ||
          !hostLocalProfileReturnedBeforeSubmit(
            db,
            owner(),
            profile.targetLocalOwnerId,
            origin.campaignId,
          )
        )
          return denied();
        begin(
          c,
          s,
          { kind: 'CANDIDATE', profile, origin, networkScopeIdOrNull: null, requestOrNull: null },
          control.requestId,
        );
        return true;
      }
      if (control?.operation === 'SELECT_PROFILE') {
        currentNav(c, control.expectedProjectionRevision, 'APP-003::CTA::012');
        selectHostSeatProfile(
          db,
          owner(),
          {
            commandId: control.requestId,
            expectedRevision: s.revision,
            activeProof: b.proof,
            targetLocalOwnerId: control.targetLocalOwnerId,
          },
          guard,
        );
        completed = true;
        assign(c, setup(fresh(), control.requestId, 'FORM_ACTION'));
        return true;
      }
      if (
        nav &&
        (key === 'APP-003::CTA::004' ||
          key === 'APP-003::CTA::005' ||
          key === 'APP-003::CTA::010' ||
          key === 'APP-003::CTA::013')
      ) {
        currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId);
        guard();
        const prep = s.setupOrNull ?? denied();
        if (key === 'APP-003::CTA::004' || key === 'APP-003::CTA::005') {
          const formId = key === 'APP-003::CTA::004' ? 'PLY-027' : 'CMP-009';
          returnHostSeatSetup(
            db,
            owner(),
            {
              commandId: nav.navigationRequestId,
              expectedRevision: s.revision,
              activeProof: b.proof,
              formId,
            },
            guard,
          );
          completed = true;
          const next = fresh();
          const view = await destination(c, next, nav.navigationRequestId, 'FORM_ACTION');
          if (view) assign(c, view);
          return true;
        }
        const target: HostLocalSeatTarget =
          key === 'APP-003::CTA::013'
            ? {
                kind: 'CANDIDATE',
                origin: prep.origin,
                profile: prep.selectedProfileOrNull ?? denied(),
                networkScopeIdOrNull: null,
                requestOrNull: null,
              }
            : { kind: 'GM', origin: prep.origin, destinationFormId: 'CMP-009' };
        if (
          target.kind === 'CANDIDATE' &&
          readHostLocalProfileScope(
            db,
            owner(),
            target.profile.targetLocalOwnerId,
            target.origin.campaignId,
          ) !== null
        )
          return denied();
        begin(c, s, target, nav.navigationRequestId);
        return true;
      }
      if (nav && key === 'PLY-030::CTA::008') {
        const p = s.pending ?? denied();
        currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId);
        if (b.addressed !== p.handoffId) return denied();
        cancelHostLocalCandidateCurtain(
          db,
          owner(),
          {
            commandId: nav.navigationRequestId,
            expectedRevision: s.revision,
            handoffId: p.handoffId,
            signedReturnContext: p.signedReturnContext,
          },
          () => {
            if (!c.trusted() || b.addressed !== p.handoffId) denied();
            safe(p.target.origin);
          },
        );
        completed = true;
        const next = fresh();
        revoke();
        broadcast(next, c, nav.navigationRequestId);
        assign(c, neutral(c, next, nav.navigationRequestId, 'FORM_ACTION'));
        return true;
      }
      if (!b.proof || !s.active || b.proof !== s.activeProof) return denied();
      const active = s.active;
      if (!b.last && isTerminalSource(active)) return denied();
      if (b.last?.terminalResultReadOnly && key !== 'NET-007::CTA::005') {
        if (!nav || (key !== 'NET-007::CTA::001' && key !== 'NET-027::CTA::002')) return denied();
        const archived =
          currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId) ??
          denied();
        const view = d.network.hostTerminalSnapshot(
          c.network,
          archived,
          key === 'NET-007::CTA::001' ? 'NET-027' : 'NET-007',
          nav.navigationRequestId,
          'FORM_ACTION',
        );
        assign(c, decorate(c, view, true) ?? denied());
        return true;
      }
      if (
        active.kind === 'CANDIDATE' &&
        (key === 'CHR-040::CTA::002' || key === 'NET-007::CTA::003' || key === 'NET-011::CTA::005')
      )
        return denied();
      if (nav && key === 'PLY-027::CTA::001' && active.kind === 'GM') {
        currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId);
        assign(c, activeManage(c, s, nav.navigationRequestId, 'FORM_ACTION'));
        return true;
      }
      if (active.kind === 'CANDIDATE') {
        if (control?.operation === 'SELECT_FINALS' || nav?.actionKey === 'APP-003::CTA::001') {
          const to = control?.operation === 'SELECT_FINALS' ? 'APP-003' : 'APP-004';
          const id = control?.requestId ?? nav!.navigationRequestId;
          const selected =
            control?.operation === 'SELECT_FINALS'
              ? control.selectedSourceUuids
              : (s.candidateSelectionOrNull?.selectedSourceUuids ?? []);
          if (control)
            currentNav(c, control.expectedProjectionRevision, 'APP-004::CTA::002', 'APP-004');
          else currentNav(c, nav!.expectedProjectionRevision, nav!.actionKey, nav!.sourceFormId);
          selectHostLocalFinals(
            db,
            owner(),
            {
              commandId: id,
              expectedRevision: s.revision,
              activeProof: b.proof,
              selectedSourceUuids: selected,
              formId: to,
            },
            guard,
          );
          completed = true;
          const next = fresh();
          if (to === 'APP-003') assign(c, admission(next, id, 'FORM_ACTION'));
          else
            assign(
              c,
              decorate(
                c,
                await c.openOwnedLibrary(active.profile.targetLocalOwnerId, id, 'FORM_ACTION'),
              ) ?? denied(),
            );
          return true;
        }
        if (nav && key === 'APP-003::CTA::009') {
          currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId);
          const selected = s.candidateSelectionOrNull?.selectedSourceUuids ?? [];
          if (active.networkScopeIdOrNull !== null) {
            selectHostLocalFinals(
              db,
              owner(),
              {
                commandId: 'host-local-network:' + nav.navigationRequestId,
                expectedRevision: s.revision,
                activeProof: b.proof,
                selectedSourceUuids: selected,
                formId: 'NET-003',
              },
              guard,
            );
            fresh();
          }
          const snap = await d.network.enterHostCandidate(
            c.network,
            active.origin,
            b.proof,
            selected,
            nav,
            d.heldNetworkConfiguration(active.origin.campaignId) ?? denied(),
            guard,
          );
          fresh();
          assign(c, decorate(c, snap) ?? denied());
          return true;
        }
        if (nav && key === 'NET-003::CTA::004') {
          currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId);
          const app = d.network.hostScopeIdle({
            ownerDeviceId: owner(),
            networkScopeId: active.networkScopeIdOrNull ?? denied(),
          });
          if (app.requestOrNull && !app.requestOrNull.closureOrNull) return denied();
          selectHostLocalFinals(
            db,
            owner(),
            {
              commandId: nav.navigationRequestId,
              expectedRevision: s.revision,
              activeProof: b.proof,
              selectedSourceUuids: app.selectedCandidates.map((r) => r.sourceUuid),
              formId: 'APP-003',
            },
            guard,
          );
          completed = true;
          d.network.disconnect(c.network);
          c.network.networkScopeId = null;
          c.network.contextId = null;
          assign(c, admission(fresh(), nav.navigationRequestId, 'FORM_ACTION'));
          return true;
        }
        if (
          nav &&
          (key === 'APP-003::CTA::014' ||
            key === 'NET-005::CTA::004' ||
            key === 'NET-003::CTA::005' ||
            key === 'NET-007::CTA::005')
        ) {
          currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId);
          begin(
            c,
            s,
            {
              kind: 'GM',
              origin: active.origin,
              destinationFormId: key === 'APP-003::CTA::014' ? 'CMP-009' : 'NET-017',
            },
            nav.navigationRequestId,
            'FORM_ACTION',
            undefined,
            key === 'NET-003::CTA::005' || key === 'NET-007::CTA::005' ? nav : undefined,
          );
          return true;
        }
        if (
          command?.workflowCommandId === 'UI-CMD-DEVICE-REQUEST-SUBMIT' &&
          active.networkScopeIdOrNull
        ) {
          const responses: LocalNetworkHostMessage[] = [];
          await d.network.submitHostCandidate(
            c.network,
            command as Extract<
              NetworkWorkflowRequest,
              { workflowCommandId: 'UI-CMD-DEVICE-REQUEST-SUBMIT' }
            >,
            (m) => responses.push(m),
          );
          guard();
          const positive = responses.find(
            (x) => x.messageType === 'command.result' || x.messageType === 'command.replay',
          );
          if (positive) {
            completed = true;
            c.send(positive);
            begin(
              c,
              s,
              { kind: 'GM', origin: active.origin, destinationFormId: 'NET-017' },
              command.commandId,
              'COMMAND_DESTINATION',
            );
          } else
            for (const frame of responses) {
              if (frame.messageType === 'projection.snapshot' && frame.protocolVersion === 2) {
                const decorated = decorate(c, frame);
                if (decorated) assign(c, decorated);
              } else c.send(frame);
            }
          return true;
        }
      }
      if (control?.operation === 'SELECT_APPLICANT') {
        currentNav(c, control.expectedProjectionRevision, 'NET-017::CTA::011', 'NET-017');
        if (active.kind !== 'GM' || !b.last?.applicantIds.includes(control.selectedRequestId))
          return denied();
        begin(
          c,
          s,
          applicant(s, active.origin, control.selectedRequestId) ?? denied(),
          control.requestId,
        );
        return true;
      }
      if (
        nav &&
        (key === 'GM-001::CTA::012' || key === 'PLY-001::CTA::015' || key === 'PLY-028::CTA::001')
      ) {
        currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId);
        safe(active.origin);
        if (key !== 'PLY-028::CTA::001')
          b.nativeOrigin = { formId: nav.sourceFormId, revision: nav.expectedProjectionRevision };
        assign(
          c,
          hostSeatSnapshot(
            { hostSeatView: 'SWITCH', revision: s.revision },
            nav.navigationRequestId,
            'FORM_ACTION',
            ['PLY-027::CTA::004'],
          ),
        );
        return true;
      }
      if (nav && key === 'PLY-027::CTA::004') {
        currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId);
        safe(active.origin);
        const seats = roster(s, active.origin),
          current = active.kind === 'PLAYER' ? active.localControllerSeatId : null;
        const keys: ActionKey[] = ['PLY-028::CTA::001'];
        if (current) keys.push('PLY-028::CTA::002');
        if (seats.some((x) => x.localControllerSeatId !== current)) keys.push('PLY-028::CTA::003');
        assign(
          c,
          hostSeatSnapshot(
            { hostSeatView: 'ROSTER', revision: s.revision, seats, activeSeatIdOrNull: current },
            nav.navigationRequestId,
            'FORM_ACTION',
            keys,
          ),
        );
        return true;
      }
      if (nav && (key === 'NET-006::CTA::005' || key === 'PLY-028::CTA::002')) {
        currentNav(c, nav.expectedProjectionRevision, nav.actionKey, nav.sourceFormId);
        if (active.kind !== 'PLAYER') return denied();
        begin(
          c,
          s,
          {
            kind: 'GM',
            origin: active.origin,
            destinationFormId: d.readScene(active.origin) ? 'GM-001' : 'NET-016',
          },
          nav.navigationRequestId,
        );
        return true;
      }
      if (control?.operation === 'SELECT_SEAT') {
        const pre = b.last?.formId === 'NET-016';
        currentNav(
          c,
          control.expectedProjectionRevision,
          pre ? 'NET-016::CTA::006' : 'PLY-028::CTA::003',
        );
        if (
          active.kind === 'CANDIDATE' ||
          (active.kind === 'PLAYER' && active.localControllerSeatId === control.targetSeatId)
        )
          return denied();
        const t = player(s, active.origin, control.targetSeatId);
        if (pre && d.readScene(active.origin) !== null) return denied();
        begin(c, s, t, control.requestId);
        return true;
      }
      if (
        control ||
        m.messageType === 'ordinary.seat.control' ||
        m.messageType === 'projection.reconnect'
      )
        return denied();
      if (b.last?.forms.some((f) => f.id === 'PLY-028' || f.id === 'PLY-027')) return denied();
      return false;
    } catch (error) {
      if (completed || error instanceof HostSeatPublicationError) throw error;
      const revisions = hostSeatVector(state?.revision ?? 0);
      if (command)
        c.send({
          messageType: 'command.refusal',
          protocolVersion: 1,
          commandId: command.commandId,
          lastLifecycleState: null,
          revisions,
          refusal: { code: 'GUARD_REJECTED' },
        });
      else if (nav || control)
        c.send({
          messageType: 'navigation.form-action.refusal',
          protocolVersion: 2,
          navigationRequestId: nav?.navigationRequestId ?? control!.requestId,
          revisions,
          presentationUnchanged: true,
          refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        });
      else
        c.send({
          messageType: 'protocol.refusal',
          protocolVersion: 1,
          relatedCommandId: null,
          refusal: { code: 'UNRECOGNIZED', path: '$.hostSeatContext', value: null },
        });
      return true;
    }
  }
  let frames = Promise.resolve();
  return {
    enabled: () => enabled,
    managesGmOrigin: (scope: GmRequestReviewScope) =>
      state?.active?.kind === 'GM' &&
      state.active.origin.campaignId === scope.campaignId &&
      state.active.origin.gmContextId === scope.gmLocalContextId &&
      owner() === scope.ownerDeviceId,
    authority,
    deliveryEpoch: () => epoch,
    decorate,
    forget: (c: HostSeatClient) => {
      sockets.delete(c);
    },
    mayReadGmArt: (gmContextId: string, key: string) =>
      !!state?.activeProof &&
      digest(key) === state.activeProof &&
      state.active?.kind === 'GM' &&
      state.active.origin.gmContextId === gmContextId,
    handle(c: HostSeatClient, m: LocalNetworkClientMessage) {
      const result = frames.then(() => process(c, m));
      frames = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
