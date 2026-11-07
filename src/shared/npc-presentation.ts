/** Current GM display data only. Type-only domain links emit no browser game evaluator. */
export type {
  NpcDiceEditor,
  NpcMasterWeaponEditor,
  NpcItemProfileEditor,
  NpcInventoryEditorRow,
} from '../domain/rules/npc-authoring/staged-input.js';
import type { ClassCode, RaceCode, StatCode } from '@generated/types/character.js';
import type {
  NpcCompositeItemTypeId,
  NpcWeaverStateBranch,
  NpcTaipanPoisonProfileId,
} from './npc-command.js';
import type { NpcEditorStages } from '../domain/rules/npc-authoring/staged-input.js';
import type {
  NpcSymbiontEditorRow,
  NpcInventoryEditorRow,
  NpcSkillSelectionRequest,
} from '../domain/rules/npc-authoring/staged-input.js';
import type { NpcDraftSection, NpcSymbiontInput } from '../domain/rules/npc-authoring/types.js';
import type {
  NpcInventoryRequestEntry,
  NpcItemProfileRequest,
  NpcItemQualityTier,
  NpcClothingProperties,
} from '../domain/rules/npc-authoring/inventory.js';
import type { MasterWeaponProfileInput } from '../domain/rules/item-stage/master-weapon-profile.js';
import type { SymbiontBinding } from '../domain/rules/symbiont-stage/catalog.js';
import type { ArmorBodyZone } from '../domain/rules/item-stage/armor-bundle.js';
import type {
  NpcUntimedDiseaseId,
  NpcWoundInstance,
} from '../domain/rules/npc-authoring/effect-types.js';

/** Leaf content only. The existing AtlasForm owns route/command buttons and its host guard set. */
export const NPC_CONTROL_FORM_IDS = [
  'NPC-001',
  'NPC-002',
  'NPC-003',
  'NPC-007',
  'NPC-011',
  'NPC-012',
  'NPC-013',
  'NPC-014',
  'NPC-015',
  'NPC-016',
  'NPC-017',
] as const;
export const NPC_CONTROL_ACTION_KEYS = {
  'NPC-001': ['NPC-001::CTA::001', 'NPC-001::CTA::002', 'NPC-001::CTA::003'],
  'NPC-002': ['NPC-002::CTA::002', 'NPC-002::CTA::003'],
  'NPC-003': ['NPC-003::CTA::008', 'NPC-003::CTA::009', 'NPC-003::CTA::010'],
  'NPC-007': ['NPC-007::CTA::001', 'NPC-007::CTA::002', 'NPC-007::CTA::003'],
  'NPC-011': ['NPC-011::CTA::002', 'NPC-011::CTA::003'],
  'NPC-012': ['NPC-012::CTA::002', 'NPC-012::CTA::003'],
  'NPC-013': ['NPC-013::CTA::002', 'NPC-013::CTA::003'],
  'NPC-014': ['NPC-014::CTA::002', 'NPC-014::CTA::003'],
  'NPC-015': ['NPC-015::CTA::002', 'NPC-015::CTA::003'],
  'NPC-016': ['NPC-016::CTA::002', 'NPC-016::CTA::003', 'NPC-016::CTA::004'],
  'NPC-017': ['NPC-017::CTA::002', 'NPC-017::CTA::003', 'NPC-017::CTA::004'],
} as const;
export type NpcFieldErrors<Field extends string> = Readonly<
  Partial<Record<Field, readonly string[]>>
