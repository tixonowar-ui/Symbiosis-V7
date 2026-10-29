import { renderToStaticMarkup } from 'react-dom/server';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { CampaignQr, campaignQrMatrix } from './campaign-qr.js';

const campaignId = '8f3ef203-b601-4dfd-9f6d-45164f4c72ba';
const locators = [
  `http://192.168.1.20:3000/?campaignId=${campaignId}`,
  `http://[::1]:3000/campaigns/${campaignId}`,
  `http://127.0.0.1:3000/campaigns/${campaignId}?name=${encodeURIComponent('Кампания № 1')}`,
];

function renderPixels(value: string) {
  const markup = renderToStaticMarkup(<CampaignQr value={value} />);
  const document = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = document.querySelector('svg')!;
  const side = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
  const scale = 4;
  const width = side * scale;
  const rgba = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const module of svg.querySelectorAll('rect[fill="#000"]')) {
    const x = Number(module.getAttribute('x'));
    const y = Number(module.getAttribute('y'));
    expect(module.getAttribute('width')).toBe('1');
    expect(module.getAttribute('height')).toBe('1');
    for (let row = y * scale; row < (y + 1) * scale; row += 1)
      for (let column = x * scale; column < (x + 1) * scale; column += 1) {
        const offset = 4 * (row * width + column);
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
      }
  }
  return { svg, markup, rgba, width, side };
}

describe('CMP-006 offline campaign QR', () => {
  it.each(locators)('decodes the rendered SVG modules to the exact public locator %s', (value) => {
    const { svg, rgba, width, side } = renderPixels(value);
    const matrix = campaignQrMatrix(value);
    expect(
      matrix.every(
        (row) => row.length === matrix.length && row.every((cell) => typeof cell === 'boolean'),
      ),
    ).toBe(true);
    expect(campaignQrMatrix(value)).toEqual(matrix);
    expect(side).toBe(matrix.length + 8);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('QR подключения к кампании');
    expect(svg.querySelector('rect[fill="#fff"]')?.getAttribute('width')).toBe(String(side));
    const blackModules = [...svg.querySelectorAll('rect[fill="#000"]')];
    expect(blackModules.length).toBe(matrix.flat().filter(Boolean).length);
    for (const module of blackModules) {
      const x = Number(module.getAttribute('x'));
      const y = Number(module.getAttribute('y'));
      expect(x).toBeGreaterThanOrEqual(4);
      expect(y).toBeGreaterThanOrEqual(4);
      expect(x).toBeLessThan(side - 4);
      expect(y).toBeLessThan(side - 4);
      expect(matrix[y - 4]![x - 4]).toBe(true);
    }
    const decoded = jsQR(rgba, width, width, { inversionAttempts: 'dontInvert' });
    expect(decoded?.data).toBe(value);
    expect(decoded?.binaryData).toEqual([...value].map((character) => character.charCodeAt(0)));
    expect(svg.querySelector('script,foreignObject,image,a')).toBeNull();
  });

  it.each([
    '',
    'http://example.test',
    'https://example.test/',
    'javascript:alert(1)',
    'http://user:private-secret@example.test/',
    'http://example.test/кампания',
    'http://example.test/a b',
    'http://example.test/\n',
  ])('rejects a noncanonical or nonpublic HTTP locator without echoing it', (value) => {
    expect(() => campaignQrMatrix(value)).toThrow(
      'Campaign QR requires a canonical public HTTP locator',
    );
  });

  it('fails explicitly when an otherwise valid locator exceeds QR capacity', () => {
    expect(() => campaignQrMatrix(`http://example.test/${'a'.repeat(4000)}`)).toThrow(
      'Campaign HTTP locator exceeds QR encoding capacity',
    );
  });
});
