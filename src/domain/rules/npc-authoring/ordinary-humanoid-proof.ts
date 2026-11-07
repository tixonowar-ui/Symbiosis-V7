import type { NpcValidatedSchema } from './base-stats.js';
import type { StatBlock } from '../skill-stage/stats.js';
import type { NpcCompositionConsequenceProof } from './composition-consequence-types.js';
import type { NpcSkillProof } from './skill-evaluation.js';
import {
  npcPublicationData as data,
  deriveNpcInventoryStatContributions,
  type NpcInventoryPublicationCatalog,
} from './inventory-publication.js';
import { readNpcInventoryRequest, type NpcInventoryRequestEntry } from './inventory.js';
import {
  deriveNpcOrdinaryDraftStatContext,
  assertNpcOrdinaryStatContextValid,
  type NpcOrdinaryStatCatalog,
  type NpcOrdinaryStatContext,
} from './ordinary-stat-profile.js';

export interface NpcOrdinaryStatFact {
  readonly contextFactId: string;
  readonly schema: NpcValidatedSchema;
  readonly baseStats: StatBlock;
  readonly compositionOrdinal: number;
  readonly resolutionOrdinal: number;
  readonly equippedInventory?: readonly NpcInventoryRequestEntry[];
  /** Current equipment at the real NPC015 confirmation; never a skill acquisition fact. */
  readonly inventoryConfirmationOperationId?: string;
}
export interface NpcOrdinaryHumanoidProof {
  readonly currentStatContextFactId: string;
  readonly statContexts: readonly NpcOrdinaryStatFact[];
}
export interface NpcOrdinaryProofInput {
  readonly npcUuid: string;
  readonly compositionProof: NpcCompositionConsequenceProof;
  readonly ordinaryProof: NpcOrdinaryHumanoidProof;
}
export interface NpcOrdinaryProofResult {
  readonly npcUuid: string;
  readonly compositionProof: NpcCompositionConsequenceProof;
  readonly ordinaryProof: NpcOrdinaryHumanoidProof;
  readonly current: NpcOrdinaryStatContext;
  readonly contexts: readonly Readonly<{
    fact: NpcOrdinaryStatFact;
    profile: NpcOrdinaryStatContext;
  }>[];
}
function fail(detail: string): never {
  throw new Error(`NPC ordinary proof: ${detail}`);
}
function ordinal(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    return fail('unknown/future prefix length');
  return value;
}

/** Carried items without an active source bonus do not create a new stat history fact. */
export function npcOrdinaryInventoryIsStatNeutral(
  catalog: NpcInventoryPublicationCatalog,
  value: unknown,
): boolean {
  const requests = readNpcInventoryRequest(value);
  const contribution = deriveNpcInventoryStatContributions(catalog, requests);
  // Keep exact equipment identities even when their present numeric contribution is zero.
  // In particular, sealed Nate can change the Skunk predicate without an additive bonus.
  return (
    !requests.some((item) => item.equipped) &&
    !contribution.itemContribution.items.some((item) => item.active)
  );
}

