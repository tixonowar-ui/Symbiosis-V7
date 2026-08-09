import type Database from 'better-sqlite3';

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

export type RevisionScope =
  { entity: 'localCharacter'; entityId: string } | { entity: 'campaign'; entityId: string };

export interface CampaignCheckpoint extends RevisionTriple {
  campaignId: string;
  snapshotJson: string;
}

type RevisionRow = RevisionTriple;

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
