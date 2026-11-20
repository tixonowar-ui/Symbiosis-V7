import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createEnemyLibraryFixture } from './enemy-library.js';
import { loadLocalCharacterExportBaseline } from '../../src/host/local-character-export.js';
import { loadNpcAuthoringSourceCatalog } from '../../src/host/npc-catalog.js';
import { loadEnemySourceCatalog } from '../../src/host/enemy-catalog.js';
import { loadEnemyAuthoringSourceCatalog } from '../../src/host/enemy-authoring-catalog.js';
import { createEnemyAuthoringApplication } from '../../src/host/enemy-authoring-application.js';
import { customMonsterProjectionValue } from '../../src/shared/custom-monster-presentation.js';
import {
  enemyVersionIdentityValue,
  type EnemyPatchStage,
} from '../../src/shared/enemy-authoring.js';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import { createEnemyLibraryApplication } from '../../src/host/enemy-library-application.js';
import { validateEnemyAuthoringSource } from '../../src/host/enemy-authoring-application.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

/** Actual host/SQLite/source DTOs, detached before closing. This does not claim a network boundary. */
export async function createCustomMonsterClientFixture(
  adviser = false,
  options: { captureSavedV1?: boolean; captureStatRoll?: boolean } = {},
) {
  const baseline = await loadLocalCharacterExportBaseline(process.cwd());
  const common = await loadNpcAuthoringSourceCatalog(process.cwd());
  const catalog = loadEnemyAuthoringSourceCatalog(process.cwd(), common);
  const librarySource = loadEnemySourceCatalog(process.cwd(), baseline);
  const f = createEnemyLibraryFixture(librarySource, baseline);
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
  const statRollSnapshots: Record<string, unknown> | null =
    options.captureStatRoll === true ? {} : null;
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
  const roll = () => {
    const source = project(),
      binding = source.context.monsterStatRoll?.binding;
    assert(binding !== undefined);
    const request = {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      workflowCommandId: 'UI-CMD-MONSTER-STATS-ROLL-ONCE',
      role: 'gm',
      commandId: randomUUID(),
      expectedRevisions: {
        stateRevision: source.stateRevision,
        projectionRevision: source.projectionRevision,
        actorVisibilityRevision: source.actorVisibilityRevision,
      },
      payload: {
        campaignId: source.campaignId,
        creationAttemptId: binding.attemptId,
        expectedAttemptRevision: source.context.attemptOrNull?.revision,
        attemptId: binding.attemptId,
        monsterDraftId: binding.attemptId,
        originFormId: binding.originFormId,
        returnFormId: binding.originFormId,
        versionBindingOrNull: binding.versionBindingOrNull,
      },
    };
    const result = app().command(request);
    return { source, request, receipt: result.receipt, destination: project() };
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
    if (statRollSnapshots !== null) {
      patch('MONSTER_STAT_DRAFT', { sourceActionKey: 'ENM-012::CTA::005', draftOrNull: null });
      statRollSnapshots['creationRoll'] = roll();
      patch('MONSTER_STAT_DRAFT', {
        sourceActionKey: 'ENM-012::CTA::002',
        draftOrNull: {
          baseStats: { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 },
          massKg: 5,
          ageYears: 1,
          baseMaxHP: 7,
        },
      });
      statRollSnapshots['creationReceipt'] = project();
      f.nav('ENM-019::CTA::001');
      statRollSnapshots['creationCorrected'] = project();
    }
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
    let savedOrNull: ReturnType<typeof customMonsterProjectionValue> | null = null;
    if (options.captureSavedV1 === true || statRollSnapshots !== null) {
      const current = f.readCurrent().viewOrNull,
        attempt = current?.enemyAuthoring?.attemptOrNull;
      assert(current && attempt?.kind === 'CUSTOM_MONSTER');
      const request = {
        messageType: 'command.request',
        protocolVersion: 1,
        commandKind: 'workflow-command',
        workflowCommandId: 'UI-CMD-ENEMY-COMMIT-V1',
        role: 'gm',
        commandId: randomUUID(),
        expectedRevisions: {
          stateRevision: current.stateRevision,
          projectionRevision: current.projectionRevision,
          actorVisibilityRevision: current.actorVisibilityRevision,
        },
        payload: {
          campaignId: f.scope.campaignId,
          creationAttemptId: attempt.attemptId,
          expectedAttemptRevision: attempt.revision,
        },
      };
      const original = app().command(request);
      const bytes = f.db.serialize();
      savedOrNull = project();
      assert.equal(savedOrNull.formId, 'ENM-020');
      assert.equal(savedOrNull.versionConfigurationSummaryOrNull, null);
      assert.deepEqual(project(), savedOrNull);
      assert.deepEqual(app().command(request), { ...original, replayed: true });
      assert(f.db.serialize().equals(bytes));
      if (statRollSnapshots !== null) {
        const oldRows = f.db.prepare('SELECT * FROM campaign_enemy_version ORDER BY rowid').all();
        const library = () =>
          createEnemyLibraryApplication({
            database: f.db,
            scope: f.scope,
            catalog: librarySource,
            baseline,
            validateOwner: () => undefined,
            readCurrent: f.readCurrent,
            readUsers: () => {
              let rows: ReturnType<typeof validateEnemyAuthoringSource> = [];
              f.readCurrent((source, state) => {
                rows = validateEnemyAuthoringSource(f.db, source, state, catalog, baseline);
              });
              return rows.map((row) => ({ ...row.identity, displayName: row.sheet.identity.name }));
            },
          });
        const nav = (
          actionKey: 'ENM-020::CTA::002' | 'ENM-001::CTA::008' | 'ENM-019::CTA::002',
        ) => {
          const view = f.readCurrent().viewOrNull;
          assert(view !== null);
          library().navigation({
            messageType: 'navigation.form-action',
            protocolVersion: 2,
            navigationRequestId: randomUUID(),
            sourceFormId: view.formId,
            expectedProjectionRevision: view.projectionRevision,
            actionKey,
          });
        };
        nav('ENM-020::CTA::002');
        const view = f.readCurrent().viewOrNull;
        assert(view !== null);
        const identity = enemyVersionIdentityValue(original.receipt.result.committedVersionOrNull);
        library().select({
          messageType: 'network.enemy-selection.replace',
          protocolVersion: 3,
          operationId: randomUUID(),
          contextId: f.scope.gmLocalContextId,
          campaignId: f.scope.campaignId,
          sourceFormId: 'ENM-001',
          activeTab: 'MONSTERS',
          selectionOrNull: null,
          userSelectionOrNull: identity,
          expectedRevisions: {
            stateRevision: view.stateRevision,
            projectionRevision: view.projectionRevision,
            actorVisibilityRevision: view.actorVisibilityRevision,
          },
        });
        nav('ENM-001::CTA::008');
        patch('VERSION_CONFIGURATION', {
          operation: 'SET_REASON',
          reason: 'Проверка новой квитанции версии',
        });
        statRollSnapshots['versionBefore'] = project();
        patch('MONSTER_STAT_DRAFT', { sourceActionKey: 'ENM-017::CTA::006', draftOrNull: null });
        statRollSnapshots['versionRoll'] = roll();
        patch('MONSTER_STAT_DRAFT', {
          sourceActionKey: 'ENM-017::CTA::007',
          draftOrNull: {
            baseStats: { S: 35, D: 35, M: 35, Z: 35, I: 35, W: 35, C: 35 },
            massKg: 5.1,
            ageYears: 17,
            baseMaxHP: 42,
          },
        });
        statRollSnapshots['versionReceipt'] = project();
        nav('ENM-019::CTA::002');
        statRollSnapshots['versionCorrected'] = project();
        f.restartFromDisk();
        assert.deepEqual(project(), statRollSnapshots['versionCorrected']);
        assert.deepEqual(
          f.db.prepare('SELECT * FROM campaign_enemy_version ORDER BY rowid').all(),
          oldRows,
        );
        statRollSnapshots['immutableVersionRowsUnchanged'] = true;
      }
    }
    return {
      identity,
      stats,
      physics,
      attack,
      symbiont,
      acquired,
      full,
      savedOrNull,
      statRollSnapshots,
      ownerDeviceId: f.scope.ownerDeviceId,
    };
  } finally {
    f.close();
  }
}

/** Node owning host produces actual JSON; the browser realm never resolves baseline Git/file URLs. */
export async function loadMonsterStatRollClientSnapshots() {
  const result = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      resolve('tests/fixtures/custom-monster-client.ts'),
      '--monster-stat-snapshots',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000 },
  );
  return JSON.parse(result.stdout) as unknown;
}
if (process.argv[2] === '--monster-stat-snapshots') {
  createCustomMonsterClientFixture(false, { captureStatRoll: true }).then(
    (value) => process.stdout.write(JSON.stringify(value)),
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
