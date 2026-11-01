import { isDeepStrictEqual } from 'node:util';
import type {
  AdmissionMechanicalCore,
  AdmissionReviewDraft,
  AdmissionSheetSkill,
  AdmissionStats,
  AdmissionPublicWeaponProfile,
} from '@shared/campaign-admission.js';
import { ADMISSION_WEAPON_PROPERTY_KEYS } from '@shared/campaign-admission.js';
import { admissionPublicWeaponProfileValue } from '@shared/campaign-admission-sheet.js';
import {
  admissionInventoryReviewValue,
  admissionStatsValue,
  admissionStartingSkillsValue,
  admissionMassReviewValue,
} from '@shared/campaign-admission-codec.js';
import type {
  StagedWeaponCombatDefinition,
  StagedWeaponProfile,
} from '../domain/rules/item-stage/master-weapon-profile.js';
import {
  deriveAdmissionMechanics,
  deriveCreationFinalMechanics,
} from '../domain/rules/creation-finalization/mechanics.js';
import type {
  CreationFinalMechanics,
  CreationFinalMechanicsInput,
} from '../domain/rules/creation-finalization/types.js';
import { calculateStartSkillSlots } from '../domain/rules/skill-stage/skills.js';
import {
  calculateTrogrSuppressionBonus,
  resolveAdvisorIwRolls,
} from '../domain/rules/symbiont-stage/advisor.js';
import type { ValidatedFinalAdmissionReviewSource } from './device-admission-candidate.js';
import type { LocalCharacterExportBaseline } from './local-character-export.js';

const zero = (): AdmissionStats => Object.freeze({ S: 0, D: 0, M: 0, Z: 0, I: 0, W: 0, C: 0 });
function fail(detail: string): never {
  throw new Error(`admission mechanics: ${detail}`);
}
/** Called only after the full candidate witness replay; never from browser-provided JSON. */
export function admissionSourceMechanicsInput(
  source: ValidatedFinalAdmissionReviewSource,
): CreationFinalMechanicsInput {
  const checkpoint = source.checkpoint;
  const final = checkpoint.finalizationStage;
  const snapshot = final?.finalMechanicsSnapshotOrNull;
  const baseStats = checkpoint.statAssignmentStage?.derived.baseStats;
  if (
    checkpoint.localCharacter.lifecycleState !== 'FINAL' ||
    final == null ||
    snapshot == null ||
    baseStats === undefined
  )
    fail('verified FINAL mechanics are missing');
  const branch = snapshot.branch;
  const suppressed =
    branch.composition?.instances.some(
      (entry) => entry.speciesKey === 'ADVISER' && entry.status === 'SUPPRESSED',
    ) ?? false;
  const roll = branch.advisorOrNull?.physicalRolls.find(
    (entry) => entry.kind === 'TROGR_SUPPRESSION_B',
  );
  const bonus = suppressed
    ? roll === undefined
      ? branch.retainedAdvisorOrNull?.suppressionOrNull?.suppressionBOrNull
      : calculateTrogrSuppressionBonus(roll.mechanical)
    : null;
  if (bonus === undefined) fail('suppressed Adviser source bonus is missing');
  return Object.freeze({
    baseStats,
    raceCode: branch.raceCode,
    classCode: branch.classCode,
    creationMode: branch.creationMode,
    composition: branch.composition,
    learnedSkills: final.state.learnedSkills,
    advisorSuppressionBonusOrNull: bonus,
    permanentGrants: snapshot.mechanics.permanentGrants,
    trainingSlotLedger: snapshot.mechanics.trainingSlotLedger,
  });
}

/** Q-CHAR-019 counts physical instances, including every instance of a stack. */
export function admissionBackpackAdjustments(
  inventory: AdmissionReviewDraft['inventoryReview'],
): AdmissionStats {
  admissionInventoryReviewValue(inventory, '$.inventoryReview');
  const result = { ...zero() };
  for (const entry of inventory.entries) {
    if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 1)
      fail('invalid inventory quantity');
    if (entry.item.kind !== 'CUSTOM_ITEM' || entry.item.statBonusOrNull === null) continue;
    const { statCode, positiveIntegerBonus } = entry.item.statBonusOrNull;
    if (
      !Object.hasOwn(result, statCode) ||
      !Number.isSafeInteger(positiveIntegerBonus) ||
      positiveIntegerBonus < 1
    )
      fail('invalid custom item stat bonus');
    const amount = entry.quantity * positiveIntegerBonus;
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(result[statCode] + amount))
      fail('backpack stat bonus exceeds safe integer representation');
    result[statCode] += amount;
  }
  return Object.freeze(result);
}

