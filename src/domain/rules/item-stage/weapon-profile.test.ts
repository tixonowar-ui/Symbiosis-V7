import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadWeaponProfileCatalog } from '../../../host/weapon-profile-catalog.js';
import type { StartingWeaponVariant } from './starting-weapon.js';
import {
  canonicalFixedWeaponProfile,
  findWeaponProfile,
  parseWeaponFormula,
  validateFixedWeaponProfile,
  validateWeaponProfile,
  weaponProfilePlayerFacts,
  type WeaponProfileCatalog,
  type WeaponProfileInputs,
} from './weapon-profile.js';

let catalog: WeaponProfileCatalog;
beforeAll(async () => {
  catalog = await loadWeaponProfileCatalog(fileURLToPath(new URL('../../../../', import.meta.url)));
});
const selection = (
  weaponTypeId = 'ITM-WPN-001',
  weaponVariant: StartingWeaponVariant = 'DEFAULT',
) => ({ weaponTypeId, weaponVariant });
const crossbow: WeaponProfileInputs = {
  commonWitness: { L: 1, Lw: 10, Ls: 4 },
  independentDice: { R12_DMG: 2, R12_RANGE: 2, R20_RS: 2 },
  formulaOutputs: { Dm: 3, Rn: 6, Rs: 1, Rd: 2 },
};

