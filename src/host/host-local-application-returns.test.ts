import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hostLocalNetworkFixture as net,
  setupNetworkFixture,
} from '../../tests/fixtures/network-application-scenarios.js';
import { createHostLocalRequestSite } from '../../tests/fixtures/host-local-request-site.js';
import {
  readOwnedLocalNetworkTab,
  readLocalNetworkTabClosure,
} from '../persistence/network-local-tab.js';
import {
  beginHostLocalSeatHandoff,
  readHostLocalScopeOwner,
  readHostLocalCharacterOwner,
  readHostLocalTerminalApplicants,
} from '../persistence/host-local-seat.js';
import { openPersistenceDatabase } from '../persistence/database.js';
import { readHostLocalTerminalApplicant } from '../persistence/host-local-seat.js';
import { readHostLocalRoster } from '../persistence/local-seat-roster.js';
import { readLocalCampaignConnection } from '../persistence/local-campaign-connection.js';
import { readLocalNetworkRequestDeliverySnapshot } from '../persistence/network-local-application.js';
import { campaignLobbyPlayerProjectionValue } from '../shared/campaign-lobby-presentation.js';
import { HOST_SEAT_ACK } from '../shared/host-seat.js';
import {
  commitLocalLobbyEvent,
  readLocalAdmission,
} from '../persistence/local-campaign-admission.js';

setupNetworkFixture('host-local-application-returns');

