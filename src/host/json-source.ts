import { readFile } from 'node:fs/promises';

export type JsonRecord = Record<string, unknown>;

export function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${label}: expected object`);
  return value as JsonRecord;
}

export function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}: expected array`);
  return value;
}

export function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`${label}: expected non-empty string`);
  return value;
}

export async function readJsonFile(path: string, label: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (cause: unknown) {
    throw new Error(`cannot read ${label} ${path}`, { cause });
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (cause: unknown) {
    throw new Error(`malformed ${label} ${path}`, { cause });
  }
}
