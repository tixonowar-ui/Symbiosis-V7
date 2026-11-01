import { isDeepStrictEqual } from 'node:util';
import type {
  AdmissionReviewInputs,
  AdmissionWeaponDecisionRef,
} from '@shared/campaign-admission.js';
import {
  admissionReviewMutationValue,
  admissionReviewStateValue,
  type AdmissionReviewState,
  type AdmissionReviewCopyState,
  type AdmissionReviewMutation,
} from '@shared/campaign-admission-review.js';
import { completeAdmissionReviewInputs } from '@shared/campaign-admission-codec.js';
import type { ValidatedFinalAdmissionReviewSource } from './device-admission-candidate.js';
import type { LocalCharacterExportBaseline } from './local-character-export.js';
import type { FiveStartingPositionsCatalog } from '../domain/rules/item-stage/five-starting-positions.js';
import type { WeaponProfileCatalog } from '../domain/rules/item-stage/weapon-profile.js';
import {
  deriveAdmissionSourceProperties,
  initialAdmissionInventoryReview,
  validateAdmissionInventorySelection,
  type AdmissionReviewItemIdentity,
} from './campaign-admission-inventory.js';
import {
  admissionSourceMechanicsInput,
  deriveAdmissionMechanicalCores,
} from './campaign-admission-mechanics.js';
import {
  admissionStagedWeaponDecision,
  deriveAdmissionWeaponResolution,
} from './campaign-admission-weapon.js';
import type { AdmissionCopyPublicationInput } from './campaign-admission-proposal.js';

export interface AdmissionReviewCatalogs {
  readonly baseline: LocalCharacterExportBaseline;
  readonly items: FiveStartingPositionsCatalog;
  readonly weapons: WeaponProfileCatalog;
}
function fail(detail: string): never {
  throw new Error(`admission review: ${detail}`);
}
function initialInputs(
  source: ValidatedFinalAdmissionReviewSource,
  identities: readonly AdmissionReviewItemIdentity[],
): AdmissionReviewInputs {
  const mechanics = admissionSourceMechanicsInput(source);
  return {
    statAdjustments: { S: 0, D: 0, M: 0, Z: 0, I: 0, W: 0, C: 0 },
    startingSkills: {
      entries: mechanics.learnedSkills
        .filter((entry) => entry.source === 'SELECTED')
        .map((entry) => ({ skillKey: entry.skillKey, targetBonus: entry.bonus })),
    },
    massReview: {
      massKg: source.checkpoint.finalizationStage!.finalMechanicsSnapshotOrNull!.identity.massKg,
      decision: 'PENDING_MASTER_APPROVAL',
    },
    inventoryReview: initialAdmissionInventoryReview(
      deriveAdmissionSourceProperties(source),
      identities,
    ),
    moneyReview: { status: 'PENDING', amountOrNull: null },
    weaponDecisionRefs: [],
    groupAssignmentOrNull: null,
    locationAssignmentOrNull: null,
  };
}

