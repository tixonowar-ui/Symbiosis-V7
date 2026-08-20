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
  'CHR-009',
  'CHR-011',
  'CHR-012',
  'CHR-013',
  'CHR-015',
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
const STAT_CODES = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const PURE_CLASSES = ['SEEKER', 'STALKER', 'SOLDIER'] as const satisfies readonly PureClass[];
const CHR_011_SELECTOR_ACTION_KEYS = [
  'CHR-011::CTA::003',
  'CHR-011::CTA::004',
  'CHR-011::CTA::005',
] as const satisfies readonly ActionKey[];
const CHR_013_ACTION_KEYS = ['CHR-013::CTA::002'] as const satisfies readonly ActionKey[];
const CHR_015_MUTABLE_ACTION_KEYS = ['CHR-015::CTA::003'] as const satisfies readonly ActionKey[];
const CHR_015_CONFIRM_ACTION_KEY = 'CHR-015::CTA::001' as const;
const CHR_015_TOGGLE_ACTION_KEY = 'CHR-015::CTA::003' as const;
const PURE_CLASS_BY_SELECTOR = new Map<ActionKey, PureClass>([
  ['CHR-011::CTA::003', 'SEEKER'],
  ['CHR-011::CTA::004', 'STALKER'],
  ['CHR-011::CTA::005', 'SOLDIER'],
]);
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
  readonly raceConsequenceOptions: readonly RaceConsequenceOptionProjection[];
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
  readonly modeConsequenceOptions: readonly ModeConsequenceOptionProjection[];
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
  readonly methodConsequenceOptions: readonly MethodConsequenceOptionProjection[];
  readonly statMethod: null;
  readonly wizardCheckpointId: string;
}

export interface LabeledStatModifierProjection extends JsonObject {
  readonly delta: number;
  readonly statCode: StatCode;
  readonly statLabel: string;
}

export type StatModifierEffectProjection =
  | { readonly kind: 'NO_STAT_MODIFIERS' }
  | {
      readonly entries: readonly LabeledStatModifierProjection[];
      readonly kind: 'ADDITIVE_STAT_MODIFIERS';
    };

export interface ModeConsequencesProjection extends JsonObject {
  readonly baseSymbiontSlots: number;
  readonly raceChoice: 'FREE' | 'UNITED';
  readonly raceLabel: string;
  readonly statModifiers: StatModifierEffectProjection;
}

export interface ModeConsequenceOptionProjection extends JsonObject {
  readonly modeConsequences: ModeConsequencesProjection;
  readonly symbiontAcquisitionMode: 'MANUAL' | 'RANDOM';
}

export type RaceStatModifiersByAcquisitionModeProjection =
  | { readonly kind: 'NOT_APPLICABLE' }
  | {
      readonly alternatives: readonly ModeConsequenceOptionProjection[];
      readonly kind: 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE';
    };

export type GrantedSkillsProjection =
  | { readonly kind: 'NO_GRANTED_SKILLS' }
  | {
      readonly entries: readonly [
        {
          readonly skillId: string;
          readonly skillLabel: string;
        },
      ];
      readonly kind: 'GRANTED_SKILLS';
    };

export interface RaceConsequencesPreviewProjection extends JsonObject {
  readonly allocationXpMultiplier: number;
  readonly baseSymbiontSlots: number;
  readonly classPolicy: 'NO_CLASS' | 'REQUIRED_PURE_CLASS';
  readonly directXpMultiplier: number;
  readonly grantedSkills: GrantedSkillsProjection;
  readonly raceLabel: string;
  readonly raceStatModifiersByAcquisitionMode: RaceStatModifiersByAcquisitionModeProjection;
  readonly symbiontXpPolicy: 'STANDARD_XP_AWARD' | 'XP_AWARD_X2';
  readonly symbioticMonsterAllowed: boolean;
}

export interface RaceConsequenceOptionProjection extends JsonObject {
  readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
  readonly raceConsequencesPreview: RaceConsequencesPreviewProjection;
}

export interface RejectedSetConsequencesProjection extends JsonObject {
  readonly creationCriticalConsequencesDiscarded: true;
  readonly irreversible: true;
  readonly setValuesDiscarded: true;
}

export type MethodTerminalRuleProjection =
  | {
      readonly afterAttempt: number;
      readonly exactTotal: number;
      readonly kind: 'POINT_BUY_AFTER_REJECTION';
    }
  | { readonly attemptIndex: number; readonly kind: 'MANDATORY_ACCEPT' };

export interface MethodConsequencesProjection extends JsonObject {
  readonly maximumAttempts: number;
  readonly rejectedSet: RejectedSetConsequencesProjection;
  readonly terminalRule: MethodTerminalRuleProjection;
}

export interface MethodConsequenceOptionProjection extends JsonObject {
  readonly methodConsequences: MethodConsequencesProjection;
  readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
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

export type StatCode = (typeof STAT_CODES)[number];
export type StatMap<T extends JsonValue> = Readonly<Record<StatCode, T>>;
export type StatAssignmentMode = 'POINT_BUY_85' | 'POINT_BUY_90' | 'ROLLED_BIJECTION';
export type PureClass = 'SEEKER' | 'SOLDIER' | 'STALKER';

export interface StatModifierProjection extends JsonObject {
  readonly delta: number;
  readonly statCode: StatCode;
}

export interface MandatoryClassSkillProjection extends JsonObject {
  readonly bonus: number;
  readonly skillKey: string;
  readonly slotCost: number;
}

export interface ClassConsequencesProjection extends JsonObject {
  readonly statModifiers: readonly StatModifierProjection[];
}

export interface PureClassOptionProjection extends JsonObject {
  readonly classConsequences: ClassConsequencesProjection;
  readonly mandatoryClassSkill: MandatoryClassSkillProjection;
  readonly pureClass: PureClass;
}

export interface RolledAssignmentSourceEntry extends JsonObject {
  readonly creationCriticalPenaltyOrNull: -1 | -2 | -3 | -4 | -5 | null;
  readonly setEntryIndex: number;
  readonly value: number;
}

export interface RolledBijectionProof extends JsonObject {
  readonly assignedSetEntryIndexByStat: null;
  readonly kind: 'ROLLED_BIJECTION';
  readonly sourceEntries: readonly RolledAssignmentSourceEntry[];
}

export interface ExactSumProof extends JsonObject {
  readonly actualTotal: null;
  readonly kind: 'EXACT_SUM';
  readonly requiredTotal: 85 | 90;
}

export interface Chr009Projection extends JsonObject {
  readonly C: null;
  readonly D: null;
  readonly I: null;
  readonly M: null;
  readonly S: null;
  readonly W: null;
  readonly Z: null;
  readonly assignmentMode: StatAssignmentMode;
  readonly assignmentValidation: null;
  readonly bijectionProofOrExactSum: ExactSumProof | RolledBijectionProof;
  readonly characterDraftId: string;
  readonly commandId: null;
  readonly draftRevision: number;
  readonly eachValueRange: { readonly maximum: 20; readonly minimum: 1 } | null;
  readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
  readonly sourceSetReceiptIdOrNull: string | null;
  readonly wizardCheckpointId: string;
}

export interface Chr011Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly classConsequences: null;
  readonly classOptions: readonly PureClassOptionProjection[];
  readonly commandId: null;
  readonly draftRevision: number;
  readonly mandatoryClassSkill: null;
  readonly pureClass: null;
  readonly raceChoice: 'PURE';
  readonly wizardCheckpointId: string;
}

export interface Chr012Projection extends JsonObject {
  readonly baseStats: StatMap<number>;
  readonly characterDraftId: string;
  readonly classModifiersOrNull: readonly StatModifierProjection[] | null;
  readonly commandId: null;
  readonly draftRevision: number;
  readonly mandatoryClassSkillOrNull: MandatoryClassSkillProjection | null;
  readonly raceModifiers: readonly StatModifierProjection[];
  readonly skillStageStats: StatMap<number>;
  readonly symbiontModifiersExcluded: true;
  readonly wizardCheckpointId: string;
}

export interface SkillLevelOptionProjection extends JsonObject {
  readonly slotCost: number;
  readonly targetBonus: number;
}

export interface SkillRequirementProjection extends JsonObject {
  readonly currentValue: number;
  readonly minValue: number;
  readonly satisfied: boolean;
  readonly statCode: StatCode;
  readonly statLabel: string;
}

export type MissingSkillPenaltyProjection =
  | { readonly kind: 'NO_MISSING_SKILL_PENALTY' }
  | { readonly kind: 'MISSING_SKILL_PENALTY'; readonly value: number };

export interface SkillCardSummaryProjection extends JsonObject {
  readonly bonusDomainScope: string;
  readonly eligibility: 'ELIGIBLE' | 'REQUIREMENTS_NOT_MET';
  readonly levelOptions: readonly SkillLevelOptionProjection[];
  readonly missingSkillPenalty: MissingSkillPenaltyProjection;
  readonly requirements: readonly SkillRequirementProjection[];
  readonly skillId: string;
  readonly skillLabel: string;
}

export interface FixedSkillProjection extends JsonObject {
  readonly bonus: number;
  readonly skillId: string;
  readonly skillLabel: string;
  readonly slotCost: number;
}

export interface SkillSlotSourcesProjection extends JsonObject {
  readonly mandatoryClassSkillOrNull: FixedSkillProjection | null;
  readonly racialFreeSkills: readonly FixedSkillProjection[];
  readonly requiredSlotCount: number;
}

export interface Chr013Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly commandId: null;
  readonly draftRevision: number;
  readonly eligibleSkillIds: readonly string[];
  readonly selectedSkillIdOrNull: null;
  readonly skillCardSummaries: readonly SkillCardSummaryProjection[];
  readonly skillStageStats: StatMap<number>;
  readonly slotSources: SkillSlotSourcesProjection;
  readonly wizardCheckpointId: string;
}

export interface SelectedSkillProjection extends JsonObject {
  readonly skillId: string;
  readonly slotCost: number;
  readonly targetBonus: number;
}

export interface SkillOptionProjection extends JsonObject {
  readonly bonusDomainScope: string;
  readonly levelOptions: readonly SkillLevelOptionProjection[];
  readonly missingSkillPenalty: MissingSkillPenaltyProjection;
  readonly skillId: string;
  readonly skillLabel: string;
}

export interface PaidSkillUsageEntryProjection extends JsonObject {
  readonly bonus: number;
  readonly skillId: string;
  readonly skillLabel: string;
  readonly slotCost: number;
  readonly source: 'CLASS_MANDATORY' | 'SELECTED';
}

export interface PaidSlotUsageProjection extends JsonObject {
  readonly entries: readonly PaidSkillUsageEntryProjection[];
  readonly usedSlotCount: number;
}

export type SkillSelectionValidation =
  | {
      readonly kind: 'UNDERFILLED';
      readonly missingSlotCount: number;
      readonly requiredSlotCount: number;
      readonly usedSlotCount: number;
    }
  | {
      readonly kind: 'EXACT';
      readonly requiredSlotCount: number;
      readonly usedSlotCount: number;
    }
  | {
      readonly excessSlotCount: number;
      readonly kind: 'OVERFILLED';
      readonly requiredSlotCount: number;
      readonly usedSlotCount: number;
    };

export interface Chr015Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly draftRevision: number;
  readonly eligibleSkillIds: readonly string[];
  readonly mandatoryClassSkillOrNull: FixedSkillProjection | null;
  readonly paidSlotUsage: PaidSlotUsageProjection;
  readonly racialFreeSkillIds: readonly string[];
  readonly racialFreeSkills: readonly FixedSkillProjection[];
  readonly requiredSlotCount: number;
  readonly selectedSkillIds: readonly string[];
  readonly selectedSkills: readonly SelectedSkillProjection[];
  readonly selectionValidation: SkillSelectionValidation;
  readonly skillOptions: readonly SkillOptionProjection[];
  readonly wizardCheckpointId: string;
}

export interface CharacterSkillSelectionDraft {
  readonly candidateSkillIdOrNull: string | null;
  readonly candidateTargetBonusOrNull: number | null;
  readonly formId: 'CHR-015';
  readonly paidSlotUsage: PaidSlotUsageProjection;
  readonly selectedSkillIds: readonly string[];
  readonly selectedSkills: readonly SelectedSkillProjection[];
  readonly selectionValidation: SkillSelectionValidation;
}

export type StatAssignmentValidation = 'ASSIGNMENT_INVALID' | 'READY_TO_CHECKPOINT';

export interface CharacterStatAssignmentDraft {
  readonly assignmentMode: StatAssignmentMode;
  readonly formId: 'CHR-009';
  readonly valuesByStat: StatMap<number | null>;
  readonly validation: StatAssignmentValidation;
}

export type CharacterCreationRollDraft =
  | { readonly faces: readonly (number | null)[]; readonly formId: 'CHR-003' }
  | { readonly face: number | null; readonly formId: 'CHR-004' };

