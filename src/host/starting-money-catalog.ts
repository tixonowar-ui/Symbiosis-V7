import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CANONICAL_STARTING_MONEY_CATALOG,
  validateStartingMoneyCatalog,
  type StartingMoneyCatalog,
} from '../domain/rules/item-stage/starting-money.js';
import { array, readJsonFile, record, type JsonRecord } from './json-source.js';

const FILES = ['rule-trace', 'catalogue', 'dictionaries'] as const;
type Sources = Readonly<Record<(typeof FILES)[number], unknown>>;

// The older base paragraph is superseded explicitly by Q-CORE-052 in this same source row.
const CORE_172_ALGORITHM =
  'Нормативная база (действует во всей непротиворечащей части):\nрезультаты интерпретирует/озвучивает мастер либо таблица кампании; точное число бросков и отображение шкалы качества на деньги не определены.\nПриоритетные авторские дельты (заменяют только прямо пересекающиеся ветви):\n[Q-CORE-052] До бросков игрок выбирает по одному конкретному виду одежды и оружия из стартового списка. Для одежды, оружия и денег выполняются три независимых D20. Для одежды и оружия результат задаёт описательный уровень качества по шкале PDF; сам тег не меняет характеристики без отдельной таблицы кампании. Для денег диапазоны означают: 1–4 — нет денег; 5–9 — малая сумма; 10–14 — обычная; 15–18 — крупная; 19 — исключительная; 20 — редкое состояние. Выбранные предметы и уровень денег создаются у персонажа и до входа в кампанию направляются мастеру. Мастер может одобрить, отклонить или заменить предмет и подтвердить либо скорректировать деньги.\nD20 качества не изменяет механические характеристики профиля оружия. Готовый профиль проходит отдельный путь CORE-184–CORE-188.\nD20 создания персонажа, стартовых предметов и генерации их свойств имеют rollKind=CHARACTER_CREATION и маршрут NEVER_PROGRESSION.';
const AQ2_003_ALGORITHM =
  'Сохраняются восемь операций: один armorBundle, одно оружие, деньги и пять произвольных позиций. armorBundle содержит от одного до шести элементов для разных анатомических зон и разрешается одним D20; один итоговый тег качества применяется ко всему набору. Оружие выбирается строго одно и получает отдельный D20. Деньги получают отдельный D20. Каждая из пяти произвольных позиций содержит один вид предмета и выбранное положительное количество; один D20 относится ко всему стеку. Описательный предмет занимает одну из пяти произвольных позиций.\nОперация выбора одного оружия включает его готовый профиль: для формульного не-Чистого оружия — профиль игрока после CORE-185, для оружия Чистых — неизменный шаблон.';
const AQ2_004_ALGORITHM =
  'До мастерской проверки любой выбранный предмет и всё выбранное количество находятся в локальном инвентаре независимо от D20. Бросок не меняет количество и не даёт механических бонусов; он сохраняется как рекомендация качества по шкале V7 и показывается мастеру. В кампанийном экземпляре только итог мастера определяет предмет, количество, качество и деньги. Мастер обязан завершить проверку итоговым инвентарём, но вправе оставить отдельную категорию пустой или деньги равными нулю. «Нельзя отклонить инвентарь целиком» означает запрет оставить запрос без итогового состояния, а не гарантированную выдачу каждой категории.\nВ кампанийном экземпляре итог мастера определяет также эффективный профиль оружия; мастер может сохранить шаблон либо применить MASTER_OVERRIDE по CORE-187/CORE-188.';

export class StartingMoneyCatalogError extends Error {
  constructor(detail: string) {
    super(`starting money catalog: ${detail}`);
    this.name = new.target.name;
  }
}

function one(
  rows: readonly JsonRecord[],
  predicate: (row: JsonRecord) => boolean,
  label: string,
): JsonRecord {
  const found = rows.filter(predicate);
  if (found.length !== 1)
    throw new StartingMoneyCatalogError(
      `${label}: expected one row, found ${String(found.length)}`,
    );
  return found[0]!;
}
function literal(row: JsonRecord, key: string, expected: unknown, label: string): void {
  if (row[key] !== expected)
    throw new StartingMoneyCatalogError(`${label}.${key} differs from the supplied contract`);
}

