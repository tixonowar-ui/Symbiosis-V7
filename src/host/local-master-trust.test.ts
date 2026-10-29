import { describe, expect, it } from 'vitest';
import { isTrustedLocalMasterConnection, normalizedHostIp } from './local-master-trust.js';

describe('host-local master launch proof', () => {
  const base = {
    remoteAddress: '127.0.0.1',
    localAddress: '127.0.0.1',
    origin: 'http://127.0.0.1:3000',
    listener: { address: '127.0.0.1', port: 3000 },
  };
  it('accepts the real local endpoint and canonical bound Origin, including mapped IPv6 and port 80', () => {
    for (const proof of [
      base,
      { ...base, remoteAddress: '127.0.0.2', origin: 'http://localhost:3000' },
      { ...base, remoteAddress: '::ffff:127.0.0.1', localAddress: '::ffff:7f00:1' },
      { ...base, origin: 'http://127.0.0.1', listener: { address: '0.0.0.0', port: 80 } },
      {
        remoteAddress: '::1',
        localAddress: '::1',
        origin: 'http://[::1]:3000',
        listener: { address: '::', port: 3000 },
      },
      {
        remoteAddress: '192.0.2.15',
        localAddress: '192.0.2.15',
        origin: 'http://192.0.2.15:3000',
        listener: { address: '0.0.0.0', port: 3000 },
      },
    ])
      expect(isTrustedLocalMasterConnection(proof)).toBe(true);
  });
  it('rejects remote peers, missing/foreign/noncanonical origins, userinfo and the same port on another bind address', () => {
    for (const patch of [
      { remoteAddress: '192.0.2.11' },
      { origin: undefined },
      { origin: 'null' },
      { origin: 'https://127.0.0.1:3000' },
      { origin: 'http://127.0.0.1:3001' },
      { origin: 'http://evil.example:3000' },
      { origin: 'http://127.0.0.1:3000/' },
      { origin: 'http://user:secret@127.0.0.1:3000' },
      { origin: 'http://127.0.0.1:3000?x=1' },
      { listener: null },
      { listener: { address: '192.0.2.15', port: 3000 } },
      { listener: { address: '127.0.0.1', port: 0 } },
      { remoteAddress: 'fe80::1%4', localAddress: 'fe80::1%4' },
    ])
      expect(isTrustedLocalMasterConnection({ ...base, ...patch })).toBe(false);
  });
  it('normalizes real IP identity without guessing DNS names or invalid IPv4', () => {
    expect(normalizedHostIp('0:0:0:0:0:0:0:1')).toBe('::1');
    expect(normalizedHostIp('::ffff:c000:20f')).toBe('192.0.2.15');
    for (const value of ['localhost', '127.000.0.1', 'fe80::1%3', '', null])
      expect(normalizedHostIp(value)).toBeNull();
  });
});
