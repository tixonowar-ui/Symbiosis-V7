import { describe, expect, it } from 'vitest';
import type { ActionKey, FormId } from '@generated/types/atlas.js';
import {
  decodeClientMessage,
  decodeClientMessageV2,
  decodeClientMessageV3,
  decodeHostMessageV3,
  encodeClientMessageV3,
  encodeHostMessageV3,
} from './index.js';
import type {
  CampaignDraftReplaceV3Message,
  CampaignDraftResultV3Message,
  CampaignLocalContextResumeV3Message,
} from './campaign-creation.js';
import type { JsonObject, ProtocolVocabulary, WireV3Vocabulary } from './index.js';

const CONTEXT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  DRAFT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const next = { stateRevision: 1, projectionRevision: 1, actorVisibilityRevision: 0 };
const scope = {
  gmLocalContextId: CONTEXT,
  campaignDraftId: DRAFT,
  sourceFormId: 'CMP-001',
} as const;
const common = {
  messageType: 'campaign.draft.replace',
  protocolVersion: 3,
  draftUpdateId: 'draft-update',
  expectedDraftRevision: 0,
  expectedRevisions: zero,
} as const;
const variants: readonly CampaignDraftReplaceV3Message[] = [
  {
    ...common,
    scope,
    variant: 'METADATA',
    values: { title: 'Кампания', description: null, art: null },
  },
  {
    ...common,
    scope: { ...scope, sourceFormId: 'CMP-002' },
    variant: 'HOST',
    values: {
      activePlayerCapacity: 3,
      hostAddress: '127.0.0.1',
      hostPort: 41337,
      networkInterface: 'Loopback',
    },
  },
  {
    ...common,
    scope: { ...scope, sourceFormId: 'CMP-003' },
    variant: 'SECRET',
    values: {
      masterTransferPassword: 'secret-fixture-170',
      masterTransferPasswordConfirmation: 'secret-fixture-170',
    },
  },
  {
    ...common,
    scope: { ...scope, sourceFormId: 'CMP-004' },
    variant: 'MODE',
    values: { defaultFutureRollMode: 'AUTO' },
  },
];
const resume: CampaignLocalContextResumeV3Message = {
  messageType: 'campaign.local-context.resume',
  protocolVersion: 3,
  gmLocalContextId: CONTEXT,
  reconnectRequestId: 'resume',
  knownRevisions: zero,
  supportedWorkflowCommandIds: ['UI-CMD-CAMPAIGN-CREATE'],
  unacknowledgedCommandIds: [],
};
const ids = ['CMP-001', 'CMP-002', 'CMP-003', 'CMP-004', 'CMP-005'] as const;
const vocabulary: ProtocolVocabulary & WireV3Vocabulary = {
  isHostTransition: () => false,
  isAddressableRouteTemplate: (_value): _value is never => false,
  isClientRouteBindings: () => false,
  isFormActionKey: (form, value): value is ActionKey =>
    value === `${form}::CTA::001` || value === `${form}::CTA::002`,
  isFormId: (value): value is FormId => (ids as readonly string[]).includes(value),
  isPresentedForm: (formId, formType, route, bindings) =>
    formType === 'screen' &&
    route === `/master/campaigns/:campaignId/campaign/${formId.toLowerCase()}` &&
    bindings.length === 1 &&
    bindings[0]?.source === 'inherited' &&
    bindings[0].parameterIndex === 0 &&
    bindings[0].value === `draft:${DRAFT}`,
  isWorkflowCommandId: (value): value is 'UI-CMD-CAMPAIGN-CREATE' =>
    value === 'UI-CMD-CAMPAIGN-CREATE',
};
const result: CampaignDraftResultV3Message = {
  messageType: 'campaign.draft.result',
  protocolVersion: 3,
  draftUpdateId: 'draft-update',
  scope,
  changed: true,
  appliedDraftRevision: 1,
  appliedRevisions: next,
  draftRevision: 1,
  revisions: next,
  projectionRole: 'gm',
  presentation: {
    base: {
      formId: 'CMP-001',
      formType: 'screen',
      routeTemplate: '/master/campaigns/:campaignId/campaign/cmp-001',
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: `draft:${DRAFT}` }],
      availableActionKeys: ['CMP-001::CTA::001', 'CMP-001::CTA::002'],
      roleFilteredPayload: {
        gmLocalContextId: CONTEXT,
        campaignDraftId: DRAFT,
        draftRevision: 1,
        title: 'Кампания',
      },
    },
    layers: [],
  },
};
const decodeClient = (value: unknown) => decodeClientMessageV3(JSON.stringify(value), vocabulary);
const decodeHost = (value: unknown) => decodeHostMessageV3(JSON.stringify(value), vocabulary);

