import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import { LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS } from '@generated/types/local-character-portraits.js';
import type { ClientToHostMessage } from '@shared/wire-protocol.js';
import {
  commitLocalCharacterCheckpoint,
  writeLocalCharacterSymbiontPresentation,
} from '../persistence/index.js';
import {
  calculateStartSkillSlots,
  validateSkillSelectionDraft,
  validateSkillSelection,
  type LearnedSkill,
} from '../domain/rules/skill-stage/skills.js';
import { calculateSkillStageStats } from '../domain/rules/skill-stage/stats.js';
import { deriveCreationFinalMechanics } from '../domain/rules/creation-finalization/mechanics.js';
import { canonicalStartingWeaponSelection } from '../domain/rules/item-stage/starting-weapon.js';
import { resolveCriticalConfirmation } from '../domain/index.js';
import type {
  CreationFinalizationCatalog,
  CreationFinalMechanics,
  CreationValidationBlocker,
} from '../domain/rules/creation-finalization/types.js';
import {
  calculateTrogrSuppressionBonus,
  resolveAdvisorIwRolls,
  validateAdvisorSkillSelection,
} from '../domain/rules/symbiont-stage/advisor.js';
import {
  createSymbiontBindingSnapshot,
  type SymbiontCatalog,
  type RandomSymbiontPhysicalRoll,
} from '../domain/index.js';
import { resolveSymbiontComposition } from '../domain/rules/symbiont-stage/composition.js';
import { validateManualSymbiontComposition } from '../domain/rules/symbiont-stage/manual-composition.js';
import {
  resolveCreationCorrectionRandomSequence,
  type ResolvedRandomSymbiontSequence,
} from '../domain/rules/symbiont-stage/random-sequence.js';
import { canonicalizeIdentityDraftValues } from './identity-draft.js';
import { EMPTY_IDENTITY_BRANCH_CACHE_HASH } from './identity-checkpoint.js';
import { canonicalCreationFinalizationCatalog } from './creation-finalization-catalog.js';
import { deriveInitialCreationPermanentLedgers } from './creation-finalization-history-ledger.js';
import { revalidateCreationSkillRetention } from '../domain/rules/creation-finalization/skill-retention.js';
import { createAdvisorSkillStats } from '../domain/rules/symbiont-stage/advisor.js';
import {
  collectStartingPropertyReceiptRefs,
  validateStartingPropertyReceiptRefs,
  deriveStartingPropertySummary,
} from './creation-property-summary.js';
import {
  creationWizardDurableIds,
  loadCreationWizardCheckpoint,
  validateDurableCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
  type CreationWizardSymbiontPayload,
} from './creation-set-decide.js';
import {
  assertCommonSymbiont,
  assertNoPreviousSymbiontCommand,
  sampledSymbiontFace,
} from './creation-symbiont-commands.js';
import {
  guardSymbiontRejected,
  incrementedSymbiontRevisions,
  nextSymbiontEnvelope,
  resolveSymbiontStage,
} from './creation-symbiont-contract.js';
import { manualNavigationRevisionsMatch } from './creation-manual-composition-contract.js';
import type { ArmorBundleValidationContext } from './creation-armor-bundle.js';
import {
  creationFinalizationHash,
  creationCorrectionId,
  creationCorrectionHeadHash,
  finalizationActiveBranch,
  finalizationSummaryRecord,
  latestCreationFinalizationRecord,
  creationFinalizationStageIds,
  normalizeCreationFinalizationRequest,
  type CreationCorrectionBranch,
  type CreationFinalizationState,
  type CreationFinalizationStage,
  type CreationFinalizationView,
  type CreationFinalizationFormId,
  type CreationCorrectionFormId,
  type CreationFinalizationRequest,
  type CreationCorrectionRequest,
  type CreationFinalizationRecord,
  type CreationFinalizationReceipt,
  type CreationCorrectionIdentity,
} from './creation-finalization-contract.js';

