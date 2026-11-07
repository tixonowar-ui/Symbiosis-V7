import {
  createEmptyNpcTraumaEditorRow,
  readNpcTraumaEditorRow,
  projectNpcInitialTraumaInput,
  type NpcTraumaEditorRow,
} from './staged-input.js';
import {
  readNpcInventoryRequest,
  type NpcInventoryRequestEntry,
  type NpcCatalogueInventoryRequestEntry,
  type NpcCampaignCustomProfileReference,
} from './inventory.js';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import {
  applyNpcStageInput,
  createEmptyNpcEditorDraft,
  createEmptyNpcSymbiontEditorRow,
  projectNpcSymbiontInputs,
  createEmptyNpcInventoryEditorRow,
  readNpcInventoryEditorInput,
  projectNpcInventoryRequest,
  type NpcCatalogueInventoryEditorRow,
  createEmptyNpcCampaignCustomInventoryEditorRow,
  addEmptyNpcCatalogueCustomModifier,
  replaceNpcInventoryCustomProfileVersion,
  restoreNpcInventoryEditorRows,
  replaceNpcInventoryCoatingSelection,
  type NpcItemProfileEditor,
  readNpcEditorDraft,
  readNpcStageInput,
  type NpcEditorCatalog,
} from './staged-input.js';
let source: NpcAuthoringSourceCatalog;
let catalog: NpcEditorCatalog;
beforeAll(async () => {
  source = await loadNpcAuthoringSourceCatalog(
    fileURLToPath(new URL('../../../../', import.meta.url)),
  );
  catalog = {
    skills: source.skills,
    development: source.development,
    composition: [{ symbiontInstanceId: id, speciesKeyOrNull: null, retired: false }],
  };
});
const unset = Object.freeze({ kind: 'UNSET' as const });
const entered = <T>(value: T) => ({ kind: 'ENTERED' as const, value });
const fields = (keys: string) => Object.fromEntries(keys.split(' ').map((key) => [key, unset]));
const id = '00000000-0000-4000-8000-000000000001';
function draft() {
  return {
    schemaVersion: 1,
    identity: fields('name description affiliation campaignRole sex massKg artAssetKeyOrNull'),
    schema: fields('raceCode pureClassOrNull anatomyProfileId'),
    baseStats: fields('S D M Z I W C'),
    symbionts: unset,
    skills: unset,
    inventory: unset,
    initialState: fields(
      'currentHP effectInstanceIds traumaInstanceIds woundInstanceIds sourceSpecificStateFactIds deathConsequenceFactIdOrNull',
    ),
  };
}
describe('NPC editor input is distinct from a committed sheet', () => {
  it('preserves explicit absence, empty lists and temporary invalid input without inventing defaults', () => {
    const initial = readNpcEditorDraft(catalog, draft());
    expect(initial.identity.massKg).toEqual(unset);
    expect(initial.symbionts).toEqual(unset);
    const empty = applyNpcStageInput(catalog, initial, 'NPC-013', entered([]));
    expect(empty.symbionts).toEqual(entered([]));
    expect(initial.symbionts).toEqual(unset);
    const identity = applyNpcStageInput(catalog, initial, 'NPC-002', {
      ...initial.identity,
      name: entered(''),
      massKg: entered(-1),
    });
    expect(identity.identity.name).toEqual(entered(''));
    expect(identity.identity.massKg).toEqual(entered(-1));
    expect('valid' in identity).toBe(false);
    expect(Object.isFrozen(identity.identity)).toBe(true);
  });
  it('NPC-016 edits the existing composition OE without storing a second OE owner', () => {
    const composition = entered([
      {
        symbiontInstanceId: id,
        input: {
          ...fields('speciesKey targetLevel learnedNodeRefs binding currentOE'),
          speciesKey: entered('OWL'),
          currentOE: entered(7),
        },
      },
    ]);
    const initial = applyNpcStageInput(catalog, draft(), 'NPC-013', composition);
    const changed = applyNpcStageInput(catalog, initial, 'NPC-016', {
      input: initial.initialState,
      currentOeChanges: [{ symbiontInstanceId: id, currentOE: entered(0) }],
    });
    expect(changed.symbionts).toMatchObject({
      kind: 'ENTERED',
      value: [{ symbiontInstanceId: id, input: { currentOE: entered(0) } }],
    });
    expect('currentOeChanges' in changed.initialState).toBe(false);
    expect(initial.symbionts).toMatchObject({
      kind: 'ENTERED',
      value: [{ input: { currentOE: entered(7) } }],
    });
    expect(() =>
      applyNpcStageInput(catalog, draft(), 'NPC-016', {
        input: initial.initialState,
        currentOeChanges: [{ symbiontInstanceId: id, currentOE: entered(0) }],
      }),
    ).toThrow('existing composition');
    expect(() =>
      applyNpcStageInput(catalog, initial, 'NPC-016', {
        input: initial.initialState,
        currentOeChanges: [
          { symbiontInstanceId: '00000000-0000-4000-8000-000000000002', currentOE: entered(0) },
        ],
      }),
    ).toThrow('absent symbiont');
  });
  it('does not accept client-derived authority, skills, effect payloads or final state', () => {
    expect(() => readNpcEditorDraft(catalog, { ...draft(), valid: true })).toThrow('unexpected');
    expect(() =>
      readNpcStageInput(
        catalog,
        'NPC-014',
        entered([{ ...fields('skillKey targetBonus pool'), fixedSkills: [] }]),
      ),
    ).toThrow('unexpected');
    expect(() =>
      readNpcStageInput(catalog, 'NPC-016', {
        input: { ...draft().initialState, effectInstances: [] },
        currentOeChanges: [],
      }),
    ).toThrow('unexpected');
    expect(() =>
      readNpcStageInput(catalog, 'NPC-017', { npcUuid: id, version: 1, committed: true }),
    ).toThrow('unexpected');
    expect(readNpcStageInput(catalog, 'NPC-017', {})).toEqual({});
  });
  it('rejects unknown source selections and accessor input before it can run', () => {
    expect(() =>
      readNpcStageInput(catalog, 'NPC-011', { ...draft().schema, raceCode: entered('INVENTED') }),
    ).toThrow('unrecognized');
    expect(() =>
      readNpcStageInput(
        catalog,
        'NPC-013',
        entered([
          {
            symbiontInstanceId: id,
            input: {
              ...fields('speciesKey targetLevel learnedNodeRefs binding currentOE'),
              learnedNodeRefs: entered([['UNRECOGNIZED', 'NODE'].join('-')]),
            },
          },
        ]),
      ),
    ).toThrow('unknown development');
    let calls = 0;
    const malicious = draft();
    Object.defineProperty(malicious, 'initialState', {
      enumerable: true,
      get: () => {
        calls++;
        return {};
      },
    });
    expect(() => readNpcEditorDraft(catalog, malicious)).toThrow('own data');
    expect(calls).toBe(0);
  });
});

