import type { RevisionVector } from './wire-protocol.js';
import { fileURLToPath } from 'node:url';
import { loadProtocolVocabulary } from '../host/protocol-vocabulary.js';
import {
  decodeClientMessageV3,
  encodeClientMessageV3,
  decodeHostMessageV3,
  encodeHostMessageV3,
} from './wire-v3-codec.js';
import { decodeClientMessage, decodeHostMessage } from './wire-codec.js';
import { decodeClientMessageV2, decodeHostMessageV2 } from './wire-v2-codec.js';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { wireCodecPrimitives } from './wire-codec.js';
import {
  decodeNpcWorkflowCommandRequest,
  npcTechnicalResponseValue,
  NPC_TECHNICAL_REFUSAL_CODES,
  npcWorkflowCommandRequestValue,
  NPC_EDITOR_FORMS,
  NPC_NAV_TARGETS,
  npcTechnicalRequestValue,
  decodeNpcTechnicalRequest,
} from './npc-command.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const envelope = {
  messageType: 'command.request',
  protocolVersion: 1,
  commandKind: 'workflow-command',
  role: 'gm',
  commandId: id(1),
  expectedRevisions: {
    stateRevision: 2,
    projectionRevision: 9,
    actorVisibilityRevision: 1,
  },
} as const;
const v1 = () => ({
  ...envelope,
  workflowCommandId: 'UI-CMD-NPC-COMMIT-V1',
  payload: { campaignId: id(2), npcDraftId: id(3), expectedAttemptRevision: 7 },
});
const open = () => ({
  ...envelope,
  workflowCommandId: 'UI-CMD-NPC-NEW-VERSION',
  payload: {
    phase: 'OPEN',
    campaignId: id(2),
    npcUuid: id(4),
    expectedCurrentVersion: 2,
  },
});
const commit = () => ({
  ...envelope,
  workflowCommandId: 'UI-CMD-NPC-NEW-VERSION',
  payload: { ...v1().payload, phase: 'COMMIT', expectedCurrentVersion: 2 },
});

describe('ADR 0077 NPC workflow phase envelopes', () => {
  it('keeps the exact V1, OPEN and COMMIT payloads without synthesizing a new workflow', () => {
    for (const input of [v1(), open(), commit()]) {
      expect(npcWorkflowCommandRequestValue(input)).toEqual(input);
      expect(decodeNpcWorkflowCommandRequest(JSON.stringify(input))).toEqual({
        ok: true,
        value: input,
      });
    }
  });
  it('rejects mixing OPEN identity with COMMIT draft or caller-assigned outcome', () => {
    for (const input of [
      { ...open(), payload: { ...open().payload, npcDraftId: id(3) } },
      { ...commit(), payload: { ...commit().payload, npcUuid: id(4) } },
      { ...v1(), payload: { ...v1().payload, phase: 'COMMIT' } },
      { ...commit(), payload: { ...commit().payload, version: 3 } },
      { ...open(), payload: { ...open().payload, phase: 'REOPEN' } },
      { ...v1(), payload: { ...v1().payload, valid: true } },
    ])
      expect(decodeNpcWorkflowCommandRequest(JSON.stringify(input)).ok).toBe(false);
  });
  it('requires GM and all three nonnegative safe revisions independently of campaign revision', () => {
    for (const role of ['player', 'system', undefined])
      expect(decodeNpcWorkflowCommandRequest(JSON.stringify({ ...v1(), role })).ok).toBe(false);
    for (const field of ['stateRevision', 'projectionRevision', 'actorVisibilityRevision']) {
      for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
        const expectedRevisions = {
          ...envelope.expectedRevisions,
          [field]: bad,
        };
        expect(
          decodeNpcWorkflowCommandRequest(JSON.stringify({ ...v1(), expectedRevisions })).ok,
        ).toBe(false);
      }
    }
    expect(npcWorkflowCommandRequestValue(v1()).expectedRevisions.projectionRevision).toBe(9);
  });
  it('rejects client identities, missing fields and invalid version/attempt boundaries', () => {
    for (const input of [
      { ...v1(), ownerDeviceId: id(5) },
      {
        ...v1(),
        commandId: id(1).toUpperCase().replace('00000000', 'AAAAAAAA'),
      },
      { ...v1(), payload: { ...v1().payload, expectedAttemptRevision: -1 } },
      { ...open(), payload: { ...open().payload, expectedCurrentVersion: 0 } },
    ])
      expect(decodeNpcWorkflowCommandRequest(JSON.stringify(input)).ok).toBe(false);
    for (const key of Object.keys(v1())) {
      const input: Record<string, unknown> = { ...v1() };
      delete input[key];
      expect(decodeNpcWorkflowCommandRequest(JSON.stringify(input)).ok).toBe(false);
    }
  });
  it('does not run getters or retain mutable request references', () => {
    let reads = 0;
    const input = open();
    Object.defineProperty(input.payload, 'phase', {
      enumerable: true,
      get: () => {
        reads++;
        return 'OPEN';
      },
    });
    expect(() => npcWorkflowCommandRequestValue(input)).toThrow();
    expect(reads).toBe(0);
    const original = commit();
    const parsed = npcWorkflowCommandRequestValue(original);
    original.payload.expectedCurrentVersion = 99;
    expect(parsed.payload).toMatchObject({
      phase: 'COMMIT',
      expectedCurrentVersion: 2,
    });
  });
  it('redacts malicious content in malformed or unrecognized input refusals', () => {
    for (const text of [
      '{"secret":"PRIVATE',
      JSON.stringify({
        ...open(),
        payload: { ...open().payload, phase: 'PRIVATE' },
      }),
    ]) {
      const result = decodeNpcWorkflowCommandRequest(text);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
  });
});

