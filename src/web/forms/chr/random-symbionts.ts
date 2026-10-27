import type { ActionKey } from '@generated/types/atlas.js';
import type {
  CommandReceipt,
  DecodeResult,
  HostToClientMessage,
  JsonObject,
  JsonValue,
  WorkflowCommandRequestMessage,
  WorkflowCommandId,
} from '@shared/index.js';

import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';

export const CHR_017_RANDOM_START_ACTION_KEY = 'CHR-017::CTA::003' as const;
export const CHR_020_ROLL_COMMIT_ACTION_KEY = 'CHR-020::CTA::002' as const;
export const CHR_020_SIDE_DRAFT_ACTION_KEY = 'CHR-020::CTA::003' as const;
export const CHR_020_MONSTER_DRAFT_ACTION_KEY = 'CHR-020::CTA::004' as const;
export const CHR_041_CHECKPOINT_ACTION_KEY = 'CHR-041::CTA::001' as const;
export const CHR_041_SKILL_DRAFT_ACTION_KEY = 'CHR-041::CTA::002' as const;
export const CHR_041_INTELLIGENCE_FLOOR_ACTION_KEY = 'CHR-041::CTA::004' as const;

const ROLL_COMMIT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-CREATION-ROLL-COMMIT' as const;
const CHECKPOINT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-WIZARD-CHECKPOINT' as const;
const EMPTY_BRANCH_CACHE_HASH = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
const NO_ACTION_KEYS = [] as const satisfies readonly ActionKey[];
const STAT_CODES = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const SYMBIONT_SPECIES_KEYS = new Set([
  'WEAVER',
  'TAIPAN',
  'OWL',
  'TEACHER',
  'ARMADILLO',
  'DRAGON',
  'TROGR',
  'KEEPER',
  'ADVISER',
  'TICK',
  'CRICKET',
  'SPIDER',
  'CHAMELEON',
  'PENGUIN',
  'EEL',
  'TOAD',
  'RAT',
  'DOLPHIN',
  'MANTIS',
  'SKUNK',
  'CHIMERA',
  'PUPPETEER',
  'PLAGUE_DOCTOR',
]);
const MONSTER_SPECIES_KEYS = ['CHIMERA', 'PUPPETEER', 'PLAGUE_DOCTOR'] as const;
const RANDOM_STATUSES = new Set(['NOT_STARTED', 'PENDING', 'BINDING', 'COMMITTED']);
const INSTANCE_STATUSES = new Set(['ACTIVE', 'SUPPRESSED', 'ABSORBED', 'DESTROYED']);
const PHYSICAL_ROLL_KINDS = new Set([
  'SPECIES_ORIGIN',
  'CRITICAL_CONFIRMATION',
  'ADVISOR_I',
  'ADVISOR_W',
  'TROGR_SUPPRESSION_B',
]);
const INTERACTION_KINDS = new Set([
  'ABSORPTION',
  'CURRENT_OE_DUEL',
  'SPECIES_SUPPRESSION',
  'ABILITY_SUPPRESSION',
]);

export type StatCode = (typeof STAT_CODES)[number];
export type SymbiontSide = 'LEFT' | 'RIGHT';
export type SymbiontSpeciesKey =
  | 'WEAVER'
  | 'TAIPAN'
  | 'OWL'
  | 'TEACHER'
  | 'ARMADILLO'
  | 'DRAGON'
  | 'TROGR'
  | 'KEEPER'
  | 'ADVISER'
  | 'TICK'
  | 'CRICKET'
  | 'SPIDER'
  | 'CHAMELEON'
  | 'PENGUIN'
  | 'EEL'
  | 'TOAD'
  | 'RAT'
  | 'DOLPHIN'
  | 'MANTIS'
  | 'SKUNK'
  | 'CHIMERA'
  | 'PUPPETEER'
  | 'PLAGUE_DOCTOR';
export type SymbioticMonsterSpeciesKey = (typeof MONSTER_SPECIES_KEYS)[number];
export type RandomSymbiontStatus = 'NOT_STARTED' | 'PENDING' | 'BINDING' | 'COMMITTED';

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
export type SymbiontModifierEffectProjection =
  StatModifierEffectProjection | { readonly kind: 'INACTIVE' };

export interface SymbiontSpeciesProjection extends JsonObject {
  readonly bindingPolicy: string;
  readonly kind: 'ORDINARY' | 'SYMBIOTIC_MONSTER';
  readonly linkedStatCodes: readonly StatCode[];
  readonly slotCost: number;
  readonly speciesKey: SymbiontSpeciesKey;
  readonly speciesLabel: string;
  readonly statModifiers: StatModifierEffectProjection;
}
export interface Chr017Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly eligibleSymbiontSpecies: readonly SymbiontSpeciesProjection[];
  readonly manualCompositionDraft: readonly [];
  readonly pureNoSymbiontRoute: boolean;
  readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
  readonly selectedSpeciesOrNull: null;
  readonly slotCapacity: number;
  readonly symbiontAcquisitionModeOrNull: 'MANUAL' | 'RANDOM' | null;
  readonly wizardCheckpointId: string;
}

export interface SymbiontBindingProjection extends JsonObject {
  readonly acceptedIndex: number;
  readonly binding:
    | { readonly kind: 'NONE' | 'TICK_RIGHT_HAND' | 'SPIDER_BOTH_WRISTS' | 'MANTIS_BOTH_FOREARMS' }
    | { readonly kind: 'OWL_EYE' | 'EEL_ARM'; readonly side: SymbiontSide };
  readonly speciesKey: SymbiontSpeciesKey;
}
export interface RandomPhysicalRollProjection extends JsonObject {
  readonly advisorAcceptedIndex?: number;
  readonly kind:
    'SPECIES_ORIGIN' | 'CRITICAL_CONFIRMATION' | 'ADVISOR_I' | 'ADVISOR_W' | 'TROGR_SUPPRESSION_B';
  readonly mechanical: { readonly dieSides: 20; readonly rawFace: number };
  readonly originRollRequestId?: string;
  readonly rollReceiptId: string;
  readonly rollRequestId: string;
  readonly selectedMonsterSpeciesKeyOrNull?: SymbioticMonsterSpeciesKey | null;
}
export interface DuplicateSymbiontReceiptProjection extends JsonObject {
  readonly duplicateOfAcceptedIndex: number;
  readonly rollReceiptId: string;
  readonly rollRequestId: string;
  readonly speciesKey: SymbiontSpeciesKey;
}
export interface Chr020Projection extends JsonObject {
  readonly advisorBranch: boolean;
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly draftRevision: number;
  readonly drawnSpeciesAndBindings: readonly SymbiontBindingProjection[];
  readonly duplicateRerollReceipts: readonly DuplicateSymbiontReceiptProjection[];
  readonly pendingRollRequestIdOrNull: string | null;
  readonly raceChoice: 'FREE' | 'UNITED';
  readonly randomSequenceId: string;
  readonly randomStatus: RandomSymbiontStatus;
  readonly seedOrManualFaces: {
    readonly entries: readonly RandomPhysicalRollProjection[];
    readonly kind: 'D20_RESULTS';
  };
  readonly symbiontAcquisitionMode: 'RANDOM';
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
export interface AdvisorSkillOptionProjection extends JsonObject {
  readonly bonusDomainScope: string;
  readonly levelOptions: readonly SkillLevelOptionProjection[];
  readonly missingSkillPenalty: MissingSkillPenaltyProjection;
  readonly requirements: readonly SkillRequirementProjection[];
  readonly skillId: string;
  readonly skillLabel: string;
}
export interface SelectedSkillProjection extends JsonObject {
  readonly skillId: string;
  readonly slotCost: number;
  readonly targetBonus: number;
}
export type SkillSelectionValidation =
  | {
      readonly kind: 'UNDERFILLED';
      readonly missingSlotCount: number;
      readonly requiredSlotCount: number;
      readonly usedSlotCount: number;
    }
  | { readonly kind: 'EXACT'; readonly requiredSlotCount: number; readonly usedSlotCount: number }
  | {
      readonly excessSlotCount: number;
      readonly kind: 'OVERFILLED';
      readonly requiredSlotCount: number;
      readonly usedSlotCount: number;
    };
export interface AdvisorSkillSlotsProjection extends JsonObject {
  readonly requiredSlotCount: number;
  readonly selectedSkills: readonly SelectedSkillProjection[];
  readonly selectionValidation: SkillSelectionValidation;
  readonly skillOptions: readonly AdvisorSkillOptionProjection[];
}
export type AdvisorSlotsAndSkillsProjection =
  AdvisorSkillSlotsProjection | { readonly kind: 'IW_ROLLS_REQUIRED' };
export function isAdvisorSkillSlots(
  value: AdvisorSlotsAndSkillsProjection,
): value is AdvisorSkillSlotsProjection {
  return value.kind !== 'IW_ROLLS_REQUIRED';
}
interface Chr041ProjectionCommon extends JsonObject {
  readonly acknowledged: boolean;
  readonly advisorCard: {
    readonly advisorIPlus8: number | null;
    readonly advisorWPlus8: number | null;
    readonly effectsActive: boolean;
    readonly speciesKey: 'ADVISER';
  };
  readonly advisorIPlus8OrNull: number | null;
  readonly advisorInstanceDraftId: string;
  readonly advisorSlotsAndSkills: AdvisorSlotsAndSkillsProjection;
  readonly advisorWPlus8OrNull: number | null;
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly draftRevision: number;
  readonly iwRollReceiptIds: readonly [string | null, string | null];
  readonly iwRollRequestIds: readonly [string | null, string | null];
  readonly trogrSuppressionState:
    | { readonly kind: 'NOT_SUPPRESSED' }
    | {
        readonly kind: 'SUPPRESSED';
        readonly minimumIOrNull: number | null;
        readonly suppressionBOrNull: number | null;
        readonly rollPurpose: 'FUTURE_MINIMUM_INTELLIGENCE';
        readonly rollRequestIdOrNull: string | null;
        readonly rollReceiptIdOrNull: string | null;
      };
  readonly wizardCheckpointId: string;
}

export interface Chr041RandomProjection extends Chr041ProjectionCommon {
  readonly randomSequenceId: string;
}
export interface Chr041ManualProjection extends Chr041ProjectionCommon {
  readonly compositionDraftRevision: number;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
}
export type Chr041Projection = Chr041RandomProjection | Chr041ManualProjection;

export interface SymbiontInstanceProjection extends JsonObject {
  readonly absorbedSpeciesKeys: readonly SymbiontSpeciesKey[];
  readonly acceptedIndex: number;
  readonly currentOe: number;
  readonly slotCost: number;
  readonly speciesKey: SymbiontSpeciesKey;
  readonly speciesLabel: string;
  readonly status: 'ACTIVE' | 'SUPPRESSED' | 'ABSORBED' | 'DESTROYED';
}
export interface SymbiontInteractionProjection extends JsonObject {
  readonly kind: 'ABSORPTION' | 'CURRENT_OE_DUEL' | 'SPECIES_SUPPRESSION' | 'ABILITY_SUPPRESSION';
  readonly [key: string]: JsonValue;
}
export interface SymbiontModifierBreakdownProjection extends JsonObject {
  readonly bySpecies: readonly {
    readonly acceptedIndex: number;
    readonly effect: SymbiontModifierEffectProjection;
    readonly speciesKey: SymbiontSpeciesKey;
    readonly speciesLabel: string;
    readonly status: 'ACTIVE' | 'SUPPRESSED' | 'ABSORBED' | 'DESTROYED';
  }[];
  readonly total: StatModifierEffectProjection;
}
export interface Chr019Projection extends JsonObject {
  readonly bindings: readonly SymbiontBindingProjection[];
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly compositionValidation: 'VALID';
  readonly draftRevision: number;
  readonly duplicatePolicy: {
    readonly kind: 'REROLL_WITH_SEPARATE_RECEIPTS';
    readonly receipts: readonly DuplicateSymbiontReceiptProjection[];
  };
  readonly interactionGraph:
    | { readonly kind: 'NO_INTERACTIONS' }
    | { readonly entries: readonly SymbiontInteractionProjection[]; readonly kind: 'INTERACTIONS' };
  readonly irreversibleBoundaryStatus: 'CROSSED';
  readonly raceChoice: 'FREE' | 'UNITED';
  readonly randomReceiptIds: readonly string[];
  readonly slotUsageAndCapacity: { readonly capacity: number; readonly used: number };
  readonly speciesKeys: readonly SymbiontSpeciesKey[];
  readonly suppressionDestructionAbsorptionPreview:
    | { readonly kind: 'NONE' }
    | { readonly entries: readonly SymbiontInteractionProjection[]; readonly kind: 'CONSEQUENCES' };
  readonly symbiontInstancesDraft: readonly SymbiontInstanceProjection[];
  readonly symbiontModifierBreakdown: SymbiontModifierBreakdownProjection;
  readonly wizardCheckpointId: string;
}

export interface ManualChr019Projection extends JsonObject {
  readonly bindings: readonly SymbiontBindingProjection[];
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly compositionValidation: 'VALID';
  readonly draftRevision: number;
  readonly duplicatePolicy: { readonly kind: 'FORBIDDEN' };
  readonly interactionGraph: Chr019Projection['interactionGraph'];
  readonly irreversibleBoundaryStatus: 'NOT_CROSSED';
  readonly raceChoice: 'FREE' | 'UNITED';
  readonly randomReceiptIds: readonly string[];
  readonly slotUsageAndCapacity: Chr019Projection['slotUsageAndCapacity'];
  readonly speciesKeys: readonly SymbiontSpeciesKey[];
  readonly suppressionDestructionAbsorptionPreview: Chr019Projection['suppressionDestructionAbsorptionPreview'];
  readonly symbiontInstancesDraft: readonly SymbiontInstanceProjection[];
  readonly symbiontModifierBreakdown: SymbiontModifierBreakdownProjection;
  readonly wizardCheckpointId: string;
}

export interface RandomSymbiontDraft {
  readonly formId: 'CHR-020';
  readonly manualFaceOrNull: number | null;
  readonly selectedMonsterSpeciesKeyOrNull: SymbioticMonsterSpeciesKey | null;
  readonly sideBySpecies: Readonly<Record<'OWL' | 'EEL', SymbiontSide>>;
  readonly sideSpeciesKeyOrNull: 'OWL' | 'EEL' | null;
}
export interface AdvisorSkillSelectionDraft {
  readonly candidateSkillIdOrNull: string | null;
  readonly candidateTargetBonusOrNull: number | null;
  readonly formId: 'CHR-041';
  readonly selectedSkills: readonly SelectedSkillProjection[];
  readonly selectionValidation: SkillSelectionValidation;
}

interface SymbiontPayloadCommon extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly randomSequenceId: string;
  readonly stage: 'SYMBIONTS';
  readonly wizardCheckpointId: string;
}
export interface SymbiontPhysicalRollPayload extends SymbiontPayloadCommon {
  readonly manualFaceOrNull: number | null;
  readonly pendingRollRequestIdOrNull: string | null;
  readonly selectedMonsterSpeciesKeyOrNull: SymbioticMonsterSpeciesKey | null;
  readonly sourceFormId: 'CHR-020';
  readonly variant: 'ROLL';
}
export interface SymbiontBindingSelectionInput extends JsonObject {
  readonly side: SymbiontSide;
  readonly speciesKey: 'OWL' | 'EEL';
}
export interface SymbiontBindingPayload extends SymbiontPayloadCommon {
  readonly physicalRollReceiptIds: readonly string[];
  readonly selectedBindings: readonly SymbiontBindingSelectionInput[];
  readonly sourceFormId: 'CHR-020';
  readonly variant: 'BINDING';
}
export type SymbiontRollCommitPayload = SymbiontBindingPayload | SymbiontPhysicalRollPayload;
export type SymbiontRollCommitRequest = WorkflowCommandRequestMessage<
  typeof ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  SymbiontRollCommitPayload
