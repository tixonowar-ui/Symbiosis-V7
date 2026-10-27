import { describe, expect, it } from 'vitest';

import type { JsonObject, RevisionVector } from '@shared/index.js';

import { recommendArmorQuality, type ValidatedArmorBundle } from '../domain/index.js';
import type { DurableCreationWizardCheckpoint } from './creation-set-decide.js';
import {
  armorBundleCheckpointReceipt,
  armorBundleEntryReceipt,
  armorBundleQualityRollReceipt,
  armorBundleStageIds,
  normalizeArmorBundleCheckpointRequest,
  normalizeArmorBundleEntryRequest,
  normalizeArmorBundleQualityRollRequest,
  parseArmorBundleStage,
} from './creation-armor-bundle-contract.js';

const REVISIONS: RevisionVector = {
  actorVisibilityRevision: 1,
  projectionRevision: 2,
  stateRevision: 3,
};

function rawRequest(
  commandId: string,
  workflowCommandId: 'UI-CMD-CHAR-CREATION-ROLL-COMMIT' | 'UI-CMD-CHAR-WIZARD-CHECKPOINT',
  payload: JsonObject,
): Parameters<typeof normalizeArmorBundleEntryRequest>[0] {
  return {
    commandId,
    commandKind: 'workflow-command',
    expectedRevisions: REVISIONS,
    messageType: 'command.request',
    payload,
    protocolVersion: 1,
    role: 'player',
    workflowCommandId,
  };
}

function entryPayload(): JsonObject {
  return {
    stage: 'SYMBIONTS',
    sourceFormId: 'CHR-019',
    variant: 'ARMOR_BUNDLE_ENTRY',
    characterDraftId: 'character-draft',
    wizardCheckpointId: 'wizard-checkpoint',
    draftRevision: 4,
  };
}

function qualityPayload(): JsonObject {
  return {
    stage: 'SYMBIONTS',
    sourceFormId: 'CHR-021',
    variant: 'ARMOR_BUNDLE_QUALITY',
    characterDraftId: 'character-draft',
    wizardCheckpointId: 'wizard-checkpoint',
    draftRevision: 5,
    armorBundleId: 'armor-bundle',
    qualityRollRequestId: 'quality-request',
    armorPieces: [{ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'HEAD' }],
    manualFaceOrNull: 17,
  };
}

function checkpointPayload(): JsonObject {
  return {
    stage: 'SYMBIONTS',
    sourceFormId: 'CHR-021',
    variant: 'ARMOR_BUNDLE_CHECKPOINT',
    characterDraftId: 'character-draft',
    wizardCheckpointId: 'wizard-checkpoint',
    draftRevision: 6,
    armorBundleId: 'armor-bundle',
    qualityRollReceiptId: 'quality-receipt',
  };
}

function minimalCheckpoint(): DurableCreationWizardCheckpoint {
  return {
    localCharacter: { localCharacterId: 'character-draft' },
    checkpoint: { checkpointId: 'wizard-checkpoint' },
    statRollStage: { branchUuid: 'stat-branch' },
  } as unknown as DurableCreationWizardCheckpoint;
}

function envelope(formId: 'CHR-021' | 'CHR-022') {
  return {
    formId,
    routeBindings: [{ parameterIndex: 0, source: 'inherited', value: 'character-draft' }],
  } as const;
}

function validatedBundle(): ValidatedArmorBundle {
  return {
    armorPieces: [
      {
        itemId: 'ITM-ARM-001',
        name: 'Кожаный доспех',
        coverageModel: 'ZONE_ELEMENT',
        bodyZone: 'HEAD',
      },
    ],
    distinctBodyZones: ['HEAD'],
  };
}

