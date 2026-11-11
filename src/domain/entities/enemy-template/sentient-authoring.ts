import type { SkillStageCatalog } from '../../rules/skill-stage/catalog.js';
import { calculateSkillStageStats } from '../../rules/skill-stage/stats.js';
import { validateSkillSelection } from '../../rules/skill-stage/skills.js';
import {
  buildNpcInventoryPreview,
  type NpcInventoryPublicationCatalog,
} from '../../rules/npc-authoring/inventory-publication.js';
import {
  deriveNpcArmorContribution,
  type NpcInventoryCatalog,
} from '../../rules/npc-authoring/inventory.js';
import {
  deriveNpcPassiveHealthComponent,
  type NpcPassiveHealthCatalog,
} from '../../rules/npc-authoring/passive-health.js';
import {
  deriveNpcEquipmentRequirementPenalties,
  type NpcEquipmentCatalog,
} from '../../rules/npc-authoring/equipment-profile.js';
import { admissionCodecReaders as r } from '@shared/campaign-admission-codec.js';
import { wireCodecPrimitives as w } from '@shared/wire-codec.js';
import type { JsonObject, JsonValue } from '@shared/wire-protocol.js';
import {
  ENEMY_PLACEHOLDER,
  ENEMY_STATS,
  type EnemyAttempt,
  type EnemyIdentity,
  type EnemyBuild,
  type EnemyStats,
  type EnemyEmptyComposition,
  type EnemyInventory,
  type EnemySheet,
} from '@shared/enemy-authoring.js';

