import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';

/** CORE-205 is separate from the weapon grammar CORE-188. These are definitions, never rolls. */
export const MONSTER_RUNTIME_FORMS = [
  'ZERO',
  'CONSTANT',
  'R4',
  'R4+X',
  'R6',
  'R6+X',
  'R12',
  'R12+X',
  'R20',
  'R20+X',
  'R20*2+X',
] as const;
export type MonsterRuntimeForm = (typeof MONSTER_RUNTIME_FORMS)[number];
export type MonsterRuntimeDefinition =
  | Readonly<{ mode: 'ZERO' }>
  | Readonly<{ mode: 'CONSTANT'; value: number }>
  | Readonly<{
      mode: 'PER_RESOLUTION_ROLL';
      dieSides: 4 | 6 | 12 | 20;
      multiplier: 1 | 2;
      bonus: number;
    }>;

/** Closed JSON grammar shared by wire, immutable storage and the read-only renderer. */
export function monsterRuntimeDefinitionValue(value: unknown): MonsterRuntimeDefinition {
  const row = r.record(value, '$.monsterDefinition');
  if (row['mode'] === 'ZERO') {
    r.exact(row, 'mode', '$.monsterDefinition');
  } else if (row['mode'] === 'CONSTANT') {
    r.exact(row, 'mode value', '$.monsterDefinition');
    if (r.finite(row['value'], '$.monsterDefinition.value', 0) <= 0)
      r.invalid('$.monsterDefinition.value', 'positive finite constant', null);
  } else {
    r.exact(row, 'mode dieSides multiplier bonus', '$.monsterDefinition');
    w.literal(row['mode'], 'PER_RESOLUTION_ROLL', '$.monsterDefinition.mode');
    const dieSides = r.integer(row['dieSides'], '$.monsterDefinition.dieSides', 1);
    if (![4, 6, 12, 20].includes(dieSides))
      r.invalid('$.monsterDefinition.dieSides', 'CORE-205 die', null);
    const multiplier = r.integer(row['multiplier'], '$.monsterDefinition.multiplier', 1);
    if (multiplier !== 1 && multiplier !== 2)
      r.invalid('$.monsterDefinition.multiplier', 'CORE-205 multiplier', null);
    const bonus = r.integer(row['bonus'], '$.monsterDefinition.bonus', 0);
    if (row['multiplier'] === 2 && (row['dieSides'] !== 20 || bonus === 0))
      r.invalid('$.monsterDefinition', 'only R20*2+X with positive integer X', null);
  }
  return w.validated(Object.freeze(structuredClone(row)));
}

/** A field intent builder; the host revalidates the resulting definition and never evaluates it. */
export function monsterRuntimeDefinitionForForm(
  formValue: unknown,
  parameterOrNull: unknown,
): MonsterRuntimeDefinition {
  r.oneOf(formValue, MONSTER_RUNTIME_FORMS, '$.monsterDefinition.form');
  if (formValue === 'ZERO') {
    w.literal(parameterOrNull, null, '$.monsterDefinition.parameterOrNull');
    return monsterRuntimeDefinitionValue({ mode: 'ZERO' });
  }
  if (formValue === 'CONSTANT')
    return monsterRuntimeDefinitionValue({ mode: 'CONSTANT', value: parameterOrNull });
  const forms = {
    R4: [4, 1, false],
    'R4+X': [4, 1, true],
    R6: [6, 1, false],
    'R6+X': [6, 1, true],
    R12: [12, 1, false],
    'R12+X': [12, 1, true],
    R20: [20, 1, false],
    'R20+X': [20, 1, true],
    'R20*2+X': [20, 2, true],
  } as const;
  if (typeof formValue !== 'string' || !Object.hasOwn(forms, formValue))
    return r.invalid('$.monsterDefinition.form', 'CORE-205 form', null);
  const shape = forms[formValue as keyof typeof forms];
  let bonus = 0;
  if (shape[2]) bonus = r.integer(parameterOrNull, '$.monsterDefinition.X', 1);
  else w.literal(parameterOrNull, null, '$.monsterDefinition.parameterOrNull');
  return monsterRuntimeDefinitionValue({
    mode: 'PER_RESOLUTION_ROLL',
    dieSides: shape[0],
    multiplier: shape[1],
    bonus,
  });
}

export function monsterRuntimeDefinitionForm(
  value: MonsterRuntimeDefinition,
): Readonly<{ form: MonsterRuntimeForm; parameterOrNull: number | null }> {
  const definition = monsterRuntimeDefinitionValue(value);
  if (definition.mode === 'ZERO') return { form: 'ZERO', parameterOrNull: null };
  if (definition.mode === 'CONSTANT')
    return { form: 'CONSTANT', parameterOrNull: definition.value };
  const form =
    definition.multiplier === 2
      ? 'R20*2+X'
      : definition.bonus === 0
        ? `R${definition.dieSides}`
        : `R${definition.dieSides}+X`;
  return w.validated({ form, parameterOrNull: definition.bonus === 0 ? null : definition.bonus });
}

export function monsterRuntimeDefinitionLabel(value: MonsterRuntimeDefinition): string {
  const definition = monsterRuntimeDefinitionValue(value);
  if (definition.mode === 'ZERO') return '0';
  if (definition.mode === 'CONSTANT') return String(definition.value);
  return (
    `R${definition.dieSides}` +
    (definition.multiplier === 2 ? '*2' : '') +
    (definition.bonus === 0 ? '' : `+${definition.bonus}`)
  );
}
