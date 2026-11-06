import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0087InitialPoison,
  assertAdr0087InitialPoisonMarkdown,
} from './initial-poison-atlas-contract.js';
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

describe('ADR 0087 initial Taipan mode and prepared poison source boundary', () => {
  it('accepts exact JSON and independent Markdown', () => {
    expect(() => assertAdr0087InitialPoison(source)).not.toThrow();
    expect(() => assertAdr0087InitialPoisonMarkdown(markdown)).not.toThrow();
  });
  it.each(['NPC-003', 'NPC-007', 'NPC-015', 'NPC-016', 'NPC-017'])(
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
    ['без default, даже если покрытия не создаются', 'первый learned mode по умолчанию'],
    ['не делают pending тип активным', 'делают pending тип активным'],
    ['не обходит его время', 'обходит время через N+1'],
    ['не восстанавливается из последнего coating', 'восстанавливается из последнего coating'],
    ['Тип новой дозы совпадает', 'Тип новой дозы не обязан совпадать'],
    ['не запускает OP-COAT', 'автоматически запускает OP-COAT'],
    ['отдельный RES-AMM-001/002 с quantity=1', 'любой ammunition stack'],
    ['явными isFood=true и canReceivePoison=true', 'выведенными из названия food flags'],
    ['Доза не копируется на linked components', 'Доза копируется на linked components'],
    ['Скрытые split/расход/остаток не создаются', 'Остаток создаётся автоматически'],
    ['currentAmmo не является coating identity', 'currentAmmo служит coating identity'],
    ['Непосредственное покрытие ranged weapon', 'Покрытие только неподходящего ranged weapon'],
    ['явно ABSENT, не 0 и не fake rolls', 'нулевые target R20/Z/anatomy'],
    ['halving не применяется дважды', 'halving применяется при prepare и delivery'],
    ['У неиспользованной дозы нет календарного expiry', 'Доза истекает через час'],
    ['промах не расходует', 'промах расходует'],
    ['Замена требует отдельного явного подтверждения', 'Замена применяется скрыто'],
    ['PREPARED не объявляет будущий COMMIT существующим', 'PREPARED создаёт future COMMIT'],
    ['Original snapshot не замораживает силу дозы', 'Original snapshot навсегда замораживает L'],
    ['текущий L при будущем вычислении', 'initial L при будущем вычислении'],
    ['последнем доказанном доступном значении', 'первоначальном доступном значении'],
    [
      'Отключённый, но читаемый источник не считается недоступным',
      'Отключённый источник считается недоступным',
    ],
    ['другой новый Тайпан не заменяет прежний source', 'новый Тайпан заменяет source'],
    ['candidate references не доказывают себя', 'candidate references доказывают себя'],
    ['restart не наносит и не расходует дозу', 'restart расходует дозу'],
  ])('refuses changing the accepted poison clause: %s', (before, after) => {
    const { root, form } = editedForm('NPC-016');
    const clauses = form['acceptanceCriteria'] as string[];
    expect(clauses.filter((line) => line.includes(before))).toHaveLength(1);
    form['acceptanceCriteria'] = clauses.map((line) => line.replace(before, after));
    expect(() => assertAdr0087InitialPoison(root)).toThrow('NPC-016');
  });
  it.each(['NPC-015', 'NPC-016', 'NPC-017'])(
    'keeps modes, physical doses, preparation and source-context fields on %s',
    (id) => {
      const { root, form } = editedForm(id);
      expect(form['requiredFields']).toEqual(
        expect.arrayContaining([
          'taipanPoisonModes[]',
          'taipanPoisonModePreparations[]',
          'activeCoatings[]',
          'poisonCoatingPreparations[]',
          'poisonSourceContextSummary',
          'poisonAuthoringValidationSummary',
        ]),
      );
      const conditional = (form['acceptanceCriteria'] as string[]).find((line) =>
        line.startsWith('ADR0087 conditional fields:'),
      );
      expect(conditional).toContain('NPC-015 позволяет завершить mode в NPC-016');
      expect(conditional).toContain('Старый сохранённый ABSENT');
      form['requiredFields'] = (form['requiredFields'] as string[]).filter(
        (field) => field !== 'taipanPoisonModes[]',
      );
      expect(() => assertAdr0087InitialPoison(root)).toThrow(id);
    },
  );
  it.each([
    ['NPC-015', 'NPC-016', 'INITIAL_STATE', 'NPC-014', 'ADR0087 coating inventory closure:'],
    ['NPC-016', 'NPC-017', 'COMMIT', 'NPC-015', 'ADR0087 poison closure:'],
  ])('mirrors %s forward guards and preserves back routes', (from, to, state, backId, witness) => {
    const { root, form } = editedForm(from!);
    const actions = (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[];
    const forward = actions.filter((row) => row['targetFormId'] === to);
    expect(forward).toHaveLength(2);
    for (const action of forward) {
      expect(action['guard']).toContain(witness);
      const trigger = action['kind'] === 'journey' ? 'J-NPC-CREATE::' + state : action['label'];
      const global = (source['transitions'] as JsonObject[]).find(
        (row) => row['from'] === from && row['to'] === to && row['trigger'] === trigger,
      );
      const outgoing = (form['transitionsOut'] as JsonObject[]).find(
        (row) => row['trigger'] === trigger,
      );
      const target = (source['forms'] as JsonObject[]).find((row) => row['id'] === to);
      const incoming = (target?.['transitionsIn'] as JsonObject[]).find(
        (row) => row['from'] === from && row['trigger'] === trigger,
      );
      expect(global?.['guard']).toBe(action['guard']);
      expect(outgoing?.['guard']).toBe(action['guard']);
      expect(incoming?.['guard']).toBe(action['guard']);
    }
    const back = actions.find((row) => row['targetFormId'] === backId);
    expect(back?.['guard']).toBe('draft cached');
    if (back === undefined) throw new Error('Missing back route');
    back['guard'] = 'coating must be committed';
    expect(() => assertAdr0087InitialPoison(root)).toThrow(from);
  });
  it.each(['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'])(
    'preserves complete workflow/phase guard and QA for %s',
    (id) => {
      const commands = (source['registryCoverage'] as JsonObject)[
        'workflowCommands'
      ] as JsonObject[];
      const workflow = commands.find((row) => row['commandId'] === id);
      if (workflow === undefined) throw new Error('Missing workflow');
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
        expect(workflow['guards']).toContain('COMMIT only: ADR0087 poison closure:');
    },
  );
  it('does not gate saved readback or N+1 OPEN on a new poison assignment', () => {
    const { form } = editedForm('NPC-017');
    const actions = (form['actions'] as JsonObject)['ctaAvailabilityByAction'] as JsonObject[];
    for (const key of ['NPC-017::CTA::001', 'NPC-017::CTA::004']) {
      const action = actions.find((row) => row['actionKey'] === key);
      expect(action).toBeDefined();
      expect(action?.['guard']).not.toContain('ADR0087');
    }
    const save = actions.find((row) => row['actionKey'] === 'NPC-017::CTA::002');
    expect(save?.['guard']).toContain('ADR0087 poison closure:');
    const global = (source['transitions'] as JsonObject[]).find(
      (row) => row['from'] === 'NPC-017' && row['trigger'] === save?.['label'],
    );
    expect(global?.['guard']).toBe(save?.['guard']);
  });
  it.each(['REQ-011', 'REQ-012'])('mirrors poison terminal states for %s', (id) => {
    const requirement = (source['coverageRequirements'] as JsonObject[]).find(
      (row) => row['requirementId'] === id,
    );
    if (requirement === undefined) throw new Error('Missing requirement');
    const delta = requirement['expectedStateDeltas'] as JsonObject;
    const states = delta['terminalStatesByForm'] as JsonObject;
    for (const form of ['NPC-015', 'NPC-016', 'NPC-017'])
      expect(states[form]).toEqual(
        expect.arrayContaining(['POISON_AUTHORING_VALID', 'POISON_AUTHORING_INVALID']),
      );
    const qa = (source['qaScenarios'] as JsonObject[]).find(
      (row) => row['qaId'] === requirement['qa'],
    );
    expect(qa?.['expected']).toContain(JSON.stringify(delta));
  });
  it.each(['NPC-015', 'NPC-016', 'NPC-017', 'NPC-003', 'NPC-007'])(
    'requires actual controls and readback on %s',
    (id) => {
      const { root, form } = editedForm(id);
      form['acceptanceCriteria'] = (form['acceptanceCriteria'] as string[]).filter(
        (line) => !line.startsWith('ADR0087 controls:'),
      );
      expect(() => assertAdr0087InitialPoison(root)).toThrow(id);
    },
  );
  it.each([
    '### NPC-015 —',
    '### NPC-016 —',
    '| QA-FORM-NPC-015 |',
    '| QA-REQ-012 |',
    '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
  ])('refuses independent Markdown drift in %s', (prefix) => {
    const lines = markdown.split('\n');
    expect(lines.filter((line) => line.startsWith(prefix))).toHaveLength(1);
    expect(() =>
      assertAdr0087InitialPoisonMarkdown(
        lines.map((line) => (line.startsWith(prefix) ? line + ' changed' : line)).join('\n'),
      ),
    ).toThrow('atlas ADR 0087');
  });
});
