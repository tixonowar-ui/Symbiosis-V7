import {
  initializePureComposition,
  isHistoricPureSkillCheckpoint,
} from './creation-pure-composition.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type Database from 'better-sqlite3';

import type { ClientToHostMessage, CommandRefusal, RevisionVector } from '@shared/wire-protocol.js';

import type { SkillStageCatalog, SymbiontCatalog } from '../domain/index.js';
import {
  commitLocalCharacterCheckpoint,
  writeLocalCharacterSkillPresentation,
  writeLocalCharacterSymbiontPresentation,
} from '../persistence/index.js';
import {
  creationWizardDurableIds,
  currentCreationWizardRevisions,
  loadCreationWizardCheckpoint,
  type CreationNextStageEnvelope,
  type CreationWizardSkillPayload,
  type CreationWizardSymbiontPayload,
  type CreationWizardStatAssignmentPayload,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  commitCreationSymbiontAdvisor,
  initialSymbiontStageForWizard,
  preflightCreationSymbiontAdvisor,
} from './creation-symbiont-commands.js';
import {
  commitManualComposition,
  preflightManualComposition,
} from './creation-manual-composition.js';
import {
  normalizeManualCompositionCheckpointRequest,
  type ManualCompositionCheckpointCommandRequest,
} from './creation-manual-composition-contract.js';
import {
  commitManualAdvisorSkills,
  preflightManualAdvisorSkills,
} from './creation-manual-advisor.js';
import {
  normalizeManualAdvisorSkillCheckpointRequest,
  type ManualAdvisorSkillCheckpointCommandRequest,
} from './creation-manual-advisor-contract.js';
import {
  CreationSymbiontApplicationError,
  normalizeSymbiontAdvisorCheckpointRequest,
  type SymbiontAdvisorCheckpointCommandRequest,
} from './creation-symbiont-contract.js';
import {
  commitArmorBundleCheckpoint,
  commitArmorBundleEntry,
  preflightArmorBundleCheckpoint,
  preflightArmorBundleEntry,
} from './creation-armor-bundle.js';
import {
  normalizeArmorBundleCheckpointRequest,
  normalizeArmorBundleEntryRequest,
  type ArmorBundleCheckpointRequest,
  type ArmorBundleEntryRequest,
} from './creation-armor-bundle-contract.js';
import {
  commitStartingWeaponEntry,
  commitStartingWeaponCheckpoint,
  preflightStartingWeaponEntry,
  preflightStartingWeaponCheckpoint,
} from './creation-starting-weapon.js';
import {
  normalizeStartingWeaponEntryRequest,
  normalizeStartingWeaponCheckpointRequest,
  type StartingWeaponEntryRequest,
  type StartingWeaponCheckpointRequest,
} from './creation-starting-weapon-contract.js';
import type { StartingWeaponItemCatalog } from './starting-weapon-catalog.js';
import {
  CreationStatAssignmentApplicationError,
  normalizeStatAssignmentCheckpointRequest,
  prepareStatAssignment,
  type StatAssignmentCheckpointCommandRequest,
  type StatAssignmentCheckpointReceipt,
  type StatAssignmentPlan,
  type StatAssignmentStage,
} from './creation-stat-assignment.js';
import {
  createSkillPresentationStage,
  prepareSkillCardAdditionFromCheckpoint,
} from './creation-skill-card.js';
import {
  CreationSkillSelectionApplicationError,
  normalizeSkillCheckpointRequest,
  prepareSkillEligibility,
  prepareSkillSelection,
  type SkillCardAdditionCheckpointPayload,
  type SkillCardAdditionRecord,
  type SkillCheckpointCommandRequest,
  type SkillEligibilityCheckpointPayload,
  type SkillEligibilityCheckpointReceipt,
  type SkillEligibilityPlan,
  type SkillEligibilityStage,
  type SkillSelectionCheckpointPayload,
  type SkillSelectionCheckpointReceipt,
  type SkillSelectionPlan,
  type SkillSelectionStage,
} from './creation-skill-selection.js';
import {
  commitIdentityCheckpoint,
  EMPTY_IDENTITY_BRANCH_CACHE_HASH,
  IdentityCheckpointApplicationError,
  normalizeIdentityCheckpointRequest,
  validateIdentityCheckpointRequest,
  type IdentityCheckpointCommandRequest,
} from './identity-checkpoint.js';

type DecodedCommandRequest = Extract<
  ClientToHostMessage,
  { readonly messageType: 'command.request' }
