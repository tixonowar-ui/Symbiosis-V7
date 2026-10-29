import type { StartingWeaponSelection, StartingWeaponVariant } from './starting-weapon.js';

export type WeaponFormulaOutput = 'Dm' | 'Rn' | 'Rs' | 'Rd';
export type WeaponWitnessVariable = 'L' | 'Lw' | 'Ls';
export interface WeaponProfileInputs {
  readonly commonWitness: Readonly<Record<WeaponWitnessVariable, number>>;
  readonly independentDice: Readonly<Record<string, number>>;
  readonly formulaOutputs: Readonly<Partial<Record<WeaponFormulaOutput, number>>>;
}

export type WeaponFormulaExpression =
  | { readonly kind: 'NUMBER'; readonly value: string }
  | { readonly kind: 'VARIABLE'; readonly key: string }
  | {
      readonly kind: 'BINARY';
      readonly operator: '+' | '-' | '*' | '/';
      readonly left: WeaponFormulaExpression;
      readonly right: WeaponFormulaExpression;
    }
  | { readonly kind: 'CEIL'; readonly value: WeaponFormulaExpression }
  | {
      readonly kind: 'MAX';
      readonly left: WeaponFormulaExpression;
      readonly right: WeaponFormulaExpression;
    };

export interface WeaponFormulaContract {
  readonly formulaId: string;
  readonly formulaVersion: 'ITEM_FORMULAS_V1.2';
  readonly variables: readonly {
    readonly key: WeaponWitnessVariable;
    readonly label: string;
    readonly min: number;
    readonly step: 1;
  }[];
  readonly independentDice: readonly {
    readonly key: string;
    readonly dieSides: 4 | 6 | 12 | 20;
    readonly label: string;
  }[];
  readonly outputs: readonly {
    readonly key: WeaponFormulaOutput;
    readonly label: string;
    readonly min: number;
    readonly max: number | null;
    readonly step: number;
  }[];
  readonly expressions: readonly {
    readonly key: WeaponFormulaOutput;
    readonly expression: WeaponFormulaExpression;
  }[];
}

export interface WeaponCombatDefinition {
  readonly definitionId: string;
  readonly valueMode: 'INSTANCE_VALUE' | 'CONSTANT' | 'PER_ATTACK_ROLL';
  readonly sourceNotation: string;
  readonly baseExpression: string;
  readonly sourceScope: string;
  readonly evaluationScope: string;
  readonly rollGroupId?: string;
  readonly instanceSourceField?: string;
  readonly conditionalOverride?: string;
  readonly effectiveTemplateExpression: string;
  readonly damageModifierStat: string;
  readonly dieType: string;
  readonly rollKind: string;
  readonly progressionEligibility: string;
  readonly rawRollPersistence: string;
  readonly resolvedResultField: string;
  readonly resolvedResultPersistence: string;
}

