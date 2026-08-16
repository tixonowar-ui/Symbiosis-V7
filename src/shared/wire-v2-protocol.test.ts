import { FORM_IDS } from '@generated/types/atlas.js';
import type { ActionKey } from '@generated/types/atlas.js';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  WIRE_PROTOCOL_V2_VERSION,
  decodeClientMessage,
  decodeClientMessageV2,
  decodeHostMessage,
  decodeHostMessageV2,
  encodeClientMessageV2,
  encodeHostMessageV2,
} from './index.js';
import type {
  AddressableRouteTemplate,
  AddressableRouteIntentV2Message,
  AddressableRouteRefusalV2Message,
  ClientSelectedRouteBinding,
  ClientToHostV2Message,
  DecodeRefusal,
  DecodeResult,
  FormActionIntentV2Message,
  FormActionRefusalV2Message,
  HostToClientV2Message,
  ProtocolVocabulary,
  ProjectionSnapshotV2Message,
  RevisionVector,
  WireV2Vocabulary,
} from './index.js';
const CHR_ROUTE = '/player/characters/:localCharacterId/create/chr-001';
const ADDRESSABLE_ROUTE =
  '/player/campaigns/:campaignId/network/net-006' as AddressableRouteTemplate;
const actionPairs = new Set([
  'APP-002|APP-002::CTA::007',
  'APP-004|APP-004::CTA::001',
  'CHR-001|CHR-001::CTA::001',
  'CHR-001|CHR-001::CTA::002',
  'PLY-023|PLY-023::CTA::001',
  'SYS-016|SYS-016::CTA::001',
]);
const draftBindings = '[{"parameterIndex":0,"source":"executor-allocated","value":"draft-1"}]';
const assignedPresentations = new Map([
  [`CHR-001|screen|${CHR_ROUTE}`, draftBindings],
  ['PLY-023|overlay|@overlay/ply-023', '[]'],
  ['SYS-016|banner|@banner/sys-016', '[]'],
]);
const formIds = new Set<string>(FORM_IDS);
const vocabulary: WireV2Vocabulary = {
  isAddressableRouteTemplate: (value): value is AddressableRouteTemplate =>
    value === ADDRESSABLE_ROUTE,
  isClientRouteBindings: (routeTemplate, bindings) =>
    routeTemplate === ADDRESSABLE_ROUTE &&
    bindings.length === 1 &&
    bindings[0]?.parameterIndex === 0 &&
    bindings[0].value === 'campaign-1',
  isFormActionKey: (formId, value): value is ActionKey => actionPairs.has(`${formId}|${value}`),
  isFormId: (value): value is (typeof FORM_IDS)[number] => formIds.has(value),
  isPresentedForm: (formId, formType, routeTemplate, bindings) =>
    assignedPresentations.get(`${formId}|${formType}|${routeTemplate}`) ===
    JSON.stringify(bindings),
};
const v1Vocabulary: ProtocolVocabulary = {
  isFormId: (value) => vocabulary.isFormId(value),
  isHostTransition: () => false,
  isWorkflowCommandId: (_value): _value is never => false,
};
const revisions = {
  actorVisibilityRevision: 3,
  projectionRevision: 7,
  stateRevision: 5,
} as const satisfies RevisionVector;
const formAction = {
  actionKey: 'APP-004::CTA::001',
  expectedProjectionRevision: 7,
  messageType: 'navigation.form-action',
  navigationRequestId: 'navigation-1',
  protocolVersion: WIRE_PROTOCOL_V2_VERSION,
  sourceFormId: 'APP-004',
} as const satisfies FormActionIntentV2Message;
const routeIntent = {
  bindings: [{ parameterIndex: 0, source: 'client-selected', value: 'campaign-1' }],
  expectedProjectionRevision: 7,
  messageType: 'navigation.addressable-route',
  navigationRequestId: 'navigation-2',
  protocolVersion: WIRE_PROTOCOL_V2_VERSION,
  routeTemplate: ADDRESSABLE_ROUTE,
} as const satisfies AddressableRouteIntentV2Message;
const snapshot = {
  messageType: 'projection.snapshot',
  presentation: {
    assignment: { correlationId: 'navigation-1', reason: 'FORM_ACTION' },
    base: {
      availableActionKeys: ['CHR-001::CTA::001', 'CHR-001::CTA::002'],
      formId: 'CHR-001',
      formType: 'screen',
      roleFilteredPayload: { characterDraftId: 'draft-1', name: null },
      routeBindings: [{ parameterIndex: 0, source: 'executor-allocated', value: 'draft-1' }],
      routeTemplate: CHR_ROUTE,
    },
    layers: [
      {
        availableActionKeys: ['PLY-023::CTA::001'],
        formId: 'PLY-023',
        formType: 'overlay',
        roleFilteredPayload: { xpEventId: 'xp-1' },
        routeBindings: [],
        routeTemplate: '@overlay/ply-023',
      },
      {
        availableActionKeys: ['SYS-016::CTA::001'],
        formId: 'SYS-016',
        formType: 'banner',
        roleFilteredPayload: { diagnostic: 'offline' },
        routeBindings: [],
        routeTemplate: '@banner/sys-016',
      },
    ],
  },
  projectionRole: 'player',
  protocolVersion: WIRE_PROTOCOL_V2_VERSION,
  revisions,
} as const satisfies ProjectionSnapshotV2Message;
const formRefusal = {
  messageType: 'navigation.form-action.refusal',
  navigationRequestId: 'navigation-1',
  presentationUnchanged: true,
  protocolVersion: WIRE_PROTOCOL_V2_VERSION,
  refusal: { code: 'NAVIGATION_UNAVAILABLE' },
  revisions,
} as const satisfies FormActionRefusalV2Message;
const routeRefusal = {
  ...formRefusal,
  messageType: 'navigation.addressable-route.refusal',
  refusal: { code: 'INVALID_BINDINGS' },
} as const satisfies AddressableRouteRefusalV2Message;
const unwrap = <T>(result: DecodeResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`unexpected refusal: ${result.refusal.code}`);
  return result.value;
};
const refuse = <T>(result: DecodeResult<T>): DecodeRefusal => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected refusal');
  return result.refusal;
};

