import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { ClientToHostMessage, CommandRefusal, RevisionVector } from '@shared/wire-protocol.js';

import { openPersistenceDatabase } from '../persistence/index.js';
import {
  commitCreationSetDecide,
  CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
  CreationSetDecideApplicationError,
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  normalizeCreationSetDecideRequest,
  validateDurableCreationWizardCheckpoint,
  type CreationSetDecideCommandRequest,
  type CreationSetDecidePayload,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  commitIdentityCheckpoint,
  EMPTY_IDENTITY_BRANCH_CACHE_HASH,
  IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  type IdentityCheckpointCommandRequest,
  type IdentityCheckpointPayload,
} from './identity-checkpoint.js';

const databases: Database.Database[] = [];
const memoryDatabase = (): Database.Database => {
  const database = openPersistenceDatabase(':memory:');
  databases.push(database);
  return database;
};

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const ZERO_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;

const IDENTITY_PAYLOAD = {
  age: 25,
  artAssetKeyOrLocalFile: {
    assetKey: 'symbiosis_placeholder_free_female',
    kind: 'asset-key',
  },
  characterDraftId: 'character-draft',
  description: 'description',
  draftRevision: 0,
  massKg: 70,
  name: 'Alice',
  sex: 'FEMALE',
  stage: 'IDENTITY',
  wizardCheckpointId: 'wizard-checkpoint',
} as const satisfies IdentityCheckpointPayload;

const identityRequest = (
  commandId = 'identity-command',
  payload: IdentityCheckpointPayload = IDENTITY_PAYLOAD,
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

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

interface CorruptibleDecisionRecord {
  receipt: {
    commandId: string;
    receiptId: string;
    revisions: { stateRevision: number };
  };
  request: { commandId: string };
}

interface CorruptiblePostIdentityPayload {
  raceAndMethodStage: {
    decisionRecords: CorruptibleDecisionRecord[];
    symbiontAcquisition: unknown;
  };
  receipt: {
    commandId: string;
    revisions: { stateRevision: number };
  };
}

const decisionRequest = (
  commandId: string,
  payload: CreationSetDecidePayload,
  expectedRevisions: RevisionVector,
): CreationSetDecideCommandRequest => ({
  commandId,
  commandKind: 'workflow-command',
  expectedRevisions,
  messageType: 'command.request',
  payload,
  protocolVersion: 1,
  role: 'player',
  workflowCommandId: CREATION_SET_DECIDE_WORKFLOW_COMMAND_ID,
});

const commonPayload = (draftRevision: number) => ({
  characterDraftId: IDENTITY_PAYLOAD.characterDraftId,
  draftRevision,
  stage: 'RACE_AND_METHOD' as const,
  wizardCheckpointId: IDENTITY_PAYLOAD.wizardCheckpointId,
});

const raceRequest = (
  choice: 'FREE' | 'PURE' | 'UNITED',
  commandId = `race-${choice}`,
  revisions: RevisionVector = ZERO_REVISIONS,
): CreationSetDecideCommandRequest =>
  decisionRequest(
    commandId,
    { ...commonPayload(0), raceChoice: choice, sourceFormId: 'CHR-010' },
    revisions,
  );

const acquisitionRequest = (
  mode: 'MANUAL' | 'RANDOM',
  previous: DurableCreationWizardCheckpoint,
  commandId = `acquisition-${mode}`,
): CreationSetDecideCommandRequest =>
  decisionRequest(
    commandId,
    {
      ...commonPayload(previous.receipt.result.draftRevision),
      sourceFormId: 'CHR-016',
      symbiontAcquisitionMode: mode,
    },
    previous.receipt.revisions,
  );

const diceRequest = (
  mode: 'AUTO' | 'MANUAL',
  previous: DurableCreationWizardCheckpoint,
  commandId = `dice-${mode}`,
): CreationSetDecideCommandRequest =>
  decisionRequest(
    commandId,
    {
      ...commonPayload(previous.receipt.result.draftRevision),
      diceInputMode: mode,
      sourceFormId: 'CHR-036',
    },
    previous.receipt.revisions,
  );

const methodRequest = (
  previous: DurableCreationWizardCheckpoint,
): CreationSetDecideCommandRequest =>
  decisionRequest(
    'method-classic',
    {
      ...commonPayload(previous.receipt.result.draftRevision),
      sourceFormId: 'CHR-002',
      statMethod: 'CLASSIC',
    },
    previous.receipt.revisions,
  );

const refusalFrom = (run: () => unknown): CommandRefusal => {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof CreationSetDecideApplicationError) return error.refusal;
    throw error;
  }
  throw new Error('expected CreationSetDecideApplicationError');
};

