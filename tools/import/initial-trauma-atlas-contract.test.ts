import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0081InitialTrauma,
  assertAdr0081InitialTraumaMarkdown,
} from './initial-trauma-atlas-contract.js';
import { ARTIFACT } from './lib/paths.js';
import type { JsonObject } from './lib/json.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
const record = (value: unknown) => value as JsonObject;
function changed(target: 'forms' | 'workflowCommands' | 'qaScenarios', id: string) {
  const root = { ...source };
  const container =
    target === 'workflowCommands'
      ? (root['registryCoverage'] = { ...record(source['registryCoverage']) })
      : root;
  const key = target === 'forms' ? 'id' : target === 'workflowCommands' ? 'commandId' : 'qaId';
  container[target] = (container[target] as JsonObject[]).map((row) =>
    row[key] === id ? structuredClone(row) : row,
  );
  const row = (container[target] as JsonObject[]).find((row) => row[key] === id);
  if (row === undefined) throw new Error('Missing accepted source ' + id);
  return { root, row };
}

describe('ADR 0081 initial NPC trauma source', () => {
  it('accepts exact JSON and independent Markdown without claiming runtime validation', () => {
    expect(() => assertAdr0081InitialTrauma(source)).not.toThrow();
    expect(() => assertAdr0081InitialTraumaMarkdown(markdown)).not.toThrow();
  });
  it.each([
    'currentTraumas[]',
    'traumaAuthoringChoices[]=',
    'initialTraumaFacts[]=',
    'traumaStateValidationSummary',
  ])('refuses omission of required authoring field %s', (prefix) => {
    const { root, row } = changed('forms', 'NPC-016');
    const fields = row['requiredFields'] as string[];
    expect(fields.filter((value) => value.startsWith(prefix))).toHaveLength(1);
    row['requiredFields'] = fields.filter((value) => !value.startsWith(prefix));
    expect(() => assertAdr0081InitialTrauma(root)).toThrow('NPC-016');
  });
  it.each([
    ['value-six ACTIVE', 'При traumaValue<=6 ACTIVE запрещён', 'При traumaValue<6 ACTIVE запрещён'],
    [
      'independent head choices',
      'при >6 допустимы все четыре сочетания',
      'при >6 допустимо только PENDING/ACTIVE',
    ],
    [
      'zero or excessive remainder',
      'точным рациональным 0<r<=5 минут',
      'округлённым 0<=r<=6 минут',
    ],
    [
      'hidden absent timer',
      'ABSENT не содержит таймерных полей',
      'ABSENT сохраняет скрытый полный таймер',
    ],
    ['torso repeated damage', 'сохраняет HP=7', 'сохраняет HP=0 после повторного урона'],
    [
      'invented played event',
      'Сыгранные damageEventId, броски и combat events не создаются',
      'Создаётся фиктивный сыгранный damageEventId',
    ],
    [
      'automatic head defaults',
      'Незаполненный выбор не становится default',
      'Незаполненный выбор становится PENDING/ACTIVE на 5 минут',
    ],
    [
      'floating point conversion',
      'без Number/parseFloat/округления',
      'через Number/parseFloat с округлением',
    ],
    ['newline grammar escape', 'final newline запрещён', 'final newline допускается'],
    ['N+1 refreshed anchor', 'не заменяются новым N+1 COMMIT', 'заменяются новым N+1 COMMIT'],
    [
      'consumed penalty revival',
      'CONSUMED не восстанавливается',
      'CONSUMED восстанавливается при reopen',
    ],
    [
      'self-proved provenance',
      'recovery не принимает candidate как собственное доказательство',
      'recovery доверяет candidate без истории',
    ],
    [
      'new TraumaInstance field',
      'Fact не меняет три поля TraumaInstance',
      'Fact добавляет mutable consumption в TraumaInstance',
    ],
  ])('refuses %s source drift', (_label, before, after) => {
    const { root, row } = changed('forms', 'NPC-016');
    const criteria = row['acceptanceCriteria'] as string[];
    expect(criteria.filter((value) => value.includes(before))).toHaveLength(1);
    row['acceptanceCriteria'] = criteria.map((value) => value.replace(before, after));
    expect(() => assertAdr0081InitialTrauma(root)).toThrow('NPC-016');
  });
  it.each(['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'])(
    'refuses losing source/calendar/atomic guards in %s',
    (id) => {
      const { root, row } = changed('workflowCommands', id);
      expect(typeof row['guards']).toBe('string');
      row['guards'] = 'Save incomplete or stale initial trauma input without its actual origin.';
      expect(() => assertAdr0081InitialTrauma(root)).toThrow('registryCoverage');
    },
  );
  it('preserves existing GM-014 application of new trauma', () => {
    const { root, row } = changed('forms', 'GM-014');
    row['purpose'] = 'All new trauma ignores its immediate consequences.';
    expect(() => assertAdr0081InitialTrauma(root)).toThrow('GM-014');
  });
  it('preserves receipt return without requiring fresh authoring input', () => {
    const { root, row } = changed('forms', 'NPC-017');
    const action = (record(row['actions'])['ctaAvailabilityByAction'] as JsonObject[]).find(
      (value) => value['actionKey'] === 'NPC-017::CTA::004',
    );
    expect(action?.['guard']).toBe('commitStatus=COMMITTED');
    if (action === undefined) throw new Error('Missing receipt action');
    action['guard'] = 'commitStatus=COMMITTED and newly entered trauma choices';
    expect(() => assertAdr0081InitialTrauma(root)).toThrow('NPC-017');
  });
  it('preserves standalone QA prerequisites, including authority and revisions', () => {
    const { root, row } = changed('qaScenarios', 'QA-REQ-011');
    expect(row['scenario']).toContain('Preconditions:');
    row['scenario'] = 'Happy: save a valid NPC. Error/offline: refuse.';
    expect(() => assertAdr0081InitialTrauma(root)).toThrow('QA-REQ-011');
  });
  it.each([
    '### NPC-016 —',
    '### NPC-017 —',
    '| QA-REQ-012 |',
    '| QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1 |',
  ])('refuses independent Markdown drift in %s', (prefix) => {
    const lines = markdown.split('\n');
    expect(lines.filter((line) => line.startsWith(prefix))).toHaveLength(1);
    const mutated = lines
      .map((line) =>
        line.startsWith(prefix) ? line.replace(prefix, prefix + ' UNAPPROVED ') : line,
      )
      .join('\n');
    expect(mutated).not.toBe(markdown);
    expect(() => assertAdr0081InitialTraumaMarkdown(mutated)).toThrow(prefix);
  });
});
