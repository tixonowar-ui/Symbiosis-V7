import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { ExportSourceEnvelope } from '@shared/local-character-post-save.js';
import type { LocalMetadataValues } from '../persistence/local-character-post-save.js';
import type {
  CreationFinalizationCatalog,
  CreationInitialRuntime,
} from '../domain/rules/creation-finalization/types.js';
import {
  calculateTrogrSuppressionBonus,
  resolveAdvisorIwRolls,
} from '../domain/rules/symbiont-stage/advisor.js';
import {
  validateDurableCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import { loadCreationFinalizationCatalog } from './creation-finalization-catalog.js';
import { loadCreationSkillCatalog, type CreationSkillCatalog } from './creation-skill-catalog.js';
import { creationFinalizationHash } from './creation-finalization-contract.js';
import { deriveStartingPropertySummary } from './creation-property-summary.js';
import { array, record, string } from './json-source.js';
import {
  assertReplayCatalogDigestsUnchanged,
  captureReplayCatalogDigests,
  isApprovedBaselineLineagePair,
  verifyHistoricalBaselineLineage,
  type ReplayCatalogDigests,
} from './baseline-lineage.js';
import { BASELINE_LINEAGE_SEALS } from './baseline-lineage-seals.js';

export interface LocalCharacterExportBaseline {
  readonly baselineVersion: string;
  readonly registryVersion: string;
  readonly catalogVersion: string;
  readonly builtAgainstTuple: string;
  readonly catalog: CreationFinalizationCatalog;
  readonly skillCatalog: CreationSkillCatalog;
  readonly classLabels: ReadonlyMap<string, string>;
}

interface VerifiedBaselineContext {
  readonly current: LocalCharacterExportBaseline;
  readonly manifest: Uint8Array;
  readonly replayCatalogDigests: ReplayCatalogDigests;
  readonly contextSeal: string;
  readonly historicalViews: Map<string, LocalCharacterExportBaseline>;
}
// A wire DTO, spread clone or structural type assertion cannot acquire this authority.
const verifiedBaselineContexts = new WeakMap<
  LocalCharacterExportBaseline,
  VerifiedBaselineContext
>();

const fail = (detail: string): never => {
  throw new Error(`local character export: ${detail}`);
};
export const postSaveSha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

/** ADR63: code-unit key order, finite JSON only, no locale, timestamp or UUID allocation. */
export function canonicalPostSaveJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number')
    return Number.isFinite(value) ? JSON.stringify(value) : fail('non-finite JSON number');
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) return fail('sparse or extended JSON array');
    return `[${value.map(canonicalPostSaveJson).join(',')}]`;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    return fail('non-JSON value');
  if (Object.getOwnPropertySymbols(value).length !== 0) return fail('symbol JSON key');
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalPostSaveJson(object[key])}`)
    .join(',')}}`;
}

function contextSeal(baseline: LocalCharacterExportBaseline): string {
  return postSaveSha256(
    canonicalPostSaveJson({
      baselineVersion: baseline.baselineVersion,
      registryVersion: baseline.registryVersion,
      catalogVersion: baseline.catalogVersion,
      builtAgainstTuple: baseline.builtAgainstTuple,
      catalog: baseline.catalog,
      skillCatalog: baseline.skillCatalog,
      classLabels: [...baseline.classLabels],
    }),
  );
}

function verifiedContext(baseline: LocalCharacterExportBaseline): VerifiedBaselineContext {
  const proof = verifiedBaselineContexts.get(baseline);
  if (proof === undefined || proof.contextSeal !== contextSeal(baseline))
    return fail('baseline context is unverified or mutated');
  const currentProof = verifiedBaselineContexts.get(proof.current);
  if (currentProof === undefined || currentProof.contextSeal !== contextSeal(proof.current))
    return fail('current baseline context is unverified or mutated');
  return proof;
}

