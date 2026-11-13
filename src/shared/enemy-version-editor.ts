import {
  enemyAuthoringContextValue,
  enemyVersionIdentityValue,
  type EnemyAuthoringAttempt,
  type EnemyAuthoringContext,
  type EnemyVersionIdentity,
} from './enemy-authoring.js';
import {
  enemyVersionDiffValue,
  enemyVersionDiffDataValue,
  type EnemyVersionDiffEntry,
  type EnemyVersionReplacementSummary,
} from './enemy-version-configuration.js';
import { enemyCompositionReaders as r } from './enemy-composition-codec.js';
import { wireCodecPrimitives as w } from './wire-codec.js';
import { admissionJsonEqual } from './campaign-admission-codec.js';
import { enemyVersionFreeFactRequiresRepresentation } from './enemy-version-facts.js';

/** Read-only owning NAV source, kept separate from the editable candidate and its consent. */
export interface EnemyVersionEditor {
  readonly schemaVersion: 1;
  readonly baseSnapshot: EnemyAuthoringAttempt;
  readonly currentVersion: EnemyVersionIdentity;
  readonly changeSet: readonly EnemyVersionDiffEntry[];
  readonly activeCombatPins: readonly never[];
  readonly replacementSummaryOrNull: EnemyVersionReplacementSummary | null;
}
export function enemyVersionEditorValue(
  value: unknown,
  context: EnemyAuthoringContext,
): EnemyVersionEditor {
  enemyVersionDiffDataValue(value); // Reject nested accessors before legacy identity/attempt readers inspect them.
  const row = r.exact(
    value,
    'schemaVersion baseSnapshot currentVersion changeSet activeCombatPins replacementSummaryOrNull',
    '$.versionEditor',
  );
  w.literal(row['schemaVersion'], 1, '$.versionEditor.schemaVersion');
  const origin = context.versionAttempt?.origin;
  const candidate = context.attemptOrNull;
  if (origin === undefined || candidate === null || context.selectedVersionOrNull !== null)
    return r.invalid('$.versionEditor', 'own open version NAV context', null);
  const base =
    enemyAuthoringContextValue({
      attemptOrNull: row['baseSnapshot'],
      selectedVersionOrNull: null,
    }).attemptOrNull ??
    r.invalid('$.versionEditor.baseSnapshot', 'complete saved base attempt', null);
  const current = enemyVersionIdentityValue(row['currentVersion']);
  if (
    base.kind !== origin.base.kind ||
    base.campaignId !== origin.base.campaignId ||
    current.kind !== origin.base.kind ||
    current.campaignId !== origin.base.campaignId ||
    current.templateId !== origin.base.templateId ||
    current.version < origin.base.version ||
    candidate.kind !== base.kind ||
    candidate.attemptId !== origin.navigationRequestId ||
    base.attemptId === candidate.attemptId
  )
    r.invalid(
      '$.versionEditor',
      'separate actual same-template base and technical candidate',
      null,
    );
  if (
    base.kind === 'SENTIENT'
      ? [
          base.identityOrNull,
          base.baseStatsOrNull,
          base.buildOrNull,
          base.compositionOrNull,
          base.inventoryOrNull,
        ].some((field) => field === null)
      : [
          base.identityOrNull,
          base.statsOrNull,
          base.physicsOrNull,
          base.attackOrNull,
          base.compositionOrNull,
        ].some((field) => field === null)
  )
    r.invalid('$.versionEditor.baseSnapshot', 'complete immutable base version', null);
  enemyVersionDiffValue(row['changeSet']);
  const summary = context.versionAttempt?.replacementPreviewOrNull?.inputSummary ?? null;
  if (!admissionJsonEqual(row['replacementSummaryOrNull'], summary))
    r.invalid('$.replacementSummaryOrNull', 'exact saved preview consequences', null);
  if (r.list(row['activeCombatPins'], '$.versionEditor.activeCombatPins').length !== 0)
    r.invalid(
      '$.versionEditor.activeCombatPins',
      'enemy combat-instance creation is unavailable',
      null,
    );
  return w.validated(structuredClone(row));
}

/** Presentation mirrors technical readiness only; the owning command still revalidates every guard. */
export function enemyVersionEditorReadinessErrors(
  editor: EnemyVersionEditor,
  context: EnemyAuthoringContext,
): readonly string[] {
  const state = context.versionAttempt;
  const attempt = context.attemptOrNull;
  if (state === undefined || attempt === null)
    return r.invalid('$.versionEditor', 'own version context', null);
  const errors: string[] = [];
  if (!admissionJsonEqual(editor.currentVersion, state.origin.base))
    errors.push('Текущая версия изменилась. Вернитесь в каталог и откройте новую попытку.');
  if (state.reason.trim().length === 0) errors.push('Укажите и сохраните причину новой версии.');
  if (state.replacementPreviewOrNull !== null)
    errors.push('Явно подтвердите либо отмените показанную замену конфигурации.');
  if (state.ownChoicesPending === true)
    errors.push('Завершите подтверждение состава и текущих навыков на полном теле.');
  if (
    attempt.kind === 'CUSTOM_MONSTER' &&
    attempt.activeAdvisorCardIdOrNull !== null &&
    state.unconfiguredAdvisorCardIdOrNull === attempt.activeAdvisorCardIdOrNull
  )
    errors.push('Для этой карты явно подтвердите новую конфигурацию текущих навыков.');
  if (
    attempt.kind === 'SENTIENT' &&
    attempt.schemaVersion !== 2 &&
    state.retainedMandatoryFacts.kind === 'SENTIENT' &&
    enemyVersionFreeFactRequiresRepresentation(
      state.retainedMandatoryFacts.freeSlotOrNull,
      attempt.compositionAcquisitions?.freeSlotOrNull,
      attempt.buildOrNull?.raceCode,
    )
  )
    errors.push(
      'Сохранённое обязательное последствие требует явного подтверждения конфигурации, которая его представляет.',
    );
  return errors;
}
