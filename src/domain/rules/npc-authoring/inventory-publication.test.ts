import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalWeaponProfileCatalog } from '../../../host/weapon-profile-catalog.js';
import { createNpcInventoryCatalog, type NpcInventoryRequestEntry } from './inventory.js';
import {
  buildNpcInventoryPublication,
  buildNpcInventoryPreview,
  readNpcInventoryPreview,
  createNpcInventoryPublicationCatalog,
  readNpcInventoryPublication,
  NpcInventoryPublicationError,
  type NpcInventoryPublicationProof,
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
    { equipped: true, equippedSlots: ['HAND_L'] },
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
  it('keeps actual reserved IDs and source mechanics without allocating publication metadata', () => {
    const request = npcKensiRequest(id(4)),
      before = JSON.stringify(request);
    const result = buildNpcInventoryPreview(catalog, [request]);
    expect(result.items[0]?.request).toEqual(request);
    expect(result.items[0]?.stagedProfile.weaponTypeId).toBe('ITM-WPN-003');
    expect(result.items[0]?.stagedProfile.statSource).toBe('TEMPLATE_FIXED');
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
    expect(Object.isFrozen(result.items[0]?.stagedProfile.properties)).toBe(true);
    expect(buildNpcInventoryPreview(catalog, [])).toEqual({ items: [] });
  });
  it('resolves a real explicit master shield profile without a fake profile version', () => {
    const result = buildNpcInventoryPreview(catalog, [shield()]);
    expect(result.items[0]?.request.shieldCurrentHP).toBe(0);
    expect(result.items[0]?.stagedProfile.statSource).toBe('MASTER_OVERRIDE');
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
            stagedProfile: { ...result.items[0]!.stagedProfile, rangeMeters: 99999 },
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
              return result.items[0]!.stagedProfile;
            },
          },
        ],
      }),
    ).toThrow();
    expect(calls).toBe(0);
  });
});
