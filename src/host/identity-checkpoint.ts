import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';
import { decodeClientMessage } from '@shared/wire-codec.js';
import type {
  ClientToHostMessage,
  CommandReceipt,
  CommandRefusal,
  JsonObject,
  JsonValue,
  ProtocolVocabulary,
  RevisionVector,
  WorkflowCommandId,
  WorkflowCommandRequestMessage,
} from '@shared/wire-protocol.js';
import type {
  IdentityDraftArtValue,
  IdentityDraftSex,
  IdentityDraftValues,
} from '@shared/wire-v3-protocol.js';

import {
  commitNewLocalCharacterCheckpoint,
  listLocalCharacters,
  loadLocalCharacterCheckpoint,
  readLocalCharacter,
} from '../persistence/index.js';
import type { LocalCharacter, LocalCharacterCheckpoint } from '../persistence/index.js';
import { canonicalizeIdentityDraftValues } from './identity-draft.js';

export const IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID =
  'UI-CMD-CHAR-WIZARD-CHECKPOINT' as const satisfies WorkflowCommandId;
export const EMPTY_IDENTITY_BRANCH_CACHE_HASH =
  '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' as const;

const IDENTITY_PAYLOAD_KEYS = [
  'stage',
  'characterDraftId',
  'wizardCheckpointId',
  'draftRevision',
  'name',
  'description',
  'artAssetKeyOrLocalFile',
  'age',
  'sex',
  'massKg',
] as const;
const DURABLE_PAYLOAD_KEYS = [
  'lastCompleteStage',
  'branchCacheEntries',
  'selectedBranchUuidOrNull',
  'randomReceiptIds',
  'branchCacheHash',
  'nextStageEnvelope',
  'receipt',
] as const;
const ZERO_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;
const PORTRAIT_ASSET_KEYS = new Set<string>(LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS);

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;

export type IdentityCheckpointPayload = JsonObject & {
  readonly stage: 'IDENTITY';
  readonly characterDraftId: string;
  readonly wizardCheckpointId: string;
  readonly draftRevision: number;
  readonly name: string;
  readonly description: string | null;
  readonly artAssetKeyOrLocalFile: IdentityDraftArtValue;
  readonly age: number;
  readonly sex: IdentityDraftSex;
  readonly massKg: number;
};

export type IdentityCheckpointCommandRequest = WorkflowCommandRequestMessage<
  typeof IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  IdentityCheckpointPayload
>;

export type IdentityCheckpointReceiptResult = JsonObject & {
  readonly stage: 'IDENTITY';
  readonly characterDraftId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointId: string;
  readonly checkpointRevision: 0;
  readonly draftRevision: number;
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly nextFormId: 'CHR-010';
};

export type IdentityCheckpointReceipt = CommandReceipt<IdentityCheckpointReceiptResult>;

export interface IdentityCheckpointDurablePayload {
  readonly lastCompleteStage: {
    readonly request: IdentityCheckpointCommandRequest;
    readonly derived: {
      readonly massApprovalStatus: 'PENDING_GM';
      readonly anatomyProfile: 'STANDARD_HUMANOID';
    };
  };
  readonly branchCacheEntries: readonly [];
  readonly selectedBranchUuidOrNull: null;
  readonly randomReceiptIds: readonly [];
  readonly branchCacheHash: typeof EMPTY_IDENTITY_BRANCH_CACHE_HASH;
  readonly nextStageEnvelope: {
    readonly formId: 'CHR-010';
    readonly routeBindings: readonly [
      {
        readonly parameterIndex: 0;
        readonly source: 'inherited';
        readonly value: string;
      },
    ];
  };
  readonly receipt: IdentityCheckpointReceipt;
}

export interface DurableIdentityCheckpoint {
  readonly checkpoint: LocalCharacterCheckpoint;
  readonly durablePayload: IdentityCheckpointDurablePayload;
  readonly localCharacter: LocalCharacter;
  readonly receipt: IdentityCheckpointReceipt;
  readonly request: IdentityCheckpointCommandRequest;
}

