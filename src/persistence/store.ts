import { createHash } from 'node:crypto';

import type Database from 'better-sqlite3';

import { MAX_SAFE_REVISION, V1_LIFECYCLE_STATES } from './migrations/0001-initial.js';

export interface RevisionTriple {
  stateRevision: number;
  projectionRevision: number;
  actorVisibilityRevision: number;
}

export interface RevisionImpact {
  stateChanged: boolean;
  projectionChanged: boolean;
  actorVisibilityChanged: boolean;
}

export type LocalCharacterLifecycleState = (typeof V1_LIFECYCLE_STATES.localCharacter)[number];

export interface LocalCharacter extends RevisionTriple {
  localCharacterId: string;
  lifecycleState: LocalCharacterLifecycleState;
  payloadJson: string;
}

export type LocalCharacterPatch =
  | { lifecycleState: LocalCharacterLifecycleState; payloadJson?: string }
  | { lifecycleState?: LocalCharacterLifecycleState; payloadJson: string };

export interface LocalCharacterCheckpoint extends RevisionTriple {
  checkpointId: string;
  localCharacterId: string;
  checkpointRevision: number;
  snapshotJson: string;
  snapshotSha256: string;
}

export type LocalCharacterCheckpointWriter = (
  patch: LocalCharacterPatch,
  impact: RevisionImpact,
) => LocalCharacter;

export type LocalCharacterCheckpointCreator = (
  lifecycleState: LocalCharacterLifecycleState,
  payloadJson: string,
) => LocalCharacter;

export type RevisionScope =
  { entity: 'localCharacter'; entityId: string } | { entity: 'campaign'; entityId: string };

export interface CampaignCheckpoint extends RevisionTriple {
  campaignId: string;
  snapshotJson: string;
}

type RevisionRow = RevisionTriple;

interface LocalCharacterRow extends RevisionRow {
  local_character_id: string;
  lifecycle_state: string;
  payload_json: string;
}

interface DraftCheckpointRow extends RevisionRow {
  checkpoint_id: string;
  local_character_id: string;
  checkpoint_revision: number;
  snapshot_json: string;
  snapshot_sha256: string;
}

type DraftCheckpointState = LocalCharacter & { snapshotJson: string };

interface CheckpointRow extends RevisionTriple {
  campaign_id: string;
  snapshot_json: string;
}

interface CampaignRow {
  campaign_id: string;
  lifecycle_state: string;
  payload_json: string;
}

interface CampaignCharacterCopyRow {
  campaign_character_id: string;
  source_uuid: string;
  lifecycle_state: string;
  payload_json: string;
}

const REVISION_SCOPES = {
  localCharacter: { table: 'local_character', idColumn: 'local_character_id' },
  campaign: { table: 'campaign', idColumn: 'campaign_id' },
} as const;

const REVISION_NAMES = ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const;
const IMPACT_NAMES = ['stateChanged', 'projectionChanged', 'actorVisibilityChanged'] as const;
const LOCAL_CHARACTER_PATCH_FIELDS = ['lifecycleState', 'payloadJson'] as const;

const localCharacterLabel = (localCharacterId: string): string =>
  `localCharacter ${JSON.stringify(localCharacterId)}`;

const requireTopLevelLocalCharacterWrite = (
  database: Database.Database,
  operation: 'create' | 'update',
): void => {
  if (database.inTransaction) {
    throw new Error(`localCharacter ${operation} requires a top-level transaction`);
  }
};

const localCharacterLifecycleState = (
  value: string,
  label: string,
): LocalCharacterLifecycleState => {
  const state = V1_LIFECYCLE_STATES.localCharacter.find((candidate) => candidate === value);
  if (state === undefined) {
    throw new Error(
      `${label} has unrecognized lifecycle state ${JSON.stringify(value)}; allowed: ${V1_LIFECYCLE_STATES.localCharacter.join(', ')}`,
    );
  }
  return state;
};

const localCharacterPayloadJson = (value: string, label: string): string => {
  let payload: unknown;
  try {
    payload = JSON.parse(value) as unknown;
  } catch (cause) {
    throw new Error(`${label} payloadJson is not valid JSON`, { cause });
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    const kind = payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload;
    throw new Error(`${label} payloadJson must encode a JSON object, got ${kind}`);
  }
  return value;
};

