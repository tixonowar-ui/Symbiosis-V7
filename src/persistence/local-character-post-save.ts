import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { IdentityDraftValues } from '@shared/wire-v3-protocol.js';
import { loadDeviceId } from './device-identity.js';
import {
  loadLocalCharacterCheckpoint,
  loadCampaignCheckpoint,
  readLocalCharacter,
  type LocalCharacter,
  type LocalCharacterCheckpoint,
  type RevisionImpact,
  type RevisionTriple,
} from './store.js';

export type LocalMetadataValues = Pick<
  IdentityDraftValues,
  'description' | 'artAssetKeyOrLocalFile'
> & { readonly name: string };
export interface PostSaveScope {
  readonly scopeId: string;
  readonly entityKind:
    | 'CHARACTER_DRAFT'
    | 'LOCAL_FINAL'
    | 'COMPLETED_CAMPAIGN_COPY'
    | 'PROVISIONAL_VARIANT'
    | 'DRAFT_DIAGNOSTIC';
  readonly entityId: string;
  readonly ownerContext: 'PLAYER_LOCAL' | 'GM_ARCHIVE_EXPORT';
  readonly ownerDeviceId: string;
  readonly baseSnapshotSha256: string;
  readonly baseRevisions: RevisionTriple;
  readonly sourceBinding: JsonObject;
}
export interface PostSaveHead extends RevisionTriple {
  readonly scope: PostSaveScope;
  readonly metadataRevision: number;
  readonly presentation: JsonObject;
}
export interface LocalCharacterOwner {
  readonly localCharacterId: string;
  readonly ownerDeviceId: string | null;
  readonly variantBirthCommandId: string | null;
}
export interface LocalMetadataRevision {
  readonly localCharacterId: string;
  readonly revision: number;
  readonly finalSnapshotSha256: string;
  readonly values: LocalMetadataValues;
  readonly valuesSha256: string;
  readonly previousValuesSha256: string;
  readonly commandId: string;
}
export interface StoredPostSaveCommand {
  readonly commandId: string;
  readonly receiptId: string;
  readonly scopeId: string;
  readonly commandKind: string;
  readonly request: JsonObject;
  readonly receipt: JsonObject;
  readonly effects: JsonObject;
}
export interface LocalCharacterWriteIntent {
  readonly localCharacterId: string;
  readonly ownerDeviceId: string;
  readonly checkpointId: string;
  readonly baseCheckpointRevision: number;
  readonly baseSnapshotSha256: string;
  readonly commandId: string;
  readonly intentJson: string;
  readonly intentSha256: string;
  readonly payloadIntegrity: 'VALID' | 'CORRUPT';
}
export interface PostSaveCommandInput {
  readonly scope: PostSaveScope;
  readonly expectedRevisions: RevisionTriple;
  readonly commandId: string;
  readonly receiptId: string;
  readonly commandKind: string;
  readonly request: JsonObject;
  readonly impact: RevisionImpact;
}
export interface PostSaveCommandWriter {
  appendMetadata(
    values: LocalMetadataValues,
    baselineValues: LocalMetadataValues,
  ): LocalMetadataRevision;
  createVariant(characterId: string, values: LocalMetadataValues): LocalCharacter;
  discardIntent(
    expected: LocalCharacterWriteIntent,
    assertUncommitted: (commandId: string) => void,
  ): void;
  setPresentation(presentation: JsonObject): void;
}
export interface VariantInitializationProof {
  readonly characterId: string;
  readonly checkpointId: string;
  readonly expectedOwnerDeviceId: string;
  readonly variantBirthCommandId: string;
  readonly variantBirthReceiptId: string;
  readonly expectedProvisionalPayloadSha256: string;
  readonly provisionalScope?: PostSaveScope;
}

type Row = Record<string, unknown>;
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const fail = (message: string): never => {
  throw new Error(`post-save: ${message}`);
};
const stringAt = (value: unknown, label: string): string =>
  typeof value === 'string' && value.length > 0 && !value.includes('\0')
    ? value
    : fail(`${label} must be non-empty text`);
