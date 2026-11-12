import type { SymbiontCatalog } from '../../rules/symbiont-stage/catalog.js';
import type { NpcDevelopmentCatalog } from '../../rules/npc-authoring/catalog.js';
import {
  deriveNpcSymbiontNativeProfile,
  type NpcSymbiontNativeCatalog,
} from '../../rules/npc-authoring/symbiont-native-profile.js';
import {
  deriveNpcPassiveHealthComponent,
  type NpcPassiveHealthCatalog,
} from '../../rules/npc-authoring/passive-health.js';
import { enemyCompositionReaders as r } from '@shared/enemy-composition-codec.js';
import {
  CUSTOM_MONSTER_STATS,
  customMonsterManualInputValue,
  type CustomMonsterIdentity,
  type CustomMonsterManualInput,
  customMonsterIdentityValue,
} from '@shared/custom-monster.js';
import type { EnemyStats } from '@shared/enemy-authoring.js';
import { CUSTOM_MONSTER_PLACEHOLDER } from '@shared/custom-monster.js';
import {
  customMonsterAttemptValue,
  type CustomMonsterAttempt,
  type CustomMonsterSheet,
  type MonsterAdvisorCard,
  type MonsterAdvisorSkill,
} from '@shared/custom-monster-state.js';
import type { SkillStageCatalog } from '../../rules/skill-stage/catalog.js';
import {
  calculateSkillSlotCost,
  validateSkillRequirements,
} from '../../rules/skill-stage/skills.js';
import { resolveAdvisorIwRolls } from '../../rules/symbiont-stage/advisor.js';

export interface CustomMonsterAuthoringCatalog {
  readonly symbionts: SymbiontCatalog;
  readonly development: NpcDevelopmentCatalog;
  readonly native: NpcSymbiontNativeCatalog;
  readonly passiveHealth: NpcPassiveHealthCatalog;
  readonly rules: readonly Readonly<Record<string, unknown>>[];
}
export interface CustomMonsterFullCatalog extends CustomMonsterAuthoringCatalog {
  readonly skills: SkillStageCatalog;
  readonly skillLabels: Readonly<Record<string, string>>;
}
export interface CustomMonsterBody {
  readonly input: CustomMonsterManualInput;
  readonly permanentStats: EnemyStats;
  readonly effectiveMaxHP: number;
  readonly symbiontOrNull: Readonly<{
    symbiontInstanceId: string;
    speciesKey: string;
    effectiveLevel: number;
    levelProfileId: string;
    learnedNodeRefs: readonly string[];
    nativeMaxOE: number;
    currentOE: number;
  }> | null;
}
const fail = (detail: string): never => {
  throw new Error('CUSTOM_MONSTER: ' + detail);
};
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
export function customMonsterIdentityDomainValue(input: unknown): CustomMonsterIdentity {
  const value = customMonsterIdentityValue(input);
  const name = value.name.trim();
  const visible = [...segmenter.segment(name)].filter(({ segment }) =>
    [...segment].some(
      (point) => !/^(?:\p{White_Space}|\p{Default_Ignorable_Code_Point})$/u.test(point),
    ),
  ).length;
  if (/[\p{Cc}\p{Cs}]/u.test(name) || visible < 1 || visible > 64)
    return fail('CORE-193 name requires 1..64 visible characters');
  if (value.description !== null && [...value.description].length > 2000)
    return fail('CORE-193 description exceeds 2000 characters');
  return { ...value, name };
}
function algorithm(catalog: CustomMonsterAuthoringCatalog, id: string): string {
  const rows = catalog.rules.filter((row) => row['Rule ID'] === id);
  if (rows.length !== 1 || rows[0]?.['Статус'] !== 'Активно')
    return fail('active unique source rule required: ' + id);
  const text = rows[0]['Итоговый алгоритм'];
  return typeof text === 'string' ? text : fail('source algorithm required: ' + id);
}
function coefficient(
  catalog: CustomMonsterAuthoringCatalog,
  id: string,
  expression: RegExp,
): number {
  const matches = [...algorithm(catalog, id).matchAll(new RegExp(expression.source, 'gu'))];
  if (
    matches.length === 0 ||
    matches[0]?.[1] === undefined ||
    new Set(matches.map((row) => row[1])).size !== 1
  )
    return fail('unrecognized source coefficient: ' + id);
  return r.integer(Number(matches[0][1]), '$.source.' + id, 1);
}

