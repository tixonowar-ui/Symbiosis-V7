import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import {
  commitCreationCriticalConfirmation,
  createCreationCriticalChain,
  resolveCreationStatSet,
  type CreationStatCriticalChainState,
} from '../domain/index.js';
import { commitLocalCharacterCheckpoint } from '../persistence/index.js';

import type {
  ClientToHostMessage,
  CommandRefusal,
  JsonValue,
  RevisionVector,
  WorkflowCommandId,
} from '@shared/wire-protocol.js';

import {
  currentStatRollAttempt,
  loadCreationWizardCheckpoint,
  validateDurableCreationWizardCheckpoint,
  type CreationCriticalOutcome,
  type CreationNextStageEnvelope,
  type CreationRollCommitCommandRequest,
  type CreationRollCommitPayload,
  type CreationRollCommitReceipt,
  type CriticalConfirmationRollRecord,
  type DurableCreationWizardCheckpoint,
  type StatRollStage,
  type StatRollAttempt,
  type StatSetRollRecord,
} from './creation-set-decide.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';

export const CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID =
  'UI-CMD-CHAR-CREATION-ROLL-COMMIT' as const satisfies WorkflowCommandId;

export class CreationRollCommitApplicationError extends Error {
  constructor(readonly refusal: CommandRefusal) {
    super(`creation roll commit request refused: ${JSON.stringify(refusal)}`);
  }
}

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

const REVISION_KEYS = ['actorVisibilityRevision', 'projectionRevision', 'stateRevision'] as const;
const COMMON_PAYLOAD_KEYS = [
  'stage',
  'sourceFormId',
  'characterDraftId',
  'wizardCheckpointId',
  'draftRevision',
  'branchUuid',
] as const;

const typeName = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

const invalidShape = (path: string, expected: string, value: unknown): never => {
  throw new CreationRollCommitApplicationError({
    actualType: typeName(value),
    code: 'INVALID_SHAPE',
    expected,
    path,
  });
};

const unrecognized = (path: string, value: JsonValue): never => {
  throw new CreationRollCommitApplicationError({ code: 'UNRECOGNIZED', path, value });
};

const objectAt = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidShape(path, 'object', value);
  }
  return value as Record<string, unknown>;
};

const exactObject = (
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> => {
  const object = objectAt(value, path);
  for (const key of keys) {
    if (!Object.hasOwn(object, key)) invalidShape(`${path}.${key}`, 'required field', undefined);
  }
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) invalidShape(`${path}.${key}`, 'no additional field', object[key]);
  }
  return object;
};

const stringAt = (value: unknown, path: string): string => {
  if (typeof value !== 'string') return invalidShape(path, 'string', value);
  return value;
};

const nonEmptyStringAt = (value: unknown, path: string): string => {
  const string = stringAt(value, path);
  if (string.length === 0) return invalidShape(path, 'non-empty string', value);
  return string;
};

const revisionAt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalidShape(path, 'non-negative safe integer', value);
  }
  return Object.is(value, -0) ? 0 : value;
};

const indexAt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalidShape(path, 'non-negative safe integer', value);
  }
  return Object.is(value, -0) ? 0 : value;
};

const literal = <T extends JsonValue>(value: unknown, expected: T, path: string): T => {
  if (!isDeepStrictEqual(value, expected)) {
    if (value === undefined) return invalidShape(path, 'required field', value);
    return unrecognized(path, value as JsonValue);
  }
  return expected;
};

const enumAt = <T extends string>(value: unknown, path: string, values: readonly T[]): T => {
  const string = stringAt(value, path);
  const selected = values.find((candidate) => candidate === string);
  if (selected === undefined) return unrecognized(path, string);
  return selected;
};

