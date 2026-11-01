import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadWeaponProfileCatalog } from '../../../host/weapon-profile-catalog.js';
import { projectAdmissionWeaponProfile } from '../../../host/campaign-admission-mechanics.js';
import type {
  WeaponEffectiveProfile,
  WeaponProfileCatalog,
  WeaponProfileCatalogEntry,
} from './weapon-profile.js';
import { validateWeaponProfile } from './weapon-profile.js';
import {
  deriveMasterWeaponProfile,
  stageValidatedWeaponProfile,
  type MasterWeaponExpression,
  type MasterWeaponProfileInput,
} from './master-weapon-profile.js';

let catalog: WeaponProfileCatalog;
beforeAll(async () => {
  catalog = await loadWeaponProfileCatalog(fileURLToPath(new URL('../../../../', import.meta.url)));
});
const selection = (entry: WeaponProfileCatalogEntry) => ({
  weaponTypeId: entry.weaponTypeId,
  weaponVariant: entry.weaponVariant,
});
function completeInput(
  entry: WeaponProfileCatalogEntry,
  profile: WeaponEffectiveProfile = entry.template,
): MasterWeaponProfileInput {
  return {
    weaponVariantId: entry.weaponVariant,
    damageDefinition: { kind: 'RETAIN' },
    penetrationDefinition: { kind: 'RETAIN' },
    statRequirements: { ...profile.statRequirements },
    // These explicit GM values exercise bypass of formula constraints; no production dice.
    instanceDamageOrNull:
      profile.damageDefinition.valueMode === 'INSTANCE_VALUE'
        ? (profile.instanceDamage ?? 1000.5)
        : null,
    rangeMetersOrNull:
      profile.rangeMeters ??
      (entry.formula?.outputs.some((output) => output.key === 'Rn') ? 10000.5 : null),
    accuracyBonusOrNull: null,
  };
}
const entry = (id = 'ITM-WPN-001') => catalog.entries.find((entry) => entry.weaponTypeId === id)!;