const itemB = '00000000-0000-4000-8000-000000000002';
const setId = '00000000-0000-4000-8000-000000000003';
const coatingId = '00000000-0000-4000-8000-000000000004';
const foreignId = '00000000-0000-4000-8000-000000000099';
function inventoryCatalog(): NpcEditorCatalog {
  return {
    ...catalog,
    inventory: {
      catalog: source.inventory,
      itemInstanceIds: [id, itemB],
      linkedSetInstanceIds: [setId],
      coatingBindings: [{ coatingInstanceId: coatingId, itemInstanceId: id }],
      qualityBindings: [{ itemInstanceId: id, qualityRoll: 17 }],
    },
  };
}
function completeInput(): NpcCatalogueInventoryEditorRow['input'] {
  return {
    itemTypeId: entered('ITM-WPN-003'),
    quantity: entered(1),
    equipped: entered(false),
    equippedSlots: entered([]),
    bodyZone: entered(null),
    gripMode: entered(null),
    currentAmmo: entered(null),
    shieldCurrentHP: entered(null),
    broken: entered(false),
    sealed: entered(null),
    linkedSetInstanceId: entered(null),
    componentRole: entered(null),
    qualityRoll: entered(null),
    coatingInstanceIds: entered([]),
    issueReason: entered('Имущество НПС'),
  };
}
function fullRow(
  profile: NpcItemProfileEditor = { kind: 'CATALOG' },
): NpcCatalogueInventoryEditorRow {
  return { itemInstanceId: id, input: completeInput(), profile: entered(profile) };
}
function expectedRequest(
  profile: NpcInventoryRequestEntry['profile'] = { kind: 'CATALOG' },
): NpcCatalogueInventoryRequestEntry {
  return {
    itemInstanceId: id,
    itemTypeId: 'ITM-WPN-003',
    quantity: 1,
    equipped: false,
    equippedSlots: [],
    bodyZone: null,
    gripMode: null,
    currentAmmo: null,
    shieldCurrentHP: null,
    broken: false,
    sealed: null,
    linkedSetInstanceId: null,
    componentRole: null,
    qualityRoll: null,
    coatingInstanceIds: [],
    issueReason: 'Имущество НПС',
    profile,
  };
}
function completeMaster(): Extract<NpcItemProfileEditor, { kind: 'MASTER_WEAPON' }> {
  return {
    kind: 'MASTER_WEAPON',
    reason: entered('Изменён профиль'),
    inputs: [
      {
        input: {
          weaponVariantId: entered('ONE_HAND'),
          instanceDamageOrNull: entered(null),
          rangeMetersOrNull: entered(null),
          accuracyBonusOrNull: entered(null),
        },
        damageDefinition: entered({
          kind: 'MASTER_DICE',
          pattern: entered('R6+X'),
          constantOrNull: entered(3),
        }),
        penetrationDefinition: entered({ kind: 'RETAIN' }),
        statRequirements: {
          S: entered(4),
          D: entered(null),
          M: entered(null),
          Z: entered(null),
          I: entered(null),
          W: entered(null),
          C: entered(null),
        },
      },
    ],
  };
}
function completeCustom(): Extract<NpcItemProfileEditor, { kind: 'STRUCTURED_CUSTOM' }> {
  return {
    kind: 'STRUCTURED_CUSTOM',
    input: {
      name: entered('Метка'),
      description: entered('Предмет мастера'),
      massKg: entered(0.25),
      heldSizeClass: entered('FITS_IN_FIST'),
      armorWeightClass: entered('OTHER'),
      flammability: entered('NONCOMBUSTIBLE'),
      isIgnitionSource: entered(false),
      isFood: entered(false),
      canReceivePoison: entered(false),
      canReceiveFlammableCoating: entered(true),
    },
    customBonusOrNull: entered({ customBonusStat: entered('I'), customBonusValue: entered(2) }),
  };
}
const restart = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

describe('explicit historical item restoration into an owning editor context', () => {
  it('restores exact master inputs while leaving a different incomplete current row unchanged', () => {
    const own = inventoryCatalog();
    const master = completeMaster();
    const request = projectNpcInventoryRequest(
      own,
      entered([
        {
          ...fullRow(master),
          input: { ...completeInput(), currentAmmo: entered(0), broken: entered(true) },
        },
      ]),
    )[0]!;
    const partial = createEmptyNpcInventoryEditorRow(own, itemB);
    const current = entered([partial]);
    const before = JSON.stringify({ current, request });
    const restored = restoreNpcInventoryEditorRows(own, current, [request]);
    if (restored.kind !== 'ENTERED') throw Error('Expected restored editor rows');
    expect(restored.value).toHaveLength(2);
    expect(restored.value[0]).toEqual(partial);
    expect(restored.value[0]?.input.quantity).toEqual(unset);
    expect(projectNpcInventoryRequest(own, entered([restored.value[1]!]))).toEqual([request]);
    expect(restored.value[1]?.profile).toEqual(entered(master));
    expect(JSON.stringify({ current, request })).toBe(before);
  });
  it('refuses current/foreign identities and unrelated choices without changing the draft', () => {
    const own = inventoryCatalog();
    const current = entered([fullRow()]);
    const before = JSON.stringify(current);
    expect(() => restoreNpcInventoryEditorRows(own, current, [expectedRequest()])).toThrow(
      'currently selected',
    );
    expect(() =>
      restoreNpcInventoryEditorRows(own, entered([]), [
        { ...expectedRequest(), itemInstanceId: foreignId },
      ]),
    ).toThrow('foreign or unallocated');
    expect(() => restoreNpcInventoryEditorRows(own, entered([]), [])).toThrow('explicit');
    expect(() =>
      restoreNpcInventoryEditorRows(own, entered([]), [
        expectedRequest(),
        { ...expectedRequest(), itemInstanceId: itemB },
      ]),
    ).toThrow('unrelated');
    expect(JSON.stringify(current)).toBe(before);
  });
  it('restores a whole actual source pair atomically and refuses a selected secondary part', () => {
    const own: NpcEditorCatalog = {
      ...inventoryCatalog(),
      inventory: {
        ...inventoryCatalog().inventory!,
        linkedSets: [
          {
            linkedSetInstanceId: setId,
            itemTypeId: 'ITM-WPN-026',
            components: [
              { itemInstanceId: id, componentRole: 'SWORD' },
              { itemInstanceId: itemB, componentRole: 'SHIELD' },
            ],
          },
        ],
      },
    };
    const pair: NpcInventoryRequestEntry[] = [
      {
        ...expectedRequest(),
        itemTypeId: 'ITM-WPN-026',
        linkedSetInstanceId: setId,
        componentRole: 'SWORD',
      },
      {
        ...expectedRequest(),
        itemInstanceId: itemB,
        itemTypeId: 'ITM-WPN-026',
        linkedSetInstanceId: setId,
        componentRole: 'SHIELD',
        shieldCurrentHP: 350,
      },
    ];
    const restored = restoreNpcInventoryEditorRows(own, entered([]), pair);
    expect(projectNpcInventoryRequest(own, restored)).toEqual(pair);
    expect(() => restoreNpcInventoryEditorRows(own, entered([]), [pair[0]!])).toThrow(
      'whole actual source composite',
    );
    const partial = entered([createEmptyNpcInventoryEditorRow(own, itemB)]);
    expect(() => restoreNpcInventoryEditorRows(own, partial, pair)).toThrow('currently selected');
  });
});

