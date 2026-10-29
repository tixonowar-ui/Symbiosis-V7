import { afterEach, describe, expect, it, vi, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
  creationCorrectionRequest,
  prepareOriginalAdvisorBodyLoss,
} from '../../tests/fixtures/creation-finalization-stage.js';
import {
  commitCreationFinalization,
  deriveCreationFinalizationView,
  creationFinalizationPresentationForm,
  advanceCreationFinalizationPresentation,
} from './creation-finalization.js';
import {
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  type DurableCreationWizardCheckpoint,
  currentCreationWizardRevisions,
} from './creation-set-decide.js';
import { readLocalCharacter, openPersistenceDatabase } from '../persistence/index.js';
import { creationFinalizationHash } from './creation-finalization-contract.js';
import {
  createAdvisorSkillStats,
  resolveAdvisorIwRolls,
} from '../domain/rules/symbiont-stage/advisor.js';
import {
  calculateStartSkillSlots,
  validateSkillRequirements,
} from '../domain/rules/skill-stage/skills.js';
import { collectStartingPropertyReceiptRefs } from './creation-property-summary.js';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canonicalCreationFinalizationCatalog,
  loadCreationFinalizationCatalog,
} from './creation-finalization-catalog.js';
import {
  createManualWizardSetup,
  manualCompositionRequest,
} from '../../tests/fixtures/manual-symbiont-stage.js';
import { type SymbiontSpeciesKey } from '../domain/rules/symbiont-stage/catalog.js';
import { deriveCreationFinalMechanics } from '../domain/rules/creation-finalization/mechanics.js';
import { deriveInitialCreationPermanentLedgers } from './creation-finalization-history-ledger.js';
import { commitManualComposition } from './creation-manual-composition.js';
import {
  advanceManualSymbiontPresentation,
  manualInteractionPreview,
} from './creation-manual-composition-navigation.js';
import {
  commitManualInteractionConfirmation,
  manualInteractionDiffJson,
} from './creation-manual-interaction.js';