/** Closed storage grammar only. Owning replay still derives the source profile and prefix. */
export function readNpcOrdinaryStatFact(value: unknown): NpcOrdinaryStatFact {
  const hasEquipment = Object.hasOwn(data.record(value), 'equippedInventory');
  const inventoryOnly = Object.hasOwn(data.record(value), 'inventoryConfirmationOperationId');
  const row = data.record(value, [
    'contextFactId',
    'schema',
    'baseStats',
    'compositionOrdinal',
    'resolutionOrdinal',
    ...(hasEquipment ? ['equippedInventory'] : []),
    ...(inventoryOnly ? ['inventoryConfirmationOperationId'] : []),
  ]);
  const schema = data.record(row.schema, [
    'raceCode',
    'pureClassOrNull',
    'anatomyProfileId',
    'sex',
    'massKg',
  ]);
  if (schema.raceCode !== 'PURE' && schema.raceCode !== 'UNITED' && schema.raceCode !== 'FREE')
    return fail('unknown schema race');
  if (
    schema.pureClassOrNull !== null &&
    schema.pureClassOrNull !== 'SEEKER' &&
    schema.pureClassOrNull !== 'STALKER' &&
    schema.pureClassOrNull !== 'SOLDIER'
  )
    return fail('unknown schema class');
  if (
    schema.anatomyProfileId !== 'STANDARD_HUMANOID' ||
    (schema.sex !== 'MALE' && schema.sex !== 'FEMALE') ||
    typeof schema.massKg !== 'number' ||
    !Number.isFinite(schema.massKg)
  )
    return fail('invalid schema structure');
  const values = data.record(row.baseStats, ['S', 'D', 'M', 'Z', 'I', 'W', 'C']);
  const baseStats = Object.fromEntries(
    Object.entries(values).map(([key, raw]) => {
      if (typeof raw !== 'number' || !Number.isSafeInteger(raw))
        return fail('invalid stat structure');
      return [key, raw];
    }),
  ) as unknown as StatBlock;
  const inventoryConfirmationOperationId = inventoryOnly
    ? data.uuid(row.inventoryConfirmationOperationId)
    : null;
  if (inventoryConfirmationOperationId !== null) {
    if (!hasEquipment) return fail('current inventory confirmation needs its exact loadout');
    data.equal('NPC_CURRENT_INVENTORY/' + inventoryConfirmationOperationId, row.contextFactId);
  }
  return data.freeze({
    contextFactId: data.text(row.contextFactId),
    schema: {
      raceCode: schema.raceCode,
      pureClassOrNull: schema.pureClassOrNull,
      anatomyProfileId: schema.anatomyProfileId,
      sex: schema.sex,
      massKg: schema.massKg,
    },
    baseStats,
    compositionOrdinal: ordinal(row.compositionOrdinal, Number.MAX_SAFE_INTEGER),
    resolutionOrdinal: ordinal(row.resolutionOrdinal, Number.MAX_SAFE_INTEGER),
    ...(hasEquipment ? { equippedInventory: readNpcInventoryRequest(row.equippedInventory) } : {}),
    ...(inventoryConfirmationOperationId === null ? {} : { inventoryConfirmationOperationId }),
  });
}

