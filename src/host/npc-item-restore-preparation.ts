import type { NpcPreparationRequest } from '@shared/npc-command.js';
import { npcTechnicalRequestValue } from '@shared/npc-command.js';
import type { NpcItemRestorePreparation } from '@shared/npc-presentation.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import {
  applyNpcStageInput,
  readNpcEditorDraft,
  restoreNpcInventoryEditorRows,
  type NpcEditorCatalog,
} from '../domain/rules/npc-authoring/staged-input.js';
import type {
  NpcInventoryCatalog,
  NpcInventoryRequestEntry,
} from '../domain/rules/npc-authoring/inventory.js';
import {
  listNpcInventoryRestoreChoices,
  selectNpcInventoryRestoreRequests,
  type NpcInventoryPublicationCatalog,
  type NpcInventoryPublicationContext,
} from '../domain/rules/npc-authoring/inventory-publication.js';
import type { NpcAttemptReadContext } from '../persistence/npc-child-identities.js';
import type { NpcAttempt, NpcCalendarReadContext } from '../persistence/npc-library-records.js';
import type {
  NpcAttemptPreparationContext,
  NpcPreparedAttempt,
} from '../persistence/npc-library-store.js';
import type { NpcCompositionAuthoringApply } from '../persistence/npc-gm-source.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import { npcEditorForItemAttempt } from './npc-item-preparation.js';

type Restore = Extract<NpcPreparationRequest['preparation'], { kind: 'ITEM_RESTORE' }>;
function json(value: unknown): JsonObject {
  return s.object(JSON.parse(s.canonical(value)) as unknown) as JsonObject;
}
function input(request: NpcPreparationRequest): Restore {
  if (request.sourceFormId !== 'NPC-015' || request.preparation.kind !== 'ITEM_RESTORE')
    return s.fail('INVALID_INPUT');
  return request.preparation;
}

