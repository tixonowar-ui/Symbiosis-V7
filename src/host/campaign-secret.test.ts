import { Buffer } from 'node:buffer';
import { randomBytes, scrypt } from 'node:crypto';
import type * as Crypto from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MASTER_SECRET_MAX_CODE_POINTS,
  MASTER_SECRET_MIN_CODE_POINTS,
  MasterSecretError,
  prepareMasterSecret,
  validateMasterSecretInput,
  validateMasterSecretVerifier,
  verifyMasterSecret,
  type MasterSecretVerifier,
} from './campaign-secret.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof Crypto>();
  return { ...actual, scrypt: vi.fn(actual.scrypt), randomBytes: vi.fn(actual.randomBytes) };
});
afterEach(() => {
  vi.clearAllMocks();
});

const PASSWORD = '😀'.repeat(12);
const SALT = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
/** Independent Node 24 scryptSync vector, UTF-8 password and salt bytes 0..31, ADR64 parameters. */
const PROOF: MasterSecretVerifier = {
  schemaVersion: 1,
  kdf: 'SCRYPT_V1',
  saltBase64: SALT.toString('base64'),
  verifierBase64:
    'MQW42UOe4IJ958+Dj/ATvVfP15QsjG7NKTBBa3/LCbJ71UGa9EknIYKhvYCsCAjWpxCGdrP0dRoGqVqAwp8S8Q==',
  cost: 32768,
  blockSize: 8,
  parallelization: 1,
  keyLength: 64,
};
const fixedSalt = () => ({ allocateSalt: vi.fn(() => SALT) });