>;
export interface NpcChoice<Value> {
  readonly value: Value;
  readonly label: string;
}
/** Private portrait reference: bytes are delivered only on the authenticated current GM channel. */
export interface NpcArtPresentation {
  readonly assetKey: string;
  readonly checksum: string;
}
/** Public source illustrations are separate from private NPC portrait references. */
export interface NpcSourceArtPresentation extends NpcArtPresentation {
  readonly url: string;
}
export interface NpcIdentityPresentation {
  readonly input: NpcEditorStages['NPC-002'];
  readonly errors: NpcFieldErrors<keyof NpcEditorStages['NPC-002']>;
  readonly artOrNull: NpcArtPresentation | null;
}
export interface NpcSchemaPresentation {
  readonly input: NpcEditorStages['NPC-011'];
  readonly errors: NpcFieldErrors<keyof NpcEditorStages['NPC-011']>;
  readonly races: readonly NpcChoice<RaceCode>[];
  readonly classes: readonly NpcChoice<ClassCode | null>[];
  readonly anatomies: readonly NpcChoice<string>[];
  readonly sexLabel: string;
  readonly massLabel: string;
  readonly massBoundsOrNull: Readonly<{
    minimum: number;
    maximum: number;
  }> | null;
  readonly registryVersion: string;
  readonly validationSummary: readonly string[];
}
export interface NpcStatPresentation {
  readonly input: NpcEditorStages['NPC-012'];
  readonly errors: NpcFieldErrors<StatCode>;
  readonly labels: Readonly<Record<StatCode, string>>;
  readonly perStatMinMax: Readonly<
    Record<StatCode, Readonly<{ minimum: number; maximum: number }>>
  >;
  /** Host-derived display only: the browser never recalculates or clips mechanics. */
  readonly derivedPreview: readonly NpcSheetRow[];
}
export interface NpcSheetRow {
  readonly label: string;
  readonly value: string;
}
export interface NpcLibraryRow {
  readonly npcUuid: string;
  readonly name: string;
  readonly currentVersion: number;
  readonly statusLabel: string;
  readonly affiliation: string;
  readonly campaignRole: string;
  readonly groupLabelOrNull: string | null;
  readonly locationLabelOrNull: string | null;
  readonly subLocationLabelOrNull: string | null;
  readonly sceneLabelOrNull: string | null;
  readonly artOrNull: NpcArtPresentation | null;
}
export type NpcLibraryFilterField =
  'statusLabel' | 'affiliation' | 'groupLabelOrNull' | 'sceneLabelOrNull';
export interface NpcLibraryPresentation {
  readonly rows: readonly NpcLibraryRow[];
  readonly selectedNpcUuidOrNull: string | null;
}
export const NPC_SHEET_SECTIONS = [
  'IDENTITY',
  'SCHEMA',
  'STATS',
  'SYMBIONTS',
  'SKILLS',
  'INVENTORY',
  'INITIAL_STATE',
] as const;
/** All seven source sections are mandatory. A missing section is not a successful full sheet. */
export interface NpcSheetPresentation {
  readonly npcUuid: string;
  readonly name: string;
  readonly displayedVersion: number;
  readonly currentVersion: number;
  readonly historyRevision: number;
  readonly artOrNull: NpcArtPresentation | null;
  readonly sections: Readonly<Record<(typeof NPC_SHEET_SECTIONS)[number], readonly NpcSheetRow[]>>;
  readonly pinnedCombatReferences: readonly Readonly<{
    label: string;
    version: number;
  }>[];
}
export interface NpcHistoryEntry {
  readonly version: number;
  readonly authorLabel: string;
  readonly timestampLabel: string;
  /** No new mandatory N+1 reason: an absent recorded reason remains absent. */
  readonly changeReasonOrNull: string | null;
}
export interface NpcHistoryPresentation {
  readonly npcUuid: string;
  readonly currentVersion: number;
  readonly entries: readonly NpcHistoryEntry[];
  readonly selectedVersionOrNull: number | null;
  readonly previewOrNull: NpcSheetPresentation | null;
}

