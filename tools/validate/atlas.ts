export interface AtlasValidationProblem {
  readonly file: string;
  readonly id: string;
  readonly message: string;
}

export interface RendererFormCatalogueValidation {
  readonly forms: ReadonlySet<string>;
  readonly problems: readonly AtlasValidationProblem[];
}

const FORM_INDEX_FILE = 'atlas/renderer/forms-by-id.json';
const DETAILED_FORM_INDEX_FILE = 'atlas/forms-by-id.json';
const FORMS_FILE = DETAILED_FORM_INDEX_FILE;
const JOURNEYS_FILE = 'atlas/journeys.json';
const QA_SCENARIOS_FILE = 'atlas/qa-scenarios.json';
const TRANSITIONS_FILE = 'atlas/transitions.json';

const ADR_0037_ENTRY_GUARD =
  'Новый immutable UUID; обязательны имя, возраст, пол и положительная massKg 0,1; описание/арт необязательны.';
const ADR_0037_CONTINUE_GUARD =
  'UI-CMD-CHAR-WIZARD-CHECKPOINT stage=IDENTITY; name/age/sex present; massKg>0 at step 0.1; immutable draft UUID committed';
const ADR_0037_IDENTITY_INCOMPLETE =
  'Continue is absent until name/age/sex/positive 0.1kg mass validate.';

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textField(
  row: JsonRecord,
  field: string,
  file: string,
  id: string,
  problems: AtlasValidationProblem[],
): string | null {
  const value = row[field];
  if (typeof value !== 'string' || value === '') {
    problems.push({ file, id, message: `${field} is empty or not text` });
    return null;
  }
  return value;
}

function textArrayField(
  row: JsonRecord,
  field: string,
  file: string,
  id: string,
  problems: AtlasValidationProblem[],
): readonly string[] | null {
  const value = row[field];
  if (!Array.isArray(value)) {
    problems.push({ file, id, message: `${field} is not an array of text values` });
    return null;
  }
  const result: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'string') {
      problems.push({ file, id, message: `${field} is not an array of text values` });
      return null;
    }
    result.push(entry);
  }
  return result;
}

function recordArrayField(
  row: JsonRecord,
  field: string,
  file: string,
  id: string,
  problems: AtlasValidationProblem[],
): readonly unknown[] | null {
  const value = row[field];
  if (!Array.isArray(value)) {
    problems.push({ file, id, message: `${field} is not an array` });
    return null;
  }
  return Array.from(value as readonly unknown[]);
}

function singleRecord(
  rows: readonly unknown[],
  predicate: (row: JsonRecord) => boolean,
  file: string,
  id: string,
  description: string,
  problems: AtlasValidationProblem[],
): JsonRecord | null {
  const matches = rows.filter((row): row is JsonRecord => isRecord(row) && predicate(row));
  if (matches.length !== 1) {
    problems.push({
      file,
      id,
      message: `expected exactly one ${description}, got ${String(matches.length)}`,
    });
    return null;
  }
  return matches[0]!;
}

function expectLiteral(
  row: JsonRecord,
  field: string,
  expected: string,
  file: string,
  id: string,
  label: string,
  problems: AtlasValidationProblem[],
): void {
  const actual = row[field];
  if (actual !== expected) {
    problems.push({
      file,
      id,
      message:
        `${field} differs from ADR 0037 ${label}: expected ${JSON.stringify(expected)}, ` +
        `got ${JSON.stringify(actual)}`,
    });
  }
}

/**
 * The renderer index is now the form catalogue. Its object key and embedded
 * `id` are two independently consumed addresses, so require them to agree.
 */
