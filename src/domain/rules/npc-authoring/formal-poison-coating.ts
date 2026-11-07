import {
  assertNpcPoisonSourceCatalog,
  assertNpcPoisonSourceTarget,
  readNpcTaipanModeContribution,
  readNpcPoisonSourceContribution,
  type NpcPoisonSourceCatalog,
  type NpcTaipanModeContribution,
  type NpcPoisonSourceContribution,
} from './formal-poison-source.js';
import {
  npcPublicationData as data,
  npcInventoryPublicationSource,
  isNpcPoisonPublicationAvailable,
  readNpcInventoryPhysicalBasis,
  type NpcInventoryPublicationCatalog,
  type NpcInventoryPhysicalBasis,
} from './inventory-publication.js';
import type { NpcInitialTraumaCalendarAnchor } from './initial-trauma.js';
import type { NpcPreparedCoatingInstance } from './effect-types.js';
import type { NpcFormalLifeState } from './formal-life-state.js';
import type { NpcInventoryRequestEntry } from './inventory.js';

type Mode = ReturnType<typeof readNpcTaipanModeContribution>;
type Source = ReturnType<typeof readNpcPoisonSourceContribution>;
export type NpcPoisonCarrierKind = 'MELEE_COMPONENT' | 'PROJECTILE' | 'FOOD';
export interface NpcPoisonCarrierChoice {
  readonly itemInstanceId: string;
  readonly itemTypeId: string | null;
  readonly kind: NpcPoisonCarrierKind;
  readonly surfaceKey: NpcPoisonCarrierKind;
  readonly componentRole: 'SWORD' | 'RAPIER' | 'SHIELD' | null;
  readonly linkedSetInstanceIdOrNull: string | null;
  readonly label: string;
}
export interface NpcPoisonCoatingPreparation {
  readonly kind: 'GM_FORMAL_INITIAL_POISON_COATING';
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly coatingInstanceId: string;
  readonly preparationOperationId: string;
  readonly sourceInstanceId: string;
  readonly targetItemInstanceId: string;
  readonly surfaceConfirmed: true;
  readonly replacesCoatingIdOrNull: string | null;
  readonly replaceConfirmed: boolean;
  readonly reason: string;
  readonly calendarAnchor: NpcInitialTraumaCalendarAnchor;
  readonly createdAt: string;
  readonly revision: 1;
}
export interface NpcPoisonCoatingRemoval {
  readonly kind: 'GM_FORMAL_INITIAL_POISON_COATING_REMOVAL';
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly coatingInstanceId: string;
  readonly targetItemInstanceId: string;
  readonly sourceOperationId: string;
  readonly reason: string;
  readonly createdAt: string;
}
export type NpcPoisonCoatingOrigin =
  | Readonly<{ kind: 'PREPARED'; preparationOperationId: string }>
  | Readonly<{ kind: 'COMMITTED'; originCommitOperationId: string }>;
export interface NpcPoisonCoatingDerivationContext {
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly campaignTimestamp: number;
  readonly origin: NpcPoisonCoatingOrigin;
  readonly mode: NpcTaipanModeContribution;
  readonly source: NpcPoisonSourceContribution;
  /** Independently owner-resolved physical graph at preparation, not a browser profile claim. */
  readonly originalInventory: NpcInventoryPhysicalBasis;
  readonly currentInventory: NpcInventoryPhysicalBasis;
  readonly replaces: NpcPoisonCoatingContribution | null;
}
export interface NpcFormalPoisonCoatingInstance extends NpcPreparedCoatingInstance {
  readonly consumptionState: 'ACTIVE';
  readonly effectFamily: 'POISON';
  readonly poisonSourceKind: 'SYMBIOTIC';
  readonly sourceInstanceId: string;
  readonly sourceAbilityId: Mode['sourceAbilityId'];
  readonly modeOperationId: string;
  readonly payload: Readonly<{
    poisonProfileId: Mode['activePoisonProfileId'];
    deliveryKind: 'COATING';
    payloadKind: 'PERIODIC_DAMAGE' | 'STAT_DEBUFF' | 'LIMB_DISABLE';
    sourceFormula: string;
    futureDeliveryRule:
      'FULL_PROFILE' | 'HALF_PERIODIC_DAMAGE' | 'HALF_STAT_DEBUFF_K' | 'HALF_DURATION';
  }>;
  readonly carrier: NpcPoisonCarrierChoice;
  readonly originalSourceSnapshot: Source['originalSourceSnapshot'];
  readonly currentSourceContext: Readonly<{
    effectiveSourceSnapshot: Source['effectiveSourceSnapshot'];
    resolution: Source['resolution'];
  }>;
  readonly appliedAt: Readonly<{ campaignTimestamp: number }>;
  readonly expiry: null;
  readonly consumeCondition: 'FIRST_SUCCESSFUL_HIT' | 'INGESTION';
  readonly origin: NpcPoisonCoatingOrigin;
  readonly preparationOperationId: string;
  readonly reason: string;
  readonly createdAt: string;
}
declare const catalogBrand: unique symbol;
declare const contributionBrand: unique symbol;
declare const preparationBrand: unique symbol;
export interface NpcFormalPoisonCatalog {
  readonly [catalogBrand]: true;
}
export interface NpcPoisonCoatingContribution {
  readonly [contributionBrand]: true;
}
export interface NpcPoisonPreparationEvidence {
  readonly [preparationBrand]: true;
}
export interface NpcPoisonPreparationEvidenceContext {
  readonly mode: NpcTaipanModeContribution;
  readonly source: NpcPoisonSourceContribution;
  readonly originalInventory: NpcInventoryPhysicalBasis;
  readonly replaces: NpcPoisonPreparationEvidence | NpcPoisonCoatingContribution | null;
}
export type NpcPoisonPreparationHistoryEvent =
  | Readonly<{ kind: 'PREPARE'; preparation: NpcPoisonPreparationEvidence }>
  | Readonly<{ kind: 'REMOVE'; removal: NpcPoisonCoatingRemoval }>;
