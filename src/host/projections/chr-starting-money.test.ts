import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { recommendStartingWealth } from '../../domain/rules/item-stage/starting-money.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';
import { assertScreenContract } from './app.js';
import { assertStartingMoneyScreenContracts, projectChr038 } from './chr-starting-money.js';

function fixture(
  face: number | null = null,
  done = false,
  pure = false,
): DurableCreationWizardCheckpoint {
  const roll =
    face === null
      ? null
      : {
          physicalRoll: { mechanical: { rawFace: face } },
          wealthRecommendation: recommendStartingWealth(face),
          request: { commandId: 'roll-command' },
          receipt: { receiptId: 'roll-receipt' },
        };
  return {
    localCharacter: { localCharacterId: 'character' },
    checkpoint: { checkpointId: 'wizard' },
    receipt: { result: { draftRevision: 12 } },
    nextStageEnvelope: {
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: 'character' }],
    },
    startingWeaponStage: {
      checkpointRecordOrNull: { receipt: { receiptId: 'weapon-checkpoint' } },
    },
    weaponProfileStage: { kind: pure ? 'FIXED' : 'FORMULA' },
    startingMoneyStage: {
      moneyRollRequestId: 'money-request',
      profileReceiptId: 'profile-receipt',
      diceInputModeSnapshot: 'MANUAL',
      entryRequest: { commandId: 'entry-command' },
      rollRecordOrNull: roll,
      checkpointRecordOrNull: done
        ? {
            request: { commandId: 'checkpoint-command' },
            receipt: { receiptId: 'money-checkpoint' },
          }
        : null,
    },
  } as unknown as DurableCreationWizardCheckpoint;
}
describe('CHR-038 starting money projection', () => {
  it('verifies exact title, route, required fields and screen type', () => {
    const forms = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../generated/spec/atlas/forms-by-id.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(() => assertStartingMoneyScreenContracts(forms, assertScreenContract)).not.toThrow();
    for (const patch of [
      { title: 'changed' },
      { route: '/wrong' },
      { requiredFields: [] },
      { type: 'dialog' },
    ])
      expect(() =>
        assertStartingMoneyScreenContracts(
          { ...forms, 'CHR-038': { ...(forms['CHR-038'] as Record<string, unknown>), ...patch } },
          assertScreenContract,
        ),
      ).toThrow();
  });
  it('starts with an addressed pending request and a visible mandatory GM finalization flag', () => {
    expect(projectChr038(fixture(), true, true)).toMatchObject({
      formId: 'CHR-038',
      availableActionKeys: ['CHR-038::CTA::003', 'CHR-038::CTA::002'],
      roleFilteredPayload: {
        moneyRollRequestId: 'money-request',
        moneyRollReceiptIdOrNull: null,
        moneyRollFaceOrNull: null,
        wealthRecommendation: null,
        gmFinalizationRequired: true,
        profileReceiptId: 'profile-receipt',
        weaponCheckpointReceiptId: 'weapon-checkpoint',
        weaponProfileFormId: 'CHR-023',
        nextFormId: 'CHR-038',
      },
    });
    expect(projectChr038(fixture(), false, true).availableActionKeys).toEqual([
      'CHR-038::CTA::002',
    ]);
  });
  it('publishes all twenty committed faces with source recommendations and no amounts or GM internals', () => {
    for (let face = 1; face <= 20; face += 1) {
      const view = projectChr038(fixture(face), true, true);
      expect(view.availableActionKeys).toEqual(['CHR-038::CTA::001', 'CHR-038::CTA::002']);
      expect(view.roleFilteredPayload).toMatchObject({
        moneyRollFaceOrNull: face,
        wealthRecommendation: { ...recommendStartingWealth(face) },
        gmFinalizationRequired: true,
        moneyRollReceiptIdOrNull: 'roll-receipt',
      });
      expect(JSON.stringify(view)).not.toMatch(
        /CORE-|QCORE-|AQ2-|Источник|availabilityTrace|finalAmount|approvalStatus|masterPredicate|currency|xp|creationPenalty/,
      );
    }
  });
  it('keeps the same result actionless after checkpoint and signs only the unpublished next stage', () => {
    const view = projectChr038(fixture(20, true, true), true, true);
    expect(view.availableActionKeys).toEqual([]);
    expect(view.roleFilteredPayload).toMatchObject({
      moneyRollFaceOrNull: 20,
      moneyRollReceiptIdOrNull: 'roll-receipt',
      moneyCheckpointReceiptIdOrNull: 'money-checkpoint',
      weaponProfileFormId: 'CHR-024',
      gmFinalizationRequired: true,
      nextFormId: 'CHR-037',
    });
    expect(view.formId).toBe('CHR-038');
    expect(projectChr038(fixture(1), true, false).availableActionKeys).toEqual([
      'CHR-038::CTA::002',
    ]);
  });
});