/** Full source properties; only formula outputs may replace their addressed fields. */
export interface WeaponEffectiveProfile {
  readonly weaponTypeId: string;
  readonly weaponVariantId: StartingWeaponVariant;
  readonly name: string;
  readonly variantLabel: string;
  readonly templateProfileVersion: string;
  readonly statSource: 'TEMPLATE_FIXED' | 'PLAYER_FORMULA_VALIDATED';
  readonly damageDefinition: WeaponCombatDefinition;
  readonly penetrationDefinition: WeaponCombatDefinition;
  readonly statRequirements: Readonly<Record<string, number>>;
  readonly instanceDamage?: number;
  readonly rangeMeters?: number;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

export interface WeaponProfileCatalogEntry {
  readonly weaponTypeId: string;
  readonly weaponVariant: StartingWeaponVariant;
  readonly name: string;
  readonly variantLabel: string;
  readonly profileKind: 'FORMULA' | 'FIXED';
  readonly canonicalProfileVersion: string;
  readonly requirementPreview: {
    readonly requirements: string;
    readonly skillOrClass: string;
    readonly missingSkillOrClassPenalty: string;
  };
  readonly formula: WeaponFormulaContract | null;
  readonly template: WeaponEffectiveProfile;
}

export interface WeaponProfileCatalog {
  readonly entries: readonly WeaponProfileCatalogEntry[];
}

export interface WeaponReachabilityProof extends WeaponProfileInputs {
  readonly formulaId: string;
  readonly formulaVersion: 'ITEM_FORMULAS_V1.2';
}

export type WeaponProfileValidationResult =
  | {
      readonly status: 'INVALID';
      readonly invalidFieldSet: readonly string[];
      readonly humanExplanations: readonly string[];
    }
  | {
      readonly status: 'VALID';
      readonly profile: WeaponEffectiveProfile;
      readonly proof: WeaponReachabilityProof;
    };

function fail(detail: string): never {
  throw new Error(`weapon profile: ${detail}`);
}

/** Closed arithmetic grammar for Item Registry 05, never executable JavaScript. */
export function parseWeaponFormula(
  source: string,
  allowedVariables: ReadonlySet<string>,
): WeaponFormulaExpression {
  const tokens: string[] = [];
  const normalized = source.trim().replaceAll('−', '-').replaceAll('×', '*');
  const token = /\s*(\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]*|[()+*/,-])/y;
  let position = 0;
  while (position < normalized.length) {
    token.lastIndex = position;
    const match = token.exec(normalized);
    if (match === null)
      fail(`unsupported formula syntax at ${JSON.stringify(normalized.slice(position))}`);
    tokens.push(match[1]!);
    position = token.lastIndex;
  }
  let cursor = 0;
  const consume = (expected: string): void => {
    if (tokens[cursor++] !== expected) fail(`formula expected ${expected}`);
  };
  const primary = (): WeaponFormulaExpression => {
    const current = tokens[cursor++];
    if (current === undefined) return fail('formula ended before an operand');
    if (/^\d+(?:\.\d+)?$/.test(current)) return { kind: 'NUMBER', value: current };
    if (current === '(') {
      const value = expression();
      consume(')');
      return value;
    }
    if (current === 'CEIL' || current === 'MAX') {
      consume('(');
      const left = expression();
      if (current === 'CEIL') {
        consume(')');
        return { kind: 'CEIL', value: left };
      }
      consume(',');
      const right = expression();
      consume(')');
      return { kind: 'MAX', left, right };
    }
    if (!allowedVariables.has(current)) fail(`unknown formula variable ${JSON.stringify(current)}`);
    return { kind: 'VARIABLE', key: current };
  };
  const product = (): WeaponFormulaExpression => {
    let left = primary();
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const operator = tokens[cursor++] as '*' | '/';
      left = { kind: 'BINARY', operator, left, right: primary() };
    }
    return left;
  };
  const expression = (): WeaponFormulaExpression => {
    let left = product();
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operator = tokens[cursor++] as '+' | '-';
      left = { kind: 'BINARY', operator, left, right: product() };
    }
    return left;
  };
  const result = expression();
  if (cursor !== tokens.length) fail(`unexpected formula token ${JSON.stringify(tokens[cursor])}`);
  return result;
}

export function weaponFormulaVariables(expression: WeaponFormulaExpression): readonly string[] {
  switch (expression.kind) {
    case 'NUMBER':
      return [];
    case 'VARIABLE':
      return [expression.key];
    case 'CEIL':
      return weaponFormulaVariables(expression.value);
    case 'MAX':
    case 'BINARY':
      return [
        ...weaponFormulaVariables(expression.left),
        ...weaponFormulaVariables(expression.right),
      ];
  }
}

