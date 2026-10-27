import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { openPersistenceDatabase } from '../persistence/index.js';
import { loadCreationSkillCatalog, type CreationSkillCatalog } from './creation-skill-catalog.js';
import { commitCreationWizardCheckpoint } from './creation-wizard-checkpoint.js';
import { commitManualAdvisorIw, commitManualAdvisorSkills } from './creation-manual-advisor.js';
import { commitAdvisorIntelligenceFloorRoll } from './creation-advisor-intelligence-floor.js';
import { advisorIntelligenceFloorStageForManual } from './creation-manual-advisor-contract.js';
import { commitManualComposition } from './creation-manual-composition.js';
import {
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  createManualWizardSetup,
  exactManualAdvisorSkills,
  manualAdvisorFloorRollRequest,
  manualAdvisorIwRequest,
  manualAdvisorSkillRequest,
  manualCompositionRequest,
  type ManualWizardSetup,
} from '../../tests/fixtures/manual-symbiont-stage.js';
import { CATALOG } from '../../tests/fixtures/symbiont-stage.js';
import type { SymbiontSpeciesKey } from '../domain/index.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const temporaryDirectories: string[] = [];
const databases: ReturnType<typeof openPersistenceDatabase>[] = [];
let presentation: CreationSkillCatalog;

beforeAll(async () => {
  presentation = await loadCreationSkillCatalog(PROJECT_ROOT, CATALOG.skillStage);
});

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function setupAdvisor(
  prefix: string,
  diceInputMode: 'AUTO' | 'MANUAL',
  speciesKeys: readonly SymbiontSpeciesKey[],
  ids: readonly string[],
  sampleFaces: readonly number[],
) {
  const directory = mkdtempSync(join(tmpdir(), `${prefix}-`));
  temporaryDirectories.push(directory);
  const setup = createManualWizardSetup(
    prefix,
    'UNITED',
    diceInputMode,
    join(directory, 'host.sqlite'),
  );
  databases.push(setup.database);
  const allocated: string[] = [];
  const samples: number[] = [];
  const dependencies = {
    catalog: setup.catalog,
    allocateRollRequestId: () => {
      const id = ids[allocated.length];
      if (id === undefined) throw new Error('unexpected roll ID allocation');
      allocated.push(id);
      return id;
    },
    sampleD20: () => {
      const face = sampleFaces[samples.length];
      if (face === undefined) throw new Error('unexpected D20 sample');
      samples.push(face);
      return face;
    },
  };
  const current = commitManualComposition(
    setup.database,
    manualCompositionRequest(setup, setup.checkpoint, `${prefix}-composition`, speciesKeys),
    `${prefix}-composition-receipt`,
    dependencies,
  );
  return { allocated, current, dependencies, samples, setup };
}

function replaceComposition(
  setup: ManualWizardSetup,
  current: DurableCreationWizardCheckpoint,
  dependencies: Parameters<typeof commitManualComposition>[3],
  commandId: string,
  speciesKeys: readonly SymbiontSpeciesKey[],
): DurableCreationWizardCheckpoint {
  return commitManualComposition(
    setup.database,
    manualCompositionRequest(setup, current, commandId, speciesKeys),
    `${commandId}-receipt`,
    dependencies,
  );
}

function reopen(setup: ManualWizardSetup): DurableCreationWizardCheckpoint {
  if (setup.database.open) setup.database.close();
  const database = openPersistenceDatabase(setup.database.name);
  databases.push(database);
  return loadCreationWizardCheckpoint(
    database,
    setup.characterDraftId,
    CATALOG.skillStage,
    CATALOG,
  );
}