const revisionTriple = (row: RevisionRow, label: string): RevisionTriple => {
  const values = REVISION_NAMES.map((name) => row[name]);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error(
      `${label} contains an invalid ${REVISION_NAMES.join('/')} tuple: ${values.join(', ')}`,
    );
  }
  return {
    stateRevision: row.stateRevision,
    projectionRevision: row.projectionRevision,
    actorVisibilityRevision: row.actorVisibilityRevision,
  };
};

const localCharacterFromRow = (row: LocalCharacterRow): LocalCharacter => {
  const label = localCharacterLabel(row.local_character_id);
  return {
    localCharacterId: row.local_character_id,
    lifecycleState: localCharacterLifecycleState(row.lifecycle_state, label),
    payloadJson: localCharacterPayloadJson(row.payload_json, label),
    ...revisionTriple(row, label),
  };
};

const writeLocalCharacterCreate = (
  database: Database.Database,
  localCharacterId: string,
  lifecycleState: LocalCharacterLifecycleState,
  payloadJson: string,
): LocalCharacter => {
  const label = localCharacterLabel(localCharacterId);
  const row = database
    .prepare<
      { localCharacterId: string; lifecycleState: string; payloadJson: string },
      LocalCharacterRow
    >(
      `INSERT INTO local_character (local_character_id, lifecycle_state, payload_json)
       VALUES (@localCharacterId, @lifecycleState, @payloadJson)
       ON CONFLICT (local_character_id) DO NOTHING
       RETURNING local_character_id, lifecycle_state, payload_json,
                 stateRevision, projectionRevision, actorVisibilityRevision`,
    )
    .get({
      localCharacterId,
      lifecycleState: localCharacterLifecycleState(lifecycleState, label),
      payloadJson: localCharacterPayloadJson(payloadJson, label),
    });
  if (row === undefined) {
    throw new Error(`${label} already exists`);
  }
  return localCharacterFromRow(row);
};

export const createLocalCharacter = (
  database: Database.Database,
  localCharacterId: string,
  lifecycleState: LocalCharacterLifecycleState,
  payloadJson: string,
): LocalCharacter => {
  requireTopLevelLocalCharacterWrite(database, 'create');
  return writeLocalCharacterCreate(database, localCharacterId, lifecycleState, payloadJson);
};

export const readLocalCharacter = (
  database: Database.Database,
  localCharacterId: string,
): LocalCharacter => {
  const row = database
    .prepare<[string], LocalCharacterRow>(
      `SELECT local_character_id, lifecycle_state, payload_json,
              stateRevision, projectionRevision, actorVisibilityRevision
       FROM local_character
       WHERE local_character_id = ?`,
    )
    .get(localCharacterId);
  if (row === undefined) {
    throw new Error(`${localCharacterLabel(localCharacterId)} not found`);
  }
  return localCharacterFromRow(row);
};

export const listLocalCharacters = (database: Database.Database): readonly LocalCharacter[] =>
  database
    .prepare<[], LocalCharacterRow>(
      `SELECT local_character_id, lifecycle_state, payload_json,
              stateRevision, projectionRevision, actorVisibilityRevision
       FROM local_character
       ORDER BY local_character_id`,
    )
    .all()
    .map(localCharacterFromRow);

export const readRevisions = (
  database: Database.Database,
  scope: RevisionScope,
): RevisionTriple => {
  const { table, idColumn } = REVISION_SCOPES[scope.entity];
  const row = database
    .prepare<[string], RevisionRow>(
      `SELECT stateRevision, projectionRevision, actorVisibilityRevision
       FROM ${table}
       WHERE ${idColumn} = ?`,
    )
    .get(scope.entityId);
  if (row === undefined) {
    throw new Error(
      `${scope.entity} ${JSON.stringify(scope.entityId)} not found while reading revisions`,
    );
  }
  return revisionTriple(row, `${scope.entity} ${JSON.stringify(scope.entityId)}`);
};

