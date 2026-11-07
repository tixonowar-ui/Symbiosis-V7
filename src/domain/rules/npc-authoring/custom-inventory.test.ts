import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalWeaponProfileCatalog } from '../../../host/weapon-profile-catalog.js';
import {
  createNpcInventoryCatalog,
  readNpcInventoryRequest,
  readNpcInventoryRestorationRows,
  type NpcCampaignCustomInventoryRequestEntry,
  type NpcCatalogueInventoryRequestEntry,
  type NpcStructuredCustomProfile,
} from './inventory.js';
import {
  buildNpcInventoryPreview,
  buildNpcInventoryPublication,
  createNpcInventoryPublicationCatalog,
  deriveNpcCustomItemContribution,
  isNpcCampaignCustomPublicationAvailable,
  readNpcInventoryPublication,
  planNpcInventoryWeaponVersions,
  listNpcInventoryRestoreChoices,
  selectNpcInventoryRestoreRequests,
  type NpcInventoryPublication,
  type NpcInventoryPublicationContext,
  type NpcInventoryPublicationProof,
} from './inventory-publication.js';
import { npcKensiRequest } from '../../../../tests/fixtures/npc-published-inventory.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function source(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../../generated/spec/${name}.json`, import.meta.url), 'utf8'),
  ) as unknown;
}
const inventory = createNpcInventoryCatalog(
  source('items/catalogue'),
  source('items/armor-profiles'),
  source('items/pharmaceuticals'),
  canonicalWeaponProfileCatalog(),
);
const fields = {
  instanceModel: source('items/instance-model'),
  weaponFields: source('items/weapon-fields'),
};
const form = (source('atlas/forms-by-id') as Record<string, unknown>)['NPC-015'];
const catalog = createNpcInventoryPublicationCatalog(inventory, {
  ...fields,
  customItemForm: form,
});

