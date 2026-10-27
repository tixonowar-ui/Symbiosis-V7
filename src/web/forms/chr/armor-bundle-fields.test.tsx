import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JsonObject } from '@shared/index.js';

import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import type { ArmorBundleDraft } from './armor-bundle.js';
import { CHR_021_ROLL_ACTION_KEY } from './armor-bundle.js';
import { ArmorBundleFields } from './armor-bundle-fields.js';

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
        { itemId: 'ITM-ARM-005', name: 'Нэйт', coverageModel: 'FULL_SUIT' },
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
    const input = manual.querySelector('#armor-quality-face');
    expect(input).not.toBeNull();
    act(() => {
      if (input !== null) input.value = '16';
    });
    const manualRoll = Array.from(manual.querySelectorAll('button')).find(
      (button) => button.textContent === 'Зафиксировать один бросок качества',
    );
    act(() => {
      manualRoll?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRoll).toHaveBeenCalledWith(16);
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
