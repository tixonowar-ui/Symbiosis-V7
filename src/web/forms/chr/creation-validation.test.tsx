// @vitest-environment node
import type { JsonObject } from '@shared/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
  creationCorrectionRequest,
} from '../../../../tests/fixtures/creation-finalization-stage.js';
import {
  commitCreationFinalization,
  deriveCreationFinalizationView,
  advanceCreationFinalizationPresentation,
} from '../../../host/creation-finalization.js';
import { projectChr032, projectChr025 } from '../../../host/projections/chr-creation-validation.js';
import { projectCreationCorrection } from '../../../host/projections/chr-creation-correction.js';
import { loadCreationSkillCatalog } from '../../../host/creation-skill-catalog.js';
import { loadCreationDecisionConsequenceCatalog } from '../../../host/creation-decision-consequence-catalog.js';
import {
  decodeCreationCorrectionProjection,
  expectedCreationCorrectionActionKeys,
} from './creation-correction.js';
import {
  decodeChr032Projection,
  decodeChr025Projection,
  expectedChr032ActionKeys,
  expectedChr025ActionKeys,
  decodeCreationFinalizationTerminal,
  creationFinalizationSnapshotMatchesReceipt,
} from './creation-validation.js';
import { currentCreationWizardRevisions } from '../../../host/creation-set-decide.js';
import type { CreationFinalizationView } from '../../../host/creation-finalization-contract.js';
import {
  CREATION_BLOCKER_RETURN_FORMS,
  CREATION_FINAL_SAVE_TRANSITION,
  decodeCreationValidationBlocker,
} from './creation-validation.js';

describe('CHR-025 typed validation blockers', () => {
  it('binds every correction class to its exact source return form', () => {
    for (const [kind, returnFormId] of Object.entries(CREATION_BLOCKER_RETURN_FORMS)) {
      const blocker = {
        kind,
        returnFormId,
        code: 'INVALID_VALUE',
        message: 'Исправьте значение перед сохранением.',
      };
      expect(decodeCreationValidationBlocker(blocker, '$').ok).toBe(true);
      expect(decodeCreationValidationBlocker({ ...blocker, returnFormId: 'CHR-040' }, '$').ok).toBe(
        false,
      );
      expect(
        decodeCreationValidationBlocker({ ...blocker, availabilityTrace: 'internal' }, '$').ok,
      ).toBe(false);
      expect(
        decodeCreationValidationBlocker({ ...blocker, message: 'Ошибка CORE-159' }, '$').ok,
      ).toBe(false);
    }
    expect(
      decodeCreationValidationBlocker(
        { kind: 'UNKNOWN', code: 'MISSING', message: 'Ошибка', returnFormId: 'CHR-001' },
        '$',
      ).ok,
    ).toBe(false);
  });
  it('keeps the final save an exact operation transition while CHR-040 remains unpublished', () => {
    expect(CREATION_FINAL_SAVE_TRANSITION).toEqual({
      from: 'CHR-025',
      to: 'CHR-040',
      kind: 'operation-command',
      trigger: 'Сохранить финального персонажа',
    });
  });
});

