import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import type { ActionKey } from '@generated/types/atlas.js';
import type { JsonObject } from '../../src/shared/wire-protocol.js';
import { enemyCompositionReaders as r } from '../../src/shared/enemy-composition-codec.js';
import { wireCodecPrimitives as w } from '../../src/shared/wire-codec.js';
import {
  enemyAuthoringProjectionValue,
  enemyVersionIdentityValue,
  type EnemyWorkflowRequest,
} from '../../src/shared/enemy-authoring.js';
import { enemyLibraryProjectionValue } from '../../src/shared/enemy-library.js';
import { enemyVersionConfigurationInputValue } from '../../src/shared/enemy-version-configuration.js';
import { openPersistenceDatabase } from '../../src/persistence/database.js';
import { readGmRequestReviewSourceWith } from '../../src/persistence/network-device-request.js';
import { readGmRequestReviewViewStateInTransaction } from '../../src/persistence/campaign-creation.js';
import { readEnemyVersions } from '../../src/persistence/enemy-authoring-store.js';
import { loadLocalCharacterExportBaseline } from '../../src/host/local-character-export.js';
import { loadNpcAuthoringSourceCatalog } from '../../src/host/npc-catalog.js';
import { loadEnemySourceCatalog } from '../../src/host/enemy-catalog.js';
import { loadEnemyAuthoringSourceCatalog } from '../../src/host/enemy-authoring-catalog.js';
import {
  createEnemyAuthoringApplication,
  validateEnemyAuthoringSource,
} from '../../src/host/enemy-authoring-application.js';
import {
  createEnemyLibraryApplication,
  validateEnemyLibrarySource,
} from '../../src/host/enemy-library-application.js';

