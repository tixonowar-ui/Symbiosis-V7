import { createHash } from 'node:crypto';
import type { PostSaveCacheEntry } from '@shared/local-character-post-save.js';
import type { DurableCreationWizardCheckpoint } from './creation-set-decide.js';
import { canonicalCreationFinalizationCatalog } from './creation-finalization-catalog.js';
import { validatedCreationFinalizationVersions } from './creation-finalization.js';
import {
  canonicalPostSaveJson,
  postSaveSha256,
  verifiedPostSaveCheckpoint,
} from './local-character-export.js';

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const uuid = (value: unknown): string => {
  const bytes = createHash('sha256').update(canonicalPostSaveJson(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** A manifest describes immutable versions; selecting an entry never activates it. */
export function deriveLocalCharacterCache(
  source: DurableCreationWizardCheckpoint,
  ownerDeviceId: string,
) {
  if (typeof ownerDeviceId !== 'string' || ownerDeviceId.length === 0)
    throw new Error('cache owner is missing');
  const checkpoint = verifiedPostSaveCheckpoint(source, canonicalCreationFinalizationCatalog());
  const characterId = checkpoint.localCharacter.localCharacterId;
  const rows: { logicalBranchId: string; entry: PostSaveCacheEntry }[] = [];
  let selectedBranchUuidOrNull: string | null = null;
  const auto = checkpoint.raceAndMethodStage?.diceInput?.value === 'AUTO';
  const add = (
    logicalBranchId: string,
    branchKind: PostSaveCacheEntry['branchKind'],
    payload: unknown,
    savedAtRevision: number,
    receipts: readonly string[],
    selected = true,
  ): void => {
    if (
      !Number.isSafeInteger(savedAtRevision) ||
      savedAtRevision < 0 ||
      savedAtRevision > checkpoint.receipt.result.draftRevision
    )
      throw new Error('cache version has an invalid saved revision');
    const payloadHash = postSaveSha256(canonicalPostSaveJson(payload));
    const prior = rows.find(
      (r) => r.logicalBranchId === logicalBranchId && r.entry.payloadHash === payloadHash,
    );
    if (prior !== undefined) {
      if (selected) selectedBranchUuidOrNull = prior.entry.branchUuid;
      return;
    }
    const randomReceiptIds = auto ? [...new Set(receipts)] : [];
    if (
      randomReceiptIds.some(
        (id) => !(checkpoint.durablePayload.randomReceiptIds as readonly string[]).includes(id),
      )
    )
      throw new Error('cache version references a foreign random receipt');
    const entry: PostSaveCacheEntry = {
      branchUuid: uuid([
        'SYMBIOSIS_CACHE_ENTRY_V1',
        ownerDeviceId,
        logicalBranchId,
        payloadHash,
        savedAtRevision,
      ]),
      branchKind,
      payloadHash,
      randomReceiptIds,
      savedAtRevision,
    };
    rows.push({ logicalBranchId, entry });
    if (selected) selectedBranchUuidOrNull = entry.branchUuid;
  };
  const race = checkpoint.raceAndMethodStage?.race;
  if (race !== null && race !== undefined)
    add(
      `${characterId}:race`,
      'RACE',
      { raceCode: race.value },
      checkpoint.raceAndMethodStage!.decisionRecords.find(
        (r) => r.request.payload.sourceFormId === 'CHR-010',
      )!.receipt.result.draftRevision,
      [],
    );
  const stats = checkpoint.statRollStage;
  if (stats !== null) {
    for (const attempt of stats.attempts) {
      if (attempt.setRecord === null) continue;
      const receipts: string[] = [];
      const acceptedRecords: unknown[] = [];
      for (const record of [
        attempt.setRecord,
        ...attempt.confirmationRecords,
        ...(attempt.decisionRecordOrNull === null ? [] : [attempt.decisionRecordOrNull]),
      ]) {
        acceptedRecords.push(record);
        if (
          record === attempt.setRecord ||
          attempt.confirmationRecords.includes(
            record as (typeof attempt.confirmationRecords)[number],
          )
        )
          receipts.push(record.receipt.receiptId);
        add(
          stats.branchUuid,
          'RACE',
          {
            raceCode: race!.value,
            statMethod: stats.statMethod,
            attemptIndex: attempt.attemptIndex,
            acceptedRecords,
          },
          record.receipt.result.draftRevision,
          receipts,
        );
      }
    }
  }
  if (checkpoint.pureClassStage !== null) {
    const stage = checkpoint.pureClassStage;
    add(`${characterId}:class`, 'CLASS', stage.derived, stage.receipt.result.draftRevision, []);
  }
  const manual = checkpoint.manualCompositionStage;
  if (manual != null) {
    const records = [
      ...manual.compositionRecords,
      manual.advisorIwRecordOrNull,
      manual.suppressionRollRecordOrNull,
      manual.advisorSkillRecordOrNull,
    ]
      .filter((r) => r !== null)
      .sort((a, b) => a.receipt.result.draftRevision - b.receipt.result.draftRevision);
    const physicalReceipts: string[] = [];
    const acceptedRecords: unknown[] = [];
    for (const record of records) {
      if ('physicalRolls' in record)
        physicalReceipts.push(...record.physicalRolls.map((r) => r.rollReceiptId));
      if ('physicalRoll' in record) physicalReceipts.push(record.physicalRoll.rollReceiptId);
      acceptedRecords.push(record);
      add(
        `${characterId}:manual-symbionts`,
        'SYMBIONT',
        { acceptedRecords },
        record.receipt.result.draftRevision,
        physicalReceipts,
      );
    }
  }
  const random = checkpoint.randomSymbiontStage;
  if (random !== null) {
    const acceptedRecords: unknown[] = [];
    const physicalReceipts: string[] = [];
    const records = [
      ...random.rollRecords,
      ...[
        random.bindingRecordOrNull,
        checkpoint.advisorIntelligenceFloorStage?.rollRecordOrNull ?? null,
        random.advisorSkillRecordOrNull,
      ].filter((r) => r !== null),
    ].sort((a, b) => a.receipt.result.draftRevision - b.receipt.result.draftRevision);
    for (const record of records) {
      acceptedRecords.push(record);
      if ('physicalRoll' in record) physicalReceipts.push(record.physicalRoll.rollReceiptId);
      add(
        random.randomSequenceId,
        'SYMBIONT',
        { raceCode: random.raceCode, acceptedRecords },
        record.receipt.result.draftRevision,
        physicalReceipts,
      );
    }
  }
  for (const version of validatedCreationFinalizationVersions(checkpoint)) {
    for (const branch of version.state.branches) {
      const physical = [
        ...(branch.sourceRandomSequenceOrNull?.physicalRolls ?? []),
        ...(branch.randomSequenceOrNull?.physicalRolls ?? []),
        ...branch.physicalRolls,
        ...(branch.advisorOrNull?.physicalRolls ?? []),
      ];
      add(
        branch.branchId,
        branch.raceCode === 'PURE' ? 'CLASS' : 'SYMBIONT',
        branch,
        version.savedAtRevision,
        physical.map((r) => r.rollReceiptId),
        branch.branchId === version.state.activeBranchId,
      );
    }
  }
  rows.sort(
    (a, b) =>
      compare(a.logicalBranchId, b.logicalBranchId) ||
      a.entry.savedAtRevision - b.entry.savedAtRevision ||
      compare(a.entry.branchUuid, b.entry.branchUuid),
  );
  const entries = rows.map((r) => r.entry);
  const hash = postSaveSha256(
    `SYMBIOSIS_CACHE_MANIFEST_V1\n${canonicalPostSaveJson({ schemaVersion: 1, characterId, entries })}`,
  );
  return { entries, selectedBranchUuidOrNull, hash };
}