>;
type CreationCatalog = SkillStageCatalog | SymbiontCatalog;
function baseCatalog(catalog: CreationCatalog): SkillStageCatalog;
function baseCatalog(catalog: undefined): undefined;
function baseCatalog(catalog: CreationCatalog | undefined): SkillStageCatalog | undefined;
function baseCatalog(catalog: CreationCatalog | undefined): SkillStageCatalog | undefined {
  return catalog === undefined ? undefined : 'skillStage' in catalog ? catalog.skillStage : catalog;
}
const fullSymbiontCatalog = (catalog: CreationCatalog | undefined): SymbiontCatalog | undefined =>
  catalog !== undefined && 'skillStage' in catalog ? catalog : undefined;

export const CREATION_WIZARD_CHECKPOINT_STAGES = Object.freeze([
  'IDENTITY',
  'STAT_ASSIGNMENT',
  'SKILLS',
  'SYMBIONTS',
] as const);

export type CreationWizardCheckpointCommandRequest =
  | IdentityCheckpointCommandRequest
  | StatAssignmentCheckpointCommandRequest
  | SkillCheckpointCommandRequest
  | SymbiontAdvisorCheckpointCommandRequest
  | ManualCompositionCheckpointCommandRequest
  | ManualAdvisorSkillCheckpointCommandRequest
  | ArmorBundleEntryRequest
  | ArmorBundleCheckpointRequest
  | StartingWeaponEntryRequest
  | StartingWeaponCheckpointRequest;

export type CreationWizardCheckpointPreflight =
  | {
      readonly stage: 'IDENTITY';
      readonly request: IdentityCheckpointCommandRequest;
    }
  | {
      readonly stage: 'STAT_ASSIGNMENT';
      readonly request: StatAssignmentCheckpointCommandRequest;
      readonly checkpoint: DurableCreationWizardCheckpoint;
      readonly plan: StatAssignmentPlan;
    }
  | {
      readonly stage: 'SKILLS';
      readonly request: SkillCheckpointCommandRequest;
      readonly checkpoint: DurableCreationWizardCheckpoint;
      readonly plan: SkillEligibilityPlan | SkillSelectionPlan;
    }
  | {
      readonly stage: 'SYMBIONTS';
      readonly request:
        | SymbiontAdvisorCheckpointCommandRequest
        | ManualCompositionCheckpointCommandRequest
        | ManualAdvisorSkillCheckpointCommandRequest
        | ArmorBundleEntryRequest
        | ArmorBundleCheckpointRequest
        | StartingWeaponEntryRequest
        | StartingWeaponCheckpointRequest;
      readonly checkpoint: DurableCreationWizardCheckpoint;
    };

export class CreationWizardCheckpointApplicationError extends Error {
  constructor(readonly refusal: CommandRefusal) {
    super(`creation wizard checkpoint request refused: ${JSON.stringify(refusal)}`);
  }
}

const guardRejected = (): never => {
  throw new CreationWizardCheckpointApplicationError({ code: 'GUARD_REJECTED' });
};

const translate = (cause: unknown): never => {
  if (
    cause instanceof IdentityCheckpointApplicationError ||
    cause instanceof CreationStatAssignmentApplicationError ||
    cause instanceof CreationSkillSelectionApplicationError ||
    cause instanceof CreationSymbiontApplicationError
  ) {
    throw new CreationWizardCheckpointApplicationError(cause.refusal);
  }
  throw cause;
};

const CHECKPOINT_STAGE_NORMALIZERS = {
  IDENTITY: normalizeIdentityCheckpointRequest,
  STAT_ASSIGNMENT: normalizeStatAssignmentCheckpointRequest,
  SKILLS: normalizeSkillCheckpointRequest,
  SYMBIONTS: (request: DecodedCommandRequest) => {
    const sourceFormId =
      request.payload !== null &&
      typeof request.payload === 'object' &&
      !Array.isArray(request.payload)
        ? (request.payload as Record<string, unknown>)['sourceFormId']
        : undefined;
    const variant =
      request.payload !== null &&
      typeof request.payload === 'object' &&
      !Array.isArray(request.payload)
        ? (request.payload as Record<string, unknown>)['variant']
        : undefined;
    if (variant === 'ARMOR_BUNDLE_ENTRY') return normalizeArmorBundleEntryRequest(request);
    if (variant === 'STARTING_WEAPON_ENTRY') return normalizeStartingWeaponEntryRequest(request);
    if (variant === 'STARTING_WEAPON_CHECKPOINT')
      return normalizeStartingWeaponCheckpointRequest(request);
    if (variant === 'ARMOR_BUNDLE_CHECKPOINT')
      return normalizeArmorBundleCheckpointRequest(request);
    if (sourceFormId === 'CHR-018') return normalizeManualCompositionCheckpointRequest(request);
    return sourceFormId === 'CHR-041' && variant === 'MANUAL_ADVISOR_SKILLS'
      ? normalizeManualAdvisorSkillCheckpointRequest(request)
      : normalizeSymbiontAdvisorCheckpointRequest(request);
  },
} as const satisfies Record<
  (typeof CREATION_WIZARD_CHECKPOINT_STAGES)[number],
  (request: DecodedCommandRequest) => CreationWizardCheckpointCommandRequest
