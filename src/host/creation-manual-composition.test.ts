import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openPersistenceDatabase } from '../persistence/index.js';
import { commitCreationWizardCheckpoint } from './creation-wizard-checkpoint.js';
import {
  commitManualComposition,
  latestManualCompositionRecord,
} from './creation-manual-composition.js';
import {
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
} from './creation-set-decide.js';
import {
  createManualWizardSetup,
  manualCompositionRequest,
} from '../../tests/fixtures/manual-symbiont-stage.js';

const temporaryDirectories: string[] = [];
const setups: ReturnType<typeof createManualWizardSetup>[] = [];
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

function reopenDatabase(path: string): ReturnType<typeof openPersistenceDatabase> {
  const database = openPersistenceDatabase(path);
  reopenedDatabases.push(database);
  return database;
}

function manualWizardSetup(
  ...args: Parameters<typeof createManualWizardSetup>
): ReturnType<typeof createManualWizardSetup> {
  const setup = createManualWizardSetup(...args);
  setups.push(setup);
  return setup;
}

function temporaryDatabasePath(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return join(directory, 'host.sqlite');
}

describe('CHR-018 durable manual composition', () => {
  it('adds and replaces non-Advisor composition with exact bindings and idempotent history', () => {
    const path = temporaryDatabasePath('manual-non-advisor-');
    const setup = manualWizardSetup('non-advisor', 'FREE', 'MANUAL', path);
    const dependencies = {
      catalog: setup.catalog,
      allocateRollRequestId: () => {
        throw new Error('non-Advisor must not allocate roll IDs');
      },
      sampleD20: () => {
        throw new Error('non-Advisor must not sample');
      },
    };
    expect(setup.checkpoint.manualCompositionStage).toBeNull();
    expect(setup.checkpoint.randomSymbiontStage).toBeNull();
    expect(setup.checkpoint.receipt.result.stage).toBe('SKILLS');
    expect(setup.checkpoint.nextStageEnvelope.formId).toBe('CHR-017');
    const firstRequest = manualCompositionRequest(setup, setup.checkpoint, 'first-add', ['EEL']);
    let current = commitCreationWizardCheckpoint(
      setup.database,
      firstRequest,
      'first-receipt',
      setup.catalog,
      () => {
        throw new Error('MANUAL must not allocate a random sequence');
      },
      dependencies,
    );
    expect(current.manualCompositionStage).toMatchObject({
      composition: {
        acceptedSpecies: [{ acceptedIndex: 0, speciesKey: 'EEL' }],
        slotUsage: 1,
      },
      compositionDraftRevision: current.receipt.result.draftRevision,
      diceInputModeSnapshot: 'MANUAL',
    });
    expect(current.manualCompositionStage?.compositionRecords).toHaveLength(1);
    expect(current.manualCompositionStage?.advisorInstanceDraftIdOrNull).toBeNull();
    expect(current.manualCompositionStage?.iwRollRequestIdsOrNull).toBeNull();
    expect(current.nextStageEnvelope.formId).toBe('CHR-019');
    expect(current.randomSymbiontStage).toBeNull();
    expect(current.localCharacter.payloadJson).not.toContain('randomSequenceId');
    const firstReceipt = latestManualCompositionRecord(current.manualCompositionStage!)?.receipt;
    expect(firstReceipt?.result).toMatchObject({
      nextFormId: 'CHR-019',
      sourceFormId: 'CHR-018',
      variant: 'MANUAL_COMPOSITION',
      advisorBranch: false,
    });
    expect(
      loadCreationWizardCommandByCommandId(
        setup.database,
        'first-add',
        setup.catalog.skillStage,
        setup.catalog,
      )?.receipt,
    ).toEqual(firstReceipt);
    const firstPayload = current.localCharacter.payloadJson;
    expect(() =>
      commitManualComposition(setup.database, firstRequest, 'replay-receipt', dependencies),
    ).toThrow('GUARD_REJECTED');
    expect(
      loadCreationWizardCheckpoint(
        setup.database,
        setup.characterDraftId,
        setup.catalog.skillStage,
        setup.catalog,
      ).localCharacter.payloadJson,
    ).toBe(firstPayload);

    const secondRequest = manualCompositionRequest(
      setup,
      current,
      'second-add',
      ['OWL'],
      [{ speciesKey: 'OWL', side: 'LEFT' }],
    );
    current = commitManualComposition(
      setup.database,
      secondRequest,
      'second-receipt',
      dependencies,
    );
    expect(current.manualCompositionStage?.compositionRecords).toHaveLength(2);
    expect(current.manualCompositionStage?.composition.acceptedSpecies).toEqual([
      { acceptedIndex: 0, speciesKey: 'OWL' },
    ]);
    expect(current.manualCompositionStage?.compositionRecords[1]?.bindings).toEqual([
      { acceptedIndex: 0, speciesKey: 'OWL', binding: { kind: 'OWL_EYE', side: 'LEFT' } },
    ]);
    const secondReceipt = current.receipt;
    const beforeRefusal = current.localCharacter.payloadJson;
    expect(() =>
      commitManualComposition(
        setup.database,
        manualCompositionRequest(setup, current, 'first-add', ['WEAVER']),
        'changed-payload-receipt',
        dependencies,
      ),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(
      loadCreationWizardCheckpoint(
        setup.database,
        setup.characterDraftId,
        setup.catalog.skillStage,
        setup.catalog,
      ).localCharacter.payloadJson,
    ).toBe(beforeRefusal);
    for (const request of [
      manualCompositionRequest(setup, current, 'pure-removal', []),
      manualCompositionRequest(setup, current, 'duplicate-species', ['OWL', 'OWL']),
      manualCompositionRequest(setup, current, 'overcap', ['OWL', 'EEL', 'WEAVER']),
    ]) {
      expect(() =>
        commitManualComposition(setup.database, request, 'invalid-receipt', dependencies),
      ).toThrow();
      expect(
        loadCreationWizardCheckpoint(
          setup.database,
          setup.characterDraftId,
          setup.catalog.skillStage,
          setup.catalog,
        ).localCharacter.payloadJson,
      ).toBe(beforeRefusal);
    }
    const staleRequest = manualCompositionRequest(setup, setup.checkpoint, 'stale-add', ['EEL']);
    expect(() =>
      commitManualComposition(setup.database, staleRequest, 'stale-receipt', dependencies),
    ).toThrow('STALE_REVISION');
    expect(
      loadCreationWizardCheckpoint(
        setup.database,
        setup.characterDraftId,
        setup.catalog.skillStage,
        setup.catalog,
      ).localCharacter.payloadJson,
    ).toBe(beforeRefusal);
    expect(secondReceipt.result.nextFormId).toBe('CHR-019');
    setup.database.close();

    const reopened = reopenDatabase(path);
    const restored = loadCreationWizardCheckpoint(
      reopened,
      setup.characterDraftId,
      setup.catalog.skillStage,
      setup.catalog,
    );
    expect(restored.manualCompositionStage).toEqual(current.manualCompositionStage);
    expect(restored.localCharacter.payloadJson).toBe(beforeRefusal);
    expect(
      loadCreationWizardCommandByCommandId(
        reopened,
        'first-add',
        setup.catalog.skillStage,
        setup.catalog,
      )?.receipt,
    ).toEqual(firstReceipt);
    expect(
      loadCreationWizardCommandByCommandId(
        reopened,
        'second-add',
        setup.catalog.skillStage,
        setup.catalog,
      )?.receipt,
    ).toEqual(secondReceipt);
    const stage = restored.manualCompositionStage;
    if (stage === null || stage === undefined) throw new Error('expected durable manual stage');
    const corrupt = {
      ...restored.durablePayload,
      manualCompositionStage: {
        ...stage,
        compositionRecords: stage.compositionRecords.map((record, index) =>
          index === 0 ? { ...record, bindings: [] } : record,
        ),
      },
    };
    const payloadJson = JSON.stringify(corrupt);
    const snapshotJson = JSON.stringify({
      localCharacter: {
        localCharacterId: setup.characterDraftId,
        lifecycleState: restored.localCharacter.lifecycleState,
        payloadJson,
      },
    });
    reopened.transaction(() => {
      reopened
        .prepare('UPDATE local_character SET payload_json = ? WHERE local_character_id = ?')
        .run(payloadJson, setup.characterDraftId);
      reopened
        .prepare(
          'UPDATE local_character_checkpoint SET snapshot_json = ?, snapshot_sha256 = ? WHERE checkpoint_id = ?',
        )
        .run(
          snapshotJson,
          createHash('sha256').update(snapshotJson).digest('hex'),
          setup.wizardCheckpointId,
        );
    })();
    expect(() =>
      loadCreationWizardCheckpoint(
        reopened,
        setup.characterDraftId,
        setup.catalog.skillStage,
        setup.catalog,
      ),
    ).toThrow('GUARD_REJECTED');
    reopened.close();
  });

  it('creates only two pending I/W requests and preserves them across Advisor removal and re-addition', () => {
    const path = temporaryDatabasePath('manual-advisor-pending-');
    const setup = manualWizardSetup('advisor-pending', 'UNITED', 'AUTO', path);
    const allocated: string[] = [];
    let sampleCalls = 0;
    const dependencies = {
      catalog: setup.catalog,
      allocateRollRequestId: () => {
        const id = ['advisor-instance', 'pending-i', 'pending-w', 'pending-b'][allocated.length];
        if (id === undefined) throw new Error('unexpected roll ID allocation');
        allocated.push(id);
        return id;
      },
      sampleD20: () => {
        sampleCalls += 1;
        return 10;
      },
    };
    let current = commitManualComposition(
      setup.database,
      manualCompositionRequest(setup, setup.checkpoint, 'advisor-add', [
        'ADVISER',
        'TAIPAN',
        'OWL',
        'EEL',
      ]),
      'advisor-add-receipt',
      dependencies,
    );
    expect(current.manualCompositionStage).toMatchObject({
      advisorInstanceDraftIdOrNull: 'advisor-instance',
      iwRollRequestIdsOrNull: ['pending-i', 'pending-w'],
      advisorIwRecordOrNull: null,
      pendingSuppressionRollRequestIdOrNull: null,
    });
    expect(current.nextStageEnvelope.formId).toBe('CHR-041');
    expect(allocated).toEqual(['advisor-instance', 'pending-i', 'pending-w']);
    expect(sampleCalls).toBe(0);
    expect(current.manualCompositionStage?.compositionRecords).toHaveLength(1);

    current = commitManualComposition(
      setup.database,
      manualCompositionRequest(setup, current, 'advisor-remove', [
        'TAIPAN',
        'OWL',
        'EEL',
        'WEAVER',
      ]),
      'advisor-remove-receipt',
      dependencies,
    );
    expect(current.nextStageEnvelope.formId).toBe('CHR-019');
    expect(current.manualCompositionStage?.advisorInstanceDraftIdOrNull).toBe('advisor-instance');
    expect(current.manualCompositionStage?.iwRollRequestIdsOrNull).toEqual([
      'pending-i',
      'pending-w',
    ]);
    expect(allocated).toHaveLength(3);
    expect(sampleCalls).toBe(0);

    current = commitManualComposition(
      setup.database,
      manualCompositionRequest(setup, current, 'advisor-readd', [
        'ADVISER',
        'TAIPAN',
        'OWL',
        'EEL',
      ]),
      'advisor-readd-receipt',
      dependencies,
    );
    expect(current.nextStageEnvelope.formId).toBe('CHR-041');
    expect(current.manualCompositionStage?.advisorInstanceDraftIdOrNull).toBe('advisor-instance');
    expect(current.manualCompositionStage?.iwRollRequestIdsOrNull).toEqual([
      'pending-i',
      'pending-w',
    ]);
    expect(current.manualCompositionStage?.compositionRecords).toHaveLength(3);
    expect(allocated).toHaveLength(3);
    expect(sampleCalls).toBe(0);
    const stage = current.manualCompositionStage;
    setup.database.close();

    const reopened = reopenDatabase(path);
    const restored = loadCreationWizardCheckpoint(
      reopened,
      setup.characterDraftId,
      setup.catalog.skillStage,
      setup.catalog,
    );
    expect(restored.manualCompositionStage).toEqual(stage);
    expect(restored.manualCompositionStage?.iwRollRequestIdsOrNull).toEqual([
      'pending-i',
      'pending-w',
    ]);
    expect(restored.manualCompositionStage?.advisorIwRecordOrNull).toBeNull();
    reopened.close();
  });
});
