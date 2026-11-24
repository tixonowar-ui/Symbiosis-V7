import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
} from './creation-finalization-stage.js';
import { commitCreationFinalization } from '../../src/host/creation-finalization.js';
import { readLocalNetworkDeliverySnapshot } from '../../src/persistence/network-local-application.js';
import { hostLocalNetworkFixture as net } from './network-application-scenarios.js';
import {
  ackHostLocalSeatHandoff,
  beginHostLocalSeatHandoff,
  createHostSeatProfile,
  openHostLocalSeatSetup,
  readHostLocalSeatHandoff,
  recordHostLocalCharacterBirth,
  selectHostLocalFinals,
  type HostSeatOrigin,
  type HostLocalSeatTarget,
} from '../../src/persistence/host-local-seat.js';
import { ADMISSION_GM_WORKFLOW_IDS } from '../../src/shared/campaign-admission-presentation.js';
import { NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS } from '../../src/shared/device-admission.js';
import { restoreHostSeatGmForm } from '../../src/host/host-seat-gm-return.js';
import { HOST_SEAT_ACK, hostSeatViewValue } from '../../src/shared/host-seat.js';
import {
  createHostLocalSeatRuntime,
  type HostSeatClient,
} from '../../src/host/host-local-seat-runtime.js';
import type { LocalNetworkHostMessage } from '../../src/host/network-application.js';
import type { ActionKey, FormId } from '../../generated/types/atlas.js';

