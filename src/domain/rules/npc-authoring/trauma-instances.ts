import { ARMOR_BODY_ZONES, type ArmorBodyZone } from '../item-stage/armor-bundle.js';
import type { NpcTraumaInstance } from './effect-types.js';

/** AQA-010: the owning host proves the NPC and its existing humanoid anatomy. */
export interface NpcTraumaAnatomyContext {
  readonly anatomyProfileId: 'STANDARD_HUMANOID';
}
export interface NpcResolvedTraumaInput {
  /** Already allocated and bound to a real source by the host. */
  readonly traumaInstanceId: string;
  readonly regionId: ArmorBodyZone;
  /** An already-resolved injury/extra value, not raw damage or a new dice result. */
  readonly traumaValue: number;
}

export class NpcTraumaCodecError extends Error {
  constructor(path: string, detail: string) {
    super(`NPC trauma ${path}: ${detail}`);
    this.name = new.target.name;
  }
}

const FIELDS = ['traumaInstanceId', 'regionId', 'traumaValue'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function fail(path: string, detail: string): never {
  throw new NpcTraumaCodecError(path, detail);
}
function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return fail(path, 'expected plain data');
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return fail(path, 'expected plain data');
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    return fail(path, 'unexpected or missing fields');
  const detached: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      return fail(path, 'expected enumerable own data fields');
    detached[key] = descriptor.value as unknown;
  }
  return detached;
}

/**
 * Effects/12 closes the stored shape; this is not proof of APPLY_TRAUMA or a full initialRuntime.
 * The host proves owner/source identity and all zone-specific consequences separately.
 */
export function readNpcTraumaInstance(
  context: NpcTraumaAnatomyContext,
  value: unknown,
): NpcTraumaInstance {
  const profile = record(context, ['anatomyProfileId'], 'context');
  if (profile['anatomyProfileId'] !== 'STANDARD_HUMANOID')
    return fail('context.anatomyProfileId', 'AQA-010 requires STANDARD_HUMANOID for NPC');
  const row = record(value, FIELDS, 'instance');
  const traumaInstanceId = row['traumaInstanceId'];
  if (typeof traumaInstanceId !== 'string' || !UUID.test(traumaInstanceId))
    return fail('traumaInstanceId', 'expected canonical UUID v4');
  const regionId = ARMOR_BODY_ZONES.find((zone) => zone === row['regionId']);
  if (regionId === undefined)
    return fail('regionId', `unknown humanoid region; available: ${ARMOR_BODY_ZONES.join(', ')}`);
  const traumaValue = row['traumaValue'];
  // CORE-119/120/121 resolve injury/extra with max(0, round_math(...)); do not round an input here.
  if (
    typeof traumaValue !== 'number' ||
    !Number.isFinite(traumaValue) ||
    !Number.isInteger(traumaValue) ||
    traumaValue < 0
  )
    return fail('traumaValue', 'expected explicit finite nonnegative resolved integer');
  return Object.freeze({ traumaInstanceId, regionId, traumaValue });
}

/**
 * Packages only a source-resolved result that the owning host has already proved.
 * This grants no manual GM override and creates no damage event, dice result or history.
 * CORE-120 next-check consumption/stun and CORE-121 once-only HP loss are not encoded here.
 * The caller must preserve those obligations; it must not treat this three-field record as
 * evidence that they were applied, consumed, timed, healed or independently validated.
 */
export function prepareNpcResolvedTrauma(
  context: NpcTraumaAnatomyContext,
  input: unknown,
): NpcTraumaInstance {
  return readNpcTraumaInstance(context, input);
}
