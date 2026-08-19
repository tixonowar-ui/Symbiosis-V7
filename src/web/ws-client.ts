import { FORM_IDS } from '@generated/types/atlas.js';
import type { ActionKey, FormId } from '@generated/types/atlas.js';
import {
  decodeHostMessage,
  decodeHostMessageV2,
  decodeHostMessageV3,
  encodeClientMessage,
  encodeClientMessageV2,
  encodeClientMessageV3,
  WIRE_PROTOCOL_VERSION,
  WIRE_PROTOCOL_V2_VERSION,
  WIRE_PROTOCOL_V3_VERSION,
} from '@shared/index.js';
import type {
  AddressableRouteTemplate,
  CommandReceipt,
  CommandRefusalMessage,
  DecodeRefusal,
  DecodeResult,
  FormActionIntentV2Message,
  FormActionRefusalV2Message,
  HostToClientMessage,
  IdentityDraftValues,
  JsonObject,
  JsonValue,
  ProjectionSnapshotV2Message,
  ProtocolRefusalMessage,
  ProtocolVocabulary,
  RevisionVector,
  SessionReconnectCapabilitiesV2Message,
  SessionReconnectV2Message,
  WireV3Vocabulary,
  WorkflowCommandRequestMessage,
  WorkflowCommandId,
} from '@shared/index.js';

import { isImplementedFormActionKey, presentedFormDefinition } from './forms/index.js';
import type { SupportedPresentationFormId } from './forms/index.js';
import {
  IdentityDraftClient,
  type IdentityDraftClientState,
  type IdentityDraftSnapshot,
} from './identity-draft-client.js';

export type { IdentityDraftClientState, IdentityDraftValues };

const FORM_ID_SET: ReadonlySet<string> = new Set(FORM_IDS);

const INHERITED_CHARACTER_WIZARD_FORM_IDS: ReadonlySet<FormId> = new Set([
  'CHR-002',
  'CHR-003',
  'CHR-004',
  'CHR-005',
  'CHR-006',
  'CHR-007',
  'CHR-008',
  'CHR-010',
  'CHR-016',
  'CHR-036',
]);

/**
 * These presentation shapes are the exact implemented slice. Addressable
 * routes remain out of scope and therefore fail closed.
 */
export const WEB_PROTOCOL_VOCABULARY: ProtocolVocabulary & WireV3Vocabulary = {
  isAddressableRouteTemplate: (_value): _value is AddressableRouteTemplate => false,
  isClientRouteBindings: () => false,
  isFormActionKey: isImplementedFormActionKey,
  isFormId: (value): value is FormId => FORM_ID_SET.has(value),
  isHostTransition: () => false,
  isPresentedForm: (formId, formType, routeTemplate, bindings) => {
    const definition = presentedFormDefinition(formId);
    if (definition === null || formType !== definition.type || routeTemplate !== definition.route)
      return false;
    if (formId !== 'CHR-001' && !INHERITED_CHARACTER_WIZARD_FORM_IDS.has(formId)) {
      return bindings.length === 0;
    }
    const binding = bindings[0];
    return (
      bindings.length === 1 &&
      binding !== undefined &&
      binding.parameterIndex === 0 &&
      binding.source === (formId === 'CHR-001' ? 'executor-allocated' : 'inherited') &&
      UUID_PATTERN.test(binding.value)
    );
  },
  isWorkflowCommandId: (value): value is WorkflowCommandId =>
    value === IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID ||
    value === SET_DECIDE_WORKFLOW_COMMAND_ID ||
    value === ROLL_COMMIT_WORKFLOW_COMMAND_ID,
};

const NO_KNOWN_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;
const DEVICE_ID_KEYS = new Set(['deviceId']);
const DEVICE_ID_ERROR_KEYS = new Set(['error']);
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-WIZARD-CHECKPOINT' as const;
const SET_DECIDE_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-CREATION-SET-DECIDE' as const;
const ROLL_COMMIT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-CREATION-ROLL-COMMIT' as const;
const IDENTITY_CHECKPOINT_ACTION_KEY = 'CHR-001::CTA::001' as const;
const CHR_010_INITIAL_ACTION_KEYS = [
  'CHR-010::CTA::004',
  'CHR-010::CTA::005',
  'CHR-010::CTA::006',
] as const satisfies readonly ActionKey[];
const CHR_016_INITIAL_ACTION_KEYS = [
  'CHR-016::CTA::003',
  'CHR-016::CTA::004',
] as const satisfies readonly ActionKey[];
const CHR_036_INITIAL_ACTION_KEYS = [
  'CHR-036::CTA::004',
  'CHR-036::CTA::005',
] as const satisfies readonly ActionKey[];
const CHR_002_INITIAL_ACTION_KEYS = [
  'CHR-002::CTA::003',
  'CHR-002::CTA::004',
  'CHR-002::CTA::005',
] as const satisfies readonly ActionKey[];
const CHR_003_ROLL_COMMIT_ACTION_KEY = 'CHR-003::CTA::002' as const;
const CHR_004_ROLL_COMMIT_ACTION_KEY = 'CHR-004::CTA::001' as const;
const CHR_003_PENDING_ACTION_KEYS = [
  CHR_003_ROLL_COMMIT_ACTION_KEY,
] as const satisfies readonly ActionKey[];
const CHR_004_PENDING_ACTION_KEYS = [
  CHR_004_ROLL_COMMIT_ACTION_KEY,
] as const satisfies readonly ActionKey[];
const CREATION_SET_DECISION_FORM_IDS = ['CHR-005', 'CHR-006', 'CHR-007', 'CHR-008'] as const;
type CreationSetDecisionFormId = (typeof CREATION_SET_DECISION_FORM_IDS)[number];
const CREATION_SET_DECISION_FORM_ID_SET: ReadonlySet<string> = new Set(
  CREATION_SET_DECISION_FORM_IDS,
);
const CHR_028_ACTION_KEYS = [
  'CHR-028::CTA::001',
  'CHR-028::CTA::002',
] as const satisfies readonly ActionKey[];
/** ADR 0043 section 2 and Atlas CTA keys; validation only, never host mechanics authority. */
const CREATION_SET_DECISION_FORMS = {
  'CHR-005': {
    acceptActionKey: 'CHR-005::CTA::001',
    alternateActionKey: 'CHR-005::CTA::002',
    alternateDecision: 'USE_POINT_BUY_90',
    attempt: 1,
    method: 'CLASSIC',
    receiptKey: 'acceptedSetReceiptId',
    transitionKind: 'CLASSIC_TO_90',
  },
  'CHR-006': {
    acceptActionKey: 'CHR-006::CTA::001',
    alternateActionKey: 'CHR-006::CTA::002',
    alternateDecision: 'GO_ATTEMPT_2',
    attempt: 1,
    method: 'ADVENTUROUS',
    receiptKey: 'setReceiptId',
    transitionKind: 'ADVENTUROUS_TO_SECOND',
  },
  'CHR-007': {
    acceptActionKey: 'CHR-007::CTA::001',
    alternateActionKey: 'CHR-007::CTA::002',
    alternateDecision: 'USE_POINT_BUY_85',
    attempt: 2,
    method: 'ADVENTUROUS',
    receiptKey: 'setReceiptId',
    transitionKind: 'ADVENTUROUS_TO_85',
  },
  'CHR-008': {
    acceptActionKey: 'CHR-008::CTA::001',
    alternateActionKey: 'CHR-008::CTA::002',
    alternateDecision: 'GO_NEXT_ATTEMPT',
    attempt: null,
    method: 'ALL_OR_NOTHING',
    receiptKey: 'setReceiptId',
    transitionKind: 'ALL_OR_NOTHING_NEXT',
  },
} as const satisfies Readonly<
  Record<
    CreationSetDecisionFormId,
    {
      readonly acceptActionKey: ActionKey;
      readonly alternateActionKey: ActionKey;
      readonly alternateDecision:
        'GO_ATTEMPT_2' | 'GO_NEXT_ATTEMPT' | 'USE_POINT_BUY_85' | 'USE_POINT_BUY_90';
      readonly attempt: 1 | 2 | null;
      readonly method: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
      readonly receiptKey: 'acceptedSetReceiptId' | 'setReceiptId';
      readonly transitionKind:
        'ADVENTUROUS_TO_85' | 'ADVENTUROUS_TO_SECOND' | 'ALL_OR_NOTHING_NEXT' | 'CLASSIC_TO_90';
    }
  >
>;
const NO_ACTION_KEYS = [] as const satisfies readonly ActionKey[];
const EMPTY_BRANCH_CACHE_HASH = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';

/**
 * Sources: generated/spec/atlas/forms-by-id.json["APP-001"].requiredFields
 * for the four host-owned values (`formId` is the projection identity), and
 * generated/spec/atlas/forms-by-id.json["APP-001"].guardStates for
 * `bootState=BOOTING|READY|ERROR`.
 */
const APP_001_KEYS = new Set([
  'baselineCompatibility',
  'bootState',
  'buildVersion',
  'formId',
  'integrityStatus',
]);
const APP_001_BOOT_STATES: ReadonlySet<string> = new Set(['BOOTING', 'READY', 'ERROR']);
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const BASELINE_COMPATIBILITY_KEYS = new Set([
  'builtAgainstTuple',
  'catalogVersion',
  'registryVersion',
]);
const BASELINE_VALUE_KEYS = new Set(['status', 'value']);
const INTEGRITY_STATUS_KEYS = new Set(['changed', 'missing', 'ok', 'tracked', 'untracked']);

export interface BaselineValue extends JsonObject {
  readonly status: 'PASS';
  readonly value: string;
}

export interface BaselineCompatibility extends JsonObject {
  readonly builtAgainstTuple: BaselineValue;
  readonly catalogVersion: BaselineValue;
  readonly registryVersion: BaselineValue;
}

export interface IntegrityStatus extends JsonObject {
  readonly changed: readonly string[];
  readonly missing: readonly string[];
  readonly ok: boolean;
  readonly tracked: number;
  readonly untracked: readonly string[];
}

export interface App001Projection extends JsonObject {
  readonly baselineCompatibility: BaselineCompatibility;
  readonly bootState: 'BOOTING' | 'ERROR' | 'READY';
  readonly buildVersion: string;
  readonly formId: 'APP-001';
  readonly integrityStatus: IntegrityStatus;
}

export interface App004Projection extends JsonObject {
  readonly campaignAuthority: false;
  readonly draftCharacterIds: readonly string[];
  readonly finalCharacterIds: readonly string[];
  readonly handoffIdOrNull: null;
  readonly handoffReceiptIdOrNull: null;
  readonly launchContext: 'PLAYER_MENU';
  readonly localCharacterLibraryRevision: number;
  readonly localOwnerIdOrNull: null;
  readonly projectionRevision: number;
  readonly returnContext: 'PLAYER_MENU';
  readonly stateRevision: number;
}

export interface Chr010Projection extends JsonObject {
  readonly ancientOptionSerialized: false;
  readonly characterDraftId: string;
  readonly choiceLockStatus: 'UNLOCKED';
  readonly commandId: null;
  readonly draftRevision: number;
  readonly raceChoice: null;
  readonly raceConsequencesPreview: null;
  readonly wizardCheckpointId: string;
}

export interface Chr016Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly choiceLockStatus: 'UNLOCKED';
  readonly commandId: null;
  readonly draftRevision: number;
  readonly modeConsequences: null;
  readonly raceChoice: 'FREE' | 'UNITED';
  readonly symbiontAcquisitionMode: null;
  readonly wizardCheckpointId: string;
}

export interface Chr036Projection extends JsonObject {
  readonly appliesToAllCreationRolls: true;
  readonly characterDraftId: string;
  readonly choiceLockStatus: 'UNLOCKED';
  readonly commandId: null;
  readonly diceInputMode: null;
  readonly draftRevision: number;
  readonly wizardCheckpointId: string;
}

export interface Chr002Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly choiceLockStatus: 'UNLOCKED';
  readonly commandId: null;
  readonly draftRevision: number;
  readonly methodConsequences: null;
  readonly statMethod: null;
  readonly wizardCheckpointId: string;
}

export interface NaturalCriticalQueueItem extends JsonObject {
  readonly originFace: 1 | 20;
  readonly setEntryIndex: number;
}

export interface Chr003Projection extends JsonObject {
  readonly attemptIndex: number;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly commandId: null;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly draftRevision: number;
  readonly facesOrManualInputs: readonly (number | null)[];
  readonly naturalCriticalQueue: readonly NaturalCriticalQueueItem[];
  readonly setRollReceiptId: string | null;
  readonly setRollRequestId: string;
  readonly shownResultLocked: boolean;
  readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
  readonly wizardCheckpointId: string;
}

export interface Chr004Projection extends JsonObject {
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly commandId: null;
  readonly confirmationFace: number | null;
  readonly confirmationReceiptId: string | null;
  readonly confirmationRollRequestId: string;
  readonly criticalQueueIndex: number;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly draftRevision: number;
  readonly originFace: 1 | 20;
  readonly returnDecisionFormId: 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008';
  readonly setRollReceiptId: string;
  readonly wizardCheckpointId: string;
}

export interface CharacterSetDecisionProjection extends JsonObject {
  readonly acceptedSetReceiptId?: string;
  readonly attemptIndex?: number;
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly decision:
    | 'ACCEPT_SET'
    | 'GO_ATTEMPT_2'
    | 'GO_NEXT_ATTEMPT'
    | 'PENDING'
    | 'USE_POINT_BUY_85'
    | 'USE_POINT_BUY_90';
  readonly decisionReceiptIdOrNull: string | null;
  readonly draftRevision: number;
  readonly fifthAttemptMandatoryAccept?: boolean;
  readonly setReceiptId?: string;
  readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
  readonly wizardCheckpointId: string;
}

export interface CharacterSetAbandonmentConsequences extends JsonObject {
  readonly creationCriticalConsequencesDiscarded: true;
  readonly exactPointBuyTotalOrNull: 85 | 90 | null;
  readonly nextAttemptIndexOrNull: 2 | 3 | 4 | 5 | null;
  readonly setValuesDiscarded: true;
}

export interface Chr028Projection extends JsonObject {
  readonly abandonedSetReceiptIds: readonly [string];
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly decision: 'CONFIRM' | null;
  readonly decisionReceiptIdOrNull: string | null;
  readonly draftRevision: number;
  readonly irreversibleConsequences: CharacterSetAbandonmentConsequences;
  readonly originDecisionFormId: CreationSetDecisionFormId;
  readonly transitionKind:
    'ADVENTUROUS_TO_85' | 'ADVENTUROUS_TO_SECOND' | 'ALL_OR_NOTHING_NEXT' | 'CLASSIC_TO_90';
  readonly wizardCheckpointId: string;
}

export type CharacterCreationRollDraft =
  | { readonly faces: readonly (number | null)[]; readonly formId: 'CHR-003' }
  | { readonly face: number | null; readonly formId: 'CHR-004' };

export type CharacterCreationChoiceDraft =
  | {
      readonly confirmationActionKey: 'CHR-010::CTA::001' | 'CHR-010::CTA::002';
      readonly consequence: 'Выбрать Единого' | 'Выбрать Вольного' | 'Выбрать Чистого';
      readonly formId: 'CHR-010';
      readonly value: 'FREE' | 'PURE' | 'UNITED';
    }
  | {
      readonly confirmationActionKey: 'CHR-016::CTA::001';
      readonly consequence:
        'Выбрать ручное получение симбионтов' | 'Выбрать случайное получение симбионтов';
      readonly formId: 'CHR-016';
      readonly value: 'MANUAL' | 'RANDOM';
    }
  | {
      readonly confirmationActionKey: 'CHR-036::CTA::001';
      readonly consequence: null;
      readonly formId: 'CHR-036';
      readonly value: 'AUTO' | 'MANUAL';
    }
  | {
      readonly confirmationActionKey: 'CHR-002::CTA::001';
      readonly consequence:
        'Выбрать авантюристский метод' | 'Выбрать классический метод' | 'Выбрать «Всё или ничего»';
      readonly formId: 'CHR-002';
      readonly value: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
    };