const revisionsAt = (value: unknown, path: string): RevisionVector => {
  const object = exactObject(value, path, REVISION_KEYS);
  return {
    actorVisibilityRevision: revisionAt(
      object['actorVisibilityRevision'],
      `${path}.actorVisibilityRevision`,
    ),
    projectionRevision: revisionAt(object['projectionRevision'], `${path}.projectionRevision`),
    stateRevision: revisionAt(object['stateRevision'], `${path}.stateRevision`),
  };
};

const d20FaceAt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 20) {
    return invalidShape(path, 'safe integer in 1..20', value);
  }
  return value;
};

const manualFacesAt = (value: unknown, path: string): readonly number[] | null => {
  if (value === null) return null;
  if (!Array.isArray(value))
    return invalidShape(path, 'null or array of exactly seven d20 faces', value);
  if (value.length !== 7) return invalidShape(path, 'array of exactly seven d20 faces', value);
  return value.map((face, index) => d20FaceAt(face, `${path}[${String(index)}]`));
};

const manualFaceAt = (value: unknown, path: string): number | null =>
  value === null ? null : d20FaceAt(value, path);

export function normalizeCreationRollCommitRequest(
  request: DecodedCommandRequest,
): CreationRollCommitCommandRequest {
  if (request.commandKind !== 'workflow-command') {
    return unrecognized('$.commandKind', request.commandKind);
  }
  if (request.workflowCommandId !== CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID) {
    return unrecognized('$.workflowCommandId', request.workflowCommandId);
  }
  if (request.role !== 'player') return unrecognized('$.role', request.role);

  const unshapedPayload = objectAt(request.payload, '$.payload');
  literal(unshapedPayload['stage'], 'STAT_ROLLS', '$.payload.stage');
  const sourceFormId = enumAt(unshapedPayload['sourceFormId'], '$.payload.sourceFormId', [
    'CHR-003',
    'CHR-004',
  ] as const);
  const variantKeys =
    sourceFormId === 'CHR-003'
      ? ['setRollRequestId', 'manualFacesOrNull']
      : ['setRollReceiptId', 'criticalQueueIndex', 'confirmationRollRequestId', 'manualFaceOrNull'];
  const payload = exactObject(request.payload, '$.payload', [
    ...COMMON_PAYLOAD_KEYS,
    ...variantKeys,
  ]);
  const common = {
    branchUuid: nonEmptyStringAt(payload['branchUuid'], '$.payload.branchUuid'),
    characterDraftId: nonEmptyStringAt(payload['characterDraftId'], '$.payload.characterDraftId'),
    draftRevision: revisionAt(payload['draftRevision'], '$.payload.draftRevision'),
    stage: 'STAT_ROLLS' as const,
    wizardCheckpointId: nonEmptyStringAt(
      payload['wizardCheckpointId'],
      '$.payload.wizardCheckpointId',
    ),
  };
  let normalizedPayload: CreationRollCommitPayload;
  if (sourceFormId === 'CHR-003') {
    normalizedPayload = {
      ...common,
      manualFacesOrNull: manualFacesAt(payload['manualFacesOrNull'], '$.payload.manualFacesOrNull'),
      setRollRequestId: nonEmptyStringAt(payload['setRollRequestId'], '$.payload.setRollRequestId'),
      sourceFormId,
    };
  } else {
    normalizedPayload = {
      ...common,
      confirmationRollRequestId: nonEmptyStringAt(
        payload['confirmationRollRequestId'],
        '$.payload.confirmationRollRequestId',
      ),
      criticalQueueIndex: indexAt(payload['criticalQueueIndex'], '$.payload.criticalQueueIndex'),
      manualFaceOrNull: manualFaceAt(payload['manualFaceOrNull'], '$.payload.manualFaceOrNull'),
      setRollReceiptId: nonEmptyStringAt(payload['setRollReceiptId'], '$.payload.setRollReceiptId'),
      sourceFormId,
    };
  }
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions: revisionsAt(request.expectedRevisions, '$.expectedRevisions'),
    messageType: 'command.request',
    payload: normalizedPayload,
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: CREATION_ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  };
}

