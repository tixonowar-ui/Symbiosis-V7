import type Database from 'better-sqlite3';
import { types } from 'node:util';
import type {
  EnemyAttempt,
  EnemyAuthoringMutation,
  EnemySheet,
  SentientEnemyVersionIdentity,
  EnemyWorkflowRequest,
} from '@shared/enemy-authoring.js';
import type {
  CustomMonsterAttempt,
  CustomMonsterSheet,
  CustomMonsterVersionIdentity,
} from '@shared/custom-monster-state.js';
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
import { readCampaignLifecycleLedger } from './campaign-lifecycle-ledger.js';
import {
  enemyVersionOriginValue,
  enemyVersionAttemptContextValue,
  type EnemyVersionOrigin,
  type EnemyVersionAttemptContext,
} from '@shared/enemy-version-configuration.js';

/** The already-checked QUEUE prefix binds a roll to the settings which actually preceded it. */
export function readEnemyCompositionDiceSource(
  db: Database.Database,
  source: GmRequestReviewSource,
  events: readonly StoredGmRequestQueueEvent[],
): { diceModeSnapshot: 'AUTO' | 'MANUAL'; lifecycleSourceCommandIdOrNull: string | null } {
  if (!db.inTransaction) return s.fail('INVALID_INPUT');
  let mode = source.creationOrigin.payload.defaultFutureRollMode;
  let commandId: string | null = null;
  const lifecycle = readCampaignLifecycleLedger(db, source.scope.campaignId);
  for (const event of events)
    if (event.mutation.kind === 'LIFECYCLE_SOURCE') {
      const cause = event.mutation.cause;
      const record =
        lifecycle.find((row) => row.request.commandId === cause.commandId) ??
        s.fail('SOURCE_CHANGED');
      if (!s.same(record.scope, source.scope) || s.sha(s.canonical(record)) !== cause.recordSha256)
        return s.fail('SOURCE_CHANGED');
      if (record.request.workflowCommandId === 'UI-CMD-CAMPAIGN-SETTINGS-SET') {
        mode = record.request.defaultFutureRollMode;
        commandId = record.request.commandId;
      }
    }
  if (mode !== 'AUTO' && mode !== 'MANUAL') return s.fail('SOURCE_CHANGED');
  return { diceModeSnapshot: mode, lifecycleSourceCommandIdOrNull: commandId };
}

interface EnemyStoredVersionBase {
  readonly actorId: string;
  readonly sourceBaselineVersion: string;
  readonly operationId: string;
  readonly timestamp: string;
  readonly historyId: string;
  readonly versionSource?: Readonly<{
    origin: EnemyVersionOrigin;
    reason: string;
    retainedMandatoryFacts: EnemyVersionAttemptContext['retainedMandatoryFacts'];
    unconfiguredAdvisorCardIdOrNull?: string | null;
    configurationConfirmation?: NonNullable<
      EnemyVersionAttemptContext['configurationConfirmation']
    >;
  }>;
}
export type EnemyStoredVersion = EnemyStoredVersionBase &
  (
    | {
        readonly operation:
          'CREATE_SENTIENT_ENEMY_TEMPLATE' | 'APPEND_SENTIENT_ENEMY_TEMPLATE_VERSION';
        readonly identity: SentientEnemyVersionIdentity;
        readonly attempt: EnemyAttempt;
        readonly sheet: EnemySheet;
      }
    | {
        readonly operation:
          'CREATE_CUSTOM_MONSTER_TEMPLATE' | 'APPEND_CUSTOM_MONSTER_TEMPLATE_VERSION';
        readonly identity: CustomMonsterVersionIdentity;
        readonly attempt: CustomMonsterAttempt;
        readonly sheet: CustomMonsterSheet;
      }
  );