export {
  latestCreationFinalizationRecord,
  creationFinalizationRecords,
} from './creation-finalization-contract.js';
export interface CreationFinalizationDependencies {
  readonly catalog: SymbiontCatalog;
  readonly finalizationCatalog?: CreationFinalizationCatalog;
  readonly sampleD20: () => number;
}
type DecodedRequest = Extract<ClientToHostMessage, { readonly messageType: 'command.request' }>;
const portraitKeys = new Set<string>(LOCAL_CHARACTER_PORTRAIT_ASSET_KEYS);
// ADR 0037, exact CHR-025 inclusive endpoints; the owner approval remains pending.
const MASS_BOUNDS = {
  PURE: { MALE: [60, 400], FEMALE: [40, 350] },
  UNITED: { MALE: [30, 150], FEMALE: [25, 120] },
  FREE: { MALE: [40, 200], FEMALE: [30, 160] },
} as const;
// ADR 0040 deliberately maps delivered asset keys instead of deriving file names from race codes.
const PORTRAITS = {
  PURE: { MALE: 'symbiosis_placeholder_pure_male', FEMALE: 'symbiosis_placeholder_pure_female' },
  UNITED: {
    MALE: 'symbiosis_placeholder_unified_male',
    FEMALE: 'symbiosis_placeholder_unified_female',
  },
  FREE: { MALE: 'symbiosis_placeholder_free_male', FEMALE: 'symbiosis_placeholder_free_female' },
} as const;
function baseHistoryHash(checkpoint: DurableCreationWizardCheckpoint): string {
  const {
    receipt: _receipt,
    nextStageEnvelope: _next,
    randomReceiptIds: _random,
    finalizationStage: _finalization,
    ...immutable
  } = checkpoint.durablePayload as CreationWizardSymbiontPayload;
  return creationFinalizationHash(immutable);
}
function originalState(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: CreationFinalizationCatalog,
): CreationFinalizationState {
  const raceCode = checkpoint.raceAndMethodStage?.race?.value;
  if (
    raceCode === undefined ||
    checkpoint.statAssignmentStage === null ||
    checkpoint.skillSelectionStage === null ||
    checkpoint.fiveStartingPositionsStage?.checkpointRecordOrNull == null
  )
    return guardSymbiontRejected();
  const identityPayload = checkpoint.identityStage.request.payload;
  const identity: CreationCorrectionIdentity = {
    name: identityPayload.name,
    age: identityPayload.age,
    sex: identityPayload.sex,
    massKg: identityPayload.massKg,
    description: identityPayload.description,
    artAssetKeyOrLocalFile: identityPayload.artAssetKeyOrLocalFile,
  };
  const random =
    checkpoint.randomSymbiontStage === null
      ? null
      : resolveSymbiontStage(catalog.symbionts, checkpoint.randomSymbiontStage);
  const manual = checkpoint.manualCompositionStage ?? null;
  const creationMode =
    raceCode === 'PURE' ? null : checkpoint.raceAndMethodStage!.symbiontAcquisition.value;
  if (raceCode !== 'PURE' && creationMode === null) return guardSymbiontRejected();
  const randomAdvisor = checkpoint.randomSymbiontStage?.advisorSkillRecordOrNull;
  const manualAdvisor = manual?.advisorSkillRecordOrNull;
  const advisorId =
    checkpoint.randomSymbiontStage?.advisorInstanceDraftIdOrNull ??
    manual?.advisorInstanceDraftIdOrNull ??
    null;
  const advisorRolls = random?.sequence.physicalRolls.filter((r) =>
    ['ADVISOR_I', 'ADVISOR_W', 'TROGR_SUPPRESSION_B'].includes(r.kind),
  ) ?? [
    ...(manual?.advisorIwRecordOrNull?.physicalRolls ?? []).map((r) => ({
      ...r,
      advisorAcceptedIndex: manual!.composition.acceptedSpecies.find(
        (s) => s.speciesKey === 'ADVISER',
      )!.acceptedIndex,
    })),
    ...(manual?.suppressionRollRecordOrNull == null
      ? []
      : [
          {
            ...manual.suppressionRollRecordOrNull.physicalRoll,
            advisorAcceptedIndex: manual.composition.acceptedSpecies.find(
              (s) => s.speciesKey === 'ADVISER',
            )!.acceptedIndex,
          },
        ]),
  ];
  const branch: CreationCorrectionBranch = {
    branchId: creationCorrectionId(
      checkpoint.localCharacter.localCharacterId,
      'branch',
      raceCode,
      creationMode ?? 'NONE',
    ),
    raceCode,
    creationMode,
    classCode: checkpoint.pureClassStage?.derived.pureClass ?? null,
    composition: random?.composition ?? manual?.composition ?? null,
    bindings: random?.drawnSpeciesAndBindings ?? manual?.compositionRecords.at(-1)?.bindings ?? [],
    retainedAccepted: random?.accepted ?? [],
    retainedAdvisorOrNull: random?.advisorOrNull ?? null,
    physicalRolls: [],
    randomSequenceOrNull: random?.sequence ?? null,
    sourceRandomSequenceOrNull: null,
    monsterChoiceOverrideOrNull: null,
    advisorOrNull:
      advisorId === null
        ? null
        : {
            advisorInstanceDraftId: advisorId,
            physicalRolls: advisorRolls,
            selectedSkills: (
              randomAdvisor?.request.payload.selectedSkills ??
              manualAdvisor?.selectedSkills ??
              []
            ).map((s) => ({ skillKey: s.skillId, targetBonus: s.targetBonus })),
            learnedSkills:
              randomAdvisor == null
                ? (manualAdvisor?.learnedSkills ?? [])
                : (randomAdvisor.receipt.result.learnedSkills as unknown as readonly {
                    skillKey: string;
                    bonus: number;
                    slotCost: number;
                  }[]),
            skillsConfirmed: randomAdvisor != null || manualAdvisor != null,
          },
    interactionsConfirmed: true,
    bindingsConfirmed: true,
  };
  const state: CreationFinalizationState = {
    identity,
    lockedAcquisitionModeOrNull: creationMode,
    activeBranchId: branch.branchId,
    branches: [branch],
    learnedSkills: checkpoint.skillSelectionStage.derived.learnedSkills,
    ...deriveInitialCreationPermanentLedgers(checkpoint, catalog),
    advisorCards: branch.advisorOrNull === null ? [] : [branch.advisorOrNull],
  };
  return reconcileConfirmedCreationState(checkpoint, state, catalog, true);
}
export function creationFinalizationStageForCheckpoint(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog = canonicalCreationFinalizationCatalog(),
): CreationFinalizationStage | null {
  if (checkpoint.finalizationStage != null) return checkpoint.finalizationStage;
  const entry = checkpoint.fiveStartingPositionsStage?.checkpointRecordOrNull;
  if (entry == null) return null;
  const initialState = originalState(checkpoint, catalog);
  return {
    baseHistoryHash: baseHistoryHash(checkpoint),
    entryRequest: entry.request,
    entryReceipt: entry.receipt,
    initialState,
    state: initialState,
    records: [],
    finalMechanicsSnapshotOrNull: null,
  };
}
export function creationFinalizationPresentationForm(
  checkpoint: DurableCreationWizardCheckpoint,
): CreationFinalizationFormId | null {
  const stage = checkpoint.finalizationStage;
  if (stage == null) {
    const entry = checkpoint.fiveStartingPositionsStage?.checkpointRecordOrNull;
    if (entry == null) return null;
    const signed = checkpoint.symbiontPresentationStage;
    return signed != null && signed.projectionRevision > entry.receipt.revisions.projectionRevision
      ? (signed.formId as CreationFinalizationFormId)
      : 'CHR-032';
  }
  if (stage.finalMechanicsSnapshotOrNull !== null) return 'CHR-025';
  return (checkpoint.symbiontPresentationStage?.formId ??
    latestCreationFinalizationRecord(stage).nextStageEnvelope.formId) as CreationFinalizationFormId;
}
function suppressedAdvisorBonus(branch: CreationCorrectionBranch): number | null {
  if (
    !branch.composition?.instances.some(
      (i) => i.speciesKey === 'ADVISER' && i.status === 'SUPPRESSED',
    )
  )
    return null;
  const physical = branch.advisorOrNull?.physicalRolls.find(
    (r) => r.kind === 'TROGR_SUPPRESSION_B',
  );
  return physical === undefined
    ? (branch.retainedAdvisorOrNull?.suppressionOrNull?.suppressionBOrNull ?? null)
    : calculateTrogrSuppressionBonus(physical.mechanical);
}
function mechanicsForState(
  checkpoint: DurableCreationWizardCheckpoint,
  state: CreationFinalizationState,
  catalog: CreationFinalizationCatalog,
): CreationFinalMechanics | null {
  const branch = finalizationActiveBranch(state);
  if (branch.raceCode === 'PURE' && branch.classCode === null) return null;
  if (branch.raceCode !== 'PURE' && (branch.creationMode === null || branch.composition === null))
    return null;
  const bonus = suppressedAdvisorBonus(branch);
  if (
    branch.composition?.instances.some(
      (i) => i.speciesKey === 'ADVISER' && i.status === 'SUPPRESSED',
    ) &&
    bonus === null
  )
    return null;
  return deriveCreationFinalMechanics(catalog, {
    baseStats: checkpoint.statAssignmentStage!.derived.baseStats,
    raceCode: branch.raceCode,
    classCode: branch.classCode,
    creationMode: branch.creationMode,
    composition: branch.composition,
    learnedSkills: state.learnedSkills,
    advisorSuppressionBonusOrNull: bonus,
    permanentGrants: state.permanentGrants,
    trainingSlotLedger: state.trainingSlotLedger,
  });
}
const blocker = (
  kind: CreationValidationBlocker['kind'],
  code: string,
  message: string,
  returnFormId: CreationValidationBlocker['returnFormId'],
): CreationValidationBlocker => ({ kind, code, message, returnFormId });
export function deriveCreationFinalizationView(
  checkpoint: DurableCreationWizardCheckpoint,
  dependencies: Pick<CreationFinalizationDependencies, 'catalog' | 'finalizationCatalog'> = {
    catalog: canonicalCreationFinalizationCatalog().symbionts,
  },
): CreationFinalizationView {
  const catalog = dependencies.finalizationCatalog ?? canonicalCreationFinalizationCatalog();
  const stage = creationFinalizationStageForCheckpoint(checkpoint, catalog);
  if (stage === null) return guardSymbiontRejected();
  const state = stage.state;
  const activeBranch = finalizationActiveBranch(state);
  const mechanics = mechanicsForState(checkpoint, state, catalog);
  const blockers = [...(mechanics?.blockers ?? [])];
  const bounds = MASS_BOUNDS[activeBranch.raceCode][state.identity.sex];
  const validIdentity = canonicalizeIdentityDraftValues(state.identity, portraitKeys);
  const massValid =
    validIdentity.ok && state.identity.massKg >= bounds[0] && state.identity.massKg <= bounds[1];
  if (!massValid)
    blockers.push(
      blocker(
        'IDENTITY_OR_MASS',
        'MASS_OUTSIDE_CREATION_RANGE',
        'Масса должна соответствовать диапазону выбранных расы и пола.',
        'CHR-001',
      ),
    );
  if (activeBranch.raceCode === 'PURE' && activeBranch.classCode === null)
    blockers.push(
      blocker(
        'RACE_OR_RACE_DEPENDENCIES',
        'PURE_CLASS_REQUIRED',
        'Выберите класс Чистого.',
        'CHR-010',
      ),
    );
  if (activeBranch.raceCode !== 'PURE' && activeBranch.composition === null)
    blockers.push(
      blocker(
        'SYMBIONT_COMPOSITION',
        'COMPOSITION_REQUIRED',
        'Подтвердите состав симбионтов.',
        'CHR-019',
      ),
    );
  const advisor = activeBranch.advisorOrNull;
  if (advisor !== null && !advisor.skillsConfirmed)
    blockers.push(
      blocker(
        'SYMBIONT_COMPOSITION',
        'ADVISOR_CARD_PENDING',
        'Завершите карточку Советника.',
        'CHR-019',
      ),
    );
  if (!activeBranch.bindingsConfirmed)
    blockers.push(
      blocker(
        'SYMBIONT_COMPOSITION',
        'BINDINGS_PENDING',
        'Подтвердите стороны симбионтов.',
        'CHR-019',
      ),
    );
  if (!activeBranch.interactionsConfirmed)
    blockers.push(
      blocker(
        'SYMBIONT_COMPOSITION',
        'INTERACTIONS_PENDING',
        'Подтвердите взаимодействия состава.',
        'CHR-019',
      ),
    );
  if (
    mechanics === null &&
    !blockers.some(
      (b) => b.kind === 'RACE_OR_RACE_DEPENDENCIES' || b.kind === 'SYMBIONT_COMPOSITION',
    )
  )
    blockers.push(
      blocker(
        'SYMBIONT_COMPOSITION',
        'MECHANICS_PENDING',
        'Завершите обязательные данные симбионтов.',
        'CHR-019',
      ),
    );
  collectStartingPropertyReceiptRefs(checkpoint);
  const weapon = checkpoint.startingWeaponStage?.qualityRollRecordOrNull?.request.payload;
  try {
    if (weapon == null) return guardSymbiontRejected();
    canonicalStartingWeaponSelection(
      weapon.weaponTypeId,
      weapon.weaponVariant,
      activeBranch.raceCode,
    );
  } catch {
    blockers.push(
      blocker(
        'RACE_OR_RACE_DEPENDENCIES',
        'STARTING_WEAPON_RACE_MISMATCH',
        'Сохранённое стартовое оружие несовместимо с выбранной расой. Исправьте расу; принятый бросок имущества сохраняется.',
        'CHR-010',
      ),
    );
  }
  const summary = finalizationSummaryRecord(stage);
  const correctionHeadHash = creationCorrectionHeadHash(stage);
  const currentForm = creationFinalizationPresentationForm(checkpoint)!;
  const correction =
    summary !== null &&
    [
      'CHR-001',
      'CHR-009',
      'CHR-010',
      'CHR-011',
      'CHR-015',
      'CHR-017',
      'CHR-018',
      'CHR-019',
      'CHR-020',
      'CHR-041',
      'CHR-042',
    ].includes(currentForm);
  const next = nextCorrection(stage, checkpoint, catalog);
  return {
    compositionConsequencesOrNull: pendingCompositionConsequences(stage, checkpoint, catalog),
    state,
    activeBranch,
    mechanics,
    validationBlockers: blockers,
    identityAndMassStatus: {
      valid: massValid,
      massApprovalStatus: 'PENDING_GM',
      minimumKg: bounds[0],
      maximumKg: bounds[1],
    },
    sevenStatsMinOne: mechanics !== null && !blockers.some((b) => b.kind === 'STATS'),
    skillsAndSlotsStatus: {
      valid: mechanics !== null && !blockers.some((b) => b.kind === 'SKILLS'),
      required:
        mechanics !== null && mechanics.skillStageStats.W >= 1
          ? calculateStartSkillSlots(mechanics.skillStageStats)
          : 0,
      used: state.learnedSkills.reduce((n, s) => n + s.slotCost, 0),
    },
    symbiontCompositionStatus: {
      valid: !blockers.some(
        (b) => b.kind === 'SYMBIONT_COMPOSITION' || b.kind === 'RACE_OR_RACE_DEPENDENCIES',
      ),
    },
    startingPropertyEightReceiptsStatus: {
      valid: !blockers.some((b) => b.code === 'STARTING_WEAPON_RACE_MISMATCH'),
      count: 8,
    },
    cleanRuntimeState: mechanics !== null,
    branchCacheIntegrity: stage.baseHistoryHash === baseHistoryHash(checkpoint),
    finalSaveStatus: stage.finalMechanicsSnapshotOrNull === null ? 'NOT_COMMITTED' : 'COMMITTED',
    summaryReceiptIdOrNull: summary?.receipt.receiptId ?? null,
    correctionHeadHash,
    branchCacheDigest: creationFinalizationHash(state.branches),
    correctionContextOrNull: correction
      ? {
          originFormId: 'CHR-025',
          returnFormId: 'CHR-025',
          sourceFormId: currentForm as CreationCorrectionFormId,
          summaryReceiptId: summary.receipt.receiptId,
          correctionHeadHash,
        }
      : null,
    nextCorrectionFormId: next.formId,
    pendingRollRequestIds: next.pendingRollRequestIds,
    randomStateOrNull: resolveCreationCorrectionBranch(activeBranch, catalog.symbionts),
  };
}