export function createAdmissionReviewState(
  sources: readonly ValidatedFinalAdmissionReviewSource[],
  requestId: string,
  allocateId: () => string,
): AdmissionReviewState {
  const admissionBatchId = allocateId();
  return admissionReviewStateValue({
    schemaVersion: 1,
    admissionBatchId,
    requestId,
    reviewRevision: 0,
    copies: sources.map((source) => {
      const descriptor = source.candidate.descriptor,
        reviewCopyId = allocateId();
      const reviewItemIdentities = deriveAdmissionSourceProperties(source).map((p) => ({
        reviewItemId: allocateId(),
        sourceEntryIdOrNull: p.sourceEntryId,
      }));
      return {
        reviewCopyId,
        sourceUuid: descriptor.sourceUuid,
        sourceSnapshotId: descriptor.sourceSnapshotId,
        snapshotChecksum: descriptor.sourceChecksum,
        reviewItemIdentities,
        inputs: initialInputs(source, reviewItemIdentities),
        weaponDecisions: [],
      };
    }),
    groupDraftIds: [],
  });
}
function boundSource(
  state: AdmissionReviewState,
  sources: readonly ValidatedFinalAdmissionReviewSource[],
  index: number,
): ValidatedFinalAdmissionReviewSource {
  const source = sources[index],
    copy = state.copies[index];
  if (
    state.copies.length !== sources.length ||
    source === undefined ||
    copy === undefined ||
    copy.sourceUuid !== source.candidate.descriptor.sourceUuid ||
    copy.sourceSnapshotId !== source.candidate.descriptor.sourceSnapshotId ||
    copy.snapshotChecksum !== source.candidate.descriptor.sourceChecksum
  )
    fail('immutable submitted source order or identity differs');
  return source;
}
export function verifyInitialAdmissionReviewState(
  state: AdmissionReviewState,
  sources: readonly ValidatedFinalAdmissionReviewSource[],
): void {
  admissionReviewStateValue(state);
  if (state.reviewRevision !== 0 || state.groupDraftIds.length !== 0)
    fail('invalid initial review revision or groups');
  state.copies.forEach((copy, index) => {
    const source = boundSource(state, sources, index);
    if (
      copy.weaponDecisions.length !== 0 ||
      !isDeepStrictEqual(copy.inputs, initialInputs(source, copy.reviewItemIdentities))
    )
      fail('initial review differs from immutable source input');
  });
}
function decisionRefs(copy: AdmissionReviewCopyState): readonly AdmissionWeaponDecisionRef[] {
  return copy.weaponDecisions.map((decision) => {
    const input = decision.input.weaponReviewInput;
    return input.kind === 'VALIDATED_REQUEST'
      ? {
          kind: input.kind,
          requestId: input.requestId,
          validationReceiptId: input.validationReceiptId,
          decisionReceiptId: decision.receiptId,
        }
      : {
          kind: input.kind,
          reviewItemId: input.reviewItemId,
          decisionReceiptId: decision.receiptId,
        };
  });
}
function verifyReviewInputs(
  state: AdmissionReviewState,
  sources: readonly ValidatedFinalAdmissionReviewSource[],
  catalogs: AdmissionReviewCatalogs,
): void {
  admissionReviewStateValue(state);
  const groupNames = new Map<string, string>();
  state.copies.forEach((copy, index) => {
    const source = boundSource(state, sources, index);
    deriveAdmissionMechanicalCores(source, catalogs.baseline, copy.inputs);
    validateAdmissionInventorySelection(
      deriveAdmissionSourceProperties(source),
      copy.reviewItemIdentities,
      copy.inputs.inventoryReview,
      catalogs.items,
    );
    if (!isDeepStrictEqual(copy.inputs.weaponDecisionRefs, decisionRefs(copy)))
      fail('staged weapon references are read-only');
    const group = copy.inputs.groupAssignmentOrNull;
    if (group?.kind === 'NEW') {
      if (groupNames.has(group.groupDraftId) && groupNames.get(group.groupDraftId) !== group.name)
        fail('new group identity has conflicting names');
      groupNames.set(group.groupDraftId, group.name);
    }
    for (const entry of copy.inputs.inventoryReview.entries) {
      if (entry.weaponDecisionReceiptIdOrNull === null) continue;
      const decision = copy.weaponDecisions.find(
        (d) => d.receiptId === entry.weaponDecisionReceiptIdOrNull,
      );
      if (decision === undefined) fail('unknown staged decision on inventory entry');
      const input = decision.input.weaponReviewInput;
      if (
        entry.item.kind !== 'CATALOG' ||
        entry.item.itemTypeId !== decision.afterProfile.weaponTypeId
      )
        fail('staged decision item type differs');
      if (input.kind === 'ADMISSION_GRANT') {
        if (input.reviewItemId !== entry.reviewItemId || entry.sourceEntryIdOrNull !== null)
          fail('foreign grant inventory binding');
      } else {
        const sourceEntry = deriveAdmissionSourceProperties(source).find(
          (p) => p.sourceEntryId === entry.sourceEntryIdOrNull,
        );
        if (
          sourceEntry?.weaponRequestOrNull?.requestId !== input.requestId ||
          sourceEntry.weaponRequestOrNull.validationReceiptId !== input.validationReceiptId
        )
          fail('foreign source weapon inventory binding');
      }
    }
  });
}

