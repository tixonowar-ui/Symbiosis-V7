import { createHash } from 'node:crypto';
import type * as FileSystem from 'node:fs/promises';
import { appendFile, mkdtemp, rm, truncate, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { baselineArtifactDigest } from './baseline-artifact-digest.js';

const observation = vi.hoisted(() => ({
  handles: [] as FileHandle[],
  buffers: [] as Buffer[],
  requests: [] as { length: number; position: number }[],
  closes: 0,
  readLimit: Number.POSITIVE_INFINITY,
  readErrorAt: -1,
  reportedSize: null as number | null,
  readError: new Error('injected read failure'),
  afterStat: null as (() => Promise<void>) | null,
}));

// Real files and descriptors remain in use; only scheduling/failure points are controlled.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      observation.handles.push(handle);
      return {
        stat: async () => {
          const info = await handle.stat();
          if (observation.reportedSize !== null) info.size = observation.reportedSize;
          await observation.afterStat?.();
          return info;
        },
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          observation.buffers.push(buffer);
          observation.requests.push({ length, position });
          if (observation.requests.length === observation.readErrorAt) throw observation.readError;
          return handle.read(buffer, offset, Math.min(length, observation.readLimit), position);
        },
        close: async () => {
          observation.closes++;
          await handle.close();
        },
      };
    },
  };
});

let directory: string;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'symbiosis-baseline-digest-'));
  observation.handles = [];
  observation.buffers = [];
  observation.requests = [];
  observation.closes = 0;
  observation.readLimit = Number.POSITIVE_INFINITY;
  observation.readErrorAt = -1;
  observation.reportedSize = null;
  observation.afterStat = null;
});
afterEach(async () => {
  try {
    expect(observation.closes).toBe(observation.handles.length);
    for (const handle of observation.handles) expect(handle.fd).toBe(-1);
  } finally {
    for (const handle of observation.handles) if (handle.fd !== -1) await handle.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([0, 1, 7, 8, 9, 35])('hashes exactly %i bytes across scratch boundaries', async (size) => {
  const bytes = Buffer.from(Array.from({ length: size }, (_, i) => (i * 13) % 251));
  const filename = join(directory, 'artifact.bin');
  await writeFile(filename, bytes);
  const scratch = Buffer.alloc(8, 0xa5);
  expect(await baselineArtifactDigest(filename, scratch)).toBe(sha256(bytes));
  expect(observation.handles).toHaveLength(1);
  expect(observation.requests.at(-1)).toEqual({ length: 1, position: size });
  expect(observation.requests.every(({ length }) => length > 0 && length <= scratch.length)).toBe(
    true,
  );
  expect(observation.buffers.every((buffer) => buffer === scratch)).toBe(true);
});

it('continues positive short reads and excludes the unused dirty tail', async () => {
  const bytes = Buffer.from('Only actual file bytes belong in the digest.');
  const filename = join(directory, 'short-reads.bin');
  await writeFile(filename, bytes);
  observation.readLimit = 3;
  expect(await baselineArtifactDigest(filename, Buffer.alloc(8, 0xa5))).toBe(sha256(bytes));
  expect(observation.requests.slice(0, -1).map(({ position }) => position)).toEqual(
    Array.from({ length: Math.ceil(bytes.length / 3) }, (_, i) => i * 3),
  );
});

it.each(['growth', 'truncation'] as const)(
  'refuses %s after the initial file size is captured',
  async (change) => {
    const filename = join(directory, 'changed.bin');
    await writeFile(filename, 'original bytes');
    observation.afterStat = () =>
      change === 'growth' ? appendFile(filename, 'extra bytes') : truncate(filename, 2);
    await expect(baselineArtifactDigest(filename, Buffer.alloc(8))).rejects.toThrow(
      change === 'growth' ? 'grew during verification' : 'shortened during verification',
    );
    expect(observation.handles).toHaveLength(1);
  },
);

it('propagates a read error and closes its descriptor', async () => {
  const filename = join(directory, 'read-error.bin');
  await writeFile(filename, 'longer than a single buffer');
  observation.readErrorAt = 2;
  await expect(baselineArtifactDigest(filename, Buffer.alloc(8))).rejects.toBe(
    observation.readError,
  );
  expect(observation.requests).toHaveLength(2);
  expect(observation.handles).toHaveLength(1);
});

it('closes the opened descriptor when the initial stat fails', async () => {
  const filename = join(directory, 'stat-error.bin');
  await writeFile(filename, 'bytes');
  const error = new Error('injected stat failure');
  observation.afterStat = () => Promise.reject(error);
  await expect(baselineArtifactDigest(filename, Buffer.alloc(8))).rejects.toBe(error);
  expect(observation.requests).toHaveLength(0);
  expect(observation.handles).toHaveLength(1);
});

it('refuses missing paths, directories and an empty buffer without a digest', async () => {
  await expect(
    baselineArtifactDigest(join(directory, 'absent'), Buffer.alloc(8)),
  ).rejects.toThrow();
  await expect(baselineArtifactDigest(directory, Buffer.alloc(8))).rejects.toThrow();
  const opened = observation.handles.length;
  await expect(baselineArtifactDigest(directory, Buffer.alloc(0))).rejects.toThrow(
    'empty verification buffer',
  );
  expect(observation.handles).toHaveLength(opened);
});

it.each([
  { size: 2 ** 31 - 1, message: 'shortened during verification', reads: 2 },
  { size: 2 ** 31, message: 'exceeds the readFile size limit', reads: 0 },
])('preserves the previous readFile limit at $size bytes', async ({ size, message, reads }) => {
  const filename = join(directory, 'size-limit.bin');
  await writeFile(filename, 'a');
  observation.reportedSize = size;
  await expect(baselineArtifactDigest(filename, Buffer.alloc(8))).rejects.toThrow(message);
  expect(observation.requests).toHaveLength(reads);
  expect(observation.handles).toHaveLength(1);
});

it('hashes concurrent files with distinct caller-owned buffers', async () => {
  const inputs = [Buffer.alloc(37, 0xa5), Buffer.alloc(53, 0x3c)];
  const paths = inputs.map((_, i) => join(directory, `${i}.bin`));
  await Promise.all(inputs.map((bytes, i) => writeFile(paths[i]!, bytes)));
  const scratch = inputs.map(() => Buffer.alloc(8));
  expect(
    await Promise.all(paths.map((file, i) => baselineArtifactDigest(file, scratch[i]!))),
  ).toEqual(inputs.map(sha256));
  expect(observation.handles).toHaveLength(2);
  expect(new Set(observation.buffers)).toEqual(new Set(scratch));
});
