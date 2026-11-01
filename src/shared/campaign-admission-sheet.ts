import { ADMISSION_WEAPON_PROPERTY_KEYS } from './campaign-admission.js';
import type {
  AdmissionMechanicalSheetV1,
  AdmissionMechanicalCore,
  AdmissionPublicWeaponProfile,
  AdmissionSheetSkill,
} from './campaign-admission.js';
import {
  admissionCodecReaders,
  admissionStatsValue,
  admissionMassReviewValue,
  admissionMoneyReviewValue,
  admissionGroupAssignmentValue,
  admissionLocationAssignmentValue,
  admissionInventoryReviewValue,
} from './campaign-admission-codec.js';
import { redactProtocolInputRefusal, wireCodecPrimitives } from './wire-codec.js';
import type { DecodeResult, JsonValue } from './wire-protocol.js';

const { exact, oneOf, integer, finite, list, unique, nullable, text, invalid, validated } =
  admissionCodecReaders;
const STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
export const ADMISSION_SHEET_SECTIONS = [
  'identity',
  'race',
  'classOrNull',
  'creationMode',
  'stats',
  'skills',
  'symbionts',
  'advisorOrNull',
  'permanentGrants',
  'trainingSlotLedger',
  'runtime',
  'massReview',
  'inventoryReview',
  'moneyReview',
  'groupAssignmentOrNull',
  'locationAssignmentOrNull',
] as const;
const INTERNAL =
  /\b(?:CORE|AQ\d?|AQA|CQA|F-WPN|CVD-WPN|RG-WPN|SYM)-[A-Z0-9-]+\b|availabilityTrace|privateReplayWitness/u;
