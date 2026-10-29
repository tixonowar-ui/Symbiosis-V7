import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandResultMessage, JsonObject } from '@shared/index.js';

import { recommendStartingWealth } from '../../../domain/rules/item-stage/starting-money.js';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import { StartingMoneyFields } from './starting-money-fields.js';
import {
  decodeChr038Projection,
  decodeStartingMoneyTerminal,
  expectedChr038ActionKeys,
  startingMoneyRollPayload,
  startingMoneyCheckpointPayload,
  type Chr038Projection,
  type StartingMoneyRequest,
} from './starting-money.js';

function pending(mode: 'AUTO' | 'MANUAL' = 'MANUAL'): Chr038Projection {
  return {
    characterDraftId: 'character',
    moneyRollRequestId: 'money-request',
    diceInputModeSnapshot: mode,
    moneyRollFaceOrNull: null,
    moneyRollReceiptIdOrNull: null,
    wealthRecommendation: null,
    gmFinalizationRequired: true,
    profileReceiptId: 'profile-receipt',
    weaponCheckpointReceiptId: 'weapon-checkpoint',
    weaponProfileFormId: 'CHR-023',
    moneyCheckpointReceiptIdOrNull: null,
    positionsEntryMode: 'NONE',
    positionsOrNull: null,
    wizardCheckpointId: 'wizard',
    draftRevision: 10,
    commandId: 'entry-command',
    nextFormId: 'CHR-038',
  };
}
function rolled(face: number): Chr038Projection {
  return {
    ...pending(),
    moneyRollFaceOrNull: face,
    moneyRollReceiptIdOrNull: 'roll-receipt',
    wealthRecommendation: { ...recommendStartingWealth(face) },
    commandId: 'roll-command',
    draftRevision: 11,
  };
}
describe('CHR-038 strict projection', () => {
  it('distinguishes pending, committed and resume states', () => {
    const start = pending();
    const roll = rolled(1);
    const done: Chr038Projection = {
      ...roll,
      moneyCheckpointReceiptIdOrNull: 'money-checkpoint',
      positionsEntryMode: 'RESUME',
      positionsOrNull: Array.from({ length: 5 }, (_, i) => ({
        positionId: `position-${String(i)}`,
        qualityRollRequestId: `quality-${String(i)}`,
        itemTypeIdOrStoryType: null,
        quantity: null,
        storyDescriptionOrNull: null,
        name: null,
        kind: null,
        qualityRollReceiptId: null,
        qualityRollFaceOrNull: null,
        qualityRecommendation: null,
      })),
      commandId: 'checkpoint-command',
      nextFormId: 'CHR-037',
    };
    for (const value of [start, roll, done])
      expect(decodeChr038Projection(value, '$').ok).toBe(true);
    expect(expectedChr038ActionKeys(start, { rollCommit: true, checkpoint: true })).toEqual([
      'CHR-038::CTA::003',
      'CHR-038::CTA::002',
    ]);
    expect(expectedChr038ActionKeys(roll, { rollCommit: true, checkpoint: true })).toEqual([
      'CHR-038::CTA::001',
      'CHR-038::CTA::002',
    ]);
    expect(expectedChr038ActionKeys(done, { rollCommit: true, checkpoint: true })).toEqual([
      'CHR-038::CTA::001',
    ]);
    expect(expectedChr038ActionKeys(start, { rollCommit: false, checkpoint: false })).toEqual([
      'CHR-038::CTA::002',
    ]);
  });
  it('accepts the complete source wealth scale for all committed faces', () => {
    for (let face = 1; face <= 20; face += 1) {
      const value = rolled(face);
      expect(decodeChr038Projection(value, '$').ok).toBe(true);
      expect(JSON.stringify(value)).not.toMatch(
        /CORE-|QCORE-|AQ2-|Источник|finalAmount|currency|approvalStatus|masterPredicate/,
      );
    }
  });
  it('rejects hidden GM data, final amounts, premature faces, modified result references and extra nested fields', () => {
    const roll = rolled(20);
    const cases: JsonObject[] = [
      { ...pending(), moneyRollFaceOrNull: 20 },
      { ...pending(), wealthRecommendation: roll.wealthRecommendation },
      { ...pending(), moneyRollReceiptIdOrNull: 'money-request' },
      { ...pending(), nextFormId: 'CHR-037' },
      { ...roll, gmFinalizationRequired: false },
      { ...roll, finalAmount: 1000 },
      { ...roll, masterApproval: true },
      { ...roll, moneyRollFaceOrNull: 19 },
      { ...roll, moneyRollFaceOrNull: 21 },
      { ...roll, moneyRollFaceOrNull: 1.5 },
      { ...roll, moneyRollReceiptIdOrNull: 'profile-receipt' },
      { ...roll, moneyCheckpointReceiptIdOrNull: 'roll-receipt' },
      { ...roll, weaponProfileFormId: 'CHR-037' },
      { ...roll, diceInputModeSnapshot: 'UNKNOWN' },
      { ...roll, wealthRecommendation: { ...roll.wealthRecommendation!, ruleId: 'hidden' } },
      { ...roll, wealthRecommendation: { ...roll.wealthRecommendation!, kind: 'GOOD' } },
    ];
    for (const value of cases) expect(decodeChr038Projection(value, '$').ok).toBe(false);
  });
});

