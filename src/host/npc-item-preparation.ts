import type { JsonObject } from '@shared/wire-protocol.js';
import type { DiseaseId } from '@generated/types/effects.js';
import { npcWoundPreparationRequestInputValue } from '@shared/npc-command.js';
import { equipmentCompatibilityPreparationRequestInputValue } from '@shared/npc-command.js';
import { deriveNpcArmorContribution } from '../domain/rules/npc-authoring/inventory.js';
import type { NpcArmorCompatibilityProof } from '../domain/rules/npc-authoring/equipment-profile.js';
import { prepareNpcWoundFact } from './npc-wound-preparation.js';
import type { NpcDiseaseCodecCatalog } from '../domain/rules/npc-authoring/periodic-disease-effects.js';
import {
  applyNpcStageInput,
  createEmptyNpcInventoryEditorRow,
  createEmptyNpcTraumaEditorRow,
  createEmptyNpcSymbiontEditorRow,
  readNpcEditorDraft,
  projectNpcInventoryRequest,
  type NpcEditorCatalog,
} from '../domain/rules/npc-authoring/staged-input.js';
import type { NpcInventoryCatalog } from '../domain/rules/npc-authoring/inventory.js';
import {
  npcLinkedSetBindingValue,
  type NpcLinkedSetBinding,
  type NpcAttemptReadContext,
} from '../persistence/npc-child-identities.js';
import { npcCompositeItemReservationInputValue } from '../shared/npc-command.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';

