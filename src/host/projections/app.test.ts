import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  APP_002_VERTICAL_ACTION_KEYS,
  APP_004_VERTICAL_ACTION_KEYS,
  APP_001_BOOT_STATES,
  APP_FORM_IDS,
  loadAppProjectionCatalog,
  projectApp001Bootstrap,
  projectApp004,
  projectAppForm,
} from './app.js';
import type { AppProjectionCatalog } from './app.js';

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

type SourceForm = { readonly requiredFields: readonly string[]; readonly roles: readonly string[] };

function sourceForms(value: unknown): Readonly<Record<string, SourceForm>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('forms-by-id test source is not an object');
  }
  return value as Readonly<Record<string, SourceForm>>;
}

describe('APP host projection', () => {
  let catalog: AppProjectionCatalog;
  let forms: Readonly<Record<string, SourceForm>>;

  beforeAll(async () => {
    catalog = await loadAppProjectionCatalog(PROJECT_ROOT);
    forms = sourceForms(
      JSON.parse(
        await readFile(
          join(PROJECT_ROOT, 'generated', 'spec', 'atlas', 'forms-by-id.json'),
          'utf8',
        ),
      ) as unknown,
    );
  });

  it('derives every APP-001 value from its checked repository source', () => {
    expect(APP_001_BOOT_STATES).toEqual(['BOOTING', 'READY', 'ERROR']);
    expect(catalog.app001).toEqual({
      baselineCompatibility: {
        builtAgainstTuple: {
          status: 'PASS',
          value:
            'Rules v1.6 | Character-Skills-Symbionts v1.1 | Items v1.5_with_icons | Bestiary v1.3 | Sentient v1.2',
        },
        catalogVersion: {
          status: 'PASS',
          value: 'SYMBIOSIS_CHARACTER_SKILLS_SYMBIONTS_V1.2',
        },
        registryVersion: { status: 'PASS', value: '1.2' },
      },
      bootState: 'READY',
      buildVersion: '0.0.0',
      formId: 'APP-001',
      integrityStatus: {
        changed: [],
        missing: [],
        ok: true,
        tracked: 20,
        untracked: [],
      },
    });
  });

  it('loads the six slice actions with their exact source-owned guards', () => {
    expect(APP_002_VERTICAL_ACTION_KEYS).toEqual(['APP-002::CTA::002', 'APP-002::CTA::007']);
    expect(APP_004_VERTICAL_ACTION_KEYS).toEqual(['APP-004::CTA::001', 'APP-004::CTA::007']);
    expect(catalog.actions.size).toBe(6);
    expect(catalog.actions.get('APP-001::CTA::001')).toEqual({
      from: 'APP-001',
      guard:
        'otherwise CTA and target-only data are absent from payload, DOM, accessibility tree, hotkeys and client cache; projectionRole=PLAYER; bootState=READY',
      kind: 'role-branch',
      to: 'APP-002',
      trigger: 'Игрок',
    });
    expect(catalog.actions.get('APP-002::CTA::002')).toEqual({
      from: 'APP-002',
      guard: 'player launch-mode',
      kind: 'normative',
      to: 'APP-004',
      trigger: 'Локальные персонажи',
    });
    expect(catalog.actions.get('APP-002::CTA::007')).toEqual({
      from: 'APP-002',
      guard: 'player launch-mode; new immutable draft UUID',
      kind: 'normative',
      to: 'CHR-001',
      trigger: 'Создать персонажа',
    });
    expect(catalog.actions.get('CHR-001::CTA::002')).toEqual({
      from: 'CHR-001',
      guard:
        'draft has no irreversible displayed result; deleting this draft requires explicit confirmation elsewhere and any later draft receives a new UUID',
      kind: 'safe-return',
      to: 'APP-004',
      trigger: 'Отменить новый черновик',
    });
    const createCharacterTrigger = 'Открыть «Создание персонажа: идентичность»';
    expect(catalog.actions.get('APP-004::CTA::001')).toEqual({
      from: 'APP-004',
      guard:
        'Новый immutable UUID; обязательны имя, возраст, пол и положительная massKg 0,1; описание/арт необязательны.',
      kind: 'subflow',
      to: 'CHR-001',
      trigger: createCharacterTrigger,
    });
    expect(catalog.actions.get('APP-004::CTA::007')).toEqual({
      from: 'APP-004',
      guard:
        'activeRole=PLAYER; launchContext=PLAYER_MENU; handoffType!=HOST_LOCAL_CANDIDATE; no uncommitted irreversible wizard or import commit; draft checkpoints preserved',
      kind: 'safe-return',
      to: 'APP-002',
      trigger: 'Вернуться в главное меню игрока',
    });
  });

  it('projects the canonical device-owned APP-004 library by lifecycle', () => {
    const result = projectApp004(catalog, 'player', {
      libraryEntries: [
        { lifecycleState: 'EXPORTED', localCharacterId: 'final-b' },
        { lifecycleState: 'DRAFT', localCharacterId: 'draft-c' },
        { lifecycleState: 'DELETED', localCharacterId: 'deleted' },
        { lifecycleState: 'VALID', localCharacterId: 'draft-a' },
        { lifecycleState: 'FINAL', localCharacterId: 'final-a' },
        { lifecycleState: 'VARIANT', localCharacterId: 'draft-b' },
      ],
      localCharacterLibraryRevision: 4,
      projectionRevision: 9,
      stateRevision: 7,
    });
    expect(result).toEqual({
      ok: true,
      projection: {
        campaignAuthority: false,
        draftCharacterIds: ['draft-a', 'draft-b', 'draft-c'],
        finalCharacterIds: ['final-a', 'final-b'],
        handoffIdOrNull: null,
        handoffReceiptIdOrNull: null,
        launchContext: 'PLAYER_MENU',
        localCharacterLibraryRevision: 4,
        localOwnerIdOrNull: null,
        projectionRevision: 9,
        returnContext: 'PLAYER_MENU',
        stateRevision: 7,
      },
    });
  });

  it('refuses role disclosure and malformed APP-004 library membership', () => {
    const denied = projectApp004(catalog, 'gm', {
      libraryEntries: [],
      localCharacterLibraryRevision: 0,
      projectionRevision: 1,
      stateRevision: 0,
    });
    expect(denied).toEqual({
      ok: false,
      refusal: {
        allowedRoles: ['player'],
        formId: 'APP-004',
        kind: 'ROLE_NOT_ALLOWED',
        requestedRole: 'gm',
      },
    });
    expect(JSON.stringify(denied)).not.toContain('draftCharacterIds');

    const values = {
      localCharacterLibraryRevision: 0,
      projectionRevision: 1,
      stateRevision: 0,
    } as const;
    expect(() =>
      projectApp004(catalog, 'player', {
        ...values,
        libraryEntries: [
          { lifecycleState: 'DRAFT', localCharacterId: 'duplicate' },
          { lifecycleState: 'FINAL', localCharacterId: 'duplicate' },
        ],
      }),
    ).toThrow('duplicate localCharacterId "duplicate"');
    expect(() =>
      projectApp004(catalog, 'player', {
        ...values,
        libraryEntries: [{ lifecycleState: 'UNKNOWN', localCharacterId: 'character' }],
      }),
    ).toThrow('unrecognized lifecycle state "UNKNOWN"');
    expect(() =>
      projectApp004(catalog, 'player', {
        ...values,
        libraryEntries: [],
        localCharacterLibraryRevision: -1,
      }),
    ).toThrow('non-negative safe integer');
  });

  it('fully projects APP-001 for player without placeholder fields', () => {
    const result = projectAppForm(catalog, 'player', 'APP-001');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.refusal));
    expect(Object.keys(result.projection).sort()).toEqual([
      'baselineCompatibility',
      'bootState',
      'buildVersion',
      'formId',
      'integrityStatus',
    ]);
  });

  it('builds the role-neutral APP-001 bootstrap through an explicit field filter', () => {
    const sourceWithFutureRoleData = {
      ...catalog,
      app001: { ...catalog.app001, gmOnlyFutureField: 'must not cross bootstrap boundary' },
    } satisfies AppProjectionCatalog;

    expect(projectApp001Bootstrap(sourceWithFutureRoleData)).toEqual(catalog.app001);
    expect(projectApp001Bootstrap(sourceWithFutureRoleData)).not.toHaveProperty(
      'gmOnlyFutureField',
    );
  });

  it('refuses APP-002 through APP-011 with their exact artifact fields', () => {
    for (const formId of APP_FORM_IDS.slice(1)) {
      const source = forms[formId];
      if (source === undefined) throw new Error(`missing source form ${formId}`);
      const role = source.roles[0];
      if (role !== 'player' && role !== 'gm') throw new Error(`invalid source role for ${formId}`);
      const result = projectAppForm(catalog, role, formId);
      expect(result, formId).toEqual({
        ok: false,
        refusal: {
          formId,
          kind: 'MISSING_REQUIRED_FIELDS',
          missingRequiredFields: source.requiredFields,
        },
      });
    }
  });

  it('does not disclose fields from forms unavailable to the requested role', () => {
    const denied = [
      { allowedRoles: ['gm'], formId: 'APP-005', requestedRole: 'player' },
      { allowedRoles: ['gm'], formId: 'APP-011', requestedRole: 'player' },
      { allowedRoles: ['player'], formId: 'APP-002', requestedRole: 'gm' },
      { allowedRoles: ['player'], formId: 'APP-004', requestedRole: 'gm' },
    ] as const;
    for (const { allowedRoles, formId, requestedRole } of denied) {
      const result = projectAppForm(catalog, requestedRole, formId);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`${formId} unexpectedly projected`);
      expect(result.refusal).toEqual({
        allowedRoles,
        formId,
        kind: 'ROLE_NOT_ALLOWED',
        requestedRole,
      });
      const serialized = JSON.stringify(result.refusal);
      const source = forms[formId];
      if (source === undefined) throw new Error(`missing source form ${formId}`);
      for (const field of source.requiredFields) {
        expect(serialized).not.toContain(field);
      }
    }
  });

  it('rejects an unknown form instead of treating it as an empty APP form', () => {
    const unknownFormId = `${'APP-'}999`;
    expect(projectAppForm(catalog, 'player', unknownFormId)).toEqual({
      ok: false,
      refusal: { kind: 'UNKNOWN_FORM', requestedFormId: unknownFormId },
    });
  });
});
