import type { HostedRequestReviewCurrent } from '../persistence/network-device-request.js';
import type { AdmissionPublicationRules } from '../persistence/campaign-admission-decision.js';
import type { AdmissionReviewRead } from '../persistence/campaign-admission-review.js';
import {
  validateFinalAdmissionReviewSource,
  type ValidatedFinalAdmissionReviewSource,
} from './device-admission-candidate.js';
import {
  canonicalPostSaveJson,
  postSaveSha256,
  resolveStoredLocalCharacterExportBaseline,
  localCreationRandomReceipts,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import { canonicalFiveStartingPositionsCatalog } from './five-starting-positions-catalog.js';
import { canonicalWeaponProfileCatalog } from './weapon-profile-catalog.js';
import {
  admissionReviewPublicationInputs,
  applyAdmissionReviewMutation,
  createAdmissionReviewState,
  verifyInitialAdmissionReviewState,
} from './campaign-admission-review.js';
import {
  deriveAdmissionFullCopyDiff,
  deriveAdmissionReviewMechanicalSheets,
  sealAdmissionProposal,
} from './campaign-admission-proposal.js';
import { deriveAdmissionSourceProperties } from './campaign-admission-inventory.js';
import {
  admissionUnresolvedWeapons,
  admissionWeaponTemplateId,
  deriveAdmissionWeaponResolution,
} from './campaign-admission-weapon.js';
import type { AdmissionWeaponResolutionInput } from '../shared/campaign-admission.js';
import { projectAdmissionWeaponProfile } from './campaign-admission-mechanics.js';
import { recommendArmorQuality } from '../domain/rules/item-stage/armor-bundle.js';
import { wireCodecPrimitives } from '../shared/wire-codec.js';
import { admissionPendingReviewBlockers } from '../shared/campaign-admission-proposal.js';
import {
  admissionExistingGroupIds,
  type AdmissionFullCopyDiff,
  type AdmissionGroupLabel,
} from '../shared/campaign-admission-proposal.js';
import type { AdmissionGroup } from '../persistence/campaign-admission-player.js';

/** Only assignments in the frozen sheets may disclose names from the verified campaign history. */
export function admissionSelectedGroupLabels(
  diffs: readonly AdmissionFullCopyDiff[],
  groups: readonly AdmissionGroup[],
): readonly AdmissionGroupLabel[] {
  return admissionExistingGroupIds(diffs).map((groupId) => {
    const group = groups.find((group) => group.groupId === groupId);
    if (group === undefined) throw new Error('Selected admission group is missing');
    if (group.origin !== 'START' && group.nameOrNull === null)
      throw new Error('Admission group name is missing');
    return { groupId, name: group.origin === 'START' ? 'Стартовая группа' : group.nameOrNull! };
  });
}

/** Operation-local cache keyed by complete immutable source bytes; rules still check the current baseline. */
export function createCampaignAdmissionRules(
  baseline: LocalCharacterExportBaseline,
  maxWitnessBytes: number,
) {
  const catalogs = {
    baseline,
    items: canonicalFiveStartingPositionsCatalog(),
    weapons: canonicalWeaponProfileCatalog(),
  };
  const verified = new Map<string, readonly ValidatedFinalAdmissionReviewSource[]>();
  const sources = (request: HostedRequestReviewCurrent) => {
    const { batch, principal } = request.submittedRequest,
      owner = principal.peerIdentity.ownerDeviceId;
    for (const candidate of batch.candidates)
      resolveStoredLocalCharacterExportBaseline(baseline, candidate.descriptor.baselineVersion);
    const key = postSaveSha256(canonicalPostSaveJson({ owner, candidates: batch.candidates }));
    let result = verified.get(key);
    if (result === undefined) {
      result = batch.candidates.map((candidate) =>
        validateFinalAdmissionReviewSource(
          candidate.canonicalWitnessText,
          owner,
          candidate.descriptor,
          candidate.exportDocument,
          baseline,
          { maxWitnessBytes },
        ),
      );
      verified.set(key, result);
    }
    return result;
  };
  const rules: AdmissionPublicationRules = {
    verifyInitial: (request, state) => verifyInitialAdmissionReviewState(state, sources(request)),
    reduce: (request, before, mutation, receiptId) =>
      applyAdmissionReviewMutation(before, sources(request), mutation, receiptId, catalogs),
    buildProposal: (review, identities) => {
      const ids = identities.every((id) => id === null)
        ? null
        : identities.map((id) => {
            if (id === null)
              throw new Error('admission publication: mixed preview and final identities');
            return id;
          });
      const inputs = admissionReviewPublicationInputs(review.current, sources(review.request), ids),
        fullCampaignCopyDiffs = inputs.map((input) =>
          deriveAdmissionFullCopyDiff(input, baseline, catalogs.items),
        );
      return sealAdmissionProposal({
        campaignId: review.source.scope.campaignId,
        admissionBatchId: review.current.admissionBatchId,
        admissionOrigin: 'DEVICE_REQUEST',
        ownerProvenance: {
          kind: 'DEVICE_REQUEST',
          requestId: review.current.requestId,
          requestOwnerDeviceId: review.open.receipt.requestOwnerDeviceId,
        },
        reviewRevision: review.current.reviewRevision,
        proposalRevision: 1,
        fullCampaignCopyDiffs,
        blockers: fullCampaignCopyDiffs.flatMap((copy) => copy.blockers),
      });
    },
  };
  return {
    rules,
    catalogs: {
      items: catalogs.items.entries
        .filter((item) => item.kind === 'CATALOGUE')
        .map((item) => ({ itemTypeId: item.itemTypeIdOrStoryType, name: item.name })),
      skills: baseline.skillCatalog.selectableSkills,
      weaponVariants: catalogs.weapons.entries.map((entry) => ({
        weaponTypeId: entry.weaponTypeId,
        weaponVariantId: entry.weaponVariant,
        name: entry.name,
        variantLabel: entry.variantLabel,
      })),
      qualities: [
        ...new Set(Array.from({ length: 20 }, (_, i) => recommendArmorQuality(i + 1).label)),
      ],
      weaponTemplates: catalogs.weapons.entries
        .filter((entry) => entry.profileKind === 'FIXED')
        .map((entry) => ({
          templateId: admissionWeaponTemplateId(entry),
          profile: projectAdmissionWeaponProfile(entry.template),
        })),
    },
    weaponPreview: (
      review: AdmissionReviewRead,
      reviewCopyId: string,
      input: AdmissionWeaponResolutionInput,
    ) => {
      const index = review.current.copies.findIndex((copy) => copy.reviewCopyId === reviewCopyId),
        copy = review.current.copies[index],
        source = sources(review.request)[index];
      if (copy === undefined || source === undefined)
        throw new Error('admission weapon: unknown review copy');
      const requested = input.weaponReviewInput;
      const known = copy.weaponDecisions.find((decision) => {
        const prior = decision.input.weaponReviewInput;
        return requested.kind === 'VALIDATED_REQUEST'
          ? prior.kind === 'VALIDATED_REQUEST' && prior.requestId === requested.requestId
          : prior.kind === 'ADMISSION_GRANT' && prior.reviewItemId === requested.reviewItemId;
      });
      if (known !== undefined) {
        if (canonicalPostSaveJson(known.input) !== canonicalPostSaveJson(input))
          throw new Error('admission weapon: changed terminal staged decision');
        return {
          beforeProfileOrNull: known.beforeProfileOrNull,
          afterProfile: known.afterProfile,
          reasonOrNull: known.reasonOrNull,
        };
      }
      const result = deriveAdmissionWeaponResolution(
        source,
        catalogs.weapons,
        copy.reviewItemIdentities,
        copy.inputs,
        input,
      );
      // A preview does not allocate a receipt. Only the mechanics cross to the renderer.
      return {
        beforeProfileOrNull:
          result.beforeProfileOrNull === null
            ? null
            : projectAdmissionWeaponProfile(result.beforeProfileOrNull),
        afterProfile: projectAdmissionWeaponProfile(result.afterProfile),
        reasonOrNull: result.reasonOrNull,
      };
    },
    /** Private projection input: never export the validated checkpoints or their witnesses. */
    reviewPresentation: (review: AdmissionReviewRead) => {
      const originals = sources(review.request);
      const copies = review.current.copies.map((copy, index) => {
        const source = originals[index];
        if (
          source === undefined ||
          originals.length !== review.current.copies.length ||
          source.candidate.descriptor.sourceUuid !== copy.sourceUuid ||
          source.candidate.descriptor.sourceSnapshotId !== copy.sourceSnapshotId ||
          source.candidate.descriptor.sourceChecksum !== copy.snapshotChecksum
        )
          throw new Error('admission presentation: immutable source order differs');
        const mechanical = deriveAdmissionReviewMechanicalSheets(
          source,
          baseline,
          copy.inputs,
          copy.reviewItemIdentities,
        );
        const descriptor = source.candidate.descriptor;
        const properties = deriveAdmissionSourceProperties(source);
        const unresolvedWeapons = admissionUnresolvedWeapons(
          properties,
          copy.inputs.inventoryReview,
          copy.weaponDecisions,
        );
        const missing = [
          ...(copy.inputs.groupAssignmentOrNull === null ? ['GROUP_REQUIRED'] : []),
          ...(copy.inputs.locationAssignmentOrNull === null ? ['LOCATION_REQUIRED'] : []),
          ...unresolvedWeapons.requestIds.map(() => 'WEAPON_REQUEST_REQUIRED'),
          ...unresolvedWeapons.reviewItemIds.map(() => 'WEAPON_PROFILE_REQUIRED'),
        ];
        return {
          reviewCopyId: copy.reviewCopyId,
          sourceUuid: copy.sourceUuid,
          sourceSnapshotId: copy.sourceSnapshotId,
          snapshotChecksum: copy.snapshotChecksum,
          ...mechanical,
          inputs: structuredClone(copy.inputs),
          blockers: admissionPendingReviewBlockers(copy.inputs, copy.reviewCopyId),
          provenance: {
            registryVersion: baseline.registryVersion,
            catalogVersion: baseline.catalogVersion,
            builtAgainstTuple: baseline.builtAgainstTuple,
            sourceUuid: descriptor.sourceUuid,
            sourceSnapshotId: descriptor.sourceSnapshotId,
            sourceChecksum: descriptor.sourceChecksum,
            metadataRevision: descriptor.metadataRevision,
            finalSnapshotVersion: descriptor.finalSnapshotVersion,
          },
          naturalRolls: localCreationRandomReceipts(source.checkpoint),
          reviewItemIdentities: structuredClone(copy.reviewItemIdentities),
          weaponRequests: properties.flatMap((property) => {
            if (property.weaponRequestOrNull === null) return [];
            const stage = source.checkpoint.weaponProfileStage,
              proof = stage?.records.at(-1)?.proofOrNull;
            if (stage?.kind !== 'FORMULA' || proof == null)
              throw new Error('admission presentation: validated request proof is missing');
            const witness = wireCodecPrimitives.record(proof['commonWitness'], '$.commonWitness');
            const witnessNumber = (key: string): number => {
              const value = witness[key];
              if (typeof value !== 'number' || !Number.isFinite(value))
                throw new Error('admission presentation: validated witness number is missing');
              return value;
            };
            return [
              {
                ...property.weaponRequestOrNull,
                proposedWeaponProfile: property.weaponProfileOrNull,
                commonWitness: {
                  L: witnessNumber('L'),
                  Lw: witnessNumber('Lw'),
                  Ls: witnessNumber('Ls'),
                },
                decisionOrNull:
                  copy.weaponDecisions.find((decision) => {
                    const input = decision.input.weaponReviewInput;
                    return (
                      input.kind === 'VALIDATED_REQUEST' &&
                      input.requestId === property.weaponRequestOrNull?.requestId
                    );
                  }) ?? null,
              },
            ];
          }),
          unresolvedWeapons,
          missing,
        };
      });
      return {
        copies,
        proposalOrNull: copies.every((copy) => copy.missing.length === 0)
          ? rules.buildProposal(
              review,
              copies.map(() => null),
            )
          : null,
      };
    },
    initial: (request: HostedRequestReviewCurrent, allocateId: () => string) =>
      createAdmissionReviewState(sources(request), request.submittedRequest.requestId, allocateId),
  };
}