const revisionAt = (value: unknown, label: string): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail(`${label} must be a non-negative safe integer`);
const hashAt = (value: unknown, label: string): string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : fail(`${label} must be lowercase SHA-256`);
const objectAt = (value: unknown, label: string): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : fail(`${label} must be an object`);
const exactKeys = (value: Row, keys: readonly string[], label: string): void => {
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()))
    fail(`${label} has unrecognized fields`);
};
const jsonText = (value: unknown): string => {
  objectAt(value, 'JSON value');
  const encoded = JSON.stringify(value);
  if (!isDeepStrictEqual(JSON.parse(encoded) as unknown, value))
    fail('JSON value is not losslessly serializable');
  return encoded;
};
const parsedJson = (text: unknown, label: string): JsonObject => {
  const parsed: unknown = JSON.parse(stringAt(text, label));
  objectAt(parsed, label);
  return parsed as JsonObject;
};
const revisionsAt = (value: unknown): RevisionTriple => {
  const object = objectAt(value, 'revisions');
  exactKeys(
    object,
    ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'],
    'revisions',
  );
  return {
    stateRevision: revisionAt(object['stateRevision'], 'stateRevision'),
    projectionRevision: revisionAt(object['projectionRevision'], 'projectionRevision'),
    actorVisibilityRevision: revisionAt(
      object['actorVisibilityRevision'],
      'actorVisibilityRevision',
    ),
  };
};
const revisionsOf = (head: RevisionTriple): RevisionTriple => ({
  stateRevision: head.stateRevision,
  projectionRevision: head.projectionRevision,
  actorVisibilityRevision: head.actorVisibilityRevision,
});
const nextRevisions = (before: RevisionTriple, impact: RevisionImpact): RevisionTriple => {
  const raw = objectAt(impact, 'impact');
  exactKeys(raw, ['stateChanged', 'projectionChanged', 'actorVisibilityChanged'], 'impact');
  if (
    Object.values(raw).some((v) => typeof v !== 'boolean') ||
    (impact.actorVisibilityChanged && !impact.projectionChanged)
  )
    return fail('invalid revision impact');
  return revisionsAt({
    stateRevision: before.stateRevision + Number(impact.stateChanged),
    projectionRevision: before.projectionRevision + Number(impact.projectionChanged),
    actorVisibilityRevision: before.actorVisibilityRevision + Number(impact.actorVisibilityChanged),
  });
};
const scopeAt = (value: unknown): PostSaveScope => {
  const o = objectAt(value, 'scope');
  exactKeys(
    o,
    [
      'scopeId',
      'entityKind',
      'entityId',
      'ownerContext',
      'ownerDeviceId',
      'baseSnapshotSha256',
      'baseRevisions',
      'sourceBinding',
    ],
    'scope',
  );
  const entityKind = o['entityKind'];
  const ownerContext = o['ownerContext'];
  if (
    typeof entityKind !== 'string' ||
    ![
      'CHARACTER_DRAFT',
      'LOCAL_FINAL',
      'COMPLETED_CAMPAIGN_COPY',
      'PROVISIONAL_VARIANT',
      'DRAFT_DIAGNOSTIC',
    ].includes(entityKind) ||
    (entityKind === 'COMPLETED_CAMPAIGN_COPY'
      ? ownerContext !== 'GM_ARCHIVE_EXPORT'
      : ownerContext !== 'PLAYER_LOCAL')
  )
    return fail('invalid entity/owner context pair');
  return {
    scopeId: stringAt(o['scopeId'], 'scopeId'),
    entityKind: entityKind as PostSaveScope['entityKind'],
    entityId: stringAt(o['entityId'], 'entityId'),
    ownerContext: ownerContext as PostSaveScope['ownerContext'],
    ownerDeviceId: stringAt(o['ownerDeviceId'], 'ownerDeviceId'),
    baseSnapshotSha256: hashAt(o['baseSnapshotSha256'], 'baseSnapshotSha256'),
    baseRevisions: revisionsAt(o['baseRevisions']),
    sourceBinding: parsedJson(jsonText(o['sourceBinding']), 'sourceBinding'),
  };
};
const metadataAt = (value: unknown): LocalMetadataValues => {
  const o = objectAt(value, 'metadata');
  exactKeys(o, ['name', 'description', 'artAssetKeyOrLocalFile'], 'metadata');
  const name = stringAt(o['name'], 'metadata.name');
  if (o['description'] !== null && typeof o['description'] !== 'string')
    return fail('invalid metadata.description');
  if (o['artAssetKeyOrLocalFile'] !== null) objectAt(o['artAssetKeyOrLocalFile'], 'metadata.art');
  jsonText(o);
  return {
    name,
    description: o['description'],
    artAssetKeyOrLocalFile: o[
      'artAssetKeyOrLocalFile'
    ] as LocalMetadataValues['artAssetKeyOrLocalFile'],
  };
};
const sync = (callback: () => unknown): void => {
  if (Object.prototype.toString.call(callback) === '[object AsyncFunction]')
    fail('transaction callback must be synchronous');
  const result = callback();
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    'then' in result
  )
    fail('transaction callback must be synchronous');
};
const transaction = <T>(db: Database.Database, action: () => T): T => {
  if (db.inTransaction) return fail('requires a top-level transaction');
  return db.transaction(action).immediate();
};

export function readLocalCharacterOwner(
  db: Database.Database,
  characterId: string,
): LocalCharacterOwner | null {
  const row = db
    .prepare('SELECT * FROM local_character_owner WHERE local_character_id = ?')
    .get(characterId) as Row | undefined;
  return row === undefined
    ? null
    : {
        localCharacterId: stringAt(row['local_character_id'], 'localCharacterId'),
        ownerDeviceId:
          row['owner_device_id'] === null
            ? null
            : stringAt(row['owner_device_id'], 'ownerDeviceId'),
        variantBirthCommandId:
          row['variant_birth_command_id'] === null
            ? null
            : stringAt(row['variant_birth_command_id'], 'variantBirthCommandId'),
      };
}
export function assertLocalCharacterOwnedByDevice(
  db: Database.Database,
  characterId: string,
  deviceId: string,
): LocalCharacterOwner {
  const owner = readLocalCharacterOwner(db, characterId);
  if (loadDeviceId(db) !== deviceId || owner === null || owner.ownerDeviceId !== deviceId)
    return fail('local character owner is unbound or foreign');
  return owner;
}
const assertScopeOwner = (db: Database.Database, scope: PostSaveScope): void => {
  if (loadDeviceId(db) !== scope.ownerDeviceId) fail('scope belongs to another device');
  if (scope.ownerContext === 'PLAYER_LOCAL')
    assertLocalCharacterOwnedByDevice(db, scope.entityId, scope.ownerDeviceId);
};
const sourceRows = (db: Database.Database, scope: PostSaveScope): string => {
  if (scope.entityKind === 'COMPLETED_CAMPAIGN_COPY') {
    const copy = db
      .prepare('SELECT * FROM campaign_character_copy WHERE campaign_character_id = ?')
      .get(scope.entityId) as Row | undefined;
    return JSON.stringify({
      copy,
      campaign:
        copy === undefined
          ? null
          : db.prepare('SELECT * FROM campaign WHERE campaign_id = ?').get(copy['campaign_id']),
      checkpoint:
        copy === undefined
          ? null
          : db
              .prepare('SELECT * FROM campaign_checkpoint WHERE campaign_id = ?')
              .get(copy['campaign_id']),
    });
  }
  return JSON.stringify(
    [
      'local_character',
      'local_character_checkpoint',
      'local_character_skill_presentation',
      'local_character_symbiont_presentation',
    ].map(
      (table) =>
        db.prepare(`SELECT * FROM ${table} WHERE local_character_id = ?`).get(scope.entityId) ??
        null,
    ),
  );
};
const assertSourceUnchanged = (
  db: Database.Database,
  scope: PostSaveScope,
  before: string,
): void => {
  if (sourceRows(db, scope) !== before) fail('post-save operation changed its immutable source');
};
const headPreimage = (head: PostSaveHead): string =>
  JSON.stringify({
    scope: head.scope,
    ...revisionsOf(head),
    metadataRevision: head.metadataRevision,
    presentation: head.presentation,
  });