describe('source-checked inventory N+1 with independent actual history', () => {
  const firstWeapon = () =>
    buildNpcInventoryPublication(catalog, {
      ...binding([]),
      entries: [{ request: npcKensiRequest(id(4)), weaponProfileVersionId: id(5) }],
    });
  const entry = (
    version: number,
    publication: NpcInventoryPublication | null,
    commitOperationId = publication?.proof.commitOperationId ?? id(2),
  ) => ({
    npcUuid: id(1),
    version,
    sha256: String(version).repeat(64),
    commitOperationId,
    publication,
  });
  const nextProof = (
    context: NpcInventoryPublicationContext,
    requests: NpcInventoryPublicationProof['entries'],
    commit = 70,
  ): NpcInventoryPublicationProof => {
    const previous = context.history.at(-1)!;
    return {
      ...binding([]),
      commitOperationId: id(commit),
      committedAt: `2026-11-06T04:${String(commit - 70).padStart(2, '0')}:00.000Z`,
      sourceOperationId: `actual-confirm-${String(commit)}`,
      previous: {
        npcUuid: previous.npcUuid,
        version: previous.version,
        sha256: previous.sha256,
        commitOperationId: previous.commitOperationId,
      },
      entries: requests,
    };
  };
  it('keeps unchanged profiles and original physical provenance during state edits and additions', () => {
    const original = firstWeapon(),
      bytes = JSON.stringify(original);
    const context = { history: [entry(1, original)] };
    const request = { ...npcKensiRequest(id(4)), currentAmmo: 1 };
    const backpack = { ...base(), itemInstanceId: id(60) };
    expect(planNpcInventoryWeaponVersions(catalog, [request, backpack], context)).toEqual([
      { itemInstanceId: id(4), kind: 'RETAIN', weaponProfileVersionId: id(5) },
      { itemInstanceId: id(60), kind: 'ABSENT' },
    ]);
    const next = buildNpcInventoryPublication(
      catalog,
      nextProof(context, [
        { request, weaponProfileVersionId: id(5) },
        { request: backpack, weaponProfileVersionId: null },
      ]),
      context,
    );
    expect(next.format).toBe('NPC_INVENTORY_PUBLICATION_V2');
    expect(next.items[0]?.profileVersions).toEqual(original.items[0]?.profileVersions);
    expect(next.items[0]?.item).toMatchObject({
      currentAmmo: 1,
      createdAt: original.items[0]!.item.createdAt,
      provenance: original.items[0]!.item.provenance,
      updatedAt: next.proof.committedAt,
    });
    expect(next.items[1]?.item.createdAt).toBe(next.proof.committedAt);
    expect(JSON.stringify(original)).toBe(bytes);
    expect(readNpcInventoryPublication(catalog, JSON.parse(JSON.stringify(next)), context)).toEqual(
      next,
    );
    expect(() => readNpcInventoryPublication(catalog, next)).toThrow(
      'independently read prior history',
    );
    expect(() =>
      readNpcInventoryPublication(catalog, next, {
        history: [entry(1, JSON.parse(JSON.stringify(original)) as NpcInventoryPublication)],
      }),
    ).toThrow('independently issued');
  });
  it('appends allowed weapon overrides and resolves a later RETAIN from the actual previous master profile', () => {
    const original = firstWeapon(),
      context = { history: [entry(1, original)] };
    const before = original.items[0]!.profileVersions[0]!;
    const request: NpcCatalogueInventoryRequestEntry = {
      ...npcKensiRequest(id(4)),
      itemTypeId: 'ITM-WPN-003',
      profile: {
        kind: 'MASTER_WEAPON',
        reason: 'Изменение текущего исходного профиля',
        inputs: [
          {
            weaponVariantId: 'DEFAULT',
            damageDefinition: { kind: 'MASTER_DICE', pattern: 'R4+X', constantOrNull: 7 },
            penetrationDefinition: { kind: 'RETAIN' },
            statRequirements: before.statRequirements,
            instanceDamageOrNull: null,
            rangeMetersOrNull: before.rangeMetersOrNull,
            accuracyBonusOrNull: null,
          },
        ],
      },
    };
    expect(planNpcInventoryWeaponVersions(catalog, [request], context)).toEqual([
      { itemInstanceId: id(4), kind: 'ALLOCATE', previousVersionIdOrNull: id(5) },
    ]);
    const next = buildNpcInventoryPublication(
      catalog,
      nextProof(context, [{ request, weaponProfileVersionId: id(71) }]),
      context,
    );
    const current = next.items[0]!.profileVersions[0]!;
    expect(current).toMatchObject({
      weaponProfileVersionId: id(71),
      previousVersionId: id(5),
      beforeProfile: before.effectiveProfile,
      createdAt: next.proof.committedAt,
    });
    expect(current.afterProfile.damageDefinition.sourceNotation).toBe('R4+7');
    expect(current.afterProfile.properties).toEqual(before.effectiveProfile.properties);
    if (request.profile.kind !== 'MASTER_WEAPON') throw Error('master fixture');
    const retained = {
      ...request,
      profile: {
        ...request.profile,
        inputs: [{ ...request.profile.inputs[0]!, damageDefinition: { kind: 'RETAIN' as const } }],
      },
    };
    const laterContext = { history: [entry(1, original), entry(2, next)] };
    expect(planNpcInventoryWeaponVersions(catalog, [retained], laterContext)).toEqual([
      { itemInstanceId: id(4), kind: 'RETAIN', weaponProfileVersionId: id(71) },
    ]);
    const later = buildNpcInventoryPublication(
      catalog,
      nextProof(laterContext, [{ request: retained, weaponProfileVersionId: id(71) }], 72),
      laterContext,
    );
    expect(later.items[0]!.profileVersions[0]).toEqual(current);
    expect(() =>
      buildNpcInventoryPublication(
        catalog,
        nextProof(context, [{ request, weaponProfileVersionId: id(5) }]),
        context,
      ),
    ).toThrow('differs');
    expect(() =>
      buildNpcInventoryPublication(
        catalog,
        nextProof(laterContext, [{ request: retained, weaponProfileVersionId: id(5) }], 72),
        laterContext,
      ),
    ).toThrow('historical weapon profile');
  });
  it('retains immutable custom versions during a move and appends an explicit changed version', () => {
    const first = custom(3),
      original = buildNpcInventoryPublication(catalog, binding([first, base()]));
    const context = { history: [entry(1, original)] };
    const moved = {
      ...first,
      bonusContainerBinding: { kind: 'BACKPACK' as const, backpackItemInstanceId: id(4) },
    };
    const next = buildNpcInventoryPublication(
      catalog,
      nextProof(context, [
        { request: moved, weaponProfileVersionId: null },
        { request: base(), weaponProfileVersionId: null },
      ]),
      context,
    );
    expect(next.items[0]?.customProfileVersions).toEqual(original.items[0]?.customProfileVersions);
    const changed = {
      ...moved,
      profile: { ...moved.profile, name: 'Новое описание профиля' },
      customProfileReason: 'Основание новой версии',
    };
    expect(() =>
      buildNpcInventoryPublication(
        catalog,
        nextProof(context, [
          { request: changed, weaponProfileVersionId: null },
          { request: base(), weaponProfileVersionId: null },
        ]),
        context,
      ),
    ).toThrow('differs');
    const revised = {
      ...changed,
      itemTypeReference: {
        ...changed.itemTypeReference,
        profileVersionId: id(62),
        reservationOperationId: id(63),
        version: 2,
      },
    };
    const laterContext = { history: [entry(1, original), entry(2, next)] };
    const saved = buildNpcInventoryPublication(
      catalog,
      nextProof(
        laterContext,
        [
          { request: revised, weaponProfileVersionId: null },
          { request: base(), weaponProfileVersionId: null },
        ],
        72,
      ),
      laterContext,
    );
    expect(saved.items[0]?.customProfileVersions?.[0]).toMatchObject({
      profileId: id(41),
      profileVersionId: id(62),
      previousVersionId: id(42),
      version: 2,
      beforeProfile: profile(3),
      afterProfile: changed.profile,
      reason: 'Основание новой версии',
    });
    expect(saved.items[0]?.item.createdAt).toBe(original.items[0]?.item.createdAt);
    const restoreHistory = {
      history: [entry(1, original), entry(2, next), entry(3, saved)],
    };
    const selected = selectNpcInventoryRestoreRequests(
      catalog,
      restoreHistory,
      { npcUuid: id(1), selectedItemInstanceIds: [] },
      revised.itemInstanceId,
    );
    expect(selected).toEqual([revised]);
    expect(() => buildNpcInventoryPreview(catalog, selected, restoreHistory)).toThrow(
      'real selected backpack',
    );
    expect(() =>
      buildNpcInventoryPreview(catalog, [...selected, base()], restoreHistory),
    ).not.toThrow();
    expect(() =>
      readNpcInventoryRestorationRows([
        {
          ...revised,
          bonusContainerBinding: {
            kind: 'BACKPACK',
            backpackItemInstanceId: revised.itemInstanceId,
          },
        },
      ]),
    ).toThrow('real selected backpack');
    expect(() => readNpcInventoryRestorationRows([...selected, npcKensiRequest(id(4))])).toThrow(
      'real selected backpack',
    );
    expect(
      readNpcInventoryPublication(catalog, JSON.parse(JSON.stringify(saved)), laterContext),
    ).toEqual(saved);
  });
  it('removes only current selection and reuses the actual historical item without resetting its provenance', () => {
    const original = firstWeapon(),
      context = { history: [entry(1, original)] };
    const removed = buildNpcInventoryPublication(catalog, nextProof(context, []), context);
    expect(removed.items).toEqual([]);
    const history = { history: [entry(1, original), entry(2, removed)] };
    const request = npcKensiRequest(id(4));
    expect(planNpcInventoryWeaponVersions(catalog, [request], history)).toEqual([
      { itemInstanceId: id(4), kind: 'RETAIN', weaponProfileVersionId: id(5) },
    ]);
    const restored = buildNpcInventoryPublication(
      catalog,
      nextProof(history, [{ request, weaponProfileVersionId: id(5) }], 72),
      history,
    );
    expect(restored.items[0]?.item).toMatchObject({
      createdAt: original.items[0]!.item.createdAt,
      provenance: original.items[0]!.item.provenance,
      updatedAt: restored.proof.committedAt,
    });
    expect(restored.items[0]?.profileVersions).toEqual(original.items[0]?.profileVersions);
    expect(() =>
      buildNpcInventoryPublication(
        catalog,
        nextProof(
          history,
          [{ request: { ...request, itemTypeId: 'ITM-WPN-004' }, weaponProfileVersionId: id(73) }],
          72,
        ),
        history,
      ),
    ).toThrow('differs');
  });
  it('binds the exact complete prior version reference and allows first inventory after a clean NPC', () => {
    const context = { history: [entry(1, null)] };
    const request = npcKensiRequest(id(4));
    const proof = nextProof(context, [{ request, weaponProfileVersionId: id(5) }]);
    const saved = buildNpcInventoryPublication(catalog, proof, context);
    expect(saved.items[0]?.item.createdAt).toBe(proof.committedAt);
    expect(() =>
      buildNpcInventoryPublication(
        catalog,
        { ...proof, previous: { ...proof.previous, sha256: 'f'.repeat(64) } },
        context,
      ),
    ).toThrow('differs');
    expect(() => buildNpcInventoryPublication(catalog, proof, { history: [] })).toThrow(
      'prior NPC prefix',
    );
    expect(() =>
      buildNpcInventoryPublication(catalog, proof, {
        history: [{ ...context.history[0]!, version: 2 }],
      }),
    ).toThrow('ordered complete');
    expect(() =>
      buildNpcInventoryPublication(catalog, proof, {
        history: [{ ...context.history[0]!, npcUuid: id(99) }],
      }),
    ).toThrow();
  });
  it('offers only latest actual same-NPC history and refuses selected, foreign or cloned restore input', () => {
    const original = firstWeapon();
    const firstContext = { history: [entry(1, original)] };
    const latestRequest = { ...npcKensiRequest(id(4)), currentAmmo: 1, broken: true };
    const edited = buildNpcInventoryPublication(
      catalog,
      nextProof(firstContext, [{ request: latestRequest, weaponProfileVersionId: id(5) }]),
      firstContext,
    );
    const editedContext = { history: [entry(1, original), entry(2, edited)] };
    const removed = buildNpcInventoryPublication(
      catalog,
      nextProof(editedContext, [], 72),
      editedContext,
    );
    const context = { history: [...editedContext.history, entry(3, removed)] };
    const scope = { npcUuid: id(1), selectedItemInstanceIds: [id(90)] };
    const before = JSON.stringify(context);
    expect(listNpcInventoryRestoreChoices(catalog, context, scope)).toEqual([
      { itemInstanceId: id(4), itemInstanceIds: [id(4)], linkedSetInstanceIdOrNull: null },
    ]);
    expect(selectNpcInventoryRestoreRequests(catalog, context, scope, id(4))).toEqual([
      latestRequest,
    ]);
    expect(() => selectNpcInventoryRestoreRequests(catalog, context, scope, id(99))).toThrow(
      'not an offered',
    );
    const selected = { ...scope, selectedItemInstanceIds: [id(4)] };
    expect(listNpcInventoryRestoreChoices(catalog, context, selected)).toEqual([]);
    expect(() => selectNpcInventoryRestoreRequests(catalog, context, selected, id(4))).toThrow(
      'not an offered',
    );
    expect(() =>
      listNpcInventoryRestoreChoices(catalog, context, { ...scope, npcUuid: id(99) }),
    ).toThrow('another NPC');
    expect(() =>
      listNpcInventoryRestoreChoices(catalog, context, {
        ...scope,
        selectedItemInstanceIds: [id(90), id(90)],
      }),
    ).toThrow('repeats');
    expect(() =>
      listNpcInventoryRestoreChoices(
        catalog,
        { history: [entry(1, JSON.parse(JSON.stringify(original)) as NpcInventoryPublication)] },
        scope,
      ),
    ).toThrow('independently issued');
    expect(JSON.stringify(context)).toBe(before);
  });
});
const legacy = createNpcInventoryPublicationCatalog(inventory, fields);
const profile = (bonus: number | null): NpcStructuredCustomProfile => ({
  kind: 'STRUCTURED_CUSTOM',
  name: 'Памятная вещь',
  description: 'Описание без свободной механики',
  customBonusOrNull:
    bonus === null
      ? null
      : { customBonusStat: 'W', customBonusValue: bonus, activeOnlyInBackpack: true },
  massKg: null,
  heldSizeClass: 'UNKNOWN',
  armorWeightClass: 'UNKNOWN',
  flammability: 'UNKNOWN',
  isIgnitionSource: false,
  isFood: false,
  canReceivePoison: false,
  canReceiveFlammableCoating: false,
});
const base = (): NpcCatalogueInventoryRequestEntry => ({
  ...npcKensiRequest(id(4)),
  itemTypeId: 'RES-CON-001',
  profile: { kind: 'CATALOG' },
  currentAmmo: null,
});
const custom = (bonus: number | null = null, n = 40): NpcCampaignCustomInventoryRequestEntry => ({
  ...base(),
  itemInstanceId: id(n),
  itemTypeId: null,
  itemTypeReference: {
    kind: 'CAMPAIGN_CUSTOM_PROFILE',
    profileId: id(n + 1),
    profileVersionId: id(n + 2),
    version: 1,
    reservationOperationId: id(n + 3),
  },
  profile: profile(bonus),
  bonusContainerBinding: bonus === null ? { kind: 'NOT_APPLICABLE' } : { kind: 'OUTSIDE_BACKPACK' },
  customProfileReason: 'Явное исходное свойство',
});
const binding = (
  requests: readonly (NpcCampaignCustomInventoryRequestEntry | NpcCatalogueInventoryRequestEntry)[],
) => ({
  npcUuid: id(1),
  commitOperationId: id(2),
  sourceOperationId: 'actual-npc015-confirm',
  actorId: id(3),
  committedAt: '2026-11-06T03:00:00.000Z',
  entries: requests.map((request) => ({
    request,
    weaponProfileVersionId: request.itemTypeId === 'ITM-WPN-001' ? id(5) : null,
  })),
});

