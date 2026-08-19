import { describe, expect, it, vi } from 'vitest';

import {
  CHARACTER_ART_ACCEPT,
  MAX_CHARACTER_ART_BYTES,
  characterArtFromFile,
} from './character-art.js';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = new Uint8Array([0xff, 0xd8, 0xff]);

describe('CHR-001 character art file reader', () => {
  it('derives PNG from bytes despite a JPEG filename and returns padded canonical base64', async () => {
    const file = new File([PNG_SIGNATURE], 'portrait.jpg', { type: 'image/jpeg' });

    await expect(characterArtFromFile(file)).resolves.toEqual({
      ok: true,
      value: {
        bytesBase64: 'iVBORw0KGgo=',
        kind: 'local-file',
        mediaType: 'image/png',
      },
    });
  });

  it('derives JPEG from bytes despite a PNG filename', async () => {
    const file = new File([JPEG_SIGNATURE], 'portrait.png', { type: 'image/png' });

    await expect(characterArtFromFile(file)).resolves.toEqual({
      ok: true,
      value: {
        bytesBase64: '/9j/',
        kind: 'local-file',
        mediaType: 'image/jpeg',
      },
    });
  });

  it('refuses content with neither supported signature instead of guessing from metadata', async () => {
    const file = new File([new Uint8Array([0x47, 0x49, 0x46])], 'portrait.png', {
      type: 'image/png',
    });

    await expect(characterArtFromFile(file)).resolves.toEqual({
      ok: false,
      reason: 'UNSUPPORTED_MEDIA_SIGNATURE',
    });
    expect(CHARACTER_ART_ACCEPT).toBe('image/png,image/jpeg');
  });

  it('preflights the existing host size limit before reading bytes', async () => {
    const file = new File([PNG_SIGNATURE], 'oversized.png');
    Object.defineProperty(file, 'size', { value: MAX_CHARACTER_ART_BYTES + 1 });
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');

    await expect(characterArtFromFile(file)).resolves.toEqual({
      ok: false,
      reason: 'FILE_TOO_LARGE',
    });
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });
});
