import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QNA_QUESTION_CODE_ALIAS } from '../import/qna.js';

type JsonRow = Readonly<Record<string, unknown>>;
export type QuestionRefSeparator = '\n' | ';' | null;

/** Control values established by the issue #15 artifact reconnaissance. */
export const EXPECTED_QUESTION_CODE_COUNT = 411;
export const EXPECTED_QUESTION_REFERENCE_TOKEN_COUNT = 406;
export const EXPECTED_UNREFERENCED_QUESTION_CODE_COUNT = 6;

export interface QuestionRefValidationResult {
  readonly questionCodes: ReadonlySet<string>;
  readonly referencedTokens: ReadonlySet<string>;
  readonly unresolvedTokens: readonly string[];
  readonly unreferencedQuestionCodes: readonly string[];
}

/** This user-decision token belongs to another dictionary; it is the only exception. */
export const ALLOWED_NON_QUESTION_TOKENS = ['USR-2026-07-30-WEB-001'] as const;

export const QUESTION_REF_SOURCES = [
  ['rules/rules.json', 'ID вопросов', '\n'],
  ['rules/sources.json', 'ID вопросов', '\n'],
  ['bestiary/rules.json', 'Source Question IDs (не зависимости)', '\n'],
  ['character/rule-trace.json', 'Source Question IDs', '\n'],
  ['character/abilities.json', 'Source Question IDs', ';'],
  ['character/development-nodes.json', 'Source Question IDs', ';'],
  ['character/incompatibilities.json', 'Source Question IDs', ';'],
  ['character/skills.json', 'Source Question IDs', ';'],
  ['character/generated-objects.json', 'Source Question IDs', ';'],
  ['character/automation-selection.json', 'SourceQuestionID', ';'],
  ['character/skill-requirements.json', 'Source Question ID', null],
] as const satisfies readonly (readonly [string, string, QuestionRefSeparator])[];

function fail(where: string, message: string): never {
  throw new Error(`${where}: ${message}`);
}

function loadJson(specDir: string, relative: string): unknown {
  try {
    return JSON.parse(readFileSync(join(specDir, relative), 'utf8')) as unknown;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return fail(relative, `cannot load valid JSON; run "npm run import" (${detail})`);
  }
}

function loadRows(specDir: string, relative: string): readonly JsonRow[] {
  const value = loadJson(specDir, relative);
  if (
    !Array.isArray(value) ||
    value.some((row) => typeof row !== 'object' || row === null || Array.isArray(row))
  ) {
    fail(relative, 'expected an array of records');
  }
  return value as readonly JsonRow[];
}

function loadIndex(specDir: string): Readonly<Record<string, unknown>> {
  const value = loadJson(specDir, 'qna/questions-by-code.json');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('qna/questions-by-code.json', 'expected an object keyed by question code');
  }
  return value as Readonly<Record<string, unknown>>;
}

/** Split only on the delimiter declared by the owning artifact column. */
export function parseQuestionRefs(
  value: unknown,
  separator: QuestionRefSeparator,
  where = 'question reference cell',
): readonly string[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'string') fail(where, `expected text, got ${typeof value}`);
  if (value.trim() === '') return [];
  const tokens = (separator === null ? [value] : value.split(separator)).map((part) => part.trim());
  if (tokens.includes('')) fail(where, 'contains an empty token around its separator');
  return tokens;
}

function collectReferencedTokens(specDir: string): Set<string> {
  const tokens = new Set<string>();
  for (const [file, column, separator] of QUESTION_REF_SOURCES) {
    const rows = loadRows(specDir, file);
    if (!rows.some((row) => Object.hasOwn(row, column))) {
      fail(file, `column ${JSON.stringify(column)} is missing or entirely empty`);
    }
    rows.forEach((row, index) => {
      const where = `${file} [row ${String(index)}] ${column}`;
      parseQuestionRefs(row[column], separator, where).forEach((token) => tokens.add(token));
    });
  }
  return tokens;
}

function questionCodesFromIndex(index: Readonly<Record<string, unknown>>): Set<string> {
  const codes = new Set(Object.keys(index));
  if (codes.size !== EXPECTED_QUESTION_CODE_COUNT) {
    fail(
      'qna/questions-by-code.json',
      `expected ${String(EXPECTED_QUESTION_CODE_COUNT)} question codes, got ${String(codes.size)}`,
    );
  }
  const aliasRows = index[QNA_QUESTION_CODE_ALIAS.resolvedCode];
  if (
    !Array.isArray(aliasRows) ||
    aliasRows.length !== 1 ||
    aliasRows[0] !== QNA_QUESTION_CODE_ALIAS.questionNumber
  ) {
    fail(
      'qna/questions-by-code.json',
      `${QNA_QUESTION_CODE_ALIAS.resolvedCode} must address question №${String(QNA_QUESTION_CODE_ALIAS.questionNumber)} per ADR 0017`,
    );
  }
  return codes;
}

