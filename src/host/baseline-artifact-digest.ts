import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

// Preserve Node 24.19 readFileHandle's kIoMaxLength refusal before streaming any bytes.
const MAX_BASELINE_ARTIFACT_BYTES = 2 ** 31 - 1;

/** The caller owns this scratch exclusively until the returned promise settles. */
export async function baselineArtifactDigest(filename: string, scratch: Buffer): Promise<string> {
  if (scratch.length === 0) throw new Error('baseline artifact: empty verification buffer');
  const handle = await open(filename, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0)
      throw new Error(`baseline artifact is not a regular finite file: ${filename}`);
    if (info.size > MAX_BASELINE_ARTIFACT_BYTES)
      throw new Error(`baseline artifact exceeds the readFile size limit: ${filename}`);
    const digest = createHash('sha256');
    let offset = 0;
    while (offset < info.size) {
      const { bytesRead } = await handle.read(
        scratch,
        0,
        Math.min(scratch.length, info.size - offset),
        offset,
      );
      if (bytesRead === 0)
        throw new Error(`baseline artifact shortened during verification: ${filename}`);
      digest.update(scratch.subarray(0, bytesRead));
      offset += bytesRead;
    }
    // Refuse observed size changes; this is not an atomic snapshot of concurrent writes.
    const { bytesRead } = await handle.read(scratch, 0, 1, info.size);
    if (bytesRead !== 0) throw new Error(`baseline artifact grew during verification: ${filename}`);
    return digest.digest('hex');
  } finally {
    await handle.close();
  }
}