/** Pure replay of one historical draft mutation; the store owns authority, ordering and rollback. */
export function applyAdmissionReviewMutation(
  current: AdmissionReviewState,
  sources: readonly ValidatedFinalAdmissionReviewSource[],
  mutation: AdmissionReviewMutation,
  receiptId: string,
  catalogs: AdmissionReviewCatalogs,
): AdmissionReviewState {
  admissionReviewStateValue(current);
  admissionReviewMutationValue(mutation);
  if (current.reviewRevision === Number.MAX_SAFE_INTEGER) fail('review revision exhausted');
  let next: AdmissionReviewState = {
    ...structuredClone(current),
    reviewRevision: current.reviewRevision + 1,
  };
  if (mutation.kind === 'ALLOCATE_GROUP')
    next = { ...next, groupDraftIds: [...next.groupDraftIds, mutation.groupDraftId] };
  else {
    const index = current.copies.findIndex((c) => c.reviewCopyId === mutation.reviewCopyId);
    if (index < 0) fail('unknown review copy');
    const old = current.copies[index]!,
      source = boundSource(current, sources, index);
    let copy: AdmissionReviewCopyState = old;
    if (mutation.kind === 'ALLOCATE_ITEM')
      copy = {
        ...old,
        reviewItemIdentities: [
          ...old.reviewItemIdentities,
          { reviewItemId: mutation.reviewItemId, sourceEntryIdOrNull: null },
        ],
      };
    else if (mutation.kind === 'EDIT') copy = { ...old, inputs: structuredClone(mutation.inputs) };
    else {
      const review = mutation.input.weaponReviewInput;
      if (
        old.weaponDecisions.some((d) => {
          const p = d.input.weaponReviewInput;
          return review.kind === 'VALIDATED_REQUEST'
            ? p.kind === 'VALIDATED_REQUEST' && p.requestId === review.requestId
            : p.kind === 'ADMISSION_GRANT' && p.reviewItemId === review.reviewItemId;
        })
      )
        fail('weapon review already has a terminal staged decision');
      const resolution = deriveAdmissionWeaponResolution(
        source,
        catalogs.weapons,
        old.reviewItemIdentities,
        old.inputs,
        mutation.input,
      );
      copy = {
        ...old,
        weaponDecisions: [
          ...old.weaponDecisions,
          admissionStagedWeaponDecision(receiptId, resolution),
        ],
      };
      const properties = deriveAdmissionSourceProperties(source);
      copy = {
        ...copy,
        inputs: {
          ...copy.inputs,
          weaponDecisionRefs: decisionRefs(copy),
          inventoryReview: {
            ...copy.inputs.inventoryReview,
            entries: copy.inputs.inventoryReview.entries.map((entry) => {
              const matches =
                review.kind === 'ADMISSION_GRANT'
                  ? entry.reviewItemId === review.reviewItemId
                  : properties.find((p) => p.sourceEntryId === entry.sourceEntryIdOrNull)
                      ?.weaponRequestOrNull?.requestId === review.requestId;
              return matches ? { ...entry, weaponDecisionReceiptIdOrNull: receiptId } : entry;
            }),
          },
        },
      };
    }
    next = { ...next, copies: next.copies.map((c, i) => (i === index ? copy : c)) };
  }
  verifyReviewInputs(next, sources, catalogs);
  return next;
}

/** Call only with a state whose complete mutation history has been verified by the journal. */
export function admissionReviewPublicationInputs(
  state: AdmissionReviewState,
  sources: readonly ValidatedFinalAdmissionReviewSource[],
  copyIdsOrNull: readonly string[] | null,
): readonly AdmissionCopyPublicationInput[] {
  admissionReviewStateValue(state);
  if (copyIdsOrNull !== null && copyIdsOrNull.length !== state.copies.length)
    fail('incomplete final copy identity mapping');
  return state.copies.map((copy, index) => ({
    source: boundSource(state, sources, index),
    reviewCopyId: copy.reviewCopyId,
    campaignCharacterIdOrNull: copyIdsOrNull === null ? null : copyIdsOrNull[index]!,
    identities: copy.reviewItemIdentities,
    draft: completeAdmissionReviewInputs(copy.inputs),
    decisions: copy.weaponDecisions.map((decision) => ({
      ...decision,
      reviewCopyId: copy.reviewCopyId,
    })),
  }));
}