describe('CORE-185 / CHR-023 exact common weapon-profile witness', () => {
  // Evaluated independently from Item Registry 05 with L=1,Lw=10,Ls=4 and each die=2.
  it.each([
    ['ITM-WPN-001', 'DEFAULT', { Dm: 3, Rn: 6, Rs: 1, Rd: 2 }],
    ['ITM-WPN-002', 'DEFAULT', { Dm: 3, Rn: 6, Rs: 1, Rd: 2 }],
    ['ITM-WPN-007', 'DEFAULT', { Dm: 3, Rn: 6, Rs: 5, Rd: 5 }],
    ['ITM-WPN-008', 'DEFAULT', { Dm: 3, Rn: 6, Rs: 6, Rd: 7 }],
    ['ITM-WPN-009', 'DEFAULT', { Dm: 3, Rn: 6.5, Rs: 8, Rd: 9 }],
    ['ITM-WPN-010', 'DEFAULT', { Rs: 24, Rd: 10 }],
    ['ITM-WPN-011', 'DEFAULT', { Rs: 25, Rd: 25 }],
    ['ITM-WPN-012', 'ONE_HAND', { Rs: 31, Rd: 15 }],
    ['ITM-WPN-012', 'TWO_HAND', { Rs: 18, Rd: 15 }],
    ['ITM-WPN-013', 'DEFAULT', { Rs: 31, Rd: 25 }],
    ['ITM-WPN-014', 'DEFAULT', { Rs: 15, Rd: 31 }],
    ['ITM-WPN-015', 'DEFAULT', { Rs: 21, Rd: 21 }],
    ['ITM-WPN-016', 'DEFAULT', { Rs: 15, Rd: 25 }],
    ['ITM-WPN-017', 'DEFAULT', { Rs: 18, Rd: 25 }],
    ['ITM-WPN-018', 'DEFAULT', { Rs: 28, Rd: 25 }],
    ['ITM-WPN-019', 'DEFAULT', { Rs: 31, Rd: 28 }],
    ['ITM-WPN-020', 'DEFAULT', { Rs: 31, Rd: 25 }],
    ['ITM-WPN-021', 'DEFAULT', { Rs: 18, Rd: 25 }],
    ['ITM-WPN-022', 'DEFAULT', { Rs: 27, Rd: 24 }],
    ['ITM-WPN-023', 'DEFAULT', { Rs: 31, Rd: 25 }],
    ['ITM-WPN-024', 'DEFAULT', { Rs: 30, Rd: 24 }],
    ['ITM-WPN-025', 'DEFAULT', { Rs: 37, Rd: 24 }],
  ] as const)(
    'validates the complete joint certificate for %s/%s',
    (id, variant, formulaOutputs) => {
      const selected = selection(id, variant);
      const entry = findWeaponProfile(catalog, selected);
      const inputs: WeaponProfileInputs = {
        commonWitness: crossbow.commonWitness,
        independentDice: Object.fromEntries(
          entry.formula!.independentDice.map(({ key }) => [key, 2]),
        ),
        formulaOutputs,
      };
      const result = validateWeaponProfile(catalog, selected, inputs);
      expect(result.status).toBe('VALID');
      if (result.status !== 'VALID') throw new Error('expected reachable source fixture');
      expect(result.proof).toEqual({
        ...inputs,
        formulaId: entry.formula!.formulaId,
        formulaVersion: 'ITEM_FORMULAS_V1.2',
      });
      expect(result.profile.statRequirements).toEqual({
        S: formulaOutputs.Rs,
        D: formulaOutputs.Rd,
      });
      expect(result.profile.damageDefinition).toEqual(entry.template.damageDefinition);
      expect(result.profile.penetrationDefinition).toEqual(entry.template.penetrationDefinition);
      expect(result.profile.properties).toEqual(entry.template.properties);
      expect(result.profile.statSource).toBe('PLAYER_FORMULA_VALIDATED');
      expect(weaponProfilePlayerFacts(result.profile)).not.toEqual([]);
      expect(JSON.stringify(weaponProfilePlayerFacts(result.profile))).not.toMatch(
        /CORE-|F-WPN-|CVD-|RG-|ITM-|Источник|availabilityTrace/,
      );
    },
  );

  it('rejects a within-bounds output which belongs to a different witness', () => {
    const result = validateWeaponProfile(catalog, selection(), {
      ...crossbow,
      formulaOutputs: { ...crossbow.formulaOutputs, Dm: 4 },
    });
    expect(result).toMatchObject({ status: 'INVALID', invalidFieldSet: ['formulaOutputs.Dm'] });
  });

  it('reuses computed Dm and Rn in order, not the requested forged outputs', () => {
    const result = validateWeaponProfile(catalog, selection(), {
      ...crossbow,
      formulaOutputs: { Dm: 4, Rn: 7, Rs: 1, Rd: 2 },
    });
    expect(result).toMatchObject({
      status: 'INVALID',
      invalidFieldSet: ['formulaOutputs.Dm', 'formulaOutputs.Rn'],
    });
  });

  it('retains independent die identities even when their side counts coincide', () => {
    const result = validateWeaponProfile(catalog, selection(), {
      ...crossbow,
      independentDice: { R12_DMG: 3, R12_RANGE: 1, R20_RS: 2 },
      formulaOutputs: { Dm: 4, Rn: 6, Rs: 1, Rd: 2 },
    });
    expect(result.status).toBe('VALID');
    expect(
      validateWeaponProfile(catalog, selection(), {
        ...crossbow,
        independentDice: { R12_DMG: 2, R20_RS: 2 },
      }).status,
    ).toBe('INVALID');
  });

  it.each([
    null,
    [],
    {},
    { ...crossbow, commonWitness: { L: 1, Lw: 10 } },
    { ...crossbow, commonWitness: { L: -1, Lw: 10, Ls: 0 } },
    { ...crossbow, commonWitness: { L: 1.5, Lw: 10, Ls: 0 } },
    { ...crossbow, commonWitness: { L: 1, Lw: 0, Ls: 0 } },
    { ...crossbow, commonWitness: { L: Number.MAX_SAFE_INTEGER + 1, Lw: 10, Ls: 0 } },
    { ...crossbow, commonWitness: { L: 1, Lw: 10, Ls: 0, S: 10 } },
    { ...crossbow, independentDice: { R12_DMG: 0, R12_RANGE: 2, R20_RS: 2 } },
    { ...crossbow, independentDice: { R12_DMG: 13, R12_RANGE: 2, R20_RS: 2 } },
    { ...crossbow, independentDice: { R12_DMG: 2, R12_RANGE: 2, R20_RS: 21 } },
    { ...crossbow, independentDice: { R12_DMG: 2, R12_RANGE: 2, R20_RS: 2, armorQuality: 2 } },
    { ...crossbow, independentDice: [2, 2, 2] },
    { ...crossbow, formulaOutputs: { Dm: 3, Rn: 6, Rs: 1 } },
    { ...crossbow, formulaOutputs: { ...crossbow.formulaOutputs, accuracyBonus: 1 } },
    { ...crossbow, formulaOutputs: { ...crossbow.formulaOutputs, Rn: 6.5 } },
    { ...crossbow, formulaOutputs: { ...crossbow.formulaOutputs, Rs: Infinity } },
    { ...crossbow, formulaOutputs: { ...crossbow.formulaOutputs, Rs: '1' } },
    { ...crossbow, requestId: 'foreign' },
  ])('rejects malformed, out-of-domain or partial proposed input %j', (input) => {
    expect(validateWeaponProfile(catalog, selection(), input as WeaponProfileInputs).status).toBe(
      'INVALID',
    );
  });

  it('permits zero Lw where the formula divides by Lw+die instead of Lw', () => {
    const result = validateWeaponProfile(catalog, selection('ITM-WPN-007'), {
      commonWitness: { L: 0, Lw: 0, Ls: 0 },
      independentDice: { R6_DMG: 1, R12_RANGE: 1, R20_RS: 1, R6_RD: 1 },
      formulaOutputs: { Dm: 1, Rn: 2, Rs: 5, Rd: 6 },
    });
    expect(result.status).toBe('VALID');
  });

  it('does not invent a maximum level and keeps arithmetic exact above Number products', () => {
    const level = Number.MAX_SAFE_INTEGER;
    const result = validateWeaponProfile(catalog, selection('ITM-WPN-010'), {
      commonWitness: { L: level, Lw: level, Ls: level },
      independentDice: { R4_RS: 4, R4_RD: 4 },
      formulaOutputs: { Rs: 11, Rd: 6 },
    });
    expect(result.status).toBe('VALID');
  });

  it('never mutates the proposed input or the canonical template', () => {
    const inputs = structuredClone(crossbow);
    const before = structuredClone(catalog);
    const result = validateWeaponProfile(catalog, selection(), inputs);
    expect(catalog).toEqual(before);
    expect(inputs).toEqual(crossbow);
    if (result.status !== 'VALID') throw new Error('expected valid fixture');
    expect(result.proof.commonWitness).not.toBe(inputs.commonWitness);
    expect(result.proof.independentDice).not.toBe(inputs.independentDice);
  });
});