>;

export function normalizeCreationWizardCheckpointRequest(
  request: DecodedCommandRequest,
): CreationWizardCheckpointCommandRequest {
  const payload = request.payload;
  const stage =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)['stage']
      : undefined;
  try {
    if (stage === undefined || typeof stage !== 'string') {
      return CHECKPOINT_STAGE_NORMALIZERS.IDENTITY(request);
    }
    if (!(CREATION_WIZARD_CHECKPOINT_STAGES as readonly string[]).includes(stage)) {
      throw new CreationWizardCheckpointApplicationError({
        code: 'UNRECOGNIZED',
        path: '$.payload.stage',
        value: stage,
      });
    }
    return CHECKPOINT_STAGE_NORMALIZERS[
      stage as (typeof CREATION_WIZARD_CHECKPOINT_STAGES)[number]
    ](request);
  } catch (cause) {
    return translate(cause);
  }
}

function assertCurrentAssignmentRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  request: StatAssignmentCheckpointCommandRequest,
): void {
  const revisions = currentCreationWizardRevisions(checkpoint);
  if (!isDeepStrictEqual(request.expectedRevisions, revisions)) {
    throw new CreationWizardCheckpointApplicationError({
      actual: revisions,
      code: 'STALE_REVISION',
      expected: request.expectedRevisions,
    });
  }
  if (
    request.payload.characterDraftId !== checkpoint.localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== checkpoint.checkpoint.checkpointId ||
    request.payload.draftRevision !== checkpoint.receipt.result.draftRevision ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-009' ||
    checkpoint.statAssignmentStage !== null ||
    checkpoint.pureClassStage !== null ||
    creationWizardDurableIds(checkpoint).has(request.commandId) ||
    checkpoint.checkpoint.checkpointRevision === Number.MAX_SAFE_INTEGER ||
    checkpoint.receipt.result.draftRevision === Number.MAX_SAFE_INTEGER ||
    revisions.stateRevision === Number.MAX_SAFE_INTEGER ||
    revisions.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    guardRejected();
  }
}

function assertCurrentSkillRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  request: SkillCheckpointCommandRequest,
): void {
  const revisions = currentCreationWizardRevisions(checkpoint);
  if (!isDeepStrictEqual(request.expectedRevisions, revisions)) {
    throw new CreationWizardCheckpointApplicationError({
      actual: revisions,
      code: 'STALE_REVISION',
      expected: request.expectedRevisions,
    });
  }
  const sourceFormId = request.payload.sourceFormId;
  const eligibility = checkpoint.skillEligibilityStage;
  const selection = checkpoint.skillSelectionStage;
  const latest = selection?.receipt ?? eligibility?.receipt;
  const presentationAdvanced =
    latest !== undefined &&
    latest.revisions.projectionRevision < Number.MAX_SAFE_INTEGER &&
    revisions.actorVisibilityRevision === latest.revisions.actorVisibilityRevision &&
    revisions.stateRevision === latest.revisions.stateRevision &&
    (sourceFormId === 'CHR-014'
      ? revisions.projectionRevision > latest.revisions.projectionRevision
      : revisions.projectionRevision === latest.revisions.projectionRevision + 1);
  const selectionIsFinal = selection?.request.payload.sourceFormId === 'CHR-015';
  const historicalPureEntry =
    sourceFormId === 'CHR-015' &&
    isHistoricPureSkillCheckpoint(checkpoint) &&
    checkpoint.symbiontPresentationStage?.formId === 'CHR-015' &&
    isDeepStrictEqual(request.payload.selectedSkills, selection?.request.payload.selectedSkills);
  const presentation = checkpoint.skillPresentationStage;
  const cardRequestMatches =
    sourceFormId !== 'CHR-014' ||
    (presentation?.formId === 'CHR-014' &&
      presentation.selectionRevision === request.payload.draftRevision &&
      presentation.projectionRevision === revisions.projectionRevision);
  const finalRequestMatches =
    sourceFormId !== 'CHR-015' ||
    presentation === undefined ||
    presentation === null ||
    (presentation.formId === 'CHR-015' &&
      presentation.selectionRevision === request.payload.draftRevision &&
      presentation.projectionRevision === revisions.projectionRevision);
  const stageMatches =
    sourceFormId === 'CHR-012'
      ? checkpoint.nextStageEnvelope.formId === 'CHR-012' &&
        eligibility === null &&
        selection === null
      : eligibility !== null &&
        !selectionIsFinal &&
        (sourceFormId === 'CHR-014'
          ? ((checkpoint.nextStageEnvelope.formId === 'CHR-013' && selection === null) ||
              (checkpoint.nextStageEnvelope.formId === 'CHR-015' &&
                selection?.request.payload.sourceFormId === 'CHR-014')) &&
            presentationAdvanced
          : (checkpoint.nextStageEnvelope.formId === 'CHR-013' &&
              selection === null &&
              presentationAdvanced) ||
            (checkpoint.nextStageEnvelope.formId === 'CHR-015' &&
              selection?.request.payload.sourceFormId === 'CHR-014' &&
              isDeepStrictEqual(revisions, selection.receipt.revisions)));
  if (
    request.payload.characterDraftId !== checkpoint.localCharacter.localCharacterId ||
    request.payload.wizardCheckpointId !== checkpoint.checkpoint.checkpointId ||
    request.payload.draftRevision !== checkpoint.receipt.result.draftRevision ||
    !(stageMatches || historicalPureEntry) ||
    !cardRequestMatches ||
    !(finalRequestMatches || historicalPureEntry) ||
    creationWizardDurableIds(checkpoint).has(request.commandId) ||
    checkpoint.checkpoint.checkpointRevision === Number.MAX_SAFE_INTEGER ||
    checkpoint.receipt.result.draftRevision === Number.MAX_SAFE_INTEGER ||
    revisions.stateRevision === Number.MAX_SAFE_INTEGER ||
    revisions.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    guardRejected();
  }
}