export type CharacterCreationChoiceDraft =
  | {
      readonly confirmationActionKey: 'CHR-010::CTA::001' | 'CHR-010::CTA::002';
      readonly consequence: RaceConsequencesPreviewProjection;
      readonly formId: 'CHR-010';
      readonly value: 'FREE' | 'PURE' | 'UNITED';
    }
  | {
      readonly confirmationActionKey: 'CHR-016::CTA::001';
      readonly consequence: ModeConsequencesProjection;
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
      readonly consequence: MethodConsequencesProjection;
      readonly formId: 'CHR-002';
      readonly value: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
    }
  | {
      readonly classConsequences: ClassConsequencesProjection;
      readonly confirmationActionKey: 'CHR-011::CTA::001';
      readonly consequence: null;
      readonly formId: 'CHR-011';
      readonly mandatoryClassSkill: MandatoryClassSkillProjection;
      readonly value: PureClass;
    };

type CharacterCreationSelectorChoice =
  | Omit<Extract<CharacterCreationChoiceDraft, { readonly formId: 'CHR-010' }>, 'consequence'>
  | Omit<Extract<CharacterCreationChoiceDraft, { readonly formId: 'CHR-016' }>, 'consequence'>
  | Extract<CharacterCreationChoiceDraft, { readonly formId: 'CHR-036' }>
  | Omit<Extract<CharacterCreationChoiceDraft, { readonly formId: 'CHR-002' }>, 'consequence'>;

const CHARACTER_CREATION_SELECTOR_CHOICES: ReadonlyMap<ActionKey, CharacterCreationSelectorChoice> =
  new Map([
    [
      'CHR-010::CTA::004',
      {
        confirmationActionKey: 'CHR-010::CTA::001',
        formId: 'CHR-010',
        value: 'UNITED',
      },
    ],
    [
      'CHR-010::CTA::005',
      {
        confirmationActionKey: 'CHR-010::CTA::001',
        formId: 'CHR-010',
        value: 'FREE',
      },
    ],
    [
      'CHR-010::CTA::006',
      {
        confirmationActionKey: 'CHR-010::CTA::002',
        formId: 'CHR-010',
        value: 'PURE',
      },
    ],
    [
      'CHR-016::CTA::003',
      {
        confirmationActionKey: 'CHR-016::CTA::001',
        formId: 'CHR-016',
        value: 'MANUAL',
      },
    ],
    [
      'CHR-016::CTA::004',
      {
        confirmationActionKey: 'CHR-016::CTA::001',
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
        formId: 'CHR-002',
        value: 'CLASSIC',
      },
    ],
    [
      'CHR-002::CTA::004',
      {
        confirmationActionKey: 'CHR-002::CTA::001',
        formId: 'CHR-002',
        value: 'ADVENTUROUS',
      },
    ],
    [
      'CHR-002::CTA::005',
      {
        confirmationActionKey: 'CHR-002::CTA::001',
        formId: 'CHR-002',
        value: 'ALL_OR_NOTHING',
      },
    ],
  ]);

function characterCreationSelectorChoice(
  snapshot: ConfirmedProjectionSnapshot,
  actionKey: ActionKey,
): CharacterCreationChoiceDraft | undefined {
  const selector = CHARACTER_CREATION_SELECTOR_CHOICES.get(actionKey);
  if (selector !== undefined) {
    if (selector.formId !== snapshot.formId) return undefined;
    switch (selector.formId) {
      case 'CHR-010': {
        const option = (snapshot.projection as Chr010Projection).raceConsequenceOptions.find(
          ({ raceChoice }) => raceChoice === selector.value,
        );
        return option === undefined
          ? undefined
          : { ...selector, consequence: option.raceConsequencesPreview };
      }
      case 'CHR-016': {
        const option = (snapshot.projection as Chr016Projection).modeConsequenceOptions.find(
          ({ symbiontAcquisitionMode }) => symbiontAcquisitionMode === selector.value,
        );
        return option === undefined
          ? undefined
          : { ...selector, consequence: option.modeConsequences };
      }
      case 'CHR-036':
        return selector;
      case 'CHR-002': {
        const option = (snapshot.projection as Chr002Projection).methodConsequenceOptions.find(
          ({ statMethod }) => statMethod === selector.value,
        );
        return option === undefined
          ? undefined
          : { ...selector, consequence: option.methodConsequences };
      }
    }
  }
  if (snapshot.formId !== 'CHR-011') return undefined;
  const pureClass = PURE_CLASS_BY_SELECTOR.get(actionKey);
  if (pureClass === undefined) return undefined;
  const option = (snapshot.projection as Chr011Projection).classOptions.find(
    (candidate) => candidate.pureClass === pureClass,
  );
  if (option === undefined) return undefined;
  return {
    classConsequences: option.classConsequences,
    confirmationActionKey: 'CHR-011::CTA::001',
    consequence: null,
    formId: 'CHR-011',
    mandatoryClassSkill: option.mandatoryClassSkill,
    value: pureClass,
  };
}

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

interface StatAssignmentCheckpointCommonPayload extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly sourceFormId: 'CHR-009';
  readonly stage: 'STAT_ASSIGNMENT';
  readonly wizardCheckpointId: string;
}

interface RolledStatAssignmentCheckpointPayload extends StatAssignmentCheckpointCommonPayload {
  readonly setEntryIndexByStat: StatMap<number>;
}

interface PointBuyStatAssignmentCheckpointPayload extends StatAssignmentCheckpointCommonPayload {
  readonly pointBuyStats: StatMap<number>;
}

type StatAssignmentCheckpointPayload =
  PointBuyStatAssignmentCheckpointPayload | RolledStatAssignmentCheckpointPayload;
type StatAssignmentCheckpointRequest = WorkflowCommandRequestMessage<
  typeof IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  StatAssignmentCheckpointPayload
>;

interface SkillSelectionCheckpointInput extends JsonObject {
  readonly skillId: string;
  readonly targetBonus: number;
}

interface SkillSelectionCheckpointPayload extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly selectedSkills: readonly SkillSelectionCheckpointInput[];
  readonly sourceFormId: 'CHR-015';
  readonly stage: 'SKILLS';
  readonly wizardCheckpointId: string;
}

type SkillSelectionCheckpointRequest = WorkflowCommandRequestMessage<
  typeof IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  SkillSelectionCheckpointPayload
>;
type CheckpointRequest =
  IdentityCheckpointRequest | SkillSelectionCheckpointRequest | StatAssignmentCheckpointRequest;

interface RolledStatAssignmentResultEntry extends RolledAssignmentSourceEntry {
  readonly statCode: StatCode;
}

interface StatAssignmentCheckpointResult extends JsonObject {
  readonly assignmentMode: StatAssignmentMode;
  readonly baseStats: StatMap<number>;
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly nextFormId: 'CHR-011' | 'CHR-012';
  readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
  readonly rolledAssignmentsOrNull: readonly RolledStatAssignmentResultEntry[] | null;
  readonly sourceFormId: 'CHR-009';
  readonly sourceSetReceiptIdOrNull: string | null;
  readonly stage: 'STAT_ASSIGNMENT';
}

interface DurableSelectedSkillResult extends JsonObject {
  readonly skillKey: string;
  readonly targetBonus: number;
}

interface DurableLearnedSkillResult extends JsonObject {
  readonly bonus: number;
  readonly skillKey: string;
  readonly slotCost: number;
  readonly source: 'CLASS_MANDATORY' | 'RACE_GRANTED' | 'SELECTED';
}

interface SkillSelectionCheckpointResult extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly learnedSkills: readonly DurableLearnedSkillResult[];
  readonly nextFormId: 'CHR-017';
  readonly requiredSlotCount: number;
  readonly selectedSkills: readonly DurableSelectedSkillResult[];
  readonly sourceFormId: 'CHR-015';
  readonly stage: 'SKILLS';
  readonly usedSlotCount: number;
}

type CheckpointResult =
  IdentityCheckpointResult | SkillSelectionCheckpointResult | StatAssignmentCheckpointResult;

interface PendingCheckpoint {
  readonly assignmentDraft: CharacterStatAssignmentDraft | null;
  readonly request: CheckpointRequest;
  readonly receipt: CommandReceipt<CheckpointResult> | null;
  readonly skillSelectionDraft: CharacterSkillSelectionDraft | null;
  readonly sourceSnapshot: ConfirmedProjectionSnapshot;
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

interface PureClassDecisionPayload extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly pureClass: PureClass;
  readonly sourceFormId: 'CHR-011';
  readonly stage: 'STAT_ASSIGNMENT';
  readonly wizardCheckpointId: string;
}

type SetDecisionPayload =
  | DiceInputDecisionPayload
  | PureClassDecisionPayload
  | RaceDecisionPayload
  | StatRollAcceptSetPayload
  | StatRollDialogDecisionPayload
  | StatMethodDecisionPayload
  | SymbiontAcquisitionDecisionPayload;
type RaceMethodSetDecisionPayload = Exclude<
  SetDecisionPayload,
  PureClassDecisionPayload | StatRollAcceptSetPayload | StatRollDialogDecisionPayload
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

interface PureClassDecisionResult extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly classConsequences: ClassConsequencesProjection;
  readonly draftRevision: number;
  readonly mandatoryClassSkill: MandatoryClassSkillProjection;
  readonly nextFormId: 'CHR-012';
  readonly pureClass: PureClass;
  readonly sourceFormId: 'CHR-011';
  readonly stage: 'STAT_ASSIGNMENT';
}

type SetDecisionResult =
  | CreationSetAbandonmentResult
  | CreationSetAcceptanceResult
  | CreationSetCancelResult
  | DiceInputDecisionResult
  | PureClassDecisionResult
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
  replaceSkillSelectionCandidate(
    skillId: string | null,
    targetBonus: number | null,
  ): FormActionRequestResult;
  requestFormAction(actionKey: ActionKey): FormActionRequestResult;
  replaceStatAssignmentValue(statCode: StatCode, value: number | null): FormActionRequestResult;
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

function isPositiveSafeInteger(value: JsonValue): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function decodeLabeledStatModifiers(
  value: JsonValue,
  path: string,
  statLabels: Map<StatCode, string>,
): DecodeResult<readonly LabeledStatModifierProjection[]> {
  if (!Array.isArray(value) || value.length === 0) return unrecognized(path, value);
  const entries = value as readonly JsonValue[];
  const seen = new Set<StatCode>();
  let previousOrder = -1;
  for (const [index, entry] of entries.entries()) {
    const itemPath = `${path}[${String(index)}]`;
    if (!isJsonObject(entry)) return unrecognized(itemPath, entry);
    const shape = decodeProjection(entry, itemPath, {
      delta: (field) => typeof field === 'number' && Number.isSafeInteger(field),
      statCode: (field) => typeof field === 'string' && STAT_CODES.includes(field as StatCode),
      statLabel: (field) => typeof field === 'string' && field.trim().length > 0,
    });
    if (!shape.ok) return shape;
    const statCode = entry['statCode'] as StatCode;
    const statLabel = entry['statLabel'] as string;
    const order = STAT_CODES.indexOf(statCode);
    if (seen.has(statCode) || order <= previousOrder) {
      return unrecognized(`${itemPath}.statCode`, statCode);
    }
    const previousLabel = statLabels.get(statCode);
    if (previousLabel !== undefined && previousLabel !== statLabel) {
      return unrecognized(`${itemPath}.statLabel`, statLabel);
    }
    statLabels.set(statCode, statLabel);
    previousOrder = order;
    seen.add(statCode);
  }
  return {
    ok: true,
    value: value as unknown as readonly LabeledStatModifierProjection[],
  };
}

function decodeStatModifierEffect(
  value: JsonValue,
  path: string,
  statLabels: Map<StatCode, string>,
): DecodeResult<StatModifierEffectProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  if (value['kind'] === 'NO_STAT_MODIFIERS') {
    const shape = decodeProjection(value, path, {
      kind: (field) => field === 'NO_STAT_MODIFIERS',
    });
    return shape.ok ? { ok: true, value: value as StatModifierEffectProjection } : shape;
  }
  if (value['kind'] !== 'ADDITIVE_STAT_MODIFIERS') {
    return unrecognized(`${path}.kind`, value['kind']!);
  }
  const entries = decodeLabeledStatModifiers(value['entries']!, `${path}.entries`, statLabels);
  if (!entries.ok) return entries;
  const shape = decodeProjection(value, path, {
    entries: (field) => field === value['entries'],
    kind: (field) => field === 'ADDITIVE_STAT_MODIFIERS',
  });
  return shape.ok ? { ok: true, value: value as StatModifierEffectProjection } : shape;
}

function decodeModeConsequences(
  value: JsonValue,
  path: string,
  expectedRaceChoice: 'FREE' | 'UNITED',
  statLabels: Map<StatCode, string>,
): DecodeResult<ModeConsequencesProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const modifiers = decodeStatModifierEffect(
    value['statModifiers']!,
    `${path}.statModifiers`,
    statLabels,
  );
  if (!modifiers.ok) return modifiers;
  const shape = decodeProjection(value, path, {
    baseSymbiontSlots: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    raceChoice: (field) => field === expectedRaceChoice,
    raceLabel: (field) => typeof field === 'string' && field.trim().length > 0,
    statModifiers: (field) => field === value['statModifiers'],
  });
  return shape.ok ? { ok: true, value: value as ModeConsequencesProjection } : shape;
}