function read(
  catalog: NpcOrdinaryStatCatalog,
  value: unknown,
  draft: boolean,
): NpcOrdinaryProofResult {
  const input = data.record(value, ['npcUuid', 'compositionProof', 'ordinaryProof']);
  const npcUuid = data.uuid(input.npcUuid);
  const rawComposition = data.record(input.compositionProof, [
    'identityKey',
    'binding',
    'confirmations',
    'resolutions',
  ]);
  data.equal(npcUuid, rawComposition.identityKey);
  const confirmations = data.array(rawComposition.confirmations);
  const resolutions = data.array(rawComposition.resolutions);
  const proof = data.record(input.ordinaryProof, ['currentStatContextFactId', 'statContexts']);
  const currentStatContextFactId = data.text(proof.currentStatContextFactId);
  const seen = new Set<string>();
  let lastComposition = 0,
    lastResolution = 0;
  let preceding: NpcOrdinaryStatFact | null = null;
  const contexts = data.array(proof.statContexts).map((value) => {
    const row = readNpcOrdinaryStatFact(value);
    const contextFactId = data.text(row.contextFactId);
    if (seen.has(contextFactId)) return fail('duplicate stat context');
    seen.add(contextFactId);
    const compositionOrdinal = ordinal(row.compositionOrdinal, confirmations.length);
    const resolutionOrdinal = ordinal(row.resolutionOrdinal, resolutions.length);
    if (row.inventoryConfirmationOperationId !== undefined) {
      if (preceding === null)
        return fail('current inventory confirmation needs an actual preceding stat context');
      for (const key of ['schema', 'baseStats', 'compositionOrdinal', 'resolutionOrdinal'] as const)
        data.equal(preceding[key], row[key]);
    }
    preceding = row;
    if (compositionOrdinal < lastComposition || resolutionOrdinal < lastResolution)
      return fail('stat contexts reordered across confirmed prefixes');
    lastComposition = compositionOrdinal;
    lastResolution = resolutionOrdinal;
    const profile = deriveNpcOrdinaryDraftStatContext(catalog, {
      schema: row.schema,
      baseStats: row.baseStats,
      ...(row.equippedInventory === undefined ? {} : { equippedInventory: row.equippedInventory }),
      compositionProof: {
        identityKey: npcUuid,
        binding: rawComposition.binding,
        confirmations: confirmations.slice(0, compositionOrdinal),
        resolutions: resolutions.slice(0, resolutionOrdinal),
      },
    });
    const fact: NpcOrdinaryStatFact = {
      contextFactId,
      schema: profile.schema,
      baseStats: profile.stats.baseStats,
      compositionOrdinal,
      resolutionOrdinal,
      ...(row.equippedInventory === undefined ? {} : { equippedInventory: row.equippedInventory }),
      ...(row.inventoryConfirmationOperationId === undefined
        ? {}
        : { inventoryConfirmationOperationId: row.inventoryConfirmationOperationId }),
    };
    return { fact, profile };
  });
  const current = contexts.at(-1);
  if (
    current === undefined ||
    current.fact.contextFactId !== currentStatContextFactId ||
    current.fact.compositionOrdinal !== confirmations.length ||
    current.fact.resolutionOrdinal !== resolutions.length
  )
    return fail('current context must bind the complete actual prefix');
  if (!draft) assertNpcOrdinaryStatContextValid(current.profile);
  const compositionProof = current.profile.composition.proof;
  for (const resolution of compositionProof.resolutions) {
    if (resolution.kind === 'TROGR_PERMANENT_STAT_CLOSURE') {
      const before = resolution.beforeRemovalOrNull;
      if (before !== null) {
        const context = contexts
          .filter((entry) => entry.fact.compositionOrdinal < resolution.compositionOrdinal)
          .at(-1);
        const previousResolutionCount = compositionProof.resolutions.filter(
          (r) => r.compositionOrdinal < resolution.compositionOrdinal,
        ).length;
        if (
          context === undefined ||
          context.fact.contextFactId !== before.statContextFactId ||
          context.fact.compositionOrdinal !== resolution.compositionOrdinal - 1 ||
          context.fact.resolutionOrdinal !== previousResolutionCount
        )
          return fail('Trogr removal requires its exact last pre-removal stat context');
        assertNpcOrdinaryStatContextValid(context.profile);
        data.equal(context.profile.nonTrogrBasis, before.nonTrogrBasis);
        data.equal(context.profile.stats.permanentStats, before.permanentStats);
      }
      continue;
    }
    if (resolution.kind !== 'FREE_SLOT_ROLL' && resolution.kind !== 'ADVISER_SKILLS') continue;
    const id =
      resolution.kind === 'FREE_SLOT_ROLL'
        ? resolution.statContextFactId
        : resolution.bodyContextFactId;
    const context = contexts.find((entry) => entry.fact.contextFactId === id);
    if (
      context === undefined ||
      context.fact.compositionOrdinal !== resolution.compositionOrdinal ||
      context.fact.resolutionOrdinal !== resolution.ordinal - 1
    )
      return fail('resolution requires its exact before-resolution stat prefix');
    const expected = context.profile.stats.permanentStats;
    if (resolution.kind === 'FREE_SLOT_ROLL') data.equal(expected, resolution.permanentStatsBefore);
    else
      data.equal(
        { S: expected.S, D: expected.D, M: expected.M, Z: expected.Z, C: expected.C },
        resolution.bodyStats,
      );
  }
  return data.freeze({
    npcUuid,
    compositionProof,
    ordinaryProof: { currentStatContextFactId, statContexts: contexts.map((entry) => entry.fact) },
    current: current.profile,
    contexts,
  });
}

/** Context references are authenticated by the host; their arithmetic is replayed here. */
export function evaluateNpcOrdinaryHumanoidProof(
  catalog: NpcOrdinaryStatCatalog,
  value: unknown,
  previousConfirmedProofOrNull: unknown = null,
): NpcOrdinaryProofResult {
  const result = read(catalog, value, false);
  if (previousConfirmedProofOrNull !== null) {
    const previous = read(catalog, previousConfirmedProofOrNull, false);
    data.equal(previous.npcUuid, result.npcUuid);
    data.equal(previous.compositionProof.binding, result.compositionProof.binding);
    for (const field of ['confirmations', 'resolutions'] as const) {
      const old = previous.compositionProof[field],
        next = result.compositionProof[field];
      if (next.length < old.length) return fail('confirmed composition prefix truncated');
      old.forEach((entry, i) => data.equal(entry, next[i]));
    }
    const old = previous.ordinaryProof.statContexts,
      next = result.ordinaryProof.statContexts;
    if (next.length < old.length) return fail('confirmed stat prefix truncated');
    old.forEach((entry, i) => data.equal(entry, next[i]));
  }
  return result;
}

/** Draft composition may precede valid equipment; it cannot pass the saved-sheet entry point. */
export function evaluateNpcOrdinaryAuthoringProof(
  catalog: NpcOrdinaryStatCatalog,
  value: unknown,
): NpcOrdinaryProofResult {
  return read(catalog, value, true);
}

