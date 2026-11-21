import {
  admissionOwnerProjectionValue,
  isAdmissionOwnerForm,
} from '@shared/campaign-admission-presentation.js';
import {
  admissionOwnerPublicationValue,
  admissionPlayerDecisionReceiptCheck,
  type AdmissionPlayerCopyResult,
} from '@shared/campaign-admission-proposal.js';
import { campaignReadyReceiptValue } from '@shared/campaign-lobby.js';
import { admissionCodecReaders as r } from '@shared/campaign-admission-codec.js';
import {
  campaignLobbyPlayerProjectionValue,
  campaignPeaceProjectionValue,
  isCampaignOwnerProjection,
} from '@shared/campaign-lobby-presentation.js';
import type { CommandReceipt, JsonObject, RevisionVector } from '@shared/wire-protocol.js';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import { reconnectFingerprint as fingerprint } from '@shared/reconnect-fingerprint.js';
import type { OwnerBrowserCommand } from './admission-client.js';

type Copy = { readonly id: string; readonly sheet: string; readonly assignment: string };
type Admission = {
  readonly kind: 'ADMISSION';
  readonly diffs: readonly { id: string | null; sheet: string; blocked: boolean }[];
  readonly receipt:
    | null
    | { readonly state: AdmissionPlayerCopyResult['lifecycleState']; readonly assignment: string }
    | 'NO_MATCH';
};
type Lobby = {
  readonly kind: 'LOBBY';
  readonly copy: Copy;
  readonly active: boolean;
  readonly selected: string;
  readonly campaignRevision: number;
  readonly lobbyEventRevision: number;
  readonly readinessRevision: number;
  readonly started: boolean;
};
type Peace = { readonly kind: 'PEACE'; readonly copy: Copy; readonly fixed: string };
type Detail = Admission | Lobby | Peace;
type Witness =
  | { readonly kind: 'OTHER'; readonly owner: boolean }
  | {
      readonly kind: 'REQUEST';
      readonly owner: boolean;
      readonly binding: string;
      readonly pending: boolean;
      readonly revisions: RevisionVector;
    }
  | {
      readonly kind: 'CAMPAIGN_FORM';
      readonly owner: boolean;
      readonly formId: string;
      readonly revisions: RevisionVector;
      readonly requestBinding: string;
      readonly identity: string;
      readonly durable: string;
      readonly detail: Detail;
    };

const absentFromDurable = ['contextId', 'technicalSessionAvailable'];
const absentFromPeace = [
  ...absentFromDurable,
  'stateRevision',
  'projectionRevision',
  'actorVisibilityRevision',
  'pendingCommandIdOrNull',
];
function excluding(projection: JsonObject, keys: readonly string[]) {
  return fingerprint(
    Object.fromEntries(Object.entries(projection).filter(([key]) => !keys.includes(key))),
  );
}

function assignment(id: unknown, group: unknown, location: unknown, controller: unknown): string {
  return fingerprint([id, group, location, controller]);
}

function admission(
  form: Parameters<typeof admissionOwnerProjectionValue>[0],
  projection: JsonObject,
): Admission {
  const checked = admissionOwnerProjectionValue(form, projection);
  const publication = checked['publication'] as JsonObject;
  const proposal = publication['proposalOrNull'] as JsonObject | null;
  const diffs =
    proposal === null
      ? []
      : (proposal['fullCampaignCopyDiffs'] as readonly JsonObject[]).map((diff) => ({
          id:
            diff['campaignCharacterIdOrNull'] === null
              ? null
              : fingerprint(diff['campaignCharacterIdOrNull']),
          sheet: fingerprint(diff['afterSheet']),
          blocked: (diff['blockers'] as readonly unknown[]).length > 0,
        }));
  const receipt = checked['receiptOrNull'] as JsonObject | null;
  if (receipt === null) return { kind: 'ADMISSION', diffs, receipt: null };
  const copy = (receipt['copies'] as unknown as readonly AdmissionPlayerCopyResult[]).find(
    (c) => c.controllerBindingOrNull?.localControllerSeatId === checked['controllerSeat'],
  );
  return {
    kind: 'ADMISSION',
    diffs,
    receipt:
      copy === undefined
        ? 'NO_MATCH'
        : {
            state: copy.lifecycleState,
            assignment: assignment(
              copy.campaignCharacterId,
              copy.groupIdOrNull,
              copy.locationAssignmentOrNull,
              copy.controllerBindingOrNull,
            ),
          },
  };
}

