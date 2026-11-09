import {
  CORE_169_SPECIES_BY_FACE,
  SYMBIOTIC_MONSTER_SPECIES_KEYS,
  type SymbiontSpeciesKey,
} from '../domain/rules/symbiont-stage/catalog.js';
import type { DiseaseId } from '@generated/types/effects.js';
import {
  readNpcCustomProfileContent,
  readNpcCustomProfileReference,
  type NpcCampaignCustomProfileReference,
  type NpcCatalogueCustomModifierReference,
  type NpcCustomProfileContent,
} from '../domain/rules/npc-authoring/inventory.js';
import {
  readNpcTraumaEditorRow,
  type NpcTraumaEditorRow,
} from '../domain/rules/npc-authoring/staged-input.js';
import {
  NPC_DISEASE_IDS,
  NPC_COMPOSITE_ITEM_TYPE_IDS,
  NPC_WEAVER_STATE_BRANCHES,
  type NpcWeaverStateBranch,
  type NpcCompositeItemTypeId,
} from '../shared/npc-command.js';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { legacyLocalIdentityInUse } from './npc-identities.js';
import {
  STARTING_WEAPON_VARIANTS,
  type StartingWeaponVariant,
} from '../domain/rules/item-stage/starting-weapon.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import type {
  NpcAttempt,
  NpcAttemptEvent,
  NpcOperation,
  NpcScope,
  NpcVersion,
  NpcVersionRef,
} from './npc-library-records.js';

export type NpcRuntimeEffectSource =
  | Readonly<{ sourceKind: 'ALCOHOL' }>
  | Readonly<{ sourceKind: 'LIFE_TIMER' }>
  | Readonly<{ sourceKind: 'POISON_MODE'; sourceInstanceId: string }>
  | Readonly<{ sourceKind: 'WEAVER_STATE'; branch: NpcWeaverStateBranch; sourceInstanceId: string }>
  | Readonly<{ sourceKind: 'FORMAL_CONTROL'; controlKind: 'SLEEP' | 'PARALYSIS' }>
  | Readonly<{ sourceKind: 'HP_MODE'; mode: 'HUNGER' | 'REGENERATION'; sourceInstanceId: string }>;
export type NpcRuntimeEffectAllocation = NpcRuntimeEffectSource &
  Readonly<{ kind: 'EFFECT_INSTANCE'; id: string }>;
export interface NpcLinkedSetBinding {
  readonly linkedSetInstanceId: string;
  readonly itemTypeId: NpcCompositeItemTypeId;
  readonly components: readonly Readonly<{
    itemInstanceId: string;
    componentRole: 'SWORD' | 'RAPIER' | 'SHIELD';
  }>[];
}
export type NpcCustomProfileReference =
  NpcCampaignCustomProfileReference | NpcCatalogueCustomModifierReference;
export interface NpcCustomProfileBinding {
  readonly itemInstanceId: string;
  readonly reference: NpcCustomProfileReference;
  readonly confirmedContentOrNull: NpcCustomProfileContent | null;
}
export interface NpcPendingCustomProfile {
  readonly newItem: boolean;
  readonly itemInstanceId: string;
  readonly reference: NpcCustomProfileReference;
}
export type NpcChildAllocation =
  | Readonly<{ kind: 'ITEM'; id: string }>
  | Readonly<{
      kind: 'COATING_INSTANCE';
      id: string;
      itemInstanceId: string;
      sourceInstanceId: string;
    }>
  | Readonly<{ kind: 'LINKED_SET'; id: string; itemTypeId: NpcCompositeItemTypeId }>
  | Readonly<{
      kind: 'CUSTOM_PROFILE';
      id: string;
      itemInstanceId: string;
      profileKind: NpcCustomProfileReference['kind'];
    }>
  | Readonly<{
      kind: 'CUSTOM_PROFILE_VERSION';
      id: string;
      itemInstanceId: string;
      profileId: string;
      version: number;
      previousVersionIdOrNull: string | null;
    }>
  | Readonly<{ kind: 'TRAUMA_INSTANCE'; id: string }>
  | Readonly<{ kind: 'WOUND_INSTANCE'; id: string }>
  | Readonly<{ kind: 'SYMBIONT_INSTANCE'; id: string }>
  | Readonly<{ kind: 'EFFECT_INSTANCE'; id: string; diseaseId: DiseaseId }>
  | NpcRuntimeEffectAllocation
  | Readonly<{
      kind: 'WEAPON_PROFILE_VERSION';
      id: string;
      itemInstanceId: string;
      weaponVariantId: StartingWeaponVariant;
    }>;
