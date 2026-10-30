import { describe, expect, it, vi } from 'vitest';
import { decodeNetworkClientMessageV3, NETWORK_WORKFLOW_COMMAND_IDS } from './device-admission.js';
import type {
  NetworkDraftReplaceV3Message,
  NetworkLocalContextResumeV3Message,
  PublicCandidateRef,
} from './device-admission.js';

const SCOPE = '11111111-1111-4111-8111-111111111111';
const CONTEXT = '22222222-2222-4222-9222-222222222222';
const SEAT = '33333333-3333-4333-a333-333333333333';
const CAMPAIGN = '44444444-4444-4444-b444-444444444444';
const SOURCE_V8 = '55555555-5555-8555-8555-555555555555';
const CHECKSUM = 'a1'.repeat(32);
const PRIVATE = 'private-input-must-not-appear';
const zero = { stateRevision: 0, projectionRevision: 0, actorVisibilityRevision: 0 };
const ref: PublicCandidateRef = {
  sourceUuid: SOURCE_V8,
  finalSnapshotVersion: 12,
  metadataRevision: 1,
  candidateSnapshotChecksum: CHECKSUM,
  requestedControllerSeat: SEAT,
};
const common = {
  messageType: 'network.draft.replace',
  protocolVersion: 3,
  draftUpdateId: 'draft-update:1',
  expectedDraftRevision: 0,
  expectedRevisions: zero,
} as const;
const address: NetworkDraftReplaceV3Message = {
  ...common,
  variant: 'ADDRESS',
  scope: { networkScopeId: SCOPE, contextId: CONTEXT, sourceFormId: 'NET-002' },
  values: { addressOrQrPayload: '' },
};
const selected: NetworkDraftReplaceV3Message = {
  ...common,
  variant: 'SELECTION',
  scope: { networkScopeId: SCOPE, contextId: CONTEXT, sourceFormId: 'NET-003' },
  values: { selectedCandidates: [ref] },
};
const single: NetworkDraftReplaceV3Message = {
  ...common,
  variant: 'SINGLE_CANDIDATE',
  scope: { networkScopeId: SCOPE, contextId: CONTEXT, sourceFormId: 'CHR-027' },
  values: { selectedCampaignId: null, requestedControllerSeat: null },
};
const resume: NetworkLocalContextResumeV3Message = {
  messageType: 'network.local-context.resume',
  protocolVersion: 3,
  networkScopeId: SCOPE,
  reconnectRequestId: 'reconnect:1',
  knownRevisions: zero,
  supportedWorkflowCommandIds: [
    'UI-CMD-CONNECTION-OPEN',
    'UI-CMD-DEVICE-REQUEST-SUBMIT',
    'UI-CMD-DEVICE-REQUEST-CANCEL',
  ],
  unacknowledgedCommandIds: ['command:historical', SOURCE_V8],
};
const read = (value: unknown) => decodeNetworkClientMessageV3(JSON.stringify(value));
function refused(value: unknown, path?: string): void {
  const result = read(value);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected decoder refusal');
  if (path !== undefined) expect(result.refusal.path).toBe(path);
  if (result.refusal.code === 'UNRECOGNIZED') expect(result.refusal.value).toBeNull();
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
}
const without = (value: object, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([field]) => field !== key));