function requestBinding(projection: JsonObject, request: boolean) {
  return fingerprint([
    projection['deviceId'],
    projection['networkScopeId'],
    projection['controllerSeat'],
    projection[request ? 'requestId' : 'requestIdOrNull'],
    projection[request ? 'campaignIdOrNull' : 'campaignId'],
  ]);
}

/** Only scalars and digests cross the disconnect. The decoded projection stays on this call's stack. */
function capture(snapshot: ConfirmedProjectionSnapshot): Witness {
  const p = snapshot.projection;
  const owner = isCampaignOwnerProjection(p);
  const { stateRevision, projectionRevision, actorVisibilityRevision } = snapshot.revisions;
  const revisions = { stateRevision, projectionRevision, actorVisibilityRevision };
  if (snapshot.formId === 'NET-005')
    return {
      kind: 'REQUEST',
      owner,
      revisions,
      binding: requestBinding(p, true),
      pending: p['requestStatus'] === 'IN_REVIEW' || p['requestStatus'] === 'PENDING',
    };
  if (snapshot.formId !== 'PLY-001' && !isAdmissionOwnerForm(snapshot.formId))
    return { kind: 'OTHER', owner };
  let detail: Detail;
  if (p['projectionVariant'] === 'PEACE_SNAPSHOT') {
    const peace = campaignPeaceProjectionValue(p);
    detail = {
      kind: 'PEACE',
      fixed: excluding(p, absentFromPeace),
      copy: {
        id: fingerprint(peace.campaignCharacterId),
        sheet: fingerprint(peace.mechanicalSheet),
        assignment: assignment(
          peace.campaignCharacterId,
          peace.groupId,
          peace.location,
          peace.effectiveController,
        ),
      },
    };
  } else if (p['projectionVariant'] === 'LOBBY_SNAPSHOT') {
    const { lobby } = campaignLobbyPlayerProjectionValue(p);
    const copy = lobby.selectedCopy;
    detail = {
      kind: 'LOBBY',
      active: copy.lifecycleState === 'ACTIVE',
      selected: fingerprint(copy),
      campaignRevision: lobby.campaignRevision,
      lobbyEventRevision: lobby.lobbyEventRevision,
      readinessRevision: lobby.readinessRevision,
      started: lobby.campaignStarted,
      copy: {
        id: fingerprint(copy.campaignCharacterId),
        sheet: fingerprint(copy.sheet),
        assignment: assignment(
          copy.campaignCharacterId,
          copy.groupId,
          copy.location,
          copy.controller,
        ),
      },
    };
  } else if (isAdmissionOwnerForm(snapshot.formId)) detail = admission(snapshot.formId, p);
  else return { kind: 'OTHER', owner };
  const binding = requestBinding(p, false);
  return {
    kind: 'CAMPAIGN_FORM',
    owner,
    formId: snapshot.formId,
    revisions,
    requestBinding: binding,
    identity: fingerprint([binding, p['admissionBatchId']]),
    durable: excluding(p, absentFromDurable),
    detail,
  };
}

function continues(scene: Lobby | Peace, admitted: Admission): boolean {
  const diff = admitted.diffs.find((d) => d.id === scene.copy.id);
  if (!diff || diff.sheet !== scene.copy.sheet) return false;
  const receipt = admitted.receipt;
  if (receipt === null)
    return diff === admitted.diffs[0] && (scene.kind !== 'PEACE' || !diff.blocked);
  return (
    receipt !== 'NO_MATCH' &&
    receipt.assignment === scene.copy.assignment &&
    (scene.kind === 'PEACE' ? receipt.state === 'ACTIVE' : receipt.state !== 'DECLINED')
  );
}

