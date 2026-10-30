import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import { openPersistenceDatabase } from './database.js';
import { bootstrapDeviceIdentity, resetDeviceIdentity } from './device-identity.js';
import {
  commitLocalCharacterCheckpoint,
  commitNewLocalCharacterCheckpoint,
  createLocalCharacter,
  loadLocalCharacterCheckpoint,
  readLocalCharacter,
  type RevisionTriple,
} from './store.js';
import { migration0001 } from './migrations/0001-initial.js';
import { migration0002 } from './migrations/0002-local-character-checkpoint.js';
import { migration0003 } from './migrations/0003-device-identity.js';
import { migration0004 } from './migrations/0004-skill-presentation.js';
import { migration0005 } from './migrations/0005-symbiont-presentation.js';
import { applyMigrationSequence, applyMigrations } from './migrations/index.js';
import {
  assertLocalCharacterOwnedByDevice,
  readLocalCharacterOwner,
  createPostSaveHead,
  readPostSaveHead,
  updatePostSavePresentation,
  commitPostSaveCommand,
  readPostSaveCommand,
  readPostSaveHeadById,
  readPostSaveCommandById,
  readPostSaveCursor,
  readPostSaveRestoreCommand,
  writePostSaveCursor,
  readLocalMetadataHistory,
  prepareLocalCharacterWriteIntent,
  readLocalCharacterWriteIntent,
  clearLocalCharacterWriteIntent,
  initializeVariantCharacterCheckpoint,
  type LocalMetadataValues,
  type PostSaveScope,
  type PostSaveHead,
  type PostSaveCommandInput,
  type PostSaveCommandWriter,
} from './local-character-post-save.js';

const databases: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

it('restores only the exact cursor and journal binding after reopen, never a newer head', () => {
  const dir = mkdtempSync(join(tmpdir(), 'post-save-cursor-'));
  directories.push(dir);
  const path = join(dir, 'local.sqlite');
  const p = setup('FINAL', path);
  const saved = patch(p, 'cursor-metadata');
  writePostSaveCursor(p.db, p.scope);
  const other = {
    ...p.scope,
    scopeId: 'second-scope',
    sourceBinding: { kind: 'FINAL', origin: 'APP-004' },
  };
  createPostSaveHead(p.db, other, { formId: 'APP-010' }, p.validate);
  expect(readPostSaveCursor(p.db, p.device)?.scope.scopeId).toBe(p.scope.scopeId);
  p.db.close();
  const reopened = openPersistenceDatabase(path);
  databases.push(reopened);
  expect(readPostSaveHeadById(reopened, other.scopeId, p.device)?.metadataRevision).toBe(1);
  expect(readPostSaveCursor(reopened, p.device)?.scope.scopeId).toBe(p.scope.scopeId);
  writePostSaveCursor(reopened, null);
  expect(readPostSaveCursor(reopened, p.device)).toBeNull();
  expect(readPostSaveCommandById(reopened, 'cursor-metadata', p.device)?.command).toEqual(
    saved.command,
  );
  expect(() => readPostSaveCommandById(reopened, 'cursor-metadata', 'foreign')).toThrow();
  writePostSaveCursor(reopened, p.scope);
  reopened
    .prepare('UPDATE local_character_post_save_cursor SET scope_binding_sha256 = ?')
    .run('a'.repeat(64));
  expect(() => readPostSaveCursor(reopened, p.device)).toThrow(/binding differs/u);
  resetDeviceIdentity(reopened, () => {});
  expect(() => readPostSaveHeadById(reopened, p.scope.scopeId, p.device)).toThrow();
});
const zero: RevisionTriple = {
  stateRevision: 0,
  projectionRevision: 0,
  actorVisibilityRevision: 0,
};
const revisions = (head: RevisionTriple): RevisionTriple => ({
  stateRevision: head.stateRevision,
  projectionRevision: head.projectionRevision,
  actorVisibilityRevision: head.actorVisibilityRevision,
});
const metadata: LocalMetadataValues = {
  name: 'Original',
  description: null,
  artAssetKeyOrLocalFile: null,
};
function setup(state: 'DRAFT' | 'FINAL' = 'FINAL', path = ':memory:') {
  const db = openPersistenceDatabase(path);
  databases.push(db);
  const device = bootstrapDeviceIdentity(db);
  commitNewLocalCharacterCheckpoint(
    db,
    'character',
    'checkpoint',
    (create) => create(state, '{"immutable":"creation-proof"}'),
    { bindOwnerToDeviceId: device },
  );
  const complete = loadLocalCharacterCheckpoint(db, 'character');
  const scope: PostSaveScope = {
    scopeId: 'scope',
    entityId: 'character',
    entityKind: state === 'FINAL' ? 'LOCAL_FINAL' : 'CHARACTER_DRAFT',
    ownerContext: 'PLAYER_LOCAL',
    ownerDeviceId: device,
    baseRevisions: zero,
    baseSnapshotSha256: complete.snapshotSha256,
    sourceBinding: {
      kind: state,
      checkpointId: complete.checkpointId,
      checkpointRevision: complete.checkpointRevision,
    },
  };
  const validate = () => {
    expect(loadLocalCharacterCheckpoint(db, 'character')).toEqual(complete);
    expect(readLocalCharacter(db, 'character').lifecycleState).toBe(state);
  };
  createPostSaveHead(db, scope, { formId: state === 'FINAL' ? 'CHR-040' : 'APP-009' }, validate);
  return { db, device, scope, complete, validate };
}
type Setup = ReturnType<typeof setup>;
function input(p: Setup, kind: string, id: string): PostSaveCommandInput {
  return {
    scope: p.scope,
    expectedRevisions: revisions(readPostSaveHead(p.db, p.scope)!),
    commandId: id,
    receiptId: `${id}-receipt`,
    commandKind: kind,
    request: { commandId: id, workflowCommandId: kind, payload: { sourceId: p.scope.entityId } },
    impact: {
      stateChanged: kind.includes('PATCH') || kind.includes('VARIANT'),
      projectionChanged: kind.includes('PATCH') || kind.includes('VARIANT'),
      actorVisibilityChanged: false,
    },
  };
}
function restoreInput(p: Setup, id: string): PostSaveCommandInput {
  const command = input(p, 'UI-CMD-LOCAL-CHECKPOINT-RESTORE', id);
  return {
    ...command,
    request: {
      commandId: id,
      commandKind: 'workflow-command',
      workflowCommandId: command.commandKind,
      messageType: 'command.request',
      protocolVersion: 1,
      role: 'player',
      expectedRevisions: { ...command.expectedRevisions },
      payload: {
        stage: 'LOCAL_CHARACTER_POST_SAVE',
        variant: 'RESTORE',
        sourceFormId: 'APP-009',
        postSaveScopeId: p.scope.scopeId,
        sourceBindingHash: hash(JSON.stringify(p.scope.sourceBinding)),
        sourceEntityId: p.scope.entityId,
        expectedMetadataRevisionOrNull: null,
      },
    },
  };
}
function restoreReceipt(p: Setup, command: PostSaveCommandInput, head: PostSaveHead): JsonObject {
  return receipt(command, head, {
    stage: 'LOCAL_CHARACTER_POST_SAVE',
    variant: 'RESTORE',
    sourceFormId: 'APP-009',
    postSaveScopeId: p.scope.scopeId,
    sourceBindingHash: hash(JSON.stringify(p.scope.sourceBinding)),
    sourceEntityId: p.scope.entityId,
    sourceRevisions: { ...command.expectedRevisions },
    targetEntityId: p.scope.entityId,
    targetRevisions: { ...revisions(p.complete) },
    nextFormId: 'CHR-025',
    localMetadataRevision: null,
    createdVariantUuidOrNull: null,
    downloadOrNull: null,
    restoredCheckpointOrNull: {
      ownerId: p.scope.entityId,
      ownerDeviceId: p.device,
      checkpointId: p.complete.checkpointId,
      checkpointRevision: p.complete.checkpointRevision,
      checkpointSha256: p.complete.snapshotSha256,
      resumeFormId: 'CHR-025',
    },
  });
}