const CHARACTER_CREATION_SELECTOR_CHOICES: ReadonlyMap<ActionKey, CharacterCreationChoiceDraft> =
  new Map([
    [
      'CHR-010::CTA::004',
      {
        confirmationActionKey: 'CHR-010::CTA::001',
        consequence: 'Выбрать Единого',
        formId: 'CHR-010',
        value: 'UNITED',
      },
    ],
    [
      'CHR-010::CTA::005',
      {
        confirmationActionKey: 'CHR-010::CTA::001',
        consequence: 'Выбрать Вольного',
        formId: 'CHR-010',
        value: 'FREE',
      },
    ],
    [
      'CHR-010::CTA::006',
      {
        confirmationActionKey: 'CHR-010::CTA::002',
        consequence: 'Выбрать Чистого',
        formId: 'CHR-010',
        value: 'PURE',
      },
    ],
    [
      'CHR-016::CTA::003',
      {
        confirmationActionKey: 'CHR-016::CTA::001',
        consequence: 'Выбрать ручное получение симбионтов',
        formId: 'CHR-016',
        value: 'MANUAL',
      },
    ],
    [
      'CHR-016::CTA::004',
      {
        confirmationActionKey: 'CHR-016::CTA::001',
        consequence: 'Выбрать случайное получение симбионтов',
        formId: 'CHR-016',
        value: 'RANDOM',
      },
    ],
    [
      'CHR-036::CTA::004',
      {
        confirmationActionKey: 'CHR-036::CTA::001',
        consequence: null,
        formId: 'CHR-036',
        value: 'AUTO',
      },
    ],
    [
      'CHR-036::CTA::005',
      {
        confirmationActionKey: 'CHR-036::CTA::001',
        consequence: null,
        formId: 'CHR-036',
        value: 'MANUAL',
      },
    ],
    [
      'CHR-002::CTA::003',
      {
        confirmationActionKey: 'CHR-002::CTA::001',
        consequence: 'Выбрать классический метод',
        formId: 'CHR-002',
        value: 'CLASSIC',
      },
    ],
    [
      'CHR-002::CTA::004',
      {
        confirmationActionKey: 'CHR-002::CTA::001',
        consequence: 'Выбрать авантюристский метод',
        formId: 'CHR-002',
        value: 'ADVENTUROUS',
      },
    ],
    [
      'CHR-002::CTA::005',
      {
        confirmationActionKey: 'CHR-002::CTA::001',
        consequence: 'Выбрать «Всё или ничего»',
        formId: 'CHR-002',
        value: 'ALL_OR_NOTHING',
      },
    ],
  ]);

interface IdentityCheckpointPayload extends JsonObject {
  readonly age: number;
  readonly artAssetKeyOrLocalFile: IdentityDraftValues['artAssetKeyOrLocalFile'];
  readonly characterDraftId: string;
  readonly description: string | null;
  readonly draftRevision: number;
  readonly massKg: number;
  readonly name: string;
  readonly sex: Exclude<IdentityDraftValues['sex'], null>;
  readonly stage: 'IDENTITY';
  readonly wizardCheckpointId: string;
}

type IdentityCheckpointRequest = WorkflowCommandRequestMessage<
  typeof IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  IdentityCheckpointPayload
>;

interface IdentityCheckpointResult extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: 0;
  readonly draftRevision: number;
  readonly nextFormId: 'CHR-010';
  readonly stage: 'IDENTITY';
}

interface PendingIdentityCheckpoint {
  readonly request: IdentityCheckpointRequest;
  readonly receipt: CommandReceipt<IdentityCheckpointResult> | null;
}

interface SetDecisionCommonPayload extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly sourceFormId: 'CHR-002' | 'CHR-010' | 'CHR-016' | 'CHR-036';
  readonly stage: 'RACE_AND_METHOD';
  readonly wizardCheckpointId: string;
}

interface RaceDecisionPayload extends SetDecisionCommonPayload {
  readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
  readonly sourceFormId: 'CHR-010';
}

interface SymbiontAcquisitionDecisionPayload extends SetDecisionCommonPayload {
  readonly sourceFormId: 'CHR-016';
  readonly symbiontAcquisitionMode: 'MANUAL' | 'RANDOM';
}

interface DiceInputDecisionPayload extends SetDecisionCommonPayload {
  readonly diceInputMode: 'AUTO' | 'MANUAL';
  readonly sourceFormId: 'CHR-036';
}

interface StatMethodDecisionPayload extends SetDecisionCommonPayload {
  readonly sourceFormId: 'CHR-002';
  readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
}

type SetDecisionPayload =
  | DiceInputDecisionPayload
  | RaceDecisionPayload
  | StatRollAcceptSetPayload
  | StatRollDialogDecisionPayload
  | StatMethodDecisionPayload
  | SymbiontAcquisitionDecisionPayload;
type RaceMethodSetDecisionPayload = Exclude<
  SetDecisionPayload,
  StatRollAcceptSetPayload | StatRollDialogDecisionPayload
>;

interface StatRollDecisionCommonPayload extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly stage: 'STAT_ROLLS';
  readonly wizardCheckpointId: string;
}

interface StatRollAcceptSetPayload extends StatRollDecisionCommonPayload {
  readonly decision: 'ACCEPT_SET';
  readonly sourceFormId: CreationSetDecisionFormId;
}

interface StatRollDialogDecisionPayload extends StatRollDecisionCommonPayload {
  readonly decision: 'CANCEL' | 'CONFIRM';
  readonly sourceFormId: 'CHR-028';
}

type SetDecisionRequest = WorkflowCommandRequestMessage<
  typeof SET_DECIDE_WORKFLOW_COMMAND_ID,
  SetDecisionPayload
>;

interface SetDecisionResultCommon extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly sourceFormId: 'CHR-002' | 'CHR-010' | 'CHR-016' | 'CHR-036';
  readonly stage: 'RACE_AND_METHOD';
}

interface RaceDecisionResult extends SetDecisionResultCommon {
  readonly nextFormId: 'CHR-016' | 'CHR-036';
  readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
  readonly sourceFormId: 'CHR-010';
}

interface SymbiontAcquisitionDecisionResult extends SetDecisionResultCommon {
  readonly nextFormId: 'CHR-036';
  readonly sourceFormId: 'CHR-016';
  readonly symbiontAcquisitionMode: 'MANUAL' | 'RANDOM';
}

interface DiceInputDecisionResult extends SetDecisionResultCommon {
  readonly diceInputMode: 'AUTO' | 'MANUAL';
  readonly nextFormId: 'CHR-002';
  readonly sourceFormId: 'CHR-036';
}

interface StatMethodDecisionResult extends SetDecisionResultCommon {
  readonly branchUuid: string;
  readonly nextFormId: 'CHR-003';
  readonly setRollRequestId: string;
  readonly sourceFormId: 'CHR-002';
  readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
}

type SetDecisionResult =
  | CreationSetAbandonmentResult
  | CreationSetAcceptanceResult
  | CreationSetCancelResult
  | DiceInputDecisionResult
  | RaceDecisionResult
  | StatMethodDecisionResult
  | SymbiontAcquisitionDecisionResult;

interface StatRollSetDecisionResultCommon extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly stage: 'STAT_ROLLS';
}

interface CreationSetAcceptanceResult extends StatRollSetDecisionResultCommon {
  readonly acceptedSetReceiptId: string;
  readonly assignmentMode: 'ROLLED_BIJECTION';
  readonly decision: 'ACCEPT_SET';
  readonly nextFormId: 'CHR-009';
  readonly sourceFormId: CreationSetDecisionFormId;
}

interface CreationSetAbandonmentResult extends StatRollSetDecisionResultCommon {
  readonly abandonedSetReceiptIds: readonly [string];
  readonly alternateDecision:
    'GO_ATTEMPT_2' | 'GO_NEXT_ATTEMPT' | 'USE_POINT_BUY_85' | 'USE_POINT_BUY_90';
  readonly assignmentModeOrNull: 'POINT_BUY_85' | 'POINT_BUY_90' | null;
  readonly decision: 'CONFIRM';
  readonly irreversibleConsequences: CharacterSetAbandonmentConsequences;
  readonly nextAttemptIndexOrNull: 2 | 3 | 4 | 5 | null;
  readonly nextFormId: 'CHR-003' | 'CHR-009';
  readonly nextSetRollRequestIdOrNull: string | null;
  readonly originDecisionFormId: CreationSetDecisionFormId;
  readonly sourceFormId: 'CHR-028';
  readonly sourceSetReceiptIdOrNull: null;
  readonly transitionKind: Chr028Projection['transitionKind'];
}

interface CreationSetCancelResult extends StatRollSetDecisionResultCommon {
  readonly decision: 'CANCEL';
  readonly decisionReceiptIdOrNull: null;
  readonly nextFormId: CreationSetDecisionFormId;
  readonly originDecisionFormId: CreationSetDecisionFormId;
  readonly sourceFormId: 'CHR-028';
}

interface PendingSetDecision {
  readonly choice: CharacterCreationChoiceDraft | null;
  readonly request: SetDecisionRequest;
  readonly receipt: CommandReceipt<SetDecisionResult> | null;
  readonly sourceSnapshot: ConfirmedProjectionSnapshot;
}

interface RollCommitCommonPayload extends JsonObject {
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly sourceFormId: 'CHR-003' | 'CHR-004';
  readonly stage: 'STAT_ROLLS';
  readonly wizardCheckpointId: string;
}

interface SetRollCommitPayload extends RollCommitCommonPayload {
  readonly manualFacesOrNull: readonly number[] | null;
  readonly setRollRequestId: string;
  readonly sourceFormId: 'CHR-003';
}

interface ConfirmationRollCommitPayload extends RollCommitCommonPayload {
  readonly confirmationRollRequestId: string;
  readonly criticalQueueIndex: number;
  readonly manualFaceOrNull: number | null;
  readonly setRollReceiptId: string;
  readonly sourceFormId: 'CHR-004';
}

type RollCommitPayload = ConfirmationRollCommitPayload | SetRollCommitPayload;
type RollCommitRequest = WorkflowCommandRequestMessage<
  typeof ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  RollCommitPayload
>;

interface RollCommitResultCommon extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly sourceFormId: 'CHR-003' | 'CHR-004';
  readonly stage: 'STAT_ROLLS';
}

interface SetRollCommitResult extends RollCommitResultCommon {
  readonly confirmationRollRequestIdOrNull: string | null;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly faces: readonly number[];
  readonly naturalCriticalQueue: readonly NaturalCriticalQueueItem[];
  readonly nextFormId: 'CHR-003' | 'CHR-004';
  readonly setRollReceiptId: string;
  readonly setRollRequestId: string;
  readonly shownResultLocked: true;
  readonly sourceFormId: 'CHR-003';
}

interface ConfirmationRollCommitResult extends RollCommitResultCommon {
  readonly confirmationFace: number;
  readonly confirmationReceiptId: string;
  readonly confirmationRollRequestId: string;
  readonly criticalQueueIndex: number;
  readonly nextConfirmationRollRequestIdOrNull: string | null;
  readonly nextFormId: 'CHR-004';
  readonly originFace: 1 | 20;
  readonly outcomeOrNull: JsonObject | null;
  readonly returnDecisionFormId: 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008';
  readonly setRollReceiptId: string;
  readonly sourceFormId: 'CHR-004';
}

type RollCommitResult = ConfirmationRollCommitResult | SetRollCommitResult;

interface PendingRollCommit {
  readonly receipt: CommandReceipt<RollCommitResult> | null;
  readonly request: RollCommitRequest;
  readonly sourceProjection: Chr003Projection | Chr004Projection;
}

export interface ConfirmedProjectionSnapshot {
  readonly availableActionKeys: readonly ActionKey[];
  readonly executableWorkflowCommandIds: readonly WorkflowCommandId[];
  readonly formId: SupportedPresentationFormId;
  readonly layers: readonly ConfirmedPresentationLayer[];
  readonly path: string;
  readonly projection: JsonObject;
  readonly revisions: RevisionVector;
}

export interface ConfirmedPresentationLayer {
  readonly availableActionKeys: readonly ActionKey[];
  readonly formId: 'CHR-028';
  readonly path: '@dialog/chr-028';
  readonly projection: Chr028Projection;
}

export type WebClientState =
  | { readonly kind: 'awaiting-snapshot' }
  | { readonly kind: 'client-error'; readonly detail: string }
  | { readonly kind: 'connecting' }
  | {
      readonly code: number | null;
      readonly detail: string;
      readonly kind: 'disconnected';
      readonly snapshot: ConfirmedProjectionSnapshot | null;
    }
  | {
      readonly kind: 'command-refusal';
      readonly refusal: CommandRefusalMessage['refusal'];
      readonly snapshot: ConfirmedProjectionSnapshot;
    }
  | {
      readonly kind: 'host-refusal';
      readonly refusal: DecodeRefusal;
      readonly snapshot: ConfirmedProjectionSnapshot | null;
    }
  | {
      readonly detail: string;
      readonly kind: 'protocol-error';
      readonly refusal: DecodeRefusal;
      readonly snapshot: ConfirmedProjectionSnapshot | null;
    }
  | {
      readonly kind: 'navigation-refusal';
      readonly refusal: FormActionRefusalV2Message['refusal'];
      readonly snapshot: ConfirmedProjectionSnapshot;
    }
  | { readonly kind: 'ready'; readonly snapshot: ConfirmedProjectionSnapshot };

export type FormActionRequestResult =
  { readonly ok: false; readonly detail: string } | { readonly ok: true };

export interface ProjectionConnection {
  disconnect(): void;
  reconnect(): FormActionRequestResult;
  replaceConfirmationManualFace(value: number | null): FormActionRequestResult;
  replaceSetManualFace(index: number, value: number | null): FormActionRequestResult;
  replaceIdentityDraft(values: IdentityDraftValues): FormActionRequestResult;
  requestFormAction(actionKey: ActionKey): FormActionRequestResult;
}

function refused<T>(refusal: DecodeRefusal): DecodeResult<T> {
  return { ok: false, refusal };
}

function unrecognized<T>(path: string, value: JsonValue): DecodeResult<T> {
  return refused({ code: 'UNRECOGNIZED', path, value });
}

function wireType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactObjectKeys(
  value: JsonObject,
  expectedKeys: ReadonlySet<string>,
  path: string,
): DecodeResult<null> {
  for (const key of Object.keys(value)) {
    if (expectedKeys.has(key)) continue;
    const unexpected = value[key];
    if (unexpected === undefined) {
      return refused({
        actualType: 'undefined',
        code: 'INVALID_SHAPE',
        expected: 'JSON value',
        path: `${path}.${key}`,
      });
    }
    return refused({ code: 'UNRECOGNIZED', path: `${path}.${key}`, value: unexpected });
  }
  return { ok: true, value: null };
}

function decodeBaselineValue(value: unknown, path: string): DecodeResult<BaselineValue> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object with status and value',
      path,
    });
  }
  const keys = exactObjectKeys(value, BASELINE_VALUE_KEYS, path);
  if (!keys.ok) return keys;
  const status = value['status'];
  if (typeof status !== 'string') {
    return refused({
      actualType: wireType(status),
      code: 'INVALID_SHAPE',
      expected: 'string literal PASS',
      path: `${path}.status`,
    });
  }
  if (status !== 'PASS') {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.status`, value: status });
  }
  const baselineValue = value['value'];
  if (typeof baselineValue !== 'string') {
    return refused({
      actualType: wireType(baselineValue),
      code: 'INVALID_SHAPE',
      expected: 'string',
      path: `${path}.value`,
    });
  }
  return { ok: true, value: value as BaselineValue };
}

function decodeBaselineCompatibility(
  value: unknown,
  path: string,
): DecodeResult<BaselineCompatibility> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object',
      path,
    });
  }
  const keys = exactObjectKeys(value, BASELINE_COMPATIBILITY_KEYS, path);
  if (!keys.ok) return keys;
  for (const key of ['builtAgainstTuple', 'catalogVersion', 'registryVersion'] as const) {
    const baselineValue = decodeBaselineValue(value[key], `${path}.${key}`);
    if (!baselineValue.ok) return baselineValue;
  }
  return { ok: true, value: value as BaselineCompatibility };
}

function decodeStringList(value: unknown, path: string): DecodeResult<readonly string[]> {
  if (!Array.isArray(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'array of strings',
      path,
    });
  }
  for (const [index, entry] of value.entries()) {
    if (typeof entry === 'string') continue;
    return refused({
      actualType: wireType(entry),
      code: 'INVALID_SHAPE',
      expected: 'string',
      path: `${path}[${String(index)}]`,
    });
  }
  return { ok: true, value: value as string[] };
}

function decodeIntegrityStatus(value: unknown, path: string): DecodeResult<IntegrityStatus> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object',
      path,
    });
  }
  const keys = exactObjectKeys(value, INTEGRITY_STATUS_KEYS, path);
  if (!keys.ok) return keys;
  for (const key of ['changed', 'missing', 'untracked'] as const) {
    const list = decodeStringList(value[key], `${path}.${key}`);
    if (!list.ok) return list;
  }
  const ok = value['ok'];
  if (typeof ok !== 'boolean') {
    return refused({
      actualType: wireType(ok),
      code: 'INVALID_SHAPE',
      expected: 'boolean',
      path: `${path}.ok`,
    });
  }
  const tracked = value['tracked'];
  if (typeof tracked !== 'number') {
    return refused({
      actualType: wireType(tracked),
      code: 'INVALID_SHAPE',
      expected: 'non-negative safe integer',
      path: `${path}.tracked`,
    });
  }
  if (!Number.isSafeInteger(tracked) || tracked < 0) {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.tracked`, value: tracked });
  }
  return { ok: true, value: value as IntegrityStatus };
}

