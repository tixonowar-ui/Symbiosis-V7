import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createStartingMoneyProfileSetup,
  MONEY_PROFILE_INPUTS,
  startingMoneyCommand,
  startingMoneyProfileRequest,
} from '../../tests/fixtures/starting-money-stage.js';
import { openPersistenceDatabase } from '../persistence/index.js';
import { commitWeaponProfile } from './creation-weapon-profile.js';
import {
  creationWizardDurableIds,
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  advanceStartingMoneyPresentation,
  commitStartingMoney,
} from './creation-starting-money.js';
import {
  derivedMoneyRequestId,
  startingMoneyStageForCheckpoint,
  type StartingMoneyRollRequest,
  type StartingMoneyCheckpointRequest,
} from './creation-starting-money-contract.js';
import { loadStartingMoneyCatalog } from './starting-money-catalog.js';
import { projectChr038 } from './projections/chr-starting-money.js';

type Prepared = Awaited<ReturnType<typeof createStartingMoneyProfileSetup>>;
let moneyCatalog: Awaited<ReturnType<typeof loadStartingMoneyCatalog>>;
const setups: Prepared['setup'][] = [];
const directories: string[] = [];
beforeAll(async () => {
  moneyCatalog = await loadStartingMoneyCatalog(process.cwd());
});
afterEach(() => {
  for (const setup of setups.splice(0)) if (setup.database.open) setup.database.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function ready(options: Parameters<typeof createStartingMoneyProfileSetup>[0]) {
  const prepared = await createStartingMoneyProfileSetup(options);
  setups.push(prepared.setup);
  let witness = 0;
  const allocateMoneyRollRequestId = vi.fn(() => `${options.prefix}-money-request`);
  const profileDependencies = {
    catalog: prepared.setup.catalog,
    profileCatalog: prepared.profileCatalog,
    allocateRequestId: vi.fn(() => `${options.prefix}-unused-profile`),
    allocateWitnessReceiptId: vi.fn(() => `${options.prefix}-witness-${String(++witness)}`),
  };
  const sampleD20 = vi.fn(() => 20);
  return {
    ...prepared,
    allocateMoneyRollRequestId,
    profileDependencies,
    moneyDependencies: { catalog: prepared.setup.catalog, moneyCatalog, sampleD20 },
  };
}

async function pending(
  options: Parameters<typeof createStartingMoneyProfileSetup>[0] & { readonly legacy?: boolean },
) {
  const prepared = await ready(options);
  const request = startingMoneyProfileRequest(prepared.current, `${options.prefix}-profile-submit`);
  const current = commitWeaponProfile(
    prepared.setup.database,
    request,
    `${options.prefix}-profile-receipt`,
    {
      ...prepared.profileDependencies,
      ...(options.legacy
        ? {}
        : { allocateMoneyRollRequestId: prepared.allocateMoneyRollRequestId }),
    },
  );
  return { ...prepared, current, profileRequest: request };
}

function rollRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  id: string,
  face: number | null,
): StartingMoneyRollRequest {
  return startingMoneyCommand(
    checkpoint,
    id,
    {
      sourceFormId: 'CHR-038',
      variant: 'STARTING_MONEY_ROLL',
      moneyRollRequestId: startingMoneyStageForCheckpoint(checkpoint)!.moneyRollRequestId,
      manualFaceOrNull: face,
    },
    true,
  ) as StartingMoneyRollRequest;
}
function checkpointRequest(
  checkpoint: DurableCreationWizardCheckpoint,
  id: string,
): StartingMoneyCheckpointRequest {
  const money = startingMoneyStageForCheckpoint(checkpoint)!;
  return startingMoneyCommand(checkpoint, id, {
    sourceFormId: 'CHR-038',
    variant: 'STARTING_MONEY_CHECKPOINT',
    moneyRollRequestId: money.moneyRollRequestId,
    moneyRollReceiptId: money.rollRecordOrNull!.receipt.receiptId,
  }) as StartingMoneyCheckpointRequest;
}
function reload(setup: Prepared['setup']) {
  return loadCreationWizardCheckpoint(
    setup.database,
    setup.characterDraftId,
    setup.catalog.skillStage,
    setup.catalog,
  );
}
function navigate(setup: Prepared['setup'], formId: 'CHR-022' | 'CHR-023' | 'CHR-024' | 'CHR-038') {
  return advanceStartingMoneyPresentation(
    setup.database,
    {
      characterDraftId: setup.characterDraftId,
      wizardCheckpointId: setup.wizardCheckpointId,
      formId,
    },
    setup.catalog,
  );
}
function rewritePayload(
  setup: Prepared['setup'],
  current: DurableCreationWizardCheckpoint,
  payload: unknown,
) {
  const payloadJson = JSON.stringify(payload);
  const snapshot = JSON.parse(current.checkpoint.snapshotJson) as {
    localCharacter: { payloadJson: string };
  };
  snapshot.localCharacter.payloadJson = payloadJson;
  const snapshotJson = JSON.stringify(snapshot);
  setup.database.transaction(() => {
    setup.database
      .prepare('UPDATE local_character SET payload_json = ? WHERE local_character_id = ?')
      .run(payloadJson, setup.characterDraftId);
    setup.database
      .prepare(
        'UPDATE local_character_checkpoint SET snapshot_json = ?, snapshot_sha256 = ? WHERE checkpoint_id = ?',
      )
      .run(
        snapshotJson,
        createHash('sha256').update(snapshotJson).digest('hex'),
        setup.wizardCheckpointId,
      );
  })();
}

describe('starting money durable continuation', () => {
  it.each(['FREE', 'PURE'] as const)(
    'binds one addressed pending request atomically to the final %s profile',
    async (raceChoice) => {
      const prepared = await ready({ prefix: `atomic-${raceChoice}`, raceChoice });
      const { setup, current, profileDependencies, allocateMoneyRollRequestId } = prepared;
      const accepted = commitWeaponProfile(
        setup.database,
        startingMoneyProfileRequest(current, 'profile-submit'),
        'profile-receipt',
        { ...profileDependencies, allocateMoneyRollRequestId },
      );
      const profile = accepted.weaponProfileStage!.records.at(-1)!;
      expect(allocateMoneyRollRequestId).toHaveBeenCalledTimes(1);
      expect(accepted.startingMoneyStage).toMatchObject({
        entryMode: 'ATOMIC_PROFILE',
        profileReceiptId: profile.receipt.receiptId,
        moneyRollRequestId: `atomic-${raceChoice}-money-request`,
        entryRequest: profile.request,
        entryReceipt: profile.receipt,
        rollRecordOrNull: null,
        checkpointRecordOrNull: null,
      });
      expect(profile.receipt.result['moneyRollRequestId']).toBe(
        accepted.startingMoneyStage!.moneyRollRequestId,
      );
      expect(
        creationWizardDurableIds(accepted).has(accepted.startingMoneyStage!.moneyRollRequestId),
      ).toBe(true);
      expect(accepted.checkpoint.checkpointRevision).toBe(
        current.checkpoint.checkpointRevision + 1,
      );
      expect(reload(setup).startingMoneyStage).toEqual(accepted.startingMoneyStage);
      expect(
        loadCreationWizardCommandByCommandId(
          setup.database,
          profile.request.commandId,
          setup.catalog.skillStage,
          setup.catalog,
        )?.receipt,
      ).toEqual(profile.receipt);
      expect(allocateMoneyRollRequestId).toHaveBeenCalledTimes(1);
    },
  );

  it('does not allocate money for an invalid formula attempt', async () => {
    const { setup, current, profileDependencies, allocateMoneyRollRequestId } = await ready({
      prefix: 'invalid-profile',
    });
    const invalid = commitWeaponProfile(
      setup.database,
      startingMoneyProfileRequest(current, 'invalid-submit', {
        ...MONEY_PROFILE_INPUTS,
        formulaOutputs: { Dm: 999, Rn: 6, Rs: 1, Rd: 2 },
      }),
      'invalid-receipt',
      { ...profileDependencies, allocateMoneyRollRequestId },
    );
    expect(invalid.weaponProfileStage!.records.at(-1)!.receipt.result.outcome).toBe('INVALID');
    expect(startingMoneyStageForCheckpoint(invalid)).toBeNull();
    expect(allocateMoneyRollRequestId).not.toHaveBeenCalled();
  });

  it.each(['AUTO', 'MANUAL'] as const)(
    'commits exactly one %s D20 and returns immutable history on replay',
    async (diceInputMode) => {
      const { setup, current, moneyDependencies } = await pending({
        prefix: `money-${diceInputMode}`,
        diceInputMode,
      });
      const request = rollRequest(current, 'money-roll', diceInputMode === 'MANUAL' ? 1 : null);
      const rolled = commitStartingMoney(
        setup.database,
        request,
        'money-roll-receipt',
        moneyDependencies,
      );
      expect(moneyDependencies.sampleD20).toHaveBeenCalledTimes(diceInputMode === 'AUTO' ? 1 : 0);
      expect(rolled.startingMoneyStage!.rollRecordOrNull!.physicalRoll.mechanical).toEqual({
        dieSides: 20,
        rawFace: diceInputMode === 'AUTO' ? 20 : 1,
      });
      expect(rolled.receipt.result['gmFinalizationRequired']).toBe(true);
      expect(rolled.weaponProfileStage).toEqual(current.weaponProfileStage);
      expect(rolled.startingWeaponStage).toEqual(current.startingWeaponStage);
      expect(rolled.durablePayload.randomReceiptIds).toEqual([
        ...current.durablePayload.randomReceiptIds,
        ...(diceInputMode === 'AUTO' ? ['money-roll-receipt'] : []),
      ]);
      const before = rolled.localCharacter;
      expect(() =>
        commitStartingMoney(setup.database, request, 'new-replay-receipt', moneyDependencies),
      ).toThrow();
      expect(() =>
        commitStartingMoney(
          setup.database,
          { ...request, payload: { ...request.payload, manualFaceOrNull: 2 } },
          'changed-replay-receipt',
          moneyDependencies,
        ),
      ).toThrow();
      expect(
        loadCreationWizardCommandByCommandId(
          setup.database,
          request.commandId,
          setup.catalog.skillStage,
          setup.catalog,
        )?.receipt,
      ).toEqual(rolled.receipt);
      expect(reload(setup).localCharacter).toEqual(before);
      expect(moneyDependencies.sampleD20).toHaveBeenCalledTimes(diceInputMode === 'AUTO' ? 1 : 0);
      const serialized = JSON.stringify(projectChr038(rolled, true, true).roleFilteredPayload);
      expect(serialized).not.toMatch(
        /CORE-|AQ2-|Источник|availabilityTrace|finalAmount|masterApproval|currency|xpDelta|criticalChain/,
      );
    },
  );

  it.each(['FREE', 'PURE'] as const)(
    'derives the legacy %s address without writing and materializes it with the first roll',
    async (raceChoice) => {
      const { setup, current, allocateMoneyRollRequestId, moneyDependencies } = await pending({
        prefix: `legacy-${raceChoice}`,
        raceChoice,
        legacy: true,
      });
      const original = current.localCharacter;
      const profile = current.weaponProfileStage!.records.at(-1)!;
      expect(current.startingMoneyStage ?? null).toBeNull();
      const derived = startingMoneyStageForCheckpoint(current)!;
      expect(derived.entryMode).toBe('DERIVED_PROFILE_RECEIPT');
      expect(derived.moneyRollRequestId).toBe(derivedMoneyRequestId(profile));
      expect(startingMoneyStageForCheckpoint(reload(setup))).toEqual(derived);
      expect(reload(setup).localCharacter).toEqual(original);
      expect(allocateMoneyRollRequestId).not.toHaveBeenCalled();
      const rolled = commitStartingMoney(
        setup.database,
        rollRequest(current, 'legacy-money-roll', 19),
        'legacy-money-receipt',
        moneyDependencies,
      );
      expect({ ...rolled.startingMoneyStage, rollRecordOrNull: null }).toEqual(derived);
      expect(rolled.startingMoneyStage!.rollRecordOrNull).not.toBeNull();
      expect(rolled.weaponProfileStage).toEqual(current.weaponProfileStage);
      expect(rolled.checkpoint.checkpointRevision).toBe(current.checkpoint.checkpointRevision + 1);
      expect(moneyDependencies.sampleD20).not.toHaveBeenCalled();
      expect(allocateMoneyRollRequestId).not.toHaveBeenCalled();
    },
  );

  it('rejects stale, wrong-form and foreign requests before sampling or writing', async () => {
    const { setup, current, moneyDependencies } = await pending({
      prefix: 'money-guards',
      diceInputMode: 'AUTO',
    });
    const returned = navigate(setup, 'CHR-022');
    const requests = [
      rollRequest(current, 'stale', null),
      rollRequest(returned, 'wrong-form', null),
    ];
    for (const request of requests)
      expect(() =>
        commitStartingMoney(
          setup.database,
          request,
          `${request.commandId}-receipt`,
          moneyDependencies,
        ),
      ).toThrow();
    navigate(setup, 'CHR-023');
    const resumed = navigate(setup, 'CHR-038');
    const request = rollRequest(resumed, 'foreign', null);
    expect(() =>
      commitStartingMoney(
        setup.database,
        { ...request, payload: { ...request.payload, moneyRollRequestId: 'foreign-request' } },
        'foreign-receipt',
        moneyDependencies,
      ),
    ).toThrow();
    expect(reload(setup).localCharacter).toEqual(resumed.localCharacter);
    expect(moneyDependencies.sampleD20).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'rejects an empty receipt ID before AUTO sampling (legacy=%s)',
    async (legacy) => {
      const { setup, current, moneyDependencies } = await pending({
        prefix: `empty-receipt-${String(legacy)}`,
        diceInputMode: 'AUTO',
        legacy,
      });
      expect(() =>
        commitStartingMoney(
          setup.database,
          rollRequest(current, 'empty-receipt-roll', null),
          '',
          moneyDependencies,
        ),
      ).toThrow();
      expect(moneyDependencies.sampleD20).not.toHaveBeenCalled();
      expect(reload(setup).localCharacter).toEqual(current.localCharacter);
    },
  );

  it.each(['FREE', 'PURE'] as const)(
    'keeps the same %s profile and request through safe-return before and after roll',
    async (raceChoice) => {
      const { setup, current, moneyDependencies, allocateMoneyRollRequestId } = await pending({
        prefix: `return-${raceChoice}`,
        raceChoice,
      });
      let authoritative = current;
      for (const afterRoll of [false, true]) {
        if (afterRoll)
          authoritative = commitStartingMoney(
            setup.database,
            rollRequest(reload(setup), 'return-roll', 15),
            'return-roll-receipt',
            moneyDependencies,
          );
        for (const formId of [
          'CHR-022',
          raceChoice === 'PURE' ? 'CHR-024' : 'CHR-023',
          'CHR-038',
        ] as const) {
          const navigated = navigate(setup, formId);
          expect(navigated.localCharacter.payloadJson).toBe(
            authoritative.localCharacter.payloadJson,
          );
          expect(navigated.localCharacter.stateRevision).toBe(
            authoritative.localCharacter.stateRevision,
          );
          expect(navigated.weaponProfileStage).toEqual(current.weaponProfileStage);
          expect(reload(setup).startingMoneyStage).toEqual(authoritative.startingMoneyStage);
        }
      }
      expect(allocateMoneyRollRequestId).toHaveBeenCalledTimes(1);
      expect(moneyDependencies.sampleD20).not.toHaveBeenCalled();
    },
  );

  it.each(['PENDING', 'ROLLED', 'CHECKPOINTED'] as const)(
    'restores %s exactly after SQLite close/reopen',
    async (phase) => {
      const directory = mkdtempSync(join(tmpdir(), 'money-reopen-'));
      directories.push(directory);
      const databasePath = join(directory, 'money.sqlite');
      const { setup, current, moneyDependencies } = await pending({
        prefix: `reopen-${phase}`,
        databasePath,
        diceInputMode: 'AUTO',
      });
      let expected = current;
      if (phase !== 'PENDING')
        expected = commitStartingMoney(
          setup.database,
          rollRequest(expected, 'reopen-roll', null),
          'reopen-roll-receipt',
          moneyDependencies,
        );
      if (phase === 'CHECKPOINTED')
        expected = commitStartingMoney(
          setup.database,
          checkpointRequest(expected, 'reopen-checkpoint'),
          'reopen-checkpoint-receipt',
          moneyDependencies,
        );
      setup.database.close();
      const database = openPersistenceDatabase(databasePath);
      try {
        const restored = loadCreationWizardCheckpoint(
          database,
          setup.characterDraftId,
          setup.catalog.skillStage,
          setup.catalog,
        );
        expect(restored.localCharacter).toEqual(expected.localCharacter);
        expect(restored.startingMoneyStage).toEqual(expected.startingMoneyStage);
        expect(moneyDependencies.sampleD20).toHaveBeenCalledTimes(phase === 'PENDING' ? 0 : 1);
        if (phase === 'CHECKPOINTED') {
          expect(restored.nextStageEnvelope.formId).toBe('CHR-037');
          expect(projectChr038(restored, true, true).availableActionKeys).toEqual([
            'CHR-038::CTA::001',
          ]);
          expect(projectChr038(restored, true, true).roleFilteredPayload).toMatchObject({
            positionsEntryMode: 'RESUME',
            nextFormId: 'CHR-037',
          });
          expect(() =>
            advanceStartingMoneyPresentation(
              database,
              {
                characterDraftId: setup.characterDraftId,
                wizardCheckpointId: setup.wizardCheckpointId,
                formId: 'CHR-022',
              },
              setup.catalog,
            ),
          ).toThrow();
        }
      } finally {
        database.close();
      }
    },
  );

  it.each([
    'profileReceiptId',
    'weaponCheckpointReceiptId',
    'moneyRollRequestId',
    'diceInputModeSnapshot',
    'physicalFace',
    'recommendation',
    'gmFinalization',
    'priorReceipt',
    'priorWitness',
    'missingStage',
  ] as const)('rejects checksum-valid %s corruption', async (field) => {
    const { setup, current, moneyDependencies } = await pending({ prefix: `corrupt-${field}` });
    const rolled = commitStartingMoney(
      setup.database,
      rollRequest(current, 'corrupt-roll', 19),
      'corrupt-roll-receipt',
      moneyDependencies,
    );
    const payload = JSON.parse(rolled.localCharacter.payloadJson) as {
      receipt: Record<string, unknown>;
      startingMoneyStage?: Record<string, unknown> & {
        rollRecordOrNull: {
          physicalRoll: { mechanical: { rawFace: number } };
          wealthRecommendation: Record<string, unknown>;
          receipt: { receiptId: string; result: Record<string, unknown> };
        };
      };
    };
    const stage = payload.startingMoneyStage!;
    const record = stage.rollRecordOrNull;
    if (field === 'physicalFace') {
      record.physicalRoll.mechanical.rawFace = 18;
      record.receipt.result['physicalRoll'] = record.physicalRoll;
    } else if (field === 'recommendation') {
      record.wealthRecommendation['kind'] = 'NONE';
      record.receipt.result['wealthRecommendation'] = record.wealthRecommendation;
    } else if (field === 'gmFinalization') record.receipt.result['gmFinalizationRequired'] = false;
    else if (field === 'priorReceipt')
      record.receipt.receiptId =
        rolled.startingWeaponStage!.qualityRollRecordOrNull!.receipt.receiptId;
    else if (field === 'priorWitness')
      record.receipt.receiptId =
        rolled.weaponProfileStage!.records.at(
          -1,
        )!.receipt.result.independentManufacturingDiceReceipts[0]!.receiptId;
    else if (field === 'missingStage') delete payload.startingMoneyStage;
    else stage[field] = field === 'diceInputModeSnapshot' ? 'AUTO' : 'foreign-' + field;
    payload.receipt = record.receipt;
    rewritePayload(setup, rolled, payload);
    expect(() => reload(setup)).toThrow();
  });

  it('rolls back final profile and pending money together when the allocated address reuses a witness or prior receipt', async () => {
    for (const reused of ['prior', 'witness'] as const) {
      const { setup, current, profileDependencies } = await ready({
        prefix: `collision-${reused}`,
      });
      const before = current.localCharacter;
      const id =
        reused === 'prior'
          ? current.startingWeaponStage!.qualityRollRecordOrNull!.receipt.receiptId
          : `collision-${reused}-witness-1`;
      expect(() =>
        commitWeaponProfile(
          setup.database,
          startingMoneyProfileRequest(current, 'collision-submit'),
          'collision-submit-receipt',
          { ...profileDependencies, allocateMoneyRollRequestId: () => id },
        ),
      ).toThrow();
      expect(reload(setup).localCharacter).toEqual(before);
    }
  });

  it('rejects a coordinated null allocated ID instead of treating it as a legacy missing field', async () => {
    const { setup, current } = await pending({ prefix: 'null-allocated-money' });
    const payload = JSON.parse(current.localCharacter.payloadJson) as {
      receipt: { result: Record<string, unknown> };
      weaponProfileStage: { records: { receipt: { result: Record<string, unknown> } }[] };
      startingMoneyStage: {
        moneyRollRequestId: string;
        entryReceipt: { result: Record<string, unknown> };
      };
    };
    payload.receipt.result['moneyRollRequestId'] = null;
    payload.weaponProfileStage.records.at(-1)!.receipt.result['moneyRollRequestId'] = null;
    payload.startingMoneyStage.entryReceipt.result['moneyRollRequestId'] = null;
    payload.startingMoneyStage.moneyRollRequestId = derivedMoneyRequestId(
      current.weaponProfileStage!.records.at(-1)!,
    );
    rewritePayload(setup, current, payload);
    expect(() => reload(setup)).toThrow();
  });
});
