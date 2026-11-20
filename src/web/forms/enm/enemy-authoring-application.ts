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
import { enemyArtPatchValue } from '@shared/enemy-art.js';
import {
  MONSTER_STAT_DRAFT_ACTIONS,
  monsterStatDraftPatchValue,
  monsterStatRollReceiptValue,
} from '@shared/monster-stat-roll.js';

/** ART edits the current attempt in place under the form's existing PATCH capability. */
export function enemyArtPatchAction(formId: string) {
  if (formId === 'ENM-005') return 'ENM-005::CTA::003';
  if (formId === 'ENM-011') return 'ENM-011::CTA::002';
  if (formId === 'ENM-017') return 'ENM-017::CTA::004';
  return null;
}

export function enemyArtDeliveryMatches(projection: JsonObject, request: EnemyWorkflowRequest) {
  const p = enemyAuthoringProjectionValue(projection);
  const ref = p.context.attemptOrNull?.artOverride;
  const patch = enemyArtPatchValue(request.payload.data);
  if (patch.operation === 'CLEAR') return ref?.uploadCommandIdOrNull === null;
  return (
    ref?.uploadCommandIdOrNull === request.commandId &&
    p.art.mediaType === patch.file.mediaType &&
    p.art.bytesBase64 === patch.file.bytesBase64
  );
}

