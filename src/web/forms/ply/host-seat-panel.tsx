import { useState } from 'react';
import type { ActionKey } from '@generated/types/atlas.js';
import type { HostSeatView, HostSeatProfile, HostSeatRecipient } from '@shared/host-seat.js';
import { AtlasForm } from '../../renderer/atlas-form.js';
import type { App004Projection, ProjectionConnection } from '../../ws-client.js';

const profileName = (p: HostSeatProfile) =>
  p.targetProfileLabel + ' (' + p.targetLocalOwnerId + ')';
const recipientName = (r: HostSeatRecipient) => (r.kind === 'GM' ? 'Мастер' : profileName(r));

export function HostSeatPanel({
  formId,
  view,
  actions,
  enabled,
  getConnection,
}: {
  formId: string;
  view: HostSeatView;
  actions: readonly ActionKey[];
  enabled: boolean;
  getConnection: () => ProjectionConnection | null;
}) {
  const [label, setLabel] = useState('');
  const [id, setId] = useState('');
  const [error, setError] = useState(false);
  const options =
    view.hostSeatView === 'ROSTER'
      ? view.seats.filter((s) => s.localControllerSeatId !== view.activeSeatIdOrNull)
      : [];
  const available = actions.filter((k) =>
    k === 'APP-003::CTA::011'
      ? label.trim().length > 0
      : k === 'APP-003::CTA::012'
        ? view.hostSeatView === 'SETUP' && view.profiles.some((p) => p.targetLocalOwnerId === id)
        : k === 'CMP-009::CTA::004'
          ? view.hostSeatView === 'MANAGE' &&
            view.returnedProfiles?.some((p) => p.targetLocalOwnerId === id)
          : k === 'PLY-028::CTA::003'
            ? options.some((s) => s.localControllerSeatId === id)
            : true,
  );
  return (
    <fieldset disabled={!enabled}>
      <AtlasForm
        playerContentOnly
        formId={formId}
        availableActionKeys={available}
        projectionContent={
          <>
            {view.hostSeatView === 'WAITING' ? <p>Ожидание передачи устройства.</p> : null}
            {view.hostSeatView === 'GM_ONLY' ? (
              <p>На этом компьютере играет только мастер. Допущенных игроков нет.</p>
            ) : null}
            {view.hostSeatView === 'CURTAIN' ? (
              <p>
                Получатель устройства: {recipientName(view.target)}. Получив устройство, подтвердите
                передачу.
              </p>
            ) : null}
            {view.hostSeatView === 'ACTIVE' ? (
              <p role="status">Устройство передано: {recipientName(view.target)}.</p>
            ) : null}
            {view.hostSeatView === 'MANAGE' || view.hostSeatView === 'ROSTER' ? (
              <>
                {view.seats.length === 0 ? (
                  <p>На этом компьютере нет допущенных игроков.</p>
                ) : (
                  <ul aria-label="Допущенные игроки">
                    {view.seats.map((s) => (
                      <li key={s.localControllerSeatId}>
                        Игрок {s.ordinal}: {profileName(s)}
                      </li>
                    ))}
                  </ul>
                )}
                {view.hostSeatView === 'ROSTER' && actions.includes('PLY-028::CTA::003') ? (
                  <label>
                    Место для передачи
                    <select value={id} onChange={(e) => setId(e.target.value)}>
                      <option value="">Выберите место</option>
                      {options.map((s) => (
                        <option key={s.localControllerSeatId} value={s.localControllerSeatId}>
                          Игрок {s.ordinal}: {profileName(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {view.hostSeatView === 'MANAGE' && actions.includes('CMP-009::CTA::004') ? (
                  <label>
                    Профиль для повторной передачи
                    <select value={id} onChange={(e) => setId(e.target.value)}>
                      <option value="">Выберите профиль</option>
                      {view.returnedProfiles?.map((p) => (
                        <option key={p.targetLocalOwnerId} value={p.targetLocalOwnerId}>
                          {profileName(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            ) : null}
            {view.hostSeatView === 'SETUP' ? (
              <>
                {actions.includes('APP-003::CTA::011') ? (
                  <label>
                    Метка нового профиля
                    <input value={label} onChange={(e) => setLabel(e.target.value)} />
                  </label>
                ) : null}
                {actions.includes('APP-003::CTA::012') ? (
                  <label>
                    Существующий профиль
                    <select value={id} onChange={(e) => setId(e.target.value)}>
                      <option value="">Выберите профиль</option>
                      {view.profiles.map((p) => (
                        <option key={p.targetLocalOwnerId} value={p.targetLocalOwnerId}>
                          {profileName(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {view.selectedProfileOrNull ? (
                  <p>Выбран профиль: {profileName(view.selectedProfileOrNull)}.</p>
                ) : null}
              </>
            ) : null}
            {view.hostSeatView === 'ADMISSION' ? (
              <p>
                {profileName(view.profile)}. Выбрано персонажей: {view.selectedSourceUuids.length}.
              </p>
            ) : null}
            {error ? <p role="alert">Действие недоступно. Проверьте соединение с хостом.</p> : null}
          </>
        }
        onAction={({ actionKey }) => {
          const c = getConnection();
          const res =
            actionKey === 'APP-003::CTA::011'
              ? c?.submitHostSeatInput({ kind: 'CREATE_PROFILE', label })
              : actionKey === 'APP-003::CTA::012'
                ? c?.submitHostSeatInput({ kind: 'SELECT_PROFILE', id })
                : actionKey === 'CMP-009::CTA::004'
                  ? c?.submitHostSeatInput({ kind: 'RESUME_PROFILE', id })
                  : actionKey === 'PLY-028::CTA::003'
                    ? c?.submitHostSeatInput({ kind: 'SELECT_SEAT', id })
                    : c?.requestFormAction(actionKey);
          setError(!res?.ok);
        }}
      />
    </fieldset>
  );
}

export function OwnedFinalSelection({
  library,
  enabled,
  onChange,
  selectedSourceUuids,
}: {
  library: App004Projection;
  enabled: boolean;
  selectedSourceUuids: readonly string[];
  onChange: (ids: readonly string[]) => void;
}) {
  const [selection, setSelection] = useState<readonly string[]>(selectedSourceUuids);
  const entries = library.libraryEntries.filter((e) => e.lifecycleState === 'FINAL');
  if (!entries.length) return null;
  return (
    <fieldset disabled={!enabled}>
      <legend>Персонажи для подключения</legend>
      {entries.map((e) => (
        <label key={e.localCharacterId}>
          <input
            type="checkbox"
            checked={selection.includes(e.localCharacterId)}
            disabled={!selection.includes(e.localCharacterId) && selection.length >= 3}
            onChange={(event) => {
              const ids = event.target.checked
                ? [...selection, e.localCharacterId]
                : selection.filter((id) => id !== e.localCharacterId);
              setSelection(ids);
              onChange(ids);
            }}
          />
          {e.name ?? e.localCharacterId}
        </label>
      ))}
    </fieldset>
  );
}