function decodeModeConsequenceOptions(
  value: JsonValue,
  path: string,
  expectedRaceChoice: 'FREE' | 'UNITED',
  statLabels: Map<StatCode, string>,
): DecodeResult<readonly ModeConsequenceOptionProjection[]> {
  if (!Array.isArray(value) || value.length !== 2) return unrecognized(path, value);
  const expectedModes = ['MANUAL', 'RANDOM'] as const;
  const options = value as readonly JsonValue[];
  let raceLabel: string | null = null;
  let baseSymbiontSlots: number | null = null;
  for (const [index, option] of options.entries()) {
    const optionPath = `${path}[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const mode = expectedModes[index]!;
    if (option['symbiontAcquisitionMode'] !== mode) {
      return unrecognized(
        `${optionPath}.symbiontAcquisitionMode`,
        option['symbiontAcquisitionMode']!,
      );
    }
    const consequence = decodeModeConsequences(
      option['modeConsequences']!,
      `${optionPath}.modeConsequences`,
      expectedRaceChoice,
      statLabels,
    );
    if (!consequence.ok) return consequence;
    const shape = decodeProjection(option, optionPath, {
      modeConsequences: (field) => field === option['modeConsequences'],
      symbiontAcquisitionMode: (field) => field === mode,
    });
    if (!shape.ok) return shape;
    const expectedModifierKind =
      expectedRaceChoice === 'FREE' && mode === 'RANDOM'
        ? 'NO_STAT_MODIFIERS'
        : 'ADDITIVE_STAT_MODIFIERS';
    if (consequence.value.statModifiers.kind !== expectedModifierKind) {
      return unrecognized(
        `${optionPath}.modeConsequences.statModifiers.kind`,
        consequence.value.statModifiers.kind,
      );
    }
    if (
      (raceLabel !== null && consequence.value.raceLabel !== raceLabel) ||
      (baseSymbiontSlots !== null && consequence.value.baseSymbiontSlots !== baseSymbiontSlots)
    ) {
      return unrecognized(`${optionPath}.modeConsequences`, option['modeConsequences']!);
    }
    raceLabel = consequence.value.raceLabel;
    baseSymbiontSlots = consequence.value.baseSymbiontSlots;
  }
  return {
    ok: true,
    value: value as unknown as readonly ModeConsequenceOptionProjection[],
  };
}

function decodeRaceConsequencesPreview(
  value: JsonValue,
  path: string,
  expectedRaceChoice: 'FREE' | 'PURE' | 'UNITED',
  statLabels: Map<StatCode, string>,
): DecodeResult<RaceConsequencesPreviewProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const grantedSkills = value['grantedSkills'];
  if (!isJsonObject(grantedSkills)) return unrecognized(`${path}.grantedSkills`, grantedSkills!);
  if (expectedRaceChoice === 'UNITED') {
    const entries = grantedSkills['entries'];
    if (!Array.isArray(entries) || entries.length !== 1) {
      return unrecognized(`${path}.grantedSkills.entries`, entries!);
    }
    const entry = (entries as readonly JsonValue[])[0]!;
    if (!isJsonObject(entry)) return unrecognized(`${path}.grantedSkills.entries[0]`, entry);
    const decodedEntry = decodeProjection(entry, `${path}.grantedSkills.entries[0]`, {
      skillId: isPublicSkillId,
      skillLabel: isNonEmptyString,
    });
    if (!decodedEntry.ok) return decodedEntry;
    const decodedGranted = decodeProjection(grantedSkills, `${path}.grantedSkills`, {
      entries: (field) => field === entries,
      kind: (field) => field === 'GRANTED_SKILLS',
    });
    if (!decodedGranted.ok) return decodedGranted;
  } else {
    const decodedNone = decodeProjection(grantedSkills, `${path}.grantedSkills`, {
      kind: (field) => field === 'NO_GRANTED_SKILLS',
    });
    if (!decodedNone.ok) return decodedNone;
  }
  const raceModifiersByMode = value['raceStatModifiersByAcquisitionMode'];
  if (!isJsonObject(raceModifiersByMode)) {
    return unrecognized(`${path}.raceStatModifiersByAcquisitionMode`, raceModifiersByMode!);
  }
  if (expectedRaceChoice === 'PURE') {
    const notApplicable = decodeProjection(
      raceModifiersByMode,
      `${path}.raceStatModifiersByAcquisitionMode`,
      { kind: (field) => field === 'NOT_APPLICABLE' },
    );
    if (!notApplicable.ok) return notApplicable;
  } else {
    const alternatives = decodeModeConsequenceOptions(
      raceModifiersByMode['alternatives']!,
      `${path}.raceStatModifiersByAcquisitionMode.alternatives`,
      expectedRaceChoice,
      statLabels,
    );
    if (!alternatives.ok) return alternatives;
    const depends = decodeProjection(
      raceModifiersByMode,
      `${path}.raceStatModifiersByAcquisitionMode`,
      {
        alternatives: (field) => field === raceModifiersByMode['alternatives'],
        kind: (field) => field === 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE',
      },
    );
    if (!depends.ok) return depends;
    for (const [index, alternative] of alternatives.value.entries()) {
      if (
        alternative.modeConsequences.raceLabel !== value['raceLabel'] ||
        alternative.modeConsequences.baseSymbiontSlots !== value['baseSymbiontSlots']
      ) {
        return unrecognized(
          `${path}.raceStatModifiersByAcquisitionMode.alternatives[${String(index)}].modeConsequences`,
          alternative.modeConsequences,
        );
      }
    }
  }
  const expectedClassPolicy = expectedRaceChoice === 'PURE' ? 'REQUIRED_PURE_CLASS' : 'NO_CLASS';
  const expectedXpPolicy = expectedRaceChoice === 'FREE' ? 'XP_AWARD_X2' : 'STANDARD_XP_AWARD';
  const shape = decodeProjection(value, path, {
    allocationXpMultiplier: isPositiveSafeInteger,
    baseSymbiontSlots: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    classPolicy: (field) => field === expectedClassPolicy,
    directXpMultiplier: isPositiveSafeInteger,
    grantedSkills: (field) => field === grantedSkills,
    raceLabel: (field) => typeof field === 'string' && field.trim().length > 0,
    raceStatModifiersByAcquisitionMode: (field) => field === raceModifiersByMode,
    symbiontXpPolicy: (field) => field === expectedXpPolicy,
    symbioticMonsterAllowed: (field) => typeof field === 'boolean',
  });
  return shape.ok ? { ok: true, value: value as RaceConsequencesPreviewProjection } : shape;
}

function decodeRaceConsequenceOptions(
  value: JsonValue,
  path: string,
): DecodeResult<readonly RaceConsequenceOptionProjection[]> {
  if (!Array.isArray(value) || value.length !== 3) return unrecognized(path, value);
  const expectedRaceChoices = ['UNITED', 'FREE', 'PURE'] as const;
  const options = value as readonly JsonValue[];
  const statLabels = new Map<StatCode, string>();
  for (const [index, option] of options.entries()) {
    const optionPath = `${path}[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const raceChoice = expectedRaceChoices[index]!;
    if (option['raceChoice'] !== raceChoice) {
      return unrecognized(`${optionPath}.raceChoice`, option['raceChoice']!);
    }
    const consequences = decodeRaceConsequencesPreview(
      option['raceConsequencesPreview']!,
      `${optionPath}.raceConsequencesPreview`,
      raceChoice,
      statLabels,
    );
    if (!consequences.ok) return consequences;
    const shape = decodeProjection(option, optionPath, {
      raceChoice: (field) => field === raceChoice,
      raceConsequencesPreview: (field) => field === option['raceConsequencesPreview'],
    });
    if (!shape.ok) return shape;
  }
  return {
    ok: true,
    value: value as unknown as readonly RaceConsequenceOptionProjection[],
  };
}

function decodeMethodTerminalRule(
  value: JsonValue,
  path: string,
  method: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC',
  maximumAttempts: number,
): DecodeResult<MethodTerminalRuleProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  if (method === 'ALL_OR_NOTHING') {
    const shape = decodeProjection(value, path, {
      attemptIndex: (field) => isPositiveSafeInteger(field) && field === maximumAttempts,
      kind: (field) => field === 'MANDATORY_ACCEPT',
    });
    return shape.ok ? { ok: true, value: value as MethodTerminalRuleProjection } : shape;
  }
  const shape = decodeProjection(value, path, {
    afterAttempt: (field) => isPositiveSafeInteger(field) && field === maximumAttempts,
    exactTotal: isPositiveSafeInteger,
    kind: (field) => field === 'POINT_BUY_AFTER_REJECTION',
  });
  return shape.ok ? { ok: true, value: value as MethodTerminalRuleProjection } : shape;
}

function decodeMethodConsequences(
  value: JsonValue,
  path: string,
  method: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC',
): DecodeResult<MethodConsequencesProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const maximumAttempts = value['maximumAttempts'];
  if (!isPositiveSafeInteger(maximumAttempts!)) {
    return unrecognized(`${path}.maximumAttempts`, maximumAttempts!);
  }
  const rejectedSet = value['rejectedSet'];
  if (!isJsonObject(rejectedSet)) return unrecognized(`${path}.rejectedSet`, rejectedSet!);
  const rejectedShape = decodeProjection(rejectedSet, `${path}.rejectedSet`, {
    creationCriticalConsequencesDiscarded: (field) => field === true,
    irreversible: (field) => field === true,
    setValuesDiscarded: (field) => field === true,
  });
  if (!rejectedShape.ok) return rejectedShape;
  const terminal = decodeMethodTerminalRule(
    value['terminalRule']!,
    `${path}.terminalRule`,
    method,
    maximumAttempts,
  );
  if (!terminal.ok) return terminal;
  const shape = decodeProjection(value, path, {
    maximumAttempts: (field) => field === maximumAttempts,
    rejectedSet: (field) => field === rejectedSet,
    terminalRule: (field) => field === value['terminalRule'],
  });
  return shape.ok ? { ok: true, value: value as MethodConsequencesProjection } : shape;
}