function decodeApp001Projection(value: JsonObject, path: string): DecodeResult<App001Projection> {
  const keys = exactObjectKeys(value, APP_001_KEYS, path);
  if (!keys.ok) return keys;

  const formId = value['formId'];
  if (typeof formId !== 'string') {
    return refused({
      actualType: wireType(formId),
      code: 'INVALID_SHAPE',
      expected: 'string literal APP-001',
      path: `${path}.formId`,
    });
  }
  if (formId !== 'APP-001') {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.formId`, value: formId });
  }

  const buildVersion = value['buildVersion'];
  if (typeof buildVersion !== 'string') {
    return refused({
      actualType: wireType(buildVersion),
      code: 'INVALID_SHAPE',
      expected: 'string',
      path: `${path}.buildVersion`,
    });
  }

  const baselineCompatibility = decodeBaselineCompatibility(
    value['baselineCompatibility'],
    `${path}.baselineCompatibility`,
  );
  if (!baselineCompatibility.ok) return baselineCompatibility;

  const integrityStatus = decodeIntegrityStatus(
    value['integrityStatus'],
    `${path}.integrityStatus`,
  );
  if (!integrityStatus.ok) return integrityStatus;

  const bootState = value['bootState'];
  if (typeof bootState !== 'string') {
    return refused({
      actualType: wireType(bootState),
      code: 'INVALID_SHAPE',
      expected: 'BOOTING | READY | ERROR',
      path: `${path}.bootState`,
    });
  }
  if (!APP_001_BOOT_STATES.has(bootState)) {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.bootState`, value: bootState });
  }

  return { ok: true, value: value as App001Projection };
}

type FieldPredicate = (value: JsonValue) => boolean;

function decodeProjection(
  value: JsonObject,
  path: string,
  fields: Readonly<Record<string, FieldPredicate>>,
): DecodeResult<JsonObject> {
  const keys = exactObjectKeys(value, new Set(Object.keys(fields)), path);
  if (!keys.ok) return keys;
  for (const [key, valid] of Object.entries(fields)) {
    const field = value[key];
    if (field === undefined) {
      return refused({
        actualType: 'undefined',
        code: 'INVALID_SHAPE',
        expected: 'required JSON value',
        path: `${path}.${key}`,
      });
    }
    if (!valid(field)) return unrecognized(`${path}.${key}`, field);
  }
  return { ok: true, value };
}

function decodeApp002Projection(value: JsonObject, path: string, revisions: RevisionVector) {
  const result = decodeProjection(value, path, {
    contextId: (field) => typeof field === 'string' && DEVICE_ID_PATTERN.test(field),
    deviceId: (field) => typeof field === 'string' && DEVICE_ID_PATTERN.test(field),
    projectionRevision: (field) => field === revisions.projectionRevision,
    stateRevision: (field) => field === revisions.stateRevision,
  });
  const contextId = value['contextId'];
  if (result.ok && contextId !== undefined && contextId === value['deviceId']) {
    return unrecognized<JsonObject>(`${path}.contextId`, contextId);
  }
  return result;
}

function isCanonicalCharacterIdList(value: JsonValue): value is readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return false;
  const ids = value as string[];
  return (
    new Set(ids).size === ids.length &&
    ids.every((entry, index) => index === 0 || ids[index - 1]! < entry)
  );
}

function decodeApp004Projection(
  value: JsonObject,
  path: string,
  revisions: RevisionVector,
): DecodeResult<JsonObject> {
  const result = decodeProjection(value, path, {
    campaignAuthority: (field) => field === false,
    draftCharacterIds: isCanonicalCharacterIdList,
    finalCharacterIds: isCanonicalCharacterIdList,
    handoffIdOrNull: (field) => field === null,
    handoffReceiptIdOrNull: (field) => field === null,
    launchContext: (field) => field === 'PLAYER_MENU',
    localCharacterLibraryRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    localOwnerIdOrNull: (field) => field === null,
    projectionRevision: (field) => field === revisions.projectionRevision,
    returnContext: (field) => field === 'PLAYER_MENU',
    stateRevision: (field) => field === revisions.stateRevision,
  });
  if (!result.ok) return result;
  const draftIds = value['draftCharacterIds'] as readonly string[];
  const finalIds = value['finalCharacterIds'] as readonly string[];
  const draftIdSet = new Set(draftIds);
  const duplicate = finalIds.find((id) => draftIdSet.has(id));
  return duplicate === undefined
    ? result
    : unrecognized(`${path}.finalCharacterIds`, [...finalIds]);
}

function isIdentityArt(value: JsonValue): boolean {
  if (value === null) return true;
  if (!isJsonObject(value) || typeof value['kind'] !== 'string') return false;
  if (value['kind'] === 'asset-key') {
    return (
      Object.keys(value).sort().join(',') === 'assetKey,kind' &&
      typeof value['assetKey'] === 'string'
    );
  }
  return (
    value['kind'] === 'local-file' &&
    Object.keys(value).sort().join(',') === 'bytesBase64,kind,mediaType' &&
    typeof value['bytesBase64'] === 'string' &&
    (value['mediaType'] === 'image/png' || value['mediaType'] === 'image/jpeg')
  );
}

function decodeChr001Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    age: (field) => field === null || (typeof field === 'number' && Number.isFinite(field)),
    anatomyProfile: (field) => field === 'STANDARD_HUMANOID',
    artAssetKeyOrLocalFile: isIdentityArt,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null,
    description: (field) => field === null || typeof field === 'string',
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    massApprovalStatus: (field) => field === 'PENDING_GM',
    massKg: (field) =>
      field === null ||
      (typeof field === 'number' &&
        Number.isFinite(field) &&
        field > 0 &&
        (Number.isInteger(field) || Number.isInteger(field * 10))),
    name: (field) => field === null || typeof field === 'string',
    sex: (field) => field === null || field === 'MALE' || field === 'FEMALE',
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function decodeChr010Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    ancientOptionSerialized: (field) => field === false,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    choiceLockStatus: (field) => field === 'UNLOCKED',
    commandId: (field) => field === null,
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    raceChoice: (field) => field === null,
    raceConsequencesPreview: (field) => field === null,
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function decodeChr016Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    choiceLockStatus: (field) => field === 'UNLOCKED',
    commandId: (field) => field === null,
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    modeConsequences: (field) => field === null,
    raceChoice: (field) => field === 'FREE' || field === 'UNITED',
    symbiontAcquisitionMode: (field) => field === null,
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function decodeChr036Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    appliesToAllCreationRolls: (field) => field === true,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    choiceLockStatus: (field) => field === 'UNLOCKED',
    commandId: (field) => field === null,
    diceInputMode: (field) => field === null,
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function decodeChr002Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    choiceLockStatus: (field) => field === 'UNLOCKED',
    commandId: (field) => field === null,
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    methodConsequences: (field) => field === null,
    statMethod: (field) => field === null,
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function isSafeIntegerAtLeast(value: JsonValue, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function isFace(value: JsonValue): value is number {
  return isSafeIntegerAtLeast(value, 1) && value <= 20;
}

function isNonEmptyString(value: JsonValue): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function decodeFaceSlots(
  value: JsonValue,
  path: string,
  nullable: boolean,
): DecodeResult<readonly (number | null)[]> {
  if (!Array.isArray(value) || value.length !== 7) {
    return unrecognized(path, value);
  }
  const entries = value as readonly JsonValue[];
  for (const [index, face] of entries.entries()) {
    if (isFace(face) || (nullable && face === null)) continue;
    return unrecognized(`${path}[${String(index)}]`, face);
  }
  return { ok: true, value: value as readonly (number | null)[] };
}

function decodeNaturalCriticalQueue(
  value: JsonValue,
  path: string,
  faces: readonly (number | null)[],
): DecodeResult<readonly NaturalCriticalQueueItem[]> {
  if (!Array.isArray(value)) return unrecognized(path, value);
  const expected = faces.flatMap((face, setEntryIndex) =>
    face === 1 || face === 20 ? [{ originFace: face, setEntryIndex }] : [],
  );
  if (value.length !== expected.length) return unrecognized(path, value);
  const entries = value as readonly JsonValue[];
  for (const [index, item] of entries.entries()) {
    if (!isJsonObject(item)) return unrecognized(`${path}[${String(index)}]`, item);
    const keys = exactObjectKeys(
      item,
      new Set(['originFace', 'setEntryIndex']),
      `${path}[${String(index)}]`,
    );
    if (!keys.ok) return keys;
    const expectedItem = expected[index]!;
    if (
      item['setEntryIndex'] !== expectedItem.setEntryIndex ||
      item['originFace'] !== expectedItem.originFace
    ) {
      return unrecognized(`${path}[${String(index)}]`, item);
    }
  }
  return { ok: true, value: value as unknown as readonly NaturalCriticalQueueItem[] };
}

function decodeChr003Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const nullableSlots = value['setRollReceiptId'] === null;
  const faces = decodeFaceSlots(
    value['facesOrManualInputs']!,
    `${path}.facesOrManualInputs`,
    nullableSlots,
  );
  if (!faces.ok) return faces;
  const queue = decodeNaturalCriticalQueue(
    value['naturalCriticalQueue']!,
    `${path}.naturalCriticalQueue`,
    faces.value,
  );
  if (!queue.ok) return queue;
  const characterDraftId = value['characterDraftId'];
  const wizardCheckpointId = value['wizardCheckpointId'];
  const branchUuid = value['branchUuid'];
  const setRollRequestId = value['setRollRequestId'];
  const result = decodeProjection(value, path, {
    attemptIndex: (field) => isSafeIntegerAtLeast(field, 1),
    branchUuid: isNonEmptyString,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null,
    diceInputModeSnapshot: (field) => field === 'AUTO' || field === 'MANUAL',
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    facesOrManualInputs: (field) => field === value['facesOrManualInputs'],
    naturalCriticalQueue: (field) => field === value['naturalCriticalQueue'],
    setRollReceiptId: (field) => field === null || isNonEmptyString(field),
    setRollRequestId: isNonEmptyString,
    shownResultLocked: (field) => typeof field === 'boolean',
    statMethod: (field) =>
      field === 'CLASSIC' || field === 'ADVENTUROUS' || field === 'ALL_OR_NOTHING',
    wizardCheckpointId: isNonEmptyString,
  });
  if (!result.ok) return result;
  if (
    [characterDraftId, wizardCheckpointId, branchUuid, setRollRequestId].some(
      (entry, index, entries) => entries.indexOf(entry) !== index,
    )
  ) {
    return unrecognized(`${path}.setRollRequestId`, setRollRequestId!);
  }
  const pending = value['setRollReceiptId'] === null;
  if (
    (pending &&
      (value['shownResultLocked'] !== false ||
        faces.value.some((face) => face !== null) ||
        queue.value.length !== 0)) ||
    (!pending && (value['shownResultLocked'] !== true || faces.value.some((face) => face === null)))
  ) {
    return unrecognized(`${path}.shownResultLocked`, value['shownResultLocked']!);
  }
  return result;
}

function decodeChr004Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const characterDraftId = value['characterDraftId'];
  const wizardCheckpointId = value['wizardCheckpointId'];
  const branchUuid = value['branchUuid'];
  const setRollReceiptId = value['setRollReceiptId'];
  const confirmationRollRequestId = value['confirmationRollRequestId'];
  const result = decodeProjection(value, path, {
    branchUuid: isNonEmptyString,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null,
    confirmationFace: (field) => field === null || isFace(field),
    confirmationReceiptId: (field) => field === null || isNonEmptyString(field),
    confirmationRollRequestId: isNonEmptyString,
    criticalQueueIndex: (field) => isSafeIntegerAtLeast(field, 0),
    diceInputModeSnapshot: (field) => field === 'AUTO' || field === 'MANUAL',
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    originFace: (field) => field === 1 || field === 20,
    returnDecisionFormId: (field) =>
      field === 'CHR-005' || field === 'CHR-006' || field === 'CHR-007' || field === 'CHR-008',
    setRollReceiptId: isNonEmptyString,
    wizardCheckpointId: isNonEmptyString,
  });
  if (!result.ok) return result;
  const ids = [
    characterDraftId,
    wizardCheckpointId,
    branchUuid,
    setRollReceiptId,
    confirmationRollRequestId,
  ];
  if (ids.some((entry, index) => ids.indexOf(entry) !== index)) {
    return unrecognized(`${path}.confirmationRollRequestId`, confirmationRollRequestId!);
  }
  if ((value['confirmationFace'] === null) !== (value['confirmationReceiptId'] === null)) {
    return unrecognized(`${path}.confirmationReceiptId`, value['confirmationReceiptId']!);
  }
  return result;
}

function isCreationSetDecisionFormId(value: string): value is CreationSetDecisionFormId {
  return CREATION_SET_DECISION_FORM_ID_SET.has(value);
}

function decodeCharacterSetDecisionProjection(
  formId: CreationSetDecisionFormId,
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const rule = CREATION_SET_DECISION_FORMS[formId];
  const fields: Record<string, FieldPredicate> = {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null || isNonEmptyString(field),
    decision: (field) =>
      field === 'PENDING' || field === 'ACCEPT_SET' || field === rule.alternateDecision,
    decisionReceiptIdOrNull: (field) => field === null || isNonEmptyString(field),
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    [rule.receiptKey]: isNonEmptyString,
    statMethod: (field) => field === rule.method,
    wizardCheckpointId: isNonEmptyString,
  };
  if (formId !== 'CHR-005') {
    fields['attemptIndex'] = (field) =>
      formId === 'CHR-008' ? isSafeIntegerAtLeast(field, 1) && field <= 5 : field === rule.attempt;
  }
  if (formId === 'CHR-008') {
    fields['fifthAttemptMandatoryAccept'] = (field) => field === (value['attemptIndex'] === 5);
  }
  const decoded = decodeProjection(value, path, fields);
  if (!decoded.ok) return decoded;
  const pending = value['decision'] === 'PENDING';
  if (
    pending !== (value['decisionReceiptIdOrNull'] === null) ||
    pending !== (value['commandId'] === null)
  ) {
    return unrecognized(`${path}.decisionReceiptIdOrNull`, value['decisionReceiptIdOrNull']!);
  }
  const ids = [
    value['characterDraftId'],
    value['wizardCheckpointId'],
    value[rule.receiptKey],
    value['decisionReceiptIdOrNull'],
    value['commandId'],
  ].filter((entry): entry is string => typeof entry === 'string');
  if (new Set(ids).size !== ids.length) {
    return unrecognized(`${path}.${rule.receiptKey}`, value[rule.receiptKey]!);
  }
  return decoded;
}

function expectedAbandonmentConsequences(
  formId: CreationSetDecisionFormId,
  projection: JsonObject,
): CharacterSetAbandonmentConsequences {
  switch (formId) {
    case 'CHR-005':
      return {
        creationCriticalConsequencesDiscarded: true,
        exactPointBuyTotalOrNull: 90,
        nextAttemptIndexOrNull: null,
        setValuesDiscarded: true,
      };
    case 'CHR-006':
      return {
        creationCriticalConsequencesDiscarded: true,
        exactPointBuyTotalOrNull: null,
        nextAttemptIndexOrNull: 2,
        setValuesDiscarded: true,
      };
    case 'CHR-007':
      return {
        creationCriticalConsequencesDiscarded: true,
        exactPointBuyTotalOrNull: 85,
        nextAttemptIndexOrNull: null,
        setValuesDiscarded: true,
      };
    case 'CHR-008':
      return {
        creationCriticalConsequencesDiscarded: true,
        exactPointBuyTotalOrNull: null,
        nextAttemptIndexOrNull: ((projection['attemptIndex'] as 1 | 2 | 3 | 4) + 1) as
          2 | 3 | 4 | 5,
        setValuesDiscarded: true,
      };
  }
}

function decodeAbandonmentConsequences(
  value: JsonValue,
  path: string,
  expected: CharacterSetAbandonmentConsequences,
): DecodeResult<CharacterSetAbandonmentConsequences> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const decoded = decodeProjection(value, path, {
    creationCriticalConsequencesDiscarded: (field) =>
      field === expected.creationCriticalConsequencesDiscarded,
    exactPointBuyTotalOrNull: (field) => field === expected.exactPointBuyTotalOrNull,
    nextAttemptIndexOrNull: (field) => field === expected.nextAttemptIndexOrNull,
    setValuesDiscarded: (field) => field === expected.setValuesDiscarded,
  });
  return decoded.ok ? { ok: true, value: value as CharacterSetAbandonmentConsequences } : decoded;
}

