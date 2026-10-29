import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import {
  POST_SAVE_COMMAND_IDS,
  type PostSaveRequest,
  type PostSaveMetadata,
} from '@shared/local-character-post-save.js';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
} from '../../tests/fixtures/creation-finalization-stage.js';
import {
  advanceCreationFinalizationPresentation,
  commitCreationFinalization,
} from './creation-finalization.js';
import { loadCreationWizardCheckpoint } from './creation-set-decide.js';
import {
  loadLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import {
  openPersistenceDatabase,
  prepareLocalCharacterWriteIntent,
  readLocalCharacter,
  readLocalCharacterWriteIntent,
  readPostSaveCursor,
  readPostSaveRestoreCommand,
  readPostSaveCommandById,
  type PostSaveHead,
} from '../persistence/index.js';
import { commitIdentityCheckpoint } from './identity-checkpoint.js';
import {
  openPlayerPostSave,
  projectLocalPostSave,
  navigateLocalPostSave,
  commitLocalPostSave,
  normalizePostSaveRequest,
  postSaveCommon,
  postSaveRevisions,
  readProvisionalVariant,
  LOCAL_CHARACTER_RESUME_FORMS,
  type LocalPostSaveDependencies,
} from './local-character-post-save.js';
import {
  createStartingMoneyProfileSetup,
  startingMoneyProfileRequest,
  MONEY_PROFILE_INPUTS,
} from '../../tests/fixtures/starting-money-stage.js';
import { commitWeaponProfile } from './creation-weapon-profile.js';

let baseline: LocalCharacterExportBaseline;
const setups: Awaited<ReturnType<typeof createCreationFinalizationSetup>>[] = [];
const reopenedDatabases: ReturnType<typeof openPersistenceDatabase>[] = [];
const directories: string[] = [];
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
});
afterEach(() => {
  for (const p of setups.splice(0)) if (p.setup.database.open) p.setup.database.close();
  for (const database of reopenedDatabases.splice(0)) if (database.open) database.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const capabilities = new Set(Object.values(POST_SAVE_COMMAND_IDS));
function dependencies(
  database: LocalPostSaveDependencies['database'],
  catalog: LocalPostSaveDependencies['symbiontCatalog'],
): LocalPostSaveDependencies {
  return {
    database,
    baseline,
    symbiontCatalog: catalog,
    loadCheckpoint: (id) => loadCreationWizardCheckpoint(database, id, catalog.skillStage, catalog),
    resumeForm: (c) => c.nextStageEnvelope.formId,
  };
}
async function source(final: boolean, databasePath = ':memory:') {
  const p = await createCreationFinalizationSetup({
    prefix: 'post-save',
    raceChoice: 'FREE',
    diceInputMode: 'AUTO',
    databasePath,
  });
  setups.push(p);
  let current = commitCreationFinalization(
    p.setup.database,
    creationPropertySummaryRequest(p.current, 'summary'),
    'summary-receipt',
    p.dependencies,
  );
  if (final)
    current = commitCreationFinalization(
      p.setup.database,
      creationFinalSaveRequest(current, 'final'),
      'final-receipt',
      p.dependencies,
    );
  const d = dependencies(p.setup.database, p.setup.catalog);
  return {
    p,
    d,
    current,
    head: openPlayerPostSave(
      d,
      current.localCharacter.localCharacterId,
      final ? 'CHR-040' : 'APP-004',
    ),
  };
}
function request(
  head: PostSaveHead,
  variant: PostSaveRequest['payload']['variant'],
  values?: PostSaveMetadata,
): PostSaveRequest {
  const common = {
    ...postSaveCommon(head),
    stage: 'LOCAL_CHARACTER_POST_SAVE' as const,
    expectedMetadataRevisionOrNull: variant === 'RESTORE' ? null : head.metadataRevision,
  };
  const payload =
    variant === 'METADATA_PATCH'
      ? { ...common, variant, sourceFormId: 'CHR-040' as const, values: values! }
      : variant === 'RESTORE'
        ? { ...common, variant, sourceFormId: 'APP-009' as const }
        : { ...common, variant, sourceFormId: 'APP-010' as const };
  return {
    messageType: 'command.request',
    protocolVersion: 1,
    commandKind: 'workflow-command',
    commandId: `post-${variant}`,
    role: 'player',
    workflowCommandId: POST_SAVE_COMMAND_IDS[variant],
    expectedRevisions: postSaveRevisions(head),
    payload,
  };
}
describe('local post-save authority', () => {
  it('uses exactly the source APP-009 character dispatch allowlist', () => {
    const transitions = JSON.parse(
      readFileSync('generated/spec/atlas/transitions.json', 'utf8'),
    ) as { from: string; to: string; kind: string }[];
    expect([...LOCAL_CHARACTER_RESUME_FORMS].sort()).toEqual(
      transitions
        .filter((t) => t.from === 'APP-009' && t.kind === 'system-event')
        .map((t) => t.to)
        .sort(),
    );
  });
  it('keeps FINAL creation bytes and revisions immutable while metadata, variant and export use their own journal', async () => {
    const { d, current, head } = await source(true);
    const before = readLocalCharacter(d.database, head.scope.entityId);
    const projected = projectLocalPostSave(d, head, capabilities);
    const values = {
      name: 'Источник CORE-159 fan',
      description: 'Локальное описание',
      artAssetKeyOrLocalFile: null,
    } as const;
    const patch = request(head, 'METADATA_PATCH', values);
    const saved = commitLocalPostSave(d, patch, 'metadata-receipt', () => {
      throw new Error('no variant allocation');
    });
    expect(saved.head.metadataRevision).toBe(1);
    expect(projectLocalPostSave(d, saved.head, capabilities).roleFilteredPayload).toMatchObject({
      name: values.name,
      localMetadataRevision: 1,
    });
    expect(saved.command.receipt['result']).toMatchObject({ localMetadataRevision: 1 });
    expect(
      commitLocalPostSave(d, patch, 'unused-receipt', () => {
        throw new Error('replay must not allocate');
      }).replayed,
    ).toBe(true);
    expect(readLocalCharacter(d.database, head.scope.entityId)).toEqual(before);
    expect(current.localCharacter).toEqual(before);
    expect(projected.availableActionKeys).toContain('CHR-040::CTA::004');
    const exportHead = navigateLocalPostSave(d, saved.head, 'APP-010');
    const exported = commitLocalPostSave(d, request(exportHead, 'EXPORT'), 'export-receipt', () => {
      throw new Error('export must not allocate');
    });
    expect(exported.head).toEqual(exportHead);
    const result = exported.command.receipt['result'] as JsonObject;
    expect((result['downloadOrNull'] as JsonObject)['contentText']).toContain(values.name);
    const variantId = '77000000-0000-4000-8000-000000000001';
    const variant = commitLocalPostSave(
      d,
      request(exportHead, 'VARIANT_CREATE'),
      'variant-receipt',
      () => variantId,
    );
    expect(variant.head.stateRevision).toBe(exportHead.stateRevision + 1);
    const row = readLocalCharacter(d.database, variantId);
    expect(row.lifecycleState).toBe('VARIANT');
    expect(JSON.parse(row.payloadJson)).toEqual({
      kind: 'LOCAL_VARIANT_PRE_IDENTITY',
      schemaVersion: 1,
      metadata: values,
      birthCommandId: 'post-VARIANT_CREATE',
      birthReceiptId: 'variant-receipt',
    });
    expect(readLocalCharacter(d.database, head.scope.entityId)).toEqual(before);
    const birth = readProvisionalVariant(d, variantId, 'variant-wizard');
    const identity = commitIdentityCheckpoint(
      d.database,
      {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
        commandId: 'variant-identity',
        role: 'player',
        expectedRevisions: { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 },
        payload: {
          stage: 'IDENTITY',
          characterDraftId: variantId,
          wizardCheckpointId: 'variant-wizard',
          draftRevision: 0,
          ...values,
          age: 20,
          sex: 'MALE',
          massKg: 60,
        },
      },
      'variant-identity-receipt',
      { bindOwnerToDeviceId: head.scope.ownerDeviceId, variantProof: birth.proof },
    );
    expect(identity.checkpoint.checkpointRevision).toBe(0);
    expect(identity.localCharacter.lifecycleState).toBe('DRAFT');
    expect(identity.localCharacter.stateRevision).toBe(0);
  });
  it('restores the signed draft only after proving an uncommitted corrupt tail', async () => {
    const { d, current } = await source(false);
    const c = current.checkpoint;
    prepareLocalCharacterWriteIntent(
      d.database,
      {
        localCharacterId: current.localCharacter.localCharacterId,
        ownerDeviceId: setups[0]!.setup.deviceId,
        checkpointId: c.checkpointId,
        baseCheckpointRevision: c.checkpointRevision,
        baseSnapshotSha256: c.snapshotSha256,
        commandId: 'interrupted-write',
        intent: { phase: 'PREPARED' },
      },
      () => {},
    );
    d.database.prepare('UPDATE local_character_write_intent SET intent_json = ?').run('{broken');
    const head = navigateLocalPostSave(
      d,
      openPlayerPostSave(d, current.localCharacter.localCharacterId),
      'APP-009',
    );
    expect(projectLocalPostSave(d, head, capabilities).roleFilteredPayload).toMatchObject({
      corruptTailIgnored: false,
      restoreStatus: 'READY',
      resumeFormId: 'CHR-025',
    });
    const before = readLocalCharacter(d.database, head.scope.entityId);
    const saved = commitLocalPostSave(d, request(head, 'RESTORE'), 'restore-receipt', () => {
      throw new Error('restore must not allocate');
    });
    expect(saved.command.receipt['result']).toMatchObject({
      nextFormId: 'CHR-025',
      restoredCheckpointOrNull: {
        checkpointSha256: c.snapshotSha256,
        ownerId: head.scope.entityId,
        restoreStatus: 'CORRUPT',
        corruptTailIgnored: true,
      },
    });
    expect(readLocalCharacterWriteIntent(d.database, head.scope.entityId)).toBeNull();
    expect(readLocalCharacter(d.database, head.scope.entityId)).toEqual(before);
    const replay = commitLocalPostSave(d, request(head, 'RESTORE'), 'unused-receipt', () => {
      throw new Error('replay must not allocate');
    });
    expect(replay.replayed).toBe(true);
    expect(replay.command).toEqual(saved.command);
  });
  it('diagnoses a corrupt complete checkpoint and never offers restore or an older fallback', async () => {
    const { d, current } = await source(false);
    d.database
      .prepare('UPDATE local_character_checkpoint SET snapshot_sha256 = ?')
      .run('0'.repeat(64));
    const head = openPlayerPostSave(d, current.localCharacter.localCharacterId);
    const projection = projectLocalPostSave(d, head, capabilities);
    expect(projection.roleFilteredPayload).toMatchObject({
      restoreStatus: 'CORRUPT',
      lastCompleteCheckpointId: null,
      resumeFormId: null,
      branchCacheHash: null,
    });
    expect(projection.availableActionKeys).toEqual(['CHR-026::CTA::002']);
  });
  it('recovers the exact restored draft without RAM or pending commands and retires the handoff with its successor checkpoint', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'post-save-restore-crash-'));
    directories.push(directory);
    const path = join(directory, 'local.sqlite');
    const { p, d, current } = await source(false, path);
    const other = await createCreationFinalizationSetup({
      prefix: 'newer-other',
      raceChoice: 'FREE',
      diceInputMode: 'AUTO',
      databasePath: path,
    });
    setups.push(other);
    openPlayerPostSave(d, other.setup.characterDraftId);
    const head = navigateLocalPostSave(
      d,
      openPlayerPostSave(d, p.setup.characterDraftId),
      'APP-009',
    );
    const saved = commitLocalPostSave(d, request(head, 'RESTORE'), 'restore-crash-receipt', () => {
      throw new Error('restore must not allocate');
    });
    d.database.close();
    other.setup.database.close();

    const db = openPersistenceDatabase(path);
    reopenedDatabases.push(db);
    const fresh = dependencies(db, p.setup.catalog);
    const handoff = readPostSaveRestoreCommand(db, p.setup.deviceId)!;
    expect(handoff.command).toEqual(saved.command);
    expect(handoff.head.scope.entityId).toBe(p.setup.characterDraftId);
    expect(readPostSaveCursor(db, p.setup.deviceId)).toBeNull();
    const restored = fresh.loadCheckpoint(handoff.head.scope.entityId);
    expect(restored.checkpoint).toEqual(current.checkpoint);
    expect(handoff.command.receipt['result']).toMatchObject({
      nextFormId: 'CHR-025',
      targetRevisions: {
        stateRevision: restored.localCharacter.stateRevision,
        projectionRevision: restored.localCharacter.projectionRevision,
        actorVisibilityRevision: restored.localCharacter.actorVisibilityRevision,
      },
      restoredCheckpointOrNull: {
        checkpointId: restored.checkpoint.checkpointId,
        checkpointRevision: restored.checkpoint.checkpointRevision,
        checkpointSha256: restored.checkpoint.snapshotSha256,
        ownerId: p.setup.characterDraftId,
        ownerDeviceId: p.setup.deviceId,
      },
    });
    expect(fresh.loadCheckpoint(other.setup.characterDraftId).checkpoint).toEqual(
      other.current.checkpoint,
    );

    const successor = advanceCreationFinalizationPresentation(
      db,
      {
        characterDraftId: p.setup.characterDraftId,
        wizardCheckpointId: p.setup.wizardCheckpointId,
        formId: 'CHR-001',
      },
      p.setup.catalog,
    );
    expect(successor.localCharacter.payloadJson).toEqual(restored.localCharacter.payloadJson);
    expect(successor.localCharacter.projectionRevision).toBe(
      restored.localCharacter.projectionRevision + 1,
    );
    db.close();
    const afterCrash = openPersistenceDatabase(path);
    reopenedDatabases.push(afterCrash);
    expect(readPostSaveRestoreCommand(afterCrash, p.setup.deviceId)).toBeNull();
    expect(readPostSaveCursor(afterCrash, p.setup.deviceId)).toBeNull();
    expect(
      readPostSaveCommandById(afterCrash, saved.command.commandId, p.setup.deviceId)?.command,
    ).toEqual(saved.command);
    expect(
      dependencies(afterCrash, p.setup.catalog).loadCheckpoint(p.setup.characterDraftId).checkpoint,
    ).toEqual(successor.checkpoint);
  });
  it('restores the verified CHR-023 base with its CHR-031 invalid-profile layer and exact draft inputs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'post-save-invalid-profile-'));
    directories.push(directory);
    const path = join(directory, 'local.sqlite');
    const p = await createStartingMoneyProfileSetup({
      prefix: 'restore-invalid-profile',
      raceChoice: 'FREE',
      databasePath: path,
    });
    reopenedDatabases.push(p.setup.database);
    const badInputs = { ...MONEY_PROFILE_INPUTS, formulaOutputs: { Dm: 999, Rn: 6, Rs: 1, Rd: 2 } };
    const invalid = commitWeaponProfile(
      p.setup.database,
      startingMoneyProfileRequest(p.current, 'invalid-profile-submit', badInputs),
      'invalid-profile-receipt',
      {
        catalog: p.setup.catalog,
        profileCatalog: p.profileCatalog,
        allocateRequestId: () => {
          throw new Error('restore must retain its existing profile request');
        },
        allocateWitnessReceiptId: () => {
          throw new Error('invalid profile must not allocate a witness');
        },
      },
    );
    expect(invalid.symbiontPresentationStage?.formId).toBe('CHR-031');
    const d = dependencies(p.setup.database, p.setup.catalog);
    const head = navigateLocalPostSave(
      d,
      openPlayerPostSave(d, p.setup.characterDraftId),
      'APP-009',
    );
    const saved = commitLocalPostSave(
      d,
      request(head, 'RESTORE'),
      'profile-restore-receipt',
      () => {
        throw new Error('restore must not allocate');
      },
    );
    expect(saved.command.receipt['result']).toMatchObject({
      nextFormId: 'CHR-023',
      restoredCheckpointOrNull: { resumeFormId: 'CHR-023', layerFormIds: ['CHR-031'] },
    });
    p.setup.database.close();
    const reopened = openPersistenceDatabase(path);
    reopenedDatabases.push(reopened);
    expect(readPostSaveRestoreCommand(reopened, p.setup.deviceId)?.command).toEqual(saved.command);
    const restored = dependencies(reopened, p.setup.catalog).loadCheckpoint(
      p.setup.characterDraftId,
    );
    expect(restored.checkpoint).toEqual(invalid.checkpoint);
    expect(restored.weaponProfileStage).toEqual(invalid.weaponProfileStage);
    expect(restored.symbiontPresentationStage?.formId).toBe('CHR-031');
  });
  it('rejects foreign/stale bindings, metadata mechanics injection, source ID reuse and canonical no-op', async () => {
    const { d, head } = await source(true);
    const values = projectLocalPostSave(d, head, capabilities).roleFilteredPayload;
    const same = {
      name: values['name'],
      description: values['description'],
      artAssetKeyOrLocalFile: values['artAssetKeyOrLocalFile'],
    } as PostSaveMetadata;
    const before = readLocalCharacter(d.database, head.scope.entityId);
    const journalBefore = d.database
      .prepare('SELECT * FROM local_character_post_save_command')
      .all();
    expect(() =>
      commitLocalPostSave(d, request(head, 'METADATA_PATCH', same), 'r1', () => 'unused'),
    ).toThrow();
    const good = request(head, 'METADATA_PATCH', { ...same, name: 'Changed' });
    for (const changed of [
      { ...good, payload: { ...good.payload, sourceEntityId: 'foreign' } },
      { ...good, payload: { ...good.payload, sourceBindingHash: '0'.repeat(64) } },
      {
        ...good,
        expectedRevisions: {
          ...good.expectedRevisions,
          stateRevision: good.expectedRevisions.stateRevision + 1,
        },
      },
      { ...good, commandId: 'final' },
    ])
      expect(() =>
        commitLocalPostSave(d, changed as PostSaveRequest, 'r2', () => 'unused'),
      ).toThrow();
    for (const changed of [
      { ...good, role: 'gm' },
      { ...good, role: 'system' },
      { ...good, payload: { ...good.payload, ownerContext: 'GM_ARCHIVE_EXPORT' } },
      { ...good, payload: { ...good.payload, ownerDeviceId: 'foreign' } },
      { ...good, payload: { ...good.payload, values: { ...same, mechanics: { S: 999 } } } },
    ])
      expect(() => normalizePostSaveRequest(changed)).toThrow();
    expect(readLocalCharacter(d.database, head.scope.entityId)).toEqual(before);
    expect(d.database.prepare('SELECT * FROM local_character_post_save_command').all()).toEqual(
      journalBefore,
    );
  });
});
