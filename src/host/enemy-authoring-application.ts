import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { JsonObject, JsonValue } from '@shared/wire-protocol.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import {
  ENEMY_PLACEHOLDER,
  enemyAuthoringActions,
  enemyWorkflowRequestValue,
  isEnemyAuthoringForm,
  type EnemyAttempt,
  type EnemyAuthoringMutation,
  type EnemyAuthoringProjection,
} from '@shared/enemy-authoring.js';
import {
  enemyAttemptValue,
  deriveSentientEnemySheet,
} from '../domain/entities/enemy-template/sentient-authoring.js';
import { calculateSkillStageStats } from '../domain/rules/skill-stage/stats.js';
import {
  validateSkillSelection,
  validateSkillSelectionDraft,
} from '../domain/rules/skill-stage/skills.js';
import {
  commitEnemyAuthoring,
  readEnemyVersions,
  type EnemyStoredVersion,
} from '../persistence/enemy-authoring-store.js';
import type {
  CampaignPrivateOwnerValidator,
  GmRequestReviewScope,
  GmRequestReviewViewState,
} from '../persistence/campaign-creation.js';
import type { GmRequestReviewSource } from '../persistence/network-device-request.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  resolveStoredLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import type { EnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';

function validateAttempt(catalog: EnemyAuthoringSourceCatalog, value: EnemyAttempt): void {
  const attempt = enemyAttemptValue(value);
  if (attempt.buildOrNull !== null) {
    const baseStats = attempt.baseStatsOrNull ?? s.fail('UNAVAILABLE'),
      build = attempt.buildOrNull;
    const derived = calculateSkillStageStats(catalog.skills, {
      baseStats,
      raceCode: build.raceCode,
      classCode: build.pureClassOrNull,
      creationMode: 'MANUAL',
    });
    if (Object.values(derived.skillStageStats).some((value) => value < 1))
      return s.fail('INVALID_INPUT');
    validateSkillSelection(catalog.skills, {
      raceCode: build.raceCode,
      classCode: build.pureClassOrNull,
      skillStageStats: derived.skillStageStats,
      selectedSkills: build.skillSelections,
    });
  }
  if (attempt.inventoryOrNull !== null) deriveSentientEnemySheet(catalog, attempt);
}
/** Every historical attempt and COMMIT is checked even after cancellation, selection or leaving ENM. */
export function validateEnemyAuthoringSource(
  db: Database.Database,
  source: GmRequestReviewSource,
  state: GmRequestReviewViewState,
  catalog: EnemyAuthoringSourceCatalog,
  baseline: LocalCharacterExportBaseline,
): readonly EnemyStoredVersion[] {
  resolveStoredLocalCharacterExportBaseline(
    baseline,
    source.creationOrigin.payload.baselineVersion,
  );
  const relevant =
    isEnemyAuthoringForm(source.viewOrNull?.formId ?? '') ||
    state.events.some((event) => event.mutation.kind === 'ENEMY_AUTHORING');
  if (relevant) catalog.assertCurrent();
  const versions = readEnemyVersions(db, source.scope, state.events);
  for (const [index, event] of state.events.entries()) {
    if (
      event.mutation.kind === 'ENEMY_AUTHORING' &&
      event.mutation.cause.authorMasterProfileId !== source.context.masterProfileId
    )
      return s.fail('FOREIGN_OWNER');
    if (event.mutation.kind === 'ENEMY_AUTHORING')
      resolveStoredLocalCharacterExportBaseline(
        baseline,
        event.mutation.cause.sourceBaselineVersion,
      );
    const selectedUser = event.view.enemyLibrary?.userSelectionOrNull;
    if (selectedUser != null) {
      const stored =
        versions.find((version) => s.same(version.identity, selectedUser)) ??
        s.fail('SOURCE_CHANGED');
      const commitIndex = state.events.findIndex((event) => event.eventId === stored.operationId);
      if (commitIndex < 0 || commitIndex > index) return s.fail('SOURCE_CHANGED');
    }
    if (
      event.view.formId === 'ENM-020' &&
      !s.same(event.view.enemyAuthoring?.selectedVersionOrNull, selectedUser)
    )
      return s.fail('SOURCE_CHANGED');
    const attempt = event.view.enemyAuthoring?.attemptOrNull;
    if (attempt != null) {
      if (attempt.campaignId !== source.scope.campaignId) return s.fail('FOREIGN_OWNER');
      validateAttempt(catalog, attempt);
    }
    if (
      event.mutation.kind === 'ENEMY_AUTHORING' &&
      event.mutation.cause.committedVersionOrNull !== null
    ) {
      const mutation = event.mutation.cause,
        saved =
          versions.find((version) => version.operationId === event.eventId) ??
          s.fail('SOURCE_CHANGED');
      if (saved.sourceBaselineVersion !== mutation.sourceBaselineVersion)
        return s.fail('SOURCE_CHANGED');
      const original =
        state.events[index - 1]?.view.enemyAuthoring?.attemptOrNull ?? s.fail('SOURCE_CHANGED');
      if (
        !s.same(saved.attempt, original) ||
        !s.same(saved.sheet, deriveSentientEnemySheet(catalog, original)) ||
        saved.identity.artSha256 !== catalog.art.sha256 ||
        saved.identity.artAssetKey !== ENEMY_PLACEHOLDER ||
        !s.same(saved.identity, mutation.committedVersionOrNull)
      )
        return s.fail('SOURCE_CHANGED');
      resolveStoredLocalCharacterExportBaseline(baseline, saved.sourceBaselineVersion);
    }
  }
  if (
    source.viewOrNull?.enemyAuthoring?.selectedVersionOrNull != null &&
    !versions.some((version) =>
      s.same(version.identity, source.viewOrNull?.enemyAuthoring?.selectedVersionOrNull),
    )
  )
    return s.fail('SOURCE_CHANGED');
  return versions;
}
export function createEnemyAuthoringApplication(d: {
  readonly database: Database.Database;
  readonly scope: GmRequestReviewScope;
  readonly catalog: EnemyAuthoringSourceCatalog;
  readonly baseline: LocalCharacterExportBaseline;
  readonly validateOwner: CampaignPrivateOwnerValidator;
  readonly readCurrent: (
    observe: (source: GmRequestReviewSource, state: GmRequestReviewViewState) => void,
  ) => GmRequestReviewSource;
}) {
  const current = () =>
    d.readCurrent((source, state) => {
      if (!s.same(source.scope, d.scope)) return s.fail('FOREIGN_OWNER');
      validateEnemyAuthoringSource(d.database, source, state, d.catalog, d.baseline);
    });
  return {
    command(value: unknown) {
      const request = enemyWorkflowRequestValue(value);
      return commitEnemyAuthoring(d.database, d.scope, request, d.validateOwner, {
        observe(source) {
          if (!s.same(current(), source)) return s.fail('SOURCE_CHANGED');
        },
        prepare(source) {
          const view = source.viewOrNull ?? s.fail('UNAVAILABLE'),
            attempt = view.enemyAuthoring?.attemptOrNull ?? s.fail('UNAVAILABLE');
          if (
            request.payload.campaignId !== d.scope.campaignId ||
            request.payload.creationAttemptId !== attempt.attemptId
          )
            return s.fail('FOREIGN_OWNER');
          if (
            request.payload.expectedAttemptRevision !== attempt.revision ||
            !s.same(request.expectedRevisions, {
              stateRevision: view.stateRevision,
              projectionRevision: view.projectionRevision,
              actorVisibilityRevision: view.actorVisibilityRevision,
            })
          )
            return s.fail('STALE_REVISION');
          const timestamp = new Date().toISOString();
          const commit = request.workflowCommandId === 'UI-CMD-ENEMY-COMMIT-V1';
          const identity = commit
            ? {
                campaignId: d.scope.campaignId,
                templateId: randomUUID(),
                versionId: randomUUID(),
                version: 1 as const,
                kind: 'SENTIENT' as const,
                artAssetKey: ENEMY_PLACEHOLDER,
                artSha256: d.catalog.art.sha256,
              }
            : null;
          const itemCount =
            request.payload.stage === 'SENTIENT_INVENTORY' &&
            Array.isArray(request.payload.data?.['inventoryItems'])
              ? request.payload.data['inventoryItems'].length
              : 0;
          const mutation: EnemyAuthoringMutation = {
            authorMasterProfileId: source.context.masterProfileId,
            sourceBaselineVersion: d.baseline.baselineVersion,
            request,
            itemTemplateKeys: Array.from({ length: itemCount }, () => randomUUID()),
            committedVersionOrNull: identity,
            receiptId: randomUUID(),
            timestamp,
          };
          const versionOrNull: EnemyStoredVersion | null =
            identity === null
              ? null
              : {
                  identity,
                  actorId: source.context.masterProfileId,
                  operation: 'CREATE_SENTIENT_ENEMY_TEMPLATE',
                  attempt,
                  sheet: deriveSentientEnemySheet(d.catalog, attempt),
                  sourceBaselineVersion: d.baseline.baselineVersion,
                  operationId: request.commandId,
                  timestamp,
                  historyId: randomUUID(),
                };
          return { mutation, versionOrNull };
        },
      });
    },
    project(): {
      base: PresentedBaseForm;
      revisions: {
        stateRevision: number;
        projectionRevision: number;
        actorVisibilityRevision: number;
      };
    } {
      return d.database
        .transaction(() => {
          let versions: readonly EnemyStoredVersion[] = [];
          const source = d.readCurrent((source, state) => {
            if (!s.same(source.scope, d.scope)) return s.fail('FOREIGN_OWNER');
            versions = validateEnemyAuthoringSource(
              d.database,
              source,
              state,
              d.catalog,
              d.baseline,
            );
          });
          const view = source.viewOrNull ?? s.fail('UNAVAILABLE');
          if (!isEnemyAuthoringForm(view.formId)) return s.fail('UNAVAILABLE');
          const context = view.enemyAuthoring ?? s.fail('UNAVAILABLE');
          const version =
            context.selectedVersionOrNull === null
              ? null
              : (versions.find((version) =>
                  s.same(version.identity, context.selectedVersionOrNull),
                ) ?? s.fail('SOURCE_CHANGED'));
          let sheetOrNull = version?.sheet ?? null;
          const validationErrors: string[] = [];
          if (view.formId === 'ENM-010') {
            try {
              sheetOrNull = deriveSentientEnemySheet(
                d.catalog,
                context.attemptOrNull ?? s.fail('UNAVAILABLE'),
              );
            } catch (error) {
              validationErrors.push(
                error instanceof Error ? error.message : 'Лист не прошёл проверку.',
              );
            }
          }
          const revisions = {
            stateRevision: view.stateRevision,
            projectionRevision: view.projectionRevision,
            actorVisibilityRevision: view.actorVisibilityRevision,
          };
          const baseStats = context.attemptOrNull?.baseStatsOrNull;
          const buildOptions =
            baseStats == null
              ? []
              : d.catalog.skills.races.flatMap((race) => {
                  const classes =
                    race.classPolicy === 'REQUIRED_PURE_CLASS'
                      ? d.catalog.skills.classes.map((row) => row.classCode)
                      : [null];
                  return classes.map((classCode) => {
                    const { skillStageStats } = calculateSkillStageStats(d.catalog.skills, {
                      baseStats,
                      raceCode: race.raceCode,
                      classCode,
                      creationMode: 'MANUAL',
                    });
                    const invalidPermanentStats = Object.entries(skillStageStats)
                      .filter(([, value]) => value < 1)
                      .map(([key]) => key);
                    const skills =
                      invalidPermanentStats.length === 0
                        ? validateSkillSelectionDraft(d.catalog.skills, {
                            raceCode: race.raceCode,
                            classCode,
                            skillStageStats,
                            selectedSkills: [],
                          })
                        : null;
                    return {
                      raceCode: race.raceCode,
                      pureClassOrNull: classCode,
                      skillStageStats,
                      invalidPermanentStats,
                      capacityOrNull: skills?.capacity ?? null,
                      mandatorySkills:
                        skills?.learnedSkills.map((skill) => ({
                          ...skill,
                          name: d.catalog.skillLabels[skill.skillKey],
                        })) ?? [],
                    };
                  });
                });
          const projection: EnemyAuthoringProjection = {
            ...revisions,
            kind: 'SENTIENT_ENEMY_AUTHORING',
            formId: view.formId,
            contextId: d.scope.gmLocalContextId,
            campaignId: d.scope.campaignId,
            campaignStatus: source.currentCampaign.status,
            context,
            sheetOrNull,
            validationErrors,
            catalog: {
              ...d.catalog.choices,
              buildOptions: buildOptions as unknown as JsonValue,
            },
            art: d.catalog.art,
          };
          return {
            revisions,
            base: {
              formId: view.formId,
              formType: 'screen' as const,
              routeTemplate: `/master/campaigns/:campaignId/enemy-catalog/${view.formId.toLowerCase()}`,
              routeBindings: [
                { parameterIndex: 0, source: 'inherited' as const, value: d.scope.campaignId },
              ],
              availableActionKeys: enemyAuthoringActions(projection),
              roleFilteredPayload: structuredClone(projection) as unknown as JsonObject,
            },
          };
        })
        .deferred();
    },
  };
}
