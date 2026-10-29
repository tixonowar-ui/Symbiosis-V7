import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFiveStartingPositionsSetup,
  fiveStartingPositionSelections,
  fiveStartingPositionRollRequest,
  fiveStartingPositionsCheckpointRequest,
} from '../../tests/fixtures/five-starting-positions-stage.js';
import { openPersistenceDatabase } from '../persistence/index.js';
import {
  creationWizardDurableIds,
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  commitFiveStartingPositions,
  advanceFiveStartingPositionsPresentation,
} from './creation-five-starting-positions.js';
import {
  fiveStartingPositionsStageForCheckpoint,
  fiveStartingPositionsStageIds,
  fiveStartingPositionSnapshots,
  fiveStartingPositionsPresentationForm,
  type FiveStartingPositionSelection,
} from './creation-five-starting-positions-contract.js';

type Prepared = Awaited<ReturnType<typeof createFiveStartingPositionsSetup>>;
const setups: Prepared['setup'][] = [];
const directories: string[] = [];
afterEach(() => {
  for (const setup of setups.splice(0)) if (setup.database.open) setup.database.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
async function pending(options: Parameters<typeof createFiveStartingPositionsSetup>[0]) {
  const prepared = await createFiveStartingPositionsSetup(options);
  setups.push(prepared.setup);
  let index = 0;
  const faces = [1, 5, 10, 19, 20];
  const sampleD20 = vi.fn(() => {
    const face = faces[index++];
    if (face === undefined) throw new Error('unexpected sixth position sample');
    return face;
  });
  return {
    ...prepared,
    dependencies: {
      catalog: prepared.setup.catalog,
      positionsCatalog: prepared.positionsCatalog,
      sampleD20,
    },
  };
}
function reload(setup: Prepared['setup']) {
  return loadCreationWizardCheckpoint(
    setup.database,
    setup.characterDraftId,
    setup.catalog.skillStage,
    setup.catalog,
  );
}
function navigate(setup: Prepared['setup'], formId: 'CHR-037' | 'CHR-038') {
  return advanceFiveStartingPositionsPresentation(
    setup.database,
    {
      characterDraftId: setup.characterDraftId,
      wizardCheckpointId: setup.wizardCheckpointId,
      formId,
    },
    setup.catalog,
  );
}
function replacePayload(
  setup: Prepared['setup'],
  checkpoint: DurableCreationWizardCheckpoint,
  payload: unknown,
) {
  const payloadJson = JSON.stringify(payload);
  const snapshot = JSON.parse(checkpoint.checkpoint.snapshotJson) as {
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

describe('five starting positions durable history', () => {
  it.each(['FREE', 'PURE'] as const)(
    'atomically binds ten addresses to a completed %s money checkpoint',
    async (raceChoice) => {
      const { setup, current } = await pending({ prefix: `five-entry-${raceChoice}`, raceChoice });
      const stage = current.fiveStartingPositionsStage!;
      const money = current.startingMoneyStage!.checkpointRecordOrNull!;
      expect(stage.slots).toHaveLength(5);
      expect(fiveStartingPositionsStageIds(stage).size).toBe(10);
      for (const id of fiveStartingPositionsStageIds(stage))
        expect(creationWizardDurableIds(current).has(id)).toBe(true);
      expect(stage.entryRequest).toEqual(money.request);
      expect(stage.entryReceipt).toEqual(money.receipt);
      expect(stage.draftSelections).toEqual([]);
      expect(stage.rollRecords).toEqual([]);
      expect(current.receipt).toEqual(money.receipt);
      expect(reload(setup).fiveStartingPositionsStage).toEqual(stage);
      expect(
        loadCreationWizardCommandByCommandId(
          setup.database,
          money.request.commandId,
          setup.catalog.skillStage,
          setup.catalog,
        )?.receipt,
      ).toEqual(money.receipt);
    },
  );

  it.each(['AUTO', 'MANUAL'] as const)(
    'persists five independent %s stack rolls, including repeated types and a story stack',
    async (diceInputMode) => {
      const { setup, current, dependencies } = await pending({
        prefix: `five-rolls-${diceInputMode}`,
        diceInputMode,
      });
      let checkpoint = current;
      const choices = fiveStartingPositionSelections(current);
      const expectedFaces = [1, 5, 10, 19, 20];
      const receipts: string[] = [];
      for (let index = 0; index < 5; index++) {
        const request = fiveStartingPositionRollRequest(
          checkpoint,
          `position-roll-${String(index)}`,
          index,
          choices,
          diceInputMode === 'AUTO' ? null : expectedFaces[index]!,
        );
        const before = checkpoint;
        const receiptId = `position-receipt-${String(index)}`;
        receipts.push(receiptId);
        checkpoint = commitFiveStartingPositions(setup.database, request, receiptId, dependencies);
        const stage = checkpoint.fiveStartingPositionsStage!;
        expect(stage.rollRecords).toHaveLength(index + 1);
        expect(stage.rollRecords.at(-1)!.physicalRoll.mechanical).toEqual({
          dieSides: 20,
          rawFace: expectedFaces[index],
        });
        expect(stage.rollRecords.at(-1)!.position.quantity).toBe(choices[index]!.quantity);
        expect(checkpoint.checkpoint.checkpointRevision).toBe(
          before.checkpoint.checkpointRevision + 1,
        );
        expect(checkpoint.startingMoneyStage).toEqual(current.startingMoneyStage);
        expect(checkpoint.weaponProfileStage).toEqual(current.weaponProfileStage);
        expect(
          loadCreationWizardCommandByCommandId(
            setup.database,
            request.commandId,
            setup.catalog.skillStage,
            setup.catalog,
          )?.receipt,
        ).toEqual(checkpoint.receipt);
        const committed = checkpoint.localCharacter;
        expect(() =>
          commitFiveStartingPositions(
            setup.database,
            request,
            `repeat-${String(index)}`,
            dependencies,
          ),
        ).toThrow();
        expect(() =>
          commitFiveStartingPositions(
            setup.database,
            { ...request, payload: { ...request.payload, manualFaceOrNull: 7 } },
            `changed-${String(index)}`,
            dependencies,
          ),
        ).toThrow();
        expect(reload(setup).localCharacter).toEqual(committed);
      }
      expect(dependencies.sampleD20).toHaveBeenCalledTimes(diceInputMode === 'AUTO' ? 5 : 0);
      const stage = checkpoint.fiveStartingPositionsStage!;
      expect(
        new Set(stage.rollRecords.map((record) => record.physicalRoll.rollRequestId)).size,
      ).toBe(5);
      expect(new Set(stage.rollRecords.map((record) => record.receipt.receiptId)).size).toBe(5);
      const positions = fiveStartingPositionSnapshots(stage);
      expect(positions[0]!.itemTypeIdOrStoryType).toBe(positions[1]!.itemTypeIdOrStoryType);
      expect(positions[0]!.qualityRollRequestId).not.toBe(positions[1]!.qualityRollRequestId);
      expect(positions[4]).toMatchObject({
        kind: 'STORY',
        itemTypeIdOrStoryType: 'GEN-010',
        quantity: 2,
        storyDescriptionOrNull: choices[4]!.storyDescriptionOrNull,
      });
      expect(checkpoint.durablePayload.randomReceiptIds).toEqual([
        ...current.durablePayload.randomReceiptIds,
        ...(diceInputMode === 'AUTO' ? receipts : []),
      ]);
      const confirmed = commitFiveStartingPositions(
        setup.database,
        fiveStartingPositionsCheckpointRequest(checkpoint, 'five-checkpoint'),
        'five-checkpoint-receipt',
        dependencies,
      );
      expect(confirmed.nextStageEnvelope.formId).toBe('CHR-032');
      expect(fiveStartingPositionsPresentationForm(confirmed)).toBe('CHR-037');
      expect(confirmed.receipt.result).toMatchObject({
        distinctPositionCount: 5,
        storyItemCountsAsOnePosition: true,
        ownershipState: 'OWNED_NOT_EQUIPPED',
      });
      expect(fiveStartingPositionSnapshots(confirmed.fiveStartingPositionsStage!)).toEqual(
        positions,
      );
      expect(() => navigate(setup, 'CHR-038')).toThrow();
      expect(dependencies.sampleD20).toHaveBeenCalledTimes(diceInputMode === 'AUTO' ? 5 : 0);
    },
  );

  it('preserves execution history and slot identity when stacks are rolled out of order', async () => {
    const { setup, current, dependencies } = await pending({
      prefix: 'five-nonsequential',
      diceInputMode: 'AUTO',
    });
    const choices = fiveStartingPositionSelections(current);
    const order = [4, 1, 3, 0, 2];
    const faces = [1, 5, 10, 19, 20];
    let checkpoint = current;
    for (const selectedIndex of order) {
      const committed = commitFiveStartingPositions(
        setup.database,
        fiveStartingPositionRollRequest(
          checkpoint,
          `unordered-roll-${String(selectedIndex)}`,
          selectedIndex,
          choices,
        ),
        `unordered-receipt-${String(selectedIndex)}`,
        dependencies,
      );
      checkpoint = reload(setup);
      expect(checkpoint.localCharacter).toEqual(committed.localCharacter);
    }
    expect(
      checkpoint.fiveStartingPositionsStage!.rollRecords.map(
        (record) => record.position.positionId,
      ),
    ).toEqual(order.map((index) => choices[index]!.positionId));
    expect(
      fiveStartingPositionSnapshots(checkpoint.fiveStartingPositionsStage!).map((position) => ({
        positionId: position.positionId,
        face: position.qualityRollFaceOrNull,
        receiptId: position.qualityRollReceiptId,
      })),
    ).toEqual(
      choices.map((choice, index) => ({
        positionId: choice.positionId,
        face: faces[order.indexOf(index)],
        receiptId: `unordered-receipt-${String(index)}`,
      })),
    );
    const completed = commitFiveStartingPositions(
      setup.database,
      fiveStartingPositionsCheckpointRequest(checkpoint, 'unordered-checkpoint'),
      'unordered-checkpoint-receipt',
      dependencies,
    );
    expect(completed.nextStageEnvelope.formId).toBe('CHR-032');
    expect(dependencies.sampleD20).toHaveBeenCalledTimes(5);
    expect(reload(setup).fiveStartingPositionsStage).toEqual(completed.fiveStartingPositionsStage);
  });

  it('rolls back the complete stack result when SQLite rejects the checkpoint write', async () => {
    const { setup, current, dependencies } = await pending({
      prefix: 'five-transaction-rollback',
      diceInputMode: 'AUTO',
    });
    const presentationBefore = setup.database
      .prepare('SELECT * FROM local_character_symbiont_presentation WHERE local_character_id = ?')
      .get(setup.characterDraftId);
    setup.database.exec(`
      CREATE TRIGGER reject_five_position_checkpoint
      BEFORE UPDATE ON local_character_checkpoint
      BEGIN
        SELECT RAISE(ABORT, 'injected five-position checkpoint failure');
      END
    `);
    expect(() =>
      commitFiveStartingPositions(
        setup.database,
        fiveStartingPositionRollRequest(current, 'rollback-roll', 4),
        'rollback-receipt',
        dependencies,
      ),
    ).toThrow('injected five-position checkpoint failure');
    expect(dependencies.sampleD20).toHaveBeenCalledTimes(1);
    const restored = reload(setup);
    expect(restored.localCharacter).toEqual(current.localCharacter);
    expect(restored.checkpoint).toEqual(current.checkpoint);
    expect(restored.fiveStartingPositionsStage).toEqual(current.fiveStartingPositionsStage);
    expect(
      setup.database
        .prepare('SELECT * FROM local_character_symbiont_presentation WHERE local_character_id = ?')
        .get(setup.characterDraftId),
    ).toEqual(presentationBefore);
    expect(
      loadCreationWizardCommandByCommandId(
        setup.database,
        'rollback-roll',
        setup.catalog.skillStage,
        setup.catalog,
      ),
    ).toBeNull();
    expect(creationWizardDurableIds(restored).has('rollback-receipt')).toBe(false);
  });

  it.each([
    'empty',
    'four',
    'six',
    'duplicatePosition',
    'unknownType',
    'zero',
    'negative',
    'fractional',
    'storyEmpty',
    'mechanicalText',
  ] as const)(
    'rejects %s in the complete five-position draft before RNG or writes',
    async (invalid) => {
      const { setup, current, dependencies } = await pending({
        prefix: `five-invalid-${invalid}`,
        diceInputMode: 'AUTO',
      });
      let choices: FiveStartingPositionSelection[] = [...fiveStartingPositionSelections(current)];
      if (invalid === 'empty') choices = [];
      else if (invalid === 'four') choices.pop();
      else if (invalid === 'six') choices.push({ ...choices[0]!, positionId: 'sixth-position' });
      else if (invalid === 'duplicatePosition')
        choices[4] = { ...choices[4]!, positionId: choices[0]!.positionId };
      else if (invalid === 'unknownType')
        choices[4] = { ...choices[4]!, itemTypeIdOrStoryType: 'unknown-item' };
      else if (invalid === 'storyEmpty')
        choices[4] = { ...choices[4]!, storyDescriptionOrNull: '' };
      else if (invalid === 'mechanicalText')
        choices[4] = { ...choices[4]!, storyDescriptionOrNull: 'CORE-172 gives a bonus' };
      else
        choices[4] = {
          ...choices[4]!,
          quantity: invalid === 'zero' ? 0 : invalid === 'negative' ? -1 : 1.5,
        };
      expect(() =>
        commitFiveStartingPositions(
          setup.database,
          fiveStartingPositionRollRequest(current, 'invalid-five-roll', 0, choices),
          'invalid-five-receipt',
          dependencies,
        ),
      ).toThrow();
      expect(dependencies.sampleD20).not.toHaveBeenCalled();
      expect(reload(setup).localCharacter).toEqual(current.localCharacter);
      expect(reload(setup).checkpoint).toEqual(current.checkpoint);
    },
  );

  it('allows edits to pending selections but preserves every previously committed stack exactly', async () => {
    const { setup, current, dependencies } = await pending({ prefix: 'five-edit' });
    const original = fiveStartingPositionSelections(current);
    const first = commitFiveStartingPositions(
      setup.database,
      fiveStartingPositionRollRequest(current, 'first-roll', 0, original),
      'first-receipt',
      dependencies,
    );
    const edited = original.map((row, index) =>
      index === 1 ? { ...row, quantity: 7, itemTypeIdOrStoryType: 'RES-AMM-002' } : row,
    );
    const second = commitFiveStartingPositions(
      setup.database,
      fiveStartingPositionRollRequest(first, 'second-roll', 1, edited),
      'second-receipt',
      dependencies,
    );
    expect(second.fiveStartingPositionsStage!.rollRecords[0]).toEqual(
      first.fiveStartingPositionsStage!.rollRecords[0],
    );
    expect(second.fiveStartingPositionsStage!.draftSelections[1]).toMatchObject(edited[1]!);
    const changedCommitted = edited.map((row, index) =>
      index === 0 ? { ...row, quantity: 99 } : row,
    );
    expect(() =>
      commitFiveStartingPositions(
        setup.database,
        fiveStartingPositionRollRequest(second, 'locked-edit', 2, changedCommitted),
        'locked-edit-receipt',
        dependencies,
      ),
    ).toThrow();
    expect(reload(setup).localCharacter).toEqual(second.localCharacter);
    expect(dependencies.sampleD20).not.toHaveBeenCalled();
  });

  it('rejects foreign, stale, reused, wrong-mode and malformed IDs without consuming AUTO RNG', async () => {
    const { setup, current, dependencies } = await pending({
      prefix: 'five-guards',
      diceInputMode: 'AUTO',
    });
    const request = fiveStartingPositionRollRequest(current, 'five-guard-command', 0);
    for (const mutated of [
      { ...request, payload: { ...request.payload, qualityRollRequestId: 'foreign-quality' } },
      { ...request, payload: { ...request.payload, moneyCheckpointReceiptId: 'foreign-money' } },
      { ...request, payload: { ...request.payload, manualFaceOrNull: 1 } },
      { ...request, commandId: current.startingMoneyStage!.rollRecordOrNull!.request.commandId },
    ])
      expect(() =>
        commitFiveStartingPositions(setup.database, mutated, 'five-guard-receipt', dependencies),
      ).toThrow();
    expect(() => commitFiveStartingPositions(setup.database, request, '', dependencies)).toThrow();
    expect(() =>
      commitFiveStartingPositions(
        setup.database,
        request,
        current.weaponProfileStage!.records.at(-1)!.receipt.result
          .independentManufacturingDiceReceipts[0]!.receiptId,
        dependencies,
      ),
    ).toThrow();
    navigate(setup, 'CHR-038');
    const returned = reload(setup);
    expect(() =>
      commitFiveStartingPositions(setup.database, request, 'stale-five-receipt', dependencies),
    ).toThrow();
    expect(() =>
      commitFiveStartingPositions(
        setup.database,
        fiveStartingPositionRollRequest(returned, 'wrong-form', 0),
        'wrong-form-receipt',
        dependencies,
      ),
    ).toThrow();
    expect(reload(setup).localCharacter).toEqual(returned.localCharacter);
    expect(dependencies.sampleD20).not.toHaveBeenCalled();
  });

  it('rejects partial, duplicate and foreign receipt lists at the final checkpoint', async () => {
    const { setup, current, dependencies } = await pending({ prefix: 'five-final-refs' });
    let checkpoint = current;
    for (let index = 0; index < 5; index++)
      checkpoint = commitFiveStartingPositions(
        setup.database,
        fiveStartingPositionRollRequest(checkpoint, `ref-roll-${String(index)}`, index),
        `ref-receipt-${String(index)}`,
        dependencies,
      );
    const request = fiveStartingPositionsCheckpointRequest(checkpoint, 'refs-checkpoint');
    const refs = request.payload.positionReceipts;
    for (const changed of [
      [],
      refs.slice(0, 4),
      [...refs, refs[0]!],
      refs.map((ref, index) =>
        index === 4 ? { ...ref, qualityRollReceiptId: refs[0]!.qualityRollReceiptId } : ref,
      ),
      refs.map((ref, index) =>
        index === 4 ? { ...ref, qualityRollReceiptId: 'foreign-receipt' } : ref,
      ),
    ])
      expect(() =>
        commitFiveStartingPositions(
          setup.database,
          { ...request, payload: { ...request.payload, positionReceipts: changed } },
          'ref-checkpoint-receipt',
          dependencies,
        ),
      ).toThrow();
    expect(reload(setup).localCharacter).toEqual(checkpoint.localCharacter);
    expect(dependencies.sampleD20).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'PARTIAL', 'COMPLETE', 'CHECKPOINTED'] as const)(
    'restores %s positions after real SQLite reopen and preserves safe-return',
    async (phase) => {
      const directory = mkdtempSync(join(tmpdir(), 'five-position-reopen-'));
      directories.push(directory);
      const databasePath = join(directory, 'five.sqlite');
      const { setup, current, dependencies } = await pending({
        prefix: `five-reopen-${phase}`,
        databasePath,
        diceInputMode: 'AUTO',
      });
      let checkpoint = current;
      const count = phase === 'PENDING' ? 0 : phase === 'PARTIAL' ? 2 : 5;
      for (let index = 0; index < count; index++)
        checkpoint = commitFiveStartingPositions(
          setup.database,
          fiveStartingPositionRollRequest(checkpoint, `reopen-roll-${String(index)}`, index),
          `reopen-receipt-${String(index)}`,
          dependencies,
        );
      if (phase === 'CHECKPOINTED')
        checkpoint = commitFiveStartingPositions(
          setup.database,
          fiveStartingPositionsCheckpointRequest(checkpoint, 'reopen-checkpoint'),
          'reopen-checkpoint-receipt',
          dependencies,
        );
      else checkpoint = navigate(setup, 'CHR-038');
      setup.database.close();
      const database = openPersistenceDatabase(databasePath);
      try {
        const restored = loadCreationWizardCheckpoint(
          database,
          setup.characterDraftId,
          setup.catalog.skillStage,
          setup.catalog,
        );
        expect(restored.localCharacter).toEqual(checkpoint.localCharacter);
        expect(restored.fiveStartingPositionsStage).toEqual(checkpoint.fiveStartingPositionsStage);
        expect(fiveStartingPositionsPresentationForm(restored)).toBe(
          phase === 'CHECKPOINTED' ? 'CHR-037' : 'CHR-038',
        );
        if (phase !== 'CHECKPOINTED') {
          const resumed = advanceFiveStartingPositionsPresentation(
            database,
            {
              characterDraftId: setup.characterDraftId,
              wizardCheckpointId: setup.wizardCheckpointId,
              formId: 'CHR-037',
            },
            setup.catalog,
          );
          expect(resumed.localCharacter.payloadJson).toBe(checkpoint.localCharacter.payloadJson);
          expect(resumed.localCharacter.stateRevision).toBe(
            checkpoint.localCharacter.stateRevision,
          );
        }
        expect(dependencies.sampleD20).toHaveBeenCalledTimes(count);
      } finally {
        database.close();
      }
    },
  );

  it('derives legacy pending addresses without writes and materializes them with only the first stack result', async () => {
    const { setup, current, dependencies } = await pending({
      prefix: 'five-legacy',
      legacy: true,
      diceInputMode: 'AUTO',
    });
    expect(current.fiveStartingPositionsStage ?? null).toBeNull();
    const derived = fiveStartingPositionsStageForCheckpoint(current)!;
    expect(fiveStartingPositionsPresentationForm(current)).toBe('CHR-037');
    const durableIds = creationWizardDurableIds(current);
    for (const id of fiveStartingPositionsStageIds(derived)) expect(durableIds.has(id)).toBe(false);
    expect(fiveStartingPositionsStageForCheckpoint(reload(setup))).toEqual(derived);
    expect(reload(setup).localCharacter).toEqual(current.localCharacter);
    expect(dependencies.sampleD20).not.toHaveBeenCalled();
    const rolled = commitFiveStartingPositions(
      setup.database,
      fiveStartingPositionRollRequest(current, 'legacy-position-roll', 4),
      'legacy-position-receipt',
      dependencies,
    );
    expect(rolled.fiveStartingPositionsStage!.slots).toEqual(derived.slots);
    expect(rolled.fiveStartingPositionsStage!.rollRecords).toHaveLength(1);
    expect(rolled.startingMoneyStage).toEqual(current.startingMoneyStage);
    expect(rolled.checkpoint.checkpointRevision).toBe(current.checkpoint.checkpointRevision + 1);
    expect(dependencies.sampleD20).toHaveBeenCalledTimes(1);
  });

  it('rejects a legacy derived address collision with an otherwise valid manufacturing witness', async () => {
    const { setup, current } = await pending({ prefix: 'five-legacy-collision', legacy: true });
    const derivedId = fiveStartingPositionsStageForCheckpoint(current)!.slots[0]!.positionId;
    type ProfileReceipt = {
      result: { independentManufacturingDiceReceipts: { receiptId: string }[] };
    };
    const payload = JSON.parse(current.localCharacter.payloadJson) as {
      weaponProfileStage: { records: { receipt: ProfileReceipt }[] };
      startingMoneyStage: { entryReceipt: ProfileReceipt };
    };
    payload.weaponProfileStage.records.at(
      -1,
    )!.receipt.result.independentManufacturingDiceReceipts[0]!.receiptId = derivedId;
    payload.startingMoneyStage.entryReceipt.result.independentManufacturingDiceReceipts[0]!.receiptId =
      derivedId;
    replacePayload(setup, current, payload);
    expect(() => reload(setup)).toThrow(/derived five starting positions identity/);
  });

  it.each([
    'moneyCheckpointReceiptId',
    'slots',
    'mode',
    'draft',
    'position',
    'face',
    'quality',
    'duplicateReceipt',
  ] as const)('rejects checksum-valid %s corruption after a position roll', async (field) => {
    const { setup, current, dependencies } = await pending({ prefix: `five-corrupt-${field}` });
    const rolled = commitFiveStartingPositions(
      setup.database,
      fiveStartingPositionRollRequest(current, 'corruption-roll', 0),
      'corruption-receipt',
      dependencies,
    );
    const payload = JSON.parse(rolled.localCharacter.payloadJson) as {
      receipt: Record<string, unknown>;
      fiveStartingPositionsStage: {
        moneyCheckpointReceiptId: string;
        diceInputModeSnapshot: string;
        slots: { positionId: string; qualityRollRequestId: string }[];
        draftSelections: { quantity: number }[];
        rollRecords: {
          position: {
            quantity: number;
            qualityRollReceiptId: string;
            qualityRecommendation: Record<string, unknown>;
          };
          physicalRoll: { rollReceiptId: string; mechanical: { rawFace: number } };
          receipt: { receiptId: string; result: Record<string, unknown> };
        }[];
      };
    };
    const stage = payload.fiveStartingPositionsStage;
    const record = stage.rollRecords[0]!;
    if (field === 'moneyCheckpointReceiptId') stage.moneyCheckpointReceiptId = 'foreign-money';
    else if (field === 'slots')
      stage.slots[4]!.qualityRollRequestId = stage.slots[0]!.qualityRollRequestId;
    else if (field === 'mode') stage.diceInputModeSnapshot = 'AUTO';
    else if (field === 'draft') stage.draftSelections[4]!.quantity = 99;
    else if (field === 'position') record.position.quantity = 99;
    else if (field === 'face') {
      record.physicalRoll.mechanical.rawFace = 19;
      record.receipt.result['physicalRoll'] = record.physicalRoll;
    } else if (field === 'quality') record.position.qualityRecommendation['kind'] = 'RARE';
    else {
      const prior = rolled.startingMoneyStage!.rollRecordOrNull!.receipt.receiptId;
      record.receipt.receiptId = prior;
      record.physicalRoll.rollReceiptId = prior;
      record.position.qualityRollReceiptId = prior;
      record.receipt.result['physicalRoll'] = record.physicalRoll;
    }
    payload.receipt = record.receipt;
    replacePayload(setup, rolled, payload);
    expect(() => reload(setup)).toThrow();
  });
});
