import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ActionKey } from '@generated/types/atlas.js';
import {
  ORDINARY_SEAT_ACK,
  ordinarySeatAckPayloadValue,
  type OrdinarySeatView,
} from '../shared/ordinary-seat.js';
import { NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS } from '../shared/device-admission.js';
import type { RevisionVector } from '../shared/wire-protocol.js';
import type {
  FormActionIntentV2Message,
  ProjectionSnapshotV2Message,
  PresentedLayerForm,
  PresentationAssignmentReason,
} from '../shared/wire-v2-protocol.js';
import {
  commitOrdinarySeatHandoff,
  ordinaryHandoffPresentAtStartup,
  readOrdinaryActiveSeat,
  readOrdinarySeatBinding,
  readOrdinarySeatHandoff,
  readOrdinarySeatRoster,
  type OrdinarySeatBinding,
} from '../persistence/local-seat-handoff.js';
import { NetworkApplicationStoreError } from '../persistence/network-local-application.js';
import { readOrdinarySceneRoster } from '../persistence/local-seat-roster.js';
import { APP_004_ROUTE } from './projections/app.js';
import type { createOrdinaryCandidateLibrary } from './ordinary-candidate-library.js';
import type {
  LocalNetworkClientMessage,
  LocalNetworkConnection,
  LocalNetworkHostMessage,
  LocalNetworkShell,
} from './network-application.js';

type Snapshot = ProjectionSnapshotV2Message;
type Send = (message: LocalNetworkHostMessage) => void;
const unavailable = (): never => {
  throw new NetworkApplicationStoreError('UNAVAILABLE');
};
const revisions = (r: number): RevisionVector => ({
  actorVisibilityRevision: r,
  projectionRevision: r,
  stateRevision: r,
});
const proof = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');
const supported = (connection: LocalNetworkConnection) =>
  connection.executableWorkflowCommandIds.includes(ORDINARY_SEAT_ACK);
const switchAction = 'PLY-001::CTA::015';
type LayerId = 'PLY-027' | 'PLY-029' | 'PLY-030';
function layer(
  formId: LayerId,
  view: OrdinarySeatView,
  availableActionKeys: readonly ActionKey[],
): PresentedLayerForm {
  return {
    formId,
    formType: 'component',
    routeTemplate: '@component/' + formId.toLowerCase(),
    routeBindings: [],
    roleFilteredPayload: view,
    availableActionKeys,
  };
}
function neutral(
  correlationId: string,
  reason: PresentationAssignmentReason,
  view: OrdinarySeatView,
  actions: readonly ActionKey[] = [],
): Snapshot {
  const overlay =
    view.ordinarySeatView === 'ROSTER'
      ? 'PLY-027'
      : view.ordinarySeatView === 'CURTAIN'
        ? 'PLY-030'
        : null;
  return {
    messageType: 'projection.snapshot',
    protocolVersion: 2,
    projectionRole: 'player',
    revisions: revisions(view.revision),
    presentation: {
      assignment: { reason, correlationId: correlationId },
      base: {
        formId: view.ordinarySeatView === 'LIBRARY' ? 'APP-004' : 'APP-003',
        formType: 'screen',
        routeTemplate: view.ordinarySeatView === 'LIBRARY' ? APP_004_ROUTE : '/local/app-003',
        routeBindings: [],
        roleFilteredPayload:
          overlay === null ? view : { ordinarySeatView: 'WAITING', revision: view.revision },
        availableActionKeys: overlay === null ? actions : [],
      },
      layers: overlay === null ? [] : [layer(overlay, view, actions)],
    },
  };
}

interface Source {
  readonly seatId: string;
  readonly contextId: string;
  readonly scopeId: string;
  readonly revision: number;
  readonly stateRevision: number;
  readonly actorVisibilityRevision: number;
  readonly sceneId: string;
  readonly campaignId: string;
  readonly contentHash: string;
}
export function peaceSource(message: Snapshot): Source | null {
  const base = message.presentation.base;
  const p = base.roleFilteredPayload;
  if (
    base.formId !== 'PLY-001' ||
    p['projectionVariant'] !== 'PEACE_SNAPSHOT' ||
    p['technicalSessionAvailable'] !== true ||
    p['pendingCommandIdOrNull'] !== null ||
    typeof p['contextId'] !== 'string' ||
    typeof p['networkScopeId'] !== 'string' ||
    typeof p['sceneId'] !== 'string' ||
    typeof p['campaignId'] !== 'string' ||
    typeof p['controllerSeat'] !== 'string'
  )
    return null;
  // Observing a second admitted PC advances the shared #173 revision vector. Its
  // observation may never silently change the source sheet, scene or ownership.
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify({ ...p, projectionRevision: 0, stateRevision: 0, actorVisibilityRevision: 0 }),
    )
    .digest('hex');
  return {
    seatId: p['controllerSeat'],
    contextId: p['contextId'],
    scopeId: p['networkScopeId'],
    revision: message.revisions.projectionRevision,
    stateRevision: message.revisions.stateRevision,
    actorVisibilityRevision: message.revisions.actorVisibilityRevision,
    sceneId: p['sceneId'],
    campaignId: p['campaignId'],
    contentHash,
  };
}

