import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { PublicCandidateRef, PublicFinalCandidateSummary } from '@shared/device-admission.js';
import type { CapacityForecast } from '@shared/device-admission.js';
import type {
  Chr027Projection,
  Net001Projection,
  Net002Projection,
  Net003Projection,
  Net004Projection,
  Net005Projection,
  Net011Projection,
  NetworkDraftRefusal,
} from '@shared/network-application.js';
import { isNetworkApplicationProjection } from '@shared/network-application-codec.js';
import {
  isNetworkApplicationForm,
  isNetworkEditableForm,
  networkEditFromProjection,
  type NetworkEdit,
} from './network-application.js';
import { NetworkQrError, readNetworkQrFile } from './network-qr.js';

export interface NetworkDraftClientState {
  readonly values: NetworkEdit | null;
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly lastRefusal: NetworkDraftRefusal | null;
}
export interface NetworkFieldsProps {
  readonly formId: string;
  readonly projection: JsonObject;
  readonly state: NetworkDraftClientState | null;
  readonly onChange: (edit: NetworkEdit) => void;
  readonly cancelReason: string;
  readonly onCancelReasonChange: (value: string) => void;
  readonly onBusy: (busy: boolean) => void;
  readonly qrScanSequence?: number;
}
const candidateRef = (p: PublicFinalCandidateSummary): PublicCandidateRef => ({
  sourceUuid: p.sourceUuid,
  finalSnapshotVersion: p.finalSnapshotVersion,
  metadataRevision: p.metadataRevision,
  candidateSnapshotChecksum: p.candidateSnapshotChecksum,
  requestedControllerSeat: p.requestedControllerSeat,
});
function DraftStatus({ state }: { readonly state: NetworkDraftClientState | null }) {
  return state?.lastRefusal ? (
    <p role="alert">
      Изменение не сохранено. Получите подтверждённое состояние перед продолжением.
    </p>
  ) : (
    <p role="status">
      {state?.pending
        ? 'Сохранение выбора…'
        : state?.dirty
          ? 'Ввод ещё не подтверждён.'
          : 'Показан сохранённый выбор.'}
    </p>
  );
}
function Capacity({ value }: { readonly value: CapacityForecast }) {
  return (
    <p>
      Подтверждённый прогноз: активных персонажей {value.activePcCount} из{' '}
      {value.activePlayerCapacity}; в выборе {value.selectedCandidateCount}.{' '}
      {value.fitsCurrentCapacity
        ? 'Выбор помещается в текущую вместимость.'
        : 'Выбор превышает текущую вместимость.'}{' '}
      Заявка не резервирует место в кампании.
    </p>
  );
}
function Batch({ entries }: { readonly entries: readonly PublicFinalCandidateSummary[] }) {
  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.sourceUuid}>
          {entry.name} — локальный персонаж {entry.sourceUuid.slice(-8)}, финальная версия{' '}
          {entry.finalSnapshotVersion}, метаданные {entry.metadataRevision}.
        </li>
      ))}
    </ul>
  );
}
function QrPicker({
  sequence,
  onDecoded,
  onBusy,
}: {
  readonly sequence: number;
  readonly onDecoded: (value: string) => void;
  readonly onBusy: (value: boolean) => void;
}) {
  const picker = useRef<HTMLInputElement>(null),
    seen = useRef(sequence),
    generation = useRef(0);
  const busy = useRef(false),
    callback = useRef(onBusy);
  const [reading, setReading] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    callback.current = onBusy;
  }, [onBusy]);
  useEffect(() => {
    if (seen.current !== sequence) {
      seen.current = sequence;
      picker.current?.click();
    }
  }, [sequence]);
  useEffect(
    () => () => {
      generation.current += 1;
      if (busy.current) {
        busy.current = false;
        callback.current(false);
      }
    },
    [],
  );
  return (
    <>
      <input
        ref={picker}
        aria-label="Изображение QR"
        type="file"
        accept="image/png,image/jpeg"
        hidden
        disabled={reading}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          const token = ++generation.current;
          setError(null);
          setReading(true);
          busy.current = true;
          onBusy(true);
          void readNetworkQrFile(file)
            .then((value) => {
              if (token === generation.current) onDecoded(value);
            })
            .catch((reason: unknown) => {
              if (token !== generation.current) return;
              setError(
                reason instanceof NetworkQrError && reason.code === 'QR_NOT_FOUND'
                  ? 'QR не найден. Выберите чёткое изображение или введите адрес вручную.'
                  : reason instanceof NetworkQrError && reason.code === 'IMAGE_TOO_LARGE'
                    ? 'Изображение слишком большое. Используйте PNG или JPEG до 12 МБ и 4096 пикселей по стороне.'
                    : 'Не удалось прочитать PNG или JPEG. Выберите другое изображение или введите адрес вручную.',
              );
            })
            .finally(() => {
              if (token === generation.current) {
                setReading(false);
                busy.current = false;
                callback.current(false);
              }
            });
        }}
      />
      {reading ? <p role="status">Чтение QR на этом устройстве…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

/** Inputs supplement the Atlas renderer; all workflow/navigation buttons remain Atlas actions. */
export function NetworkFields({
  formId,
  projection,
  state,
  onChange,
  cancelReason,
  onCancelReasonChange,
  onBusy,
  qrScanSequence = 0,
}: NetworkFieldsProps): ReactElement | null {
  if (!isNetworkApplicationForm(formId)) return null;
  if (!isNetworkApplicationProjection(formId, projection))
    throw new Error('Invalid confirmed network projection');
  const edit =
    state?.values ??
    (isNetworkEditableForm(formId) ? networkEditFromProjection(formId, projection) : null);
  const disabled = projection.pendingCommandIdOrNull !== null;
  let content: ReactElement;
  switch (formId) {
    case 'NET-001': {
      const p = projection as Net001Projection;
      content = (
        <section aria-label="Кампании в локальной сети">
          {p.discoveryState === 'SEARCHING' ? <p role="status">Поиск кампаний…</p> : null}
          {p.discoveryState === 'UNAVAILABLE' ? (
            <p role="alert">Поиск недоступен. Можно ввести адрес или QR вручную.</p>
          ) : null}
          {p.discoveredHosts.length === 0 ? (
            <p>Кампании пока не найдены. Откройте ввод адреса или QR.</p>
          ) : (
            <ul>
              {p.discoveredHosts.map((host) => (
                <li key={host.campaignId}>
                  {host.title} —{' '}
                  {host.locator.hostAddress.includes(':')
                    ? `[${host.locator.hostAddress}]`
                    : host.locator.hostAddress}
                  :{host.locator.hostPort}. Активных персонажей: {host.activePcCount} из{' '}
                  {host.activePlayerCapacity}.{' '}
                  {host.compatibility === 'COMPATIBLE'
                    ? 'Совместимая версия.'
                    : 'Версии несовместимы.'}
                </li>
              ))}
            </ul>
          )}
          {p.discoveryTruncated ? (
            <p>Показаны не все найденные кампании. Уточните адрес или QR.</p>
          ) : null}
          <p>Адрес и QR указывают кампанию. Отдельного пароля игрока нет.</p>
        </section>
      );
      break;
    }
    case 'NET-002': {
      const p = projection as Net002Projection;
      if (edit?.variant !== 'ADDRESS') throw new Error('Network address lacks its confirmed draft');
      content = (
        <section aria-label="Адрес или QR кампании">
          <label>
            Адрес или содержимое QR
            <input
              aria-label="Адрес или содержимое QR"
              value={edit.values.addressOrQrPayload}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  variant: 'ADDRESS',
                  values: { addressOrQrPayload: e.currentTarget.value },
                })
              }
            />
          </label>
          <QrPicker
            sequence={qrScanSequence}
            onBusy={onBusy}
            onDecoded={(value) =>
              onChange({ variant: 'ADDRESS', values: { addressOrQrPayload: value } })
            }
          />
          {p.parseDiagnostic !== null ? (
            <p role={p.parseStatus === 'INVALID' ? 'alert' : 'status'}>{p.parseDiagnostic}</p>
          ) : null}
          {p.parseStatus === 'VALID' ? (
            <p>
              Распознан адрес: {p.parsedHost}, порт {p.parsedPort}. Подключение требует отдельного
              подтверждения.
            </p>
          ) : null}
          {p.connectionState === 'CONNECTED_TECHNICAL' ? (
            <p role="status">
              Техническое соединение подтверждено. Допуск в кампанию ещё не предоставлен.
            </p>
          ) : null}
        </section>
      );
      break;
    }
    case 'NET-003': {
      const p = projection as Net003Projection;
      if (edit?.variant !== 'SELECTION')
        throw new Error('Network selection lacks its confirmed draft');
      const selected = edit.values.selectedCandidates;
      content = (
        <section aria-label="Выбор финальных локальных персонажей">
          <p>Выберите от одного до трёх финальных персонажей этого устройства.</p>
          {p.eligibleFinalCandidates.length === 0 ? (
            <p>Подходящих финальных листов нет. Сначала завершите локальное создание персонажа.</p>
          ) : null}
          <fieldset disabled={disabled}>
            <legend>Финальные персонажи этого устройства</legend>
            {p.eligibleFinalCandidates.map((entry) => {
              const checked = selected.some((value) => value.sourceUuid === entry.sourceUuid);
              return (
                <label key={entry.sourceUuid}>
                  <input
                    type="checkbox"
                    aria-label={`Выбрать ${entry.name} (${entry.sourceUuid.slice(-8)})`}
                    checked={checked}
                    disabled={!checked && selected.length >= 3}
                    onChange={(event) =>
                      onChange({
                        variant: 'SELECTION',
                        values: {
                          selectedCandidates: event.currentTarget.checked
                            ? [...selected, candidateRef(entry)]
                            : selected.filter((value) => value.sourceUuid !== entry.sourceUuid),
                        },
                      })
                    }
                  />
                  {entry.name} — {entry.sourceUuid.slice(-8)}, финальная версия{' '}
                  {entry.finalSnapshotVersion}, метаданные {entry.metadataRevision}.
                </label>
              );
            })}
          </fieldset>
          <Capacity value={p.capacityForecast} />
          <p>
            Этот выбор использует существующее место ввода устройства и пока не даёт управления
            персонажами кампании.
          </p>
        </section>
      );
      break;
    }
    case 'NET-004': {
      const p = projection as Net004Projection;
      content = (
        <section aria-label="Проверка заявки устройства">
          <Batch entries={p.batchCharacterSummaries} />
          <Capacity value={p.capacityForecast} />
          <p>
            Показана сохранённая версия выбранных листов. Изменения локального имени или изображения
            не заменяют её в этой заявке.
          </p>
          <p>Заявка будет отправлена только после явного подтверждения.</p>
        </section>
      );
      break;
    }
    case 'NET-005': {
      const p = projection as Net005Projection;
      content = (
        <section aria-label="Состояние заявки устройства">
          <Batch entries={p.batchCharacterSummaries} />
          <p role="status">
            {p.requestStatus === 'PENDING'
              ? 'Заявка ожидает решения мастера.'
              : p.requestStatus === 'REJECTED'
                ? 'Мастер отклонил заявку.'
                : 'Получено предложение по допуску.'}
          </p>
          {p.gmMessage !== null ? <p>{p.gmMessage}</p> : null}
          {p.requestStatus === 'PENDING' ? (
            <label>
              Причина отмены
              <textarea
                aria-label="Причина отмены"
                value={cancelReason}
                disabled={disabled}
                onChange={(event) => onCancelReasonChange(event.currentTarget.value)}
              />
            </label>
          ) : null}
          <p>Отмена требует отдельного подтверждения и сохраняет исходные локальные листы.</p>
        </section>
      );
      break;
    }
    case 'CHR-027': {
      const p = projection as Chr027Projection;
      if (edit?.variant !== 'SINGLE_CANDIDATE')
        throw new Error('Single-candidate network draft is missing');
      const values = edit.values;
      content = (
        <section aria-label="Отправка сохранённого персонажа">
          <p>
            Локальный персонаж {p.localCharacterUuid.slice(-8)}, финальная версия{' '}
            {p.finalSnapshotVersion}.
          </p>
          {p.eligibleCampaignIds.length === 0 ? (
            <p>
              Нет подтверждённых подходящих соединений с кампанией. Сначала подключитесь через меню
              игрока.
            </p>
          ) : null}
          <fieldset disabled={disabled}>
            <legend>Кампания и место ввода</legend>
            <label>
              Кампания
              <select
                aria-label="Кампания для персонажа"
                value={values.selectedCampaignId ?? ''}
                onChange={(event) =>
                  onChange({
                    variant: 'SINGLE_CANDIDATE',
                    values: { ...values, selectedCampaignId: event.currentTarget.value || null },
                  })
                }
              >
                <option value="">Выберите кампанию</option>
                {p.eligibleCampaignIds.map((id) => (
                  <option key={id} value={id}>
                    Кампания {id.slice(-8)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Место ввода
              <select
                aria-label="Место ввода для персонажа"
                value={values.requestedControllerSeat ?? ''}
                onChange={(event) =>
                  onChange({
                    variant: 'SINGLE_CANDIDATE',
                    values: {
                      ...values,
                      requestedControllerSeat: event.currentTarget.value || null,
                    },
                  })
                }
              >
                <option value="">Выберите место ввода</option>
                <option value={p.controllerSeat}>Место ввода этого устройства</option>
              </select>
            </label>
          </fieldset>
          <p>
            Продолжение подготовит обычную заявку. Лист пока не отправляется и права в кампании не
            создаются.
          </p>
        </section>
      );
      break;
    }
    case 'NET-011': {
      const p = projection as Net011Projection;
      content = (
        <section aria-label="Кампания недоступна">
          <p role="alert">{p.humanDiagnostic}</p>
          <p>Последний адрес: {p.lastAddressOrQrPayload}.</p>
          <p>Повторных попыток: {p.retryCount}.</p>
          {p.campaignIdOrNull !== null &&
          p.pendingCommandIdOrNull === null &&
          p.errorCode !== 'UNCONFIRMED_OUTCOME' ? (
            <p>
              Соединение с этой кампанией уже известно. Обновите страницу, чтобы восстановить его.
            </p>
          ) : null}
          <p>
            Локальные листы сохранены. Неподтверждённая отправка требует сверки с хостом перед новой
            заявкой.
          </p>
        </section>
      );
      break;
    }
  }
  return (
    <>
      <DraftStatus state={state} />
      {content}
    </>
  );
}