/** A restore selects immutable same-NPC history; it neither allocates nor republishes an item. */
export function createNpcItemRestorePreparation(
  options: Readonly<{
    editor: NpcEditorCatalog;
    inventory: NpcInventoryCatalog;
    publication: NpcInventoryPublicationCatalog;
    history: (
      attempt: NpcAttempt,
      calendar: NpcCalendarReadContext,
    ) => NpcInventoryPublicationContext;
    bind: (
      attempt: NpcAttempt,
      context: NpcAttemptReadContext,
      requests: readonly NpcInventoryRequestEntry[],
      calendar: NpcCalendarReadContext,
    ) => NpcAttemptReadContext;
  }>,
) {
  function basis(
    attempt: NpcAttempt,
    context: NpcAttemptReadContext,
    calendar: NpcCalendarReadContext,
  ) {
    if (
      attempt.status !== 'OPEN' ||
      attempt.stage !== 'NPC-015' ||
      attempt.mode !== 'APPEND_N_PLUS_ONE' ||
      attempt.targetOrNull === null ||
      !s.same(
        [context.scope, context.npcDraftId, context.candidateNpcUuid, context.revision],
        [attempt.scope, attempt.npcDraftId, attempt.candidateNpcUuid, attempt.revision],
      )
    )
      return s.fail('UNAVAILABLE');
    const editor = npcEditorForItemAttempt(options.editor, options.inventory, context);
    const draft = readNpcEditorDraft(editor, attempt.values);
    const history = options.history(attempt, calendar);
    const scope = {
      npcUuid: attempt.candidateNpcUuid,
      selectedItemInstanceIds:
        draft.inventory.kind === 'ENTERED'
          ? draft.inventory.value.map((row) => row.itemInstanceId)
          : [],
    };
    const choices = listNpcInventoryRestoreChoices(options.publication, history, scope);
    const capabilityKey = s.sha(
      s.canonical({
        scope: attempt.scope,
        npcDraftId: attempt.npcDraftId,
        revision: attempt.revision,
        target: attempt.targetOrNull,
        selected: scope.selectedItemInstanceIds,
        history: history.history.map(({ publication: _publication, ...reference }) => reference),
        choices,
      }),
    );
    return { editor, draft, history, scope, choices, capabilityKey };
  }
  function selected(
    request: NpcPreparationRequest,
    attempt: NpcAttempt,
    context: NpcAttemptReadContext,
    calendar: NpcCalendarReadContext,
  ) {
    const restore = input(request),
      before = basis(attempt, context, calendar);
    if (restore.capabilityKey !== before.capabilityKey) return s.fail('SOURCE_CHANGED');
    // Local unsent edits remain ordinary NPC-015 inputs. They cannot turn a hidden,
    // currently selected historical item into an offered restore capability.
    if (!before.choices.some((choice) => choice.itemInstanceId === restore.itemInstanceId))
      return s.fail('UNAVAILABLE');
    const draft = applyNpcStageInput(before.editor, attempt.values, 'NPC-015', restore.values);
    const scope = {
      ...before.scope,
      selectedItemInstanceIds:
        draft.inventory.kind === 'ENTERED'
          ? draft.inventory.value.map((row) => row.itemInstanceId)
          : [],
    };
    const requests = selectNpcInventoryRestoreRequests(
      options.publication,
      before.history,
      scope,
      restore.itemInstanceId,
    );
    const bound = options.bind(attempt, context, requests, calendar);
    const editor = npcEditorForItemAttempt(options.editor, options.inventory, bound);
    const inventory = restoreNpcInventoryEditorRows(editor, json(draft.inventory), requests);
    const values = json(readNpcEditorDraft(editor, { ...draft, inventory }));
    return values;
  }
  return {
    inspect(
      attempt: NpcAttempt,
      context: NpcAttemptReadContext,
      calendar: NpcCalendarReadContext,
    ): NpcItemRestorePreparation | null {
      if (attempt.mode !== 'APPEND_N_PLUS_ONE') return null;
      const current = basis(attempt, context, calendar);
      return {
        capabilityKey: current.capabilityKey,
        choices: current.choices.map((choice) => {
          const [first] = selectNpcInventoryRestoreRequests(
            options.publication,
            current.history,
            current.scope,
            choice.itemInstanceId,
          );
          if (first === undefined) return s.fail();
          const name =
            first.itemTypeId === null
              ? first.profile.name
              : (options.inventory.definitions.find((row) => row.itemTypeId === first.itemTypeId)
                  ?.name ?? s.fail());
          return {
            value: choice.itemInstanceId,
            label:
              choice.originKind === 'PENDING_PREPARATION'
                ? `${name} — подготовлен, ещё не опубликован`
                : name,
          };
        }),
        canSubmit: current.choices.length !== 0,
        errors: [],
        explanation:
          'Выберите существующий предмет из истории. Для опубликованного возвращается последнее сохранённое состояние; для ещё не опубликованного — фактическое состояние исходной подготовки. Составной комплект возвращается целиком, новые идентичности не создаются.',
      };
    },
    validate(request: NpcPreparationRequest, context: NpcAttemptPreparationContext) {
      selected(
        request,
        context.previousOrNull?.attempt ?? s.fail(),
        context.previousReadContextOrNull ?? s.fail(),
        context.calendarContext ?? s.fail(),
      );
    },
    prepare(
      request: NpcPreparationRequest,
      context: NpcAttemptPreparationContext,
      receiptId: string,
      committedAt: string,
    ): NpcPreparedAttempt {
      const previous = context.previousOrNull?.attempt ?? s.fail();
      return {
        next: {
          ...previous,
          revision: s.increment(previous.revision),
          values: selected(
            request,
            previous,
            context.previousReadContextOrNull ?? s.fail(),
            context.calendarContext ?? s.fail(),
          ),
        },
        receiptId,
        committedAt,
      };
    },
    apply(
      ...args: [...Parameters<NpcCompositionAuthoringApply>, NpcCalendarReadContext]
    ): JsonObject {
      const [operation, event, previous, context, calendar] = args;
      const request = npcTechnicalRequestValue(operation.request);
      if (
        request.messageType !== 'network.npc-preparation.request' ||
        !s.same('format' in event ? event.childAllocations : [], []) ||
        event.operationId !== operation.operationId ||
        event.attempt.revision !== previous.attempt.revision + 1
      )
        return s.fail();
      return selected(request, previous.attempt, context, calendar);
    },
  };
}