describe('CHR-021 armor bundle host contract', () => {
  it('normalizes the entry, quality-roll and final checkpoint payloads with exact keys', () => {
    const entry = normalizeArmorBundleEntryRequest(
      rawRequest('entry-command', 'UI-CMD-CHAR-WIZARD-CHECKPOINT', entryPayload()),
    );
    expect(entry.payload).toEqual({
      ...entryPayload(),
      sourceFormId: 'CHR-019',
      variant: 'ARMOR_BUNDLE_ENTRY',
    });

    const quality = normalizeArmorBundleQualityRollRequest(
      rawRequest('quality-command', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT', qualityPayload()),
    );
    expect(quality.payload).toEqual({
      ...qualityPayload(),
      sourceFormId: 'CHR-021',
      variant: 'ARMOR_BUNDLE_QUALITY',
    });

    const checkpoint = normalizeArmorBundleCheckpointRequest(
      rawRequest('checkpoint-command', 'UI-CMD-CHAR-WIZARD-CHECKPOINT', checkpointPayload()),
    );
    expect(checkpoint.payload).toEqual({
      ...checkpointPayload(),
      sourceFormId: 'CHR-021',
      variant: 'ARMOR_BUNDLE_CHECKPOINT',
    });
  });

  it.each([
    ['wrong workflow', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT' as const, entryPayload()],
    [
      'wrong stage',
      'UI-CMD-CHAR-WIZARD-CHECKPOINT' as const,
      { ...entryPayload(), stage: 'ITEMS' },
    ],
    ['extra field', 'UI-CMD-CHAR-WIZARD-CHECKPOINT' as const, { ...entryPayload(), forged: true }],
    [
      'wrong entry source',
      'UI-CMD-CHAR-WIZARD-CHECKPOINT' as const,
      { ...entryPayload(), sourceFormId: 'CHR-021' },
    ],
  ])('rejects %s before host guards', (_name, workflowCommandId, payload) => {
    expect(() =>
      normalizeArmorBundleEntryRequest(rawRequest('command', workflowCommandId, payload)),
    ).toThrow();
  });

  it('rejects malformed quality faces, zones and extra quality payload fields', () => {
    expect(() =>
      normalizeArmorBundleQualityRollRequest(
        rawRequest('quality', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT', {
          ...qualityPayload(),
          manualFaceOrNull: 21,
        }),
      ),
    ).toThrow('1..20');
    expect(() =>
      normalizeArmorBundleQualityRollRequest(
        rawRequest('quality', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT', {
          ...qualityPayload(),
          armorPieces: [{ itemId: 'ITM-ARM-001', bodyZoneOrNull: 'TAIL' }],
        }),
      ),
    ).toThrow('$.payload.armorPieces[0].bodyZoneOrNull');
    expect(() =>
      normalizeArmorBundleQualityRollRequest(
        rawRequest('quality', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT', {
          ...qualityPayload(),
          availabilityTrace: ['for-player'],
        }),
      ),
    ).toThrow('no additional field');
  });

  it('builds receipts and parses an exact armor bundle stage', () => {
    const checkpoint = minimalCheckpoint();
    const entryRequest = normalizeArmorBundleEntryRequest(
      rawRequest('entry-command', 'UI-CMD-CHAR-WIZARD-CHECKPOINT', entryPayload()),
    );
    const entryReceipt = armorBundleEntryReceipt(
      {
        checkpoint,
        receiptId: 'entry-receipt',
        revisions: REVISIONS,
        checkpointRevision: 4,
        draftRevision: 5,
        armorBundleId: 'armor-bundle',
        qualityRollRequestId: 'quality-request',
      },
      entryRequest,
    );
    expect(entryReceipt.result.nextFormId).toBe('CHR-021');

    const qualityRequest = normalizeArmorBundleQualityRollRequest(
      rawRequest('quality-command', 'UI-CMD-CHAR-CREATION-ROLL-COMMIT', qualityPayload()),
    );
    const qualityReceipt = armorBundleQualityRollReceipt(
      {
        checkpoint,
        receiptId: 'quality-receipt',
        revisions: REVISIONS,
        checkpointRevision: 5,
        draftRevision: 6,
        diceInputModeSnapshot: 'MANUAL',
      },
      qualityRequest,
      {
        kind: 'ARMOR_BUNDLE_QUALITY',
        rollRequestId: 'quality-request',
        rollReceiptId: 'quality-receipt',
        mechanical: { dieSides: 20, rawFace: 17 },
      },
      validatedBundle(),
      recommendArmorQuality(17),
    );
    expect(qualityReceipt.result.physicalRoll).toEqual({
      kind: 'ARMOR_BUNDLE_QUALITY',
      rollRequestId: 'quality-request',
      rollReceiptId: 'quality-receipt',
      mechanical: { dieSides: 20, rawFace: 17 },
    });
    expect(qualityReceipt.result.qualityRecommendation.label).toBe('Хорошее');

    const checkpointRequest = normalizeArmorBundleCheckpointRequest(
      rawRequest('checkpoint-command', 'UI-CMD-CHAR-WIZARD-CHECKPOINT', checkpointPayload()),
    );
    const finalReceipt = armorBundleCheckpointReceipt(
      {
        checkpoint,
        receiptId: 'checkpoint-receipt',
        revisions: REVISIONS,
        checkpointRevision: 6,
        draftRevision: 7,
      },
      checkpointRequest,
      validatedBundle(),
      qualityReceipt,
    );
    expect(finalReceipt.result.nextFormId).toBe('CHR-022');

    const qualityRecord = {
      armorPieces: validatedBundle().armorPieces,
      distinctBodyZones: validatedBundle().distinctBodyZones,
      qualityRecommendation: qualityReceipt.result.qualityRecommendation,
      physicalRoll: {
        kind: 'ARMOR_BUNDLE_QUALITY' as const,
        rollRequestId: 'quality-request',
        rollReceiptId: 'quality-receipt',
        mechanical: { dieSides: 20 as const, rawFace: 17 },
      },
      request: qualityRequest,
      receipt: qualityReceipt,
      nextStageEnvelope: envelope('CHR-021'),
    };
    const stage = parseArmorBundleStage({
      anatomyProfile: 'STANDARD_HUMANOID',
      armorBundleId: 'armor-bundle',
      diceInputModeSnapshot: 'MANUAL',
      entryRequest,
      entryReceipt,
      qualityRollRequestId: 'quality-request',
      qualityRollRecordOrNull: qualityRecord,
      checkpointRecordOrNull: {
        armorPieces: validatedBundle().armorPieces,
        distinctBodyZones: validatedBundle().distinctBodyZones,
        request: checkpointRequest,
        receipt: finalReceipt,
        nextStageEnvelope: envelope('CHR-022'),
      },
    });
    expect(stage.armorBundleId).toBe('armor-bundle');
    expect([...armorBundleStageIds(stage)].sort()).toEqual(
      [
        'armor-bundle',
        'entry-command',
        'entry-receipt',
        'quality-command',
        'quality-request',
        'quality-receipt',
        'checkpoint-command',
        'checkpoint-receipt',
      ].sort(),
    );
  });

  it('rejects a stage whose committed records drift from the immutable bundle identity', () => {
    const checkpoint = minimalCheckpoint();
    const entryRequest = normalizeArmorBundleEntryRequest(
      rawRequest('entry-command', 'UI-CMD-CHAR-WIZARD-CHECKPOINT', entryPayload()),
    );
    const entryReceipt = armorBundleEntryReceipt(
      {
        checkpoint,
        receiptId: 'entry-receipt',
        revisions: REVISIONS,
        checkpointRevision: 4,
        draftRevision: 5,
        armorBundleId: 'armor-bundle',
        qualityRollRequestId: 'quality-request',
      },
      entryRequest,
    );
    expect(() =>
      parseArmorBundleStage({
        anatomyProfile: 'STANDARD_HUMANOID',
        armorBundleId: 'other-bundle',
        diceInputModeSnapshot: 'AUTO',
        entryRequest,
        entryReceipt,
        qualityRollRequestId: 'quality-request',
        qualityRollRecordOrNull: null,
        checkpointRecordOrNull: null,
      }),
    ).toThrow('GUARD_REJECTED');
  });
});
