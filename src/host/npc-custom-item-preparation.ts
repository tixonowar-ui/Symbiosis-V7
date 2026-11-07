import { npcTechnicalRequestValue, type NpcPreparationRequest } from '@shared/npc-command.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { NpcCustomInventoryPreparation } from '@shared/npc-presentation.js';
import {
  applyNpcStageInput,
  readNpcEditorDraft,
  createEmptyNpcCampaignCustomInventoryEditorRow,
  addEmptyNpcCatalogueCustomModifier,
  replaceNpcInventoryCustomProfileVersion,
  type NpcEditorCatalog,
} from '../domain/rules/npc-authoring/staged-input.js';
import type { NpcInventoryCatalog } from '../domain/rules/npc-authoring/inventory.js';
import {
  isNpcCampaignCustomPublicationAvailable,
  npcCustomBackpackTypeIds,
  type NpcInventoryPublicationCatalog,
} from '../domain/rules/npc-authoring/inventory-publication.js';
import {
  npcPendingCustomProfile,
  type NpcAttemptReadContext,
  type NpcChildAllocation,
} from '../persistence/npc-child-identities.js';
import type {
  NpcAttemptPreparationContext,
  NpcPreparedAttempt,
} from '../persistence/npc-library-store.js';
import type { NpcCompositionAuthoringApply } from '../persistence/npc-gm-source.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import { npcEditorForItemAttempt } from './npc-item-preparation.js';

type CustomPreparation = Extract<
  NpcPreparationRequest['preparation'],
  { kind: 'CUSTOM_ITEM_RESERVE' | 'CUSTOM_MODIFIER_RESERVE' | 'CUSTOM_PROFILE_VERSION_RESERVE' }
>;
function input(request: NpcPreparationRequest): CustomPreparation {
  if (
    request.sourceFormId !== 'NPC-015' ||
    !['CUSTOM_ITEM_RESERVE', 'CUSTOM_MODIFIER_RESERVE', 'CUSTOM_PROFILE_VERSION_RESERVE'].includes(
      request.preparation.kind,
    )
  )
    return s.fail('INVALID_INPUT');
  return request.preparation as CustomPreparation;
}
function json(value: unknown): JsonObject {
  return s.object(JSON.parse(s.canonical(value)) as unknown) as JsonObject;
}

