import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ActionKey } from '@generated/types/atlas.js';
import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';
import type { JsonObject, JsonValue } from '@shared/index.js';
import type { PostSaveCommandResult, PostSaveMetadata } from '@shared/local-character-post-save.js';
import { CHARACTER_ART_ACCEPT, characterArtFromFile } from '../../character-art.js';

/** Download the exact host bytes; parsing/re-stringifying would break the byte-stable receipt. */
export function downloadPostSaveFile(
  file: NonNullable<PostSaveCommandResult['downloadOrNull']>,
): Promise<void> {
  return new Promise((resolve) => {
    const bytes = new TextEncoder().encode(file.contentText);
    // HTTP LAN origins do not expose crypto.subtle. The host binds this digest to the receipt.
    if (!/^[a-f0-9]{64}$/.test(file.bytesSha256)) throw new Error('Export digest is malformed');
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.fileName;
    link.hidden = true;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    resolve();
  });
}
const text = (v: JsonValue | undefined) =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : '';
const object = (v: JsonValue | undefined) => v as JsonObject;
const rows = (v: JsonValue | undefined) => v as readonly JsonObject[];
const rollLabels: Readonly<Record<string, string>> = {
  STAT_SET: 'Набор характеристик',
  STAT_CRITICAL_CONFIRMATION: 'Подтверждение критического результата характеристики',
  SPECIES_ORIGIN: 'Вид симбионта',
  CRITICAL_CONFIRMATION: 'Подтверждение критического результата симбионта',
  ADVISOR_I: 'Интеллект Советника',
  ADVISOR_W: 'Мудрость Советника',
  TROGR_SUPPRESSION_B: 'Подавление Трогра',
  ARMOR_BUNDLE_QUALITY: 'Качество комплекта брони',
  STARTING_WEAPON_QUALITY: 'Качество оружия',
  STARTING_MONEY: 'Стартовые деньги',
  FIVE_STARTING_POSITION_QUALITY: 'Качество стартовой позиции',
};
function SavedVersionFacts({ projection: p }: { readonly projection: JsonObject }): ReactElement {
  const proof = object(p['provenance']);
  return (
    <details>
      <summary>Версия и контрольные суммы сохранения</summary>
      <dl>
        {[
          ['Персонаж', p['sourceEntityId']],
          ['Версия финального листа', proof['finalSnapshotVersion']],
          ['Квитанция финального сохранения', proof['finalSaveReceiptId']],
          ['Ревизия локальных метаданных', p['localMetadataRevision']],
          ['Контрольная сумма экспорта', p['checksum']],
          ['Контрольная сумма исходного снимка', proof['sourceChecksum']],
          ['Снимок', proof['sourceSnapshotId']],
          ['Версия реестра', proof['registryVersion']],
          ['Версия каталога', proof['catalogVersion']],
          ['Совместимость поставки', proof['builtAgainstTuple']],
        ].map(([label, value]) => (
          <div key={text(label)}>
            <dt>{text(label)}</dt>
            <dd>{text(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
function Stats({ value }: { readonly value: JsonObject }): ReactElement {
  return (
    <dl>
      {Object.entries(value).map(([code, n]) => (
        <div key={code}>
          <dt>{code}</dt>
          <dd>{text(n)}</dd>
        </div>
      ))}
    </dl>
  );
}
function FinalMechanics({ value }: { readonly value: JsonObject }): ReactElement {
  const identity = object(value['identity']),
    race = object(value['race']),
    pureClass = value['classOrNull'] as JsonObject | null;
  const runtime = object(value['runtime']),
    property = object(value['property']);
  const armor = object(property['armorBundle']),
    weapon = object(property['weapon']),
    money = object(property['moneyRecommendation']);
  return (
    <section aria-label="Неизменяемая механика персонажа">
      <h2>Финальный лист</h2>
      <p>
        {text(race['label'])}
        {pureClass === null ? '' : ` — ${text(pureClass['label'])}`}
      </p>
      <p>
        Возраст: {text(identity['age'])}. Пол: {identity['sex'] === 'MALE' ? 'мужской' : 'женский'}.
        Масса: {text(identity['massKg'])} кг.
      </p>
      <h3>Характеристики</h3>
      <Stats value={object(value['effectiveStats'])} />
      <details>
        <summary>Расчёт характеристик</summary>
        <table>
          <thead>
            <tr>
              <th>Характеристика</th>
              <th>До симбионтов</th>
              <th>Положительные изменения</th>
              <th>Применённые отрицательные изменения</th>
              <th>До ограничений</th>
              <th>Минимум</th>
              <th>Максимум</th>
              <th>Итог</th>
            </tr>
          </thead>
          <tbody>
            {rows(value['statProof']).map((p) => (
              <tr key={text(p['statCode'])}>
                {[
                  'statCode',
                  'skillStageValue',
                  'positiveSymbiontDelta',
                  'appliedNegativeDelta',
                  'beforeLimits',
                  'minimumOrNull',
                  'maximumOrNull',
                  'effectiveValue',
                ].map((key) => (
                  <td key={key}>{p[key] === null ? 'Нет' : text(p[key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p>
        Здоровье: {text(runtime['currentHp'])} / {text(runtime['maxHp'])}. Жив, в сознании.
      </p>
      <h3>Навыки</h3>
      <ul>
        {rows(value['skills']).map((s, i) => (
          <li key={i}>
            {text(s['label'])}: +{text(s['bonus'])}, слотов: {text(s['slotCost'])}.
          </li>
        ))}
      </ul>
      <h3>Симбионты</h3>
      {rows(value['symbionts']).length === 0 ? (
        <p>Нет симбионтов.</p>
      ) : (
        rows(value['symbionts']).map((s, i) => (
          <article key={i}>
            <h4>{text(s['label'])}</h4>
            <p>
              Уровень {text(s['level'])}; ОЕ {text(s['currentOe'])} / {text(s['maxOe'])}; опыт{' '}
              {text(s['xp'])}.
            </p>
            <p>
              Состояние:{' '}
              {
                (
                  {
                    ACTIVE: 'Активен',
                    SUPPRESSED: 'Подавлен',
                    ABSORBED: 'Поглощён',
                    DESTROYED: 'Уничтожен',
                  } as Record<string, string>
                )[text(s['status'])]
              }
              .
            </p>
            <p>
              Эффекты: {s['effectsEnabled'] ? 'включены' : 'выключены'}; опыт:{' '}
              {s['xpEligible'] ? 'начисляется' : 'не начисляется'}.
            </p>
            <p>
              Привязка:{' '}
              {
                (
                  {
                    NONE: 'не требуется',
                    OWL_EYE: 'глаз',
                    EEL_ARM: 'рука',
                    TICK_RIGHT_HAND: 'правая кисть',
                    SPIDER_BOTH_WRISTS: 'оба запястья',
                    MANTIS_BOTH_FOREARMS: 'оба предплечья',
                  } as Record<string, string>
                )[text(object(s['binding'])['kind'])]
              }
              {object(s['binding'])['side'] === undefined
                ? ''
                : object(s['binding'])['side'] === 'LEFT'
                  ? ', слева'
                  : ', справа'}
              .
            </p>
            <ul>
              {rows(s['learnedNodes']).map((n, j) => (
                <li key={j}>
                  {text(n['label'])} — уровень {text(n['level'])}
                </li>
              ))}
            </ul>
          </article>
        ))
      )}
      {value['advisorOrNull'] === null ? null : (
        <section>
          <h3>Советник</h3>
          <p>
            Интеллект: {text(object(value['advisorOrNull'])['intelligence'])}; мудрость:{' '}
            {text(object(value['advisorOrNull'])['wisdom'])}.
          </p>
          {object(value['advisorOrNull'])['suppressionBonusOrNull'] === null ? null : (
            <p>
              Бонус подавления: {text(object(value['advisorOrNull'])['suppressionBonusOrNull'])}.
            </p>
          )}
          <ul>
            {rows(object(value['advisorOrNull'])['skills']).map((s, i) => (
              <li key={i}>
                {text(s['label'])}: +{text(s['bonus'])}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p>
        Учебные слоты: ранее выдано {text(object(value['trainingSlotLedger'])['everIssued'])};
        максимальная постоянная мудрость{' '}
        {text(object(value['trainingSlotLedger'])['maxPermanentWisdom'])}.
      </p>
      {rows(value['permanentGrants']).map((g, i) => (
        <p key={i}>
          Постоянный бонус «Громила»: {text(g['bonusBefore'])} → {text(g['bonusAfter'])}.
        </p>
      ))}
      <h3>Стартовое имущество</h3>
      <p>Восемь имущественных операций. Предметы принадлежат персонажу и не экипированы.</p>
      <p>Броня: {text(object(armor['qualityRecommendation'])['label'])}.</p>
      <ul>
        {rows(armor['armorPieces']).map((p, i) => (
          <li key={i}>{text(p['name'])}</li>
        ))}
      </ul>
      <p>
        Оружие: {text(weapon['name'])}, {text(object(weapon['qualityRecommendation'])['label'])}.
      </p>
      <dl>
        {rows(weapon['profileFacts']).map((f, i) => (
          <div key={i}>
            <dt>{text(f['label'])}</dt>
            <dd>
              {typeof f['value'] === 'boolean' ? (f['value'] ? 'Да' : 'Нет') : text(f['value'])}
            </dd>
          </div>
        ))}
      </dl>
      {rows(value['manufacturingReceipts']).length === 0 ? null : (
        <details>
          <summary>Подтверждённые свидетели изготовления</summary>
          <p>Значения введены игроком и проверены хостом; это не новые броски.</p>
          <ul>
            {rows(value['manufacturingReceipts']).map((r, i) => (
              <li key={i}>
                {text(r['variable'])}: {text(r['value'])} из диапазона d{text(r['dieSides'])}.
              </li>
            ))}
          </ul>
        </details>
      )}
      <p>Деньги: {text(object(money['wealthRecommendation'])['label'])}. Итог определяет мастер.</p>
      <ul>
        {rows(property['fivePositions']).map((p, i) => (
          <li key={i}>
            {text(p['name'])} × {text(p['quantity'])};{' '}
            {text(object(p['qualityRecommendation'])['label'])}
            {p['storyDescriptionOrNull'] === null ? '' : ` — ${text(p['storyDescriptionOrNull'])}`}
          </li>
        ))}
      </ul>
      <details>
        <summary>Начальное состояние</summary>
        <p>
          Раны, травмы, кровотечения, временные эффекты, перезарядки, подготовки и боевые лимиты
          отсутствуют. Нет оглушения, связывания, горения, отравления или болезни.
        </p>
        <p>
          Боевой сцены и инициативы нет. Счётчики развития и нераспределённого опыта равны нулю.
          Созданных объектов, внешних сущностей и истории пожирания нет.
        </p>
        <p>
          Ми-ми-ми: {runtime['penguinMiMiMiActive'] ? 'включено' : 'выключено'}; Крыса внутри
          носителя: {runtime['ratInsideHost'] ? 'да' : 'нет'}; Хранитель внутри носителя:{' '}
          {runtime['keeperInsideHost'] ? 'да' : 'нет'}.
        </p>
        {runtime['taipanPoisonOrNull'] === null ? null : <p>Яд Тайпана: смертельный.</p>}
        {runtime['mantisBladeStateOrNull'] === null ? null : (
          <p>Клинки Богомола: обычное состояние.</p>
        )}
      </details>
    </section>
  );
}
export function MetadataFields({
  projection,
  enabled,
  onMetadata,
}: {
  readonly projection: JsonObject;
  readonly enabled: boolean;
  readonly onMetadata: (values: PostSaveMetadata) => void;
}): ReactElement {
  const [values, setValues] = useState<PostSaveMetadata>({
    name: projection['name'] as string,
    description: projection['description'] as string | null,
    artAssetKeyOrLocalFile: projection[
      'artAssetKeyOrLocalFile'
    ] as PostSaveMetadata['artAssetKeyOrLocalFile'],
  });
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const token = useRef<object | null>(null);
  useEffect(
    () => () => {
      token.current = null;
    },
    [],
  );
  const replaceArt = (art: PostSaveMetadata['artAssetKeyOrLocalFile']) => {
    token.current = null;
    setPending(false);
    setError(null);
    setValues((current) => ({ ...current, artAssetKeyOrLocalFile: art }));
  };
  return (
    <section aria-label="Локальные метаданные">
      <h2>Имя, описание и арт</h2>
      <p>Механика и история создания не изменяются.</p>
      <label>
        Имя
        <input
          aria-label="Локальное имя"
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
      </label>
      <label>
        Описание
        <textarea
          aria-label="Локальное описание"
          value={values.description ?? ''}
          onChange={(e) => setValues({ ...values, description: e.target.value || null })}
        />
      </label>
      <label>
        Портрет
        <select
          aria-label="Локальный портрет"
          value={
            values.artAssetKeyOrLocalFile?.kind === 'asset-key'
              ? values.artAssetKeyOrLocalFile.assetKey
              : ''
          }
          onChange={(e) => {
            const key = e.target.value;
            if (
              key !== '' &&
              !(LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS as readonly string[]).includes(key)
            )
              throw new Error('unknown portrait');
            replaceArt(key === '' ? null : { kind: 'asset-key', assetKey: key });
          }}
        >
          <option value="">Не выбран</option>
          {LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>
      <label>
        Файл PNG или JPEG
        <input
          aria-label="Локальный файл PNG или JPEG"
          type="file"
          accept={CHARACTER_ART_ACCEPT}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file === undefined) return;
            const read = {};
            token.current = read;
            setPending(true);
            setError(null);
            void characterArtFromFile(file)
              .then((result) => {
                if (token.current !== read) return;
                if (result.ok) replaceArt(result.value);
                else {
                  setPending(false);
                  token.current = null;
                  setError(
                    result.reason === 'FILE_TOO_LARGE'
                      ? 'Файл превышает 12 МБ.'
                      : 'Файл не является PNG или JPEG.',
                  );
                }
              })
              .catch(() => {
                if (token.current !== read) return;
                token.current = null;
                setPending(false);
                setError('Не удалось прочитать файл.');
              });
          }}
        />
      </label>
      <p>
        {values.artAssetKeyOrLocalFile === null
          ? 'Арт не выбран.'
          : values.artAssetKeyOrLocalFile.kind === 'local-file'
            ? `Локальный файл: ${values.artAssetKeyOrLocalFile.mediaType}`
            : `Портрет: ${values.artAssetKeyOrLocalFile.assetKey}`}
      </p>
      <button type="button" onClick={() => replaceArt(null)}>
        Удалить локальный арт
      </button>
      {pending ? <p role="status">Чтение файла…</p> : null}
      {error === null ? null : <p role="alert">{error}</p>}
      {enabled ? (
        <button
          type="button"
          disabled={pending || error !== null || values.name.trim() === ''}
          onClick={() => onMetadata({ ...values, name: values.name.trim() })}
        >
          Сохранить локальные имя, описание или арт
        </button>
      ) : null}
    </section>
  );
}
export interface PostSaveFieldsProps {
  readonly formId: string;
  readonly projection: JsonObject;
  readonly availableActionKeys: readonly ActionKey[];
  readonly onMetadata: (values: PostSaveMetadata) => void;
  readonly onVariant: () => void;
  readonly onExport: () => void;
  readonly onSelectLibrary: (id: string) => void;
}
function libraryLifecycleLabel(row: JsonObject): string {
  return row['lifecycleState'] === 'FINAL'
    ? 'финальный лист'
    : row['lifecycleState'] === 'VARIANT'
      ? 'новый вариант'
      : 'черновик';
}
function libraryButtonLabel(row: JsonObject, entries: readonly JsonObject[]): string {
  const name = text(row['name']) || 'Без имени';
  const matching = entries.filter((entry) => (text(entry['name']) || 'Без имени') === name);
  if (matching.length === 1) return `Открыть: ${name}`;
  const id = text(row['localCharacterId']);
  let suffixLength = 8;
  while (
    suffixLength < id.length &&
    matching.some(
      (entry) =>
        text(entry['localCharacterId']) !== id &&
        text(entry['localCharacterId']).slice(-suffixLength) === id.slice(-suffixLength),
    )
  )
    suffixLength += 1;
  // The host publishes only this device's owned rows; UUID prefixes can coincide.
  return `Открыть: ${name} — это устройство, ${libraryLifecycleLabel(row)}, …${id.slice(-suffixLength)}`;
}
export function PostSaveFields({
  formId,
  projection: p,
  availableActionKeys: actions,
  onMetadata,
  onVariant,
  onExport,
  onSelectLibrary,
}: PostSaveFieldsProps): ReactElement | null {
  if (formId === 'APP-004')
    return (
      <section aria-label="Локальные персонажи">
        <h2>Персонажи</h2>
        {rows(p['libraryEntries']).length === 0 ? (
          <p>Библиотека пуста.</p>
        ) : (
          <ul>
            {rows(p['libraryEntries']).map((row) => (
              <li key={text(row['localCharacterId'])}>
                <button
                  type="button"
                  onClick={() => onSelectLibrary(text(row['localCharacterId']))}
                >
                  {libraryButtonLabel(row, rows(p['libraryEntries']))}
                </button>{' '}
                — {libraryLifecycleLabel(row)}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  if (formId === 'CHR-026' || formId === 'APP-009')
    return (
      <section aria-label="Проверенный checkpoint">
        <p>
          {p['resumeFormId'] === null
            ? 'Целая версия не подтверждена. Восстановление недоступно.'
            : `Подтверждён checkpoint версии ${text(p[formId === 'CHR-026' ? 'lastCompleteCheckpointRevision' : 'checkpointRevision'])}.`}
        </p>
        {p['corruptTailIgnored'] === true ? (
          <p>Незавершённый хвост исключён. Полная версия сохранена.</p>
        ) : null}
        <p>
          Сохранённых случайных результатов: {(p['randomReceiptIds'] as readonly string[]).length}.
          Восстановление не выполняет новые броски.
        </p>
        <details>
          <summary>Сведения о checkpoint</summary>
          <p>
            Персонаж: {text(p['sourceEntityId'])}. Checkpoint:{' '}
            {text(p['lastCompleteCheckpointId']) || 'Не подтверждён'}.
          </p>
          <p>Подписанный шаг продолжения: {text(p['resumeFormId']) || 'Недоступен'}.</p>
          <p>
            Хеш кэша:{' '}
            {text(p[formId === 'CHR-026' ? 'branchCacheHash' : 'branchCacheHashOrNull']) ||
              'Не подтверждён'}
            .
          </p>
          <p>Квитанции: {(p['randomReceiptIds'] as readonly string[]).join(', ') || 'Нет'}.</p>
        </details>
      </section>
    );
  if (formId === 'CHR-039')
    return (
      <section aria-label="Неизменяемые версии веток">
        <p>
          {p['cacheIntegrityStatus'] === 'VALID'
            ? 'Целостность кэша подтверждена.'
            : 'Кэш повреждён и не может быть источником состояния.'}
        </p>
        <table>
          <thead>
            <tr>
              <th>Ветка</th>
              <th>UUID</th>
              <th>Хеш содержимого</th>
              <th>Сохранена на ревизии</th>
              <th>Случайные результаты</th>
            </tr>
          </thead>
          <tbody>
            {rows(p['branchCacheEntries']).map((row) => (
              <tr key={text(row['branchUuid'])}>
                <td>
                  {
                    (
                      { RACE: 'Раса', CLASS: 'Класс', SYMBIONT: 'Симбионты' } as Record<
                        string,
                        string
                      >
                    )[text(row['branchKind'])]
                  }
                </td>
                <td>{text(row['branchUuid'])}</td>
                <td>{text(row['payloadHash'])}</td>
                <td>{text(row['savedAtRevision'])}</td>
                <td>{(row['randomReceiptIds'] as readonly string[]).join(', ') || 'Нет'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Выбранная сохранённая ветка: {text(p['selectedBranchUuidOrNull']) || 'Нет'}; ревизия
          черновика: {text(p['draftRevision'])}.
        </p>
      </section>
    );
  if (formId === 'CHR-040')
    return (
      <>
        <MetadataFields
          key={`${text(p['localCharacterUuid'])}:${text(p['localMetadataRevision'])}`}
          projection={p}
          enabled={actions.includes('CHR-040::CTA::004')}
          onMetadata={onMetadata}
        />
        <FinalMechanics value={object(p['mechanicsSnapshot'])} />
        <section aria-label="История бросков создания">
          <h2>Сохранённые броски</h2>
          <ul>
            {rows(p['creationRandomReceipts']).map((r, i) => (
              <li key={i}>
                {rollLabels[text(r['kind'])]} — d20: {(r['faces'] as readonly number[]).join(', ')}{' '}
                ({r['diceInputMode'] === 'AUTO' ? 'автоматический' : 'ручной ввод'}).
                <details>
                  <summary>Квитанция результата</summary>
                  <p>
                    {text(r['rollReceiptId'])}; запрос {text(r['rollRequestId'])}.
                  </p>
                </details>
              </li>
            ))}
          </ul>
        </section>
        <p>
          Кандидатских снимков: {(p['candidateSnapshotIds'] as readonly string[]).length}; копий в
          кампаниях: {(p['campaignCopyIds'] as readonly string[]).length}.
        </p>
        <SavedVersionFacts projection={p} />
      </>
    );
  if (formId === 'APP-010')
    return (
      <section aria-label="Вариант и экспорт">
        <h2>{text(object(p['metadata'])['name'])}</h2>
        <p>
          {p['ownerContext'] === 'PLAYER_LOCAL'
            ? 'Финальный локальный персонаж.'
            : 'Завершённая копия из архива кампании.'}
        </p>
        <p>
          Версия формата: {text(p['schemaVersion'])}; baseline: {text(p['baselineVersion'])}.
        </p>
        <p>Контрольная сумма: {text(p['checksum'])}</p>
        <SavedVersionFacts projection={p} />
        {actions.includes('APP-010::CTA::004') ? (
          <>
            <p>
              Новый вариант копирует только имя, описание и арт. Создание механики начинается
              заново.
            </p>
            <button type="button" onClick={onVariant}>
              Создать вариант с новым UUID
            </button>
          </>
        ) : null}
        {actions.includes('APP-010::CTA::005') ? (
          <button type="button" onClick={onExport}>
            Экспортировать версионированный файл
          </button>
        ) : null}
      </section>
    );
  return null;
}