export function preflightCreationWizardCheckpoint(
  database: Database.Database,
  request: DecodedCommandRequest,
  catalog?: CreationCatalog,
  weaponCatalog?: StartingWeaponItemCatalog,
): CreationWizardCheckpointPreflight {
  const normalized = normalizeCreationWizardCheckpointRequest(request);
  if (normalized.payload.stage === 'IDENTITY') {
    try {
      return {
        request: validateIdentityCheckpointRequest(normalized as IdentityCheckpointCommandRequest),
        stage: 'IDENTITY',
      };
    } catch (cause) {
      return translate(cause);
    }
  }
  if (normalized.payload.stage === 'SYMBIONTS') {
    const symbiontCatalog = fullSymbiontCatalog(catalog);
    if (symbiontCatalog === undefined) {
      throw new Error('SYMBIONTS checkpoint requires a validated symbiont catalog');
    }
    try {
      const variant = 'variant' in normalized.payload ? normalized.payload.variant : undefined;
      if (variant === 'STARTING_WEAPON_ENTRY' || variant === 'STARTING_WEAPON_CHECKPOINT') {
        if (weaponCatalog === undefined)
          throw new Error('weapon checkpoint requires weapon catalog');
        const preflight =
          variant === 'STARTING_WEAPON_ENTRY'
            ? preflightStartingWeaponEntry(database, normalized, symbiontCatalog)
            : preflightStartingWeaponCheckpoint(database, normalized, {
                catalog: symbiontCatalog,
                weaponCatalog,
              });
        return { checkpoint: preflight.checkpoint, request: preflight.request, stage: 'SYMBIONTS' };
      }
      const preflight =
        variant === 'ARMOR_BUNDLE_ENTRY'
          ? preflightArmorBundleEntry(database, normalized, symbiontCatalog)
          : variant === 'ARMOR_BUNDLE_CHECKPOINT'
            ? preflightArmorBundleCheckpoint(database, normalized, symbiontCatalog)
            : normalized.payload.sourceFormId === 'CHR-018'
              ? preflightManualComposition(database, normalized, symbiontCatalog)
              : variant === 'MANUAL_ADVISOR_SKILLS'
                ? preflightManualAdvisorSkills(database, normalized, symbiontCatalog)
                : preflightCreationSymbiontAdvisor(database, normalized, symbiontCatalog);
      return {
        checkpoint: preflight.checkpoint,
        request: preflight.request,
        stage: 'SYMBIONTS',
      };
    } catch (cause) {
      return translate(cause);
    }
  }
  if (normalized.payload.stage === 'SKILLS') {
    const skillRequest = normalized as SkillCheckpointCommandRequest;
    if (catalog === undefined) {
      throw new Error('SKILLS checkpoint requires a validated skill-stage catalog');
    }
    const checkpoint = loadCreationWizardCheckpoint(
      database,
      skillRequest.payload.characterDraftId,
      baseCatalog(catalog),
      fullSymbiontCatalog(catalog),
    );
    assertCurrentSkillRequest(checkpoint, skillRequest);
    try {
      return {
        checkpoint,
        plan:
          skillRequest.payload.sourceFormId === 'CHR-012'
            ? prepareSkillEligibility(
                checkpoint,
                skillRequest as SkillCheckpointCommandRequest & {
                  readonly payload: SkillEligibilityCheckpointPayload;
                },
                baseCatalog(catalog),
              )
            : skillRequest.payload.sourceFormId === 'CHR-014'
              ? prepareSkillCardAdditionFromCheckpoint(
                  checkpoint,
                  skillRequest as SkillCheckpointCommandRequest & {
                    readonly payload: SkillSelectionCheckpointPayload;
                  },
                  baseCatalog(catalog),
                )
              : prepareSkillSelection(
                  checkpoint,
                  skillRequest as SkillCheckpointCommandRequest & {
                    readonly payload: SkillSelectionCheckpointPayload;
                  },
                  baseCatalog(catalog),
                ),
        request: skillRequest,
        stage: 'SKILLS',
      };
    } catch (cause) {
      return translate(cause);
    }
  }
  const assignmentRequest = normalized as StatAssignmentCheckpointCommandRequest;
  if (catalog === undefined) {
    throw new Error('STAT_ASSIGNMENT checkpoint requires a validated skill-stage catalog');
  }
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    assignmentRequest.payload.characterDraftId,
    baseCatalog(catalog),
    fullSymbiontCatalog(catalog),
  );
  assertCurrentAssignmentRequest(checkpoint, assignmentRequest);
  try {
    return {
      checkpoint,
      plan: prepareStatAssignment(checkpoint, assignmentRequest, baseCatalog(catalog)),
      request: assignmentRequest,
      stage: 'STAT_ASSIGNMENT',
    };
  } catch (cause) {
    return translate(cause);
  }
}