const setups: Awaited<ReturnType<typeof createCreationFinalizationSetup>>['setup'][] = [];
afterEach(() => {
  for (const setup of setups.splice(0)) if (setup.database.open) setup.database.close();
});
describe('production finalization host/web contract', () => {
  it.each(['AUTO', 'MANUAL'] as const)(
    'binds new correction dice and exact terminal fields in %s mode',
    async (diceInputMode) => {
      const prepared = await createCreationFinalizationSetup({
        prefix: 'web-correction-dice-' + diceInputMode,
        raceChoice: 'PURE',
        diceInputMode,
      });
      setups.push(prepared.setup);
      const skillCatalog = await loadCreationSkillCatalog(
        process.cwd(),
        prepared.setup.catalog.skillStage,
      );
      const decisions = await loadCreationDecisionConsequenceCatalog(
        process.cwd(),
        prepared.setup.catalog.skillStage,
        skillCatalog,
      );
      const dependencies = { ...prepared.dependencies, sampleD20: () => 2 };
      let current = commitCreationFinalization(
        prepared.setup.database,
        creationPropertySummaryRequest(prepared.current, 'dice-summary'),
        'dice-summary-receipt',
        dependencies,
      );
      current = advanceCreationFinalizationPresentation(
        prepared.setup.database,
        {
          characterDraftId: prepared.setup.characterDraftId,
          wizardCheckpointId: current.checkpoint.checkpointId,
          formId: 'CHR-010',
        },
        prepared.setup.catalog,
      );
      const race = creationCorrectionRequest(current, 'race-correction', {
        sourceFormId: 'CHR-010',
        variant: 'CORRECTION_RACE',
        raceChoice: 'FREE',
        acquisitionModeIfFirstOrNull: 'RANDOM',
      });
      current = commitCreationFinalization(
        prepared.setup.database,
        race,
        'race-correction-receipt',
        dependencies,
      );
      const view = deriveCreationFinalizationView(current, dependencies);
      const projected = projectCreationCorrection(
        current,
        view,
        {
          symbionts: prepared.setup.catalog,
          skills: skillCatalog,
          decisions,
        },
        { checkpoint: true, setDecide: true, rollCommit: true },
      );
      expect(
        decodeCreationCorrectionProjection(projected.roleFilteredPayload, '$', 'CHR-020'),
      ).toMatchObject({ ok: true });
      const request = creationCorrectionRequest(current, 'correction-roll', {
        sourceFormId: 'CHR-020',
        variant: 'CORRECTION_RANDOM_ROLL',
        pendingRollRequestId: view.pendingRollRequestIds[0]!,
        manualFaceOrNull: diceInputMode === 'MANUAL' ? 2 : null,
        selectedMonsterSpeciesKeyOrNull: null,
      });
      const rolled = commitCreationFinalization(
        prepared.setup.database,
        request,
        'correction-roll-receipt',
        dependencies,
      );
      const source = {
        projection: projected.roleFilteredPayload,
        revisions: currentCreationWizardRevisions(current),
      };
      const message = {
        messageType: 'command.result',
        protocolVersion: 1,
        lifecycleState: 'COMMITTED',
        receipt: rolled.receipt,
      } as const;
      expect(decodeCreationFinalizationTerminal(message, request, source)).toMatchObject({
        ok: true,
      });
      const result = rolled.receipt.result as JsonObject;
      const rows = result['physicalRolls'] as readonly JsonObject[];
      for (const patch of [
        { rollRequestId: 'wrong' },
        { kind: 'ADVISOR_W' },
        { source: 'CORE-169' },
        { mechanical: { dieSides: 12, rawFace: 2 } },
      ])
        expect(
          decodeCreationFinalizationTerminal(
            {
              ...message,
              receipt: {
                ...message.receipt,
                result: { ...result, physicalRolls: [{ ...rows[0], ...patch }] },
              },
            },
            request,
            source,
          ).ok,
        ).toBe(false);
      const next = projectCreationCorrection(
        rolled,
        deriveCreationFinalizationView(rolled, dependencies),
        { symbionts: prepared.setup.catalog, skills: skillCatalog, decisions },
        { checkpoint: true, setDecide: true, rollCommit: true },
      );
      expect(
        decodeCreationCorrectionProjection(next.roleFilteredPayload, '$', 'CHR-020'),
      ).toMatchObject({ ok: true });
      expect(
        creationFinalizationSnapshotMatchesReceipt(
          {
            formId: 'CHR-020',
            projection: next.roleFilteredPayload,
            revisions: currentCreationWizardRevisions(rolled),
            layers: [],
          },
          rolled.receipt,
        ),
      ).toBe(true);
    },
  );
  it.each(['FREE', 'PURE'] as const)(
    'round-trips the %s property summary, validation, final receipt and read-only saved screen',
    async (raceChoice) => {
      const prepared = await createCreationFinalizationSetup({
        prefix: `web-final-${raceChoice}`,
        raceChoice,
        diceInputMode: 'MANUAL',
      });
      setups.push(prepared.setup);
      const p032 = projectChr032(
        prepared.current,
        deriveCreationFinalizationView(prepared.current, prepared.dependencies),
        true,
      );
      const decoded032 = decodeChr032Projection(p032.roleFilteredPayload, '$');
      expect(decoded032).toMatchObject({ ok: true });
      if (!decoded032.ok) throw new Error(JSON.stringify(decoded032));
      expect(expectedChr032ActionKeys(decoded032.value, true)).toEqual(p032.availableActionKeys);
      const request = creationPropertySummaryRequest(prepared.current, 'web-summary');
      const summarized = commitCreationFinalization(
        prepared.setup.database,
        request,
        'web-summary-receipt',
        prepared.dependencies,
      );
      const p025 = projectChr025(
        summarized,
        deriveCreationFinalizationView(summarized, prepared.dependencies),
        true,
      );
      const decoded025 = decodeChr025Projection(p025.roleFilteredPayload, '$');
      expect(decoded025).toMatchObject({ ok: true });
      if (!decoded025.ok) throw new Error(JSON.stringify(decoded025));
      expect(
        decodeChr025Projection(
          {
            ...p025.roleFilteredPayload,
            identity: { ...decoded025.value.identity, name: 'Источник CORE-159 fan' },
          },
          '$',
        ),
      ).toMatchObject({ ok: true });
      expect(expectedChr025ActionKeys(decoded025.value, true)).toEqual([
        'CHR-025::CTA::001',
        'CHR-025::CTA::002',
        'CHR-025::CTA::007',
        'CHR-025::CTA::008',
        'CHR-025::CTA::009',
      ]);
      const summaryTerminal = decodeCreationFinalizationTerminal(
        {
          messageType: 'command.result',
          protocolVersion: 1,
          lifecycleState: 'COMMITTED',
          receipt: summarized.receipt,
        },
        request,
        {
          projection: p032.roleFilteredPayload,
          revisions: currentCreationWizardRevisions(prepared.current),
        },
      );
      expect(summaryTerminal).toMatchObject({ ok: true });
      expect(
        creationFinalizationSnapshotMatchesReceipt(
          {
            formId: 'CHR-025',
            projection: p025.roleFilteredPayload,
            revisions: currentCreationWizardRevisions(summarized),
            layers: [],
          },
          summarized.receipt,
        ),
      ).toBe(true);
      const saveRequest = creationFinalSaveRequest(summarized, 'web-final');
      const saved = commitCreationFinalization(
        prepared.setup.database,
        saveRequest,
        'web-final-receipt',
        prepared.dependencies,
      );
      const final = projectChr025(
        saved,
        deriveCreationFinalizationView(saved, prepared.dependencies),
        true,
      );
      expect(decodeChr025Projection(final.roleFilteredPayload, '$')).toMatchObject({ ok: true });
      expect(
        decodeChr025Projection({ ...final.roleFilteredPayload, pureClassOrNull: 'UNKNOWN' }, '$')
          .ok,
      ).toBe(false);
      expect(final.availableActionKeys).toEqual([]);
      expect(
        decodeCreationFinalizationTerminal(
          {
            messageType: 'command.result',
            protocolVersion: 1,
            lifecycleState: 'COMMITTED',
            receipt: saved.receipt,
          },
          saveRequest,
          {
            projection: p025.roleFilteredPayload,
            revisions: currentCreationWizardRevisions(summarized),
          },
        ),
      ).toMatchObject({ ok: true });
      expect(
        JSON.stringify([
          p032.roleFilteredPayload,
          p025.roleFilteredPayload,
          final.roleFilteredPayload,
        ]),
      ).not.toMatch(
        /CORE-|SYM-\d|AQ2-|availabilityTrace|masterPredicate|learnedNodeRefs|profileRuleId/,
      );
      for (const mutation of [
        { ...p032.roleFilteredPayload, source: 'CORE-172' },
        { ...p032.roleFilteredPayload, exactOperationCount: 7 },
        { ...p032.roleFilteredPayload, propertyRollReceipts: [] },
      ])
        expect(decodeChr032Projection(mutation, '$').ok).toBe(false);
      expect(
        decodeChr025Projection({ ...final.roleFilteredPayload, nextFormId: 'CHR-025' }, '$').ok,
      ).toBe(false);
      expect(
        decodeChr025Projection(
          {
            ...p025.roleFilteredPayload,
            validationBlockers: [
              {
                kind: 'STATS',
                code: 'MINIMUM',
                message: 'Исправьте характеристики.',
                returnFormId: 'CHR-010',
              },
            ],
          },
          '$',
        ).ok,
      ).toBe(false);
    },
  );
  it('uses source options and a strict head-bound correction context without raw rule data', async () => {
    const prepared = await createCreationFinalizationSetup({
      prefix: 'web-correction',
      raceChoice: 'FREE',
      diceInputMode: 'MANUAL',
    });
    setups.push(prepared.setup);
    let current = commitCreationFinalization(
      prepared.setup.database,
      creationPropertySummaryRequest(prepared.current, 'summary'),
      'summary-receipt',
      prepared.dependencies,
    );
    current = advanceCreationFinalizationPresentation(
      prepared.setup.database,
      {
        characterDraftId: prepared.setup.characterDraftId,
        wizardCheckpointId: current.checkpoint.checkpointId,
        formId: 'CHR-010',
      },
      prepared.setup.catalog,
    );
    const skillCatalog = await loadCreationSkillCatalog(
      process.cwd(),
      prepared.setup.catalog.skillStage,
    );
    const decisions = await loadCreationDecisionConsequenceCatalog(
      process.cwd(),
      prepared.setup.catalog.skillStage,
      skillCatalog,
    );
    const view = deriveCreationFinalizationView(current, prepared.dependencies);
    for (const formId of [
      'CHR-001',
      'CHR-009',
      'CHR-010',
      'CHR-011',
      'CHR-015',
      'CHR-017',
      'CHR-019',
      'CHR-020',
      'CHR-041',
      'CHR-042',
    ] as const) {
      const localView = {
        ...view,
        correctionContextOrNull: { ...view.correctionContextOrNull!, sourceFormId: formId },
      } satisfies CreationFinalizationView;
      const projected = projectCreationCorrection(
        current,
        localView,
        {
          symbionts: prepared.setup.catalog,
          skills: skillCatalog,
          decisions,
        },
        { checkpoint: true, setDecide: true, rollCommit: true },
      );
      const decoded = decodeCreationCorrectionProjection(
        projected.roleFilteredPayload,
        '$',
        formId,
      );
      expect(decoded).toMatchObject({ ok: true });
      if (!decoded.ok) throw new Error(JSON.stringify(decoded));
      expect(
        decodeCreationCorrectionProjection(
          {
            ...projected.roleFilteredPayload,
            identity: { ...decoded.value.identity, name: 'Источник CORE-159 fan' },
          },
          '$',
          formId,
        ),
      ).toMatchObject({ ok: true });
      expect(decoded.value.raceConsequenceOptions).toEqual(decisions.raceConsequenceOptions);
      const soldier = decoded.value.classOptions.find((option) => option.classCode === 'SOLDIER')!;
      expect(soldier.classConsequences.statModifiers).toContainEqual({ statCode: 'S', delta: 5 });
      expect(soldier.mandatoryClassSkill.slotCost).toBe(1);
      expect(soldier.contextModifiers).toContainEqual({
        statCode: 'C',
        delta: -20,
        socialTargetRace: 'UNITED',
      });
      for (const mutation of [
        { raceOptions: Array.from({ length: 3 }, () => decoded.value.raceOptions[0]!) },
        { classOptions: Array.from({ length: 3 }, () => decoded.value.classOptions[0]!) },
        {
          eligibleSymbiontSpecies: [
            { ...decoded.value.eligibleSymbiontSpecies[0]!, speciesKey: 'CORE-159' },
          ],
        },
        {
          acceptedSpecies: [
            { acceptedIndex: 0, speciesKey: 'UNKNOWN', speciesLabel: 'Неизвестный' },
          ],
        },
        { acceptedSpecies: [{ ...decoded.value.acceptedSpecies[0]!, acceptedIndex: 2 }] },
        {
          selectedBindings: [
            { speciesKey: 'OWL', side: 'LEFT' },
            { speciesKey: 'OWL', side: 'RIGHT' },
          ],
        },
      ])
        expect(
          decodeCreationCorrectionProjection(
            { ...projected.roleFilteredPayload, ...mutation },
            '$',
            formId,
          ).ok,
        ).toBe(false);
      expect(expectedCreationCorrectionActionKeys(decoded.value)).toEqual(
        projected.availableActionKeys,
      );
      expect(
        decodeCreationCorrectionProjection(
          {
            ...projected.roleFilteredPayload,
            correctionContext: {
              ...decoded.value.correctionContext,
              correctionHeadHash: 'a'.repeat(64),
            },
          },
          '$',
          formId,
        ).ok,
      ).toBe(false);
      expect(
        decodeCreationCorrectionProjection(
          { ...projected.roleFilteredPayload, source: 'CORE-159' },
          '$',
          formId,
        ).ok,
      ).toBe(false);
      expect(JSON.stringify(projected.roleFilteredPayload)).not.toMatch(
        /CORE-|SYM-\d|availabilityTrace|masterPredicate|learnedNodeRefs|profileRuleId/,
      );
    }
  });
});
