import { randomInt, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { JsonObject, RevisionVector } from '@shared/wire-protocol.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import type {
  EnemyAuthoringMutation,
  EnemyWorkflowRequest,
  EnemyAuthoringContext,
} from '@shared/enemy-authoring.js';
import { enemyAuthoringActions } from '@shared/enemy-authoring.js';
import { CUSTOM_MONSTER_PLACEHOLDER, customMonsterStatsValue } from '@shared/custom-monster.js';
import {
  CUSTOM_MONSTER_STAGE_FORMS,
  customMonsterCompositionPatchValue,
  type CustomMonsterAttempt,
} from '@shared/custom-monster-state.js';
import type { CustomMonsterProjection } from '@shared/custom-monster-presentation.js';
import {
  deriveCustomMonsterSheet,
  customMonsterIdentityDomainValue,
  customMonsterAdvisorStats,
  deriveCustomMonsterBody,
  customMonsterCompleteInput,
} from '../domain/entities/enemy-template/custom-monster-authoring.js';
import {
  customMonsterRequiredRolls,
  prepareCustomMonsterComposition,
  issueCustomMonsterRolls,
  prepareCustomMonsterKnowledge,
} from './custom-monster-preparation.js';
import type { EnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';
import type { EnemyStoredVersion } from '../persistence/enemy-authoring-store.js';
import { readEnemyCompositionDiceSource } from '../persistence/enemy-authoring-store.js';
import type { GmRequestReviewSource } from '../persistence/network-device-request.js';
import type { StoredGmRequestQueueEvent } from '../persistence/campaign-creation.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';

export function prepareCustomMonsterCommand(
  db: Database.Database,
  catalog: EnemyAuthoringSourceCatalog,
  source: GmRequestReviewSource,
  attempt: CustomMonsterAttempt,
  request: EnemyWorkflowRequest,
  sourceBaselineVersion: string,
  events: readonly StoredGmRequestQueueEvent[],
): { mutation: EnemyAuthoringMutation; versionOrNull: EnemyStoredVersion | null } {
  const commit = request.workflowCommandId === 'UI-CMD-ENEMY-COMMIT-V1';
  const form = source.viewOrNull?.formId;
  if (
    commit
      ? form !== 'ENM-016'
      : !Object.hasOwn(CUSTOM_MONSTER_STAGE_FORMS, request.payload.stage ?? '')
  )
    return s.fail('INVALID_INPUT');
  if (
    !commit &&
    Object.entries(CUSTOM_MONSTER_STAGE_FORMS).find(
      ([stage]) => stage === request.payload.stage,
    )?.[1][0] !== form
  )
    return s.fail('INVALID_INPUT');
  if (request.payload.stage === 'MONSTER_IDENTITY')
    customMonsterIdentityDomainValue(request.payload.data);
  const timestamp = new Date().toISOString();
  let preparedMonsterComposition: EnemyAuthoringMutation['preparedMonsterComposition'];
  if (request.payload.stage === 'MONSTER_SYMBIONT') {
    const patch = customMonsterCompositionPatchValue(request.payload.data),
      previous = attempt.compositionOrNull;
    const card = attempt.advisorCards[0];
    const symbiontInstanceIdOrNull =
      patch.operation === 'PREVIEW'
        ? patch.selection.mode === 'NONE'
          ? null
          : patch.selection.symbiont.speciesKey === 'ADVISER' && card !== undefined
            ? card.symbiontInstanceId
            : randomUUID()
        : (previous?.symbiontInstanceIdOrNull ?? null);
    const adviser =
      patch.operation === 'PREVIEW'
        ? patch.selection.mode === 'ORDINARY' && patch.selection.symbiont.speciesKey === 'ADVISER'
        : previous?.selection.mode === 'ORDINARY' &&
          previous.selection.symbiont.speciesKey === 'ADVISER';
    const advisorCardIdOrNull = adviser
      ? (card?.cardId ?? (patch.operation === 'CONFIRM' ? randomUUID() : null))
      : null;
    const mode = readEnemyCompositionDiceSource(db, source, events).diceModeSnapshot;
    const rolls =
      patch.operation === 'CONFIRM'
        ? issueCustomMonsterRolls(attempt, request, mode, (sides) => randomInt(1, sides + 1))
        : [];
    preparedMonsterComposition = prepareCustomMonsterComposition(
      catalog.monster,
      attempt,
      request,
      mode,
      { symbiontInstanceIdOrNull, advisorCardIdOrNull, rolls },
    );
  }
  const identity = commit
    ? {
        campaignId: source.scope.campaignId,
        templateId: randomUUID(),
        versionId: randomUUID(),
        version: 1 as const,
        kind: 'CUSTOM_MONSTER' as const,
        artAssetKey: CUSTOM_MONSTER_PLACEHOLDER,
        artSha256: catalog.monsterArt.sha256,
      }
    : null;
  const mutation: EnemyAuthoringMutation = {
    authorMasterProfileId: source.context.masterProfileId,
    sourceBaselineVersion,
    request,
    itemTemplateKeys: [],
    committedVersionOrNull: identity,
    receiptId: randomUUID(),
    timestamp,
    ...(preparedMonsterComposition === undefined ? {} : { preparedMonsterComposition }),
    ...(request.payload.stage !== 'MONSTER_STATS'
      ? {}
      : {
          preparedMonsterKnowledge: prepareCustomMonsterKnowledge(
            catalog.monster,
            attempt,
            customMonsterStatsValue(request.payload.data),
            request.commandId,
          ),
        }),
  };
  return {
    mutation,
    versionOrNull:
      identity === null
        ? null
        : {
            actorId: source.context.masterProfileId,
            operation: 'CREATE_CUSTOM_MONSTER_TEMPLATE',
            identity,
            attempt,
            sheet: deriveCustomMonsterSheet(catalog.monster, attempt),
            sourceBaselineVersion,
            operationId: request.commandId,
            timestamp,
            historyId: randomUUID(),
          },
  };
}
export function projectCustomMonster(
  catalog: EnemyAuthoringSourceCatalog,
  source: GmRequestReviewSource,
  context: EnemyAuthoringContext,
  version: EnemyStoredVersion | null,
  diceMode: 'AUTO' | 'MANUAL',
): { base: PresentedBaseForm; revisions: RevisionVector } {
  const view = source.viewOrNull ?? s.fail('UNAVAILABLE');
  if (!(
    view.formId === 'ENM-020' ||
    ['ENM-011', 'ENM-012', 'ENM-013', 'ENM-014', 'ENM-015', 'ENM-016'].includes(view.formId)
  ))
    return s.fail('UNAVAILABLE');
  const attempt = context.attemptOrNull;
  if (attempt !== null && attempt.kind !== 'CUSTOM_MONSTER') return s.fail('SOURCE_CHANGED');
  const selectedVersionOrNull = context.selectedVersionOrNull;
  if (selectedVersionOrNull !== null && selectedVersionOrNull.kind !== 'CUSTOM_MONSTER')
    return s.fail('SOURCE_CHANGED');
  const validationErrors: string[] = [];
  let sheetOrNull =
    version?.identity.kind === 'CUSTOM_MONSTER' && version.attempt.kind === 'CUSTOM_MONSTER'
      ? deriveCustomMonsterSheet(catalog.monster, version.attempt)
      : null;
  if (view.formId === 'ENM-016') {
    try {
      sheetOrNull = deriveCustomMonsterSheet(catalog.monster, attempt);
    } catch (error) {
      validationErrors.push(
        error instanceof Error ? error.message : 'Лист монстра не прошёл проверку.',
      );
    }
  }
  const revisions = {
    stateRevision: view.stateRevision,
    projectionRevision: view.projectionRevision,
    actorVisibilityRevision: view.actorVisibilityRevision,
  };
  const projection: CustomMonsterProjection = {
    ...revisions,
    kind: 'CUSTOM_MONSTER_AUTHORING',
    formId: view.formId as CustomMonsterProjection['formId'],
    contextId: source.scope.gmLocalContextId,
    campaignId: source.scope.campaignId,
    campaignStatus: source.currentCampaign.status,
    context: { attemptOrNull: attempt, selectedVersionOrNull },
    sheetOrNull,
    validationErrors,
    catalog: catalog.monsterChoices,
    diceMode,
    advisorPreparationOrNull:
      view.formId === 'ENM-015' &&
      attempt?.kind === 'CUSTOM_MONSTER' &&
      attempt.compositionOrNull?.advisorCardIdOrNull != null
        ? (() => {
            const card =
              attempt.advisorCards.find(
                (row) => row.cardId === attempt.compositionOrNull?.advisorCardIdOrNull,
              ) ?? s.fail('SOURCE_CHANGED');
            const body = deriveCustomMonsterBody(
              catalog.monster,
              customMonsterCompleteInput(attempt),
              attempt.compositionOrNull.symbiontInstanceIdOrNull,
            );
            const stats = customMonsterAdvisorStats(catalog.monster, body, card);
            return {
              cardId: card.cardId,
              stats,
              capacity: Math.ceil(stats.W / 2),
              initialFilled: card.initialSkillsOrNull !== null,
            };
          })()
        : null,
    requiredRolls:
      view.formId === 'ENM-015' && attempt?.kind === 'CUSTOM_MONSTER'
        ? customMonsterRequiredRolls(attempt)
        : [],
    art: catalog.monsterArt,
  };
  return {
    revisions,
    base: {
      formId: view.formId,
      formType: 'screen',
      routeTemplate: `/master/campaigns/:campaignId/enemy-catalog/${view.formId.toLowerCase()}`,
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: source.scope.campaignId }],
      availableActionKeys: enemyAuthoringActions(projection),
      roleFilteredPayload: structuredClone(projection) as unknown as JsonObject,
    },
  };
}