>;
export interface SymbiontAdvisorCheckpointPayload extends SymbiontPayloadCommon {
  readonly advisorInstanceDraftId: string;
  readonly selectedSkills: readonly {
    readonly skillId: string;
    readonly targetBonus: number;
  }[];
  readonly sourceFormId: 'CHR-041';
}
export type SymbiontAdvisorCheckpointRequest = WorkflowCommandRequestMessage<
  typeof CHECKPOINT_WORKFLOW_COMMAND_ID,
  SymbiontAdvisorCheckpointPayload
>;

interface SymbiontReceiptResultCommon extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly randomSequenceId: string;
  readonly stage: 'SYMBIONTS';
}
export interface SymbiontPhysicalRollResult extends SymbiontReceiptResultCommon {
  readonly advisorBranch: boolean;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly nextFormId: 'CHR-020';
  readonly nextPendingRollRequestIdOrNull: string | null;
  readonly physicalRoll: RandomPhysicalRollProjection;
  readonly randomReceiptIdOrNull: string | null;
  readonly randomStatus: RandomSymbiontStatus;
  readonly sourceFormId: 'CHR-020';
  readonly variant: 'ROLL';
}
export interface SymbiontBindingResult extends SymbiontReceiptResultCommon {
  readonly advisorBranch: boolean;
  readonly bindings: readonly SymbiontBindingProjection[];
  readonly nextFormId: 'CHR-019' | 'CHR-041';
  readonly randomStatus: 'COMMITTED';
  readonly sourceFormId: 'CHR-020';
  readonly variant: 'BINDING';
}
export type SymbiontRollCommitResult = SymbiontBindingResult | SymbiontPhysicalRollResult;
export interface SymbiontAdvisorCheckpointResult extends SymbiontReceiptResultCommon {
  readonly advisorInstanceDraftId: string;
  readonly effectsActive: boolean;
  readonly learnedSkills: readonly {
    readonly bonus: number;
    readonly skillKey: string;
    readonly slotCost: number;
  }[];
  readonly nextFormId: 'CHR-019';
  readonly requiredSlotCount: number;
  readonly selectedSkills: readonly {
    readonly skillId: string;
    readonly targetBonus: number;
  }[];
  readonly sourceFormId: 'CHR-041';
  readonly usedSlotCount: number;
}

export interface AdvisorIntelligenceFloorRollPayload extends JsonObject {
  readonly advisorInstanceDraftId: string;
  readonly characterDraftId: string;
  readonly compositionDraftRevision: number;
  readonly draftRevision: number;
  readonly manualFaceOrNull: number | null;
  readonly pendingRollRequestId: string;
  readonly sourceFormId: 'CHR-041';
  readonly stage: 'SYMBIONTS';
  readonly variant: 'TROGR_SUPPRESSION_B';
  readonly wizardCheckpointId: string;
}
export type AdvisorIntelligenceFloorRollRequest = WorkflowCommandRequestMessage<
  typeof ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  AdvisorIntelligenceFloorRollPayload
>;
export interface AdvisorIntelligenceFloorPhysicalRoll extends JsonObject {
  readonly kind: 'TROGR_SUPPRESSION_B';
  readonly mechanical: { readonly dieSides: 20; readonly rawFace: number };
  readonly rollReceiptId: string;
  readonly rollRequestId: string;
}
export interface AdvisorIntelligenceFloorRollResult extends JsonObject {
  readonly advisorInstanceDraftId: string;
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly compositionDraftRevision: number;
  readonly draftRevision: number;
  readonly minimumI: number;
  readonly nextFormId: 'CHR-041';
  readonly physicalRoll: AdvisorIntelligenceFloorPhysicalRoll;
  readonly rollPurpose: 'FUTURE_MINIMUM_INTELLIGENCE';
  readonly sourceFormId: 'CHR-041';
  readonly stage: 'SYMBIONTS';
  readonly suppressionB: number;
  readonly teacherAbsorbed: boolean;
  readonly variant: 'TROGR_SUPPRESSION_B';
}

function refused<T>(path: string, value: JsonValue): DecodeResult<T> {
  return { ok: false, refusal: { code: 'UNRECOGNIZED', path, value } };
}
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isJsonArray(value: unknown): value is readonly JsonValue[] {
  return Array.isArray(value);
}
function exactObjectKeys(
  value: JsonObject,
  expected: ReadonlySet<string>,
  path: string,
): DecodeResult<null> {
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) return refused(`${path}.${key}`, value[key]!);
  }
  return { ok: true, value: null };
}
type FieldPredicate = (value: JsonValue | undefined) => boolean;
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
      return {
        ok: false,
        refusal: {
          actualType: 'undefined',
          code: 'INVALID_SHAPE',
          expected: 'required JSON value',
          path: `${path}.${key}`,
        },
      };
    }
    if (!valid(field)) return refused(`${path}.${key}`, field);
  }
  return { ok: true, value };
}
function decodeArray<T>(
  value: unknown,
  path: string,
  decode: (entry: JsonValue, entryPath: string) => DecodeResult<T>,
): DecodeResult<readonly T[]> {
  if (!Array.isArray(value)) return refused(path, value as JsonValue);
  const entries = value as readonly JsonValue[];
  const result: T[] = [];
  for (const [index, entry] of entries.entries()) {
    const decoded = decode(entry, `${path}[${String(index)}]`);
    if (!decoded.ok) return decoded;
    result.push(decoded.value);
  }
  return { ok: true, value: result };
}
function isNonEmptyString(value: JsonValue | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function isNullableString(value: JsonValue | undefined): value is string | null {
  return value === null || isNonEmptyString(value);
}
function isSafeIntegerAtLeast(value: JsonValue | undefined, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function isFace(value: JsonValue | undefined): value is number {
  return isSafeIntegerAtLeast(value, 1) && value <= 20;
}
function isStatCode(value: JsonValue | undefined): value is StatCode {
  return STAT_CODES.includes(value as StatCode);
}
function isSpeciesKey(value: JsonValue | undefined): value is SymbiontSpeciesKey {
  return SYMBIONT_SPECIES_KEYS.has(value as string);
}
function isMonsterKey(value: JsonValue | undefined): value is SymbioticMonsterSpeciesKey {
  return MONSTER_SPECIES_KEYS.includes(value as SymbioticMonsterSpeciesKey);
}
function isBoolean(value: JsonValue | undefined): value is boolean {
  return typeof value === 'boolean';
}
function sameJson(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    const leftEntries = left as readonly JsonValue[];
    const rightEntries = right as readonly JsonValue[];
    return (
      leftEntries.length === rightEntries.length &&
      leftEntries.every((entry, index) => sameJson(entry, rightEntries[index]))
    );
  }
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]))
  );
}
export function exactSymbiontActionKeys(
  actual: readonly ActionKey[],
  expected: readonly ActionKey[],
  path: string,
): DecodeResult<null> {
  if (actual.length === expected.length && actual.every((key, index) => key === expected[index])) {
    return { ok: true, value: null };
  }
  return refused(path, [...actual]);
}

function decodeStatModifierEffect(
  value: unknown,
  path: string,
): DecodeResult<StatModifierEffectProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const kind = value['kind'];
  if (kind === 'NO_STAT_MODIFIERS') {
    const result = decodeProjection(value, path, { kind: (field) => field === kind });
    return result.ok ? { ok: true, value: value as StatModifierEffectProjection } : result;
  }
  if (kind !== 'ADDITIVE_STAT_MODIFIERS') return refused(`${path}.kind`, kind!);
  const entries = decodeArray(value['entries'], `${path}.entries`, (entry, entryPath) => {
    if (!isJsonObject(entry)) return refused(entryPath, entry);
    const decoded = decodeProjection(entry, entryPath, {
      delta: (field) => typeof field === 'number' && Number.isSafeInteger(field),
      statCode: isStatCode,
      statLabel: isNonEmptyString,
    });
    return decoded.ok
      ? { ok: true, value: entry as unknown as LabeledStatModifierProjection }
      : decoded;
  });
  if (!entries.ok) return entries;
  const result = decodeProjection(value, path, {
    entries: (field) => field === value['entries'],
    kind: (field) => field === kind,
  });
  return result.ok
    ? { ok: true, value: { entries: entries.value, kind } as StatModifierEffectProjection }
    : result;
}

function decodeSymbiontModifierEffect(
  value: unknown,
  path: string,
): DecodeResult<SymbiontModifierEffectProjection> {
  if (isJsonObject(value) && value['kind'] === 'INACTIVE') {
    const result = decodeProjection(value, path, { kind: (field) => field === 'INACTIVE' });
    return result.ok ? { ok: true, value: { kind: 'INACTIVE' } } : result;
  }
  return decodeStatModifierEffect(value, path);
}

