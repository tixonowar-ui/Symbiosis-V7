import { createHash, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActionKey, FormId } from '@generated/types/atlas.js';
import {
  hostLocalNetworkFixture as net,
  setupNetworkFixture,
} from '../../tests/fixtures/network-application-scenarios.js';
import {
  createHostLocalRequestSite,
  prepareHostLocalCandidateSite,
  submitPreparedHostLocalRequestSite,
} from '../../tests/fixtures/host-local-request-site.js';
import {
  readActiveLocalNetworkTab,
  readLocalNetworkTabClosure,
  readLocalNetworkTabEntryByCommandId,
} from '../persistence/network-local-tab.js';
import { readLocalNetworkApplication } from '../persistence/network-local-application.js';
import { readHostLocalRoster } from '../persistence/local-seat-roster.js';
import type {
  CommandReceipt,
  JsonObject,
  WorkflowCommandId,
  WorkflowCommandRequestMessage,
} from '../shared/wire-protocol.js';
import {
  ackHostLocalSeatHandoff,
  readHostLocalOwnedCharacters,
  readHostLocalSeatHandoff,
  readHostLocalProfileScope,
  readHostLocalScopeOwner,
  selectHostLocalFinals,
} from '../persistence/host-local-seat.js';
import { HOST_OWNER_PROFILE_CREATE, HOST_SEAT_ACK } from '../shared/host-seat.js';
import { CAMPAIGN_LIFECYCLE_WORKFLOW_IDS } from '../shared/campaign-lifecycle.js';
import { encodeHostMessageV2 } from '../shared/wire-v2-codec.js';
import type { ProjectionSnapshotV2Message } from '../shared/wire-v2-protocol.js';
import { loadProtocolVocabulary } from './protocol-vocabulary.js';
import type { LocalNetworkHostMessage } from './network-application.js';
import { createHostLocalSeatRuntime, type HostSeatClient } from './host-local-seat-runtime.js';
import { hostSeatSnapshot, hostSeatVector } from './host-local-seat-presentation.js';

setupNetworkFixture('host-local-application-returns');
async function enterFirstHostSetup() {
  const p = await net.client(),
    h = await net.host({ path: p.path }),
    gm = net.gmClient(h);
  const vocabulary = await loadProtocolVocabulary(process.cwd());
  gm.c.executableReview = [
    ...(gm.c.executableReview ?? []),
    ...CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
    'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
    'UI-CMD-CAMPAIGN-START',
    HOST_SEAT_ACK,
    HOST_OWNER_PROFILE_CREATE,
  ];
  const sent: LocalNetworkHostMessage[] = [];
  const closed = (): never => {
    throw new Error('Unexpected branch while opening GM setup');
  };
  const socket: HostSeatClient = {
    network: p.c,
    campaign: gm.c,
    trusted: () => true,
    characterContextId: () => null,
    capabilities: () => [HOST_SEAT_ACK, HOST_OWNER_PROFILE_CREATE],
    replayReceipts: closed,
    revoke: () => {
      p.runtimeForTest.disconnect(p.c);
    },
    restoreGm: closed,
    openOwnedLibrary: closed,
    send: (m) => {
      if (m.messageType === 'projection.snapshot' && m.protocolVersion === 2) {
        const wire = encodeHostMessageV2(m, vocabulary);
        if (!wire.ok) throw Error(JSON.stringify(wire.refusal));
      }
      sent.push(m);
    },
  };
  const runtime = createHostLocalSeatRuntime({
    db: h.db,
    network: p.runtimeForTest,
    heldNetworkConfiguration: h.runtime.heldNetworkConfiguration,
    conflictingOperationPending: (campaignId) => {
      const gmWork = gm.gmScheduler.pendingCounts(
        campaignId,
        gm.gmScheduler.currentToken(campaignId),
      );
      return (
        gmWork.queuedCommandCount +
          gmWork.executingCommandCount +
          h.runtime.operationCounts(campaignId).pendingOperationCount >
        0
      );
    },
    readApplicant: gm.runtime.hostSeatApplicant,
    readScene: gm.runtime.hostSeatScene,
  });
  const nav = async (
    sourceFormId: FormId,
    actionKey: ActionKey,
    expectedProjectionRevision: number,
  ) => {
    const m = {
      messageType: 'navigation.form-action' as const,
      protocolVersion: 2 as const,
      navigationRequestId: randomUUID(),
      sourceFormId,
      actionKey,
      expectedProjectionRevision,
    };
    if (!(await runtime.handle(socket, m))) {
      await gm.send(m);
      const result = gm.sent.find(
        (x) => x.messageType === 'projection.snapshot' && x.protocolVersion === 2,
      );
      if (result?.messageType !== 'projection.snapshot' || result.protocolVersion !== 2)
        throw new Error('Missing GM destination for ' + actionKey);
      sent.push(runtime.decorate(socket, result) ?? closed());
    }
    const response = sent.at(-1);
    expect(response).toMatchObject({
      messageType: 'projection.snapshot',
      presentation: { assignment: { correlationId: m.navigationRequestId } },
    });
    return response as ProjectionSnapshotV2Message;
  };
  await gm.nav();
  await gm.nav(false);
  const native = await gm.campaign.project(gm.c);
  const campaign = await nav('CMP-006', 'CMP-006::CTA::001', native.revisions.projectionRevision);
  let settings = await nav('CMP-007', 'CMP-007::CTA::003', campaign.revisions.projectionRevision);
  expect(settings.presentation.base.availableActionKeys).toContain('CMP-008::CTA::001');
  // Another connection with the current GM grant can advance the persisted cursor before this click.
  await gm.send({
    messageType: 'navigation.form-action',
    protocolVersion: 2,
    navigationRequestId: randomUUID(),
    sourceFormId: 'CMP-008',
    actionKey: 'CMP-008::CTA::009',
    expectedProjectionRevision: settings.revisions.projectionRevision,
  });
  const advanced = gm.sent.find(
    (m) => m.messageType === 'projection.snapshot' && m.protocolVersion === 2,
  );
  if (advanced?.messageType !== 'projection.snapshot' || advanced.protocolVersion !== 2)
    throw Error('Missing advanced GM cursor');
  const stale = randomUUID();
  await runtime.handle(socket, {
    messageType: 'navigation.form-action',
    protocolVersion: 2,
    navigationRequestId: stale,
    sourceFormId: 'CMP-008',
    actionKey: 'CMP-008::CTA::001',
    expectedProjectionRevision: settings.revisions.projectionRevision,
  });
  expect(sent.at(-1)).toMatchObject({
    messageType: 'navigation.form-action.refusal',
    navigationRequestId: stale,
    presentationUnchanged: true,
  });
  expect(runtime.enabled()).toBe(false);
  settings = await nav('CMP-007', 'CMP-007::CTA::003', advanced.revisions.projectionRevision);
  const manage = await nav('CMP-008', 'CMP-008::CTA::001', settings.revisions.projectionRevision);
  expect(manage.presentation.base).toMatchObject({
    formId: 'CMP-009',
    roleFilteredPayload: { hostSeatView: 'MANAGE', campaignId: h.campaignId, seats: [] },
  });
  const setupId = randomUUID();
  expect(
    await runtime.handle(socket, {
      messageType: 'host.seat.control',
      protocolVersion: 3,
      operation: 'ENTER_SETUP',
      requestId: setupId,
      expectedProjectionRevision: manage.revisions.projectionRevision,
      deliveryKey: '8'.repeat(64),
    }),
  ).toBe(true);
  expect(sent.at(-1)).toMatchObject({
    messageType: 'projection.snapshot',
    presentation: {
      base: { formId: 'APP-003', roleFilteredPayload: { hostSeatView: 'SETUP', profiles: [] } },
      assignment: { correlationId: setupId },
    },
  });
  expect(runtime.decorate(socket, settings)).toBeNull();
  return { runtime, socket, sent, h, nav };
}

