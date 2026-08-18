import type { ActionKey, FormId } from '@generated/types/atlas.js';
import { describe, expect, it } from 'vitest';
import {
  WIRE_PROTOCOL_V2_VERSION,
  decodeClientMessageV2,
  decodeHostMessageV2,
  encodeClientMessageV2,
  encodeHostMessageV2,
} from './index.js';
import type {
  ClientToHostV2Message,
  DecodeRefusal,
  DecodeResult,
  HostToClientV2Message,
  IdentityDraftFieldError,
  IdentityDraftRefusal,
  IdentityDraftRefusalV2Message,
  IdentityDraftReplaceV2Message,
  IdentityDraftResultV2Message,
  IdentityDraftScope,
  IdentityDraftValues,
  RevisionVector,
  WireV2Vocabulary,
} from './index.js';
const revisions = {
  actorVisibilityRevision: 3,
  projectionRevision: 7,
  stateRevision: 5,
} as const satisfies RevisionVector;
const scope = {
  characterDraftId: 'draft-1',
  contextId: 'context-1',
  sourceFormId: 'CHR-001',
  wizardCheckpointId: 'checkpoint-1',
} as const satisfies IdentityDraftScope;
const values = {
  age: 31.5,
  artAssetKeyOrLocalFile: {
    assetKey: 'symbiosis_placeholder_free_female',
    kind: 'asset-key',
  },
  description: 'Описание',
  massKg: 72.5,
  name: 'Имя',
} as const satisfies IdentityDraftValues;
const replace = {
  draftUpdateId: 'update-1',
  expectedDraftRevision: 1,
  expectedRevisions: revisions,
  messageType: 'character.identity-draft.replace',
  protocolVersion: WIRE_PROTOCOL_V2_VERSION,
  scope,
  values,
} as const satisfies IdentityDraftReplaceV2Message;
const result = {
  draftRevision: 2,
  draftUpdateId: replace.draftUpdateId,
  messageType: 'character.identity-draft.result',
  presentation: {
    base: {
      availableActionKeys: ['CHR-001::CTA::001', 'CHR-001::CTA::002'],
      formId: 'CHR-001',
      formType: 'screen',
      roleFilteredPayload: {
        ...values,
        characterDraftId: scope.characterDraftId,
        draftRevision: 2,
        wizardCheckpointId: scope.wizardCheckpointId,
      },
      routeBindings: [
        { parameterIndex: 0, source: 'executor-allocated', value: scope.characterDraftId },
      ],
      routeTemplate: '/player/characters/:localCharacterId/create/chr-001',
    },
    layers: [],
  },
  projectionRole: 'player',
  protocolVersion: WIRE_PROTOCOL_V2_VERSION,
  revisions,
  scope,
} as const satisfies IdentityDraftResultV2Message;
const vocabulary: WireV2Vocabulary = {
  isAddressableRouteTemplate: (_value): _value is never => false,
  isClientRouteBindings: () => false,
  isFormActionKey: (_formId, value): value is ActionKey =>
    value === 'CHR-001::CTA::001' || value === 'CHR-001::CTA::002',
  isFormId: (value): value is FormId => value === 'APP-002' || value === 'CHR-001',
  isPresentedForm: (formId, formType, routeTemplate, bindings) =>
    formType === 'screen' &&
    (formId === 'APP-002' ||
      (formId === 'CHR-001' &&
        routeTemplate === '/player/characters/:localCharacterId/create/chr-001' &&
        bindings.length === 1 &&
        bindings[0]?.parameterIndex === 0 &&
        bindings[0].source === 'executor-allocated')),
  isWorkflowCommandId: (_value): _value is never => false,
};
const unwrap = <T>(decoded: DecodeResult<T>): T => {
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) throw new Error(`unexpected refusal: ${decoded.refusal.code}`);
  return decoded.value;
};
const refuse = <T>(decoded: DecodeResult<T>): DecodeRefusal => {
  expect(decoded.ok).toBe(false);
  if (decoded.ok) throw new Error('expected refusal');
  return decoded.refusal;
};
const refuseClient = (value: unknown): DecodeRefusal =>
  refuse(decodeClientMessageV2(JSON.stringify(value), vocabulary));
const refuseHost = (value: unknown): DecodeRefusal =>
  refuse(decodeHostMessageV2(JSON.stringify(value), vocabulary));