function decodeChr028Projection(
  value: JsonObject,
  path: string,
  originFormId: CreationSetDecisionFormId,
  originProjection: JsonObject,
): DecodeResult<Chr028Projection> {
  const rule = CREATION_SET_DECISION_FORMS[originFormId];
  const consequences = expectedAbandonmentConsequences(originFormId, originProjection);
  const decodedConsequences = decodeAbandonmentConsequences(
    value['irreversibleConsequences']!,
    `${path}.irreversibleConsequences`,
    consequences,
  );
  if (!decodedConsequences.ok) return decodedConsequences;
  const setReceiptId = originProjection[rule.receiptKey];
  const receiptIds = value['abandonedSetReceiptIds'];
  const decoded = decodeProjection(value, path, {
    abandonedSetReceiptIds: (field) =>
      Array.isArray(field) && field.length === 1 && field[0] === setReceiptId,
    characterDraftId: (field) => field === originProjection['characterDraftId'],
    commandId: (field) => field === null || isNonEmptyString(field),
    decision: (field) => field === null || field === 'CONFIRM',
    decisionReceiptIdOrNull: (field) => field === null || isNonEmptyString(field),
    draftRevision: (field) => field === originProjection['draftRevision'],
    irreversibleConsequences: (field) => field === value['irreversibleConsequences'],
    originDecisionFormId: (field) => field === originFormId,
    transitionKind: (field) => field === rule.transitionKind,
    wizardCheckpointId: (field) => field === originProjection['wizardCheckpointId'],
  });
  if (!decoded.ok) return decoded;
  const warning = value['decision'] === null;
  if (
    warning !== (value['decisionReceiptIdOrNull'] === null) ||
    warning !== (value['commandId'] === null) ||
    originProjection['decision'] !== (warning ? 'PENDING' : rule.alternateDecision) ||
    (!warning && originFormId !== 'CHR-005' && originFormId !== 'CHR-007')
  ) {
    return unrecognized(`${path}.decision`, value['decision']!);
  }
  if (!Array.isArray(receiptIds))
    return unrecognized(`${path}.abandonedSetReceiptIds`, receiptIds!);
  const ids = [
    value['characterDraftId'],
    value['wizardCheckpointId'],
    receiptIds[0],
    value['decisionReceiptIdOrNull'],
    value['commandId'],
  ].filter((entry): entry is string => typeof entry === 'string');
  if (new Set(ids).size !== ids.length) {
    return unrecognized(`${path}.abandonedSetReceiptIds`, receiptIds);
  }
  return { ok: true, value: value as unknown as Chr028Projection };
}

function exactActionKeys(
  actual: readonly ActionKey[],
  expected: readonly ActionKey[],
  path: string,
): DecodeResult<null> {
  if (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
    return { ok: true, value: null };
  return unrecognized(path, [...actual]);
}

function expectedCreationSetDecisionActionKeys(
  formId: CreationSetDecisionFormId,
  projection: JsonObject,
  executableWorkflowCommandIds: readonly WorkflowCommandId[],
): readonly ActionKey[] {
  if (
    projection['decision'] !== 'PENDING' ||
    !executableWorkflowCommandIds.includes(SET_DECIDE_WORKFLOW_COMMAND_ID)
  ) {
    return NO_ACTION_KEYS;
  }
  const rule = CREATION_SET_DECISION_FORMS[formId];
  return formId === 'CHR-008' && projection['fifthAttemptMandatoryAccept'] === true
    ? [rule.acceptActionKey]
    : [rule.acceptActionKey, rule.alternateActionKey];
}

function decodePresentationLayers(
  message: ProjectionSnapshotV2Message,
  baseFormId: SupportedPresentationFormId,
  baseProjection: JsonObject,
  executableWorkflowCommandIds: readonly WorkflowCommandId[],
): DecodeResult<readonly ConfirmedPresentationLayer[]> {
  const layers = message.presentation.layers;
  if (layers.length === 0) return { ok: true, value: [] };
  if (!isCreationSetDecisionFormId(baseFormId) || layers.length !== 1) {
    return unrecognized(
      '$.presentation.layers',
      layers.map((layer) => layer.formId),
    );
  }
  if (baseFormId === 'CHR-008' && baseProjection['fifthAttemptMandatoryAccept'] === true) {
    return unrecognized('$.presentation.layers[0].formId', layers[0]!.formId);
  }
  const layer = layers[0]!;
  if (layer.formId !== 'CHR-028') {
    return unrecognized('$.presentation.layers[0].formId', layer.formId);
  }
  if (layer.routeBindings.length !== 0) {
    return unrecognized(
      '$.presentation.layers[0].routeBindings',
      layer.routeBindings as unknown as JsonValue,
    );
  }
  const projection = decodeChr028Projection(
    layer.roleFilteredPayload,
    '$.presentation.layers[0].roleFilteredPayload',
    baseFormId,
    baseProjection,
  );
  if (!projection.ok) return projection;
  const expectedActions =
    projection.value.decision === null &&
    executableWorkflowCommandIds.includes(SET_DECIDE_WORKFLOW_COMMAND_ID)
      ? CHR_028_ACTION_KEYS
      : NO_ACTION_KEYS;
  const actions = exactActionKeys(
    layer.availableActionKeys,
    expectedActions,
    '$.presentation.layers[0].availableActionKeys',
  );
  if (!actions.ok) return actions;
  return {
    ok: true,
    value: [
      {
        availableActionKeys: [...layer.availableActionKeys],
        formId: 'CHR-028',
        path: '@dialog/chr-028',
        projection: projection.value,
      },
    ],
  };
}

function decodeConfirmedSnapshot(
  message: ProjectionSnapshotV2Message,
  executableWorkflowCommandIds: readonly WorkflowCommandId[],
): DecodeResult<ConfirmedProjectionSnapshot> {
  const base = message.presentation.base;
  const expectedRole = base.formId === 'APP-001' ? null : 'player';
  if (message.projectionRole !== expectedRole) {
    return unrecognized('$.projectionRole', message.projectionRole);
  }
  let projection: DecodeResult<JsonObject>;
  switch (base.formId) {
    case 'APP-001':
      projection = decodeApp001Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
      );
      break;
    case 'APP-002':
      projection = decodeApp002Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        message.revisions,
      );
      break;
    case 'APP-004':
      projection = decodeApp004Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        message.revisions,
      );
      break;
    case 'CHR-001':
      projection = decodeChr001Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      break;
    case 'CHR-010':
      projection = decodeChr010Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const actions = exactActionKeys(
          base.availableActionKeys,
          CHR_010_INITIAL_ACTION_KEYS,
          '$.presentation.base.availableActionKeys',
        );
        if (!actions.ok) return actions;
      }
      break;
    case 'CHR-016':
      projection = decodeChr016Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const actions = exactActionKeys(
          base.availableActionKeys,
          CHR_016_INITIAL_ACTION_KEYS,
          '$.presentation.base.availableActionKeys',
        );
        if (!actions.ok) return actions;
      }
      break;
    case 'CHR-036':
      projection = decodeChr036Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const actions = exactActionKeys(
          base.availableActionKeys,
          CHR_036_INITIAL_ACTION_KEYS,
          '$.presentation.base.availableActionKeys',
        );
        if (!actions.ok) return actions;
      }
      break;
    case 'CHR-002':
      projection = decodeChr002Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const actions = exactActionKeys(
          base.availableActionKeys,
          CHR_002_INITIAL_ACTION_KEYS,
          '$.presentation.base.availableActionKeys',
        );
        if (!actions.ok) return actions;
      }
      break;
    case 'CHR-003':
      projection = decodeChr003Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const actions = exactActionKeys(
          base.availableActionKeys,
          projection.value['setRollReceiptId'] === null &&
            executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID)
            ? CHR_003_PENDING_ACTION_KEYS
            : NO_ACTION_KEYS,
          '$.presentation.base.availableActionKeys',
        );
        if (!actions.ok) return actions;
      }
      break;
    case 'CHR-004':
      projection = decodeChr004Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const actions = exactActionKeys(
          base.availableActionKeys,
          projection.value['confirmationReceiptId'] === null &&
            executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID)
            ? CHR_004_PENDING_ACTION_KEYS
            : NO_ACTION_KEYS,
          '$.presentation.base.availableActionKeys',
        );
        if (!actions.ok) return actions;
      }
      break;
    case 'CHR-005':
    case 'CHR-006':
    case 'CHR-007':
    case 'CHR-008':
      projection = decodeCharacterSetDecisionProjection(
        base.formId,
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const actions = exactActionKeys(
          base.availableActionKeys,
          expectedCreationSetDecisionActionKeys(
            base.formId,
            projection.value,
            executableWorkflowCommandIds,
          ),
          '$.presentation.base.availableActionKeys',
        );
        if (!actions.ok) return actions;
      }
      break;
    default:
      return unrecognized('$.presentation.base.formId', base.formId);
  }
  if (!projection.ok) return projection;
  if (
    base.formId === 'CHR-001' &&
    base.availableActionKeys.includes(IDENTITY_CHECKPOINT_ACTION_KEY) &&
    !executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID)
  ) {
    return unrecognized('$.presentation.base.availableActionKeys', [...base.availableActionKeys]);
  }
  if (
    base.formId === 'CHR-001' &&
    base.availableActionKeys.includes(IDENTITY_CHECKPOINT_ACTION_KEY)
  ) {
    const value = projection.value;
    if (
      typeof value['name'] !== 'string' ||
      typeof value['age'] !== 'number' ||
      (value['sex'] !== 'MALE' && value['sex'] !== 'FEMALE') ||
      typeof value['massKg'] !== 'number'
    ) {
      return unrecognized('$.presentation.base.availableActionKeys', [...base.availableActionKeys]);
    }
  }
  const layers = decodePresentationLayers(
    message,
    base.formId,
    projection.value,
    executableWorkflowCommandIds,
  );
  if (!layers.ok) return layers;
  const common = {
    availableActionKeys: [...base.availableActionKeys],
    executableWorkflowCommandIds: [...executableWorkflowCommandIds],
    path:
      base.routeBindings.length === 0
        ? base.routeTemplate
        : base.routeTemplate.replace(/:[^/]+/u, encodeURIComponent(base.routeBindings[0]!.value)),
    revisions: { ...message.revisions },
  } as const;
  return {
    ok: true,
    value: {
      ...common,
      formId: base.formId,
      layers: layers.value,
      projection: projection.value,
    },
  };
}

function identitySnapshot(
  snapshot: ConfirmedProjectionSnapshot,
  contextId: string | null,
): IdentityDraftSnapshot | null {
  if (snapshot.formId !== 'CHR-001' || contextId === null) return null;
  const value = snapshot.projection;
  return {
    draftRevision: value['draftRevision'] as number,
    revisions: snapshot.revisions,
    scope: {
      characterDraftId: value['characterDraftId'] as string,
      contextId,
      sourceFormId: 'CHR-001',
      wizardCheckpointId: value['wizardCheckpointId'] as string,
    },
    values: {
      age: value['age'] as number | null,
      artAssetKeyOrLocalFile: value[
        'artAssetKeyOrLocalFile'
      ] as IdentityDraftValues['artAssetKeyOrLocalFile'],
      description: value['description'] as string | null,
      massKg: value['massKg'] as number | null,
      name: value['name'] as string | null,
      sex: value['sex'] as IdentityDraftValues['sex'],
    },
  };
}

function creationRollDraftFromSnapshot(
  snapshot: ConfirmedProjectionSnapshot,
): CharacterCreationRollDraft | null {
  if (
    snapshot.formId === 'CHR-003' &&
    snapshot.projection['diceInputModeSnapshot'] === 'MANUAL' &&
    snapshot.projection['setRollReceiptId'] === null
  ) {
    return {
      faces: [...(snapshot.projection['facesOrManualInputs'] as readonly (number | null)[])],
      formId: 'CHR-003',
    };
  }
  if (
    snapshot.formId === 'CHR-004' &&
    snapshot.projection['diceInputModeSnapshot'] === 'MANUAL' &&
    snapshot.projection['confirmationReceiptId'] === null
  ) {
    return { face: snapshot.projection['confirmationFace'] as number | null, formId: 'CHR-004' };
  }
  return null;
}

function completeManualRollDraft(draft: CharacterCreationRollDraft | null): boolean {
  if (draft === null) return false;
  return draft.formId === 'CHR-003'
    ? draft.faces.length === 7 && draft.faces.every((face) => face !== null && isFace(face))
    : draft.face !== null && isFace(draft.face);
}

function visibleSnapshot(
  snapshot: ConfirmedProjectionSnapshot,
  identity: IdentityDraftClient | null,
  commandPending = false,
  creationChoice: CharacterCreationChoiceDraft | null = null,
  creationRollDraft: CharacterCreationRollDraft | null = null,
): ConfirmedProjectionSnapshot {
  if (snapshot.formId === 'CHR-001' && (identity?.state.dirty === true || commandPending)) {
    return {
      ...snapshot,
      availableActionKeys: snapshot.availableActionKeys.filter(
        (key) => key !== IDENTITY_CHECKPOINT_ACTION_KEY,
      ),
    };
  }
  const visibleLayers = commandPending
    ? snapshot.layers.map((layer) => ({ ...layer, availableActionKeys: NO_ACTION_KEYS }))
    : snapshot.layers;
  const presentation =
    visibleLayers === snapshot.layers ? snapshot : { ...snapshot, layers: visibleLayers };
  let availableActionKeys = [...snapshot.availableActionKeys];
  if (snapshot.formId === 'CHR-003') {
    const executable =
      !commandPending &&
      snapshot.executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID) &&
      (snapshot.projection['diceInputModeSnapshot'] === 'AUTO' ||
        (creationRollDraft?.formId === 'CHR-003' && completeManualRollDraft(creationRollDraft)));
    if (!executable) {
      availableActionKeys = availableActionKeys.filter(
        (key) => key !== CHR_003_ROLL_COMMIT_ACTION_KEY,
      );
    }
  } else if (snapshot.formId === 'CHR-004') {
    const executable =
      !commandPending &&
      snapshot.executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID) &&
      (snapshot.projection['diceInputModeSnapshot'] === 'AUTO' ||
        (creationRollDraft?.formId === 'CHR-004' && completeManualRollDraft(creationRollDraft)));
    if (!executable) {
      availableActionKeys = availableActionKeys.filter(
        (key) => key !== CHR_004_ROLL_COMMIT_ACTION_KEY,
      );
    }
  } else if (isCreationSetDecisionFormId(snapshot.formId) && commandPending) {
    availableActionKeys = [];
  }
  const visible =
    availableActionKeys.length === snapshot.availableActionKeys.length
      ? presentation
      : { ...presentation, availableActionKeys };
  if (
    commandPending ||
    creationChoice === null ||
    creationChoice.formId !== snapshot.formId ||
    !snapshot.executableWorkflowCommandIds.includes(SET_DECIDE_WORKFLOW_COMMAND_ID)
  ) {
    return visible;
  }
  return {
    ...visible,
    availableActionKeys: [creationChoice.confirmationActionKey, ...availableActionKeys],
  };
}

function activePresentedForm(snapshot: ConfirmedProjectionSnapshot): {
  readonly availableActionKeys: readonly ActionKey[];
  readonly formId: SupportedPresentationFormId;
  readonly projection: JsonObject;
} {
  return snapshot.layers.at(-1) ?? snapshot;
}

function sameBasePresentation(
  left: ConfirmedProjectionSnapshot,
  right: ConfirmedProjectionSnapshot,
): boolean {
  return (
    left.formId === right.formId &&
    left.path === right.path &&
    left.availableActionKeys.length === right.availableActionKeys.length &&
    left.availableActionKeys.every((key, index) => key === right.availableActionKeys[index]) &&
    sameJson(left.projection, right.projection)
  );
}

function decodeReconnectSnapshot(
  message: ProjectionSnapshotV2Message,
  capabilities: SessionReconnectCapabilitiesV2Message,
  requestId: string,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (capabilities.reconnectRequestId !== requestId) {
    return unrecognized('$.reconnectRequestId', capabilities.reconnectRequestId);
  }
  if (message.presentation.assignment.correlationId !== requestId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'RECONNECT') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  if (
    capabilities.revisions.actorVisibilityRevision !== message.revisions.actorVisibilityRevision ||
    capabilities.revisions.projectionRevision !== message.revisions.projectionRevision ||
    capabilities.revisions.stateRevision !== message.revisions.stateRevision
  ) {
    return unrecognized('$.revisions', { ...message.revisions });
  }
  return decodeConfirmedSnapshot(message, capabilities.executableWorkflowCommandIds);
}

function decodeFormActionSnapshot(
  message: ProjectionSnapshotV2Message,
  pending: FormActionIntentV2Message,
  previous: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (message.presentation.assignment.correlationId !== pending.navigationRequestId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'FORM_ACTION') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  if (
    message.revisions.stateRevision !== previous.revisions.stateRevision ||
    message.revisions.actorVisibilityRevision !== previous.revisions.actorVisibilityRevision ||
    message.revisions.projectionRevision !== previous.revisions.projectionRevision + 1
  ) {
    return unrecognized('$.revisions', { ...message.revisions });
  }
  const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
  if (!decoded.ok) return decoded;
  if (
    isCreationSetDecisionFormId(pending.sourceFormId) &&
    pending.actionKey === CREATION_SET_DECISION_FORMS[pending.sourceFormId].alternateActionKey
  ) {
    if (
      previous.layers.length !== 0 ||
      decoded.value.layers.length !== 1 ||
      !sameBasePresentation(decoded.value, previous)
    ) {
      return unrecognized(
        '$.presentation.layers',
        message.presentation.layers.map((layer) => layer.formId),
      );
    }
  }
  return decoded;
}

function decodeCheckpointTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.replay' | 'command.result' }
  >,
  pending: PendingIdentityCheckpoint,
): DecodeResult<CommandReceipt<IdentityCheckpointResult>> {
  const receipt = message.receipt;
  if (receipt.commandId !== pending.request.commandId) {
    return unrecognized('$.receipt.commandId', receipt.commandId);
  }
  if (receipt.receiptId.trim().length === 0) {
    return unrecognized('$.receipt.receiptId', receipt.receiptId);
  }
  const payload = pending.request.payload;
  const result = decodeProjection(receipt.result, '$.receipt.result', {
    branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
    characterDraftId: (field) => field === payload.characterDraftId,
    checkpointId: (field) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field) => field === payload.characterDraftId,
    checkpointRevision: (field) => field === 0,
    draftRevision: (field) => field === payload.draftRevision,
    nextFormId: (field) => field === 'CHR-010',
    stage: (field) => field === 'IDENTITY',
  });
  if (!result.ok) return result;
  if (
    receipt.revisions.stateRevision !== 0 ||
    receipt.revisions.projectionRevision !== 0 ||
    receipt.revisions.actorVisibilityRevision !== 0
  ) {
    return unrecognized('$.receipt.revisions', { ...receipt.revisions });
  }
  return {
    ok: true,
    value: receipt as CommandReceipt<IdentityCheckpointResult>,
  };
}

function sameCheckpointReceipt(
  left: CommandReceipt<IdentityCheckpointResult>,
  right: CommandReceipt<IdentityCheckpointResult>,
): boolean {
  return (
    left.commandId === right.commandId &&
    left.receiptId === right.receiptId &&
    (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).every(
      (axis) => left.revisions[axis] === right.revisions[axis],
    ) &&
    (Object.keys(left.result) as (keyof IdentityCheckpointResult)[]).every(
      (key) => left.result[key] === right.result[key],
    )
  );
}

function expectedSetDecisionNextForm(
  payload: RaceMethodSetDecisionPayload,
): 'CHR-002' | 'CHR-003' | 'CHR-016' | 'CHR-036' {
  switch (payload.sourceFormId) {
    case 'CHR-002':
      return 'CHR-003';
    case 'CHR-010':
      return payload.raceChoice === 'PURE' ? 'CHR-036' : 'CHR-016';
    case 'CHR-016':
      return 'CHR-036';
    case 'CHR-036':
      return 'CHR-002';
  }
}

function decodeStatRollSetDecisionTerminal(
  receipt: CommandReceipt<JsonObject>,
  pending: PendingSetDecision,
  payload: StatRollAcceptSetPayload | StatRollDialogDecisionPayload,
): DecodeResult<CommandReceipt<SetDecisionResult>> {
  const source = pending.sourceSnapshot;
  const active = activePresentedForm(source);
  const durable = payload.decision !== 'CANCEL';
  const common = {
    branchCacheHash: (field: JsonValue) => field === EMPTY_BRANCH_CACHE_HASH,
    branchUuid: isNonEmptyString,
    characterDraftId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointId: (field: JsonValue) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointRevision: (field: JsonValue) => isSafeIntegerAtLeast(field, 1),
    draftRevision: (field: JsonValue) => field === payload.draftRevision + (durable ? 1 : 0),
    sourceFormId: (field: JsonValue) => field === payload.sourceFormId,
    stage: (field: JsonValue) => field === 'STAT_ROLLS',
  };
  let decoded: DecodeResult<JsonObject>;
  if (payload.sourceFormId !== 'CHR-028') {
    if (active.formId !== payload.sourceFormId || source.layers.length !== 0) {
      return unrecognized('$.receipt.result.sourceFormId', payload.sourceFormId);
    }
    const rule = CREATION_SET_DECISION_FORMS[payload.sourceFormId];
    decoded = decodeProjection(receipt.result, '$.receipt.result', {
      ...common,
      acceptedSetReceiptId: (field) => field === source.projection[rule.receiptKey],
      assignmentMode: (field) => field === 'ROLLED_BIJECTION',
      decision: (field) => field === 'ACCEPT_SET',
      nextFormId: (field) => field === 'CHR-009',
    });
  } else {
    if (active.formId !== 'CHR-028' || source.layers.length !== 1) {
      return unrecognized('$.receipt.result.sourceFormId', payload.sourceFormId);
    }
    const dialog = active.projection as Chr028Projection;
    const originRule = CREATION_SET_DECISION_FORMS[dialog.originDecisionFormId];
    if (payload.decision === 'CANCEL') {
      decoded = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        decision: (field) => field === 'CANCEL',
        decisionReceiptIdOrNull: (field) => field === null,
        nextFormId: (field) => field === dialog.originDecisionFormId,
        originDecisionFormId: (field) => field === dialog.originDecisionFormId,
      });
    } else {
      const pointBuy = dialog.irreversibleConsequences.exactPointBuyTotalOrNull;
      const nextAttempt = dialog.irreversibleConsequences.nextAttemptIndexOrNull;
      decoded = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        abandonedSetReceiptIds: (field) => sameJson(field, dialog.abandonedSetReceiptIds),
        alternateDecision: (field) => field === originRule.alternateDecision,
        assignmentModeOrNull: (field) =>
          field === (pointBuy === 90 ? 'POINT_BUY_90' : pointBuy === 85 ? 'POINT_BUY_85' : null),
        decision: (field) => field === 'CONFIRM',
        irreversibleConsequences: (field) => sameJson(field, dialog.irreversibleConsequences),
        nextAttemptIndexOrNull: (field) => field === nextAttempt,
        nextFormId: (field) => field === (nextAttempt === null ? 'CHR-009' : 'CHR-003'),
        nextSetRollRequestIdOrNull: (field) =>
          nextAttempt === null ? field === null : isNonEmptyString(field),
        originDecisionFormId: (field) => field === dialog.originDecisionFormId,
        sourceSetReceiptIdOrNull: (field) => field === null,
        transitionKind: (field) => field === dialog.transitionKind,
      });
    }
  }
  if (!decoded.ok) return decoded;
  const sourceSetReceiptIds =
    payload.decision === 'CANCEL'
      ? (active.projection as Chr028Projection).abandonedSetReceiptIds
      : [];
  const resultIds = [
    payload.characterDraftId,
    payload.wizardCheckpointId,
    pending.request.commandId,
    receipt.receiptId,
    receipt.result['branchUuid'],
    receipt.result['acceptedSetReceiptId'],
    receipt.result['nextSetRollRequestIdOrNull'],
    ...(Array.isArray(receipt.result['abandonedSetReceiptIds'])
      ? (receipt.result['abandonedSetReceiptIds'] as readonly JsonValue[])
      : []),
    ...sourceSetReceiptIds,
  ].filter((entry): entry is string => typeof entry === 'string');
  if (new Set(resultIds).size !== resultIds.length) {
    return unrecognized('$.receipt.result.branchUuid', receipt.result['branchUuid']!);
  }
  const expected = pending.request.expectedRevisions;
  if (
    receipt.revisions.stateRevision !== expected.stateRevision + (durable ? 1 : 0) ||
    receipt.revisions.projectionRevision !== expected.projectionRevision + (durable ? 1 : 0) ||
    receipt.revisions.actorVisibilityRevision !== expected.actorVisibilityRevision
  ) {
    return unrecognized('$.receipt.revisions', { ...receipt.revisions });
  }
  return { ok: true, value: receipt as CommandReceipt<SetDecisionResult> };
}

function decodeSetDecisionTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.replay' | 'command.result' }
  >,
  pending: PendingSetDecision,
): DecodeResult<CommandReceipt<SetDecisionResult>> {
  const receipt = message.receipt;
  if (receipt.commandId !== pending.request.commandId) {
    return unrecognized('$.receipt.commandId', receipt.commandId);
  }
  if (receipt.receiptId.trim().length === 0) {
    return unrecognized('$.receipt.receiptId', receipt.receiptId);
  }
  const payload = pending.request.payload;
  if (payload.stage === 'STAT_ROLLS') {
    return decodeStatRollSetDecisionTerminal(receipt, pending, payload);
  }
  const expectedNextForm = expectedSetDecisionNextForm(payload);
  const common = {
    branchCacheHash: (field: JsonValue) => field === EMPTY_BRANCH_CACHE_HASH,
    characterDraftId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointId: (field: JsonValue) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointRevision: (field: JsonValue) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 1,
    draftRevision: (field: JsonValue) => field === payload.draftRevision + 1,
    nextFormId: (field: JsonValue) => field === expectedNextForm,
    sourceFormId: (field: JsonValue) => field === payload.sourceFormId,
    stage: (field: JsonValue) => field === 'RACE_AND_METHOD',
  };
  let result: DecodeResult<JsonObject>;
  switch (payload.sourceFormId) {
    case 'CHR-010':
      result = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        raceChoice: (field) => field === payload.raceChoice,
      });
      break;
    case 'CHR-016':
      result = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        symbiontAcquisitionMode: (field) => field === payload.symbiontAcquisitionMode,
      });
      break;
    case 'CHR-036':
      result = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        diceInputMode: (field) => field === payload.diceInputMode,
      });
      break;
    case 'CHR-002':
      result = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        branchUuid: isNonEmptyString,
        setRollRequestId: isNonEmptyString,
        statMethod: (field) => field === payload.statMethod,
      });
      if (result.ok) {
        const branchUuid = receipt.result['branchUuid'];
        const setRollRequestId = receipt.result['setRollRequestId'];
        const ids = [
          payload.characterDraftId,
          payload.wizardCheckpointId,
          pending.request.commandId,
          receipt.receiptId,
          branchUuid,
          setRollRequestId,
        ];
        if (ids.some((entry, index) => ids.indexOf(entry) !== index)) {
          return unrecognized('$.receipt.result.setRollRequestId', setRollRequestId!);
        }
      }
      break;
  }
  if (!result.ok) return result;
  const expectedRevisions = pending.request.expectedRevisions;
  if (
    receipt.revisions.stateRevision !== expectedRevisions.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== expectedRevisions.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !== expectedRevisions.actorVisibilityRevision
  ) {
    return unrecognized('$.receipt.revisions', { ...receipt.revisions });
  }
  return { ok: true, value: receipt as CommandReceipt<SetDecisionResult> };
}

function sameSetDecisionReceipt(
  left: CommandReceipt<SetDecisionResult>,
  right: CommandReceipt<SetDecisionResult>,
): boolean {
  return sameJson(left as unknown as JsonValue, right as unknown as JsonValue);
}

function decodeCreationCriticalOutcome(
  value: JsonValue,
  path: string,
  originFace: 1 | 20,
): DecodeResult<JsonObject> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const result = decodeProjection(value, path, {
    creationCriticalPenaltyOrNull: (field) =>
      field === null || (typeof field === 'number' && Number.isSafeInteger(field)),
    criticalGrade: (field) => isSafeIntegerAtLeast(field, 0) && field <= 5,
    criticalPolarity: (field) => field === 'FAILURE' || field === 'NONE' || field === 'SUCCESS',
    setEntryIndex: (field) => isSafeIntegerAtLeast(field, 0) && field <= 6,
    value: (field) => typeof field === 'number' && Number.isSafeInteger(field),
  });
  if (!result.ok) return result;
  const grade = value['criticalGrade'] as number;
  const polarity = value['criticalPolarity'];
  const penalty = value['creationCriticalPenaltyOrNull'];
  const resolvedValue = value['value'];
  const valid =
    (polarity === 'NONE' && grade === 0 && penalty === null && resolvedValue === originFace) ||
    (polarity === 'SUCCESS' &&
      originFace === 20 &&
      grade >= 1 &&
      penalty === null &&
      resolvedValue === 20 + grade) ||
    (polarity === 'FAILURE' &&
      originFace === 1 &&
      grade >= 1 &&
      penalty === -grade &&
      resolvedValue === 1);
  return valid ? { ok: true, value } : unrecognized(`${path}.criticalPolarity`, polarity!);
}

function decodeRollCommitTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.replay' | 'command.result' }
  >,
  pending: PendingRollCommit,
): DecodeResult<CommandReceipt<RollCommitResult>> {
  const receipt = message.receipt;
  if (receipt.commandId !== pending.request.commandId) {
    return unrecognized('$.receipt.commandId', receipt.commandId);
  }
  if (receipt.receiptId.trim().length === 0) {
    return unrecognized('$.receipt.receiptId', receipt.receiptId);
  }
  const payload = pending.request.payload;
  const common = {
    branchCacheHash: (field: JsonValue) => field === EMPTY_BRANCH_CACHE_HASH,
    branchUuid: (field: JsonValue) => field === payload.branchUuid,
    characterDraftId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointId: (field: JsonValue) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointRevision: (field: JsonValue) => isSafeIntegerAtLeast(field, 1),
    draftRevision: (field: JsonValue) => field === payload.draftRevision + 1,
    sourceFormId: (field: JsonValue) => field === payload.sourceFormId,
    stage: (field: JsonValue) => field === 'STAT_ROLLS',
  };
  let result: DecodeResult<JsonObject>;
  if (payload.sourceFormId === 'CHR-003') {
    const faces = decodeFaceSlots(receipt.result['faces']!, '$.receipt.result.faces', false);
    if (!faces.ok) return faces;
    const queue = decodeNaturalCriticalQueue(
      receipt.result['naturalCriticalQueue']!,
      '$.receipt.result.naturalCriticalQueue',
      faces.value,
    );
    if (!queue.ok) return queue;
    result = decodeProjection(receipt.result, '$.receipt.result', {
      ...common,
      confirmationRollRequestIdOrNull: (field) => field === null || isNonEmptyString(field),
      diceInputModeSnapshot: (field) =>
        field === (payload.manualFacesOrNull === null ? 'AUTO' : 'MANUAL'),
      faces: (field) => field === receipt.result['faces'],
      naturalCriticalQueue: (field) => field === receipt.result['naturalCriticalQueue'],
      nextFormId: (field) => field === (queue.value.length === 0 ? 'CHR-003' : 'CHR-004'),
      setRollReceiptId: (field) => field === receipt.receiptId,
      setRollRequestId: (field) => field === payload.setRollRequestId,
      shownResultLocked: (field) => field === true,
    });
    if (!result.ok) return result;
    if (
      payload.manualFacesOrNull !== null &&
      !sameJson(payload.manualFacesOrNull, receipt.result['faces']!)
    ) {
      return unrecognized('$.receipt.result.faces', receipt.result['faces']!);
    }
    const confirmationId = receipt.result['confirmationRollRequestIdOrNull'];
    if ((queue.value.length === 0) !== (confirmationId === null)) {
      return unrecognized('$.receipt.result.confirmationRollRequestIdOrNull', confirmationId!);
    }
  } else {
    const source = pending.sourceProjection;
    if (source['commandId'] !== null || !('originFace' in source)) {
      return unrecognized('$.receipt.result.sourceFormId', payload.sourceFormId);
    }
    const confirmationSource = source as Chr004Projection;
    const outcomeValue = receipt.result['outcomeOrNull'];
    if (outcomeValue !== null && outcomeValue !== undefined) {
      const outcome = decodeCreationCriticalOutcome(
        outcomeValue,
        '$.receipt.result.outcomeOrNull',
        confirmationSource.originFace,
      );
      if (!outcome.ok) return outcome;
    }
    result = decodeProjection(receipt.result, '$.receipt.result', {
      ...common,
      confirmationFace: (field) =>
        isFace(field) && (payload.manualFaceOrNull === null || field === payload.manualFaceOrNull),
      confirmationReceiptId: (field) => field === receipt.receiptId,
      confirmationRollRequestId: (field) => field === payload.confirmationRollRequestId,
      criticalQueueIndex: (field) => field === payload.criticalQueueIndex,
      nextConfirmationRollRequestIdOrNull: (field) => field === null || isNonEmptyString(field),
      nextFormId: (field) => field === 'CHR-004',
      originFace: (field) => field === confirmationSource.originFace,
      outcomeOrNull: (field) => field === null || isJsonObject(field),
      returnDecisionFormId: (field) => field === confirmationSource.returnDecisionFormId,
      setRollReceiptId: (field) => field === payload.setRollReceiptId,
    });
    if (!result.ok) return result;
    if (
      receipt.result['outcomeOrNull'] === null &&
      receipt.result['nextConfirmationRollRequestIdOrNull'] === null
    ) {
      return unrecognized(
        '$.receipt.result.nextConfirmationRollRequestIdOrNull',
        receipt.result['nextConfirmationRollRequestIdOrNull']!,
      );
    }
  }
  const expectedRevisions = pending.request.expectedRevisions;
  if (
    receipt.revisions.stateRevision !== expectedRevisions.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== expectedRevisions.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !== expectedRevisions.actorVisibilityRevision
  ) {
    return unrecognized('$.receipt.revisions', { ...receipt.revisions });
  }
  return { ok: true, value: receipt as CommandReceipt<RollCommitResult> };
}