/** An evaluated skill proof still needs an independently recomputed stat/source binding. */
export function assertNpcOrdinarySkillContexts(
  proof: NpcOrdinaryProofResult,
  skills: NpcSkillProof,
): void {
  data.equal(proof.npcUuid, skills.identityKey);
  let lastIndex = -1;
  for (const context of skills.contexts) {
    const index = proof.contexts.findIndex(
      (entry) => entry.fact.contextFactId === context.contextFactId,
    );
    if (index < 0 || index <= lastIndex) return fail('skill context has no ordered stat fact');
    lastIndex = index;
    const source = proof.contexts[index];
    if (source === undefined) return fail('missing skill stat source');
    if (source.fact.inventoryConfirmationOperationId !== undefined)
      return fail('current inventory confirmation is not a skill acquisition or confirmation');
    assertNpcOrdinaryStatContextValid(source.profile);
    data.equal(source.fact.schema.raceCode, context.raceCode);
    data.equal(source.fact.schema.pureClassOrNull, context.classCode);
    data.equal(source.profile.stats.skillStageStats, context.skillStageStats);
    data.equal(source.profile.stats.permanentStats, context.permanentStats);
    // Only this fact's actual source-checked equipment contributes here. Other
    // temporary states still need their own provenance; supplied numbers are not proof.
    data.equal(source.profile.stats.effectiveStats, context.effectiveStats);
    const dolphin = source.profile.composition.composition.instances.find(
      (i) =>
        i.speciesKey === 'DOLPHIN' &&
        i.status === 'ACTIVE' &&
        i.effectsEnabled &&
        i.learnedNodeRefs.includes('SYM-166'),
    );
    if (dolphin !== undefined || Object.hasOwn(context, 'sym166SourceOrNull'))
      data.equal(
        dolphin === undefined
          ? null
          : { symbiontInstanceId: dolphin.symbiontInstanceId, nodeRef: 'SYM-166' },
        context.sym166SourceOrNull,
      );
    const gross = context.grossGrantSourceOrNull;
    if (gross !== null) {
      const found = source.profile.composition.composition.instances.find(
        (i) => i.symbiontInstanceId === gross.symbiontInstanceId,
      );
      const acquisition = source.profile.composition.composition.pendingRequirements.some(
        (r) =>
          r.kind === 'GROSS_SKILL_GRANT' &&
          r.symbiontInstanceId === gross.symbiontInstanceId &&
          r.causedByFactId === gross.sourceAcquisitionFactId,
      );
      const newlyDestroyed =
        found?.status === 'DESTROYED' &&
        found.acquisitionFactId === gross.sourceAcquisitionFactId &&
        source.profile.composition.compositionReceipts.some(
          (receipt) =>
            receipt.factId === gross.sourceAcquisitionFactId &&
            receipt.input.additions.some(
              (instance) => instance.symbiontInstanceId === gross.symbiontInstanceId,
            ) &&
            receipt.view.instances.some(
              (instance) =>
                instance.symbiontInstanceId === gross.symbiontInstanceId &&
                instance.status === 'DESTROYED',
            ),
        );
      if (
        found === undefined ||
        (!found.effectsEnabled && !newlyDestroyed) ||
        !found.learnedNodeRefs.includes('SYM-079') ||
        !acquisition
      )
        return fail('GROSS source differs from the actual composition prefix');
    }
  }
  const initialGrants = proof.compositionProof.resolutions.flatMap((r) =>
    r.kind === 'GROSS_SKILL_GRANT' && 'initialGrant' in r ? [r.initialGrant] : [],
  );
  const actualGrants = skills.contexts
    .filter((c) => c.stage === 'COMPOSITION_BEFORE_START')
    .flatMap((c) => c.facts.filter((f) => f.kind === 'TROGR_GROSS_GRANT'));
  data.equal(initialGrants, actualGrants);
}

/** Only the explicitly bound NPC015 inventory-only tail may follow the last actual NPC014 context. */
export function assertNpcOrdinaryCurrentSkillContext(
  proof: NpcOrdinaryProofResult,
  skills: NpcSkillProof,
): void {
  const currentConfirmation = proof.contexts.findLast(
    ({ fact }) => fact.inventoryConfirmationOperationId === undefined,
  );
  if (
    currentConfirmation === undefined ||
    skills.contexts.at(-1)?.contextFactId !== currentConfirmation.fact.contextFactId
  )
    return fail('current skill requirements need the current stat confirmation');
}