function pendingCompositionConsequences(
  stage: CreationFinalizationStage,
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: CreationFinalizationCatalog,
): CreationFinalizationView['compositionConsequencesOrNull'] {
  const active = finalizationActiveBranch(stage.state);
  if (active.interactionsConfirmed || active.composition === null) return null;
  let state = stage.initialState;
  const before = new Map<
    string,
    {
      beforeCompositionOrNull: CreationCorrectionBranch['composition'];
      beforeMechanicsOrNull: CreationFinalMechanics | null;
    }
  >();
  for (const record of stage.records) {
    if (
      record.request.payload.variant === 'PROPERTY_SUMMARY' ||
      record.request.payload.variant === 'FINAL_SAVE'
    )
      continue;
    const branch = finalizationActiveBranch(state);
    if (
      record.request.payload.variant === 'CORRECTION_MANUAL_COMPOSITION' &&
      !before.has(branch.branchId)
    )
      before.set(branch.branchId, {
        beforeCompositionOrNull: branch.composition,
        beforeMechanicsOrNull: mechanicsForState(checkpoint, state, catalog),
      });
    state = applyCorrection(
      record.request as CreationCorrectionRequest,
      { ...stage, state },
      checkpoint,
      catalog,
      record.physicalRolls,
    );
    const after = finalizationActiveBranch(state);
    if (after.interactionsConfirmed) before.delete(after.branchId);
  }
  const previous = before.get(active.branchId);
  if (previous === undefined) return guardSymbiontRejected();
  return {
    ...previous,
    afterComposition: active.composition,
    afterMechanicsOrNull: mechanicsForState(checkpoint, stage.state, catalog),
  };
}