describe('host-reserved custom profile editor identity and immutable versions', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const reference = (): NpcCampaignCustomProfileReference => ({
    kind: 'CAMPAIGN_CUSTOM_PROFILE',
    profileId: uuid(70),
    profileVersionId: uuid(71),
    version: 1,
    reservationOperationId: uuid(72),
  });
  const own = (): NpcEditorCatalog => {
    const current = inventoryCatalog();
    return {
      ...current,
      inventory: {
        ...current.inventory!,
        customProfiles: [
          { itemInstanceId: id, reference: reference(), confirmedContentOrNull: null },
        ],
      },
    };
  };
  const complete = () => ({
    ...createEmptyNpcCampaignCustomInventoryEditorRow(own(), id, reference()),
    input: { ...completeInput(), itemTypeId: entered(null) },
    profile: entered(completeCustom()),
    bonusContainerBinding: entered({ kind: 'OUTSIDE_BACKPACK' as const }),
    customProfileReason: entered('Основание профиля'),
  });
  it('accepts only actual reserved references and starts every physical/profile choice unset', () => {
    const row = createEmptyNpcCampaignCustomInventoryEditorRow(own(), id, reference());
    expect(row.itemTypeReference).toEqual(entered(reference()));
    expect(row.input.itemTypeId).toEqual(entered(null));
    expect(row.input.quantity).toEqual(unset);
    expect(row.bonusContainerBinding).toEqual(unset);
    expect(row.customProfileReason).toEqual(unset);
    expect(row.profile).toMatchObject({
      kind: 'ENTERED',
      value: { input: { name: unset, massKg: unset }, customBonusOrNull: unset },
    });
    expect(() => projectNpcInventoryRequest(own(), entered([row]))).toThrow('UNSET');
    expect(() =>
      createEmptyNpcCampaignCustomInventoryEditorRow(own(), id, {
        ...reference(),
        profileVersionId: uuid(99),
      }),
    ).toThrow('actual host reservation');
    expect(() => createEmptyNpcInventoryEditorRow(own(), id)).toThrow('identity is immutable');
    const value = entered([complete()]);
    expect(readNpcInventoryEditorInput(own(), restart(value))).toEqual(value);
    expect(projectNpcInventoryRequest(own(), value)[0]).toMatchObject({
      itemTypeId: null,
      itemTypeReference: reference(),
      customProfileReason: 'Основание профиля',
      issueReason: 'Имущество НПС',
    });
  });
  it('separates immutable version reason/content from a current container move', () => {
    const row = complete(),
      request = projectNpcInventoryRequest(own(), entered([row]))[0]!;
    if (request.itemTypeId !== null) throw Error('custom fixture');
    const context = own();
    const committed = {
      ...context,
      inventory: {
        ...context.inventory!,
        customProfiles: [
          {
            itemInstanceId: id,
            reference: reference(),
            confirmedContentOrNull: {
              profile: request.profile,
              reason: request.customProfileReason,
            },
          },
        ],
      },
    };
    expect(projectNpcInventoryRequest(committed, entered([row]))[0]).toEqual(request);
    const historical = {
      ...request,
      bonusContainerBinding: { kind: 'BACKPACK' as const, backpackItemInstanceId: itemB },
    };
    const restored = restoreNpcInventoryEditorRows(committed, entered([]), [historical]);
    expect(() => projectNpcInventoryRequest(committed, restored)).toThrow('real selected backpack');
    if (restored.kind !== 'ENTERED') throw Error('Expected restored custom row');
    expect(restored.value.map((item) => item.itemInstanceId)).toEqual([id]);
    expect(restored.value[0]).toMatchObject({
      bonusContainerBinding: entered(historical.bonusContainerBinding),
    });
    expect(() =>
      restoreNpcInventoryEditorRows(committed, entered([]), [
        { ...historical, customProfileReason: 'Подмена подтверждённого основания' },
      ]),
    ).toThrow('immutable');
    expect(() =>
      projectNpcInventoryRequest(
        committed,
        entered([{ ...row, customProfileReason: entered('Изменение без новой версии') }]),
      ),
    ).toThrow('immutable');
    const backpack = {
      ...fullRow(),
      itemInstanceId: itemB,
      input: { ...completeInput(), itemTypeId: entered('RES-CON-001') },
    };
    const moved = {
      ...row,
      bonusContainerBinding: entered({ kind: 'BACKPACK' as const, backpackItemInstanceId: itemB }),
    };
    expect(
      projectNpcInventoryRequest(committed, entered([...restored.value, backpack]))[0],
    ).toEqual(historical);
    expect(projectNpcInventoryRequest(committed, entered([moved, backpack]))[0]).toMatchObject({
      bonusContainerBinding: { kind: 'BACKPACK', backpackItemInstanceId: itemB },
      customProfileReason: request.customProfileReason,
    });
    const next = {
      ...reference(),
      profileVersionId: uuid(73),
      reservationOperationId: uuid(74),
      version: 2,
    };
    const nextCatalog = {
      ...committed,
      inventory: {
        ...committed.inventory,
        customProfiles: [
          ...committed.inventory.customProfiles,
          { itemInstanceId: id, reference: next, confirmedContentOrNull: null },
        ],
      },
    };
    const editable = replaceNpcInventoryCustomProfileVersion(nextCatalog, row, next);
    expect('itemTypeReference' in editable && editable.itemTypeReference).toEqual(entered(next));
    expect(editable.input.issueReason).toEqual(row.input.issueReason);
    expect(() =>
      replaceNpcInventoryCustomProfileVersion(nextCatalog, row, { ...next, version: 3 }),
    ).toThrow('next version');
  });
  it('adds a separate modifier while preserving the entire catalogue row and base profile', () => {
    const old = fullRow(completeMaster()),
      current = inventoryCatalog(),
      modifierReference = { ...reference(), kind: 'CATALOG_CUSTOM_MODIFIER' as const };
    const context = {
      ...current,
      inventory: {
        ...current.inventory!,
        customProfiles: [
          { itemInstanceId: id, reference: modifierReference, confirmedContentOrNull: null },
        ],
      },
    };
    const updated = addEmptyNpcCatalogueCustomModifier(context, old, modifierReference);
    expect(updated.input).toEqual(old.input);
    expect(updated.profile).toEqual(old.profile);
    expect(updated.customModifier).toMatchObject({
      reference: entered(modifierReference),
      reason: unset,
      bonusContainerBinding: unset,
    });
    expect(() => addEmptyNpcCatalogueCustomModifier(context, updated, modifierReference)).toThrow(
      'already has',
    );
    expect(() =>
      readNpcInventoryEditorInput(
        context,
        entered([{ ...updated, itemTypeReference: entered(reference()) }]),
      ),
    ).toThrow();
    const completed = {
      ...updated,
      customModifier: {
        reference: entered(modifierReference),
        profile: entered(completeCustom()),
        bonusContainerBinding: entered({ kind: 'OUTSIDE_BACKPACK' as const }),
        reason: entered('Подтверждённый отдельный профиль'),
      },
    };
    const checked = projectNpcInventoryRequest(context, entered([completed]))[0]!;
    if (checked.itemTypeId === null || checked.customModifier === undefined)
      throw Error('catalogue modifier fixture required');
    const committed = {
      ...context,
      inventory: {
        ...context.inventory,
        customProfiles: [
          {
            itemInstanceId: id,
            reference: modifierReference,
            confirmedContentOrNull: {
              profile: checked.customModifier.profile,
              reason: checked.customModifier.reason,
            },
          },
        ],
      },
    };
    expect(projectNpcInventoryRequest(committed, entered([completed]))).toEqual([checked]);
    expect(
      projectNpcInventoryRequest(
        committed,
        restoreNpcInventoryEditorRows(committed, entered([]), [checked]),
      ),
    ).toEqual([checked]);
    expect(() => readNpcInventoryEditorInput(committed, entered([old]))).toThrow(
      'confirmed custom modifier cannot be removed',
    );
    expect(projectNpcInventoryRequest(committed, entered([]))).toEqual([]);
    expect(readNpcInventoryEditorInput(context, entered([old]))).toEqual(entered([old]));
  });
});

