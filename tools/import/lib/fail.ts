/**
 * Fail-closed for the import pipeline.
 *
 * The pipeline never guesses. A missing sheet, an unexpected column, an unknown
 * value — each stops the run and names exactly what was not recognised, rather
 * than producing a partial or plausible-looking `generated/`.
 */
export class ImportError extends Error {
  readonly where: string;

  constructor(where: string, message: string) {
    super(`${where}: ${message}`);
    this.name = 'ImportError';
    this.where = where;
  }
}

export function fail(where: string, message: string): never {
  throw new ImportError(where, message);
}

/** Narrows `value` to non-null, failing with context when it is absent. */
export function required<T>(value: T | null | undefined, where: string, what: string): T {
  if (value === null || value === undefined) {
    fail(where, `${what} is missing`);
  }
  return value;
}

/**
 * Asserts an expected count. Used to pin imports against the control values the
 * artifacts state about themselves — a silent drift in row count means the
 * source changed shape, and continuing would emit wrong data.
 */
export function expectCount(where: string, what: string, actual: number, expected: number): void {
  if (actual !== expected) {
    fail(where, `expected ${String(expected)} ${what}, got ${String(actual)}`);
  }
}