/** The neutral chooser has no owner watch. SELECT needs a current proof for the original sheet. */
export async function confirmOrdinaryRosterSource(
  expected: Source,
  current: Snapshot,
  confirm: () => Promise<Snapshot>,
): Promise<Source | null> {
  const { base } = current.presentation;
  const payload = base.roleFilteredPayload;
  if (
    base.formId !== 'PLY-001' ||
    payload['projectionVariant'] !== 'PEACE_SNAPSHOT' ||
    typeof payload['technicalSessionAvailable'] !== 'boolean' ||
    payload['pendingCommandIdOrNull'] !== null ||
    payload['networkScopeId'] !== expected.scopeId ||
    payload['controllerSeat'] !== expected.seatId ||
    payload['contextId'] !== expected.contextId ||
    payload['sceneId'] !== expected.sceneId ||
    payload['campaignId'] !== expected.campaignId ||
    current.revisions.projectionRevision !== expected.revision ||
    current.revisions.stateRevision !== expected.stateRevision ||
    current.revisions.actorVisibilityRevision !== expected.actorVisibilityRevision
  )
    return null;
  if (
    payload['technicalSessionAvailable'] &&
    peaceSource(current)?.contentHash !== expected.contentHash
  )
    return null;
  const verified = peaceSource(await confirm());
  return verified?.contentHash === expected.contentHash &&
    verified.revision === expected.revision &&
    verified.stateRevision === expected.stateRevision &&
    verified.actorVisibilityRevision === expected.actorVisibilityRevision
    ? verified
    : null;
}
interface Delivery {
  send: Send;
  mode: 'LEGACY' | OrdinarySeatView['ordinarySeatView'];
  libraryOriginId: string | null;
  revision: number;
  source: Source | null;
  addressedHandoff: string | null;
  activeProof: string | null;
}
interface Dependencies {
  db: Database.Database;
  owner: (connection: LocalNetworkConnection) => string;
  peek: (
    connection: LocalNetworkConnection,
    correlationId: string,
    reason: 'FORM_ACTION' | 'COMMAND_DESTINATION' | 'RECONNECT',
  ) => Snapshot;
  confirmSource: (
    connection: LocalNetworkConnection,
    expected: Source,
    targetSeatId: string,
    correlationId: string,
  ) => Promise<{ source: Source; sameReceipt: boolean }>;
  target: (
    connection: LocalNetworkConnection,
    binding: OrdinarySeatBinding,
    contextId: string,
    correlationId: string,
    reason: 'FORM_ACTION' | 'COMMAND_DESTINATION' | 'RECONNECT',
  ) => Promise<{ connection: LocalNetworkConnection; snapshot: Snapshot }>;
  selectedCount: (connection: LocalNetworkConnection) => number;
  canSelectLibrary: (connection: LocalNetworkConnection) => boolean;
  candidateLibrary: ReturnType<typeof createOrdinaryCandidateLibrary>;
  resetEmptySetup: (
    connection: LocalNetworkConnection,
    navigation: FormActionIntentV2Message,
  ) => void;
  unwatch: (connection: LocalNetworkConnection) => void;
  ordinaryCampaign: (owner: string, campaignId: string) => boolean;
  activePublished: (connection: LocalNetworkConnection, message: Snapshot, send: Send) => void;
}