describe('NPC-015 durable partial inventory input and explicit completion', () => {
  it('creates only technical absence and restores the complete empty draft without game defaults', () => {
    const empty = createEmptyNpcEditorDraft();
    expect(empty).toEqual(draft());
    expect(Object.values(empty.identity).every((v) => v.kind === 'UNSET')).toBe(true);
    expect(Object.values(empty.initialState).every((v) => v.kind === 'UNSET')).toBe(true);
    expect(empty.inventory).toEqual(unset);
    expect(readNpcEditorDraft(catalog, restart(empty))).toEqual(empty);
    expect(Object.isFrozen(empty.identity)).toBe(true);
    expect(readNpcInventoryEditorInput(catalog, entered([]))).toEqual(entered([]));
    expect(projectNpcInventoryRequest(catalog, entered([]))).toEqual([]);
    expect(() => projectNpcInventoryRequest(catalog, unset)).toThrow('inventory remains UNSET');
  });
  it('allocates no identity and creates an all-UNSET row only for the supplied host-owned identity', () => {
    const row = createEmptyNpcInventoryEditorRow(inventoryCatalog(), id);
    expect(row.itemInstanceId).toBe(id);
    expect(Object.values(row.input).every((v) => v.kind === 'UNSET')).toBe(true);
    expect(row.profile).toEqual(unset);
    expect(Object.isFrozen(row.input)).toBe(true);
    expect(() => createEmptyNpcInventoryEditorRow(inventoryCatalog(), foreignId)).toThrow(
      'foreign',
    );
    expect(() => createEmptyNpcInventoryEditorRow(catalog, id)).toThrow('host-owned');
  });
  it('restores a partial edited row after JSON restart without normalizing invalid finite input', () => {
    const empty = createEmptyNpcInventoryEditorRow(inventoryCatalog(), id);
    const row = {
      ...empty,
      input: {
        ...empty.input,
        quantity: entered(-1.5),
        currentAmmo: entered(0.25),
        shieldCurrentHP: entered(null),
        issueReason: entered(''),
      },
    };
    const saved = applyNpcStageInput(
      inventoryCatalog(),
      createEmptyNpcEditorDraft(),
      'NPC-015',
      entered([row]),
    );
    const restored = readNpcEditorDraft(inventoryCatalog(), restart(saved));
    expect(restored).toEqual(saved);
    expect(saved.inventory).toEqual(entered([row]));
    expect(Object.isFrozen(restored.inventory)).toBe(true);
    expect(() => projectNpcInventoryRequest(inventoryCatalog(), restored.inventory)).toThrow(
      'remains UNSET',
    );
    expect(empty.input.quantity).toEqual(unset);
  });
  it.each([0, -1, 0.5])(
    'keeps quantity %s as draft input but rejects it through the original completed request reader',
    (quantity) => {
      const row = { ...fullRow(), input: { ...completeInput(), quantity: entered(quantity) } };
      const value = entered([row]);
      expect(readNpcInventoryEditorInput(inventoryCatalog(), restart(value))).toEqual(value);
      expect(() => projectNpcInventoryRequest(inventoryCatalog(), value)).toThrow('safe integer');
    },
  );
  it.each([NaN, Infinity, -Infinity])('refuses nonfinite partial numbers %s', (quantity) => {
    expect(() =>
      readNpcInventoryEditorInput(
        inventoryCatalog(),
        entered([{ ...fullRow(), input: { ...completeInput(), quantity: entered(quantity) } }]),
      ),
    ).toThrow('finite input');
  });
  it('projects a complete catalogue row exactly and preserves detached immutable result bytes', () => {
    const input = entered([fullRow()]);
    const result = projectNpcInventoryRequest(inventoryCatalog(), restart(input));
    expect(result).toEqual(readNpcInventoryRequest([expectedRequest()]));
    expect(Object.isFrozen(result[0]?.profile)).toBe(true);
    expect(input).toEqual(entered([fullRow()]));
  });
  it('projects master expressions and all explicit absent requirements without creating numeric defaults', () => {
    const result = projectNpcInventoryRequest(
      inventoryCatalog(),
      restart(entered([fullRow(completeMaster())])),
    );
    expect(result).toEqual(
      readNpcInventoryRequest([
        expectedRequest({
          kind: 'MASTER_WEAPON',
          reason: 'Изменён профиль',
          inputs: [
            {
              weaponVariantId: 'ONE_HAND',
              instanceDamageOrNull: null,
              rangeMetersOrNull: null,
              accuracyBonusOrNull: null,
              damageDefinition: { kind: 'MASTER_DICE', pattern: 'R6+X', constantOrNull: 3 },
              penetrationDefinition: { kind: 'RETAIN' },
              statRequirements: { S: 4 },
            },
          ],
        }),
      ]),
    );
  });
  it('projects explicit custom bonus with the protected backpack condition supplied by the adapter only', () => {
    const result = projectNpcInventoryRequest(
      inventoryCatalog(),
      restart(entered([fullRow(completeCustom())])),
    );
    expect(result).toEqual(
      readNpcInventoryRequest([
        expectedRequest({
          kind: 'STRUCTURED_CUSTOM',
          name: 'Метка',
          description: 'Предмет мастера',
          massKg: 0.25,
          heldSizeClass: 'FITS_IN_FIST',
          armorWeightClass: 'OTHER',
          flammability: 'NONCOMBUSTIBLE',
          isIgnitionSource: false,
          isFood: false,
          canReceivePoison: false,
          canReceiveFlammableCoating: true,
          customBonusOrNull: {
            customBonusStat: 'I',
            customBonusValue: 2,
            activeOnlyInBackpack: true,
          },
        }),
      ]),
    );
    const withoutBonus = { ...completeCustom(), customBonusOrNull: entered(null) };
    expect(
      projectNpcInventoryRequest(inventoryCatalog(), entered([fullRow(withoutBonus)]))[0]?.profile,
    ).toMatchObject({ customBonusOrNull: null });
  });
  it('requires every chosen family field, including explicit absent requirements and no-X null', () => {
    const master = completeMaster(),
      weapon = master.inputs[0]!;
    const missingStat = {
      ...master,
      inputs: [{ ...weapon, statRequirements: { ...weapon.statRequirements, C: unset } }],
    };
    expect(() =>
      projectNpcInventoryRequest(inventoryCatalog(), entered([fullRow(missingStat)])),
    ).toThrow('statRequirements.C remains UNSET');
    const missingX = {
      ...master,
      inputs: [
        {
          ...weapon,
          damageDefinition: entered({
            kind: 'MASTER_DICE' as const,
            pattern: entered('R4' as const),
            constantOrNull: unset,
          }),
        },
      ],
    };
    expect(() =>
      projectNpcInventoryRequest(inventoryCatalog(), entered([fullRow(missingX)])),
    ).toThrow('constantOrNull remains UNSET');
    const missingName = { ...completeCustom(), input: { ...completeCustom().input, name: unset } };
    expect(() =>
      projectNpcInventoryRequest(inventoryCatalog(), entered([fullRow(missingName)])),
    ).toThrow('profile.name remains UNSET');
    const missingBonus = {
      ...completeCustom(),
      customBonusOrNull: entered({
        customBonusStat: entered('I' as const),
        customBonusValue: unset,
      }),
    };
    expect(() =>
      projectNpcInventoryRequest(inventoryCatalog(), entered([fullRow(missingBonus)])),
    ).toThrow('customBonusValue remains UNSET');
  });
  it('retains partial and invalid master/custom inputs on restart without bypassing complete validators', () => {
    const master = { ...completeMaster(), reason: entered(''), inputs: [] };
    const masterInput = entered([fullRow(master)]);
    expect(readNpcInventoryEditorInput(inventoryCatalog(), restart(masterInput))).toEqual(
      masterInput,
    );
    expect(() => projectNpcInventoryRequest(inventoryCatalog(), masterInput)).toThrow(
      'distinct nonempty',
    );
    const custom = {
      ...completeCustom(),
      customBonusOrNull: entered({
        customBonusStat: entered('I' as const),
        customBonusValue: entered(0.5),
      }),
    };
    const customInput = entered([fullRow(custom)]);
    expect(readNpcInventoryEditorInput(inventoryCatalog(), restart(customInput))).toEqual(
      customInput,
    );
    expect(() => projectNpcInventoryRequest(inventoryCatalog(), customInput)).toThrow(
      'safe integer',
    );
  });
  it('preserves conflicting equipment as draft data and leaves the original complete refusal intact', () => {
    const row = { ...fullRow(), input: { ...completeInput(), equipped: entered(true) } };
    expect(readNpcInventoryEditorInput(inventoryCatalog(), entered([row]))).toEqual(entered([row]));
    expect(() => projectNpcInventoryRequest(inventoryCatalog(), entered([row]))).toThrow(
      'equipped state',
    );
  });
  it('requires fresh host allocation after a successful previous read and rejects foreign set references', () => {
    const value = entered([fullRow()]);
    expect(readNpcInventoryEditorInput(inventoryCatalog(), value)).toEqual(value);
    const context = inventoryCatalog().inventory!;
    expect(() =>
      readNpcInventoryEditorInput(
        {
          ...catalog,
          inventory: { ...context, itemInstanceIds: [], coatingBindings: [], qualityBindings: [] },
        },
        value,
      ),
    ).toThrow('foreign');
    expect(() =>
      readNpcInventoryEditorInput(
        inventoryCatalog(),
        entered([
          { ...fullRow(), input: { ...completeInput(), linkedSetInstanceId: entered(foreignId) } },
        ]),
      ),
    ).toThrow('linked set');
    expect(() => readNpcInventoryEditorInput(catalog, value)).toThrow('host-owned');
  });
  it('binds prepared coating and quality to the exact item rather than accepting a shared number allowlist', () => {
    const input = {
      ...completeInput(),
      qualityRoll: entered(17),
      coatingInstanceIds: entered([coatingId]),
    };
    expect(
      readNpcInventoryEditorInput(inventoryCatalog(), entered([{ ...fullRow(), input }])),
    ).toEqual(entered([{ ...fullRow(), input }]));
    expect(() =>
      readNpcInventoryEditorInput(
        inventoryCatalog(),
        entered([{ ...fullRow(), itemInstanceId: itemB, input }]),
      ),
    ).toThrow('coating');
    expect(() =>
      readNpcInventoryEditorInput(
        inventoryCatalog(),
        entered([
          {
            ...fullRow(),
            itemInstanceId: itemB,
            input: { ...input, coatingInstanceIds: entered([]) },
          },
        ]),
      ),
    ).toThrow('quality');
    expect(() =>
      readNpcInventoryEditorInput(
        inventoryCatalog(),
        entered([{ ...fullRow(), input: { ...completeInput(), qualityRoll: entered(18) } }]),
      ),
    ).toThrow('quality');
  });
  it.each(['valid', 'complete', 'ownerDeviceId', 'profileVersion', 'resolvedDamage'])(
    'rejects forged row field %s',
    (key) => {
      expect(() =>
        readNpcInventoryEditorInput(inventoryCatalog(), entered([{ ...fullRow(), [key]: true }])),
      ).toThrow('unexpected');
    },
  );
  it('rejects unknown input keys, source choices, duplicate identities and the old whole-row shape', () => {
    expect(() =>
      readNpcInventoryEditorInput(
        inventoryCatalog(),
        entered([{ ...fullRow(), input: { ...completeInput(), definitionId: entered('forged') } }]),
      ),
    ).toThrow('unexpected');
    expect(() =>
      readNpcInventoryEditorInput(
        inventoryCatalog(),
        entered([
          {
            ...fullRow(),
            input: { ...completeInput(), itemTypeId: entered(['UNKNOWN', 'ITEM'].join('-')) },
          },
        ]),
      ),
    ).toThrow('unknown source');
    expect(() =>
      readNpcInventoryEditorInput(inventoryCatalog(), entered([fullRow(), fullRow()])),
    ).toThrow('duplicate');
    expect(() =>
      readNpcInventoryEditorInput(inventoryCatalog(), entered([expectedRequest()])),
    ).toThrow('unexpected');
  });
  it('rejects client-derived profile fields and backpack flags instead of trusting nominal profile kind', () => {
    expect(() =>
      readNpcInventoryEditorInput(
        inventoryCatalog(),
        entered([
          fullRow({
            ...completeCustom(),
            customBonusOrNull: entered({
              customBonusStat: entered('I'),
              customBonusValue: entered(2),
              activeOnlyInBackpack: true,
            }),
          } as unknown as NpcItemProfileEditor),
        ]),
      ),
    ).toThrow('unexpected');
    expect(() =>
      readNpcInventoryEditorInput(
        inventoryCatalog(),
        entered([{ ...fullRow(), profile: entered({ kind: 'CATALOG', resolvedProfile: {} }) }]),
      ),
    ).toThrow('unexpected');
    expect(() =>
      readNpcInventoryEditorInput(
        inventoryCatalog(),
        entered([
          {
            ...fullRow(),
            profile: entered({
              kind: 'MASTER_WEAPON',
              reason: entered('x'),
              inputs: [{ ...completeMaster().inputs[0], publishedProfileVersion: 1 }],
            }),
          },
        ]),
      ),
    ).toThrow('unexpected');
  });
  it('rejects accessors, sparse arrays and unknown fields before reading values', () => {
    let calls = 0;
    const bad = { ...completeInput() };
    Object.defineProperty(bad, 'quantity', {
      enumerable: true,
      get: () => {
        calls++;
        return entered(1);
      },
    });
    expect(() =>
      readNpcInventoryEditorInput(inventoryCatalog(), entered([{ ...fullRow(), input: bad }])),
    ).toThrow('own data');
    expect(calls).toBe(0);
    const sparse = new Array<unknown>(1);
    expect(() => readNpcInventoryEditorInput(inventoryCatalog(), entered(sparse))).toThrow(
      'sparse',
    );
    const p = { kind: 'MASTER_WEAPON', reason: entered('x'), inputs: [] };
    Object.defineProperty(p, 'kind', {
      enumerable: true,
      get: () => {
        calls++;
        return 'MASTER_WEAPON';
      },
    });
    expect(() =>
      readNpcInventoryEditorInput(
        inventoryCatalog(),
        entered([{ ...fullRow(), profile: entered(p) }]),
      ),
    ).toThrow();
    expect(calls).toBe(0);
  });
});

