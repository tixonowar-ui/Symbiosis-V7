import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  validateWeaponProfile,
  type WeaponProfileCatalog,
} from '../../domain/rules/item-stage/weapon-profile.js';
import type { DurableCreationWizardCheckpoint } from '../creation-set-decide.js';
import { loadWeaponProfileCatalog } from '../weapon-profile-catalog.js';
import { assertScreenContract } from './app.js';
import {
  assertWeaponProfileScreenContracts,
  projectChr023,
  projectChr024,
  projectChr031,
} from './chr-weapon-profile.js';

const root = resolve(import.meta.dirname, '..', '..', '..');
let catalog: WeaponProfileCatalog;
beforeAll(async () => {
  catalog = await loadWeaponProfileCatalog(root);
});
const inputs = {
  commonWitness: { L: 0, Lw: 1, Ls: 0 },
  independentDice: { R12_DMG: 1, R12_RANGE: 1, R20_RS: 1 },
  formulaOutputs: { Dm: 1, Rn: 2, Rs: 1, Rd: 4 },
};
function fixture(
  kind: 'FORMULA' | 'FIXED',
  outcome: 'DRAFT' | 'INVALID' | 'SUBMITTED' | 'ACKNOWLEDGED' = 'DRAFT',
): DurableCreationWizardCheckpoint {
  const entry = catalog.entries.find(
    (candidate) => candidate.weaponTypeId === (kind === 'FORMULA' ? 'ITM-WPN-001' : 'ITM-WPN-003'),
  )!;
  const valid =
    kind === 'FORMULA'
      ? validateWeaponProfile(
          catalog,
          { weaponTypeId: entry.weaponTypeId, weaponVariant: entry.weaponVariant },
          inputs,
        )
      : null;
  const profile = valid?.status === 'VALID' ? valid.profile : null;
  const record =
    outcome === 'DRAFT'
      ? null
      : {
          nextStageEnvelope: { formId: outcome === 'INVALID' ? 'CHR-023' : 'CHR-038' },
          profileOrNull: profile,
          request: {
            commandId: 'profile-command',
            payload:
              kind === 'FORMULA'
                ? { variant: 'WEAPON_PROFILE_SUBMIT', inputs, characterDraftId: 'character' }
                : { variant: 'WEAPON_PROFILE_ACKNOWLEDGE', characterDraftId: 'character' },
          },
          receipt: {
            receiptId: 'profile-receipt',
            result: {
              outcome,
              weaponTypeId: entry.weaponTypeId,
              invalidFieldSet: outcome === 'INVALID' ? ['formulaOutputs.Rs'] : [],
              humanExplanations:
                outcome === 'INVALID'
                  ? ['Требование силы недостижимо при общем наборе значений.']
                  : [],
              profileOrNull: profile,
              independentManufacturingDiceReceipts:
                outcome === 'SUBMITTED'
                  ? entry.formula!.independentDice.map((die) => ({
                      receiptId: `witness-${die.key}`,
                      requestId: 'profile-request',
                      submitCommandId: 'profile-command',
                      variable: die.key,
                      dieSides: die.dieSides,
                      value: inputs.independentDice[die.key as keyof typeof inputs.independentDice],
                      provenance: 'PLAYER_WITNESS',
                    }))
                  : [],
            },
          },
        };
  return {
    localCharacter: { localCharacterId: 'character' },
    checkpoint: { checkpointId: 'checkpoint' },
    raceAndMethodStage: { race: { value: kind === 'FIXED' ? 'PURE' : 'FREE' } },
    receipt: { result: { draftRevision: 10 } },
    nextStageEnvelope: {
      routeBindings: [{ parameterIndex: 0, source: 'inherited', value: 'character' }],
    },
    startingWeaponStage: {
      diceInputModeSnapshot: 'MANUAL',
      weaponQualityRollRequestId: 'quality-request',
      qualityRollRecordOrNull: {
        weaponTypeId: entry.weaponTypeId,
        weaponVariant: entry.weaponVariant,
        receipt: { receiptId: 'quality-receipt' },
      },
      checkpointRecordOrNull: { receipt: { receiptId: 'weapon-checkpoint' } },
    },
    weaponProfileStage: {
      weaponCheckpointReceiptId: 'weapon-checkpoint',
      requestId: 'profile-request',
      kind,
      entryRequest: { commandId: 'entry-command' },
      records: record === null ? [] : [record],
    },
  } as unknown as DurableCreationWizardCheckpoint;
}