describe('campaign master secret', () => {
  it('validates exact replay input without KDF or salt allocation', () => {
    expect(validateMasterSecretInput(PASSWORD, PASSWORD)).toBe(PASSWORD);
    expect(() => validateMasterSecretInput(PASSWORD, 'a'.repeat(12))).toThrow(
      'CONFIRMATION_MISMATCH',
    );
    expect(() => validateMasterSecretInput('\ud800'.repeat(12), '\ud800'.repeat(12))).toThrow(
      'DISALLOWED_CHARACTERS',
    );
    expect(randomBytes).not.toHaveBeenCalled();
    expect(scrypt).not.toHaveBeenCalled();
  });
  it('counts Unicode code points and derives the exact private verifier with the fixed technical policy', async () => {
    expect(MASTER_SECRET_MIN_CODE_POINTS).toBe(12);
    expect(MASTER_SECRET_MAX_CODE_POINTS).toBe(128);
    const options = fixedSalt();
    const proof = await prepareMasterSecret(PASSWORD, PASSWORD, options);
    expect(proof).toEqual(PROOF);
    expect(options.allocateSalt).toHaveBeenCalledTimes(1);
    expect(randomBytes).not.toHaveBeenCalled();
    expect(scrypt).toHaveBeenCalledTimes(1);
    expect(vi.mocked(scrypt).mock.calls[0]?.[2]).toBe(64);
    expect(vi.mocked(scrypt).mock.calls[0]?.[3]).toEqual({
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    expect(Object.keys(proof).sort()).toEqual(
      [
        'schemaVersion',
        'kdf',
        'saltBase64',
        'verifierBase64',
        'cost',
        'blockSize',
        'parallelization',
        'keyLength',
      ].sort(),
    );
    expect(JSON.stringify(proof)).not.toContain(PASSWORD);
    expect(SALT).toEqual(Buffer.from(Array.from({ length: 32 }, (_, index) => index)));
    expect(validateMasterSecretVerifier(JSON.parse(JSON.stringify(proof)) as unknown)).toEqual(
      PROOF,
    );
    const passwordBytes = vi.mocked(scrypt).mock.calls[0]?.[0];
    expect(Buffer.isBuffer(passwordBytes) && passwordBytes.every((byte) => byte === 0)).toBe(true);
  });

  it('allocates a new random 32-byte salt per preparation, but verifies using only the stored salt', async () => {
    const first = await prepareMasterSecret(PASSWORD, PASSWORD);
    const second = await prepareMasterSecret(PASSWORD, PASSWORD);
    expect(randomBytes).toHaveBeenCalledTimes(2);
    expect(randomBytes).toHaveBeenNthCalledWith(1, 32);
    expect(randomBytes).toHaveBeenNthCalledWith(2, 32);
    expect(first.saltBase64).not.toBe(second.saltBase64);
    expect(first.verifierBase64).not.toBe(second.verifierBase64);
    vi.mocked(randomBytes).mockClear();
    expect(await verifyMasterSecret(PASSWORD, first)).toBe(true);
    expect(await verifyMasterSecret('😃'.repeat(12), first)).toBe(false);
    expect(randomBytes).not.toHaveBeenCalled();
  });

  it('preserves spaces and distinguishes composed and decomposed Unicode without normalization', async () => {
    const password = ` ${'é'.repeat(12)} `;
    const proof = await prepareMasterSecret(password, password, fixedSalt());
    expect(await verifyMasterSecret(password, proof)).toBe(true);
    expect(await verifyMasterSecret(password.trim(), proof)).toBe(false);
    expect(await verifyMasterSecret(password.normalize('NFD'), proof)).toBe(false);
    const options = fixedSalt();
    await expect(
      prepareMasterSecret(password, password.normalize('NFD'), options),
    ).rejects.toMatchObject({
      code: 'CONFIRMATION_MISMATCH',
      field: 'masterTransferPasswordConfirmation',
    });
    expect(options.allocateSalt).not.toHaveBeenCalled();
  });

  it('accepts the upper code-point boundary even when it occupies twice as many UTF-16 code units', async () => {
    const password = '🧬'.repeat(128);
    expect(password.length).toBe(256);
    const proof = await prepareMasterSecret(password, password, fixedSalt());
    expect(await verifyMasterSecret(password, proof)).toBe(true);
  });

  it.each([
    {
      password: null,
      confirmation: PASSWORD,
      code: 'INVALID_TYPE',
      field: 'masterTransferPassword',
    },
    {
      password: PASSWORD,
      confirmation: 12,
      code: 'INVALID_TYPE',
      field: 'masterTransferPasswordConfirmation',
    },
    {
      password: '😀'.repeat(11),
      confirmation: PASSWORD,
      code: 'INVALID_LENGTH',
      field: 'masterTransferPassword',
    },
    {
      password: '😀'.repeat(129),
      confirmation: PASSWORD,
      code: 'INVALID_LENGTH',
      field: 'masterTransferPassword',
    },
    {
      password: PASSWORD,
      confirmation: 'x',
      code: 'INVALID_LENGTH',
      field: 'masterTransferPasswordConfirmation',
    },
    {
      password: PASSWORD,
      confirmation: '😃'.repeat(12),
      code: 'CONFIRMATION_MISMATCH',
      field: 'masterTransferPasswordConfirmation',
    },
    ...['\0', '\t', '\n', '\r', '\u007f', '\u0085', '\u009f', '\ud800', '\udfff'].map(
      (control) => ({
        password: PASSWORD + control,
        confirmation: PASSWORD + control,
        code: 'DISALLOWED_CHARACTERS',
        field: 'masterTransferPassword',
      }),
    ),
  ])(
    'rejects invalid input before salt allocation: $code / $field',
    async ({ password, confirmation, code, field }) => {
      const options = fixedSalt();
      await expect(prepareMasterSecret(password, confirmation, options)).rejects.toMatchObject({
        code,
        field,
      });
      expect(options.allocateSalt).not.toHaveBeenCalled();
      expect(randomBytes).not.toHaveBeenCalled();
      expect(scrypt).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    [],
    'proof',
    {},
    { ...PROOF, schemaVersion: 2 },
    { ...PROOF, kdf: 'PBKDF2' },
    { ...PROOF, cost: 16384 },
    { ...PROOF, blockSize: 1 },
    { ...PROOF, parallelization: 2 },
    { ...PROOF, keyLength: 32 },
    { ...PROOF, maxmem: 64 * 1024 * 1024 },
    { ...PROOF, password: 'must-never-be-read' },
    { ...PROOF, saltBase64: Buffer.alloc(31).toString('base64') },
    { ...PROOF, saltBase64: Buffer.alloc(33).toString('base64') },
    { ...PROOF, verifierBase64: Buffer.alloc(63).toString('base64') },
    { ...PROOF, verifierBase64: Buffer.alloc(65).toString('base64') },
    { ...PROOF, saltBase64: PROOF.saltBase64.trimEnd() + '\n' },
    { ...PROOF, saltBase64: PROOF.saltBase64.slice(0, -1) },
    { ...PROOF, saltBase64: PROOF.saltBase64.slice(0, -2) + '9=' },
    { ...PROOF, verifierBase64: PROOF.verifierBase64.slice(0, -3) + 'R==' },
    { ...PROOF, saltBase64: 123 },
    { ...PROOF, verifierBase64: null },
  ])('fails closed on malformed or unsupported stored proof %#', async (proof) => {
    expect(() => validateMasterSecretVerifier(proof)).toThrow(MasterSecretError);
    await expect(verifyMasterSecret(PASSWORD, proof)).rejects.toMatchObject({
      code: 'INVALID_VERIFIER',
      field: 'masterSecretVerifier',
    });
    expect(scrypt).not.toHaveBeenCalled();
    expect(randomBytes).not.toHaveBeenCalled();
  });

  it('rejects accessors, hidden fields, inherited shapes and symbols without invoking user code', () => {
    const getter = vi.fn(() => {
      throw new Error(PASSWORD);
    });
    const accessor = Object.defineProperty({ ...PROOF }, 'saltBase64', { get: getter });
    const hidden = Object.defineProperty({ ...PROOF }, 'saltBase64', { enumerable: false });
    const inherited: unknown = Object.create(PROOF);
    for (const proof of [accessor, hidden, inherited, { ...PROOF, [Symbol('extra')]: true }])
      expect(() => validateMasterSecretVerifier(proof)).toThrow(MasterSecretError);
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not coerce malformed password values or expose them through error data', async () => {
    const toString = vi.fn(() => {
      throw new Error(PASSWORD);
    });
    for (const value of [undefined, 123, { toString }, '\ud800'.repeat(12)]) {
      await expect(verifyMasterSecret(value, PROOF)).rejects.toBeInstanceOf(MasterSecretError);
    }
    expect(toString).not.toHaveBeenCalled();
    expect(scrypt).not.toHaveBeenCalled();
    const failure: unknown = await prepareMasterSecret(
      'private\nvalue!!!',
      'private\nvalue!!!',
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MasterSecretError);
    expect(JSON.stringify(failure)).toBe(
      '{"code":"DISALLOWED_CHARACTERS","field":"masterTransferPassword"}',
    );
    expect(String(failure)).not.toContain('private');
    expect((failure as Error).cause).toBeUndefined();
  });

  it('replaces salt and crypto failures with fixed codes and never carries raw errors as causes', async () => {
    const secretError = new Error(`native detail ${PASSWORD}`);
    const failures = [
      prepareMasterSecret(PASSWORD, PASSWORD, {
        allocateSalt: () => {
          throw secretError;
        },
      }),
      prepareMasterSecret(PASSWORD, PASSWORD, { allocateSalt: () => Buffer.alloc(31) }),
    ];
    for (const pending of failures) {
      const error: unknown = await pending.catch((cause: unknown) => cause);
      expect(error).toMatchObject({
        code: 'SALT_ALLOCATION_FAILED',
        field: 'masterTransferPassword',
      });
      expect(String(error) + JSON.stringify(error)).not.toContain(PASSWORD);
      expect((error as Error).cause).toBeUndefined();
    }
    for (const callbackFailure of [false, true]) {
      vi.mocked(scrypt).mockImplementationOnce((...args: Parameters<typeof scrypt>) => {
        if (callbackFailure) args[4](secretError, Buffer.alloc(0));
        else throw secretError;
      });
      const error: unknown = await prepareMasterSecret(PASSWORD, PASSWORD, fixedSalt()).catch(
        (cause: unknown) => cause,
      );
      expect(error).toMatchObject({
        code: 'SECRET_DERIVATION_FAILED',
        field: 'masterTransferPassword',
      });
      expect(String(error) + JSON.stringify(error)).not.toContain(PASSWORD);
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