export function validateRendererFormCatalogue(
  index: Readonly<Record<string, unknown>>,
  idPattern: RegExp,
  expectedCount: number | null,
): RendererFormCatalogueValidation {
  const problems: AtlasValidationProblem[] = [];
  const forms = new Set<string>();
  const entries = Object.entries(index);

  if (expectedCount !== null && entries.length !== expectedCount) {
    problems.push({
      file: FORM_INDEX_FILE,
      id: '-',
      message:
        `expected ${String(expectedCount)} form entries from atlas/meta.json counts.forms, ` +
        `got ${String(entries.length)}`,
    });
  }

  for (const [key, value] of entries) {
    if (!isRecord(value)) {
      problems.push({ file: FORM_INDEX_FILE, id: key, message: 'entry is not an object' });
      continue;
    }

    const embedded = value['id'];
    if (typeof embedded !== 'string' || embedded === '') {
      problems.push({ file: FORM_INDEX_FILE, id: key, message: 'id is empty or not text' });
      continue;
    }

    if (forms.has(embedded)) {
      problems.push({ file: FORM_INDEX_FILE, id: embedded, message: 'duplicate id' });
    }
    if (!idPattern.test(embedded)) {
      problems.push({
        file: FORM_INDEX_FILE,
        id: embedded,
        message: `id does not match ${String(idPattern)}`,
      });
    }
    if (key !== embedded) {
      problems.push({
        file: FORM_INDEX_FILE,
        id: key,
        message: `key does not match embedded id ${JSON.stringify(embedded)}`,
      });
    }
    forms.add(embedded);
  }

  return { forms, problems };
}

/** The retained detailed index must address exactly the compact catalogue. */
export function validateDetailedFormIndexKeys(
  detailedIndex: Readonly<Record<string, unknown>>,
  rendererForms: ReadonlySet<string>,
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];
  const detailedKeys = new Set(Object.keys(detailedIndex));

  for (const id of rendererForms) {
    if (!detailedKeys.has(id)) {
      problems.push({
        file: DETAILED_FORM_INDEX_FILE,
        id,
        message: `key is missing for id declared in ${FORM_INDEX_FILE}`,
      });
    }
  }
  for (const key of detailedKeys) {
    if (!rendererForms.has(key)) {
      problems.push({
        file: DETAILED_FORM_INDEX_FILE,
        id: key,
        message: `key is not declared in ${FORM_INDEX_FILE}`,
      });
    }
  }

  return problems;
}

/**
 * Atlas form prose is intentionally authored once and repeated literally in
 * its QA row. Validate the declared mapping and forward-render the field list;
 * parsing the comma-separated prose back into fields would be ambiguous.
 */