/** Builds only this checked attempt's bindings. No query, UUID allocation, roll or gameplay default. */
export function npcEditorForItemAttempt(
  base: NpcEditorCatalog,
  inventory: NpcInventoryCatalog,
  context: NpcAttemptReadContext | null,
): NpcEditorCatalog {
  if (context === null)
    return {
      skills: base.skills,
      development: base.development,
      composition: [],
      ...(base.traumas === undefined
        ? {}
        : { traumas: { catalog: base.traumas.catalog, bindings: [] } }),
    };
  return {
    skills: base.skills,
    development: base.development,
    wounds: [
      ...context.woundBindings.map((b) => b.woundInstanceId),
      ...(context.pendingWoundOrNull === null ? [] : [context.pendingWoundOrNull.woundInstanceId]),
    ],
    composition: [
      ...context.symbiontBindings.map((b) => ({
        symbiontInstanceId: b.symbiontInstanceId,
        speciesKeyOrNull: b.retainedSpeciesKeyOrNull,
        retired: false,
      })),
      ...(context.pendingSymbiontOrNull === null
        ? []
        : [
            {
              symbiontInstanceId: context.pendingSymbiontOrNull.symbiontInstanceId,
              speciesKeyOrNull: null,
              retired: false,
            },
          ]),
    ],
    ...(base.traumas === undefined
      ? {}
      : {
          traumas: {
            catalog: base.traumas.catalog,
            bindings: [
              ...context.traumaBindings.map((b) => ({
                traumaInstanceId: b.traumaInstanceId,
                retainedRowOrNull: b.retainedRowOrNull,
              })),
              ...(context.pendingTraumaOrNull === null
                ? []
                : [
                    {
                      traumaInstanceId: context.pendingTraumaOrNull.traumaInstanceId,
                      retainedRowOrNull: null,
                    },
                  ]),
            ],
          },
        }),
    effects: [
      ...(context.runtimeEffectBindings ?? [])
        .filter(
          (binding) =>
            binding.sourceKind !== 'LIFE_TIMER' &&
            binding.sourceKind !== 'WEAVER_STATE' &&
            binding.sourceKind !== 'POISON_MODE',
        )
        .map((binding) =>
          'sourceInstanceId' in binding
            ? {
                effectInstanceId: binding.effectInstanceId,
                sourceKind: binding.sourceKind,
                mode: binding.mode,
                sourceInstanceId: binding.sourceInstanceId,
              }
            : binding.sourceKind === 'FORMAL_CONTROL'
              ? {
                  effectInstanceId: binding.effectInstanceId,
                  sourceKind: binding.sourceKind,
                  controlKind: binding.controlKind,
                }
              : { effectInstanceId: binding.effectInstanceId, sourceKind: binding.sourceKind },
        ),
      ...((context.pendingRuntimeEffectOrNull ?? null) === null ||
      context.pendingRuntimeEffectOrNull?.sourceKind === 'LIFE_TIMER' ||
      context.pendingRuntimeEffectOrNull?.sourceKind === 'WEAVER_STATE' ||
      context.pendingRuntimeEffectOrNull?.sourceKind === 'POISON_MODE'
        ? []
        : [context.pendingRuntimeEffectOrNull!]),
      ...context.effectBindings.map(({ effectInstanceId, diseaseId }) => ({
        effectInstanceId,
        diseaseId,
      })),
      ...(context.pendingEffectOrNull === null
        ? []
        : [
            {
              effectInstanceId: context.pendingEffectOrNull.effectInstanceId,
              diseaseId: context.pendingEffectOrNull.diseaseId,
            },
          ]),
    ],
    inventory: {
      catalog: inventory,
      itemInstanceIds: [
        ...context.itemBindings.map((b) => b.itemInstanceId),
        ...(context.pendingItemOrNull === null ? [] : [context.pendingItemOrNull.itemInstanceId]),
        ...(context.pendingCompositeOrNull?.components.map((part) => part.itemInstanceId) ?? []),
        ...(context.pendingCustomProfileOrNull?.newItem === true
          ? [context.pendingCustomProfileOrNull.itemInstanceId]
          : []),
      ],
      ...((context.customProfiles ?? []).length === 0 &&
      (context.pendingCustomProfileOrNull ?? null) === null
        ? {}
        : {
            customProfiles: [
              ...(context.customProfiles ?? []),
              ...(context.pendingCustomProfileOrNull === undefined ||
              context.pendingCustomProfileOrNull === null
                ? []
                : [
                    {
                      itemInstanceId: context.pendingCustomProfileOrNull.itemInstanceId,
                      reference: context.pendingCustomProfileOrNull.reference,
                      confirmedContentOrNull: null,
                    },
                  ]),
            ],
          }),
      // No quality, coating or composite fact is produced by an ITEM reservation.
      linkedSetInstanceIds: [
        ...(context.linkedSets ?? []).map((set) => set.linkedSetInstanceId),
        ...(context.pendingCompositeOrNull === undefined || context.pendingCompositeOrNull === null
          ? []
          : [context.pendingCompositeOrNull.linkedSetInstanceId]),
      ],
      ...((context.linkedSets ?? []).length === 0 &&
      (context.pendingCompositeOrNull ?? null) === null
        ? {}
        : {
            linkedSets: [
              ...(context.linkedSets ?? []),
              ...(context.pendingCompositeOrNull === undefined ||
              context.pendingCompositeOrNull === null
                ? []
                : [context.pendingCompositeOrNull]),
            ],
          }),
      coatingBindings: [
        ...(context.coatingBindings ?? []).map(({ coatingInstanceId, itemInstanceId }) => ({
          coatingInstanceId,
          itemInstanceId,
        })),
        ...(context.pendingCoatingOrNull === undefined || context.pendingCoatingOrNull === null
          ? []
          : [
              {
                coatingInstanceId: context.pendingCoatingOrNull.coatingInstanceId,
                itemInstanceId: context.pendingCoatingOrNull.itemInstanceId,
              },
            ]),
      ],
      qualityBindings: [],
    },
  };
}
function json(value: unknown): JsonObject {
  return s.object(JSON.parse(s.canonical(value)) as unknown) as JsonObject;
}
export function createNpcItemPreparation(base: NpcEditorCatalog, inventory: NpcInventoryCatalog) {
  const preflight = (
    previous: JsonObject,
    input: JsonObject,
    context: NpcAttemptReadContext,
  ): JsonObject => {
    if (
      context.pendingItemOrNull !== null ||
      context.pendingEffectOrNull !== null ||
      context.pendingTraumaOrNull !== null ||
      context.pendingSymbiontOrNull !== null ||
      context.pendingWoundOrNull !== null ||
      (context.pendingRuntimeEffectOrNull ?? null) !== null ||
      (context.pendingCompositeOrNull ?? null) !== null
    )
      return s.fail('INVALID_INPUT');
    return json(
      applyNpcStageInput(
        npcEditorForItemAttempt(base, inventory, context),
        previous,
        'NPC-015',
        input,
      ),
    );
  };
  return Object.freeze({
    /** Storage invokes this after source guards but before the allocation factory. */
    validate(previous: JsonObject, input: JsonObject, context: NpcAttemptReadContext): void {
      preflight(previous, input, context);
    },
    read(values: unknown, context: NpcAttemptReadContext | null): JsonObject {
      return json(readNpcEditorDraft(npcEditorForItemAttempt(base, inventory, context), values));
    },
    /** Used identically by the lazy factory and the immutable historical reducer. */
    apply(
      previous: JsonObject,
      input: JsonObject,
      itemInstanceId: string,
      context: NpcAttemptReadContext,
      operationId: string,
    ): JsonObject {
      const saved = preflight(previous, input, context);
      if (
        context.itemBindings.some((b) => b.itemInstanceId === itemInstanceId) ||
        context.effectBindings.some((b) => b.effectInstanceId === itemInstanceId) ||
        context.traumaBindings.some((b) => b.traumaInstanceId === itemInstanceId) ||
        context.symbiontBindings.some((b) => b.symbiontInstanceId === itemInstanceId)
      )
        return s.fail('IDEMPOTENCY_CONFLICT');
      const pending: NpcAttemptReadContext = {
        ...context,
        operationId: s.uuid(operationId),
        revision: s.increment(context.revision),
        pendingItemOrNull: {
          itemInstanceId: s.uuid(itemInstanceId),
          operationId: s.uuid(operationId),
          npcDraftId: context.npcDraftId,
        },
      };
      const catalog = npcEditorForItemAttempt(base, inventory, pending);
      const draft = readNpcEditorDraft(catalog, saved);
      const row = createEmptyNpcInventoryEditorRow(catalog, itemInstanceId);
      return json({
        ...draft,
        inventory: {
          kind: 'ENTERED',
          value: [...(draft.inventory.kind === 'ENTERED' ? draft.inventory.value : []), row],
        },
      });
    },
  });
}

