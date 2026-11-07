import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalWeaponProfileCatalog } from '../../../host/weapon-profile-catalog.js';
import {
  createNpcInventoryCatalog,
  deriveNpcArmorContribution,
  readNpcInventoryRequest,
  resolveNpcWeaponProfiles,
  validateNpcCatalogueItemState,
  type NpcCatalogueInventoryRequestEntry,
  type NpcItemProfileRequest,
} from './inventory.js';

const source = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../../generated/spec/items/${name}.json`, import.meta.url), 'utf8'),
  ) as unknown;
const weapons = canonicalWeaponProfileCatalog();
const catalog = createNpcInventoryCatalog(
  source('catalogue'),
  source('armor-profiles'),
  source('pharmaceuticals'),
  weapons,
);
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function item(itemTypeId = 'ITM-WPN-003'): NpcCatalogueInventoryRequestEntry {
  return {
    itemInstanceId: id(1),
    itemTypeId,
    quantity: 1,
    profile: { kind: 'CATALOG' },
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
    issueReason: 'Начальное имущество NPC',
  };
}
function definition(id: string) {
  const result = catalog.definitions.find((entry) => entry.itemTypeId === id);
  if (result === undefined) throw new Error('Missing actual item source');
  return result;
}
describe('NPC-015 inventory inputs and immutable source profiles', () => {
  it('retains all delivered catalogue rows and complete armor/pharmaceutical source profiles', () => {
    const rows = source('catalogue') as Record<string, unknown>[];
    expect(catalog.definitions.map((entry) => entry.itemTypeId)).toEqual(
      rows.map((row) => row['ItemTypeID']),
    );
    expect(catalog.definitions.filter((entry) => entry.category === 'Броня')).toHaveLength(8);
    expect(catalog.definitions.filter((entry) => entry.category === 'Фармацевтика')).toHaveLength(
      14,
    );
    expect(definition('RES-MAG-001').inventoryAllowed).toBe('UNKNOWN');
    expect(definition('RES-CUR-001').completeness).toBe('PARTIAL');
    expect(definition('ITM-ARM-005').armorOrNull).toEqual({
      coverageModel: 'FULL_SUIT',
      allowsLayers: false,
      sealedApplicable: true,
    });
    expect(definition('ITM-PHA-002').profileSource?.['Эффект']).toContain('HP=1');
  });
  it('refuses source drift instead of silently losing a mechanical field', () => {
    const rows = source('catalogue') as Record<string, unknown>[];
    rows[0]!['futureMechanic'] = 'unrecognized';
    expect(() =>
      createNpcInventoryCatalog(rows, source('armor-profiles'), source('pharmaceuticals'), weapons),
    ).toThrow('unknown or missing source field');
    expect(() =>
      createNpcInventoryCatalog(source('catalogue'), [], source('pharmaceuticals'), weapons),
    ).toThrow('missing or mismatched source profile');
  });
  it('allows an empty or larger-than-PC-starting inventory and retains explicit unequipped state', () => {
    expect(readNpcInventoryRequest([])).toEqual([]);
    const entries = Array.from({ length: 9 }, (_, index) => ({
      ...item('RES-CUR-001'),
      itemInstanceId: id(index + 1),
      quantity: index + 1,
    }));
    const actual = readNpcInventoryRequest(entries);
    expect(actual).toEqual(entries);
    expect(actual).not.toBe(entries);
    expect(Object.isFrozen(actual[0]?.profile)).toBe(true);
    for (const entry of actual) {
      if (entry.itemTypeId === null) throw new Error('Expected catalogue currency fixture');
      validateNpcCatalogueItemState(definition(entry.itemTypeId), entry, []);
    }
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid quantity %s',
    (quantity) => {
      expect(() => readNpcInventoryRequest([{ ...item(), quantity }])).toThrow('safe integer');
    },
  );
  it('rejects identity reuse, unknown fields and inconsistent equipment without reading getters', () => {
    expect(() => readNpcInventoryRequest([item(), item()])).toThrow('duplicate physical');
    expect(() => readNpcInventoryRequest([{ ...item(), combatActorId: id(9) }])).toThrow(
      'unexpected',
    );
    expect(() => readNpcInventoryRequest([{ ...item(), equipped: true }])).toThrow('slot presence');
    let calls = 0;
    const entry = { ...item() };
    Object.defineProperty(entry, 'quantity', {
      enumerable: true,
      get: () => {
        calls++;
        return 1;
      },
    });
    expect(() => readNpcInventoryRequest([entry])).toThrow('data field');
    expect(calls).toBe(0);
    const values = [item()];
    Object.defineProperty(values, '0', {
      enumerable: true,
      get: () => {
        calls++;
        return item();
      },
    });
    expect(() => readNpcInventoryRequest(values)).toThrow('data entries');
    expect(calls).toBe(0);
  });
  it('rejects sparse arrays, extra array properties and duplicated coating ownership', () => {
    const sparse = new Array<unknown>(1);
    expect(() => readNpcInventoryRequest(sparse)).toThrow('sparse');
    const extended = Object.assign([item()], { extra: true });
    expect(() => readNpcInventoryRequest(extended)).toThrow('extended');
    const coating = id(6);
    expect(() =>
      readNpcInventoryRequest([
        { ...item(), coatingInstanceIds: [coating] },
        { ...item(), itemInstanceId: id(2), coatingInstanceIds: [coating] },
      ]),
    ).toThrow('two items');
  });
  it('structures custom bonuses without accepting an executable formula or implicit equipment', () => {
    const custom: NpcItemProfileRequest = {
      kind: 'STRUCTURED_CUSTOM',
      name: 'Знак',
      description: 'Предмет мастера',
      customBonusOrNull: {
        customBonusStat: 'W',
        customBonusValue: 2,
        activeOnlyInBackpack: true,
      },
      massKg: null,
      heldSizeClass: 'UNKNOWN',
      armorWeightClass: 'UNKNOWN',
      flammability: 'UNKNOWN',
      isIgnitionSource: false,
      isFood: false,
      canReceivePoison: false,
      canReceiveFlammableCoating: false,
    };
    expect(readNpcInventoryRequest([{ ...item(), profile: custom }])[0]?.profile).toEqual(custom);
    expect(() =>
      readNpcInventoryRequest([{ ...item(), profile: { ...custom, formula: 'W+2' } }]),
    ).toThrow('unexpected');
    expect(() =>
      readNpcInventoryRequest([
        {
          ...item(),
          profile: {
            ...custom,
            customBonusOrNull: {
              ...custom.customBonusOrNull,
              activeOnlyInBackpack: false,
            },
          },
        },
      ]),
    ).toThrow('backpack');
    expect(() =>
      readNpcInventoryRequest([
        {
          ...item(),
          profile: {
            ...custom,
            customBonusOrNull: {
              ...custom.customBonusOrNull,
              customBonusValue: 0,
            },
          },
        },
      ]),
    ).toThrow('safe integer');
    expect(() =>
      validateNpcCatalogueItemState(definition('ITM-WPN-003'), { ...item(), profile: custom }, []),
    ).toThrow('custom type');
  });
  it('uses the full Kensi fixed profile and enforces its source magazine capacity of eight', () => {
    const profiles = resolveNpcWeaponProfiles(weapons, 'ITM-WPN-003', ['DEFAULT'], {
      kind: 'CATALOG',
    });
    expect(profiles[0]?.properties['Ёмкость']).toBe('8');
    expect(profiles[0]?.statSource).toBe('TEMPLATE_FIXED');
    expect(profiles[0]?.damageDefinition.sourceNotation).toBe(
      weapons.entries.find((entry) => entry.weaponTypeId === 'ITM-WPN-003')!.template
        .damageDefinition.sourceNotation,
    );
    for (const currentAmmo of [0, 8])
      expect(() =>
        validateNpcCatalogueItemState(
          definition('ITM-WPN-003'),
          { ...item(), currentAmmo },
          profiles,
        ),
      ).not.toThrow();
    expect(() =>
      validateNpcCatalogueItemState(
        definition('ITM-WPN-003'),
        { ...item(), currentAmmo: 9 },
        profiles,
      ),
    ).toThrow('magazine capacity');
    expect(() =>
      validateNpcCatalogueItemState(
        definition('ITM-PHA-002'),
        { ...item('ITM-PHA-002'), currentAmmo: 1 },
        [],
      ),
    ).toThrow('magazine capacity');
  });
  it('allows a full master override beyond player formula bounds while preserving protected capacities', () => {
    const request: NpcItemProfileRequest = {
      kind: 'MASTER_WEAPON',
      reason: 'Особый экземпляр мастера',
      inputs: [
        {
          weaponVariantId: 'DEFAULT',
          damageDefinition: {
            kind: 'MASTER_DICE',
            pattern: 'R20*2+X',
            constantOrNull: 100000,
          },
          penetrationDefinition: {
            kind: 'MASTER_DICE',
            pattern: 'R4',
            constantOrNull: null,
          },
          statRequirements: {},
          instanceDamageOrNull: null,
          rangeMetersOrNull: 100000,
          accuracyBonusOrNull: 2,
        },
      ],
    };
    const entry = readNpcInventoryRequest([{ ...item(), profile: request }])[0]!;
    const itemTypeId = entry.itemTypeId;
    if (itemTypeId === null) throw new Error('Expected catalogue weapon fixture');
    if (entry.profile.kind !== 'MASTER_WEAPON') throw new Error('Unexpected profile');
    const masterProfile = entry.profile;
    const result = resolveNpcWeaponProfiles(weapons, itemTypeId, ['DEFAULT'], masterProfile);
    expect(result[0]?.damageDefinition.sourceNotation).toBe('R20*2+100000');
    expect(result[0]?.statRequirements).toEqual({});
    expect(result[0]?.properties['Ёмкость']).toBe('8');
    expect(result[0]?.properties['Перезарядка, действий']).toBe(
      weapons.entries.find((row) => row.weaponTypeId === 'ITM-WPN-003')!.template.properties[
        'Перезарядка, действий'
      ],
    );
    expect(() =>
      readNpcInventoryRequest([
        { ...item(), profile: { ...request, properties: { Ёмкость: 900 } } },
      ]),
    ).toThrow('unexpected');
    expect(() => resolveNpcWeaponProfiles(weapons, itemTypeId, ['SHIELD'], masterProfile)).toThrow(
      'host-bound',
    );
    expect(() =>
      resolveNpcWeaponProfiles(weapons, 'ITM-WPN-001', ['DEFAULT'], {
        kind: 'CATALOG',
      }),
    ).toThrow('formula validation');
  });
  it('retains shield HP zero as an explicit state and rejects an invented larger maximum', () => {
    const profiles = resolveNpcWeaponProfiles(weapons, 'ITM-WPN-027', ['SHIELD'], {
      kind: 'CATALOG',
    });
    const shield = {
      ...item('ITM-WPN-027'),
      linkedSetInstanceId: id(4),
      componentRole: 'SHIELD' as const,
    };
    for (const shieldCurrentHP of [0, 200])
      expect(() =>
        validateNpcCatalogueItemState(
          definition(shield.itemTypeId),
          { ...shield, shieldCurrentHP },
          profiles,
        ),
      ).not.toThrow();
    expect(() =>
      validateNpcCatalogueItemState(
        definition(shield.itemTypeId),
        { ...shield, shieldCurrentHP: 201 },
        profiles,
      ),
    ).toThrow('shield capacity');
    expect(() =>
      validateNpcCatalogueItemState(
        definition(shield.itemTypeId),
        { ...shield, linkedSetInstanceId: null },
        profiles,
      ),
    ).toThrow('component');
  });
  it('uses actual armor coverage and seal applicability, without applying PC armor-count restrictions', () => {
    const armor = { ...item('ITM-ARM-001'), bodyZone: 'TORSO' as const };
    expect(() =>
      validateNpcCatalogueItemState(definition(armor.itemTypeId), armor, []),
    ).not.toThrow();
    expect(() =>
      validateNpcCatalogueItemState(definition(armor.itemTypeId), { ...armor, bodyZone: null }, []),
    ).toThrow('zone');
    const suit = { ...item('ITM-ARM-005'), sealed: false };
    expect(() =>
      validateNpcCatalogueItemState(definition(suit.itemTypeId), suit, []),
    ).not.toThrow();
    expect(() =>
      validateNpcCatalogueItemState(definition(suit.itemTypeId), { ...suit, bodyZone: 'HEAD' }, []),
    ).toThrow('zone');
    expect(() =>
      validateNpcCatalogueItemState(definition('RES-MAG-001'), item('RES-MAG-001'), []),
    ).toThrow('unavailable');
  });
  it('binds composite roles to real attacks and preserves the nonattacking Cornadora shield', () => {
    const shield = {
      ...item('ITM-WPN-026'),
      linkedSetInstanceId: id(4),
      componentRole: 'SHIELD' as const,
      shieldCurrentHP: 400,
    };
    const noAttack = resolveNpcWeaponProfiles(weapons, shield.itemTypeId, [], { kind: 'CATALOG' });
    expect(noAttack).toEqual([]);
    expect(
      definition(shield.itemTypeId).components.find((entry) => entry.role === 'SHIELD')
        ?.shieldMaxHPOrNull,
    ).toBe(400);
    expect(() =>
      validateNpcCatalogueItemState(definition(shield.itemTypeId), shield, noAttack),
    ).not.toThrow();
    const sword = resolveNpcWeaponProfiles(weapons, shield.itemTypeId, ['SWORD'], {
      kind: 'CATALOG',
    });
    expect(() =>
      validateNpcCatalogueItemState(definition(shield.itemTypeId), shield, sword),
    ).toThrow('physical component');
    expect(() =>
      validateNpcCatalogueItemState(
        definition(shield.itemTypeId),
        { ...shield, componentRole: 'RAPIER' },
        sword,
      ),
    ).toThrow('not a component');
    const blarade = {
      ...item('ITM-WPN-027'),
      linkedSetInstanceId: id(5),
      componentRole: 'RAPIER' as const,
    };
    const rapier = resolveNpcWeaponProfiles(weapons, blarade.itemTypeId, ['RAPIER'], {
      kind: 'CATALOG',
    });
    const attackingShield = resolveNpcWeaponProfiles(weapons, blarade.itemTypeId, ['SHIELD'], {
      kind: 'CATALOG',
    });
    expect(() =>
      validateNpcCatalogueItemState(definition(blarade.itemTypeId), blarade, rapier),
    ).not.toThrow();
    expect(() =>
      validateNpcCatalogueItemState(definition(blarade.itemTypeId), blarade, attackingShield),
    ).toThrow('physical component');
    expect(() =>
      validateNpcCatalogueItemState(
        definition(blarade.itemTypeId),
        { ...blarade, shieldCurrentHP: 200 },
        rapier,
      ),
    ).toThrow('shield capacity');
    expect(() =>
      validateNpcCatalogueItemState(
        definition(blarade.itemTypeId),
        { ...blarade, componentRole: 'SWORD' },
        attackingShield,
      ),
    ).toThrow('not a component');
  });
  it('refuses a missing weapon identity and incomplete mechanical source columns', () => {
    const rows = source('catalogue') as Record<string, unknown>[];
    expect(() =>
      createNpcInventoryCatalog(
        rows.filter((row) => row['ItemTypeID'] !== 'ITM-WPN-003'),
        source('armor-profiles'),
        source('pharmaceuticals'),
        weapons,
      ),
    ).toThrow('orphan weapon');
    for (const key of ['Броня: исходное выражение', 'Физическая броня', 'M', 'Акробатика']) {
      const armor = source('armor-profiles') as Record<string, unknown>[];
      delete armor[1]![key];
      expect(() =>
        createNpcInventoryCatalog(source('catalogue'), armor, source('pharmaceuticals'), weapons),
      ).toThrow(/missing source field|column presence/);
    }
    const pharma = source('pharmaceuticals') as Record<string, unknown>[];
    delete pharma[1]!['Макс. доз/24ч'];
    expect(() =>
      createNpcInventoryCatalog(source('catalogue'), source('armor-profiles'), pharma, weapons),
    ).toThrow('missing source field');
  });
});

describe('NPC-015 actual armor contribution without PC starting limits', () => {
  const armor = (
    n: number,
    type: string,
    zone: 'HEAD' | 'TORSO' | 'ARM_L' | 'ARM_R' | 'LEG_L' | 'LEG_R' | null,
  ) => ({
    itemInstanceId: id(n),
    itemTypeId: type,
    bodyZoneOrNull: zone,
    sealedOrNull: type === 'ITM-ARM-005' ? true : null,
  });
  it('keeps seven separate R6 layers in one zone and never allocates or rolls', () => {
    const input = Array.from({ length: 7 }, (_, index) => armor(index + 1, 'ITM-ARM-001', 'ARM_L'));
    const before = JSON.stringify(input);
    const result = deriveNpcArmorContribution(catalog, input);
    expect(result.requiredStrength).toBe(14);
    expect(result.layersByZone.ARM_L).toEqual(
      input.map((piece) => ({
        itemInstanceId: piece.itemInstanceId,
        definition: { dieSides: 6, multiplier: 1, constant: 0 },
      })),
    );
    expect(result.layersByZone.ARM_R).toEqual([]);
    expect(result.compatibilityRequiredItemIds).toEqual([]);
    expect(JSON.stringify(input)).toBe(before);
    expect(deriveNpcArmorContribution(catalog, JSON.parse(before))).toEqual(result);
    expect(Object.isFrozen(result.layersByZone.ARM_L)).toBe(true);
  });
  it('applies each conditional M penalty once by type, and running/acrobatics per piece', () => {
    const input = [
      armor(1, 'ITM-ARM-002', 'HEAD'),
      armor(2, 'ITM-ARM-002', 'TORSO'),
      armor(3, 'ITM-ARM-002', 'ARM_L'),
      armor(4, 'ITM-ARM-002', 'ARM_R'),
      armor(5, 'ITM-ARM-003', 'HEAD'),
      armor(6, 'ITM-ARM-003', 'TORSO'),
      armor(7, 'ITM-ARM-003', 'ARM_L'),
      armor(8, 'ITM-ARM-004', 'LEG_L'),
      armor(9, 'ITM-ARM-004', 'LEG_R'),
    ];
    expect(deriveNpcArmorContribution(catalog, input)).toMatchObject({
      requiredStrength: 29,
      mobilityModifier: -6,
      runningModifier: -11,
      acrobaticsModifier: -11,
      dodgeModifier: 0,
    });
    const more = deriveNpcArmorContribution(catalog, [...input, armor(10, 'ITM-ARM-004', 'HEAD')]);
    expect(more.mobilityModifier).toBe(-11);
    expect(more.runningModifier).toBe(-13);
    expect(more.layersByZone.HEAD.map((row) => row.itemInstanceId)).toEqual([id(1), id(5), id(10)]);
  });
  it('counts a full suit once and retains one shared D20 definition in each covered zone', () => {
    const result = deriveNpcArmorContribution(catalog, [armor(1, 'ITM-ARM-008', null)]);
    expect(result).toMatchObject({
      requiredStrength: 24,
      mobilityModifier: -5,
      runningModifier: -12,
      acrobaticsModifier: -12,
      dodgeModifier: -6,
    });
    expect(Object.values(result.layersByZone)).toEqual(
      Array.from({ length: 6 }, () => [
        { itemInstanceId: id(1), definition: { dieSides: 20, multiplier: 2, constant: 5 } },
      ]),
    );
    expect(result.compatibilityRequiredItemIds).toEqual([]);
  });
  it('reports exact mixed full-suit selection requiring a real GM compatibility decision', () => {
    const input = [armor(1, 'ITM-ARM-006', null), armor(2, 'ITM-ARM-001', 'TORSO')];
    const result = deriveNpcArmorContribution(catalog, input);
    expect(result.requiredStrength).toBe(22);
    expect(result.compatibilityRequiredItemIds).toEqual([id(1), id(2)]);
    expect(result.layersByZone.TORSO).toHaveLength(2);
    expect(result.layersByZone.HEAD).toHaveLength(1);
    expect(Object.hasOwn(result, 'compatibilityConfirmed')).toBe(false);
  });
  it('counts constant full-suit penalties per physical suit rather than once per armor type', () => {
    const result = deriveNpcArmorContribution(catalog, [
      armor(1, 'ITM-ARM-006', null),
      armor(2, 'ITM-ARM-006', null),
    ]);
    expect(result).toMatchObject({
      requiredStrength: 40,
      mobilityModifier: -6,
      runningModifier: -12,
      acrobaticsModifier: -12,
      dodgeModifier: 0,
      compatibilityRequiredItemIds: [id(1), id(2)],
    });
    expect(Object.values(result.layersByZone)).toEqual(
      Array.from({ length: 6 }, () => [
        { itemInstanceId: id(1), definition: { dieSides: 20, multiplier: 1, constant: 0 } },
        { itemInstanceId: id(2), definition: { dieSides: 20, multiplier: 1, constant: 0 } },
      ]),
    );
  });
  it('keeps Neit physical armor absent and its explicit seal state without inventing a zero layer', () => {
    const input = armor(1, 'ITM-ARM-005', null);
    for (const sealedOrNull of [true, false]) {
      const result = deriveNpcArmorContribution(catalog, [{ ...input, sealedOrNull }]);
      expect(Object.values(result.layersByZone)).toEqual(Array.from({ length: 6 }, () => []));
      expect(result.pieces[0]?.piece.sealedOrNull).toBe(sealedOrNull);
      expect(result.pieces[0]?.profile.physicalArmorOrNull).toBeNull();
      expect(result.requiredStrength).toBe(6);
    }
    expect(() =>
      deriveNpcArmorContribution(catalog, [input, armor(2, 'ITM-ARM-001', 'TORSO')]),
    ).toThrow('does not allow layers');
  });
  it.each([
    [armor(1, 'ITM-ARM-001', 'HEAD'), armor(1, 'ITM-ARM-002', 'TORSO')],
    [armor(1, 'ITM-ARM-001', null)],
    [armor(1, 'ITM-ARM-006', 'HEAD')],
    [{ ...armor(1, 'ITM-ARM-005', null), sealedOrNull: null }],
    [{ ...armor(1, 'ITM-ARM-001', 'HEAD'), sealedOrNull: false }],
    [{ ...armor(1, 'ITM-ARM-001', 'HEAD'), physicalArmor: 999 }],
    [armor(1, 'ITM-WPN-003', null)],
    [armor(1, 'unknown', null)],
  ])('refuses malformed or contradictory physical armor: %j', (...values) => {
    expect(() => deriveNpcArmorContribution(catalog, values)).toThrow();
  });
  it('refuses accessor input without invoking it and preserves exact absence for empty equipment', () => {
    let called = false;
    const bad = { ...armor(1, 'ITM-ARM-001', 'HEAD') };
    Object.defineProperty(bad, 'bodyZoneOrNull', {
      enumerable: true,
      get() {
        called = true;
        return 'HEAD';
      },
    });
    expect(() => deriveNpcArmorContribution(catalog, [bad])).toThrow();
    expect(called).toBe(false);
    const result = deriveNpcArmorContribution(catalog, []);
    expect(result).toMatchObject({
      pieces: [],
      requiredStrength: 0,
      mobilityModifier: 0,
      runningModifier: 0,
      acrobaticsModifier: 0,
      dodgeModifier: 0,
      compatibilityRequiredItemIds: [],
    });
    expect(Object.values(result.layersByZone)).toEqual(Array.from({ length: 6 }, () => []));
  });
});
