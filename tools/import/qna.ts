/** Q&A Registry v1.2 → generated/spec/qna and generated/types/qna.ts. */
import { join } from 'node:path';
import { banner, tsUnion, writeJson, writeText } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import type { JsonObject, JsonValue } from './lib/json.js';
import { ARTIFACT, SPEC_DIR, TYPES_DIR } from './lib/paths.js';
import { Workbook, type Row } from './lib/workbook.js';

const WHERE = 'qna';
const SOURCE = 'artifacts/registries/Symbiosis_V7_All_Questions_and_Answers_Registry_v1.2.xlsx';

const SHEET = {
  summary: 'Сводка',
  questions: 'Реестр вопросов',
  history: 'История ответов',
  changesV11: 'Изменения v1.1',
  changesV12: 'Изменения v1.2',
} as const;

const COLUMN = {
  number: '№',
  round: 'Пакет/раунд',
  code: 'Код вопроса',
  question: 'Текст вопроса',
  answer: 'Ответ',
  status: 'Статус',
  origin: 'Происхождение ответа',
} as const;

const STATUS = {
  closed: 'Закрыт',
  reformulated: 'Изменен последующим ответом и переформирован автоматически',
} as const;

/** Control values stated by the registry and the issue #15 artifact audit. */
const EXPECTED = {
  summaryRows: 24,
  questions: 444,
  artifactCodes: 410,
  addressedCodes: 411,
  repeatedArtifactCodes: 30,
  closed: 395,
  open: 0,
  reformulated: 49,
  summaryRoundsCover: 391,
  unreferencedQuestionCodes: 6,
} as const;

/**
 * ADR 0017: the senior Executable Rules registry addresses Q&A row 367 as
 * Q-MON-089. The artifact row itself stays unchanged; only the index uses this.
 */
export const QNA_QUESTION_CODE_ALIAS = {
  questionNumber: 367,
  artifactCode: 'Q-MON-083',
  resolvedCode: 'Q-MON-089',
  round: 'Application QA — раунд 2',
  status: STATUS.closed,
} as const;

/** ADR 0017 names the sole reformulation chain without a closing row. */
const CHAIN_ANOMALY = {
  code: 'Q-MON-082',
  questionNumbers: [247, 334],
} as const;

const QUESTION_COLUMNS = [
  COLUMN.number,
  COLUMN.round,
  COLUMN.code,
  COLUMN.question,
  'Номер страницы',
  'Номер абзаца',
  COLUMN.answer,
  COLUMN.status,
  'Основание статуса / поздние вопросы',
] as const;

const HISTORY_COLUMNS = [
  COLUMN.number,
  COLUMN.round,
  COLUMN.code,
  'Исходный вопрос',
  'Исходный ответ этого раунда',
  COLUMN.origin,
  COLUMN.status,
  'Поздние вопросы',
  'Файл-источник',
] as const;

export interface QnaImport {
  readonly catalogue: ReadonlySet<string>;
  readonly questions: number;
  readonly codes: number;
  readonly bytesWritten: number;
  readonly files: readonly string[];
}

interface SummaryCounts {
  readonly total: number;
  readonly closed: number;
  readonly open: number;
  readonly reformulated: number;
}