export interface NpcSymbiontChoice extends NpcChoice<NpcSymbiontInput['speciesKey']> {
  readonly levels: readonly NpcChoice<number>[];
  readonly nodes: readonly Readonly<{
    value: string;
    label: string;
    requirementLabel: string;
    manualOnly: boolean;
  }>[];
  readonly bindings: readonly Readonly<{
    key: string;
    label: string;
    value: SymbiontBinding;
  }>[];
  readonly artOrNull: NpcSourceArtPresentation | null;
  readonly treeArtOrNull: NpcSourceArtPresentation | null;
}
/** Only host-issued capabilities render continuation buttons; these are not workflow IDs. */
interface NpcAvailableContinuationFields {
  readonly capabilityKey: string;
  readonly label: string;
  readonly explanation: string;
  readonly diceMode: 'NO_ROLL' | 'AUTO' | 'MANUAL';
  readonly rolls: readonly Readonly<{
    key: string;
    label: string;
    dieSides: 6 | 20;
    input: NpcDraftSection<number>;
    errors: readonly string[];
  }>[];
}
export type NpcAvailableContinuation = NpcAvailableContinuationFields &
  (
    | Readonly<{
        kind:
          | 'CONFIRM_COMPOSITION'
          | 'FREE_SLOT_ROLL'
          | 'ADVISER_IW_ROLLS'
          | 'ADVISER_SUPPRESSION_ROLL'
          | 'GROSS_SKILL_GRANT'
          | 'TROGR_STAT_CLOSURE';
      }>
    | Readonly<{
        kind: 'ADVISER_SKILLS';
        skills: Readonly<{
          choices: readonly (NpcChoice<string> &
            Readonly<{ requirementLabel: string; maxBonus: number }>)[];
          selected: readonly Readonly<{ skillKey: string; targetBonus: number }>[];
          errors: readonly string[];
        }>;
      }>
  );
export interface NpcSymbiontsPresentation {
  readonly input: NpcEditorStages['NPC-013'];
  readonly species: readonly NpcSymbiontChoice[];
  readonly canAdd: boolean;
  readonly errors: Readonly<Record<string, NpcFieldErrors<keyof NpcSymbiontEditorRow['input']>>>;
  readonly computedRows: Readonly<Record<string, readonly NpcSheetRow[]>>;
  readonly compositionSummary: readonly string[];
  readonly continuations: readonly NpcAvailableContinuation[];
}
export interface NpcSkillsPresentation {
  readonly input: NpcEditorStages['NPC-014'];
  readonly skills: readonly (NpcChoice<NpcSkillSelectionRequest['skillKey']> &
    Readonly<{ requirementLabel: string }>)[];
  readonly pools: readonly NpcChoice<NpcSkillSelectionRequest['pool']>[];
  readonly errors: readonly NpcFieldErrors<keyof NpcSkillSelectionRequest>[];
  readonly fixedSkills: readonly NpcSheetRow[];
  readonly poolUsage: readonly NpcSheetRow[];
  readonly validationSummary: readonly string[];
}

