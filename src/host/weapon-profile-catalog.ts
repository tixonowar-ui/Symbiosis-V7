import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANONICAL_STARTING_WEAPON_CATALOG } from '../domain/rules/item-stage/starting-weapon.js';
import {
  parseWeaponFormula,
  weaponFormulaVariables,
  weaponProfilePlayerFacts,
  type WeaponCombatDefinition,
  type WeaponEffectiveProfile,
  type WeaponFormulaContract,
  type WeaponProfileCatalog,
  type WeaponProfileCatalogEntry,
} from '../domain/rules/item-stage/weapon-profile.js';

export type { WeaponProfileCatalog } from '../domain/rules/item-stage/weapon-profile.js';

const SOURCE_FILES = [
  'catalogue',
  'weapon-profiles',
  'combat-values',
  'weapon-fields',
  'formulas',
  'formula-ranges',
  'dictionaries',
  'operations',
  'rule-trace',
] as const;
type SourceName = (typeof SOURCE_FILES)[number];
type Row = Record<string, unknown>;
type Sources = Readonly<Record<SourceName, readonly Row[]>>;
const OUTPUT_LABELS = {
  Dm: 'Урон (Dm)',
  Rn: 'Дальность, м (Rn)',
  Rs: 'Требование силы (Rs)',
  Rd: 'Требование ловкости (Rd)',
} as const;
const PROPERTY_FIELDS = [
  'Боеприпас',
  'Можно метать',
  'Навык/класс',
  'Особое правило',
  'Перезарядка атомарна',
  'Перезарядка, действий',
  'Руки',
  'Стат точности',
  'Штраф без навыка/класса',
  'Ёмкость',
  'Штраф метания',
  'Парирование',
  'Shield max HP',
  'Блок',
] as const;
const INTERNAL_TEXT =
  /\b(?:CORE|AQ\d?|AQA|CQA|F-WPN|ITM-WPN|CVD-WPN|RG-WPN)-[A-Z0-9-]+\b|Источник|availabilityTrace/;

function fail(detail: string): never {
  throw new Error(`weapon profile catalog: ${detail}`);
}
function rows(value: unknown, label: string): readonly Row[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      fail(`${label}[${index}] must be an object`);
    return entry as Row;
  });
}
function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0)
    fail(
      `missing string ${key} in ${JSON.stringify(row['ItemTypeID'] ?? row['Field'] ?? row['FormulaID'])}`,
    );
  return value;
}
function playerText(row: Row, key: string): string {
  const value = text(row, key);
  if (INTERNAL_TEXT.test(value)) fail(`internal provenance in ${key}`);
  return value;
}
function one(source: readonly Row[], predicate: (row: Row) => boolean, label: string): Row {
  const result = source.filter(predicate);
  if (result.length !== 1) fail(`expected one ${label}, found ${result.length}`);
  return result[0]!;
}
function literal(row: Row, key: string, expected: unknown): void {
  if (row[key] !== expected)
    fail(`${key}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(row[key])}`);
}
function knownFields(row: Row, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(row).filter((key) => !allowed.includes(key));
  if (unexpected.length !== 0) fail(`${label} has unknown fields: ${unexpected.join(', ')}`);
}
function numeric(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`expected numeric ${key}`);
  return value;
}

