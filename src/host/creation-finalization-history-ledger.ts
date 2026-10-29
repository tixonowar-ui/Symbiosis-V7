import { isDeepStrictEqual } from 'node:util';

import { calculateTrogrSuppressionBonus } from '../domain/rules/symbiont-stage/advisor.js';
import {
  resolveSymbiontComposition,
  type SymbiontComposition,
} from '../domain/rules/symbiont-stage/composition.js';
import { resolveRandomSymbiontSequence } from '../domain/rules/symbiont-stage/random-sequence.js';
import { calculateSkillStageStats } from '../domain/rules/skill-stage/stats.js';
import { CreationFinalizationError } from '../domain/rules/creation-finalization/catalog.js';
import { deriveCreationFinalMechanics } from '../domain/rules/creation-finalization/mechanics.js';
import type {
  CreationFinalizationCatalog,
  CreationPermanentSkillGrant,
  CreationTrainingSlotLedger,
} from '../domain/rules/creation-finalization/types.js';
import type { DurableCreationWizardCheckpoint } from './creation-set-decide.js';

export interface InitialCreationPermanentLedgers {
  readonly permanentGrants: readonly CreationPermanentSkillGrant[];
  readonly trainingSlotLedger: CreationTrainingSlotLedger;
}

/** The caller has validated the original durable history. Reading never allocates or writes. */
export function deriveInitialCreationPermanentLedgers(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: CreationFinalizationCatalog,
): InitialCreationPermanentLedgers {
  const assignment = checkpoint.statAssignmentStage;
  const skillStage = checkpoint.skillSelectionStage;
  const raceCode = checkpoint.raceAndMethodStage?.race?.value;
  if (assignment === null || skillStage === null || raceCode === undefined)
    throw new CreationFinalizationError('initial ledgers require accepted stats, race and skills');
  const classCode = checkpoint.pureClassStage?.derived.pureClass ?? null;
  const creationMode =
    raceCode === 'PURE' ? null : checkpoint.raceAndMethodStage!.symbiontAcquisition.value;
  if (raceCode !== 'PURE' && creationMode === null)
    throw new CreationFinalizationError('initial ledgers require a locked acquisition mode');
  const stats = calculateSkillStageStats(catalog.symbionts.skillStage, {
    baseStats: assignment.derived.baseStats,
    raceCode,
    classCode,
    creationMode: creationMode ?? 'MANUAL',
  }).skillStageStats;
  if (stats.W < 1) throw new CreationFinalizationError('accepted skill stage has invalid wisdom');
  let ledgers: InitialCreationPermanentLedgers = Object.freeze({
    permanentGrants: Object.freeze([]),
    trainingSlotLedger: Object.freeze({
      maxPermanentWisdom: stats.W,
      everIssued: Math.floor(stats.W / 2),
    }),
  });
  const fold = (
    composition: SymbiontComposition,
    advisorSuppressionBonusOrNull: number | null,
  ): void => {
    const mechanics = deriveCreationFinalMechanics(catalog, {
      baseStats: assignment.derived.baseStats,
      raceCode,
      classCode,
      creationMode,
      composition,
      learnedSkills: skillStage.derived.learnedSkills,
      advisorSuppressionBonusOrNull,
      ...ledgers,
    });
    ledgers = Object.freeze({
      permanentGrants: mechanics.permanentGrants,
      trainingSlotLedger: mechanics.trainingSlotLedger,
    });
  };
  const random = checkpoint.randomSymbiontStage;
  if (random !== null) {
    const physicalRolls = random.rollRecords.map((record) => record.physicalRoll);
    // AQA-007 resolves each accepted result immediately. A Teacher preceding an
    // absorbing Trogr therefore contributes to the historical wisdom maximum.
    for (let length = 1; length <= physicalRolls.length; length += 1) {
      const resolved = resolveRandomSymbiontSequence(catalog.symbionts, {
        randomSequenceId: random.randomSequenceId,
        raceCode: random.raceCode,
        diceInputModeSnapshot: random.diceInputModeSnapshot,
        physicalRolls: physicalRolls.slice(0, length),
        bindingSnapshotOrNull: null,
      });
      const suppressed = resolved.advisorOrNull?.suppressionOrNull;
      if (suppressed !== null && suppressed !== undefined && suppressed.suppressionBOrNull === null)
        continue;
      fold(resolved.composition, suppressed?.suppressionBOrNull ?? null);
    }
  }
  const manual = checkpoint.manualCompositionStage;
  if (manual != null) {
    const entry = checkpoint.armorBundleStage;
    for (const [index, record] of manual.compositionRecords.entries()) {
      const composition = resolveSymbiontComposition(catalog.symbionts, {
        raceCode: manual.composition.raceCode,
        acceptedSpecies: record.acceptedSpecies,
      });
      if (composition.interactions.length !== 0) {
        // ADR 0055–0057 persist the only old special-interaction confirmation in
        // armor entry. Earlier composition records can be rejected candidates.
        const last = index === manual.compositionRecords.length - 1;
        if (
          !last ||
          entry == null ||
          entry.entryRequest.payload.variant !== 'MANUAL_INTERACTION_CONFIRMATION'
        )
          continue;
        if (
          entry.entryReceipt.result.variant !== 'MANUAL_INTERACTION_CONFIRMATION' ||
          entry.entryReceipt.commandId !== entry.entryRequest.commandId ||
          entry.entryRequest.payload.characterDraftId !==
            checkpoint.localCharacter.localCharacterId ||
          entry.entryRequest.payload.wizardCheckpointId !== checkpoint.checkpoint.checkpointId ||
          entry.entryRequest.payload.draftRevision < record.receipt.result.draftRevision ||
          !isDeepStrictEqual(manual.composition, composition)
        )
          throw new CreationFinalizationError(
            'manual initial interaction confirmation is not bound to the terminal composition',
          );
      }
      const suppressed = composition.instances.some(
        (instance) => instance.speciesKey === 'ADVISER' && instance.status === 'SUPPRESSED',
      );
      const roll = manual.suppressionRollRecordOrNull;
      if (suppressed && roll === null)
        throw new CreationFinalizationError(
          'confirmed composition is missing its suppression receipt',
        );
      fold(
        composition,
        suppressed ? calculateTrogrSuppressionBonus(roll!.physicalRoll.mechanical) : null,
      );
    }
  }
  return ledgers;
}
