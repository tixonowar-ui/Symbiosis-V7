import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openPersistenceDatabase } from './database.js';
import { bootstrapDeviceIdentity, resetDeviceIdentity } from './device-identity.js';
import { ordinaryHandoffPresentAtStartup } from './local-seat-handoff.js';
import { ensureDeviceInstallationIdentity } from './network-installation-identity.js';
import { commitNewLocalCharacterCheckpoint } from './store.js';
import { networkApplicationStorage as storage } from './network-local-application.js';
import {
  commitLocalNetworkTabEntry,
  readOwnedLocalNetworkTab,
  readLocalNetworkTabCloseByCommandId,
} from './network-local-tab.js';
import {
  ackHostLocalSeatHandoff,
  beginHostLocalSeatHandoff,
  createHostSeatProfile,
  hostLocalSeatPresentAtStartup,
  openHostLocalProfileScope,
  openHostLocalSeatSetup,
  readHostLocalCharacterOwner,
  readHostLocalScopeOwner,
  readHostLocalProfileScope,
  hostLocalProfileReturnedBeforeSubmit,
  readHostLocalSeatHandoff,
  recordHostLocalCharacterBirth,
  selectHostLocalFinals,
  readHostLocalCharacterCursor,
  saveHostLocalCharacterCursor,
  markHostLocalGmDestination,
  returnHostSeatSetup,
  cancelHostLocalCandidateCurtain,
  type HostLocalSeatTarget,
} from './host-local-seat.js';

const allow = () => undefined;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function installSeatIdentity(db: ReturnType<typeof openPersistenceDatabase>) {
  const device = bootstrapDeviceIdentity(db);
  const pair = generateKeyPairSync('ed25519');
  const spki = pair.publicKey.export({ format: 'der', type: 'spki' });
  ensureDeviceInstallationIdentity(
    db,
    {
      schemaVersion: 1,
      algorithm: 'ED25519',
      ownerDeviceId: device,
      publicKeySpkiBase64: spki.toString('base64'),
      privateKeyPkcs8Base64: pair.privateKey
        .export({ format: 'der', type: 'pkcs8' })
        .toString('base64'),
      keyFingerprintSha256: sha(spki),
    },
    allow,
  );
  return device;
}

