import { describe, expect, it } from 'vitest';
import { isTrustedLocalHttpAppConnection } from './local-app-boundary.js';
import { isTrustedLocalMasterConnection } from './local-master-trust.js';

const local = {
  remoteAddress: '127.0.0.1',
  localAddress: '127.0.0.1',
  listener: { address: '127.0.0.1', port: 3000 },
};
describe('host-local read-only HTTP boundary', () => {
  it('accepts a real local endpoint with an explicit matching Origin or an origin-less GET', () => {
    for (const proof of [
      { ...local, origin: undefined },
      { ...local, origin: 'http://127.0.0.1:3000' },
      { ...local, origin: 'http://localhost:3000' },
      { ...local, remoteAddress: '::ffff:127.0.0.1', origin: undefined },
      { ...local, listener: { address: '0.0.0.0', port: 3000 }, origin: undefined },
      {
        remoteAddress: '::1',
        localAddress: '::1',
        listener: { address: '::', port: 80 },
        origin: undefined,
      },
    ])
      expect(isTrustedLocalHttpAppConnection(proof)).toBe(true);
  });
  it('denies nonlocal peers and incomplete TCP/listener evidence even without Origin', () => {
    for (const patch of [
      { remoteAddress: '192.0.2.15' },
      { remoteAddress: undefined },
      { localAddress: undefined },
      { listener: null },
      { listener: { address: '192.0.2.10', port: 3000 } },
      { listener: { address: '127.0.0.1', port: 0 } },
      { listener: { address: '127.0.0.1', port: 65536 } },
      { localAddress: 'localhost' },
      { localAddress: 'fe80::1%4' },
    ])
      expect(isTrustedLocalHttpAppConnection({ ...local, origin: undefined, ...patch })).toBe(
        false,
      );
  });
  it('never replaces a present foreign, null or malformed Origin with a local one', () => {
    for (const origin of [
      'http://untrusted.invalid',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3000/',
      'https://127.0.0.1:3000',
      'null',
      null,
      [],
      123,
      '',
    ])
      expect(isTrustedLocalHttpAppConnection({ ...local, origin })).toBe(false);
  });
  it('does not authorize an origin-less WebSocket through the HTTP-only exception', () => {
    const proof = { ...local, origin: undefined };
    expect(isTrustedLocalHttpAppConnection(proof)).toBe(true);
    expect(isTrustedLocalMasterConnection(proof)).toBe(false);
  });
});