export function readPostSaveHead(db: Database.Database, scope: PostSaveScope): PostSaveHead | null {
  const checked = scopeAt(scope);
  assertScopeOwner(db, checked);
  const row = db
    .prepare('SELECT * FROM local_character_post_save_head WHERE scope_id = ?')
    .get(checked.scopeId) as Row | undefined;
  if (row === undefined) return null;
  const storedScope = scopeAt(parsedJson(row['scope_json'], 'scope_json'));
  if (
    !isDeepStrictEqual(storedScope, checked) ||
    row['entity_id'] !== checked.entityId ||
    row['entity_kind'] !== checked.entityKind ||
    row['owner_context'] !== checked.ownerContext ||
    row['owner_device_id'] !== checked.ownerDeviceId ||
    row['base_snapshot_sha256'] !== checked.baseSnapshotSha256
  )
    return fail('stored scope binding differs');
  const head = {
    scope: storedScope,
    ...revisionsAt(revisionsOf(row as unknown as RevisionTriple)),
    metadataRevision: revisionAt(row['metadata_revision'], 'metadata_revision'),
    presentation: parsedJson(row['presentation_json'], 'presentation_json'),
  };
  if (sha256(headPreimage(head)) !== row['head_sha256'])
    return fail('post-save head checksum differs');
  return head;
}
const writeHead = (db: Database.Database, head: PostSaveHead): void => {
  db.prepare(
    `INSERT INTO local_character_post_save_head
    (scope_id, entity_kind, entity_id, owner_device_id, owner_context, base_snapshot_sha256, scope_json,
     stateRevision, projectionRevision, actorVisibilityRevision, metadata_revision, presentation_json, head_sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope_id) DO UPDATE SET stateRevision=excluded.stateRevision,
      projectionRevision=excluded.projectionRevision, actorVisibilityRevision=excluded.actorVisibilityRevision,
      metadata_revision=excluded.metadata_revision, presentation_json=excluded.presentation_json, head_sha256=excluded.head_sha256`,
  ).run(
    head.scope.scopeId,
    head.scope.entityKind,
    head.scope.entityId,
    head.scope.ownerDeviceId,
    head.scope.ownerContext,
    head.scope.baseSnapshotSha256,
    JSON.stringify(head.scope),
    head.stateRevision,
    head.projectionRevision,
    head.actorVisibilityRevision,
    head.metadataRevision,
    jsonText(head.presentation),
    sha256(headPreimage(head)),
  );
};

export function readPostSaveHeadById(
  db: Database.Database,
  scopeId: string,
  ownerDeviceId: string,
): PostSaveHead | null {
  if (loadDeviceId(db) !== stringAt(ownerDeviceId, 'ownerDeviceId'))
    return fail('post-save reader belongs to another device');
  const row = db
    .prepare('SELECT scope_json FROM local_character_post_save_head WHERE scope_id = ?')
    .get(stringAt(scopeId, 'scopeId')) as Row | undefined;
  if (row === undefined) return null;
  const scope = scopeAt(parsedJson(row['scope_json'], 'scope_json'));
  if (scope.scopeId !== scopeId || scope.ownerDeviceId !== ownerDeviceId)
    return fail('post-save scope belongs to another owner');
  return readPostSaveHead(db, scope);
}

const cursorBindingHash = (scope: PostSaveScope, restoreCommandId: string | null): string =>
  sha256(JSON.stringify({ scope, restoreCommandId }));
const pendingRestoreCursors = new WeakMap<
  Database.Database,
  {
    readonly commandId: string;
    readonly scopeId: string;
    written: boolean;
  }
>();
function readPostSaveCursorRow(db: Database.Database, ownerDeviceId: string) {
  if (loadDeviceId(db) !== stringAt(ownerDeviceId, 'ownerDeviceId'))
    return fail('post-save cursor belongs to another device');
  const row = db
    .prepare('SELECT * FROM local_character_post_save_cursor WHERE owner_device_id = ?')
    .get(ownerDeviceId) as Row | undefined;
  if (row === undefined) return null;
  const head = readPostSaveHeadById(db, stringAt(row['scope_id'], 'scopeId'), ownerDeviceId);
  const restoreCommandId =
    row['restore_command_id'] === null
      ? null
      : stringAt(row['restore_command_id'], 'restoreCommandId');
  if (
    head === null ||
    cursorBindingHash(head.scope, restoreCommandId) !== row['scope_binding_sha256']
  )
    return fail('post-save cursor binding differs');
  return { head, restoreCommandId };
}

/** An accepted restore closes the old screen even if the process stops before network adoption. */
export function readPostSaveRestoreCommand(
  db: Database.Database,
  ownerDeviceId: string,
): {
  readonly command: StoredPostSaveCommand;
  readonly head: PostSaveHead;
} | null {
  const cursor = readPostSaveCursorRow(db, ownerDeviceId);
  if (cursor === null || cursor.restoreCommandId === null) return null;
  const { head, restoreCommandId } = cursor;
  const command = readPostSaveCommand(db, restoreCommandId, head.scope);
  if (
    command === null ||
    command.commandKind !== 'UI-CMD-LOCAL-CHECKPOINT-RESTORE' ||
    head.scope.entityKind !== 'CHARACTER_DRAFT' ||
    head.scope.ownerContext !== 'PLAYER_LOCAL'
  )
    return fail('restore cursor has no bound restore command');
  const request = command.request;
  const payload = objectAt(request['payload'], 'restore request payload');
  const result = objectAt(command.receipt['result'], 'restore receipt result');
  const proof = objectAt(result['restoredCheckpointOrNull'], 'restore checkpoint proof');
  const expectedRevisions = revisionsAt(request['expectedRevisions']);
  revisionsAt(result['targetRevisions']);
  stringAt(proof['checkpointId'], 'restore checkpointId');
  revisionAt(proof['checkpointRevision'], 'restore checkpointRevision');
  hashAt(proof['checkpointSha256'], 'restore checkpointSha256');
  stringAt(proof['resumeFormId'], 'restore resumeFormId');
  const sourceBindingHash = sha256(JSON.stringify(head.scope.sourceBinding));
  if (
    request['commandId'] !== command.commandId ||
    request['workflowCommandId'] !== command.commandKind ||
    request['role'] !== 'player' ||
    request['commandKind'] !== 'workflow-command' ||
    request['messageType'] !== 'command.request' ||
    request['protocolVersion'] !== 1 ||
    payload['stage'] !== 'LOCAL_CHARACTER_POST_SAVE' ||
    payload['variant'] !== 'RESTORE' ||
    payload['sourceFormId'] !== 'APP-009' ||
    payload['expectedMetadataRevisionOrNull'] !== null ||
    payload['postSaveScopeId'] !== head.scope.scopeId ||
    payload['sourceBindingHash'] !== sourceBindingHash ||
    payload['sourceEntityId'] !== head.scope.entityId ||
    command.receipt['commandId'] !== command.commandId ||
    command.receipt['receiptId'] !== command.receiptId ||
    !isDeepStrictEqual(command.receipt['revisions'], expectedRevisions) ||
    result['stage'] !== 'LOCAL_CHARACTER_POST_SAVE' ||
    result['variant'] !== 'RESTORE' ||
    result['sourceFormId'] !== 'APP-009' ||
    result['postSaveScopeId'] !== head.scope.scopeId ||
    result['sourceBindingHash'] !== sourceBindingHash ||
    result['sourceEntityId'] !== head.scope.entityId ||
    !isDeepStrictEqual(result['sourceRevisions'], expectedRevisions) ||
    result['targetEntityId'] !== head.scope.entityId ||
    proof['ownerId'] !== head.scope.entityId ||
    proof['ownerDeviceId'] !== ownerDeviceId ||
    result['nextFormId'] !== proof['resumeFormId']
  )
    return fail('restore cursor command or receipt binding differs');
  return { command, head };
}

