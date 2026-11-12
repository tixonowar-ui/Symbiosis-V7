import type Database from 'better-sqlite3';
import type { JsonObject, RevisionVector } from '@shared/wire-protocol.js';
import type { FormActionIntentV2Message, PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import {
  enemyLibraryActions,
  enemyLibraryProjectionValue,
  enemyLibraryContextValue,
  type EnemyLibrarySelectionRequest,
} from '@shared/enemy-library.js';
import { commitEnemyLibrarySelection } from '../persistence/enemy-library-store.js';
import {
  commitGmRequestReviewNavigation,
  type GmRequestReviewSource,
} from '../persistence/network-device-request.js';
import type {
  CampaignPrivateOwnerValidator,
  GmRequestReviewScope,
  GmRequestReviewViewState,
} from '../persistence/campaign-creation.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  resolveStoredLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import type { EnemySourceCatalog } from './enemy-catalog.js';
import type { EnemyUserEntry } from '@shared/enemy-authoring.js';

/** Own current GM scope is supplied by the existing campaign runtime on every call. */
export function createEnemyLibraryApplication(d: {
  database: Database.Database;
  scope: GmRequestReviewScope;
  catalog: EnemySourceCatalog;
  baseline: LocalCharacterExportBaseline;
  validateOwner: CampaignPrivateOwnerValidator;
  readUsers?: () => readonly EnemyUserEntry[];
  readCurrent: (
    observe: (source: GmRequestReviewSource, state: GmRequestReviewViewState) => void,
  ) => GmRequestReviewSource;
}) {
  const validate = (source: GmRequestReviewSource, state: GmRequestReviewViewState) => {
    if (!s.same(source.scope, d.scope)) return s.fail('FOREIGN_OWNER');
    validateEnemyLibrarySource(source, state, d.catalog, d.baseline);
  };
  const current = () => d.readCurrent(validate);
  function project(): { base: PresentedBaseForm; revisions: RevisionVector } {
    return d.database
      .transaction(() => {
        const source = current(),
          view = source.viewOrNull ?? s.fail('UNAVAILABLE');
        if (view.formId !== 'ENM-001' && view.formId !== 'ENM-003') return s.fail('UNAVAILABLE');
        const context = enemyLibraryContextValue(view.enemyLibrary);
        const p = enemyLibraryProjectionValue({
          kind: 'SYSTEM_LIBRARY',
          formId: view.formId,
          contextId: d.scope.gmLocalContextId,
          campaignId: d.scope.campaignId,
          campaignStatus: source.currentCampaign.status,
          stateRevision: view.stateRevision,
          projectionRevision: view.projectionRevision,
          actorVisibilityRevision: view.actorVisibilityRevision,
          defaultSentientCatalogVersion: d.catalog.catalogVersion,
          catalogBaselineVersion: source.creationOrigin.payload.baselineVersion,
          systemTemplates: d.catalog.systemTemplates,
          canonicalTemplates: d.catalog.canonicalTemplates,
          currentUserTemplates: (d.readUsers?.() ?? []).filter(
            (row) => (row.kind === 'SENTIENT') === (context.activeTab === 'SENTIENT_ENEMIES'),
          ),
          ...(view.formId === 'ENM-003'
            ? { systemTemplateArtAssetKey: context.selectedOrNull?.artAssetKey }
            : {}),
          ...context,
          cardOrNull:
            view.formId === 'ENM-003'
              ? d.catalog.card(context.selectedOrNull ?? s.fail('UNAVAILABLE'))
              : null,
        });
        return {
          revisions: {
            stateRevision: view.stateRevision,
            projectionRevision: view.projectionRevision,
            actorVisibilityRevision: view.actorVisibilityRevision,
          },
          base: {
            formId: view.formId,
            formType: 'screen' as const,
            routeTemplate: `/master/campaigns/:campaignId/enemy-catalog/${view.formId.toLowerCase()}`,
            routeBindings: [
              { parameterIndex: 0, source: 'inherited' as const, value: d.scope.campaignId },
            ],
            availableActionKeys: enemyLibraryActions(p),
            roleFilteredPayload: p as unknown as JsonObject,
          },
        };
      })
      .deferred();
  }
  return {
    project,
    navigation(request: FormActionIntentV2Message) {
      return commitGmRequestReviewNavigation(
        d.database,
        d.scope,
        request,
        d.validateOwner,
        (source, phase) => {
          if (!s.same(current(), source)) return s.fail('SOURCE_CHANGED');
          if (
            phase === 'APPLY' &&
            request.sourceFormId === 'ENM-001' &&
            ['ENM-001::CTA::002', 'ENM-001::CTA::004'].includes(request.actionKey)
          ) {
            const selected = source.viewOrNull?.enemyLibrary?.selectedOrNull;
            if (selected?.origin !== 'SYSTEM_DEFAULT_SENTIENT') return s.fail('UNAVAILABLE');
            d.catalog.card(selected);
          }
        },
      );
    },
    select(request: EnemyLibrarySelectionRequest) {
      return commitEnemyLibrarySelection(
        d.database,
        d.scope,
        request,
        d.validateOwner,
        (source) => {
          if (!s.same(current(), source)) return s.fail('SOURCE_CHANGED');
          if (
            request.contextId !== d.scope.gmLocalContextId ||
            request.campaignId !== d.scope.campaignId
          )
            return s.fail('FOREIGN_OWNER');
          enemyLibraryContextValue({
            activeTab: request.activeTab,
            selectedOrNull: request.selectionOrNull,
            ...(Object.hasOwn(request, 'userSelectionOrNull')
              ? { userSelectionOrNull: request.userSelectionOrNull }
              : {}),
          });
          if (request.selectionOrNull !== null) d.catalog.resolve(request.selectionOrNull);
          if (
            request.userSelectionOrNull != null &&
            !(d.readUsers?.() ?? []).some(({ displayName: _label, ...identity }) =>
              s.same(identity, request.userSelectionOrNull),
            )
          )
            return s.fail('FOREIGN_OWNER');
        },
      );
    },
  };
}

export function validateEnemyLibrarySource(
  source: GmRequestReviewSource,
  state: GmRequestReviewViewState,
  catalog: EnemySourceCatalog,
  baseline: LocalCharacterExportBaseline,
): void {
  if (source.context.masterProfileId !== source.privateOwner.masterProfileId)
    return s.fail('FOREIGN_OWNER');
  const birth = source.creationOrigin.payload;
  resolveStoredLocalCharacterExportBaseline(baseline, birth.baselineVersion);
  // The exact trusted lineage proves the legacy birth's frozen pack bytes, not a version guess.
  if (birth.schemaVersion === 2 && birth.defaultSentientCatalogVersion !== catalog.catalogVersion)
    return s.fail('SOURCE_CHANGED');
  const context = source.viewOrNull?.enemyLibrary;
  // Ordinary GM/NPC reads have no catalog facts until entry or an enemy-selection prefix.
  // Keep freshness on every relevant observation, including history after leaving ENM.
  if (
    source.viewOrNull?.formId === 'ENM-001' ||
    source.viewOrNull?.formId === 'ENM-003' ||
    context?.selectedOrNull != null ||
    state.events.some((event) => event.mutation.kind === 'ENEMY_SELECTION')
  )
    catalog.assertCurrent();
  for (const event of state.events) {
    if (
      event.mutation.kind === 'ENEMY_SELECTION' &&
      event.mutation.request.selectionOrNull !== null
    )
      catalog.resolve(event.mutation.request.selectionOrNull);
  }
  if (context?.selectedOrNull != null) catalog.resolve(context.selectedOrNull);
}
