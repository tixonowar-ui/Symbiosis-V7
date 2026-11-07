import {
  npcFormalWeaverSourceChoices,
  readNpcFormalWeaverRemaining,
  type NpcFormalWeaverCatalog,
  type NpcFormalWeaverHistoryAnchor,
  type NpcFormalWeaverEffectInstance,
  type NpcFormalWeaverOrigin,
} from '../domain/rules/npc-authoring/formal-weaver-effects.js';
import {
  readNpcEditorDraft,
  type NpcEditorCatalog,
  type NpcEditorDraft,
} from '../domain/rules/npc-authoring/staged-input.js';
import type { NpcCompositionAuthoringApply } from '../persistence/npc-gm-source.js';
import type { NpcAttempt, NpcCalendarReadContext } from '../persistence/npc-library-records.js';
import type {
  NpcAttemptPreparationContext,
  NpcPreparedAttempt,
} from '../persistence/npc-library-store.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  npcTechnicalRequestValue,
  npcWeaverStatePreparationRequestInputValue,
  npcWeaverStateRemovalRequestInputValue,
  type NpcPreparationRequest,
} from '../shared/npc-command.js';
import type {
  NpcWeaverCurrentState,
  NpcWeaverStatePreparation,
} from '../shared/npc-presentation.js';
import type { JsonObject } from '../shared/wire-protocol.js';
import type { NpcFormalLifeTimerDisplayBasis } from '../domain/rules/npc-authoring/formal-life-state.js';

export interface NpcWeaverPreparationBasis {
  readonly attempt: NpcAttempt;
  readonly draft: NpcEditorDraft;
  readonly editor: NpcEditorCatalog;
  readonly compositionProof: unknown;
  readonly sourceSignature: unknown;
  /** Independently validated original anchors remain removable after current source loss/expiry. */
  readonly selected: readonly Readonly<{
    history: NpcFormalWeaverHistoryAnchor;
    origin: NpcFormalWeaverOrigin;
    originalEffect: NpcFormalWeaverEffectInstance;
    currentEffectOrNull: NpcFormalWeaverEffectInstance | null;
    currentErrorOrNull: string | null;
  }>[];
}
type Request = Extract<NpcPreparationRequest, { sourceFormId: 'NPC-016' }>;
export class NpcWeaverPreparationError extends Error {
  constructor(detail: string) {
    super(`NPC Weaver preparation: ${detail}`);
    this.name = new.target.name;
  }
}
function fail(detail: string): never {
  throw new NpcWeaverPreparationError(detail);
}
function equal(a: unknown, b: unknown, label: string): void {
  if (!s.same(a, b)) fail(label);
}
function label(branch: NpcFormalWeaverHistoryAnchor['branch']): string {
  return branch === 'REPLACEMENT_TEMPORARY'
    ? 'Временная замена органов'
    : branch === 'REPLACEMENT_RECOVERY'
      ? 'Замена до восстановления'
      : 'Защита дублированием органов';
}

