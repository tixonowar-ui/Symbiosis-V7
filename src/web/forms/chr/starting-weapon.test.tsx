import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CommandResultMessage, JsonObject } from '@shared/index.js';

import { loadStartingWeaponCatalog } from '../../../host/starting-weapon-catalog.js';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import {
  CHR_022_CONFIRM_ACTION_KEY,
  CHR_022_RETURN_ACTION_KEY,
  CHR_022_ROLL_ACTION_KEY,
  decodeChr022Projection,
  decodeStartingWeaponTerminal,
  expectedChr022ActionKeys,
  selectStartingWeapon,
  startingWeaponCheckpointPayload,
  startingWeaponDraftFromSnapshot,
  startingWeaponQualityPayload,
  type Chr022Projection,
  type StartingWeaponCatalogEntryProjection,
  type StartingWeaponSnapshotSource,
} from './starting-weapon.js';
import { StartingWeaponFields } from './starting-weapon-fields.js';

let entries: readonly StartingWeaponCatalogEntryProjection[];
beforeAll(async () => {
  const catalog = await loadStartingWeaponCatalog(
    resolve(import.meta.dirname, '..', '..', '..', '..'),
  );
  entries = catalog.entries
    .filter((entry) => entry.profileKind === 'FORMULA')
    .map((entry) => ({
      weaponTypeId: entry.weaponTypeId,
      weaponVariant: entry.weaponVariant,
      name: entry.name,
      variantLabel: entry.variantLabel,
      requirementPreview: { ...entry.requirementPreview },
    }));
});
const recommendation = { kind: 'GOOD', label: 'Хорошее', range: '15–18', rawFace: 16 } as const;
const revisions = { actorVisibilityRevision: 0, projectionRevision: 2, stateRevision: 2 } as const;
function payload(overrides: JsonObject = {}): JsonObject {
  return {
    characterDraftId: 'character-1',
    weaponCatalog: { entries },
    weaponTypeId: null,
    weaponVariant: null,
    raceChoice: 'FREE',
    weaponQualityRollRequestId: 'weapon-request',
    weaponQualityRollReceiptIdOrNull: null,
    weaponCheckpointReceiptIdOrNull: null,
    weaponProfileEntryMode: 'NONE',
    weaponProfileRequestIdOrNull: null,
    moneyRollRequestIdOrNull: null,
    moneyRollReceiptIdOrNull: null,
    qualityRecommendation: null,
    requirementPreview: null,
    ownershipState: 'OWNED_NOT_EQUIPPED',
    diceInputModeSnapshot: 'MANUAL',
    wizardCheckpointId: 'wizard-1',
    draftRevision: 4,
    commandId: 'entry-command',
    nextFormId: 'CHR-022',
    ...overrides,
  };
}
function source(value = payload()): StartingWeaponSnapshotSource {
  const decoded = decodeChr022Projection(value, '$.payload');
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.refusal));
  return { formId: 'CHR-022', projection: decoded.value, revisions };
}
function rolled(): JsonObject {
  const entry = entries.find(
    (entry) => entry.weaponTypeId === 'ITM-WPN-012' && entry.weaponVariant === 'TWO_HAND',
  )!;
  return payload({
    weaponTypeId: entry.weaponTypeId,
    weaponVariant: entry.weaponVariant,
    requirementPreview: entry.requirementPreview,
    qualityRecommendation: recommendation,
    weaponQualityRollReceiptIdOrNull: 'weapon-roll-receipt',
  });
}

