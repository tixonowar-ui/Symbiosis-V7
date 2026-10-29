import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import {
  createManualWizardSetup,
  manualCompositionRequest,
  type ManualWizardSetup,
} from '../../tests/fixtures/manual-symbiont-stage.js';
import { loadArmorBundleCatalog } from './armor-bundle-catalog.js';
import { loadStartingWeaponCatalog } from './starting-weapon-catalog.js';
import { commitCreationWizardCheckpoint } from './creation-wizard-checkpoint.js';
import { advanceStartingWeaponPresentation } from './creation-manual-composition-navigation.js';
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
  commitStartingWeaponEntry,
  commitStartingWeaponQualityRoll,
  commitStartingWeaponCheckpoint,
} from './creation-starting-weapon.js';
import {
  parseStartingWeaponStage,
  type StartingWeaponQualityRollRequest,
  type StartingWeaponEntryRequest,
  type StartingWeaponCheckpointRequest,
} from './creation-starting-weapon-contract.js';

let armorCatalog: Awaited<ReturnType<typeof loadArmorBundleCatalog>>;
let weaponCatalog: Awaited<ReturnType<typeof loadStartingWeaponCatalog>>;
beforeAll(async () => {
  [armorCatalog, weaponCatalog] = await Promise.all([
    loadArmorBundleCatalog(process.cwd()),
    loadStartingWeaponCatalog(process.cwd()),
  ]);
});
const setups: ManualWizardSetup[] = [];
afterEach(() => {
  for (const setup of setups.splice(0)) if (setup.database.open) setup.database.close();
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
) {
  const setup = createManualWizardSetup(prefix, 'FREE', mode, ':memory:');
  setups.push(setup);
  let current = commitCreationWizardCheckpoint(
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

describe('CHR-022 starting weapon durable stage', () => {
  it('rolls back the entire armor checkpoint when the weapon request allocator fails', () => {
    let before = '';
    expect(() =>
      setupWeapon('atomic-failure', 'MANUAL', () => {
        before = reload(setups.at(-1)!).localCharacter.payloadJson;
        throw new Error('weapon allocator failed');
      }),
    ).toThrow('weapon allocator failed');
    const current = reload(setups.at(-1)!);
    expect(current.localCharacter.payloadJson).toBe(before);
    expect(current.armorBundleStage?.checkpointRecordOrNull).toBeNull();
    expect(current.startingWeaponStage).toBeNull();
  });
  it('preserves the pending request on pre-roll armor return and rejects commands until resume', () => {
    const { setup, current } = setupWeapon('return-before-roll');
    const returned = advanceStartingWeaponPresentation(
      setup.database,
      {
        characterDraftId: setup.characterDraftId,
        wizardCheckpointId: setup.wizardCheckpointId,
        formId: 'CHR-021',
      },
      setup.catalog,
    );
    const sampleD20 = vi.fn(() => 20);
    const dependencies = { catalog: setup.catalog, weaponCatalog, sampleD20 };
    expect(returned.localCharacter.payloadJson).toBe(current.localCharacter.payloadJson);
    expect(returned.checkpoint.checkpointRevision).toBe(current.checkpoint.checkpointRevision);
    expect(() =>
      commitStartingWeaponQualityRoll(
        setup.database,
        qualityRequest(returned, 'wrong-presentation', 19),
        'wrong-presentation-receipt',
        dependencies,
      ),
    ).toThrow('GUARD_REJECTED');
    expect(() =>
      commitArmorBundleQualityRoll(
        setup.database,
        command(
          returned,
          'old-armor-write',
          {
            sourceFormId: 'CHR-021',
            variant: 'ARMOR_BUNDLE_QUALITY',
            armorBundleId: returned.armorBundleStage!.armorBundleId,
            qualityRollRequestId: returned.armorBundleStage!.qualityRollRequestId,
            armorPieces: [{ itemId: 'ITM-ARM-005', bodyZoneOrNull: null }],
            manualFaceOrNull: 20,
          },
          true,
        ),
        'old-armor-write-receipt',
        { catalog: setup.catalog, armorCatalog, sampleD20 },
      ),
    ).toThrow('GUARD_REJECTED');
    expect(sampleD20).not.toHaveBeenCalled();
    const resumed = advanceStartingWeaponPresentation(
      setup.database,
      {
        characterDraftId: setup.characterDraftId,
        wizardCheckpointId: setup.wizardCheckpointId,
        formId: 'CHR-022',
      },
      setup.catalog,
    );
    const rolled = commitStartingWeaponQualityRoll(
      setup.database,
      qualityRequest(resumed, 'resumed-roll', 19),
      'resumed-roll-receipt',
      dependencies,
    );
    expect(rolled.startingWeaponStage?.weaponQualityRollRequestId).toBe(
      current.startingWeaponStage?.weaponQualityRollRequestId,
    );
    expect(reload(setup).startingWeaponStage).toEqual(rolled.startingWeaponStage);
  });
  it('rejects coherent stored unknown, incompatible and race-forbidden weapons with valid snapshot hashes', () => {
    const { setup, current } = setupWeapon('canonical-history');
    const rolled = commitStartingWeaponQualityRoll(
      setup.database,
      qualityRequest(current, 'canonical-roll', 19),
      'canonical-roll-receipt',
      {
        catalog: setup.catalog,
        weaponCatalog,
        sampleD20: () => {
          throw new Error('manual');
        },
      },
    );
    const original = rolled.localCharacter.payloadJson;
    const replacements = [
      original.replaceAll('ITM-WPN-001', 'unknown-weapon'),
      original.replaceAll('"weaponVariant":"DEFAULT"', '"weaponVariant":"ONE_HAND"'),
      original.replaceAll('ITM-WPN-001', 'ITM-WPN-003'),
      original.replace(
        `"name":"${rolled.startingWeaponStage!.qualityRollRecordOrNull!.name}"`,
        '"name":"invented name"',
      ),
    ];
    function persist(payloadJson: string) {
      const snapshotJson = JSON.stringify({
        localCharacter: {
          localCharacterId: setup.characterDraftId,
          lifecycleState: rolled.localCharacter.lifecycleState,
          payloadJson,
        },
      });
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
    for (const corrupted of replacements) {
      expect(corrupted).not.toBe(original);
      persist(corrupted);
      expect(() => reload(setup)).toThrow('GUARD_REJECTED');
    }
    persist(original);
    expect(reload(setup).startingWeaponStage).toEqual(rolled.startingWeaponStage);
  });
  it('binds an atomic pending weapon request to the originating armor receipt', () => {
    const { setup, current } = setupWeapon('pending-binding');
    const stage = current.startingWeaponStage!;
    const payload = {
      ...current.durablePayload,
      startingWeaponStage: { ...stage, weaponQualityRollRequestId: 'forged-pending-request' },
    };
    const payloadJson = JSON.stringify(payload);
    const snapshotJson = JSON.stringify({
      localCharacter: {
        localCharacterId: setup.characterDraftId,
        lifecycleState: current.localCharacter.lifecycleState,
        payloadJson,
      },
    });
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
    expect(() => reload(setup)).toThrow('GUARD_REJECTED');
  });
  it('atomically creates the pending weapon request with the confirmed armor checkpoint', () => {
    const allocate = vi.fn(() => 'atomic-weapon-request');
    const { setup, current, before } = setupWeapon('atomic', 'MANUAL', allocate);
    expect(allocate).toHaveBeenCalledTimes(1);
    expect(current.checkpoint.checkpointRevision).toBe(before.checkpoint.checkpointRevision + 1);
    expect(current.startingWeaponStage).toMatchObject({
      weaponQualityRollRequestId: 'atomic-weapon-request',
      armorBundleCheckpointReceiptId: 'atomic-armor-checkpoint-receipt',
      entryRequest: current.armorBundleStage!.checkpointRecordOrNull!.request,
      entryReceipt: current.armorBundleStage!.checkpointRecordOrNull!.receipt,
      qualityRollRecordOrNull: null,
      checkpointRecordOrNull: null,
    });
    expect(reload(setup).startingWeaponStage).toEqual(current.startingWeaponStage);
    expect(creationWizardDurableIds(current).has('atomic-weapon-request')).toBe(true);
    expect(
      loadCreationWizardCommandByCommandId(
        setup.database,
        'atomic-armor-checkpoint',
        setup.catalog.skillStage,
        setup.catalog,
      )?.receipt,
    ).toEqual(current.receipt);
  });
  it('upgrades historical armor through an explicit entry command without replacing armor records', () => {
    const { setup, current: old } = setupWeapon('legacy', 'MANUAL', null);
    expect(old.armorBundleStage?.checkpointRecordOrNull).not.toBeNull();
    const stage = old.startingWeaponStage;
    if (stage !== undefined && stage !== null) {
      throw new Error('legacy fixture unexpectedly initialized starting weapon');
    }
    const request = command(old, 'legacy-entry', {
      sourceFormId: 'CHR-021',
      variant: 'STARTING_WEAPON_ENTRY',
      armorBundleId: old.armorBundleStage!.armorBundleId,
      armorBundleCheckpointReceiptId:
        old.armorBundleStage!.checkpointRecordOrNull!.receipt.receiptId,
    }) as StartingWeaponEntryRequest;
    const allocate = vi.fn(() => 'legacy-weapon-request');
    const current = commitStartingWeaponEntry(setup.database, request, 'legacy-entry-receipt', {
      catalog: setup.catalog,
      allocateWeaponQualityRollRequestId: allocate,
    });
    expect(current.armorBundleStage).toEqual(old.armorBundleStage);
    expect(current.startingWeaponStage?.entryReceipt.receiptId).toBe('legacy-entry-receipt');
    expect(reload(setup).startingWeaponStage).toEqual(current.startingWeaponStage);
    expect(() =>
      commitStartingWeaponEntry(setup.database, request, 'legacy-entry-receipt-2', {
        catalog: setup.catalog,
        allocateWeaponQualityRollRequestId: allocate,
      }),
    ).toThrow();
    expect(allocate).toHaveBeenCalledTimes(1);
  });
  it.each([1, 20])(
    'locks manual quality %i without sampling, crit or XP and checkpoints to signed CHR-023',
    (face) => {
      const { setup, current } = setupWeapon(`manual-${String(face)}`);
      const sampleD20 = vi.fn(() => {
        throw new Error('manual weapon roll must not sample');
      });
      const request = qualityRequest(current, `manual-${String(face)}-roll`, face);
      const rolled = commitStartingWeaponQualityRoll(
        setup.database,
        request,
        `manual-${String(face)}-receipt`,
        { catalog: setup.catalog, weaponCatalog, sampleD20 },
      );
      expect(sampleD20).not.toHaveBeenCalled();
      expect(rolled.armorBundleStage).toEqual(current.armorBundleStage);
      expect(
        rolled.startingWeaponStage?.qualityRollRecordOrNull?.physicalRoll.mechanical.rawFace,
      ).toBe(face);
      expect(rolled.durablePayload.randomReceiptIds).toEqual(
        current.durablePayload.randomReceiptIds,
      );
      expect(
        loadCreationWizardCommandByCommandId(
          setup.database,
          request.commandId,
          setup.catalog.skillStage,
          setup.catalog,
        )?.receipt,
      ).toEqual(rolled.receipt);
      const saved = commitStartingWeaponCheckpoint(
        setup.database,
        checkpointRequest(rolled, `manual-${String(face)}-checkpoint`),
        `manual-${String(face)}-checkpoint-receipt`,
        { catalog: setup.catalog, weaponCatalog },
      );
      expect(saved.nextStageEnvelope.formId).toBe('CHR-023');
      expect(saved.symbiontPresentationStage?.formId).toBe('CHR-022');
      expect(saved.receipt.result).toMatchObject({
        ownershipState: 'OWNED_NOT_EQUIPPED',
        weaponTypeId: 'ITM-WPN-001',
        weaponVariant: 'DEFAULT',
      });
      expect(reload(setup)).toEqual(saved);
      expect(() =>
        commitStartingWeaponQualityRoll(
          setup.database,
          qualityRequest(saved, 'second-roll', face),
          'second-roll-receipt',
          { catalog: setup.catalog, weaponCatalog, sampleD20 },
        ),
      ).toThrow();
    },
  );
  it('samples AUTO once and refuses changed, stale, foreign, fixed and incompatible selections before sampling', () => {
    const { setup, current } = setupWeapon('auto', 'AUTO');
    const sampleD20 = vi.fn(() => 15);
    const dependencies = { catalog: setup.catalog, weaponCatalog, sampleD20 };
    const baseline = current.localCharacter.payloadJson;
    const variants = [
      qualityRequest(current, 'fixed', null, 'ITM-WPN-003'),
      qualityRequest(current, 'unknown', null, 'NO_SUCH_WEAPON'),
      qualityRequest(current, 'variant', null, 'ITM-WPN-001', 'SHIELD'),
      qualityRequest(current, 'wrong-mode', 10),
    ];
    const stale = qualityRequest(current, 'stale', null);
    variants.push({
      ...stale,
      expectedRevisions: { ...stale.expectedRevisions, stateRevision: 0 },
    });
    const foreign = qualityRequest(current, 'foreign', null);
    variants.push({
      ...foreign,
      payload: { ...foreign.payload, weaponQualityRollRequestId: 'other-request' },
    });
    for (const request of variants)
      expect(() =>
        commitStartingWeaponQualityRoll(
          setup.database,
          request,
          `${request.commandId}-receipt`,
          dependencies,
        ),
      ).toThrow();
    expect(sampleD20).not.toHaveBeenCalled();
    expect(reload(setup).localCharacter.payloadJson).toBe(baseline);
    const request = qualityRequest(current, 'auto-roll', null);
    const rolled = commitStartingWeaponQualityRoll(
      setup.database,
      request,
      'auto-roll-receipt',
      dependencies,
    );
    expect(sampleD20).toHaveBeenCalledTimes(1);
    expect(rolled.durablePayload.randomReceiptIds.at(-1)).toBe('auto-roll-receipt');
    expect(() =>
      commitStartingWeaponQualityRoll(setup.database, request, 'another-receipt', dependencies),
    ).toThrow();
    expect(sampleD20).toHaveBeenCalledTimes(1);
    expect(reload(setup).startingWeaponStage).toEqual(rolled.startingWeaponStage);
  });
  it('rejects altered history, mismatched recommendation, receipt linkage and duplicate IDs', () => {
    const { setup, current } = setupWeapon('history');
    const rolled = commitStartingWeaponQualityRoll(
      setup.database,
      qualityRequest(current, 'history-roll', 19),
      'history-roll-receipt',
      {
        catalog: setup.catalog,
        weaponCatalog,
        sampleD20: () => {
          throw new Error('manual');
        },
      },
    );
    const stage = rolled.startingWeaponStage!;
    for (const alter of [
      (value: typeof stage) => ({ ...value, armorBundleCheckpointReceiptId: 'other' }),
      (value: typeof stage) => ({
        ...value,
        weaponQualityRollRequestId: value.entryRequest.commandId,
      }),
      (value: typeof stage) => ({
        ...value,
        qualityRollRecordOrNull: {
          ...value.qualityRollRecordOrNull!,
          qualityRecommendation: {
            ...value.qualityRollRecordOrNull!.qualityRecommendation,
            rawFace: 20,
          },
        },
      }),
    ]) {
      expect(() => parseStartingWeaponStage(alter(stage), rolled.armorBundleStage!)).toThrow();
    }
    expect(reload(setup).startingWeaponStage).toEqual(stage);
  });
});
