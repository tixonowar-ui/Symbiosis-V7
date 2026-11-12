import { randomUUID } from 'node:crypto';
import { createEnemyLibraryFixture } from './enemy-library.js';
import { loadLocalCharacterExportBaseline } from '../../src/host/local-character-export.js';
import { loadNpcAuthoringSourceCatalog } from '../../src/host/npc-catalog.js';
import { loadEnemySourceCatalog } from '../../src/host/enemy-catalog.js';
import { loadEnemyAuthoringSourceCatalog } from '../../src/host/enemy-authoring-catalog.js';
import { createEnemyAuthoringApplication } from '../../src/host/enemy-authoring-application.js';
import { customMonsterProjectionValue } from '../../src/shared/custom-monster-presentation.js';
import type { EnemyPatchStage } from '../../src/shared/enemy-authoring.js';
import type { JsonObject } from '../../src/shared/wire-protocol.js';

/** Actual host/SQLite/source DTOs, detached before closing. This does not claim a network boundary. */
export async function createCustomMonsterClientFixture(adviser = false) {
  const baseline = await loadLocalCharacterExportBaseline(process.cwd());
  const common = await loadNpcAuthoringSourceCatalog(process.cwd());
  const catalog = loadEnemyAuthoringSourceCatalog(process.cwd(), common);
  const f = createEnemyLibraryFixture(loadEnemySourceCatalog(process.cwd(), baseline), baseline);
  const app = () =>
    createEnemyAuthoringApplication({
      database: f.db,
      scope: f.scope,
      catalog,
      baseline,
      validateOwner: () => undefined,
      readCurrent: f.readCurrent,
    });
  const project = () => customMonsterProjectionValue(app().project().base.roleFilteredPayload);
  const patch = (stage: EnemyPatchStage, data: JsonObject) => {
    const view = f.readCurrent().viewOrNull,
      attempt = view?.enemyAuthoring?.attemptOrNull;
    if (view == null || attempt?.kind !== 'CUSTOM_MONSTER')
      throw Error('Expected current monster attempt');
    const request = {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      workflowCommandId: 'UI-CMD-ENEMY-DRAFT-PATCH',
      role: 'gm',
      commandId: randomUUID(),
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
    const view = f.readCurrent().viewOrNull;
    if (view == null) throw Error('Expected own library');
    f.app().select({
      messageType: 'network.enemy-selection.replace',
      protocolVersion: 3,
      operationId: randomUUID(),
      sourceFormId: 'ENM-001',
      contextId: f.scope.gmLocalContextId,
      campaignId: f.scope.campaignId,
      activeTab: 'MONSTERS',
      selectionOrNull: null,
      userSelectionOrNull: null,
      expectedRevisions: {
        stateRevision: view.stateRevision,
        projectionRevision: view.projectionRevision,
        actorVisibilityRevision: view.actorVisibilityRevision,
      },
    });
    f.nav('ENM-001::CTA::011');
    const identity = project();
    patch('MONSTER_IDENTITY', {
      name: 'Каменный зверь',
      description: 'Полный лист без симбионта',
      creatureType: 'CUSTOM_MONSTER',
    });
    const stats = project();
    patch('MONSTER_STATS', {
      statMode: 'MANUAL',
      baseStats: { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 },
      massKg: 5,
      ageYears: 1,
      baseMaxHP: 7,
      rollReceiptOrNull: null,
    });
    const physics = project();
    patch('MONSTER_PHYSICS', {
      naturalArmorDefinition: { mode: 'ZERO' },
      anatomyMode: 'NONSTANDARD_TORSO_ONLY',
      normalizedHitRegion: 'TORSO',
      size: null,
      movement: null,
      physicalTags: [],
      metadataHasNoMechanicalEffect: true,
    });
    const attack = project();
    patch('MONSTER_ATTACK', {
      category: 'MONSTER_ATTACK',
      distance: 'MELEE',
      actionCost: 1,
      additionalDamageDefinition: { mode: 'ZERO' },
      penetrationDefinition: { mode: 'ZERO' },
    });
    const symbiont = project();
    const preview = patch('MONSTER_SYMBIONT', {
      operation: 'PREVIEW',
      selection: adviser
        ? {
            mode: 'ORDINARY',
            symbiont: {
              speciesKey: 'ADVISER',
              targetLevel: 6,
              learnedNodeRefs: catalog.monster.development.nodes
                .filter((row) => row.speciesKey === 'ADVISER' && row.level <= 6)
                .map((row) => row.nodeRef),
              binding: { kind: 'NONE' },
            },
          }
        : { mode: 'NONE' },
    });
    patch('MONSTER_SYMBIONT', {
      operation: 'CONFIRM',
      previewCommandId: preview.commandId,
      manualFacesOrNull: adviser ? [1, 12] : null,
    });
    const acquired = project();
    patch('MONSTER_SYMBIONT', {
      operation: 'FINISH',
      previewCommandId: preview.commandId,
      advisorSkills: adviser
        ? [
            { skillKey: 'LEARNING', targetBonus: 7 },
            { skillKey: 'ACROBATICS', targetBonus: 1 },
          ]
        : [],
    });
    const full = project();
    return {
      identity,
      stats,
      physics,
      attack,
      symbiont,
      acquired,
      full,
      ownerDeviceId: f.scope.ownerDeviceId,
    };
  } finally {
    f.close();
  }
}
