import { beforeAll, describe, expect, it } from 'vitest';

import { loadProtocolVocabulary } from '../host/protocol-vocabulary.js';
import {
  npcTechnicalRequestValue,
  decodeNpcTechnicalRequest,
  npcLifeStateRollRequestInputValue,
  npcLifeStateSetRequestInputValue,
  type NpcPreparationRequest,
  NPC_WEAVER_STATE_BRANCHES,
} from './npc-command.js';
import { decodeClientMessageV3, encodeClientMessageV3 } from './wire-v3-codec.js';
import { decodeClientMessage } from './wire-codec.js';
import { decodeClientMessageV2 } from './wire-v2-codec.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const reserve = (): NpcPreparationRequest => ({
  messageType: 'network.npc-preparation.request',
  protocolVersion: 3,
  operationId: id(1),
  campaignId: id(2),
  npcDraftId: id(3),
  expectedAttemptRevision: 4,
  expectedRevisions: { stateRevision: 2, projectionRevision: 7, actorVisibilityRevision: 1 },
  sourceFormId: 'NPC-015',
  preparation: { kind: 'ITEM_RESERVE', values: { kind: 'ENTERED', value: [] } },
});
const upload = (): NpcPreparationRequest => ({
  ...reserve(),
  sourceFormId: 'NPC-002',
  preparation: {
    kind: 'ART_UPLOAD',
    file: {
      kind: 'local-file',
      mediaType: 'image/png',
      bytesBase64: 'actual-host-validator-checks-bytes',
    },
  },
});
describe('NPC016 explicit life preparation wire boundary', () => {
  const roll = {
    capabilityKey: 'life-current',
    reason: 'Текущее тяжёлое ранение',
    manualFaceOrNull: null,
  };
  const set = {
    capabilityKey: 'life-current',
    reason: 'Текущее тяжёлое ранение',
    lifeKind: 'SEVERELY_WOUNDED' as const,
    remainingMinutesOrNull: '0.125',
  };
  it.each([null, 1, 6])(
    'keeps actual roll intent face %s without choosing the host mode',
    (face) => {
      const input = { ...roll, manualFaceOrNull: face };
      expect(npcLifeStateRollRequestInputValue(input)).toEqual(input);
      const request = {
        ...reserve(),
        sourceFormId: 'NPC-016',
        preparation: { kind: 'LIFE_STATE_ROLL', input },
      };
      expect(npcTechnicalRequestValue(request)).toEqual(request);
      expect(() => npcTechnicalRequestValue({ ...request, sourceFormId: 'NPC-015' })).toThrow();
    },
  );
  it.each([0, 7, 1.5, '3', undefined])('refuses invented/manual invalid face %s', (face) => {
    expect(() => npcLifeStateRollRequestInputValue({ ...roll, manualFaceOrNull: face })).toThrow();
  });
  it('preserves exact remainder and explicit retained/untimed null without accepting client provenance', () => {
    for (const input of [
      set,
      { ...set, remainingMinutesOrNull: null },
      { ...set, lifeKind: 'DEAD' as const, remainingMinutesOrNull: null },
      { ...set, lifeKind: 'ALIVE' as const, remainingMinutesOrNull: null },
    ]) {
      expect(npcLifeStateSetRequestInputValue(input)).toEqual(input);
      expect(
        npcTechnicalRequestValue({
          ...reserve(),
          sourceFormId: 'NPC-016',
          preparation: { kind: 'LIFE_STATE_SET', input },
        }),
      ).toMatchObject({ preparation: { kind: 'LIFE_STATE_SET', input } });
    }
    for (const added of [
      { duplicateMultiplier: 4 },
      { rollFact: { rawFace: 6 } },
      { effectInstanceId: id(88) },
      { campaignTimestamp: 2707 },
      { retained: true },
    ]) {
      expect(() => npcLifeStateSetRequestInputValue({ ...set, ...added })).toThrow();
      expect(() => npcLifeStateRollRequestInputValue({ ...roll, ...added })).toThrow();
    }
  });
  it.each(['', '0', '01', '1.0', '1e1', '5\n', '-1'])(
    'rejects noncanonical remaining %s',
    (remainingMinutesOrNull) => {
      expect(() => npcLifeStateSetRequestInputValue({ ...set, remainingMinutesOrNull })).toThrow();
    },
  );
  it('requires explicit life choice/reason and no timer fields on ALIVE/DEAD', () => {
    for (const input of [
      { ...set, lifeKind: 'UNSET' },
      { ...set, reason: '' },
      { ...set, lifeKind: 'ALIVE' },
      { ...set, lifeKind: 'DEAD' },
    ])
      expect(() => npcLifeStateSetRequestInputValue(input)).toThrow();
  });
});
describe('NPC closed preparation transport', () => {
  let vocabulary: Awaited<ReturnType<typeof loadProtocolVocabulary>>;
  beforeAll(async () => {
    vocabulary = await loadProtocolVocabulary(process.cwd());
  });
  it.each([
    reserve(),
    {
      ...reserve(),
      sourceFormId: 'NPC-015',
      preparation: {
        kind: 'ITEM_RESTORE',
        capabilityKey: 'current-history',
        itemInstanceId: id(51),
        values: { kind: 'ENTERED', value: [] },
      },
    } as const,
    {
      ...reserve(),
      sourceFormId: 'NPC-015',
      preparation: { kind: 'CUSTOM_ITEM_RESERVE', values: { kind: 'ENTERED', value: [] } },
    } as const,
    {
      ...reserve(),
      sourceFormId: 'NPC-015',
      preparation: {
        kind: 'CUSTOM_MODIFIER_RESERVE',
        itemInstanceId: id(7),
        values: { kind: 'ENTERED', value: [] },
      },
    } as const,
    {
      ...reserve(),
      sourceFormId: 'NPC-015',
      preparation: {
        kind: 'CUSTOM_PROFILE_VERSION_RESERVE',
        itemInstanceId: id(7),
        profileId: id(8),
        expectedProfileVersionId: id(9),
        values: { kind: 'ENTERED', value: [] },
      },
    } as const,
    ...(['ITM-WPN-026', 'ITM-WPN-027'] as const).map((itemTypeId) => ({
      ...reserve(),
      sourceFormId: 'NPC-015' as const,
      preparation: { kind: 'COMPOSITE_ITEM_RESERVE' as const, input: { itemTypeId } },
    })),
    {
      ...reserve(),
      sourceFormId: 'NPC-015',
      preparation: {
        kind: 'EQUIPMENT_COMPATIBILITY_CONFIRM',
        input: { capabilityKey: 'current-equipment', reason: 'Explicit GM confirmation' },
      },
    } as const,
    {
      ...reserve(),
      sourceFormId: 'NPC-016',
      preparation: { kind: 'DISEASE_RESERVE', diseaseId: 'DIS-PNEUMONIA' },
    } as const,
    upload(),
    ...([null, 3] as const).map((manualFaceOrNull) => ({
      ...reserve(),
      sourceFormId: 'NPC-016' as const,
      preparation: {
        kind: 'LIFE_STATE_ROLL' as const,
        input: { capabilityKey: 'actual-life', reason: 'Current state', manualFaceOrNull },
      },
    })),
    ...(['ALIVE', 'DEAD', 'SEVERELY_WOUNDED'] as const).map((lifeKind) => ({
      ...reserve(),
      sourceFormId: 'NPC-016' as const,
      preparation: {
        kind: 'LIFE_STATE_SET' as const,
        input: {
          capabilityKey: 'actual-life',
          lifeKind,
          reason: 'Current state',
          remainingMinutesOrNull: lifeKind === 'SEVERELY_WOUNDED' ? '0.125' : null,
        },
      },
    })),
    ...NPC_WEAVER_STATE_BRANCHES.map((branch) => ({
      ...reserve(),
      sourceFormId: 'NPC-016' as const,
      preparation: {
        kind: 'WEAVER_STATE_PREPARE' as const,
        input: {
          capabilityKey: 'actual-weaver',
          sourceInstanceId: id(50),
          branch,
          remainingMinutes: '0.125',
          reason: 'Formal current state',
        },
      },
    })),
    {
      ...reserve(),
      sourceFormId: 'NPC-016',
      preparation: {
        kind: 'WEAVER_STATE_REMOVE',
        input: {
          capabilityKey: 'actual-weaver-removal',
          effectInstanceId: id(51),
          reason: 'Explicit removal',
        },
      },
    } as const,
    { ...upload(), sourceFormId: 'NPC-002', preparation: { kind: 'ART_CLEAR' } } as const,
    {
      ...reserve(),
      sourceFormId: 'NPC-016',
      preparation: { kind: 'ALCOHOL_PREPARE', input: { reason: 'Initial state assignment' } },
    } as const,
    {
      ...reserve(),
      sourceFormId: 'NPC-016',
      preparation: {
        kind: 'HP_MODE_PREPARE',
        input: {
          capabilityKey: 'actual-source',
          remainingMinutes: '0.5',
          reason: 'Current active mode',
        },
      },
    } as const,
    ...(['SLEEP', 'PARALYSIS'] as const).map((controlKind) => ({
      ...reserve(),
      sourceFormId: 'NPC-016' as const,
      preparation: {
        kind: 'FORMAL_CONTROL_SET' as const,
        input: {
          capabilityKey: 'actual-formal-control',
          controlKind,
          remainingMinutes: '30.5',
          reason: 'Current state',
        },
      },
    })),
  ])('round-trips the exact variant $preparation.kind only in wire v3', (input) => {
    expect(npcTechnicalRequestValue(input)).toEqual(input);
    const encoded = encodeClientMessageV3(input, vocabulary);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) throw Error('expected encoded preparation');
    expect(decodeClientMessageV3(encoded.text, vocabulary)).toEqual({ ok: true, value: input });
    expect(decodeClientMessage(encoded.text, vocabulary).ok).toBe(false);
    expect(decodeClientMessageV2(encoded.text, vocabulary).ok).toBe(false);
  });
  it('detaches nested draft values without assigning a new item identity', () => {
    const source = reserve();
    const parsed = npcTechnicalRequestValue(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    if (
      parsed.messageType !== 'network.npc-preparation.request' ||
      parsed.preparation.kind !== 'ITEM_RESERVE'
    )
      throw Error('reserve');
    expect(parsed.preparation.values).not.toBe(
      source.preparation.kind === 'ITEM_RESERVE' ? source.preparation.values : null,
    );
    expect(JSON.stringify(parsed)).not.toContain('itemInstanceId');
  });
  it('keeps historical restore identity/capability closed and restricted to NPC015', () => {
    const request = {
      ...reserve(),
      preparation: {
        kind: 'ITEM_RESTORE',
        capabilityKey: 'current-history',
        itemInstanceId: id(51),
        values: {},
      },
    };
    expect(npcTechnicalRequestValue(request)).toEqual(request);
    for (const patch of [
      { capabilityKey: '' },
      { itemInstanceId: 'catalog-type' },
      { values: [] },
      { originCommitOperationId: id(52) },
      { profileId: id(53) },
    ])
      expect(() =>
        npcTechnicalRequestValue({ ...request, preparation: { ...request.preparation, ...patch } }),
      ).toThrow();
    expect(() => npcTechnicalRequestValue({ ...request, sourceFormId: 'NPC-016' })).toThrow();
  });
  it('keeps custom reservations closed, stage-bound, and distinct from profile publication', () => {
    const values = { kind: 'ENTERED', value: [] };
    for (const preparation of [
      { kind: 'CUSTOM_ITEM_RESERVE', values },
      { kind: 'CUSTOM_MODIFIER_RESERVE', itemInstanceId: id(7), values },
      {
        kind: 'CUSTOM_PROFILE_VERSION_RESERVE',
        itemInstanceId: id(7),
        profileId: id(8),
        expectedProfileVersionId: id(9),
        values,
      },
    ]) {
      const input = { ...reserve(), preparation };
      expect(npcTechnicalRequestValue(input)).toEqual(input);
      expect(() => npcTechnicalRequestValue({ ...input, sourceFormId: 'NPC-016' })).toThrow();
      for (const extra of [
        { ownerNpcUuid: id(10) },
        { newProfileVersionId: id(11) },
        { version: 2 },
        { confirmed: true },
      ])
        expect(() =>
          npcTechnicalRequestValue({ ...input, preparation: { ...preparation, ...extra } }),
        ).toThrow();
      expect(() =>
        npcTechnicalRequestValue({ ...input, preparation: { ...preparation, values: [] } }),
      ).toThrow();
      if (preparation.kind !== 'CUSTOM_ITEM_RESERVE') {
        expect(() =>
          npcTechnicalRequestValue({
            ...input,
            preparation: { ...preparation, itemInstanceId: null },
          }),
        ).toThrow();
        expect(() =>
          npcTechnicalRequestValue({
            ...input,
            preparation: { ...preparation, itemInstanceId: 'GEN-001' },
          }),
        ).toThrow();
      }
      if (preparation.kind === 'CUSTOM_PROFILE_VERSION_RESERVE') {
        const missingPrior = { ...preparation };
        Reflect.deleteProperty(missingPrior, 'expectedProfileVersionId');
        expect(() => npcTechnicalRequestValue({ ...input, preparation: missingPrior })).toThrow();
        expect(() =>
          npcTechnicalRequestValue({
            ...input,
            preparation: { ...preparation, profileId: 'unknown' },
          }),
        ).toThrow();
      }
    }
    expect(() =>
      npcTechnicalRequestValue({
        ...reserve(),
        preparation: { kind: 'CUSTOM_ITEM_RESERVE', itemInstanceId: id(7), values },
      }),
    ).toThrow();
  });
  it.each([
    { ...reserve(), sourceFormId: 'NPC-002' },
    { ...upload(), sourceFormId: 'NPC-015' },
    { ...reserve(), preparation: { kind: 'ITEM_RESERVE' } },
    { ...reserve(), preparation: { kind: 'ITEM_RESERVE', values: [], itemInstanceId: id(4) } },
    { ...reserve(), preparation: { kind: 'ITEM_RESERVE', values: {}, itemInstanceId: id(4) } },
    { ...reserve(), values: {} },
    { ...reserve(), ownerDeviceId: id(4) },
    { ...reserve(), expectedAttemptRevision: -1 },
    { ...reserve(), expectedRevisions: { stateRevision: 0, projectionRevision: 1 } },
    { ...upload(), preparation: { kind: 'ART_CLEAR', file: null } },
    {
      ...upload(),
      preparation: { kind: 'ART_UPLOAD', file: { kind: 'asset-key', assetKey: 'asset' } },
    },
    {
      ...upload(),
      preparation: {
        kind: 'ART_UPLOAD',
        file: {
          kind: 'local-file',
          mediaType: 'image/png',
          bytesBase64: '',
          sha256: 'a'.repeat(64),
        },
      },
    },
    {
      ...upload(),
      preparation: {
        kind: 'ART_UPLOAD',
        file: { kind: 'local-file', mediaType: 'image/gif', bytesBase64: 'bytes' },
      },
    },
  ])('rejects malformed or cross-stage preparation %#', (input) => {
    expect(() => npcTechnicalRequestValue(input)).toThrow();
    expect(decodeNpcTechnicalRequest(JSON.stringify(input)).ok).toBe(false);
  });
  it('keeps host image semantics separate from the established string transport', () => {
    const input = {
      ...upload(),
      preparation: {
        kind: 'ART_UPLOAD',
        file: { kind: 'local-file', mediaType: 'image/jpeg', bytesBase64: '' },
      },
    } as const;
    expect(npcTechnicalRequestValue(input)).toEqual(input);
    // This is not upload acceptance: the owning host still checks bytes/signature/12 MiB.
  });
  it('never invokes preparation/file/header getters before refusal, including global encode', () => {
    let calls = 0;
    for (const [key, base] of [
      ['preparation', reserve()],
      ['protocolVersion', reserve()],
    ] as const) {
      const value = { ...base };
      Object.defineProperty(value, key, {
        enumerable: true,
        get: () => {
          calls++;
          return 'PRIVATE';
        },
      });
      expect(() => npcTechnicalRequestValue(value)).toThrow();
      const result = encodeClientMessageV3(value, vocabulary);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
    const file = { kind: 'local-file', mediaType: 'image/png' };
    Object.defineProperty(file, 'bytesBase64', {
      enumerable: true,
      get: () => {
        calls++;
        return 'PRIVATE';
      },
    });
    expect(() =>
      npcTechnicalRequestValue({ ...upload(), preparation: { kind: 'ART_UPLOAD', file } }),
    ).toThrow();
    expect(calls).toBe(0);
  });
  it('redacts arbitrary inventory keys and malformed headers in the global decoder', () => {
    for (const input of [
      JSON.stringify(reserve()).replace('"value":[]', '"PRIVATE":1e999'),
      JSON.stringify(reserve()).replace(
        '"protocolVersion":3',
        '"protocolVersion":{"PRIVATE":1e999}',
      ),
    ]) {
      const result = decodeClientMessageV3(input, vocabulary);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    }
  });
});

describe('NPC015 composite set intent', () => {
  const request = () => ({
    ...reserve(),
    sourceFormId: 'NPC-015',
    preparation: { kind: 'COMPOSITE_ITEM_RESERVE', input: { itemTypeId: 'ITM-WPN-026' } },
  });
  it('reserves only a source type and rejects supplied identities, partial components or mechanical defaults', () => {
    for (const field of [
      'linkedSetInstanceId',
      'itemInstanceIds',
      'componentRole',
      'quantity',
      'equipped',
      'weaponProfileVersionId',
    ]) {
      const value = request();
      expect(() =>
        npcTechnicalRequestValue({
          ...value,
          preparation: {
            ...value.preparation,
            input: { ...value.preparation.input, [field]: 'forged' },
          },
        }),
      ).toThrow();
    }
    for (const itemTypeId of ['ITM-WPN-001', '', 'GEN-005', null]) {
      const value = request();
      expect(() =>
        npcTechnicalRequestValue({
          ...value,
          preparation: { ...value.preparation, input: { itemTypeId } },
        }),
      ).toThrow();
    }
    expect(() => npcTechnicalRequestValue({ ...request(), sourceFormId: 'NPC-016' })).toThrow();
  });
});

describe('NPC015 exact equipment compatibility intent', () => {
  const request = () => ({
    ...reserve(),
    sourceFormId: 'NPC-015',
    preparation: {
      kind: 'EQUIPMENT_COMPATIBILITY_CONFIRM',
      input: { capabilityKey: 'current-equipment', reason: 'Explicit GM confirmation' },
    },
  });
  it('does not accept client-selected identities, loadout, revision or compatibility outcome', () => {
    for (const field of [
      'npcUuid',
      'orderedItemInstanceIds',
      'confirmationId',
      'actorId',
      'draftRevision',
      'compatible',
      'confirmedAt',
    ]) {
      const value = request();
      expect(() =>
        npcTechnicalRequestValue({
          ...value,
          preparation: {
            ...value.preparation,
            input: { ...value.preparation.input, [field]: 'forged' },
          },
        }),
      ).toThrow();
    }
    expect(() => npcTechnicalRequestValue({ ...request(), sourceFormId: 'NPC-016' })).toThrow();
  });
  it('requires exact nonempty capability and reason without normalization', () => {
    for (const field of ['capabilityKey', 'reason']) {
      for (const bad of ['', ' ', ' padded ', null, true, 1]) {
        const value = request();
        expect(() =>
          npcTechnicalRequestValue({
            ...value,
            preparation: {
              ...value.preparation,
              input: { ...value.preparation.input, [field]: bad },
            },
          }),
        ).toThrow();
      }
    }
  });
});

describe('NPC016 source-bound effect preparation intent', () => {
  const alcohol = () => ({
    ...reserve(),
    sourceFormId: 'NPC-016',
    preparation: { kind: 'ALCOHOL_PREPARE', input: { reason: 'Explicit GM assignment' } },
  });
  const hpMode = () => ({
    ...reserve(),
    sourceFormId: 'NPC-016',
    preparation: {
      kind: 'HP_MODE_PREPARE',
      input: { capabilityKey: 'actual-source', remainingMinutes: '2.5', reason: 'Current state' },
    },
  });
  const formalControl = () => ({
    ...reserve(),
    sourceFormId: 'NPC-016',
    preparation: {
      kind: 'FORMAL_CONTROL_SET',
      input: {
        capabilityKey: 'actual-control',
        controlKind: 'SLEEP',
        remainingMinutes: '30.5',
        reason: 'Current state',
      },
    },
  });
  it('refuses client-owned authority, identity, Z, immunity, calendar and mode source', () => {
    for (const field of [
      'effectInstanceId',
      'effectiveZ',
      'poisonResponse',
      'campaignTimestamp',
      'startsAt',
      'mode',
      'sourceInstanceId',
    ]) {
      for (const request of [alcohol(), hpMode(), formalControl()])
        expect(() =>
          npcTechnicalRequestValue({
            ...request,
            preparation: {
              ...request.preparation,
              input: { ...request.preparation.input, [field]: 'forged' },
            },
          }),
        ).toThrow();
    }
    for (const request of [alcohol(), hpMode(), formalControl()]) {
      expect(() => npcTechnicalRequestValue({ ...request, sourceFormId: 'NPC-013' })).toThrow();
      expect(() =>
        npcTechnicalRequestValue({
          ...request,
          preparation: { ...request.preparation, input: {} },
        }),
      ).toThrow();
    }
  });
  it('refuses unknown formal-control kinds and source spoofing', () => {
    const request = formalControl();
    for (const controlKind of ['STUN', 'DEAD', 'UNKNOWN', null, 0])
      expect(() =>
        npcTechnicalRequestValue({
          ...request,
          preparation: {
            ...request.preparation,
            input: { ...request.preparation.input, controlKind },
          },
        }),
      ).toThrow();
    for (const remainingMinutes of ['0', '01', '1.0', '1e1', '5\n', null])
      expect(() =>
        npcTechnicalRequestValue({
          ...request,
          preparation: {
            ...request.preparation,
            input: { ...request.preparation.input, remainingMinutes },
          },
        }),
      ).toThrow();
  });
  it('preserves exact positive decimals without accepting rounded/defaulted durations', () => {
    for (const remainingMinutes of ['0.125', '1', '5', '6']) {
      const r = hpMode();
      r.preparation.input.remainingMinutes = remainingMinutes;
      expect(npcTechnicalRequestValue(r)).toEqual(r);
    }
    // The codec owns grammar; the source-bound host refuses a duration above its actual limit.
    for (const remainingMinutes of ['0', '-1', '01', '1.0', '1e-3', '1,5', '', 1, null]) {
      const r = hpMode();
      expect(() =>
        npcTechnicalRequestValue({
          ...r,
          preparation: { ...r.preparation, input: { ...r.preparation.input, remainingMinutes } },
        }),
      ).toThrow();
    }
  });
});

describe('formal Weaver state intent is separate from played activation', () => {
  const input = {
    capabilityKey: 'actual-weaver',
    sourceInstanceId: id(50),
    branch: 'REPLACEMENT_RECOVERY',
    remainingMinutes: '0.125',
    reason: 'Current state',
  };
  const request = (value: unknown) => ({
    ...reserve(),
    sourceFormId: 'NPC-016',
    preparation: { kind: 'WEAVER_STATE_PREPARE', input: value },
  });
  it('refuses fabricated rolls, time, costs, outcomes and client effect identity', () => {
    for (const field of [
      'originalR20',
      'rollReceiptId',
      'currentOE',
      'effectInstanceId',
      'campaignTimestamp',
      'deadline',
      'duplicateMultiplier',
      'canRecover',
    ]) {
      expect(() => npcTechnicalRequestValue(request({ ...input, [field]: 'forged' }))).toThrow();
    }
    expect(() =>
      npcTechnicalRequestValue({ ...request(input), sourceFormId: 'NPC-015' }),
    ).toThrow();
    for (const patch of [
      { sourceInstanceId: 'WEAVER' },
      { branch: 'FAILURE' },
      { remainingMinutes: '0' },
      { remainingMinutes: '1.0' },
      { reason: ' ' },
    ])
      expect(() => npcTechnicalRequestValue(request({ ...input, ...patch }))).toThrow();
  });
  it('refuses getters before reading a branch and preserves its input exactly', () => {
    let reads = 0;
    expect(() =>
      npcTechnicalRequestValue(
        request({
          ...input,
          get branch() {
            reads++;
            return 'REPLACEMENT_RECOVERY';
          },
        }),
      ),
    ).toThrow();
    expect(reads).toBe(0);
    expect(npcTechnicalRequestValue(request(input))).toEqual(request(input));
  });
  it('requires a real offered effect reference and explicit removal reason without allowing a new deadline', () => {
    const removal = {
      ...reserve(),
      sourceFormId: 'NPC-016',
      preparation: {
        kind: 'WEAVER_STATE_REMOVE',
        input: {
          capabilityKey: 'actual-removal',
          effectInstanceId: id(51),
          reason: 'Explicit removal',
        },
      },
    };
    expect(npcTechnicalRequestValue(removal)).toEqual(removal);
    for (const patch of [
      { effectInstanceId: 'invented' },
      { reason: '' },
      { remainingMinutes: '10' },
      { sourceInstanceId: id(50) },
    ])
      expect(() =>
        npcTechnicalRequestValue({
          ...removal,
          preparation: {
            ...removal.preparation,
            input: { ...removal.preparation.input, ...patch },
          },
        }),
      ).toThrow();
  });
});

describe('initial Taipan mode and dose carry intent without fabricated outcomes', () => {
  const mode = {
    capabilityKey: 'new-taipan',
    sourceInstanceId: id(51),
    poisonProfileId: 'POI-TAIPAN-DEADLY',
    reason: 'Initial current mode',
  };
  const dose = {
    capabilityKey: 'actual-carrier',
    sourceInstanceId: id(51),
    targetItemInstanceId: id(52),
    surfaceConfirmed: true,
    replacesCoatingIdOrNull: id(53),
    replaceConfirmed: true,
    reason: 'Explicit replacement',
  };
  const remove = {
    capabilityKey: 'actual-dose',
    coatingInstanceId: id(53),
    reason: 'Explicit removal',
  };
  for (const [sourceFormId, kind, input] of [
    ['NPC-016', 'POISON_MODE_SET', mode],
    ['NPC-015', 'POISON_COATING_PREPARE', dose],
    ['NPC-015', 'POISON_COATING_REMOVE', remove],
  ] as const) {
    it(`${kind} preserves exact intent and refuses wrong forms and result injection`, () => {
      const request = (value: unknown) => ({
        ...reserve(),
        sourceFormId,
        preparation: { kind, input: value },
      });
      expect(npcTechnicalRequestValue(request(input))).toEqual(request(input));
      expect(() =>
        npcTechnicalRequestValue({
          ...request(input),
          sourceFormId: sourceFormId === 'NPC-015' ? 'NPC-016' : 'NPC-015',
        }),
      ).toThrow();
      for (const field of [
        'sourceLevel',
        'currentOE',
        'damage',
        'originalR20',
        'appliedAt',
        'expiry',
        'pendingMode',
        'attackVariantId',
        'consumed',
        'coatingPayload',
      ])
        expect(() => npcTechnicalRequestValue(request({ ...input, [field]: 'forged' }))).toThrow();
      expect(() => npcTechnicalRequestValue(request({ ...input, reason: ' ' }))).toThrow();
      let reads = 0;
      expect(() =>
        npcTechnicalRequestValue(
          request({
            ...input,
            get reason() {
              reads++;
              return 'forged';
            },
          }),
        ),
      ).toThrow();
      expect(reads).toBe(0);
    });
  }
  it('refuses invented profiles, carriers and truthy replacement strings', () => {
    const request = (kind: string, sourceFormId: string, input: unknown) => ({
      ...reserve(),
      sourceFormId,
      preparation: { kind, input },
    });
    expect(() =>
      npcTechnicalRequestValue(
        request('POISON_MODE_SET', 'NPC-016', { ...mode, poisonProfileId: 'FREEFORM_POISON' }),
      ),
    ).toThrow();
    for (const patch of [
      { targetItemInstanceId: 'currentAmmo' },
      { sourceInstanceId: 'TAIPAN' },
      { replacesCoatingIdOrNull: '' },
      { replaceConfirmed: 'true' },
      { surfaceConfirmed: 1 },
    ])
      expect(() =>
        npcTechnicalRequestValue(
          request('POISON_COATING_PREPARE', 'NPC-015', { ...dose, ...patch }),
        ),
      ).toThrow();
  });
});

describe('disease reservation carries intent only', () => {
  const request = () =>
    ({
      ...reserve(),
      sourceFormId: 'NPC-016',
      preparation: { kind: 'DISEASE_RESERVE', diseaseId: 'DIS-RHINITIS' },
    }) as const;
  it('has no effect identity, calendar anchor or implicit active selection', () => {
    const input = request();
    expect(npcTechnicalRequestValue(input)).toEqual(input);
    expect(Object.keys(input.preparation)).toEqual(['kind', 'diseaseId']);
  });
  it.each(['effectInstanceId', 'createdAt', 'startsAt', 'payload', 'values', 'effectInstanceIds'])(
    'refuses injected %s before generic encoder traversal',
    (key) => {
      const input = request();
      expect(() =>
        npcTechnicalRequestValue({
          ...input,
          preparation: { ...input.preparation, [key]: 'PRIVATE' },
        }),
      ).toThrow();
    },
  );
  it('refuses wrong form, unknown source code and an accessor without invoking it', () => {
    const input = request();
    let calls = 0;
    expect(() => npcTechnicalRequestValue({ ...input, sourceFormId: 'NPC-015' })).toThrow();
    expect(() =>
      npcTechnicalRequestValue({
        ...input,
        preparation: { ...input.preparation, diseaseId: 'UNKNOWN' },
      }),
    ).toThrow();
    expect(() =>
      npcTechnicalRequestValue({
        ...input,
        preparation: {
          kind: 'DISEASE_RESERVE',
          get diseaseId() {
            calls++;
            return 'DIS-RHINITIS';
          },
        },
      }),
    ).toThrow();
    expect(calls).toBe(0);
  });
});
