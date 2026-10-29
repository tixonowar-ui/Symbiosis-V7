import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationCorrectionRequest,
} from '../../tests/fixtures/creation-finalization-stage.js';
import {
  commitCreationFinalization,
  advanceCreationFinalizationPresentation,
} from './creation-finalization.js';
import { loadCreationWizardCheckpoint } from './creation-set-decide.js';
import { deriveLocalCharacterCache } from './local-character-cache.js';
import { canonicalPostSaveJson, postSaveSha256 } from './local-character-export.js';
import {
  createManualWizardSetup,
  manualCompositionRequest,
} from '../../tests/fixtures/manual-symbiont-stage.js';
import { commitCreationWizardCheckpoint } from './creation-wizard-checkpoint.js';
import { commitManualComposition } from './creation-manual-composition.js';

type Prepared = Awaited<ReturnType<typeof createCreationFinalizationSetup>>;
const setups: Prepared[] = [];
afterEach(() => {
  for (const p of setups.splice(0)) if (p.setup.database.open) p.setup.database.close();
});
describe('verified immutable branch cache manifest', () => {
  it('keeps each original manual composition and stat receipt prefix before finalization exists', () => {
    const setup = createManualWizardSetup('cache-original', 'FREE', 'AUTO');
    try {
      const dependencies = {
        catalog: setup.catalog,
        allocateRollRequestId: vi.fn(() => {
          throw new Error('no requests');
        }),
        sampleD20: vi.fn(() => {
          throw new Error('no rolls');
        }),
      };
      const initial = deriveLocalCharacterCache(setup.checkpoint, setup.deviceId);
      let current = commitCreationWizardCheckpoint(
        setup.database,
        manualCompositionRequest(setup, setup.checkpoint, 'cache-first', ['EEL']),
        'cache-first-receipt',
        setup.catalog,
        () => {
          throw new Error('no sequence');
        },
        dependencies,
      );
      const first = deriveLocalCharacterCache(current, setup.deviceId);
      current = commitManualComposition(
        setup.database,
        manualCompositionRequest(setup, current, 'cache-second', ['OWL']),
        'cache-second-receipt',
        dependencies,
      );
      const second = deriveLocalCharacterCache(current, setup.deviceId);
      for (const entry of [...initial.entries, ...first.entries])
        expect(second.entries).toContainEqual(entry);
      expect(
        second.entries.find((e) => e.branchUuid === first.selectedBranchUuidOrNull)
          ?.savedAtRevision,
      ).toBe(
        first.entries.find((e) => e.branchUuid === first.selectedBranchUuidOrNull)?.savedAtRevision,
      );
      expect(second.selectedBranchUuidOrNull).not.toBe(first.selectedBranchUuidOrNull);
      const statReceipts = setup.checkpoint.statRollStage!.attempts.flatMap((a) =>
        a.setRecord === null ? [] : [a.setRecord, ...a.confirmationRecords],
      );
      for (const record of statReceipts)
        expect(
          initial.entries.some(
            (e) =>
              e.savedAtRevision === record.receipt.result.draftRevision &&
              e.randomReceiptIds.includes(record.receipt.receiptId),
          ),
        ).toBe(true);
      expect(dependencies.sampleD20).not.toHaveBeenCalled();
      expect(dependencies.allocateRollRequestId).not.toHaveBeenCalled();
    } finally {
      setup.database.close();
    }
  });
  it.each(['AUTO', 'MANUAL'] as const)(
    'retains previous branch versions with their real revisions in %s',
    async (diceInputMode) => {
      const p = await createCreationFinalizationSetup({
        prefix: `cache-${diceInputMode}`,
        raceChoice: 'PURE',
        diceInputMode,
      });
      setups.push(p);
      const dependencies = {
        ...p.dependencies,
        sampleD20: vi.fn(() => {
          throw new Error('cache must not sample');
        }),
      };
      let current = commitCreationFinalization(
        p.setup.database,
        creationPropertySummaryRequest(p.current, 'cache-summary'),
        'cache-summary-receipt',
        dependencies,
      );
      const initial = deriveLocalCharacterCache(current, 'device-A');
      const stateBefore = current.localCharacter.payloadJson;
      const copies = p.setup.database.prepare('SELECT total_changes() AS count').get();
      expect(deriveLocalCharacterCache(current, 'device-A')).toEqual(initial);
      expect(p.setup.database.prepare('SELECT total_changes() AS count').get()).toEqual(copies);
      expect(current.localCharacter.payloadJson).toBe(stateBefore);
      current = advanceCreationFinalizationPresentation(
        p.setup.database,
        {
          characterDraftId: p.setup.characterDraftId,
          wizardCheckpointId: p.setup.wizardCheckpointId,
          formId: 'CHR-010',
        },
        p.setup.catalog,
      );
      current = commitCreationFinalization(
        p.setup.database,
        creationCorrectionRequest(current, 'cache-free', {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'FREE',
          acquisitionModeIfFirstOrNull: 'MANUAL',
        }),
        'cache-free-receipt',
        dependencies,
      );
      const pending = deriveLocalCharacterCache(current, 'device-A');
      advanceCreationFinalizationPresentation(
        p.setup.database,
        {
          characterDraftId: p.setup.characterDraftId,
          wizardCheckpointId: p.setup.wizardCheckpointId,
          formId: 'CHR-017',
        },
        p.setup.catalog,
      );
      current = advanceCreationFinalizationPresentation(
        p.setup.database,
        {
          characterDraftId: p.setup.characterDraftId,
          wizardCheckpointId: p.setup.wizardCheckpointId,
          formId: 'CHR-018',
          speciesKeyOrNull: 'WEAVER',
        },
        p.setup.catalog,
      );
      current = commitCreationFinalization(
        p.setup.database,
        creationCorrectionRequest(current, 'cache-composition', {
          variant: 'CORRECTION_MANUAL_COMPOSITION',
          sourceFormId: 'CHR-018',
          acceptedSpecies: [{ acceptedIndex: 0, speciesKey: 'WEAVER' }],
          selectedBindings: [],
        }),
        'cache-composition-receipt',
        dependencies,
      );
      const confirmed = deriveLocalCharacterCache(current, 'device-A');
      for (const entry of initial.entries) expect(confirmed.entries).toContainEqual(entry);
      for (const entry of pending.entries) expect(confirmed.entries).toContainEqual(entry);
      expect(confirmed.entries.length).toBeGreaterThan(pending.entries.length);
      expect(confirmed.selectedBranchUuidOrNull).not.toBe(pending.selectedBranchUuidOrNull);
      const selected = confirmed.entries.find(
        (e) => e.branchUuid === confirmed.selectedBranchUuidOrNull,
      )!;
      expect(selected.savedAtRevision).toBe(current.receipt.result.draftRevision);
      expect(selected.branchUuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
      expect(confirmed.hash).toBe(
        postSaveSha256(
          `SYMBIOSIS_CACHE_MANIFEST_V1\n${canonicalPostSaveJson({ schemaVersion: 1, characterId: p.setup.characterDraftId, entries: confirmed.entries })}`,
        ),
      );
      const restored = loadCreationWizardCheckpoint(
        p.setup.database,
        p.setup.characterDraftId,
        p.setup.catalog.skillStage,
        p.setup.catalog,
      );
      expect(deriveLocalCharacterCache(restored, 'device-A')).toEqual(confirmed);
      expect(deriveLocalCharacterCache(restored, 'device-B').hash).not.toBe(confirmed.hash);
      expect(dependencies.sampleD20).not.toHaveBeenCalled();
      expect(confirmed.entries.some((e) => e.randomReceiptIds.length > 0)).toBe(
        diceInputMode === 'AUTO',
      );
    },
  );
  it('rejects corrupted replay instead of publishing a fabricated cache manifest', async () => {
    const p = await createCreationFinalizationSetup({
      prefix: 'cache-corrupt',
      raceChoice: 'FREE',
      diceInputMode: 'AUTO',
    });
    setups.push(p);
    const current = commitCreationFinalization(
      p.setup.database,
      creationPropertySummaryRequest(p.current, 'cache-summary'),
      'cache-summary-receipt',
      p.dependencies,
    );
    const payload = JSON.parse(current.localCharacter.payloadJson) as {
      finalizationStage: { records: { afterStateHash: string }[] };
    };
    payload.finalizationStage.records[0]!.afterStateHash = 'a'.repeat(64);
    const payloadJson = JSON.stringify(payload);
    const snapshot = JSON.parse(current.checkpoint.snapshotJson) as {
      localCharacter: { payloadJson: string };
    };
    snapshot.localCharacter.payloadJson = payloadJson;
    const snapshotJson = JSON.stringify(snapshot);
    expect(() =>
      deriveLocalCharacterCache(
        {
          ...current,
          localCharacter: { ...current.localCharacter, payloadJson },
          checkpoint: {
            ...current.checkpoint,
            snapshotJson,
            snapshotSha256: postSaveSha256(snapshotJson),
          },
        },
        'device-A',
      ),
    ).toThrow();
  });
});
