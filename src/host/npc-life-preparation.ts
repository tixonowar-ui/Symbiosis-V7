import type { RollFaceSampler, RollMode } from '../domain/entities/roll-request/roll-model.js';
import {
  assertNpcFormalLifeTransition,
  npcFormalLifeMaximumRemainingMinutes,
  readNpcFormalLifeRemaining,
  type NpcFormalLifeCatalog,
  type NpcFormalLifeKind,
} from '../domain/rules/npc-authoring/formal-life-state.js';
import type { NpcFunctionalDuplicateProof } from '../domain/rules/npc-authoring/functional-duplicate-composition.js';
import {
  readNpcEditorDraft,
  type NpcEditorCatalog,
  type NpcEditorDraft,
} from '../domain/rules/npc-authoring/staged-input.js';
import type {
  NpcAttempt,
  NpcCalendarReadContext,
  NpcCalendarClock,
} from '../persistence/npc-library-records.js';
import type {
  NpcAttemptPreparationContext,
  NpcPreparedAttempt,
} from '../persistence/npc-library-store.js';
import type { NpcLifeStateRollFact } from '../persistence/npc-life-facts.js';
import { npcEventLifeStateFact } from '../persistence/npc-library-records.js';
import type { NpcCompositionAuthoringApply } from '../persistence/npc-gm-source.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import {
  npcTechnicalRequestValue,
  npcLifeStateRollRequestInputValue,
  npcLifeStateSetRequestInputValue,
  type NpcPreparationRequest,
  type NpcLifeStateSetRequestInput,
} from '../shared/npc-command.js';
import type { NpcLifeStatePreparation } from '../shared/npc-presentation.js';
import type { JsonObject } from '../shared/wire-protocol.js';
import { prepareNpcLifeRollFact, verifyNpcLifeRollOutcome } from './npc-life-roll.js';