export function resolveCreationCorrectionBranch(
  branch: CreationCorrectionBranch,
  catalog: SymbiontCatalog,
): ResolvedRandomSymbiontSequence | null {
  if (branch.creationMode !== 'RANDOM' || branch.randomSequenceOrNull === null) return null;
  return resolveCreationCorrectionRandomSequence(catalog, {
    sourceSequenceOrNull: branch.sourceRandomSequenceOrNull,
    sequence: branch.randomSequenceOrNull,
  });
}
function nextCorrection(
  stage: CreationFinalizationStage,
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: CreationFinalizationCatalog,
): { formId: CreationCorrectionFormId | null; pendingRollRequestIds: readonly string[] } {
  const branch = finalizationActiveBranch(stage.state);
  if (branch.raceCode === 'PURE')
    return { formId: branch.classCode === null ? 'CHR-011' : null, pendingRollRequestIds: [] };
  const random = resolveCreationCorrectionBranch(branch, catalog.symbionts);
  if (random !== null && random.nextRequest.kind !== 'COMMITTED')
    return {
      formId: 'CHR-020',
      pendingRollRequestIds:
        random.nextRequest.kind === 'BINDING'
          ? []
          : [
              creationCorrectionId(
                checkpoint.localCharacter.localCharacterId,
                branch.branchId,
                'random',
                branch.randomSequenceOrNull!.physicalRolls.length,
              ),
            ],
    };
  if (branch.composition === null) return { formId: 'CHR-019', pendingRollRequestIds: [] };
  const advisor = branch.advisorOrNull;
  if (advisor !== null) {
    const iw = advisor.physicalRolls.filter(
      (r) => r.kind === 'ADVISOR_I' || r.kind === 'ADVISOR_W',
    );
    if (iw.length !== 2 && branch.retainedAdvisorOrNull?.advisorIwOrNull == null)
      return {
        formId: 'CHR-041',
        pendingRollRequestIds: ['I', 'W'].map((k) =>
          creationCorrectionId(
            checkpoint.localCharacter.localCharacterId,
            advisor.advisorInstanceDraftId,
            k,
          ),
        ),
      };
    if (
      branch.composition.instances.some(
        (i) => i.speciesKey === 'ADVISER' && i.status === 'SUPPRESSED',
      ) &&
      suppressedAdvisorBonus(branch) === null
    )
      return {
        formId: 'CHR-041',
        pendingRollRequestIds: [
          creationCorrectionId(
            checkpoint.localCharacter.localCharacterId,
            advisor.advisorInstanceDraftId,
            'B',
          ),
        ],
      };
    if (!advisor.skillsConfirmed) return { formId: 'CHR-041', pendingRollRequestIds: [] };
  }
  if (!branch.interactionsConfirmed) return { formId: 'CHR-042', pendingRollRequestIds: [] };
  return { formId: null, pendingRollRequestIds: [] };
}
function replacedBranch(
  state: CreationFinalizationState,
  branch: CreationCorrectionBranch,
): CreationFinalizationState {
  return {
    ...state,
    activeBranchId: branch.branchId,
    branches: state.branches.some((b) => b.branchId === branch.branchId)
      ? state.branches.map((b) => (b.branchId === branch.branchId ? branch : b))
      : [...state.branches, branch],
  };
}
function refreshedRandomBranch(
  checkpoint: DurableCreationWizardCheckpoint,
  branch: CreationCorrectionBranch,
  catalog: SymbiontCatalog,
): CreationCorrectionBranch {
  const random = resolveCreationCorrectionBranch(branch, catalog);
  if (random === null) return branch;
  const accepted =
    branch.monsterChoiceOverrideOrNull === null
      ? random.accepted
      : random.accepted.map((a) =>
          a.kind === 'SYMBIOTIC_MONSTER'
            ? { ...a, speciesKey: branch.monsterChoiceOverrideOrNull! }
            : a,
        );
  const composition = resolveSymbiontComposition(catalog, {
    raceCode: branch.raceCode as 'FREE' | 'UNITED',
    acceptedSpecies: accepted.map((a) => ({
      acceptedIndex: a.acceptedIndex,
      speciesKey: a.speciesKey,
    })),
  });
  let advisor = branch.advisorOrNull;
  const advisorAccepted = accepted.find((a) => a.speciesKey === 'ADVISER');
  if (advisorAccepted === undefined) advisor = null;
  else if (advisor === null) {
    const inherited = checkpoint.randomSymbiontStage?.advisorInstanceDraftIdOrNull;
    const inheritedRecord = checkpoint.randomSymbiontStage?.advisorSkillRecordOrNull;
    const original =
      checkpoint.randomSymbiontStage === null
        ? null
        : resolveSymbiontStage(catalog, checkpoint.randomSymbiontStage);
    const sameOriginal =
      original?.accepted.some(
        (a) =>
          a.originRollReceiptId === advisorAccepted.originRollReceiptId &&
          a.speciesKey === 'ADVISER',
      ) === true;
    advisor = {
      advisorInstanceDraftId:
        sameOriginal && inherited != null
          ? inherited
          : creationCorrectionId(
              checkpoint.localCharacter.localCharacterId,
              branch.branchId,
              'adviser',
            ),
      physicalRolls: random.sequence.physicalRolls.filter((r) =>
        ['ADVISOR_I', 'ADVISOR_W', 'TROGR_SUPPRESSION_B'].includes(r.kind),
      ),
      selectedSkills: sameOriginal
        ? (inheritedRecord?.request.payload.selectedSkills ?? []).map((s) => ({
            skillKey: s.skillId,
            targetBonus: s.targetBonus,
          }))
        : [],
      learnedSkills: sameOriginal
        ? ((inheritedRecord?.receipt.result.learnedSkills ?? []) as unknown as readonly {
            skillKey: string;
            bonus: number;
            slotCost: number;
          }[])
        : [],
      skillsConfirmed: sameOriginal && inheritedRecord != null,
    };
  } else
    advisor = {
      ...advisor,
      physicalRolls: [
        ...advisor.physicalRolls,
        ...random.sequence.physicalRolls.filter(
          (r) =>
            ['ADVISOR_I', 'ADVISOR_W', 'TROGR_SUPPRESSION_B'].includes(r.kind) &&
            !advisor!.physicalRolls.some((p) => p.rollReceiptId === r.rollReceiptId),
        ),
      ],
    };
  return {
    ...branch,
    composition,
    advisorOrNull: advisor,
    retainedAccepted: random.accepted,
    retainedAdvisorOrNull: random.advisorOrNull,
    bindings:
      branch.monsterChoiceOverrideOrNull === null
        ? random.drawnSpeciesAndBindings
        : createSymbiontBindingSnapshot(
            catalog,
            accepted.map((a) => ({ acceptedIndex: a.acceptedIndex, speciesKey: a.speciesKey })),
          ),
    bindingsConfirmed: random.randomStatus === 'COMMITTED',
  };
}
function revalidateSelectedSkills(
  checkpoint: DurableCreationWizardCheckpoint,
  state: CreationFinalizationState,
  catalog: SymbiontCatalog,
): CreationFinalizationState {
  const branch = finalizationActiveBranch(state);
  if (branch.raceCode === 'PURE' && branch.classCode === null)
    return { ...state, learnedSkills: state.learnedSkills.filter((s) => s.source === 'SELECTED') };
  const { skillStageStats } = calculateSkillStageStats(catalog.skillStage, {
    baseStats: checkpoint.statAssignmentStage!.derived.baseStats,
    raceCode: branch.raceCode,
    classCode: branch.classCode,
    creationMode: branch.creationMode ?? 'MANUAL',
  });
  // Acquisition uses pre-symbiont stats; retention waits for the confirmed effective body.
  const selected = state.learnedSkills.filter((s) => s.source === 'SELECTED');
  let granted: readonly LearnedSkill[] = [];
  if (skillStageStats.W >= 1)
    granted = validateSkillSelectionDraft(catalog.skillStage, {
      raceCode: branch.raceCode,
      classCode: branch.classCode,
      skillStageStats,
      selectedSkills: [],
    }).learnedSkills;
  return { ...state, learnedSkills: [...granted, ...selected] };
}
function assertCorrection(
  request: CreationCorrectionRequest,
  stage: CreationFinalizationStage,
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: CreationFinalizationCatalog,
): void {
  const p = request.payload;
  const branch = finalizationActiveBranch(stage.state);
  const next = nextCorrection(stage, checkpoint, catalog);
  if (p.variant === 'CORRECTION_RANDOM_ROLL') {
    const random = resolveCreationCorrectionBranch(branch, catalog.symbionts);
    if (
      random === null ||
      next.formId !== 'CHR-020' ||
      next.pendingRollRequestIds[0] !== p.pendingRollRequestId ||
      (checkpoint.statRollStage!.diceInputModeSnapshot === 'AUTO') !== (p.manualFaceOrNull === null)
    )
      return guardSymbiontRejected();
    const monster =
      random.nextRequest.kind === 'CRITICAL_CONFIRMATION' && random.nextRequest.monsterEligible;
    if (
      monster !== (p.selectedMonsterSpeciesKeyOrNull !== null) ||
      (p.selectedMonsterSpeciesKeyOrNull !== null &&
        !['CHIMERA', 'PUPPETEER', 'PLAGUE_DOCTOR'].includes(p.selectedMonsterSpeciesKeyOrNull))
    )
      return guardSymbiontRejected();
  } else if (p.variant === 'CORRECTION_ADVISOR_IW') {
    if (
      branch.creationMode !== 'MANUAL' ||
      next.formId !== 'CHR-041' ||
      next.pendingRollRequestIds.length !== 2 ||
      !isDeepStrictEqual(next.pendingRollRequestIds, p.pendingRollRequestIds) ||
      (checkpoint.statRollStage!.diceInputModeSnapshot === 'AUTO') !==
        (p.manualFacesOrNull === null)
    )
      return guardSymbiontRejected();
    if (
      p.manualFacesOrNull !== null &&
      (!Array.isArray(p.manualFacesOrNull) ||
        p.manualFacesOrNull.length !== 2 ||
        p.manualFacesOrNull.some((f) => !Number.isInteger(f) || f < 1 || f > 20))
    )
      return guardSymbiontRejected();
  } else if (p.variant === 'CORRECTION_ADVISOR_B') {
    if (
      next.formId !== 'CHR-041' ||
      next.pendingRollRequestIds.length !== 1 ||
      next.pendingRollRequestIds[0] !== p.pendingRollRequestId ||
      (checkpoint.statRollStage!.diceInputModeSnapshot === 'AUTO') !== (p.manualFaceOrNull === null)
    )
      return guardSymbiontRejected();
  } else {
    // Every non-random payload is fully evaluated during preflight, before any later sampler.
    applyCorrection(request, stage, checkpoint, catalog, []);
  }
}
function applyCorrectionUnsealed(
  request: CreationCorrectionRequest,
  stage: CreationFinalizationStage,
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: CreationFinalizationCatalog,
  physicalRolls: readonly RandomSymbiontPhysicalRoll[],
): CreationFinalizationState {
  const p = request.payload;
  let state = stage.state;
  let branch = finalizationActiveBranch(state);
  if (p.variant === 'CORRECTION_IDENTITY') {
    const check = canonicalizeIdentityDraftValues(p.identity, portraitKeys);
    if (
      !check.ok ||
      p.identity.sex !== state.identity.sex ||
      p.identity.name === null ||
      p.identity.age === null ||
      p.identity.massKg === null ||
      !isDeepStrictEqual(check.value, p.identity)
    )
      return guardSymbiontRejected();
    return { ...state, identity: p.identity };
  }
  if (p.variant === 'CORRECTION_RACE') {
    const pending = nextCorrection(stage, checkpoint, catalog).formId;
    if (pending === 'CHR-020' || pending === 'CHR-041') return guardSymbiontRejected();
    if (!['PURE', 'FREE', 'UNITED'].includes(p.raceChoice)) return guardSymbiontRejected();
    let locked = state.lockedAcquisitionModeOrNull;
    if (p.raceChoice !== 'PURE' && locked === null) {
      if (
        p.acquisitionModeIfFirstOrNull !== 'MANUAL' &&
        p.acquisitionModeIfFirstOrNull !== 'RANDOM'
      )
        return guardSymbiontRejected();
      locked = p.acquisitionModeIfFirstOrNull;
    } else if (p.acquisitionModeIfFirstOrNull !== null) return guardSymbiontRejected();
    const mode = p.raceChoice === 'PURE' ? null : locked;
    const id = creationCorrectionId(
      checkpoint.localCharacter.localCharacterId,
      'branch',
      p.raceChoice,
      mode ?? 'NONE',
    );
    const cached = state.branches.find((b) => b.branchId === id);
    if (cached !== undefined)
      branch =
        cached.advisorOrNull === null
          ? cached
          : {
              ...cached,
              advisorOrNull:
                state.advisorCards.find(
                  (c) => c.advisorInstanceDraftId === cached.advisorOrNull!.advisorInstanceDraftId,
                ) ?? guardSymbiontRejected(),
            };
    else {
      const sourceBranch =
        state.branches.find(
          (b) =>
            b.creationMode === 'RANDOM' &&
            b.randomSequenceOrNull !== null &&
            b.sourceRandomSequenceOrNull === null,
        ) ?? null;
      const source = sourceBranch?.randomSequenceOrNull ?? null;
      branch = {
        branchId: id,
        raceCode: p.raceChoice,
        creationMode: mode,
        classCode: null,
        composition: null,
        bindings: [],
        retainedAccepted: [],
        retainedAdvisorOrNull: null,
        physicalRolls: [],
        randomSequenceOrNull:
          mode === 'RANDOM'
            ? {
                randomSequenceId: creationCorrectionId(
                  checkpoint.localCharacter.localCharacterId,
                  id,
                  'sequence',
                ),
                raceCode: p.raceChoice as 'FREE' | 'UNITED',
                diceInputModeSnapshot: checkpoint.statRollStage!.diceInputModeSnapshot,
                physicalRolls: [],
                bindingSnapshotOrNull: null,
              }
            : null,
        sourceRandomSequenceOrNull: mode === 'RANDOM' ? source : null,
        monsterChoiceOverrideOrNull: null,
        advisorOrNull:
          mode === 'RANDOM' && sourceBranch?.retainedAccepted[0]?.speciesKey === 'ADVISER'
            ? (state.advisorCards.find(
                (c) =>
                  c.advisorInstanceDraftId === sourceBranch.advisorOrNull?.advisorInstanceDraftId,
              ) ?? sourceBranch.advisorOrNull)
            : null,
        interactionsConfirmed: mode !== 'MANUAL',
        bindingsConfirmed: mode === null,
      };
      if (mode === 'RANDOM') branch = refreshedRandomBranch(checkpoint, branch, catalog.symbionts);
    }
    state = replacedBranch({ ...state, lockedAcquisitionModeOrNull: locked }, branch);
    return revalidateSelectedSkills(checkpoint, state, catalog.symbionts);
  }
  if (p.variant === 'CORRECTION_CLASS') {
    if (
      branch.raceCode !== 'PURE' ||
      !catalog.symbionts.skillStage.classes.some((c) => c.classCode === p.pureClass)
    )
      return guardSymbiontRejected();
    return revalidateSelectedSkills(
      checkpoint,
      replacedBranch(state, { ...branch, classCode: p.pureClass }),
      catalog.symbionts,
    );
  }
  if (p.variant === 'CORRECTION_SKILLS') {
    const stats = calculateSkillStageStats(catalog.symbionts.skillStage, {
      baseStats: checkpoint.statAssignmentStage!.derived.baseStats,
      raceCode: branch.raceCode,
      classCode: branch.classCode,
      creationMode: branch.creationMode ?? 'MANUAL',
    }).skillStageStats;
    const selected = validateSkillSelection(catalog.symbionts.skillStage, {
      raceCode: branch.raceCode,
      classCode: branch.classCode,
      skillStageStats: stats,
      selectedSkills: p.selectedSkills,
    });
    return { ...state, learnedSkills: selected.learnedSkills };
  }
  if (p.variant === 'CORRECTION_MANUAL_COMPOSITION') {
    if (branch.raceCode === 'PURE' || branch.creationMode !== 'MANUAL')
      return guardSymbiontRejected();
    const selected = validateManualSymbiontComposition(catalog.symbionts, {
      raceCode: branch.raceCode,
      acceptedSpecies: p.acceptedSpecies,
      selectedBindings: p.selectedBindings,
    });
    const hasAdvisor = selected.composition.instances.some(
      (i) => i.speciesKey === 'ADVISER' && i.status !== 'ABSORBED' && i.status !== 'DESTROYED',
    );
    const previousAdvisor = branch.advisorOrNull ?? state.advisorCards[0] ?? null;
    const advisor = hasAdvisor
      ? (previousAdvisor ?? {
          advisorInstanceDraftId: creationCorrectionId(
            checkpoint.localCharacter.localCharacterId,
            branch.branchId,
            'adviser',
          ),
          physicalRolls: [],
          selectedSkills: [],
          learnedSkills: [],
          skillsConfirmed: false,
        })
      : null;
    branch = {
      ...branch,
      composition: selected.composition,
      bindings: selected.bindings,
      advisorOrNull: advisor,
      interactionsConfirmed: selected.composition.interactions.length === 0,
      bindingsConfirmed: true,
    };
  } else if (p.variant === 'CORRECTION_RANDOM_ROLL') {
    if (branch.randomSequenceOrNull === null || physicalRolls.length !== 1)
      return guardSymbiontRejected();
    branch = refreshedRandomBranch(
      checkpoint,
      {
        ...branch,
        physicalRolls: [...branch.physicalRolls, ...physicalRolls],
        randomSequenceOrNull: {
          ...branch.randomSequenceOrNull,
          physicalRolls: [...branch.randomSequenceOrNull.physicalRolls, ...physicalRolls],
        },
      },
      catalog.symbionts,
    );
  } else if (p.variant === 'CORRECTION_RANDOM_BINDINGS') {
    const random = resolveCreationCorrectionBranch(branch, catalog.symbionts);
    if (random?.nextRequest.kind !== 'BINDING' || branch.randomSequenceOrNull === null)
      return guardSymbiontRejected();
    const bindings = createSymbiontBindingSnapshot(
      catalog.symbionts,
      random.accepted.map((a) => ({ acceptedIndex: a.acceptedIndex, speciesKey: a.speciesKey })),
      p.selectedBindings,
    );
    branch = refreshedRandomBranch(
      checkpoint,
      {
        ...branch,
        randomSequenceOrNull: { ...branch.randomSequenceOrNull, bindingSnapshotOrNull: bindings },
      },
      catalog.symbionts,
    );
  } else if (p.variant === 'CORRECTION_MONSTER_CHOICE') {
    const random = resolveCreationCorrectionBranch(branch, catalog.symbionts);
    if (
      branch.raceCode !== 'UNITED' ||
      random === null ||
      !random.accepted.some((a) => a.kind === 'SYMBIOTIC_MONSTER') ||
      !['CHIMERA', 'PUPPETEER', 'PLAGUE_DOCTOR'].includes(p.selectedMonsterSpeciesKey)
    )
      return guardSymbiontRejected();
    branch = refreshedRandomBranch(
      checkpoint,
      { ...branch, monsterChoiceOverrideOrNull: p.selectedMonsterSpeciesKey },
      catalog.symbionts,
    );
  } else if (p.variant === 'CORRECTION_ADVISOR_IW' || p.variant === 'CORRECTION_ADVISOR_B') {
    if (
      branch.advisorOrNull === null ||
      physicalRolls.length !== (p.variant === 'CORRECTION_ADVISOR_IW' ? 2 : 1)
    )
      return guardSymbiontRejected();
    branch = {
      ...branch,
      advisorOrNull: {
        ...branch.advisorOrNull,
        physicalRolls: [...branch.advisorOrNull.physicalRolls, ...physicalRolls],
      },
    };
  } else if (p.variant === 'CORRECTION_ADVISOR_SKILLS') {
    const advisor = branch.advisorOrNull;
    if (advisor === null) return guardSymbiontRejected();
    const i = advisor.physicalRolls.find((r) => r.kind === 'ADVISOR_I');
    const w = advisor.physicalRolls.find((r) => r.kind === 'ADVISOR_W');
    const iw =
      i === undefined || w === undefined
        ? (branch.retainedAdvisorOrNull?.advisorIwOrNull ?? null)
        : resolveAdvisorIwRolls([i.mechanical, w.mechanical]);
    const mechanics = mechanicsForState(checkpoint, state, catalog);
    if (iw === null || mechanics === null) return guardSymbiontRejected();
    const selected = validateAdvisorSkillSelection(catalog.symbionts.skillStage, {
      advisorIw: iw,
      bodyStats: {
        S: mechanics.effectiveStats.S,
        D: mechanics.effectiveStats.D,
        M: mechanics.effectiveStats.M,
        Z: mechanics.effectiveStats.Z,
        C: mechanics.effectiveStats.C,
      },
      selectedSkills: p.selectedSkills,
    });
    branch = {
      ...branch,
      advisorOrNull: {
        ...advisor,
        selectedSkills: p.selectedSkills,
        learnedSkills: selected.learnedSkills,
        skillsConfirmed: true,
      },
    };
  } else if (p.variant === 'CORRECTION_INTERACTIONS') {
    if (
      branch.creationMode !== 'MANUAL' ||
      branch.composition === null ||
      branch.interactionsConfirmed ||
      p.compositionHash !== creationFinalizationHash(branch.composition)
    )
      return guardSymbiontRejected();
    branch = { ...branch, interactionsConfirmed: true };
  }
  return replacedBranch(state, branch);
}
function applyCorrection(
  request: CreationCorrectionRequest,
  stage: CreationFinalizationStage,
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: CreationFinalizationCatalog,
  physicalRolls: readonly RandomSymbiontPhysicalRoll[],
): CreationFinalizationState {
  let state = applyCorrectionUnsealed(request, stage, checkpoint, catalog, physicalRolls);
  const cards = new Map(state.advisorCards.map((c) => [c.advisorInstanceDraftId, c]));
  const activeAdvisor = finalizationActiveBranch(state).advisorOrNull;
  if (activeAdvisor !== null) cards.set(activeAdvisor.advisorInstanceDraftId, activeAdvisor);
  state = { ...state, advisorCards: [...cards.values()] };
  return reconcileConfirmedCreationState(
    checkpoint,
    state,
    catalog,
    [
      'CORRECTION_RACE',
      'CORRECTION_CLASS',
      'CORRECTION_MANUAL_COMPOSITION',
      'CORRECTION_INTERACTIONS',
      'CORRECTION_MONSTER_CHOICE',
      'CORRECTION_RANDOM_BINDINGS',
    ].includes(request.payload.variant),
  );
}
/** The original confirmed body and later corrections share permanent retention rules. */
function reconcileConfirmedCreationState(
  checkpoint: DurableCreationWizardCheckpoint,
  initial: CreationFinalizationState,
  catalog: CreationFinalizationCatalog,
  revalidateSkills: boolean,
): CreationFinalizationState {
  let state = initial;
  // A candidate shown in the consequences dialog has not acquired permanent effects.
  if (!finalizationActiveBranch(state).interactionsConfirmed) return state;
  let mechanics = mechanicsForState(checkpoint, state, catalog);
  if (mechanics !== null && revalidateSkills) {
    const retained = revalidateCreationSkillRetention(
      catalog.symbionts.skillStage,
      state.learnedSkills,
      mechanics.effectiveStats,
    );
    state = { ...state, learnedSkills: retained.retained };
    const branch = finalizationActiveBranch(state);
    const advisor = branch.advisorOrNull;
    if (advisor !== null && advisor.skillsConfirmed) {
      const i = advisor.physicalRolls.find((r) => r.kind === 'ADVISOR_I');
      const w = advisor.physicalRolls.find((r) => r.kind === 'ADVISOR_W');
      const iw =
        i !== undefined && w !== undefined
          ? resolveAdvisorIwRolls([i.mechanical, w.mechanical])
          : branch.retainedAdvisorOrNull?.advisorIwOrNull;
      if (iw == null) return guardSymbiontRejected();
      const body = mechanics.effectiveStats;
      const stats = createAdvisorSkillStats({
        advisorIw: iw,
        bodyStats: { S: body.S, D: body.D, M: body.M, Z: body.Z, C: body.C },
      });
      const kept = revalidateCreationSkillRetention(
        catalog.symbionts.skillStage,
        advisor.learnedSkills,
        stats,
      );
      if (kept.removed.length !== 0) {
        const updated = {
          ...advisor,
          learnedSkills: kept.retained,
          selectedSkills: kept.retained.map((s) => ({
            skillKey: s.skillKey,
            targetBonus: s.bonus,
          })),
          skillsConfirmed:
            kept.retained.reduce((n, s) => n + s.slotCost, 0) >= calculateStartSkillSlots(stats),
        };
        state = replacedBranch(state, { ...branch, advisorOrNull: updated });
        state = {
          ...state,
          advisorCards: state.advisorCards.map((c) =>
            c.advisorInstanceDraftId === updated.advisorInstanceDraftId ? updated : c,
          ),
        };
      }
    }
    mechanics = mechanicsForState(checkpoint, state, catalog);
  }
  return mechanics === null
    ? state
    : {
        ...state,
        permanentGrants: mechanics.permanentGrants,
        trainingSlotLedger: mechanics.trainingSlotLedger,
      };
}

