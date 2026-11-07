/**
 * Serialized NPC editor/display shapes only. They carry no domain validation proof.
 * Owning host readers validate every echoed choice; the browser never derives mechanics.
 * tools/npc-presentation-contract.test.ts ties these closed shapes to their source types.
 */
import type { NPC_DISEASE_IDS, NpcWoundPreparationRequestInput } from './npc-command.js';

export type NpcStatCode = 'C' | 'D' | 'I' | 'M' | 'S' | 'W' | 'Z';

export type NpcRaceCode = 'FREE' | 'PURE' | 'UNITED';

export type NpcClassCode = 'SEEKER' | 'SOLDIER' | 'STALKER';

export type NpcBodyZone = NpcWoundPreparationRequestInput['regionId'];
export type NpcWoundType = NpcWoundPreparationRequestInput['woundType'];
export type NpcUntimedDiseaseId = Exclude<
  (typeof NPC_DISEASE_IDS)[number],
  'DIS-PNEUMONIA' | 'DIS-PESTILENCE'
>;
export type NpcStartingWeaponVariant =
  'DEFAULT' | 'ONE_HAND' | 'TWO_HAND' | 'SWORD' | 'SHIELD' | 'RAPIER';
export type NpcSymbiontSpeciesKey =
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
type SymbiontSide = 'LEFT' | 'RIGHT';
type StatBlock = Readonly<Record<NpcStatCode, number>>;

export type NpcSymbiontBinding =
  | Readonly<{ kind: 'NONE' }>
  | Readonly<{ kind: 'OWL_EYE'; side: SymbiontSide }>
  | Readonly<{ kind: 'EEL_ARM'; side: SymbiontSide }>
  | Readonly<{ kind: 'TICK_RIGHT_HAND' }>
  | Readonly<{ kind: 'SPIDER_BOTH_WRISTS' }>
  | Readonly<{ kind: 'MANTIS_BOTH_FOREARMS' }>;

export type NpcDraftSection<T> =
  Readonly<{ kind: 'UNSET' }> | Readonly<{ kind: 'ENTERED'; value: T }>;

export interface NpcIdentityInput {
  readonly name: string;
  readonly description: string | null;
  readonly affiliation: string;
  readonly campaignRole: string;
  readonly raceCode: NpcRaceCode;
  readonly pureClassOrNull: NpcClassCode | null;
  readonly sex: 'MALE' | 'FEMALE';
  readonly massKg: number;
  readonly anatomyProfileId: string;
  readonly artAssetKeyOrNull: string | null;
}

export type NpcIdentityStageInput = Readonly<
  Pick<
    NpcIdentityInput,
    'name' | 'description' | 'affiliation' | 'campaignRole' | 'sex' | 'massKg' | 'artAssetKeyOrNull'
  >
>;

export type NpcSchemaStageInput = Readonly<
  Pick<NpcIdentityInput, 'raceCode' | 'pureClassOrNull' | 'anatomyProfileId'>
>;

export interface NpcSymbiontInput {
  readonly symbiontInstanceId: string;
  readonly speciesKey: NpcSymbiontSpeciesKey;
  readonly targetLevel: number;
  readonly learnedNodeRefs: readonly string[];
  readonly binding: NpcSymbiontBinding;
  readonly currentOE: number;
}

export type NpcMasterWeaponExpression =
  | Readonly<{ kind: 'RETAIN' }>
  | Readonly<{
      kind: 'MASTER_DICE';
      pattern: 'R4' | 'R4+X' | 'R6' | 'R6+X' | 'R12' | 'R12+X' | 'R20+X' | 'R20*2+X';
      constantOrNull: number | null;
    }>;

export interface NpcMasterWeaponProfileInput {
  readonly weaponVariantId: NpcStartingWeaponVariant;
  readonly damageDefinition: NpcMasterWeaponExpression;
  readonly penetrationDefinition: NpcMasterWeaponExpression;
  readonly statRequirements: Readonly<Partial<Record<NpcStatCode, number>>>;
  readonly instanceDamageOrNull: number | null;
  readonly rangeMetersOrNull: number | null;
  readonly accuracyBonusOrNull: number | null;
}

