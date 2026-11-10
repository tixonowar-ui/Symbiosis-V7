import type { JsonObject, JsonValue } from '@shared/wire-protocol.js';
import {
  enemyLibraryProjectionValue,
  type EnemyLibrarySelection,
  type EnemyLibraryTab,
} from '@shared/enemy-library.js';

const labels: Readonly<Record<string, string>> = {
  displayName: 'Название',
  race: 'Раса',
  pureClass: 'Класс',
  factionGroup: 'Группа каталога',
  combatRole: 'Боевая роль',
  threatTier: 'Угроза',
  massKg: 'Масса, кг',
  maxHP: 'Максимум HP',
  baseStats: 'Базовые характеристики',
  skillStageStats: 'Характеристики на этапе навыков',
  effectiveStats: 'Эффективные характеристики',
  equippedStats: 'Характеристики с экипировкой',
  skills: 'Навыки',
  symbionts: 'Симбионты',
  symbioticMonster: 'Симбиотическое чудовище',
  items: 'Предметы',
  progressionPolicy: 'Политика развития',
};
const names: Readonly<Record<string, string>> = {
  PURE: 'Чистые',
  FREE: 'Вольные',
  UNITED: 'Единые',
  STALKER: 'Сталкер',
  SOLDIER: 'Солдат',
  SEEKER: 'Искатель',
  TRAINED: 'Обученный',
  VETERAN: 'Ветеран',
  ELITE: 'Элита',
  BOSS: 'Босс',
  NO_XP_PROGRESSION: 'Развитие за опыт отсутствует',
  HAND_L: 'Левая рука',
  HAND_R: 'Правая рука',
  BOTH_HANDS: 'Обе руки',
  HEAD: 'Голова',
  TORSO: 'Торс',
  ARM_L: 'Левая рука',
  ARM_R: 'Правая рука',
  LEG_L: 'Левая нога',
  LEG_R: 'Правая нога',
  ALL_SIX: 'Все шесть зон',
  INVENTORY: 'Инвентарь',
  FULL_SUIT: 'Полный костюм',
  STOWED_BACK: 'За спиной',
};
function factText(value: JsonValue | undefined): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  throw new Error('Expected a decoded scalar sheet fact');
}
function Stats({ value }: { readonly value: JsonObject }) {
  return (
    <span>
      {Object.entries(value)
        .map(([key, value]) => key + ': ' + factText(value))
        .join(' · ')}
    </span>
  );
}
function SheetFact({ label, value }: { readonly label: string; readonly value: JsonValue }) {
  if (value === null) return <span>Нет</span>;
  if (['baseStats', 'skillStageStats', 'effectiveStats', 'equippedStats'].includes(label))
    return <Stats value={value as JsonObject} />;
  if (label === 'symbioticMonster') {
    const row = value as JsonObject;
    return (
      <span>
        Уровень {factText(row['targetLevel'])} · максимум ОЭ {factText(row['maxOE'])} · прибавка к
        максимуму HP {factText(row['maxHPBonus'])}
        <br />
        Постоянные изменения: <Stats value={row['permanentStatDelta'] as JsonObject} />
      </span>
    );
  }
  if (Array.isArray(value))
    return value.length === 0 ? (
      <span>Нет</span>
    ) : (
      <ul>
        {value.map((value, i) => {
          const row = value as JsonObject;
          if (label === 'skills')
            return (
              <li key={i}>
                <strong>{factText(row['skillName'])}</strong>
                {row['bonus'] === null ? '' : ' · бонус ' + factText(row['bonus'])} · стоимость
                слотов {factText(row['slotCost'])}
                {row['note'] === '' ? '' : ' · ' + factText(row['note'])}
              </li>
            );
          if (label === 'symbionts')
            return (
              <li key={i}>
                <strong>{factText(row['speciesName'])}</strong> · уровень{' '}
                {factText(row['targetLevel'])} · эффективный уровень{' '}
                {factText(row['effectiveLevel'])} · максимум ОЭ {factText(row['maxOE'])}
              </li>
            );
          return (
            <li key={i}>
              <strong>{factText(row['itemName'])}</strong> · {names[factText(row['equipSlot'])]}
              {row['bodyZone'] === undefined ? '' : ' · зона: ' + names[factText(row['bodyZone'])]}
              {row['quantity'] === undefined ? '' : ' · количество ' + factText(row['quantity'])}
              {row['currentAmmo'] === undefined
                ? ''
                : row['currentAmmo'] === null
                  ? ' · боезапас не задан'
                  : ' · боезапас ' + factText(row['currentAmmo'])}
            </li>
          );
        })}
      </ul>
    );
  return <span>{names[factText(value)] ?? factText(value)}</span>;
}
export function EnemyLibraryContent({
  projection,
  onSelect,
}: {
  readonly projection: JsonObject;
  readonly onSelect: (tab: EnemyLibraryTab, selection: EnemyLibrarySelection | null) => void;
}) {
  const p = enemyLibraryProjectionValue(projection);
  if (p.formId === 'ENM-003') {
    const card = p.cardOrNull!;
    return (
      <section aria-label="Системный шаблон" data-enemy-system-card={card.template.templateId}>
        <h2>{card.template.displayName}</h2>
        <p>Неизменяемый системный шаблон · {card.template.catalogVersion}</p>
        <img
          alt={card.template.displayName}
          src={`data:${card.art.mediaType};base64,${card.art.bytesBase64}`}
          width={320}
        />
        <dl>
          {card.fields.map((field) => {
            const value = field.value;
            return (
              <div key={field.label}>
                <dt>{labels[field.label] ?? field.label}</dt>
                <dd>
                  <SheetFact label={field.label} value={value} />
                </dd>
              </div>
            );
          })}
        </dl>
      </section>
    );
  }
  const entries = p.activeTab === 'SENTIENT_ENEMIES' ? p.systemTemplates : p.canonicalTemplates;
  return (
    <section aria-label="Каталог врагов кампании" data-enemy-library>
      <div role="tablist" aria-label="Раздел каталога">
        <button
          type="button"
          role="tab"
          aria-selected={p.activeTab === 'SENTIENT_ENEMIES'}
          onClick={() => onSelect('SENTIENT_ENEMIES', null)}
        >
          Мыслящие враги
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={p.activeTab === 'MONSTERS'}
          onClick={() => onSelect('MONSTERS', null)}
        >
          Монстры
        </button>
      </div>
      <section
        role="tabpanel"
        aria-label={p.activeTab === 'SENTIENT_ENEMIES' ? 'Мыслящие враги' : 'Монстры'}
      >
        <h2>
          {p.activeTab === 'SENTIENT_ENEMIES' ? 'Системные мыслящие' : 'Канонический бестиарий'}
        </h2>
        <p>
          {p.activeTab === 'SENTIENT_ENEMIES'
            ? `${entries.length} неизменяемых системных шаблонов · ${p.defaultSentientCatalogVersion}`
            : `${new Set(entries.map((x) => x.speciesIdOrNull)).size} видов · ${entries.length} статблоков`}
        </p>
        <ul>
          {entries.map((entry) => (
            <li key={entry.templateId} data-enemy-template={entry.templateId}>
              <label>
                <input
                  type="radio"
                  name="enemy-template"
                  value={entry.templateId}
                  checked={
                    p.selectedOrNull?.templateId === entry.templateId &&
                    p.selectedOrNull.origin === entry.origin
                  }
                  onChange={() =>
                    onSelect(p.activeTab, {
                      origin: entry.origin,
                      templateId: entry.templateId,
                      catalogVersion: entry.catalogVersion,
                      artAssetKey: entry.artAssetKey,
                    })
                  }
                />
                {entry.displayName}
              </label>
              <p>{entry.summary}</p>
              <small>
                {entry.templateId}
                {entry.speciesIdOrNull === null ? '' : ' · ' + entry.speciesIdOrNull}
              </small>
            </li>
          ))}
        </ul>
        {p.selectedOrNull?.origin === 'CANONICAL_BESTIARY' ? (
          <p>Выбрана каноническая запись. Карточка системного мыслящего к ней не относится.</p>
        ) : null}
        <h2>Пользовательские шаблоны этой кампании</h2>
        <p>Сохранённых пользовательских шаблонов нет.</p>
        <p>
          Создание, версии, фильтры, инстанцирование и генерация противников в этом выпуске
          недоступны.
        </p>
      </section>
    </section>
  );
}
