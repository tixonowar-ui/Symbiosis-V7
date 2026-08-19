/**
 * These tests read the real artifact rather than a fixture: the point of the
 * pipeline is that it agrees with the delivered atlas, and a fixture would only
 * prove the importer agrees with itself.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActionKey } from '@generated/types/atlas.js';
import { describe, expect, it } from 'vitest';
import {
  assertAtlasCounts,
  auditAtlasSections,
  buildRendererQueryIndexes,
  extractActionKeys,
  extractGlobalContracts,
  extractWorkflowCommands,
  projectRendererFormActions,
} from './atlas.js';
import type { JsonObject as ImportJsonObject } from './lib/json.js';
import { ARTIFACT, SPEC_DIR, TYPES_DIR } from './lib/paths.js';

const spec = (name: string): unknown =>
  JSON.parse(readFileSync(join(SPEC_DIR, 'atlas', name), 'utf8'));

const atlasArtifact = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as ImportJsonObject;

const atlasObject = (value: unknown): ImportJsonObject => value as ImportJsonObject;

const clonedAtlas = (): ImportJsonObject => structuredClone(atlasArtifact);

const clonedForms = (): ImportJsonObject[] =>
  structuredClone(atlasArtifact['forms']) as ImportJsonObject[];

const sourceFormId = (form: ImportJsonObject): string => {
  const id = form['id'];
  if (typeof id !== 'string') throw new Error('source form id is not text');
  return id;
};

const firstFormActionRows = (forms: ImportJsonObject[]): ImportJsonObject[] => {
  const firstForm = forms[0];
  if (firstForm === undefined || firstForm['id'] !== 'APP-001') {
    throw new Error('expected APP-001 as the first Atlas form');
  }
  const actions = atlasObject(firstForm['actions']);
  return actions['ctaAvailabilityByAction'] as ImportJsonObject[];
};

const clonedGlobalContracts = (): ImportJsonObject =>
  structuredClone(atlasObject(atlasArtifact['globalContracts']));

type JsonObject = Record<string, unknown>;

const RENDERER_FORM_FIELDS = [
  'id',
  'type',
  'title',
  'route',
  'roles',
  'domain',
  'contexts',
  'states',
  'requiredFields',
  'qaScenarioIds',
  'components',
] as const;

const rendererActions = (form: JsonObject): JsonObject => ({
  ctaAvailabilityByAction: (
    (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[]
  ).map((row) => ({ actionKey: row['actionKey'], label: row['label'] })),
});

const SYNTHETIC_FORM_IDS: ReadonlySet<string> = new Set(['APP-001', 'APP-002', 'APP-011']);

const rendererRequirement = (primaryActions: string[], formId = 'APP-001') => ({
  actionSteps: [{ formId, primaryActions }],
});

const rendererTransition = (to: string) => ({
  from: 'APP-001',
  to,
  kind: 'synthetic',
  guard: 'synthetic guard',
  trigger: 'Go',
});

const workflowCommand = (overrides: ImportJsonObject = {}): ImportJsonObject => ({
  commandId: 'UI-CMD-TEST',
  title: 'Test command',
  formIds: ['APP-001'],
  guards: 'Guard contract.',
  atomicity: 'Atomic contract.',
  reconnect: 'Reconnect contract.',
  qa: 'QA-WORKFLOW-TEST',
  ...overrides,
});

const workflowQa = (overrides: ImportJsonObject = {}): ImportJsonObject => ({
  qaId: 'QA-WORKFLOW-TEST',
  scope: 'UI-CMD-TEST',
  expected: 'Atomic contract. Reconnect contract.',
  ...overrides,
});

const extractSyntheticWorkflowCommands = (
  commands: readonly ImportJsonObject[],
  qaScenarios: readonly ImportJsonObject[] = [workflowQa()],
  declaredCount = commands.length,
): ImportJsonObject[] =>
  extractWorkflowCommands({ workflowCommands: [...commands] }, qaScenarios, declaredCount);

describe('generated atlas spec', () => {
  it('carries every form the atlas declares', () => {
    const sourceForms = clonedForms();
    const formsById = spec('forms-by-id.json') as Record<string, unknown>;

    expect(sourceForms).toHaveLength(376);
    expect(Object.keys(formsById)).toHaveLength(sourceForms.length);
  });

  it('indexes every form by id without changing its contents', () => {
    const forms = clonedForms();
    const formsById = spec('forms-by-id.json') as Record<string, unknown>;
    expect(Object.keys(formsById)).toHaveLength(376);
    expect(formsById).toEqual(Object.fromEntries(forms.map((form) => [sourceFormId(form), form])));
  });

  it('does not retain the retired forms array', () => {
    expect(existsSync(join(SPEC_DIR, 'atlas', 'forms.json'))).toBe(false);
  });

  it('projects every renderer query without losing any field it reads', () => {
    const formsById = spec('forms-by-id.json') as Record<string, JsonObject>;
    const rendererForms = spec('renderer/forms-by-id.json');
    const expectedForms = Object.fromEntries(
      Object.entries(formsById).map(([id, form]) => [
        id,
        {
          ...Object.fromEntries(RENDERER_FORM_FIELDS.map((field) => [field, form[field]])),
          actions: rendererActions(form),
        },
      ]),
    );
    expect(Object.keys(expectedForms)).toHaveLength(376);
    expect(rendererForms).toEqual(expectedForms);

    const requirements = spec('requirements.json') as {
      actionSteps: { formId: string; primaryActions: string[] }[];
    }[];
    const expectedActions = new Map<string, string[]>();
    for (const requirement of requirements) {
      for (const step of requirement.actionSteps) {
        const previous = expectedActions.get(step.formId);
        if (previous === undefined) {
          expectedActions.set(step.formId, step.primaryActions);
        } else {
          expect(step.primaryActions).toEqual(previous);
        }
      }
    }
    const expectedActionsObject = Object.fromEntries(expectedActions);
    expect(spec('renderer/primary-actions-by-form-id.json')).toEqual(expectedActionsObject);

    type Transition = {
      from: string;
      to: string;
      kind: string;
      guard: string;
      trigger: string;
    };
    const transitions = spec('transitions.json') as Transition[];
    const expectedTransitions = new Map<string, Record<string, Transition>>();
    for (const [formId, actions] of expectedActions) {
      const byTrigger: Record<string, Transition> = {};
      for (const action of actions) {
        const matches = transitions.filter(
          (transition) => transition.from === formId && transition.trigger === action,
        );
        expect(matches.length).toBeLessThanOrEqual(1);
        const match = matches[0];
        if (match !== undefined) byTrigger[action] = match;
      }
      if (Object.keys(byTrigger).length > 0) expectedTransitions.set(formId, byTrigger);
    }
    const expectedTransitionsObject = Object.fromEntries(expectedTransitions);
    expect(spec('renderer/transitions-by-form-and-trigger.json')).toEqual(
      expectedTransitionsObject,
    );
  });

  it('matches the counts the audit states about the atlas', () => {
    expect(spec('transitions.json')).toHaveLength(1672);
    expect(spec('journeys.json')).toHaveLength(66);
    expect(spec('requirements.json')).toHaveLength(91);
    expect(spec('qa-scenarios.json')).toHaveLength(2440);
    expect(spec('lifecycles.json')).toHaveLength(19);
    expect(spec('diagrams.json')).toHaveLength(11);
  });

  it('exports every workflow command field separately and matches its QA text', () => {
    type WorkflowCommand = {
      atomicity: string;
      commandId: string;
      formIds: string[];
      guards: string;
      qa: string;
      reconnect: string;
      title: string;
    };
    const atlas = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as {
      counts: { workflowCommands: number };
      registryCoverage: { workflowCommands: WorkflowCommand[] };
    };
    const commands = spec('workflow-commands.json') as WorkflowCommand[];
    expect(commands).toHaveLength(atlas.counts.workflowCommands);
    expect(commands).toEqual(atlas.registryCoverage.workflowCommands);

    const qaById = new Map(
      (spec('qa-scenarios.json') as { expected: string; qaId: string; scope: string }[]).map(
        (scenario) => [scenario.qaId, scenario],
      ),
    );
    for (const command of commands) {
      expect(Object.keys(command).sort()).toEqual([
        'atomicity',
        'commandId',
        'formIds',
        'guards',
        'qa',
        'reconnect',
        'title',
      ]);
      const scenario = qaById.get(command.qa);
      expect(scenario?.scope).toBe(command.commandId);
      expect(scenario?.expected).toBe(`${command.atomicity} ${command.reconnect}`);
    }
  });

  it('exports every global contract without changing its section contents', () => {
    type GlobalContract = { contractId: string; value: unknown };
    const source = atlasObject(atlasArtifact['globalContracts']);
    const contracts = spec('global-contracts.json') as GlobalContract[];

    expect(contracts).toHaveLength(Object.keys(source).length);
    expect(contracts.every((row) => Object.keys(row).sort().join(',') === 'contractId,value')).toBe(
      true,
    );
    expect(
      Object.fromEntries(contracts.map(({ contractId, value }) => [contractId, value])),
    ).toEqual(source);
  });

  it('pins the historical base-v1.2 semantic digests carried by Atlas v1.3', () => {
    const meta = spec('meta.json') as { graphDigest: string; contentDigest: string };
    expect(meta.graphDigest).toBe(
      '693910e40ffca85b30d9eafd05c2bb7d59934da966c10afdafa5afe6e51fe7df',
    );
    expect(meta.contentDigest).toBe(
      'ceace6ea95167e81b8cbbd86670930270b0b177e81db07e8e0fa437d21747a5c',
    );
  });

  it('closes the transition graph over the form catalogue', () => {
    const sourceIds = new Set(clonedForms().map(sourceFormId));
    const ids = new Set(Object.keys(spec('forms-by-id.json') as Record<string, unknown>));
    expect(ids).toEqual(sourceIds);
    const dangling = (spec('transitions.json') as { from: string; to: string }[]).filter(
      (t) => !ids.has(t.from) || !ids.has(t.to),
    );
    expect(dangling).toEqual([]);
  });

  it('distributes forms across the 16 domains exactly as the atlas counts them', () => {
    const sourceByDomain = new Map<string, number>();
    for (const form of clonedForms()) {
      const domain = form['domain'];
      if (typeof domain !== 'string') throw new Error('source form domain is not text');
      sourceByDomain.set(domain, (sourceByDomain.get(domain) ?? 0) + 1);
    }
    const byDomain = new Map<string, number>();
    for (const form of Object.values(
      spec('forms-by-id.json') as Record<string, { domain: string }>,
    )) {
      byDomain.set(form.domain, (byDomain.get(form.domain) ?? 0) + 1);
    }
    expect(byDomain).toEqual(sourceByDomain);
    expect(byDomain.size).toBe(16);
    expect(byDomain.get('Боевая ситуация')).toBe(73);
    expect(byDomain.get('Создание локального персонажа')).toBe(44);
    expect(byDomain.get('Настройки')).toBe(6);
    expect([...byDomain.values()].reduce((a, b) => a + b, 0)).toBe(376);
  });
});

describe('atlas section coverage guards', () => {
  it('rejects an unknown top-level section and names it', () => {
    expect(() => auditAtlasSections({ ...atlasArtifact, futureSection: {} })).toThrow(
      /unknown \["futureSection"\]/u,
    );
  });

  it('rejects an unknown globalContracts subsection and names it', () => {
    const root = clonedAtlas();
    root['globalContracts'] = {
      ...atlasObject(root['globalContracts']),
      futureContract: {},
    };
    expect(() => auditAtlasSections(root)).toThrow(/globalContracts.*futureContract/u);
  });

  it('rejects an unknown registryCoverage subsection and names it', () => {
    const root = clonedAtlas();
    root['registryCoverage'] = {
      ...atlasObject(root['registryCoverage']),
      futureCoverage: [],
    };
    expect(() => auditAtlasSections(root)).toThrow(/registryCoverage.*futureCoverage/u);
  });

  it('rejects a missing section instead of treating it as an intentional skip', () => {
    const root = clonedAtlas();
    delete root['sourceRefs'];
    expect(() => auditAtlasSections(root)).toThrow(/missing \["sourceRefs"\]/u);
  });

  it('uses atlas.counts for a registry subsection that is consciously not exported', () => {
    const root = clonedAtlas();
    const counts = atlasObject(root['counts']);
    counts['activeRules'] = (counts['activeRules'] as number) + 1;
    expect(() => assertAtlasCounts(root)).toThrow(/expected 700 activeRules, got 699/u);
  });

  it('rejects swapping a current and legacy form while preserving every count', () => {
    const root = clonedAtlas();
    const changeControl = atlasObject(root['changeControl']);
    const legacyFormIds = structuredClone(changeControl['legacyFormIds']) as string[];
    const newFormIds = structuredClone(changeControl['newFormIds']) as string[];
    [legacyFormIds[0], newFormIds[0]] = [newFormIds[0]!, legacyFormIds[0]!];
    changeControl['legacyFormIds'] = legacyFormIds;
    changeControl['newFormIds'] = newFormIds;
    expect(() => assertAtlasCounts(root)).toThrow(
      /changeControl\.newFormIds classification mismatch/u,
    );
  });
});

describe('global contract export guards', () => {
  it('rejects nested field drift', () => {
    const contracts = clonedGlobalContracts();
    contracts['platform'] = {
      ...atlasObject(contracts['platform']),
      futureField: 'drift',
    };
    expect(() => extractGlobalContracts(contracts)).toThrow(/platform has fields .*futureField/u);
  });

  it('rejects an empty required contract value', () => {
    const contracts = clonedGlobalContracts();
    contracts['platform'] = { ...atlasObject(contracts['platform']), delivery: ' ' };
    expect(() => extractGlobalContracts(contracts)).toThrow(/platform.*delivery.*is empty/u);
  });

  it('rejects duplicate soundtrack identifiers', () => {
    const contracts = clonedGlobalContracts();
    const soundtrack = atlasObject(contracts['soundtrackSourceContract']);
    const rules = structuredClone(soundtrack['rules']) as ImportJsonObject[];
    rules[1] = { ...rules[1], ruleId: rules[0]!['ruleId']! };
    soundtrack['rules'] = rules;
    expect(() => extractGlobalContracts(contracts)).toThrow(/rules\.ruleId.*duplicates "R-001"/u);
  });

  it('requires soundtrack id lists to match their record catalogs', () => {
    const contracts = clonedGlobalContracts();
    const soundtrack = atlasObject(contracts['soundtrackSourceContract']);
    const ruleIds = structuredClone(soundtrack['ruleIds']) as string[];
    ruleIds[0] = 'R-999';
    soundtrack['ruleIds'] = ruleIds;
    expect(() => extractGlobalContracts(contracts)).toThrow(
      /ruleIds differs from .*rules\[\]\.ruleId/u,
    );
  });

  it('preserves intentionally empty soundtrack entry-track lists', () => {
    expect(() => extractGlobalContracts(clonedGlobalContracts())).not.toThrow();
  });
});

describe('generated atlas types', () => {
  const source = readFileSync(join(TYPES_DIR, 'atlas.ts'), 'utf8');

  it('is marked as generated so nobody edits it by hand', () => {
    expect(source.startsWith('// Generated by tools/import.')).toBe(true);
  });

  it('uses LF endings regardless of the platform it was generated on', () => {
    expect(source).not.toContain('\r\n');
  });

  it('emits one FormId literal per form', () => {
    // The final member carries the closing semicolon, so it must be optional
    // here — matching only `"` would silently drop the last literal.
    const union = /export type FormId =\n((?: {2}\| "[^"]+";?\n)+)/.exec(source);
    expect(union).not.toBeNull();
    expect(union![1]!.trimEnd().split('\n')).toHaveLength(376);
  });

  it('emits one exact ActionKey literal per CTA row', () => {
    const declaration = source
      .split('export type ActionKey =\n')[1]
      ?.split('\n\nexport type TransitionKind =')[0];
    expect(declaration).toBeDefined();
    const members = declaration!
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line.replace(/^ {2}\| /u, '').replace(/;$/u, '')) as string);
    const known: ActionKey = 'APP-002::CTA::007';
    // @ts-expect-error Exact Atlas union excludes a well-formed but absent key.
    const absent: ActionKey = 'APP-002::CTA::999';
    expect(members).toHaveLength(1_242);
    expect(members).toEqual(extractActionKeys(clonedForms()));
    expect(members).toContain(known);
    expect(members).not.toContain(absent);
  });

  it('maps every domain to the src/web/forms folder that owns it', () => {
    expect(source).toContain('"Боевая ситуация": "CMB"');
    expect(source).toContain('"Приложение и локальные данные": "APP"');
  });
});

describe('action key export guards', () => {
  it('preserves Atlas form and CTA row order without collapsing keys', () => {
    const forms = clonedForms();
    const rows = firstFormActionRows(forms);
    [rows[0], rows[1]] = [rows[1]!, rows[0]!];
    const actionKeys = extractActionKeys(forms);

    expect(actionKeys).toHaveLength(1_242);
    expect(new Set(actionKeys).size).toBe(1_242);
    expect(actionKeys.slice(0, 4)).toEqual([
      'APP-001::CTA::002',
      'APP-001::CTA::001',
      'APP-001::CTA::003',
      'APP-001::CTA::004',
    ]);
  });

  it('rejects a missing actionKey and names its form and row', () => {
    const forms = clonedForms();
    delete firstFormActionRows(forms)[0]!['actionKey'];

    expect(() => extractActionKeys(forms)).toThrow(
      /forms\[0\].*ctaAvailabilityByAction\[0\]\.actionKey is missing for form "APP-001"/u,
    );
  });

  it('rejects a non-string actionKey and names its form and row', () => {
    const forms = clonedForms();
    firstFormActionRows(forms)[0]!['actionKey'] = 7;

    expect(() => extractActionKeys(forms)).toThrow(
      /forms\[0\].*ctaAvailabilityByAction\[0\]\.actionKey for form "APP-001" is not a string \(got number\)/u,
    );
  });

  it('rejects a duplicate actionKey and names both Atlas locations', () => {
    const forms = clonedForms();
    const firstRows = firstFormActionRows(forms);
    const secondForm = forms[1];
    if (secondForm === undefined || secondForm['id'] !== 'APP-002') {
      throw new Error('expected APP-002 as the second Atlas form');
    }
    const secondRows = atlasObject(secondForm['actions'])[
      'ctaAvailabilityByAction'
    ] as ImportJsonObject[];
    secondRows[0]!['actionKey'] = firstRows[0]!['actionKey'];

    expect(() => extractActionKeys(forms)).toThrow(
      /forms\[1\].*ctaAvailabilityByAction\[0\].*form "APP-002" duplicates "APP-001::CTA::001".*forms\[0\].*ctaAvailabilityByAction\[0\].*form "APP-001"/u,
    );
  });

  it('rejects a valid but incomplete action-key catalogue', () => {
    const forms = clonedForms();
    firstFormActionRows(forms).pop();

    expect(() => extractActionKeys(forms)).toThrow(/expected 1242 action keys, got 1241/u);
  });
});

describe('renderer atlas index guards', () => {
  it('projects only actionKey and label for each CTA row', () => {
    const forms = clonedForms();
    const rows = firstFormActionRows(forms);

    expect(projectRendererFormActions(forms[0]!, 0)).toEqual({
      ctaAvailabilityByAction: rows.map((row) => ({
        actionKey: row['actionKey'],
        label: row['label'],
      })),
    });
  });

  it('rejects a missing projected action label and names its form and row', () => {
    const forms = clonedForms();
    delete firstFormActionRows(forms)[0]!['label'];

    expect(() => projectRendererFormActions(forms[0]!, 0)).toThrow(
      /forms\[0\].*ctaAvailabilityByAction\[0\]\.label is missing for form "APP-001"/u,
    );
  });

  it('rejects a non-string projected action label and names its form and row', () => {
    const forms = clonedForms();
    firstFormActionRows(forms)[0]!['label'] = 7;

    expect(() => projectRendererFormActions(forms[0]!, 0)).toThrow(
      /forms\[0\].*ctaAvailabilityByAction\[0\]\.label for form "APP-001" is not a string \(got number\)/u,
    );
  });

  it('preserves declared empty actions separately from an absent form key', () => {
    const indexes = buildRendererQueryIndexes(SYNTHETIC_FORM_IDS, [rendererRequirement([])], []);

    expect(indexes.primaryActionsByForm).toEqual({ 'APP-001': [] });
    expect(indexes.primaryActionsByForm).not.toHaveProperty('APP-002');
    expect(indexes.transitionsByForm).toEqual({});
  });

  it('rejects an action step for an unknown form', () => {
    expect(() =>
      buildRendererQueryIndexes(SYNTHETIC_FORM_IDS, [rendererRequirement([], 'APP-999')], []),
    ).toThrow(/formId points at unknown form "APP-999"/u);
  });

  it('rejects duplicate actions instead of collapsing them', () => {
    expect(() =>
      buildRendererQueryIndexes(SYNTHETIC_FORM_IDS, [rendererRequirement(['Go', 'Go'])], []),
    ).toThrow(/primaryActions contains duplicate actions for APP-001/u);
  });

  it('rejects conflicting repeated action definitions', () => {
    expect(() =>
      buildRendererQueryIndexes(
        SYNTHETIC_FORM_IDS,
        [rendererRequirement(['Go']), rendererRequirement(['Stay'])],
        [],
      ),
    ).toThrow(/primaryActions conflicts with another definition for APP-001/u);
  });

  it('rejects an ambiguous transition in the renderer query domain', () => {
    expect(() =>
      buildRendererQueryIndexes(
        SYNTHETIC_FORM_IDS,
        [rendererRequirement(['Go'])],
        [rendererTransition('APP-002'), rendererTransition('APP-011')],
      ),
    ).toThrow(/ambiguous renderer transition for form APP-001 and trigger "Go"/u);
  });
});

describe('workflow command export guards', () => {
  it('uses the declared atlas count instead of a duplicated constant', () => {
    expect(() => extractSyntheticWorkflowCommands([workflowCommand()], undefined, 2)).toThrow(
      /expected 2 workflow commands, got 1/u,
    );
  });

  it('rejects an unknown record shape', () => {
    expect(() =>
      extractSyntheticWorkflowCommands([workflowCommand({ unexpected: 'field' })]),
    ).toThrow(/has fields .*unexpected.* expected/u);
  });

  it('rejects duplicate command ids', () => {
    expect(() => extractSyntheticWorkflowCommands([workflowCommand(), workflowCommand()])).toThrow(
      /duplicate commandId "UI-CMD-TEST"/u,
    );
  });

  it('rejects an empty required string', () => {
    expect(() => extractSyntheticWorkflowCommands([workflowCommand({ guards: ' ' })])).toThrow(
      /\.guards is empty/u,
    );
  });

  it('rejects an empty form list', () => {
    expect(() => extractSyntheticWorkflowCommands([workflowCommand({ formIds: [] })])).toThrow(
      /\.formIds is empty/u,
    );
  });

  it('requires exactly one linked QA scenario', () => {
    expect(() =>
      extractSyntheticWorkflowCommands([workflowCommand({ qa: 'QA-WORKFLOW-MISSING' })]),
    ).toThrow(/matches 0 QA scenarios, expected 1/u);
  });

  it('requires the linked QA scope to name the command', () => {
    expect(() =>
      extractSyntheticWorkflowCommands(
        [workflowCommand()],
        [workflowQa({ scope: 'UI-CMD-OTHER' })],
      ),
    ).toThrow(/scope is "UI-CMD-OTHER", expected "UI-CMD-TEST"/u);
  });

  it('requires QA expected to be the exact atomicity and reconnect text', () => {
    expect(() =>
      extractSyntheticWorkflowCommands(
        [workflowCommand()],
        [workflowQa({ expected: 'Different text.' })],
      ),
    ).toThrow(/expected differs from .*atomicity \+ reconnect/u);
  });
});
