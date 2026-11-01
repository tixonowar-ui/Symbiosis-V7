import { describe, expect, it } from 'vitest';
import type { AdmissionReviewDraft } from './campaign-admission.js';
import {
  decodeAdmissionReviewDraft,
  decodeAdmissionWeaponReviewInput,
  admissionReviewInputsValue,
  completeAdmissionReviewInputs,
} from './campaign-admission-codec.js';
import {
  admissionPlayerDecisionRequestValue,
  admissionGroupLabelsValue,
  type AdmissionPlayerDecisionRequest,
} from './campaign-admission-proposal.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

it('requires exactly the selected group labels and refuses missing, foreign, duplicate or private data', () => {
  const labels = [
    { groupId: id(1), name: 'Разведчики' },
    { groupId: id(2), name: 'Лекари' },
  ];
  expect(admissionGroupLabelsValue(labels, [id(1), id(2)])).toEqual(labels);
  for (const invalid of [
    [],
    labels.slice(0, 1),
    [...labels, { groupId: id(3), name: 'Чужая группа' }],
    [...labels].reverse(),
    [labels[0], labels[0]],
    [{ ...labels[0], name: ' ' }, labels[1]],
    [{ ...labels[0], privateField: 'secret' }, labels[1]],
  ])
    expect(() => admissionGroupLabelsValue(invalid, [id(1), id(2)])).toThrow();
});
describe('whole-batch player decision input', () => {
  const request = (): AdmissionPlayerDecisionRequest => ({
    commandId: id(1),
    campaignId: id(2),
    admissionBatchId: id(3),
    proposalRevision: 1,
    proposalChecksum: 'a'.repeat(64),
    expectedCampaignRevision: 2,
    decision: 'ACCEPT',
    controllerPreparationOrNull: {
      schemaVersion: 1,
      preparationId: id(4),
      requestId: id(5),
      ownerDeviceId: id(6),
      campaignId: id(2),
      admissionBatchId: id(3),
      proposalRevision: 1,
      proposalChecksum: 'a'.repeat(64),
      controllerBindings: [7, 8, 9].map((n) => ({
        campaignCharacterId: id(n),
        deviceId: id(6),
        localControllerSeatId: id(n + 10),
        inputLaneId: id(n + 10),
      })),
    },
  });
  it('accepts the complete three-tab mapping and a whole decline without a preparation', () => {
    const value = request();
    expect(admissionPlayerDecisionRequestValue(value)).toEqual(value);
    const decline = { ...value, decision: 'DECLINE', controllerPreparationOrNull: null };
    expect(admissionPlayerDecisionRequestValue(decline)).toEqual(decline);
  });
  it('rejects partial/mixed identities, duplicate lanes, foreign devices and unknown or missing fields', () => {
    const value = request(),
      preparation = value.controllerPreparationOrNull!;
    for (const changed of [
      { ...value, decision: 'DECLINE' },
      { ...value, controllerPreparationOrNull: null },
      { ...value, partialCopyIds: [id(7)] },
      {
        ...value,
        controllerPreparationOrNull: { ...preparation, proposalChecksum: 'b'.repeat(64) },
      },
      { ...value, controllerPreparationOrNull: { ...preparation, controllerBindings: [] } },
      {
        ...value,
        controllerPreparationOrNull: {
          ...preparation,
          controllerBindings: [
            preparation.controllerBindings[0],
            preparation.controllerBindings[0],
          ],
        },
      },
      {
        ...value,
        controllerPreparationOrNull: {
          ...preparation,
          controllerBindings: preparation.controllerBindings.map((b) => ({
            ...b,
            deviceId: id(20),
          })),
        },
      },
      {
        ...value,
        controllerPreparationOrNull: {
          ...preparation,
          controllerBindings: preparation.controllerBindings.map((b) => ({
            ...b,
            inputLaneId: id(30),
          })),
        },
      },
    ])
      expect(() => admissionPlayerDecisionRequestValue(changed)).toThrow();
    for (const path of objectPaths(value)) {
      const extended = structuredClone(value);
      objectAt(extended, path)['authority'] = true;
      expect(() => admissionPlayerDecisionRequestValue(extended)).toThrow();
      for (const key of Object.keys(objectAt(value, path))) {
        const missing = structuredClone(value);
        delete objectAt(missing, path)[key];
        expect(() => admissionPlayerDecisionRequestValue(missing)).toThrow();
      }
    }
  });
});
function draft(): AdmissionReviewDraft {
  return {
    statAdjustments: { S: 1, D: -2, M: 0, Z: 0, I: 0, W: 0, C: 0 },
    startingSkills: { entries: [{ skillKey: 'AGILITY', targetBonus: 6 }] },
    massReview: { massKg: 75.1, decision: 'PENDING_MASTER_APPROVAL' },
    inventoryReview: {
      status: 'PENDING',
      entries: [
        {
          reviewItemId: id(1),
          sourceEntryIdOrNull: 'armor:0',
          item: { kind: 'CATALOG', itemTypeId: 'ITM-ARM-001' },
          quantity: 1,
          qualityLabel: 'Обычный',
          weaponDecisionReceiptIdOrNull: null,
        },
        {
          reviewItemId: id(2),
          sourceEntryIdOrNull: null,
          item: {
            kind: 'CUSTOM_ITEM',
            name: 'Камень',
            description: '',
            statBonusOrNull: { statCode: 'S', positiveIntegerBonus: 2 },
          },
          quantity: 3,
          qualityLabel: 'Обычный',
          weaponDecisionReceiptIdOrNull: null,
        },
      ],
      unresolvedSourceEntryIds: ['weapon:0'],
    },
    moneyReview: { status: 'PENDING', amountOrNull: null },
    weaponDecisionRefs: [
      {
        kind: 'VALIDATED_REQUEST',
        requestId: 'request:1',
        validationReceiptId: 'validation:1',
        decisionReceiptId: id(3),
      },
      { kind: 'ADMISSION_GRANT', reviewItemId: id(4), decisionReceiptId: id(5) },
    ],
    groupAssignment: { kind: 'NEW', groupDraftId: id(6), name: 'Группа' },
    locationAssignment: { location: 'Город', subLocationOrNull: null },
  };
}
const decode = (value: unknown) => decodeAdmissionReviewDraft(JSON.stringify(value));
type MutableRecord = Record<string, unknown>;
function objectAt(value: unknown, path: readonly (string | number)[]): MutableRecord {
  return path.reduce<unknown>(
    (current, key) => (current as MutableRecord)[key],
    value,
  ) as MutableRecord;
}
function objectPaths(
  value: unknown,
  path: readonly (string | number)[] = [],
): (readonly (string | number)[])[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value))
    return value.flatMap((entry, index) => objectPaths(entry, [...path, index]));
  return [
    path,
    ...Object.entries(value).flatMap(([key, entry]) => objectPaths(entry, [...path, key])),
  ];
}