const incrementedRevisions = (revisions: RevisionVector): RevisionVector => {
  if (
    revisions.stateRevision === Number.MAX_SAFE_INTEGER ||
    revisions.projectionRevision === Number.MAX_SAFE_INTEGER
  ) {
    return guardRejected();
  }
  return {
    actorVisibilityRevision: revisions.actorVisibilityRevision,
    projectionRevision: revisions.projectionRevision + 1,
    stateRevision: revisions.stateRevision + 1,
  };
};

const destination = <TFormId extends 'CHR-011' | 'CHR-012' | 'CHR-013' | 'CHR-015' | 'CHR-017'>(
  formId: TFormId,
  characterDraftId: string,
): CreationNextStageEnvelope<TFormId> => ({
  formId,
  routeBindings: [{ parameterIndex: 0, source: 'inherited', value: characterDraftId }],
});

function assignmentPayload(
  checkpoint: DurableCreationWizardCheckpoint,
  request: StatAssignmentCheckpointCommandRequest,
  plan: StatAssignmentPlan,
  receiptId: string,
): CreationWizardStatAssignmentPayload {
  const statRollStage = checkpoint.statRollStage;
  if (statRollStage === null) return guardRejected();
  const nextStageEnvelope = destination(plan.nextFormId, request.payload.characterDraftId);
  const receipt: StatAssignmentCheckpointReceipt = {
    commandId: request.commandId,
    receiptId,
    result: {
      ...plan.derived,
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      branchUuid: statRollStage.branchUuid,
      characterDraftId: request.payload.characterDraftId,
      checkpointId: request.payload.wizardCheckpointId,
      checkpointOwnerId: request.payload.characterDraftId,
      checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
      draftRevision: checkpoint.receipt.result.draftRevision + 1,
      nextFormId: plan.nextFormId,
      sourceFormId: 'CHR-009',
      stage: 'STAT_ASSIGNMENT',
    },
    revisions: incrementedRevisions(request.expectedRevisions),
  };
  const statAssignmentStage: StatAssignmentStage = {
    derived: plan.derived,
    nextStageEnvelope,
    receipt,
    request,
  };
  return {
    ...(checkpoint.durablePayload as CreationWizardStatAssignmentPayload),
    nextStageEnvelope,
    pureClassStage: null,
    receipt,
    statAssignmentStage,
  };
}