/** Retire the receipt handoff atomically with the next authoritative write, never after sending it. */
export function retirePostSaveRestoreCursor(db: Database.Database, localCharacterId: string): void {
  if (!db.inTransaction)
    return fail('restore cursor retirement requires the checkpoint transaction');
  const schema = db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as Row;
  const version = schema['version'];
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || version > 6)
    return fail('unknown schema version for restore cursor retirement');
  // Versions 1..5 predate this aggregate. A version-6 database must have its actual tables.
  if (version < 6) return;
  if (
    db
      .prepare(
        'SELECT 1 FROM local_character_post_save_cursor WHERE restore_command_id IS NOT NULL LIMIT 1',
      )
      .get() === undefined
  )
    return;
  const restored = readPostSaveRestoreCommand(db, loadDeviceId(db));
  if (
    restored === null ||
    restored.head.scope.entityId !== stringAt(localCharacterId, 'localCharacterId')
  )
    return;
  const cursor = restored.head.scope;
  const result = db
    .prepare(
      'DELETE FROM local_character_post_save_cursor WHERE owner_device_id = ? AND scope_id = ? AND restore_command_id = ? AND scope_binding_sha256 = ?',
    )
    .run(
      cursor.ownerDeviceId,
      cursor.scopeId,
      restored.command.commandId,
      cursorBindingHash(cursor, restored.command.commandId),
    );
  if (result.changes !== 1) return fail('restore cursor changed during retirement');
}

/** The active screen is an exact durable pointer, never the newest row by coincidence. */
export function readPostSaveCursor(
  db: Database.Database,
  ownerDeviceId: string,
): PostSaveHead | null {
  const cursor = readPostSaveCursorRow(db, ownerDeviceId);
  if (cursor === null) return null;
  if (cursor.restoreCommandId !== null) {
    readPostSaveRestoreCommand(db, ownerDeviceId);
    return null;
  }
  return cursor.head;
}

export function writePostSaveCursor(
  db: Database.Database,
  scope: PostSaveScope | null,
  restoreCommandId?: string,
): void {
  if (scope === null && restoreCommandId !== undefined)
    return fail('restore cursor needs its source scope');
  const write = (): void => {
    const ownerDeviceId = loadDeviceId(db);
    if (scope === null) {
      db.prepare('DELETE FROM local_character_post_save_cursor WHERE owner_device_id = ?').run(
        ownerDeviceId,
      );
      return;
    }
    const head = readPostSaveHead(db, scope);
    if (head === null) return fail('cannot select a missing post-save head');
    const restoreId =
      restoreCommandId === undefined ? null : stringAt(restoreCommandId, 'restoreCommandId');
    const pending = pendingRestoreCursors.get(db);
    if (
      restoreId !== null &&
      (scope.entityKind !== 'CHARACTER_DRAFT' || scope.ownerContext !== 'PLAYER_LOCAL')
    )
      return fail('restore cursor requires a local draft');
    const deferred = restoreId !== null && readCommandRow(db, restoreId) === null;
    if (deferred && (pending?.commandId !== restoreId || pending.scopeId !== scope.scopeId))
      return fail('restore cursor may precede only its active restore transaction');
    db.prepare(
      `INSERT INTO local_character_post_save_cursor (owner_device_id, scope_id, restore_command_id, scope_binding_sha256)
      VALUES (?, ?, ?, ?) ON CONFLICT(owner_device_id) DO UPDATE SET scope_id=excluded.scope_id, restore_command_id=excluded.restore_command_id,
      scope_binding_sha256=excluded.scope_binding_sha256`,
    ).run(ownerDeviceId, scope.scopeId, restoreId, cursorBindingHash(head.scope, restoreId));
    if (deferred) pending!.written = true;
    else readPostSaveCursor(db, ownerDeviceId);
  };
  if (db.inTransaction) write();
  else transaction(db, write);
}
export function createPostSaveHead(
  db: Database.Database,
  scope: PostSaveScope,
  presentation: JsonObject,
  validateSource: () => void,
  options?: { readonly initialMetadataRevision: number },
): PostSaveHead {
  return transaction(db, () => {
    const checked = scopeAt(scope);
    assertScopeOwner(db, checked);
    const sourceBefore = sourceRows(db, checked);
    sync(validateSource);
    assertSourceUnchanged(db, checked, sourceBefore);
    jsonText(presentation);
    const prior = readPostSaveHead(db, checked);
    if (prior !== null) return prior;
    const metadata =
      checked.entityKind === 'LOCAL_FINAL' ? readLocalMetadataHistory(db, checked.entityId) : [];
    if (metadata.some((row) => row.finalSnapshotSha256 !== checked.baseSnapshotSha256))
      return fail('metadata belongs to another final snapshot');
    const head: PostSaveHead = {
      scope: checked,
      ...checked.baseRevisions,
      metadataRevision:
        checked.entityKind === 'COMPLETED_CAMPAIGN_COPY'
          ? revisionAt(options?.initialMetadataRevision ?? 0, 'initialMetadataRevision')
          : metadata.length,
      presentation: structuredClone(presentation),
    };
    writeHead(db, head);
    assertSourceUnchanged(db, checked, sourceBefore);
    return readPostSaveHead(db, checked)!;
  });
}