export const advanceRevisions = (
  database: Database.Database,
  scope: RevisionScope,
  impact: RevisionImpact,
): RevisionTriple => {
  const keys = Object.keys(impact);
  if (
    keys.length !== IMPACT_NAMES.length ||
    IMPACT_NAMES.some((name) => !Object.hasOwn(impact, name) || typeof impact[name] !== 'boolean')
  ) {
    throw new TypeError(`revision impact must contain exactly: ${IMPACT_NAMES.join(', ')}`);
  }
  if (impact.actorVisibilityChanged && !impact.projectionChanged) {
    throw new Error('actorVisibilityRevision cannot advance without projectionRevision');
  }
  if (!impact.stateChanged && !impact.projectionChanged) {
    return readRevisions(database, scope);
  }

  const { table, idColumn } = REVISION_SCOPES[scope.entity];
  const row = database
    .prepare<
      {
        entityId: string;
        stateDelta: number;
        projectionDelta: number;
        actorVisibilityDelta: number;
      },
      RevisionRow
    >(
      `UPDATE ${table}
       SET stateRevision = stateRevision + @stateDelta,
           projectionRevision = projectionRevision + @projectionDelta,
           actorVisibilityRevision = actorVisibilityRevision + @actorVisibilityDelta
       WHERE ${idColumn} = @entityId
       RETURNING stateRevision, projectionRevision, actorVisibilityRevision`,
    )
    .get({
      entityId: scope.entityId,
      stateDelta: impact.stateChanged ? 1 : 0,
      projectionDelta: impact.projectionChanged ? 1 : 0,
      actorVisibilityDelta: impact.actorVisibilityChanged ? 1 : 0,
    });
  if (row === undefined) {
    throw new Error(
      `${scope.entity} ${JSON.stringify(scope.entityId)} not found while advancing revisions`,
    );
  }
  return revisionTriple(row, `${scope.entity} ${JSON.stringify(scope.entityId)}`);
};

const writeLocalCharacterUpdate = (
  database: Database.Database,
  localCharacterId: string,
  patch: LocalCharacterPatch,
  impact: RevisionImpact,
): LocalCharacter => {
  const fields = Object.keys(patch);
  const unknownFields = fields.filter(
    (field) => !LOCAL_CHARACTER_PATCH_FIELDS.some((candidate) => candidate === field),
  );
  if (unknownFields.length > 0) {
    throw new TypeError(
      `localCharacter update contains unrecognized fields: ${unknownFields.join(', ')}`,
    );
  }
  const hasLifecycleState = Object.hasOwn(patch, 'lifecycleState');
  const hasPayloadJson = Object.hasOwn(patch, 'payloadJson');
  if (!hasLifecycleState && !hasPayloadJson) {
    throw new TypeError(
      `localCharacter update must contain ${LOCAL_CHARACTER_PATCH_FIELDS.join(' and/or ')}`,
    );
  }

  const label = localCharacterLabel(localCharacterId);
  const checkedLifecycleState = hasLifecycleState
    ? localCharacterLifecycleState(patch.lifecycleState as string, label)
    : undefined;
  const checkedPayloadJson = hasPayloadJson
    ? localCharacterPayloadJson(patch.payloadJson as string, label)
    : undefined;

  return database
    .transaction(() => {
      const current = readLocalCharacter(database, localCharacterId);
      database
        .prepare<{
          localCharacterId: string;
          lifecycleState: string;
          payloadJson: string;
        }>(
          `UPDATE local_character
           SET lifecycle_state = @lifecycleState,
               payload_json = @payloadJson
           WHERE local_character_id = @localCharacterId`,
        )
        .run({
          localCharacterId,
          lifecycleState: checkedLifecycleState ?? current.lifecycleState,
          payloadJson: checkedPayloadJson ?? current.payloadJson,
        });
      advanceRevisions(database, { entity: 'localCharacter', entityId: localCharacterId }, impact);
      return readLocalCharacter(database, localCharacterId);
    })
    .immediate();
};