type CustomProfile = Extract<NpcItemProfileRequest, { kind: 'STRUCTURED_CUSTOM' }>;
export interface NpcInventoryChoices {
  readonly itemTypes: readonly NpcChoice<string>[];
  readonly profileKinds: readonly NpcChoice<NpcItemProfileRequest['kind']>[];
  readonly equippedSlots: readonly NpcChoice<string>[];
  readonly bodyZones: readonly NpcChoice<NpcInventoryRequestEntry['bodyZone']>[];
  readonly gripModes: readonly NpcChoice<NpcInventoryRequestEntry['gripMode']>[];
  readonly linkedSets: readonly NpcChoice<string | null>[];
  readonly componentRoles: readonly NpcChoice<NpcInventoryRequestEntry['componentRole']>[];
  readonly coatings: readonly NpcChoice<string>[];
  /** Existing host-prepared quality, not a client request to invent a roll result. */
  readonly qualityRolls: readonly NpcChoice<number | null>[];
  readonly qualityTiers?: readonly NpcChoice<NpcItemQualityTier | null>[];
  readonly clothingRegions?: readonly NpcChoice<ArmorBodyZone>[];
  readonly clothingHermetic?: readonly NpcChoice<NpcClothingProperties['hermetic']>[];
  readonly clothingFlammability?: readonly NpcChoice<NpcClothingProperties['flammability']>[];
  readonly weaponVariants: readonly NpcChoice<MasterWeaponProfileInput['weaponVariantId']>[];
  readonly dicePatterns: readonly NpcChoice<
    Extract<MasterWeaponProfileInput['damageDefinition'], { kind: 'MASTER_DICE' }>['pattern']
  >[];
  readonly heldSizes: readonly NpcChoice<CustomProfile['heldSizeClass']>[];
  readonly armorWeights: readonly NpcChoice<CustomProfile['armorWeightClass']>[];
  readonly flammabilities: readonly NpcChoice<CustomProfile['flammability']>[];
  readonly stats: readonly NpcChoice<StatCode>[];
}
export interface NpcEquipmentCompatibilityPreparation {
  readonly capabilityKey: string;
  readonly orderedItems: readonly Readonly<{ itemInstanceId: string; label: string }>[];
  readonly input: { readonly reason: NpcDraftSection<string> };
  readonly errors: readonly string[];
  readonly canSubmit: boolean;
  readonly explanation: string;
}
export interface NpcCompositeItemPreparation {
  readonly capabilityKey: string;
  readonly choices: readonly NpcChoice<NpcCompositeItemTypeId>[];
  readonly errors: readonly string[];
  readonly canSubmit: boolean;
  readonly explanation: string;
}
export interface NpcItemRestorePreparation {
  readonly capabilityKey: string;
  readonly choices: readonly NpcChoice<string>[];
  readonly canSubmit: boolean;
  readonly errors: readonly string[];
  readonly explanation: string;
}
/** Only host-owned physical items and profile versions may be offered for custom authoring. */
export interface NpcCustomInventoryPreparation {
  readonly capabilityKey: string;
  readonly canAdd: boolean;
  readonly modifierTargets: readonly Readonly<{ itemInstanceId: string; label: string }>[];
  readonly versionTargets: readonly Readonly<{
    itemInstanceId: string;
    profileId: string;
    profileVersionId: string;
    label: string;
  }>[];
  readonly backpackChoices: readonly NpcChoice<string>[];
  /** Reserved in this attempt; an immutable committed profile is never directly editable. */
  readonly editableProfileVersionIds: readonly string[];
  readonly errors: readonly string[];
  readonly explanation: string;
}
export interface NpcInventoryPresentation {
  readonly poisonCoatingPreparations?: readonly NpcPoisonCoatingPreparation[];
  readonly poisonCoatings?: readonly NpcPoisonCoatingState[];
  readonly input: NpcDraftSection<readonly NpcInventoryEditorRow[]>;
  readonly choices: NpcInventoryChoices;
  readonly canAdd: boolean;
  /** Exact field paths within each item/profile; messages are prepared by the host. */
  readonly errors: Readonly<Record<string, NpcFieldErrors<string>>>;
  readonly previewRows: Readonly<Record<string, readonly NpcSheetRow[]>>;
  readonly validationSummary: readonly string[];
  readonly compatibilityPreparationOrNull?: NpcEquipmentCompatibilityPreparation | null;
  readonly compositePreparationOrNull?: NpcCompositeItemPreparation | null;
  readonly restorePreparationOrNull?: NpcItemRestorePreparation | null;
  readonly customPreparationOrNull?: NpcCustomInventoryPreparation | null;
}

/** Presentation echoes a verified binding. No browser Date/clock conversion or time mutation. */
export interface NpcCalendarPresentation {
  readonly requiresCampaignTime: boolean;
  readonly validationStatus: 'NOT_REQUIRED' | 'MISSING' | 'CURRENT' | 'STALE';
  readonly bindingOrNull:
    | Readonly<{
        kind: 'PRE_START_INITIAL';
        campaignTimestamp: number;
        lobbySnapshotRevision: string;
      }>
    | Readonly<{ kind: 'CURRENT_CAMPAIGN'; campaignTimestamp: number; stateRevision: number }>
    | null;
  readonly initialTimeLockOrNull: Readonly<{
    campaignTimestamp: number;
    sourceNpcUuid: string;
    sourceVersion: number;
  }> | null;
  readonly messages: readonly string[];
}
export type NpcPreparedDiseaseId = NpcUntimedDiseaseId | 'DIS-PNEUMONIA';
/** Host reserves an owned selectable intent. Runtime effect/time/audit are created only at COMMIT. */
export interface NpcDiseasePreparation {
  readonly capabilityKey: string;
  readonly input: NpcDraftSection<NpcPreparedDiseaseId>;
  readonly choices: readonly NpcChoice<NpcPreparedDiseaseId>[];
  readonly errors: readonly string[];
  readonly canSubmit: boolean;
  readonly explanation: string;
}
/** Formal GM assignment; the host allocates and journals wound identity and provenance. */
export interface NpcWoundPreparationInput {
  readonly woundType: NpcDraftSection<NpcWoundInstance['woundType']>;
  readonly regionId: NpcDraftSection<ArmorBodyZone>;
  readonly damagePerTick: NpcDraftSection<number>;
}
export interface NpcWoundPreparation {
  readonly capabilityKey: string;
  readonly input: NpcWoundPreparationInput;
  readonly typeChoices: readonly NpcChoice<NpcWoundInstance['woundType']>[];
  readonly regionChoices: readonly NpcChoice<ArmorBodyZone>[];
  readonly errors: NpcFieldErrors<keyof NpcWoundPreparationInput>;
  readonly canSubmit: boolean;
  readonly explanation: string;
}

