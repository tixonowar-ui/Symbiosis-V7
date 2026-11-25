import { randomUUID } from 'node:crypto';
import {
  readLocalAdmissionTerminal,
  returnHostLocalTerminalAdmission,
} from './local-campaign-admission.js';
import type Database from 'better-sqlite3';
import { loadDeviceId } from './device-identity.js';
import {
  networkApplicationStorage as s,
  type NetworkStoreGuard,
} from './network-local-application.js';
import {
  localAdmissionTabStorage,
  readOwnedLocalNetworkTabAnchor,
  readLocalNetworkTabCloseByCommandId,
  type LocalNetworkTabEntryInput,
  type LocalNetworkTabEntryGuard,
} from './network-local-tab.js';
import { readLocalCharacterOwner, readPostSaveHeadById } from './local-character-post-save.js';
import { isRecordingHostLocalBirth } from './store.js';
import {
  ordinaryHandoffPresentAtStartup,
  seatHandoffJournalPresent,
} from './local-seat-handoff.js';
import { readHostLocalRoster } from './local-seat-roster.js';
import { FORM_IDS, type FormId } from '@generated/types/atlas.js';
import { appendSeatEvent, readSeatEvents, type SeatEventReceipt } from './seat-event-journal.js';

export interface HostSeatOrigin {
  readonly gmContextId: string;
  readonly campaignId: string;
  readonly returnFormId: string;
  readonly gmDeliveryProof: string;
}
export interface HostSeatProfile {
  readonly targetLocalOwnerId: string;
  readonly targetProfileLabel: string;
}
export interface HostSeatRequest {
  readonly technicalSessionId: string;
  readonly requestId: string;
  readonly requestRevision: number;
  readonly submitReceiptId: string;
  readonly proposalOrNull: {
    readonly admissionBatchId: string;
    readonly proposalRevision: number;
    readonly proposalChecksum: string;
  } | null;
}
export type HostLocalSeatTarget =
  | { readonly kind: 'GM'; readonly origin: HostSeatOrigin; readonly destinationFormId: string }
  | {
      readonly kind: 'CANDIDATE';
      readonly origin: HostSeatOrigin;
      readonly profile: HostSeatProfile;
      readonly networkScopeIdOrNull: string | null;
      readonly requestOrNull: HostSeatRequest | null;
    }
  | {
      readonly kind: 'PLAYER';
      readonly origin: HostSeatOrigin;
      readonly profile: HostSeatProfile;
      readonly networkScopeId: string;
      readonly localControllerSeatId: string;
      readonly admissionReceiptId: string;
      readonly destinationFormId: 'NET-006' | 'PLY-001';
      readonly sceneIdOrNull: string | null;
    };
export interface HostLocalSeatPending {
  readonly handoffId: string;
  readonly signedReturnContext: string;
  readonly target: HostLocalSeatTarget;
  readonly source: HostLocalSeatTarget;
}
export interface HostLocalSeatHandoff {
  readonly revision: number;
  readonly active: HostLocalSeatTarget | null;
  readonly activeProof: string | null;
  readonly activeReceiptIdOrNull: string | null;
  readonly activeHandoffIdOrNull: string | null;
  readonly gmDestinationConfirmed: boolean;
  readonly setupReturnReceiptIdOrNull: string | null;
  readonly candidateContextIdOrNull: string | null;
  readonly candidateAckReceiptIdOrNull: string | null;
  readonly setupOrNull: {
    readonly origin: HostSeatOrigin;
    readonly setupProof: string;
    readonly selectedProfileOrNull: HostSeatProfile | null;
  } | null;
  readonly candidateSelectionOrNull: {
    readonly selectedSourceUuids: readonly string[];
    readonly formId: 'APP-003' | 'APP-004' | 'NET-003';
    readonly networkEntry?: {
      readonly navigationRequestId: string;
      readonly expectedProjectionRevision: number;
    };
  } | null;
  readonly pending: HostLocalSeatPending | null;
  readonly profiles: readonly HostSeatProfile[];
}
type Guard = NetworkStoreGuard<HostLocalSeatHandoff>;
type Db = Database.Database;
type Mutator = {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly activeProof: string | null;
};
type Setup = Mutator & { readonly origin: HostSeatOrigin; readonly setupProof: string };
type Create = Mutator & { readonly origin: HostSeatOrigin; readonly profile: HostSeatProfile };
type Begin = Mutator & {
  readonly target: HostLocalSeatTarget;
  readonly retireReturnFrom?: 'NET-003' | 'NET-007';
  readonly retireNavigation?: {
    readonly navigationRequestId: string;
    readonly expectedProjectionRevision: number;
  };
};
type Ack = {
  readonly role: 'gm' | 'player';
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly handoffId: string;
  readonly signedReturnContext: string;
  readonly decision: 'ACTIVATE_TARGET' | 'RETURN_INITIATOR';
  readonly recipientProof: string;
};
type Attach = Mutator & { readonly networkScopeId: string; readonly candidateAckReceiptId: string };
type Birth = Mutator & {
  readonly localCharacterId: string;
  readonly checkpointId: string;
  readonly candidateAckReceiptId: string;
};
type Promote = Mutator & { readonly target: Extract<HostLocalSeatTarget, { kind: 'PLAYER' }> };
type Selection = Mutator & {
  readonly selectedSourceUuids: readonly string[];
  readonly formId: 'APP-003' | 'APP-004' | 'NET-003';
};
type CharacterCursor = {
  readonly localCharacterId: string;
  readonly formId: FormId;
  readonly postSaveScopeId?: string;
};
type Cursor = Mutator & {
  readonly localCharacterId: string | null;
  readonly formId: string;
  readonly postSaveScopeId?: string;
};
type GmDestination = Mutator &
  ({ readonly ackReceiptId: string } | { readonly setupReturnReceiptId: string });
type ReturnSetup = Mutator & { readonly formId: 'CMP-009' | 'PLY-027' };
type CancelCurtain = Pick<
  Ack,
  'commandId' | 'expectedRevision' | 'handoffId' | 'signedReturnContext'
>;
type Command =
  | (Setup & { operation: 'SETUP' })
  | (Create & { operation: 'PROFILE' })
  | (Begin & { operation: 'BEGIN' })
  | (Ack & { operation: 'ACK' })
  | (Attach & { operation: 'SCOPE' })
  | (Birth & { operation: 'BIRTH' })
  | (Promote & { operation: 'PROMOTE' })
  | (GmDestination & { operation: 'GM_DESTINATION' })
  | (Selection & { operation: 'SELECTION' })
  | (Cursor & { operation: 'CURSOR' })
  | (ReturnSetup & { operation: 'RETURN_SETUP' })
  | (CancelCurtain & { operation: 'CANCEL_CURTAIN' })
  | (Mutator & { operation: 'SELECT_PROFILE'; targetLocalOwnerId: string });
