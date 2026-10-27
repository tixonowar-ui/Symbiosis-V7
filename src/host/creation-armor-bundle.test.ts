import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ArmorBundleCatalog } from '../domain/index.js';
import { openPersistenceDatabase } from '../persistence/index.js';
import {
  commitArmorBundleCheckpoint,
  commitArmorBundleEntry,
  commitArmorBundleQualityRoll,
} from './creation-armor-bundle.js';
import type {
  ArmorBundleCheckpointRequest,
  ArmorBundleEntryRequest,
  ArmorBundleQualityRollRequest,
  ArmorBundleSelectionInput,
} from './creation-armor-bundle-contract.js';
import {
  currentCreationWizardRevisions,
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  type CreationWizardSymbiontPayload,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import { commitCreationWizardCheckpoint } from './creation-wizard-checkpoint.js';
import {
  createManualWizardSetup,
  manualCompositionRequest,
  type ManualWizardSetup,
} from '../../tests/fixtures/manual-symbiont-stage.js';

const ARMOR_CATALOG: ArmorBundleCatalog = Object.freeze({
  entries: Object.freeze([
    Object.freeze({ itemId: 'ITM-ARM-001', name: 'Кожаный доспех', coverageModel: 'ZONE_ELEMENT' }),
    Object.freeze({ itemId: 'ITM-ARM-002', name: 'Бригантина', coverageModel: 'ZONE_ELEMENT' }),
    Object.freeze({ itemId: 'ITM-ARM-003', name: 'Кольчуга', coverageModel: 'ZONE_ELEMENT' }),
    Object.freeze({ itemId: 'ITM-ARM-004', name: 'Латы', coverageModel: 'ZONE_ELEMENT' }),
    Object.freeze({ itemId: 'ITM-ARM-005', name: 'Нэйт', coverageModel: 'FULL_SUIT' }),
    Object.freeze({ itemId: 'ITM-ARM-006', name: 'Кастелькросс', coverageModel: 'FULL_SUIT' }),
    Object.freeze({ itemId: 'ITM-ARM-007', name: 'Цесмор', coverageModel: 'FULL_SUIT' }),
    Object.freeze({ itemId: 'ITM-ARM-008', name: 'Гленхейм', coverageModel: 'FULL_SUIT' }),
  ]),
});

const SIX_ZONE_SELECTION: readonly ArmorBundleSelectionInput[] = Object.freeze([
  Object.freeze({ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' }),
  Object.freeze({ itemId: 'ITM-ARM-002', bodyZoneOrNull: 'TORSO' }),
  Object.freeze({ itemId: 'ITM-ARM-003', bodyZoneOrNull: 'ARM_L' }),
  Object.freeze({ itemId: 'ITM-ARM-004', bodyZoneOrNull: 'ARM_R' }),
  Object.freeze({ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'LEG_L' }),
  Object.freeze({ itemId: 'ITM-ARM-002', bodyZoneOrNull: 'LEG_R' }),
]);

const FULL_SUIT_SELECTION: readonly ArmorBundleSelectionInput[] = Object.freeze([
  Object.freeze({ itemId: 'ITM-ARM-005', bodyZoneOrNull: null }),
]);

const temporaryDirectories: string[] = [];
const setups: ManualWizardSetup[] = [];
const reopenedDatabases: ReturnType<typeof openPersistenceDatabase>[] = [];
afterEach(() => {
  for (const database of reopenedDatabases.splice(0)) {
    if (database.open) database.close();
  }
  for (const setup of setups.splice(0)) {
    if (setup.database.open) setup.database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryDatabasePath(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return join(directory, 'host.sqlite');
}

function reopenDatabase(path: string): ReturnType<typeof openPersistenceDatabase> {
  const database = openPersistenceDatabase(path);
  reopenedDatabases.push(database);
  return database;
}

function wizardSetup(...args: Parameters<typeof createManualWizardSetup>): ManualWizardSetup {
  const setup = createManualWizardSetup(...args);
  setups.push(setup);
  return setup;
}

function setupAtChr019(
  prefix: string,
  diceInputMode: 'AUTO' | 'MANUAL',
  path: string,
): { setup: ManualWizardSetup; current: DurableCreationWizardCheckpoint } {
  const setup = wizardSetup(prefix, 'FREE', diceInputMode, path);
  const current = commitCreationWizardCheckpoint(
    setup.database,
    manualCompositionRequest(setup, setup.checkpoint, `${prefix}-composition`, ['EEL']),
    `${prefix}-composition-receipt`,
    setup.catalog,
    () => {
      throw new Error('MANUAL flow must not allocate a random sequence');
    },
    {
      allocateRollRequestId: () => {
        throw new Error('non-Advisor composition must not allocate roll IDs');
      },
      sampleD20: () => {
        throw new Error('non-Advisor composition must not sample');
      },
    },
  );
  if (current.nextStageEnvelope.formId !== 'CHR-019') {
    throw new Error('fixture must reach CHR-019');
  }
  return { setup, current };
}

function loadCheckpoint(setup: ManualWizardSetup): DurableCreationWizardCheckpoint {
  return loadCreationWizardCheckpoint(
    setup.database,
    setup.characterDraftId,
    setup.catalog.skillStage,
    setup.catalog,
  );
}

function entryRequest(
  setup: ManualWizardSetup,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
): ArmorBundleEntryRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      characterDraftId: setup.characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      sourceFormId: 'CHR-019',
      stage: 'SYMBIONTS',
      variant: 'ARMOR_BUNDLE_ENTRY',
      wizardCheckpointId: setup.wizardCheckpointId,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  };
}

function qualityRollRequest(
  setup: ManualWizardSetup,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  armorBundleId: string,
  qualityRollRequestId: string,
  armorPieces: readonly ArmorBundleSelectionInput[],
  manualFaceOrNull: number | null,
): ArmorBundleQualityRollRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      armorBundleId,
      armorPieces,
      characterDraftId: setup.characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      manualFaceOrNull,
      qualityRollRequestId,
      sourceFormId: 'CHR-021',
      stage: 'SYMBIONTS',
      variant: 'ARMOR_BUNDLE_QUALITY',
      wizardCheckpointId: setup.wizardCheckpointId,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
  };
}

function bundleCheckpointRequest(
  setup: ManualWizardSetup,
  current: DurableCreationWizardCheckpoint,
  commandId: string,
  armorBundleId: string,
  qualityRollReceiptId: string,
): ArmorBundleCheckpointRequest {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: currentCreationWizardRevisions(current),
    messageType: 'command.request',
    payload: {
      armorBundleId,
      characterDraftId: setup.characterDraftId,
      draftRevision: current.receipt.result.draftRevision,
      qualityRollReceiptId,
      sourceFormId: 'CHR-021',
      stage: 'SYMBIONTS',
      variant: 'ARMOR_BUNDLE_CHECKPOINT',
      wizardCheckpointId: setup.wizardCheckpointId,
    },
    protocolVersion: 1,
    role: 'player',
    workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  };
}

describe('CHR-021 starting armor bundle', () => {
  it('commits entry from a completed manual composition with one bundle id and one quality roll request', () => {
    const path = temporaryDatabasePath('armor-entry-');
    const { setup, current } = setupAtChr019('armor-entry', 'MANUAL', path);
    const dependencies = {
      catalog: setup.catalog,
      allocateArmorBundleId: () => 'armor-entry-bundle',
      allocateQualityRollRequestId: () => 'armor-entry-quality-request',
    };
    const compositionBefore = current.manualCompositionStage;
    const checkpoint = commitArmorBundleEntry(
      setup.database,
      entryRequest(setup, current, 'armor-entry-command'),
      'armor-entry-receipt',
      dependencies,
    );
    expect(checkpoint.nextStageEnvelope).toEqual({
      formId: 'CHR-021',
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: setup.characterDraftId }],
    });
    expect(checkpoint.receipt).toMatchObject({
      commandId: 'armor-entry-command',
      receiptId: 'armor-entry-receipt',
      result: {
        variant: 'ARMOR_BUNDLE_ENTRY',
        sourceFormId: 'CHR-019',
        nextFormId: 'CHR-021',
        armorBundleId: 'armor-entry-bundle',
        qualityRollRequestId: 'armor-entry-quality-request',
        anatomyProfile: 'STANDARD_HUMANOID',
      },
    });
    expect(checkpoint.armorBundleStage).toMatchObject({
      anatomyProfile: 'STANDARD_HUMANOID',
      armorBundleId: 'armor-entry-bundle',
      diceInputModeSnapshot: 'MANUAL',
      qualityRollRequestId: 'armor-entry-quality-request',
      qualityRollRecordOrNull: null,
      checkpointRecordOrNull: null,
    });
    expect(checkpoint.manualCompositionStage).toEqual(compositionBefore);
    expect(
      loadCreationWizardCommandByCommandId(
        setup.database,
        'armor-entry-command',
        setup.catalog.skillStage,
        setup.catalog,
      )?.receipt,
    ).toEqual(checkpoint.receipt);
  });

  it('rejects replayed entry and reports an idempotency conflict on a changed payload', () => {
    const path = temporaryDatabasePath('armor-replay-');
    const { setup, current } = setupAtChr019('armor-replay', 'MANUAL', path);
    const dependencies = {
      catalog: setup.catalog,
      allocateArmorBundleId: () => 'armor-replay-bundle',
      allocateQualityRollRequestId: () => 'armor-replay-quality-request',
    };
    const request = entryRequest(setup, current, 'armor-replay-command');
    commitArmorBundleEntry(setup.database, request, 'armor-replay-receipt', dependencies);
    expect(() =>
      commitArmorBundleEntry(setup.database, request, 'armor-replay-replay', dependencies),
    ).toThrow('GUARD_REJECTED');
    const changedPayload = {
      ...request,
      payload: { ...request.payload, draftRevision: request.payload.draftRevision + 1 },
    };
    expect(() =>
      commitArmorBundleEntry(setup.database, changedPayload, 'armor-replay-changed', dependencies),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    const after = loadCheckpoint(setup);
    expect(after.armorBundleStage?.armorBundleId).toBe('armor-replay-bundle');
    expect(after.armorBundleStage?.qualityRollRecordOrNull).toBeNull();
    expect(after.armorBundleStage?.checkpointRecordOrNull).toBeNull();
  });

  it('rejects entry for PURE and for incomplete symbiont work without initializing anything', () => {
    const purePath = temporaryDatabasePath('armor-pure-');
    const pureSetup = wizardSetup('armor-pure', 'PURE', 'MANUAL', purePath);
    const pureDependencies = {
      catalog: pureSetup.catalog,
      allocateArmorBundleId: () => 'armor-pure-bundle',
      allocateQualityRollRequestId: () => 'armor-pure-quality-request',
    };
    const pureCurrent = loadCheckpoint(pureSetup);
    expect(pureCurrent.nextStageEnvelope.formId).toBe('CHR-017');
    expect(() =>
      commitArmorBundleEntry(
        pureSetup.database,
        entryRequest(pureSetup, pureCurrent, 'armor-pure-command'),
        'armor-pure-receipt',
        pureDependencies,
      ),
    ).toThrow('GUARD_REJECTED');
    expect(loadCheckpoint(pureSetup).armorBundleStage ?? null).toBeNull();

    const pendingPath = temporaryDatabasePath('armor-pending-');
    const pendingSetup = wizardSetup('armor-pending', 'FREE', 'MANUAL', pendingPath);
    const pendingDependencies = {
      catalog: pendingSetup.catalog,
      allocateArmorBundleId: () => 'armor-pending-bundle',
      allocateQualityRollRequestId: () => 'armor-pending-quality-request',
    };
    const pendingCurrent = loadCheckpoint(pendingSetup);
    expect(pendingCurrent.nextStageEnvelope.formId).toBe('CHR-017');
    expect(() =>
      commitArmorBundleEntry(
        pendingSetup.database,
        entryRequest(pendingSetup, pendingCurrent, 'armor-pending-command'),
        'armor-pending-receipt',
        pendingDependencies,
      ),
    ).toThrow('GUARD_REJECTED');
    expect(loadCheckpoint(pendingSetup).armorBundleStage ?? null).toBeNull();
  });

  it('commits an AUTO quality roll with exactly one sampler call and a fixed recommendation', () => {
    const path = temporaryDatabasePath('armor-auto-');
    const { setup, current } = setupAtChr019('armor-auto', 'AUTO', path);
    const entry = commitArmorBundleEntry(
      setup.database,
      entryRequest(setup, current, 'armor-auto-entry-command'),
      'armor-auto-entry-receipt',
      {
        catalog: setup.catalog,
        allocateArmorBundleId: () => 'armor-auto-bundle',
        allocateQualityRollRequestId: () => 'armor-auto-quality-request',
      },
    );
    let samples = 0;
    const rolled = commitArmorBundleQualityRoll(
      setup.database,
      qualityRollRequest(
        setup,
        entry,
        'armor-auto-roll-command',
        'armor-auto-bundle',
        'armor-auto-quality-request',
        SIX_ZONE_SELECTION,
        null,
      ),
      'armor-auto-roll-receipt',
      {
        catalog: setup.catalog,
        armorCatalog: ARMOR_CATALOG,
        sampleD20: () => {
          samples += 1;
          return 16;
        },
      },
    );
    expect(samples).toBe(1);
    expect(rolled.nextStageEnvelope.formId).toBe('CHR-021');
    expect(rolled.receipt).toMatchObject({
      receiptId: 'armor-auto-roll-receipt',
      result: {
        variant: 'ARMOR_BUNDLE_QUALITY',
        nextFormId: 'CHR-021',
        diceInputModeSnapshot: 'AUTO',
        ownershipState: 'OWNED_NOT_EQUIPPED',
        armorBundleId: 'armor-auto-bundle',
        qualityRollRequestId: 'armor-auto-quality-request',
        physicalRoll: {
          kind: 'ARMOR_BUNDLE_QUALITY',
          rollRequestId: 'armor-auto-quality-request',
          rollReceiptId: 'armor-auto-roll-receipt',
          mechanical: { dieSides: 20, rawFace: 16 },
        },
        qualityRecommendation: { kind: 'GOOD', label: 'Хорошее', range: '15–18', rawFace: 16 },
      },
    });
    const stage = rolled.armorBundleStage;
    expect(stage?.qualityRollRecordOrNull?.armorPieces).toHaveLength(6);
    expect(stage?.qualityRollRecordOrNull?.distinctBodyZones).toHaveLength(6);
    expect((rolled.durablePayload as CreationWizardSymbiontPayload).randomReceiptIds).toContain(
      'armor-auto-roll-receipt',
    );
  });

  it('commits a MANUAL quality roll without sampling and without random provenance', () => {
    const path = temporaryDatabasePath('armor-manual-');
    const { setup, current } = setupAtChr019('armor-manual', 'MANUAL', path);
    const entry = commitArmorBundleEntry(
      setup.database,
      entryRequest(setup, current, 'armor-manual-entry-command'),
      'armor-manual-entry-receipt',
      {
        catalog: setup.catalog,
        allocateArmorBundleId: () => 'armor-manual-bundle',
        allocateQualityRollRequestId: () => 'armor-manual-quality-request',
      },
    );
    const provenanceBefore = (entry.durablePayload as CreationWizardSymbiontPayload)
      .randomReceiptIds;
    let samples = 0;
    const rolled = commitArmorBundleQualityRoll(
      setup.database,
      qualityRollRequest(
        setup,
        entry,
        'armor-manual-roll-command',
        'armor-manual-bundle',
        'armor-manual-quality-request',
        FULL_SUIT_SELECTION,
        7,
      ),
      'armor-manual-roll-receipt',
      {
        catalog: setup.catalog,
        armorCatalog: ARMOR_CATALOG,
        sampleD20: () => {
          samples += 1;
          return 20;
        },
      },
    );
    expect(samples).toBe(0);
    expect(rolled.receipt).toMatchObject({
      receiptId: 'armor-manual-roll-receipt',
      result: {
        diceInputModeSnapshot: 'MANUAL',
        physicalRoll: {
          kind: 'ARMOR_BUNDLE_QUALITY',
          mechanical: { dieSides: 20, rawFace: 7 },
        },
        qualityRecommendation: { kind: 'POOR', label: 'Плохое', range: '5–9', rawFace: 7 },
      },
    });
    expect((rolled.durablePayload as CreationWizardSymbiontPayload).randomReceiptIds).toEqual(
      provenanceBefore,
    );
  });

  it('rejects invalid selections before any write or sampler call', () => {
    const invalidCases: readonly {
      readonly name: string;
      readonly pieces: readonly ArmorBundleSelectionInput[];
    }[] = [
      { name: 'empty selection', pieces: [] },
      {
        name: 'too many pieces',
        pieces: [
          ...SIX_ZONE_SELECTION,
          Object.freeze({ itemId: 'ITM-ARM-003', bodyZoneOrNull: 'HEAD' as const }),
        ],
      },
      {
        name: 'duplicate body zone',
        pieces: [
          Object.freeze({ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' as const }),
          Object.freeze({ itemId: 'ITM-ARM-002', bodyZoneOrNull: 'HEAD' as const }),
        ],
      },
      {
        name: 'full suit mixed with a zone element',
        pieces: [
          ...FULL_SUIT_SELECTION,
          Object.freeze({ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' as const }),
        ],
      },
      {
        name: 'unknown armor item',
        pieces: [Object.freeze({ itemId: 'ITM-ARM-009', bodyZoneOrNull: 'HEAD' as const })],
      },
      {
        name: 'forged body zone on a full suit',
        pieces: [Object.freeze({ itemId: 'ITM-ARM-005', bodyZoneOrNull: 'TORSO' as const })],
      },
      {
        name: 'missing body zone on a zone element',
        pieces: [Object.freeze({ itemId: 'ITM-ARM-001', bodyZoneOrNull: null })],
      },
    ];
    for (const invalid of invalidCases) {
      const path = temporaryDatabasePath('armor-invalid-');
      const { setup, current } = setupAtChr019('armor-invalid', 'AUTO', path);
      const entry = commitArmorBundleEntry(
        setup.database,
        entryRequest(setup, current, 'armor-invalid-entry-command'),
        'armor-invalid-entry-receipt',
        {
          catalog: setup.catalog,
          allocateArmorBundleId: () => 'armor-invalid-bundle',
          allocateQualityRollRequestId: () => 'armor-invalid-quality-request',
        },
      );
      let samples = 0;
      const before = entry.localCharacter.payloadJson;
      expect(() =>
        commitArmorBundleQualityRoll(
          setup.database,
          qualityRollRequest(
            setup,
            entry,
            `armor-invalid-roll-${invalid.name}`,
            'armor-invalid-bundle',
            'armor-invalid-quality-request',
            invalid.pieces,
            null,
          ),
          `armor-invalid-receipt-${invalid.name}`,
          {
            catalog: setup.catalog,
            armorCatalog: ARMOR_CATALOG,
            sampleD20: () => {
              samples += 1;
              return 16;
            },
          },
        ),
      ).toThrow('GUARD_REJECTED');
      expect(samples).toBe(0);
      const after = loadCheckpoint(setup);
      expect(after.localCharacter.payloadJson).toBe(before);
      expect(after.armorBundleStage?.qualityRollRecordOrNull ?? null).toBeNull();
    }
  });

  it('rejects a second roll and changed pieces after the roll is committed', () => {
    const path = temporaryDatabasePath('armor-second-roll-');
    const { setup, current } = setupAtChr019('armor-second-roll', 'MANUAL', path);
    const entry = commitArmorBundleEntry(
      setup.database,
      entryRequest(setup, current, 'armor-second-roll-entry-command'),
      'armor-second-roll-entry-receipt',
      {
        catalog: setup.catalog,
        allocateArmorBundleId: () => 'armor-second-roll-bundle',
        allocateQualityRollRequestId: () => 'armor-second-roll-quality-request',
      },
    );
    const rolled = commitArmorBundleQualityRoll(
      setup.database,
      qualityRollRequest(
        setup,
        entry,
        'armor-second-roll-command',
        'armor-second-roll-bundle',
        'armor-second-roll-quality-request',
        SIX_ZONE_SELECTION,
        12,
      ),
      'armor-second-roll-receipt',
      {
        catalog: setup.catalog,
        armorCatalog: ARMOR_CATALOG,
        sampleD20: () => {
          throw new Error('MANUAL roll must not sample');
        },
      },
    );
    expect(() =>
      commitArmorBundleQualityRoll(
        setup.database,
        qualityRollRequest(
          setup,
          rolled,
          'armor-second-roll-again',
          'armor-second-roll-bundle',
          'armor-second-roll-quality-request',
          FULL_SUIT_SELECTION,
          15,
        ),
        'armor-second-roll-again-receipt',
        {
          catalog: setup.catalog,
          armorCatalog: ARMOR_CATALOG,
          sampleD20: () => 15,
        },
      ),
    ).toThrow('GUARD_REJECTED');
    expect(() =>
      commitArmorBundleQualityRoll(
        setup.database,
        qualityRollRequest(
          setup,
          rolled,
          'armor-second-roll-wrong-bundle',
          'another-bundle',
          'armor-second-roll-quality-request',
          SIX_ZONE_SELECTION,
          12,
        ),
        'armor-second-roll-wrong-receipt',
        {
          catalog: setup.catalog,
          armorCatalog: ARMOR_CATALOG,
          sampleD20: () => 12,
        },
      ),
    ).toThrow('GUARD_REJECTED');
  });

  it('commits the final checkpoint to a host-signed CHR-022 exactly once', () => {
    const path = temporaryDatabasePath('armor-checkpoint-');
    const { setup, current } = setupAtChr019('armor-checkpoint', 'MANUAL', path);
    const entry = commitArmorBundleEntry(
      setup.database,
      entryRequest(setup, current, 'armor-checkpoint-entry-command'),
      'armor-checkpoint-entry-receipt',
      {
        catalog: setup.catalog,
        allocateArmorBundleId: () => 'armor-checkpoint-bundle',
        allocateQualityRollRequestId: () => 'armor-checkpoint-quality-request',
      },
    );
    const rolled = commitArmorBundleQualityRoll(
      setup.database,
      qualityRollRequest(
        setup,
        entry,
        'armor-checkpoint-roll-command',
        'armor-checkpoint-bundle',
        'armor-checkpoint-quality-request',
        FULL_SUIT_SELECTION,
        19,
      ),
      'armor-checkpoint-roll-receipt',
      {
        catalog: setup.catalog,
        armorCatalog: ARMOR_CATALOG,
        sampleD20: () => {
          throw new Error('MANUAL roll must not sample');
        },
      },
    );
    expect(() =>
      commitArmorBundleCheckpoint(
        setup.database,
        bundleCheckpointRequest(
          setup,
          rolled,
          'armor-checkpoint-wrong-receipt',
          'armor-checkpoint-bundle',
          'armor-checkpoint-entry-receipt',
        ),
        'armor-checkpoint-wrong-receipt-id',
        { catalog: setup.catalog },
      ),
    ).toThrow('GUARD_REJECTED');
    const checkpoint = commitArmorBundleCheckpoint(
      setup.database,
      bundleCheckpointRequest(
        setup,
        rolled,
        'armor-checkpoint-command',
        'armor-checkpoint-bundle',
        'armor-checkpoint-roll-receipt',
      ),
      'armor-checkpoint-receipt',
      { catalog: setup.catalog },
    );
    expect(checkpoint.nextStageEnvelope).toEqual({
      formId: 'CHR-022',
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: setup.characterDraftId }],
    });
    expect(checkpoint.receipt).toMatchObject({
      receiptId: 'armor-checkpoint-receipt',
      result: {
        variant: 'ARMOR_BUNDLE_CHECKPOINT',
        nextFormId: 'CHR-022',
        ownershipState: 'OWNED_NOT_EQUIPPED',
        armorBundleId: 'armor-checkpoint-bundle',
        qualityRollReceiptId: 'armor-checkpoint-roll-receipt',
        qualityRecommendation: {
          kind: 'EXCEPTIONAL',
          label: 'Исключительное',
          range: '19',
          rawFace: 19,
        },
      },
    });
    expect(checkpoint.armorBundleStage?.checkpointRecordOrNull?.receipt.receiptId).toBe(
      'armor-checkpoint-receipt',
    );
    expect(() =>
      commitArmorBundleCheckpoint(
        setup.database,
        bundleCheckpointRequest(
          setup,
          checkpoint,
          'armor-checkpoint-again',
          'armor-checkpoint-bundle',
          'armor-checkpoint-roll-receipt',
        ),
        'armor-checkpoint-again-receipt',
        { catalog: setup.catalog },
      ),
    ).toThrow('GUARD_REJECTED');
  });

  it('restores the same ids, receipt, and recommendation after a SQLite restart without a new sampler', () => {
    const path = temporaryDatabasePath('armor-restart-');
    const { setup, current } = setupAtChr019('armor-restart', 'AUTO', path);
    const entryCommand = entryRequest(setup, current, 'armor-restart-entry-command');
    const entry = commitArmorBundleEntry(
      setup.database,
      entryCommand,
      'armor-restart-entry-receipt',
      {
        catalog: setup.catalog,
        allocateArmorBundleId: () => 'armor-restart-bundle',
        allocateQualityRollRequestId: () => 'armor-restart-quality-request',
      },
    );
    let samples = 0;
    commitArmorBundleQualityRoll(
      setup.database,
      qualityRollRequest(
        setup,
        entry,
        'armor-restart-roll-command',
        'armor-restart-bundle',
        'armor-restart-quality-request',
        SIX_ZONE_SELECTION,
        null,
      ),
      'armor-restart-roll-receipt',
      {
        catalog: setup.catalog,
        armorCatalog: ARMOR_CATALOG,
        sampleD20: () => {
          samples += 1;
          return 16;
        },
      },
    );
    expect(samples).toBe(1);

    const database = reopenDatabase(path);
    const restored = loadCreationWizardCheckpoint(
      database,
      setup.characterDraftId,
      setup.catalog.skillStage,
      setup.catalog,
    );
    const stage = restored.armorBundleStage;
    expect(stage?.armorBundleId).toBe('armor-restart-bundle');
    expect(stage?.qualityRollRequestId).toBe('armor-restart-quality-request');
    expect(stage?.qualityRollRecordOrNull?.receipt.receiptId).toBe('armor-restart-roll-receipt');
    expect(stage?.qualityRollRecordOrNull?.qualityRecommendation).toEqual({
      kind: 'GOOD',
      label: 'Хорошее',
      range: '15–18',
      rawFace: 16,
    });
    expect(stage?.qualityRollRecordOrNull?.armorPieces).toHaveLength(6);
    expect(restored.nextStageEnvelope.formId).toBe('CHR-021');
    expect(samples).toBe(1);
    expect(
      loadCreationWizardCommandByCommandId(
        database,
        'armor-restart-entry-command',
        setup.catalog.skillStage,
        setup.catalog,
      )?.receipt.result,
    ).toMatchObject({ variant: 'ARMOR_BUNDLE_ENTRY' });

    const restoredSetup: ManualWizardSetup = { ...setup, database };
    expect(() =>
      commitArmorBundleEntry(database, entryCommand, 'armor-restart-replay-receipt', {
        catalog: setup.catalog,
        allocateArmorBundleId: () => 'armor-restart-other-bundle',
        allocateQualityRollRequestId: () => 'armor-restart-other-request',
      }),
    ).toThrow('GUARD_REJECTED');

    const checkpoint = commitArmorBundleCheckpoint(
      database,
      bundleCheckpointRequest(
        restoredSetup,
        restored,
        'armor-restart-checkpoint-command',
        'armor-restart-bundle',
        'armor-restart-roll-receipt',
      ),
      'armor-restart-checkpoint-receipt',
      { catalog: setup.catalog },
    );
    expect(checkpoint.nextStageEnvelope.formId).toBe('CHR-022');
    expect(checkpoint.armorBundleStage?.checkpointRecordOrNull?.receipt.receiptId).toBe(
      'armor-restart-checkpoint-receipt',
    );
    expect(samples).toBe(1);
  });

  it('keeps composition and request intact across repeated reads and safe returns', () => {
    const path = temporaryDatabasePath('armor-safe-return-');
    const { setup, current } = setupAtChr019('armor-safe-return', 'MANUAL', path);
    const composition = current.manualCompositionStage;
    const entry = commitArmorBundleEntry(
      setup.database,
      entryRequest(setup, current, 'armor-safe-return-entry-command'),
      'armor-safe-return-entry-receipt',
      {
        catalog: setup.catalog,
        allocateArmorBundleId: () => 'armor-safe-return-bundle',
        allocateQualityRollRequestId: () => 'armor-safe-return-quality-request',
      },
    );
    const firstRead = loadCheckpoint(setup);
    const secondRead = loadCheckpoint(setup);
    for (const read of [firstRead, secondRead]) {
      expect(read.armorBundleStage?.armorBundleId).toBe('armor-safe-return-bundle');
      expect(read.armorBundleStage?.qualityRollRequestId).toBe('armor-safe-return-quality-request');
      expect(read.armorBundleStage?.qualityRollRecordOrNull ?? null).toBeNull();
      expect(read.manualCompositionStage).toEqual(composition);
      expect(read.receipt).toEqual(entry.receipt);
    }
    expect(
      loadCreationWizardCommandByCommandId(
        setup.database,
        'armor-safe-return-entry-command',
        setup.catalog.skillStage,
        setup.catalog,
      )?.receipt,
    ).toEqual(entry.receipt);
  });
});