export function createNpcCompositeItemPreparation(
  base: NpcEditorCatalog,
  inventory: NpcInventoryCatalog,
) {
  function preflight(previous: JsonObject, input: unknown, context: NpcAttemptReadContext) {
    if (
      context.pendingItemOrNull !== null ||
      context.pendingEffectOrNull !== null ||
      context.pendingTraumaOrNull !== null ||
      context.pendingSymbiontOrNull !== null ||
      context.pendingWoundOrNull !== null ||
      (context.pendingRuntimeEffectOrNull ?? null) !== null ||
      (context.pendingCompositeOrNull ?? null) !== null
    )
      return s.fail('INVALID_INPUT');
    const selection = npcCompositeItemReservationInputValue(input);
    const definition =
      inventory.definitions.find((d) => d.itemTypeId === selection.itemTypeId) ??
      s.fail('INVALID_INPUT');
    if (definition.inventoryAllowed !== true || definition.category !== 'Оружие')
      return s.fail('INVALID_INPUT');
    return {
      selection,
      draft: readNpcEditorDraft(npcEditorForItemAttempt(base, inventory, context), previous),
    };
  }
  return Object.freeze({
    validate(previous: JsonObject, input: unknown, context: NpcAttemptReadContext): void {
      preflight(previous, input, context);
    },
    apply(
      previous: JsonObject,
      input: unknown,
      binding: NpcLinkedSetBinding,
      context: NpcAttemptReadContext,
      operationId: string,
    ): JsonObject {
      const { selection, draft } = preflight(previous, input, context);
      const set = npcLinkedSetBindingValue(binding);
      if (set.itemTypeId !== selection.itemTypeId) return s.fail('INVALID_INPUT');
      const occupied = [
        ...context.itemBindings.map((b) => b.itemInstanceId),
        ...(context.linkedSets ?? []).map((b) => b.linkedSetInstanceId),
      ];
      if (
        [set.linkedSetInstanceId, ...set.components.map((c) => c.itemInstanceId)].some((id) =>
          occupied.includes(id),
        )
      )
        return s.fail('IDEMPOTENCY_CONFLICT');
      const pending: NpcAttemptReadContext = {
        ...context,
        revision: s.increment(context.revision),
        operationId: s.uuid(operationId),
        pendingCompositeOrNull: set,
      };
      const editor = npcEditorForItemAttempt(base, inventory, pending);
      const rows = set.components.map((component) =>
        createEmptyNpcInventoryEditorRow(editor, component.itemInstanceId),
      );
      const next = {
        ...draft,
        inventory: {
          kind: 'ENTERED' as const,
          value: [...(draft.inventory.kind === 'ENTERED' ? draft.inventory.value : []), ...rows],
        },
      };
      return json(readNpcEditorDraft(editor, next));
    },
  });
}