describe('CHR-022 projection and addressed weapon commands', () => {
  it('accepts source-backed pending, committed and actionless checkpoint states', () => {
    expect(decodeChr022Projection(payload(), '$').ok).toBe(true);
    const pending = source();
    expect(startingWeaponDraftFromSnapshot(pending.projection)).toEqual({
      weaponTypeId: null,
      weaponVariant: null,
    });
    expect(
      expectedChr022ActionKeys(pending.projection, { rollCommit: true, checkpoint: true }),
    ).toEqual([CHR_022_ROLL_ACTION_KEY, CHR_022_RETURN_ACTION_KEY]);
    const committed = source(rolled());
    expect(
      expectedChr022ActionKeys(committed.projection, { rollCommit: true, checkpoint: true }),
    ).toEqual([CHR_022_CONFIRM_ACTION_KEY, CHR_022_RETURN_ACTION_KEY]);
    const checkpoint = source({
      ...rolled(),
      weaponCheckpointReceiptIdOrNull: 'checkpoint-receipt',
      nextFormId: 'CHR-023',
    });
    expect(
      expectedChr022ActionKeys(checkpoint.projection, { rollCommit: true, checkpoint: true }),
    ).toEqual([]);
    expect(JSON.stringify(pending.projection)).not.toMatch(
      /CORE-\d|F-WPN-\d|Источник|availabilityTrace|qualityTier/,
    );
  });

  it('rejects extra fields, forged tuples, inconsistent receipts and premature branch destinations', () => {
    const bad: JsonObject[] = [
      payload({ availabilityTrace: [] }),
      payload({ ownershipState: 'EQUIPPED' }),
      payload({ weaponTypeId: 'ITM-WPN-012', weaponVariant: 'ONE_HAND' }),
      payload({ qualityRecommendation: recommendation }),
      payload({ nextFormId: 'CHR-023' }),
      payload({ weaponQualityRollReceiptIdOrNull: 'receipt' }),
      { ...rolled(), weaponVariant: 'DEFAULT' },
      { ...rolled(), weaponTypeId: ['ITM-WPN-012'] },
      {
        ...rolled(),
        requirementPreview: { ...entries[0]!.requirementPreview, ruleId: 'CORE-033' },
      },
      {
        ...rolled(),
        requirementPreview: { ...entries[0]!.requirementPreview, requirements: 'forged' },
      },
      payload({ weaponCatalog: { entries, rawRows: [] } }),
      payload({ weaponCatalog: { entries: [...entries, entries[0]!] } }),
      payload({ weaponCatalog: { entries: [{ ...entries[0]!, finalQualityTier: 'RARE' }] } }),
      { ...rolled(), weaponCheckpointReceiptIdOrNull: 'checkpoint', nextFormId: 'CHR-024' },
    ];
    for (const value of bad)
      expect(decodeChr022Projection(value, '$').ok, JSON.stringify(value)).toBe(false);
  });

  it('keeps choices local, requires explicit MANUAL face and freezes an accepted tuple', () => {
    const pending = source();
    const draft = selectStartingWeapon(pending.projection, 'ITM-WPN-012', 'TWO_HAND');
    expect(pending.projection.weaponTypeId).toBeNull();
    expect(startingWeaponQualityPayload(pending, draft, 16)).toMatchObject({
      variant: 'STARTING_WEAPON_QUALITY',
      sourceFormId: 'CHR-022',
      weaponTypeId: 'ITM-WPN-012',
      weaponVariant: 'TWO_HAND',
      weaponQualityRollRequestId: 'weapon-request',
      manualFaceOrNull: 16,
    });
    for (const face of [null, 0, 21, 1.5, Number.NaN])
      expect(() => startingWeaponQualityPayload(pending, draft, face)).toThrow();
    expect(() =>
      startingWeaponQualityPayload(
        pending,
        startingWeaponDraftFromSnapshot(pending.projection),
        16,
      ),
    ).toThrow();
    expect(() => selectStartingWeapon(pending.projection, 'ITM-WPN-001', 'ONE_HAND')).toThrow();
    const committed = source(rolled());
    expect(() => selectStartingWeapon(committed.projection, 'ITM-WPN-012', 'ONE_HAND')).toThrow();
    expect(startingWeaponCheckpointPayload(committed)).toMatchObject({
      weaponQualityRollRequestId: 'weapon-request',
      weaponQualityRollReceiptId: 'weapon-roll-receipt',
    });
    const auto = source(payload({ diceInputModeSnapshot: 'AUTO' }));
    expect(startingWeaponQualityPayload(auto, draft, null).manualFaceOrNull).toBeNull();
    expect(() => startingWeaponQualityPayload(auto, draft, 16)).toThrow();
  });

  it('ties a terminal to the selected tuple, exact request/receipt, physical face and revisions', () => {
    const pending = source();
    const draft = selectStartingWeapon(pending.projection, 'ITM-WPN-012', 'TWO_HAND');
    const request = {
      commandId: 'roll-command',
      commandKind: 'workflow-command',
      expectedRevisions: revisions,
      messageType: 'command.request',
      payload: startingWeaponQualityPayload(pending, draft, 16),
      protocolVersion: 1,
      role: 'player',
      workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    } as const;
    const result: JsonObject = {
      stage: 'SYMBIONTS',
      characterDraftId: 'character-1',
      checkpointOwnerId: 'character-1',
      checkpointId: 'wizard-1',
      checkpointRevision: 5,
      draftRevision: 5,
      branchCacheHash: 'hash',
      branchUuid: 'branch',
      sourceFormId: 'CHR-022',
      variant: 'STARTING_WEAPON_QUALITY',
      weaponQualityRollRequestId: 'weapon-request',
      weaponTypeId: 'ITM-WPN-012',
      weaponVariant: 'TWO_HAND',
      qualityRecommendation: recommendation,
      ownershipState: 'OWNED_NOT_EQUIPPED',
      nextFormId: 'CHR-022',
      diceInputModeSnapshot: 'MANUAL',
      physicalRoll: {
        kind: 'STARTING_WEAPON_QUALITY',
        rollRequestId: 'weapon-request',
        rollReceiptId: 'weapon-roll-receipt',
        mechanical: { dieSides: 20, rawFace: 16 },
      },
    };
    const terminal = {
      messageType: 'command.result',
      receipt: {
        commandId: 'roll-command',
        receiptId: 'weapon-roll-receipt',
        revisions: { actorVisibilityRevision: 0, projectionRevision: 3, stateRevision: 3 },
        result,
      },
    } as unknown as CommandResultMessage;
    expect(decodeStartingWeaponTerminal(terminal, request, pending).ok).toBe(true);
    for (const override of [
      { weaponVariant: 'ONE_HAND' },
      { weaponQualityRollRequestId: 'another-request' },
      { ownershipState: 'EQUIPPED' },
      { nextFormId: 'CHR-023' },
      { availabilityTrace: [] },
      {
        physicalRoll: {
          ...(result['physicalRoll'] as JsonObject),
          rollReceiptId: 'another-receipt',
        },
      },
      {
        physicalRoll: {
          ...(result['physicalRoll'] as JsonObject),
          mechanical: { dieSides: 20, rawFace: 17 },
        },
      },
    ])
      expect(
        decodeStartingWeaponTerminal(
          { ...terminal, receipt: { ...terminal.receipt, result: { ...result, ...override } } },
          request,
          pending,
        ).ok,
      ).toBe(false);
  });
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const roots: { root: Root; container: HTMLDivElement }[] = [];
afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});
function mount(
  projection: Chr022Projection,
  actions = expectedChr022ActionKeys(projection, { rollCommit: true, checkpoint: true }),
) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  const onRoll = vi.fn();
  const onSelect = vi.fn();
  const snapshot = {
    ...source(projection),
    availableActionKeys: actions,
  } as unknown as ConfirmedProjectionSnapshot;
  const draft =
    projection.weaponTypeId === null
      ? selectStartingWeapon(projection, 'ITM-WPN-012', 'TWO_HAND')
      : startingWeaponDraftFromSnapshot(projection);
  act(() =>
    root.render(
      <StartingWeaponFields
        snapshot={snapshot}
        draft={draft}
        onRoll={onRoll}
        onSelect={onSelect}
      />,
    ),
  );
  return { container, onRoll, onSelect };
}
function enter(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
  act(() => {
    descriptor.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
describe('CHR-022 accessible weapon selection', () => {
  it('starts MANUAL blank, names both grips, displays requirements and accepts explicit face', () => {
    const { container, onRoll } = mount(source().projection);
    const input = container.querySelector<HTMLInputElement>('#weapon-quality-face')!;
    const button = container.querySelector<HTMLButtonElement>('button')!;
    expect(input.value).toBe('');
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain('фиксированный хват одной рукой');
    expect(container.textContent).toContain('фиксированный хват двумя руками');
    expect(container.textContent).toContain('Штраф без навыка или класса');
    enter(input, '16');
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(onRoll).toHaveBeenCalledExactlyOnceWith(16);
    expect(container.textContent).not.toMatch(/CORE-\d|F-WPN-\d|Источник/);
  });
  it('shows committed selection and recommendation without controls or future form publication', () => {
    const { container } = mount(
      source({ ...rolled(), weaponCheckpointReceiptIdOrNull: 'checkpoint', nextFormId: 'CHR-023' })
        .projection,
    );
    expect(container.textContent).toContain('Полуторный меч');
    expect(container.textContent).toContain('Результат d20: 16');
    expect(container.textContent).toContain('Хорошее');
    expect(container.querySelectorAll('input, button')).toHaveLength(0);
    expect(container.textContent).not.toContain('CHR-023');
  });
});
