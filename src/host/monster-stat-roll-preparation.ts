import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';
import {
  enemyMonsterStatRollBinding,
  type EnemyAuthoringContext,
  type EnemyWorkflowRequest,
} from '@shared/enemy-authoring.js';
import {
  MONSTER_STAT_DRAFT_ACTIONS,
  monsterStatDraftPatchValue,
  monsterStatOpeningDraft,
  monsterStatRollCommandPayloadValue,
  type MonsterStatRollOperation,
  type MonsterStatRollState,
} from '@shared/monster-stat-roll.js';
import {
  createMonsterStatRollState,
  issueMonsterStatRoll,
  stageMonsterStatsDraft,
} from '../domain/entities/enemy-template/monster-stat-roll.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';

/** Also used at the actual earlier historical prefix, with recorded faces instead of a sampler. */
export function prepareMonsterStatRollCommand(
  context: EnemyAuthoringContext,
  formId: string,
  request: EnemyWorkflowRequest,
  inputs: {
    readonly operation: () => MonsterStatRollOperation;
    readonly newSeed: () => string;
    readonly sampleNaturalR20: () => number;
  },
): {
  readonly preparedMonsterStatRoll: MonsterStatRollState;
  readonly operation: MonsterStatRollOperation;
} {
  const attempt = context.attemptOrNull;
  if (attempt?.kind !== 'CUSTOM_MONSTER') return s.fail('INVALID_INPUT');
  const binding = enemyMonsterStatRollBinding(context),
    previous = context.monsterStatRoll;
  if (
    request.payload.campaignId !== binding.campaignId ||
    request.payload.creationAttemptId !== binding.attemptId
  )
    return s.fail('FOREIGN_OWNER');
  if (request.payload.expectedAttemptRevision !== attempt.revision) return s.fail('STALE_REVISION');
  if (request.workflowCommandId === 'UI-CMD-MONSTER-STATS-ROLL-ONCE') {
    const echo = monsterStatRollCommandPayloadValue(request.payload);
    if (
      formId !== 'ENM-018' ||
      previous === undefined ||
      !admissionJsonEqual(
        {
          kind: 'CUSTOM_MONSTER',
          attemptId: echo.attemptId,
          campaignId: echo.campaignId,
          originFormId: echo.originFormId,
          versionBindingOrNull: echo.versionBindingOrNull,
        },
        binding,
      )
    )
      return s.fail('INVALID_INPUT');
    if (previous.rollOnceStatus !== 'NOT_ROLLED') return s.fail('INVALID_INPUT');
    const operation = inputs.operation();
    return {
      operation,
      preparedMonsterStatRoll: issueMonsterStatRoll(
        previous,
        binding,
        attempt.revision,
        operation,
        inputs.sampleNaturalR20,
      ),
    };
  }
  if (
    request.workflowCommandId !== 'UI-CMD-ENEMY-DRAFT-PATCH' ||
    request.payload.stage !== 'MONSTER_STAT_DRAFT'
  )
    return s.fail('INVALID_INPUT');
  const patch = monsterStatDraftPatchValue(request.payload.data),
    action = MONSTER_STAT_DRAFT_ACTIONS[patch.sourceActionKey];
  if (
    formId !== binding.originFormId ||
    action[0] !== binding.originFormId ||
    action[2] !== (previous?.rollOnceStatus ?? 'NOT_ROLLED') ||
    context.versionAttempt?.replacementPreviewOrNull != null ||
    (previous?.draftOrNull != null && patch.draftOrNull === null)
  )
    return s.fail('INVALID_INPUT');
  // No body/knowledge reconciliation is performed here: even a low but source-range-valid
  // provisional body may enter the read-only receipt, without losing confirmed knowledge.
  const draft = monsterStatOpeningDraft(patch, attempt.statsOrNull);
  const preparedMonsterStatRoll =
    previous === undefined
      ? createMonsterStatRollState(binding, inputs.newSeed(), draft)
      : draft === null
        ? previous
        : stageMonsterStatsDraft(previous, draft);
  return { preparedMonsterStatRoll, operation: inputs.operation() };
}