function skillPayload(
  checkpoint: DurableCreationWizardCheckpoint,
  request: SkillCheckpointCommandRequest,
  plan: SkillEligibilityPlan | SkillSelectionPlan,
  receiptId: string,
  symbiontCatalog: SymbiontCatalog | undefined,
  allocateRandomSequenceId: () => string,
  armorBundleDependencies: {
    readonly allocateArmorBundleId: () => string;
    readonly allocateQualityRollRequestId: () => string;
  },
): CreationWizardSkillPayload | CreationWizardSymbiontPayload {
  const statRollStage = checkpoint.statRollStage;
  if (statRollStage === null) return guardRejected();
  const revisions = incrementedRevisions(request.expectedRevisions);
  if (request.payload.sourceFormId === 'CHR-012') {
    if (plan.nextFormId !== 'CHR-013') return guardRejected();
    const normalized = request as SkillCheckpointCommandRequest & {
      readonly payload: SkillEligibilityCheckpointPayload;
    };
    const eligibilityPlan = plan;
    const nextStageEnvelope = destination('CHR-013', request.payload.characterDraftId);
    const receipt: SkillEligibilityCheckpointReceipt = {
      commandId: request.commandId,
      receiptId,
      result: {
        ...eligibilityPlan.derived,
        branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
        branchUuid: statRollStage.branchUuid,
        characterDraftId: request.payload.characterDraftId,
        checkpointId: request.payload.wizardCheckpointId,
        checkpointOwnerId: request.payload.characterDraftId,
        checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
        draftRevision: checkpoint.receipt.result.draftRevision + 1,
        nextFormId: 'CHR-013',
        sourceFormId: 'CHR-012',
        stage: 'SKILLS',
      },
      revisions,
    };
    const skillEligibilityStage: SkillEligibilityStage = {
      derived: eligibilityPlan.derived,
      nextStageEnvelope,
      receipt,
      request: normalized,
    };
    return {
      ...(checkpoint.durablePayload as CreationWizardStatAssignmentPayload),
      nextStageEnvelope,
      receipt,
      skillEligibilityStage,
      skillSelectionStage: null,
    };
  }
  if (checkpoint.skillEligibilityStage === null) return guardRejected();
  const sourceFormId = request.payload.sourceFormId;
  const nextFormId = sourceFormId === 'CHR-014' ? 'CHR-015' : 'CHR-017';
  if (plan.nextFormId !== nextFormId) return guardRejected();
  const normalized = request as SkillCheckpointCommandRequest & {
    readonly payload: SkillSelectionCheckpointPayload;
  };
  const selectionPlan = plan;
  const nextStageEnvelope = destination(nextFormId, request.payload.characterDraftId);
  const receipt: SkillSelectionCheckpointReceipt = {
    commandId: request.commandId,
    receiptId,
    result: {
      ...selectionPlan.derived,
      branchCacheHash: EMPTY_IDENTITY_BRANCH_CACHE_HASH,
      branchUuid: statRollStage.branchUuid,
      characterDraftId: request.payload.characterDraftId,
      checkpointId: request.payload.wizardCheckpointId,
      checkpointOwnerId: request.payload.characterDraftId,
      checkpointRevision: checkpoint.checkpoint.checkpointRevision + 1,
      draftRevision: checkpoint.receipt.result.draftRevision + 1,
      nextFormId,
      sourceFormId,
      stage: 'SKILLS',
    },
    revisions,
  };
  const previousRecords = checkpoint.skillSelectionStage?.cardAdditionRecords ?? [];
  const selectionRecord = {
    derived: selectionPlan.derived,
    nextStageEnvelope,
    receipt,
    request: normalized,
  };
  let skillSelectionStage: SkillSelectionStage;
  if (sourceFormId === 'CHR-014') {
    const cardAdditionRecord: SkillCardAdditionRecord = {
      ...selectionRecord,
      nextStageEnvelope: nextStageEnvelope as CreationNextStageEnvelope<'CHR-015'>,
      request: normalized as SkillCheckpointCommandRequest & {
        readonly payload: SkillCardAdditionCheckpointPayload;
      },
    };
    skillSelectionStage = {
      ...selectionRecord,
      cardAdditionRecords: [...previousRecords, cardAdditionRecord],
    };
  } else {
    skillSelectionStage = {
      ...selectionRecord,
      ...(previousRecords.length === 0 ? {} : { cardAdditionRecords: previousRecords }),
    };
  }
  const resultPayload = {
    ...(checkpoint.durablePayload as CreationWizardSkillPayload),
    nextStageEnvelope,
    receipt,
    skillSelectionStage,
  } as CreationWizardSkillPayload;
  if (sourceFormId === 'CHR-014') return resultPayload;
  const raceStage = checkpoint.raceAndMethodStage;
  if (raceStage?.race?.value === 'PURE' && symbiontCatalog !== undefined) {
    const initialized = initializePureComposition(
      checkpoint,
      skillSelectionStage,
      armorBundleDependencies.allocateArmorBundleId,
      armorBundleDependencies.allocateQualityRollRequestId,
    );
    return {
      ...resultPayload,
      randomSymbiontStage: null,
      pureCompositionStage: initialized.pureCompositionStage,
      armorBundleStage: initialized.armorBundleStage,
      receipt: initialized.selection.receipt,
      skillSelectionStage: isHistoricPureSkillCheckpoint(checkpoint)
        ? checkpoint.skillSelectionStage!
        : initialized.selection,
    };
  }
  if (symbiontCatalog === undefined || raceStage?.symbiontAcquisition.value !== 'RANDOM') {
    return resultPayload;
  }
  const raceChoice = raceStage.race?.value;
  const diceInputModeSnapshot = raceStage.diceInput?.value;
  if (raceChoice === undefined || raceChoice === 'PURE' || diceInputModeSnapshot === undefined) {
    return guardRejected();
  }
  const randomSequenceId = allocateRandomSequenceId();
  if (
    randomSequenceId.length === 0 ||
    randomSequenceId === request.commandId ||
    randomSequenceId === receiptId ||
    creationWizardDurableIds(checkpoint).has(randomSequenceId)
  ) {
    return guardRejected();
  }
  return {
    ...resultPayload,
    randomSymbiontStage: initialSymbiontStageForWizard(
      randomSequenceId,
      raceChoice,
      diceInputModeSnapshot,
    ),
  };
}