function decodeSymbiontBinding(
  value: unknown,
  path: string,
): DecodeResult<SymbiontBindingProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const acceptedIndex = value['acceptedIndex'];
  const speciesKey = value['speciesKey'];
  const binding = value['binding'];
  if (!isJsonObject(binding)) return refused(`${path}.binding`, binding!);
  const kind = binding['kind'];
  const side = binding['side'];
  const expectedBindingKeys =
    kind === 'OWL_EYE' || kind === 'EEL_ARM' ? new Set(['kind', 'side']) : new Set(['kind']);
  const keys = exactObjectKeys(binding, expectedBindingKeys, `${path}.binding`);
  if (!keys.ok) return keys;
  const validKind =
    kind === 'NONE' ||
    kind === 'OWL_EYE' ||
    kind === 'EEL_ARM' ||
    kind === 'TICK_RIGHT_HAND' ||
    kind === 'SPIDER_BOTH_WRISTS' ||
    kind === 'MANTIS_BOTH_FOREARMS';
  const expectedKind =
    speciesKey === 'OWL'
      ? 'OWL_EYE'
      : speciesKey === 'EEL'
        ? 'EEL_ARM'
        : speciesKey === 'TICK'
          ? 'TICK_RIGHT_HAND'
          : speciesKey === 'SPIDER'
            ? 'SPIDER_BOTH_WRISTS'
            : speciesKey === 'MANTIS'
              ? 'MANTIS_BOTH_FOREARMS'
              : 'NONE';
  if (
    !isSafeIntegerAtLeast(acceptedIndex, 0) ||
    !isSpeciesKey(speciesKey) ||
    !validKind ||
    kind !== expectedKind ||
    ((kind === 'OWL_EYE' || kind === 'EEL_ARM') && side !== 'LEFT' && side !== 'RIGHT')
  ) {
    return refused(path, value);
  }
  return { ok: true, value: value as SymbiontBindingProjection };
}

function decodePhysicalRoll(
  value: unknown,
  path: string,
): DecodeResult<RandomPhysicalRollProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const kind = value['kind'];
  if (!PHYSICAL_ROLL_KINDS.has(kind as string)) return refused(`${path}.kind`, kind!);
  const keys = new Set(['kind', 'rollRequestId', 'rollReceiptId', 'mechanical']);
  if (kind === 'CRITICAL_CONFIRMATION') {
    keys.add('originRollRequestId');
    keys.add('selectedMonsterSpeciesKeyOrNull');
  }
  if (kind === 'ADVISOR_I' || kind === 'ADVISOR_W' || kind === 'TROGR_SUPPRESSION_B') {
    keys.add('advisorAcceptedIndex');
  }
  const exact = exactObjectKeys(value, keys, path);
  if (!exact.ok) return exact;
  const mechanical = value['mechanical'];
  if (!isJsonObject(mechanical)) return refused(`${path}.mechanical`, mechanical!);
  const mechanicalKeys = exactObjectKeys(
    mechanical,
    new Set(['dieSides', 'rawFace']),
    `${path}.mechanical`,
  );
  if (!mechanicalKeys.ok) return mechanicalKeys;
  if (
    mechanical['dieSides'] !== 20 ||
    !isFace(mechanical['rawFace']) ||
    !isNonEmptyString(value['rollRequestId']) ||
    !isNonEmptyString(value['rollReceiptId']) ||
    (kind === 'CRITICAL_CONFIRMATION' &&
      (!isNonEmptyString(value['originRollRequestId']) ||
        (value['selectedMonsterSpeciesKeyOrNull'] !== null &&
          !isMonsterKey(value['selectedMonsterSpeciesKeyOrNull'])))) ||
    ((kind === 'ADVISOR_I' || kind === 'ADVISOR_W' || kind === 'TROGR_SUPPRESSION_B') &&
      !isSafeIntegerAtLeast(value['advisorAcceptedIndex'], 0))
  ) {
    return refused(path, value);
  }
  return { ok: true, value: value as RandomPhysicalRollProjection };
}

function decodeDuplicateReceipt(
  value: unknown,
  path: string,
): DecodeResult<DuplicateSymbiontReceiptProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const result = decodeProjection(value, path, {
    duplicateOfAcceptedIndex: (field) => isSafeIntegerAtLeast(field, 0),
    rollReceiptId: isNonEmptyString,
    rollRequestId: isNonEmptyString,
    speciesKey: isSpeciesKey,
  });
  return result.ok ? { ok: true, value: value as DuplicateSymbiontReceiptProjection } : result;
}

function decodeSymbiontSpecies(
  value: unknown,
  path: string,
): DecodeResult<SymbiontSpeciesProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const linkedStatCodes = decodeArray<StatCode>(
    value['linkedStatCodes'],
    `${path}.linkedStatCodes`,
    (entry, entryPath) =>
      isStatCode(entry) ? { ok: true, value: entry } : refused(entryPath, entry),
  );
  if (!linkedStatCodes.ok) return linkedStatCodes;
  const statModifiers = decodeStatModifierEffect(value['statModifiers'], `${path}.statModifiers`);
  if (!statModifiers.ok) return statModifiers;
  const result = decodeProjection(value, path, {
    bindingPolicy: (field) =>
      field === 'NONE' ||
      field === 'OWL_EYE' ||
      field === 'EEL_ARM' ||
      field === 'TICK_RIGHT_HAND' ||
      field === 'SPIDER_BOTH_WRISTS' ||
      field === 'MANTIS_BOTH_FOREARMS',
    kind: (field) => field === 'ORDINARY' || field === 'SYMBIOTIC_MONSTER',
    linkedStatCodes: (field) => field === value['linkedStatCodes'],
    slotCost: (field) => isSafeIntegerAtLeast(field, 0),
    speciesKey: isSpeciesKey,
    speciesLabel: isNonEmptyString,
    statModifiers: (field) => field === value['statModifiers'],
  });
  return result.ok
    ? {
        ok: true,
        value: {
          ...(value as SymbiontSpeciesProjection),
          linkedStatCodes: linkedStatCodes.value,
          statModifiers: statModifiers.value,
        },
      }
    : result;
}

export function decodeChr017Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr017Projection> {
  const eligibleSymbiontSpecies = decodeArray(
    value['eligibleSymbiontSpecies'],
    `${path}.eligibleSymbiontSpecies`,
    decodeSymbiontSpecies,
  );
  if (!eligibleSymbiontSpecies.ok) return eligibleSymbiontSpecies;
  const result = decodeProjection(value, path, {
    characterDraftId: isNonEmptyString,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    eligibleSymbiontSpecies: (field) => field === value['eligibleSymbiontSpecies'],
    manualCompositionDraft: (field) => Array.isArray(field) && field.length === 0,
    pureNoSymbiontRoute: (field) => field === (value['raceChoice'] === 'PURE'),
    raceChoice: (field) => field === 'FREE' || field === 'PURE' || field === 'UNITED',
    selectedSpeciesOrNull: (field) => field === null,
    slotCapacity: (field) => isSafeIntegerAtLeast(field, 0),
    symbiontAcquisitionModeOrNull: (field) =>
      value['raceChoice'] === 'PURE' ? field === null : field === 'MANUAL' || field === 'RANDOM',
    wizardCheckpointId: isNonEmptyString,
  });
  return result.ok
    ? {
        ok: true,
        value: {
          ...(value as Chr017Projection),
          eligibleSymbiontSpecies: eligibleSymbiontSpecies.value,
        },
      }
    : result;
}

export function expectedChr017ActionKeys(projection: Chr017Projection): readonly ActionKey[] {
  return projection.symbiontAcquisitionModeOrNull === 'RANDOM'
    ? [CHR_017_RANDOM_START_ACTION_KEY]
    : NO_ACTION_KEYS;
}

export function decodeChr020Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr020Projection> {
  const drawnSpeciesAndBindings = decodeArray(
    value['drawnSpeciesAndBindings'],
    `${path}.drawnSpeciesAndBindings`,
    decodeSymbiontBinding,
  );
  if (!drawnSpeciesAndBindings.ok) return drawnSpeciesAndBindings;
  const duplicateRerollReceipts = decodeArray(
    value['duplicateRerollReceipts'],
    `${path}.duplicateRerollReceipts`,
    decodeDuplicateReceipt,
  );
  if (!duplicateRerollReceipts.ok) return duplicateRerollReceipts;
  const seedOrManualFaces = value['seedOrManualFaces'];
  if (!isJsonObject(seedOrManualFaces))
    return refused(`${path}.seedOrManualFaces`, seedOrManualFaces!);
  const seedKeys = exactObjectKeys(
    seedOrManualFaces,
    new Set(['entries', 'kind']),
    `${path}.seedOrManualFaces`,
  );
  if (!seedKeys.ok) return seedKeys;
  if (seedOrManualFaces['kind'] !== 'D20_RESULTS') {
    return refused(`${path}.seedOrManualFaces.kind`, seedOrManualFaces['kind']!);
  }
  const entries = decodeArray(
    seedOrManualFaces['entries'],
    `${path}.seedOrManualFaces.entries`,
    decodePhysicalRoll,
  );
  if (!entries.ok) return entries;
  const result = decodeProjection(value, path, {
    advisorBranch: isBoolean,
    characterDraftId: isNonEmptyString,
    commandId: isNullableString,
    diceInputModeSnapshot: (field) => field === 'AUTO' || field === 'MANUAL',
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    drawnSpeciesAndBindings: (field) => field === value['drawnSpeciesAndBindings'],
    duplicateRerollReceipts: (field) => field === value['duplicateRerollReceipts'],
    pendingRollRequestIdOrNull: isNullableString,
    raceChoice: (field) => field === 'FREE' || field === 'UNITED',
    randomSequenceId: isNonEmptyString,
    randomStatus: (field) => RANDOM_STATUSES.has(field as string),
    seedOrManualFaces: (field) => field === seedOrManualFaces,
    symbiontAcquisitionMode: (field) => field === 'RANDOM',
    wizardCheckpointId: isNonEmptyString,
  });
  if (!result.ok) return result;
  const status = value['randomStatus'];
  const pending = value['pendingRollRequestIdOrNull'];
  if (
    (status === 'NOT_STARTED' && (pending !== null || entries.value.length !== 0)) ||
    (status === 'PENDING' && pending === null) ||
    (status === 'BINDING' && pending !== null) ||
    (status === 'COMMITTED' && pending !== null)
  ) {
    return refused(`${path}.randomStatus`, status);
  }
  return {
    ok: true,
    value: {
      ...(value as Chr020Projection),
      drawnSpeciesAndBindings: drawnSpeciesAndBindings.value,
      duplicateRerollReceipts: duplicateRerollReceipts.value,
      seedOrManualFaces: { entries: entries.value, kind: 'D20_RESULTS' },
    },
  };
}

export function expectedChr020ActionKeys(
  projection: Chr020Projection,
  executableWorkflowCommandIds: readonly WorkflowCommandId[],
  availableActionKeys: readonly ActionKey[],
): readonly ActionKey[] {
  const status = projection.randomStatus;
  const sideAvailable =
    status !== 'COMMITTED' &&
    projection.drawnSpeciesAndBindings.some(
      (entry) => entry.speciesKey === 'OWL' || entry.speciesKey === 'EEL',
    );
  const monsterAvailable =
    projection.raceChoice === 'UNITED' &&
    status === 'PENDING' &&
    availableActionKeys.includes(CHR_020_MONSTER_DRAFT_ACTION_KEY);
  return [
    ...(executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID) &&
    status !== 'COMMITTED'
      ? [CHR_020_ROLL_COMMIT_ACTION_KEY]
      : []),
    ...(sideAvailable ? [CHR_020_SIDE_DRAFT_ACTION_KEY] : []),
    ...(monsterAvailable ? [CHR_020_MONSTER_DRAFT_ACTION_KEY] : []),
  ];
}

function decodeMissingSkillPenalty(
  value: unknown,
  path: string,
): DecodeResult<MissingSkillPenaltyProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const kind = value['kind'];
  if (kind === 'NO_MISSING_SKILL_PENALTY') {
    const result = decodeProjection(value, path, { kind: (field) => field === kind });
    return result.ok ? { ok: true, value: { kind } } : result;
  }
  if (kind !== 'MISSING_SKILL_PENALTY') return refused(`${path}.kind`, kind!);
  const result = decodeProjection(value, path, {
    kind: (field) => field === kind,
    value: (field) => typeof field === 'number' && Number.isSafeInteger(field),
  });
  return result.ok ? { ok: true, value: { kind, value: value['value'] as number } } : result;
}