function matches(before: Witness, next: ConfirmedProjectionSnapshot): boolean {
  if (!before.owner && !isCampaignOwnerProjection(next.projection)) return true;
  return matchesEvidence(before, capture(next));
}
function matchesEvidence(before: Witness, after: Witness): boolean {
  if (after.kind !== 'CAMPAIGN_FORM' || before.kind === 'OTHER') return false;
  const n = after.revisions,
    p = before.revisions;
  if (n.actorVisibilityRevision !== p.actorVisibilityRevision) return false;
  if (before.kind === 'REQUEST')
    return (
      after.owner &&
      before.pending &&
      before.binding === after.requestBinding &&
      n.stateRevision > p.stateRevision &&
      n.projectionRevision > p.projectionRevision
    );
  if (
    before.identity !== after.identity ||
    n.stateRevision < p.stateRevision ||
    n.projectionRevision < p.projectionRevision ||
    (before.formId === 'PLY-001' && after.formId !== 'PLY-001')
  )
    return false;
  if (
    (n.stateRevision === p.stateRevision || n.projectionRevision === p.projectionRevision) &&
    (before.formId !== after.formId || before.durable !== after.durable)
  )
    return false;
  const a = after.detail,
    b = before.detail;
  if (a.kind === 'ADMISSION') return b.kind !== 'ADMISSION' && continues(b, a);
  if (b.kind === 'ADMISSION') return continues(a, b);
  if (a.kind === 'PEACE' && b.kind === 'PEACE') return a.fixed === b.fixed;
  if (a.kind === 'PEACE' && b.kind === 'LOBBY')
    return b.active && a.copy.sheet === b.copy.sheet && a.copy.assignment === b.copy.assignment;
  if (a.kind === 'LOBBY' && b.kind === 'LOBBY')
    return (
      a.campaignRevision >= b.campaignRevision &&
      a.lobbyEventRevision >= b.lobbyEventRevision &&
      a.readinessRevision >= b.readinessRevision &&
      (!b.started || a.started) &&
      a.selected === b.selected
    );
  return true;
}

function checker(witness: Witness) {
  return (next: ConfirmedProjectionSnapshot) => matches(witness, next);
}
export function ownerReconnectCheck(previous: ConfirmedProjectionSnapshot) {
  return checker(capture(previous));
}

type ReceiptCopy = {
  readonly state: AdmissionPlayerCopyResult['lifecycleState'];
  readonly assignment: string;
};
export interface OwnerReceiptWitness {
  readonly fingerprint: string;
  readonly revisions: RevisionVector;
  readonly copy: ReceiptCopy | null;
  readonly readinessRevision: number | null;
}
export interface OwnerCommandWitness {
  readonly contextId: string;
  readonly executableWorkflowCommandIds: ConfirmedProjectionSnapshot['executableWorkflowCommandIds'];
  checkReceipt(receipt: CommandReceipt): OwnerReceiptWitness;
  matchesDestination(
    next: ConfirmedProjectionSnapshot,
    receipt: OwnerReceiptWitness | null,
    reconnecting: boolean,
    currentContextId?: string,
  ): boolean;
}

const legacyTransient = [
  'contextId',
  'technicalSessionAvailable',
  'capacityRecheck',
  'controllerDeviceRecheck',
  'campaignRevisionOrNull',
  'campaignStatus',
  'startStatus',
];
function legacyEvidence(snapshot: ConfirmedProjectionSnapshot) {
  const p = snapshot.projection;
  return {
    formId: snapshot.formId,
    controller: fingerprint([p['networkScopeId'], p['controllerSeat'], p['deviceId']]),
    hosting: p['campaignStatus'] === 'HOSTING',
    publication: fingerprint(p['publication']),
    receipt: p['receiptOrNull'] === null ? null : fingerprint(p['receiptOrNull']),
    quiet: excluding(p, legacyTransient),
    layers: fingerprint(snapshot.layers),
  };
}
function commandSource(previous: ConfirmedProjectionSnapshot, request: OwnerBrowserCommand) {
  const view = capture(previous);
  if (view.kind !== 'CAMPAIGN_FORM') throw Error('Missing owner command source');
  const p = previous.projection;
  const basis =
    request.workflowCommandId === 'UI-CMD-CAMPAIGN-READY-SET'
      ? {
          kind: 'READY' as const,
          included: fingerprint(
            campaignLobbyPlayerProjectionValue(p).lobby.includedCampaignCharacterIds,
          ),
        }
      : {
          kind: 'DECISION' as const,
          readDecision: admissionPlayerDecisionReceiptCheck(
            admissionOwnerPublicationValue(p['publication']),
          ),
          legacy: legacyEvidence(previous),
        };
  return {
    view,
    basis,
    contextId: p['contextId'] as string,
    networkScopeId: p['networkScopeId'] as string,
    campaignId: p['campaignId'] as string,
    deviceId: p['deviceId'] as string,
    controllerSeat: p['controllerSeat'] as string,
    executableWorkflowCommandIds: [...previous.executableWorkflowCommandIds],
  };
}
type CommandSource = ReturnType<typeof commandSource>;

