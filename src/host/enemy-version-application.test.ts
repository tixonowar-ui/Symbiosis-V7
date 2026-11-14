import { ENEMY_AUTHORING_SOURCE_SEALS } from './enemy-authoring-source-seals.js';
import { CUSTOM_MONSTER_PLACEHOLDER } from '@shared/custom-monster.js';
import {
  ENEMY_PLACEHOLDER,
  ENEMY_AUTHORING_WORKFLOWS,
  isEnemyAuthoringForm,
} from '@shared/enemy-authoring.js';
import * as versionPreparation from './enemy-version-preparation.js';
import * as sentientPreparation from './enemy-composition-preparation.js';
import * as monsterPreparation from './custom-monster-preparation.js';
import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';
import {
  createLocalGmContext,
  readActiveLocalGmContext,
  type CampaignPrivateOwnerValidator,
} from '../persistence/campaign-creation.js';
import type { EnemyInitialSkillPlan } from '@shared/enemy-skill-plan.js';
import {
  campaignCreationHash,
  readGmRequestReviewViewStateInTransaction,
} from '../persistence/campaign-creation.js';
import { networkApplicationStorage as storage } from '../persistence/network-local-application.js';
import { createEnemyVersionClientFixture } from '../../tests/fixtures/enemy-version-client.js';
import { randomUUID, randomInt } from 'node:crypto';
import type * as NodeCrypto from 'node:crypto';
import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it, vi } from 'vitest';
import type { ActionKey } from '@generated/types/atlas.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import { enemyCompositionReaders as r } from '@shared/enemy-composition-codec.js';
import {
  enemyVersionIdentityValue,
  enemyAuthoringProjectionValue,
  enemyAuthoringContextValue,
  type EnemyWorkflowRequest,
  type EnemyPatchStage,
} from '@shared/enemy-authoring.js';
import { openPersistenceDatabase } from '../persistence/database.js';
import { readGmRequestReviewSourceWith } from '../persistence/network-device-request.js';
import { readEnemyVersions } from '../persistence/enemy-authoring-store.js';
import { loadLocalCharacterExportBaseline } from './local-character-export.js';
import { loadNpcAuthoringSourceCatalog } from './npc-catalog.js';
import { loadEnemySourceCatalog } from './enemy-catalog.js';
import { loadEnemyAuthoringSourceCatalog } from './enemy-authoring-catalog.js';
import {
  createEnemyAuthoringApplication,
  validateEnemyAuthoringSource,
} from './enemy-authoring-application.js';
import {
  createEnemyLibraryApplication,
  validateEnemyLibrarySource,
} from './enemy-library-application.js';
import { wireCodecPrimitives as w } from '@shared/wire-codec.js';
import { calculateSkillStageStats } from '../domain/rules/skill-stage/stats.js';
import {
  enemyBrowserWorkflow,
  enemyBrowserReceipt,
  enemyBrowserDestination,
} from '../web/forms/enm/enemy-authoring-application.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});
const json = (value: unknown): JsonObject => structuredClone(w.jsonObject(value, '$.testPayload'));

let common: Awaited<ReturnType<typeof loadNpcAuthoringSourceCatalog>>;
let baseline: Awaited<ReturnType<typeof loadLocalCharacterExportBaseline>>;
let library: ReturnType<typeof loadEnemySourceCatalog>;
let catalog: ReturnType<typeof loadEnemyAuthoringSourceCatalog>;
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  common = await loadNpcAuthoringSourceCatalog(process.cwd());
  library = loadEnemySourceCatalog(process.cwd(), baseline);
  catalog = loadEnemyAuthoringSourceCatalog(process.cwd(), common);
});

