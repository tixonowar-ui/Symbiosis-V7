import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JsonObject } from '@shared/index.js';

import type { ConfirmedProjectionSnapshot, ManualCompositionDraft } from '../../ws-client.js';
import { ManualAdvisorIwFields, ManualSymbiontFields } from './manual-symbiont-fields.js';

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

function snapshot(formId: string, roleFilteredPayload: JsonObject): ConfirmedProjectionSnapshot {
  return {
    availableActionKeys: [],
    executableWorkflowCommandIds: [],
    formId,
    layers: [],
    path: `/player/characters/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/create/${formId.toLowerCase()}`,
    projection: roleFilteredPayload,
    revisions: { actorVisibilityRevision: 0, projectionRevision: 9, stateRevision: 9 },
  } as unknown as ConfirmedProjectionSnapshot;
}

const draft: ManualCompositionDraft = {
  characterDraftId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  compositionDraftRevision: 9,
  currentSpeciesKeyOrNull: 'EEL',
  draftRevision: 9,
  entries: [],
  raceChoice: 'FREE',
  sideBySpecies: { EEL: 'RIGHT' },
  wizardCheckpointId: 'wizard-manual-ui',
};

function cardProjection(compatibility = 'COMPATIBLE'): JsonObject {
  return {
    artAndTreePreview: {
      artPath: '/generated/media/symbionts/EEL.png',
      developmentTreePath: '/generated/media/development-trees/EEL.png',
    },
    bindingChoiceOrReadOnly: {
      defaultSide: 'RIGHT',
      kind: 'CHOICE',
      options: ['LEFT', 'RIGHT'],
    },
    bindingKind: 'EEL_ARM',
    characterDraftId: draft.characterDraftId,
    compatibility: { kind: compatibility },
    compositionDraftRevision: 9,
    slotCost: 1,
    speciesKey: 'EEL',
  };
}

function catalogProjection(): JsonObject {
  return {
    characterDraftId: draft.characterDraftId,
    draftRevision: 9,
    eligibleSymbiontSpecies: [
      {
        bindingPolicy: 'EEL_ARM',
        kind: 'ORDINARY',
        linkedStatCodes: ['D', 'I'],
        slotCost: 1,
        speciesKey: 'EEL',
        speciesLabel: 'Угорь',
        statModifiers: { kind: 'NO_STAT_MODIFIERS' },
      },
    ],
    manualCompositionDraft: [],
    pureNoSymbiontRoute: false,
    raceChoice: 'FREE',
    selectedSpeciesOrNull: null,
    slotCapacity: 1,
    symbiontAcquisitionModeOrNull: 'MANUAL',
    wizardCheckpointId: draft.wizardCheckpointId,
  };
}

function pendingAdvisorProjection(mode: 'AUTO' | 'MANUAL'): JsonObject {
  return {
    acknowledged: false,
    advisorCard: {
      advisorIPlus8: null,
      advisorWPlus8: null,
      effectsActive: true,
      speciesKey: 'ADVISER',
    },
    advisorIPlus8OrNull: null,
    advisorInstanceDraftId: 'advisor-ui-instance',
    advisorSlotsAndSkills: { kind: 'IW_ROLLS_REQUIRED' },
    advisorWPlus8OrNull: null,
    characterDraftId: draft.characterDraftId,
    commandId: 'advisor-add-command',
    compositionDraftRevision: 10,
    diceInputModeSnapshot: mode,
    draftRevision: 10,
    iwRollReceiptIds: [null, null],
    iwRollRequestIds: ['advisor-i-request', 'advisor-w-request'],
    trogrSuppressionState: { kind: 'NOT_SUPPRESSED' },
    wizardCheckpointId: draft.wizardCheckpointId,
  };
}