it('opens CMP-009 from the confirmed CMP-008 GM cursor and erases its private settings at setup', async () => {
  await enterFirstHostSetup();
}, 60_000);

it.each([HOST_SEAT_ACK, HOST_OWNER_PROFILE_CREATE])(
  'requires the negotiated host workflow %s for a new command and replays its exact historical receipt',
  async (workflow) => {
    const { runtime, socket, sent, h, nav } = await enterFirstHostSetup();
    const restrictedFrames: LocalNetworkHostMessage[] = [];
    const restrictedSocket: HostSeatClient = {
      ...socket,
      network: { ...socket.network },
      campaign: { ...socket.campaign },
      send: (message) => {
        restrictedFrames.push(message);
      },
    };
    const isAck = workflow === HOST_SEAT_ACK;
    const state = () => readHostLocalSeatHandoff(h.db, h.principal.hostOwnerDeviceId);
    const durable = () => ({
      handoff: state(),
      events: h.db.prepare('SELECT COUNT(*) AS count FROM local_seat_handoff_event').get(),
    });
    const current = (frames = sent) => {
      const message = frames.at(-1);
      if (message?.messageType !== 'projection.snapshot' || message.protocolVersion !== 2)
        throw new Error('Missing host seat presentation');
      return message;
    };
    const resume = async (supportedWorkflowCommandIds: readonly WorkflowCommandId[]) => {
      restrictedFrames.length = 0;
      const requestId = randomUUID();
      await runtime.handle(restrictedSocket, {
        protocolVersion: 3,
        messageType: 'host.seat.control',
        operation: 'RESUME',
        requestId,
        deliveryKeyOrNull: isAck ? null : '8'.repeat(64),
        supportedWorkflowCommandIds,
        unacknowledgedCommandIds: [],
      });
      expect(restrictedFrames[0]).toMatchObject({
        messageType: 'session.reconnect.capabilities',
        reconnectRequestId: requestId,
        executableWorkflowCommandIds: supportedWorkflowCommandIds,
      });
      return current(restrictedFrames);
    };
    const createRequest = () => ({
      protocolVersion: 1 as const,
      messageType: 'command.request' as const,
      commandKind: 'workflow-command' as const,
      workflowCommandId: HOST_OWNER_PROFILE_CREATE,
      commandId: randomUUID(),
      role: 'gm' as const,
      expectedRevisions: current().revisions,
      payload: { targetProfileLabel: 'Первый профиль' },
    });
    let request: WorkflowCommandRequestMessage;
    let action: ActionKey;
    if (isAck) {
      const create = createRequest();
      await runtime.handle(socket, create);
      await nav('APP-003', 'APP-003::CTA::013', current().revisions.projectionRevision);
      action = 'PLY-030::CTA::004';
      expect(current().presentation.layers.at(-1)?.availableActionKeys).toContain(action);
      const pending = state().pending!;
      request = {
        protocolVersion: 1 as const,
        messageType: 'command.request' as const,
        commandKind: 'workflow-command' as const,
        workflowCommandId: HOST_SEAT_ACK,
        commandId: randomUUID(),
        role: 'player' as const,
        expectedRevisions: current().revisions,
        payload: {
          handoffId: pending.handoffId,
          signedReturnContext: pending.signedReturnContext,
          decision: 'ACTIVATE_TARGET',
          deliveryKey: '9'.repeat(64),
        },
      };
    } else {
      request = createRequest();
      action = 'APP-003::CTA::011';
    }
    const without: readonly WorkflowCommandId[] = isAck ? [] : [HOST_SEAT_ACK];
    const restricted = await resume(without);
    const active = restricted.presentation.layers.at(-1) ?? restricted.presentation.base;
    expect.soft(active.availableActionKeys).not.toContain(action);
    const before = durable();
    restrictedFrames.length = 0;
    await runtime.handle(restrictedSocket, request);
    expect
      .soft(restrictedFrames)
      .toMatchObject([{ messageType: 'command.refusal', commandId: request.commandId }]);
    expect(durable()).toEqual(before);
    // The original socket still has its negotiated capabilities from the native GM to SETUP transition.
    sent.length = 0;
    await runtime.handle(socket, request);
    const result = sent[0];
    if (result?.messageType !== 'command.result')
      throw new Error('Missing confirmed command receipt');
    expect(result.receipt.commandId).toBe(request.commandId);
    const after = durable();
    expect(after.handoff.revision).toBe(before.handoff.revision + 1);
    await resume(without);
    restrictedFrames.length = 0;
    await runtime.handle(restrictedSocket, request);
    expect(restrictedFrames[0]).toMatchObject({
      messageType: 'command.replay',
      receipt: result.receipt,
    });
    expect(durable()).toEqual(after);
  },
  60_000,
);