/** Require the unresolved set to be exactly the one named non-question token. */
export function assertQuestionRefsResolve(
  referencedTokens: ReadonlySet<string>,
  questionCodes: ReadonlySet<string>,
): readonly string[] {
  if (questionCodes.size === 0) fail('qna/questions-by-code.json', 'catalogue is empty');
  const unresolved = [...referencedTokens].filter((token) => !questionCodes.has(token)).sort();
  if (
    unresolved.length !== ALLOWED_NON_QUESTION_TOKENS.length ||
    unresolved.some((token, index) => token !== ALLOWED_NON_QUESTION_TOKENS[index])
  ) {
    fail(
      'question references',
      `expected only ${ALLOWED_NON_QUESTION_TOKENS.join(', ')}, got ${unresolved.join(', ') || '(none)'}`,
    );
  }
  return unresolved;
}

function requiredText(row: JsonRow, column: string, where: string): string {
  const value = row[column];
  if (typeof value !== 'string') fail(where, `${column} must be text`);
  return value;
}

function singleRow(
  rows: readonly JsonRow[],
  predicate: (row: JsonRow) => boolean,
  where: string,
  what: string,
): JsonRow {
  const matches = rows.filter(predicate);
  if (matches.length !== 1) {
    fail(where, `expected exactly one ${what}, got ${String(matches.length)}`);
  }
  return matches[0]!;
}

/** ADR 0017 guard: the aliased Q&A row must still equal its senior rule. */
export function assertQnaAliasMatchesRule(
  questions: readonly JsonRow[],
  rules: readonly JsonRow[],
): void {
  const number = QNA_QUESTION_CODE_ALIAS.questionNumber;
  const question = singleRow(
    questions,
    (row) => row['№'] === number,
    'qna/questions.json',
    `question №${String(number)}`,
  );
  const questionWhere = `qna/questions.json [№${String(number)}]`;
  if (
    requiredText(question, 'Код вопроса', questionWhere) !== QNA_QUESTION_CODE_ALIAS.artifactCode
  ) {
    fail(questionWhere, `Код вопроса must remain ${QNA_QUESTION_CODE_ALIAS.artifactCode}`);
  }

  const ruleId = 'AQ2-001';
  const rule = singleRow(
    rules,
    (row) => row['Rule ID'] === ruleId,
    'rules/rules.json',
    `${ruleId} rule`,
  );
  for (const [questionColumn, ruleColumn] of [
    ['Текст вопроса', 'Название'],
    ['Ответ', 'Итоговый алгоритм'],
  ] as const) {
    if (
      requiredText(question, questionColumn, questionWhere).trim() !==
      requiredText(rule, ruleColumn, `rules/rules.json [${ruleId}]`).trim()
    ) {
      fail(
        questionWhere,
        `${questionColumn} does not exactly match ${ruleId} ${ruleColumn} after trim()`,
      );
    }
  }
}

export function validateQuestionRefs(specDir: string): QuestionRefValidationResult {
  const questionCodes = questionCodesFromIndex(loadIndex(specDir));
  const referencedTokens = collectReferencedTokens(specDir);
  if (referencedTokens.size !== EXPECTED_QUESTION_REFERENCE_TOKEN_COUNT) {
    fail(
      'question references',
      `expected ${String(EXPECTED_QUESTION_REFERENCE_TOKEN_COUNT)} unique tokens, got ${String(referencedTokens.size)}`,
    );
  }
  const unresolvedTokens = assertQuestionRefsResolve(referencedTokens, questionCodes);
  const unreferencedQuestionCodes = [...questionCodes].filter(
    (code) => !referencedTokens.has(code),
  );
  unreferencedQuestionCodes.sort();
  if (unreferencedQuestionCodes.length !== EXPECTED_UNREFERENCED_QUESTION_CODE_COUNT) {
    fail(
      'question references',
      `expected ${String(EXPECTED_UNREFERENCED_QUESTION_CODE_COUNT)} unreferenced question codes, got ${String(unreferencedQuestionCodes.length)}`,
    );
  }
  assertQnaAliasMatchesRule(
    loadRows(specDir, 'qna/questions.json'),
    loadRows(specDir, 'rules/rules.json'),
  );
  return { questionCodes, referencedTokens, unresolvedTokens, unreferencedQuestionCodes };
}
