import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CommandResultMessage, JsonObject } from '@shared/index.js';

import {
  canonicalFixedWeaponProfile,
  validateWeaponProfile,
  weaponProfilePlayerFacts,
  type WeaponProfileCatalog,
} from '../../../domain/rules/item-stage/weapon-profile.js';
import { loadWeaponProfileCatalog } from '../../../host/weapon-profile-catalog.js';
import { projectChr023, projectChr024 } from '../../../host/projections/chr-weapon-profile.js';
import type { DurableCreationWizardCheckpoint } from '../../../host/creation-set-decide.js';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import { WeaponProfileFields } from './weapon-profile-fields.js';
import {
  decodeChr023Projection,
  decodeChr024Projection,
  decodeChr031Projection,
  decodeWeaponProfileTerminal,
  expectedChr023ActionKeys,
  expectedChr024ActionKeys,
  weaponProfileSubmitPayload,
  weaponProfileAcknowledgePayload,
  type Chr023Projection,
  type Chr024Projection,
  type WeaponProfileSubmitRequest,
  type WeaponProfileInputs,
} from './weapon-profile.js';

let catalog: WeaponProfileCatalog;
beforeAll(async () => {
  catalog = await loadWeaponProfileCatalog(resolve(import.meta.dirname, '..', '..', '..', '..'));
});
const inputs: WeaponProfileInputs = {
  commonWitness: { L: 0, Lw: 1, Ls: 0 },
  independentDice: { R12_DMG: 1, R12_RANGE: 1, R20_RS: 1 },
  formulaOutputs: { Dm: 1, Rn: 2, Rs: 1, Rd: 4 },
};
const revisions = { actorVisibilityRevision: 0, projectionRevision: 10, stateRevision: 8 };
function common(typeId: string): JsonObject {
  const entry = catalog.entries.find((entry) => entry.weaponTypeId === typeId)!;
  return {
    characterDraftId: 'character',
    requestId: 'profile-request',
    weaponTypeId: typeId,
    weaponVariantId: entry.weaponVariant,
    weaponName: entry.name,
    variantLabel: entry.variantLabel,
    weaponQualityRollRequestId: 'quality-request',
    weaponQualityRollReceiptId: 'quality-receipt',
    weaponCheckpointReceiptId: 'weapon-checkpoint',
    wizardCheckpointId: 'wizard',
    draftRevision: 10,
    commandId: 'entry-command',
    ownershipState: 'OWNED_NOT_EQUIPPED',
  };
}
function formula(overrides: JsonObject = {}): Chr023Projection {
  const entry = catalog.entries.find((entry) => entry.weaponTypeId === 'ITM-WPN-001')!;
  const definition = entry.formula!;
  const value = {
    ...common(entry.weaponTypeId),
    commonWitness: null,
    allowedFormulaVariables: definition.variables.map((field) => ({ ...field, max: null })),
    independentDiceDefinitions: definition.independentDice.map((field) => ({
      key: field.key,
      label: field.label,
      min: 1,
      max: field.dieSides,
      step: 1,
    })),
    formulaOutputDefinitions: definition.outputs.map((field) => ({ ...field })),
    playerInputs: null,
    independentManufacturingDiceReceipts: [],
    formulaOutputs: null,
    reachabilityProof: null,
    proposedWeaponProfile: null,
    requestStatus: 'DRAFT',
    profileReceiptIdOrNull: null,
    nextFormId: 'CHR-023',
    ...overrides,
  };
  const decoded = decodeChr023Projection(value, '$');
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.refusal));
  return decoded.value;
}
function fixed(): Chr024Projection {
  const entry = catalog.entries.find((entry) => entry.weaponTypeId === 'ITM-WPN-003')!;
  const value = {
    ...common(entry.weaponTypeId),
    raceChoice: 'PURE',
    canonicalProfileVersion: entry.canonicalProfileVersion,
    fixedProfile: weaponProfilePlayerFacts(
      canonicalFixedWeaponProfile(catalog, {
        weaponTypeId: entry.weaponTypeId,
        weaponVariant: entry.weaponVariant,
      }),
    ).map((fact) => ({ ...fact })),
    requirementPenaltyPreview: { ...entry.requirementPreview },
    acknowledgedReceiptIdOrNull: null,
    nextFormId: 'CHR-024',
  };
  const decoded = decodeChr024Projection(value, '$');
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.refusal));
  return decoded.value;
}
function submitted() {
  const pending = formula();
  const valid = validateWeaponProfile(
    catalog,
    { weaponTypeId: pending.weaponTypeId, weaponVariant: pending.weaponVariantId },
    inputs,
  );
  if (valid.status !== 'VALID') throw new Error('source-backed witness fixture is invalid');
  const facts = weaponProfilePlayerFacts(valid.profile).map((fact) => ({ ...fact }));
  const witnesses = pending.independentDiceDefinitions.map((die) => ({
    receiptId: `witness-${die.key}`,
    requestId: pending.requestId,
    submitCommandId: 'submit-command',
    variable: die.key,
    dieSides: die.max,
    value: inputs.independentDice[die.key]!,
    provenance: 'PLAYER_WITNESS',
  }));
  return formula({
    commonWitness: inputs.commonWitness,
    playerInputs: inputs,
    formulaOutputs: inputs.formulaOutputs,
    independentManufacturingDiceReceipts: witnesses,
    proposedWeaponProfile: facts,
    reachabilityProof: { validated: true },
    requestStatus: 'SUBMITTED',
    commandId: 'submit-command',
    profileReceiptIdOrNull: 'submit-receipt',
    nextFormId: 'CHR-038',
  });
}
function terminal() {
  const pending = formula();
  const done = submitted();
  const request: WeaponProfileSubmitRequest = {
    messageType: 'command.request',
    protocolVersion: 1,
    commandKind: 'workflow-command',
    commandId: 'submit-command',
    expectedRevisions: revisions,
    role: 'player',
    workflowCommandId: 'UI-CMD-PLAYER-WEAPON-REQUEST-SUBMIT',
    payload: weaponProfileSubmitPayload(pending, inputs),
  };
  const message: CommandResultMessage = {
    messageType: 'command.result',
    protocolVersion: 1,
    lifecycleState: 'COMMITTED',
    receipt: {
      commandId: request.commandId,
      receiptId: 'submit-receipt',
      revisions: { ...revisions, projectionRevision: 11, stateRevision: 9 },
      result: {
        stage: 'SYMBIONTS',
        sourceFormId: 'CHR-023',
        variant: 'WEAPON_PROFILE_SUBMIT',
        characterDraftId: pending.characterDraftId,
        checkpointOwnerId: pending.characterDraftId,
        checkpointId: pending.wizardCheckpointId,
        checkpointRevision: 10,
        draftRevision: 11,
        branchCacheHash: 'hash',
        branchUuid: 'branch',
        requestId: pending.requestId,
        weaponTypeId: pending.weaponTypeId,
        weaponVariant: pending.weaponVariantId,
        outcome: 'SUBMITTED',
        canonicalProfileVersion: null,
        profileOrNull: { facts: done.proposedWeaponProfile },
        proofOrNull: { validated: true },
        independentManufacturingDiceReceipts: done.independentManufacturingDiceReceipts,
        invalidFieldSet: [],
        humanExplanations: [],
        requestStatus: 'SUBMITTED',
        requestStatusTransitions: ['DRAFT', 'VALIDATED', 'SUBMITTED'],
        approvalStatus: 'PENDING_GM',
        ownershipState: 'OWNED_NOT_EQUIPPED',
        nextFormId: 'CHR-038',
      },
    },
  };
  return { pending, request, message, source: { projection: pending, revisions } };
}

