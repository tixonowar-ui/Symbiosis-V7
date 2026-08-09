/** Pinned to the registry summary and the issue #15 artifact audit. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QNA_QUESTION_CODE_ALIAS, assertQuestionChains, assertQuestionCodeAlias } from './qna.js';
import { ImportError } from './lib/fail.js';
import type { JsonObject } from './lib/json.js';
import { ARTIFACT, SPEC_DIR, TYPES_DIR } from './lib/paths.js';
import { Workbook } from './lib/workbook.js';

const CLOSED = 'Закрыт';
const REFORMULATED = 'Изменен последующим ответом и переформирован автоматически';

interface Question {
  '№': number;
  'Код вопроса': string;
  Статус: string;
}

const spec = <T>(name: string): T =>
  JSON.parse(readFileSync(join(SPEC_DIR, 'qna', name), 'utf8')) as T;

const sourceQuestions = (): JsonObject[] =>
  Workbook.open(ARTIFACT.qna, 'qna test')
    .table('Реестр вопросов', 0, ['№', 'Пакет/раунд', 'Код вопроса', 'Статус'])
    .records('№');

describe('generated Q&A spec', () => {
  it('carries all five tables at their artifact-declared sizes', () => {
    expect(spec<unknown[]>('questions.json')).toHaveLength(444);
    expect(spec<unknown[]>('answer-history.json')).toHaveLength(444);
    expect(spec<unknown[]>('changes-v11.json')).toHaveLength(5);
    expect(spec<unknown[]>('changes-v12.json')).toHaveLength(6);
  });

  it('keeps matching 1…444 row numbers and the declared status split', () => {
    const questions = spec<Question[]>('questions.json');
    const history = spec<{ '№': number }[]>('answer-history.json');
    expect(questions.every((row, index) => row['№'] === index + 1)).toBe(true);
    expect(history.map((row) => row['№'])).toEqual(questions.map((row) => row['№']));
    expect(new Set(questions.map((row) => row['Код вопроса'])).size).toBe(410);
    expect(questions.filter((row) => row['Статус'] === CLOSED)).toHaveLength(395);
    expect(questions.filter((row) => row['Статус'] === REFORMULATED)).toHaveLength(49);
    expect(questions.filter((row) => row['Статус'] === 'Открыт')).toHaveLength(0);
  });

  it('indexes every row in sheet order while applying only the ADR 0017 alias', () => {
    const expected: Record<string, number[]> = {};
    for (const row of spec<Question[]>('questions.json')) {
      const code =
        row['№'] === QNA_QUESTION_CODE_ALIAS.questionNumber
          ? QNA_QUESTION_CODE_ALIAS.resolvedCode
          : row['Код вопроса'];
      (expected[code] ??= []).push(row['№']);
    }
    const actual = spec<Record<string, number[]>>('questions-by-code.json');
    expect(actual).toEqual(expected);
    expect(Object.keys(actual)).toHaveLength(411);
    expect(actual['Q-MON-083']).toEqual([248]);
    expect(actual['Q-MON-089']).toEqual([367]);
    expect(actual['Q-MON-082']).toEqual([247, 334]);
    expect(spec<Question[]>('questions.json')[366]?.['Код вопроса']).toBe('Q-MON-083');
  });

  it('requires every declared change to pass', () => {
    for (const file of ['changes-v11.json', 'changes-v12.json']) {
      expect(spec<{ Статус: string }[]>(file).every((row) => row['Статус'] === 'PASS')).toBe(true);
    }
  });

  it('records the stale summary coverage, alias, anomaly and orphan census', () => {
    const meta = spec<{
      summaryRoundsCover: number;
      unreferencedQuestionCodes: number;
      aliasApplied: JsonObject;
      chainAnomaly: JsonObject;
    }>('meta.json');
    expect(meta.summaryRoundsCover).toBe(391);
    expect(meta.unreferencedQuestionCodes).toBe(6);
    expect(meta.aliasApplied).toMatchObject(QNA_QUESTION_CODE_ALIAS);
    expect(meta.chainAnomaly).toMatchObject({ code: 'Q-MON-082', questionNumbers: [247, 334] });
  });
});

describe('the ADR 0017 and chain guards actually fire', () => {
  it('accepts the shape the artifact currently has', () => {
    const questions = sourceQuestions();
    expect(() => assertQuestionCodeAlias(questions)).not.toThrow();
    expect(() => assertQuestionChains(questions)).not.toThrow();
  });

  it('refuses a native Q-MON-089 that would make the alias a silent overwrite', () => {
    const questions = sourceQuestions();
    questions.push({ '№': 445, 'Код вопроса': 'Q-MON-089', Статус: CLOSED });
    expect(() => assertQuestionCodeAlias(questions)).toThrow(/now contains native code Q-MON-089/);
  });

  it('refuses a second closed-code collision', () => {
    const questions = sourceQuestions();
    questions.push(
      { '№': 445, 'Код вопроса': 'Q-SECOND-COLLISION', Статус: CLOSED },
      { '№': 446, 'Код вопроса': 'Q-SECOND-COLLISION', Статус: CLOSED },
    );
    expect(() => assertQuestionCodeAlias(questions)).toThrow(
      /expected 1 closed-code collisions, got 2/,
    );
  });

  it('refuses a second chain without a closing row', () => {
    const row = (number: number, code: string): JsonObject => ({
      '№': number,
      'Код вопроса': code,
      Статус: REFORMULATED,
    });
    expect(() =>
      assertQuestionChains([
        row(247, 'Q-MON-082'),
        row(334, 'Q-MON-082'),
        row(1, 'Q-SECOND-ANOMALY'),
        row(2, 'Q-SECOND-ANOMALY'),
      ]),
    ).toThrow(/Q-SECOND-ANOMALY/);
  });

  it('refuses an empty catalogue rather than passing vacuously', () => {
    expect(() => assertQuestionChains([])).toThrow(ImportError);
  });
});

describe('generated Q&A types', () => {
  const members = (source: string, name: string): string[] => {
    const match = new RegExp(`export type ${name} =\\n((?: {2}\\| .+\\n)+)`).exec(source);
    expect(match).not.toBeNull();
    return match![1]!.trimEnd().split('\n');
  };

  it('emits the four artifact vocabularies without translation', () => {
    const source = readFileSync(join(TYPES_DIR, 'qna.ts'), 'utf8');
    const codes = members(source, 'QuestionCode');
    expect(codes).toHaveLength(411);
    expect(codes.some((line) => line.includes('Q-MON-089'))).toBe(true);
    expect(members(source, 'QuestionStatus')).toHaveLength(2);
    expect(members(source, 'QuestionRound')).toHaveLength(15);
    expect(members(source, 'AnswerOrigin')).toHaveLength(3);
    expect(source.startsWith('// Generated by tools/import.')).toBe(true);
    expect(source).not.toContain('\r\n');
  });
});