const committedUnitedPath = (
  database: Database.Database,
): {
  readonly acquisition: DurableCreationWizardCheckpoint;
  readonly dice: DurableCreationWizardCheckpoint;
  readonly race: DurableCreationWizardCheckpoint;
} => {
  commitIdentityCheckpoint(database, identityRequest(), 'receipt-identity');
  const race = commitCreationSetDecide(database, raceRequest('UNITED'), 'receipt-race');
  const acquisition = commitCreationSetDecide(
    database,
    acquisitionRequest('RANDOM', race),
    'receipt-acquisition',
  );
  const dice = commitCreationSetDecide(database, diceRequest('AUTO', acquisition), 'receipt-dice');
  return { acquisition, dice, race };
};

describe('RACE_AND_METHOD SET-DECIDE durable command', () => {
  it('normalizes the recursively exact four-variant union and refuses every neighboring shape', () => {
    const valid = [
      raceRequest('UNITED'),
      decisionRequest(
        'acquisition-shape',
        {
          ...commonPayload(1),
          sourceFormId: 'CHR-016',
          symbiontAcquisitionMode: 'MANUAL',
        },
        { actorVisibilityRevision: 0, projectionRevision: 1, stateRevision: 1 },
      ),
      decisionRequest(
        'dice-shape',
        { ...commonPayload(2), diceInputMode: 'MANUAL', sourceFormId: 'CHR-036' },
        { actorVisibilityRevision: 0, projectionRevision: 2, stateRevision: 2 },
      ),
      decisionRequest(
        'method-shape',
        { ...commonPayload(3), sourceFormId: 'CHR-002', statMethod: 'ALL_OR_NOTHING' },
        { actorVisibilityRevision: 0, projectionRevision: 3, stateRevision: 3 },
      ),
    ] as const;
    for (const request of valid) {
      expect(normalizeCreationSetDecideRequest(request)).toEqual(request);
    }

    const unknownWorkflowId = ['UI', 'CMD', 'UNKNOWN'].join('-');
    const unknownWorkflow = {
      ...raceRequest('UNITED'),
      workflowCommandId: unknownWorkflowId,
    } as unknown as DecodedCommandRequest;
    expect(refusalFrom(() => normalizeCreationSetDecideRequest(unknownWorkflow))).toEqual({
      code: 'UNRECOGNIZED',
      path: '$.workflowCommandId',
      value: unknownWorkflowId,
    });

    const invalidCases: readonly [DecodedCommandRequest, Partial<CommandRefusal>][] = [
      [
        {
          ...raceRequest('UNITED'),
          payload: { ...raceRequest('UNITED').payload, stage: 'IDENTITY' },
        },
        { code: 'UNRECOGNIZED', path: '$.payload.stage', value: 'IDENTITY' },
      ],
      [
        {
          ...raceRequest('UNITED'),
          payload: { ...raceRequest('UNITED').payload, sourceFormId: 'CHR-003' },
        },
        { code: 'UNRECOGNIZED', path: '$.payload.sourceFormId', value: 'CHR-003' },
      ],
      [
        {
          ...raceRequest('UNITED'),
          payload: { ...raceRequest('UNITED').payload, raceChoice: 'OTHER' },
        },
        { code: 'UNRECOGNIZED', path: '$.payload.raceChoice', value: 'OTHER' },
      ],
      [
        {
          ...raceRequest('UNITED'),
          payload: { ...raceRequest('UNITED').payload, diceInputMode: 'AUTO' },
        },
        { code: 'INVALID_SHAPE', path: '$.payload.diceInputMode' },
      ],
      [
        {
          ...raceRequest('UNITED'),
          payload: { ...commonPayload(0), sourceFormId: 'CHR-010' },
        },
        { code: 'INVALID_SHAPE', path: '$.payload.raceChoice' },
      ],
      [
        {
          ...raceRequest('UNITED'),
          payload: { ...raceRequest('UNITED').payload, draftRevision: '0' },
        },
        { code: 'INVALID_SHAPE', path: '$.payload.draftRevision' },
      ],
    ];
    for (const [request, refusal] of invalidCases) {
      expect(refusalFrom(() => normalizeCreationSetDecideRequest(request))).toMatchObject(refusal);
    }
  });

  it('commits the UNITED path through CHR-002 with exact deltas and append-only replay records', () => {
    const database = memoryDatabase();
    const { acquisition, dice, race } = committedUnitedPath(database);

    expect(race.receipt).toMatchObject({
      commandId: 'race-UNITED',
      result: {
        checkpointRevision: 1,
        draftRevision: 1,
        nextFormId: 'CHR-016',
        raceChoice: 'UNITED',
        sourceFormId: 'CHR-010',
      },
      revisions: { actorVisibilityRevision: 0, projectionRevision: 1, stateRevision: 1 },
    });
    expect(acquisition.receipt).toMatchObject({
      result: {
        checkpointRevision: 2,
        draftRevision: 2,
        nextFormId: 'CHR-036',
        symbiontAcquisitionMode: 'RANDOM',
      },
      revisions: { actorVisibilityRevision: 0, projectionRevision: 2, stateRevision: 2 },
    });
    expect(dice.receipt).toMatchObject({
      result: {
        checkpointRevision: 3,
        draftRevision: 3,
        nextFormId: 'CHR-002',
        diceInputMode: 'AUTO',
      },
      revisions: { actorVisibilityRevision: 0, projectionRevision: 3, stateRevision: 3 },
    });
    expect(dice.raceAndMethodStage).toMatchObject({
      decisionRecords: [
        { request: { commandId: 'race-UNITED' } },
        { request: { commandId: 'acquisition-RANDOM' } },
        { request: { commandId: 'dice-AUTO' } },
      ],
      diceInput: { choiceLockStatus: 'UNLOCKED', value: 'AUTO' },
      race: {
        choiceLockStatus: 'UNLOCKED',
        consequences: 'Выбрать Единого',
        value: 'UNITED',
      },
      statMethod: null,
      symbiontAcquisition: {
        choiceLockStatus: 'UNLOCKED',
        consequences: 'Выбрать случайное получение симбионтов',
        value: 'RANDOM',
      },
    });
    expect(dice.identityStage.request).toEqual(identityRequest());
    expect(dice.identityStage.receipt.receiptId).toBe('receipt-identity');
    expect(dice.durablePayload).toMatchObject({
      branchCacheEntries: [],
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      randomReceiptIds: [],
      selectedBranchUuidOrNull: null,
    });

    const identityReplay = loadCreationWizardCommandByCommandId(database, 'identity-command');
    const raceReplay = loadCreationWizardCommandByCommandId(database, 'race-UNITED');
    expect(identityReplay?.receipt.receiptId).toBe('receipt-identity');
    expect(identityReplay?.nextStageEnvelope.formId).toBe('CHR-010');
    expect(raceReplay?.receipt.receiptId).toBe('receipt-race');
    expect(raceReplay?.nextStageEnvelope.formId).toBe('CHR-016');
    expect(raceReplay?.durableCheckpoint.receipt.receiptId).toBe('receipt-dice');
    expect(loadCreationWizardCommandByCommandId(database, 'unknown-command')).toBeNull();
    expect(loadCreationWizardCheckpoint(database, IDENTITY_PAYLOAD.characterDraftId)).toEqual(dice);
  });

  it('routes PURE directly to CHR-036 and guards CHR-016 with a zero-write refusal', () => {
    const database = memoryDatabase();
    commitIdentityCheckpoint(database, identityRequest(), 'receipt-identity');
    const pure = commitCreationSetDecide(database, raceRequest('PURE'), 'receipt-pure');
    expect(pure.nextStageEnvelope.formId).toBe('CHR-036');
    expect(pure.raceAndMethodStage).toMatchObject({
      decisionRecords: [{ request: { commandId: 'race-PURE' } }],
      symbiontAcquisition: {
        choiceLockStatus: 'NOT_APPLICABLE',
        consequences: null,
        value: null,
      },
    });

    const before = structuredClone(pure);
    const forged = decisionRequest(
      'forged-acquisition',
      {
        ...commonPayload(pure.receipt.result.draftRevision),
        sourceFormId: 'CHR-016',
        symbiontAcquisitionMode: 'MANUAL',
      },
      pure.receipt.revisions,
    );
    expect(refusalFrom(() => commitCreationSetDecide(database, forged, 'receipt-forged'))).toEqual({
      code: 'GUARD_REJECTED',
    });
    expect(loadCreationWizardCheckpoint(database, IDENTITY_PAYLOAD.characterDraftId)).toEqual(
      before,
    );

    const dice = commitCreationSetDecide(
      database,
      diceRequest('MANUAL', pure, 'pure-dice'),
      'receipt-pure-dice',
    );
    expect(dice.nextStageEnvelope.formId).toBe('CHR-002');
    expect(dice.raceAndMethodStage?.decisionRecords).toHaveLength(2);
  });

  it('recognizes CHR-002 structurally but guard-closes it without a durable write', () => {
    const database = memoryDatabase();
    const { dice } = committedUnitedPath(database);
    const request = methodRequest(dice);
    expect(normalizeCreationSetDecideRequest(request)).toEqual(request);
    expect(refusalFrom(() => commitCreationSetDecide(database, request, 'receipt-method'))).toEqual(
      {
        code: 'GUARD_REJECTED',
      },
    );
    expect(loadCreationWizardCheckpoint(database, IDENTITY_PAYLOAD.characterDraftId)).toEqual(dice);
    expect(loadCreationWizardCommandByCommandId(database, request.commandId)).toBeNull();
  });

  it('refuses stale, wrong-owner, wrong-order, duplicate-command, and duplicate-receipt writes', () => {
    const database = memoryDatabase();
    commitIdentityCheckpoint(database, identityRequest(), 'receipt-identity');
    const initial = loadCreationWizardCheckpoint(database, IDENTITY_PAYLOAD.characterDraftId);
    const stale = raceRequest('FREE', 'stale', {
      actorVisibilityRevision: 0,
      projectionRevision: 1,
      stateRevision: 1,
    });
    expect(refusalFrom(() => commitCreationSetDecide(database, stale, 'receipt-stale'))).toEqual({
      actual: ZERO_REVISIONS,
      code: 'STALE_REVISION',
      expected: stale.expectedRevisions,
    });

    const wrongCheckpoint = {
      ...raceRequest('FREE', 'wrong-checkpoint'),
      payload: { ...raceRequest('FREE').payload, wizardCheckpointId: 'another-checkpoint' },
    } as CreationSetDecideCommandRequest;
    expect(
      refusalFrom(() => commitCreationSetDecide(database, wrongCheckpoint, 'receipt-wrong')),
    ).toEqual({ code: 'GUARD_REJECTED' });

    const wrongOrder = decisionRequest(
      'wrong-order',
      { ...commonPayload(0), diceInputMode: 'AUTO', sourceFormId: 'CHR-036' },
      ZERO_REVISIONS,
    );
    expect(
      refusalFrom(() => commitCreationSetDecide(database, wrongOrder, 'receipt-order')),
    ).toEqual({ code: 'GUARD_REJECTED' });
    expect(loadCreationWizardCheckpoint(database, IDENTITY_PAYLOAD.characterDraftId)).toEqual(
      initial,
    );

    const race = commitCreationSetDecide(database, raceRequest('FREE'), 'receipt-race');
    expect(
      refusalFrom(() =>
        commitCreationSetDecide(database, raceRequest('FREE'), 'receipt-duplicate-command'),
      ),
    ).toEqual({
      actual: race.receipt.revisions,
      code: 'STALE_REVISION',
      expected: ZERO_REVISIONS,
    });
    expect(
      refusalFrom(() =>
        commitCreationSetDecide(database, acquisitionRequest('MANUAL', race), 'receipt-race'),
      ),
    ).toEqual({ code: 'GUARD_REJECTED' });
    expect(loadCreationWizardCheckpoint(database, IDENTITY_PAYLOAD.characterDraftId)).toEqual(race);
  });

  it('restores the unchanged identity-only envelope and fails closed on post-identity corruption', () => {
    const identityDatabase = memoryDatabase();
    const identity = commitIdentityCheckpoint(
      identityDatabase,
      identityRequest(),
      'receipt-identity',
    );
    const restored = loadCreationWizardCheckpoint(
      identityDatabase,
      IDENTITY_PAYLOAD.characterDraftId,
    );
    expect(restored.durablePayload).toEqual(identity.durablePayload);
    expect(restored.raceAndMethodStage).toBeNull();

    const database = memoryDatabase();
    const { dice } = committedUnitedPath(database);
    const corruptionCases: readonly [
      string,
      (payload: CorruptiblePostIdentityPayload) => void,
      RegExp,
    ][] = [
      [
        'top receipt',
        (payload) => {
          payload['receipt'].commandId = 'different-command';
        },
        /top-level receipt\/latest record/,
      ],
      [
        'duplicate command',
        (payload) => {
          payload['raceAndMethodStage'].decisionRecords[1]!.request.commandId = 'race-UNITED';
          payload['raceAndMethodStage'].decisionRecords[1]!.receipt.commandId = 'race-UNITED';
        },
        /duplicate commandId/,
      ],
      [
        'duplicate receipt',
        (payload) => {
          payload['raceAndMethodStage'].decisionRecords[1]!.receipt.receiptId =
            payload['raceAndMethodStage'].decisionRecords[0]!.receipt.receiptId;
        },
        /duplicate receiptId/,
      ],
      [
        'stage gap',
        (payload) => {
          payload['raceAndMethodStage'].decisionRecords.splice(1, 1);
        },
        /stage sequence|aggregate/,
      ],
      [
        'aggregate mismatch',
        (payload) => {
          payload['raceAndMethodStage'].symbiontAcquisition = {
            choiceLockStatus: 'NOT_APPLICABLE',
            consequences: null,
            value: null,
          };
        },
        /aggregate/,
      ],
      [
        'revision mismatch',
        (payload) => {
          payload['raceAndMethodStage'].decisionRecords[2]!.receipt.revisions.stateRevision = 2;
          payload['receipt'].revisions.stateRevision = 2;
        },
        /receipt revisions|latest receipt revisions/,
      ],
    ];
    for (const [_label, mutate, expected] of corruptionCases) {
      const payload = structuredClone(
        dice.durablePayload,
      ) as unknown as CorruptiblePostIdentityPayload;
      mutate(payload);
      expect(() =>
        validateDurableCreationWizardCheckpoint(
          { ...dice.localCharacter, payloadJson: JSON.stringify(payload) },
          dice.checkpoint,
        ),
      ).toThrow(expected);
    }
  });
});