export interface CreationRollCommitDependencies {
  readonly allocateRollRequestId: () => string;
  readonly sampleD20: () => number;
}

const guardRejected = (): never => {
  throw new CreationRollCommitApplicationError({ code: 'GUARD_REJECTED' });
};

const currentRevisions = (checkpoint: DurableCreationWizardCheckpoint): RevisionVector => ({
  actorVisibilityRevision: checkpoint.localCharacter.actorVisibilityRevision,
  projectionRevision: checkpoint.localCharacter.projectionRevision,
  stateRevision: checkpoint.localCharacter.stateRevision,
});

const incrementedRevisions = (revisions: RevisionVector): RevisionVector => {
  if (
    revisions.stateRevision === Number.MAX_SAFE_INTEGER ||
    revisions.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    return guardRejected();
  }
  return {
    actorVisibilityRevision: revisions.actorVisibilityRevision,
    projectionRevision: revisions.projectionRevision + 1,
    stateRevision: revisions.stateRevision + 1,
  };
};

const allRecords = (checkpoint: DurableCreationWizardCheckpoint) => [
  ...(checkpoint.raceAndMethodStage?.decisionRecords ?? []),
  ...(checkpoint.statRollStage?.attempts.flatMap((attempt) => [
    ...(attempt.setRecord === null ? [] : [attempt.setRecord]),
    ...attempt.confirmationRecords,
    ...(attempt.decisionRecordOrNull === null ? [] : [attempt.decisionRecordOrNull]),
  ]) ?? []),
];