interface HostBody {
  ownerDeviceId: string;
  previousSha256: string | null;
  hostLocal: 1;
  command: Command;
  receipt: SeatEventReceipt;
}
interface Scope {
  released?: true;
  terminal?: Extract<HostLocalSeatTarget, { kind: 'CANDIDATE' }>;
  networkScopeId: string;
  candidateAckReceiptId: string;
  campaignId: string;
  ownerId: string;
}
interface History {
  state: HostLocalSeatHandoff;
  scopes: Scope[];
  returnedProfiles: Map<string, HostSeatOrigin>;
  characters: Map<string, string>;
  cursors: Map<string, CharacterCursor>;
  usedProofs: Set<string>;
  setupAuthority: { receipt: string | null; handoff: string | null } | null;
  found: HostBody | null;
  digest: string | null;
}
function empty(): HostLocalSeatHandoff {
  return {
    revision: 0,
    active: null,
    activeProof: null,
    gmDestinationConfirmed: false,
    setupReturnReceiptIdOrNull: null,
    activeReceiptIdOrNull: null,
    activeHandoffIdOrNull: null,
    candidateContextIdOrNull: null,
    candidateAckReceiptIdOrNull: null,
    setupOrNull: null,
    candidateSelectionOrNull: null,
    pending: null,
    profiles: [],
  };
}
function checkOrigin(origin: HostSeatOrigin) {
  s.object(origin, ['gmContextId', 'campaignId', 'returnFormId', 'gmDeliveryProof']);
  s.uuid(origin.gmContextId);
  s.uuid(origin.campaignId);
  s.text(origin.returnFormId);
  s.hash(origin.gmDeliveryProof);
}
function checkProfile(profile: HostSeatProfile) {
  s.object(profile, ['targetLocalOwnerId', 'targetProfileLabel']);
  s.uuid(profile.targetLocalOwnerId);
  s.text(profile.targetProfileLabel);
  if (!profile.targetProfileLabel.trim()) return s.fail('INVALID_INPUT');
}
function checkTarget(target: HostLocalSeatTarget) {
  checkOrigin(target.origin);
  if (target.kind === 'GM') {
    s.object(target, ['kind', 'origin', 'destinationFormId']);
    s.text(target.destinationFormId);
    return;
  }
  checkProfile(target.profile);
  if (target.kind === 'PLAYER') {
    s.object(target, [
      'kind',
      'origin',
      'profile',
      'networkScopeId',
      'localControllerSeatId',
      'admissionReceiptId',
      'destinationFormId',
      'sceneIdOrNull',
    ]);
    s.uuid(target.networkScopeId);
    s.uuid(target.localControllerSeatId);
    s.text(target.admissionReceiptId);
    if (target.destinationFormId === 'PLY-001') s.uuid(target.sceneIdOrNull);
    else if (target.destinationFormId !== 'NET-006' || target.sceneIdOrNull !== null)
      return s.fail('INVALID_INPUT');
    return;
  }
  if (target.kind !== 'CANDIDATE') return s.fail('INVALID_INPUT');
  s.object(target, ['kind', 'origin', 'profile', 'networkScopeIdOrNull', 'requestOrNull']);
  if (target.networkScopeIdOrNull !== null) s.uuid(target.networkScopeIdOrNull);
  const request = target.requestOrNull;
  if (request !== null) {
    if (!target.networkScopeIdOrNull) return s.fail('INVALID_INPUT');
    s.object(request, [
      'technicalSessionId',
      'requestId',
      'requestRevision',
      'submitReceiptId',
      'proposalOrNull',
    ]);
    s.uuid(request.technicalSessionId);
    s.uuid(request.requestId);
    s.integer(request.requestRevision);
    s.text(request.submitReceiptId);
    const proposal = request.proposalOrNull;
    if (proposal !== null) {
      s.object(proposal, ['admissionBatchId', 'proposalRevision', 'proposalChecksum']);
      s.uuid(proposal.admissionBatchId);
      s.integer(proposal.proposalRevision);
      s.hash(proposal.proposalChecksum);
    }
  }
}
function verifiedProfile(state: HostLocalSeatHandoff, profile: HostSeatProfile) {
  if (!state.profiles.some((p) => s.same(p, profile))) return s.fail('FOREIGN_OWNER');
}
function networkEntry(c: Attach | Selection, prefix: string) {
  return c.commandId.startsWith(prefix)
    ? {
        networkEntry: {
          navigationRequestId: s.text(c.commandId.slice(prefix.length)),
          expectedProjectionRevision: c.expectedRevision,
        },
      }
    : {};
}
function releasedCandidateScope(h: History, c: Command) {
  const active = h.state.active;
  if (
    c.operation === 'BEGIN' &&
    (c.retireReturnFrom !== undefined || c.retireNavigation !== undefined)
  ) {
    if (
      (c.retireReturnFrom !== 'NET-003' && c.retireReturnFrom !== 'NET-007') ||
      !c.retireNavigation ||
      c.commandId !== 'host-seat-begin:' + s.text(c.retireNavigation.navigationRequestId) ||
      !Number.isSafeInteger(c.retireNavigation.expectedProjectionRevision) ||
      c.retireNavigation.expectedProjectionRevision < 0 ||
      c.target.kind !== 'GM' ||
      c.target.destinationFormId !== 'NET-017' ||
      active?.kind !== 'CANDIDATE' ||
      !active.requestOrNull ||
      !active.networkScopeIdOrNull ||
      !s.same(active.origin, c.target.origin)
    )
      return s.fail('FOREIGN_OWNER');
    const archived = h.scopes.find(
      (q) => q.networkScopeId === active.networkScopeIdOrNull,
    )?.terminal;
    if (archived) {
      if (c.retireReturnFrom !== 'NET-007' || !s.same(archived, active))
        return s.fail('FOREIGN_OWNER');
      return null;
    }
    return active.networkScopeIdOrNull;
  }
  if (
    c.operation !== 'BEGIN' ||
    c.target.kind !== 'GM' ||
    c.target.destinationFormId !== 'CMP-009' ||
    active?.kind !== 'CANDIDATE'
  )
    return null;
  if (
    active.requestOrNull ||
    c.target.origin.returnFormId !== 'CMP-009' ||
    !s.same(active.origin, c.target.origin)
  )
    return s.fail('FOREIGN_OWNER');
  return active.networkScopeIdOrNull;
}
function closeIds(receiptId: string, source?: Begin['retireReturnFrom']) {
  const prefix =
    source === 'NET-003'
      ? 'host-local-cancelled-'
      : source === 'NET-007'
        ? 'host-local-terminal-'
        : 'host-local-pre-submit-';
  return {
    closeCommandId: prefix + 'close:' + receiptId,
    closeReceiptId: prefix + 'closed:' + receiptId,
  };
}
function acknowledgedEventsHash(
  db: Db,
  device: string,
  scope: string,
  submitEvent: string,
  cancelEvent: string,
) {
  const hashes = [submitEvent, cancelEvent].map((id) => {
    const row = s.at(db, 'local_network_application_event', 'event_id', id);
    if (!row || row['owner_device_id'] !== device || row['network_scope_id'] !== scope)
      return s.fail();
    s.checked(row);
    return s.hash(row['record_sha256']);
  });
  return s.sha(s.canonical(hashes));
}
function transition(h: History, c: Command, r: SeatEventReceipt, signature: string) {
  const st = h.state;
  if (c.expectedRevision !== st.revision || r.revision !== st.revision + 1)
    return s.fail('STALE_REVISION');
  if (
    c.operation !== 'ACK' &&
    c.operation !== 'CANCEL_CURTAIN' &&
    (st.pending !== null || st.activeProof !== c.activeProof)
  )
    return s.fail('FOREIGN_OWNER');
  let next: HostLocalSeatHandoff = { ...st, revision: r.revision };
  switch (c.operation) {
    case 'SETUP':
      checkOrigin(c.origin);
      s.hash(c.setupProof);
      if (h.usedProofs.has(c.setupProof)) return s.fail('FOREIGN_OWNER');
      h.usedProofs.add(c.setupProof);
      if (
        st.setupOrNull ||
        (st.active && (st.active.kind !== 'GM' || !s.same(st.active.origin, c.origin)))
      )
        return s.fail('FOREIGN_OWNER');
      h.setupAuthority = { receipt: st.activeReceiptIdOrNull, handoff: st.activeHandoffIdOrNull };
      next = {
        ...next,
        setupOrNull: { origin: c.origin, setupProof: c.setupProof, selectedProfileOrNull: null },
        active: null,
        activeProof: c.setupProof,
        activeReceiptIdOrNull: null,
        activeHandoffIdOrNull: null,
        candidateAckReceiptIdOrNull: null,
        candidateSelectionOrNull: null,
      };
      break;
    case 'GM_DESTINATION': {
      if (st.gmDestinationConfirmed || st.active?.kind !== 'GM' || !st.activeProof)
        return s.fail('FOREIGN_OWNER');
      const issued = 'ackReceiptId' in c;
      s.object(c, [
        'operation',
        'commandId',
        'expectedRevision',
        'activeProof',
        issued ? 'ackReceiptId' : 'setupReturnReceiptId',
      ]);
      if (issued) {
        if (
          !st.activeHandoffIdOrNull ||
          !st.activeReceiptIdOrNull ||
          st.activeReceiptIdOrNull !== c.ackReceiptId ||
          c.commandId !== 'host-local-shown:' + c.ackReceiptId
        )
          return s.fail('FOREIGN_OWNER');
      } else if (
        !st.setupReturnReceiptIdOrNull ||
        c.setupReturnReceiptId !== st.setupReturnReceiptIdOrNull ||
        c.commandId !== 'host-local-setup-shown:' + c.setupReturnReceiptId
      )
        return s.fail('FOREIGN_OWNER');
      next = { ...next, gmDestinationConfirmed: true };
      break;
    }
    case 'PROFILE':
      checkProfile(c.profile);
      if (
        !st.setupOrNull ||
        !s.same(st.setupOrNull.origin, c.origin) ||
        st.profiles.some((p) => p.targetLocalOwnerId === c.profile.targetLocalOwnerId)
      )
        return s.fail('FOREIGN_OWNER');
      next = {
        ...next,
        profiles: [...st.profiles, c.profile],
        setupOrNull: { ...st.setupOrNull, selectedProfileOrNull: c.profile },
      };
      break;
    case 'RETURN_SETUP': {
      const setup = st.setupOrNull;
      if (
        !setup ||
        !c.activeProof ||
        !h.setupAuthority ||
        !['CMP-009', 'PLY-027'].includes(c.formId)
      )
        return s.fail('FOREIGN_OWNER');
      next = {
        ...next,
        setupOrNull: null,
        active: { kind: 'GM', origin: setup.origin, destinationFormId: c.formId },
        activeReceiptIdOrNull: h.setupAuthority.receipt,
        activeHandoffIdOrNull: h.setupAuthority.handoff,
        setupReturnReceiptIdOrNull: r.receiptId,
      };
      h.setupAuthority = null;
      break;
    }
    case 'SELECT_PROFILE': {
      const profile = st.profiles.find((p) => p.targetLocalOwnerId === c.targetLocalOwnerId);
      if (!st.setupOrNull || !profile) return s.fail('FOREIGN_OWNER');
      next = { ...next, setupOrNull: { ...st.setupOrNull, selectedProfileOrNull: profile } };
      break;
    }
    case 'BEGIN': {
      checkTarget(c.target);
      const origin = st.setupOrNull?.origin ?? st.active?.origin;
      if (!origin || !s.same(origin, c.target.origin)) return s.fail('FOREIGN_OWNER');
      const released = releasedCandidateScope(h, c);
      if (released !== null) {
        const binding = h.scopes.find((scope) => scope.networkScopeId === released);
        if (
          st.candidateSelectionOrNull?.formId !== (c.retireReturnFrom ? 'NET-003' : 'APP-003') ||
          st.active?.kind !== 'CANDIDATE' ||
          !binding ||
          binding.released ||
          binding.ownerId !== st.active.profile.targetLocalOwnerId ||
          binding.candidateAckReceiptId !== st.candidateAckReceiptIdOrNull
        )
          return s.fail('FOREIGN_OWNER');
        binding.released = true;
        if (c.retireReturnFrom === 'NET-007') binding.terminal = st.active;
      }
      const source: HostLocalSeatTarget = st.active ?? {
        kind: 'GM',
        origin,
        destinationFormId: origin.returnFormId,
      };
      if (c.target.kind !== 'GM') {
        verifiedProfile(st, c.target.profile);
        if (
          st.setupOrNull?.selectedProfileOrNull &&
          !s.same(st.setupOrNull.selectedProfileOrNull, c.target.profile)
        )
          return s.fail('FOREIGN_OWNER');
        if (
          !st.setupOrNull &&
          source.kind !== 'GM' &&
          !(
            source.kind === 'PLAYER' &&
            c.target.kind === 'PLAYER' &&
            st.activeReceiptIdOrNull &&
            st.activeHandoffIdOrNull &&
            source.localControllerSeatId !== c.target.localControllerSeatId
          )
        )
          return s.fail('FOREIGN_OWNER');
        if (st.setupOrNull && c.target.kind !== 'CANDIDATE') return s.fail('FOREIGN_OWNER');
        if (c.target.kind === 'CANDIDATE') {
          const scope = c.target.networkScopeIdOrNull;
          const linked = h.scopes.find((q) => q.networkScopeId === scope);
          const ownerId = c.target.profile.targetLocalOwnerId;
          const usedScope = h.scopes.some(
            (q) => !q.released && q.ownerId === ownerId && q.campaignId === origin.campaignId,
          );
          const returned = h.returnedProfiles.get(ownerId + '/' + origin.campaignId);
          const canResume =
            source.kind === 'GM' && !!returned && s.same(origin, returned) && !usedScope;
          if (
            (st.setupOrNull &&
              (scope !== null ||
                c.target.requestOrNull !== null ||
                usedScope ||
                Array.from(h.characters.values()).includes(ownerId))) ||
            (!st.setupOrNull &&
              (!scope || !c.target.requestOrNull) &&
              !(scope === null && c.target.requestOrNull === null && canResume)) ||
            (scope !== null &&
              (!linked ||
                (linked.released && !s.same(linked.terminal ?? null, c.target)) ||
                linked.ownerId !== c.target.profile.targetLocalOwnerId ||
                linked.campaignId !== origin.campaignId))
          )
            return s.fail('FOREIGN_OWNER');
        }
      } else if (!st.setupOrNull && source.kind === 'GM') return s.fail('FOREIGN_OWNER');
      h.setupAuthority = null;
      next = {
        ...next,
        setupOrNull: null,
        active: null,
        activeProof: null,
        activeReceiptIdOrNull: null,
        activeHandoffIdOrNull: null,
        candidateAckReceiptIdOrNull: null,
        candidateSelectionOrNull: null,
        pending: {
          handoffId: r.handoffId,
          signedReturnContext: signature,
          source,
          target: c.target,
        },
      };
      break;
    }
    case 'CANCEL_CURTAIN': {
      const p = st.pending;
      if (
        !p ||
        p.handoffId !== c.handoffId ||
        p.signedReturnContext !== c.signedReturnContext ||
        p.source.kind !== 'GM' ||
        p.source.origin.returnFormId !== 'CMP-009' ||
        p.target.kind !== 'CANDIDATE' ||
        p.target.requestOrNull !== null ||
        p.target.networkScopeIdOrNull !== null ||
        !s.same(p.source.origin, p.target.origin)
      )
        return s.fail('FOREIGN_OWNER');
      next = {
        ...next,
        pending: {
          handoffId: r.handoffId,
          signedReturnContext: signature,
          source: p.source,
          target: {
            kind: 'GM',
            origin: p.source.origin,
            destinationFormId: p.source.origin.returnFormId,
          },
        },
      };
      break;
    }
    case 'ACK': {
      const pending = st.pending;
      if (
        !pending ||
        pending.handoffId !== c.handoffId ||
        pending.signedReturnContext !== c.signedReturnContext ||
        r.handoffId !== c.handoffId
      )
        return s.fail('FOREIGN_OWNER');
      s.hash(c.recipientProof);
      if (c.decision !== 'ACTIVATE_TARGET' && c.decision !== 'RETURN_INITIATOR')
        return s.fail('INVALID_INPUT');
      const active = pending.target;
      if (c.role !== (active.kind === 'GM' ? 'gm' : 'player') || h.usedProofs.has(c.recipientProof))
        return s.fail('FOREIGN_OWNER');
      h.usedProofs.add(c.recipientProof);
      const gmReturn =
        active.kind === 'GM' &&
        active.destinationFormId === 'CMP-009' &&
        active.origin.returnFormId === 'CMP-009';
      if ((c.decision === 'RETURN_INITIATOR') !== gmReturn) return s.fail('FOREIGN_OWNER');
      if (gmReturn && pending.source.kind === 'CANDIDATE' && !pending.source.requestOrNull)
        h.returnedProfiles.set(
          pending.source.profile.targetLocalOwnerId + '/' + active.origin.campaignId,
          active.origin,
        );
      if (active.kind === 'CANDIDATE')
        h.returnedProfiles.delete(
          active.profile.targetLocalOwnerId + '/' + active.origin.campaignId,
        );
      const linked =
        active.kind === 'CANDIDATE'
          ? h.scopes.find((q) => q.networkScopeId === active.networkScopeIdOrNull)
          : undefined;
      const candidateAck =
        active.kind === 'CANDIDATE' ? (linked?.candidateAckReceiptId ?? r.receiptId) : null;
      const selection =
        active.kind === 'CANDIDATE'
          ? {
              formId:
                active.networkScopeIdOrNull === null ? ('APP-004' as const) : ('NET-003' as const),
              selectedSourceUuids: [],
            }
          : null;
      if (active.kind === 'CANDIDATE') h.cursors.delete(active.profile.targetLocalOwnerId);
      next = {
        ...next,
        pending: null,
        active,
        activeProof: c.recipientProof,
        activeReceiptIdOrNull: r.receiptId,
        activeHandoffIdOrNull: c.handoffId,
        candidateAckReceiptIdOrNull: candidateAck,
        candidateSelectionOrNull: selection,
      };
      break;
    }
    case 'BIRTH':
    case 'SCOPE': {
      if (
        st.active?.kind !== 'CANDIDATE' ||
        !c.activeProof ||
        st.candidateAckReceiptIdOrNull !== c.candidateAckReceiptId
      )
        return s.fail('FOREIGN_OWNER');
      const ownerId = st.active.profile.targetLocalOwnerId;
      if (c.operation === 'BIRTH') {
        s.uuid(c.localCharacterId);
        s.text(c.checkpointId);
        if (h.characters.has(c.localCharacterId)) return s.fail('FOREIGN_OWNER');
        h.characters.set(c.localCharacterId, ownerId);
        h.cursors.set(ownerId, { localCharacterId: c.localCharacterId, formId: 'CHR-010' });
      } else {
        s.uuid(c.networkScopeId);
        if (
          h.scopes.some(
            (q) =>
              q.networkScopeId === c.networkScopeId ||
              q.candidateAckReceiptId === c.candidateAckReceiptId,
          )
        )
          return s.fail('FOREIGN_OWNER');
        h.scopes.push({
          networkScopeId: c.networkScopeId,
          candidateAckReceiptId: c.candidateAckReceiptId,
          ownerId,
          campaignId: st.active.origin.campaignId,
        });
        next = {
          ...next,
          candidateSelectionOrNull: {
            formId: 'NET-003',
            selectedSourceUuids: st.candidateSelectionOrNull?.selectedSourceUuids ?? [],
            ...networkEntry(c, 'host-local-scope:'),
          },
          active: { ...st.active, networkScopeIdOrNull: c.networkScopeId },
        };
      }
      break;
    }
    case 'PROMOTE':
      checkTarget(c.target);
      if (
        st.active?.kind !== 'CANDIDATE' ||
        !c.activeProof ||
        !s.same(st.active.profile, c.target.profile) ||
        !s.same(st.active.origin, c.target.origin) ||
        !st.active.networkScopeIdOrNull
      )
        return s.fail('FOREIGN_OWNER');
      next = {
        ...next,
        active: c.target,
        candidateAckReceiptIdOrNull: null,
        candidateSelectionOrNull: null,
      };
      break;
    case 'CURSOR': {
      if (st.active?.kind !== 'CANDIDATE' || !c.activeProof) return s.fail('FOREIGN_OWNER');
      const owner = st.active.profile.targetLocalOwnerId;
      if (c.localCharacterId === null) {
        if (c.formId !== 'APP-004' || c.postSaveScopeId !== undefined)
          return s.fail('INVALID_INPUT');
        h.cursors.delete(owner);
      } else {
        const formId = FORM_IDS.find(
          (f) =>
            f === c.formId &&
            (f.startsWith('CHR-') ||
              (c.postSaveScopeId !== undefined && (f === 'APP-009' || f === 'APP-010'))),
        );
        if (!formId || h.characters.get(c.localCharacterId) !== owner)
          return s.fail('FOREIGN_OWNER');
        h.cursors.set(owner, {
          localCharacterId: c.localCharacterId,
          formId,
          ...(c.postSaveScopeId === undefined
            ? {}
            : { postSaveScopeId: s.text(c.postSaveScopeId) }),
        });
      }
      break;
    }
    case 'SELECTION': {
      const active = st.active;
      if (
        active?.kind !== 'CANDIDATE' ||
        !c.activeProof ||
        !Array.isArray(c.selectedSourceUuids) ||
        c.selectedSourceUuids.length > 3 ||
        new Set(c.selectedSourceUuids).size !== c.selectedSourceUuids.length ||
        !['APP-003', 'APP-004', 'NET-003'].includes(c.formId) ||
        (c.formId === 'NET-003' && !active.networkScopeIdOrNull) ||
        c.selectedSourceUuids.some(
          (id: unknown) =>
            typeof id !== 'string' || h.characters.get(id) !== active.profile.targetLocalOwnerId,
        )
      )
        return s.fail('FOREIGN_OWNER');
      h.cursors.delete(active.profile.targetLocalOwnerId);
      next = {
        ...next,
        candidateSelectionOrNull: {
          selectedSourceUuids: c.selectedSourceUuids,
          formId: c.formId,
          ...(c.formId === 'NET-003' ? networkEntry(c, 'host-local-network:') : {}),
        },
      };
      break;
    }
    default:
      return s.fail();
  }
  if (c.operation === 'ACK' || c.operation === 'SETUP' || c.operation === 'BEGIN')
    next = { ...next, gmDestinationConfirmed: false };
  if (c.operation !== 'RETURN_SETUP' && next.setupReturnReceiptIdOrNull !== null)
    next = { ...next, setupReturnReceiptIdOrNull: null };
  if (next.active?.kind !== 'CANDIDATE') {
    next = { ...next, candidateContextIdOrNull: null };
  } else if (c.operation === 'ACK' && next.active?.kind === 'CANDIDATE') {
    next = { ...next, candidateContextIdOrNull: s.uuid(r.candidateContextId) };
  }
  h.state = next;
}
function history(db: Db, device: string, commandId?: string): History {
  const h: History = {
    state: empty(),
    scopes: [],
    returnedProfiles: new Map(),
    characters: new Map(),
    cursors: new Map(),
    usedProofs: new Set(),
    found: null,
    digest: null,
    setupAuthority: null,
  };
  for (const event of readSeatEvents(db, device)) {
    if ('hostLocal' in event.body) {
      const body = event.body as HostBody;
      if (body.hostLocal !== 1) return s.fail();
      const released = releasedCandidateScope(h, body.command);
      const source = body.command.operation === 'BEGIN' ? body.command.retireReturnFrom : undefined;
      const cancelled = source === 'NET-003';
      const proof = body.receipt.cancelledRequest;
      if (
        cancelled !== (proof !== undefined) ||
        (source === 'NET-007' && released !== null) !==
          (body.receipt.terminalReturnSha256 !== undefined)
      )
        return s.fail();
      if (
        body.receipt.terminalReturnSha256 &&
        body.command.operation === 'BEGIN' &&
        body.command.retireNavigation
      ) {
        const e = s.at(
          db,
          'local_admission_event',
          'event_id',
          'navigation:' + body.command.retireNavigation.navigationRequestId,
        );
        if (
          !e ||
          h.state.active?.kind !== 'CANDIDATE' ||
          e['request_id'] !== h.state.active.requestOrNull?.requestId ||
          s.sha(s.canonical(s.checked(e))) !== body.receipt.terminalReturnSha256
        )
          return s.fail();
      }
      if (released !== null) {
        if (
          proof &&
          acknowledgedEventsHash(
            db,
            device,
            released,
            proof.submitAckEventId,
            proof.cancelAckEventId,
          ) !== proof.acknowledgedEventsSha256
        )
          return s.fail();
        const ids = closeIds(body.receipt.receiptId, source);
        const close = readLocalNetworkTabCloseByCommandId(db, device, ids.closeCommandId);
        if (
          !close ||
          close.receipt.networkScopeId !== released ||
          close.receipt.closeReceiptId !== ids.closeReceiptId
        )
          return s.fail();
        if (s.sha(s.canonical(close)) !== body.receipt.closedTabReceiptSha256) return s.fail();
      } else if (body.receipt.closedTabReceiptSha256 !== undefined) return s.fail();
      transition(h, body.command, body.receipt, event.signature);
      if (body.receipt.commandId === commandId) h.found = body;
    } else {
      if (event.body.receipt.commandId === commandId) return s.fail('IDEMPOTENCY_CONFLICT');
      if (event.body.receipt.kind === 'ACK')
        h.usedProofs.add(s.hash(s.object(event.body.command)['recipientProof']));
      h.state = { ...empty(), profiles: h.state.profiles, revision: event.body.receipt.revision };
      h.setupAuthority = null;
    }
    h.digest = event.digest;
  }
  return h;
}
export function readHostLocalSeatHandoff(db: Db, device: string): HostLocalSeatHandoff {
  return structuredClone(ownershipIndex(db, device)?.state ?? empty());
}
export function hostLocalSeatPresentAtStartup(db: Db): boolean {
  const probe = () => {
    if (!ordinaryHandoffPresentAtStartup(db)) return false;
    // Device reset keeps old journals and keys. Only the current installation
    // can authenticate its chain or supply an active delivery.
    const device = loadDeviceId(db);
    const state = readHostLocalSeatHandoff(db, device);
    return Boolean(state.active || state.setupOrNull || state.pending);
  };
  return s.safe(() => (db.inTransaction ? probe() : db.transaction(probe).deferred()));
}
type OwnershipIndex = Pick<
  History,
  'state' | 'scopes' | 'characters' | 'returnedProfiles' | 'cursors'