function publicText(value: unknown, path: string): string {
  const result = text(value, path);
  return INTERNAL.test(result) ? invalid(path, 'public mechanical text', null) : result;
}
function literal(value: unknown, expected: JsonValue, path: string): void {
  if (value !== expected) invalid(path, 'canonical admission value', null);
}
function boolean(value: unknown, path: string): void {
  if (typeof value !== 'boolean') invalid(path, 'boolean', null);
}
function positive(value: unknown, path: string): number {
  const n = finite(value, path, 0);
  return n > 0 ? n : invalid(path, 'positive finite number', null);
}
function empty(value: unknown, path: string): void {
  if (list(value, path).length !== 0) invalid(path, 'empty initial runtime array', null);
}
function combatValue(value: unknown, kind: 'DAMAGE' | 'PENETRATION', path: string): void {
  const row = exact(
    value,
    'valueMode sourceNotation baseExpression sourceScope evaluationScope instanceSourceFieldOrNull conditionalOverrideOrNull effectiveTemplateExpression damageModifierStat dieType rollKind progressionEligibility rawRollPersistence resolvedResultField resolvedResultPersistence',
    path,
  );
  const mode = oneOf(
    row['valueMode'],
    ['INSTANCE_VALUE', 'CONSTANT', 'PER_ATTACK_ROLL'],
    `${path}.valueMode`,
  );
  for (const key of ['sourceNotation', 'baseExpression', 'effectiveTemplateExpression'])
    publicText(row[key], `${path}.${key}`);
  oneOf(row['sourceScope'], ['WEAPON_PROFILE_VERSION', 'ITEM_TEMPLATE'], `${path}.sourceScope`);
  literal(
    row['evaluationScope'],
    mode === 'PER_ATTACK_ROLL' ? 'EACH_RESOLVED_ATTACK' : 'PROFILE_SNAPSHOT',
    `${path}.evaluationScope`,
  );
  literal(
    row['instanceSourceFieldOrNull'],
    mode === 'INSTANCE_VALUE' ? 'instanceDamage' : null,
    `${path}.instanceSourceFieldOrNull`,
  );
  if (mode === 'INSTANCE_VALUE') {
    literal(kind, 'DAMAGE', path);
    literal(row['baseExpression'], 'item.instanceDamage', `${path}.baseExpression`);
  }
  nullable(row['conditionalOverrideOrNull'], `${path}.conditionalOverrideOrNull`, publicText);
  oneOf(row['damageModifierStat'], ['NONE', 'S', 'D'], `${path}.damageModifierStat`);
  oneOf(row['dieType'], ['NONE', 'OTHER_DIE', 'D20'], `${path}.dieType`);
  literal(row['rollKind'], kind, `${path}.rollKind`);
  oneOf(
    row['progressionEligibility'],
    ['NEVER_PROGRESSION', 'NO_DIRECT_BUT_POOL'],
    `${path}.progressionEligibility`,
  );
  literal(
    row['rawRollPersistence'],
    mode === 'PER_ATTACK_ROLL' ? 'ATTACK_RESOLUTION_AND_COMBAT_LOG' : 'NOT_APPLICABLE',
    `${path}.rawRollPersistence`,
  );
  literal(
    row['resolvedResultField'],
    kind === 'DAMAGE' ? 'resolvedDamage' : 'resolvedPenetration',
    `${path}.resolvedResultField`,
  );
  literal(
    row['resolvedResultPersistence'],
    'ATTACK_RESOLUTION_AND_COMBAT_LOG',
    `${path}.resolvedResultPersistence`,
  );
}
export function admissionPublicWeaponProfileValue(
  value: unknown,
  path = '$',
): AdmissionPublicWeaponProfile {
  const row = exact(
    value,
    'weaponTypeId weaponVariantId name variantLabel statSource damageDefinition penetrationDefinition statRequirements instanceDamageOrNull rangeMetersOrNull accuracyBonusOrNull properties',
    path,
  );
  const itemId = text(row['weaponTypeId'], `${path}.weaponTypeId`);
  if (!/^ITM-WPN-\d+$/u.test(itemId)) invalid(`${path}.weaponTypeId`, 'catalog weapon type', null);
  oneOf(
    row['weaponVariantId'],
    ['DEFAULT', 'ONE_HAND', 'TWO_HAND', 'SWORD', 'SHIELD', 'RAPIER'],
    `${path}.weaponVariantId`,
  );
  publicText(row['name'], `${path}.name`);
  publicText(row['variantLabel'], `${path}.variantLabel`);
  oneOf(
    row['statSource'],
    ['TEMPLATE_FIXED', 'PLAYER_FORMULA_VALIDATED', 'MASTER_OVERRIDE'],
    `${path}.statSource`,
  );
  combatValue(row['damageDefinition'], 'DAMAGE', `${path}.damageDefinition`);
  combatValue(row['penetrationDefinition'], 'PENETRATION', `${path}.penetrationDefinition`);
  const requirements = wireCodecPrimitives.record(
    row['statRequirements'],
    `${path}.statRequirements`,
  );
  for (const [key, n] of Object.entries(requirements)) {
    oneOf(key, STATS, `${path}.statRequirements`);
    positive(n, `${path}.statRequirements.${key}`);
  }
  const damage = wireCodecPrimitives.record(row['damageDefinition'], `${path}.damageDefinition`);
  if (damage['valueMode'] === 'INSTANCE_VALUE')
    positive(row['instanceDamageOrNull'], `${path}.instanceDamageOrNull`);
  else literal(row['instanceDamageOrNull'], null, `${path}.instanceDamageOrNull`);
  nullable(row['rangeMetersOrNull'], `${path}.rangeMetersOrNull`, positive);
  nullable(row['accuracyBonusOrNull'], `${path}.accuracyBonusOrNull`, positive);
  const properties = wireCodecPrimitives.record(row['properties'], `${path}.properties`);
  for (const [key, entry] of Object.entries(properties)) {
    oneOf(key, ADMISSION_WEAPON_PROPERTY_KEYS, `${path}.properties`);
    if (key === 'Можно метать' || key === 'Перезарядка атомарна')
      boolean(entry, `${path}.properties.${key}`);
    else if (typeof entry === 'number')
      finite(entry, `${path}.properties.${key}`, -Number.MAX_VALUE);
    else if (typeof entry === 'boolean') boolean(entry, `${path}.properties.${key}`);
    else publicText(entry, `${path}.properties.${key}`);
  }
  return validated(row);
}
export function admissionSheetSkillEntriesValue(
  value: unknown,
  path: string,
): readonly AdmissionSheetSkill[] {
  const entries = list(value, path).map((value, index) => {
    const p = `${path}[${String(index)}]`;
    const row = exact(value, 'skillKey label source bonus slotCost', p);
    publicText(row['skillKey'], `${p}.skillKey`);
    publicText(row['label'], `${p}.label`);
    oneOf(
      row['source'],
      ['SELECTED', 'RACE_GRANTED', 'CLASS_MANDATORY', 'SYMBIONT_PERMANENT'],
      `${p}.source`,
    );
    integer(row['bonus'], `${p}.bonus`, 1);
    integer(row['slotCost'], `${p}.slotCost`, 0);
    return validated<AdmissionSheetSkill>(row);
  });
  unique(
    entries.map((entry) => entry.skillKey),
    path,
  );
  return entries;
}
function runtimeValue(value: unknown, path: string): void {
  const truth = ['alive', 'conscious'],
    falsehood = ['stunned', 'bound', 'burning', 'poisoned', 'diseased'];
  const arrays = [
    'wounds',
    'injuries',
    'bleeding',
    'temporaryEffects',
    'cooldowns',
    'preparations',
    'combatUsageLimits',
    'equippedItems',
    'generatedObjects',
    'externalEntities',
    'chimeraDevouringHistory',
  ];
  const zeros = ['symbiontXpProgressPoints', 'unallocatedSymbiontXp', 'chimeraExtraSlots'];
  const flags = ['penguinMiMiMiActive', 'ratInsideHost', 'keeperInsideHost'];
  const row = exact(
    value,
    [
      'maxHp',
      'currentHp',
      ...truth,
      ...falsehood,
      ...arrays,
      ...zeros,
      ...flags,
      'initiativeOrNull',
      'combatSceneIdOrNull',
      'statProgressionCounters',
      'taipanPoisonOrNull',
      'mantisBladeStateOrNull',
    ].join(' '),
    path,
  );
  integer(row['maxHp'], `${path}.maxHp`, 1);
  literal(row['currentHp'], row['maxHp'] as number, `${path}.currentHp`);
  for (const key of truth) literal(row[key], true, `${path}.${key}`);
  for (const key of falsehood) literal(row[key], false, `${path}.${key}`);
  for (const key of arrays) empty(row[key], `${path}.${key}`);
  for (const key of zeros) literal(row[key], 0, `${path}.${key}`);
  for (const key of flags) boolean(row[key], `${path}.${key}`);
  literal(row['initiativeOrNull'], null, `${path}.initiativeOrNull`);
  literal(row['combatSceneIdOrNull'], null, `${path}.combatSceneIdOrNull`);
  const counters = admissionStatsValue(
    row['statProgressionCounters'],
    `${path}.statProgressionCounters`,
  );
  for (const key of STATS) literal(counters[key], 0, `${path}.statProgressionCounters.${key}`);
  nullable(row['taipanPoisonOrNull'], `${path}.taipanPoisonOrNull`, (v, p) =>
    literal(v, 'DEADLY', p),
  );
  nullable(row['mantisBladeStateOrNull'], `${path}.mantisBladeStateOrNull`, (v, p) =>
    literal(v, 'ORDINARY', p),
  );
}
function mechanicalValue(
  value: unknown,
  path: string,
  coreOnly: boolean,
): AdmissionMechanicalSheetV1 | AdmissionMechanicalCore {
  const coreSections = ADMISSION_SHEET_SECTIONS.slice(0, 11);
  const row = exact(
    value,
    `schemaVersion ${(coreOnly ? coreSections : ADMISSION_SHEET_SECTIONS).join(' ')}`,
    path,
  );
  literal(row['schemaVersion'], 1, `${path}.schemaVersion`);
  const identity = exact(row['identity'], 'name age sex massKg', `${path}.identity`);
  text(identity['name'], `${path}.identity.name`);
  integer(identity['age'], `${path}.identity.age`, 1);
  oneOf(identity['sex'], ['MALE', 'FEMALE'], `${path}.identity.sex`);
  admissionMassReviewValue(
    { massKg: identity['massKg'], decision: 'PENDING_MASTER_APPROVAL' },
    `${path}.identity.massKg`,
  );
  if (!coreOnly) {
    const mass = admissionMassReviewValue(row['massReview'], `${path}.massReview`);
    literal(identity['massKg'], mass.massKg, `${path}.identity.massKg`);
  }
  const race = exact(row['race'], 'code label', `${path}.race`);
  oneOf(race['code'], ['FREE', 'PURE', 'UNITED'], `${path}.race.code`);
  publicText(race['label'], `${path}.race.label`);
  const classValue = nullable(row['classOrNull'], `${path}.classOrNull`, (v, p) => {
    const c = exact(v, 'code label', p);
    oneOf(c['code'], ['SEEKER', 'SOLDIER', 'STALKER'], `${p}.code`);
    publicText(c['label'], `${p}.label`);
    return c;
  });
  if ((race['code'] === 'PURE') !== (classValue !== null))
    invalid(`${path}.classOrNull`, 'class for PURE only', null);
  if (race['code'] === 'PURE') literal(row['creationMode'], null, `${path}.creationMode`);
  else oneOf(row['creationMode'], ['MANUAL', 'RANDOM'], `${path}.creationMode`);
  const stats = exact(
    row['stats'],
    'acceptedBase permanentGmAdjustments backpackItemAdjustments skillStageStats effectiveStats statProof',
    `${path}.stats`,
  );
  for (const key of [
    'acceptedBase',
    'permanentGmAdjustments',
    'backpackItemAdjustments',
    'skillStageStats',
    'effectiveStats',
  ]) {
    const block = admissionStatsValue(stats[key], `${path}.stats.${key}`);
    if (key === 'acceptedBase' || key === 'effectiveStats' || key === 'backpackItemAdjustments')
      for (const stat of STATS)
        integer(
          block[stat],
          `${path}.stats.${key}.${stat}`,
          key === 'backpackItemAdjustments' ? 0 : 1,
        );
  }
  const proofs = list(stats['statProof'], `${path}.stats.statProof`).map((proof, index) => {
    const p = `${path}.stats.statProof[${String(index)}]`;
    const r = exact(
      proof,
      'statCode skillStageValue positiveSymbiontDelta negativeSymbiontDelta appliedNegativeDelta beforeLimits minimumOrNull maximumOrNull effectiveValue',
      p,
    );
    const stat = oneOf(r['statCode'], STATS, `${p}.statCode`);
    for (const key of [
      'skillStageValue',
      'positiveSymbiontDelta',
      'negativeSymbiontDelta',
      'appliedNegativeDelta',
      'beforeLimits',
      'effectiveValue',
    ])
      integer(r[key], `${p}.${key}`, Number.MIN_SAFE_INTEGER);
    const min = nullable(r['minimumOrNull'], `${p}.minimumOrNull`, (v, p) => integer(v, p, 1));
    const max = nullable(r['maximumOrNull'], `${p}.maximumOrNull`, (v, p) => integer(v, p, 1));
    if (min !== null && max !== null && min > max) invalid(p, 'ordered stat bounds', null);
    const stage = admissionStatsValue(stats['skillStageStats']),
      backpack = admissionStatsValue(stats['backpackItemAdjustments']),
      effective = admissionStatsValue(stats['effectiveStats']);
    literal(r['skillStageValue'], stage[stat], `${p}.skillStageValue`);
    literal(
      r['beforeLimits'],
      stage[stat] +
        (r['positiveSymbiontDelta'] as number) +
        (r['appliedNegativeDelta'] as number) +
        backpack[stat],
      `${p}.beforeLimits`,
    );
    literal(
      r['effectiveValue'],
      Math.max(min ?? -Infinity, Math.min(max ?? Infinity, r['beforeLimits'] as number)),
      `${p}.effectiveValue`,
    );
    literal(r['effectiveValue'], effective[stat], `${p}.effectiveValue`);
    return stat;
  });
  if (proofs.length !== STATS.length)
    invalid(`${path}.stats.statProof`, 'one proof per stat', null);
  unique(proofs, `${path}.stats.statProof`);
  const skills = exact(
    row['skills'],
    'entries maxSlots usedSlots remainingSlots requirementsSatisfied',
    `${path}.skills`,
  );
  const learned = admissionSheetSkillEntriesValue(skills['entries'], `${path}.skills.entries`);
  const maxSlots = integer(skills['maxSlots'], `${path}.skills.maxSlots`, 1);
  const used = integer(skills['usedSlots'], `${path}.skills.usedSlots`, 0);
  if (used > maxSlots) invalid(`${path}.skills`, 'starting pool within original capacity', null);
  literal(
    used,
    learned.reduce((sum, skill) => sum + skill.slotCost, 0),
    `${path}.skills.usedSlots`,
  );
  literal(skills['remainingSlots'], maxSlots - used, `${path}.skills.remainingSlots`);
  literal(skills['requirementsSatisfied'], true, `${path}.skills.requirementsSatisfied`);
  const symbionts = list(row['symbionts'], `${path}.symbionts`).map((entry, index) => {
    const p = `${path}.symbionts[${String(index)}]`;
    const r = exact(
      entry,
      'acceptedIndex speciesKey label status level maxOe currentOe xp effectsEnabled xpEligible learnedNodes binding',
      p,
    );
    const acceptedIndex = integer(r['acceptedIndex'], `${p}.acceptedIndex`, 0);
    publicText(r['speciesKey'], `${p}.speciesKey`);
    publicText(r['label'], `${p}.label`);
    const status = oneOf(
      r['status'],
      ['ACTIVE', 'SUPPRESSED', 'ABSORBED', 'DESTROYED'],
      `${p}.status`,
    );
    integer(r['level'], `${p}.level`, 1);
    const maxOe = finite(r['maxOe'], `${p}.maxOe`, 0),
      currentOe = finite(r['currentOe'], `${p}.currentOe`, 0);
    if (currentOe > maxOe) invalid(p, 'OE within maximum', null);
    literal(r['xp'], 0, `${p}.xp`);
    literal(r['effectsEnabled'], status === 'ACTIVE', `${p}.effectsEnabled`);
    boolean(r['xpEligible'], `${p}.xpEligible`);
    for (const [i, node] of list(r['learnedNodes'], `${p}.learnedNodes`).entries()) {
      const n = `${p}.learnedNodes[${String(i)}]`,
        nr = exact(node, 'label level', n);
      publicText(nr['label'], `${n}.label`);
      integer(nr['level'], `${n}.level`, 1);
    }
    const b = wireCodecPrimitives.record(r['binding'], `${p}.binding`);
    const kind = oneOf(
      b['kind'],
      [
        'NONE',
        'OWL_EYE',
        'EEL_ARM',
        'TICK_RIGHT_HAND',
        'SPIDER_BOTH_WRISTS',
        'MANTIS_BOTH_FOREARMS',
      ],
      `${p}.binding.kind`,
    );
    exact(b, kind === 'OWL_EYE' || kind === 'EEL_ARM' ? 'kind side' : 'kind', `${p}.binding`);
    if (kind === 'OWL_EYE' || kind === 'EEL_ARM')
      oneOf(b['side'], ['LEFT', 'RIGHT'], `${p}.binding.side`);
    return String(acceptedIndex);
  });
  unique(symbionts, `${path}.symbionts`);
  if (race['code'] === 'PURE' && symbionts.length !== 0)
    invalid(`${path}.symbionts`, 'no PURE symbionts', null);
  nullable(row['advisorOrNull'], `${path}.advisorOrNull`, (v, p) => {
    const a = exact(v, 'intelligence wisdom suppressionBonusOrNull skills', p);
    integer(a['intelligence'], `${p}.intelligence`, 1);
    integer(a['wisdom'], `${p}.wisdom`, 1);
    nullable(a['suppressionBonusOrNull'], `${p}.suppressionBonusOrNull`, (v, p) => {
      if (integer(v, p, 0) > 5) invalid(p, 'suppression bonus from D20/4', null);
    });
    admissionSheetSkillEntriesValue(a['skills'], `${p}.skills`);
  });
  const grants = list(row['permanentGrants'], `${path}.permanentGrants`);
  if (grants.length > 1) invalid(`${path}.permanentGrants`, 'at most one permanent grant', null);
  for (const [i, entry] of grants.entries()) {
    const p = `${path}.permanentGrants[${String(i)}]`,
      grant = exact(entry, 'kind bonusBefore bonusAfter', p);
    literal(grant['kind'], 'TROGR_GROSS', `${p}.kind`);
    integer(grant['bonusBefore'], `${p}.bonusBefore`, 0);
    integer(grant['bonusAfter'], `${p}.bonusAfter`, 1);
  }
  const ledger = exact(
    row['trainingSlotLedger'],
    'maxPermanentWisdom everIssued',
    `${path}.trainingSlotLedger`,
  );
  integer(ledger['maxPermanentWisdom'], `${path}.trainingSlotLedger.maxPermanentWisdom`, 0);
  literal(
    ledger['everIssued'],
    Math.floor((ledger['maxPermanentWisdom'] as number) / 2),
    `${path}.trainingSlotLedger.everIssued`,
  );
  runtimeValue(row['runtime'], `${path}.runtime`);
  if (coreOnly) return validated(row);
  const inventory = exact(
    row['inventoryReview'],
    'status entries unresolvedSourceEntryIds',
    `${path}.inventoryReview`,
  );
  const entries = list(inventory['entries'], `${path}.inventoryReview.entries`).map((v, i) => {
    const p = `${path}.inventoryReview.entries[${String(i)}]`;
    const e = exact(
      v,
      'reviewItemId sourceEntryIdOrNull item quantity qualityLabel weaponDecisionReceiptIdOrNull weaponProfileOrNull equipmentState',
      p,
    );
    literal(e['equipmentState'], 'UNEQUIPPED', `${p}.equipmentState`);
    nullable(
      e['weaponProfileOrNull'],
      `${p}.weaponProfileOrNull`,
      admissionPublicWeaponProfileValue,
    );
    return Object.fromEntries(
      [
        'reviewItemId',
        'sourceEntryIdOrNull',
        'item',
        'quantity',
        'qualityLabel',
        'weaponDecisionReceiptIdOrNull',
      ].map((key) => [key, e[key]]),
    );
  });
  admissionInventoryReviewValue(
    {
      status: inventory['status'],
      entries,
      unresolvedSourceEntryIds: inventory['unresolvedSourceEntryIds'],
    },
    `${path}.inventoryReview`,
  );
  admissionMoneyReviewValue(row['moneyReview'], `${path}.moneyReview`);
  nullable(
    row['groupAssignmentOrNull'],
    `${path}.groupAssignmentOrNull`,
    admissionGroupAssignmentValue,
  );
  nullable(
    row['locationAssignmentOrNull'],
    `${path}.locationAssignmentOrNull`,
    admissionLocationAssignmentValue,
  );
  return validated(row);
}
/** Unfinished review mechanics have no invented inventory profiles or assignments. */
export function admissionMechanicalCoreValue(
  value: unknown,
  path = '$.core',
): AdmissionMechanicalCore {
  return validated(mechanicalValue(value, path, true));
}
export function admissionMechanicalSheetValue(
  value: unknown,
  path = '$',
): AdmissionMechanicalSheetV1 {
  return validated(mechanicalValue(value, path, false));
}
export function decodeAdmissionMechanicalSheet(
  source: string,
): DecodeResult<AdmissionMechanicalSheetV1> {
  if (typeof source !== 'string')
    return {
      ok: false,
      refusal: {
        code: 'INVALID_SHAPE',
        path: '$',
        expected: 'JSON string',
        actualType: source === null ? 'null' : typeof source,
      },
    };
  const result = wireCodecPrimitives.parse(source, admissionMechanicalSheetValue);
  return result.ok ? result : { ok: false, refusal: redactProtocolInputRefusal(result.refusal) };
}

