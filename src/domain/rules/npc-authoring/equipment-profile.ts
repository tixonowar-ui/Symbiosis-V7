import type { StatBlock } from '../skill-stage/stats.js';
import { deriveNpcBaseStatLayers, type NpcBaseStatCatalog } from './base-stats.js';
import {
  deriveNpcArmorContribution,
  type NpcArmorContribution,
  type NpcInventoryCatalog,
} from './inventory.js';
import {
  npcPublicationData as data,
  readNpcInventoryPreview,
  type NpcInventoryPublicationCatalog,
  deriveNpcCustomItemContribution,
  type NpcCustomItemContribution,
  readNpcInventoryPhysicalBasis,
  type NpcInventoryPreview,
} from './inventory-publication.js';
import {
  deriveNpcOrdinaryEquippedContext,
  applyNpcEffectiveStatLimits,
  type NpcEffectiveStatLimits,
  type NpcOrdinaryStatCatalog,
} from './ordinary-stat-profile.js';

export interface NpcEquipmentComponents {
  readonly inventory: NpcInventoryCatalog;
  readonly publication: NpcInventoryPublicationCatalog;
  readonly baseStats: NpcBaseStatCatalog;
  readonly ordinaryStats: NpcOrdinaryStatCatalog;
}
export interface NpcEquipmentCatalog {
  readonly kind: 'SOURCE_BOUND_NPC_EQUIPMENT';
}
export interface NpcArmorCompatibilityProof {
  readonly confirmationId: string;
  readonly npcUuid: string;
  readonly itemInstanceIds: readonly string[];
  readonly reason: string;
}
export interface NpcEquipmentProfile {
  readonly rawEquippedStats: StatBlock;
  readonly equippedStats: StatBlock;
  readonly equippedHermeticNate: boolean;
  readonly armor: NpcArmorContribution;
  readonly itemContribution?: NpcCustomItemContribution;
  /** CORE-054..056: movement-check penalty, not a subtraction from M. */
  readonly classMovementModifier: number;
  readonly compatibilityProofOrNull: NpcArmorCompatibilityProof | null;
  /** Missing physical approval blocks COMMIT; a shape-valid proof still needs host journal authority. */
  readonly compatibilityRequired: boolean;
}
export interface NpcEquipmentStatBasis {
  readonly npcUuid: string;
  readonly permanentStats: StatBlock;
  readonly rawEquippedStats: StatBlock;
  readonly effectiveLimitsOrNull: NpcEffectiveStatLimits | null;
}
const statBases = new WeakMap<NpcEquipmentProfile, NpcEquipmentStatBasis>();
/** Only an actual source evaluation may supply the raw intermediate to the later effect phase. */
export function readNpcEquipmentStatBasis(value: unknown): NpcEquipmentStatBasis {
  if (value === null || typeof value !== 'object')
    return fail('issued equipment stat basis required');
  return (
    statBases.get(value as NpcEquipmentProfile) ?? fail('issued equipment stat basis required')
  );
}
export interface NpcEquipmentRequirementPenalties {
  readonly sourceRuleId: 'CORE-016';
  readonly armor: Readonly<{
    requiredStrength: number;
    deficit: number;
    penalty: number;
    appliesTo: readonly ['PHYSICAL_ACTION', 'MOVEMENT', 'ACTIVE_DEFENSE'];
  }>;
  readonly weapons: readonly Readonly<{
    itemInstanceId: string;
    statRequirements: Readonly<Partial<StatBlock>>;
    deficits: Readonly<Partial<StatBlock>>;
    deficitTotal: number;
    penalty: number;
  }>[];
}
const catalogs = new WeakMap<
  NpcEquipmentCatalog,
  NpcEquipmentComponents & Readonly<{ requirementMultiplier: number }>
