import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import {
  createManualWizardSetup,
  manualCompositionRequest,
  type ManualWizardSetup,
} from '../../tests/fixtures/manual-symbiont-stage.js';
import { loadArmorBundleCatalog } from './armor-bundle-catalog.js';
import { loadStartingWeaponCatalog } from './starting-weapon-catalog.js';
import { loadWeaponProfileCatalog } from './weapon-profile-catalog.js';
import { commitCreationWizardCheckpoint } from './creation-wizard-checkpoint.js';
import { projectChr021 } from './projections/chr-armor-bundle.js';
import { advanceStartingWeaponPresentation } from './creation-manual-composition-navigation.js';
import { advancePureCompositionPresentation } from './creation-pure-composition.js';
import {
  commitArmorBundleEntry,
  commitArmorBundleQualityRoll,
  commitArmorBundleCheckpoint,
} from './creation-armor-bundle.js';
import {
  currentCreationWizardRevisions,
  loadCreationWizardCheckpoint,
  loadCreationWizardCommandByCommandId,
  creationWizardDurableIds,
  type DurableCreationWizardCheckpoint,
} from './creation-set-decide.js';
import {
  commitStartingWeaponQualityRoll,
  commitStartingWeaponCheckpoint,
} from './creation-starting-weapon.js';
import type {
  StartingWeaponQualityRollRequest,
  StartingWeaponCheckpointRequest,
} from './creation-starting-weapon-contract.js';
import {
  commitWeaponProfile,
  advanceWeaponProfilePresentation,
} from './creation-weapon-profile.js';
import type {
  WeaponProfileSubmitRequest,
  WeaponProfileAcknowledgeRequest,
} from './creation-weapon-profile-contract.js';
import { openPersistenceDatabase } from '../persistence/index.js';
import { findWeaponProfile } from '../domain/rules/item-stage/weapon-profile.js';