export class IdentityCheckpointApplicationError extends Error {
  constructor(readonly refusal: CommandRefusal) {
    super(`identity checkpoint request refused: ${JSON.stringify(refusal)}`);
  }
}

const typeName = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

const invalidShape = (path: string, expected: string, value: unknown): never => {
  throw new IdentityCheckpointApplicationError({
    actualType: typeName(value),
    code: 'INVALID_SHAPE',
    expected,
    path,
  });
};

const unrecognized = (path: string, value: JsonValue): never => {
  throw new IdentityCheckpointApplicationError({ code: 'UNRECOGNIZED', path, value });
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

const finiteNumberAt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalidShape(path, 'finite number', value);
  }
  return Object.is(value, -0) ? 0 : value;
};

const revisionAt = (value: unknown, path: string): number => {
  const number = finiteNumberAt(value, path);
  if (!Number.isSafeInteger(number) || number < 0) {
    return invalidShape(path, 'non-negative safe integer', value);
  }
  return Object.is(number, -0) ? 0 : number;
};

const emptyArrayAt = (value: unknown, path: string): readonly [] => {
  if (!Array.isArray(value)) return invalidShape(path, 'array', value);
  if (value.length !== 0) return unrecognized(path, value as JsonValue);
  return [];
};

const literal = <T extends JsonValue>(value: unknown, expected: T, path: string): T => {
  if (!isDeepStrictEqual(value, expected)) {
    if (value === undefined) return invalidShape(path, 'required field', value);
    return unrecognized(path, value as JsonValue);
  }
  return expected;
};

const artValueAt = (value: unknown, path: string): IdentityDraftArtValue => {
  if (value === null) return null;
  const candidate = objectAt(value, path);
  const kind = stringAt(candidate['kind'], `${path}.kind`);
  if (kind === 'asset-key') {
    const object = exactObject(value, path, ['assetKey', 'kind']);
    return { assetKey: stringAt(object['assetKey'], `${path}.assetKey`), kind: 'asset-key' };
  }
  if (kind === 'local-file') {
    const object = exactObject(value, path, ['bytesBase64', 'kind', 'mediaType']);
    const mediaType = stringAt(object['mediaType'], `${path}.mediaType`);
    if (mediaType !== 'image/jpeg' && mediaType !== 'image/png') {
      return unrecognized(`${path}.mediaType`, mediaType);
    }
    return {
      bytesBase64: stringAt(object['bytesBase64'], `${path}.bytesBase64`),
      kind: 'local-file',
      mediaType,
    };
  }
  return unrecognized(`${path}.kind`, kind);
};

const identityValuesFrom = (payload: Record<string, unknown>): IdentityDraftValues => {
  const descriptionValue = payload['description'];
  const description =
    descriptionValue === null ? null : stringAt(descriptionValue, '$.payload.description');
  const sexValue = stringAt(payload['sex'], '$.payload.sex');
  if (sexValue !== 'FEMALE' && sexValue !== 'MALE') {
    return unrecognized('$.payload.sex', sexValue);
  }
  return {
    age: finiteNumberAt(payload['age'], '$.payload.age'),
    artAssetKeyOrLocalFile: artValueAt(
      payload['artAssetKeyOrLocalFile'],
      '$.payload.artAssetKeyOrLocalFile',
    ),
    description,
    massKg: finiteNumberAt(payload['massKg'], '$.payload.massKg'),
    name: stringAt(payload['name'], '$.payload.name'),
    sex: sexValue,
  };
};