describe('receipt-backed restore cursor', () => {
  function restored(p: Setup) {
    const command = restoreInput(p, 'restore-awaiting-successor');
    return commitPostSaveCommand(p.db, command, p.validate, (_writer, next) => {
      writePostSaveCursor(p.db, p.scope, command.commandId);
      return restoreReceipt(p, command, next);
    });
  }
  it('retires only a matching restore cursor in the next changed checkpoint transaction, preserving no-op and other drafts', () => {
    const p = setup('DRAFT');
    const saved = restored(p);
    const original = readLocalCharacter(p.db, p.scope.entityId);
    commitLocalCharacterCheckpoint(p.db, p.scope.entityId, p.complete.checkpointId, (write) =>
      write(
        { payloadJson: original.payloadJson },
        { stateChanged: false, projectionChanged: false, actorVisibilityChanged: false },
      ),
    );
    expect(readPostSaveRestoreCommand(p.db, p.device)?.command).toEqual(saved.command);
    commitNewLocalCharacterCheckpoint(
      p.db,
      'other',
      'other-checkpoint',
      (create) => create('DRAFT', '{}'),
      { bindOwnerToDeviceId: p.device },
    );
    commitLocalCharacterCheckpoint(p.db, 'other', 'other-checkpoint', (write) =>
      write(
        { payloadJson: '{"changed":true}' },
        { stateChanged: true, projectionChanged: true, actorVisibilityChanged: false },
      ),
    );
    expect(readPostSaveRestoreCommand(p.db, p.device)?.command).toEqual(saved.command);
    commitLocalCharacterCheckpoint(p.db, p.scope.entityId, p.complete.checkpointId, (write) =>
      write(
        { payloadJson: original.payloadJson },
        { stateChanged: false, projectionChanged: true, actorVisibilityChanged: false },
      ),
    );
    expect(readPostSaveRestoreCommand(p.db, p.device)).toBeNull();
    expect(readPostSaveCursor(p.db, p.device)).toBeNull();
    expect(readPostSaveCommandById(p.db, saved.command.commandId, p.device)?.command).toEqual(
      saved.command,
    );
    writePostSaveCursor(p.db, p.scope);
    commitLocalCharacterCheckpoint(p.db, p.scope.entityId, p.complete.checkpointId, (write) =>
      write(
        { payloadJson: '{"next":"snapshot"}' },
        { stateChanged: true, projectionChanged: true, actorVisibilityChanged: false },
      ),
    );
    expect(readPostSaveCursor(p.db, p.device)?.scope).toEqual(p.scope);
  });
  it('rolls back the successor snapshot together with a failed cursor retirement', () => {
    const p = setup('DRAFT');
    const saved = restored(p);
    const original = readLocalCharacter(p.db, p.scope.entityId);
    p.db.exec(
      "CREATE TRIGGER fail_retire BEFORE DELETE ON local_character_post_save_cursor BEGIN SELECT RAISE(ABORT, 'retirement failed'); END",
    );
    expect(() =>
      commitLocalCharacterCheckpoint(p.db, p.scope.entityId, p.complete.checkpointId, (write) =>
        write(
          { payloadJson: '{"next":true}' },
          { stateChanged: true, projectionChanged: true, actorVisibilityChanged: false },
        ),
      ),
    ).toThrow('retirement failed');
    expect(readLocalCharacter(p.db, p.scope.entityId)).toEqual(original);
    expect(loadLocalCharacterCheckpoint(p.db, p.scope.entityId)).toEqual(p.complete);
    expect(readPostSaveRestoreCommand(p.db, p.device)?.command).toEqual(saved.command);
  });
  it.each([
    'missing-table',
    'missing-campaign-table',
    'missing-installation-table',
    'missing-network-tab-table',
    'missing-network-close-table',
    'missing-network-application-table',
    'unknown-version',
  ] as const)(
    'does not downgrade a version-10 store when %s invalidates cursor retirement',
    (damage) => {
      const p = setup('DRAFT');
      const original = readLocalCharacter(p.db, p.scope.entityId);
      if (damage === 'missing-table') p.db.exec('DROP TABLE local_character_post_save_cursor');
      else if (damage === 'missing-campaign-table') p.db.exec('DROP TABLE campaign_draft_update');
      else if (damage === 'missing-installation-table')
        p.db.exec('DROP TABLE device_installation_identity');
      else if (damage === 'missing-network-tab-table')
        p.db.exec('DROP TABLE local_network_active_tab');
      else if (damage === 'missing-network-close-table')
        p.db.exec('DROP TABLE local_network_tab_close');
      else if (damage === 'missing-network-application-table')
        p.db.exec('DROP TABLE local_network_host_pin');
      else p.db.prepare('UPDATE schema_migration SET version = 11 WHERE version = 10').run();
      expect(() =>
        commitLocalCharacterCheckpoint(p.db, p.scope.entityId, p.complete.checkpointId, (write) =>
          write(
            { payloadJson: '{"next":true}' },
            { stateChanged: true, projectionChanged: true, actorVisibilityChanged: false },
          ),
        ),
      ).toThrow();
      expect(readLocalCharacter(p.db, p.scope.entityId)).toEqual(original);
    },
  );
  it('atomically closes APP-009 and recovers its exact receipt after a crash with a newer second draft present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'restore-cursor-'));
    directories.push(dir);
    const path = join(dir, 'local.sqlite');
    const p = setup('DRAFT', path);
    const tail = prepareIntent(p);
    commitNewLocalCharacterCheckpoint(
      p.db,
      'second-character',
      'second-checkpoint',
      (create) => create('DRAFT', '{"other":"character"}'),
      { bindOwnerToDeviceId: p.device },
    );
    const secondComplete = loadLocalCharacterCheckpoint(p.db, 'second-character');
    const secondScope: PostSaveScope = {
      ...p.scope,
      scopeId: 'newer-scope',
      entityId: 'second-character',
      baseSnapshotSha256: secondComplete.snapshotSha256,
      sourceBinding: { kind: 'DRAFT', checkpointId: 'second-checkpoint', checkpointRevision: 0 },
    };
    createPostSaveHead(p.db, secondScope, { formId: 'APP-009' }, () => {});
    writePostSaveCursor(p.db, p.scope);
    const command = restoreInput(p, 'restore-before-crash');
    const saved = commitPostSaveCommand(p.db, command, p.validate, (writer, next) => {
      writer.discardIntent(tail, () => {});
      writePostSaveCursor(p.db, p.scope, command.commandId);
      expect(readPostSaveCommand(p.db, command.commandId, p.scope)).toBeNull();
      return restoreReceipt(p, command, next);
    });
    expect(readPostSaveCursor(p.db, p.device)).toBeNull();
    p.db.close();
    const reopened = openPersistenceDatabase(path);
    databases.push(reopened);
    expect(readPostSaveCursor(reopened, p.device)).toBeNull();
    expect(readPostSaveRestoreCommand(reopened, p.device)).toEqual({
      command: saved.command,
      head: saved.head,
    });
    expect(readLocalCharacterWriteIntent(reopened, p.scope.entityId)).toBeNull();
    expect(loadLocalCharacterCheckpoint(reopened, p.scope.entityId)).toEqual(p.complete);
    expect(loadLocalCharacterCheckpoint(reopened, 'second-character')).toEqual(secondComplete);
    writePostSaveCursor(reopened, secondScope);
    expect(readPostSaveRestoreCommand(reopened, p.device)).toBeNull();
    expect(readPostSaveCursor(reopened, p.device)?.scope.entityId).toBe('second-character');
    writePostSaveCursor(reopened, null);
    expect(readPostSaveRestoreCommand(reopened, p.device)).toBeNull();
    expect(readPostSaveCommandById(reopened, command.commandId, p.device)?.command).toEqual(
      saved.command,
    );
  });
  it('rolls back cursor and intent together on failure before or after journal insertion', () => {
    const p = setup('DRAFT');
    const tail = prepareIntent(p);
    writePostSaveCursor(p.db, p.scope);
    const before = readPostSaveCursor(p.db, p.device);
    const command = restoreInput(p, 'restore-rollback');
    expect(() =>
      p.db
        .transaction(() => writePostSaveCursor(p.db, p.scope, 'unbound-future-command'))
        .immediate(),
    ).toThrow(/active restore transaction/u);
    expect(() =>
      commitPostSaveCommand(p.db, command, p.validate, (writer) => {
        writer.discardIntent(tail, () => {});
        writePostSaveCursor(p.db, p.scope, command.commandId);
        throw new Error('crash before journal');
      }),
    ).toThrow('crash before journal');
    expect(readPostSaveCursor(p.db, p.device)).toEqual(before);
    expect(readLocalCharacterWriteIntent(p.db, p.scope.entityId)).toEqual(tail);
    p.db.exec(
      'CREATE TRIGGER lose_restore_cursor AFTER INSERT ON local_character_post_save_command BEGIN DELETE FROM local_character_post_save_cursor; END',
    );
    expect(() =>
      commitPostSaveCommand(p.db, command, p.validate, (writer, next) => {
        writer.discardIntent(tail, () => {});
        writePostSaveCursor(p.db, p.scope, command.commandId);
        return restoreReceipt(p, command, next);
      }),
    ).toThrow(/cursor changed/u);
    expect(readPostSaveCursor(p.db, p.device)).toEqual(before);
    expect(readLocalCharacterWriteIntent(p.db, p.scope.entityId)).toEqual(tail);
    expect(readPostSaveCommand(p.db, command.commandId, p.scope)).toBeNull();
  });
  it('rejects changed cursor pointers and checksummed foreign receipt targets, without guessing a destination', () => {
    const p = setup('DRAFT');
    const command = restoreInput(p, 'restore-bound');
    const saved = commitPostSaveCommand(p.db, command, p.validate, (_writer, next) => {
      writePostSaveCursor(p.db, p.scope, command.commandId);
      return restoreReceipt(p, command, next);
    });
    expect(() => readPostSaveRestoreCommand(p.db, 'other-device')).toThrow();
    p.db.prepare('UPDATE local_character_post_save_cursor SET restore_command_id = NULL').run();
    expect(() => readPostSaveCursor(p.db, p.device)).toThrow(/binding differs/u);
    writePostSaveCursor(p.db, p.scope, command.commandId);
    const altered = structuredClone(saved.command.receipt) as {
      result: { targetEntityId: string };
    };
    altered.result.targetEntityId = 'second-character';
    const receiptJson = JSON.stringify(altered);
    p.db
      .prepare(
        'UPDATE local_character_post_save_command SET receipt_json = ?, receipt_sha256 = ? WHERE command_id = ?',
      )
      .run(receiptJson, hash(receiptJson), command.commandId);
    expect(() => readPostSaveRestoreCommand(p.db, p.device)).toThrow(/binding differs/u);
    expect(() => readPostSaveCursor(p.db, p.device)).toThrow(/binding differs/u);
  });
});
const receipt = (
  command: PostSaveCommandInput,
  head: PostSaveHead,
  result: JsonObject = {},
): JsonObject => ({
  commandId: command.commandId,
  receiptId: command.receiptId,
  revisions: { ...revisions(head) },
  result,
});
function patch(p: Setup, id: string, values: LocalMetadataValues = { ...metadata, name: id }) {
  const command = input(p, 'UI-CMD-CHAR-LOCAL-METADATA-PATCH', id);
  return commitPostSaveCommand(p.db, command, p.validate, (writer, next) => {
    const saved = writer.appendMetadata(values, metadata);
    return receipt(command, next, { localMetadataRevision: saved.revision });
  });
}
function variant(p: Setup) {
  const command = input(p, 'UI-CMD-CHAR-VARIANT-CREATE', 'make-variant');
  const result = commitPostSaveCommand(p.db, command, p.validate, (writer, next) => {
    writer.createVariant('variant-character', metadata);
    return receipt(command, next, { variantCharacterId: 'variant-character' });
  });
  return {
    command,
    result,
    proof: {
      characterId: 'variant-character',
      checkpointId: 'variant-checkpoint',
      expectedOwnerDeviceId: p.device,
      variantBirthCommandId: command.commandId,
      variantBirthReceiptId: command.receiptId,
      expectedProvisionalPayloadSha256: hash(
        readLocalCharacter(p.db, 'variant-character').payloadJson,
      ),
    },
  };
}
function prepareIntent(p: Setup) {
  return prepareLocalCharacterWriteIntent(
    p.db,
    {
      localCharacterId: 'character',
      ownerDeviceId: p.device,
      checkpointId: 'checkpoint',
      baseCheckpointRevision: p.complete.checkpointRevision,
      baseSnapshotSha256: p.complete.snapshotSha256,
      commandId: 'uncommitted-command',
      intent: { requestedForm: 'CHR-026' },
    },
    () => {},
  );
}

