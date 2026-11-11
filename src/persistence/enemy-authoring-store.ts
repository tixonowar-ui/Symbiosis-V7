import type Database from 'better-sqlite3';
import { types } from 'node:util';
import type {
  EnemyAttempt,
  EnemyAuthoringMutation,
  EnemySheet,
  EnemyVersionIdentity,
  EnemyWorkflowRequest,
} from '@shared/enemy-authoring.js';
import {
  enemyAuthoringReceipt,
  enemyVersionIdentityValue,
  enemyAuthoringMutationValue,
  reduceEnemyAuthoring,
} from '@shared/enemy-authoring.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import {
  appendGmRequestReviewEventInTransaction,
  readGmRequestReviewViewStateInTransaction,
  type GmRequestReviewScope,
  type CampaignPrivateOwnerValidator,
  type StoredGmRequestQueueEvent,
} from './campaign-creation.js';
import { readGmRequestReviewSource, type GmRequestReviewSource } from './network-device-request.js';
import { readAppliedMigrationVersion } from './migrations/index.js';
import { npcIdentityInUse, legacyLocalIdentityInUse } from './npc-identities.js';

export interface EnemyStoredVersion {
  readonly actorId: string;
  readonly operation: 'CREATE_SENTIENT_ENEMY_TEMPLATE';
  readonly identity: EnemyVersionIdentity;
  readonly attempt: EnemyAttempt;
  readonly sheet: EnemySheet;
  readonly sourceBaselineVersion: string;
  readonly operationId: string;
  readonly timestamp: string;
  readonly historyId: string;
}
const tables = [
  'campaign_enemy_template',
  'campaign_enemy_version',
  'campaign_enemy_history',
  'campaign_enemy_current_version',
] as const;
function versionAudit(
  version: EnemyStoredVersion,
  revisions: { stateRevision: number; projectionRevision: number; actorVisibilityRevision: number },
) {
  return {
    operationId: version.operationId,
    operation: version.operation,
    actorId: version.actorId,
    campaignId: version.identity.campaignId,
    timestamp: version.timestamp,
    before: null,
    after: { identity: version.identity, sheet: version.sheet },
    revisions,
    provenance: {
      creationAttemptId: version.attempt.attemptId,
      sourceBaselineVersion: version.sourceBaselineVersion,
    },
    art: { assetKey: version.identity.artAssetKey, sha256: version.identity.artSha256 },
    rngReceiptOrNull: null,
  };
}
function schema(db: Database.Database): boolean {
  const version = readAppliedMigrationVersion(db);
  if (version < 21) {
    if (
      tables.some(
        (table) => db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(table) !== undefined,
      )
    )
      return s.fail('SOURCE_CHANGED');
    return false;
  }
  if (version !== 21) return s.fail('SOURCE_CHANGED');
  for (const table of tables) db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  return true;
}
function checked(row: Record<string, unknown>): Record<string, unknown> {
  if (typeof row['record_json'] !== 'string') return s.fail('SOURCE_CHANGED');
  const value: unknown = JSON.parse(row['record_json']);
  if (
    s.sha(s.canonical(value)) !== row['record_sha256'] ||
    s.canonical(value) !== row['record_json'] ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  )
    return s.fail('SOURCE_CHANGED');
  return value as Record<string, unknown>;
}
/** Complete primitive closure for this campaign; no gameplay decision or host loader belongs here. */
export function readEnemyVersions(
  db: Database.Database,
  scope: GmRequestReviewScope,
  events: readonly StoredGmRequestQueueEvent[],
): readonly EnemyStoredVersion[] {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  if (!schema(db)) return [];
  const commits = events.filter(
    (event) =>
      event.mutation.kind === 'ENEMY_AUTHORING' &&
      event.mutation.cause.committedVersionOrNull !== null,
  );
  const templates = db
    .prepare('SELECT * FROM campaign_enemy_template WHERE campaign_id=? ORDER BY template_id')
    .all(scope.campaignId) as Record<string, unknown>[];
  const versions = db
    .prepare('SELECT * FROM campaign_enemy_version WHERE campaign_id=? ORDER BY template_id')
    .all(scope.campaignId) as Record<string, unknown>[];
  const history = db
    .prepare('SELECT * FROM campaign_enemy_history WHERE campaign_id=? ORDER BY template_id')
    .all(scope.campaignId) as Record<string, unknown>[];
  const pointers = db
    .prepare(
      'SELECT p.* FROM campaign_enemy_current_version p JOIN campaign_enemy_template t USING(template_id) WHERE t.campaign_id=? ORDER BY template_id',
    )
    .all(scope.campaignId) as Record<string, unknown>[];
  if ([templates, versions, history, pointers].some((rows) => rows.length !== commits.length))
    return s.fail('SOURCE_CHANGED');
  const result = versions.map((row, index) => {
    const saved = checked(row);
    const expectedKeys = [
      'identity',
      'attempt',
      'sheet',
      'sourceBaselineVersion',
      'operationId',
      'timestamp',
      'historyId',
      'actorId',
      'operation',
    ];
    if (
      Object.keys(saved).length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(saved, key))
    )
      return s.fail('SOURCE_CHANGED');
    const identity = enemyVersionIdentityValue(saved['identity']);
    const stored = saved as unknown as EnemyStoredVersion;
    const template = templates[index]!,
      h = history[index]!,
      pointer = pointers[index]!;
    const commit = commits.find(
      (event) =>
        event.mutation.kind === 'ENEMY_AUTHORING' &&
        s.same(event.mutation.cause.committedVersionOrNull, identity),
    );
    if (
      commit?.mutation.kind !== 'ENEMY_AUTHORING' ||
      identity.campaignId !== scope.campaignId ||
      row['template_id'] !== identity.templateId ||
      row['version_id'] !== identity.versionId ||
      row['version'] !== 1 ||
      template['template_id'] !== identity.templateId ||
      template['kind'] !== 'SENTIENT' ||
      !s.same(checked(template), {
        campaignId: scope.campaignId,
        templateId: identity.templateId,
        kind: 'SENTIENT',
      }) ||
      h['history_id'] !== stored.historyId ||
      h['template_id'] !== identity.templateId ||
      h['version_id'] !== identity.versionId ||
      !s.same(
        checked(h),
        versionAudit(stored, {
          stateRevision: commit.view.stateRevision,
          projectionRevision: commit.view.projectionRevision,
          actorVisibilityRevision: commit.view.actorVisibilityRevision,
        }),
      ) ||
      pointer['template_id'] !== identity.templateId ||
      pointer['version_id'] !== identity.versionId ||
      stored.operationId !== commit.eventId ||
      stored.timestamp !== commit.mutation.cause.timestamp ||
      stored.actorId !== commit.mutation.cause.authorMasterProfileId ||
      stored.operation !== 'CREATE_SENTIENT_ENEMY_TEMPLATE'
    )
      return s.fail('SOURCE_CHANGED');
    return stored;
  });
  const identities = new Map<string, { kind: string; attemptId: string }>();
  const reserve = (id: string, kind: string, attemptId: string) => {
    s.uuid(id);
    const prior = identities.get(id);
    if (prior !== undefined) {
      if (kind !== 'LINKED_SET' || prior.kind !== kind || prior.attemptId !== attemptId)
        return s.fail('SOURCE_CHANGED');
      return;
    }
    s.assertUnusedOutsideNpc(db, id);
    if (npcIdentityInUse(db, id) || legacyLocalIdentityInUse(db, id))
      return s.fail('SOURCE_CHANGED');
    for (const [table, column] of [
      ['campaign_enemy_template', 'template_id'],
      ['campaign_enemy_version', 'version_id'],
      ['campaign_enemy_history', 'history_id'],
    ] as const)
      if (
        db
          .prepare(`SELECT 1 FROM ${table} WHERE ${column}=? AND campaign_id<>?`)
          .get(id, scope.campaignId) !== undefined
      )
        return s.fail('FOREIGN_OWNER');
    const foreign = db
      .prepare(
        `SELECT 1 FROM gm_request_queue_event e WHERE e.kind='ENEMY_AUTHORING' AND (e.campaign_id<>? OR e.context_id<>? OR json_extract(e.record_json,'$.mutation.cause.request.payload.creationAttemptId')<>?) AND (
      json_extract(e.record_json,'$.mutation.cause.receiptId')=? OR EXISTS(SELECT 1 FROM json_each(e.record_json,'$.mutation.cause.itemTemplateKeys') WHERE value=?) OR EXISTS(SELECT 1 FROM json_each(e.record_json,'$.mutation.cause.request.payload.data.inventoryItems') WHERE json_extract(value,'$.linkedSetInstanceId')=?)
    ) LIMIT 1`,
      )
      .get(scope.campaignId, scope.gmLocalContextId, attemptId, id, id, id);
    if (foreign !== undefined) return s.fail('FOREIGN_OWNER');
    identities.set(id, { kind, attemptId });
  };
  for (const event of events)
    if (event.mutation.kind === 'ENEMY_AUTHORING') {
      const cause = event.mutation.cause,
        attemptId = cause.request.payload.creationAttemptId;
      reserve(cause.receiptId, 'RECEIPT', attemptId);
      cause.itemTemplateKeys.forEach((id) => reserve(id, 'ITEM_TEMPLATE', attemptId));
      if (cause.request.payload.stage === 'SENTIENT_INVENTORY') {
        const inputs = cause.request.payload.data?.['inventoryItems'];
        if (!Array.isArray(inputs)) return s.fail('INVALID_INPUT');
        const groups = new Set(
          inputs
            .map((item) => s.object(item)['linkedSetInstanceId'])
            .filter((id): id is string => typeof id === 'string'),
        );
        groups.forEach((id) => reserve(id, 'LINKED_SET', attemptId));
      }
    }
  for (const version of result)
    for (const [id, kind] of [
      [version.identity.templateId, 'TEMPLATE'],
      [version.identity.versionId, 'VERSION'],
      [version.historyId, 'HISTORY'],
    ] as const)
      reserve(id, kind, version.attempt.attemptId);
  return result;
}
function insert(
  db: Database.Database,
  table: string,
  columns: readonly string[],
  values: readonly unknown[],
  record: unknown,
): void {
  const text = s.canonical(record),
    args = [...values, text, s.sha(text)];
  db.prepare(
    `INSERT INTO ${table} (${[...columns, 'record_json', 'record_sha256'].join(',')}) VALUES (${args.map(() => '?').join(',')})`,
  ).run(...args);
}
export function commitEnemyAuthoring(
  db: Database.Database,
  scope: GmRequestReviewScope,
  request: EnemyWorkflowRequest,
  validateOwner: CampaignPrivateOwnerValidator,
  integration: {
    readonly observe: (source: GmRequestReviewSource) => void;
    readonly prepare: (source: GmRequestReviewSource) => {
      readonly mutation: EnemyAuthoringMutation;
      readonly versionOrNull: EnemyStoredVersion | null;
    };
  },
) {
  if (db.inTransaction) return s.fail('INVALID_INPUT');
  return db
    .transaction(() => {
      if (!schema(db)) return s.fail('UNAVAILABLE');
      const source = readGmRequestReviewSource(db, scope, validateOwner);
      s.guarded(db, integration.observe, source, 'APPLY');
      const state = readGmRequestReviewViewStateInTransaction(db, scope);
      const known = state.events.find((event) => event.eventId === request.commandId);
      if (known !== undefined) {
        if (
          known.mutation.kind !== 'ENEMY_AUTHORING' ||
          !s.same(known.mutation.cause.request, request)
        )
          return s.fail('IDEMPOTENCY_CONFLICT');
        return {
          replayed: true,
          receipt: enemyAuthoringReceipt(known.mutation.cause, {
            stateRevision: known.view.stateRevision,
            projectionRevision: known.view.projectionRevision,
            actorVisibilityRevision: known.view.actorVisibilityRevision,
          }),
        };
      }
      if (request.payload.campaignId !== scope.campaignId) return s.fail('FOREIGN_OWNER');
      s.assertUnused(db, request.commandId);
      if (legacyLocalIdentityInUse(db, request.commandId)) return s.fail('IDEMPOTENCY_CONFLICT');
      if (
        typeof integration.prepare !== 'function' ||
        Object.prototype.toString.call(integration.prepare) === '[object AsyncFunction]'
      )
        return s.fail('INVALID_INPUT');
      let preparedValue: ReturnType<typeof integration.prepare> | undefined;
      s.guarded(
        db,
        (checkedSource) => {
          const result = integration.prepare(checkedSource);
          if (types.isPromise(result)) {
            void Promise.prototype.then.call(
              result,
              () => undefined,
              () => undefined,
            );
            return s.fail('SOURCE_CHANGED');
          }
          const candidate = structuredClone(result);
          if (
            Object.keys(candidate).length !== 2 ||
            !Object.hasOwn(candidate, 'mutation') ||
            !Object.hasOwn(candidate, 'versionOrNull')
          )
            return s.fail('INVALID_INPUT');
          const mutation = enemyAuthoringMutationValue(candidate.mutation),
            version = candidate.versionOrNull;
          if (
            !s.same(mutation.request, request) ||
            (version === null) !== (mutation.committedVersionOrNull === null)
          )
            return s.fail('SOURCE_CHANGED');
          const view = checkedSource.viewOrNull ?? s.fail('UNAVAILABLE');
          if (mutation.authorMasterProfileId !== checkedSource.context.masterProfileId)
            return s.fail('FOREIGN_OWNER');
          reduceEnemyAuthoring(
            view.enemyAuthoring ?? s.fail('UNAVAILABLE'),
            mutation,
            view.formId,
            {
              stateRevision: view.stateRevision,
              projectionRevision: view.projectionRevision,
              actorVisibilityRevision: view.actorVisibilityRevision,
            },
          );
          if (
            version !== null &&
            (!s.same(version.identity, mutation.committedVersionOrNull) ||
              !s.same(version.attempt, view.enemyAuthoring?.attemptOrNull) ||
              version.operationId !== request.commandId ||
              version.timestamp !== mutation.timestamp ||
              version.actorId !== mutation.authorMasterProfileId ||
              version.operation !== 'CREATE_SENTIENT_ENEMY_TEMPLATE')
          )
            return s.fail('SOURCE_CHANGED');
          if (version !== null) {
            s.object(version, [
              'actorId',
              'operation',
              'identity',
              'attempt',
              'sheet',
              'sourceBaselineVersion',
              'operationId',
              'timestamp',
              'historyId',
            ]);
            s.uuid(version.historyId);
            s.uuid(version.actorId);
            if (version.sourceBaselineVersion !== mutation.sourceBaselineVersion)
              return s.fail('SOURCE_CHANGED');
          }
          preparedValue = { mutation, versionOrNull: version };
        },
        source,
        'APPLY',
      );
      const prepared = preparedValue ?? s.fail('INVALID_INPUT'),
        version = prepared.versionOrNull;
      const before = s.changes(db);
      const fresh = [
        prepared.mutation.receiptId,
        ...prepared.mutation.itemTemplateKeys,
        ...(version === null
          ? []
          : [version.identity.templateId, version.identity.versionId, version.historyId]),
      ];
      if (new Set([request.commandId, ...fresh]).size !== fresh.length + 1)
        return s.fail('IDEMPOTENCY_CONFLICT');
      for (const id of fresh) {
        s.assertUnused(db, id);
        if (legacyLocalIdentityInUse(db, id)) return s.fail('IDEMPOTENCY_CONFLICT');
      }
      if (version !== null) {
        const ids = [
          version.identity.templateId,
          version.identity.versionId,
          version.historyId,
          prepared.mutation.receiptId,
        ];
        if (
          new Set(ids).size !== ids.length ||
          ids.some((id) => npcIdentityInUse(db, id) || legacyLocalIdentityInUse(db, id))
        )
          return s.fail('IDEMPOTENCY_CONFLICT');
        insert(
          db,
          'campaign_enemy_template',
          ['template_id', 'campaign_id', 'kind'],
          [version.identity.templateId, scope.campaignId, 'SENTIENT'],
          {
            campaignId: scope.campaignId,
            templateId: version.identity.templateId,
            kind: 'SENTIENT',
          },
        );
        insert(
          db,
          'campaign_enemy_version',
          ['version_id', 'template_id', 'campaign_id', 'version'],
          [version.identity.versionId, version.identity.templateId, scope.campaignId, 1],
          version,
        );
        insert(
          db,
          'campaign_enemy_history',
          ['history_id', 'template_id', 'version_id', 'campaign_id'],
          [
            version.historyId,
            version.identity.templateId,
            version.identity.versionId,
            scope.campaignId,
          ],
          versionAudit(version, {
            stateRevision: request.expectedRevisions.stateRevision + 1,
            projectionRevision: request.expectedRevisions.projectionRevision + 1,
            actorVisibilityRevision: request.expectedRevisions.actorVisibilityRevision,
          }),
        );
        db.prepare('INSERT INTO campaign_enemy_current_version VALUES (?,?)').run(
          version.identity.templateId,
          version.identity.versionId,
        );
      }
      const appended = appendGmRequestReviewEventInTransaction(db, scope, {
        eventId: request.commandId,
        mutation: { kind: 'ENEMY_AUTHORING', cause: prepared.mutation },
      });
      readEnemyVersions(db, scope, readGmRequestReviewViewStateInTransaction(db, scope).events);
      if (
        !db.inTransaction ||
        s.changes(db) !== before + (version === null ? 0 : 4) + appended.rowWrites
      )
        return s.fail('SOURCE_CHANGED');
      s.guarded(
        db,
        integration.observe,
        readGmRequestReviewSource(db, scope, validateOwner),
        'APPLY',
      );
      return {
        replayed: false,
        receipt: enemyAuthoringReceipt(prepared.mutation, {
          stateRevision: appended.view.stateRevision,
          projectionRevision: appended.view.projectionRevision,
          actorVisibilityRevision: appended.view.actorVisibilityRevision,
        }),
      };
    })
    .immediate();
}