describe('NPC016 selected effects require exact scoped host bindings', () => {
  const first = '00000000-0000-4000-8000-000000000090',
    second = '00000000-0000-4000-8000-000000000091';
  const bound = (): NpcEditorCatalog => ({
    ...catalog,
    effects: [
      { effectInstanceId: first, diseaseId: 'DIS-RHINITIS' },
      { effectInstanceId: second, diseaseId: 'DIS-POISONING' },
    ],
  });
  const input = (ids: readonly string[]) => ({
    input: { ...draft().initialState, effectInstanceIds: entered(ids) },
    currentOeChanges: [],
  });
  it('preserves optional initial Taipan mode anchors without allowing generic NPC016 assignment or removal', () => {
    const legacy = readNpcEditorDraft(catalog, draft());
    expect(Object.hasOwn(legacy.initialState, 'poisonModeFactIds')).toBe(false);
    expect(JSON.stringify(legacy)).toBe(JSON.stringify(draft()));
    const owned = readNpcEditorDraft(catalog, {
      ...legacy,
      initialState: { ...legacy.initialState, poisonModeFactIds: entered([first]) },
    });
    const changed = applyNpcStageInput(catalog, owned, 'NPC-016', {
      input: { ...owned.initialState, currentHP: entered(1) },
      currentOeChanges: [],
    });
    expect(changed.initialState.poisonModeFactIds).toEqual(entered([first]));
    for (const replacement of [
      legacy.initialState,
      { ...owned.initialState, poisonModeFactIds: entered([]) },
      { ...owned.initialState, poisonModeFactIds: entered([second]) },
    ])
      expect(() =>
        applyNpcStageInput(catalog, owned, 'NPC-016', {
          input: replacement,
          currentOeChanges: [],
        }),
      ).toThrow('read-only');
    expect(() =>
      applyNpcStageInput(catalog, legacy, 'NPC-016', {
        input: owned.initialState,
        currentOeChanges: [],
      }),
    ).toThrow('read-only');
  });
  it('preserves absent or owning Weaver anchors and refuses changing them through generic NPC016 input', () => {
    const legacy = readNpcEditorDraft(catalog, draft());
    expect(JSON.stringify(legacy)).toBe(JSON.stringify(draft()));
    expect(Object.hasOwn(legacy.initialState, 'weaverEffectInstanceIds')).toBe(false);
    const owned = readNpcEditorDraft(catalog, {
      ...legacy,
      initialState: { ...legacy.initialState, weaverEffectInstanceIds: entered([first]) },
    });
    const bytes = JSON.stringify(owned);
    const unchanged = applyNpcStageInput(catalog, owned, 'NPC-016', {
      input: { ...owned.initialState, currentHP: entered(1) },
      currentOeChanges: [],
    });
    expect(unchanged.initialState.weaverEffectInstanceIds).toEqual(entered([first]));
    expect(unchanged.initialState.currentHP).toEqual(entered(1));
    for (const initialState of [
      legacy.initialState,
      { ...owned.initialState, weaverEffectInstanceIds: entered([]) },
      { ...owned.initialState, weaverEffectInstanceIds: entered([second]) },
      { ...owned.initialState, weaverEffectInstanceIds: entered([first, second]) },
    ])
      expect(() =>
        applyNpcStageInput(catalog, owned, 'NPC-016', {
          input: initialState,
          currentOeChanges: [],
        }),
      ).toThrow('Weaver state selection is read-only');
    expect(() =>
      applyNpcStageInput(catalog, legacy, 'NPC-016', {
        input: owned.initialState,
        currentOeChanges: [],
      }),
    ).toThrow('Weaver state selection is read-only');
    expect(JSON.stringify(owned)).toBe(bytes);
  });
  it('selects only provided prepared IDs while retaining explicit empty/UNSET without context', () => {
    expect(
      readNpcStageInput(bound(), 'NPC-016', input([first, second])).input.effectInstanceIds,
    ).toEqual(entered([first, second]));
    expect(readNpcStageInput(catalog, 'NPC-016', input([])).input.effectInstanceIds).toEqual(
      entered([]),
    );
    expect(readNpcEditorDraft(catalog, draft()).initialState.effectInstanceIds).toEqual(unset);
  });
  it('rejects missing, foreign or ambiguous bindings and duplicate active diseases', () => {
    expect(() => readNpcStageInput(catalog, 'NPC-016', input([first]))).toThrow('bindings');
    expect(() => readNpcStageInput(bound(), 'NPC-016', input([id]))).toThrow('binding');
    expect(() =>
      readNpcStageInput(
        {
          ...bound(),
          effects: [
            { effectInstanceId: first, diseaseId: 'DIS-RHINITIS' },
            { effectInstanceId: first, diseaseId: 'DIS-POISONING' },
          ],
        },
        'NPC-016',
        input([first]),
      ),
    ).toThrow('binding');
    expect(() =>
      readNpcStageInput(
        {
          ...bound(),
          effects: [
            { effectInstanceId: first, diseaseId: 'DIS-RHINITIS' },
            { effectInstanceId: second, diseaseId: 'DIS-RHINITIS' },
          ],
        },
        'NPC-016',
        input([first, second]),
      ),
    ).toThrow('duplicate selected');
  });
  it('applies the same check to durable editor readback rather than accepting unowned references', () => {
    const saved = { ...draft(), initialState: input([first]).input };
    expect(() => readNpcEditorDraft(catalog, saved)).toThrow();
    expect(readNpcEditorDraft(bound(), saved).initialState.effectInstanceIds).toEqual(
      entered([first]),
    );
  });
  it('selects actual formal controls by kind without invented symbiont source identities', () => {
    const formal: NpcEditorCatalog = {
      ...catalog,
      effects: [
        { effectInstanceId: first, sourceKind: 'FORMAL_CONTROL', controlKind: 'SLEEP' },
        { effectInstanceId: second, sourceKind: 'FORMAL_CONTROL', controlKind: 'PARALYSIS' },
      ],
    };
    expect(
      readNpcStageInput(formal, 'NPC-016', input([first, second])).input.effectInstanceIds,
    ).toEqual(entered([first, second]));
    expect(() =>
      readNpcStageInput(
        {
          ...formal,
          effects: [
            { effectInstanceId: first, sourceKind: 'FORMAL_CONTROL', controlKind: 'SLEEP' },
            { effectInstanceId: second, sourceKind: 'FORMAL_CONTROL', controlKind: 'SLEEP' },
          ],
        },
        'NPC-016',
        input([first, second]),
      ),
    ).toThrow('duplicate selected');
  });
});