describe.each([
  'PENDING',
  'CANCELLED',
  'PRELIMINARY_REJECTED',
  'FINAL_REJECTED',
  'MIXED_START',
] as const)('host-local addressed return after %s', (status) => {
  let site: Awaited<ReturnType<typeof createHostLocalRequestSite>>;
  beforeEach(async () => {
    site = await createHostLocalRequestSite(status === 'MIXED_START' ? 2 : 1);
  }, 60_000);
  if (status === 'FINAL_REJECTED' || status === 'MIXED_START') {
    net.reviewSubmitted(status === 'FINAL_REJECTED' ? 'REJECT' : 'MIXED', () => ({
      h: site.h,
      p: site.p,
      requestId: site.batch.requestId,
    }));
  }
  if (status === 'FINAL_REJECTED') {
    describe('archived refusal while another peer is uploading', () => {
      let key: string, control: ReturnType<typeof site.coordinator>;
      beforeEach(async () => {
        control = site.coordinator();
        const owner = site.addressApplicant();
        await control.resume(owner.key);
        await control.navigate('NET-007', 'NET-007::CTA::005');
        await control.acceptGmReturn();
        await control.selectApplicant(site.batch.requestId);
        key = (await control.acceptHandoff('CANDIDATE')).key;
      }, 60_000);
      it('restores the signed return action on the same archived delivery when the staged peer releases it', async () => {
        const { h, p, origin, device, networkScopeId } = site;
        const { peer } = await net.stageDeviceRequest(h);
        try {
          const busy = await control.resume(key);
          expect(busy.presentation.base.availableActionKeys).toEqual([]);
          expect(busy.presentation.base.roleFilteredPayload['result']).toBe('GM_REJECTED');
          expect(readOwnedLocalNetworkTab(p.db, device, networkScopeId)).toBeNull();
          peer.close();
          await expect
            .poll(() => control.view().presentation.assignment.reason, { timeout: 20_000 })
            .toBe('HOST_SYSTEM_EVENT');
          const safe = control.view();
          expect(safe.presentation.base.availableActionKeys).toEqual(['NET-007::CTA::005']);
          expect(safe.presentation.base.roleFilteredPayload).toEqual(
            busy.presentation.base.roleFilteredPayload,
          );
          expect(safe.presentation.layers).toEqual(busy.presentation.layers);
          expect(safe.revisions).toEqual(busy.revisions);
          expect(safe.presentation.assignment.correlationId).toMatch(
            /^network-owner-view:[a-f0-9]{64}$/u,
          );
          await control.navigate('NET-007', 'NET-007::CTA::005');
          expect((await control.acceptGmReturn()).snapshot.presentation.base.formId).toBe(
            'NET-017',
          );
          expect(readOwnedLocalNetworkTab(p.db, device, networkScopeId)).toBeNull();
          expect(readHostLocalRoster(p.db, device, origin.campaignId)).toEqual([]);
        } finally {
          peer.close();
        }
      }, 60_000);
    });
    it('invalidates a verified archived result on a second connection write or rolled-back local write', async () => {
      const { p, batch, profile, origin, device } = site;
      const control = site.coordinator(),
        owner = site.addressApplicant();
      await control.resume(owner.key);
      await control.navigate('NET-007', 'NET-007::CTA::005');
      await control.acceptGmReturn();
      const archived = (db = p.db) =>
        readHostLocalTerminalApplicant(
          db,
          device,
          profile.targetLocalOwnerId,
          origin.campaignId,
          batch.requestId,
        );
      const verified = archived()!;
      const id = verified.admission.record.submitCommandId;
      expect(
        Reflect.set(verified.target.profile, 'targetProfileLabel', 'modified read result'),
      ).toBe(true);
      expect(archived()?.target.profile.targetProfileLabel).toBe(profile.targetProfileLabel);
      const other = openPersistenceDatabase(p.path);
      try {
        const checksum = other
          .prepare<[string], { record_sha256: string }>(
            'SELECT record_sha256 FROM local_network_outbox WHERE command_id=?',
          )
          .get(id)!.record_sha256;
        const sql = 'UPDATE local_network_outbox SET record_sha256=? WHERE command_id=?';
        other.prepare(sql).run('0'.repeat(64), id);
        expect(() => archived()).toThrow(expect.objectContaining({ code: 'CORRUPT_STORAGE' }));
        other.prepare(sql).run(checksum, id);
        expect(archived()?.admission.record.publication.gmDecision.decision).toBe('REJECT');
        expect(() =>
          p.db.transaction(() => {
            p.db.prepare(sql).run('f'.repeat(64), id);
            return archived();
          })(),
        ).toThrow(expect.objectContaining({ code: 'CORRUPT_STORAGE' }));
        expect(archived()?.target).toEqual(archived(other)?.target);
      } finally {
        other.close();
      }
    }, 30_000);
  }
  if (status !== 'MIXED_START') {
    it('restores the exact submitted owner then hands the existing request back to NET-017 without creating a seat', async () => {
      const { h, p, gm, origin, batch, profile } = site;
      if (status === 'PRELIMINARY_REJECTED') net.gmDecision(h, batch.requestId, true);
      const active = site.addressApplicant(),
        control = site.coordinator();
      let snapshot = await control.resume(active.key);
      expect(snapshot.presentation.base.formId).toBe(
        status === 'FINAL_REJECTED' ? 'NET-007' : 'NET-005',
      );
      const details = snapshot.presentation.base.roleFilteredPayload;
      if (status === 'FINAL_REJECTED')
        expect(details['gmReasonOrNull']).toBe('Нужно другое снаряжение');
      else
        expect(details['requestStatus']).toBe(
          status === 'PRELIMINARY_REJECTED' ? 'REJECTED' : 'PENDING',
        );
      expect(gm.runtime.hostSeatApplicant(origin, batch.requestId)).toMatchObject({
        requestId: batch.requestId,
        technicalSessionId: batch.technicalSessionId,
        submitReceiptId: p.state().requestOrNull!.submitReceiptId,
      });
      if (status === 'CANCELLED') {
        const request = p.state().requestOrNull!;
        await p.replace('CANCEL_REASON', { cancelReason: 'Request withdrawn' });
        await p.command('UI-CMD-DEVICE-REQUEST-CANCEL', {
          requestId: request.requestId,
          technicalSessionId: request.technicalSessionId,
          requestRevision: request.requestRevision,
          reason: 'Request withdrawn',
        });
        expect(p.sent[0]).toMatchObject({ messageType: 'command.result' });
        snapshot = await control.resume(active.key);
        expect(snapshot.presentation.base.formId).toBe('NET-003');
        expect(p.state().requestOrNull?.closureOrNull).toBeTruthy();
      }
      const key =
        status === 'CANCELLED'
          ? 'NET-003::CTA::005'
          : status === 'FINAL_REJECTED'
            ? 'NET-007::CTA::005'
            : 'NET-005::CTA::004';
      expect(snapshot.presentation.base.availableActionKeys).toContain(key);
      const result = await control.navigate(snapshot.presentation.base.formId, key);
      expect(result.presentation.layers.at(-1)).toMatchObject({
        formId: 'PLY-030',
        roleFilteredPayload: { target: { kind: 'GM' }, decision: 'ACTIVATE_TARGET' },
      });
      expect(site.state()).toMatchObject({
        active: null,
        pending: {
          source: { kind: 'CANDIDATE', profile },
          target: { kind: 'GM', origin, destinationFormId: 'NET-017' },
        },
      });
      const returned = await control.acceptGmReturn();
      expect(returned.snapshot).toMatchObject({
        projectionRole: 'gm',
        presentation: {
          base: { formId: 'NET-017', roleFilteredPayload: { campaignId: origin.campaignId } },
        },
      });
      expect(site.state()).toMatchObject({
        gmDestinationConfirmed: true,
        active: { kind: 'GM', origin, destinationFormId: 'NET-017' },
      });
      const revoked = await control.resume(active.key);
      expect(revoked.presentation.base.roleFilteredPayload).toMatchObject({
        hostSeatView: 'WAITING',
      });
      expect(JSON.stringify(revoked)).not.toContain(batch.requestId);
      expect((await control.resume(returned.key)).presentation.base.formId).toBe('NET-017');
      expect(readHostLocalRoster(p.db, site.device, origin.campaignId)).toEqual([]);
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM campaign_admission_controller').get()).toEqual(
        { n: 0 },
      );
      expect(h.db.prepare('SELECT request_id FROM hosted_device_request').all()).toEqual([
        { request_id: batch.requestId },
      ]);
    }, 30_000);
  } else {
    let rootKey: string;
    let ownerControl: ReturnType<typeof site.coordinator>;
    const owner = () => ownerControl.resume(rootKey);
    beforeEach(async () => {
      const accepted = await site.acceptPublication();
      rootKey = accepted.key;
      ownerControl = accepted.control;
      expect(
        readLocalAdmission(
          site.p.db,
          site.p.scope(),
          site.batch.requestId,
        )?.receiptOrNull?.copies.map((x) => x.lifecycleState),
      ).toEqual(['ACTIVE', 'PROPOSED']);
    }, 30_000);
    for (const [form, action] of [
      ['NET-021', 'NET-021::CTA::001'],
      ['NET-017', 'NET-017::CTA::009'],
      ['CMP-006', 'CMP-006::CTA::001'],
      ['CMP-007', 'CMP-007::CTA::001'],
    ] as const) {
      beforeEach(async () => {
        const { gm } = site,
          view = await gm.runtime.project(gm.c);
        await gm.send({
          messageType: 'navigation.form-action',
          protocolVersion: 2,
          navigationRequestId: randomUUID(),
          sourceFormId: form,
          actionKey: action,
          expectedProjectionRevision: view.revisions.projectionRevision,
        });
        expect(gm.sent[0]).toMatchObject({ messageType: 'projection.snapshot' });
        // Browser actions arrive on separate I/O turns, including changes to the active peer channel.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }, 30_000);
    }
    async function time(hour: number) {
      const { gm, h } = site,
        view = await gm.runtime.project(gm.c);
      await gm.send({
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        role: 'gm',
        commandId: randomUUID(),
        workflowCommandId: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
        expectedRevisions: view.revisions,
        payload: {
          campaignId: h.campaignId,
          expectedLobbySnapshotRevision: view.base.roleFilteredPayload['lobbySnapshotRevision']!,
          dayNumber: 2,
          hour,
          minute: 0,
        },
      });
      expect(gm.sent[0]).toMatchObject({ messageType: 'command.result' });
    }
    async function ready(sibling = false) {
      if (sibling) {
        const { binding } = readHostLocalRoster(site.p.db, site.device, site.origin.campaignId)[1]!;
        const delivered = site.hand({
          kind: 'PLAYER',
          origin: site.origin,
          profile: site.profile,
          networkScopeId: binding.networkScopeId,
          localControllerSeatId: binding.localControllerSeatId,
          admissionReceiptId: binding.admissionReceiptId,
          destinationFormId: 'NET-006',
          sceneIdOrNull: null,
        });
        ownerControl = site.coordinator();
        rootKey = delivered.key;
      }
      const commandId = randomUUID(),
        view = await owner();
      const payload = campaignLobbyPlayerProjectionValue(
        view.presentation.base.roleFilteredPayload,
      );
      expect(payload.lobby.ready).toBe(false);
      await site.p.send({
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        role: 'player',
        commandId,
        workflowCommandId: 'UI-CMD-CAMPAIGN-READY-SET',
        expectedRevisions: view.revisions,
        payload: {
          campaignId: site.h.campaignId,
          expectedLobbySnapshotRevision: payload.lobby.lobbySnapshotRevision,
          ready: true,
        },
      });
      expect(site.p.sent[0]).toMatchObject({ messageType: 'command.result' });
      expect(
        campaignLobbyPlayerProjectionValue((await owner()).presentation.base.roleFilteredPayload)
          .lobby.ready,
      ).toBe(true);
      if (sibling) {
        const root = { ownerDeviceId: site.device, networkScopeId: site.networkScopeId };
        const record = readLocalAdmission(site.p.db, root, site.batch.requestId)!;
        const intent = record.events.find(
          (e) => e.payload.kind === 'READY_INTENT' && e.payload.request.commandId === commandId,
        )?.payload;
        if (intent?.kind !== 'READY_INTENT') throw Error('Missing signed sibling Ready intent');
        expect(intent.sourceNetworkScopeId).toBe(site.p.scope().networkScopeId);
        expect(intent.sourceNetworkScopeId).not.toBe(root.networkScopeId);
        expect(() =>
          commitLocalLobbyEvent(site.p.db, root, commandId, null, intent, () => undefined),
        ).toThrow(expect.objectContaining({ code: 'FOREIGN_OWNER' }));
        expect(readLocalAdmission(site.p.db, root, site.batch.requestId)?.events.length).toBe(
          record.events.length,
        );
      }
    }
    beforeEach(async () => {
      const { gm, p } = site;
      const send = vi.spyOn(ownerControl.socket, 'send');
      const poll = vi.spyOn(p.peerForTest, 'checkLobbyObservation');
      const updates = () =>
        send.mock.calls.flatMap(([message]) =>
          message.messageType === 'projection.snapshot' &&
          message.protocolVersion === 2 &&
          message.presentation.assignment.reason === 'HOST_SYSTEM_EVENT'
            ? [message]
            : [],
        );
      try {
        const confirmed = await owner();
        expect(confirmed.presentation.base.availableActionKeys).toContain('NET-006::CTA::005');
        send.mockClear();
        poll.mockClear();
        // The second authenticated check cannot start until the first poll finished publishing.
        await expect
          .poll(() => poll.mock.calls.length, { timeout: 15_000 })
          .toBeGreaterThanOrEqual(2);
        expect(updates()).toEqual([]);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const busy = gm.gmScheduler.wire({ ...gm.c }, () => gate);
        try {
          const blocked = await owner();
          expect(blocked.presentation.base.availableActionKeys).not.toContain('NET-006::CTA::005');
          expect(blocked.revisions).toEqual(confirmed.revisions);
          send.mockClear();
        } finally {
          release();
          await busy;
        }
        await expect
          .poll(() => updates().at(-1)?.presentation.base.availableActionKeys, { timeout: 15_000 })
          .toContain('NET-006::CTA::005');
        expect(updates().at(-1)?.revisions).toEqual(confirmed.revisions);
        send.mockClear();
        await time(6);
        await expect
          .poll(() => updates().at(-1)?.revisions.projectionRevision ?? 0, { timeout: 15_000 })
          .toBeGreaterThan(confirmed.revisions.projectionRevision);
        const actual = updates().at(-1)!;
        expect(actual.presentation.base.formId).toBe('NET-006');
        expect(actual.presentation.layers.at(-1)?.roleFilteredPayload['receiptId']).toBe(
          confirmed.presentation.layers.at(-1)?.roleFilteredPayload['receiptId'],
        );
      } finally {
        poll.mockRestore();
        send.mockRestore();
      }
    }, 30_000);
    beforeEach(() => ready(), 30_000);
    beforeEach(() => time(21), 30_000);
    beforeEach(() => ready(true), 30_000);
    let activeKey: string;
    beforeEach(async () => {
      const { gm, h, origin, p, profile } = site;
      const view = await gm.runtime.project(gm.c),
        payload = view.base.roleFilteredPayload;
      await gm.send({
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        role: 'gm',
        commandId: randomUUID(),
        workflowCommandId: 'UI-CMD-CAMPAIGN-START',
        expectedRevisions: view.revisions,
        payload: {
          campaignId: h.campaignId,
          expectedLobbySnapshotRevision: payload['lobbySnapshotRevision']!,
          expectedReadinessRevision: payload['readinessRevision']!,
        },
      });
      expect(gm.sent[0]).toMatchObject({ messageType: 'command.result' });
      const roster = readHostLocalRoster(p.db, site.device, h.campaignId);
      expect(roster.map((x) => x.profileOwnerId)).toEqual([
        profile.targetLocalOwnerId,
        profile.targetLocalOwnerId,
      ]);
      expect(gm.runtime.hostSeatScene(origin)?.included).toEqual([
        roster[0]!.binding.campaignCharacterId,
      ]);
      const blocked = roster[1]!.binding,
        control = ownerControl,
        snapshot = await owner();
      expect(snapshot.presentation.base.formId).toBe('NET-006');
      expect(
        campaignLobbyPlayerProjectionValue(snapshot.presentation.base.roleFilteredPayload).lobby,
      ).toMatchObject({
        campaignStarted: true,
        selectedCopy: {
          campaignCharacterId: blocked.campaignCharacterId,
          lifecycleState: 'PROPOSED',
        },
        peaceOrNull: null,
      });
      await control.navigate('NET-006', 'NET-006::CTA::005');
      expect(site.state().pending?.target).toEqual({
        kind: 'GM',
        origin,
        destinationFormId: 'GM-001',
      });
      const returned = await control.acceptGmReturn();
      expect(returned.snapshot).toMatchObject({
        projectionRole: 'gm',
        presentation: {
          base: { formId: 'GM-001', roleFilteredPayload: { campaignId: origin.campaignId } },
        },
      });
      expect((await control.resume(rootKey)).presentation.base.roleFilteredPayload).toMatchObject({
        hostSeatView: 'WAITING',
      });
      const active = roster[0]!.binding;
      activeKey = site.hand({
        kind: 'PLAYER',
        origin,
        profile,
        networkScopeId: active.networkScopeId,
        localControllerSeatId: active.localControllerSeatId,
        admissionReceiptId: active.admissionReceiptId,
        destinationFormId: 'PLY-001',
        sceneIdOrNull: gm.runtime.hostSeatScene(origin)!.sceneId,
      }).key;
      expect(readHostLocalRoster(p.db, site.device, h.campaignId)).toEqual(roster);
    }, 30_000);
    it('retains the blocked local seat in NET-006 and recovers the addressed first PEACE only after losing the original read channel', async () => {
      const { p, device, networkScopeId, h } = site;
      const root = { ownerDeviceId: device, networkScopeId };
      const submit = readLocalNetworkRequestDeliverySnapshot(p.db, root).outbox;
      if (submit?.intent.operation !== 'SUBMIT') throw Error('Missing signed original SUBMIT');
      const endpoint = readLocalCampaignConnection(p.db, root).lastAuthenticatedEndpoint;
      const peer = p.peerForTest;
      const read = peer.checkLobbyObservation.bind(peer);
      for (const fault of ['CLOSED', 'WRONG_SEAT', 'REVOKED'] as const) {
        const control = site.coordinator();
        const send = vi.spyOn(control.socket, 'send');
        const trust = vi.spyOn(control.socket, 'trusted');
        const pinned = await peer.reconnect(root, endpoint, h.campaignId);
        expect(await peer.recover(root, submit)).toMatchObject({
          outcome: 'ACK',
          receipt: { commandId: submit.intent.commandId },
        });
        const before = p.reconnectCount();
        const check = vi.spyOn(peer, 'checkLobbyObservation').mockImplementationOnce((...args) => {
          expect(peer.current(networkScopeId)).toBe(pinned);
          if (fault === 'WRONG_SEAT') return read(args[0], randomUUID(), args[2], args[3]);
          pinned.close();
          if (fault === 'REVOKED') trust.mockReturnValue(false);
          return read(...args);
        });
        try {
          const id = randomUUID();
          expect(
            await control.runtime.handle(control.socket, {
              messageType: 'host.seat.control',
              protocolVersion: 3,
              requestId: id,
              operation: 'RESUME',
              deliveryKeyOrNull: activeKey,
              supportedWorkflowCommandIds: [HOST_SEAT_ACK],
              unacknowledgedCommandIds: [],
            }),
          ).toBe(true);
          const frames = send.mock.calls.map(([frame]) => frame);
          if (fault === 'CLOSED') {
            expect(frames.map((frame) => frame.messageType)).toEqual([
              'session.reconnect.capabilities',
              'projection.snapshot',
            ]);
            const view = control.view();
            expect(view.presentation.base.formId).toBe('PLY-001');
            expect(view.presentation.assignment).toEqual({
              reason: 'RECONNECT',
              correlationId: id,
            });
            expect(view.presentation.layers.at(-1)?.roleFilteredPayload).toMatchObject({
              receiptId: site.state().activeReceiptIdOrNull,
              target: { kind: 'PLAYER' },
            });
            expect(check).toHaveBeenCalledTimes(2);
            expect(p.reconnectCount() - before).toBe(1);
            expect(frames[0]).toMatchObject({ reconnectRequestId: id, revisions: view.revisions });
          } else {
            expect(check).toHaveBeenCalledTimes(1);
            expect(p.reconnectCount()).toBe(before);
            expect(pinned.closed).toBe(fault === 'REVOKED');
            expect(frames).toMatchObject([
              {
                messageType: 'navigation.form-action.refusal',
                navigationRequestId: id,
                refusal: { code: 'NAVIGATION_UNAVAILABLE' },
              },
            ]);
          }
        } finally {
          p.runtimeForTest.disconnect(p.c);
          check.mockRestore();
          trust.mockRestore();
          send.mockRestore();
        }
      }
    }, 30_000);
  }
});

describe('confirmed host-local cancellations on one installation', () => {
  type Site = Awaited<ReturnType<typeof createHostLocalRequestSite>>;
  const sites: Site[] = [];
  beforeEach(() => {
    sites.length = 0;
  });
  for (let turn = 0; turn < 3; turn++) {
    beforeEach(async () => {
      sites.push(await createHostLocalRequestSite(1, sites.at(-1)));
    }, 60_000);
    beforeEach(async () => {
      const site = sites[turn]!,
        { p, device, networkScopeId } = site;
      const addressed = site.addressApplicant(),
        control = site.coordinator();
      expect((await control.resume(addressed.key)).presentation.base.formId).toBe('NET-005');
      const request = p.state().requestOrNull!;
      const previous = site.state(),
        id = randomUUID();
      expect(() =>
        beginHostLocalSeatHandoff(
          p.db,
          device,
          {
            commandId: 'host-seat-begin:' + id,
            expectedRevision: previous.revision,
            activeProof: previous.activeProof,
            target: { kind: 'GM', origin: site.origin, destinationFormId: 'NET-017' },
            retireReturnFrom: 'NET-003',
            retireNavigation: {
              navigationRequestId: id,
              expectedProjectionRevision: p.state().projectionRevision,
            },
          },
          () => undefined,
        ),
      ).toThrow(expect.objectContaining({ code: 'FOREIGN_OWNER' }));
      expect(site.state()).toEqual(previous);
      await p.replace('CANCEL_REASON', { cancelReason: 'Withdraw own request' });
      await p.command('UI-CMD-DEVICE-REQUEST-CANCEL', {
        requestId: request.requestId,
        technicalSessionId: request.technicalSessionId,
        requestRevision: request.requestRevision,
        reason: 'Withdraw own request',
      });
      expect(p.sent[0]).toMatchObject({ messageType: 'command.result' });
      const cancel = p.state().requestOrNull?.closureOrNull;
      expect(cancel?.receiptId).toEqual(expect.any(String));
      expect(readOwnedLocalNetworkTab(p.db, device, networkScopeId)?.lifecycleState).toBe(
        'UNBOUND',
      );
      expect((await control.resume(addressed.key)).presentation.base.availableActionKeys).toContain(
        'NET-003::CTA::005',
      );
      expect(
        (await control.navigate('NET-003', 'NET-003::CTA::005')).presentation.layers.at(-1)?.formId,
      ).toBe('PLY-030');
      expect((await control.acceptGmReturn()).snapshot.presentation.base.formId).toBe('NET-017');
      expect(readOwnedLocalNetworkTab(p.db, device, networkScopeId)).toBeNull();
      expect(readLocalNetworkTabClosure(p.db, device, networkScopeId)?.receipt.networkScopeId).toBe(
        networkScopeId,
      );
      expect(readHostLocalTerminalApplicants(p.db, device, site.origin.campaignId)).toEqual([]);
    }, 30_000);
  }
  it('submits a fourth applicant after three confirmed cancellations and keeps their original profiles, FINALs and receipts', async () => {
    const fourth = await createHostLocalRequestSite(1, sites.at(-1));
    const { p, h, device, origin } = fourth;
    expect(p.state().requestOrNull).toMatchObject({
      requestId: fourth.batch.requestId,
      closureOrNull: null,
    });
    expect(readOwnedLocalNetworkTab(p.db, device, fourth.networkScopeId)?.lifecycleState).toBe(
      'PROVISIONAL',
    );
    for (const previous of sites) {
      expect(readOwnedLocalNetworkTab(p.db, device, previous.networkScopeId)).toBeNull();
      expect(readHostLocalScopeOwner(p.db, device, previous.networkScopeId)).toBe(
        previous.profile.targetLocalOwnerId,
      );
      expect(readHostLocalCharacterOwner(p.db, device, previous.ids[0]!)).toBe(
        previous.profile.targetLocalOwnerId,
      );
      expect(previous.gm.runtime.hostSeatApplicant(origin, previous.batch.requestId)).toBeNull();
    }
    expect(new Set([...sites, fourth].map((s) => s.networkScopeId)).size).toBe(4);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM hosted_device_request').get()).toEqual({ n: 4 });
    expect(readHostLocalRoster(p.db, device, origin.campaignId)).toEqual([]);
  }, 60_000);
});

describe('three host-local seats on one physical installation', () => {
  type Site = Awaited<ReturnType<typeof createHostLocalRequestSite>>;
  let first: Site, second: Site;
  let admitted: Awaited<ReturnType<Site['acceptPublication']>>,
    initial: ReturnType<typeof readHostLocalRoster>;
  const review = (mode: 'MIXED' | 'ACCEPT', get: () => Site) =>
    net.reviewSubmitted(mode, () => {
      const site = get();
      return { h: site.h, p: site.p, requestId: site.batch.requestId };
    });
  beforeEach(async () => {
    first = await createHostLocalRequestSite(2);
  }, 60_000);
  review('MIXED', () => first);
  beforeEach(async () => {
    admitted = await first.acceptPublication();
  }, 30_000);
  beforeEach(async () => {
    await admitted.control.navigate('NET-006', 'NET-006::CTA::005');
    const returned = await admitted.control.acceptGmReturn();
    expect(returned.snapshot.presentation.base.formId).toBe('NET-016');
    await admitted.control.socket.restoreGm(first.origin, 'CMP-006', randomUUID(), 'FORM_ACTION');
  }, 30_000);
  beforeEach(async () => {
    second = await createHostLocalRequestSite(1, first);
  }, 60_000);
  review('ACCEPT', () => second);
  beforeEach(async () => {
    initial = readHostLocalRoster(second.p.db, second.device, second.origin.campaignId);
    expect(initial.map((x) => x.profileOwnerId)).toEqual([
      first.profile.targetLocalOwnerId,
      first.profile.targetLocalOwnerId,
    ]);
    // This includes the authenticated proposal read, decision and lobby reopen
    // after the first two controllers have already populated the shared database.
    admitted = await second.acceptPublication();
  }, 60_000);
  it('binds two separate owner admissions and all three controller seats to their exact FINALs', async () => {
    const ordered = readHostLocalRoster(second.p.db, second.device, second.origin.campaignId);
    expect(first.profile.targetProfileLabel).toBe(second.profile.targetProfileLabel);
    expect(first.profile.targetLocalOwnerId).not.toBe(second.profile.targetLocalOwnerId);
    expect(ordered.map((x) => x.diff.sourceUuid)).toEqual([...first.ids, ...second.ids]);
    expect(ordered.map((x) => x.profileOwnerId)).toEqual([
      first.profile.targetLocalOwnerId,
      first.profile.targetLocalOwnerId,
      second.profile.targetLocalOwnerId,
    ]);
    expect(ordered.slice(0, 2)).toEqual(initial);
    expect(new Set(ordered.map((x) => x.binding.localControllerSeatId)).size).toBe(3);
    expect(new Set(ordered.map((x) => x.binding.networkScopeId)).size).toBe(3);
    for (const site of [first, second]) {
      const receipt = readLocalAdmission(
        site.p.db,
        { ownerDeviceId: site.device, networkScopeId: site.networkScopeId },
        site.batch.requestId,
      )?.receiptOrNull;
      expect(receipt?.decision).toBe('ACCEPT');
      const own = ordered.filter((x) => x.profileOwnerId === site.profile.targetLocalOwnerId);
      expect(own.map((x) => x.binding.admissionReceiptId)).toEqual(
        site.ids.map(() => receipt!.receiptId),
      );
      expect(own.map((x) => x.binding.campaignCharacterId)).toEqual(
        receipt!.copies.map((c) => c.campaignCharacterId),
      );
      expect(own.map((x) => x.binding.localControllerSeatId)).toEqual(
        receipt!.copies.map((c) => c.controllerBindingOrNull!.localControllerSeatId),
      );
    }
    await admitted.control.navigate('NET-006', 'NET-006::CTA::005');
    const returned = await admitted.control.acceptGmReturn();
    const badge = returned.snapshot.presentation.layers.at(-1)?.roleFilteredPayload;
    expect(badge?.['seats']).toEqual(
      ordered.map(({ binding, profileOwnerId }, i) => ({
        targetProfileLabel: first.profile.targetProfileLabel,
        targetLocalOwnerId: profileOwnerId,
        localControllerSeatId: binding.localControllerSeatId,
        ordinal: i + 1,
      })),
    );
  }, 30_000);
});