/** Selection changes are initial authoring operations, never played activations or expiry events. */
export function createNpcWeaverPreparation(
  options: Readonly<{
    catalog: NpcFormalWeaverCatalog | null;
    read: (attempt: NpcAttempt, calendar: NpcCalendarReadContext) => NpcWeaverPreparationBasis;
    readTimerBasis: (
      attempt: NpcAttempt,
      calendar: NpcCalendarReadContext,
    ) => NpcFormalLifeTimerDisplayBasis | Readonly<{ kind: 'UNAVAILABLE'; reason: string }> | null;
    historicalCalendar: (
      operation: Parameters<NpcCompositionAuthoringApply>[0],
      calendar: NpcCalendarReadContext,
    ) => NpcCalendarReadContext;
  }>,
) {
  function read(attempt: NpcAttempt, calendar: NpcCalendarReadContext) {
    if (options.catalog === null) return fail('approved Weaver initial-state source unavailable');
    if (attempt.status !== 'OPEN' || attempt.stage !== 'NPC-016')
      return fail('open NPC016 required');
    const basis = options.read(attempt, calendar);
    const ids = basis.draft.initialState.weaverEffectInstanceIds;
    if (ids?.kind !== 'ENTERED') return fail('explicit owning Weaver selection required');
    equal(
      ids.value,
      basis.selected.map((row) => row.history.effectInstanceId),
      'selected history',
    );
    return { basis, catalog: options.catalog };
  }
  function key(basis: NpcWeaverPreparationBasis, target: unknown): string {
    return s.sha(
      s.canonical({
        scope: basis.attempt.scope,
        npcDraftId: basis.attempt.npcDraftId,
        revision: basis.attempt.revision,
        source: basis.sourceSignature,
        selected: basis.selected.map((row) => row.history),
        target,
      }),
    );
  }
  function selection(request: Request, attempt: NpcAttempt, calendar: NpcCalendarReadContext) {
    const { basis, catalog } = read(attempt, calendar);
    if (request.preparation.kind === 'WEAVER_STATE_REMOVE') {
      const input = npcWeaverStateRemovalRequestInputValue(request.preparation.input);
      const selected =
        basis.selected.find((row) => row.history.effectInstanceId === input.effectInstanceId) ??
        fail('selected original Weaver state missing');
      equal(
        input.capabilityKey,
        key(basis, { effectInstanceId: input.effectInstanceId }),
        'remove capability changed',
      );
      return { kind: 'REMOVE' as const, basis, input, selected };
    }
    if (request.preparation.kind !== 'WEAVER_STATE_PREPARE') return fail('Weaver request required');
    const input = npcWeaverStatePreparationRequestInputValue(request.preparation.input);
    const source =
      npcFormalWeaverSourceChoices(catalog, {
        npcUuid: attempt.candidateNpcUuid,
        compositionProof: basis.compositionProof,
      }).find((row) => row.sourceInstanceId === input.sourceInstanceId) ??
      fail('actual Weaver source unavailable');
    equal(
      input.capabilityKey,
      key(basis, { sourceInstanceId: input.sourceInstanceId }),
      'prepare capability changed',
    );
    if (!source.branches.some((row) => row.branch === input.branch))
      return fail('source branch unavailable');
    if (calendar.currentClock.campaignTimestampOrNull === null)
      return fail('confirmed campaign time required');
    readNpcFormalWeaverRemaining(catalog, input.remainingMinutes, input.branch);
    const protection = input.branch === 'DUPLICATED_ORGANS_PROTECTION';
    if (
      basis.selected.some(
        (row) =>
          row.history.sourceInstanceId === input.sourceInstanceId &&
          (row.history.branch === 'DUPLICATED_ORGANS_PROTECTION') === protection,
      )
    )
      return fail(
        'remove the existing source state before assigning another state in the same slot',
      );
    return { kind: 'PREPARE' as const, basis, input };
  }
  function values(
    chosen: ReturnType<typeof selection>,
    effectInstanceId: string | null,
  ): JsonObject {
    const ids = chosen.basis.selected.map((row) => row.history.effectInstanceId);
    const next =
      chosen.kind === 'REMOVE'
        ? ids.filter((id) => id !== chosen.input.effectInstanceId)
        : [...ids, s.uuid(effectInstanceId)];
    return JSON.parse(
      JSON.stringify(
        readNpcEditorDraft(chosen.basis.editor, {
          ...chosen.basis.draft,
          initialState: {
            ...chosen.basis.draft.initialState,
            weaverEffectInstanceIds: { kind: 'ENTERED', value: next },
          },
        }),
      ),
    ) as JsonObject;
  }
  return {
    selection,
    inspect(
      attempt: NpcAttempt,
      calendar: NpcCalendarReadContext,
    ): Readonly<{
      preparations: readonly NpcWeaverStatePreparation[];
      states: readonly NpcWeaverCurrentState[];
    }> | null {
      if (options.catalog === null) return null;
      if (
        !Object.hasOwn(
          s.object(s.object(attempt.values)['initialState']),
          'weaverEffectInstanceIds',
        )
      )
        return null;
      const { basis, catalog } = read(attempt, calendar);
      const timer = options.readTimerBasis(attempt, calendar);
      const timerRows =
        timer === null
          ? [{ label: 'Предварительный таймер смерти', value: 'Не назначен' }]
          : timer.kind === 'UNAVAILABLE'
            ? [{ label: 'Предварительный таймер смерти', value: timer.reason }]
            : [
                {
                  label: 'Предварительный таймер смерти: начало, минута',
                  value: timer.startsAtExact,
                },
                {
                  label: 'Предварительный таймер смерти: окончание, минута',
                  value: timer.deadlineExact,
                },
                {
                  label: 'Предварительный таймер смерти: остаток, мин',
                  value: timer.remainingExact,
                },
                {
                  label: 'Минимальный срок для восстановления',
                  value:
                    timer.requiredRecoveryDeadlineOrNull ?? 'Нет выбранной ветви восстановления',
                },
                {
                  label: 'Согласованность сроков',
                  value: timer.recoveryFits
                    ? 'Срок восстановления укладывается; полный лист ещё должен пройти проверку'
                    : 'Восстановление позже таймера смерти — сохранение запрещено, срок автоматически не продлевается',
                },
              ];
      return {
        preparations: npcFormalWeaverSourceChoices(catalog, {
          npcUuid: attempt.candidateNpcUuid,
          compositionProof: basis.compositionProof,
        }).map((source) => ({
          capabilityKey: key(basis, { sourceInstanceId: source.sourceInstanceId }),
          sourceInstanceId: source.sourceInstanceId,
          sourceLabel: `Ткач · ${source.sourceInstanceId}`,
          branchChoices: source.branches
            .filter(
              (branch) =>
                !basis.selected.some(
                  (row) =>
                    row.history.sourceInstanceId === source.sourceInstanceId &&
                    (row.history.branch === 'DUPLICATED_ORGANS_PROTECTION') ===
                      (branch.branch === 'DUPLICATED_ORGANS_PROTECTION'),
                ),
            )
            .map((branch) => ({
              value: branch.branch,
              label: label(branch.branch),
              maximumRemainingMinutes: branch.maximumRemainingMinutes,
            })),
          input: {
            branch: { kind: 'UNSET' },
            remainingMinutes: { kind: 'UNSET' },
            reason: { kind: 'UNSET' },
          },
          canSubmit:
            calendar.currentClock.campaignTimestampOrNull !== null &&
            source.branches.some(
              (branch) =>
                !basis.selected.some(
                  (row) =>
                    row.history.sourceInstanceId === source.sourceInstanceId &&
                    (row.history.branch === 'DUPLICATED_ORGANS_PROTECTION') ===
                      (branch.branch === 'DUPLICATED_ORGANS_PROTECTION'),
                ),
            ),
          errors: {},
          explanation:
            'Явно задайте исходное текущее состояние и точный остаток. Активация, R20 и расход ОЭ не создаются.',
          derivedRows: timerRows,
        })),
        states: basis.selected.map(
          ({ history, origin, originalEffect, currentEffectOrNull, currentErrorOrNull }) => ({
            capabilityKey: key(basis, { effectInstanceId: history.effectInstanceId }),
            effectInstanceId: history.effectInstanceId,
            sourceLabel: `Ткач · ${history.sourceInstanceId}`,
            branch: history.branch,
            canRemove: true,
            errors: currentErrorOrNull === null ? [] : [currentErrorOrNull],
            explanation:
              'Удаление меняет только выбранное исходное состояние; прежние версии и сроки сохраняются.',
            derivedRows: [
              ...(history.branch === 'REPLACEMENT_RECOVERY' ? timerRows : []),
              { label: 'Ветвь', value: label(history.branch) },
              {
                label: 'Происхождение',
                value:
                  origin.kind === 'PREPARED'
                    ? 'Подготовленное исходное назначение'
                    : 'Сохранённое исходное назначение; срок не перезапускается',
              },
              { label: 'Начало, минута', value: originalEffect.startsAt.campaignTimestampExact },
              {
                label: 'Неизменный срок окончания, минута',
                value: originalEffect.expiresAt.campaignTimestampExact,
              },
              {
                label: 'Текущий остаток, мин',
                value:
                  currentEffectOrNull === null
                    ? 'Недоступен: исходное назначение требует исправления'
                    : currentEffectOrNull.remainingExact,
              },
              { label: 'Исходно назначенный остаток, мин', value: history.remainingMinutes },
              { label: 'Основание', value: history.reason },
            ],
          }),
        ),
      };
    },
    validate(request: Request, context: NpcAttemptPreparationContext) {
      selection(
        request,
        context.previousOrNull?.attempt ?? fail('actual predecessor missing'),
        context.calendarContext ?? fail('calendar missing'),
      );
    },
    prepare(
      request: Request,
      context: NpcAttemptPreparationContext,
      allocate: () => string,
      committedAt: string,
    ): NpcPreparedAttempt {
      const before = context.previousOrNull?.attempt ?? fail('actual predecessor missing');
      const chosen = selection(
        request,
        before,
        context.calendarContext ?? fail('calendar missing'),
      );
      const id = chosen.kind === 'PREPARE' ? allocate() : null;
      return {
        next: { ...before, revision: s.increment(before.revision), values: values(chosen, id) },
        receiptId: allocate(),
        committedAt,
        ...(chosen.kind === 'REMOVE'
          ? {}
          : {
              childAllocations: [
                {
                  kind: 'EFFECT_INSTANCE',
                  id: id!,
                  sourceKind: 'WEAVER_STATE',
                  sourceInstanceId: chosen.input.sourceInstanceId,
                  branch: chosen.input.branch,
                },
              ],
            }),
      };
    },
    apply(
      ...args: [...Parameters<NpcCompositionAuthoringApply>, NpcCalendarReadContext]
    ): JsonObject {
      const [operation, event, previous, context, calendar] = args;
      const request = npcTechnicalRequestValue(operation.request);
      if (
        request.messageType !== 'network.npc-preparation.request' ||
        request.sourceFormId !== 'NPC-016'
      )
        return fail('actual Weaver request required');
      equal(
        [context.scope, context.npcDraftId, context.revision],
        [previous.attempt.scope, previous.attempt.npcDraftId, previous.attempt.revision],
        'Weaver predecessor',
      );
      const chosen = selection(
        request,
        previous.attempt,
        options.historicalCalendar(operation, calendar),
      );
      const children = 'format' in event ? event.childAllocations : [];
      equal(
        [event.operationId, event.attempt.revision],
        [operation.operationId, previous.attempt.revision + 1],
        'Weaver transition',
      );
      if (chosen.kind === 'REMOVE') equal(children, [], 'remove allocates no effect');
      else {
        if (children.length !== 1) return fail('one actual Weaver effect allocation required');
        equal(
          children[0],
          {
            kind: 'EFFECT_INSTANCE',
            id: children[0]!.id,
            sourceKind: 'WEAVER_STATE',
            sourceInstanceId: chosen.input.sourceInstanceId,
            branch: chosen.input.branch,
          },
          'actual Weaver allocation source',
        );
      }
      return values(chosen, children[0]?.id ?? null);
    },
  };
}