for (const [folder, file, kind, variant] of [
  ['enemy-composed-v1', 'schema21-composed-v1.sqlite.gz', 'SENTIENT', 'COPY'],
  ['enemy-composed-v1', 'schema21-composed-v1.sqlite.gz', 'SENTIENT', 'SOURCE'],
  ['enemy-custom-v1', 'schema22-custom-v1.sqlite.gz', 'CUSTOM_MONSTER', 'SOURCE'],
  ['enemy-composed-v1', 'schema21-composed-v1.sqlite.gz', 'SENTIENT', 'REGISTRY'],
  ['enemy-custom-v1', 'schema22-custom-v1.sqlite.gz', 'CUSTOM_MONSTER', 'REGISTRY'],
  ['enemy-composed-v1', 'schema21-composed-v1.sqlite.gz', 'SENTIENT', 'FAULTS'],
  ['enemy-custom-v1', 'schema22-custom-v1.sqlite.gz', 'CUSTOM_MONSTER', 'FAULTS'],
  ['enemy-composed-v1', 'schema21-composed-v1.sqlite.gz', 'SENTIENT', 'NEGATIVE'],
  ['enemy-custom-v1', 'schema22-custom-v1.sqlite.gz', 'CUSTOM_MONSTER', 'NEGATIVE'],
  ['enemy-composed-v1', 'schema21-composed-v1.sqlite.gz', 'SENTIENT', 'MECHANICAL'],
  ['enemy-custom-v1', 'schema22-custom-v1.sqlite.gz', 'CUSTOM_MONSTER', 'COPY'],
  ['enemy-empty-v1', 'schema21-empty-v1.sqlite.gz', 'SENTIENT', 'CANCELED_FREE'],
  ['enemy-empty-v1', 'schema21-empty-v1.sqlite.gz', 'SENTIENT', 'CANCELED_ZERO_FREE'],
  ['enemy-custom-v1', 'schema22-custom-v1.sqlite.gz', 'CUSTOM_MONSTER', 'CANCELED_CARD'],
  ['enemy-empty-v1', 'schema21-empty-v1.sqlite.gz', 'SENTIENT', 'CANCELED_SENTIENT_CARD'],
] as const) {
  it(
    variant === 'SOURCE'
      ? `refuses changed ${kind} source inputs and future SQL or owning-prefix witnesses after later NAV and disk reopen`
      : variant === 'REGISTRY'
        ? `retains schema23 proof for an unpatched cancelled ${kind} version NAV after leaving ENM`
        : variant === 'FAULTS'
          ? `rolls back reached version, history and pointer SQL faults for ${kind} N+1 before exact retry and physical replay`
          : variant === 'NEGATIVE'
            ? `refuses changed, foreign, stale and authority-lost ${kind} N+1 commands before fresh preparation and preserves exact historical replay`
            : variant === 'MECHANICAL'
              ? 'retains N+1 mixed payments and permanent losses, and recomputes GROSS only from an explicitly replaced initial basis'
              : variant === 'COPY'
                ? `appends an actual full ${folder} N+1 and physically replays the original V1 receipt without rewriting old records`
                : variant === 'CANCELED_FREE'
                  ? 'retains canceled same-template R6, requires a truthful legacy upgrade and reuses it without another roll before full N+1'
                  : variant === 'CANCELED_ZERO_FREE'
                    ? 'retains an actual canceled zero R6 loss while copying and renaming legacy PURE without upgrading ABSENT accounting'
                    : variant === 'CANCELED_CARD'
                      ? 'preserves canceled CUSTOM acquisition and first fill, carries unconfigured own choices through NONE V2, then explicitly fills the same card in V3'
                      : 'distinguishes canceled SENTIENT FINISH from real body fill and retains the same card and suppression across explicit inactive and active N+1 configurations',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'symbiosis-enemy-version-'));
      const filename = join(directory, 'campaign.sqlite');
      const root = join('tests/fixtures', folder);
      const metadata = r.record(
        JSON.parse(readFileSync(join(root, 'metadata.json'), 'utf8')),
        '$.metadata',
      );
      const rawScope = r.record(metadata['scope'], '$.scope');
      const scope = {
        campaignId: r.uuid(rawScope['campaignId'], '$.campaignId'),
        gmLocalContextId: r.uuid(rawScope['gmLocalContextId'], '$.gmLocalContextId'),
        ownerDeviceId: r.uuid(rawScope['ownerDeviceId'], '$.ownerDeviceId'),
      };
      writeFileSync(filename, gunzipSync(readFileSync(join(root, file))));
      let db = openPersistenceDatabase(filename);
      const oldRows = () => ({
        version: db.prepare('SELECT * FROM campaign_enemy_version WHERE version=1').all(),
        history: db
          .prepare(
            'SELECT * FROM campaign_enemy_history WHERE version_id IN (SELECT version_id FROM campaign_enemy_version WHERE version=1)',
          )
          .all(),
        template: db.prepare('SELECT * FROM campaign_enemy_template').all(),
      });
      const readCurrent = (
        observe: Parameters<typeof readGmRequestReviewSourceWith>[3] = () => undefined,
      ) =>
        readGmRequestReviewSourceWith(
          db,
          scope,
          () => undefined,
          (source, state) => {
            validateEnemyLibrarySource(source, state, library, baseline);
            validateEnemyAuthoringSource(db, source, state, catalog, baseline);
            return observe(source, state);
          },
        ).source;
      const app = () =>
        createEnemyAuthoringApplication({
          database: db,
          scope,
          catalog,
          baseline,
          validateOwner: () => undefined,
          readCurrent,
        });
      const lib = () =>
        createEnemyLibraryApplication({
          database: db,
          scope,
          catalog: library,
          baseline,
          validateOwner: () => undefined,
          readCurrent,
          readUsers: () => {
            let versions: ReturnType<typeof readEnemyVersions> = [];
            readCurrent((source, state) => {
              versions = readEnemyVersions(db, source.scope, state.events);
            });
            return versions
              .filter(
                (row) =>
                  !versions.some(
                    (other) =>
                      other.identity.templateId === row.identity.templateId &&
                      other.identity.version > row.identity.version,
                  ),
              )
              .map((row) => ({ ...row.identity, displayName: row.sheet.identity.name }));
          },
        });
      const nav = (actionKey: ActionKey) => {
        const view = readCurrent().viewOrNull;
        if (view === null) throw new Error('Missing owning queue view');
        return lib().navigation({
          messageType: 'navigation.form-action',
          protocolVersion: 2,
          navigationRequestId: randomUUID(),
          sourceFormId: view.formId,
          expectedProjectionRevision: view.projectionRevision,
          actionKey,
        });
      };
      const request = (
        stage: EnemyPatchStage | null,
        data: JsonObject = {},
      ): EnemyWorkflowRequest => {
        const view = readCurrent().viewOrNull;
        const attempt = view?.enemyAuthoring?.attemptOrNull;
        if (view == null || attempt == null) throw new Error('Missing bound attempt');
        return {
          messageType: 'command.request',
          protocolVersion: 1,
          commandKind: 'workflow-command',
          role: 'gm',
          commandId: randomUUID(),
          workflowCommandId:
            stage === null ? 'UI-CMD-ENEMY-NEW-VERSION' : 'UI-CMD-ENEMY-DRAFT-PATCH',
          expectedRevisions: {
            stateRevision: view.stateRevision,
            projectionRevision: view.projectionRevision,
            actorVisibilityRevision: view.actorVisibilityRevision,
          },
          payload: {
            campaignId: scope.campaignId,
            creationAttemptId: attempt.attemptId,
            expectedAttemptRevision: attempt.revision,
            ...(stage === null
              ? { reason: view.enemyAuthoring?.versionAttempt?.reason ?? '' }
              : { stage, data }),
          },
        };
      };
      try {
        const original = oldRows();
        // Abandon the independent old open creation attempt through its real existing safe controls.
        const back: Readonly<Record<string, ActionKey>> = {
          'ENM-008': 'ENM-008::CTA::001',
          'ENM-009': 'ENM-009::CTA::001',
          'ENM-007': 'ENM-007::CTA::005',
          'ENM-006': 'ENM-006::CTA::001',
          'ENM-005': 'ENM-005::CTA::004',
          'ENM-013': 'ENM-013::CTA::004',
          'ENM-012': 'ENM-012::CTA::006',
          'ENM-011': 'ENM-011::CTA::003',
        };
        for (let steps = 0; readCurrent().viewOrNull?.formId !== 'ENM-001' && steps < 6; steps++) {
          const form = readCurrent().viewOrNull?.formId;
          const action = form === undefined ? undefined : back[form];
          if (action === undefined) throw new Error('No source safe exit for ' + form);
          nav(action);
        }
        const row = db
          .prepare<[], { record_json: string }>(
            'SELECT record_json FROM campaign_enemy_version WHERE version=1',
          )
          .get();
        if (row === undefined) throw new Error('Missing original version');
        const saved = r.record(JSON.parse(row.record_json), '$.saved');
        const identity = enemyVersionIdentityValue(saved['identity']);
        const view = readCurrent().viewOrNull;
        if (view === null) throw new Error('Missing catalog');
        lib().select({
          messageType: 'network.enemy-selection.replace',
          protocolVersion: 3,
          operationId: randomUUID(),
          contextId: scope.gmLocalContextId,
          campaignId: scope.campaignId,
          sourceFormId: 'ENM-001',
          activeTab: kind === 'SENTIENT' ? 'SENTIENT_ENEMIES' : 'MONSTERS',
          expectedRevisions: {
            stateRevision: view.stateRevision,
            projectionRevision: view.projectionRevision,
            actorVisibilityRevision: view.actorVisibilityRevision,
          },
          selectionOrNull: null,
          userSelectionOrNull: identity,
        });
        nav('ENM-001::CTA::008');
        expect(readCurrent().viewOrNull?.formId).toBe('ENM-017');
        const copied = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
        expect(copied).toMatchObject({ kind, revision: 0 });
        expect({
          ...copied,
          attemptId: r.record(saved['attempt'], '$.attempt')['attemptId'],
          revision: r.record(saved['attempt'], '$.attempt')['revision'],
        }).toEqual(saved['attempt']);
        let expectedMechanicalPlan: EnemyInitialSkillPlan | null = null;
        let retainedRngCount: number | null = null;
        let expectedSignedBody: { S: number; M: number; Z: number } | null = null;
        if (variant === 'REGISTRY') {
          nav('ENM-017::CTA::005');
          nav('ENM-020::CTA::002');
          nav('ENM-001::CTA::013');
          expect(readCurrent().viewOrNull?.formId).toBe('GM-001');
          const structural = db
            .transaction(() => readGmRequestReviewViewStateInTransaction(db, scope))
            .deferred();
          expect(
            structural.events.some(
              (event) =>
                event.mutation.kind === 'ENEMY_AUTHORING' &&
                event.mutation.cause.request.payload.stage === 'VERSION_CONFIGURATION',
            ),
          ).toBe(false);
          expect(
            structural.events.some(
              (event) =>
                event.mutation.kind === 'NAV' &&
                event.mutation.request.actionKey === 'ENM-001::CTA::008',
            ),
          ).toBe(true);
          expect(db.prepare('SELECT MAX(version) n FROM schema_migration').get()).toEqual({
            n: 23,
          });
          expect(db.prepare('DELETE FROM schema_migration WHERE version=23').run().changes).toBe(1);
          expect(db.prepare('SELECT MAX(version) n FROM schema_migration').get()).toEqual({
            n: 22,
          });
          const bytes = db.serialize();
          expect(() => readCurrent()).toThrow('SOURCE_CHANGED');
          expect(() => app().project()).toThrow('SOURCE_CHANGED');
          expect(db.serialize()).toEqual(bytes);
          expect(oldRows()).toEqual(original);
          return;
        }
        if (variant === 'SOURCE') {
          const cfgSpy = vi.spyOn(versionPreparation, 'prepareEnemyVersionConfiguration');
          const callsFor = (target: unknown) =>
            cfgSpy.mock.calls.filter((args) => admissionJsonEqual(args[3], target)).length;
          try {
            const sourceRoot = join(directory, 'source');
            const paths = new Set<string>(Object.keys(ENEMY_AUTHORING_SOURCE_SEALS));
            const portraits = r
              .list(
                JSON.parse(readFileSync('generated/spec/gm-entity-portraits/catalog.json', 'utf8')),
                '$.portraits',
              )
              .map((value) => r.record(value, '$.portrait'));
            const enemyPortraits = portraits.filter(
              (row) =>
                row['assetKey'] === ENEMY_PLACEHOLDER ||
                row['assetKey'] === CUSTOM_MONSTER_PLACEHOLDER,
            );
            expect(enemyPortraits).toHaveLength(2);
            for (const row of enemyPortraits)
              paths.add(join('generated/media', r.text(row['mediaPath'], '$.mediaPath')));
            for (const path of paths) {
              const dest = join(sourceRoot, path);
              mkdirSync(dirname(dest), { recursive: true });
              copyFileSync(path, dest);
            }
            const copiedCatalog = loadEnemyAuthoringSourceCatalog(sourceRoot, common);
            const scopedApp = createEnemyAuthoringApplication({
              database: db,
              scope,
              catalog: copiedCatalog,
              baseline,
              readCurrent,
              validateOwner: () => undefined,
            });
            const actual = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
            if (actual == null) throw new Error('Missing source candidate');
            const ownChoices = [
              { skillKey: 'LEARNING', targetBonus: 7 },
              { skillKey: 'ACROBATICS', targetBonus: 1 },
            ];
            const input = json(
              actual.kind === 'SENTIENT'
                ? {
                    kind: actual.kind,
                    initialInput: { baseStats: actual.baseStatsOrNull, build: actual.buildOrNull },
                    advisorSkills: ownChoices,
                  }
                : { kind: actual.kind, advisorSkills: ownChoices },
            );
            const positive = request('VERSION_CONFIGURATION', {
              operation: 'PREVIEW_REPLACEMENT',
              input,
            });
            scopedApp.command(positive);
            expect(callsFor(positive)).toBeGreaterThan(0);
            expect(scopedApp.project().base.formId).toBe('ENM-017');
            const currentContext = readCurrent().viewOrNull?.enemyAuthoring;
            const currentAttempt = currentContext?.attemptOrNull;
            const versionState = currentContext?.versionAttempt;
            if (currentAttempt == null || versionState === undefined)
              throw new Error('Missing actual current version coordinates');
            let foreignInput: JsonObject;
            if (currentAttempt.kind === 'SENTIENT')
              foreignInput = { kind: 'CUSTOM_MONSTER', advisorSkills: [] };
            else {
              const oldSentient = new Database(
                gunzipSync(
                  readFileSync('tests/fixtures/enemy-composed-v1/schema21-composed-v1.sqlite.gz'),
                ),
              );
              try {
                const row = oldSentient
                  .prepare<[], { record_json: string }>(
                    'SELECT record_json FROM campaign_enemy_version WHERE version=1',
                  )
                  .get();
                if (row === undefined) throw new Error('Missing genuine SENTIENT V1');
                const saved = r.record(JSON.parse(row.record_json), '$.foreignSaved');
                const attempt = r.record(saved['attempt'], '$.foreignAttempt');
                expect(attempt['kind']).toBe('SENTIENT');
                foreignInput = json({
                  kind: 'SENTIENT',
                  initialInput: {
                    baseStats: attempt['baseStatsOrNull'],
                    build: attempt['buildOrNull'],
                  },
                  advisorSkills: [],
                });
              } finally {
                oldSentient.close();
              }
            }
            const foreignKind = request('VERSION_CONFIGURATION', {
              operation: 'PREVIEW_REPLACEMENT',
              input: foreignInput,
            });
            const foreignBytes = db.serialize();
            // The helper reports ownership; the public guarded boundary normalizes its refusal.
            expect(() =>
              versionPreparation.prepareEnemyVersionConfiguration(
                catalog,
                currentAttempt,
                versionState,
                foreignKind,
                versionState.retainedMandatoryFacts,
              ),
            ).toThrow('FOREIGN_OWNER');
            const directCalls = callsFor(foreignKind);
            expect(directCalls).toBe(1);
            expect(db.serialize()).toEqual(foreignBytes);
            expect(() => app().command(foreignKind)).toThrow('INVALID_INPUT');
            expect(callsFor(foreignKind)).toBeGreaterThan(directCalls);
            // No durable receipt, fact, event or identifier allocation survives the refusal.
            expect(db.serialize()).toEqual(foreignBytes);
            const changedSource = join(sourceRoot, 'generated/spec/character/skills.json');
            const sourceBytes = readFileSync(changedSource);
            const target = request('VERSION_CONFIGURATION', {
              operation: 'SET_REASON',
              reason: 'Не должен сохраниться при изменённом источнике',
            });
            const beforeDrift = db.serialize();
            writeFileSync(changedSource, Buffer.concat([sourceBytes, Buffer.from([10])]));
            expect(() => scopedApp.command(target)).toThrow('INVALID_INPUT');
            expect(callsFor(target)).toBe(0);
            expect(db.serialize()).toEqual(beforeDrift);
            writeFileSync(changedSource, sourceBytes);
            expect(scopedApp.project().base.formId).toBe('ENM-017');
            app().command(
              request('VERSION_CONFIGURATION', {
                operation: 'DISCARD_REPLACEMENT',
                previewCommandId: positive.commandId,
              }),
            );
            const manual = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
            expect(isEnemyAuthoringForm('ENM-018')).toBe(false);
            expect(isEnemyAuthoringForm('ENM-019')).toBe(false);
            expect(app().project().base.availableActionKeys).not.toContain('ENM-017::CTA::006');
            expect(app().project().base.availableActionKeys).not.toContain('ENM-017::CTA::007');
            for (const key of ['ENM-017::CTA::006', 'ENM-017::CTA::007'] as const) {
              const bytes = db.serialize();
              expect(() => nav(key)).toThrow('CORRUPT_STORAGE');
              expect(db.serialize()).toEqual(bytes);
            }
            const forms = r.record(
              JSON.parse(readFileSync('generated/spec/atlas/forms-by-id.json', 'utf8')),
              '$.forms',
            );
            const rollActions = r.record(
              r.record(forms['ENM-018'], '$.rollForm')['actions'],
              '$.rollActions',
            );
            const rollCommands = r.list(
              rollActions['workflowCommandAvailability'],
              '$.rollCommands',
            );
            expect(rollCommands).toHaveLength(1);
            const rollCommandId = r.text(
              r.record(rollCommands[0], '$.rollCommand')['commandId'],
              '$.rollCommandId',
            );
            expect(rollCommandId).toBe('UI-CMD-MONSTER-STATS-ROLL-ONCE');
            expect(ENEMY_AUTHORING_WORKFLOWS).not.toContain(rollCommandId);
            const noRoll = {
              ...request('VERSION_CONFIGURATION', {
                operation: 'SET_REASON',
                reason: 'Недоступный бросок',
              }),
              workflowCommandId: rollCommandId,
            };
            const beforeRoll = db.serialize();
            expect(() => app().command(noRoll)).toThrow('UNRECOGNIZED');
            expect(callsFor(noRoll)).toBe(0);
            expect(db.serialize()).toEqual(beforeRoll);
            if (manual.context.attemptOrNull?.kind === 'CUSTOM_MONSTER') {
              const stats = manual.context.attemptOrNull.statsOrNull;
              if (stats === null) throw new Error('Missing actual manual stats');
              const rollMode = request('MONSTER_STATS', json({ ...stats, statMode: 'ROLL_ONCE' }));
              const bytes = db.serialize();
              expect(() => app().command(rollMode)).toThrow('INVALID_INPUT');
              expect(db.serialize()).toEqual(bytes);
            }
            nav('ENM-017::CTA::005');
            nav('ENM-020::CTA::002');
            const system = (
              kind === 'SENTIENT' ? library.systemTemplates : library.canonicalTemplates
            )[0];
            if (system === undefined) throw new Error('Missing actual supplied system template');
            const choose = (
              selectionOrNull: {
                origin: typeof system.origin;
                templateId: string;
                catalogVersion: string;
                artAssetKey: string;
              } | null,
              userSelectionOrNull: typeof identity | null,
            ) => {
              const view = readCurrent().viewOrNull;
              if (view === null || view.formId !== 'ENM-001')
                throw new Error('Missing real catalogue');
              lib().select({
                messageType: 'network.enemy-selection.replace',
                protocolVersion: 3,
                operationId: randomUUID(),
                contextId: scope.gmLocalContextId,
                campaignId: scope.campaignId,
                sourceFormId: 'ENM-001',
                activeTab: kind === 'SENTIENT' ? 'SENTIENT_ENEMIES' : 'MONSTERS',
                selectionOrNull,
                userSelectionOrNull,
                expectedRevisions: {
                  stateRevision: view.stateRevision,
                  projectionRevision: view.projectionRevision,
                  actorVisibilityRevision: view.actorVisibilityRevision,
                },
              });
            };
            choose(
              {
                origin: system.origin,
                templateId: system.templateId,
                catalogVersion: system.catalogVersion,
                artAssetKey: system.artAssetKey,
              },
              null,
            );
            expect(lib().project().base.availableActionKeys).not.toContain('ENM-001::CTA::008');
            const beforeSystem = db.serialize();
            expect(() => nav('ENM-001::CTA::008')).toThrow('CORRUPT_STORAGE');
            expect(db.serialize()).toEqual(beforeSystem);
            choose(null, identity);
            nav('ENM-001::CTA::008');
            app().command(
              request('VERSION_CONFIGURATION', {
                operation: 'SET_REASON',
                reason: 'Неизменная копия для проверки owning prefix',
              }),
            );
            app().command(request(null));
            nav('ENM-020::CTA::002');
            nav('ENM-001::CTA::008');
            const futureNav =
              readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.origin.navigationRequestId;
            if (futureNav === undefined) throw new Error('Missing actual later NAV');
            const currentRequest = request('VERSION_CONFIGURATION', {
              operation: 'SET_REASON',
              reason: 'Не должен сохраниться после подмены',
            });
            const versionRow = db
              .prepare<
                [string],
                { version_id: string; record_json: string; record_sha256: string }
              >(
                'SELECT version_id,record_json,record_sha256 FROM campaign_enemy_version WHERE template_id=? AND version=2',
              )
              .get(identity.templateId);
            if (versionRow === undefined) throw new Error('Missing actual V2');
            const version = r.record(JSON.parse(versionRow.record_json), '$.version');
            const source = r.record(version['versionSource'], '$.versionSource');
            const origin = r.record(source['origin'], '$.origin');
            expect(origin['navigationRequestId']).not.toBe(futureNav);
            Reflect.set(origin, 'navigationRequestId', futureNav);
            const historyRow = db
              .prepare<
                [string],
                { history_id: string; record_json: string; record_sha256: string }
              >(
                'SELECT history_id,record_json,record_sha256 FROM campaign_enemy_history WHERE version_id=?',
              )
              .get(versionRow.version_id);
            if (historyRow === undefined) throw new Error('Missing actual V2 history');
            const history = r.record(JSON.parse(historyRow.record_json), '$.history');
            Reflect.set(
              r.record(history['provenance'], '$.provenance'),
              'versionSource',
              structuredClone(source),
            );
            const queueBefore = db
              .prepare('SELECT * FROM gm_request_queue_event ORDER BY event_index')
              .all();
            db.prepare(
              'UPDATE campaign_enemy_version SET record_json=?,record_sha256=? WHERE version_id=?',
            ).run(
              storage.canonical(version),
              storage.sha(storage.canonical(version)),
              versionRow.version_id,
            );
            db.prepare(
              'UPDATE campaign_enemy_history SET record_json=?,record_sha256=? WHERE history_id=?',
            ).run(
              storage.canonical(history),
              storage.sha(storage.canonical(history)),
              historyRow.history_id,
            );
            db.close();
            db = openPersistenceDatabase(filename);
            expect(db.memory).toBe(false);
            const structural = db
              .transaction(() => readGmRequestReviewViewStateInTransaction(db, scope))
              .deferred();
            expect(structural.viewOrNull?.formId).toBe('ENM-017');
            expect(
              structural.viewOrNull?.enemyAuthoring?.versionAttempt?.origin.navigationRequestId,
            ).toBe(futureNav);
            expect(
              db.prepare('SELECT * FROM gm_request_queue_event ORDER BY event_index').all(),
            ).toEqual(queueBefore);
            const beforeRejected = db.serialize();
            expect(() => readCurrent()).toThrow('SOURCE_CHANGED');
            expect(() => app().command(currentRequest)).toThrow('INVALID_INPUT');
            expect(callsFor(currentRequest)).toBe(0);
            expect(db.serialize()).toEqual(beforeRejected);
            // Restore only the exact original SQL mirrors before the independent owning-QUEUE tamper.
            db.prepare(
              'UPDATE campaign_enemy_version SET record_json=?,record_sha256=? WHERE version_id=?',
            ).run(versionRow.record_json, versionRow.record_sha256, versionRow.version_id);
            db.prepare(
              'UPDATE campaign_enemy_history SET record_json=?,record_sha256=? WHERE history_id=?',
            ).run(historyRow.record_json, historyRow.record_sha256, historyRow.history_id);
            expect(
              readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.origin.navigationRequestId,
            ).toBe(futureNav);
            expect(
              db
                .prepare(
                  'SELECT record_json,record_sha256 FROM campaign_enemy_version WHERE version_id=?',
                )
                .get(versionRow.version_id),
            ).toEqual({
              record_json: versionRow.record_json,
              record_sha256: versionRow.record_sha256,
            });
            expect(
              db
                .prepare(
                  'SELECT record_json,record_sha256 FROM campaign_enemy_history WHERE history_id=?',
                )
                .get(historyRow.history_id),
            ).toEqual({
              record_json: historyRow.record_json,
              record_sha256: historyRow.record_sha256,
            });
            const queueRows = db
              .prepare<[], { event_id: string; record_json: string }>(
                'SELECT event_id,record_json FROM gm_request_queue_event ORDER BY event_index',
              )
              .all();
            let predecessor: string | null = null,
              changed = false;
            for (const row of queueRows) {
              const event = r.record(JSON.parse(row.record_json), '$.event'),
                view = r.record(event['view'], '$.view');
              if (row.event_id === positive.commandId) {
                const cause = r.record(
                  r.record(event['mutation'], '$.mutation')['cause'],
                  '$.cause',
                );
                const preparedState = r.record(
                  r.record(cause['preparedVersionConfiguration'], '$.prepared')['state'],
                  '$.preparedState',
                );
                const viewState = r.record(
                  r.record(view['enemyAuthoring'], '$.authoring')['versionAttempt'],
                  '$.viewState',
                );
                for (const state of [preparedState, viewState]) {
                  const summary = r.record(
                    r.record(state['replacementPreviewOrNull'], '$.preview')['inputSummary'],
                    '$.summary',
                  );
                  const choice = r.record(
                    r.list(summary['advisorOwnChoices'], '$.choices')[0],
                    '$.choice',
                  );
                  expect(choice['skillKey']).toBe('LEARNING');
                  expect(choice['slotCost']).toBe(9);
                  Reflect.set(choice, 'slotCost', 999);
                }
                changed = true;
              }
              const { snapshotSha256: _snapshot, ...body } = view;
              Reflect.set(view, 'snapshotSha256', campaignCreationHash(body));
              Reflect.set(event, 'previousEventSha256OrNull', predecessor);
              predecessor = campaignCreationHash(event);
              db.prepare(
                'UPDATE gm_request_queue_event SET record_json=?,record_sha256=? WHERE event_id=?',
              ).run(storage.canonical(event), predecessor, row.event_id);
            }
            expect(changed).toBe(true);
            db.close();
            db = openPersistenceDatabase(filename);
            const afterQueue = db
              .transaction(() => readGmRequestReviewViewStateInTransaction(db, scope))
              .deferred();
            expect(afterQueue.viewOrNull?.formId).toBe('ENM-017');
            expect(
              afterQueue.viewOrNull?.enemyAuthoring?.versionAttempt?.origin.navigationRequestId,
            ).toBe(futureNav);
            expect(
              afterQueue.viewOrNull?.enemyAuthoring?.versionAttempt?.replacementPreviewOrNull,
            ).toBeNull();
            const badBytes = db.serialize();
            expect(() => readCurrent()).toThrow('SOURCE_CHANGED');
            expect(() => app().command(currentRequest)).toThrow('INVALID_INPUT');
            expect(callsFor(currentRequest)).toBe(0);
            expect(db.serialize()).toEqual(badBytes);
            expect(oldRows()).toEqual(original);
            expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
            expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
          } finally {
            cfgSpy.mockRestore();
          }
          return;
        }
        if (variant === 'FAULTS') {
          app().command(
            request('VERSION_CONFIGURATION', {
              operation: 'SET_REASON',
              reason: 'Полная неизменная копия для проверки атомарности',
            }),
          );
          const ready = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
          expect(ready.validationErrors).toEqual([]);
          const command = request(null);
          const allRows = () =>
            Object.fromEntries(
              db
                .prepare<[], { name: string }>(
                  "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
                )
                .all()
                .map(({ name }) => [
                  name,
                  db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all(),
                ]),
            );
          const schema = () =>
            db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
          for (const [table, operation, marker] of [
            ['campaign_enemy_version', 'INSERT', 'ENEMY_NPLUS1_VERSION_INTERRUPTED'],
            ['campaign_enemy_history', 'INSERT', 'ENEMY_NPLUS1_HISTORY_INTERRUPTED'],
            ['campaign_enemy_current_version', 'UPDATE', 'ENEMY_NPLUS1_POINTER_INTERRUPTED'],
          ] as const) {
            db.exec(
              'CREATE TRIGGER reject_enemy_append BEFORE ' +
                operation +
                ' ON ' +
                table +
                " BEGIN SELECT RAISE(ABORT,'" +
                marker +
                "'); END",
            );
            const beforeCompactionRows = allRows(),
              beforeCompactionSchema = schema();
            const freePages = Number(db.pragma('freelist_count', { simple: true }));
            expect(Number.isSafeInteger(freePages) && freePages >= 0).toBe(true);
            // SQLite atomiccommit §7.3 permits unused free-leaf contents to change on rollback.
            // Only these byte-exact fault fixtures establish a no-freelist baseline, preserving all logical rows/schema.
            if (freePages !== 0) db.exec('VACUUM');
            expect(db.pragma('freelist_count', { simple: true })).toBe(0);
            expect(allRows()).toEqual(beforeCompactionRows);
            expect(schema()).toEqual(beforeCompactionSchema);
            const before = db.serialize(),
              rows = allRows(),
              beforeSchema = schema();
            const beforeView = structuredClone(readCurrent().viewOrNull);
            const samples = vi.mocked(randomInt).mock.calls.length;
            expect(() => app().command(command)).toThrow(marker); // Proves the actual intended SQL site was reached.
            expect(db.inTransaction).toBe(false);
            expect(db.serialize()).toEqual(before);
            expect(allRows()).toEqual(rows);
            expect(schema()).toEqual(beforeSchema);
            expect(readCurrent().viewOrNull).toEqual(beforeView);
            expect(vi.mocked(randomInt).mock.calls.length).toBe(samples);
            expect(oldRows()).toEqual(original);
            expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
            db.exec('DROP TRIGGER reject_enemy_append');
          }
          const committed = app().command(command);
          expect(committed.replayed).toBe(false);
          expect(committed.receipt.result['sourceFormId']).toBe('ENM-017');
          expect(
            enemyVersionIdentityValue(committed.receipt.result['committedVersionOrNull']).version,
          ).toBe(2);
          const persistedRows = allRows(),
            stable = db.serialize();
          expect(app().command(command)).toEqual({ ...committed, replayed: true });
          expect(db.serialize()).toEqual(stable);
          expect(allRows()).toEqual(persistedRows);
          db.close();
          db = openPersistenceDatabase(filename);
          expect(db.memory).toBe(false);
          expect(allRows()).toEqual(persistedRows);
          const reopened = db.serialize();
          expect(app().command(command)).toEqual({ ...committed, replayed: true });
          expect(app().command(metadata['commitRequest'])).toEqual({
            ...r.record(metadata['commitResult'], '$.oldCommitResult'),
            replayed: true,
          });
          expect(db.serialize()).toEqual(reopened);
          const full = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
          expect(full.formId).toBe('ENM-020');
          expect(full.context.selectedVersionOrNull?.version).toBe(2);
          expect(oldRows()).toEqual(original);
          expect(allRows()).toEqual(persistedRows);
          expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
          expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
          return;
        }
        if (variant === 'NEGATIVE') {
          const cfgSpy = vi.spyOn(versionPreparation, 'prepareEnemyVersionConfiguration');
          const sentientSpy = vi.spyOn(sentientPreparation, 'prepareEnemyComposition');
          const monsterSpy = vi.spyOn(monsterPreparation, 'prepareCustomMonsterComposition');
          const callsFor = (target: EnemyWorkflowRequest) =>
            cfgSpy.mock.calls.filter((args) => admissionJsonEqual(args[3], target)).length +
            sentientSpy.mock.calls.filter((args) => admissionJsonEqual(args[2], target)).length +
            monsterSpy.mock.calls.filter((args) => admissionJsonEqual(args[2], target)).length;
          try {
            const initial = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
            if (initial == null) throw new Error('Missing actual fresh version candidate');
            const input = json(
              initial.kind === 'SENTIENT'
                ? {
                    kind: initial.kind,
                    initialInput: {
                      baseStats: initial.baseStatsOrNull,
                      build: initial.buildOrNull,
                    },
                    advisorSkills: [],
                  }
                : { kind: initial.kind, advisorSkills: [] },
            );
            const previewRequest = request('VERSION_CONFIGURATION', {
              operation: 'PREVIEW_REPLACEMENT',
              input,
            });
            const previewResult = app().command(previewRequest);
            expect(callsFor(previewRequest)).toBeGreaterThan(0); // An actual source/prepare call, not an inert spy.
            app().command(
              request('VERSION_CONFIGURATION', {
                operation: 'DISCARD_REPLACEMENT',
                previewCommandId: previewRequest.commandId,
              }),
            );
            const species = catalog.composition.symbionts.species.find(
              (row) => row.speciesKey === 'ADVISER',
            );
            if (species === undefined) throw new Error('Missing actual Adviser source');
            const adviser = {
              speciesKey: species.speciesKey,
              targetLevel: 1,
              learnedNodeRefs: catalog.composition.development.nodes
                .filter((node) => node.speciesKey === species.speciesKey && node.level === 1)
                .map((node) => node.nodeRef),
              binding: { kind: species.bindingPolicy },
            };
            const compositionStage =
              kind === 'SENTIENT' ? 'SENTIENT_SYMBIONTS' : 'MONSTER_SYMBIONT';
            const selection =
              kind === 'SENTIENT'
                ? {
                    symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
                    ordinarySymbiontInstances: [adviser],
                    symbioticMonsterProfileIdOrNull: null,
                    monsterOrNull: null,
                  }
                : { mode: 'ORDINARY', symbiont: adviser };
            const acquisitionPreview = request(
              compositionStage,
              json({
                operation: 'PREVIEW',
                selection,
                ...(kind === 'SENTIENT' ? { advisorRemovalConfirmed: true } : {}),
              }),
            );
            app().command(acquisitionPreview);
            expect(callsFor(acquisitionPreview)).toBeGreaterThan(0);
            expect(readCurrent().creationOrigin.payload.defaultFutureRollMode).toBe('MANUAL');
            const confirmation = request(compositionStage, {
              operation: 'CONFIRM',
              previewCommandId: acquisitionPreview.commandId,
              ...(kind === 'SENTIENT' ? { interactionsConfirmed: true } : {}),
              manualFacesOrNull: [12, 12],
            });
            const otherFolder = kind === 'SENTIENT' ? 'enemy-custom-v1' : 'enemy-composed-v1';
            const other = r.record(
              JSON.parse(
                readFileSync(join('tests/fixtures', otherFolder, 'metadata.json'), 'utf8'),
              ),
              '$.otherFixture',
            );
            const otherScope = r.record(other['scope'], '$.otherScope');
            const foreignCampaign = r.uuid(otherScope['campaignId'], '$.otherCampaign');
            expect(foreignCampaign).not.toBe(scope.campaignId);
            const oldAttemptId = r.uuid(
              r.record(saved['attempt'], '$.oldActualAttempt')['attemptId'],
              '$.oldActualAttemptId',
            );
            const refused = [
              {
                request: {
                  ...confirmation,
                  commandId: randomUUID(),
                  expectedRevisions: {
                    ...confirmation.expectedRevisions,
                    stateRevision: confirmation.expectedRevisions.stateRevision - 1,
                  },
                },
                code: 'INVALID_INPUT',
              },
              {
                request: {
                  ...confirmation,
                  commandId: randomUUID(),
                  payload: { ...confirmation.payload, campaignId: foreignCampaign },
                },
                code: 'FOREIGN_OWNER',
              },
              {
                request: {
                  ...confirmation,
                  commandId: randomUUID(),
                  payload: { ...confirmation.payload, creationAttemptId: oldAttemptId },
                },
                code: 'INVALID_INPUT',
              },
            ];
            for (const negative of refused) {
              const bytes = db.serialize(),
                sampleCount = vi.mocked(randomInt).mock.calls.length;
              expect(() => app().command(negative.request)).toThrow(negative.code);
              expect(callsFor(negative.request)).toBe(0); // Historical observer calls have different actual requests.
              expect(vi.mocked(randomInt).mock.calls.length).toBe(sampleCount);
              expect(db.serialize()).toEqual(bytes);
            }
            const clientOrigin = {
              ...confirmation,
              commandId: randomUUID(),
              payload: { ...confirmation.payload, origin: { base: identity } },
            };
            const beforeHiddenOrigin = db.serialize();
            expect(() => app().command(clientOrigin)).toThrow('UNRECOGNIZED');
            expect(callsFor(clientOrigin)).toBe(0);
            expect(db.serialize()).toEqual(beforeHiddenOrigin);
            const acquired = app().command(confirmation);
            expect(callsFor(confirmation)).toBeGreaterThan(0);
            const actualCard = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
            const cards =
              actualCard?.kind === 'SENTIENT'
                ? actualCard.compositionAcquisitions?.advisorCards
                : actualCard?.advisorCards;
            expect(cards).toHaveLength(1);
            expect(cards?.[0]?.iwRolls.map((roll) => roll.mechanical.rawFace)).toEqual([12, 12]);
            nav('ENM-017::CTA::005');
            nav('ENM-020::CTA::002');
            nav('ENM-001::CTA::008');
            app().command(
              request('VERSION_CONFIGURATION', {
                operation: 'SET_REASON',
                reason: 'Проверка неизменной копии и квитанций',
              }),
            );
            const commit = request(null),
              committed = app().command(commit);
            nav('ENM-020::CTA::002');
            nav('ENM-001::CTA::008');
            const currentContext = structuredClone(readCurrent().viewOrNull?.enemyAuthoring);
            const stable = db.serialize();
            expect(app().command(previewRequest)).toEqual({ ...previewResult, replayed: true });
            expect(app().command(confirmation)).toEqual({ ...acquired, replayed: true });
            expect(app().command(commit)).toEqual({ ...committed, replayed: true });
            expect(readCurrent().viewOrNull?.formId).toBe('ENM-017');
            expect(readCurrent().viewOrNull?.enemyAuthoring).toEqual(currentContext);
            expect(db.serialize()).toEqual(stable);
            const changed = {
              ...previewRequest,
              payload: {
                ...previewRequest.payload,
                data: { operation: 'SET_REASON', reason: 'Изменённый повтор' },
              },
            };
            expect(() => app().command(changed)).toThrow('IDEMPOTENCY_CONFLICT');
            expect(callsFor(changed)).toBe(0);
            expect(db.serialize()).toEqual(stable);
            const beforeAdvance = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
            if (beforeAdvance == null) throw new Error('Missing actual current attempt');
            const priorAttemptRevision = beforeAdvance.revision;
            app().command(
              request('VERSION_CONFIGURATION', {
                operation: 'SET_REASON',
                reason: 'Действительное продвижение текущей попытки',
              }),
            );
            const freshCurrentRequest = request('VERSION_CONFIGURATION', {
              operation: 'SET_REASON',
              reason: 'Следующая причина текущей попытки',
            });
            expect(priorAttemptRevision).toBeGreaterThanOrEqual(0);
            expect(freshCurrentRequest.payload.expectedAttemptRevision).toBeGreaterThan(
              priorAttemptRevision,
            );
            const staleAttempt = {
              ...freshCurrentRequest,
              payload: {
                ...freshCurrentRequest.payload,
                expectedAttemptRevision: priorAttemptRevision,
              },
            };
            const beforeStaleAttempt = db.serialize();
            expect(() => app().command(staleAttempt)).toThrow('INVALID_INPUT');
            expect(callsFor(staleAttempt)).toBe(0);
            expect(db.serialize()).toEqual(beforeStaleAttempt);
            // A new active GM context is used only to revoke this context, never to fabricate a stale live base.
            const masterProfileId = readCurrent().context.masterProfileId;
            let denied = 0;
            const validateOwner: CampaignPrivateOwnerValidator = (owner) => {
              const active = readActiveLocalGmContext(db, scope.ownerDeviceId);
              if (
                active?.gmLocalContextId !== scope.gmLocalContextId ||
                active.masterProfileId !== masterProfileId ||
                owner.ownerDeviceId !== scope.ownerDeviceId ||
                owner.campaignId !== scope.campaignId ||
                owner.masterProfileId !== masterProfileId
              ) {
                denied++;
                return storage.fail('FOREIGN_OWNER');
              }
            };
            const authorized = createEnemyAuthoringApplication({
              database: db,
              scope,
              catalog,
              baseline,
              readCurrent,
              validateOwner,
            });
            authorized.project();
            const fresh = request('VERSION_CONFIGURATION', {
              operation: 'SET_REASON',
              reason: 'Новая команда после смены GM',
            });
            createLocalGmContext(
              db,
              {
                ownerDeviceId: scope.ownerDeviceId,
                masterProfileId,
                gmLocalContextId: randomUUID(),
              },
              () => undefined,
            );
            const beforeRevoked = db.serialize();
            for (const target of [fresh, commit]) {
              const beforeDenied = denied;
              expect(() => authorized.command(target)).toThrow('CORRUPT_STORAGE');
              expect(denied).toBe(beforeDenied + 1);
              expect(db.serialize()).toEqual(beforeRevoked);
            }
            expect(callsFor(fresh)).toBe(0);
            expect(oldRows()).toEqual(original);
            expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
          } finally {
            cfgSpy.mockRestore();
            sentientSpy.mockRestore();
            monsterSpy.mockRestore();
          }
          return;
        }
        if (variant === 'MECHANICAL') {
          const current = () => {
            const attempt = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
            if (attempt?.kind !== 'SENTIENT')
              throw new Error('Missing actual SENTIENT accounting candidate');
            return attempt;
          };
          const plan = () =>
            current().skillPlanState?.planOrNull ??
            (() => {
              throw new Error('Missing actual plan');
            })();
          const accounting = () =>
            plan().accountingOrNull ??
            (() => {
              throw new Error('Missing actual verified-body accounting');
            })();
          const member = (speciesKey: string, targetLevel: number) => {
            const species = catalog.composition.symbionts.species.find(
              (row) => row.speciesKey === speciesKey,
            );
            if (species === undefined) throw new Error('Missing actual species ' + speciesKey);
            return {
              speciesKey,
              targetLevel,
              learnedNodeRefs: catalog.composition.development.nodes
                .filter((node) => node.speciesKey === speciesKey && node.level <= targetLevel)
                .map((node) => node.nodeRef),
              binding: { kind: species.bindingPolicy },
            };
          };
          const ordinary = (...members: ReturnType<typeof member>[]) =>
            json({
              symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
              ordinarySymbiontInstances: members,
              symbioticMonsterProfileIdOrNull: null,
              monsterOrNull: null,
            });
          const select = (selection: JsonObject) => {
            const preview = request('SENTIENT_SYMBIONTS', {
              operation: 'PREVIEW',
              selection,
              advisorRemovalConfirmed: true,
            });
            app().command(preview);
            app().command(
              request('SENTIENT_SYMBIONTS', {
                operation: 'CONFIRM',
                previewCommandId: preview.commandId,
                interactionsConfirmed: true,
                manualFacesOrNull: null,
              }),
            );
            return preview.commandId;
          };
          const finish = (previewCommandId: string, dolphinSkills: JsonObject[] = []) =>
            app().command(
              request('SENTIENT_SYMBIONTS', {
                operation: 'FINISH',
                previewCommandId,
                skills: { advisorSkills: [], dolphinSkills },
              }),
            );
          const body = () => {
            const command = request('SENTIENT_INVENTORY', {
              inventoryItems: [],
              armorCompatibilityReasonOrNull: null,
            });
            return { command, result: app().command(command) };
          };
          const replace = (initialInput: JsonObject, discardFirst = false) => {
            const input = json({ kind: 'SENTIENT', initialInput, advisorSkills: [] });
            const before = structuredClone(plan());
            app().command(
              request('VERSION_CONFIGURATION', { operation: 'PREVIEW_REPLACEMENT', input }),
            );
            expect(plan()).toEqual(before);
            if (discardFirst) {
              const preview =
                readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.replacementPreviewOrNull;
              if (preview == null) throw new Error('Missing discardable actual preview');
              app().command(
                request('VERSION_CONFIGURATION', {
                  operation: 'DISCARD_REPLACEMENT',
                  previewCommandId: preview.previewCommandId,
                }),
              );
              expect(plan()).toEqual(before);
              app().command(
                request('VERSION_CONFIGURATION', { operation: 'PREVIEW_REPLACEMENT', input }),
              );
              expect(plan()).toEqual(before);
            }
            const preview =
              readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.replacementPreviewOrNull;
            if (preview == null) throw new Error('Missing exact actual replacement witness');
            expect(
              preview.before.kind === 'SENTIENT' && preview.before.skillPlanState?.planOrNull,
            ).toEqual(before);
            const command = request(
              'VERSION_CONFIGURATION',
              json({
                operation: 'CONFIRM_REPLACEMENT',
                input,
                displayedPreview: preview,
                previewCommandId: preview.previewCommandId,
                consent: true,
              }),
            );
            app().command(command);
            expect(plan().planId).toBe(command.commandId);
            expect(plan().accountingOrNull).toBeNull();
          };
          const samples = vi.mocked(randomInt).mock.calls.length;
          const free = structuredClone(current().compositionAcquisitions?.freeSlotOrNull);
          expect(free).not.toBeNull();
          const copiedPlan = structuredClone(plan());
          let selected = select(ordinary(member('DOLPHIN', 6)));
          finish(selected, [
            { skillKey: 'UNARMED', targetBonus: 8 },
            { skillKey: 'ACROBATICS', targetBonus: 4 },
          ]);
          body();
          expect(plan().planId).toBe(copiedPlan.planId);
          expect(accounting().knownSkills).toEqual([
            { ...copiedPlan.initialSkills[0], bonus: 8, startSlots: 9, dolphinSlots: 2 },
            { ...copiedPlan.initialSkills[1], bonus: 4, startSlots: 1, dolphinSlots: 3 },
          ]);
          const mixed = structuredClone(accounting().knownSkills);
          selected = select(ordinary());
          finish(selected);
          body();
          expect(accounting().knownSkills).toEqual(mixed);
          let sheet = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
          if (sheet.kind !== 'SENTIENT_ENEMY_AUTHORING' || sheet.sheetOrNull == null)
            throw new Error('Missing actual current pool projection');
          expect(sheet.sheetOrNull.compositionFacts?.dolphinSkillSlots).toEqual({
            capacity: 0,
            used: 5,
          });
          selected = select(ordinary(member('DOLPHIN', 6)));
          finish(selected);
          body();
          expect(accounting().knownSkills).toEqual(mixed);
          sheet = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
          if (sheet.kind !== 'SENTIENT_ENEMY_AUTHORING' || sheet.sheetOrNull == null)
            throw new Error('Missing reacquired pool');
          expect(sheet.sheetOrNull.compositionFacts?.dolphinSkillSlots).toEqual({
            capacity: 5,
            used: 5,
          });
          // CORE167: D11 permits UNARMED, not ACROBATICS; the source-validated UNITED/S30 basis also permits GROSS.
          const basis = {
            baseStats: { S: 30, D: 11, M: 20, Z: 20, I: 20, W: 20, C: 20 },
            build: {
              raceCode: 'UNITED',
              pureClassOrNull: null,
              skillSelections: [
                { skillKey: 'GROSS', targetBonus: 2 },
                { skillKey: 'UNARMED', targetBonus: 6 },
                { skillKey: 'LEARNING', targetBonus: 1 },
              ],
            },
          };
          expect(
            catalog.skills.races.find((race) => race.raceCode === 'UNITED')?.grantedSkillRefs,
          ).toEqual(['FOLLOWING_PAIN']);
          replace(json(basis), true);
          expect(
            plan().initialSkills.map((skill) => [
              skill.skillKey,
              skill.startSlots,
              skill.dolphinSlots,
            ]),
          ).toEqual([
            ['FOLLOWING_PAIN', 0, 0],
            ['GROSS', 2, 0],
            ['UNARMED', 7, 0],
            ['LEARNING', 1, 0],
          ]);
          selected = select(ordinary(member('TROGR', 5), member('TEACHER', 1)));
          finish(selected);
          const firstBody = body();
          expect(accounting().grossGrantOrNull).toEqual({
            commandId: firstBody.command.commandId,
            bonusBefore: 2,
            bonusAfter: 5,
          });
          expect(
            accounting().knownSkills.find((skill) => skill.skillKey === 'GROSS'),
          ).toMatchObject({ bonus: 5, startSlots: 2, dolphinSlots: 0 });
          const issued = structuredClone(accounting().grossGrantOrNull);
          body();
          expect(accounting().grossGrantOrNull).toEqual(issued);
          expect(accounting().knownSkills.find((skill) => skill.skillKey === 'GROSS')?.bonus).toBe(
            5,
          );
          const plague = member('PLAGUE_DOCTOR', 1);
          const profile = catalog.composition.development.levels.find(
            (row) => row.speciesKey === plague.speciesKey && row.level === plague.targetLevel,
          );
          if (profile === undefined) throw new Error('Missing actual plague L1 profile');
          selected = select(
            json({
              symbiontCompositionMode: 'SYMBIOTIC_MONSTER',
              ordinarySymbiontInstances: [],
              monsterOrNull: plague,
              symbioticMonsterProfileIdOrNull: profile.levelProfileId,
            }),
          );
          finish(selected);
          const beforeBody = structuredClone(accounting());
          expect(beforeBody.knownSkills.some((skill) => skill.skillKey === 'UNARMED')).toBe(true);
          const invalidLoadout = request('SENTIENT_INVENTORY', {
            inventoryItems: [
              {
                itemTypeId: 'RES-CUR-003',
                quantity: 1,
                profile: { kind: 'CATALOG' },
                equipped: true,
                equippedSlots: ['HEAD'],
                bodyZone: null,
                gripMode: null,
                currentAmmo: null,
                shieldCurrentHP: null,
                broken: false,
                sealed: null,
                linkedSetInstanceId: null,
                componentRole: null,
                qualityRoll: null,
                coatingInstanceIds: [],
                issueReason: 'Недопустимое ношение монет',
              },
            ],
            armorCompatibilityReasonOrNull: null,
          });
          const bytes = db.serialize();
          expect(() => app().command(invalidLoadout)).toThrow('INVALID_INPUT');
          expect(db.serialize()).toEqual(bytes);
          expect(accounting()).toEqual(beforeBody);
          const lost = body();
          expect(accounting().knownSkills.some((skill) => skill.skillKey === 'UNARMED')).toBe(
            false,
          );
          expect(accounting().permanentLosses).toContainEqual({
            skillKey: 'UNARMED',
            commandId: lost.command.commandId,
            bonusBefore: 6,
            releasedStartSlots: 7,
            releasedDolphinSlots: 0,
          });
          selected = select(ordinary());
          finish(selected);
          body();
          expect(accounting().knownSkills.some((skill) => skill.skillKey === 'UNARMED')).toBe(
            false,
          );
          expect(accounting().grossGrantOrNull).toEqual(issued);
          replace(
            json({
              ...basis,
              build: {
                ...basis.build,
                skillSelections: [
                  { skillKey: 'GROSS', targetBonus: 1 },
                  { skillKey: 'UNARMED', targetBonus: 7 },
                ],
              },
            }),
          );
          selected = select(ordinary(member('TROGR', 5), member('TEACHER', 1)));
          finish(selected);
          const nextBody = body();
          expect(accounting().grossGrantOrNull).toEqual({
            commandId: nextBody.command.commandId,
            bonusBefore: 1,
            bonusAfter: 4,
          });
          body();
          expect(
            accounting().knownSkills.find((skill) => skill.skillKey === 'GROSS'),
          ).toMatchObject({ bonus: 4, startSlots: 1, dolphinSlots: 0 });
          expect(current().compositionAcquisitions?.freeSlotOrNull).toEqual(free);
          expect(vi.mocked(randomInt).mock.calls.length).toBe(samples); // Genuine source is MANUAL; no AUTO-unreachability claim.
          expectedMechanicalPlan = structuredClone(plan());
          retainedRngCount = samples;
        }
        if (variant === 'CANCELED_SENTIENT_CARD') {
          const current = () => {
            const attempt = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
            if (attempt?.kind !== 'SENTIENT') throw new Error('Missing actual SENTIENT');
            return attempt;
          };
          const initialInput = {
            baseStats: { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 },
            build: {
              raceCode: 'UNITED',
              pureClassOrNull: null,
              skillSelections: [
                { skillKey: 'UNARMED', targetBonus: 3 },
                { skillKey: 'LEARNING', targetBonus: 6 },
              ],
            },
          };
          const firstSkills = [
            { skillKey: 'UNARMED', targetBonus: 5 },
            { skillKey: 'FENCING', targetBonus: 5 },
          ];
          const nextSkills = [
            { skillKey: 'LEARNING', targetBonus: 7 },
            { skillKey: 'ACROBATICS', targetBonus: 1 },
          ];
          const active = json({
            symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
            ordinarySymbiontInstances: (
              [
                ['ADVISER', 1],
                ['TROGR', 5],
              ] as const
            ).map(([speciesKey, level]) => ({
              speciesKey,
              targetLevel: level,
              learnedNodeRefs: catalog.composition.development.nodes
                .filter((node) => node.speciesKey === speciesKey && node.level <= level)
                .map((node) => node.nodeRef),
              binding: { kind: 'NONE' },
            })),
            symbioticMonsterProfileIdOrNull: null,
            monsterOrNull: null,
          });
          const none = {
            symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
            ordinarySymbiontInstances: [],
            symbioticMonsterProfileIdOrNull: null,
            monsterOrNull: null,
          };
          const replace = (inputBasis: JsonObject, advisorSkills: JsonObject[]) => {
            const input = json({ kind: 'SENTIENT', initialInput: inputBasis, advisorSkills });
            app().command(
              request('VERSION_CONFIGURATION', { operation: 'PREVIEW_REPLACEMENT', input }),
            );
            const preview =
              readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.replacementPreviewOrNull;
            if (preview == null) throw new Error('Missing actual version preview');
            app().command(
              request(
                'VERSION_CONFIGURATION',
                json({
                  operation: 'CONFIRM_REPLACEMENT',
                  previewCommandId: preview.previewCommandId,
                  input,
                  displayedPreview: preview,
                  consent: true,
                }),
              ),
            );
          };
          const select = (selection: JsonObject, acquiring = false) => {
            const preview = request('SENTIENT_SYMBIONTS', {
              operation: 'PREVIEW',
              selection,
              advisorRemovalConfirmed: true,
            });
            app().command(preview);
            const command = request('SENTIENT_SYMBIONTS', {
              operation: 'CONFIRM',
              previewCommandId: preview.commandId,
              interactionsConfirmed: true,
              manualFacesOrNull: acquiring ? [12, 12, 20] : null,
            });
            return {
              previewCommandId: preview.commandId,
              request: command,
              result: app().command(command),
            };
          };
          const finish = (previewCommandId: string, advisorSkills: JsonObject[]) =>
            app().command(
              request('SENTIENT_SYMBIONTS', {
                operation: 'FINISH',
                previewCommandId,
                skills: { advisorSkills, dolphinSkills: [] },
              }),
            );
          const body = () => {
            const command = request('SENTIENT_INVENTORY', {
              inventoryItems: [],
              armorCompatibilityReasonOrNull: null,
            });
            return { request: command, result: app().command(command) };
          };
          const returnToBase = () => {
            nav('ENM-017::CTA::005');
            nav('ENM-020::CTA::002');
            nav('ENM-001::CTA::008');
          };
          const reason = (value: string) =>
            app().command(
              request('VERSION_CONFIGURATION', { operation: 'SET_REASON', reason: value }),
            );
          expect(readCurrent().creationOrigin.payload.defaultFutureRollMode).toBe('MANUAL');
          const samples = vi.mocked(randomInt).mock.calls.length;
          replace(initialInput, []);
          const acquire = select(active, true);
          finish(acquire.previewCommandId, firstSkills);
          const card = structuredClone(current().compositionAcquisitions?.advisorCards[0]);
          if (card === undefined) throw new Error('Missing actual Advisor acquisition');
          expect(card.skillsOrNull).toEqual(firstSkills);
          expect(card.suppressionRollOrNull?.mechanical.rawFace).toBe(20);
          expect(current().skillPlanState?.advisorInitialFillHistory).toEqual([]);
          returnToBase();
          const unfilled =
            readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.retainedMandatoryFacts;
          expect(unfilled).toMatchObject({
            kind: 'SENTIENT',
            advisorCards: [{ cardId: card.cardId, initialFillOrNull: null }],
          });
          expect(current()).not.toHaveProperty('schemaVersion');
          replace(initialInput, []); // No initial fill exists: no invented replacement gate on the first body publication.
          finish(select(active).previewCommandId, firstSkills);
          const filled = body();
          const realInitialFill = structuredClone(
            current().skillPlanState?.advisorInitialFillHistory[0],
          );
          if (realInitialFill === undefined) throw new Error('Missing verified body fill');
          expect(realInitialFill.commandId).toBe(filled.request.commandId);
          returnToBase();
          const immutableFill = { commandId: filled.request.commandId, skills: firstSkills };
          expect(
            readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.retainedMandatoryFacts,
          ).toMatchObject({
            kind: 'SENTIENT',
            advisorCards: [
              {
                cardId: card.cardId,
                iwRolls: card.iwRolls,
                suppressionRollOrNull: card.suppressionRollOrNull,
                initialFillOrNull: immutableFill,
              },
            ],
          });
          if (
            copied?.kind !== 'SENTIENT' ||
            copied.baseStatsOrNull === null ||
            copied.buildOrNull === null
          )
            throw new Error('Missing copied PURE basis');
          replace(json({ baseStats: copied.baseStatsOrNull, build: copied.buildOrNull }), []);
          finish(select(none).previewCommandId, []);
          body();
          expect(current().compositionAcquisitions?.advisorCards[0]?.suppressionRollOrNull).toEqual(
            card.suppressionRollOrNull,
          );
          expect(current().skillPlanState?.advisorKnowledge).toEqual([]);
          reason('Явная конфигурация PURE без активной карты и без повторных бросков');
          const commitNone = request(null),
            resultNone = app().command(commitNone);
          const inactive = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
          if (inactive.kind !== 'SENTIENT_ENEMY_AUTHORING')
            throw new Error('Missing inactive saved sheet');
          const pureBasis = calculateSkillStageStats(catalog.skills, {
            baseStats: copied.baseStatsOrNull,
            raceCode: copied.buildOrNull.raceCode,
            classCode: copied.buildOrNull.pureClassOrNull,
            creationMode: 'MANUAL',
          }).skillStageStats;
          expect(inactive.sheetOrNull?.permanentStats.I).toBe(pureBasis.I);
          nav('ENM-020::CTA::002');
          nav('ENM-001::CTA::008');
          expect(
            readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.origin.base.version,
          ).toBe(2);
          replace(initialInput, nextSkills);
          finish(select(active).previewCommandId, nextSkills);
          body();
          const finalCard = current().compositionAcquisitions?.advisorCards[0];
          expect(finalCard).toMatchObject({
            cardId: card.cardId,
            symbiontInstanceId: card.symbiontInstanceId,
            iwRolls: card.iwRolls,
            suppressionRollOrNull: card.suppressionRollOrNull,
          });
          expect(
            current().skillPlanState?.advisorKnowledge[0]?.knownSkills.map((row) => row.skillKey),
          ).toEqual(['LEARNING', 'ACROBATICS']);
          reason('Новая конфигурация с тем же Советником и сохранённым подавлением');
          const commitOwn = request(null),
            resultOwn = app().command(commitOwn);
          db.close();
          db = openPersistenceDatabase(filename);
          const bytes = db.serialize();
          expect(app().command(acquire.request)).toEqual({ ...acquire.result, replayed: true });
          expect(app().command(filled.request)).toEqual({ ...filled.result, replayed: true });
          expect(app().command(commitNone)).toEqual({ ...resultNone, replayed: true });
          expect(app().command(commitOwn)).toEqual({ ...resultOwn, replayed: true });
          expect(app().command(metadata['originalCommitRequest'])).toEqual({
            ...r.record(metadata['originalCommitResult'], '$.oldReceipt'),
            replayed: true,
          });
          expect(db.serialize().equals(bytes)).toBe(true);
          const full = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
          if (full.kind !== 'SENTIENT_ENEMY_AUTHORING') throw new Error('Missing final full sheet');
          expect(full.context.selectedVersionOrNull?.version).toBe(3);
          expect(full.sheetOrNull?.permanentStats.I).toBe(6); // Actual Trogr5 source floor + original R20 suppression continuation.
          expect(oldRows()).toEqual(original);
          expect(vi.mocked(randomInt).mock.calls.length).toBe(samples);
          expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
          return;
        }
        if (variant === 'CANCELED_CARD') {
          const current = () => {
            const attempt = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
            if (attempt?.kind !== 'CUSTOM_MONSTER') throw new Error('Missing actual monster');
            return attempt;
          };
          const advisor = json({
            mode: 'ORDINARY',
            symbiont: {
              speciesKey: 'ADVISER',
              targetLevel: 1,
              learnedNodeRefs: catalog.monster.development.nodes
                .filter((node) => node.speciesKey === 'ADVISER' && node.level === 1)
                .map((node) => node.nodeRef),
              binding: { kind: 'NONE' },
            },
          });
          const select = (selection: JsonObject, acquiring = false) => {
            const preview = request('MONSTER_SYMBIONT', { operation: 'PREVIEW', selection });
            app().command(preview);
            const confirm = request('MONSTER_SYMBIONT', {
              operation: 'CONFIRM',
              previewCommandId: preview.commandId,
              manualFacesOrNull: acquiring ? [12, 12] : null,
            });
            const result = app().command(confirm);
            return { previewCommandId: preview.commandId, request: confirm, result };
          };
          const finish = (previewCommandId: string, advisorSkills: JsonObject[]) => {
            const command = request('MONSTER_SYMBIONT', {
              operation: 'FINISH',
              previewCommandId,
              advisorSkills,
            });
            return { request: command, result: app().command(command) };
          };
          const returnToBase = () => {
            nav('ENM-017::CTA::005');
            nav('ENM-020::CTA::002');
            nav('ENM-001::CTA::008');
          };
          const replace = (advisorSkills: JsonObject[]) => {
            const input = json({ kind: 'CUSTOM_MONSTER', advisorSkills });
            app().command(
              request('VERSION_CONFIGURATION', { operation: 'PREVIEW_REPLACEMENT', input }),
            );
            const preview =
              readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.replacementPreviewOrNull;
            if (preview == null) throw new Error('Missing own-choice replacement preview');
            app().command(
              request(
                'VERSION_CONFIGURATION',
                json({
                  operation: 'CONFIRM_REPLACEMENT',
                  previewCommandId: preview.previewCommandId,
                  input,
                  displayedPreview: preview,
                  consent: true,
                }),
              ),
            );
          };
          const setReason = (reason: string) =>
            app().command(request('VERSION_CONFIGURATION', { operation: 'SET_REASON', reason }));
          // This genuine producer was MANUAL; these are actual owned acquisition receipts, not a mocked sampler.
          expect(readCurrent().creationOrigin.payload.defaultFutureRollMode).toBe('MANUAL');
          const samples = vi.mocked(randomInt).mock.calls.length;
          const acquired = select(advisor, true);
          const originalCard = structuredClone(current().advisorCards[0]);
          if (originalCard === undefined) throw new Error('Missing acquired card');
          expect(originalCard.initialSkillsOrNull).toBeNull();
          returnToBase();
          let facts =
            readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.retainedMandatoryFacts;
          expect(facts).toMatchObject({
            kind: 'CUSTOM_MONSTER',
            advisorCards: [{ cardId: originalCard.cardId, initialFillOrNull: null }],
          });
          expect(current().advisorCards[0]?.initialSkillsOrNull).toBeNull();
          expect(
            readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt
              ?.unconfiguredAdvisorCardIdOrNull,
          ).toBeNull();
          const initialSkills = [
            { skillKey: 'UNARMED', targetBonus: 5 },
            { skillKey: 'FENCING', targetBonus: 5 },
          ];
          const firstFill = finish(select(advisor).previewCommandId, initialSkills);
          expect(current().advisorCards[0]).toMatchObject({
            ...originalCard,
            initialSkillsOrNull: initialSkills,
            knownSkills: initialSkills,
          });
          returnToBase();
          facts = readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.retainedMandatoryFacts;
          const initialFill = { commandId: firstFill.request.commandId, skills: initialSkills };
          expect(facts).toMatchObject({
            kind: 'CUSTOM_MONSTER',
            advisorCards: [{ cardId: originalCard.cardId, initialFillOrNull: initialFill }],
          });
          expect(current().advisorCards[0]?.knownSkills).toEqual([]);
          expect(
            readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt
              ?.unconfiguredAdvisorCardIdOrNull,
          ).toBe(originalCard.cardId);
          const unresolved = select(advisor);
          const beforeRefusal = db.serialize();
          expect(() => finish(unresolved.previewCommandId, initialSkills)).toThrow('INVALID_INPUT');
          expect(db.serialize().equals(beforeRefusal)).toBe(true);
          replace([]);
          finish(select({ mode: 'NONE' }).previewCommandId, []);
          expect(current().activeAdvisorCardIdOrNull).toBeNull();
          expect(
            readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt
              ?.unconfiguredAdvisorCardIdOrNull,
          ).toBe(originalCard.cardId);
          setReason('Явная конфигурация без текущих навыков неактивного Советника');
          const commitNone = request(null),
            resultNone = app().command(commitNone);
          nav('ENM-020::CTA::002');
          nav('ENM-001::CTA::008');
          expect(
            readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.origin.base.version,
          ).toBe(2);
          expect(
            readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt
              ?.unconfiguredAdvisorCardIdOrNull,
          ).toBe(originalCard.cardId);
          expect(current().advisorCards[0]?.knownSkills).toEqual([]);
          const stillUnresolved = select(advisor);
          const nextBytes = db.serialize();
          expect(() => finish(stillUnresolved.previewCommandId, initialSkills)).toThrow(
            'INVALID_INPUT',
          );
          expect(db.serialize().equals(nextBytes)).toBe(true);
          const replacementSkills = [
            { skillKey: 'LEARNING', targetBonus: 7 },
            { skillKey: 'ACROBATICS', targetBonus: 1 },
          ];
          replace(replacementSkills);
          finish(select(advisor).previewCommandId, replacementSkills);
          const finalCard = current().advisorCards[0];
          expect(finalCard).toMatchObject({
            cardId: originalCard.cardId,
            symbiontInstanceId: originalCard.symbiontInstanceId,
            iwRolls: originalCard.iwRolls,
            initialSkillsOrNull: initialSkills,
            knownSkills: replacementSkills,
            permanentLosses: [],
          });
          expect(
            readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt
              ?.unconfiguredAdvisorCardIdOrNull,
          ).toBeNull();
          setReason('Явно подтверждён новый текущий набор той же карты');
          const commitOwn = request(null),
            resultOwn = app().command(commitOwn);
          db.close();
          db = openPersistenceDatabase(filename);
          const reopenedBytes = db.serialize();
          expect(app().command(acquired.request)).toEqual({ ...acquired.result, replayed: true });
          expect(app().command(firstFill.request)).toEqual({ ...firstFill.result, replayed: true });
          expect(app().command(commitNone)).toEqual({ ...resultNone, replayed: true });
          expect(app().command(commitOwn)).toEqual({ ...resultOwn, replayed: true });
          expect(app().command(metadata['commitRequest'])).toEqual({
            ...r.record(metadata['commitResult'], '$.oldReceipt'),
            replayed: true,
          });
          expect(db.serialize().equals(reopenedBytes)).toBe(true);
          const full = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
          if (full.kind !== 'CUSTOM_MONSTER_AUTHORING') throw new Error('Missing full monster');
          expect(full.sheetOrNull?.advisorOrNull?.skills.map((row) => row.skillKey)).toEqual([
            'LEARNING',
            'ACROBATICS',
          ]);
          expect(full.context.selectedVersionOrNull?.version).toBe(3);
          expect(
            db.prepare('SELECT version FROM campaign_enemy_version ORDER BY version').all(),
          ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
          expect(oldRows()).toEqual(original);
          expect(vi.mocked(randomInt).mock.calls.length).toBe(samples);
          expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
          return;
        }
        if (variant === 'CANCELED_FREE' || variant === 'CANCELED_ZERO_FREE') {
          expect(copied).not.toHaveProperty('schemaVersion');
          const oldComposed = new Database(
            gunzipSync(
              readFileSync('tests/fixtures/enemy-composed-v1/schema21-composed-v1.sqlite.gz'),
            ),
          );
          let input: JsonObject, selection: JsonObject;
          try {
            const recordRow = oldComposed
              .prepare<[], { record_json: string }>(
                'SELECT record_json FROM campaign_enemy_version',
              )
              .get();
            if (recordRow === undefined) throw new Error('Missing source-backed composed input');
            const record = r.record(JSON.parse(recordRow.record_json), '$.sourceVersion');
            const old = enemyAuthoringContextValue({
              attemptOrNull: record['attempt'],
              selectedVersionOrNull: null,
            }).attemptOrNull;
            if (
              old?.kind !== 'SENTIENT' ||
              old.skillPlanState?.planOrNull == null ||
              old.compositionOrNull == null ||
              !('schemaVersion' in old.compositionOrNull)
            )
              throw new Error('Missing genuine full initial input/composition');
            input = json({
              kind: 'SENTIENT',
              initialInput: old.skillPlanState.planOrNull.initialInput,
              advisorSkills: [],
            });
            if (variant === 'CANCELED_ZERO_FREE')
              input = json({
                kind: 'SENTIENT',
                initialInput: {
                  // CORE006 manual FREE -2 yields actual S/M/Z=1 before AQ2015's loss floor.
                  baseStats: { S: 3, D: 20, M: 3, Z: 3, I: 20, W: 2, C: 20 },
                  build: {
                    raceCode: 'FREE',
                    pureClassOrNull: null,
                    skillSelections: [{ skillKey: 'LEARNING', targetBonus: 1 }],
                  },
                },
                advisorSkills: [],
              });
            const c = old.compositionOrNull;
            selection = json({
              symbiontCompositionMode: c.symbiontCompositionMode,
              ordinarySymbiontInstances: c.ordinarySymbiontInstances,
              symbioticMonsterProfileIdOrNull: c.symbioticMonsterProfileIdOrNull,
              monsterOrNull: c.monsterOrNull,
            });
          } finally {
            oldComposed.close();
          }
          const replace = () => {
            app().command(
              request('VERSION_CONFIGURATION', { operation: 'PREVIEW_REPLACEMENT', input }),
            );
            const preview =
              readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.replacementPreviewOrNull;
            if (preview == null) throw new Error('Missing owning replacement preview');
            app().command(
              request(
                'VERSION_CONFIGURATION',
                json({
                  operation: 'CONFIRM_REPLACEMENT',
                  previewCommandId: preview.previewCommandId,
                  input,
                  displayedPreview: preview,
                  consent: true,
                }),
              ),
            );
          };
          const select = () => {
            app().command(
              request('SENTIENT_SYMBIONTS', {
                operation: 'PREVIEW',
                selection,
                advisorRemovalConfirmed: false,
              }),
            );
            const attempt = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
            if (
              attempt?.kind !== 'SENTIENT' ||
              attempt.compositionOrNull == null ||
              !('schemaVersion' in attempt.compositionOrNull)
            )
              throw new Error('Missing actual composition preview');
            const c = attempt.compositionOrNull;
            app().command(
              request('SENTIENT_SYMBIONTS', {
                operation: 'CONFIRM',
                previewCommandId: c.previewCommandId,
                interactionsConfirmed: true,
                manualFacesOrNull:
                  c.diceModeSnapshot === 'MANUAL' &&
                  attempt.compositionAcquisitions?.freeSlotOrNull == null
                    ? [6]
                    : null,
              }),
            );
          };
          replace();
          const beforeRoll = vi.mocked(randomInt).mock.calls.length;
          select();
          const acquired = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
          if (acquired?.kind !== 'SENTIENT') throw new Error('Missing actual FREE acquisition');
          const fact = acquired.compositionAcquisitions?.freeSlotOrNull;
          expect(fact).not.toBeNull();
          expect(fact).not.toBeUndefined();
          if (fact == null) throw new Error('Missing actual fixed FREE consequence');
          if (variant === 'CANCELED_ZERO_FREE') {
            expect(fact.statsBefore).toEqual({ S: 1, M: 1, Z: 1 });
            expect(fact.permanentStatConsequence).toEqual({ S: 0, M: 0, Z: 0 });
          }
          retainedRngCount = vi.mocked(randomInt).mock.calls.length;
          expect(retainedRngCount - beforeRoll).toBe(fact?.roll.modeSnapshot === 'AUTO' ? 1 : 0);
          nav('ENM-017::CTA::005');
          expect(db.prepare('SELECT count(*) AS n FROM campaign_enemy_version').get()).toEqual({
            n: 1,
          });
          nav('ENM-020::CTA::002');
          nav('ENM-001::CTA::008');
          const reopened = readCurrent().viewOrNull?.enemyAuthoring;
          expect(reopened?.attemptOrNull).not.toHaveProperty('schemaVersion');
          const facts = reopened?.versionAttempt?.retainedMandatoryFacts;
          if (facts?.kind !== 'SENTIENT')
            throw new Error('Missing owning canceled mandatory prefix');
          expect(facts.freeSlotOrNull).toEqual(fact);
          if (variant === 'CANCELED_ZERO_FREE') {
            expect(reopened?.attemptOrNull).toEqual({
              ...copied,
              attemptId: reopened?.attemptOrNull?.attemptId,
              revision: 0,
            });
            expect(reopened?.attemptOrNull).not.toHaveProperty('compositionAcquisitions');
            expect(reopened?.attemptOrNull).not.toHaveProperty('skillPlanState');
          } else {
            app().command(
              request('VERSION_CONFIGURATION', {
                operation: 'SET_REASON',
                reason: 'Новая конфигурация с сохранённым обязательным R6',
              }),
            );
            const unchanged = db.serialize();
            expect(() => app().command(request(null))).toThrow('INVALID_INPUT');
            expect(db.serialize().equals(unchanged)).toBe(true);
            expect(vi.mocked(randomInt).mock.calls.length).toBe(retainedRngCount);
            replace();
            select();
            const currentAttempt = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
            if (
              currentAttempt?.kind !== 'SENTIENT' ||
              currentAttempt.compositionOrNull == null ||
              !('schemaVersion' in currentAttempt.compositionOrNull)
            )
              throw new Error('Missing reacquired composition');
            expect(currentAttempt.compositionAcquisitions?.freeSlotOrNull).toEqual(fact);
            app().command(
              request('SENTIENT_SYMBIONTS', {
                operation: 'FINISH',
                previewCommandId: currentAttempt.compositionOrNull.previewCommandId,
                skills: { advisorSkills: [], dolphinSkills: [] },
              }),
            );
            app().command(
              request('SENTIENT_INVENTORY', {
                inventoryItems: [],
                armorCompatibilityReasonOrNull: null,
              }),
            );
            expect(vi.mocked(randomInt).mock.calls.length).toBe(retainedRngCount);
            if (
              copied?.kind !== 'SENTIENT' ||
              copied.baseStatsOrNull === null ||
              copied.buildOrNull === null
            )
              throw new Error('Missing genuine legacy PURE initial basis');
            expect(copied.buildOrNull.raceCode).toBe('PURE');
            input = json({
              kind: 'SENTIENT',
              initialInput: {
                baseStats: copied.baseStatsOrNull,
                build: copied.buildOrNull,
              },
              advisorSkills: [],
            });
            selection = json({
              symbiontCompositionMode: 'ORDINARY_SYMBIONTS',
              ordinarySymbiontInstances: [],
              symbioticMonsterProfileIdOrNull: null,
              monsterOrNull: null,
            });
            replace();
            select();
            const pure = readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull;
            if (
              pure?.kind !== 'SENTIENT' ||
              pure.compositionOrNull == null ||
              !('schemaVersion' in pure.compositionOrNull)
            )
              throw new Error('Missing actual PURE/NONE composition');
            app().command(
              request('SENTIENT_SYMBIONTS', {
                operation: 'FINISH',
                previewCommandId: pure.compositionOrNull.previewCommandId,
                skills: { advisorSkills: [], dolphinSkills: [] },
              }),
            );
            app().command(
              request('SENTIENT_INVENTORY', {
                inventoryItems: [],
                armorCompatibilityReasonOrNull: null,
              }),
            );
            const basis = calculateSkillStageStats(catalog.skills, {
              baseStats: copied.baseStatsOrNull,
              raceCode: copied.buildOrNull.raceCode,
              classCode: copied.buildOrNull.pureClassOrNull,
              creationMode: 'MANUAL',
            }).skillStageStats;
            expectedSignedBody = {
              S: basis.S + fact.permanentStatConsequence.S,
              M: basis.M + fact.permanentStatConsequence.M,
              Z: basis.Z + fact.permanentStatConsequence.Z,
            };
            expect(vi.mocked(randomInt).mock.calls.length).toBe(retainedRngCount);
          }
        }
        const priorIdentity = copied?.identityOrNull;
        if (priorIdentity == null) throw new Error('Missing copied identity');
        const editor =
          variant === 'COPY'
            ? enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload)
            : null;
        if (editor !== null) {
          expect(editor.formId).toBe('ENM-017');
          expect(editor.versionEditor?.baseSnapshot).toEqual(saved['attempt']);
          expect(editor.versionEditor?.currentVersion).toEqual(identity);
          expect(editor.versionEditor?.changeSet).toEqual([]);
          expect(editor.context.versionAttempt?.origin.navigationRequestId).toBe(copied?.attemptId);
          expect(editor.validationErrors).toContain('Укажите и сохраните причину новой версии.');
        }
        const renameStage = kind === 'SENTIENT' ? 'SENTIENT_IDENTITY' : 'MONSTER_IDENTITY';
        const renameRequest = request(renameStage, {
          ...priorIdentity,
          name: 'Полная версия два',
        });
        if (editor !== null)
          expect(
            enemyBrowserWorkflow(
              editor,
              'ENM-017::CTA::004',
              renameRequest.commandId,
              renameRequest.payload.data ?? {},
              renameStage,
            ),
          ).toEqual(renameRequest);
        const renamed = app().command(renameRequest);
        expect(renamed.receipt.result['sourceFormId']).toBe('ENM-017');
        if (editor !== null)
          expect(enemyBrowserReceipt(renamed.receipt, renameRequest, editor)).toEqual(
            renamed.receipt,
          );
        const reasoned = app().command(
          request('VERSION_CONFIGURATION', {
            operation: 'SET_REASON',
            reason: 'Уточнение имени полного шаблона',
          }),
        );
        expect(reasoned.receipt.result['sourceFormId']).toBe('ENM-017');
        const commit = request(null);
        const readyEditor = variant === 'COPY' ? app().project() : null;
        const readyProjection =
          readyEditor === null
            ? null
            : enemyAuthoringProjectionValue(readyEditor.base.roleFilteredPayload);
        if (readyProjection !== null) {
          expect(readyProjection.validationErrors).toEqual([]);
          expect(readyEditor?.base.availableActionKeys).toContain('ENM-017::CTA::004');
          expect(
            enemyBrowserWorkflow(readyProjection, 'ENM-017::CTA::004', commit.commandId, {
              reason: readyProjection.context.versionAttempt?.reason ?? '',
            }),
          ).toEqual(commit);
        }
        const result = app().command(commit);
        if (readyProjection !== null)
          expect(enemyBrowserReceipt(result.receipt, commit, readyProjection)).toEqual(
            result.receipt,
          );
        expect(result.replayed).toBe(false);
        expect(result.receipt.result['committedVersionOrNull']).toMatchObject({
          templateId: identity.templateId,
          kind,
          version: 2,
        });
        expect(oldRows()).toEqual(original);
        expect(
          db.prepare('SELECT version FROM campaign_enemy_version ORDER BY version').all(),
        ).toEqual([{ version: 1 }, { version: 2 }]);
        expect(db.prepare('SELECT count(*) AS n FROM campaign_enemy_history').get()).toEqual({
          n: 2,
        });
        const current = r.record(result.receipt.result['committedVersionOrNull'], '$.identity');
        expect(db.prepare('SELECT version_id FROM campaign_enemy_current_version').get()).toEqual({
          version_id: current['versionId'],
        });
        db.close();
        db = openPersistenceDatabase(filename);
        expect(app().command(commit)).toEqual({ ...result, replayed: true });
        const originalRequestKey =
          folder === 'enemy-empty-v1' ? 'originalCommitRequest' : 'commitRequest';
        const originalResultKey =
          folder === 'enemy-empty-v1' ? 'originalCommitResult' : 'commitResult';
        expect(app().command(metadata[originalRequestKey])).toEqual({
          ...r.record(metadata[originalResultKey], '$.result'),
          replayed: true,
        });
        const projection = enemyAuthoringProjectionValue(app().project().base.roleFilteredPayload);
        if (readyProjection !== null)
          expect(
            enemyBrowserDestination(
              {
                formId: projection.formId,
                projection: json(projection),
                revisions: {
                  stateRevision: projection.stateRevision,
                  projectionRevision: projection.projectionRevision,
                  actorVisibilityRevision: projection.actorVisibilityRevision,
                },
              },
              readyProjection,
              result.receipt,
            ),
          ).toBe(true);
        expect(projection.formId).toBe('ENM-020');
        expect(projection.context.selectedVersionOrNull).toEqual(current);
        expect(projection.sheetOrNull?.identity.name).toBe('Полная версия два');
        if (expectedMechanicalPlan !== null) {
          let reopenedVersions: ReturnType<typeof readEnemyVersions> = [];
          readCurrent((source, state) => {
            reopenedVersions = readEnemyVersions(db, source.scope, state.events);
          });
          const reopened = reopenedVersions.find((version) => version.identity.version === 2);
          if (
            reopened?.attempt.kind !== 'SENTIENT' ||
            projection.kind !== 'SENTIENT_ENEMY_AUTHORING' ||
            projection.sheetOrNull === null
          )
            throw new Error('Missing actual reopened mechanical V2');
          expect(reopened.attempt.skillPlanState?.planOrNull).toEqual(expectedMechanicalPlan);
          expect(reopened.attempt.compositionAcquisitions?.freeSlotOrNull).toEqual(
            r.record(
              r.record(saved['attempt'], '$.oldAttempt')['compositionAcquisitions'],
              '$.oldAcquisitions',
            )['freeSlotOrNull'],
          );
          expect(
            projection.sheetOrNull.skills.find((skill) => skill.skillKey === 'GROSS')?.bonus,
          ).toBe(4);
          expect(expectedMechanicalPlan.accountingOrNull?.grossGrantOrNull?.bonusBefore).toBe(1);
          expect(expectedMechanicalPlan.accountingOrNull?.grossGrantOrNull?.bonusAfter).toBe(4);
        }
        if (variant === 'COPY') {
          expect(projection.versionHistory?.current).toEqual(current);
          expect(projection.versionHistory?.selected).toEqual(current);
          expect(projection.versionHistory?.entries.map((entry) => entry.identity.version)).toEqual(
            [1, 2],
          );
          expect(projection.versionHistory?.entries[1]?.changeSet).toEqual([
            {
              path: '/identityOrNull/name',
              before: { present: true, value: priorIdentity.name },
              after: { present: true, value: 'Полная версия два' },
            },
          ]);
          expect(projection.versionHistory?.activeCombatPins).toEqual([]);
          const immutableTables = () =>
            Object.fromEntries(
              [
                'campaign_enemy_template',
                'campaign_enemy_version',
                'campaign_enemy_history',
                'campaign_enemy_current_version',
              ].map((table) => [
                table,
                db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(),
              ]),
            );
          const stored = immutableTables();
          const historyView = readCurrent().viewOrNull;
          if (historyView === null) throw new Error('Missing history view');
          const selectHistory = {
            messageType: 'network.enemy-selection.replace' as const,
            protocolVersion: 3 as const,
            operationId: randomUUID(),
            contextId: scope.gmLocalContextId,
            campaignId: scope.campaignId,
            sourceFormId: 'ENM-020' as const,
            activeTab: kind === 'SENTIENT' ? ('SENTIENT_ENEMIES' as const) : ('MONSTERS' as const),
            expectedRevisions: {
              stateRevision: historyView.stateRevision,
              projectionRevision: historyView.projectionRevision,
              actorVisibilityRevision: historyView.actorVisibilityRevision,
            },
            selectionOrNull: null,
            userSelectionOrNull: identity,
          };
          const selectedHistory = lib().select(selectHistory);
          const historical = enemyAuthoringProjectionValue(
            app().project().base.roleFilteredPayload,
          );
          expect(historical.context.selectedVersionOrNull).toEqual(identity);
          expect(historical.sheetOrNull).toEqual(saved['sheet']);
          expect(historical.versionHistory?.selected).toEqual(identity);
          expect(historical.versionHistory?.current).toEqual(current);
          expect(readCurrent().viewOrNull?.enemyLibrary?.userSelectionOrNull).toEqual(current);
          expect(immutableTables()).toEqual(stored);
          nav('ENM-020::CTA::002');
          const beforeHistoryReplay = db.serialize();
          const replayedHistory = lib().select(selectHistory);
          expect(replayedHistory.event).toEqual(selectedHistory.event);
          expect(replayedHistory.view.formId).toBe('ENM-001');
          expect(db.serialize().equals(beforeHistoryReplay)).toBe(true);
          const catalogProjection = lib().project().base.roleFilteredPayload;
          expect(catalogProjection['currentUserTemplates']).toEqual([
            { ...current, displayName: 'Полная версия два' },
          ]);
          nav('ENM-001::CTA::008');
          expect(readCurrent().viewOrNull?.enemyAuthoring?.versionAttempt?.origin.base).toEqual(
            current,
          );
          expect(
            readCurrent().viewOrNull?.enemyAuthoring?.attemptOrNull?.identityOrNull?.name,
          ).toBe('Полная версия два');
          const laterAttempt = structuredClone(readCurrent().viewOrNull?.enemyAuthoring);
          const beforeLaterReplay = db.serialize();
          const laterReplay = lib().select(selectHistory);
          expect(laterReplay.event).toEqual(selectedHistory.event);
          expect(laterReplay.view.formId).toBe('ENM-017');
          expect(readCurrent().viewOrNull?.enemyAuthoring).toEqual(laterAttempt);
          expect(db.serialize().equals(beforeLaterReplay)).toBe(true);
          expect(immutableTables()).toEqual(stored);
          nav('ENM-017::CTA::005');
          expect(immutableTables()).toEqual(stored);
        }
        if (expectedSignedBody !== null) {
          if (projection.kind !== 'SENTIENT_ENEMY_AUTHORING' || projection.sheetOrNull === null)
            throw new Error('Missing final source-backed PURE full sheet');
          expect(projection.sheetOrNull.build.raceCode).toBe('PURE');
          expect(projection.sheetOrNull.composition.ordinarySymbiontInstances).toEqual([]);
          for (const stat of ['S', 'M', 'Z'] as const)
            expect(projection.sheetOrNull.permanentStats[stat]).toBe(expectedSignedBody[stat]);
        }
        if (retainedRngCount !== null)
          expect(vi.mocked(randomInt).mock.calls.length).toBe(retainedRngCount);
        if (variant === 'CANCELED_ZERO_FREE') {
          let versions: ReturnType<typeof readEnemyVersions> = [];
          readCurrent((source, state) => {
            versions = readEnemyVersions(db, source.scope, state.events);
          });
          const appended = versions.find((row) => row.identity.version === 2);
          expect(appended?.attempt).not.toHaveProperty('schemaVersion');
          expect(appended?.attempt).not.toHaveProperty('skillPlanState');
          expect(appended?.attempt).not.toHaveProperty('compositionAcquisitions');
          expect(appended?.versionSource?.retainedMandatoryFacts).toMatchObject({
            kind: 'SENTIENT',
            freeSlotOrNull: { permanentStatConsequence: { S: 0, M: 0, Z: 0 } },
          });
          expect(appended?.sheet).toEqual({
            ...r.record(saved['sheet'], '$.oldSheet'),
            identity: { ...priorIdentity, name: 'Полная версия два' },
          });
        }
        expect(oldRows()).toEqual(original);
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        if (db.open) db.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
    variant === 'COPY' && kind === 'CUSTOM_MONSTER'
      ? 120_000
      : variant === 'COPY' || variant === 'REGISTRY'
        ? 60_000
        : variant === 'NEGATIVE' || variant === 'SOURCE'
          ? 180_000
          : variant === 'MECHANICAL'
            ? 900_000
            : variant === 'CANCELED_SENTIENT_CARD'
              ? 600_000
              : variant === 'CANCELED_CARD'
                ? 300_000
                : 120_000,
  ); // ADR0088: full-cohort body-timeout markers were MECHANICAL 572.129 s, CUSTOM COPY 67.141 s, CUSTOM card 191.543 s and SENTIENT card 391.571 s. Only these named bodies receive rounded 1.5x finite headroom; timings establish neither a resource cause nor a CI duration guarantee.
}

