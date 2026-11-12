import type { StatCode } from '@generated/types/character.js';
import { ENEMY_STATS, type EnemyBuild, type EnemyStats } from '@shared/enemy-authoring.js';
import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';
import {
  enemyComposedCompositionValue,
  type EnemyComposedComposition,
  type EnemyCompositionRoll,
} from '@shared/enemy-composition.js';
import type { SymbiontCatalog } from '../../rules/symbiont-stage/catalog.js';
import type { NpcDevelopmentCatalog } from '../../rules/npc-authoring/catalog.js';
import {
  createNpcOrdinaryComposition,
  previewNpcOrdinaryCompositionEdit,
  type NpcOrdinaryCompositionCatalog,
} from '../../rules/npc-authoring/ordinary-composition.js';
import {
  deriveNpcSymbiontNativeProfile,
  type NpcSymbiontNativeCatalog,
} from '../../rules/npc-authoring/symbiont-native-profile.js';
import {
  calculateTrogrSuppressionBonus,
  resolveAdvisorIwRolls,
  validateAdvisorSkillSelection,
} from '../../rules/symbiont-stage/advisor.js';
import { calculateSkillSlotCost } from '../../rules/skill-stage/skills.js';
import type { SkillStageCatalog } from '../../rules/skill-stage/catalog.js';
import type { EnemySkillPlanState } from '@shared/enemy-skill-plan.js';

