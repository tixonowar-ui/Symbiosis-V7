import type { NpcOperation } from './npc-library-records.js';
import type { CampaignLobbyEvent } from './campaign-lobby-state.js';
import { initialCampaignTimeValue } from '@shared/campaign-lobby.js';
import {
  verifyNpcInitialTimeHistory,
  type NpcCampaignCheckpointLedger,
} from './npc-campaign-checkpoints.js';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrationSequence } from './migrations/index.js';
import { readNpcCampaignCheckpointLedgerInTransaction } from './npc-campaign-checkpoints.js';
import { migration0001 } from './migrations/0001-initial.js';
import { migration0002 } from './migrations/0002-local-character-checkpoint.js';
import { migration0003 } from './migrations/0003-device-identity.js';
import { migration0004 } from './migrations/0004-skill-presentation.js';
import { migration0005 } from './migrations/0005-symbiont-presentation.js';
import { migration0006 } from './migrations/0006-local-character-post-save.js';
import { migration0007 } from './migrations/0007-campaign-creation.js';
import { migration0008 } from './migrations/0008-network-installation-identity.js';
import { migration0009 } from './migrations/0009-device-admission.js';
import { migration0010 } from './migrations/0010-network-application.js';
import { migration0011 } from './migrations/0011-device-request-review.js';
import { migration0012 } from './migrations/0012-campaign-admission.js';
import { migration0013 } from './migrations/0013-campaign-lobby.js';
import { migration0014 } from './migrations/0014-campaign-lifecycle.js';
const migrations = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
  migration0013,
  migration0014,
];
const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
});
function legacy(version: number) {
  const db = new Database(':memory:');
  databases.push(db);
  applyMigrationSequence(db, migrations.slice(0, version));
  return db;
}
describe('NPC aggregate primitive compatibility', () => {
  it.each([7, 10, 11, 12, 13, 14])(
    'keeps migration %s absence read-only and does not add an empty anchor',
    (version) => {
      const db = legacy(version),
        bytes = db.serialize();
      expect(
        db
          .transaction(() => readNpcCampaignCheckpointLedgerInTransaction(db, 'legacy-campaign'))
          .deferred(),
      ).toEqual({ campaignId: 'legacy-campaign', operations: [], commits: [], anchorOrNull: null });
      expect(db.serialize().equals(bytes)).toBe(true);
    },
  );
  it('requires an owning read transaction', () => {
    const db = legacy(14),
      bytes = db.serialize();
    expect(() => readNpcCampaignCheckpointLedgerInTransaction(db, 'legacy-campaign')).toThrow();
    expect(db.serialize().equals(bytes)).toBe(true);
  });
  it('refuses an NPC table hidden behind legacy migration 14', () => {
    const db = legacy(14);
    db.exec('CREATE TABLE npc_version (record_json TEXT)');
    const bytes = db.serialize();
    expect(() =>
      db
        .transaction(() => readNpcCampaignCheckpointLedgerInTransaction(db, 'legacy-campaign'))
        .deferred(),
    ).toThrow();
    expect(db.serialize().equals(bytes)).toBe(true);
  });
});