function sameJson(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    const leftEntries = left as readonly JsonValue[];
    const rightEntries = right as readonly JsonValue[];
    return (
      leftEntries.length === rightEntries.length &&
      leftEntries.every((entry, index) => sameJson(entry, rightEntries[index]!))
    );
  }
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key]!, right[key]!))
  );
}

function sameRollCommitReceipt(
  left: CommandReceipt<RollCommitResult>,
  right: CommandReceipt<RollCommitResult>,
): boolean {
  return sameJson(left as unknown as JsonValue, right as unknown as JsonValue);
}

function checkpointSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<IdentityCheckpointResult>,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (snapshot.formId !== 'CHR-010') {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  const projection = snapshot.projection;
  for (const [key, expected] of [
    ['characterDraftId', receipt.result.characterDraftId],
    ['wizardCheckpointId', receipt.result.checkpointId],
    ['draftRevision', receipt.result.draftRevision],
  ] as const) {
    if (projection[key] !== expected) {
      return unrecognized(`$.presentation.base.roleFilteredPayload.${key}`, projection[key]!);
    }
  }
  return { ok: true, value: snapshot };
}

function setDecisionSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<SetDecisionResult>,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (receipt.result.stage === 'STAT_ROLLS') {
    const result = receipt.result;
    const projection = snapshot.projection;
    const exactReceiptRevisions = (projectionOffset: number) =>
      snapshot.revisions.actorVisibilityRevision === receipt.revisions.actorVisibilityRevision &&
      snapshot.revisions.projectionRevision ===
        receipt.revisions.projectionRevision + projectionOffset &&
      snapshot.revisions.stateRevision === receipt.revisions.stateRevision;
    if (result.decision === 'CANCEL') {
      if (
        snapshot.formId !== result.originDecisionFormId ||
        snapshot.layers.length !== 0 ||
        !sameBasePresentation(snapshot, source) ||
        !exactReceiptRevisions(1)
      ) {
        return unrecognized('$.presentation.base.formId', snapshot.formId);
      }
      return { ok: true, value: snapshot };
    }
    if (!exactReceiptRevisions(0)) {
      return unrecognized('$.revisions', { ...snapshot.revisions });
    }
    if (
      projection['characterDraftId'] !== result.characterDraftId ||
      projection['wizardCheckpointId'] !== result.checkpointId ||
      projection['draftRevision'] !== result.draftRevision
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.draftRevision',
        projection['draftRevision']!,
      );
    }
    if (result.decision === 'ACCEPT_SET') {
      const rule = CREATION_SET_DECISION_FORMS[result.sourceFormId];
      if (
        snapshot.formId !== result.sourceFormId ||
        snapshot.layers.length !== 0 ||
        projection[rule.receiptKey] !== result.acceptedSetReceiptId ||
        projection['attemptIndex'] !== source.projection['attemptIndex'] ||
        projection['decision'] !== 'ACCEPT_SET' ||
        projection['decisionReceiptIdOrNull'] !== receipt.receiptId ||
        projection['commandId'] !== receipt.commandId
      ) {
        return unrecognized('$.presentation.base.formId', snapshot.formId);
      }
      return { ok: true, value: snapshot };
    }
    if (result.nextFormId === 'CHR-003') {
      if (
        snapshot.formId !== 'CHR-003' ||
        snapshot.layers.length !== 0 ||
        projection['branchUuid'] !== result.branchUuid ||
        projection['attemptIndex'] !== result.nextAttemptIndexOrNull ||
        projection['setRollRequestId'] !== result.nextSetRollRequestIdOrNull
      ) {
        return unrecognized('$.presentation.base.formId', snapshot.formId);
      }
      return { ok: true, value: snapshot };
    }
    const layer = snapshot.layers[0];
    const rule = CREATION_SET_DECISION_FORMS[result.originDecisionFormId];
    if (
      snapshot.formId !== result.originDecisionFormId ||
      snapshot.layers.length !== 1 ||
      layer === undefined ||
      layer.projection.decision !== 'CONFIRM' ||
      layer.projection.decisionReceiptIdOrNull !== receipt.receiptId ||
      layer.projection.commandId !== receipt.commandId ||
      projection[rule.receiptKey] !== result.abandonedSetReceiptIds[0] ||
      projection['attemptIndex'] !== source.projection['attemptIndex'] ||
      projection['decision'] !== result.alternateDecision ||
      projection['decisionReceiptIdOrNull'] !== receipt.receiptId ||
      projection['commandId'] !== receipt.commandId
    ) {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
    return { ok: true, value: snapshot };
  }
  let advance: number | null = null;
  switch (receipt.result.sourceFormId) {
    case 'CHR-010':
      if (receipt.result.nextFormId === 'CHR-016') {
        advance =
          snapshot.formId === 'CHR-016'
            ? 0
            : snapshot.formId === 'CHR-036'
              ? 1
              : snapshot.formId === 'CHR-002'
                ? 2
                : null;
      } else {
        advance = snapshot.formId === 'CHR-036' ? 0 : snapshot.formId === 'CHR-002' ? 1 : null;
      }
      break;
    case 'CHR-016':
      advance = snapshot.formId === 'CHR-036' ? 0 : snapshot.formId === 'CHR-002' ? 1 : null;
      break;
    case 'CHR-036':
      advance = snapshot.formId === 'CHR-002' ? 0 : null;
      break;
    case 'CHR-002': {
      if (snapshot.formId !== 'CHR-003' && snapshot.formId !== 'CHR-004') break;
      const currentDraftRevision = snapshot.projection['draftRevision'];
      if (
        typeof currentDraftRevision === 'number' &&
        Number.isSafeInteger(currentDraftRevision) &&
        currentDraftRevision >= receipt.result.draftRevision
      ) {
        advance = currentDraftRevision - receipt.result.draftRevision;
      }
      break;
    }
  }
  if (advance === null) {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  const projection = snapshot.projection;
  for (const [key, expected] of [
    ['characterDraftId', receipt.result.characterDraftId],
    ['wizardCheckpointId', receipt.result.checkpointId],
    ['draftRevision', receipt.result.draftRevision + advance],
  ] as const) {
    if (projection[key] !== expected) {
      return unrecognized(`$.presentation.base.roleFilteredPayload.${key}`, projection[key]!);
    }
  }
  if (
    snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
    snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision + advance ||
    snapshot.revisions.stateRevision !== receipt.revisions.stateRevision + advance
  ) {
    return unrecognized('$.revisions', { ...snapshot.revisions });
  }
  if (
    receipt.result.sourceFormId === 'CHR-010' &&
    snapshot.formId === 'CHR-016' &&
    projection['raceChoice'] !== receipt.result.raceChoice
  ) {
    return unrecognized(
      '$.presentation.base.roleFilteredPayload.raceChoice',
      projection['raceChoice']!,
    );
  }
  if (receipt.result.sourceFormId === 'CHR-002') {
    const expectedFields = [
      ['branchUuid', receipt.result.branchUuid],
      ...(snapshot.formId === 'CHR-003'
        ? ([
            ['setRollRequestId', receipt.result.setRollRequestId],
            ['statMethod', receipt.result.statMethod],
            ['attemptIndex', 1],
          ] as const)
        : []),
    ] as const;
    for (const [key, expected] of expectedFields) {
      if (projection[key] !== expected) {
        return unrecognized(`$.presentation.base.roleFilteredPayload.${key}`, projection[key]!);
      }
    }
  }
  return { ok: true, value: snapshot };
}

function reconnectSnapshotMatchesUnjournaledCancel(
  snapshot: ConfirmedProjectionSnapshot,
  pending: PendingSetDecision,
): DecodeResult<ConfirmedProjectionSnapshot> {
  const payload = pending.request.payload;
  const source = pending.sourceSnapshot;
  const dialog = source.layers[0];
  if (
    payload.stage !== 'STAT_ROLLS' ||
    payload.decision !== 'CANCEL' ||
    source.layers.length !== 1 ||
    dialog === undefined ||
    snapshot.formId !== dialog.projection.originDecisionFormId ||
    snapshot.layers.length !== 0 ||
    !sameBasePresentation(snapshot, source)
  ) {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  if (
    snapshot.revisions.actorVisibilityRevision !== source.revisions.actorVisibilityRevision ||
    snapshot.revisions.stateRevision !== source.revisions.stateRevision ||
    snapshot.revisions.projectionRevision < source.revisions.projectionRevision
  ) {
    return unrecognized('$.revisions', { ...snapshot.revisions });
  }
  return { ok: true, value: snapshot };
}

function rollCommitSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<RollCommitResult>,
): DecodeResult<ConfirmedProjectionSnapshot> {
  const result = receipt.result;
  if (snapshot.formId !== 'CHR-003' && snapshot.formId !== 'CHR-004') {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  if (result.sourceFormId === 'CHR-003') {
    if (result.nextFormId === 'CHR-003' && snapshot.formId !== 'CHR-003') {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
  } else if (snapshot.formId !== 'CHR-004') {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  const projection = snapshot.projection;
  const currentDraftRevision = projection['draftRevision'];
  if (
    typeof currentDraftRevision !== 'number' ||
    !Number.isSafeInteger(currentDraftRevision) ||
    currentDraftRevision < result.draftRevision
  ) {
    return unrecognized(
      '$.presentation.base.roleFilteredPayload.draftRevision',
      currentDraftRevision!,
    );
  }
  const advance = currentDraftRevision - result.draftRevision;
  for (const [key, expected] of [
    ['characterDraftId', result.characterDraftId],
    ['wizardCheckpointId', result.checkpointId],
    ['branchUuid', result.branchUuid],
  ] as const) {
    if (projection[key] !== expected) {
      return unrecognized(`$.presentation.base.roleFilteredPayload.${key}`, projection[key]!);
    }
  }
  if (
    snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
    snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision + advance ||
    snapshot.revisions.stateRevision !== receipt.revisions.stateRevision + advance
  ) {
    return unrecognized('$.revisions', { ...snapshot.revisions });
  }
  if (result.sourceFormId === 'CHR-003') {
    if (projection['setRollReceiptId'] !== result.setRollReceiptId) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.setRollReceiptId',
        projection['setRollReceiptId']!,
      );
    }
    if (
      snapshot.formId === 'CHR-003' &&
      (projection['setRollRequestId'] !== result.setRollRequestId ||
        !sameJson(projection['facesOrManualInputs']!, result.faces) ||
        !sameJson(projection['naturalCriticalQueue']!, result.naturalCriticalQueue) ||
        projection['shownResultLocked'] !== true)
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.setRollRequestId',
        projection['setRollRequestId']!,
      );
    }
    if (
      advance === 0 &&
      snapshot.formId === 'CHR-004' &&
      projection['confirmationRollRequestId'] !== result.confirmationRollRequestIdOrNull
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.confirmationRollRequestId',
        projection['confirmationRollRequestId']!,
      );
    }
  } else {
    if (projection['setRollReceiptId'] !== result.setRollReceiptId) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.setRollReceiptId',
        projection['setRollReceiptId']!,
      );
    }
    if (advance === 0) {
      const nextRequestId = result.nextConfirmationRollRequestIdOrNull;
      const terminal = nextRequestId === null;
      if (
        projection['confirmationRollRequestId'] !==
          (terminal ? result.confirmationRollRequestId : nextRequestId) ||
        projection['confirmationFace'] !== (terminal ? result.confirmationFace : null) ||
        projection['confirmationReceiptId'] !== (terminal ? result.confirmationReceiptId : null) ||
        projection['returnDecisionFormId'] !== result.returnDecisionFormId ||
        (terminal &&
          (projection['criticalQueueIndex'] !== result.criticalQueueIndex ||
            projection['originFace'] !== result.originFace))
      ) {
        return unrecognized(
          '$.presentation.base.roleFilteredPayload.confirmationRollRequestId',
          projection['confirmationRollRequestId']!,
        );
      }
    }
  }
  return { ok: true, value: snapshot };
}

function decodeCommandDestinationSnapshot(
  message: ProjectionSnapshotV2Message,
  pending: PendingIdentityCheckpoint & {
    readonly receipt: CommandReceipt<IdentityCheckpointResult>;
  },
  previous: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (message.presentation.assignment.correlationId !== pending.request.commandId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'COMMAND_DESTINATION') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  if (
    (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).some(
      (axis) => message.revisions[axis] !== pending.receipt.revisions[axis],
    )
  ) {
    return unrecognized('$.revisions', { ...message.revisions });
  }
  const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
  return decoded.ok ? checkpointSnapshotMatchesReceipt(decoded.value, pending.receipt) : decoded;
}

function decodeSetDecisionDestinationSnapshot(
  message: ProjectionSnapshotV2Message,
  pending: PendingSetDecision & {
    readonly receipt: CommandReceipt<SetDecisionResult>;
  },
  previous: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (message.presentation.assignment.correlationId !== pending.request.commandId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'COMMAND_DESTINATION') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
  return decoded.ok
    ? setDecisionSnapshotMatchesReceipt(decoded.value, pending.receipt, previous)
    : decoded;
}

function decodeRollCommitDestinationSnapshot(
  message: ProjectionSnapshotV2Message,
  pending: PendingRollCommit & {
    readonly receipt: CommandReceipt<RollCommitResult>;
  },
  previous: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (message.presentation.assignment.correlationId !== pending.request.commandId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'COMMAND_DESTINATION') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
  return decoded.ok ? rollCommitSnapshotMatchesReceipt(decoded.value, pending.receipt) : decoded;
}

function decodeDeviceIdentity(value: unknown): DecodeResult<string> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object with deviceId',
      path: '$',
    });
  }
  const keys = exactObjectKeys(value, DEVICE_ID_KEYS, '$');
  if (!keys.ok) return keys;
  const deviceId = value['deviceId'];
  if (typeof deviceId !== 'string') {
    return refused({
      actualType: wireType(deviceId),
      code: 'INVALID_SHAPE',
      expected: 'canonical lowercase UUID v4',
      path: '$.deviceId',
    });
  }
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    return unrecognized('$.deviceId', deviceId);
  }
  return { ok: true, value: deviceId };
}

function decodeDeviceIdentityError(value: unknown): DecodeResult<string> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object with error',
      path: '$',
    });
  }
  const keys = exactObjectKeys(value, DEVICE_ID_ERROR_KEYS, '$');
  if (!keys.ok) return keys;
  const detail = value['error'];
  if (typeof detail !== 'string' || detail.length === 0) {
    return refused({
      actualType: wireType(detail),
      code: 'INVALID_SHAPE',
      expected: 'non-empty error string',
      path: '$.error',
    });
  }
  return { ok: true, value: detail };
}

export function stateSocketUrl(pageHref: string): string {
  const url = new URL('/state', pageHref);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else throw new Error(`web client cannot derive a WebSocket URL from ${url.protocol}`);
  return url.href;
}

function deviceIdentityUrl(pageHref: string): string {
  return new URL('/device-identity', pageHref).href;
}

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRequestId(prefix: 'command' | 'identity' | 'navigation' | 'reconnect'): string {
  const entropy = crypto.getRandomValues(new Uint32Array(4));
  return `${prefix}-${[...entropy].map((value) => value.toString(16).padStart(8, '0')).join('')}`;
}

function envelopeProtocolVersion(source: string): unknown {
  try {
    const value: unknown = JSON.parse(source);
    return isJsonObject(value) ? value['protocolVersion'] : undefined;
  } catch {
    return undefined;
  }
}

function identityCheckpointPayload(
  snapshot: ConfirmedProjectionSnapshot,
): IdentityCheckpointPayload {
  const value = snapshot.projection;
  return {
    stage: 'IDENTITY',
    characterDraftId: value['characterDraftId'] as string,
    wizardCheckpointId: value['wizardCheckpointId'] as string,
    draftRevision: value['draftRevision'] as number,
    name: value['name'] as string,
    description: value['description'] as string | null,
    artAssetKeyOrLocalFile: value[
      'artAssetKeyOrLocalFile'
    ] as IdentityDraftValues['artAssetKeyOrLocalFile'],
    age: value['age'] as number,
    sex: value['sex'] as Exclude<IdentityDraftValues['sex'], null>,
    massKg: value['massKg'] as number,
  };
}

