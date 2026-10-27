import { describe, expect, it } from 'vitest';

import type { CommandResultMessage, JsonObject } from '@shared/index.js';

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
  type Chr021Projection,
} from './armor-bundle.js';

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
    expect(() => addArmorPiece(draft, preRoll.projection, 'ITM-ARM-009', 'HEAD')).toThrow(
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
        revisions: preRoll.revisions,
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
        revisions: rolled.revisions,
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