export type NpcItemProfileRequest =
  | Readonly<{ kind: 'CATALOG' }>
  | Readonly<{
      kind: 'MASTER_WEAPON';
      inputs: readonly NpcMasterWeaponProfileInput[];
      reason: string;
    }>
  | Readonly<{
      kind: 'STRUCTURED_CUSTOM';
      name: string;
      description: string;
      customBonusOrNull: Readonly<{
        customBonusStat: NpcStatCode;
        customBonusValue: number;
        activeOnlyInBackpack: true;
      }> | null;
      massKg: number | null;
      heldSizeClass: 'FITS_IN_FIST' | 'LARGE' | 'UNKNOWN';
      armorWeightClass: 'LIGHT' | 'OTHER' | 'UNKNOWN';
      flammability: 'COMBUSTIBLE' | 'NONCOMBUSTIBLE' | 'UNKNOWN';
      isIgnitionSource: boolean;
      isFood: boolean;
      canReceivePoison: boolean;
      canReceiveFlammableCoating: boolean;
    }>;

export type NpcStructuredCustomProfile = Extract<
  NpcItemProfileRequest,
  { kind: 'STRUCTURED_CUSTOM' }
>;

export interface NpcCustomProfileVersionReference {
  readonly profileId: string;
  readonly profileVersionId: string;
  readonly version: number;
  readonly reservationOperationId: string;
}

export interface NpcCampaignCustomProfileReference extends NpcCustomProfileVersionReference {
  readonly kind: 'CAMPAIGN_CUSTOM_PROFILE';
}

export interface NpcCatalogueCustomModifierReference extends NpcCustomProfileVersionReference {
  readonly kind: 'CATALOG_CUSTOM_MODIFIER';
}

export type NpcCustomBonusContainerBinding =
  | Readonly<{ kind: 'NOT_APPLICABLE' }>
  | Readonly<{ kind: 'OUTSIDE_BACKPACK' }>
  | Readonly<{ kind: 'BACKPACK'; backpackItemInstanceId: string }>;

export interface NpcCatalogueCustomModifierRequest {
  readonly reference: NpcCatalogueCustomModifierReference;
  readonly profile: NpcStructuredCustomProfile;
  readonly bonusContainerBinding: NpcCustomBonusContainerBinding;
  readonly reason: string;
}

export type NpcItemQualityTier =
  'MISSING_OR_UNFIT' | 'POOR' | 'ORDINARY' | 'GOOD' | 'EXCEPTIONAL' | 'RARE';

export interface NpcClothingProperties {
  readonly coveredRegionIds: readonly NpcBodyZone[];
  readonly hermetic: boolean | 'UNKNOWN';
  readonly flammability: 'COMBUSTIBLE' | 'NONCOMBUSTIBLE' | 'UNKNOWN';
}

export interface NpcInventoryMetadata {
  readonly qualityTier?: NpcItemQualityTier | null;
  readonly clothingProperties?: NpcClothingProperties;
}

export interface NpcCatalogueInventoryRequestEntry extends NpcInventoryMetadata {
  readonly itemInstanceId: string;
  readonly itemTypeId: string;
  readonly quantity: number;
  readonly profile: NpcItemProfileRequest;
  readonly equipped: boolean;
  readonly equippedSlots: readonly string[];
  readonly bodyZone: NpcBodyZone | null;
  readonly gripMode: 'ONE_HAND' | 'TWO_HAND' | null;
  readonly currentAmmo: number | null;
  readonly shieldCurrentHP: number | null;
  readonly broken: boolean;
  readonly sealed: boolean | null;
  readonly linkedSetInstanceId: string | null;
  readonly componentRole: 'SWORD' | 'RAPIER' | 'SHIELD' | null;
  readonly qualityRoll: number | null;
  readonly coatingInstanceIds: readonly string[];
  readonly issueReason: string;
  /** Absence is the exact historical catalogue shape, never an implicit new modifier. */
  readonly customModifier?: NpcCatalogueCustomModifierRequest;
}