describe('source-bound partial initial trauma input', () => {
  const traumaId = '00000000-0000-4000-8000-000000000061';
  function owner(retainedRowOrNull: NpcTraumaEditorRow | null = null): NpcEditorCatalog {
    return {
      ...catalog,
      traumas: {
        catalog: source.initialTrauma,
        bindings: [{ traumaInstanceId: traumaId, retainedRowOrNull }],
      },
    };
  }
  function head(remainingMinutes = '0.1000000000000000001'): NpcTraumaEditorRow {
    return {
      traumaInstanceId: traumaId,
      input: {
        regionId: entered('HEAD'),
        traumaValue: entered(7),
        reason: entered('Исходное состояние'),
      },
      head: entered({
        penalty: entered('CONSUMED'),
        stun: entered({ status: 'ACTIVE', remainingMinutes: entered(remainingMinutes) }),
      }),
    };
  }
  function input(row: NpcTraumaEditorRow) {
    return {
      ...createEmptyNpcEditorDraft().initialState,
      traumaInstanceIds: entered([traumaId]),
      traumaInputs: entered([row]),
    };
  }
  it('preserves legacy absence and empty selection bytes without inventing the optional field', () => {
    for (const initialState of [
      createEmptyNpcEditorDraft().initialState,
      { ...createEmptyNpcEditorDraft().initialState, traumaInstanceIds: entered([]) },
    ]) {
      const value = { ...createEmptyNpcEditorDraft(), initialState };
      expect(JSON.stringify(readNpcEditorDraft(catalog, value))).toBe(JSON.stringify(value));
      expect(Object.hasOwn(readNpcEditorDraft(catalog, value).initialState, 'traumaInputs')).toBe(
        false,
      );
    }
  });
  it('restores a host-reserved UNSET row from serialized draft without manufacturing an entity', () => {
    const row = createEmptyNpcTraumaEditorRow(traumaId),
      value = { ...createEmptyNpcEditorDraft(), initialState: input(row) };
    const restored = readNpcEditorDraft(owner(), JSON.parse(JSON.stringify(value)));
    expect(restored.initialState.traumaInputs).toEqual(entered([row]));
    expect(row.input).toEqual({ regionId: unset, traumaValue: unset, reason: unset });
    expect(row.head).toEqual(unset);
    expect(() => projectNpcInitialTraumaInput(owner(), restored.initialState)).toThrow();
    expect(Object.isFrozen(restored.initialState.traumaInputs)).toBe(true);
  });
  it('preserves exact decimal text and finite-invalid input until explicit source completion', () => {
    const value = input(head()),
      checked = projectNpcInitialTraumaInput(owner(), value);
    expect(checked.choices[0]?.consequence).toEqual({
      kind: 'HEAD',
      penalty: 'CONSUMED',
      stun: { status: 'ACTIVE', remainingMinutes: '0.1000000000000000001' },
    });
    for (const remaining of ['0', '5.0000000000000000001', '0.5\n']) {
      const row = head(remaining);
      expect(readNpcTraumaEditorRow(row)).toEqual(row);
      expect(() => projectNpcInitialTraumaInput(owner(), input(row))).toThrow();
    }
    const row = { ...head(), input: { ...head().input, traumaValue: entered(-3) } };
    expect(readNpcTraumaEditorRow(row).input.traumaValue).toEqual(entered(-3));
    expect(() => projectNpcInitialTraumaInput(owner(), input(row))).toThrow();
  });
  it('rejects client identity, unknown proof fields, hidden ABSENT timer and incomplete HEAD choices', () => {
    expect(() =>
      readNpcEditorDraft(catalog, { ...createEmptyNpcEditorDraft(), initialState: input(head()) }),
    ).toThrow();
    expect(() => readNpcTraumaEditorRow({ ...head(), valid: true })).toThrow();
    expect(() =>
      readNpcTraumaEditorRow({
        ...head(),
        head: entered({
          penalty: entered('PENDING'),
          stun: entered({ status: 'ABSENT', remainingMinutes: entered('1') }),
        }),
      }),
    ).toThrow();
    expect(() =>
      projectNpcInitialTraumaInput(owner(), input({ ...head(), head: unset })),
    ).toThrow();
    const torso = {
      ...head(),
      input: { ...head().input, regionId: entered('TORSO' as const) },
      head: unset,
    };
    expect(projectNpcInitialTraumaInput(owner(), input(torso)).choices[0]?.consequence).toEqual({
      kind: 'TORSO',
      hpInterpretation: 'CURRENT_HP_ALREADY_FINAL',
    });
  });
  it('keeps the complete retained row immutable while allowing deselection', () => {
    const row = head(),
      bound = owner(row),
      original = { ...createEmptyNpcEditorDraft(), initialState: input(row) };
    expect(readNpcEditorDraft(bound, original)).toEqual(original);
    for (const changed of [
      head('1'),
      { ...head(), input: { ...head().input, reason: entered('Changed') } },
    ])
      expect(() =>
        readNpcEditorDraft(bound, { ...original, initialState: input(changed) }),
      ).toThrow();
    expect(
      projectNpcInitialTraumaInput(bound, { ...input(row), traumaInstanceIds: entered([]) }),
    ).toEqual({ currentTraumas: [], choices: [] });
  });
});

