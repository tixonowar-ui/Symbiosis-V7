import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { SymbiontSpeciesKey } from '../../domain/index.js';
import type { openPersistenceDatabase } from '../../persistence/index.js';
import {
  advanceManualSymbiontPresentation,
  handleSymbiontAddressableRoute,
} from '../creation-manual-composition-navigation.js';
import { commitManualComposition } from '../creation-manual-composition.js';
import { commitManualAdvisorIw, commitManualAdvisorSkills } from '../creation-manual-advisor.js';
import { commitAdvisorIntelligenceFloorRoll } from '../creation-advisor-intelligence-floor.js';
import { currentCreationWizardRevisions } from '../creation-set-decide.js';
import { loadCreationSkillCatalog, type CreationSkillCatalog } from '../creation-skill-catalog.js';
import { loadSymbiontMediaCatalog, type SymbiontMediaPreview } from '../symbiont-media.js';
import {
  projectManualChr017,
  projectManualChr018,
  projectManualChr019,
  projectManualChr041,
  projectManualChr042,
  assertManualSymbiontScreenContracts,
} from './chr-manual-symbionts.js';
import { assertScreenContract } from './app.js';
import {
  createManualWizardSetup,
  exactManualAdvisorSkills,
  manualAdvisorFloorRollRequest,
  manualAdvisorIwRequest,
  manualAdvisorSkillRequest,
  manualCompositionRequest,
  type ManualWizardSetup,
} from '../../../tests/fixtures/manual-symbiont-stage.js';
import { CATALOG } from '../../../tests/fixtures/symbiont-stage.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const databases: ReturnType<typeof openPersistenceDatabase>[] = [];
let media: ReadonlyMap<SymbiontSpeciesKey, SymbiontMediaPreview>;
let presentation: CreationSkillCatalog;
let forms: Readonly<Record<string, unknown>>;

beforeAll(async () => {
  [media, presentation, forms] = await Promise.all([
    loadSymbiontMediaCatalog(PROJECT_ROOT),
    loadCreationSkillCatalog(PROJECT_ROOT, CATALOG.skillStage),
    readFile(join(PROJECT_ROOT, 'generated/spec/atlas/forms-by-id.json'), 'utf8').then(
      (source) => JSON.parse(source) as Readonly<Record<string, unknown>>,
    ),
  ]);
});

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
});

function setup(
  prefix: string,
  race: 'FREE' | 'UNITED',
  dice: 'AUTO' | 'MANUAL',
  species: readonly SymbiontSpeciesKey[],
  ids: readonly string[] = [],
  faces: readonly number[] = [],
) {
  const value = createManualWizardSetup(prefix, race, dice);
  databases.push(value.database);
  const allocated: string[] = [];
  const samples: number[] = [];
  const dependencies = {
    catalog: value.catalog,
    allocateRollRequestId: () => {
      const id = ids[allocated.length];
      if (id === undefined) throw new Error('unexpected roll ID allocation');
      allocated.push(id);
      return id;
    },
    sampleD20: () => {
      const face = faces[samples.length];
      if (face === undefined) throw new Error('unexpected sample');
      samples.push(face);
      return face;
    },
  };
  const checkpoint = commitManualComposition(
    value.database,
    manualCompositionRequest(value, value.checkpoint, `${prefix}-composition`, species),
    `${prefix}-composition-receipt`,
    dependencies,
  );
  return { ...value, checkpoint, dependencies, samples };
}

function card(setup: ManualWizardSetup, speciesKey: SymbiontSpeciesKey) {
  return handleSymbiontAddressableRoute(
    setup.database,
    {
      characterDraftId: setup.characterDraftId,
      wizardCheckpointId: setup.wizardCheckpointId,
      speciesKey,
    },
    setup.catalog,
    media,
  );
}

function expectPrivateFieldsAbsent(value: unknown): void {
  const json = JSON.stringify(value);
  for (const forbidden of [
    'ProfileRuleID',
    'ModifierID',
    'Rule IDs',
    'Источник',
    'sourceQuestionIds',
    'availabilityTrace',
    'randomSequenceId',
    'seed',
  ]) {
    expect(json).not.toContain(forbidden);
  }
}

