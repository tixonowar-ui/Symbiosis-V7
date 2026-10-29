import { resolve } from 'node:path';

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommandResultMessage, JsonObject } from '@shared/index.js';

import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import {
  addArmorPiece,
  armorBundleCheckpointPayload,
  armorBundleDraftFromSnapshot,
  armorBundleQualityPayload,
  CHR_021_CONFIRM_ACTION_KEY,
  CHR_021_RETURN_ACTION_KEY,
  CHR_021_ROLL_ACTION_KEY,
  decodeArmorBundleCheckpointTerminal,
  decodeArmorBundleQualityTerminal,
  decodeChr021Projection,
  expectedChr021ActionKeys,
  removeArmorPiece,
  type ArmorBundleDraft,
  type Chr021Projection,
} from './armor-bundle.js';
import { ArmorBundleFields } from './armor-bundle-fields.js';
import { loadArmorBundleCatalog } from '../../../host/armor-bundle-catalog.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const CATALOG = {
  entries: [
    { itemId: 'ITM-ARM-001', name: 'Кожаный доспех', coverageModel: 'ZONE_ELEMENT' },
    { itemId: 'ITM-ARM-002', name: 'Бригантина', coverageModel: 'ZONE_ELEMENT' },
    { itemId: 'ITM-ARM-005', name: 'Нэйт', coverageModel: 'FULL_SUIT' },
  ],
} as const;

function payload(overrides: JsonObject = {}): JsonObject {
  return {
    characterDraftId: 'character-1',
    anatomyProfile: 'STANDARD_HUMANOID',
    armorCatalog: CATALOG,
    armorBundleId: 'bundle-1',
    qualityRollRequestId: 'quality-request-1',
    qualityRollReceiptIdOrNull: null,
    bundleCheckpointReceiptIdOrNull: null,
    nextFormId: 'CHR-021',
    armorPieces: [],
    distinctBodyZones: [],
    qualityRecommendation: null,
    ownershipState: 'OWNED_NOT_EQUIPPED',
    diceInputModeSnapshot: 'MANUAL',
    wizardCheckpointId: 'wizard-1',
    draftRevision: 3,
    commandId: 'entry-command',
    ...overrides,
  };
}

function snapshotFrom(value: JsonObject): {
  readonly formId: 'CHR-021';
  readonly projection: Chr021Projection;
  readonly revisions: { actorVisibilityRevision: 0; projectionRevision: 1; stateRevision: 1 };
} {
  const decoded = decodeChr021Projection(value, '$.payload');
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.refusal));
  return {
    availableActionKeys: [],
    formId: 'CHR-021',
    projection: decoded.value,
    revisions: { actorVisibilityRevision: 0, projectionRevision: 1, stateRevision: 1 },
  } as unknown as {
    readonly formId: 'CHR-021';
    readonly projection: Chr021Projection;
    readonly revisions: { actorVisibilityRevision: 0; projectionRevision: 1; stateRevision: 1 };
  };
}

