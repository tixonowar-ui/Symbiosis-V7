import { randomUUID, randomInt } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { JsonObject, JsonValue } from '@shared/wire-protocol.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import {
  ENEMY_PLACEHOLDER,
  enemyAuthoringActions,
  enemyWorkflowRequestValue,
  isEnemyAuthoringForm,
  isSentientEnemyAuthoringForm,
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
  readEnemyCompositionDiceSource,
  validateEnemyCompositionReservations,
  type EnemyStoredVersion,
} from '../persistence/enemy-authoring-store.js';
import type {
  CampaignPrivateOwnerValidator,
  GmRequestReviewScope,
  GmRequestReviewViewState,
} from '../persistence/campaign-creation.js';
import type { GmRequestReviewSource } from '../persistence/network-device-request.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import { readAppliedMigrationVersion } from '../persistence/migrations/index.js';
import {
  resolveStoredLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import type { EnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';
import { enemyCompositionPatchValue } from '@shared/enemy-composition.js';
import {
  prepareEnemyComposition,
  issueEnemyCompositionRolls,
  enemyCompositionInitialBasis,
} from './enemy-composition-preparation.js';
import {
  deriveSentientComposition,
  deriveSentientCompositionStructure,
  validateSentientCompositionRolls,
  sentientCompositionRollRequirements,
  sentientAcquisitionRolls,
} from '../domain/entities/enemy-template/sentient-composition.js';
import { prepareEnemySkillPlanState } from './enemy-skill-plan-preparation.js';
import { customMonsterAttemptValue } from '@shared/custom-monster-state.js';
import {
  customMonsterCompleteInput,
  deriveCustomMonsterBody,
  deriveCustomMonsterSheet,
  customMonsterIdentityDomainValue,
} from '../domain/entities/enemy-template/custom-monster-authoring.js';
import {
  prepareCustomMonsterComposition,
  prepareCustomMonsterKnowledge,
} from './custom-monster-preparation.js';
import { customMonsterStatsValue } from '@shared/custom-monster.js';
import { prepareCustomMonsterCommand, projectCustomMonster } from './custom-monster-application.js';
import { diffEnemyVersionValues } from '../domain/entities/enemy-template/version-configuration.js';
import {
  enemyVersionHistoryValue,
  type EnemyVersionHistory,
} from '@shared/enemy-version-history.js';
import { wireCodecPrimitives as w } from '@shared/wire-codec.js';
import {
  enemyVersionEditorValue,
  enemyVersionEditorReadinessErrors,
} from '@shared/enemy-version-editor.js';
import {
  prepareEnemyVersionConfiguration,
  prepareCustomMonsterVersionOwnChoices,
  assertSentientVersionOwnChoices,
} from './enemy-version-preparation.js';
import { collectEnemyVersionMandatoryFacts } from '../persistence/enemy-version-source.js';
import { enemyVersionLegacyEffectRequiresUpgrade } from '../domain/entities/enemy-template/version-configuration.js';

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
    if (
      attempt.schemaVersion !== 2 &&
      Object.values(derived.skillStageStats).some((value) => value < 1)
    )
      return s.fail('INVALID_INPUT');
    validateSkillSelection(catalog.skills, {
      raceCode: build.raceCode,
      classCode: build.pureClassOrNull,
      skillStageStats: derived.skillStageStats,
      selectedSkills: build.skillSelections,
    });
  }
  if (attempt.inventoryOrNull !== null) deriveSentientEnemySheet(catalog, attempt);
  if (attempt.compositionOrNull !== null && 'schemaVersion' in attempt.compositionOrNull) {
    const race = attempt.buildOrNull?.raceCode ?? s.fail('SOURCE_CHANGED');
    deriveSentientCompositionStructure(catalog.composition, race, attempt.compositionOrNull);
    validateSentientCompositionRolls(catalog.composition, race, attempt.compositionOrNull);
  }
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
  const monsterRelevant =
    source.viewOrNull?.enemyAuthoring?.attemptOrNull?.kind === 'CUSTOM_MONSTER' ||
    source.viewOrNull?.enemyAuthoring?.selectedVersionOrNull?.kind === 'CUSTOM_MONSTER' ||
    state.events.some(
      (event) =>
        event.view.enemyAuthoring?.attemptOrNull?.kind === 'CUSTOM_MONSTER' ||
        event.view.enemyAuthoring?.selectedVersionOrNull?.kind === 'CUSTOM_MONSTER' ||
        (event.mutation.kind === 'NAV' &&
          event.mutation.request.actionKey === 'ENM-001::CTA::011') ||
        (event.mutation.kind === 'ENEMY_AUTHORING' &&
          (event.mutation.cause.request.payload.stage?.startsWith('MONSTER_') ||
            event.mutation.cause.committedVersionOrNull?.kind === 'CUSTOM_MONSTER')),
    );
  if (monsterRelevant) {
    if (![22, 23].includes(readAppliedMigrationVersion(db))) return s.fail('SOURCE_CHANGED');
    catalog.assertMonsterCurrent();
  }
  const versionRelevant =
    source.viewOrNull?.enemyAuthoring?.versionAttempt !== undefined ||
    state.events.some(
      (event) =>
        event.view.enemyAuthoring?.versionAttempt !== undefined ||
        (event.mutation.kind === 'NAV' && event.mutation.request.actionKey === 'ENM-001::CTA::008'),
    );
  if (versionRelevant && readAppliedMigrationVersion(db) !== 23) return s.fail('SOURCE_CHANGED');
  validateEnemyCompositionReservations(db, source.scope, state.events);
  const versions = readEnemyVersions(db, source.scope, state.events);
  for (const [index, event] of state.events.entries()) {
    if (event.mutation.kind === 'ENEMY_AUTHORING') {
      const mutation = event.mutation.cause;
      const original =
        state.events[index - 1]?.view.enemyAuthoring?.attemptOrNull ?? s.fail('SOURCE_CHANGED');
      const expectedPatchSource =
        state.events[index - 1]?.view.enemyAuthoring?.versionAttempt !== undefined &&
        mutation.request.workflowCommandId === 'UI-CMD-ENEMY-DRAFT-PATCH'
          ? 'ENM-017'
          : undefined;
      if (mutation.versionPatchSourceFormId !== expectedPatchSource)
        return s.fail('SOURCE_CHANGED');
      if (mutation.request.payload.stage === 'VERSION_CONFIGURATION') {
        const metadata =
          state.events[index - 1]?.view.enemyAuthoring?.versionAttempt ?? s.fail('SOURCE_CHANGED');
        if (
          !s.same(
            prepareEnemyVersionConfiguration(
              catalog,
              original,
              metadata,
              mutation.request,
              collectEnemyVersionMandatoryFacts(state.events.slice(0, index), metadata.origin.base),
            ),
            mutation.preparedVersionConfiguration,
          ) ||
          mutation.preparedComposition !== undefined ||
          mutation.preparedSkillState !== undefined ||
          mutation.preparedMonsterComposition !== undefined ||
          mutation.preparedMonsterKnowledge !== undefined
        )
          return s.fail('SOURCE_CHANGED');
      } else if (original.kind === 'CUSTOM_MONSTER') {
        if (mutation.preparedComposition !== undefined || mutation.preparedSkillState !== undefined)
          return s.fail('SOURCE_CHANGED');
        if (mutation.request.payload.stage === 'MONSTER_STATS') {
          const expectedKnowledge = prepareCustomMonsterKnowledge(
            catalog.monster,
            original,
            customMonsterStatsValue(mutation.request.payload.data),
            mutation.request.commandId,
          );
          if (!s.same(expectedKnowledge, mutation.preparedMonsterKnowledge))
            return s.fail('SOURCE_CHANGED');
        } else if (mutation.preparedMonsterKnowledge !== undefined) return s.fail('SOURCE_CHANGED');
        if (mutation.request.payload.stage === 'MONSTER_SYMBIONT') {
          const prepared = mutation.preparedMonsterComposition ?? s.fail('SOURCE_CHANGED');
          const expected = prepareCustomMonsterComposition(
            catalog.monster,
            prepareCustomMonsterVersionOwnChoices(
              catalog.monster,
              original,
              mutation.request,
              state.events[index - 1]?.view.enemyAuthoring?.versionAttempt,
            ),
            mutation.request,
            readEnemyCompositionDiceSource(db, source, state.events.slice(0, index))
              .diceModeSnapshot,
            {
              symbiontInstanceIdOrNull: prepared.composition.symbiontInstanceIdOrNull,
              advisorCardIdOrNull: prepared.composition.advisorCardIdOrNull,
              rolls: prepared.advisorCards.flatMap((card) =>
                card.iwRolls.filter(
                  (roll) => roll.originatingCommandId === mutation.request.commandId,
                ),
              ),
            },
          );
          if (!s.same(expected, prepared)) return s.fail('SOURCE_CHANGED');
        } else if (mutation.preparedMonsterComposition !== undefined)
          return s.fail('SOURCE_CHANGED');
      } else {
        if (
          mutation.preparedMonsterComposition !== undefined ||
          mutation.preparedMonsterKnowledge !== undefined
        )
          return s.fail('SOURCE_CHANGED');
        const versionState = state.events[index - 1]?.view.enemyAuthoring?.versionAttempt;
        if (versionState !== undefined && mutation.request.payload.stage === 'SENTIENT_INVENTORY')
          assertSentientVersionOwnChoices(
            original,
            versionState,
            collectEnemyVersionMandatoryFacts(
              state.events.slice(0, index),
              versionState.origin.base,
            ),
            mutation.request,
          );
        const expected = prepareEnemySkillPlanState(
          catalog,
          original,
          mutation.request,
          mutation.itemTemplateKeys,
          mutation.preparedComposition,
        );
        if (
          expected === undefined
            ? mutation.preparedSkillState !== undefined
            : mutation.preparedSkillState === undefined ||
              !s.same(expected, mutation.preparedSkillState)
        )
          return s.fail('SOURCE_CHANGED');
      }
      if (
        original.schemaVersion === 2 &&
        mutation.request.payload.stage === 'SENTIENT_SYMBIONTS' &&
        mutation.preparedComposition === undefined
      )
        return s.fail('SOURCE_CHANGED');
    }
    if (
      event.mutation.kind === 'ENEMY_AUTHORING' &&
      event.mutation.cause.preparedComposition !== undefined
    ) {
      const mutation = event.mutation.cause,
        prepared = mutation.preparedComposition ?? s.fail('SOURCE_CHANGED');
      const original =
        state.events[index - 1]?.view.enemyAuthoring?.attemptOrNull ?? s.fail('SOURCE_CHANGED');
      if (original.kind !== 'SENTIENT') return s.fail('SOURCE_CHANGED');
      const expected = prepareEnemyComposition(
        catalog,
        original,
        mutation.request,
        readEnemyCompositionDiceSource(db, source, state.events.slice(0, index)),
        {
          instanceIds: prepared.instanceIds,
          advisorCardIdOrNull: prepared.advisorCardIdOrNull,
          rolls: prepared.rolls.filter(
            (row) => row.originatingCommandId === mutation.request.commandId,
          ),
        },
      );
      if (!s.same(expected, prepared)) return s.fail('SOURCE_CHANGED');
    }
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
    if (event.view.formId === 'ENM-020') {
      const selected = event.view.enemyAuthoring?.selectedVersionOrNull;
      const stored = versions.find((row) => s.same(row.identity, selected));
      if (
        selected == null ||
        selectedUser == null ||
        stored === undefined ||
        selected.templateId !== selectedUser.templateId ||
        selected.kind !== selectedUser.kind ||
        selected.version > selectedUser.version
      )
        return s.fail('SOURCE_CHANGED');
      const commitIndex = state.events.findIndex((row) => row.eventId === stored.operationId);
      if (commitIndex < 0 || commitIndex > index) return s.fail('SOURCE_CHANGED');
    }
    const attempt = event.view.enemyAuthoring?.attemptOrNull;
    if (attempt != null) {
      if (attempt.campaignId !== source.scope.campaignId) return s.fail('FOREIGN_OWNER');
      if (attempt.kind === 'SENTIENT') validateAttempt(catalog, attempt);
      else {
        customMonsterAttemptValue(attempt);
        if (attempt.identityOrNull !== null)
          customMonsterIdentityDomainValue(attempt.identityOrNull);
        if (attempt.compositionOrNull !== null) {
          deriveCustomMonsterBody(
            catalog.monster,
            customMonsterCompleteInput(attempt),
            attempt.compositionOrNull.symbiontInstanceIdOrNull,
          );
          if (attempt.compositionOrNull.phase === 'CONFIRMED')
            deriveCustomMonsterSheet(catalog.monster, attempt);
        }
      }
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
        !s.same(
          saved.sheet,
          original.kind === 'CUSTOM_MONSTER'
            ? deriveCustomMonsterSheet(catalog.monster, original)
            : deriveSentientEnemySheet(catalog, original),
        ) ||
        saved.identity.artSha256 !==
          (original.kind === 'CUSTOM_MONSTER' ? catalog.monsterArt : catalog.art).sha256 ||
        saved.identity.artAssetKey !==
          (original.kind === 'CUSTOM_MONSTER'
            ? 'symbiosis_placeholder_monster'
            : ENEMY_PLACEHOLDER) ||
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
          if (request.payload.stage === 'VERSION_CONFIGURATION') {
            const state = view.enemyAuthoring?.versionAttempt ?? s.fail('UNAVAILABLE');
            return {
              mutation: {
                versionPatchSourceFormId: 'ENM-017',
                authorMasterProfileId: source.context.masterProfileId,
                sourceBaselineVersion: d.baseline.baselineVersion,
                request,
                itemTemplateKeys: [],
                committedVersionOrNull: null,
                receiptId: randomUUID(),
                timestamp: new Date().toISOString(),
                preparedVersionConfiguration: (() => {
                  let result: ReturnType<typeof prepareEnemyVersionConfiguration> | undefined;
                  d.readCurrent((checked, prefix) => {
                    if (!s.same(checked, source)) return s.fail('SOURCE_CHANGED');
                    result = prepareEnemyVersionConfiguration(
                      d.catalog,
                      attempt,
                      state,
                      request,
                      collectEnemyVersionMandatoryFacts(prefix.events, state.origin.base),
                    );
                  });
                  return result ?? s.fail('SOURCE_CHANGED');
                })(),
              },
              versionOrNull: null,
            };
          }
          if (attempt.kind === 'CUSTOM_MONSTER') {
            let result: ReturnType<typeof prepareCustomMonsterCommand> | undefined;
            d.readCurrent((currentSource, state) => {
              if (!s.same(currentSource, source)) return s.fail('SOURCE_CHANGED');
              result = prepareCustomMonsterCommand(
                d.database,
                d.catalog,
                source,
                attempt,
                request,
                d.baseline.baselineVersion,
                state.events,
              );
            });
            return result ?? s.fail('SOURCE_CHANGED');
          }
          const timestamp = new Date().toISOString();
          const append = request.workflowCommandId === 'UI-CMD-ENEMY-NEW-VERSION';
          const versionState = view.enemyAuthoring?.versionAttempt;
          const base = append ? (versionState?.origin.base ?? s.fail('UNAVAILABLE')) : null;
          if (
            append &&
            versionState !== undefined &&
            enemyVersionLegacyEffectRequiresUpgrade(attempt, versionState.retainedMandatoryFacts)
          )
            return s.fail('UNAVAILABLE');
          const commit = request.workflowCommandId === 'UI-CMD-ENEMY-COMMIT-V1' || append;
          const identity = commit
            ? {
                campaignId: d.scope.campaignId,
                templateId: base?.templateId ?? randomUUID(),
                versionId: randomUUID(),
                version: base === null ? 1 : base.version + 1,
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
          const compositionPreparation =
            request.payload.stage === 'SENTIENT_SYMBIONTS' &&
            (attempt.schemaVersion === 2 || Object.hasOwn(request.payload.data ?? {}, 'operation'))
              ? (() => {
                  const patch = Object.hasOwn(request.payload.data ?? {}, 'operation')
                    ? enemyCompositionPatchValue(request.payload.data)
                    : null;
                  const observed: {
                    diceSource?: ReturnType<typeof readEnemyCompositionDiceSource>;
                  } = {};
                  d.readCurrent((currentSource, state) => {
                    if (!s.same(currentSource, source)) return s.fail('SOURCE_CHANGED');
                    observed.diceSource = readEnemyCompositionDiceSource(
                      d.database,
                      source,
                      state.events,
                    );
                  });
                  const dice = observed.diceSource ?? s.fail('SOURCE_CHANGED');
                  const previous =
                    attempt.compositionOrNull !== null &&
                    'schemaVersion' in attempt.compositionOrNull
                      ? attempt.compositionOrNull
                      : null;
                  const card = attempt.compositionAcquisitions?.advisorCards[0];
                  const instanceIds =
                    patch === null
                      ? []
                      : patch.operation === 'PREVIEW'
                        ? patch.selection.monsterOrNull === null
                          ? patch.selection.ordinarySymbiontInstances.map((row) =>
                              row.speciesKey === 'ADVISER' && card !== undefined
                                ? card.symbiontInstanceId
                                : randomUUID(),
                            )
                          : [randomUUID()]
                        : (previous?.instanceIds ?? s.fail('UNAVAILABLE'));
                  const advisorCardIdOrNull =
                    patch === null
                      ? null
                      : patch.operation === 'PREVIEW'
                        ? patch.selection.ordinarySymbiontInstances.some(
                            (row) => row.speciesKey === 'ADVISER',
                          )
                          ? (card?.cardId ?? null)
                          : null
                        : patch.operation === 'CONFIRM'
                          ? previous?.ordinarySymbiontInstances.some(
                              (row) => row.speciesKey === 'ADVISER',
                            )
                            ? (previous.advisorCardIdOrNull ?? randomUUID())
                            : null
                          : (previous?.advisorCardIdOrNull ?? null);
                  const rolls =
                    patch?.operation === 'CONFIRM'
                      ? issueEnemyCompositionRolls(
                          d.catalog,
                          attempt,
                          request,
                          dice.diceModeSnapshot,
                          (sides) => randomInt(1, sides + 1),
                        )
                      : [];
                  return prepareEnemyComposition(d.catalog, attempt, request, dice, {
                    instanceIds,
                    advisorCardIdOrNull,
                    rolls,
                  });
                })()
              : undefined;
          const itemTemplateKeys = Array.from({ length: itemCount }, () => randomUUID());
          if (versionState !== undefined && request.payload.stage === 'SENTIENT_INVENTORY')
            d.readCurrent((checked, prefix) => {
              if (!s.same(checked, source)) return s.fail('SOURCE_CHANGED');
              assertSentientVersionOwnChoices(
                attempt,
                versionState,
                collectEnemyVersionMandatoryFacts(prefix.events, versionState.origin.base),
                request,
              );
            });
          const preparedSkillState = prepareEnemySkillPlanState(
            d.catalog,
            attempt,
            request,
            itemTemplateKeys,
            compositionPreparation,
          );
          const mutation: EnemyAuthoringMutation = {
            ...(versionState !== undefined && !commit
              ? { versionPatchSourceFormId: 'ENM-017' as const }
              : {}),
            authorMasterProfileId: source.context.masterProfileId,
            sourceBaselineVersion: d.baseline.baselineVersion,
            request,
            itemTemplateKeys,
            committedVersionOrNull: identity,
            receiptId: randomUUID(),
            timestamp,
            ...(compositionPreparation === undefined
              ? {}
              : { preparedComposition: compositionPreparation }),
            ...(preparedSkillState === undefined ? {} : { preparedSkillState }),
          };
          const versionOrNull: EnemyStoredVersion | null =
            identity === null
              ? null
              : {
                  identity,
                  actorId: source.context.masterProfileId,
                  operation: append
                    ? 'APPEND_SENTIENT_ENEMY_TEMPLATE_VERSION'
                    : 'CREATE_SENTIENT_ENEMY_TEMPLATE',
                  attempt,
                  sheet: deriveSentientEnemySheet(d.catalog, attempt),
                  sourceBaselineVersion: d.baseline.baselineVersion,
                  operationId: request.commandId,
                  timestamp,
                  historyId: randomUUID(),
                  ...(append && versionState !== undefined
                    ? {
                        versionSource: {
                          origin: versionState.origin,
                          reason: versionState.reason,
                          retainedMandatoryFacts: versionState.retainedMandatoryFacts,
                          ...(versionState.configurationConfirmation === undefined
                            ? {}
                            : {
                                configurationConfirmation: versionState.configurationConfirmation,
                              }),
                        },
                      }
                    : {}),
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
          let monsterDiceMode: 'AUTO' | 'MANUAL' | undefined;
          const source = d.readCurrent((source, state) => {
            if (!s.same(source.scope, d.scope)) return s.fail('FOREIGN_OWNER');
            versions = validateEnemyAuthoringSource(
              d.database,
              source,
              state,
              d.catalog,
              d.baseline,
            );
            if (
              source.viewOrNull?.enemyAuthoring?.attemptOrNull?.kind === 'CUSTOM_MONSTER' ||
              source.viewOrNull?.enemyAuthoring?.selectedVersionOrNull?.kind === 'CUSTOM_MONSTER'
            )
              monsterDiceMode = readEnemyCompositionDiceSource(
                d.database,
                source,
                state.events,
              ).diceModeSnapshot;
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
          const versionHistory: EnemyVersionHistory | undefined =
            view.formId === 'ENM-020'
              ? (() => {
                  const selected = context.selectedVersionOrNull ?? s.fail('SOURCE_CHANGED');
                  const chain = versions
                    .filter((row) => row.identity.templateId === selected.templateId)
                    .sort((a, b) => a.identity.version - b.identity.version);
                  const last = chain.at(-1) ?? s.fail('SOURCE_CHANGED');
                  const candidate = (row: EnemyStoredVersion) => {
                    const { attemptId: _id, revision: _revision, ...full } = row.attempt;
                    // The wire reader uses null-prototype maps; the strict diff accepts plain JSON data.
                    return structuredClone(w.jsonObject(full, '$.historyCandidate'));
                  };
                  return enemyVersionHistoryValue({
                    current: last.identity,
                    selected,
                    entries: chain.map((row, index) => ({
                      identity: row.identity,
                      timestamp: row.timestamp,
                      reason: row.versionSource?.reason ?? null,
                      changeSet:
                        index === 0
                          ? []
                          : diffEnemyVersionValues(
                              candidate(chain[index - 1] ?? s.fail('SOURCE_CHANGED')),
                              candidate(row),
                            ),
                      configurationSummaryOrNull:
                        row.versionSource?.configurationConfirmation ?? null,
                    })),
                    // No enemy combat-instance producer exists; this is truthful capability absence.
                    activeCombatPins: [],
                  });
                })()
              : undefined;
          const versionEditor =
            view.formId === 'ENM-017'
              ? (() => {
                  const origin = context.versionAttempt?.origin ?? s.fail('SOURCE_CHANGED');
                  const attempt = context.attemptOrNull ?? s.fail('SOURCE_CHANGED');
                  const base =
                    versions.find((row) => s.same(row.identity, origin.base)) ??
                    s.fail('SOURCE_CHANGED');
                  const current =
                    versions
                      .filter((row) => row.identity.templateId === origin.base.templateId)
                      .sort((a, b) => b.identity.version - a.identity.version)[0] ??
                    s.fail('SOURCE_CHANGED');
                  const data = (value: typeof attempt) => {
                    const { attemptId: _id, revision: _revision, ...full } = value;
                    return structuredClone(w.jsonObject(full, '$.candidate'));
                  };
                  return enemyVersionEditorValue(
                    {
                      schemaVersion: 1,
                      baseSnapshot: base.attempt,
                      currentVersion: current.identity,
                      changeSet: diffEnemyVersionValues(data(base.attempt), data(attempt)),
                      activeCombatPins: [],
                      replacementSummaryOrNull:
                        context.versionAttempt?.replacementPreviewOrNull?.inputSummary ?? null,
                    },
                    context,
                  );
                })()
              : undefined;
          if (
            context.attemptOrNull?.kind === 'CUSTOM_MONSTER' ||
            context.selectedVersionOrNull?.kind === 'CUSTOM_MONSTER'
          )
            return projectCustomMonster(
              d.catalog,
              source,
              context,
              version,
              monsterDiceMode ?? s.fail('SOURCE_CHANGED'),
              versionHistory,
              versionEditor,
            );
          if (
            version !== null &&
            version.operation !== 'CREATE_SENTIENT_ENEMY_TEMPLATE' &&
            version.operation !== 'APPEND_SENTIENT_ENEMY_TEMPLATE_VERSION'
          )
            return s.fail('SOURCE_CHANGED');
          if (!isSentientEnemyAuthoringForm(view.formId)) return s.fail('SOURCE_CHANGED');
          let sheetOrNull = version?.sheet ?? null;
          const validationErrors: string[] = [];
          if (view.formId === 'ENM-010' || view.formId === 'ENM-017') {
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
          if (versionEditor !== undefined)
            validationErrors.push(...enemyVersionEditorReadinessErrors(versionEditor, context));
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
                      invalidPermanentStats.length === 0 ||
                      context.attemptOrNull?.schemaVersion === 2
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
            context: {
              attemptOrNull: context.attemptOrNull,
              selectedVersionOrNull: context.selectedVersionOrNull,
              ...(context.versionAttempt === undefined
                ? {}
                : { versionAttempt: context.versionAttempt }),
            },
            sheetOrNull,
            ...(view.formId === 'ENM-020'
              ? {
                  versionConfigurationSummaryOrNull:
                    version?.versionSource?.configurationConfirmation ?? null,
                  versionHistory: versionHistory ?? s.fail('SOURCE_CHANGED'),
                }
              : {}),
            validationErrors,
            ...(versionEditor === undefined ? {} : { versionEditor }),
            catalog: {
              ...d.catalog.choices,
              buildOptions: buildOptions as unknown as JsonValue,
            },
            ...((view.formId === 'ENM-008' || view.formId === 'ENM-017') &&
            context.attemptOrNull?.compositionOrNull != null &&
            'schemaVersion' in context.attemptOrNull.compositionOrNull
              ? (() => {
                  const attempt = context.attemptOrNull ?? s.fail('UNAVAILABLE'),
                    composition = context.attemptOrNull.compositionOrNull;
                  const basis = enemyCompositionInitialBasis(d.catalog, attempt),
                    known = sentientAcquisitionRolls(composition);
                  const requiredRolls = sentientCompositionRollRequirements(
                    d.catalog.composition,
                    basis.build.raceCode,
                    composition,
                  ).filter((row) => !known.has(row.kind));
                  try {
                    const preview = deriveSentientComposition(
                      d.catalog.composition,
                      d.catalog.skills,
                      basis.build,
                      basis.skillStageStats,
                      composition,
                      basis.selected.learnedSkills,
                      false,
                      false,
                      0,
                      false,
                      context.attemptOrNull?.skillPlanState,
                    );
                    return {
                      compositionPreparation: {
                        permanentStatsOrNull: preview.permanentStats,
                        factsOrNull: preview.facts as unknown as JsonObject,
                        requiredRolls,
                        errors: Object.entries(preview.permanentStats)
                          .filter(([, value]) => value < 1)
                          .map(
                            ([stat]) =>
                              `До выбора экипировки ${stat} ниже 1. Полный лист и сохранение потребуют итог не ниже 1; автоматического ограничения нет.`,
                          ),
                      },
                    };
                  } catch (error) {
                    return {
                      compositionPreparation: {
                        permanentStatsOrNull: null,
                        factsOrNull: null,
                        requiredRolls,
                        errors: [
                          error instanceof Error ? error.message : 'Состав не прошёл проверку.',
                        ],
                      },
                    };
                  }
                })()
              : {}),
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
