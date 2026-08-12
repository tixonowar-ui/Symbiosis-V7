import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CONFIRMED_GRADES,
  CREATION_CRITICAL_FORM_ID,
  CREATION_CRITICAL_RULE_IDS,
  CRITICAL_POLARITIES,
  createRollSourceSnapshot,
  CreationCriticalRuleError,
  resolveAutoRoll,
  resolveCreationCritical,
  resolveManualRoll,
  RuleHandlerRegistry,
} from '../index.js';
import type { CreationCriticalInput, CreationCriticalOutcome, MechanicalRoll } from '../index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RULE_IDS = ['CORE-083', 'CORE-084', 'CORE-163'] as const;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(`${REPO_ROOT}/${path}`, 'utf8')) as unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((entry, index) => record(entry, `${label}[${String(index)}]`));
}

function stringField(row: Record<string, unknown>, key: string, label: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new TypeError(`${label}.${key} must be a string`);
  return value;
}

function integerField(row: Record<string, unknown>, key: string, label: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label}.${key} must be a safe integer`);
  }
  return value;
}

const RULES = records(readJson('generated/spec/rules/rules.json'), 'rules');
const RULE_DICTIONARIES = records(
  readJson('generated/spec/rules/dictionaries.json'),
  'rules dictionaries',
);
const CHARACTER_DICTIONARIES = records(
  readJson('generated/spec/character/dictionaries.json'),
  'character dictionaries',
);
const EVENT_POINT_ROWS = records(
  readJson('generated/spec/character/xp-runtime/event-points.json'),
  'event points',
);
const FORMS = record(readJson('generated/spec/atlas/forms-by-id.json'), 'forms-by-id');
const QUESTIONS = records(readJson('generated/spec/qna/questions.json'), 'questions');

function rule(ruleId: (typeof RULE_IDS)[number]): Record<string, unknown> {
  const found = RULES.find((entry) => entry['Rule ID'] === ruleId);
  if (found === undefined) throw new Error(`rule ${ruleId} not found`);
  return found;
}

function d20(rawFace: number): MechanicalRoll {
  return { dieSides: 20, rawFace };
}

function autoD20(rawFace: number, identity: string): MechanicalRoll {
  const request = createRollSourceSnapshot({
    dieSides: 20,
    modeSnapshot: 'AUTO',
    originatingCommandId: `originating-${identity}`,
    rollRequestId: `auto-${identity}`,
  });
  return resolveAutoRoll({ request, submitCommandId: `submit-${identity}` }, null, () => rawFace)
    .resolution.mechanical;
}

function manualD20(rawFace: number, identity: string): MechanicalRoll {
  const snapshot = createRollSourceSnapshot({
    dieSides: 20,
    modeSnapshot: 'MANUAL',
    originatingCommandId: `originating-${identity}`,
    rollRequestId: `manual-${identity}`,
  });
  const result = resolveManualRoll(snapshot, rawFace);
  if (!result.ok) throw new Error(`test face ${String(rawFace)} was not a valid manual d20`);
  return result.resolution.mechanical;
}

function resolve(
  originFace: number,
  confirmationFaces: readonly number[],
): CreationCriticalOutcome {
  return resolveCreationCritical({
    confirmationRolls: confirmationFaces.map(d20),
    originRoll: d20(originFace),
  });
}

describe('CHR-004 creation criticals', () => {
  it('anchors CORE-083/084/163 and all thirteen CHR-004 required fields', () => {
    expect(CREATION_CRITICAL_FORM_ID).toBe('CHR-004');
    expect(CREATION_CRITICAL_RULE_IDS).toEqual(RULE_IDS);
    for (const ruleId of RULE_IDS) {
      expect(rule(ruleId)).toMatchObject({
        'Rule ID': ruleId,
        'Режим реализации': 'Реализовать в игровом ядре',
        Статус: 'Активно',
      });
    }
    expect(stringField(rule('CORE-083'), 'Итоговый алгоритм', 'CORE-083')).toContain('15–20');
    expect(stringField(rule('CORE-084'), 'Итоговый алгоритм', 'CORE-084')).toContain('1–5');
    expect(stringField(rule('CORE-163'), 'Предусловия', 'CORE-163')).toContain(
      'обычный успех/провал не требуется',
    );
    expect(stringField(rule('CORE-163'), 'Броски / формулы', 'CORE-163')).toContain(
      'характеристика остаётся базово 1',
    );

    const form = record(FORMS[CREATION_CRITICAL_FORM_ID], CREATION_CRITICAL_FORM_ID);
    expect(form.id).toBe('CHR-004');
    expect(form.purpose).toBe('Цепочки подтверждения натуральных 20 и 1 до решения о наборе.');
    expect(form.requiredFields).toEqual([
      'characterDraftId',
      'setRollReceiptId',
      'criticalQueueIndex',
      'originFace=1|20',
      'confirmationRollRequestId',
      'diceInputModeSnapshot=AUTO|MANUAL',
      'confirmationFaceOrNull',
      'confirmationReceiptIdOrNull',
      'returnDecisionFormId(server-signed)=CHR-005|CHR-006|CHR-007|CHR-008',
      'branchUuid',
      'wizardCheckpointId',
      'draftRevision',
      'commandId',
    ]);
  });

  it('derives the allowed grade and polarity catalogs from generated spec', () => {
    const grades = [
      ...new Set(
        EVENT_POINT_ROWS.map((row, index) =>
          integerField(row, 'ConfirmedGrade', `event points[${String(index)}]`),
        ),
      ),
    ].sort((left, right) => left - right);
    const pointPolicyIds = EVENT_POINT_ROWS.map((row, index) =>
      stringField(row, 'PointPolicyID', `event points[${String(index)}]`),
    );
    const polarities = CHARACTER_DICTIONARIES.filter(
      (row) => row.Dictionary === 'CriticalPolarity',
    ).map((row, index) => stringField(row, 'Code', `CriticalPolarity[${String(index)}]`));

    expect(EVENT_POINT_ROWS).toHaveLength(7);
    expect(CONFIRMED_GRADES).toEqual(grades);
    expect(pointPolicyIds).toEqual([
      'NATURAL_20_GRADE_0',
      'NATURAL_1_GRADE_0',
      'CONFIRMED_CRIT',
      'CONFIRMED_DOUBLE_CRIT',
      'CONFIRMED_TRIPLE_CRIT',
      'CONFIRMED_ULTRA_CRIT',
      'CONFIRMED_RAMPAGE',
    ]);
    expect(CRITICAL_POLARITIES).toEqual(polarities);
  });

  it('produces the same outcome for ADR 0021 AUTO and MANUAL mechanical rolls', () => {
    const cases = [
      { confirmations: [15, 19], originFace: 20 },
      { confirmations: [5, 2], originFace: 1 },
    ] as const;

    for (const [caseIndex, entry] of cases.entries()) {
      const automatic = resolveCreationCritical({
        confirmationRolls: entry.confirmations.map((face, index) =>
          autoD20(face, `${String(caseIndex)}-confirmation-${String(index)}`),
        ),
        originRoll: autoD20(entry.originFace, `${String(caseIndex)}-origin`),
      });
      const manual = resolveCreationCritical({
        confirmationRolls: entry.confirmations.map((face, index) =>
          manualD20(face, `${String(caseIndex)}-confirmation-${String(index)}`),
        ),
        originRoll: manualD20(entry.originFace, `${String(caseIndex)}-origin`),
      });

      expect(automatic).toEqual(manual);
    }
  });

  it('anchors CHARACTER_CREATION and confirmations as NEVER_PROGRESSION', () => {
    const creationRollKind = RULE_DICTIONARIES.find(
      (row) => row['Группа'] === 'RollKind' && row['Значение'] === 'CHARACTER_CREATION',
    );
    const confirmationSource = CHARACTER_DICTIONARIES.find(
      (row) => row.Dictionary === 'XpNeverSource' && row.Code === 'CRITICAL_CONFIRMATION',
    );
    const xpRollKinds = CHARACTER_DICTIONARIES.filter((row) => row.Dictionary === 'XpRollKind').map(
      (row) => row.Code,
    );
    const qCore050 = QUESTIONS.find((row) => row['Код вопроса'] === 'Q-CORE-050');

    expect(creationRollKind).toMatchObject({
      Определение: 'NEVER_PROGRESSION: XP/points не создаются.',
    });
    expect(confirmationSource).toMatchObject({ Meaning: 'isConfirmationRoll=true' });
    expect(xpRollKinds).not.toContain('CHARACTER_CREATION');
    if (qCore050 === undefined) throw new Error('question Q-CORE-050 not found');
    expect(stringField(qCore050, 'Ответ', 'Q-CORE-050')).toContain(
      'Счётчики развития начинают заполняться после завершения',
    );
    expect(stringField(rule('CORE-163'), 'Исключения / приоритет', 'CORE-163')).toContain(
      'Натуральная 1/20 здесь не создаёт XP и баллы',
    );
  });

  it('raises a confirmed natural 20 to value 21', () => {
    expect(resolve(20, [15])).toEqual({
      criticalGrade: 1,
      criticalPolarity: 'SUCCESS',
      value: 21,
    });
  });

  it('reaches Rampage at grade 5 and caps every later confirmation', () => {
    expect(resolve(20, [20, 19, 18, 17, 16])).toEqual({
      criticalGrade: 5,
      criticalPolarity: 'SUCCESS',
      value: 25,
    });
    expect(resolve(20, [20, 19, 18, 17, 16, 15, 20])).toEqual({
      criticalGrade: 5,
      criticalPolarity: 'SUCCESS',
      value: 25,
    });
  });

  it('counts only the leading consecutive confirmation chain', () => {
    expect(resolve(20, [18, 14, 19])).toEqual({
      criticalGrade: 1,
      criticalPolarity: 'SUCCESS',
      value: 21,
    });
  });

  it('leaves an unconfirmed natural 20 unchanged with NONE polarity', () => {
    const outcome = resolve(20, [14]);
    expect(outcome).toEqual({ criticalGrade: 0, criticalPolarity: 'NONE', value: 20 });
    expect(outcome).not.toHaveProperty('creationCriticalPenalty');
  });

  it('keeps a confirmed natural 1 at value 1 and returns an unbound penalty', () => {
    expect(resolve(1, [3, 2])).toEqual({
      creationCriticalPenalty: -2,
      criticalGrade: 2,
      criticalPolarity: 'FAILURE',
      value: 1,
    });
  });

  it('does not create a penalty for an unconfirmed natural 1', () => {
    const outcome = resolve(1, [6]);
    expect(outcome).toEqual({ criticalGrade: 0, criticalPolarity: 'NONE', value: 1 });
    expect(outcome).not.toHaveProperty('creationCriticalPenalty');
  });

  it.each([2, 7, 19])('rejects noncritical origin face %i', (originFace) => {
    expect(() => resolve(originFace, [])).toThrowError(CreationCriticalRuleError);
    expect(() => resolve(originFace, [])).toThrow(
      `CHR-004: originRoll.rawFace must be 1 or 20; received ${String(originFace)}`,
    );
  });

  it('rejects a malformed top-level input explicitly', () => {
    expect(() => resolveCreationCritical(null as unknown as CreationCriticalInput)).toThrow(
      'CHR-004: input must be a creation-critical input object; received null',
    );
  });

  it.each([0, 21, 1.5])('rejects confirmation face %s outside integer d20', (rawFace) => {
    expect(() => resolve(20, [rawFace])).toThrow(
      `confirmationRolls[0].rawFace must be an integer in 1..20; received ${String(rawFace)}`,
    );
  });

  it('rejects non-d20 origin and confirmation rolls', () => {
    expect(() =>
      resolveCreationCritical({ confirmationRolls: [], originRoll: { dieSides: 12, rawFace: 1 } }),
    ).toThrow('originRoll.dieSides must be 20; received 12');
    expect(() =>
      resolveCreationCritical({
        confirmationRolls: [{ dieSides: 12, rawFace: 1 }],
        originRoll: d20(1),
      }),
    ).toThrow('confirmationRolls[0].dieSides must be 20; received 12');
  });

  it('validates an invalid tail even after a miss or the grade cap', () => {
    expect(() => resolve(20, [18, 14, 21])).toThrow('confirmationRolls[2].rawFace');
    expect(() => resolve(20, [20, 20, 20, 20, 20, 20, 0])).toThrow('confirmationRolls[6].rawFace');
  });

  it('rejects a sparse confirmation tail instead of skipping it', () => {
    const confirmationRolls = [d20(18), d20(14)];
    confirmationRolls.length = 3;

    expect(() => resolveCreationCritical({ confirmationRolls, originRoll: d20(20) })).toThrow(
      'confirmationRolls[2] must be a d20 MechanicalRoll object; received undefined',
    );
  });

  it('returns no XP, event points, or development-counter outcome', () => {
    const success = resolve(20, [15]);
    const failure = resolve(1, [5]);
    expect(Object.keys(success).sort()).toEqual(['criticalGrade', 'criticalPolarity', 'value']);
    expect(Object.keys(failure).sort()).toEqual([
      'creationCriticalPenalty',
      'criticalGrade',
      'criticalPolarity',
      'value',
    ]);
    for (const outcome of [success, failure]) {
      expect(outcome).not.toHaveProperty('xp');
      expect(outcome).not.toHaveProperty('eventPoints');
      expect(outcome).not.toHaveProperty('developmentCounter');
      expect(Object.isFrozen(outcome)).toBe(true);
    }
  });

  it('dispatches the scoped CORE-163 handler without changing the registry', () => {
    const registry = new RuleHandlerRegistry<CreationCriticalInput, CreationCriticalOutcome>();
    registry.register('CORE-163', resolveCreationCritical);

    expect(
      registry.dispatch('CORE-163', {
        confirmationRolls: [d20(1)],
        originRoll: d20(1),
      }),
    ).toEqual({
      creationCriticalPenalty: -1,
      criticalGrade: 1,
      criticalPolarity: 'FAILURE',
      value: 1,
    });
  });
});
