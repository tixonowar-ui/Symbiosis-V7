import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0085InitialLife,
  assertAdr0085InitialLifeMarkdown,
} from './initial-life-atlas-contract.js';
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
describe('ADR 0085 explicit initial life state source boundary', () => {
  it('accepts exact JSON and independent Markdown', () => {
    expect(() => assertAdr0085InitialLife(source)).not.toThrow();
    expect(() => assertAdr0085InitialLifeMarkdown(markdown)).not.toThrow();
  });
  it.each(['NPC-003', 'NPC-007', 'NPC-016', 'NPC-017'])(
    'keeps the complete ordered required-field list in QA for %s',
    (id) => {
      const { form } = editedForm(id);
      const fields = form['requiredFields'];
      if (!Array.isArray(fields) || !fields.every((field) => typeof field === 'string'))
        throw new Error('Expected source fields');
      const qa = (source['qaScenarios'] as JsonObject[]).find(
        (row) => row['qaId'] === 'QA-FORM-' + id,
      );
      expect(fields.length).toBeGreaterThan(0);
      expect(qa?.['scenario']).toContain(fields.join(', '));
    },
  );
  it.each([
    ['без default', 'ALIVE по умолчанию'],
    ['SEVERELY_WOUNDED и DEAD требуют HP=0', 'SEVERELY_WOUNDED допускает HP>0'],
    ['Host один раз выдаёт настоящий D6 fact', 'GM вводит вымышленный прежний D6'],
    ['0<remainingMinutes<=D6×5×duplicateMultiplier', 'remainingMinutes не ограничен'],
    ['Полный остаток не подставляется автоматически', 'Полный остаток подставляется'],
    ['не откатывает и не перебрасывает сохранённый D6', 'перебрасывает сохранённый D6'],
    [
      'duplicateMultiplier=4 только при действующем функциональном дубле',
      'duplicateMultiplier выбирается GM',
    ],
    ['checkbox о прошлом дубле отсутствует', 'checkbox подтверждает прошлый дубль'],
    [
      'Исчезнувший дубль не отменяет уже доказанный ×4 и не даёт текущих действий',
      'Исчезнувший дубль обнуляет ×4',
    ],
    ['prepared D6 остаётся тем же', 'prepared D6 меняется после stale preview'],
    ['не расходует SYM-030/MON-008', 'расходует SYM-030/MON-008'],
    ['Таймер при создании не тикает', 'Таймер тикает при создании'],
    ['snapshot reference не служит собственным доказательством', 'snapshot доказывает себя'],
    [
      'DEAD является терминальным текущим снимком без нового death event',
      'DEAD повторяет событие смерти',
    ],
    [
      'нет активного death timer или новых личных периодических эффектов',
      'создаётся активный death timer',
    ],
    [
      'нельзя перевести в ALIVE/SEVERELY_WOUNDED обычной N+1 правкой',
      'можно воскресить обычной N+1 правкой',
    ],
  ])('refuses changing the accepted life clause: %s', (before, after) => {
    const { root, form } = editedForm('NPC-016');
    const clauses = form['acceptanceCriteria'] as string[];
    expect(clauses.filter((line) => line.includes(before))).toHaveLength(1);
    form['acceptanceCriteria'] = clauses.map((line) => line.replace(before, after));
    expect(() => assertAdr0085InitialLife(root)).toThrow('NPC-016');
  });
  it('keeps life fields conditional and does not roll for ALIVE or DEAD', () => {
    const { root, form } = editedForm('NPC-016');
    expect(form['requiredFields']).toContain('initialLifeState=ALIVE|SEVERELY_WOUNDED|DEAD');
    expect(form['requiredFields']).toContain('lifeStateReason');
    const clauses = form['acceptanceCriteria'] as string[];
    const conditional = clauses.find((line) => line.startsWith('ADR0085 conditional life fields:'));
    expect(conditional).toContain('ALIVE/DEAD имеют null и не создают D6 или death timer');
    expect(conditional).toContain('legacy отсутствие поля');
    form['acceptanceCriteria'] = clauses.filter((line) => line !== conditional);
    expect(() => assertAdr0085InitialLife(root)).toThrow('NPC-016');
  });
  it('mirrors both forward guards and preserves safe back/time navigation', () => {
    const { root, form } = editedForm('NPC-016');
    const actions = (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[];
    const forward = actions.filter((row) => row['targetFormId'] === 'NPC-017');
    expect(forward).toHaveLength(2);
    for (const action of forward) {
      expect(action['guard']).toContain('ADR0085 initial life closure:');
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
      'ADR0085',
    );
    if (back === undefined) throw new Error('Missing back route');
    back['guard'] = 'life state must be committed';
    expect(() => assertAdr0085InitialLife(root)).toThrow('NPC-016');
  });
  it.each(['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'])(
    'preserves complete workflow/phase guard and QA for %s',
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
        throw new Error('Expected workflow text');
      expect(qa?.['expected']).toBe(atomicity + ' ' + reconnect);
      if (id === 'UI-CMD-NPC-NEW-VERSION')
        expect(workflow['guards']).toContain('COMMIT only: ADR0085 initial life closure:');
    },
  );
  it('keeps readback and N+1 OPEN separate from new life confirmation guards', () => {
    const { form } = editedForm('NPC-017');
    const actions = (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[];
    for (const key of ['NPC-017::CTA::001', 'NPC-017::CTA::004']) {
      const action = actions.find((row) => row['actionKey'] === key);
      expect(action).toBeDefined();
      expect(action?.['guard']).not.toContain('ADR0085');
    }
  });
  it.each(['NPC-016', 'NPC-017', 'NPC-003', 'NPC-007'])(
    'requires controls/readback closure on %s',
    (id) => {
      const { root, form } = editedForm(id);
      form['acceptanceCriteria'] = (form['acceptanceCriteria'] as string[]).filter(
        (line) => !line.startsWith('ADR0085 controls:'),
      );
      expect(() => assertAdr0085InitialLife(root)).toThrow(id);
    },
  );
  it.each([
    '### NPC-016 —',
    '| QA-FORM-NPC-016 |',
    '| QA-REQ-012 |',
    '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
  ])('refuses independent Markdown drift in %s', (prefix) => {
    const lines = markdown.split('\n');
    expect(lines.filter((line) => line.startsWith(prefix))).toHaveLength(1);
    const changed = lines
      .map((line) => (line.startsWith(prefix) ? line + ' changed' : line))
      .join('\n');
    expect(() => assertAdr0085InitialLifeMarkdown(changed)).toThrow('atlas ADR 0085');
  });
});
