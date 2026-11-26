import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_ATLAS_PATHS,
  applyFixtureAtlasPatch,
  readFixtureAtlas,
} from '../../tests/fixtures/baseline-atlas-patch.js';
import {
  assertAdr0096HostLocalHandoff,
  assertAdr0096HostLocalMarkdown,
} from './host-local-handoff-atlas-contract.js';
import {
  assertAdr0095LocalOwnerBinding,
  assertAdr0095LocalOwnerMarkdown,
} from './local-owner-binding-atlas-contract.js';
import { ARTIFACT, REPO_ROOT, SPEC_DIR } from './lib/paths.js';
import type { JsonObject, JsonValue } from './lib/json.js';
import {
  assertAdr0097ExistingOwnerLibrary,
  assertAdr0097ExistingOwnerLibraryMarkdown,
  assertExistingOwnerLibraryRenderer,
  OWNER_LIBRARY_RETURN_TRIGGER,
} from './existing-owner-library-atlas-contract.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const md = readFileSync(ARTIFACT.atlasMd, 'utf8');
const forms = source['forms'] as JsonObject[];
const global = source['globalContracts'] as JsonObject;
const declaration = global['existingOwnerLibraryReentry'] as JsonObject;

describe('ADR 0097 re-entry through a newly signed device handoff', () => {
  it('imports the complete owner and GM routes, both independent Markdown and renderer mirrors, and the actual library journey trigger', () => {
    assertAdr0097ExistingOwnerLibrary(source);
    assertAdr0097ExistingOwnerLibraryMarkdown(md, source);
    const read = (name: string) =>
      JSON.parse(
        readFileSync(join(SPEC_DIR, 'atlas/renderer', name + '.json'), 'utf8'),
      ) as JsonObject;
    const catalogue = read('forms-by-id'),
      primary = read('primary-actions-by-form-id'),
      routes = read('transitions-by-form-and-trigger');
    const transitions = JSON.parse(
      readFileSync(join(SPEC_DIR, 'atlas/transitions.json'), 'utf8'),
    ) as JsonObject[];
    const fullForms = JSON.parse(
      readFileSync(join(SPEC_DIR, 'atlas/forms-by-id.json'), 'utf8'),
    ) as Record<string, JsonObject>;
    const emitted = { ...source, forms: Object.values(fullForms), transitions };
    assertExistingOwnerLibraryRenderer(emitted, catalogue, primary, routes);
    const indexed = routes['APP-004'] as JsonObject;
    expect(indexed).not.toHaveProperty(OWNER_LIBRARY_RETURN_TRIGGER);
    const shared = transitions.filter(
      (edge) => edge['from'] === 'APP-004' && edge['trigger'] === OWNER_LIBRARY_RETURN_TRIGGER,
    );
    expect(shared.map((edge) => edge['to']).sort()).toEqual(['APP-003', 'APP-006', 'APP-007']);
    const target = shared.find((edge) => edge['to'] === 'APP-003')!;
    const sibling = shared.find((edge) => edge['to'] === 'APP-006')!;
    for (const altered of [
      transitions.filter((edge) => edge !== target),
      transitions.map((edge) => (edge === target ? sibling : edge)),
    ]) {
      expect(altered).toContain(sibling);
      expect(altered).toContain(shared.find((edge) => edge['to'] === 'APP-007'));
      expect(() =>
        assertExistingOwnerLibraryRenderer(
          { ...emitted, transitions: altered },
          catalogue,
          primary,
          routes,
        ),
      ).toThrow(OWNER_LIBRARY_RETURN_TRIGGER);
    }
  });

  it.each(['APP-003::CTA::015', 'APP-003::CTA::014', 'APP-004::CTA::002'])(
    'rejects the same unauthorized guard on %s in the CTA and all three copies of the route',
    (key) => {
      const from = key.split('::')[0]!;
      const original = forms.find((f) => f['id'] === from)!;
      const actions = original['actions'] as JsonObject;
      const ctas = actions['ctaAvailabilityByAction'] as JsonObject[];
      const cta = ctas.find((row) => row['actionKey'] === key)!;
      const trigger = key === 'APP-004::CTA::002' ? OWNER_LIBRARY_RETURN_TRIGGER : cta['label'];
      const guard = 'Use historical delivery without checking the current campaign or owner.';
      const amend = (edges: JsonObject[]) =>
        edges.map((edge) =>
          edge['trigger'] === trigger &&
          (edge['from'] === undefined || edge['from'] === from) &&
          (edge['to'] === undefined || edge['to'] === cta['targetFormId'])
            ? { ...edge, guard }
            : edge,
        );
      const changed = forms.map((form) => {
        if (form['id'] !== from && form['id'] !== cta['targetFormId']) return form;
        return {
          ...form,
          ...(form['id'] === from
            ? {
                actions: {
                  ...actions,
                  ctaAvailabilityByAction: ctas.map((row) =>
                    row === cta ? { ...cta, guard } : row,
                  ),
                },
                transitionsOut: amend(form['transitionsOut'] as JsonObject[]),
              }
            : {}),
          ...(form['id'] === cta['targetFormId']
            ? { transitionsIn: amend(form['transitionsIn'] as JsonObject[]) }
            : {}),
        };
      });
      expect(() =>
        assertAdr0097ExistingOwnerLibrary({
          ...source,
          forms: changed,
          transitions: amend(source['transitions'] as JsonObject[]),
        }),
      ).toThrow('executable action guards');
    },
  );

  it('keeps the signed same-campaign return and the preselected owner-safe batch alongside the new library basis', () => {
    const commands = (source['registryCoverage'] as JsonObject)['workflowCommands'] as JsonObject[];
    const ack = commands.find((row) => row['commandId'] === 'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK')!;
    expect(ack['guards']).toContain(
      'The only HOST_LOCAL_CANDIDATE target ACK paths are the initial signed APP-003::CTA::013 bootstrap, the verified same-campaign CMP-009::CTA::004 pre-SUBMIT return, the separate signed APP-003::CTA::003 owner-safe batch, the initial BIND target or its deferred continuation, and the current signed EXISTING_OWNER_LIBRARY.',
    );
    const guard = (id: string, key: string) => {
      const form = forms.find((item) => item['id'] === id)!;
      const actions = (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[];
      return actions.find((item) => item['actionKey'] === key)?.['guard'];
    };
    expect(guard('CMP-009', 'CMP-009::CTA::004')).toContain(
      'Previously created own drafts and FINAL remain available; emptiness is not rechecked.',
    );
    expect(guard('APP-003', 'APP-003::CTA::003')).toContain(
      'Recheck each exact sourceUuid against current membership for that profile',
    );
    expect(guard('PLY-030', 'PLY-030::CTA::004')).toContain(
      'The separate signed APP-003::CTA::003 owner-safe batch retains its existing dispatch.',
    );
  });

  it.each([
    ['and the current signed EXISTING_OWNER_LIBRARY.', 'and any supplied former grant.'],
    [
      'the initial BIND target or its deferred continuation',
      'a target whose selector is still visible',
    ],
    ['the verified same-campaign CMP-009::CTA::004 pre-SUBMIT return, ', ''],
    ['the separate signed APP-003::CTA::003 owner-safe batch, ', ''],
    [
      'for the same exact profile, campaign and entire original GM origin',
      'for any profile with a matching label',
    ],
    [
      'Recheck each exact sourceUuid against current membership for that profile',
      'Reopen any formerly supplied UUID',
    ],
    [
      'the current signed pendingContinuationId and an independent explicit target ACK',
      'any previous target ACK',
    ],
  ])('rejects broadening the ACK registry and its curtain mirror together: %s', (before, after) => {
    const id = 'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK';
    const registry = source['registryCoverage'] as JsonObject;
    const commands = registry['workflowCommands'] as JsonObject[];
    const original = commands.find((row) => row['commandId'] === id)!;
    const originalGuard = original['guards'] as string;
    const guard = originalGuard.replace(before, after);
    expect(guard).not.toBe(originalGuard);
    const curtain = forms.find((f) => f['id'] === 'PLY-030')!;
    const actions = curtain['actions'] as JsonObject;
    const advertised = actions['workflowCommandAvailability'] as JsonObject[];
    const changedCurtain = {
      ...curtain,
      actions: {
        ...actions,
        workflowCommandAvailability: advertised.map((row) =>
          row['commandId'] === id ? { ...row, guard } : row,
        ),
      },
    };
    const altered = {
      ...source,
      registryCoverage: {
        ...registry,
        workflowCommands: commands.map((row) =>
          row === original ? { ...row, guards: guard } : row,
        ),
      },
      forms: forms.map((f) => (f === curtain ? changedCurtain : f)),
    };
    expect(() => assertAdr0097ExistingOwnerLibrary(altered)).toThrow('signed target bases');
  });

  it.each([
    ['entry', 'neutralDisclosure', 'Reveal names and count before ACK.'],
    ['target', 'signedFields', ['targetProfileLabel']],
    ['cancel', 'returnActionKey', 'CMP-009::CTA::005'],
    ['return', 'selectionMinimum', 1],
    ['continuation', 'historical', 'Reuse the historical continuation.'],
  ] satisfies [string, string, JsonValue][])(
    'refuses a changed %s.%s even when its Markdown would agree',
    (section, field, invalid) => {
      const altered = {
        ...declaration,
        [section]: { ...(declaration[section] as JsonObject), [field]: invalid },
      };
      expect(() =>
        assertAdr0097ExistingOwnerLibrary({
          ...source,
          globalContracts: { ...global, existingOwnerLibraryReentry: altered },
        }),
      ).toThrow('existingOwnerLibraryReentry');
    },
  );

  it.each(['LIFETIME', 'CONFLICT', 'PRIVACY'])(
    'requires the full %s acceptance case in the supplied JSON and its Markdown',
    (suffix) => {
      const id = 'QA-LOCAL-OWNER-REENTRY-' + suffix;
      const all = source['qaScenarios'] as JsonObject[];
      const row = all.find((item) => item['qaId'] === id)!;
      const altered = all.map((item) =>
        item === row ? { ...row, expected: 'Allow a stale delivery.' } : item,
      );
      expect(() => assertAdr0097ExistingOwnerLibrary({ ...source, qaScenarios: altered })).toThrow(
        'QA cases',
      );
      const line = md.split('\n').find((s) => s.startsWith('| ' + id + ' |'))!;
      expect(() =>
        assertAdr0097ExistingOwnerLibraryMarkdown(
          md.replace(line, line.replace(/ \|$/, ' changed |')),
          source,
        ),
      ).toThrow(id);
    },
  );

  it('rejects a narrowed selection boundary in the independent Markdown declaration', () => {
    const changed = md.replace(
      /(\| return \| .*"selectionMinimum": )0/,
      (_match, prefix: string) => prefix + '1',
    );
    expect(changed).not.toBe(md);
    expect(() => assertAdr0097ExistingOwnerLibraryMarkdown(changed, source)).toThrow('Markdown');
  });

  it('validates the two exact predecessor releases with their original binding and available handoff contracts', () => {
    const [jsonPath, markdownPath] = FIXTURE_ATLAS_PATHS;
    let bytes = readFixtureAtlas(REPO_ROOT);
    for (const [patch, version] of [
      ['300', '1.24'],
      ['297', '1.23'],
    ] as const) {
      bytes = applyFixtureAtlasPatch(
        bytes,
        readFileSync(join(REPO_ROOT, 'tests/fixtures', 'atlas-' + patch + '-lineage.patch')),
        true,
      );
      const historical = JSON.parse(bytes[jsonPath].toString('utf8')) as JsonObject;
      const companion = bytes[markdownPath].toString('utf8');
      expect(historical['atlasVersion']).toBe(version);
      assertAdr0095LocalOwnerBinding(historical);
      assertAdr0095LocalOwnerMarkdown(companion);
      if (version === '1.24') {
        assertAdr0096HostLocalHandoff(historical);
        assertAdr0096HostLocalMarkdown(companion, historical);
        expect(() =>
          assertAdr0096HostLocalHandoff({ ...historical, atlasVersion: '1.25' }),
        ).toThrow('actionGuards');
      }
      expect(() => assertAdr0095LocalOwnerBinding({ ...historical, atlasVersion: '1.25' })).toThrow(
        'modeActions',
      );
      expect(() => assertAdr0097ExistingOwnerLibrary(historical)).toThrow('atlasVersion');
    }
  });
});