export const updateLocalCharacter = (
  database: Database.Database,
  localCharacterId: string,
  patch: LocalCharacterPatch,
  impact: RevisionImpact,
): LocalCharacter => {
  requireTopLevelLocalCharacterWrite(database, 'update');
  return writeLocalCharacterUpdate(database, localCharacterId, patch, impact);
};

const draftCheckpointState = (localCharacter: LocalCharacter): DraftCheckpointState => {
  const { localCharacterId, lifecycleState, payloadJson } = localCharacter;
  return {
    ...localCharacter,
    snapshotJson: JSON.stringify({
      localCharacter: { localCharacterId, lifecycleState, payloadJson },
    }),
  };
};

const buildDraftSnapshot = (
  database: Database.Database,
  localCharacterId: string,
): DraftCheckpointState => draftCheckpointState(readLocalCharacter(database, localCharacterId));

const snapshotSha256 = (snapshotJson: string): string =>
  createHash('sha256').update(snapshotJson, 'utf8').digest('hex');

const draftCheckpointFromRow = (row: DraftCheckpointRow): LocalCharacterCheckpoint => {
  const label = `localCharacter checkpoint ${JSON.stringify(row.checkpoint_id)}`;
  return {
    checkpointId: row.checkpoint_id,
    localCharacterId: row.local_character_id,
    checkpointRevision: row.checkpoint_revision,
    snapshotJson: row.snapshot_json,
    snapshotSha256: row.snapshot_sha256,
    ...revisionTriple(row, label),
  };
};

const DRAFT_CHECKPOINT_COLUMNS = `checkpoint_id, local_character_id,
  checkpoint_revision, snapshot_json, snapshot_sha256,
  stateRevision, projectionRevision, actorVisibilityRevision`;

const readDraftCheckpointRow = (
  database: Database.Database,
  localCharacterId: string,
): DraftCheckpointRow | undefined =>
  database
    .prepare<[string], DraftCheckpointRow>(
      `SELECT ${DRAFT_CHECKPOINT_COLUMNS}
       FROM local_character_checkpoint
       WHERE local_character_id = ?`,
    )
    .get(localCharacterId);

const validateStoredDraftCheckpoint = (
  row: DraftCheckpointRow,
  current: DraftCheckpointState,
): LocalCharacterCheckpoint => {
  const checkpoint = draftCheckpointFromRow(row);
  const label = `localCharacter checkpoint ${JSON.stringify(checkpoint.checkpointId)}`;
  if (snapshotSha256(checkpoint.snapshotJson) !== checkpoint.snapshotSha256) {
    throw new Error(`${label} checksum does not match its snapshot`);
  }
  if (checkpoint.snapshotJson !== current.snapshotJson) {
    throw new Error(`${label} snapshot does not match current state`);
  }
  if (REVISION_NAMES.some((name) => checkpoint[name] !== current[name])) {
    throw new Error(`${label} revisions do not match current state`);
  }
  return checkpoint;
};

const resolveDraftCheckpointRow = (
  database: Database.Database,
  localCharacterId: string,
  checkpointId: string,
): DraftCheckpointRow | undefined => {
  const row = database
    .prepare<{ localCharacterId: string; checkpointId: string }, DraftCheckpointRow>(
      `SELECT ${DRAFT_CHECKPOINT_COLUMNS}
       FROM local_character_checkpoint
       WHERE local_character_id = @localCharacterId OR checkpoint_id = @checkpointId
       ORDER BY local_character_id = @localCharacterId DESC`,
    )
    .get({ localCharacterId, checkpointId });
  if (row !== undefined && row.local_character_id !== localCharacterId) {
    throw new Error(
      `localCharacter checkpoint ${JSON.stringify(checkpointId)} belongs to ${JSON.stringify(row.local_character_id)}, not ${JSON.stringify(localCharacterId)}`,
    );
  }
  if (row !== undefined && row.checkpoint_id !== checkpointId) {
    throw new Error(
      `${localCharacterLabel(localCharacterId)} checkpoint is fixed as ${JSON.stringify(row.checkpoint_id)}, not ${JSON.stringify(checkpointId)}`,
    );
  }
  return row;
};