/** Bounded archive lookup: its full campaign checkpoint must match the actual persisted rows. */
export function readArchivedCampaignCharacterSource(
  db: Database.Database,
  campaignId: string,
  campaignCharacterId: string,
) {
  const checkpoint = loadCampaignCheckpoint(db, stringAt(campaignId, 'campaignId'));
  const campaign = db
    .prepare('SELECT lifecycle_state FROM campaign WHERE campaign_id = ?')
    .get(campaignId) as Row | undefined;
  const copy = db
    .prepare(
      'SELECT campaign_character_id, campaign_id, source_uuid, lifecycle_state, payload_json FROM campaign_character_copy WHERE campaign_character_id = ? AND campaign_id = ?',
    )
    .get(stringAt(campaignCharacterId, 'campaignCharacterId'), campaignId) as Row | undefined;
  if (
    campaign === undefined ||
    copy === undefined ||
    campaign['lifecycle_state'] !== 'IMMUTABLE_ARCHIVE' ||
    copy['lifecycle_state'] !== 'ARCHIVED'
  )
    return fail('source is not an archived copy of an immutable campaign');
  return {
    checkpoint,
    campaignCharacterId,
    sourceUuid: stringAt(copy['source_uuid'], 'sourceUuid'),
    payloadJson: stringAt(copy['payload_json'], 'copy payloadJson'),
  };
}
export function updatePostSavePresentation(
  db: Database.Database,
  scope: PostSaveScope,
  expectedRevisions: RevisionTriple,
  presentation: JsonObject,
  validateSource: () => void,
): PostSaveHead {
  return transaction(db, () => {
    const sourceBefore = sourceRows(db, scope);
    sync(validateSource);
    assertSourceUnchanged(db, scope, sourceBefore);
    const head = readPostSaveHead(db, scope);
    if (head === null || !isDeepStrictEqual(revisionsOf(head), revisionsAt(expectedRevisions)))
      return fail('stale or missing post-save head');
    jsonText(presentation);
    const next = {
      ...head,
      ...nextRevisions(head, {
        stateChanged: false,
        projectionChanged: !isDeepStrictEqual(head.presentation, presentation),
        actorVisibilityChanged: false,
      }),
      presentation: structuredClone(presentation),
    };
    writeHead(db, next);
    assertSourceUnchanged(db, scope, sourceBefore);
    return readPostSaveHead(db, scope)!;
  });
}

function readCommandRow(db: Database.Database, commandId: string): StoredPostSaveCommand | null {
  const row = db
    .prepare('SELECT * FROM local_character_post_save_command WHERE command_id = ?')
    .get(commandId) as Row | undefined;
  if (row === undefined) return null;
  for (const field of ['request', 'receipt', 'effects'])
    if (sha256(stringAt(row[`${field}_json`], field)) !== row[`${field}_sha256`])
      fail(`${field} journal checksum differs`);
  return {
    commandId: stringAt(row['command_id'], 'commandId'),
    receiptId: stringAt(row['receipt_id'], 'receiptId'),
    scopeId: stringAt(row['scope_id'], 'scopeId'),
    commandKind: stringAt(row['command_kind'], 'commandKind'),
    request: parsedJson(row['request_json'], 'request'),
    receipt: parsedJson(row['receipt_json'], 'receipt'),
    effects: parsedJson(row['effects_json'], 'effects'),
  };
}
export function readPostSaveCommand(
  db: Database.Database,
  commandId: string,
  scope: PostSaveScope,
): StoredPostSaveCommand | null {
  if (readPostSaveHead(db, scope) === null) return fail('missing post-save head');
  const command = readCommandRow(db, commandId);
  if (command !== null && command.scopeId !== scope.scopeId)
    return fail('command belongs to another scope');
  return command;
}

