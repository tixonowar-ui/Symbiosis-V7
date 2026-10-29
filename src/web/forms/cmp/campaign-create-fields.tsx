import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { JsonObject } from '@shared/index.js';
import type {
  CampaignDraftRefusal,
  CampaignMetadataValues,
  CampaignHostValues,
} from '@shared/campaign-creation.js';
import { CHARACTER_ART_ACCEPT, characterArtFromFile } from '../../character-art.js';
import { CampaignQr } from './campaign-qr.js';
import {
  campaignEditFromProjection,
  isCampaignCreationForm,
  isCampaignEditableForm,
  validCampaignSecret,
  type CampaignEdit,
} from './campaign-create.js';

export interface CampaignDraftClientState {
  readonly values: Exclude<CampaignEdit, { readonly variant: 'SECRET' }> | null;
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly lastRefusal: CampaignDraftRefusal | null;
  readonly secretClearSequence: number;
}
const string = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const object = (v: unknown) => v as JsonObject;
const fieldLabels = {
  title: 'Название',
  description: 'Описание',
  art: 'Изображение',
  activePlayerCapacity: 'Вместимость',
  hostAddress: 'Адрес хоста',
  hostPort: 'Порт',
  networkInterface: 'Сетевой интерфейс',
  masterTransferPassword: 'Секрет передачи мастера',
  masterTransferPasswordConfirmation: 'Подтверждение секрета',
  defaultFutureRollMode: 'Режим будущих бросков',
} as const;
const reasonLabels = {
  REQUIRED: 'заполните поле',
  INVALID_TYPE: 'неверный тип значения',
  INVALID_VALUE: 'проверьте значение',
  INVALID_LENGTH: 'недопустимая длина',
  DISALLOWED_CHARACTERS: 'есть недопустимые символы',
  CONFIRMATION_MISMATCH: 'подтверждение не совпадает',
  UNSUPPORTED_INTERFACE: 'интерфейс недоступен на хосте',
  INVALID_IMAGE: 'требуется корректный PNG или JPEG до 12 МБ',
} as const;
function DraftStatus({ state }: { readonly state: CampaignDraftClientState | null }) {
  if (state?.lastRefusal) {
    const refusal = state.lastRefusal;
    return (
      <p role="alert">
        {refusal.code === 'INVALID_FIELD'
          ? `${fieldLabels[refusal.error.field]}: ${reasonLabels[refusal.error.reason]}.`
          : 'Изменение не сохранено. Переподключитесь, чтобы получить подтверждённый черновик.'}
      </p>
    );
  }
  return (
    <p role="status">
      {state?.pending
        ? 'Сохранение черновика…'
        : state?.dirty
          ? 'Ввод ещё не подтверждён хостом.'
          : 'Показан сохранённый черновик.'}
    </p>
  );
}

function CampaignMetadataFields({
  values,
  onChange,
  onBusy,
}: {
  readonly values: CampaignMetadataValues;
  readonly onChange: (value: CampaignEdit) => void;
  readonly onBusy: (pending: boolean) => void;
}) {
  const [reading, setReading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <fieldset disabled={reading}>
      <legend>Основные данные кампании</legend>
      <label>
        Название кампании
        <input
          aria-label="Название кампании"
          value={values.title ?? ''}
          onChange={(e) =>
            onChange({
              variant: 'METADATA',
              values: {
                ...values,
                title: e.currentTarget.value === '' ? null : e.currentTarget.value,
              },
            })
          }
        />
      </label>
      <label>
        Описание кампании
        <textarea
          aria-label="Описание кампании"
          value={values.description ?? ''}
          onChange={(e) =>
            onChange({
              variant: 'METADATA',
              values: {
                ...values,
                description: e.currentTarget.value === '' ? null : e.currentTarget.value,
              },
            })
          }
        />
      </label>
      <label>
        Изображение кампании
        <input
          type="file"
          aria-label="Изображение кампании PNG или JPEG"
          accept={CHARACTER_ART_ACCEPT}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (!file) return;
            setReading(true);
            setError(null);
            onBusy(true);
            void characterArtFromFile(file)
              .then((result) => {
                if (!mounted.current) return;
                if (result.ok)
                  onChange({ variant: 'METADATA', values: { ...values, art: result.value } });
                else
                  setError(
                    result.reason === 'FILE_TOO_LARGE'
                      ? 'Изображение превышает 12 МБ.'
                      : 'Выберите корректный PNG или JPEG.',
                  );
              })
              .catch(() => {
                if (mounted.current) setError('Не удалось прочитать изображение.');
              })
              .finally(() => {
                if (mounted.current) {
                  setReading(false);
                  onBusy(false);
                }
              });
          }}
        />
      </label>
      {values.art ? (
        <>
          <img
            alt="Изображение кампании"
            src={`data:${values.art.mediaType};base64,${values.art.bytesBase64}`}
            style={{ maxWidth: '240px', maxHeight: '200px' }}
          />
          <button
            type="button"
            onClick={() => onChange({ variant: 'METADATA', values: { ...values, art: null } })}
          >
            Удалить изображение кампании
          </button>
        </>
      ) : (
        <p>Изображение не выбрано.</p>
      )}
      {reading ? <p role="status">Чтение изображения…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  );
}