const proof = (key: string) => createHash('sha256').update(key).digest('hex');
const verify = () => undefined;
type Installation = {
  p: Awaited<ReturnType<typeof net.client>>;
  h: Awaited<ReturnType<typeof net.host>>;
  gm: ReturnType<typeof net.gmClient>;
  origin: HostSeatOrigin;
  ids: readonly string[];
};
export async function prepareHostLocalCandidateSite(count: number, installation?: Installation) {
  const p = installation?.p ?? (await net.client()),
    h = installation?.h ?? (await net.host({ path: p.path })),
    gm = installation?.gm ?? net.gmClient(h);
  gm.c.executableReview = [
    ...NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS,
    ...ADMISSION_GM_WORKFLOW_IDS,
    'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
    'UI-CMD-CAMPAIGN-START',
  ];
  const device = h.principal.hostOwnerDeviceId;
  expect(h.principal.peerIdentity.ownerDeviceId).toBe(device);
  const state = () => readHostLocalSeatHandoff(p.db, device);
  const mut = () => ({
    commandId: randomUUID(),
    expectedRevision: state().revision,
    activeProof: state().activeProof,
  });
  const origin: HostSeatOrigin = installation?.origin ?? {
    gmContextId: h.gmLocalContextId,
    campaignId: h.campaignId,
    returnFormId: 'CMP-009',
    gmDeliveryProof: proof(randomUUID()),
  };
  const profile = { targetLocalOwnerId: randomUUID(), targetProfileLabel: 'Local owner' };
  openHostLocalSeatSetup(
    p.db,
    device,
    { ...mut(), origin, setupProof: proof(randomUUID()) },
    verify,
  );
  gm.runtime.unwatch(gm.c);
  createHostSeatProfile(p.db, device, { ...mut(), origin, profile }, verify);
  function hand(target: HostLocalSeatTarget) {
    beginHostLocalSeatHandoff(p.db, device, { ...mut(), target }, verify);
    gm.runtime.unwatch(gm.c);
    p.runtimeForTest.disconnect(p.c);
    const pending = state().pending!,
      key = randomBytes(32).toString('hex');
    const receipt = ackHostLocalSeatHandoff(
      p.db,
      device,
      {
        commandId: randomUUID(),
        expectedRevision: state().revision,
        handoffId: pending.handoffId,
        signedReturnContext: pending.signedReturnContext,
        role: target.kind === 'GM' ? 'gm' : 'player',
        decision:
          target.kind === 'GM' && target.destinationFormId === 'CMP-009'
            ? 'RETURN_INITIATOR'
            : 'ACTIVATE_TARGET',
        recipientProof: proof(key),
      },
      verify,
    );
    return { key, receipt: receipt.receipt };
  }
  const initial = hand({
    kind: 'CANDIDATE',
    profile,
    origin,
    networkScopeIdOrNull: null,
    requestOrNull: null,
  });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID(),
      prefix = 'local-' + id;
    const wizard = await createCreationFinalizationSetup({
      prefix,
      databasePath: p.path,
      characterDraftId: id,
      raceChoice: 'PURE',
      diceInputMode: 'MANUAL',
      onIdentityBirth: (db, localCharacterId, checkpointId) => {
        const saved = readHostLocalSeatHandoff(db, device);
        recordHostLocalCharacterBirth(
          db,
          device,
          {
            commandId: randomUUID(),
            expectedRevision: saved.revision,
            activeProof: saved.activeProof,
            localCharacterId,
            checkpointId,
            candidateAckReceiptId: initial.receipt.receiptId,
          },
          verify,
        );
      },
    });
    try {
      const save = commitCreationFinalization(
        wizard.setup.database,
        creationPropertySummaryRequest(wizard.current, randomUUID()),
        randomUUID(),
        wizard.dependencies,
      );
      const final = commitCreationFinalization(
        wizard.setup.database,
        creationFinalSaveRequest(save, randomUUID()),
        randomUUID(),
        wizard.dependencies,
      );
      expect(final.localCharacter.lifecycleState).toBe('FINAL');
      ids.push(id);
    } finally {
      wizard.setup.database.close();
    }
  }
  if (installation) {
    const previous = state();
    expect(() =>
      selectHostLocalFinals(
        p.db,
        device,
        { ...mut(), formId: 'APP-003', selectedSourceUuids: [installation.ids[0]!] },
        verify,
      ),
    ).toThrow();
    expect(state()).toEqual(previous);
  }
  selectHostLocalFinals(
    p.db,
    device,
    { ...mut(), selectedSourceUuids: ids, formId: 'APP-003' },
    verify,
  );
  function coordinator() {
    const network = p.runtimeForTest;
    let destinationFailure: unknown;
    const runtime = createHostLocalSeatRuntime({
      db: p.db,
      network: {
        ...network,
        async hostSnapshot(...args) {
          try {
            return await network.hostSnapshot(...args);
          } catch (error) {
            destinationFailure = error;
            throw error;
          }
        },
      },
      heldNetworkConfiguration: h.runtime.heldNetworkConfiguration,
      conflictingOperationPending: (id) => {
        const work = gm.gmScheduler.pendingCounts(id, gm.gmScheduler.currentToken(id));
        return (
          work.queuedCommandCount +
            work.executingCommandCount +
            h.runtime.operationCounts(id).pendingOperationCount >
          0
        );
      },
      readApplicant: gm.runtime.hostSeatApplicant,
      readScene: gm.runtime.hostSeatScene,
    });
    gm.observeHostLocalGm(runtime.managesGmOrigin);
    const messages: LocalNetworkHostMessage[] = [];
    const socket: HostSeatClient = {
      network: p.c,
      campaign: gm.c,
      send: (m) => messages.push(m),
      trusted: () => true,
      revoke: () => {
        gm.runtime.unwatch(gm.c);
        p.runtimeForTest.disconnect(p.c);
      },
      characterContextId: () => null,
      replayReceipts: () => {
        throw Error('Unexpected private receipt lookup');
      },
      capabilities: () => [HOST_SEAT_ACK],
      openOwnedLibrary: () => {
        throw Error('Unexpected library destination');
      },
      async restoreGm(current, destination, id, reason) {
        expect(current).toEqual(origin);
        const first = await gm.campaign.snapshot(gm.c, id, reason);
        try {
          const restored = await restoreHostSeatGmForm(
            first,
            current,
            destination,
            id,
            reason,
            async (intent) => {
              await gm.send(intent);
              const snapshot = gm.sent.find(
                (m) =>
                  m.messageType === 'projection.snapshot' &&
                  m.protocolVersion === 2 &&
                  m.presentation.assignment.correlationId === intent.navigationRequestId,
              );
              if (snapshot?.messageType !== 'projection.snapshot' || snapshot.protocolVersion !== 2)
                throw Error('Owning GM navigation refused: ' + intent.actionKey);
              return snapshot;
            },
          );
          const epoch = runtime.deliveryEpoch();
          gm.runtime.watch(gm.c, (message) => {
            if (runtime.deliveryEpoch() !== epoch || runtime.authority(socket).role !== 'GM')
              return;
            if (message.messageType === 'projection.snapshot' && message.protocolVersion === 2) {
              const checked = runtime.decorate(socket, message);
              if (checked) socket.send(checked);
            } else socket.send(message);
          });
          return restored;
        } catch (cause) {
          const forms = [first.presentation.base, ...first.presentation.layers].map(
            (f) => f.formId,
          );
          destinationFailure = new Error(
            'Cannot restore GM from ' + forms.join('/') + ' to ' + destination,
            { cause },
          );
          throw destinationFailure;
        }
      },
    };
    const view = () => {
      const m = messages.findLast(
        (x) => x.messageType === 'projection.snapshot' && x.protocolVersion === 2,
      );
      if (m?.messageType !== 'projection.snapshot' || m.protocolVersion !== 2) {
        if (destinationFailure instanceof Error) throw destinationFailure;
        throw Error(
          'No addressed snapshot: ' +
            JSON.stringify(
              messages.map((message) =>
                message.messageType === 'navigation.form-action.refusal'
                  ? message.refusal.code
                  : message.messageType,
              ),
            ),
        );
      }
      return m;
    };
    async function resume(key: string | null) {
      messages.length = 0;
      destinationFailure = undefined;
      await runtime.handle(socket, {
        messageType: 'host.seat.control',
        protocolVersion: 3,
        operation: 'RESUME',
        requestId: randomUUID(),
        deliveryKeyOrNull: key,
        supportedWorkflowCommandIds: [HOST_SEAT_ACK],
        unacknowledgedCommandIds: [],
      });
      return view();
    }
    async function acceptHandoff(
      expected: 'GM' | 'CANDIDATE',
      decision: 'ACTIVATE_TARGET' | 'RETURN_INITIATOR' = 'ACTIVATE_TARGET',
    ) {
      const neutral = await resume(null);
      const addressed = hostSeatViewValue(neutral.presentation.layers.at(-1)!.roleFilteredPayload);
      if (
        addressed.hostSeatView !== 'CURTAIN' ||
        addressed.target.kind !== expected ||
        addressed.decision !== decision
      )
        throw Error('Missing addressed ' + expected + ' curtain');
      const deliveryKey = randomBytes(32).toString('hex'),
        commandId = randomUUID();
      messages.length = 0;
      await runtime.handle(socket, {
        messageType: 'command.request',
        protocolVersion: 1,
        role: expected === 'GM' ? 'gm' : 'player',
        commandId,
        commandKind: 'workflow-command',
        workflowCommandId: HOST_SEAT_ACK,
        expectedRevisions: neutral.revisions,
        payload: {
          handoffId: addressed.handoffId,
          signedReturnContext: addressed.signedReturnContext,
          decision: addressed.decision,
          deliveryKey,
        },
      });
      const result = messages.find(
        (message) =>
          message.messageType === 'command.result' && message.receipt.commandId === commandId,
      );
      expect(result).toMatchObject({ messageType: 'command.result', receipt: { commandId } });
      return { snapshot: await resume(deliveryKey), key: deliveryKey };
    }
    return {
      runtime,
      view,
      socket,
      resume,
      acceptHandoff,
      acceptGmReturn(decision: 'ACTIVATE_TARGET' | 'RETURN_INITIATOR' = 'ACTIVATE_TARGET') {
        return acceptHandoff('GM', decision);
      },
      async selectApplicant(requestId: string) {
        const current = view();
        messages.length = 0;
        await runtime.handle(socket, {
          messageType: 'host.seat.control',
          protocolVersion: 3,
          operation: 'SELECT_APPLICANT',
          requestId: randomUUID(),
          selectedRequestId: requestId,
          expectedProjectionRevision: current.revisions.projectionRevision,
        });
        return view();
      },
      async navigate(form: FormId, key: ActionKey) {
        const v = view();
        messages.length = 0;
        await runtime.handle(socket, {
          messageType: 'navigation.form-action',
          protocolVersion: 2,
          sourceFormId: form,
          actionKey: key,
          navigationRequestId: randomUUID(),
          expectedProjectionRevision: v.revisions.projectionRevision,
        });
        return view();
      },
    };
  }
  return { p, h, gm, origin, device, state, profile, initial, ids, hand, coordinator };
}
export async function createHostLocalRequestSite(count: number, installation?: Installation) {
  return submitPreparedHostLocalRequestSite(
    await prepareHostLocalCandidateSite(count, installation),
  );
}
export async function submitPreparedHostLocalRequestSite(
  prepared: Awaited<ReturnType<typeof prepareHostLocalCandidateSite>>,
  phasePrefix = 'host-request',
) {
  const { p, h, gm, origin, device, state, profile, initial, ids, hand, coordinator } = prepared;
  const scopeEntry = await net.measure(phasePrefix + '.enter-candidate', () =>
    p.runtimeForTest.enterHostCandidate(
      p.c,
      origin,
      proof(initial.key),
      ids,
      {
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId: randomUUID(),
        expectedProjectionRevision: state().revision,
        sourceFormId: 'APP-003',
        actionKey: 'APP-003::CTA::009',
      },
      { hostAddress: '127.0.0.1', hostPort: h.port },
      verify,
    ),
  );
  expect(scopeEntry.presentation.base.formId).toBe('NET-003');
  await net.measure(phasePrefix + '.prepare-batch', () => p.nav('NET-003::CTA::001'));
  const batch = p.state().preparedBatchOrNull!;
  const peerStart = p.responses.length,
    errorStart = p.peerErrors.length,
    endpointStart = h.errors.length;
  const originalChannel = p.peerForTest.current(p.scope().networkScopeId),
    reconnectStart = p.reconnectCount();
  const submit = await net.measure(phasePrefix + '.submit', () =>
    p.command('UI-CMD-DEVICE-REQUEST-SUBMIT', {
      requestId: batch.requestId,
      technicalSessionId: batch.technicalSessionId,
      connectionRevision: batch.connectionRevision,
      selectedCandidates: p.state().selectedCandidates,
    }),
  );
  const scope = p.scope();
  const frames = p.sent.map((m) => {
    if (m.messageType === 'projection.snapshot' && m.protocolVersion === 2) {
      const { assignment, base } = m.presentation;
      return {
        type: m.messageType,
        id: assignment.correlationId,
        reason: assignment.reason,
        form: base.formId,
        ownScope: base.roleFilteredPayload['networkScopeId'] === scope.networkScopeId,
        ownPending: base.roleFilteredPayload['pendingCommandIdOrNull'] === submit.commandId,
      };
    }
    if (m.messageType === 'command.result' || m.messageType === 'command.replay')
      return {
        type: m.messageType,
        id: m.receipt.commandId,
        lifecycle: m.lifecycleState,
        receipt: m.receipt.receiptId,
        remoteReceipt: m.receipt.result['remoteReceiptId'],
        outcome: m.receipt.result['outcome'],
        request: m.receipt.result['requestIdOrNull'],
        session: m.receipt.result['technicalSessionId'],
      };
    if (m.messageType === 'command.refusal')
      return { type: m.messageType, id: m.commandId, code: m.refusal.code };
    if (m.messageType === 'protocol.refusal')
      return { type: m.messageType, id: m.relatedCommandId, code: m.refusal.code };
    return { type: m.messageType };
  });
  const delivery = readLocalNetworkDeliverySnapshot(p.db, scope, submit.commandId);
  const hosted = h.db
    .prepare<[string, string, string, string], { receipt_id: string }>(
      "SELECT receipt_id FROM hosted_network_command WHERE command_id=? AND operation='SUBMIT' AND campaign_id=? AND host_owner_device_id=? AND peer_device_id=?",
    )
    .get(submit.commandId, origin.campaignId, device, device);
  const diagnostic = JSON.stringify({
    frames,
    commandId: submit.commandId,
    form: delivery.current.formId,
    pending: delivery.current.pendingCommandIdOrNull === submit.commandId,
    diagnostic: delivery.current.diagnosticCodeOrNull,
    intent: delivery.outbox?.intent.operation,
    ack: delivery.outbox?.acknowledgementOrNull?.operation,
    hosted: !!hosted,
    localReceipt: delivery.acknowledgementEvent?.receipt.receiptId,
    peer: p.responses.slice(peerStart).map((v) => ({
      operation: v.operation,
      outcome: v.outcome,
      code: v.outcome === 'REFUSED' ? v.code : undefined,
    })),
    peerErrors: p.peerErrors
      .slice(errorStart)
      .map(
        (s) =>
          s.match(
            /\b(?:UNCONFIRMED_OUTCOME|CLOSED|TIMEOUT|PEER_UNAVAILABLE|TRANSPORT_ERROR)\b/u,
          )?.[0] ?? 'OTHER',
      ),
    endpointCodes: h.errors.slice(endpointStart),
    hadChannel: originalChannel !== null,
    originalChannelClosed: originalChannel?.closed ?? null,
    sameCurrentChannel:
      originalChannel !== null && p.peerForTest.current(scope.networkScopeId) === originalChannel,
    reconnects: p.reconnectCount() - reconnectStart,
  });
  const commandFrames = frames.filter(
    (frame) =>
      !(
        frame.type === 'projection.snapshot' &&
        frame.reason === 'HOST_SYSTEM_EVENT' &&
        frame.ownScope &&
        typeof frame.id === 'string' &&
        /^network-owner-view:[0-9a-f]{64}$/u.test(frame.id)
      ),
  );
  const localReceiptId = delivery.acknowledgementEvent?.receipt.receiptId;
  const hostedReceiptId = hosted?.receipt_id;
  expect(localReceiptId, diagnostic).toBeTypeOf('string');
  expect(hostedReceiptId, diagnostic).toBeTypeOf('string');
  expect(commandFrames, diagnostic).toEqual([
    {
      type: 'command.result',
      id: submit.commandId,
      lifecycle: 'COMMITTED',
      receipt: localReceiptId,
      remoteReceipt: hostedReceiptId,
      outcome: 'PENDING',
      request: batch.requestId,
      session: batch.technicalSessionId,
    },
    {
      type: 'projection.snapshot',
      id: submit.commandId,
      reason: 'COMMAND_DESTINATION',
      form: 'NET-005',
      ownScope: true,
      ownPending: false,
    },
  ]);
  expect(delivery.current.requestOrNull, diagnostic).toMatchObject({
    requestId: batch.requestId,
    submitCommandId: submit.commandId,
    submitReceiptId: hostedReceiptId,
  });
  const networkScopeId = p.scope().networkScopeId;
  const gmDelivery = await net.measure(phasePrefix + '.return-gm', () =>
    hand({ kind: 'GM', origin, destinationFormId: 'NET-017' }),
  );
  function addressApplicant() {
    const request = gm.runtime.hostSeatApplicant(origin, batch.requestId);
    if (!request) throw Error('Missing current local application');
    return hand({
      kind: 'CANDIDATE',
      origin,
      profile,
      networkScopeIdOrNull: networkScopeId,
      requestOrNull: request,
    });
  }
  async function decidePublication(decision: 'ACCEPT' | 'DECLINE') {
    const key = addressApplicant().key,
      control = coordinator();
    const received = await control.resume(key),
      payload = received.presentation.base.roleFilteredPayload;
    expect(received.presentation.base.formId).toBe('NET-027');
    const commandId = randomUUID();
    await p.send({
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      workflowCommandId: 'UI-CMD-ADMISSION-PLAYER-DECIDE',
      role: 'player',
      commandId,
      expectedRevisions: received.revisions,
      payload: {
        contextId: p.c.contextId!,
        networkScopeId,
        campaignId: h.campaignId,
        requestId: batch.requestId,
        admissionBatchId: payload['admissionBatchId']!,
        proposalRevision: payload['proposalRevision']!,
        proposalChecksum: payload['proposalChecksum']!,
        expectedCampaignRevision: payload['campaignRevisionOrNull']!,
        decision,
      },
    });
    const first = p.sent[0];
    const reason =
      first?.messageType === 'protocol.refusal'
        ? first.refusal
        : first?.messageType === 'command.refusal'
          ? { code: first.refusal.code }
          : first?.messageType;
    expect(first, JSON.stringify(reason)).toMatchObject({
      messageType: 'command.result',
      receipt: { commandId },
    });
    expect((await control.resume(key)).presentation.base.formId).toBe(
      decision === 'ACCEPT' ? 'NET-006' : 'NET-007',
    );
    expect(state().active?.kind).toBe(decision === 'ACCEPT' ? 'PLAYER' : 'CANDIDATE');
    return { key, control };
  }
  return {
    p,
    h,
    gm,
    profile,
    origin,
    device,
    state,
    ids,
    hand,
    coordinator,
    addressApplicant,
    gmDelivery,
    batch,
    networkScopeId,
    acceptPublication: () => decidePublication('ACCEPT'),
    declinePublication: () => decidePublication('DECLINE'),
  };
}