describe('post-save persistence authority and transactions', () => {
  it.each([false, true])(
    'backfills only the already stored device identity, initialized=%s',
    (initialized) => {
      const db = new Database(':memory:');
      databases.push(db);
      db.pragma('foreign_keys = ON');
      applyMigrationSequence(db, [
        migration0001,
        migration0002,
        migration0003,
        migration0004,
        migration0005,
      ]);
      const device = initialized ? bootstrapDeviceIdentity(db) : null;
      createLocalCharacter(db, 'legacy', 'DRAFT', '{}');
      applyMigrations(db);
      expect(readLocalCharacterOwner(db, 'legacy')).toEqual({
        localCharacterId: 'legacy',
        ownerDeviceId: device,
        variantBirthCommandId: null,
      });
      const current = bootstrapDeviceIdentity(db);
      if (initialized)
        expect(assertLocalCharacterOwnedByDevice(db, 'legacy', current).ownerDeviceId).toBe(
          current,
        );
      else
        expect(() => assertLocalCharacterOwnedByDevice(db, 'legacy', current)).toThrow(
          'unbound or foreign',
        );
    },
  );
  it('binds a native owner atomically and never silently rebinds after reset', () => {
    const p = setup();
    expect(() =>
      commitNewLocalCharacterCheckpoint(
        p.db,
        'foreign',
        'foreign-checkpoint',
        (create) => create('DRAFT', '{}'),
        { bindOwnerToDeviceId: 'foreign-device' },
      ),
    ).toThrow('stored device identity');
    expect(() => readLocalCharacter(p.db, 'foreign')).toThrow('not found');
    resetDeviceIdentity(p.db, () => {});
    bootstrapDeviceIdentity(p.db);
    expect(() => readPostSaveHead(p.db, p.scope)).toThrow('another device');
    expect(readLocalCharacterOwner(p.db, 'character')!.ownerDeviceId).toBe(p.device);
  });
  it('keeps metadata and navigation revisions outside immutable creation and replays the old receipt', () => {
    const p = setup();
    const original = readLocalCharacter(p.db, 'character');
    const command = input(p, 'UI-CMD-CHAR-LOCAL-METADATA-PATCH', 'first');
    const first = patch(p, 'first');
    patch(p, 'second');
    const apply = vi.fn(() => {
      throw new Error('must not repeat');
    });
    const replay = commitPostSaveCommand(
      p.db,
      { ...command, receiptId: 'replacement-receipt' },
      p.validate,
      apply,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.command).toEqual(first.command);
    expect(apply).not.toHaveBeenCalled();
    expect(() =>
      commitPostSaveCommand(p.db, { ...command, request: { changed: true } }, p.validate, apply),
    ).toThrow('different request');
    const beforeNavigation = readPostSaveHead(p.db, p.scope)!;
    const after = updatePostSavePresentation(
      p.db,
      p.scope,
      revisions(beforeNavigation),
      { formId: 'APP-010' },
      p.validate,
    );
    expect(revisions(after)).toEqual({
      stateRevision: 2,
      projectionRevision: 3,
      actorVisibilityRevision: 0,
    });
    expect(readLocalMetadataHistory(p.db, 'character').map((row) => row.values.name)).toEqual([
      'first',
      'second',
    ]);
    expect(after.metadataRevision).toBe(2);
    expect(readLocalCharacter(p.db, 'character')).toEqual(original);
    expect(loadLocalCharacterCheckpoint(p.db, 'character')).toEqual(p.complete);
    expect(() =>
      updatePostSavePresentation(p.db, p.scope, revisions(beforeNavigation), {}, p.validate),
    ).toThrow('stale');
  });
  it('rejects forged owner/source bindings, receipt IDs and metadata fields before commit', () => {
    const p = setup();
    const command = input(p, 'UI-CMD-CHAR-LOCAL-METADATA-PATCH', 'invalid');
    expect(() =>
      readPostSaveHead(p.db, { ...p.scope, sourceBinding: { kind: 'different' } }),
    ).toThrow('binding differs');
    expect(() =>
      commitPostSaveCommand(p.db, { ...command, receiptId: 'checkpoint' }, p.validate, () => ({})),
    ).toThrow('ID already');
    expect(() =>
      commitPostSaveCommand(p.db, command, p.validate, (writer, next) => {
        writer.appendMetadata({ ...metadata, race: 'PURE' } as LocalMetadataValues, metadata);
        return receipt(command, next);
      }),
    ).toThrow('unrecognized fields');
    expect(readLocalMetadataHistory(p.db, 'character')).toEqual([]);
    expect(readPostSaveCommand(p.db, command.commandId, p.scope)).toBeNull();
  });
  it('initializes a new signed scope at the existing metadata head and rejects an older scope write', () => {
    const p = setup();
    patch(p, 'first');
    const oldHead = readPostSaveHead(p.db, p.scope)!;
    const nextScope: PostSaveScope = {
      ...p.scope,
      scopeId: 'other-origin',
      sourceBinding: { ...p.scope.sourceBinding, originFormId: 'APP-010', metadataRevision: 1 },
    };
    expect(
      createPostSaveHead(p.db, nextScope, { formId: 'APP-010' }, p.validate).metadataRevision,
    ).toBe(1);
    patch({ ...p, scope: nextScope }, 'second');
    const stale = input(p, 'UI-CMD-CHAR-LOCAL-METADATA-PATCH', 'stale-scope');
    expect(revisions(readPostSaveHead(p.db, p.scope)!)).toEqual(revisions(oldHead));
    expect(() =>
      commitPostSaveCommand(p.db, stale, p.validate, (writer, next) => {
        writer.appendMetadata({ ...metadata, name: 'stale' }, metadata);
        return receipt(stale, next);
      }),
    ).toThrow('head differs from immutable history');
    expect(readLocalMetadataHistory(p.db, 'character').map((r) => r.revision)).toEqual([1, 2]);
  });
  it('rolls back source mutation even if a post-save write trigger attempts it', () => {
    const p = setup();
    const original = readLocalCharacter(p.db, 'character');
    p.db.exec(
      "CREATE TRIGGER mutate_source AFTER INSERT ON local_character_post_save_command BEGIN UPDATE local_character SET payload_json = '{}' WHERE local_character_id = 'character'; END;",
    );
    expect(() => patch(p, 'source-corruption')).toThrow('changed its immutable source');
    expect(readLocalCharacter(p.db, 'character')).toEqual(original);
    expect(readLocalMetadataHistory(p.db, 'character')).toEqual([]);
  });
  it('persists metadata revisions and the same export bytes across a real SQLite reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'post-save-metadata-'));
    directories.push(dir);
    const path = join(dir, 'test.sqlite');
    const p = setup('FINAL', path);
    patch(p, 'revision-one');
    const command = input(p, 'UI-CMD-CHAR-EXPORT', 'download');
    const result = commitPostSaveCommand(p.db, command, p.validate, (_writer, next) =>
      receipt(command, next, { text: '{"snapshot":"immutable"}', metadataRevision: 1 }),
    );
    const head = readPostSaveHead(p.db, p.scope);
    p.db.close();
    const db = openPersistenceDatabase(path);
    databases.push(db);
    const replay = commitPostSaveCommand(
      db,
      command,
      () => {
        expect(loadLocalCharacterCheckpoint(db, 'character')).toEqual(p.complete);
      },
      () => {
        throw new Error('do not regenerate download');
      },
    );
    expect(replay.command).toEqual(result.command);
    expect(readPostSaveHead(db, p.scope)).toEqual(head);
    expect(readLocalMetadataHistory(db, 'character')[0]!.values.name).toBe('revision-one');
  });
  it('rolls back metadata, receipt and head if SQLite fails after the effect or corrupts the head', () => {
    const p = setup();
    const before = readPostSaveHead(p.db, p.scope);
    p.db.exec(
      "CREATE TRIGGER fail_journal BEFORE INSERT ON local_character_post_save_command BEGIN SELECT RAISE(ABORT, 'journal fault'); END;",
    );
    expect(() => patch(p, 'fault')).toThrow('journal fault');
    expect(readLocalMetadataHistory(p.db, 'character')).toEqual([]);
    expect(readPostSaveHead(p.db, p.scope)).toEqual(before);
    p.db.exec('DROP TRIGGER fail_journal');
    p.db.exec(
      "CREATE TRIGGER corrupt_head AFTER UPDATE ON local_character_post_save_head BEGIN UPDATE local_character_post_save_head SET presentation_json = '{}' WHERE scope_id = NEW.scope_id; END;",
    );
    expect(() => patch(p, 'post-write')).toThrow('checksum differs');
    expect(readLocalMetadataHistory(p.db, 'character')).toEqual([]);
    expect(readPostSaveHead(p.db, p.scope)).toEqual(before);
  });
  it('rejects revision overflow before running a mutation callback', () => {
    const p = setup();
    const scope = {
      ...p.scope,
      scopeId: 'overflow',
      baseSnapshotSha256: hash('different verified source'),
      baseRevisions: { ...zero, stateRevision: Number.MAX_SAFE_INTEGER },
    };
    createPostSaveHead(p.db, scope, {}, () => {});
    const apply = vi.fn(() => ({}));
    expect(() =>
      commitPostSaveCommand(
        p.db,
        {
          ...input(p, 'UI-CMD-CHAR-LOCAL-METADATA-PATCH', 'overflow-command'),
          scope,
          expectedRevisions: scope.baseRevisions,
        },
        () => {},
        apply,
      ),
    ).toThrow('safe integer');
    expect(apply).not.toHaveBeenCalled();
  });
  it('keeps source immutable, creates one provisional variant, and initializes exactly once after reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'post-save-variant-'));
    directories.push(dir);
    const path = join(dir, 'test.sqlite');
    const p = setup('FINAL', path);
    const original = readLocalCharacter(p.db, 'character');
    const v = variant(p);
    const provisional = readLocalCharacter(p.db, 'variant-character');
    expect(provisional).toMatchObject({ lifecycleState: 'VARIANT', ...zero });
    expect(JSON.parse(provisional.payloadJson)).toEqual({
      kind: 'LOCAL_VARIANT_PRE_IDENTITY',
      schemaVersion: 1,
      metadata,
      birthCommandId: v.command.commandId,
      birthReceiptId: v.command.receiptId,
    });
    expect(() => loadLocalCharacterCheckpoint(p.db, 'variant-character')).toThrow('no checkpoint');
    const replay = commitPostSaveCommand(p.db, v.command, p.validate, () => {
      throw new Error('must not allocate again');
    });
    expect(replay.command).toEqual(v.result.command);
    expect(() =>
      commitNewLocalCharacterCheckpoint(p.db, 'variant-character', 'different', (create) =>
        create('DRAFT', '{}'),
      ),
    ).toThrow('already exists');
    const variantScope: PostSaveScope = {
      ...p.scope,
      scopeId: 'variant-scope',
      entityKind: 'PROVISIONAL_VARIANT',
      entityId: 'variant-character',
      baseSnapshotSha256: v.proof.expectedProvisionalPayloadSha256,
      sourceBinding: { birthCommandId: v.command.commandId, birthReceiptId: v.command.receiptId },
    };
    createPostSaveHead(p.db, variantScope, { formId: 'CHR-001' }, () => {});
    const proof = { ...v.proof, provisionalScope: variantScope };
    expect(() =>
      initializeVariantCharacterCheckpoint(p.db, proof, '{"identity":"confirmed"}', () => {
        throw new Error('domain fault');
      }),
    ).toThrow('domain fault');
    expect(readLocalCharacter(p.db, 'variant-character')).toEqual(provisional);
    expect(readPostSaveHead(p.db, variantScope)).not.toBeNull();
    p.db.close();
    const db = openPersistenceDatabase(path);
    databases.push(db);
    const initialized = initializeVariantCharacterCheckpoint(
      db,
      proof,
      '{"identity":"confirmed"}',
      (local, checkpoint) => {
        expect(local.lifecycleState).toBe('DRAFT');
        expect(revisions(local)).toEqual(zero);
        expect(checkpoint.checkpointRevision).toBe(0);
      },
    );
    expect(readPostSaveHead(db, variantScope)).toBeNull();
    expect(() => initializeVariantCharacterCheckpoint(db, proof, '{}', () => {})).toThrow(
      'untouched provisional',
    );
    expect(readLocalCharacter(db, 'character')).toEqual(original);
    expect(readPostSaveCommand(db, v.command.commandId, p.scope)).toEqual(v.result.command);
    commitLocalCharacterCheckpoint(db, 'variant-character', 'variant-checkpoint', (write) =>
      write(
        { payloadJson: '{"identity":"next"}' },
        { stateChanged: true, projectionChanged: true, actorVisibilityChanged: false },
      ),
    );
    expect(readLocalCharacter(db, 'variant-character').stateRevision).toBe(1);
    expect(initialized.checkpoint.checkpointRevision).toBe(0);
  });
  it('rejects another birth receipt and hidden game fields in a provisional envelope', () => {
    const p = setup();
    const v = variant(p);
    expect(() =>
      initializeVariantCharacterCheckpoint(
        p.db,
        { ...v.proof, variantBirthReceiptId: 'foreign' },
        '{}',
        () => {},
      ),
    ).toThrow('birth proof differs');
    const mutated = JSON.stringify({
      ...(JSON.parse(readLocalCharacter(p.db, 'variant-character').payloadJson) as JsonObject),
      age: 25,
    });
    p.db
      .prepare('UPDATE local_character SET payload_json = ? WHERE local_character_id = ?')
      .run(mutated, 'variant-character');
    expect(() =>
      initializeVariantCharacterCheckpoint(
        p.db,
        { ...v.proof, expectedProvisionalPayloadSha256: hash(mutated) },
        '{}',
        () => {},
      ),
    ).toThrow('unrecognized fields');
    expect(() => loadLocalCharacterCheckpoint(p.db, 'variant-character')).toThrow('no checkpoint');
  });
  it('discards a demonstrably incomplete corrupt tail atomically, without touching the complete checkpoint', () => {
    const p = setup('DRAFT');
    prepareIntent(p);
    p.db.prepare('UPDATE local_character_write_intent SET intent_json = ?').run('{truncated');
    const tail = readLocalCharacterWriteIntent(p.db, 'character')!;
    expect(tail.payloadIntegrity).toBe('CORRUPT');
    const command = input(p, 'UI-CMD-LOCAL-CHECKPOINT-RESTORE', 'restore');
    const before = readLocalCharacter(p.db, 'character');
    const beforeHead = readPostSaveHead(p.db, p.scope);
    const checked = vi.fn();
    const result = commitPostSaveCommand(p.db, command, p.validate, (writer, next) => {
      writer.discardIntent(tail, checked);
      return receipt(command, next, { corruptTailIgnored: true, resumeFormId: 'CHR-025' });
    });
    expect(checked).toHaveBeenCalledWith('uncommitted-command');
    expect(result.head).toEqual(beforeHead);
    expect(readLocalCharacterWriteIntent(p.db, 'character')).toBeNull();
    expect(readLocalCharacter(p.db, 'character')).toEqual(before);
    expect(loadLocalCharacterCheckpoint(p.db, 'character')).toEqual(p.complete);
    expect(
      commitPostSaveCommand(p.db, command, p.validate, () => {
        throw new Error('must not discard twice');
      }).command,
    ).toEqual(result.command);
  });
  it.each(['different-base', 'corrupt-full'] as const)(
    'never calls a damaged full checkpoint an ignorable tail: %s',
    (caseName) => {
      const p = setup('DRAFT');
      const tail = prepareIntent(p);
      if (caseName === 'different-base')
        commitLocalCharacterCheckpoint(p.db, 'character', 'checkpoint', (write) =>
          write(
            { payloadJson: '{"new":"whole"}' },
            { stateChanged: true, projectionChanged: true, actorVisibilityChanged: false },
          ),
        );
      else
        p.db
          .prepare('UPDATE local_character_checkpoint SET snapshot_sha256 = ?')
          .run('0'.repeat(64));
      expect(() =>
        p.db.transaction(() => clearLocalCharacterWriteIntent(p.db, tail, () => {})).immediate(),
      ).toThrow();
      expect(readLocalCharacterWriteIntent(p.db, 'character')).toEqual(tail);
    },
  );
  it('retains the tail on failed restore and clears it inside a successful checkpoint transaction', () => {
    const p = setup('DRAFT');
    const tail = prepareIntent(p);
    const command = input(p, 'UI-CMD-LOCAL-CHECKPOINT-RESTORE', 'restore-fault');
    expect(() =>
      commitPostSaveCommand(p.db, command, p.validate, (writer) => {
        writer.discardIntent(tail, () => {});
        throw new Error('after discard');
      }),
    ).toThrow('after discard');
    expect(readLocalCharacterWriteIntent(p.db, 'character')).toEqual(tail);
    expect(readPostSaveCommand(p.db, command.commandId, p.scope)).toBeNull();
    commitLocalCharacterCheckpoint(p.db, 'character', 'checkpoint', (write) => {
      clearLocalCharacterWriteIntent(p.db, tail, () => {});
      return write(
        { payloadJson: '{"new":"whole"}' },
        { stateChanged: true, projectionChanged: true, actorVisibilityChanged: false },
      );
    });
    expect(readLocalCharacterWriteIntent(p.db, 'character')).toBeNull();
    expect(loadLocalCharacterCheckpoint(p.db, 'character').checkpointRevision).toBe(1);
  });
  it('requires a trusted archive validation and refuses mixed owner contexts', () => {
    const p = setup();
    expect(() =>
      createPostSaveHead(p.db, { ...p.scope, ownerContext: 'GM_ARCHIVE_EXPORT' }, {}, () => {}),
    ).toThrow('context pair');
    const gm: PostSaveScope = {
      ...p.scope,
      scopeId: 'gm',
      entityKind: 'COMPLETED_CAMPAIGN_COPY',
      entityId: 'archive-copy',
      ownerContext: 'GM_ARCHIVE_EXPORT',
    };
    expect(() =>
      createPostSaveHead(p.db, gm, {}, () => {
        throw new Error('missing sole GM authority');
      }),
    ).toThrow('missing sole GM authority');
    expect(readPostSaveHead(p.db, gm)).toBeNull();
  });
  it('does not let an escaped writer or an async callback mutate after the transaction', () => {
    const p = setup();
    const command = input(p, 'UI-CMD-CHAR-EXPORT', 'export');
    let captured: PostSaveCommandWriter | undefined;
    commitPostSaveCommand(p.db, command, p.validate, (writer, next) => {
      captured = writer;
      return receipt(command, next, { bytes: 'stable' });
    });
    expect(() => captured!.setPresentation({ formId: 'forged' })).toThrow('no longer active');
    const asyncApply = vi.fn(async () => {
      await Promise.resolve();
      return {};
    });
    expect(() =>
      commitPostSaveCommand(
        p.db,
        input(p, 'UI-CMD-CHAR-EXPORT', 'async'),
        p.validate,
        asyncApply as unknown as (writer: PostSaveCommandWriter, next: PostSaveHead) => JsonObject,
      ),
    ).toThrow('synchronous');
    expect(asyncApply).not.toHaveBeenCalled();
  });
});