function changeInput(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor?.set === undefined) throw new Error('missing native input setter');
  act(() => {
    descriptor.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(element: Element): void {
  act(() => {
    if (element instanceof HTMLElement) element.click();
  });
}

function expectAssociatedControls(container: HTMLElement): void {
  for (const control of container.querySelectorAll('input, select')) {
    const id = control.getAttribute('id');
    expect(id, 'every control has an id').not.toBeNull();
    expect(
      container.querySelector(`label[for="${id}"]`),
      'every control has a label',
    ).not.toBeNull();
  }
}

describe('manual symbiont accessible fields', () => {
  it('publishes art/tree alternatives and a labelled binding choice, not a fake ineligible control', () => {
    const container = mount(
      <ManualSymbiontFields
        draft={draft}
        onBindingSide={() => {}}
        onOpenSpecies={() => {}}
        onToggleSpecies={() => {}}
        snapshot={snapshot('CHR-018', cardProjection())}
      />,
    );
    expect(container.querySelector('[data-manual-art]')?.getAttribute('alt')).toBe(
      'Арт симбионта EEL',
    );
    expect(container.querySelector('[data-manual-tree]')?.getAttribute('alt')).toBe(
      'Дерево развития симбионта EEL',
    );
    expectAssociatedControls(container);
    expect(container.querySelector<HTMLInputElement>('#manual-binding-right')?.checked).toBe(true);
    expect(container.querySelector('[data-manual-binding-readonly]')).toBeNull();

    const ineligible = mount(
      <ManualSymbiontFields
        draft={draft}
        onBindingSide={() => {}}
        onOpenSpecies={() => {}}
        onToggleSpecies={() => {}}
        snapshot={snapshot('CHR-018', {
          ...cardProjection('DUPLICATE'),
          bindingChoiceOrReadOnly: { binding: { kind: 'EEL_ARM' }, kind: 'READ_ONLY' },
        })}
      />,
    );
    expect(ineligible.querySelector('[data-manual-binding-choice]')).toBeNull();
    expect(ineligible.querySelector('[data-manual-binding-readonly]')).not.toBeNull();
    expect(ineligible.querySelector('[data-manual-compatibility]')?.textContent).toBe('DUPLICATE');
  });

  it('opens a species and removes it locally without inventing a remove CTA', () => {
    const onOpenSpecies = vi.fn();
    const onToggleSpecies = vi.fn();
    const local = {
      ...draft,
      entries: [{ sideOrNull: 'RIGHT' as const, speciesKey: 'EEL' as const }],
    };
    const container = mount(
      <ManualSymbiontFields
        draft={local}
        onBindingSide={() => {}}
        onOpenSpecies={onOpenSpecies}
        onToggleSpecies={onToggleSpecies}
        snapshot={snapshot('CHR-017', catalogProjection())}
      />,
    );
    expectAssociatedControls(container);
    click(container.querySelector('[data-manual-remove="EEL"]')!);
    expect(onToggleSpecies).toHaveBeenCalledWith('EEL', false);
    click(container.querySelector('[data-manual-open-species="EEL"]')!);
    expect(onOpenSpecies).toHaveBeenCalledWith('EEL');
    expect(container.querySelector('[data-manual-remove-cta]')).toBeNull();
  });

  it('shows preview before/after, exact slot and OE differences, and no irreversible confirmation', () => {
    const composition = (speciesKey: string, status: string): JsonObject => ({
      bindings: [{ acceptedIndex: 0, binding: { kind: 'NONE' }, speciesKey }],
      slotUsageAndCapacity: { capacity: 4, used: 4 },
      speciesKeys: [speciesKey],
      symbiontInstancesDraft: [
        {
          absorbedSpeciesKeys: [],
          acceptedIndex: 0,
          currentOe: 50,
          slotCost: 1,
          speciesKey,
          speciesLabel: speciesKey,
          status,
        },
      ],
    });
    const container = mount(
      <ManualSymbiontFields
        draft={null}
        onBindingSide={() => {}}
        onOpenSpecies={() => {}}
        onToggleSpecies={() => {}}
        snapshot={snapshot('CHR-042', {
          characterDraftId: draft.characterDraftId,
          commandId: 'preview-command',
          compositionAfter: composition('TEACHER', 'ABSORBED'),
          compositionBefore: composition('ADVISER', 'SUPPRESSED'),
          confirmationStatus: 'PREVIEW',
          draftRevision: 13,
          interactionGraph: { entries: [], kind: 'INTERACTIONS' },
          irreversibleOperationIds: ['ABSORPTION'],
          slotStatOeDiff: {
            entries: [
              {
                after: { currentOe: 50, slotCost: 1, status: 'ABSORBED' },
                before: null,
                speciesKey: 'TEACHER',
              },
            ],
            modifierBreakdownAfter: { kind: 'NO_STAT_MODIFIERS' },
            modifierBreakdownBefore: { kind: 'NO_STAT_MODIFIERS' },
            slotUsageAfter: 4,
            slotUsageBefore: 4,
          },
          suppressionDestructionAbsorption: { entries: [], kind: 'CONSEQUENCES' },
          wizardCheckpointId: draft.wizardCheckpointId,
        })}
      />,
    );
    expect(container.querySelector('[data-preview-status]')?.textContent).toBe('PREVIEW');
    expect(container.querySelector('[data-preview-operation="ABSORPTION"]')).not.toBeNull();
    expect(container.querySelector('[data-preview-diff="TEACHER"]')?.textContent).toContain('50');
    expect(container.querySelector('[data-preview-confirm]')).toBeNull();
  });
});

describe('manual Advisor I/W fields', () => {
  it('keeps capacity and skill options absent before AUTO I/W', () => {
    const onRoll = vi.fn(() => ({ ok: true as const }));
    const container = mount(
      <ManualAdvisorIwFields
        onRoll={onRoll}
        snapshot={snapshot('CHR-041', pendingAdvisorProjection('AUTO'))}
      />,
    );
    expect(container.querySelector('[data-advisor-skill-options]')).toBeNull();
    expect(container.querySelector('[data-advisor-slot-usage]')).toBeNull();
    expect(container.querySelector('[data-advisor-iw-pending]')).not.toBeNull();
    expect(
      container.querySelector('[data-manual-form="CHR-041"][data-advisor-iw-pending]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-manual-iw-face="I"]')).toBeNull();
    click(container.querySelector('[data-manual-iw-submit]')!);
    expect(onRoll).toHaveBeenCalledWith(null);
  });

  it('requires two MANUAL faces and disables only after a valid accepted submission', () => {
    const onRoll = vi.fn(() => ({ ok: true as const }));
    const container = mount(
      <ManualAdvisorIwFields
        onRoll={onRoll}
        snapshot={snapshot('CHR-041', pendingAdvisorProjection('MANUAL'))}
      />,
    );
    expectAssociatedControls(container);
    click(container.querySelector('[data-manual-iw-submit]')!);
    expect(onRoll).not.toHaveBeenCalled();
    changeInput(container.querySelector<HTMLInputElement>('[data-manual-iw-face="I"]')!, '3');
    changeInput(container.querySelector<HTMLInputElement>('[data-manual-iw-face="W"]')!, '5');
    click(container.querySelector('[data-manual-iw-submit]')!);
    expect(onRoll).toHaveBeenCalledWith([3, 5]);
    expect(container.querySelector<HTMLButtonElement>('[data-manual-iw-submit]')?.disabled).toBe(
      true,
    );
  });
});