export function commitCreationWizardCheckpoint(
  database: Database.Database,
  request: DecodedCommandRequest,
  receiptId: string,
  catalog?: CreationCatalog,
  allocateRandomSequenceId: () => string = randomUUID,
  manualCompositionDependencies?: {
    readonly allocateRollRequestId: () => string;
    readonly sampleD20: () => number;
  },
  armorBundleDependencies?: {
    readonly allocateArmorBundleId: () => string;
    readonly allocateQualityRollRequestId: () => string;
  },
  weaponDependencies?: {
    readonly weaponCatalog: StartingWeaponItemCatalog;
    readonly allocateWeaponQualityRollRequestId: () => string;
    readonly allocateProfileRequestId?: () => string;
  },
): DurableCreationWizardCheckpoint {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new TypeError(
      `creation wizard checkpoint receiptId must be a non-empty string, got ${JSON.stringify(receiptId)}`,
    );
  }
  const preflight = preflightCreationWizardCheckpoint(
    database,
    request,
    catalog,
    weaponDependencies?.weaponCatalog,
  );
  if (preflight.stage === 'IDENTITY') {
    try {
      const durable = commitIdentityCheckpoint(database, preflight.request, receiptId);
      return loadCreationWizardCheckpoint(
        database,
        durable.localCharacter.localCharacterId,
        baseCatalog(catalog),
        fullSymbiontCatalog(catalog),
      );
    } catch (cause) {
      return translate(cause);
    }
  }
  if (preflight.stage === 'SYMBIONTS') {
    try {
      const variant =
        'variant' in preflight.request.payload ? preflight.request.payload.variant : undefined;
      if (variant === 'ARMOR_BUNDLE_ENTRY') {
        if (armorBundleDependencies === undefined) {
          throw new Error('armor bundle entry requires armor bundle dependencies');
        }
        return commitArmorBundleEntry(database, preflight.request, receiptId, {
          catalog: fullSymbiontCatalog(catalog)!,
          ...armorBundleDependencies,
        });
      }
      if (variant === 'ARMOR_BUNDLE_CHECKPOINT') {
        return commitArmorBundleCheckpoint(database, preflight.request, receiptId, {
          catalog: fullSymbiontCatalog(catalog)!,
          ...(weaponDependencies === undefined
            ? {}
            : {
                allocateWeaponQualityRollRequestId:
                  weaponDependencies.allocateWeaponQualityRollRequestId,
              }),
        });
      }
      if (variant === 'STARTING_WEAPON_ENTRY' || variant === 'STARTING_WEAPON_CHECKPOINT') {
        if (weaponDependencies === undefined)
          throw new Error('weapon checkpoint requires weapon dependencies');
        const dependencies = { catalog: fullSymbiontCatalog(catalog)!, ...weaponDependencies };
        return variant === 'STARTING_WEAPON_ENTRY'
          ? commitStartingWeaponEntry(database, preflight.request, receiptId, dependencies)
          : commitStartingWeaponCheckpoint(database, preflight.request, receiptId, dependencies);
      }
      if (
        preflight.request.payload.sourceFormId === 'CHR-018' ||
        variant === 'MANUAL_ADVISOR_SKILLS'
      ) {
        if (manualCompositionDependencies === undefined) {
          throw new Error('manual symbiont checkpoint requires roll dependencies');
        }
        const dependencies = {
          catalog: fullSymbiontCatalog(catalog)!,
          ...manualCompositionDependencies,
        };
        return preflight.request.payload.sourceFormId === 'CHR-018'
          ? commitManualComposition(database, preflight.request, receiptId, dependencies)
          : commitManualAdvisorSkills(database, preflight.request, receiptId, dependencies);
      }
      return commitCreationSymbiontAdvisor(
        database,
        preflight.request,
        receiptId,
        fullSymbiontCatalog(catalog)!,
      );
    } catch (cause) {
      return translate(cause);
    }
  }
  const { checkpoint, request: normalized } = preflight;
  if (receiptId === normalized.commandId || creationWizardDurableIds(checkpoint).has(receiptId)) {
    guardRejected();
  }
  const committed = commitLocalCharacterCheckpoint(
    database,
    normalized.payload.characterDraftId,
    normalized.payload.wizardCheckpointId,
    (update) => {
      const current = loadCreationWizardCheckpoint(
        database,
        normalized.payload.characterDraftId,
        baseCatalog(catalog),
        fullSymbiontCatalog(catalog),
      );
      if (creationWizardDurableIds(current).has(receiptId)) guardRejected();
      if (preflight.stage === 'STAT_ASSIGNMENT') {
        const assignmentRequest = normalized as StatAssignmentCheckpointCommandRequest;
        assertCurrentAssignmentRequest(current, assignmentRequest);
        let plan: StatAssignmentPlan;
        try {
          plan = prepareStatAssignment(current, assignmentRequest, baseCatalog(catalog)!);
        } catch (cause) {
          return translate(cause);
        }
        return update(
          {
            payloadJson: JSON.stringify(
              assignmentPayload(current, assignmentRequest, plan, receiptId),
            ),
          },
          { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
        );
      }
      const skillRequest = normalized as SkillCheckpointCommandRequest;
      assertCurrentSkillRequest(current, skillRequest);
      let plan: SkillEligibilityPlan | SkillSelectionPlan;
      try {
        plan =
          skillRequest.payload.sourceFormId === 'CHR-012'
            ? prepareSkillEligibility(
                current,
                skillRequest as SkillCheckpointCommandRequest & {
                  readonly payload: SkillEligibilityCheckpointPayload;
                },
                baseCatalog(catalog)!,
              )
            : skillRequest.payload.sourceFormId === 'CHR-014'
              ? prepareSkillCardAdditionFromCheckpoint(
                  current,
                  skillRequest as SkillCheckpointCommandRequest & {
                    readonly payload: SkillSelectionCheckpointPayload;
                  },
                  baseCatalog(catalog)!,
                )
              : prepareSkillSelection(
                  current,
                  skillRequest as SkillCheckpointCommandRequest & {
                    readonly payload: SkillSelectionCheckpointPayload;
                  },
                  baseCatalog(catalog)!,
                );
      } catch (cause) {
        return translate(cause);
      }
      const nextPayload = skillPayload(
        current,
        skillRequest,
        plan,
        receiptId,
        fullSymbiontCatalog(catalog),
        allocateRandomSequenceId,
        armorBundleDependencies ?? {
          allocateArmorBundleId: randomUUID,
          allocateQualityRollRequestId: randomUUID,
        },
      );
      const result = update(
        { payloadJson: JSON.stringify(nextPayload) },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: true },
      );
      if (
        skillRequest.payload.sourceFormId === 'CHR-014' ||
        (current.skillPresentationStage ?? null) !== null
      ) {
        writeLocalCharacterSkillPresentation(
          database,
          createSkillPresentationStage(
            'CHR-015',
            nextPayload.receipt.result.characterDraftId,
            null,
            nextPayload.receipt.result.draftRevision,
            nextPayload.receipt.revisions.projectionRevision,
          ),
        );
      }
      if (
        skillRequest.payload.sourceFormId === 'CHR-015' &&
        'pureCompositionStage' in nextPayload &&
        nextPayload.pureCompositionStage != null
      ) {
        writeLocalCharacterSymbiontPresentation(database, {
          formId: 'CHR-017',
          compositionDraftRevision: nextPayload.receipt.result.draftRevision,
          projectionRevision: nextPayload.receipt.revisions.projectionRevision,
          routeBindings: nextPayload.nextStageEnvelope.routeBindings,
          routeTemplate: '/player/characters/:localCharacterId/create/chr-017',
        });
      }
      return result;
    },
  );
  return loadCreationWizardCheckpoint(
    database,
    committed.result.localCharacterId,
    baseCatalog(catalog),
    fullSymbiontCatalog(catalog),
  );
}