/** Genuine old disk source + current host/QUEUE projections. Owner KDF is bypassed; no LAN/WS claim. */
export async function createEnemyVersionClientFixture(
  kind: 'SENTIENT' | 'CUSTOM_MONSTER',
  options: {
    legacy?: boolean;
    afterReason?: (h: {
      database: Database.Database;
      checkedRead: () => unknown;
      structuralRead: () => ReturnType<typeof readGmRequestReviewViewStateInTransaction>;
      previewCommandId: string;
    }) => void;
    observe?: (h: {
      command: (data: JsonObject) => unknown;
      snapshot: () => Buffer;
      preview: ReturnType<typeof enemyAuthoringProjectionValue>;
    }) => void;
  } = {},
) {
  const baseline = await loadLocalCharacterExportBaseline(process.cwd());
  const common = await loadNpcAuthoringSourceCatalog(process.cwd());
  const library = loadEnemySourceCatalog(process.cwd(), baseline);
  const catalog = loadEnemyAuthoringSourceCatalog(process.cwd(), common);
  const folder =
    kind === 'SENTIENT'
      ? options.legacy
        ? 'enemy-empty-v1'
        : 'enemy-composed-v1'
      : 'enemy-custom-v1';
  const file =
    kind === 'SENTIENT'
      ? options.legacy
        ? 'schema21-empty-v1.sqlite.gz'
        : 'schema21-composed-v1.sqlite.gz'
      : 'schema22-custom-v1.sqlite.gz';
  const metadata = r.record(
    JSON.parse(readFileSync(join('tests/fixtures', folder, 'metadata.json'), 'utf8')),
    '$.metadata',
  );
  const savedScope = r.record(metadata['scope'], '$.scope');
  const scope = {
    campaignId: r.uuid(savedScope['campaignId'], '$.campaignId'),
    gmLocalContextId: r.uuid(savedScope['gmLocalContextId'], '$.gmLocalContextId'),
    ownerDeviceId: r.uuid(savedScope['ownerDeviceId'], '$.ownerDeviceId'),
  };
  const directory = mkdtempSync(join(tmpdir(), 'symbiosis-version-controls-'));
  const filename = join(directory, 'campaign.sqlite');
  let db: Database.Database | undefined;
  try {
    writeFileSync(filename, gunzipSync(readFileSync(join('tests/fixtures', folder, file))));
    db = openPersistenceDatabase(filename);
    const database = db;
    const savedRows = () =>
      Object.fromEntries(
        [
          'campaign_enemy_template',
          'campaign_enemy_version',
          'campaign_enemy_history',
          'campaign_enemy_current_version',
        ].map((table) => [
          table,
          database.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(),
        ]),
      );
    const oldRows = JSON.stringify(savedRows());
    const readCurrent = (
      observe: Parameters<typeof readGmRequestReviewSourceWith>[3] = () => undefined,
    ) =>
      readGmRequestReviewSourceWith(
        database,
        scope,
        () => undefined,
        (source, state) => {
          validateEnemyLibrarySource(source, state, library, baseline);
          validateEnemyAuthoringSource(database, source, state, catalog, baseline);
          return observe(source, state);
        },
      ).source;
    const app = createEnemyAuthoringApplication({
      database,
      scope,
      catalog,
      baseline,
      readCurrent,
      validateOwner: () => undefined,
    });
    const lib = createEnemyLibraryApplication({
      database,
      scope,
      catalog: library,
      baseline,
      readCurrent,
      validateOwner: () => undefined,
      readUsers: () => {
        let versions: ReturnType<typeof readEnemyVersions> = [];
        readCurrent((source, state) => {
          versions = readEnemyVersions(database, source.scope, state.events);
        });
        return versions
          .filter(
            (version) =>
              !versions.some(
                (other) =>
                  other.identity.templateId === version.identity.templateId &&
                  other.identity.version > version.identity.version,
              ),
          )
          .map((row) => ({ ...row.identity, displayName: row.sheet.identity.name }));
      },
    });
    const nav = (actionKey: ActionKey) => {
      const view = readCurrent().viewOrNull;
      if (view === null) throw new Error('Missing owning view');
      return lib.navigation({
        messageType: 'navigation.form-action',
        protocolVersion: 2,
        navigationRequestId: randomUUID(),
        sourceFormId: view.formId,
        expectedProjectionRevision: view.projectionRevision,
        actionKey,
      });
    };
    const back: Readonly<Record<string, ActionKey>> = {
      'ENM-009': 'ENM-009::CTA::001',
      'ENM-008': 'ENM-008::CTA::001',
      'ENM-007': 'ENM-007::CTA::005',
      'ENM-006': 'ENM-006::CTA::001',
      'ENM-005': 'ENM-005::CTA::004',
      'ENM-013': 'ENM-013::CTA::004',
      'ENM-012': 'ENM-012::CTA::006',
      'ENM-011': 'ENM-011::CTA::003',
    };
    for (let count = 0; readCurrent().viewOrNull?.formId !== 'ENM-001' && count < 6; count++) {
      const form = readCurrent().viewOrNull?.formId,
        action = form === undefined ? undefined : back[form];
      if (action === undefined) throw new Error('No source-safe exit for ' + form);
      nav(action);
    }
    const row = database
      .prepare<[], { record_json: string }>(
        'SELECT record_json FROM campaign_enemy_version WHERE version=1',
      )
      .get();
    if (row === undefined) throw new Error('Missing actual old V1');
    const saved = r.record(JSON.parse(row.record_json), '$.saved');
    const identity = enemyVersionIdentityValue(saved['identity']);
    const view = readCurrent().viewOrNull;
    if (view === null) throw new Error('Missing library source');
    lib.select({
      messageType: 'network.enemy-selection.replace',
      protocolVersion: 3,
      operationId: randomUUID(),
      contextId: scope.gmLocalContextId,
      campaignId: scope.campaignId,
      sourceFormId: 'ENM-001',
      activeTab: kind === 'SENTIENT' ? 'SENTIENT_ENEMIES' : 'MONSTERS',
      selectionOrNull: null,
      userSelectionOrNull: identity,
      expectedRevisions: {
        stateRevision: view.stateRevision,
        projectionRevision: view.projectionRevision,
        actorVisibilityRevision: view.actorVisibilityRevision,
      },
    });
    const librarySnapshot = enemyLibraryProjectionValue(lib.project().base.roleFilteredPayload);
    nav('ENM-001::CTA::008');
    const initial = enemyAuthoringProjectionValue(app.project().base.roleFilteredPayload);
    const attempt = initial.context.attemptOrNull;
    if (attempt === null || initial.formId !== 'ENM-017')
      throw new Error('Missing actual version editor');
    const input = enemyVersionConfigurationInputValue(
      attempt.kind === 'SENTIENT'
        ? (() => {
            if (
              attempt.baseStatsOrNull === null ||
              attempt.buildOrNull === null ||
              attempt.baseStatsOrNull.S >= 35
            )
              throw new Error('Expected genuine input with room for one source-legal S edit');
            return {
              kind: attempt.kind,
              initialInput: {
                baseStats: { ...attempt.baseStatsOrNull, S: attempt.baseStatsOrNull.S + 1 },
                build: attempt.buildOrNull,
              },
              advisorSkills: [],
            };
          })()
        : {
            kind: attempt.kind,
            advisorSkills: [
              { skillKey: 'LEARNING', targetBonus: 7 },
              { skillKey: 'ACROBATICS', targetBonus: 1 },
            ],
          },
    );
    const current = readCurrent().viewOrNull;
    if (current === null) throw new Error('Missing current source');
    const request: EnemyWorkflowRequest = {
      messageType: 'command.request',
      protocolVersion: 1,
      commandKind: 'workflow-command',
      role: 'gm',
      commandId: randomUUID(),
      workflowCommandId: 'UI-CMD-ENEMY-DRAFT-PATCH',
      expectedRevisions: {
        stateRevision: current.stateRevision,
        projectionRevision: current.projectionRevision,
        actorVisibilityRevision: current.actorVisibilityRevision,
      },
      payload: {
        campaignId: scope.campaignId,
        creationAttemptId: attempt.attemptId,
        expectedAttemptRevision: attempt.revision,
        stage: 'VERSION_CONFIGURATION',
        data: structuredClone(
          w.jsonObject({ operation: 'PREVIEW_REPLACEMENT', input }, '$.preview'),
        ),
      },
    };
    app.command(request);
    const preview = enemyAuthoringProjectionValue(app.project().base.roleFilteredPayload);
    if (
      JSON.stringify(savedRows()) !== oldRows ||
      database.prepare('PRAGMA foreign_key_check').all().length !== 0
    )
      throw new Error('Preview changed immutable enemy rows');
    const command = (data: JsonObject) => {
      const current = readCurrent().viewOrNull;
      const attempt = current?.enemyAuthoring?.attemptOrNull;
      if (current == null || attempt == null) throw new Error('Missing current fixture attempt');
      return app.command({
        ...request,
        commandId: randomUUID(),
        expectedRevisions: {
          stateRevision: current.stateRevision,
          projectionRevision: current.projectionRevision,
          actorVisibilityRevision: current.actorVisibilityRevision,
        },
        payload: {
          ...request.payload,
          creationAttemptId: attempt.attemptId,
          expectedAttemptRevision: attempt.revision,
          data,
        },
      });
    };
    options.observe?.({ command, snapshot: () => database.serialize(), preview });
    const reasonData = { operation: 'SET_REASON', reason: 'Уточнение описания новой версии' };
    command(reasonData);
    const reasonApplied = enemyAuthoringProjectionValue(app.project().base.roleFilteredPayload);
    options.afterReason?.({
      database,
      checkedRead: readCurrent,
      structuralRead: () =>
        database
          .transaction(() => readGmRequestReviewViewStateInTransaction(database, scope))
          .deferred(),
      previewCommandId: request.commandId,
    });
    const immutableEnemyRowsUnchanged = JSON.stringify(savedRows()) === oldRows;
    if (
      !immutableEnemyRowsUnchanged ||
      database.prepare('PRAGMA foreign_key_check').all().length !== 0
    )
      throw new Error('Fixture command changed immutable enemy rows');
    return {
      librarySnapshot,
      initial,
      preview,
      input,
      reasonData,
      reasonApplied,
      ownerDeviceId: scope.ownerDeviceId,
      previewRequest: request,
      immutableEnemyRowsUnchanged,
    };
  } finally {
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Vite's HTTP import.meta URL cannot validate old on-disk baselines. Produce actual host data in Node. */
export async function loadEnemyVersionClientSnapshots(
  kind: 'SENTIENT' | 'CUSTOM_MONSTER',
  legacy = false,
) {
  const { stdout: text } = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      resolve('tests/fixtures/enemy-version-client.ts'),
      '--version-client-snapshots',
      kind,
      legacy ? 'legacy' : 'modern',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
  );
  const raw = r.record(JSON.parse(text), '$.actualHostSnapshots');
  w.literal(raw['immutableEnemyRowsUnchanged'], true, '$.immutableRows');
  w.literal(r.record(raw['reasonData'], '$.reasonData')['operation'], 'SET_REASON', '$.operation');
  return {
    librarySnapshot: enemyLibraryProjectionValue(raw['librarySnapshot']),
    initial: enemyAuthoringProjectionValue(raw['initial']),
    preview: enemyAuthoringProjectionValue(raw['preview']),
    reasonApplied: enemyAuthoringProjectionValue(raw['reasonApplied']),
    input: enemyVersionConfigurationInputValue(raw['input']),
    reasonData: {
      operation: 'SET_REASON',
      reason: r.text(r.record(raw['reasonData'], '$.reasonData')['reason'], '$.reason'),
    },
    ownerDeviceId: r.uuid(raw['ownerDeviceId'], '$.ownerDeviceId'),
    immutableEnemyRowsUnchanged: true,
  };
}
if (process.argv[2] === '--version-client-snapshots') {
  const kind = process.argv[3];
  if (kind !== 'SENTIENT' && kind !== 'CUSTOM_MONSTER') throw new Error('Unknown snapshot kind');
  const mode = process.argv[4];
  if (mode !== 'legacy' && mode !== 'modern') throw new Error('Unknown snapshot mode');
  createEnemyVersionClientFixture(kind, { legacy: mode === 'legacy' }).then(
    (result) => process.stdout.write(JSON.stringify(result)),
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
