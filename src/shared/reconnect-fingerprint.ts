// FIPS 180-4, sections 4.2.2 and 5.3.3. Shared receipt checks also run on HTTP LAN origins.
const ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

// ADR 0063 orders object keys by UTF-16 code units, including keys that look like array indices.
function canonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object') throw new TypeError('Reconnect fingerprint requires finite JSON');
  if (ancestors.has(value)) throw new TypeError('Cycle in reconnect fingerprint input');
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Symbol in JSON keys');
  ancestors.add(value);
  let text: string;
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index)))
      throw new TypeError('Sparse or extended array in reconnect fingerprint input');
    text = '[' + value.map((item: unknown) => canonicalJson(item, ancestors)).join(',') + ']';
  } else {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== null && prototype !== Object.prototype)
      throw new TypeError('Expected plain JSON object');
    const fields = value as Record<string, unknown>;
    text =
      '{' +
      Object.keys(fields)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonicalJson(fields[key], ancestors))
        .join(',') +
      '}';
  }
  ancestors.delete(value);
  return text;
}

function rotateRight(word: number, bits: number): number {
  return (word >>> bits) | (word << (32 - bits));
}

/** Hash canonical UTF-8 without retaining the source payload as a reconnect diagnostic. */
export function reconnectFingerprint(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalJson(value, new Set()));
  const state: [number, number, number, number, number, number, number, number] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  function compress(data: DataView, offset: number) {
    for (let i = 0; i < 16; i++) words[i] = data.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15]!,
        y = words[i - 2]!;
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[i] = words[i - 16]! + sigma0 + words[i - 7]! + sigma1;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = h + sum1 + choose + ROUND_CONSTANTS[i]! + words[i]!;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + sum0 + majority) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const remainder = bytes.length % 64;
  const fullBytes = bytes.length - remainder;
  for (let offset = 0; offset < fullBytes; offset += 64) compress(input, offset);
  // Only the final one or two blocks require a copy for SHA-256 padding.
  const tail = new Uint8Array(remainder < 56 ? 64 : 128);
  tail.set(bytes.subarray(fullBytes));
  tail[remainder] = 0x80;
  const padded = new DataView(tail.buffer);
  padded.setBigUint64(tail.length - 8, BigInt(bytes.length) * 8n);
  for (let offset = 0; offset < tail.length; offset += 64) compress(padded, offset);
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}
