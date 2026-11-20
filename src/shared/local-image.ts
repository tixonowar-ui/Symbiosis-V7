/** ADR 0033, 0064 and 0077 A share the delivered PNG/JPEG byte interpretation. */
export const LOCAL_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

export function localImageMediaType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (JPEG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return 'image/jpeg';
  return null;
}