function decodeAdvisorSkillOption(
  value: unknown,
  path: string,
): DecodeResult<AdvisorSkillOptionProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const levelOptions = decodeArray<SkillLevelOptionProjection>(
    value['levelOptions'],
    `${path}.levelOptions`,
    (entry, entryPath) => {
      if (!isJsonObject(entry)) return refused(entryPath, entry);
      const result = decodeProjection(entry, entryPath, {
        slotCost: (field) => isSafeIntegerAtLeast(field, 1),
        targetBonus: (field) => isSafeIntegerAtLeast(field, 1),
      });
      return result.ok ? { ok: true, value: entry as SkillLevelOptionProjection } : result;
    },
  );
  if (!levelOptions.ok) return levelOptions;
  const requirements = decodeArray<SkillRequirementProjection>(
    value['requirements'],
    `${path}.requirements`,
    (entry, entryPath) => {
      if (!isJsonObject(entry)) return refused(entryPath, entry);
      const result = decodeProjection(entry, entryPath, {
        currentValue: (field) => typeof field === 'number' && Number.isSafeInteger(field),
        minValue: (field) => typeof field === 'number' && Number.isSafeInteger(field),
        satisfied: (field) =>
          field === (entry['currentValue'] as number) >= (entry['minValue'] as number),
        statCode: isStatCode,
        statLabel: isNonEmptyString,
      });
      return result.ok ? { ok: true, value: entry as SkillRequirementProjection } : result;
    },
  );
  if (!requirements.ok) return requirements;
  const missingSkillPenalty = decodeMissingSkillPenalty(
    value['missingSkillPenalty'],
    `${path}.missingSkillPenalty`,
  );
  if (!missingSkillPenalty.ok) return missingSkillPenalty;
  const result = decodeProjection(value, path, {
    bonusDomainScope: isNonEmptyString,
    levelOptions: (field) => field === value['levelOptions'],
    missingSkillPenalty: (field) => field === value['missingSkillPenalty'],
    requirements: (field) => field === value['requirements'],
    skillId: isNonEmptyString,
    skillLabel: isNonEmptyString,
  });
  return result.ok
    ? {
        ok: true,
        value: {
          ...(value as AdvisorSkillOptionProjection),
          levelOptions: levelOptions.value,
          missingSkillPenalty: missingSkillPenalty.value,
          requirements: requirements.value,
        },
      }
    : result;
}

function decodeSelectedSkill(value: unknown, path: string): DecodeResult<SelectedSkillProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const result = decodeProjection(value, path, {
    skillId: isNonEmptyString,
    slotCost: (field) => isSafeIntegerAtLeast(field, 1),
    targetBonus: (field) => isSafeIntegerAtLeast(field, 1),
  });
  return result.ok ? { ok: true, value: value as SelectedSkillProjection } : result;
}

export function skillSelectionValidation(
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

function decodeSelectionValidation(
  value: unknown,
  path: string,
): DecodeResult<SkillSelectionValidation> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const kind = value['kind'];
  const requiredSlotCount = value['requiredSlotCount'];
  const usedSlotCount = value['usedSlotCount'];
  if (!isSafeIntegerAtLeast(requiredSlotCount, 0) || !isSafeIntegerAtLeast(usedSlotCount, 0)) {
    return refused(path, value);
  }
  const expected = skillSelectionValidation(requiredSlotCount, usedSlotCount);
  const fields: Record<string, FieldPredicate> = {
    kind: (field) => field === expected.kind,
    requiredSlotCount: (field) => field === requiredSlotCount,
    usedSlotCount: (field) => field === usedSlotCount,
  };
  if (expected.kind === 'UNDERFILLED') {
    fields['missingSlotCount'] = (field) => field === expected.missingSlotCount;
  }
  if (expected.kind === 'OVERFILLED') {
    fields['excessSlotCount'] = (field) => field === expected.excessSlotCount;
  }
  const result = decodeProjection(value, path, fields);
  if (!result.ok) return result;
  if (kind !== expected.kind) return refused(`${path}.kind`, kind!);
  return { ok: true, value: expected };
}

export function decodeChr041Projection(
  value: JsonObject,
  path: string,
): DecodeResult<Chr041Projection> {
  const hasRandomIdentity = Object.hasOwn(value, 'randomSequenceId');
  const hasManualRevision = Object.hasOwn(value, 'compositionDraftRevision');
  const hasManualDiceMode = Object.hasOwn(value, 'diceInputModeSnapshot');
  if (hasRandomIdentity && hasManualDiceMode) {
    return refused(`${path}.randomSequenceId`, value['randomSequenceId']!);
  }
  if (hasRandomIdentity && hasManualRevision) {
    return refused(`${path}.compositionDraftRevision`, value['compositionDraftRevision']!);
  }
  const manualComposition = hasManualRevision || hasManualDiceMode;
  const advisorCard = value['advisorCard'];
  if (!isJsonObject(advisorCard)) return refused(`${path}.advisorCard`, advisorCard!);
  const cardResult = decodeProjection(advisorCard, `${path}.advisorCard`, {
    advisorIPlus8: (field) => field === null || isFace((field as number) - 8),
    advisorWPlus8: (field) => field === null || isFace((field as number) - 8),
    effectsActive: isBoolean,
    speciesKey: (field) => field === 'ADVISER',
  });
  if (!cardResult.ok) return cardResult;
  const slots = value['advisorSlotsAndSkills'];
  if (!isJsonObject(slots)) return refused(`${path}.advisorSlotsAndSkills`, slots!);
  let decodedSlots: AdvisorSlotsAndSkillsProjection;
  const iwPending = slots['kind'] === 'IW_ROLLS_REQUIRED';
  if (iwPending) {
    const pendingResult = decodeProjection(slots, `${path}.advisorSlotsAndSkills`, {
      kind: (field) => field === 'IW_ROLLS_REQUIRED',
    });
    if (!pendingResult.ok) return pendingResult;
    if (!manualComposition) return refused(`${path}.advisorSlotsAndSkills.kind`, slots['kind']!);
    decodedSlots = { kind: 'IW_ROLLS_REQUIRED' };
  } else {
    const slotKeys = exactObjectKeys(
      slots,
      new Set(['requiredSlotCount', 'selectedSkills', 'selectionValidation', 'skillOptions']),
      `${path}.advisorSlotsAndSkills`,
    );
    if (!slotKeys.ok) return slotKeys;
    const skillOptions = decodeArray(
      slots['skillOptions'],
      `${path}.advisorSlotsAndSkills.skillOptions`,
      decodeAdvisorSkillOption,
    );
    if (!skillOptions.ok) return skillOptions;
    const selectedSkills = decodeArray(
      slots['selectedSkills'],
      `${path}.advisorSlotsAndSkills.selectedSkills`,
      decodeSelectedSkill,
    );
    if (!selectedSkills.ok) return selectedSkills;
    const selectionValidation = decodeSelectionValidation(
      slots['selectionValidation'],
      `${path}.advisorSlotsAndSkills.selectionValidation`,
    );
    if (!selectionValidation.ok) return selectionValidation;
    const requiredSlotCount = slots['requiredSlotCount'];
    if (!isSafeIntegerAtLeast(requiredSlotCount, 0)) {
      return refused(`${path}.advisorSlotsAndSkills.requiredSlotCount`, requiredSlotCount!);
    }
    const usedSlotCount = selectedSkills.value.reduce(
      (sum, selected) => sum + selected.slotCost,
      0,
    );
    const expectedValidation = skillSelectionValidation(requiredSlotCount, usedSlotCount);
    if (!sameJson(selectionValidation.value, expectedValidation)) {
      return refused(
        `${path}.advisorSlotsAndSkills.selectionValidation`,
        selectionValidation.value,
      );
    }
    decodedSlots = {
      requiredSlotCount,
      selectedSkills: selectedSkills.value,
      selectionValidation: selectionValidation.value,
      skillOptions: skillOptions.value,
    };
  }
  const suppression = value['trogrSuppressionState'];
  if (!isJsonObject(suppression)) return refused(`${path}.trogrSuppressionState`, suppression!);
  const suppressionKind = suppression['kind'];
  const suppressionResult =
    suppressionKind === 'NOT_SUPPRESSED'
      ? decodeProjection(suppression, `${path}.trogrSuppressionState`, {
          kind: (field) => field === suppressionKind,
        })
      : suppressionKind === 'SUPPRESSED'
        ? decodeProjection(suppression, `${path}.trogrSuppressionState`, {
            kind: (field) => field === suppressionKind,
            minimumIOrNull: (field) => field === null || isSafeIntegerAtLeast(field, 1),
            suppressionBOrNull: (field) => field === null || isSafeIntegerAtLeast(field, 0),
            rollPurpose: (field) => field === 'FUTURE_MINIMUM_INTELLIGENCE',
            rollRequestIdOrNull: isNullableString,
            rollReceiptIdOrNull: isNullableString,
          })
        : refused(`${path}.trogrSuppressionState.kind`, suppressionKind!);
  if (!suppressionResult.ok) return suppressionResult;
  if (manualComposition && suppressionKind === 'SUPPRESSED') {
    const requestId = suppression['rollRequestIdOrNull'];
    const receiptId = suppression['rollReceiptIdOrNull'];
    const suppressionB = suppression['suppressionBOrNull'];
    const minimumI = suppression['minimumIOrNull'];
    if (iwPending) {
      if (requestId !== null || receiptId !== null || suppressionB !== null || minimumI !== null) {
        return refused(`${path}.trogrSuppressionState`, suppression);
      }
    } else {
      if (!isNonEmptyString(requestId)) {
        return refused(`${path}.trogrSuppressionState.rollRequestIdOrNull`, requestId ?? null);
      }
      if (receiptId === null) {
        if (suppressionB !== null) {
          return refused(`${path}.trogrSuppressionState.suppressionBOrNull`, suppressionB ?? null);
        }
        if (minimumI !== null) {
          return refused(`${path}.trogrSuppressionState.minimumIOrNull`, minimumI ?? null);
        }
      } else {
        if (!isNonEmptyString(receiptId)) {
          return refused(`${path}.trogrSuppressionState.rollReceiptIdOrNull`, receiptId ?? null);
        }
        if (!isSafeIntegerAtLeast(suppressionB, 0)) {
          return refused(`${path}.trogrSuppressionState.suppressionBOrNull`, suppressionB ?? null);
        }
        if (!isSafeIntegerAtLeast(minimumI, 1)) {
          return refused(`${path}.trogrSuppressionState.minimumIOrNull`, minimumI ?? null);
        }
      }
    }
  }
  const result = decodeProjection(value, path, {
    acknowledged: isBoolean,
    advisorCard: (field) => field === advisorCard,
    advisorIPlus8OrNull: (field) => field === advisorCard['advisorIPlus8'],
    advisorInstanceDraftId: isNonEmptyString,
    advisorSlotsAndSkills: (field) => field === slots,
    advisorWPlus8OrNull: (field) => field === advisorCard['advisorWPlus8'],
    characterDraftId: isNonEmptyString,
    commandId: isNullableString,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    iwRollReceiptIds: (field) =>
      Array.isArray(field) && field.length === 2 && field.every(isNullableString),
    iwRollRequestIds: (field) =>
      Array.isArray(field) && field.length === 2 && field.every(isNullableString),
    ...(manualComposition
      ? {
          compositionDraftRevision: (field: JsonValue | undefined) =>
            isSafeIntegerAtLeast(field, 0),
          diceInputModeSnapshot: (field: JsonValue | undefined) =>
            field === 'AUTO' || field === 'MANUAL',
        }
      : { randomSequenceId: isNonEmptyString }),
    trogrSuppressionState: (field) => field === suppression,
    wizardCheckpointId: isNonEmptyString,
  });
  if (!result.ok) return result;
  if (manualComposition) {
    const requestIds = value['iwRollRequestIds'];
    const receiptIds = value['iwRollReceiptIds'];
    if (
      !isJsonArray(requestIds) ||
      !isJsonArray(receiptIds) ||
      requestIds.some((id) => !isNonEmptyString(id)) ||
      new Set(requestIds).size !== 2 ||
      receiptIds.some((id) => id !== null && !isNonEmptyString(id))
    ) {
      return refused(`${path}.iwRollRequestIds`, requestIds ?? null);
    }
    if (iwPending) {
      if (
        value['acknowledged'] !== false ||
        receiptIds.some((id) => id !== null) ||
        value['advisorIPlus8OrNull'] !== null ||
        value['advisorWPlus8OrNull'] !== null
      ) {
        return refused(`${path}.advisorSlotsAndSkills.kind`, slots['kind']!);
      }
    } else {
      if (
        receiptIds.some((id) => !isNonEmptyString(id)) ||
        new Set([...requestIds, ...receiptIds]).size !== 4 ||
        value['advisorIPlus8OrNull'] === null ||
        value['advisorWPlus8OrNull'] === null
      ) {
        return refused(`${path}.iwRollReceiptIds`, receiptIds);
      }
    }
  } else if (value['advisorIPlus8OrNull'] === null || value['advisorWPlus8OrNull'] === null) {
    return refused(path, value);
  }
  return {
    ok: true,
    value: {
      ...(value as Chr041Projection),
      advisorSlotsAndSkills: decodedSlots,
      trogrSuppressionState: suppression as Chr041Projection['trogrSuppressionState'],
    },
  };
}