export interface NpcTraumaPreparation {
  readonly capabilityKey: string;
  readonly canSubmit: boolean;
  readonly explanation: string;
  readonly regions: readonly NpcChoice<ArmorBodyZone>[];
  readonly retainedIds: readonly string[];
  readonly errors: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}
export interface NpcAlcoholPreparation {
  readonly capabilityKey: string;
  readonly input: Readonly<{ reason: NpcDraftSection<string> }>;
  readonly errors: NpcFieldErrors<'reason'>;
  readonly canSubmit: boolean;
  readonly explanation: string;
  readonly derivedRows: readonly NpcSheetRow[];
}
export interface NpcHpModePreparation {
  readonly capabilityKey: string;
  readonly mode: 'HUNGER' | 'REGENERATION';
  readonly sourceLabel: string;
  readonly input: Readonly<{
    remainingMinutes: NpcDraftSection<string>;
    reason: NpcDraftSection<string>;
  }>;
  readonly maximumRemainingMinutes: string;
  readonly errors: NpcFieldErrors<'remainingMinutes' | 'reason'>;
  readonly canSubmit: boolean;
  readonly explanation: string;
  readonly derivedRows: readonly NpcSheetRow[];
}
export interface NpcFormalControlPreparation extends Omit<NpcHpModePreparation, 'mode'> {
  readonly controlKind: 'SLEEP' | 'PARALYSIS';
}
export interface NpcWeaverStatePreparation {
  readonly capabilityKey: string;
  readonly sourceInstanceId: string;
  readonly sourceLabel: string;
  readonly branchChoices: readonly (NpcChoice<NpcWeaverStateBranch> & {
    readonly maximumRemainingMinutes: string;
  })[];
  readonly input: Readonly<{
    branch: NpcDraftSection<NpcWeaverStateBranch>;
    remainingMinutes: NpcDraftSection<string>;
    reason: NpcDraftSection<string>;
  }>;
  readonly canSubmit: boolean;
  readonly errors: NpcFieldErrors<'branch' | 'remainingMinutes' | 'reason'>;
  readonly explanation: string;
  readonly derivedRows: readonly NpcSheetRow[];
}
export interface NpcWeaverCurrentState {
  readonly capabilityKey: string;
  readonly effectInstanceId: string;
  readonly sourceLabel: string;
  readonly branch: NpcWeaverStateBranch;
  readonly canRemove: boolean;
  readonly errors: readonly string[];
  readonly explanation: string;
  readonly derivedRows: readonly NpcSheetRow[];
}
export interface NpcPoisonModePreparation {
  readonly capabilityKey: string;
  readonly sourceInstanceId: string;
  readonly sourceLabel: string;
  readonly profileChoices: readonly NpcChoice<NpcTaipanPoisonProfileId>[];
  readonly input: Readonly<{
    poisonProfileId: NpcDraftSection<NpcTaipanPoisonProfileId>;
    reason: NpcDraftSection<string>;
  }>;
  readonly canSubmit: boolean;
  readonly errors: NpcFieldErrors<'poisonProfileId' | 'reason'>;
  readonly explanation: string;
  readonly derivedRows: readonly NpcSheetRow[];
}
export interface NpcPoisonModeState {
  readonly sourceInstanceId: string;
  readonly modeFactId: string;
  readonly sourceLabel: string;
  readonly poisonProfileId: NpcTaipanPoisonProfileId;
  readonly explanation: string;
  readonly derivedRows: readonly NpcSheetRow[];
}
/** One offered capability identifies a real source/carrier/component pair, including replacement. */
export interface NpcPoisonCoatingPreparation {
  readonly capabilityKey: string;
  readonly sourceInstanceId: string;
  readonly sourceLabel: string;
  readonly targetItemInstanceId: string;
  readonly targetLabel: string;
  readonly surfaceLabel: string;
  readonly replacesCoatingIdOrNull: string | null;
  readonly input: Readonly<{
    surfaceConfirmed: NpcDraftSection<boolean>;
    replaceConfirmed: NpcDraftSection<boolean>;
    reason: NpcDraftSection<string>;
  }>;
  readonly canSubmit: boolean;
  readonly errors: NpcFieldErrors<'surfaceConfirmed' | 'replaceConfirmed' | 'reason'>;
  readonly explanation: string;
  readonly derivedRows: readonly NpcSheetRow[];
}
export interface NpcPoisonCoatingState {
  readonly capabilityKey: string;
  readonly coatingInstanceId: string;
  readonly targetItemInstanceId: string;
  readonly targetLabel: string;
  readonly canRemove: boolean;
  readonly errors: readonly string[];
  readonly explanation: string;
  readonly derivedRows: readonly NpcSheetRow[];
}
export interface NpcLifeStatePreparation {
  readonly capabilityKey: string;
  readonly canRoll: boolean;
  readonly canSubmit: boolean;
  readonly diceMode: 'AUTO' | 'MANUAL';
  readonly lifeChoices: readonly NpcChoice<'ALIVE' | 'SEVERELY_WOUNDED' | 'DEAD'>[];
  readonly input: Readonly<{
    lifeKind: NpcDraftSection<'ALIVE' | 'SEVERELY_WOUNDED' | 'DEAD'>;
    reason: NpcDraftSection<string>;
    remainingMinutes: NpcDraftSection<string>;
  }>;
  readonly retainedTimer: boolean;
  readonly rollOrNull: Readonly<{
    rawFace: number;
    mode: 'AUTO' | 'MANUAL';
    receiptId: string;
  }> | null;
  readonly maximumRemainingMinutesOrNull: string | null;
  readonly errors: NpcFieldErrors<'lifeKind' | 'reason' | 'remainingMinutes' | 'manualFace'>;
  readonly explanation: string;
  readonly derivedRows: readonly NpcSheetRow[];
}
export interface NpcInitialStatePresentation {
  readonly input: NpcEditorStages['NPC-016'];
  readonly errors: NpcFieldErrors<keyof NpcEditorStages['NPC-016']['input']>;
  /** Same host-owned composition identities/current OE as NPC-013, never a second runtime copy. */
  readonly symbionts: readonly Readonly<{
    symbiontInstanceId: string;
    label: string;
    currentOE: NpcDraftSection<number>;
    maximumOrNull: number | null;
    errors: readonly string[];
  }>[];
  readonly choices: Readonly<{
    effectInstanceIds: readonly NpcChoice<string>[];
    traumaInstanceIds: readonly NpcChoice<string>[];
    woundInstanceIds: readonly NpcChoice<string>[];
    sourceSpecificStateFactIds: readonly NpcChoice<string>[];
    deathConsequenceFactIdOrNull: readonly NpcChoice<string | null>[];
  }>;
  readonly derivedRows: readonly NpcSheetRow[];
  readonly calendar: NpcCalendarPresentation;
  readonly diseasePreparationOrNull: NpcDiseasePreparation | null;
  readonly traumaPreparationOrNull: NpcTraumaPreparation | null;
  readonly woundPreparationOrNull: NpcWoundPreparation | null;
  /** Legacy absence means no capability, never an implicit successful assignment. */
  readonly alcoholPreparationOrNull?: NpcAlcoholPreparation | null;
  readonly hpModePreparations?: readonly NpcHpModePreparation[];
  readonly formalControlPreparations?: readonly NpcFormalControlPreparation[];
  readonly lifeStatePreparationOrNull?: NpcLifeStatePreparation | null;
  readonly temporaryWeaverStatePreparations?: readonly NpcWeaverStatePreparation[];
  readonly temporaryWeaverStates?: readonly NpcWeaverCurrentState[];
  readonly poisonModePreparations?: readonly NpcPoisonModePreparation[];
  readonly poisonModeStates?: readonly NpcPoisonModeState[];
  /** Missing handlers/source decisions remain explicit blockers, not completed empty mechanics. */
  readonly preparationBlockers: readonly string[];
  readonly validationSummary: readonly string[];
}

