import { randomUUID } from 'node:crypto';
import { createEnemyLibraryFixture } from './enemy-library.js';
import { loadNpcAuthoringSourceCatalog } from '../../src/host/npc-catalog.js';
import { loadEnemyAuthoringSourceCatalog } from '../../src/host/enemy-authoring-catalog.js';
import { loadEnemySourceCatalog } from '../../src/host/enemy-catalog.js';
import { loadLocalCharacterExportBaseline } from '../../src/host/local-character-export.js';
import { createEnemyAuthoringApplication } from '../../src/host/enemy-authoring-application.js';
import {
  enemyAuthoringProjectionValue,
  type EnemyPatchStage,
} from '../../src/shared/enemy-authoring.js';
import type { JsonObject } from '../../src/shared/wire-protocol.js';

/** Actual source + campaign/QUEUE + host derivation. This is a unit fixture, not a network/browser proof. */
export async function createEnemyCompositionClientFixture() {
  const baseline = await loadLocalCharacterExportBaseline(process.cwd()),
    common = await loadNpcAuthoringSourceCatalog(process.cwd()),
    catalog = loadEnemyAuthoringSourceCatalog(process.cwd(), common),
    library = loadEnemySourceCatalog(process.cwd(), baseline);
  const f = createEnemyLibraryFixture(library, baseline);
  const app = () =>
    createEnemyAuthoringApplication({
      database: f.db,
      scope: f.scope,
      catalog,
      baseline,
      validateOwner: () => undefined,
      readCurrent: f.readCurrent,
    });
  const projection = () => enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
  const patch = (stage: EnemyPatchStage, data: JsonObject) => {
    // Request metadata needs fresh persisted revisions, not an extra presentation/source read.
    // The command still performs all owning observe/prepare/history checks below.
    const view = f.readCurrent().viewOrNull;
    const attempt = view?.enemyAuthoring?.attemptOrNull;
    if (view == null || attempt == null) throw Error('Fixture requires a current enemy attempt');
    const request = {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      workflowCommandId: 'UI-CMD-ENEMY-DRAFT-PATCH',
      expectedRevisions: {
        stateRevision: view.stateRevision,
        projectionRevision: view.projectionRevision,
        actorVisibilityRevision: view.actorVisibilityRevision,
      },
      payload: {
        campaignId: f.scope.campaignId,
        creationAttemptId: attempt.attemptId,
        expectedAttemptRevision: attempt.revision,
        stage,
        data,
      },
    };
    app().command(request);
    return request;
  };
  try {
    f.nav('ENM-001::CTA::003');
    patch('SENTIENT_IDENTITY', {
      name: 'Советник при Трогре',
      description: 'Source-backed client fixture',
      origin: 'Fixture',
      affiliation: 'Fixture',
      massKg: 80,
      anatomyProfileId: 'ORDINARY_SENTIENT',
    });
    patch('SENTIENT_STATS', { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 });
    patch('SENTIENT_BUILD', {
      raceCode: 'UNITED',
      pureClassOrNull: null,
      skillSelections: [
        { skillKey: 'UNARMED', targetBonus: 7 },
        { skillKey: 'ACROBATICS', targetBonus: 1 },
      ],
    });
    const initial = projection();
    const member = (speciesKey: string, targetLevel: number) => ({
      speciesKey,
      targetLevel,
      learnedNodeRefs: common.development.nodes
        .filter((node) => node.speciesKey === speciesKey && node.level <= targetLevel)
        .map((node) => node.nodeRef),
      binding: { kind: 'NONE' },
    });
    const request = patch('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: false,
      selection: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [member('ADVISER', 1), member('TROGR', 2)],
        symbioticMonsterProfileIdOrNull: null,
        monsterOrNull: null,
      },
    });
    const preview = projection();
    patch('SENTIENT_SYMBIONTS', {
      operation: 'CONFIRM',
      previewCommandId: request.commandId,
      interactionsConfirmed: true,
      manualFacesOrNull: [12, 12, 20],
    });
    const acquired = projection();
    patch('SENTIENT_SYMBIONTS', {
      operation: 'FINISH',
      previewCommandId: request.commandId,
      skills: {
        advisorSkills: [
          { skillKey: 'UNARMED', targetBonus: 7 },
          { skillKey: 'ACROBATICS', targetBonus: 1 },
        ],
        dolphinSkills: [],
      },
    });
    patch('SENTIENT_INVENTORY', { inventoryItems: [], armorCompatibilityReasonOrNull: null });
    const full = projection();
    f.nav('ENM-010::CTA::005');
    f.nav('ENM-009::CTA::003');
    const emptyRequest = patch('SENTIENT_SYMBIONTS', {
      operation: 'PREVIEW',
      advisorRemovalConfirmed: true,
      selection: {
        symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
        ordinarySymbiontInstances: [],
        symbioticMonsterProfileIdOrNull: null,
        monsterOrNull: null,
      },
    });
    patch('SENTIENT_SYMBIONTS', {
      operation: 'CONFIRM',
      previewCommandId: emptyRequest.commandId,
      interactionsConfirmed: true,
      manualFacesOrNull: null,
    });
    const emptyAcquired = projection();
    f.nav('ENM-008::CTA::001');
    const buildExisting = projection();
    const replacement = {
      baseStats: buildExisting.context.attemptOrNull!.baseStatsOrNull,
      build: {
        raceCode: 'UNITED',
        pureClassOrNull: null,
        skillSelections: [
          { skillKey: 'FENCING', targetBonus: 3 },
          { skillKey: 'LEARNING', targetBonus: 6 },
        ],
      },
    };
    patch('SENTIENT_BUILD', {
      operation: 'PREVIEW_REBUILD',
      expectedPlanRevision: 1,
      initialInput: replacement,
    });
    const buildPreview = projection();
    return {
      initial,
      preview,
      acquired,
      full,
      emptyAcquired,
      buildExisting,
      buildPreview,
      ownerDeviceId: f.scope.ownerDeviceId,
    };
  } finally {
    f.close();
  }
}