function core(
  source: ValidatedFinalAdmissionReviewSource,
  baseline: LocalCharacterExportBaseline,
  input: CreationFinalMechanicsInput,
  mechanics: CreationFinalMechanics,
  permanentGmAdjustments: AdmissionStats,
  backpackItemAdjustments: AdmissionStats,
  massKg: number,
  maxSlots: number,
): AdmissionMechanicalCore {
  const snapshot = source.checkpoint.finalizationStage!.finalMechanicsSnapshotOrNull!;
  const metadata = source.candidate.exportDocument['metadata'];
  if (
    metadata === null ||
    Array.isArray(metadata) ||
    typeof metadata !== 'object' ||
    !('name' in metadata) ||
    typeof metadata.name !== 'string' ||
    metadata.name.trim().length === 0
  )
    fail('source metadata name is missing');
  const race = baseline.catalog.symbionts.races.find((entry) => entry.raceCode === input.raceCode);
  if (race === undefined) fail('unknown source race');
  const skill = (entry: {
    readonly skillKey: string;
    readonly bonus: number;
    readonly slotCost: number;
    readonly source?: AdmissionSheetSkill['source'];
  }): AdmissionSheetSkill => {
    const label = baseline.skillCatalog.skillLabels.find(
      (candidate) => candidate.skillId === entry.skillKey,
    )?.skillLabel;
    if (label === undefined) fail('unknown source skill label');
    return Object.freeze({
      skillKey: entry.skillKey,
      label,
      source: entry.source ?? 'SELECTED',
      bonus: entry.bonus,
      slotCost: entry.slotCost,
    });
  };
  const advisor = snapshot.branch.advisorOrNull;
  let advisorOrNull: AdmissionMechanicalCore['advisorOrNull'] = null;
  if (advisor !== null) {
    const i = advisor.physicalRolls.find((roll) => roll.kind === 'ADVISOR_I'),
      w = advisor.physicalRolls.find((roll) => roll.kind === 'ADVISOR_W');
    if (i === undefined || w === undefined || !advisor.skillsConfirmed)
      fail('incomplete source Adviser');
    const iw = resolveAdvisorIwRolls([i.mechanical, w.mechanical]);
    advisorOrNull = Object.freeze({
      intelligence: iw.I.value,
      wisdom: iw.W.value,
      suppressionBonusOrNull: input.advisorSuppressionBonusOrNull,
      skills: Object.freeze(advisor.learnedSkills.map(skill)),
    });
  }
  const usedSlots = mechanics.learnedSkills.reduce((sum, entry) => sum + entry.slotCost, 0);
  const runtime = mechanics.initialRuntime;
  return Object.freeze({
    schemaVersion: 1,
    identity: Object.freeze({
      name: metadata.name,
      age: snapshot.identity.age,
      sex: snapshot.identity.sex,
      massKg,
    }),
    race: Object.freeze({ code: race.raceCode, label: race.raceLabel }),
    classOrNull:
      input.classCode === null
        ? null
        : Object.freeze({
            code: input.classCode,
            label: baseline.classLabels.get(input.classCode) ?? fail('unknown source class'),
          }),
    creationMode: input.creationMode,
    stats: Object.freeze({
      acceptedBase: input.baseStats,
      permanentGmAdjustments,
      backpackItemAdjustments,
      skillStageStats: mechanics.skillStageStats,
      effectiveStats: mechanics.effectiveStats,
      statProof: Object.freeze(
        mechanics.statProof.map((proof) =>
          Object.freeze({
            statCode: proof.statCode,
            skillStageValue: proof.skillStageValue,
            positiveSymbiontDelta: proof.positiveSymbiontDelta,
            negativeSymbiontDelta: proof.negativeSymbiontDelta,
            appliedNegativeDelta: proof.appliedNegativeDelta,
            beforeLimits: proof.beforeLimits,
            minimumOrNull: proof.minimumOrNull,
            maximumOrNull: proof.maximumOrNull,
            effectiveValue: proof.effectiveValue,
          }),
        ),
      ),
    }),
    skills: Object.freeze({
      entries: Object.freeze(mechanics.learnedSkills.map(skill)),
      maxSlots,
      usedSlots,
      remainingSlots: maxSlots - usedSlots,
      requirementsSatisfied: true,
    }),
    symbionts: Object.freeze(
      mechanics.symbionts.map((entry) => {
        const species = baseline.catalog.symbionts.species.find(
          (candidate) => candidate.speciesKey === entry.speciesKey,
        );
        const binding = snapshot.branch.bindings.find(
          (candidate) =>
            candidate.acceptedIndex === entry.acceptedIndex &&
            candidate.speciesKey === entry.speciesKey,
        )?.binding;
        if (species === undefined || binding === undefined)
          fail('unknown source symbiont or binding');
        return Object.freeze({
          acceptedIndex: entry.acceptedIndex,
          speciesKey: entry.speciesKey,
          label: species.speciesLabel,
          status: entry.status,
          level: entry.level,
          maxOe: entry.maxOe,
          currentOe: entry.currentOe,
          xp: entry.xp,
          effectsEnabled: entry.effectsEnabled,
          xpEligible: entry.xpEligible,
          learnedNodes: Object.freeze(
            entry.learnedNodeRefs.map((nodeRef) => {
              const node = baseline.catalog.initialNodes.find(
                (candidate) =>
                  candidate.nodeRef === nodeRef && candidate.speciesKey === entry.speciesKey,
              );
              if (node === undefined) fail('unknown source development node');
              return Object.freeze({ label: node.label, level: node.level });
            }),
          ),
          binding:
            'side' in binding
              ? Object.freeze({ kind: binding.kind, side: binding.side })
              : Object.freeze({ kind: binding.kind }),
        });
      }),
    ),
    advisorOrNull,
    permanentGrants: Object.freeze(
      mechanics.permanentGrants.map((grant) =>
        Object.freeze({
          kind: grant.kind,
          bonusBefore: grant.bonusBefore,
          bonusAfter: grant.bonusAfter,
        }),
      ),
    ),
    trainingSlotLedger: Object.freeze({
      maxPermanentWisdom: mechanics.trainingSlotLedger.maxPermanentWisdom,
      everIssued: mechanics.trainingSlotLedger.everIssued,
    }),
    runtime: Object.freeze({
      maxHp: runtime.maxHp,
      currentHp: runtime.currentHp,
      alive: runtime.alive,
      conscious: runtime.conscious,
      stunned: runtime.stunned,
      bound: runtime.bound,
      burning: runtime.burning,
      poisoned: runtime.poisoned,
      diseased: runtime.diseased,
      wounds: runtime.wounds,
      injuries: runtime.injuries,
      bleeding: runtime.bleeding,
      temporaryEffects: runtime.temporaryEffects,
      cooldowns: runtime.cooldowns,
      preparations: runtime.preparations,
      initiativeOrNull: runtime.initiativeOrNull,
      combatSceneIdOrNull: runtime.combatSceneIdOrNull,
      statProgressionCounters: runtime.statProgressionCounters,
      combatUsageLimits: runtime.combatUsageLimits,
      symbiontXpProgressPoints: runtime.symbiontXpProgressPoints,
      unallocatedSymbiontXp: runtime.unallocatedSymbiontXp,
      equippedItems: runtime.equippedItems,
      generatedObjects: runtime.generatedObjects,
      externalEntities: runtime.externalEntities,
      chimeraDevouringHistory: runtime.chimeraDevouringHistory,
      chimeraExtraSlots: runtime.chimeraExtraSlots,
      taipanPoisonOrNull: runtime.taipanPoisonOrNull,
      penguinMiMiMiActive: runtime.penguinMiMiMiActive,
      ratInsideHost: runtime.ratInsideHost,
      keeperInsideHost: runtime.keeperInsideHost,
      mantisBladeStateOrNull: runtime.mantisBladeStateOrNull,
    }),
  });
}

