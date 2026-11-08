import {
  assertNpcTaipanModeTarget,
  npcTaipanInitialModeChoices,
  npcTaipanPoisonProfileLabel,
  readNpcTaipanModeContribution,
  type NpcPoisonSourceCatalog,
  type NpcTaipanModeContribution,
} from '../domain/rules/npc-authoring/formal-poison-source.js';
import {
  npcPoisonCarrierChoices,
  readNpcPoisonCoatingContribution,
  type NpcFormalPoisonCatalog,
  type NpcPoisonCoatingContribution,
} from '../domain/rules/npc-authoring/formal-poison-coating.js';
import {
  readNpcFormalLifeBoundary,
  type NpcFormalLifeState,
} from '../domain/rules/npc-authoring/formal-life-state.js';
import type {
  NpcInventoryPhysicalBasis,
  NpcInventoryPublicationCatalog,
} from '../domain/rules/npc-authoring/inventory-publication.js';
import {
  readNpcEditorDraft,
  replaceNpcInventoryCoatingSelection,
  type NpcEditorCatalog,
  type NpcEditorDraft,
} from '../domain/rules/npc-authoring/staged-input.js';
import type {
  NpcAttemptReadContext,
  NpcChildAllocation,
} from '../persistence/npc-child-identities.js';
import type { NpcCompositionAuthoringApply } from '../persistence/npc-gm-source.js';
import type { NpcAttempt, NpcCalendarReadContext } from '../persistence/npc-library-records.js';
import type {
  NpcAttemptPreparationContext,
  NpcPreparedAttempt,
} from '../persistence/npc-library-store.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  npcPoisonModeSetRequestInputValue,
  npcPoisonCoatingPreparationRequestInputValue,
  npcPoisonCoatingRemovalRequestInputValue,
  npcTechnicalRequestValue,
  type NpcPreparationRequest,
} from '../shared/npc-command.js';
import type {
  NpcPoisonModePreparation,
  NpcPoisonModeState,
  NpcPoisonCoatingPreparation,
  NpcPoisonCoatingState,
} from '../shared/npc-presentation.js';
import type { JsonObject } from '../shared/wire-protocol.js';