export interface NpcChildIdentity {
  readonly allocation: NpcChildAllocation;
  readonly scope: NpcScope;
  readonly ownerNpcUuid: string;
  readonly originDraftId: string;
  readonly originOperationId: string;
  readonly originEventSha256: string;
  readonly originRevision: number;
  readonly ordinal: number;
}
export interface NpcPublishedItemIdentity {
  readonly itemInstanceId: string;
  readonly profileVersions: readonly Readonly<{
    weaponProfileVersionId: string;
    weaponVariantId: StartingWeaponVariant;
  }>[];
}
/** References extracted only after the owning full snapshot reader has recomputed mechanics. */
export interface NpcPublishedChildGraph {
  readonly pendingInventory?: Readonly<{
    items: readonly Readonly<{ itemInstanceId: string; originOperationId: string }>[];
    linkedSets: readonly NpcLinkedSetBinding[];
    customProfiles: readonly NpcCustomProfileBinding[];
  }>;
  readonly archivedCoatingPreparations?: readonly Readonly<{
    coatingInstanceId: string;
    itemInstanceId: string;
    sourceInstanceId: string;
    preparationOperationId: string;
    publishedOriginCommitOperationIdOrNull: string | null;
  }>[];
  readonly coatings?: readonly Readonly<{
    coatingInstanceId: string;
    itemInstanceId: string;
    sourceInstanceId: string;
    originCommitOperationId: string;
  }>[];
  readonly customProfiles?: readonly NpcCustomProfileBinding[];
  readonly linkedSets?: readonly NpcLinkedSetBinding[];
  readonly runtimeEffects?: readonly (NpcRuntimeEffectSource &
    Readonly<{
      effectInstanceId: string;
      originCommitOperationId: string;
    }>)[];
  readonly wounds: readonly Readonly<{ woundInstanceId: string; originOperationId: string }>[];
  readonly items: readonly NpcPublishedItemIdentity[];
  readonly symbionts: readonly Readonly<{
    symbiontInstanceId: string;
    speciesKey: SymbiontSpeciesKey;
    originCommitOperationId: string;
  }>[];
  readonly traumas: readonly Readonly<{
    traumaInstanceId: string;
    originCommitOperationId: string;
    input: NpcTraumaEditorRow;
  }>[];
  readonly effects: readonly Readonly<{
    effectInstanceId: string;
    diseaseId: DiseaseId;
    originCommitOperationId: string;
  }>[];
}
export interface NpcAttemptReadContext {
  readonly coatingBindings?: readonly Readonly<{
    coatingInstanceId: string;
    itemInstanceId: string;
    sourceInstanceId: string;
    originOperationId: string;
    originDraftId: string;
    originEventSha256: string;
    retainedOriginCommitOperationIdOrNull: string | null;
    retainedPreparationOperationIdOrNull?: string | null;
  }>[];
  readonly pendingCoatingOrNull?: Readonly<{
    coatingInstanceId: string;
    itemInstanceId: string;
    sourceInstanceId: string;
    operationId: string;
    npcDraftId: string;
  }> | null;
  readonly customProfiles?: readonly NpcCustomProfileBinding[];
  readonly pendingCustomProfileOrNull?: NpcPendingCustomProfile | null;
  readonly linkedSets?: readonly NpcLinkedSetBinding[];
  readonly pendingCompositeOrNull?: NpcLinkedSetBinding | null;
  readonly runtimeEffectBindings?: readonly (NpcRuntimeEffectSource &
    Readonly<{
      effectInstanceId: string;
      originOperationId: string;
      originDraftId: string;
      originEventSha256: string;
    }>)[];
  readonly pendingRuntimeEffectOrNull?:
    | (NpcRuntimeEffectSource &
        Readonly<{
          effectInstanceId: string;
          operationId: string;
          npcDraftId: string;
        }>)
    | null;
  readonly woundBindings: readonly Readonly<{
    woundInstanceId: string;
    originOperationId: string;
    originDraftId: string;
    originEventSha256: string;
  }>[];
  readonly pendingWoundOrNull: Readonly<{
    woundInstanceId: string;
    operationId: string;
    npcDraftId: string;
  }> | null;
  readonly scope: NpcScope;
  readonly npcDraftId: string;
  readonly candidateNpcUuid: string;
  readonly revision: number;
  readonly operationId: string;
  readonly inheritedVersionOrNull: NpcVersionRef | null;
  /** Selected checked history only; absent for ordinary inheritance or new allocation. */
  readonly restoredWeaponProfiles?: readonly Readonly<{
    itemInstanceId: string;
    weaponProfileVersionId: string;
    weaponVariantId: StartingWeaponVariant;
    originOperationId: string;
    originDraftId: string;
    originEventSha256: string;
  }>[];
  readonly itemBindings: readonly Readonly<{
    itemInstanceId: string;
    originOperationId: string;
    originDraftId: string;
    originEventSha256: string;
  }>[];
  readonly symbiontBindings: readonly Readonly<{
    symbiontInstanceId: string;
    originOperationId: string;
    originDraftId: string;
    originEventSha256: string;
    retainedSpeciesKeyOrNull: SymbiontSpeciesKey | null;
  }>[];
  readonly pendingSymbiontOrNull: Readonly<{
    symbiontInstanceId: string;
    operationId: string;
    npcDraftId: string;
  }> | null;
  readonly traumaBindings: readonly Readonly<{
    traumaInstanceId: string;
    originOperationId: string;
    originDraftId: string;
    originEventSha256: string;
    retainedRowOrNull: NpcTraumaEditorRow | null;
  }>[];
  readonly pendingTraumaOrNull: Readonly<{
    traumaInstanceId: string;
    operationId: string;
    npcDraftId: string;
  }> | null;
  readonly effectBindings: readonly Readonly<{
    effectInstanceId: string;
    diseaseId: DiseaseId;
    originOperationId: string;
    originDraftId: string;
    originEventSha256: string;
  }>[];
  readonly pendingEffectOrNull: Readonly<{
    effectInstanceId: string;
    diseaseId: DiseaseId;
    operationId: string;
    npcDraftId: string;
  }> | null;
  /** APPLY only; no invented event hash before the new event exists. Never emitted by recovery. */
  readonly pendingItemOrNull: Readonly<{
    itemInstanceId: string;
    operationId: string;
    npcDraftId: string;
  }> | null;
}
function equal(a: unknown, b: unknown): void {
  if (!s.same(a, b)) s.fail();
}
function hash(value: unknown): string {
  return createHash('sha256').update(s.canonical(value)).digest('hex');
}
function disease(value: unknown): DiseaseId {
  return NPC_DISEASE_IDS.find((id) => id === value) ?? s.fail();
}
export function npcRuntimeEffectSourceValue(value: unknown): NpcRuntimeEffectSource {
  const row = s.object(value);
  if (row['sourceKind'] === 'ALCOHOL' || row['sourceKind'] === 'LIFE_TIMER') {
    s.object(row, ['sourceKind']);
    return { sourceKind: row['sourceKind'] };
  }
  if (row['sourceKind'] === 'FORMAL_CONTROL') {
    s.object(row, ['sourceKind', 'controlKind']);
    if (row['controlKind'] !== 'SLEEP' && row['controlKind'] !== 'PARALYSIS') return s.fail();
    return { sourceKind: 'FORMAL_CONTROL', controlKind: row['controlKind'] };
  }
  if (row['sourceKind'] === 'POISON_MODE') {
    s.object(row, ['sourceKind', 'sourceInstanceId']);
    return { sourceKind: 'POISON_MODE', sourceInstanceId: s.uuid(row['sourceInstanceId']) };
  }
  if (row['sourceKind'] === 'WEAVER_STATE') {
    s.object(row, ['sourceKind', 'branch', 'sourceInstanceId']);
    const branch = NPC_WEAVER_STATE_BRANCHES.find((value) => value === row['branch']) ?? s.fail();
    return {
      sourceKind: 'WEAVER_STATE',
      branch,
      sourceInstanceId: s.uuid(row['sourceInstanceId']),
    };
  }
  s.object(row, ['sourceKind', 'mode', 'sourceInstanceId']);
  if (
    row['sourceKind'] !== 'HP_MODE' ||
    (row['mode'] !== 'HUNGER' && row['mode'] !== 'REGENERATION')
  )
    return s.fail();
  return {
    sourceKind: 'HP_MODE',
    mode: row['mode'],
    sourceInstanceId: s.uuid(row['sourceInstanceId']),
  };
}
export function npcRuntimeEffectAllocationSource(
  allocation: NpcRuntimeEffectAllocation,
): NpcRuntimeEffectSource {
  const { kind: _kind, id: _id, ...source } = allocation;
  return npcRuntimeEffectSourceValue(source);
}
export function npcLinkedSetBindingValue(value: unknown): NpcLinkedSetBinding {
  const row = s.object(value, ['linkedSetInstanceId', 'itemTypeId', 'components']);
  const itemTypeId = NPC_COMPOSITE_ITEM_TYPE_IDS.find((id) => id === row['itemTypeId']) ?? s.fail();
  const expectedRoles = itemTypeId === 'ITM-WPN-026' ? ['SWORD', 'SHIELD'] : ['RAPIER', 'SHIELD'];
  const components = dataArray(row['components']).map((raw, index) => {
    const component = s.object(raw, ['itemInstanceId', 'componentRole']);
    if (component['componentRole'] !== expectedRoles[index]) return s.fail();
    return {
      itemInstanceId: s.uuid(component['itemInstanceId']),
      componentRole: component['componentRole'] as 'SWORD' | 'RAPIER' | 'SHIELD',
    };
  });
  if (components.length !== 2 || components[0]?.itemInstanceId === components[1]?.itemInstanceId)
    return s.fail();
  const linkedSetInstanceId = s.uuid(row['linkedSetInstanceId']);
  if (components.some((c) => c.itemInstanceId === linkedSetInstanceId)) return s.fail();
  return { linkedSetInstanceId, itemTypeId, components };
}
export function npcCustomProfileBindingValue(value: unknown): NpcCustomProfileBinding {
  const row = s.object(value, ['itemInstanceId', 'reference', 'confirmedContentOrNull']),
    raw = s.object(row['reference']);
  const kind = raw['kind'];
  if (kind !== 'CAMPAIGN_CUSTOM_PROFILE' && kind !== 'CATALOG_CUSTOM_MODIFIER') return s.fail();
  return {
    itemInstanceId: s.uuid(row['itemInstanceId']),
    reference:
      kind === 'CAMPAIGN_CUSTOM_PROFILE'
        ? readNpcCustomProfileReference(raw, kind)
        : readNpcCustomProfileReference(raw, kind),
    confirmedContentOrNull:
      row['confirmedContentOrNull'] === null
        ? null
        : readNpcCustomProfileContent(row['confirmedContentOrNull']),
  };
}
function customReferenceFromChildren(
  child: NpcChildIdentity,
  children: readonly NpcChildIdentity[],
): NpcCustomProfileReference {
  const version = child.allocation;
  if (version.kind !== 'CUSTOM_PROFILE_VERSION') return s.fail();
  const profile =
    children.find(
      (c) => c.allocation.kind === 'CUSTOM_PROFILE' && c.allocation.id === version.profileId,
    ) ?? s.fail();
  if (profile.allocation.kind !== 'CUSTOM_PROFILE') return s.fail();
  equal(
    [profile.scope, profile.ownerNpcUuid, profile.allocation.itemInstanceId],
    [child.scope, child.ownerNpcUuid, version.itemInstanceId],
  );
  return {
    kind: profile.allocation.profileKind,
    profileId: profile.allocation.id,
    profileVersionId: version.id,
    version: version.version,
    reservationOperationId: child.originOperationId,
  };
}
/** Decode only the host's ordered allocations; the command's current target is checked separately. */
export function npcPendingCustomProfile(
  facts: readonly NpcChildAllocation[],
  context: NpcAttemptReadContext,
  operationId: string,
): NpcPendingCustomProfile | null {
  if (
    !facts.some((fact) => fact.kind === 'CUSTOM_PROFILE' || fact.kind === 'CUSTOM_PROFILE_VERSION')
  )
    return null;
  const newItem = facts[0]?.kind === 'ITEM',
    offset = newItem ? 1 : 0,
    profile = facts[offset],
    last = facts.at(-1);
  if (last?.kind !== 'CUSTOM_PROFILE_VERSION') return s.fail();
  let kind: NpcCustomProfileReference['kind'];
  if (profile?.kind === 'CUSTOM_PROFILE') {
    if (
      facts.length !== offset + 2 ||
      profile.id !== last.profileId ||
      profile.itemInstanceId !== last.itemInstanceId ||
      last.version !== 1 ||
      last.previousVersionIdOrNull !== null ||
      (newItem && facts[0]?.id !== last.itemInstanceId)
    )
      return s.fail();
    kind = profile.profileKind;
    if (newItem !== (kind === 'CAMPAIGN_CUSTOM_PROFILE')) return s.fail();
  } else {
    if (newItem || facts.length !== 1) return s.fail();
    const old =
      context.customProfiles?.find(
        (b) =>
          b.reference.profileVersionId === last.previousVersionIdOrNull &&
          b.reference.profileId === last.profileId &&
          b.itemInstanceId === last.itemInstanceId &&
          b.confirmedContentOrNull !== null,
      ) ?? s.fail();
    equal(last.version, s.increment(old.reference.version));
    kind = old.reference.kind;
  }
  return {
    newItem,
    itemInstanceId: last.itemInstanceId,
    reference: {
      kind,
      profileId: last.profileId,
      profileVersionId: last.id,
      version: last.version,
      reservationOperationId: s.uuid(operationId),
    },
  };
}
function linkedSetFromChildren(
  child: NpcChildIdentity,
  children: readonly NpcChildIdentity[],
): NpcLinkedSetBinding {
  if (child.allocation.kind !== 'LINKED_SET') return s.fail();
  const parts = children
    .filter((c) => c.originOperationId === child.originOperationId && c.allocation.kind === 'ITEM')
    .sort((a, b) => a.ordinal - b.ordinal);
  if (
    parts.length !== 2 ||
    parts.some(
      (c) =>
        !s.same(c.scope, child.scope) ||
        c.ownerNpcUuid !== child.ownerNpcUuid ||
        c.originDraftId !== child.originDraftId ||
        c.originEventSha256 !== child.originEventSha256,
    )
  )
    return s.fail();
  return npcLinkedSetBindingValue({
    linkedSetInstanceId: child.allocation.id,
    itemTypeId: child.allocation.itemTypeId,
    components: parts.map((c, index) => ({
      itemInstanceId: c.allocation.id,
      componentRole:
        index === 1
          ? 'SHIELD'
          : child.allocation.kind === 'LINKED_SET' && child.allocation.itemTypeId === 'ITM-WPN-026'
            ? 'SWORD'
            : 'RAPIER',
    })),
  });
}
function variant(value: unknown): StartingWeaponVariant {
  return STARTING_WEAPON_VARIANTS.find((v) => v === value) ?? s.fail();
}
function dataArray(value: unknown): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return s.fail();
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const d = Object.getOwnPropertyDescriptor(value, String(index));
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, 'value')) return s.fail();
    result.push(d.value as unknown);
  }
  return result;
}
export function npcChildAllocationsValue(value: unknown): readonly NpcChildAllocation[] {
  const values = dataArray(value);
  const result = values.map((v): NpcChildAllocation => {
    const r = s.object(v);
    if (
      r['kind'] === 'ITEM' ||
      r['kind'] === 'TRAUMA_INSTANCE' ||
      r['kind'] === 'WOUND_INSTANCE' ||
      r['kind'] === 'SYMBIONT_INSTANCE'
    ) {
      s.object(r, ['kind', 'id']);
      return { kind: r['kind'], id: s.uuid(r['id']) };
    }
    if (r['kind'] === 'EFFECT_INSTANCE') {
      if (Object.hasOwn(r, 'sourceKind')) {
        const { kind: _kind, id: _id, ...source } = r;
        return {
          kind: 'EFFECT_INSTANCE',
          id: s.uuid(r['id']),
          ...npcRuntimeEffectSourceValue(source),
        };
      }
      s.object(r, ['kind', 'id', 'diseaseId']);
      return { kind: 'EFFECT_INSTANCE', id: s.uuid(r['id']), diseaseId: disease(r['diseaseId']) };
    }
    if (r['kind'] === 'LINKED_SET') {
      s.object(r, ['kind', 'id', 'itemTypeId']);
      return {
        kind: 'LINKED_SET',
        id: s.uuid(r['id']),
        itemTypeId: NPC_COMPOSITE_ITEM_TYPE_IDS.find((id) => id === r['itemTypeId']) ?? s.fail(),
      };
    }
    if (r['kind'] === 'CUSTOM_PROFILE') {
      s.object(r, ['kind', 'id', 'itemInstanceId', 'profileKind']);
      const profileKind = r['profileKind'];
      if (profileKind !== 'CAMPAIGN_CUSTOM_PROFILE' && profileKind !== 'CATALOG_CUSTOM_MODIFIER')
        return s.fail();
      const id = s.uuid(r['id']),
        itemInstanceId = s.uuid(r['itemInstanceId']);
      if (id === itemInstanceId) return s.fail();
      return { kind: 'CUSTOM_PROFILE', id, itemInstanceId, profileKind };
    }
    if (r['kind'] === 'COATING_INSTANCE') {
      s.object(r, ['kind', 'id', 'itemInstanceId', 'sourceInstanceId']);
      const id = s.uuid(r['id']),
        itemInstanceId = s.uuid(r['itemInstanceId']),
        sourceInstanceId = s.uuid(r['sourceInstanceId']);
      if (new Set([id, itemInstanceId, sourceInstanceId]).size !== 3) return s.fail();
      return { kind: 'COATING_INSTANCE', id, itemInstanceId, sourceInstanceId };
    }
    if (r['kind'] === 'CUSTOM_PROFILE_VERSION') {
      s.object(r, [
        'kind',
        'id',
        'itemInstanceId',
        'profileId',
        'version',
        'previousVersionIdOrNull',
      ]);
      const id = s.uuid(r['id']),
        itemInstanceId = s.uuid(r['itemInstanceId']),
        profileId = s.uuid(r['profileId']),
        version = s.integer(r['version']),
        previousVersionIdOrNull =
          r['previousVersionIdOrNull'] === null ? null : s.uuid(r['previousVersionIdOrNull']);
      if (
        version < 1 ||
        (version === 1) !== (previousVersionIdOrNull === null) ||
        new Set([
          id,
          itemInstanceId,
          profileId,
          ...(previousVersionIdOrNull === null ? [] : [previousVersionIdOrNull]),
        ]).size !== (previousVersionIdOrNull === null ? 3 : 4)
      )
        return s.fail();
      return {
        kind: 'CUSTOM_PROFILE_VERSION',
        id,
        itemInstanceId,
        profileId,
        version,
        previousVersionIdOrNull,
      };
    }
    if (r['kind'] !== 'WEAPON_PROFILE_VERSION') return s.fail();
    s.object(r, ['kind', 'id', 'itemInstanceId', 'weaponVariantId']);
    return {
      kind: 'WEAPON_PROFILE_VERSION',
      id: s.uuid(r['id']),
      itemInstanceId: s.uuid(r['itemInstanceId']),
      weaponVariantId: variant(r['weaponVariantId']),
    };
  });
  if (new Set(result.map((c) => c.id)).size !== result.length) return s.fail();
  return result;
}
export function npcEventAllocations(event: NpcAttemptEvent): readonly NpcChildAllocation[] {
  return 'format' in event ? event.childAllocations : [];
}
export function npcPublishedChildGraphValue(value: unknown): NpcPublishedChildGraph {
  const r = s.object(value, [
    'items',
    'effects',
    'traumas',
    'symbionts',
    'wounds',
    ...(Object.hasOwn(s.object(value), 'runtimeEffects') ? ['runtimeEffects'] : []),
    ...(Object.hasOwn(s.object(value), 'linkedSets') ? ['linkedSets'] : []),
    ...(Object.hasOwn(s.object(value), 'customProfiles') ? ['customProfiles'] : []),
    ...(Object.hasOwn(s.object(value), 'coatings') ? ['coatings'] : []),
    ...(Object.hasOwn(s.object(value), 'archivedCoatingPreparations')
      ? ['archivedCoatingPreparations']
      : []),
    ...(Object.hasOwn(s.object(value), 'pendingInventory') ? ['pendingInventory'] : []),
  ]);
  const raw = dataArray(r['items']);
  const ids: string[] = [];
  const items = raw.map((v) => {
    const item = s.object(v, ['itemInstanceId', 'profileVersions']);
    const itemInstanceId = s.uuid(item['itemInstanceId']);
    ids.push(itemInstanceId);
    const profiles = dataArray(item['profileVersions']);
    const profileVersions = profiles.map((p) => {
      const row = s.object(p, ['weaponProfileVersionId', 'weaponVariantId']);
      const weaponProfileVersionId = s.uuid(row['weaponProfileVersionId']);
      ids.push(weaponProfileVersionId);
      return { weaponProfileVersionId, weaponVariantId: variant(row['weaponVariantId']) };
    });
    if (new Set(profileVersions.map((p) => p.weaponVariantId)).size !== profileVersions.length)
      return s.fail();
    return { itemInstanceId, profileVersions };
  });
  const effects = dataArray(r['effects']).map((raw) => {
    const e = s.object(raw, ['effectInstanceId', 'diseaseId', 'originCommitOperationId']);
    const effectInstanceId = s.uuid(e['effectInstanceId']);
    ids.push(effectInstanceId);
    return {
      effectInstanceId,
      diseaseId: disease(e['diseaseId']),
      originCommitOperationId: s.uuid(e['originCommitOperationId']),
    };
  });
  if (new Set(effects.map((e) => e.diseaseId)).size !== effects.length) return s.fail();
  const traumas = dataArray(r['traumas']).map((raw) => {
    const t = s.object(raw, ['traumaInstanceId', 'originCommitOperationId', 'input']);
    const traumaInstanceId = s.uuid(t['traumaInstanceId']);
    ids.push(traumaInstanceId);
    const input = readNpcTraumaEditorRow(t['input']);
    equal(input.traumaInstanceId, traumaInstanceId);
    return {
      traumaInstanceId,
      originCommitOperationId: s.uuid(t['originCommitOperationId']),
      input,
    };
  });
  const symbionts = dataArray(r['symbionts']).map((raw) => {
    const row = s.object(raw, ['symbiontInstanceId', 'speciesKey', 'originCommitOperationId']);
    const symbiontInstanceId = s.uuid(row['symbiontInstanceId']);
    ids.push(symbiontInstanceId);
    const speciesKey =
      [...CORE_169_SPECIES_BY_FACE, ...SYMBIOTIC_MONSTER_SPECIES_KEYS].find(
        (k) => k === row['speciesKey'],
      ) ?? s.fail();
    return {
      symbiontInstanceId,
      speciesKey,
      originCommitOperationId: s.uuid(row['originCommitOperationId']),
    };
  });
  const wounds = dataArray(r['wounds']).map((raw) => {
    const row = s.object(raw, ['woundInstanceId', 'originOperationId']);
    const woundInstanceId = s.uuid(row['woundInstanceId']);
    ids.push(woundInstanceId);
    return { woundInstanceId, originOperationId: s.uuid(row['originOperationId']) };
  });
  const runtimeEffects = Object.hasOwn(r, 'runtimeEffects')
    ? dataArray(r['runtimeEffects']).map((raw) => {
        const row = s.object(raw);
        const { effectInstanceId: _id, originCommitOperationId: _origin, ...source } = row;
        const effectInstanceId = s.uuid(row['effectInstanceId']);
        ids.push(effectInstanceId);
        return {
          effectInstanceId,
          originCommitOperationId: s.uuid(row['originCommitOperationId']),
          ...npcRuntimeEffectSourceValue(source),
        };
      })
    : undefined;
  const coatings = Object.hasOwn(r, 'coatings')
    ? dataArray(r['coatings']).map((raw) => {
        const row = s.object(raw, [
          'coatingInstanceId',
          'itemInstanceId',
          'sourceInstanceId',
          'originCommitOperationId',
        ]);
        const coatingInstanceId = s.uuid(row['coatingInstanceId']),
          itemInstanceId = s.uuid(row['itemInstanceId']);
        if (!items.some((item) => item.itemInstanceId === itemInstanceId)) return s.fail();
        ids.push(coatingInstanceId);
        return {
          coatingInstanceId,
          itemInstanceId,
          sourceInstanceId: s.uuid(row['sourceInstanceId']),
          originCommitOperationId: s.uuid(row['originCommitOperationId']),
        };
      })
    : undefined;
  if (
    coatings !== undefined &&
    new Set(coatings.map((row) => row.itemInstanceId)).size !== coatings.length
  )
    return s.fail();
  const archivedCoatingPreparations = Object.hasOwn(r, 'archivedCoatingPreparations')
    ? dataArray(r['archivedCoatingPreparations']).map((raw) => {
        const row = s.object(raw, [
          'coatingInstanceId',
          'itemInstanceId',
          'sourceInstanceId',
          'preparationOperationId',
          'publishedOriginCommitOperationIdOrNull',
        ]);
        const coatingInstanceId = s.uuid(row['coatingInstanceId']);
        const itemInstanceId = s.uuid(row['itemInstanceId']);
        if (items.some((item) => item.itemInstanceId === itemInstanceId)) return s.fail();
        ids.push(coatingInstanceId);
        return {
          coatingInstanceId,
          itemInstanceId,
          sourceInstanceId: s.uuid(row['sourceInstanceId']),
          preparationOperationId: s.uuid(row['preparationOperationId']),
          publishedOriginCommitOperationIdOrNull:
            row['publishedOriginCommitOperationIdOrNull'] === null
              ? null
              : s.uuid(row['publishedOriginCommitOperationIdOrNull']),
        };
      })
    : undefined;
  if (
    archivedCoatingPreparations !== undefined &&
    new Set(archivedCoatingPreparations.map((row) => row.itemInstanceId)).size !==
      archivedCoatingPreparations.length
  )
    return s.fail();
  const linkedSets = Object.hasOwn(r, 'linkedSets')
    ? dataArray(r['linkedSets']).map((raw) => {
        const set = npcLinkedSetBindingValue(raw);
        ids.push(set.linkedSetInstanceId);
        if (
          set.components.some(
            (component) => !items.some((item) => item.itemInstanceId === component.itemInstanceId),
          )
        )
          return s.fail();
        return set;
      })
    : undefined;
  const customProfiles = Object.hasOwn(r, 'customProfiles')
    ? dataArray(r['customProfiles']).map((raw) => {
        const binding = npcCustomProfileBindingValue(raw);
        if (
          binding.confirmedContentOrNull === null ||
          !items.some((item) => item.itemInstanceId === binding.itemInstanceId)
        )
          return s.fail();
        ids.push(binding.reference.profileId, binding.reference.profileVersionId);
        return binding;
      })
    : undefined;
  if (
    customProfiles !== undefined &&
    new Set(customProfiles.map((b) => b.itemInstanceId)).size !== customProfiles.length
  )
    return s.fail();
  if (linkedSets !== undefined) {
    const componentIds = linkedSets.flatMap((set) => set.components.map((c) => c.itemInstanceId));
    if (new Set(componentIds).size !== componentIds.length) return s.fail();
  }
  const pendingInventory = Object.hasOwn(r, 'pendingInventory')
    ? (() => {
        const pending = s.object(r['pendingInventory'], ['items', 'linkedSets', 'customProfiles']);
        const pendingItems = dataArray(pending['items']).map((value) => {
          const row = s.object(value, ['itemInstanceId', 'originOperationId']);
          const itemInstanceId = s.uuid(row['itemInstanceId']);
          ids.push(itemInstanceId);
          return { itemInstanceId, originOperationId: s.uuid(row['originOperationId']) };
        });
        const pendingSets = dataArray(pending['linkedSets']).map(npcLinkedSetBindingValue);
        const pendingProfiles = dataArray(pending['customProfiles']).map(
          npcCustomProfileBindingValue,
        );
        for (const set of pendingSets) {
          ids.push(set.linkedSetInstanceId);
          if (
            set.components.some(
              (part) => !pendingItems.some((item) => item.itemInstanceId === part.itemInstanceId),
            )
          )
            return s.fail();
        }
        for (const profile of pendingProfiles) {
          if (
            profile.confirmedContentOrNull !== null ||
            !pendingItems.some((item) => item.itemInstanceId === profile.itemInstanceId)
          )
            return s.fail();
          ids.push(profile.reference.profileId, profile.reference.profileVersionId);
        }
        if (
          new Set(pendingProfiles.map((row) => row.itemInstanceId)).size !==
            pendingProfiles.length ||
          new Set(pendingSets.flatMap((set) => set.components.map((row) => row.itemInstanceId)))
            .size !== pendingSets.reduce((count, set) => count + set.components.length, 0)
        )
          return s.fail();
        return { items: pendingItems, linkedSets: pendingSets, customProfiles: pendingProfiles };
      })()
    : undefined;
  if (new Set(ids).size !== ids.length) return s.fail();
  return {
    items,
    effects,
    traumas,
    symbionts,
    wounds,
    ...(runtimeEffects === undefined ? {} : { runtimeEffects }),
    ...(linkedSets === undefined ? {} : { linkedSets }),
    ...(customProfiles === undefined ? {} : { customProfiles }),
    ...(coatings === undefined ? {} : { coatings }),
    ...(archivedCoatingPreparations === undefined ? {} : { archivedCoatingPreparations }),
    ...(pendingInventory === undefined ? {} : { pendingInventory }),
  };
}
/** Primitive immutable proof only. Owning GM history still replays the exact stage edit and ADD. */
export function npcChildIdentities(
  events: readonly NpcAttemptEvent[],
  operations: readonly NpcOperation[],
): readonly NpcChildIdentity[] {
  const byOperation = new Map(operations.map((o) => [o.operationId, o]));
  const result: NpcChildIdentity[] = [];
  for (const event of events) {
    const facts = npcEventAllocations(event);
    const operation = byOperation.get(event.operationId) ?? s.fail();
    equal(event.attempt.scope, operation.scope);
    equal(hash(event), operation.attemptEventSha256);
    const reserve =
      operation.request['messageType'] === 'network.npc-preparation.request' &&
      s.object(operation.request['preparation'])['kind'] === 'ITEM_RESERVE';
    if (reserve) {
      if (
        operation.kind !== 'REPLACE' ||
        event.attempt.stage !== 'NPC-015' ||
        operation.beforeGmSource.sourceFormId !== 'NPC-015' ||
        facts.length !== 1 ||
        facts[0]?.kind !== 'ITEM'
      )
        return s.fail();
    } else if (
      operation.request['messageType'] === 'network.npc-preparation.request' &&
      ['CUSTOM_ITEM_RESERVE', 'CUSTOM_MODIFIER_RESERVE', 'CUSTOM_PROFILE_VERSION_RESERVE'].includes(
        s.text(s.object(operation.request['preparation'])['kind']),
      )
    ) {
      const request = s.object(operation.request['preparation']),
        kind = request['kind'];
      if (
        operation.kind !== 'REPLACE' ||
        event.attempt.stage !== 'NPC-015' ||
        operation.beforeGmSource.sourceFormId !== 'NPC-015'
      )
        return s.fail();
      if (kind === 'CUSTOM_PROFILE_VERSION_RESERVE') {
        const version = facts[0];
        if (
          facts.length !== 1 ||
          version?.kind !== 'CUSTOM_PROFILE_VERSION' ||
          version.itemInstanceId !== request['itemInstanceId'] ||
          version.profileId !== request['profileId'] ||
          version.previousVersionIdOrNull !== request['expectedProfileVersionId']
        )
          return s.fail();
      } else {
        const offset = kind === 'CUSTOM_ITEM_RESERVE' ? 1 : 0,
          item = facts[0],
          profile = facts[offset],
          version = facts[offset + 1];
        if (
          facts.length !== offset + 2 ||
          (offset === 1 && item?.kind !== 'ITEM') ||
          profile?.kind !== 'CUSTOM_PROFILE' ||
          version?.kind !== 'CUSTOM_PROFILE_VERSION'
        )
          return s.fail();
        const itemInstanceId = offset === 1 ? item!.id : s.uuid(request['itemInstanceId']);
        equal(
          [
            profile.itemInstanceId,
            profile.profileKind,
            version.itemInstanceId,
            version.profileId,
            version.version,
            version.previousVersionIdOrNull,
          ],
          [
            itemInstanceId,
            offset === 1 ? 'CAMPAIGN_CUSTOM_PROFILE' : 'CATALOG_CUSTOM_MODIFIER',
            itemInstanceId,
            profile.id,
            1,
            null,
          ],
        );
      }
    } else if (
      operation.request['messageType'] === 'network.npc-preparation.request' &&
      s.object(operation.request['preparation'])['kind'] === 'COMPOSITE_ITEM_RESERVE'
    ) {
      const input = s.object(s.object(operation.request['preparation'])['input'], ['itemTypeId']);
      if (
        operation.kind !== 'REPLACE' ||
        event.attempt.stage !== 'NPC-015' ||
        operation.beforeGmSource.sourceFormId !== 'NPC-015' ||
        facts.length !== 3 ||
        facts[0]?.kind !== 'LINKED_SET' ||
        facts[0].itemTypeId !== input['itemTypeId'] ||
        facts[1]?.kind !== 'ITEM' ||
        facts[2]?.kind !== 'ITEM'
      )
        return s.fail();
    } else if (
      operation.request['messageType'] === 'network.npc-preparation.request' &&
      s.object(operation.request['preparation'])['kind'] === 'DISEASE_RESERVE'
    ) {
      const intent = s.object(operation.request['preparation'], ['kind', 'diseaseId']);
      if (
        operation.kind !== 'REPLACE' ||
        event.attempt.stage !== 'NPC-016' ||
        operation.beforeGmSource.sourceFormId !== 'NPC-016' ||
        facts.length !== 1 ||
        facts[0]?.kind !== 'EFFECT_INSTANCE' ||
        !('diseaseId' in facts[0]) ||
        facts[0].diseaseId !== disease(intent['diseaseId'])
      )
        return s.fail();
    } else if (
      operation.request['messageType'] === 'network.npc-preparation.request' &&
      [
        'ALCOHOL_PREPARE',
        'HP_MODE_PREPARE',
        'FORMAL_CONTROL_SET',
        'LIFE_STATE_SET',
        'WEAVER_STATE_PREPARE',
        'POISON_MODE_SET',
      ].includes(s.text(s.object(operation.request['preparation'])['kind']))
    ) {
      const kind = s.object(operation.request['preparation'])['kind'];
      if (
        operation.kind !== 'REPLACE' ||
        event.attempt.stage !== 'NPC-016' ||
        operation.beforeGmSource.sourceFormId !== 'NPC-016' ||
        (kind === 'HP_MODE_PREPARE' || kind === 'WEAVER_STATE_PREPARE' || kind === 'POISON_MODE_SET'
          ? facts.length !== 1
          : facts.length > 1)
      )
        return s.fail();
      const effect = facts[0];
      if (
        effect !== undefined &&
        (effect.kind !== 'EFFECT_INSTANCE' ||
          !('sourceKind' in effect) ||
          effect.sourceKind !==
            (kind === 'ALCOHOL_PREPARE'
              ? 'ALCOHOL'
              : kind === 'HP_MODE_PREPARE'
                ? 'HP_MODE'
                : kind === 'LIFE_STATE_SET'
                  ? 'LIFE_TIMER'
                  : kind === 'WEAVER_STATE_PREPARE'
                    ? 'WEAVER_STATE'
                    : kind === 'POISON_MODE_SET'
                      ? 'POISON_MODE'
                      : 'FORMAL_CONTROL'))
      )
        return s.fail();
      if (
        effect?.kind === 'EFFECT_INSTANCE' &&
        'sourceKind' in effect &&
        effect.sourceKind === 'FORMAL_CONTROL' &&
        effect.controlKind !==
          s.object(s.object(operation.request['preparation'])['input'])['controlKind']
      )
        return s.fail();
      if (
        effect?.kind === 'EFFECT_INSTANCE' &&
        'sourceKind' in effect &&
        effect.sourceKind === 'LIFE_TIMER' &&
        s.object(s.object(operation.request['preparation'])['input'])['lifeKind'] !==
          'SEVERELY_WOUNDED'
      )
        return s.fail();
      if (
        effect?.kind === 'EFFECT_INSTANCE' &&
        'sourceKind' in effect &&
        effect.sourceKind === 'WEAVER_STATE'
      ) {
        const input = s.object(s.object(operation.request['preparation'])['input']);
        equal(
          [effect.branch, effect.sourceInstanceId],
          [input['branch'], input['sourceInstanceId']],
        );
      }
      if (
        effect?.kind === 'EFFECT_INSTANCE' &&
        'sourceKind' in effect &&
        effect.sourceKind === 'POISON_MODE'
      )
        equal(
          effect.sourceInstanceId,
          s.object(s.object(operation.request['preparation'])['input'])['sourceInstanceId'],
        );
    } else if (
      operation.request['messageType'] === 'network.npc-preparation.request' &&
      s.object(operation.request['preparation'])['kind'] === 'POISON_COATING_PREPARE'
    ) {
      const intent = s.object(s.object(operation.request['preparation'])['input']);
      if (
        operation.kind !== 'REPLACE' ||
        event.attempt.stage !== 'NPC-015' ||
        operation.beforeGmSource.sourceFormId !== 'NPC-015' ||
        facts.length !== 1 ||
        facts[0]?.kind !== 'COATING_INSTANCE'
      )
        return s.fail();
      equal(
        [facts[0].itemInstanceId, facts[0].sourceInstanceId],
        [intent['targetItemInstanceId'], intent['sourceInstanceId']],
      );
    } else if (
      operation.request['messageType'] === 'network.npc-preparation.request' &&
      s.object(operation.request['preparation'])['kind'] === 'TRAUMA_RESERVE'
    ) {
      s.object(operation.request['preparation'], ['kind']);
      if (
        operation.kind !== 'REPLACE' ||
        event.attempt.stage !== 'NPC-016' ||
        operation.beforeGmSource.sourceFormId !== 'NPC-016' ||
        facts.length !== 1 ||
        facts[0]?.kind !== 'TRAUMA_INSTANCE'
      )
        return s.fail();
    } else if (
      operation.request['messageType'] === 'network.npc-preparation.request' &&
      s.object(operation.request['preparation'])['kind'] === 'SYMBIONT_RESERVE'
    ) {
      s.object(operation.request['preparation'], ['kind', 'values']);
      if (
        operation.kind !== 'REPLACE' ||
        event.attempt.stage !== 'NPC-013' ||
        operation.beforeGmSource.sourceFormId !== 'NPC-013' ||
        facts.length !== 1 ||
        facts[0]?.kind !== 'SYMBIONT_INSTANCE'
      )
        return s.fail();
    } else if (
      operation.request['messageType'] === 'network.npc-preparation.request' &&
      s.object(operation.request['preparation'])['kind'] === 'WOUND_PREPARE'
    ) {
      s.object(operation.request['preparation'], ['kind', 'input']);
      if (
        operation.kind !== 'REPLACE' ||
        event.attempt.stage !== 'NPC-016' ||
        operation.beforeGmSource.sourceFormId !== 'NPC-016' ||
        facts.length !== 1 ||
        facts[0]?.kind !== 'WOUND_INSTANCE'
      )
        return s.fail();
    } else if (operation.kind === 'COMMIT' || operation.kind === 'COMMIT_V1') {
      if (facts.some((f) => f.kind !== 'WEAPON_PROFILE_VERSION')) return s.fail();
    } else if (facts.length !== 0) return s.fail();
    for (const [index, allocation] of facts.entries())
      result.push({
        allocation,
        scope: event.attempt.scope,
        ownerNpcUuid: event.attempt.candidateNpcUuid,
        originDraftId: event.attempt.npcDraftId,
        originOperationId: event.operationId,
        originEventSha256: hash(event),
        originRevision: event.attempt.revision,
        ordinal: index + 1,
      });
  }
  if (new Set(result.map((v) => v.allocation.id)).size !== result.length) return s.fail();
  for (const child of result) {
    if (
      child.allocation.kind === 'EFFECT_INSTANCE' &&
      'sourceKind' in child.allocation &&
      child.allocation.sourceKind === 'POISON_MODE'
    ) {
      const allocation = child.allocation;
      const source =
        result.find(
          (c) =>
            c.allocation.kind === 'SYMBIONT_INSTANCE' &&
            c.allocation.id === allocation.sourceInstanceId,
        ) ?? s.fail();
      equal([source.scope, source.ownerNpcUuid], [child.scope, child.ownerNpcUuid]);
      if (
        source.originDraftId === child.originDraftId &&
        source.originRevision >= child.originRevision
      )
        return s.fail();
    }
    if (
      child.allocation.kind !== 'WEAPON_PROFILE_VERSION' &&
      child.allocation.kind !== 'CUSTOM_PROFILE' &&
      child.allocation.kind !== 'CUSTOM_PROFILE_VERSION' &&
      child.allocation.kind !== 'COATING_INSTANCE'
    )
      continue;
    const itemId = child.allocation.itemInstanceId;
    const item =
      result.find((c) => c.allocation.kind === 'ITEM' && c.allocation.id === itemId) ?? s.fail();
    equal([item.scope, item.ownerNpcUuid], [child.scope, child.ownerNpcUuid]);
    if (child.allocation.kind === 'COATING_INSTANCE') {
      const allocation = child.allocation;
      const source =
        result.find(
          (c) =>
            c.allocation.kind === 'SYMBIONT_INSTANCE' &&
            c.allocation.id === allocation.sourceInstanceId,
        ) ?? s.fail();
      equal([source.scope, source.ownerNpcUuid], [child.scope, child.ownerNpcUuid]);
      if (
        (item.originDraftId === child.originDraftId &&
          item.originRevision >= child.originRevision) ||
        (source.originDraftId === child.originDraftId &&
          source.originRevision >= child.originRevision)
      )
        return s.fail();
    }
    if (child.allocation.kind === 'CUSTOM_PROFILE_VERSION') {
      customReferenceFromChildren(child, result);
      const allocation = child.allocation;
      if (allocation.previousVersionIdOrNull !== null) {
        const previous =
          result.find((c) => c.allocation.id === allocation.previousVersionIdOrNull) ?? s.fail();
        if (previous.allocation.kind !== 'CUSTOM_PROFILE_VERSION') return s.fail();
        equal(
          [
            previous.scope,
            previous.ownerNpcUuid,
            previous.allocation.itemInstanceId,
            previous.allocation.profileId,
            s.increment(previous.allocation.version),
          ],
          [
            child.scope,
            child.ownerNpcUuid,
            allocation.itemInstanceId,
            allocation.profileId,
            allocation.version,
          ],
        );
      }
    }
  }
  return result;
}
function indexTuple(c: NpcChildIdentity): readonly (string | number | null)[] {
  return [
    c.allocation.id,
    c.scope.campaignId,
    c.ownerNpcUuid,
    c.originDraftId,
    c.originOperationId,
    c.ordinal,
    c.allocation.kind,
    'itemInstanceId' in c.allocation ? c.allocation.itemInstanceId : null,
    c.allocation.kind === 'WEAPON_PROFILE_VERSION' ? c.allocation.weaponVariantId : null,
  ];
}
export function verifyNpcChildIndex(
  db: Database.Database,
  campaignId: string,
  children: readonly NpcChildIdentity[],
): void {
  for (const child of children) {
    s.assertUnusedOutsideNpc(db, child.allocation.id);
    if (legacyLocalIdentityInUse(db, child.allocation.id)) return s.fail('IDEMPOTENCY_CONFLICT');
  }
  const rows = db
    .prepare('SELECT * FROM npc_child_identity WHERE campaign_id=? ORDER BY child_id')
    .all(campaignId) as Record<string, unknown>[];
  const stored = rows.map((r) => [
    r['child_id'],
    r['campaign_id'],
    r['owner_npc_uuid'],
    r['origin_draft_id'],
    r['origin_operation_id'],
    r['ordinal'],
    r['kind'],
    r['item_instance_id'],
    r['weapon_variant_id'],
  ]);
  equal(
    stored,
    [...children].sort((a, b) => (a.allocation.id < b.allocation.id ? -1 : 1)).map(indexTuple),
  );
}
export function writeNpcChildIndex(
  db: Database.Database,
  children: readonly NpcChildIdentity[],
): void {
  for (const child of children)
    db.prepare('INSERT INTO npc_child_identity VALUES (?,?,?,?,?,?,?,?,?)').run(
      ...indexTuple(child),
    );
}
/** Cross-draft preparations require an actual checked archived reference or selected publication. */
export type NpcRestoredInventoryGraph = Pick<
  NpcPublishedChildGraph,
  'items' | 'linkedSets' | 'customProfiles' | 'coatings' | 'archivedCoatingPreparations'