export interface SentientCompositionCatalog {
  readonly symbionts: SymbiontCatalog;
  readonly development: NpcDevelopmentCatalog;
  readonly native: NpcSymbiontNativeCatalog;
  readonly structural: NpcOrdinaryCompositionCatalog;
  readonly rules: readonly Readonly<Record<string, unknown>>[];
}
const fail = (detail: string): never => {
  throw new Error('SENTIENT composition: ' + detail);
};
function rule(catalog: SentientCompositionCatalog, id: string): Readonly<Record<string, unknown>> {
  const rows = catalog.rules.filter((row) => row['Rule ID'] === id);
  if (rows.length !== 1 || rows[0]?.['Статус'] !== 'Активно')
    return fail('missing active source ' + id);
  return rows[0];
}
function algorithm(catalog: SentientCompositionCatalog, id: string): string {
  const value = rule(catalog, id)['Итоговый алгоритм'];
  return typeof value === 'string' ? value : fail('algorithm ' + id);
}
function number(catalog: SentientCompositionCatalog, id: string, expression: RegExp): number {
  const result = expression.exec(algorithm(catalog, id));
  if (result === null || result[1] === undefined) return fail('unsupported source formula ' + id);
  const value = Number(result[1]);
  return Number.isSafeInteger(value) ? value : fail('source integer ' + id);
}
/** Source topology/native primitives only. No NPC identity, acquisition journal or lifetime closure. */
export function deriveSentientCompositionStructure(
  catalog: SentientCompositionCatalog,
  raceCode: EnemyBuild['raceCode'],
  value: EnemyComposedComposition,
) {
  const composition = enemyComposedCompositionValue(value);
  const choices =
    composition.monsterOrNull === null
      ? composition.ordinarySymbiontInstances
      : [composition.monsterOrNull];
  const hasDolphin = choices.some((entry) => entry.speciesKey === 'DOLPHIN');
  const grantedLevel = number(catalog, 'SYM-076', /уровень Трогра становится не ниже (\d+)/u);
  const additions = choices.map((choice, index) => {
    const species =
      catalog.symbionts.species.find((row) => row.speciesKey === choice.speciesKey) ??
      fail('foreign species ' + choice.speciesKey);
    if (
      (species.kind === 'SYMBIOTIC_MONSTER') !==
      (composition.symbiontCompositionMode === 'SYMBIOTIC_MONSTER')
    )
      return fail('composition mode/species mismatch');
    if (!species.allowedRaceCodes.includes(raceCode)) return fail('species unavailable for race');
    const learnedNodeRefs =
      choice.speciesKey === 'TROGR' && hasDolphin
        ? [
            ...new Set([
              ...choice.learnedNodeRefs,
              ...catalog.development.nodes
                .filter(
                  (node) =>
                    node.speciesKey === 'TROGR' && node.level > 1 && node.level <= grantedLevel,
                )
                .map((node) => node.nodeRef),
            ]),
          ]
        : choice.learnedNodeRefs;
    const native = deriveNpcSymbiontNativeProfile(catalog.native, {
      ...choice,
      learnedNodeRefs,
      symbiontInstanceId: composition.instanceIds[index],
    });
    if (
      composition.monsterOrNull !== null &&
      native.levelProfileId !== composition.symbioticMonsterProfileIdOrNull
    )
      return fail('foreign monster profile');
    return {
      symbiontInstanceId: native.symbiontInstanceId,
      speciesKey: native.speciesKey,
      targetLevel: native.targetLevel,
      learnedNodeRefs: native.learnedNodeRefs,
      binding: native.binding,
      currentOE: native.nativeMaxOE,
    };
  });
  const structural = previewNpcOrdinaryCompositionEdit(
    createNpcOrdinaryComposition(catalog.structural, {
      journalId: composition.previewCommandId,
      raceCode,
    }),
    { raceCode, removals: [], additions, buildChanges: [], currentOeChanges: [] },
  );
  // CORE-216 pins the requested *final* level, including source-mandated absorption grants.
  for (const [index, choice] of choices.entries()) {
    const resolved =
      structural.instances.find(
        (row) => row.symbiontInstanceId === composition.instanceIds[index],
      ) ?? fail('missing source specimen');
    if (resolved.targetLevel !== choice.targetLevel)
      return fail('effective level AFTER composition differs from targetLevel');
    const maximum = Math.max(
      ...resolved.learnedNodeRefs.map(
        (ref) =>
          catalog.development.nodes.find(
            (node) => node.speciesKey === resolved.speciesKey && node.nodeRef === ref,
          )?.level ?? fail('foreign learned node'),
      ),
    );
    if (maximum !== choice.targetLevel) return fail('final learned level differs from targetLevel');
  }
  return structural;
}
export function sentientCompositionRollRequirements(
  catalog: SentientCompositionCatalog,
  raceCode: EnemyBuild['raceCode'],
  composition: EnemyComposedComposition,
) {
  const structural = deriveSentientCompositionStructure(catalog, raceCode, composition);
  const requirements: {
    kind: 'FREE_SLOT' | 'ADVISER_I' | 'ADVISER_W' | 'ADVISER_SUPPRESSION';
    dieSides: 6 | 20;
  }[] = [];
  if (
    structural.requiredSourceContinuations.some(
      (row) => row.kind === 'FREE_EXTRA_SLOT_ROLL_AND_STAT_CONSEQUENCE',
    )
  )
    requirements.push({ kind: 'FREE_SLOT', dieSides: 6 });
  if (structural.requiredSourceContinuations.some((row) => row.kind === 'ADVISER_CARD_AND_SKILLS'))
    requirements.push({ kind: 'ADVISER_I', dieSides: 20 }, { kind: 'ADVISER_W', dieSides: 20 });
  if (structural.requiredSourceContinuations.some((row) => row.kind === 'ADVISER_SUPPRESSION_ROLL'))
    requirements.push({ kind: 'ADVISER_SUPPRESSION', dieSides: 20 });
  return requirements;
}
export function validateSentientCompositionRolls(
  catalog: SentientCompositionCatalog,
  raceCode: EnemyBuild['raceCode'],
  composition: EnemyComposedComposition,
): ReadonlyMap<string, EnemyCompositionRoll> {
  const required = sentientCompositionRollRequirements(catalog, raceCode, composition),
    rolls = sentientAcquisitionRolls(composition);
  if (!admissionJsonEqual(composition.rolls, [...rolls.values()]))
    return fail('foreign acquisition provenance');
  for (const [kind, roll] of rolls) {
    const root = 'ENEMY_COMPOSITION/' + roll.originatingCommandId + '/' + kind;
    if (
      roll.factId !== root + '/FACT' ||
      roll.rollRequestId !== root + '/REQUEST' ||
      roll.rollReceiptId !== root + '/RECEIPT' ||
      roll.mechanical.dieSides !== (kind === 'FREE_SLOT' ? 6 : 20)
    )
      return fail('foreign acquisition provenance');
  }
  if (composition.phase !== 'PREVIEW' && required.some((row) => !rolls.has(row.kind)))
    return fail('missing acquisition roll');
  return rolls;
}
export function sentientAcquisitionRolls(
  composition: Pick<EnemyComposedComposition, 'acquisitions' | 'advisorCardIdOrNull'>,
): ReadonlyMap<string, EnemyCompositionRoll> {
  if (composition.advisorCardIdOrNull !== composition.acquisitions.activeAdvisorCardIdOrNull)
    return fail('active Advisor card mismatch');
  const result = new Map<string, EnemyCompositionRoll>();
  const free = composition.acquisitions.freeSlotOrNull;
  if (free !== null) result.set('FREE_SLOT', free.roll);
  if (composition.advisorCardIdOrNull !== null) {
    const card =
      composition.acquisitions.advisorCards.find(
        (row) => row.cardId === composition.advisorCardIdOrNull,
      ) ?? fail('foreign Advisor card');
    result.set('ADVISER_I', card.iwRolls[0]);
    result.set('ADVISER_W', card.iwRolls[1]);
    if (card.suppressionRollOrNull !== null)
      result.set('ADVISER_SUPPRESSION', card.suppressionRollOrNull);
  }
  return result;
}
export interface SentientCompositionFacts {
  readonly specimens: readonly Readonly<{
    symbiontInstanceId: string;
    speciesKey: string;
    name: string;
    targetLevel: number;
    learnedNodeRefs: readonly string[];
    status: string;
    effectsEnabled: boolean;
    currentOE: number;
    maxOE: number;
    slotCost: number;
    specialHistories: Readonly<{
      devourings: readonly never[];
      companions: readonly never[];
      ratpack: readonly never[];
    }>;
  }>[];
  readonly occupiedSlots: number;
  readonly capacity: number;
  readonly interactions: readonly Readonly<{ kind: string; description: string }>[];
  readonly learnedRuleFacts: readonly Readonly<{
    symbiontInstanceId: string;
    nodeRef: string;
    ruleId: string;
    name: string;
    description: string;
    sourceEnabled: boolean;
    automationStatus: 'AUTOMATED_ACCEPTED' | 'NODE_ONLY_MANUAL';
  }>[];
  readonly advisorOrNull: Readonly<{
    I: number;
    W: number;
    capacity: number;
    used: number;
    skills: readonly Readonly<{ skillKey: string; bonus: number; slotCost: number }>[];
    active: boolean;
  }> | null;
  readonly lostSkills: readonly string[];
  readonly temporarilyUnavailableSkills: readonly string[];
  readonly temporarilyUnavailableAdvisorSkills: readonly string[];
  readonly startSkillSlots: Readonly<{
    capacity: number;
    used: number;
    overflow: number;
    available: number;
  }>;
  readonly dolphinSkillSlots: Readonly<{ capacity: number; used: number }>;
}
export function deriveSentientComposition(
  catalog: SentientCompositionCatalog,
  skills: SkillStageCatalog,
  build: EnemyBuild,
  basis: EnemyStats,
  composition: EnemyComposedComposition,
  initialSkills: readonly { skillKey: string; bonus: number; slotCost: number; source: string }[],
  equippedHermeticNate: boolean,
  requireComplete = true,
  equipmentMobilityModifier = 0,
  requireOwnSkillsFilled = requireComplete,
  skillPlanState?: EnemySkillPlanState,
) {
  const structural = deriveSentientCompositionStructure(catalog, build.raceCode, composition),
    rolls = validateSentientCompositionRolls(catalog, build.raceCode, composition),
    present = structural.instances.filter(
      (row) => row.status === 'ACTIVE' || row.status === 'SUPPRESSED',
    ),
    active = (species: string, node: string) =>
      present.find(
        (row) =>
          row.speciesKey === species && row.effectsEnabled && row.learnedNodeRefs.includes(node),
      );
  if (requireComplete && composition.phase !== 'CONFIRMED')
    return fail('explicit interaction confirmation and continuations required');
  const stats = { ...basis };
  const add = (stat: StatCode, delta: number) => {
    stats[stat] += delta;
    if (!Number.isSafeInteger(stats[stat])) return fail('stat overflow');
  };
  for (const specimen of present) {
    if (!specimen.effectsEnabled) continue;
    const species =
      catalog.symbionts.species.find((row) => row.speciesKey === specimen.speciesKey) ??
      fail('unknown source species');
    for (const modifier of species.modifiers) {
      if (
        modifier.contextPredicate !== 'symbiontActive=true' &&
        modifier.contextPredicate !== 'symbiontActive=true AND NOT equippedHermeticNate'
      )
        return fail('unsupported profile predicate');
      if (equippedHermeticNate && modifier.contextPredicate.endsWith('NOT equippedHermeticNate'))
        continue;
      if (
        specimen.speciesKey === 'PLAGUE_DOCTOR' &&
        specimen.learnedNodeRefs.includes('MON-061') &&
        modifier.value < 0
      )
        continue;
      add(modifier.targetCode, modifier.value);
    }
  }
  const teacher = active('TEACHER', 'SYM-054'),
    dolphin = active('DOLPHIN', 'SYM-162');
  const teacherRate = number(catalog, 'SYM-054', /min\((\d+)L/u),
    teacherCap = number(catalog, 'SYM-054', /L,(\d+)−W_base/u);
  if (teacher !== undefined) {
    add('W', teacherRate * teacher.targetLevel);
    if (present.length === 1)
      add('I', Math.max(0, Math.min(teacherRate * teacher.targetLevel, teacherCap - basis.I)));
  }
  if (dolphin !== undefined)
    add('I', number(catalog, 'SYM-162', /на (\d+)L/u) * dolphin.targetLevel);
  for (const [species, node, stat] of [
    ['ARMADILLO', 'SYM-062', 'Z'],
    ['TICK', 'SYM-108', 'S'],
    ['SPIDER', 'SYM-122', 'D'],
  ] as const) {
    const specimen = active(species, node);
    if (specimen !== undefined) add(stat, specimen.targetLevel);
  }
  if (active('CHIMERA', 'MON-016')) add('M', number(catalog, 'MON-016', /M \+= (\d+)/u));
  const dominant = active('PUPPETEER', 'MON-028');
  if (dominant !== undefined) {
    if (algorithm(catalog, 'MON-028') !== 'I += L.') return fail('MON-028 changed');
    add('I', dominant.targetLevel);
  }
  const free = rolls.get('FREE_SLOT');
  const trogr = active('TROGR', 'SYM-076');
  const minimums: Partial<Record<StatCode, number>> = {},
    maximums: Partial<Record<StatCode, number>> = {};
  if (trogr !== undefined) {
    const coefficient = number(catalog, 'SYM-076', /добавить \+(\d+) к S/u);
    for (const stat of ENEMY_STATS)
      add(stat, (['S', 'D', 'M', 'Z'].includes(stat) ? 1 : -1) * coefficient * trogr.targetLevel);
    const absorbedTeacher = trogr.absorbedSpeciesKeys.includes('TEACHER'),
      suppression = rolls.get('ADVISER_SUPPRESSION');
    for (const stat of ENEMY_STATS) {
      if (['S', 'D', 'M', 'Z'].includes(stat))
        maximums[stat] =
          build.raceCode === 'UNITED'
            ? number(catalog, 'SYM-076', /потолка (\d+) у Единого/u)
            : number(catalog, 'SYM-076', /Единого\/(\d+) у Вольного/u);
      else
        minimums[stat] =
          (absorbedTeacher && (stat === 'I' || stat === 'W') ? 4 : 1) +
          (stat === 'I' && suppression !== undefined
            ? calculateTrogrSuppressionBonus(suppression.mechanical)
            : 0);
    }
  }
  if (teacher !== undefined) maximums.W = teacherCap;
  if (dolphin !== undefined) maximums.I = number(catalog, 'SYM-162', /выше (\d+)/u);
  const limited = (stat: StatCode, value: number) =>
    Math.min(maximums[stat] ?? Infinity, Math.max(minimums[stat] ?? -Infinity, value));
  if (free !== undefined)
    for (const stat of ['S', 'M', 'Z'] as const) {
      // AQ2-015 fixes the acquisition consequence against the current source-limited basis.
      // AQA-005 adds that delta to the raw sum BEFORE applying the final species limits.
      stats[stat] +=
        composition.acquisitions.freeSlotOrNull?.permanentStatConsequence[stat] ??
        fail('missing immutable FREE consequence');
    }
  for (const stat of ENEMY_STATS) stats[stat] = limited(stat, stats[stat]);
  if (requireComplete && Object.values(stats).some((value) => value < 1))
    return fail(
      'CORE-164 final permanent stat below one; change the composition or actual equipment',
    );
  const meets = (key: string) => {
    const definition =
      skills.skills.find((row) => row.skillKey === key) ?? fail('unknown source skill ' + key);
    if (
      definition.category === 'FIXED_RACE_PASSIVE' ||
      definition.category === 'FIXED_CLASS_PASSIVE'
    )
      return true;
    const requirements = skills.requirements.filter((row) => row.skillKey === key);
    if (requirements.some((row) => !Number.isFinite(stats[row.statCode])))
      return fail('invalid requirement stat');
    return requirements.every((row) => stats[row.statCode] >= row.minValue);
  };
  const plan = skillPlanState?.planOrNull;
  const paid = plan == null ? null : (plan.accountingOrNull?.knownSkills ?? plan.initialSkills);
  const learned =
    paid === null
      ? initialSkills.filter((row) => meets(row.skillKey)).map((row) => ({ ...row }))
      : paid.map((row) => ({
          skillKey: row.skillKey,
          bonus: row.bonus,
          slotCost: row.startSlots + row.dolphinSlots,
          source: row.source,
        }));
  const lostSkills =
    paid === null
      ? initialSkills.filter((row) => !meets(row.skillKey)).map((row) => row.skillKey)
      : [...new Set(plan?.accountingOrNull?.permanentLosses.map((row) => row.skillKey) ?? [])];
  // SYM-079 acquisition is independent of whether a newly acquired Trogr survives the OE duel.
  let grossGrantCandidateOrNull: {
    symbiontInstanceId: string;
    bonusBefore: number;
    bonusAfter: number;
  } | null = null;
  const grossSource = structural.instances.find(
    (row) => row.speciesKey === 'TROGR' && row.learnedNodeRefs.includes('SYM-079'),
  );
  if (
    paid === null &&
    ((grossSource !== undefined && composition.acquisitions.grossGrantOrNull === null) ||
      composition.acquisitions.grossGrantOrNull?.lostAtCommandIdOrNull === null)
  ) {
    const definition =
      skills.skills.find((row) => row.skillKey === 'GROSS') ?? fail('source GROSS skill absent');
    const before = learned.find((row) => row.skillKey === definition.skillKey),
      index = learned.findIndex((row) => row.skillKey === definition.skillKey);
    const bonusBefore = before?.bonus ?? 0;
    const bonus =
      composition.acquisitions.grossGrantOrNull === null
        ? bonusBefore === 0
          ? 3
          : bonusBefore >= 5
            ? bonusBefore
            : Math.min(5, bonusBefore + 3)
        : Math.max(bonusBefore, composition.acquisitions.grossGrantOrNull.bonusAfter);
    if (composition.acquisitions.grossGrantOrNull === null && grossSource !== undefined)
      grossGrantCandidateOrNull = {
        symbiontInstanceId: grossSource.symbiontInstanceId,
        bonusBefore,
        bonusAfter: bonus,
      };
    if (meets(definition.skillKey)) {
      const grant = {
        skillKey: definition.skillKey,
        bonus,
        slotCost: before?.slotCost ?? 0,
        source: 'SYMBIONT_GRANTED',
      };
      if (index < 0) learned.push(grant);
      else learned[index] = grant;
    } else if (!lostSkills.includes(definition.skillKey)) lostSkills.push(definition.skillKey);
  }
  if (
    paid === null &&
    composition.acquisitions.grossGrantOrNull?.lostAtCommandIdOrNull != null &&
    !learned.some((row) => row.skillKey === 'GROSS') &&
    !lostSkills.includes('GROSS')
  )
    lostSkills.push('GROSS');
  const startCapacity = Math.max(
      0,
      Math.min(plan?.initialStartCapacity ?? Math.ceil(basis.W / 2), Math.ceil(stats.W / 2)),
    ),
    startUsed =
      paid === null
        ? learned.reduce((sum, row) => sum + row.slotCost, 0)
        : paid.reduce((sum, row) => sum + row.startSlots, 0);
  const dolphinCapacity =
    active('DOLPHIN', 'SYM-166') === undefined
      ? 0
      : number(catalog, 'SYM-166', /добавить (\d+) слотов/u);
  let dolphinUsed = paid === null ? 0 : paid.reduce((sum, row) => sum + row.dolphinSlots, 0);
  for (const choice of paid === null ? composition.skills.dolphinSkills : []) {
    const definition =
      skills.skills.find((row) => row.skillKey === choice.skillKey) ??
      fail('unknown Dolphin skill');
    if (definition.category !== 'SELECTABLE_GENERAL' || !meets(choice.skillKey))
      return fail('invalid Dolphin skill/requirements');
    if (definition.maxBonus !== 'NO_RULED_UPPER_LIMIT' && choice.targetBonus > definition.maxBonus)
      return fail('skill maximum exceeded');
    const before = learned.find((row) => row.skillKey === choice.skillKey),
      cost =
        calculateSkillSlotCost(choice.targetBonus) -
        (before === undefined ? 0 : calculateSkillSlotCost(before.bonus));
    if (cost <= 0) return fail('Dolphin selection must improve the real skill');
    dolphinUsed += cost;
    if (before === undefined)
      learned.push({
        skillKey: choice.skillKey,
        bonus: choice.targetBonus,
        slotCost: cost,
        source: 'SYMBIONT_SELECTED',
      });
    else {
      before.bonus = choice.targetBonus;
      before.slotCost += cost;
    }
  }
  if (paid === null && dolphinUsed > dolphinCapacity)
    return fail('Dolphin skill capacity exceeded');
  let advisorOrNull: SentientCompositionFacts['advisorOrNull'] = null;
  const adviser = structural.instances.find((row) => row.speciesKey === 'ADVISER');
  if (adviser !== undefined && composition.advisorCardIdOrNull !== null) {
    const first = rolls.get('ADVISER_I') ?? fail('Advisor I roll missing'),
      second = rolls.get('ADVISER_W') ?? fail('Advisor W roll missing'),
      iw = resolveAdvisorIwRolls([first.mechanical, second.mechanical]);
    const bodyStats = {
      S: stats.S,
      D: stats.D,
      M: Math.max(1, stats.M + equipmentMobilityModifier),
      Z: stats.Z,
      C: stats.C,
    };
    const capacity = Math.ceil(iw.W.value / 2);
    const retained = skillPlanState?.advisorKnowledge.find(
      (row) => row.cardId === composition.advisorCardIdOrNull,
    );
    const provisional =
      retained === undefined
        ? composition.skills.advisorSkills.map((selection) => {
            const definition =
              skills.skills.find((row) => row.skillKey === selection.skillKey) ??
              fail('unknown Advisor skill');
            if (
              definition.category !== 'SELECTABLE_GENERAL' ||
              (definition.maxBonus !== 'NO_RULED_UPPER_LIMIT' &&
                selection.targetBonus > definition.maxBonus)
            )
              return fail('invalid Advisor skill definition/bonus');
            return {
              skillKey: definition.skillKey,
              bonus: selection.targetBonus,
              slotCost: calculateSkillSlotCost(selection.targetBonus),
            };
          })
        : retained.knownSkills.map((skill) => ({
            skillKey: skill.skillKey,
            bonus: skill.bonus,
            slotCost: skill.startSlots,
          }));
    const used = provisional.reduce((sum, row) => sum + row.slotCost, 0);
    if (used > capacity || (requireOwnSkillsFilled && retained === undefined && used !== capacity))
      return fail('Advisor skill slots underfilled/overfilled');
    const selected =
      requireComplete && skillPlanState === undefined
        ? validateAdvisorSkillSelection(skills, {
            advisorIw: iw,
            bodyStats,
            selectedSkills: composition.skills.advisorSkills,
          })
        : null;
    advisorOrNull = {
      I: iw.I.value,
      W: iw.W.value,
      capacity,
      used,
      skills: selected?.learnedSkills ?? provisional,
      active: adviser.effectsEnabled,
    };
  } else if (composition.skills.advisorSkills.length !== 0) return fail('orphan Advisor skills');
  const learnedRuleFacts = new Map<string, SentientCompositionFacts['learnedRuleFacts'][number]>();
  for (const specimen of present)
    for (const ref of specimen.learnedNodeRefs) {
      const node =
        catalog.development.nodes.find(
          (row) => row.nodeRef === ref && row.speciesKey === specimen.speciesKey,
        ) ?? fail('learned node absent');
      for (const id of node.ruleIds) {
        const rows = catalog.rules.filter((row) => row['Rule ID'] === id);
        const row = rows[0] ?? fail('missing learned source fact ' + id);
        if (
          rows.length !== 1 ||
          (row['Статус'] !== 'Активно' &&
            !(
              node.nodeKind === 'STRUCTURAL_NODE_ONLY' &&
              node.automationStatus === 'NODE_ONLY_MANUAL' &&
              row['Статус'] === 'Не автоматизируется'
            ))
        )
          return fail('learned node/rule status mismatch ' + id);
        // Preserve every learned source fact. A category substring is not a mechanics classifier.
        if (typeof row['Название'] !== 'string' || typeof row['Итоговый алгоритм'] !== 'string')
          return fail('invalid learned source text');
        learnedRuleFacts.set(ref + '/' + id, {
          symbiontInstanceId: specimen.symbiontInstanceId,
          nodeRef: ref,
          ruleId: id,
          name: row['Название'],
          description: row['Итоговый алгоритм'],
          sourceEnabled:
            specimen.effectsEnabled &&
            !(specimen.suppressedAbilities.includes('DOUBLE_FOCUS') && ref === 'SYM-126'),
          automationStatus: node.automationStatus,
        });
      }
    }
  const facts: SentientCompositionFacts = {
    specimens: present.map((row) => ({
      symbiontInstanceId: row.symbiontInstanceId,
      speciesKey: row.speciesKey,
      name:
        catalog.symbionts.species.find((species) => species.speciesKey === row.speciesKey)
          ?.speciesLabel ?? fail('species label'),
      targetLevel: row.targetLevel,
      learnedNodeRefs: row.learnedNodeRefs,
      status: row.status,
      effectsEnabled: row.effectsEnabled,
      currentOE: row.nativeMaxOE,
      maxOE: row.nativeMaxOE,
      slotCost: row.slotCost,
      specialHistories: { devourings: [], companions: [], ratpack: [] },
    })),
    occupiedSlots: structural.occupiedSlots,
    capacity:
      structural.sourceSlotCapacity + (free === undefined || build.raceCode !== 'FREE' ? 0 : 1),
    interactions: structural.consequences.map((row) => {
      const name = (id: string) => {
        const member =
          structural.instances.find((member) => member.symbiontInstanceId === id) ??
          fail('interaction specimen missing');
        return (
          catalog.symbionts.species.find((species) => species.speciesKey === member.speciesKey)
            ?.speciesLabel ?? fail('interaction species missing')
        );
      };
      switch (row.kind) {
        case 'ABSORPTION':
          return {
            kind: row.kind,
            description: `${name(row.absorberInstanceId)} поглощает ${name(row.absorbedInstanceId)}; поглощённый вид не остаётся отдельным живым экземпляром.`,
          };
        case 'DOLPHIN_LEARNED_GRANT':
          return {
            kind: row.kind,
            description: `${name(row.symbiontInstanceId)}: уровень ${row.beforeLevel} → ${row.afterLevel}; бесплатно изучены: ${row.addedNodeRefs.map((ref) => catalog.development.nodes.find((node) => node.nodeRef === ref)?.label ?? fail('grant node missing')).join(', ') || 'новых узлов нет'}.`,
          };
        case 'CURRENT_OE_DUEL':
          return {
            kind: row.kind,
            description: `Дуэль ОЭ: ${name(row.trogrInstanceId)} ${row.trogrCurrentOeBefore}, ${name(row.keeperInstanceId)} ${row.keeperCurrentOeBefore}. ${row.outcome === 'TIE' ? 'Равенство: оба сохраняются' : row.outcome === 'TROGR_DESTROYED' ? 'Трогр уничтожен' : 'Хранитель уничтожен'}${row.winnerCurrentOeAfterOrNull === null ? '.' : `; ОЭ победителя после дуэли ${row.winnerCurrentOeAfterOrNull}.`}`,
          };
        case 'SPECIES_SUPPRESSION':
          return {
            kind: row.kind,
            description: `${name(row.symbiontInstanceId)}: ${row.before === 'ACTIVE' ? 'активен' : 'подавлен'} → ${row.after === 'ACTIVE' ? 'активен' : 'подавлен'}.`,
          };
        case 'ABILITY_SUPPRESSION':
          return {
            kind: row.kind,
            description: `${name(row.symbiontInstanceId)}: «Двойной фокус внимания» ${row.suppressed ? 'подавлен' : 'восстановлен'}.`,
          };
        case 'NATIVE_OE_CLAMP':
          return {
            kind: row.kind,
            description: `${name(row.symbiontInstanceId)}: исходное ограничение ОЭ ${row.before} → ${row.after}. При создании V1 выживший экземпляр начинает с полным итоговым максимумом ОЭ.`,
          };
      }
    }),
    learnedRuleFacts: [...learnedRuleFacts.values()],
    advisorOrNull,
    lostSkills,
    temporarilyUnavailableSkills: [],
    temporarilyUnavailableAdvisorSkills: [],
    startSkillSlots: {
      capacity: startCapacity,
      used: startUsed,
      overflow: Math.max(0, startUsed - startCapacity),
      available: Math.max(0, startCapacity - startUsed),
    },
    dolphinSkillSlots: { capacity: dolphinCapacity, used: dolphinUsed },
  };
  return { permanentStats: stats, learnedSkills: learned, facts, grossGrantCandidateOrNull };
}