it.each(['SETUP', 'CANDIDATE'] as const)(
  'keeps an otherwise valid %s key neutral without the negotiated host workflow ACK',
  async (phase) => {
    const { runtime, socket, sent, h, nav } = await enterFirstHostSetup();
    const state = () => readHostLocalSeatHandoff(h.db, h.principal.hostOwnerDeviceId);
    const setupKey = '8'.repeat(64),
      candidateKey = '9'.repeat(64);
    const create = {
      protocolVersion: 1,
      messageType: 'command.request',
      commandKind: 'workflow-command',
      commandId: randomUUID(),
      role: 'gm',
      workflowCommandId: HOST_OWNER_PROFILE_CREATE,
      expectedRevisions: hostSeatVector(state().revision),
      payload: { targetProfileLabel: 'Личный профиль' },
    } as const;
    await runtime.handle(socket, create);
    expect(state().profiles).toHaveLength(1);
    let ack: WorkflowCommandRequestMessage | undefined;
    let ackReceipt: CommandReceipt | undefined;
    if (phase === 'CANDIDATE') {
      await nav('APP-003', 'APP-003::CTA::013', state().revision);
      const pending = state().pending!;
      ack = {
        protocolVersion: 1,
        messageType: 'command.request',
        commandKind: 'workflow-command',
        commandId: randomUUID(),
        role: 'player',
        workflowCommandId: HOST_SEAT_ACK,
        expectedRevisions: hostSeatVector(state().revision),
        payload: {
          handoffId: pending.handoffId,
          signedReturnContext: pending.signedReturnContext,
          decision: 'ACTIVATE_TARGET',
          deliveryKey: candidateKey,
        },
      };
      await runtime.handle(socket, ack);
      const answer = sent.at(-1);
      if (answer?.messageType !== 'command.result') throw new Error('Missing candidate ACK');
      ackReceipt = answer.receipt;
    }
    const frames: LocalNetworkHostMessage[] = [];
    const privateReads: string[] = [];
    const revoked: string[] = [];
    const unexpected = (source: string): never => {
      privateReads.push(source);
      throw new Error('Unexpected private read: ' + source);
    };
    const receiver: HostSeatClient = {
      ...socket,
      network: { ...socket.network },
      campaign: { ...socket.campaign },
      send: (message) => {
        frames.push(message);
      },
      revoke: (scope?: string) => {
        revoked.push(scope ?? 'HANDOFF');
      },
      openOwnedLibrary: () => unexpected('library'),
      restoreGm: () => unexpected('gm'),
      replayReceipts: () => unexpected('receipts'),
    };
    const before = state();
    const revisions = hostSeatVector(before.revision);
    const requestId = randomUUID();
    await runtime.handle(receiver, {
      protocolVersion: 3,
      messageType: 'host.seat.control',
      operation: 'RESUME',
      requestId,
      deliveryKeyOrNull: phase === 'SETUP' ? setupKey : candidateKey,
      supportedWorkflowCommandIds: phase === 'SETUP' ? [HOST_OWNER_PROFILE_CREATE] : [],
      unacknowledgedCommandIds: [create.commandId],
    });
    expect.soft(privateReads).toEqual([]);
    expect.soft(revoked).toEqual(['CONNECTION']);
    expect.soft(frames).toEqual([
      {
        protocolVersion: 2,
        messageType: 'session.reconnect.capabilities',
        reconnectRequestId: requestId,
        executableWorkflowCommandIds: [],
        revisions,
      },
      hostSeatSnapshot(
        { hostSeatView: 'WAITING', revision: before.revision },
        requestId,
        'RECONNECT',
      ),
    ]);
    expect.soft(runtime.authority(receiver)).toEqual({ role: 'WAITING' });
    frames.length = 0;
    const freshCreate = { ...create, commandId: randomUUID(), expectedRevisions: revisions };
    await runtime.handle(receiver, freshCreate);
    expect
      .soft(frames)
      .toMatchObject([{ messageType: 'command.refusal', commandId: freshCreate.commandId }]);
    frames.length = 0;
    if (ack) {
      await runtime.handle(receiver, ack);
      expect(frames).toMatchObject([{ messageType: 'command.replay', receipt: ackReceipt }]);
    } else {
      await runtime.handle(receiver, create);
      expect(frames).toMatchObject([
        { messageType: 'command.refusal', commandId: create.commandId },
      ]);
    }
    expect(state()).toEqual(before);
  },
  60_000,
);

