import { describe, expect, it } from 'vitest';
import {
  assertEnemyArtReference,
  enemyArtOverrideValue,
  enemyArtPatchValue,
  enemyArtProjectionValue,
  enemyAttemptArt,
  enemyStoredArtPatchValue,
} from './enemy-art.js';

const sha256 = 'e'.repeat(64);
const uploaded = { assetKey: 'enemy-upload:' + sha256, sha256 };
const commandId = '3bf18c84-0475-4fab-ac00-4a3818d054e3';
const file = { kind: 'local-file', mediaType: 'image/jpeg', bytesBase64: '/9j/' } as const;
const stored = { operation: 'UPLOAD', mediaType: file.mediaType, sha256, byteLength: 3 };

describe('CORE-193 enemy art', () => {
  it('keeps client input and the compact historical upload mutually exclusive', () => {
    const request = { operation: 'UPLOAD', file };
    expect(enemyArtPatchValue(request)).toEqual(request);
    expect(enemyStoredArtPatchValue(stored)).toEqual(stored);
    expect(() => enemyArtPatchValue(stored)).toThrow();
    expect(() => enemyStoredArtPatchValue(request)).toThrow();
    expect(() => enemyArtPatchValue({ ...request, path: 'portrait.jpeg' })).toThrow();
    expect(() => enemyArtPatchValue({ operation: 'CLEAR', file })).toThrow();
  });

  it('accepts a full 12 MiB file and rejects an additional encoded byte or noncanonical padding', () => {
    const encoded = '/9j/' + 'A'.repeat(16 * 1024 * 1024 - 4);
    const patch = (bytesBase64: string) =>
      enemyArtPatchValue({
        operation: 'UPLOAD',
        file: { ...file, bytesBase64 },
      });
    expect(patch(encoded).operation).toBe('UPLOAD');
    expect(() => patch(encoded + 'AA==')).toThrow();
    for (const bytes of ['AB==', 'AAB=', '=AAA', 'AA==\n', '']) {
      expect(() => patch(bytes)).toThrow();
    }
  });

  it.each(['SENTIENT', 'CUSTOM_MONSTER'] as const)(
    'binds %s to its own default or upload',
    (kind) => {
      const own = enemyAttemptArt({ kind });
      const other = enemyAttemptArt({ kind: kind === 'SENTIENT' ? 'CUSTOM_MONSTER' : 'SENTIENT' });
      expect(enemyArtOverrideValue(kind, { ...own, uploadCommandIdOrNull: null }).assetKey).toBe(
        own.assetKey,
      );
      expect(() => assertEnemyArtReference(kind, other.assetKey, other.sha256)).toThrow();
      expect(() => assertEnemyArtReference(kind, uploaded.assetKey, own.sha256)).toThrow();
      expect(() =>
        enemyArtOverrideValue(kind, { ...uploaded, uploadCommandIdOrNull: null }),
      ).toThrow();
      expect(() =>
        enemyArtOverrideValue(kind, { ...own, uploadCommandIdOrNull: commandId }),
      ).toThrow();
      const artOverride = enemyArtOverrideValue(kind, {
        ...uploaded,
        uploadCommandIdOrNull: commandId,
      });
      expect(enemyAttemptArt({ kind, artOverride })).toEqual(uploaded);
      const image = { mediaType: file.mediaType, sha256, bytesBase64: file.bytesBase64 };
      expect(enemyArtProjectionValue(image, uploaded)).toEqual(image);
      expect(() => enemyArtProjectionValue(image, own)).toThrow();
    },
  );
});
