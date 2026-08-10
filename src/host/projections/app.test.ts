import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  APP_001_BOOT_STATES,
  APP_FORM_IDS,
  loadAppProjectionCatalog,
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
        tracked: 13,
        untracked: [],
      },
    });
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