/** An owned selectable intent only: no EffectInstance, calendar, HP mutation or implicit selection. */
export function createNpcDiseasePreparation(
  base: NpcEditorCatalog,
  inventory: NpcInventoryCatalog,
  diseases: NpcDiseaseCodecCatalog,
) {
  const validate = (
    previous: JsonObject,
    diseaseId: DiseaseId,
    context: NpcAttemptReadContext,
  ): void => {
    if (
      context.pendingItemOrNull !== null ||
      context.pendingEffectOrNull !== null ||
      context.pendingTraumaOrNull !== null ||
      context.pendingSymbiontOrNull !== null ||
      context.pendingWoundOrNull !== null ||
      (context.pendingRuntimeEffectOrNull ?? null) !== null ||
      (context.pendingCompositeOrNull ?? null) !== null
    )
      return s.fail('INVALID_INPUT');
    if (
      diseaseId !== 'DIS-PNEUMONIA' &&
      !diseases.nonperiodic.diseaseIds.some((id) => id === diseaseId)
    )
      return s.fail('UNAVAILABLE');
    readNpcEditorDraft(npcEditorForItemAttempt(base, inventory, context), previous);
  };
  return Object.freeze({
    choices: Object.freeze(
      diseases.nonperiodic.initialEffects.diseases
        .filter(
          (d) =>
            d.status === 'ACTIVE' &&
            (d.diseaseId === 'DIS-PNEUMONIA' ||
              diseases.nonperiodic.diseaseIds.some((id) => id === d.diseaseId)),
        )
        .map((d) => {
          if (d.diseaseId === 'DIS-PESTILENCE') return s.fail('UNAVAILABLE');
          return Object.freeze({ diseaseId: d.diseaseId, nameRu: d.nameRu });
        }),
    ),
    validate,
    apply(
      previous: JsonObject,
      diseaseId: DiseaseId,
      effectInstanceId: string,
      context: NpcAttemptReadContext,
      operationId: string,
    ): JsonObject {
      validate(previous, diseaseId, context);
      if (
        context.effectBindings.some((e) => e.effectInstanceId === effectInstanceId) ||
        context.itemBindings.some((e) => e.itemInstanceId === effectInstanceId) ||
        context.traumaBindings.some((e) => e.traumaInstanceId === effectInstanceId) ||
        context.symbiontBindings.some((e) => e.symbiontInstanceId === effectInstanceId)
      )
        return s.fail('IDEMPOTENCY_CONFLICT');
      const pending: NpcAttemptReadContext = {
        ...context,
        operationId: s.uuid(operationId),
        revision: s.increment(context.revision),
        pendingEffectOrNull: {
          effectInstanceId: s.uuid(effectInstanceId),
          diseaseId,
          operationId: s.uuid(operationId),
          npcDraftId: context.npcDraftId,
        },
      };
      return json(readNpcEditorDraft(npcEditorForItemAttempt(base, inventory, pending), previous));
    },
  });
}