/** Unknown advertised IDs are incompatible; invalid trusted contexts still fail closed. */
export function isStoredLocalCharacterExportBaselineCompatible(
  baseline: LocalCharacterExportBaseline,
  storedBaselineVersion: string,
): boolean {
  const { current } = verifiedContext(baseline);
  if (storedBaselineVersion === current.baselineVersion) return true;
  if (!isApprovedBaselineLineagePair(storedBaselineVersion, current.baselineVersion)) return false;
  resolveStoredLocalCharacterExportBaseline(baseline, storedBaselineVersion);
  return true;
}

/** Stored data keeps its original full manifest ID; current freshness never uses this view. */
export function resolveStoredLocalCharacterExportBaseline(
  baseline: LocalCharacterExportBaseline,
  storedBaselineVersion: string,
): LocalCharacterExportBaseline {
  const proof = verifiedContext(baseline);
  const current = proof.current;
  if (storedBaselineVersion === current.baselineVersion) return current;
  const knownStored: readonly string[] = [
    BASELINE_LINEAGE_SEALS.historicalBaselineVersion,
    BASELINE_LINEAGE_SEALS.successorBaselineVersion,
    BASELINE_LINEAGE_SEALS.admissionBaselineVersion,
  ];
  if (!knownStored.includes(storedBaselineVersion)) return fail('unknown stored baseline');
  verifyHistoricalBaselineLineage(
    proof.manifest,
    proof.replayCatalogDigests,
    {
      registryVersion: current.registryVersion,
      catalogVersion: current.catalogVersion,
      builtAgainstTuple: current.builtAgainstTuple,
    },
    storedBaselineVersion,
  );
  const known = proof.historicalViews.get(storedBaselineVersion);
  if (known !== undefined) {
    verifiedContext(known);
    return known;
  }
  const historical = Object.freeze({ ...current, baselineVersion: storedBaselineVersion });
  verifiedBaselineContexts.set(historical, { ...proof, contextSeal: contextSeal(historical) });
  proof.historicalViews.set(storedBaselineVersion, historical);
  return historical;
}

/** The baseline identifies verified supplied bytes, not the application's build timestamp. */
export async function loadLocalCharacterExportBaseline(
  projectRoot: string,
): Promise<LocalCharacterExportBaseline> {
  const replayCatalogDigests = captureReplayCatalogDigests(projectRoot);
  const directory = join(projectRoot, 'artifacts');
  const manifest = await readFile(join(directory, 'CHECKSUMS.sha256'));
  const paths = new Set<string>();
  for (const line of manifest.toString('utf8').split(/\r?\n/u)) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
    const path = match?.[2];
    if (
      path === undefined ||
      path.includes('\\') ||
      path.includes(':') ||
      posix.isAbsolute(path) ||
      posix.normalize(path) !== path ||
      path === '..' ||
      path.startsWith('../') ||
      paths.has(path)
    )
      return fail('malformed or unsafe baseline manifest');
    paths.add(path);
    if (postSaveSha256(await readFile(join(directory, ...path.split('/')))) !== match![1])
      return fail(`baseline checksum differs for ${path}`);
  }
  const actual = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((path) => path !== 'CHECKSUMS.sha256');
  if (paths.size === 0 || actual.length !== paths.size || actual.some((path) => !paths.has(path)))
    return fail('baseline manifest does not cover the supplied files');
  const runtime = array(
    JSON.parse(
      await readFile(join(projectRoot, 'generated/spec/character/runtime-contracts.json'), 'utf8'),
    ) as unknown,
    'runtime contracts',
  ).map((row) => record(row, 'runtime contract'));
  const contract = (key: string): string => {
    const rows = runtime.filter((row) => row['ContractKey'] === key);
    if (rows.length !== 1 || rows[0]!['Status'] !== 'PASS')
      return fail(`unverified runtime contract ${key}`);
    return string(rows[0]!['NormativeValue'], key);
  };
  const catalog = await loadCreationFinalizationCatalog(projectRoot);
  const skillCatalog = await loadCreationSkillCatalog(projectRoot, catalog.symbionts.skillStage);
  const classes = array(
    JSON.parse(
      await readFile(join(projectRoot, 'generated/spec/character/classes.json'), 'utf8'),
    ) as unknown,
    'classes',
  );
  const classLabels = new Map(
    classes.map((value) => {
      const row = record(value, 'class');
      return [string(row['ClassCode'], 'ClassCode'), string(row['Название'], 'class label')];
    }),
  );
  if (
    classLabels.size !== catalog.symbionts.skillStage.classes.length ||
    catalog.symbionts.skillStage.classes.some((c) => !classLabels.has(c.classCode))
  )
    return fail('class labels differ from validated catalog');
  const baseline = Object.freeze({
    baselineVersion: `sha256:${postSaveSha256(manifest)}`,
    registryVersion: contract('registryVersion'),
    catalogVersion: contract('catalogVersion'),
    builtAgainstTuple: contract('builtAgainstTuple'),
    catalog,
    skillCatalog,
    classLabels,
  });
  assertReplayCatalogDigestsUnchanged(projectRoot, replayCatalogDigests);
  verifiedBaselineContexts.set(baseline, {
    current: baseline,
    manifest: Uint8Array.from(manifest),
    replayCatalogDigests,
    contextSeal: contextSeal(baseline),
    historicalViews: new Map(),
  });
  return baseline;
}