describe('closed campaign wire v3 contract', () => {
  it.each(variants)('round-trips the $variant write with its exact source scope', (value) => {
    const encoded = encodeClientMessageV3(value, vocabulary);
    expect(encoded.ok).toBe(true);
    if (encoded.ok)
      expect(decodeClientMessageV3(encoded.text, vocabulary)).toEqual({ ok: true, value });
  });
  it('round-trips the separate local GM resume without pretending a ticket is a device ID', () => {
    const encoded = encodeClientMessageV3(resume, vocabulary);
    expect(encoded.ok).toBe(true);
    if (encoded.ok)
      expect(decodeClientMessageV3(encoded.text, vocabulary)).toEqual({ ok: true, value: resume });
    for (const extra of [{ deviceId: CONTEXT }, { role: 'gm' }, { ownerDeviceId: CONTEXT }])
      expect(decodeClient({ ...resume, ...extra }).ok).toBe(false);
    expect(decodeClient({ ...resume, unacknowledgedCommandIds: ['one', 'one'] }).ok).toBe(false);
    expect(
      decodeClient({
        ...resume,
        supportedWorkflowCommandIds: ['UI-CMD-CAMPAIGN-CREATE', 'UI-CMD-CAMPAIGN-CREATE'],
      }).ok,
    ).toBe(false);
  });
  it.each(variants)(
    'rejects missing, extra and cross-form $variant keys without reflecting raw input',
    (value) => {
      const secret = 'raw-secret-not-for-diagnostics';
      const malformed = [
        { ...value, unknownField: secret },
        { ...value, scope: { ...value.scope, owner: secret } },
        { ...value, values: { ...value.values, secret } },
        { ...value, variant: 'UNRECOGNIZED-' + secret },
        { ...value, scope: { ...value.scope, sourceFormId: 'CMP-005' } },
        { ...value, values: {} },
        { ...value, expectedRevisions: { ...zero, stateRevision: -1 } },
        { ...value, expectedDraftRevision: Number.MAX_SAFE_INTEGER + 1 },
      ];
      for (const candidate of malformed) {
        const decoded = decodeClient(candidate);
        expect(decoded.ok).toBe(false);
        expect(JSON.stringify(decoded)).not.toContain(secret);
      }
      const other = value.variant === 'METADATA' ? 'CMP-002' : 'CMP-001';
      expect(decodeClient({ ...value, scope: { ...value.scope, sourceFormId: other } }).ok).toBe(
        false,
      );
    },
  );
  it('keeps raw Unicode secret writes exact while rejecting non-string or extra values', () => {
    const request = variants[2]!;
    const value = '  e\u0301😀 fixture  ';
    const exact = {
      ...request,
      values: { masterTransferPassword: value, masterTransferPasswordConfirmation: value },
    };
    expect(decodeClient(exact)).toEqual({ ok: true, value: exact });
    expect(
      decodeClient({
        ...request,
        values: { masterTransferPassword: { value }, masterTransferPasswordConfirmation: value },
      }).ok,
    ).toBe(false);
    expect(
      decodeClient({
        ...request,
        values: {
          masterTransferPassword: value,
          masterTransferPasswordConfirmation: value,
          verifierBase64: value,
        },
      }).ok,
    ).toBe(false);
  });
  it('round-trips immutable event facts plus a later signed current draft view', () => {
    const encoded = encodeHostMessageV3(result, vocabulary);
    expect(encoded.ok).toBe(true);
    if (encoded.ok)
      expect(decodeHostMessageV3(encoded.text, vocabulary)).toEqual({ ok: true, value: result });
    const late = {
      ...result,
      draftRevision: 4,
      revisions: { ...zero, stateRevision: 4, projectionRevision: 9 },
      presentation: {
        ...result.presentation,
        base: {
          ...result.presentation.base,
          roleFilteredPayload: {
            ...result.presentation.base.roleFilteredPayload,
            draftRevision: 4,
          },
        },
      },
    };
    expect(decodeHost(late)).toEqual({ ok: true, value: late });
    expect(
      decodeHost({ ...result, changed: false, appliedDraftRevision: 0, appliedRevisions: zero }).ok,
    ).toBe(true);
  });
  it('rejects inconsistent revision ownership, wrong scope, routes, roles, layers and unknown fields', () => {
    const malformed = [
      { ...result, draftRevision: 0 },
      { ...result, revisions: { ...next, stateRevision: 2 } },
      { ...result, appliedRevisions: { ...next, projectionRevision: 0 } },
      { ...result, revisions: { ...next, actorVisibilityRevision: 1 } },
      { ...result, projectionRole: 'player' },
      { ...result, changed: 'yes' },
      { ...result, rawInput: 'private' },
      { ...result, presentation: { ...result.presentation, layers: [result.presentation.base] } },
      {
        ...result,
        presentation: {
          ...result.presentation,
          base: {
            ...result.presentation.base,
            routeBindings: [{ parameterIndex: 0, source: 'inherited', value: DRAFT }],
          },
        },
      },
      {
        ...result,
        presentation: {
          ...result.presentation,
          base: {
            ...result.presentation.base,
            roleFilteredPayload: {
              ...result.presentation.base.roleFilteredPayload,
              gmLocalContextId: 'other',
            },
          },
        },
      },
    ];
    for (const value of malformed) expect(decodeHost(value).ok).toBe(false);
  });
  it.each([
    'masterTransferPassword',
    'masterTransferPasswordConfirmation',
    'masterSecretVerifier',
    'saltBase64',
    'verifierBase64',
  ])('rejects nested private %s on the read side', (key) => {
    const payload: JsonObject = {
      ...result.presentation.base.roleFilteredPayload,
      nested: [{ [key]: 'private-sentinel' }],
    };
    const value = {
      ...result,
      presentation: {
        ...result.presentation,
        base: { ...result.presentation.base, roleFilteredPayload: payload },
      },
    };
    const decoded = decodeHost(value);
    expect(decoded.ok).toBe(false);
    expect(JSON.stringify(decoded)).not.toContain('private-sentinel');
  });
  it('accepts only closed public refusals and binds stale-vector actual to the envelope', () => {
    const refusal = {
      messageType: 'campaign.draft.refusal',
      protocolVersion: 3,
      draftUpdateId: 'draft-update',
      scope,
      revisions: next,
      presentationUnchanged: true,
      refusal: {
        code: 'INVALID_FIELD',
        error: { field: 'masterTransferPassword', reason: 'INVALID_LENGTH' },
      },
    };
    expect(decodeHost(refusal).ok).toBe(true);
    expect(
      decodeHost({
        ...refusal,
        refusal: {
          code: 'INVALID_FIELD',
          error: { field: 'masterTransferPassword', reason: 'INVALID_LENGTH', value: 'private' },
        },
      }).ok,
    ).toBe(false);
    expect(decodeHost({ ...refusal, refusal: { code: 'INVALID_VERIFIER' } }).ok).toBe(false);
    expect(
      decodeHost({ ...refusal, refusal: { code: 'STALE_REVISION', expected: zero, actual: zero } })
        .ok,
    ).toBe(false);
    expect(
      decodeHost({ ...refusal, refusal: { code: 'STALE_REVISION', expected: zero, actual: next } })
        .ok,
    ).toBe(true);
  });
  it('redacts malformed JSON in every outer-version parser and unknown campaign variants', () => {
    const secret = 'malformed-secret-sentinel';
    for (const decode of [decodeClientMessage, decodeClientMessageV2, decodeClientMessageV3]) {
      const failed = decode(
        `{"protocolVersion":3,"masterTransferPassword":"${secret}",`,
        vocabulary,
      );
      expect(failed.ok).toBe(false);
      expect(JSON.stringify(failed)).not.toContain(secret);
    }
    const failed = decodeClient({ messageType: `campaign.${secret}`, protocolVersion: 3 });
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain(secret);
  });
});

