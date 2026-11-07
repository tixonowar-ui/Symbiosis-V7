import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadNpcAuthoringSourceCatalog,
  type NpcAuthoringSourceCatalog,
} from '../../../host/npc-catalog.js';
import { npcKensiRequest } from '../../../../tests/fixtures/npc-published-inventory.js';
import {
  buildNpcInventoryPreview,
  buildNpcInventoryPhysicalBasis,
} from './inventory-publication.js';
import { createNpcOrdinaryStatCatalog } from './ordinary-stat-profile.js';
import {
  createNpcEquipmentCatalog,
  deriveNpcEquipmentProfile,
  deriveNpcEquipmentPreparationProfile,
  deriveNpcEquipmentRequirementPenalties,
  readNpcEquipmentStatBasis,
  type NpcEquipmentCatalog,
} from './equipment-profile.js';
import type { NpcInventoryRequestEntry } from './inventory.js';

let source: NpcAuthoringSourceCatalog;
let catalog: NpcEquipmentCatalog;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
beforeAll(async () => {
  source = await loadNpcAuthoringSourceCatalog(
    fileURLToPath(new URL('../../../../', import.meta.url)),
  );
  const rules: unknown = JSON.parse(
    await readFile(new URL('../../../../generated/spec/rules/rules.json', import.meta.url), 'utf8'),
  );
  catalog = createNpcEquipmentCatalog(
    {
      inventory: source.inventory,
      publication: source.inventoryPublication,
      baseStats: source.baseStats,
      ordinaryStats: createNpcOrdinaryStatCatalog(
        {
          baseStats: source.baseStats,
          symbionts: source.symbionts,
          compositionConsequences: source.compositionConsequences,
        },
        rules,
      ),
    },
    rules,
  );
});
const schema = {
  raceCode: 'PURE',
  pureClassOrNull: 'SOLDIER',
  anatomyProfileId: 'STANDARD_HUMANOID',
  sex: 'MALE',
  massKg: 75,
};
const baseStats = { S: 20, D: 20, M: 20, Z: 20, I: 20, W: 20, C: 20 };
const armor = (
  n: number,
  type = 'ITM-ARM-002',
  zone: NpcInventoryRequestEntry['bodyZone'] = 'TORSO',
): NpcInventoryRequestEntry => ({
  ...npcKensiRequest(id(n)),
  itemTypeId: type,
  currentAmmo: null,
  bodyZone: zone,
  profile: { kind: 'CATALOG' },
  equipped: true,
  equippedSlots: zone === null ? ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'] : [zone],
  sealed: type === 'ITM-ARM-005' ? true : null,
});
function request(items: readonly NpcInventoryRequestEntry[]) {
  return {
    npcUuid: id(1),
    statInput: { schema, baseStats },
    inventoryPreview: buildNpcInventoryPreview(source.inventoryPublication, items),
    compatibilityProofOrNull: null,
  };
}

