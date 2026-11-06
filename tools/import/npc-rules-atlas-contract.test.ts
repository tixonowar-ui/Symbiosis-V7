import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertAdr0082NpcRules,
  assertAdr0082NpcRulesMarkdown,
} from './npc-rules-atlas-contract.js';
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

describe('ADR 0082 NPC source consequences', () => {
  it('accepts exact JSON and independent Markdown without claiming runtime controls', () => {
    expect(() => assertAdr0082NpcRules(source)).not.toThrow();
    expect(() => assertAdr0082NpcRulesMarkdown(markdown)).not.toThrow();
  });
  it.each([
    ['NPC-013', 'trogrStrengthAndLegacyOrNull'],
    ['NPC-014', 'sym166Pool='],
    ['NPC-014', 'skillChargeProvenance[]'],
    ['NPC-016', 'alcoholScheduleOrNoEffectOrNull'],
    ['NPC-016', 'combinedHpModesAndValidationOrNull'],
    ['NPC-017', 'sourceClosureValidationSummary'],
  ])('refuses omission of %s field %s', (id, prefix) => {
    const { root, row } = changed('forms', id);
    const fields = row['requiredFields'] as string[];
    expect(fields.filter((value) => value.startsWith(prefix))).toHaveLength(1);
    row['requiredFields'] = fields.filter((value) => !value.startsWith(prefix));
    expect(() => assertAdr0082NpcRules(root)).toThrow(id);
  });
  it.each([
    ['NPC-016', 'nextTickAt=startsAt+60 минут', 'nextTickAt=startsAt'],
    ['NPC-016', 'без округления к календарному часу', 'с округлением к календарному часу'],
    ['NPC-016', 'NO_EFFECT без effectInstance/tick', 'ACTIVE с немедленным tick'],
    ['NPC-013', 'Общий abs/max по векторам запрещён', 'Используется abs/max по векторам'],
    ['NPC-013', 'snapshot участвует ровно один раз', 'snapshot участвует дважды'],
    ['NPC-013', 'source-confirmed поглощённого Teacher', 'любого активного Teacher'],
    [
      'NPC-013',
      'не сбрасывается и при ручном изменении targetLevel',
      'сбрасывается при ручном изменении targetLevel',
    ],
    ['NPC-013', 'только для permanent stat ledger SYM-076', 'для статов, HP и брони'],
    ['NPC-016', 'maxHP=1000 при Regeneration', 'maxHP=2000 при Regeneration'],
    ['NPC-016', 'Обычный пересчёт не лечит повторно', 'Обычный пересчёт полностью лечит'],
    ['NPC-016', 'min(ceil(currentHP/2),newMaxHP)', 'min(currentHP,newMaxHP)'],
    [
      'NPC-014',
      'START, TRAINING, W, maxPermanentWisdom и W-based everIssued не изменяются',
      'Бонус добавляется в W-based everIssued',
    ],
    [
      'NPC-014',
      'того же пула без сброса charges или новой пятёрки',
      'нового пула со сбросом charges',
    ],
    [
      'NPC-014',
      'overfill сам не отключает/не удаляет навыки',
      'overfill автоматически удаляет навыки',
    ],
    [
      'NPC-014',
      'только отключает навык и не освобождает charges',
      'отключает навык и освобождает charges',
    ],
    [
      'NPC-014',
      'реальные controls выбора навыка, targetBonus и пула оплаты',
      'только read-only summary без controls',
    ],
    [
      'NPC-017',
      'Unknown, missing, foreign, stale, changed or unproven historical data refuses with zero writes',
      'Unproven historical data creates inferred source facts',
    ],
  ])('refuses source drift in %s: %s', (id, before, after) => {
    const { root, row } = changed('forms', id);
    const criteria = row['acceptanceCriteria'] as string[];
    expect(criteria.filter((value) => value.includes(before))).toHaveLength(1);
    row['acceptanceCriteria'] = criteria.map((value) => value.replace(before, after));
    expect(() => assertAdr0082NpcRules(root)).toThrow(id);
  });
  it.each(['UI-CMD-NPC-COMMIT-V1', 'UI-CMD-NPC-NEW-VERSION'])(
    'refuses losing provenance and replay guards in %s',
    (id) => {
      const { root, row } = changed('workflowCommands', id);
      expect(row['guards']).toContain('ADR0082');
      row['guards'] = 'Accept source consequences without their actual prefix.';
      expect(() => assertAdr0082NpcRules(root)).toThrow('registryCoverage');
    },
  );
  it('preserves receipt return without new authoring controls', () => {
    const { root, row } = changed('forms', 'NPC-017');
    const action = (record(row['actions'])['ctaAvailabilityByAction'] as JsonObject[]).find(
      (value) => value['actionKey'] === 'NPC-017::CTA::004',
    );
    expect(action?.['guard']).toBe('commitStatus=COMMITTED');
    if (action === undefined) throw new Error('Missing receipt action');
    action['guard'] = 'commitStatus=COMMITTED and current source choices entered again';
    expect(() => assertAdr0082NpcRules(root)).toThrow('NPC-017');
  });
  it('preserves ordinary GM-014 trauma application', () => {
    const { root, row } = changed('forms', 'GM-014');
    row['purpose'] = 'All new trauma is initial authoring without immediate consequences.';
    expect(() => assertAdr0082NpcRules(root)).toThrow('GM-014');
  });
  it.each(['QA-REQ-011', 'QA-REQ-012'])('requires independent prerequisites in %s', (id) => {
    const { root, row } = changed('qaScenarios', id);
    expect(row['scenario']).toContain('Preconditions:');
    const requirement = (source['coverageRequirements'] as JsonObject[]).find(
      (value) => value['qa'] === id,
    );
    if (requirement === undefined) throw new Error('Missing requirement for ' + id);
    for (const precondition of requirement['preconditions'] as string[])
      expect(row['scenario']).toContain(precondition);
    row['scenario'] = 'Happy path only.';
    expect(() => assertAdr0082NpcRules(root)).toThrow(id);
  });
  it.each([
    '### NPC-013 —',
    '### NPC-014 —',
    '### NPC-016 —',
    '### NPC-017 —',
    '| QA-REQ-012 |',
    '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
  ])('refuses independent Markdown drift in %s', (prefix) => {
    const lines = markdown.split('\n');
    expect(lines.filter((line) => line.startsWith(prefix))).toHaveLength(1);
    const mutated = lines
      .map((line) => (line.startsWith(prefix) ? line + ' altered contract' : line))
      .join('\n');
    expect(() => assertAdr0082NpcRulesMarkdown(mutated)).toThrow('atlas ADR 0082');
  });
});
