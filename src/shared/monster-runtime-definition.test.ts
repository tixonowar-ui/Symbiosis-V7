import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MONSTER_RUNTIME_FORMS,
  monsterRuntimeDefinitionForForm,
  monsterRuntimeDefinitionForm,
  monsterRuntimeDefinitionLabel,
  monsterRuntimeDefinitionValue,
} from './monster-runtime-definition.js';

describe('CORE-205 monster definitions, ENM-013/014', () => {
  it('binds the separate eleven-form grammar to its actual supplied rule', () => {
    const rows = JSON.parse(readFileSync('generated/spec/rules/rules.json', 'utf8')) as Record<
      string,
      unknown
    >[];
    const source = rows.filter((row) => row['Rule ID'] === 'CORE-205');
    expect(source).toHaveLength(1);
    expect(source[0]?.['Входы / параметры']).toBe(
      '0 | positive finite constant | R4 | R4+X | R6 | R6+X | R12 | R12+X | R20 | R20+X | R20*2+X',
    );
    expect(MONSTER_RUNTIME_FORMS).toHaveLength(11);
  });

  it.each([
    ['ZERO', null, '0'],
    ['CONSTANT', 0.125, '0.125'],
    ['R4', null, 'R4'],
    ['R4+X', 3, 'R4+3'],
    ['R6', null, 'R6'],
    ['R6+X', 3, 'R6+3'],
    ['R12', null, 'R12'],
    ['R12+X', 3, 'R12+3'],
    ['R20', null, 'R20'],
    ['R20+X', 3, 'R20+3'],
    ['R20*2+X', 3, 'R20*2+3'],
  ])(
    'retains %s as a definition without requesting or storing a combat result',
    (form, input, label) => {
      const definition = monsterRuntimeDefinitionForForm(form, input);
      expect(monsterRuntimeDefinitionLabel(definition)).toBe(label);
      expect(monsterRuntimeDefinitionForm(definition)).toEqual({ form, parameterOrNull: input });
      expect(definition).not.toHaveProperty('resolvedValue');
      expect(definition).not.toHaveProperty('rawFace');
    },
  );

  it.each([
    ['CONSTANT', 0],
    ['CONSTANT', -1],
    ['CONSTANT', Infinity],
    ['CONSTANT', NaN],
    ['R20+X', 0],
    ['R20+X', -1],
    ['R20+X', 1.5],
    ['R20*2+X', 0],
    ['R20', 1],
    ['ZERO', 0],
    ['R8', null],
    ['2R20', null],
    ['R20*2', null],
    ['R20+S', null],
  ])('refuses unsupported form/parameter %s/%s', (form, parameter) => {
    expect(() => monsterRuntimeDefinitionForForm(form, parameter)).toThrow();
  });

  it.each([
    { mode: 'ZERO', resolvedValue: 0 },
    { mode: 'CONSTANT', value: 1, rawFace: 1 },
    { mode: 'PER_RESOLUTION_ROLL', dieSides: 8, multiplier: 1, bonus: 0 },
    { mode: 'PER_RESOLUTION_ROLL', dieSides: 4, multiplier: 2, bonus: 1 },
    { mode: 'PER_RESOLUTION_ROLL', dieSides: 20, multiplier: 2, bonus: 0 },
    { mode: 'PER_RESOLUTION_ROLL', dieSides: 20, multiplier: 1, bonus: 0.1 },
    { mode: 'PER_RESOLUTION_ROLL', dieSides: 20, multiplier: 1, bonus: -1 },
    { mode: 'EVAL', expression: 'process.exit()' },
  ])('rejects a foreign or already evaluated definition', (value) => {
    expect(() => monsterRuntimeDefinitionValue(value)).toThrow();
  });

  it('rejects accessor-backed input before invoking it', () => {
    let reads = 0;
    const value = Object.defineProperty({ mode: 'CONSTANT' }, 'value', {
      enumerable: true,
      get() {
        reads++;
        return 1;
      },
    });
    expect(() => monsterRuntimeDefinitionValue(value)).toThrow();
    expect(reads).toBe(0);
  });
});