/** Frames and ordinary publications execute on the same queue as admission and the owner poll. */
export function createOrdinarySeatRuntime(dependencies: Dependencies) {
  const clients = new Map<LocalNetworkConnection, Delivery>();
  // This host is the sole journal writer. Read SQLite again on every process start.
  let journalExists = ordinaryHandoffPresentAtStartup(dependencies.db);
  function forget(connection: LocalNetworkConnection) {
    clients.delete(connection);
  }
  function bind(connection: LocalNetworkConnection, send: Send): Delivery {
    const old = clients.get(connection);
    if (old) {
      old.send = send;
      return old;
    }
    for (const conn of clients.keys()) if (!conn.trusted()) forget(conn);
    const view: Delivery = {
      send,
      mode: 'LEGACY',
      libraryOriginId: null,
      revision: 0,
      source: null,
      addressedHandoff: null,
      activeProof: null,
    };
    clients.set(connection, view);
    return view;
  }
  function show(
    connection: LocalNetworkConnection,
    delivery: Delivery,
    correlationId: string,
    reason: PresentationAssignmentReason,
    view: OrdinarySeatView,
    actions: readonly ActionKey[] = [],
  ) {
    dependencies.unwatch(connection);
    delivery.mode = view.ordinarySeatView;
    if (view.ordinarySeatView !== 'LIBRARY') delivery.libraryOriginId = null;
    delivery.revision = view.revision;
    delivery.addressedHandoff = view.ordinarySeatView === 'CURTAIN' ? view.handoffId : null;
    if (view.ordinarySeatView !== 'ROSTER') {
      delivery.source = null;
      delivery.activeProof = null;
    }
    delivery.send(neutral(correlationId, reason, view, actions));
  }
  function purgeOthers(except: LocalNetworkConnection, revision: number) {
    for (const [connection, delivery] of clients) {
      if (!connection.trusted()) {
        forget(connection);
        continue;
      }
      if (connection !== except) {
        try {
          show(connection, delivery, randomUUID(), 'HOST_SYSTEM_EVENT', {
            ordinarySeatView: 'WAITING',
            revision,
          });
        } catch {
          forget(connection);
        }
      }
    }
  }
  function locked(connection: LocalNetworkConnection) {
    return connection.trusted() && journalExists;
  }
  function decorate(connection: LocalNetworkConnection, message: Snapshot): Snapshot {
    const base = message.presentation.base;
    if (!supported(connection) || (base.formId !== 'NET-003' && base.formId !== 'PLY-001'))
      return message;
    // A late cancellation returns to NET-003 even after Start, outside character selection.
    if (
      base.formId === 'NET-003' &&
      (base.roleFilteredPayload['campaignStatus'] !== 'PAUSED' ||
        base.roleFilteredPayload['pendingCommandIdOrNull'] !== null)
    )
      return message;
    const campaignId =
      base.roleFilteredPayload[base.formId === 'NET-003' ? 'campaignIdOrNull' : 'campaignId'];
    if (
      typeof campaignId !== 'string' ||
      !dependencies.ordinaryCampaign(dependencies.owner(connection), campaignId)
    )
      return message;
    let action: ActionKey;
    if (base.formId === 'NET-003') {
      action = 'NET-003::CTA::004';
    } else {
      const source = peaceSource(message);
      if (!source) return message;
      const owner = dependencies.owner(connection);
      const { roster: admitted, eligibleTargetSeatIds } = readOrdinarySceneRoster(
        dependencies.db,
        owner,
        source,
      );
      if (!admitted.some((seat) => seat.seatId === source.seatId)) return message;
      if (admitted.length === 1) {
        if (journalExists) return message;
        return {
          ...message,
          presentation: {
            ...message.presentation,
            layers: [
              layer(
                'PLY-027',
                {
                  ordinarySeatView: 'ROSTER',
                  revision: 0,
                  roster: [{ seatId: source.seatId, ordinal: 1 }],
                  activeSeatIdOrNull: source.seatId,
                },
                [],
              ),
            ],
          },
        };
      }
      if (eligibleTargetSeatIds.length === 0) return message;
      action = switchAction;
    }
    return {
      ...message,
      presentation: {
        ...message.presentation,
        base: { ...base, availableActionKeys: [...base.availableActionKeys, action] },
      },
    };
  }
  function observe(connection: LocalNetworkConnection, send: Send, message: Snapshot) {
    if (connection.networkScopeId === null || message.projectionRole !== 'player') return;
    const delivery = bind(connection, send);
    delivery.mode = 'LEGACY';
    delivery.source = peaceSource(message);
    delivery.revision = message.revisions.projectionRevision;
  }
  async function curtain(
    connection: LocalNetworkConnection,
    delivery: Delivery,
    correlationId: string,
    reason: 'FORM_ACTION' | 'RECONNECT' | 'COMMAND_DESTINATION',
  ) {
    const state = readOrdinarySeatHandoff(dependencies.db, dependencies.owner(connection)),
      p = state.pendingOrNull;
    if (state.rosterOrNull !== null && supported(connection)) {
      const source = state.rosterOrNull;
      const binding =
        readOrdinarySeatBinding(
          dependencies.db,
          dependencies.owner(connection),
          source.sourceSeatId,
        ) ?? unavailable();
      connection.networkScopeId = binding.networkScopeId;
      connection.contextId = source.sourceContextId;
      let snapshotSource: Source | null = null;
      try {
        snapshotSource = peaceSource(dependencies.peek(connection, correlationId, 'RECONNECT'));
        if (!snapshotSource) {
          const restored = await dependencies.target(
            connection,
            binding,
            source.sourceContextId,
            correlationId,
            reason,
          );
          snapshotSource = peaceSource(restored.snapshot);
        }
      } catch {
        /* The confirmed neutral roster remains readable while its peer is offline. */
      }
      const confirmed =
        snapshotSource?.sceneId === source.sceneId && snapshotSource.seatId === source.sourceSeatId
          ? snapshotSource
          : null;
      roster(connection, delivery, correlationId, confirmed, reason, source.sourceSeatId);
      return;
    }
    if (p === null || !supported(connection)) {
      show(connection, delivery, correlationId, reason, {
        ordinarySeatView: 'WAITING',
        revision: state.revision,
      });
      return;
    }
    const owner = dependencies.owner(connection),
      binding = readOrdinarySeatBinding(dependencies.db, owner, p.targetSeatId) ?? unavailable();
    const targetOrdinal =
      readOrdinarySeatRoster(dependencies.db, owner, binding.campaignId).find(
        (row) => row.localControllerSeatId === p.targetSeatId,
      )?.ordinal ?? unavailable();
    show(
      connection,
      delivery,
      correlationId,
      reason,
      {
        ordinarySeatView: 'CURTAIN',
        revision: state.revision,
        handoffId: p.handoffId,
        targetSeatId: p.targetSeatId,
        targetOrdinal,
        sourceSeatIdOrNull: p.sourceSeatIdOrNull,
        signedReturnContext: p.signedReturnContext,
        pendingCommandOwner: p.pendingCommandOwner,
      },
      ['PLY-030::CTA::001'],
    );
  }
  function roster(
    connection: LocalNetworkConnection,
    delivery: Delivery,
    correlationId: string,
    source: Source | null,
    reason: PresentationAssignmentReason = 'FORM_ACTION',
    activeId: string | null = source?.seatId ?? null,
  ) {
    const owner = dependencies.owner(connection),
      state = readOrdinarySeatHandoff(dependencies.db, owner);
    const campaign =
      activeId !== null
        ? (source?.campaignId ??
          readOrdinarySeatBinding(dependencies.db, owner, activeId)?.campaignId ??
          unavailable())
        : undefined;
    const scene = source && readOrdinarySceneRoster(dependencies.db, owner, source);
    const rows =
      scene?.roster ??
      readOrdinarySeatRoster(dependencies.db, owner, campaign).map((r) => ({
        seatId: r.localControllerSeatId,
        ordinal: r.ordinal,
      }));
    const eligibleTargetSeatIds = scene?.eligibleTargetSeatIds ?? [];
    if (
      activeId === null
        ? rows.length !== 0
        : !rows.some((r) => r.seatId === activeId) || rows.length < 2
    )
      unavailable();
    delivery.source = source;
    delivery.activeProof = null;
    show(
      connection,
      delivery,
      correlationId,
      reason,
      {
        ordinarySeatView: 'ROSTER',
        revision: state.revision,
        roster: rows,
        activeSeatIdOrNull: activeId,
        ...(activeId === null ? {} : { eligibleTargetSeatIds }),
      },
      rows.length === 0
        ? ['PLY-027::CTA::005', 'PLY-027::CTA::006']
        : eligibleTargetSeatIds.length === 0
          ? []
          : ['PLY-027::CTA::003'],
    );
  }
  function setup(connection: LocalNetworkConnection, delivery: Delivery, correlationId: string) {
    const count = dependencies.selectedCount(connection),
      owner = dependencies.owner(connection),
      revision = readOrdinarySeatHandoff(dependencies.db, owner).revision;
    const actions: ActionKey[] = [];
    if (count < 3 && dependencies.canSelectLibrary(connection)) actions.push('APP-003::CTA::001');
    if (count > 0) actions.push('APP-003::CTA::002');
    if (count === 0 && readOrdinarySeatRoster(dependencies.db, owner).length === 0)
      actions.push('APP-003::CTA::004');
    show(
      connection,
      delivery,
      correlationId,
      'FORM_ACTION',
      { ordinarySeatView: 'SETUP', revision: revision, selectedCount: count },
      actions,
    );
  }
  function verifySource(
    connection: LocalNetworkConnection,
    source: Source | null,
    correlationId: string,
  ) {
    if (
      source === null ||
      connection.networkScopeId !== source.scopeId ||
      connection.contextId !== source.contextId
    )
      return unavailable();
    const current = peaceSource(dependencies.peek(connection, correlationId, 'FORM_ACTION'));
    if (
      !current ||
      current.seatId !== source.seatId ||
      current.revision !== source.revision ||
      current.sceneId !== source.sceneId
    )
      return unavailable();
    return source;
  }
  async function stageTarget(
    connection: LocalNetworkConnection,
    targetId: string,
    contextId: string,
    sceneId: string,
    correlationId: string,
    reason: 'FORM_ACTION' | 'COMMAND_DESTINATION' | 'RECONNECT',
  ) {
    const binding =
      readOrdinarySeatBinding(dependencies.db, dependencies.owner(connection), targetId) ??
      unavailable();
    const staged = await dependencies.target(connection, binding, contextId, correlationId, reason);
    const base = staged.snapshot.presentation.base;
    if (
      base.formId !== 'PLY-001' ||
      base.roleFilteredPayload['controllerSeat'] !== targetId ||
      base.roleFilteredPayload['campaignCharacterId'] !== binding.campaignCharacterId ||
      base.roleFilteredPayload['campaignId'] !== binding.campaignId ||
      base.roleFilteredPayload['contextId'] !== contextId ||
      peaceSource(staged.snapshot)?.sceneId !== sceneId
    )
      unavailable();
    return staged;
  }
  async function deliver(
    connection: LocalNetworkConnection,
    delivery: Delivery,
    key: string | null,
    correlationId: string,
    reason: 'RECONNECT' | 'COMMAND_DESTINATION',
    staged?: Awaited<ReturnType<typeof stageTarget>>,
    expectedReceiptId?: string,
  ) {
    const owner = dependencies.owner(connection),
      active = key === null ? null : readOrdinaryActiveSeat(dependencies.db, owner, key);
    if (
      active === null ||
      key === null ||
      (expectedReceiptId !== undefined && active.handoffReceiptId !== expectedReceiptId)
    ) {
      await curtain(connection, delivery, correlationId, reason);
      return;
    }
    const target =
      staged ??
      (await stageTarget(
        connection,
        active.localControllerSeatId,
        active.targetContextId,
        active.sceneId,
        correlationId,
        reason,
      ));
    const state = readOrdinarySeatHandoff(dependencies.db, dependencies.owner(connection));
    const row =
      readOrdinarySeatRoster(dependencies.db, owner, active.campaignId).find(
        (r) => r.localControllerSeatId === active.localControllerSeatId,
      ) ?? unavailable();
    if (
      state.activeSeatIdOrNull !== active.localControllerSeatId ||
      readOrdinaryActiveSeat(dependencies.db, owner, key)?.handoffReceiptId !==
        active.handoffReceiptId
    )
      unavailable();
    purgeOthers(connection, state.revision);
    connection.contextId = target.connection.contextId;
    connection.networkScopeId = target.connection.networkScopeId;
    const snapshot = target.snapshot;
    delivery.mode = 'ACTIVE';
    delivery.source = peaceSource(snapshot);
    delivery.activeProof = key;
    delivery.addressedHandoff = null;
    delivery.revision = snapshot.revisions.projectionRevision;
    const published = {
      ...snapshot,
      presentation: {
        ...snapshot.presentation,
        layers: [
          layer(
            'PLY-029',
            {
              ordinarySeatView: 'ACTIVE',
              revision: state.revision,
              seatId: row.localControllerSeatId,
              ordinal: row.ordinal,
              receiptId: active.handoffReceiptId,
            },
            [],
          ),
        ],
      },
    };
    delivery.send(published);
    dependencies.activePublished(connection, published, delivery.send);
  }
  function ownerPublication(
    connection: LocalNetworkConnection,
    send: Send,
    message: LocalNetworkHostMessage,
  ) {
    if (!journalExists) {
      send(message);
      if (message.messageType === 'projection.snapshot' && message.protocolVersion === 2)
        observe(connection, send, message);
      return;
    }
    const delivery = clients.get(connection);
    if (
      delivery?.mode !== 'ACTIVE' ||
      delivery.activeProof === null ||
      !connection.trusted() ||
      message.messageType !== 'projection.snapshot' ||
      message.protocolVersion !== 2
    )
      return;
    const owner = dependencies.owner(connection),
      active = readOrdinaryActiveSeat(dependencies.db, owner, delivery.activeProof);
    const source = peaceSource(message),
      state = readOrdinarySeatHandoff(dependencies.db, owner);
    if (
      !active ||
      !source ||
      source.contextId !== active.targetContextId ||
      source.seatId !== active.localControllerSeatId ||
      source.sceneId !== active.sceneId ||
      message.presentation.base.roleFilteredPayload['campaignCharacterId'] !==
        active.campaignCharacterId
    ) {
      show(connection, delivery, randomUUID(), 'HOST_SYSTEM_EVENT', {
        ordinarySeatView: 'WAITING',
        revision: state.revision,
      });
      return;
    }
    const row =
      readOrdinarySeatRoster(dependencies.db, owner, active.campaignId).find(
        (r) => r.localControllerSeatId === active.localControllerSeatId,
      ) ?? unavailable();
    delivery.source = source;
    delivery.revision = message.revisions.projectionRevision;
    send({
      ...message,
      presentation: {
        ...message.presentation,
        layers: [
          layer(
            'PLY-029',
            {
              ordinarySeatView: 'ACTIVE',
              revision: state.revision,
              seatId: row.localControllerSeatId,
              ordinal: row.ordinal,
              receiptId: active.handoffReceiptId,
            },
            [],
          ),
        ],
      },
    });
  }
  async function handle(
    message: LocalNetworkClientMessage,
    connection: LocalNetworkConnection,
    shell: LocalNetworkShell,
    send: Send,
  ): Promise<boolean> {
    const navigation = message.messageType === 'navigation.form-action' ? message : null;
    const ack =
      message.messageType === 'command.request' &&
      message.commandKind === 'workflow-command' &&
      message.workflowCommandId === ORDINARY_SEAT_ACK
        ? message
        : null;
    const control = message.messageType === 'ordinary.seat.control' ? message : null;
    const local = clients.get(connection);
    const entry =
      navigation?.actionKey === 'NET-003::CTA::004' || navigation?.actionKey === switchAction;
    if (!entry && !control && !ack && (!local || local.mode === 'LEGACY') && !locked(connection))
      return false;
    let revision = 0;
    let committed = false;
    try {
      const owner = dependencies.owner(connection);
      const durable = journalExists;
      if (control?.operation === 'RESUME' && !durable) return true;
      const delivery = bind(connection, send);
      revision = delivery.revision;
      if (
        message.messageType === 'session.reconnect' ||
        message.messageType === 'network.local-context.resume'
      ) {
        if (
          !durable &&
          (delivery.mode === 'LEGACY' || delivery.mode === 'SETUP' || delivery.mode === 'LIBRARY')
        )
          return false;
        if (message.messageType === 'session.reconnect' && message.deviceId !== owner)
          unavailable();
        const executable = NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS.filter((correlationId) =>
          message.supportedWorkflowCommandIds.includes(correlationId),
        );
        connection.executableWorkflowCommandIds = executable;
        shell.enterNetwork();
        const state = readOrdinarySeatHandoff(dependencies.db, owner);
        send({
          messageType: 'session.reconnect.capabilities',
          protocolVersion: 2,
          reconnectRequestId: message.reconnectRequestId,
          executableWorkflowCommandIds: executable,
          revisions: revisions(state.revision),
        });
        await curtain(connection, delivery, message.reconnectRequestId, 'RECONNECT');
        return true;
      }
      if (!supported(connection)) unavailable();
      if (
        message.messageType === 'network.peer-control' &&
        delivery.mode === 'ACTIVE' &&
        delivery.activeProof !== null &&
        connection.contextId === message.contextId &&
        connection.networkScopeId === message.networkScopeId &&
        readOrdinaryActiveSeat(dependencies.db, owner, delivery.activeProof)?.networkScopeId ===
          message.networkScopeId
      )
        return false;
      if (ack) {
        if (ack.role !== 'player') unavailable();
        const payload = ordinarySeatAckPayloadValue(ack.payload),
          expected = ack.expectedRevisions;
        if (
          expected.actorVisibilityRevision !== expected.stateRevision ||
          expected.projectionRevision !== expected.stateRevision
        )
          unavailable();
        const key = proof(payload.deliveryKey),
          state = readOrdinarySeatHandoff(dependencies.db, owner);
        const fresh = state.revision === expected.stateRevision;
        let staged: Awaited<ReturnType<typeof stageTarget>> | undefined;
        if (fresh) {
          const pending = state.pendingOrNull;
          if (
            !pending ||
            delivery.addressedHandoff !== payload.handoffId ||
            pending.targetSeatId !== payload.targetSeatId ||
            pending.signedReturnContext !== payload.signedReturnContext
          )
            return unavailable();
          staged = await stageTarget(
            connection,
            payload.targetSeatId,
            pending.targetContextId,
            pending.sceneId,
            ack.commandId,
            'COMMAND_DESTINATION',
          );
        }
        const { receipt, replayed } = commitOrdinarySeatHandoff(
          dependencies.db,
          owner,
          {
            kind: 'ACK',
            commandId: ack.commandId,
            expectedRevision: expected.stateRevision,
            handoffId: payload.handoffId,
            targetSeatId: payload.targetSeatId,
            decision: payload.decision,
            signedReturnContext: payload.signedReturnContext,
            recipientProof: key,
          },
          (_s, phase) => {
            if (
              dependencies.owner(connection) !== owner ||
              (phase === 'APPLY' && (!staged || delivery.addressedHandoff !== payload.handoffId))
            )
              unavailable();
          },
        );
        committed = true;
        const wire = {
          commandId: receipt.commandId,
          receiptId: receipt.receiptId,
          revisions: revisions(receipt.revision),
          result: {
            receiptId: receipt.receiptId,
            handoffId: receipt.handoffId,
            targetSeatId: payload.targetSeatId,
            decision: payload.decision,
          },
        };
        send(
          replayed
            ? {
                messageType: 'command.replay',
                protocolVersion: 1,
                lifecycleState: 'IDEMPOTENT_REPLAY',
                receipt: wire,
              }
            : {
                messageType: 'command.result',
                protocolVersion: 1,
                lifecycleState: 'COMMITTED',
                receipt: wire,
              },
        );
        await deliver(
          connection,
          delivery,
          key,
          ack.commandId,
          'COMMAND_DESTINATION',
          staged,
          receipt.receiptId,
        );
        return true;
      }
      if (control?.operation === 'RESUME') {
        await deliver(
          connection,
          delivery,
          control.deliveryKeyOrNull === null ? null : proof(control.deliveryKeyOrNull),
          control.requestId,
          'RECONNECT',
        );
        return true;
      }
      if (control?.operation === 'RETURN_LIBRARY') {
        if (
          durable ||
          delivery.mode !== 'LIBRARY' ||
          delivery.libraryOriginId === null ||
          delivery.revision !== control.expectedProjectionRevision
        )
          return unavailable();
        dependencies.candidateLibrary.apply(connection, delivery.libraryOriginId, control);
        committed = true;
        setup(connection, delivery, control.requestId);
        return true;
      }
      if (control?.operation === 'SELECT') {
        if (delivery.mode !== 'ROSTER' || delivery.revision !== control.expectedProjectionRevision)
          unavailable();
        const previous = delivery.source ?? unavailable();
        const handoff = readOrdinarySeatHandoff(dependencies.db, owner);
        const roster = handoff.rosterOrNull;
        if (
          handoff.revision !== control.expectedProjectionRevision ||
          roster?.sourceSeatId !== previous.seatId ||
          roster.sourceContextId !== previous.contextId ||
          roster.sceneId !== previous.sceneId ||
          connection.networkScopeId !== previous.scopeId ||
          connection.contextId !== previous.contextId
        )
          unavailable();
        const { source, sameReceipt } = await dependencies.confirmSource(
          connection,
          previous,
          control.targetSeatId,
          control.requestId,
        );
        if (
          dependencies.owner(connection) !== owner ||
          connection.networkScopeId !== source.scopeId ||
          connection.contextId !== source.contextId ||
          !readOrdinarySceneRoster(dependencies.db, owner, source).eligibleTargetSeatIds.includes(
            control.targetSeatId,
          )
        )
          unavailable();
        const targetContextId = randomUUID();
        // One signed ACCEPT already binds both tabs to the verified Start roster.
        // Independent admissions need their own scene proof before BEGIN.
        if (!sameReceipt)
          await stageTarget(
            connection,
            control.targetSeatId,
            targetContextId,
            source.sceneId,
            control.requestId,
            'FORM_ACTION',
          );
        commitOrdinarySeatHandoff(
          dependencies.db,
          owner,
          {
            kind: 'BEGIN',
            commandId: control.requestId,
            expectedRevision: delivery.revision,
            sourceSeatIdOrNull: source.seatId,
            targetSeatId: control.targetSeatId,
            sourceContextId: source.contextId,
            targetContextId,
            sceneId: source.sceneId,
            pendingCommandOwner: null,
            activeProofOrNull: delivery.activeProof,
          },
          () => {
            const now = peaceSource(
              dependencies.peek(connection, control.requestId, 'FORM_ACTION'),
            );
            if (
              dependencies.owner(connection) !== owner ||
              now?.contentHash !== source.contentHash ||
              now.scopeId !== source.scopeId ||
              (sameReceipt &&
                (now.revision !== source.revision ||
                  now.stateRevision !== source.stateRevision ||
                  now.actorVisibilityRevision !== source.actorVisibilityRevision)) ||
              !readOrdinarySceneRoster(dependencies.db, owner, now).eligibleTargetSeatIds.includes(
                control.targetSeatId,
              )
            )
              unavailable();
          },
        );
        journalExists = true;
        committed = true;
        purgeOthers(connection, delivery.revision + 1);
        await curtain(connection, delivery, control.requestId, 'FORM_ACTION');
        return true;
      }
      if (!navigation || navigation.expectedProjectionRevision !== delivery.revision)
        return unavailable();
      const correlationId = navigation.navigationRequestId;
      if (
        navigation.actionKey === switchAction &&
        navigation.sourceFormId === 'PLY-001' &&
        (delivery.mode === 'ACTIVE' || (delivery.mode === 'LEGACY' && !durable))
      ) {
        const source = verifySource(connection, delivery.source, correlationId);
        const state = readOrdinarySeatHandoff(dependencies.db, owner);
        const receipt = commitOrdinarySeatHandoff(
          dependencies.db,
          owner,
          {
            kind: 'ROSTER',
            commandId: correlationId,
            expectedRevision: state.revision,
            sourceSeatIdOrNull: source.seatId,
            targetSeatId: source.seatId,
            sourceContextId: source.contextId,
            sceneId: source.sceneId,
            pendingCommandOwner: null,
            activeProofOrNull: delivery.activeProof,
          },
          () => {
            if (
              dependencies.owner(connection) !== owner ||
              !dependencies
                .peek(connection, correlationId, 'FORM_ACTION')
                .presentation.base.availableActionKeys.includes(switchAction)
            )
              unavailable();
            verifySource(connection, source, correlationId);
          },
        ).receipt;
        journalExists = true;
        committed = true;
        purgeOthers(connection, receipt.revision);
        roster(connection, delivery, correlationId, source);
        return true;
      }
      if (!durable) {
        if (
          navigation.actionKey === 'NET-003::CTA::004' &&
          navigation.sourceFormId === 'NET-003' &&
          delivery.mode === 'LEGACY'
        ) {
          const peek = dependencies.peek(connection, correlationId, 'FORM_ACTION');
          if (
            peek.presentation.base.formId !== 'NET-003' ||
            !peek.presentation.base.availableActionKeys.includes('NET-003::CTA::004') ||
            peek.revisions.projectionRevision !== navigation.expectedProjectionRevision
          )
            unavailable();
          setup(connection, delivery, correlationId);
          return true;
        }
        if (navigation.sourceFormId === 'APP-003' && delivery.mode === 'SETUP') {
          const count = dependencies.selectedCount(connection);
          if (
            navigation.actionKey === 'APP-003::CTA::001' &&
            count < 3 &&
            dependencies.canSelectLibrary(connection)
          ) {
            const library = dependencies.candidateLibrary.open(connection, correlationId);
            delivery.libraryOriginId = correlationId;
            show(connection, delivery, correlationId, 'FORM_ACTION', library, [
              'APP-004::CTA::002',
            ]);
            return true;
          }
          if (navigation.actionKey === 'APP-003::CTA::004' && count === 0) {
            roster(connection, delivery, correlationId, null);
            return true;
          }
          if (navigation.actionKey === 'APP-003::CTA::002' && count > 0) {
            const next = dependencies.peek(connection, correlationId, 'FORM_ACTION');
            if (next.presentation.base.formId !== 'NET-003') unavailable();
            observe(connection, send, next);
            send(next);
            return true;
          }
        }
        if (
          navigation.sourceFormId === 'APP-004' &&
          navigation.actionKey === 'APP-004::CTA::002' &&
          delivery.mode === 'LIBRARY'
        ) {
          if (delivery.libraryOriginId === null) return unavailable();
          dependencies.candidateLibrary.cancel(connection, delivery.libraryOriginId);
          setup(connection, delivery, correlationId);
          return true;
        }
        if (
          navigation.sourceFormId === 'PLY-027' &&
          delivery.mode === 'ROSTER' &&
          delivery.source === null &&
          readOrdinarySeatRoster(dependencies.db, owner).length === 0
        ) {
          if (navigation.actionKey === 'PLY-027::CTA::005') {
            setup(connection, delivery, correlationId);
            return true;
          }
          if (navigation.actionKey === 'PLY-027::CTA::006') {
            dependencies.resetEmptySetup(connection, navigation);
            const next = await shell.exitToPlayer(correlationId);
            forget(connection);
            connection.contextId = null;
            connection.networkScopeId = null;
            send(next);
            return true;
          }
        }
      }
      unavailable();
    } catch (error) {
      if (committed) throw error;
      if (ack)
        send({
          messageType: 'command.refusal',
          protocolVersion: 1,
          commandId: ack.commandId,
          lastLifecycleState: null,
          revisions: revisions(revision),
          refusal:
            error instanceof NetworkApplicationStoreError && error.code === 'IDEMPOTENCY_CONFLICT'
              ? {
                  code: 'IDEMPOTENCY_CONFLICT',
                  commandId: ack.commandId,
                  detail: 'PAYLOAD_MISMATCH',
                }
              : { code: 'GUARD_REJECTED' },
        });
      else if (
        navigation ||
        control?.operation === 'RETURN_LIBRARY' ||
        control?.operation === 'SELECT'
      )
        send({
          messageType: 'navigation.form-action.refusal',
          protocolVersion: 2,
          navigationRequestId: navigation?.navigationRequestId ?? control!.requestId,
          revisions: revisions(revision),
          presentationUnchanged: true,
          refusal: { code: 'NAVIGATION_UNAVAILABLE' },
        });
      else
        send({
          messageType: 'protocol.refusal',
          protocolVersion: 1,
          relatedCommandId: null,
          refusal: { code: 'UNRECOGNIZED', path: '$.ordinarySeat', value: null },
        });
    }
    return true;
  }
  return {
    handle,
    decorate,
    observe,
    locked,
    forget,
    ownerPublication,
    observeLocalShell: (connection: LocalNetworkConnection, send: Send) => {
      if (!journalExists && connection.trusted() && connection.networkScopeId === null)
        bind(connection, send);
    },
    inSeatView: (connection: LocalNetworkConnection) => {
      const delivery = clients.get(connection);
      return delivery !== undefined && delivery.mode !== 'LEGACY';
    },
    canCache: (connection: LocalNetworkConnection) =>
      !journalExists || clients.get(connection)?.mode === 'ACTIVE',
    close: () => clients.clear(),
  };
}