describe('ADR 0084 actual campaign custom profile publication', () => {
  it('requires its source capability and preserves the exact ordinary catalogue path', () => {
    expect(isNpcCampaignCustomPublicationAvailable(catalog)).toBe(true);
    expect(isNpcCampaignCustomPublicationAvailable(legacy)).toBe(false);
    expect(() =>
      isNpcCampaignCustomPublicationAvailable({ kind: 'SOURCE_BOUND_NPC_INVENTORY_PUBLICATION' }),
    ).toThrow('unrecognized');
    expect(() => buildNpcInventoryPreview(legacy, [custom()])).toThrow('Atlas contract');
    expect(buildNpcInventoryPublication(catalog, binding([base()]))).toEqual(
      buildNpcInventoryPublication(legacy, binding([base()])),
    );
    expect(() =>
      createNpcInventoryPublicationCatalog(inventory, {
        ...fields,
        customItemForm: { ...(form as object), requiredFields: [] },
      }),
    ).toThrow('NPC inventory publication INVALID: unrecognized custom inventory source form');
  });
  it('publishes explicit no bonus and unknown traits without catalogue or weapon identities', () => {
    const saved = buildNpcInventoryPublication(catalog, binding([custom()]));
    expect(saved.items[0]).toMatchObject({
      kind: 'CAMPAIGN_CUSTOM_ITEM',
      item: {
        itemTypeId: null,
        activeWeaponProfileVersionIdByVariant: {},
        bonusContainerBinding: { kind: 'NOT_APPLICABLE' },
      },
      profileVersions: [],
      customProfileVersions: [
        {
          profileVersionId: id(42),
          previousVersionId: null,
          reason: 'Явное исходное свойство',
          afterProfile: profile(null),
        },
      ],
    });
    expect(saved.input[0]).toMatchObject({
      itemTypeId: null,
      profile: { massKg: null, heldSizeClass: 'UNKNOWN', flammability: 'UNKNOWN' },
    });
    expect(readNpcInventoryPublication(catalog, JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(buildNpcInventoryPublication(catalog, binding([custom()]))).toEqual(saved);
    expect(
      deriveNpcCustomItemContribution(catalog, buildNpcInventoryPreview(catalog, [custom()]))
        .items[0],
    ).toMatchObject({ active: false, reason: 'NO_BONUS' });
  });
  it('uses the real selected backpack in either order and keeps outside bonuses inactive', () => {
    const outside = custom(3);
    const inside = {
      ...outside,
      bonusContainerBinding: {
        kind: 'BACKPACK' as const,
        backpackItemInstanceId: base().itemInstanceId,
      },
    };
    expect(
      deriveNpcCustomItemContribution(catalog, buildNpcInventoryPreview(catalog, [outside])).totals
        .W,
    ).toBe(0);
    for (const requests of [
      [inside, base()],
      [base(), inside],
    ]) {
      const preview = buildNpcInventoryPreview(catalog, requests);
      expect(deriveNpcCustomItemContribution(catalog, preview).totals.W).toBe(3);
      const saved = buildNpcInventoryPublication(catalog, binding(requests));
      expect(readNpcInventoryPublication(catalog, JSON.parse(JSON.stringify(saved)))).toEqual(
        saved,
      );
    }
    expect(() => buildNpcInventoryPreview(catalog, [inside])).toThrow('real selected backpack');
    expect(() =>
      buildNpcInventoryPreview(catalog, [inside, { ...base(), itemTypeId: 'RES-CUR-001' }]),
    ).toThrow('real selected backpack');
  });
  it('adds distinct physical bonuses once and rejects quantity multiplication or identity reuse', () => {
    const inBackpack = (value: NpcCampaignCustomInventoryRequestEntry) => ({
      ...value,
      bonusContainerBinding: { kind: 'BACKPACK' as const, backpackItemInstanceId: id(4) },
    });
    const first = inBackpack(custom(3));
    const second = inBackpack(custom(4, 50));
    expect(
      deriveNpcCustomItemContribution(
        catalog,
        buildNpcInventoryPreview(catalog, [first, second, base()]),
      ),
    ).toMatchObject({
      totals: { W: 7 },
      items: [
        { itemInstanceId: id(40), active: true },
        { itemInstanceId: id(50), active: true },
      ],
    });
    expect(() => readNpcInventoryRequest([{ ...first, quantity: 2 }, base()])).toThrow(
      'one physical item',
    );
    expect(() =>
      readNpcInventoryRequest([
        first,
        { ...second, itemTypeReference: first.itemTypeReference },
        base(),
      ]),
    ).toThrow('identity reused');
    expect(() => readNpcInventoryRequest([{ ...custom(), itemTypeId: 'RES-CON-001' }])).toThrow(
      'no catalogue identity',
    );
  });
  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('refuses an invalid bonus %s', (value) => {
    expect(() => readNpcInventoryRequest([{ ...custom(1), profile: profile(value) }])).toThrow();
  });
  it('keeps a canonical weapon complete while storing an independent custom modifier', () => {
    const weapon = npcKensiRequest(id(4));
    if (weapon.itemTypeId === null) throw new Error('canonical fixture required');
    const reference = { ...custom().itemTypeReference, kind: 'CATALOG_CUSTOM_MODIFIER' as const };
    const modified = {
      ...weapon,
      customModifier: {
        reference,
        profile: profile(2),
        bonusContainerBinding: { kind: 'OUTSIDE_BACKPACK' as const },
        reason: 'Сюжетный модификатор',
      },
    };
    const originalProof = {
      ...binding([]),
      entries: [{ request: weapon, weaponProfileVersionId: id(5) }],
    };
    const original = buildNpcInventoryPublication(catalog, originalProof);
    const saved = buildNpcInventoryPublication(catalog, {
      ...originalProof,
      entries: [{ request: modified, weaponProfileVersionId: id(5) }],
    });
    expect(saved.items[0]?.profileVersions).toEqual(original.items[0]?.profileVersions);
    expect(saved.items[0]).toMatchObject({
      kind: 'WEAPON',
      customModifier: modified.customModifier,
      customProfileVersions: [{ profileVersionId: id(42) }],
    });
    expect(saved.items[0]?.item.itemTypeId).toBe(weapon.itemTypeId);
    expect(saved.input[0]?.profile).toEqual(original.input[0]?.profile);
    const tampered = JSON.parse(JSON.stringify(saved)) as {
      items: { customProfileVersions: { afterProfile: { name: string } }[] }[];
    };
    tampered.items[0]!.customProfileVersions[0]!.afterProfile.name = 'Подмена';
    expect(() => readNpcInventoryPublication(catalog, tampered)).toThrow('differs');
  });
  it('does not infer weapon/armor mechanics or committed version history from an arbitrary profile', () => {
    expect(() =>
      buildNpcInventoryPreview(catalog, [
        { ...custom(), equipped: true, equippedSlots: ['HAND_L'] },
      ]),
    ).toThrow('cannot substitute');
    expect(() =>
      buildNpcInventoryPublication(
        catalog,
        binding([
          { ...custom(), itemTypeReference: { ...custom().itemTypeReference, version: 2 } },
        ]),
      ),
    ).toThrow('first actual reservation');
  });
});