function CampaignSecretFields({
  configured,
  pending,
  onChange,
}: {
  readonly configured: boolean;
  readonly pending: boolean;
  readonly onChange: (value: CampaignEdit) => void;
}) {
  const [secret, setSecret] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const dirty = secret !== '' || confirmation !== '';
  const replace = (nextSecret: string, nextConfirmation: string) => {
    setSecret(nextSecret);
    setConfirmation(nextConfirmation);
    onChange({
      variant: 'SECRET',
      values: {
        masterTransferPassword: nextSecret,
        masterTransferPasswordConfirmation: nextConfirmation,
      },
    });
  };
  return (
    <fieldset disabled={pending} aria-label="Настройка секрета передачи мастера">
      <p>
        {configured
          ? 'Секрет задан. Для продолжения повторный ввод не требуется. Для замены введите новый секрет дважды.'
          : 'Задайте отдельный секрет передачи мастера.'}
      </p>
      <p>
        От 12 до 128 символов без управляющих символов. Это не пароль подключения игрока. После
        сохранения введённые значения очищаются.
      </p>
      <label>
        Секрет передачи мастера
        <input
          type="password"
          autoComplete="new-password"
          aria-label="Секрет передачи мастера"
          value={secret}
          onChange={(e) => replace(e.currentTarget.value, confirmation)}
        />
      </label>
      <label>
        Подтверждение секрета
        <input
          type="password"
          autoComplete="new-password"
          aria-label="Подтверждение секрета"
          value={confirmation}
          onChange={(e) => replace(secret, e.currentTarget.value)}
        />
      </label>
      {dirty && !validCampaignSecret(secret, confirmation) ? (
        <p role="status">Введите одинаковые допустимые значения в оба поля.</p>
      ) : null}
    </fieldset>
  );
}

function HostSummary({ value }: { readonly value: JsonObject }) {
  return (
    <dl>
      <dt>Вместимость активных персонажей</dt>
      <dd>{string(value['activePlayerCapacity'])}</dd>
      <dt>Адрес хоста</dt>
      <dd>{string(value['hostAddress'])}</dd>
      <dt>Порт</dt>
      <dd>{string(value['hostPort'])}</dd>
      <dt>Сетевой интерфейс</dt>
      <dd>{string(value['networkInterface'])}</dd>
    </dl>
  );
}