describe('NPC013 host-bound partial symbiont rows', () => {
  it('preserves UNSET/finite invalid choices through readback without allocating or completing anything', () => {
    const row = createEmptyNpcSymbiontEditorRow(catalog, id);
    expect(row).toEqual({
      symbiontInstanceId: id,
      input: fields('speciesKey targetLevel learnedNodeRefs binding currentOE'),
    });
    expect(() => projectNpcSymbiontInputs(catalog, entered([row]))).toThrow('UNSET');
    const partial = {
      ...row,
      input: { ...row.input, targetLevel: entered(-2), currentOE: entered(-0.5) },
    };
    const restored = readNpcStageInput(
      catalog,
      'NPC-013',
      JSON.parse(JSON.stringify(entered([partial]))),
    );
    expect(restored).toEqual(entered([partial]));
    expect(() => projectNpcSymbiontInputs(catalog, restored)).toThrow('UNSET');
  });
  it('requires unique host binding and refuses retired or foreign identities', () => {
    const row = createEmptyNpcSymbiontEditorRow(catalog, id);
    expect(() =>
      readNpcStageInput(
        { skills: source.skills, development: source.development },
        'NPC-013',
        entered([row]),
      ),
    ).toThrow('checked host bindings');
    expect(() => createEmptyNpcSymbiontEditorRow(catalog, foreignId)).toThrow('unique binding');
    expect(() =>
      readNpcStageInput(
        {
          ...catalog,
          composition: [{ symbiontInstanceId: id, speciesKeyOrNull: null, retired: true }],
        },
        'NPC-013',
        entered([row]),
      ),
    ).toThrow('retired');
    expect(() =>
      readNpcStageInput(
        {
          ...catalog,
          composition: [
            { symbiontInstanceId: id, speciesKeyOrNull: null, retired: false },
            { symbiontInstanceId: id, speciesKeyOrNull: null, retired: false },
          ],
        },
        'NPC-013',
        entered([row]),
      ),
    ).toThrow('unique binding');
  });
  it('locks confirmed species but keeps explicit learned/current OE edits distinct', () => {
    const blank = createEmptyNpcSymbiontEditorRow(catalog, id);
    const row = {
      ...blank,
      input: { ...blank.input, speciesKey: entered('OWL'), currentOE: entered(0) },
    };
    const bound: NpcEditorCatalog = {
      ...catalog,
      composition: [{ symbiontInstanceId: id, speciesKeyOrNull: 'OWL', retired: false }],
    };
    expect(readNpcStageInput(bound, 'NPC-013', entered([row]))).toEqual(entered([row]));
    expect(() =>
      readNpcStageInput(
        bound,
        'NPC-013',
        entered([{ ...row, input: { ...row.input, speciesKey: entered('TEACHER') } }]),
      ),
    ).toThrow('species is immutable');
    expect(() =>
      readNpcStageInput(bound, 'NPC-013', entered([{ ...row, confirmed: true }])),
    ).toThrow('unexpected');
  });
});