describe('NET-019 closed admission draft syntax (ADR 0071)', () => {
  it('keeps OPEN inputs incomplete until the GM supplies assignments, without publishing null placeholders', () => {
    const { groupAssignment, locationAssignment, ...values } = draft();
    const input = { ...values, groupAssignmentOrNull: null, locationAssignmentOrNull: null };
    expect(admissionReviewInputsValue(input)).toEqual(input);
    expect(() => completeAdmissionReviewInputs(input)).toThrow();
    expect(() =>
      completeAdmissionReviewInputs({ ...input, groupAssignmentOrNull: groupAssignment }),
    ).toThrow();
    expect(
      completeAdmissionReviewInputs({
        ...input,
        groupAssignmentOrNull: groupAssignment,
        locationAssignmentOrNull: locationAssignment,
      }),
    ).toEqual(draft());
    expect(() => admissionReviewInputsValue({ ...input, groupAssignment })).toThrow();
  });
  it('keeps ordered inputs, signed corrections, explicit pending values and grant provenance', () => {
    const input = draft();
    expect(decode(input)).toEqual({ ok: true, value: input });
    expect(decode({ ...input, groupAssignment: { kind: 'START' } }).ok).toBe(true);
    expect(decode({ ...input, groupAssignment: { kind: 'EXISTING', groupId: id(10) } }).ok).toBe(
      true,
    );
    expect(
      decode({
        ...input,
        massReview: { massKg: 0.1, decision: 'APPROVED' },
        moneyReview: { status: 'FINAL', amountOrNull: 0 },
        inventoryReview: { status: 'FINAL', entries: [], unresolvedSourceEntryIds: [] },
      }).ok,
    ).toBe(true);
  });
  it('rejects unknown private fields and every omitted required field at every nested object', () => {
    for (const path of objectPaths(draft())) {
      const unknown = structuredClone(draft());
      objectAt(unknown, path)['privateReplayWitness'] = 'secret';
      const refused = decode(unknown);
      expect(refused.ok, `${path.join('.')} accepts unknown key`).toBe(false);
      expect(JSON.stringify(refused)).not.toContain('secret');
      expect(JSON.stringify(refused)).not.toContain('privateReplayWitness');
      for (const key of Object.keys(objectAt(draft(), path))) {
        const missing = structuredClone(draft());
        delete objectAt(missing, path)[key];
        expect(decode(missing).ok, `${path.join('.')}.${key} accepts omission`).toBe(false);
      }
    }
  });
  it.each([0, -1, 75.11, 1e30, null, '75.1'])(
    'rejects malformed mass %s without inventing racial ranges',
    (massKg) => {
      expect(decode({ ...draft(), massReview: { massKg, decision: 'APPROVED' } }).ok).toBe(false);
    },
  );
  it.each([0.3, 75.1, 1000.9])('accepts source-valid decimal mass %s', (massKg) => {
    expect(decode({ ...draft(), massReview: { massKg, decision: 'APPROVED' } }).ok).toBe(true);
  });
  it.each([
    { status: 'PENDING', amountOrNull: 0 },
    { status: 'FINAL', amountOrNull: null },
    { status: 'FINAL', amountOrNull: -1 },
    { status: 'FINAL', amountOrNull: '20' },
    { status: 'FINAL', amountOrNull: 1, currency: 'invented' },
    { status: 'APPROVED', amountOrNull: 1 },
  ])('rejects malformed money %#', (moneyReview) => {
    expect(decode({ ...draft(), moneyReview }).ok).toBe(false);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2', null])(
    'rejects quantity %s',
    (quantity) => {
      const input = draft();
      expect(
        decode({
          ...input,
          inventoryReview: {
            ...input.inventoryReview,
            entries: [{ ...input.inventoryReview.entries[0], quantity }],
          },
        }).ok,
      ).toBe(false);
    },
  );
  it('requires complete inventory status and distinct source and review identities', () => {
    const input = draft(),
      inventory = input.inventoryReview;
    expect(decode({ ...input, inventoryReview: { ...inventory, status: 'FINAL' } }).ok).toBe(false);
    expect(
      decode({
        ...input,
        inventoryReview: { ...inventory, unresolvedSourceEntryIds: ['weapon:0', 'weapon:0'] },
      }).ok,
    ).toBe(false);
    expect(
      decode({
        ...input,
        inventoryReview: { ...inventory, entries: [inventory.entries[0], inventory.entries[0]] },
      }).ok,
    ).toBe(false);
    expect(
      decode({
        ...input,
        inventoryReview: {
          ...inventory,
          entries: [inventory.entries[0], { ...inventory.entries[0], reviewItemId: id(9) }],
        },
      }).ok,
    ).toBe(false);
  });
  it('does not conflate a new grant with a validated original request', () => {
    const input = draft();
    const grant = input.weaponDecisionRefs[1]!;
    expect(
      decode({
        ...input,
        weaponDecisionRefs: [
          { ...grant, requestId: 'fabricated', validationReceiptId: 'fabricated' },
        ],
      }).ok,
    ).toBe(false);
    expect(
      decode({ ...input, weaponDecisionRefs: [grant, { ...grant, decisionReceiptId: id(8) }] }).ok,
    ).toBe(false);
    expect(decode({ ...input, weaponDecisionRefs: [grant, grant] }).ok).toBe(false);
    expect(
      decode({
        ...input,
        weaponDecisionRefs: [
          { kind: 'PATCH_EXISTING', weaponInstanceId: id(1), decisionReceiptId: id(3) },
        ],
      }).ok,
    ).toBe(false);
  });
  it('forbids publishing arbitrary profile bytes or group/location runtime side effects in a draft', () => {
    const input = draft(),
      entry = input.inventoryReview.entries[0]!;
    expect(
      decode({
        ...input,
        inventoryReview: {
          ...input.inventoryReview,
          entries: [{ ...entry, weaponProfile: { damage: 999 } }],
        },
      }).ok,
    ).toBe(false);
    expect(decode({ ...input, groupAssignment: { kind: 'START', groupId: id(1) } }).ok).toBe(false);
    expect(decode({ ...input, groupAssignment: { kind: 'NEW', name: 'Only a label' } }).ok).toBe(
      false,
    );
    expect(
      decode({ ...input, locationAssignment: { ...input.locationAssignment, coordinates: [1, 2] } })
        .ok,
    ).toBe(false);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects skill target bonus %s',
    (targetBonus) => {
      expect(
        decode({ ...draft(), startingSkills: { entries: [{ skillKey: 'AGILITY', targetBonus }] } })
          .ok,
      ).toBe(false);
    },
  );
  it('rejects duplicate skills and nonscalar/unknown stat adjustments', () => {
    const input = draft();
    expect(
      decode({
        ...input,
        startingSkills: {
          entries: [...input.startingSkills.entries, ...input.startingSkills.entries],
        },
      }).ok,
    ).toBe(false);
    for (const value of [null, {}, 0.5, 1e30, '1'])
      expect(decode({ ...input, statAdjustments: { ...input.statAdjustments, S: value } }).ok).toBe(
        false,
      );
    expect(decode({ ...input, statAdjustments: { ...input.statAdjustments, XP: 10 } }).ok).toBe(
      false,
    );
  });
  it('rejects malformed custom item bonuses and extra catalog item fields', () => {
    const input = draft(),
      entry = input.inventoryReview.entries[1]!;
    for (const bonus of [
      { statCode: 'HP', positiveIntegerBonus: 1 },
      { statCode: 'S', positiveIntegerBonus: 0 },
      { statCode: 'S', positiveIntegerBonus: 1.5 },
    ]) {
      expect(
        decode({
          ...input,
          inventoryReview: {
            ...input.inventoryReview,
            entries: [{ ...entry, item: { ...entry.item, statBonusOrNull: bonus } }],
          },
        }).ok,
      ).toBe(false);
    }
    expect(
      decode({
        ...input,
        inventoryReview: {
          ...input.inventoryReview,
          entries: [
            {
              ...entry,
              item: {
                kind: 'CATALOG',
                itemTypeId: 'ITM-ARM-001',
                statBonusOrNull: { statCode: 'S', positiveIntegerBonus: 1 },
              },
            },
          ],
        },
      }).ok,
    ).toBe(false);
  });
  it('refuses non-JSON and non-string inputs without coercion', () => {
    expect(decodeAdmissionReviewDraft('{').ok).toBe(false);
    const input = {
      toString: () => {
        throw Error('must not execute');
      },
    };
    expect(decodeAdmissionReviewDraft(input as unknown as string).ok).toBe(false);
    expect(
      decode({ ...draft(), moneyReview: { status: 'FINAL', amountOrNull: Infinity } }).ok,
    ).toBe(false);
  });
});

describe('GM-019 closed admission weapon input', () => {
  const grant = () => ({
    kind: 'ADMISSION_GRANT',
    reviewItemId: id(1),
    weaponTypeId: 'ITM-WPN-001',
    reason: 'Изменение при согласовании',
    profileSource: {
      kind: 'GM_DEFINED',
      typedProfile: {
        weaponVariantId: 'DEFAULT',
        damageDefinition: { kind: 'RETAIN' },
        penetrationDefinition: { kind: 'MASTER_DICE', pattern: 'R6+X', constantOrNull: 0.5 },
        statRequirements: { S: 1.5 },
        instanceDamageOrNull: 500.5,
        rangeMetersOrNull: 2000.5,
        accuracyBonusOrNull: null,
      },
    },
  });
  const decode = (v: unknown) => decodeAdmissionWeaponReviewInput(JSON.stringify(v));
  it('keeps original validation identity separate from a new complete typed grant', () => {
    const request = {
      kind: 'VALIDATED_REQUEST',
      requestId: 'original-request',
      validationReceiptId: 'actual-validation-receipt',
    };
    expect(decode(request)).toEqual({ ok: true, value: request });
    expect(decode(grant())).toEqual({ ok: true, value: grant() });
    const template = {
      ...grant(),
      profileSource: { kind: 'CATALOG_TEMPLATE', templateId: 'host-catalog-template' },
    };
    expect(decode(template)).toEqual({ ok: true, value: template });
    expect(decode({ ...grant(), ...request, kind: 'ADMISSION_GRANT' }).ok).toBe(false);
    expect(decode({ ...grant(), kind: 'VALIDATED_REQUEST' }).ok).toBe(false);
  });
  it('rejects unknown or omitted fields at every input boundary, without exposing private content', () => {
    for (const path of objectPaths(grant())) {
      const unknown = structuredClone(grant());
      objectAt(unknown, path)['privateReplayWitness'] = 'secret';
      const refusal = decode(unknown);
      expect(refusal.ok, path.join('.')).toBe(false);
      expect(JSON.stringify(refusal)).not.toMatch(/secret|privateReplayWitness/);
      if (path.at(-1) === 'statRequirements') continue;
      for (const key of Object.keys(objectAt(grant(), path))) {
        const omitted = structuredClone(grant());
        delete objectAt(omitted, path)[key];
        expect(decode(omitted).ok, `${path.join('.')}.${key}`).toBe(false);
      }
    }
  });
  it('forbids protected field edits, new bare R20 and malformed X', () => {
    for (const definition of [
      { kind: 'MASTER_DICE', pattern: 'R20', constantOrNull: null },
      { kind: 'MASTER_DICE', pattern: 'R6+X', constantOrNull: 0 },
      { kind: 'MASTER_DICE', pattern: 'R6+X', constantOrNull: '10' },
      { kind: 'MASTER_DICE', pattern: 'R6', constantOrNull: 1 },
      { kind: 'RETAIN', sourceNotation: 'invented' },
    ]) {
      const input = grant();
      objectAt(input, ['profileSource', 'typedProfile'])['damageDefinition'] = definition;
      expect(decode(input).ok).toBe(false);
    }
    const input = grant();
    objectAt(input, ['profileSource', 'typedProfile'])['properties'] = { Ёмкость: 999 };
    expect(decode(input).ok).toBe(false);
    expect(decode({ ...grant(), reason: '   ' }).ok).toBe(false);
  });
  it('retains explicit empty requirements and null optional fields', () => {
    const input = grant();
    objectAt(input, ['profileSource', 'typedProfile'])['statRequirements'] = {};
    objectAt(input, ['profileSource', 'typedProfile'])['instanceDamageOrNull'] = null;
    objectAt(input, ['profileSource', 'typedProfile'])['rangeMetersOrNull'] = null;
    // Catalog/type-specific completeness is checked separately against the host-bound base.
    expect(decode(input).ok).toBe(true);
  });
});