it('confirms a first native GM destination from its exact signed setup return after reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'host-seat-gm-native-'));
  const file = join(dir, 'gm.sqlite');
  let db = openPersistenceDatabase(file);
  try {
    const device = installSeatIdentity(db);
    const proof = sha(randomUUID());
    openHostLocalSeatSetup(
      db,
      device,
      {
        commandId: randomUUID(),
        expectedRevision: 0,
        activeProof: null,
        setupProof: proof,
        origin: {
          gmContextId: randomUUID(),
          campaignId: randomUUID(),
          returnFormId: 'CMP-009',
          gmDeliveryProof: proof,
        },
      },
      allow,
    );
    const returned = returnHostSeatSetup(
      db,
      device,
      {
        commandId: randomUUID(),
        expectedRevision: 1,
        activeProof: proof,
        formId: 'PLY-027',
      },
      allow,
    ).receipt;
    db.close();
    db = openPersistenceDatabase(file);
    expect(readHostLocalSeatHandoff(db, device)).toMatchObject({
      gmDestinationConfirmed: false,
      activeReceiptIdOrNull: null,
      activeHandoffIdOrNull: null,
      setupReturnReceiptIdOrNull: returned.receiptId,
    });
    const shown = {
      commandId: 'host-local-setup-shown:' + returned.receiptId,
      expectedRevision: returned.revision,
      activeProof: proof,
      setupReturnReceiptId: returned.receiptId,
    };
    expect(() =>
      markHostLocalGmDestination(db, device, { ...shown, activeProof: sha(randomUUID()) }, allow),
    ).toThrow();
    const foreign = randomUUID();
    expect(() =>
      markHostLocalGmDestination(
        db,
        device,
        {
          ...shown,
          commandId: 'host-local-setup-shown:' + foreign,
          setupReturnReceiptId: foreign,
        },
        allow,
      ),
    ).toThrow();
    const original = markHostLocalGmDestination(db, device, shown, allow);
    db.close();
    db = openPersistenceDatabase(file);
    expect(readHostLocalSeatHandoff(db, device)).toMatchObject({
      gmDestinationConfirmed: true,
      activeReceiptIdOrNull: null,
      activeHandoffIdOrNull: null,
    });
    expect(markHostLocalGmDestination(db, device, shown, allow)).toEqual({
      receipt: original.receipt,
      replayed: true,
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('chooses the current signed handoff after a device reset that retained the previous installation journal', () => {
  const db = openPersistenceDatabase(':memory:');
  try {
    const setup = (device: string) =>
      openHostLocalSeatSetup(
        db,
        device,
        {
          commandId: randomUUID(),
          expectedRevision: 0,
          activeProof: null,
          setupProof: sha(randomUUID()),
          origin: {
            gmContextId: randomUUID(),
            campaignId: randomUUID(),
            returnFormId: 'CMP-009',
            gmDeliveryProof: sha(randomUUID()),
          },
        },
        allow,
      );
    const first = installSeatIdentity(db);
    const original = setup(first);
    expect(readHostLocalSeatHandoff(db, first).revision).toBe(original.receipt.revision);
    expect(hostLocalSeatPresentAtStartup(db)).toBe(true);
    resetDeviceIdentity(db, allow);
    const resetBytes = db.serialize();
    expect(ordinaryHandoffPresentAtStartup(db)).toBe(false);
    expect(hostLocalSeatPresentAtStartup(db)).toBe(false);
    expect(db.serialize().equals(resetBytes)).toBe(true);
    const current = installSeatIdentity(db);
    expect(current).not.toBe(first);
    expect(() => readHostLocalSeatHandoff(db, first)).toThrow(
      expect.objectContaining({ code: 'FOREIGN_OWNER' }),
    );
    expect(ordinaryHandoffPresentAtStartup(db)).toBe(false);
    expect(hostLocalSeatPresentAtStartup(db)).toBe(false);
    expect(readHostLocalSeatHandoff(db, current)).toMatchObject({ revision: 0, setupOrNull: null });
    const fresh = setup(current);
    const signedHeads = db
      .prepare('SELECT owner_device_id,command_id FROM local_seat_handoff_head')
      .all();
    expect(signedHeads).toHaveLength(2);
    expect(signedHeads).toContainEqual({
      owner_device_id: first,
      command_id: original.receipt.commandId,
    });
    expect(signedHeads).toContainEqual({
      owner_device_id: current,
      command_id: fresh.receipt.commandId,
    });
    expect(readHostLocalSeatHandoff(db, current).revision).toBe(fresh.receipt.revision);
    expect(hostLocalSeatPresentAtStartup(db)).toBe(true);
    db.prepare('UPDATE local_seat_handoff_head SET record_sha256=? WHERE owner_device_id=?').run(
      '0'.repeat(64),
      current,
    );
    expect(() => hostLocalSeatPresentAtStartup(db)).toThrow(
      expect.objectContaining({ code: 'CORRUPT_STORAGE' }),
    );
  } finally {
    db.close();
  }
});

it('restores a fresh local candidate at each curtain, isolates its checkpoint and returns the original ACK without granting its role again', () => {
  const directory = mkdtempSync(join(tmpdir(), 'symbiosis-host-seat-'));
  const path = join(directory, 'host.sqlite');
  let db = openPersistenceDatabase(path);
  try {
    const device = installSeatIdentity(db);
    const reopen = () => {
      db.close();
      db = openPersistenceDatabase(path);
    };
    const state = () => readHostLocalSeatHandoff(db, device);
    const revision = () => ({
      commandId: randomUUID(),
      expectedRevision: state().revision,
      activeProof: state().activeProof,
    });
    const origin = {
      gmContextId: randomUUID(),
      campaignId: randomUUID(),
      returnFormId: 'CMP-009',
      gmDeliveryProof: sha('gm'),
    };
    const profile = { targetLocalOwnerId: randomUUID(), targetProfileLabel: 'Один стол' };
    const other = {
      targetLocalOwnerId: randomUUID(),
      targetProfileLabel: profile.targetProfileLabel,
    };
    const candidate: HostLocalSeatTarget = {
      kind: 'CANDIDATE',
      origin,
      profile,
      networkScopeIdOrNull: null,
      requestOrNull: null,
    };
    expect(hostLocalSeatPresentAtStartup(db)).toBe(false);
    openHostLocalSeatSetup(db, device, { ...revision(), origin, setupProof: sha('setup') }, allow);
    createHostSeatProfile(db, device, { ...revision(), origin, profile: other }, allow);
    const creation = { ...revision(), origin, profile };
    const created = createHostSeatProfile(db, device, creation, allow);
    expect(createHostSeatProfile(db, device, creation, allow)).toEqual({
      ...created,
      replayed: true,
    });
    expect(() =>
      createHostSeatProfile(db, device, { ...creation, profile: other }, allow),
    ).toThrow();
    beginHostLocalSeatHandoff(db, device, { ...revision(), target: candidate }, allow);
    const pending = state().pending!;
    reopen();
    expect(hostLocalSeatPresentAtStartup(db)).toBe(true);
    expect(state()).toMatchObject({
      active: null,
      activeProof: null,
      pending,
      profiles: [other, profile],
    });
    const ack = {
      role: 'player' as const,
      commandId: randomUUID(),
      expectedRevision: state().revision,
      handoffId: pending.handoffId,
      signedReturnContext: pending.signedReturnContext,
      decision: 'ACTIVATE_TARGET' as const,
      recipientProof: sha('candidate'),
    };
    expect(() =>
      ackHostLocalSeatHandoff(db, device, { ...ack, signedReturnContext: sha('other') }, allow),
    ).toThrow();
    expect(() =>
      ackHostLocalSeatHandoff(db, device, { ...ack, recipientProof: sha('setup') }, allow),
    ).toThrow();
    const activated = ackHostLocalSeatHandoff(db, device, ack, allow);
    const candidateAckReceiptId = activated.receipt.receiptId;
    const firstContext = activated.receipt.candidateContextId;
    expect(firstContext).toEqual(expect.any(String));
    expect([
      profile.targetLocalOwnerId,
      origin.gmContextId,
      pending.handoffId,
      candidateAckReceiptId,
    ]).not.toContain(firstContext);
    reopen();
    expect(state().candidateContextIdOrNull).toBe(firstContext);
    const id = randomUUID(),
      checkpointId = 'opaque-wizard-key';
    const birth = { ...revision(), candidateAckReceiptId, checkpointId, localCharacterId: id };
    expect(() =>
      commitNewLocalCharacterCheckpoint(db, id, checkpointId, (create) => create('DRAFT', '{}'), {
        bindOwnerToDeviceId: device,
        recordHostLocalBirth: () => {
          recordHostLocalCharacterBirth(
            db,
            device,
            { ...birth, activeProof: sha('someone else') },
            allow,
          );
        },
      }),
    ).toThrow();
    expect(
      db.prepare('SELECT 1 FROM local_character WHERE local_character_id=?').get(id),
    ).toBeUndefined();
    expect(readHostLocalCharacterCursor(db, device, profile.targetLocalOwnerId)).toBeNull();
    commitNewLocalCharacterCheckpoint(db, id, checkpointId, (create) => create('DRAFT', '{}'), {
      bindOwnerToDeviceId: device,
      recordHostLocalBirth: () => {
        recordHostLocalCharacterBirth(db, device, birth, allow);
      },
    });
    expect(readHostLocalCharacterOwner(db, device, id)).toBe(profile.targetLocalOwnerId);
    reopen();
    expect(readHostLocalCharacterCursor(db, device, profile.targetLocalOwnerId)).toEqual({
      localCharacterId: id,
      formId: 'CHR-010',
    });
    expect(readHostLocalCharacterCursor(db, device, other.targetLocalOwnerId)).toBeNull();
    expect(readHostLocalCharacterOwner(db, device, id)).toBe(profile.targetLocalOwnerId);
    const otherConnection = openPersistenceDatabase(path);
    try {
      const original = otherConnection
        .prepare<[], { record_sha256: string }>(
          'SELECT record_sha256 FROM local_seat_handoff_event WHERE revision=1',
        )
        .get()!;
      const update = otherConnection.prepare(
        'UPDATE local_seat_handoff_event SET record_sha256=? WHERE revision=1',
      );
      update.run('0'.repeat(64));
      expect(() => readHostLocalCharacterOwner(db, device, id)).toThrow();
      update.run(original.record_sha256);
      expect(readHostLocalCharacterOwner(db, device, id)).toBe(profile.targetLocalOwnerId);
      expect(() =>
        db.transaction(() => {
          db.prepare('UPDATE local_seat_handoff_event SET record_sha256=? WHERE revision=1').run(
            'f'.repeat(64),
          );
          readHostLocalCharacterOwner(db, device, id);
        })(),
      ).toThrow();
      expect(readHostLocalCharacterOwner(db, device, id)).toBe(profile.targetLocalOwnerId);
    } finally {
      otherConnection.close();
    }
    const cursor = { ...revision(), localCharacterId: id, formId: 'CHR-026' };
    const savedCursor = saveHostLocalCharacterCursor(db, device, cursor, allow);
    expect(saveHostLocalCharacterCursor(db, device, cursor, allow)).toEqual({
      ...savedCursor,
      replayed: true,
    });
    const previous = randomUUID();
    commitNewLocalCharacterCheckpoint(
      db,
      previous,
      'unchanged-owner',
      (create) => create('DRAFT', '{}'),
      { bindOwnerToDeviceId: device },
    );
    expect(() =>
      recordHostLocalCharacterBirth(
        db,
        device,
        {
          ...revision(),
          candidateAckReceiptId,
          localCharacterId: previous,
          checkpointId: 'unchanged-owner',
        },
        allow,
      ),
    ).toThrow();
    expect(readHostLocalCharacterOwner(db, device, previous)).toBeNull();
    expect(() =>
      saveHostLocalCharacterCursor(
        db,
        device,
        { ...revision(), localCharacterId: previous, formId: 'CHR-040' },
        allow,
      ),
    ).toThrow();
    expect(readHostLocalCharacterCursor(db, device, profile.targetLocalOwnerId)).toEqual({
      localCharacterId: id,
      formId: 'CHR-026',
    });
    saveHostLocalCharacterCursor(
      db,
      device,
      { ...revision(), localCharacterId: null, formId: 'APP-004' },
      allow,
    );
    expect(readHostLocalCharacterCursor(db, device, profile.targetLocalOwnerId)).toBeNull();
    expect(() =>
      selectHostLocalFinals(
        db,
        device,
        { ...revision(), formId: 'APP-003', selectedSourceUuids: [previous] },
        allow,
      ),
    ).toThrow();
    const networkScopeId = randomUUID(),
      entryCommandId = randomUUID(),
      rev = state().revision;
    const tab = {
      ownerDeviceId: device,
      networkScopeId,
      tabId: randomUUID(),
      entryCommandId,
      entryReceiptId: randomUUID(),
      sourceContextId: profile.targetLocalOwnerId,
      sourceRevisions: {
        stateRevision: rev,
        projectionRevision: rev,
        actorVisibilityRevision: rev,
      },
      applicationEntry: {
        schemaVersion: 1 as const,
        sourceFinalUuidOrNull: null,
        clientRequestJson: storage.canonical({
          messageType: 'navigation.form-action',
          protocolVersion: 2,
          navigationRequestId: entryCommandId,
          sourceFormId: 'APP-003',
          actionKey: 'APP-003::CTA::009',
          expectedProjectionRevision: rev,
        }),
      },
    };
    expect(() => commitLocalNetworkTabEntry(db, tab, allow)).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
    const attach = {
      ...revision(),
      commandId: 'host-local-scope:' + entryCommandId,
      networkScopeId,
      candidateAckReceiptId,
    };
    expect(() =>
      openHostLocalProfileScope(
        db,
        device,
        { ...attach, candidateAckReceiptId: randomUUID() },
        tab,
        allow,
        allow,
      ),
    ).toThrow();
    expect(() => readOwnedLocalNetworkTab(db, device, networkScopeId)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    openHostLocalProfileScope(db, device, attach, tab, allow, allow);
    expect(readHostLocalScopeOwner(db, device, networkScopeId)).toBe(profile.targetLocalOwnerId);
    reopen();
    expect(state().candidateSelectionOrNull?.networkEntry).toEqual({
      navigationRequestId: entryCommandId,
      expectedProjectionRevision: rev,
    });
    selectHostLocalFinals(
      db,
      device,
      { ...revision(), formId: 'APP-003', selectedSourceUuids: [] },
      allow,
    );
    const nextNavigation = randomUUID(),
      resumable = {
        ...revision(),
        commandId: 'host-local-network:' + nextNavigation,
        formId: 'NET-003' as const,
        selectedSourceUuids: [],
      };
    selectHostLocalFinals(db, device, resumable, allow);
    reopen();
    expect(state().candidateSelectionOrNull?.networkEntry).toEqual({
      navigationRequestId: nextNavigation,
      expectedProjectionRevision: resumable.expectedRevision,
    });
    const earlyTarget = { kind: 'GM' as const, origin, destinationFormId: 'CMP-009' };
    expect(() =>
      beginHostLocalSeatHandoff(db, device, { ...revision(), target: earlyTarget }, allow),
    ).toThrow(expect.objectContaining({ code: 'FOREIGN_OWNER' }));
    expect(readOwnedLocalNetworkTab(db, device, networkScopeId)?.tabId).toBe(tab.tabId);
    selectHostLocalFinals(
      db,
      device,
      { ...revision(), formId: 'APP-003', selectedSourceUuids: [] },
      allow,
    );
    const early = { ...revision(), target: earlyTarget };
    const begun = beginHostLocalSeatHandoff(db, device, early, allow);
    reopen();
    expect(readOwnedLocalNetworkTab(db, device, networkScopeId)).toBeNull();
    const closure = readLocalNetworkTabCloseByCommandId(
      db,
      device,
      'host-local-pre-submit-close:' + begun.receipt.receiptId,
    );
    expect(closure?.receipt).toMatchObject({
      networkScopeId,
      tabId: tab.tabId,
      activePointerCleared: true,
      result: 'CLOSED',
    });
    expect(begun.receipt.closedTabReceiptSha256).toBe(sha(storage.canonical(closure)));
    expect(
      readHostLocalProfileScope(db, device, profile.targetLocalOwnerId, origin.campaignId),
    ).toBeNull();
    expect(readHostLocalScopeOwner(db, device, networkScopeId)).toBe(profile.targetLocalOwnerId);
    expect(
      hostLocalProfileReturnedBeforeSubmit(
        db,
        device,
        profile.targetLocalOwnerId,
        origin.campaignId,
      ),
    ).toBe(false);
    expect(beginHostLocalSeatHandoff(db, device, early, allow)).toEqual({
      ...begun,
      replayed: true,
    });
    const returning = state().pending!;
    expect(() =>
      ackHostLocalSeatHandoff(
        db,
        device,
        {
          ...ack,
          commandId: randomUUID(),
          expectedRevision: state().revision,
          handoffId: returning.handoffId,
          signedReturnContext: returning.signedReturnContext,
        },
        allow,
      ),
    ).toThrow();
    ackHostLocalSeatHandoff(
      db,
      device,
      {
        ...ack,
        commandId: randomUUID(),
        expectedRevision: state().revision,
        handoffId: returning.handoffId,
        signedReturnContext: returning.signedReturnContext,
        role: 'gm',
        decision: 'RETURN_INITIATOR',
        recipientProof: sha('returned-gm'),
      },
      allow,
    );
    expect(
      hostLocalProfileReturnedBeforeSubmit(
        db,
        device,
        profile.targetLocalOwnerId,
        origin.campaignId,
      ),
    ).toBe(true);
    expect(
      hostLocalProfileReturnedBeforeSubmit(db, device, other.targetLocalOwnerId, origin.campaignId),
    ).toBe(false);
    expect(
      hostLocalProfileReturnedBeforeSubmit(db, device, profile.targetLocalOwnerId, randomUUID()),
    ).toBe(false);
    expect(() =>
      beginHostLocalSeatHandoff(
        db,
        device,
        { ...revision(), target: { ...candidate, profile: other } },
        allow,
      ),
    ).toThrow(expect.objectContaining({ code: 'FOREIGN_OWNER' }));
    const destination = state();
    expect(destination.gmDestinationConfirmed).toBe(false);
    const confirmed = {
      ...revision(),
      commandId: 'host-local-shown:' + destination.activeReceiptIdOrNull!,
      ackReceiptId: destination.activeReceiptIdOrNull!,
    };
    expect(() =>
      markHostLocalGmDestination(
        db,
        device,
        { ...confirmed, ackReceiptId: candidateAckReceiptId },
        allow,
      ),
    ).toThrow();
    const shown = markHostLocalGmDestination(db, device, confirmed, allow);
    const gm = state();
    expect(gm).toMatchObject({ active: { kind: 'GM' }, gmDestinationConfirmed: true });
    expect(markHostLocalGmDestination(db, device, confirmed, allow)).toEqual({
      ...shown,
      replayed: true,
    });
    reopen();
    expect(ackHostLocalSeatHandoff(db, device, ack, allow)).toEqual({
      ...activated,
      replayed: true,
    });
    expect(() =>
      ackHostLocalSeatHandoff(db, device, { ...ack, recipientProof: sha('new') }, allow),
    ).toThrow();
    expect(() => ackHostLocalSeatHandoff(db, device, { ...ack, role: 'gm' }, allow)).toThrow();
    expect(state()).toEqual(gm);
    expect(readHostLocalCharacterOwner(db, device, id)).toBe(profile.targetLocalOwnerId);
    openHostLocalSeatSetup(db, device, { ...revision(), origin, setupProof: sha('setup2') }, allow);
    const setupReturn = returnHostSeatSetup(
      db,
      device,
      { ...revision(), formId: 'PLY-027' },
      allow,
    );
    reopen();
    expect(state()).toMatchObject({
      gmDestinationConfirmed: false,
      active: { kind: 'GM', destinationFormId: 'PLY-027' },
      activeReceiptIdOrNull: gm.activeReceiptIdOrNull,
      activeHandoffIdOrNull: gm.activeHandoffIdOrNull,
      setupReturnReceiptIdOrNull: setupReturn.receipt.receiptId,
    });
    const nextConfirmation = {
      ...revision(),
      setupReturnReceiptId: setupReturn.receipt.receiptId,
      commandId: 'host-local-setup-shown:' + setupReturn.receipt.receiptId,
    };
    const shownAgain = markHostLocalGmDestination(db, device, nextConfirmation, allow);
    expect(shownAgain.receipt.receiptId).not.toBe(shown.receipt.receiptId);
    reopen();
    const gmAgain = state();
    expect(gmAgain).toMatchObject({
      gmDestinationConfirmed: true,
      activeReceiptIdOrNull: gm.activeReceiptIdOrNull,
      activeHandoffIdOrNull: gm.activeHandoffIdOrNull,
      revision: shownAgain.receipt.revision,
    });
    expect(markHostLocalGmDestination(db, device, confirmed, allow)).toEqual({
      ...shown,
      replayed: true,
    });
    expect(markHostLocalGmDestination(db, device, nextConfirmation, allow)).toEqual({
      ...shownAgain,
      replayed: true,
    });
    expect(state()).toEqual(gmAgain);
    openHostLocalSeatSetup(db, device, { ...revision(), origin, setupProof: sha('setup3') }, allow);
    beginHostLocalSeatHandoff(
      db,
      device,
      { ...revision(), target: { ...candidate, profile: other } },
      allow,
    );
    const old = state().pending!;
    const cancellation = {
      commandId: randomUUID(),
      expectedRevision: state().revision,
      handoffId: old.handoffId,
      signedReturnContext: old.signedReturnContext,
    };
    expect(() =>
      cancelHostLocalCandidateCurtain(
        db,
        device,
        { ...cancellation, signedReturnContext: 'forged' },
        allow,
      ),
    ).toThrow();
    const cancelled = cancelHostLocalCandidateCurtain(db, device, cancellation, allow);
    reopen();
    expect(cancelHostLocalCandidateCurtain(db, device, cancellation, allow)).toEqual({
      ...cancelled,
      replayed: true,
    });
    expect(state()).toMatchObject({
      active: null,
      pending: { target: { kind: 'GM', destinationFormId: 'CMP-009' } },
    });
    expect(state().pending!.handoffId).not.toBe(old.handoffId);
    const cancelledReturn = state().pending!;
    ackHostLocalSeatHandoff(
      db,
      device,
      {
        commandId: randomUUID(),
        expectedRevision: state().revision,
        role: 'gm',
        handoffId: cancelledReturn.handoffId,
        signedReturnContext: cancelledReturn.signedReturnContext,
        decision: 'RETURN_INITIATOR',
        recipientProof: sha('cancelled-return'),
      },
      allow,
    );
    expect(state().candidateContextIdOrNull).toBeNull();
    // An older signed journal can contain its first ACK-based confirmation after a return from setup.
    const oldAck = state().activeReceiptIdOrNull!;
    openHostLocalSeatSetup(
      db,
      device,
      { ...revision(), origin, setupProof: sha('legacy-setup') },
      allow,
    );
    returnHostSeatSetup(db, device, { ...revision(), formId: 'CMP-009' }, allow);
    const legacyConfirmation = {
      ...revision(),
      commandId: 'host-local-shown:' + oldAck,
      ackReceiptId: oldAck,
    };
    const legacyShown = markHostLocalGmDestination(db, device, legacyConfirmation, allow);
    reopen();
    expect(state()).toMatchObject({ activeReceiptIdOrNull: oldAck, gmDestinationConfirmed: true });
    expect(markHostLocalGmDestination(db, device, legacyConfirmation, allow)).toEqual({
      ...legacyShown,
      replayed: true,
    });
    openHostLocalSeatSetup(db, device, { ...revision(), origin, setupProof: sha('setup4') }, allow);
    beginHostLocalSeatHandoff(
      db,
      device,
      { ...revision(), target: { ...candidate, profile: other } },
      allow,
    );
    const second = state().pending!;
    const secondAck = ackHostLocalSeatHandoff(
      db,
      device,
      {
        ...ack,
        expectedRevision: state().revision,
        commandId: randomUUID(),
        handoffId: second.handoffId,
        signedReturnContext: second.signedReturnContext,
        recipientProof: sha('other-candidate'),
      },
      allow,
    );
    expect(secondAck.receipt.candidateContextId).toEqual(expect.any(String));
    expect([firstContext, other.targetLocalOwnerId]).not.toContain(
      secondAck.receipt.candidateContextId,
    );
    reopen();
    expect(ackHostLocalSeatHandoff(db, device, ack, allow).receipt.candidateContextId).toBe(
      firstContext,
    );
    expect(state()).toMatchObject({
      active: { kind: 'CANDIDATE', profile: other },
      candidateContextIdOrNull: secondAck.receipt.candidateContextId,
    });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