function decodeMethodConsequenceOptions(
  value: JsonValue,
  path: string,
): DecodeResult<readonly MethodConsequenceOptionProjection[]> {
  if (!Array.isArray(value) || value.length !== 3) return unrecognized(path, value);
  const expectedMethods = ['CLASSIC', 'ADVENTUROUS', 'ALL_OR_NOTHING'] as const;
  const options = value as readonly JsonValue[];
  for (const [index, option] of options.entries()) {
    const optionPath = `${path}[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const method = expectedMethods[index]!;
    if (option['statMethod'] !== method) {
      return unrecognized(`${optionPath}.statMethod`, option['statMethod']!);
    }
    const consequences = decodeMethodConsequences(
      option['methodConsequences']!,
      `${optionPath}.methodConsequences`,
      method,
    );
    if (!consequences.ok) return consequences;
    const shape = decodeProjection(option, optionPath, {
      methodConsequences: (field) => field === option['methodConsequences'],
      statMethod: (field) => field === method,
    });
    if (!shape.ok) return shape;
  }
  return {
    ok: true,
    value: value as unknown as readonly MethodConsequenceOptionProjection[],
  };
}

function decodeChr010Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const options = decodeRaceConsequenceOptions(
    value['raceConsequenceOptions']!,
    `${path}.raceConsequenceOptions`,
  );
  if (!options.ok) return options;
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    ancientOptionSerialized: (field) => field === false,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    choiceLockStatus: (field) => field === 'UNLOCKED',
    commandId: (field) => field === null,
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    raceConsequenceOptions: (field) => field === value['raceConsequenceOptions'],
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
  const raceChoice = value['raceChoice'];
  if (raceChoice !== 'FREE' && raceChoice !== 'UNITED') {
    return unrecognized(`${path}.raceChoice`, raceChoice!);
  }
  const options = decodeModeConsequenceOptions(
    value['modeConsequenceOptions']!,
    `${path}.modeConsequenceOptions`,
    raceChoice,
    new Map<StatCode, string>(),
  );
  if (!options.ok) return options;
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    choiceLockStatus: (field) => field === 'UNLOCKED',
    commandId: (field) => field === null,
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    modeConsequences: (field) => field === null,
    modeConsequenceOptions: (field) => field === value['modeConsequenceOptions'],
    raceChoice: (field) => field === raceChoice,
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
  const options = decodeMethodConsequenceOptions(
    value['methodConsequenceOptions']!,
    `${path}.methodConsequenceOptions`,
  );
  if (!options.ok) return options;
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    choiceLockStatus: (field) => field === 'UNLOCKED',
    commandId: (field) => field === null,
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    methodConsequences: (field) => field === null,
    methodConsequenceOptions: (field) => field === value['methodConsequenceOptions'],
    statMethod: (field) => field === null,
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function decodeStatMap<T extends JsonValue>(
  value: JsonValue,
  path: string,
  validValue: (entry: JsonValue) => entry is T,
): DecodeResult<StatMap<T>> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const keys = exactObjectKeys(value, new Set(STAT_CODES), path);
  if (!keys.ok) return keys;
  for (const statCode of STAT_CODES) {
    const entry = value[statCode];
    if (entry === undefined || !validValue(entry)) {
      return unrecognized(`${path}.${statCode}`, entry ?? null);
    }
  }
  return { ok: true, value: value as StatMap<T> };
}

function decodeStatModifiers(
  value: JsonValue,
  path: string,
): DecodeResult<readonly StatModifierProjection[]> {
  if (!Array.isArray(value)) return unrecognized(path, value);
  const entries = value as readonly JsonValue[];
  const seen = new Set<StatCode>();
  for (const [index, entry] of entries.entries()) {
    const itemPath = `${path}[${String(index)}]`;
    if (!isJsonObject(entry)) return unrecognized(itemPath, entry);
    const keys = exactObjectKeys(entry, new Set(['delta', 'statCode']), itemPath);
    if (!keys.ok) return keys;
    const statCode = entry['statCode'];
    const delta = entry['delta'];
    if (
      typeof statCode !== 'string' ||
      !STAT_CODES.includes(statCode as StatCode) ||
      seen.has(statCode as StatCode)
    ) {
      return unrecognized(`${itemPath}.statCode`, statCode!);
    }
    if (typeof delta !== 'number' || !Number.isSafeInteger(delta) || delta === 0) {
      return unrecognized(`${itemPath}.delta`, delta!);
    }
    seen.add(statCode as StatCode);
  }
  return { ok: true, value: value as unknown as readonly StatModifierProjection[] };
}

function decodeMandatoryClassSkill(
  value: JsonValue,
  path: string,
): DecodeResult<MandatoryClassSkillProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const decoded = decodeProjection(value, path, {
    bonus: (field) => typeof field === 'number' && Number.isSafeInteger(field),
    skillKey: isNonEmptyString,
    slotCost: (field) => isSafeIntegerAtLeast(field, 0),
  });
  return decoded.ok ? { ok: true, value: value as MandatoryClassSkillProjection } : decoded;
}

function decodeChr009Proof(
  value: JsonValue,
  path: string,
  mode: StatAssignmentMode,
): DecodeResult<ExactSumProof | RolledBijectionProof> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  if (mode !== 'ROLLED_BIJECTION') {
    const decoded = decodeProjection(value, path, {
      actualTotal: (field) => field === null,
      kind: (field) => field === 'EXACT_SUM',
      requiredTotal: (field) => field === (mode === 'POINT_BUY_90' ? 90 : 85),
    });
    return decoded.ok ? { ok: true, value: value as ExactSumProof } : decoded;
  }
  const sourceEntries = value['sourceEntries'];
  if (!Array.isArray(sourceEntries) || sourceEntries.length !== STAT_CODES.length) {
    return unrecognized(`${path}.sourceEntries`, sourceEntries!);
  }
  const entries = sourceEntries as readonly JsonValue[];
  for (const [index, entry] of entries.entries()) {
    const itemPath = `${path}.sourceEntries[${String(index)}]`;
    if (!isJsonObject(entry)) return unrecognized(itemPath, entry);
    const decoded = decodeProjection(entry, itemPath, {
      creationCriticalPenaltyOrNull: (field) =>
        field === null ||
        (typeof field === 'number' && Number.isSafeInteger(field) && field <= -1 && field >= -5),
      setEntryIndex: (field) => field === index,
      value: (field) => typeof field === 'number' && Number.isSafeInteger(field),
    });
    if (!decoded.ok) return decoded;
  }
  const decoded = decodeProjection(value, path, {
    assignedSetEntryIndexByStat: (field) => field === null,
    kind: (field) => field === 'ROLLED_BIJECTION',
    sourceEntries: (field) => field === sourceEntries,
  });
  return decoded.ok ? { ok: true, value: value as unknown as RolledBijectionProof } : decoded;
}

function decodeChr009Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const mode = value['assignmentMode'];
  if (mode !== 'ROLLED_BIJECTION' && mode !== 'POINT_BUY_90' && mode !== 'POINT_BUY_85') {
    return unrecognized(`${path}.assignmentMode`, mode!);
  }
  const proof = decodeChr009Proof(
    value['bijectionProofOrExactSum']!,
    `${path}.bijectionProofOrExactSum`,
    mode,
  );
  if (!proof.ok) return proof;
  const characterDraftId = value['characterDraftId'];
  const result = decodeProjection(value, path, {
    C: (field) => field === null,
    D: (field) => field === null,
    I: (field) => field === null,
    M: (field) => field === null,
    S: (field) => field === null,
    W: (field) => field === null,
    Z: (field) => field === null,
    assignmentMode: (field) => field === mode,
    assignmentValidation: (field) => field === null,
    bijectionProofOrExactSum: (field) => field === value['bijectionProofOrExactSum'],
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    eachValueRange: (field) =>
      mode === 'ROLLED_BIJECTION'
        ? field === null
        : isJsonObject(field) && sameJson(field, { maximum: 20, minimum: 1 }),
    raceChoice: (field) => field === 'FREE' || field === 'PURE' || field === 'UNITED',
    sourceSetReceiptIdOrNull: (field) =>
      mode === 'ROLLED_BIJECTION' ? isNonEmptyString(field) : field === null,
    wizardCheckpointId: (field) => isNonEmptyString(field) && field !== characterDraftId,
  });
  if (!result.ok) return result;
  const ids = [
    characterDraftId,
    value['wizardCheckpointId'],
    value['sourceSetReceiptIdOrNull'],
  ].filter((entry): entry is string => typeof entry === 'string');
  return new Set(ids).size === ids.length
    ? result
    : unrecognized(`${path}.sourceSetReceiptIdOrNull`, value['sourceSetReceiptIdOrNull']!);
}

function decodeChr011Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const options = value['classOptions'];
  if (!Array.isArray(options) || options.length !== PURE_CLASSES.length) {
    return unrecognized(`${path}.classOptions`, options!);
  }
  const entries = options as readonly JsonValue[];
  const skillKeys = new Set<string>();
  for (const [index, option] of entries.entries()) {
    const optionPath = `${path}.classOptions[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const consequences = option['classConsequences'];
    if (!isJsonObject(consequences)) {
      return unrecognized(`${optionPath}.classConsequences`, consequences!);
    }
    const consequenceShape = decodeProjection(consequences, `${optionPath}.classConsequences`, {
      statModifiers: (field) => field === consequences['statModifiers'],
    });
    if (!consequenceShape.ok) return consequenceShape;
    const modifiers = decodeStatModifiers(
      consequences['statModifiers']!,
      `${optionPath}.classConsequences.statModifiers`,
    );
    if (!modifiers.ok) return modifiers;
    const mandatory = decodeMandatoryClassSkill(
      option['mandatoryClassSkill']!,
      `${optionPath}.mandatoryClassSkill`,
    );
    if (!mandatory.ok) return mandatory;
    if (skillKeys.has(mandatory.value.skillKey)) {
      return unrecognized(`${optionPath}.mandatoryClassSkill.skillKey`, mandatory.value.skillKey);
    }
    skillKeys.add(mandatory.value.skillKey);
    const optionShape = decodeProjection(option, optionPath, {
      classConsequences: (field) => field === consequences,
      mandatoryClassSkill: (field) => field === option['mandatoryClassSkill'],
      pureClass: (field) => field === PURE_CLASSES[index],
    });
    if (!optionShape.ok) return optionShape;
  }
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    classConsequences: (field) => field === null,
    classOptions: (field) => field === value['classOptions'],
    commandId: (field) => field === null,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    mandatoryClassSkill: (field) => field === null,
    pureClass: (field) => field === null,
    raceChoice: (field) => field === 'PURE',
    wizardCheckpointId: (field) => isNonEmptyString(field) && field !== characterDraftId,
  });
}

function decodeChr012Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const integer = (entry: JsonValue): entry is number =>
    typeof entry === 'number' && Number.isSafeInteger(entry);
  const base = decodeStatMap(value['baseStats']!, `${path}.baseStats`, integer);
  if (!base.ok) return base;
  const skill = decodeStatMap(value['skillStageStats']!, `${path}.skillStageStats`, integer);
  if (!skill.ok) return skill;
  const race = decodeStatModifiers(value['raceModifiers']!, `${path}.raceModifiers`);
  if (!race.ok) return race;
  const classValue = value['classModifiersOrNull'];
  let classModifiers: readonly StatModifierProjection[] = [];
  if (classValue !== null) {
    const decodedClassModifiers = decodeStatModifiers(classValue!, `${path}.classModifiersOrNull`);
    if (!decodedClassModifiers.ok) return decodedClassModifiers;
    classModifiers = decodedClassModifiers.value;
  }
  const mandatory = value['mandatoryClassSkillOrNull'];
  let mandatorySkill: MandatoryClassSkillProjection | null = null;
  if (mandatory !== null) {
    const decodedMandatory = decodeMandatoryClassSkill(
      mandatory!,
      `${path}.mandatoryClassSkillOrNull`,
    );
    if (!decodedMandatory.ok) return decodedMandatory;
    mandatorySkill = decodedMandatory.value;
  }
  if (
    (classValue === null) !== (mandatorySkill === null) ||
    (classValue !== null && race.value.length !== 0)
  ) {
    return unrecognized(`${path}.classModifiersOrNull`, classValue!);
  }
  for (const statCode of STAT_CODES) {
    const modifierTotal = [...race.value, ...classModifiers]
      .filter((modifier) => modifier.statCode === statCode)
      .reduce((total, modifier) => total + modifier.delta, 0);
    if (skill.value[statCode] !== base.value[statCode] + modifierTotal) {
      return unrecognized(`${path}.skillStageStats.${statCode}`, skill.value[statCode]);
    }
  }
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    baseStats: (field) => field === value['baseStats'],
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    classModifiersOrNull: (field) => field === classValue,
    commandId: (field) => field === null,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    mandatoryClassSkillOrNull: (field) => field === mandatory,
    raceModifiers: (field) => field === value['raceModifiers'],
    skillStageStats: (field) => field === value['skillStageStats'],
    symbiontModifiersExcluded: (field) => field === true,
    wizardCheckpointId: (field) => isNonEmptyString(field) && field !== characterDraftId,
  });
}

function isPublicSkillId(value: JsonValue): value is string {
  return isNonEmptyString(value) && !/^(?:CORE|Q|REQ|SKL)-/u.test(value);
}