export interface NpcArchivedCoatingPreparationReference {
  readonly coatingInstanceId: string;
  readonly preparationOperationId: string;
}
export interface NpcPoisonPreparationSelection {
  readonly targetItemInstanceId: string;
  readonly preparationOrNull: NpcArchivedCoatingPreparationReference | null;
}
/** Actual owning adjunct; it is never serialized recursively into an NPC snapshot. */
export interface NpcInventoryCoatingContext {
  readonly catalog: NpcFormalPoisonCatalog;
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly campaignTimestamp: number;
  readonly targetCommitOperationIdOrNull: string | null;
  readonly contributions: readonly NpcPoisonCoatingContribution[];
  readonly removals: readonly NpcPoisonCoatingRemoval[];
  /** Complete ordered actual preparation/removal history, independently reconstructed by the host. */
  readonly preparationHistory?: readonly NpcPoisonPreparationHistoryEvent[];
}
export interface NpcInventoryCoatingOriginReference {
  readonly coatingInstanceId: string;
  readonly originCommitOperationId: string;
}
interface PoisonDefinition {
  readonly poisonProfileId: Mode['activePoisonProfileId'];
  readonly sourceAbilityId: Mode['sourceAbilityId'];
  readonly payloadKind: NpcFormalPoisonCoatingInstance['payload']['payloadKind'];
  readonly sourceFormula: string;
  readonly reducedDelivery: Exclude<
    NpcFormalPoisonCoatingInstance['payload']['futureDeliveryRule'],
    'FULL_PROFILE'
  >;
}
interface Catalog {
  readonly source: NpcPoisonSourceCatalog;
  readonly publication: NpcInventoryPublicationCatalog;
  readonly definitions: readonly PoisonDefinition[];
}
interface Contribution {
  readonly preparation: NpcPoisonCoatingPreparation;
  readonly context: NpcPoisonCoatingDerivationContext;
  readonly coating: NpcFormalPoisonCoatingInstance;
}
const catalogs = new WeakMap<NpcFormalPoisonCatalog, Catalog>();
const contributions = new WeakMap<
  NpcPoisonCoatingContribution,
  Readonly<{
    catalog: NpcFormalPoisonCatalog;
    value: Contribution;
  }>
>();
const preparationEvidence = new WeakMap<
  NpcPoisonPreparationEvidence,
  Readonly<{
    catalog: NpcFormalPoisonCatalog;
    preparation: NpcPoisonCoatingPreparation;
    originalContribution: NpcPoisonCoatingContribution;
  }>