const validateDraftCheckpointAdvance = (
  previous: DraftCheckpointState,
  current: DraftCheckpointState,
): void => {
  const stateDelta = current.stateRevision - previous.stateRevision;
  const projectionDelta = current.projectionRevision - previous.projectionRevision;
  const visibilityDelta = current.actorVisibilityRevision - previous.actorVisibilityRevision;
  const deltas = [stateDelta, projectionDelta, visibilityDelta];
  if (deltas.some((delta) => delta < 0 || delta > 1)) {
    throw new Error(
      `${localCharacterLabel(current.localCharacterId)} revisions must advance by at most one per checkpoint: ${deltas.join(', ')}`,
    );
  }
  if (visibilityDelta === 1 && projectionDelta !== 1) {
    throw new Error(
      `${localCharacterLabel(current.localCharacterId)} visibility revision advanced without projection revision`,
    );
  }
  const snapshotChanged = current.snapshotJson !== previous.snapshotJson;
  if ((stateDelta === 1) !== snapshotChanged) {
    throw new Error(
      `${localCharacterLabel(current.localCharacterId)} stateRevision and snapshot change disagree`,
    );
  }
};

const validateDraftCheckpointCreation = (
  created: DraftCheckpointState,
  current: DraftCheckpointState,
): void => {
  const revisions = REVISION_NAMES.map((name) => current[name]);
  if (revisions.some((revision) => revision !== 0)) {
    throw new Error(
      `${localCharacterLabel(current.localCharacterId)} initial revisions must be 0, 0, 0; got ${revisions.join(', ')}`,
    );
  }
  if (
    current.snapshotJson !== created.snapshotJson ||
    REVISION_NAMES.some((name) => current[name] !== created[name])
  ) {
    throw new Error(
      `${localCharacterLabel(current.localCharacterId)} changed after creation before checkpoint`,
    );
  }
};

const buildCampaignSnapshot = (database: Database.Database, campaignId: string): string => {
  const campaign = database
    .prepare<[string], CampaignRow>(
      `SELECT campaign_id, lifecycle_state, payload_json
       FROM campaign
       WHERE campaign_id = ?`,
    )
    .get(campaignId);
  if (campaign === undefined) {
    throw new Error(`campaign ${JSON.stringify(campaignId)} not found for checkpoint`);
  }
  const copies = database
    .prepare<[string], CampaignCharacterCopyRow>(
      `SELECT campaign_character_id, source_uuid, lifecycle_state, payload_json
       FROM campaign_character_copy
       WHERE campaign_id = ?
       ORDER BY campaign_character_id`,
    )
    .all(campaignId);

  return JSON.stringify({
    campaign: {
      campaignId: campaign.campaign_id,
      lifecycleState: campaign.lifecycle_state,
      payloadJson: campaign.payload_json,
    },
    campaignCharacterCopies: copies.map((copy) => ({
      campaignCharacterId: copy.campaign_character_id,
      sourceUuid: copy.source_uuid,
      lifecycleState: copy.lifecycle_state,
      payloadJson: copy.payload_json,
    })),
  });
};

const checkpointFromRow = (row: CheckpointRow): CampaignCheckpoint => ({
  campaignId: row.campaign_id,
  snapshotJson: row.snapshot_json,
  ...revisionTriple(row, `campaign checkpoint ${JSON.stringify(row.campaign_id)}`),
});

const readCheckpointRow = (
  database: Database.Database,
  campaignId: string,
): CheckpointRow | undefined =>
  database
    .prepare<[string], CheckpointRow>(
      `SELECT campaign_id, snapshot_json, stateRevision,
              projectionRevision, actorVisibilityRevision
       FROM campaign_checkpoint
       WHERE campaign_id = ?`,
    )
    .get(campaignId);

const currentCampaignCheckpoint = (
  database: Database.Database,
  campaignId: string,
): CampaignCheckpoint => ({
  campaignId,
  snapshotJson: buildCampaignSnapshot(database, campaignId),
  ...readRevisions(database, { entity: 'campaign', entityId: campaignId }),
});