/** Only a reserved identity and partial editor row; no TraumaInstance, played damage or timestamp. */
export function createNpcTraumaPreparation(base: NpcEditorCatalog, inventory: NpcInventoryCatalog) {
  const validate = (previous: JsonObject, context: NpcAttemptReadContext): void => {
    if (
      base.traumas === undefined ||
      context.pendingItemOrNull !== null ||
      context.pendingEffectOrNull !== null ||
      context.pendingTraumaOrNull !== null ||
      context.pendingSymbiontOrNull !== null ||
      context.pendingWoundOrNull !== null ||
      (context.pendingRuntimeEffectOrNull ?? null) !== null ||
      (context.pendingCompositeOrNull ?? null) !== null
    )
      return s.fail('INVALID_INPUT');
    readNpcEditorDraft(npcEditorForItemAttempt(base, inventory, context), previous);
  };
  return Object.freeze({
    validate,
    apply(
      previous: JsonObject,
      traumaInstanceId: string,
      context: NpcAttemptReadContext,
      operationId: string,
    ): JsonObject {
      validate(previous, context);
      if (
        context.traumaBindings.some((b) => b.traumaInstanceId === traumaInstanceId) ||
        context.effectBindings.some((b) => b.effectInstanceId === traumaInstanceId) ||
        context.itemBindings.some((b) => b.itemInstanceId === traumaInstanceId) ||
        context.symbiontBindings.some((b) => b.symbiontInstanceId === traumaInstanceId)
      )
        return s.fail('IDEMPOTENCY_CONFLICT');
      const pending: NpcAttemptReadContext = {
        ...context,
        operationId: s.uuid(operationId),
        revision: s.increment(context.revision),
        pendingTraumaOrNull: {
          traumaInstanceId: s.uuid(traumaInstanceId),
          operationId: s.uuid(operationId),
          npcDraftId: context.npcDraftId,
        },
      };
      const catalog = npcEditorForItemAttempt(base, inventory, pending),
        draft = readNpcEditorDraft(catalog, previous);
      return json(
        readNpcEditorDraft(catalog, {
          ...draft,
          initialState: {
            ...draft.initialState,
            traumaInputs: {
              kind: 'ENTERED',
              value: [
                ...(draft.initialState.traumaInputs?.kind === 'ENTERED'
                  ? draft.initialState.traumaInputs.value
                  : []),
                createEmptyNpcTraumaEditorRow(traumaInstanceId),
              ],
            },
          },
        }),
      );
    },
  });
}

