import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { ClientToHostMessage, CommandRefusal } from '@shared/wire-protocol.js';

import {
  commitNewLocalCharacterCheckpoint,
  openPersistenceDatabase,
} from '../persistence/index.js';
import {
  commitIdentityCheckpoint,
  EMPTY_IDENTITY_BRANCH_CACHE_HASH,
  IdentityCheckpointApplicationError,
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  loadIdentityCheckpoint,
  loadIdentityCheckpointByCommandId,
  normalizeIdentityCheckpointRequest,
  validateIdentityCheckpointRequest,
  validateDurableIdentityCheckpoint,
  type IdentityCheckpointCommandRequest,
  type IdentityCheckpointPayload,
} from './identity-checkpoint.js';

const databases: Database.Database[] = [];
const memoryDatabase = (): Database.Database => {
  const database = openPersistenceDatabase(':memory:');
  databases.push(database);
  return database;
};

const ZERO_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const;
interface CorruptiblePayload {
  branchCacheHash: string;
  lastCompleteStage: { request: { payload: { wizardCheckpointId: string } } };
  nextStageEnvelope: { routeBindings: [{ value: string }] };
  receipt: {
    commandId: string;
    receiptId: string;
    result: { checkpointId: string; draftRevision: number };
    revisions: { stateRevision: number };
  };
}
const VALID_PAYLOAD = {
  age: 0,
  artAssetKeyOrLocalFile: {
    assetKey: 'symbiosis_placeholder_free_female',
    kind: 'asset-key',
  },
  characterDraftId: 'character-draft',
  description: 'description',
  draftRevision: 0,
  massKg: 0.1,
  name: 'Alice',
  sex: 'MALE',
  stage: 'IDENTITY',
  wizardCheckpointId: 'wizard-checkpoint',
} as const satisfies IdentityCheckpointPayload;

const request = (
  commandId = 'identity-command',
  payload: IdentityCheckpointPayload = VALID_PAYLOAD,
): IdentityCheckpointCommandRequest => ({
  commandId,
  commandKind: 'workflow-command',
  expectedRevisions: ZERO_REVISIONS,
  messageType: 'command.request',
  payload,
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
});