describe('checkpoint history and final save', () => {
  type Prepared = Awaited<ReturnType<typeof createCreationFinalizationSetup>>;
  const setups: Prepared['setup'][] = [];
  afterEach(() => {
    for (const setup of setups.splice(0)) if (setup.database.open) setup.database.close();
  });
  async function pending(
    raceChoice: 'FREE' | 'PURE' = 'FREE',
    diceInputMode: 'MANUAL' | 'AUTO' = 'MANUAL',
    massKg?: number,
  ) {
    const prepared = await createCreationFinalizationSetup({
      prefix: `final-${raceChoice}-${diceInputMode}`,
      raceChoice,
      diceInputMode,
      ...(massKg === undefined ? {} : { massKg }),
    });
    setups.push(prepared.setup);
    return {
      ...prepared,
      dependencies: {
        ...prepared.dependencies,
        sampleD20: vi.fn(() => {
          throw new Error('summary/final save must not sample');
        }),
      },
    };
  }
  function reload(prepared: Prepared) {
    return loadCreationWizardCheckpoint(
      prepared.setup.database,
      prepared.setup.characterDraftId,
      prepared.setup.catalog.skillStage,
      prepared.setup.catalog,
    );
  }

  describe('CHR-032/025 durable final save', () => {
    it('rolls back the FINAL lifecycle and snapshot when checkpoint persistence fails', async () => {
      const prepared = await pending();
      const { setup, dependencies } = prepared;
      const current = commitCreationFinalization(
        setup.database,
        creationPropertySummaryRequest(prepared.current, 'rollback-summary'),
        'rollback-summary-receipt',
        dependencies,
      );
      setup.database.exec(
        "CREATE TEMP TRIGGER fail_final_checkpoint BEFORE UPDATE ON local_character_checkpoint BEGIN SELECT RAISE(ABORT, 'final checkpoint failure'); END",
      );
      const request = creationFinalSaveRequest(current, 'rollback-final');
      expect(() =>
        commitCreationFinalization(setup.database, request, 'rollback-final-receipt', dependencies),
      ).toThrow('final checkpoint failure');
      setup.database.exec('DROP TRIGGER fail_final_checkpoint');
      expect(reload(prepared).localCharacter).toEqual(current.localCharacter);
      expect(reload(prepared).checkpoint).toEqual(current.checkpoint);
      expect(
        loadCreationWizardCommandByCommandId(
          setup.database,
          request.commandId,
          setup.catalog.skillStage,
          setup.catalog,
        ),
      ).toBeNull();
      expect(dependencies.sampleD20).not.toHaveBeenCalled();
    });

    it('rejects wrong operation routes, foreign summary references and changed correction heads with zero writes', async () => {
      const prepared = await pending();
      const { setup, dependencies } = prepared;
      const current = commitCreationFinalization(
        setup.database,
        creationPropertySummaryRequest(prepared.current, 'guard-summary'),
        'guard-summary-receipt',
        dependencies,
      );
      const request = creationFinalSaveRequest(current, 'guard-final');
      for (const changed of [
        { ...request, transition: { ...request.transition, trigger: 'OP-CHAR-CREATE' } },
        { ...request, payload: { ...request.payload, summaryReceiptId: 'foreign-summary' } },
        { ...request, payload: { ...request.payload, correctionHeadHash: '0'.repeat(64) } },
        { ...request, payload: { ...request.payload, characterDraftId: 'foreign-owner' } },
      ])
        expect(() =>
          commitCreationFinalization(setup.database, changed, 'guard-final-receipt', dependencies),
        ).toThrow();
      expect(() => commitCreationFinalization(setup.database, request, '', dependencies)).toThrow();
      expect(reload(prepared).localCharacter).toEqual(current.localCharacter);
      expect(dependencies.sampleD20).not.toHaveBeenCalled();
    });

    it.each(['SUMMARY', 'FINAL'] as const)(
      'restores %s across an actual SQLite close/reopen without new effects',
      async (phase) => {
        const directory = await mkdtemp(join(tmpdir(), 'symbiosis-final-reopen-'));
        let reopened: ReturnType<typeof openPersistenceDatabase> | undefined;
        try {
          const prepared = await createCreationFinalizationSetup({
            prefix: `final-reopen-${phase}`,
            databasePath: join(directory, 'state.sqlite'),
          });
          setups.push(prepared.setup);
          let current = commitCreationFinalization(
            prepared.setup.database,
            creationPropertySummaryRequest(prepared.current, 'reopen-summary'),
            'reopen-summary-receipt',
            prepared.dependencies,
          );
          if (phase === 'FINAL')
            current = commitCreationFinalization(
              prepared.setup.database,
              creationFinalSaveRequest(current, 'reopen-final'),
              'reopen-final-receipt',
              prepared.dependencies,
            );
          prepared.setup.database.close();
          reopened = openPersistenceDatabase(join(directory, 'state.sqlite'));
          const restored = loadCreationWizardCheckpoint(
            reopened,
            prepared.setup.characterDraftId,
            prepared.setup.catalog.skillStage,
            prepared.setup.catalog,
          );
          expect(restored.localCharacter).toEqual(current.localCharacter);
          expect(restored.checkpoint).toEqual(current.checkpoint);
          expect(restored.finalizationStage).toEqual(current.finalizationStage);
          expect(creationFinalizationPresentationForm(restored)).toBe('CHR-025');
        } finally {
          if (reopened?.open) reopened.close();
          await rm(directory, { recursive: true, force: true });
        }
      },
    );

    it('detects a coordinated final mechanics mutation even with a valid outer SQLite snapshot checksum', async () => {
      const prepared = await pending();
      const { setup, dependencies } = prepared;
      let current = commitCreationFinalization(
        setup.database,
        creationPropertySummaryRequest(prepared.current, 'tamper-summary'),
        'tamper-summary-receipt',
        dependencies,
      );
      current = commitCreationFinalization(
        setup.database,
        creationFinalSaveRequest(current, 'tamper-final'),
        'tamper-final-receipt',
        dependencies,
      );
      const payload = JSON.parse(current.localCharacter.payloadJson) as {
        finalizationStage: {
          finalMechanicsSnapshotOrNull: { mechanics: { effectiveStats: { S: number } } };
        };
      };
      payload.finalizationStage.finalMechanicsSnapshotOrNull.mechanics.effectiveStats.S++;
      const payloadJson = JSON.stringify(payload);
      const snapshot = JSON.parse(current.checkpoint.snapshotJson) as {
        localCharacter: { payloadJson: string };
      };
      snapshot.localCharacter.payloadJson = payloadJson;
      const snapshotJson = JSON.stringify(snapshot);
      setup.database.transaction(() => {
        setup.database
          .prepare('UPDATE local_character SET payload_json=? WHERE local_character_id=?')
          .run(payloadJson, setup.characterDraftId);
        setup.database
          .prepare(
            'UPDATE local_character_checkpoint SET snapshot_json=?,snapshot_sha256=? WHERE checkpoint_id=?',
          )
          .run(
            snapshotJson,
            createHash('sha256').update(snapshotJson).digest('hex'),
            setup.wizardCheckpointId,
          );
      })();
      expect(() => reload(prepared)).toThrow();
      expect(dependencies.sampleD20).not.toHaveBeenCalled();
    });

    it('rejects malformed property witnesses before any allocation, sampling or write', async () => {
      const prepared = await pending();
      const { setup, current, dependencies } = prepared;
      const request = creationPropertySummaryRequest(current, 'bad-summary');
      const refs = request.payload.propertyRollReceipts;
      for (const changed of [
        refs.slice(0, 7),
        [...refs, refs[0]!],
        refs.map((r, i) => (i === 7 ? refs[3]! : r)),
        refs.map((r, i) => (i === 0 ? { ...r, block: 'MONEY' as const } : r)),
        refs.map((r, i) => (i === 2 ? { ...r, rollReceiptId: 'foreign-receipt' } : r)),
      ])
        expect(() =>
          commitCreationFinalization(
            setup.database,
            { ...request, payload: { ...request.payload, propertyRollReceipts: changed } },
            'bad-summary-receipt',
            dependencies,
          ),
        ).toThrow();
      expect(reload(prepared).localCharacter).toEqual(current.localCharacter);
      expect(reload(prepared).checkpoint).toEqual(current.checkpoint);
      expect(dependencies.sampleD20).not.toHaveBeenCalled();
    });

    it('preserves all property receipts and the accepted base when race is edited under the current correction context', async () => {
      const prepared = await pending();
      const { setup, dependencies } = prepared;
      const summarized = commitCreationFinalization(
        setup.database,
        creationPropertySummaryRequest(prepared.current, 'identity-summary'),
        'identity-summary-receipt',
        dependencies,
      );
      const race = advanceCreationFinalizationPresentation(
        setup.database,
        {
          characterDraftId: setup.characterDraftId,
          wizardCheckpointId: setup.wizardCheckpointId,
          formId: 'CHR-010',
        },
        setup.catalog,
      );
      const changedRace = commitCreationFinalization(
        setup.database,
        creationCorrectionRequest(race, 'identity-to-united', {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'UNITED',
          acquisitionModeIfFirstOrNull: null,
        }),
        'identity-to-united-receipt',
        dependencies,
      );
      expect(changedRace.statAssignmentStage).toEqual(summarized.statAssignmentStage);
      expect(changedRace.armorBundleStage).toEqual(summarized.armorBundleStage);
      expect(changedRace.startingWeaponStage).toEqual(summarized.startingWeaponStage);
      expect(changedRace.startingMoneyStage).toEqual(summarized.startingMoneyStage);
      expect(changedRace.fiveStartingPositionsStage).toEqual(summarized.fiveStartingPositionsStage);
      expect(changedRace.identityStage).toEqual(summarized.identityStage);
      expect(deriveCreationFinalizationView(changedRace, dependencies).state.branches).toHaveLength(
        2,
      );
      expect(dependencies.sampleD20).not.toHaveBeenCalled();
    });

    it('exposes a real mass blocker after a race change and corrects it without altering frozen sex or the original identity receipt', async () => {
      const prepared = await pending('FREE', 'MANUAL', 150);
      const { setup, dependencies } = prepared;
      let current = commitCreationFinalization(
        setup.database,
        creationPropertySummaryRequest(prepared.current, 'mass-summary'),
        'mass-summary-receipt',
        dependencies,
      );
      current = advanceCreationFinalizationPresentation(
        setup.database,
        {
          characterDraftId: setup.characterDraftId,
          wizardCheckpointId: setup.wizardCheckpointId,
          formId: 'CHR-010',
        },
        setup.catalog,
      );
      current = commitCreationFinalization(
        setup.database,
        creationCorrectionRequest(current, 'mass-united', {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'UNITED',
          acquisitionModeIfFirstOrNull: null,
        }),
        'mass-united-receipt',
        dependencies,
      );
      expect(creationFinalizationPresentationForm(current)).toBe('CHR-019');
      current = advanceCreationFinalizationPresentation(
        setup.database,
        {
          characterDraftId: setup.characterDraftId,
          wizardCheckpointId: setup.wizardCheckpointId,
          formId: 'CHR-017',
        },
        setup.catalog,
      );
      current = advanceCreationFinalizationPresentation(
        setup.database,
        {
          characterDraftId: setup.characterDraftId,
          wizardCheckpointId: setup.wizardCheckpointId,
          formId: 'CHR-018',
          speciesKeyOrNull: 'EEL',
        },
        setup.catalog,
      );
      current = commitCreationFinalization(
        setup.database,
        creationCorrectionRequest(current, 'mass-composition', {
          variant: 'CORRECTION_MANUAL_COMPOSITION',
          sourceFormId: 'CHR-018',
          acceptedSpecies: [
            { acceptedIndex: 0, speciesKey: 'EEL' },
            { acceptedIndex: 1, speciesKey: 'OWL' },
            { acceptedIndex: 2, speciesKey: 'SPIDER' },
            { acceptedIndex: 3, speciesKey: 'TAIPAN' },
          ],
          selectedBindings: [
            { speciesKey: 'EEL', side: 'LEFT' },
            { speciesKey: 'OWL', side: 'RIGHT' },
          ],
        }),
        'mass-composition-receipt',
        dependencies,
      );
      const invalidView = deriveCreationFinalizationView(current, dependencies);
      expect(invalidView.identityAndMassStatus).toMatchObject({
        valid: false,
        minimumKg: 25,
        maximumKg: 120,
      });
      expect(invalidView.validationBlockers).toContainEqual(
        expect.objectContaining({ kind: 'IDENTITY_OR_MASS', returnFormId: 'CHR-001' }),
      );
      expect(() =>
        commitCreationFinalization(
          setup.database,
          creationFinalSaveRequest(current, 'mass-blocked-save'),
          'mass-blocked-save-receipt',
          dependencies,
        ),
      ).toThrow();
      current = advanceCreationFinalizationPresentation(
        setup.database,
        {
          characterDraftId: setup.characterDraftId,
          wizardCheckpointId: setup.wizardCheckpointId,
          formId: 'CHR-001',
        },
        setup.catalog,
      );
      const identity = {
        ...deriveCreationFinalizationView(current, dependencies).state.identity,
        massKg: 110,
        name: 'Updated identity',
      };
      const before = current;
      expect(() =>
        commitCreationFinalization(
          setup.database,
          creationCorrectionRequest(current, 'mass-sex-change', {
            variant: 'CORRECTION_IDENTITY',
            sourceFormId: 'CHR-001',
            identity: { ...identity, sex: 'MALE' },
          }),
          'mass-sex-change-receipt',
          dependencies,
        ),
      ).toThrow();
      expect(reload(prepared).localCharacter).toEqual(before.localCharacter);
      current = commitCreationFinalization(
        setup.database,
        creationCorrectionRequest(current, 'mass-fix', {
          variant: 'CORRECTION_IDENTITY',
          sourceFormId: 'CHR-001',
          identity,
        }),
        'mass-fix-receipt',
        dependencies,
      );
      expect(
        deriveCreationFinalizationView(current, dependencies).identityAndMassStatus.valid,
      ).toBe(true);
      expect(deriveCreationFinalizationView(current, dependencies).validationBlockers).toEqual([]);
      expect(current.identityStage).toEqual(prepared.current.identityStage);
      expect(current.identityStage.request.payload.massKg).toBe(150);
      expect(current.fiveStartingPositionsStage).toEqual(
        prepared.current.fiveStartingPositionsStage,
      );
      expect(dependencies.sampleD20).not.toHaveBeenCalled();
    });

    it('restores the untouched historical property-resume chain before the first summary commit', async () => {
      const prepared = await pending();
      const before = prepared.current;
      const profile = before.weaponProfileStage!.kind === 'FORMULA' ? 'CHR-023' : 'CHR-024';
      for (const formId of [
        'CHR-021',
        'CHR-022',
        profile,
        'CHR-038',
        'CHR-037',
        'CHR-032',
      ] as const) {
        const current = advanceCreationFinalizationPresentation(
          prepared.setup.database,
          {
            characterDraftId: prepared.setup.characterDraftId,
            wizardCheckpointId: prepared.setup.wizardCheckpointId,
            formId,
          },
          prepared.setup.catalog,
        );
        expect(creationFinalizationPresentationForm(current)).toBe(formId);
        expect(current.localCharacter.payloadJson).toBe(before.localCharacter.payloadJson);
        expect(current.checkpoint.checkpointRevision).toBe(before.checkpoint.checkpointRevision);
      }
    });

    it.each(['FREE', 'PURE'] as const)(
      'validates eight receipts and saves exactly the same %s character atomically',
      async (race) => {
        const prepared = await pending(race);
        const { setup, dependencies } = prepared;
        expect(creationFinalizationPresentationForm(prepared.current)).toBe('CHR-032');
        const summarized = commitCreationFinalization(
          setup.database,
          creationPropertySummaryRequest(prepared.current, 'summary-command'),
          'summary-receipt',
          dependencies,
        );
        expect(creationFinalizationPresentationForm(summarized)).toBe('CHR-025');
        const view = deriveCreationFinalizationView(summarized, dependencies);
        expect(view.validationBlockers).toEqual([]);
        const request = creationFinalSaveRequest(summarized, 'final-save-command');
        const saved = commitCreationFinalization(
          setup.database,
          request,
          'final-save-receipt',
          dependencies,
        );
        expect(saved.localCharacter.localCharacterId).toBe(
          prepared.current.localCharacter.localCharacterId,
        );
        expect(saved.localCharacter.lifecycleState).toBe('FINAL');
        expect(saved.receipt.result).toMatchObject({
          finalSaveStatus: 'COMMITTED',
          nextFormId: 'CHR-040',
        });
        expect(saved.nextStageEnvelope.formId).toBe('CHR-040');
        expect(creationFinalizationPresentationForm(saved)).toBe('CHR-025');
        expect(reload(prepared).finalizationStage).toEqual(saved.finalizationStage);
        expect(readLocalCharacter(setup.database, setup.characterDraftId)?.lifecycleState).toBe(
          'FINAL',
        );
        expect(
          loadCreationWizardCommandByCommandId(
            setup.database,
            request.commandId,
            setup.catalog.skillStage,
            setup.catalog,
          )?.receipt,
        ).toEqual(saved.receipt);
        expect(dependencies.sampleD20).not.toHaveBeenCalled();
      },
    );
  });
});

