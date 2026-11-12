import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARTIFACT } from './lib/paths.js';
import type { JsonObject } from './lib/json.js';
import {
  assertAdr0077GmSources,
  assertAdr0077GmSourcesMarkdown,
} from './gm-entity-atlas-contract.js';
import { extractWorkflowCommands } from './atlas.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
function rows(root: JsonObject, target: 'forms' | 'qaScenarios' | 'workflowCommands') {
  return (
    target === 'workflowCommands'
      ? (root['registryCoverage'] as JsonObject)['workflowCommands']
      : root[target]
  ) as JsonObject[];
}
function changed(target: 'forms' | 'qaScenarios' | 'workflowCommands', id: string) {
  const key = target === 'forms' ? 'id' : target === 'qaScenarios' ? 'qaId' : 'commandId';
  // Clone the one witness, not the entire 15 MB Atlas for every negative case.
  const copy = rows(source, target).map((row) => (row[key] === id ? structuredClone(row) : row));
  const row = copy.find((row) => row[key] === id);
  if (row === undefined) throw Error('Missing source witness ' + id);
  const root: JsonObject =
    target === 'workflowCommands'
      ? {
          ...source,
          registryCoverage: {
            ...(source['registryCoverage'] as JsonObject),
            workflowCommands: copy,
          },
        }
      : { ...source, [target]: copy };
  return { root, row };
}
function availability(form: JsonObject) {
  return (form['actions'] as JsonObject)['workflowCommandAvailability'] as JsonObject[];
}
function replaceWitness(before: string, after: string) {
  const value = changed('forms', 'ENM-017');
  const old = value.row['acceptanceCriteria'] as string[];
  const next = old.map((text) => text.replace(before, after));
  expect(next).not.toEqual(old);
  value.row['acceptanceCriteria'] = next;
  expect(() => assertAdr0077GmSources(value.root)).toThrow('ENM-017');
}