export function verifiedPostSaveCheckpoint(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: CreationFinalizationCatalog,
): DurableCreationWizardCheckpoint {
  return validateDurableCreationWizardCheckpoint(
    checkpoint.localCharacter,
    checkpoint.checkpoint,
    catalog.symbionts.skillStage,
    catalog.symbionts,
    checkpoint.skillPresentationStage ?? undefined,
    checkpoint.symbiontPresentationStage ?? undefined,
  );
}

interface PhysicalRoll {
  readonly kind: string;
  readonly rollRequestId: string;
  readonly rollReceiptId: string;
  readonly mechanical: { readonly dieSides: number; readonly rawFace: number };
}
/** Every physical receipt is selected from its typed owning stage, never an opaque JSON walk. */
export function localCreationRandomReceipts(
  checkpoint: DurableCreationWizardCheckpoint,
): readonly JsonObject[] {
  const diceInputMode = checkpoint.raceAndMethodStage?.diceInput?.value;
  if (diceInputMode !== 'AUTO' && diceInputMode !== 'MANUAL')
    return fail('missing dice input mode');
  const receipts: JsonObject[] = [];
  const add = (
    kind: string,
    rollRequestId: string,
    rollReceiptId: string,
    faces: readonly number[],
  ): void => {
    if (
      !rollRequestId ||
      !rollReceiptId ||
      faces.length === 0 ||
      faces.some((n) => !Number.isInteger(n) || n < 1 || n > 20) ||
      receipts.some(
        (r) => r['rollReceiptId'] === rollReceiptId || r['rollRequestId'] === rollRequestId,
      )
    )
      return fail('invalid or repeated physical receipt');
    receipts.push({
      kind,
      rollRequestId,
      rollReceiptId,
      diceInputMode,
      dieSides: 20,
      faces: [...faces],
    });
  };
  const physical = (roll: PhysicalRoll | undefined): void => {
    if (roll === undefined) return;
    if (roll.mechanical.dieSides !== 20) return fail('unrecognized physical die');
    add(roll.kind, roll.rollRequestId, roll.rollReceiptId, [roll.mechanical.rawFace]);
  };
  for (const attempt of checkpoint.statRollStage?.attempts ?? []) {
    const set = attempt.setRecord?.receipt.result;
    if (set !== undefined) add('STAT_SET', set.setRollRequestId, set.setRollReceiptId, set.faces);
    for (const confirmation of attempt.confirmationRecords) {
      const result = confirmation.receipt.result;
      add(
        'STAT_CRITICAL_CONFIRMATION',
        result.confirmationRollRequestId,
        result.confirmationReceiptId,
        [result.confirmationFace],
      );
    }
  }
  for (const r of checkpoint.randomSymbiontStage?.rollRecords ?? []) physical(r.physicalRoll);
  physical(checkpoint.advisorIntelligenceFloorStage?.rollRecordOrNull?.physicalRoll);
  for (const r of checkpoint.manualCompositionStage?.advisorIwRecordOrNull?.physicalRolls ?? [])
    physical(r);
  physical(checkpoint.manualCompositionStage?.suppressionRollRecordOrNull?.physicalRoll);
  physical(checkpoint.armorBundleStage?.qualityRollRecordOrNull?.physicalRoll);
  physical(checkpoint.startingWeaponStage?.qualityRollRecordOrNull?.physicalRoll);
  physical(checkpoint.startingMoneyStage?.rollRecordOrNull?.physicalRoll);
  for (const r of checkpoint.fiveStartingPositionsStage?.rollRecords ?? [])
    physical(r.physicalRoll);
  for (const record of checkpoint.finalizationStage?.records ?? [])
    for (const r of record.physicalRolls) physical(r);
  return receipts;
}