it('refuses source-valid-shaped changed displayed replacement costs, capacity or skills without any owning write', async () => {
  const source = await createEnemyVersionClientFixture('SENTIENT', {
    legacy: true,
    observe: ({ command, snapshot, preview }) => {
      const actual = preview.context.versionAttempt?.replacementPreviewOrNull;
      if (actual == null || actual.inputSummary.kind !== 'SENTIENT')
        throw new Error('Missing actual source-derived summary');
      const before = snapshot();
      for (const change of ['capacity', 'cost', 'skill'] as const) {
        const shown = structuredClone(actual);
        if (shown.inputSummary.kind !== 'SENTIENT') throw new Error('Wrong summary kind');
        if (change === 'capacity') Object.assign(shown.inputSummary, { startCapacity: 999 });
        else {
          const first = shown.inputSummary.initialSkills[0];
          if (first === undefined) throw new Error('Missing actual initial skill');
          Object.assign(first, change === 'cost' ? { slotCost: 999 } : { skillKey: 'LEARNING' });
        }
        // This is deliberately shape-valid. Actual game maths is checked by the host, not by JSX.
        expect(() =>
          command(
            structuredClone(
              w.jsonObject(
                {
                  operation: 'CONFIRM_REPLACEMENT',
                  input: actual.input,
                  previewCommandId: actual.previewCommandId,
                  displayedPreview: shown,
                  consent: true,
                },
                '$.tamper',
              ),
            ),
          ),
        ).toThrow();
        expect(snapshot()).toEqual(before);
      }
    },
  });
  expect(source.immutableEnemyRowsUnchanged).toBe(true);
}, 360_000); // ADR0088: this SENTIENT display-summary body timed out with a 235.630 s cohort marker; rounded 1.5x finite headroom is not a cause or duration guarantee.