>();
export class NpcPoisonCoatingError extends Error {
  constructor(detail: string) {
    super('NPC prepared poison: ' + detail);
    this.name = 'NpcPoisonCoatingError';
  }
}
function fail(detail: string): never {
  throw new NpcPoisonCoatingError(detail);
}
function catalogValue(catalog: NpcFormalPoisonCatalog): Catalog {
  return catalogs.get(catalog) ?? fail('unissued source catalog');
}
function minute(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail('expected confirmed virtual minute');
}
function anchor(value: unknown): NpcInitialTraumaCalendarAnchor {
  const row = data.record(value);
  const campaignTimestamp = minute(row.campaignTimestamp);
  if (row.kind === 'PRE_START_INITIAL') {
    data.record(value, ['kind', 'campaignTimestamp', 'lobbySnapshotRevision']);
    const revision = data.text(row.lobbySnapshotRevision);
    if (!/^[0-9a-f]{64}$/u.test(revision)) return fail('invalid lobby snapshot revision');
    return { kind: row.kind, campaignTimestamp, lobbySnapshotRevision: revision };
  }
  if (row.kind === 'CURRENT_CAMPAIGN') {
    data.record(value, ['kind', 'campaignTimestamp', 'stateRevision']);
    return { kind: row.kind, campaignTimestamp, stateRevision: minute(row.stateRevision) };
  }
  return fail('unknown calendar anchor');
}
function origin(value: unknown): NpcPoisonCoatingOrigin {
  const row = data.record(value);
  if (row.kind === 'PREPARED') {
    data.record(value, ['kind', 'preparationOperationId']);
    return { kind: row.kind, preparationOperationId: data.uuid(row.preparationOperationId) };
  }
  if (row.kind === 'COMMITTED') {
    data.record(value, ['kind', 'originCommitOperationId']);
    return { kind: row.kind, originCommitOperationId: data.uuid(row.originCommitOperationId) };
  }
  return fail('unknown original preparation/COMMIT phase');
}
export function readNpcPoisonCoatingPreparation(value: unknown): NpcPoisonCoatingPreparation {
  const row = data.record(value, [
    'kind',
    'campaignId',
    'npcUuid',
    'coatingInstanceId',
    'preparationOperationId',
    'sourceInstanceId',
    'targetItemInstanceId',
    'surfaceConfirmed',
    'replacesCoatingIdOrNull',
    'replaceConfirmed',
    'reason',
    'calendarAnchor',
    'createdAt',
    'revision',
  ]);
  if (
    row.kind !== 'GM_FORMAL_INITIAL_POISON_COATING' ||
    row.surfaceConfirmed !== true ||
    typeof row.replaceConfirmed !== 'boolean' ||
    row.revision !== 1
  )
    return fail('explicit preparation, surface confirmation and revision required');
  const replacesCoatingIdOrNull =
    row.replacesCoatingIdOrNull === null ? null : data.uuid(row.replacesCoatingIdOrNull);
  if (row.replaceConfirmed !== (replacesCoatingIdOrNull !== null))
    return fail('replacement must be an explicit independent confirmation');
  const result: NpcPoisonCoatingPreparation = {
    kind: row.kind,
    campaignId: data.uuid(row.campaignId),
    npcUuid: data.uuid(row.npcUuid),
    coatingInstanceId: data.uuid(row.coatingInstanceId),
    preparationOperationId: data.uuid(row.preparationOperationId),
    sourceInstanceId: data.uuid(row.sourceInstanceId),
    targetItemInstanceId: data.uuid(row.targetItemInstanceId),
    surfaceConfirmed: true,
    replacesCoatingIdOrNull,
    replaceConfirmed: row.replaceConfirmed,
    reason: data.text(row.reason),
    calendarAnchor: anchor(row.calendarAnchor),
    createdAt: data.text(row.createdAt),
    revision: 1,
  };
  if (
    [
      result.sourceInstanceId,
      result.targetItemInstanceId,
      result.preparationOperationId,
      result.replacesCoatingIdOrNull,
    ].includes(result.coatingInstanceId)
  )
    return fail('coating identity overlaps another identity domain');
  return data.freeze(result);
}
export function readNpcPoisonCoatingRemoval(value: unknown): NpcPoisonCoatingRemoval {
  const row = data.record(value, [
    'kind',
    'campaignId',
    'npcUuid',
    'coatingInstanceId',
    'targetItemInstanceId',
    'sourceOperationId',
    'reason',
    'createdAt',
  ]);
  if (row.kind !== 'GM_FORMAL_INITIAL_POISON_COATING_REMOVAL')
    return fail('unknown coating removal operation');
  return data.freeze({
    kind: row.kind,
    campaignId: data.uuid(row.campaignId),
    npcUuid: data.uuid(row.npcUuid),
    coatingInstanceId: data.uuid(row.coatingInstanceId),
    targetItemInstanceId: data.uuid(row.targetItemInstanceId),
    sourceOperationId: data.uuid(row.sourceOperationId),
    reason: data.text(row.reason),
    createdAt: data.text(row.createdAt),
  });
}
/** Exact source payloads remain unresolved until a future delivery with actual target/R20. */
export function createNpcFormalPoisonCatalog(
  components: Readonly<{
    source: NpcPoisonSourceCatalog;
    publication: NpcInventoryPublicationCatalog;
  }>,
  sources: Readonly<{ poisons: unknown; operations: unknown }>,
): NpcFormalPoisonCatalog {
  data.record(components, ['source', 'publication']);
  assertNpcPoisonSourceCatalog(components.source);
  if (!isNpcPoisonPublicationAvailable(components.publication))
    return fail('initial coating source is not delivered');
  data.record(sources, ['poisons', 'operations']);
  const definitions: readonly PoisonDefinition[] = [
    {
      poisonProfileId: 'POI-TAIPAN-DEADLY',
      sourceAbilityId: 'SYM-039',
      payloadKind: 'PERIODIC_DAMAGE',
      sourceFormula: 'R20/5+L per turn; duration R20/2',
      reducedDelivery: 'HALF_PERIODIC_DAMAGE',
    },
    {
      poisonProfileId: 'POI-TAIPAN-WEAKENING',
      sourceAbilityId: 'SYM-042',
      payloadKind: 'STAT_DEBUFF',
      sourceFormula: 'K=max(0,R20+L−Z); S/D/M decrease, each not below 1; duration R20/2',
      reducedDelivery: 'HALF_STAT_DEBUFF_K',
    },
    {
      poisonProfileId: 'POI-TAIPAN-PARALYTIC',
      sourceAbilityId: 'SYM-045',
      payloadKind: 'LIMB_DISABLE',
      sourceFormula:
        'if R20+L>Z: humanoid active limb; duration R20/3; nonhumanoid secondary paralysis skipped',
      reducedDelivery: 'HALF_DURATION',
    },
  ];
  const rows = data.array(sources.poisons).map((value) => data.record(value));
  for (const definition of definitions) {
    const found = rows.filter((row) => row.PoisonProfileID === definition.poisonProfileId);
    if (found.length !== 1) return fail('missing or duplicate source poison profile');
    const row = found[0]!;
    data.equal(definition.sourceAbilityId, row['Rule refs']);
    data.equal('SYMBIOTIC', row['Source kind']);
    data.equal('POISON', row['Effect family']);
    data.equal(definition.payloadKind, row['Payload kind']);
    data.equal(definition.sourceFormula, row.Payload);
  }
  const operations = data
    .array(sources.operations)
    .map((value) => data.record(value))
    .filter((row) => row.OperationID === 'OP-COAT');
  if (operations.length !== 1) return fail('missing source coating operation');
  data.equal('APPLY_COATING', operations[0]!.Command);
  data.equal('Мирно для яда; бой для слюны', operations[0]!.Context);
  data.equal(
    'Нанести одно покрытие на конкретный экземпляр/снаряд/еду',
    operations[0]!['Input / action'],
  );
  const catalog = Object.freeze({}) as NpcFormalPoisonCatalog;
  catalogs.set(catalog, {
    source: components.source,
    publication: components.publication,
    definitions: data.freeze(definitions),
  });
  return catalog;
}
function carrierChoices(
  catalog: Catalog,
  value: NpcInventoryPhysicalBasis,
): readonly NpcPoisonCarrierChoice[] {
  const inventory = readNpcInventoryPhysicalBasis(catalog.publication, value);
  const source = npcInventoryPublicationSource(catalog.publication);
  return data.freeze(
    inventory.items.flatMap((item): NpcPoisonCarrierChoice[] => {
      const r = item.request;
      if (r.quantity !== 1) return [];
      let kind: NpcPoisonCarrierKind;
      let label: string;
      if ('customProfile' in item) {
        if (!item.customProfile.isFood || !item.customProfile.canReceivePoison) return [];
        kind = 'FOOD';
        label = item.customProfile.name;
      } else if (
        'catalogProfile' in item &&
        (r.itemTypeId === 'RES-AMM-001' || r.itemTypeId === 'RES-AMM-002')
      ) {
        kind = 'PROJECTILE';
        label = data.text(item.catalogProfile.catalogueSource['Название']);
      } else if ('stagedProfile' in item) {
        const definition =
          source.definitions.find((d) => d.itemTypeId === r.itemTypeId) ??
          fail('missing actual carrier type');
        const category = definition.catalogueSource['Подкатегория'];
        if (category === 'Арбалет' || category === 'Лук') return [];
        if (!['Ближнее оружие', 'Щит', 'Составной комплект'].includes(data.text(category)))
          return fail('unrecognized physical attack category');
        if (Object.hasOwn(item.stagedProfile.properties, 'Боеприпас'))
          return fail('ranged profile cannot become a melee coating surface');
        kind = 'MELEE_COMPONENT';
        label = item.stagedProfile.name;
      } else return [];
      // There is exactly one modeled surface per actual physical component. Grip
      // and attack variants never mint another surface or another coating identity.
      return [
        {
          itemInstanceId: r.itemInstanceId,
          itemTypeId: r.itemTypeId,
          kind,
          surfaceKey: kind,
          componentRole: r.componentRole,
          linkedSetInstanceIdOrNull: r.linkedSetInstanceId,
          label,
        },
      ];
    }),
  );
}
export function npcPoisonCarrierChoices(
  catalog: NpcFormalPoisonCatalog,
  inventory: NpcInventoryPhysicalBasis,
): readonly NpcPoisonCarrierChoice[] {
  return carrierChoices(catalogValue(catalog), inventory);
}
function carrier(
  catalog: Catalog,
  inventory: NpcInventoryPhysicalBasis,
  id: string,
): NpcPoisonCarrierChoice {
  return (
    carrierChoices(catalog, inventory).find((item) => item.itemInstanceId === id) ??
    fail('target is not an actual typed individual carrier')
  );
}
export function readNpcPoisonCoatingContribution(
  catalog: NpcFormalPoisonCatalog,
  token: NpcPoisonCoatingContribution,
): Contribution {
  catalogValue(catalog);
  const found = contributions.get(token);
  if (found?.catalog !== catalog) return fail('unissued or foreign coating contribution');
  return found.value;
}
/** Does not allocate, roll, spend resources, consume poison or change source mode. */
export function deriveNpcPreparedPoisonCoating(
  catalog: NpcFormalPoisonCatalog,
  value: unknown,
  context: NpcPoisonCoatingDerivationContext,
): NpcPoisonCoatingContribution {
  const c = catalogValue(catalog),
    preparation = readNpcPoisonCoatingPreparation(value);
  const mode = readNpcTaipanModeContribution(c.source, context.mode);
  const source = readNpcPoisonSourceContribution(c.source, context.source);
  data.record(context, [
    'campaignId',
    'npcUuid',
    'campaignTimestamp',
    'origin',
    'mode',
    'source',
    'originalInventory',
    'currentInventory',
    'replaces',
  ]);
  const targetMinute = minute(context.campaignTimestamp),
    phase = origin(context.origin);
  if (
    data.uuid(context.campaignId) !== preparation.campaignId ||
    data.uuid(context.npcUuid) !== preparation.npcUuid ||
    mode.campaignId !== preparation.campaignId ||
    mode.npcUuid !== preparation.npcUuid ||
    source.campaignId !== preparation.campaignId ||
    source.npcUuid !== preparation.npcUuid ||
    mode.sourceInstanceId !== preparation.sourceInstanceId ||
    source.sourceInstanceId !== preparation.sourceInstanceId ||
    source.preparationOperationId !== preparation.preparationOperationId ||
    source.originalCampaignTimestamp !== preparation.calendarAnchor.campaignTimestamp ||
    source.campaignTimestamp !== targetMinute ||
    targetMinute < preparation.calendarAnchor.campaignTimestamp
  )
    return fail('scope, original preparation or confirmed clock differs');
  data.equal(phase, source.origin);
  if (
    mode.modeOperationId !== source.modeOperationId ||
    !source.initialPreparationAllowed ||
    mode.activePoisonProfileId !== source.activePoisonProfileId ||
    mode.sourceAbilityId !== source.sourceAbilityId
  )
    return fail('coating profile differs from its independently proven original mode');
  if (
    phase.kind === 'PREPARED' &&
    (phase.preparationOperationId !== preparation.preparationOperationId ||
      targetMinute !== preparation.calendarAnchor.campaignTimestamp)
  )
    return fail('prepared coating no longer has its original operation or initial clock');
  // ADR0087 requires an active source at the actual PREPARATION observation.
  // A durable dose already exists before its first NPC COMMIT; later source loss
  // changes its proven current/frozen context, not the original preparation fact.
  const originalCarrier = carrier(c, context.originalInventory, preparation.targetItemInstanceId);
  const currentCarrier = carrier(c, context.currentInventory, preparation.targetItemInstanceId);
  data.equal({ ...originalCarrier, label: currentCarrier.label }, currentCarrier);
  const originalPhysical = readNpcInventoryPhysicalBasis(c.publication, context.originalInventory);
  const physical = readNpcInventoryPhysicalBasis(c.publication, context.currentInventory);
  for (const basis of [originalPhysical, physical]) {
    if (
      basis.history !== null &&
      basis.history.history.some((entry) => entry.npcUuid !== preparation.npcUuid)
    )
      return fail('carrier history belongs to another NPC');
  }
  const originalRequest =
    originalPhysical.requests.find(
      (request) => request.itemInstanceId === preparation.targetItemInstanceId,
    ) ?? fail('original carrier request is absent');
  data.equal(
    preparation.replacesCoatingIdOrNull === null ? [] : [preparation.replacesCoatingIdOrNull],
    originalRequest.coatingInstanceIds,
  );
  if (
    preparation.campaignId === preparation.coatingInstanceId ||
    preparation.npcUuid === preparation.coatingInstanceId ||
    mode.effectInstanceId === preparation.coatingInstanceId ||
    mode.modeOperationId === preparation.coatingInstanceId ||
    physical.items.some(
      ({ request }) =>
        request.itemInstanceId === preparation.coatingInstanceId ||
        request.linkedSetInstanceId === preparation.coatingInstanceId ||
        (request.itemTypeId === null &&
          (request.itemTypeReference.profileId === preparation.coatingInstanceId ||
            request.itemTypeReference.profileVersionId === preparation.coatingInstanceId)) ||
        (request.itemTypeId !== null &&
          request.customModifier !== undefined &&
          (request.customModifier.reference.profileId === preparation.coatingInstanceId ||
            request.customModifier.reference.profileVersionId === preparation.coatingInstanceId)),
    )
  )
    return fail('coating identity overlaps the physical inventory graph');
  if (context.replaces === null) {
    if (preparation.replacesCoatingIdOrNull !== null)
      return fail('replacement lacks its actual prior dose');
  } else {
    const prior = readNpcPoisonCoatingContribution(catalog, context.replaces);
    if (
      prior.preparation.campaignId !== preparation.campaignId ||
      prior.preparation.npcUuid !== preparation.npcUuid ||
      prior.coating.coatingInstanceId !== preparation.replacesCoatingIdOrNull ||
      prior.coating.hostItemInstanceId !== preparation.targetItemInstanceId ||
      prior.coating.surfaceKey !== originalCarrier.surfaceKey
    )
      return fail('replacement differs from the actual prior dose and surface');
  }
  const definition =
    c.definitions.find((d) => d.poisonProfileId === mode.activePoisonProfileId) ??
    fail('unrecognized prepared poison profile');
  const coating: NpcFormalPoisonCoatingInstance = data.freeze({
    coatingInstanceId: preparation.coatingInstanceId,
    hostItemInstanceId: preparation.targetItemInstanceId,
    surfaceKey: originalCarrier.surfaceKey,
    inventoryMode:
      originalCarrier.kind === 'PROJECTILE'
        ? 'INDIVIDUAL_POISONED_PROJECTILE'
        : 'INDIVIDUAL_ITEM_COATING',
    consumptionState: 'ACTIVE',
    replacesCoatingId: preparation.replacesCoatingIdOrNull,
    effectFamily: 'POISON',
    poisonSourceKind: 'SYMBIOTIC',
    sourceInstanceId: preparation.sourceInstanceId,
    sourceAbilityId: definition.sourceAbilityId,
    modeOperationId: mode.modeOperationId,
    payload: {
      poisonProfileId: definition.poisonProfileId,
      deliveryKind: 'COATING',
      payloadKind: definition.payloadKind,
      sourceFormula: definition.sourceFormula,
      futureDeliveryRule:
        originalCarrier.kind === 'FOOD' ? 'FULL_PROFILE' : definition.reducedDelivery,
    },
    carrier: originalCarrier,
    originalSourceSnapshot: source.originalSourceSnapshot,
    currentSourceContext: {
      effectiveSourceSnapshot: source.effectiveSourceSnapshot,
      resolution: source.resolution,
    },
    appliedAt: { campaignTimestamp: preparation.calendarAnchor.campaignTimestamp },
    expiry: null,
    consumeCondition: originalCarrier.kind === 'FOOD' ? 'INGESTION' : 'FIRST_SUCCESSFUL_HIT',
    origin: phase,
    preparationOperationId: preparation.preparationOperationId,
    reason: preparation.reason,
    createdAt: preparation.createdAt,
  });
  const token = Object.freeze({}) as NpcPoisonCoatingContribution;
  contributions.set(token, { catalog, value: data.freeze({ preparation, context, coating }) });
  return token;
}
/** Original operation evidence is not a current carrier or a published dose. */
export function deriveNpcPoisonPreparationEvidence(
  catalog: NpcFormalPoisonCatalog,
  value: unknown,
  context: NpcPoisonPreparationEvidenceContext,
): NpcPoisonPreparationEvidence {
  data.record(context, ['mode', 'source', 'originalInventory', 'replaces']);
  const preparation = readNpcPoisonCoatingPreparation(value);
  const source = readNpcPoisonSourceContribution(catalogValue(catalog).source, context.source);
  if (
    source.origin.kind !== 'PREPARED' ||
    source.origin.preparationOperationId !== preparation.preparationOperationId ||
    source.targetCommitOperationIdOrNull !== null ||
    source.resolution.kind !== 'CURRENT' ||
    source.resolution.observationOperationId !== preparation.preparationOperationId ||
    !source.currentPreparationAllowed ||
    source.campaignTimestamp !== preparation.calendarAnchor.campaignTimestamp
  )
    return fail('archive requires the exact actual original PREPARATION observation');
  const previous =
    context.replaces === null
      ? null
      : preparationEvidence.has(context.replaces as NpcPoisonPreparationEvidence)
        ? readNpcPoisonPreparationEvidence(
            catalog,
            context.replaces as NpcPoisonPreparationEvidence,
          ).originalContribution
        : (context.replaces as NpcPoisonCoatingContribution);
  // Both physical arguments describe the same actual instant before preparation.
  // This validates that original surface; it never invents an omitted current item.
  const originalContribution = deriveNpcPreparedPoisonCoating(catalog, preparation, {
    campaignId: preparation.campaignId,
    npcUuid: preparation.npcUuid,
    campaignTimestamp: preparation.calendarAnchor.campaignTimestamp,
    origin: { kind: 'PREPARED', preparationOperationId: preparation.preparationOperationId },
    mode: context.mode,
    source: context.source,
    originalInventory: context.originalInventory,
    currentInventory: context.originalInventory,
    replaces: previous,
  });
  const token = Object.freeze({}) as NpcPoisonPreparationEvidence;
  preparationEvidence.set(token, { catalog, preparation, originalContribution });
  return token;
}
export function readNpcPoisonPreparationEvidence(
  catalog: NpcFormalPoisonCatalog,
  token: NpcPoisonPreparationEvidence,
): Readonly<{
  preparation: NpcPoisonCoatingPreparation;
  originalContribution: NpcPoisonCoatingContribution;
}> {
  const found = preparationEvidence.get(token);
  if (found?.catalog !== catalog) return fail('unissued or foreign preparation evidence');
  return Object.freeze({
    preparation: found.preparation,
    originalContribution: found.originalContribution,
  });
}
function preparationSelections(value: NpcInventoryCoatingContext) {
  if (!Object.hasOwn(value, 'preparationHistory')) return null;
  const selected = new Map<string, NpcPoisonPreparationEvidence | null>();
  const originals = new Map<string, NpcPoisonPreparationEvidence>();
  const operations = new Set<string>();
  const removals: NpcPoisonCoatingRemoval[] = [];
  for (const raw of data.array(value.preparationHistory)) {
    const entry = data.record(raw);
    if (entry.kind === 'PREPARE') {
      data.record(raw, ['kind', 'preparation']);
      const token = entry.preparation as NpcPoisonPreparationEvidence;
      const { preparation } = readNpcPoisonPreparationEvidence(value.catalog, token);
      const previous = selected.get(preparation.targetItemInstanceId);
      const priorId =
        previous === null || previous === undefined
          ? null
          : readNpcPoisonPreparationEvidence(value.catalog, previous).preparation.coatingInstanceId;
      if (
        preparation.campaignId !== value.campaignId ||
        preparation.npcUuid !== value.npcUuid ||
        operations.has(preparation.preparationOperationId) ||
        originals.has(preparation.coatingInstanceId) ||
        preparation.replacesCoatingIdOrNull !== priorId
      )
        return fail(
          'preparation history is foreign, repeated or changes the actual prior selection',
        );
      operations.add(preparation.preparationOperationId);
      originals.set(preparation.coatingInstanceId, token);
      selected.set(preparation.targetItemInstanceId, token);
    } else if (entry.kind === 'REMOVE') {
      data.record(raw, ['kind', 'removal']);
      const removal = readNpcPoisonCoatingRemoval(entry.removal);
      const previous = selected.get(removal.targetItemInstanceId);
      if (
        removal.campaignId !== value.campaignId ||
        removal.npcUuid !== value.npcUuid ||
        operations.has(removal.sourceOperationId) ||
        previous === null ||
        previous === undefined ||
        readNpcPoisonPreparationEvidence(value.catalog, previous).preparation.coatingInstanceId !==
          removal.coatingInstanceId
      )
        return fail('removal history does not name the actual selected preparation');
      operations.add(removal.sourceOperationId);
      removals.push(removal);
      selected.set(removal.targetItemInstanceId, null);
    } else return fail('unknown preparation history event');
  }
  data.equal(removals, value.removals);
  return {
    selected,
    originals,
    selections: data.freeze(
      [...selected].map(([targetItemInstanceId, token]) => {
        const preparation =
          token === null
            ? null
            : readNpcPoisonPreparationEvidence(value.catalog, token).preparation;
        return {
          targetItemInstanceId,
          preparationOrNull:
            preparation === null
              ? null
              : {
                  coatingInstanceId: preparation.coatingInstanceId,
                  preparationOperationId: preparation.preparationOperationId,
                },
        };
      }),
    ),
  };
}
/** A corrupt saved payload is an integrity failure, never an availability blocker. */
export function validateNpcPreparedPoisonCoating(
  catalog: NpcFormalPoisonCatalog,
  value: unknown,
  preparation: unknown,
  context: NpcPoisonCoatingDerivationContext,
): NpcPoisonCoatingContribution {
  const result = deriveNpcPreparedPoisonCoating(catalog, preparation, context);
  data.equal(readNpcPoisonCoatingContribution(catalog, result).coating, value);
  return result;
}
/** Whole-sheet composition/life must be the same target that issued every source contribution. */
export function assertNpcInventoryCoatingTarget(
  value: NpcInventoryCoatingContext,
  target: Readonly<{
    npcUuid: string;
    compositionProof: unknown;
    lifeStateOrNull: NpcFormalLifeState | null;
  }>,
): void {
  data.record(target, ['npcUuid', 'compositionProof', 'lifeStateOrNull']);
  const c = catalogValue(value.catalog);
  data.equal(data.uuid(value.npcUuid), data.uuid(target.npcUuid));
  for (const token of value.contributions) {
    const contribution = readNpcPoisonCoatingContribution(value.catalog, token);
    assertNpcPoisonSourceTarget(c.source, contribution.context.source, {
      compositionProof: target.compositionProof,
      lifeStateOrNull: target.lifeStateOrNull,
    });
  }
}
/** Checks selected IDs against independently issued facts; UUID arrays cannot authorize a dose. */
export function readNpcInventoryCoatingSelection(
  publication: NpcInventoryPublicationCatalog,
  value: NpcInventoryCoatingContext,
  requests: readonly NpcInventoryRequestEntry[],
  target: Readonly<{ npcUuid: string; commitOperationId: string }> | null = null,
): Readonly<{
  byItem: ReadonlyMap<string, readonly NpcFormalPoisonCoatingInstance[]>;
  origins: readonly NpcInventoryCoatingOriginReference[];
  removals: readonly NpcPoisonCoatingRemoval[];
  archivedPreparations: readonly NpcArchivedCoatingPreparationReference[];
  preparationSelections: readonly NpcPoisonPreparationSelection[] | null;
  pendingRestoreRequests: readonly NpcInventoryRequestEntry[];
}> {
  data.record(value, [
    'catalog',
    'campaignId',
    'npcUuid',
    'campaignTimestamp',
    'targetCommitOperationIdOrNull',
    'contributions',
    'removals',
    ...(Object.hasOwn(value, 'preparationHistory') ? ['preparationHistory'] : []),
  ]);
  const c = catalogValue(value.catalog);
  if (c.publication !== publication) return fail('foreign inventory source catalog');
  const campaignId = data.uuid(value.campaignId),
    npcUuid = data.uuid(value.npcUuid);
  const campaignTimestamp = minute(value.campaignTimestamp);
  if (value.targetCommitOperationIdOrNull !== null) data.uuid(value.targetCommitOperationIdOrNull);
  if (
    target !== null &&
    (npcUuid !== target.npcUuid || value.targetCommitOperationIdOrNull !== target.commitOperationId)
  )
    return fail('coating proof differs from the actual target NPC COMMIT');
  const entries = data
    .array(value.contributions)
    .map((token) =>
      readNpcPoisonCoatingContribution(value.catalog, token as NpcPoisonCoatingContribution),
    );
  const history = preparationSelections(value);
  const ids = new Set<string>(),
    byItem = new Map<string, readonly NpcFormalPoisonCoatingInstance[]>();
  const origins: NpcInventoryCoatingOriginReference[] = [];
  for (const entry of entries) {
    const coating = entry.coating;
    if (history !== null) {
      const evidence =
        history.originals.get(coating.coatingInstanceId) ??
        fail('selected dose has no original preparation history');
      const original = readNpcPoisonCoatingContribution(
        value.catalog,
        readNpcPoisonPreparationEvidence(value.catalog, evidence).originalContribution,
      ).coating;
      data.equal(
        { ...original, currentSourceContext: coating.currentSourceContext, origin: coating.origin },
        coating,
      );
    }
    const source = readNpcPoisonSourceContribution(c.source, entry.context.source);
    if (
      entry.preparation.campaignId !== campaignId ||
      entry.preparation.npcUuid !== npcUuid ||
      entry.context.campaignTimestamp !== campaignTimestamp ||
      ids.has(coating.coatingInstanceId) ||
      byItem.has(coating.hostItemInstanceId) ||
      source.targetCommitOperationIdOrNull !== value.targetCommitOperationIdOrNull
    )
      return fail('foreign, duplicate or stale selected coating fact');
    const item = requests.find((request) => request.itemInstanceId === coating.hostItemInstanceId);
    if (
      item === undefined ||
      item.quantity !== 1 ||
      item.coatingInstanceIds.length !== 1 ||
      item.coatingInstanceIds[0] !== coating.coatingInstanceId
    )
      return fail('coating contribution differs from the selected physical item');
    const physical = readNpcInventoryPhysicalBasis(c.publication, entry.context.currentInventory);
    data.equal(
      physical.requests.map((request) =>
        request.itemInstanceId === coating.hostItemInstanceId
          ? { ...request, coatingInstanceIds: item.coatingInstanceIds }
          : request,
      ),
      requests,
    );
    ids.add(coating.coatingInstanceId);
    byItem.set(coating.hostItemInstanceId, Object.freeze([coating]));
    if (target !== null) {
      if (coating.origin.kind !== 'COMMITTED')
        return fail('PREPARED contribution cannot claim an original COMMIT');
      if (
        coating.origin.originCommitOperationId === target.commitOperationId &&
        campaignTimestamp !== coating.appliedAt.campaignTimestamp
      )
        return fail('confirmed clock changed before the coating first COMMIT');
      origins.push({
        coatingInstanceId: coating.coatingInstanceId,
        originCommitOperationId: coating.origin.originCommitOperationId,
      });
    }
  }
  for (const request of requests) {
    if (history !== null) {
      const selected = history.selected.get(request.itemInstanceId);
      data.equal(
        selected === undefined || selected === null
          ? []
          : [
              readNpcPoisonPreparationEvidence(value.catalog, selected).preparation
                .coatingInstanceId,
            ],
        request.coatingInstanceIds,
      );
    }
    if (
      request.coatingInstanceIds.length > 1 ||
      request.coatingInstanceIds.some((id) => !ids.has(id))
    )
      return fail('selected coating identity has no exact owning contribution');
  }
  const removals = data.array(value.removals).map(readNpcPoisonCoatingRemoval);
  const removalIds = new Set<string>();
  for (const removal of removals) {
    if (
      removal.campaignId !== campaignId ||
      removal.npcUuid !== npcUuid ||
      ids.has(removal.coatingInstanceId) ||
      removalIds.has(removal.coatingInstanceId)
    )
      return fail('foreign or repeated removal cannot authorize selected coatings');
    removalIds.add(removal.coatingInstanceId);
  }
  const selectedItems = new Set(requests.map((request) => request.itemInstanceId));
  const archivedPreparations =
    history === null
      ? []
      : history.selections.flatMap((selection) =>
          selection.preparationOrNull === null || selectedItems.has(selection.targetItemInstanceId)
            ? []
            : [selection.preparationOrNull],
        );
  // An omitted, never-published carrier still has a real PREPARE and physical
  // reservation. Recover only that original carrier (or its whole source pair),
  // not unrelated rows in its inventory and not a fabricated published item.
  const pending = new Map<string, NpcInventoryRequestEntry>();
  for (const evidence of history?.originals.values() ?? []) {
    const original = readNpcPoisonCoatingContribution(
      value.catalog,
      readNpcPoisonPreparationEvidence(value.catalog, evidence).originalContribution,
    );
    const physical = readNpcInventoryPhysicalBasis(
      c.publication,
      original.context.originalInventory,
    );
    const carrier =
      physical.requests.find(
        (request) => request.itemInstanceId === original.preparation.targetItemInstanceId,
      ) ?? fail('original preparation has no physical carrier');
    for (const request of physical.requests) {
      if (
        request.itemInstanceId === carrier.itemInstanceId ||
        (carrier.linkedSetInstanceId !== null &&
          request.linkedSetInstanceId === carrier.linkedSetInstanceId)
      )
        pending.set(request.itemInstanceId, request);
    }
  }
  for (const [itemInstanceId, request] of pending) {
    const selected = history?.selected.get(itemInstanceId);
    pending.set(itemInstanceId, {
      ...request,
      coatingInstanceIds:
        selected === undefined || selected === null
          ? []
          : [
              readNpcPoisonPreparationEvidence(value.catalog, selected).preparation
                .coatingInstanceId,
            ],
    });
  }
  return {
    byItem,
    origins: data.freeze(origins),
    removals: data.freeze(removals),
    archivedPreparations: data.freeze(archivedPreparations),
    preparationSelections: history?.selections ?? null,
    pendingRestoreRequests: data.freeze([...pending.values()]),
  };
}