function physicalRollsForRequest(
  request: CreationFinalizationRequest,
  stage: CreationFinalizationStage,
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: CreationFinalizationCatalog,
  receiptId: string,
  sample: () => number,
): readonly RandomSymbiontPhysicalRoll[] {
  const p = request.payload;
  const branch = finalizationActiveBranch(stage.state);
  const physical = (
    kind: 'ADVISOR_I' | 'ADVISOR_W' | 'TROGR_SUPPRESSION_B',
    requestId: string,
    id: string,
    face: number,
  ): RandomSymbiontPhysicalRoll => ({
    kind,
    rollRequestId: requestId,
    rollReceiptId: id,
    mechanical: { dieSides: 20, rawFace: face },
    advisorAcceptedIndex: branch.composition!.acceptedSpecies.find(
      (s) => s.speciesKey === 'ADVISER',
    )!.acceptedIndex,
  });
  if (p.variant === 'CORRECTION_RANDOM_ROLL') {
    const next = resolveCreationCorrectionBranch(branch, catalog.symbionts)!.nextRequest;
    if (next.kind === 'COMMITTED' || next.kind === 'BINDING') return guardSymbiontRejected();
    const common = {
      kind: next.kind,
      rollRequestId: p.pendingRollRequestId,
      rollReceiptId: receiptId,
      mechanical: {
        dieSides: 20 as const,
        rawFace: p.manualFaceOrNull ?? sampledSymbiontFace(sample),
      },
    };
    if (next.kind === 'CRITICAL_CONFIRMATION') {
      const origin = branch.randomSequenceOrNull!.physicalRolls.find(
        (r) => r.rollRequestId === next.originRollRequestId,
      );
      if (origin === undefined) return guardSymbiontRejected();
      const outcome = resolveCriticalConfirmation({
        originRoll: origin.mechanical,
        confirmationRolls: [
          ...branch
            .randomSequenceOrNull!.physicalRolls.filter(
              (r) =>
                r.kind === 'CRITICAL_CONFIRMATION' &&
                r.originRollRequestId === next.originRollRequestId,
            )
            .map((r) => r.mechanical),
          common.mechanical,
        ],
      });
      return [
        {
          ...common,
          kind: next.kind,
          originRollRequestId: next.originRollRequestId,
          selectedMonsterSpeciesKeyOrNull:
            outcome.terminal && outcome.criticalGrade > 0 && next.monsterEligible
              ? p.selectedMonsterSpeciesKeyOrNull
              : null,
        },
      ];
    }
    if (next.kind === 'SPECIES_ORIGIN') return [{ ...common, kind: next.kind }];
    return [{ ...common, kind: next.kind, advisorAcceptedIndex: next.advisorAcceptedIndex }];
  }
  if (p.variant === 'CORRECTION_ADVISOR_IW')
    return [
      physical(
        'ADVISOR_I',
        p.pendingRollRequestIds[0],
        receiptId,
        p.manualFacesOrNull?.[0] ?? sampledSymbiontFace(sample),
      ),
      physical(
        'ADVISOR_W',
        p.pendingRollRequestIds[1],
        creationCorrectionId(checkpoint.localCharacter.localCharacterId, receiptId, 'W-receipt'),
        p.manualFacesOrNull?.[1] ?? sampledSymbiontFace(sample),
      ),
    ];
  if (p.variant === 'CORRECTION_ADVISOR_B')
    return [
      physical(
        'TROGR_SUPPRESSION_B',
        p.pendingRollRequestId,
        receiptId,
        p.manualFaceOrNull ?? sampledSymbiontFace(sample),
      ),
    ];
  return [];
}
function stepRecord(
  stage: CreationFinalizationStage,
  request: CreationFinalizationRequest,
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: CreationFinalizationCatalog,
  receiptId: string,
  physicalRolls: readonly RandomSymbiontPhysicalRoll[],
): CreationFinalizationStage {
  const state =
    request.payload.variant === 'PROPERTY_SUMMARY' || request.payload.variant === 'FINAL_SAVE'
      ? stage.state
      : applyCorrection(
          request as CreationCorrectionRequest,
          stage,
          checkpoint,
          catalog,
          physicalRolls,
        );
  const continuation = nextCorrection({ ...stage, state }, checkpoint, catalog);
  const next = continuation.formId;
  const sameRaceContinuation =
    request.payload.variant === 'CORRECTION_RACE' &&
    request.payload.raceChoice === finalizationActiveBranch(stage.state).raceCode
      ? finalizationActiveBranch(state).raceCode === 'PURE'
        ? 'CHR-011'
        : finalizationActiveBranch(state).creationMode === 'MANUAL'
          ? 'CHR-019'
          : finalizationActiveBranch(state).retainedAccepted.some(
                (a) => a.kind === 'SYMBIOTIC_MONSTER',
              )
            ? 'CHR-020'
            : null
      : null;
  const nextFormId =
    request.payload.variant === 'FINAL_SAVE'
      ? 'CHR-040'
      : request.payload.variant === 'PROPERTY_SUMMARY'
        ? next === 'CHR-041' && continuation.pendingRollRequestIds.length === 0
          ? 'CHR-041'
          : 'CHR-025'
        : (sameRaceContinuation ?? next ?? 'CHR-025');
  const record: CreationFinalizationRecord = {
    request,
    physicalRolls,
    afterStateHash: creationFinalizationHash(state),
    receipt: {
      commandId: request.commandId,
      receiptId,
      revisions: incrementedSymbiontRevisions(request.expectedRevisions),
      result: {
        stage: 'FINALIZATION',
        variant: request.payload.variant,
        sourceFormId: request.payload.sourceFormId,
        characterDraftId: request.payload.characterDraftId,
        checkpointOwnerId: request.payload.characterDraftId,
        checkpointId: request.payload.wizardCheckpointId,
        checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
        draftRevision: request.payload.draftRevision + 1,
        branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
        correctionHeadHash: 'pending',
        branchCacheDigest: creationFinalizationHash(state.branches),
        finalSaveStatus: request.payload.variant === 'FINAL_SAVE' ? 'COMMITTED' : 'NOT_COMMITTED',
        mechanicsSnapshotHashOrNull: null,
        nextFormId,
        ...(physicalRolls.length === 0
          ? {}
          : {
              physicalRolls: physicalRolls.map((r) => ({
                kind: r.kind,
                rollRequestId: r.rollRequestId,
                rollReceiptId: r.rollReceiptId,
                mechanical: { dieSides: 20 as const, rawFace: r.mechanical.rawFace },
              })),
            }),
      },
    },
    nextStageEnvelope: nextSymbiontEnvelope(nextFormId, request.payload.characterDraftId),
  };
  let updated = { ...stage, state, records: [...stage.records, record] };
  const head = creationCorrectionHeadHash(updated);
  let snapshot = stage.finalMechanicsSnapshotOrNull;
  if (request.payload.variant === 'FINAL_SAVE') {
    const mechanics = mechanicsForState(checkpoint, state, catalog);
    if (mechanics === null) return guardSymbiontRejected();
    const branch = finalizationActiveBranch(state);
    const identity = {
      ...state.identity,
      artAssetKeyOrLocalFile: state.identity.artAssetKeyOrLocalFile ?? {
        kind: 'asset-key' as const,
        assetKey: PORTRAITS[branch.raceCode][state.identity.sex],
      },
    };
    snapshot = {
      characterId: checkpoint.localCharacter.localCharacterId,
      identity,
      branch,
      mechanics,
      propertyRollReceipts: collectStartingPropertyReceiptRefs(checkpoint),
      propertySummary: deriveStartingPropertySummary(checkpoint),
      correctionHeadHash: head,
    };
  }
  const receipt: CreationFinalizationReceipt = {
    ...record.receipt,
    result: {
      ...record.receipt.result,
      correctionHeadHash: head,
      mechanicsSnapshotHashOrNull: snapshot === null ? null : creationFinalizationHash(snapshot),
    },
  };
  updated = {
    ...updated,
    records: [...stage.records, { ...record, receipt }],
    finalMechanicsSnapshotOrNull: snapshot,
  };
  return updated;
}
export function preflightCreationFinalization(
  database: Database.Database,
  incoming: DecodedRequest,
  dependencies: CreationFinalizationDependencies,
  receiptId?: string,
) {
  if (receiptId !== undefined && (typeof receiptId !== 'string' || receiptId.length === 0))
    return guardSymbiontRejected();
  const request = normalizeCreationFinalizationRequest(incoming);
  assertNoPreviousSymbiontCommand(database, dependencies.catalog, request);
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    request.payload.characterDraftId,
    dependencies.catalog.skillStage,
    dependencies.catalog,
  );
  assertCommonSymbiont(
    checkpoint,
    request,
    request.payload.characterDraftId,
    request.payload.wizardCheckpointId,
    request.payload.draftRevision,
    receiptId,
    {
      allowArmorBundleStage: true,
      allowStartingWeaponStage: true,
      allowWeaponProfileStage: true,
      allowStartingMoneyStage: true,
      allowFiveStartingPositionsStage: true,
      allowFinalizationStage: true,
    },
  );
  const catalog = dependencies.finalizationCatalog ?? canonicalCreationFinalizationCatalog();
  const stage = creationFinalizationStageForCheckpoint(checkpoint, catalog);
  if (
    stage === null ||
    stage.finalMechanicsSnapshotOrNull !== null ||
    checkpoint.localCharacter.lifecycleState !== 'DRAFT' ||
    creationFinalizationPresentationForm(checkpoint) !== request.payload.sourceFormId
  )
    return guardSymbiontRejected();
  const summary = finalizationSummaryRecord(stage);
  try {
    if (request.payload.variant === 'PROPERTY_SUMMARY') {
      if (
        summary !== null ||
        request.payload.propertyCheckpointReceiptId !== stage.entryReceipt.receiptId
      )
        return guardSymbiontRejected();
      validateStartingPropertyReceiptRefs(checkpoint, request.payload.propertyRollReceipts);
    } else {
      if (
        summary === null ||
        request.payload.summaryReceiptId !== summary.receipt.receiptId ||
        request.payload.correctionHeadHash !== creationCorrectionHeadHash(stage)
      )
        return guardSymbiontRejected();
      if (request.payload.variant === 'FINAL_SAVE') {
        const view = deriveCreationFinalizationView(checkpoint, dependencies);
        if (
          view.validationBlockers.length !== 0 ||
          view.mechanics === null ||
          !view.branchCacheIntegrity ||
          !view.cleanRuntimeState
        )
          return guardSymbiontRejected();
      } else assertCorrection(request as CreationCorrectionRequest, stage, checkpoint, catalog);
    }
    const occupied = creationWizardDurableIds(checkpoint);
    const own =
      checkpoint.finalizationStage == null
        ? new Set<string>()
        : creationFinalizationStageIds(checkpoint.finalizationStage);
    const checkPotentialAdvisorIds = (state: CreationFinalizationState) => {
      for (const branch of state.branches)
        if (branch.creationMode !== null) {
          const id = creationCorrectionId(
            checkpoint.localCharacter.localCharacterId,
            branch.branchId,
            'adviser',
          );
          if (!own.has(id) && (occupied.has(id) || id === request.commandId || id === receiptId))
            return guardSymbiontRejected();
        }
    };
    checkPotentialAdvisorIds(stage.state);
    for (const id of creationFinalizationStageIds(stage))
      if (!own.has(id) && (occupied.has(id) || id === request.commandId || id === receiptId))
        return guardSymbiontRejected();
    const nextPending = nextCorrection(stage, checkpoint, catalog).pendingRollRequestIds;
    if (
      new Set(nextPending).size !== nextPending.length ||
      nextPending.some((id) => occupied.has(id) || id === request.commandId || id === receiptId)
    )
      return guardSymbiontRejected();
    if (
      ![
        'PROPERTY_SUMMARY',
        'FINAL_SAVE',
        'CORRECTION_RANDOM_ROLL',
        'CORRECTION_ADVISOR_IW',
        'CORRECTION_ADVISOR_B',
      ].includes(request.payload.variant)
    ) {
      const preview = applyCorrection(
        request as CreationCorrectionRequest,
        stage,
        checkpoint,
        catalog,
        [],
      );
      checkPotentialAdvisorIds(preview);
      for (const id of creationFinalizationStageIds({ ...stage, state: preview }))
        if (!own.has(id) && (occupied.has(id) || id === request.commandId || id === receiptId))
          return guardSymbiontRejected();
      const pending = nextCorrection(
        { ...stage, state: preview },
        checkpoint,
        catalog,
      ).pendingRollRequestIds;
      if (pending.some((id) => occupied.has(id) || id === request.commandId || id === receiptId))
        return guardSymbiontRejected();
    }
    if (receiptId !== undefined) {
      if (request.payload.variant === 'CORRECTION_RANDOM_ROLL') {
        const branch = finalizationActiveBranch(stage.state);
        const futureId = creationCorrectionId(
          checkpoint.localCharacter.localCharacterId,
          branch.branchId,
          'random',
          branch.randomSequenceOrNull!.physicalRolls.length + 1,
        );
        if (occupied.has(futureId) || futureId === request.commandId || futureId === receiptId)
          return guardSymbiontRejected();
      }
      const candidates = physicalRollsForRequest(
        request,
        stage,
        checkpoint,
        catalog,
        receiptId,
        () => 1,
      );
      const ids = candidates.flatMap((r) => [
        r.rollRequestId,
        ...(r.rollReceiptId === receiptId ? [] : [r.rollReceiptId]),
      ]);
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => occupied.has(id) || id === request.commandId || id === receiptId)
      )
        return guardSymbiontRejected();
    }
  } catch {
    return guardSymbiontRejected();
  }
  return { request, checkpoint, stage, catalog };
}
function writePresentation(
  database: Database.Database,
  checkpoint: DurableCreationWizardCheckpoint,
  formId: CreationFinalizationFormId,
  projectionRevision: number,
  draftRevision: number,
  speciesKeyOrNull?: string | null,
): void {
  const bindings =
    formId === 'CHR-018'
      ? [
          {
            parameterIndex: 0,
            source: 'inherited' as const,
            value: checkpoint.localCharacter.localCharacterId,
          },
          {
            parameterIndex: 1,
            source: 'client-selected' as const,
            value: speciesKeyOrNull ?? guardSymbiontRejected(),
          },
        ]
      : [
          {
            parameterIndex: 0,
            source: 'inherited' as const,
            value: checkpoint.localCharacter.localCharacterId,
          },
        ];
  writeLocalCharacterSymbiontPresentation(database, {
    formId,
    compositionDraftRevision: draftRevision,
    projectionRevision,
    routeBindings: bindings,
    routeTemplate: `/player/characters/:localCharacterId/create/${formId.toLowerCase()}${formId === 'CHR-018' ? '/:speciesKey' : ''}`,
  });
}
export function commitCreationFinalization(
  database: Database.Database,
  incoming: DecodedRequest,
  receiptId: string,
  dependencies: CreationFinalizationDependencies,
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0)
    throw new TypeError('finalization receiptId must be non-empty');
  const normalized = normalizeCreationFinalizationRequest(incoming);
  preflightCreationFinalization(database, normalized, dependencies, receiptId);
  let validated: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const { request, checkpoint, stage, catalog } = preflightCreationFinalization(
        database,
        normalized,
        dependencies,
        receiptId,
      );
      const physicalRolls = physicalRollsForRequest(
        request,
        stage,
        checkpoint,
        catalog,
        receiptId,
        dependencies.sampleD20,
      );
      const nextStage = stepRecord(stage, request, checkpoint, catalog, receiptId, physicalRolls);
      creationFinalizationStageIds(nextStage);
      const latest = latestCreationFinalizationRecord(nextStage) as CreationFinalizationRecord;
      const payload = checkpoint.durablePayload as CreationWizardSymbiontPayload;
      const saved = update(
        {
          payloadJson: JSON.stringify({
            ...payload,
            finalizationStage: nextStage,
            receipt: latest.receipt,
            nextStageEnvelope: latest.nextStageEnvelope,
            randomReceiptIds:
              checkpoint.statRollStage!.diceInputModeSnapshot === 'AUTO'
                ? [...payload.randomReceiptIds, ...physicalRolls.map((r) => r.rollReceiptId)]
                : payload.randomReceiptIds,
          }),
          ...(request.payload.variant === 'FINAL_SAVE' ? { lifecycleState: 'FINAL' as const } : {}),
        },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      writePresentation(
        database,
        checkpoint,
        latest.receipt.result.nextFormId === 'CHR-040'
          ? 'CHR-025'
          : latest.receipt.result.nextFormId,
        latest.receipt.revisions.projectionRevision,
        latest.receipt.result.draftRevision,
      );
      return saved;
    },
    () => {
      validated = loadCreationWizardCheckpoint(
        database,
        normalized.payload.characterDraftId,
        dependencies.catalog.skillStage,
        dependencies.catalog,
      );
    },
  );
  if (validated === undefined)
    throw new Error('finalization post-write validation was not executed');
  return validated;
}
export function advanceCreationFinalizationPresentation(
  database: Database.Database,
  input: {
    readonly characterDraftId: string;
    readonly wizardCheckpointId: string;
    readonly formId: CreationFinalizationFormId;
    readonly speciesKeyOrNull?: string | null;
  },
  catalog: SymbiontCatalog,
): DurableCreationWizardCheckpoint {
  const check = () => {
    const checkpoint = loadCreationWizardCheckpoint(
      database,
      input.characterDraftId,
      catalog.skillStage,
      catalog,
    );
    const stage = creationFinalizationStageForCheckpoint(checkpoint);
    if (
      stage === null ||
      stage.finalMechanicsSnapshotOrNull !== null ||
      checkpoint.checkpoint.checkpointId !== input.wizardCheckpointId ||
      checkpoint.localCharacter.projectionRevision === Number.MAX_SAFE_INTEGER
    )
      return guardSymbiontRejected();
    const source = creationFinalizationPresentationForm(checkpoint);
    const view = deriveCreationFinalizationView(checkpoint, { catalog });
    const target = input.formId;
    let permitted: boolean;
    if (source === 'CHR-025')
      permitted =
        target === 'CHR-001' ||
        target === 'CHR-010' ||
        view.validationBlockers.some((b) => b.returnFormId === target);
    else if (
      ['CHR-032', 'CHR-021', 'CHR-022', 'CHR-023', 'CHR-024', 'CHR-038', 'CHR-037'].includes(
        source!,
      )
    ) {
      const paths: Record<string, readonly string[]> = {
        'CHR-032': ['CHR-021', 'CHR-022', 'CHR-038', 'CHR-037'],
        'CHR-021': ['CHR-022'],
        'CHR-022': [checkpoint.weaponProfileStage?.kind === 'FORMULA' ? 'CHR-023' : 'CHR-024'],
        'CHR-023': ['CHR-038'],
        'CHR-024': ['CHR-038'],
        'CHR-038': ['CHR-037'],
        'CHR-037': ['CHR-032'],
      };
      permitted = paths[source!]?.includes(target) === true;
      if (source === 'CHR-032' && target === 'CHR-025' && finalizationSummaryRecord(stage) !== null)
        permitted = true;
    } else {
      const paths: Record<string, readonly string[]> = {
        'CHR-001': ['CHR-025'],
        'CHR-009': ['CHR-010', 'CHR-025'],
        'CHR-010': ['CHR-025'],
        'CHR-011': ['CHR-025'],
        'CHR-015': ['CHR-025'],
        'CHR-017': ['CHR-018', 'CHR-019', 'CHR-020', 'CHR-015', 'CHR-025'],
        'CHR-018': ['CHR-017'],
        'CHR-019': ['CHR-017', 'CHR-042', 'CHR-025'],
        'CHR-020': ['CHR-025'],
        'CHR-041': ['CHR-025'],
        'CHR-042': ['CHR-019'],
      };
      permitted = paths[source!]?.includes(target) === true;
      if (target === 'CHR-018' && view.activeBranch.creationMode !== 'MANUAL') permitted = false;
      if (target === 'CHR-020' && view.activeBranch.creationMode !== 'RANDOM') permitted = false;
      if (
        target === 'CHR-042' &&
        (view.activeBranch.creationMode !== 'MANUAL' || view.activeBranch.interactionsConfirmed)
      )
        permitted = false;
    }
    if (
      (source === 'CHR-020' || source === 'CHR-041') &&
      target === 'CHR-025' &&
      (view.nextCorrectionFormId === 'CHR-020' || view.nextCorrectionFormId === 'CHR-041')
    )
      permitted = false;
    if (!permitted) return guardSymbiontRejected();
    return checkpoint;
  };
  check();
  let validated: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    input.characterDraftId,
    input.wizardCheckpointId,
    (update) => {
      const current = check();
      writePresentation(
        database,
        current,
        input.formId,
        current.localCharacter.projectionRevision + 1,
        current.receipt.result.draftRevision,
        input.speciesKeyOrNull,
      );
      return update(
        { payloadJson: current.localCharacter.payloadJson },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
      );
    },
    () => {
      validated = loadCreationWizardCheckpoint(
        database,
        input.characterDraftId,
        catalog.skillStage,
        catalog,
      );
    },
  );
  return validated ?? guardSymbiontRejected();
}
export function validateCreationFinalizationStageHistory(
  stage: CreationFinalizationStage,
  context: ArmorBundleValidationContext,
  onValidatedState?: (state: CreationFinalizationState, savedAtRevision: number) => void,
) {
  const view = context.checkpointView;
  const catalog = canonicalCreationFinalizationCatalog();
  const initial = creationFinalizationStageForCheckpoint(
    { ...view, finalizationStage: null },
    catalog,
  );
  if (
    initial === null ||
    context.cursor.latestEnvelope.formId !== 'CHR-032' ||
    stage.baseHistoryHash !== initial.baseHistoryHash ||
    !isDeepStrictEqual(stage.entryRequest, initial.entryRequest) ||
    !isDeepStrictEqual(stage.entryReceipt, initial.entryReceipt) ||
    !isDeepStrictEqual(stage.initialState, initial.initialState)
  )
    return guardSymbiontRejected();
  for (const id of creationFinalizationStageIds(stage)) {
    if (context.occupiedIds.has(id)) return guardSymbiontRejected();
    context.occupiedIds.add(id);
  }
  let cursor = context.cursor;
  let reconstructed = initial;
  const versions = [
    { state: initial.state, savedAtRevision: initial.entryReceipt.result.draftRevision },
  ];
  for (const record of stage.records) {
    const request = normalizeCreationFinalizationRequest(record.request);
    const p = request.payload;
    if (
      reconstructed.finalMechanicsSnapshotOrNull !== null ||
      p.characterDraftId !== context.localCharacter.localCharacterId ||
      p.wizardCheckpointId !== context.checkpoint.checkpointId ||
      p.draftRevision !== cursor.draftRevision ||
      !manualNavigationRevisionsMatch(request.expectedRevisions, cursor.revisions) ||
      context.commandIds.has(request.commandId) ||
      context.receiptIds.has(record.receipt.receiptId)
    )
      return guardSymbiontRejected();
    const atCursor = {
      ...view,
      finalizationStage: reconstructed,
      receipt: cursor.latestReceipt,
      request: cursor.latestRequest,
      nextStageEnvelope: cursor.latestEnvelope,
      checkpoint: { ...context.checkpoint, checkpointRevision: cursor.checkpointRevision },
    };
    if (p.variant === 'PROPERTY_SUMMARY') {
      if (
        reconstructed.records.length !== 0 ||
        p.propertyCheckpointReceiptId !== initial.entryReceipt.receiptId
      )
        return guardSymbiontRejected();
      validateStartingPropertyReceiptRefs(atCursor, p.propertyRollReceipts);
    } else {
      if (
        p.summaryReceiptId !== finalizationSummaryRecord(reconstructed)?.receipt.receiptId ||
        p.correctionHeadHash !== creationCorrectionHeadHash(reconstructed)
      )
        return guardSymbiontRejected();
      if (p.variant === 'FINAL_SAVE') {
        const validation = deriveCreationFinalizationView(atCursor, {
          catalog: context.catalog,
          finalizationCatalog: catalog,
        });
        if (validation.validationBlockers.length !== 0 || validation.mechanics === null)
          return guardSymbiontRejected();
      } else
        assertCorrection(request as CreationCorrectionRequest, reconstructed, atCursor, catalog);
    }
    let index = 0;
    const expectedPhysical = physicalRollsForRequest(
      request,
      reconstructed,
      atCursor,
      catalog,
      record.receipt.receiptId,
      () => record.physicalRolls[index++]?.mechanical.rawFace ?? guardSymbiontRejected(),
    );
    if (!isDeepStrictEqual(expectedPhysical, record.physicalRolls)) return guardSymbiontRejected();
    reconstructed = stepRecord(
      reconstructed,
      request,
      atCursor,
      catalog,
      record.receipt.receiptId,
      record.physicalRolls,
    );
    const expected = latestCreationFinalizationRecord(reconstructed) as CreationFinalizationRecord;
    if (!isDeepStrictEqual(expected, record)) return guardSymbiontRejected();
    versions.push({
      state: reconstructed.state,
      savedAtRevision: record.receipt.result.draftRevision,
    });
    context.commandIds.add(request.commandId);
    context.receiptIds.add(record.receipt.receiptId);
    cursor = {
      checkpointRevision: cursor.checkpointRevision + 1,
      draftRevision: cursor.draftRevision + 1,
      latestEnvelope: record.nextStageEnvelope,
      latestRequest: request,
      latestReceipt: record.receipt,
      revisions: record.receipt.revisions,
    };
  }
  if (!isDeepStrictEqual(reconstructed, stage)) return guardSymbiontRejected();
  for (const version of versions)
    onValidatedState?.(structuredClone(version.state), version.savedAtRevision);
  return { cursor };
}

