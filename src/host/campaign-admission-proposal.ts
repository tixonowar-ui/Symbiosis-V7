import { isDeepStrictEqual } from 'node:util';
import type {
  AdmissionReviewDraft,
  AdmissionMechanicalCore,
  AdmissionMechanicalSheetV1,
} from '@shared/campaign-admission.js';
import {
  admissionFullCopyDiffValue,
  admissionLobbyBlockers,
  admissionProposalValue,
  type AdmissionFullCopyDiff,
  type AdmissionProposal,
  type AdmissionProposalBody,
} from '@shared/campaign-admission-proposal.js';
import {
  admissionMechanicalChanges,
  admissionMechanicalSheetValue,
} from '@shared/campaign-admission-sheet.js';
import type { FiveStartingPositionsCatalog } from '../domain/rules/item-stage/five-starting-positions.js';
import type { ValidatedFinalAdmissionReviewSource } from './device-admission-candidate.js';
import {
  admissionSourceInventorySheet,
  deriveAdmissionSourceProperties,
  type AdmissionReviewItemIdentity,
} from './campaign-admission-inventory.js';
import { deriveAdmissionMechanicalCores } from './campaign-admission-mechanics.js';
import {
  deriveAdmissionPublishedInventory,
  type VerifiedAdmissionWeaponDecision,
} from './campaign-admission-weapon.js';
import {
  canonicalPostSaveJson,
  postSaveSha256,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';

export interface AdmissionCopyPublicationInput {
  readonly source: ValidatedFinalAdmissionReviewSource;
  readonly reviewCopyId: string;
  readonly campaignCharacterIdOrNull: string | null;
  readonly identities: readonly AdmissionReviewItemIdentity[];
  readonly draft: AdmissionReviewDraft;
  readonly decisions: readonly VerifiedAdmissionWeaponDecision[];
}
/** An unfinished review still has a complete immutable source and derived mechanical core. */
export function deriveAdmissionReviewMechanicalSheets(
  source: ValidatedFinalAdmissionReviewSource,
  baseline: LocalCharacterExportBaseline,
  draft: Parameters<typeof deriveAdmissionMechanicalCores>[2],
  identities: readonly AdmissionReviewItemIdentity[],
): Readonly<{ beforeSheet: AdmissionMechanicalSheetV1; afterCore: AdmissionMechanicalCore }> {
  const properties = deriveAdmissionSourceProperties(source),
    cores = deriveAdmissionMechanicalCores(source, baseline, draft);
  const before = admissionMechanicalSheetValue({
    ...cores.before,
    massReview: {
      massKg: cores.before.identity.massKg,
      decision: 'PENDING_MASTER_APPROVAL' as const,
    },
    inventoryReview: admissionSourceInventorySheet(
      properties,
      identities.filter((identity) => identity.sourceEntryIdOrNull !== null),
    ),
    moneyReview: { status: 'PENDING' as const, amountOrNull: null },
    groupAssignmentOrNull: null,
    locationAssignmentOrNull: null,
  });
  return { beforeSheet: before, afterCore: cores.after };
}

/** No client sheets, diff rows, profiles or blockers are accepted as publication input. */
export function deriveAdmissionFullCopyDiff(
  input: AdmissionCopyPublicationInput,
  baseline: LocalCharacterExportBaseline,
  itemCatalog: FiveStartingPositionsCatalog,
): AdmissionFullCopyDiff {
  const { source, draft, identities, reviewCopyId, campaignCharacterIdOrNull, decisions } = input,
    { beforeSheet: before, afterCore } = deriveAdmissionReviewMechanicalSheets(
      source,
      baseline,
      draft,
      identities,
    );
  const after = {
    ...afterCore,
    massReview: draft.massReview,
    inventoryReview: deriveAdmissionPublishedInventory(
      source,
      reviewCopyId,
      identities,
      draft,
      decisions,
      itemCatalog,
    ),
    moneyReview: draft.moneyReview,
    groupAssignmentOrNull: draft.groupAssignment,
    locationAssignmentOrNull: draft.locationAssignment,
  };
  const result = {
    sourceUuid: source.candidate.descriptor.sourceUuid,
    sourceSnapshotChecksum: source.candidate.descriptor.sourceChecksum,
    reviewCopyIdOrNull: reviewCopyId,
    campaignCharacterIdOrNull,
    characterName: before.identity.name,
    beforeSheet: before,
    afterSheet: after,
    changes: admissionMechanicalChanges(before, after),
    blockers: admissionLobbyBlockers(after, reviewCopyId, campaignCharacterIdOrNull),
  };
  return admissionFullCopyDiffValue(result);
}

/** Fresh capacity and controller proofs are separate: they do not mutate this proposal. */
export function sealAdmissionProposal(body: AdmissionProposalBody): AdmissionProposal {
  const detached = structuredClone(body);
  return admissionProposalValue({
    ...detached,
    proposalChecksum: postSaveSha256(canonicalPostSaveJson(detached)),
  });
}

/** Both durable replays and incoming peer proposals require the same complete-byte binding. */
export function validateAdmissionProposal(value: unknown): AdmissionProposal {
  const proposal = admissionProposalValue(value);
  const { proposalChecksum, ...body } = proposal;
  if (postSaveSha256(canonicalPostSaveJson(body)) !== proposalChecksum)
    throw new Error('admission proposal: complete batch checksum differs');
  return proposal;
}

/** A persisted checksum alone cannot prove the sheet's source, rules or draft history. */
export function verifyAdmissionProposalSources(
  proposal: AdmissionProposal,
  inputs: readonly AdmissionCopyPublicationInput[],
  baseline: LocalCharacterExportBaseline,
  itemCatalog: FiveStartingPositionsCatalog,
): void {
  validateAdmissionProposal(proposal);
  const expected = inputs.map((input) => deriveAdmissionFullCopyDiff(input, baseline, itemCatalog));
  if (!isDeepStrictEqual(proposal.fullCampaignCopyDiffs, expected))
    throw new Error('admission proposal: published copies differ from verified sources and drafts');
}
