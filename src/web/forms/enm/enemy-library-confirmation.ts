import type { JsonObject, RevisionVector } from '@shared/wire-protocol.js';
import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';
import {
  enemyLibraryProjectionValue,
  type EnemyLibrarySelectionRequest,
} from '@shared/enemy-library.js';
import { enemyAuthoringProjectionValue } from '@shared/enemy-authoring.js';

/** A technical ACK alone never confirms a choice: only its current, correlated owning projection does. */
export function enemyLibrarySelectionConfirmed(
  candidate: {
    readonly formId: string;
    readonly projection: JsonObject;
    readonly revisions: RevisionVector;
  },
  assignment: { readonly reason: string; readonly correlationId: string },
  request: EnemyLibrarySelectionRequest,
  acknowledged: boolean,
): boolean {
  if (
    !acknowledged ||
    candidate.formId !== request.sourceFormId ||
    assignment.reason !== 'FORM_ACTION' ||
    assignment.correlationId !== request.operationId
  )
    return false;
  try {
    if (request.sourceFormId === 'ENM-020') {
      const p = enemyAuthoringProjectionValue(candidate.projection);
      return (
        p.formId === 'ENM-020' &&
        p.contextId === request.contextId &&
        p.campaignId === request.campaignId &&
        request.selectionOrNull === null &&
        admissionJsonEqual(p.context.selectedVersionOrNull, request.userSelectionOrNull) &&
        admissionJsonEqual(p.versionHistory?.selected, request.userSelectionOrNull) &&
        (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).every(
          (key) => p[key] === candidate.revisions[key] && p[key] >= request.expectedRevisions[key],
        )
      );
    }
    const p = enemyLibraryProjectionValue(candidate.projection);
    return (
      p.formId === 'ENM-001' &&
      p.contextId === request.contextId &&
      p.campaignId === request.campaignId &&
      p.activeTab === request.activeTab &&
      admissionJsonEqual(p.selectedOrNull, request.selectionOrNull) &&
      admissionJsonEqual(p.userSelectionOrNull ?? null, request.userSelectionOrNull ?? null) &&
      (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).every(
        (key) => p[key] === candidate.revisions[key] && p[key] >= request.expectedRevisions[key],
      )
    );
  } catch {
    return false;
  }
}