>;
export function npcAttemptReadContext(
  attempt: NpcAttempt,
  operationId: string,
  children: readonly NpcChildIdentity[],
  inherited: Readonly<{ version: NpcVersion; graph: NpcPublishedChildGraph }> | null,
  pendingItemId: string | null = null,
  pendingEffect: Readonly<{ effectInstanceId: string; diseaseId: DiseaseId }> | null = null,
  pendingTraumaId: string | null = null,
  pendingSymbiontId: string | null = null,
  pendingWoundId: string | null = null,
  pendingRuntimeEffect:
    (NpcRuntimeEffectSource & Readonly<{ effectInstanceId: string }>) | null = null,
  pendingComposite: NpcLinkedSetBinding | null = null,
  pendingCustomProfile: NpcPendingCustomProfile | null = null,
  restoredInventory: NpcRestoredInventoryGraph | null = null,
  pendingCoating: Readonly<{
    coatingInstanceId: string;
    itemInstanceId: string;
    sourceInstanceId: string;
  }> | null = null,
): NpcAttemptReadContext {
  const a = attempt;
  if (
    [
      pendingItemId,
      pendingEffect,
      pendingTraumaId,
      pendingSymbiontId,
      pendingWoundId,
      pendingRuntimeEffect,
      pendingComposite,
      pendingCustomProfile,
      pendingCoating,
    ].filter((v) => v !== null).length > 1
  )
    return s.fail();
  if (inherited !== null) {
    equal(inherited.version.scope, a.scope);
    equal(a.targetOrNull, {
      npcUuid: inherited.version.npcUuid,
      expectedCurrentVersion: inherited.version.version,
    });
  } else if (a.targetOrNull !== null) return s.fail();
  const owned = children.filter(
    (c) =>
      c.allocation.kind === 'ITEM' &&
      s.same(c.scope, a.scope) &&
      c.ownerNpcUuid === a.candidateNpcUuid &&
      c.originDraftId === a.npcDraftId &&
      c.originRevision <= a.revision,
  );
  for (const item of [...(inherited?.graph.items ?? []), ...(restoredInventory?.items ?? [])]) {
    const source =
      children.find(
        (c) =>
          c.allocation.kind === 'ITEM' &&
          c.allocation.id === item.itemInstanceId &&
          s.same(c.scope, a.scope) &&
          c.ownerNpcUuid === a.candidateNpcUuid,
      ) ?? s.fail();
    if (!owned.includes(source)) owned.push(source);
  }
  const restoredWeaponProfiles: NonNullable<
    NpcAttemptReadContext['restoredWeaponProfiles']
  >[number][] = [];
  const restoredProfileIds = new Set<string>(),
    restoredProfileVariants = new Set<string>();
  for (const item of restoredInventory?.items ?? []) {
    for (const profile of item.profileVersions) {
      if (inherited === null || a.mode !== 'APPEND_N_PLUS_ONE') return s.fail();
      const itemInstanceId = s.uuid(item.itemInstanceId),
        weaponProfileVersionId = s.uuid(profile.weaponProfileVersionId),
        weaponVariantId = variant(profile.weaponVariantId),
        variantKey = s.canonical([itemInstanceId, weaponVariantId]);
      const fact =
        children.find((child) => child.allocation.id === weaponProfileVersionId) ?? s.fail();
      if (
        fact.allocation.kind !== 'WEAPON_PROFILE_VERSION' ||
        !s.same(fact.scope, a.scope) ||
        fact.ownerNpcUuid !== a.candidateNpcUuid ||
        fact.allocation.itemInstanceId !== itemInstanceId ||
        fact.allocation.weaponVariantId !== weaponVariantId ||
        fact.originOperationId === operationId ||
        fact.originDraftId === a.npcDraftId ||
        restoredProfileIds.has(weaponProfileVersionId) ||
        restoredProfileVariants.has(variantKey)
      )
        return s.fail();
      restoredProfileIds.add(weaponProfileVersionId);
      restoredProfileVariants.add(variantKey);
      restoredWeaponProfiles.push(
        Object.freeze({
          itemInstanceId,
          weaponProfileVersionId,
          weaponVariantId,
          originOperationId: fact.originOperationId,
          originDraftId: fact.originDraftId,
          originEventSha256: fact.originEventSha256,
        }),
      );
    }
  }
  if (pendingItemId !== null && owned.some((c) => c.allocation.id === pendingItemId))
    return s.fail();
  const ownedEffects = children.filter(
    (c) =>
      c.allocation.kind === 'EFFECT_INSTANCE' &&
      'diseaseId' in c.allocation &&
      s.same(c.scope, a.scope) &&
      c.ownerNpcUuid === a.candidateNpcUuid &&
      c.originDraftId === a.npcDraftId &&
      c.originRevision <= a.revision,
  );
  for (const effect of inherited?.graph.effects ?? []) {
    const source =
      children.find(
        (c) =>
          c.allocation.kind === 'EFFECT_INSTANCE' &&
          'diseaseId' in c.allocation &&
          c.allocation.id === effect.effectInstanceId &&
          c.allocation.diseaseId === effect.diseaseId &&
          s.same(c.scope, a.scope) &&
          c.ownerNpcUuid === a.candidateNpcUuid,
      ) ?? s.fail();
    if (!ownedEffects.includes(source)) ownedEffects.push(source);
  }
  if (pendingItemId !== null && ownedEffects.some((c) => c.allocation.id === pendingItemId))
    return s.fail();
  if (
    pendingEffect !== null &&
    (ownedEffects.some((c) => c.allocation.id === pendingEffect.effectInstanceId) ||
      owned.some((c) => c.allocation.id === pendingEffect.effectInstanceId))
  )
    return s.fail();
  const ownedTraumas = children.filter(
    (c) =>
      c.allocation.kind === 'TRAUMA_INSTANCE' &&
      s.same(c.scope, a.scope) &&
      c.ownerNpcUuid === a.candidateNpcUuid &&
      c.originDraftId === a.npcDraftId &&
      c.originRevision <= a.revision,
  );
  for (const trauma of inherited?.graph.traumas ?? []) {
    const source =
      children.find(
        (c) =>
          c.allocation.kind === 'TRAUMA_INSTANCE' &&
          c.allocation.id === trauma.traumaInstanceId &&
          s.same(c.scope, a.scope) &&
          c.ownerNpcUuid === a.candidateNpcUuid,
      ) ?? s.fail();
    if (!ownedTraumas.includes(source)) ownedTraumas.push(source);
  }
  const ownedSymbionts = children.filter(
    (c) =>
      c.allocation.kind === 'SYMBIONT_INSTANCE' &&
      s.same(c.scope, a.scope) &&
      c.ownerNpcUuid === a.candidateNpcUuid &&
      c.originDraftId === a.npcDraftId &&
      c.originRevision <= a.revision,
  );
  for (const symbiont of inherited?.graph.symbionts ?? []) {
    const source =
      children.find(
        (c) =>
          c.allocation.kind === 'SYMBIONT_INSTANCE' &&
          c.allocation.id === symbiont.symbiontInstanceId &&
          s.same(c.scope, a.scope) &&
          c.ownerNpcUuid === a.candidateNpcUuid,
      ) ?? s.fail();
    if (!ownedSymbionts.includes(source)) ownedSymbionts.push(source);
  }
  const ownedWounds = children.filter(
    (c) =>
      c.allocation.kind === 'WOUND_INSTANCE' &&
      s.same(c.scope, a.scope) &&
      c.ownerNpcUuid === a.candidateNpcUuid &&
      c.originDraftId === a.npcDraftId &&
      c.originRevision <= a.revision,
  );
  for (const wound of inherited?.graph.wounds ?? []) {
    const origin =
      children.find(
        (c) =>
          c.allocation.kind === 'WOUND_INSTANCE' &&
          c.allocation.id === wound.woundInstanceId &&
          c.originOperationId === wound.originOperationId &&
          s.same(c.scope, a.scope) &&
          c.ownerNpcUuid === a.candidateNpcUuid,
      ) ?? s.fail();
    if (!ownedWounds.includes(origin)) ownedWounds.push(origin);
  }
  const ownedRuntimeEffects = children.filter(
    (c) =>
      c.allocation.kind === 'EFFECT_INSTANCE' &&
      'sourceKind' in c.allocation &&
      s.same(c.scope, a.scope) &&
      c.ownerNpcUuid === a.candidateNpcUuid &&
      c.originDraftId === a.npcDraftId &&
      c.originRevision <= a.revision,
  );
  for (const effect of inherited?.graph.runtimeEffects ?? []) {
    const origin =
      children.find(
        (c) =>
          c.allocation.kind === 'EFFECT_INSTANCE' &&
          'sourceKind' in c.allocation &&
          c.allocation.id === effect.effectInstanceId &&
          s.same(c.scope, a.scope) &&
          c.ownerNpcUuid === a.candidateNpcUuid,
      ) ?? s.fail();
    if (origin.allocation.kind !== 'EFFECT_INSTANCE' || !('sourceKind' in origin.allocation))
      return s.fail();
    const { effectInstanceId: _id, originCommitOperationId: _origin, ...source } = effect;
    equal(npcRuntimeEffectAllocationSource(origin.allocation), source);
    if (!ownedRuntimeEffects.includes(origin)) ownedRuntimeEffects.push(origin);
  }
  const ownedCoatings = children.filter(
    (child) =>
      child.allocation.kind === 'COATING_INSTANCE' &&
      s.same(child.scope, a.scope) &&
      child.ownerNpcUuid === a.candidateNpcUuid &&
      child.originDraftId === a.npcDraftId &&
      child.originRevision <= a.revision,
  );
  for (const coating of [
    ...(inherited?.graph.coatings ?? []),
    ...(restoredInventory?.coatings ?? []),
    ...(inherited?.graph.archivedCoatingPreparations ?? []),
    ...(restoredInventory?.archivedCoatingPreparations ?? []),
  ]) {
    const child = children.find((c) => c.allocation.id === coating.coatingInstanceId) ?? s.fail();
    if (
      child.allocation.kind !== 'COATING_INSTANCE' ||
      !s.same(child.scope, a.scope) ||
      child.ownerNpcUuid !== a.candidateNpcUuid
    )
      return s.fail();
    equal(
      [child.allocation.itemInstanceId, child.allocation.sourceInstanceId],
      [coating.itemInstanceId, coating.sourceInstanceId],
    );
    if (!ownedCoatings.includes(child)) ownedCoatings.push(child);
  }
  if (pendingCoating !== null) {
    npcChildAllocationsValue([
      {
        kind: 'COATING_INSTANCE',
        id: pendingCoating.coatingInstanceId,
        itemInstanceId: pendingCoating.itemInstanceId,
        sourceInstanceId: pendingCoating.sourceInstanceId,
      },
    ]);
    if (
      children.some((child) => child.allocation.id === pendingCoating.coatingInstanceId) ||
      !owned.some((child) => child.allocation.id === pendingCoating.itemInstanceId) ||
      !ownedSymbionts.some((child) => child.allocation.id === pendingCoating.sourceInstanceId)
    )
      return s.fail();
  }
  const ownedSets = children.filter(
    (c) =>
      c.allocation.kind === 'LINKED_SET' &&
      s.same(c.scope, a.scope) &&
      c.ownerNpcUuid === a.candidateNpcUuid &&
      c.originDraftId === a.npcDraftId &&
      c.originRevision <= a.revision,
  );
  for (const set of [
    ...(inherited?.graph.linkedSets ?? []),
    ...(restoredInventory?.linkedSets ?? []),
  ]) {
    const origin =
      children.find(
        (c) =>
          c.allocation.kind === 'LINKED_SET' &&
          c.allocation.id === set.linkedSetInstanceId &&
          s.same(c.scope, a.scope) &&
          c.ownerNpcUuid === a.candidateNpcUuid,
      ) ?? s.fail();
    equal(linkedSetFromChildren(origin, children), set);
    if (!ownedSets.includes(origin)) ownedSets.push(origin);
  }
  const linkedSets = ownedSets.map((c) => linkedSetFromChildren(c, children));
  const customProfiles: NpcCustomProfileBinding[] = [];
  const inheritedProfiles = inherited?.graph.customProfiles ?? [];
  // Published profiles require content; an independently checked PREPARE carrier
  // selected by ITEM_RESTORE retains its unconfirmed content until first publication.
  for (const binding of inheritedProfiles)
    if (binding.confirmedContentOrNull === null) return s.fail();
  for (const binding of [...inheritedProfiles, ...(restoredInventory?.customProfiles ?? [])]) {
    const source =
      children.find((c) => c.allocation.id === binding.reference.profileVersionId) ?? s.fail();
    equal(customReferenceFromChildren(source, children), binding.reference);
    if (
      !s.same(source.scope, a.scope) ||
      source.ownerNpcUuid !== a.candidateNpcUuid ||
      source.allocation.kind !== 'CUSTOM_PROFILE_VERSION' ||
      source.allocation.itemInstanceId !== binding.itemInstanceId
    )
      return s.fail();
    const present = customProfiles.find(
      (row) => row.reference.profileVersionId === binding.reference.profileVersionId,
    );
    if (present === undefined) customProfiles.push(npcCustomProfileBindingValue(binding));
    else equal(present, binding);
  }
  for (const child of children) {
    if (
      child.allocation.kind !== 'CUSTOM_PROFILE_VERSION' ||
      !s.same(child.scope, a.scope) ||
      child.ownerNpcUuid !== a.candidateNpcUuid ||
      child.originDraftId !== a.npcDraftId ||
      child.originRevision > a.revision
    )
      continue;
    const binding = {
      itemInstanceId: child.allocation.itemInstanceId,
      reference: customReferenceFromChildren(child, children),
      confirmedContentOrNull: null,
    };
    const inheritedBinding = customProfiles.find(
      (b) => b.reference.profileVersionId === binding.reference.profileVersionId,
    );
    if (inheritedBinding === undefined) customProfiles.push(binding);
  }
  if (pendingCustomProfile !== null) {
    const binding = npcCustomProfileBindingValue({
      itemInstanceId: pendingCustomProfile.itemInstanceId,
      reference: pendingCustomProfile.reference,
      confirmedContentOrNull: null,
    });
    equal(binding.reference.reservationOperationId, operationId);
    if (typeof pendingCustomProfile.newItem !== 'boolean') return s.fail();
    const occupied = children.map((c) => c.allocation.id);
    if (occupied.includes(binding.reference.profileVersionId)) return s.fail();
    const prior = customProfiles.filter((b) => b.itemInstanceId === binding.itemInstanceId);
    if (prior.length === 0) {
      if (binding.reference.version !== 1 || occupied.includes(binding.reference.profileId))
        return s.fail();
    } else {
      const old =
        prior.find(
          (b) =>
            b.reference.profileId === binding.reference.profileId &&
            b.confirmedContentOrNull !== null,
        ) ?? s.fail();
      if (prior.some((b) => b.confirmedContentOrNull === null)) return s.fail();
      equal(
        [binding.reference.kind, binding.reference.version],
        [old.reference.kind, s.increment(old.reference.version)],
      );
    }
    if (pendingCustomProfile.newItem) {
      if (
        occupied.includes(binding.itemInstanceId) ||
        binding.reference.kind !== 'CAMPAIGN_CUSTOM_PROFILE'
      )
        return s.fail();
    } else if (!owned.some((c) => c.allocation.id === binding.itemInstanceId)) return s.fail();
  }
  if (pendingComposite !== null) {
    npcLinkedSetBindingValue(pendingComposite);
    const ids = [
      pendingComposite.linkedSetInstanceId,
      ...pendingComposite.components.map((c) => c.itemInstanceId),
    ];
    if (children.some((c) => ids.includes(c.allocation.id))) return s.fail();
  }
  const pendingId =
    pendingItemId ??
    pendingEffect?.effectInstanceId ??
    pendingTraumaId ??
    pendingSymbiontId ??
    pendingWoundId ??
    pendingRuntimeEffect?.effectInstanceId ??
    pendingCoating?.coatingInstanceId ??
    null;
  if (
    pendingId !== null &&
    [
      ...owned,
      ...ownedEffects,
      ...ownedTraumas,
      ...ownedSymbionts,
      ...ownedWounds,
      ...ownedRuntimeEffects,
      ...ownedCoatings,
    ].some((c) => c.allocation.id === pendingId)
  )
    return s.fail();
  const context: NpcAttemptReadContext = {
    ...(restoredWeaponProfiles.length === 0
      ? {}
      : { restoredWeaponProfiles: Object.freeze(restoredWeaponProfiles) }),
    ...(ownedCoatings.length === 0
      ? {}
      : {
          coatingBindings: Object.freeze(
            ownedCoatings.map((child) => {
              if (child.allocation.kind !== 'COATING_INSTANCE') return s.fail();
              const retained = [
                ...(inherited?.graph.coatings ?? []),
                ...(restoredInventory?.coatings ?? []),
              ].find((row) => row.coatingInstanceId === child.allocation.id);
              const archived = [
                ...(inherited?.graph.archivedCoatingPreparations ?? []),
                ...(restoredInventory?.archivedCoatingPreparations ?? []),
              ].find((row) => row.coatingInstanceId === child.allocation.id);
              if (archived !== undefined)
                equal(archived.preparationOperationId, child.originOperationId);
              return Object.freeze({
                coatingInstanceId: child.allocation.id,
                itemInstanceId: child.allocation.itemInstanceId,
                sourceInstanceId: child.allocation.sourceInstanceId,
                originOperationId: child.originOperationId,
                originDraftId: child.originDraftId,
                originEventSha256: child.originEventSha256,
                retainedOriginCommitOperationIdOrNull:
                  retained?.originCommitOperationId ??
                  archived?.publishedOriginCommitOperationIdOrNull ??
                  null,
                ...(archived === undefined
                  ? {}
                  : { retainedPreparationOperationIdOrNull: archived.preparationOperationId }),
              });
            }),
          ),
        }),
    ...(pendingCoating === null
      ? {}
      : {
          pendingCoatingOrNull: Object.freeze({
            ...pendingCoating,
            operationId,
            npcDraftId: a.npcDraftId,
          }),
        }),
    ...(customProfiles.length === 0 ? {} : { customProfiles: Object.freeze(customProfiles) }),
    ...(pendingCustomProfile === null
      ? {}
      : { pendingCustomProfileOrNull: Object.freeze(pendingCustomProfile) }),
    ...(linkedSets.length === 0 ? {} : { linkedSets: Object.freeze(linkedSets) }),
    ...(pendingComposite === null
      ? {}
      : { pendingCompositeOrNull: Object.freeze(pendingComposite) }),
    ...(ownedRuntimeEffects.length === 0
      ? {}
      : {
          runtimeEffectBindings: Object.freeze(
            ownedRuntimeEffects.map((child) => {
              if (
                child.allocation.kind !== 'EFFECT_INSTANCE' ||
                !('sourceKind' in child.allocation)
              )
                return s.fail();
              return Object.freeze({
                effectInstanceId: child.allocation.id,
                ...npcRuntimeEffectAllocationSource(child.allocation),
                originOperationId: child.originOperationId,
                originDraftId: child.originDraftId,
                originEventSha256: child.originEventSha256,
              });
            }),
          ),
        }),
    ...(pendingRuntimeEffect === null
      ? {}
      : {
          pendingRuntimeEffectOrNull: Object.freeze({
            ...pendingRuntimeEffect,
            operationId,
            npcDraftId: a.npcDraftId,
          }),
        }),
    woundBindings: Object.freeze(
      ownedWounds.map((c) =>
        Object.freeze({
          woundInstanceId: c.allocation.id,
          originOperationId: c.originOperationId,
          originDraftId: c.originDraftId,
          originEventSha256: c.originEventSha256,
        }),
      ),
    ),
    pendingWoundOrNull:
      pendingWoundId === null
        ? null
        : Object.freeze({
            woundInstanceId: s.uuid(pendingWoundId),
            operationId,
            npcDraftId: a.npcDraftId,
          }),
    scope: Object.freeze({ ...a.scope }),
    npcDraftId: a.npcDraftId,
    candidateNpcUuid: a.candidateNpcUuid,
    revision: a.revision,
    operationId,
    inheritedVersionOrNull:
      inherited === null
        ? null
        : Object.freeze({
            npcUuid: inherited.version.npcUuid,
            version: inherited.version.version,
            sha256: hash(inherited.version),
          }),
    itemBindings: Object.freeze(
      owned.map((c) =>
        Object.freeze({
          itemInstanceId: c.allocation.id,
          originOperationId: c.originOperationId,
          originDraftId: c.originDraftId,
          originEventSha256: c.originEventSha256,
        }),
      ),
    ),
    symbiontBindings: Object.freeze(
      ownedSymbionts.map((c) =>
        Object.freeze({
          symbiontInstanceId: c.allocation.id,
          originOperationId: c.originOperationId,
          originDraftId: c.originDraftId,
          originEventSha256: c.originEventSha256,
          retainedSpeciesKeyOrNull:
            inherited?.graph.symbionts.find((x) => x.symbiontInstanceId === c.allocation.id)
              ?.speciesKey ?? null,
        }),
      ),
    ),
    pendingSymbiontOrNull:
      pendingSymbiontId === null
        ? null
        : Object.freeze({
            symbiontInstanceId: s.uuid(pendingSymbiontId),
            operationId,
            npcDraftId: a.npcDraftId,
          }),
    traumaBindings: Object.freeze(
      ownedTraumas.map((c) =>
        Object.freeze({
          traumaInstanceId: c.allocation.id,
          originOperationId: c.originOperationId,
          originDraftId: c.originDraftId,
          originEventSha256: c.originEventSha256,
          retainedRowOrNull: (() => {
            const retained = inherited?.graph.traumas.find(
              (t) => t.traumaInstanceId === c.allocation.id,
            );
            if (retained === undefined) return null;
            const input = readNpcTraumaEditorRow(retained.input);
            equal(input.traumaInstanceId, c.allocation.id);
            return input;
          })(),
        }),
      ),
    ),
    pendingTraumaOrNull:
      pendingTraumaId === null
        ? null
        : Object.freeze({
            traumaInstanceId: s.uuid(pendingTraumaId),
            operationId,
            npcDraftId: a.npcDraftId,
          }),
    effectBindings: Object.freeze(
      ownedEffects.map((c) => {
        if (c.allocation.kind !== 'EFFECT_INSTANCE' || !('diseaseId' in c.allocation))
          return s.fail();
        return Object.freeze({
          effectInstanceId: c.allocation.id,
          diseaseId: c.allocation.diseaseId,
          originOperationId: c.originOperationId,
          originDraftId: c.originDraftId,
          originEventSha256: c.originEventSha256,
        });
      }),
    ),
    pendingEffectOrNull:
      pendingEffect === null
        ? null
        : Object.freeze({
            effectInstanceId: s.uuid(pendingEffect.effectInstanceId),
            diseaseId: disease(pendingEffect.diseaseId),
            operationId,
            npcDraftId: a.npcDraftId,
          }),
    pendingItemOrNull:
      pendingItemId === null
        ? null
        : Object.freeze({
            itemInstanceId: s.uuid(pendingItemId),
            operationId,
            npcDraftId: a.npcDraftId,
          }),
  };
  return Object.freeze(context);
}
/** The domain's graph must be recomputed; this checks only its immutable ownership/allocation edges. */
export function verifyNpcPublishedChildren(
  version: NpcVersion,
  graph: NpcPublishedChildGraph,
  previousGraph: NpcPublishedChildGraph | null,
  children: readonly NpcChildIdentity[],
  context: NpcAttemptReadContext,
): void {
  equal(
    [
      context.scope,
      context.npcDraftId,
      context.candidateNpcUuid,
      context.revision,
      context.operationId,
      context.pendingItemOrNull,
      context.pendingEffectOrNull,
      context.pendingTraumaOrNull,
      context.pendingSymbiontOrNull,
      context.pendingWoundOrNull,
      context.pendingRuntimeEffectOrNull ?? null,
      context.pendingCompositeOrNull ?? null,
      context.pendingCustomProfileOrNull ?? null,
      context.pendingCoatingOrNull ?? null,
    ],
    [
      version.scope,
      version.npcDraftId,
      version.npcUuid,
      version.attemptRevision,
      version.operationId,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
  );
  if ((previousGraph === null) !== (context.inheritedVersionOrNull === null)) return s.fail();
  // Pending carrier identities come from independently checked PREPARE physical
  // evidence. They are not published item/profile versions and grant no active
  // editor binding until the owning ITEM_RESTORE event selects that actual group.
  for (const item of graph.pendingInventory?.items ?? []) {
    const child = children.find((row) => row.allocation.id === item.itemInstanceId) ?? s.fail();
    if (
      child.allocation.kind !== 'ITEM' ||
      !s.same(child.scope, version.scope) ||
      child.ownerNpcUuid !== version.npcUuid
    )
      return s.fail();
    equal(child.originOperationId, item.originOperationId);
  }
  for (const set of graph.pendingInventory?.linkedSets ?? []) {
    const child = children.find((row) => row.allocation.id === set.linkedSetInstanceId) ?? s.fail();
    if (!s.same(child.scope, version.scope) || child.ownerNpcUuid !== version.npcUuid)
      return s.fail();
    equal(linkedSetFromChildren(child, children), set);
  }
  for (const binding of graph.pendingInventory?.customProfiles ?? []) {
    const child =
      children.find((row) => row.allocation.id === binding.reference.profileVersionId) ?? s.fail();
    if (
      binding.confirmedContentOrNull !== null ||
      child.allocation.kind !== 'CUSTOM_PROFILE_VERSION' ||
      child.allocation.itemInstanceId !== binding.itemInstanceId ||
      !s.same(child.scope, version.scope) ||
      child.ownerNpcUuid !== version.npcUuid
    )
      return s.fail();
    equal(customReferenceFromChildren(child, children), binding.reference);
  }
  for (const binding of graph.customProfiles ?? []) {
    const current =
      context.customProfiles?.find(
        (b) => b.reference.profileVersionId === binding.reference.profileVersionId,
      ) ?? s.fail();
    equal([current.itemInstanceId, current.reference], [binding.itemInstanceId, binding.reference]);
    if (binding.confirmedContentOrNull === null) return s.fail();
    if (current.confirmedContentOrNull !== null)
      equal(current.confirmedContentOrNull, binding.confirmedContentOrNull);
    const child =
      children.find((c) => c.allocation.id === binding.reference.profileVersionId) ?? s.fail();
    equal(customReferenceFromChildren(child, children), binding.reference);
    if (
      !s.same(child.scope, version.scope) ||
      child.ownerNpcUuid !== version.npcUuid ||
      child.allocation.kind !== 'CUSTOM_PROFILE_VERSION' ||
      child.allocation.itemInstanceId !== binding.itemInstanceId
    )
      return s.fail();
    const old =
      previousGraph?.customProfiles?.find(
        (b) => b.reference.profileId === binding.reference.profileId,
      ) ??
      context.customProfiles?.find(
        (b) =>
          b.reference.profileId === binding.reference.profileId &&
          b.confirmedContentOrNull !== null,
      );
    if (old?.reference.profileVersionId === binding.reference.profileVersionId) equal(old, binding);
    else if (current.confirmedContentOrNull !== null) {
      // Actual restoration may come from an older selected version, even when
      // the immediate predecessor omitted this physical item.
      equal(current, binding);
    } else {
      // A scoped unconfirmed binding may be an actual pending carrier restored
      // from PREPARE. Its first publication keeps the allocated version identity.
      equal(
        [child.allocation.previousVersionIdOrNull, child.allocation.version],
        [
          old?.reference.profileVersionId ?? null,
          old === undefined ? 1 : s.increment(old.reference.version),
        ],
      );
    }
  }
  const oldProfiles = new Map(
    (previousGraph?.items ?? []).flatMap((item) =>
      item.profileVersions.map(
        (p) => [p.weaponProfileVersionId, { itemInstanceId: item.itemInstanceId, ...p }] as const,
      ),
    ),
  );
  for (const set of graph.linkedSets ?? []) {
    const binding =
      context.linkedSets?.find((b) => b.linkedSetInstanceId === set.linkedSetInstanceId) ??
      s.fail();
    equal(binding, set);
    const child = children.find((c) => c.allocation.id === set.linkedSetInstanceId) ?? s.fail();
    equal(linkedSetFromChildren(child, children), set);
    if (!s.same(child.scope, version.scope) || child.ownerNpcUuid !== version.npcUuid)
      return s.fail();
    const old = previousGraph?.linkedSets?.find(
      (b) => b.linkedSetInstanceId === set.linkedSetInstanceId,
    );
    if (old !== undefined) equal(old, set);
    // The exact scoped binding above also covers an older whole group restored
    // from published or pending history; no new linked-set identity is inferred.
  }
  for (const wound of graph.wounds) {
    const binding =
      context.woundBindings.find((b) => b.woundInstanceId === wound.woundInstanceId) ?? s.fail();
    const child = children.find((c) => c.allocation.id === wound.woundInstanceId) ?? s.fail();
    if (
      child.allocation.kind !== 'WOUND_INSTANCE' ||
      !s.same(child.scope, version.scope) ||
      child.ownerNpcUuid !== version.npcUuid
    )
      return s.fail();
    equal(
      [binding.originOperationId, binding.originDraftId, binding.originEventSha256],
      [child.originOperationId, child.originDraftId, child.originEventSha256],
    );
    equal(wound.originOperationId, child.originOperationId);
    const old = previousGraph?.wounds.find((w) => w.woundInstanceId === wound.woundInstanceId);
    if (old !== undefined) equal(wound, old);
    else if (child.originDraftId !== version.npcDraftId) return s.fail();
  }
  const oldEffects = new Map((previousGraph?.effects ?? []).map((e) => [e.effectInstanceId, e]));
  for (const effect of graph.effects) {
    const binding =
      context.effectBindings.find(
        (b) => b.effectInstanceId === effect.effectInstanceId && b.diseaseId === effect.diseaseId,
      ) ?? s.fail();
    const fact = children.find((c) => c.allocation.id === effect.effectInstanceId) ?? s.fail();
    if (
      fact.allocation.kind !== 'EFFECT_INSTANCE' ||
      !('diseaseId' in fact.allocation) ||
      fact.allocation.diseaseId !== effect.diseaseId ||
      !s.same(fact.scope, version.scope) ||
      fact.ownerNpcUuid !== version.npcUuid
    )
      return s.fail();
    equal(
      [binding.originOperationId, binding.originDraftId, binding.originEventSha256],
      [fact.originOperationId, fact.originDraftId, fact.originEventSha256],
    );
    const previous = oldEffects.get(effect.effectInstanceId);
    if (previous !== undefined) equal(effect, previous);
    else if (
      effect.originCommitOperationId !== version.operationId ||
      fact.originDraftId !== version.npcDraftId
    )
      return s.fail();
  }
  for (const effect of graph.runtimeEffects ?? []) {
    const binding =
      context.runtimeEffectBindings?.find((b) => b.effectInstanceId === effect.effectInstanceId) ??
      s.fail();
    const child = children.find((c) => c.allocation.id === effect.effectInstanceId) ?? s.fail();
    if (
      child.allocation.kind !== 'EFFECT_INSTANCE' ||
      !('sourceKind' in child.allocation) ||
      !s.same(child.scope, version.scope) ||
      child.ownerNpcUuid !== version.npcUuid
    )
      return s.fail();
    equal(
      [binding.originOperationId, binding.originDraftId, binding.originEventSha256],
      [child.originOperationId, child.originDraftId, child.originEventSha256],
    );
    const { effectInstanceId: _id, originCommitOperationId: _origin, ...source } = effect;
    equal(npcRuntimeEffectAllocationSource(child.allocation), source);
    const old = previousGraph?.runtimeEffects?.find(
      (e) => e.effectInstanceId === effect.effectInstanceId,
    );
    if (old !== undefined) equal(effect, old);
    else if (
      effect.originCommitOperationId !== version.operationId ||
      child.originDraftId !== version.npcDraftId
    )
      return s.fail();
  }
  for (const archived of graph.archivedCoatingPreparations ?? []) {
    const binding =
      context.coatingBindings?.find(
        (row) => row.coatingInstanceId === archived.coatingInstanceId,
      ) ?? s.fail();
    const child =
      children.find((row) => row.allocation.id === archived.coatingInstanceId) ?? s.fail();
    if (
      child.allocation.kind !== 'COATING_INSTANCE' ||
      !s.same(child.scope, version.scope) ||
      child.ownerNpcUuid !== version.npcUuid
    )
      return s.fail();
    equal(
      [archived.itemInstanceId, archived.sourceInstanceId, archived.preparationOperationId],
      [child.allocation.itemInstanceId, child.allocation.sourceInstanceId, child.originOperationId],
    );
    equal(
      [binding.originOperationId, binding.originDraftId, binding.originEventSha256],
      [child.originOperationId, child.originDraftId, child.originEventSha256],
    );
    equal(
      archived.publishedOriginCommitOperationIdOrNull,
      binding.retainedOriginCommitOperationIdOrNull,
    );
    if (
      child.originDraftId !== version.npcDraftId &&
      binding.retainedPreparationOperationIdOrNull !== child.originOperationId &&
      binding.retainedOriginCommitOperationIdOrNull === null
    )
      return s.fail();
  }
  for (const coating of graph.coatings ?? []) {
    const binding =
      context.coatingBindings?.find((row) => row.coatingInstanceId === coating.coatingInstanceId) ??
      s.fail();
    const child =
      children.find((row) => row.allocation.id === coating.coatingInstanceId) ?? s.fail();
    if (
      child.allocation.kind !== 'COATING_INSTANCE' ||
      !s.same(child.scope, version.scope) ||
      child.ownerNpcUuid !== version.npcUuid
    )
      return s.fail();
    equal(
      [binding.originOperationId, binding.originDraftId, binding.originEventSha256],
      [child.originOperationId, child.originDraftId, child.originEventSha256],
    );
    equal(
      [coating.itemInstanceId, coating.sourceInstanceId],
      [child.allocation.itemInstanceId, child.allocation.sourceInstanceId],
    );
    const old = previousGraph?.coatings?.find(
      (row) => row.coatingInstanceId === coating.coatingInstanceId,
    );
    if (old !== undefined) equal(coating, old);
    else if (binding.retainedOriginCommitOperationIdOrNull !== null)
      equal(coating.originCommitOperationId, binding.retainedOriginCommitOperationIdOrNull);
    else if (
      coating.originCommitOperationId !== version.operationId ||
      (child.originDraftId !== version.npcDraftId &&
        binding.retainedPreparationOperationIdOrNull !== child.originOperationId)
    )
      return s.fail();
  }
  const oldTraumas = new Map((previousGraph?.traumas ?? []).map((t) => [t.traumaInstanceId, t]));
  for (const trauma of graph.traumas) {
    const binding =
      context.traumaBindings.find((b) => b.traumaInstanceId === trauma.traumaInstanceId) ??
      s.fail();
    const fact = children.find((c) => c.allocation.id === trauma.traumaInstanceId) ?? s.fail();
    if (
      fact.allocation.kind !== 'TRAUMA_INSTANCE' ||
      !s.same(fact.scope, version.scope) ||
      fact.ownerNpcUuid !== version.npcUuid
    )
      return s.fail();
    equal(
      [binding.originOperationId, binding.originDraftId, binding.originEventSha256],
      [fact.originOperationId, fact.originDraftId, fact.originEventSha256],
    );
    const previous = oldTraumas.get(trauma.traumaInstanceId);
    if (previous !== undefined) {
      equal(trauma, previous);
      equal(binding.retainedRowOrNull, previous.input);
    } else if (
      trauma.originCommitOperationId !== version.operationId ||
      fact.originDraftId !== version.npcDraftId
    )
      return s.fail();
    else if (binding.retainedRowOrNull !== null) return s.fail();
  }
  const oldSymbionts = new Map(
    (previousGraph?.symbionts ?? []).map((x) => [x.symbiontInstanceId, x]),
  );
  for (const symbiont of graph.symbionts) {
    const binding =
      context.symbiontBindings.find((b) => b.symbiontInstanceId === symbiont.symbiontInstanceId) ??
      s.fail();
    const fact = children.find((c) => c.allocation.id === symbiont.symbiontInstanceId) ?? s.fail();
    if (
      fact.allocation.kind !== 'SYMBIONT_INSTANCE' ||
      !s.same(fact.scope, version.scope) ||
      fact.ownerNpcUuid !== version.npcUuid
    )
      return s.fail();
    equal(
      [binding.originOperationId, binding.originDraftId, binding.originEventSha256],
      [fact.originOperationId, fact.originDraftId, fact.originEventSha256],
    );
    const previous = oldSymbionts.get(symbiont.symbiontInstanceId);
    if (previous !== undefined) {
      equal(symbiont, previous);
      equal(binding.retainedSpeciesKeyOrNull, previous.speciesKey);
    } else if (
      symbiont.originCommitOperationId !== version.operationId ||
      fact.originDraftId !== version.npcDraftId ||
      binding.retainedSpeciesKeyOrNull !== null
    )
      return s.fail();
  }
  const restoredProfiles = new Map<
    string,
    NonNullable<NpcAttemptReadContext['restoredWeaponProfiles']>[number]
  >();
  const restoredVariants = new Set<string>();
  for (const binding of context.restoredWeaponProfiles ?? []) {
    const variantKey = s.canonical([binding.itemInstanceId, binding.weaponVariantId]);
    if (restoredProfiles.has(binding.weaponProfileVersionId) || restoredVariants.has(variantKey))
      return s.fail();
    restoredProfiles.set(binding.weaponProfileVersionId, binding);
    restoredVariants.add(variantKey);
  }
  const expectedNew: string[] = [];
  for (const item of graph.items) {
    if (!context.itemBindings.some((c) => c.itemInstanceId === item.itemInstanceId))
      return s.fail();
    for (const profile of item.profileVersions) {
      const fact =
        children.find((c) => c.allocation.id === profile.weaponProfileVersionId) ?? s.fail();
      if (
        fact.allocation.kind !== 'WEAPON_PROFILE_VERSION' ||
        !s.same(fact.scope, version.scope) ||
        fact.ownerNpcUuid !== version.npcUuid ||
        fact.allocation.itemInstanceId !== item.itemInstanceId ||
        fact.allocation.weaponVariantId !== profile.weaponVariantId
      )
        return s.fail();
      const prior = oldProfiles.get(profile.weaponProfileVersionId),
        restored = restoredProfiles.get(profile.weaponProfileVersionId);
      if (prior !== undefined) equal(prior, { itemInstanceId: item.itemInstanceId, ...profile });
      else if (restored !== undefined) {
        // The immediate predecessor can omit an explicitly restored historical item.
        // Reuse only its checked selected edge, never any same-owner allocated profile.
        equal(restored, {
          itemInstanceId: item.itemInstanceId,
          ...profile,
          originOperationId: fact.originOperationId,
          originDraftId: fact.originDraftId,
          originEventSha256: fact.originEventSha256,
        });
        if (
          fact.originOperationId === version.operationId ||
          fact.originDraftId === version.npcDraftId
        )
          return s.fail();
      } else {
        if (
          fact.originOperationId !== version.operationId ||
          fact.originDraftId !== version.npcDraftId
        )
          return s.fail();
        expectedNew.push(profile.weaponProfileVersionId);
      }
    }
  }
  equal(
    children
      .filter((c) => c.originOperationId === version.operationId)
      .map((c) => c.allocation.id)
      .sort(),
    expectedNew.sort(),
  );
}
