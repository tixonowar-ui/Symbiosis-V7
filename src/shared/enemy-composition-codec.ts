import { admissionCodecReaders as base } from './campaign-admission-codec.js';

/** These new durable/renderer records accept JSON data, never getters, hidden keys or sparse lists. */
function record(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return base.invalid(path, 'plain data record', null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    )
      return base.invalid(path, 'enumerable data fields', null);
  }
  return value as Record<string, unknown>;
}
function exact(value: unknown, names: string, path: string): Record<string, unknown> {
  const result = record(value, path),
    keys = names.split(' ');
  if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key)))
    return base.invalid(path, 'closed required fields', null);
  return result;
}
function list(value: unknown, path: string): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return base.invalid(path, 'dense plain data array', null);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      return base.invalid(path, 'dense enumerable data entries', null);
  }
  return value;
}
export const enemyCompositionReaders = { ...base, record, exact, list };