/** An allocated technical row only; acquisition and learned mechanics require a separate explicit confirmation. */
export function createNpcSymbiontPreparation(
  base: NpcEditorCatalog,
  inventory: NpcInventoryCatalog,
) {
  const preflight = (
    previous: JsonObject,
    input: JsonObject,
    context: NpcAttemptReadContext,
  ): JsonObject => {
    if (
      context.pendingItemOrNull !== null ||
      context.pendingEffectOrNull !== null ||
      context.pendingTraumaOrNull !== null ||
      context.pendingSymbiontOrNull !== null ||
      context.pendingWoundOrNull !== null ||
      (context.pendingRuntimeEffectOrNull ?? null) !== null ||
      (context.pendingCompositeOrNull ?? null) !== null
    )
      return s.fail('INVALID_INPUT');
    const catalog = npcEditorForItemAttempt(base, inventory, context);
    const before = readNpcEditorDraft(catalog, previous),
      next = applyNpcStageInput(catalog, before, 'NPC-013', input);
    if (!s.same(before.symbionts, next.symbionts)) return s.fail('STALE_REVISION');
    return json(next);
  };
  return Object.freeze({
    validate(previous: JsonObject, input: JsonObject, context: NpcAttemptReadContext): void {
      preflight(previous, input, context);
    },
    apply(
      previous: JsonObject,
      input: JsonObject,
      symbiontInstanceId: string,
      context: NpcAttemptReadContext,
      operationId: string,
    ): JsonObject {
      const saved = preflight(previous, input, context);
      if (
        context.itemBindings.some((b) => b.itemInstanceId === symbiontInstanceId) ||
        context.effectBindings.some((b) => b.effectInstanceId === symbiontInstanceId) ||
        context.traumaBindings.some((b) => b.traumaInstanceId === symbiontInstanceId) ||
        context.symbiontBindings.some((b) => b.symbiontInstanceId === symbiontInstanceId)
      )
        return s.fail('IDEMPOTENCY_CONFLICT');
      const pending: NpcAttemptReadContext = {
        ...context,
        operationId: s.uuid(operationId),
        revision: s.increment(context.revision),
        pendingSymbiontOrNull: {
          symbiontInstanceId: s.uuid(symbiontInstanceId),
          operationId: s.uuid(operationId),
          npcDraftId: context.npcDraftId,
        },
      };
      const catalog = npcEditorForItemAttempt(base, inventory, pending),
        draft = readNpcEditorDraft(catalog, saved);
      return json(
        readNpcEditorDraft(catalog, {
          ...draft,
          symbionts: {
            kind: 'ENTERED',
            value: [
              ...(draft.symbionts.kind === 'ENTERED' ? draft.symbionts.value : []),
              createEmptyNpcSymbiontEditorRow(catalog, symbiontInstanceId),
            ],
          },
        }),
      );
    },
  });
}