export function expectedChr041ActionKeys(
  projection: Chr041Projection,
  executableWorkflowCommandIds: readonly WorkflowCommandId[],
): readonly ActionKey[] {
  if (projection.advisorSlotsAndSkills.kind === 'IW_ROLLS_REQUIRED') {
    return executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID)
      ? ['CHR-041::CTA::003']
      : NO_ACTION_KEYS;
  }
  if (
    'compositionDraftRevision' in projection &&
    projection.trogrSuppressionState.kind === 'SUPPRESSED' &&
    projection.trogrSuppressionState.rollReceiptIdOrNull === null
  ) {
    const rollActions = executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID)
      ? [CHR_041_INTELLIGENCE_FLOOR_ACTION_KEY]
      : NO_ACTION_KEYS;
    return projection.commandId === null
      ? rollActions
      : [...rollActions, CHR_041_SKILL_DRAFT_ACTION_KEY];
  }
  return projection.acknowledged
    ? NO_ACTION_KEYS
    : [
        ...(executableWorkflowCommandIds.includes(CHECKPOINT_WORKFLOW_COMMAND_ID)
          ? [CHR_041_CHECKPOINT_ACTION_KEY]
          : []),
        CHR_041_SKILL_DRAFT_ACTION_KEY,
      ];
}

function decodeInteraction(
  value: unknown,
  path: string,
): DecodeResult<SymbiontInteractionProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const kind = value['kind'];
  if (!INTERACTION_KINDS.has(kind as string)) return refused(`${path}.kind`, kind!);
  const fields: Record<string, FieldPredicate> = { kind: (field) => field === kind };
  if (kind === 'ABSORPTION') {
    Object.assign(fields, {
      absorbedAcceptedIndex: (field: JsonValue) => isSafeIntegerAtLeast(field, 0),
      absorbedSpeciesKey: (field: JsonValue) => field === 'TEACHER' || field === 'DOLPHIN',
      absorberAcceptedIndex: (field: JsonValue) => isSafeIntegerAtLeast(field, 0),
    });
  } else if (kind === 'CURRENT_OE_DUEL') {
    Object.assign(fields, {
      keeperAcceptedIndex: (field: JsonValue) => isSafeIntegerAtLeast(field, 0),
      keeperCurrentOeBefore: (field: JsonValue) => isSafeIntegerAtLeast(field, 0),
      outcome: (field: JsonValue) =>
        field === 'TROGR_DESTROYED' || field === 'KEEPER_DESTROYED' || field === 'TIE',
      trogrAcceptedIndex: (field: JsonValue) => isSafeIntegerAtLeast(field, 0),
      trogrCurrentOeBefore: (field: JsonValue) => isSafeIntegerAtLeast(field, 0),
      winnerCurrentOeAfterOrNull: (field: JsonValue) =>
        field === null || isSafeIntegerAtLeast(field, 0),
    });
  } else if (kind === 'SPECIES_SUPPRESSION') {
    Object.assign(fields, {
      suppressedAcceptedIndex: (field: JsonValue) => isSafeIntegerAtLeast(field, 0),
      suppressedSpeciesKey: (field: JsonValue) =>
        field === 'ADVISER' || field === 'PENGUIN' || field === 'TAIPAN',
      suppressorAcceptedIndex: (field: JsonValue) => isSafeIntegerAtLeast(field, 0),
      suppressorSpeciesKey: (field: JsonValue) => field === 'TROGR' || field === 'TOAD',
    });
  } else {
    Object.assign(fields, {
      ability: (field: JsonValue) => field === 'DOUBLE_FOCUS',
      suppressorAcceptedIndex: (field: JsonValue) => isSafeIntegerAtLeast(field, 0),
      targetAcceptedIndex: (field: JsonValue) => isSafeIntegerAtLeast(field, 0),
    });
  }
  const result = decodeProjection(value, path, fields);
  return result.ok ? { ok: true, value: value as SymbiontInteractionProjection } : result;
}

function decodeInteractionContainer(
  value: unknown,
  path: string,
  populatedKind: 'INTERACTIONS' | 'CONSEQUENCES',
  emptyKind: 'NO_INTERACTIONS' | 'NONE',
): DecodeResult<
  | { readonly kind: 'NO_INTERACTIONS' | 'NONE' }
  | {
      readonly entries: readonly SymbiontInteractionProjection[];
      readonly kind: 'INTERACTIONS' | 'CONSEQUENCES';
    }
> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const kind = value['kind'];
  if (kind === emptyKind) {
    const result = decodeProjection(value, path, { kind: (field) => field === emptyKind });
    return result.ok ? { ok: true, value: { kind: emptyKind } } : result;
  }
  if (kind !== populatedKind) return refused(`${path}.kind`, kind!);
  const entries = decodeArray(value['entries'], `${path}.entries`, decodeInteraction);
  if (!entries.ok) return entries;
  const result = decodeProjection(value, path, {
    entries: (field) => field === value['entries'],
    kind: (field) => field === populatedKind,
  });
  return result.ok ? { ok: true, value: { entries: entries.value, kind: populatedKind } } : result;
}

function decodeModifierBreakdown(
  value: unknown,
  path: string,
): DecodeResult<SymbiontModifierBreakdownProjection> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const bySpecies = decodeArray<SymbiontModifierBreakdownProjection['bySpecies'][number]>(
    value['bySpecies'],
    `${path}.bySpecies`,
    (entry, entryPath) => {
      if (!isJsonObject(entry)) return refused(entryPath, entry);
      const effect = decodeSymbiontModifierEffect(entry['effect'], `${entryPath}.effect`);
      if (!effect.ok) return effect;
      const result = decodeProjection(entry, entryPath, {
        acceptedIndex: (field) => isSafeIntegerAtLeast(field, 0),
        effect: (field) => field === entry['effect'],
        speciesKey: isSpeciesKey,
        speciesLabel: isNonEmptyString,
        status: (field) => INSTANCE_STATUSES.has(field as string),
      });
      return result.ok
        ? {
            ok: true,
            value: {
              acceptedIndex: entry['acceptedIndex'] as number,
              effect: effect.value,
              speciesKey: entry['speciesKey'] as SymbiontSpeciesKey,
              speciesLabel: entry['speciesLabel'] as string,
              status: entry['status'] as 'ACTIVE' | 'SUPPRESSED' | 'ABSORBED' | 'DESTROYED',
            },
          }
        : result;
    },
  );
  if (!bySpecies.ok) return bySpecies;
  const total = decodeStatModifierEffect(value['total'], `${path}.total`);
  if (!total.ok) return total;
  const result = decodeProjection(value, path, {
    bySpecies: (field) => field === value['bySpecies'],
    total: (field) => field === value['total'],
  });
  return result.ok
    ? { ok: true, value: { bySpecies: bySpecies.value, total: total.value } }
    : result;
}

export function decodeChr019Projection(
  value: JsonObject,
  path: string,
  mode: 'MANUAL' | 'RANDOM' = 'RANDOM',
): DecodeResult<Chr019Projection | ManualChr019Projection> {
  const bindings = decodeArray(value['bindings'], `${path}.bindings`, decodeSymbiontBinding);
  if (!bindings.ok) return bindings;
  const symbiontInstancesDraft = decodeArray<SymbiontInstanceProjection>(
    value['symbiontInstancesDraft'],
    `${path}.symbiontInstancesDraft`,
    (entry, entryPath) => {
      if (!isJsonObject(entry)) return refused(entryPath, entry);
      const absorbedSpeciesKeys = decodeArray<SymbiontSpeciesKey>(
        entry['absorbedSpeciesKeys'],
        `${entryPath}.absorbedSpeciesKeys`,
        (species, speciesPath) =>
          isSpeciesKey(species) ? { ok: true, value: species } : refused(speciesPath, species),
      );
      if (!absorbedSpeciesKeys.ok) return absorbedSpeciesKeys;
      const result = decodeProjection(entry, entryPath, {
        absorbedSpeciesKeys: (field) => field === entry['absorbedSpeciesKeys'],
        acceptedIndex: (field) => isSafeIntegerAtLeast(field, 0),
        currentOe: (field) => isSafeIntegerAtLeast(field, 0),
        slotCost: (field) => isSafeIntegerAtLeast(field, 0),
        speciesKey: isSpeciesKey,
        speciesLabel: isNonEmptyString,
        status: (field) => INSTANCE_STATUSES.has(field as string),
      });
      return result.ok
        ? {
            ok: true,
            value: {
              ...(entry as SymbiontInstanceProjection),
              absorbedSpeciesKeys: absorbedSpeciesKeys.value,
            },
          }
        : result;
    },
  );
  if (!symbiontInstancesDraft.ok) return symbiontInstancesDraft;
  const interactionGraph = decodeInteractionContainer(
    value['interactionGraph'],
    `${path}.interactionGraph`,
    'INTERACTIONS',
    'NO_INTERACTIONS',
  );
  if (!interactionGraph.ok) return interactionGraph;
  const suppressionPreview = decodeInteractionContainer(
    value['suppressionDestructionAbsorptionPreview'],
    `${path}.suppressionDestructionAbsorptionPreview`,
    'CONSEQUENCES',
    'NONE',
  );
  if (!suppressionPreview.ok) return suppressionPreview;
  const duplicatePolicy = value['duplicatePolicy'];
  if (!isJsonObject(duplicatePolicy)) return refused(`${path}.duplicatePolicy`, duplicatePolicy!);
  const duplicateKind = mode === 'MANUAL' ? 'FORBIDDEN' : 'REROLL_WITH_SEPARATE_RECEIPTS';
  if (duplicatePolicy['kind'] !== duplicateKind) {
    return refused(`${path}.duplicatePolicy.kind`, duplicatePolicy['kind']!);
  }
  const duplicateResult = decodeProjection(duplicatePolicy, `${path}.duplicatePolicy`, {
    kind: (field) => field === duplicateKind,
    ...(mode === 'RANDOM'
      ? {
          receipts: (field: JsonValue | undefined) =>
            Array.isArray(field) && field.every(isJsonObject),
        }
      : {}),
  });
  if (!duplicateResult.ok) return duplicateResult;
  const duplicateReceipts =
    mode === 'RANDOM'
      ? decodeArray(
          duplicatePolicy['receipts'],
          `${path}.duplicatePolicy.receipts`,
          decodeDuplicateReceipt,
        )
      : ({ ok: true, value: [] } as const);
  if (!duplicateReceipts.ok) return duplicateReceipts;
  const slots = value['slotUsageAndCapacity'];
  if (!isJsonObject(slots)) return refused(`${path}.slotUsageAndCapacity`, slots!);
  const slotResult = decodeProjection(slots, `${path}.slotUsageAndCapacity`, {
    capacity: (field) => isSafeIntegerAtLeast(field, 0),
    used: (field) => isSafeIntegerAtLeast(field, 0) && field <= (slots['capacity'] as number),
  });
  if (!slotResult.ok) return slotResult;
  const modifier = decodeModifierBreakdown(
    value['symbiontModifierBreakdown'],
    `${path}.symbiontModifierBreakdown`,
  );
  if (!modifier.ok) return modifier;
  const result = decodeProjection(value, path, {
    bindings: (field) => field === value['bindings'],
    characterDraftId: isNonEmptyString,
    commandId: isNullableString,
    compositionValidation: (field) => field === 'VALID',
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    duplicatePolicy: (field) => field === duplicatePolicy,
    interactionGraph: (field) => field === value['interactionGraph'],
    irreversibleBoundaryStatus: (field) =>
      field === (mode === 'MANUAL' ? 'NOT_CROSSED' : 'CROSSED'),
    raceChoice: (field) => field === 'FREE' || field === 'UNITED',
    randomReceiptIds: (field) =>
      Array.isArray(field) && field.every(isNonEmptyString) && new Set(field).size === field.length,
    slotUsageAndCapacity: (field) => field === slots,
    speciesKeys: (field) => Array.isArray(field) && field.every(isSpeciesKey),
    suppressionDestructionAbsorptionPreview: (field) =>
      field === value['suppressionDestructionAbsorptionPreview'],
    symbiontInstancesDraft: (field) => field === value['symbiontInstancesDraft'],
    symbiontModifierBreakdown: (field) => field === value['symbiontModifierBreakdown'],
    wizardCheckpointId: isNonEmptyString,
  });
  if (!result.ok) return result;
  const speciesKeys = value['speciesKeys'] as readonly SymbiontSpeciesKey[];
  if (
    (value['raceChoice'] === 'FREE' && speciesKeys.length !== 1) ||
    (value['raceChoice'] === 'UNITED' && (speciesKeys.length < 1 || speciesKeys.length > 4))
  ) {
    return refused(`${path}.speciesKeys`, speciesKeys);
  }
  const decoded = {
    ...(value as Chr019Projection),
    bindings: bindings.value,
    duplicatePolicy:
      mode === 'MANUAL'
        ? { kind: 'FORBIDDEN' }
        : { kind: 'REROLL_WITH_SEPARATE_RECEIPTS', receipts: duplicateReceipts.value },
    interactionGraph: interactionGraph.value as Chr019Projection['interactionGraph'],
    suppressionDestructionAbsorptionPreview:
      suppressionPreview.value as Chr019Projection['suppressionDestructionAbsorptionPreview'],
    symbiontInstancesDraft: symbiontInstancesDraft.value,
    symbiontModifierBreakdown: modifier.value,
  };
  return { ok: true, value: decoded as Chr019Projection | ManualChr019Projection };
}