describe('local device-admission draft messages (standalone V3)', () => {
  it.each([address, selected, single, resume])(
    'round-trips the closed $messageType shape',
    (input) => {
      expect(read(input)).toEqual({ ok: true, value: input });
    },
  );

  it('keeps only the three existing Atlas workflows, without preliminary GM commands', () => {
    expect(NETWORK_WORKFLOW_COMMAND_IDS).toEqual([
      'UI-CMD-CONNECTION-OPEN',
      'UI-CMD-DEVICE-REQUEST-SUBMIT',
      'UI-CMD-DEVICE-REQUEST-CANCEL',
    ]);
  });

  it.each(['', '127.0.0.1:41234', ' http://192.168.1.2:41234/ ', 'not yet a valid locator'])(
    'preserves address draft text without connecting or claiming parse validity: %j',
    (addressOrQrPayload) => {
      const input = { ...address, values: { addressOrQrPayload } };
      expect(read(input)).toEqual({ ok: true, value: input });
    },
  );

  it.each([0, 1, 2, 3])(
    'accepts %i selected draft candidates on one actual input lane',
    (count) => {
      const input = {
        ...selected,
        values: {
          selectedCandidates: Array.from({ length: count }, (_, index) => ({
            ...ref,
            sourceUuid: `deterministic-character:${String(index)}`,
          })),
        },
      };
      expect(read(input)).toEqual({ ok: true, value: input });
    },
  );

  it('rejects a fourth draft candidate before any submit workflow', () => {
    refused(
      {
        ...selected,
        values: {
          selectedCandidates: Array.from({ length: 4 }, (_, i) => ({
            ...ref,
            sourceUuid: `source:${String(i)}`,
          })),
        },
      },
      '$.values.selectedCandidates',
    );
  });

  it('rejects duplicate source UUID even when its revisions, checksum and lane differ', () => {
    refused(
      {
        ...selected,
        values: {
          selectedCandidates: [
            ref,
            {
              ...ref,
              metadataRevision: 2,
              candidateSnapshotChecksum: 'b2'.repeat(32),
              requestedControllerSeat: CAMPAIGN,
            },
          ],
        },
      },
      '$.values.selectedCandidates',
    );
  });

  it.each([
    { selectedCampaignId: null, requestedControllerSeat: null },
    { selectedCampaignId: CAMPAIGN, requestedControllerSeat: null },
    { selectedCampaignId: null, requestedControllerSeat: SEAT },
    { selectedCampaignId: CAMPAIGN, requestedControllerSeat: SEAT },
  ])('allows unfinished CHR-027 selection without claiming a Continue guard', (values) => {
    const input = { ...single, values };
    expect(read(input)).toEqual({ ok: true, value: input });
  });

  it('retains nonempty source and command identifiers instead of imposing UUIDv4 on history', () => {
    const input = {
      ...selected,
      draftUpdateId: 'legacy-update',
      values: { selectedCandidates: [{ ...ref, sourceUuid: 'legacy-local-final' }] },
    };
    expect(read(input)).toEqual({ ok: true, value: input });
    expect(read(resume)).toEqual({ ok: true, value: resume });
  });

  it.each([Number.MAX_SAFE_INTEGER, 0])(
    'accepts existing nonnegative safe revision/version boundary %i',
    (revision) => {
      const input = {
        ...selected,
        expectedDraftRevision: revision,
        expectedRevisions: {
          stateRevision: revision,
          projectionRevision: revision,
          actorVisibilityRevision: revision,
        },
        values: {
          selectedCandidates: [
            { ...ref, finalSnapshotVersion: revision, metadataRevision: revision },
          ],
        },
      };
      expect(read(input)).toEqual({ ok: true, value: input });
    },
  );

  it('normalizes negative zero like the existing campaign draft codec', () => {
    const source = JSON.stringify(selected)
      .replaceAll('"expectedDraftRevision":0', '"expectedDraftRevision":-0')
      .replaceAll('"stateRevision":0', '"stateRevision":-0')
      .replaceAll('"metadataRevision":1', '"metadataRevision":-0');
    const result = decodeNetworkClientMessageV3(source);
    expect(result.ok).toBe(true);
    if (
      !result.ok ||
      result.value.messageType !== 'network.draft.replace' ||
      result.value.variant !== 'SELECTION'
    )
      throw new Error('Expected selection');
    expect(Object.is(result.value.expectedDraftRevision, -0)).toBe(false);
    expect(Object.is(result.value.expectedRevisions.stateRevision, -0)).toBe(false);
    expect(Object.is(result.value.values.selectedCandidates[0]?.metadataRevision, -0)).toBe(false);
  });

  it.each(['NET-001', 'NET-003', 'NET-017', 'CMP-003', PRIVATE])(
    'rejects ADDRESS with source form %s',
    (sourceFormId) => {
      refused({ ...address, scope: { ...address.scope, sourceFormId } }, '$.scope.sourceFormId');
    },
  );

  it.each([
    { ...selected, scope: address.scope },
    { ...single, scope: selected.scope },
    { ...address, values: single.values },
    { ...selected, values: address.values },
    { ...single, values: selected.values },
    { ...address, variant: 'SECRET' },
    { ...address, variant: PRIVATE },
  ])('rejects crossed variants, scopes and field groups', (value) => refused(value));

  it.each([null, [], 1, false, PRIVATE])('rejects a non-object frame %j', (value) =>
    refused(value),
  );

  it.each([1, 2, 4, '3', null])(
    'rejects an outer version other than numeric 3: %j',
    (protocolVersion) => {
      refused({ ...address, protocolVersion }, '$.protocolVersion');
    },
  );

  it.each([
    'network.draft.result',
    'network.command.delivery',
    'network.unknown',
    'campaign.local-context.resume',
    PRIVATE,
  ])('rejects message type %s', (messageType) => {
    refused({ ...resume, messageType }, '$.messageType');
  });

  it('rejects every missing field at each required draft level', () => {
    for (const key of Object.keys(selected)) refused(without(selected, key));
    for (const key of Object.keys(selected.scope))
      refused({ ...selected, scope: without(selected.scope, key) });
    for (const key of Object.keys(zero))
      refused({ ...selected, expectedRevisions: without(zero, key) });
    for (const key of Object.keys(ref))
      refused({ ...selected, values: { selectedCandidates: [without(ref, key)] } });
    for (const key of Object.keys(single.values))
      refused({ ...single, values: without(single.values, key) });
    refused({ ...address, values: {} });
    refused({ ...selected, values: {} });
  });

  it.each([
    'bytes',
    'name',
    'sourceSnapshotId',
    'exportChecksum',
    'race',
    'mechanics',
    'ownerDeviceId',
    'password',
    'signature',
    'privateKey',
    PRIVATE,
  ])('rejects extra candidate property %s without reflecting its name/value', (key) => {
    refused(
      { ...selected, values: { selectedCandidates: [{ ...ref, [key]: PRIVATE }] } },
      '$.values.selectedCandidates[0]',
    );
  });

  it('rejects extra top-level, scope, revision and values fields without reflecting arbitrary property names', () => {
    refused({ ...address, [PRIVATE]: PRIVATE }, '$');
    refused({ ...address, scope: { ...address.scope, [PRIVATE]: PRIVATE } }, '$.scope');
    refused(
      { ...address, expectedRevisions: { ...zero, [PRIVATE]: PRIVATE } },
      '$.expectedRevisions',
    );
    refused({ ...address, values: { ...address.values, [PRIVATE]: PRIVATE } }, '$.values');
    refused({ ...single, values: { ...single.values, ownerDeviceId: PRIVATE } }, '$.values');
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects JSON property %s without pollution',
    (key) => {
      const parsed: unknown = JSON.parse(
        JSON.stringify(address).replace(
          '"values":{',
          `"${key}":{"polluted":"${PRIVATE}"},"values":{`,
        ),
      );
      refused(parsed, '$');
      expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    },
  );

  it.each(['', null, 1, [], {}])('rejects malformed identifier/reference field %j', (value) => {
    refused({ ...selected, draftUpdateId: value });
    refused({ ...selected, values: { selectedCandidates: [{ ...ref, sourceUuid: value }] } });
    refused({ ...resume, reconnectRequestId: value });
    refused({ ...resume, unacknowledgedCommandIds: [value] });
  });

  it.each([
    '',
    null,
    'not-a-seat',
    SOURCE_V8,
    '33333333-3333-4333-7333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase(),
  ])('rejects noncanonical assigned UUID %j', (value) => {
    refused({ ...address, scope: { ...address.scope, contextId: value } });
    refused({ ...address, scope: { ...address.scope, networkScopeId: value } });
    refused({ ...resume, networkScopeId: value });
    refused({
      ...selected,
      values: { selectedCandidates: [{ ...ref, requestedControllerSeat: value }] },
    });
    if (value !== null) {
      refused({ ...single, values: { selectedCampaignId: value, requestedControllerSeat: null } });
      refused({ ...single, values: { selectedCampaignId: null, requestedControllerSeat: value } });
    }
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, '1', true])(
    'rejects unsafe revision/version %j on every numeric field',
    (value) => {
      refused({ ...selected, expectedDraftRevision: value });
      for (const key of Object.keys(zero)) {
        refused({ ...selected, expectedRevisions: { ...zero, [key]: value } });
        refused({ ...resume, knownRevisions: { ...zero, [key]: value } });
      }
      for (const key of ['finalSnapshotVersion', 'metadataRevision'])
        refused({ ...selected, values: { selectedCandidates: [{ ...ref, [key]: value }] } });
    },
  );

  it('rejects JSON numeric overflow without echoing source text', () => {
    const result = decodeNetworkClientMessageV3(
      JSON.stringify(address).replace('"expectedDraftRevision":0', '"expectedDraftRevision":1e309'),
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('1e309');
  });

  it.each([
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    CHECKSUM.toUpperCase(),
    `sha256:${CHECKSUM}`,
    'g'.repeat(64),
    null,
    PRIVATE,
  ])('rejects noncanonical immutable source checksum %j', (candidateSnapshotChecksum) => {
    refused(
      { ...selected, values: { selectedCandidates: [{ ...ref, candidateSnapshotChecksum }] } },
      '$.values.selectedCandidates[0].candidateSnapshotChecksum',
    );
  });

  it.each([null, {}, 0, PRIVATE])('rejects a non-array selection %j', (selectedCandidates) => {
    refused({ ...selected, values: { selectedCandidates } }, '$.values.selectedCandidates');
  });

  it.each([null, [], 1, PRIVATE])('rejects malformed candidate row %j', (entry) => {
    refused(
      { ...selected, values: { selectedCandidates: [entry] } },
      '$.values.selectedCandidates[0]',
    );
  });

  it.each([null, 1, false, {}, []])(
    'requires ADDRESS value to be string: %j',
    (addressOrQrPayload) => {
      refused({ ...address, values: { addressOrQrPayload } }, '$.values.addressOrQrPayload');
    },
  );

  it('permits empty resume negotiation and rejects duplicate command/capability IDs', () => {
    const empty = { ...resume, supportedWorkflowCommandIds: [], unacknowledgedCommandIds: [] };
    expect(read(empty)).toEqual({ ok: true, value: empty });
    refused({
      ...resume,
      supportedWorkflowCommandIds: ['UI-CMD-CONNECTION-OPEN', 'UI-CMD-CONNECTION-OPEN'],
    });
    refused({ ...resume, unacknowledgedCommandIds: ['one', 'one'] });
  });

  it.each([
    'UI-CMD-ADMISSION-GM-ACCEPT',
    ['UI', 'CMD', 'DEVICE', 'REQUEST', 'ACCEPT', 'TO', 'REVIEW'].join('-'),
    'UI-CMD-CAMPAIGN-CREATE',
    PRIVATE,
  ])('does not negotiate unavailable workflow %s', (id) => {
    refused({ ...resume, supportedWorkflowCommandIds: [id] }, '$.supportedWorkflowCommandIds[0]');
  });

  it('rejects every omitted resume field and any claimed local owner or GM context', () => {
    for (const key of Object.keys(resume)) refused(without(resume, key));
    for (const key of ['ownerDeviceId', 'gmLocalContextId', 'role', 'signature', PRIVATE])
      refused({ ...resume, [key]: PRIVATE }, '$');
    refused({ ...resume, knownRevisions: { ...zero, [PRIVATE]: PRIVATE } }, '$.knownRevisions');
    for (const key of ['supportedWorkflowCommandIds', 'unacknowledgedCommandIds'])
      refused({ ...resume, [key]: PRIVATE });
  });

  it.each(['', '{', `{"messageType":"${PRIVATE}"`, `["${PRIVATE}",]`])(
    'redacts malformed JSON without parser exception text',
    (source) => {
      expect(decodeNetworkClientMessageV3(source)).toEqual({
        ok: false,
        refusal: {
          code: 'MALFORMED_JSON',
          path: '$',
          detail: 'Invalid JSON syntax; input is not reflected',
        },
      });
    },
  );

  it('does not coerce objects or invoke getters passed instead of a JSON string', () => {
    const getter = vi.fn(() => {
      throw new Error(PRIVATE);
    });
    const object = Object.defineProperty({}, 'messageType', { get: getter });
    Object.defineProperty(object, Symbol.toPrimitive, { get: getter });
    for (const value of [object, new String(PRIVATE), null, 1, [], false]) {
      const result = decodeNetworkClientMessageV3(value as unknown as string);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(PRIVATE);
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