export const NPC_VALIDATION_STAGE_IDS = [
  'NPC-002',
  'NPC-011',
  'NPC-012',
  'NPC-013',
  'NPC-014',
  'NPC-015',
  'NPC-016',
  'NPC-017',
] as const;
export type NpcFullSheetPreview = Pick<
  NpcSheetPresentation,
  'name' | 'artOrNull' | 'sections' | 'pinnedCombatReferences'
>;
export interface NpcFinalReviewPresentation {
  /** No fabricated saved UUID/history/version for an uncommitted CREATE preview. */
  readonly binding:
    | Readonly<{
        editMode: 'CREATE_V1';
        attemptRevision: number;
        versionBindingOrNull: null;
        resultVersion: 1;
      }>
    | Readonly<{
        editMode: 'APPEND_N_PLUS_ONE';
        attemptRevision: number;
        versionBindingOrNull: Readonly<{ npcUuid: string; expectedCurrentVersion: number }>;
        resultVersion: number;
      }>;
  readonly previewOrNull: NpcFullSheetPreview | null;
  readonly stages: Readonly<
    Record<
      (typeof NPC_VALIDATION_STAGE_IDS)[number],
      Readonly<{
        label: string;
        status: 'INCOMPLETE' | 'INVALID' | 'VALID';
        messages: readonly string[];
      }>
    >
  >;
  readonly fullValidationStatus: 'INCOMPLETE' | 'INVALID' | 'VALID';
  readonly validationErrors: readonly string[];
  readonly calendar: NpcCalendarPresentation;
  readonly commitStatusLabel: string;
  readonly receiptOrNull: Readonly<{
    npcUuid: string;
    version: number;
    historyEntryLabel: string;
  }> | null;
}

