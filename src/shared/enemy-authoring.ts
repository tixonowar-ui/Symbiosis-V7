import type { ActionKey } from '@generated/types/atlas.js';
import type {
  JsonObject,
  JsonValue,
  RevisionVector,
  WorkflowCommandRequestMessage,
  CommandReceipt,
} from './wire-protocol.js';
import type { NpcCatalogueInventoryRequestEntry } from './npc-editor-presentation.js';
import { admissionCodecReaders as r, admissionJsonEqual } from './campaign-admission-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import {
  enemyComposedCompositionValue,
  enemyCompositionAcquisitionsValue,
  enemyCompositionPatchValue,
  type EnemyComposedComposition,
  type EnemyCompositionAcquisitions,
} from './enemy-composition.js';
import {
  enemyCompositionCatalogShape,
  enemyCompositionFactsShape,
  enemyCompositionSkillBindings,
  enemyCompositionBindings,
} from './enemy-composition-presentation.js';
import {
  emptyEnemySkillPlanState,
  enemySkillPlanStateValue,
  enemySkillRebuildPreviewValue,
  enemyBuildPlanPatchValue,
  enemySkillPlanCatalogBindings,
  type EnemySkillPlanState,
  type EnemySkillRebuildPreview,
} from './enemy-skill-plan.js';
import { CUSTOM_MONSTER_PLACEHOLDER, CUSTOM_MONSTER_PLACEHOLDER_SHA256 } from './custom-monster.js';
import {
  CUSTOM_MONSTER_STAGE_FORMS,
  customMonsterAttemptValue,
  preparedCustomMonsterCompositionValue,
  preparedMonsterKnowledgeValue,
  reduceCustomMonsterAttempt,
  type CustomMonsterAttempt,
  type CustomMonsterVersionIdentity,
  type PreparedCustomMonsterComposition,
  type PreparedMonsterKnowledge,
} from './custom-monster-state.js';
import {
  customMonsterProjectionValue,
  type CustomMonsterProjection,
} from './custom-monster-presentation.js';

export const SENTIENT_ENEMY_AUTHORING_FORMS = [
  'ENM-005',
  'ENM-006',
  'ENM-007',
  'ENM-008',
  'ENM-009',
  'ENM-010',
  'ENM-020',
] as const;
export const ENEMY_AUTHORING_FORMS = [
  'ENM-005',
  'ENM-006',
  'ENM-007',
  'ENM-008',
  'ENM-009',
  'ENM-010',
  'ENM-011',
  'ENM-012',
  'ENM-013',
  'ENM-014',
  'ENM-015',
  'ENM-016',
  'ENM-020',
] as const;
export type EnemyAuthoringForm = (typeof ENEMY_AUTHORING_FORMS)[number];
export const isSentientEnemyAuthoringForm = (
  value: string,
): value is SentientEnemyAuthoringProjection['formId'] =>
  (SENTIENT_ENEMY_AUTHORING_FORMS as readonly string[]).includes(value);
export const isEnemyAuthoringForm = (value: string): value is EnemyAuthoringForm =>
  (ENEMY_AUTHORING_FORMS as readonly string[]).includes(value);
export const ENEMY_AUTHORING_WORKFLOWS = [
  'UI-CMD-ENEMY-DRAFT-PATCH',
  'UI-CMD-ENEMY-COMMIT-V1',
] as const;
export const ENEMY_STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
export type EnemyStats = Readonly<Record<(typeof ENEMY_STATS)[number], number>>;
export const ENEMY_PLACEHOLDER = 'symbiosis_placeholder_sentient_enemy' as const;
/** ADR0077 A, supplied SENTIENT PNG; #261 will introduce a separate upload grammar. */
export const ENEMY_PLACEHOLDER_SHA256 =
  '5da7ee70db7c47dabfa92522e5bc8c9855c8a0c7596764d00b8b24cebd570a3f';
export interface EnemyIdentity {
  readonly name: string;
  readonly description: string | null;
  readonly origin: string;
  readonly affiliation: string;
  readonly massKg: number;
  readonly anatomyProfileId: 'ORDINARY_SENTIENT';
}
export interface EnemyBuild {
  readonly raceCode: 'PURE' | 'FREE' | 'UNITED';
  readonly pureClassOrNull: 'SEEKER' | 'STALKER' | 'SOLDIER' | null;
  readonly skillSelections: readonly { readonly skillKey: string; readonly targetBonus: number }[];
}
/** A row is a template input. The host separately allocates immutable template-item keys. */
export type EnemyItemInput = Omit<
  NpcCatalogueInventoryRequestEntry,
  'itemInstanceId' | 'customModifier'
>;
export interface EnemyInventory {
  readonly inventoryItems: readonly EnemyItemInput[];
  readonly armorCompatibilityReasonOrNull: string | null;
}
export interface EnemyEmptyComposition {
  readonly symbiontCompositionMode: 'ORDINARY_SYMBIONTS';
  readonly ordinarySymbiontInstances: readonly never[];
  readonly symbioticMonsterProfileIdOrNull: null;
}
export type EnemyComposition = EnemyEmptyComposition | EnemyComposedComposition;
export interface EnemyAttempt {
  readonly schemaVersion?: 2;
  readonly skillPlanState?: EnemySkillPlanState;
  readonly legacySkillPlanPreview?: EnemySkillRebuildPreview;
  readonly attemptId: string;
  readonly campaignId: string;
  readonly kind: 'SENTIENT';
  readonly revision: number;
  readonly identityOrNull: EnemyIdentity | null;
  readonly baseStatsOrNull: EnemyStats | null;
  readonly buildOrNull: EnemyBuild | null;
  readonly compositionOrNull: EnemyComposition | null;
  readonly inventoryOrNull: EnemyInventory | null;
  readonly itemTemplateKeys: readonly string[];
  readonly compositionAcquisitions?: EnemyCompositionAcquisitions;
}
export interface SentientEnemyVersionIdentity {
  readonly campaignId: string;
  readonly templateId: string;
  readonly versionId: string;
  readonly version: 1;
  readonly kind: 'SENTIENT';
  readonly artAssetKey: typeof ENEMY_PLACEHOLDER;
  readonly artSha256: string;
}
export type EnemyVersionIdentity = SentientEnemyVersionIdentity | CustomMonsterVersionIdentity;
export type EnemyAuthoringAttempt = EnemyAttempt | CustomMonsterAttempt;
export interface EnemyAuthoringContext {
  readonly attemptOrNull: EnemyAuthoringAttempt | null;
  readonly selectedVersionOrNull: EnemyVersionIdentity | null;
}
export type EnemyUserEntry = EnemyVersionIdentity & { readonly displayName: string };
export type EnemyPatchStage =
  | 'SENTIENT_IDENTITY'
  | 'SENTIENT_STATS'
  | 'SENTIENT_BUILD'
  | 'SENTIENT_SYMBIONTS'
  | 'SENTIENT_INVENTORY'
  | keyof typeof CUSTOM_MONSTER_STAGE_FORMS;
export type EnemyWorkflowPayload = {
  readonly campaignId: string;
  readonly creationAttemptId: string;
  readonly expectedAttemptRevision: number;
  readonly stage?: EnemyPatchStage;
  readonly data?: JsonObject;
};
export type EnemyWorkflowRequest = WorkflowCommandRequestMessage<
  (typeof ENEMY_AUTHORING_WORKFLOWS)[number],
  EnemyWorkflowPayload
