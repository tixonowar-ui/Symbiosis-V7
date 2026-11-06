import { readNpcInventoryRequest, type NpcInventoryRequestEntry } from './inventory.js';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import {
  applyNpcStageInput,
  createEmptyNpcEditorDraft,
  createEmptyNpcInventoryEditorRow,
  readNpcInventoryEditorInput,
  projectNpcInventoryRequest,
  type NpcInventoryEditorRow,
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
  catalog = { skills: source.skills, development: source.development };
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
function completeInput(): NpcInventoryEditorRow['input'] {
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
function fullRow(profile: NpcItemProfileEditor = { kind: 'CATALOG' }): NpcInventoryEditorRow {
  return { itemInstanceId: id, input: completeInput(), profile: entered(profile) };
}
function expectedRequest(
  profile: NpcInventoryRequestEntry['profile'] = { kind: 'CATALOG' },
): NpcInventoryRequestEntry {
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
