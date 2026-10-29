import type { ActionKey } from '@generated/types/atlas.js';
import type { PresentedBaseForm } from '@shared/wire-v2-protocol.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import {
  calculateSkillSlotCost,
  calculateSkillStageStats,
  calculateStartSkillSlots,
  resolveAdvisorIwRolls,
  validateSkillRequirements,
  type SymbiontCatalog,
} from '../../domain/index.js';
import type { CreationSkillCatalog } from '../creation-skill-catalog.js';
import type { CreationDecisionConsequenceCatalog } from '../creation-decision-consequence-catalog.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';
import {
  creationFinalizationHash,
  type CreationFinalizationView,
} from '../creation-finalization-contract.js';
import { createAdvisorSkillOptions } from '../symbiont-stage-catalog.js';
export interface CreationCorrectionCapabilities {
  readonly checkpoint: boolean;
  readonly setDecide: boolean;
  readonly rollCommit: boolean;
}

const statFacts = (stats: Readonly<Record<'S' | 'D' | 'M' | 'Z' | 'I' | 'W' | 'C', number>>) => ({
  S: stats.S,
  D: stats.D,
  M: stats.M,
  Z: stats.Z,
  I: stats.I,
  W: stats.W,
  C: stats.C,
});

/** Correction data is an explicit active-branch allowlist; original stage projections stay immutable. */
export function projectCreationCorrection(
  checkpoint: DurableCreationWizardCheckpoint,
  view: CreationFinalizationView,
  catalogs: {
    readonly symbionts: SymbiontCatalog;
    readonly skills: CreationSkillCatalog;
    readonly decisions: CreationDecisionConsequenceCatalog;
  },
  capabilities: CreationCorrectionCapabilities,
): PresentedBaseForm {
  const context = view.correctionContextOrNull;
  if (context === null || view.finalSaveStatus === 'COMMITTED')
    throw new Error('correction projection requires an active signed context');
  const formId = context.sourceFormId,
    branch = view.activeBranch,
    catalog = catalogs.symbionts;
  const random = view.randomStateOrNull;
  const stats =
    branch.raceCode === 'PURE' && branch.classCode === null
      ? null
      : calculateSkillStageStats(catalog.skillStage, {
          baseStats: checkpoint.statAssignmentStage!.derived.baseStats,
          raceCode: branch.raceCode,
          classCode: branch.classCode,
          creationMode: branch.creationMode ?? 'MANUAL',
        }).skillStageStats;
  const required = stats !== null && stats.W >= 1 ? calculateStartSkillSlots(stats) : 0;
  const skillOptions = catalogs.skills.selectableSkills
    .filter((skill) => {
      if (stats === null) return false;
      try {
        validateSkillRequirements(catalog.skillStage, skill.skillId, stats);
        return true;
      } catch {
        return false;
      }
    })
    .map((skill) => {
      const levels: { targetBonus: number; slotCost: number }[] = [];
      const definition = catalog.skillStage.skills.find((s) => s.skillKey === skill.skillId)!;
      for (
        let bonus = 1;
        calculateSkillSlotCost(bonus) <= required &&
        (definition.maxBonus === 'NO_RULED_UPPER_LIMIT' || bonus <= definition.maxBonus);
        bonus++
      )
        levels.push({ targetBonus: bonus, slotCost: calculateSkillSlotCost(bonus) });
      return {
        skillId: skill.skillId,
        skillLabel: skill.skillLabel,
        bonusDomainScope: skill.bonusDomainScope,
        requirements: skill.requirements.map((r) => ({
          statCode: r.statCode,
          statLabel: r.statLabel,
          minValue: r.minValue,
        })),
        missingSkillPenalty:
          skill.missingSkillPenalty.kind === 'NO_MISSING_SKILL_PENALTY'
            ? { kind: 'NO_MISSING_SKILL_PENALTY' }
            : { kind: 'MISSING_SKILL_PENALTY', value: skill.missingSkillPenalty.value },
        levelOptions: levels,
      };
    });
  const advisor = branch.advisorOrNull;
  const i = advisor?.physicalRolls.find((r) => r.kind === 'ADVISOR_I'),
    w = advisor?.physicalRolls.find((r) => r.kind === 'ADVISOR_W');
  const iw =
    i !== undefined && w !== undefined
      ? resolveAdvisorIwRolls([i.mechanical, w.mechanical])
      : (branch.retainedAdvisorOrNull?.advisorIwOrNull ?? null);
  const advisorOptions =
    iw === null || view.mechanics === null
      ? null
      : createAdvisorSkillOptions(catalog, catalogs.skills, iw, {
          S: view.mechanics.effectiveStats.S,
          D: view.mechanics.effectiveStats.D,
          M: view.mechanics.effectiveStats.M,
          Z: view.mechanics.effectiveStats.Z,
          C: view.mechanics.effectiveStats.C,
        });
  const nextKind = random?.nextRequest.kind ?? null;
  const monsterEligible =
    random?.nextRequest.kind === 'CRITICAL_CONFIRMATION' && random.nextRequest.monsterEligible;
  const monsterEditable =
    branch.raceCode === 'UNITED' &&
    random?.accepted.some((a) => a.kind === 'SYMBIOTIC_MONSTER') === true;
  const actions: ActionKey[] = [];
  switch (formId) {
    case 'CHR-001':
      actions.push('CHR-001::CTA::001');
      break;
    case 'CHR-009':
      actions.push('CHR-009::CTA::003');
      break;
    case 'CHR-010':
      actions.push('CHR-010::CTA::001', 'CHR-010::CTA::002');
      break;
    case 'CHR-011':
      actions.push('CHR-011::CTA::001');
      break;
    case 'CHR-015':
      actions.push('CHR-015::CTA::001', 'CHR-015::CTA::003');
      break;
    case 'CHR-017':
      if (branch.creationMode === 'MANUAL') actions.push('CHR-017::CTA::001', 'CHR-017::CTA::002');
      if (branch.creationMode === 'RANDOM') actions.push('CHR-017::CTA::003');
      actions.push('CHR-017::CTA::006');
      break;
    case 'CHR-018':
      actions.push('CHR-018::CTA::001', 'CHR-018::CTA::002', 'CHR-018::CTA::003');
      break;
    case 'CHR-019':
      actions.push('CHR-019::CTA::004');
      if (
        branch.creationMode === 'MANUAL' &&
        !branch.interactionsConfirmed &&
        branch.composition !== null
      )
        actions.push('CHR-019::CTA::002');
      break;
    case 'CHR-020':
      if (view.pendingRollRequestIds.length === 1 || nextKind === 'BINDING')
        actions.push('CHR-020::CTA::002');
      if (nextKind === 'BINDING') actions.push('CHR-020::CTA::003');
      if (monsterEligible || monsterEditable) actions.push('CHR-020::CTA::004');
      break;
    case 'CHR-041':
      if (view.pendingRollRequestIds.length === 2) actions.push('CHR-041::CTA::003');
      else if (view.pendingRollRequestIds.length === 1) actions.push('CHR-041::CTA::004');
      else if (advisorOptions !== null) actions.push('CHR-041::CTA::001', 'CHR-041::CTA::002');
      break;
    case 'CHR-042':
      actions.push('CHR-042::CTA::001', 'CHR-042::CTA::002');
      break;
  }
  const latest = checkpoint.finalizationStage!.records.at(-1)!;
  const species = branch.composition?.acceptedSpecies ?? random?.accepted ?? [];
  const physicalRolls = [
    ...(branch.sourceRandomSequenceOrNull?.physicalRolls ?? []),
    ...(random?.sequence.physicalRolls ?? []),
    ...(advisor?.physicalRolls ?? []),
  ];
  const distinctRolls = [
    ...new Map(physicalRolls.map((roll) => [roll.rollReceiptId, roll])).values(),
  ];
  const consequences = view.compositionConsequencesOrNull;
  const publicComposition = (composition: NonNullable<typeof branch.composition>) => ({
    slotUsage: composition.slotUsage,
    slotCapacity: composition.slotCapacity,
    instances: composition.instances.map((instance) => ({
      speciesLabel: catalog.species.find((s) => s.speciesKey === instance.speciesKey)!.speciesLabel,
      status: instance.status,
      slotCost: instance.slotCost,
      currentOe: instance.currentOe,
    })),
  });
  const payload: JsonObject = {
    characterDraftId: checkpoint.localCharacter.localCharacterId,
    wizardCheckpointId: checkpoint.checkpoint.checkpointId,
    draftRevision: checkpoint.receipt.result.draftRevision,
    commandId: latest.request.commandId,
    summaryReceiptIdOrNull: view.summaryReceiptIdOrNull,
    correctionHeadHash: view.correctionHeadHash,
    branchCacheDigest: view.branchCacheDigest,
    finalSaveStatus: view.finalSaveStatus,
    correctionContext: {
      originFormId: context.originFormId,
      returnFormId: context.returnFormId,
      sourceFormId: context.sourceFormId,
      summaryReceiptId: context.summaryReceiptId,
      correctionHeadHash: context.correctionHeadHash,
    },
    identity: {
      name: view.state.identity.name,
      description: view.state.identity.description,
      age: view.state.identity.age,
      sex: view.state.identity.sex,
      massKg: view.state.identity.massKg,
      artAssetKeyOrLocalFile:
        view.state.identity.artAssetKeyOrLocalFile === null
          ? null
          : view.state.identity.artAssetKeyOrLocalFile.kind === 'asset-key'
            ? { kind: 'asset-key', assetKey: view.state.identity.artAssetKeyOrLocalFile.assetKey }
            : {
                kind: 'local-file',
                mediaType: view.state.identity.artAssetKeyOrLocalFile.mediaType,
                bytesBase64: view.state.identity.artAssetKeyOrLocalFile.bytesBase64,
              },
    },
    raceChoice: branch.raceCode,
    pureClassOrNull: branch.classCode,
    lockedAcquisitionModeOrNull: view.state.lockedAcquisitionModeOrNull,
    creationMode: branch.creationMode,
    raceOptions: catalog.races.map((r) => ({ raceCode: r.raceCode, label: r.raceLabel })),
    raceConsequenceOptions: catalogs.decisions.raceConsequenceOptions,
    // Labels are the exact CHR-011 CTA labels, independent of internal modifier profile IDs.
    classOptions: catalog.skillStage.classes.map((c) => {
      const mandatory = catalog.skillStage.skills.find(
        (skill) => skill.skillKey === c.mandatorySkillKey,
      );
      const label = catalogs.skills.skillLabels.find(
        (skill) => skill.skillId === c.mandatorySkillKey,
      );
      if (mandatory === undefined || label === undefined || typeof mandatory.maxBonus !== 'number')
        throw new Error(
          `creation correction lacks the validated mandatory skill for ${c.classCode}`,
        );
      const modifiers = catalog.skillStage.modifiers.filter(
        (modifier) => modifier.sourceType === 'PURE_CLASS' && modifier.sourceId === c.classCode,
      );
      if (
        modifiers.some(
          (modifier) =>
            modifier.applicationStage !== 'SKILL_STAGE' &&
            modifier.applicationStage !== 'CHECK_CONTEXT',
        )
      )
        throw new Error('unrecognized PURE class modifier stage');
      return {
        classCode: c.classCode,
        label: ({ SEEKER: 'Искатель', STALKER: 'Сталкер', SOLDIER: 'Солдат' } as const)[
          c.classCode
        ],
        classConsequences: {
          statModifiers: modifiers
            .filter((modifier) => modifier.applicationStage === 'SKILL_STAGE')
            .map((modifier) => {
              if (modifier.contextPredicate !== 'ownerRace=PURE')
                throw new Error('unrecognized PURE class stat context');
              return { statCode: modifier.targetCode, delta: modifier.value };
            }),
        },
        mandatoryClassSkill: {
          skillId: label.skillId,
          skillLabel: label.skillLabel,
          bonus: mandatory.maxBonus,
          slotCost: c.mandatorySkillSlotCost,
        },
        contextModifiers: modifiers
          .filter((modifier) => modifier.applicationStage === 'CHECK_CONTEXT')
          .map((modifier) => {
            const socialTargetRace =
              modifier.contextPredicate === 'socialTargetRace=PURE'
                ? 'PURE'
                : modifier.contextPredicate === 'socialTargetRace=UNITED'
                  ? 'UNITED'
                  : null;
            if (socialTargetRace === null)
              throw new Error('unrecognized PURE class social target context');
            return { statCode: modifier.targetCode, delta: modifier.value, socialTargetRace };
          }),
      };
    }),
    baseStats: statFacts(checkpoint.statAssignmentStage!.derived.baseStats),
    skillStageStatsOrNull: stats === null ? null : statFacts(stats),
    requiredSkillSlots: required,
    grantedSkillSlots: view.state.learnedSkills
      .filter((s) => s.source !== 'SELECTED')
      .reduce((sum, s) => sum + s.slotCost, 0),
    skillOptions,
    selectedSkills: view.state.learnedSkills
      .filter((s) => s.source === 'SELECTED')
      .map((s) => ({ skillKey: s.skillKey, targetBonus: s.bonus })),
    eligibleSymbiontSpecies: catalog.species
      .filter((s) => s.allowedRaceCodes.includes(branch.raceCode))
      .map((s) => ({
        speciesKey: s.speciesKey,
        speciesLabel: s.speciesLabel,
        slotCost: s.slotCost,
        bindingPolicy: s.bindingPolicy,
        kind: s.kind,
      })),
    acceptedSpecies: species.map((s) => ({
      acceptedIndex: s.acceptedIndex,
      speciesKey: s.speciesKey,
      speciesLabel: catalog.species.find((c) => c.speciesKey === s.speciesKey)!.speciesLabel,
    })),
    selectedBindings: branch.bindings.flatMap((b) =>
      b.binding.kind === 'OWL_EYE' || b.binding.kind === 'EEL_ARM'
        ? [{ speciesKey: b.speciesKey, side: b.binding.side }]
        : [],
    ),
    lockedBindingSpecies:
      branch.sourceRandomSequenceOrNull?.bindingSnapshotOrNull
        ?.filter((b) => b.binding.kind === 'OWL_EYE' || b.binding.kind === 'EEL_ARM')
        .map((b) => b.speciesKey) ?? [],
    slotCapacity: catalog.races.find((r) => r.raceCode === branch.raceCode)!.baseSymbiontSlots,
    diceInputModeSnapshot: checkpoint.statRollStage!.diceInputModeSnapshot,
    pendingRollRequestIds: [...view.pendingRollRequestIds],
    nextRandomKindOrNull: nextKind,
    monsterChoiceRequired: monsterEligible,
    monsterChoiceEditable: monsterEditable,
    monsterOptions: catalog.species
      .filter((s) => s.kind === 'SYMBIOTIC_MONSTER' && s.allowedRaceCodes.includes(branch.raceCode))
      .map((s) => ({ speciesKey: s.speciesKey, speciesLabel: s.speciesLabel })),
    physicalRolls: distinctRolls.map((r) => ({
      kind: r.kind,
      rollRequestId: r.rollRequestId,
      rollReceiptId: r.rollReceiptId,
      rawFace: r.mechanical.rawFace,
      dieSides: r.mechanical.dieSides,
    })),
    advisorOrNull:
      advisor === null
        ? null
        : {
            advisorInstanceDraftId: advisor.advisorInstanceDraftId,
            skillsConfirmed: advisor.skillsConfirmed,
            iwOrNull: iw === null ? null : { I: iw.I.value, W: iw.W.value },
            requiredSlotCount: advisorOptions?.requiredSlotCount ?? null,
            skillOptions:
              advisorOptions?.skillOptions.map((s) => ({
                skillId: s.skillId,
                skillLabel: s.skillLabel,
                bonusDomainScope: s.bonusDomainScope,
                requirements: s.requirements.map((r) => ({
                  statCode: r.statCode,
                  statLabel: r.statLabel,
                  minValue: r.minValue,
                })),
                missingSkillPenalty:
                  s.missingSkillPenalty.kind === 'NO_MISSING_SKILL_PENALTY'
                    ? { kind: 'NO_MISSING_SKILL_PENALTY' }
                    : { kind: 'MISSING_SKILL_PENALTY', value: s.missingSkillPenalty.value },
                levelOptions: s.levelOptions.map((l) => ({
                  targetBonus: l.targetBonus,
                  slotCost: l.slotCost,
                })),
              })) ?? [],
            selectedSkills: advisor.selectedSkills.map((s) => ({
              skillKey: s.skillKey,
              targetBonus: s.targetBonus,
            })),
          },
    compositionHashOrNull:
      branch.composition === null ? null : creationFinalizationHash(branch.composition),
    interactionsConfirmed: branch.interactionsConfirmed,
    compositionConsequencesOrNull:
      consequences === null
        ? null
        : {
            beforeOrNull:
              consequences.beforeCompositionOrNull === null
                ? null
                : publicComposition(consequences.beforeCompositionOrNull),
            after: publicComposition(consequences.afterComposition),
            effectiveStatsBeforeOrNull:
              consequences.beforeMechanicsOrNull === null
                ? null
                : statFacts(consequences.beforeMechanicsOrNull.effectiveStats),
            effectiveStatsAfterOrNull:
              consequences.afterMechanicsOrNull === null
                ? null
                : statFacts(consequences.afterMechanicsOrNull.effectiveStats),
            permanentSkillsAfter:
              consequences.afterMechanicsOrNull?.learnedSkills
                .filter((s) => s.source === 'SYMBIONT_PERMANENT')
                .map((s) => ({
                  skillLabel: catalogs.skills.skillLabels.find(
                    (label) => label.skillId === s.skillKey,
                  )!.skillLabel,
                  bonus: s.bonus,
                })) ?? [],
          },
    interactions:
      branch.composition?.interactions.map((interaction) => ({ kind: interaction.kind })) ?? [],
    nextFormId: 'CHR-025',
  };
  const bindings =
    formId === 'CHR-001'
      ? [
          {
            parameterIndex: 0 as const,
            source: 'executor-allocated' as const,
            value: checkpoint.localCharacter.localCharacterId,
          },
        ]
      : formId === 'CHR-018'
        ? checkpoint.symbiontPresentationStage?.routeBindings
        : checkpoint.nextStageEnvelope.routeBindings;
  if (bindings === undefined) throw new Error('correction route bindings are missing');
  return {
    formId,
    formType: 'screen',
    routeTemplate:
      formId === 'CHR-018'
        ? '/player/characters/:localCharacterId/create/chr-018/:speciesKey'
        : `/player/characters/:localCharacterId/create/${formId.toLowerCase()}`,
    routeBindings: bindings,
    availableActionKeys: actions.filter((action) =>
      ['CHR-001::CTA::001', 'CHR-015::CTA::001', 'CHR-018::CTA::001', 'CHR-041::CTA::001'].includes(
        action,
      )
        ? capabilities.checkpoint
        : [
              'CHR-010::CTA::001',
              'CHR-010::CTA::002',
              'CHR-011::CTA::001',
              'CHR-042::CTA::001',
            ].includes(action)
          ? capabilities.setDecide
          : [
                'CHR-020::CTA::002',
                'CHR-020::CTA::004',
                'CHR-041::CTA::003',
                'CHR-041::CTA::004',
              ].includes(action)
            ? capabilities.rollCommit
            : true,
    ),
    roleFilteredPayload: payload,
  };
}