describe('ADR0094 full N+1 configuration source and independent Markdown', () => {
  it('keeps every workflow QA expected exactly equal to atomicity plus reconnect', () => {
    const count = (source['counts'] as JsonObject)['workflowCommands'];
    if (typeof count !== 'number') throw Error('Missing declared workflow command count');
    expect(() =>
      extractWorkflowCommands(
        source['registryCoverage'] as JsonObject,
        source['qaScenarios'] as JsonObject[],
        count,
      ),
    ).not.toThrow();
  });
  it.each(['QA-WORKFLOW-UI-CMD-ENEMY-DRAFT-PATCH', 'QA-WORKFLOW-UI-CMD-ENEMY-NEW-VERSION'])(
    'preserves the importer equality refusal for independently edited %s expected',
    (id) => {
      const value = changed('qaScenarios', id);
      value.row['expected'] = 'Independently appended QA text is not the workflow contract.';
      const count = (source['counts'] as JsonObject)['workflowCommands'];
      if (typeof count !== 'number') throw Error('Missing declared workflow command count');
      expect(() =>
        extractWorkflowCommands(
          value.root['registryCoverage'] as JsonObject,
          value.root['qaScenarios'] as JsonObject[],
          count,
        ),
      ).toThrow('expected differs');
    },
  );
  it('accepts exact source and requires both closed per-command rows to match their actual workflow guards', () => {
    expect(() => assertAdr0077GmSources(source)).not.toThrow();
    expect(() => assertAdr0077GmSourcesMarkdown(markdown)).not.toThrow();
    const form = rows(source, 'forms').find((row) => row['id'] === 'ENM-017');
    if (form === undefined) throw Error('Missing ENM-017');
    expect(availability(form).map((row) => row['commandId'])).toEqual([
      'UI-CMD-ENEMY-NEW-VERSION',
      'UI-CMD-ENEMY-DRAFT-PATCH',
    ]);
    for (const row of availability(form)) {
      const command = rows(source, 'workflowCommands').find(
        (value) => value['commandId'] === row['commandId'],
      );
      expect(command).toBeDefined();
      expect(row['guard']).toBe(command?.['guards']);
      expect((row['authoritativeSource'] as JsonObject)['workflowCommandIds']).toEqual([
        row['commandId'],
      ]);
    }
    expect(availability(form)[1]?.['guard']).toContain('preview may be prepared without consent');
    expect(availability(form)[1]?.['guard']).toContain('Only confirmation');
  });
  it.each([
    [
      'ENM-017',
      'versionConfigurationContext={attemptId,attemptRevision,campaignId,templateId,expectedCurrentVersion,templateKind}',
    ],
    [
      'ENM-017',
      'versionConfigurationChangeOrNull={kind,kindSpecificInitialInput,advisorOwnChoicesChangeOrNull,displayedConsequences,explicitConfirmationOrNull}',
    ],
    ['ENM-017', 'retainedMandatoryFacts[]'],
    ['ENM-017', 'kindSpecificSkillAccountingOrNull'],
    ['ENM-020', 'versionConfigurationSummaryOrNull'],
  ])('rejects a missing %s field %s', (id, field) => {
    const value = changed('forms', id),
      old = value.row['requiredFields'] as string[];
    expect(old).toContain(field);
    value.row['requiredFields'] = old.filter((item) => item !== field);
    expect(() => assertAdr0077GmSources(value.root)).toThrow(id);
  });
  it.each([
    'REMOVE_PATCH',
    'STALE_NEW_VERSION_GUARD',
    'WRONG_PATCH_SOURCE',
    'CONSENT_BEFORE_PREVIEW',
  ])('rejects per-command availability drift: %s', (fault) => {
    const value = changed('forms', 'ENM-017'),
      items = availability(value.row);
    if (fault === 'REMOVE_PATCH') items.splice(1, 1);
    else if (fault === 'STALE_NEW_VERSION_GUARD')
      items[0]!['guard'] = 'Current user template exists; full candidate valid.';
    else if (fault === 'WRONG_PATCH_SOURCE')
      (items[1]!['authoritativeSource'] as JsonObject)['workflowCommandIds'] = [
        'UI-CMD-ENEMY-NEW-VERSION',
      ];
    else items[1]!['guard'] = 'Every edit and preview requires replacement consent first.';
    expect(() => assertAdr0077GmSources(value.root)).toThrow('ENM-017');
  });
  it.each([
    ['fixed signed S/M/Z loss', 'recompute S/M/Z loss from each new basis'],
    ['capacity0 не обнуляет spent SYM166', 'capacity0 replenishes spent SYM166'],
    ['без stacking прежнего derived grant', 'stack the prior derived grant'],
    [
      'CUSTOM_MONSTER никогда не получает suppression field/control/roll',
      'CUSTOM_MONSTER receives suppression',
    ],
    [
      'Actual prior mandatory facts берутся из owning template-bound authoritative prefix',
      'Use only current baseVersion to infer ABSENT',
    ],
    [
      'Обычные edits и подготовка preview не требуют будущего consent',
      'Require future consent to create a preview',
    ],
    [
      'Legacy ABSENT обоих kind grammars остаётся ABSENT',
      'Insert new plan keys into every old record',
    ],
  ])('rejects policy drift: %s', (before, after) => replaceWitness(before, after));
  it.each([
    'QA-FORM-ENM-007',
    'QA-CHANGE-ENM-007',
    'QA-FORM-ENM-017',
    'QA-CHANGE-ENM-017',
    'QA-FORM-ENM-020',
    'QA-WORKFLOW-UI-CMD-ENEMY-DRAFT-PATCH',
    'QA-WORKFLOW-UI-CMD-ENEMY-NEW-VERSION',
  ])('rejects a weakened QA witness %s', (id) => {
    const value = changed('qaScenarios', id);
    value.row['expected'] = 'Valid candidate only.';
    expect(() => assertAdr0077GmSources(value.root)).toThrow(id);
  });
  it('rejects an independent Markdown mirror with no PATCH availability row', () => {
    const from = markdown.indexOf('### ENM-017 —'),
      to = markdown.indexOf('\n### ', from + 1);
    expect(from).toBeGreaterThan(0);
    const section = markdown.slice(from, to),
      line = section.split('\n').find((row) => row.startsWith('| UI-CMD-ENEMY-DRAFT-PATCH |'));
    expect(line).toBeDefined();
    if (line === undefined) throw Error('Missing independent PATCH row');
    const malformed = markdown.slice(0, from) + section.replace(line, '') + markdown.slice(to);
    expect(() => assertAdr0077GmSourcesMarkdown(malformed)).toThrow('ENM-017');
  });
});