const checkpointsMatch = (left: CampaignCheckpoint, right: CampaignCheckpoint): boolean =>
  left.snapshotJson === right.snapshotJson &&
  REVISION_NAMES.every((name) => left[name] === right[name]);

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  value !== null &&
  (typeof value === 'object' || typeof value === 'function') &&
  'then' in value &&
  typeof value.then === 'function';

export const commitNewLocalCharacterCheckpoint = <T>(
  database: Database.Database,
  localCharacterId: string,
  checkpointId: string,
  write: (
    create: LocalCharacterCheckpointCreator,
  ) => T & (T extends PromiseLike<unknown> ? never : unknown),
): { result: T; checkpoint: LocalCharacterCheckpoint } => {
  if (database.inTransaction) {
    throw new Error('localCharacter checkpoint requires a top-level transaction');
  }
  if (checkpointId === localCharacterId) {
    throw new Error('localCharacter checkpointId must differ from localCharacterId');
  }
  if (Object.prototype.toString.call(write) === '[object AsyncFunction]') {
    throw new TypeError('localCharacter checkpoint callback must be synchronous');
  }
  return database
    .transaction(() => {
      const previousRow = resolveDraftCheckpointRow(database, localCharacterId, checkpointId);
      if (previousRow !== undefined) {
        throw new Error(
          `${localCharacterLabel(localCharacterId)} already has checkpoint ${JSON.stringify(previousRow.checkpoint_id)}; cannot create first checkpoint`,
        );
      }
      const existing = database
        .prepare<[string], { local_character_id: string }>(
          `SELECT local_character_id FROM local_character WHERE local_character_id = ?`,
        )
        .get(localCharacterId);
      if (existing !== undefined) {
        throw new Error(
          `${localCharacterLabel(localCharacterId)} already exists; cannot create first checkpoint`,
        );
      }

      let creatorActive = true;
      let creatorFailure: { cause: unknown } | undefined;
      let created: DraftCheckpointState | undefined;
      const failCreator = (cause: unknown): never => {
        creatorFailure ??= { cause };
        throw cause;
      };
      try {
        const result = write((lifecycleState, payloadJson) => {
          if (!creatorActive) {
            return failCreator(new Error('localCharacter checkpoint creator is no longer active'));
          }
          creatorActive = false;
          try {
            const localCharacter = writeLocalCharacterCreate(
              database,
              localCharacterId,
              lifecycleState,
              payloadJson,
            );
            created = draftCheckpointState(localCharacter);
            return localCharacter;
          } catch (cause) {
            return failCreator(cause);
          }
        });
        if (creatorFailure !== undefined) {
          throw creatorFailure.cause;
        }
        if (isPromiseLike(result)) {
          throw new TypeError('localCharacter checkpoint callback must be synchronous');
        }
        if (created === undefined) {
          throw new Error(
            `${localCharacterLabel(localCharacterId)} was not created by checkpoint callback`,
          );
        }

        const current = buildDraftSnapshot(database, localCharacterId);
        validateDraftCheckpointCreation(created, current);
        const checkpoint: LocalCharacterCheckpoint = {
          checkpointId,
          localCharacterId,
          checkpointRevision: 0,
          snapshotJson: current.snapshotJson,
          snapshotSha256: snapshotSha256(current.snapshotJson),
          stateRevision: current.stateRevision,
          projectionRevision: current.projectionRevision,
          actorVisibilityRevision: current.actorVisibilityRevision,
        };
        const inserted = database
          .prepare<LocalCharacterCheckpoint, DraftCheckpointRow>(
            `INSERT INTO local_character_checkpoint
             (${DRAFT_CHECKPOINT_COLUMNS}) VALUES
             (@checkpointId, @localCharacterId, @checkpointRevision, @snapshotJson, @snapshotSha256,
              @stateRevision, @projectionRevision, @actorVisibilityRevision)
             RETURNING ${DRAFT_CHECKPOINT_COLUMNS}`,
          )
          .get(checkpoint);
        if (inserted === undefined) {
          throw new Error(
            `localCharacter checkpoint ${JSON.stringify(checkpointId)} was not inserted`,
          );
        }
        const stored = resolveDraftCheckpointRow(database, localCharacterId, checkpointId);
        if (stored === undefined) {
          throw new Error(
            `localCharacter checkpoint ${JSON.stringify(checkpointId)} was not stored`,
          );
        }
        if (stored.checkpoint_revision !== checkpoint.checkpointRevision) {
          throw new Error(
            `localCharacter checkpoint ${JSON.stringify(checkpointId)} first revision must be 0; got ${stored.checkpoint_revision}`,
          );
        }
        const storedCurrent = buildDraftSnapshot(database, localCharacterId);
        validateDraftCheckpointCreation(created, storedCurrent);
        return {
          result,
          checkpoint: validateStoredDraftCheckpoint(stored, storedCurrent),
        };
      } finally {
        creatorActive = false;
      }
    })
    .immediate();
};

