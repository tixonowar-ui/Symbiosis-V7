import { beforeAll, describe, expect, it } from 'vitest';
import { loadProtocolVocabulary } from '../host/protocol-vocabulary.js';
import { decodeClientMessage, decodeHostMessage } from './wire-codec.js';
import { decodeClientMessageV2, decodeHostMessageV2 } from './wire-v2-codec.js';
import {
  decodeClientMessageV3,
  decodeHostMessageV3,
  encodeClientMessageV3,
  encodeHostMessageV3,
} from './wire-v3-codec.js';
import type { NpcArtReadRequest, NpcArtReadResult } from './npc-presentation.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = (): NpcArtReadRequest => ({
  messageType: 'network.npc-art.read',
  protocolVersion: 3,
  requestId: id(1),
  contextId: id(2),
  campaignId: id(3),
  sourceFormId: 'NPC-002',
  expectedRevisions: { stateRevision: 4, projectionRevision: 7, actorVisibilityRevision: 0 },
  target: { kind: 'ATTEMPT', npcDraftId: id(5), expectedAttemptRevision: 3 },
  assetKey: `npc-upload:${'a'.repeat(64)}`,
  checksum: 'a'.repeat(64),
});
const result = (): NpcArtReadResult => ({
  ...request(),
  messageType: 'network.npc-art.result',
  mediaType: 'image/png',
  bytesBase64: 'iVBORw0KGgo=',
});

describe('NPC private art uses the existing V3 transport only', () => {
  let vocabulary: Awaited<ReturnType<typeof loadProtocolVocabulary>>;
  beforeAll(async () => {
    vocabulary = await loadProtocolVocabulary(process.cwd());
  });
  it('roundtrips a read correlation without a durable operation or receipt', () => {
    const input = request(),
      encoded = encodeClientMessageV3(input, vocabulary);
    if (!encoded.ok) throw new Error('Expected art request');
    expect(decodeClientMessageV3(encoded.text, vocabulary)).toEqual({ ok: true, value: input });
    expect(decodeClientMessage(encoded.text, vocabulary).ok).toBe(false);
    expect(decodeClientMessageV2(encoded.text, vocabulary).ok).toBe(false);
    expect(decodeHostMessageV3(encoded.text, vocabulary).ok).toBe(false);
  });
  it('roundtrips private bytes and a closed refusal in the host direction', () => {
    for (const value of [
      result(),
      {
        ...request(),
        messageType: 'network.npc-art.refusal' as const,
        code: 'NOT_AVAILABLE' as const,
      },
    ]) {
      const encoded = encodeHostMessageV3(value, vocabulary);
      if (!encoded.ok) throw new Error('Expected art response');
      expect(decodeHostMessageV3(encoded.text, vocabulary)).toEqual({ ok: true, value });
      expect(decodeHostMessage(encoded.text, vocabulary).ok).toBe(false);
      expect(decodeHostMessageV2(encoded.text, vocabulary).ok).toBe(false);
      expect(decodeClientMessageV3(encoded.text, vocabulary).ok).toBe(false);
    }
  });
  it.each(['contextId', 'campaignId', 'requestId'] as const)('rejects malformed %s', (key) => {
    expect(
      decodeClientMessageV3(
        JSON.stringify({ ...request(), [key]: 'foreign PRIVATE value' }),
        vocabulary,
      ).ok,
    ).toBe(false);
  });
  it('does not admit URLs, player authority, operation IDs or private error details', () => {
    for (const extra of [
      { url: 'https://private.invalid/' },
      { role: 'gm' },
      { operationId: id(8) },
      { rawInput: 'PRIVATE' },
    ]) {
      const decoded = decodeClientMessageV3(JSON.stringify({ ...request(), ...extra }), vocabulary);
      expect(decoded.ok).toBe(false);
      expect(JSON.stringify(decoded)).not.toContain('PRIVATE');
    }
    const decoded = decodeHostMessageV3(
      JSON.stringify({
        ...request(),
        messageType: 'network.npc-art.refusal',
        code: 'NOT_AVAILABLE',
        error: 'PRIVATE',
      }),
      vocabulary,
    );
    expect(decoded.ok).toBe(false);
    expect(JSON.stringify(decoded)).not.toContain('PRIVATE');
  });
  it('refuses malformed byte encoding/signature before sending the host response', () => {
    for (const bytesBase64 of ['private text', 'iVBORw0KGgo=\n', 'AAAA'])
      expect(encodeHostMessageV3({ ...result(), bytesBase64 }, vocabulary).ok).toBe(false);
  });
  it.each(['root', 'target', 'bytes'] as const)(
    'does not invoke %s getters during common encoding',
    (site) => {
      let reads = 0;
      if (site === 'bytes') {
        const value = result();
        Object.defineProperty(value, 'bytesBase64', {
          enumerable: true,
          get: () => {
            reads++;
            return 'PRIVATE';
          },
        });
        expect(encodeHostMessageV3(value, vocabulary).ok).toBe(false);
      } else {
        const value = request();
        Object.defineProperty(
          site === 'root' ? value : value.target,
          site === 'root' ? 'messageType' : 'npcDraftId',
          {
            enumerable: true,
            get: () => {
              reads++;
              return 'PRIVATE';
            },
          },
        );
        expect(encodeClientMessageV3(value, vocabulary).ok).toBe(false);
      }
      expect(reads).toBe(0);
    },
  );
  it('rejects invisible extensions and toJSON without normalizing them away', () => {
    let calls = 0;
    const invisible = request(),
      custom = result();
    Object.defineProperty(invisible.target, 'PRIVATE', { value: true, enumerable: false });
    Object.defineProperty(custom, 'toJSON', {
      value: () => {
        calls++;
        return result();
      },
      enumerable: true,
    });
    expect(encodeClientMessageV3(invisible, vocabulary).ok).toBe(false);
    expect(encodeHostMessageV3(custom, vocabulary).ok).toBe(false);
    expect(calls).toBe(0);
  });
});