export function CampaignCreationFields({
  formId,
  projection: p,
  state,
  onChange,
  onBusy,
}: {
  readonly formId: string;
  readonly projection: JsonObject;
  readonly state: CampaignDraftClientState | null;
  readonly onChange: (value: CampaignEdit) => void;
  readonly onBusy: (pending: boolean) => void;
}): ReactElement | null {
  if (!isCampaignCreationForm(formId)) return null;
  const edit =
    state?.values ??
    (isCampaignEditableForm(formId) ? campaignEditFromProjection(formId, p) : null);
  let content: ReactElement;
  switch (formId) {
    case 'APP-011': {
      const library = object(p['campaignLibraryState']);
      return (
        <section aria-label="Кампании этого хоста">
          <p>Подтверждён локальный контекст мастера.</p>
          <p>
            Черновики: {string(library['draftCount'])}. Созданные кампании на паузе:{' '}
            {string(library['pausedCampaignCount'])}.
          </p>
        </section>
      );
    }
    case 'CMP-001': {
      if (edit?.variant !== 'METADATA')
        throw new Error('Campaign metadata fields lack their confirmed draft');
      content = <CampaignMetadataFields values={edit.values} onChange={onChange} onBusy={onBusy} />;
      break;
    }
    case 'CMP-002': {
      if (edit?.variant !== 'HOST')
        throw new Error('Campaign host fields lack their confirmed draft');
      const values = edit.values,
        interfaces = p['availableNetworkInterfaces'] as JsonObject[];
      const replace = (
        patch: Partial<
          Pick<
            CampaignHostValues,
            'activePlayerCapacity' | 'hostAddress' | 'hostPort' | 'networkInterface'
          >
        >,
      ) => onChange({ variant: 'HOST', values: { ...values, ...patch } });
      const selected = interfaces.findIndex(
        (entry) =>
          entry['networkInterface'] === values.networkInterface &&
          entry['hostAddress'] === values.hostAddress,
      );
      content = (
        <section aria-label="Вместимость и хост">
          <p>
            Вместимость — максимум одновременно активных персонажей. Кампанию можно создать при нуле
            персонажей.
          </p>
          <label>
            Вместимость активных персонажей
            <input
              type="number"
              min={1}
              max={5}
              step={1}
              aria-label="Вместимость активных персонажей"
              value={values.activePlayerCapacity ?? ''}
              onChange={(e) =>
                replace({
                  activePlayerCapacity:
                    e.currentTarget.value === '' ? null : Number(e.currentTarget.value),
                })
              }
            />
          </label>
          <label>
            Сетевой интерфейс
            <select
              aria-label="Сетевой интерфейс"
              value={selected < 0 ? '' : String(selected)}
              onChange={(e) => {
                const entry = interfaces[Number(e.currentTarget.value)];
                if (e.currentTarget.value === '' || !entry)
                  replace({ networkInterface: null, hostAddress: null });
                else
                  replace({
                    networkInterface: entry['networkInterface'] as string,
                    hostAddress: entry['hostAddress'] as string,
                  });
              }}
            >
              <option value="">Выберите интерфейс</option>
              {interfaces.map((entry, index) => (
                <option
                  key={`${string(entry['networkInterface'])}:${string(entry['hostAddress'])}`}
                  value={String(index)}
                >
                  {string(entry['networkInterface'])}: {string(entry['hostAddress'])} (
                  {string(entry['family'])})
                </option>
              ))}
            </select>
          </label>
          <p>Адрес хоста: {values.hostAddress ?? 'не выбран'}.</p>
          <label>
            Порт хоста
            <input
              type="number"
              min={1}
              max={65535}
              step={1}
              aria-label="Порт хоста"
              value={values.hostPort ?? ''}
              onChange={(e) =>
                replace({
                  hostPort: e.currentTarget.value === '' ? null : Number(e.currentTarget.value),
                })
              }
            />
          </label>
          <p>Отдельного пароля игрока нет.</p>
        </section>
      );
      break;
    }
    case 'CMP-003':
      content = (
        <CampaignSecretFields
          key={state?.secretClearSequence ?? 0}
          configured={p['masterSecretConfigured'] === true}
          pending={state?.pending === true}
          onChange={onChange}
        />
      );
      break;
    case 'CMP-004': {
      if (edit?.variant !== 'MODE')
        throw new Error('Campaign mode fields lack their confirmed draft');
      content = (
        <section aria-label="Настройки будущих бросков">
          <label>
            Режим будущих бросков
            <select
              aria-label="Режим будущих бросков"
              value={edit.values.defaultFutureRollMode ?? ''}
              onChange={(e) =>
                onChange({
                  variant: 'MODE',
                  values: {
                    defaultFutureRollMode:
                      e.currentTarget.value === ''
                        ? null
                        : (e.currentTarget.value as 'MANUAL' | 'AUTO'),
                  },
                })
              }
            >
              <option value="">Выберите режим</option>
              <option value="MANUAL">Физические кости: ручной ввод</option>
              <option value="AUTO">Виртуальные кости: автоматический бросок</option>
            </select>
          </label>
          <p>
            Режим действует только на новые запросы бросков. Открытые запросы и сохранённые
            результаты не меняются. Правила игры остаются прежними.
          </p>
        </section>
      );
      break;
    }
    case 'CMP-005': {
      const summary = object(p['fullDraftSummary']),
        metadata = object(summary['metadata']),
        catalog = object(p['catalogCompatibility']),
        bind = object(p['hostBindPreflight']);
      const art = metadata['art'] as CampaignMetadataValues['art'];
      return (
        <section aria-label="Итоговая проверка кампании">
          <h2>{string(metadata['title'])}</h2>
          <p>{string(metadata['description'])}</p>
          <p>Изображение: {metadata['art'] === null ? 'не выбрано' : 'сохранено'}.</p>
          {art === null ? null : (
            <img
              alt="Изображение кампании перед созданием"
              src={`data:${art.mediaType};base64,${art.bytesBase64}`}
              style={{ maxWidth: '240px', maxHeight: '200px' }}
            />
          )}
          <HostSummary value={object(summary['host'])} />
          <p>
            Секрет передачи мастера: {summary['masterSecretConfigured'] ? 'задан' : 'не задан'}.
          </p>
          <p>
            Будущие броски:{' '}
            {summary['defaultFutureRollMode'] === 'MANUAL'
              ? 'ручной ввод физических костей'
              : summary['defaultFutureRollMode'] === 'AUTO'
                ? 'автоматические виртуальные кости'
                : 'режим не выбран'}
            .
          </p>
          <p>Активных персонажей: 0. Создание разрешено при пустом составе.</p>
          <p>
            Версия baseline: {string(p['baselineVersion'])}. Каталоги:{' '}
            {catalog['status'] === 'PASS' ? 'совместимы' : 'несовместимы'}.
          </p>
          <p>
            Registry: {string(catalog['registryVersion'])}; catalog:{' '}
            {string(catalog['catalogVersion'])}; tuple: {string(catalog['builtAgainstTuple'])}.
          </p>
          <p>
            Проверка адреса и порта:{' '}
            {bind['status'] === 'PASS'
              ? 'порт зарезервирован'
              : bind['reasonCode'] === 'PORT_UNAVAILABLE'
                ? 'порт занят'
                : bind['reasonCode'] === 'INVALID_INTERFACE'
                  ? 'интерфейс недоступен'
                  : bind['reasonCode'] === 'LEASE_EXPIRED'
                    ? 'резервирование истекло'
                    : bind['status'] === 'NOT_CHECKED'
                      ? 'ещё не выполнена'
                      : 'не удалось зарезервировать адрес'}
            .
          </p>
          <p role="status">
            {p['validationStatus'] === 'READY_TO_CREATE'
              ? 'Кампания готова к созданию в состоянии «Пауза».'
              : 'Создание недоступно. Вернитесь к настройкам и устраните указанные ошибки.'}
          </p>
        </section>
      );
    }
    case 'CMP-006':
      return (
        <section aria-label="Созданная кампания">
          <p>Кампания создана. Состояние: пауза. Игровая сессия ещё не запущена.</p>
          <HostSummary value={p} />
          <p>Кампания: {string(p['campaignId'])}.</p>
          <p>Создана: {string(p['createdAt'])}.</p>
          <p>Подтверждение: {string(p['creationReceiptId'])}.</p>
          <p>Адрес подключения: {string(p['qrPayload'])}</p>
          <CampaignQr value={p['qrPayload'] as string} />
          {object(p['hostBindRecovery'])['status'] === 'UNAVAILABLE' ? (
            <p role="alert">
              Сохранённый адрес сейчас недоступен. Кампания остаётся на паузе; адрес и подтверждение
              сохранены.
            </p>
          ) : null}
          <p>QR содержит публичный адрес кампании и сам по себе не предоставляет доступ.</p>
        </section>
      );
  }
  return (
    <>
      <DraftStatus state={state} />
      {content}
    </>
  );
}
