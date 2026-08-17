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
const TRANSITIONS_FILE = 'atlas/transitions.json';

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
