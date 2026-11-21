import { useState } from 'react';
import type { ActionKey } from '@generated/types/atlas.js';
import type { OrdinarySeatView } from '@shared/ordinary-seat.js';
import { AtlasForm } from '../../renderer/atlas-form.js';
import { eligibleSeatTargets } from './ordinary-seat-client.js';
import type { ProjectionConnection } from '../../ws-client.js';

interface Props {
  readonly formId: string;
  readonly view: OrdinarySeatView;
  readonly actions: readonly ActionKey[];
  readonly enabled: boolean;
  readonly getConnection: () => ProjectionConnection | null;
}

export function OrdinarySeatPanel({ formId, view, actions, enabled, getConnection }: Props) {
  const [choice, setChoice] = useState('');
  const [selected, setSelected] = useState<readonly string[]>(() =>
    view.ordinarySeatView === 'LIBRARY' ? view.selectedSourceUuids : [],
  );
  const [notice, setNotice] = useState<string | null>(null);
  if (view.ordinarySeatView === 'ACTIVE')
    return (
      <section data-atlas-form-id="PLY-029" aria-label="Активное место">
        <p role="status">Активное место: игрок {view.ordinal}.</p>
      </section>
    );
  if (
    view.ordinarySeatView === 'ROSTER' &&
    view.roster.length === 1 &&
    view.activeSeatIdOrNull === view.roster[0]?.seatId &&
    actions.length === 0
  )
    return (
      <section data-atlas-form-id="PLY-027" aria-label="Допущенные места">
        <p>Ваше место: игрок {view.roster[0].ordinal}.</p>
      </section>
    );
  const selectable = view.ordinarySeatView === 'ROSTER' ? eligibleSeatTargets(view) : [];
  const allowed = actions.filter(
    (key) => key !== 'PLY-027::CTA::003' || selectable.some((s) => s.seatId === choice),
  );
  return (
    <fieldset disabled={!enabled}>
      <AtlasForm
        playerContentOnly
        formId={formId}
        availableActionKeys={allowed}
        projectionContent={
          <>
            {view.ordinarySeatView === 'WAITING' ? <p>Ожидание передачи устройства.</p> : null}
            {view.ordinarySeatView === 'SETUP' ? (
              <p>Выбрано персонажей: {view.selectedCount}.</p>
            ) : null}
            {view.ordinarySeatView === 'LIBRARY' ? (
              <fieldset>
                <legend>Персонажи для подключения</legend>
                {view.candidates.length === 0 ? (
                  <p>В библиотеке нет доступных завершённых персонажей.</p>
                ) : (
                  view.candidates.map((candidate) => {
                    const checked = selected.includes(candidate.sourceUuid);
                    return (
                      <label key={candidate.sourceUuid}>
                        <input
                          type="checkbox"
                          value={candidate.sourceUuid}
                          checked={checked}
                          disabled={
                            !actions.includes('APP-004::CTA::002') ||
                            (!checked && selected.length >= 3)
                          }
                          onChange={(e) => {
                            const next = e.target.checked;
                            setSelected((prev) =>
                              next
                                ? [...prev, candidate.sourceUuid]
                                : prev.filter((id) => id !== candidate.sourceUuid),
                            );
                          }}
                        />
                        {candidate.name}
                      </label>
                    );
                  })
                )}
              </fieldset>
            ) : null}
            {view.ordinarySeatView === 'ROSTER' ? (
              <>
                {view.roster.length === 0 ? (
                  <p>На этом устройстве пока нет допущенных игроков.</p>
                ) : (
                  <ul aria-label="Допущенные места">
                    {view.roster.map((s) => (
                      <li key={s.seatId}>
                        Игрок {s.ordinal}
                        {s.seatId === view.activeSeatIdOrNull ? ' — активное место' : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {actions.includes('PLY-027::CTA::003') && selectable.length > 0 ? (
                  <label>
                    Место для передачи
                    <select
                      value={choice}
                      onChange={(e) => {
                        setChoice(e.target.value);
                        setNotice(null);
                      }}
                    >
                      <option value="">Выберите место</option>
                      {selectable.map((s) => (
                        <option key={s.seatId} value={s.seatId}>
                          Игрок {s.ordinal}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            ) : null}
            {view.ordinarySeatView === 'CURTAIN' ? (
              <p>
                Передайте устройство игроку {view.targetOrdinal}. Получив устройство, подтвердите
                передачу.
              </p>
            ) : null}
            {notice === null ? null : <p role="alert">{notice}</p>}
          </>
        }
        onAction={({ actionKey }) => {
          const connection = getConnection();
          const result =
            actionKey === 'PLY-027::CTA::003'
              ? connection?.selectOrdinarySeat(choice)
              : actionKey === 'APP-004::CTA::002' &&
                  view.ordinarySeatView === 'LIBRARY' &&
                  selected.length > 0
                ? connection?.returnOrdinaryLibrary(selected)
                : connection?.requestFormAction(actionKey);
          setNotice(result?.ok ? null : 'Действие недоступно. Проверьте связь с хостом.');
        }}
      />
    </fieldset>
  );
}
