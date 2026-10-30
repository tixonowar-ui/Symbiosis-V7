import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES } from './campaign-peer-handshake.js';
import { canonicalPostSaveJson } from './local-character-export.js';
import {
  decodeDeviceAdmissionPeerCommand,
  encodeDeviceAdmissionPeerCommand,
  DeviceAdmissionPeerCommandError,
  type DeviceAdmissionCandidateManifest,
  type DeviceAdmissionPeerCommand,
  type DeviceAdmissionPeerCommandField,
  type DeviceAdmissionPeerCommandLimits,
} from './device-admission-peer-commands.js';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const TRANSFER = '33333333-3333-4333-8333-333333333333';
const V8_SOURCE = '44444444-4444-8444-8444-444444444444';
const limits: DeviceAdmissionPeerCommandLimits = {
  maxSubmitBodyBytes: 1024 * 1024,
  maxWitnessBytes: 512 * 1024,
  maxChunkBytes: 1024,
};
const manifest: DeviceAdmissionCandidateManifest = {
  descriptor: {
    sourceUuid: V8_SOURCE,
    sourceSnapshotId: 'historical-final-receipt',
    finalSnapshotVersion: 7,
    metadataRevision: 0,
    sourceChecksum: 'a'.repeat(64),
    exportChecksum: 'b'.repeat(64),
    exportBytesSha256: 'c'.repeat(64),
    baselineVersion: `sha256:${'d'.repeat(64)}`,
  },
  witnessSha256: 'e'.repeat(64),
  witnessByteLength: 1000,
};
const open: DeviceAdmissionPeerCommand = {
  schemaVersion: 1,
  operation: 'CONNECTION_OPEN',
  commandId: 'connect-command-v8-or-correlation',
  attemptId: 'existing-attempt',
  campaignCheckpointSha256: 'f'.repeat(64),
};
const cancel: Extract<DeviceAdmissionPeerCommand, { operation: 'DEVICE_REQUEST_CANCEL' }> = {
  schemaVersion: 1,
  operation: 'DEVICE_REQUEST_CANCEL',
  commandId: 'cancel-command',
  requestId: REQUEST,
  technicalSessionId: SESSION,
  requestRevision: 0,
  reason: '  Передумал\r\nСледующая строка\t🙂 e\u0301  ',
};
const begin: Extract<DeviceAdmissionPeerCommand, { operation: 'DEVICE_REQUEST_BEGIN' }> = {
  schemaVersion: 1,
  operation: 'DEVICE_REQUEST_BEGIN',
  commandId: 'submit-command',
  requestId: REQUEST,
  technicalSessionId: SESSION,
  connectionRevision: 2,
  campaignCheckpointSha256: 'f'.repeat(64),
  candidates: [manifest],
  submitBodySha256: '0'.repeat(64),
  submitBodyByteLength: 5000,
};
const chunk: Extract<DeviceAdmissionPeerCommand, { operation: 'DEVICE_REQUEST_CHUNK' }> = {
  schemaVersion: 1,
  operation: 'DEVICE_REQUEST_CHUNK',
  transferId: TRANSFER,
  chunkIndex: 0,
  bytesBase64: Buffer.from('private witness bytes').toString('base64'),
};
const commands: readonly DeviceAdmissionPeerCommand[] = [
  open,
  {
    schemaVersion: 1,
    operation: 'CONNECTION_RECOVER',
    commandId: 'connect-command',
    attemptId: 'existing-attempt',
    semanticBodySha256: 'a'.repeat(64),
  },
  cancel,
  {
    schemaVersion: 1,
    operation: 'DEVICE_REQUEST_RECOVER',
    requestId: REQUEST,
    technicalSessionId: SESSION,
    submitCommandId: 'historical-submit',
  },
  begin,
  chunk,
  { schemaVersion: 1, operation: 'DEVICE_REQUEST_COMMIT', transferId: TRANSFER },
];
function encode(value: unknown, useLimits = limits): string {
  return encodeDeviceAdmissionPeerCommand(value as DeviceAdmissionPeerCommand, useLimits);
}
function decode(source: unknown, useLimits = limits) {
  return decodeDeviceAdmissionPeerCommand(source, useLimits);
}
function rejection(run: () => unknown): DeviceAdmissionPeerCommandError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DeviceAdmissionPeerCommandError);
    const e = error as DeviceAdmissionPeerCommandError;
    expect(e.message).toBe(`device admission peer command: ${e.code}:${e.field}`);
    expect(e.cause).toBeUndefined();
    return e;
  }
  throw new Error('invalid peer command accepted');
}
function rejectJson(value: unknown, useLimits = limits) {
  rejection(() => encode(value, useLimits));
  rejection(() => decode(canonicalPostSaveJson(value), useLimits));
}