describe('CHR-021 web decoder', () => {
  it('accepts the exact pre-roll projection shape and rejects drifted or private fields', () => {
    const decoded = decodeChr021Projection(payload(), '$.payload');
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.armorBundleId).toBe('bundle-1');
    expect(decoded.value.ownershipState).toBe('OWNED_NOT_EQUIPPED');
    expect(decoded.value.qualityRecommendation).toBeNull();

    for (const [label, overrides] of [
      ['unknown top-level field', { availabilityTrace: [] }],
      ['Источник leak', { source: 'Q-CHAR-017' }],
      ['forged ownership', { ownershipState: 'EQUIPPED' }],
      ['forged anatomy', { anatomyProfile: 'QUADRUPED' }],
      [
        'unknown catalog coverage',
        {
          armorCatalog: { entries: [{ itemId: 'ITM-ARM-001', name: 'X', coverageModel: 'CAPE' }] },
        },
      ],
      [
        'unknown zone',
        {
          distinctBodyZones: ['TAIL'],
          armorPieces: [
            {
              itemId: 'ITM-ARM-001',
              name: 'Кожаный доспех',
              coverageModel: 'ZONE_ELEMENT',
              bodyZone: 'TAIL',
            },
          ],
        },
      ],
      [
        'recommendation without receipt',
        { qualityRecommendation: { kind: 'GOOD', label: 'Хорошее', range: '15–18', rawFace: 16 } },
      ],
      [
        'private recommendation field',
        {
          qualityRollReceiptIdOrNull: 'receipt-1',
          qualityRecommendation: {
            kind: 'GOOD',
            label: 'Хорошее',
            range: '15–18',
            rawFace: 16,
            modifier: -1,
          },
        },
      ],
      ['nextFormId CHR-022 before checkpoint', { nextFormId: 'CHR-022' }],
    ] as const) {
      const result = decodeChr021Projection(payload({ ...overrides }), '$.payload');
      expect(result.ok, label).toBe(false);
    }
  });

  it('accepts exact decision previews and rejects unknown or private preview fields', () => {
    const decisionPreview = {
      armorExpression: 'R6',
      strengthRequirement: '2 за элемент',
      movementPenalty: null,
      acrobaticsPenalty: null,
      runningPenalty: null,
      dodgePenalty: null,
      protections: 'Шлем не закрывает лицо.',
      conditionOrLimitation: null,
      hermetic: false,
      layersAllowed: true,
      physicalArmor: true,
    } as const;
    const decoded = decodeChr021Projection(
      payload({
        armorCatalog: {
          entries: [
            {
              itemId: 'ITM-ARM-001',
              name: 'Кожаный доспех',
              coverageModel: 'ZONE_ELEMENT',
              decisionPreview,
            },
          ],
        },
      }),
      '$.payload',
    );
    expect(decoded.ok).toBe(true);
    if (decoded.ok)
      expect(decoded.value.armorCatalog.entries[0]?.decisionPreview).toEqual(decisionPreview);

    for (const overrides of [
      { decisionPreview: { ...decisionPreview, availabilityTrace: [] } },
      { decisionPreview: { ...decisionPreview, 'Rule ID': 'CORE-049' } },
      { decisionPreview: { ...decisionPreview, armorExpression: 6 } },
    ] as const) {
      const result = decodeChr021Projection(
        payload({
          armorCatalog: {
            entries: [
              {
                itemId: 'ITM-ARM-001',
                name: 'Кожаный доспех',
                coverageModel: 'ZONE_ELEMENT',
                ...overrides,
              },
            ],
          },
        }),
        '$.payload',
      );
      expect(result.ok).toBe(false);
    }
  });

  it('accepts the committed post-roll and post-checkpoint shapes', () => {
    const pieces = [
      {
        itemId: 'ITM-ARM-001',
        name: 'Кожаный доспех',
        coverageModel: 'ZONE_ELEMENT',
        bodyZone: 'HEAD',
      },
      {
        itemId: 'ITM-ARM-001',
        name: 'Кожаный доспех',
        coverageModel: 'ZONE_ELEMENT',
        bodyZone: 'TORSO',
      },
    ];
    const rolled = decodeChr021Projection(
      payload({
        qualityRollReceiptIdOrNull: 'receipt-2',
        armorPieces: pieces,
        distinctBodyZones: ['HEAD', 'TORSO'],
        qualityRecommendation: { kind: 'GOOD', label: 'Хорошее', range: '15–18', rawFace: 16 },
      }),
      '$.payload',
    );
    expect(rolled.ok).toBe(true);
    const checkpointed = decodeChr021Projection(
      payload({
        qualityRollReceiptIdOrNull: 'receipt-2',
        bundleCheckpointReceiptIdOrNull: 'receipt-3',
        nextFormId: 'CHR-022',
        armorPieces: pieces,
        distinctBodyZones: ['HEAD', 'TORSO'],
        qualityRecommendation: { kind: 'GOOD', label: 'Хорошее', range: '15–18', rawFace: 16 },
      }),
      '$.payload',
    );
    expect(checkpointed.ok).toBe(true);
  });

  it('derives the exact action subset from the projection and capabilities', () => {
    const preRoll = snapshotFrom(payload());
    expect(
      expectedChr021ActionKeys(preRoll.projection, { rollCommit: true, checkpoint: true }),
    ).toEqual([CHR_021_ROLL_ACTION_KEY]);
    const pieces = [
      {
        itemId: 'ITM-ARM-001',
        name: 'Кожаный доспех',
        coverageModel: 'ZONE_ELEMENT',
        bodyZone: 'HEAD',
      },
    ];
    const rolled = snapshotFrom(
      payload({
        qualityRollReceiptIdOrNull: 'receipt-2',
        armorPieces: pieces,
        distinctBodyZones: ['HEAD'],
        qualityRecommendation: { kind: 'POOR', label: 'Плохое', range: '5–9', rawFace: 7 },
      }),
    );
    expect(
      expectedChr021ActionKeys(rolled.projection, { rollCommit: true, checkpoint: true }),
    ).toEqual([CHR_021_CONFIRM_ACTION_KEY, CHR_021_RETURN_ACTION_KEY]);
    expect(
      expectedChr021ActionKeys(rolled.projection, { rollCommit: false, checkpoint: false }),
    ).toEqual([CHR_021_RETURN_ACTION_KEY]);
    const checkpointed = snapshotFrom(
      payload({
        qualityRollReceiptIdOrNull: 'receipt-2',
        bundleCheckpointReceiptIdOrNull: 'receipt-3',
        nextFormId: 'CHR-022',
        armorPieces: pieces,
        distinctBodyZones: ['HEAD'],
        qualityRecommendation: { kind: 'POOR', label: 'Плохое', range: '5–9', rawFace: 7 },
      }),
    );
    expect(
      expectedChr021ActionKeys(checkpointed.projection, { rollCommit: true, checkpoint: true }),
    ).toEqual([]);
  });

  it('keeps a local selection draft that survives safe-return but resets on committed state', () => {
    const preRoll = snapshotFrom(payload());
    let draft = armorBundleDraftFromSnapshot(preRoll.projection);
    expect(draft.pieces).toEqual([]);
    draft = addArmorPiece(draft, preRoll.projection, 'ITM-ARM-001', 'HEAD');
    draft = addArmorPiece(draft, preRoll.projection, 'ITM-ARM-002', 'TORSO');
    expect(draft.pieces).toEqual([
      { itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' },
      { itemId: 'ITM-ARM-002', bodyZoneOrNull: 'TORSO' },
    ]);
    expect(() => addArmorPiece(draft, preRoll.projection, 'ITM-ARM-001', 'HEAD')).toThrow(
      'duplicate armor body zone',
    );
    expect(() => addArmorPiece(draft, preRoll.projection, 'ITM-ARM-005', null)).toThrow(
      'full suit cannot be combined',
    );
    expect(() => addArmorPiece(draft, preRoll.projection, 'itm-arm-009', 'HEAD')).toThrow(
      'unknown armor item',
    );
    draft = removeArmorPiece(draft, 'TORSO');
    expect(draft.pieces).toEqual([{ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' }]);

    const rolled = snapshotFrom(
      payload({
        qualityRollReceiptIdOrNull: 'receipt-2',
        armorPieces: [
          {
            itemId: 'ITM-ARM-001',
            name: 'Кожаный доспех',
            coverageModel: 'ZONE_ELEMENT',
            bodyZone: 'HEAD',
          },
        ],
        distinctBodyZones: ['HEAD'],
        qualityRecommendation: { kind: 'POOR', label: 'Плохое', range: '5–9', rawFace: 7 },
      }),
    );
    expect(armorBundleDraftFromSnapshot(rolled.projection).pieces).toEqual([
      { itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' },
    ]);
  });

  it('builds exact quality roll and checkpoint payloads and decodes their terminals', () => {
    const preRoll = snapshotFrom(payload());
    const draft = addArmorPiece(
      armorBundleDraftFromSnapshot(preRoll.projection),
      preRoll.projection,
      'ITM-ARM-001',
      'HEAD',
    );
    const quality = armorBundleQualityPayload(preRoll, draft, 16);
    expect(quality).toEqual({
      armorBundleId: 'bundle-1',
      armorPieces: [{ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' }],
      characterDraftId: 'character-1',
      draftRevision: 3,
      manualFaceOrNull: 16,
      qualityRollRequestId: 'quality-request-1',
      sourceFormId: 'CHR-021',
      stage: 'SYMBIONTS',
      variant: 'ARMOR_BUNDLE_QUALITY',
      wizardCheckpointId: 'wizard-1',
    });
    expect(() =>
      armorBundleQualityPayload(preRoll, armorBundleDraftFromSnapshot(preRoll.projection), 16),
    ).toThrow('select at least one armor piece');

    const rolled = snapshotFrom(
      payload({
        qualityRollReceiptIdOrNull: 'receipt-2',
        armorPieces: [
          {
            itemId: 'ITM-ARM-001',
            name: 'Кожаный доспех',
            coverageModel: 'ZONE_ELEMENT',
            bodyZone: 'HEAD',
          },
        ],
        distinctBodyZones: ['HEAD'],
        qualityRecommendation: { kind: 'POOR', label: 'Плохое', range: '5–9', rawFace: 7 },
      }),
    );
    const checkpoint = armorBundleCheckpointPayload(rolled);
    expect(checkpoint).toEqual({
      armorBundleId: 'bundle-1',
      characterDraftId: 'character-1',
      draftRevision: 3,
      qualityRollReceiptId: 'receipt-2',
      sourceFormId: 'CHR-021',
      stage: 'SYMBIONTS',
      variant: 'ARMOR_BUNDLE_CHECKPOINT',
      wizardCheckpointId: 'wizard-1',
    });

    const request = {
      commandId: 'roll-command',
      commandKind: 'workflow-command',
      expectedRevisions: preRoll.revisions,
      messageType: 'command.request',
      payload: quality,
      protocolVersion: 1,
      role: 'player',
      workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT',
    } as const;
    const terminal = {
      messageType: 'command.result',
      receipt: {
        commandId: 'roll-command',
        receiptId: 'receipt-2',
        revisions: { actorVisibilityRevision: 0, projectionRevision: 2, stateRevision: 2 },
        result: {
          stage: 'SYMBIONTS',
          characterDraftId: 'character-1',
          checkpointOwnerId: 'character-1',
          checkpointId: 'wizard-1',
          checkpointRevision: 4,
          draftRevision: 4,
          branchCacheHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
          branchUuid: 'branch-1',
          sourceFormId: 'CHR-021',
          variant: 'ARMOR_BUNDLE_QUALITY',
          armorBundleId: 'bundle-1',
          qualityRollRequestId: 'quality-request-1',
          diceInputModeSnapshot: 'MANUAL',
          physicalRoll: {
            kind: 'ARMOR_BUNDLE_QUALITY',
            rollRequestId: 'quality-request-1',
            rollReceiptId: 'receipt-2',
            mechanical: { dieSides: 20, rawFace: 16 },
          },
          armorPieces: [
            {
              itemId: 'ITM-ARM-001',
              name: 'Кожаный доспех',
              coverageModel: 'ZONE_ELEMENT',
              bodyZone: 'HEAD',
            },
          ],
          distinctBodyZones: ['HEAD'],
          qualityRecommendation: { kind: 'GOOD', label: 'Хорошее', range: '15–18', rawFace: 16 },
          ownershipState: 'OWNED_NOT_EQUIPPED',
          nextFormId: 'CHR-021',
        },
      },
    } as const;
    const decodedTerminal = decodeArmorBundleQualityTerminal(
      terminal as unknown as CommandResultMessage,
      request,
      { ...preRoll, formId: 'CHR-021' },
    );
    expect(decodedTerminal.ok).toBe(true);
    const wrong = decodeArmorBundleQualityTerminal(
      {
        ...terminal,
        receipt: {
          ...terminal.receipt,
          result: { ...terminal.receipt.result, ownershipState: 'EQUIPPED' },
        },
      } as unknown as CommandResultMessage,
      request,
      preRoll,
    );
    expect(wrong.ok).toBe(false);

    const checkpointRequest = {
      commandId: 'checkpoint-command',
      commandKind: 'workflow-command',
      expectedRevisions: rolled.revisions,
      messageType: 'command.request',
      payload: checkpoint,
      protocolVersion: 1,
      role: 'player',
      workflowCommandId: 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
    } as const;
    const checkpointTerminal = {
      messageType: 'command.result',
      receipt: {
        commandId: 'checkpoint-command',
        receiptId: 'receipt-3',
        revisions: { actorVisibilityRevision: 0, projectionRevision: 2, stateRevision: 2 },
        result: {
          stage: 'SYMBIONTS',
          characterDraftId: 'character-1',
          checkpointOwnerId: 'character-1',
          checkpointId: 'wizard-1',
          checkpointRevision: 5,
          draftRevision: 4,
          branchCacheHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
          branchUuid: 'branch-1',
          sourceFormId: 'CHR-021',
          variant: 'ARMOR_BUNDLE_CHECKPOINT',
          armorBundleId: 'bundle-1',
          qualityRollReceiptId: 'receipt-2',
          armorPieces: [
            {
              itemId: 'ITM-ARM-001',
              name: 'Кожаный доспех',
              coverageModel: 'ZONE_ELEMENT',
              bodyZone: 'HEAD',
            },
          ],
          distinctBodyZones: ['HEAD'],
          qualityRecommendation: { kind: 'GOOD', label: 'Хорошее', range: '15–18', rawFace: 16 },
          ownershipState: 'OWNED_NOT_EQUIPPED',
          nextFormId: 'CHR-022',
        },
      },
    } as const;
    expect(
      decodeArmorBundleCheckpointTerminal(
        checkpointTerminal as unknown as CommandResultMessage,
        checkpointRequest,
        rolled,
      ).ok,
    ).toBe(true);
    expect(
      decodeArmorBundleCheckpointTerminal(
        {
          ...checkpointTerminal,
          receipt: {
            ...checkpointTerminal.receipt,
            result: { ...checkpointTerminal.receipt.result, nextFormId: 'CHR-021' },
          },
        } as unknown as CommandResultMessage,
        checkpointRequest,
        rolled,
      ).ok,
    ).toBe(false);
  });
});

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const roots: { container: HTMLDivElement; root: Root }[] = [];
afterEach(() => {
  for (const mounted of roots.splice(0)) {
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

function mount(element: Parameters<Root['render']>[0]): HTMLDivElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  roots.push({ container, root });
  return container;
}

function changeInput(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor?.set === undefined) throw new Error('missing native input setter');
  act(() => {
    descriptor.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function snapshot(
  overrides: {
    readonly availableActionKeys?: readonly string[];
    readonly payload?: JsonObject;
  } = {},
): ConfirmedProjectionSnapshot {
  const base: JsonObject = {
    characterDraftId: 'character-1',
    anatomyProfile: 'STANDARD_HUMANOID',
    armorCatalog: {
      entries: [
        { itemId: 'ITM-ARM-001', name: 'Кожаный доспех', coverageModel: 'ZONE_ELEMENT' },
        { itemId: 'ITM-ARM-002', name: 'Бригантина', coverageModel: 'ZONE_ELEMENT' },
        { itemId: 'ITM-ARM-005', name: 'Нэйт', coverageModel: 'FULL_SUIT' },
        { itemId: 'ITM-ARM-008', name: 'Гленхейм', coverageModel: 'FULL_SUIT' },
      ],
    },
    armorBundleId: 'bundle-1',
    qualityRollRequestId: 'quality-request-1',
    qualityRollReceiptIdOrNull: null,
    bundleCheckpointReceiptIdOrNull: null,
    nextFormId: 'CHR-021',
    armorPieces: [],
    distinctBodyZones: [],
    qualityRecommendation: null,
    ownershipState: 'OWNED_NOT_EQUIPPED',
    diceInputModeSnapshot: 'MANUAL',
    wizardCheckpointId: 'wizard-1',
    draftRevision: 3,
    commandId: 'entry-command',
    ...(overrides.payload ?? {}),
  };
  return {
    availableActionKeys: overrides.availableActionKeys ?? [],
    executableWorkflowCommandIds: [],
    formId: 'CHR-021',
    layers: [],
    path: '/player/characters/character-1/create/chr-021',
    projection: base,
    revisions: { actorVisibilityRevision: 0, projectionRevision: 3, stateRevision: 3 },
  } as unknown as ConfirmedProjectionSnapshot;
}

const emptyDraft: ArmorBundleDraft = { pieces: [] };

describe('ArmorBundleFields', () => {
  it('renders labelled controls, the empty state and hides the roll without the action key', () => {
    const onRoll = vi.fn();
    const container = mount(
      <ArmorBundleFields
        draft={emptyDraft}
        snapshot={snapshot()}
        onAddPiece={() => undefined}
        onRemovePiece={() => undefined}
        onRoll={onRoll}
      />,
    );
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Стартовый комплект брони',
    );
    expect(container.textContent).toContain('Комплект пуст');
    expect(container.querySelector('#armor-quality-face')).not.toBeNull();
    expect(container.textContent).toContain('не экипировано');
    const roll = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Зафиксировать один бросок качества',
    );
    expect(roll?.hasAttribute('disabled')).toBe(true);
    expect(container.textContent).not.toContain('CHR-022');
    expect(container.textContent).not.toContain('модификатор');
  });

  it('keeps the face input only in MANUAL mode and rolls with the entered face', () => {
    const onRoll = vi.fn();
    const auto = mount(
      <ArmorBundleFields
        draft={emptyDraft}
        snapshot={snapshot({
          availableActionKeys: [CHR_021_ROLL_ACTION_KEY],
          payload: { diceInputModeSnapshot: 'AUTO' },
        })}
        onAddPiece={() => undefined}
        onRemovePiece={() => undefined}
        onRoll={onRoll}
      />,
    );
    expect(auto.querySelector('#armor-quality-face')).toBeNull();
    expect(auto.textContent).toContain('Качество бросает хост');
    const rollButton = Array.from(auto.querySelectorAll('button')).find(
      (button) => button.textContent === 'Зафиксировать один бросок качества',
    );
    expect(rollButton?.hasAttribute('disabled')).toBe(false);
    act(() => {
      rollButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRoll).toHaveBeenCalledWith(null);

    const manual = mount(
      <ArmorBundleFields
        draft={emptyDraft}
        snapshot={snapshot({ availableActionKeys: [CHR_021_ROLL_ACTION_KEY] })}
        onAddPiece={() => undefined}
        onRemovePiece={() => undefined}
        onRoll={onRoll}
      />,
    );
    const input = manual.querySelector<HTMLInputElement>('#armor-quality-face');
    expect(input).not.toBeNull();
    act(() => {
      if (input !== null) changeInput(input, '16');
    });
    const manualRoll = Array.from(manual.querySelectorAll('button')).find(
      (button) => button.textContent === 'Зафиксировать один бросок качества',
    );
    act(() => {
      manualRoll?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRoll).toHaveBeenCalledWith(16);
  });

  it('requires an explicitly entered valid MANUAL face before enabling the roll', () => {
    const onRoll = vi.fn();
    const container = mount(
      <ArmorBundleFields
        draft={{ pieces: [{ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' }] }}
        snapshot={snapshot({ availableActionKeys: [CHR_021_ROLL_ACTION_KEY] })}
        onAddPiece={() => undefined}
        onRemovePiece={() => undefined}
        onRoll={onRoll}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('#armor-quality-face')!;
    const roll = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Зафиксировать один бросок качества',
    )!;
    expect(input.value).toBe('');
    expect(roll.hasAttribute('disabled')).toBe(true);
    act(() => {
      roll.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRoll).not.toHaveBeenCalled();

    act(() => {
      changeInput(input, '0');
    });
    expect(roll.hasAttribute('disabled')).toBe(true);
    act(() => {
      changeInput(input, '16');
    });
    expect(roll.hasAttribute('disabled')).toBe(false);
    act(() => {
      roll.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRoll).toHaveBeenCalledWith(16);
  });

  it('shows the selected item identity before locking either full suits or zone elements', () => {
    const selected = (
      itemId: string,
      bodyZoneOrNull: ArmorBundleDraft['pieces'][number]['bodyZoneOrNull'],
    ) => {
      const container = mount(
        <ArmorBundleFields
          draft={{ pieces: [{ itemId, bodyZoneOrNull }] }}
          snapshot={snapshot()}
          onAddPiece={() => undefined}
          onRemovePiece={() => undefined}
          onRoll={() => undefined}
        />,
      );
      return container.querySelector('[data-armor-selected]')?.textContent ?? '';
    };
    expect(selected('ITM-ARM-005', null)).toContain('Нэйт');
    expect(selected('ITM-ARM-008', null)).toContain('Гленхейм');
    expect(selected('ITM-ARM-001', 'HEAD')).toContain('Кожаный доспех');
    expect(selected('ITM-ARM-002', 'HEAD')).toContain('Бригантина');
  });

  it('keeps embedded internal rule ids out of the armor preview DOM', async () => {
    const armorCatalog = await loadArmorBundleCatalog(PROJECT_ROOT);
    const container = mount(
      <ArmorBundleFields
        draft={{ pieces: [] }}
        snapshot={snapshot({ payload: { armorCatalog: armorCatalog as unknown as JsonObject } })}
        onAddPiece={() => undefined}
        onRemovePiece={() => undefined}
        onRoll={() => undefined}
      />,
    );
    expect(container.textContent).toContain('Слои разрешены');
    expect(container.textContent).toContain('физическая совместимость подтверждается мастером');
    expect(container.textContent).not.toContain('CORE-151');
  });

  it('disables zone elements while a full suit is selected and edits only via callbacks', () => {
    const onAddPiece = vi.fn();
    const onRemovePiece = vi.fn();
    const draft: ArmorBundleDraft = {
      pieces: [{ itemId: 'ITM-ARM-005', bodyZoneOrNull: null }],
    };
    const container = mount(
      <ArmorBundleFields
        draft={draft}
        snapshot={snapshot()}
        onAddPiece={onAddPiece}
        onRemovePiece={onRemovePiece}
        onRoll={() => undefined}
      />,
    );
    const selects = Array.from(container.querySelectorAll('select'));
    expect(selects.every((select) => select.hasAttribute('disabled'))).toBe(true);
    const remove = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Убрать',
    );
    act(() => {
      remove?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRemovePiece).toHaveBeenCalledWith(null);
    expect(onAddPiece).not.toHaveBeenCalled();
  });

  it('shows the committed bundle and recommendation read-only after the roll', () => {
    const onAddPiece = vi.fn();
    const container = mount(
      <ArmorBundleFields
        draft={{ pieces: [{ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' }] }}
        snapshot={snapshot({
          payload: {
            qualityRollReceiptIdOrNull: 'receipt-2',
            armorPieces: [
              {
                itemId: 'ITM-ARM-001',
                name: 'Кожаный доспех',
                coverageModel: 'ZONE_ELEMENT',
                bodyZone: 'HEAD',
              },
            ],
            distinctBodyZones: ['HEAD'],
            qualityRecommendation: { kind: 'GOOD', label: 'Хорошее', range: '15–18', rawFace: 16 },
          },
        })}
        onAddPiece={onAddPiece}
        onRemovePiece={() => undefined}
        onRoll={() => undefined}
      />,
    );
    expect(container.textContent).toContain('Зафиксированный комплект');
    expect(container.textContent).toContain('Кожаный доспех');
    expect(container.textContent).toContain('Рекомендация качества: Хорошее (15–18)');
    expect(container.querySelector('#armor-quality-face')).toBeNull();
    expect(container.textContent).not.toContain('Выбор комплекта');
    const fullSuitButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Выбрать',
    );
    expect(fullSuitButton).toBeUndefined();
    expect(onAddPiece).not.toHaveBeenCalled();
  });

  it('renders nothing outside CHR-021 and confirms the checkpointed state', () => {
    const outside = mount(
      <ArmorBundleFields
        draft={null}
        snapshot={
          {
            ...snapshot(),
            formId: 'CHR-019',
          } as unknown as ConfirmedProjectionSnapshot
        }
        onAddPiece={() => undefined}
        onRemovePiece={() => undefined}
        onRoll={() => undefined}
      />,
    );
    expect(outside.querySelector('section')).toBeNull();

    const checkpointed = mount(
      <ArmorBundleFields
        draft={{ pieces: [] }}
        snapshot={snapshot({
          payload: {
            qualityRollReceiptIdOrNull: 'receipt-2',
            bundleCheckpointReceiptIdOrNull: 'receipt-3',
            nextFormId: 'CHR-022',
            armorPieces: [
              {
                itemId: 'ITM-ARM-005',
                name: 'Нэйт',
                coverageModel: 'FULL_SUIT',
                bodyZone: null,
              },
            ],
            distinctBodyZones: ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'],
            qualityRecommendation: { kind: 'RARE', label: 'Редкое', range: '20', rawFace: 20 },
          },
        })}
        onAddPiece={() => undefined}
        onRemovePiece={() => undefined}
        onRoll={() => undefined}
      />,
    );
    expect(checkpointed.textContent).toContain('Комплект подтверждён');
    expect(checkpointed.textContent).not.toContain('Выбор комплекта');
    expect(checkpointed.textContent).not.toContain('CHR-022');
  });
});