function runtimeSnapshot(runtime: CreationInitialRuntime): JsonObject {
  return {
    maxHp: runtime.maxHp,
    currentHp: runtime.currentHp,
    alive: runtime.alive,
    conscious: runtime.conscious,
    stunned: runtime.stunned,
    bound: runtime.bound,
    burning: runtime.burning,
    poisoned: runtime.poisoned,
    diseased: runtime.diseased,
    wounds: [...runtime.wounds],
    injuries: [...runtime.injuries],
    bleeding: [...runtime.bleeding],
    temporaryEffects: [...runtime.temporaryEffects],
    cooldowns: [...runtime.cooldowns],
    preparations: [...runtime.preparations],
    initiativeOrNull: runtime.initiativeOrNull,
    combatSceneIdOrNull: runtime.combatSceneIdOrNull,
    statProgressionCounters: { ...runtime.statProgressionCounters },
    combatUsageLimits: [...runtime.combatUsageLimits],
    symbiontXpProgressPoints: runtime.symbiontXpProgressPoints,
    unallocatedSymbiontXp: runtime.unallocatedSymbiontXp,
    equippedItems: [...runtime.equippedItems],
    generatedObjects: [...runtime.generatedObjects],
    externalEntities: [...runtime.externalEntities],
    chimeraDevouringHistory: [...runtime.chimeraDevouringHistory],
    chimeraExtraSlots: runtime.chimeraExtraSlots,
    taipanPoisonOrNull: runtime.taipanPoisonOrNull,
    penguinMiMiMiActive: runtime.penguinMiMiMiActive,
    ratInsideHost: runtime.ratInsideHost,
    keeperInsideHost: runtime.keeperInsideHost,
    mantisBladeStateOrNull: runtime.mantisBladeStateOrNull,
  };
}