export interface NpcCampaignCustomInventoryRequestEntry extends Omit<
  NpcCatalogueInventoryRequestEntry,
  'itemTypeId' | 'profile' | 'customModifier'
> {
  readonly itemTypeId: null;
  readonly itemTypeReference: NpcCampaignCustomProfileReference;
  readonly profile: NpcStructuredCustomProfile;
  readonly bonusContainerBinding: NpcCustomBonusContainerBinding;
  readonly customProfileReason: string;
}

export type NpcInventoryRequestEntry =
  NpcCatalogueInventoryRequestEntry | NpcCampaignCustomInventoryRequestEntry;

export type NpcEnteredFields<T> = { readonly [K in keyof T]: NpcDraftSection<T[K]> };

export interface NpcSymbiontEditorRow {
  /** Assigned by the owning attempt; existence/ownership is checked by the host. */
  readonly symbiontInstanceId: string;
  readonly input: NpcEnteredFields<Omit<NpcSymbiontInput, 'symbiontInstanceId'>>;
}

/** A serialized key is not the host-only branded result of catalog validation. */
export interface NpcSkillSelectionRequest {
  readonly skillKey: string;
  readonly targetBonus: number;
  readonly pool: 'START' | 'TRAINING' | 'SYM-166';
}

export interface NpcTraumaEditorRow {
  readonly traumaInstanceId: string;
  readonly input: NpcEnteredFields<{
    regionId: NpcBodyZone;
    traumaValue: number;
    reason: string;
  }>;
  readonly head: NpcDraftSection<{
    readonly penalty: NpcDraftSection<'PENDING' | 'CONSUMED'>;
    readonly stun: NpcDraftSection<
      | Readonly<{ status: 'ABSENT' }>
      | Readonly<{ status: 'ACTIVE'; remainingMinutes: NpcDraftSection<string> }>
    >;
  }>;
}

export interface NpcInitialStateEditorInput {
  readonly currentHP: number;
  readonly effectInstanceIds: readonly string[];
  readonly traumaInstanceIds: readonly string[];
  readonly woundInstanceIds: readonly string[];
  readonly sourceSpecificStateFactIds: readonly string[];
  readonly deathConsequenceFactIdOrNull: string | null;
  readonly lifeStateConfirmationId?: string;
  readonly weaverEffectInstanceIds?: readonly string[];
  readonly poisonModeFactIds?: readonly string[];
  /** Absent only in the exact legacy no-trauma shape; old bytes are not normalized. */
  readonly traumaInputs?: readonly NpcTraumaEditorRow[];
}

export type NpcInitialStateFields = NpcEnteredFields<
  Omit<
    NpcInitialStateEditorInput,
    'traumaInputs' | 'lifeStateConfirmationId' | 'weaverEffectInstanceIds' | 'poisonModeFactIds'
  >
> &
  Readonly<{
    traumaInputs?: NpcDraftSection<readonly NpcTraumaEditorRow[]>;
    lifeStateConfirmationId?: NpcDraftSection<string>;
    weaverEffectInstanceIds?: NpcDraftSection<readonly string[]>;
    poisonModeFactIds?: NpcDraftSection<readonly string[]>;
  }>;

export interface NpcInitialStageRequest {
  readonly input: NpcInitialStateFields;
  /** NPC-013 and NPC-016 edit the same stored OE field, not two competing copies. */
  readonly currentOeChanges: readonly Readonly<{
    symbiontInstanceId: string;
    currentOE: NpcDraftSection<number>;
  }>[];
}

type CustomProfile = Extract<NpcItemProfileRequest, { kind: 'STRUCTURED_CUSTOM' }>;

export type NpcDiceEditor =
  | Readonly<{ kind: 'RETAIN' }>
  | Readonly<{
      kind: 'MASTER_DICE';
      pattern: NpcDraftSection<
        Extract<NpcMasterWeaponProfileInput['damageDefinition'], { kind: 'MASTER_DICE' }>['pattern']
      >;
      constantOrNull: NpcDraftSection<number | null>;
    }>;