describe('CHR manual symbiont projections', () => {
  it('opens exact media and preserves only projection revision for non-Advisor replacement', () => {
    const initial = createManualWizardSetup('projection-free', 'FREE', 'MANUAL');
    databases.push(initial.database);
    const catalog = projectManualChr017(initial.checkpoint, initial.catalog);
    expect(catalog.availableActionKeys).toEqual(['CHR-017::CTA::001']);
    expect(catalog.roleFilteredPayload).toMatchObject({
      manualCompositionDraft: [],
      symbiontAcquisitionModeOrNull: 'MANUAL',
    });
    expectPrivateFieldsAbsent(catalog);

    const opened = card(initial, 'EEL');
    expect(opened.symbiontPresentationStage).toMatchObject({ formId: 'CHR-018' });
    expect(opened.localCharacter.projectionRevision).toBe(
      initial.checkpoint.localCharacter.projectionRevision + 1,
    );
    expect(opened.localCharacter.stateRevision).toBe(
      initial.checkpoint.localCharacter.stateRevision,
    );
    expect(opened.checkpoint.checkpointRevision).toBe(
      initial.checkpoint.checkpoint.checkpointRevision,
    );
    expect(opened.receipt).toEqual(initial.checkpoint.receipt);
    expect(opened.localCharacter.payloadJson).toBe(initial.checkpoint.localCharacter.payloadJson);
    expect(opened.localCharacter.actorVisibilityRevision).toBe(
      initial.checkpoint.localCharacter.actorVisibilityRevision,
    );
    expect(projectManualChr018(opened, initial.catalog, media, true)).toMatchObject({
      availableActionKeys: ['CHR-018::CTA::001', 'CHR-018::CTA::002', 'CHR-018::CTA::003'],
      roleFilteredPayload: {
        speciesKey: 'EEL',
        artAndTreePreview: {
          artPath: '/generated/media/symbionts/EEL.png',
          developmentTreePath: '/generated/media/development-trees/EEL.png',
        },
        bindingChoiceOrReadOnly: { kind: 'CHOICE', defaultSide: 'RIGHT' },
      },
    });

    const current = commitManualComposition(
      initial.database,
      manualCompositionRequest(
        initial,
        opened,
        'free-add',
        ['EEL'],
        [{ speciesKey: 'EEL', side: 'LEFT' }],
      ),
      'free-add-receipt',
      {
        catalog: initial.catalog,
        allocateRollRequestId: () => {
          throw new Error('no Advisor allocation expected');
        },
        sampleD20: () => {
          throw new Error('no Advisor sample expected');
        },
      },
    );
    const summaryCheckpoint = advanceManualSymbiontPresentation(
      initial.database,
      {
        characterDraftId: initial.characterDraftId,
        wizardCheckpointId: initial.wizardCheckpointId,
        formId: 'CHR-019',
      },
      initial.catalog,
    );
    const summary = projectManualChr019(summaryCheckpoint, initial.catalog);
    expect(summary.roleFilteredPayload).toMatchObject({
      duplicatePolicy: { kind: 'FORBIDDEN' },
      irreversibleBoundaryStatus: 'NOT_CROSSED',
      bindings: [{ binding: { kind: 'EEL_ARM', side: 'LEFT' } }],
      randomReceiptIds: [],
    });
    expect(summary.availableActionKeys).toEqual(['CHR-019::CTA::004', 'CHR-019::CTA::001']);
    expectPrivateFieldsAbsent(summary);

    const catalogAgain = advanceManualSymbiontPresentation(
      initial.database,
      {
        characterDraftId: initial.characterDraftId,
        wizardCheckpointId: initial.wizardCheckpointId,
        formId: 'CHR-017',
      },
      initial.catalog,
    );
    expect(projectManualChr017(catalogAgain, initial.catalog).availableActionKeys).toEqual([
      'CHR-017::CTA::001',
      'CHR-017::CTA::002',
    ]);
    const replacement = card(initial, 'OWL');
    const replacementCard = projectManualChr018(replacement, initial.catalog, media, true);
    expect(replacementCard.roleFilteredPayload).toMatchObject({
      speciesKey: 'OWL',
      compatibility: { kind: 'COMPATIBLE' },
      compositionDraftRevision: current.manualCompositionStage?.compositionDraftRevision,
    });
    expect(replacementCard.availableActionKeys).toContain('CHR-018::CTA::001');
    const duplicate = card(initial, 'EEL');
    const duplicateCard = projectManualChr018(duplicate, initial.catalog, media, true);
    expect(duplicateCard.roleFilteredPayload).toMatchObject({
      speciesKey: 'EEL',
      compatibility: { kind: 'DUPLICATE' },
    });
    expect(duplicateCard.availableActionKeys).not.toContain('CHR-018::CTA::001');
  });

  it('publishes pending I/W without fabricated slots and exact B/skill guards', () => {
    const setupValue = setup(
      'projection-advisor',
      'UNITED',
      'MANUAL',
      ['ADVISER', 'TAIPAN', 'OWL', 'EEL'],
      ['advisor-id', 'pending-i', 'pending-w'],
    );
    const pendingCheckpoint = advanceManualSymbiontPresentation(
      setupValue.database,
      {
        characterDraftId: setupValue.characterDraftId,
        wizardCheckpointId: setupValue.wizardCheckpointId,
        formId: 'CHR-041',
      },
      setupValue.catalog,
    );
    const pending = projectManualChr041(
      pendingCheckpoint,
      setupValue.catalog,
      presentation,
      true,
      true,
    );
    expect(pending.roleFilteredPayload).toMatchObject({
      advisorIPlus8OrNull: null,
      advisorWPlus8OrNull: null,
      iwRollReceiptIds: [null, null],
      advisorSlotsAndSkills: { kind: 'IW_ROLLS_REQUIRED' },
    });
    expect(pending.availableActionKeys).toEqual(['CHR-041::CTA::003']);
    expectPrivateFieldsAbsent(pending);

    const rolled = commitManualAdvisorIw(
      setupValue.database,
      manualAdvisorIwRequest(setupValue, pendingCheckpoint, 'projection-iw', [8, 9]),
      ['projection-i-receipt', 'projection-w-receipt'],
      setupValue.dependencies,
    );
    const skillsReady = projectManualChr041(rolled, setupValue.catalog, presentation, true, true);
    expect(skillsReady.roleFilteredPayload).toMatchObject({
      iwRollReceiptIds: ['projection-i-receipt', 'projection-w-receipt'],
      advisorIPlus8OrNull: 16,
      advisorWPlus8OrNull: 17,
    });
    expect(skillsReady.availableActionKeys).toEqual(['CHR-041::CTA::001', 'CHR-041::CTA::002']);
    expect(skillsReady.roleFilteredPayload.advisorSlotsAndSkills).not.toHaveProperty(
      'kind',
      'IW_ROLLS_REQUIRED',
    );
  });

  it('uses roll-time B and previous/current composition for a non-mutating CHR-042 preview', () => {
    const setupValue = setup(
      'projection-floor',
      'UNITED',
      'MANUAL',
      ['TROGR', 'ADVISER', 'TAIPAN', 'OWL'],
      ['advisor-id', 'pending-i', 'pending-w', 'pending-b'],
    );
    let current = commitManualAdvisorIw(
      setupValue.database,
      manualAdvisorIwRequest(setupValue, setupValue.checkpoint, 'preview-iw', [8, 9]),
      ['preview-i-receipt', 'preview-w-receipt'],
      setupValue.dependencies,
    );
    expect(
      projectManualChr041(current, setupValue.catalog, presentation, true, true)
        .availableActionKeys,
    ).toEqual(['CHR-041::CTA::004', 'CHR-041::CTA::002']);
    current = commitAdvisorIntelligenceFloorRoll(
      setupValue.database,
      manualAdvisorFloorRollRequest(setupValue, current, 'preview-b', 2),
      'preview-b-receipt',
      setupValue.dependencies,
    );
    expect(
      projectManualChr041(current, setupValue.catalog, presentation, true, true)
        .roleFilteredPayload,
    ).toMatchObject({
      trogrSuppressionState: { minimumIOrNull: 2, rollReceiptIdOrNull: 'preview-b-receipt' },
    });
    current = commitManualComposition(
      setupValue.database,
      manualCompositionRequest(setupValue, current, 'preview-teacher', [
        'TROGR',
        'TEACHER',
        'ADVISER',
        'TAIPAN',
      ]),
      'preview-teacher-receipt',
      setupValue.dependencies,
    );
    commitManualAdvisorSkills(
      setupValue.database,
      manualAdvisorSkillRequest(
        setupValue,
        current,
        'preview-skills',
        exactManualAdvisorSkills(current, presentation),
      ),
      'preview-skills-receipt',
      setupValue.dependencies,
    );
    const summary = advanceManualSymbiontPresentation(
      setupValue.database,
      {
        characterDraftId: setupValue.characterDraftId,
        wizardCheckpointId: setupValue.wizardCheckpointId,
        formId: 'CHR-019',
      },
      setupValue.catalog,
    );
    expect(projectManualChr019(summary, setupValue.catalog).availableActionKeys).toEqual([
      'CHR-019::CTA::002',
      'CHR-019::CTA::004',
    ]);
    const before = currentCreationWizardRevisions(summary);
    const previewCheckpoint = advanceManualSymbiontPresentation(
      setupValue.database,
      {
        characterDraftId: setupValue.characterDraftId,
        wizardCheckpointId: setupValue.wizardCheckpointId,
        formId: 'CHR-042',
      },
      setupValue.catalog,
    );
    const preview = projectManualChr042(previewCheckpoint, setupValue.catalog);
    expect(preview.availableActionKeys).toEqual(['CHR-042::CTA::002']);
    expect(preview.roleFilteredPayload).toMatchObject({
      confirmationStatus: 'PREVIEW',
      commandId: 'preview-teacher',
      irreversibleOperationIds: ['ABSORPTION', 'SPECIES_SUPPRESSION'],
      compositionBefore: { speciesKeys: ['TROGR', 'ADVISER', 'TAIPAN', 'OWL'] },
      compositionAfter: { speciesKeys: ['TROGR', 'TEACHER', 'ADVISER', 'TAIPAN'] },
      slotStatOeDiff: { slotUsageBefore: 4, slotUsageAfter: 4 },
    });
    expect(preview.roleFilteredPayload).not.toHaveProperty('randomSequenceId');
    expectPrivateFieldsAbsent(preview);
    expect(currentCreationWizardRevisions(previewCheckpoint)).toEqual({
      ...before,
      projectionRevision: before.projectionRevision + 1,
    });
    expect(previewCheckpoint.localCharacter.payloadJson).toBe(summary.localCharacter.payloadJson);
    expect(previewCheckpoint.checkpoint.checkpointRevision).toBe(
      summary.checkpoint.checkpointRevision,
    );
  });

  it('rejects unknown or missing media before publication and checks Atlas fields', () => {
    const initial = createManualWizardSetup('projection-refusal', 'FREE', 'MANUAL');
    databases.push(initial.database);
    const before = currentCreationWizardRevisions(initial.checkpoint);
    expect(() => card(initial, 'UNKNOWN' as SymbiontSpeciesKey)).toThrow();
    expect(currentCreationWizardRevisions(initial.checkpoint)).toEqual(before);
    const missing = new Map(media);
    missing.delete('EEL');
    expect(() =>
      handleSymbiontAddressableRoute(
        initial.database,
        {
          characterDraftId: initial.characterDraftId,
          wizardCheckpointId: initial.wizardCheckpointId,
          speciesKey: 'EEL',
        },
        initial.catalog,
        missing,
      ),
    ).toThrow();
    expect(currentCreationWizardRevisions(initial.checkpoint)).toEqual(before);
    expect(initial.checkpoint.symbiontPresentationStage).toBeNull();
    assertManualSymbiontScreenContracts(forms, assertScreenContract);
  });
});