const durableIds = (checkpoint: DurableCreationWizardCheckpoint): ReadonlySet<string> =>
  new Set(
    [
      checkpoint.localCharacter.localCharacterId,
      checkpoint.checkpoint.checkpointId,
      checkpoint.identityStage.request.commandId,
      checkpoint.identityStage.receipt.receiptId,
      checkpoint.statRollStage?.branchUuid,
      ...(checkpoint.statRollStage?.attempts.flatMap((attempt) => [
        attempt.setRollRequestId,
        attempt.setRecord?.receipt.receiptId,
        attempt.confirmationRollRequestIdOrNull,
      ]) ?? []),
      ...allRecords(checkpoint).flatMap(({ request, receipt }) => [
        request.commandId,
        receipt.receiptId,
      ]),
      ...(checkpoint.statRollStage?.attempts.flatMap((attempt) =>
        attempt.confirmationRecords.flatMap(({ receipt }) => [
          receipt.result.confirmationRollRequestId,
          receipt.result.nextConfirmationRollRequestIdOrNull,
        ]),
      ) ?? []),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

const assertCommitAllowed = (
  checkpoint: DurableCreationWizardCheckpoint,
  request: CreationRollCommitCommandRequest,
  receiptId?: string,
): { readonly attempt: StatRollAttempt; readonly stage: StatRollStage } => {
  const previous = [
    { request: checkpoint.identityStage.request, receipt: checkpoint.identityStage.receipt },
    ...allRecords(checkpoint),
  ];
  const duplicate = previous.find((record) => record.request.commandId === request.commandId);
  if (duplicate !== undefined) {
    if (!isDeepStrictEqual(duplicate.request, request)) {
      throw new CreationRollCommitApplicationError({
        code: 'IDEMPOTENCY_CONFLICT',
        commandId: request.commandId,
        detail: 'PAYLOAD_MISMATCH',
      });
    }
    return guardRejected();
  }
  const actual = currentRevisions(checkpoint);
  if (!isDeepStrictEqual(request.expectedRevisions, actual)) {
    throw new CreationRollCommitApplicationError({
      actual,
      code: 'STALE_REVISION',
      expected: request.expectedRevisions,
    });
  }
  const stage = checkpoint.statRollStage;
  const attempt = stage === null ? null : currentStatRollAttempt(stage);
  const occupied = durableIds(checkpoint);
  if (
    stage === null ||
    attempt === null ||
    request.payload.characterDraftId !== checkpoint.localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== checkpoint.checkpoint.checkpointId ||
    request.payload.draftRevision !== checkpoint.receipt.result.draftRevision ||
    request.payload.branchUuid !== stage.branchUuid ||
    request.payload.sourceFormId !== checkpoint.nextStageEnvelope.formId ||
    occupied.has(request.commandId) ||
    (receiptId !== undefined && (occupied.has(receiptId) || receiptId === request.commandId)) ||
    checkpoint.checkpoint.checkpointRevision === Number.MAX_SAFE_INTEGER ||
    checkpoint.receipt.result.draftRevision === Number.MAX_SAFE_INTEGER
  ) {
    return guardRejected();
  }
  const manual =
    request.payload.sourceFormId === 'CHR-003'
      ? request.payload.manualFacesOrNull
      : request.payload.manualFaceOrNull;
  if ((stage.diceInputModeSnapshot === 'AUTO') !== (manual === null)) return guardRejected();
  if (request.payload.sourceFormId === 'CHR-003') {
    if (
      attempt.state !== 'REQUEST_READY' ||
      attempt.setRecord !== null ||
      request.payload.setRollRequestId !== attempt.setRollRequestId
    ) {
      return guardRejected();
    }
  } else if (
    attempt.state !== 'CRITICALS_PENDING' ||
    attempt.setRecord === null ||
    request.payload.setRollReceiptId !== attempt.setRecord.receipt.receiptId ||
    request.payload.criticalQueueIndex !== attempt.criticalQueueIndexOrNull ||
    request.payload.confirmationRollRequestId !== attempt.confirmationRollRequestIdOrNull
  ) {
    return guardRejected();
  }
  incrementedRevisions(actual);
  return { attempt, stage };
};

const allocatedRequestId = (
  checkpoint: DurableCreationWizardCheckpoint,
  request: CreationRollCommitCommandRequest,
  receiptId: string,
  allocate: () => string,
): string => {
  const id = allocate();
  const occupied = new Set([...durableIds(checkpoint), request.commandId, receiptId]);
  if (typeof id !== 'string' || id.length === 0 || occupied.has(id)) return guardRejected();
  return id;
};

const sampledFace = (sample: () => number): number => {
  const face = sample();
  if (!Number.isSafeInteger(face) || face < 1 || face > 20) {
    throw new RangeError(`creation d20 sampler returned invalid face ${JSON.stringify(face)}`);
  }
  return face;
};

const nextEnvelope = <TFormId extends 'CHR-004' | 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008'>(
  formId: TFormId,
  characterDraftId: string,
): CreationNextStageEnvelope<TFormId> => ({
  formId,
  routeBindings: [{ parameterIndex: 0, source: 'inherited', value: characterDraftId }],
});

const currentChain = (attempt: StatRollAttempt): CreationStatCriticalChainState => {
  const index = attempt.criticalQueueIndexOrNull;
  if (index === null) return guardRejected();
  let chain = createCreationCriticalChain(
    attempt.naturalCriticalQueue[index]! as Parameters<typeof createCreationCriticalChain>[0],
  );
  for (const record of attempt.confirmationRecords) {
    if (record.receipt.result.criticalQueueIndex === index) {
      chain = commitCreationCriticalConfirmation(chain, {
        dieSides: 20,
        rawFace: record.receipt.result.confirmationFace,
      });
    }
  }
  if (chain.status !== 'PENDING_CONFIRMATION') return guardRejected();
  return chain;
};

export function preflightCreationRoll(
  database: Database.Database,
  request: DecodedCommandRequest,
): DurableCreationWizardCheckpoint {
  const normalized = normalizeCreationRollCommitRequest(request);
  const checkpoint = loadCreationWizardCheckpoint(database, normalized.payload.characterDraftId);
  assertCommitAllowed(checkpoint, normalized);
  return checkpoint;
}

export function commitCreationRoll(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  dependencies: CreationRollCommitDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(
      `creation roll receiptId must be non-empty, got ${JSON.stringify(receiptId)}`,
    );
  }
  const normalized = normalizeCreationRollCommitRequest(request);
  const preflight = loadCreationWizardCheckpoint(database, normalized.payload.characterDraftId);
  assertCommitAllowed(preflight, normalized, receiptId);
  const committed = commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const checkpoint = loadCreationWizardCheckpoint(
        database,
        normalized.payload.characterDraftId,
      );
      const { attempt, stage } = assertCommitAllowed(checkpoint, normalized, receiptId);
      const revisions = incrementedRevisions(currentRevisions(checkpoint));
      const checkpointRevision = checkpoint.checkpoint.checkpointRevision + 1;
      const draftRevision = checkpoint.receipt.result.draftRevision + 1;
      const allocateNextRequest = (): string =>
        allocatedRequestId(checkpoint, normalized, receiptId, dependencies.allocateRollRequestId);
      const manual =
        normalized.payload.sourceFormId === 'CHR-003'
          ? normalized.payload.manualFacesOrNull
          : normalized.payload.manualFaceOrNull;
      const takeFace = (index = 0): number =>
        manual === null
          ? sampledFace(dependencies.sampleD20)
          : typeof manual === 'number'
            ? manual
            : manual[index]!;
      let nextAttempt: StatRollAttempt;
      let receipt: CreationRollCommitReceipt;
      let destination: CreationNextStageEnvelope<
        'CHR-004' | 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008'
      >;
      if (normalized.payload.sourceFormId === 'CHR-003') {
        const set = resolveCreationStatSet(
          Array.from({ length: 7 }, (_, index) => ({ dieSides: 20, rawFace: takeFace(index) })),
        );
        const faces = set.faces.map(({ rawFace }) => rawFace);
        const queue = set.naturalCriticalQueue.map(({ originFace, setEntryIndex }) => ({
          originFace,
          setEntryIndex,
        }));
        const confirmationRollRequestIdOrNull = queue.length === 0 ? null : allocateNextRequest();
        const setDestination = nextEnvelope(
          queue.length === 0 ? attempt.returnDecisionFormId : 'CHR-004',
          normalized.payload.characterDraftId,
        );
        destination = setDestination;
        receipt = {
          commandId: normalized.commandId,
          receiptId,
          revisions,
          result: {
            branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
            branchUuid: stage.branchUuid,
            characterDraftId: normalized.payload.characterDraftId,
            checkpointId: normalized.payload.wizardCheckpointId,
            checkpointOwnerId: normalized.payload.characterDraftId,
            checkpointRevision,
            confirmationRollRequestIdOrNull,
            diceInputModeSnapshot: stage.diceInputModeSnapshot,
            draftRevision,
            faces,
            naturalCriticalQueue: queue,
            nextFormId: setDestination.formId,
            setRollReceiptId: receiptId,
            setRollRequestId: attempt.setRollRequestId,
            shownResultLocked: true,
            sourceFormId: 'CHR-003',
            stage: 'STAT_ROLLS',
          },
        };
        nextAttempt = {
          ...attempt,
          confirmationRollRequestIdOrNull,
          criticalQueueIndexOrNull: queue.length === 0 ? null : 0,
          naturalCriticalQueue: queue,
          setRecord: {
            nextStageEnvelope: setDestination,
            receipt: receipt as StatSetRollRecord['receipt'],
            request: normalized as StatSetRollRecord['request'],
          },
          state: queue.length === 0 ? 'DECISION_READY' : 'CRITICALS_PENDING',
        };
      } else {
        const setRecord = attempt.setRecord!;
        const index = attempt.criticalQueueIndexOrNull!;
        const item = attempt.naturalCriticalQueue[index]!;
        const face = takeFace();
        const chain = commitCreationCriticalConfirmation(currentChain(attempt), {
          dieSides: 20,
          rawFace: face,
        });
        const outcome: CreationCriticalOutcome | null =
          chain.status === 'TERMINAL' ? { ...chain.outcome } : null;
        const nextIndex =
          outcome === null
            ? index
            : index + 1 < attempt.naturalCriticalQueue.length
              ? index + 1
              : null;
        const nextRequest = nextIndex === null ? null : allocateNextRequest();
        const confirmationDestination = nextEnvelope(
          nextIndex === null ? attempt.returnDecisionFormId : 'CHR-004',
          normalized.payload.characterDraftId,
        );
        destination = confirmationDestination;
        receipt = {
          commandId: normalized.commandId,
          receiptId,
          revisions,
          result: {
            branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
            branchUuid: stage.branchUuid,
            characterDraftId: normalized.payload.characterDraftId,
            checkpointId: normalized.payload.wizardCheckpointId,
            checkpointOwnerId: normalized.payload.characterDraftId,
            checkpointRevision,
            confirmationFace: face,
            confirmationReceiptId: receiptId,
            confirmationRollRequestId: normalized.payload.confirmationRollRequestId,
            criticalQueueIndex: index,
            draftRevision,
            nextConfirmationRollRequestIdOrNull: nextRequest,
            nextFormId: confirmationDestination.formId,
            originFace: item.originFace,
            outcomeOrNull: outcome,
            returnDecisionFormId: attempt.returnDecisionFormId,
            setRollReceiptId: setRecord.receipt.receiptId,
            sourceFormId: 'CHR-004',
            stage: 'STAT_ROLLS',
          },
        };
        nextAttempt = {
          ...attempt,
          confirmationRecords: [
            ...attempt.confirmationRecords,
            {
              nextStageEnvelope: confirmationDestination,
              receipt: receipt as CriticalConfirmationRollRecord['receipt'],
              request: normalized as CriticalConfirmationRollRecord['request'],
            },
          ],
          confirmationRollRequestIdOrNull: nextRequest,
          criticalQueueIndexOrNull: nextIndex ?? index,
          outcomes: outcome === null ? attempt.outcomes : [...attempt.outcomes, outcome],
          state: nextIndex === null ? 'CHAIN_COMPLETE' : 'CRITICALS_PENDING',
        };
      }
      const lock = checkpoint.raceAndMethodStage!;
      const payload = {
        branchCacheEntries: [],
        branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
        identityStage: checkpoint.identityStage,
        nextStageEnvelope: destination,
        raceAndMethodStage: {
          ...lock,
          diceInput: { ...lock.diceInput!, choiceLockStatus: 'LOCKED_AFTER_RESULT' as const },
          statMethod: { ...lock.statMethod!, choiceLockStatus: 'LOCKED_AFTER_RESULT' as const },
          symbiontAcquisition:
            lock.symbiontAcquisition.choiceLockStatus === 'NOT_APPLICABLE'
              ? lock.symbiontAcquisition
              : { ...lock.symbiontAcquisition, choiceLockStatus: 'LOCKED_AFTER_RESULT' as const },
        },
        randomReceiptIds:
          stage.diceInputModeSnapshot === 'AUTO'
            ? [...checkpoint.durablePayload.randomReceiptIds, receiptId]
            : checkpoint.durablePayload.randomReceiptIds,
        receipt,
        selectedBranchUuidOrNull: null,
        statRollStage: {
          ...stage,
          attempts: stage.attempts.map((stored) =>
            stored.attemptIndex === attempt.attemptIndex ? nextAttempt : stored,
          ),
        },
      };
      return update(
        { payloadJson: JSON.stringify(payload) },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
    },
  );
  return validateDurableCreationWizardCheckpoint(committed.result, committed.checkpoint);
}