function buildCatalog(source: Sources): StartingMoneyCatalog {
  const rows = (name: (typeof FILES)[number]) =>
    array(source[name], name).map((value, index) => record(value, `${name}[${String(index)}]`));
  const rules = rows('rule-trace');
  for (const [id, algorithm] of [
    ['CORE-172', CORE_172_ALGORITHM],
    ['AQ2-003', AQ2_003_ALGORITHM],
    ['AQ2-004', AQ2_004_ALGORITHM],
  ] as const) {
    const rule = one(rules, (row) => row['Rule ID'] === id, id);
    literal(rule, 'Статус', 'Активно', id);
    literal(rule, 'Итоговый алгоритм', algorithm, id);
  }
  const critical = one(rules, (row) => row['Rule ID'] === 'CORE-172', 'CORE-172');
  literal(
    critical,
    'Исключения / приоритет',
    'требования предметов сохраняются, уникальные артефакты автоматически не возникают.\nПоздние дельты применяются по приоритету AQ3 > AQ2 > AQA/CQA > базовая карточка; локальное исключение сильнее общего.\nНатуральная 1/20 здесь не создаёт XP и баллы.',
    'CORE-172',
  );
  const currency = one(
    rows('catalogue'),
    (row) => row['ItemTypeID'] === 'RES-CUR-000',
    'RES-CUR-000',
  );
  for (const [key, expected] of [
    ['Название', 'Деньги'],
    ['Категория', 'Валюта/ресурс'],
    ['Экипируется', false],
    ['Generation enabled', false],
    ['Полнота механики', 'PARTIAL'],
    ['Источник готовых параметров экземпляра', 'MASTER_DEFINED_OR_PARTIAL'],
  ] as const)
    literal(currency, key, expected, 'RES-CUR-000');
  const progression = one(
    rows('dictionaries'),
    (row) => row['Dictionary'] === 'ProgressionEligibility' && row['Code'] === 'NEVER_PROGRESSION',
    'ProgressionEligibility.NEVER_PROGRESSION',
  );
  literal(
    progression,
    'Meaning',
    'Ни XP, ни баллы общего счётчика.',
    'ProgressionEligibility.NEVER_PROGRESSION',
  );
  const scale = CANONICAL_STARTING_MONEY_CATALOG.wealthScale
    .map(({ range, label }) => `${range} — ${label}`)
    .join('; ');
  if (!CORE_172_ALGORITHM.includes(`Для денег диапазоны означают: ${scale}.`))
    throw new StartingMoneyCatalogError('domain wealth scale differs from CORE-172');
  for (const entry of CANONICAL_STARTING_MONEY_CATALOG.wealthScale) {
    const bounds = entry.range.split('–').map(Number);
    if (entry.minFace !== bounds[0] || entry.maxFace !== (bounds[1] ?? bounds[0]))
      throw new StartingMoneyCatalogError(`wealth bounds differ from source range ${entry.range}`);
  }
  validateStartingMoneyCatalog(CANONICAL_STARTING_MONEY_CATALOG);
  return CANONICAL_STARTING_MONEY_CATALOG;
}

export async function loadStartingMoneyCatalog(projectRoot: string): Promise<StartingMoneyCatalog> {
  const values = await Promise.all(
    FILES.map((file) =>
      readJsonFile(
        join(projectRoot, 'generated', 'spec', 'items', `${file}.json`),
        `starting money ${file}`,
      ),
    ),
  );
  return buildCatalog(
    Object.fromEntries(FILES.map((file, index) => [file, values[index]])) as Sources,
  );
}

let cached: StartingMoneyCatalog | undefined;
/** Durable validation is synchronous and reads only the immutable delivered source, never player data. */
export function canonicalStartingMoneyCatalog(): StartingMoneyCatalog {
  if (cached === undefined) {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    cached = buildCatalog(
      Object.fromEntries(
        FILES.map((file) => [
          file,
          JSON.parse(
            readFileSync(join(root, 'generated', 'spec', 'items', `${file}.json`), 'utf8'),
          ) as unknown,
        ]),
      ) as Sources,
    );
  }
  return cached;
}