/** Reservations add immutable identities only; explicit NPC-015 confirmation still owns content. */
export function createNpcCustomItemPreparation(
  base: NpcEditorCatalog,
  inventory: NpcInventoryCatalog,
  publication: NpcInventoryPublicationCatalog,
) {
  function preflight(
    previous: JsonObject,
    request: CustomPreparation,
    context: NpcAttemptReadContext,
  ) {
    if (!isNpcCampaignCustomPublicationAvailable(publication)) return s.fail('UNAVAILABLE');
    if (
      context.pendingItemOrNull !== null ||
      context.pendingEffectOrNull !== null ||
      context.pendingTraumaOrNull !== null ||
      context.pendingSymbiontOrNull !== null ||
      context.pendingWoundOrNull !== null ||
      (context.pendingRuntimeEffectOrNull ?? null) !== null ||
      (context.pendingCompositeOrNull ?? null) !== null ||
      (context.pendingCustomProfileOrNull ?? null) !== null
    )
      return s.fail('INVALID_INPUT');
    const catalog = npcEditorForItemAttempt(base, inventory, context),
      draft = applyNpcStageInput(catalog, previous, 'NPC-015', request.values);
    if (request.kind === 'CUSTOM_ITEM_RESERVE') return { draft, target: null, current: null };
    const target =
      draft.inventory.kind === 'ENTERED'
        ? draft.inventory.value.find((row) => row.itemInstanceId === request.itemInstanceId)
        : undefined;
    if (
      target === undefined ||
      !context.itemBindings.some((row) => row.itemInstanceId === request.itemInstanceId)
    )
      return s.fail('UNAVAILABLE');
    if (request.kind === 'CUSTOM_MODIFIER_RESERVE') {
      if (
        'itemTypeReference' in target ||
        target.customModifier !== undefined ||
        context.customProfiles?.some((binding) => binding.itemInstanceId === target.itemInstanceId)
      )
        return s.fail('UNAVAILABLE');
      const itemType = target.input.itemTypeId;
      if (
        itemType.kind !== 'ENTERED' ||
        !inventory.definitions.some(
          (row) => row.itemTypeId === itemType.value && row.inventoryAllowed,
        )
      )
        return s.fail('INVALID_INPUT');
      return { draft, target, current: null };
    }
    const reference =
      'itemTypeReference' in target ? target.itemTypeReference : target.customModifier?.reference;
    if (reference?.kind !== 'ENTERED') return s.fail('UNAVAILABLE');
    const current =
      context.customProfiles?.find(
        (binding) =>
          binding.itemInstanceId === target.itemInstanceId &&
          binding.reference.profileId === request.profileId &&
          binding.reference.profileVersionId === request.expectedProfileVersionId &&
          binding.confirmedContentOrNull !== null,
      ) ?? s.fail('UNAVAILABLE');
    if (
      !s.same(reference.value, current.reference) ||
      context.customProfiles?.some(
        (binding) =>
          binding.itemInstanceId === target.itemInstanceId &&
          binding.confirmedContentOrNull === null,
      )
    )
      return s.fail('UNAVAILABLE');
    return { draft, target, current };
  }
  function apply(
    previous: JsonObject,
    request: CustomPreparation,
    facts: readonly NpcChildAllocation[],
    context: NpcAttemptReadContext,
    operationId: string,
  ): JsonObject {
    const prepared = preflight(previous, request, context),
      pending = npcPendingCustomProfile(facts, context, operationId) ?? s.fail('INVALID_INPUT');
    if (request.kind === 'CUSTOM_ITEM_RESERVE') {
      if (!pending.newItem || pending.reference.kind !== 'CAMPAIGN_CUSTOM_PROFILE')
        return s.fail('INVALID_INPUT');
    } else {
      if (pending.newItem || pending.itemInstanceId !== request.itemInstanceId)
        return s.fail('INVALID_INPUT');
      if (request.kind === 'CUSTOM_MODIFIER_RESERVE') {
        if (pending.reference.kind !== 'CATALOG_CUSTOM_MODIFIER' || pending.reference.version !== 1)
          return s.fail('INVALID_INPUT');
      } else if (
        pending.reference.profileId !== request.profileId ||
        prepared.current === null ||
        pending.reference.version !== s.increment(prepared.current.reference.version)
      )
        return s.fail('INVALID_INPUT');
    }
    const nextContext = {
      ...context,
      revision: s.increment(context.revision),
      operationId,
      pendingCustomProfileOrNull: pending,
    };
    const catalog = npcEditorForItemAttempt(base, inventory, nextContext),
      rows = prepared.draft.inventory.kind === 'ENTERED' ? [...prepared.draft.inventory.value] : [];
    if (request.kind === 'CUSTOM_ITEM_RESERVE') {
      if (pending.reference.kind !== 'CAMPAIGN_CUSTOM_PROFILE') return s.fail();
      rows.push(
        createEmptyNpcCampaignCustomInventoryEditorRow(
          catalog,
          pending.itemInstanceId,
          pending.reference,
        ),
      );
    } else {
      const index = rows.findIndex((row) => row.itemInstanceId === pending.itemInstanceId),
        old = rows[index];
      if (old === undefined) return s.fail();
      if (request.kind === 'CUSTOM_MODIFIER_RESERVE') {
        if ('itemTypeReference' in old || pending.reference.kind !== 'CATALOG_CUSTOM_MODIFIER')
          return s.fail();
        rows[index] = addEmptyNpcCatalogueCustomModifier(catalog, old, pending.reference);
      } else rows[index] = replaceNpcInventoryCustomProfileVersion(catalog, old, pending.reference);
    }
    return json(
      readNpcEditorDraft(catalog, {
        ...prepared.draft,
        inventory: { kind: 'ENTERED', value: rows },
      }),
    );
  }
  return {
    inspect(
      values: JsonObject,
      context: NpcAttemptReadContext,
    ): NpcCustomInventoryPreparation | null {
      if (!isNpcCampaignCustomPublicationAvailable(publication)) return null;
      const draft = readNpcEditorDraft(npcEditorForItemAttempt(base, inventory, context), values),
        rows = draft.inventory.kind === 'ENTERED' ? draft.inventory.value : [];
      const bindings = context.customProfiles ?? [],
        backpackTypes = npcCustomBackpackTypeIds(publication);
      const label = (row: (typeof rows)[number]) => {
        const type = row.input.itemTypeId;
        return (
          (type.kind === 'ENTERED' && type.value !== null
            ? (inventory.definitions.find((d) => d.itemTypeId === type.value)?.name ?? s.fail())
            : 'Произвольный предмет') +
          ' · ' +
          row.itemInstanceId.slice(0, 8)
        );
      };
      const modifierTargets = rows.flatMap((row) => {
        if (
          'itemTypeReference' in row ||
          row.customModifier !== undefined ||
          bindings.some((b) => b.itemInstanceId === row.itemInstanceId) ||
          row.input.itemTypeId.kind !== 'ENTERED'
        )
          return [];
        const itemTypeId = row.input.itemTypeId.value;
        if (!inventory.definitions.some((d) => d.itemTypeId === itemTypeId && d.inventoryAllowed))
          return [];
        return [{ itemInstanceId: row.itemInstanceId, label: label(row) }];
      });
      const versionTargets = rows.flatMap((row) => {
        const ref =
          'itemTypeReference' in row ? row.itemTypeReference : row.customModifier?.reference;
        if (
          ref?.kind !== 'ENTERED' ||
          bindings.some(
            (b) => b.itemInstanceId === row.itemInstanceId && b.confirmedContentOrNull === null,
          )
        )
          return [];
        const actual = bindings.find(
          (b) =>
            b.itemInstanceId === row.itemInstanceId &&
            s.same(b.reference, ref.value) &&
            b.confirmedContentOrNull !== null,
        );
        return actual === undefined
          ? []
          : [
              {
                itemInstanceId: row.itemInstanceId,
                profileId: actual.reference.profileId,
                profileVersionId: actual.reference.profileVersionId,
                label: label(row) + ' · версия ' + String(actual.reference.version),
              },
            ];
      });
      return {
        capabilityKey: s.sha(
          s.canonical({
            scope: context.scope,
            npcDraftId: context.npcDraftId,
            revision: context.revision,
          }),
        ),
        canAdd: true,
        modifierTargets,
        versionTargets,
        backpackChoices: rows.flatMap((row) =>
          row.input.itemTypeId.kind === 'ENTERED' &&
          row.input.itemTypeId.value !== null &&
          backpackTypes.includes(row.input.itemTypeId.value)
            ? [{ value: row.itemInstanceId, label: label(row) }]
            : [],
        ),
        editableProfileVersionIds: bindings
          .filter((b) => b.confirmedContentOrNull === null)
          .map((b) => b.reference.profileVersionId),
        errors: [],
        explanation:
          'Профиль относится к одному физическому предмету. Заполните его поля и основание; сохранённый профиль изменяется только через новую версию. Бонус требует отдельного выбора настоящего рюкзака или нахождения вне рюкзака.',
      };
    },
    validate(request: NpcPreparationRequest, context: NpcAttemptPreparationContext): void {
      const previous = context.previousOrNull?.attempt ?? s.fail('INVALID_INPUT');
      if (previous.stage !== 'NPC-015' || previous.status !== 'OPEN') return s.fail('UNAVAILABLE');
      preflight(previous.values, input(request), context.previousReadContextOrNull ?? s.fail());
    },
    prepare(
      request: NpcPreparationRequest,
      context: NpcAttemptPreparationContext,
      allocate: () => string,
      committedAt: string,
    ): NpcPreparedAttempt {
      const intent = input(request),
        previous = context.previousOrNull?.attempt ?? s.fail(),
        proof = context.previousReadContextOrNull ?? s.fail();
      const checked = preflight(previous.values, intent, proof);
      const facts: Exclude<NpcChildAllocation, { kind: 'WEAPON_PROFILE_VERSION' }>[] = [];
      const itemInstanceId =
        intent.kind === 'CUSTOM_ITEM_RESERVE' ? allocate() : intent.itemInstanceId;
      if (intent.kind === 'CUSTOM_ITEM_RESERVE') facts.push({ kind: 'ITEM', id: itemInstanceId });
      if (intent.kind === 'CUSTOM_PROFILE_VERSION_RESERVE') {
        const old = checked.current ?? s.fail();
        facts.push({
          kind: 'CUSTOM_PROFILE_VERSION',
          id: allocate(),
          itemInstanceId,
          profileId: old.reference.profileId,
          version: s.increment(old.reference.version),
          previousVersionIdOrNull: old.reference.profileVersionId,
        });
      } else {
        const profileId = allocate();
        facts.push(
          {
            kind: 'CUSTOM_PROFILE',
            id: profileId,
            itemInstanceId,
            profileKind:
              intent.kind === 'CUSTOM_ITEM_RESERVE'
                ? 'CAMPAIGN_CUSTOM_PROFILE'
                : 'CATALOG_CUSTOM_MODIFIER',
          },
          {
            kind: 'CUSTOM_PROFILE_VERSION',
            id: allocate(),
            itemInstanceId,
            profileId,
            version: 1,
            previousVersionIdOrNull: null,
          },
        );
      }
      return {
        next: {
          ...previous,
          revision: s.increment(previous.revision),
          values: apply(previous.values, intent, facts, proof, request.operationId),
        },
        childAllocations: facts,
        receiptId: allocate(),
        committedAt,
      };
    },
    apply(
      ...[operation, event, previous, context]: Parameters<NpcCompositionAuthoringApply>
    ): JsonObject {
      const request = npcTechnicalRequestValue(operation.request);
      if (
        request.messageType !== 'network.npc-preparation.request' ||
        !('childAllocations' in event)
      )
        return s.fail();
      return apply(
        previous.attempt.values,
        input(request),
        event.childAllocations,
        context,
        operation.operationId,
      );
    },
  };
}
