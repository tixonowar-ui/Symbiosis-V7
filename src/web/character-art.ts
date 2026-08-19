import type { IdentityDraftArtValue } from '@shared/index.js';

type LocalCharacterArt = Extract<IdentityDraftArtValue, { readonly kind: 'local-file' }>;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const BASE64_CHUNK_BYTES = 0x8000;

export const CHARACTER_ART_ACCEPT = 'image/png,image/jpeg';
/** Existing ADR 0033 §2 host ceiling; this browser check is only an early user-facing hint. */
export const MAX_CHARACTER_ART_BYTES = 12 * 1024 * 1024;

export type CharacterArtFileResult =
  | { readonly ok: true; readonly value: LocalCharacterArt }
  | {
      readonly ok: false;
      readonly reason: 'FILE_TOO_LARGE' | 'UNSUPPORTED_MEDIA_SIGNATURE';
    };

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function mediaTypeFromBytes(bytes: Uint8Array): LocalCharacterArt['mediaType'] | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  return null;
}

function canonicalBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunking avoids exceeding the browser's argument limit on a permitted 12 MB image.
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      'load',
      () => {
        if (!(reader.result instanceof ArrayBuffer)) {
          reject(new Error('character art reader did not return an ArrayBuffer'));
          return;
        }
        resolve(new Uint8Array(reader.result));
      },
      { once: true },
    );
    reader.addEventListener(
      'error',
      () => reject(new Error('character art file could not be read')),
      { once: true },
    );
    reader.addEventListener(
      'abort',
      () => reject(new Error('character art file read was aborted')),
      { once: true },
    );
    reader.readAsArrayBuffer(file);
  });
}

/** CHR-001 derives the wire media type from bytes, never from the local filename or File.type. */
export async function characterArtFromFile(file: File): Promise<CharacterArtFileResult> {
  if (file.size > MAX_CHARACTER_ART_BYTES) return { ok: false, reason: 'FILE_TOO_LARGE' };
  const bytes = await readBytes(file);
  const mediaType = mediaTypeFromBytes(bytes);
  if (mediaType === null) return { ok: false, reason: 'UNSUPPORTED_MEDIA_SIGNATURE' };
  return {
    ok: true,
    value: {
      bytesBase64: canonicalBase64(bytes),
      kind: 'local-file',
      mediaType,
    },
  };
}
