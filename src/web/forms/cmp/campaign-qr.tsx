import type { ReactElement } from 'react';
import qrcode from 'qrcode-generator';

// QR quiet zones are four modules; they are part of the image, not page CSS.
const QUIET_ZONE_MODULES = 4;

export function campaignQrMatrix(value: string): readonly boolean[][] {
  let locator: URL;
  try {
    locator = new URL(value);
  } catch {
    throw new Error('Campaign QR requires a canonical public HTTP locator');
  }
  if (
    typeof value !== 'string' ||
    [...value].some(
      (character) => character.charCodeAt(0) < 0x21 || character.charCodeAt(0) > 0x7e,
    ) ||
    locator.protocol !== 'http:' ||
    locator.username !== '' ||
    locator.password !== '' ||
    locator.href !== value
  )
    throw new Error('Campaign QR requires a canonical public HTTP locator');
  const code = qrcode(0, 'M');
  try {
    // The host percent-encodes non-ASCII URI data, so Byte mode preserves exact bytes.
    code.addData(value, 'Byte');
    code.make();
  } catch {
    throw new Error('Campaign HTTP locator exceeds QR encoding capacity');
  }
  const count = code.getModuleCount();
  return Object.freeze(
    Array.from({ length: count }, (_, row) =>
      Array.from({ length: count }, (_, column) => code.isDark(row, column)),
    ),
  );
}

export function CampaignQr({ value }: { readonly value: string }): ReactElement {
  const matrix = campaignQrMatrix(value);
  const side = matrix.length + 2 * QUIET_ZONE_MODULES;
  return (
    <svg
      role="img"
      aria-label="QR подключения к кампании"
      viewBox={`0 0 ${String(side)} ${String(side)}`}
      width="256"
      height="256"
      shapeRendering="crispEdges"
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      <rect width={side} height={side} fill="#fff" />
      {matrix.flatMap((row, rowIndex) =>
        row.map((dark, columnIndex) =>
          dark ? (
            <rect
              key={`${String(rowIndex)}-${String(columnIndex)}`}
              x={columnIndex + QUIET_ZONE_MODULES}
              y={rowIndex + QUIET_ZONE_MODULES}
              width="1"
              height="1"
              fill="#000"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