> & {
  terminalRead: { requestId: string; value: ReturnType<typeof readLocalAdmissionTerminal> } | null;
};
const ownershipIndexes = new WeakMap<
  Db,
  { device: string; changes: bigint; version: bigint; schema: bigint; index: OwnershipIndex | null }
>();
function withOwnershipIndex<T>(
  db: Db,
  device: string,
  select: (index: OwnershipIndex | null, cacheable: boolean) => T,
): T {
  const nested = db.inTransaction;
  const read = () => {
    // total_changes covers this connection (even on rollback); data_version covers other writers.
    // Only publish a cache entry from our own read transaction, never from a caller's tentative writes.
    const stamp = db
      .prepare<[], { changes: bigint; version: bigint; schema: bigint }>(
        'SELECT total_changes() AS changes, data_version AS version,schema_version AS schema FROM pragma_data_version,pragma_schema_version',
      )
      .safeIntegers()
      .get();
    if (!stamp) return s.fail();
    const known = ownershipIndexes.get(db);
    if (
      known?.device === device &&
      known.changes === stamp.changes &&
      known.version === stamp.version &&
      known.schema === stamp.schema
    )
      return select(known.index, !nested);
    const index = seatHandoffJournalPresent(db)
      ? s.read(db, device, () => {
          const { scopes, characters, returnedProfiles, state, cursors } = history(db, device);
          return { scopes, characters, returnedProfiles, state, cursors, terminalRead: null };
        })
      : null;
    const result = select(index, !nested);
    if (!nested) ownershipIndexes.set(db, { device, ...stamp, index });
    return result;
  };
  return nested ? read() : db.transaction(read).deferred();
}
function ownershipIndex(db: Db, device: string) {
  return withOwnershipIndex(db, device, (index) => index);
}
export function readHostLocalScopeOwner(db: Db, device: string, scope: string): string | null {
  return (
    ownershipIndex(db, device)?.scopes.find((q) => q.networkScopeId === scope)?.ownerId ?? null
  );
}
export function readHostLocalProfileScope(
  db: Db,
  device: string,
  ownerId: string,
  campaignId?: string,
) {
  const scope = ownershipIndex(db, device)?.scopes.findLast(
    (q) =>
      !q.released &&
      q.ownerId === ownerId &&
      (campaignId === undefined || q.campaignId === campaignId),
  );
  return scope ? { ...scope } : null;
}
export function readHostLocalTerminalApplicants(db: Db, device: string, campaignId: string) {
  return (ownershipIndex(db, device)?.scopes ?? []).flatMap((q) =>
    q.campaignId === campaignId && q.terminal?.requestOrNull
      ? [{ ownerId: q.ownerId, requestId: q.terminal.requestOrNull.requestId }]
      : [],
  );
}
function terminalTarget(
  index: OwnershipIndex | null,
  ownerId: string,
  campaignId: string,
  requestId: string,
) {
  return (
    index?.scopes.find(
      (q) =>
        q.ownerId === ownerId &&
        q.campaignId === campaignId &&
        q.terminal?.requestOrNull?.requestId === requestId,
    )?.terminal ?? null
  );
}
export function readHostLocalTerminalTarget(
  db: Db,
  device: string,
  ownerId: string,
  campaignId: string,
  requestId: string,
) {
  return structuredClone(
    terminalTarget(ownershipIndex(db, device), ownerId, campaignId, requestId),
  );
}
export function readHostLocalTerminalApplicant(
  db: Db,
  device: string,
  ownerId: string,
  campaignId: string,
  requestId: string,
) {
  return withOwnershipIndex(db, device, (index, cacheable) => {
    const target = terminalTarget(index, ownerId, campaignId, requestId);
    if (!index || !target?.networkScopeIdOrNull) return null;
    const cached = index.terminalRead;
    if (cached?.requestId === requestId) return structuredClone({ target, ...cached.value });
    const verified = readLocalAdmissionTerminal(
      db,
      { ownerDeviceId: device, networkScopeId: target.networkScopeIdOrNull },
      requestId,
    );
    if (cacheable) index.terminalRead = { requestId, value: verified };
    return structuredClone({ target, ...verified });
  });
}
export function hostLocalProfileReturnedBeforeSubmit(
  db: Db,
  device: string,
  ownerId: string,
  campaignId: string,
): boolean {
  const index = ownershipIndex(db, device),
    origin = index?.returnedProfiles.get(ownerId + '/' + campaignId);
  return (
    !!index &&
    !!origin &&
    index.state.active?.kind === 'GM' &&
    s.same(index.state.active.origin, origin) &&
    !index.scopes.some((q) => !q.released && q.ownerId === ownerId && q.campaignId === campaignId)
  );
}
export function readHostLocalCharacterOwner(db: Db, device: string, id: string): string | null {
  return ownershipIndex(db, device)?.characters.get(id) ?? null;
}
export function readHostLocalOwnedCharacters(
  db: Db,
  device: string,
  ownerId: string,
): readonly string[] {
  return Array.from(ownershipIndex(db, device)?.characters ?? [])
    .filter(([, owner]) => owner === ownerId)
    .map(([id]) => id);
}
export function readHostLocalCharacterCursor(
  db: Db,
  device: string,
  ownerId: string,
): CharacterCursor | null {
  const h = ownershipIndex(db, device);
  return h?.state.active?.kind === 'CANDIDATE' &&
    h.state.active.profile.targetLocalOwnerId === ownerId
    ? structuredClone(h.cursors.get(ownerId) ?? null)
    : null;
}
function commit(db: Db, device: string, c: Command, guard: Guard) {
  return s.safe(() =>
    db
      .transaction(() => {
        s.owner(db, device);
        s.text(c.commandId);
        s.integer(c.expectedRevision);
        const h = history(db, device, c.commandId);
        if (h.found) {
          if (!s.same(c, h.found.command)) return s.fail('IDEMPOTENCY_CONFLICT');
          s.guarded(db, guard, h.state, 'REPLAY');
          return { receipt: h.found.receipt, replayed: true };
        }
        let r: SeatEventReceipt = {
          commandId: c.commandId,
          receiptId: randomUUID(),
          kind:
            c.operation === 'ACK'
              ? 'ACK'
              : c.operation === 'BEGIN' || c.operation === 'CANCEL_CURTAIN'
                ? 'BEGIN'
                : 'ROSTER',
          revision: h.state.revision + 1,
          handoffId:
            c.operation === 'ACK'
              ? c.handoffId
              : c.operation === 'PROFILE'
                ? c.profile.targetLocalOwnerId
                : randomUUID(),
          ...(c.operation === 'ACK' && h.state.pending?.target.kind === 'CANDIDATE'
            ? { candidateContextId: randomUUID() }
            : {}),
        };
        s.guarded(db, guard, h.state, 'APPLY');
        const released = releasedCandidateScope(h, c);
        if (released !== null) {
          const scope = { ownerDeviceId: device, networkScopeId: released };
          if (c.operation !== 'BEGIN') return s.fail();
          const history = s.admissionHistory(db, scope);
          let app = history.current;
          if (
            c.retireNavigation &&
            c.retireNavigation.expectedProjectionRevision !== app.projectionRevision
          )
            return s.fail('STALE_REVISION');
          if (c.retireReturnFrom === 'NET-003') {
            const target = h.state.active?.kind === 'CANDIDATE' && h.state.active.requestOrNull;
            const header = app.requestOrNull;
            if (
              !target ||
              !header?.closureOrNull ||
              app.pendingCommandIdOrNull ||
              app.formId !== 'NET-003' ||
              header.requestId !== target.requestId ||
              header.submitReceiptId !== target.submitReceiptId ||
              header.technicalSessionId !== target.technicalSessionId ||
              target.proposalOrNull
            )
              return s.fail('FOREIGN_OWNER');
            const submitted = s.deliverySnapshot(history, header.submitCommandId);
            const cancellation = s.deliverySnapshot(history, header.closureOrNull.commandId);
            const request = cancellation.requestCurrentOrNull;
            const ack = request?.proof.cancelledReceiptOrNull;
            if (
              !submitted.acknowledgementEvent ||
              !cancellation.acknowledgementEvent ||
              !ack ||
              request?.requestStatus !== 'CANCELLED' ||
              request.requestRevision !== target.requestRevision + 1 ||
              request.proof.submittedReceipt.receiptId !== target.submitReceiptId ||
              ack.receiptId !== header.closureOrNull.receiptId ||
              !s.same(ack.request, header)
            )
              return s.fail('FOREIGN_OWNER');
            const submitAckEventId = submitted.acknowledgementEvent.input.eventId;
            const cancelAckEventId = cancellation.acknowledgementEvent.input.eventId;
            r = {
              ...r,
              cancelledRequest: {
                submitAckEventId,
                cancelAckEventId,
                acknowledgedEventsSha256: acknowledgedEventsHash(
                  db,
                  device,
                  released,
                  submitAckEventId,
                  cancelAckEventId,
                ),
              },
            };
          } else if (c.retireReturnFrom === 'NET-007' && c.retireNavigation) {
            const active = h.state.active,
              target = active?.kind === 'CANDIDATE' ? active.requestOrNull : null;
            if (
              !target ||
              !app.requestOrNull ||
              app.pendingCommandIdOrNull ||
              target.requestId !== app.requestOrNull.requestId ||
              target.submitReceiptId !== app.requestOrNull.submitReceiptId ||
              target.technicalSessionId !== app.sessionOrNull?.technicalSessionId
            )
              return s.fail('FOREIGN_OWNER');
            const forwarded = s.canonical({
              messageType: 'navigation.form-action',
              protocolVersion: 2,
              ...c.retireNavigation,
              sourceFormId: 'NET-007',
              actionKey: 'NET-007::CTA::005',
            });
            const admitted = returnHostLocalTerminalAdmission(
              db,
              scope,
              {
                requestId: target.requestId,
                expectedRevisions: s.vectorOf(app),
                expectedDraftRevision: app.draftRevision,
                clientRequestJson: forwarded,
              },
              randomUUID,
            );
            const proposal = admitted.record.publication.proposalOrNull;
            if (
              !s.same(
                target.proposalOrNull,
                proposal && {
                  admissionBatchId: proposal.admissionBatchId,
                  proposalRevision: proposal.proposalRevision,
                  proposalChecksum: proposal.proposalChecksum,
                },
              )
            )
              return s.fail('FOREIGN_OWNER');
            const event = admitted.events.at(-1);
            if (!event || event.payload.kind !== 'RETURN' || event.payload.mode !== 'HOST_GM')
              return s.fail();
            r = { ...r, terminalReturnSha256: s.sha(s.canonical(event)) };
            app = s.admissionHistory(db, scope).current;
          } else if (app.requestOrNull || app.requestReviewOrNull || app.pendingCommandIdOrNull)
            return s.fail('FOREIGN_OWNER');
          const close = localAdmissionTabStorage.hostCandidateClose(db, {
            ...scope,
            expectedRevisions: s.vectorOf(app),
            ...closeIds(r.receiptId, c.retireReturnFrom),
          });
          r = { ...r, closedTabReceiptSha256: s.sha(s.canonical(close)) };
        }
        if (c.operation === 'CURSOR' && c.postSaveScopeId !== undefined) {
          const head = readPostSaveHeadById(db, c.postSaveScopeId, device);
          if (
            !head ||
            head.scope.ownerContext !== 'PLAYER_LOCAL' ||
            head.scope.entityId !== c.localCharacterId ||
            head.presentation['formId'] !== c.formId
          )
            return s.fail('FOREIGN_OWNER');
        }
        if (c.operation === 'BIRTH') {
          const birth = db
            .prepare<[string, string], { checkpoint_revision: number }>(
              'SELECT checkpoint_revision FROM local_character_checkpoint WHERE local_character_id=? AND checkpoint_id=?',
            )
            .get(c.localCharacterId, c.checkpointId);
          const original = readLocalCharacterOwner(db, c.localCharacterId);
          if (
            !isRecordingHostLocalBirth(db, c.localCharacterId, c.checkpointId) ||
            !birth ||
            birth.checkpoint_revision !== 0 ||
            original?.ownerDeviceId !== device ||
            original.variantBirthCommandId !== null
          )
            return s.fail('FOREIGN_OWNER');
        }
        if (c.operation === 'SCOPE') {
          const tab = readOwnedLocalNetworkTabAnchor(db, device, c.networkScopeId);
          const entered =
            tab && localAdmissionTabStorage.entryAnchor(db, device, tab.entryCommandId)?.request;
          const nav =
            entered?.applicationEntry &&
            s.object(JSON.parse(entered.applicationEntry.clientRequestJson) as unknown);
          if (
            h.state.active?.kind !== 'CANDIDATE' ||
            !entered ||
            entered.sourceContextId !== h.state.active.profile.targetLocalOwnerId ||
            entered.sourceRevisions.projectionRevision !== c.expectedRevision ||
            (c.commandId.startsWith('host-local-scope:') &&
              c.commandId !== 'host-local-scope:' + s.text(nav?.['navigationRequestId'])) ||
            nav?.['sourceFormId'] !== 'APP-003' ||
            nav['actionKey'] !== 'APP-003::CTA::009'
          )
            return s.fail('FOREIGN_OWNER');
        }
        if (c.operation === 'SELECTION') {
          const row = db.prepare<[string], { lifecycle_state: string }>(
            'SELECT lifecycle_state FROM local_character WHERE local_character_id=?',
          );
          for (const id of c.selectedSourceUuids)
            if (row.get(id)?.lifecycle_state !== 'FINAL') return s.fail('FOREIGN_OWNER');
        }
        if (
          c.operation === 'RETURN_SETUP' &&
          c.formId === 'PLY-027' &&
          (!h.state.setupOrNull ||
            readHostLocalRoster(db, device, h.state.setupOrNull.origin.campaignId).length)
        )
          return s.fail('FOREIGN_OWNER');
        const target =
          c.operation === 'BEGIN' || c.operation === 'PROMOTE'
            ? c.target
            : c.operation === 'ACK'
              ? h.state.pending?.target
              : null;
        if (
          target?.kind === 'PLAYER' &&
          !readHostLocalRoster(db, device, target.origin.campaignId).some(
            ({ binding, profileOwnerId }) =>
              binding.localControllerSeatId === target.localControllerSeatId &&
              binding.networkScopeId === target.networkScopeId &&
              binding.admissionReceiptId === target.admissionReceiptId &&
              profileOwnerId === target.profile.targetLocalOwnerId,
          )
        )
          return s.fail('FOREIGN_OWNER');
        for (const id of [
          c.commandId,
          r.receiptId,
          ...(c.operation === 'ACK' ? [] : [r.handoffId]),
        ])
          s.assertUnused(db, id);
        const body: HostBody = {
          ownerDeviceId: device,
          previousSha256: h.digest,
          hostLocal: 1,
          command: c,
          receipt: r,
        };
        const { signature } = appendSeatEvent(db, body);
        transition(h, c, r, signature);
        if (!s.same(history(db, device).state, h.state)) return s.fail('SOURCE_CHANGED');
        return { receipt: r, replayed: false };
      })
      .immediate(),
  );
}
export const markHostLocalGmDestination = (
  db: Db,
  device: string,
  c: GmDestination,
  guard: Guard,
) => commit(db, device, { ...c, operation: 'GM_DESTINATION' }, guard);
export const openHostLocalSeatSetup = (db: Db, device: string, c: Setup, guard: Guard) =>
  commit(db, device, { ...c, operation: 'SETUP' }, guard);