describe('strict weapon profile wire projection and receipts', () => {
  it('round-trips all source catalog variants with their individual variable bounds', () => {
    expect(catalog.entries).toHaveLength(29);
    for (const entry of catalog.entries) {
      const state = {
        localCharacter: { localCharacterId: 'character' },
        checkpoint: { checkpointId: 'wizard' },
        raceAndMethodStage: { race: { value: entry.profileKind === 'FIXED' ? 'PURE' : 'FREE' } },
        receipt: { result: { draftRevision: 10 } },
        nextStageEnvelope: {
          routeBindings: [{ parameterIndex: 0, source: 'inherited', value: 'character' }],
        },
        startingWeaponStage: {
          weaponQualityRollRequestId: 'quality-request',
          qualityRollRecordOrNull: {
            weaponTypeId: entry.weaponTypeId,
            weaponVariant: entry.weaponVariant,
            receipt: { receiptId: 'quality-receipt' },
          },
          checkpointRecordOrNull: { receipt: { receiptId: 'weapon-checkpoint' } },
        },
        weaponProfileStage: {
          requestId: 'profile-request',
          kind: entry.profileKind,
          entryRequest: { commandId: 'entry-command' },
          records: [],
        },
      } as unknown as DurableCreationWizardCheckpoint;
      if (entry.profileKind === 'FORMULA')
        expect(
          decodeChr023Projection(projectChr023(state, catalog, true).roleFilteredPayload, '$').ok,
          `${entry.weaponTypeId}/${entry.weaponVariant}`,
        ).toBe(true);
      else
        expect(
          decodeChr024Projection(projectChr024(state, catalog, true).roleFilteredPayload, '$').ok,
          `${entry.weaponTypeId}/${entry.weaponVariant}`,
        ).toBe(true);
    }
  });
  it('keeps pending fields empty and submits only explicit addressed inputs', () => {
    const pending = formula();
    expect(pending.playerInputs).toBeNull();
    expect(expectedChr023ActionKeys(pending, true)).toEqual([
      'CHR-023::CTA::001',
      'CHR-023::CTA::002',
    ]);
    expect(weaponProfileSubmitPayload(pending, inputs)).toMatchObject({
      requestId: pending.requestId,
      inputs,
      sourceFormId: 'CHR-023',
      weaponTypeId: pending.weaponTypeId,
    });
    const done = submitted();
    expect(expectedChr023ActionKeys(done, true)).toEqual([]);
    expect(() => weaponProfileSubmitPayload(done, inputs)).toThrow();
    expect(JSON.stringify(done)).not.toMatch(
      /CORE-\d|F-WPN-\d|definitionId|formulaId|availabilityTrace/,
    );
  });
  it('rejects undeclared fields, witness substitutions, duplicated receipts and partial success', () => {
    const pending = formula();
    const done = submitted();
    const variants: JsonObject[] = [
      { ...pending, rawSource: 'forbidden' },
      {
        ...pending,
        playerInputs: { ...inputs, commonWitness: { ...inputs.commonWitness, private: 1 } },
      },
      { ...pending, allowedFormulaVariables: pending.allowedFormulaVariables.slice(1) },
      { ...done, reachabilityProof: { validated: true, formulaId: 'hidden' } },
      { ...done, proposedWeaponProfile: [{ label: 'fact', value: 1, ruleId: 'hidden' }] },
      {
        ...done,
        independentManufacturingDiceReceipts: done.independentManufacturingDiceReceipts.map(
          (entry) => ({ ...entry, dieSides: 4 }),
        ),
      },
      {
        ...done,
        independentManufacturingDiceReceipts: done.independentManufacturingDiceReceipts.map(
          (entry) => ({ ...entry, receiptId: 'same' }),
        ),
      },
      { ...done, profileReceiptIdOrNull: null },
    ];
    for (const value of variants) expect(decodeChr023Projection(value, '$').ok).toBe(false);
  });
  it('accepts exact canonical PURE data and emits a read-only acknowledgement payload', () => {
    const pending = fixed();
    expect(expectedChr024ActionKeys(pending, true)).toEqual([
      'CHR-024::CTA::001',
      'CHR-024::CTA::002',
    ]);
    expect(weaponProfileAcknowledgePayload(pending)).toEqual({
      stage: 'SYMBIONTS',
      characterDraftId: pending.characterDraftId,
      wizardCheckpointId: pending.wizardCheckpointId,
      draftRevision: pending.draftRevision,
      requestId: pending.requestId,
      variant: 'WEAPON_PROFILE_ACKNOWLEDGE',
      sourceFormId: 'CHR-024',
      canonicalProfileVersion: pending.canonicalProfileVersion,
    });
    expect(decodeChr024Projection({ ...pending, editableDamage: 10 }, '$').ok).toBe(false);
    expect(decodeChr024Projection({ ...pending, nextFormId: 'CHR-038' }, '$').ok).toBe(false);
  });
  it('requires addressed invalid fields and exact human explanations in the return dialog', () => {
    const dialog = {
      characterDraftId: 'character',
      requestId: 'profile-request',
      weaponTypeId: 'ITM-WPN-001',
      invalidFieldSet: ['formulaOutputs.Rs'],
      humanExplanations: ['Недостижимое требование силы.'],
      formulaReachabilityFailures: [
        { field: 'formulaOutputs.Rs', explanation: 'Недостижимое требование силы.' },
      ],
      returnFormId: 'CHR-023',
      draftRevision: 11,
    };
    expect(decodeChr031Projection(dialog, '$').ok).toBe(true);
    expect(decodeChr031Projection({ ...dialog, returnFormId: 'CHR-038' }, '$').ok).toBe(false);
    expect(
      decodeChr031Projection(
        {
          ...dialog,
          formulaReachabilityFailures: [
            { field: 'formulaOutputs.Dm', explanation: dialog.humanExplanations[0]! },
          ],
        },
        '$',
      ).ok,
    ).toBe(false);
  });
  it('verifies durable receipts and rejects private profiles, altered witnesses and approval bypass', () => {
    const { request, message, source } = terminal();
    expect(decodeWeaponProfileTerminal(message, request, source).ok).toBe(true);
    expect(
      decodeWeaponProfileTerminal(
        { ...message, messageType: 'command.replay', lifecycleState: 'IDEMPOTENT_REPLAY' },
        request,
        source,
      ).ok,
    ).toBe(true);
    const changes: JsonObject[] = [
      { profileOrNull: { definitionId: 'hidden' } },
      { proofOrNull: { validated: true, formulaId: 'hidden' } },
      { approvalStatus: 'NOT_APPLICABLE' },
      { requestId: 'another' },
      { nextFormId: 'CHR-024' },
      { rawRows: [] },
      {
        independentManufacturingDiceReceipts: submitted().independentManufacturingDiceReceipts.map(
          (entry) => ({ ...entry, value: 2 }),
        ),
      },
    ];
    for (const change of changes)
      expect(
        decodeWeaponProfileTerminal(
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
const mounted: { root: Root; container: HTMLDivElement }[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});
function mount(projection: Chr023Projection | Chr024Projection) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const onSubmit = vi.fn();
  const formula = projection['raceChoice'] !== 'PURE';
  const snapshot = {
    formId: formula ? 'CHR-023' : 'CHR-024',
    executableWorkflowCommandIds: [],
    path: '/profile',
    layers: [],
    projection,
    revisions,
    availableActionKeys: formula
      ? expectedChr023ActionKeys(projection as Chr023Projection, true)
      : expectedChr024ActionKeys(projection as Chr024Projection, true),
  } as ConfirmedProjectionSnapshot;
  act(() => root.render(<WeaponProfileFields snapshot={snapshot} onSubmit={onSubmit} />));
  return { container, onSubmit };
}
function enter(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
describe('weapon profile player controls', () => {
  it('starts every witness blank and submits only values actually entered by the player', () => {
    const { container, onSubmit } = mount(formula());
    const fields = [...container.querySelectorAll<HTMLInputElement>('input')];
    const button = container.querySelector<HTMLButtonElement>('button')!;
    expect(fields).toHaveLength(10);
    expect(fields.every((field) => field.value === '')).toBe(true);
    expect(button.disabled).toBe(true);
    for (const field of fields) {
      const [group, key] = field.name.split('.');
      enter(
        field,
        String((inputs[group as keyof WeaponProfileInputs] as Record<string, number>)[key!]),
      );
    }
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(inputs);
    expect(container.textContent).toContain('приложение не бросает');
    expect(container.textContent).not.toMatch(/CORE-\d|F-WPN-\d|definitionId|formulaId/);
  });
  it('restores invalid inputs for correction and renders submitted and PURE profiles without editing controls', () => {
    const invalid = mount(
      formula({
        commonWitness: inputs.commonWitness,
        playerInputs: inputs,
        formulaOutputs: inputs.formulaOutputs,
      }),
    );
    expect(
      invalid.container.querySelector<HTMLInputElement>('[name="commonWitness.Lw"]')!.value,
    ).toBe('1');
    for (const projection of [submitted(), fixed()]) {
      const { container } = mount(projection);
      expect(container.querySelectorAll('input, button')).toHaveLength(0);
      expect(container.querySelector('[aria-label="Полный профиль оружия"]')).not.toBeNull();
      expect(container.textContent).not.toMatch(/CORE-\d|F-WPN-\d|definitionId|formulaId/);
    }
  });
});
