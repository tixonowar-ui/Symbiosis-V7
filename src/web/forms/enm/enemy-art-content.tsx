import { useLayoutEffect, useRef, useState } from 'react';
import type { EnemyAuthoringProjection } from '@shared/enemy-authoring.js';
import { enemyAttemptArt } from '@shared/enemy-art.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import { CHARACTER_ART_ACCEPT, characterArtFromFile } from '../../character-art.js';

export function EnemyArtContent({
  projection: p,
  enabled,
  onReadPending,
  onEdit,
}: {
  readonly projection: EnemyAuthoringProjection;
  readonly enabled: boolean;
  readonly onReadPending?: (pending: boolean) => void;
  readonly onEdit?: (data: JsonObject) => { readonly ok: boolean; readonly detail?: string };
}) {
  const [error, setError] = useState<string | null>(null);
  const reading = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    return () => {
      reading.current = null;
      onReadPending?.(false);
    };
  }, [enabled, p.contextId, p.formId, p.projectionRevision, onReadPending]);
  const sentient = p.kind === 'SENTIENT_ENEMY_AUTHORING';
  const artKey =
    p.context.attemptOrNull === null
      ? p.context.selectedVersionOrNull?.artAssetKey
      : enemyAttemptArt(p.context.attemptOrNull).assetKey;
  const defaultArt = artKey !== undefined && !artKey.startsWith('enemy-upload:');
  const edit = (data: JsonObject) => {
    const result = onEdit?.(data);
    setError(result?.ok ? null : (result?.detail ?? 'Редактирование портрета недоступно.'));
  };
  return (
    <section aria-label="Портрет шаблона">
      <img
        alt={
          defaultArt
            ? sentient
              ? 'Заглушка мыслящего врага'
              : 'Заглушка произвольного монстра'
            : 'Проверенный портрет шаблона'
        }
        src={`data:${p.art.mediaType};base64,${p.art.bytesBase64}`}
        width={220}
      />
      {p.formId === 'ENM-005' || p.formId === 'ENM-011' || p.formId === 'ENM-017' ? (
        <fieldset disabled={!enabled || onEdit === undefined}>
          <legend>Портрет для сохраняемой версии</legend>
          <label>
            Выберите портрет (PNG или JPEG, до 12 МиБ)
            <input
              type="file"
              accept={CHARACTER_ART_ACCEPT}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file === undefined || reading.current !== null || !enabled) return;
                const token = Symbol();
                reading.current = token;
                onReadPending?.(true);
                setError(null);
                void characterArtFromFile(file)
                  .then((result) => {
                    if (token !== reading.current) return;
                    if (!result.ok)
                      return setError(
                        result.reason === 'FILE_TOO_LARGE'
                          ? 'Размер портрета превышает 12 МиБ.'
                          : 'В файле не распознан PNG или JPEG.',
                      );
                    if (file.type !== '' && file.type !== result.value.mediaType)
                      return setError('Формат изображения отличается от типа файла.');
                    edit({ operation: 'UPLOAD', file: { ...result.value } });
                  })
                  .catch(() => {
                    if (token === reading.current) setError('Не удалось прочитать портрет.');
                  })
                  .finally(() => {
                    if (token === reading.current) {
                      reading.current = null;
                      onReadPending?.(false);
                    }
                  });
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (enabled && reading.current === null) edit({ operation: 'CLEAR' });
            }}
          >
            Использовать заглушку
          </button>
          {error === null ? null : <p role="alert">{error}</p>}
        </fieldset>
      ) : null}
    </section>
  );
}