export function validateAtlasFormQaMirrors(
  formRows: readonly unknown[],
  qaRows: readonly unknown[],
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];
  const qaById = new Map<string, JsonRecord[]>();

  for (const value of qaRows) {
    if (!isRecord(value) || typeof value['qaId'] !== 'string' || value['qaId'] === '') continue;
    const matches = qaById.get(value['qaId']) ?? [];
    matches.push(value);
    qaById.set(value['qaId'], matches);
  }

  const formIds = new Set<string>();
  formRows.forEach((value, index) => {
    const rowId = `row ${String(index)}`;
    if (!isRecord(value)) {
      problems.push({ file: FORMS_FILE, id: rowId, message: 'expected a record' });
      return;
    }

    const id = textField(value, 'id', FORMS_FILE, rowId, problems);
    if (id === null) return;
    if (formIds.has(id)) {
      problems.push({ file: FORMS_FILE, id, message: 'duplicate id' });
    }
    formIds.add(id);

    const purpose = textField(value, 'purpose', FORMS_FILE, id, problems);
    const requiredFields = textArrayField(value, 'requiredFields', FORMS_FILE, id, problems);
    const qaScenarioIds = textArrayField(value, 'qaScenarioIds', FORMS_FILE, id, problems);
    const acceptance = textArrayField(value, 'acceptanceCriteria', FORMS_FILE, id, problems);
    const expectedQaId = `QA-FORM-${id}`;

    if (qaScenarioIds !== null) {
      const references = qaScenarioIds.filter((qaId) => qaId === expectedQaId).length;
      if (references !== 1) {
        problems.push({
          file: FORMS_FILE,
          id,
          message:
            `qaScenarioIds contains ${JSON.stringify(expectedQaId)} ${String(references)} times, ` +
            'expected 1',
        });
      }
    }

    if (purpose !== null && acceptance !== null) {
      const expected = `Назначение реализовано буквально: ${purpose}`;
      const matches = acceptance.filter((criterion) => criterion === expected).length;
      if (matches !== 1) {
        problems.push({
          file: FORMS_FILE,
          id,
          message:
            `acceptanceCriteria contains the literal purpose criterion ${String(matches)} times, ` +
            'expected 1',
        });
      }
    }

    const qaMatches = qaById.get(expectedQaId) ?? [];
    if (qaMatches.length !== 1) {
      problems.push({
        file: QA_SCENARIOS_FILE,
        id: expectedQaId,
        message: `expected exactly one QA row, got ${String(qaMatches.length)}`,
      });
      return;
    }

    const qa = qaMatches[0]!;
    const scope = textField(qa, 'scope', QA_SCENARIOS_FILE, expectedQaId, problems);
    if (scope !== null && scope !== id) {
      problems.push({
        file: QA_SCENARIOS_FILE,
        id: expectedQaId,
        message: `scope ${JSON.stringify(scope)} does not match form id ${JSON.stringify(id)}`,
      });
    }

    const scenario = textField(qa, 'scenario', QA_SCENARIOS_FILE, expectedQaId, problems);
    if (scenario === null) return;
    if (purpose !== null) {
      const purposeLiteral = `Проверить буквальное назначение ${id}: ${purpose}`;
      if (!scenario.includes(purposeLiteral)) {
        problems.push({
          file: QA_SCENARIOS_FILE,
          id: expectedQaId,
          message: `scenario does not contain literal purpose from ${FORMS_FILE}`,
        });
      }
    }
    if (requiredFields !== null) {
      const fieldsLiteral = `Поля: ${requiredFields.join(', ')}.`;
      if (!scenario.includes(fieldsLiteral)) {
        problems.push({
          file: QA_SCENARIOS_FILE,
          id: expectedQaId,
          message: `scenario does not contain requiredFields joined with ", " from ${FORMS_FILE}`,
        });
      }
    }
  });

  for (const qaId of qaById.keys()) {
    if (qaId.startsWith('QA-FORM-') && !formIds.has(qaId.slice('QA-FORM-'.length))) {
      problems.push({
        file: QA_SCENARIOS_FILE,
        id: qaId,
        message: 'QA-FORM row has no matching form',
      });
    }
  }

  return problems;
}

interface TransitionTuple {
  readonly from: string;
  readonly to: string;
  readonly trigger: string;
  readonly kind: string;
}

const ENTRY_TUPLE: TransitionTuple = {
  from: 'APP-004',
  to: 'CHR-001',
  trigger: 'J-CHAR-CREATE::DRAFT_IDENTITY::open',
  kind: 'subflow',
};

const CONTINUE_TUPLE: TransitionTuple = {
  from: 'CHR-001',
  to: 'CHR-010',
  trigger: 'Сохранить идентичность и продолжить',
  kind: 'workflow-command',
};

function formById(
  forms: readonly unknown[],
  id: string,
  problems: AtlasValidationProblem[],
): JsonRecord | null {
  return singleRecord(
    forms,
    (row) => row['id'] === id,
    FORMS_FILE,
    id,
    `form with id ${JSON.stringify(id)}`,
    problems,
  );
}

function actionByKey(
  form: JsonRecord,
  formId: string,
  actionKey: string,
  problems: AtlasValidationProblem[],
): JsonRecord | null {
  const actions = form['actions'];
  if (!isRecord(actions)) {
    problems.push({ file: FORMS_FILE, id: formId, message: 'actions is not an object' });
    return null;
  }
  const rows = recordArrayField(actions, 'ctaAvailabilityByAction', FORMS_FILE, formId, problems);
  if (rows === null) return null;
  return singleRecord(
    rows,
    (row) => row['actionKey'] === actionKey,
    FORMS_FILE,
    actionKey,
    `action with actionKey ${JSON.stringify(actionKey)}`,
    problems,
  );
}

