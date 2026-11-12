import type { EnemyWorkflowRequest } from '@shared/enemy-authoring.js';
import type { EnemyCompositionRoll } from '@shared/enemy-composition.js';
import {
  customMonsterCompositionPatchValue,
  preparedCustomMonsterCompositionValue,
  type CustomMonsterAttempt,
  type PreparedCustomMonsterComposition,
  type MonsterAdvisorCard,
  type PreparedMonsterKnowledge,
} from '@shared/custom-monster-state.js';
import type { CustomMonsterStatsInput } from '@shared/custom-monster.js';
import {
  customMonsterCompleteInput,
  deriveCustomMonsterBody,
  customMonsterAdvisorStats,
  customMonsterAdvisorSkills,
  type CustomMonsterFullCatalog,
} from '../domain/entities/enemy-template/custom-monster-authoring.js';
import { validateSkillRequirements } from '../domain/rules/skill-stage/skills.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  createRollSourceSnapshot,
  resolveAutoRoll,
  resolveManualRoll,
} from '../domain/entities/roll-request/roll-model.js';

export interface IssuedMonsterComposition {
  readonly symbiontInstanceIdOrNull: string | null;
  readonly advisorCardIdOrNull: string | null;
  readonly rolls: readonly EnemyCompositionRoll[];
}
export function customMonsterRequiredRolls(
  attempt: CustomMonsterAttempt,
): readonly ('ADVISER_I' | 'ADVISER_W')[] {
  const composition = attempt.compositionOrNull;
  return composition?.selection.mode === 'ORDINARY' &&
    composition.selection.symbiont.speciesKey === 'ADVISER' &&
    attempt.advisorCards.length === 0
    ? ['ADVISER_I', 'ADVISER_W']
    : [];
}
/** A committed permanent input change cannot erase a witnessed loss by restoring it before FINISH. */
export function prepareCustomMonsterKnowledge(
  catalog: CustomMonsterFullCatalog,
  attempt: CustomMonsterAttempt,
  stats: CustomMonsterStatsInput,
  commandId: string,
): PreparedMonsterKnowledge {
  return {
    activeAdvisorCardIdOrNull: attempt.activeAdvisorCardIdOrNull,
    advisorCards: attempt.advisorCards.map((card) => {
      if (card.cardId !== attempt.activeAdvisorCardIdOrNull || card.initialSkillsOrNull === null)
        return card;
      const body = deriveCustomMonsterBody(
        catalog,
        {
          identity: attempt.identityOrNull ?? s.fail('UNAVAILABLE'),
          stats,
          physics: attempt.physicsOrNull ?? s.fail('UNAVAILABLE'),
          attack: attempt.attackOrNull ?? s.fail('UNAVAILABLE'),
          symbiont: { mode: 'ORDINARY', symbiont: card.confirmedChoice },
        },
        card.symbiontInstanceId,
      );
      const ownStats = customMonsterAdvisorStats(catalog, body, card);
      const knownSkills = card.knownSkills.filter((choice) => {
        const skill =
          catalog.skills.skills.find((row) => row.skillKey === choice.skillKey) ??
          s.fail('SOURCE_CHANGED');
        const unmet = catalog.skills.requirements.some(
          (row) => row.skillKey === skill.skillKey && ownStats[row.statCode] < row.minValue,
        );
        if (!unmet) validateSkillRequirements(catalog.skills, skill.skillKey, ownStats);
        return !unmet;
      });
      return {
        ...card,
        knownSkills,
        permanentLosses: [
          ...card.permanentLosses,
          ...card.knownSkills
            .filter((row) => !knownSkills.some((kept) => kept.skillKey === row.skillKey))
            .map((row) => ({ skillKey: row.skillKey, commandId })),
        ],
      };
    }),
  };
}
/** Used identically for fresh preparation and every immutable historical prefix; never samples. */
export function prepareCustomMonsterComposition(
  catalog: CustomMonsterFullCatalog,
  attempt: CustomMonsterAttempt,
  request: EnemyWorkflowRequest,
  mode: 'AUTO' | 'MANUAL',
  issued: IssuedMonsterComposition,
): PreparedCustomMonsterComposition {
  if (request.payload.stage !== 'MONSTER_SYMBIONT') return s.fail('INVALID_INPUT');
  const patch = customMonsterCompositionPatchValue(request.payload.data),
    prior = attempt.compositionOrNull;
  if (patch.operation === 'PREVIEW') {
    if (issued.rolls.length !== 0) return s.fail('INVALID_INPUT');
    const adviser =
      patch.selection.mode === 'ORDINARY' && patch.selection.symbiont.speciesKey === 'ADVISER';
    const existing = adviser ? attempt.advisorCards[0] : undefined;
    if (
      issued.advisorCardIdOrNull !== (existing?.cardId ?? null) ||
      (existing !== undefined && issued.symbiontInstanceIdOrNull !== existing.symbiontInstanceId)
    )
      return s.fail('SOURCE_CHANGED');
    const composition = {
      selection: patch.selection,
      phase: 'PREVIEW' as const,
      previewCommandId: request.commandId,
      confirmationCommandIdOrNull: null,
      symbiontInstanceIdOrNull: issued.symbiontInstanceIdOrNull,
      advisorCardIdOrNull: issued.advisorCardIdOrNull,
    };
    deriveCustomMonsterBody(
      catalog,
      {
        ...customMonsterCompleteInput({ ...attempt, compositionOrNull: composition }),
        symbiont: patch.selection,
      },
      issued.symbiontInstanceIdOrNull,
    );
    return preparedCustomMonsterCompositionValue({
      composition,
      advisorCards: attempt.advisorCards,
      activeAdvisorCardIdOrNull: attempt.activeAdvisorCardIdOrNull,
    });
  }
  if (
    prior === null ||
    prior.previewCommandId !== patch.previewCommandId ||
    issued.symbiontInstanceIdOrNull !== prior.symbiontInstanceIdOrNull
  )
    return s.fail('STALE_REVISION');
  const body = deriveCustomMonsterBody(
    catalog,
    customMonsterCompleteInput(attempt),
    prior.symbiontInstanceIdOrNull,
  );
  if (patch.operation === 'CONFIRM') {
    if (prior.phase !== 'PREVIEW') return s.fail('INVALID_INPUT');
    const required = customMonsterRequiredRolls(attempt);
    if (
      (mode === 'AUTO' && patch.manualFacesOrNull !== null) ||
      (mode === 'MANUAL' &&
        (patch.manualFacesOrNull === null
          ? required.length !== 0
          : patch.manualFacesOrNull.length !== required.length)) ||
      issued.rolls.length !== required.length
    )
      return s.fail('INVALID_INPUT');
    for (const [index, kind] of required.entries()) {
      const roll = issued.rolls[index] ?? s.fail('INVALID_INPUT'),
        root = 'CUSTOM_MONSTER_COMPOSITION/' + request.commandId + '/' + kind;
      if (
        roll.factId !== root + '/FACT' ||
        roll.rollRequestId !== root + '/REQUEST' ||
        roll.rollReceiptId !== root + '/RECEIPT' ||
        roll.originatingCommandId !== request.commandId ||
        roll.modeSnapshot !== mode ||
        roll.mechanical.dieSides !== 20 ||
        (patch.manualFacesOrNull !== null &&
          roll.mechanical.rawFace !== patch.manualFacesOrNull[index])
      )
        return s.fail('SOURCE_CHANGED');
    }
    let cards = attempt.advisorCards;
    if (required.length !== 0) {
      if (issued.advisorCardIdOrNull === null || prior.symbiontInstanceIdOrNull === null)
        return s.fail('INVALID_INPUT');
      const first = issued.rolls[0] ?? s.fail('INVALID_INPUT'),
        second = issued.rolls[1] ?? s.fail('INVALID_INPUT');
      if (prior.selection.mode !== 'ORDINARY') return s.fail('SOURCE_CHANGED');
      cards = [
        {
          cardId: issued.advisorCardIdOrNull,
          symbiontInstanceId: prior.symbiontInstanceIdOrNull,
          iwRolls: [first, second],
          confirmedChoice: prior.selection.symbiont,
          initialSkillsOrNull: null,
          knownSkills: [],
          permanentLosses: [],
        },
      ];
    } else if (issued.advisorCardIdOrNull !== prior.advisorCardIdOrNull)
      return s.fail('SOURCE_CHANGED');
    if (issued.advisorCardIdOrNull !== null) {
      if (prior.selection.mode !== 'ORDINARY') return s.fail('SOURCE_CHANGED');
      const choice = prior.selection.symbiont;
      cards = cards.map((card) =>
        card.cardId === issued.advisorCardIdOrNull ? { ...card, confirmedChoice: choice } : card,
      );
    }
    const knowledge = prepareCustomMonsterKnowledge(
      catalog,
      { ...attempt, advisorCards: cards, activeAdvisorCardIdOrNull: issued.advisorCardIdOrNull },
      attempt.statsOrNull ?? s.fail('UNAVAILABLE'),
      request.commandId,
    );
    return preparedCustomMonsterCompositionValue({
      composition: {
        ...prior,
        phase: 'ACQUIRED',
        confirmationCommandIdOrNull: request.commandId,
        advisorCardIdOrNull: issued.advisorCardIdOrNull,
      },
      ...knowledge,
    });
  }
  if (
    prior.phase === 'PREVIEW' ||
    issued.rolls.length !== 0 ||
    issued.advisorCardIdOrNull !== prior.advisorCardIdOrNull
  )
    return s.fail('INVALID_INPUT');
  let cards = attempt.advisorCards;
  if (prior.advisorCardIdOrNull === null) {
    if (patch.advisorSkills.length !== 0) return s.fail('INVALID_INPUT');
  } else {
    const card =
      cards.find((row) => row.cardId === prior.advisorCardIdOrNull) ?? s.fail('SOURCE_CHANGED');
    const stats = customMonsterAdvisorStats(catalog, body, card);
    let updated: MonsterAdvisorCard;
    if (card.initialSkillsOrNull === null) {
      customMonsterAdvisorSkills(catalog, stats, patch.advisorSkills, true);
      updated = {
        ...card,
        initialSkillsOrNull: patch.advisorSkills,
        knownSkills: patch.advisorSkills,
      };
    } else {
      if (!s.same(patch.advisorSkills, card.knownSkills)) return s.fail('INVALID_INPUT');
      updated = card;
      customMonsterAdvisorSkills(catalog, stats, updated.knownSkills, false);
    }
    cards = cards.map((row) => (row.cardId === updated.cardId ? updated : row));
  }
  return preparedCustomMonsterCompositionValue({
    composition: { ...prior, phase: 'CONFIRMED' },
    advisorCards: cards,
    activeAdvisorCardIdOrNull: attempt.activeAdvisorCardIdOrNull,
  });
}
/** The existing guarded command transaction is the only caller allowed to allocate acquisition RNG. */
export function issueCustomMonsterRolls(
  attempt: CustomMonsterAttempt,
  request: EnemyWorkflowRequest,
  mode: 'AUTO' | 'MANUAL',
  sample: (sides: 20) => number,
): readonly EnemyCompositionRoll[] {
  const patch = customMonsterCompositionPatchValue(request.payload.data);
  const prior = attempt.compositionOrNull;
  if (
    patch.operation !== 'CONFIRM' ||
    prior?.phase !== 'PREVIEW' ||
    prior.previewCommandId !== patch.previewCommandId
  )
    return s.fail('STALE_REVISION');
  const required = customMonsterRequiredRolls(attempt);
  if (
    (mode === 'AUTO' && patch.manualFacesOrNull !== null) ||
    (mode === 'MANUAL' &&
      (patch.manualFacesOrNull === null
        ? required.length !== 0
        : patch.manualFacesOrNull.length !== required.length))
  )
    return s.fail('INVALID_INPUT');
  return required.map((kind, index) => {
    const root = 'CUSTOM_MONSTER_COMPOSITION/' + request.commandId + '/' + kind;
    const snapshot = createRollSourceSnapshot({
      dieSides: 20,
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
            (sides) => (sides === 20 ? sample(sides) : s.fail('INVALID_INPUT')),
          ).resolution.mechanical
        : (() => {
            const result = resolveManualRoll(
              createRollSourceSnapshot({ ...snapshot, modeSnapshot: 'MANUAL' }),
              patch.manualFacesOrNull?.[index],
            );
            return result.ok ? result.resolution.mechanical : s.fail('INVALID_INPUT');
          })();
    if (mechanical.dieSides !== 20) return s.fail('INVALID_INPUT');
    return {
      factId: root + '/FACT',
      rollRequestId: root + '/REQUEST',
      rollReceiptId: root + '/RECEIPT',
      originatingCommandId: request.commandId,
      modeSnapshot: mode,
      mechanical: { dieSides: 20, rawFace: mechanical.rawFace },
    };
  });
}