describe('CHR-041 manual Advisor rolls and skills', () => {
  it('commits two AUTO I/W receipts and exact skills with identity continuity and restart', () => {
    const context = setupAdvisor(
      'advisor-auto',
      'AUTO',
      ['ADVISER', 'TAIPAN', 'OWL', 'EEL'],
      ['advisor-instance', 'pending-i', 'pending-w'],
      [7, 11],
    );
    const { dependencies, samples, setup } = context;
    let current = context.current;
    const request = manualAdvisorIwRequest(setup, current, 'auto-iw', null);
    const before = current.localCharacter.payloadJson;
    expect(() =>
      commitManualAdvisorIw(
        setup.database,
        request,
        ['advisor-auto-character', 'iw-w-receipt'],
        dependencies,
      ),
    ).toThrow('GUARD_REJECTED');
    expect(samples).toEqual([]);
    expect(current.localCharacter.payloadJson).toBe(before);

    current = commitManualAdvisorIw(
      setup.database,
      request,
      ['iw-i-receipt', 'iw-w-receipt'],
      dependencies,
    );
    expect(samples).toEqual([7, 11]);
    expect(current.manualCompositionStage?.advisorIwRecordOrNull).toMatchObject({
      physicalRolls: [
        {
          kind: 'ADVISOR_I',
          rollRequestId: 'pending-i',
          rollReceiptId: 'iw-i-receipt',
          mechanical: { rawFace: 7 },
        },
        {
          kind: 'ADVISOR_W',
          rollRequestId: 'pending-w',
          rollReceiptId: 'iw-w-receipt',
          mechanical: { rawFace: 11 },
        },
      ],
      receipt: {
        receiptId: 'iw-w-receipt',
        result: { advisorIw: { I: { value: 15 }, W: { value: 19 } } },
      },
    });
    expect(current.manualCompositionStage?.pendingSuppressionRollRequestIdOrNull).toBeNull();
    expect(current.durablePayload.randomReceiptIds.slice(-2)).toEqual([
      'iw-i-receipt',
      'iw-w-receipt',
    ]);

    const afterIw = current.localCharacter.payloadJson;
    expect(() =>
      commitManualAdvisorIw(
        setup.database,
        request,
        ['replay-i-receipt', 'replay-w-receipt'],
        dependencies,
      ),
    ).toThrow('GUARD_REJECTED');
    expect(current.localCharacter.payloadJson).toBe(afterIw);
    expect(samples).toEqual([7, 11]);

    current = replaceComposition(setup, current, dependencies, 'auto-remove', [
      'TAIPAN',
      'OWL',
      'EEL',
      'WEAVER',
    ]);
    current = replaceComposition(setup, current, dependencies, 'auto-readd', [
      'ADVISER',
      'TAIPAN',
      'OWL',
      'EEL',
    ]);
    expect(current.manualCompositionStage?.advisorInstanceDraftIdOrNull).toBe('advisor-instance');
    expect(current.manualCompositionStage?.advisorIwRecordOrNull?.receipt.receiptId).toBe(
      'iw-w-receipt',
    );
    expect(context.allocated).toEqual(['advisor-instance', 'pending-i', 'pending-w']);
    expect(samples).toEqual([7, 11]);

    const skills = exactManualAdvisorSkills(current, presentation);
    const skillRequest = manualAdvisorSkillRequest(setup, current, 'auto-skills', skills);
    const skillReceipt = commitCreationWizardCheckpoint(
      setup.database,
      skillRequest,
      'auto-skills-receipt',
      setup.catalog,
      undefined,
      dependencies,
    ).receipt;
    current = loadCreationWizardCheckpoint(
      setup.database,
      setup.characterDraftId,
      CATALOG.skillStage,
      CATALOG,
    );
    expect(skillReceipt.result).toMatchObject({
      variant: 'MANUAL_ADVISOR_SKILLS',
      nextFormId: 'CHR-019',
    });
    expect(current.manualCompositionStage?.advisorSkillRecordOrNull?.selectedSkills).toEqual(
      skills,
    );
    expect(current.nextStageEnvelope.formId).toBe('CHR-019');
    expect(
      loadCreationWizardCommandByCommandId(setup.database, 'auto-iw', CATALOG.skillStage, CATALOG)
        ?.receipt.receiptId,
    ).toBe('iw-w-receipt');
    expect(
      loadCreationWizardCommandByCommandId(
        setup.database,
        'auto-skills',
        CATALOG.skillStage,
        CATALOG,
      )?.receipt,
    ).toEqual(skillReceipt);
    expect(reopen(setup).manualCompositionStage).toEqual(current.manualCompositionStage);
    expect(samples).toEqual([7, 11]);
  });

  it('keeps roll-time B, teacher absorption and one identity across later replacement and re-addition', () => {
    const context = setupAdvisor(
      'advisor-manual-floor',
      'MANUAL',
      ['TROGR', 'TEACHER', 'ADVISER', 'TAIPAN'],
      ['advisor-instance', 'pending-i', 'pending-w', 'pending-b'],
      [],
    );
    const { dependencies, samples, setup } = context;
    let current = context.current;
    expect(current.manualCompositionStage?.pendingSuppressionRollRequestIdOrNull).toBeNull();
    current = commitManualAdvisorIw(
      setup.database,
      manualAdvisorIwRequest(setup, current, 'manual-iw', [8, 9]),
      ['manual-i-receipt', 'manual-w-receipt'],
      dependencies,
    );
    expect(samples).toEqual([]);
    expect(current.manualCompositionStage?.pendingSuppressionRollRequestIdOrNull).toBe('pending-b');
    const earlySkills = manualAdvisorSkillRequest(
      setup,
      current,
      'early-skills',
      exactManualAdvisorSkills(current, presentation),
    );
    expect(() =>
      commitManualAdvisorSkills(setup.database, earlySkills, 'early-skills-receipt', dependencies),
    ).toThrow('GUARD_REJECTED');

    const floorRequest = manualAdvisorFloorRollRequest(setup, current, 'manual-b', 2);
    current = commitAdvisorIntelligenceFloorRoll(
      setup.database,
      floorRequest,
      'manual-b-receipt',
      dependencies,
    );
    expect(
      current.manualCompositionStage?.suppressionRollRecordOrNull?.receipt.result,
    ).toMatchObject({
      minimumI: 5,
      suppressionB: 1,
      teacherAbsorbed: true,
      rollPurpose: 'FUTURE_MINIMUM_INTELLIGENCE',
    });
    expect(
      current.manualCompositionStage?.suppressionRollRecordOrNull?.physicalRoll.rollRequestId,
    ).toBe('pending-b');
    expect(samples).toEqual([]);

    current = replaceComposition(setup, current, dependencies, 'remove-teacher', [
      'TROGR',
      'ADVISER',
      'TAIPAN',
      'OWL',
    ]);
    const adapted = advisorIntelligenceFloorStageForManual(current, CATALOG);
    expect(
      adapted?.composition.instances.some(
        (instance) =>
          instance.speciesKey === 'TROGR' && instance.absorbedSpeciesKeys.includes('TEACHER'),
      ),
    ).toBe(true);
    expect(adapted?.rollRecordOrNull?.receipt.result.minimumI).toBe(5);
    expect(adapted?.pendingRollRequestIdOrNull).toBeNull();
    current = replaceComposition(setup, current, dependencies, 'remove-advisor', [
      'TROGR',
      'TAIPAN',
      'OWL',
      'EEL',
    ]);
    current = replaceComposition(setup, current, dependencies, 'readd-advisor', [
      'TROGR',
      'ADVISER',
      'TAIPAN',
      'OWL',
    ]);
    expect(current.manualCompositionStage).toMatchObject({
      advisorInstanceDraftIdOrNull: 'advisor-instance',
      iwRollRequestIdsOrNull: ['pending-i', 'pending-w'],
      pendingSuppressionRollRequestIdOrNull: null,
    });
    expect(
      current.manualCompositionStage?.suppressionRollRecordOrNull?.receipt.result.minimumI,
    ).toBe(5);
    expect(context.allocated).toEqual(['advisor-instance', 'pending-i', 'pending-w', 'pending-b']);
    const skills = exactManualAdvisorSkills(current, presentation);
    current = commitManualAdvisorSkills(
      setup.database,
      manualAdvisorSkillRequest(setup, current, 'manual-skills', skills),
      'manual-skills-receipt',
      dependencies,
    );
    expect(current.nextStageEnvelope.formId).toBe('CHR-019');
    expect(
      current.manualCompositionStage?.advisorSkillRecordOrNull?.receipt.result.effectsActive,
    ).toBe(false);
    expect(reopen(setup).manualCompositionStage).toEqual(current.manualCompositionStage);
    expect(samples).toEqual([]);
  });

  it('starts suppression after I/W, rejects stale or early commands and never samples twice', () => {
    const context = setupAdvisor(
      'advisor-late-floor',
      'AUTO',
      ['ADVISER', 'TAIPAN', 'OWL', 'EEL'],
      ['advisor-instance', 'pending-i', 'pending-w', 'pending-b'],
      [7, 9, 2],
    );
    const { dependencies, samples, setup } = context;
    let current = context.current;
    const iwRequest = manualAdvisorIwRequest(setup, current, 'late-iw', null);
    current = commitManualAdvisorIw(
      setup.database,
      iwRequest,
      ['late-i-receipt', 'late-w-receipt'],
      dependencies,
    );
    expect(samples).toEqual([7, 9]);
    expect(current.manualCompositionStage?.pendingSuppressionRollRequestIdOrNull).toBeNull();
    expect(() =>
      commitManualAdvisorIw(
        setup.database,
        { ...iwRequest, payload: { ...iwRequest.payload, manualFacesOrNull: [1, 1] } },
        ['changed-i-receipt', 'changed-w-receipt'],
        dependencies,
      ),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(samples).toEqual([7, 9]);

    current = replaceComposition(setup, current, dependencies, 'late-suppression', [
      'TROGR',
      'TEACHER',
      'ADVISER',
      'TAIPAN',
    ]);
    expect(current.manualCompositionStage?.pendingSuppressionRollRequestIdOrNull).toBe('pending-b');
    expect(samples).toEqual([7, 9]);
    const floorRequest = manualAdvisorFloorRollRequest(setup, current, 'late-b', null);
    expect(() =>
      commitAdvisorIntelligenceFloorRoll(
        setup.database,
        { ...floorRequest, payload: { ...floorRequest.payload, pendingRollRequestId: 'forged-b' } },
        'forged-b-receipt',
        dependencies,
      ),
    ).toThrow('GUARD_REJECTED');
    expect(samples).toEqual([7, 9]);
    current = commitAdvisorIntelligenceFloorRoll(
      setup.database,
      floorRequest,
      'late-b-receipt',
      dependencies,
    );
    expect(samples).toEqual([7, 9, 2]);
    expect(
      current.manualCompositionStage?.suppressionRollRecordOrNull?.receipt.result.minimumI,
    ).toBe(5);
    const beforeRefusal = current.localCharacter.payloadJson;
    expect(() =>
      commitAdvisorIntelligenceFloorRoll(
        setup.database,
        floorRequest,
        'second-b-receipt',
        dependencies,
      ),
    ).toThrow('GUARD_REJECTED');
    expect(current.localCharacter.payloadJson).toBe(beforeRefusal);
    expect(samples).toEqual([7, 9, 2]);

    const skills = exactManualAdvisorSkills(current, presentation);
    expect(() =>
      commitManualAdvisorSkills(
        setup.database,
        manualAdvisorSkillRequest(setup, current, 'underfilled-skills', skills.slice(0, -1)),
        'underfilled-receipt',
        dependencies,
      ),
    ).toThrow('GUARD_REJECTED');
    const overfilled = skills.map((skill, index) =>
      index === 0 ? { ...skill, targetBonus: skill.targetBonus + 1 } : skill,
    );
    expect(() =>
      commitManualAdvisorSkills(
        setup.database,
        manualAdvisorSkillRequest(setup, current, 'overfilled-skills', overfilled),
        'overfilled-receipt',
        dependencies,
      ),
    ).toThrow('GUARD_REJECTED');
    expect(current.localCharacter.payloadJson).toBe(beforeRefusal);
    expect(samples).toEqual([7, 9, 2]);
    current = commitManualAdvisorSkills(
      setup.database,
      manualAdvisorSkillRequest(setup, current, 'late-skills', skills),
      'late-skills-receipt',
      dependencies,
    );
    expect(current.nextStageEnvelope.formId).toBe('CHR-019');
    expect(reopen(setup).manualCompositionStage).toEqual(current.manualCompositionStage);
    expect(samples).toEqual([7, 9, 2]);
  });
});