describe('closed private device admission RPC commands', () => {
  it.each(commands.map((command) => [command.operation, command] as const))(
    'round trips exact %s fields as canonical immutable text',
    (_operation, command) => {
      const text = encode(command);
      expect(text).toBe(canonicalPostSaveJson(command));
      expect(decode(text)).toEqual(command);
      expect(Object.isFrozen(decode(text))).toBe(true);
      expect(text).not.toContain('role');
      expect(text).not.toContain('deviceId');
      expect(text).not.toContain('campaignId');
    },
  );

  it('preserves the historical nonempty correlation/source contracts and reason bytes without normalization', () => {
    const command = { ...open, commandId: V8_SOURCE, attemptId: 'historical-attempt-not-uuid' };
    expect(decode(encode(command))).toEqual(command);
    expect(decode(encode({ ...begin, commandId: V8_SOURCE }))).toEqual({
      ...begin,
      commandId: V8_SOURCE,
    });
    expect(decode(encode(cancel))).toEqual(cancel);
    expect(cancel.reason).not.toBe(cancel.reason.trim());
    expect(cancel.reason).not.toBe(cancel.reason.normalize('NFC'));
  });

  it.each([1, 2, 3])(
    'preserves order for %s unique source manifests without pretending to validate candidate mechanics',
    (count) => {
      const candidates = Array.from({ length: count }, (_, index) => ({
        ...manifest,
        descriptor: {
          ...manifest.descriptor,
          sourceUuid: `historical-source-${String(count - index)}`,
        },
      }));
      const result = decode(encode({ ...begin, candidates }));
      expect(result).toEqual({ ...begin, candidates });
      if (result.operation !== 'DEVICE_REQUEST_BEGIN') throw new Error('wrong discriminant');
      expect(Object.isFrozen(result.candidates)).toBe(true);
      expect(Object.isFrozen(result.candidates[0]!.descriptor)).toBe(true);
      expect(Object.keys(result.candidates[0]!).sort()).toEqual([
        'descriptor',
        'witnessByteLength',
        'witnessSha256',
      ]);
      expect(encode({ ...begin, candidates })).not.toContain('canonicalWitnessText');
    },
  );

  it.each(
    [
      [],
      [manifest, manifest, manifest, manifest],
      [manifest, { ...manifest, descriptor: { ...manifest.descriptor, metadataRevision: 1 } }],
    ].map((candidates) => [candidates] as const),
  )('rejects empty, over-three or duplicate-source manifests', (candidates) => {
    rejectJson({ ...begin, candidates });
  });

  it.each([
    'role',
    'deviceId',
    'campaignId',
    'masterAuthorityRevision',
    'authorization',
    'privateWitness',
    '__proto__',
  ])('rejects unknown/principal property %s without reflecting its name', (key) => {
    for (const command of commands) rejectJson({ ...command, [key]: 'PRIVATE_INPUT' });
  });

  it.each(commands.map((command) => [command.operation, command] as const))(
    'requires every field of %s and no variant aliases',
    (_operation, command) => {
      for (const key of Object.keys(command)) {
        const changed: Record<string, unknown> = { ...command };
        delete changed[key];
        rejectJson(changed);
        const alias = { ...command, [`${key}OrNull`]: null };
        rejectJson(alias);
      }
      rejectJson({ ...command, schemaVersion: 2 });
      rejectJson({ ...command, operation: 'DEVICE_REQUEST_SUBMIT' });
    },
  );

  it.each(['requestId', 'technicalSessionId', 'transferId'] as const)(
    'requires new executor %s to be canonical lowercase UUID v4',
    (field) => {
      const base = field === 'transferId' ? chunk : begin;
      for (const invalid of [
        '',
        V8_SOURCE,
        REQUEST.toUpperCase().replace('11111111', 'AAAAAAAA'),
        '11111111-1111-4111-c111-111111111111',
        'request',
        ' ' + REQUEST,
        REQUEST + ' ',
        null,
        7,
      ])
        rejectJson({ ...base, [field]: invalid });
    },
  );

  it.each(['commandId', 'attemptId', 'submitCommandId'] as const)(
    'requires nonempty existing %s without inventing UUID v4',
    (field) => {
      const base = field === 'submitCommandId' ? commands[3]! : open;
      for (const value of ['', null, 0, false]) rejectJson({ ...base, [field]: value });
    },
  );

  it.each([
    'sourceUuid',
    'sourceSnapshotId',
    'baselineVersion',
    'sourceChecksum',
    'exportChecksum',
    'exportBytesSha256',
    'finalSnapshotVersion',
    'metadataRevision',
  ])('checks closed candidate descriptor %s', (field) => {
    const badValue = field.endsWith('Version') || field.endsWith('Revision') ? -1 : '';
    rejectJson({
      ...begin,
      candidates: [{ ...manifest, descriptor: { ...manifest.descriptor, [field]: badValue } }],
    });
    rejectJson({
      ...begin,
      candidates: [
        {
          ...manifest,
          descriptor: { ...manifest.descriptor, PRIVATE_DESCRIPTOR_FIELD: 'PRIVATE_INPUT' },
        },
      ],
    });
  });

  it.each([
    'campaignCheckpointSha256',
    'semanticBodySha256',
    'submitBodySha256',
    'witnessSha256',
    'sourceChecksum',
    'exportChecksum',
    'exportBytesSha256',
  ] as const)('requires exact lowercase SHA256 in %s', (field) => {
    const bad = [
      '',
      'a'.repeat(63),
      'a'.repeat(65),
      'A'.repeat(64),
      'g'.repeat(64),
      `sha256:${'a'.repeat(64)}`,
      ' ' + 'a'.repeat(64),
      null,
      7,
    ];
    for (const value of bad) {
      const message =
        field === 'semanticBodySha256'
          ? { ...commands[1], [field]: value }
          : field === 'witnessSha256'
            ? { ...begin, candidates: [{ ...manifest, [field]: value }] }
            : ['sourceChecksum', 'exportChecksum', 'exportBytesSha256'].includes(field)
              ? {
                  ...begin,
                  candidates: [
                    { ...manifest, descriptor: { ...manifest.descriptor, [field]: value } },
                  ],
                }
              : { ...begin, [field]: value };
      rejectJson(message);
    }
  });

  it.each([
    '',
    'a'.repeat(64),
    'SHA256:' + 'a'.repeat(64),
    'sha256:' + 'A'.repeat(64),
    'sha256:' + 'a'.repeat(63),
    null,
  ])('rejects non-content-addressed baseline %s', (value) => {
    rejectJson({
      ...begin,
      candidates: [{ ...manifest, descriptor: { ...manifest.descriptor, baselineVersion: value } }],
    });
  });

  it.each([
    'requestRevision',
    'connectionRevision',
    'chunkIndex',
    'finalSnapshotVersion',
    'metadataRevision',
  ] as const)('rejects unsafe %s and permits the safe integer endpoints', (field) => {
    const change = (value: unknown) =>
      field === 'requestRevision'
        ? { ...cancel, [field]: value }
        : field === 'chunkIndex'
          ? { ...chunk, [field]: value }
          : field === 'connectionRevision'
            ? { ...begin, [field]: value }
            : {
                ...begin,
                candidates: [
                  { ...manifest, descriptor: { ...manifest.descriptor, [field]: value } },
                ],
              };
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0', null])
      rejectJson(change(value));
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY])
      rejection(() => encode(change(value)));
    for (const value of [0, Number.MAX_SAFE_INTEGER])
      expect(decode(encode(change(value)))).toEqual(change(value));
  });

  it.each(['maxSubmitBodyBytes', 'maxWitnessBytes', 'maxChunkBytes'] as const)(
    'requires explicit positive safe %s limits for both entry points',
    (field) => {
      for (const invalid of [
        0,
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
        null,
        '1024',
      ]) {
        const bad = { ...limits, [field]: invalid };
        expect(rejection(() => encode(open, bad)).code).toBe('INVALID_LIMITS');
        expect(rejection(() => decode(encode(open), bad)).code).toBe('INVALID_LIMITS');
      }
      const missing: Record<string, unknown> = { ...limits };
      delete missing[field];
      expect(
        rejection(() => encode(open, missing as unknown as DeviceAdmissionPeerCommandLimits)).field,
      ).toBe('limits');
    },
  );

  it('rejects null, extra, inherited, hidden and accessor-bearing limit configurations', () => {
    const getter = vi.fn(() => {
      throw new Error('PRIVATE_CONFIG');
    });
    const accessor = { ...limits };
    Object.defineProperty(accessor, 'maxChunkBytes', { get: getter, enumerable: true });
    const hidden = { ...limits };
    Object.defineProperty(hidden, 'PRIVATE_CONFIG', { value: 1 });
    for (const value of [
      null,
      {},
      [],
      { ...limits, extra: 1 },
      Object.create(limits),
      hidden,
      accessor,
    ]) {
      const config = value as DeviceAdmissionPeerCommandLimits;
      expect(rejection(() => encode(open, config)).code).toBe('INVALID_LIMITS');
      expect(rejection(() => decode(encode(open), config)).code).toBe('INVALID_LIMITS');
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('enforces declared submit/witness byte limits, positive lengths and manifest own fields', () => {
    for (const value of [0, -1, limits.maxSubmitBodyBytes + 1, 1.5, '1', null])
      rejectJson({ ...begin, submitBodyByteLength: value });
    for (const value of [0, -1, limits.maxWitnessBytes + 1, 1.5, '1', null])
      rejectJson({ ...begin, candidates: [{ ...manifest, witnessByteLength: value }] });
    for (const extra of [
      { ...manifest, canonicalWitnessText: 'PRIVATE_BYTES' },
      { ...manifest, ownerDeviceId: SESSION },
    ])
      rejectJson({ ...begin, candidates: [extra] });
    const valid = {
      ...begin,
      submitBodyByteLength: limits.maxSubmitBodyBytes,
      candidates: [{ ...manifest, witnessByteLength: limits.maxWitnessBytes }],
    };
    expect(decode(encode(valid))).toEqual(valid);
    expect(
      decode(
        encode({
          ...begin,
          submitBodyByteLength: 1,
          candidates: [{ ...manifest, witnessByteLength: 1 }],
        }),
      ),
    ).toBeDefined();
  });

  it('accepts canonical nonempty binary chunks at the exact configured bound', () => {
    for (const size of [1, 2, 3, limits.maxChunkBytes]) {
      const value = { ...chunk, bytesBase64: Buffer.alloc(size, 255).toString('base64') };
      expect(decode(encode(value))).toEqual(value);
    }
    rejectJson({
      ...chunk,
      bytesBase64: Buffer.alloc(limits.maxChunkBytes + 1).toString('base64'),
    });
  });

  it.each([
    '',
    'Zg',
    'Zg=',
    'Zh==',
    'Zg==\n',
    ' Zg==',
    'Zg== ',
    'Zg===',
    'Zg-_',
    '????',
    'data:;base64,Zg==',
    null,
    0,
  ])('rejects noncanonical base64 chunk %s', (value) => {
    rejectJson({ ...chunk, bytesBase64: value });
  });

  it.each([
    '',
    '   ',
    '\r\n\t',
    'x\u0000',
    'x\u0008',
    'x\u000b',
    'x\u000c',
    'x\u001f',
    'x\u007f',
    'x\u0085',
    'x\ud800',
    'x\udfff',
    null,
    1,
  ])('rejects invalid cancel reason without changing valid whitespace', (value) => {
    rejectJson({ ...cancel, reason: value });
  });

  it('bounds canonical UTF8 command bytes exactly at 128KiB independently of transfer limits', () => {
    const base = { ...cancel, reason: 'x' };
    const fixed = Buffer.byteLength(encode(base), 'utf8') - 1;
    const exact = { ...base, reason: 'x'.repeat(CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES - fixed) };
    const text = encode(exact);
    expect(Buffer.byteLength(text, 'utf8')).toBe(CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES);
    expect(decode(text)).toEqual(exact);
    expect(rejection(() => encode({ ...exact, reason: exact.reason + 'x' })).code).toBe(
      'COMMAND_TOO_LARGE',
    );
    expect(rejection(() => decode(text + ' ')).code).toBe('COMMAND_TOO_LARGE');
    const unicode = {
      ...base,
      reason: 'я'.repeat(Math.ceil((CAMPAIGN_PEER_HANDSHAKE_MAX_BYTES - fixed) / 2) + 1),
    };
    expect(rejection(() => encode(unicode)).code).toBe('COMMAND_TOO_LARGE');
  });

  it('rejects malformed/control/non-text frames, duplicate aliases and noncanonical inner JSON', () => {
    const text = encode(open);
    const sources: unknown[] = [
      null,
      {},
      [],
      true,
      0,
      Buffer.from(text),
      new Uint8Array(Buffer.from(text)),
      { type: 'ping' },
      '',
      'PRIVATE_BROKEN_JSON',
      'null',
      'true',
      '[]',
      '0',
      `${text}\n`,
      ` ${text}`,
      `\ufeff${text}`,
      JSON.stringify(open, null, 2),
      text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
      text.replace('"schemaVersion":1', '"schemaVersion":1.0'),
      text.replace('"commandId"', '"command\\u0049d"'),
    ];
    for (const source of sources) rejection(() => decode(source));
    rejection(() =>
      decode('{"schemaVersion":1,"operation":"DEVICE_REQUEST_CHUNK","chunkIndex":1e999}'),
    );
  });

  it('rejects object getters, hidden/symbol properties, foreign prototypes and sparse/extended manifests before executing accessors', () => {
    const getter = vi.fn(() => {
      throw new Error('PRIVATE_ACCESSOR');
    });
    const value = { ...open };
    Object.defineProperty(value, 'commandId', { get: getter, enumerable: true });
    const operation = { ...open };
    Object.defineProperty(operation, 'operation', { get: getter, enumerable: true });
    const hidden = { ...open };
    Object.defineProperty(hidden, 'PRIVATE_HIDDEN', { value: 'secret' });
    const symbol = { ...open, [Symbol('PRIVATE_SYMBOL')]: 'secret' };
    for (const source of [
      value,
      operation,
      hidden,
      symbol,
      Object.assign(Object.create({ extra: 'secret' }), open),
    ])
      rejection(() => encode(source));
    const candidates = [manifest];
    Object.defineProperty(candidates, '0', { get: getter, enumerable: true });
    rejection(() => encode({ ...begin, candidates }));
    rejection(() => encode({ ...begin, candidates: Array(1) }));
    const extended = [manifest];
    Object.defineProperty(extended, 'extra', { value: 'secret' });
    rejection(() => encode({ ...begin, candidates: extended }));
    expect(getter).not.toHaveBeenCalled();
  });

  it('redacts private parser exceptions and unknown field names in every diagnostic', () => {
    const privateText = 'PRIVATE_WITNESS_BYTES_AND_SECRET';
    const getter = vi.fn(() => {
      throw new Error(privateText);
    });
    const value = { ...begin };
    Object.defineProperty(value, 'candidates', { get: getter, enumerable: true });
    const errors = [
      rejection(() => encode(value)),
      rejection(() => encode({ ...open, [privateText]: privateText })),
      rejection(() => decode(privateText)),
      rejection(() =>
        decode(
          canonicalPostSaveJson({
            ...begin,
            candidates: [
              { ...manifest, descriptor: { ...manifest.descriptor, [privateText]: privateText } },
            ],
          }),
        ),
      ),
    ];
    for (const error of errors)
      expect(`${error.message}${error.stack}${JSON.stringify(error)}`).not.toContain(privateText);
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not retain a forged public error thrown by an input object trap', () => {
    const privateText = 'PRIVATE_PROXY_INPUT';
    const value = new Proxy(open, {
      ownKeys: () => {
        throw new DeviceAdmissionPeerCommandError(
          'INVALID_COMMAND',
          privateText as DeviceAdmissionPeerCommandField,
        );
      },
    });
    const error = rejection(() => encode(value));
    expect(error.field).toBe('command');
    expect(`${error.message}${JSON.stringify(error)}`).not.toContain(privateText);
  });
});