export interface AdmissionMechanicalChange {
  readonly section: 'STATS' | 'SKILLS' | 'MASS' | 'INVENTORY' | 'MONEY' | 'GROUP_LOCATION';
  /** JSON pointer under the stated section; values are proven by recomputing the full diff. */
  readonly fieldPath: string;
  readonly beforeValue: JsonValue;
  readonly afterValue: JsonValue;
}
/** NET-021 groups complete sheet paths into its six public diff sections. */
const CHANGE_SECTION: Readonly<
  Record<(typeof ADMISSION_SHEET_SECTIONS)[number], AdmissionMechanicalChange['section']>
> = {
  identity: 'MASS',
  race: 'STATS',
  classOrNull: 'STATS',
  creationMode: 'STATS',
  stats: 'STATS',
  skills: 'SKILLS',
  symbionts: 'STATS',
  advisorOrNull: 'SKILLS',
  permanentGrants: 'SKILLS',
  trainingSlotLedger: 'SKILLS',
  runtime: 'STATS',
  massReview: 'MASS',
  inventoryReview: 'INVENTORY',
  moneyReview: 'MONEY',
  groupAssignmentOrNull: 'GROUP_LOCATION',
  locationAssignmentOrNull: 'GROUP_LOCATION',
};
/** Input sheets are closed-validated first. No caller-supplied change list is trusted. */
export function admissionMechanicalChanges(
  before: AdmissionMechanicalSheetV1,
  after: AdmissionMechanicalSheetV1,
): readonly AdmissionMechanicalChange[] {
  admissionMechanicalSheetValue(before, '$.before');
  admissionMechanicalSheetValue(after, '$.after');
  const changes: AdmissionMechanicalChange[] = [];
  const walk = (
    a: unknown,
    b: unknown,
    section: AdmissionMechanicalChange['section'],
    fieldPath: string,
  ): void => {
    if (a === b) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.max(a.length, b.length); i++)
        walk(a[i] ?? null, b[i] ?? null, section, `${fieldPath}/${String(i)}`);
      return;
    }
    if (
      a !== null &&
      b !== null &&
      typeof a === 'object' &&
      typeof b === 'object' &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      const x = a as Record<string, unknown>,
        y = b as Record<string, unknown>;
      for (const key of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort())
        walk(
          x[key] ?? null,
          y[key] ?? null,
          section,
          `${fieldPath}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        );
      return;
    }
    changes.push(
      Object.freeze({
        section,
        fieldPath,
        beforeValue: structuredClone(a) as JsonValue,
        afterValue: structuredClone(b) as JsonValue,
      }),
    );
  };
  for (const section of ADMISSION_SHEET_SECTIONS)
    walk(before[section], after[section], CHANGE_SECTION[section], `/${section}`);
  return Object.freeze(changes);
}

/** Every value and path must match the two complete sheets, including removed entries. */
export function admissionMechanicalChangesValue(
  value: unknown,
  before: AdmissionMechanicalSheetV1,
  after: AdmissionMechanicalSheetV1,
  path = '$.changes',
): readonly AdmissionMechanicalChange[] {
  const expected = admissionMechanicalChanges(before, after);
  const same = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b))
      return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((entry, index) => same(entry, b[index]))
      );
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    const x = a as Record<string, unknown>,
      y = b as Record<string, unknown>;
    return (
      Object.keys(x).length === Object.keys(y).length &&
      Object.keys(x).every((key) => Object.hasOwn(y, key) && same(x[key], y[key]))
    );
  };
  if (!same(value, expected))
    invalid(path, 'complete mechanical changes derived from both sheets', null);
  return expected;
}