type Rational = { readonly n: bigint; readonly d: bigint };
const integer = (value: number): Rational => ({ n: BigInt(value), d: 1n });
function decimal(value: string): Rational {
  const [whole, fraction] = value.split('.');
  return fraction === undefined
    ? { n: BigInt(whole!), d: 1n }
    : { n: BigInt(`${whole}${fraction}`), d: 10n ** BigInt(fraction.length) };
}
function rational(n: bigint, d: bigint): Rational {
  if (d === 0n) fail('formula division by zero');
  return d < 0n ? { n: -n, d: -d } : { n, d };
}
function evaluate(
  expression: WeaponFormulaExpression,
  values: Readonly<Record<string, Rational>>,
): Rational {
  switch (expression.kind) {
    case 'NUMBER':
      return decimal(expression.value);
    case 'VARIABLE':
      return values[expression.key] ?? fail(`missing formula variable ${expression.key}`);
    case 'CEIL': {
      const value = evaluate(expression.value, values);
      return { n: value.n / value.d + (value.n > 0n && value.n % value.d !== 0n ? 1n : 0n), d: 1n };
    }
    case 'MAX': {
      const left = evaluate(expression.left, values);
      const right = evaluate(expression.right, values);
      return left.n * right.d >= right.n * left.d ? left : right;
    }
    case 'BINARY': {
      const left = evaluate(expression.left, values);
      const right = evaluate(expression.right, values);
      switch (expression.operator) {
        case '+':
          return rational(left.n * right.d + right.n * left.d, left.d * right.d);
        case '-':
          return rational(left.n * right.d - right.n * left.d, left.d * right.d);
        case '*':
          return rational(left.n * right.n, left.d * right.d);
        case '/':
          return rational(left.n * right.d, left.d * right.n);
      }
    }
  }
}

export function findWeaponProfile(
  catalog: WeaponProfileCatalog,
  selection: StartingWeaponSelection,
): WeaponProfileCatalogEntry {
  const matches = catalog.entries.filter(
    (entry) =>
      entry.weaponTypeId === selection.weaponTypeId &&
      entry.weaponVariant === selection.weaponVariant,
  );
  if (matches.length !== 1)
    fail(
      `expected one source profile for ${selection.weaponTypeId}/${selection.weaponVariant}, found ${matches.length}`,
    );
  return matches[0]!;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

/** CORE-185 verifies a provided certificate; no sampler or witness search exists here. */
export function validateWeaponProfile(
  catalog: WeaponProfileCatalog,
  selection: StartingWeaponSelection,
  inputs: WeaponProfileInputs,
): WeaponProfileValidationResult {
  const entry = findWeaponProfile(catalog, selection);
  const formula = entry.formula;
  const failures = new Map<string, string>();
  const invalid = (): WeaponProfileValidationResult => ({
    status: 'INVALID',
    invalidFieldSet: [...failures.keys()],
    humanExplanations: [...failures.values()],
  });
  if (formula === null) {
    failures.set(
      'profile',
      'Для выбранного оружия доступен только неизменный канонический профиль.',
    );
    return invalid();
  }
  if (
    !object(inputs) ||
    !exactKeys(inputs, ['commonWitness', 'independentDice', 'formulaOutputs'])
  ) {
    failures.set(
      'profile',
      'Укажите общий набор параметров, независимые значения свидетельства и полный набор характеристик профиля.',
    );
    return invalid();
  }
  const witness = inputs.commonWitness;
  if (!object(witness) || !exactKeys(witness, ['L', 'Lw', 'Ls']))
    failures.set('commonWitness', 'Нужны все три общих параметра L, Lw и Ls.');
  else
    for (const variable of formula.variables) {
      if (!Number.isSafeInteger(witness[variable.key]) || witness[variable.key] < variable.min)
        failures.set(
          `commonWitness.${variable.key}`,
          `${variable.label}: требуется целое значение не меньше ${String(variable.min)}.`,
        );
    }
  const dice = inputs.independentDice;
  if (
    !object(dice) ||
    !exactKeys(
      dice,
      formula.independentDice.map((die) => die.key),
    )
  )
    failures.set(
      'independentDice',
      'Каждому независимому значению свидетельства нужен собственный адрес; пропуски и посторонние значения запрещены.',
    );
  else
    for (const die of formula.independentDice) {
      const value = dice[die.key];
      if (!Number.isSafeInteger(value) || value === undefined || value < 1 || value > die.dieSides)
        failures.set(
          `independentDice.${die.key}`,
          `${die.label}: требуется целое значение от 1 до ${String(die.dieSides)}.`,
        );
    }
  const outputs = inputs.formulaOutputs;
  if (
    !object(outputs) ||
    !exactKeys(
      outputs,
      formula.outputs.map((output) => output.key),
    )
  )
    failures.set(
      'formulaOutputs',
      'Укажите ровно полный набор разрешённых характеристик выбранного типа и варианта.',
    );
  else
    for (const output of formula.outputs) {
      const value = outputs[output.key];
      if (
        value === undefined ||
        !Number.isFinite(value) ||
        !Number.isSafeInteger(value / output.step) ||
        value < output.min ||
        (output.max !== null && value > output.max)
      )
        failures.set(
          `formulaOutputs.${output.key}`,
          `${output.label}: значение не входит в допустимые границы или шаг.`,
        );
    }
  if (failures.size !== 0) return invalid();
  const values: Record<string, Rational> = {};
  for (const key of ['L', 'Lw', 'Ls'] as const) values[key] = integer(witness[key]);
  for (const die of formula.independentDice) values[die.key] = integer(dice[die.key]!);
  for (const expression of formula.expressions) {
    const actual = evaluate(expression.expression, values);
    values[expression.key] = actual;
    const requested = decimal(String(outputs[expression.key]!));
    if (actual.n * requested.d !== requested.n * actual.d)
      failures.set(
        `formulaOutputs.${expression.key}`,
        `${formula.outputs.find((output) => output.key === expression.key)!.label}: общий набор параметров и независимых значений не подтверждает заявленное значение.`,
      );
  }
  if (failures.size !== 0) return invalid();
  return {
    status: 'VALID',
    profile: {
      ...entry.template,
      statSource: 'PLAYER_FORMULA_VALIDATED',
      statRequirements: { S: outputs.Rs!, D: outputs.Rd! },
      ...(outputs.Dm === undefined ? {} : { instanceDamage: outputs.Dm }),
      ...(outputs.Rn === undefined ? {} : { rangeMeters: outputs.Rn }),
    },
    proof: {
      formulaId: formula.formulaId,
      formulaVersion: formula.formulaVersion,
      commonWitness: { ...witness },
      independentDice: { ...dice },
      formulaOutputs: { ...outputs },
    },
  };
}

export function canonicalFixedWeaponProfile(
  catalog: WeaponProfileCatalog,
  selection: StartingWeaponSelection,
): WeaponEffectiveProfile {
  const entry = findWeaponProfile(catalog, selection);
  if (entry.profileKind !== 'FIXED' || entry.formula !== null)
    fail('selected weapon requires formula validation');
  return structuredClone(entry.template);
}

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!object(left) || !object(right) || !exactKeys(left, Object.keys(right))) return false;
  return Object.keys(left).every((key) => equal(left[key], right[key]));
}
export function validateFixedWeaponProfile(
  catalog: WeaponProfileCatalog,
  selection: StartingWeaponSelection,
  candidate: unknown,
): boolean {
  return equal(canonicalFixedWeaponProfile(catalog, selection), candidate);
}

