import type { ActionKey } from '@generated/types/atlas.js';
import type { HostSeatRecipient, HostSeatView } from '../shared/host-seat.js';
import type { HostLocalSeatTarget } from '../persistence/host-local-seat.js';
import type { RevisionVector } from '../shared/wire-protocol.js';
import type {
  PresentationAssignmentReason,
  PresentedLayerForm,
  ProjectionSnapshotV2Message,
} from '../shared/wire-v2-protocol.js';

export const hostSeatVector = (revision: number): RevisionVector => ({
  stateRevision: revision,
  projectionRevision: revision,
  actorVisibilityRevision: revision,
});
export function hostSeatRecipient(t: HostLocalSeatTarget): HostSeatRecipient {
  if (t.kind === 'GM') return { kind: 'GM' };
  if (t.kind === 'PLAYER')
    return { kind: 'PLAYER', ...t.profile, localControllerSeatId: t.localControllerSeatId };
  return { kind: 'CANDIDATE', ...t.profile };
}
export function hostSeatLayer(
  formId: 'PLY-027' | 'PLY-028' | 'PLY-029' | 'PLY-030',
  view: HostSeatView,
  availableActionKeys: readonly ActionKey[],
): PresentedLayerForm {
  return {
    formId,
    formType: 'component',
    routeTemplate: '@component/' + formId.toLowerCase(),
    routeBindings: [],
    roleFilteredPayload: view,
    availableActionKeys,
  };
}
export function hostSeatSnapshot(
  view: HostSeatView,
  correlationId: string,
  reason: PresentationAssignmentReason,
  actions: readonly ActionKey[] = [],
): ProjectionSnapshotV2Message {
  const overlay =
    view.hostSeatView === 'CURTAIN'
      ? 'PLY-030'
      : view.hostSeatView === 'ROSTER'
        ? 'PLY-028'
        : view.hostSeatView === 'GM_ONLY' || view.hostSeatView === 'SWITCH'
          ? 'PLY-027'
          : null;
  const manage = view.hostSeatView === 'MANAGE';
  return {
    messageType: 'projection.snapshot',
    protocolVersion: 2,
    projectionRole: manage || view.hostSeatView === 'SETUP' ? 'gm' : 'player',
    revisions: hostSeatVector(view.revision),
    presentation: {
      assignment: { correlationId, reason },
      base: manage
        ? {
            formId: 'CMP-009',
            formType: 'screen',
            routeTemplate: '/master/campaigns/:campaignId/campaign/cmp-009',
            routeBindings: [{ parameterIndex: 0, source: 'inherited', value: view.campaignId }],
            roleFilteredPayload: view,
            availableActionKeys: actions,
          }
        : {
            formId: 'APP-003',
            formType: 'screen',
            routeTemplate: '/local/app-003',
            routeBindings: [],
            roleFilteredPayload:
              overlay === null ? view : { hostSeatView: 'WAITING', revision: view.revision },
            availableActionKeys: overlay === null ? actions : [],
          },
      layers: overlay === null ? [] : [hostSeatLayer(overlay, view, actions)],
    },
  };
}
