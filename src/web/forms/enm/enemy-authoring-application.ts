import type { JsonObject, CommandReceipt, RevisionVector } from '@shared/wire-protocol.js';
import {
  admissionCodecReaders as r,
  admissionJsonEqual,
} from '@shared/campaign-admission-codec.js';
import {
  ENEMY_STAGE_FORMS,
  enemyAuthoringProjectionValue,
  enemyVersionIdentityValue,
  enemyWorkflowRequestValue,
  type EnemyAuthoringProjection,
  type EnemyPatchStage,
  type EnemyWorkflowRequest,
} from '@shared/enemy-authoring.js';
import { enemyCompositionPatchValue } from '@shared/enemy-composition.js';
import { enemyBuildPlanPatchValue } from '@shared/enemy-skill-plan.js';
import { customMonsterCompositionPatchValue } from '@shared/custom-monster-state.js';

export function enemyBrowserWorkflow(
  p: EnemyAuthoringProjection,
  actionKey: string,
  commandId: string,
  data: JsonObject | null,
): EnemyWorkflowRequest | null {
  const stage = (Object.entries(ENEMY_STAGE_FORMS) as [EnemyPatchStage, readonly string[]][]).find(
    ([, forms]) => forms[0] === p.formId && forms[2] === actionKey,
  )?.[0];
  const commit =
    (p.formId === 'ENM-010' && actionKey === 'ENM-010::CTA::004') ||
    (p.formId === 'ENM-016' && actionKey === 'ENM-016::CTA::002');
  if (stage === undefined && !commit) return null;
  const attempt = p.context.attemptOrNull;
  if (attempt === null) throw new Error('Попытка отсутствует.');
  return enemyWorkflowRequestValue({
    messageType: 'command.request',
    protocolVersion: 1,
    commandKind: 'workflow-command',
    role: 'gm',
    commandId,
    workflowCommandId: commit ? 'UI-CMD-ENEMY-COMMIT-V1' : 'UI-CMD-ENEMY-DRAFT-PATCH',
    expectedRevisions: {
      stateRevision: p.stateRevision,
      projectionRevision: p.projectionRevision,
      actorVisibilityRevision: p.actorVisibilityRevision,
    },
    payload: {
      campaignId: p.campaignId,
      creationAttemptId: attempt.attemptId,
      expectedAttemptRevision: attempt.revision,
      ...(commit ? {} : { stage, data: data ?? {} }),
    },
  });
}
export function enemyBrowserReceipt(
  value: CommandReceipt,
  request: EnemyWorkflowRequest,
  source: EnemyAuthoringProjection,
): CommandReceipt {
  const receipt = r.exact(value, 'commandId receiptId result revisions', '$.receipt');
  r.uuid(receipt['receiptId'], '$.receiptId');
  if (receipt['commandId'] !== request.commandId) throw new Error('Чужая квитанция.');
  const result = r.exact(
    receipt['result'],
    'campaignId creationAttemptId timestamp workflowCommandId sourceFormId stageOrNull attemptRevision committedVersionOrNull' +
      (request.payload.stage === 'SENTIENT_SYMBIONTS' &&
      (source.context.attemptOrNull?.schemaVersion === 2 ||
        Object.hasOwn(request.payload.data ?? {}, 'operation'))
        ? ' compositionPhase'
        : request.payload.stage === 'MONSTER_SYMBIONT'
          ? ' compositionPhase'
          : '') +
      (request.payload.stage === 'SENTIENT_BUILD' &&
      Object.hasOwn(request.payload.data ?? {}, 'operation')
        ? ' buildPhase'
        : ''),
    '$.result',
  );
  const commit = request.workflowCommandId === 'UI-CMD-ENEMY-COMMIT-V1';
  if (Object.hasOwn(result, 'compositionPhase')) {
    const patch =
      request.payload.stage === 'MONSTER_SYMBIONT'
        ? customMonsterCompositionPatchValue(request.payload.data)
        : Object.hasOwn(request.payload.data ?? {}, 'operation')
          ? enemyCompositionPatchValue(request.payload.data)
          : null;
    if (
      result['compositionPhase'] !==
      (patch === null
        ? 'CONFIRMED'
        : ({ PREVIEW: 'PREVIEW', CONFIRM: 'ACQUIRED', FINISH: 'CONFIRMED' } as const)[
            patch.operation
          ])
    )
      throw new Error('Квитанция не связана с подготовкой состава.');
  }
  if (Object.hasOwn(result, 'buildPhase')) {
    const patch = enemyBuildPlanPatchValue(request.payload.data);
    if (
      result['buildPhase'] !==
      (patch.operation === 'PREVIEW_REBUILD'
        ? 'PREVIEW_REBUILD'
        : patch.operation === 'DISCARD_REBUILD'
          ? 'REBUILD_DISCARDED'
          : 'SAVED')
    )
      throw new Error('Квитанция не связана с планом навыков.');
  }
  if (
    result['campaignId'] !== source.campaignId ||
    result['campaignId'] !== request.payload.campaignId ||
    result['creationAttemptId'] !== request.payload.creationAttemptId ||
    result['workflowCommandId'] !== request.workflowCommandId ||
    result['sourceFormId'] !== source.formId ||
    result['stageOrNull'] !== (request.payload.stage ?? null) ||
    result['attemptRevision'] !== request.payload.expectedAttemptRevision + (commit ? 0 : 1)
  )
    throw new Error('Квитанция не связана с попыткой.');
  const timestamp = r.text(result['timestamp'], '$.timestamp');
  if (new Date(timestamp).toISOString() !== timestamp)
    throw new Error('Некорректная дата квитанции.');
  const revisions = r.exact(
    receipt['revisions'],
    'stateRevision projectionRevision actorVisibilityRevision',
    '$.revisions',
  );
  for (const key of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const)
    if (
      revisions[key] !==
      request.expectedRevisions[key] + (key === 'actorVisibilityRevision' ? 0 : 1)
    )
      throw new Error('Некорректная ревизия квитанции.');
  if (commit) {
    const version = enemyVersionIdentityValue(result['committedVersionOrNull']);
    if (
      version.campaignId !== source.campaignId ||
      version.artSha256 !== source.art.sha256 ||
      version.kind !== source.context.attemptOrNull?.kind
    )
      throw new Error('Чужая версия или арт.');
  } else if (result['committedVersionOrNull'] !== null) throw new Error('PATCH не создаёт шаблон.');
  return value;
}
export function enemyBrowserDestination(
  candidate: {
    readonly formId: string;
    readonly projection: JsonObject;
    readonly revisions: RevisionVector;
  },
  source: EnemyAuthoringProjection,
  receipt: CommandReceipt,
): boolean {
  if (
    candidate.projection['campaignId'] !== source.campaignId ||
    candidate.projection['contextId'] !== source.contextId
  )
    return false;
  if (
    (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).some(
      (key) => candidate.revisions[key] < receipt.revisions[key],
    )
  )
    return false;
  if (!admissionJsonEqual(candidate.revisions, receipt.revisions)) return true;
  try {
    const p = enemyAuthoringProjectionValue(candidate.projection),
      result = receipt.result;
    if (result['committedVersionOrNull'] !== null)
      return (
        p.formId === 'ENM-020' &&
        admissionJsonEqual(p.context.selectedVersionOrNull, result['committedVersionOrNull'])
      );
    const stage = result['stageOrNull'] as EnemyPatchStage;
    return (
      p.formId ===
        (stage === 'SENTIENT_BUILD' &&
        (result['buildPhase'] === 'PREVIEW_REBUILD' || result['buildPhase'] === 'REBUILD_DISCARDED')
          ? 'ENM-007'
          : stage === 'MONSTER_SYMBIONT' && result['compositionPhase'] !== 'CONFIRMED'
            ? 'ENM-015'
            : stage === 'SENTIENT_SYMBIONTS' &&
                Object.hasOwn(result, 'compositionPhase') &&
                result['compositionPhase'] !== 'CONFIRMED'
              ? 'ENM-008'
              : ENEMY_STAGE_FORMS[stage][1]) &&
      p.context.attemptOrNull?.attemptId === result['creationAttemptId'] &&
      p.context.attemptOrNull?.revision === result['attemptRevision']
    );
  } catch {
    return false;
  }
}