export function randomSymbiontDraftFromSnapshot(
  snapshot: ConfirmedProjectionSnapshot,
): RandomSymbiontDraft | null {
  if (snapshot.formId !== 'CHR-020') return null;
  const projection = snapshot.projection;
  const sideEligibleSpecies = projection.drawnSpeciesAndBindings.flatMap((entry) =>
    entry.speciesKey === 'OWL' || entry.speciesKey === 'EEL' ? [entry.speciesKey] : [],
  );
  const side = (species: 'OWL' | 'EEL'): SymbiontSide => {
    const binding = projection.drawnSpeciesAndBindings.find(
      (entry) => entry.speciesKey === species,
    )?.binding;
    return binding !== undefined && 'side' in binding ? binding.side : 'RIGHT';
  };
  return {
    formId: 'CHR-020',
    manualFaceOrNull: null,
    selectedMonsterSpeciesKeyOrNull: null,
    sideBySpecies: { OWL: side('OWL'), EEL: side('EEL') },
    sideSpeciesKeyOrNull: sideEligibleSpecies[0] ?? null,
  };
}

export function replaceRandomManualFace(
  draft: RandomSymbiontDraft,
  value: number | null,
): RandomSymbiontDraft {
  if (value !== null && !isFace(value)) throw new Error('CHR-020 requires one D20 face in 1..20');
  return { ...draft, manualFaceOrNull: value };
}

export function replaceRandomSideSpecies(
  draft: RandomSymbiontDraft,
  species: 'OWL' | 'EEL' | null,
): RandomSymbiontDraft {
  if (species === null) return { ...draft, sideSpeciesKeyOrNull: null };
  if (draft.sideSpeciesKeyOrNull === null) {
    throw new Error('CHR-020 has no host-signed Owl or Eel side scope');
  }
  return { ...draft, sideSpeciesKeyOrNull: species };
}

export function toggleRandomSide(draft: RandomSymbiontDraft): RandomSymbiontDraft {
  const species = draft.sideSpeciesKeyOrNull;
  if (species === null) throw new Error('CHR-020 requires a host-signed side species');
  return {
    ...draft,
    sideBySpecies: {
      ...draft.sideBySpecies,
      [species]: draft.sideBySpecies[species] === 'RIGHT' ? 'LEFT' : 'RIGHT',
    },
  };
}

export function cycleRandomMonster(draft: RandomSymbiontDraft): RandomSymbiontDraft {
  const current = draft.selectedMonsterSpeciesKeyOrNull;
  const next =
    current === null
      ? MONSTER_SPECIES_KEYS[0]
      : (MONSTER_SPECIES_KEYS[
          (MONSTER_SPECIES_KEYS.indexOf(current) + 1) % MONSTER_SPECIES_KEYS.length
        ] ?? MONSTER_SPECIES_KEYS[0]);
  return { ...draft, selectedMonsterSpeciesKeyOrNull: next };
}

export function advisorSkillSelectionDraftFromSnapshot(
  snapshot: ConfirmedProjectionSnapshot,
): AdvisorSkillSelectionDraft | null {
  if (snapshot.formId !== 'CHR-041') return null;
  const projection = snapshot.projection;
  if (
    !isAdvisorSkillSlots(projection.advisorSlotsAndSkills) ||
    projection.acknowledged ||
    ('compositionDraftRevision' in projection &&
      projection.trogrSuppressionState.kind === 'SUPPRESSED' &&
      projection.trogrSuppressionState.rollReceiptIdOrNull === null)
  ) {
    return null;
  }
  return {
    candidateSkillIdOrNull: null,
    candidateTargetBonusOrNull: null,
    formId: 'CHR-041',
    selectedSkills: [...projection.advisorSlotsAndSkills.selectedSkills],
    selectionValidation: projection.advisorSlotsAndSkills.selectionValidation,
  };
}

export function replaceAdvisorSkillCandidate(
  projection: Chr041Projection,
  draft: AdvisorSkillSelectionDraft,
  skillId: string | null,
  targetBonus: number | null,
): AdvisorSkillSelectionDraft {
  if (skillId === null) {
    if (targetBonus !== null) throw new Error('CHR-041 target bonus requires an explicit skill');
    return { ...draft, candidateSkillIdOrNull: null, candidateTargetBonusOrNull: null };
  }
  if (!isAdvisorSkillSlots(projection.advisorSlotsAndSkills)) {
    throw new Error('CHR-041 requires committed I/W before skill options');
  }
  const option = projection.advisorSlotsAndSkills.skillOptions.find(
    (candidate) => candidate.skillId === skillId,
  );
  if (option === undefined) throw new Error('CHR-041 skill is absent from signed options');
  if (
    targetBonus !== null &&
    !option.levelOptions.some((level) => level.targetBonus === targetBonus)
  ) {
    throw new Error('CHR-041 target bonus is absent from signed levelOptions');
  }
  return {
    ...draft,
    candidateSkillIdOrNull: skillId,
    candidateTargetBonusOrNull: targetBonus,
  };
}

export function toggleAdvisorSkillSelection(
  projection: Chr041Projection,
  draft: AdvisorSkillSelectionDraft,
): AdvisorSkillSelectionDraft {
  const skillId = draft.candidateSkillIdOrNull;
  const targetBonus = draft.candidateTargetBonusOrNull;
  if (skillId === null || targetBonus === null) {
    throw new Error('CHR-041 requires an explicit skill and target bonus');
  }
  if (!isAdvisorSkillSlots(projection.advisorSlotsAndSkills)) {
    throw new Error('CHR-041 requires committed I/W before skill options');
  }
  const option = projection.advisorSlotsAndSkills.skillOptions.find(
    (candidate) => candidate.skillId === skillId,
  );
  const level = option?.levelOptions.find((candidate) => candidate.targetBonus === targetBonus);
  if (option === undefined || level === undefined) {
    throw new Error('CHR-041 candidate is absent from signed options');
  }
  const existing = draft.selectedSkills.find((selected) => selected.skillId === skillId);
  const selectedSkills = existing
    ? draft.selectedSkills.filter((selected) => selected.skillId !== skillId)
    : [
        ...draft.selectedSkills,
        { skillId, slotCost: level.slotCost, targetBonus: level.targetBonus },
      ];
  if (new Set(selectedSkills.map((selected) => selected.skillId)).size !== selectedSkills.length) {
    throw new Error('CHR-041 duplicate skills are forbidden');
  }
  const usedSlotCount = selectedSkills.reduce((sum, selected) => sum + selected.slotCost, 0);
  return {
    candidateSkillIdOrNull: null,
    candidateTargetBonusOrNull: null,
    formId: 'CHR-041',
    selectedSkills,
    selectionValidation: skillSelectionValidation(
      projection.advisorSlotsAndSkills.requiredSlotCount,
      usedSlotCount,
    ),
  };
}

export function randomRollCommitPayload(
  snapshot: ConfirmedProjectionSnapshot,
  draft: RandomSymbiontDraft | null,
): SymbiontRollCommitPayload {
  if (snapshot.formId !== 'CHR-020' || draft === null) {
    throw new Error('CHR-020 requires an active local random draft');
  }
  const projection = snapshot.projection;
  const common = {
    characterDraftId: projection.characterDraftId,
    draftRevision: projection.draftRevision,
    randomSequenceId: projection.randomSequenceId,
    sourceFormId: 'CHR-020' as const,
    stage: 'SYMBIONTS' as const,
    wizardCheckpointId: projection.wizardCheckpointId,
  };
  if (projection.randomStatus === 'BINDING') {
    return {
      ...common,
      physicalRollReceiptIds: projection.seedOrManualFaces.entries.map(
        (entry) => entry.rollReceiptId,
      ),
      selectedBindings: projection.drawnSpeciesAndBindings.flatMap((entry) =>
        entry.speciesKey === 'OWL' || entry.speciesKey === 'EEL'
          ? [{ side: draft.sideBySpecies[entry.speciesKey], speciesKey: entry.speciesKey }]
          : [],
      ),
      variant: 'BINDING',
    };
  }
  if (projection.randomStatus === 'COMMITTED') {
    throw new Error('CHR-020 is already committed');
  }
  const monsterRequired = snapshot.availableActionKeys.includes(CHR_020_MONSTER_DRAFT_ACTION_KEY);
  if (monsterRequired && draft.selectedMonsterSpeciesKeyOrNull === null) {
    throw new Error('CHR-020 requires an explicit monster choice before confirmation');
  }
  const manualFaceOrNull =
    projection.diceInputModeSnapshot === 'MANUAL' ? draft.manualFaceOrNull : null;
  if (projection.diceInputModeSnapshot === 'MANUAL' && !isFace(manualFaceOrNull)) {
    throw new Error('CHR-020 requires one complete MANUAL face');
  }
  return {
    ...common,
    manualFaceOrNull,
    pendingRollRequestIdOrNull: projection.pendingRollRequestIdOrNull,
    selectedMonsterSpeciesKeyOrNull: monsterRequired ? draft.selectedMonsterSpeciesKeyOrNull : null,
    variant: 'ROLL',
  };
}

export function advisorCheckpointPayload(
  snapshot: ConfirmedProjectionSnapshot,
  draft: AdvisorSkillSelectionDraft | null,
): SymbiontAdvisorCheckpointPayload {
  if (snapshot.formId !== 'CHR-041' || draft === null) {
    throw new Error('CHR-041 requires an active Advisor skill draft');
  }
  const projection = snapshot.projection;
  const randomSequenceId = projection['randomSequenceId'];
  if (typeof randomSequenceId !== 'string') {
    throw new Error('CHR-041 skill checkpoint requires the RANDOM Advisor transport');
  }
  if (!isAdvisorSkillSlots(projection.advisorSlotsAndSkills)) {
    throw new Error('CHR-041 requires committed I/W before skills');
  }
  if (projection.acknowledged || draft.selectionValidation.kind !== 'EXACT') {
    throw new Error('CHR-041 requires exact skill slots');
  }
  if (
    new Set(draft.selectedSkills.map((selected) => selected.skillId)).size !==
    draft.selectedSkills.length
  ) {
    throw new Error('CHR-041 duplicate skills are forbidden');
  }
  const usedSlotCount = draft.selectedSkills.reduce((sum, selected) => sum + selected.slotCost, 0);
  if (usedSlotCount !== projection.advisorSlotsAndSkills.requiredSlotCount) {
    throw new Error('CHR-041 selected skill slots do not match the required count');
  }
  for (const selected of draft.selectedSkills) {
    const option = projection.advisorSlotsAndSkills.skillOptions.find(
      (candidate) => candidate.skillId === selected.skillId,
    );
    const level = option?.levelOptions.find(
      (candidate) => candidate.targetBonus === selected.targetBonus,
    );
    if (option === undefined || level === undefined || level.slotCost !== selected.slotCost) {
      throw new Error('CHR-041 contains a forged skill or slot cost');
    }
  }
  return {
    advisorInstanceDraftId: projection.advisorInstanceDraftId,
    characterDraftId: projection.characterDraftId,
    draftRevision: projection.draftRevision,
    randomSequenceId,
    selectedSkills: draft.selectedSkills.map(({ skillId, targetBonus }) => ({
      skillId,
      targetBonus,
    })),
    sourceFormId: 'CHR-041',
    stage: 'SYMBIONTS',
    wizardCheckpointId: projection.wizardCheckpointId,
  };
}

