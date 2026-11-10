import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { migration0015, NPC_TABLES } from './migrations/0015-persistent-npc.js';
import { migration0021 } from './migrations/0021-sentient-enemy-v1.js';

/** The original allocators also see enemy template and cancelled-attempt reservations. */
export function campaignEnemyIdentityInUse(db: Database.Database, id: string): boolean {
  const migration = db
    .prepare('SELECT name,checksum_sha256 FROM schema_migration WHERE version=21')
    .get() as { name: string; checksum_sha256: string } | undefined;
  if (migration === undefined) {
    if (
      [
        'campaign_enemy_template',
        'campaign_enemy_version',
        'campaign_enemy_history',
        'campaign_enemy_current_version',
      ].some(
        (table) => db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(table) !== undefined,
      )
    )
      throw Error('Enemy identities exist without migration21');
    return false;
  }
  if (
    migration.name !== migration0021.name ||
    migration.checksum_sha256 !== createHash('sha256').update(migration0021.sql).digest('hex')
  )
    throw Error('Enemy identity migration differs');
  for (const [table, column] of [
    ['campaign_enemy_template', 'template_id'],
    ['campaign_enemy_version', 'version_id'],
    ['campaign_enemy_history', 'history_id'],
  ] as const)
    if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(id) !== undefined) return true;
  return (
    db
      .prepare(
        `SELECT 1 FROM gm_request_queue_event e WHERE e.kind='ENEMY_AUTHORING' AND (
    json_extract(e.record_json,'$.mutation.cause.receiptId')=? OR
    EXISTS(SELECT 1 FROM json_each(e.record_json,'$.mutation.cause.itemTemplateKeys') WHERE value=?) OR
    EXISTS(SELECT 1 FROM json_each(e.record_json,'$.mutation.cause.request.payload.data.inventoryItems') WHERE json_extract(value,'$.linkedSetInstanceId')=?)
  ) LIMIT 1`,
      )
      .get(id, id, id) !== undefined
  );
}

/** An older allocator must see technical reservations even after cancellation. */
export function npcIdentityInUse(db: Database.Database, id: string): boolean {
  const row = db
    .prepare('SELECT name,checksum_sha256 FROM schema_migration WHERE version=15')
    .get() as { name: unknown; checksum_sha256: unknown } | undefined;
  if (row === undefined) {
    for (const table of NPC_TABLES)
      if (db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(table) !== undefined)
        throw new Error('NPC identity namespace exists without migration 15');
    return false;
  }
  if (
    row.name !== migration0015.name ||
    row.checksum_sha256 !== createHash('sha256').update(migration0015.sql).digest('hex')
  )
    throw new Error('NPC identity namespace migration differs');
  for (const [table, column] of [
    ['npc_identity_reservation', 'candidate_npc_uuid'],
    ['npc_child_identity', 'child_id'],
    ['npc_attempt_event', 'draft_id'],
    ['npc_operation', 'operation_id'],
    ['npc_operation', 'receipt_id'],
    ['npc_library_checkpoint', 'checkpoint_id'],
    ['npc_version', 'npc_uuid'],
  ] as const)
    if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`).get(id) !== undefined)
      return true;
  // Immutable child facts keep their IDs occupied even when a derived index row is missing.
  if (
    db
      .prepare(
        "SELECT 1 FROM npc_attempt_event,json_each(npc_attempt_event.record_json,'$.childAllocations') AS c WHERE json_extract(c.value,'$.id')=? LIMIT 1",
      )
      .get(id) !== undefined
  )
    return true;
  // The immutable root still occupies its owner if the derived reservation index is damaged.
  return (
    db
      .prepare(
        "SELECT 1 FROM npc_attempt_event WHERE json_extract(record_json,'$.attempt.candidateNpcUuid')=? LIMIT 1",
      )
      .get(id) !== undefined
  );
}

export function assertNpcIdentityUnused(db: Database.Database, id: string): void {
  if (npcIdentityInUse(db, id))
    throw new Error('identity already belongs to a persistent NPC or its technical history');
  // Keep this established allocator entry point shared by device/store writers.
  if (campaignEnemyIdentityInUse(db, id))
    throw new Error(
      'identity already belongs to an enemy template/version or its technical history',
    );
}

/** Complements the existing network guard when allocating an NPC identity. */
export function legacyLocalIdentityInUse(db: Database.Database, id: string): boolean {
  for (const [table, column] of [
    ['local_character_checkpoint', 'checkpoint_id'],
    ['local_character_post_save_head', 'scope_id'],
    ['local_character_post_save_command', 'command_id'],
    ['local_character_post_save_command', 'receipt_id'],
    ['local_character_write_intent', 'command_id'],
  ] as const)
    if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`).get(id) !== undefined)
      return true;
  return false;
}