/** Stable display keys require actual fields, rather than an arbitrary single 'OK' row. */
export const NPC_FULL_SHEET_FIELDS = {
  IDENTITY: ['name', 'description', 'sex', 'massKg', 'affiliation', 'campaignRole'],
  SCHEMA: ['raceCode', 'pureClassOrNull', 'anatomyProfileId'],
  STATS: ['baseStats', 'skillStageStats', 'permanentStats', 'equippedStats', 'effectiveStats'],
  SYMBIONTS: ['instances', 'interactions', 'currentOE', 'maxOE'],
  SKILLS: ['learnedSkills', 'slotUsage'],
  INVENTORY: ['items', 'profiles', 'equipment'],
  INITIAL_STATE: [
    'currentHP',
    'maxHP',
    'derivedCondition',
    'initialActionState',
    'effects',
    'traumas',
    'wounds',
    'sourceSpecificState',
  ],
} as const;
export interface NpcWireSheetRow extends NpcSheetRow {
  readonly fieldKey: string;
}
export type NpcWireSections = Readonly<
  Record<(typeof NPC_SHEET_SECTIONS)[number], readonly NpcWireSheetRow[]>
>;
export interface NpcWireSheet extends Omit<NpcSheetPresentation, 'sections'> {
  readonly sections: NpcWireSections;
  readonly returnContext: 'NPC_ADMIN';
  readonly sourceCombatIdOrNull: null;
  readonly dispositionReceiptIdOrNull: null;
  readonly pinnedCombatVersionOrNull: null;
}
export interface NpcWireLibraryRow extends NpcLibraryRow {
  readonly groupIdOrNull: string | null;
  readonly locationIdOrNull: string | null;
  readonly subLocationIdOrNull: string | null;
  readonly markerRevisionOrNull: number | null;
  readonly sceneIdOrNull: string | null;
}
export interface NpcProjectionAttempt {
  readonly npcDraftId: string;
  readonly candidateNpcUuid: string;
  readonly attemptRevision: number;
  readonly draftRevision: number;
  readonly stage: (typeof NPC_VALIDATION_STAGE_IDS)[number];
  readonly editMode: 'CREATE_V1' | 'APPEND_N_PLUS_ONE';
  readonly versionBindingOrNull: Readonly<{
    npcUuid: string;
    expectedCurrentVersion: number;
  }> | null;
}
export interface NpcProjectionScope {
  readonly projectionRole: 'gm';
  readonly contextId: string;
  readonly campaignId: string;
  readonly stateRevision: number;
  readonly projectionRevision: number;
  readonly actorVisibilityRevision: number;
}
export interface NpcLobbyProjectionFields {
  readonly initialTimeLockOrNull: NpcCalendarPresentation['initialTimeLockOrNull'];
  readonly npcInitialTimeReturnContextOrNull: Readonly<{
    campaignId: string;
    npcDraftId: string;
    attemptRevision: number;
    editMode: 'CREATE_V1' | 'APPEND_N_PLUS_ONE';
    versionBindingOrNull: Readonly<{ npcUuid: string; expectedCurrentVersion: number }> | null;
    returnFormId: 'NPC-016';
  }> | null;
}
export interface NpcProjectionContentByForm {
  readonly 'NPC-001': Omit<NpcLibraryPresentation, 'rows'> & {
    readonly rows: readonly NpcWireLibraryRow[];
  };
  readonly 'NPC-002': NpcIdentityPresentation;
  readonly 'NPC-003': NpcWireSheet;
  readonly 'NPC-007': Omit<NpcHistoryPresentation, 'previewOrNull'> & {
    readonly previewOrNull: NpcWireSheet | null;
  };
  readonly 'NPC-011': NpcSchemaPresentation;
  readonly 'NPC-012': NpcStatPresentation & { readonly noTotalStatCap: true };
  readonly 'NPC-013': NpcSymbiontsPresentation;
  readonly 'NPC-014': NpcSkillsPresentation;
  readonly 'NPC-015': NpcInventoryPresentation;
  readonly 'NPC-016': NpcInitialStatePresentation;
  readonly 'NPC-017': Omit<NpcFinalReviewPresentation, 'previewOrNull'> & {
    /** The real reserved identity, not an already committed entity/history. */
    readonly npcUuidOnCommit: string;
    readonly previewOrNull:
      (Omit<NpcFullSheetPreview, 'sections'> & { readonly sections: NpcWireSections }) | null;
  };
}
export type NpcGmProjection = {
  [F in keyof NpcProjectionContentByForm]: NpcProjectionScope &
    Readonly<{
      formId: F;
      campaignStatus: 'PAUSED' | 'HOSTING';
      campaignPhase: 'PRE_START' | 'STARTED';
      libraryRevision: number;
      attemptOrNull: NpcProjectionAttempt | null;
      content: NpcProjectionContentByForm[F];
    }>;
}[keyof NpcProjectionContentByForm];