export function normalizeIdentityCheckpointRequest(
  request: DecodedCommandRequest,
): IdentityCheckpointCommandRequest {
  if (request.commandKind !== 'workflow-command') {
    return unrecognized('$.commandKind', request.commandKind);
  }
  if (request.workflowCommandId !== IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID) {
    return unrecognized('$.workflowCommandId', request.workflowCommandId);
  }
  if (request.role !== 'player') return unrecognized('$.role', request.role);
  const payload = exactObject(request.payload, '$.payload', IDENTITY_PAYLOAD_KEYS);
  literal(payload['stage'], 'IDENTITY', '$.payload.stage');
  const values = identityValuesFrom(payload);
  return {
    commandId: request.commandId,
    commandKind: 'workflow-command',
    expectedRevisions: {
      actorVisibilityRevision: revisionAt(
        request.expectedRevisions.actorVisibilityRevision,
        '$.expectedRevisions.actorVisibilityRevision',
      ),
      projectionRevision: revisionAt(
        request.expectedRevisions.projectionRevision,
        '$.expectedRevisions.projectionRevision',
      ),
      stateRevision: revisionAt(
        request.expectedRevisions.stateRevision,
        '$.expectedRevisions.stateRevision',
      ),
    },
    messageType: 'command.request',
    payload: {
      age: values.age!,
      artAssetKeyOrLocalFile: values.artAssetKeyOrLocalFile,
      characterDraftId: stringAt(payload['characterDraftId'], '$.payload.characterDraftId'),
      description: values.description,
      draftRevision: revisionAt(payload['draftRevision'], '$.payload.draftRevision'),
      massKg: values.massKg!,
      name: values.name!,
      sex: values.sex!,
      stage: 'IDENTITY',
      wizardCheckpointId: stringAt(payload['wizardCheckpointId'], '$.payload.wizardCheckpointId'),
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  };
}

export function validateIdentityCheckpointRequest(
  request: IdentityCheckpointCommandRequest,
): IdentityCheckpointCommandRequest {
  const values: IdentityDraftValues = {
    age: request.payload.age,
    artAssetKeyOrLocalFile: request.payload.artAssetKeyOrLocalFile,
    description: request.payload.description,
    massKg: request.payload.massKg,
    name: request.payload.name,
    sex: request.payload.sex,
  };
  const canonical = canonicalizeIdentityDraftValues(values, PORTRAIT_ASSET_KEYS);
  if (
    !canonical.ok ||
    !isDeepStrictEqual(values, canonical.value) ||
    canonical.value.name === null ||
    canonical.value.age === null ||
    canonical.value.sex === null ||
    canonical.value.massKg === null
  ) {
    throw new IdentityCheckpointApplicationError({ code: 'GUARD_REJECTED' });
  }
  return {
    ...request,
    payload: {
      ...request.payload,
      age: canonical.value.age,
      artAssetKeyOrLocalFile: canonical.value.artAssetKeyOrLocalFile,
      description: canonical.value.description,
      massKg: canonical.value.massKg,
      name: canonical.value.name,
      sex: canonical.value.sex,
    },
  };
}

const STORED_REQUEST_VOCABULARY: ProtocolVocabulary = {
  isFormId: (_value): _value is never => false,
  isHostTransition: () => false,
  isWorkflowCommandId: (value): value is WorkflowCommandId =>
    value === IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
};

const storedRequestAt = (value: unknown, label: string): IdentityCheckpointCommandRequest => {
  let source: string;
  try {
    source = JSON.stringify(value);
  } catch (cause) {
    throw new Error(`${label} request cannot be encoded as JSON`, { cause });
  }
  const decoded = decodeClientMessage(source, STORED_REQUEST_VOCABULARY);
  if (!decoded.ok) {
    throw new Error(
      `${label} request is not a valid wire v1 command: ${JSON.stringify(decoded.refusal)}`,
    );
  }
  if (decoded.value.messageType !== 'command.request') {
    throw new Error(`${label} request is not a command.request`);
  }
  try {
    return validateIdentityCheckpointRequest(normalizeIdentityCheckpointRequest(decoded.value));
  } catch (cause) {
    if (cause instanceof IdentityCheckpointApplicationError) {
      throw new Error(`${label} request violates the identity checkpoint contract`, { cause });
    }
    throw cause;
  }
};

const revisionsAt = (value: unknown, path: string): RevisionVector => {
  const object = exactObject(value, path, [
    'actorVisibilityRevision',
    'projectionRevision',
    'stateRevision',
  ]);
  return {
    actorVisibilityRevision: revisionAt(
      object['actorVisibilityRevision'],
      `${path}.actorVisibilityRevision`,
    ),
    projectionRevision: revisionAt(object['projectionRevision'], `${path}.projectionRevision`),
    stateRevision: revisionAt(object['stateRevision'], `${path}.stateRevision`),
  };
};

const receiptAt = (value: unknown, label: string): IdentityCheckpointReceipt => {
  const path = '$.receipt';
  const object = exactObject(value, path, ['commandId', 'receiptId', 'result', 'revisions']);
  const resultPath = `${path}.result`;
  const result = exactObject(object['result'], resultPath, [
    'stage',
    'characterDraftId',
    'checkpointOwnerId',
    'checkpointId',
    'checkpointRevision',
    'draftRevision',
    'branchCacheHash',
    'nextFormId',
  ]);
  try {
    return {
      commandId: stringAt(object['commandId'], `${path}.commandId`),
      receiptId: nonEmptyStringAt(object['receiptId'], `${path}.receiptId`),
      result: {
        branchCacheHash: literal(
          result['branchCacheHash'],
          EMPTY_IDENTITY_BRANCH_CACHE_HASH,
          `${resultPath}.branchCacheHash`,
        ),
        characterDraftId: stringAt(result['characterDraftId'], `${resultPath}.characterDraftId`),
        checkpointId: stringAt(result['checkpointId'], `${resultPath}.checkpointId`),
        checkpointOwnerId: stringAt(result['checkpointOwnerId'], `${resultPath}.checkpointOwnerId`),
        checkpointRevision: literal(
          result['checkpointRevision'],
          0,
          `${resultPath}.checkpointRevision`,
        ),
        draftRevision: revisionAt(result['draftRevision'], `${resultPath}.draftRevision`),
        nextFormId: literal(result['nextFormId'], 'CHR-010', `${resultPath}.nextFormId`),
        stage: literal(result['stage'], 'IDENTITY', `${resultPath}.stage`),
      },
      revisions: revisionsAt(object['revisions'], `${path}.revisions`),
    };
  } catch (cause) {
    if (cause instanceof IdentityCheckpointApplicationError) {
      throw new Error(`${label} receipt violates the durable identity contract`, { cause });
    }
    throw cause;
  }
};

const durablePayloadAt = (value: unknown, label: string): IdentityCheckpointDurablePayload => {
  try {
    const object = exactObject(value, '$', DURABLE_PAYLOAD_KEYS);
    const lastCompleteStage = exactObject(object['lastCompleteStage'], '$.lastCompleteStage', [
      'request',
      'derived',
    ]);
    const derived = exactObject(lastCompleteStage['derived'], '$.lastCompleteStage.derived', [
      'massApprovalStatus',
      'anatomyProfile',
    ]);
    const nextStageEnvelope = exactObject(object['nextStageEnvelope'], '$.nextStageEnvelope', [
      'formId',
      'routeBindings',
    ]);
    const bindings = nextStageEnvelope['routeBindings'];
    if (!Array.isArray(bindings)) {
      return invalidShape('$.nextStageEnvelope.routeBindings', 'array', bindings);
    }
    if (bindings.length !== 1) {
      return unrecognized('$.nextStageEnvelope.routeBindings', bindings as JsonValue);
    }
    const binding = exactObject(bindings[0], '$.nextStageEnvelope.routeBindings[0]', [
      'parameterIndex',
      'source',
      'value',
    ]);
    const request = storedRequestAt(lastCompleteStage['request'], label);
    const receipt = receiptAt(object['receipt'], label);
    return {
      branchCacheEntries: emptyArrayAt(object['branchCacheEntries'], '$.branchCacheEntries'),
      branchCacheHash: literal(
        object['branchCacheHash'],
        EMPTY_IDENTITY_BRANCH_CACHE_HASH,
        '$.branchCacheHash',
      ),
      lastCompleteStage: {
        derived: {
          anatomyProfile: literal(
            derived['anatomyProfile'],
            'STANDARD_HUMANOID',
            '$.lastCompleteStage.derived.anatomyProfile',
          ),
          massApprovalStatus: literal(
            derived['massApprovalStatus'],
            'PENDING_GM',
            '$.lastCompleteStage.derived.massApprovalStatus',
          ),
        },
        request,
      },
      nextStageEnvelope: {
        formId: literal(nextStageEnvelope['formId'], 'CHR-010', '$.nextStageEnvelope.formId'),
        routeBindings: [
          {
            parameterIndex: literal(
              binding['parameterIndex'],
              0,
              '$.nextStageEnvelope.routeBindings[0].parameterIndex',
            ),
            source: literal(
              binding['source'],
              'inherited',
              '$.nextStageEnvelope.routeBindings[0].source',
            ),
            value: stringAt(binding['value'], '$.nextStageEnvelope.routeBindings[0].value'),
          },
        ],
      },
      randomReceiptIds: emptyArrayAt(object['randomReceiptIds'], '$.randomReceiptIds'),
      receipt,
      selectedBranchUuidOrNull: literal(
        object['selectedBranchUuidOrNull'],
        null,
        '$.selectedBranchUuidOrNull',
      ),
    };
  } catch (cause) {
    if (cause instanceof IdentityCheckpointApplicationError) {
      throw new Error(`${label} payload violates the durable identity contract`, { cause });
    }
    throw cause;
  }
};

export const validateDurableIdentityCheckpoint = (
  localCharacter: LocalCharacter,
  checkpoint: LocalCharacterCheckpoint,
): DurableIdentityCheckpoint => {
  const label = `localCharacter ${JSON.stringify(localCharacter.localCharacterId)}`;
  let value: unknown;
  try {
    value = JSON.parse(localCharacter.payloadJson) as unknown;
  } catch (cause) {
    throw new Error(`${label} payload is not valid JSON`, { cause });
  }
  const durablePayload = durablePayloadAt(value, label);
  const { request } = durablePayload.lastCompleteStage;
  const { receipt } = durablePayload;
  const { result } = receipt;
  const mismatches: string[] = [];
  if (localCharacter.lifecycleState !== 'DRAFT') mismatches.push('lifecycleState');
  if (checkpoint.localCharacterId !== localCharacter.localCharacterId) {
    mismatches.push('checkpoint.localCharacterId');
  }
  if (checkpoint.checkpointId === localCharacter.localCharacterId) {
    mismatches.push('checkpoint/character ID collision');
  }
  if (request.commandId !== receipt.commandId) mismatches.push('request/receipt commandId');
  if (request.payload.characterDraftId !== localCharacter.localCharacterId) {
    mismatches.push('request characterDraftId');
  }
  if (request.payload.characterDraftId !== result.characterDraftId) {
    mismatches.push('receipt characterDraftId');
  }
  if (result.checkpointOwnerId !== localCharacter.localCharacterId) {
    mismatches.push('checkpointOwnerId');
  }
  if (request.payload.wizardCheckpointId !== checkpoint.checkpointId) {
    mismatches.push('request wizardCheckpointId');
  }
  if (result.checkpointId !== checkpoint.checkpointId) mismatches.push('receipt checkpointId');
  if (request.payload.draftRevision !== result.draftRevision) mismatches.push('draftRevision');
  if (result.checkpointRevision !== checkpoint.checkpointRevision) {
    mismatches.push('checkpointRevision');
  }
  if (durablePayload.branchCacheHash !== receipt.result.branchCacheHash) {
    mismatches.push('branchCacheHash');
  }
  if (durablePayload.nextStageEnvelope.formId !== receipt.result.nextFormId) {
    mismatches.push('next form');
  }
  if (durablePayload.nextStageEnvelope.routeBindings[0].value !== localCharacter.localCharacterId) {
    mismatches.push('next route binding');
  }
  const checkpointRevisions = {
    actorVisibilityRevision: checkpoint.actorVisibilityRevision,
    projectionRevision: checkpoint.projectionRevision,
    stateRevision: checkpoint.stateRevision,
  };
  if (!isDeepStrictEqual(receipt.revisions, checkpointRevisions)) {
    mismatches.push('receipt/checkpoint revisions');
  }
  const localCharacterRevisions = {
    actorVisibilityRevision: localCharacter.actorVisibilityRevision,
    projectionRevision: localCharacter.projectionRevision,
    stateRevision: localCharacter.stateRevision,
  };
  if (!isDeepStrictEqual(receipt.revisions, ZERO_REVISIONS)) {
    mismatches.push('receipt revisions are not the initial zero vector');
  }
  if (!isDeepStrictEqual(checkpointRevisions, ZERO_REVISIONS)) {
    mismatches.push('checkpoint revisions are not the initial zero vector');
  }
  if (!isDeepStrictEqual(localCharacterRevisions, ZERO_REVISIONS)) {
    mismatches.push('localCharacter revisions are not the initial zero vector');
  }
  if (mismatches.length > 0) {
    throw new Error(`${label} durable identity checkpoint mismatch: ${mismatches.join(', ')}`);
  }
  return { checkpoint, durablePayload, localCharacter, receipt, request };
};

export function commitIdentityCheckpoint(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
): DurableIdentityCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(
      `identity checkpoint receiptId must be a non-empty string, got ${JSON.stringify(receiptId)}`,
    );
  }
  const normalized = validateIdentityCheckpointRequest(normalizeIdentityCheckpointRequest(request));
  const { characterDraftId, wizardCheckpointId, draftRevision } = normalized.payload;
  const receipt: IdentityCheckpointReceipt = {
    commandId: normalized.commandId,
    receiptId,
    result: {
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      characterDraftId,
      checkpointId: wizardCheckpointId,
      checkpointOwnerId: characterDraftId,
      checkpointRevision: 0,
      draftRevision,
      nextFormId: 'CHR-010',
      stage: 'IDENTITY',
    },
    revisions: ZERO_REVISIONS,
  };
  const durablePayload: IdentityCheckpointDurablePayload = {
    branchCacheEntries: [],
    branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
    lastCompleteStage: {
      derived: {
        anatomyProfile: 'STANDARD_HUMANOID',
        massApprovalStatus: 'PENDING_GM',
      },
      request: normalized,
    },
    nextStageEnvelope: {
      formId: 'CHR-010',
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: characterDraftId }],
    },
    randomReceiptIds: [],
    receipt,
    selectedBranchUuidOrNull: null,
  };
  const committed = commitNewLocalCharacterCheckpoint(
    database,
    characterDraftId,
    wizardCheckpointId,
    (create) => create('DRAFT', JSON.stringify(durablePayload)),
  );
  return validateDurableIdentityCheckpoint(committed.result, committed.checkpoint);
}