function decodeSkillLevelOptions(
  value: JsonValue,
  path: string,
): DecodeResult<readonly SkillLevelOptionProjection[]> {
  if (!Array.isArray(value)) return unrecognized(path, value);
  for (const [index, option] of (value as readonly JsonValue[]).entries()) {
    const optionPath = `${path}[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const decoded = decodeProjection(option, optionPath, {
      slotCost: (field) => isSafeIntegerAtLeast(field, 1),
      targetBonus: (field) => field === index + 1,
    });
    if (!decoded.ok) return decoded;
    if (index > 0) {
      const previous = value[index - 1] as JsonObject;
      if ((option['slotCost'] as number) < (previous['slotCost'] as number)) {
        return unrecognized(`${optionPath}.slotCost`, option['slotCost']!);
      }
    }
  }
  return { ok: true, value: value as unknown as readonly SkillLevelOptionProjection[] };
}

function decodeFixedSkill(
  value: JsonValue,
  path: string,
  expectedSlotCost: 0 | 1,
): DecodeResult<FixedSkillProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const decoded = decodeProjection(value, path, {
    bonus: (field) => isSafeIntegerAtLeast(field, 1),
    skillId: isPublicSkillId,
    skillLabel: isNonEmptyString,
    slotCost: (field) => field === expectedSlotCost,
  });
  return decoded.ok ? { ok: true, value: value as FixedSkillProjection } : decoded;
}

function decodeRacialFreeSkills(
  value: JsonValue,
  path: string,
): DecodeResult<readonly FixedSkillProjection[]> {
  if (!Array.isArray(value) || value.length > 1) return unrecognized(path, value);
  for (const [index, skill] of (value as readonly JsonValue[]).entries()) {
    const decoded = decodeFixedSkill(skill, `${path}[${String(index)}]`, 0);
    if (!decoded.ok) return decoded;
  }
  return { ok: true, value: value as unknown as readonly FixedSkillProjection[] };
}

function decodeMissingSkillPenalty(
  value: JsonValue,
  path: string,
): DecodeResult<MissingSkillPenaltyProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  if (value['kind'] === 'NO_MISSING_SKILL_PENALTY') {
    const decoded = decodeProjection(value, path, {
      kind: (field) => field === 'NO_MISSING_SKILL_PENALTY',
    });
    return decoded.ok ? { ok: true, value: value as MissingSkillPenaltyProjection } : decoded;
  }
  if (value['kind'] === 'MISSING_SKILL_PENALTY') {
    const decoded = decodeProjection(value, path, {
      kind: (field) => field === 'MISSING_SKILL_PENALTY',
      value: (field) => typeof field === 'number' && Number.isSafeInteger(field),
    });
    return decoded.ok ? { ok: true, value: value as MissingSkillPenaltyProjection } : decoded;
  }
  return unrecognized(`${path}.kind`, value['kind']!);
}

function decodeSkillCardSummaries(
  value: JsonValue,
  path: string,
  skillStageStats: StatMap<number>,
): DecodeResult<readonly SkillCardSummaryProjection[]> {
  if (!Array.isArray(value) || value.length !== 41) return unrecognized(path, value);
  const ids = new Set<string>();
  const statLabels = new Map<StatCode, string>();
  let missingSkillPenaltyCount = 0;
  for (const [index, card] of (value as readonly JsonValue[]).entries()) {
    const cardPath = `${path}[${String(index)}]`;
    if (!isJsonObject(card)) return unrecognized(cardPath, card);
    const skillId = card['skillId'];
    if (!isPublicSkillId(skillId!) || ids.has(skillId)) {
      return unrecognized(`${cardPath}.skillId`, skillId!);
    }
    ids.add(skillId);
    const levels = decodeSkillLevelOptions(card['levelOptions']!, `${cardPath}.levelOptions`);
    if (!levels.ok) return levels;
    const missingSkillPenalty = decodeMissingSkillPenalty(
      card['missingSkillPenalty']!,
      `${cardPath}.missingSkillPenalty`,
    );
    if (!missingSkillPenalty.ok) return missingSkillPenalty;
    if (missingSkillPenalty.value.kind === 'MISSING_SKILL_PENALTY') {
      missingSkillPenaltyCount += 1;
    }
    const requirements = card['requirements'];
    if (!Array.isArray(requirements) || requirements.length === 0) {
      return unrecognized(`${cardPath}.requirements`, requirements!);
    }
    let previousStatOrder = -1;
    for (const [requirementIndex, requirement] of (
      requirements as readonly JsonValue[]
    ).entries()) {
      const requirementPath = `${cardPath}.requirements[${String(requirementIndex)}]`;
      if (!isJsonObject(requirement)) return unrecognized(requirementPath, requirement);
      const decoded = decodeProjection(requirement, requirementPath, {
        currentValue: (field) => typeof field === 'number' && Number.isSafeInteger(field),
        minValue: (field) => isSafeIntegerAtLeast(field, 1),
        satisfied: (field) => typeof field === 'boolean',
        statCode: (field) => typeof field === 'string' && STAT_CODES.includes(field as StatCode),
        statLabel: isNonEmptyString,
      });
      if (!decoded.ok) return decoded;
      const statCode = requirement['statCode'] as StatCode;
      const order = STAT_CODES.indexOf(statCode);
      const statLabel = requirement['statLabel'] as string;
      if (order <= previousStatOrder || requirement['currentValue'] !== skillStageStats[statCode]) {
        return unrecognized(`${requirementPath}.statCode`, statCode);
      }
      const previousLabel = statLabels.get(statCode);
      if (previousLabel !== undefined && previousLabel !== statLabel) {
        return unrecognized(`${requirementPath}.statLabel`, statLabel);
      }
      statLabels.set(statCode, statLabel);
      previousStatOrder = order;
      const currentValue = requirement['currentValue'];
      const minValue = requirement['minValue'];
      if (typeof currentValue !== 'number' || typeof minValue !== 'number') {
        return unrecognized(requirementPath, requirement);
      }
      const expectedSatisfied = currentValue >= minValue;
      if (requirement['satisfied'] !== expectedSatisfied) {
        return unrecognized(`${requirementPath}.satisfied`, requirement['satisfied']!);
      }
    }
    const eligibility = card['eligibility'];
    const expectedEligibility = (requirements as readonly JsonObject[]).every(
      (requirement) => requirement['satisfied'] === true,
    )
      ? 'ELIGIBLE'
      : 'REQUIREMENTS_NOT_MET';
    const decoded = decodeProjection(card, cardPath, {
      bonusDomainScope: isNonEmptyString,
      eligibility: (field) => field === expectedEligibility,
      levelOptions: (field) => field === card['levelOptions'],
      missingSkillPenalty: (field) => field === card['missingSkillPenalty'],
      requirements: (field) => field === requirements,
      skillId: (field) => field === skillId,
      skillLabel: isNonEmptyString,
    });
    if (!decoded.ok) return decoded;
    if (eligibility !== expectedEligibility) {
      return unrecognized(`${cardPath}.eligibility`, eligibility!);
    }
  }
  if (missingSkillPenaltyCount !== 15) return unrecognized(path, value);
  return { ok: true, value: value as unknown as readonly SkillCardSummaryProjection[] };
}

function decodeChr013Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const integer = (entry: JsonValue): entry is number =>
    typeof entry === 'number' && Number.isSafeInteger(entry);
  const stats = decodeStatMap(value['skillStageStats']!, `${path}.skillStageStats`, integer);
  if (!stats.ok) return stats;
  const cards = decodeSkillCardSummaries(
    value['skillCardSummaries']!,
    `${path}.skillCardSummaries`,
    stats.value,
  );
  if (!cards.ok) return cards;
  const expectedEligibleIds = cards.value
    .filter(({ eligibility }) => eligibility === 'ELIGIBLE')
    .map(({ skillId }) => skillId);
  if (!sameJson(value['eligibleSkillIds']!, expectedEligibleIds)) {
    return unrecognized(`${path}.eligibleSkillIds`, value['eligibleSkillIds']!);
  }
  const slotSources = value['slotSources'];
  if (!isJsonObject(slotSources)) return unrecognized(`${path}.slotSources`, slotSources!);
  const mandatoryValue = slotSources['mandatoryClassSkillOrNull'];
  if (mandatoryValue !== null) {
    const mandatory = decodeFixedSkill(
      mandatoryValue!,
      `${path}.slotSources.mandatoryClassSkillOrNull`,
      1,
    );
    if (!mandatory.ok) return mandatory;
    if (expectedEligibleIds.includes(mandatory.value.skillId)) {
      return unrecognized(
        `${path}.slotSources.mandatoryClassSkillOrNull.skillId`,
        mandatory.value.skillId,
      );
    }
  }
  const racial = decodeRacialFreeSkills(
    slotSources['racialFreeSkills']!,
    `${path}.slotSources.racialFreeSkills`,
  );
  if (!racial.ok) return racial;
  if (mandatoryValue !== null && racial.value.length !== 0) {
    return unrecognized(`${path}.slotSources.racialFreeSkills`, slotSources['racialFreeSkills']!);
  }
  const fixedIds = [
    ...(mandatoryValue === null ? [] : [(mandatoryValue as FixedSkillProjection).skillId]),
    ...racial.value.map(({ skillId }) => skillId),
  ];
  if (fixedIds.some((skillId) => cards.value.some((card) => card.skillId === skillId))) {
    return unrecognized(`${path}.slotSources.racialFreeSkills`, slotSources['racialFreeSkills']!);
  }
  const decodedSlotSources = decodeProjection(slotSources, `${path}.slotSources`, {
    mandatoryClassSkillOrNull: (field) => field === mandatoryValue,
    racialFreeSkills: (field) => field === slotSources['racialFreeSkills'],
    requiredSlotCount: (field) => isSafeIntegerAtLeast(field, 1),
  });
  if (!decodedSlotSources.ok) return decodedSlotSources;
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    eligibleSkillIds: (field) => field === value['eligibleSkillIds'],
    selectedSkillIdOrNull: (field) => field === null,
    skillCardSummaries: (field) => field === value['skillCardSummaries'],
    skillStageStats: (field) => field === value['skillStageStats'],
    slotSources: (field) => field === slotSources,
    wizardCheckpointId: (field) => isNonEmptyString(field) && field !== characterDraftId,
  });
}

function skillSelectionValidation(
  requiredSlotCount: number,
  usedSlotCount: number,
): SkillSelectionValidation {
  if (usedSlotCount < requiredSlotCount) {
    return {
      kind: 'UNDERFILLED',
      missingSlotCount: requiredSlotCount - usedSlotCount,
      requiredSlotCount,
      usedSlotCount,
    };
  }
  if (usedSlotCount > requiredSlotCount) {
    return {
      excessSlotCount: usedSlotCount - requiredSlotCount,
      kind: 'OVERFILLED',
      requiredSlotCount,
      usedSlotCount,
    };
  }
  return { kind: 'EXACT', requiredSlotCount, usedSlotCount };
}

function decodeSkillOptions(
  value: JsonValue,
  path: string,
): DecodeResult<readonly SkillOptionProjection[]> {
  if (!Array.isArray(value)) return unrecognized(path, value);
  const ids = new Set<string>();
  for (const [index, option] of (value as readonly JsonValue[]).entries()) {
    const optionPath = `${path}[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const skillId = option['skillId'];
    if (!isPublicSkillId(skillId!) || ids.has(skillId)) {
      return unrecognized(`${optionPath}.skillId`, skillId!);
    }
    ids.add(skillId);
    const levels = decodeSkillLevelOptions(option['levelOptions']!, `${optionPath}.levelOptions`);
    if (!levels.ok) return levels;
    const missingSkillPenalty = decodeMissingSkillPenalty(
      option['missingSkillPenalty']!,
      `${optionPath}.missingSkillPenalty`,
    );
    if (!missingSkillPenalty.ok) return missingSkillPenalty;
    const decoded = decodeProjection(option, optionPath, {
      bonusDomainScope: isNonEmptyString,
      levelOptions: (field) => field === option['levelOptions'],
      missingSkillPenalty: (field) => field === option['missingSkillPenalty'],
      skillId: (field) => field === skillId,
      skillLabel: isNonEmptyString,
    });
    if (!decoded.ok) return decoded;
  }
  return { ok: true, value: value as unknown as readonly SkillOptionProjection[] };
}

function decodeChr015Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const requiredSlotCount = value['requiredSlotCount'];
  if (!isSafeIntegerAtLeast(requiredSlotCount!, 1)) {
    return unrecognized(`${path}.requiredSlotCount`, requiredSlotCount!);
  }
  const options = decodeSkillOptions(value['skillOptions']!, `${path}.skillOptions`);
  if (!options.ok) return options;
  const eligibleSkillIds = options.value.map(({ skillId }) => skillId);
  if (!sameJson(value['eligibleSkillIds']!, eligibleSkillIds)) {
    return unrecognized(`${path}.eligibleSkillIds`, value['eligibleSkillIds']!);
  }
  const optionById = new Map(options.value.map((option) => [option.skillId, option]));
  const mandatoryValue = value['mandatoryClassSkillOrNull'];
  let mandatory: FixedSkillProjection | null = null;
  if (mandatoryValue !== null) {
    const decodedMandatory = decodeFixedSkill(
      mandatoryValue!,
      `${path}.mandatoryClassSkillOrNull`,
      1,
    );
    if (!decodedMandatory.ok) return decodedMandatory;
    mandatory = decodedMandatory.value;
    if (optionById.has(mandatory.skillId)) {
      return unrecognized(`${path}.mandatoryClassSkillOrNull.skillId`, mandatory.skillId);
    }
  }
  const racial = decodeRacialFreeSkills(value['racialFreeSkills']!, `${path}.racialFreeSkills`);
  if (!racial.ok) return racial;
  if (
    !sameJson(
      value['racialFreeSkillIds']!,
      racial.value.map(({ skillId }) => skillId),
    )
  ) {
    return unrecognized(`${path}.racialFreeSkillIds`, value['racialFreeSkillIds']!);
  }
  if (
    (mandatory !== null && racial.value.length !== 0) ||
    racial.value.some(({ skillId }) => optionById.has(skillId))
  ) {
    return unrecognized(`${path}.racialFreeSkills`, value['racialFreeSkills']!);
  }
  const selectedValue = value['selectedSkills'];
  if (!Array.isArray(selectedValue)) return unrecognized(`${path}.selectedSkills`, selectedValue!);
  const selectedSkills: SelectedSkillProjection[] = [];
  let previousOptionIndex = -1;
  for (const [index, selected] of (selectedValue as readonly JsonValue[]).entries()) {
    const selectedPath = `${path}.selectedSkills[${String(index)}]`;
    if (!isJsonObject(selected)) return unrecognized(selectedPath, selected);
    const skillId = selected['skillId'];
    const option = typeof skillId === 'string' ? optionById.get(skillId) : undefined;
    const optionIndex = option === undefined ? -1 : options.value.indexOf(option);
    const matchingLevel = option?.levelOptions.find(
      ({ slotCost, targetBonus }) =>
        slotCost === selected['slotCost'] && targetBonus === selected['targetBonus'],
    );
    if (option === undefined || optionIndex <= previousOptionIndex || matchingLevel === undefined) {
      return unrecognized(`${selectedPath}.skillId`, skillId!);
    }
    const decoded = decodeProjection(selected, selectedPath, {
      skillId: (field) => field === skillId,
      slotCost: (field) => field === matchingLevel.slotCost,
      targetBonus: (field) => field === matchingLevel.targetBonus,
    });
    if (!decoded.ok) return decoded;
    selectedSkills.push(selected as unknown as SelectedSkillProjection);
    previousOptionIndex = optionIndex;
  }
  if (
    !sameJson(
      value['selectedSkillIds']!,
      selectedSkills.map(({ skillId }) => skillId),
    )
  ) {
    return unrecognized(`${path}.selectedSkillIds`, value['selectedSkillIds']!);
  }
  if (value['commandId'] === null && selectedSkills.length !== 0) {
    return unrecognized(`${path}.selectedSkills`, selectedValue);
  }
  const expectedUsageEntries: PaidSkillUsageEntryProjection[] = [
    ...(mandatory === null ? [] : [{ ...mandatory, source: 'CLASS_MANDATORY' as const }]),
    ...selectedSkills.map((selected) => ({
      bonus: selected.targetBonus,
      skillId: selected.skillId,
      skillLabel: optionById.get(selected.skillId)!.skillLabel,
      slotCost: selected.slotCost,
      source: 'SELECTED' as const,
    })),
  ];
  const usedSlotCount = expectedUsageEntries.reduce((sum, entry) => sum + entry.slotCost, 0);
  const paidSlotUsage = value['paidSlotUsage'];
  if (!isJsonObject(paidSlotUsage)) {
    return unrecognized(`${path}.paidSlotUsage`, paidSlotUsage!);
  }
  const decodedUsage = decodeProjection(paidSlotUsage, `${path}.paidSlotUsage`, {
    entries: (field) => sameJson(field, expectedUsageEntries),
    usedSlotCount: (field) => field === usedSlotCount,
  });
  if (!decodedUsage.ok) return decodedUsage;
  const expectedValidation = skillSelectionValidation(requiredSlotCount, usedSlotCount);
  if (!isJsonObject(value['selectionValidation'])) {
    return unrecognized(`${path}.selectionValidation`, value['selectionValidation']!);
  }
  const decodedValidation = decodeProjection(
    value['selectionValidation'],
    `${path}.selectionValidation`,
    Object.fromEntries(
      Object.entries(expectedValidation).map(([key, expected]) => [
        key,
        (field: JsonValue) => field === expected,
      ]),
    ),
  );
  if (!decodedValidation.ok) return decodedValidation;
  const commandId = value['commandId'];
  if (commandId === undefined) {
    return refused({
      actualType: 'undefined',
      code: 'INVALID_SHAPE',
      expected: 'null or non-empty command id',
      path: `${path}.commandId`,
    });
  }
  if (commandId !== null && !isNonEmptyString(commandId)) {
    return unrecognized(`${path}.commandId`, commandId);
  }
  if (commandId !== null && expectedValidation.kind !== 'EXACT') {
    return unrecognized(`${path}.selectionValidation.kind`, expectedValidation.kind);
  }
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === commandId,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    eligibleSkillIds: (field) => field === value['eligibleSkillIds'],
    mandatoryClassSkillOrNull: (field) => field === mandatoryValue,
    paidSlotUsage: (field) => field === paidSlotUsage,
    racialFreeSkillIds: (field) => field === value['racialFreeSkillIds'],
    racialFreeSkills: (field) => field === value['racialFreeSkills'],
    requiredSlotCount: (field) => field === requiredSlotCount,
    selectedSkillIds: (field) => field === value['selectedSkillIds'],
    selectedSkills: (field) => field === selectedValue,
    selectionValidation: (field) => field === value['selectionValidation'],
    skillOptions: (field) => field === value['skillOptions'],
    wizardCheckpointId: (field) => isNonEmptyString(field) && field !== characterDraftId,
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
    case 'CHR-009':
      projection = decodeChr009Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const forwardAction =
          projection.value['raceChoice'] === 'PURE'
            ? ('CHR-009::CTA::001' as const)
            : ('CHR-009::CTA::002' as const);
        const actions = exactActionKeys(
          base.availableActionKeys,
          executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID)
            ? [forwardAction]
            : NO_ACTION_KEYS,
          '$.presentation.base.availableActionKeys',
        );
        if (!actions.ok) return actions;
      }
      break;
    case 'CHR-011':
      projection = decodeChr011Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const actions = exactActionKeys(
          base.availableActionKeys,
          CHR_011_SELECTOR_ACTION_KEYS,
          '$.presentation.base.availableActionKeys',
        );
        if (!actions.ok) return actions;
      }
      break;
    case 'CHR-012':
      projection = decodeChr012Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const actions = exactActionKeys(
          base.availableActionKeys,
          NO_ACTION_KEYS,
          '$.presentation.base.availableActionKeys',
        );
        if (!actions.ok) return actions;
      }
      break;
    case 'CHR-013':
      projection = decodeChr013Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const actions = exactActionKeys(
          base.availableActionKeys,
          CHR_013_ACTION_KEYS,
          '$.presentation.base.availableActionKeys',
        );
        if (!actions.ok) return actions;
      }
      break;
    case 'CHR-015':
      projection = decodeChr015Projection(
        base.roleFilteredPayload,
        '$.presentation.base.roleFilteredPayload',
        base.routeBindings[0]?.value,
      );
      if (projection.ok) {
        const actions = exactActionKeys(
          base.availableActionKeys,
          projection.value['commandId'] === null ? CHR_015_MUTABLE_ACTION_KEYS : NO_ACTION_KEYS,
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

function emptyStatDraftValues(): StatMap<null> {
  return { S: null, D: null, M: null, Z: null, I: null, W: null, C: null };
}

function validateStatAssignmentDraft(
  assignmentMode: StatAssignmentMode,
  valuesByStat: StatMap<number | null>,
): StatAssignmentValidation {
  const values = STAT_CODES.map((statCode) => valuesByStat[statCode]);
  if (values.some((value) => value === null)) return 'ASSIGNMENT_INVALID';
  const complete = values as number[];
  if (
    complete.some(
      (value) =>
        !Number.isSafeInteger(value) ||
        value < (assignmentMode === 'ROLLED_BIJECTION' ? 0 : 1) ||
        value > (assignmentMode === 'ROLLED_BIJECTION' ? 6 : 20),
    )
  ) {
    return 'ASSIGNMENT_INVALID';
  }
  if (assignmentMode === 'ROLLED_BIJECTION') {
    return new Set(complete).size === STAT_CODES.length
      ? 'READY_TO_CHECKPOINT'
      : 'ASSIGNMENT_INVALID';
  }
  const requiredTotal = assignmentMode === 'POINT_BUY_90' ? 90 : 85;
  return complete.reduce((total, value) => total + value, 0) === requiredTotal
    ? 'READY_TO_CHECKPOINT'
    : 'ASSIGNMENT_INVALID';
}

function creationStatAssignmentDraftFromSnapshot(
  snapshot: ConfirmedProjectionSnapshot,
): CharacterStatAssignmentDraft | null {
  if (snapshot.formId !== 'CHR-009') return null;
  const assignmentMode = snapshot.projection['assignmentMode'] as StatAssignmentMode;
  return {
    assignmentMode,
    formId: 'CHR-009',
    validation: 'ASSIGNMENT_INVALID',
    valuesByStat: emptyStatDraftValues(),
  };
}

function creationSkillSelectionDraftFromSnapshot(
  snapshot: ConfirmedProjectionSnapshot,
): CharacterSkillSelectionDraft | null {
  if (snapshot.formId !== 'CHR-015') return null;
  const projection = snapshot.projection as Chr015Projection;
  if (projection.commandId !== null) return null;
  return {
    candidateSkillIdOrNull: null,
    candidateTargetBonusOrNull: null,
    formId: 'CHR-015',
    paidSlotUsage: projection.paidSlotUsage,
    selectedSkillIds: [...projection.selectedSkillIds],
    selectedSkills: [...projection.selectedSkills],
    selectionValidation: projection.selectionValidation,
  };
}

function paidSlotUsageForSkillSelection(
  projection: Chr015Projection,
  selectedSkills: readonly SelectedSkillProjection[],
): PaidSlotUsageProjection {
  const optionById = new Map(projection.skillOptions.map((option) => [option.skillId, option]));
  const entries: PaidSkillUsageEntryProjection[] = [
    ...(projection.mandatoryClassSkillOrNull === null
      ? []
      : [{ ...projection.mandatoryClassSkillOrNull, source: 'CLASS_MANDATORY' as const }]),
    ...selectedSkills.map((selected) => ({
      bonus: selected.targetBonus,
      skillId: selected.skillId,
      skillLabel: optionById.get(selected.skillId)!.skillLabel,
      slotCost: selected.slotCost,
      source: 'SELECTED' as const,
    })),
  ];
  return {
    entries,
    usedSlotCount: entries.reduce((sum, entry) => sum + entry.slotCost, 0),
  };
}

function toggleSkillSelectionDraft(
  projection: Chr015Projection,
  draft: CharacterSkillSelectionDraft,
): CharacterSkillSelectionDraft {
  const skillId = draft.candidateSkillIdOrNull;
  if (skillId === null) throw new Error('CHR-015 requires an explicit skill candidate');
  const existing = draft.selectedSkills.find((selected) => selected.skillId === skillId);
  let selectedSkills: readonly SelectedSkillProjection[];
  if (existing !== undefined) {
    selectedSkills = draft.selectedSkills.filter((selected) => selected.skillId !== skillId);
  } else {
    const option = projection.skillOptions.find((candidate) => candidate.skillId === skillId);
    const level = option?.levelOptions.find(
      ({ targetBonus }) => targetBonus === draft.candidateTargetBonusOrNull,
    );
    if (option === undefined || level === undefined) {
      throw new Error('CHR-015 requires a host-signed skill and target bonus candidate');
    }
    const selected = { skillId, slotCost: level.slotCost, targetBonus: level.targetBonus };
    selectedSkills = projection.skillOptions.flatMap((candidate) => {
      if (candidate.skillId === skillId) return [selected];
      const retained = draft.selectedSkills.find((entry) => entry.skillId === candidate.skillId);
      return retained === undefined ? [] : [retained];
    });
  }
  const paidSlotUsage = paidSlotUsageForSkillSelection(projection, selectedSkills);
  return {
    candidateSkillIdOrNull: null,
    candidateTargetBonusOrNull: null,
    formId: 'CHR-015',
    paidSlotUsage,
    selectedSkillIds: selectedSkills.map(({ skillId: selectedSkillId }) => selectedSkillId),
    selectedSkills,
    selectionValidation: skillSelectionValidation(
      projection.requiredSlotCount,
      paidSlotUsage.usedSlotCount,
    ),
  };
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
  statAssignmentDraft: CharacterStatAssignmentDraft | null = null,
  skillSelectionDraft: CharacterSkillSelectionDraft | null = null,
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
  } else if (snapshot.formId === 'CHR-011' && commandPending) {
    availableActionKeys = [];
  } else if (
    snapshot.formId === 'CHR-009' &&
    (commandPending || statAssignmentDraft?.validation !== 'READY_TO_CHECKPOINT')
  ) {
    availableActionKeys = [];
  } else if (snapshot.formId === 'CHR-015') {
    const projection = snapshot.projection as Chr015Projection;
    const candidateSkillId = skillSelectionDraft?.candidateSkillIdOrNull;
    const selectedCandidate = skillSelectionDraft?.selectedSkills.some(
      ({ skillId }) => skillId === candidateSkillId,
    );
    const candidateOption = projection.skillOptions.find(
      ({ skillId }) => skillId === candidateSkillId,
    );
    const signedLevel = candidateOption?.levelOptions.some(
      ({ targetBonus }) => targetBonus === skillSelectionDraft?.candidateTargetBonusOrNull,
    );
    if (
      commandPending ||
      skillSelectionDraft === null ||
      projection.commandId !== null ||
      (!selectedCandidate && signedLevel !== true)
    ) {
      availableActionKeys = availableActionKeys.filter((key) => key !== CHR_015_TOGGLE_ACTION_KEY);
    }
    if (
      !commandPending &&
      projection.commandId === null &&
      skillSelectionDraft?.selectionValidation.kind === 'EXACT' &&
      snapshot.executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID)
    ) {
      availableActionKeys.push(CHR_015_CONFIRM_ACTION_KEY);
    }
  }
  const visible =
    availableActionKeys.length === snapshot.availableActionKeys.length &&
    availableActionKeys.every((key, index) => key === snapshot.availableActionKeys[index])
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
  if (pending.sourceFormId === 'CHR-013' && pending.actionKey === 'CHR-013::CTA::002') {
    const source = previous.projection as Chr013Projection;
    if (decoded.value.formId !== 'CHR-015' || decoded.value.layers.length !== 0) {
      return unrecognized('$.presentation.base.formId', decoded.value.formId);
    }
    const destination = decoded.value.projection as Chr015Projection;
    const expectedOptions = source.skillCardSummaries
      .filter(({ eligibility }) => eligibility === 'ELIGIBLE')
      .map(({ bonusDomainScope, levelOptions, missingSkillPenalty, skillId, skillLabel }) => ({
        bonusDomainScope,
        levelOptions,
        missingSkillPenalty,
        skillId,
        skillLabel,
      }));
    if (
      destination.characterDraftId !== source.characterDraftId ||
      destination.wizardCheckpointId !== source.wizardCheckpointId ||
      destination.draftRevision !== source.draftRevision ||
      destination.commandId !== null ||
      !sameJson(destination.eligibleSkillIds, source.eligibleSkillIds) ||
      !sameJson(destination.skillOptions, expectedOptions) ||
      !sameJson(
        destination.mandatoryClassSkillOrNull,
        source.slotSources.mandatoryClassSkillOrNull,
      ) ||
      !sameJson(destination.racialFreeSkills, source.slotSources.racialFreeSkills) ||
      destination.requiredSlotCount !== source.slotSources.requiredSlotCount ||
      destination.selectedSkills.length !== 0
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.skillOptions',
        destination.skillOptions,
      );
    }
  }
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
  pending: PendingCheckpoint,
): DecodeResult<CommandReceipt<CheckpointResult>> {
  const receipt = message.receipt;
  if (receipt.commandId !== pending.request.commandId) {
    return unrecognized('$.receipt.commandId', receipt.commandId);
  }
  if (receipt.receiptId.trim().length === 0) {
    return unrecognized('$.receipt.receiptId', receipt.receiptId);
  }
  const payload = pending.request.payload;
  if (payload.stage === 'IDENTITY') {
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
    return { ok: true, value: receipt as CommandReceipt<IdentityCheckpointResult> };
  }
  if (payload.stage === 'SKILLS') {
    if (
      pending.sourceSnapshot.formId !== 'CHR-015' ||
      pending.skillSelectionDraft === null ||
      pending.skillSelectionDraft.selectionValidation.kind !== 'EXACT'
    ) {
      return unrecognized('$.receipt.result.sourceFormId', receipt.result['sourceFormId']!);
    }
    const source = pending.sourceSnapshot.projection as Chr015Projection;
    const draft = pending.skillSelectionDraft;
    const expectedSelectedSkills = payload.selectedSkills.map(({ skillId, targetBonus }) => ({
      skillKey: skillId,
      targetBonus,
    }));
    const expectedLearnedSkills: DurableLearnedSkillResult[] = [
      ...source.racialFreeSkills.map(({ bonus, skillId, slotCost }) => ({
        bonus,
        skillKey: skillId,
        slotCost,
        source: 'RACE_GRANTED' as const,
      })),
      ...(source.mandatoryClassSkillOrNull === null
        ? []
        : [
            {
              bonus: source.mandatoryClassSkillOrNull.bonus,
              skillKey: source.mandatoryClassSkillOrNull.skillId,
              slotCost: source.mandatoryClassSkillOrNull.slotCost,
              source: 'CLASS_MANDATORY' as const,
            },
          ]),
      ...draft.selectedSkills.map(({ skillId, slotCost, targetBonus }) => ({
        bonus: targetBonus,
        skillKey: skillId,
        slotCost,
        source: 'SELECTED' as const,
      })),
    ];
    const result = decodeProjection(receipt.result, '$.receipt.result', {
      branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
      branchUuid: isNonEmptyString,
      characterDraftId: (field) => field === payload.characterDraftId,
      checkpointId: (field) => field === payload.wizardCheckpointId,
      checkpointOwnerId: (field) => field === payload.characterDraftId,
      checkpointRevision: (field) => isSafeIntegerAtLeast(field, 1),
      draftRevision: (field) => field === payload.draftRevision + 1,
      learnedSkills: (field) => sameJson(field, expectedLearnedSkills),
      nextFormId: (field) => field === 'CHR-017',
      requiredSlotCount: (field) => field === draft.selectionValidation.requiredSlotCount,
      selectedSkills: (field) => sameJson(field, expectedSelectedSkills),
      sourceFormId: (field) => field === 'CHR-015',
      stage: (field) => field === 'SKILLS',
      usedSlotCount: (field) => field === draft.selectionValidation.usedSlotCount,
    });
    if (!result.ok) return result;
    const ids = [
      payload.characterDraftId,
      payload.wizardCheckpointId,
      pending.request.commandId,
      receipt.receiptId,
      receipt.result['branchUuid'],
    ];
    if (new Set(ids).size !== ids.length) {
      return unrecognized('$.receipt.result.branchUuid', receipt.result['branchUuid']!);
    }
    const expected = pending.request.expectedRevisions;
    if (
      receipt.revisions.stateRevision !== expected.stateRevision + 1 ||
      receipt.revisions.projectionRevision !== expected.projectionRevision + 1 ||
      receipt.revisions.actorVisibilityRevision !== expected.actorVisibilityRevision
    ) {
      return unrecognized('$.receipt.revisions', { ...receipt.revisions });
    }
    return { ok: true, value: receipt as CommandReceipt<SkillSelectionCheckpointResult> };
  }
  const source = pending.sourceSnapshot.projection as Chr009Projection;
  const assignmentMode = source.assignmentMode;
  const baseStats = decodeStatMap(
    receipt.result['baseStats']!,
    '$.receipt.result.baseStats',
    (entry): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry),
  );
  if (!baseStats.ok) return baseStats;
  const rolledAssignments = receipt.result['rolledAssignmentsOrNull'];
  if (assignmentMode === 'ROLLED_BIJECTION') {
    const setEntryIndexByStat = payload['setEntryIndexByStat'];
    if (
      !Array.isArray(rolledAssignments) ||
      rolledAssignments.length !== STAT_CODES.length ||
      source.bijectionProofOrExactSum.kind !== 'ROLLED_BIJECTION' ||
      !isJsonObject(setEntryIndexByStat)
    ) {
      return unrecognized('$.receipt.result.rolledAssignmentsOrNull', rolledAssignments!);
    }
    const indexMap = decodeStatMap(
      setEntryIndexByStat,
      '$.request.payload.setEntryIndexByStat',
      (entry): entry is number => isSafeIntegerAtLeast(entry, 0) && entry <= 6,
    );
    if (!indexMap.ok) return indexMap;
    const entries = rolledAssignments as readonly JsonValue[];
    for (const [index, statCode] of STAT_CODES.entries()) {
      const entry = entries[index]!;
      const selectedIndex = indexMap.value[statCode];
      const sourceEntry = source.bijectionProofOrExactSum.sourceEntries[selectedIndex];
      if (
        !isJsonObject(entry) ||
        sourceEntry === undefined ||
        !sameJson(entry, { ...sourceEntry, statCode }) ||
        baseStats.value[statCode] !== sourceEntry.value
      ) {
        return unrecognized(`$.receipt.result.rolledAssignmentsOrNull[${String(index)}]`, entry);
      }
    }
  } else if (
    rolledAssignments !== null ||
    payload['pointBuyStats'] === undefined ||
    !sameJson(baseStats.value, payload['pointBuyStats'])
  ) {
    return unrecognized('$.receipt.result.rolledAssignmentsOrNull', rolledAssignments!);
  }
  const nextFormId = source.raceChoice === 'PURE' ? 'CHR-011' : 'CHR-012';
  const result = decodeProjection(receipt.result, '$.receipt.result', {
    assignmentMode: (field) => field === assignmentMode,
    baseStats: (field) => field === receipt.result['baseStats'],
    branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
    branchUuid: isNonEmptyString,
    characterDraftId: (field) => field === payload.characterDraftId,
    checkpointId: (field) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field) => field === payload.characterDraftId,
    checkpointRevision: (field) => isSafeIntegerAtLeast(field, 1),
    draftRevision: (field) => field === payload.draftRevision + 1,
    nextFormId: (field) => field === nextFormId,
    raceChoice: (field) => field === source.raceChoice,
    rolledAssignmentsOrNull: (field) => field === rolledAssignments,
    sourceFormId: (field) => field === 'CHR-009',
    sourceSetReceiptIdOrNull: (field) => field === source.sourceSetReceiptIdOrNull,
    stage: (field) => field === 'STAT_ASSIGNMENT',
  });
  if (!result.ok) return result;
  const ids = [
    payload.characterDraftId,
    payload.wizardCheckpointId,
    pending.request.commandId,
    receipt.receiptId,
    receipt.result['branchUuid'],
    source.sourceSetReceiptIdOrNull,
  ].filter((entry): entry is string => typeof entry === 'string');
  if (new Set(ids).size !== ids.length) {
    return unrecognized('$.receipt.result.branchUuid', receipt.result['branchUuid']!);
  }
  const expected = pending.request.expectedRevisions;
  if (
    receipt.revisions.stateRevision !== expected.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== expected.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !== expected.actorVisibilityRevision
  ) {
    return unrecognized('$.receipt.revisions', { ...receipt.revisions });
  }
  return { ok: true, value: receipt as CommandReceipt<StatAssignmentCheckpointResult> };
}