/** CORE-200/202/203. Reuses graph/native OE and learned HP components, never NPC race/slots/base100. */
export function deriveCustomMonsterBody(
  catalog: CustomMonsterAuthoringCatalog,
  value: unknown,
  symbiontInstanceIdOrNull: string | null,
): CustomMonsterBody {
  const decoded = customMonsterManualInputValue(value),
    input = { ...decoded, identity: customMonsterIdentityDomainValue(decoded.identity) },
    stats = { ...input.stats.baseStats };
  const add = (stat: (typeof CUSTOM_MONSTER_STATS)[number], delta: number) => {
    stats[stat] += delta;
    if (!Number.isSafeInteger(stats[stat])) return fail('permanent stat integer overflow');
  };
  if (input.symbiont.mode === 'NONE') {
    if (symbiontInstanceIdOrNull !== null) return fail('NONE cannot own a symbiont identity');
    return {
      input,
      permanentStats: stats,
      effectiveMaxHP: input.stats.baseMaxHP,
      symbiontOrNull: null,
    };
  }
  const selected = input.symbiont.symbiont;
  const species = catalog.symbionts.species.find((row) => row.speciesKey === selected.speciesKey);
  if (species === undefined || species.kind !== 'ORDINARY')
    return fail('CORE-203 requires an actual ordinary species');
  r.uuid(symbiontInstanceIdOrNull, '$.monster.symbiontInstanceId');
  const native = deriveNpcSymbiontNativeProfile(catalog.native, {
    ...selected,
    symbiontInstanceId: symbiontInstanceIdOrNull,
  });
  const learned = (node: string) => native.learnedNodeRefs.includes(node);
  for (const modifier of species.modifiers) {
    if (
      modifier.operation !== 'ADD' ||
      (modifier.contextPredicate !== 'symbiontActive=true' &&
        modifier.contextPredicate !== 'symbiontActive=true AND NOT equippedHermeticNate')
    )
      return fail('unknown source profile modifier predicate');
    // CORE-199/204 forbids equipment; a hermetic Nate is never invented for a monster.
    add(modifier.targetCode, modifier.value);
  }
  if (species.speciesKey === 'TEACHER' && learned('SYM-054')) {
    const rate = coefficient(catalog, 'SYM-054', /min\((\d+)L/u),
      cap = coefficient(catalog, 'SYM-054', /L,(\d+)−W_base/u);
    add('W', rate * native.targetLevel);
    // A single selected ordinary Teacher is the only symbiont, by CORE-203.
    add('I', Math.max(0, Math.min(rate * native.targetLevel, cap - input.stats.baseStats.I)));
    stats.W = Math.min(stats.W, cap);
  }
  if (species.speciesKey === 'DOLPHIN' && learned('SYM-162')) {
    add('I', coefficient(catalog, 'SYM-162', /на (\d+)L/u) * native.targetLevel);
    stats.I = Math.min(stats.I, coefficient(catalog, 'SYM-162', /выше (\d+)/u));
  }
  for (const [key, node, stat] of [
    ['ARMADILLO', 'SYM-062', 'Z'],
    ['TICK', 'SYM-108', 'S'],
    ['SPIDER', 'SYM-122', 'D'],
  ] as const)
    if (species.speciesKey === key && learned(node)) add(stat, native.targetLevel);
  if (species.speciesKey === 'TROGR' && learned('SYM-076')) {
    const text = algorithm(catalog, 'SYM-076');
    if (!text.includes('до потолка 25 у Единого/35 у Вольного'))
      return fail('Trogr race-predicated cap contract changed');
    const rate = coefficient(catalog, 'SYM-076', /добавить \+(\d+) к S/u),
      minimum = coefficient(catalog, 'SYM-076', /но не ниже (\d+)/u);
    for (const stat of ['S', 'D', 'M', 'Z'] as const) add(stat, rate * native.targetLevel);
    for (const stat of ['I', 'W', 'C'] as const) {
      add(stat, -rate * native.targetLevel);
      stats[stat] = Math.max(minimum, stats[stat]);
    }
    // Neither explicit race predicate matches CORE-199's race-ABSENT kind.
    // This does not remove Teacher/Dolphin's separately named non-race limits.
  }
  if (CUSTOM_MONSTER_STATS.some((stat) => stats[stat] < 1))
    return fail('CORE-200 final permanent stat below one');
  const health = deriveNpcPassiveHealthComponent(catalog.passiveHealth, [
    {
      symbiontInstanceId: native.symbiontInstanceId,
      speciesKey: native.speciesKey,
      effectiveLevel: native.targetLevel,
      learnedNodeRefs: native.learnedNodeRefs,
      effectsEnabled: true,
    },
  ]);
  const effectiveMaxHP =
    input.stats.baseMaxHP + health.contributions.reduce((sum, row) => sum + row.addedHP, 0);
  if (!Number.isSafeInteger(effectiveMaxHP) || effectiveMaxHP < 1)
    return fail('CORE-202 effective maximum HP invalid');
  return {
    input,
    permanentStats: stats,
    effectiveMaxHP,
    symbiontOrNull: {
      symbiontInstanceId: native.symbiontInstanceId,
      speciesKey: native.speciesKey,
      effectiveLevel: native.targetLevel,
      levelProfileId: native.levelProfileId,
      learnedNodeRefs: native.learnedNodeRefs,
      nativeMaxOE: native.nativeMaxOE,
      currentOE: native.nativeMaxOE,
    },
  };
}

export function customMonsterCompleteInput(
  attempt: CustomMonsterAttempt,
): CustomMonsterManualInput {
  return {
    identity: attempt.identityOrNull ?? fail('identity not confirmed'),
    stats: attempt.statsOrNull ?? fail('manual statistics not confirmed'),
    physics: attempt.physicsOrNull ?? fail('physics not confirmed'),
    attack: attempt.attackOrNull ?? fail('attack not confirmed'),
    symbiont:
      attempt.compositionOrNull?.selection ?? fail('explicit symbiont choice not confirmed'),
  };
}
export function customMonsterAdvisorStats(
  catalog: CustomMonsterAuthoringCatalog,
  body: CustomMonsterBody,
  card: MonsterAdvisorCard,
): EnemyStats {
  const iw = resolveAdvisorIwRolls([card.iwRolls[0].mechanical, card.iwRolls[1].mechanical]);
  const learned = body.symbiontOrNull?.learnedNodeRefs ?? [];
  const levelBonus = learned.includes('SYM-097')
    ? (() => {
        if (algorithm(catalog, 'SYM-097') !== 'I_adviser=I_base+L.')
          return fail('Adviser own-I source changed');
        return body.symbiontOrNull?.effectiveLevel ?? fail('Adviser absent');
      })()
    : 0;
  return { ...body.permanentStats, I: iw.I.value + levelBonus, W: iw.W.value };
}
export function customMonsterAdvisorSkills(
  catalog: CustomMonsterFullCatalog,
  stats: EnemyStats,
  selected: readonly MonsterAdvisorSkill[],
  requireFilled: boolean,
) {
  const known = selected.map((choice) => {
    const skill =
      catalog.skills.skills.find((row) => row.skillKey === choice.skillKey) ??
      fail('unknown Adviser SkillKey ' + choice.skillKey);
    if (
      skill.category !== 'SELECTABLE_GENERAL' ||
      (skill.maxBonus !== 'NO_RULED_UPPER_LIMIT' && choice.targetBonus > skill.maxBonus)
    )
      return fail('invalid Adviser selectable bonus');
    validateSkillRequirements(catalog.skills, skill.skillKey, stats);
    return {
      skillKey: skill.skillKey,
      name: catalog.skillLabels[skill.skillKey] ?? fail('missing Adviser skill label'),
      bonus: choice.targetBonus,
      slotCost: calculateSkillSlotCost(choice.targetBonus),
    };
  });
  const capacity = Math.ceil(stats.W / 2),
    used = known.reduce((sum, row) => sum + row.slotCost, 0);
  if (used > capacity || (requireFilled && used !== capacity))
    return fail('Adviser own skill slots not filled correctly');
  return { capacity, skills: known };
}
/** CORE-199..204: complete read-only sheet, with no host skills/items or runtime effect history. */
export function deriveCustomMonsterSheet(
  catalog: CustomMonsterFullCatalog,
  value: unknown,
): CustomMonsterSheet {
  const attempt = customMonsterAttemptValue(value);
  if (attempt.compositionOrNull?.phase !== 'CONFIRMED') return fail('symbiont stage not confirmed');
  const body = deriveCustomMonsterBody(
    catalog,
    customMonsterCompleteInput(attempt),
    attempt.compositionOrNull.symbiontInstanceIdOrNull,
  );
  const native = body.symbiontOrNull;
  const ruleFacts: CustomMonsterSheet['ruleFacts'][number][] = [];
  if (native !== null) {
    for (const nodeRef of native.learnedNodeRefs) {
      const node =
        catalog.development.nodes.find(
          (row) => row.nodeRef === nodeRef && row.speciesKey === native.speciesKey,
        ) ?? fail('foreign learned node');
      for (const ruleId of node.ruleIds) {
        const matching = catalog.rules.filter((row) => row['Rule ID'] === ruleId);
        const row = matching[0];
        if (
          matching.length !== 1 ||
          row === undefined ||
          (row['Статус'] !== 'Активно' &&
            !(
              node.automationStatus === 'NODE_ONLY_MANUAL' &&
              row['Статус'] === 'Не автоматизируется'
            )) ||
          typeof row['Название'] !== 'string' ||
          typeof row['Итоговый алгоритм'] !== 'string'
        )
          return fail('closed learned rule fact not recognized: ' + ruleId);
        ruleFacts.push({
          nodeRef,
          ruleId,
          name: row['Название'],
          status: row['Статус'],
          algorithm: row['Итоговый алгоритм'],
          hostSkillResultDropped: ruleId === 'SYM-079' || ruleId === 'SYM-166',
        });
      }
    }
  }
  const card = attempt.advisorCards.find(
    (row) => row.cardId === attempt.compositionOrNull?.advisorCardIdOrNull,
  );
  let advisorOrNull: CustomMonsterSheet['advisorOrNull'] = null;
  if (native?.speciesKey === 'ADVISER') {
    if (card === undefined || card.initialSkillsOrNull === null)
      return fail('mandatory Adviser personality not completed');
    const stats = customMonsterAdvisorStats(catalog, body, card);
    const skills = customMonsterAdvisorSkills(catalog, stats, card.knownSkills, false);
    advisorOrNull = { cardId: card.cardId, I: stats.I, W: stats.W, ...skills };
  }
  const speciesName =
    native === null
      ? null
      : (catalog.symbionts.species.find((row) => row.speciesKey === native.speciesKey)
          ?.speciesLabel ?? fail('species label absent'));
  return {
    kind: 'CUSTOM_MONSTER',
    identity: body.input.identity,
    stats: body.input.stats,
    physics: body.input.physics,
    attack: body.input.attack,
    permanentStats: body.permanentStats,
    effectiveMaxHP: body.effectiveMaxHP,
    currentHP: body.effectiveMaxHP,
    alive: true,
    conscious: true,
    symbiontOrNull:
      native === null
        ? null
        : {
            ...native,
            speciesName: speciesName ?? fail('species label absent'),
            binding:
              body.input.symbiont.mode === 'ORDINARY'
                ? body.input.symbiont.symbiont.binding
                : fail('symbiont binding absent'),
            functionalInterfaceOnly: true,
          },
    ruleFacts,
    advisorOrNull,
    progressionPolicy: 'NO_XP_PROGRESSION',
    artAssetKey: CUSTOM_MONSTER_PLACEHOLDER,
  };
}
