import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandResultMessage, JsonObject } from '@shared/index.js';
import { recommendArmorQuality } from '../../../domain/rules/item-stage/armor-bundle.js';
import { loadFiveStartingPositionsCatalog } from '../../../host/five-starting-positions-catalog.js';
import { projectChr037 } from '../../../host/projections/chr-five-starting-positions.js';
import type { DurableCreationWizardCheckpoint } from '../../../host/creation-set-decide.js';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import { FiveStartingPositionsFields } from './five-starting-positions-fields.js';
import {
  decodeChr037Projection,
  decodeFiveStartingPositionsTerminal,
  expectedChr037ActionKeys,
  fiveStartingPositionsRollPayload,
  fiveStartingPositionsCheckpointPayload,
  type Chr037Projection,
  type FiveStartingPositionSelection,
  type FiveStartingPositionsRequest,
} from './five-starting-positions.js';

function pending(mode: 'AUTO' | 'MANUAL' = 'MANUAL'): Chr037Projection {
  return {
    characterDraftId: 'character',
    moneyCheckpointReceiptId: 'money-checkpoint',
    moneyRollRequestId: 'money-request',
    moneyRollReceiptId: 'money-roll',
    diceInputModeSnapshot: mode,
    eligibleItemTypes: [
      { itemTypeIdOrStoryType: 'RES-AMM-002', kind: 'CATALOGUE', name: 'Стрела' },
      {
        itemTypeIdOrStoryType: 'GEN-010',
        kind: 'STORY',
        name: 'Любой заявленный стартовый предмет',
      },
    ],
    positions: Array.from({ length: 5 }, (_, i) => ({
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
    distinctPositionCount: 5,
    storyItemCountsAsOnePosition: true,
    ownershipState: 'OWNED_NOT_EQUIPPED',
    positionsCheckpointReceiptIdOrNull: null,
    wizardCheckpointId: 'wizard',
    draftRevision: 10,
    commandId: 'entry-command',
    nextFormId: 'CHR-037',
  };
}
function selections(p = pending()): readonly FiveStartingPositionSelection[] {
  return p.positions.map((position, i) => ({
    positionId: position.positionId,
    itemTypeIdOrStoryType: i === 4 ? 'GEN-010' : 'RES-AMM-002',
    quantity: i === 4 ? 3 : 20,
    storyDescriptionOrNull: i === 4 ? 'Памятный браслет' : null,
  }));
}
const revisions = { stateRevision: 20, projectionRevision: 25, actorVisibilityRevision: 1 };
function rolled(p = pending(), index = 0, face = 20): Chr037Projection {
  return {
    ...p,
    positions: p.positions.map((old, i) => {
      const selection = selections(p)[i]!;
      const entry = p.eligibleItemTypes.find(
        (e) => e.itemTypeIdOrStoryType === selection.itemTypeIdOrStoryType,
      )!;
      return old.qualityRollReceiptId !== null
        ? old
        : {
            ...old,
            ...selection,
            name: entry.name,
            kind: entry.kind,
            ...(i === index
              ? {
                  qualityRollReceiptId: `roll-${String(index)}`,
                  qualityRollFaceOrNull: face,
                  qualityRecommendation: { ...recommendArmorQuality(face) },
                }
              : {}),
          };
    }),
  };
}
function request(p: Chr037Projection, checkpoint = false): FiveStartingPositionsRequest {
  const common = {
    commandId: 'command',
    commandKind: 'workflow-command' as const,
    expectedRevisions: revisions,
    messageType: 'command.request' as const,
    protocolVersion: 1 as const,
    role: 'player' as const,
  };
  return checkpoint
    ? {
        ...common,
        workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
        payload: fiveStartingPositionsCheckpointPayload(p),
      }
    : {
        ...common,
        workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
        payload: fiveStartingPositionsRollPayload(
          p,
          selections(p),
          p.positions[0]!.positionId,
          p.diceInputModeSnapshot === 'MANUAL' ? 20 : null,
        ),
      };
}
function terminal(p: Chr037Projection, checkpoint = false): CommandResultMessage {
  const after = checkpoint ? p : rolled(p);
  return {
    messageType: 'command.result',
    protocolVersion: 1,
    lifecycleState: 'COMMITTED',
    receipt: {
      commandId: 'command',
      receiptId: checkpoint ? 'positions-checkpoint' : 'roll-0',
      revisions: { ...revisions, stateRevision: 21, projectionRevision: 26 },
      result: {
        stage: 'SYMBIONTS',
        sourceFormId: 'CHR-037',
        variant: checkpoint ? 'FIVE_STARTING_POSITIONS_CHECKPOINT' : 'FIVE_STARTING_POSITIONS_ROLL',
        characterDraftId: p.characterDraftId,
        checkpointOwnerId: p.characterDraftId,
        checkpointId: p.wizardCheckpointId,
        checkpointRevision: 8,
        draftRevision: 11,
        branchCacheHash: 'hash',
        branchUuid: 'branch',
        moneyCheckpointReceiptId: p.moneyCheckpointReceiptId,
        moneyRollRequestId: p.moneyRollRequestId,
        moneyRollReceiptId: p.moneyRollReceiptId,
        diceInputModeSnapshot: p.diceInputModeSnapshot,
        positions: after.positions,
        distinctPositionCount: 5,
        storyItemCountsAsOnePosition: true,
        ownershipState: 'OWNED_NOT_EQUIPPED',
        nextFormId: checkpoint ? 'CHR-032' : 'CHR-037',
        ...(checkpoint
          ? {}
          : {
              positionId: p.positions[0]!.positionId,
              physicalRoll: {
                kind: 'FIVE_STARTING_POSITION_QUALITY',
                rollRequestId: p.positions[0]!.qualityRollRequestId,
                rollReceiptId: 'roll-0',
                mechanical: { dieSides: 20, rawFace: 20 },
              },
            }),
      },
    },
  };
}
describe('CHR-037 strict projections and commands', () => {
  it('round-trips the complete source-backed host projection for every commit phase', async () => {
    const catalog = await loadFiveStartingPositionsCatalog(process.cwd());
    let p = pending();
    for (let committed = 0; committed <= 5; committed++) {
      if (committed > 0) p = rolled(p, committed - 1);
      for (const done of committed === 5 ? [false, true] : [false]) {
        const checkpoint = {
          localCharacter: { localCharacterId: p.characterDraftId },
          checkpoint: { checkpointId: p.wizardCheckpointId },
          receipt: { result: { draftRevision: p.draftRevision } },
          nextStageEnvelope: {
            routeBindings: [{ parameterIndex: 0, source: 'inherited', value: p.characterDraftId }],
          },
          fiveStartingPositionsStage: {
            moneyCheckpointReceiptId: p.moneyCheckpointReceiptId,
            moneyRollRequestId: p.moneyRollRequestId,
            moneyRollReceiptId: p.moneyRollReceiptId,
            diceInputModeSnapshot: p.diceInputModeSnapshot,
            entryRequest: { commandId: p.commandId },
            slots: p.positions.map((position) => ({
              positionId: position.positionId,
              qualityRollRequestId: position.qualityRollRequestId,
            })),
            draftSelections:
              committed === 0 ? [] : p.positions.map((position) => ({ ...position })),
            rollRecords: p.positions
              .filter((position) => position.qualityRollReceiptId !== null)
              .map((position) => ({
                request: { commandId: `command-${position.positionId}` },
                position,
              })),
            checkpointRecordOrNull: done
              ? { request: { commandId: 'final-command' }, receipt: { receiptId: 'final-receipt' } }
              : null,
          },
        } as unknown as DurableCreationWizardCheckpoint;
        const host = projectChr037(checkpoint, catalog, true, true);
        const decoded = decodeChr037Projection(host.roleFilteredPayload, '$');
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) throw new Error('source host projection did not decode');
        expect(decoded.value.eligibleItemTypes).toHaveLength(63);
        expect(host.availableActionKeys).toEqual(
          expectedChr037ActionKeys(decoded.value, { rollCommit: true, checkpoint: true }),
        );
      }
    }
  });
  it('accepts pending, partial, five committed and actionless checkpoint states', () => {
    let p = pending();
    expect(decodeChr037Projection(p, '$').ok).toBe(true);
    expect(expectedChr037ActionKeys(p, { rollCommit: true, checkpoint: true })).toEqual([
      'CHR-037::CTA::003',
      'CHR-037::CTA::004',
      'CHR-037::CTA::002',
    ]);
    for (let i = 0; i < 5; i++) {
      p = rolled(p, i);
      expect(decodeChr037Projection(p, '$').ok).toBe(true);
    }
    expect(expectedChr037ActionKeys(p, { rollCommit: false, checkpoint: true })).toEqual([
      'CHR-037::CTA::001',
      'CHR-037::CTA::002',
    ]);
    p = { ...p, positionsCheckpointReceiptIdOrNull: 'final-receipt', nextFormId: 'CHR-032' };
    expect(decodeChr037Projection(p, '$').ok).toBe(true);
    expect(expectedChr037ActionKeys(p, { rollCommit: true, checkpoint: true })).toEqual([]);
  });
  it('rejects malformed counts, duplicate addresses, forged source data and hidden fields', () => {
    const p = pending();
    const selected = rolled(p);
    const corruptions: JsonObject[] = [
      { ...p, positions: [] },
      { ...p, positions: p.positions.slice(0, 4) },
      { ...p, positions: [...p.positions, p.positions[0]!] },
      { ...p, positions: p.positions.map((r) => ({ ...r, positionId: 'same' })) },
      {
        ...p,
        positions: p.positions.map((r) => ({ ...r, qualityRollRequestId: 'money-request' })),
      },
      { ...p, distinctPositionCount: 4 },
      { ...p, positions: p.positions.map((row, i) => (i === 0 ? selected.positions[0]! : row)) },
      { ...p, ownershipState: 'EQUIPPED' },
      { ...p, storyItemCountsAsOnePosition: false },
      { ...p, gmFinalization: true },
      { ...p, nextFormId: 'CHR-032' },
      {
        ...p,
        eligibleItemTypes: [
          ...p.eligibleItemTypes,
          { itemTypeIdOrStoryType: 'NAR-001', name: 'Сюжет', kind: 'STORY' },
        ],
      },
      {
        ...selected,
        positions: selected.positions.map((r, i) => (i === 0 ? { ...r, quantity: 0 } : r)),
      },
      {
        ...selected,
        positions: selected.positions.map((r, i) => (i === 0 ? { ...r, name: 'CORE-173' } : r)),
      },
      {
        ...selected,
        positions: selected.positions.map((r, i) =>
          i === 4 ? { ...r, storyDescriptionOrNull: 'Источник: CORE-173' } : r,
        ),
      },
    ];
    for (const value of corruptions) expect(decodeChr037Projection(value, '$').ok).toBe(false);
  });
  it('validates all five selections and preserves each committed position without merging repeated types', () => {
    const p = pending();
    const selection = selections(p);
    expect(fiveStartingPositionsRollPayload(p, selection, 'position-4', 1).positions).toEqual(
      selection,
    );
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        fiveStartingPositionsRollPayload(
          p,
          selection.map((s, i) => (i === 3 ? { ...s, quantity } : s)),
          'position-0',
          1,
        ),
      ).toThrow();
    for (const type of ['unknown', 'NAR-001'])
      expect(() =>
        fiveStartingPositionsRollPayload(
          p,
          selection.map((s, i) => (i === 3 ? { ...s, itemTypeIdOrStoryType: type } : s)),
          'position-0',
          1,
        ),
      ).toThrow();
    expect(() => fiveStartingPositionsRollPayload(p, selection, 'position-0', null)).toThrow();
    expect(() =>
      fiveStartingPositionsRollPayload(pending('AUTO'), selection, 'position-0', 1),
    ).toThrow();
    const partial = rolled(p);
    expect(() =>
      fiveStartingPositionsRollPayload(
        partial,
        selection.map((s, i) => (i === 0 ? { ...s, quantity: 21 } : s)),
        'position-1',
        1,
      ),
    ).toThrow();
    expect(() => fiveStartingPositionsRollPayload(partial, selection, 'position-0', 1)).toThrow();
    expect(() =>
      fiveStartingPositionsRollPayload(
        partial,
        selection.map((s, i) => (i === 1 ? { ...s, quantity: 21 } : s)),
        'position-1',
        1,
      ),
    ).not.toThrow();
    expect(() => fiveStartingPositionsCheckpointPayload(partial)).toThrow();
  });
  it.each(['AUTO', 'MANUAL'] as const)(
    'checks %s terminal provenance, selection and other four positions',
    (mode) => {
      const p = pending(mode),
        req = request(p),
        result = terminal(p);
      expect(
        decodeFiveStartingPositionsTerminal(result, req, { projection: p, revisions }).ok,
      ).toBe(true);
      const mutate = (patch: JsonObject) => ({
        ...result,
        receipt: { ...result.receipt, result: { ...result.receipt.result, ...patch } },
      });
      for (const patch of [
        { moneyCheckpointReceiptId: 'foreign' },
        { positionId: 'position-1' },
        { ownershipState: 'EQUIPPED' },
        { xpDelta: 1 },
        {
          physicalRoll: {
            kind: 'FIVE_STARTING_POSITION_QUALITY',
            rollRequestId: 'quality-1',
            rollReceiptId: 'roll-0',
            mechanical: { dieSides: 20, rawFace: 20 },
          },
        },
      ])
        expect(
          decodeFiveStartingPositionsTerminal(mutate(patch), req, { projection: p, revisions }).ok,
        ).toBe(false);
      const rows = result.receipt.result['positions'] as JsonObject[];
      for (const bad of [
        { ...rows[1], quantity: 99 },
        {
          ...rows[1],
          qualityRollReceiptId: 'another',
          qualityRollFaceOrNull: 1,
          qualityRecommendation: { ...recommendArmorQuality(1) },
        },
        { ...rows[1], itemTypeIdOrStoryType: null, quantity: null, name: null, kind: null },
      ])
        expect(
          decodeFiveStartingPositionsTerminal(
            mutate({ positions: rows.map((r, i) => (i === 1 ? bad : r)) }),
            req,
            { projection: p, revisions },
          ).ok,
        ).toBe(false);
    },
  );
  it('checks five exact receipt refs for checkpoint without changing positions', () => {
    let p = pending();
    for (let i = 0; i < 5; i++) p = rolled(p, i);
    const req = request(p, true),
      result = terminal(p, true);
    expect(decodeFiveStartingPositionsTerminal(result, req, { projection: p, revisions }).ok).toBe(
      true,
    );
    const changed = {
      ...result,
      receipt: {
        ...result.receipt,
        result: {
          ...result.receipt.result,
          positions: p.positions.map((r, i) => (i === 4 ? { ...r, quantity: 99 } : r)),
        },
      },
    };
    expect(decodeFiveStartingPositionsTerminal(changed, req, { projection: p, revisions }).ok).toBe(
      false,
    );
  });
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root !== null) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});
function render(p: Chr037Projection) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const onRoll = vi.fn();
  act(() =>
    root!.render(
      <FiveStartingPositionsFields
        snapshot={
          {
            formId: 'CHR-037',
            projection: p,
            availableActionKeys: expectedChr037ActionKeys(p, {
              rollCommit: true,
              checkpoint: true,
            }),
            layers: [],
          } as unknown as ConfirmedProjectionSnapshot
        }
        onRoll={onRoll}
      />,
    ),
  );
  return { container, onRoll };
}
function change(selector: string, value: string) {
  const element = container!.querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(selector)!;
  const proto =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('CHR-037 five position fields', () => {
  it('starts blank, includes story quantity, and sends one selected stack only after all five are valid', () => {
    const { container, onRoll } = render(pending());
    expect(container.querySelectorAll('select')).toHaveLength(5);
    const button = container.querySelector('button')!;
    expect(button.disabled).toBe(true);
    for (let i = 1; i <= 5; i++) {
      change(`#starting-position-${String(i)}-type`, i === 5 ? 'GEN-010' : 'RES-AMM-002');
      change(`#starting-position-${String(i)}-quantity`, i === 5 ? '3' : '20');
    }
    change('#starting-position-5-description', 'Памятный браслет');
    expect(button.disabled).toBe(true);
    change('#starting-position-face', '1');
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(onRoll).toHaveBeenCalledWith(selections(), 'position-0', 1);
    expect(container.textContent).not.toMatch(/CORE-|AQ2-|GEN-010|gmFinalization|CHR-032/);
  });
  it('keeps committed rows read-only while allowing the remaining draft and gives AUTO no manual face input', () => {
    const { container } = render(rolled(pending('AUTO')));
    expect(container.querySelector('#starting-position-1-type')).toBeNull();
    expect(container.querySelectorAll('select')).toHaveLength(4);
    expect(container.querySelector('#starting-position-face')).toBeNull();
    expect(container.textContent).toContain('Позиция зафиксирована.');
    expect(container.querySelector('button')!.disabled).toBe(false);
  });
});