describe('correction branches and receipts', () => {
  type Setup = Awaited<ReturnType<typeof createCreationFinalizationSetup>>;
  const setups: Setup[] = [];
  afterEach(() => {
    for (const p of setups.splice(0)) if (p.setup.database.open) p.setup.database.close();
  });
  async function prepare(mode: 'AUTO' | 'MANUAL' = 'MANUAL') {
    const p = await createCreationFinalizationSetup({
      prefix: `correction-${mode}`,
      diceInputMode: mode,
      raceChoice: 'PURE',
    });
    setups.push(p);
    const sample = vi.fn(() => 2);
    const dependencies = { ...p.dependencies, sampleD20: sample };
    const current = commitCreationFinalization(
      p.setup.database,
      creationPropertySummaryRequest(p.current, 'summary'),
      'summary-receipt',
      dependencies,
    );
    return { ...p, current, dependencies, sample };
  }
  function navigate(
    p: Setup,
    formId: Parameters<typeof advanceCreationFinalizationPresentation>[1]['formId'],
    speciesKeyOrNull?: string,
  ) {
    return advanceCreationFinalizationPresentation(
      p.setup.database,
      {
        characterDraftId: p.setup.characterDraftId,
        wizardCheckpointId: p.setup.wizardCheckpointId,
        formId,
        ...(speciesKeyOrNull === undefined ? {} : { speciesKeyOrNull }),
      },
      p.setup.catalog,
    );
  }
  function reload(p: Setup) {
    return loadCreationWizardCheckpoint(
      p.setup.database,
      p.setup.characterDraftId,
      p.setup.catalog.skillStage,
      p.setup.catalog,
    );
  }
  describe('final correction acquisition cache', () => {
    it('edits a valid identity before FINAL while keeping the immutable sex and original identity receipt', async () => {
      const p = await prepare();
      const original = deriveCreationFinalizationView(p.current, p.dependencies);
      expect(original.identityAndMassStatus.valid).toBe(true);
      const current = navigate(p, 'CHR-001');
      const identity = { ...original.state.identity, name: 'Исправленное имя' };
      const request = creationCorrectionRequest(current, 'identity-edit', {
        variant: 'CORRECTION_IDENTITY',
        sourceFormId: 'CHR-001',
        identity,
      });
      expect(() =>
        commitCreationFinalization(
          p.setup.database,
          creationCorrectionRequest(current, 'wrong-sex', {
            variant: 'CORRECTION_IDENTITY',
            sourceFormId: 'CHR-001',
            identity: { ...identity, sex: identity.sex === 'FEMALE' ? 'MALE' : 'FEMALE' },
          }),
          'wrong-sex-receipt',
          p.dependencies,
        ),
      ).toThrow();
      expect(reload(p).localCharacter).toEqual(current.localCharacter);
      const edited = commitCreationFinalization(
        p.setup.database,
        request,
        'identity-edit-receipt',
        p.dependencies,
      );
      expect(deriveCreationFinalizationView(edited, p.dependencies).state.identity).toEqual(
        identity,
      );
      expect(edited.identityStage).toEqual(p.current.identityStage);
      expect(collectStartingPropertyReceiptRefs(edited)).toEqual(
        collectStartingPropertyReceiptRefs(p.current),
      );
      expect(p.sample).not.toHaveBeenCalled();
    });
    it('opens the existing PURE class for correction without discarding it before confirmation', async () => {
      const p = await prepare();
      const previous = deriveCreationFinalizationView(p.current, p.dependencies).activeBranch
        .classCode!;
      let current = commitCreationFinalization(
        p.setup.database,
        creationCorrectionRequest(navigate(p, 'CHR-010'), 'same-pure', {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'PURE',
          acquisitionModeIfFirstOrNull: null,
        }),
        'same-pure-receipt',
        p.dependencies,
      );
      expect(current.nextStageEnvelope.formId).toBe('CHR-011');
      expect(deriveCreationFinalizationView(current, p.dependencies).activeBranch.classCode).toBe(
        previous,
      );
      const replacement = p.setup.catalog.skillStage.classes.find(
        (c) => c.classCode !== previous,
      )!.classCode;
      current = commitCreationFinalization(
        p.setup.database,
        creationCorrectionRequest(current, 'replace-class', {
          variant: 'CORRECTION_CLASS',
          sourceFormId: 'CHR-011',
          pureClass: replacement,
        }),
        'replace-class-receipt',
        p.dependencies,
      );
      expect(deriveCreationFinalizationView(current, p.dependencies).activeBranch.classCode).toBe(
        replacement,
      );
      expect(current.pureClassStage).toEqual(p.current.pureClassStage);
      expect(reload(p).finalizationStage).toEqual(current.finalizationStage);
      expect(p.sample).not.toHaveBeenCalled();
    });
    it.each([false, true])(
      'keeps one Advisor card, permanent skill loss and cached suppression B: %s',
      async (suppressed) => {
        const p = await prepare('AUTO');
        let serial = 0;
        const commit = (
          current: DurableCreationWizardCheckpoint,
          extra: Parameters<typeof creationCorrectionRequest>[2],
        ) =>
          commitCreationFinalization(
            p.setup.database,
            creationCorrectionRequest(current, `advisor-${String(++serial)}`, extra),
            `advisor-receipt-${String(serial)}`,
            p.dependencies,
          );
        let current = commit(navigate(p, 'CHR-010'), {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'FREE',
          acquisitionModeIfFirstOrNull: suppressed ? 'RANDOM' : 'MANUAL',
        });
        const roll = (face: number) => {
          p.sample.mockReturnValue(face);
          current = commit(current, {
            variant: 'CORRECTION_RANDOM_ROLL',
            sourceFormId: 'CHR-020',
            pendingRollRequestId: deriveCreationFinalizationView(current, p.dependencies)
              .pendingRollRequestIds[0]!,
            manualFaceOrNull: null,
            selectedMonsterSpeciesKeyOrNull: null,
          });
        };
        if (suppressed) {
          for (const face of [9, 2, 2]) roll(face);
          current = commit(current, {
            variant: 'CORRECTION_RANDOM_BINDINGS',
            sourceFormId: 'CHR-020',
            selectedBindings: [],
          });
        } else {
          navigate(p, 'CHR-017');
          current = navigate(p, 'CHR-018', 'ADVISER');
          current = commit(current, {
            variant: 'CORRECTION_MANUAL_COMPOSITION',
            sourceFormId: 'CHR-018',
            acceptedSpecies: [{ acceptedIndex: 0, speciesKey: 'ADVISER' }],
            selectedBindings: [],
          });
          const ids = deriveCreationFinalizationView(current, p.dependencies).pendingRollRequestIds;
          p.sample.mockReturnValue(2);
          current = commit(current, {
            variant: 'CORRECTION_ADVISOR_IW',
            sourceFormId: 'CHR-041',
            pendingRollRequestIds: [ids[0]!, ids[1]!],
            manualFacesOrNull: null,
          });
        }
        const view = deriveCreationFinalizationView(current, p.dependencies);
        const body = view.mechanics!.effectiveStats;
        const iw = view.activeBranch.advisorOrNull!.physicalRolls;
        const advisorStats = createAdvisorSkillStats({
          advisorIw: resolveAdvisorIwRolls([
            iw.find((r) => r.kind === 'ADVISOR_I')!.mechanical,
            iw.find((r) => r.kind === 'ADVISOR_W')!.mechanical,
          ]),
          bodyStats: { S: body.S, D: body.D, M: body.M, Z: body.Z, C: body.C },
        });
        const capacity = calculateStartSkillSlots(advisorStats);
        const selections = p.setup.catalog.skillStage.skills
          .filter((s) => {
            if (s.category !== 'SELECTABLE_GENERAL') return false;
            try {
              validateSkillRequirements(p.setup.catalog.skillStage, s.skillKey, advisorStats);
              return true;
            } catch {
              return false;
            }
          })
          .sort((a, b) => Number(b.skillKey === 'GROSS') - Number(a.skillKey === 'GROSS'))
          .slice(0, capacity)
          .map((s) => ({ skillKey: s.skillKey, targetBonus: 1 }));
        expect(selections).toHaveLength(capacity);
        current = commit(current, {
          variant: 'CORRECTION_ADVISOR_SKILLS',
          sourceFormId: 'CHR-041',
          selectedSkills: selections,
        });
        const freeCard = deriveCreationFinalizationView(current, p.dependencies).activeBranch
          .advisorOrNull!;
        current = commit(navigate(p, 'CHR-010'), {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'UNITED',
          acquisitionModeIfFirstOrNull: null,
        });
        if (suppressed) {
          const origins = [7, 4, 2];
          for (let step = 0; step < 10; step++) {
            const next = deriveCreationFinalizationView(current, p.dependencies).randomStateOrNull!
              .nextRequest.kind;
            if (next === 'BINDING') break;
            expect(['SPECIES_ORIGIN', 'TROGR_SUPPRESSION_B']).toContain(next);
            roll(next === 'TROGR_SUPPRESSION_B' ? 4 : origins.shift()!);
          }
          expect(origins).toEqual([]);
          current = commit(current, {
            variant: 'CORRECTION_RANDOM_BINDINGS',
            sourceFormId: 'CHR-020',
            selectedBindings: [],
          });
        } else {
          navigate(p, 'CHR-017');
          current = navigate(p, 'CHR-018', 'ADVISER');
          current = commit(current, {
            variant: 'CORRECTION_MANUAL_COMPOSITION',
            sourceFormId: 'CHR-018',
            acceptedSpecies: ['ADVISER', 'TAIPAN', 'OWL', 'ARMADILLO'].map(
              (speciesKey, acceptedIndex) => ({
                acceptedIndex,
                speciesKey: speciesKey as 'ADVISER' | 'TAIPAN' | 'OWL' | 'ARMADILLO',
              }),
            ),
            selectedBindings: [],
          });
        }
        if (!suppressed) {
          const changed = deriveCreationFinalizationView(current, p.dependencies);
          expect(changed.activeBranch.advisorOrNull!.skillsConfirmed).toBe(false);
          expect(
            changed.activeBranch.advisorOrNull!.learnedSkills.some((s) => s.skillKey === 'GROSS'),
          ).toBe(false);
          const changedBody = changed.mechanics!.effectiveStats;
          const changedStats = {
            ...advisorStats,
            S: changedBody.S,
            D: changedBody.D,
            M: changedBody.M,
            Z: changedBody.Z,
            C: changedBody.C,
          };
          const replacement = p.setup.catalog.skillStage.skills
            .filter((s) => {
              if (s.category !== 'SELECTABLE_GENERAL') return false;
              try {
                validateSkillRequirements(p.setup.catalog.skillStage, s.skillKey, changedStats);
                return true;
              } catch {
                return false;
              }
            })
            .slice(0, capacity)
            .map((s) => ({ skillKey: s.skillKey, targetBonus: 1 }));
          current = commit(current, {
            variant: 'CORRECTION_ADVISOR_SKILLS',
            sourceFormId: 'CHR-041',
            selectedSkills: replacement,
          });
        }
        const united = deriveCreationFinalizationView(current, p.dependencies).activeBranch;
        expect(united.advisorOrNull!.advisorInstanceDraftId).toBe(freeCard.advisorInstanceDraftId);
        if (suppressed)
          expect(united.advisorOrNull!.selectedSkills).toEqual(freeCard.selectedSkills);
        else
          expect(united.advisorOrNull!.selectedSkills.some((s) => s.skillKey === 'GROSS')).toBe(
            false,
          );
        expect(
          united.advisorOrNull!.physicalRolls.filter((r) => r.kind !== 'TROGR_SUPPRESSION_B'),
        ).toEqual(freeCard.physicalRolls);
        expect(
          united.advisorOrNull!.physicalRolls.filter((r) => r.kind === 'TROGR_SUPPRESSION_B'),
        ).toHaveLength(suppressed ? 1 : 0);
        for (const raceChoice of ['FREE', 'PURE', 'UNITED'] as const)
          current = commit(navigate(p, 'CHR-010'), {
            variant: 'CORRECTION_RACE',
            sourceFormId: 'CHR-010',
            raceChoice,
            acquisitionModeIfFirstOrNull: null,
          });
        expect(deriveCreationFinalizationView(current, p.dependencies).activeBranch).toEqual(
          united,
        );
        expect(p.sample).toHaveBeenCalledTimes(suppressed ? 7 : 2);
        expect(reload(p).finalizationStage).toEqual(current.finalizationStage);
      },
    );

    it('keeps monster confirmation receipts when the permitted monster choice changes and draws an ordinary FREE result once', async () => {
      const p = await prepare('AUTO');
      let serial = 0;
      const commit = (
        current: DurableCreationWizardCheckpoint,
        extra: Parameters<typeof creationCorrectionRequest>[2],
      ) =>
        commitCreationFinalization(
          p.setup.database,
          creationCorrectionRequest(current, `monster-${String(++serial)}`, extra),
          `monster-receipt-${String(serial)}`,
          p.dependencies,
        );
      let current = commit(navigate(p, 'CHR-010'), {
        variant: 'CORRECTION_RACE',
        sourceFormId: 'CHR-010',
        raceChoice: 'UNITED',
        acquisitionModeIfFirstOrNull: 'RANDOM',
      });
      const roll = (face: number) => {
        const view = deriveCreationFinalizationView(current, p.dependencies);
        p.sample.mockReturnValue(face);
        current = commit(current, {
          variant: 'CORRECTION_RANDOM_ROLL',
          sourceFormId: 'CHR-020',
          pendingRollRequestId: view.pendingRollRequestIds[0]!,
          manualFaceOrNull: null,
          selectedMonsterSpeciesKeyOrNull:
            view.randomStateOrNull!.nextRequest.kind === 'CRITICAL_CONFIRMATION' ? 'CHIMERA' : null,
        });
      };
      for (const face of [20, 15, 14]) roll(face);
      current = commit(current, {
        variant: 'CORRECTION_RANDOM_BINDINGS',
        sourceFormId: 'CHR-020',
        selectedBindings: [],
      });
      const physical = deriveCreationFinalizationView(current, p.dependencies).activeBranch
        .physicalRolls;
      expect(physical.at(-1)).toMatchObject({
        kind: 'CRITICAL_CONFIRMATION',
        selectedMonsterSpeciesKeyOrNull: 'CHIMERA',
      });
      current = commit(navigate(p, 'CHR-010'), {
        variant: 'CORRECTION_RACE',
        sourceFormId: 'CHR-010',
        raceChoice: 'UNITED',
        acquisitionModeIfFirstOrNull: null,
      });
      current = commit(current, {
        variant: 'CORRECTION_MONSTER_CHOICE',
        sourceFormId: 'CHR-020',
        selectedMonsterSpeciesKey: 'PUPPETEER',
      });
      const monster = deriveCreationFinalizationView(current, p.dependencies).activeBranch;
      expect(monster.physicalRolls).toEqual(physical);
      expect(monster.composition!.acceptedSpecies[0]!.speciesKey).toBe('PUPPETEER');
      expect(monster.bindings[0]!.speciesKey).toBe('PUPPETEER');
      current = commit(navigate(p, 'CHR-010'), {
        variant: 'CORRECTION_RACE',
        sourceFormId: 'CHR-010',
        raceChoice: 'FREE',
        acquisitionModeIfFirstOrNull: null,
      });
      roll(2);
      current = commit(current, {
        variant: 'CORRECTION_RANDOM_BINDINGS',
        sourceFormId: 'CHR-020',
        selectedBindings: [],
      });
      current = commit(navigate(p, 'CHR-010'), {
        variant: 'CORRECTION_RACE',
        sourceFormId: 'CHR-010',
        raceChoice: 'UNITED',
        acquisitionModeIfFirstOrNull: null,
      });
      expect(deriveCreationFinalizationView(current, p.dependencies).activeBranch).toEqual(monster);
      expect(p.sample).toHaveBeenCalledTimes(4);
    });
    it.each([false, true])(
      'applies permanent GROSS only after explicit consequences confirmation: %s',
      async (confirm) => {
        const p = await prepare();
        let serial = 0;
        const commit = (
          current: DurableCreationWizardCheckpoint,
          extra: Parameters<typeof creationCorrectionRequest>[2],
        ) =>
          commitCreationFinalization(
            p.setup.database,
            creationCorrectionRequest(current, `manual-${String(++serial)}`, extra),
            `manual-receipt-${String(serial)}`,
            p.dependencies,
          );
        let current = commit(navigate(p, 'CHR-010'), {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'UNITED',
          acquisitionModeIfFirstOrNull: 'MANUAL',
        });
        const before = deriveCreationFinalizationView(current, p.dependencies).state;
        const special = ['TROGR', 'DOLPHIN', 'TAIPAN', 'OWL'] as const;
        const ordinary = ['TAIPAN', 'OWL', 'ARMADILLO', 'WEAVER'] as const;
        const choose = (species: typeof special | typeof ordinary) => {
          navigate(p, 'CHR-017');
          const card = navigate(p, 'CHR-018', 'TROGR');
          return commit(card, {
            variant: 'CORRECTION_MANUAL_COMPOSITION',
            sourceFormId: 'CHR-018',
            acceptedSpecies: species.map((speciesKey, acceptedIndex) => ({
              acceptedIndex,
              speciesKey,
            })),
            selectedBindings: [],
          });
        };
        current = choose(special);
        let view = deriveCreationFinalizationView(current, p.dependencies);
        expect(view.nextCorrectionFormId).toBe('CHR-042');
        expect(view.state.permanentGrants).toEqual(before.permanentGrants);
        expect(view.state.trainingSlotLedger).toEqual(before.trainingSlotLedger);
        expect(view.compositionConsequencesOrNull?.beforeCompositionOrNull).toBeNull();
        if (confirm)
          current = commit(current, {
            variant: 'CORRECTION_INTERACTIONS',
            sourceFormId: 'CHR-042',
            compositionHash: creationFinalizationHash(view.activeBranch.composition),
          });
        else {
          navigate(p, 'CHR-019');
          current = choose(ordinary);
        }
        view = deriveCreationFinalizationView(current, p.dependencies);
        const grants = view.state.permanentGrants;
        expect(grants).toHaveLength(confirm ? 1 : 0);
        expect(view.compositionConsequencesOrNull).toBeNull();
        for (const raceChoice of ['PURE', 'UNITED', 'PURE', 'UNITED'] as const)
          current = commit(navigate(p, 'CHR-010'), {
            variant: 'CORRECTION_RACE',
            sourceFormId: 'CHR-010',
            raceChoice,
            acquisitionModeIfFirstOrNull: null,
          });
        expect(current.finalizationStage!.state.permanentGrants).toEqual(grants);
        expect(reload(p).finalizationStage).toEqual(current.finalizationStage);
        const preservedComposition = deriveCreationFinalizationView(current, p.dependencies)
          .activeBranch.composition;
        current = commit(navigate(p, 'CHR-010'), {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'UNITED',
          acquisitionModeIfFirstOrNull: null,
        });
        expect(current.nextStageEnvelope.formId).toBe('CHR-019');
        expect(
          deriveCreationFinalizationView(current, p.dependencies).activeBranch.composition,
        ).toEqual(preservedComposition);
        expect(p.sample).not.toHaveBeenCalled();
      },
    );
    it.each(['AUTO', 'MANUAL'] as const)(
      'keeps the original first ordinary and caches three additional UNITED draws in %s',
      async (mode) => {
        const p = await prepare(mode);
        const property = collectStartingPropertyReceiptRefs(p.current);
        let serial = 0;
        const commit = (
          current: DurableCreationWizardCheckpoint,
          extra: Parameters<typeof creationCorrectionRequest>[2],
        ) => {
          const request = creationCorrectionRequest(
            current,
            `correction-${String(++serial)}`,
            extra,
          );
          const result = commitCreationFinalization(
            p.setup.database,
            request,
            `receipt-${String(serial)}`,
            p.dependencies,
          );
          expect(reload(p).finalizationStage).toEqual(result.finalizationStage);
          expect(collectStartingPropertyReceiptRefs(result)).toEqual(property);
          expect(
            loadCreationWizardCommandByCommandId(
              p.setup.database,
              request.commandId,
              p.setup.catalog.skillStage,
              p.setup.catalog,
            )?.receipt,
          ).toEqual(result.receipt);
          return result;
        };
        let current = commit(navigate(p, 'CHR-010'), {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'FREE',
          acquisitionModeIfFirstOrNull: 'RANDOM',
        });
        const roll = (face: number) => {
          const view = deriveCreationFinalizationView(current, p.dependencies);
          p.sample.mockReturnValue(face);
          current = commit(current, {
            variant: 'CORRECTION_RANDOM_ROLL',
            sourceFormId: 'CHR-020',
            pendingRollRequestId: view.pendingRollRequestIds[0]!,
            manualFaceOrNull: mode === 'AUTO' ? null : face,
            selectedMonsterSpeciesKeyOrNull: null,
          });
        };
        roll(2);
        current = commit(current, {
          variant: 'CORRECTION_RANDOM_BINDINGS',
          sourceFormId: 'CHR-020',
          selectedBindings: [],
        });
        const free = deriveCreationFinalizationView(current, p.dependencies).activeBranch;
        expect(free.composition?.acceptedSpecies.map((s) => s.speciesKey)).toEqual(['TAIPAN']);
        current = commit(navigate(p, 'CHR-010'), {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'UNITED',
          acquisitionModeIfFirstOrNull: null,
        });
        for (const face of [3, 4, 5]) roll(face);
        current = commit(current, {
          variant: 'CORRECTION_RANDOM_BINDINGS',
          sourceFormId: 'CHR-020',
          selectedBindings: [],
        });
        const united = deriveCreationFinalizationView(current, p.dependencies).activeBranch;
        expect(united.composition?.acceptedSpecies.map((s) => s.speciesKey)).toEqual([
          'TAIPAN',
          'OWL',
          'TEACHER',
          'ARMADILLO',
        ]);
        expect(united.physicalRolls).toHaveLength(3);
        for (const raceChoice of ['FREE', 'UNITED', 'PURE', 'UNITED', 'FREE'] as const) {
          current = commit(navigate(p, 'CHR-010'), {
            variant: 'CORRECTION_RACE',
            sourceFormId: 'CHR-010',
            raceChoice,
            acquisitionModeIfFirstOrNull: null,
          });
          if (raceChoice === 'FREE')
            expect(deriveCreationFinalizationView(current, p.dependencies).activeBranch).toEqual(
              free,
            );
          if (raceChoice === 'UNITED')
            expect(deriveCreationFinalizationView(current, p.dependencies).activeBranch).toEqual(
              united,
            );
        }
        expect(p.sample).toHaveBeenCalledTimes(mode === 'AUTO' ? 4 : 0);
        expect(current.statAssignmentStage).toEqual(p.current.statAssignmentStage);
        expect(current.finalizationStage!.state.branches).toHaveLength(3);
      },
    );

    it('rejects pending request/receipt collisions and unfinished-sequence escape before RNG or writes', async () => {
      const p = await prepare('AUTO');
      const current = commitCreationFinalization(
        p.setup.database,
        creationCorrectionRequest(navigate(p, 'CHR-010'), 'to-free', {
          variant: 'CORRECTION_RACE',
          sourceFormId: 'CHR-010',
          raceChoice: 'FREE',
          acquisitionModeIfFirstOrNull: 'RANDOM',
        }),
        'to-free-receipt',
        p.dependencies,
      );
      const pending = deriveCreationFinalizationView(current, p.dependencies)
        .pendingRollRequestIds[0]!;
      const request = creationCorrectionRequest(current, 'roll', {
        variant: 'CORRECTION_RANDOM_ROLL',
        sourceFormId: 'CHR-020',
        pendingRollRequestId: pending,
        manualFaceOrNull: null,
        selectedMonsterSpeciesKeyOrNull: null,
      });
      for (const receiptId of ['', pending, 'to-free-receipt'])
        expect(() =>
          commitCreationFinalization(p.setup.database, request, receiptId, p.dependencies),
        ).toThrow();
      expect(() =>
        commitCreationFinalization(
          p.setup.database,
          { ...request, commandId: pending },
          'other-receipt',
          p.dependencies,
        ),
      ).toThrow();
      expect(() => navigate(p, 'CHR-025')).toThrow();
      expect(reload(p).localCharacter).toEqual(current.localCharacter);
      expect(reload(p).checkpoint).toEqual(current.checkpoint);
      expect(p.sample).not.toHaveBeenCalled();
    });
  });
});