/** Read correlation only: no durable operation, workflow identity or gameplay authority. */
export type NpcArtReadTarget =
  | Readonly<{ kind: 'ATTEMPT'; npcDraftId: string; expectedAttemptRevision: number }>
  | Readonly<{ kind: 'VERSION'; npcUuid: string; version: number }>;
export interface NpcArtReadBinding {
  readonly protocolVersion: 3;
  readonly requestId: string;
  readonly contextId: string;
  readonly campaignId: string;
  readonly sourceFormId: 'NPC-001' | 'NPC-002' | 'NPC-003' | 'NPC-007' | 'NPC-017';
  readonly expectedRevisions: Readonly<{
    stateRevision: number;
    projectionRevision: number;
    actorVisibilityRevision: number;
  }>;
  readonly target: NpcArtReadTarget;
  readonly assetKey: string;
  readonly checksum: string;
}
export interface NpcArtReadRequest extends NpcArtReadBinding {
  readonly messageType: 'network.npc-art.read';
}
export interface NpcArtReadResult extends NpcArtReadBinding {
  readonly messageType: 'network.npc-art.result';
  readonly mediaType: 'image/png' | 'image/jpeg';
  readonly bytesBase64: string;
}
export interface NpcArtReadRefusal extends NpcArtReadBinding {
  readonly messageType: 'network.npc-art.refusal';
  /** No raw input, current head, authority identity or private exception text. */
  readonly code: 'NOT_AVAILABLE' | 'STALE_REQUEST' | 'INVALID_REQUEST';
}
export type NpcArtReadMessage = NpcArtReadRequest | NpcArtReadResult | NpcArtReadRefusal;
