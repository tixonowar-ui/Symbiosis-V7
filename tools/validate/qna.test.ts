import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QNA_QUESTION_CODE_ALIAS } from '../import/qna.js';
import { SPEC_DIR } from '../import/lib/paths.js';
import {
  ALLOWED_NON_QUESTION_TOKENS,
  assertQnaAliasMatchesRule,
  assertQuestionRefsResolve,
  parseQuestionRefs,
  validateQuestionRefs,
} from './question-refs.js';

type JsonRow = Readonly<Record<string, unknown>>;

const spec = <T>(relative: string): T =>
  JSON.parse(readFileSync(join(SPEC_DIR, relative), 'utf8')) as T;

describe('Q&A question references', () => {
  it('resolves all 406 source tokens except the one named user-decision token', () => {
    const result = validateQuestionRefs(SPEC_DIR);
    expect(result.questionCodes.size).toBe(411);
    expect(result.referencedTokens.size).toBe(406);
    expect(result.unresolvedTokens).toEqual(ALLOWED_NON_QUESTION_TOKENS);
    expect(result.unreferencedQuestionCodes.join(',')).toBe(
      'Q-PREDEV-013,Q-PREDEV-015,Q-PREDEV-016,Q-PREDEV-017,Q-QA-001,Q-SOUND-NIGHT-001',
    );
    expect(result.questionCodes.has(QNA_QUESTION_CODE_ALIAS.resolvedCode)).toBe(true);
  });
  it('the ADR 0017 senior-rule guard fires when question №367 text drifts', () => {
    const questions = spec<JsonRow[]>('qna/questions.json').map((row) => {
      if (row['№'] !== QNA_QUESTION_CODE_ALIAS.questionNumber) return row;
      const text = row['Текст вопроса'];
      if (typeof text !== 'string') throw new TypeError('question №367 text must be a string');
      return { ...row, 'Текст вопроса': `${text} changed` };
    });
    const rules = spec<JsonRow[]>('rules/rules.json');
    expect(() => assertQnaAliasMatchesRule(questions, rules)).toThrow(
      /Текст вопроса does not exactly match AQ2-001 Название/,
    );
  });
  it('fails when a second unresolved token appears', () => {
    const result = validateQuestionRefs(SPEC_DIR);
    const changed = new Set(result.referencedTokens);
    changed.add('FUTURE-GARBAGE');
    expect(() => assertQuestionRefsResolve(changed, result.questionCodes)).toThrow(
      /FUTURE-GARBAGE/,
    );
  });
  it('fails closed for an empty spec directory', () => {
    const empty = mkdtempSync(join(tmpdir(), 'symbiosis-qna-empty-'));
    try {
      expect(() => validateQuestionRefs(empty)).toThrow(/qna\/questions-by-code\.json/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
  it('splits only on the delimiter declared for each source column', () => {
    expect(parseQuestionRefs('Q-ONE\n Q-TWO', '\n')).toEqual(['Q-ONE', 'Q-TWO']);
    expect(parseQuestionRefs('Q-ONE; Q-TWO', ';')).toEqual(['Q-ONE', 'Q-TWO']);
    expect(parseQuestionRefs('Q-ONE, Q-TWO', ';')).toEqual(['Q-ONE, Q-TWO']);
    expect(parseQuestionRefs(' Q-ONE ', null)).toEqual(['Q-ONE']);
  });
});