>();
function fail(detail: string): never {
  throw new Error(`NPC equipment: ${detail}`);
}
export function createNpcEquipmentCatalog(
  components: NpcEquipmentComponents,
  rules: unknown,
): NpcEquipmentCatalog {
  data.record(components, ['inventory', 'publication', 'baseStats', 'ordinaryStats']);
  const rule = data
    .array(rules)
    .map((r) => data.record(r))
    .filter((r) => r['Rule ID'] === 'CORE-016');
  if (rule.length !== 1 || rule[0] === undefined) return fail('one CORE-016 source required');
  const armorRule =
    'для брони: суммировать S-требования всех отдельных элементов; цельный костюм учитывать один раз, дополнительные слои прибавлять; при дефиците penalty=2×(requiredS−S) ко всем физическим действиям, перемещению и активным защитам.';
  data.equal('Активно', rule[0]['Статус']);
  data.equal(armorRule, rule[0]['Атомарность / аудит']);
  data.equal(
    armorRule +
      '\n[Q-CORE-004] Суммировать (если например оружие требует 14 силы и 13 ловкости, а у персонажа 12 силы и 12 ловкости, дефицит = 3, штраф = 6)',
    rule[0]['Броски / формулы'],
  );
  const algorithm =
    'Нормативная база (действует во всей непротиворечащей части):\n' +
    armorRule +
    ' Способ объединения нескольких дефицитов оружия не определён.\nПриоритетные авторские дельты (заменяют только прямо пересекающиеся ветви):\n[Q-CORE-004] Суммировать (если например оружие требует 14 силы и 13 ловкости, а у персонажа 12 силы и 12 ловкости, дефицит = 3, штраф = 6)\nДля оружия использовать полный MAP требований активной версии профиля. Суммировать положительные дефициты по всем указанным характеристикам S/D/I/W/M/Z/C и применить действующий множитель штрафа; пустая карта означает отсутствие требований.';
  data.equal(algorithm, rule[0]['Итоговый алгоритм']);
  const minimum = data
    .array(rules)
    .map((r) => data.record(r))
    .filter((r) => r['Rule ID'] === 'CORE-078');
  if (minimum.length !== 1 || minimum[0] === undefined) return fail('one CORE-078 source required');
  data.equal('Активно', minimum[0]['Статус']);
  data.equal(
    'постоянное значение не ниже 1; ручное распределение до расовых/симбиотических поправок — не более 20 в одну характеристику; случайные значения, криты, раса, симбионты и развитие могут дать >20; временный штраф может сделать итог проверки отрицательным, но не саму характеристику, если эффект не говорит иное.',
    minimum[0]['Итоговый алгоритм'],
  );
  data.equal(
    'специальное последствие снижения ниже 1 сначала срабатывает, затем для расчётов значение 1.',
    minimum[0]['Исключения / приоритет'],
  );
  const multiplier = /penalty=(\d+)×/u.exec(armorRule)?.[1];
  if (multiplier === undefined) return fail('source requirement multiplier required');
  const catalog = Object.freeze({ kind: 'SOURCE_BOUND_NPC_EQUIPMENT' as const });
  catalogs.set(
    catalog,
    Object.freeze({ ...components, requirementMultiplier: Number(multiplier) }),
  );
  return catalog;
}