const refuseClient = (value: unknown): DecodeRefusal =>
  refuse(decodeClientMessageV2(JSON.stringify(value), vocabulary));
const refuseHost = (value: unknown): DecodeRefusal =>
  refuse(decodeHostMessageV2(JSON.stringify(value), vocabulary));
const versionRefusal = (value: number): DecodeRefusal => ({
  code: 'UNRECOGNIZED',
  path: '$.protocolVersion',
  value,
});

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

describe('wire v2 navigation contracts', () => {
  it('imports the exact generated ActionKey and excludes invented and authority fields', () => {
    expectTypeOf<FormActionIntentV2Message['actionKey']>().toEqualTypeOf<ActionKey>();
    // @ts-expect-error A template-shaped key absent from Atlas is not an ActionKey.
    const invented: ActionKey = 'APP-004::CTA::999';
    // @ts-expect-error Signed recovery routes are not validated addressable-route identities.
    const signedRoute: AddressableRouteTemplate = '/resume/:resumeFormId';
    const signed = {
      parameterIndex: 0,
      source: 'client-selected',
      value: 'CHR-001',
      // @ts-expect-error Signed destination fields are not route bindings.
      resumeFormId: 'CHR-001',
    } satisfies ClientSelectedRouteBinding;
    expect([invented, signed.resumeFormId, signedRoute]).toHaveLength(3);
  });

  it('round-trips the exact form-action tuple without a target or trigger', () => {
    expect(clientRoundTrip(formAction)).toEqual(formAction);
  });

  it('round-trips an addressable route with opaque client-selected bindings', () => {
    expect(clientRoundTrip(routeIntent)).toEqual(routeIntent);
  });

  it('rejects a valid ActionKey paired with the wrong source form', () => {
    const wrongPair = { ...formAction, actionKey: 'APP-002::CTA::007' };
    expect(refuseClient(wrongPair)).toEqual({
      code: 'UNRECOGNIZED',
      path: '$.actionKey',
      value: 'APP-002::CTA::007',
    });
  });

  it.each(['label', 'targetFormId', 'route', 'trigger', 'journeyId'])(
    'rejects forbidden form-action field %s in exact decode and encode',
    (field) => {
      const forged = { ...formAction, [field]: 'forbidden' } as unknown as ClientToHostV2Message;
      const expected = { code: 'UNRECOGNIZED', path: `$.${field}`, value: 'forbidden' };
      expect(refuseClient(forged)).toEqual(expected);
      expect(encodeClientMessageV2(forged, vocabulary)).toEqual({ ok: false, refusal: expected });
    },
  );

  it('rejects a missing required action key and an unknown route template', () => {
    const { actionKey: _omitted, ...missing } = formAction;
    expect(refuseClient(missing)).toMatchObject({
      code: 'INVALID_SHAPE',
      path: '$.actionKey',
    });
    expect(refuseClient({ ...routeIntent, routeTemplate: '/resume/:resumeFormId' })).toEqual({
      code: 'UNRECOGNIZED',
      path: '$.routeTemplate',
      value: '/resume/:resumeFormId',
    });
  });

  it.each(['resumeFormId', 'returnFormId', 'originFormId'])(
    'rejects signed destination field %s inside a client binding',
    (field) => {
      const bindings = [{ ...routeIntent.bindings[0], [field]: 'CHR-001' }];
      const value = { ...routeIntent, bindings };
      expect(refuseClient(value)).toEqual({
        code: 'UNRECOGNIZED',
        path: `$.bindings[0].${field}`,
        value: 'CHR-001',
      });
    },
  );

  const binding = routeIntent.bindings[0];
  it.each([
    ['missing', [], '$.bindings'],
    ['unknown', [{ ...binding, parameterIndex: 1 }], '$.bindings'],
    ['extra', [...routeIntent.bindings, { ...binding, parameterIndex: 1 }], '$.bindings'],
    ['outside-domain', [{ ...binding, value: 'campaign-2' }], '$.bindings'],
    ['wrong-source', [{ ...binding, source: 'inherited' }], '$.bindings[0].source'],
  ] as const)('rejects %s route bindings', (_case, bindings, path) => {
    const refusal = refuseClient({ ...routeIntent, bindings });
    expect(refusal).toMatchObject({ code: 'UNRECOGNIZED', path });
  });

  it('round-trips base plus ordered layers and removes a layer without changing base', () => {
    const decoded = hostRoundTrip(snapshot) as ProjectionSnapshotV2Message;
    expect(decoded.presentation.layers.map((item) => item.formId)).toEqual(['PLY-023', 'SYS-016']);
    const withoutBanner = {
      ...snapshot,
      presentation: { ...snapshot.presentation, layers: snapshot.presentation.layers.slice(0, 1) },
    } satisfies ProjectionSnapshotV2Message;
    const reduced = hostRoundTrip(withoutBanner) as ProjectionSnapshotV2Message;
    expect(reduced.presentation.base).toEqual(decoded.presentation.base);
    expect(reduced.presentation.layers).toHaveLength(1);
  });

  it.each([
    'FORM_ACTION',
    'ADDRESSABLE_ROUTE',
    'HOST_SYSTEM_EVENT',
    'COMMAND_DESTINATION',
    'RECONNECT',
  ] as const)('round-trips snapshot assignment reason %s with correlation', (reason) => {
    const value = {
      ...snapshot,
      presentation: {
        ...snapshot.presentation,
        assignment: { correlationId: `correlation-${reason}`, reason },
      },
    } satisfies ProjectionSnapshotV2Message;
    expect((hostRoundTrip(value) as ProjectionSnapshotV2Message).presentation.assignment).toEqual(
      value.presentation.assignment,
    );
  });

  const base = snapshot.presentation.base;
  const layer = snapshot.presentation.layers[0];
  const assigned = base.routeBindings[0];
  const basePath = '$.presentation.base';
  const layerPath = '$.presentation.layers[0]';
  const present = (
    nextBase: unknown,
    layers: readonly unknown[] = snapshot.presentation.layers,
  ) => ({
    ...snapshot,
    presentation: { ...snapshot.presentation, base: nextBase, layers },
  });
  const bind = (routeBindings: unknown) => present({ ...base, routeBindings });
  it.each([
    ['screen-layer', present(base, [{ ...base, formType: 'overlay' }]), layerPath],
    ['layer-base', present({ ...layer, formType: 'screen' }), basePath],
    ['missing-binding', bind([]), basePath],
    ['binding-source', bind([{ ...assigned, source: 'inherited' }]), basePath],
    ['binding-index', bind([{ ...assigned, parameterIndex: 1 }]), basePath],
    ['binding-value', bind([{ ...assigned, value: 'other' }]), basePath],
  ] as const)('rejects invalid presented tuple %s', (_case, value, path) => {
    expect(refuseHost(value)).toMatchObject({ code: 'UNRECOGNIZED', path });
  });

  it('round-trips distinct typed refusals without target or presentation payload', () => {
    for (const refusal of [formRefusal, routeRefusal]) {
      const roundTripped = hostRoundTrip(refusal);
      expect(roundTripped).toEqual(refusal);
      expect(JSON.stringify(roundTripped)).not.toMatch(
        /target|routeTemplate|presentation(?!Unchanged)/u,
      );
    }
  });

  it.each([
    ['$.targetFormId', { ...formRefusal, targetFormId: 'CHR-001' }],
    [
      '$.refusal.targetFormId',
      { ...formRefusal, refusal: { ...formRefusal.refusal, targetFormId: 'CHR-001' } },
    ],
  ] as const)('rejects forbidden target data at %s', (path, value) => {
    expect(refuseHost(value)).toMatchObject({ code: 'UNRECOGNIZED', path });
  });

  it('rejects version mismatch in both v1 and v2 directions', () => {
    expect(refuse(decodeClientMessage(JSON.stringify(formAction), v1Vocabulary))).toEqual(
      versionRefusal(2),
    );
    expect(refuse(decodeHostMessage(JSON.stringify(snapshot), v1Vocabulary))).toEqual(
      versionRefusal(2),
    );
    expect(refuseClient({ ...formAction, protocolVersion: 1 })).toEqual(versionRefusal(1));
    expect(refuseHost({ ...snapshot, protocolVersion: 1 })).toEqual(versionRefusal(1));
    expect(refuseClient({ ...formAction, protocolVersion: 3 })).toEqual(versionRefusal(3));
  });

  it.each(['command.request', 'read.request', 'projection.reconnect'])(
    'does not disguise navigation as v1 message type %s under protocol v2',
    (messageType) => {
      expect(refuseClient({ messageType, protocolVersion: WIRE_PROTOCOL_V2_VERSION })).toEqual({
        code: 'UNRECOGNIZED',
        path: '$.messageType',
        value: messageType,
      });
    },
  );
});