function checkOwnerReceipt(
  source: CommandSource,
  request: OwnerBrowserCommand,
  receipt: CommandReceipt,
): OwnerReceiptWitness {
  const result = r.exact(
    receipt.result,
    'operation networkScopeId remoteReceipt',
    '$.receipt.result',
  );
  const n = receipt.revisions,
    p = source.view.revisions;
  if (
    receipt.commandId !== request.commandId ||
    n.stateRevision < p.stateRevision + 2 ||
    n.projectionRevision < p.projectionRevision + 2 ||
    n.actorVisibilityRevision !== p.actorVisibilityRevision
  )
    throw Error('Owner receipt does not match the command or its revisions');
  let copy: ReceiptCopy | null = null;
  let readinessRevision: number | null = null;
  if (request.workflowCommandId === 'UI-CMD-CAMPAIGN-READY-SET' && source.basis.kind === 'READY') {
    const remote = campaignReadyReceiptValue(result['remoteReceipt']);
    if (
      result['operation'] !== 'CAMPAIGN_READY_SET' ||
      result['networkScopeId'] !== source.networkScopeId ||
      remote.commandId !== request.commandId ||
      remote.campaignId !== source.campaignId ||
      remote.ownerDeviceId !== source.deviceId ||
      remote.ready !== request.payload['ready'] ||
      remote.lobbySnapshotRevision !== request.payload['expectedLobbySnapshotRevision'] ||
      fingerprint(remote.includedCampaignCharacterIds) !== source.basis.included
    )
      throw Error('Ready receipt does not match the original source');
    readinessRevision = remote.readinessRevision;
  } else if (
    source.basis.kind === 'DECISION' &&
    request.workflowCommandId === 'UI-CMD-ADMISSION-PLAYER-DECIDE'
  ) {
    const remote = source.basis.readDecision(result['remoteReceipt']);
    if (
      result['operation'] !== 'ADMISSION_PLAYER_DECIDE' ||
      result['networkScopeId'] !== request.payload['networkScopeId'] ||
      remote.commandId !== request.commandId ||
      remote.decision !== request.payload['decision'] ||
      remote.campaignRevision !== Number(request.payload['expectedCampaignRevision']) + 1
    )
      throw Error('Admission receipt does not match the original source');
    const bound = remote.copies.find(
      (c) => c.controllerBindingOrNull?.localControllerSeatId === source.controllerSeat,
    );
    if (bound)
      copy = {
        state: bound.lifecycleState,
        assignment: assignment(
          bound.campaignCharacterId,
          bound.groupIdOrNull,
          bound.locationAssignmentOrNull,
          bound.controllerBindingOrNull,
        ),
      };
  } else throw Error('Unexpected owner command');
  return Object.freeze({
    fingerprint: fingerprint(receipt),
    revisions: Object.freeze({ ...n }),
    copy: copy === null ? null : Object.freeze(copy),
    readinessRevision,
  });
}