function sameCheckpointReceipt(
  left: CommandReceipt<CheckpointResult>,
  right: CommandReceipt<CheckpointResult>,
): boolean {
  return sameJson(left as unknown as JsonValue, right as unknown as JsonValue);
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
  if (payload.stage === 'STAT_ASSIGNMENT') {
    const option = (pending.sourceSnapshot.projection as Chr011Projection).classOptions.find(
      (candidate) => candidate.pureClass === payload.pureClass,
    );
    if (pending.sourceSnapshot.formId !== 'CHR-011' || option === undefined) {
      return unrecognized('$.receipt.result.sourceFormId', payload.sourceFormId);
    }
    const result = decodeProjection(receipt.result, '$.receipt.result', {
      branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
      branchUuid: isNonEmptyString,
      characterDraftId: (field) => field === payload.characterDraftId,
      checkpointId: (field) => field === payload.wizardCheckpointId,
      checkpointOwnerId: (field) => field === payload.characterDraftId,
      checkpointRevision: (field) => isSafeIntegerAtLeast(field, 1),
      classConsequences: (field) => sameJson(field, option.classConsequences),
      draftRevision: (field) => field === payload.draftRevision + 1,
      mandatoryClassSkill: (field) => sameJson(field, option.mandatoryClassSkill),
      nextFormId: (field) => field === 'CHR-012',
      pureClass: (field) => field === payload.pureClass,
      sourceFormId: (field) => field === 'CHR-011',
      stage: (field) => field === 'STAT_ASSIGNMENT',
    });
    if (!result.ok) return result;
    const ids = [
      payload.characterDraftId,
      payload.wizardCheckpointId,
      pending.request.commandId,
      receipt.receiptId,
      receipt.result['branchUuid'] as string,
    ];
    if (new Set(ids).size !== ids.length) {
      return unrecognized('$.receipt.receiptId', receipt.receiptId);
    }
    const expected = pending.request.expectedRevisions;
    if (
      receipt.revisions.stateRevision !== expected.stateRevision + 1 ||
      receipt.revisions.projectionRevision !== expected.projectionRevision + 1 ||
      receipt.revisions.actorVisibilityRevision !== expected.actorVisibilityRevision
    ) {
      return unrecognized('$.receipt.revisions', { ...receipt.revisions });
    }
    return { ok: true, value: receipt as CommandReceipt<SetDecisionResult> };
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
  receipt: CommandReceipt<CheckpointResult>,
  sourceSnapshot: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  const result = receipt.result;
  if (result.stage === 'SKILLS') {
    if (snapshot.formId !== 'CHR-015') {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
    const projection = snapshot.projection as Chr015Projection;
    if (sourceSnapshot.formId !== 'CHR-015') {
      return unrecognized('$.presentation.base.formId', sourceSnapshot.formId);
    }
    const source = sourceSnapshot.projection as Chr015Projection;
    const projectedSelection = projection.selectedSkills.map(({ skillId, targetBonus }) => ({
      skillKey: skillId,
      targetBonus,
    }));
    if (
      projection.commandId !== receipt.commandId ||
      projection.characterDraftId !== result.characterDraftId ||
      projection.wizardCheckpointId !== result.checkpointId ||
      projection.draftRevision !== result.draftRevision ||
      projection.requiredSlotCount !== result.requiredSlotCount ||
      projection.paidSlotUsage.usedSlotCount !== result.usedSlotCount ||
      projection.selectionValidation.kind !== 'EXACT' ||
      !sameJson(projectedSelection, result.selectedSkills) ||
      !sameJson(projection.eligibleSkillIds, source.eligibleSkillIds) ||
      !sameJson(projection.skillOptions, source.skillOptions) ||
      !sameJson(projection.mandatoryClassSkillOrNull, source.mandatoryClassSkillOrNull) ||
      !sameJson(projection.racialFreeSkillIds, source.racialFreeSkillIds) ||
      !sameJson(projection.racialFreeSkills, source.racialFreeSkills)
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.selectedSkills',
        projection.selectedSkills,
      );
    }
    if (
      snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
      snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision ||
      snapshot.revisions.stateRevision !== receipt.revisions.stateRevision
    ) {
      return unrecognized('$.revisions', { ...snapshot.revisions });
    }
    return { ok: true, value: snapshot };
  }
  let advance = 0;
  if (result.stage === 'IDENTITY') {
    if (snapshot.formId !== 'CHR-010') {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
  } else if (result.nextFormId === 'CHR-011') {
    if (snapshot.formId === 'CHR-012') {
      advance = 1;
    } else if (snapshot.formId !== 'CHR-011') {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
  } else if (snapshot.formId !== 'CHR-012') {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  const projection = snapshot.projection;
  for (const [key, expected] of [
    ['characterDraftId', result.characterDraftId],
    ['wizardCheckpointId', result.checkpointId],
    ['draftRevision', result.draftRevision + advance],
  ] as const) {
    if (projection[key] !== expected) {
      return unrecognized(`$.presentation.base.roleFilteredPayload.${key}`, projection[key]!);
    }
  }
  if (result.stage === 'STAT_ASSIGNMENT') {
    if (
      (snapshot.formId === 'CHR-011' && projection['raceChoice'] !== 'PURE') ||
      (snapshot.formId === 'CHR-012' &&
        (!sameJson(projection['baseStats']!, result.baseStats) ||
          (advance === 0 &&
            (projection['classModifiersOrNull'] !== null ||
              projection['mandatoryClassSkillOrNull'] !== null)) ||
          (advance === 1 &&
            (projection['classModifiersOrNull'] === null ||
              projection['mandatoryClassSkillOrNull'] === null))))
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.baseStats',
        projection['baseStats']!,
      );
    }
    if (
      snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
      snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision + advance ||
      snapshot.revisions.stateRevision !== receipt.revisions.stateRevision + advance
    ) {
      return unrecognized('$.revisions', { ...snapshot.revisions });
    }
  } else if (
    snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
    snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision ||
    snapshot.revisions.stateRevision !== receipt.revisions.stateRevision
  ) {
    return unrecognized('$.revisions', { ...snapshot.revisions });
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
      if (
        snapshot.formId !== 'CHR-009' ||
        snapshot.layers.length !== 0 ||
        projection['assignmentMode'] !== 'ROLLED_BIJECTION' ||
        projection['sourceSetReceiptIdOrNull'] !== result.acceptedSetReceiptId
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
    if (
      snapshot.formId !== 'CHR-009' ||
      snapshot.layers.length !== 0 ||
      projection['assignmentMode'] !== result.assignmentModeOrNull ||
      projection['sourceSetReceiptIdOrNull'] !== null
    ) {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
    return { ok: true, value: snapshot };
  }
  if (receipt.result.stage === 'STAT_ASSIGNMENT') {
    const projection = snapshot.projection;
    if (
      snapshot.formId !== 'CHR-012' ||
      snapshot.layers.length !== 0 ||
      projection['characterDraftId'] !== receipt.result.characterDraftId ||
      projection['wizardCheckpointId'] !== receipt.result.checkpointId ||
      projection['draftRevision'] !== receipt.result.draftRevision ||
      !sameJson(
        projection['classModifiersOrNull']!,
        receipt.result.classConsequences.statModifiers,
      ) ||
      !sameJson(projection['mandatoryClassSkillOrNull']!, receipt.result.mandatoryClassSkill)
    ) {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
    if (
      snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
      snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision ||
      snapshot.revisions.stateRevision !== receipt.revisions.stateRevision
    ) {
      return unrecognized('$.revisions', { ...snapshot.revisions });
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
  pending: PendingCheckpoint & {
    readonly receipt: CommandReceipt<CheckpointResult>;
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
    ? checkpointSnapshotMatchesReceipt(decoded.value, pending.receipt, pending.sourceSnapshot)
    : decoded;
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

function statAssignmentCheckpointPayload(
  snapshot: ConfirmedProjectionSnapshot,
  draft: CharacterStatAssignmentDraft | null,
): StatAssignmentCheckpointPayload {
  if (
    snapshot.formId !== 'CHR-009' ||
    draft === null ||
    draft.assignmentMode !== snapshot.projection['assignmentMode'] ||
    draft.validation !== 'READY_TO_CHECKPOINT'
  ) {
    throw new Error('CHR-009 requires a complete valid local assignment');
  }
  const values = draft.valuesByStat as StatMap<number>;
  const common = {
    characterDraftId: snapshot.projection['characterDraftId'] as string,
    draftRevision: snapshot.projection['draftRevision'] as number,
    sourceFormId: 'CHR-009',
    stage: 'STAT_ASSIGNMENT',
    wizardCheckpointId: snapshot.projection['wizardCheckpointId'] as string,
  } as const;
  return draft.assignmentMode === 'ROLLED_BIJECTION'
    ? { ...common, setEntryIndexByStat: values }
    : { ...common, pointBuyStats: values };
}

function skillSelectionCheckpointPayload(
  snapshot: ConfirmedProjectionSnapshot,
  draft: CharacterSkillSelectionDraft | null,
): SkillSelectionCheckpointPayload {
  if (
    snapshot.formId !== 'CHR-015' ||
    snapshot.projection['commandId'] !== null ||
    draft === null ||
    draft.selectionValidation.kind !== 'EXACT'
  ) {
    throw new Error('CHR-015 requires an exact valid local skill selection');
  }
  return {
    characterDraftId: snapshot.projection['characterDraftId'] as string,
    draftRevision: snapshot.projection['draftRevision'] as number,
    selectedSkills: draft.selectedSkills.map(({ skillId, targetBonus }) => ({
      skillId,
      targetBonus,
    })),
    sourceFormId: 'CHR-015',
    stage: 'SKILLS',
    wizardCheckpointId: snapshot.projection['wizardCheckpointId'] as string,
  };
}

function setDecisionPayload(
  snapshot: ConfirmedProjectionSnapshot,
  choice: CharacterCreationChoiceDraft,
): SetDecisionPayload {
  if (choice.formId !== snapshot.formId) {
    throw new Error(`character creation choice ${choice.formId} does not match ${snapshot.formId}`);
  }
  if (choice.formId === 'CHR-011') {
    return {
      characterDraftId: snapshot.projection['characterDraftId'] as string,
      draftRevision: snapshot.projection['draftRevision'] as number,
      pureClass: choice.value,
      sourceFormId: 'CHR-011',
      stage: 'STAT_ASSIGNMENT',
      wizardCheckpointId: snapshot.projection['wizardCheckpointId'] as string,
    };
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
  onStatAssignmentDraft: (value: CharacterStatAssignmentDraft | null) => void = () => {},
  onSkillSelectionDraft: (value: CharacterSkillSelectionDraft | null) => void = () => {},
): ProjectionConnection {
  let deviceId: string | null = null;
  let disposed = false;
  let identity: IdentityDraftClient | null = null;
  let terminal = false;
  let lastSnapshot: ConfirmedProjectionSnapshot | null = null;
  let pendingCheckpoint: PendingCheckpoint | null = null;
  let pendingSetDecision: PendingSetDecision | null = null;
  let pendingRollCommit: PendingRollCommit | null = null;
  let pendingFormAction: FormActionIntentV2Message | null = null;
  let playerContextId: string | null = null;
  let creationChoiceDraft: CharacterCreationChoiceDraft | null = null;
  let creationRollDraft: CharacterCreationRollDraft | null = null;
  let statAssignmentDraft: CharacterStatAssignmentDraft | null = null;
  let skillSelectionDraft: CharacterSkillSelectionDraft | null = null;
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
          statAssignmentDraft,
          skillSelectionDraft,
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
    if (pendingCheckpoint !== null) pendingCheckpoint = null;
    if (pendingSetDecision !== null) pendingSetDecision = null;
    if (pendingRollCommit !== null) pendingRollCommit = null;
    creationChoiceDraft = null;
    onCreationChoiceDraft(creationChoiceDraft);
    creationRollDraft = creationRollDraftFromSnapshot(next);
    onCreationRollDraft(creationRollDraft);
    statAssignmentDraft = creationStatAssignmentDraftFromSnapshot(next);
    onStatAssignmentDraft(statAssignmentDraft);
    skillSelectionDraft = creationSkillSelectionDraftFromSnapshot(next);
    onSkillSelectionDraft(skillSelectionDraft);
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
        statAssignmentDraft,
        skillSelectionDraft,
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
                'Host sent a second non-replay wizard checkpoint terminal.',
              );
              return;
            }
            const receipt = decodeCheckpointTerminal(message, pendingCheckpoint);
            if (!receipt.ok) {
              failProtocol(receipt.refusal, 'Host sent an invalid wizard checkpoint receipt.');
              return;
            }
            if (
              pendingCheckpoint.receipt !== null &&
              !sameCheckpointReceipt(pendingCheckpoint.receipt, receipt.value)
            ) {
              failUnexpected(
                '$.receipt.receiptId',
                receipt.value.receiptId,
                'Host replay changed the confirmed wizard checkpoint receipt.',
              );
              return;
            }
            pendingCheckpoint = { ...pendingCheckpoint, receipt: receipt.value };
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
                statAssignmentDraft,
                skillSelectionDraft,
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
                statAssignmentDraft,
                skillSelectionDraft,
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
              statAssignmentDraft,
              skillSelectionDraft,
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
            statAssignmentDraft,
            skillSelectionDraft,
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
                pendingCheckpoint.sourceSnapshot,
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
            pendingCheckpoint as PendingCheckpoint & {
              readonly receipt: CommandReceipt<CheckpointResult>;
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
            statAssignmentDraft,
            skillSelectionDraft,
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
          statAssignmentDraft,
          skillSelectionDraft,
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
          statAssignmentDraft,
          skillSelectionDraft,
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
            statAssignmentDraft,
            skillSelectionDraft,
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
    replaceStatAssignmentValue: (statCode, value) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-009' ||
        statAssignmentDraft === null ||
        !STAT_CODES.includes(statCode)
      ) {
        return { ok: false, detail: 'no active CHR-009 assignment scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'stat assignment is frozen while delivery is pending' };
      }
      if (value !== null && !Number.isFinite(value)) {
        return { ok: false, detail: 'stat assignment value must be finite' };
      }
      const valuesByStat = { ...statAssignmentDraft.valuesByStat, [statCode]: value };
      statAssignmentDraft = {
        ...statAssignmentDraft,
        validation: validateStatAssignmentDraft(statAssignmentDraft.assignmentMode, valuesByStat),
        valuesByStat,
      };
      onStatAssignmentDraft(statAssignmentDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshot(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
    },
    replaceSkillSelectionCandidate: (skillId, targetBonus) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-015' ||
        lastSnapshot.projection['commandId'] !== null ||
        skillSelectionDraft === null
      ) {
        return { ok: false, detail: 'no active CHR-015 skill selection scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'skill selection is frozen while delivery is pending' };
      }
      if (skillId === null) {
        if (targetBonus !== null) {
          return { ok: false, detail: 'a target bonus requires an explicit skill candidate' };
        }
      } else {
        const projection = lastSnapshot.projection as Chr015Projection;
        const option = projection.skillOptions.find((candidate) => candidate.skillId === skillId);
        if (option === undefined) {
          return { ok: false, detail: 'skill candidate is absent from signed skillOptions' };
        }
        const selected = skillSelectionDraft.selectedSkills.find(
          (candidate) => candidate.skillId === skillId,
        );
        if (
          targetBonus !== null &&
          selected?.targetBonus !== targetBonus &&
          !option.levelOptions.some((level) => level.targetBonus === targetBonus)
        ) {
          return { ok: false, detail: 'target bonus is absent from signed levelOptions' };
        }
      }
      skillSelectionDraft = {
        ...skillSelectionDraft,
        candidateSkillIdOrNull: skillId,
        candidateTargetBonusOrNull: targetBonus,
      };
      onSkillSelectionDraft(skillSelectionDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshot(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
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
        statAssignmentDraft,
        skillSelectionDraft,
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
      if (activeForm.formId === 'CHR-015' && actionKey === CHR_015_TOGGLE_ACTION_KEY) {
        if (skillSelectionDraft === null) {
          return { ok: false, detail: 'no active CHR-015 skill selection draft' };
        }
        try {
          skillSelectionDraft = toggleSkillSelectionDraft(
            lastSnapshot.projection as Chr015Projection,
            skillSelectionDraft,
          );
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        onSkillSelectionDraft(skillSelectionDraft);
        onState({
          kind: 'ready',
          snapshot: visibleSnapshot(
            lastSnapshot,
            identity,
            false,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      const selectedChoice = characterCreationSelectorChoice(lastSnapshot, actionKey);
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
            statAssignmentDraft,
            skillSelectionDraft,
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
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request,
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
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
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (activeForm.formId === 'CHR-009') {
        let payload: StatAssignmentCheckpointPayload;
        try {
          payload = statAssignmentCheckpointPayload(lastSnapshot, statAssignmentDraft);
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        } as const satisfies StatAssignmentCheckpointRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `stat assignment checkpoint failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingCheckpoint = {
          assignmentDraft: statAssignmentDraft,
          receipt: null,
          request,
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return {
            ok: false,
            detail: `stat assignment checkpoint could not be sent: ${diagnostic(error)}`,
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
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (activeForm.formId === 'CHR-015' && actionKey === CHR_015_CONFIRM_ACTION_KEY) {
        let payload: SkillSelectionCheckpointPayload;
        try {
          payload = skillSelectionCheckpointPayload(lastSnapshot, skillSelectionDraft);
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        } as const satisfies SkillSelectionCheckpointRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `skill selection checkpoint failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request,
          skillSelectionDraft,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return {
            ok: false,
            detail: `skill selection checkpoint could not be sent: ${diagnostic(error)}`,
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
            statAssignmentDraft,
            skillSelectionDraft,
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
            statAssignmentDraft,
            skillSelectionDraft,
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
            statAssignmentDraft,
            skillSelectionDraft,
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
            statAssignmentDraft,
            skillSelectionDraft,
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