const refusalFrom = (run: () => unknown): CommandRefusal => {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof IdentityCheckpointApplicationError) return error.refusal;
    throw error;
  }
  throw new Error('expected IdentityCheckpointApplicationError');
};

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('CHR-001 IDENTITY durable checkpoint', () => {
  it('atomically stores the exact ten-field request, envelope, receipt, and empty cache hash', () => {
    const database = memoryDatabase();
    const committed = commitIdentityCheckpoint(database, request(), 'receipt-identity');

    expect(committed.localCharacter).toMatchObject({
      actorVisibilityRevision: 0,
      lifecycleState: 'DRAFT',
      localCharacterId: VALID_PAYLOAD.characterDraftId,
      projectionRevision: 0,
      stateRevision: 0,
    });
    expect(committed.checkpoint).toMatchObject({
      actorVisibilityRevision: 0,
      checkpointId: VALID_PAYLOAD.wizardCheckpointId,
      checkpointRevision: 0,
      localCharacterId: VALID_PAYLOAD.characterDraftId,
      projectionRevision: 0,
      stateRevision: 0,
    });
    expect(committed.request.payload).toEqual(VALID_PAYLOAD);
    expect(Object.keys(committed.request.payload)).toHaveLength(10);
    expect(committed.receipt).toEqual({
      commandId: 'identity-command',
      receiptId: 'receipt-identity',
      result: {
        branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
        characterDraftId: VALID_PAYLOAD.characterDraftId,
        checkpointId: VALID_PAYLOAD.wizardCheckpointId,
        checkpointOwnerId: VALID_PAYLOAD.characterDraftId,
        checkpointRevision: 0,
        draftRevision: 0,
        nextFormId: 'CHR-010',
        stage: 'IDENTITY',
      },
      revisions: ZERO_REVISIONS,
    });
    expect(committed.durablePayload).toEqual({
      branchCacheEntries: [],
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      lastCompleteStage: {
        derived: {
          anatomyProfile: 'STANDARD_HUMANOID',
          massApprovalStatus: 'PENDING_GM',
        },
        request: request(),
      },
      nextStageEnvelope: {
        formId: 'CHR-010',
        routeBindings: [
          { parameterIndex: 0, source: 'inherited', value: VALID_PAYLOAD.characterDraftId },
        ],
      },
      randomReceiptIds: [],
      receipt: committed.receipt,
      selectedBranchUuidOrNull: null,
    });
    expect(JSON.parse(committed.localCharacter.payloadJson)).toEqual(committed.durablePayload);
    expect(committed.checkpoint.snapshotJson).toBe(
      JSON.stringify({
        localCharacter: {
          localCharacterId: VALID_PAYLOAD.characterDraftId,
          lifecycleState: 'DRAFT',
          payloadJson: committed.localCharacter.payloadJson,
        },
      }),
    );
  });

  it('loads and validates the same durable application record without runtime journal state', () => {
    const database = memoryDatabase();
    const committed = commitIdentityCheckpoint(database, request(), 'receipt-identity');

    expect(loadIdentityCheckpoint(database, VALID_PAYLOAD.characterDraftId)).toEqual(committed);
    expect(loadIdentityCheckpointByCommandId(database, 'identity-command')).toEqual(committed);
    expect(loadIdentityCheckpointByCommandId(database, 'unknown-command')).toBeNull();
  });

  it('separates structural negative-zero normalization from the application guard', () => {
    expect(normalizeIdentityCheckpointRequest(request())).toEqual(request());
    const whitespaceName = normalizeIdentityCheckpointRequest(
      request('trimmed-name', { ...VALID_PAYLOAD, name: ' Alice ' }),
    );
    expect(whitespaceName.payload.name).toBe(' Alice ');
    expect(refusalFrom(() => validateIdentityCheckpointRequest(whitespaceName))).toEqual({
      code: 'GUARD_REJECTED',
    });
    expect(
      normalizeIdentityCheckpointRequest(request('negative-zero', { ...VALID_PAYLOAD, age: -0 }))
        .payload.age,
    ).toBe(0);
  });

  it('rejects another command, stage, sex, extra key, and failed commit guard explicitly', () => {
    const unknownWorkflowCommandId = ['UI', 'CMD', 'APP', 'BOOTSTRAP'].join('-');
    const anotherCommand = {
      ...request(),
      workflowCommandId: unknownWorkflowCommandId,
    } as unknown as Extract<ClientToHostMessage, { messageType: 'command.request' }>;
    expect(refusalFrom(() => normalizeIdentityCheckpointRequest(anotherCommand))).toEqual({
      code: 'UNRECOGNIZED',
      path: '$.workflowCommandId',
      value: unknownWorkflowCommandId,
    });
    expect(
      refusalFrom(() =>
        normalizeIdentityCheckpointRequest(
          request('other-stage', { ...VALID_PAYLOAD, stage: 'RACE' } as never),
        ),
      ),
    ).toEqual({ code: 'UNRECOGNIZED', path: '$.payload.stage', value: 'RACE' });
    expect(
      refusalFrom(() =>
        normalizeIdentityCheckpointRequest(
          request('other-sex', { ...VALID_PAYLOAD, sex: 'UNKNOWN' } as never),
        ),
      ),
    ).toEqual({ code: 'UNRECOGNIZED', path: '$.payload.sex', value: 'UNKNOWN' });
    expect(
      refusalFrom(() =>
        normalizeIdentityCheckpointRequest(request('extra', { ...VALID_PAYLOAD, extra: true })),
      ),
    ).toMatchObject({ code: 'INVALID_SHAPE', path: '$.payload.extra' });
    const badMass = normalizeIdentityCheckpointRequest(
      request('bad-mass', { ...VALID_PAYLOAD, massKg: 0 }),
    );
    expect(refusalFrom(() => validateIdentityCheckpointRequest(badMass))).toEqual({
      code: 'GUARD_REJECTED',
    });
  });

  it('refuses every second first-checkpoint write without changing the durable sex', () => {
    const database = memoryDatabase();
    const committed = commitIdentityCheckpoint(database, request(), 'receipt-identity');
    const changedSex = request('changed-sex', { ...VALID_PAYLOAD, sex: 'FEMALE' });

    expect(() => commitIdentityCheckpoint(database, changedSex, 'receipt-changed')).toThrow(
      /already has checkpoint|already exists/,
    );
    expect(loadIdentityCheckpoint(database, VALID_PAYLOAD.characterDraftId)).toEqual(committed);
    expect(
      loadIdentityCheckpoint(database, VALID_PAYLOAD.characterDraftId).request.payload.sex,
    ).toBe('MALE');
  });

  it('requires a non-empty receipt ID on commit and restore', () => {
    const database = memoryDatabase();
    expect(() => commitIdentityCheckpoint(database, request(), '')).toThrow(/non-empty string/);
    const committed = commitIdentityCheckpoint(database, request(), 'receipt-identity');
    const payload = structuredClone(committed.durablePayload) as unknown as CorruptiblePayload;
    payload.receipt.receiptId = '';

    expect(() =>
      validateDurableIdentityCheckpoint(
        { ...committed.localCharacter, payloadJson: JSON.stringify(payload) },
        committed.checkpoint,
      ),
    ).toThrow(/receipt violates the durable identity contract/);
  });

  it('requires distinct character and checkpoint IDs on restore', () => {
    const database = memoryDatabase();
    const committed = commitIdentityCheckpoint(database, request(), 'receipt-identity');
    const payload = structuredClone(committed.durablePayload) as unknown as CorruptiblePayload;
    payload.lastCompleteStage.request.payload.wizardCheckpointId = VALID_PAYLOAD.characterDraftId;
    payload.receipt.result.checkpointId = VALID_PAYLOAD.characterDraftId;

    expect(() =>
      validateDurableIdentityCheckpoint(
        { ...committed.localCharacter, payloadJson: JSON.stringify(payload) },
        { ...committed.checkpoint, checkpointId: VALID_PAYLOAD.characterDraftId },
      ),
    ).toThrow(/checkpoint\/character ID collision/);
  });

  it('requires the first checkpoint receipt, checkpoint, and root to stay at zero', () => {
    const database = memoryDatabase();
    const committed = commitIdentityCheckpoint(database, request(), 'receipt-identity');
    const payload = structuredClone(committed.durablePayload) as unknown as CorruptiblePayload;
    payload.receipt.revisions.stateRevision = 1;

    expect(() =>
      validateDurableIdentityCheckpoint(
        { ...committed.localCharacter, payloadJson: JSON.stringify(payload), stateRevision: 1 },
        { ...committed.checkpoint, stateRevision: 1 },
      ),
    ).toThrow(/initial zero vector/);
  });

  it('fails closed on every persisted cross-field mismatch', () => {
    const database = memoryDatabase();
    const committed = commitIdentityCheckpoint(database, request(), 'receipt-identity');

    const cases: readonly [string, (payload: CorruptiblePayload) => void, RegExp][] = [
      [
        'command ID',
        (payload) => {
          payload.receipt.commandId = 'different-command';
        },
        /request\/receipt commandId/,
      ],
      [
        'checkpoint ID',
        (payload) => {
          payload.receipt.result.checkpointId = 'different-checkpoint';
        },
        /receipt checkpointId/,
      ],
      [
        'draft revision',
        (payload) => {
          payload.receipt.result.draftRevision = 1;
        },
        /draftRevision/,
      ],
      [
        'route binding',
        (payload) => {
          payload.nextStageEnvelope.routeBindings[0].value = 'different-character';
        },
        /next route binding/,
      ],
      [
        'receipt revisions',
        (payload) => {
          payload.receipt.revisions.stateRevision = 1;
        },
        /receipt\/checkpoint revisions/,
      ],
    ];
    for (const [_label, mutate, expected] of cases) {
      const payload = structuredClone(committed.durablePayload) as unknown as CorruptiblePayload;
      mutate(payload);
      expect(() =>
        validateDurableIdentityCheckpoint(
          { ...committed.localCharacter, payloadJson: JSON.stringify(payload) },
          committed.checkpoint,
        ),
      ).toThrow(expected);
    }
  });

  it('rejects an altered empty-cache hash before cross-field validation', () => {
    const database = memoryDatabase();
    const committed = commitIdentityCheckpoint(database, request(), 'receipt-identity');
    const payload = structuredClone(committed.durablePayload) as unknown as CorruptiblePayload;
    payload.branchCacheHash = 'not-the-empty-cache-hash';

    expect(() =>
      validateDurableIdentityCheckpoint(
        { ...committed.localCharacter, payloadJson: JSON.stringify(payload) },
        committed.checkpoint,
      ),
    ).toThrow(/payload violates the durable identity contract/);
  });

  it('treats duplicate durable command IDs as corruption rather than choosing a row', () => {
    const database = memoryDatabase();
    commitIdentityCheckpoint(database, request(), 'receipt-one');
    commitIdentityCheckpoint(
      database,
      request('identity-command', {
        ...VALID_PAYLOAD,
        characterDraftId: 'character-draft-two',
        wizardCheckpointId: 'wizard-checkpoint-two',
      }),
      'receipt-two',
    );

    expect(() => loadIdentityCheckpointByCommandId(database, 'identity-command')).toThrow(
      /is duplicated by local characters: "character-draft", "character-draft-two"/,
    );
  });

  it('does not classify a corrupt target command as an unknown durable command', () => {
    const database = memoryDatabase();
    commitNewLocalCharacterCheckpoint(
      database,
      'corrupt-character',
      'corrupt-checkpoint',
      (create) =>
        create(
          'DRAFT',
          JSON.stringify({ lastCompleteStage: { request: { commandId: 'corrupt-command' } } }),
        ),
    );

    expect(() => loadIdentityCheckpointByCommandId(database, 'corrupt-command')).toThrow(
      /payload violates the durable identity contract/,
    );
  });
});