describe('permanent skill retention', () => {
  it.each(['MANUAL', 'AUTO'] as const)(
    'repairs an original Advisor body requirement loss through signed 032→041→025 without new rolls: %s',
    async (diceInputMode) => {
      const directory = await mkdtemp(join(tmpdir(), 'original-advisor-retention-'));
      const databasePath = join(directory, 'character.sqlite');
      const p = await createCreationFinalizationSetup({
        prefix: `original-advisor-${diceInputMode}`,
        raceChoice: 'UNITED',
        diceInputMode,
        databasePath,
        prepareManualComposition: prepareOriginalAdvisorBodyLoss,
      });
      let database = p.setup.database;
      const sample = vi.fn(() => {
        throw new Error('repair must preserve the original Advisor I/W');
      });
      const dependencies = { ...p.dependencies, sampleD20: sample };
      const reload = () =>
        loadCreationWizardCheckpoint(
          database,
          p.setup.characterDraftId,
          p.setup.catalog.skillStage,
          p.setup.catalog,
        );
      try {
        const original = p.current.manualCompositionStage!;
        const originalCard = original.advisorSkillRecordOrNull!;
        expect(originalCard.learnedSkills).toContainEqual({
          skillKey: 'ACTING',
          bonus: 1,
          slotCost: 1,
        });
        const originalProperty = collectStartingPropertyReceiptRefs(p.current);
        const originalRandomIds = p.current.durablePayload.randomReceiptIds;
        const payloadBeforePreview = p.current.localCharacter.payloadJson;
        const initial = deriveCreationFinalizationView(p.current, dependencies);
        expect(initial.mechanics!.skillStageStats.C).toBe(19);
        expect(initial.mechanics!.effectiveStats.C).toBe(9);
        const correctedCard = initial.activeBranch.advisorOrNull!;
        expect(correctedCard.skillsConfirmed).toBe(false);
        expect(correctedCard.learnedSkills).toEqual([
          originalCard.learnedSkills.find((skill) => skill.skillKey === 'UNARMED'),
        ]);
        expect(initial.state.advisorCards).toEqual([correctedCard]);
        expect(initial.validationBlockers.map((b) => b.code)).toContain('ADVISOR_CARD_PENDING');
        expect(reload().localCharacter.payloadJson).toBe(payloadBeforePreview);
        let current = commitCreationFinalization(
          database,
          creationPropertySummaryRequest(p.current, 'original-summary'),
          'original-summary-receipt',
          dependencies,
        );
        expect(current.receipt.result.nextFormId).toBe('CHR-041');
        expect(creationFinalizationPresentationForm(current)).toBe('CHR-041');
        expect(deriveCreationFinalizationView(current, dependencies).pendingRollRequestIds).toEqual(
          [],
        );
        expect(current.manualCompositionStage).toEqual(original);
        database.close();
        database = openPersistenceDatabase(databasePath);
        current = reload();
        expect(creationFinalizationPresentationForm(current)).toBe('CHR-041');
        const beforeRejectedRepair = current.localCharacter.payloadJson;
        expect(() =>
          commitCreationFinalization(
            database,
            creationFinalSaveRequest(current, 'premature-final'),
            'premature-final-receipt',
            dependencies,
          ),
        ).toThrow('GUARD_REJECTED');
        expect(() =>
          commitCreationFinalization(
            database,
            creationCorrectionRequest(current, 'invalid-advisor-repair', {
              variant: 'CORRECTION_ADVISOR_SKILLS',
              sourceFormId: 'CHR-041',
              selectedSkills: [
                { skillKey: 'ACTING', targetBonus: 1 },
                { skillKey: 'UNARMED', targetBonus: 4 },
              ],
            }),
            'invalid-advisor-repair-receipt',
            dependencies,
          ),
        ).toThrow('GUARD_REJECTED');
        expect(reload().localCharacter.payloadJson).toBe(beforeRejectedRepair);
        current = commitCreationFinalization(
          database,
          creationCorrectionRequest(current, 'valid-advisor-repair', {
            variant: 'CORRECTION_ADVISOR_SKILLS',
            sourceFormId: 'CHR-041',
            selectedSkills: [{ skillKey: 'UNARMED', targetBonus: 5 }],
          }),
          'valid-advisor-repair-receipt',
          dependencies,
        );
        expect(current.receipt.result.nextFormId).toBe('CHR-025');
        const repaired = deriveCreationFinalizationView(current, dependencies);
        expect(repaired.validationBlockers).toEqual([]);
        expect(repaired.activeBranch.advisorOrNull).toMatchObject({
          advisorInstanceDraftId: original.advisorInstanceDraftIdOrNull,
          physicalRolls: correctedCard.physicalRolls,
          learnedSkills: [{ skillKey: 'UNARMED', bonus: 5, slotCost: 5 }],
          skillsConfirmed: true,
        });
        expect(repaired.state.advisorCards).toEqual([repaired.activeBranch.advisorOrNull]);
        current = commitCreationFinalization(
          database,
          creationFinalSaveRequest(current, 'repaired-final'),
          'repaired-final-receipt',
          dependencies,
        );
        expect(current.localCharacter.lifecycleState).toBe('FINAL');
        expect(current.manualCompositionStage).toEqual(original);
        expect(collectStartingPropertyReceiptRefs(current)).toEqual(originalProperty);
        expect(current.durablePayload.randomReceiptIds).toEqual(originalRandomIds);
        const finalStage = current.finalizationStage;
        database.close();
        database = openPersistenceDatabase(databasePath);
        expect(reload().finalizationStage).toEqual(finalStage);
        expect(sample).not.toHaveBeenCalled();
      } finally {
        if (database.open) database.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('retains a legally acquired GROSS through an incomplete race branch until its confirmed Trogr body is known', async () => {
    const p = await createCreationFinalizationSetup({
      prefix: 'retention-effective',
      raceChoice: 'FREE',
      diceInputMode: 'MANUAL',
    });
    const sample = vi.fn(() => {
      throw new Error('manual correction must not sample');
    });
    const dependencies = { ...p.dependencies, sampleD20: sample };
    try {
      let current = commitCreationFinalization(
        p.setup.database,
        creationPropertySummaryRequest(p.current, 'summary'),
        'summary-receipt',
        dependencies,
      );
      let serial = 0;
      const navigate = (
        formId: Parameters<typeof advanceCreationFinalizationPresentation>[1]['formId'],
        speciesKeyOrNull?: string,
      ) => {
        current = advanceCreationFinalizationPresentation(
          p.setup.database,
          {
            characterDraftId: p.setup.characterDraftId,
            wizardCheckpointId: p.setup.wizardCheckpointId,
            formId,
            ...(speciesKeyOrNull === undefined ? {} : { speciesKeyOrNull }),
          },
          p.setup.catalog,
        );
      };
      const commit = (extra: Parameters<typeof creationCorrectionRequest>[2]) => {
        const id = `effective-${String(++serial)}`;
        current = commitCreationFinalization(
          p.setup.database,
          creationCorrectionRequest(current, id, extra),
          `${id}-receipt`,
          dependencies,
        );
      };
      navigate('CHR-010');
      commit({
        variant: 'CORRECTION_RACE',
        sourceFormId: 'CHR-010',
        raceChoice: 'FREE',
        acquisitionModeIfFirstOrNull: null,
      });
      navigate('CHR-017');
      navigate('CHR-015');
      const pre = deriveCreationFinalizationView(current, dependencies).mechanics!.skillStageStats;
      const capacity = calculateStartSkillSlots(pre);
      const eligible = p.setup.catalog.skillStage.skills
        .filter((s) => {
          if (s.category !== 'SELECTABLE_GENERAL') return false;
          try {
            validateSkillRequirements(p.setup.catalog.skillStage, s.skillKey, pre);
            return true;
          } catch {
            return false;
          }
        })
        .sort((a, b) => Number(b.skillKey === 'GROSS') - Number(a.skillKey === 'GROSS'));
      const selectedSkills = eligible
        .slice(0, capacity)
        .map((s) => ({ skillKey: s.skillKey, targetBonus: 1 }));
      expect(selectedSkills[0]!.skillKey).toBe('GROSS');
      expect(selectedSkills).toHaveLength(capacity);
      commit({ variant: 'CORRECTION_SKILLS', sourceFormId: 'CHR-015', selectedSkills });
      const gross = deriveCreationFinalizationView(current, dependencies).state.learnedSkills.find(
        (s) => s.skillKey === 'GROSS',
      )!;
      navigate('CHR-010');
      commit({
        variant: 'CORRECTION_RACE',
        sourceFormId: 'CHR-010',
        raceChoice: 'FREE',
        acquisitionModeIfFirstOrNull: null,
      });
      navigate('CHR-017');
      navigate('CHR-018', 'TROGR');
      commit({
        variant: 'CORRECTION_MANUAL_COMPOSITION',
        sourceFormId: 'CHR-018',
        acceptedSpecies: [{ acceptedIndex: 0, speciesKey: 'TROGR' }],
        selectedBindings: [],
      });
      navigate('CHR-010');
      commit({
        variant: 'CORRECTION_RACE',
        sourceFormId: 'CHR-010',
        raceChoice: 'UNITED',
        acquisitionModeIfFirstOrNull: null,
      });
      const incomplete = deriveCreationFinalizationView(current, dependencies);
      expect(incomplete.activeBranch.composition).toBeNull();
      expect(incomplete.state.learnedSkills.find((s) => s.skillKey === 'GROSS')).toEqual(gross);
      navigate('CHR-017');
      navigate('CHR-018', 'TROGR');
      commit({
        variant: 'CORRECTION_MANUAL_COMPOSITION',
        sourceFormId: 'CHR-018',
        acceptedSpecies: ['TROGR', 'TAIPAN', 'OWL', 'ARMADILLO'].map(
          (speciesKey, acceptedIndex) => ({
            acceptedIndex,
            speciesKey: speciesKey as 'TROGR' | 'TAIPAN' | 'OWL' | 'ARMADILLO',
          }),
        ),
        selectedBindings: [],
      });
      const confirmed = deriveCreationFinalizationView(current, dependencies);
      expect(confirmed.mechanics!.skillStageStats.S).toBeLessThan(14);
      expect(confirmed.mechanics!.effectiveStats.S).toBeGreaterThanOrEqual(14);
      expect(confirmed.state.learnedSkills.find((s) => s.skillKey === 'GROSS')).toEqual(gross);
      expect(() =>
        validateSkillRequirements(
          p.setup.catalog.skillStage,
          'GROSS',
          confirmed.mechanics!.skillStageStats,
        ),
      ).toThrow();
      expect(
        loadCreationWizardCheckpoint(
          p.setup.database,
          p.setup.characterDraftId,
          p.setup.catalog.skillStage,
          p.setup.catalog,
        ).finalizationStage,
      ).toEqual(current.finalizationStage);
      expect(sample).not.toHaveBeenCalled();
    } finally {
      p.setup.database.close();
    }
  });

  it('AQA-004 removes only the confirmed permanent requirement loss from its original paid pool', async () => {
    const p = await createCreationFinalizationSetup({
      prefix: 'retention-host',
      raceChoice: 'PURE',
      diceInputMode: 'MANUAL',
    });
    const sample = vi.fn(() => {
      throw new Error('manual correction must not sample');
    });
    const dependencies = { ...p.dependencies, sampleD20: sample };
    try {
      let current = commitCreationFinalization(
        p.setup.database,
        creationPropertySummaryRequest(p.current, 'retention-summary'),
        'retention-summary-receipt',
        dependencies,
      );
      let serial = 0;
      const navigate = (
        formId: Parameters<typeof advanceCreationFinalizationPresentation>[1]['formId'],
        speciesKeyOrNull?: string,
      ) => {
        current = advanceCreationFinalizationPresentation(
          p.setup.database,
          {
            characterDraftId: p.setup.characterDraftId,
            wizardCheckpointId: p.setup.wizardCheckpointId,
            formId,
            ...(speciesKeyOrNull === undefined ? {} : { speciesKeyOrNull }),
          },
          p.setup.catalog,
        );
      };
      const commit = (extra: Parameters<typeof creationCorrectionRequest>[2]) => {
        const id = `retention-${String(++serial)}`;
        current = commitCreationFinalization(
          p.setup.database,
          creationCorrectionRequest(current, id, extra),
          `${id}-receipt`,
          dependencies,
        );
      };
      navigate('CHR-010');
      commit({
        variant: 'CORRECTION_RACE',
        sourceFormId: 'CHR-010',
        raceChoice: 'UNITED',
        acquisitionModeIfFirstOrNull: 'MANUAL',
      });
      const before = deriveCreationFinalizationView(current, dependencies).state.learnedSkills;
      const grappling = before.find((s) => s.skillKey === 'GRAPPLING');
      const unarmed = before.find((s) => s.skillKey === 'UNARMED');
      expect(grappling).toMatchObject({ source: 'SELECTED', bonus: 4, slotCost: 4 });
      expect(unarmed).toMatchObject({ source: 'SELECTED', bonus: 5, slotCost: 5 });
      navigate('CHR-017');
      navigate('CHR-018', 'TROGR');
      commit({
        variant: 'CORRECTION_MANUAL_COMPOSITION',
        sourceFormId: 'CHR-018',
        acceptedSpecies: ['TROGR', 'DOLPHIN', 'OWL', 'TAIPAN'].map((speciesKey, acceptedIndex) => ({
          speciesKey: speciesKey as 'TROGR' | 'DOLPHIN' | 'OWL' | 'TAIPAN',
          acceptedIndex,
        })),
        selectedBindings: [],
      });
      const candidate = deriveCreationFinalizationView(current, dependencies);
      expect(candidate.mechanics!.effectiveStats.I).toBe(1);
      expect(candidate.state.learnedSkills).toEqual(before);
      expect(candidate.activeBranch.interactionsConfirmed).toBe(false);
      commit({
        variant: 'CORRECTION_INTERACTIONS',
        sourceFormId: 'CHR-042',
        compositionHash: creationFinalizationHash(candidate.activeBranch.composition),
      });
      const confirmed = deriveCreationFinalizationView(current, dependencies);
      expect(confirmed.state.learnedSkills.some((s) => s.skillKey === 'GRAPPLING')).toBe(false);
      expect(confirmed.state.learnedSkills.find((s) => s.skillKey === 'UNARMED')).toEqual(unarmed);
      expect(confirmed.skillsAndSlotsStatus.used).toBe(
        before.reduce((n, s) => n + s.slotCost, 0) - grappling!.slotCost,
      );
      expect(confirmed.validationBlockers.some((b) => b.code === 'START_SLOTS_NOT_FILLED')).toBe(
        true,
      );
      expect(current.skillSelectionStage).toEqual(p.current.skillSelectionStage);
      expect(current.fiveStartingPositionsStage).toEqual(p.current.fiveStartingPositionsStage);
      const restored = loadCreationWizardCheckpoint(
        p.setup.database,
        p.setup.characterDraftId,
        p.setup.catalog.skillStage,
        p.setup.catalog,
      );
      expect(restored.finalizationStage).toEqual(current.finalizationStage);
      expect(sample).not.toHaveBeenCalled();
    } finally {
      p.setup.database.close();
    }
  });
});

describe('source catalog validation', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const files = [
    'character/classes',
    'character/dictionaries',
    'character/modifiers',
    'character/races',
    'character/skill-requirements',
    'character/skills',
    'character/stats',
    'character/symbionts',
    'character/incompatibilities',
    'character/development-nodes',
    'rules/rules',
  ];
  const temporaryRoots: string[] = [];
  function fixture(file: string, mutate: (rows: Record<string, unknown>[]) => void): string {
    const target = mkdtempSync(join(tmpdir(), 'symbiosis-final-catalog-'));
    temporaryRoots.push(target);
    for (const source of files) {
      const destination = join(target, 'generated/spec', `${source}.json`);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, 'generated/spec', `${source}.json`), destination);
    }
    const path = join(target, 'generated/spec', `${file}.json`);
    const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[];
    mutate(rows);
    writeFileSync(path, JSON.stringify(rows));
    return target;
  }
  afterAll(() => {
    for (const target of temporaryRoots) rmSync(target, { force: true, recursive: true });
  });

  describe('creation finalization catalog', () => {
    it('validates all source rules and 23 L1 roots plus four mandatory Trogr nodes', async () => {
      const catalog = await loadCreationFinalizationCatalog(root);
      expect(catalog.initialNodes).toHaveLength(27);
      expect(catalog.initialNodes.filter((node) => node.level === 1)).toHaveLength(23);
      expect(canonicalCreationFinalizationCatalog()).toEqual(catalog);
      expect(canonicalCreationFinalizationCatalog()).toBe(canonicalCreationFinalizationCatalog());
      expect(Object.isFrozen(catalog.initialNodes[0])).toBe(true);
    });
    it.each([
      'AQA-004',
      'AQA-005',
      'AQA-008',
      'AQA-009',
      'CORE-164',
      'CORE-166',
      'SYM-076',
      'SYM-079',
      'SYM-185',
    ])('refuses changed %s mechanics instead of applying the old interpretation', async (id) => {
      const target = fixture('rules/rules', (rows) => {
        rows.find((row) => row['Rule ID'] === id)!['Итоговый алгоритм'] = 'changed';
      });
      await expect(loadCreationFinalizationCatalog(target)).rejects.toThrow(/source algorithm/);
    });
    it('refuses a missing root and changed mandatory prerequisite', async () => {
      await expect(
        loadCreationFinalizationCatalog(
          fixture('character/development-nodes', (rows) => {
            rows.splice(
              rows.findIndex((row) => row.NodeRef === 'SYM-076'),
              1,
            );
          }),
        ),
      ).rejects.toThrow(/node count/);
      await expect(
        loadCreationFinalizationCatalog(
          fixture('character/development-nodes', (rows) => {
            rows.find((row) => row.NodeRef === 'SYM-077')!.SelectionConstraint = 'ROOT';
          }),
        ),
      ).rejects.toThrow(/initial node/);
    });
  });
});

