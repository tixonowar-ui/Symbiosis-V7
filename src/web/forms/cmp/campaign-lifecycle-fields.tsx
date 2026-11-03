import { useLayoutEffect, useRef } from 'react';
import type { JsonObject } from '@shared/wire-protocol.js';
import {
  campaignLifecycleGmProjectionValue,
  type CampaignLifecycleForm,
} from '@shared/campaign-lifecycle.js';

export interface CampaignLifecycleEditor {
  readInputs(): Readonly<Record<string, unknown>>;
  clearSecrets(): void;
}

/** Values come from the confirmed host view. Passwords exist only in these uncontrolled inputs. */
export function CampaignLifecycleFields({
  formId,
  projection,
  onEditor,
}: {
  readonly formId: CampaignLifecycleForm;
  readonly projection: JsonObject;
  readonly onEditor?: (editor: CampaignLifecycleEditor | null) => void;
}) {
  const p = campaignLifecycleGmProjectionValue(projection);
  const { hostAddress, hostPort, networkInterface } = p.networkForNextLaunch;
  const fields = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = fields.current;
    if (root === null || onEditor === undefined) return;
    const value = (name: string) => {
      const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        `[name="${name}"]`,
      );
      if (input === null) throw new Error('Missing campaign input: ' + name);
      return input.value;
    };
    const integer = (name: string) =>
      /^\d+$/u.test(value(name)) ? Number(value(name)) : Number.NaN;
    const clearSecrets = () => {
      for (const input of root.querySelectorAll<HTMLInputElement>('input[type="password"]'))
        input.value = '';
    };
    onEditor({
      clearSecrets,
      readInputs: () => {
        switch (formId) {
          case 'CMP-008': {
            const network =
              p.campaignStatus === 'PAUSED'
                ? {
                    hostAddress: value('hostAddress'),
                    hostPort: integer('hostPort'),
                    networkInterface: value('networkInterface'),
                  }
                : { hostAddress, hostPort, networkInterface };
            return {
              title: value('title'),
              descriptionOrNull: value('description') === '' ? null : value('description'),
              defaultFutureRollMode: value('defaultFutureRollMode'),
              network,
            };
          }
          case 'CMP-014':
            return { newCapacity: integer('newCapacity') };
          case 'CMP-015':
            return {
              currentMasterPassword: value('currentMasterPassword'),
              newMasterPassword: value('newMasterPassword'),
              newMasterPasswordConfirmation: value('newMasterPasswordConfirmation'),
            };
          case 'CMP-016':
            return { reason: value('reason') };
          case 'NET-023': {
            const deviceId = value('deviceId');
            const seat = value('controllerSeat');
            return {
              deviceId,
              selectedControllerSeatOrNull: seat === '' ? null : seat,
              reason: value('reason'),
            };
          }
        }
      },
    });
    return () => {
      clearSecrets();
      onEditor(null);
    };
  }, [formId, onEditor, p.campaignStatus, hostAddress, hostPort, networkInterface]);
  const endpoint = (value: typeof p.activeListenerEndpointOrNull) =>
    value === null
      ? 'Хост не слушает подключения'
      : `${value.hostAddress}:${value.hostPort} (${value.networkInterface})`;
  return (
    <div ref={fields} data-campaign-lifecycle={formId}>
      <p>Состояние: {p.campaignStatus === 'PAUSED' ? 'Пауза' : 'Игра идёт'}</p>
      {p.pauseReasonOrNull === null ? null : <p>Причина паузы: {p.pauseReasonOrNull}</p>}
      {!p.safeBoundary ? (
        <p role="status">Дождитесь завершения текущих операций: {p.pendingOperationCount}.</p>
      ) : null}
      {formId === 'CMP-008' ? (
        <>
          <label>
            Название кампании
            <input name="title" defaultValue={p.title} />
          </label>
          <label>
            Описание кампании
            <textarea name="description" defaultValue={p.descriptionOrNull ?? ''} />
          </label>
          <label>
            Режим будущих бросков
            <select name="defaultFutureRollMode" defaultValue={p.defaultFutureRollMode}>
              <option value="MANUAL">Вручную</option>
              <option value="AUTO">Автоматически</option>
            </select>
          </label>
          <p>Сохранённые броски и открытые запросы сохраняют свой режим.</p>
          <p>Действующий адрес: {endpoint(p.activeListenerEndpointOrNull)}</p>
          <p>Сохранённый адрес следующего запуска: {endpoint(p.networkForNextLaunch)}</p>
          <fieldset disabled={p.campaignStatus !== 'PAUSED'}>
            <legend>Сеть следующего запуска</legend>
            <label>
              Адрес хоста
              <input name="hostAddress" defaultValue={p.networkForNextLaunch.hostAddress} />
            </label>
            <label>
              Порт хоста
              <input
                name="hostPort"
                type="number"
                min="1"
                max="65535"
                step="1"
                defaultValue={p.networkForNextLaunch.hostPort}
              />
            </label>
            <label>
              Сетевой интерфейс
              <select
                name="networkInterface"
                defaultValue={p.networkForNextLaunch.networkInterface}
              >
                {[
                  ...new Set([
                    p.networkForNextLaunch.networkInterface,
                    ...p.availableNetworkInterfaces.map((row) => row.networkInterface),
                  ]),
                ].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Доступные адреса:{' '}
              {p.availableNetworkInterfaces.length === 0
                ? 'нет'
                : p.availableNetworkInterfaces
                    .map((row) => `${row.hostAddress} (${row.networkInterface})`)
                    .join(', ')}
            </p>
          </fieldset>
          <p>
            Изменения сети доступны на паузе и применятся при следующем запуске хоста. Для
            переподключения используйте новый адрес и прежний подтверждённый хост.
          </p>
          <p>Арт кампании: {p.campaignArtChecksumOrNull === null ? 'не задан' : 'сохранён'}</p>
          <p>
            Допущено игроков: {p.activePlayerCount} из {p.currentCapacity}.
          </p>
        </>
      ) : formId === 'CMP-014' ? (
        <>
          <p>
            Уменьшение ёмкости не удаляет персонажей. Нижняя граница — число ACTIVE игроков:{' '}
            {p.activePlayerCount}.
          </p>
          <label>
            Ёмкость кампании
            <input
              name="newCapacity"
              type="number"
              min={Math.max(1, p.activePlayerCount)}
              max="5"
              step="1"
              defaultValue={p.currentCapacity}
            />
          </label>
        </>
      ) : formId === 'CMP-015' ? (
        <>
          <label>
            Текущий пароль мастера
            <input name="currentMasterPassword" type="password" autoComplete="off" />
          </label>
          <label>
            Новый пароль мастера
            <input name="newMasterPassword" type="password" autoComplete="new-password" />
          </label>
          <label>
            Повтор нового пароля
            <input
              name="newMasterPasswordConfirmation"
              type="password"
              autoComplete="new-password"
            />
          </label>
          <p>Пароли очищаются при отправке. Если команда не дошла до хоста, введите их снова.</p>
        </>
      ) : formId === 'CMP-016' ? (
        <>
          <p>
            {p.campaignStatus === 'HOSTING' ? 'Пауза' : 'Возобновление'} сохранит текущую мирную
            сцену и остановленные игровые часы.
          </p>
          <label>
            Причина {p.campaignStatus === 'HOSTING' ? 'паузы' : 'возобновления'}
            <textarea name="reason" />
          </label>
          <p>
            Текущее подтверждённое состояние кампании: ревизия{' '}
            {p.checkpointPreview.campaignRevision}.
          </p>
        </>
      ) : (
        <>
          <label>
            Устройство для отключения
            <select name="deviceId" defaultValue="">
              <option value="">Выберите устройство</option>
              {p.devices.map((device) => (
                <option
                  key={device.deviceId}
                  value={device.deviceId}
                  disabled={!device.connected || device.pendingOwnedCommandCount !== 0}
                >
                  {device.controllerSeats.map((seat) => seat.name).join(', ') || device.deviceId} —{' '}
                  {device.connected ? 'подключено' : 'отключено'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Контроллер (необязательно)
            <select name="controllerSeat" defaultValue="">
              <option value="">Всё устройство</option>
              {p.devices.flatMap((device) =>
                device.controllerSeats.map((seat) => (
                  <option key={seat.controllerSeat} value={seat.controllerSeat}>
                    {seat.name}
                  </option>
                )),
              )}
            </select>
          </label>
          <label>
            Причина отключения
            <textarea name="reason" />
          </label>
          <p>
            Отключится всё устройство. Персонажи, назначения и их имущество сохранятся. Игрок сможет
            вручную переподключиться.
          </p>
        </>
      )}
    </div>
  );
}
