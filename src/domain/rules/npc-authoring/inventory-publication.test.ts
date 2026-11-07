import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalWeaponProfileCatalog } from '../../../host/weapon-profile-catalog.js';
import {
  createNpcInventoryCatalog,
  npcInventoryMetadataChoices,
  readNpcInventoryRequest,
  type NpcCatalogueInventoryRequestEntry,
  type NpcInventoryRequestEntry,
} from './inventory.js';
import {
  buildNpcInventoryPublication,
  buildNpcInventoryPreview,
  readNpcInventoryPreview,
  deriveNpcInventoryStatContributions,
  createNpcInventoryPublicationCatalog,
  readNpcInventoryPublication,
  NpcInventoryPublicationError,
  listNpcInventoryRestoreChoices,
  selectNpcInventoryRestoreRequests,
  type NpcInventoryPublicationProof,
  type NpcInventoryPreview,
  buildNpcInventoryPhysicalBasis,
  readNpcInventoryPhysicalBasis,
} from './inventory-publication.js';
import { npcKensiRequest } from '../../../../tests/fixtures/npc-published-inventory.js';

const source = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../../generated/spec/items/${name}.json`, import.meta.url), 'utf8'),
  ) as unknown;
const weapons = canonicalWeaponProfileCatalog();
const inventory = createNpcInventoryCatalog(
  source('catalogue'),
  source('armor-profiles'),
  source('pharmaceuticals'),
  weapons,
);
const fields = { instanceModel: source('instance-model'), weaponFields: source('weapon-fields') };
const catalog = createNpcInventoryPublicationCatalog(inventory, fields);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const initial = (): NpcInventoryPublicationProof => ({
  npcUuid: id(1),
  commitOperationId: id(2),
  sourceOperationId: 'actual-confirm-npc015',
  actorId: id(3),
  committedAt: '2026-11-06T03:00:00.000Z',
  entries: [{ request: npcKensiRequest(id(4)), weaponProfileVersionId: id(5) }],
});
function firstWeapon(preview: NpcInventoryPreview) {
  const item = preview.items[0];
  if (item === undefined || !('stagedProfile' in item)) throw new Error('expected weapon fixture');
  return item;
}
const readCopy = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;
const withRequest = (request: NpcInventoryRequestEntry) => ({
  ...initial(),
  entries: [{ request, weaponProfileVersionId: id(5) }],
});
const shield = (): NpcInventoryRequestEntry => ({
  ...npcKensiRequest(id(4)),
  itemTypeId: 'ITM-WPN-022',
  currentAmmo: null,
  shieldCurrentHP: 0,
  profile: {
    kind: 'MASTER_WEAPON',
    reason: 'Готовый щит',
    inputs: [
      {
        weaponVariantId: 'DEFAULT',
        damageDefinition: { kind: 'RETAIN' },
        penetrationDefinition: { kind: 'RETAIN' },
        statRequirements: {},
        instanceDamageOrNull: null,
        rangeMetersOrNull: null,
        accuracyBonusOrNull: null,
      },
    ],
  },
});

const armor = (itemTypeId = 'ITM-ARM-002', equipped = true): NpcInventoryRequestEntry => ({
  ...npcKensiRequest(id(44)),
  itemTypeId,
  currentAmmo: null,
  bodyZone: itemTypeId === 'ITM-ARM-005' ? null : 'TORSO',
  profile: { kind: 'CATALOG' },
  equipped,
  equippedSlots: equipped
    ? itemTypeId === 'ITM-ARM-005'
      ? ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R']
      : ['TORSO']
    : [],
  sealed: itemTypeId === 'ITM-ARM-005' ? true : null,
});
const armorBinding = (request = armor()): NpcInventoryPublicationProof => ({
  ...initial(),
  entries: [{ request, weaponProfileVersionId: null }],
});

describe('issued physical inventory preparation boundary', () => {
  it('preserves exact unresolved coating refs but never authorizes a full preview or publication', () => {
    const request = { ...npcKensiRequest(id(4)), coatingInstanceIds: [id(84)] };
    const basis = buildNpcInventoryPhysicalBasis(catalog, [request]);
    const read = readNpcInventoryPhysicalBasis(catalog, basis);
    expect(read.requests).toEqual([request]);
    expect(read.items[0]?.request.coatingInstanceIds).toEqual([]);
    expect(() => buildNpcInventoryPreview(catalog, read.requests)).toThrow('coating');
    expect(() => buildNpcInventoryPublication(catalog, withRequest(request))).toThrow('coating');
    expect(() => readNpcInventoryPreview(catalog, basis)).toThrow();
    expect(() => readNpcInventoryPhysicalBasis(catalog, readCopy(basis))).toThrow('unissued');
    expect(() =>
      readNpcInventoryPhysicalBasis(createNpcInventoryPublicationCatalog(inventory, fields), basis),
    ).toThrow('foreign');
  });
  it('retains the actual physical source and complete N+1 history checks before issuing a basis', () => {
    const first = buildNpcInventoryPublication(catalog, initial());
    const history = {
      history: [
        {
          npcUuid: initial().npcUuid,
          version: 1,
          sha256: 'a'.repeat(64),
          commitOperationId: initial().commitOperationId,
          publication: first,
        },
      ],
    };
    const request = { ...npcKensiRequest(id(4)), broken: true, coatingInstanceIds: [id(84)] };
    const basis = buildNpcInventoryPhysicalBasis(catalog, [request], history);
    expect(readNpcInventoryPhysicalBasis(catalog, basis).history).toEqual(history);
    expect(readNpcInventoryPhysicalBasis(catalog, basis).requests[0]?.broken).toBe(true);
    expect(() =>
      buildNpcInventoryPhysicalBasis(catalog, [{ ...request, itemTypeId: 'unknown' }], history),
    ).toThrow();
    expect(() =>
      buildNpcInventoryPhysicalBasis(catalog, [{ ...request, quantity: 2 }], {
        history: [
          {
            npcUuid: id(99),
            version: 1,
            sha256: 'a'.repeat(64),
            commitOperationId: initial().commitOperationId,
            publication: first,
          },
        ],
      }),
    ).toThrow();
  });
});

describe('source-backed complete composite pairs', () => {
  it.each(['1', '3', 'unknown'])(
    'refuses changed protected complete-pair hand count %s',
    (hands) => {
      const changed = {
        ...weapons,
        entries: weapons.entries.map((entry) =>
          entry.weaponTypeId === 'ITM-WPN-026'
            ? {
                ...entry,
                template: {
                  ...entry.template,
                  properties: { ...entry.template.properties, Руки: hands },
                },
              }
            : entry,
        ),
      };
      expect(() =>
        createNpcInventoryCatalog(
          source('catalogue'),
          source('armor-profiles'),
          source('pharmaceuticals'),
          changed,
        ),
      ).toThrow('composite complete-set hand count');
    },
  );
  const pair = (itemTypeId: 'ITM-WPN-026' | 'ITM-WPN-027', equipped = true) => {
    const requests: NpcInventoryRequestEntry[] = [
      {
        ...npcKensiRequest(id(64)),
        itemTypeId,
        currentAmmo: null,
        linkedSetInstanceId: id(63),
        componentRole: itemTypeId === 'ITM-WPN-026' ? 'SWORD' : 'RAPIER',
        equipped,
        equippedSlots: equipped ? ['HAND_L'] : [],
      },
      {
        ...npcKensiRequest(id(65)),
        itemTypeId,
        currentAmmo: null,
        linkedSetInstanceId: id(63),
        componentRole: 'SHIELD',
        shieldCurrentHP: itemTypeId === 'ITM-WPN-026' ? 350 : 150,
        equipped,
        equippedSlots: equipped ? ['HAND_R'] : [],
      },
    ];
    return requests;
  };
  const proof = (itemTypeId: 'ITM-WPN-026' | 'ITM-WPN-027'): NpcInventoryPublicationProof => ({
    ...initial(),
    entries: pair(itemTypeId).map((request, index) => ({
      request,
      weaponProfileVersionId: index === 1 && itemTypeId === 'ITM-WPN-026' ? null : id(66 + index),
    })),
  });
  it.each(['ITM-WPN-026', 'ITM-WPN-027'] as const)(
    'restores %s as one exact pair and excludes the pair if its secondary item is selected',
    (itemTypeId) => {
      const publication = buildNpcInventoryPublication(catalog, proof(itemTypeId));
      const context = {
        history: [
          {
            npcUuid: id(1),
            version: 1,
            sha256: 'a'.repeat(64),
            commitOperationId: id(2),
            publication,
          },
        ],
      };
      const scope = { npcUuid: id(1), selectedItemInstanceIds: [] };
      expect(listNpcInventoryRestoreChoices(catalog, context, scope)).toEqual([
        {
          itemInstanceId: id(64),
          itemInstanceIds: [id(64), id(65)],
          linkedSetInstanceIdOrNull: id(63),
        },
      ]);
      expect(selectNpcInventoryRestoreRequests(catalog, context, scope, id(64))).toEqual(
        pair(itemTypeId),
      );
      expect(() => selectNpcInventoryRestoreRequests(catalog, context, scope, id(65))).toThrow(
        'not an offered',
      );
      const selected = { ...scope, selectedItemInstanceIds: [id(65)] };
      expect(listNpcInventoryRestoreChoices(catalog, context, selected)).toEqual([]);
      expect(() => selectNpcInventoryRestoreRequests(catalog, context, selected, id(64))).toThrow(
        'not an offered',
      );
    },
  );
  it.each(['ITM-WPN-026', 'ITM-WPN-027'] as const)(
    'preserves %s real two-item set and only its supplied attacking profiles',
    (itemTypeId) => {
      const publication = buildNpcInventoryPublication(catalog, proof(itemTypeId));
      expect(publication.items.map((item) => item.item.linkedSetInstanceId)).toEqual([
        id(63),
        id(63),
      ]);
      expect(publication.items.map((item) => item.item.componentRole)).toEqual([
        itemTypeId === 'ITM-WPN-026' ? 'SWORD' : 'RAPIER',
        'SHIELD',
      ]);
      expect(publication.items.map((item) => item.item.equippedSlots)).toEqual([
        ['HAND_L'],
        ['HAND_R'],
      ]);
      expect(
        publication.items.map((item) => item.profileVersions.map((v) => v.attackVariantId)),
      ).toEqual(itemTypeId === 'ITM-WPN-026' ? [['SWORD'], []] : [['RAPIER'], ['SHIELD']]);
      expect(publication.items[1]?.item.shieldCurrentHP).toBe(
        itemTypeId === 'ITM-WPN-026' ? 350 : 150,
      );
      if (itemTypeId === 'ITM-WPN-026') {
        expect(publication.items[1]).toMatchObject({
          kind: 'SHIELD_COMPONENT',
          sourceProfile: { sourceRuleId: 'CORE-047', shieldMaxHP: 400 },
        });
        expect(publication.items[1]?.item.activeWeaponProfileVersionIdByVariant).toEqual({});
        expect(publication.input[1]?.profile.kind).toBe('SHIELD_COMPONENT');
      }
      expect(readNpcInventoryPublication(catalog, readCopy(publication))).toEqual(publication);
      const carried = buildNpcInventoryPreview(catalog, pair(itemTypeId, false));
      expect(
        carried.items.every(
          ({ request }) => !request.equipped && request.equippedSlots.length === 0,
        ),
      ).toBe(true);
      expect(readNpcInventoryPreview(catalog, readCopy(carried))).toEqual(carried);
    },
  );
  it('refuses orphan, mixed, duplicated-role and half-equipped pairs and occupied hands', () => {
    const [sword, shield] = pair('ITM-WPN-026');
    for (const requests of [
      [sword],
      [sword, { ...shield!, itemTypeId: 'ITM-WPN-027' }],
      [sword, { ...shield!, componentRole: 'SWORD' }],
      [sword, { ...shield!, equipped: false, equippedSlots: [] }],
      [sword, { ...shield!, equippedSlots: ['HAND_L'] }],
      [sword, { ...shield!, linkedSetInstanceId: id(70) }],
      [sword, { ...shield!, itemInstanceId: id(63) }],
    ])
      expect(() => buildNpcInventoryPreview(catalog, requests)).toThrow();
  });
  it('rejects a fake shield attack identity and tampering with saved links or protected HP', () => {
    const p = proof('ITM-WPN-026');
    expect(() =>
      buildNpcInventoryPublication(catalog, {
        ...p,
        entries: p.entries.map((entry) => ({
          ...entry,
          weaponProfileVersionId: entry.weaponProfileVersionId ?? id(71),
        })),
      }),
    ).toThrow();
    expect(() =>
      buildNpcInventoryPreview(
        catalog,
        pair('ITM-WPN-026').map((request) =>
          request.componentRole === 'SHIELD' ? { ...request, shieldCurrentHP: 401 } : request,
        ),
      ),
    ).toThrow();
    const publication = buildNpcInventoryPublication(catalog, p);
    expect(() =>
      readNpcInventoryPublication(catalog, {
        ...publication,
        items: publication.items.map((item) => ({
          ...item,
          item: { ...item.item, linkedSetInstanceId: id(71) },
        })),
      }),
    ).toThrow();
  });
});

describe('source-backed carried nonweapon catalogue publication', () => {
  const carried = (itemTypeId: string, quantity = 1): NpcInventoryRequestEntry => ({
    ...npcKensiRequest(id(44)),
    itemTypeId,
    currentAmmo: null,
    quantity,
  });
  it('publishes every explicitly allowed catalogue carrying branch without inventing weapon, container or effect identities', () => {
    for (const definition of inventory.definitions.filter(
      (d) => d.inventoryAllowed === true && !['Оружие', 'Броня'].includes(d.category),
    )) {
      const request = carried(
        definition.itemTypeId,
        definition.catalogueSource['Физически взаимозаменяем'] === true ? 3 : 1,
      );
      const result = buildNpcInventoryPublication(catalog, armorBinding(request));
      const published = result.items[0];
      if (published?.kind !== 'CATALOG_ITEM') throw new Error('catalogue fixture expected');
      expect(published.sourceProfile).toEqual({
        itemTypeId: definition.itemTypeId,
        name: definition.name,
        category: definition.category,
        completeness: definition.completeness,
        catalogueSource: definition.catalogueSource,
        mechanicsSourceOrNull: definition.profileSource,
      });
      expect(published.profileVersions).toEqual([]);
      expect(published.item.activeWeaponProfileVersionIdByVariant).toEqual({});
      expect(published.item.quantity).toBe(request.quantity);
      expect(published.item.equipped).toBe(false);
      expect(published.item.activeCoatings).toEqual([]);
      expect(Object.hasOwn(published.item, 'containerId')).toBe(false);
      expect(Object.hasOwn(published.item, 'effectInstances')).toBe(false);
      expect(result.input[0]?.profile.kind).toBe('ITEM_CATALOG');
      expect(readNpcInventoryPublication(catalog, readCopy(result))).toEqual(result);
      const preview = buildNpcInventoryPreview(catalog, [request]);
      expect(readNpcInventoryPreview(catalog, readCopy(preview))).toEqual(preview);
    }
  });
  it('preserves partial unknowns and actual pharmaceutical mechanics without substituting full future behavior', () => {
    const partial = buildNpcInventoryPublication(catalog, armorBinding(carried('RES-TOL-001')));
    expect(partial.items[0]).toMatchObject({
      kind: 'CATALOG_ITEM',
      sourceProfile: { completeness: 'PARTIAL', mechanicsSourceOrNull: null },
    });
    const pharma = buildNpcInventoryPublication(catalog, armorBinding(carried('ITM-PHA-008', 3)));
    expect(pharma.items[0]).toMatchObject({
      kind: 'CATALOG_ITEM',
      sourceProfile: { completeness: 'FULL', category: 'Фармацевтика' },
    });
    const item = partial.items[0];
    if (item?.kind !== 'CATALOG_ITEM') throw new Error('catalogue fixture');
    expect(() =>
      readNpcInventoryPublication(catalog, {
        ...partial,
        items: [{ ...item, sourceProfile: { ...item.sourceProfile, completeness: 'FULL' } }],
      }),
    ).toThrow();
  });
  it('refuses unknown inventory permission, fake attack profile IDs, unproved equipped clothing and coatings', () => {
    expect(() =>
      buildNpcInventoryPublication(catalog, armorBinding(carried('RES-MAG-001'))),
    ).toThrow('unknown inventory type');
    expect(() =>
      buildNpcInventoryPublication(catalog, withRequest(carried('ITM-PHA-001'))),
    ).toThrow('nonweapon item must not have a weapon');
    expect(() =>
      buildNpcInventoryPreview(catalog, [
        { ...carried('RES-EQP-001'), equipped: true, equippedSlots: ['TORSO'] },
      ]),
    ).toThrow('equipped clothing requires explicit physical coverage/properties');
    expect(() => buildNpcInventoryPreview(catalog, [carried('RES-TOL-001', 2)])).toThrow(
      'separate physical identity',
    );
    expect(() =>
      buildNpcInventoryPreview(catalog, [
        { ...carried('ITM-PHA-001'), coatingInstanceIds: [id(88)] },
      ]),
    ).toThrow('actual effect proof');
  });
});

describe('complete source-backed physical armor publication', () => {
  it('publishes an explicitly equipped zone piece without weapon versions or resolved armor rolls', () => {
    const proof = armorBinding(),
      before = JSON.stringify(proof);
    const result = buildNpcInventoryPublication(catalog, proof);
    expect(result.items[0]).toMatchObject({
      kind: 'ARMOR',
      profileVersions: [],
      sourceProfile: {
        sourceRuleId: 'CORE-050',
        physicalArmorOrNull: { dieSides: 12, multiplier: 1, constant: 0 },
      },
      item: {
        ownerId: id(1),
        itemInstanceId: id(44),
        equipped: true,
        equippedSlots: ['TORSO'],
        bodyZone: 'TORSO',
        activeWeaponProfileVersionIdByVariant: {},
        sealed: null,
        createdAt: proof.committedAt,
        provenance: { operationId: id(2) },
      },
    });
    expect(result.input[0]?.profile).toMatchObject({
      kind: 'ARMOR_CATALOG',
      sourceRuleId: 'CORE-050',
    });
    expect(Object.hasOwn(result.input[0]!.profile, 'profileVersion')).toBe(false);
    expect(readNpcInventoryPublication(catalog, readCopy(result))).toEqual(result);
    expect(JSON.stringify(proof)).toBe(before);
  });
  it('retains explicit sealed/unsealed Nate and keeps backpack items unequipped', () => {
    for (const sealed of [true, false]) {
      const result = buildNpcInventoryPublication(
        catalog,
        armorBinding({ ...armor('ITM-ARM-005'), sealed }),
      );
      expect(result.items[0]).toMatchObject({
        kind: 'ARMOR',
        sourceProfile: { physicalArmorOrNull: null },
        item: { sealed, equipped: true, bodyZone: null },
      });
      expect(result.items[0]?.item.equippedSlots).toHaveLength(6);
    }
    const backpack = buildNpcInventoryPublication(
      catalog,
      armorBinding(armor('ITM-ARM-005', false)),
    );
    expect(backpack.input[0]?.equipment).toEqual({ equipped: false, equippedSlots: [] });
  });
  it('keeps mixed physical armor and weapon identities separate in exact order', () => {
    const proof = { ...initial(), entries: [...initial().entries, ...armorBinding().entries] };
    const result = buildNpcInventoryPublication(catalog, proof);
    expect(result.items.map((item) => item.kind)).toEqual(['WEAPON', 'ARMOR']);
    expect(result.items.flatMap((item) => item.profileVersions)).toHaveLength(1);
    expect(readNpcInventoryPublication(catalog, readCopy(result))).toEqual(result);
  });
  it.each([
    { equippedSlots: ['HEAD'] },
    { equippedSlots: ['TORSO', 'HEAD'] },
    { quantity: 2 },
    { sealed: true },
    { currentAmmo: 0 },
    { shieldCurrentHP: 0 },
    { coatingInstanceIds: [id(99)] },
  ])('rejects contradictory physical armor state %j', (patch) => {
    expect(() =>
      buildNpcInventoryPublication(catalog, armorBinding({ ...armor(), ...patch })),
    ).toThrow();
  });
  it('requires null weapon reference for armor and an actual weapon version for weapons', () => {
    expect(() =>
      buildNpcInventoryPublication(catalog, {
        ...initial(),
        entries: [{ request: armor(), weaponProfileVersionId: id(99) }],
      }),
    ).toThrow('armor must not');
    expect(() =>
      buildNpcInventoryPublication(catalog, {
        ...initial(),
        entries: [{ request: npcKensiRequest(id(4)), weaponProfileVersionId: null }],
      }),
    ).toThrow('weapon requires');
  });
  it('recomputes preview and publication instead of accepting forged profile, seal, owner or slots', () => {
    const preview = buildNpcInventoryPreview(catalog, [armor()]);
    expect(readNpcInventoryPreview(catalog, readCopy(preview))).toEqual(preview);
    const row = preview.items[0]!;
    if (!('armorProfile' in row)) throw new Error('expected armor fixture');
    expect(() =>
      readNpcInventoryPreview(catalog, {
        items: [{ ...row, armorProfile: { ...row.armorProfile, requiredStrength: 0 } }],
      }),
    ).toThrow();
    const result = buildNpcInventoryPublication(catalog, armorBinding());
    for (const patch of [
      { ownerId: id(77) },
      { sealed: true },
      { equippedSlots: ['HEAD'] },
      { createdAt: '2026-11-07T03:00:00.000Z' },
    ])
      expect(() =>
        readNpcInventoryPublication(catalog, {
          ...result,
          items: [{ ...result.items[0], item: { ...result.items[0]!.item, ...patch } }],
        }),
      ).toThrow();
  });
});

describe('complete source-backed initial weapon publication', () => {
  it('publishes an actual Kensi with exact owner, version, audit and separate roll identities', () => {
    const request = initial(),
      before = JSON.stringify(request),
      result = buildNpcInventoryPublication(catalog, request),
      entry = result.items[0]!;
    expect(entry.item).toMatchObject({
      itemInstanceId: id(4),
      ownerType: 'CHARACTER',
      ownerId: id(1),
      quantity: 1,
      currentAmmo: 0,
      equipped: false,
      equippedSlots: [],
      activeWeaponProfileVersionIdByVariant: { DEFAULT: id(5) },
      provenance: {
        source: 'NPC_INITIAL_COMMIT',
        sourceOperationId: 'actual-confirm-npc015',
        operationId: id(2),
        previousOwner: null,
      },
      issuedBy: id(3),
      createdAt: request.committedAt,
      updatedAt: request.committedAt,
      cloneWriteBack: 'NONE',
    });
    const version = entry.profileVersions[0]!;
    expect(version).toMatchObject({
      weaponProfileVersionId: id(5),
      previousVersionId: null,
      ownerId: id(1),
      itemInstanceId: id(4),
      attackVariantId: 'DEFAULT',
      statSource: 'TEMPLATE_FIXED',
      validationStatus: 'NOT_APPLICABLE',
      instanceProfilePatch: null,
      actorRole: 'MASTER',
      actorId: id(3),
      createdAt: request.committedAt,
      effectiveFrom: 'NEXT_RESOLVED_ATTACK',
      active: true,
      immutableAudit: true,
    });
    expect(version.effectiveProfile).toEqual(version.afterProfile);
    expect(version.damageDefinition).toEqual(version.effectiveProfile.damageDefinition);
    expect(version.damageDefinition.definitionId).toBe(
      `NPC_WEAPON_DEFINITION/${id(5)}/DEFAULT/DAMAGE`,
    );
    expect(version.penetrationDefinition.definitionId).toBe(
      `NPC_WEAPON_DEFINITION/${id(5)}/DEFAULT/PENETRATION`,
    );
    expect(version.damageDefinition.valueMode).toBe('CONSTANT');
    expect(Object.hasOwn(version.damageDefinition, 'rollGroupId')).toBe(false);
    expect(version.damageDefinition.rollGroupId).not.toBe(
      version.penetrationDefinition.rollGroupId,
    );
    expect(JSON.stringify(request)).toBe(before);
    expect(readNpcInventoryPublication(catalog, readCopy(result))).toEqual(result);
    expect(Object.isFrozen(result.items[0]?.profileVersions[0]?.effectiveProfile.properties)).toBe(
      true,
    );
    expect(Object.hasOwn(entry.item, 'battleSceneId')).toBe(false);
    expect(Object.hasOwn(entry.item, 'containerId')).toBe(false);
    expect(Object.hasOwn(entry.item, 'campaignTimestamp')).toBe(false);
  });
  it('recomputes unchanged publication from original inputs without a new clock or ID', () => {
    const request = initial(),
      first = buildNpcInventoryPublication(catalog, request);
    expect(buildNpcInventoryPublication(catalog, readCopy(request))).toEqual(first);
    expect(first.items[0]?.item.createdAt).toBe('2026-11-06T03:00:00.000Z');
    expect(first.proof).not.toBe(request);
  });
  it('keeps source protected fields when a real master profile replaces allowed values', () => {
    const r = npcKensiRequest(id(4));
    const result = buildNpcInventoryPublication(
      catalog,
      withRequest({
        ...r,
        profile: {
          kind: 'MASTER_WEAPON',
          reason: 'Индивидуальный готовый профиль',
          inputs: [
            {
              weaponVariantId: 'DEFAULT',
              damageDefinition: { kind: 'MASTER_DICE', pattern: 'R20*2+X', constantOrNull: 250.5 },
              penetrationDefinition: { kind: 'MASTER_DICE', pattern: 'R4', constantOrNull: null },
              statRequirements: { S: 55, D: 2 },
              instanceDamageOrNull: null,
              rangeMetersOrNull: 1000,
              accuracyBonusOrNull: 7,
            },
          ],
        },
      }),
    );
    const version = result.items[0]!.profileVersions[0]!;
    expect(version.statSource).toBe('MASTER_OVERRIDE');
    expect(version.validationStatus).toBe('OVERRIDDEN');
    expect(version.instanceProfilePatch).toEqual({
      damageDefinition: version.damageDefinition,
      penetrationDefinition: version.penetrationDefinition,
      statRequirements: { S: 55, D: 2 },
      rangeMeters: 1000,
      accuracyBonus: 7,
    });
    expect(version.effectiveProfile.properties['Ёмкость']).toEqual(
      weapons.entries.find((e) => e.weaponTypeId === 'ITM-WPN-003')!.template.properties['Ёмкость'],
    );
    expect(version.damageDefinition.rollGroupId).not.toBe(
      version.penetrationDefinition.rollGroupId,
    );
    expect(readNpcInventoryPublication(catalog, readCopy(result))).toEqual(result);
  });
  it('supports another source type through explicit master profile and shield HP without Kensi allowlisting', () => {
    const result = buildNpcInventoryPublication(catalog, withRequest(shield()));
    expect(result.items[0]?.item.itemTypeId).toBe('ITM-WPN-022');
    expect(result.items[0]?.item.shieldCurrentHP).toBe(0);
    expect(readNpcInventoryPublication(catalog, readCopy(result))).toEqual(result);
  });
  it('keeps multiple physical items distinct even if their source signatures coincide', () => {
    const request = initial(),
      result = buildNpcInventoryPublication(catalog, {
        ...request,
        entries: [
          ...request.entries,
          { request: npcKensiRequest(id(6)), weaponProfileVersionId: id(7) },
        ],
      });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.item.stackKey).toBe(result.items[1]?.item.stackKey);
    expect(result.items[0]?.item.itemInstanceId).not.toBe(result.items[1]?.item.itemInstanceId);
  });
  it.each(['item', 'profile', 'owner', 'commit', 'source', 'actor'] as const)(
    'rejects overlapping %s identity domains',
    (kind) => {
      const request = initial(),
        entry = request.entries[0]!;
      const collision =
        kind === 'item'
          ? entry.request.itemInstanceId
          : kind === 'owner'
            ? request.npcUuid
            : kind === 'commit'
              ? request.commitOperationId
              : kind === 'source'
                ? request.sourceOperationId
                : kind === 'actor'
                  ? request.actorId
                  : entry.weaponProfileVersionId;
      const entries =
        kind === 'profile'
          ? [entry, { request: npcKensiRequest(id(6)), weaponProfileVersionId: collision }]
          : [{ ...entry, weaponProfileVersionId: collision }];
      expect(() => buildNpcInventoryPublication(catalog, { ...request, entries })).toThrow();
    },
  );
  it.each([null, -1, 999999])('requires real bounded current ammo %s', (currentAmmo) => {
    expect(() =>
      buildNpcInventoryPublication(
        catalog,
        withRequest({ ...npcKensiRequest(id(4)), currentAmmo }),
      ),
    ).toThrow();
  });
  it('requires applicable shield state without borrowing another item capacity', () => {
    expect(() =>
      buildNpcInventoryPublication(catalog, withRequest({ ...shield(), shieldCurrentHP: null })),
    ).toThrow('explicit');
    expect(() =>
      buildNpcInventoryPublication(
        catalog,
        withRequest({ ...npcKensiRequest(id(4)), shieldCurrentHP: 1 }),
      ),
    ).toThrow();
  });
  it.each([
    { quantity: 2 },
    { equipped: true, equippedSlots: ['HEAD'] },
    { coatingInstanceIds: [id(90)] },
    { itemTypeId: 'ITM-ARM-001', currentAmmo: null, bodyZone: 'HEAD' },
    {
      itemTypeId: 'ITM-WPN-026',
      currentAmmo: null,
      componentRole: 'SWORD',
      linkedSetInstanceId: id(91),
    },
  ])('does not silently flatten an unsupported current-state branch %j', (patch) => {
    expect(() =>
      buildNpcInventoryPublication(
        catalog,
        withRequest({ ...npcKensiRequest(id(4)), ...patch } as NpcInventoryRequestEntry),
      ),
    ).toThrow(NpcInventoryPublicationError);
  });
  it.each(['2026-02-30T00:00:00.000Z', '2026-11-06', 'now', '2026-11-06T03:00:00+03:00'])(
    'requires a canonical stored audit timestamp %s',
    (committedAt) => {
      expect(() => buildNpcInventoryPublication(catalog, { ...initial(), committedAt })).toThrow(
        'DATETIME',
      );
    },
  );
  it('rejects forged persisted profile/audit/state even when proof and JSON shape remain valid', () => {
    const actual = buildNpcInventoryPublication(catalog, initial()),
      entry = actual.items[0]!,
      version = entry.profileVersions[0]!;
    for (const changed of [
      { ...entry, item: { ...entry.item, ownerId: id(77) } },
      { ...entry, item: { ...entry.item, currentAmmo: 1 } },
      { ...entry, item: { ...entry.item, createdAt: '2026-11-07T03:00:00.000Z' } },
      {
        ...entry,
        profileVersions: [
          {
            ...version,
            effectiveProfile: {
              ...version.effectiveProfile,
              properties: { ...version.effectiveProfile.properties, Ёмкость: 999 },
            },
          },
        ],
      },
      { ...entry, profileVersions: [{ ...version, immutableAudit: false }] },
      { ...entry, profileVersions: [{ ...version, weaponProfileVersionId: id(88) }] },
    ])
      expect(() => readNpcInventoryPublication(catalog, { ...actual, items: [changed] })).toThrow();
  });
  it('does not invoke getters in requests, proof or stored derived fields', () => {
    let calls = 0;
    const request = initial(),
      saved = buildNpcInventoryPublication(catalog, request);
    expect(() =>
      buildNpcInventoryPublication(catalog, {
        ...request,
        get committedAt() {
          calls++;
          return request.committedAt;
        },
      }),
    ).toThrow();
    expect(() =>
      readNpcInventoryPublication(catalog, {
        ...saved,
        get items() {
          calls++;
          return saved.items;
        },
      }),
    ).toThrow();
    expect(calls).toBe(0);
    expect(() => buildNpcInventoryPublication(catalog, { ...request, extra: true })).toThrow();
    expect(() =>
      buildNpcInventoryPublication(catalog, {
        ...request,
        entries: [{ ...request.entries[0], weaponProfileVersionId: undefined }],
      }),
    ).toThrow();
  });
  it('refuses drift in source identity/ownership and profile audit contracts', () => {
    const changed = (fields.instanceModel as readonly Record<string, unknown>[]).map((row) =>
      row.Field === 'ownerId' ? { ...row, 'Validation / constraint': 'Invented ownership' } : row,
    );
    expect(() =>
      createNpcInventoryPublicationCatalog(inventory, { ...fields, instanceModel: changed }),
    ).toThrow();
    const profiles = (fields.weaponFields as readonly Record<string, unknown>[]).map((row) =>
      row.Field === 'effectiveFrom' ? { ...row, Default: 'IMMEDIATE' } : row,
    );
    expect(() =>
      createNpcInventoryPublicationCatalog(inventory, { ...fields, weaponFields: profiles }),
    ).toThrow();
    expect(() =>
      createNpcInventoryPublicationCatalog(inventory, {
        ...fields,
        instanceModel: [
          ...(fields.instanceModel as readonly Record<string, unknown>[]),
          { Field: 'unrecognizedRequiredState', Scope: 'ITEM_STATE', Required: true },
        ],
      }),
    ).toThrow();
  });
});

describe('uncommitted inventory preview', () => {
  it('CORE-177 publishes two actual one-handed Kensi with separate hand occupancy', () => {
    const left = { ...npcKensiRequest(id(4)), equipped: true, equippedSlots: ['HAND_L'] };
    const right = { ...npcKensiRequest(id(6)), equipped: true, equippedSlots: ['HAND_R'] };
    const result = buildNpcInventoryPublication(catalog, {
      ...initial(),
      entries: [
        { request: left, weaponProfileVersionId: id(5) },
        { request: right, weaponProfileVersionId: id(7) },
      ],
    });
    expect(result.items.map((item) => item.item.equippedSlots)).toEqual([['HAND_L'], ['HAND_R']]);
    expect(result.input.map((item) => item.equipment)).toEqual([
      { equipped: true, equippedSlots: ['HAND_L'] },
      { equipped: true, equippedSlots: ['HAND_R'] },
    ]);
    expect(readNpcInventoryPublication(catalog, readCopy(result))).toEqual(result);
    expect(() =>
      buildNpcInventoryPreview(catalog, [left, { ...right, equippedSlots: ['HAND_L'] }]),
    ).toThrow('same hand');
    expect(() =>
      buildNpcInventoryPreview(catalog, [{ ...left, equippedSlots: ['HAND_L', 'HAND_R'] }]),
    ).toThrow('hand count');
  });
  it('CORE-177 requires both hands for an actual two-handed Erivel and refuses simultaneous held weapons', () => {
    const item = {
      ...npcKensiRequest(id(4)),
      itemTypeId: 'ITM-WPN-004',
      equipped: true,
      equippedSlots: ['HAND_L', 'HAND_R'],
    };
    const result = buildNpcInventoryPublication(catalog, withRequest(item));
    expect(result.items[0]?.item.equippedSlots).toEqual(['HAND_L', 'HAND_R']);
    expect(readNpcInventoryPublication(catalog, readCopy(result))).toEqual(result);
    expect(() =>
      buildNpcInventoryPreview(catalog, [{ ...item, equippedSlots: ['HAND_L'] }]),
    ).toThrow('hand count');
    expect(() =>
      buildNpcInventoryPreview(catalog, [
        item,
        { ...npcKensiRequest(id(6)), equipped: true, equippedSlots: ['HAND_R'] },
      ]),
    ).toThrow('same hand');
  });
  it('keeps actual reserved IDs and source mechanics without allocating publication metadata', () => {
    const request = npcKensiRequest(id(4)),
      before = JSON.stringify(request);
    const result = buildNpcInventoryPreview(catalog, [request]);
    expect(result.items[0]?.request).toEqual(request);
    expect(firstWeapon(result).stagedProfile.weaponTypeId).toBe('ITM-WPN-003');
    expect(firstWeapon(result).stagedProfile.statSource).toBe('TEMPLATE_FIXED');
    expect(Object.keys(result)).toEqual(['items']);
    expect(Object.keys(result.items[0]!)).toEqual(['request', 'stagedProfile']);
    for (const key of [
      'definitionId',
      'rollGroupId',
      'weaponProfileVersionId',
      'createdAt',
      'actorId',
    ])
      expect(JSON.stringify(result)).not.toContain('"' + key + '"');
    expect(JSON.stringify(request)).toBe(before);
    expect(readNpcInventoryPreview(catalog, readCopy(result))).toEqual(result);
    expect(Object.isFrozen(firstWeapon(result).stagedProfile.properties)).toBe(true);
    expect(buildNpcInventoryPreview(catalog, [])).toEqual({ items: [] });
  });
  it('resolves a real explicit master shield profile without a fake profile version', () => {
    const result = buildNpcInventoryPreview(catalog, [shield()]);
    expect(result.items[0]?.request.shieldCurrentHP).toBe(0);
    expect(firstWeapon(result).stagedProfile.statSource).toBe('MASTER_OVERRIDE');
    expect(readNpcInventoryPreview(catalog, readCopy(result))).toEqual(result);
  });
  it('refuses forged derived mechanics, arbitrary publication fields and unproved equipment', () => {
    const result = buildNpcInventoryPreview(catalog, [npcKensiRequest(id(4))]);
    expect(() =>
      readNpcInventoryPreview(catalog, { ...result, commitOperationId: id(2) }),
    ).toThrow();
    expect(() =>
      readNpcInventoryPreview(catalog, {
        items: [
          {
            ...result.items[0],
            stagedProfile: { ...firstWeapon(result).stagedProfile, rangeMeters: 99999 },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      buildNpcInventoryPreview(catalog, [{ ...npcKensiRequest(id(4)), equipped: true }]),
    ).toThrow();
    expect(() =>
      buildNpcInventoryPreview(catalog, [{ ...npcKensiRequest(id(4)), currentAmmo: null }]),
    ).toThrow();
  });
  it('refuses getters without executing them in requests and recomputed results', () => {
    let calls = 0;
    const request = npcKensiRequest(id(4)),
      result = buildNpcInventoryPreview(catalog, [request]);
    expect(() =>
      buildNpcInventoryPreview(catalog, [
        {
          ...request,
          get profile() {
            calls++;
            return request.profile;
          },
        },
      ]),
    ).toThrow();
    expect(() =>
      readNpcInventoryPreview(catalog, {
        items: [
          {
            ...result.items[0],
            get stagedProfile() {
              calls++;
              return firstWeapon(result).stagedProfile;
            },
          },
        ],
      }),
    ).toThrow();
    expect(calls).toBe(0);
  });
});

describe('explicit source-backed GM quality and clothing metadata', () => {
  const inventoryWithMetadata = createNpcInventoryCatalog(
    source('catalogue'),
    source('armor-profiles'),
    source('pharmaceuticals'),
    weapons,
    { instanceModel: source('instance-model'), dictionaries: source('dictionaries') },
  );
  const metadataCatalog = createNpcInventoryPublicationCatalog(inventoryWithMetadata, fields);
  const clothes = (n = 80): NpcCatalogueInventoryRequestEntry => ({
    ...npcKensiRequest(id(n)),
    itemTypeId: 'RES-EQP-001',
    currentAmmo: null,
    equipped: true,
    equippedSlots: ['TORSO'],
    clothingProperties: {
      coveredRegionIds: ['TORSO'],
      hermetic: true,
      flammability: 'COMBUSTIBLE',
    },
  });
  it('derives all six final GM choices from QUALITY and refuses changed source fields or forged capabilities', () => {
    expect(npcInventoryMetadataChoices(inventoryWithMetadata)?.qualityTiers).toEqual([
      { value: 'MISSING_OR_UNFIT', label: 'Отсутствует/непригоден' },
      { value: 'POOR', label: 'Плохое' },
      { value: 'ORDINARY', label: 'Обычное' },
      { value: 'GOOD', label: 'Хорошее' },
      { value: 'EXCEPTIONAL', label: 'Исключительное' },
      { value: 'RARE', label: 'Редкое' },
    ]);
    expect(npcInventoryMetadataChoices({ ...inventoryWithMetadata })).toBeNull();
    const changed = (source('dictionaries') as Record<string, unknown>[]).map((row) =>
      row['Dictionary'] === 'QUALITY' && row['Code'] === '20'
        ? { ...row, Meaning: 'Made up' }
        : row,
    );
    expect(() =>
      createNpcInventoryCatalog(
        source('catalogue'),
        source('armor-profiles'),
        source('pharmaceuticals'),
        weapons,
        { instanceModel: source('instance-model'), dictionaries: changed },
      ),
    ).toThrow('QUALITY');
    const changedField = (source('instance-model') as Record<string, unknown>[]).map((row) =>
      row['Field'] === 'qualityTier' ? { ...row, Required: true } : row,
    );
    expect(() =>
      createNpcInventoryCatalog(
        source('catalogue'),
        source('armor-profiles'),
        source('pharmaceuticals'),
        weapons,
        { instanceModel: changedField, dictionaries: source('dictionaries') },
      ),
    ).toThrow('field contract');
  });
  it.each([null, 'MISSING_OR_UNFIT', 'POOR', 'ORDINARY', 'GOOD', 'EXCEPTIONAL', 'RARE'] as const)(
    'stores GM tier %s without rolling, removing the item or altering the source weapon profile',
    (qualityTier) => {
      const before = buildNpcInventoryPublication(metadataCatalog, initial());
      const after = buildNpcInventoryPublication(
        metadataCatalog,
        withRequest({ ...npcKensiRequest(id(4)), qualityTier }),
      );
      expect(after.items[0]?.item.qualityTier).toBe(qualityTier);
      expect(after.input[0]?.qualityTier).toBe(qualityTier);
      expect(after.items[0]?.item.qualityRoll).toBeNull();
      expect(after.items[0]?.item.quantity).toBe(1);
      expect(after.items[0]?.item.broken).toBe(false);
      expect(after.items[0]?.profileVersions).toEqual(before.items[0]?.profileVersions);
      expect(after.items[0]?.item.stackKey).not.toEqual(before.items[0]?.item.stackKey);
      expect(Object.hasOwn(before.items[0]!.item, 'qualityTier')).toBe(false);
      expect(Object.hasOwn(before.input[0]!, 'qualityTier')).toBe(false);
      expect(readNpcInventoryPublication(metadataCatalog, readCopy(after))).toEqual(after);
      expect(() =>
        buildNpcInventoryPreview(catalog, [{ ...npcKensiRequest(id(4)), qualityTier }]),
      ).toThrow('capability');
    },
  );
  it('keeps clothing coverage declarative beside other clothing, armor and an occupied weapon hand', () => {
    const weapon = { ...npcKensiRequest(id(82)), equipped: true, equippedSlots: ['HAND_L'] };
    const requests = [clothes(), clothes(81), armor(), weapon];
    const preview = buildNpcInventoryPreview(metadataCatalog, requests);
    expect(preview.items).toHaveLength(4);
    const contribution = deriveNpcInventoryStatContributions(metadataCatalog, requests);
    const onlyArmor = deriveNpcInventoryStatContributions(metadataCatalog, [armor()]);
    expect(contribution).toEqual(onlyArmor);
    expect(contribution.equippedHermeticNate).toBe(false);
    const saved = buildNpcInventoryPublication(metadataCatalog, {
      ...initial(),
      entries: [{ request: clothes(), weaponProfileVersionId: null }],
    });
    expect(saved.items[0]?.kind).toBe('CATALOG_ITEM');
    expect(saved.items[0]?.item).toMatchObject({
      equipped: true,
      equippedSlots: ['TORSO'],
      bodyZone: null,
      sealed: null,
      clothingProperties: clothes().clothingProperties,
      activeWeaponProfileVersionIdByVariant: {},
    });
    expect(saved.items[0]?.profileVersions).toEqual([]);
    expect(readNpcInventoryPublication(metadataCatalog, readCopy(saved))).toEqual(saved);
  });
  it('refuses missing or forged clothing coverage and cannot use hermetic metadata as Nate or armor', () => {
    const { clothingProperties: _properties, ...legacy } = clothes();
    expect(() => buildNpcInventoryPreview(metadataCatalog, [legacy])).toThrow('explicit physical');
    for (const changed of [
      {
        ...clothes(),
        clothingProperties: { ...clothes().clothingProperties, coveredRegionIds: [] },
      },
      {
        ...clothes(),
        clothingProperties: { ...clothes().clothingProperties, coveredRegionIds: ['HAND_L'] },
      },
      {
        ...clothes(),
        clothingProperties: {
          ...clothes().clothingProperties,
          coveredRegionIds: ['TORSO', 'TORSO'],
        },
      },
      { ...clothes(), equippedSlots: ['ARM_L'] },
      { ...clothes(), bodyZone: 'TORSO' },
      { ...clothes(), sealed: true },
      { ...clothes(), itemTypeId: 'RES-CON-001' },
    ])
      expect(() => buildNpcInventoryPreview(metadataCatalog, [changed])).toThrow();
    const explicitUnknown = {
      ...clothes(),
      clothingProperties: {
        coveredRegionIds: ['TORSO'],
        hermetic: 'UNKNOWN',
        flammability: 'UNKNOWN',
      },
    };
    expect(buildNpcInventoryPreview(metadataCatalog, [explicitUnknown]).items[0]?.request).toEqual(
      explicitUnknown,
    );
    expect(() =>
      readNpcInventoryRequest([{ ...npcKensiRequest(id(4)), qualityTier: 'LEGENDARY' }]),
    ).toThrow();
    expect(() =>
      readNpcInventoryRequest([{ ...npcKensiRequest(id(4)), qualityTier: undefined }]),
    ).toThrow();
  });
  it('preserves legacy carried clothes without adding metadata or an equipment profile', () => {
    const { clothingProperties: _properties, ...old } = clothes();
    const carried = { ...old, equipped: false, equippedSlots: [] };
    const saved = buildNpcInventoryPublication(catalog, {
      ...initial(),
      entries: [{ request: carried, weaponProfileVersionId: null }],
    });
    expect(Object.hasOwn(saved.items[0]!.item, 'clothingProperties')).toBe(false);
    expect(saved.items[0]?.profileVersions).toEqual([]);
    expect(readNpcInventoryPublication(metadataCatalog, readCopy(saved))).toEqual(saved);
  });
  it('edits only current quality/clothing in N+1, retaining immutable prior bytes and physical provenance', () => {
    const first = buildNpcInventoryPublication(metadataCatalog, {
      ...initial(),
      entries: [{ request: { ...clothes(), qualityTier: 'GOOD' }, weaponProfileVersionId: null }],
    });
    const frozen = JSON.stringify(first);
    const previous = {
      npcUuid: initial().npcUuid,
      version: 1,
      sha256: 'a'.repeat(64),
      commitOperationId: initial().commitOperationId,
    };
    const context = { history: [{ ...previous, publication: first }] };
    const updated = {
      ...clothes(),
      qualityTier: null,
      equippedSlots: ['TORSO', 'ARM_L'],
      clothingProperties: {
        coveredRegionIds: ['TORSO', 'ARM_L'],
        hermetic: false,
        flammability: 'UNKNOWN',
      },
    };
    const second = buildNpcInventoryPublication(
      metadataCatalog,
      {
        ...initial(),
        previous,
        commitOperationId: id(90),
        committedAt: '2026-11-06T03:01:00.000Z',
        entries: [{ request: updated, weaponProfileVersionId: null }],
      },
      context,
    );
    expect(second.items[0]?.item.provenance).toEqual(first.items[0]?.item.provenance);
    expect(second.items[0]?.item.createdAt).toEqual(first.items[0]?.item.createdAt);
    expect(second.items[0]?.item.qualityTier).toBeNull();
    expect(second.items[0]?.item.clothingProperties).toEqual(updated.clothingProperties);
    expect(readNpcInventoryPublication(metadataCatalog, readCopy(second), context)).toEqual(second);
    expect(JSON.stringify(first)).toBe(frozen);
  });
});