export const commitLocalCharacterCheckpoint = <T>(
  database: Database.Database,
  localCharacterId: string,
  checkpointId: string,
  write: (
    update: LocalCharacterCheckpointWriter,
  ) => T & (T extends PromiseLike<unknown> ? never : unknown),
): { result: T; checkpoint: LocalCharacterCheckpoint } => {
  if (database.inTransaction) {
    throw new Error('localCharacter checkpoint requires a top-level transaction');
  }
  if (checkpointId === localCharacterId) {
    throw new Error('localCharacter checkpointId must differ from localCharacterId');
  }
  if (Object.prototype.toString.call(write) === '[object AsyncFunction]') {
    throw new TypeError('localCharacter checkpoint callback must be synchronous');
  }
  return database
    .transaction(() => {
      const previousRow = resolveDraftCheckpointRow(database, localCharacterId, checkpointId);
      const before = buildDraftSnapshot(database, localCharacterId);
      const previous =
        previousRow === undefined ? undefined : validateStoredDraftCheckpoint(previousRow, before);

      let writerActive = true;
      try {
        const result = write((patch, impact) => {
          if (!writerActive) {
            throw new Error('localCharacter checkpoint writer is no longer active');
          }
          writerActive = false;
          return writeLocalCharacterUpdate(database, localCharacterId, patch, impact);
        });
        if (isPromiseLike(result)) {
          throw new TypeError('localCharacter checkpoint callback must be synchronous');
        }

        const current = buildDraftSnapshot(database, localCharacterId);
        validateDraftCheckpointAdvance(before, current);
        const snapshotChanged =
          previous !== undefined && previous.snapshotJson !== current.snapshotJson;
        if (snapshotChanged && previous?.checkpointRevision === MAX_SAFE_REVISION) {
          throw new Error(
            `localCharacter checkpoint ${JSON.stringify(checkpointId)} revision overflow`,
          );
        }
        const checkpoint: LocalCharacterCheckpoint = {
          checkpointId,
          localCharacterId,
          checkpointRevision:
            previous === undefined ? 0 : previous.checkpointRevision + Number(snapshotChanged),
          snapshotJson: current.snapshotJson,
          snapshotSha256: snapshotSha256(current.snapshotJson),
          stateRevision: current.stateRevision,
          projectionRevision: current.projectionRevision,
          actorVisibilityRevision: current.actorVisibilityRevision,
        };
        database
          .prepare<LocalCharacterCheckpoint>(
            `INSERT INTO local_character_checkpoint
            (${DRAFT_CHECKPOINT_COLUMNS}) VALUES
            (@checkpointId, @localCharacterId, @checkpointRevision, @snapshotJson, @snapshotSha256,
             @stateRevision, @projectionRevision, @actorVisibilityRevision)
            ON CONFLICT (checkpoint_id) DO UPDATE SET
              checkpoint_revision=excluded.checkpoint_revision, snapshot_json=excluded.snapshot_json,
              snapshot_sha256=excluded.snapshot_sha256, stateRevision=excluded.stateRevision,
              projectionRevision=excluded.projectionRevision, actorVisibilityRevision=excluded.actorVisibilityRevision`,
          )
          .run(checkpoint);
        return { result, checkpoint };
      } finally {
        writerActive = false;
      }
    })
    .immediate();
};