function transitionFromForm(
  form: JsonRecord,
  direction: 'transitionsIn' | 'transitionsOut',
  tuple: TransitionTuple,
  problems: AtlasValidationProblem[],
): JsonRecord | null {
  const formId = direction === 'transitionsOut' ? tuple.from : tuple.to;
  const rows = recordArrayField(form, direction, FORMS_FILE, formId, problems);
  if (rows === null) return null;
  return singleRecord(
    rows,
    (row) =>
      row[direction === 'transitionsOut' ? 'to' : 'from'] ===
        (direction === 'transitionsOut' ? tuple.to : tuple.from) &&
      row['trigger'] === tuple.trigger &&
      row['kind'] === tuple.kind,
    FORMS_FILE,
    `${tuple.from}→${tuple.to}`,
    `${direction} row for ${JSON.stringify(tuple.trigger)}`,
    problems,
  );
}

function topLevelTransition(
  transitions: readonly unknown[],
  tuple: TransitionTuple,
  problems: AtlasValidationProblem[],
): JsonRecord | null {
  return singleRecord(
    transitions,
    (row) =>
      row['from'] === tuple.from &&
      row['to'] === tuple.to &&
      row['trigger'] === tuple.trigger &&
      row['kind'] === tuple.kind,
    TRANSITIONS_FILE,
    `${tuple.from}→${tuple.to}`,
    `transition tuple ${JSON.stringify([tuple.from, tuple.to, tuple.trigger, tuple.kind])}`,
    problems,
  );
}

