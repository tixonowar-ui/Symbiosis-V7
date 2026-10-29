import type { StatCode } from '@generated/types/character.js';

import {
  calculateSkillSlotCost,
  calculateStartSkillSlots,
  validateSkillRequirements,
  validateSkillSelectionDraft,
} from '../skill-stage/skills.js';
import { calculateSkillStageStats } from '../skill-stage/stats.js';
import { resolveSymbiontComposition } from '../symbiont-stage/composition.js';
import { CreationFinalizationError } from './catalog.js';
import type {
  CreationFinalizationCatalog,
  CreationFinalMechanics,
  CreationFinalMechanicsInput,
  CreationFinalLearnedSkill,
  CreationFinalStatProof,
  CreationInitialRuntime,
  CreationInitialSymbiont,
  CreationPermanentSkillGrant,
  CreationValidationBlocker,
} from './types.js';

const STATS = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const empty = Object.freeze<[]>([]);
const zeroStats = (): Record<StatCode, number> => ({ S: 0, D: 0, M: 0, Z: 0, I: 0, W: 0, C: 0 });

function fail(detail: string): never {
  throw new CreationFinalizationError(detail);
}
function safeInteger(value: unknown, label: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    fail(`${label} must be a safe integer >= ${String(minimum)}`);
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateComposition(
  catalog: CreationFinalizationCatalog,
  input: CreationFinalMechanicsInput,
): void {
  if (input.raceCode === 'PURE') {
    if (
      input.creationMode !== null ||
      input.composition !== null ||
      input.advisorSuppressionBonusOrNull !== null
    )
      fail('PURE requires explicit null composition, acquisition mode and suppression bonus');
    return;
  }
  if (input.creationMode !== 'MANUAL' && input.creationMode !== 'RANDOM')
    fail('non-PURE acquisition mode is missing');
  if (input.composition === null || input.composition.raceCode !== input.raceCode)
    fail('composition race differs from active race');
  const computed = resolveSymbiontComposition(catalog.symbionts, {
    raceCode: input.raceCode,
    acceptedSpecies: input.composition.acceptedSpecies,
  });
  // The final step consumes already resolved interactions; it must not silently repair
  // an edited status/currentOE by recalculating a different composition.
  if (canonical(computed) !== canonical(input.composition))
    fail('resolved composition differs from its accepted source history');
  const suppressedAdvisor = computed.instances.some(
    (entry) => entry.speciesKey === 'ADVISER' && entry.status === 'SUPPRESSED',
  );
  if (suppressedAdvisor) {
    const bonus = safeInteger(input.advisorSuppressionBonusOrNull, 'suppression bonus', 0);
    if (bonus > 5) fail('suppression bonus exceeds rounded D20/4');
  } else if (input.advisorSuppressionBonusOrNull !== null)
    fail('suppression bonus exists without suppressed Adviser');
}

function permanentSkills(
  input: CreationFinalMechanicsInput,
  trogrLevel: number,
): {
  learnedSkills: readonly CreationFinalLearnedSkill[];
  permanentGrants: readonly CreationPermanentSkillGrant[];
} {
  if (input.permanentGrants.length > 1) fail('Trogr permanent skill grant may occur only once');
  const grants = input.permanentGrants.map((grant) => {
    if (
      Object.keys(grant).sort().join(',') !== 'bonusAfter,bonusBefore,kind' ||
      grant.kind !== 'TROGR_GROSS'
    )
      fail('unknown permanent skill grant');
    const before = safeInteger(grant.bonusBefore, 'grant bonusBefore', 0);
    const after = before === 0 ? 3 : Math.max(before, Math.min(5, before + 3));
    if (grant.bonusAfter !== after) fail('Trogr permanent grant does not match the source bonus');
    return Object.freeze({ ...grant });
  });
  const skills: CreationFinalLearnedSkill[] = input.learnedSkills.map((skill) =>
    Object.freeze({ ...skill }),
  );
  const grossIndex = skills.findIndex((skill) => skill.skillKey === 'GROSS');
  const previous = grossIndex === -1 ? undefined : skills[grossIndex];
  // AQA-008 gives Trogr the L4 node for free; SYM-079 and SYM-185 make its
  // consequence permanent and non-repeatable across branch switches/removal.
  if (grants.length === 0 && trogrLevel >= 4) {
    const bonusBefore = previous?.bonus ?? 0;
    grants.push(
      Object.freeze({
        kind: 'TROGR_GROSS',
        bonusBefore,
        bonusAfter: bonusBefore === 0 ? 3 : Math.max(bonusBefore, Math.min(5, bonusBefore + 3)),
      }),
    );
  }
  const grant = grants[0];
  if (grant !== undefined) {
    if (previous === undefined)
      skills.push(
        Object.freeze({
          source: 'SYMBIONT_PERMANENT',
          skillKey: 'GROSS',
          bonus: grant.bonusAfter,
          slotCost: 0,
        }),
      );
    else
      skills[grossIndex] = Object.freeze({
        ...previous,
        bonus: Math.max(previous.bonus, grant.bonusAfter),
      });
  }
  return { learnedSkills: Object.freeze(skills), permanentGrants: Object.freeze(grants) };
}

/** AQA-005/008/009: no RNG, mutations, equipment, XP, or incremental stat updates. */
export function deriveCreationFinalMechanics(
  catalog: CreationFinalizationCatalog,
  input: CreationFinalMechanicsInput,
): CreationFinalMechanics {
  validateComposition(catalog, input);
  const { skillStageStats } = calculateSkillStageStats(catalog.symbionts.skillStage, {
    baseStats: input.baseStats,
    raceCode: input.raceCode,
    classCode: input.classCode,
    // PURE has no acquisition mode. The skill-stage function's mode is irrelevant
    // for PURE because every matching predicate is ownerRace=PURE.
    creationMode: input.creationMode === null ? 'MANUAL' : input.creationMode,
  });
  const blockers: CreationValidationBlocker[] = [];
  const instances = input.composition?.instances ?? [];
  const active = (key: string) =>
    instances.find((entry) => entry.speciesKey === key && entry.status === 'ACTIVE');
  const present = (key: string) =>
    instances.some(
      (entry) =>
        entry.speciesKey === key && (entry.status === 'ACTIVE' || entry.status === 'SUPPRESSED'),
    );
  const trogr = active('TROGR');
  const trogrLevel =
    trogr === undefined ? 0 : trogr.absorbedSpeciesKeys.includes('DOLPHIN') ? 5 : 1;
  const positive = zeroStats();
  const negative = zeroStats();
  const add = (stat: StatCode, delta: number): void => {
    if (delta < 0) negative[stat] += delta;
    else positive[stat] += delta;
    if (!Number.isSafeInteger(negative[stat]) || !Number.isSafeInteger(positive[stat]))
      fail('stat delta exceeds safe integer representation');
  };
  for (const instance of instances) {
    if (instance.status !== 'ACTIVE') continue;
    const species = catalog.symbionts.species.find(
      (candidate) => candidate.speciesKey === instance.speciesKey,
    );
    if (species === undefined) fail('unknown composition species');
    for (const modifier of species.modifiers) {
      if (
        modifier.contextPredicate !== 'symbiontActive=true' &&
        modifier.contextPredicate !== 'symbiontActive=true AND NOT equippedHermeticNate'
      )
        fail('unsupported final modifier predicate');
      add(modifier.targetCode, modifier.value);
    }
  }
  if (active('TEACHER') !== undefined) {
    add('W', 4);
    if (
      instances.filter((entry) => entry.status === 'ACTIVE' || entry.status === 'SUPPRESSED')
        .length === 1
    )
      add('I', Math.max(0, Math.min(4, 20 - skillStageStats.I)));
  }
  if (active('DOLPHIN') !== undefined) add('I', 5);
  if (trogr !== undefined) {
    for (const stat of ['S', 'D', 'M', 'Z'] as const) add(stat, 6 * trogrLevel);
    for (const stat of ['I', 'W', 'C'] as const) add(stat, -6 * trogrLevel);
  }
  const effective = zeroStats();
  const statProof = STATS.map((statCode): CreationFinalStatProof => {
    const beforeNegative = skillStageStats[statCode] + positive[statCode];
    if (!Number.isSafeInteger(beforeNegative))
      fail('pre-limit stat exceeds safe integer representation');
    // This floor restricts new negative deltas; it never lifts an already invalid
    // race/class value to one. A positive passive may independently change it.
    const appliedNegativeDelta =
      input.creationMode === 'RANDOM'
        ? Math.max(negative[statCode], Math.min(0, 1 - beforeNegative))
        : negative[statCode];
    const beforeLimits = beforeNegative + appliedNegativeDelta;
    let minimumOrNull: number | null = null;
    let maximumOrNull: number | null = null;
    if (statCode === 'W' && active('TEACHER') !== undefined) maximumOrNull = 20;
    if (statCode === 'I' && active('DOLPHIN') !== undefined) maximumOrNull = 30;
    if (trogr !== undefined) {
      if (statCode === 'S' || statCode === 'D' || statCode === 'M' || statCode === 'Z')
        maximumOrNull = input.raceCode === 'UNITED' ? 25 : 35;
      else {
        minimumOrNull =
          (statCode === 'I' || statCode === 'W') && trogr.absorbedSpeciesKeys.includes('TEACHER')
            ? 4
            : 1;
        if (statCode === 'I' && input.advisorSuppressionBonusOrNull !== null)
          minimumOrNull += input.advisorSuppressionBonusOrNull;
      }
    }
    const effectiveValue = Math.max(
      minimumOrNull ?? -Infinity,
      Math.min(maximumOrNull ?? Infinity, beforeLimits),
    );
    if (!Number.isSafeInteger(effectiveValue))
      fail(`effective ${statCode} exceeds safe integer representation`);
    effective[statCode] = effectiveValue;
    if (effectiveValue < 1)
      blockers.push(
        Object.freeze({
          kind: 'STATS',
          code: `STAT_${statCode}_BELOW_ONE`,
          message: `Характеристика ${statCode} должна быть не меньше 1.`,
          returnFormId: 'CHR-009',
        }),
      );
    return Object.freeze({
      statCode,
      skillStageValue: skillStageStats[statCode],
      positiveSymbiontDelta: positive[statCode],
      negativeSymbiontDelta: negative[statCode],
      appliedNegativeDelta,
      beforeLimits,
      minimumOrNull,
      maximumOrNull,
      effectiveValue,
    });
  });
  const seenSkills = new Set<string>();
  let used = 0;
  for (const skill of input.learnedSkills) {
    if (seenSkills.has(skill.skillKey)) fail('duplicate learned skill');
    seenSkills.add(skill.skillKey);
    safeInteger(skill.bonus, 'learned skill bonus', 1);
    used += safeInteger(skill.slotCost, 'learned skill slot cost', 0);
    const definition = catalog.symbionts.skillStage.skills.find(
      (entry) => entry.skillKey === skill.skillKey,
    );
    if (definition === undefined) fail('unknown learned skill');
    if (
      skill.source !== 'SELECTED' &&
      skill.source !== 'RACE_GRANTED' &&
      skill.source !== 'CLASS_MANDATORY'
    )
      fail('unknown learned skill source');
    if (
      skill.source === 'SELECTED' &&
      (definition.category !== 'SELECTABLE_GENERAL' ||
        skill.slotCost !== calculateSkillSlotCost(skill.bonus))
    )
      fail('selected skill cost differs from its source level');
    try {
      // Acquisition was proven against pre-symbiont stats in its receipt. At
      // finalization CORE-166/AQA-004 also require permanent threshold retention.
      validateSkillRequirements(catalog.symbionts.skillStage, skill.skillKey, effective);
    } catch {
      blockers.push(
        Object.freeze({
          kind: 'SKILLS',
          code: 'SKILL_REQUIREMENT',
          message: 'Для изученного навыка не выполнены требования.',
          returnFormId: 'CHR-015',
        }),
      );
    }
  }
  if (!Number.isSafeInteger(used)) fail('used skill slots exceed safe integer representation');
  try {
    const expected = validateSkillSelectionDraft(catalog.symbionts.skillStage, {
      raceCode: input.raceCode,
      classCode: input.classCode,
      skillStageStats,
      selectedSkills: [],
    });
    const normalized = (skills: readonly CreationFinalLearnedSkill[]) =>
      [...skills]
        .sort((a, b) => a.skillKey.localeCompare(b.skillKey))
        .map((skill) => [skill.skillKey, skill.source, skill.bonus, skill.slotCost]);
    if (
      JSON.stringify(normalized(expected.learnedSkills)) !==
      JSON.stringify(normalized(input.learnedSkills.filter((skill) => skill.source !== 'SELECTED')))
    )
      blockers.push(
        Object.freeze({
          kind: 'SKILLS',
          code: 'SKILL_PROVENANCE',
          message: 'Навыки и стоимость слотов не соответствуют выбранным расе и классу.',
          returnFormId: 'CHR-015',
        }),
      );
  } catch {
    blockers.push(
      Object.freeze({
        kind: 'SKILLS',
        code: 'SKILL_SELECTION',
        message: 'Выбор стартовых навыков требует исправления.',
        returnFormId: 'CHR-015',
      }),
    );
  }
  if (skillStageStats.W < 1 || used < calculateStartSkillSlots(skillStageStats))
    blockers.push(
      Object.freeze({
        kind: 'SKILLS',
        code: 'START_SLOTS_NOT_FILLED',
        message: 'Все стартовые слоты навыков должны быть заполнены.',
        returnFormId: 'CHR-015',
      }),
    );
  if (input.composition !== null) {
    const monster = input.composition.instances.some((entry) => entry.kind === 'SYMBIOTIC_MONSTER');
    if (
      !monster &&
      input.composition.acceptedSpecies.length !== (input.raceCode === 'UNITED' ? 4 : 1)
    )
      blockers.push(
        Object.freeze({
          kind: 'SYMBIONT_COMPOSITION',
          code: 'COMPOSITION_INCOMPLETE',
          message: 'Исходный состав симбионтов должен быть полностью подтверждён.',
          returnFormId: 'CHR-019',
        }),
      );
  }
  const symbionts = instances.map((instance): CreationInitialSymbiont => {
    const species = catalog.symbionts.species.find(
      (entry) => entry.speciesKey === instance.speciesKey,
    )!;
    const level =
      instance.speciesKey === 'TROGR' && instance.absorbedSpeciesKeys.includes('DOLPHIN') ? 5 : 1;
    const surviving = instance.status === 'ACTIVE' || instance.status === 'SUPPRESSED';
    const maxOe = species.initialCurrentOe * level;
    return Object.freeze({
      acceptedIndex: instance.acceptedIndex,
      speciesKey: instance.speciesKey,
      status: instance.status,
      level,
      maxOe,
      currentOe: Math.min(instance.currentOe, maxOe),
      xp: 0,
      learnedNodeRefs: Object.freeze(
        surviving
          ? catalog.initialNodes
              .filter((node) => node.speciesKey === instance.speciesKey && node.level <= level)
              .map((node) => node.nodeRef)
          : [],
      ),
      effectsEnabled: instance.status === 'ACTIVE',
      xpEligible:
        surviving &&
        !(
          (instance.speciesKey === 'ADVISER' || instance.speciesKey === 'TAIPAN') &&
          instance.status === 'SUPPRESSED'
        ),
    });
  });
  const maxHp = 100 + 20 * trogrLevel;
  const initialRuntime: CreationInitialRuntime = Object.freeze({
    maxHp,
    currentHp: maxHp,
    alive: true,
    conscious: true,
    stunned: false,
    bound: false,
    burning: false,
    poisoned: false,
    diseased: false,
    wounds: empty,
    injuries: empty,
    bleeding: empty,
    temporaryEffects: empty,
    cooldowns: empty,
    preparations: empty,
    initiativeOrNull: null,
    combatSceneIdOrNull: null,
    statProgressionCounters: Object.freeze(zeroStats()),
    combatUsageLimits: empty,
    symbiontXpProgressPoints: 0,
    unallocatedSymbiontXp: 0,
    equippedItems: empty,
    generatedObjects: empty,
    externalEntities: empty,
    chimeraDevouringHistory: empty,
    chimeraExtraSlots: 0,
    taipanPoisonOrNull: present('TAIPAN') ? 'DEADLY' : null,
    penguinMiMiMiActive: active('PENGUIN') !== undefined,
    ratInsideHost: present('RAT'),
    keeperInsideHost: present('KEEPER'),
    mantisBladeStateOrNull: present('MANTIS') ? 'ORDINARY' : null,
  });
  const priorLedger = input.trainingSlotLedger;
  if (priorLedger !== null) {
    safeInteger(priorLedger.maxPermanentWisdom, 'maximum permanent wisdom', 0);
    if (
      Object.keys(priorLedger).sort().join(',') !== 'everIssued,maxPermanentWisdom' ||
      priorLedger.everIssued !== Math.floor(priorLedger.maxPermanentWisdom / 2)
    )
      fail('training slot ledger differs from its historical maximum');
  }
  const maxPermanentWisdom = Math.max(
    priorLedger?.maxPermanentWisdom ?? 0,
    skillStageStats.W,
    effective.W,
  );
  const trainingSlotLedger = Object.freeze({
    maxPermanentWisdom,
    everIssued: Math.floor(maxPermanentWisdom / 2),
  });
  return Object.freeze({
    skillStageStats,
    effectiveStats: Object.freeze(effective),
    statProof: Object.freeze(statProof),
    ...permanentSkills(input, trogrLevel),
    trainingSlotLedger,
    symbionts: Object.freeze(symbionts),
    initialRuntime,
    blockers: Object.freeze(blockers),
  });
}