/** A prepared wound is an explicit initial-state assignment, with no HP/time side effect. */
/** Physical approval binds the actual ordered source loadout, not item IDs proposed by the client. */
export function createNpcEquipmentCompatibilityPreparation(
  base: NpcEditorCatalog,
  inventory: NpcInventoryCatalog,
) {
  const inspect = (previous: JsonObject, context: NpcAttemptReadContext) => {
    if (
      context.pendingItemOrNull !== null ||
      context.pendingEffectOrNull !== null ||
      context.pendingTraumaOrNull !== null ||
      context.pendingSymbiontOrNull !== null ||
      context.pendingWoundOrNull !== null ||
      (context.pendingRuntimeEffectOrNull ?? null) !== null ||
      (context.pendingCompositeOrNull ?? null) !== null
    )
      return s.fail('INVALID_INPUT');
    const editor = npcEditorForItemAttempt(base, inventory, context),
      draft = readNpcEditorDraft(editor, previous);
    const request = projectNpcInventoryRequest(editor, draft.inventory);
    // Physical approval needs source armor geometry, not weapon RETAIN or coating/life closure.
    // The exact whole loadout still binds this confirmation; final publication validates it all.
    const armor = deriveNpcArmorContribution(
      inventory,
      request.flatMap((item) =>
        item.itemTypeId !== null &&
        item.equipped &&
        inventory.definitions.some(
          (definition) =>
            definition.itemTypeId === item.itemTypeId && definition.armorOrNull !== null,
        )
          ? [
              {
                itemInstanceId: item.itemInstanceId,
                itemTypeId: item.itemTypeId,
                bodyZoneOrNull: item.bodyZone,
                sealedOrNull: item.sealed,
              },
            ]
          : [],
      ),
    );
    const ids = armor.compatibilityRequiredItemIds;
    return {
      draft,
      request,
      orderedItems: ids.map((id) => ({
        itemInstanceId: id,
        label: request.find((r) => r.itemInstanceId === id)?.itemTypeId ?? s.fail(),
      })),
      capabilityKey: s.sha(
        s.canonical({
          kind: 'EQUIPMENT_COMPATIBILITY_CONFIRM',
          scope: context.scope,
          npcUuid: context.candidateNpcUuid,
          npcDraftId: context.npcDraftId,
          revision: context.revision,
          sourceOperationId: context.operationId,
          request,
        }),
      ),
    };
  };
  const checked = (previous: JsonObject, input: unknown, context: NpcAttemptReadContext) => {
    const actual = inspect(previous, context),
      request = equipmentCompatibilityPreparationRequestInputValue(input);
    if (actual.orderedItems.length === 0 || request.capabilityKey !== actual.capabilityKey)
      return s.fail('SOURCE_CHANGED');
    return { actual, request };
  };
  return Object.freeze({
    inspect,
    validate(previous: JsonObject, input: unknown, context: NpcAttemptReadContext): void {
      checked(previous, input, context);
    },
    apply(previous: JsonObject, input: unknown, context: NpcAttemptReadContext): JsonObject {
      return json(checked(previous, input, context).actual.draft);
    },
    proof(
      previous: JsonObject,
      input: unknown,
      context: NpcAttemptReadContext,
      operationId: string,
    ): NpcArmorCompatibilityProof {
      const { actual, request } = checked(previous, input, context);
      return {
        confirmationId: s.uuid(operationId),
        npcUuid: context.candidateNpcUuid,
        itemInstanceIds: actual.orderedItems.map((i) => i.itemInstanceId),
        reason: request.reason,
      };
    },
  });
}
export function createNpcWoundPreparation(base: NpcEditorCatalog, inventory: NpcInventoryCatalog) {
  const preflight = (previous: JsonObject, input: unknown, context: NpcAttemptReadContext) => {
    if (
      context.pendingItemOrNull !== null ||
      context.pendingEffectOrNull !== null ||
      context.pendingTraumaOrNull !== null ||
      context.pendingSymbiontOrNull !== null ||
      context.pendingWoundOrNull !== null ||
      (context.pendingRuntimeEffectOrNull ?? null) !== null ||
      (context.pendingCompositeOrNull ?? null) !== null
    )
      return s.fail('INVALID_INPUT');
    const draft = readNpcEditorDraft(npcEditorForItemAttempt(base, inventory, context), previous);
    if (
      draft.schema.anatomyProfileId.kind !== 'ENTERED' ||
      draft.schema.anatomyProfileId.value !== 'STANDARD_HUMANOID'
    )
      return s.fail('INVALID_INPUT');
    return { draft, input: npcWoundPreparationRequestInputValue(input) };
  };
  return Object.freeze({
    validate(previous: JsonObject, input: unknown, context: NpcAttemptReadContext): void {
      preflight(previous, input, context);
    },
    apply(
      previous: JsonObject,
      input: unknown,
      woundInstanceId: string,
      context: NpcAttemptReadContext,
      operationId: string,
    ): JsonObject {
      const { draft, input: parsed } = preflight(previous, input, context);
      prepareNpcWoundFact(
        {
          npcUuid: context.candidateNpcUuid,
          operationId,
          woundInstanceId,
          anatomyProfileId: 'STANDARD_HUMANOID',
        },
        parsed,
      );
      const pending: NpcAttemptReadContext = {
        ...context,
        revision: s.increment(context.revision),
        operationId: s.uuid(operationId),
        pendingWoundOrNull: {
          woundInstanceId: s.uuid(woundInstanceId),
          operationId: s.uuid(operationId),
          npcDraftId: context.npcDraftId,
        },
      };
      const selected = draft.initialState.woundInstanceIds;
      return json(
        readNpcEditorDraft(npcEditorForItemAttempt(base, inventory, pending), {
          ...draft,
          initialState: {
            ...draft.initialState,
            woundInstanceIds: {
              kind: 'ENTERED',
              value: [...(selected.kind === 'ENTERED' ? selected.value : []), woundInstanceId],
            },
          },
        }),
      );
    },
  });
}
