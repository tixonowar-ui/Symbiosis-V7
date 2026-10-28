import { realpathSync } from 'node:fs';

import type Database from 'better-sqlite3';

import {
  deriveManualInteractionPreview,
  type SymbiontCatalog,
  type SymbiontComposition,
  type SymbiontSpeciesKey,
} from '../domain/index.js';
import {
  commitLocalCharacterCheckpoint,
  writeLocalCharacterSymbiontPresentation,
  type SymbiontPresentationStage,
} from '../persistence/index.js';
import { guardSymbiontRejected } from './creation-symbiont-contract.js';
import {
  loadCreationWizardCheckpoint,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import type { SymbiontMediaPreview } from './symbiont-media.js';

const ROUTES = {
  'CHR-017': '/player/characters/:localCharacterId/create/chr-017',
  'CHR-018': '/player/characters/:localCharacterId/create/chr-018/:speciesKey',
  'CHR-019': '/player/characters/:localCharacterId/create/chr-019',
  'CHR-021': '/player/characters/:localCharacterId/create/chr-021',
  'CHR-022': '/player/characters/:localCharacterId/create/chr-022',
  'CHR-041': '/player/characters/:localCharacterId/create/chr-041',
  'CHR-042': '/player/characters/:localCharacterId/create/chr-042',
} as const;

export function manualCompositionRevision(checkpoint: DurableCreationWizardCheckpoint): number {
  return (
    checkpoint.manualCompositionStage?.compositionDraftRevision ??
    checkpoint.receipt.result.draftRevision
  );
}

export function manualAdvisorWorkPending(
  stage: NonNullable<DurableCreationWizardCheckpoint['manualCompositionStage']>,
): boolean {
  const advisorPresent = stage.composition.acceptedSpecies.some(
    (accepted) => accepted.speciesKey === 'ADVISER',
  );
  return (
    advisorPresent &&
    (stage.advisorIwRecordOrNull === null ||
      stage.advisorSkillRecordOrNull === null ||
      stage.pendingSuppressionRollRequestIdOrNull !== null)
  );
}

function assertManualCheckpoint(
  database: Database.Database,
  characterDraftId: string,
  wizardCheckpointId: string,
  catalog: SymbiontCatalog,
): DurableCreationWizardCheckpoint {
  const checkpoint = loadCreationWizardCheckpoint(
    database,
    characterDraftId,
    catalog.skillStage,
    catalog,
  );
  const presentation = checkpoint.symbiontPresentationStage;
  if (
    checkpoint.checkpoint.checkpointId !== wizardCheckpointId ||
    checkpoint.raceAndMethodStage?.symbiontAcquisition.value !== 'MANUAL' ||
    checkpoint.randomSymbiontStage !== null ||
    (checkpoint.advisorIntelligenceFloorStage !== null &&
      checkpoint.advisorIntelligenceFloorStage !== undefined) ||
    checkpoint.localCharacter.projectionRevision === Number.MAX_SAFE_INTEGER ||
    (presentation !== null &&
      presentation !== undefined &&
      presentation.compositionDraftRevision !== manualCompositionRevision(checkpoint))
  ) {
    return guardSymbiontRejected();
  }
  return checkpoint;
}

export function manualInteractionPreview(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
): ReturnType<typeof deriveManualInteractionPreview> {
  const stage = checkpoint.manualCompositionStage;
  const before = stage?.compositionRecords.at(-2);
  const after = stage?.compositionRecords.at(-1);
  if (stage === null || stage === undefined || before === undefined || after === undefined) {
    return guardSymbiontRejected();
  }
  return deriveManualInteractionPreview(catalog, {
    before: {
      raceCode: stage.composition.raceCode,
      acceptedSpecies: before.acceptedSpecies,
      selectedBindings: before.request.payload.selectedBindings,
    },
    after: {
      raceCode: stage.composition.raceCode,
      acceptedSpecies: after.acceptedSpecies,
      selectedBindings: after.request.payload.selectedBindings,
    },
  });
}

export function manualInteractionConfirmationRequired(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
): boolean {
  const stage = checkpoint.manualCompositionStage;
  return (
    stage !== null &&
    stage !== undefined &&
    !manualAdvisorWorkPending(stage) &&
    stage.compositionRecords.length > 1 &&
    manualInteractionPreview(checkpoint, catalog).irreversibleOperationIds.length > 0
  );
}

function inherited(characterDraftId: string): SymbiontPresentationStage['routeBindings'][number] {
  return { parameterIndex: 0, source: 'inherited', value: characterDraftId };
}

function presentationAt(
  checkpoint: DurableCreationWizardCheckpoint,
  catalog: SymbiontCatalog,
  formId: SymbiontPresentationStage['formId'],
  speciesKey?: SymbiontSpeciesKey,
): SymbiontPresentationStage {
  const stage = checkpoint.manualCompositionStage;
  if (formId === 'CHR-018') {
    if (speciesKey === undefined) return guardSymbiontRejected();
    return {
      formId,
      compositionDraftRevision: manualCompositionRevision(checkpoint),
      projectionRevision: checkpoint.localCharacter.projectionRevision + 1,
      routeBindings: [
        inherited(checkpoint.localCharacter.localCharacterId),
        { parameterIndex: 1, source: 'client-selected', value: speciesKey },
      ],
      routeTemplate: ROUTES[formId],
    };
  }
  if (formId === 'CHR-017') {
    if (stage !== null && stage !== undefined && manualAdvisorWorkPending(stage)) {
      return guardSymbiontRejected();
    }
  } else if (formId === 'CHR-019') {
    if (stage === null || stage === undefined || manualAdvisorWorkPending(stage)) {
      return guardSymbiontRejected();
    }
  } else if (formId === 'CHR-041') {
    if (
      stage === null ||
      stage === undefined ||
      checkpoint.nextStageEnvelope.formId !== 'CHR-041' ||
      !stage.composition.acceptedSpecies.some((accepted) => accepted.speciesKey === 'ADVISER')
    ) {
      return guardSymbiontRejected();
    }
  } else if (formId === 'CHR-042') {
    if (
      stage === null ||
      stage === undefined ||
      manualAdvisorWorkPending(stage) ||
      manualInteractionPreview(checkpoint, catalog).irreversibleOperationIds.length === 0
    ) {
      return guardSymbiontRejected();
    }
  } else {
    return guardSymbiontRejected();
  }
  return {
    formId,
    compositionDraftRevision: manualCompositionRevision(checkpoint),
    projectionRevision: checkpoint.localCharacter.projectionRevision + 1,
    routeBindings: [inherited(checkpoint.localCharacter.localCharacterId)],
    routeTemplate: ROUTES[formId],
  };
}

function commitPresentation(
  database: Database.Database,
  input: {
    readonly characterDraftId: string;
    readonly wizardCheckpointId: string;
    readonly formId: SymbiontPresentationStage['formId'];
    readonly speciesKey?: SymbiontSpeciesKey;
  },
  catalog: SymbiontCatalog,
): DurableCreationWizardCheckpoint {
  commitLocalCharacterCheckpoint(
    database,
    input.characterDraftId,
    input.wizardCheckpointId,
    (update) => {
      const current = assertManualCheckpoint(
        database,
        input.characterDraftId,
        input.wizardCheckpointId,
        catalog,
      );
      const presentation = presentationAt(current, catalog, input.formId, input.speciesKey);
      writeLocalCharacterSymbiontPresentation(database, presentation);
      return update(
        { payloadJson: current.localCharacter.payloadJson },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
      );
    },
  );
  return loadCreationWizardCheckpoint(
    database,
    input.characterDraftId,
    catalog.skillStage,
    catalog,
  );
}

export function advanceManualSymbiontPresentation(
  database: Database.Database,
  input: {
    readonly characterDraftId: string;
    readonly wizardCheckpointId: string;
    readonly formId: 'CHR-017' | 'CHR-019' | 'CHR-041' | 'CHR-042';
  },
  catalog: SymbiontCatalog,
): DurableCreationWizardCheckpoint {
  assertManualCheckpoint(database, input.characterDraftId, input.wizardCheckpointId, catalog);
  return commitPresentation(database, input, catalog);
}

function assertArmorNavigationCheckpoint(
  checkpoint: DurableCreationWizardCheckpoint,
  wizardCheckpointId: string,
): void {
  const armor = checkpoint.armorBundleStage;
  if (
    checkpoint.checkpoint.checkpointId !== wizardCheckpointId ||
    armor === null ||
    armor === undefined ||
    armor.qualityRollRecordOrNull === null ||
    armor.checkpointRecordOrNull !== null ||
    checkpoint.nextStageEnvelope.formId !== 'CHR-021' ||
    checkpoint.localCharacter.projectionRevision === Number.MAX_SAFE_INTEGER ||
    (checkpoint.symbiontPresentationStage !== null &&
      checkpoint.symbiontPresentationStage !== undefined &&
      checkpoint.symbiontPresentationStage.compositionDraftRevision !==
        manualCompositionRevision(checkpoint))
  ) {
    guardSymbiontRejected();
  }
}

export function advanceArmorBundlePresentation(
  database: Database.Database,
  input: {
    readonly characterDraftId: string;
    readonly wizardCheckpointId: string;
    readonly formId: 'CHR-019' | 'CHR-021';
  },
  catalog: SymbiontCatalog,
): DurableCreationWizardCheckpoint {
  const preflight = loadCreationWizardCheckpoint(
    database,
    input.characterDraftId,
    catalog.skillStage,
    catalog,
  );
  assertArmorNavigationCheckpoint(preflight, input.wizardCheckpointId);
  let validatedCheckpoint: DurableCreationWizardCheckpoint | undefined;
  commitLocalCharacterCheckpoint(
    database,
    input.characterDraftId,
    input.wizardCheckpointId,
    (update) => {
      const current = loadCreationWizardCheckpoint(
        database,
        input.characterDraftId,
        catalog.skillStage,
        catalog,
      );
      assertArmorNavigationCheckpoint(current, input.wizardCheckpointId);
      writeLocalCharacterSymbiontPresentation(database, {
        formId: input.formId,
        compositionDraftRevision: manualCompositionRevision(current),
        projectionRevision: current.localCharacter.projectionRevision + 1,
        routeBindings: [inherited(input.characterDraftId)],
        routeTemplate: ROUTES[input.formId],
      });
      return update(
        { payloadJson: current.localCharacter.payloadJson },
        { actorVisibilityChanged: false, projectionChanged: true, stateChanged: false },
      );
    },
    () => {
      validatedCheckpoint = loadCreationWizardCheckpoint(
        database,
        input.characterDraftId,
        catalog.skillStage,
        catalog,
      );
    },
  );
  if (validatedCheckpoint === undefined) {
    throw new Error('armor presentation validation was not executed');
  }
  return validatedCheckpoint;
}

export function handleSymbiontAddressableRoute(
  database: Database.Database,
  input: {
    readonly characterDraftId: string;
    readonly wizardCheckpointId: string;
    readonly speciesKey: SymbiontSpeciesKey;
  },
  catalog: SymbiontCatalog,
  media: ReadonlyMap<SymbiontSpeciesKey, SymbiontMediaPreview>,
): DurableCreationWizardCheckpoint {
  const checkpoint = assertManualCheckpoint(
    database,
    input.characterDraftId,
    input.wizardCheckpointId,
    catalog,
  );
  const species = catalog.species.find((candidate) => candidate.speciesKey === input.speciesKey);
  const race = checkpoint.raceAndMethodStage?.race?.value;
  if (species === undefined || (race === 'FREE' && species.kind === 'SYMBIOTIC_MONSTER')) {
    return guardSymbiontRejected();
  }
  const preview = media.get(input.speciesKey);
  if (preview === undefined) return guardSymbiontRejected();
  realpathSync(preview.artFile);
  realpathSync(preview.developmentTreeFile);
  return commitPresentation(database, { ...input, formId: 'CHR-018' }, catalog);
}

export function writeManualCommandPresentation(
  database: Database.Database,
  formId: 'CHR-019' | 'CHR-021' | 'CHR-022' | 'CHR-041',
  characterDraftId: string,
  compositionDraftRevision: number,
  projectionRevision: number,
): void {
  writeLocalCharacterSymbiontPresentation(database, {
    formId,
    compositionDraftRevision,
    projectionRevision,
    routeBindings: [inherited(characterDraftId)],
    routeTemplate: ROUTES[formId],
  });
}

export function manualCompositionHasAdvisor(composition: SymbiontComposition): boolean {
  return composition.acceptedSpecies.some((accepted) => accepted.speciesKey === 'ADVISER');
}