export function enemyBrowserWorkflow(
  p: EnemyAuthoringProjection,
  actionKey: string,
  commandId: string,
  data: JsonObject | null,
  versionStage?: EnemyPatchStage,
): EnemyWorkflowRequest | null {
  const statDraft = Object.hasOwn(MONSTER_STAT_DRAFT_ACTIONS, actionKey);
  const roll =
    p.formId === 'ENM-018' &&
    p.kind === 'CUSTOM_MONSTER_AUTHORING' &&
    actionKey ===
      (p.statGeneration?.originFormId === 'ENM-012' ? 'ENM-018::CTA::002' : 'ENM-018::CTA::005');
  if (statDraft) {
    const patch = monsterStatDraftPatchValue(data);
    if (
      p.kind !== 'CUSTOM_MONSTER_AUTHORING' ||
      patch.sourceActionKey !== actionKey ||
      MONSTER_STAT_DRAFT_ACTIONS[patch.sourceActionKey][0] !== p.formId ||
      (versionStage !== undefined && versionStage !== 'MONSTER_STAT_DRAFT')
    )
      throw new Error('Черновик не принадлежит текущему переходу характеристик.');
  }
  if (versionStage === 'ART' && actionKey !== enemyArtPatchAction(p.formId))
    throw new Error('Портрет нельзя изменить на этой форме.');
  if (
    versionStage !== undefined &&
    versionStage !== 'ART' &&
    !statDraft &&
    (p.formId !== 'ENM-017' ||
      p.versionEditor === undefined ||
      (versionStage !== 'VERSION_CONFIGURATION' &&
        versionStage.startsWith('MONSTER_') !==
          (p.context.attemptOrNull?.kind === 'CUSTOM_MONSTER')))
  )
    throw new Error('Этап не принадлежит этой новой версии.');
  const stage =
    (statDraft ? 'MONSTER_STAT_DRAFT' : versionStage) ??
    (
      Object.entries(ENEMY_STAGE_FORMS) as [keyof typeof ENEMY_STAGE_FORMS, readonly string[]][]
    ).find(([, forms]) => forms[0] === p.formId && forms[2] === actionKey)?.[0];
  const append =
    p.formId === 'ENM-017' && actionKey === 'ENM-017::CTA::004' && versionStage === undefined;
  const commit =
    append ||
    (p.formId === 'ENM-010' && actionKey === 'ENM-010::CTA::004') ||
    (p.formId === 'ENM-016' && actionKey === 'ENM-016::CTA::002');
  if (stage === undefined && !commit && !roll) return null;
  const attempt = p.context.attemptOrNull;
  if (attempt === null) throw new Error('Попытка отсутствует.');
  return enemyWorkflowRequestValue({
    messageType: 'command.request',
    protocolVersion: 1,
    commandKind: 'workflow-command',
    role: 'gm',
    commandId,
    workflowCommandId: roll
      ? 'UI-CMD-MONSTER-STATS-ROLL-ONCE'
      : append
        ? 'UI-CMD-ENEMY-NEW-VERSION'
        : commit
          ? 'UI-CMD-ENEMY-COMMIT-V1'
          : 'UI-CMD-ENEMY-DRAFT-PATCH',
    expectedRevisions: {
      stateRevision: p.stateRevision,
      projectionRevision: p.projectionRevision,
      actorVisibilityRevision: p.actorVisibilityRevision,
    },
    payload: {
      campaignId: p.campaignId,
      creationAttemptId: attempt.attemptId,
      expectedAttemptRevision: attempt.revision,
      ...(roll
        ? (() => {
            const binding =
              p.kind === 'CUSTOM_MONSTER_AUTHORING' ? p.statGeneration?.binding : undefined;
            if (binding === undefined || p.context.monsterStatRoll?.rollOnceStatus !== 'NOT_ROLLED')
              throw new Error('Однократная генерация недоступна.');
            return {
              attemptId: binding.attemptId,
              monsterDraftId: binding.attemptId,
              originFormId: binding.originFormId,
              returnFormId: binding.originFormId,
              versionBindingOrNull: binding.versionBindingOrNull,
            };
          })()
        : append
          ? { reason: data?.['reason'] }
          : commit
            ? {}
            : { stage, data: data ?? {} }),
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
        : '') +
      (request.workflowCommandId === 'UI-CMD-MONSTER-STATS-ROLL-ONCE' ? ' randomStatsReceipt' : ''),
    '$.result',
  );
  const commit =
    request.workflowCommandId === 'UI-CMD-ENEMY-COMMIT-V1' ||
    request.workflowCommandId === 'UI-CMD-ENEMY-NEW-VERSION';
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
  if (request.workflowCommandId === 'UI-CMD-MONSTER-STATS-ROLL-ONCE') {
    const original = monsterStatRollReceiptValue(result['randomStatsReceipt']);
    if (
      source.kind !== 'CUSTOM_MONSTER_AUTHORING' ||
      source.formId !== 'ENM-018' ||
      !admissionJsonEqual(original.binding, source.statGeneration?.binding) ||
      original.generationSeed !== source.statGeneration?.generationSeed ||
      original.operationId !== request.commandId ||
      original.randomReceiptId !== receipt['receiptId'] ||
      original.attemptRevision !== request.payload.expectedAttemptRevision ||
      original.timestamp !== timestamp ||
      original.artSha256 !== source.art.sha256 ||
      !admissionJsonEqual(original.beforeDraftOrNull, source.context.monsterStatRoll?.draftOrNull)
    )
      throw new Error('Квитанция семи бросков не связана с исходной попыткой.');
  }
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
    if (
      request.workflowCommandId === 'UI-CMD-ENEMY-NEW-VERSION' &&
      (source.context.versionAttempt === undefined ||
        version.templateId !== source.context.versionAttempt.origin.base.templateId ||
        version.version !== source.context.versionAttempt.origin.base.version + 1)
    )
      throw new Error('Новая версия не продолжает подтверждённую основу.');
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
    if (result['workflowCommandId'] === 'UI-CMD-MONSTER-STATS-ROLL-ONCE') {
      const original = monsterStatRollReceiptValue(result['randomStatsReceipt']);
      return (
        p.kind === 'CUSTOM_MONSTER_AUTHORING' &&
        p.formId === original.binding.originFormId &&
        p.context.attemptOrNull?.attemptId === original.binding.attemptId &&
        p.context.attemptOrNull.revision === result['attemptRevision'] &&
        admissionJsonEqual(p.context.monsterStatRoll?.randomReceiptOrNull, original) &&
        admissionJsonEqual(p.statGeneration?.candidateStats, {
          massKg: original.beforeDraftOrNull?.massKg ?? null,
          ageYears: original.beforeDraftOrNull?.ageYears ?? null,
          baseMaxHP: original.beforeDraftOrNull?.baseMaxHP ?? null,
          baseStats: original.originalGeneratedStats,
        })
      );
    }
    if (stage === 'MONSTER_STAT_DRAFT')
      return (
        p.kind === 'CUSTOM_MONSTER_AUTHORING' &&
        source.kind === 'CUSTOM_MONSTER_AUTHORING' &&
        p.formId ===
          (source.statGeneration?.rollOnceStatus === 'COMMITTED' ? 'ENM-019' : 'ENM-018') &&
        p.statGeneration?.originFormId === source.formId &&
        p.context.attemptOrNull !== null &&
        p.context.attemptOrNull.attemptId === result['creationAttemptId'] &&
        p.context.attemptOrNull.revision === result['attemptRevision']
      );
    return (
      p.formId ===
        (source.formId === 'ENM-017' || stage === 'ART'
          ? source.formId
          : stage === 'SENTIENT_BUILD' &&
              (result['buildPhase'] === 'PREVIEW_REBUILD' ||
                result['buildPhase'] === 'REBUILD_DISCARDED')
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