describe('GM request-review capabilities on the existing campaign resume envelope', () => {
  it('carries CREATE and the two preliminary GM IDs without adding a player seat or changing protocol', () => {
    const value: CampaignLocalContextResumeV3Message = {
      ...resume,
      supportedWorkflowCommandIds: [
        'UI-CMD-CAMPAIGN-CREATE',
        'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
        'UI-CMD-DEVICE-REQUEST-REJECT',
      ],
      unacknowledgedCommandIds: ['original:create', 'original:decision'],
    };
    expect(decodeClient(value)).toEqual({ ok: true, value });
    expect(encodeClientMessageV3(value, vocabulary).ok).toBe(true);
    // Capability advertisement is forward-compatible; runtime still intersects implemented family guards.
    expect(
      decodeClient({
        ...value,
        supportedWorkflowCommandIds: [
          ...value.supportedWorkflowCommandIds,
          ['UI', 'CMD', 'FUTURE', 'GM'].join('-'),
        ],
      }).ok,
    ).toBe(true);
    for (const change of [
      {
        supportedWorkflowCommandIds: [
          ...value.supportedWorkflowCommandIds,
          value.supportedWorkflowCommandIds[1],
        ],
      },
      { supportedWorkflowCommandIds: ['UI-CMD-lowercase'] },
      { unacknowledgedCommandIds: ['same', 'same'] },
      { networkScopeId: CONTEXT },
      { controllerSeat: CONTEXT },
      { sourceFormId: 'NET-017' },
      { protocolVersion: 2 },
    ])
      expect(decodeClient({ ...value, ...change }).ok).toBe(false);
  });
});