it('rederives a coherently rehashed historical replacement summary at its actual earlier prefix after a later clean reason edit', async () => {
  await createEnemyVersionClientFixture('SENTIENT', {
    afterReason: ({ database, checkedRead, structuralRead, previewCommandId }) => {
      const rows = database
        .prepare<[], { event_id: string; record_json: string }>(
          'SELECT event_id,record_json FROM gm_request_queue_event ORDER BY event_index',
        )
        .all();
      let predecessor: string | null = null,
        changed = false;
      for (const row of rows) {
        const event = r.record(JSON.parse(row.record_json), '$.event');
        const view = r.record(event['view'], '$.view');
        if (row.event_id === previewCommandId) {
          const mutation = r.record(event['mutation'], '$.mutation');
          const cause = r.record(mutation['cause'], '$.cause');
          const prepared = r.record(cause['preparedVersionConfiguration'], '$.prepared');
          const preparedState = r.record(prepared['state'], '$.preparedState');
          const authoring = r.record(view['enemyAuthoring'], '$.authoring');
          const viewState = r.record(authoring['versionAttempt'], '$.versionState');
          for (const state of [preparedState, viewState]) {
            const preview = r.record(state['replacementPreviewOrNull'], '$.preview');
            const summary = r.record(preview['inputSummary'], '$.summary');
            expect(summary['kind']).toBe('SENTIENT');
            const first = r.record(r.list(summary['initialSkills'], '$.skills')[0], '$.skill');
            expect(first['slotCost']).not.toBe(999);
            Reflect.set(first, 'slotCost', 999); // All keys/types and actual input remain valid.
          }
          changed = true;
        }
        const { snapshotSha256: _snapshot, ...body } = view;
        Reflect.set(view, 'snapshotSha256', campaignCreationHash(body));
        Reflect.set(event, 'previousEventSha256OrNull', predecessor);
        predecessor = campaignCreationHash(event);
        database
          .prepare(
            'UPDATE gm_request_queue_event SET record_json=?,record_sha256=? WHERE event_id=?',
          )
          .run(storage.canonical(event), predecessor, row.event_id);
      }
      expect(changed).toBe(true);
      const structural = structuralRead();
      expect(structural.viewOrNull?.formId).toBe('ENM-017');
      expect(
        structural.viewOrNull?.enemyAuthoring?.versionAttempt?.replacementPreviewOrNull,
      ).toBeNull();
      expect(
        structural.events.find((event) => event.eventId === previewCommandId)?.view.enemyAuthoring
          ?.versionAttempt?.replacementPreviewOrNull?.inputSummary.kind,
      ).toBe('SENTIENT');
      const bytes = database.serialize();
      expect(() => checkedRead()).toThrow('network application storage: SOURCE_CHANGED');
      expect(database.serialize()).toEqual(bytes);
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    },
  });
}, 60_000);
