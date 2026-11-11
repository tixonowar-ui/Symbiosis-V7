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

export const ENEMY_AUTHORING_FORMS = [
  'ENM-005',
  'ENM-006',
  'ENM-007',
  'ENM-008',
  'ENM-009',
  'ENM-010',
  'ENM-020',
] as const;
export type EnemyAuthoringForm = (typeof ENEMY_AUTHORING_FORMS)[number];
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
export interface EnemyAttempt {
  readonly attemptId: string;
  readonly campaignId: string;
  readonly kind: 'SENTIENT';
  readonly revision: number;
  readonly identityOrNull: EnemyIdentity | null;
  readonly baseStatsOrNull: EnemyStats | null;
  readonly buildOrNull: EnemyBuild | null;
  readonly compositionOrNull: EnemyEmptyComposition | null;
  readonly inventoryOrNull: EnemyInventory | null;
  readonly itemTemplateKeys: readonly string[];
}
export interface EnemyVersionIdentity {
  readonly campaignId: string;
  readonly templateId: string;
  readonly versionId: string;
  readonly version: 1;
  readonly kind: 'SENTIENT';
  readonly artAssetKey: typeof ENEMY_PLACEHOLDER;
  readonly artSha256: string;
}
export interface EnemyAuthoringContext {
  readonly attemptOrNull: EnemyAttempt | null;
  readonly selectedVersionOrNull: EnemyVersionIdentity | null;
}
export interface EnemyUserEntry extends EnemyVersionIdentity {
  readonly displayName: string;
}
export type EnemyPatchStage =
  | 'SENTIENT_IDENTITY'
  | 'SENTIENT_STATS'
  | 'SENTIENT_BUILD'
  | 'SENTIENT_SYMBIONTS'
  | 'SENTIENT_INVENTORY';
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
}
export interface EnemySheet {
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
  };
  readonly composition: EnemyEmptyComposition;
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
export interface EnemyAuthoringProjection extends RevisionVector {
  readonly kind: 'SENTIENT_ENEMY_AUTHORING';
  readonly formId: EnemyAuthoringForm;
  readonly contextId: string;
  readonly campaignId: string;
  readonly campaignStatus: 'PAUSED' | 'HOSTING';
  readonly context: EnemyAuthoringContext;
  readonly sheetOrNull: EnemySheet | null;
  readonly validationErrors: readonly string[];
  readonly catalog: JsonObject;
  readonly art: {
    readonly mediaType: 'image/png';
    readonly sha256: string;
    readonly bytesBase64: string;
  };
}
export const ENEMY_AUTHORING_NAV_TARGETS = {
  'ENM-001::CTA::003': 'ENM-005',
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
} as const;
export const ENEMY_STAGE_FORMS = {
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
  w.literal(row['kind'], 'SENTIENT', '$.kind');
  w.literal(row['artAssetKey'], ENEMY_PLACEHOLDER, '$.artAssetKey');
  if (typeof row['artSha256'] !== 'string' || !/^[a-f0-9]{64}$/u.test(row['artSha256']))
    r.invalid('$.artSha256', 'SHA-256', null);
  w.literal(row['artSha256'], ENEMY_PLACEHOLDER_SHA256, '$.artSha256');
  return w.validated(row);
}
export function enemyAuthoringMutationValue(value: unknown): EnemyAuthoringMutation {
  const row = r.exact(
    value,
    'request itemTemplateKeys committedVersionOrNull receiptId timestamp sourceBaselineVersion authorMasterProfileId',
    '$.enemyMutation',
  );
  r.text(row['sourceBaselineVersion'], '$.sourceBaselineVersion');
  r.uuid(row['authorMasterProfileId'], '$.authorMasterProfileId');
  const request = enemyWorkflowRequestValue(row['request']);
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
          ? 'ENM-010'
          : ENEMY_STAGE_FORMS[mutation.request.payload.stage][0],
      stageOrNull: mutation.request.payload.stage ?? null,
      attemptRevision:
        mutation.request.payload.expectedAttemptRevision +
        (mutation.committedVersionOrNull === null ? 1 : 0),
      committedVersionOrNull: mutation.committedVersionOrNull as unknown as JsonValue,
    },
  };
}
function numeric(value: unknown, path: string): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : r.invalid(path, 'finite number', null);
}
function statBlock(value: unknown, base: boolean): void {
  const row = r.exact(value, ENEMY_STATS.join(' '), '$.stats');
  for (const key of ENEMY_STATS)
    if (r.integer(row[key], '$.' + key, 1) > 35 && base)
      r.invalid('$.stats', 'base stat 1..35', null);
}
export function enemyAuthoringProjectionValue(value: unknown): EnemyAuthoringProjection {
  const row = r.exact(
    value,
    'kind formId contextId campaignId campaignStatus stateRevision projectionRevision actorVisibilityRevision context sheetOrNull validationErrors catalog art',
    '$.enemyAuthoringProjection',
  );
  w.literal(row['kind'], 'SENTIENT_ENEMY_AUTHORING', '$.kind');
  r.oneOf(row['formId'], ENEMY_AUTHORING_FORMS, '$.formId');
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
  if (row['formId'] !== 'ENM-020' && context.attemptOrNull === null)
    r.invalid('$.context.attemptOrNull', 'own open attempt', null);
  if (context.attemptOrNull !== null) {
    const formIndex = ENEMY_AUTHORING_FORMS.indexOf(row['formId'] as EnemyAuthoringForm);
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
  const catalog = r.exact(
    row['catalog'],
    'inventoryMetadata buildOptions races classes skills items',
    '$.catalog',
  );
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
    const sheet = r.exact(
      row['sheetOrNull'],
      'identity baseStats skillStageStats permanentStats effectiveStats build skills skillSlots composition inventory items armor requirementPenalties classMovementModifier maxHP progressionPolicy artAssetKey',
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
    for (const key of ['baseStats', 'skillStageStats', 'permanentStats', 'effectiveStats'])
      statBlock(sheet[key], key === 'baseStats');
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
      r.oneOf(skill['source'], ['RACE_GRANTED', 'CLASS_MANDATORY', 'SELECTED'], '$.source');
      r.integer(skill['bonus'], '$.bonus', 0);
      r.integer(skill['slotCost'], '$.slotCost', 0);
    }
    const slots = r.exact(sheet['skillSlots'], 'capacity used remaining', '$.skillSlots');
    for (const key of ['capacity', 'used', 'remaining']) r.integer(slots[key], '$.' + key, 0);
    if (slots['remaining'] !== 0 || slots['capacity'] !== slots['used'])
      r.invalid('$.skillSlots', 'complete allocation', null);
    const composition = r.exact(
      sheet['composition'],
      'symbiontCompositionMode ordinarySymbiontInstances symbioticMonsterProfileIdOrNull',
      '$.composition',
    );
    if (
      composition['symbiontCompositionMode'] !== 'ORDINARY_SYMBIONTS' ||
      r.list(composition['ordinarySymbiontInstances'], '$.ordinarySymbiontInstances').length !==
        0 ||
      composition['symbioticMonsterProfileIdOrNull'] !== null
    )
      r.invalid('$.composition', 'explicit empty composition', null);
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
        !admissionJsonEqual(sheet['inventory'], a.inventoryOrNull)
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
    const attempt = r.exact(
      row['attemptOrNull'],
      'attemptId campaignId kind revision identityOrNull baseStatsOrNull buildOrNull compositionOrNull inventoryOrNull itemTemplateKeys',
      '$.attempt',
    );
    r.uuid(attempt['attemptId'], '$.attemptId');
    r.uuid(attempt['campaignId'], '$.campaignId');
    w.literal(attempt['kind'], 'SENTIENT', '$.kind');
    r.integer(attempt['revision'], '$.revision', 0);
    if (attempt['identityOrNull'] !== null) identityShape(attempt['identityOrNull']);
    if (attempt['baseStatsOrNull'] !== null) statBlock(attempt['baseStatsOrNull'], true);
    if (attempt['buildOrNull'] !== null) buildShape(attempt['buildOrNull']);
    if (attempt['compositionOrNull'] !== null) emptyShape(attempt['compositionOrNull']);
    if (attempt['inventoryOrNull'] !== null) inventoryShape(attempt['inventoryOrNull']);
    r.list(attempt['itemTemplateKeys'], '$.itemTemplateKeys').forEach((key) =>
      r.uuid(key, '$.itemTemplateKey'),
    );
  }
  return w.validated(row);
}
export function newEnemyAttempt(attemptId: string, campaignId: string): EnemyAuthoringContext {
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
    if (formId !== 'ENM-010' || mutation.committedVersionOrNull?.campaignId !== attempt.campaignId)
      r.invalid('$.commit', 'own ENM-010 attempt', null);
    return {
      context: { attemptOrNull: null, selectedVersionOrNull: mutation.committedVersionOrNull },
      formId: 'ENM-020',
    };
  }
  const stage = payload.stage ?? r.invalid('$.stage', 'PATCH stage', null);
  const forms = ENEMY_STAGE_FORMS[stage];
  if (formId !== forms[0]) r.invalid('$.stage', 'own current form', null);
  const key = {
    SENTIENT_IDENTITY: 'identityOrNull',
    SENTIENT_STATS: 'baseStatsOrNull',
    SENTIENT_BUILD: 'buildOrNull',
    SENTIENT_SYMBIONTS: 'compositionOrNull',
    SENTIENT_INVENTORY: 'inventoryOrNull',
  }[stage];
  // Back is a real edit: dependent confirmations cannot trap mutually incompatible slot budgets.
  const invalidate =
    stage === 'SENTIENT_STATS' && !admissionJsonEqual(attempt.baseStatsOrNull, payload.data)
      ? { buildOrNull: null, compositionOrNull: null, inventoryOrNull: null, itemTemplateKeys: [] }
      : stage === 'SENTIENT_BUILD' && !admissionJsonEqual(attempt.buildOrNull, payload.data)
        ? { compositionOrNull: null, inventoryOrNull: null, itemTemplateKeys: [] }
        : {};
  const data =
    stage === 'SENTIENT_IDENTITY' && typeof payload.data?.['name'] === 'string'
      ? { ...payload.data, name: payload.data['name'].trim() }
      : payload.data;
  const next = {
    ...attempt,
    ...invalidate,
    revision: attempt.revision + 1,
    [key]: data,
    ...(stage === 'SENTIENT_INVENTORY' ? { itemTemplateKeys: mutation.itemTemplateKeys } : {}),
  };
  return {
    context: enemyAuthoringContextValue({ attemptOrNull: next, selectedVersionOrNull: null }),
    formId: forms[1],
  };
}
export function enemyAuthoringActions(p: EnemyAuthoringProjection): readonly ActionKey[] {
  const back = Object.entries(ENEMY_AUTHORING_NAV_TARGETS)
    .filter(([key]) => key.startsWith(p.formId + '::'))
    .map(([key]) => key as ActionKey);
  if (p.formId === 'ENM-020') return back;
  if (p.formId === 'ENM-010')
    return p.validationErrors.length === 0 ? [...back, 'ENM-010::CTA::004'] : back;
  const stage = Object.values(ENEMY_STAGE_FORMS).find(([form]) => form === p.formId);
  return stage === undefined ? back : [...back, stage[2]];
}
