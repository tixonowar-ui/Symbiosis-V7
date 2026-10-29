import { Buffer } from 'node:buffer';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Technical secret policy, ADR 0064; these are not campaign mechanics. */
export const MASTER_SECRET_MIN_CODE_POINTS = 12;
export const MASTER_SECRET_MAX_CODE_POINTS = 128;
const SALT_BYTES = 32;
const KEY_BYTES = 64;
const SCRYPT_COST = 32768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const CONTROL_OR_LONE_SURROGATE = /[\p{Cc}\uD800-\uDFFF]/u;

export type MasterSecretVerifier = {
  readonly schemaVersion: 1;
  readonly kdf: 'SCRYPT_V1';
  readonly saltBase64: string;
  readonly verifierBase64: string;
  readonly cost: 32768;
  readonly blockSize: 8;
  readonly parallelization: 1;
  readonly keyLength: 64;
};
export type MasterSecretErrorCode =
  | 'INVALID_TYPE'
  | 'INVALID_LENGTH'
  | 'DISALLOWED_CHARACTERS'
  | 'CONFIRMATION_MISMATCH'
  | 'INVALID_VERIFIER'
  | 'SALT_ALLOCATION_FAILED'
  | 'SECRET_DERIVATION_FAILED';
export type MasterSecretErrorField =
  'masterTransferPassword' | 'masterTransferPasswordConfirmation' | 'masterSecretVerifier';

export class MasterSecretError extends Error {
  constructor(
    readonly code: MasterSecretErrorCode,
    readonly field: MasterSecretErrorField,
  ) {
    // Neither a caller value nor the underlying crypto error may enter the message or cause.
    super(`${code}:${field}`);
  }
}
const fail = (code: MasterSecretErrorCode, field: MasterSecretErrorField): never => {
  throw new MasterSecretError(code, field);
};

function validPassword(value: unknown, field: MasterSecretErrorField): string {
  if (typeof value !== 'string') return fail('INVALID_TYPE', field);
  let length = 0;
  for (const _point of value) {
    if (++length > MASTER_SECRET_MAX_CODE_POINTS) return fail('INVALID_LENGTH', field);
  }
  if (length < MASTER_SECRET_MIN_CODE_POINTS || length > MASTER_SECRET_MAX_CODE_POINTS)
    return fail('INVALID_LENGTH', field);
  // A lone surrogate would be replaced during UTF-8 encoding and could alias another secret.
  if (CONTROL_OR_LONE_SURROGATE.test(value)) return fail('DISALLOWED_CHARACTERS', field);
  return value;
}

function canonicalBase64(value: unknown, length: number): value is string {
  if (typeof value !== 'string' || value.length !== 4 * Math.ceil(length / 3)) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === length && bytes.toString('base64') === value;
}

export function validateMasterSecretVerifier(value: unknown): MasterSecretVerifier {
  const invalid = (): never => fail('INVALID_VERIFIER', 'masterSecretVerifier');
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    const keys = [
      'schemaVersion',
      'kdf',
      'saltBase64',
      'verifierBase64',
      'cost',
      'blockSize',
      'parallelization',
      'keyLength',
    ];
    const ownKeys = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    )
      return invalid();
    if (
      keys.some(
        (key) => !Object.hasOwn(descriptors[key]!, 'value') || !descriptors[key]!.enumerable,
      )
    )
      return invalid();
    const record: Record<string, unknown> = Object.fromEntries(
      keys.map((key) => {
        const saved: unknown = descriptors[key]!.value;
        return [key, saved];
      }),
    );
    if (
      record['schemaVersion'] !== 1 ||
      record['kdf'] !== 'SCRYPT_V1' ||
      record['cost'] !== SCRYPT_COST ||
      record['blockSize'] !== SCRYPT_BLOCK_SIZE ||
      record['parallelization'] !== SCRYPT_PARALLELIZATION ||
      record['keyLength'] !== KEY_BYTES ||
      !canonicalBase64(record['saltBase64'], SALT_BYTES) ||
      !canonicalBase64(record['verifierBase64'], KEY_BYTES)
    )
      return invalid();
    return Object.freeze({
      schemaVersion: 1,
      kdf: 'SCRYPT_V1',
      saltBase64: record['saltBase64'],
      verifierBase64: record['verifierBase64'],
      cost: SCRYPT_COST,
      blockSize: SCRYPT_BLOCK_SIZE,
      parallelization: SCRYPT_PARALLELIZATION,
      keyLength: KEY_BYTES,
    });
  } catch {
    return invalid();
  }
}

async function derive(password: string, salt: Uint8Array): Promise<Buffer> {
  const bytes = Buffer.from(password, 'utf8');
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        bytes,
        salt,
        KEY_BYTES,
        {
          N: SCRYPT_COST,
          r: SCRYPT_BLOCK_SIZE,
          p: SCRYPT_PARALLELIZATION,
          maxmem: SCRYPT_MAX_MEMORY,
        },
        (error, key) => {
          if (error !== null || !Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
            if (Buffer.isBuffer(key)) key.fill(0);
            reject(new MasterSecretError('SECRET_DERIVATION_FAILED', 'masterTransferPassword'));
          } else resolve(key);
        },
      );
    });
  } catch {
    return fail('SECRET_DERIVATION_FAILED', 'masterTransferPassword');
  } finally {
    bytes.fill(0);
  }
}

export function validateMasterSecretInput(password: unknown, confirmation: unknown): string {
  const checked = validPassword(password, 'masterTransferPassword');
  const confirmed = validPassword(confirmation, 'masterTransferPasswordConfirmation');
  if (checked !== confirmed)
    return fail('CONFIRMATION_MISMATCH', 'masterTransferPasswordConfirmation');
  return checked;
}

export async function prepareMasterSecret(
  password: unknown,
  confirmation: unknown,
  options?: { readonly allocateSalt: () => Uint8Array },
): Promise<MasterSecretVerifier> {
  const checked = validateMasterSecretInput(password, confirmation);
  let salt: Buffer;
  try {
    const allocated = options === undefined ? randomBytes(SALT_BYTES) : options.allocateSalt();
    if (!(allocated instanceof Uint8Array) || allocated.byteLength !== SALT_BYTES)
      return fail('SALT_ALLOCATION_FAILED', 'masterTransferPassword');
    salt = Buffer.from(allocated);
  } catch {
    return fail('SALT_ALLOCATION_FAILED', 'masterTransferPassword');
  }
  let key: Buffer | undefined;
  try {
    key = await derive(checked, salt);
    return validateMasterSecretVerifier({
      schemaVersion: 1,
      kdf: 'SCRYPT_V1',
      saltBase64: salt.toString('base64'),
      verifierBase64: key.toString('base64'),
      cost: SCRYPT_COST,
      blockSize: SCRYPT_BLOCK_SIZE,
      parallelization: SCRYPT_PARALLELIZATION,
      keyLength: KEY_BYTES,
    });
  } finally {
    key?.fill(0);
    salt.fill(0);
  }
}

export async function verifyMasterSecret(password: unknown, proof: unknown): Promise<boolean> {
  const checked = validPassword(password, 'masterTransferPassword');
  const verified = validateMasterSecretVerifier(proof);
  const salt = Buffer.from(verified.saltBase64, 'base64');
  const expected = Buffer.from(verified.verifierBase64, 'base64');
  let key: Buffer | undefined;
  try {
    key = await derive(checked, salt);
    return timingSafeEqual(key, expected);
  } finally {
    key?.fill(0);
    salt.fill(0);
    expected.fill(0);
  }
}
