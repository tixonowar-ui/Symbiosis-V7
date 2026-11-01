import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  AdmissionPublicCombatValue,
  AdmissionPublicWeaponProfile,
} from '@shared/campaign-admission.js';
import { admissionGroupLabelsValue } from '@shared/campaign-admission-proposal.js';
import { AdmissionGroupName, WeaponProfile } from './admission-fields.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function expression(d20: boolean, penetration: boolean): AdmissionPublicCombatValue {
  return {
    valueMode: 'PER_ATTACK_ROLL',
    sourceNotation: d20 ? 'D20' : 'R4',
    baseExpression: d20 ? 'D20' : 'R4',
    sourceScope: 'WEAPON_PROFILE_VERSION',
    evaluationScope: 'EACH_RESOLVED_ATTACK',
    instanceSourceFieldOrNull: null,
    conditionalOverrideOrNull: null,
    effectiveTemplateExpression: d20 ? 'D20' : 'R4',
    damageModifierStat: 'NONE',
    dieType: d20 ? 'D20' : 'OTHER_DIE',
    rollKind: penetration ? 'PENETRATION' : 'DAMAGE',
    progressionEligibility: d20 ? 'NO_DIRECT_BUT_POOL' : 'NEVER_PROGRESSION',
    rawRollPersistence: 'ATTACK_RESOLUTION_AND_COMBAT_LOG',
    resolvedResultField: penetration ? 'resolvedPenetration' : 'resolvedDamage',
    resolvedResultPersistence: 'ATTACK_RESOLUTION_AND_COMBAT_LOG',
  };
}
describe('complete admission sheet presentation', () => {
  it.each([true, false])(
    'shows independent progression for a mixed GM profile (damage D20: %s)',
    (damageD20) => {
      const profile: AdmissionPublicWeaponProfile = {
        weaponTypeId: 'fixture-weapon',
        weaponVariantId: 'DEFAULT',
        name: 'Оружие',
        variantLabel: 'Вариант',
        statSource: 'MASTER_OVERRIDE',
        damageDefinition: expression(damageD20, false),
        penetrationDefinition: expression(!damageD20, true),
        statRequirements: {},
        instanceDamageOrNull: null,
        rangeMetersOrNull: null,
        accuracyBonusOrNull: null,
        properties: {},
      };
      const root = document.createElement('div');
      root.innerHTML = renderToStaticMarkup(<WeaponProfile profile={profile} />);
      const text = (label: string) =>
        [...root.querySelectorAll('dt')].find((dt) => dt.textContent === label)?.nextElementSibling
          ?.textContent;
      const pool = 'Прямого развития нет; учитывается общий пул.',
        never = 'Развитие не начисляется.';
      expect(text('Развитие от урона')).toBe(damageD20 ? pool : never);
      expect(text('Развитие от пробития')).toBe(damageD20 ? never : pool);
    },
  );
  it('distinguishes existing assignments by their verified names without exposing IDs', () => {
    const groups = admissionGroupLabelsValue(
      [
        { groupId: id(1), name: 'Разведчики' },
        { groupId: id(2), name: 'Лекари' },
      ],
      [id(1), id(2)],
    );
    const first = renderToStaticMarkup(
      <AdmissionGroupName assignment={{ kind: 'EXISTING', groupId: id(1) }} groups={groups} />,
    );
    const second = renderToStaticMarkup(
      <AdmissionGroupName assignment={{ kind: 'EXISTING', groupId: id(2) }} groups={groups} />,
    );
    expect(first).toContain('Разведчики');
    expect(first).not.toContain('Лекари');
    expect(second).toContain('Лекари');
    expect(first + second).not.toMatch(/00000000|EXISTING|groupId/);
    expect(() =>
      renderToStaticMarkup(
        <AdmissionGroupName assignment={{ kind: 'EXISTING', groupId: id(3) }} groups={groups} />,
      ),
    ).toThrow('label is missing');
  });
});