export function readPostSaveCommandById(
  db: Database.Database,
  commandId: string,
  ownerDeviceId: string,
): { readonly command: StoredPostSaveCommand; readonly head: PostSaveHead } | null {
  if (loadDeviceId(db) !== stringAt(ownerDeviceId, 'ownerDeviceId'))
    return fail('post-save command reader belongs to another device');
  const command = readCommandRow(db, stringAt(commandId, 'commandId'));
  if (command === null) return null;
  const head = readPostSaveHeadById(db, command.scopeId, ownerDeviceId);
  if (head === null) return fail('post-save command has no scope');
  return { command, head };
}
const assertUnusedId = (db: Database.Database, id: string): void => {
  stringAt(id, 'new ID');
  const used = db
    .prepare(
      `SELECT 1 FROM local_character WHERE local_character_id = ?
    UNION ALL SELECT 1 FROM local_character_checkpoint WHERE checkpoint_id = ?
    UNION ALL SELECT 1 FROM local_character_post_save_command WHERE command_id = ? OR receipt_id = ?
    UNION ALL SELECT 1 FROM local_character_post_save_head WHERE scope_id = ? LIMIT 1`,
    )
    .get(id, id, id, id, id);
  if (used !== undefined) fail('ID already belongs to a character, checkpoint, scope or command');
};
export function readLocalMetadataHistory(
  db: Database.Database,
  characterId: string,
): readonly LocalMetadataRevision[] {
  assertLocalCharacterOwnedByDevice(db, characterId, loadDeviceId(db));
  const rows = db
    .prepare(
      'SELECT * FROM local_character_metadata_revision WHERE local_character_id = ? ORDER BY revision',
    )
    .all(characterId) as Row[];
  return rows.map((row, index) => {
    const revision = revisionAt(row['revision'], 'metadata revision');
    const valuesJson = stringAt(row['values_json'], 'metadata values');
    if (revision !== index + 1 || sha256(valuesJson) !== row['values_sha256'])
      return fail('metadata history sequence or checksum differs');
    const result: LocalMetadataRevision = {
      localCharacterId: stringAt(row['local_character_id'], 'characterId'),
      revision,
      finalSnapshotSha256: hashAt(row['final_snapshot_sha256'], 'final snapshot hash'),
      values: metadataAt(parsedJson(valuesJson, 'metadata values')),
      valuesSha256: hashAt(row['values_sha256'], 'values hash'),
      previousValuesSha256: hashAt(row['previous_values_sha256'], 'previous values hash'),
      commandId: stringAt(row['command_id'], 'metadata command'),
    };
    const previous = rows[index - 1];
    if (
      previous !== undefined &&
      (previous['values_sha256'] !== result.previousValuesSha256 ||
        previous['final_snapshot_sha256'] !== result.finalSnapshotSha256)
    )
      return fail('metadata history link differs');
    const command = readCommandRow(db, result.commandId);
    if (
      command === null ||
      command.commandKind !== 'UI-CMD-CHAR-LOCAL-METADATA-PATCH' ||
      !isDeepStrictEqual(command.effects['metadata'], {
        characterId,
        revision,
        valuesSha256: result.valuesSha256,
      })
    )
      return fail('metadata journal binding differs');
    return result;
  });
}
export function commitPostSaveCommand(
  db: Database.Database,
  input: PostSaveCommandInput,
  validateSource: () => void,
  apply: (writer: PostSaveCommandWriter, next: PostSaveHead) => JsonObject,
): {
  readonly replayed: boolean;
  readonly command: StoredPostSaveCommand;
  readonly head: PostSaveHead;
} {
  return transaction(db, () => {
    if (Object.prototype.toString.call(apply) === '[object AsyncFunction]')
      return fail('transaction callback must be synchronous');
    const head = readPostSaveHead(db, input.scope);
    if (head === null) return fail('missing post-save head');
    const sourceBefore = sourceRows(db, input.scope);
    sync(validateSource);
    assertSourceUnchanged(db, input.scope, sourceBefore);
    jsonText(input.request);
    const prior = readPostSaveCommand(db, input.commandId, input.scope);
    if (prior !== null) {
      if (
        prior.commandKind !== input.commandKind ||
        !isDeepStrictEqual(prior.request, input.request)
      )
        return fail('command ID reused with a different request');
      return { replayed: true, command: prior, head };
    }
    if (!isDeepStrictEqual(revisionsAt(input.expectedRevisions), revisionsOf(head)))
      return fail('stale post-save revisions');
    if (
      ![
        'UI-CMD-CHAR-LOCAL-METADATA-PATCH',
        'UI-CMD-CHAR-VARIANT-CREATE',
        'UI-CMD-CHAR-EXPORT',
        'UI-CMD-LOCAL-CHECKPOINT-RESTORE',
        'UI-CMD-CHAR-WIZARD-CHECKPOINT',
      ].includes(input.commandKind)
    )
      return fail('unknown post-save command');
    if (input.commandId === input.receiptId) return fail('command and receipt IDs collide');
    const expectedImpact: RevisionImpact = {
      stateChanged:
        input.commandKind === 'UI-CMD-CHAR-LOCAL-METADATA-PATCH' ||
        input.commandKind === 'UI-CMD-CHAR-VARIANT-CREATE',
      projectionChanged:
        input.commandKind === 'UI-CMD-CHAR-LOCAL-METADATA-PATCH' ||
        input.commandKind === 'UI-CMD-CHAR-VARIANT-CREATE',
      actorVisibilityChanged: false,
    };
    if (!isDeepStrictEqual(input.impact, expectedImpact))
      return fail('command revision impact differs from its post-save scope');
    assertUnusedId(db, input.commandId);
    assertUnusedId(db, input.receiptId);
    let next: PostSaveHead = { ...head, ...nextRevisions(head, input.impact) };
    const effects: Record<string, JsonObject> = {};
    let active = true;
    const assertActive = () => {
      if (!active) fail('command writer is no longer active');
    };
    const writer: PostSaveCommandWriter = {
      appendMetadata(values, baselineValues) {
        assertActive();
        if (
          input.commandKind !== 'UI-CMD-CHAR-LOCAL-METADATA-PATCH' ||
          input.scope.entityKind !== 'LOCAL_FINAL' ||
          effects['metadata'] !== undefined ||
          !input.impact.stateChanged ||
          !input.impact.projectionChanged
        )
          return fail('metadata mutation is not allowed');
        const history = readLocalMetadataHistory(db, input.scope.entityId);
        if (
          history.length !== head.metadataRevision ||
          history.some((r) => r.finalSnapshotSha256 !== input.scope.baseSnapshotSha256)
        )
          return fail('metadata head differs from immutable history');
        const baseline = metadataAt(baselineValues);
        const baselineHash = sha256(jsonText(baseline));
        if (history[0] !== undefined && history[0].previousValuesSha256 !== baselineHash)
          return fail('metadata baseline differs');
        const checked = metadataAt(values);
        const valuesJson = jsonText(checked);
        const revision = revisionAt(head.metadataRevision + 1, 'next metadata revision');
        const previousValuesSha256 = history.at(-1)?.valuesSha256 ?? baselineHash;
        const result: LocalMetadataRevision = {
          localCharacterId: input.scope.entityId,
          revision,
          finalSnapshotSha256: input.scope.baseSnapshotSha256,
          values: checked,
          valuesSha256: sha256(valuesJson),
          previousValuesSha256,
          commandId: input.commandId,
        };
        db.prepare(
          `INSERT INTO local_character_metadata_revision
          (local_character_id, revision, final_snapshot_sha256, values_json, values_sha256, previous_values_sha256, command_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          result.localCharacterId,
          revision,
          result.finalSnapshotSha256,
          valuesJson,
          result.valuesSha256,
          previousValuesSha256,
          input.commandId,
        );
        next = { ...next, metadataRevision: revision };
        effects['metadata'] = {
          characterId: input.scope.entityId,
          revision,
          valuesSha256: result.valuesSha256,
        };
        return result;
      },
      createVariant(characterId, values) {
        assertActive();
        if (
          input.commandKind !== 'UI-CMD-CHAR-VARIANT-CREATE' ||
          input.scope.entityKind !== 'LOCAL_FINAL' ||
          effects['variant'] !== undefined
        )
          return fail('variant mutation is not allowed');
        if (characterId === input.commandId || characterId === input.receiptId)
          return fail('variant ID collides with command');
        assertUnusedId(db, characterId);
        const payloadJson = JSON.stringify({
          kind: 'LOCAL_VARIANT_PRE_IDENTITY',
          schemaVersion: 1,
          metadata: metadataAt(values),
          birthCommandId: input.commandId,
          birthReceiptId: input.receiptId,
        });
        db.prepare(
          'INSERT INTO local_character (local_character_id, lifecycle_state, payload_json) VALUES (?, ?, ?)',
        ).run(characterId, 'VARIANT', payloadJson);
        db.prepare(
          'INSERT INTO local_character_owner (local_character_id, owner_device_id, variant_birth_command_id) VALUES (?, ?, ?)',
        ).run(characterId, input.scope.ownerDeviceId, input.commandId);
        effects['variant'] = { characterId, provisionalPayloadSha256: sha256(payloadJson) };
        return readLocalCharacter(db, characterId);
      },
      discardIntent(expected, assertUncommitted) {
        assertActive();
        if (
          input.commandKind !== 'UI-CMD-LOCAL-CHECKPOINT-RESTORE' ||
          input.scope.entityKind !== 'CHARACTER_DRAFT' ||
          effects['discardedIntent'] !== undefined ||
          expected.localCharacterId !== input.scope.entityId ||
          expected.baseSnapshotSha256 !== input.scope.baseSnapshotSha256
        )
          return fail('intent discard is not allowed');
        clearLocalCharacterWriteIntent(db, expected, assertUncommitted);
        effects['discardedIntent'] = {
          commandId: expected.commandId,
          intentSha256: expected.intentSha256,
        };
      },
      setPresentation(presentation) {
        assertActive();
        jsonText(presentation);
        if (!isDeepStrictEqual(head.presentation, presentation) && !input.impact.projectionChanged)
          return fail('presentation changed without revision impact');
        next = { ...next, presentation: structuredClone(presentation) };
      },
    };
    let receipt: JsonObject;
    const restoreCursor =
      input.commandKind === 'UI-CMD-LOCAL-CHECKPOINT-RESTORE'
        ? { commandId: input.commandId, scopeId: input.scope.scopeId, written: false }
        : null;
    if (restoreCursor !== null) pendingRestoreCursors.set(db, restoreCursor);
    try {
      receipt = apply(writer, structuredClone(next));
    } finally {
      active = false;
      pendingRestoreCursors.delete(db);
    }
    const receiptJson = jsonText(receipt);
    if (receipt['commandId'] !== input.commandId || receipt['receiptId'] !== input.receiptId)
      return fail('receipt command binding differs');
    if (!isDeepStrictEqual(receipt['revisions'], revisionsOf(next)))
      return fail('receipt revisions differ from committed head');
    if (
      input.commandKind === 'UI-CMD-CHAR-LOCAL-METADATA-PATCH' &&
      effects['metadata'] === undefined
    )
      return fail('metadata command did not append a revision');
    if (input.commandKind === 'UI-CMD-CHAR-VARIANT-CREATE' && effects['variant'] === undefined)
      return fail('variant command did not create its character');
    const requestJson = jsonText(input.request);
    const effectsJson = jsonText(effects);
    db.prepare(
      `INSERT INTO local_character_post_save_command
      (command_id, receipt_id, scope_id, command_kind, request_json, request_sha256, receipt_json, receipt_sha256, effects_json, effects_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.commandId,
      input.receiptId,
      input.scope.scopeId,
      input.commandKind,
      requestJson,
      sha256(requestJson),
      receiptJson,
      sha256(receiptJson),
      effectsJson,
      sha256(effectsJson),
    );
    writeHead(db, next);
    const storedHead = readPostSaveHead(db, input.scope)!;
    if (
      restoreCursor?.written &&
      readPostSaveRestoreCommand(db, input.scope.ownerDeviceId)?.command.commandId !==
        input.commandId
    )
      return fail('restore cursor changed during commit');
    assertSourceUnchanged(db, input.scope, sourceBefore);
    if (!isDeepStrictEqual(storedHead, next)) return fail('post-save head changed during commit');
    if (effects['metadata'] !== undefined) readLocalMetadataHistory(db, input.scope.entityId);
    return {
      replayed: false,
      command: readPostSaveCommand(db, input.commandId, input.scope)!,
      head: storedHead,
    };
  });
}

export function readLocalCharacterWriteIntent(
  db: Database.Database,
  characterId: string,
): LocalCharacterWriteIntent | null {
  assertLocalCharacterOwnedByDevice(db, characterId, loadDeviceId(db));
  const row = db
    .prepare('SELECT * FROM local_character_write_intent WHERE local_character_id = ?')
    .get(characterId) as Row | undefined;
  if (row === undefined) return null;
  const ownerDeviceId = stringAt(row['owner_device_id'], 'intent owner');
  if (ownerDeviceId !== loadDeviceId(db)) return fail('intent owner differs');
  const intentJson =
    typeof row['intent_json'] === 'string' ? row['intent_json'] : fail('intent_json must be text');
  const intentSha256 = hashAt(row['intent_sha256'], 'intent_sha256');
  let valid = sha256(intentJson) === intentSha256;
  try {
    parsedJson(intentJson, 'intent');
  } catch {
    valid = false;
  }
  return {
    localCharacterId: characterId,
    ownerDeviceId,
    checkpointId: stringAt(row['checkpoint_id'], 'checkpointId'),
    baseCheckpointRevision: revisionAt(row['base_checkpoint_revision'], 'base checkpoint revision'),
    baseSnapshotSha256: hashAt(row['base_snapshot_sha256'], 'base snapshot hash'),
    commandId: stringAt(row['command_id'], 'intent command'),
    intentJson,
    intentSha256,
    payloadIntegrity: valid ? 'VALID' : 'CORRUPT',
  };
}
const assertIntentBase = (db: Database.Database, intent: LocalCharacterWriteIntent): void => {
  assertLocalCharacterOwnedByDevice(db, intent.localCharacterId, intent.ownerDeviceId);
  const checkpoint = loadLocalCharacterCheckpoint(db, intent.localCharacterId);
  if (
    readLocalCharacter(db, intent.localCharacterId).lifecycleState !== 'DRAFT' ||
    checkpoint.checkpointId !== intent.checkpointId ||
    checkpoint.checkpointRevision !== intent.baseCheckpointRevision ||
    checkpoint.snapshotSha256 !== intent.baseSnapshotSha256
  )
    fail('intent base differs from the complete draft checkpoint');
};
export function prepareLocalCharacterWriteIntent(
  db: Database.Database,
  input: Omit<LocalCharacterWriteIntent, 'intentJson' | 'intentSha256' | 'payloadIntegrity'> & {
    readonly intent: JsonObject;
  },
  validateUncommitted: () => void,
): LocalCharacterWriteIntent {
  return transaction(db, () => {
    const intentJson = jsonText(input.intent);
    const intent: LocalCharacterWriteIntent = {
      ...input,
      intentJson,
      intentSha256: sha256(intentJson),
      payloadIntegrity: 'VALID',
    };
    assertIntentBase(db, intent);
    sync(validateUncommitted);
    assertIntentBase(db, intent);
    assertUnusedId(db, input.commandId);
    if (readLocalCharacterWriteIntent(db, input.localCharacterId) !== null)
      return fail('another uncommitted intent exists');
    db.prepare(
      `INSERT INTO local_character_write_intent
      (local_character_id, owner_device_id, checkpoint_id, base_checkpoint_revision, base_snapshot_sha256, command_id, intent_json, intent_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.localCharacterId,
      input.ownerDeviceId,
      input.checkpointId,
      input.baseCheckpointRevision,
      input.baseSnapshotSha256,
      input.commandId,
      intentJson,
      intent.intentSha256,
    );
    return readLocalCharacterWriteIntent(db, input.localCharacterId)!;
  });
}
/** Call before the checkpoint writer inside its existing transaction; rollback retains the intent. */
export function clearLocalCharacterWriteIntent(
  db: Database.Database,
  expected: LocalCharacterWriteIntent,
  assertUncommitted: (commandId: string) => void,
): void {
  if (!db.inTransaction) return fail('intent removal requires the owning transaction');
  const current = readLocalCharacterWriteIntent(db, expected.localCharacterId);
  if (!isDeepStrictEqual(current, expected)) return fail('intent changed before removal');
  assertIntentBase(db, expected);
  if (readCommandRow(db, expected.commandId) !== null)
    return fail('intent command is already committed');
  sync(() => assertUncommitted(expected.commandId));
  if (
    db
      .prepare(
        'DELETE FROM local_character_write_intent WHERE local_character_id = ? AND command_id = ?',
      )
      .run(expected.localCharacterId, expected.commandId).changes !== 1
  )
    fail('intent removal changed an unexpected row count');
}

export function initializeVariantCharacterCheckpoint(
  db: Database.Database,
  proof: VariantInitializationProof,
  identityPayloadJson: string,
  validate: (localCharacter: LocalCharacter, checkpoint: LocalCharacterCheckpoint) => void,
): { readonly result: LocalCharacter; readonly checkpoint: LocalCharacterCheckpoint } {
  return transaction(db, () => {
    if (Object.prototype.toString.call(validate) === '[object AsyncFunction]')
      return fail('transaction callback must be synchronous');
    const owner = assertLocalCharacterOwnedByDevice(
      db,
      proof.characterId,
      proof.expectedOwnerDeviceId,
    );
    if (owner.variantBirthCommandId !== proof.variantBirthCommandId)
      return fail('variant birth owner binding differs');
    const original = readLocalCharacter(db, proof.characterId);
    if (
      original.lifecycleState !== 'VARIANT' ||
      Object.values(revisionsOf(original)).some((r) => r !== 0) ||
      sha256(original.payloadJson) !== proof.expectedProvisionalPayloadSha256
    )
      return fail('not an untouched provisional variant');
    const marker = objectAt(parsedJson(original.payloadJson, 'variant marker'), 'variant marker');
    exactKeys(
      marker,
      ['kind', 'schemaVersion', 'metadata', 'birthCommandId', 'birthReceiptId'],
      'variant marker',
    );
    metadataAt(marker['metadata']);
    if (
      marker['kind'] !== 'LOCAL_VARIANT_PRE_IDENTITY' ||
      marker['schemaVersion'] !== 1 ||
      marker['birthCommandId'] !== proof.variantBirthCommandId ||
      marker['birthReceiptId'] !== proof.variantBirthReceiptId
    )
      return fail('variant marker birth proof differs');
    const birth = readCommandRow(db, proof.variantBirthCommandId);
    if (
      birth === null ||
      birth.commandKind !== 'UI-CMD-CHAR-VARIANT-CREATE' ||
      birth.receiptId !== proof.variantBirthReceiptId ||
      !isDeepStrictEqual(birth.effects['variant'], {
        characterId: proof.characterId,
        provisionalPayloadSha256: proof.expectedProvisionalPayloadSha256,
      })
    )
      return fail('variant birth journal proof differs');
    const sourceScopeRow = db
      .prepare('SELECT scope_json FROM local_character_post_save_head WHERE scope_id = ?')
      .get(birth.scopeId) as Row | undefined;
    if (sourceScopeRow === undefined) return fail('variant birth scope is missing');
    const sourceScope = scopeAt(parsedJson(sourceScopeRow['scope_json'], 'birth scope'));
    readPostSaveHead(db, sourceScope);
    if (
      sourceScope.ownerDeviceId !== proof.expectedOwnerDeviceId ||
      sourceScope.entityKind !== 'LOCAL_FINAL'
    )
      return fail('variant birth source is foreign');
    for (const table of [
      'local_character_checkpoint',
      'local_character_skill_presentation',
      'local_character_symbiont_presentation',
    ])
      if (
        db.prepare(`SELECT 1 FROM ${table} WHERE local_character_id = ?`).get(proof.characterId) !==
        undefined
      )
        return fail('variant already has a checkpoint or presentation');
    const variantHeads = db
      .prepare('SELECT scope_id FROM local_character_post_save_head WHERE entity_id = ?')
      .all(proof.characterId) as Row[];
    if (variantHeads.length !== 0) {
      const scope = proof.provisionalScope;
      if (
        variantHeads.length !== 1 ||
        scope === undefined ||
        scope.scopeId !== variantHeads[0]!['scope_id'] ||
        scope.entityKind !== 'PROVISIONAL_VARIANT' ||
        scope.entityId !== proof.characterId ||
        scope.ownerDeviceId !== proof.expectedOwnerDeviceId ||
        scope.baseSnapshotSha256 !== proof.expectedProvisionalPayloadSha256 ||
        Object.values(scope.baseRevisions).some((r) => r !== 0) ||
        readPostSaveHead(db, scope) === null
      )
        return fail('variant navigation scope differs from birth proof');
      db.prepare('DELETE FROM local_character_post_save_head WHERE scope_id = ?').run(
        scope.scopeId,
      );
    } else if (proof.provisionalScope !== undefined)
      return fail('variant navigation scope is missing');
    if (
      db
        .prepare('SELECT 1 FROM local_character_write_intent WHERE local_character_id = ?')
        .get(proof.characterId) !== undefined
    )
      return fail('variant already has post-save state');
    assertUnusedId(db, proof.checkpointId);
    parsedJson(identityPayloadJson, 'identity payload');
    db.prepare(
      "UPDATE local_character SET lifecycle_state = 'DRAFT', payload_json = ? WHERE local_character_id = ? AND lifecycle_state = 'VARIANT'",
    ).run(identityPayloadJson, proof.characterId);
    const result = readLocalCharacter(db, proof.characterId);
    const snapshotJson = JSON.stringify({
      localCharacter: {
        localCharacterId: result.localCharacterId,
        lifecycleState: result.lifecycleState,
        payloadJson: result.payloadJson,
      },
    });
    db.prepare(
      `INSERT INTO local_character_checkpoint
      (checkpoint_id, local_character_id, checkpoint_revision, snapshot_json, snapshot_sha256, stateRevision, projectionRevision, actorVisibilityRevision)
      VALUES (?, ?, 0, ?, ?, 0, 0, 0)`,
    ).run(proof.checkpointId, proof.characterId, snapshotJson, sha256(snapshotJson));
    const checkpoint = loadLocalCharacterCheckpoint(db, proof.characterId);
    sync(() => validate(result, checkpoint));
    if (
      !isDeepStrictEqual(readLocalCharacter(db, proof.characterId), result) ||
      !isDeepStrictEqual(loadLocalCharacterCheckpoint(db, proof.characterId), checkpoint)
    )
      return fail('variant initialization changed during validation');
    return { result, checkpoint };
  });
}