export function deriveLocalFinalExport(
  source: DurableCreationWizardCheckpoint,
  metadata: LocalMetadataValues,
  metadataRevision: number,
  ownerEnvelope: ExportSourceEnvelope,
  baseline: LocalCharacterExportBaseline,
) {
  verifiedContext(baseline);
  const checkpoint = verifiedPostSaveCheckpoint(source, baseline.catalog);
  const snapshot = checkpoint.finalizationStage?.finalMechanicsSnapshotOrNull;
  const final = checkpoint.finalizationStage?.records.at(-1);
  if (
    checkpoint.localCharacter.lifecycleState !== 'FINAL' ||
    snapshot == null ||
    final?.request.payload.variant !== 'FINAL_SAVE' ||
    final.receipt.result.mechanicsSnapshotHashOrNull !== creationFinalizationHash(snapshot)
  )
    return fail('source is not a verified final snapshot');
  if (
    ownerEnvelope.ownerContext !== 'PLAYER_LOCAL' ||
    ownerEnvelope.sourceKind !== 'LOCAL_FINAL' ||
    !ownerEnvelope.activeLocalOwnerIdOrNull ||
    ownerEnvelope.masterAuthorityRevisionOrNull !== null ||
    !['APP-004', 'CHR-040'].includes(ownerEnvelope.originFormId) ||
    ownerEnvelope.returnFormId !== ownerEnvelope.originFormId
  )
    return fail('mixed or unsupported export owner envelope');
  if (
    !Number.isSafeInteger(metadataRevision) ||
    metadataRevision < 0 ||
    typeof metadata.name !== 'string' ||
    metadata.name.trim().length === 0
  )
    return fail('invalid metadata revision or name');
  const skill = (value: {
    readonly skillKey: string;
    readonly bonus: number;
    readonly slotCost: number;
    readonly source?: string;
  }): JsonObject => {
    const label = baseline.skillCatalog.skillLabels.find(
      (s) => s.skillId === value.skillKey,
    )?.skillLabel;
    if (label === undefined) return fail('unknown learned skill');
    return {
      skillId: value.skillKey,
      label,
      bonus: value.bonus,
      slotCost: value.slotCost,
      source: value.source ?? 'SELECTED',
    };
  };
  const branch = snapshot.branch;
  const race = baseline.catalog.symbionts.races.find((r) => r.raceCode === branch.raceCode);
  if (race === undefined) return fail('unknown final race');
  const advisor = branch.advisorOrNull;
  let advisorOrNull: JsonObject | null = null;
  if (advisor !== null) {
    const i = advisor.physicalRolls.find((r) => r.kind === 'ADVISOR_I');
    const w = advisor.physicalRolls.find((r) => r.kind === 'ADVISOR_W');
    if (i === undefined || w === undefined || !advisor.skillsConfirmed)
      return fail('incomplete final Advisor');
    const iw = resolveAdvisorIwRolls([i.mechanical, w.mechanical]);
    const b = advisor.physicalRolls.find((r) => r.kind === 'TROGR_SUPPRESSION_B');
    advisorOrNull = {
      intelligence: iw.I.value,
      wisdom: iw.W.value,
      suppressionBonusOrNull: b === undefined ? null : calculateTrogrSuppressionBonus(b.mechanical),
      skills: advisor.learnedSkills.map(skill),
    };
  }
  const mechanics = snapshot.mechanics;
  const mechanicsSnapshot: JsonObject = {
    identity: {
      age: snapshot.identity.age,
      sex: snapshot.identity.sex,
      massKg: snapshot.identity.massKg,
    },
    race: { code: race.raceCode, label: race.raceLabel },
    classOrNull:
      branch.classCode === null
        ? null
        : {
            code: branch.classCode,
            label: baseline.classLabels.get(branch.classCode) ?? fail('unknown final class'),
          },
    creationMode: branch.creationMode,
    skillStageStats: { ...mechanics.skillStageStats },
    effectiveStats: { ...mechanics.effectiveStats },
    statProof: mechanics.statProof.map((p) => ({
      statCode: p.statCode,
      skillStageValue: p.skillStageValue,
      positiveSymbiontDelta: p.positiveSymbiontDelta,
      negativeSymbiontDelta: p.negativeSymbiontDelta,
      appliedNegativeDelta: p.appliedNegativeDelta,
      beforeLimits: p.beforeLimits,
      minimumOrNull: p.minimumOrNull,
      maximumOrNull: p.maximumOrNull,
      effectiveValue: p.effectiveValue,
    })),
    skills: mechanics.learnedSkills.map(skill),
    symbionts: mechanics.symbionts.map((s) => {
      const species = baseline.catalog.symbionts.species.find(
        (entry) => entry.speciesKey === s.speciesKey,
      );
      const binding = branch.bindings.find(
        (b) => b.acceptedIndex === s.acceptedIndex && b.speciesKey === s.speciesKey,
      )?.binding;
      if (species === undefined || binding === undefined)
        return fail('unknown final species or binding');
      return {
        acceptedIndex: s.acceptedIndex,
        speciesKey: s.speciesKey,
        label: species.speciesLabel,
        status: s.status,
        level: s.level,
        maxOe: s.maxOe,
        currentOe: s.currentOe,
        xp: s.xp,
        effectsEnabled: s.effectsEnabled,
        xpEligible: s.xpEligible,
        learnedNodes: s.learnedNodeRefs.map((ref) => {
          const node = baseline.catalog.initialNodes.find(
            (n) => n.nodeRef === ref && n.speciesKey === s.speciesKey,
          );
          if (node === undefined) return fail('unknown learned development node');
          return { label: node.label, level: node.level };
        }),
        binding: { kind: binding.kind, ...('side' in binding ? { side: binding.side } : {}) },
      };
    }),
    advisorOrNull,
    manufacturingReceipts: (
      checkpoint.weaponProfileStage?.records.at(-1)?.receipt.result
        .independentManufacturingDiceReceipts ?? []
    ).map((r) => ({
      receiptId: r.receiptId,
      requestId: r.requestId,
      submitCommandId: r.submitCommandId,
      variable: r.variable,
      dieSides: r.dieSides,
      value: r.value,
      provenance: r.provenance,
    })),
    permanentGrants: mechanics.permanentGrants.map((g) => ({
      kind: g.kind,
      bonusBefore: g.bonusBefore,
      bonusAfter: g.bonusAfter,
    })),
    trainingSlotLedger: {
      maxPermanentWisdom: mechanics.trainingSlotLedger.maxPermanentWisdom,
      everIssued: mechanics.trainingSlotLedger.everIssued,
    },
    property: deriveStartingPropertySummary(checkpoint),
    runtime: runtimeSnapshot(mechanics.initialRuntime),
  };
  const sourceUuid = checkpoint.localCharacter.localCharacterId;
  const sourceSnapshotId = final.receipt.receiptId;
  const finalSaveReceiptId = sourceSnapshotId;
  const finalSnapshotVersion = final.receipt.result.draftRevision;
  const provenance: JsonObject = {
    registryVersion: baseline.registryVersion,
    catalogVersion: baseline.catalogVersion,
    builtAgainstTuple: baseline.builtAgainstTuple,
    sourceUuid,
    sourceSnapshotId,
    metadataRevision,
    sourceChecksum: final.receipt.result.mechanicsSnapshotHashOrNull,
    finalSaveReceiptId,
    finalSnapshotVersion,
  };
  const creationRandomReceipts = localCreationRandomReceipts(checkpoint);
  const dto: JsonObject = {
    format: 'SYMBIOSIS_CHARACTER_EXPORT',
    schemaVersion: 1,
    baselineVersion: baseline.baselineVersion,
    sourceUuid,
    sourceSnapshotId,
    sourceKind: ownerEnvelope.sourceKind,
    ownerContext: ownerEnvelope.ownerContext,
    metadataRevision,
    metadata: {
      name: metadata.name,
      description: metadata.description,
      artAssetKeyOrLocalFile: metadata.artAssetKeyOrLocalFile,
    },
    mechanicsSnapshot,
    creationRandomReceipts,
    provenance,
  };
  const checksum = postSaveSha256(canonicalPostSaveJson(dto));
  const contentText = `${canonicalPostSaveJson({ ...dto, checksum })}\n`;
  return {
    mechanicsSnapshot,
    creationRandomReceipts,
    checksum,
    provenance,
    sourceSnapshotId,
    finalSnapshotVersion,
    finalSaveReceiptId,
    contentText,
    bytesSha256: postSaveSha256(contentText),
    baselineVersion: baseline.baselineVersion,
  };
}