let armorCatalog: Awaited<ReturnType<typeof loadArmorBundleCatalog>>;
let weaponCatalog: Awaited<ReturnType<typeof loadStartingWeaponCatalog>>;
let profileCatalog: Awaited<ReturnType<typeof loadWeaponProfileCatalog>>;
beforeAll(async () => {
  [armorCatalog, weaponCatalog, profileCatalog] = await Promise.all([
    loadArmorBundleCatalog(process.cwd()),
    loadStartingWeaponCatalog(process.cwd()),
    loadWeaponProfileCatalog(process.cwd()),
  ]);
});
const setups: ManualWizardSetup[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const setup of setups.splice(0)) if (setup.database.open) setup.database.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function command(
  checkpoint: DurableCreationWizardCheckpoint,
  id: string,
  payload: JsonObject,
  roll = false,
) {
  return {
    commandId: id,
    commandKind: 'workflow-command' as const,
    expectedRevisions: currentCreationWizardRevisions(checkpoint),
    messageType: 'command.request' as const,
    protocolVersion: 1 as const,
    role: 'player' as const,
    workflowCommandId: roll
      ? ('UI-CMD-CHAR-CREATION-ROLL-COMMIT' as const)
      : ('UI-CMD-CHAR-WIZARD-CHECKPOINT' as const),
    payload: {
      characterDraftId: checkpoint.localCharacter.localCharacterId,
      wizardCheckpointId: checkpoint.checkpoint.checkpointId,
      draftRevision: checkpoint.receipt.result.draftRevision,
      stage: 'SYMBIONTS' as const,
      ...payload,
    },
  };
}
function setupWeapon(
  prefix: string,
  mode: 'AUTO' | 'MANUAL' = 'MANUAL',
  allocate: (() => string) | null = () => `${prefix}-weapon-request`,
  race: 'FREE' | 'PURE' = 'FREE',
  databasePath = ':memory:',
) {
  const setup = createManualWizardSetup(prefix, race, mode, databasePath);
  setups.push(setup);
  let current: DurableCreationWizardCheckpoint;
  if (race === 'PURE') {
    current = advancePureCompositionPresentation(
      setup.database,
      {
        characterDraftId: setup.characterDraftId,
        wizardCheckpointId: setup.wizardCheckpointId,
        formId: 'CHR-015',
      },
      setup.catalog,
    );
    commitCreationWizardCheckpoint(
      setup.database,
      {
        ...setup.selectionRequest,
        commandId: prefix + '-pure-reconfirm',
        expectedRevisions: currentCreationWizardRevisions(current),
        payload: {
          ...setup.selectionRequest.payload,
          draftRevision: current.receipt.result.draftRevision,
        },
      },
      prefix + '-pure-reconfirm-receipt',
      setup.catalog,
      undefined,
      undefined,
      {
        allocateArmorBundleId: () => prefix + '-armor',
        allocateQualityRollRequestId: () => prefix + '-armor-request',
      },
    );
    current = advancePureCompositionPresentation(
      setup.database,
      {
        characterDraftId: setup.characterDraftId,
        wizardCheckpointId: setup.wizardCheckpointId,
        formId: 'CHR-021',
      },
      setup.catalog,
    );
  } else {
    current = commitCreationWizardCheckpoint(
      setup.database,
      manualCompositionRequest(setup, setup.checkpoint, `${prefix}-composition`, ['EEL']),
      `${prefix}-composition-receipt`,
      setup.catalog,
      () => {
        throw new Error('manual composition must not allocate sequence');
      },
      {
        allocateRollRequestId: () => {
          throw new Error('EEL must not allocate Advisor rolls');
        },
        sampleD20: () => {
          throw new Error('EEL must not sample');
        },
      },
    );
    current = commitArmorBundleEntry(
      setup.database,
      command(current, `${prefix}-armor-entry`, {
        sourceFormId: 'CHR-019',
        variant: 'ARMOR_BUNDLE_ENTRY',
      }),
      `${prefix}-armor-entry-receipt`,
      {
        catalog: setup.catalog,
        allocateArmorBundleId: () => `${prefix}-armor`,
        allocateQualityRollRequestId: () => `${prefix}-armor-request`,
      },
    );
  }
  current = commitArmorBundleQualityRoll(
    setup.database,
    command(
      current,
      `${prefix}-armor-roll`,
      {
        sourceFormId: 'CHR-021',
        variant: 'ARMOR_BUNDLE_QUALITY',
        armorBundleId: current.armorBundleStage!.armorBundleId,
        qualityRollRequestId: current.armorBundleStage!.qualityRollRequestId,
        armorPieces: [{ itemId: 'ITM-ARM-005', bodyZoneOrNull: null }],
        manualFaceOrNull: mode === 'MANUAL' ? 19 : null,
      },
      true,
    ),
    `${prefix}-armor-roll-receipt`,
    { catalog: setup.catalog, armorCatalog, sampleD20: () => 19 },
  );
  const before = current;
  const request = command(current, `${prefix}-armor-checkpoint`, {
    sourceFormId: 'CHR-021',
    variant: 'ARMOR_BUNDLE_CHECKPOINT',
    armorBundleId: current.armorBundleStage!.armorBundleId,
    qualityRollReceiptId: current.armorBundleStage!.qualityRollRecordOrNull!.receipt.receiptId,
  });
  current = commitArmorBundleCheckpoint(
    setup.database,
    request,
    `${prefix}-armor-checkpoint-receipt`,
    {
      catalog: setup.catalog,
      ...(allocate === null ? {} : { allocateWeaponQualityRollRequestId: allocate }),
    },
  );
  return { setup, current, before, armorRequest: request };
}
function qualityRequest(
  current: DurableCreationWizardCheckpoint,
  id: string,
  face: number | null,
  weaponTypeId = 'ITM-WPN-001',
  weaponVariant = 'DEFAULT',
): StartingWeaponQualityRollRequest {
  return command(
    current,
    id,
    {
      sourceFormId: 'CHR-022',
      variant: 'STARTING_WEAPON_QUALITY',
      weaponQualityRollRequestId: current.startingWeaponStage!.weaponQualityRollRequestId,
      weaponTypeId,
      weaponVariant,
      manualFaceOrNull: face,
    },
    true,
  ) as StartingWeaponQualityRollRequest;
}
function checkpointRequest(
  current: DurableCreationWizardCheckpoint,
  id: string,
): StartingWeaponCheckpointRequest {
  return command(current, id, {
    sourceFormId: 'CHR-022',
    variant: 'STARTING_WEAPON_CHECKPOINT',
    weaponQualityRollRequestId: current.startingWeaponStage!.weaponQualityRollRequestId,
    weaponQualityRollReceiptId:
      current.startingWeaponStage!.qualityRollRecordOrNull!.receipt.receiptId,
  }) as StartingWeaponCheckpointRequest;
}
function reload(setup: ManualWizardSetup) {
  return loadCreationWizardCheckpoint(
    setup.database,
    setup.characterDraftId,
    setup.catalog.skillStage,
    setup.catalog,
  );
}