it('recovers the original APP-003 entry after the scoped tab committed before OPEN', async () => {
  const { p, h, gm, state, device, profile, origin, initial, ids } =
    await prepareHostLocalCandidateSite(1);
  const nav = {
    messageType: 'navigation.form-action',
    protocolVersion: 2,
    sourceFormId: 'APP-003',
    actionKey: 'APP-003::CTA::009',
    navigationRequestId: randomUUID(),
    expectedProjectionRevision: state().revision,
  } as const;
  await expect(
    p.runtimeForTest.enterHostCandidate(
      p.c,
      origin,
      createHash('sha256').update(initial.key).digest('hex'),
      ids,
      nav,
      { hostAddress: '127.0.0.1', hostPort: h.port },
      () => {
        if (
          !p.db.inTransaction &&
          state().active?.kind === 'CANDIDATE' &&
          state().candidateSelectionOrNull?.networkEntry
        )
          throw Error('Interrupted after the candidate network entry commit');
      },
    ),
  ).rejects.toThrow('Interrupted after the candidate network entry commit');
  const saved = readLocalNetworkTabEntryByCommandId(p.db, device, nav.navigationRequestId)!;
  expect(saved.receipt.sourceContextId).toBe(profile.targetLocalOwnerId);
  p.reopenShell(null);
  const messages: LocalNetworkHostMessage[] = [];
  const closed = (): never => {
    throw Error('Unexpected foreign context');
  };
  const client: HostSeatClient = {
    network: p.c,
    campaign: gm.c,
    send: (m) => messages.push(m),
    trusted: () => true,
    revoke: () => {},
    characterContextId: () => null,
    capabilities: () => [HOST_SEAT_ACK, 'UI-CMD-CONNECTION-OPEN'],
    restoreGm: closed,
    openOwnedLibrary: closed,
    replayReceipts: closed,
  };
  const coordinator = createHostLocalSeatRuntime({
    db: p.db,
    network: p.runtimeForTest,
    heldNetworkConfiguration: h.runtime.heldNetworkConfiguration,
    conflictingOperationPending: () => false,
    readApplicant: gm.runtime.hostSeatApplicant,
    readScene: gm.runtime.hostSeatScene,
  });
  const resume = async (key: string | null) => {
    const id = randomUUID();
    expect(
      await coordinator.handle(client, {
        messageType: 'host.seat.control',
        protocolVersion: 3,
        operation: 'RESUME',
        requestId: id,
        deliveryKeyOrNull: key,
        supportedWorkflowCommandIds: [HOST_SEAT_ACK, 'UI-CMD-CONNECTION-OPEN'],
        unacknowledgedCommandIds: [],
      }),
    ).toBe(true);
    const m = messages.at(-1);
    expect(m).toMatchObject({
      messageType: 'projection.snapshot',
      presentation: { assignment: { correlationId: id, reason: 'RECONNECT' } },
    });
    return m as ProjectionSnapshotV2Message;
  };
  expect((await resume(null)).presentation.base.roleFilteredPayload).toMatchObject({
    hostSeatView: 'WAITING',
  });
  expect((await resume(initial.key)).presentation.base.formId).toBe('NET-003');
  expect(p.state().selectedCandidates.map((ref) => ref.sourceUuid)).toEqual(ids);
  expect(p.runtimeForTest.hostCandidateEntryComplete(p.scope(), nav, ids)).toBe(true);
  const session = p.state().sessionOrNull;
  expect(session?.campaignProof.campaignId).toBe(origin.campaignId);
  expect((await resume(initial.key)).presentation.base.formId).toBe('NET-003');
  expect(p.state().sessionOrNull).toEqual(session);
  expect(
    readLocalNetworkTabEntryByCommandId(p.db, device, nav.navigationRequestId)?.receipt,
  ).toEqual(saved.receipt);
  expect(state().active).toMatchObject({
    kind: 'CANDIDATE',
    profile,
    networkScopeIdOrNull: saved.receipt.networkScopeId,
  });
  await p.nav('NET-003::CTA::001');
  expect(p.sent[0]).toMatchObject({
    messageType: 'projection.snapshot',
    presentation: { base: { formId: 'NET-004' } },
  });
  expect(
    p.state().preparedBatchOrNull?.candidates.map((candidate) => candidate.descriptor.sourceUuid),
  ).toEqual(ids);
}, 60_000);

