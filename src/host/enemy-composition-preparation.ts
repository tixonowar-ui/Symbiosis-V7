import type { EnemyAttempt, EnemyWorkflowRequest } from '@shared/enemy-authoring.js';
import {
  enemyComposedCompositionValue,
  enemyCompositionPatchValue,
  emptyEnemyCompositionAcquisitions,
  type EnemyComposedComposition,
  type EnemyCompositionRoll,
} from '@shared/enemy-composition.js';
import { calculateSkillStageStats } from '../domain/rules/skill-stage/stats.js';
import { enemyEmptyCompositionValue } from '../domain/entities/enemy-template/sentient-authoring.js';
import { validateSkillSelection } from '../domain/rules/skill-stage/skills.js';
import {
  deriveSentientComposition,
  deriveSentientCompositionStructure,
  sentientCompositionRollRequirements,
  sentientAcquisitionRolls,
} from '../domain/entities/enemy-template/sentient-composition.js';
import type { EnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  createRollSourceSnapshot,
  resolveAutoRoll,
  resolveManualRoll,
} from '../domain/entities/roll-request/roll-model.js';

export interface EnemyCompositionIssuedValues {
  readonly instanceIds: readonly string[];
  readonly advisorCardIdOrNull: string | null;
  readonly rolls: readonly EnemyCompositionRoll[];
}
export interface EnemyCompositionDiceSource {
  readonly diceModeSnapshot: 'AUTO' | 'MANUAL';
  readonly lifecycleSourceCommandIdOrNull: string | null;
}
export function enemyCompositionInitialBasis(
  catalog: EnemyAuthoringSourceCatalog,
  attempt: EnemyAttempt,
) {
  const build = attempt.buildOrNull ?? s.fail('UNAVAILABLE'),
    baseStats = attempt.baseStatsOrNull ?? s.fail('UNAVAILABLE');
  const { skillStageStats } = calculateSkillStageStats(catalog.skills, {
    baseStats,
    raceCode: build.raceCode,
    classCode: build.pureClassOrNull,
    creationMode: 'MANUAL',
  });
  const selected = validateSkillSelection(catalog.skills, {
    raceCode: build.raceCode,
    classCode: build.pureClassOrNull,
    skillStageStats,
    selectedSkills: build.skillSelections,
  });
  return { build, skillStageStats, selected };
}
/** Also used in historical replay with the actual immutable issued values, never a sampler. */
export function prepareEnemyComposition(
  catalog: EnemyAuthoringSourceCatalog,
  attempt: EnemyAttempt,
  request: EnemyWorkflowRequest,
  diceSource: EnemyCompositionDiceSource,
  issued: EnemyCompositionIssuedValues,
): EnemyComposedComposition {
  if (request.payload.stage !== 'SENTIENT_SYMBIONTS') return s.fail('INVALID_INPUT');
  const basis = enemyCompositionInitialBasis(catalog, attempt);
  if (attempt.schemaVersion !== 2 || attempt.skillPlanState?.planOrNull == null)
    return s.fail('UNAVAILABLE');
  if (!Object.hasOwn(request.payload.data ?? {}, 'operation')) {
    enemyEmptyCompositionValue(request.payload.data);
    if (
      attempt.compositionAcquisitions !== undefined ||
      issued.instanceIds.length !== 0 ||
      issued.advisorCardIdOrNull !== null ||
      issued.rolls.length !== 0
    )
      return s.fail('INVALID_INPUT');
    return enemyComposedCompositionValue({
      schemaVersion: 1,
      phase: 'CONFIRMED',
      previewCommandId: request.commandId,
      confirmationCommandIdOrNull: request.commandId,
      ...diceSource,
      instanceIds: [],
      advisorCardIdOrNull: null,
      acquisitions: emptyEnemyCompositionAcquisitions(),
      rolls: [],
      skills: { advisorSkills: [], dolphinSkills: [] },
      symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
      ordinarySymbiontInstances: [],
      symbioticMonsterProfileIdOrNull: null,
      monsterOrNull: null,
    });
  }
  const patch = enemyCompositionPatchValue(request.payload.data);
  const ledger = attempt.compositionAcquisitions ?? emptyEnemyCompositionAcquisitions();
  if (patch.operation === 'PREVIEW') {
    if (issued.rolls.length !== 0) return s.fail('INVALID_INPUT');
    const adviserIndex = patch.selection.ordinarySymbiontInstances.findIndex(
      (row) => row.speciesKey === 'ADVISER',
    );
    if (
      adviserIndex < 0 &&
      ledger.activeAdvisorCardIdOrNull !== null &&
      !patch.advisorRemovalConfirmed
    )
      return s.fail('INVALID_INPUT');
    const advisorCardIdOrNull = adviserIndex < 0 ? null : (ledger.advisorCards[0]?.cardId ?? null);
    if (issued.advisorCardIdOrNull !== advisorCardIdOrNull) return s.fail('INVALID_INPUT');
    const acquisitions = { ...ledger, activeAdvisorCardIdOrNull: advisorCardIdOrNull };
    const card = acquisitions.advisorCards.find((row) => row.cardId === advisorCardIdOrNull);
    if (card !== undefined && issued.instanceIds[adviserIndex] !== card.symbiontInstanceId)
      return s.fail('SOURCE_CHANGED');
    const ownKnown = attempt.skillPlanState.advisorKnowledge.find(
      (row) => row.cardId === advisorCardIdOrNull,
    );
    const value = enemyComposedCompositionValue({
      ...patch.selection,
      schemaVersion: 1,
      phase: 'PREVIEW',
      previewCommandId: request.commandId,
      confirmationCommandIdOrNull: null,
      ...diceSource,
      instanceIds: issued.instanceIds,
      advisorCardIdOrNull,
      acquisitions,
      rolls: [...sentientAcquisitionRolls({ acquisitions, advisorCardIdOrNull }).values()],
      skills: {
        advisorSkills:
          ownKnown?.knownSkills.map((skill) => ({
            skillKey: skill.skillKey,
            targetBonus: skill.bonus,
          })) ?? [],
        dolphinSkills: [],
      },
    });
    deriveSentientCompositionStructure(catalog.composition, basis.build.raceCode, value);
    return value;
  }
  const previous = attempt.compositionOrNull;
  if (
    previous === null ||
    !('schemaVersion' in previous) ||
    previous.previewCommandId !== patch.previewCommandId
  )
    return s.fail('STALE_REVISION');
  if (patch.operation === 'CONFIRM') {
    if (previous.phase !== 'PREVIEW' || !s.same(issued.instanceIds, previous.instanceIds))
      return s.fail('INVALID_INPUT');
    const required = sentientCompositionRollRequirements(
      catalog.composition,
      basis.build.raceCode,
      previous,
    ).filter((row) => !sentientAcquisitionRolls(previous).has(row.kind));
    if (
      (diceSource.diceModeSnapshot === 'AUTO' && patch.manualFacesOrNull !== null) ||
      (diceSource.diceModeSnapshot === 'MANUAL' &&
        (patch.manualFacesOrNull === null
          ? required.length !== 0
          : patch.manualFacesOrNull.length !== required.length))
    )
      return s.fail('INVALID_INPUT');
    if (issued.rolls.length !== required.length) return s.fail('INVALID_INPUT');
    issued.rolls.forEach((roll, index) => {
      if (
        patch.manualFacesOrNull !== null &&
        roll.mechanical.rawFace !== patch.manualFacesOrNull[index]
      )
        return s.fail('INVALID_INPUT');
      const requirement = required[index] ?? s.fail('INVALID_INPUT'),
        root = 'ENEMY_COMPOSITION/' + request.commandId + '/' + requirement.kind;
      if (
        roll.factId !== root + '/FACT' ||
        roll.rollRequestId !== root + '/REQUEST' ||
        roll.rollReceiptId !== root + '/RECEIPT' ||
        roll.originatingCommandId !== request.commandId ||
        roll.modeSnapshot !== diceSource.diceModeSnapshot ||
        roll.mechanical.dieSides !== requirement.dieSides
      )
        return s.fail('INVALID_INPUT');
    });
    const byKind = new Map(
      required.map((row, index) => [row.kind, issued.rolls[index] ?? s.fail('INVALID_INPUT')]),
    );
    let acquisitions = structuredClone(ledger);
    const before = deriveSentientComposition(
      catalog.composition,
      catalog.skills,
      basis.build,
      basis.skillStageStats,
      previous,
      basis.selected.learnedSkills,
      false,
      false,
      0,
      false,
      attempt.skillPlanState,
    );
    const free = byKind.get('FREE_SLOT');
    if (free !== undefined) {
      if (before.permanentStats.S < 1 || before.permanentStats.M < 1 || before.permanentStats.Z < 1)
        return s.fail('INVALID_INPUT');
      const statsBefore = {
        S: before.permanentStats.S,
        M: before.permanentStats.M,
        Z: before.permanentStats.Z,
      };
      acquisitions = {
        ...acquisitions,
        freeSlotOrNull: {
          roll: free,
          statsBefore,
          permanentStatConsequence: {
            S: Math.max(1, statsBefore.S - free.mechanical.rawFace) - statsBefore.S,
            M: Math.max(1, statsBefore.M - free.mechanical.rawFace) - statsBefore.M,
            Z: Math.max(1, statsBefore.Z - free.mechanical.rawFace) - statsBefore.Z,
          },
        },
      };
    }
    const first = byKind.get('ADVISER_I'),
      second = byKind.get('ADVISER_W');
    if (first !== undefined || second !== undefined) {
      if (
        first === undefined ||
        second === undefined ||
        issued.advisorCardIdOrNull === null ||
        ledger.advisorCards.some((row) => row.cardId === issued.advisorCardIdOrNull)
      )
        return s.fail('INVALID_INPUT');
      const index = previous.ordinarySymbiontInstances.findIndex(
        (row) => row.speciesKey === 'ADVISER',
      );
      const card = {
        cardId: issued.advisorCardIdOrNull,
        symbiontInstanceId: previous.instanceIds[index] ?? s.fail('INVALID_INPUT'),
        iwRolls: [first, second] as const,
        suppressionRollOrNull: byKind.get('ADVISER_SUPPRESSION') ?? null,
        skillsOrNull: null,
      };
      acquisitions = {
        ...acquisitions,
        advisorCards: [...acquisitions.advisorCards, card],
        activeAdvisorCardIdOrNull: card.cardId,
      };
    } else {
      if (issued.advisorCardIdOrNull !== ledger.activeAdvisorCardIdOrNull)
        return s.fail('INVALID_INPUT');
      const suppression = byKind.get('ADVISER_SUPPRESSION');
      if (suppression !== undefined)
        acquisitions = {
          ...acquisitions,
          advisorCards: acquisitions.advisorCards.map((row) =>
            row.cardId === acquisitions.activeAdvisorCardIdOrNull
              ? { ...row, suppressionRollOrNull: suppression }
              : row,
          ),
        };
    }
    let value = enemyComposedCompositionValue({
      ...previous,
      ...diceSource,
      phase: 'ACQUIRED',
      confirmationCommandIdOrNull: request.commandId,
      advisorCardIdOrNull: acquisitions.activeAdvisorCardIdOrNull,
      acquisitions,
      rolls: [
        ...sentientAcquisitionRolls({
          acquisitions,
          advisorCardIdOrNull: acquisitions.activeAdvisorCardIdOrNull,
        }).values(),
      ],
    });
    const structure = deriveSentientCompositionStructure(
      catalog.composition,
      basis.build.raceCode,
      value,
    );
    const grossSource = structure.instances.find(
      (row) => row.speciesKey === 'TROGR' && row.learnedNodeRefs.includes('SYM-079'),
    );
    if (acquisitions.grossGrantOrNull === null && grossSource !== undefined) {
      const plan = attempt.skillPlanState.planOrNull;
      const before =
        (plan.accountingOrNull?.knownSkills ?? plan.initialSkills).find(
          (skill) => skill.skillKey === 'GROSS',
        )?.bonus ?? 0;
      acquisitions = {
        ...acquisitions,
        grossGrantOrNull: {
          sourceCommandId: request.commandId,
          symbiontInstanceId: grossSource.symbiontInstanceId,
          bonusBefore: before,
          bonusAfter: before === 0 ? 3 : before >= 5 ? before : Math.min(5, before + 3),
          lostAtCommandIdOrNull: null,
        },
      };
      value = enemyComposedCompositionValue({ ...value, acquisitions });
    }
    deriveSentientComposition(
      catalog.composition,
      catalog.skills,
      basis.build,
      basis.skillStageStats,
      value,
      basis.selected.learnedSkills,
      false,
      false,
      0,
      false,
      attempt.skillPlanState,
    );
    return value;
  }
  if (
    (previous.phase !== 'ACQUIRED' && previous.phase !== 'CONFIRMED') ||
    !s.same(issued, {
      instanceIds: previous.instanceIds,
      advisorCardIdOrNull: previous.advisorCardIdOrNull,
      rolls: [],
    })
  )
    return s.fail('INVALID_INPUT');
  const acquisitions = {
    ...previous.acquisitions,
    advisorCards: previous.acquisitions.advisorCards.map((card) =>
      card.cardId === previous.advisorCardIdOrNull
        ? { ...card, skillsOrNull: patch.skills.advisorSkills }
        : card,
    ),
  };
  for (const choice of [...patch.skills.advisorSkills, ...patch.skills.dolphinSkills]) {
    const skill =
      catalog.skills.skills.find((skill) => skill.skillKey === choice.skillKey) ??
      s.fail('INVALID_INPUT');
    if (
      skill.category !== 'SELECTABLE_GENERAL' ||
      (skill.maxBonus !== 'NO_RULED_UPPER_LIMIT' && choice.targetBonus > skill.maxBonus)
    )
      return s.fail('INVALID_INPUT');
  }
  const value = enemyComposedCompositionValue({
    ...previous,
    phase: 'CONFIRMED',
    acquisitions,
    skills: patch.skills,
  });
  deriveSentientComposition(
    catalog.composition,
    catalog.skills,
    basis.build,
    basis.skillStageStats,
    value,
    basis.selected.learnedSkills,
    false,
    false,
    0,
    true,
    attempt.skillPlanState,
  );
  return value;
}
/** Called inside the owning guarded atomic preparation; exact replay never invokes it. */
export function issueEnemyCompositionRolls(
  catalog: EnemyAuthoringSourceCatalog,
  attempt: EnemyAttempt,
  request: EnemyWorkflowRequest,
  mode: EnemyCompositionDiceSource['diceModeSnapshot'],
  sample: (sides: 6 | 20) => number,
): readonly EnemyCompositionRoll[] {
  const patch = enemyCompositionPatchValue(request.payload.data),
    previous = attempt.compositionOrNull;
  if (patch.operation !== 'CONFIRM' || previous === null || !('schemaVersion' in previous))
    return s.fail('INVALID_INPUT');
  if (previous.phase !== 'PREVIEW' || previous.previewCommandId !== patch.previewCommandId)
    return s.fail('STALE_REVISION');
  const required = sentientCompositionRollRequirements(
    catalog.composition,
    attempt.buildOrNull?.raceCode ?? s.fail('UNAVAILABLE'),
    previous,
  ).filter((row) => !sentientAcquisitionRolls(previous).has(row.kind));
  if (
    (mode === 'AUTO' && patch.manualFacesOrNull !== null) ||
    (mode === 'MANUAL' &&
      (patch.manualFacesOrNull === null
        ? required.length !== 0
        : patch.manualFacesOrNull.length !== required.length))
  )
    return s.fail('INVALID_INPUT');
  if (required.some((row) => row.kind === 'FREE_SLOT')) {
    const basis = enemyCompositionInitialBasis(catalog, attempt);
    const before = deriveSentientComposition(
      catalog.composition,
      catalog.skills,
      basis.build,
      basis.skillStageStats,
      previous,
      basis.selected.learnedSkills,
      false,
      false,
      0,
      false,
      attempt.skillPlanState,
    ).permanentStats;
    if (before.S < 1 || before.M < 1 || before.Z < 1) return s.fail('INVALID_INPUT');
  }
  return required.map((requirement, index) => {
    const root = 'ENEMY_COMPOSITION/' + request.commandId + '/' + requirement.kind;
    const snapshot = createRollSourceSnapshot({
      dieSides: requirement.dieSides,
      modeSnapshot: mode,
      originatingCommandId: request.commandId,
      rollRequestId: root + '/REQUEST',
    });
    const mechanical =
      mode === 'AUTO'
        ? resolveAutoRoll(
            {
              request: createRollSourceSnapshot({ ...snapshot, modeSnapshot: 'AUTO' }),
              submitCommandId: root + '/RECEIPT',
            },
            null,
            (sides) => (sides === 6 || sides === 20 ? sample(sides) : s.fail('INVALID_INPUT')),
          ).resolution.mechanical
        : (() => {
            const result = resolveManualRoll(
              createRollSourceSnapshot({ ...snapshot, modeSnapshot: 'MANUAL' }),
              patch.manualFacesOrNull?.[index],
            );
            return result.ok ? result.resolution.mechanical : s.fail('INVALID_INPUT');
          })();
    if (mechanical.dieSides !== 6 && mechanical.dieSides !== 20) return s.fail('INVALID_INPUT');
    return {
      factId: root + '/FACT',
      rollRequestId: root + '/REQUEST',
      rollReceiptId: root + '/RECEIPT',
      originatingCommandId: request.commandId,
      modeSnapshot: mode,
      mechanical: { dieSides: mechanical.dieSides, rawFace: mechanical.rawFace },
    };
  });
}