> & { readonly role: 'gm' };
export interface EnemyAuthoringMutation {
  readonly authorMasterProfileId: string;
  readonly sourceBaselineVersion: string;
  readonly request: EnemyWorkflowRequest;
  readonly itemTemplateKeys: readonly string[];
  readonly committedVersionOrNull: EnemyVersionIdentity | null;
  readonly receiptId: string;
  readonly timestamp: string;
  readonly preparedComposition?: EnemyComposedComposition;
  readonly preparedSkillState?: EnemySkillPlanState;
  readonly preparedMonsterComposition?: PreparedCustomMonsterComposition;
  readonly preparedMonsterKnowledge?: PreparedMonsterKnowledge;
}
export interface EnemySheet {
  readonly skillPlanState?: EnemySkillPlanState;
  readonly identity: EnemyIdentity;
  readonly baseStats: EnemyStats;
  readonly skillStageStats: EnemyStats;
  readonly permanentStats: EnemyStats;
  readonly effectiveStats: EnemyStats;
  readonly build: EnemyBuild;
  readonly skills: readonly {
    readonly skillKey: string;
    readonly name: string;
    readonly source: string;
    readonly bonus: number;
    readonly slotCost: number;
  }[];
  readonly skillSlots: {
    readonly capacity: number;
    readonly used: number;
    readonly remaining: number;
    readonly overflow?: number;
  };
  readonly composition: EnemyComposition;
  readonly compositionFacts?: JsonObject;
  readonly inventory: EnemyInventory;
  readonly items: readonly {
    readonly itemTemplateKey: string;
    readonly name: string;
    readonly profile: JsonValue;
    readonly quantity: number;
    readonly equipped: boolean;
    readonly equippedSlots: readonly string[];
  }[];
  readonly armor: JsonObject;
  readonly requirementPenalties: JsonObject;
  readonly classMovementModifier: number;
  readonly maxHP: number;
  readonly progressionPolicy: 'NO_XP_PROGRESSION';
  readonly artAssetKey: typeof ENEMY_PLACEHOLDER;
}
export interface SentientEnemyAuthoringProjection extends RevisionVector {
  readonly kind: 'SENTIENT_ENEMY_AUTHORING';
  readonly formId: (typeof SENTIENT_ENEMY_AUTHORING_FORMS)[number];
  readonly contextId: string;
  readonly campaignId: string;
  readonly campaignStatus: 'PAUSED' | 'HOSTING';
  readonly context: {
    readonly attemptOrNull: EnemyAttempt | null;
    readonly selectedVersionOrNull: SentientEnemyVersionIdentity | null;
  };
  readonly sheetOrNull: EnemySheet | null;
  readonly validationErrors: readonly string[];
  readonly catalog: JsonObject;
  readonly compositionPreparation?: Readonly<{
    permanentStatsOrNull: EnemyStats | null;
    factsOrNull: JsonObject | null;
    requiredRolls: readonly Readonly<{
      kind: 'FREE_SLOT' | 'ADVISER_I' | 'ADVISER_W' | 'ADVISER_SUPPRESSION';
      dieSides: 6 | 20;
    }>[];
    errors: readonly string[];
  }>;
  readonly art: {
    readonly mediaType: 'image/png';
    readonly sha256: string;
    readonly bytesBase64: string;
  };
}
export type EnemyAuthoringProjection = SentientEnemyAuthoringProjection | CustomMonsterProjection;
/** Existing SENTIENT widgets/fixtures fail closed when accidentally handed the other kind. */
export function sentientEnemyAuthoringProjectionValue(
  value: unknown,
): SentientEnemyAuthoringProjection {
  const projection = enemyAuthoringProjectionValue(value);
  if (projection.kind !== 'SENTIENT_ENEMY_AUTHORING')
    return r.invalid('$.kind', 'SENTIENT authoring projection', null);
  return projection;
}
export const ENEMY_AUTHORING_NAV_TARGETS = {
  'ENM-001::CTA::003': 'ENM-005',
  'ENM-001::CTA::011': 'ENM-011',
  'ENM-005::CTA::004': 'ENM-001',
  'ENM-006::CTA::001': 'ENM-005',
  'ENM-006::CTA::003': 'ENM-005',
  'ENM-007::CTA::005': 'ENM-006',
  'ENM-008::CTA::001': 'ENM-007',
  'ENM-008::CTA::003': 'ENM-007',
  'ENM-009::CTA::001': 'ENM-007',
  'ENM-009::CTA::003': 'ENM-008',
  'ENM-010::CTA::005': 'ENM-009',
  'ENM-020::CTA::002': 'ENM-001',
  'ENM-011::CTA::003': 'ENM-001',
  'ENM-012::CTA::006': 'ENM-011',
  'ENM-013::CTA::004': 'ENM-012',
  'ENM-014::CTA::001': 'ENM-013',
  'ENM-014::CTA::003': 'ENM-013',
  'ENM-015::CTA::004': 'ENM-014',
  'ENM-016::CTA::001': 'ENM-015',
  'ENM-016::CTA::003': 'ENM-015',
} as const;
export const ENEMY_STAGE_FORMS = {
  ...CUSTOM_MONSTER_STAGE_FORMS,
  SENTIENT_IDENTITY: ['ENM-005', 'ENM-006', 'ENM-005::CTA::003'],
  SENTIENT_STATS: ['ENM-006', 'ENM-007', 'ENM-006::CTA::002'],
  SENTIENT_BUILD: ['ENM-007', 'ENM-008', 'ENM-007::CTA::004'],
  SENTIENT_SYMBIONTS: ['ENM-008', 'ENM-009', 'ENM-008::CTA::002'],
  SENTIENT_INVENTORY: ['ENM-009', 'ENM-010', 'ENM-009::CTA::002'],
} as const;
export function enemyWorkflowRequestValue(value: unknown): EnemyWorkflowRequest {
  const row = r.exact(
    value,
    'messageType protocolVersion commandKind role commandId workflowCommandId expectedRevisions payload',
    '$',
  );
  w.literal(row['messageType'], 'command.request', '$.messageType');
  w.literal(row['protocolVersion'], 1, '$.protocolVersion');
  w.literal(row['commandKind'], 'workflow-command', '$.commandKind');
  w.literal(row['role'], 'gm', '$.role');
  r.oneOf(row['workflowCommandId'], ENEMY_AUTHORING_WORKFLOWS, '$.workflow');
  r.uuid(row['commandId'], '$.commandId');
  revisionValue(row['expectedRevisions']);
  const patch = row['workflowCommandId'] === 'UI-CMD-ENEMY-DRAFT-PATCH';
  const payload = r.exact(
    row['payload'],
    'campaignId creationAttemptId expectedAttemptRevision' + (patch ? ' stage data' : ''),
    '$.payload',
  );
  r.uuid(payload['campaignId'], '$.campaignId');
  r.uuid(payload['creationAttemptId'], '$.creationAttemptId');
  r.integer(payload['expectedAttemptRevision'], '$.expectedAttemptRevision', 0);
  if (patch) {
    r.oneOf(payload['stage'], Object.keys(ENEMY_STAGE_FORMS), '$.stage');
    w.jsonObject(payload['data'], '$.data');
  }
  return w.validated(structuredClone(row));
}
function revisionValue(value: unknown): void {
  const row = r.exact(
    value,
    'stateRevision projectionRevision actorVisibilityRevision',
    '$.revisions',
  );
  for (const key of Object.keys(row)) r.integer(row[key], '$.revisions.' + key, 0);
}
function nullableNumber(value: unknown, path: string): void {
  if (value !== null) numeric(value, path);
}
function bool(value: unknown, path: string): void {
  if (typeof value !== 'boolean') r.invalid(path, 'boolean', null);
}
function identityShape(value: unknown): void {
  const row = r.exact(
    value,
    'name description origin affiliation massKg anatomyProfileId',
    '$.identity',
  );
  for (const key of ['name', 'origin', 'affiliation']) r.raw(row[key], '$.identity.' + key);
  if (row['description'] !== null) r.raw(row['description'], '$.description');
  const mass = numeric(row['massKg'], '$.massKg');
  if (mass < 30 || mass > 500 || Math.round(mass * 10) / 10 !== mass)
    r.invalid('$.massKg', 'SENTIENT mass', null);
  w.literal(row['anatomyProfileId'], 'ORDINARY_SENTIENT', '$.anatomyProfileId');
}
function buildShape(value: unknown): void {
  const row = r.exact(value, 'raceCode pureClassOrNull skillSelections', '$.build');
  r.oneOf(row['raceCode'], ['PURE', 'FREE', 'UNITED'], '$.raceCode');
  if (row['pureClassOrNull'] !== null)
    r.oneOf(row['pureClassOrNull'], ['SEEKER', 'STALKER', 'SOLDIER'], '$.class');
  for (const raw of r.list(row['skillSelections'], '$.skillSelections')) {
    const skill = r.exact(raw, 'skillKey targetBonus', '$.skill');
    r.text(skill['skillKey'], '$.skillKey');
    r.integer(skill['targetBonus'], '$.targetBonus', 1);
  }
}
function emptyShape(value: unknown): void {
  if (Object.hasOwn(w.record(value, '$.composition'), 'schemaVersion')) {
    enemyComposedCompositionValue(value);
    return;
  }
  const row = r.exact(
    value,
    'symbiontCompositionMode ordinarySymbiontInstances symbioticMonsterProfileIdOrNull',
    '$.composition',
  );
  if (
    row['symbiontCompositionMode'] !== 'ORDINARY_SYMBIONTS' ||
    r.list(row['ordinarySymbiontInstances'], '$.ordinarySymbiontInstances').length !== 0 ||
    row['symbioticMonsterProfileIdOrNull'] !== null
  )
    r.invalid('$.composition', 'explicit empty composition', null);
}
function expressionShape(value: unknown): void {
  const row = w.record(value, '$.expression');
  if (row['kind'] === 'RETAIN') {
    r.exact(value, 'kind', '$.expression');
    return;
  }
  const expression = r.exact(value, 'kind pattern constantOrNull', '$.expression');
  w.literal(expression['kind'], 'MASTER_DICE', '$.kind');
  r.oneOf(
    expression['pattern'],
    ['R4', 'R4+X', 'R6', 'R6+X', 'R12', 'R12+X', 'R20+X', 'R20*2+X'],
    '$.pattern',
  );
  nullableNumber(expression['constantOrNull'], '$.constant');
}
function partialStats(value: unknown, path: string): void {
  const row = w.record(value, path);
  if (Object.keys(row).length !== 0) r.exact(value, Object.keys(row).join(' '), path);
  else if (Reflect.ownKeys(row).length !== 0) r.invalid(path, 'plain empty map', null);
  for (const [key, value] of Object.entries(row)) {
    r.oneOf(key, ENEMY_STATS, path);
    numeric(value, path + '.' + key);
  }
}
function combatDefinitionShape(value: unknown): void {
  const raw = w.record(value, '$.combatDefinition');
  const optional = [
    'definitionId',
    'rollGroupId',
    'instanceSourceField',
    'conditionalOverride',
  ].filter((key) => Object.hasOwn(raw, key));
  const row = r.exact(
    value,
    'valueMode sourceNotation baseExpression sourceScope evaluationScope effectiveTemplateExpression damageModifierStat dieType rollKind progressionEligibility rawRollPersistence resolvedResultField resolvedResultPersistence' +
      (optional.length === 0 ? '' : ' ' + optional.join(' ')),
    '$.combatDefinition',
  );
  for (const key of Object.keys(row)) r.raw(row[key], '$.combatDefinition.' + key);
}
function displayProfileShape(value: unknown): void {
  const raw = w.record(value, '$.displayProfile');
  if (Object.hasOwn(raw, 'damageDefinition')) {
    const optional = ['instanceDamage', 'rangeMeters', 'accuracyBonus'].filter((key) =>
      Object.hasOwn(raw, key),
    );
    const row = r.exact(
      value,
      'weaponTypeId weaponVariantId name variantLabel templateProfileVersion statSource damageDefinition penetrationDefinition statRequirements properties' +
        (optional.length === 0 ? '' : ' ' + optional.join(' ')),
      '$.weaponProfile',
    );
    for (const key of [
      'weaponTypeId',
      'weaponVariantId',
      'name',
      'variantLabel',
      'templateProfileVersion',
      'statSource',
    ])
      r.text(row[key], '$.' + key);
    combatDefinitionShape(row['damageDefinition']);
    combatDefinitionShape(row['penetrationDefinition']);
    partialStats(row['statRequirements'], '$.statRequirements');
    w.jsonObject(row['properties'], '$.properties');
    optional.forEach((key) => numeric(row[key], '$.' + key));
    return;
  }
  if (Object.hasOwn(raw, 'coverageModel')) {
    const row = r.exact(
      value,
      'itemTypeId sourceRuleId coverageModel physicalArmorOrNull requiredStrength runningModifier acrobaticsModifier dodgeModifier mobilityModifierOrNull protectionSourceOrNull conditionSourceOrNull hardNeck sealedApplicable allowsLayers',
      '$.armorProfile',
    );
    for (const key of ['itemTypeId', 'sourceRuleId', 'coverageModel']) r.text(row[key], '$.' + key);
    for (const key of [
      'requiredStrength',
      'runningModifier',
      'acrobaticsModifier',
      'dodgeModifier',
    ])
      numeric(row[key], '$.' + key);
    for (const key of ['protectionSourceOrNull', 'conditionSourceOrNull'])
      if (row[key] !== null) r.raw(row[key], '$.' + key);
    for (const key of ['hardNeck', 'sealedApplicable', 'allowsLayers']) bool(row[key], '$.' + key);
    if (row['physicalArmorOrNull'] !== null) {
      const armor = r.exact(
        row['physicalArmorOrNull'],
        'dieSides multiplier constant',
        '$.physicalArmor',
      );
      Object.keys(armor).forEach((key) => numeric(armor[key], '$.' + key));
    }
    if (row['mobilityModifierOrNull'] !== null)
      w.jsonObject(row['mobilityModifierOrNull'], '$.mobilityModifier');
    return;
  }
  if (Object.hasOwn(raw, 'shieldMaxHP')) {
    const row = r.exact(
      value,
      'itemTypeId sourceRuleId componentRole shieldMaxHP statRequirements sourceProperties',
      '$.shieldProfile',
    );
    for (const key of ['itemTypeId', 'sourceRuleId', 'componentRole']) r.text(row[key], '$.' + key);
    numeric(row['shieldMaxHP'], '$.shieldMaxHP');
    partialStats(row['statRequirements'], '$.statRequirements');
    w.jsonObject(row['sourceProperties'], '$.sourceProperties');
    return;
  }
  const row = r.exact(
    value,
    'itemTypeId name category completeness catalogueSource mechanicsSourceOrNull',
    '$.catalogueProfile',
  );
  for (const key of ['itemTypeId', 'name', 'category', 'completeness'])
    r.text(row[key], '$.' + key);
  w.jsonObject(row['catalogueSource'], '$.catalogueSource');
  if (row['mechanicsSourceOrNull'] !== null)
    w.jsonObject(row['mechanicsSourceOrNull'], '$.mechanicsSource');
}
function itemInputShape(value: unknown): void {
  const raw = w.record(value, '$.itemInput'),
    row = r.exact(
      value,
      'itemTypeId quantity profile equipped equippedSlots bodyZone gripMode currentAmmo shieldCurrentHP broken sealed linkedSetInstanceId componentRole qualityRoll coatingInstanceIds issueReason' +
        (Object.hasOwn(raw, 'qualityTier') ? ' qualityTier' : '') +
        (Object.hasOwn(raw, 'clothingProperties') ? ' clothingProperties' : ''),
      '$.itemInput',
    );
  r.text(row['itemTypeId'], '$.itemTypeId');
  r.integer(row['quantity'], '$.quantity', 1);
  r.raw(row['issueReason'], '$.issueReason');
  bool(row['equipped'], '$.equipped');
  bool(row['broken'], '$.broken');
  if (row['sealed'] !== null) bool(row['sealed'], '$.sealed');
  r.list(row['equippedSlots'], '$.equippedSlots').forEach((slot) =>
    r.oneOf(
      slot,
      ['HAND_L', 'HAND_R', 'HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'],
      '$.slot',
    ),
  );
  if (row['bodyZone'] !== null)
    r.oneOf(row['bodyZone'], ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'], '$.bodyZone');
  if (row['gripMode'] !== null) r.oneOf(row['gripMode'], ['ONE_HAND', 'TWO_HAND'], '$.gripMode');
  if (row['componentRole'] !== null)
    r.oneOf(row['componentRole'], ['SWORD', 'RAPIER', 'SHIELD'], '$.componentRole');
  if (row['linkedSetInstanceId'] !== null)
    r.uuid(row['linkedSetInstanceId'], '$.linkedSetInstanceId');
  for (const key of ['currentAmmo', 'shieldCurrentHP'])
    if (row[key] !== null) r.integer(row[key], '$.' + key, 0);
  if (row['qualityRoll'] !== null || r.list(row['coatingInstanceIds'], '$.coatings').length !== 0)
    r.invalid('$.itemInput', 'no roll/prepared coating capability', null);
  if (Object.hasOwn(raw, 'qualityTier') && row['qualityTier'] !== null)
    r.oneOf(
      row['qualityTier'],
      ['MISSING_OR_UNFIT', 'POOR', 'ORDINARY', 'GOOD', 'EXCEPTIONAL', 'RARE'],
      '$.qualityTier',
    );
  if (Object.hasOwn(raw, 'clothingProperties')) {
    const clothing = r.exact(
      row['clothingProperties'],
      'coveredRegionIds hermetic flammability',
      '$.clothing',
    );
    r.list(clothing['coveredRegionIds'], '$.regions').forEach((zone) =>
      r.oneOf(zone, ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'], '$.zone'),
    );
    if (clothing['hermetic'] !== 'UNKNOWN') bool(clothing['hermetic'], '$.hermetic');
    r.oneOf(
      clothing['flammability'],
      ['COMBUSTIBLE', 'NONCOMBUSTIBLE', 'UNKNOWN'],
      '$.flammability',
    );
  }
  const profile = w.record(row['profile'], '$.profile');
  if (profile['kind'] === 'CATALOG') {
    r.exact(profile, 'kind', '$.profile');
    return;
  }
  const master = r.exact(profile, 'kind reason inputs', '$.profile');
  w.literal(master['kind'], 'MASTER_WEAPON', '$.kind');
  r.raw(master['reason'], '$.reason');
  for (const raw of r.list(master['inputs'], '$.inputs')) {
    const input = r.exact(
      raw,
      'weaponVariantId damageDefinition penetrationDefinition statRequirements instanceDamageOrNull rangeMetersOrNull accuracyBonusOrNull',
      '$.weaponInput',
    );
    r.oneOf(
      input['weaponVariantId'],
      ['DEFAULT', 'ONE_HAND', 'TWO_HAND', 'SWORD', 'SHIELD', 'RAPIER'],
      '$.variant',
    );
    expressionShape(input['damageDefinition']);
    expressionShape(input['penetrationDefinition']);
    partialStats(input['statRequirements'], '$.requirements');
    for (const key of ['instanceDamageOrNull', 'rangeMetersOrNull', 'accuracyBonusOrNull'])
      nullableNumber(input[key], '$.' + key);
  }
}
function inventoryShape(value: unknown): void {
  const row = r.exact(value, 'inventoryItems armorCompatibilityReasonOrNull', '$.inventory');
  r.list(row['inventoryItems'], '$.inventoryItems').forEach(itemInputShape);
  if (row['armorCompatibilityReasonOrNull'] !== null)
    r.raw(row['armorCompatibilityReasonOrNull'], '$.compatibilityReason');
}
export function enemyVersionIdentityValue(value: unknown): EnemyVersionIdentity {
  const row = r.exact(
    value,
    'campaignId templateId versionId version kind artAssetKey artSha256',
    '$.version',
  );
  for (const key of ['campaignId', 'templateId', 'versionId']) r.uuid(row[key], '$.' + key);
  w.literal(row['version'], 1, '$.version');
  r.oneOf(row['kind'], ['SENTIENT', 'CUSTOM_MONSTER'], '$.kind');
  const monster = row['kind'] === 'CUSTOM_MONSTER';
  w.literal(
    row['artAssetKey'],
    monster ? CUSTOM_MONSTER_PLACEHOLDER : ENEMY_PLACEHOLDER,
    '$.artAssetKey',
  );
  if (typeof row['artSha256'] !== 'string' || !/^[a-f0-9]{64}$/u.test(row['artSha256']))
    r.invalid('$.artSha256', 'SHA-256', null);
  w.literal(
    row['artSha256'],
    monster ? CUSTOM_MONSTER_PLACEHOLDER_SHA256 : ENEMY_PLACEHOLDER_SHA256,
    '$.artSha256',
  );
  return w.validated(row);
}
export function enemyAuthoringMutationValue(value: unknown): EnemyAuthoringMutation {
  const raw = w.record(value, '$.enemyMutation');
  const row = r.exact(
    value,
    'request itemTemplateKeys committedVersionOrNull receiptId timestamp sourceBaselineVersion authorMasterProfileId' +
      (Object.hasOwn(raw, 'preparedComposition') ? ' preparedComposition' : '') +
      (Object.hasOwn(raw, 'preparedSkillState') ? ' preparedSkillState' : '') +
      (Object.hasOwn(raw, 'preparedMonsterComposition') ? ' preparedMonsterComposition' : '') +
      (Object.hasOwn(raw, 'preparedMonsterKnowledge') ? ' preparedMonsterKnowledge' : ''),
    '$.enemyMutation',
  );
  r.text(row['sourceBaselineVersion'], '$.sourceBaselineVersion');
  r.uuid(row['authorMasterProfileId'], '$.authorMasterProfileId');
  const request = enemyWorkflowRequestValue(row['request']);
  if (Object.hasOwn(row, 'preparedMonsterKnowledge')) {
    if (request.payload.stage !== 'MONSTER_STATS')
      r.invalid('$.preparedMonsterKnowledge', 'own accepted body stage only', null);
    preparedMonsterKnowledgeValue(row['preparedMonsterKnowledge']);
  } else if (request.payload.stage === 'MONSTER_STATS')
    r.invalid('$.preparedMonsterKnowledge', 'verified accepted body accounting', null);
  if (Object.hasOwn(row, 'preparedMonsterComposition')) {
    if (request.payload.stage !== 'MONSTER_SYMBIONT')
      r.invalid('$.preparedMonsterComposition', 'own CUSTOM_MONSTER composition stage', null);
    preparedCustomMonsterCompositionValue(row['preparedMonsterComposition']);
  } else if (request.payload.stage === 'MONSTER_SYMBIONT')
    r.invalid('$.preparedMonsterComposition', 'host prepared composition', null);
  if (Object.hasOwn(row, 'preparedSkillState')) enemySkillPlanStateValue(row['preparedSkillState']);
  if (
    request.payload.stage === 'SENTIENT_BUILD' &&
    Object.hasOwn(request.payload.data ?? {}, 'operation')
  ) {
    enemyBuildPlanPatchValue(request.payload.data);
    if (!Object.hasOwn(row, 'preparedSkillState'))
      r.invalid('$.preparedSkillState', 'host-bound plan preparation', null);
  }
  const compositionOperation =
    request.payload.stage === 'SENTIENT_SYMBIONTS' &&
    Object.hasOwn(request.payload.data ?? {}, 'operation');
  if (compositionOperation && !Object.hasOwn(row, 'preparedComposition'))
    r.invalid('$.preparedComposition', 'host preparation for a composition operation', null);
  if (Object.hasOwn(row, 'preparedComposition')) {
    if (request.payload.stage !== 'SENTIENT_SYMBIONTS')
      r.invalid('$.preparedComposition', 'composition stage only', null);
    if (compositionOperation) enemyCompositionPatchValue(request.payload.data);
    else emptyShape(request.payload.data);
    enemyComposedCompositionValue(row['preparedComposition']);
  }
  r.uuid(row['receiptId'], '$.receiptId');
  const timestamp = r.text(row['timestamp'], '$.timestamp');
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== timestamp)
    r.invalid('$.timestamp', 'canonical ISO timestamp', null);
  const keys = r.list(row['itemTemplateKeys'], '$.itemTemplateKeys');
  keys.forEach((key) => r.uuid(key, '$.itemTemplateKey'));
  if (new Set(keys).size !== keys.length) r.invalid('$.itemTemplateKeys', 'distinct keys', null);
  if (request.payload.stage === 'SENTIENT_INVENTORY') {
    if (keys.length !== r.list(request.payload.data?.['inventoryItems'], '$.inventoryItems').length)
      r.invalid('$.itemTemplateKeys', 'one issued key per input', null);
  } else if (keys.length !== 0) r.invalid('$.itemTemplateKeys', 'inventory allocations only', null);
  if (row['committedVersionOrNull'] !== null)
    enemyVersionIdentityValue(row['committedVersionOrNull']);
  if (
    (request.workflowCommandId === 'UI-CMD-ENEMY-COMMIT-V1') !==
    (row['committedVersionOrNull'] !== null)
  )
    r.invalid('$.committedVersionOrNull', 'COMMIT identity only', null);
  return w.validated(row);
}
export function enemyAuthoringReceipt(
  mutation: EnemyAuthoringMutation,
  revisions: RevisionVector,
): CommandReceipt {
  return {
    commandId: mutation.request.commandId,
    receiptId: mutation.receiptId,
    revisions,
    result: {
      campaignId: mutation.request.payload.campaignId,
      creationAttemptId: mutation.request.payload.creationAttemptId,
      timestamp: mutation.timestamp,
      workflowCommandId: mutation.request.workflowCommandId,
      sourceFormId:
        mutation.request.payload.stage === undefined
          ? mutation.committedVersionOrNull?.kind === 'CUSTOM_MONSTER'
            ? 'ENM-016'
            : 'ENM-010'
          : ENEMY_STAGE_FORMS[mutation.request.payload.stage][0],
      stageOrNull: mutation.request.payload.stage ?? null,
      attemptRevision:
        mutation.request.payload.expectedAttemptRevision +
        (mutation.committedVersionOrNull === null ? 1 : 0),
      committedVersionOrNull: mutation.committedVersionOrNull as unknown as JsonValue,
      ...(mutation.preparedComposition === undefined
        ? {}
        : { compositionPhase: mutation.preparedComposition.phase }),
      ...(mutation.preparedMonsterComposition === undefined
        ? {}
        : { compositionPhase: mutation.preparedMonsterComposition.composition.phase }),
      ...(mutation.request.payload.stage === 'SENTIENT_BUILD' &&
      Object.hasOwn(mutation.request.payload.data ?? {}, 'operation')
        ? {
            buildPhase:
              mutation.request.payload.data?.['operation'] === 'PREVIEW_REBUILD'
                ? 'PREVIEW_REBUILD'
                : mutation.request.payload.data?.['operation'] === 'DISCARD_REBUILD'
                  ? 'REBUILD_DISCARDED'
                  : 'SAVED',
          }
        : {}),
    },
  };
}
function numeric(value: unknown, path: string): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : r.invalid(path, 'finite number', null);
}
function statBlock(value: unknown, base: boolean, provisional = false): void {
  const row = r.exact(value, ENEMY_STATS.join(' '), '$.stats');
  for (const key of ENEMY_STATS)
    if (r.integer(row[key], '$.' + key, provisional ? Number.MIN_SAFE_INTEGER : 1) > 35 && base)
      r.invalid('$.stats', 'base stat 1..35', null);
}
export function enemyAuthoringProjectionValue(value: unknown): EnemyAuthoringProjection {
  const rawProjection = w.record(value, '$.enemyAuthoringProjection');
  if (rawProjection['kind'] === 'CUSTOM_MONSTER_AUTHORING')
    return customMonsterProjectionValue(value);
  const row = r.exact(
    value,
    'kind formId contextId campaignId campaignStatus stateRevision projectionRevision actorVisibilityRevision context sheetOrNull validationErrors catalog art' +
      (Object.hasOwn(rawProjection, 'compositionPreparation') ? ' compositionPreparation' : ''),
    '$.enemyAuthoringProjection',
  );
  w.literal(row['kind'], 'SENTIENT_ENEMY_AUTHORING', '$.kind');
  r.oneOf(row['formId'], SENTIENT_ENEMY_AUTHORING_FORMS, '$.formId');
  r.oneOf(row['campaignStatus'], ['PAUSED', 'HOSTING'], '$.campaignStatus');
  for (const key of ['contextId', 'campaignId']) r.uuid(row[key], '$.' + key);
  revisionValue(
    Object.fromEntries(
      ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'].map((key) => [
        key,
        row[key],
      ]),
    ),
  );
  const context = enemyAuthoringContextValue(row['context']);
  if (
    context.attemptOrNull?.kind === 'CUSTOM_MONSTER' ||
    context.selectedVersionOrNull?.kind === 'CUSTOM_MONSTER'
  )
    return r.invalid('$.context', 'SENTIENT projection owns only SENTIENT data', null);
  if (row['formId'] !== 'ENM-020' && context.attemptOrNull === null)
    r.invalid('$.context.attemptOrNull', 'own open attempt', null);
  if (context.attemptOrNull !== null) {
    const formIndex = SENTIENT_ENEMY_AUTHORING_FORMS.indexOf(
      row['formId'] as SentientEnemyAuthoringProjection['formId'],
    );
    const fields = [
      'identityOrNull',
      'baseStatsOrNull',
      'buildOrNull',
      'compositionOrNull',
      'inventoryOrNull',
    ] as const;
    for (const key of fields.slice(0, Math.min(formIndex, fields.length)))
      if (context.attemptOrNull[key] === null)
        r.invalid('$.attempt.' + key, 'preceding confirmed stage', null);
  }
  if (
    (row['formId'] === 'ENM-020') !== (context.selectedVersionOrNull !== null) ||
    (context.attemptOrNull !== null && context.attemptOrNull.campaignId !== row['campaignId']) ||
    (context.selectedVersionOrNull !== null &&
      context.selectedVersionOrNull.campaignId !== row['campaignId'])
  )
    r.invalid('$.context', 'own campaign/current form binding', null);
  const art = r.exact(row['art'], 'mediaType sha256 bytesBase64', '$.art');
  w.literal(art['sha256'], ENEMY_PLACEHOLDER_SHA256, '$.art.sha256');
  w.literal(art['mediaType'], 'image/png', '$.art.mediaType');
  if (
    typeof art['sha256'] !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(art['sha256']) ||
    typeof art['bytesBase64'] !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(art['bytesBase64']) ||
    art['bytesBase64'].length === 0
  )
    r.invalid('$.art', 'PNG digest/base64', null);
  if (
    context.selectedVersionOrNull !== null &&
    context.selectedVersionOrNull.artSha256 !== art['sha256']
  )
    r.invalid('$.art', 'version-bound placeholder', null);
  for (const error of r.list(row['validationErrors'], '$.validationErrors'))
    r.text(error, '$.error');
  const rawCatalog = w.record(row['catalog'], '$.catalog');
  const catalog = r.exact(
    row['catalog'],
    'inventoryMetadata buildOptions races classes skills items' +
      (Object.hasOwn(rawCatalog, 'compositionCatalog') ? ' compositionCatalog' : ''),
    '$.catalog',
  );
  if (Object.hasOwn(catalog, 'compositionCatalog'))
    enemyCompositionCatalogShape(catalog['compositionCatalog']);
  else if (row['formId'] === 'ENM-008')
    r.invalid('$.compositionCatalog', 'source catalogue required by the ENM-008 controls', null);
  if (context.attemptOrNull?.skillPlanState !== undefined)
    enemySkillPlanCatalogBindings(context.attemptOrNull.skillPlanState, catalog['skills']);
  if (context.attemptOrNull?.legacySkillPlanPreview !== undefined)
    enemySkillPlanCatalogBindings(
      {
        ...emptyEnemySkillPlanState(),
        rebuildPreviewOrNull: context.attemptOrNull.legacySkillPlanPreview,
      },
      catalog['skills'],
    );
  if (
    context.attemptOrNull?.compositionAcquisitions?.grossGrantOrNull != null &&
    !r
      .list(catalog['skills'], '$.skills')
      .some((raw) => w.record(raw, '$.skill')['skillKey'] === 'GROSS')
  )
    r.invalid('$.catalog.skills', 'acquired GROSS fact has an actual skill label', null);
  const composing = context.attemptOrNull?.compositionOrNull;
  if (composing != null && 'schemaVersion' in composing) {
    enemyCompositionBindings(composing, catalog['compositionCatalog']);
    for (const skill of [...composing.skills.advisorSkills, ...composing.skills.dolphinSkills])
      if (
        !r
          .list(catalog['skills'], '$.skills')
          .some((raw) => w.record(raw, '$.skill')['skillKey'] === skill.skillKey)
      )
        r.invalid('$.composition.skills', 'actual catalogue choice', null);
  }
  const expectedPreparation =
    row['formId'] === 'ENM-008' && composing != null && 'schemaVersion' in composing;
  if (expectedPreparation !== Object.hasOwn(row, 'compositionPreparation'))
    r.invalid('$.compositionPreparation', 'current discriminated ENM-008 preparation only', null);
  if (expectedPreparation && composing != null && 'schemaVersion' in composing) {
    const preparation = r.exact(
      row['compositionPreparation'],
      'permanentStatsOrNull factsOrNull requiredRolls errors',
      '$.compositionPreparation',
    );
    const errors = r.list(preparation['errors'], '$.errors');
    errors.forEach((error) => r.text(error, '$.error'));
    if (preparation['permanentStatsOrNull'] !== null) {
      const provisional = r.exact(
        preparation['permanentStatsOrNull'],
        ENEMY_STATS.join(' '),
        '$.provisionalStats',
      );
      for (const key of ENEMY_STATS)
        r.integer(provisional[key], '$.provisionalStats.' + key, Number.MIN_SAFE_INTEGER);
    }
    if (preparation['factsOrNull'] !== null)
      enemyCompositionSkillBindings(
        enemyCompositionFactsShape(
          preparation['factsOrNull'],
          composing,
          catalog['compositionCatalog'],
          context.attemptOrNull?.skillPlanState,
        ),
        catalog['skills'],
      );
    if (
      (preparation['permanentStatsOrNull'] === null) !== (preparation['factsOrNull'] === null) ||
      (preparation['factsOrNull'] === null && errors.length === 0)
    )
      r.invalid('$.compositionPreparation', 'actual facts or explicit source refusal', null);
    for (const raw of r.list(preparation['requiredRolls'], '$.requiredRolls')) {
      const roll = r.exact(raw, 'kind dieSides', '$.requiredRoll');
      r.oneOf(
        roll['kind'],
        ['FREE_SLOT', 'ADVISER_I', 'ADVISER_W', 'ADVISER_SUPPRESSION'],
        '$.kind',
      );
      if (roll['dieSides'] !== (roll['kind'] === 'FREE_SLOT' ? 6 : 20))
        r.invalid('$.dieSides', 'source acquisition die', null);
    }
  }
  const metadata = r.exact(
    catalog['inventoryMetadata'],
    'qualityTiers clothingRegions clothingHermetic clothingFlammability',
    '$.inventoryMetadata',
  );
  for (const raw of r.list(metadata['qualityTiers'], '$.qualityTiers')) {
    const tier = r.exact(raw, 'value label', '$.qualityTier');
    r.oneOf(
      tier['value'],
      ['MISSING_OR_UNFIT', 'POOR', 'ORDINARY', 'GOOD', 'EXCEPTIONAL', 'RARE'],
      '$.qualityTier.value',
    );
    r.text(tier['label'], '$.qualityTier.label');
  }
  for (const value of r.list(metadata['clothingRegions'], '$.clothingRegions'))
    r.oneOf(value, ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'], '$.clothingRegion');
  for (const value of r.list(metadata['clothingHermetic'], '$.clothingHermetic'))
    if (value !== 'UNKNOWN' && typeof value !== 'boolean')
      r.invalid('$.clothingHermetic', 'boolean or UNKNOWN', null);
  for (const value of r.list(metadata['clothingFlammability'], '$.clothingFlammability'))
    r.oneOf(value, ['COMBUSTIBLE', 'NONCOMBUSTIBLE', 'UNKNOWN'], '$.clothingFlammability');
  const metadataInputBinding = (input: Record<string, unknown>) => {
    if (
      input['qualityTier'] !== undefined &&
      input['qualityTier'] !== null &&
      !r
        .list(metadata['qualityTiers'], '$.qualityTiers')
        .some((raw) => w.record(raw, '$.qualityTier')['value'] === input['qualityTier'])
    )
      r.invalid('$.qualityTier', 'offered source metadata choice', null);
    if (input['clothingProperties'] !== undefined) {
      const clothing = w.record(input['clothingProperties'], '$.clothing');
      if (
        !r.list(metadata['clothingHermetic'], '$.hermetic').includes(clothing['hermetic']) ||
        !r
          .list(metadata['clothingFlammability'], '$.flammability')
          .includes(clothing['flammability']) ||
        r
          .list(clothing['coveredRegionIds'], '$.regions')
          .some((region) => !r.list(metadata['clothingRegions'], '$.regions').includes(region))
      )
        r.invalid('$.clothing', 'offered source metadata choices', null);
    }
  };
  for (const raw of r.list(catalog['races'], '$.races')) {
    const race = r.exact(raw, 'raceCode name classPolicy', '$.race');
    r.oneOf(race['raceCode'], ['PURE', 'FREE', 'UNITED'], '$.raceCode');
    r.text(race['name'], '$.name');
    r.oneOf(race['classPolicy'], ['REQUIRED_PURE_CLASS', 'NO_CLASS'], '$.classPolicy');
  }
  for (const raw of r.list(catalog['classes'], '$.classes')) {
    const cls = r.exact(raw, 'classCode name', '$.class');
    r.oneOf(cls['classCode'], ['SEEKER', 'STALKER', 'SOLDIER'], '$.classCode');
    r.text(cls['name'], '$.name');
  }
  for (const raw of r.list(catalog['skills'], '$.skills')) {
    const input = w.record(raw, '$.skill'),
      skill = r.exact(
        raw,
        'skillKey skillId category slotCostMode maxBonus status name requirements' +
          (Object.hasOwn(input, 'missingSkillPenalty') ? ' missingSkillPenalty' : ''),
        '$.skill',
      );
    for (const key of ['skillKey', 'skillId', 'category', 'slotCostMode', 'status', 'name'])
      r.text(skill[key], '$.skill.' + key);
    if (skill['maxBonus'] !== 'NO_RULED_UPPER_LIMIT') numeric(skill['maxBonus'], '$.maxBonus');
    if (Object.hasOwn(input, 'missingSkillPenalty'))
      numeric(skill['missingSkillPenalty'], '$.missingSkillPenalty');
    for (const raw of r.list(skill['requirements'], '$.requirements')) {
      const req = r.exact(
        raw,
        'requirementId requirementSetId skillKey statCode minValue evaluationStage beforeSymbiontBonuses ruleId',
        '$.requirement',
      );
      r.oneOf(req['statCode'], ENEMY_STATS, '$.statCode');
      for (const key of [
        'requirementId',
        'requirementSetId',
        'skillKey',
        'evaluationStage',
        'ruleId',
      ])
        r.text(req[key], '$.requirement.' + key);
      bool(req['beforeSymbiontBonuses'], '$.beforeSymbiontBonuses');
      numeric(req['minValue'], '$.minValue');
      if (req['skillKey'] !== skill['skillKey']) r.invalid('$.requirement', 'own skill', null);
    }
  }
  for (const raw of r.list(catalog['items'], '$.items')) {
    const item = r.exact(
      raw,
      'itemTypeId name category equippable composite components armorOrNull catalogueSource profileSource weaponProfiles',
      '$.itemChoice',
    );
    for (const key of ['itemTypeId', 'name', 'category']) r.text(item[key], '$.' + key);
    for (const key of ['equippable', 'composite'])
      if (typeof item[key] !== 'boolean') r.invalid('$.' + key, 'boolean', null);
    for (const raw of r.list(item['components'], '$.components')) {
      const c = r.exact(raw, 'role attackVariants shieldMaxHPOrNull', '$.component');
      r.oneOf(c['role'], ['SWORD', 'RAPIER', 'SHIELD'], '$.role');
      r.list(c['attackVariants'], '$.attackVariants').forEach((v) => r.text(v, '$.variant'));
      if (c['shieldMaxHPOrNull'] !== null) numeric(c['shieldMaxHPOrNull'], '$.shieldMaxHP');
    }
    if (item['armorOrNull'] !== null) {
      const a = r.exact(
        item['armorOrNull'],
        'coverageModel allowsLayers sealedApplicable',
        '$.armorChoice',
      );
      r.oneOf(a['coverageModel'], ['ZONE_ELEMENT', 'FULL_SUIT'], '$.coverageModel');
      for (const key of ['allowsLayers', 'sealedApplicable'])
        if (typeof a[key] !== 'boolean') r.invalid('$.' + key, 'boolean', null);
    }
    w.jsonObject(item['catalogueSource'], '$.catalogueSource');
    if (item['profileSource'] !== null) w.jsonObject(item['profileSource'], '$.profileSource');
    for (const raw of r.list(item['weaponProfiles'], '$.weaponProfiles')) {
      const v = r.exact(
        raw,
        'weaponVariant variantLabel canonicalProfileVersion profileKind template',
        '$.weaponChoice',
      );
      for (const key of ['weaponVariant', 'variantLabel', 'canonicalProfileVersion'])
        r.text(v[key], '$.' + key);
      r.oneOf(v['profileKind'], ['FIXED', 'FORMULA'], '$.profileKind');
      displayProfileShape(v['template']);
    }
  }
  for (const input of context.attemptOrNull?.inventoryOrNull?.inventoryItems ?? []) {
    metadataInputBinding(w.record(input, '$.inventoryItem'));
    const definition = r
      .list(catalog['items'], '$.items')
      .map((raw) => w.record(raw, '$.itemChoice'))
      .find((row) => row['itemTypeId'] === input.itemTypeId);
    const offered = definition ?? r.invalid('$.inventory', 'actual own catalogue input', null);
    if (input.equipped && offered['equippable'] !== true)
      r.invalid('$.inventory', 'actual equippable catalogue input', null);
    if (
      input.profile.kind === 'MASTER_WEAPON' &&
      input.profile.inputs.some(
        (profile) =>
          !r
            .list(offered['weaponProfiles'], '$.weaponProfiles')
            .some((raw) => w.record(raw, '$.variant')['weaponVariant'] === profile.weaponVariantId),
      )
    )
      r.invalid('$.profile', 'actual item variant', null);
  }
  for (const raw of r.list(catalog['buildOptions'], '$.buildOptions')) {
    const option = r.exact(
      raw,
      'raceCode pureClassOrNull skillStageStats invalidPermanentStats capacityOrNull mandatorySkills',
      '$.buildOption',
    );
    r.oneOf(option['raceCode'], ['PURE', 'FREE', 'UNITED'], '$.raceCode');
    if (option['pureClassOrNull'] !== null)
      r.oneOf(option['pureClassOrNull'], ['SEEKER', 'STALKER', 'SOLDIER'], '$.class');
    const stats = r.exact(option['skillStageStats'], ENEMY_STATS.join(' '), '$.optionStats');
    for (const key of ENEMY_STATS) numeric(stats[key], '$.optionStats.' + key);
    r.list(option['invalidPermanentStats'], '$.invalidStats').forEach((stat) =>
      r.oneOf(stat, ENEMY_STATS, '$.stat'),
    );
    if (option['capacityOrNull'] !== null) r.integer(option['capacityOrNull'], '$.capacity', 0);
    for (const raw of r.list(option['mandatorySkills'], '$.mandatorySkills')) {
      const skill = r.exact(raw, 'source skillKey bonus slotCost name', '$.mandatorySkill');
      for (const key of ['source', 'skillKey', 'name']) r.text(skill[key], '$.' + key);
      numeric(skill['bonus'], '$.bonus');
      r.integer(skill['slotCost'], '$.slotCost', 0);
    }
  }
  if (row['sheetOrNull'] !== null) {
    const rawSheet = w.record(row['sheetOrNull'], '$.sheet');
    const sheet = r.exact(
      row['sheetOrNull'],
      'identity baseStats skillStageStats permanentStats effectiveStats build skills skillSlots composition inventory items armor requirementPenalties classMovementModifier maxHP progressionPolicy artAssetKey' +
        (Object.hasOwn(rawSheet, 'compositionFacts') ? ' compositionFacts' : '') +
        (Object.hasOwn(rawSheet, 'skillPlanState') ? ' skillPlanState' : ''),
      '$.sheet',
    );
    const identity = r.exact(
      sheet['identity'],
      'name description origin affiliation massKg anatomyProfileId',
      '$.identity',
    );
    for (const key of ['name', 'origin', 'affiliation']) r.raw(identity[key], '$.' + key);
    if (identity['description'] !== null) r.raw(identity['description'], '$.description');
    w.literal(identity['anatomyProfileId'], 'ORDINARY_SENTIENT', '$.anatomy');
    const mass = numeric(identity['massKg'], '$.massKg');
    if (mass < 30 || mass > 500 || Math.round(mass * 10) / 10 !== mass)
      r.invalid('$.massKg', 'SENTIENT mass', null);
    const sheetSkillState = Object.hasOwn(sheet, 'skillPlanState')
      ? enemySkillPlanStateValue(sheet['skillPlanState'])
      : undefined;
    if (sheetSkillState !== undefined) {
      enemySkillPlanCatalogBindings(sheetSkillState, catalog['skills']);
      const plan =
        sheetSkillState.planOrNull ??
        r.invalid('$.sheet.skillPlan', 'confirmed initial plan', null);
      const accounting =
        plan.accountingOrNull ??
        r.invalid('$.sheet.skillPlan', 'resolved current full input', null);
      if (
        sheetSkillState.pendingChoicesOrNull !== null ||
        sheetSkillState.rebuildPreviewOrNull !== null ||
        !admissionJsonEqual(plan.initialInput, {
          baseStats: sheet['baseStats'],
          build: sheet['build'],
        })
      )
        r.invalid('$.sheet.skillPlan', 'resolved current full input', null);
      const actual = r.list(sheet['skills'], '$.skills').map((raw) => {
        const skill = w.record(raw, '$.skill');
        return {
          skillKey: skill['skillKey'],
          bonus: skill['bonus'],
          slotCost: skill['slotCost'],
          source: skill['source'],
        };
      });
      const expected = accounting.knownSkills.map((skill) => ({
        skillKey: skill.skillKey,
        bonus: skill.bonus,
        slotCost: skill.startSlots + skill.dolphinSlots,
        source: skill.source,
      }));
      if (!admissionJsonEqual(actual, expected))
        r.invalid('$.sheet.skills', 'actual paid current-plan knowledge', null);
    }
    for (const key of ['baseStats', 'skillStageStats', 'permanentStats', 'effectiveStats'])
      statBlock(
        sheet[key],
        key === 'baseStats',
        key === 'skillStageStats' && Object.hasOwn(sheet, 'skillPlanState'),
      );
    const build = r.exact(sheet['build'], 'raceCode pureClassOrNull skillSelections', '$.build');
    r.oneOf(build['raceCode'], ['PURE', 'FREE', 'UNITED'], '$.race');
    if (build['pureClassOrNull'] !== null)
      r.oneOf(build['pureClassOrNull'], ['SEEKER', 'STALKER', 'SOLDIER'], '$.class');
    for (const raw of r.list(build['skillSelections'], '$.skillSelections')) {
      const skill = r.exact(raw, 'skillKey targetBonus', '$.selection');
      r.text(skill['skillKey'], '$.skillKey');
      r.integer(skill['targetBonus'], '$.targetBonus', 1);
    }
    for (const raw of r.list(sheet['skills'], '$.skills')) {
      const skill = r.exact(raw, 'skillKey name source bonus slotCost', '$.skill');
      for (const key of ['skillKey', 'name']) r.text(skill[key], '$.' + key);
      if (
        !r.list(catalog['skills'], '$.skills').some((raw) => {
          const source = w.record(raw, '$.skill');
          return source['skillKey'] === skill['skillKey'] && source['name'] === skill['name'];
        })
      )
        r.invalid('$.sheet.skills', 'actual catalogue skill/name', null);
      r.oneOf(
        skill['source'],
        Object.hasOwn(rawSheet, 'compositionFacts')
          ? ['RACE_GRANTED', 'CLASS_MANDATORY', 'SELECTED', 'SYMBIONT_GRANTED', 'SYMBIONT_SELECTED']
          : ['RACE_GRANTED', 'CLASS_MANDATORY', 'SELECTED'],
        '$.source',
      );
      r.integer(skill['bonus'], '$.bonus', 0);
      r.integer(skill['slotCost'], '$.slotCost', 0);
    }
    const composed = Object.hasOwn(rawSheet, 'compositionFacts');
    const slots = r.exact(
      sheet['skillSlots'],
      'capacity used remaining' + (composed ? ' overflow' : ''),
      '$.skillSlots',
    );
    for (const key of Object.keys(slots)) r.integer(slots[key], '$.' + key, 0);
    if (
      composed
        ? slots['remaining'] !== Math.max(0, Number(slots['capacity']) - Number(slots['used'])) ||
          slots['overflow'] !== Math.max(0, Number(slots['used']) - Number(slots['capacity']))
        : slots['remaining'] !== 0 || slots['capacity'] !== slots['used']
    )
      r.invalid('$.skillSlots', 'actual current allocation/overflow', null);
    emptyShape(sheet['composition']);
    const composition = w.record(sheet['composition'], '$.composition');
    if (Object.hasOwn(composition, 'schemaVersion') !== Object.hasOwn(rawSheet, 'compositionFacts'))
      r.invalid('$.compositionFacts', 'source facts for the discriminated composition only', null);
    if (Object.hasOwn(rawSheet, 'compositionFacts')) {
      const decodedComposition = enemyComposedCompositionValue(composition);
      enemyCompositionBindings(decodedComposition, catalog['compositionCatalog']);
      const facts = enemyCompositionFactsShape(
        sheet['compositionFacts'],
        decodedComposition,
        catalog['compositionCatalog'],
        Object.hasOwn(sheet, 'skillPlanState')
          ? enemySkillPlanStateValue(sheet['skillPlanState'])
          : undefined,
      );
      enemyCompositionSkillBindings(facts, catalog['skills']);
    }
    const inventory = r.exact(
      sheet['inventory'],
      'inventoryItems armorCompatibilityReasonOrNull',
      '$.inventory',
    );
    inventoryShape(inventory);
    const items = r.list(sheet['items'], '$.items');
    for (const [index, raw] of items.entries()) {
      const item = r.exact(
        raw,
        'itemTemplateKey name profile quantity equipped equippedSlots',
        '$.item',
      );
      r.uuid(item['itemTemplateKey'], '$.itemTemplateKey');
      r.text(item['name'], '$.itemName');
      r.integer(item['quantity'], '$.quantity', 1);
      if (typeof item['equipped'] !== 'boolean') r.invalid('$.equipped', 'boolean', null);
      r.list(item['equippedSlots'], '$.equippedSlots').forEach((slot) =>
        r.oneOf(
          slot,
          ['HAND_L', 'HAND_R', 'HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'],
          '$.slot',
        ),
      );
      displayProfileShape(item['profile']);
      const input = r.list(inventory['inventoryItems'], '$.inventoryItems')[index];
      if (input === undefined) r.invalid('$.items', 'resolved own inventory row', null);
      const request = w.record(input, '$.inventoryItem');
      metadataInputBinding(request);
      const definition = r
        .list(catalog['items'], '$.catalog.items')
        .map((raw) => w.record(raw, '$.catalog.item'))
        .find((row) => row['itemTypeId'] === request['itemTypeId']);
      if (
        definition === undefined ||
        definition['name'] !== item['name'] ||
        request['quantity'] !== item['quantity'] ||
        request['equipped'] !== item['equipped'] ||
        !admissionJsonEqual(request['equippedSlots'], item['equippedSlots']) ||
        (context.attemptOrNull !== null &&
          context.attemptOrNull.itemTemplateKeys[index] !== item['itemTemplateKey'])
      )
        r.invalid('$.items', 'own input/catalogue/template key binding', null);
    }
    if (items.length !== r.list(inventory['inventoryItems'], '$.inventoryItems').length)
      r.invalid('$.items', 'one resolved profile per input', null);
    const armor = r.exact(
      sheet['armor'],
      'pieces layersByZone requiredStrength mobilityModifier runningModifier acrobaticsModifier dodgeModifier compatibilityRequiredItemIds',
      '$.armor',
    );
    for (const key of [
      'requiredStrength',
      'mobilityModifier',
      'runningModifier',
      'acrobaticsModifier',
      'dodgeModifier',
    ])
      numeric(armor[key], '$.armor.' + key);
    r.list(armor['pieces'], '$.armor.pieces');
    w.jsonObject(armor['layersByZone'], '$.armor.layers');
    r.list(armor['compatibilityRequiredItemIds'], '$.armor.compatibility');
    const penalties = r.exact(
      sheet['requirementPenalties'],
      'sourceRuleId armor weapons',
      '$.penalties',
    );
    w.literal(penalties['sourceRuleId'], 'CORE-016', '$.sourceRuleId');
    const armorPenalty = r.exact(
      penalties['armor'],
      'requiredStrength deficit penalty appliesTo',
      '$.armorPenalty',
    );
    for (const key of ['requiredStrength', 'deficit', 'penalty'])
      numeric(armorPenalty[key], '$.armorPenalty.' + key);
    r.list(armorPenalty['appliesTo'], '$.appliesTo');
    for (const raw of r.list(penalties['weapons'], '$.weaponPenalties')) {
      const weapon = r.exact(
        raw,
        'itemInstanceId statRequirements deficits deficitTotal penalty',
        '$.weaponPenalty',
      );
      r.uuid(weapon['itemInstanceId'], '$.itemTemplateKey');
      w.jsonObject(weapon['statRequirements'], '$.requirements');
      w.jsonObject(weapon['deficits'], '$.deficits');
      numeric(weapon['deficitTotal'], '$.deficitTotal');
      numeric(weapon['penalty'], '$.penalty');
    }
    numeric(sheet['classMovementModifier'], '$.classMovementModifier');
    r.integer(sheet['maxHP'], '$.maxHP', 1);
    w.literal(sheet['progressionPolicy'], 'NO_XP_PROGRESSION', '$.progressionPolicy');
    w.literal(sheet['artAssetKey'], ENEMY_PLACEHOLDER, '$.artAssetKey');
    if (context.attemptOrNull !== null) {
      const a = context.attemptOrNull;
      if (
        !admissionJsonEqual(sheet['identity'], a.identityOrNull) ||
        !admissionJsonEqual(sheet['baseStats'], a.baseStatsOrNull) ||
        !admissionJsonEqual(sheet['build'], a.buildOrNull) ||
        !admissionJsonEqual(sheet['composition'], a.compositionOrNull) ||
        !admissionJsonEqual(sheet['inventory'], a.inventoryOrNull) ||
        (a.skillPlanState === undefined
          ? Object.hasOwn(sheet, 'skillPlanState')
          : !Object.hasOwn(sheet, 'skillPlanState') ||
            !admissionJsonEqual(sheet['skillPlanState'], a.skillPlanState))
      )
        r.invalid('$.sheet', 'current complete attempt', null);
    }
  }
  if (
    (row['formId'] === 'ENM-020' ||
      (row['formId'] === 'ENM-010' && r.list(row['validationErrors'], '$.errors').length === 0)) &&
    row['sheetOrNull'] === null
  )
    r.invalid('$.sheetOrNull', 'complete confirmed sheet', null);
  return w.validated(row);
}
/** Closed structural state. Source mechanics are re-evaluated by the owning host observer. */
export function enemyAuthoringContextValue(value: unknown): EnemyAuthoringContext {
  const row = r.exact(value, 'attemptOrNull selectedVersionOrNull', '$.enemyAuthoring');
  if (row['selectedVersionOrNull'] !== null)
    enemyVersionIdentityValue(row['selectedVersionOrNull']);
  if (row['attemptOrNull'] !== null) {
    const rawAttempt = w.record(row['attemptOrNull'], '$.attempt');
    if (rawAttempt['kind'] === 'CUSTOM_MONSTER') {
      customMonsterAttemptValue(rawAttempt);
      return w.validated(row);
    }
    const attempt = r.exact(
      row['attemptOrNull'],
      'attemptId campaignId kind revision identityOrNull baseStatsOrNull buildOrNull compositionOrNull inventoryOrNull itemTemplateKeys' +
        (Object.hasOwn(rawAttempt, 'compositionAcquisitions') ? ' compositionAcquisitions' : '') +
        (Object.hasOwn(rawAttempt, 'schemaVersion')
          ? ' schemaVersion skillPlanState'
          : Object.hasOwn(rawAttempt, 'legacySkillPlanPreview')
            ? ' legacySkillPlanPreview'
            : ''),
      '$.attempt',
    );
    r.uuid(attempt['attemptId'], '$.attemptId');
    r.uuid(attempt['campaignId'], '$.campaignId');
    w.literal(attempt['kind'], 'SENTIENT', '$.kind');
    r.integer(attempt['revision'], '$.revision', 0);
    if (Object.hasOwn(attempt, 'legacySkillPlanPreview')) {
      const preview = enemySkillRebuildPreviewValue(attempt['legacySkillPlanPreview']);
      if (
        preview.planIdOrNull !== null ||
        preview.planRevision !== 0 ||
        preview.attemptId !== attempt['attemptId'] ||
        preview.sourceAttemptRevision + 1 !== attempt['revision'] ||
        !admissionJsonEqual(preview.initialInput.baseStats, attempt['baseStatsOrNull'])
      )
        r.invalid('$.legacySkillPlanPreview', 'own pending upgrade without an active plan', null);
    }
    if (Object.hasOwn(attempt, 'schemaVersion')) {
      w.literal(attempt['schemaVersion'], 2, '$.attempt.schemaVersion');
      const state = enemySkillPlanStateValue(attempt['skillPlanState']);
      const preview = state.rebuildPreviewOrNull;
      if (
        preview !== null &&
        (preview.attemptId !== attempt['attemptId'] ||
          preview.sourceAttemptRevision + 1 !== attempt['revision'] ||
          !admissionJsonEqual(preview.initialInput.baseStats, attempt['baseStatsOrNull']))
      )
        r.invalid('$.rebuildPreview', 'own current attempt and full input', null);
      if (
        attempt['compositionOrNull'] !== null &&
        (state.planOrNull === null ||
          !admissionJsonEqual(state.planOrNull.initialInput, {
            baseStats: attempt['baseStatsOrNull'],
            build: attempt['buildOrNull'],
          }))
      )
        r.invalid('$.skillPlan', 'current composed input', null);
      if (state.pendingChoicesOrNull !== null) {
        const composition = enemyComposedCompositionValue(attempt['compositionOrNull']);
        if (
          state.pendingChoicesOrNull.compositionPreviewCommandId !== composition.previewCommandId ||
          !admissionJsonEqual(
            {
              advisorSkills: state.pendingChoicesOrNull.advisorSkills,
              dolphinSkills: state.pendingChoicesOrNull.dolphinSkills,
            },
            composition.skills,
          )
        )
          r.invalid('$.pendingChoices', 'current confirmed composition choices', null);
      }
      const acquiredCards = Object.hasOwn(attempt, 'compositionAcquisitions')
        ? enemyCompositionAcquisitionsValue(attempt['compositionAcquisitions']).advisorCards
        : [];
      if (
        [...state.advisorKnowledge, ...state.advisorInitialFillHistory].some(
          (card) => !acquiredCards.some((source) => source.cardId === card.cardId),
        )
      )
        r.invalid('$.advisorKnowledge', 'actual acquired card identity', null);
    }
    if (attempt['identityOrNull'] !== null) identityShape(attempt['identityOrNull']);
    if (attempt['baseStatsOrNull'] !== null) statBlock(attempt['baseStatsOrNull'], true);
    if (attempt['buildOrNull'] !== null) buildShape(attempt['buildOrNull']);
    if (attempt['compositionOrNull'] !== null) {
      emptyShape(attempt['compositionOrNull']);
      if (
        Object.hasOwn(w.record(attempt['compositionOrNull'], '$.composition'), 'schemaVersion') !==
        Object.hasOwn(attempt, 'compositionAcquisitions')
      )
        r.invalid('$.compositionAcquisitions', 'new composition owns its acquisition ledger', null);
    }
    if (Object.hasOwn(attempt, 'compositionAcquisitions')) {
      enemyCompositionAcquisitionsValue(attempt['compositionAcquisitions']);
      if (
        attempt['compositionOrNull'] !== null &&
        (!Object.hasOwn(w.record(attempt['compositionOrNull'], '$.composition'), 'schemaVersion') ||
          !admissionJsonEqual(
            w.record(attempt['compositionOrNull'], '$.composition')['acquisitions'],
            attempt['compositionAcquisitions'],
          ))
      )
        r.invalid('$.composition', 'the persistent acquisition ledger must not be dropped', null);
    }
    const pendingPreview =
      attempt['schemaVersion'] === 2
        ? enemySkillPlanStateValue(attempt['skillPlanState']).rebuildPreviewOrNull
        : Object.hasOwn(attempt, 'legacySkillPlanPreview')
          ? enemySkillRebuildPreviewValue(attempt['legacySkillPlanPreview'])
          : null;
    if (pendingPreview !== null) {
      const ledger = Object.hasOwn(attempt, 'compositionAcquisitions')
        ? enemyCompositionAcquisitionsValue(attempt['compositionAcquisitions'])
        : null;
      const receipts =
        ledger === null
          ? []
          : [
              ...(ledger.freeSlotOrNull === null ? [] : [ledger.freeSlotOrNull.roll.rollReceiptId]),
              ...ledger.advisorCards.flatMap((card) => [
                ...card.iwRolls.map((roll) => roll.rollReceiptId),
                ...(card.suppressionRollOrNull === null
                  ? []
                  : [card.suppressionRollOrNull.rollReceiptId]),
              ]),
            ];
      if (
        pendingPreview.consequences.invalidateComposition !==
          (attempt['compositionOrNull'] !== null) ||
        pendingPreview.consequences.invalidateInventory !== (attempt['inventoryOrNull'] !== null) ||
        !admissionJsonEqual(pendingPreview.consequences.retainedRollReceiptIds, receipts)
      )
        r.invalid(
          '$.rebuildPreview.consequences',
          'actual cached stages and retained acquisition receipts',
          null,
        );
    }
    if (attempt['inventoryOrNull'] !== null) inventoryShape(attempt['inventoryOrNull']);
    r.list(attempt['itemTemplateKeys'], '$.itemTemplateKeys').forEach((key) =>
      r.uuid(key, '$.itemTemplateKey'),
    );
  }
  return w.validated(row);
}
export function newEnemyAttempt(
  attemptId: string,
  campaignId: string,
  schemaVersion?: 2,
): EnemyAuthoringContext {
  return enemyAuthoringContextValue({
    attemptOrNull: {
      attemptId,
      campaignId,
      kind: 'SENTIENT',
      revision: 0,
      identityOrNull: null,
      baseStatsOrNull: null,
      buildOrNull: null,
      compositionOrNull: null,
      inventoryOrNull: null,
      itemTemplateKeys: [],
      ...(schemaVersion === undefined
        ? {}
        : { schemaVersion, skillPlanState: emptyEnemySkillPlanState() }),
    },
    selectedVersionOrNull: null,
  });
}
export function reduceEnemyAuthoring(
  context: EnemyAuthoringContext,
  mutation: EnemyAuthoringMutation,
  formId: string,
  revisions: RevisionVector,
): { context: EnemyAuthoringContext; formId: EnemyAuthoringForm } {
  const request = mutation.request,
    payload = request.payload;
  const attempt = context.attemptOrNull ?? r.invalid('$.attempt', 'open technical attempt', null);
  if (
    attempt.attemptId !== payload.creationAttemptId ||
    attempt.campaignId !== payload.campaignId ||
    attempt.revision !== payload.expectedAttemptRevision
  )
    r.invalid('$.attempt', 'own current attempt revision', null);
  if (
    Object.keys(revisions).some(
      (key) =>
        revisions[key as keyof RevisionVector] !==
        request.expectedRevisions[key as keyof RevisionVector],
    )
  )
    r.invalid('$.expectedRevisions', 'current revisions', null);
  if (request.workflowCommandId === 'UI-CMD-ENEMY-COMMIT-V1') {
    if (
      formId !== (attempt.kind === 'CUSTOM_MONSTER' ? 'ENM-016' : 'ENM-010') ||
      mutation.committedVersionOrNull?.campaignId !== attempt.campaignId ||
      mutation.committedVersionOrNull.kind !== attempt.kind
    )
      r.invalid('$.commit', 'own ENM-010 attempt', null);
    return {
      context: { attemptOrNull: null, selectedVersionOrNull: mutation.committedVersionOrNull },
      formId: 'ENM-020',
    };
  }
  const stage = payload.stage ?? r.invalid('$.stage', 'PATCH stage', null);
  if (attempt.kind === 'CUSTOM_MONSTER') {
    if (
      !Object.hasOwn(CUSTOM_MONSTER_STAGE_FORMS, stage) ||
      mutation.preparedComposition !== undefined ||
      mutation.preparedSkillState !== undefined
    )
      return r.invalid('$.stage', 'closed CUSTOM_MONSTER kind', null);
    const forms = ENEMY_STAGE_FORMS[stage];
    if (formId !== forms[0]) r.invalid('$.stage', 'own current form', null);
    const next = reduceCustomMonsterAttempt(
      attempt,
      request,
      mutation.preparedMonsterComposition,
      mutation.preparedMonsterKnowledge,
    );
    return {
      context: { attemptOrNull: next, selectedVersionOrNull: null },
      formId:
        stage === 'MONSTER_SYMBIONT' && next.compositionOrNull?.phase !== 'CONFIRMED'
          ? 'ENM-015'
          : forms[1],
    };
  }
  if (
    stage.startsWith('MONSTER_') ||
    mutation.preparedMonsterComposition !== undefined ||
    mutation.preparedMonsterKnowledge !== undefined
  )
    return r.invalid('$.stage', 'closed SENTIENT kind', null);
  const sentientStage = r.oneOf(
    stage,
    [
      'SENTIENT_IDENTITY',
      'SENTIENT_STATS',
      'SENTIENT_BUILD',
      'SENTIENT_SYMBIONTS',
      'SENTIENT_INVENTORY',
    ],
    '$.stage',
  );
  if (attempt.schemaVersion === 2 && mutation.preparedSkillState === undefined)
    r.invalid('$.preparedSkillState', 'modern cause cannot downgrade to legacy', null);
  const buildPatch =
    stage === 'SENTIENT_BUILD' && Object.hasOwn(payload.data ?? {}, 'operation')
      ? enemyBuildPlanPatchValue(payload.data)
      : null;
  const forms = ENEMY_STAGE_FORMS[stage];
  if (formId !== forms[0]) r.invalid('$.stage', 'own current form', null);
  const key = {
    SENTIENT_IDENTITY: 'identityOrNull',
    SENTIENT_STATS: 'baseStatsOrNull',
    SENTIENT_BUILD: 'buildOrNull',
    SENTIENT_SYMBIONTS: 'compositionOrNull',
    SENTIENT_INVENTORY: 'inventoryOrNull',
  }[sentientStage];
  // Back is a real edit: dependent confirmations cannot trap mutually incompatible slot budgets.
  const invalidate =
    buildPatch?.operation === 'CONFIRM_REBUILD'
      ? { compositionOrNull: null, inventoryOrNull: null, itemTemplateKeys: [] }
      : stage === 'SENTIENT_STATS' && !admissionJsonEqual(attempt.baseStatsOrNull, payload.data)
        ? {
            buildOrNull: null,
            compositionOrNull: null,
            inventoryOrNull: null,
            itemTemplateKeys: [],
          }
        : stage === 'SENTIENT_BUILD' &&
            buildPatch === null &&
            !admissionJsonEqual(attempt.buildOrNull, payload.data)
          ? { compositionOrNull: null, inventoryOrNull: null, itemTemplateKeys: [] }
          : {};
  const data =
    buildPatch !== null
      ? buildPatch.operation === 'PREVIEW_REBUILD' || buildPatch.operation === 'DISCARD_REBUILD'
        ? attempt.buildOrNull
        : buildPatch.initialInput.build
      : stage === 'SENTIENT_IDENTITY' && typeof payload.data?.['name'] === 'string'
        ? { ...payload.data, name: payload.data['name'].trim() }
        : stage === 'SENTIENT_SYMBIONTS' && mutation.preparedComposition !== undefined
          ? mutation.preparedComposition
          : payload.data;
  const skillPreparation = mutation.preparedSkillState,
    priorComposition = attempt.compositionOrNull;
  const resolvedComposition =
    stage === 'SENTIENT_INVENTORY' &&
    skillPreparation !== undefined &&
    priorComposition !== null &&
    'schemaVersion' in priorComposition
      ? (() => {
          const composition = priorComposition;
          const gross = composition.acquisitions.grossGrantOrNull;
          const loss = skillPreparation.planOrNull?.accountingOrNull?.permanentLosses.find(
            (loss) => loss.skillKey === 'GROSS' && loss.commandId === request.commandId,
          );
          return gross !== null && gross.lostAtCommandIdOrNull === null && loss !== undefined
            ? {
                ...composition,
                acquisitions: {
                  ...composition.acquisitions,
                  grossGrantOrNull: { ...gross, lostAtCommandIdOrNull: loss.commandId },
                },
              }
            : composition;
        })()
      : null;
  const next = {
    ...attempt,
    ...invalidate,
    revision: attempt.revision + 1,
    [key]: data,
    ...(mutation.preparedSkillState === undefined
      ? {}
      : attempt.schemaVersion !== 2 && buildPatch?.operation === 'PREVIEW_REBUILD'
        ? {
            legacySkillPlanPreview:
              mutation.preparedSkillState.rebuildPreviewOrNull ??
              r.invalid('$.preview', 'pending legacy upgrade', null),
          }
        : attempt.schemaVersion !== 2 && buildPatch?.operation === 'DISCARD_REBUILD'
          ? {}
          : { schemaVersion: 2, skillPlanState: mutation.preparedSkillState }),
    ...(buildPatch?.operation === 'CONFIRM_REBUILD' && attempt.compositionAcquisitions !== undefined
      ? {
          compositionAcquisitions: {
            ...attempt.compositionAcquisitions,
            activeAdvisorCardIdOrNull: null,
            grossGrantOrNull: null,
            advisorCards: attempt.compositionAcquisitions.advisorCards.map((card) => ({
              ...card,
              skillsOrNull: null,
            })),
          },
        }
      : {}),
    ...(stage === 'SENTIENT_SYMBIONTS' && mutation.preparedComposition !== undefined
      ? {
          ...(admissionJsonEqual(attempt.compositionOrNull, mutation.preparedComposition)
            ? {}
            : { inventoryOrNull: null, itemTemplateKeys: [] }),
          compositionAcquisitions: mutation.preparedComposition.acquisitions,
        }
      : {}),
    ...(stage === 'SENTIENT_INVENTORY' ? { itemTemplateKeys: mutation.itemTemplateKeys } : {}),
    ...(resolvedComposition === null
      ? {}
      : {
          compositionOrNull: resolvedComposition,
          compositionAcquisitions: resolvedComposition.acquisitions,
        }),
  };
  if (!(attempt.schemaVersion !== 2 && buildPatch?.operation === 'PREVIEW_REBUILD'))
    delete next.legacySkillPlanPreview;
  return {
    context: enemyAuthoringContextValue({ attemptOrNull: next, selectedVersionOrNull: null }),
    formId:
      buildPatch?.operation === 'PREVIEW_REBUILD' || buildPatch?.operation === 'DISCARD_REBUILD'
        ? 'ENM-007'
        : stage === 'SENTIENT_SYMBIONTS' &&
            mutation.preparedComposition !== undefined &&
            mutation.preparedComposition.phase !== 'CONFIRMED'
          ? 'ENM-008'
          : forms[1],
  };
}
export function enemyAuthoringActions(p: EnemyAuthoringProjection): readonly ActionKey[] {
  const back = Object.entries(ENEMY_AUTHORING_NAV_TARGETS)
    .filter(([key]) => key.startsWith(p.formId + '::'))
    .map(([key]) => key as ActionKey);
  if (p.formId === 'ENM-020') return back;
  if (p.kind === 'CUSTOM_MONSTER_AUTHORING') {
    if (p.formId === 'ENM-016')
      return p.validationErrors.length === 0 ? [...back, 'ENM-016::CTA::002'] : back;
    const stage = Object.values(CUSTOM_MONSTER_STAGE_FORMS).find(([form]) => form === p.formId);
    return stage === undefined ? back : [...back, stage[2]];
  }
  if (p.formId === 'ENM-010')
    return p.validationErrors.length === 0 ? [...back, 'ENM-010::CTA::004'] : back;
  const stage = Object.values(ENEMY_STAGE_FORMS).find(([form]) => form === p.formId);
  if (
    p.formId === 'ENM-008' &&
    p.context.attemptOrNull?.kind === 'SENTIENT' &&
    p.context.attemptOrNull.compositionOrNull != null &&
    'schemaVersion' in p.context.attemptOrNull.compositionOrNull &&
    p.context.attemptOrNull.compositionOrNull.phase === 'PREVIEW'
  )
    return back;
  return stage === undefined ? back : [...back, stage[2]];
}