describe('CHR-023/024/031 source-backed profile projections', () => {
  it('verifies every exact title, route, required field and dialog type', () => {
    const forms = JSON.parse(
      readFileSync(resolve(root, 'generated/spec/atlas/forms-by-id.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(() => assertWeaponProfileScreenContracts(forms, assertScreenContract)).not.toThrow();
    for (const id of ['CHR-023', 'CHR-024', 'CHR-031']) {
      for (const patch of [
        { title: 'changed' },
        { route: '/wrong' },
        { requiredFields: [] },
        { type: id === 'CHR-031' ? 'screen' : 'dialog' },
      ])
        expect(() =>
          assertWeaponProfileScreenContracts(
            { ...forms, [id]: { ...(forms[id] as Record<string, unknown>), ...patch } },
            assertScreenContract,
          ),
        ).toThrow();
    }
  });
  it('publishes independent input metadata with no profile generation or internal source identifiers', () => {
    const pending = projectChr023(fixture('FORMULA'), catalog, true);
    expect(pending.availableActionKeys).toEqual(['CHR-023::CTA::001', 'CHR-023::CTA::002']);
    expect(pending.roleFilteredPayload).toMatchObject({
      commonWitness: null,
      playerInputs: null,
      reachabilityProof: null,
      proposedWeaponProfile: null,
      independentManufacturingDiceReceipts: [],
      requestStatus: 'DRAFT',
    });
    expect(pending.roleFilteredPayload['allowedFormulaVariables']).toEqual(
      expect.arrayContaining([
        { key: 'L', label: 'Общий параметр L', min: 0, max: null, step: 1 },
        { key: 'Ls', label: 'Общий параметр Ls', min: 0, max: null, step: 1 },
      ]),
    );
    expect(JSON.stringify(pending)).not.toMatch(
      /CORE-\d|F-WPN-\d|definitionId|Источник|availabilityTrace|expressions|GM override/,
    );
    expect(projectChr023(fixture('FORMULA'), catalog, false).availableActionKeys).toEqual([
      'CHR-023::CTA::002',
    ]);
  });
  it('preserves the complete submitted profile and addressed witness receipts with a receipt-preserving continuation', () => {
    const submitted = projectChr023(fixture('FORMULA', 'SUBMITTED'), catalog, true);
    expect(submitted.availableActionKeys).toEqual(['CHR-023::CTA::001']);
    expect(submitted.roleFilteredPayload).toMatchObject({
      requestStatus: 'SUBMITTED',
      nextFormId: 'CHR-038',
      commonWitness: inputs.commonWitness,
      formulaOutputs: inputs.formulaOutputs,
      reachabilityProof: { validated: true },
    });
    expect(submitted.roleFilteredPayload['proposedWeaponProfile']).toEqual(
      expect.arrayContaining([
        { label: 'Требование S', value: 1 },
        { label: 'Требование D', value: 4 },
      ]),
    );
    expect(JSON.stringify(submitted)).not.toMatch(
      /CORE-\d|F-WPN-\d|definitionId|formulaId|Источник/,
    );
  });
  it('shows invalid fields without exposing or committing a partial proposed profile', () => {
    const state = fixture('FORMULA', 'INVALID');
    const base = projectChr023(state, catalog, true);
    expect(base.roleFilteredPayload).toMatchObject({
      playerInputs: inputs,
      requestStatus: 'DRAFT',
      proposedWeaponProfile: null,
      reachabilityProof: null,
    });
    expect(projectChr031(state)).toMatchObject({
      formId: 'CHR-031',
      formType: 'dialog',
      routeTemplate: '@dialog/chr-031',
      routeBindings: [],
      availableActionKeys: ['CHR-031::CTA::001'],
      roleFilteredPayload: { returnFormId: 'CHR-023', invalidFieldSet: ['formulaOutputs.Rs'] },
    });
    expect(() => projectChr031(fixture('FORMULA'))).toThrow();
  });
  it('publishes a fixed PURE profile read-only and keeps its full source facts after acknowledgement', () => {
    const pending = projectChr024(fixture('FIXED'), catalog, true);
    expect(pending.availableActionKeys).toEqual(['CHR-024::CTA::001', 'CHR-024::CTA::002']);
    const done = projectChr024(fixture('FIXED', 'ACKNOWLEDGED'), catalog, true);
    expect(done.availableActionKeys).toEqual(['CHR-024::CTA::001']);
    expect(done.roleFilteredPayload['fixedProfile']).toEqual(
      pending.roleFilteredPayload['fixedProfile'],
    );
    expect(done.roleFilteredPayload).toMatchObject({
      raceChoice: 'PURE',
      nextFormId: 'CHR-038',
      ownershipState: 'OWNED_NOT_EQUIPPED',
      acknowledgedReceiptIdOrNull: 'profile-receipt',
    });
    expect(JSON.stringify(done)).not.toMatch(
      /CORE-\d|F-WPN-\d|definitionId|Источник|availabilityTrace/,
    );
    expect(() => projectChr023(fixture('FIXED'), catalog, true)).toThrow();
    expect(() => projectChr024(fixture('FORMULA'), catalog, true)).toThrow();
  });
  it('filters malformed durable invalid inputs through a numeric catalog allowlist', () => {
    const state = fixture('FORMULA', 'INVALID');
    for (const malicious of [
      {
        ...inputs,
        commonWitness: { ...inputs.commonWitness, private: 'CORE-185' },
        independentDice: { ...inputs.independentDice, hidden: 'F-WPN-001' },
        formulaOutputs: { ...inputs.formulaOutputs, source: 'CORE-185' },
      },
      { ...inputs, commonWitness: 'CORE-185' },
      { ...inputs, independentDice: { ...inputs.independentDice, R12_DMG: 'F-WPN-001' } },
      { ...inputs, formulaOutputs: null },
    ]) {
      const record = state.weaponProfileStage!.records[0]!;
      const poisoned = {
        ...state,
        weaponProfileStage: {
          ...state.weaponProfileStage!,
          records: [
            {
              ...record,
              request: {
                ...record.request,
                payload: { ...record.request.payload, inputs: malicious },
              },
            },
          ],
        },
      } as unknown as DurableCreationWizardCheckpoint;
      const projected = projectChr023(poisoned, catalog, true);
      expect(JSON.stringify([projected, projectChr031(poisoned)])).not.toMatch(
        /CORE-185|F-WPN-001|"private"|"hidden"/,
      );
      expect(projected.roleFilteredPayload['playerInputs']).toEqual(
        malicious.commonWitness === inputs.commonWitness
          ? null
          : typeof malicious.commonWitness === 'object'
            ? inputs
            : null,
      );
    }
  });
});