function legacyContinues(
  before: ReturnType<typeof legacyEvidence>,
  next: ConfirmedProjectionSnapshot,
  previous: RevisionVector,
) {
  if (!isAdmissionOwnerForm(next.formId)) return false;
  const after = legacyEvidence(next),
    n = next.revisions;
  return (
    before.controller === after.controller &&
    n.stateRevision >= previous.stateRevision &&
    n.projectionRevision >= previous.projectionRevision &&
    n.actorVisibilityRevision === previous.actorVisibilityRevision &&
    (!before.hosting || after.hosting) &&
    before.publication === after.publication &&
    (before.receipt === null || before.receipt === after.receipt) &&
    ((n.stateRevision > previous.stateRevision &&
      n.projectionRevision > previous.projectionRevision) ||
      (before.formId === after.formId &&
        before.quiet === after.quiet &&
        before.layers === after.layers))
  );
}
function destination(
  source: CommandSource,
  request: OwnerBrowserCommand,
  next: ConfirmedProjectionSnapshot,
  receipt: OwnerReceiptWitness | null,
  reconnecting: boolean,
  contextId: string,
): boolean {
  const p = next.projection,
    n = next.revisions,
    before = source.view.revisions;
  if (!reconnecting && p['contextId'] !== contextId) return false;
  if (request.workflowCommandId === 'UI-CMD-CAMPAIGN-READY-SET') {
    if (!matches(source.view, next)) return false;
    if (receipt === null)
      return isCampaignOwnerProjection(p) && n.stateRevision > before.stateRevision;
    return (
      p['pendingCommandIdOrNull'] === null &&
      (next.formId === 'PLY-001' ||
        (next.formId === 'NET-027' &&
          admissionOwnerProjectionValue('NET-027', p)['receiptOrNull'] !== null) ||
        (receipt.readinessRevision !== null &&
          campaignLobbyPlayerProjectionValue(p).lobby.readinessRevision >=
            receipt.readinessRevision)) &&
      n.stateRevision >= receipt.revisions.stateRevision &&
      n.projectionRevision >= receipt.revisions.projectionRevision &&
      n.actorVisibilityRevision >= receipt.revisions.actorVisibilityRevision
    );
  }
  if (source.basis.kind !== 'DECISION') return false;
  if (isCampaignOwnerProjection(p)) {
    const after = capture(next);
    if (request.payload['decision'] !== 'ACCEPT' || !matchesEvidence(source.view, after))
      return false;
    if (receipt === null) return n.stateRevision > before.stateRevision;
    return (
      after.kind === 'CAMPAIGN_FORM' &&
      after.detail.kind !== 'ADMISSION' &&
      receipt.copy !== null &&
      receipt.copy.assignment === after.detail.copy.assignment &&
      (after.detail.kind === 'PEACE'
        ? receipt.copy.state === 'ACTIVE'
        : receipt.copy.state !== 'DECLINED') &&
      n.stateRevision >= receipt.revisions.stateRevision &&
      n.projectionRevision >= receipt.revisions.projectionRevision
    );
  }
  if (receipt !== null) {
    if (reconnecting && next.formId === 'APP-002')
      return (
        request.payload['decision'] === 'DECLINE' &&
        next.layers.length === 0 &&
        p['deviceId'] === source.deviceId
      );
    if (
      p['deviceId'] === source.deviceId &&
      p['networkScopeId'] === request.payload['networkScopeId'] &&
      n.stateRevision > receipt.revisions.stateRevision &&
      n.projectionRevision >= receipt.revisions.projectionRevision &&
      n.actorVisibilityRevision === receipt.revisions.actorVisibilityRevision
    )
      return true;
  }
  if (!legacyContinues(source.basis.legacy, next, before)) return false;
  if (p['receiptOrNull'] === null) return p['pendingCommandIdOrNull'] === request.commandId;
  if (
    n.stateRevision < before.stateRevision + 2 ||
    n.projectionRevision < before.projectionRevision + 2
  )
    return false;
  const remote = source.basis.readDecision(p['receiptOrNull']);
  return (
    remote.commandId === request.commandId &&
    remote.decision === request.payload['decision'] &&
    remote.campaignRevision === Number(request.payload['expectedCampaignRevision']) + 1
  );
}
function commandChecker(source: CommandSource, request: OwnerBrowserCommand): OwnerCommandWitness {
  const checked = new WeakSet<OwnerReceiptWitness>();
  return {
    contextId: source.contextId,
    executableWorkflowCommandIds: source.executableWorkflowCommandIds,
    checkReceipt(receipt) {
      const witness = checkOwnerReceipt(source, request, receipt);
      checked.add(witness);
      return witness;
    },
    matchesDestination(next, receipt, reconnecting, contextId = source.contextId) {
      return (
        (receipt === null || checked.has(receipt)) &&
        destination(source, request, next, receipt, reconnecting, contextId)
      );
    },
  };
}

export function ownerCommandWitness(
  previous: ConfirmedProjectionSnapshot,
  request: OwnerBrowserCommand,
): OwnerCommandWitness {
  return commandChecker(commandSource(previous, request), request);
}