/** CORE-016 is a contextual check penalty, never a refusal to own/equip or a second stat modifier. */
export function deriveNpcEquipmentRequirementPenalties(
  catalog: NpcEquipmentCatalog,
  value: unknown,
): NpcEquipmentRequirementPenalties {
  const components = catalogs.get(catalog) ?? fail('issued catalog required');
  const input = data.record(value, ['inventoryPreview', 'effectiveStats']);
  const inventory = readNpcInventoryPreview(components.publication, input.inventoryPreview);
  const raw = data.record(input.effectiveStats, ['S', 'D', 'M', 'C', 'I', 'Z', 'W']);
  const stats = {} as Record<keyof StatBlock, number>;
  for (const key of ['S', 'D', 'M', 'C', 'I', 'Z', 'W'] as const) {
    const n = raw[key];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1)
      return fail('current effective stat must be a safe integer at least one');
    stats[key] = n;
  }
  const armor = deriveNpcArmorContribution(
    components.inventory,
    inventory.items.flatMap((item) =>
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
  const deficit = Math.max(0, armor.requiredStrength - stats.S);
  const multiply = (n: number) => {
    const penalty = n * components.requirementMultiplier;
    if (!Number.isSafeInteger(penalty)) return fail('requirement penalty overflow');
    return penalty;
  };
  return data.freeze({
    sourceRuleId: 'CORE-016',
    armor: {
      requiredStrength: armor.requiredStrength,
      deficit,
      penalty: multiply(deficit),
      appliesTo: ['PHYSICAL_ACTION', 'MOVEMENT', 'ACTIVE_DEFENSE'],
    },
    weapons: inventory.items.flatMap((item) => {
      if ((!('stagedProfile' in item) && !('shieldProfile' in item)) || !item.request.equipped)
        return [];
      const statRequirements =
        'stagedProfile' in item
          ? item.stagedProfile.statRequirements
          : item.shieldProfile.statRequirements;
      const deficits: Partial<Record<keyof StatBlock, number>> = {};
      let deficitTotal = 0;
      for (const [key, required] of Object.entries(statRequirements)) {
        const stat = key as keyof StatBlock;
        const delta = Math.max(0, required - stats[stat]);
        deficits[stat] = delta;
        deficitTotal += delta;
      }
      return [
        {
          itemInstanceId: item.request.itemInstanceId,
          statRequirements,
          deficits,
          deficitTotal,
          penalty: multiply(deficitTotal),
        },
      ];
    }),
  });
}

/** Actual source items determine conditions before stat caps; no +10 repair of an already capped C. */
export function deriveNpcEquipmentProfile(
  catalog: NpcEquipmentCatalog,
  value: unknown,
): NpcEquipmentProfile {
  const components = catalogs.get(catalog) ?? fail('issued catalog required');
  const row = data.record(value, [
    'npcUuid',
    'statInput',
    'inventoryPreview',
    'compatibilityProofOrNull',
  ]);
  const inventory = readNpcInventoryPreview(components.publication, row.inventoryPreview);
  return deriveEquipmentProfile(
    components,
    row,
    inventory,
    deriveNpcCustomItemContribution(components.publication, inventory),
  );
}
/** Physical preparation is issued independently of the effects it is preparing. */
export function deriveNpcEquipmentPreparationProfile(
  catalog: NpcEquipmentCatalog,
  value: unknown,
): NpcEquipmentProfile {
  const components = catalogs.get(catalog) ?? fail('issued catalog required');
  const row = data.record(value, [
    'npcUuid',
    'statInput',
    'physicalInventoryBasis',
    'compatibilityProofOrNull',
  ]);
  const physical = readNpcInventoryPhysicalBasis(
    components.publication,
    row.physicalInventoryBasis,
  );
  if (
    physical.history !== null &&
    physical.history.history.some((entry) => entry.npcUuid !== row.npcUuid)
  )
    return fail('physical preparation history belongs to another NPC');
  return deriveEquipmentProfile(
    components,
    row,
    { items: physical.items },
    physical.itemContribution,
  );
}
function deriveEquipmentProfile(
  components: NpcEquipmentComponents,
  row: Record<string, unknown>,
  inventory: NpcInventoryPreview,
  itemContribution: NpcCustomItemContribution,
): NpcEquipmentProfile {
  const npcUuid = data.uuid(row.npcUuid);
  const pieces = inventory.items.flatMap((item) =>
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
  );
  const armor = deriveNpcArmorContribution(components.inventory, pieces);
  const equippedHermeticNate = armor.pieces.some(
    ({ piece, profile }) => profile.sourceRuleId === 'CORE-053' && piece.sealedOrNull === true,
  );
  const input = data.record(row.statInput);
  const base = deriveNpcBaseStatLayers(components.baseStats, {
    schema: input.schema,
    baseStats: input.baseStats,
  });
  const pure = base.schema.raceCode === 'PURE';
  data.record(input, pure ? ['schema', 'baseStats'] : ['schema', 'baseStats', 'compositionProof']);
  if (!pure && data.record(input.compositionProof).identityKey !== npcUuid)
    return fail('composition belongs to another NPC');
  const ordinary = pure
    ? null
    : deriveNpcOrdinaryEquippedContext(components.ordinaryStats, input, { equippedHermeticNate });
  const beforeArmor = ordinary === null ? base.skillStageStats : ordinary.stats.permanentStats;
  const rawEquippedStats: StatBlock = {
    S: beforeArmor.S + itemContribution.totals.S,
    D: beforeArmor.D + itemContribution.totals.D,
    M: beforeArmor.M + armor.mobilityModifier + itemContribution.totals.M,
    Z: beforeArmor.Z + itemContribution.totals.Z,
    I: beforeArmor.I + itemContribution.totals.I,
    W: beforeArmor.W + itemContribution.totals.W,
    C: beforeArmor.C + itemContribution.totals.C,
  };
  if (!Object.values(rawEquippedStats).every(Number.isSafeInteger)) return fail('stat overflow');
  // CORE-078 supplies the computational minimum. The issued raw basis remains
  // available to the following effect phase so a special under-one consequence
  // observes the real sum before this display/computation floor.
  const limited =
    ordinary === null
      ? rawEquippedStats
      : applyNpcEffectiveStatLimits(ordinary.effectiveLimits, rawEquippedStats);
  const equippedStats = { ...limited, M: Math.max(1, limited.M) };
  let classMovementModifier = 0;
  for (const { profile } of armor.pieces) {
    if (!['CORE-054', 'CORE-055', 'CORE-056'].includes(profile.sourceRuleId)) continue;
    const allowed = profile.sourceRuleId === 'CORE-055' ? ['STALKER', 'SOLDIER'] : ['SOLDIER'];
    const expected =
      profile.sourceRuleId === 'CORE-055'
        ? 'Слои разрешены CORE-151, физическая совместимость подтверждается мастером. Без Сталкера/Солдата ПР −15 к перемещениям.'
        : profile.sourceRuleId === 'CORE-054'
          ? 'Слои разрешены CORE-151, физическая совместимость подтверждается мастером. Без Солдата ПР −15 к перемещениям; не защищает от химических феромонов.'
          : 'Слои разрешены CORE-151, физическая совместимость подтверждается мастером. Без Солдата ПР −15 к перемещениям.';
    data.equal(expected, profile.conditionSourceOrNull);
    if (base.schema.pureClassOrNull === null || !allowed.includes(base.schema.pureClassOrNull)) {
      const amount = /−(\d+) к перемещениям/u.exec(expected)?.[1];
      if (amount === undefined) return fail('missing source movement penalty');
      classMovementModifier -= Number(amount);
    }
  }
  if (!Number.isSafeInteger(classMovementModifier)) return fail('movement modifier overflow');
  const required = armor.compatibilityRequiredItemIds;
  let compatibilityProofOrNull: NpcArmorCompatibilityProof | null = null;
  if (row.compatibilityProofOrNull !== null) {
    const proof = data.record(row.compatibilityProofOrNull, [
      'confirmationId',
      'npcUuid',
      'itemInstanceIds',
      'reason',
    ]);
    if (required.length === 0) return fail('no compatibility confirmation applies to this loadout');
    const ids = data.array(proof.itemInstanceIds).map(data.uuid);
    data.equal(required, ids);
    if (data.uuid(proof.npcUuid) !== npcUuid) return fail('foreign compatibility confirmation');
    compatibilityProofOrNull = {
      confirmationId: data.text(proof.confirmationId),
      npcUuid,
      itemInstanceIds: ids,
      reason: data.text(proof.reason),
    };
  }
  const result: NpcEquipmentProfile = data.freeze({
    rawEquippedStats,
    equippedStats,
    equippedHermeticNate,
    armor,
    ...(itemContribution.items.length === 0 ? {} : { itemContribution }),
    classMovementModifier,
    compatibilityProofOrNull,
    compatibilityRequired: required.length > 0 && compatibilityProofOrNull === null,
  });
  statBases.set(
    result,
    data.freeze({
      npcUuid,
      permanentStats: beforeArmor,
      rawEquippedStats,
      effectiveLimitsOrNull: ordinary?.effectiveLimits ?? null,
    }),
  );
  return result;
}