const clientRoundTrip = (message: ClientToHostV2Message): ClientToHostV2Message => {
  const encoded = encodeClientMessageV2(message, vocabulary);
  expect(encoded.ok).toBe(true);
  if (!encoded.ok) throw new Error(`unexpected encode refusal: ${encoded.refusal.code}`);
  return unwrap(decodeClientMessageV2(encoded.text, vocabulary));
};
const hostRoundTrip = (message: HostToClientV2Message): HostToClientV2Message => {
  const encoded = encodeHostMessageV2(message, vocabulary);
  expect(encoded.ok).toBe(true);
  if (!encoded.ok) throw new Error(`unexpected encode refusal: ${encoded.refusal.code}`);
  return unwrap(decodeHostMessageV2(encoded.text, vocabulary));
};
const refusalMessage = (refusal: IdentityDraftRefusal): IdentityDraftRefusalV2Message => ({
  draftUpdateId: replace.draftUpdateId,
  messageType: 'character.identity-draft.refusal',
  presentationUnchanged: true,
  protocolVersion: WIRE_PROTOCOL_V2_VERSION,
  refusal,
  revisions,
  scope,
});
describe('wire v2 identity draft contracts', () => {
  it('round-trips replace and the assignment-free result presentation', () => {
    expect(clientRoundTrip(replace)).toEqual(replace);
    expect(hostRoundTrip(result)).toEqual(result);
    expect(result.presentation).not.toHaveProperty('assignment');
  });
  it.each([
    ['form', { ...result.presentation.base, formId: 'APP-002' }, '$.presentation.base.formId'],
    [
      'route character',
      {
        ...result.presentation.base,
        routeBindings: [{ ...result.presentation.base.routeBindings[0], value: 'draft-2' }],
      },
      '$.presentation.base.routeBindings[0].value',
    ],
    [
      'payload character',
      {
        ...result.presentation.base,
        roleFilteredPayload: {
          ...result.presentation.base.roleFilteredPayload,
          characterDraftId: 'draft-2',
        },
      },
      '$.presentation.base.roleFilteredPayload.characterDraftId',
    ],
    [
      'payload checkpoint',
      {
        ...result.presentation.base,
        roleFilteredPayload: {
          ...result.presentation.base.roleFilteredPayload,
          wizardCheckpointId: 'checkpoint-2',
        },
      },
      '$.presentation.base.roleFilteredPayload.wizardCheckpointId',
    ],
  ] as const)('rejects a result with mismatched %s', (_case, base, path) => {
    expect(refuseHost({ ...result, presentation: { ...result.presentation, base } })).toMatchObject(
      { code: 'UNRECOGNIZED', path },
    );
  });
  it('rejects a result whose payload draftRevision differs from its top level', () => {
    expect(refuseHost({ ...result, draftRevision: 3 })).toMatchObject({
      code: 'UNRECOGNIZED',
      path: '$.presentation.base.roleFilteredPayload.draftRevision',
    });
  });
  it.each([
    null,
    { assetKey: '', kind: 'asset-key' },
    { bytesBase64: '', kind: 'local-file', mediaType: 'image/png' },
    { bytesBase64: 'not-yet-validated', kind: 'local-file', mediaType: 'image/jpeg' },
  ] as const)('leaves application validation of art value %j to the host', (artValue) => {
    const message = {
      ...replace,
      values: {
        age: -12.75,
        artAssetKeyOrLocalFile: artValue,
        description: '',
        massKg: -0.25,
        name: '',
      },
    } as const satisfies IdentityDraftReplaceV2Message;
    expect(clientRoundTrip(message)).toEqual(message);
  });
  it('normalizes every JSON -0 in the decoded request to 0', () => {
    const zeroRequest = {
      ...replace,
      expectedDraftRevision: 0,
      expectedRevisions: {
        actorVisibilityRevision: 0,
        projectionRevision: 0,
        stateRevision: 0,
      },
      values: { ...values, age: 0, massKg: 0 },
    };
    const source = JSON.stringify(zeroRequest).replaceAll(':0', ':-0');
    const decoded = unwrap(decodeClientMessageV2(source, vocabulary));
    if (decoded.messageType !== 'character.identity-draft.replace') {
      throw new Error('unexpected decoded message');
    }
    expect(decoded.expectedDraftRevision).toBe(0);
    expect(Object.values(decoded.expectedRevisions).every((item) => !Object.is(item, -0))).toBe(
      true,
    );
    expect(Object.is(decoded.values.age, -0)).toBe(false);
    expect(Object.is(decoded.values.massKg, -0)).toBe(false);
  });
  it.each([
    ['top-level', { ...replace, extra: true }, '$.extra'],
    ['scope', { ...replace, scope: { ...scope, extra: true } }, '$.scope.extra'],
    ['values', { ...replace, values: { ...values, extra: true } }, '$.values.extra'],
    [
      'art value',
      {
        ...replace,
        values: {
          ...values,
          artAssetKeyOrLocalFile: { ...values.artAssetKeyOrLocalFile, extra: true },
        },
      },
      '$.values.artAssetKeyOrLocalFile.extra',
    ],
  ] as const)('rejects an extra %s field recursively', (_case, message, path) => {
    expect(refuseClient(message)).toMatchObject({ code: 'UNRECOGNIZED', path });
  });
  it('rejects missing values and unknown exact discriminators', () => {
    const { massKg: _omitted, ...missingMass } = values;
    expect(refuseClient({ ...replace, values: missingMass })).toMatchObject({
      code: 'INVALID_SHAPE',
      path: '$.values.massKg',
    });
    expect(
      refuseClient({
        ...replace,
        values: { ...values, artAssetKeyOrLocalFile: { kind: 'future' } },
      }),
    ).toEqual({
      code: 'UNRECOGNIZED',
      path: '$.values.artAssetKeyOrLocalFile.kind',
      value: 'future',
    });
    expect(
      refuseClient({
        ...replace,
        values: {
          ...values,
          artAssetKeyOrLocalFile: {
            bytesBase64: '',
            kind: 'local-file',
            mediaType: 'image/gif',
          },
        },
      }),
    ).toMatchObject({ code: 'UNRECOGNIZED', path: '$.values.artAssetKeyOrLocalFile.mediaType' });
    expect(
      refuseClient({ ...replace, scope: { ...scope, sourceFormId: 'CHR-010' } }),
    ).toMatchObject({ code: 'UNRECOGNIZED', path: '$.scope.sourceFormId' });
    expect(refuseClient({ ...replace, values: { ...values, age: 'old' } })).toMatchObject({
      code: 'INVALID_SHAPE',
      path: '$.values.age',
    });
  });
  it.each([
    'BLANK_AFTER_TRIM',
    'CONTROL_CHARACTER',
    'UNPAIRED_SURROGATE',
    'NO_VISIBLE_GRAPHEME',
    'TOO_LONG',
  ] as const)('round-trips closed name refusal %s', (reason) => {
    const message = refusalMessage({
      code: 'INVALID_FIELD',
      error: { field: 'name', reason },
    });
    expect(hostRoundTrip(message)).toEqual(message);
  });
  it.each([
    ['description', 'EMPTY_NOT_NULL'],
    ['description', 'TOO_LONG'],
    ['artAssetKeyOrLocalFile', 'EMPTY_ASSET_KEY'],
    ['artAssetKeyOrLocalFile', 'ASSET_NOT_FOUND'],
    ['artAssetKeyOrLocalFile', 'NON_CANONICAL_BASE64'],
    ['artAssetKeyOrLocalFile', 'MEDIA_SIGNATURE_MISMATCH'],
    ['artAssetKeyOrLocalFile', 'FILE_TOO_LARGE'],
    ['massKg', 'NOT_POSITIVE'],
    ['massKg', 'STEP_MISMATCH'],
  ] as const)('round-trips closed %s refusal %s', (field, reason) => {
    const error = { field, reason } as IdentityDraftFieldError;
    const message = refusalMessage({ code: 'INVALID_FIELD', error });
    expect(hostRoundTrip(message)).toEqual(message);
  });
  it.each([
    { actual: 3, code: 'STALE_DRAFT', expected: 2 },
    {
      actual: revisions,
      code: 'STALE_REVISION',
      expected: { ...revisions, projectionRevision: 6 },
    },
    { code: 'IDEMPOTENCY_CONFLICT', detail: 'PAYLOAD_MISMATCH' },
    { code: 'DRAFT_UNAVAILABLE' },
    { axis: 'draftRevision', code: 'REVISION_OVERFLOW' },
    { axis: 'projectionRevision', code: 'REVISION_OVERFLOW' },
  ] as const satisfies readonly IdentityDraftRefusal[])('round-trips refusal $code', (refusal) => {
    const message = refusalMessage(refusal);
    expect(hostRoundTrip(message)).toEqual(message);
  });
  it('rejects STALE_REVISION when nested actual differs from top-level revisions', () => {
    const message = refusalMessage({
      actual: { ...revisions, projectionRevision: revisions.projectionRevision + 1 },
      code: 'STALE_REVISION',
      expected: revisions,
    });
    expect(refuseHost(message)).toEqual({
      code: 'UNRECOGNIZED',
      path: '$.refusal.actual.projectionRevision',
      value: revisions.projectionRevision + 1,
    });
  });
  it.each([
    ['field', { code: 'INVALID_FIELD', error: { field: 'age', reason: 'OUT_OF_RANGE' } }],
    ['reason', { code: 'INVALID_FIELD', error: { field: 'name', reason: 'INVALID_NAME' } }],
    ['code', { code: 'UNKNOWN' }],
    ['axis', { axis: 'stateRevision', code: 'REVISION_OVERFLOW' }],
  ] as const)('rejects unknown refusal %s', (_case, refusal) => {
    expect(refuseHost(refusalMessage(refusal as never))).toMatchObject({ code: 'UNRECOGNIZED' });
  });
  it('keeps the three messages directional and recursively exact', () => {
    expect(refuseHost(replace)).toMatchObject({ code: 'UNRECOGNIZED', path: '$.messageType' });
    expect(refuseClient(result)).toMatchObject({ code: 'UNRECOGNIZED', path: '$.messageType' });
    expect(refuseClient(refusalMessage({ code: 'DRAFT_UNAVAILABLE' }))).toMatchObject({
      code: 'UNRECOGNIZED',
      path: '$.messageType',
    });
    expect(
      refuseHost({ ...result, presentation: { ...result.presentation, assignment: {} } }),
    ).toMatchObject({ code: 'UNRECOGNIZED', path: '$.presentation.assignment' });
    expect(refuseHost({ ...result, projectionRole: 'gm' })).toMatchObject({
      code: 'UNRECOGNIZED',
      path: '$.projectionRole',
    });
  });
});