function setDecisionPayload(
  snapshot: ConfirmedProjectionSnapshot,
  choice: CharacterCreationChoiceDraft,
): SetDecisionPayload {
  if (choice.formId !== snapshot.formId) {
    throw new Error(`character creation choice ${choice.formId} does not match ${snapshot.formId}`);
  }
  const common = {
    characterDraftId: snapshot.projection['characterDraftId'] as string,
    draftRevision: snapshot.projection['draftRevision'] as number,
    stage: 'RACE_AND_METHOD',
    wizardCheckpointId: snapshot.projection['wizardCheckpointId'] as string,
  } as const;
  switch (choice.formId) {
    case 'CHR-010':
      return { ...common, raceChoice: choice.value, sourceFormId: choice.formId };
    case 'CHR-016':
      return {
        ...common,
        sourceFormId: choice.formId,
        symbiontAcquisitionMode: choice.value,
      };
    case 'CHR-036':
      return { ...common, diceInputMode: choice.value, sourceFormId: choice.formId };
    case 'CHR-002':
      return { ...common, sourceFormId: choice.formId, statMethod: choice.value };
  }
}

function statRollSetDecisionPayload(
  snapshot: ConfirmedProjectionSnapshot,
  actionKey: ActionKey,
): StatRollAcceptSetPayload | StatRollDialogDecisionPayload | null {
  const active = activePresentedForm(snapshot);
  const common = {
    characterDraftId: active.projection['characterDraftId'] as string,
    draftRevision: active.projection['draftRevision'] as number,
    stage: 'STAT_ROLLS',
    wizardCheckpointId: active.projection['wizardCheckpointId'] as string,
  } as const;
  if (isCreationSetDecisionFormId(active.formId)) {
    const rule = CREATION_SET_DECISION_FORMS[active.formId];
    return actionKey === rule.acceptActionKey
      ? { ...common, decision: 'ACCEPT_SET', sourceFormId: active.formId }
      : null;
  }
  if (active.formId !== 'CHR-028') return null;
  if (actionKey === 'CHR-028::CTA::001') {
    return { ...common, decision: 'CONFIRM', sourceFormId: 'CHR-028' };
  }
  return actionKey === 'CHR-028::CTA::002'
    ? { ...common, decision: 'CANCEL', sourceFormId: 'CHR-028' }
    : null;
}

function rollCommitPayload(
  snapshot: ConfirmedProjectionSnapshot,
  draft: CharacterCreationRollDraft | null,
): RollCommitPayload {
  const common = {
    branchUuid: snapshot.projection['branchUuid'] as string,
    characterDraftId: snapshot.projection['characterDraftId'] as string,
    draftRevision: snapshot.projection['draftRevision'] as number,
    stage: 'STAT_ROLLS',
    wizardCheckpointId: snapshot.projection['wizardCheckpointId'] as string,
  } as const;
  if (snapshot.formId === 'CHR-003') {
    const manualFacesOrNull =
      snapshot.projection['diceInputModeSnapshot'] === 'AUTO'
        ? null
        : draft?.formId === 'CHR-003' && completeManualRollDraft(draft)
          ? (draft.faces as readonly number[])
          : null;
    if (snapshot.projection['diceInputModeSnapshot'] === 'MANUAL' && manualFacesOrNull === null) {
      throw new Error('CHR-003 requires seven complete MANUAL faces');
    }
    return {
      ...common,
      manualFacesOrNull,
      setRollRequestId: snapshot.projection['setRollRequestId'] as string,
      sourceFormId: 'CHR-003',
    };
  }
  if (snapshot.formId === 'CHR-004') {
    const manualFaceOrNull =
      snapshot.projection['diceInputModeSnapshot'] === 'AUTO'
        ? null
        : draft?.formId === 'CHR-004' && completeManualRollDraft(draft)
          ? draft.face
          : null;
    if (snapshot.projection['diceInputModeSnapshot'] === 'MANUAL' && manualFaceOrNull === null) {
      throw new Error('CHR-004 requires one complete MANUAL face');
    }
    return {
      ...common,
      confirmationRollRequestId: snapshot.projection['confirmationRollRequestId'] as string,
      criticalQueueIndex: snapshot.projection['criticalQueueIndex'] as number,
      manualFaceOrNull,
      setRollReceiptId: snapshot.projection['setRollReceiptId'] as string,
      sourceFormId: 'CHR-004',
    };
  }
  throw new Error(`ROLL-COMMIT is unavailable on ${snapshot.formId}`);
}