function assertNormativeContract(source: Sources): string {
  const version = one(
    source['weapon-fields'],
    (row) => row['Field'] === 'templateProfileVersion',
    'templateProfileVersion',
  );
  literal(version, 'Default', 'ITEM_REGISTRY_V1.2');
  literal(
    one(source['weapon-fields'], (row) => row['Field'] === 'formulaVersion', 'formulaVersion'),
    'Validation / constraint',
    'Для PLAYER_FORMULA_VALIDATED = ITEM_FORMULAS_V1.2',
  );
  literal(
    one(
      source['weapon-fields'],
      (row) => row['Field'] === 'validationWitness',
      'validationWitness',
    ),
    'Validation / constraint',
    'Обязателен для PLAYER_FORMULA_VALIDATED; L/Lw/Ls и каждый независимый производственный дайс',
  );
  const validation = one(
    source.operations,
    (row) => row['OperationID'] === 'OP-REQ-VALIDATE',
    'OP-REQ-VALIDATE',
  );
  literal(
    validation,
    'Preconditions / validation',
    'FORMULA_MODE=VALIDATION_ONLY; все заявленные выходы совпадают одновременно; min/max только быстрый отказ',
  );
  literal(
    validation,
    'State transition / result',
    'VALID или INVALID; сохранить formulaId/formulaVersion/witness; без бросков и без создания предмета',
  );
  literal(
    one(source.operations, (row) => row['OperationID'] === 'OP-REQ-PLAYER', 'OP-REQ-PLAYER'),
    'Preconditions / validation',
    'Не-Чистое: CORE-185 exact joint witness. Чистое: PURE_WEAPON_PROFILE_LOCKED при любом расхождении. После создания редактирование запрещено',
  );
  const rule = one(source['rule-trace'], (row) => row['Rule ID'] === 'CORE-185', 'CORE-185');
  literal(rule, 'Статус', 'Активно');
  literal(
    rule,
    'Итоговый алгоритм',
    'Заявка валидна только при существовании одного общего набора допустимых переменных и независимых производственных witness-дайсов, который одновременно даёт все заявленные поля по одной формуле и одному варианту. Соблюдаются порядок вычислений, округление и минимумы формулы. Min/max используется лишь для быстрого отказа и не доказывает достижимость. Приложение не бросает дайсы, не выбирает случайный witness и не создаёт предмет.',
  );
  literal(
    rule,
    'Исключения / приоритет',
    'L, Lw и Ls трактуются как целочисленные параметры уровня; они неотрицательны, а Lw>0 во всех формулах, где он является делителем. Не заданные документом верхние границы не выдумываются.',
  );
  literal(
    one(source['rule-trace'], (row) => row['Rule ID'] === 'CORE-186', 'CORE-186'),
    'Итоговый алгоритм',
    'Игрок может заявить оружие Чистых только с полным каноническим шаблонным профилем. Поля характеристик отображаются только для чтения; statSource=TEMPLATE_FIXED. Любое расхождение с шаблоном отклоняется. Мастер вправе изменить конкретный экземпляр позднее по CORE-187/CORE-188.',
  );
  return text(version, 'Default');
}

function formulaContract(row: Row, range: Row): WeaponFormulaContract {
  knownFields(
    row,
    [
      'Dm',
      'Rn',
      'Rs',
      'Rd',
      'Execution mode',
      'FormulaID',
      'GM override',
      'Generation enabled',
      'ID уникален',
      'ItemTypeID',
      'Вариант',
      'Домен',
      'Контракт проверки',
      'Независимые дайсы',
      'Общие переменные',
      'Порядок/заметка',
    ],
    'formula',
  );
  literal(row, 'Execution mode', 'VALIDATION_ONLY');
  literal(row, 'Generation enabled', false);
  literal(
    row,
    'Домен',
    'L,Lw,Ls∈Z≥0; Lw>0 там, где является делителем; каждое вхождение R4/R6/R12/R20 независимо; вычисленные поля переиспользуются по порядку формулы',
  );
  literal(
    row,
    'Контракт проверки',
    'EXISTS one joint witness; сохранить formulaId, formulaVersion=ITEM_FORMULAS_V1.2 и весь witness',
  );
  const commonVariables = text(row, 'Общие переменные');
  if (commonVariables !== 'L,Lw' && commonVariables !== 'L,Lw,Ls')
    fail(`unknown common variables ${commonVariables}`);
  const independentDice = text(row, 'Независимые дайсы')
    .split(',')
    .map((key) => {
      const match = /^R(4|6|12|20)_(DMG|RANGE|RS|RD)$/.exec(key);
      if (match === null) return fail(`unrecognized independent die ${key}`);
      return {
        key,
        dieSides: Number(match[1]) as 4 | 6 | 12 | 20,
        label: `Независимое значение ${key}`,
      };
    });
  if (new Set(independentDice.map((die) => die.key)).size !== independentDice.length)
    fail('duplicate independent die address');
  const outputKeys = (['Dm', 'Rn', 'Rs', 'Rd'] as const).filter((key) => Object.hasOwn(row, key));
  if (outputKeys.join(',') !== 'Dm,Rn,Rs,Rd' && outputKeys.join(',') !== 'Rs,Rd')
    fail('unexpected formula output set');
  const allowed = new Set([
    ...commonVariables.split(','),
    ...independentDice.map((die) => die.key),
  ]);
  const expressions = outputKeys.map((key) => {
    const expressionSource = text(row, key);
    if (!expressionSource.startsWith(`${key} = `)) fail(`formula ${key} has invalid assignment`);
    const expression = parseWeaponFormula(expressionSource.slice(`${key} = `.length), allowed);
    allowed.add(key);
    return { key, expression };
  });
  const allVariables = expressions.flatMap(({ expression }) => weaponFormulaVariables(expression));
  for (const die of independentDice)
    if (allVariables.filter((key) => key === die.key).length !== 1)
      fail(`independent die ${die.key} must occur exactly once`);
  for (const key of commonVariables.split(','))
    if (!allVariables.includes(key)) fail(`declared witness variable ${key} is unused`);
  const lwDivisor = expressions.some(({ expression }) => {
    const contains = (node: typeof expression): boolean => {
      if (node.kind === 'BINARY')
        return (
          (node.operator === '/' && node.right.kind === 'VARIABLE' && node.right.key === 'Lw') ||
          contains(node.left) ||
          contains(node.right)
        );
      if (node.kind === 'MAX') return contains(node.left) || contains(node.right);
      return node.kind === 'CEIL' && contains(node.value);
    };
    return contains(expression);
  });
  const outputs = outputKeys.map((key) => {
    const max = range[`${key} max`];
    if (max !== '∞' && (typeof max !== 'number' || !Number.isFinite(max)))
      fail(`unknown ${key} maximum`);
    const step = key === 'Rn' ? numeric(range, 'Шаг Rn') : 1;
    if (step !== 1 && step !== 0.5) fail(`unsupported ${key} step ${step}`);
    const min = numeric(range, `${key} min`);
    if (min <= 0 || (typeof max === 'number' && max < min)) fail(`invalid ${key} range`);
    return {
      key,
      label: OUTPUT_LABELS[key],
      min,
      max: max === '∞' ? null : max,
      step,
    };
  });
  return {
    formulaId: text(row, 'FormulaID'),
    formulaVersion: 'ITEM_FORMULAS_V1.2',
    variables: (['L', 'Lw', 'Ls'] as const).map((key) => ({
      key,
      label: `Общий параметр ${key}`,
      min: key === 'Lw' && lwDivisor ? 1 : 0,
      step: 1,
    })),
    independentDice,
    outputs,
    expressions,
  };
}