describe('NPC technical selection and draft transport', () => {
  let vocabulary: Awaited<ReturnType<typeof loadProtocolVocabulary>>;
  beforeAll(async () => {
    vocabulary = await loadProtocolVocabulary(fileURLToPath(new URL('../../', import.meta.url)));
  });
  const selection = () => ({
    messageType: 'network.npc-selection.replace',
    protocolVersion: 3,
    operationId: id(11),
    campaignId: id(2),
    expectedRevisions: { ...envelope.expectedRevisions },
    sourceFormId: 'NPC-001',
    npcUuidOrNull: id(4),
  });
  const history = () => {
    const { npcUuidOrNull: _ignored, ...base } = selection();
    return { ...base, sourceFormId: 'NPC-007', npcUuid: id(4), version: 1 };
  };
  const edit = () => {
    const { npcUuidOrNull: _ignored, ...base } = selection();
    return {
      ...base,
      messageType: 'network.npc-editor.replace',
      sourceFormId: 'NPC-002',
      npcDraftId: id(3),
      expectedAttemptRevision: 0,
      values: {
        name: { kind: 'UNSET' },
        description: { kind: 'ENTERED', value: '' },
      },
    };
  };
  it('separates list selection, immutable history selection and uncommitted editor transport', () => {
    for (const value of [selection(), { ...selection(), npcUuidOrNull: null }, history(), edit()]) {
      expect(npcTechnicalRequestValue(value)).toEqual(value);
      expect(decodeNpcTechnicalRequest(JSON.stringify(value))).toEqual({
        ok: true,
        value,
      });
    }
    for (const sourceFormId of NPC_EDITOR_FORMS)
      expect(npcTechnicalRequestValue({ ...edit(), sourceFormId })).toMatchObject({ sourceFormId });
  });
  it('routes all three technical variants through the actual shared V3 encoder and decoder', () => {
    for (const input of [selection(), { ...selection(), npcUuidOrNull: null }, history(), edit()]) {
      const value = npcTechnicalRequestValue(input);
      const encoded = encodeClientMessageV3(value, vocabulary);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) throw new Error('Expected NPC V3 encoding');
      expect(decodeClientMessageV3(encoded.text, vocabulary)).toEqual({
        ok: true,
        value,
      });
      expect(decodeClientMessage(encoded.text, vocabulary).ok).toBe(false);
      expect(decodeClientMessageV2(encoded.text, vocabulary).ok).toBe(false);
    }
  });
  it('keeps the closed NPC grammar and private input redaction at the common V3 ingress', () => {
    const overflow = JSON.stringify({
      ...edit(),
      values: { PRIVATE: 123 },
    }).replace('123', '1e999');
    for (const text of [
      overflow,
      JSON.stringify({ ...edit(), protocolVersion: { PRIVATE: 123 } }).replace('123', '1e999'),
      JSON.stringify({ ...edit(), ownerDeviceId: id(9) }),
      JSON.stringify({ ...history(), npcUuidOrNull: id(4) }),
      JSON.stringify({
        ...selection(),
        messageType: 'network.npc-PRIVATE.replace',
      }),
      JSON.stringify({ ...edit(), protocolVersion: 2 }),
    ]) {
      const result = decodeClientMessageV3(text, vocabulary);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
  });
  it('rejects nested accessors during common V3 encoding without executing them', () => {
    const request = npcTechnicalRequestValue(edit());
    if (request.messageType !== 'network.npc-editor.replace') throw new Error('Expected editor');
    let calls = 0;
    Object.defineProperty(request.values, 'PRIVATE', {
      enumerable: true,
      get() {
        calls++;
        return 'SECRET';
      },
    });
    const result = encodeClientMessageV3(request, vocabulary);
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('rejects an accessor discriminator before invoking generic V3 normalization', () => {
    const request = npcTechnicalRequestValue(edit());
    let calls = 0;
    Object.defineProperty(request, 'messageType', {
      enumerable: true,
      get() {
        calls++;
        return 'network.npc-editor.replace';
      },
    });
    expect(encodeClientMessageV3(request, vocabulary)).toMatchObject({
      ok: false,
      refusal: { code: 'INVALID_SHAPE', path: '$.messageType' },
    });
    expect(calls).toBe(0);
  });
  it('preserves pre-normalization refusal for array accessors, toJSON, hidden fields and non-JSON private values', () => {
    let calls = 0;
    const array: unknown[] = [];
    Object.defineProperty(array, '0', {
      enumerable: true,
      get() {
        calls++;
        return 'SECRET';
      },
    });
    const serializer = {
      toJSON() {
        calls++;
        return {};
      },
    };
    const hidden = {};
    Object.defineProperty(hidden, 'PRIVATE', { value: 1, enumerable: false });
    for (const invalid of [array, serializer, hidden, undefined, Infinity]) {
      const request = npcTechnicalRequestValue(edit());
      if (request.messageType !== 'network.npc-editor.replace') throw new Error('Expected editor');
      Object.defineProperty(request.values, 'PRIVATE', {
        value: { DEEP_PRIVATE: invalid },
        enumerable: true,
      });
      const result = encodeClientMessageV3(request, vocabulary);
      expect(result).toMatchObject({
        ok: false,
        refusal: { code: 'INVALID_SHAPE' },
      });
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(JSON.stringify(result)).not.toContain('SECRET');
    }
    expect(calls).toBe(0);
  });
  it('rejects cross-variant fields and fabricated authority/outcomes', () => {
    for (const value of [
      { ...selection(), version: 1 },
      { ...history(), npcUuidOrNull: id(4) },
      { ...selection(), sourceFormId: 'NPC-003' },
      { ...edit(), sourceFormId: 'NPC-001' },
      { ...edit(), ownerDeviceId: id(99) },
      { ...edit(), gmLocalContextId: id(99) },
      { ...edit(), receiptId: id(99) },
      { ...edit(), currentVersion: 1 },
      { ...edit(), protocolVersion: 1 },
      { ...history(), version: 0 },
      { ...edit(), expectedAttemptRevision: -1 },
      { ...selection(), npcUuidOrNull: undefined },
    ])
      expect(decodeNpcTechnicalRequest(JSON.stringify(value)).ok).toBe(false);
  });
  it('requires every envelope field and all three independent revision integers', () => {
    for (const request of [selection(), history(), edit()])
      for (const key of Object.keys(request)) {
        const value: Record<string, unknown> = { ...request };
        delete value[key];
        expect(() => npcTechnicalRequestValue(value)).toThrow();
      }
    for (const key of Object.keys(envelope.expectedRevisions))
      for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
        const value = {
          ...selection(),
          expectedRevisions: { ...envelope.expectedRevisions, [key]: bad },
        };
        expect(() => npcTechnicalRequestValue(value)).toThrow();
      }
  });
  it('detaches nested input without normalizing entered null, zero or empty sections', () => {
    const request = {
      ...edit(),
      values: { a: null, b: 0, c: [], d: { kind: 'ENTERED', value: '' } },
    };
    const result = npcTechnicalRequestValue(request);
    request.values.d.value = 'changed';
    expect(result).toMatchObject({
      values: { a: null, b: 0, c: [], d: { kind: 'ENTERED', value: '' } },
    });
  });
  it('rejects non JSON values instead of stringify normalization', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    const sparse: unknown[] = [];
    sparse.length = 1;
    const extra: unknown[] = [];
    Object.defineProperty(extra, 'extra', { value: true });
    for (const invalid of [
      undefined,
      NaN,
      Infinity,
      1n,
      new Date(0),
      new Map(),
      () => 0,
      cycle,
      sparse,
      extra,
    ])
      expect(() => npcTechnicalRequestValue({ ...edit(), values: { invalid } })).toThrow();
    for (const values of [null, [], 1, ''])
      expect(() => npcTechnicalRequestValue({ ...edit(), values })).toThrow();
  });
  it('does not execute nested getters, array getters or toJSON', () => {
    let reads = 0;
    const getter = {};
    Object.defineProperty(getter, 'secret', {
      enumerable: true,
      get: () => {
        reads++;
        return 'PRIVATE';
      },
    });
    const arr: unknown[] = [];
    Object.defineProperty(arr, '0', {
      enumerable: true,
      get: () => {
        reads++;
        return 'PRIVATE';
      },
    });
    const serializer = {
      toJSON: () => {
        reads++;
        return {};
      },
    };
    for (const value of [getter, arr, serializer])
      expect(() => npcTechnicalRequestValue({ ...edit(), values: { value } })).toThrow();
    expect(reads).toBe(0);
  });
  it('refuses symbol and non-enumerable fields rather than silently dropping them', () => {
    for (const key of [Symbol('private'), 'private']) {
      const value = {};
      Object.defineProperty(value, key, {
        value: true,
        enumerable: typeof key === 'symbol',
      });
      expect(() => npcTechnicalRequestValue({ ...edit(), values: { value } })).toThrow();
    }
  });
  it('redacts malformed and unknown technical discriminator values', () => {
    for (const text of ['{"PRIVATE', JSON.stringify({ ...selection(), sourceFormId: 'PRIVATE' })]) {
      const result = decodeNpcTechnicalRequest(text);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
  });
  it('never reflects nested field names in refusals, including valid JSON numeric overflow', () => {
    const wire = JSON.stringify({
      ...edit(),
      values: { PRIVATE: { DEEP_PRIVATE: 123 } },
    }).replace('123', '1e999');
    const decoded = decodeNpcTechnicalRequest(wire);
    expect(decoded).toMatchObject({
      ok: false,
      refusal: { code: 'INVALID_SHAPE', path: '$.values' },
    });
    expect(JSON.stringify(decoded)).not.toContain('PRIVATE');
    let getterCalls = 0;
    const getter = {};
    Object.defineProperty(getter, 'PRIVATE', {
      enumerable: true,
      get: () => {
        getterCalls++;
        return 'SECRET';
      },
    });
    for (const invalid of [{ PRIVATE: { DEEP_PRIVATE: undefined } }, { PRIVATE: getter }]) {
      const result = wireCodecPrimitives.parse('null', () =>
        npcTechnicalRequestValue({ ...edit(), values: invalid }),
      );
      expect(result).toMatchObject({
        ok: false,
        refusal: { code: 'INVALID_SHAPE', path: '$.values' },
      });
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(JSON.stringify(result)).not.toContain('SECRET');
    }
    expect(getterCalls).toBe(0);
  });
  it('uses actual Atlas CTA keys and targets while excluding workflow/placement branches', () => {
    const atlas = JSON.parse(
      readFileSync(new URL('../../generated/spec/atlas/forms-by-id.json', import.meta.url), 'utf8'),
    ) as Record<
      string,
      {
        actions: {
          ctaAvailabilityByAction: readonly {
            actionKey: string;
            targetFormId: string;
            kind: string;
          }[];
        };
      }
    >;
    for (const [key, target] of Object.entries(NPC_NAV_TARGETS)) {
      const source = key.split('::')[0];
      expect(source).toBeDefined();
      const action = atlas[source!]?.actions.ctaAvailabilityByAction.find(
        (a) => a.actionKey === key,
      );
      expect(action?.targetFormId).toBe(target);
      expect(action?.kind).not.toBe('workflow-command');
    }
    for (const excluded of [
      'NPC-003::CTA::002',
      'NPC-003::CTA::008',
      'NPC-007::CTA::002',
      'NPC-017::CTA::002',
      'NET-016::CTA::002',
    ])
      expect(Object.hasOwn(NPC_NAV_TARGETS, excluded)).toBe(false);
  });
});

describe('NPC technical host acknowledgement transport', () => {
  let vocabulary: Awaited<ReturnType<typeof loadProtocolVocabulary>>;
  beforeAll(async () => {
    vocabulary = await loadProtocolVocabulary(fileURLToPath(new URL('../../', import.meta.url)));
  });
  const common = () => ({
    protocolVersion: 3,
    operationId: id(80),
    campaignId: id(2),
    projectionRole: 'gm',
  });
  const editResult = () => ({
    ...common(),
    messageType: 'network.npc-editor.result',
    sourceFormId: 'NPC-002',
    npcDraftId: id(3),
    appliedAttemptRevision: 1,
    appliedRevisions: { ...envelope.expectedRevisions },
  });
  const selectionResult = () => ({
    ...common(),
    messageType: 'network.npc-selection.result',
    sourceFormId: 'NPC-001',
    npcUuidOrNull: id(4),
    appliedRevisions: { ...envelope.expectedRevisions },
  });
  const refusal = () => ({
    ...common(),
    messageType: 'network.npc-editor.refusal',
    sourceFormId: 'NPC-016',
    npcDraftId: id(3),
    presentationUnchanged: true,
    refusal: { code: 'UNAVAILABLE' },
  });
  it('roundtrips editor, library, history and refusal replies only through V3', () => {
    const { npcUuidOrNull: _selected, ...history } = selectionResult();
    const { npcDraftId: _draft, ...selectionDenied } = refusal();
    const variants = [
      editResult(),
      selectionResult(),
      { ...selectionResult(), npcUuidOrNull: null },
      { ...history, sourceFormId: 'NPC-007', npcUuid: id(4), version: 2 },
      refusal(),
      {
        ...selectionDenied,
        messageType: 'network.npc-selection.refusal',
        sourceFormId: 'NPC-001',
      },
    ];
    for (const input of variants) {
      const value = npcTechnicalResponseValue(input);
      expect(value).toEqual(input);
      const encoded = encodeHostMessageV3(value, vocabulary);
      if (!encoded.ok) throw new Error('Expected NPC V3 host reply');
      expect(decodeHostMessageV3(encoded.text, vocabulary)).toEqual({
        ok: true,
        value,
      });
      expect(decodeHostMessage(encoded.text, vocabulary).ok).toBe(false);
      expect(decodeHostMessageV2(encoded.text, vocabulary).ok).toBe(false);
      expect(decodeClientMessageV3(encoded.text, vocabulary).ok).toBe(false);
    }
  });
  it('retains independently applied revisions and detaches receipt fields', () => {
    const appliedRevisions: { -readonly [Axis in keyof RevisionVector]: RevisionVector[Axis] } = {
      ...envelope.expectedRevisions,
    };
    const input = { ...editResult(), appliedRevisions };
    const value = npcTechnicalResponseValue(input);
    input.appliedRevisions.stateRevision = 99;
    expect(value).toMatchObject({
      appliedRevisions: {
        stateRevision: 2,
        projectionRevision: 9,
        actorVisibilityRevision: 1,
      },
      appliedAttemptRevision: 1,
    });
    for (const sourceFormId of NPC_EDITOR_FORMS)
      expect(npcTechnicalResponseValue({ ...editResult(), sourceFormId })).toMatchObject({
        sourceFormId,
      });
  });
  it('does not accept private input, a current head, a projection or a saved version on an editor acknowledgement', () => {
    for (const key of [
      'values',
      'ownerDeviceId',
      'currentVersion',
      'snapshot',
      'presentation',
      'revisions',
    ]) {
      const value = { ...editResult(), [key]: { PRIVATE: 1 } };
      const result = decodeHostMessageV3(JSON.stringify(value), vocabulary);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
    for (const key of Object.keys(editResult())) {
      const value: Record<string, unknown> = { ...editResult() };
      delete value[key];
      expect(decodeHostMessageV3(JSON.stringify(value), vocabulary).ok).toBe(false);
    }
  });
  it('refuses role, scope, form, attempt/version and finite revision mismatches', () => {
    for (const value of [
      { ...editResult(), projectionRole: 'player' },
      { ...editResult(), protocolVersion: 2 },
      { ...editResult(), campaignId: 'other' },
      { ...editResult(), operationId: '' },
      { ...editResult(), sourceFormId: 'NPC-001' },
      { ...editResult(), appliedAttemptRevision: 0 },
      { ...editResult(), appliedAttemptRevision: 1.5 },
      {
        ...editResult(),
        appliedRevisions: { ...envelope.expectedRevisions, stateRevision: -1 },
      },
      { ...selectionResult(), sourceFormId: 'NPC-007' },
      { ...selectionResult(), version: 1 },
    ])
      expect(decodeHostMessageV3(JSON.stringify(value), vocabulary).ok).toBe(false);
  });
  it('keeps refusals closed and never reports current private state', () => {
    for (const code of NPC_TECHNICAL_REFUSAL_CODES)
      expect(npcTechnicalResponseValue({ ...refusal(), refusal: { code } })).toMatchObject({
        refusal: { code },
      });
    for (const value of [
      { ...refusal(), refusal: { code: 'PRIVATE' } },
      { ...refusal(), refusal: { code: 'UNAVAILABLE', detail: 'PRIVATE' } },
      { ...refusal(), presentationUnchanged: false },
      { ...refusal(), revisions: envelope.expectedRevisions },
    ]) {
      const result = decodeHostMessageV3(JSON.stringify(value), vocabulary);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
  });
  it('rejects response accessors before common encoder normalization without invoking them', () => {
    let calls = 0;
    for (const field of ['messageType', 'projectionRole'] as const) {
      const value = npcTechnicalResponseValue(editResult());
      Object.defineProperty(value, field, {
        enumerable: true,
        get() {
          calls++;
          return 'PRIVATE';
        },
      });
      expect(encodeHostMessageV3(value, vocabulary).ok).toBe(false);
    }
    const nested = npcTechnicalResponseValue(refusal());
    if (nested.messageType !== 'network.npc-editor.refusal') throw new Error('Expected refusal');
    Object.defineProperty(nested.refusal, 'code', {
      enumerable: true,
      get() {
        calls++;
        return 'PRIVATE';
      },
    });
    expect(encodeHostMessageV3(nested, vocabulary).ok).toBe(false);
    expect(calls).toBe(0);
  });
  it('redacts malformed numeric headers before generic JSON normalization', () => {
    const source = JSON.stringify({
      ...editResult(),
      protocolVersion: { PRIVATE: 123 },
    }).replace('123', '1e999');
    const result = decodeHostMessageV3(source, vocabulary);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
});

describe('NPC016 TRAUMA_RESERVE technical intent', () => {
  const request = {
    messageType: 'network.npc-preparation.request',
    protocolVersion: 3,
    operationId: id(91),
    campaignId: id(2),
    expectedRevisions: envelope.expectedRevisions,
    npcDraftId: id(3),
    expectedAttemptRevision: 4,
    sourceFormId: 'NPC-016',
    preparation: { kind: 'TRAUMA_RESERVE' },
  };
  it('accepts a detached UUID-free preparation payload without a new workflow', () => {
    const actual = npcTechnicalRequestValue(request);
    expect(actual).toEqual(request);
    expect(actual).not.toBe(request);
    expect(decodeNpcTechnicalRequest(JSON.stringify(request))).toEqual({ ok: true, value: actual });
  });
  it.each([
    { traumaInstanceId: id(92) },
    { regionId: 'HEAD' },
    { createdAt: '2026-11-06T00:00:00.000Z' },
    { remainingMinutes: '0.5' },
  ])('refuses client-owned preparation authority %j', (extra) => {
    expect(() =>
      npcTechnicalRequestValue({ ...request, preparation: { ...request.preparation, ...extra } }),
    ).toThrow();
  });
  it('refuses a foreign form and extra workflow phase', () => {
    expect(() => npcTechnicalRequestValue({ ...request, sourceFormId: 'NPC-015' })).toThrow();
    expect(() => npcTechnicalRequestValue({ ...request, phase: 'COMMIT' })).toThrow();
  });
});

describe('NPC013 closed composition preparation intents', () => {
  const base = {
    messageType: 'network.npc-preparation.request',
    protocolVersion: 3,
    operationId: id(93),
    campaignId: id(2),
    expectedRevisions: envelope.expectedRevisions,
    npcDraftId: id(3),
    expectedAttemptRevision: 4,
    sourceFormId: 'NPC-013',
  };
  it.each(['SYMBIONT_RESERVE', 'COMPOSITION_CONFIRM'])(
    'preserves %s as a detached stage echo without client facts',
    (kind) => {
      const request = { ...base, preparation: { kind, values: { kind: 'ENTERED', value: [] } } };
      const read = npcTechnicalRequestValue(request);
      expect(read).toEqual(request);
      expect(read).not.toBe(request);
      request.preparation.values.kind = 'UNSET';
      expect(read).toMatchObject({ preparation: { values: { kind: 'ENTERED', value: [] } } });
      expect(decodeNpcTechnicalRequest(JSON.stringify(read))).toEqual({ ok: true, value: read });
    },
  );
  it.each([
    { kind: 'FREE_SLOT_ROLL', manualFaces: null },
    { kind: 'FREE_SLOT_ROLL', manualFaces: [6] },
    { kind: 'ADVISER_IW_ROLLS', manualFaces: [2, 17] },
    { kind: 'ADVISER_SUPPRESSION_ROLL', manualFaces: [20] },
    { kind: 'ADVISER_SKILLS', selectedSkills: [{ skillKey: 'OBSERVATION', targetBonus: 1 }] },
    { kind: 'GROSS_SKILL_GRANT' },
    { kind: 'TROGR_STAT_CLOSURE' },
  ])('keeps source continuation %j as intent, never a roll receipt', (input) => {
    const request = {
      ...base,
      preparation: { kind: 'COMPOSITION_RESOLVE', capabilityKey: 'offered/current', input },
    };
    expect(npcTechnicalRequestValue(request)).toEqual(request);
    expect(decodeNpcTechnicalRequest(JSON.stringify(request)).ok).toBe(true);
  });
  it.each([
    { kind: 'SYMBIONT_RESERVE', values: { kind: 'UNSET' }, symbiontInstanceId: id(94) },
    { kind: 'COMPOSITION_CONFIRM', values: { kind: 'UNSET' }, factId: id(94) },
    { kind: 'COMPOSITION_CONFIRM', values: { kind: 'UNSET' }, diceModeSnapshot: 'AUTO' },
    {
      kind: 'COMPOSITION_RESOLVE',
      capabilityKey: 'offered/current',
      input: { kind: 'FREE_SLOT_ROLL', manualFaces: [1], permanentStatsBefore: { S: 1 } },
    },
    {
      kind: 'COMPOSITION_RESOLVE',
      capabilityKey: 'offered/current',
      input: {
        kind: 'ADVISER_SKILLS',
        selectedSkills: [{ skillKey: 'X', targetBonus: 1, valid: true }],
      },
    },
    { kind: 'COMPOSITION_RESOLVE', capabilityKey: 'offered/current', input: { kind: 'UNKNOWN' } },
    {
      kind: 'COMPOSITION_RESOLVE',
      capabilityKey: 'offered/current',
      input: { kind: 'GROSS_SKILL_GRANT', skillProof: {} },
    },
  ])('rejects caller outcome/identity or unknown variant %j', (preparation) => {
    expect(() => npcTechnicalRequestValue({ ...base, preparation })).toThrow();
  });
  it('rejects foreign form and nested accessors without entering the getter', () => {
    const input = { kind: 'FREE_SLOT_ROLL', manualFaces: [1] };
    const request = {
      ...base,
      preparation: { kind: 'COMPOSITION_RESOLVE', capabilityKey: 'offered/current', input },
    };
    expect(() => npcTechnicalRequestValue({ ...request, sourceFormId: 'NPC-016' })).toThrow();
    let calls = 0;
    Object.defineProperty(input, 'manualFaces', {
      enumerable: true,
      get() {
        calls++;
        return [1];
      },
    });
    expect(() => npcTechnicalRequestValue(request)).toThrow();
    expect(calls).toBe(0);
  });
});
