import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0083FreshTrogr,
  assertAdr0083FreshTrogrMarkdown,
} from './fresh-trogr-atlas-contract.js';
import { ARTIFACT } from './lib/paths.js';
import type { JsonObject } from './lib/json.js';

const source = JSON.parse(readFileSync(ARTIFACT.atlasJson, 'utf8')) as JsonObject;
const markdown = readFileSync(ARTIFACT.atlasMd, 'utf8');
function editedForm(id: string) {
  const root = {
    ...source,
    forms: (source['forms'] as JsonObject[]).map((row) =>
      row['id'] === id ? structuredClone(row) : row,
    ),
  };
  const form = root.forms.find((row) => row['id'] === id);
  if (form === undefined) throw new Error('Missing form ' + id);
  return { root, form };
}

describe('ADR 0083 fresh Trogr death source boundary', () => {
  it('accepts the exact JSON and independent Markdown source', () => {
    expect(() => assertAdr0083FreshTrogr(source)).not.toThrow();
    expect(() => assertAdr0083FreshTrogrMarkdown(markdown)).not.toThrow();
  });
  it.each([
    ['не создаёт нового статового вклада', 'создаёт новый статовый вклад'],
    [
      'при его отсутствии не создаётся фиктивное нулевое наследие',
      'при его отсутствии создаётся нулевое наследие',
    ],
    ['Прежний lifetime ledger сохраняется точно', 'Прежний lifetime ledger пересчитывается'],
    [
      'отдельное постоянное последствие SYM-079 сохраняются',
      'отдельное постоянное последствие SYM-079 отменяются',
    ],
    ['преддуэльный stat context', 'подтверждённый старый stat context'],
  ])('refuses changing the accepted clause: %s', (before, after) => {
    const { root, form } = editedForm('NPC-013');
    const clauses = form['acceptanceCriteria'] as string[];
    expect(clauses.filter((line) => line.includes(before))).toHaveLength(1);
    form['acceptanceCriteria'] = clauses.map((line) => line.replace(before, after));
    expect(() => assertAdr0083FreshTrogr(root)).toThrow('NPC-013');
  });
  it('keeps receipt read routes independent of the new mutation proof', () => {
    const { root, form } = editedForm('NPC-017');
    const actions = (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[];
    for (const key of ['NPC-017::CTA::001', 'NPC-017::CTA::004']) {
      const action = actions.find((row) => row['actionKey'] === key);
      expect(action).toBeDefined();
      expect(action?.['guard']).not.toContain('ADR0083');
    }
    const receipt = actions.find((row) => row['actionKey'] === 'NPC-017::CTA::004');
    if (receipt === undefined) throw new Error('Missing receipt route');
    expect(receipt['guard']).toBe('commitStatus=COMMITTED');
    receipt['guard'] = 'commitStatus=COMMITTED and new Trogr proof supplied';
    expect(() => assertAdr0083FreshTrogr(root)).toThrow('NPC-017');
  });
  it.each(['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'])(
    'preserves the complete workflow and phase guard in QA for %s',
    (id) => {
      const commands = (source['registryCoverage'] as JsonObject)[
        'workflowCommands'
      ] as JsonObject[];
      const workflow = commands.find((row) => row['commandId'] === id);
      if (workflow === undefined) throw new Error('Missing workflow ' + id);
      const qa = (source['qaScenarios'] as JsonObject[]).find(
        (row) => row['qaId'] === workflow['qa'],
      );
      expect(qa?.['scenario']).toContain(workflow['guards']);
      const atomicity = workflow['atomicity'],
        reconnect = workflow['reconnect'];
      if (typeof atomicity !== 'string' || typeof reconnect !== 'string')
        throw new Error('Expected source workflow text');
      expect(qa?.['expected']).toBe(atomicity + ' ' + reconnect);
    },
  );
  it.each(['NPC-013', 'NPC-014', 'NPC-017', 'NPC-003', 'NPC-007'])(
    'refuses removing source-bound readback and preview from %s',
    (id) => {
      const { root, form } = editedForm(id);
      form['acceptanceCriteria'] = (form['acceptanceCriteria'] as string[]).filter(
        (line) => !line.startsWith('ADR0083 / #234:'),
      );
      expect(() => assertAdr0083FreshTrogr(root)).toThrow(id);
    },
  );
  it.each([
    '### NPC-013 —',
    '| QA-FORM-NPC-013 |',
    '| QA-REQ-012 |',
    '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
  ])('refuses independent Markdown drift in %s', (prefix) => {
    const lines = markdown.split('\n');
    expect(lines.filter((line) => line.startsWith(prefix))).toHaveLength(1);
    const changed = lines
      .map((line) => (line.startsWith(prefix) ? line + ' changed' : line))
      .join('\n');
    expect(() => assertAdr0083FreshTrogrMarkdown(changed)).toThrow('atlas ADR 0083');
  });
});