describe('provisional owner returns before SUBMIT', () => {
  type Candidate = Awaited<ReturnType<typeof prepareHostLocalCandidateSite>>;
  const sites: Candidate[] = [];
  let gmKey: string;
  beforeEach(() => {
    sites.length = 0;
  });
  for (let i = 0; i < 3; i++) {
    beforeEach(async () => {
      const site = await prepareHostLocalCandidateSite(1, sites[0]);
      sites.push(site);
      const { p, h, gm, device, origin, profile } = site;
      gm.c.executableReview = [
        ...(gm.c.executableReview ?? []),
        ...CAMPAIGN_LIFECYCLE_WORKFLOW_IDS,
        HOST_SEAT_ACK,
        HOST_OWNER_PROFILE_CREATE,
      ];
      const control = site.coordinator();
      expect((await control.resume(site.initial.key)).presentation.base.formId).toBe('APP-003');
      const connected = await control.navigate('APP-003', 'APP-003::CTA::009');
      expect(connected.presentation.base.formId).toBe('NET-003');
      const scope = p.scope().networkScopeId;
      expect(p.state().sessionOrNull?.campaignProof.campaignId).toBe(h.campaignId);
      expect(p.state().requestOrNull).toBeNull();
      await control.navigate('NET-003', 'NET-003::CTA::004');
      const curtain = await control.navigate('APP-003', 'APP-003::CTA::014');
      expect(curtain.presentation.layers.at(-1)?.roleFilteredPayload).toMatchObject({
        target: { kind: 'GM' },
        decision: 'RETURN_INITIATOR',
      });
      expect(readLocalNetworkTabClosure(p.db, device, scope)).not.toBeNull();
      expect(readHostLocalScopeOwner(p.db, device, scope)).toBe(profile.targetLocalOwnerId);
      expect(
        readHostLocalProfileScope(p.db, device, profile.targetLocalOwnerId, origin.campaignId),
      ).toBeNull();
      const result = await control.acceptGmReturn('RETURN_INITIATOR');
      gmKey = result.key;
      expect(result.snapshot.presentation.base.roleFilteredPayload).toMatchObject({
        hostSeatView: 'MANAGE',
        seats: [],
        returnedProfiles: sites.map((x) => x.profile),
      });
      expect(readHostLocalOwnedCharacters(p.db, device, profile.targetLocalOwnerId)).toEqual(
        site.ids,
      );
    }, 60_000);
  }
  it('reopens the first selected owner after three closed tabs and retains only that owner’s original FINALs', async () => {
    const first = sites[0]!;
    const { p, h, device, origin } = first;
    p.reopenShell(null);
    const control = first.coordinator();
    const current = await control.resume(gmKey);
    expect(current.presentation.base.availableActionKeys).toContain('CMP-009::CTA::004');
    const id = randomUUID();
    expect(
      await control.runtime.handle(control.socket, {
        messageType: 'host.seat.control',
        protocolVersion: 3,
        operation: 'RESUME_PROFILE',
        requestId: id,
        expectedProjectionRevision: current.revisions.projectionRevision,
        targetLocalOwnerId: first.profile.targetLocalOwnerId,
      }),
    ).toBe(true);
    const curtain = control.view();
    expect(curtain.presentation.assignment.correlationId).toBe(id);
    expect(curtain.presentation.layers.at(-1)?.roleFilteredPayload).toMatchObject({
      hostSeatView: 'CURTAIN',
      target: { kind: 'CANDIDATE', ...first.profile },
    });
    expect(first.state().active).toBeNull();
    const pending = first.state().pending!;
    const ack = {
      commandId: randomUUID(),
      expectedRevision: first.state().revision,
      handoffId: pending.handoffId,
      signedReturnContext: pending.signedReturnContext,
      role: 'player' as const,
      decision: 'ACTIVATE_TARGET' as const,
      recipientProof: createHash('sha256').update(randomUUID()).digest('hex'),
    };
    const saved = ackHostLocalSeatHandoff(p.db, device, ack, () => undefined);
    expect(ackHostLocalSeatHandoff(p.db, device, ack, () => undefined)).toEqual({
      receipt: saved.receipt,
      replayed: true,
    });
    expect(first.state().active).toMatchObject({ kind: 'CANDIDATE', profile: first.profile });
    expect(first.state().candidateSelectionOrNull).toMatchObject({
      formId: 'APP-004',
      selectedSourceUuids: [],
    });
    expect(readHostLocalOwnedCharacters(p.db, device, first.profile.targetLocalOwnerId)).toEqual(
      first.ids,
    );
    selectHostLocalFinals(
      p.db,
      device,
      {
        commandId: randomUUID(),
        expectedRevision: first.state().revision,
        activeProof: ack.recipientProof,
        formId: 'APP-003',
        selectedSourceUuids: first.ids,
      },
      () => undefined,
    );
    const opened = await p.runtimeForTest.enterHostCandidate(
      p.c,
      origin,
      ack.recipientProof,
      first.ids,
      {
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId: randomUUID(),
        expectedProjectionRevision: first.state().revision,
        sourceFormId: 'APP-003',
        actionKey: 'APP-003::CTA::009',
      },
      { hostAddress: '127.0.0.1', hostPort: h.port },
      () => undefined,
    );
    expect(opened.presentation.base.formId).toBe('NET-003');
    expect(p.state().selectedCandidates.map((x) => x.sourceUuid)).toEqual(first.ids);
    expect(readHostLocalRoster(p.db, device, origin.campaignId)).toEqual([]);
  }, 30_000);
});

