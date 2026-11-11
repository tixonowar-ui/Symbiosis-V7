import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARTIFACT } from './lib/paths.js';
import type { JsonObject } from './lib/json.js';
import {
  assertAdr0077GmSources,
  assertAdr0077GmSourcesMarkdown,
} from './gm-entity-atlas-contract.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
const forms = ['ENM-006', 'ENM-007', 'ENM-008', 'ENM-009', 'ENM-010', 'ENM-020'] as const;
function changed(target: 'forms' | 'journeys' | 'qaScenarios', id: string) {
  const key = target === 'qaScenarios' ? 'qaId' : 'id';
  const rows = (source[target] as JsonObject[]).map((row) =>
    row[key] === id ? structuredClone(row) : row,
  );
  const row = rows.find((row) => row[key] === id);
  if (row === undefined) throw Error('Missing supplied source ' + id);
  return { root: { ...source, [target]: rows }, row };
}
function replaceWitness(id: string, before: string, after: string) {
  const value = changed('forms', id),
    prior = value.row['acceptanceCriteria'] as string[];
  const next = prior.map((line) => line.replace(before, after));
  expect(next).not.toEqual(prior);
  value.row['acceptanceCriteria'] = next;
  expect(() => assertAdr0077GmSources(value.root)).toThrow(id);
}
describe('ADR 0092 accepted pre-V1 source boundary', () => {
  it('accepts exact JSON and independent Markdown witnesses', () => {
    expect(() => assertAdr0077GmSources(source)).not.toThrow();
    expect(() => assertAdr0077GmSourcesMarkdown(markdown)).not.toThrow();
  });
  it.each([
    ['ENM-007', 'skillSelections[]'],
    ['ENM-007', 'explicitRebuildConfirmationOrNull'],
    ['ENM-007', 'expectedSkillPlanRevisionOrNull'],
    ['ENM-008', 'retainedAcquisitionFacts[]'],
    ['ENM-008', 'skillPoolAccounting'],
    ['ENM-009', 'verifiedBodySkillResolution'],
    ['ENM-010', 'initialSkillPlanOrNull'],
    ['ENM-020', 'initialSkillPlanOrNull'],
  ])('rejects removal of %s required field %s', (id, field) => {
    const { root, row } = changed('forms', id);
    expect(row['requiredFields']).toContain(field);
    row['requiredFields'] = (row['requiredFields'] as string[]).filter((value) => value !== field);
    expect(() => assertAdr0077GmSources(root)).toThrow(id);
  });
  it('rejects incremental-only editing, implicit reset and fabricated acquisition refunds', () => {
    replaceWitness(
      'ENM-007',
      'incremental-only ограничение не вводится',
      'only incremental purchases allowed',
    );
    replaceWitness(
      'ENM-006',
      'обычный NAV/Back/exact replay не меняет план',
      'NAV resets the plan',
    );
    replaceWitness(
      'ENM-007',
      'без пересчёта по новой базе, refund или нового clamp',
      'recompute the old R6 loss using new basis and clamp',
    );
    replaceWitness(
      'ENM-007',
      'не требует заполнить abandoned prior plan/card',
      'requires filling abandoned prior plan/card',
    );
    replaceWitness(
      'ENM-007',
      'не создаёт новую карту или reroll при same-card reselect',
      'rerolls same-card on reselect',
    );
    replaceWitness('ENM-007', 'без stacking с прежним grant', 'stack the old GROSS grant');
  });
  it('rejects resurrection, temporary-charge release and premature loss without actual Nate', () => {
    replaceWitness(
      'ENM-008',
      'Автоматическое восстановление забытого START/GROSS/own Advisor skill запрещено',
      'automatically restore forgotten knowledge',
    );
    replaceWitness('ENM-008', 'capacity=0/overflow', 'reset the five issued slots');
    replaceWitness(
      'ENM-009',
      'не потеря знания/освобождение charges',
      'forget and release charges under armor M',
    );
    replaceWitness(
      'ENM-009',
      'provisional Skunk C0 на ENM-008 не забывает навык заранее',
      'forget before actual Nate is chosen',
    );
    replaceWitness(
      'ENM-010',
      'не применяется задним числом',
      'normalize every old receipt and version',
    );
  });
  it('rejects a new global rebuild CTA and a post-RNG Back lock', () => {
    const form = changed('forms', 'ENM-007');
    ((form.row['actions'] as JsonObject)['visible'] as string[]).push('Hidden automatic rebuild');
    expect(() => assertAdr0077GmSources(form.root)).toThrow('ENM-007');
    const journey = changed('journeys', 'J-ENEMY-SENTIENT');
    journey.row['safeBoundaries'] = 'Back forbidden after R6';
    expect(() => assertAdr0077GmSources(journey.root)).toThrow('J-ENEMY-SENTIENT');
  });
  it.each(forms)('rejects every independent %s Markdown section mutation', (id) => {
    const prefix = '### ' + id + ' —',
      start = markdown.indexOf(prefix),
      end = markdown.indexOf('\n### ', start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    const field = {
      'ENM-006': 'skillPlanImpact',
      'ENM-007': 'explicitRebuildConfirmationOrNull',
      'ENM-008': 'retainedAcquisitionFacts[]',
      'ENM-009': 'verifiedBodySkillResolution',
      'ENM-010': 'initialSkillPlanOrNull',
      'ENM-020': 'initialSkillPlanOrNull',
    }[id];
    const old = markdown.slice(start, end),
      altered = old.replace(field, 'foreignPlan');
    expect(altered).not.toBe(old);
    expect(() =>
      assertAdr0077GmSourcesMarkdown(markdown.slice(0, start) + altered + markdown.slice(end)),
    ).toThrow(prefix);
  });
  it.each(forms)('rejects changed %s QA JSON and its separate Markdown line', (id) => {
    const qaId = 'QA-FORM-' + id,
      value = changed('qaScenarios', qaId);
    value.row['expected'] = 'Implicit reset and original-receipt rewrite allowed';
    expect(() => assertAdr0077GmSources(value.root)).toThrow(qaId);
    const prefix = '| ' + qaId + ' |',
      line = markdown.split('\n').find((line) => line.startsWith(prefix));
    expect(line).toBeDefined();
    expect(() =>
      assertAdr0077GmSourcesMarkdown(
        markdown.replace(line!, line!.replace('Owner #284 A:', 'Unapproved automatic reset:')),
      ),
    ).toThrow(prefix);
  });
});