function terminal(checkpoint = false) {
  const projection = checkpoint ? rolled(20) : pending();
  const revisions = { stateRevision: 10, projectionRevision: 12, actorVisibilityRevision: 1 };
  const commandId = checkpoint ? 'checkpoint-command' : 'roll-command';
  const receiptId = checkpoint ? 'money-checkpoint' : 'roll-receipt';
  const common = {
    commandId,
    commandKind: 'workflow-command' as const,
    expectedRevisions: revisions,
    messageType: 'command.request' as const,
    protocolVersion: 1 as const,
    role: 'player' as const,
  };
  const request: StartingMoneyRequest = checkpoint
    ? {
        ...common,
        workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
        payload: startingMoneyCheckpointPayload(projection),
      }
    : {
        ...common,
        workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
        payload: startingMoneyRollPayload(projection, 20),
      };
  const result: JsonObject = {
    stage: 'SYMBIONTS',
    sourceFormId: 'CHR-038',
    variant: request.payload.variant,
    characterDraftId: projection.characterDraftId,
    checkpointOwnerId: projection.characterDraftId,
    checkpointId: projection.wizardCheckpointId,
    checkpointRevision: 10,
    draftRevision: projection.draftRevision + 1,
    branchCacheHash: 'hash',
    branchUuid: 'branch',
    profileReceiptId: projection.profileReceiptId,
    weaponCheckpointReceiptId: projection.weaponCheckpointReceiptId,
    moneyRollRequestId: projection.moneyRollRequestId,
    diceInputModeSnapshot: projection.diceInputModeSnapshot,
    gmFinalizationRequired: true,
    wealthRecommendation: { ...recommendStartingWealth(20) },
    ...(checkpoint
      ? { moneyRollReceiptId: 'roll-receipt', nextFormId: 'CHR-037' }
      : {
          physicalRoll: {
            kind: 'STARTING_MONEY',
            rollRequestId: projection.moneyRollRequestId,
            rollReceiptId: receiptId,
            mechanical: { dieSides: 20, rawFace: 20 },
          },
          nextFormId: 'CHR-038',
        }),
  };
  const message: CommandResultMessage = {
    messageType: 'command.result',
    protocolVersion: 1,
    lifecycleState: 'COMMITTED',
    receipt: {
      commandId,
      receiptId,
      revisions: { ...revisions, stateRevision: 11, projectionRevision: 13 },
      result,
    },
  };
  return { projection, request, message, source: { projection, revisions } };
}
describe('CHR-038 addressed commands and checked terminal delivery', () => {
  it('binds one explicit MANUAL face or an empty AUTO intention to the immutable request', () => {
    expect(startingMoneyRollPayload(pending(), 1)).toMatchObject({
      variant: 'STARTING_MONEY_ROLL',
      moneyRollRequestId: 'money-request',
      manualFaceOrNull: 1,
    });
    expect(startingMoneyRollPayload(pending('AUTO'), null)).toMatchObject({
      manualFaceOrNull: null,
    });
    for (const face of [null, 0, 21, 1.5, NaN])
      expect(() => startingMoneyRollPayload(pending(), face)).toThrow();
    expect(() => startingMoneyRollPayload(pending('AUTO'), 20)).toThrow();
    expect(() => startingMoneyRollPayload(rolled(20), 20)).toThrow();
    expect(() => startingMoneyCheckpointPayload(pending())).toThrow();
  });
  it('accepts exact roll/checkpoint receipts and unchanged replay without amount finalization', () => {
    for (const checkpoint of [false, true]) {
      const { request, message, source } = terminal(checkpoint);
      expect(decodeStartingMoneyTerminal(message, request, source).ok).toBe(true);
      expect(
        decodeStartingMoneyTerminal(
          { ...message, messageType: 'command.replay', lifecycleState: 'IDEMPOTENT_REPLAY' },
          request,
          source,
        ).ok,
      ).toBe(true);
      for (const change of [
        { gmFinalizationRequired: false },
        { profileReceiptId: 'another' },
        { weaponCheckpointReceiptId: 'another' },
        { moneyRollRequestId: 'another' },
        { finalAmount: 1 },
        { masterApproved: true },
        { xp: 1 },
        { creationPenalty: 1 },
        { diceInputModeSnapshot: 'AUTO' },
        { draftRevision: 100 },
      ])
        expect(
          decodeStartingMoneyTerminal(
            {
              ...message,
              receipt: { ...message.receipt, result: { ...message.receipt.result, ...change } },
            },
            request,
            source,
          ).ok,
        ).toBe(false);
    }
  });
  it('rejects a substituted physical die, natural critical chain or foreign receipt', () => {
    const { request, message, source } = terminal();
    const roll = message.receipt.result['physicalRoll'] as JsonObject;
    for (const physicalRoll of [
      { ...roll, kind: 'STARTING_WEAPON_QUALITY' },
      { ...roll, rollRequestId: 'foreign' },
      { ...roll, rollReceiptId: 'foreign' },
      { ...roll, naturalCriticalQueue: [] },
      { ...roll, mechanical: { dieSides: 12, rawFace: 20 } },
      { ...roll, mechanical: { dieSides: 20, rawFace: 19 } },
    ])
      expect(
        decodeStartingMoneyTerminal(
          {
            ...message,
            receipt: { ...message.receipt, result: { ...message.receipt.result, physicalRoll } },
          },
          request,
          source,
        ).ok,
      ).toBe(false);
    expect(
      decodeStartingMoneyTerminal(
        { ...message, receipt: { ...message.receipt, receiptId: 'profile-receipt' } },
        request,
        source,
      ).ok,
    ).toBe(false);
  });
  it('requires the checkpoint to retain its already committed recommendation and roll receipt', () => {
    const { request, message, source } = terminal(true);
    for (const change of [
      { moneyRollReceiptId: 'foreign' },
      { wealthRecommendation: { ...recommendStartingWealth(19) } },
      { nextFormId: 'CHR-038' },
      { physicalRoll: {} },
    ])
      expect(
        decodeStartingMoneyTerminal(
          {
            ...message,
            receipt: { ...message.receipt, result: { ...message.receipt.result, ...change } },
          },
          request,
          source,
        ).ok,
      ).toBe(false);
  });
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const mounts: { root: Root; container: HTMLDivElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounts.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});
function mount(
  projection: Chr038Projection,
  capabilities = { rollCommit: true, checkpoint: true },
) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounts.push({ root, container });
  const onRoll = vi.fn();
  const snapshot: ConfirmedProjectionSnapshot = {
    formId: 'CHR-038',
    projection,
    layers: [],
    revisions: { stateRevision: 1, projectionRevision: 1, actorVisibilityRevision: 0 },
    availableActionKeys: expectedChr038ActionKeys(projection, capabilities),
    executableWorkflowCommandIds: [],
    path: '/player/characters/character/create/chr-038',
  };
  act(() => root.render(<StartingMoneyFields snapshot={snapshot} onRoll={onRoll} />));
  return { container, onRoll };
}
function enter(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
describe('CHR-038 money recommendation controls', () => {
  it('starts MANUAL blank, accepts one integer face and keeps GM finalization visible', () => {
    const { container, onRoll } = mount(pending());
    const input = container.querySelector<HTMLInputElement>('#starting-money-face')!;
    const button = container.querySelector<HTMLButtonElement>('button')!;
    expect(input.value).toBe('');
    expect(button.disabled).toBe(true);
    for (const value of ['0', '21', '1.5', '']) {
      enter(input, value);
      expect(button.disabled).toBe(true);
    }
    enter(input, '20');
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(onRoll).toHaveBeenCalledExactlyOnceWith(20);
    expect(container.textContent).toContain('обязательно определит мастер');
  });
  it('AUTO has no face input and delegates one roll intention to the host', () => {
    const { container, onRoll } = mount(pending('AUTO'));
    expect(container.querySelector('input')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(onRoll).toHaveBeenCalledExactlyOnceWith(null);
  });
  it('shows committed results read-only with no amount or repeated roll control', () => {
    const { container } = mount(rolled(20));
    expect(container.querySelectorAll('input, button')).toHaveLength(0);
    expect(container.textContent).toContain('редкое состояние');
    expect(container.textContent).toContain('обязательно определит мастер');
    expect(container.textContent).not.toMatch(/CORE-|QCORE-|AQ2-|CHR-037|1000/);
    const disabled = mount(pending(), { rollCommit: false, checkpoint: false });
    expect(disabled.container.querySelector('button')).toBeNull();
    expect(disabled.container.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
  });
});