const INPUTS: JsonObject = {
  commonWitness: { L: 1, Lw: 10, Ls: 4 },
  independentDice: { R12_DMG: 2, R12_RANGE: 2, R20_RS: 2 },
  formulaOutputs: { Dm: 3, Rn: 6, Rs: 1, Rd: 2 },
};
function setupProfile(
  prefix: string,
  historic = false,
  race: 'FREE' | 'PURE' = 'FREE',
  path = ':memory:',
  allocate?: () => string,
) {
  const { setup, current: armed } = setupWeapon(
    prefix,
    'MANUAL',
    () => prefix + '-weapon-request',
    race,
    path,
  );
  const rolled = commitStartingWeaponQualityRoll(
    setup.database,
    qualityRequest(
      armed,
      prefix + '-weapon-quality',
      1,
      race === 'PURE' ? 'ITM-WPN-003' : 'ITM-WPN-001',
    ),
    prefix + '-weapon-quality-receipt',
    {
      catalog: setup.catalog,
      weaponCatalog,
      sampleD20: () => {
        throw new Error('MANUAL sampled');
      },
    },
  );
  const request = checkpointRequest(rolled, prefix + '-weapon-checkpoint');
  const current = commitStartingWeaponCheckpoint(
    setup.database,
    request,
    prefix + '-weapon-checkpoint-receipt',
    {
      catalog: setup.catalog,
      weaponCatalog,
      ...(historic ? {} : { allocateProfileRequestId: allocate ?? (() => prefix + '-profile') }),
    },
  );
  let witness = 0;
  const allocateWitnessReceiptId = vi.fn(() => prefix + '-witness-' + String(++witness));
  const dependencies = {
    catalog: setup.catalog,
    profileCatalog,
    allocateRequestId: vi.fn(() => prefix + '-profile'),
    allocateWitnessReceiptId,
  };
  return { setup, current, rolled, dependencies };
}
function submit(
  current: DurableCreationWizardCheckpoint,
  id: string,
  inputs: JsonObject = INPUTS,
): WeaponProfileSubmitRequest {
  return {
    ...command(current, id, {
      sourceFormId: 'CHR-023',
      variant: 'WEAPON_PROFILE_SUBMIT',
      requestId: current.weaponProfileStage!.requestId,
      weaponTypeId: 'ITM-WPN-001',
      weaponVariant: 'DEFAULT',
      inputs,
    }),
    workflowCommandId: 'UI-CMD-PLAYER-WEAPON-REQUEST-SUBMIT',
  } as WeaponProfileSubmitRequest;
}
function navigate(setup: ManualWizardSetup, formId: 'CHR-022' | 'CHR-023' | 'CHR-024') {
  return advanceWeaponProfilePresentation(
    setup.database,
    {
      characterDraftId: setup.characterDraftId,
      wizardCheckpointId: setup.wizardCheckpointId,
      formId,
    },
    setup.catalog,
  );
}