export async function importQna(): Promise<QnaImport> {
  const book = Workbook.open(ARTIFACT.qna, WHERE);
  expectCount(WHERE, 'sheets', book.sheetNames.length, 5);

  const summary = readSummary(book.sheet(SHEET.summary).rows);
  const questions = book.table(SHEET.questions, 0, QUESTION_COLUMNS).records(COLUMN.number);
  const history = book.table(SHEET.history, 0, HISTORY_COLUMNS).records(COLUMN.number);
  const changesV11 = book
    .table(SHEET.changesV11, 2, [
      'ID',
      'Объект',
      'Старое значение',
      'Новое значение',
      'Основание',
      COLUMN.status,
    ])
    .records('ID');
  const changesV12 = book
    .table(SHEET.changesV12, 2, ['ID', 'Область', 'Было', 'Стало', 'Основание', COLUMN.status])
    .records('ID');

  expectCount(WHERE, 'question rows', questions.length, EXPECTED.questions);
  expectCount(WHERE, 'answer-history rows', history.length, 444);
  expectCount(WHERE, 'v1.1 change rows', changesV11.length, 5);
  expectCount(WHERE, 'v1.2 change rows', changesV12.length, 6);
  assertNumbers(questions, history);
  assertPassChanges(changesV11, SHEET.changesV11);
  assertPassChanges(changesV12, SHEET.changesV12);
  assertQuestionCounts(questions, summary);
  assertQuestionCodeAlias(questions);

  const artifactGroups = groupQuestions(questions, false);
  expectCount(WHERE, 'artifact question codes', artifactGroups.size, EXPECTED.artifactCodes);
  const repeatedCodes = [...artifactGroups.values()].filter((rows) => rows.length > 1).length;
  expectCount(WHERE, 'repeated artifact codes', repeatedCodes, EXPECTED.repeatedArtifactCodes);

  assertQuestionChains(questions);
  const addressedGroups = groupQuestions(questions, true);
  expectCount(WHERE, 'addressed question codes', addressedGroups.size, EXPECTED.addressedCodes);
  const catalogue = new Set(addressedGroups.keys());
  const questionsByCode: JsonObject = Object.fromEntries(
    [...addressedGroups].map(([code, rows]) => [code, rows.map((row) => questionNumber(row))]),
  );

  const statuses = distinct(questions, COLUMN.status);
  const rounds = distinct(questions, COLUMN.round);
  const origins = distinct(history, COLUMN.origin);
  expectCount(WHERE, 'question statuses', statuses.length, 2);
  expectCount(WHERE, 'question rounds', rounds.length, 15);
  expectCount(WHERE, 'answer origins', origins.length, 3);

  const dir = join(SPEC_DIR, 'qna');
  let bytes = 0;
  const files: string[] = [];
  const emit = async (name: string, value: JsonValue): Promise<void> => {
    bytes += await writeJson(join(dir, name), value);
    files.push(`generated/spec/qna/${name}`);
  };

  await emit('questions.json', questions);
  await emit('answer-history.json', history);
  await emit('questions-by-code.json', questionsByCode);
  await emit('changes-v11.json', changesV11);
  await emit('changes-v12.json', changesV12);
  await emit('meta.json', {
    source: SOURCE,
    registryVersion: 'v1.2',
    questions: questions.length,
    answerHistory: history.length,
    artifactQuestionCodes: artifactGroups.size,
    questionCodes: addressedGroups.size,
    closedQuestions: summary.closed,
    openQuestions: summary.open,
    reformulatedQuestions: summary.reformulated,
    changesV11: changesV11.length,
    changesV12: changesV12.length,
    // The stale v1.1 side table is recorded, never summed or compared with 444.
    summaryRoundsCover: EXPECTED.summaryRoundsCover,
    // Derived by issue #15; resolution stays in validate, outside this importer.
    unreferencedQuestionCodes: EXPECTED.unreferencedQuestionCodes,
    gateAllPass: true,
    aliasApplied: QNA_QUESTION_CODE_ALIAS,
    chainAnomaly: { ...CHAIN_ANOMALY, questionNumbers: [...CHAIN_ANOMALY.questionNumbers] },
  });

  bytes += await writeText(
    join(TYPES_DIR, 'qna.ts'),
    renderTypes([...catalogue].sort(compare), statuses, rounds, origins),
  );
  files.push('generated/types/qna.ts');

  return {
    catalogue,
    questions: questions.length,
    codes: addressedGroups.size,
    bytesWritten: bytes,
    files,
  };
}