export function enemyStoredVersionOperation(
  identity: EnemyStoredVersion['identity'],
): EnemyStoredVersion['operation'] {
  return identity.kind === 'SENTIENT'
    ? identity.version === 1
      ? 'CREATE_SENTIENT_ENEMY_TEMPLATE'
      : 'APPEND_SENTIENT_ENEMY_TEMPLATE_VERSION'
    : identity.version === 1
      ? 'CREATE_CUSTOM_MONSTER_TEMPLATE'
      : 'APPEND_CUSTOM_MONSTER_TEMPLATE_VERSION';
}
const tables = [
  'campaign_enemy_template',
  'campaign_enemy_version',
  'campaign_enemy_history',
  'campaign_enemy_current_version',
] as const;
function allocatedCompositionIds(mutation: EnemyAuthoringMutation): readonly string[] {
  const monster = mutation.preparedMonsterComposition;
  if (monster !== undefined) {
    const value = monster.composition;
    if (value.phase === 'PREVIEW')
      return value.symbiontInstanceIdOrNull === null ||
        monster.advisorCards.some(
          (card) => card.symbiontInstanceId === value.symbiontInstanceIdOrNull,
        )
        ? []
        : [value.symbiontInstanceIdOrNull];
    if (value.phase === 'ACQUIRED')
      return monster.advisorCards
        .filter((card) => card.iwRolls[0].originatingCommandId === mutation.request.commandId)
        .map((card) => card.cardId);
    return [];
  }
  const value = mutation.preparedComposition;
  if (value === undefined) return [];
  if (value.phase === 'PREVIEW') {
    const kept = value.acquisitions.advisorCards.find(
      (card) => card.cardId === value.advisorCardIdOrNull,
    );
    return value.instanceIds.filter((id) => id !== kept?.symbiontInstanceId);
  }
  if (value.phase === 'ACQUIRED')
    return value.acquisitions.advisorCards
      .filter((card) => card.iwRolls[0].originatingCommandId === mutation.request.commandId)
      .map((card) => card.cardId);
  return [];
}
/** Historical nested allocations keep the same global namespace as the original enemy identities. */
export function validateEnemyCompositionReservations(
  db: Database.Database,
  scope: GmRequestReviewScope,
  events: readonly StoredGmRequestQueueEvent[],
): void {
  const allocated = new Set<string>();
  for (const event of events)
    if (event.mutation.kind === 'ENEMY_AUTHORING')
      for (const id of allocatedCompositionIds(event.mutation.cause)) {
        if (allocated.has(id) || npcIdentityInUse(db, id) || legacyLocalIdentityInUse(db, id))
          return s.fail('IDEMPOTENCY_CONFLICT');
        allocated.add(id);
        s.assertUnusedOutsideNpc(db, id);
        for (const [table, column] of [
          ['campaign_enemy_template', 'template_id'],
          ['campaign_enemy_version', 'version_id'],
          ['campaign_enemy_history', 'history_id'],
        ] as const)
          if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(id) !== undefined)
            return s.fail('IDEMPOTENCY_CONFLICT');
        if (
          db
            .prepare(
              `SELECT 1 FROM gm_request_queue_event e WHERE e.kind='ENEMY_AUTHORING' AND (
      json_extract(e.record_json,'$.mutation.cause.receiptId')=? OR
      EXISTS(SELECT 1 FROM json_each(e.record_json,'$.mutation.cause.itemTemplateKeys') WHERE value=?) OR
      EXISTS(SELECT 1 FROM json_each(e.record_json,'$.mutation.cause.request.payload.data.inventoryItems') WHERE json_extract(value,'$.linkedSetInstanceId')=?) OR
      (json_extract(e.record_json,'$.scope.campaignId')<>? AND (
        EXISTS(SELECT 1 FROM json_each(e.record_json,'$.mutation.cause.preparedComposition.instanceIds') WHERE value=?) OR
        json_extract(e.record_json,'$.mutation.cause.preparedComposition.advisorCardIdOrNull')=? OR
        json_extract(e.record_json,'$.mutation.cause.preparedMonsterComposition.composition.symbiontInstanceIdOrNull')=? OR
        json_extract(e.record_json,'$.mutation.cause.preparedMonsterComposition.composition.advisorCardIdOrNull')=?
      ))
    ) LIMIT 1`,
            )
            .get(id, id, id, scope.campaignId, id, id, id, id) !== undefined
        )
          return s.fail('IDEMPOTENCY_CONFLICT');
      }
}
function versionAudit(
  version: EnemyStoredVersion,
  revisions: { stateRevision: number; projectionRevision: number; actorVisibilityRevision: number },
) {
  const ledger =
    version.attempt.kind === 'SENTIENT' ? version.attempt.compositionAcquisitions : undefined;
  const rolls =
    version.attempt.kind === 'CUSTOM_MONSTER'
      ? version.attempt.advisorCards.flatMap((card) => [...card.iwRolls])
      : ledger === undefined
        ? []
        : [
            ...(ledger.freeSlotOrNull === null ? [] : [ledger.freeSlotOrNull.roll]),
            ...ledger.advisorCards.flatMap((card) => [
              ...card.iwRolls,
              ...(card.suppressionRollOrNull === null ? [] : [card.suppressionRollOrNull]),
            ]),
          ];
  return {
    operationId: version.operationId,
    operation: version.operation,
    actorId: version.actorId,
    campaignId: version.identity.campaignId,
    timestamp: version.timestamp,
    before: version.versionSource?.origin.base ?? null,
    after: { identity: version.identity, sheet: version.sheet },
    revisions,
    provenance: {
      creationAttemptId: version.attempt.attemptId,
      sourceBaselineVersion: version.sourceBaselineVersion,
      ...(version.versionSource === undefined ? {} : { versionSource: version.versionSource }),
    },
    art: { assetKey: version.identity.artAssetKey, sha256: version.identity.artSha256 },
    rngReceiptOrNull:
      rolls.length === 0
        ? null
        : {
            kind:
              version.attempt.kind === 'CUSTOM_MONSTER'
                ? 'CUSTOM_MONSTER_ADVISER_ACQUISITIONS'
                : 'SENTIENT_COMPOSITION_ACQUISITIONS',
            rolls,
          },
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
  if (version !== 21 && version !== 22 && version !== 23) return s.fail('SOURCE_CHANGED');
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
    .prepare(
      'SELECT * FROM campaign_enemy_version WHERE campaign_id=? ORDER BY template_id,version',
    )
    .all(scope.campaignId) as Record<string, unknown>[];
  const history = db
    .prepare('SELECT * FROM campaign_enemy_history WHERE campaign_id=? ORDER BY template_id')
    .all(scope.campaignId) as Record<string, unknown>[];
  const pointers = db
    .prepare(
      'SELECT p.* FROM campaign_enemy_current_version p JOIN campaign_enemy_template t USING(template_id) WHERE t.campaign_id=? ORDER BY template_id',
    )
    .all(scope.campaignId) as Record<string, unknown>[];
  if (
    versions.length !== commits.length ||
    history.length !== versions.length ||
    templates.length !== pointers.length ||
    new Set(versions.map((row) => row['template_id'])).size !== templates.length
  )
    return s.fail('SOURCE_CHANGED');
  const result = versions.map((row) => {
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
      ...(row['version'] === 1 ? [] : ['versionSource']),
    ];
    if (
      Object.keys(saved).length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(saved, key))
    )
      return s.fail('SOURCE_CHANGED');
    const identity = enemyVersionIdentityValue(saved['identity']);
    const stored = saved as unknown as EnemyStoredVersion;
    const template =
        templates.find((value) => value['template_id'] === identity.templateId) ??
        s.fail('SOURCE_CHANGED'),
      h =
        history.find((value) => value['version_id'] === identity.versionId) ??
        s.fail('SOURCE_CHANGED');
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
      row['version'] !== identity.version ||
      template['template_id'] !== identity.templateId ||
      template['kind'] !== identity.kind ||
      !s.same(checked(template), {
        campaignId: scope.campaignId,
        templateId: identity.templateId,
        kind: identity.kind,
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
      stored.operationId !== commit.eventId ||
      stored.timestamp !== commit.mutation.cause.timestamp ||
      stored.actorId !== commit.mutation.cause.authorMasterProfileId ||
      stored.operation !== enemyStoredVersionOperation(identity) ||
      stored.attempt.kind !== identity.kind
    )
      return s.fail('SOURCE_CHANGED');
    return stored;
  });
  for (const template of templates) {
    const chain = result.filter(
      (version) => version.identity.templateId === template['template_id'],
    );
    const pointer = pointers.find((value) => value['template_id'] === template['template_id']);
    if (chain.length === 0 || pointer?.['version_id'] !== chain.at(-1)?.identity.versionId)
      return s.fail('SOURCE_CHANGED');
    let previousCommitIndex = -1;
    for (const [index, version] of chain.entries()) {
      const commitIndex = events.findIndex((event) => event.eventId === version.operationId);
      if (
        version.identity.version !== index + 1 ||
        commitIndex <= previousCommitIndex ||
        version.identity.kind !== template['kind']
      )
        return s.fail('SOURCE_CHANGED');
      if (index === 0) {
        if (version.versionSource !== undefined) return s.fail('SOURCE_CHANGED');
      } else {
        const source = version.versionSource ?? s.fail('SOURCE_CHANGED');
        s.object(source, [
          'origin',
          'reason',
          'retainedMandatoryFacts',
          ...(version.identity.kind === 'CUSTOM_MONSTER'
            ? ['unconfiguredAdvisorCardIdOrNull']
            : []),
          ...(Object.hasOwn(source, 'configurationConfirmation')
            ? ['configurationConfirmation']
            : []),
        ]);
        const origin = enemyVersionOriginValue(source.origin);
        enemyVersionAttemptContextValue({
          schemaVersion: 1,
          ...source,
          replacementPreviewOrNull: null,
        });
        const navIndex = events.findIndex((event) => event.eventId === origin.navigationRequestId);
        const nav = events[navIndex];
        const beforeCommit =
          events[commitIndex - 1]?.view.enemyAuthoring?.versionAttempt ?? s.fail('SOURCE_CHANGED');
        if (
          !s.same(source, {
            origin: beforeCommit.origin,
            reason: beforeCommit.reason,
            retainedMandatoryFacts: beforeCommit.retainedMandatoryFacts,
            ...(version.identity.kind === 'CUSTOM_MONSTER'
              ? { unconfiguredAdvisorCardIdOrNull: beforeCommit.unconfiguredAdvisorCardIdOrNull }
              : {}),
            ...(beforeCommit.configurationConfirmation === undefined
              ? {}
              : { configurationConfirmation: beforeCommit.configurationConfirmation }),
          }) ||
          !s.same(origin.base, chain[index - 1]?.identity) ||
          typeof source.reason !== 'string' ||
          source.reason.trim().length === 0 ||
          navIndex <= previousCommitIndex ||
          navIndex >= commitIndex ||
          nav?.mutation.kind !== 'NAV' ||
          nav.mutation.request.actionKey !== 'ENM-001::CTA::008' ||
          nav.view.formId !== 'ENM-017' ||
          !s.same(nav.view.enemyAuthoring?.versionAttempt?.origin, origin) ||
          nav.view.enemyAuthoring?.attemptOrNull?.attemptId !== version.attempt.attemptId ||
          origin.expectedRevisions.stateRevision !== events[navIndex - 1]?.view.stateRevision ||
          origin.expectedRevisions.projectionRevision !==
            nav.mutation.request.expectedProjectionRevision ||
          origin.expectedRevisions.actorVisibilityRevision !==
            events[navIndex - 1]?.view.actorVisibilityRevision
        )
          return s.fail('SOURCE_CHANGED');
      }
      previousCommitIndex = commitIndex;
    }
  }
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
  const reservedTemplates = new Set<string>();
  for (const version of result) {
    if (!reservedTemplates.has(version.identity.templateId)) {
      reserve(version.identity.templateId, 'TEMPLATE', version.attempt.attemptId);
      reservedTemplates.add(version.identity.templateId);
    }
    for (const [id, kind] of [
      [version.identity.versionId, 'VERSION'],
      [version.historyId, 'HISTORY'],
    ] as const)
      reserve(id, kind, version.attempt.attemptId);
  }
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
      const liveVersion = source.viewOrNull?.enemyAuthoring?.versionAttempt;
      if (liveVersion !== undefined) {
        // Fresh edits must refuse before preparation can acquire facts. Historical replay above
        // keeps its original receipt; earlier event derivation never consults this live maximum.
        const latest = readEnemyVersions(db, scope, state.events)
          .filter((row) => row.identity.templateId === liveVersion.origin.base.templateId)
          .sort((a, b) => b.identity.version - a.identity.version)[0];
        if (latest === undefined || !s.same(latest.identity, liveVersion.origin.base))
          return s.fail('STALE_REVISION');
      }
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
              version.operation !== enemyStoredVersionOperation(version.identity) ||
              version.attempt.kind !== version.identity.kind)
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
              ...(version.identity.version === 1 ? [] : ['versionSource']),
            ]);
            s.uuid(version.historyId);
            s.uuid(version.actorId);
            if (version.sourceBaselineVersion !== mutation.sourceBaselineVersion)
              return s.fail('SOURCE_CHANGED');
            if (version.identity.version !== 1) {
              const metadata = view.enemyAuthoring?.versionAttempt ?? s.fail('SOURCE_CHANGED');
              if (
                !s.same(version.versionSource, {
                  origin: metadata.origin,
                  reason: metadata.reason,
                  retainedMandatoryFacts: metadata.retainedMandatoryFacts,
                  ...(version.identity.kind === 'CUSTOM_MONSTER'
                    ? { unconfiguredAdvisorCardIdOrNull: metadata.unconfiguredAdvisorCardIdOrNull }
                    : {}),
                  ...(metadata.configurationConfirmation === undefined
                    ? {}
                    : { configurationConfirmation: metadata.configurationConfirmation }),
                })
              )
                return s.fail('SOURCE_CHANGED');
            }
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
        ...allocatedCompositionIds(prepared.mutation),
        ...(version === null
          ? []
          : [
              ...(version.identity.version === 1 ? [version.identity.templateId] : []),
              version.identity.versionId,
              version.historyId,
            ]),
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
        if (version.identity.version === 1)
          insert(
            db,
            'campaign_enemy_template',
            ['template_id', 'campaign_id', 'kind'],
            [version.identity.templateId, scope.campaignId, version.identity.kind],
            {
              campaignId: scope.campaignId,
              templateId: version.identity.templateId,
              kind: version.identity.kind,
            },
          );
        insert(
          db,
          'campaign_enemy_version',
          ['version_id', 'template_id', 'campaign_id', 'version'],
          [
            version.identity.versionId,
            version.identity.templateId,
            scope.campaignId,
            version.identity.version,
          ],
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
        if (version.identity.version === 1)
          db.prepare('INSERT INTO campaign_enemy_current_version VALUES (?,?)').run(
            version.identity.templateId,
            version.identity.versionId,
          );
        else {
          const source = version.versionSource ?? s.fail('SOURCE_CHANGED');
          const result = db
            .prepare(
              'UPDATE campaign_enemy_current_version SET version_id=? WHERE template_id=? AND version_id=?',
            )
            .run(
              version.identity.versionId,
              version.identity.templateId,
              source.origin.base.versionId,
            );
          if (result.changes !== 1) return s.fail('STALE_REVISION');
        }
      }
      const appended = appendGmRequestReviewEventInTransaction(db, scope, {
        eventId: request.commandId,
        mutation: { kind: 'ENEMY_AUTHORING', cause: prepared.mutation },
      });
      readEnemyVersions(db, scope, readGmRequestReviewViewStateInTransaction(db, scope).events);
      if (
        !db.inTransaction ||
        s.changes(db) !==
          before +
            (version === null ? 0 : version.identity.version === 1 ? 4 : 3) +
            appended.rowWrites
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