export interface SentientAuthoringCatalog {
  readonly equipment: NpcEquipmentCatalog;
  readonly skillLabels: Readonly<Record<string, string>>;
  readonly skills: SkillStageCatalog;
  readonly inventory: NpcInventoryCatalog;
  readonly inventoryPublication: NpcInventoryPublicationCatalog;
  readonly passiveHealth: NpcPassiveHealthCatalog;
}
const fail = (message: string): never => {
  throw new Error('SENTIENT: ' + message);
};
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
/** CORE-193/AQA-001; neither NPC sex nor its campaign role is part of this grammar. */
export function enemyIdentityValue(value: unknown): EnemyIdentity {
  const row = r.exact(
    value,
    'name description origin affiliation massKg anatomyProfileId',
    '$.identity',
  );
  const name = r.raw(row['name'], '$.name').trim();
  if (/[\p{Cc}\p{Cs}]/u.test(name)) fail('Имя содержит недопустимые символы.');
  const visible = [...segmenter.segment(name)].filter(({ segment }) =>
    [...segment].some(
      (point) => !/^(?:\p{White_Space}|\p{Default_Ignorable_Code_Point})$/u.test(point),
    ),
  ).length;
  if (visible < 1 || visible > 64) fail('Имя: от 1 до 64 видимых символов.');
  const description =
    row['description'] === null ? null : r.raw(row['description'], '$.description');
  if (description !== null && [...description].length > 2000)
    fail('Описание: не более 2000 символов.');
  r.raw(row['origin'], '$.origin');
  r.raw(row['affiliation'], '$.affiliation');
  w.literal(row['anatomyProfileId'], 'ORDINARY_SENTIENT', '$.anatomyProfileId');
  const mass = r.finite(row['massKg'], '$.massKg', 30);
  if (mass > 500 || Math.round(mass * 10) / 10 !== mass)
    fail('Масса: 30–500 кг с точным шагом 0,1 кг.');
  return w.validated({ ...row, name });
}
export function enemyBaseStatsValue(value: unknown): EnemyStats {
  const row = r.exact(value, ENEMY_STATS.join(' '), '$.baseStats');
  for (const key of ENEMY_STATS)
    if (r.integer(row[key], '$.' + key, 1) > 35)
      fail('Каждая базовая характеристика: целое от 1 до 35.');
  return w.validated(row);
}
export function enemyBuildValue(value: unknown): EnemyBuild {
  const row = r.exact(value, 'raceCode pureClassOrNull skillSelections', '$.build');
  r.oneOf(row['raceCode'], ['PURE', 'FREE', 'UNITED'], '$.raceCode');
  if (row['pureClassOrNull'] !== null)
    r.oneOf(row['pureClassOrNull'], ['STALKER', 'SEEKER', 'SOLDIER'], '$.pureClassOrNull');
  for (const entry of r.list(row['skillSelections'], '$.skillSelections')) {
    const skill = r.exact(entry, 'skillKey targetBonus', '$.skill');
    r.text(skill['skillKey'], '$.skillKey');
    r.integer(skill['targetBonus'], '$.targetBonus', 1);
  }
  return w.validated(row);
}
export function enemyEmptyCompositionValue(value: unknown): EnemyEmptyComposition {
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
    fail('Непустой состав симбионтов пока недоступен: требуется следующий этап #257.');
  return w.validated(row);
}
export function enemyInventoryValue(value: unknown): EnemyInventory {
  const row = r.exact(value, 'inventoryItems armorCompatibilityReasonOrNull', '$.inventory');
  r.list(row['inventoryItems'], '$.inventoryItems');
  if (row['armorCompatibilityReasonOrNull'] !== null)
    r.text(row['armorCompatibilityReasonOrNull'], '$.armorCompatibilityReasonOrNull');
  return w.validated(row);
}
export function enemyAttemptValue(value: unknown): EnemyAttempt {
  const row = r.exact(
    value,
    'attemptId campaignId kind revision identityOrNull baseStatsOrNull buildOrNull compositionOrNull inventoryOrNull itemTemplateKeys',
    '$.attempt',
  );
  r.uuid(row['attemptId'], '$.attemptId');
  r.uuid(row['campaignId'], '$.campaignId');
  w.literal(row['kind'], 'SENTIENT', '$.kind');
  r.integer(row['revision'], '$.revision', 0);
  if (row['identityOrNull'] !== null) enemyIdentityValue(row['identityOrNull']);
  if (row['baseStatsOrNull'] !== null) enemyBaseStatsValue(row['baseStatsOrNull']);
  if (row['buildOrNull'] !== null) enemyBuildValue(row['buildOrNull']);
  if (row['compositionOrNull'] !== null) enemyEmptyCompositionValue(row['compositionOrNull']);
  if (row['inventoryOrNull'] !== null) enemyInventoryValue(row['inventoryOrNull']);
  const keys = r.list(row['itemTemplateKeys'], '$.itemTemplateKeys');
  keys.forEach((key) => r.uuid(key, '$.itemTemplateKey'));
  if (new Set(keys).size !== keys.length) fail('Повтор ключа предмета.');
  return w.validated(row);
}
function complete<T>(value: T | null, label: string): T {
  return value ?? fail('Не заполнен этап: ' + label);
}
/** CORE-196 uses the common mechanics; no NPC identity, lifetime or initial-state wrapper is invoked. */
export function deriveSentientEnemySheet(
  catalog: SentientAuthoringCatalog,
  value: EnemyAttempt,
): EnemySheet {
  const attempt = enemyAttemptValue(value);
  const identity = enemyIdentityValue(complete(attempt.identityOrNull, 'идентичность'));
  const baseStats = complete(attempt.baseStatsOrNull, 'характеристики');
  const build = complete(attempt.buildOrNull, 'раса и навыки');
  const composition = complete(attempt.compositionOrNull, 'симбионты');
  const inventory = complete(attempt.inventoryOrNull, 'имущество');
  const derived = calculateSkillStageStats(catalog.skills, {
    baseStats,
    raceCode: build.raceCode,
    classCode: build.pureClassOrNull,
    creationMode: 'MANUAL',
  });
  if (Object.values(derived.skillStageStats).some((stat) => stat < 1))
    fail('Итоговая постоянная характеристика ниже 1. Автоматическое ограничение не применяется.');
  const skills = validateSkillSelection(catalog.skills, {
    raceCode: build.raceCode,
    classCode: build.pureClassOrNull,
    skillStageStats: derived.skillStageStats,
    selectedSkills: build.skillSelections,
  });
  if (inventory.inventoryItems.length !== attempt.itemTemplateKeys.length)
    fail('Ключи имущества не соответствуют попытке.');
  const requests = inventory.inventoryItems.map((entry, index) => {
    if (
      Object.hasOwn(entry, 'itemInstanceId') ||
      Object.hasOwn(entry, 'customModifier') ||
      Object.hasOwn(entry, 'itemTypeReference')
    )
      fail('Только собственные catalog inputs; identities назначает хост.');
    if (entry.profile.kind === 'STRUCTURED_CUSTOM')
      fail('На этом этапе доступны каталог и профиль оружия мастера.');
    if (entry.qualityRoll !== null || entry.coatingInstanceIds.length !== 0)
      fail('Генерация качества и подготовленные покрытия не входят в создание V1.');
    return { ...entry, itemInstanceId: attempt.itemTemplateKeys[index]! };
  });
  const preview = buildNpcInventoryPreview(catalog.inventoryPublication, requests);
  const armor = deriveNpcArmorContribution(
    catalog.inventory,
    preview.items.flatMap((item) =>
      'armorProfile' in item && item.request.equipped
        ? [
            {
              itemInstanceId: item.request.itemInstanceId,
              itemTypeId: item.request.itemTypeId,
              bodyZoneOrNull: item.request.bodyZone,
              sealedOrNull: item.request.sealed,
            },
          ]
        : [],
    ),
  );
  if (
    armor.compatibilityRequiredItemIds.length !== 0 &&
    inventory.armorCompatibilityReasonOrNull === null
  )
    fail('Для слоёв костюмов подтвердите физическую совместимость и основание.');
  const effectiveStats = {
    ...derived.skillStageStats,
    M: Math.max(1, derived.skillStageStats.M + armor.mobilityModifier),
  };
  const requirementPenalties = deriveNpcEquipmentRequirementPenalties(catalog.equipment, {
    inventoryPreview: preview,
    effectiveStats,
  });
  let classMovementModifier = 0;
  for (const { profile } of armor.pieces) {
    if (!['CORE-054', 'CORE-055', 'CORE-056'].includes(profile.sourceRuleId)) continue;
    const permitted = profile.sourceRuleId === 'CORE-055' ? ['STALKER', 'SOLDIER'] : ['SOLDIER'];
    const penalty =
      /−([1-9]\d*) к перемещениям/u.exec(profile.conditionSourceOrNull ?? '')?.[1] ??
      fail('Не распознано исходное условие костюма.');
    if (build.pureClassOrNull === null || !permitted.includes(build.pureClassOrNull))
      classMovementModifier -= Number(penalty);
  }
  return {
    identity,
    baseStats,
    build,
    skillStageStats: derived.skillStageStats,
    permanentStats: derived.skillStageStats,
    effectiveStats,
    skills: skills.learnedSkills.map((skill) => ({
      ...skill,
      name: catalog.skillLabels[skill.skillKey] ?? fail('Неизвестный навык.'),
    })),
    skillSlots: { capacity: skills.capacity, used: skills.used, remaining: skills.remaining },
    composition,
    inventory,
    items: preview.items.map((item) => ({
      itemTemplateKey: item.request.itemInstanceId,
      name:
        catalog.inventory.definitions.find((entry) => entry.itemTypeId === item.request.itemTypeId)
          ?.name ?? fail('Неизвестный предмет.'),
      profile: ('stagedProfile' in item
        ? item.stagedProfile
        : 'armorProfile' in item
          ? item.armorProfile
          : 'shieldProfile' in item
            ? item.shieldProfile
            : 'catalogProfile' in item
              ? item.catalogProfile
              : fail('Неподдержанный профиль.')) as unknown as JsonValue,
      quantity: item.request.quantity,
      equipped: item.request.equipped,
      equippedSlots: item.request.equippedSlots,
    })),
    armor: armor as unknown as JsonObject,
    requirementPenalties: requirementPenalties as unknown as JsonObject,
    classMovementModifier,
    maxHP: deriveNpcPassiveHealthComponent(catalog.passiveHealth, []).subtotalHP,
    progressionPolicy: 'NO_XP_PROGRESSION',
    artAssetKey: ENEMY_PLACEHOLDER,
  };
}
