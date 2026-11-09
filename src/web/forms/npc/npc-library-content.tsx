import { useId, useState } from 'react';
import { NpcInputStatus, NpcCalendarStatus } from './npc-editor-fields.js';
import {
  NPC_SHEET_SECTIONS,
  NPC_VALIDATION_STAGE_IDS,
  type NpcFullSheetPreview,
  type NpcFinalReviewPresentation,
  type NpcHistoryPresentation,
  type NpcLibraryFilterField,
  type NpcLibraryPresentation,
  type NpcLibraryRow,
  type NpcSheetPresentation,
} from './npc-presentation.js';

const SECTION_LABELS = {
  IDENTITY: 'Идентичность',
  SCHEMA: 'Раса, класс и анатомия',
  STATS: 'Характеристики',
  SYMBIONTS: 'Симбионты и ОЭ',
  SKILLS: 'Навыки и слоты',
  INVENTORY: 'Инвентарь',
  INITIAL_STATE: 'HP, эффекты и исходное состояние',
} as const;
const FILTER_FIELDS = [
  'statusLabel',
  'affiliation',
  'groupLabelOrNull',
  'sceneLabelOrNull',
] as const satisfies readonly NpcLibraryFilterField[];
const FILTER_LABELS = {
  statusLabel: 'Статус',
  affiliation: 'Принадлежность',
  groupLabelOrNull: 'Группа',
  sceneLabelOrNull: 'Сцена',
} as const;
type Filters = Readonly<Record<NpcLibraryFilterField, string>>;
function matches(row: NpcLibraryRow, search: string, filters: Filters) {
  // This is a view of an already authorized GM projection, never an access-control filter.
  return (
    [
      row.name,
      row.affiliation,
      row.campaignRole,
      row.locationLabelOrNull,
      row.subLocationLabelOrNull,
    ].some((value) => value?.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))) &&
    FILTER_FIELDS.every((field) => filters[field] === '' || filters[field] === row[field])
  );
}
export function NpcLibraryContent({
  presentation: p,
  onSelect,
}: {
  readonly presentation: NpcLibraryPresentation;
  readonly onSelect: (npcUuid: string | null) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>({
    statusLabel: '',
    affiliation: '',
    groupLabelOrNull: '',
    sceneLabelOrNull: '',
  });
  const rows = p.rows.filter((row) => matches(row, search, filters));
  return (
    <section data-npc-content="NPC-001">
      <NpcInputStatus state={p.state} />
      <label htmlFor={`${id}-search`}>Поиск НПС</label>
      <input
        id={`${id}-search`}
        type="search"
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      {FILTER_FIELDS.map((field) => (
        <label key={field}>
          {FILTER_LABELS[field]}
          <select
            value={filters[field]}
            onChange={(event) => setFilters({ ...filters, [field]: event.currentTarget.value })}
          >
            <option value="">Все</option>
            {[
              ...new Set(
                p.rows
                  .map((row) => row[field])
                  .filter((value): value is string => value !== null && value !== ''),
              ),
            ].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ))}
      {p.selectedNpcUuidOrNull !== null &&
        !rows.some((row) => row.npcUuid === p.selectedNpcUuidOrNull) && (
          <p role="status">Выбранный НПС не показан с текущим фильтром.</p>
        )}
      <fieldset disabled={p.state.readOnly || p.state.pending}>
        <legend>Выбор НПС</legend>
        <label>
          <input
            type="radio"
            name={`${id}-npc`}
            checked={p.selectedNpcUuidOrNull === null}
            onChange={() => onSelect(null)}
          />
          Без выбранного НПС
        </label>
        {rows.map((row) => (
          <article key={row.npcUuid}>
            <label>
              <input
                type="radio"
                name={`${id}-npc`}
                checked={p.selectedNpcUuidOrNull === row.npcUuid}
                onChange={() => onSelect(row.npcUuid)}
              />
              {row.name} — версия {row.currentVersion}
            </label>
            {row.artOrNull === null ? (
              <p>Изображение отсутствует.</p>
            ) : row.artOrNull.status !== 'READY' ? (
              <p role="status">
                {row.artOrNull.status === 'LOADING'
                  ? 'Изображение НПС загружается…'
                  : 'Изображение НПС недоступно.'}
              </p>
            ) : (
              <img
                src={row.artOrNull.url}
                alt={`Изображение ${row.name}`}
                style={{ maxWidth: '100%', maxHeight: 240, height: 'auto', objectFit: 'contain' }}
              />
            )}
            <dl>
              <div>
                <dt>Статус</dt>
                <dd>{row.statusLabel}</dd>
              </div>
              <div>
                <dt>Принадлежность</dt>
                <dd>{row.affiliation}</dd>
              </div>
              <div>
                <dt>Роль в кампании</dt>
                <dd>{row.campaignRole}</dd>
              </div>
              <div>
                <dt>Группа</dt>
                <dd>{row.groupLabelOrNull ?? 'Не назначена'}</dd>
              </div>
              <div>
                <dt>Местоположение</dt>
                <dd>
                  {row.locationLabelOrNull ?? 'Не задано'}
                  {row.subLocationLabelOrNull === null ? '' : ` / ${row.subLocationLabelOrNull}`}
                </dd>
              </div>
              <div>
                <dt>Сцена</dt>
                <dd>{row.sceneLabelOrNull ?? 'Не назначена'}</dd>
              </div>
            </dl>
          </article>
        ))}
      </fieldset>
      {rows.length === 0 && (
        <p>
          {p.rows.length === 0
            ? 'В кампании пока нет сохранённых НПС.'
            : 'НПС с такими условиями не найдены.'}
        </p>
      )}
    </section>
  );
}
export function NpcSheetContent({ sheet }: { readonly sheet: NpcSheetPresentation }) {
  return (
    <section data-npc-content="NPC-003">
      <h3>{sheet.name}</h3>
      <p>
        Показана версия {sheet.displayedVersion}. Текущая версия: {sheet.currentVersion}. Ревизия
        истории: {sheet.historyRevision}.
      </p>
      {sheet.displayedVersion !== sheet.currentVersion && (
        <p>
          Историческая версия доступна только для просмотра. Новая версия создаётся из текущего
          листа.
        </p>
      )}
      <NpcFullSheetFields sheet={sheet} />
    </section>
  );
}
export function NpcHistoryContent({
  presentation: p,
  onSelect,
}: {
  readonly presentation: NpcHistoryPresentation;
  readonly onSelect: (version: number) => void;
}) {
  const id = useId();
  return (
    <section data-npc-content="NPC-007">
      <NpcInputStatus state={p.state} />
      <p>Текущая версия: {p.currentVersion}. Сохранённые версии неизменяемы.</p>
      <fieldset disabled={p.state.readOnly || p.state.pending}>
        <legend>Просмотр версии НПС</legend>
        {p.entries.map((entry) => (
          <div key={entry.version}>
            <label>
              <input
                type="radio"
                name={`${id}-version`}
                checked={p.selectedVersionOrNull === entry.version}
                onChange={() => onSelect(entry.version)}
              />
              Версия {entry.version}
              {entry.version === p.currentVersion ? ' — текущая' : ''}
            </label>
            <p>
              {entry.authorLabel} · {entry.timestampLabel}
            </p>
            {entry.changeReasonOrNull !== null && <p>Причина: {entry.changeReasonOrNull}</p>}
          </div>
        ))}
      </fieldset>
      {p.previewOrNull === null ? (
        <p>Выберите версию для просмотра.</p>
      ) : (
        <NpcSheetContent sheet={p.previewOrNull} />
      )}
    </section>
  );
}

function NpcFullSheetFields({ sheet }: { readonly sheet: NpcFullSheetPreview }) {
  return (
    <>
      {sheet.artOrNull === null ? (
        <p>Изображение отсутствует.</p>
      ) : sheet.artOrNull.status !== 'READY' ? (
        <p role="status">
          {sheet.artOrNull.status === 'LOADING'
            ? 'Изображение НПС загружается…'
            : 'Изображение НПС недоступно.'}
        </p>
      ) : (
        <img
          src={sheet.artOrNull.url}
          alt={`Изображение ${sheet.name}`}
          style={{ maxWidth: '100%', maxHeight: 240, height: 'auto', objectFit: 'contain' }}
        />
      )}
      {NPC_SHEET_SECTIONS.map((section) => (
        <section key={section}>
          <h4>{SECTION_LABELS[section]}</h4>
          {sheet.sections[section].length === 0 ? (
            <p>Нет записей.</p>
          ) : (
            <dl>
              {sheet.sections[section].map((row, index) => (
                <div key={index}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
      <h4>Сохранённые ссылки боёв</h4>
      {sheet.pinnedCombatReferences.length === 0 ? (
        <p>Ссылок нет.</p>
      ) : (
        <ul>
          {sheet.pinnedCombatReferences.map((reference, index) => (
            <li key={index}>
              {reference.label}: версия {reference.version}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The generic AtlasForm retains Save/Back and opens a saved sheet only after a host receipt. */
export function NpcFinalReviewContent({
  presentation: p,
}: {
  readonly presentation: NpcFinalReviewPresentation;
}) {
  const statuses = {
    INCOMPLETE: 'Не завершено',
    INVALID: 'Есть ошибки',
    VALID: 'Проверено хостом',
  } as const;
  return (
    <section data-npc-content="NPC-017">
      <NpcInputStatus state={p.state} />
      <h3>Итоговая проверка НПС</h3>
      <p>
        {p.binding.editMode === 'CREATE_V1'
          ? 'Создание первой версии НПС.'
          : 'Новая версия существующего НПС.'}
      </p>
      {p.binding.versionBindingOrNull !== null && (
        <p>Текущая версия: {p.binding.versionBindingOrNull.expectedCurrentVersion}.</p>
      )}
      <p>
        Версия после подтверждённого сохранения: {p.binding.resultVersion}. Ревизия попытки:{' '}
        {p.binding.attemptRevision}.
      </p>
      <p>Полная проверка: {statuses[p.fullValidationStatus]}.</p>
      <ol aria-label="Проверка восьми этапов">
        {NPC_VALIDATION_STAGE_IDS.map((id) => (
          <li key={id} data-npc-stage={id}>
            <h4>
              {p.stages[id].label}: {statuses[p.stages[id].status]}
            </h4>
            {p.stages[id].messages.map((message, index) => (
              <p key={index}>{message}</p>
            ))}
          </li>
        ))}
      </ol>
      {p.validationErrors.map((message, index) => (
        <p role="alert" key={index}>
          {message}
        </p>
      ))}
      <NpcCalendarStatus calendar={p.calendar} />
      {p.previewOrNull === null ? (
        <p>Полный лист ещё не подготовлен хостом.</p>
      ) : (
        <section aria-label="Предпросмотр полного листа">
          <h3>{p.previewOrNull.name}</h3>
          <NpcFullSheetFields sheet={p.previewOrNull} />
        </section>
      )}
      <p>{p.commitStatusLabel}</p>
      {p.receiptOrNull === null ? (
        <p>Подтверждение сохранения не получено.</p>
      ) : (
        <section aria-label="Подтверждённое сохранение">
          <p>Сохранена версия {p.receiptOrNull.version}.</p>
          <p>{p.receiptOrNull.historyEntryLabel}</p>
        </section>
      )}
    </section>
  );
}