export const loadLocalCharacterCheckpoint = (
  database: Database.Database,
  localCharacterId: string,
): LocalCharacterCheckpoint => {
  const row = readDraftCheckpointRow(database, localCharacterId);
  if (row === undefined) {
    throw new Error(`${localCharacterLabel(localCharacterId)} has no checkpoint`);
  }
  return validateStoredDraftCheckpoint(row, buildDraftSnapshot(database, localCharacterId));
};

const validateCheckpointAdvance = (
  previous: CampaignCheckpoint,
  current: CampaignCheckpoint,
): void => {
  const stateDelta = current.stateRevision - previous.stateRevision;
  const projectionDelta = current.projectionRevision - previous.projectionRevision;
  const visibilityDelta = current.actorVisibilityRevision - previous.actorVisibilityRevision;
  const deltas = [stateDelta, projectionDelta, visibilityDelta];
  if (deltas.some((delta) => delta < 0 || delta > 1)) {
    throw new Error(
      `campaign ${JSON.stringify(current.campaignId)} revisions must advance by at most one per checkpoint: ${deltas.join(', ')}`,
    );
  }
  if (visibilityDelta === 1 && projectionDelta !== 1) {
    throw new Error(
      `campaign ${JSON.stringify(current.campaignId)} visibility revision advanced without projection revision`,
    );
  }
  const snapshotChanged = current.snapshotJson !== previous.snapshotJson;
  if ((stateDelta === 1) !== snapshotChanged) {
    throw new Error(
      `campaign ${JSON.stringify(current.campaignId)} stateRevision and snapshot change disagree`,
    );
  }
};

export const commitCampaignCheckpoint = <T>(
  database: Database.Database,
  campaignId: string,
  write: () => T & (T extends PromiseLike<unknown> ? never : unknown),
): { result: T; checkpoint: CampaignCheckpoint } => {
  if (database.inTransaction) {
    throw new Error('campaign checkpoint requires a top-level transaction');
  }
  if (Object.prototype.toString.call(write) === '[object AsyncFunction]') {
    throw new TypeError('campaign checkpoint callback must be synchronous');
  }
  return database
    .transaction(() => {
      const previousRow = readCheckpointRow(database, campaignId);
      const before = currentCampaignCheckpoint(database, campaignId);
      if (previousRow !== undefined && !checkpointsMatch(checkpointFromRow(previousRow), before)) {
        throw new Error(`campaign ${JSON.stringify(campaignId)} checkpoint is already stale`);
      }
      const result = write();
      if (isPromiseLike(result)) {
        throw new TypeError('campaign checkpoint callback must be synchronous');
      }
      const checkpoint = currentCampaignCheckpoint(database, campaignId);
      validateCheckpointAdvance(before, checkpoint);

      database
        .prepare<{
          campaignId: string;
          snapshotJson: string;
          stateRevision: number;
          projectionRevision: number;
          actorVisibilityRevision: number;
        }>(
          `INSERT INTO campaign_checkpoint (
             campaign_id, snapshot_json, stateRevision,
             projectionRevision, actorVisibilityRevision
           ) VALUES (
             @campaignId, @snapshotJson, @stateRevision,
             @projectionRevision, @actorVisibilityRevision
           )
           ON CONFLICT (campaign_id) DO UPDATE SET
             snapshot_json = excluded.snapshot_json,
             stateRevision = excluded.stateRevision,
             projectionRevision = excluded.projectionRevision,
             actorVisibilityRevision = excluded.actorVisibilityRevision`,
        )
        .run(checkpoint);
      return { result, checkpoint };
    })
    .immediate();
};

export const loadCampaignCheckpoint = (
  database: Database.Database,
  campaignId: string,
): CampaignCheckpoint => {
  const row = readCheckpointRow(database, campaignId);
  if (row === undefined) {
    throw new Error(`campaign ${JSON.stringify(campaignId)} has no checkpoint`);
  }
  const checkpoint = checkpointFromRow(row);
  if (!checkpointsMatch(checkpoint, currentCampaignCheckpoint(database, campaignId))) {
    throw new Error(
      `campaign ${JSON.stringify(campaignId)} checkpoint does not match current state`,
    );
  }
  return checkpoint;
};