// Cross-ledger unit fixtures only. These do not claim full mechanical NPC validity.
const timeId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const timeStamp = '2026-11-06T00:00:00.000Z';
const timeHash = 'a'.repeat(64);
const timeScope = { campaignId: timeId(1), ownerDeviceId: timeId(2), gmLocalContextId: timeId(3) };
function timeCheckpoint(stateRevision: number) {
  return {
    campaignId: timeScope.campaignId,
    snapshotJson: '{}',
    stateRevision,
    projectionRevision: stateRevision,
    actorVisibilityRevision: 0,
  };
}
function lockedNpcLedger(lockedMinute: number | null): NpcCampaignCheckpointLedger {
  const operation: NpcOperation = {
    operationId: timeId(4),
    receiptId: timeId(5),
    kind: 'COMMIT_V1',
    scope: timeScope,
    request: {},
    attemptEventSha256: timeHash,
    versionOrNull: { npcUuid: timeId(6), version: 1, sha256: timeHash },
    anchorOrNull: { libraryRevision: 1, checkpointId: timeId(7), checkpointSha256: timeHash },
    beforeGmSource: {
      sourceFormId: 'NPC-017',
      revisions: { stateRevision: 8, projectionRevision: 10, actorVisibilityRevision: 0 },
      sourceSnapshotSha256: timeHash,
      queuePrefix: { eventId: timeId(8), recordSha256: timeHash },
    },
    beforeCheckpoint: timeCheckpoint(2),
    afterCheckpoint: timeCheckpoint(3),
    committedAt: timeStamp,
  };
  return {
    campaignId: timeScope.campaignId,
    operations: [operation],
    anchorOrNull: operation.anchorOrNull,
    commits: [
      {
        operation,
        block: {
          format: 'NPC_LIBRARY_RECOVERY_V1',
          campaignId: timeScope.campaignId,
          libraryRevision: 1,
          checkpointId: timeId(7),
          versions: [operation.versionOrNull!],
          heads: [operation.versionOrNull!],
          artSha256s: [timeHash],
          initialTimeLockOrNull:
            lockedMinute === null
              ? null
              : {
                  campaignTimestamp: lockedMinute,
                  operationId: operation.operationId,
                  npcUuid: timeId(6),
                  version: 1,
                },
        },
      },
    ],
  };
}
function timeEvent(campaignRevision: number, minute: number, eventIndex = 1): CampaignLobbyEvent {
  const workflowCommandId = 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET';
  const input = initialCampaignTimeValue({ dayNumber: 1, hour: 0, minute });
  return {
    schemaVersion: 1,
    eventIndex,
    previousSha256OrNull: eventIndex === 1 ? null : timeHash,
    campaignRevision,
    authority: {
      kind: 'GM',
      ownerDeviceId: timeScope.ownerDeviceId,
      gmLocalContextId: timeScope.gmLocalContextId,
    },
    request: {
      workflowCommandId,
      commandId: timeId(20 + eventIndex),
      campaignId: timeScope.campaignId,
      expectedLobbySnapshotRevision: timeHash,
      dayNumber: 1,
      hour: 0,
      minute,
    },
    clientRequestJsonOrNull: null,
    beforeCheckpointOrNull: null,
    receipt: {
      workflowCommandId,
      commandId: timeId(20 + eventIndex),
      receiptId: timeId(30 + eventIndex),
      campaignId: timeScope.campaignId,
      committedAt: timeStamp,
      lobbySnapshotRevision: timeHash,
      readinessRevision: eventIndex,
      initialCampaignTime: input,
    },
  };
}
function startTimeEvent(campaignRevision: number, minute: number): CampaignLobbyEvent {
  const event = timeEvent(campaignRevision, minute, 2);
  const workflowCommandId = 'UI-CMD-CAMPAIGN-START';
  return {
    ...event,
    beforeCheckpointOrNull: timeCheckpoint(campaignRevision),
    request: {
      workflowCommandId,
      commandId: event.request.commandId,
      campaignId: timeScope.campaignId,
      expectedLobbySnapshotRevision: timeHash,
      expectedReadinessRevision: 2,
    },
    receipt: {
      workflowCommandId,
      commandId: event.request.commandId,
      campaignId: timeScope.campaignId,
      receiptId: event.receipt.receiptId,
      committedAt: timeStamp,
      lobbySnapshotRevision: timeHash,
      readinessRevision: 2,
      campaignRevision: campaignRevision + 1,
      checkpointSha256: timeHash,
      scene: {
        schemaVersion: 1,
        sceneId: timeId(50),
        campaignId: timeScope.campaignId,
        sceneContext: 'PEACE',
        checkpointId: timeId(51),
        includedCopies: [],
        campaignTimestamp: minute,
        clockMode: 'STOPPED',
        dayPhase: 'NIGHT',
      },
    },
  };
}

describe('ADR 0078 initial NPC time versus immutable lobby history', () => {
  it('does not lock time for an untimed NPC or change old initial-time receipts', () => {
    const events = [timeEvent(1, 7), timeEvent(3, 9, 2)];
    const before = structuredClone(events);
    expect(() => verifyNpcInitialTimeHistory(lockedNpcLedger(null), events)).not.toThrow();
    expect(events).toEqual(before);
  });
  it('uses the last actual confirmed minute before the first timed save', () => {
    const events = [timeEvent(0, 7), timeEvent(2, 9, 2), timeEvent(3, 9, 3)];
    expect(() => verifyNpcInitialTimeHistory(lockedNpcLedger(9), events)).not.toThrow();
    expect(() => verifyNpcInitialTimeHistory(lockedNpcLedger(7), events)).toThrow();
  });
  it.each(['missing', 'future', 'changed-after'] as const)('refuses %s time evidence', (kind) => {
    const events =
      kind === 'missing'
        ? []
        : kind === 'future'
          ? [timeEvent(3, 7)]
          : [timeEvent(2, 7), timeEvent(3, 9, 2)];
    expect(() => verifyNpcInitialTimeHistory(lockedNpcLedger(7), events)).toThrow();
  });
  it('refuses creating a pre-Start lock after an actual Start', () => {
    expect(() =>
      verifyNpcInitialTimeHistory(lockedNpcLedger(7), [timeEvent(0, 7), startTimeEvent(1, 7)]),
    ).toThrow();
  });
  it('retains the anchored minute through the first Start', () => {
    expect(() =>
      verifyNpcInitialTimeHistory(lockedNpcLedger(7), [timeEvent(2, 7), startTimeEvent(3, 7)]),
    ).not.toThrow();
    expect(() =>
      verifyNpcInitialTimeHistory(lockedNpcLedger(7), [timeEvent(2, 7), startTimeEvent(3, 9)]),
    ).toThrow();
  });
});