describe('NPC-015 explicit quality/clothing metadata inputs', () => {
  it('changes coating selection only through the owning preparation factory and keeps whole-item removal possible', () => {
    const scope = inventoryCatalog();
    const empty = entered([fullRow()]);
    const selected = replaceNpcInventoryCoatingSelection(scope, empty, id, [], [coatingId]);
    expect(projectNpcInventoryRequest(scope, selected)[0]?.coatingInstanceIds).toEqual([coatingId]);
    const current = readNpcEditorDraft(scope, { ...draft(), inventory: selected });
    expect(() => applyNpcStageInput(scope, current, 'NPC-015', empty)).toThrow('read-only');
    const unselected = readNpcEditorDraft(scope, { ...draft(), inventory: empty });
    expect(() => applyNpcStageInput(scope, unselected, 'NPC-015', selected)).toThrow('read-only');
    expect(() => replaceNpcInventoryCoatingSelection(scope, selected, id, [], [])).toThrow();
    expect(() =>
      replaceNpcInventoryCoatingSelection(scope, empty, itemB, [], [coatingId]),
    ).toThrow();
    expect(() => replaceNpcInventoryCoatingSelection(scope, empty, id, [], [foreignId])).toThrow();
    expect(replaceNpcInventoryCoatingSelection(scope, selected, id, [coatingId], [])).toEqual(
      empty,
    );
    expect(applyNpcStageInput(scope, current, 'NPC-015', entered([])).inventory).toEqual(
      entered([]),
    );
    expect(empty.value[0]?.input.coatingInstanceIds).toEqual(entered([]));
  });
  it('preserves legacy absence and explicit no-quality without a quality roll or allocated quality receipt', () => {
    const scope = inventoryCatalog();
    const legacy = projectNpcInventoryRequest(scope, entered([fullRow()]));
    expect(Object.hasOwn(legacy[0]!, 'qualityTier')).toBe(false);
    const row = { ...fullRow(), qualityTier: entered(null) };
    expect(projectNpcInventoryRequest(scope, entered([row]))[0]).toMatchObject({
      qualityTier: null,
      qualityRoll: null,
    });
    expect(() =>
      projectNpcInventoryRequest(scope, entered([{ ...row, qualityTier: unset }])),
    ).toThrow('UNSET');
    expect(() =>
      readNpcInventoryEditorInput(scope, entered([{ ...row, qualityTier: entered('LEGENDARY') }])),
    ).toThrow();
    expect(() =>
      readNpcInventoryEditorInput(
        scope,
        entered([{ ...fullRow(), input: { ...completeInput(), qualityTier: entered('GOOD') } }]),
      ),
    ).toThrow();
  });
  it('requires actual clothing identity and explicit editable properties, with no inferred sealed flag', () => {
    const scope = inventoryCatalog();
    const properties = {
      coveredRegionIds: entered(['TORSO']),
      hermetic: entered('UNKNOWN'),
      flammability: entered('UNKNOWN'),
    };
    const row = {
      ...fullRow(),
      input: {
        ...completeInput(),
        itemTypeId: entered('RES-EQP-001'),
        equipped: entered(true),
        equippedSlots: entered(['TORSO']),
      },
      clothingProperties: entered(properties),
    };
    const request = projectNpcInventoryRequest(scope, entered([row]))[0];
    expect(request).toMatchObject({
      bodyZone: null,
      sealed: null,
      clothingProperties: {
        coveredRegionIds: ['TORSO'],
        hermetic: 'UNKNOWN',
        flammability: 'UNKNOWN',
      },
    });
    expect(() =>
      projectNpcInventoryRequest(
        scope,
        entered([{ ...row, clothingProperties: entered({ ...properties, hermetic: unset }) }]),
      ),
    ).toThrow('UNSET');
    expect(() =>
      readNpcInventoryEditorInput(scope, entered([{ ...row, input: completeInput() }])),
    ).toThrow('clothing');
    expect(() =>
      readNpcInventoryEditorInput(
        scope,
        entered([
          {
            ...row,
            clothingProperties: entered({ ...properties, coveredRegionIds: entered(['HAND_R']) }),
          },
        ]),
      ),
    ).toThrow();
  });
  it('restores exact historical GM metadata while leaving an unrelated incomplete row unchanged', () => {
    const scope = inventoryCatalog();
    const historical: NpcCatalogueInventoryRequestEntry = {
      ...expectedRequest(),
      itemTypeId: 'RES-EQP-001',
      qualityTier: 'RARE',
      equipped: true,
      equippedSlots: ['TORSO', 'ARM_L'],
      clothingProperties: {
        coveredRegionIds: ['TORSO', 'ARM_L'],
        hermetic: false,
        flammability: 'COMBUSTIBLE',
      },
    };
    const untouched = createEmptyNpcInventoryEditorRow(scope, itemB);
    const current = entered([untouched]);
    const restored = restoreNpcInventoryEditorRows(scope, current, [historical]);
    if (restored.kind !== 'ENTERED') throw new Error('expected restored rows');
    expect(restored.value[0]).toEqual(untouched);
    expect(restored.value[1]?.qualityTier).toEqual(entered('RARE'));
    expect(restored.value[1]?.clothingProperties).toEqual(
      entered({
        coveredRegionIds: entered(['TORSO', 'ARM_L']),
        hermetic: entered(false),
        flammability: entered('COMBUSTIBLE'),
      }),
    );
    expect(projectNpcInventoryRequest(scope, entered([restored.value[1]]))).toEqual([historical]);
    expect(current).toEqual(entered([untouched]));
  });
});