export function deriveAdmissionMechanicalCores(
  source: ValidatedFinalAdmissionReviewSource,
  baseline: LocalCharacterExportBaseline,
  draft: Pick<
    AdmissionReviewDraft,
    'statAdjustments' | 'startingSkills' | 'massReview' | 'inventoryReview'
  >,
): Readonly<{ before: AdmissionMechanicalCore; after: AdmissionMechanicalCore }> {
  admissionStatsValue(draft.statAdjustments);
  admissionStartingSkillsValue(draft.startingSkills, '$.startingSkills');
  admissionMassReviewValue(draft.massReview, '$.massReview');
  admissionInventoryReviewValue(draft.inventoryReview, '$.inventoryReview');
  const input = admissionSourceMechanicsInput(source);
  const original = deriveCreationFinalMechanics(baseline.catalog, input);
  if (
    !isDeepStrictEqual(
      original,
      source.checkpoint.finalizationStage!.finalMechanicsSnapshotOrNull!.mechanics,
    )
  )
    fail('source mechanics differ from verified FINAL');
  const backpackItemAdjustments = admissionBackpackAdjustments(draft.inventoryReview);
  const after = deriveAdmissionMechanics(baseline.catalog, {
    source: input,
    permanentGmAdjustments: draft.statAdjustments,
    backpackItemAdjustments,
    selectedSkills: draft.startingSkills.entries,
  });
  const maxSlots = calculateStartSkillSlots(original.skillStageStats);
  return Object.freeze({
    before: core(
      source,
      baseline,
      input,
      original,
      zero(),
      zero(),
      source.checkpoint.finalizationStage!.finalMechanicsSnapshotOrNull!.identity.massKg,
      maxSlots,
    ),
    after: core(
      source,
      baseline,
      input,
      after.mechanics,
      Object.freeze({ ...draft.statAdjustments }),
      backpackItemAdjustments,
      draft.massReview.massKg,
      maxSlots,
    ),
  });
}