/** Immutable versions emitted only after the complete durable history and deterministic replay pass. */
export function validatedCreationFinalizationVersions(
  source: DurableCreationWizardCheckpoint,
): readonly {
  readonly state: CreationFinalizationState;
  readonly savedAtRevision: number;
}[] {
  const catalog = canonicalCreationFinalizationCatalog();
  const checkpoint = validateDurableCreationWizardCheckpoint(
    source.localCharacter,
    source.checkpoint,
    catalog.symbionts.skillStage,
    catalog.symbionts,
    source.skillPresentationStage ?? undefined,
    source.symbiontPresentationStage ?? undefined,
  );
  const stage = creationFinalizationStageForCheckpoint(checkpoint, catalog);
  if (stage === null) return [];
  const entry = checkpoint.fiveStartingPositionsStage!.checkpointRecordOrNull!;
  const versions: { state: CreationFinalizationState; savedAtRevision: number }[] = [];
  validateCreationFinalizationStageHistory(
    stage,
    {
      catalog: catalog.symbionts,
      localCharacter: checkpoint.localCharacter,
      checkpoint: checkpoint.checkpoint,
      checkpointView: checkpoint,
      commandIds: new Set(),
      receiptIds: new Set(),
      occupiedIds: new Set(),
      cursor: {
        checkpointRevision: entry.receipt.result.checkpointRevision,
        draftRevision: entry.receipt.result.draftRevision,
        revisions: entry.receipt.revisions,
        latestEnvelope: entry.nextStageEnvelope,
        latestRequest: entry.request,
        latestReceipt: entry.receipt,
      },
    },
    (state, savedAtRevision) => versions.push({ state, savedAtRevision }),
  );
  return versions;
}