export interface NpcLifePreparationBasis {
  readonly attempt: NpcAttempt;
  readonly draft: NpcEditorDraft;
  readonly editor: NpcEditorCatalog;
  readonly clock: NpcCalendarClock;
  readonly mode: RollMode;
  readonly sourceSignature: unknown;
  readonly duplicateOrNull: NpcFunctionalDuplicateProof | null;
  readonly previousKindOrNull: NpcFormalLifeKind | null;
  readonly rollFactOrNull: NpcLifeStateRollFact | null;
  readonly selectedInputOrNull: NpcLifeStateSetRequestInput | null;
  readonly unavailableReasonOrNull?: string | null;
}
type Request = Extract<NpcPreparationRequest, { sourceFormId: 'NPC-016' }>;
export class NpcLifePreparationError extends Error {
  constructor(detail: string) {
    super(`NPC life preparation: ${detail}`);
    this.name = new.target.name;
  }
}
function fail(detail: string): never {
  throw new NpcLifePreparationError(detail);
}
function equal(a: unknown, b: unknown, label: string): void {
  if (!s.same(a, b)) fail(label);
}
function json(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/** All identities, previous life and roll facts are supplied by the independently read owning prefix. */
export function createNpcLifePreparation(
  options: Readonly<{
    enabled: boolean;
    catalog: NpcFormalLifeCatalog;
    read: (attempt: NpcAttempt, calendar: NpcCalendarReadContext) => NpcLifePreparationBasis;
    historicalCalendar: (
      operation: Parameters<NpcCompositionAuthoringApply>[0],
      calendar: NpcCalendarReadContext,
    ) => NpcCalendarReadContext;
  }>,
) {
  function key(basis: NpcLifePreparationBasis) {
    return s.sha(
      s.canonical({
        scope: basis.attempt.scope,
        npcDraftId: basis.attempt.npcDraftId,
        revision: basis.attempt.revision,
        mode: basis.mode,
        clock: basis.clock,
        source: basis.sourceSignature,
        previous: basis.previousKindOrNull,
        roll: basis.rollFactOrNull?.fact.factId ?? null,
      }),
    );
  }
  function maximum(basis: NpcLifePreparationBasis): string | null {
    return basis.rollFactOrNull === null || basis.duplicateOrNull === null
      ? null
      : npcFormalLifeMaximumRemainingMinutes(
          options.catalog,
          basis.rollFactOrNull.fact,
          basis.duplicateOrNull,
        );
  }
  function read(attempt: NpcAttempt, calendar: NpcCalendarReadContext) {
    if (!options.enabled) return fail('approved initial life source is unavailable');
    if (attempt.status !== 'OPEN' || attempt.stage !== 'NPC-016')
      return fail('open NPC016 required');
    return options.read(attempt, calendar);
  }
  function selection(request: Request, attempt: NpcAttempt, calendar: NpcCalendarReadContext) {
    const basis = read(attempt, calendar);
    if (basis.unavailableReasonOrNull != null) return fail(basis.unavailableReasonOrNull);
    if (request.preparation.kind === 'LIFE_STATE_ROLL') {
      const input = npcLifeStateRollRequestInputValue(request.preparation.input);
      equal(input.capabilityKey, key(basis), 'life capability changed');
      if (
        basis.rollFactOrNull !== null ||
        basis.previousKindOrNull === 'SEVERELY_WOUNDED' ||
        basis.previousKindOrNull === 'DEAD'
      )
        return fail('the actual life roll or terminal state is already retained');
      if (
        (basis.mode === 'AUTO' && input.manualFaceOrNull !== null) ||
        (basis.mode === 'MANUAL' && input.manualFaceOrNull === null)
      )
        return fail('face must match the current authenticated roll mode');
      return { kind: 'ROLL' as const, basis, input };
    }
    if (request.preparation.kind !== 'LIFE_STATE_SET')
      return fail('life preparation request required');
    const input = npcLifeStateSetRequestInputValue(request.preparation.input);
    equal(input.capabilityKey, key(basis), 'life capability changed');
    assertNpcFormalLifeTransition(options.catalog, basis.previousKindOrNull, input.lifeKind);
    const hp = basis.draft.initialState.currentHP;
    if (hp.kind !== 'ENTERED' || (input.lifeKind === 'ALIVE' ? hp.value <= 0 : hp.value !== 0))
      return fail('explicit current HP does not match the selected life state');
    const retained =
      input.lifeKind === 'SEVERELY_WOUNDED' && basis.previousKindOrNull === 'SEVERELY_WOUNDED';
    if (retained) {
      if (input.remainingMinutesOrNull !== null)
        return fail('retained death deadline cannot be reset');
    } else if (input.lifeKind === 'SEVERELY_WOUNDED') {
      const limit = maximum(basis);
      if (basis.clock.campaignTimestampOrNull === null || limit === null)
        return fail('severe assignment requires confirmed time and the real prepared D6');
      readNpcFormalLifeRemaining(input.remainingMinutesOrNull, Number(limit));
    }
    return {
      kind: 'SET' as const,
      basis,
      input,
      allocateTimer: input.lifeKind === 'SEVERELY_WOUNDED' && !retained,
    };
  }
  function values(basis: NpcLifePreparationBasis, operationId: string): JsonObject {
    return json(
      readNpcEditorDraft(basis.editor, {
        ...basis.draft,
        initialState: {
          ...basis.draft.initialState,
          lifeStateConfirmationId: { kind: 'ENTERED', value: s.uuid(operationId) },
        },
      }),
    );
  }
  return {
    selection,
    requiresTime(attempt: NpcAttempt, calendar: NpcCalendarReadContext): boolean {
      if (!options.enabled || !['NPC-016', 'NPC-017'].includes(attempt.stage)) return false;
      const basis = options.read(attempt, calendar);
      return basis.selectedInputOrNull === null
        ? basis.previousKindOrNull === 'SEVERELY_WOUNDED' || basis.rollFactOrNull !== null
        : basis.selectedInputOrNull.lifeKind === 'SEVERELY_WOUNDED';
    },
    inspect(attempt: NpcAttempt, calendar: NpcCalendarReadContext): NpcLifeStatePreparation | null {
      if (!options.enabled) return null;
      const basis = read(attempt, calendar),
        previous = basis.previousKindOrNull;
      const selected = basis.selectedInputOrNull;
      const choices: readonly NpcFormalLifeKind[] =
        previous === 'DEAD'
          ? ['DEAD']
          : previous === 'SEVERELY_WOUNDED'
            ? ['SEVERELY_WOUNDED', 'DEAD']
            : ['ALIVE', 'SEVERELY_WOUNDED', 'DEAD'];
      return {
        capabilityKey: key(basis),
        canRoll:
          basis.unavailableReasonOrNull == null &&
          basis.rollFactOrNull === null &&
          previous !== 'SEVERELY_WOUNDED' &&
          previous !== 'DEAD',
        canSubmit:
          basis.unavailableReasonOrNull == null &&
          basis.draft.initialState.currentHP.kind === 'ENTERED',
        diceMode: basis.mode,
        lifeChoices: choices.map((value) => ({
          value,
          label: value === 'ALIVE' ? 'Жив' : value === 'DEAD' ? 'Мёртв' : 'Тяжело ранен',
        })),
        input: {
          lifeKind:
            selected === null ? { kind: 'UNSET' } : { kind: 'ENTERED', value: selected.lifeKind },
          reason:
            selected === null ? { kind: 'UNSET' } : { kind: 'ENTERED', value: selected.reason },
          remainingMinutes:
            selected?.remainingMinutesOrNull == null
              ? { kind: 'UNSET' }
              : { kind: 'ENTERED', value: selected.remainingMinutesOrNull },
        },
        retainedTimer: previous === 'SEVERELY_WOUNDED',
        rollOrNull:
          basis.rollFactOrNull === null
            ? null
            : {
                rawFace: basis.rollFactOrNull.fact.roll.rawFace,
                mode: basis.rollFactOrNull.source.modeSnapshot,
                receiptId: basis.rollFactOrNull.receiptId,
              },
        maximumRemainingMinutesOrNull: previous === 'SEVERELY_WOUNDED' ? null : maximum(basis),
        errors:
          basis.unavailableReasonOrNull == null
            ? {}
            : { lifeKind: [basis.unavailableReasonOrNull] },
        explanation:
          previous === 'SEVERELY_WOUNDED'
            ? 'Исходный таймер и бросок сохраняются. Обычная правка HP не реанимирует персонажа.'
            : 'Явно задайте текущее состояние и HP. Для тяжёлого ранения сначала сохраните настоящий D6, затем введите точный оставшийся срок; отказ ввода не перебрасывает D6.',
        derivedRows: [
          {
            label: 'Время кампании',
            value:
              basis.clock.campaignTimestampOrNull === null
                ? 'Не подтверждено'
                : String(basis.clock.campaignTimestampOrNull),
          },
        ],
      };
    },
    validate(request: Request, context: NpcAttemptPreparationContext) {
      selection(
        request,
        context.previousOrNull?.attempt ?? fail('missing actual predecessor'),
        context.calendarContext ?? fail('missing calendar'),
      );
    },
    prepare(
      request: Request,
      context: NpcAttemptPreparationContext,
      allocate: () => string,
      sample: RollFaceSampler,
      committedAt: string,
    ): NpcPreparedAttempt {
      const before = context.previousOrNull?.attempt ?? fail('missing actual predecessor');
      const chosen = selection(
        request,
        before,
        context.calendarContext ?? fail('missing calendar'),
      );
      if (chosen.kind === 'ROLL') {
        const fact = prepareNpcLifeRollFact(
          request.operationId,
          chosen.basis.mode,
          chosen.input.manualFaceOrNull,
          allocate,
          sample,
        );
        return {
          next: { ...before, revision: s.increment(before.revision) },
          receiptId: fact.receiptId,
          committedAt,
          lifeStateFact: fact,
        };
      }
      const timerId = chosen.allocateTimer ? allocate() : null;
      return {
        next: {
          ...before,
          revision: s.increment(before.revision),
          values: values(chosen.basis, request.operationId),
        },
        receiptId: allocate(),
        committedAt,
        ...(timerId === null
          ? {}
          : {
              childAllocations: [
                { kind: 'EFFECT_INSTANCE', id: timerId, sourceKind: 'LIFE_TIMER' },
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
        return fail('actual life request required');
      equal(
        [context.scope, context.npcDraftId, context.revision],
        [previous.attempt.scope, previous.attempt.npcDraftId, previous.attempt.revision],
        'life predecessor',
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
        'life transition',
      );
      if (chosen.kind === 'ROLL') {
        equal(children, [], 'roll has no effect allocation');
        const fact = npcEventLifeStateFact(event) ?? fail('actual D6 missing');
        verifyNpcLifeRollOutcome(fact, chosen.basis.mode, chosen.input.manualFaceOrNull);
        return json(chosen.basis.draft);
      }
      if (chosen.allocateTimer) {
        if (children.length !== 1) return fail('one severe timer allocation required');
        equal(
          children[0],
          { kind: 'EFFECT_INSTANCE', id: children[0]!.id, sourceKind: 'LIFE_TIMER' },
          'actual life timer source',
        );
      } else equal(children, [], 'untimed or retained life state allocates no timer');
      return values(chosen.basis, operation.operationId);
    },
  };
}