export interface NpcMasterWeaponEditor {
  readonly input: NpcEnteredFields<
    Pick<
      NpcMasterWeaponProfileInput,
      'weaponVariantId' | 'instanceDamageOrNull' | 'rangeMetersOrNull' | 'accuracyBonusOrNull'
    >
  >;
  readonly damageDefinition: NpcDraftSection<NpcDiceEditor>;
  readonly penetrationDefinition: NpcDraftSection<NpcDiceEditor>;
  readonly statRequirements: Readonly<Record<NpcStatCode, NpcDraftSection<number | null>>>;
}

export type NpcItemProfileEditor =
  | Readonly<{ kind: 'CATALOG' }>
  | Readonly<{
      kind: 'MASTER_WEAPON';
      reason: NpcDraftSection<string>;
      inputs: readonly NpcMasterWeaponEditor[];
    }>
  | Readonly<{
      kind: 'STRUCTURED_CUSTOM';
      input: NpcEnteredFields<Omit<CustomProfile, 'kind' | 'customBonusOrNull'>>;
      customBonusOrNull: NpcDraftSection<null | NpcEnteredFields<{
        customBonusStat: NpcStatCode;
        customBonusValue: number;
      }>>;
    }>;

export interface NpcCatalogueCustomModifierEditor {
  readonly reference: NpcDraftSection<NpcCatalogueCustomModifierReference>;
  readonly profile: NpcDraftSection<Extract<NpcItemProfileEditor, { kind: 'STRUCTURED_CUSTOM' }>>;
  readonly bonusContainerBinding: NpcDraftSection<NpcCustomBonusContainerBinding>;
  readonly reason: NpcDraftSection<string>;
}

export type NpcCatalogueInventoryEditorInput = NpcEnteredFields<
  Omit<
    NpcCatalogueInventoryRequestEntry,
    'itemInstanceId' | 'profile' | 'customModifier' | 'qualityTier' | 'clothingProperties'
  >
>;

export interface NpcInventoryMetadataEditor {
  readonly qualityTier?: NpcDraftSection<NpcItemQualityTier | null>;
  readonly clothingProperties?: NpcDraftSection<NpcEnteredFields<NpcClothingProperties>>;
}

export interface NpcCatalogueInventoryEditorRow extends NpcInventoryMetadataEditor {
  readonly itemInstanceId: string;
  readonly input: NpcCatalogueInventoryEditorInput;
  readonly profile: NpcDraftSection<NpcItemProfileEditor>;
  readonly customModifier?: NpcCatalogueCustomModifierEditor;
}

export interface NpcCampaignCustomInventoryEditorRow extends NpcInventoryMetadataEditor {
  readonly itemInstanceId: string;
  readonly input: Omit<NpcCatalogueInventoryEditorInput, 'itemTypeId'> &
    Readonly<{ itemTypeId: NpcDraftSection<null> }>;
  readonly itemTypeReference: NpcDraftSection<NpcCampaignCustomProfileReference>;
  readonly profile: NpcDraftSection<Extract<NpcItemProfileEditor, { kind: 'STRUCTURED_CUSTOM' }>>;
  readonly bonusContainerBinding: NpcDraftSection<NpcCustomBonusContainerBinding>;
  readonly customProfileReason: NpcDraftSection<string>;
}

export type NpcInventoryEditorRow =
  NpcCatalogueInventoryEditorRow | NpcCampaignCustomInventoryEditorRow;

export interface NpcEditorStages {
  readonly 'NPC-002': NpcEnteredFields<NpcIdentityStageInput>;
  readonly 'NPC-011': NpcEnteredFields<NpcSchemaStageInput>;
  readonly 'NPC-012': NpcEnteredFields<StatBlock>;
  readonly 'NPC-013': NpcDraftSection<readonly NpcSymbiontEditorRow[]>;
  readonly 'NPC-014': NpcDraftSection<readonly NpcEnteredFields<NpcSkillSelectionRequest>[]>;
  readonly 'NPC-015': NpcDraftSection<readonly NpcInventoryEditorRow[]>;
  readonly 'NPC-016': NpcInitialStageRequest;
  readonly 'NPC-017': Readonly<Record<string, never>>;
}