function combatDefinition(row: Row): WeaponCombatDefinition {
  knownFields(
    row,
    [
      'CombatValueDefID',
      'ID check',
      'ItemTypeID',
      'PDF, с.',
      'Rule ID',
      'Semantic check',
      'attackVariantId',
      'baseExpression',
      'damageModifierStat',
      'dieType',
      'effectiveTemplateExpression',
      'evaluationScope',
      'instanceSourceField',
      'progressionEligibility',
      'rawRollPersistence',
      'resolvedResultField',
      'resolvedResultPersistence',
      'rollKind',
      'sourceNotation',
      'sourceScope',
      'valueKind',
      'valueMode',
      'Название',
      'Примечание',
      'rollGroupId',
      'conditionalOverride',
    ],
    'combat definition',
  );
  literal(row, 'ID check', 'PASS');
  literal(row, 'Semantic check', 'PASS');
  const valueMode = text(row, 'valueMode');
  if (valueMode !== 'INSTANCE_VALUE' && valueMode !== 'CONSTANT' && valueMode !== 'PER_ATTACK_ROLL')
    fail(`unknown combat value mode ${valueMode}`);
  if (valueMode === 'PER_ATTACK_ROLL') {
    text(row, 'rollGroupId');
    literal(row, 'evaluationScope', 'EACH_RESOLVED_ATTACK');
  } else literal(row, 'evaluationScope', 'PROFILE_SNAPSHOT');
  if (valueMode === 'INSTANCE_VALUE') {
    literal(row, 'instanceSourceField', 'instanceDamage');
    literal(row, 'baseExpression', 'item.instanceDamage');
  }
  return {
    definitionId: text(row, 'CombatValueDefID'),
    valueMode,
    sourceNotation: playerText(row, 'sourceNotation'),
    baseExpression: text(row, 'baseExpression'),
    sourceScope: text(row, 'sourceScope'),
    evaluationScope: text(row, 'evaluationScope'),
    ...(row['rollGroupId'] === undefined ? {} : { rollGroupId: text(row, 'rollGroupId') }),
    ...(row['instanceSourceField'] === undefined
      ? {}
      : { instanceSourceField: text(row, 'instanceSourceField') }),
    ...(row['conditionalOverride'] === undefined
      ? {}
      : { conditionalOverride: text(row, 'conditionalOverride') }),
    effectiveTemplateExpression: text(row, 'effectiveTemplateExpression'),
    damageModifierStat: text(row, 'damageModifierStat'),
    dieType: text(row, 'dieType'),
    rollKind: text(row, 'rollKind'),
    progressionEligibility: text(row, 'progressionEligibility'),
    rawRollPersistence: text(row, 'rawRollPersistence'),
    resolvedResultField: text(row, 'resolvedResultField'),
    resolvedResultPersistence: text(row, 'resolvedResultPersistence'),
  };
}