export function connectProjection(
  onState: (state: WebClientState) => void,
  onIdentityDraft: (state: IdentityDraftClientState | null) => void = () => {},
  onCreationChoiceDraft: (value: CharacterCreationChoiceDraft | null) => void = () => {},
  onCreationRollDraft: (value: CharacterCreationRollDraft | null) => void = () => {},
): ProjectionConnection {
  let deviceId: string | null = null;
  let disposed = false;
  let identity: IdentityDraftClient | null = null;
  let terminal = false;
  let lastSnapshot: ConfirmedProjectionSnapshot | null = null;
  let pendingCheckpoint: PendingIdentityCheckpoint | null = null;
  let pendingSetDecision: PendingSetDecision | null = null;
  let pendingRollCommit: PendingRollCommit | null = null;
  let pendingFormAction: FormActionIntentV2Message | null = null;
  let playerContextId: string | null = null;
  let creationChoiceDraft: CharacterCreationChoiceDraft | null = null;
  let creationRollDraft: CharacterCreationRollDraft | null = null;
  let socket: WebSocket | null = null;
  let stagedCapabilities: SessionReconnectCapabilitiesV2Message | null = null;
  const commandPending = () =>
    pendingCheckpoint !== null || pendingSetDecision !== null || pendingRollCommit !== null;
  const visibleLast = () =>
    lastSnapshot === null
      ? null
      : visibleSnapshot(
          lastSnapshot,
          identity,
          commandPending(),
          creationChoiceDraft,
          creationRollDraft,
        );

  const closeAfterTerminalState = () => {
    if (
      socket !== null &&
      (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
    ) {
      socket.close(1002, 'wire frame refused');
    }
  };

  const failProtocol = (refusal: DecodeRefusal, detail: string) => {
    if (disposed || terminal) return;
    terminal = true;
    pendingCheckpoint = null;
    pendingSetDecision = null;
    pendingRollCommit = null;
    pendingFormAction = null;
    stagedCapabilities = null;
    const response = {
      messageType: 'protocol.refusal',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      refusal,
      relatedCommandId: null,
    } as const satisfies ProtocolRefusalMessage;
    const encoded = encodeClientMessage(response, WEB_PROTOCOL_VOCABULARY);
    let deliveryDetail = '';
    if (!encoded.ok) {
      deliveryDetail = ` Checked refusal could not be encoded: ${JSON.stringify(encoded.refusal)}.`;
    } else if (socket === null || socket.readyState !== WebSocket.OPEN) {
      deliveryDetail = ` Checked refusal was not sent because socket state is ${String(socket?.readyState)}.`;
    } else {
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        deliveryDetail = ` Checked refusal could not be sent: ${diagnostic(error)}.`;
      }
    }
    onState({
      detail: `${detail}${deliveryDetail}`,
      kind: 'protocol-error',
      refusal,
      snapshot: visibleLast(),
    });
    closeAfterTerminalState();
  };
  const failUnexpected = (path: string, value: JsonValue, detail: string): void =>
    failProtocol({ code: 'UNRECOGNIZED', path, value }, detail);

  const sendIdentity = (request: ReturnType<IdentityDraftClient['edit']>): boolean => {
    if (request === null || socket === null || socket.readyState !== WebSocket.OPEN) return false;
    const encoded = encodeClientMessageV3(request, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok)
      throw new Error(`identity draft encoding failed: ${JSON.stringify(encoded.refusal)}`);
    socket.send(encoded.text);
    return true;
  };

  const adoptSnapshot = (next: ConfirmedProjectionSnapshot, reconnect: boolean): void => {
    lastSnapshot = next;
    if (next.formId === 'CHR-010') pendingCheckpoint = null;
    if (pendingSetDecision !== null) pendingSetDecision = null;
    if (pendingRollCommit !== null) pendingRollCommit = null;
    creationChoiceDraft = null;
    onCreationChoiceDraft(creationChoiceDraft);
    creationRollDraft = creationRollDraftFromSnapshot(next);
    onCreationRollDraft(creationRollDraft);
    if (next.formId === 'APP-001') playerContextId = null;
    else if (next.formId === 'APP-002') playerContextId = next.projection['contextId'] as string;
    const draft = identitySnapshot(next, playerContextId);
    let replay = null;
    if (draft === null) identity = null;
    else if (identity === null || !reconnect)
      identity = new IdentityDraftClient(draft, () => createRequestId('identity'));
    else replay = identity.resumeAfterSnapshot(draft);
    onIdentityDraft(identity?.state ?? null);
    onState({
      kind: 'ready',
      snapshot: visibleSnapshot(
        next,
        identity,
        commandPending(),
        creationChoiceDraft,
        creationRollDraft,
      ),
    });
    sendIdentity(replay);
  };

  const attachSocket = (
    activeSocket: WebSocket,
    requestId: string,
    reconnectText: string,
  ): void => {
    let expectingCapabilities = true;
    socket = activeSocket;

    activeSocket.onopen = () => {
      if (disposed || terminal || socket !== activeSocket) return;
      try {
        activeSocket.send(reconnectText);
      } catch (error: unknown) {
        socket = null;
        onState({
          code: null,
          detail: `session.reconnect could not be sent: ${diagnostic(error)}`,
          kind: 'disconnected',
          snapshot: visibleLast(),
        });
        return;
      }
      onState({ kind: 'awaiting-snapshot' });
    };

    activeSocket.onmessage = (event) => {
      if (disposed || terminal || socket !== activeSocket) return;
      const frame: unknown = event.data as unknown;
      if (typeof frame !== 'string') {
        failProtocol(
          {
            actualType: wireType(frame),
            code: 'INVALID_SHAPE',
            expected: 'text application frame',
            path: '$',
          },
          'Host sent a binary wire frame.',
        );
        return;
      }

      if (envelopeProtocolVersion(frame) === WIRE_PROTOCOL_VERSION) {
        const decoded = decodeHostMessage(frame, WEB_PROTOCOL_VOCABULARY);
        if (!decoded.ok) {
          failProtocol(decoded.refusal, 'Host frame did not decode as wire v1.');
          return;
        }
        if (stagedCapabilities !== null) {
          failUnexpected(
            '$.messageType',
            decoded.value.messageType,
            'A wire v1 frame interrupted the staged reconnect pair.',
          );
          return;
        }
        const message = decoded.value;
        if (message.messageType === 'command.result' || message.messageType === 'command.replay') {
          if (pendingCheckpoint !== null) {
            if (pendingCheckpoint.receipt !== null && message.messageType !== 'command.replay') {
              failUnexpected(
                '$.messageType',
                message.messageType,
                'Host sent a second non-replay identity checkpoint terminal.',
              );
              return;
            }
            const receipt = decodeCheckpointTerminal(message, pendingCheckpoint);
            if (!receipt.ok) {
              failProtocol(receipt.refusal, 'Host sent an invalid identity checkpoint receipt.');
              return;
            }
            if (
              pendingCheckpoint.receipt !== null &&
              !sameCheckpointReceipt(pendingCheckpoint.receipt, receipt.value)
            ) {
              failUnexpected(
                '$.receipt.receiptId',
                receipt.value.receiptId,
                'Host replay changed the confirmed identity checkpoint receipt.',
              );
              return;
            }
            pendingCheckpoint = { request: pendingCheckpoint.request, receipt: receipt.value };
          } else if (pendingSetDecision !== null) {
            if (pendingSetDecision.receipt !== null && message.messageType !== 'command.replay') {
              failUnexpected(
                '$.messageType',
                message.messageType,
                'Host sent a second non-replay SET-DECIDE terminal.',
              );
              return;
            }
            const receipt = decodeSetDecisionTerminal(message, pendingSetDecision);
            if (!receipt.ok) {
              failProtocol(receipt.refusal, 'Host sent an invalid SET-DECIDE receipt.');
              return;
            }
            if (
              pendingSetDecision.receipt !== null &&
              !sameSetDecisionReceipt(pendingSetDecision.receipt, receipt.value)
            ) {
              failUnexpected(
                '$.receipt.receiptId',
                receipt.value.receiptId,
                'Host replay changed the confirmed SET-DECIDE receipt.',
              );
              return;
            }
            pendingSetDecision = { ...pendingSetDecision, receipt: receipt.value };
          } else if (pendingRollCommit !== null) {
            if (pendingRollCommit.receipt !== null && message.messageType !== 'command.replay') {
              failUnexpected(
                '$.messageType',
                message.messageType,
                'Host sent a second non-replay ROLL-COMMIT terminal.',
              );
              return;
            }
            const receipt = decodeRollCommitTerminal(message, pendingRollCommit);
            if (!receipt.ok) {
              failProtocol(receipt.refusal, 'Host sent an invalid ROLL-COMMIT receipt.');
              return;
            }
            if (
              pendingRollCommit.receipt !== null &&
              !sameRollCommitReceipt(pendingRollCommit.receipt, receipt.value)
            ) {
              failUnexpected(
                '$.receipt.receiptId',
                receipt.value.receiptId,
                'Host replay changed the confirmed ROLL-COMMIT receipt.',
              );
              return;
            }
            pendingRollCommit = { ...pendingRollCommit, receipt: receipt.value };
          } else {
            failUnexpected(
              '$.messageType',
              message.messageType,
              'Host sent a command terminal without exactly one pending wizard command.',
            );
            return;
          }
          if (lastSnapshot !== null && !expectingCapabilities) {
            onState({
              kind: 'ready',
              snapshot: visibleSnapshot(
                lastSnapshot,
                identity,
                true,
                creationChoiceDraft,
                creationRollDraft,
              ),
            });
          }
          return;
        }
        if (message.messageType === 'command.refusal') {
          const matchesCheckpoint =
            pendingCheckpoint !== null &&
            pendingCheckpoint.receipt === null &&
            message.commandId === pendingCheckpoint.request.commandId;
          const matchesSetDecision =
            pendingSetDecision !== null &&
            pendingSetDecision.receipt === null &&
            message.commandId === pendingSetDecision.request.commandId;
          const matchesRollCommit =
            pendingRollCommit !== null &&
            pendingRollCommit.receipt === null &&
            message.commandId === pendingRollCommit.request.commandId;
          if (
            (!matchesCheckpoint && !matchesSetDecision && !matchesRollCommit) ||
            lastSnapshot === null
          ) {
            failUnexpected(
              '$.commandId',
              message.commandId,
              'Host command refusal does not match the pending wizard command.',
            );
            return;
          }
          if (matchesCheckpoint) pendingCheckpoint = null;
          if (matchesSetDecision) pendingSetDecision = null;
          if (matchesRollCommit) pendingRollCommit = null;
          if (!expectingCapabilities) {
            onState({
              kind: 'command-refusal',
              refusal: message.refusal,
              snapshot: visibleSnapshot(
                lastSnapshot,
                identity,
                commandPending(),
                creationChoiceDraft,
                creationRollDraft,
              ),
            });
          }
          return;
        }
        if (message.messageType === 'protocol.refusal') {
          terminal = true;
          onState({
            kind: 'host-refusal',
            refusal: message.refusal,
            snapshot: visibleLast(),
          });
          closeAfterTerminalState();
          return;
        }
        failUnexpected(
          '$.messageType',
          message.messageType,
          'Host sent a wire v1 message that this reconnect did not request.',
        );
        return;
      }

      if (envelopeProtocolVersion(frame) === WIRE_PROTOCOL_V3_VERSION) {
        const decoded = decodeHostMessageV3(frame, WEB_PROTOCOL_VOCABULARY);
        if (!decoded.ok) {
          failProtocol(decoded.refusal, 'Host frame did not decode as wire v3.');
          return;
        }
        const message = decoded.value;
        if (expectingCapabilities || stagedCapabilities !== null) {
          failUnexpected(
            '$.messageType',
            message.messageType,
            'A wire v3 frame interrupted the staged reconnect pair.',
          );
          return;
        }
        if (message.messageType === 'character.identity-draft.result') {
          if (identity === null || lastSnapshot === null) return;
          const candidate = decodeConfirmedSnapshot(
            {
              messageType: 'projection.snapshot',
              presentation: {
                assignment: { correlationId: message.draftUpdateId, reason: 'FORM_ACTION' },
                ...message.presentation,
              },
              projectionRole: message.projectionRole,
              protocolVersion: WIRE_PROTOCOL_V2_VERSION,
              revisions: message.revisions,
            },
            lastSnapshot.executableWorkflowCommandIds,
          );
          if (!candidate.ok) {
            failProtocol(candidate.refusal, 'Host sent an invalid identity draft result.');
            return;
          }
          const draft = identitySnapshot(candidate.value, playerContextId);
          if (draft === null) return;
          const outstanding = identity.state.outstanding;
          const applicable =
            outstanding?.draftUpdateId === message.draftUpdateId &&
            message.scope.contextId === playerContextId &&
            outstanding.scope.contextId === message.scope.contextId &&
            outstanding.scope.characterDraftId === message.scope.characterDraftId &&
            outstanding.scope.wizardCheckpointId === message.scope.wizardCheckpointId &&
            message.draftRevision >= (lastSnapshot.projection['draftRevision'] as number) &&
            (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).every(
              (axis) => message.revisions[axis] >= lastSnapshot!.revisions[axis],
            );
          const next = identity.receiveResult(message, draft.values);
          if (applicable) lastSnapshot = candidate.value;
          onIdentityDraft(identity.state);
          onState({
            kind: 'ready',
            snapshot: visibleSnapshot(
              lastSnapshot,
              identity,
              commandPending(),
              creationChoiceDraft,
              creationRollDraft,
            ),
          });
          sendIdentity(next);
          return;
        }
        if (identity === null || lastSnapshot === null) return;
        const next = identity.receiveRefusal(message);
        onIdentityDraft(identity.state);
        onState({
          kind: 'ready',
          snapshot: visibleSnapshot(
            lastSnapshot,
            identity,
            commandPending(),
            creationChoiceDraft,
            creationRollDraft,
          ),
        });
        sendIdentity(next);
        return;
      }

      const decoded = decodeHostMessageV2(frame, WEB_PROTOCOL_VOCABULARY);
      if (!decoded.ok) {
        failProtocol(decoded.refusal, 'Host frame did not decode as wire v2.');
        return;
      }
      const message = decoded.value;
      if (
        (expectingCapabilities && message.messageType !== 'session.reconnect.capabilities') ||
        (stagedCapabilities !== null && message.messageType !== 'projection.snapshot')
      ) {
        failUnexpected(
          '$.messageType',
          message.messageType,
          'A wire v2 frame interrupted the staged reconnect pair.',
        );
        return;
      }
      if (message.messageType === 'session.reconnect.capabilities') {
        if (!expectingCapabilities || stagedCapabilities !== null) {
          failUnexpected(
            '$.messageType',
            message.messageType,
            'Host sent an extra reconnect capability frame.',
          );
          return;
        }
        expectingCapabilities = false;
        if (message.reconnectRequestId !== requestId) {
          failUnexpected(
            '$.reconnectRequestId',
            message.reconnectRequestId,
            'Host capability frame belongs to another reconnect attempt.',
          );
          return;
        }
        stagedCapabilities = message;
        return;
      }
      if (message.messageType === 'projection.snapshot') {
        let snapshot: DecodeResult<ConfirmedProjectionSnapshot>;
        const reconnecting = stagedCapabilities !== null;
        if (reconnecting) {
          const capabilities = stagedCapabilities!;
          stagedCapabilities = null;
          snapshot = decodeReconnectSnapshot(message, capabilities, requestId);
          if (snapshot.ok && pendingCheckpoint !== null) {
            if (pendingCheckpoint.receipt === null) {
              snapshot = unrecognized('$.messageType', message.messageType);
            } else {
              snapshot = checkpointSnapshotMatchesReceipt(
                snapshot.value,
                pendingCheckpoint.receipt,
              );
            }
          } else if (snapshot.ok && pendingSetDecision !== null) {
            if (pendingSetDecision.receipt === null) {
              snapshot = reconnectSnapshotMatchesUnjournaledCancel(
                snapshot.value,
                pendingSetDecision,
              );
            } else {
              snapshot = setDecisionSnapshotMatchesReceipt(
                snapshot.value,
                pendingSetDecision.receipt,
                pendingSetDecision.sourceSnapshot,
              );
            }
          } else if (snapshot.ok && pendingRollCommit !== null) {
            if (pendingRollCommit.receipt === null) {
              snapshot = unrecognized('$.messageType', message.messageType);
            } else {
              snapshot = rollCommitSnapshotMatchesReceipt(
                snapshot.value,
                pendingRollCommit.receipt,
              );
            }
          }
        } else if (
          pendingCheckpoint !== null &&
          pendingCheckpoint.receipt !== null &&
          lastSnapshot !== null
        ) {
          snapshot = decodeCommandDestinationSnapshot(
            message,
            pendingCheckpoint as PendingIdentityCheckpoint & {
              readonly receipt: CommandReceipt<IdentityCheckpointResult>;
            },
            lastSnapshot,
          );
        } else if (
          pendingSetDecision !== null &&
          pendingSetDecision.receipt !== null &&
          lastSnapshot !== null
        ) {
          snapshot = decodeSetDecisionDestinationSnapshot(
            message,
            pendingSetDecision as PendingSetDecision & {
              readonly receipt: CommandReceipt<SetDecisionResult>;
            },
            lastSnapshot,
          );
        } else if (
          pendingRollCommit !== null &&
          pendingRollCommit.receipt !== null &&
          lastSnapshot !== null
        ) {
          snapshot = decodeRollCommitDestinationSnapshot(
            message,
            pendingRollCommit as PendingRollCommit & {
              readonly receipt: CommandReceipt<RollCommitResult>;
            },
            lastSnapshot,
          );
        } else {
          if (stagedCapabilities !== null || pendingFormAction === null) {
            failUnexpected(
              '$.messageType',
              message.messageType,
              'Form-action snapshot arrived without exactly one pending form action.',
            );
            return;
          }
          snapshot = decodeFormActionSnapshot(message, pendingFormAction, lastSnapshot!);
          pendingFormAction = null;
        }
        if (!snapshot.ok) {
          failProtocol(snapshot.refusal, 'Host sent an invalid projection snapshot.');
          return;
        }
        adoptSnapshot(snapshot.value, reconnecting);
        return;
      }
      if (message.messageType === 'navigation.form-action.refusal') {
        if (
          lastSnapshot === null ||
          pendingFormAction === null ||
          message.navigationRequestId !== pendingFormAction.navigationRequestId
        ) {
          failUnexpected(
            '$.navigationRequestId',
            message.navigationRequestId,
            'Host form-action refusal does not match the pending request.',
          );
          return;
        }
        pendingFormAction = null;
        onState({
          kind: 'navigation-refusal',
          refusal: message.refusal,
          snapshot: visibleSnapshot(
            lastSnapshot,
            identity,
            commandPending(),
            creationChoiceDraft,
            creationRollDraft,
          ),
        });
        return;
      }
      failUnexpected(
        '$.messageType',
        message.messageType,
        'Host sent a wire v2 message that this reconnect did not request.',
      );
    };

    activeSocket.onerror = () => {
      if (disposed || terminal || socket !== activeSocket) return;
      socket = null;
      pendingFormAction = null;
      stagedCapabilities = null;
      onState({
        code: null,
        detail: 'WebSocket transport reported an error.',
        kind: 'disconnected',
        snapshot: visibleLast(),
      });
    };

    activeSocket.onclose = (event) => {
      if (disposed || terminal || socket !== activeSocket) return;
      socket = null;
      pendingFormAction = null;
      stagedCapabilities = null;
      const reason = event.reason.length === 0 ? 'no close reason' : event.reason;
      onState({
        code: event.code,
        detail: `WebSocket closed with code ${String(event.code)}: ${reason}.`,
        kind: 'disconnected',
        snapshot: visibleLast(),
      });
    };
  };

  const openTransport = (currentDeviceId: string): void => {
    const requestId = createRequestId('reconnect');
    const reconnect = {
      deviceId: currentDeviceId,
      knownRevisions: lastSnapshot?.revisions ?? NO_KNOWN_REVISIONS,
      messageType: 'session.reconnect',
      protocolVersion: WIRE_PROTOCOL_V2_VERSION,
      reconnectRequestId: requestId,
      supportedWorkflowCommandIds: [
        IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        SET_DECIDE_WORKFLOW_COMMAND_ID,
        ROLL_COMMIT_WORKFLOW_COMMAND_ID,
      ],
      unacknowledgedCommandIds:
        pendingCheckpoint !== null
          ? [pendingCheckpoint.request.commandId]
          : pendingSetDecision !== null
            ? [pendingSetDecision.request.commandId]
            : pendingRollCommit !== null
              ? [pendingRollCommit.request.commandId]
              : [],
    } as const satisfies SessionReconnectV2Message;
    const encoded = encodeClientMessageV2(reconnect, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok)
      throw new Error(
        `session.reconnect failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
      );
    stagedCapabilities = null;
    attachSocket(new WebSocket(stateSocketUrl(window.location.href)), requestId, encoded.text);
  };

  const start = async (): Promise<void> => {
    const response = await fetch(deviceIdentityUrl(window.location.href), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      const source: unknown = await response.json();
      const endpointError = decodeDeviceIdentityError(source);
      if (!endpointError.ok) {
        throw new Error(
          `device identity request returned HTTP ${String(response.status)} with invalid diagnostic: ${JSON.stringify(endpointError.refusal)}`,
        );
      }
      throw new Error(
        `device identity request returned HTTP ${String(response.status)}: ${endpointError.value}`,
      );
    }
    const source: unknown = await response.json();
    const identity = decodeDeviceIdentity(source);
    if (!identity.ok) {
      throw new Error(`device identity response refused: ${JSON.stringify(identity.refusal)}`);
    }
    if (disposed) return;
    deviceId = identity.value;
    openTransport(deviceId);
  };

  void start().catch((error: unknown) => {
    if (disposed || terminal) return;
    terminal = true;
    onState({ kind: 'client-error', detail: diagnostic(error) });
    closeAfterTerminalState();
  });

  return {
    disconnect: () => {
      if (disposed) return;
      disposed = true;
      pendingFormAction = null;
      stagedCapabilities = null;
      if (
        socket !== null &&
        (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
      ) {
        socket.close(1000, 'web client unmounted');
      }
    },
    reconnect: () => {
      if (disposed || terminal || deviceId === null)
        return { ok: false, detail: 'projection connection cannot reconnect' };
      if (socket !== null) return { ok: false, detail: 'WebSocket is already open or connecting' };
      try {
        openTransport(deviceId);
        return { ok: true };
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
    },
    replaceConfirmationManualFace: (value) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-004' ||
        creationRollDraft?.formId !== 'CHR-004' ||
        lastSnapshot.projection['diceInputModeSnapshot'] !== 'MANUAL' ||
        lastSnapshot.projection['confirmationReceiptId'] !== null
      ) {
        return { ok: false, detail: 'no active CHR-004 MANUAL input scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'confirmation input is frozen while delivery is pending' };
      }
      if (value !== null && !Number.isFinite(value)) {
        return { ok: false, detail: 'confirmation face must be finite' };
      }
      creationRollDraft = { face: value, formId: 'CHR-004' };
      onCreationRollDraft(creationRollDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshot(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
        ),
      });
      return { ok: true };
    },
    replaceSetManualFace: (index, value) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-003' ||
        creationRollDraft?.formId !== 'CHR-003' ||
        lastSnapshot.projection['diceInputModeSnapshot'] !== 'MANUAL' ||
        lastSnapshot.projection['setRollReceiptId'] !== null
      ) {
        return { ok: false, detail: 'no active CHR-003 MANUAL input scope' };
      }
      if (!Number.isSafeInteger(index) || index < 0 || index >= 7) {
        return { ok: false, detail: 'CHR-003 input index must be in 0..6' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'set inputs are frozen while delivery is pending' };
      }
      if (value !== null && !Number.isFinite(value)) {
        return { ok: false, detail: 'set face must be finite' };
      }
      const faces = [...creationRollDraft.faces];
      faces[index] = value;
      creationRollDraft = { faces, formId: 'CHR-003' };
      onCreationRollDraft(creationRollDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshot(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
        ),
      });
      return { ok: true };
    },
    replaceIdentityDraft: (values) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return { ok: false, detail: 'WebSocket is not open' };
      }
      if (identity === null) return { ok: false, detail: 'no active CHR-001 draft scope' };
      if (commandPending())
        return { ok: false, detail: 'identity is frozen while checkpoint delivery is pending' };
      if ([values.age, values.massKg].some((value) => value !== null && !Number.isFinite(value)))
        return { ok: false, detail: 'identity draft numbers must be finite' };
      const request = identity.edit(values);
      onIdentityDraft(identity.state);
      if (lastSnapshot !== null)
        onState({
          kind: 'ready',
          snapshot: visibleSnapshot(
            lastSnapshot,
            identity,
            commandPending(),
            creationChoiceDraft,
            creationRollDraft,
          ),
        });
      try {
        return request === null || sendIdentity(request)
          ? { ok: true }
          : { ok: false, detail: 'WebSocket is not open' };
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
    },
    requestFormAction: (actionKey) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (lastSnapshot === null)
        return { ok: false, detail: 'no confirmed projection is available' };
      if (pendingFormAction !== null) {
        return { ok: false, detail: 'a form action is already awaiting host confirmation' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'a wizard command is awaiting host delivery' };
      }
      const visible = visibleSnapshot(
        lastSnapshot,
        identity,
        false,
        creationChoiceDraft,
        creationRollDraft,
      );
      const activeForm = activePresentedForm(visible);
      if (!activeForm.availableActionKeys.includes(actionKey)) {
        return {
          ok: false,
          detail: `action ${JSON.stringify(actionKey)} is absent from the confirmed availableActionKeys`,
        };
      }
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return { ok: false, detail: 'WebSocket is not open' };
      }
      const selectedChoice = CHARACTER_CREATION_SELECTOR_CHOICES.get(actionKey);
      if (selectedChoice !== undefined && selectedChoice.formId === activeForm.formId) {
        creationChoiceDraft = selectedChoice;
        onCreationChoiceDraft(creationChoiceDraft);
        onState({
          kind: 'ready',
          snapshot: visibleSnapshot(
            lastSnapshot,
            identity,
            false,
            creationChoiceDraft,
            creationRollDraft,
          ),
        });
        return { ok: true };
      }
      if (activeForm.formId === 'CHR-001' && actionKey === IDENTITY_CHECKPOINT_ACTION_KEY) {
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload: identityCheckpointPayload(lastSnapshot),
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        } as const satisfies IdentityCheckpointRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `identity checkpoint failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingCheckpoint = { receipt: null, request };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return {
            ok: false,
            detail: `identity checkpoint could not be sent: ${diagnostic(error)}`,
          };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshot(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
          ),
        });
        return { ok: true };
      }
      if (
        creationChoiceDraft !== null &&
        creationChoiceDraft.formId === activeForm.formId &&
        creationChoiceDraft.confirmationActionKey === actionKey
      ) {
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload: setDecisionPayload(lastSnapshot, creationChoiceDraft),
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: SET_DECIDE_WORKFLOW_COMMAND_ID,
        } as const satisfies SetDecisionRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `SET-DECIDE failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingSetDecision = {
          choice: creationChoiceDraft,
          receipt: null,
          request,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingSetDecision = null;
          return {
            ok: false,
            detail: `SET-DECIDE could not be sent: ${diagnostic(error)}`,
          };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshot(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
          ),
        });
        return { ok: true };
      }
      const statRollDecision = statRollSetDecisionPayload(lastSnapshot, actionKey);
      if (statRollDecision !== null) {
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload: statRollDecision,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: SET_DECIDE_WORKFLOW_COMMAND_ID,
        } as const satisfies SetDecisionRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `SET-DECIDE failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingSetDecision = {
          choice: null,
          receipt: null,
          request,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingSetDecision = null;
          return {
            ok: false,
            detail: `SET-DECIDE could not be sent: ${diagnostic(error)}`,
          };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshot(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
          ),
        });
        return { ok: true };
      }
      if (
        (activeForm.formId === 'CHR-003' && actionKey === CHR_003_ROLL_COMMIT_ACTION_KEY) ||
        (activeForm.formId === 'CHR-004' && actionKey === CHR_004_ROLL_COMMIT_ACTION_KEY)
      ) {
        let request: RollCommitRequest;
        try {
          request = {
            commandId: createRequestId('command'),
            commandKind: 'workflow-command',
            expectedRevisions: { ...lastSnapshot.revisions },
            messageType: 'command.request',
            payload: rollCommitPayload(lastSnapshot, creationRollDraft),
            protocolVersion: WIRE_PROTOCOL_VERSION,
            role: 'player',
            workflowCommandId: ROLL_COMMIT_WORKFLOW_COMMAND_ID,
          };
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `ROLL-COMMIT failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingRollCommit = {
          receipt: null,
          request,
          sourceProjection: lastSnapshot.projection as unknown as
            Chr003Projection | Chr004Projection,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingRollCommit = null;
          return { ok: false, detail: `ROLL-COMMIT could not be sent: ${diagnostic(error)}` };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshot(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
          ),
        });
        return { ok: true };
      }
      const request = {
        actionKey,
        expectedProjectionRevision: lastSnapshot.revisions.projectionRevision,
        messageType: 'navigation.form-action',
        navigationRequestId: createRequestId('navigation'),
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        sourceFormId: activeForm.formId,
      } as const satisfies FormActionIntentV2Message;
      const encoded = encodeClientMessageV2(request, WEB_PROTOCOL_VOCABULARY);
      if (!encoded.ok) {
        return {
          ok: false,
          detail: `form action failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
        };
      }
      pendingFormAction = request;
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        pendingFormAction = null;
        return { ok: false, detail: `form action could not be sent: ${diagnostic(error)}` };
      }
      return { ok: true };
    },
  };
}
