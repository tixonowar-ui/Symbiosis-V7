import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0084CustomItem,
  assertAdr0084CustomItemMarkdown,
} from './custom-item-atlas-contract.js';
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

describe('ADR 0084 campaign custom item source boundary', () => {
  it('accepts the exact JSON and independent Markdown source', () => {
    expect(() => assertAdr0084CustomItem(source)).not.toThrow();
    expect(() => assertAdr0084CustomItemMarkdown(markdown)).not.toThrow();
  });
  it('replaces only the unconditional catalogue identity requirement with the closed variant', () => {
    const { root, form } = editedForm('NPC-015');
    expect(form['requiredFields']).toContain('itemTypeReference');
    expect(form['requiredFields']).not.toContain('itemTypeId');
    const clauses = form['acceptanceCriteria'] as string[];
    expect(clauses.join(' ')).toContain(
      'CATALOG_ITEM сохраняет обязательный неизменяемый itemTypeId',
    );
    expect(clauses.join(' ')).toContain('catalogue itemTypeId явно отсутствует');
    form['requiredFields'] = (form['requiredFields'] as string[]).map((field) =>
      field === 'itemTypeReference' ? 'arbitraryCatalogueId' : field,
    );
    expect(() => assertAdr0084CustomItem(root)).toThrow('NPC-015');
  });
  it.each([
    ['catalogue itemTypeId явно отсутствует', 'catalogue itemTypeId содержит GEN-ID'],
    ['quantity=1', 'quantity умножает бонус'],
    ['Вне рюкзака бонус не действует', 'Вне рюкзака бонус действует'],
    ['рюкзак, его массу и вместимость автоматически не создаёт', 'автоматически создаёт рюкзак'],
    ['новую immutable версию изменённого профиля', 'изменение старой версии профиля'],
    ['база и постоянный симбиотический вклад не переписываются', 'база переписывается'],
    ['полный исходный проверенный профиль и механику', 'только новое описание'],
    ['NONE либо одну характеристику S/D/I/W/M/Z/C', 'произвольное число характеристик'],
  ])('refuses changing the accepted clause: %s', (before, after) => {
    const { root, form } = editedForm('NPC-015');
    const clauses = form['acceptanceCriteria'] as string[];
    expect(clauses.filter((line) => line.includes(before))).toHaveLength(1);
    form['acceptanceCriteria'] = clauses.map((line) => line.replace(before, after));
    expect(() => assertAdr0084CustomItem(root)).toThrow('NPC-015');
  });
  it('keeps ordinary catalogue fields conditional and profile absence explicit', () => {
    const { root, form } = editedForm('NPC-015');
    const clauses = form['acceptanceCriteria'] as string[];
    const conditional = clauses.find((line) => line.startsWith('ADR0084 conditional fields:'));
    expect(conditional).toContain('customProfileOrNull=null');
    expect(conditional).toContain('для NONE явно NOT_APPLICABLE');
    expect(conditional).toContain('OUTSIDE_BACKPACK либо {backpackItemInstanceId}');
    expect(conditional).toContain('не заполняется фиктивной WeaponProfileVersion');
    form['acceptanceCriteria'] = clauses.filter((line) => line !== conditional);
    expect(() => assertAdr0084CustomItem(root)).toThrow('NPC-015');
  });
  it('mirrors both inventory forward guards while retaining the safe back route', () => {
    const { root, form } = editedForm('NPC-015');
    const actions = (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[];
    for (const action of actions.filter((row) => row['targetFormId'] === 'NPC-016')) {
      expect(action['guard']).toContain('ADR0084 custom item closure:');
      const trigger =
        action['kind'] === 'journey' ? 'J-NPC-CREATE::INITIAL_STATE' : action['label'];
      const global = (source['transitions'] as JsonObject[]).find(
        (row) => row['from'] === 'NPC-015' && row['to'] === 'NPC-016' && row['trigger'] === trigger,
      );
      const outgoing = (form['transitionsOut'] as JsonObject[]).find(
        (row) => row['trigger'] === trigger,
      );
      const target = (source['forms'] as JsonObject[]).find((row) => row['id'] === 'NPC-016');
      const incoming = (target?.['transitionsIn'] as JsonObject[]).find(
        (row) => row['from'] === 'NPC-015' && row['trigger'] === trigger,
      );
      expect(global?.['guard']).toBe(action['guard']);
      expect(outgoing?.['guard']).toBe(action['guard']);
      expect(incoming?.['guard']).toBe(action['guard']);
    }
    const back = actions.find((row) => row['targetFormId'] === 'NPC-014');
    expect(back?.['guard']).toBe('draft cached');
    if (back === undefined) throw new Error('Missing back route');
    back['guard'] = 'custom profile must be committed';
    expect(() => assertAdr0084CustomItem(root)).toThrow('NPC-015');
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
      if (id === 'UI-CMD-NPC-NEW-VERSION')
        expect(workflow['guards']).toContain('COMMIT only: ADR0084 custom item closure:');
    },
  );
  it('does not place new custom requirements on committed receipt readback', () => {
    const { form } = editedForm('NPC-017');
    const actions = (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[];
    for (const key of ['NPC-017::CTA::001', 'NPC-017::CTA::004']) {
      const action = actions.find((row) => row['actionKey'] === key);
      expect(action).toBeDefined();
      expect(action?.['guard']).not.toContain('ADR0084');
    }
  });
  it.each(['NPC-014', 'NPC-015', 'NPC-016', 'NPC-017', 'NPC-003', 'NPC-007'])(
    'refuses removing the item layer and required controls from %s',
    (id) => {
      const { root, form } = editedForm(id);
      form['acceptanceCriteria'] = (form['acceptanceCriteria'] as string[]).filter(
        (line) => !line.startsWith('ADR0084: NPC-015 показывает'),
      );
      expect(() => assertAdr0084CustomItem(root)).toThrow(id);
    },
  );
  it.each([
    '### NPC-015 —',
    '| QA-FORM-NPC-015 |',
    '| QA-REQ-012 |',
    '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
  ])('refuses independent Markdown drift in %s', (prefix) => {
    const lines = markdown.split('\n');
    expect(lines.filter((line) => line.startsWith(prefix))).toHaveLength(1);
    const changed = lines
      .map((line) => (line.startsWith(prefix) ? line + ' changed' : line))
      .join('\n');
    expect(() => assertAdr0084CustomItemMarkdown(changed)).toThrow('atlas ADR 0084');
  });
});