describe('CORE-183/187/188/189/190 admission master weapon profiles', () => {
  it('retains every complete fixed template and derives full formula-type grants without a witness', () => {
    const original = JSON.stringify(catalog);
    for (const candidate of catalog.entries) {
      const input = completeInput(candidate);
      const profile = deriveMasterWeaponProfile(catalog, selection(candidate), input, null);
      expect(profile.weaponTypeId).toBe(candidate.weaponTypeId);
      expect(profile.weaponVariantId).toBe(candidate.weaponVariant);
      expect(profile.properties).toEqual(candidate.template.properties);
      expect(profile.statSource).toBe(
        candidate.profileKind === 'FIXED' ? 'TEMPLATE_FIXED' : 'MASTER_OVERRIDE',
      );
      expect(profile.damageDefinition).toEqual(
        stageValidatedWeaponProfile(candidate.template).damageDefinition,
      );
      expect(profile.penetrationDefinition).toEqual(
        stageValidatedWeaponProfile(candidate.template).penetrationDefinition,
      );
      expect(JSON.stringify(profile)).not.toMatch(
        /definitionId|rollGroupId|itemInstanceId|weaponProfileVersionId|validationWitness|commonWitness/,
      );
      const projected = projectAdmissionWeaponProfile(profile);
      expect(projected.weaponTypeId).toBe(candidate.weaponTypeId);
      expect(projected.instanceDamageOrNull).toBe(input.instanceDamageOrNull);
    }
    expect(JSON.stringify(catalog)).toBe(original);
  });
  it.each([
    ['R4', null, 'ROLL(R4)', 'OTHER_DIE'],
    ['R4+X', 0.1, 'ROLL(R4)+0.1', 'OTHER_DIE'],
    ['R6', null, 'ROLL(R6)', 'OTHER_DIE'],
    ['R6+X', 0.5, 'ROLL(R6)+0.5', 'OTHER_DIE'],
    ['R12', null, 'ROLL(R12)', 'OTHER_DIE'],
    ['R12+X', 99999.5, 'ROLL(R12)+99999.5', 'OTHER_DIE'],
    ['R20+X', 1, 'ROLL(R20)+1', 'D20'],
    ['R20*2+X', 1.5, '2*ROLL(R20)+1.5', 'D20'],
  ] as const)(
    'normalizes %s as one independently addressed attack roll per value',
    (pattern, constantOrNull, expression, dieType) => {
      const candidate = entry('ITM-WPN-016'),
        base = candidate.template;
      const definition: MasterWeaponExpression = { kind: 'MASTER_DICE', pattern, constantOrNull };
      const profile = deriveMasterWeaponProfile(
        catalog,
        selection(candidate),
        {
          ...completeInput(candidate),
          damageDefinition: definition,
          penetrationDefinition: definition,
          instanceDamageOrNull: null,
        },
        null,
      );
      expect(profile.damageDefinition).toMatchObject({
        valueMode: 'PER_ATTACK_ROLL',
        baseExpression: expression,
        evaluationScope: 'EACH_RESOLVED_ATTACK',
        dieType,
        progressionEligibility: dieType === 'D20' ? 'NO_DIRECT_BUT_POOL' : 'NEVER_PROGRESSION',
      });
      expect(profile.penetrationDefinition.baseExpression).toBe(expression);
      expect(profile.damageDefinition).not.toBe(profile.penetrationDefinition);
      expect(profile.damageDefinition.damageModifierStat).toBe(
        base.damageDefinition.damageModifierStat,
      );
      expect(profile.damageDefinition.conditionalOverride).toBe(
        base.damageDefinition.conditionalOverride,
      );
      expect(profile.damageDefinition.effectiveTemplateExpression).toBe(
        `${expression}+attacker.${base.damageDefinition.damageModifierStat}`,
      );
      expect(profile.properties).toEqual(base.properties);
    },
  );
  it('retains an existing bare R20 but refuses to select it as a new master expression', () => {
    const candidate = entry('ITM-WPN-002');
    expect(candidate.template.penetrationDefinition.sourceNotation).toBe('R20');
    expect(
      deriveMasterWeaponProfile(catalog, selection(candidate), completeInput(candidate), null)
        .penetrationDefinition.sourceNotation,
    ).toBe('R20');
    expect(() =>
      deriveMasterWeaponProfile(
        catalog,
        selection(candidate),
        {
          ...completeInput(candidate),
          penetrationDefinition: {
            kind: 'MASTER_DICE',
            pattern: 'R20',
            constantOrNull: null,
          } as unknown as MasterWeaponExpression,
        },
        null,
      ),
    ).toThrow(/closed master dice grammar/);
  });
  it('updates fixed-template stat requirement labels while preserving the protected skill clause', () => {
    const kensi = entry('ITM-WPN-003'),
      eincbern = entry('ITM-WPN-006');
    const cleared = deriveMasterWeaponProfile(
      catalog,
      selection(kensi),
      { ...completeInput(kensi), statRequirements: {} },
      null,
    );
    expect(cleared.statRequirements).toEqual({});
    expect(cleared.properties).not.toHaveProperty('Требования');
    expect(projectAdmissionWeaponProfile(cleared).properties).not.toHaveProperty('Требования');
    const changed = deriveMasterWeaponProfile(
      catalog,
      selection(kensi),
      { ...completeInput(kensi), statRequirements: { S: 1.5, I: 30 } },
      null,
    );
    expect(changed.properties['Требования']).toBe('S1.5; I30');
    const protectedSkill = deriveMasterWeaponProfile(
      catalog,
      selection(eincbern),
      { ...completeInput(eincbern), statRequirements: {} },
      null,
    );
    expect(protectedSkill.properties['Требования']).toBe('Стрельба ≥ средняя');
    expect(protectedSkill.properties['Навык/класс']).toBe(
      eincbern.template.properties['Навык/класс'],
    );
    expect(kensi.template.properties['Требования']).toBe('S8; D19');
  });
  it('inherits the exact validated request on RETAIN and keeps source bytes unchanged', () => {
    const candidate = entry();
    const validated = validateWeaponProfile(catalog, selection(candidate), {
      commonWitness: { L: 1, Lw: 10, Ls: 4 },
      independentDice: { R12_DMG: 2, R12_RANGE: 2, R20_RS: 2 },
      formulaOutputs: { Dm: 3, Rn: 6, Rs: 1, Rd: 2 },
    });
    if (validated.status !== 'VALID') throw Error('source witness must be valid');
    const bytes = JSON.stringify(validated);
    const profile = deriveMasterWeaponProfile(
      catalog,
      selection(candidate),
      {
        ...completeInput(candidate, validated.profile),
        accuracyBonusOrNull: 1000000.25,
        statRequirements: {},
      },
      validated.profile,
    );
    expect(profile.instanceDamage).toBe(3);
    expect(profile.rangeMeters).toBe(6);
    expect(profile.statRequirements).toEqual({});
    expect(profile.accuracyBonus).toBe(1000000.25);
    expect(profile.statSource).toBe('MASTER_OVERRIDE');
    expect(profile.damageDefinition).toEqual(
      stageValidatedWeaponProfile(validated.profile).damageDefinition,
    );
    expect(JSON.stringify(validated)).toBe(bytes);
    expect(() =>
      deriveMasterWeaponProfile(
        catalog,
        selection(entry('ITM-WPN-002')),
        completeInput(entry('ITM-WPN-002')),
        validated.profile,
      ),
    ).toThrow(/another weapon type/);
  });
  it('requires complete instance and ranged values, and never grants ranged reach to a melee variant', () => {
    const ranged = entry(),
      melee = entry('ITM-WPN-016');
    expect(() =>
      deriveMasterWeaponProfile(
        catalog,
        selection(ranged),
        { ...completeInput(ranged), instanceDamageOrNull: null },
        null,
      ),
    ).toThrow(/instanceDamage/);
    expect(() =>
      deriveMasterWeaponProfile(
        catalog,
        selection(ranged),
        { ...completeInput(ranged), rangeMetersOrNull: null },
        null,
      ),
    ).toThrow(/rangeMeters/);
    expect(() =>
      deriveMasterWeaponProfile(
        catalog,
        selection(melee),
        { ...completeInput(melee), rangeMetersOrNull: 20 },
        null,
      ),
    ).toThrow(/melee/);
    expect(() =>
      deriveMasterWeaponProfile(
        catalog,
        selection(melee),
        { ...completeInput(melee), instanceDamageOrNull: 1 },
        null,
      ),
    ).toThrow(/non-instance/);
    expect(() =>
      deriveMasterWeaponProfile(
        catalog,
        selection(ranged),
        {
          ...completeInput(ranged),
          damageDefinition: { kind: 'MASTER_DICE', pattern: 'R6', constantOrNull: null },
        },
        null,
      ),
    ).toThrow(/non-instance/);
  });
  it.each([0, -1, Infinity, NaN, null, '10'])(
    'rejects nonpositive/nonfinite X %s',
    (constantOrNull) => {
      const candidate = entry();
      expect(() =>
        deriveMasterWeaponProfile(
          catalog,
          selection(candidate),
          {
            ...completeInput(candidate),
            penetrationDefinition: {
              kind: 'MASTER_DICE',
              pattern: 'R20+X',
              constantOrNull,
            } as MasterWeaponExpression,
          },
          null,
        ),
      ).toThrow(/finite and positive/);
    },
  );
  it.each(['R8', 'R20*2', ['R6', 'X'].join('-'), 'R6+X+X', 'ROLL(R6)', 'R6;globalThis.secret'])(
    'rejects unsupported pattern %s',
    (pattern) => {
      const candidate = entry();
      expect(() =>
        deriveMasterWeaponProfile(
          catalog,
          selection(candidate),
          {
            ...completeInput(candidate),
            penetrationDefinition: {
              kind: 'MASTER_DICE',
              pattern,
              constantOrNull: 1,
            } as MasterWeaponExpression,
          },
          null,
        ),
      ).toThrow(/closed master dice grammar/);
    },
  );
  it('accepts all seven positive finite stat thresholds but no invented stat or null map', () => {
    const candidate = entry();
    const statRequirements = { S: 0.5, D: 99999, M: 1, Z: 2, I: 3, W: 4, C: 5 };
    expect(
      deriveMasterWeaponProfile(
        catalog,
        selection(candidate),
        { ...completeInput(candidate), statRequirements },
        null,
      ).statRequirements,
    ).toEqual(statRequirements);
    for (const map of [{ HP: 1 }, { S: 0 }, { S: -1 }, { S: Infinity }, null, []])
      expect(() =>
        deriveMasterWeaponProfile(
          catalog,
          selection(candidate),
          {
            ...completeInput(candidate),
            statRequirements: map as MasterWeaponProfileInput['statRequirements'],
          },
          null,
        ),
      ).toThrow();
  });
  it('rejects missing editable fields, unknown protected edits and mixed variants', () => {
    const candidate = entry(),
      input = completeInput(candidate);
    for (const key of Object.keys(input)) {
      const missing = { ...input } as Record<string, unknown>;
      delete missing[key];
      expect(() =>
        deriveMasterWeaponProfile(
          catalog,
          selection(candidate),
          missing as unknown as MasterWeaponProfileInput,
          null,
        ),
      ).toThrow(/expected exactly/);
    }
    for (const extra of [
      { properties: { Ёмкость: 999 } },
      { weaponTypeId: 'new-global' },
      { commonWitness: { L: 1 } },
      { damageModifierStat: 'I' },
    ])
      expect(() =>
        deriveMasterWeaponProfile(catalog, selection(candidate), { ...input, ...extra }, null),
      ).toThrow(/expected exactly/);
    expect(() =>
      deriveMasterWeaponProfile(
        catalog,
        selection(candidate),
        { ...input, weaponVariantId: 'SHIELD' },
        null,
      ),
    ).toThrow(/variant/);
    expect(() =>
      deriveMasterWeaponProfile(
        catalog,
        selection(candidate),
        {
          ...input,
          damageDefinition: { kind: 'RETAIN', guessedDefault: true } as MasterWeaponExpression,
        },
        null,
      ),
    ).toThrow(/expected exactly/);
  });
  it('does not execute accessors or allocate runtime IDs and returns deeply frozen staged values', () => {
    const candidate = entry(),
      input = completeInput(candidate);
    let calls = 0;
    const definition = Object.defineProperty({}, 'kind', {
      enumerable: true,
      get() {
        calls++;
        return 'RETAIN';
      },
    });
    expect(() =>
      deriveMasterWeaponProfile(
        catalog,
        selection(candidate),
        { ...input, damageDefinition: definition as MasterWeaponExpression },
        null,
      ),
    ).toThrow();
    expect(calls).toBe(0);
    const profile = deriveMasterWeaponProfile(catalog, selection(candidate), input, null);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.damageDefinition)).toBe(true);
    expect(Object.isFrozen(profile.properties)).toBe(true);
    expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
  });
});