describe('historical permanent ledgers', () => {
  const catalog = canonicalCreationFinalizationCatalog();
  const setups: ReturnType<typeof createManualWizardSetup>[] = [];
  afterEach(() => {
    for (const setup of setups.splice(0)) setup.database.close();
  });
  function setup(prefix: string, race: 'UNITED' | 'FREE' | 'PURE' = 'UNITED') {
    const value = createManualWizardSetup(prefix, race, 'MANUAL');
    setups.push(value);
    return value;
  }
  function select(
    value: ReturnType<typeof setup>,
    current: DurableCreationWizardCheckpoint,
    species: readonly SymbiontSpeciesKey[],
    id: string,
  ) {
    return commitManualComposition(
      value.database,
      manualCompositionRequest(value, current, id, species),
      `${id}-receipt`,
      {
        catalog: value.catalog,
        allocateRollRequestId: () => {
          throw new Error('non-Adviser fixture must not allocate roll requests');
        },
        sampleD20: () => {
          throw new Error('manual selection must not roll');
        },
      },
    );
  }

  describe('confirmed original creation history ledgers', () => {
    it('does not convert a rejected special candidate into a permanent Trogr grant', () => {
      const value = setup('ledger-rejected');
      const candidate = select(
        value,
        value.checkpoint,
        ['TROGR', 'DOLPHIN', 'OWL', 'TICK'],
        'candidate',
      );
      expect(deriveInitialCreationPermanentLedgers(candidate, catalog).permanentGrants).toEqual([]);
      const changed = select(value, candidate, ['OWL', 'TICK', 'RAT', 'CRICKET'], 'changed');
      expect(deriveInitialCreationPermanentLedgers(changed, catalog).permanentGrants).toEqual([]);
    });
    it('grants the terminal special consequence once after its actual armor-entry confirmation', () => {
      const value = setup('ledger-confirmed');
      select(value, value.checkpoint, ['TROGR', 'DOLPHIN', 'OWL', 'TICK'], 'candidate');
      let current = advanceManualSymbiontPresentation(
        value.database,
        {
          characterDraftId: value.characterDraftId,
          wizardCheckpointId: value.wizardCheckpointId,
          formId: 'CHR-042',
        },
        value.catalog,
      );
      current = commitManualInteractionConfirmation(
        value.database,
        {
          commandId: 'confirm-special',
          commandKind: 'workflow-command',
          expectedRevisions: currentCreationWizardRevisions(current),
          messageType: 'command.request',
          protocolVersion: 1,
          role: 'player',
          workflowCommandId: 'UI-CMD-CHAR-CREATION-SET-DECIDE',
          payload: {
            stage: 'SYMBIONTS',
            sourceFormId: 'CHR-042',
            variant: 'MANUAL_INTERACTION_CONFIRMATION',
            characterDraftId: value.characterDraftId,
            wizardCheckpointId: value.wizardCheckpointId,
            draftRevision: current.receipt.result.draftRevision,
            interactionDiff: manualInteractionDiffJson(
              value.catalog,
              manualInteractionPreview(current, value.catalog),
            ),
          },
        },
        'confirm-special-receipt',
        {
          catalog: value.catalog,
          allocateArmorBundleId: () => 'ledger-armor',
          allocateQualityRollRequestId: () => 'ledger-armor-roll',
        },
      );
      const first = deriveInitialCreationPermanentLedgers(current, catalog);
      expect(first.permanentGrants).toHaveLength(1);
      expect(first.permanentGrants[0]?.kind).toBe('TROGR_GROSS');
      expect(deriveInitialCreationPermanentLedgers(current, catalog)).toEqual(first);
      const before = current.localCharacter.payloadJson;
      deriveInitialCreationPermanentLedgers(current, catalog);
      expect(current.localCharacter.payloadJson).toBe(before);
    });
    it('preserves a previously confirmed Teacher wisdom maximum after replacement', () => {
      const value = setup('ledger-teacher', 'FREE');
      const teacher = select(value, value.checkpoint, ['TEACHER'], 'teacher');
      const first = deriveInitialCreationPermanentLedgers(teacher, catalog);
      const rat = select(value, teacher, ['RAT'], 'rat');
      const history = deriveInitialCreationPermanentLedgers(rat, catalog);
      expect(history.trainingSlotLedger).toEqual(first.trainingSlotLedger);
      const lastOnly = deriveCreationFinalMechanics(catalog, {
        baseStats: rat.statAssignmentStage!.derived.baseStats,
        raceCode: 'FREE',
        classCode: null,
        creationMode: 'MANUAL',
        composition: rat.manualCompositionStage!.composition,
        learnedSkills: rat.skillSelectionStage!.derived.learnedSkills,
        advisorSuppressionBonusOrNull: null,
        permanentGrants: [],
        trainingSlotLedger: null,
      });
      expect(history.trainingSlotLedger.maxPermanentWisdom).toBeGreaterThan(
        lastOnly.trainingSlotLedger.maxPermanentWisdom,
      );
    });
    it('initializes PURE training slots without creating a symbiont mode or grant', () => {
      const value = setup('ledger-pure', 'PURE');
      const before = JSON.stringify(value.checkpoint);
      const result = deriveInitialCreationPermanentLedgers(value.checkpoint, catalog);
      expect(result.permanentGrants).toEqual([]);
      expect(result.trainingSlotLedger.everIssued).toBe(
        Math.floor(result.trainingSlotLedger.maxPermanentWisdom / 2),
      );
      expect(JSON.stringify(value.checkpoint)).toBe(before);
    });
  });
});