describe('two pending host-local applicants on the same installation', () => {
  type Site = Awaited<ReturnType<typeof createHostLocalRequestSite>>;
  let first: Site, second: Site;
  beforeEach(async () => {
    first = await createHostLocalRequestSite(2);
  }, 60_000);
  beforeEach(async () => {
    second = await createHostLocalRequestSite(1, first);
    expect(first.networkScopeId).not.toBe(second.networkScopeId);
    first.p.reopenShell(null);
    for (const site of [first, second]) {
      const app = readLocalNetworkApplication(site.p.db, {
        ownerDeviceId: site.device,
        networkScopeId: site.networkScopeId,
      });
      expect(app.requestOrNull).toMatchObject({
        requestId: site.batch.requestId,
        technicalSessionId: site.batch.technicalSessionId,
        closureOrNull: null,
      });
    }
    expect(readActiveLocalNetworkTab(first.p.db, first.device)?.networkScopeId).toBe(
      second.networkScopeId,
    );
  }, 60_000);
  net.reviewSubmitted('MIXED', () => ({
    h: first.h,
    p: first.p,
    requestId: first.batch.requestId,
  }));
  it('accepts the addressed earlier request after reopen while the physical pointer still belongs to the second applicant', async () => {
    expect(readActiveLocalNetworkTab(first.p.db, first.device)?.networkScopeId).toBe(
      second.networkScopeId,
    );
    await first.acceptPublication();
    const seats = readHostLocalRoster(first.p.db, first.device, first.origin.campaignId);
    expect(seats.map((row) => row.diff.sourceUuid)).toEqual(first.ids);
    expect(seats.map((row) => row.profileOwnerId)).toEqual(
      first.ids.map(() => first.profile.targetLocalOwnerId),
    );
    expect(readActiveLocalNetworkTab(first.p.db, first.device)?.networkScopeId).toBe(
      second.networkScopeId,
    );
    expect(
      readLocalNetworkApplication(second.p.db, {
        ownerDeviceId: second.device,
        networkScopeId: second.networkScopeId,
      }).requestOrNull,
    ).toMatchObject({ requestId: second.batch.requestId, closureOrNull: null });
  }, 30_000);
});