/** ADR 0037 names the finite registry of identity prose mirrors explicitly. */
export function validateChr001IdentityTextMirrors(
  forms: readonly unknown[],
  journeys: readonly unknown[],
  transitions: readonly unknown[],
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];
  const app004 = formById(forms, 'APP-004', problems);
  const chr001 = formById(forms, 'CHR-001', problems);
  const chr010 = formById(forms, 'CHR-010', problems);

  const journey = singleRecord(
    journeys,
    (row) => row['id'] === 'J-CHAR-CREATE',
    JOURNEYS_FILE,
    'J-CHAR-CREATE',
    'journey with id "J-CHAR-CREATE"',
    problems,
  );
  if (journey !== null) {
    const steps = recordArrayField(journey, 'steps', JOURNEYS_FILE, 'J-CHAR-CREATE', problems);
    if (steps !== null) {
      const identityStep = singleRecord(
        steps,
        (row) => row['state'] === 'DRAFT_IDENTITY',
        JOURNEYS_FILE,
        'J-CHAR-CREATE/DRAFT_IDENTITY',
        'journey step with state "DRAFT_IDENTITY"',
        problems,
      );
      if (identityStep !== null) {
        expectLiteral(
          identityStep,
          'guards',
          ADR_0037_ENTRY_GUARD,
          JOURNEYS_FILE,
          'J-CHAR-CREATE/DRAFT_IDENTITY',
          'entry guard literal',
          problems,
        );
      }
    }
  }

  if (app004 !== null) {
    const action = actionByKey(app004, 'APP-004', 'APP-004::CTA::001', problems);
    if (action !== null) {
      expectLiteral(
        action,
        'guard',
        ADR_0037_ENTRY_GUARD,
        FORMS_FILE,
        'APP-004::CTA::001',
        'entry guard literal',
        problems,
      );
    }
    const outgoing = transitionFromForm(app004, 'transitionsOut', ENTRY_TUPLE, problems);
    if (outgoing !== null) {
      expectLiteral(
        outgoing,
        'guard',
        ADR_0037_ENTRY_GUARD,
        FORMS_FILE,
        'APP-004→CHR-001',
        'entry guard literal',
        problems,
      );
    }
  }

  if (chr001 !== null) {
    const incoming = transitionFromForm(chr001, 'transitionsIn', ENTRY_TUPLE, problems);
    if (incoming !== null) {
      expectLiteral(
        incoming,
        'guard',
        ADR_0037_ENTRY_GUARD,
        FORMS_FILE,
        'APP-004→CHR-001',
        'entry guard literal',
        problems,
      );
    }
    const action = actionByKey(chr001, 'CHR-001', 'CHR-001::CTA::001', problems);
    if (action !== null) {
      expectLiteral(
        action,
        'guard',
        ADR_0037_CONTINUE_GUARD,
        FORMS_FILE,
        'CHR-001::CTA::001',
        'Continue guard literal',
        problems,
      );
    }
    const outgoing = transitionFromForm(chr001, 'transitionsOut', CONTINUE_TUPLE, problems);
    if (outgoing !== null) {
      expectLiteral(
        outgoing,
        'guard',
        ADR_0037_CONTINUE_GUARD,
        FORMS_FILE,
        'CHR-001→CHR-010',
        'Continue guard literal',
        problems,
      );
    }
    const states = chr001['states'];
    if (!isRecord(states)) {
      problems.push({ file: FORMS_FILE, id: 'CHR-001', message: 'states is not an object' });
    } else {
      expectLiteral(
        states,
        'IDENTITY_INCOMPLETE',
        ADR_0037_IDENTITY_INCOMPLETE,
        FORMS_FILE,
        'CHR-001.IDENTITY_INCOMPLETE',
        'IDENTITY_INCOMPLETE literal',
        problems,
      );
    }
  }

  if (chr010 !== null) {
    const incoming = transitionFromForm(chr010, 'transitionsIn', CONTINUE_TUPLE, problems);
    if (incoming !== null) {
      expectLiteral(
        incoming,
        'guard',
        ADR_0037_CONTINUE_GUARD,
        FORMS_FILE,
        'CHR-001→CHR-010',
        'Continue guard literal',
        problems,
      );
    }
  }

  for (const [tuple, expected, label] of [
    [ENTRY_TUPLE, ADR_0037_ENTRY_GUARD, 'entry guard literal'],
    [CONTINUE_TUPLE, ADR_0037_CONTINUE_GUARD, 'Continue guard literal'],
  ] as const) {
    const transition = topLevelTransition(transitions, tuple, problems);
    if (transition !== null) {
      expectLiteral(
        transition,
        'guard',
        expected,
        TRANSITIONS_FILE,
        `${tuple.from}→${tuple.to}`,
        label,
        problems,
      );
    }
  }

  return problems;
}

/**
 * The transition graph and renderer form catalogue must close over each other:
 * every endpoint resolves, and every indexed form participates in the graph.
 */
export function validateRendererFormGraph(
  forms: ReadonlySet<string>,
  transitions: readonly unknown[],
): readonly AtlasValidationProblem[] {
  const problems: AtlasValidationProblem[] = [];
  const referenced = new Set<string>();

  transitions.forEach((value, index) => {
    const rowId = `row ${String(index)}`;
    if (!isRecord(value)) {
      problems.push({ file: TRANSITIONS_FILE, id: rowId, message: 'expected a record' });
      return;
    }

    for (const endpoint of ['from', 'to'] as const) {
      const reference = value[endpoint];
      if (typeof reference !== 'string' || reference === '') {
        problems.push({
          file: TRANSITIONS_FILE,
          id: rowId,
          message: `${endpoint} is empty or not text`,
        });
        continue;
      }
      referenced.add(reference);
      if (!forms.has(reference)) {
        problems.push({
          file: TRANSITIONS_FILE,
          id: rowId,
          message: `${endpoint} ${JSON.stringify(reference)} is not in the renderer form catalogue`,
        });
      }
    }
  });

  for (const id of forms) {
    if (!referenced.has(id)) {
      problems.push({
        file: FORM_INDEX_FILE,
        id,
        message: 'form is defined but never referenced',
      });
    }
  }

  return problems;
}
