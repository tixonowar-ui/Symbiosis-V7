import jsQR from 'jsqr';

/** Technical decode budgets, independent of game data and uploaded character artwork. */
export const NETWORK_QR_MAX_FILE_BYTES = 12 * 1024 * 1024;
export const NETWORK_QR_MAX_IMAGE_SIDE = 4096;
export type NetworkQrErrorCode =
  'INVALID_IMAGE' | 'IMAGE_TOO_LARGE' | 'QR_NOT_FOUND' | 'IMAGE_UNAVAILABLE';
export class NetworkQrError extends Error {
  constructor(readonly code: NetworkQrErrorCode) {
    super(`QR image: ${code}`);
  }
}
export function decodeNetworkQrPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > NETWORK_QR_MAX_IMAGE_SIDE ||
    height > NETWORK_QR_MAX_IMAGE_SIDE ||
    data.length !== width * height * 4
  )
    throw new NetworkQrError('INVALID_IMAGE');
  const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  if (result === null || result.data.length === 0) throw new NetworkQrError('QR_NOT_FOUND');
  return result.data;
}

/** Local pixels only. A decoded URL is input text; this function never opens or fetches it. */
export async function readNetworkQrFile(file: File): Promise<string> {
  if (file.size > NETWORK_QR_MAX_FILE_BYTES) throw new NetworkQrError('IMAGE_TOO_LARGE');
  if (file.size === 0 || (file.type !== 'image/png' && file.type !== 'image/jpeg'))
    throw new NetworkQrError('INVALID_IMAGE');
  let bitmap: ImageBitmap | null = null;
  try {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        reader.result instanceof ArrayBuffer
          ? resolve(reader.result)
          : reject(new NetworkQrError('IMAGE_UNAVAILABLE'));
      reader.onerror = reader.onabort = () => reject(new NetworkQrError('IMAGE_UNAVAILABLE'));
      reader.readAsArrayBuffer(file.slice(0, 8));
    });
    const header = new Uint8Array(bytes);
    const signature =
      file.type === 'image/png'
        ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        : [0xff, 0xd8, 0xff];
    if (!signature.every((byte, index) => header[index] === byte))
      throw new NetworkQrError('INVALID_IMAGE');
    bitmap = await createImageBitmap(file);
    if (
      bitmap.width < 1 ||
      bitmap.height < 1 ||
      bitmap.width > NETWORK_QR_MAX_IMAGE_SIDE ||
      bitmap.height > NETWORK_QR_MAX_IMAGE_SIDE
    )
      throw new NetworkQrError('IMAGE_TOO_LARGE');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new NetworkQrError('IMAGE_UNAVAILABLE');
    context.drawImage(bitmap, 0, 0);
    return decodeNetworkQrPixels(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
    );
  } catch (error: unknown) {
    if (error instanceof NetworkQrError) throw error;
    // Browser decode errors may include a local filename; expose only the fixed public code.
    throw new NetworkQrError('IMAGE_UNAVAILABLE');
  } finally {
    bitmap?.close();
  }
}