function fixedRequirements(row: Row): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const part of text(row, 'Требования').split('; ')) {
    const match = /^([SDIWMZC])(\d+)$/.exec(part);
    if (match === null) {
      if (part !== 'Стрельба ≥ средняя') fail(`unrecognized fixed requirement ${part}`);
      continue;
    }
    if (Object.hasOwn(result, match[1]!)) fail('duplicate fixed stat requirement');
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value) || value <= 0) fail('fixed stat requirement must be positive');
    result[match[1]!] = value;
  }
  return result;
}

function properties(
  row: Row,
  formula: WeaponFormulaContract | null,
): Readonly<Record<string, string | number | boolean>> {
  const result: Record<string, string | number | boolean> = {};
  for (const key of PROPERTY_FIELDS) {
    const raw = row[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean')
      fail(`unrecognized profile property ${key}`);
    let value: string | number | boolean = raw;
    if ((key === 'Можно метать' || key === 'Перезарядка атомарна') && typeof value !== 'boolean')
      fail(`profile ${key} must be boolean`);
    if (typeof value === 'number' && !Number.isFinite(value)) fail(`profile ${key} must be finite`);
    if (
      key === 'Особое правило' &&
      typeof value === 'string' &&
      value.startsWith('Формульная допустимость по ')
    ) {
      if (
        formula === null ||
        !value.startsWith(`Формульная допустимость по ${formula.formulaId}; `)
      )
        fail('unknown formula reference in special rule');
      value = value.slice(`Формульная допустимость по ${formula.formulaId}; `.length);
    }
    if (INTERNAL_TEXT.test(String(value))) fail(`internal provenance in property ${key}`);
    result[key] = value;
  }
  if (formula === null) result['Требования'] = playerText(row, 'Требования');
  return result;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

function buildCatalog(source: Sources): WeaponProfileCatalog {
  const templateProfileVersion = assertNormativeContract(source);
  // The identities and policies were established by CHR-022; this stage adds no choices.
  const canonical = CANONICAL_STARTING_WEAPON_CATALOG.entries;
  if (
    source['weapon-profiles'].length !== new Set(canonical.map((entry) => entry.weaponTypeId)).size
  )
    fail('canonical weapon profile count drifted');
  if (
    source.formulas.length !==
      canonical.filter((entry) => entry.profileKind === 'FORMULA').length ||
    source['formula-ranges'].length !== source.formulas.length
  )
    fail('formula or range count drifted');
  const combatRows = source['combat-values'].filter((row) =>
    text(row, 'ItemTypeID').startsWith('ITM-WPN-'),
  );
  if (combatRows.length !== canonical.length * 2) fail('canonical combat definition count drifted');
  const seenFormulaIds = new Set<string>();
  const entries = canonical.map((selection): WeaponProfileCatalogEntry => {
    const id = selection.weaponTypeId;
    const row = one(
      source['weapon-profiles'],
      (item) => item['ItemTypeID'] === id,
      `weapon-profiles ${id}`,
    );
    knownFields(
      row,
      [
        ...PROPERTY_FIELDS,
        'ItemTypeID',
        'Название',
        'PDF, с.',
        'Rule ID',
        'Дальность, м',
        'Требования',
        'Пробитие: исходное выражение',
        'Урон: исходное выражение',
      ],
      'weapon profile',
    );
    literal(row, 'Название', selection.name);
    const catalogue = one(source.catalogue, (item) => item['ItemTypeID'] === id, `catalogue ${id}`);
    literal(catalogue, 'Название', selection.name);
    literal(catalogue, 'Можно в инвентарь', true);
    literal(
      catalogue,
      'Политика заявки игрока',
      selection.profileKind === 'FORMULA' ? 'EXACT_JOINT_FORMULA' : 'TEMPLATE_FIXED',
    );
    const variantLabel = playerText(
      one(
        source.dictionaries,
        (item) =>
          item['Dictionary'] === 'ATTACK_VARIANT' && item['Code'] === selection.weaponVariant,
        `variant ${selection.weaponVariant}`,
      ),
      'Meaning',
    );
    let formula: WeaponFormulaContract | null = null;
    if (selection.profileKind === 'FORMULA') {
      const formulaRow = one(
        source.formulas,
        (item) => item['ItemTypeID'] === id && item['Вариант'] === selection.weaponVariant,
        `formula ${id}/${selection.weaponVariant}`,
      );
      const formulaId = text(formulaRow, 'FormulaID');
      if (
        seenFormulaIds.has(formulaId) ||
        !text(catalogue, 'Formula ID').split('; ').includes(formulaId)
      )
        fail(`undeclared or duplicate formula ${formulaId}`);
      seenFormulaIds.add(formulaId);
      const range = one(
        source['formula-ranges'],
        (item) =>
          item['FormulaID'] === formulaId &&
          item['ItemTypeID'] === id &&
          item['Вариант'] === selection.weaponVariant,
        `formula range ${formulaId}`,
      );
      formula = formulaContract(formulaRow, range);
      const expectedRequirement = formula.outputs.some((output) => output.key === 'Dm')
        ? 'PROFILE: statRequirements{S:Rs,D:Rd}; instanceDamage=Dm; rangeMeters=Rn'
        : id === 'ITM-WPN-012'
          ? 'PROFILE: statRequirements{S:Rs(хват),D:Rd}; gripMode фиксирован'
          : 'PROFILE: statRequirements{S:Rs,D:Rd}';
      literal(row, 'Требования', expectedRequirement);
    }
    const definition = (kind: 'DAMAGE' | 'PENETRATION'): WeaponCombatDefinition =>
      combatDefinition(
        one(
          combatRows,
          (item) =>
            item['ItemTypeID'] === id &&
            item['attackVariantId'] === selection.weaponVariant &&
            item['valueKind'] === kind,
          `combat ${id}/${selection.weaponVariant}/${kind}`,
        ),
      );
    const damageDefinition = definition('DAMAGE');
    const penetrationDefinition = definition('PENETRATION');
    if (
      damageDefinition.rollGroupId !== undefined &&
      damageDefinition.rollGroupId === penetrationDefinition.rollGroupId
    )
      fail('damage and penetration share a roll group');
    if (
      (formula?.outputs.some((output) => output.key === 'Dm') ?? false) !==
      (damageDefinition.valueMode === 'INSTANCE_VALUE')
    )
      fail('formula damage output does not match combat definition');
    const range = row['Дальность, м'];
    if (range === 'Rn' && !formula?.outputs.some((output) => output.key === 'Rn'))
      fail('range requires formula Rn');
    if (
      range !== undefined &&
      range !== 'Rn' &&
      (typeof range !== 'string' || !/^\d+(?:\.\d+)?$/.test(range) || Number(range) <= 0)
    )
      fail('invalid fixed range');
    const template: WeaponEffectiveProfile = {
      weaponTypeId: id,
      weaponVariantId: selection.weaponVariant,
      name: selection.name,
      variantLabel,
      templateProfileVersion,
      statSource: selection.profileKind === 'FIXED' ? 'TEMPLATE_FIXED' : 'PLAYER_FORMULA_VALIDATED',
      damageDefinition,
      penetrationDefinition,
      statRequirements: formula === null ? fixedRequirements(row) : {},
      ...(range === undefined || range === 'Rn' ? {} : { rangeMeters: Number(range) }),
      properties: properties(row, formula),
    };
    weaponProfilePlayerFacts(template);
    return {
      ...selection,
      variantLabel,
      canonicalProfileVersion: templateProfileVersion,
      formula,
      template,
      requirementPreview: {
        requirements:
          formula === null
            ? playerText(row, 'Требования')
            : 'Требования к силе и ловкости подтверждаются общим набором параметров профиля.',
        skillOrClass: playerText(row, 'Навык/класс'),
        missingSkillOrClassPenalty: playerText(row, 'Штраф без навыка/класса'),
      },
    };
  });
  return freeze({ entries });
}

export async function loadWeaponProfileCatalog(projectRoot: string): Promise<WeaponProfileCatalog> {
  const pairs = await Promise.all(
    SOURCE_FILES.map(
      async (file) =>
        [
          file,
          rows(
            JSON.parse(
              await readFile(
                join(projectRoot, 'generated', 'spec', 'items', `${file}.json`),
                'utf8',
              ),
            ),
            file,
          ),
        ] as const,
    ),
  );
  return buildCatalog(Object.fromEntries(pairs) as Record<SourceName, readonly Row[]>);
}

let canonicalCatalog: WeaponProfileCatalog | undefined;
/** Read-only cache of immutable delivered data for synchronous checkpoint verification. */
export function canonicalWeaponProfileCatalog(): WeaponProfileCatalog {
  if (canonicalCatalog === undefined) {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const sources = Object.fromEntries(
      SOURCE_FILES.map((file) => [
        file,
        rows(
          JSON.parse(
            readFileSync(join(root, 'generated', 'spec', 'items', `${file}.json`), 'utf8'),
          ),
          file,
        ),
      ]),
    ) as Record<SourceName, readonly Row[]>;
    canonicalCatalog = buildCatalog(sources);
  }
  return canonicalCatalog;
}