describe('NPC-015 exact equipped source profile', () => {
  it('prepares the same actual equipment arithmetic while retaining unresolved coating refs outside the full sheet', () => {
    const items = [armor(70), { ...npcKensiRequest(id(71)), coatingInstanceIds: [id(72)] }];
    const physicalInventoryBasis = buildNpcInventoryPhysicalBasis(
      source.inventoryPublication,
      items,
    );
    const prepared = deriveNpcEquipmentPreparationProfile(catalog, {
      npcUuid: id(1),
      statInput: { schema, baseStats },
      physicalInventoryBasis,
      compatibilityProofOrNull: null,
    });
    const normal = deriveNpcEquipmentProfile(
      catalog,
      request(items.map((item) => ({ ...item, coatingInstanceIds: [] }))),
    );
    expect(prepared).toEqual(normal);
    expect(readNpcEquipmentStatBasis(prepared)).toEqual(readNpcEquipmentStatBasis(normal));
    expect(() => buildNpcInventoryPreview(source.inventoryPublication, items)).toThrow('coating');
    expect(() =>
      deriveNpcEquipmentPreparationProfile(catalog, {
        npcUuid: id(1),
        statInput: { schema, baseStats },
        physicalInventoryBasis: {},
        compatibilityProofOrNull: null,
      }),
    ).toThrow('unissued');
  });
  it('retains nonattacking shield requirements without inventing or combining attack profiles', () => {
    const inventoryPreview = buildNpcInventoryPreview(source.inventoryPublication, [
      {
        ...npcKensiRequest(id(71)),
        itemTypeId: 'ITM-WPN-026',
        currentAmmo: null,
        linkedSetInstanceId: id(70),
        componentRole: 'SWORD',
        equipped: true,
        equippedSlots: ['HAND_L'],
      },
      {
        ...npcKensiRequest(id(72)),
        itemTypeId: 'ITM-WPN-026',
        currentAmmo: null,
        linkedSetInstanceId: id(70),
        componentRole: 'SHIELD',
        shieldCurrentHP: 400,
        equipped: true,
        equippedSlots: ['HAND_R'],
      },
    ]);
    const result = deriveNpcEquipmentRequirementPenalties(catalog, {
      inventoryPreview,
      effectiveStats: { ...baseStats, S: 20, D: 15 },
    });
    expect(result.weapons).toEqual(
      [71, 72].map((n) => ({
        itemInstanceId: id(n),
        statRequirements: { S: 22, D: 16 },
        deficits: { S: 2, D: 1 },
        deficitTotal: 3,
        penalty: 6,
      })),
    );
    expect(inventoryPreview.items[1]).not.toHaveProperty('stagedProfile');
  });
  it('retains an issued raw armor basis while computational M follows CORE-078', () => {
    const input = request([armor(10, 'ITM-ARM-008', null)]);
    const profile = deriveNpcEquipmentProfile(catalog, {
      ...input,
      statInput: {
        schema: { ...schema, pureClassOrNull: 'SEEKER' },
        baseStats: { ...baseStats, M: 1 },
      },
    });
    expect(profile.rawEquippedStats.M).toBe(-4);
    expect(profile.equippedStats.M).toBe(1);
    const basis = readNpcEquipmentStatBasis(profile);
    expect(basis.permanentStats.M).toBe(1);
    expect(basis.rawEquippedStats.M).toBe(-4);
    expect(Object.isFrozen(basis.rawEquippedStats)).toBe(true);
    expect(() => readNpcEquipmentStatBasis({ ...profile })).toThrow('issued equipment stat basis');
    expect(() => readNpcEquipmentStatBasis(JSON.parse(JSON.stringify(profile)))).toThrow(
      'issued equipment stat basis',
    );
  });
  it('sums actual CORE-016 deficits per weapon and all armor pieces without modifying stats', () => {
    const inventoryPreview = buildNpcInventoryPreview(source.inventoryPublication, [
      armor(10),
      armor(11, 'ITM-ARM-002', 'HEAD'),
      armor(12, 'ITM-ARM-002', 'ARM_L'),
      { ...npcKensiRequest(id(13)), equipped: true, equippedSlots: ['HAND_L'] },
    ]);
    const effectiveStats = { S: 6, D: 3, M: 10, C: 10, I: 10, Z: 10, W: 10 };
    const before = JSON.stringify(effectiveStats);
    const result = deriveNpcEquipmentRequirementPenalties(catalog, {
      inventoryPreview,
      effectiveStats,
    });
    expect(result.armor).toEqual({
      requiredStrength: 9,
      deficit: 3,
      penalty: 6,
      appliesTo: ['PHYSICAL_ACTION', 'MOVEMENT', 'ACTIVE_DEFENSE'],
    });
    expect(result.weapons).toEqual([
      {
        itemInstanceId: id(13),
        statRequirements: { S: 8, D: 19 },
        deficits: { S: 2, D: 16 },
        deficitTotal: 18,
        penalty: 36,
      },
    ]);
    expect(JSON.stringify(effectiveStats)).toBe(before);
    const exact = deriveNpcEquipmentRequirementPenalties(catalog, {
      inventoryPreview,
      effectiveStats: { ...effectiveStats, S: 9, D: 19 },
    });
    expect(exact.armor.penalty).toBe(0);
    expect(exact.weapons[0]?.penalty).toBe(0);
    expect(
      deriveNpcEquipmentRequirementPenalties(catalog, { inventoryPreview, effectiveStats }),
    ).toEqual(result);
  });
  it('derives all actual armor pieces and one threshold mobility penalty, with independent symbolic layers', () => {
    const input = request([
      armor(10),
      armor(11, 'ITM-ARM-002', 'HEAD'),
      armor(12, 'ITM-ARM-002', 'ARM_L'),
    ]);
    const result = deriveNpcEquipmentProfile(catalog, input);
    expect(result.equippedStats.M).toBe(22); // SOLDIER +5, three brigantine pieces CORE-050 -3.
    expect(result.armor).toMatchObject({
      requiredStrength: 9,
      mobilityModifier: -3,
      runningModifier: -3,
      acrobaticsModifier: -3,
    });
    expect(result.armor.layersByZone.TORSO).toEqual([
      { itemInstanceId: id(10), definition: { dieSides: 12, multiplier: 1, constant: 0 } },
    ]);
    expect(result.armor.layersByZone.LEG_L).toEqual([]);
    expect(result.compatibilityRequired).toBe(false);
    expect(result.classMovementModifier).toBe(0);
    expect(Object.isFrozen(result.armor.layersByZone.TORSO)).toBe(true);
  });
  it('requires exact physical compatibility for current whole-suit layers and does not use a boolean grant', () => {
    const input = request([armor(10, 'ITM-ARM-006', null), armor(11, 'ITM-ARM-001', 'HEAD')]);
    expect(deriveNpcEquipmentProfile(catalog, input)).toMatchObject({
      compatibilityRequired: true,
      compatibilityProofOrNull: null,
    });
    const proof = {
      confirmationId: 'actual-gm-confirm-operation',
      npcUuid: id(1),
      itemInstanceIds: [id(10), id(11)],
      reason: 'Проверены слои',
    };
    const result = deriveNpcEquipmentProfile(catalog, {
      ...input,
      compatibilityProofOrNull: proof,
    });
    expect(result).toMatchObject({ compatibilityRequired: false, compatibilityProofOrNull: proof });
    for (const patch of [
      { npcUuid: id(2) },
      { itemInstanceIds: [id(11), id(10)] },
      { reason: '' },
      { confirmed: true },
    ])
      expect(() =>
        deriveNpcEquipmentProfile(catalog, {
          ...input,
          compatibilityProofOrNull: { ...proof, ...patch },
        }),
      ).toThrow();
    expect(() =>
      deriveNpcEquipmentProfile(catalog, { ...request([]), compatibilityProofOrNull: proof }),
    ).toThrow();
  });
  it('retains actual strength requirements for final effect evaluation instead of an early refusal', () => {
    const input = request([armor(10, 'ITM-ARM-008', null)]);
    const result = deriveNpcEquipmentProfile(catalog, {
      ...input,
      statInput: { schema, baseStats: { ...baseStats, S: 1, M: 1 } },
    });
    expect(result.armor.requiredStrength).toBe(24);
    expect(result.equippedStats.S).toBe(6);
    expect(result.equippedStats.M).toBe(1); // 1 + Soldier 5 - Glenheim 5; no invented floor.
  });
  it('preserves the class movement penalty separately from M and ordinary armor check modifiers', () => {
    const input = request([armor(10, 'ITM-ARM-006', null)]);
    const result = deriveNpcEquipmentProfile(catalog, {
      ...input,
      statInput: { schema: { ...schema, pureClassOrNull: 'SEEKER' }, baseStats },
    });
    expect(result.classMovementModifier).toBe(-15);
    expect(result.armor.runningModifier).toBe(-6);
    expect(result.equippedStats.M).toBe(17);
  });
  it('uses a real sealed equipped Nate to suppress the Skunk source modifier before caps', () => {
    const skunk = source.symbionts.species.find((s) => s.speciesKey === 'SKUNK')!;
    const compositionProof = {
      identityKey: id(1),
      binding: { journalId: id(2), raceCode: 'UNITED' },
      confirmations: [
        {
          input: {
            kind: 'APPLY_COMPOSITION_EDIT',
            factId: id(3),
            journalId: id(2),
            ordinal: 1,
            raceCode: 'UNITED',
            additions: [
              {
                symbiontInstanceId: id(4),
                speciesKey: skunk.speciesKey,
                targetLevel: 1,
                learnedNodeRefs: source.development.nodes
                  .filter((n) => n.speciesKey === 'SKUNK' && n.level <= 1)
                  .map((n) => n.nodeRef),
                binding: { kind: 'NONE' },
                currentOE: 0,
              },
            ],
            removals: [],
            buildChanges: [],
            currentOeChanges: [],
          },
          confirmationCommandId: id(5),
          diceModeSnapshot: 'MANUAL',
        },
      ],
      resolutions: [],
    };
    const input = {
      ...request([armor(10, 'ITM-ARM-005', null)]),
      statInput: {
        schema: { ...schema, raceCode: 'UNITED', pureClassOrNull: null },
        baseStats,
        compositionProof,
      },
    };
    expect(deriveNpcEquipmentProfile(catalog, input)).toMatchObject({
      equippedHermeticNate: true,
      equippedStats: { C: 20 },
    });
    for (const item of [
      { ...armor(10, 'ITM-ARM-005', null), sealed: false },
      { ...armor(10, 'ITM-ARM-005', null), equipped: false, equippedSlots: [] },
    ]) {
      const result = deriveNpcEquipmentProfile(catalog, {
        ...input,
        inventoryPreview: buildNpcInventoryPreview(source.inventoryPublication, [item]),
      });
      expect(result).toMatchObject({ equippedHermeticNate: false, equippedStats: { C: 10 } });
    }
    expect(() => deriveNpcEquipmentProfile(catalog, { ...input, npcUuid: id(99) })).toThrow(
      'another NPC',
    );
  });
  it('recomputes armor mechanics and refuses getters, unknown fields and a forged catalog', () => {
    const input = request([armor(10)]),
      item = input.inventoryPreview.items[0]!;
    if (!('armorProfile' in item)) throw new Error('armor fixture');
    expect(() =>
      deriveNpcEquipmentProfile(catalog, {
        ...input,
        inventoryPreview: {
          items: [
            {
              ...item,
              armorProfile: {
                ...item.armorProfile,
                mobilityModifierOrNull: null,
                requiredStrength: 0,
              },
            },
          ],
        },
      }),
    ).toThrow();
    let calls = 0;
    expect(() =>
      deriveNpcEquipmentProfile(catalog, {
        ...input,
        get npcUuid() {
          calls++;
          return id(1);
        },
      }),
    ).toThrow();
    expect(calls).toBe(0);
    expect(() =>
      deriveNpcEquipmentProfile(catalog, { ...input, equippedHermeticNate: true }),
    ).toThrow();
    expect(() =>
      deriveNpcEquipmentProfile({ kind: 'SOURCE_BOUND_NPC_EQUIPMENT' }, input),
    ).toThrow();
  });
});