export function advisorIntelligenceFloorRollPayload(
  snapshot: ConfirmedProjectionSnapshot,
  manualFaceOrNull: number | null = null,
): AdvisorIntelligenceFloorRollPayload {
  if (snapshot.formId !== 'CHR-041' || !('compositionDraftRevision' in snapshot.projection)) {
    throw new Error('CHR-041 intelligence floor requires a MANUAL composition projection');
  }
  const projection = snapshot.projection;
  const suppression = projection.trogrSuppressionState;
  if (suppression.kind !== 'SUPPRESSED' || suppression.rollReceiptIdOrNull !== null) {
    throw new Error('CHR-041 requires one pending intelligence floor request');
  }
  const pendingRollRequestId = suppression.rollRequestIdOrNull;
  if (!isNonEmptyString(pendingRollRequestId)) {
    throw new Error('CHR-041 requires one pending intelligence floor request');
  }
  let manualFace: number | null = null;
  if (projection.diceInputModeSnapshot === 'MANUAL') {
    if (!isFace(manualFaceOrNull)) {
      throw new Error('CHR-041 requires one complete MANUAL intelligence floor face');
    }
    manualFace = manualFaceOrNull;
  }
  const compositionDraftRevision = projection['compositionDraftRevision'];
  if (!isSafeIntegerAtLeast(compositionDraftRevision, 0)) {
    throw new Error('CHR-041 requires a valid composition draft revision');
  }
  return {
    advisorInstanceDraftId: projection.advisorInstanceDraftId,
    characterDraftId: projection.characterDraftId,
    compositionDraftRevision,
    draftRevision: projection.draftRevision,
    manualFaceOrNull: manualFace,
    pendingRollRequestId,
    sourceFormId: 'CHR-041',
    stage: 'SYMBIONTS',
    variant: 'TROGR_SUPPRESSION_B',
    wizardCheckpointId: projection.wizardCheckpointId,
  };
}

function receiptCommonFields(
  payload: SymbiontRollCommitPayload | SymbiontAdvisorCheckpointPayload,
): Record<string, FieldPredicate> {
  return {
    branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
    branchUuid: isNonEmptyString,
    characterDraftId: (field) => field === payload.characterDraftId,
    checkpointId: (field) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field) => field === payload.characterDraftId,
    checkpointRevision: (field) => isSafeIntegerAtLeast(field, 1),
    draftRevision: (field) => field === payload.draftRevision + 1,
    randomSequenceId: (field) => field === payload.randomSequenceId,
    stage: (field) => field === 'SYMBIONTS',
  };
}

function validReceiptRevisions(
  receipt: CommandReceipt<JsonObject>,
  expected: ConfirmedProjectionSnapshot['revisions'],
): boolean {
  return (
    receipt.revisions.actorVisibilityRevision === expected.actorVisibilityRevision &&
    receipt.revisions.stateRevision === expected.stateRevision + 1 &&
    receipt.revisions.projectionRevision === expected.projectionRevision + 1
  );
}

function uniqueReceiptIds(
  receipt: CommandReceipt<JsonObject>,
  payload: SymbiontRollCommitPayload | SymbiontAdvisorCheckpointPayload,
): boolean {
  const ids = [
    receipt.commandId,
    receipt.receiptId,
    receipt.result['branchUuid'],
    payload.characterDraftId,
    payload.wizardCheckpointId,
    payload.randomSequenceId,
  ].filter((entry): entry is string => typeof entry === 'string');
  return new Set(ids).size === ids.length;
}

export function decodeSymbiontRollCommitTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.result' | 'command.replay' }
  >,
  request: SymbiontRollCommitRequest,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<CommandReceipt<SymbiontRollCommitResult>> {
  const receipt = message.receipt;
  const payload = request.payload;
  if (
    source.formId !== 'CHR-020' ||
    receipt.commandId !== request.commandId ||
    !isNonEmptyString(receipt.receiptId)
  ) {
    return refused('$.receipt.commandId', receipt.commandId);
  }
  const sourceProjection = source.projection;
  if (
    !validReceiptRevisions(receipt, request.expectedRevisions) ||
    !uniqueReceiptIds(receipt, payload)
  ) {
    return refused('$.receipt.revisions', { ...receipt.revisions });
  }
  if (payload.variant === 'ROLL') {
    const physicalRoll = decodePhysicalRoll(
      receipt.result['physicalRoll'],
      '$.receipt.result.physicalRoll',
    );
    if (!physicalRoll.ok) return physicalRoll;
    const result = decodeProjection(receipt.result, '$.receipt.result', {
      ...receiptCommonFields(payload),
      advisorBranch: isBoolean,
      diceInputModeSnapshot: (field) => field === sourceProjection.diceInputModeSnapshot,
      nextFormId: (field) => field === 'CHR-020',
      nextPendingRollRequestIdOrNull: isNullableString,
      physicalRoll: (field) => field === receipt.result['physicalRoll'],
      randomReceiptIdOrNull: (field) =>
        sourceProjection.diceInputModeSnapshot === 'AUTO'
          ? field === receipt.receiptId
          : field === null,
      randomStatus: (field) => field === 'PENDING' || field === 'BINDING',
      sourceFormId: (field) => field === 'CHR-020',
      variant: (field) => field === 'ROLL',
    });
    if (!result.ok) return result;
    const roll = physicalRoll.value;
    if (
      roll.rollReceiptId !== receipt.receiptId ||
      (payload.pendingRollRequestIdOrNull !== null &&
        roll.rollRequestId !== payload.pendingRollRequestIdOrNull) ||
      (roll.kind === 'CRITICAL_CONFIRMATION' &&
        ((roll.selectedMonsterSpeciesKeyOrNull !== null &&
          roll.selectedMonsterSpeciesKeyOrNull !== payload.selectedMonsterSpeciesKeyOrNull) ||
          (payload.selectedMonsterSpeciesKeyOrNull === null &&
            roll.selectedMonsterSpeciesKeyOrNull !== null))) ||
      (receipt.result['randomStatus'] === 'BINDING' &&
        receipt.result['nextPendingRollRequestIdOrNull'] !== null) ||
      (receipt.result['randomStatus'] === 'PENDING' &&
        !isNonEmptyString(receipt.result['nextPendingRollRequestIdOrNull'])) ||
      (sourceProjection.diceInputModeSnapshot === 'MANUAL' &&
        roll.mechanical.rawFace !== payload.manualFaceOrNull)
    ) {
      return refused('$.receipt.result.physicalRoll', roll);
    }
    return { ok: true, value: receipt as CommandReceipt<SymbiontPhysicalRollResult> };
  }
  const bindings = decodeArray(
    receipt.result['bindings'],
    '$.receipt.result.bindings',
    decodeSymbiontBinding,
  );
  if (!bindings.ok) return bindings;
  const result = decodeProjection(receipt.result, '$.receipt.result', {
    ...receiptCommonFields(payload),
    advisorBranch: (field) => field === sourceProjection.advisorBranch,
    bindings: (field) => field === receipt.result['bindings'],
    nextFormId: (field) => field === (sourceProjection.advisorBranch ? 'CHR-041' : 'CHR-019'),
    randomStatus: (field) => field === 'COMMITTED',
    sourceFormId: (field) => field === 'CHR-020',
    variant: (field) => field === 'BINDING',
  });
  if (!result.ok) return result;
  const expectedReceiptIds = sourceProjection.seedOrManualFaces.entries.map(
    (entry) => entry.rollReceiptId,
  );
  if (!sameJson(payload.physicalRollReceiptIds, expectedReceiptIds)) {
    return refused('$.receipt.result.bindings', bindings.value);
  }
  if (bindings.value.length !== sourceProjection.drawnSpeciesAndBindings.length) {
    return refused('$.receipt.result.bindings', bindings.value);
  }
  for (const [index, sourceBinding] of sourceProjection.drawnSpeciesAndBindings.entries()) {
    const actual = bindings.value[index];
    if (actual === undefined) return refused('$.receipt.result.bindings', bindings.value);
    const requested = payload.selectedBindings.find(
      (entry) => entry.speciesKey === sourceBinding.speciesKey,
    );
    const expectedSide = requested?.side;
    if (
      actual.speciesKey !== sourceBinding.speciesKey ||
      actual.acceptedIndex !== sourceBinding.acceptedIndex ||
      (sourceBinding.speciesKey === 'OWL' || sourceBinding.speciesKey === 'EEL'
        ? expectedSide === undefined ||
          !('side' in actual.binding) ||
          actual.binding.side !== expectedSide
        : !sameJson(actual.binding, sourceBinding.binding))
    ) {
      return refused(`$.receipt.result.bindings[${String(index)}]`, actual);
    }
  }
  return { ok: true, value: receipt as CommandReceipt<SymbiontBindingResult> };
}

export function decodeSymbiontAdvisorCheckpointTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.result' | 'command.replay' }
  >,
  request: SymbiontAdvisorCheckpointRequest,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<CommandReceipt<SymbiontAdvisorCheckpointResult>> {
  const receipt = message.receipt;
  const payload = request.payload;
  const sourceProjection = source.projection as Chr041Projection;
  if (sourceProjection.advisorSlotsAndSkills.kind === 'IW_ROLLS_REQUIRED') {
    return refused(
      '$.presentation.base.roleFilteredPayload.advisorSlotsAndSkills.kind',
      sourceProjection.advisorSlotsAndSkills.kind,
    );
  }
  if (
    source.formId !== 'CHR-041' ||
    receipt.commandId !== request.commandId ||
    !isNonEmptyString(receipt.receiptId)
  ) {
    return refused('$.receipt.commandId', receipt.commandId);
  }
  if (
    !validReceiptRevisions(receipt, request.expectedRevisions) ||
    !uniqueReceiptIds(receipt, payload)
  ) {
    return refused('$.receipt.revisions', { ...receipt.revisions });
  }
  const sourceSlots = sourceProjection.advisorSlotsAndSkills;
  if (!isAdvisorSkillSlots(sourceSlots)) {
    return refused(
      '$.presentation.base.roleFilteredPayload.advisorSlotsAndSkills',
      sourceProjection.advisorSlotsAndSkills,
    );
  }
  const expectedLearnedSkills = payload.selectedSkills.map((selected) => {
    const option = sourceSlots.skillOptions.find(
      (candidate) => candidate.skillId === selected.skillId,
    );
    const level = option?.levelOptions.find(
      (candidate) => candidate.targetBonus === selected.targetBonus,
    );
    if (option === undefined || level === undefined) {
      throw new Error('CHR-041 receipt references a forged skill level');
    }
    return { bonus: selected.targetBonus, skillKey: selected.skillId, slotCost: level.slotCost };
  });
  const expectedUsed = expectedLearnedSkills.reduce((sum, skill) => sum + skill.slotCost, 0);
  const result = decodeProjection(receipt.result, '$.receipt.result', {
    ...receiptCommonFields(payload),
    advisorInstanceDraftId: (field) => field === payload.advisorInstanceDraftId,
    effectsActive: (field) => field === sourceProjection.advisorCard.effectsActive,
    learnedSkills: (field) => sameJson(field, expectedLearnedSkills),
    nextFormId: (field) => field === 'CHR-019',
    requiredSlotCount: (field) => field === sourceSlots.requiredSlotCount,
    selectedSkills: (field) => sameJson(field, payload.selectedSkills),
    sourceFormId: (field) => field === 'CHR-041',
    usedSlotCount: (field) => field === expectedUsed,
  });
  if (!result.ok) return result;
  return { ok: true, value: receipt as CommandReceipt<SymbiontAdvisorCheckpointResult> };
}

function snapshotCommonMatches(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<SymbiontReceiptResultCommon>,
): boolean {
  return (
    snapshot.revisions.actorVisibilityRevision === receipt.revisions.actorVisibilityRevision &&
    snapshot.revisions.stateRevision === receipt.revisions.stateRevision &&
    snapshot.revisions.projectionRevision === receipt.revisions.projectionRevision &&
    snapshot.projection['characterDraftId'] === receipt.result.characterDraftId &&
    snapshot.projection['wizardCheckpointId'] === receipt.result.checkpointId &&
    snapshot.projection['draftRevision'] === receipt.result.draftRevision &&
    snapshot.projection['commandId'] === receipt.commandId
  );
}

function snapshotForwardCommonMatches(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<SymbiontReceiptResultCommon>,
): boolean {
  const currentDraftRevision = snapshot.projection['draftRevision'];
  return (
    snapshot.revisions.actorVisibilityRevision >= receipt.revisions.actorVisibilityRevision &&
    snapshot.revisions.stateRevision >= receipt.revisions.stateRevision &&
    snapshot.revisions.projectionRevision >= receipt.revisions.projectionRevision &&
    typeof currentDraftRevision === 'number' &&
    currentDraftRevision >= receipt.result.draftRevision &&
    snapshot.projection['characterDraftId'] === receipt.result.characterDraftId &&
    snapshot.projection['wizardCheckpointId'] === receipt.result.checkpointId
  );
}

