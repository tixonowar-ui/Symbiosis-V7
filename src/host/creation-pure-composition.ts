import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';

import type { JsonObject } from '@shared/wire-protocol.js';

import type { ArmorBundleStage } from './creation-armor-bundle-contract.js';
import {
  creationWizardDurableIds,
  loadCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import type { SymbiontCatalog } from '../domain/index.js';
import {
  commitLocalCharacterCheckpoint,
  writeLocalCharacterSymbiontPresentation,
} from '../persistence/index.js';
import type {
  SkillSelectionStage,
  SkillSelectionCheckpointReceipt,
} from './creation-skill-selection.js';
import {
  exactSymbiontObject,
  guardSymbiontRejected,
  nonEmptySymbiontStringAt,
} from './creation-symbiont-contract.js';

/** CHR-017::CTA::004 requires this fact before its navigation can be published. */
export interface PureCompositionStage extends JsonObject {
  readonly kind: 'PURE_EMPTY';
  readonly entryMode: 'SKILL_CHECKPOINT' | 'SKILL_RECONFIRM';
  readonly skillCheckpointReceiptId: string;
  readonly armorBundleId: string;
  readonly qualityRollRequestId: string;
}

export function parsePureCompositionStage(value: unknown): PureCompositionStage {
  const object = exactSymbiontObject(value, '$.pureCompositionStage', [
    'kind',
    'entryMode',
    'skillCheckpointReceiptId',
    'armorBundleId',
    'qualityRollRequestId',
  ]);
  if (
    object['kind'] !== 'PURE_EMPTY' ||
    (object['entryMode'] !== 'SKILL_CHECKPOINT' && object['entryMode'] !== 'SKILL_RECONFIRM')
  )
    return guardSymbiontRejected();
  return {
    kind: 'PURE_EMPTY',
    entryMode: object['entryMode'],
    skillCheckpointReceiptId: nonEmptySymbiontStringAt(
      object['skillCheckpointReceiptId'],
      '$.pureCompositionStage.skillCheckpointReceiptId',
    ),
    armorBundleId: nonEmptySymbiontStringAt(
      object['armorBundleId'],
      '$.pureCompositionStage.armorBundleId',
    ),
    qualityRollRequestId: nonEmptySymbiontStringAt(
      object['qualityRollRequestId'],
      '$.pureCompositionStage.qualityRollRequestId',
    ),
  };
}

export function isHistoricPureSkillCheckpoint(
  checkpoint: DurableCreationWizardCheckpoint,
): boolean {
  return (
    checkpoint.raceAndMethodStage?.race?.value === 'PURE' &&
    checkpoint.raceAndMethodStage.symbiontAcquisition.choiceLockStatus === 'NOT_APPLICABLE' &&
    checkpoint.skillSelectionStage?.request.payload.sourceFormId === 'CHR-015' &&
    (checkpoint.pureCompositionStage ?? null) === null &&
    (checkpoint.armorBundleStage ?? null) === null &&
    checkpoint.randomSymbiontStage === null &&
    (checkpoint.manualCompositionStage ?? null) === null
  );
}

export function initializePureComposition(
  checkpoint: DurableCreationWizardCheckpoint,
  selection: SkillSelectionStage,
  allocateArmorBundleId: () => string,
  allocateQualityRollRequestId: () => string,
): {
  readonly pureCompositionStage: PureCompositionStage;
  readonly armorBundleStage: ArmorBundleStage;
  readonly selection: SkillSelectionStage;
} {
  const acquisition = checkpoint.raceAndMethodStage;
  if (
    acquisition?.race?.value !== 'PURE' ||
    acquisition.symbiontAcquisition.choiceLockStatus !== 'NOT_APPLICABLE' ||
    acquisition.diceInput === null ||
    selection.request.payload.sourceFormId !== 'CHR-015' ||
    (checkpoint.pureCompositionStage ?? null) !== null ||
    (checkpoint.armorBundleStage ?? null) !== null ||
    checkpoint.randomSymbiontStage !== null ||
    (checkpoint.manualCompositionStage ?? null) !== null
  )
    return guardSymbiontRejected();
  const occupied = new Set([
    ...creationWizardDurableIds(checkpoint),
    selection.request.commandId,
    selection.receipt.receiptId,
  ]);
  const allocate = (factory: () => string): string => {
    const id = factory();
    if (typeof id !== 'string' || id.length === 0 || occupied.has(id))
      return guardSymbiontRejected();
    occupied.add(id);
    return id;
  };
  const armorBundleId = allocate(allocateArmorBundleId);
  const qualityRollRequestId = allocate(allocateQualityRollRequestId);
  const receipt: SkillSelectionCheckpointReceipt = {
    ...selection.receipt,
    result: {
      ...selection.receipt.result,
      pureArmorBundleId: armorBundleId,
      pureArmorQualityRollRequestId: qualityRollRequestId,
    },
  };
  const boundSelection = { ...selection, receipt };
  return {
    selection: boundSelection,
    pureCompositionStage: {
      kind: 'PURE_EMPTY',
      entryMode: isHistoricPureSkillCheckpoint(checkpoint) ? 'SKILL_RECONFIRM' : 'SKILL_CHECKPOINT',
      skillCheckpointReceiptId: receipt.receiptId,
      armorBundleId,
      qualityRollRequestId,
    },
    armorBundleStage: {
      anatomyProfile: 'STANDARD_HUMANOID',
      armorBundleId,
      qualityRollRequestId,
      diceInputModeSnapshot: acquisition.diceInput.value,
      entryRequest: selection.request,
      entryReceipt: receipt,
      qualityRollRecordOrNull: null,
      checkpointRecordOrNull: null,
    },
  };
}

export function assertPureCompositionBinding(checkpoint: DurableCreationWizardCheckpoint): void {
  const pure = checkpoint.pureCompositionStage;
  const armor = checkpoint.armorBundleStage;
  const skills = checkpoint.skillSelectionStage;
  if (
    pure === null ||
    pure === undefined ||
    armor === null ||
    armor === undefined ||
    skills === null ||
    checkpoint.raceAndMethodStage?.race?.value !== 'PURE' ||
    checkpoint.raceAndMethodStage.symbiontAcquisition.choiceLockStatus !== 'NOT_APPLICABLE' ||
    checkpoint.randomSymbiontStage !== null ||
    (checkpoint.manualCompositionStage ?? null) !== null ||
    armor.entryRequest.payload.stage !== 'SKILLS' ||
    armor.entryRequest.payload.sourceFormId !== 'CHR-015' ||
    armor.entryReceipt.result.stage !== 'SKILLS' ||
    pure.skillCheckpointReceiptId !== armor.entryReceipt.receiptId ||
    pure.armorBundleId !== armor.armorBundleId ||
    pure.qualityRollRequestId !== armor.qualityRollRequestId ||
    armor.entryReceipt.result.pureArmorBundleId !== pure.armorBundleId ||
    armor.entryReceipt.result.pureArmorQualityRollRequestId !== pure.qualityRollRequestId
  )
    return guardSymbiontRejected();
  if (
    pure.entryMode === 'SKILL_CHECKPOINT' &&
    (!isDeepStrictEqual(skills.request, armor.entryRequest) ||
      !isDeepStrictEqual(skills.receipt, armor.entryReceipt))
  )
    return guardSymbiontRejected();
  if (
    pure.entryMode === 'SKILL_RECONFIRM' &&
    (skills.request.payload.sourceFormId !== 'CHR-015' ||
      skills.receipt.result.pureArmorBundleId !== undefined ||
      !isDeepStrictEqual(
        skills.request.payload.selectedSkills,
        armor.entryRequest.payload.selectedSkills,
      ))
  )
    return guardSymbiontRejected();
}

export function advancePureCompositionPresentation(
  database: Database.Database,
  input: {
    readonly characterDraftId: string;
    readonly wizardCheckpointId: string;
    readonly formId: 'CHR-015' | 'CHR-017' | 'CHR-019' | 'CHR-021';
  },
  catalog: SymbiontCatalog,
): DurableCreationWizardCheckpoint {
  const check = (): DurableCreationWizardCheckpoint => {
    const current = loadCreationWizardCheckpoint(
      database,
      input.characterDraftId,
      catalog.skillStage,
      catalog,
    );
    const source = current.symbiontPresentationStage?.formId ?? current.nextStageEnvelope.formId;
    const historic = isHistoricPureSkillCheckpoint(current);
    const allowed = historic
      ? source === 'CHR-017' && input.formId === 'CHR-015'
      : (source === 'CHR-017' && input.formId === 'CHR-021') ||
        (source === 'CHR-019' && input.formId === 'CHR-017') ||
        (source === 'CHR-021' &&
          input.formId === 'CHR-019' &&
          current.armorBundleStage?.qualityRollRecordOrNull != null);
    if (
      !allowed ||
      current.checkpoint.checkpointId !== input.wizardCheckpointId ||
      current.localCharacter.projectionRevision === Number.MAX_SAFE_INTEGER ||
      (!historic && current.armorBundleStage?.checkpointRecordOrNull !== null)
    )
      return guardSymbiontRejected();
    if (!historic) assertPureCompositionBinding(current);
    return current;
  };
  check();
  let validated: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    input.characterDraftId,
    input.wizardCheckpointId,
    (update) => {
      const current = check();
      writeLocalCharacterSymbiontPresentation(database, {
        formId: input.formId,
        compositionDraftRevision: current.receipt.result.draftRevision,
        projectionRevision: current.localCharacter.projectionRevision + 1,
        routeBindings: [{ parameterIndex: 0, source: 'inherited', value: input.characterDraftId }],
        routeTemplate: `/player/characters/:localCharacterId/create/${input.formId.toLowerCase()}`,
      });
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
  if (validated === undefined) throw new Error('PURE presentation validation was not executed');
  return validated;
}