describe('managed NET-017 during other campaign work', () => {
  let site: Awaited<ReturnType<typeof createHostLocalRequestSite>>;
  beforeEach(async () => {
    site = await createHostLocalRequestSite(1);
  }, 60_000);
  it('republishes the addressed applicant when another GM operation settles without changing the request or connection', async () => {
    const { gm, p, h, origin, batch } = site;
    const control = site.coordinator();
    expect(
      (await control.resume(site.gmDelivery.key)).presentation.base.availableActionKeys,
    ).toContain('NET-017::CTA::011');
    const scope = {
      ownerDeviceId: site.device,
      gmLocalContextId: origin.gmContextId,
      campaignId: origin.campaignId,
    };
    expect(control.runtime.managesGmOrigin(scope)).toBe(true);
    expect(control.runtime.managesGmOrigin({ ...scope, gmLocalContextId: randomUUID() })).toBe(
      false,
    );
    expect(control.runtime.managesGmOrigin({ ...scope, ownerDeviceId: randomUUID() })).toBe(false);
    expect(control.runtime.managesGmOrigin({ ...scope, campaignId: randomUUID() })).toBe(false);
    await gm.nav(false);
    p.runtimeForTest.disconnect(p.c);
    p.dropPeer();
    const connections = () =>
      h.runtime.requestConnectionFacts(origin.campaignId, [batch.requestId]);
    await expect
      .poll(connections, { timeout: 10_000 })
      .toMatchObject([{ requestId: batch.requestId, connected: false }]);
    const stableConnections = connections();
    const snapshot = (reason: 'FORM_ACTION' | 'HOST_SYSTEM_EVENT') =>
      gm.sent.findLast(
        (m): m is ProjectionSnapshotV2Message =>
          m.messageType === 'projection.snapshot' &&
          m.protocolVersion === 2 &&
          m.presentation.assignment.reason === reason &&
          m.presentation.base.formId === 'NET-017',
      );
    const nav = gm.nav();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const other = gm.gmScheduler.wire({ ...gm.c }, () => gate);
    let busy: ProjectionSnapshotV2Message;
    try {
      const request = await nav;
      const raw = snapshot('FORM_ACTION');
      expect(raw?.presentation.assignment.correlationId).toBe(request.navigationRequestId);
      busy = control.runtime.decorate(control.socket, raw!)!;
      expect(busy.presentation.base.availableActionKeys).not.toContain('NET-017::CTA::006');
      expect(busy.presentation.base.availableActionKeys).not.toContain('NET-017::CTA::011');
      expect(busy.presentation.layers.at(-1)?.roleFilteredPayload['applicants']).toBeUndefined();
    } finally {
      release();
      await other;
    }
    const queueRevision = gm.view().requestQueueRevision;
    await expect
      .poll(
        () =>
          snapshot('HOST_SYSTEM_EVENT')?.revisions.projectionRevision ??
          busy.revisions.projectionRevision,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(busy.revisions.projectionRevision);
    const idle = control.runtime.decorate(control.socket, snapshot('HOST_SYSTEM_EVENT')!)!;
    expect(idle.revisions.stateRevision).toBe(busy.revisions.stateRevision);
    expect(idle.revisions.actorVisibilityRevision).toBe(busy.revisions.actorVisibilityRevision);
    expect(gm.view().requestQueueRevision).toBe(queueRevision);
    expect(connections()).toEqual(stableConnections);
    expect(idle.presentation.base.availableActionKeys).toEqual(
      expect.arrayContaining(['NET-017::CTA::006', 'NET-017::CTA::011']),
    );
    expect(idle.presentation.layers.at(-1)?.roleFilteredPayload['applicants']).toEqual([
      { ...site.profile, requestId: batch.requestId },
    ]);
  }, 30_000);
});

describe('closed host-local admission results', () => {
  type Site = Awaited<ReturnType<typeof createHostLocalRequestSite>>;
  let site: Site;
  const retired: {
    requestId: string;
    ownerId: string;
    scopeId: string;
    details: JsonObject;
    oldKey: string;
  }[] = [];
  const live = () =>
    site.p.db
      .prepare(
        'SELECT network_scope_id FROM local_network_tab WHERE retirement_command_id IS NULL ORDER BY network_scope_id',
      )
      .all();
  for (const [index, outcome] of (
    ['GM_REJECTED', 'PLAYER_DECLINED', 'GM_REJECTED'] as const
  ).entries()) {
    beforeEach(async () => {
      if (index === 0) retired.length = 0;
      site = await createHostLocalRequestSite(1, index === 0 ? undefined : site);
      expect(live()).toEqual([{ network_scope_id: site.networkScopeId }]);
    }, 60_000);
    net.reviewSubmitted(outcome === 'GM_REJECTED' ? 'REJECT' : 'ACCEPT', () => ({
      h: site.h,
      p: site.p,
      async resumeGmQueue() {
        const shown = await site.coordinator().resume(site.gmDelivery.key);
        expect(shown.projectionRole).toBe('gm');
        expect(shown.presentation.base).toMatchObject({
          formId: 'NET-017',
          roleFilteredPayload: {
            campaignId: site.origin.campaignId,
            contextId: site.origin.gmContextId,
          },
        });
        expect(shown.presentation.layers.at(-1)?.roleFilteredPayload).toMatchObject({
          hostSeatView: 'ACTIVE',
          receiptId: site.gmDelivery.receipt.receiptId,
        });
        return site.gm;
      },
      requestId: site.batch.requestId,
    }));
    beforeEach(async () => {
      const { control, key } =
        outcome === 'PLAYER_DECLINED'
          ? await site.declinePublication()
          : { control: site.coordinator(), key: site.addressApplicant().key };
      const original = await control.resume(key);
      const details = original.presentation.base.roleFilteredPayload;
      expect(details).toMatchObject({ result: outcome, requestIdOrNull: site.batch.requestId });
      expect(original.presentation.base.formId).toBe('NET-007');
      await control.navigate('NET-007', 'NET-007::CTA::005');
      const gm = await control.acceptGmReturn();
      expect(gm.snapshot.presentation.base.formId).toBe('NET-017');
      expect(live()).toEqual([]);
      retired.push({
        requestId: site.batch.requestId,
        ownerId: site.profile.targetLocalOwnerId,
        scopeId: site.networkScopeId,
        details,
        oldKey: key,
      });
    }, 60_000);
  }
  let prepared: Awaited<ReturnType<typeof prepareHostLocalCandidateSite>>;
  let fourth: Site, control: ReturnType<Site['coordinator']>, gmKey: string;
  beforeEach(async () => {
    prepared = await net.measure('closed-result.fourth-profile-and-final', () =>
      prepareHostLocalCandidateSite(1, site),
    );
  }, 60_000);
  beforeEach(async () => {
    fourth = await net.measure('closed-result.fourth-entry-and-submit', () =>
      submitPreparedHostLocalRequestSite(prepared, 'closed-result.fourth'),
    );
    gmKey = fourth.gmDelivery.key;
    // After three terminal returns, opening the tab, preparing, submitting and returning to GM
    // completed in 64.8s under the Windows Job. Each real operation retains its own deadline.
  }, 120_000);
  beforeEach(async () => {
    await net.measure('closed-result.reopen', () => {
      fourth.p.reopenShell(null);
      control = fourth.coordinator();
    });
  });
  async function deliver(index: number) {
    const original = retired[index]!;
    const phase = index === 0 ? 'closed-result.gm-rejected' : 'closed-result.player-declined';
    const gm = await net.measure(phase + '.resume-gm', () => control.resume(gmKey));
    const applicants = gm.presentation.layers.at(-1)?.roleFilteredPayload['applicants'];
    expect(applicants).toContainEqual(
      expect.objectContaining({ requestId: fourth.batch.requestId }),
    );
    for (const { requestId, ownerId } of retired) {
      expect(applicants).toContainEqual(
        expect.objectContaining({ requestId, targetLocalOwnerId: ownerId }),
      );
    }
    const curtain = await net.measure(phase + '.select', () =>
      control.selectApplicant(original.requestId),
    );
    expect(curtain.presentation.layers.at(-1)?.roleFilteredPayload['target']).toMatchObject({
      kind: 'CANDIDATE',
      targetLocalOwnerId: original.ownerId,
    });
    expect(JSON.stringify(curtain)).not.toContain(original.details['decisionReceiptId']);
    const archived = await net.measure(phase + '.ack-and-resume', () =>
      control.acceptHandoff('CANDIDATE'),
    );
    expect(archived.snapshot.presentation.base.formId).toBe('NET-007');
    expect(archived.snapshot.presentation.layers.at(-1)?.roleFilteredPayload).toMatchObject({
      terminalResultReadOnly: true,
      networkScopeIdOrNull: original.scopeId,
    });
    const details = archived.snapshot.presentation.base.roleFilteredPayload;
    for (const field of [
      'requestIdOrNull',
      'publication',
      'receiptOrNull',
      'result',
      'gmReasonOrNull',
      'decisionReceiptId',
      'fullCampaignCopyDiffs',
    ])
      expect(details[field]).toEqual(original.details[field]);
    expect(details['technicalSessionAvailable']).toBe(false);
    const loadLedger = () =>
      fourth.p.db
        .prepare('SELECT * FROM local_admission_event WHERE request_id=? ORDER BY event_index')
        .all(original.requestId);
    const originalLedger = loadLedger();
    await expect(control.navigate('NET-007', 'NET-007::CTA::002')).rejects.toThrow(
      'NAVIGATION_UNAVAILABLE',
    );
    expect(
      (await net.measure(phase + '.restore-result', () => control.resume(archived.key)))
        .presentation.base.roleFilteredPayload,
    ).toEqual(details);
    if (details['result'] === 'PLAYER_DECLINED') {
      const proposal = await net.measure(phase + '.read-proposal', () =>
        control.navigate('NET-007', 'NET-007::CTA::001'),
      );
      expect(proposal.presentation.base.availableActionKeys).toEqual(['NET-027::CTA::002']);
      expect(proposal.presentation.base.roleFilteredPayload).toEqual(details);
      await net.measure(phase + '.close-proposal', () =>
        control.navigate('NET-027', 'NET-027::CTA::002'),
      );
    }
    await net.measure(phase + '.return', () => control.navigate('NET-007', 'NET-007::CTA::005'));
    gmKey = (await net.measure(phase + '.ack-and-resume-gm', () => control.acceptGmReturn())).key;
    expect(loadLedger()).toEqual(originalLedger);
    expect(
      (await control.resume(original.oldKey)).presentation.base.roleFilteredPayload,
    ).toMatchObject({ hostSeatView: 'WAITING' });
    expect(live()).toEqual([{ network_scope_id: fourth.networkScopeId }]);
    expect(readHostLocalRoster(fourth.p.db, fourth.device, fourth.origin.campaignId)).toEqual([]);
  }
  beforeEach(() => deliver(0), 60_000);
  it(
    'submits a fourth fresh request and after reopen delivers both types of prior decision only to their addressed owners without recreating a tab',
    () => deliver(1),
    60_000,
  );
});