export interface WeaponProfilePlayerFact {
  readonly label: string;
  readonly value: string | number | boolean;
}

/** Explicit allowlist: never spread definitions or their IDs into a player projection. */
export function weaponProfilePlayerFacts(
  profile: WeaponEffectiveProfile,
): readonly WeaponProfilePlayerFact[] {
  const facts: WeaponProfilePlayerFact[] = [
    { label: 'Оружие', value: profile.name },
    { label: 'Вариант', value: profile.variantLabel },
    { label: 'Урон', value: profile.instanceDamage ?? profile.damageDefinition.sourceNotation },
    { label: 'Пробитие', value: profile.penetrationDefinition.sourceNotation },
  ];
  for (const [key, value] of Object.entries(profile.statRequirements))
    facts.push({ label: `Требование ${key}`, value });
  if (profile.rangeMeters !== undefined)
    facts.push({ label: 'Дальность, м', value: profile.rangeMeters });
  for (const [label, value] of Object.entries(profile.properties)) facts.push({ label, value });
  if (
    /\b(?:CORE|AQ\d?|AQA|CQA|F-WPN|ITM-WPN|CVD-WPN|RG-WPN)-[A-Z0-9-]+\b|Источник|availabilityTrace/.test(
      JSON.stringify(facts),
    )
  )
    fail('player facts contain internal provenance');
  return facts;
}