export const returnHostSeatSetup = (db: Db, device: string, c: ReturnSetup, guard: Guard) =>
  commit(db, device, { ...c, operation: 'RETURN_SETUP' }, guard);
export const cancelHostLocalCandidateCurtain = (
  db: Db,
  device: string,
  c: CancelCurtain,
  guard: Guard,
) => commit(db, device, { ...c, operation: 'CANCEL_CURTAIN' }, guard);
export const createHostSeatProfile = (db: Db, device: string, c: Create, guard: Guard) =>
  commit(db, device, { ...c, operation: 'PROFILE' }, guard);
export const selectHostSeatProfile = (
  db: Db,
  device: string,
  c: Mutator & { targetLocalOwnerId: string },
  guard: Guard,
) => commit(db, device, { ...c, operation: 'SELECT_PROFILE' }, guard);
export const selectHostLocalFinals = (db: Db, device: string, c: Selection, guard: Guard) =>
  commit(db, device, { ...c, operation: 'SELECTION' }, guard);
export const saveHostLocalCharacterCursor = (db: Db, device: string, c: Cursor, guard: Guard) =>
  commit(db, device, { ...c, operation: 'CURSOR' }, guard);
export const beginHostLocalSeatHandoff = (db: Db, device: string, c: Begin, guard: Guard) =>
  commit(db, device, { ...c, operation: 'BEGIN' }, guard);