/** The alias is refused unless the exact collision recorded by ADR 0017 remains. */
export function assertQuestionCodeAlias(questions: readonly JsonObject[]): void {
  if (questions.length === 0) fail(WHERE, 'question catalogue is empty');

  if (
    questions.some((row) => requiredText(row, COLUMN.code) === QNA_QUESTION_CODE_ALIAS.resolvedCode)
  ) {
    fail(
      WHERE,
      `the registry now contains native code ${QNA_QUESTION_CODE_ALIAS.resolvedCode}; revisit ADR 0017`,
    );
  }

  const aliasRows = questions.filter(
    (row) => questionNumber(row) === QNA_QUESTION_CODE_ALIAS.questionNumber,
  );
  expectCount(WHERE, 'rows numbered 367', aliasRows.length, 1);
  const aliasRow = aliasRows[0]!;
  for (const [column, expected] of [
    [COLUMN.code, QNA_QUESTION_CODE_ALIAS.artifactCode],
    [COLUMN.round, QNA_QUESTION_CODE_ALIAS.round],
    [COLUMN.status, QNA_QUESTION_CODE_ALIAS.status],
  ] as const) {
    const actual = requiredText(aliasRow, column);
    if (actual !== expected) {
      fail(
        WHERE,
        `question 367 ${column}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }

  const collisions = [...groupQuestions(questions, false)].filter(
    ([, rows]) =>
      rows.filter((row) => requiredText(row, COLUMN.status) === STATUS.closed).length > 1,
  );
  expectCount(WHERE, 'closed-code collisions', collisions.length, 1);
  const [collisionCode, collisionRows] = collisions[0]!;
  if (collisionCode !== QNA_QUESTION_CODE_ALIAS.artifactCode) {
    fail(
      WHERE,
      `closed-code collision is ${JSON.stringify(collisionCode)}, not ADR 0017's Q-MON-083`,
    );
  }
  const numbers = collisionRows
    .filter((row) => requiredText(row, COLUMN.status) === STATUS.closed)
    .map(questionNumber);
  if (numbers.length !== 2 || numbers[0] !== 248 || numbers[1] !== 367) {
    fail(WHERE, `Q-MON-083 collision rows are ${numbers.join(', ')}, expected 248, 367`);
  }
}

/** Every repeated addressed code is a closed reformulation chain, except Q-MON-082. */
export function assertQuestionChains(questions: readonly JsonObject[]): void {
  if (questions.length === 0) fail(WHERE, 'question catalogue is empty');
  const groups = groupQuestions(questions, true);
  const anomaly = groups.get(CHAIN_ANOMALY.code);
  if (anomaly === undefined) fail(WHERE, `${CHAIN_ANOMALY.code} anomaly is missing`);
  const anomalyNumbers = anomaly.map(questionNumber);
  if (
    anomalyNumbers.length !== CHAIN_ANOMALY.questionNumbers.length ||
    anomalyNumbers.some((number, index) => number !== CHAIN_ANOMALY.questionNumbers[index]) ||
    anomaly.some((row) => requiredText(row, COLUMN.status) !== STATUS.reformulated)
  ) {
    fail(WHERE, `${CHAIN_ANOMALY.code} must be the ADR 0017 open chain at 247, 334`);
  }

  for (const [code, rows] of groups) {
    if (rows.length < 2 || code === CHAIN_ANOMALY.code) continue;
    const final = rows[rows.length - 1]!;
    const earlier = rows.slice(0, -1);
    if (
      earlier.some((row) => requiredText(row, COLUMN.status) !== STATUS.reformulated) ||
      requiredText(final, COLUMN.status) !== STATUS.closed
    ) {
      fail(
        WHERE,
        `invalid question chain ${JSON.stringify(code)}: ` +
          rows
            .map((row) => `${String(questionNumber(row))}:${requiredText(row, COLUMN.status)}`)
            .join(', '),
      );
    }
  }
}

function readSummary(rows: readonly Row[]): SummaryCounts {
  expectCount(WHERE, 'non-empty summary rows', rows.length, EXPECTED.summaryRows);
  const total = numericSummaryValue(rows, 'Всего вопросов');
  const closed = numericSummaryValue(rows, STATUS.closed);
  const open = numericSummaryValue(rows, 'Открыт');
  const reformulated = numericSummaryValue(rows, STATUS.reformulated);
  expectCount(WHERE, 'summary total', total, EXPECTED.questions);
  expectCount(WHERE, 'summary closed', closed, EXPECTED.closed);
  expectCount(WHERE, 'summary open', open, EXPECTED.open);
  expectCount(WHERE, 'summary reformulated', reformulated, EXPECTED.reformulated);
  if (closed + reformulated !== total) {
    fail(
      WHERE,
      `summary statuses total ${String(closed + reformulated)}, expected ${String(total)}`,
    );
  }

  // The stale columns 3–4 are not read; issue #15 records their 391 rows in meta only.
  return { total, closed, open, reformulated };
}

function numericSummaryValue(rows: readonly Row[], label: string): number {
  const matches = rows
    .filter((row) => cellText(row[0]) === label && typeof row[1] === 'number')
    .map((row) => row[1] as number)
    .filter(Number.isFinite);
  expectCount(WHERE, `numeric summary values labelled ${JSON.stringify(label)}`, matches.length, 1);
  return matches[0]!;
}

function assertNumbers(questions: readonly JsonObject[], history: readonly JsonObject[]): void {
  for (let index = 0; index < questions.length; index++) {
    const questionNo = questionNumber(questions[index]!);
    const historyNo = questionNumber(history[index]!);
    if (questionNo !== index + 1 || historyNo !== questionNo) {
      fail(
        WHERE,
        `row ${String(index)} has question/history numbers ${String(questionNo)}/${String(historyNo)}`,
      );
    }
  }
}

function assertPassChanges(rows: readonly JsonObject[], sheet: string): void {
  const ids = new Set<string>();
  rows.forEach((row, index) => {
    const id = requiredText(row, 'ID');
    if (ids.has(id)) fail(WHERE, `${sheet}[${String(index)}]: duplicate ID ${JSON.stringify(id)}`);
    ids.add(id);
    const status = requiredText(row, COLUMN.status);
    if (status !== 'PASS')
      fail(WHERE, `${sheet}/${id}: expected PASS, got ${JSON.stringify(status)}`);
  });
}

function assertQuestionCounts(questions: readonly JsonObject[], summary: SummaryCounts): void {
  const counts = new Map<string, number>();
  for (const row of questions) {
    const status = requiredText(row, COLUMN.status);
    if (status !== STATUS.closed && status !== STATUS.reformulated) {
      fail(WHERE, `unknown question status ${JSON.stringify(status)}`);
    }
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  expectCount(WHERE, 'closed question rows', counts.get(STATUS.closed) ?? 0, summary.closed);
  expectCount(
    WHERE,
    'reformulated rows',
    counts.get(STATUS.reformulated) ?? 0,
    summary.reformulated,
  );
  expectCount(WHERE, 'question rows matching summary', questions.length, summary.total);
}

function groupQuestions(
  questions: readonly JsonObject[],
  applyAlias: boolean,
): Map<string, JsonObject[]> {
  const groups = new Map<string, JsonObject[]>();
  for (const row of questions) {
    const code =
      applyAlias && questionNumber(row) === QNA_QUESTION_CODE_ALIAS.questionNumber
        ? QNA_QUESTION_CODE_ALIAS.resolvedCode
        : requiredText(row, COLUMN.code);
    const group = groups.get(code);
    if (group === undefined) groups.set(code, [row]);
    else group.push(row);
  }
  return groups;
}

function questionNumber(row: JsonObject): number {
  const value = row[COLUMN.number];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(WHERE, `question number must be an integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requiredText(row: JsonObject, column: string): string {
  const value = row[column];
  if (value === undefined || value === null || value === '') {
    fail(WHERE, `column ${JSON.stringify(column)} is empty`);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fail(WHERE, `column ${JSON.stringify(column)} holds a non-scalar value`);
}

function cellText(value: Row[number] | undefined): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value.trim() : String(value);
}

function distinct(rows: readonly JsonObject[], column: string): string[] {
  return [...new Set(rows.map((row) => requiredText(row, column)))].sort(compare);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function renderTypes(
  codes: readonly string[],
  statuses: readonly string[],
  rounds: readonly string[],
  origins: readonly string[],
): string {
  return [
    banner(SOURCE),
    '',
    tsUnion('QuestionCode', codes, '411 addressable codes after the ADR 0017 alias.'),
    '',
    tsUnion('QuestionStatus', statuses),
    '',
    tsUnion('QuestionRound', rounds),
    '',
    tsUnion('AnswerOrigin', origins),
  ].join('\n');
}