export interface NpcPoisonPreparationBasis {
  readonly attempt: NpcAttempt;
  readonly draft: NpcEditorDraft;
  readonly editor: NpcEditorCatalog;
  readonly readContext: NpcAttemptReadContext;
  readonly compositionProof: unknown;
  readonly previousVersionCompositionProofOrNull: unknown;
  readonly sourceSignature: unknown;
  readonly modes: readonly NpcTaipanModeContribution[];
  readonly physicalInventory: NpcInventoryPhysicalBasis;
  readonly coatings: readonly NpcPoisonCoatingContribution[];
  /** Original issued evidence only; these doses are not valid current publication inputs. */
  readonly staleCoatings?: readonly Readonly<{
    kind: 'PREPARATION_CLOCK_CHANGED';
    original: NpcPoisonCoatingContribution;
    originalClock: NpcCalendarReadContext['currentClock'];
    explanation: string;
  }>[];
  readonly lifeStateOrNull: NpcFormalLifeState | null;
}
type Request = Extract<NpcPreparationRequest, { sourceFormId: 'NPC-015' | 'NPC-016' }>;
type Allocation = Extract<NpcChildAllocation, { kind: 'EFFECT_INSTANCE' | 'COATING_INSTANCE' }>;
export interface NpcPoisonCandidate {
  readonly request: Request;
  readonly basis: NpcPoisonPreparationBasis;
  readonly calendar: NpcCalendarReadContext;
  readonly next: NpcAttempt;
  readonly childAllocations: readonly NpcChildAllocation[];
  readonly committedAt: string;
}
export class NpcPoisonPreparationError extends Error {
  constructor(detail: string) {
    super(`NPC poison preparation: ${detail}`);
    this.name = new.target.name;
  }
}
function fail(detail: string): never {
  throw new NpcPoisonPreparationError(detail);
}
function equal(a: unknown, b: unknown, label: string): void {
  if (!s.same(a, b)) fail(label);
}
function json(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/** Initial authoring only: the owning callback proves history; these controls never play OP-COAT. */
export function createNpcPoisonPreparation(
  options: Readonly<{
    source: NpcPoisonSourceCatalog | null;
    catalog: NpcFormalPoisonCatalog | null;
    publication: NpcInventoryPublicationCatalog;
    read: (attempt: NpcAttempt, calendar: NpcCalendarReadContext) => NpcPoisonPreparationBasis;
    historicalCalendar: (
      operation: Parameters<NpcCompositionAuthoringApply>[0],
      calendar: NpcCalendarReadContext,
    ) => NpcCalendarReadContext;
    validateCandidate: (candidate: NpcPoisonCandidate) => void;
  }>,
) {
  function read(attempt: NpcAttempt, calendar: NpcCalendarReadContext) {
    if (options.source === null || options.catalog === null)
      return fail('approved initial poison sources unavailable');
    if (attempt.status !== 'OPEN' || !['NPC-015', 'NPC-016'].includes(attempt.stage))
      return fail('open NPC015 or NPC016 required');
    const basis = options.read(attempt, calendar);
    equal(basis.attempt, attempt, 'actual predecessor changed');
    const modes = basis.modes.map((mode) => {
      assertNpcTaipanModeTarget(options.source!, mode, {
        campaignId: attempt.scope.campaignId,
        npcUuid: attempt.candidateNpcUuid,
        campaignTimestampOrNull: calendar.currentClock.campaignTimestampOrNull,
        compositionProof: basis.compositionProof,
      });
      return readNpcTaipanModeContribution(options.source!, mode);
    });
    const selected = basis.draft.initialState.poisonModeFactIds;
    if (selected?.kind !== 'ENTERED') return fail('explicit owning mode selection required');
    equal(
      selected.value,
      modes.map((mode) => mode.modeOperationId),
      'mode selection changed',
    );
    const coatings = basis.coatings.map((coating) =>
      readNpcPoisonCoatingContribution(options.catalog!, coating),
    );
    const clockTuple = (clock: NpcCalendarReadContext['currentClock']) => [
      clock.phase,
      clock.campaignTimestampOrNull,
      clock.lobbySnapshotRevisionOrNull,
    ];
    const staleCoatings = (basis.staleCoatings ?? []).map((entry) => {
      if (
        entry.kind !== 'PREPARATION_CLOCK_CHANGED' ||
        typeof entry.explanation !== 'string' ||
        entry.explanation.trim().length === 0
      )
        return fail('recognized stale preparation explanation required');
      const original = readNpcPoisonCoatingContribution(options.catalog!, entry.original);
      equal(
        [original.preparation.campaignId, original.preparation.npcUuid],
        [attempt.scope.campaignId, attempt.candidateNpcUuid],
        'stale preparation owner changed',
      );
      const anchor = original.preparation.calendarAnchor;
      if (
        original.coating.origin.kind !== 'PREPARED' ||
        anchor.campaignTimestamp !== entry.originalClock.campaignTimestampOrNull ||
        (anchor.kind === 'PRE_START_INITIAL'
          ? entry.originalClock.phase !== 'PRE_START' ||
            anchor.lobbySnapshotRevision !== entry.originalClock.lobbySnapshotRevisionOrNull
          : entry.originalClock.phase !== 'POST_START') ||
        s.same(clockTuple(entry.originalClock), clockTuple(calendar.currentClock))
      )
        return fail('actual stale preparation clock evidence required');
      return { ...original, originalClock: entry.originalClock, explanation: entry.explanation };
    });
    const selectedCoatings = [...coatings, ...staleCoatings];
    if (
      new Set(selectedCoatings.map((entry) => entry.coating.coatingInstanceId)).size !==
        selectedCoatings.length ||
      new Set(selectedCoatings.map((entry) => entry.coating.carrier.itemInstanceId)).size !==
        selectedCoatings.length
    )
      return fail('one verified selected dose per physical carrier required');
    const carriers = npcPoisonCarrierChoices(options.catalog, basis.physicalInventory);
    const choices = npcTaipanInitialModeChoices(options.source, {
      npcUuid: attempt.candidateNpcUuid,
      compositionProof: basis.compositionProof,
      previousVersionCompositionProofOrNull: basis.previousVersionCompositionProofOrNull,
    });
    return { basis, modes, coatings, staleCoatings, selectedCoatings, carriers, choices, calendar };
  }
  type Read = ReturnType<typeof read>;
  function key(current: Read, target: unknown): string {
    return s.sha(
      s.canonical({
        scope: current.basis.attempt.scope,
        npcDraftId: current.basis.attempt.npcDraftId,
        npcUuid: current.basis.attempt.candidateNpcUuid,
        revision: current.basis.attempt.revision,
        source: current.basis.sourceSignature,
        clock: current.calendar.currentClock,
        modes: current.modes,
        coatings: current.coatings.map((entry) => entry.coating),
        ...(current.staleCoatings.length === 0
          ? {}
          : {
              staleCoatings: current.staleCoatings.map((entry) => ({
                coating: entry.coating,
                originalClock: entry.originalClock,
              })),
            }),
        carriers: current.carriers,
        target,
      }),
    );
  }
  function availableModes(current: Read) {
    if (
      current.basis.lifeStateOrNull !== null &&
      readNpcFormalLifeBoundary(current.basis.lifeStateOrNull).state.dead
    )
      return [];
    return current.modes.filter(
      (mode) =>
        mode.currentSourceSnapshot.status === 'ACTIVE' &&
        mode.currentSourceSnapshot.effectsEnabled &&
        mode.currentSourceSnapshot.learnedNodeRefs.includes(mode.sourceAbilityId),
    );
  }
  function currentDose(current: Read, itemInstanceId: string) {
    const doses = current.selectedCoatings.filter(
      (entry) => entry.coating.carrier.itemInstanceId === itemInstanceId,
    );
    if (doses.length > 1) return fail('multiple doses on one physical carrier');
    return doses[0] ?? null;
  }
  function modeTarget(sourceInstanceId: string) {
    return { kind: 'MODE', sourceInstanceId };
  }
  function doseTarget(current: Read, sourceInstanceId: string, targetItemInstanceId: string) {
    return {
      kind: 'COATING',
      sourceInstanceId,
      targetItemInstanceId,
      replacesCoatingIdOrNull:
        currentDose(current, targetItemInstanceId)?.coating.coatingInstanceId ?? null,
    };
  }
  function removalTarget(coatingInstanceId: string) {
    return { kind: 'REMOVE', coatingInstanceId };
  }
  function selection(request: Request, attempt: NpcAttempt, calendar: NpcCalendarReadContext) {
    const current = read(attempt, calendar);
    if (request.sourceFormId !== attempt.stage) return fail('preparation form changed');
    if (request.sourceFormId === 'NPC-016' && request.preparation.kind === 'POISON_MODE_SET') {
      const input = npcPoisonModeSetRequestInputValue(request.preparation.input);
      equal(
        input.capabilityKey,
        key(current, modeTarget(input.sourceInstanceId)),
        'mode capability changed',
      );
      const choice =
        current.choices.find((entry) => entry.sourceInstanceId === input.sourceInstanceId) ??
        fail('retained or missing source cannot receive a new initial mode');
      if (!choice.profiles.some((profile) => profile.poisonProfileId === input.poisonProfileId))
        return fail('mode must be a learned source profile');
      const previous =
        current.modes.find((mode) => mode.sourceInstanceId === input.sourceInstanceId) ?? null;
      if (previous !== null && previous.origin.kind !== 'PREPARED')
        return fail('committed mode cannot be reassigned by initial controls');
      return { kind: 'MODE' as const, current, input, previous };
    }
    if (request.sourceFormId !== 'NPC-015') return fail('initial poison request required');
    if (request.preparation.kind === 'POISON_COATING_REMOVE') {
      const input = npcPoisonCoatingRemovalRequestInputValue(request.preparation.input);
      const selected =
        current.selectedCoatings.find(
          (entry) => entry.coating.coatingInstanceId === input.coatingInstanceId,
        ) ?? fail('selected actual coating missing');
      equal(
        input.capabilityKey,
        key(current, removalTarget(input.coatingInstanceId)),
        'remove capability changed',
      );
      return { kind: 'REMOVE' as const, current, input, selected };
    }
    if (request.preparation.kind !== 'POISON_COATING_PREPARE')
      return fail('initial poison request required');
    const input = npcPoisonCoatingPreparationRequestInputValue(request.preparation.input);
    const target = doseTarget(current, input.sourceInstanceId, input.targetItemInstanceId);
    equal(input.capabilityKey, key(current, target), 'coating capability changed');
    if (!availableModes(current).some((mode) => mode.sourceInstanceId === input.sourceInstanceId))
      return fail('actual active unsuppressed learned source mode required');
    if (!current.carriers.some((carrier) => carrier.itemInstanceId === input.targetItemInstanceId))
      return fail('actual individual physical carrier required');
    if (calendar.currentClock.campaignTimestampOrNull === null)
      return fail('confirmed initial time required');
    equal(input.replacesCoatingIdOrNull, target.replacesCoatingIdOrNull, 'replacement changed');
    if (
      !input.surfaceConfirmed ||
      input.replaceConfirmed !== (target.replacesCoatingIdOrNull !== null)
    )
      return fail('explicit surface and exact replacement confirmation required');
    return { kind: 'COATING' as const, current, input };
  }
  function values(
    chosen: ReturnType<typeof selection>,
    operationId: string,
    childId: string | null,
  ): JsonObject {
    const { basis } = chosen.current;
    if (chosen.kind === 'MODE') {
      const ids = chosen.current.modes.map((mode) => mode.modeOperationId);
      const next =
        chosen.previous === null
          ? [...ids, operationId]
          : ids.map((id) => (id === chosen.previous!.modeOperationId ? operationId : id));
      return json(
        readNpcEditorDraft(basis.editor, {
          ...basis.draft,
          initialState: {
            ...basis.draft.initialState,
            poisonModeFactIds: { kind: 'ENTERED', value: next },
          },
        }),
      );
    }
    const target =
      chosen.kind === 'REMOVE'
        ? chosen.selected.coating.carrier.itemInstanceId
        : chosen.input.targetItemInstanceId;
    const old = currentDose(chosen.current, target)?.coating.coatingInstanceId;
    const next = chosen.kind === 'REMOVE' ? [] : [s.uuid(childId)];
    const editor =
      chosen.kind === 'REMOVE'
        ? basis.editor
        : {
            ...basis.editor,
            inventory: {
              ...(basis.editor.inventory ?? fail('actual inventory editor context required')),
              coatingBindings: [
                ...basis.editor.inventory!.coatingBindings,
                { coatingInstanceId: s.uuid(childId), itemInstanceId: target },
              ],
            },
          };
    const inventory = replaceNpcInventoryCoatingSelection(
      editor,
      basis.draft.inventory,
      target,
      old === undefined ? [] : [old],
      next,
    );
    return json(readNpcEditorDraft(editor, { ...basis.draft, inventory }));
  }
  function allocations(
    chosen: ReturnType<typeof selection>,
    childId: string | null,
  ): readonly Allocation[] {
    if (chosen.kind === 'REMOVE') return [];
    if (chosen.kind === 'MODE')
      return [
        {
          kind: 'EFFECT_INSTANCE',
          id: s.uuid(childId),
          sourceKind: 'POISON_MODE',
          sourceInstanceId: chosen.input.sourceInstanceId,
        },
      ];
    return [
      {
        kind: 'COATING_INSTANCE',
        id: s.uuid(childId),
        itemInstanceId: chosen.input.targetItemInstanceId,
        sourceInstanceId: chosen.input.sourceInstanceId,
      },
    ];
  }
  return {
    selection,
    inspect(
      attempt: NpcAttempt,
      calendar: NpcCalendarReadContext,
    ): Readonly<{
      modePreparations: readonly NpcPoisonModePreparation[];
      modeStates: readonly NpcPoisonModeState[];
      coatingPreparations: readonly NpcPoisonCoatingPreparation[];
      coatingStates: readonly NpcPoisonCoatingState[];
    }> | null {
      if (options.source === null || options.catalog === null) return null;
      // ADR0087 preserves saved legacy absence; it cannot issue current poison capabilities.
      if (!Object.hasOwn(s.object(s.object(attempt.values)['initialState']), 'poisonModeFactIds'))
        return null;
      const poisonSource = options.source;
      const current = read(attempt, calendar);
      return {
        modePreparations: current.choices.map((source) => {
          const mode = current.modes.find(
            (row) => row.sourceInstanceId === source.sourceInstanceId,
          );
          return {
            capabilityKey: key(current, modeTarget(source.sourceInstanceId)),
            sourceInstanceId: source.sourceInstanceId,
            sourceLabel: `Тайпан · ${source.sourceInstanceId}`,
            profileChoices: source.profiles.map((profile) => ({
              value: profile.poisonProfileId,
              label: npcTaipanPoisonProfileLabel(poisonSource, profile.poisonProfileId),
            })),
            input: {
              poisonProfileId:
                mode === undefined
                  ? { kind: 'UNSET' }
                  : { kind: 'ENTERED', value: mode.activePoisonProfileId },
              reason: { kind: 'UNSET' },
            },
            canSubmit:
              source.profiles.length !== 0 &&
              (mode === undefined || mode.origin.kind === 'PREPARED'),
            errors:
              source.profiles.length === 0 ? { poisonProfileId: ['Нет изученного вида яда'] } : {},
            explanation:
              'Выберите исходный режим нового экземпляра. Прошедшее время и сыгранная смена режима не создаются.',
            derivedRows: [],
          };
        }),
        modeStates: current.modes.map((mode) => ({
          sourceInstanceId: mode.sourceInstanceId,
          modeFactId: mode.modeOperationId,
          sourceLabel: `Тайпан · ${mode.sourceInstanceId}`,
          poisonProfileId: mode.activePoisonProfileId,
          explanation:
            mode.origin.kind === 'COMMITTED'
              ? 'Сохранённый режим: исходный выбор не переключает его бесплатно.'
              : 'Подтверждённый исходный режим нового экземпляра.',
          derivedRows: [
            {
              label: 'Вид яда',
              value: npcTaipanPoisonProfileLabel(poisonSource, mode.activePoisonProfileId),
            },
            { label: 'Правило', value: mode.sourceAbilityId },
            { label: 'Исходное подтверждение', value: mode.modeOperationId },
            { label: 'Ожидаемое переключение', value: 'Отсутствует' },
            { label: 'Причина', value: mode.history.reason },
          ],
        })),
        coatingPreparations: availableModes(current).flatMap((mode) =>
          current.carriers.map((carrier) => {
            const target = doseTarget(current, mode.sourceInstanceId, carrier.itemInstanceId);
            return {
              capabilityKey: key(current, target),
              sourceInstanceId: mode.sourceInstanceId,
              sourceLabel: `Тайпан · ${mode.sourceInstanceId}`,
              targetItemInstanceId: carrier.itemInstanceId,
              targetLabel: carrier.label,
              surfaceLabel:
                carrier.kind === 'FOOD'
                  ? 'Пища'
                  : carrier.kind === 'PROJECTILE'
                    ? 'Отдельный снаряд'
                    : 'Атакующий компонент ближнего боя',
              replacesCoatingIdOrNull: target.replacesCoatingIdOrNull,
              input: {
                surfaceConfirmed: { kind: 'UNSET' },
                replaceConfirmed: { kind: 'UNSET' },
                reason: { kind: 'UNSET' },
              },
              canSubmit: calendar.currentClock.campaignTimestampOrNull !== null,
              errors: {},
              explanation:
                calendar.currentClock.campaignTimestampOrNull === null
                  ? 'Мастер должен подтвердить начальное время кампании.'
                  : 'Подтвердите поверхность и, если доза уже есть, её замену. Броски, расход ОЭ и применение яда не выполняются.',
              derivedRows: [
                {
                  label: 'Действующий режим источника',
                  value: npcTaipanPoisonProfileLabel(poisonSource, mode.activePoisonProfileId),
                },
              ],
            };
          }),
        ),
        coatingStates: [
          ...current.coatings.map(({ coating }) => ({
            capabilityKey: key(current, removalTarget(coating.coatingInstanceId)),
            coatingInstanceId: coating.coatingInstanceId,
            targetItemInstanceId: coating.carrier.itemInstanceId,
            targetLabel: coating.carrier.label,
            canRemove: true,
            errors: [],
            explanation:
              'Исходная доза и её время неизменны. Снятие требует причины; прежние версии сохраняются.',
            derivedRows: [
              {
                label: 'Профиль дозы',
                value: npcTaipanPoisonProfileLabel(poisonSource, coating.payload.poisonProfileId),
              },
              { label: 'Источник', value: coating.sourceInstanceId },
              { label: 'Исходная формула', value: coating.payload.sourceFormula },
              {
                label: 'Исходный уровень',
                value: String(coating.originalSourceSnapshot.targetLevel),
              },
              {
                label: 'Текущий или закреплённый уровень',
                value: String(coating.currentSourceContext.effectiveSourceSnapshot.targetLevel),
              },
              {
                label: 'Состояние источника',
                value:
                  coating.currentSourceContext.resolution.kind === 'CURRENT'
                    ? 'Доступен: используется текущий уровень'
                    : 'Недоступен: закреплён последний доказанный уровень',
              },
              { label: 'Минута подготовки', value: String(coating.appliedAt.campaignTimestamp) },
              {
                label: 'Расходование',
                value:
                  coating.consumeCondition === 'INGESTION'
                    ? 'При употреблении пищи'
                    : 'При первом успешном попадании; промах не расходует дозу',
              },
              { label: 'История расходования', value: 'Доза не использована' },
              { label: 'Причина подготовки', value: coating.reason },
            ],
          })),
          ...current.staleCoatings.map(({ coating, explanation }) => ({
            capabilityKey: key(current, removalTarget(coating.coatingInstanceId)),
            coatingInstanceId: coating.coatingInstanceId,
            targetItemInstanceId: coating.carrier.itemInstanceId,
            targetLabel: coating.carrier.label,
            canRemove: true,
            errors: [explanation],
            explanation,
            derivedRows: [
              {
                label: 'Исходный профиль дозы',
                value: npcTaipanPoisonProfileLabel(poisonSource, coating.payload.poisonProfileId),
              },
              { label: 'Исходный источник', value: coating.sourceInstanceId },
              { label: 'Исходная формула', value: coating.payload.sourceFormula },
              {
                label: 'Уровень при подготовке',
                value: String(coating.originalSourceSnapshot.targetLevel),
              },
              {
                label: 'Исходная минута подготовки',
                value: String(coating.appliedAt.campaignTimestamp),
              },
              {
                label: 'Текущее подтверждение',
                value: 'Недействительно после изменения времени. Явно снимите или замените дозу.',
              },
              { label: 'История расходования', value: 'Доза не использована' },
              { label: 'Причина подготовки', value: coating.reason },
            ],
          })),
        ],
      };
    },
    validate(request: Request, context: NpcAttemptPreparationContext): void {
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
      const calendar = context.calendarContext ?? fail('calendar missing');
      const chosen = selection(request, before, calendar);
      const childId = chosen.kind === 'REMOVE' ? null : allocate();
      const childAllocations = allocations(chosen, childId);
      const next = {
        ...before,
        revision: s.increment(before.revision),
        values: values(chosen, request.operationId, childId),
      };
      options.validateCandidate({
        request,
        basis: chosen.current.basis,
        calendar,
        next,
        childAllocations,
        committedAt,
      });
      return { next, childAllocations, receiptId: allocate(), committedAt };
    },
    apply(
      ...args: [...Parameters<NpcCompositionAuthoringApply>, NpcCalendarReadContext]
    ): JsonObject {
      const [operation, event, previous, context, calendar] = args;
      const request = npcTechnicalRequestValue(operation.request);
      if (
        request.messageType !== 'network.npc-preparation.request' ||
        (request.sourceFormId !== 'NPC-015' && request.sourceFormId !== 'NPC-016')
      )
        return fail('actual poison request required');
      equal(
        [context.scope, context.npcDraftId, context.revision],
        [previous.attempt.scope, previous.attempt.npcDraftId, previous.attempt.revision],
        'poison predecessor',
      );
      equal(
        [event.operationId, request.operationId],
        [operation.operationId, operation.operationId],
        'actual operation changed',
      );
      const historical = options.historicalCalendar(operation, calendar);
      const chosen = selection(request, previous.attempt, historical);
      const children = 'format' in event ? event.childAllocations : [];
      const childId = children[0]?.id ?? null;
      equal(children, allocations(chosen, childId), 'actual poison allocation changed');
      const next = {
        ...previous.attempt,
        revision: s.increment(previous.attempt.revision),
        values: values(chosen, operation.operationId, childId),
      };
      equal(event.attempt, next, 'poison event changed');
      options.validateCandidate({
        request,
        basis: chosen.current.basis,
        calendar: historical,
        next,
        childAllocations: children,
        committedAt: operation.committedAt,
      });
      return next.values;
    },
  };
}
