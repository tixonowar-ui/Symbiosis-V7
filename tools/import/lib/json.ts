/**
 * Fail-closed access to parsed JSON.
 *
 * The atlas is trusted as a source but not as a shape: a field that changed type
 * between releases must stop the import, not flow into `generated/` as
 * `undefined`. Every accessor here names the path it failed on.
 */
import { fail } from './fail.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export function asObject(value: JsonValue | undefined, where: string, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(where, `${path} is not an object (got ${describe(value)})`);
  }
  return value;
}

export function asArray(value: JsonValue | undefined, where: string, path: string): JsonValue[] {
  if (!Array.isArray(value)) {
    fail(where, `${path} is not an array (got ${describe(value)})`);
  }
  return value;
}

export function asString(value: JsonValue | undefined, where: string, path: string): string {
  if (typeof value !== 'string') {
    fail(where, `${path} is not a string (got ${describe(value)})`);
  }
  return value;
}

export function asNumber(value: JsonValue | undefined, where: string, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(where, `${path} is not a finite number (got ${describe(value)})`);
  }
  return value;
}

export function asStringArray(value: JsonValue | undefined, where: string, path: string): string[] {
  return asArray(value, where, path).map((item, index) =>
    asString(item, where, `${path}[${String(index)}]`),
  );
}

/** Asserts an exact string value — used to pin schema and version fields. */
export function expectString(
  value: JsonValue | undefined,
  where: string,
  path: string,
  expected: string,
): string {
  const actual = asString(value, where, path);
  if (actual !== expected) {
    fail(where, `${path} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  return actual;
}

function describe(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${String(value.length)})`;
  return typeof value;
}