export function loadIdentityCheckpoint(
  database: Database.Database,
  localCharacterId: string,
): DurableIdentityCheckpoint {
  return validateDurableIdentityCheckpoint(
    readLocalCharacter(database, localCharacterId),
    loadLocalCharacterCheckpoint(database, localCharacterId),
  );
}

const durableCommandId = (payloadJson: string): string | null => {
  const payload = JSON.parse(payloadJson) as unknown;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const lastCompleteStage = (payload as Record<string, unknown>)['lastCompleteStage'];
  if (
    lastCompleteStage === null ||
    typeof lastCompleteStage !== 'object' ||
    Array.isArray(lastCompleteStage)
  ) {
    return null;
  }
  const request = (lastCompleteStage as Record<string, unknown>)['request'];
  if (request === null || typeof request !== 'object' || Array.isArray(request)) return null;
  const commandId = (request as Record<string, unknown>)['commandId'];
  return typeof commandId === 'string' ? commandId : null;
};

export function loadIdentityCheckpointByCommandId(
  database: Database.Database,
  commandId: string,
): DurableIdentityCheckpoint | null {
  const matches = listLocalCharacters(database).filter(
    (localCharacter) => durableCommandId(localCharacter.payloadJson) === commandId,
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new Error(
      `durable identity commandId ${JSON.stringify(commandId)} is duplicated by local characters: ${matches.map(({ localCharacterId }) => JSON.stringify(localCharacterId)).join(', ')}`,
    );
  }
  return loadIdentityCheckpoint(database, matches[0]!.localCharacterId);
}