/** A complete mechanical projection, with definition IDs and private provenance excluded. */
export function projectAdmissionWeaponProfile(
  profile: StagedWeaponProfile,
): AdmissionPublicWeaponProfile {
  const combat = (value: StagedWeaponCombatDefinition) => ({
    valueMode: value.valueMode,
    sourceNotation: value.sourceNotation,
    baseExpression: value.baseExpression,
    sourceScope: value.sourceScope,
    evaluationScope: value.evaluationScope,
    instanceSourceFieldOrNull: value.instanceSourceField ?? null,
    conditionalOverrideOrNull: value.conditionalOverride ?? null,
    effectiveTemplateExpression: value.effectiveTemplateExpression,
    damageModifierStat: value.damageModifierStat,
    dieType: value.dieType,
    rollKind: value.rollKind,
    progressionEligibility: value.progressionEligibility,
    rawRollPersistence: value.rawRollPersistence,
    resolvedResultField: value.resolvedResultField,
    resolvedResultPersistence: value.resolvedResultPersistence,
  });
  const allowed = new Set<string>(ADMISSION_WEAPON_PROPERTY_KEYS);
  if (Object.keys(profile.properties).some((key) => !allowed.has(key)))
    fail('unrecognized public weapon property');
  return admissionPublicWeaponProfileValue({
    weaponTypeId: profile.weaponTypeId,
    weaponVariantId: profile.weaponVariantId,
    name: profile.name,
    variantLabel: profile.variantLabel,
    statSource: profile.statSource,
    damageDefinition: combat(profile.damageDefinition),
    penetrationDefinition: combat(profile.penetrationDefinition),
    statRequirements: { ...profile.statRequirements },
    instanceDamageOrNull: profile.instanceDamage ?? null,
    rangeMetersOrNull: profile.rangeMeters ?? null,
    accuracyBonusOrNull: profile.accuracyBonus ?? null,
    properties: Object.fromEntries(
      ADMISSION_WEAPON_PROPERTY_KEYS.filter((key) => Object.hasOwn(profile.properties, key)).map(
        (key) => [key, profile.properties[key]],
      ),
    ),
  });
}