describe('CORE-186 / CHR-024 immutable canonical profile', () => {
  it('accepts all fixed variants and rejects edits, extra fields and removed properties', () => {
    for (const entry of catalog.entries.filter((item) => item.profileKind === 'FIXED')) {
      const selected = selection(entry.weaponTypeId, entry.weaponVariant);
      const canonical = canonicalFixedWeaponProfile(catalog, selected);
      expect(validateFixedWeaponProfile(catalog, selected, canonical)).toBe(true);
      expect(
        validateFixedWeaponProfile(catalog, selected, { ...canonical, statRequirements: {} }),
      ).toBe(false);
      expect(validateFixedWeaponProfile(catalog, selected, { ...canonical, equipped: true })).toBe(
        false,
      );
      expect(validateFixedWeaponProfile(catalog, selected, { ...canonical, properties: {} })).toBe(
        false,
      );
      expect(validateWeaponProfile(catalog, selected, crossbow).status).toBe('INVALID');
    }
  });
  it('retains the supplied numeric and runtime-dice properties without resolving them', () => {
    const kensi = canonicalFixedWeaponProfile(catalog, selection('ITM-WPN-003'));
    expect(kensi.statRequirements).toEqual({ S: 8, D: 19 });
    expect(kensi.rangeMeters).toBe(20);
    expect(kensi.damageDefinition).toMatchObject({ valueMode: 'CONSTANT', baseExpression: '10' });
    expect(kensi.penetrationDefinition).toMatchObject({
      valueMode: 'PER_ATTACK_ROLL',
      baseExpression: 'ROLL(R12)',
    });
    expect(kensi.properties['Ёмкость']).toBe('8');
    const ainzbern = canonicalFixedWeaponProfile(catalog, selection('ITM-WPN-006'));
    expect(ainzbern.statRequirements).toEqual({ S: 22, D: 22, I: 12 });
    expect(ainzbern.properties['Требования']).toContain('Стрельба ≥ средняя');
  });
  it('refuses invalid pairs and formula weapons on the fixed path', () => {
    expect(() => canonicalFixedWeaponProfile(catalog, selection())).toThrow('requires formula');
    expect(() => findWeaponProfile(catalog, selection('ITM-WPN-026', 'SHIELD'))).toThrow(
      'expected one',
    );
  });
});

describe('closed Item Registry formula grammar', () => {
  it.each([
    'Math.random()',
    'R6_RS ** 2',
    'R6_RS;process.exit()',
    'floor(L)',
    'CEIL(L,Lw)',
    'MAX(L)',
    'L+',
    'NaN',
    'eval(L)',
    'L[0]',
    'Lw > 0',
  ])('refuses %s', (source) => {
    expect(() => parseWeaponFormula(source, new Set(['L', 'Lw', 'R6_RS']))).toThrow(
      'weapon profile:',
    );
  });
});