export const ackHostLocalSeatHandoff = (db: Db, device: string, c: Ack, guard: Guard) =>
  commit(db, device, { ...c, operation: 'ACK' }, guard);
export const attachHostLocalScope = (db: Db, device: string, c: Attach, guard: Guard) =>
  commit(db, device, { ...c, operation: 'SCOPE' }, guard);
export function openHostLocalProfileScope(
  db: Db,
  device: string,
  c: Attach,
  tab: LocalNetworkTabEntryInput,
  guard: Guard,
  tabGuard: LocalNetworkTabEntryGuard,
) {
  if (
    tab.ownerDeviceId !== device ||
    tab.networkScopeId !== c.networkScopeId ||
    tab.admissionEntry !== undefined ||
    db.inTransaction
  )
    return s.fail('INVALID_INPUT');
  return s.safe(() =>
    db
      .transaction(() => {
        localAdmissionTabStorage.hostEntry(db, tab, tabGuard);
        return attachHostLocalScope(db, device, c, guard);
      })
      .immediate(),
  );
}
export const recordHostLocalCharacterBirth = (db: Db, device: string, c: Birth, guard: Guard) =>
  commit(db, device, { ...c, operation: 'BIRTH' }, guard);
export const promoteHostLocalSeat = (db: Db, device: string, c: Promote, guard: Guard) =>
  commit(db, device, { ...c, operation: 'PROMOTE' }, guard);