function snapshotDraftIsAfter(
  snapshot: ConfirmedProjectionSnapshot,
  result: SymbiontReceiptResultCommon,
): boolean {
  const currentDraftRevision = snapshot.projection['draftRevision'];
  return typeof currentDraftRevision === 'number' && currentDraftRevision > result.draftRevision;
}

export function symbiontRollSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<SymbiontRollCommitResult>,
): DecodeResult<ConfirmedProjectionSnapshot> {
  const result = receipt.result;
  if (!snapshotForwardCommonMatches(snapshot, receipt)) {
    return refused('$.revisions', { ...snapshot.revisions });
  }
  if (result.variant === 'ROLL') {
    if (snapshot.formId === 'CHR-020') {
      const projection = snapshot.projection;
      if (projection.randomSequenceId !== result.randomSequenceId) {
        return refused(
          '$.presentation.base.roleFilteredPayload.randomSequenceId',
          projection.randomSequenceId,
        );
      }
      if (
        !projection.seedOrManualFaces.entries.some((entry) => sameJson(entry, result.physicalRoll))
      ) {
        return refused(
          '$.presentation.base.roleFilteredPayload.seedOrManualFaces.entries',
          projection.seedOrManualFaces.entries,
        );
      }
      return { ok: true, value: snapshot };
    }
    if (!snapshotDraftIsAfter(snapshot, result)) {
      return refused('$.presentation.base.formId', snapshot.formId);
    }
    if (snapshot.formId === 'CHR-041') {
      const projection = snapshot.projection;
      const randomSequenceId =
        'randomSequenceId' in projection ? projection.randomSequenceId : null;
      if (randomSequenceId !== result.randomSequenceId || projection.acknowledged) {
        return refused(
          '$.presentation.base.roleFilteredPayload.randomSequenceId',
          randomSequenceId,
        );
      }
      if (result.physicalRoll.kind === 'ADVISOR_I' || result.physicalRoll.kind === 'ADVISOR_W') {
        const index = result.physicalRoll.kind === 'ADVISOR_I' ? 0 : 1;
        if (
          projection.iwRollRequestIds[index] !== result.physicalRoll.rollRequestId ||
          projection.iwRollReceiptIds[index] !== result.physicalRoll.rollReceiptId
        ) {
          return refused('$.presentation.base.roleFilteredPayload.iwRollReceiptIds', [
            ...projection.iwRollReceiptIds,
          ]);
        }
      }
      return { ok: true, value: snapshot };
    }
    if (snapshot.formId === 'CHR-019') {
      const projection = snapshot.projection;
      if (projection.duplicatePolicy.kind === 'FORBIDDEN') {
        return refused(
          '$.presentation.base.roleFilteredPayload.duplicatePolicy.kind',
          projection.duplicatePolicy.kind,
        );
      }
      const randomReceiptId = result.randomReceiptIdOrNull;
      if (
        randomReceiptId === null
          ? projection.randomReceiptIds.includes(receipt.receiptId)
          : !projection.randomReceiptIds.includes(randomReceiptId)
      ) {
        return refused(
          '$.presentation.base.roleFilteredPayload.randomReceiptIds',
          projection.randomReceiptIds,
        );
      }
      return { ok: true, value: snapshot };
    }
    return refused('$.presentation.base.formId', snapshot.formId);
  }
  if (snapshot.formId === 'CHR-041') {
    const projection = snapshot.projection;
    const randomSequenceId = 'randomSequenceId' in projection ? projection.randomSequenceId : null;
    if (
      result.nextFormId !== 'CHR-041' ||
      randomSequenceId !== result.randomSequenceId ||
      projection.acknowledged
    ) {
      return refused('$.presentation.base.roleFilteredPayload.randomSequenceId', randomSequenceId);
    }
    return { ok: true, value: snapshot };
  }
  if (snapshot.formId !== 'CHR-019') {
    return refused('$.presentation.base.formId', snapshot.formId);
  }
  if (result.nextFormId === 'CHR-041' && !snapshotDraftIsAfter(snapshot, result)) {
    return refused('$.presentation.base.formId', snapshot.formId);
  }
  const projection = snapshot.projection;
  if (projection.duplicatePolicy.kind === 'FORBIDDEN') {
    return refused(
      '$.presentation.base.roleFilteredPayload.duplicatePolicy.kind',
      projection.duplicatePolicy.kind,
    );
  }
  if (!sameJson(projection.bindings, result.bindings)) {
    return refused('$.presentation.base.roleFilteredPayload.bindings', projection.bindings);
  }
  if (projection.randomReceiptIds.includes(receipt.receiptId)) {
    return refused(
      '$.presentation.base.roleFilteredPayload.randomReceiptIds',
      projection.randomReceiptIds,
    );
  }
  return { ok: true, value: snapshot };
}

export function advisorCheckpointSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<SymbiontAdvisorCheckpointResult>,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (snapshot.formId !== 'CHR-019' || !snapshotCommonMatches(snapshot, receipt)) {
    return refused('$.presentation.base.formId', snapshot.formId);
  }
  return { ok: true, value: snapshot };
}

function decodeAdvisorIntelligenceFloorPhysicalRoll(
  value: unknown,
  path: string,
): DecodeResult<AdvisorIntelligenceFloorPhysicalRoll> {
  if (!isJsonObject(value)) return refused(path, value as JsonValue);
  const mechanical = value['mechanical'];
  if (!isJsonObject(mechanical)) return refused(`${path}.mechanical`, mechanical!);
  const mechanicalResult = decodeProjection(mechanical, `${path}.mechanical`, {
    dieSides: (field) => field === 20,
    rawFace: isFace,
  });
  if (!mechanicalResult.ok) return mechanicalResult;
  const result = decodeProjection(value, path, {
    kind: (field) => field === 'TROGR_SUPPRESSION_B',
    mechanical: (field) => field === mechanical,
    rollReceiptId: isNonEmptyString,
    rollRequestId: isNonEmptyString,
  });
  return result.ok ? { ok: true, value: value as AdvisorIntelligenceFloorPhysicalRoll } : result;
}

export function decodeAdvisorIntelligenceFloorRollTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.result' | 'command.replay' }
  >,
  request: AdvisorIntelligenceFloorRollRequest,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<CommandReceipt<AdvisorIntelligenceFloorRollResult>> {
  if (source.formId !== 'CHR-041' || !('compositionDraftRevision' in source.projection)) {
    return refused('$.presentation.base.formId', source.formId);
  }
  const sourceProjection = source.projection;
  const receipt = message.receipt;
  const payload = request.payload;
  if (receipt.commandId !== request.commandId || !isNonEmptyString(receipt.receiptId)) {
    return refused('$.receipt.commandId', receipt.commandId);
  }
  const physicalRoll = decodeAdvisorIntelligenceFloorPhysicalRoll(
    receipt.result['physicalRoll'],
    '$.receipt.result.physicalRoll',
  );
  if (!physicalRoll.ok) return physicalRoll;
  const result = decodeProjection(receipt.result, '$.receipt.result', {
    advisorInstanceDraftId: (field) => field === payload.advisorInstanceDraftId,
    branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
    branchUuid: isNonEmptyString,
    characterDraftId: (field) => field === payload.characterDraftId,
    checkpointId: (field) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field) => field === payload.characterDraftId,
    checkpointRevision: (field) => isSafeIntegerAtLeast(field, 1),
    compositionDraftRevision: (field) => field === payload.compositionDraftRevision,
    draftRevision: (field) => field === payload.draftRevision + 1,
    minimumI: (field) => isSafeIntegerAtLeast(field, 1),
    nextFormId: (field) => field === 'CHR-041',
    physicalRoll: (field) => field === receipt.result['physicalRoll'],
    rollPurpose: (field) => field === 'FUTURE_MINIMUM_INTELLIGENCE',
    sourceFormId: (field) => field === 'CHR-041',
    stage: (field) => field === 'SYMBIONTS',
    suppressionB: (field) => isSafeIntegerAtLeast(field, 0),
    teacherAbsorbed: isBoolean,
    variant: (field) => field === 'TROGR_SUPPRESSION_B',
  });
  if (!result.ok) return result;
  const roll = physicalRoll.value;
  const uniqueIds = [
    ...sourceProjection.iwRollRequestIds,
    ...sourceProjection.iwRollReceiptIds,
    payload.advisorInstanceDraftId,
    payload.pendingRollRequestId,
    receipt.commandId,
    receipt.receiptId,
    receipt.result['branchUuid'],
  ].filter((entry): entry is string => typeof entry === 'string');
  if (
    !validReceiptRevisions(receipt, request.expectedRevisions) ||
    roll.rollRequestId !== payload.pendingRollRequestId ||
    roll.rollReceiptId !== receipt.receiptId ||
    new Set(uniqueIds).size !== uniqueIds.length ||
    (sourceProjection.diceInputModeSnapshot === 'MANUAL' &&
      roll.mechanical.rawFace !== payload.manualFaceOrNull) ||
    (sourceProjection.diceInputModeSnapshot === 'AUTO' && payload.manualFaceOrNull !== null)
  ) {
    return refused('$.receipt.result.physicalRoll', roll);
  }
  return { ok: true, value: receipt as CommandReceipt<AdvisorIntelligenceFloorRollResult> };
}

export function advisorIntelligenceFloorSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<AdvisorIntelligenceFloorRollResult>,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (
    source.formId !== 'CHR-041' ||
    !('compositionDraftRevision' in source.projection) ||
    snapshot.formId !== 'CHR-041' ||
    !('compositionDraftRevision' in snapshot.projection)
  ) {
    return refused('$.presentation.base.formId', snapshot.formId);
  }
  const sourceProjection = source.projection;
  const projection = snapshot.projection;
  const result = receipt.result;
  const compositionDraftRevision = projection['compositionDraftRevision'];
  if (!isSafeIntegerAtLeast(compositionDraftRevision, 0)) {
    return refused(
      '$.presentation.base.roleFilteredPayload.compositionDraftRevision',
      compositionDraftRevision ?? null,
    );
  }
  const suppression = projection.trogrSuppressionState;
  const revisionsMatch =
    snapshot.revisions.actorVisibilityRevision >= receipt.revisions.actorVisibilityRevision &&
    snapshot.revisions.projectionRevision >= receipt.revisions.projectionRevision &&
    snapshot.revisions.stateRevision >= receipt.revisions.stateRevision;
  const laterComposition =
    projection.draftRevision > result.draftRevision ||
    compositionDraftRevision > result.compositionDraftRevision;
  const currentCommandMatches = laterComposition
    ? isNonEmptyString(projection.commandId)
    : projection.commandId === receipt.commandId &&
      projection.acknowledged === sourceProjection.acknowledged &&
      sameJson(projection.advisorSlotsAndSkills, sourceProjection.advisorSlotsAndSkills);
  if (
    !revisionsMatch ||
    !currentCommandMatches ||
    projection.characterDraftId !== result.characterDraftId ||
    projection.wizardCheckpointId !== result.checkpointId ||
    projection.draftRevision < result.draftRevision ||
    compositionDraftRevision < result.compositionDraftRevision ||
    projection.advisorInstanceDraftId !== result.advisorInstanceDraftId ||
    !sameJson(projection.iwRollRequestIds, sourceProjection.iwRollRequestIds) ||
    !sameJson(projection.iwRollReceiptIds, sourceProjection.iwRollReceiptIds) ||
    !sameJson(projection.advisorCard, sourceProjection.advisorCard) ||
    suppression.kind !== 'SUPPRESSED' ||
    suppression.rollPurpose !== result.rollPurpose ||
    suppression.rollRequestIdOrNull !== result.physicalRoll.rollRequestId ||
    suppression.rollReceiptIdOrNull !== receipt.receiptId ||
    suppression.suppressionBOrNull !== result.suppressionB ||
    suppression.minimumIOrNull !== result.minimumI
  ) {
    return refused('$.presentation.base.roleFilteredPayload', projection);
  }
  return { ok: true, value: snapshot };
}

export {
  decodeArray,
  decodeInteractionContainer,
  decodeModifierBreakdown,
  decodeProjection,
  decodeSymbiontBinding,
  decodeSymbiontModifierEffect,
  decodeSymbiontSpecies,
  decodeStatModifierEffect,
  isFace,
  isJsonObject,
  isNonEmptyString,
  isSafeIntegerAtLeast,
  isSpeciesKey,
  sameJson,
};