function replaceStoredPayload(
  setup: ManualWizardSetup,
  current: DurableCreationWizardCheckpoint,
  payload: unknown,
): void {
  const payloadJson = JSON.stringify(payload);
  const snapshot = JSON.parse(current.checkpoint.snapshotJson) as {
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

describe('weapon profile durable stage', () => {
  it('binds the atomic profile request to its weapon checkpoint and allocates no ID on reads', () => {
    const allocate = vi.fn(() => 'atomic-profile');
    const { setup, current } = setupProfile('atomic-profile', false, 'FREE', ':memory:', allocate);
    expect(allocate).toHaveBeenCalledTimes(1);
    expect(current.weaponProfileStage).toMatchObject({
      requestId: 'atomic-profile',
      kind: 'FORMULA',
      records: [],
    });
    expect(
      current.startingWeaponStage!.checkpointRecordOrNull!.receipt.result.weaponProfileRequestId,
    ).toBe('atomic-profile');
    expect(current.weaponProfileStage!.entryReceipt).toEqual(
      current.startingWeaponStage!.checkpointRecordOrNull!.receipt,
    );
    expect(creationWizardDurableIds(current).has('atomic-profile')).toBe(true);
    expect(reload(setup).weaponProfileStage).toEqual(current.weaponProfileStage);
    expect(allocate).toHaveBeenCalledTimes(1);
  });
  it('upgrades a historical checkpoint explicitly without replacing the weapon receipt', () => {
    const { setup, current: old, dependencies } = setupProfile('historic-profile', true);
    expect(old.weaponProfileStage).toBeNull();
    const weapon = old.startingWeaponStage!;
    const request = command(old, 'historic-profile-entry', {
      sourceFormId: 'CHR-022',
      variant: 'WEAPON_PROFILE_ENTRY',
      weaponQualityRollRequestId: weapon.weaponQualityRollRequestId,
      weaponCheckpointReceiptId: weapon.checkpointRecordOrNull!.receipt.receiptId,
    });
    const committed = commitWeaponProfile(
      setup.database,
      request,
      'historic-profile-entry-receipt',
      dependencies,
    );
    expect(committed.startingWeaponStage).toEqual(weapon);
    expect(dependencies.allocateRequestId).toHaveBeenCalledTimes(1);
    expect(reload(setup).weaponProfileStage).toEqual(committed.weaponProfileStage);
    expect(() =>
      commitWeaponProfile(setup.database, request, 'duplicate-entry-receipt', dependencies),
    ).toThrow();
    expect(dependencies.allocateRequestId).toHaveBeenCalledTimes(1);
  });
  it('keeps invalid inputs in DRAFT, then submits the full reachable profile after returning from CHR-031', () => {
    const { setup, current, dependencies } = setupProfile('invalid-profile');
    const invalid = commitWeaponProfile(
      setup.database,
      submit(current, 'invalid-submit', {
        ...INPUTS,
        formulaOutputs: { Dm: 4, Rn: 6, Rs: 1, Rd: 2 },
      }),
      'invalid-receipt',
      dependencies,
    );
    expect(invalid.symbiontPresentationStage?.formId).toBe('CHR-031');
    expect(invalid.weaponProfileStage!.records[0]!.receipt.result).toMatchObject({
      outcome: 'INVALID',
      requestStatus: 'DRAFT',
      profileOrNull: null,
      proofOrNull: null,
      requestStatusTransitions: ['DRAFT'],
      independentManufacturingDiceReceipts: [],
    });
    expect(dependencies.allocateWitnessReceiptId).not.toHaveBeenCalled();
    const resumed = navigate(setup, 'CHR-023');
    const accepted = commitWeaponProfile(
      setup.database,
      submit(resumed, 'valid-submit'),
      'valid-receipt',
      dependencies,
    );
    const result = accepted.weaponProfileStage!.records[1]!.receipt.result;
    expect(result).toMatchObject({
      outcome: 'SUBMITTED',
      requestStatus: 'SUBMITTED',
      requestStatusTransitions: ['DRAFT', 'VALIDATED', 'SUBMITTED'],
      approvalStatus: 'PENDING_GM',
      ownershipState: 'OWNED_NOT_EQUIPPED',
      nextFormId: 'CHR-038',
    });
    expect(result.independentManufacturingDiceReceipts).toHaveLength(3);
    expect(new Set(result.independentManufacturingDiceReceipts.map((d) => d.receiptId)).size).toBe(
      3,
    );
    expect(
      result.independentManufacturingDiceReceipts.every(
        (d) =>
          d.requestId === accepted.weaponProfileStage!.requestId &&
          d.provenance === 'PLAYER_WITNESS',
      ),
    ).toBe(true);
    expect(accepted.durablePayload.randomReceiptIds).toEqual(
      current.durablePayload.randomReceiptIds,
    );
    expect(reload(setup).weaponProfileStage).toEqual(accepted.weaponProfileStage);
    expect(JSON.stringify(result)).not.toMatch(
      /CORE-|F-WPN-|CVD-|RG-|Источник|availabilityTrace|statRequirements|formulaId/,
    );
  });
  it('rejects stale, foreign and wrong-form writes before allocating witnesses and preserves replay', () => {
    const { setup, current, dependencies } = setupProfile('stale-profile');
    const returned = navigate(setup, 'CHR-022');
    expect(() =>
      commitWeaponProfile(
        setup.database,
        submit(current, 'stale-submit'),
        'stale-receipt',
        dependencies,
      ),
    ).toThrow();
    expect(() =>
      commitWeaponProfile(
        setup.database,
        submit(returned, 'wrong-form'),
        'wrong-form-receipt',
        dependencies,
      ),
    ).toThrow();
    const resumed = navigate(setup, 'CHR-023');
    const request = submit(resumed, 'valid-submit');
    const foreign = { ...request, payload: { ...request.payload, requestId: 'foreign-request' } };
    expect(() =>
      commitWeaponProfile(setup.database, foreign, 'foreign-receipt', dependencies),
    ).toThrow();
    expect(dependencies.allocateWitnessReceiptId).not.toHaveBeenCalled();
    const accepted = commitWeaponProfile(
      setup.database,
      request,
      'valid-submit-receipt',
      dependencies,
    );
    const before = accepted.localCharacter.payloadJson;
    expect(() =>
      commitWeaponProfile(setup.database, request, 'second-receipt', dependencies),
    ).toThrow();
    expect(() =>
      commitWeaponProfile(
        setup.database,
        { ...request, payload: { ...request.payload, inputs: {} } },
        'changed-receipt',
        dependencies,
      ),
    ).toThrow();
    expect(dependencies.allocateWitnessReceiptId).toHaveBeenCalledTimes(3);
    expect(reload(setup).localCharacter.payloadJson).toBe(before);
    expect(
      loadCreationWizardCommandByCommandId(
        setup.database,
        request.commandId,
        setup.catalog.skillStage,
        setup.catalog,
      )?.receipt,
    ).toEqual(accepted.receipt);
  });
  it('keeps fixed PURE profiles canonical and rejects edits before any write', () => {
    const { setup, current, dependencies } = setupProfile('pure-profile', false, 'PURE');
    const entry = findWeaponProfile(profileCatalog, {
      weaponTypeId: 'ITM-WPN-003',
      weaponVariant: 'DEFAULT',
    });
    const request = command(current, 'pure-ack', {
      sourceFormId: 'CHR-024',
      variant: 'WEAPON_PROFILE_ACKNOWLEDGE',
      requestId: current.weaponProfileStage!.requestId,
      canonicalProfileVersion: entry.canonicalProfileVersion,
    }) as WeaponProfileAcknowledgeRequest;
    for (const payload of [
      { ...request.payload, canonicalProfileVersion: 'forged-version' },
      { ...request.payload, fixedProfile: { damage: 999 } },
    ])
      expect(() =>
        commitWeaponProfile(
          setup.database,
          { ...request, payload },
          'bad-fixed-receipt',
          dependencies,
        ),
      ).toThrow();
    expect(reload(setup).localCharacter.payloadJson).toBe(current.localCharacter.payloadJson);
    const accepted = commitWeaponProfile(setup.database, request, 'pure-ack-receipt', dependencies);
    expect(accepted.weaponProfileStage!.records[0]!.receipt.result).toMatchObject({
      outcome: 'ACKNOWLEDGED',
      requestStatus: 'SUBMITTED',
      approvalStatus: 'NOT_APPLICABLE',
      ownershipState: 'OWNED_NOT_EQUIPPED',
      independentManufacturingDiceReceipts: [],
    });
    expect(dependencies.allocateWitnessReceiptId).not.toHaveBeenCalled();
    expect(reload(setup).weaponProfileStage).toEqual(accepted.weaponProfileStage);
  });
  it('recovers safe-return, resume and accepted profiles after closing and reopening SQLite', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weapon-profile-'));
    directories.push(directory);
    const path = join(directory, 'profile.sqlite');
    const { setup, current, dependencies } = setupProfile('restart-profile', false, 'FREE', path);
    const returned = navigate(setup, 'CHR-022');
    expect(returned.localCharacter.payloadJson).toBe(current.localCharacter.payloadJson);
    const resumed = navigate(setup, 'CHR-023');
    const accepted = commitWeaponProfile(
      setup.database,
      submit(resumed, 'restart-submit'),
      'restart-submit-receipt',
      dependencies,
    );
    setup.database.close();
    const reopened = openPersistenceDatabase(path);
    try {
      const restored = loadCreationWizardCheckpoint(
        reopened,
        setup.characterDraftId,
        setup.catalog.skillStage,
        setup.catalog,
      );
      expect(restored.weaponProfileStage).toEqual(accepted.weaponProfileStage);
      expect(restored.startingWeaponStage).toEqual(accepted.startingWeaponStage);
    } finally {
      reopened.close();
    }
  });
  it('rejects a checksum-valid replacement of the pending profile request identity', () => {
    const { setup, current } = setupProfile('corrupt-profile');
    const payload = JSON.parse(current.localCharacter.payloadJson) as {
      weaponProfileStage: { requestId: string };
    };
    payload.weaponProfileStage.requestId = 'replacement-profile';
    const payloadJson = JSON.stringify(payload);
    const snapshot = JSON.parse(current.checkpoint.snapshotJson) as {
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
    expect(() => reload(setup)).toThrow();
  });
  it('rolls back a valid submission when witness identities repeat or reuse an armor receipt', () => {
    for (const id of ['duplicate-witness', 'existing-armor']) {
      const { setup, current, dependencies } = setupProfile(id);
      const before = current.localCharacter.payloadJson;
      const duplicate = () =>
        id === 'existing-armor'
          ? current.armorBundleStage!.qualityRollRecordOrNull!.receipt.receiptId
          : 'duplicate-witness-id';
      expect(() =>
        commitWeaponProfile(setup.database, submit(current, id + '-submit'), id + '-receipt', {
          ...dependencies,
          allocateWitnessReceiptId: duplicate,
        }),
      ).toThrow();
      expect(reload(setup).localCharacter.payloadJson).toBe(before);
    }
  });
  it.each([
    'profile',
    'commonWitness',
    'value',
    'dieSides',
    'variable',
    'provenance',
    'requestId',
    'submitCommandId',
    'duplicateReceipt',
    'priorReceipt',
  ] as const)(
    'rejects checksum-valid %s corruption after a successful profile submission',
    (field) => {
      const { setup, current, dependencies } = setupProfile('history-' + field);
      const accepted = commitWeaponProfile(
        setup.database,
        submit(current, 'history-submit'),
        'history-submit-receipt',
        dependencies,
      );
      const payload = JSON.parse(accepted.localCharacter.payloadJson) as {
        receipt: JsonObject;
        weaponProfileStage: {
          records: {
            profileOrNull: Record<string, unknown>;
            proofOrNull: Record<string, unknown>;
            receipt: {
              result: { independentManufacturingDiceReceipts: Record<string, unknown>[] };
            };
          }[];
        };
      };
      const record = payload.weaponProfileStage.records[0]!;
      const witnesses = record.receipt.result.independentManufacturingDiceReceipts;
      if (field === 'profile') record.profileOrNull['statRequirements'] = { S: 999, D: 999 };
      else if (field === 'commonWitness')
        record.proofOrNull['commonWitness'] = { L: 2, Lw: 10, Ls: 4 };
      else if (field === 'duplicateReceipt')
        witnesses[0]!['receiptId'] = witnesses[1]!['receiptId'];
      else if (field === 'priorReceipt')
        witnesses[0]!['receiptId'] =
          accepted.armorBundleStage!.qualityRollRecordOrNull!.receipt.receiptId;
      else
        witnesses[0]![field] =
          field === 'value' ? 3 : field === 'dieSides' ? 20 : 'forged-' + field;
      // Keep the top receipt consistent so rejection exercises history validation rather than a shallow mismatch.
      payload.receipt = record.receipt as unknown as JsonObject;
      replaceStoredPayload(setup, accepted, payload);
      expect(() => reload(setup)).toThrow();
    },
  );
  it('restores CHR-031 and its exact invalid draft across SQLite reopen before resubmission', () => {
    const directory = mkdtempSync(join(tmpdir(), 'invalid-profile-'));
    directories.push(directory);
    const path = join(directory, 'invalid.sqlite');
    const { setup, current, dependencies } = setupProfile('invalid-restart', false, 'FREE', path);
    const badInputs = { ...INPUTS, formulaOutputs: { Dm: 4, Rn: 6, Rs: 1, Rd: 2 } };
    const request = submit(current, 'invalid-restart-submit', badInputs);
    const invalid = commitWeaponProfile(
      setup.database,
      request,
      'invalid-restart-receipt',
      dependencies,
    );
    setup.database.close();
    const reopened = openPersistenceDatabase(path);
    try {
      const restored = loadCreationWizardCheckpoint(
        reopened,
        setup.characterDraftId,
        setup.catalog.skillStage,
        setup.catalog,
      );
      expect(restored.symbiontPresentationStage?.formId).toBe('CHR-031');
      expect(restored.weaponProfileStage).toEqual(invalid.weaponProfileStage);
      expect(restored.weaponProfileStage!.records[0]!.request.payload).toEqual(request.payload);
      expect(
        restored.weaponProfileStage!.records[0]!.receipt.result.requestStatusTransitions,
      ).toEqual(['DRAFT']);
      const resumed = advanceWeaponProfilePresentation(
        reopened,
        {
          characterDraftId: setup.characterDraftId,
          wizardCheckpointId: setup.wizardCheckpointId,
          formId: 'CHR-023',
        },
        setup.catalog,
      );
      expect(resumed.weaponProfileStage).toEqual(invalid.weaponProfileStage);
      const accepted = commitWeaponProfile(
        reopened,
        submit(resumed, 'resumed-valid-submit'),
        'resumed-valid-receipt',
        dependencies,
      );
      expect(accepted.weaponProfileStage!.requestId).toBe(current.weaponProfileStage!.requestId);
      expect(accepted.weaponProfileStage!.records[1]!.receipt.result.outcome).toBe('SUBMITTED');
    } finally {
      reopened.close();
    }
  });
  it('does not reopen PURE composition after the armor checkpoint closes that navigation boundary', () => {
    const { setup, current } = setupWeapon(
      'closed-pure',
      'MANUAL',
      () => 'closed-pure-weapon',
      'PURE',
    );
    const armorView = advanceStartingWeaponPresentation(
      setup.database,
      {
        characterDraftId: setup.characterDraftId,
        wizardCheckpointId: setup.wizardCheckpointId,
        formId: 'CHR-021',
      },
      setup.catalog,
    );
    expect(projectChr021(armorView, armorCatalog, true, true).availableActionKeys).toEqual([
      'CHR-021::CTA::001',
    ]);
    const before = armorView.localCharacter;
    for (const formId of ['CHR-015', 'CHR-017', 'CHR-019', 'CHR-021'] as const)
      expect(() =>
        advancePureCompositionPresentation(
          setup.database,
          {
            characterDraftId: setup.characterDraftId,
            wizardCheckpointId: setup.wizardCheckpointId,
            formId,
          },
          setup.catalog,
        ),
      ).toThrow();
    expect(reload(setup).localCharacter).toEqual(before);
    expect(reload(setup).armorBundleStage).toEqual(current.armorBundleStage);
  });
});
