import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0086TemporaryWeaver,
  assertAdr0086TemporaryWeaverMarkdown,
} from './temporary-weaver-atlas-contract.js';
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

describe('ADR 0086 formal current Weaver state source boundary', () => {
  it('accepts exact JSON and independent Markdown', () => {
    expect(() => assertAdr0086TemporaryWeaver(source)).not.toThrow();
    expect(() => assertAdr0086TemporaryWeaverMarkdown(markdown)).not.toThrow();
  });
  it.each([
    ['Original R20 имеет явное ABSENT', 'GM вводит прошлый R20'],
    ['CTX-SYM-030-PEACE=false неизменны', 'CTX-SYM-030-PEACE=true'],
    ['CurrentOE сохраняется точно, включая 0', 'требуется 50 OE'],
    ['DEAD запрещает эти личные эффекты', 'DEAD сохраняет активную замену'],
    ['HP=0 и подтверждённое abstractVitalSystemDamaged', 'любой HP без повреждения'],
    ['REPLACEMENT_TEMPORARY максимум 5 минут', 'REPLACEMENT_TEMPORARY максимум 6 минут'],
    ['REPLACEMENT_RECOVERY — 7 минут', 'REPLACEMENT_RECOVERY — 8 минут'],
    ['DUPLICATED_ORGANS_PROTECTION — 10 минут', 'DUPLICATED_ORGANS_PROTECTION — 11 минут'],
    ['0<remainingMinutes<=соответствующий максимум', 'remainingMinutes не ограничен'],
    ['не более одной текущей замены', 'любое число текущих замен'],
    ['не более одной DUPLICATED_ORGANS_PROTECTION', 'любое число защит'],
    ['несколько источников не усиливают исходный ×4', 'два источника дают ×16'],
    ['original death deadline никогда не продлевается редактором', 'death deadline продлевается'],
    ['Скрытый max, новый life D6 и перезапуск жизни запрещены', 'новый life D6 разрешён'],
    ['не превращают истёкший эффект в живой', 'превращают истёкший эффект в живой'],
    ['Истёкший неразрешённый source блокирует current snapshot', 'истёкший source разрешён'],
    ['Явное снятие требует отдельной причины', 'снятие выполняется автоматически'],
    ['Candidate хранит только refs', 'Candidate доказывает свою history'],
    ['Historical snapshots читаются со своим original context', 'history читается в current time'],
  ])('refuses weakening the accepted formal clause: %s', (before, after) => {
    const { root, form } = editedForm('NPC-016');
    const clauses = form['acceptanceCriteria'] as string[];
    expect(clauses.filter((line) => line.includes(before))).toHaveLength(1);
    form['acceptanceCriteria'] = clauses.map((line) => line.replace(before, after));
    expect(() => assertAdr0086TemporaryWeaver(root)).toThrow('NPC-016');
  });
  it.each(['NPC-003', 'NPC-007', 'NPC-016', 'NPC-017'])(
    'keeps the complete required-field list and controls/readback on %s',
    (id) => {
      const { root, form } = editedForm(id);
      const fields = form['requiredFields'];
      if (!Array.isArray(fields) || !fields.every((field) => typeof field === 'string'))
        throw new Error('Expected source fields');
      const qa = (source['qaScenarios'] as JsonObject[]).find(
        (row) => row['qaId'] === 'QA-FORM-' + id,
      );
      expect(qa?.['scenario']).toContain(fields.join(', '));
      form['acceptanceCriteria'] = (form['acceptanceCriteria'] as string[]).filter(
        (line) => !line.startsWith('ADR0086 controls:'),
      );
      expect(() => assertAdr0086TemporaryWeaver(root)).toThrow(id);
    },
  );
  it('keeps preparation distinct from final life closure, without a default temporary state', () => {
    const { root, form } = editedForm('NPC-016');
    const clauses = form['acceptanceCriteria'] as string[];
    expect(clauses.find((line) => line.startsWith('ADR0086 source/life closure:'))).toContain(
      'Технический preparation допускает незавершённый draft',
    );
    const conditional = clauses.find((line) => line.startsWith('ADR0086 conditional fields:'));
    expect(conditional).toContain('пустой массив означает их явное отсутствие');
    expect(conditional).toContain('browser не поставляет производные effects или historical proof');
    form['acceptanceCriteria'] = clauses.filter((line) => line !== conditional);
    expect(() => assertAdr0086TemporaryWeaver(root)).toThrow('NPC-016');
  });
  it('mirrors both forward guards and keeps safe back and time navigation available', () => {
    const { root, form } = editedForm('NPC-016');
    const actions = (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[];
    const forward = actions.filter((row) => row['targetFormId'] === 'NPC-017');
    expect(forward).toHaveLength(2);
    for (const action of forward) {
      expect(action['guard']).toContain('ADR0086 temporary Weaver closure:');
      const trigger = action['kind'] === 'journey' ? 'J-NPC-CREATE::COMMIT' : action['label'];
      const global = (source['transitions'] as JsonObject[]).find(
        (row) => row['from'] === 'NPC-016' && row['to'] === 'NPC-017' && row['trigger'] === trigger,
      );
      const outgoing = (form['transitionsOut'] as JsonObject[]).find(
        (row) => row['trigger'] === trigger,
      );
      const target = (source['forms'] as JsonObject[]).find((row) => row['id'] === 'NPC-017');
      const incoming = (target?.['transitionsIn'] as JsonObject[]).find(
        (row) => row['from'] === 'NPC-016' && row['trigger'] === trigger,
      );
      expect(global?.['guard']).toBe(action['guard']);
      expect(outgoing?.['guard']).toBe(action['guard']);
      expect(incoming?.['guard']).toBe(action['guard']);
    }
    const back = actions.find((row) => row['targetFormId'] === 'NPC-015');
    expect(back?.['guard']).toBe('draft cached');
    expect(actions.find((row) => row['targetFormId'] === 'NET-016')?.['guard']).not.toContain(
      'ADR0086',
    );
    if (back === undefined) throw new Error('Missing back route');
    back['guard'] = 'temporary state must be committed';
    expect(() => assertAdr0086TemporaryWeaver(root)).toThrow('NPC-016');
  });
  it.each(['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'])(
    'keeps full workflow and QA closure for %s',
    (id) => {
      const workflows = (source['registryCoverage'] as JsonObject)[
        'workflowCommands'
      ] as JsonObject[];
      const workflow = workflows.find((row) => row['commandId'] === id);
      if (workflow === undefined) throw new Error('Missing workflow');
      const qa = (source['qaScenarios'] as JsonObject[]).find(
        (row) => row['qaId'] === workflow['qa'],
      );
      expect(qa?.['scenario']).toContain(workflow['guards']);
      const atomicity = workflow['atomicity'],
        reconnect = workflow['reconnect'];
      if (typeof atomicity !== 'string' || typeof reconnect !== 'string')
        throw new Error('Expected workflow strings');
      expect(qa?.['expected']).toBe(atomicity + ' ' + reconnect);
      if (id === 'UI-CMD-NPC-NEW-VERSION')
        expect(workflow['guards']).toContain('COMMIT only: ADR0086 temporary Weaver closure:');
    },
  );
  it('does not gate readback or N+1 OPEN on a new temporary assignment', () => {
    const { form } = editedForm('NPC-017');
    const actions = (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[];
    for (const key of ['NPC-017::CTA::001', 'NPC-017::CTA::004']) {
      const action = actions.find((row) => row['actionKey'] === key);
      expect(action).toBeDefined();
      expect(action?.['guard']).not.toContain('ADR0086');
    }
  });
  it.each([
    '### NPC-016 —',
    '| QA-FORM-NPC-016 |',
    '| QA-REQ-012 |',
    '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
  ])('refuses independent Markdown drift in %s', (prefix) => {
    const lines = markdown.split('\n');
    expect(lines.filter((line) => line.startsWith(prefix))).toHaveLength(1);
    expect(() =>
      assertAdr0086TemporaryWeaverMarkdown(
        lines.map((line) => (line.startsWith(prefix) ? line + ' changed' : line)).join('\n'),
      ),
    ).toThrow('atlas ADR 0086');
  });
});
