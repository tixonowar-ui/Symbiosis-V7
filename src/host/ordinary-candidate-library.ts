import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PublicCandidateRef } from '../shared/device-admission.js';
import type { OrdinarySeatControlV3Message, OrdinarySeatView } from '../shared/ordinary-seat.js';
import {
  NetworkApplicationStoreError,
  type LocalNetworkApplication,
} from '../persistence/network-local-application.js';
import type { LocalNetworkConnection } from './network-application.js';

type LibraryReturn = Extract<OrdinarySeatControlV3Message, { operation: 'RETURN_LIBRARY' }>;
type LibraryView = Extract<OrdinarySeatView, { ordinarySeatView: 'LIBRARY' }>;
interface LibrarySource {
  readonly application: LocalNetworkApplication;
  readonly candidates: readonly (PublicCandidateRef & { readonly name: string })[];
}
const unavailable = (): never => {
  throw new NetworkApplicationStoreError('UNAVAILABLE');
};

/** The signed route is ephemeral. Only the ordinary #171 selection persists on return. */
export function createOrdinaryCandidateLibrary(
  read: (connection: LocalNetworkConnection) => LibrarySource,
  commit: (
    connection: LocalNetworkConnection,
    request: LibraryReturn,
    refs: readonly PublicCandidateRef[],
    application: LocalNetworkApplication,
  ) => void,
) {
  const signingKey = randomBytes(32);
  const visits = new WeakMap<
    LocalNetworkConnection,
    { originRequestId: string; contextId: string | null; networkScopeId: string | null }
  >();
  function assertVisit(connection: LocalNetworkConnection, originRequestId: string) {
    const visit = visits.get(connection);
    if (
      !connection.trusted() ||
      !visit ||
      visit.originRequestId !== originRequestId ||
      visit.contextId !== connection.contextId ||
      visit.networkScopeId !== connection.networkScopeId
    )
      return unavailable();
  }
  function snapshot(connection: LocalNetworkConnection, originRequestId: string) {
    const { application, candidates } = read(connection);
    const selectedSourceUuids = application.selectedCandidates.map(
      (candidate) => candidate.sourceUuid,
    );
    if (
      !connection.trusted() ||
      connection.contextId === null ||
      connection.networkScopeId !== application.networkScopeId ||
      application.sessionOrNull === null ||
      application.formId !== 'NET-003' ||
      application.pendingCommandIdOrNull !== null ||
      selectedSourceUuids.some((id) => !candidates.some((candidate) => candidate.sourceUuid === id))
    )
      return unavailable();
    const context = createHmac('sha256', signingKey)
      .update(
        JSON.stringify([
          'PLAYER_LOCAL_LIBRARY_RETURN_V1',
          'PLAYER_LOCAL',
          'APP-003',
          'APP-004',
          'APP-003',
          originRequestId,
          connection.contextId,
          application.ownerDeviceId,
          application.networkScopeId,
          application.tabId,
          application.sessionOrNull.technicalSessionId,
          application.sessionOrNull.campaignProof.campaignId,
          application.stateRevision,
          application.projectionRevision,
          application.actorVisibilityRevision,
          application.draftRevision,
          candidates.map((c) => [
            c.sourceUuid,
            c.finalSnapshotVersion,
            c.metadataRevision,
            c.candidateSnapshotChecksum,
            c.name,
          ]),
          selectedSourceUuids,
        ]),
      )
      .digest();
    return { application, candidates, selectedSourceUuids, context };
  }
  return {
    open(connection: LocalNetworkConnection, originRequestId: string): LibraryView {
      const { application, candidates, selectedSourceUuids, context } = snapshot(
        connection,
        originRequestId,
      );
      visits.set(connection, {
        originRequestId,
        contextId: connection.contextId,
        networkScopeId: connection.networkScopeId,
      });
      return {
        ordinarySeatView: 'LIBRARY',
        revision: application.projectionRevision,
        libraryContext: context.toString('hex'),
        candidates: candidates.map(({ sourceUuid, name }) => ({ sourceUuid, name })),
        selectedSourceUuids,
      };
    },
    apply(connection: LocalNetworkConnection, originRequestId: string, request: LibraryReturn) {
      assertVisit(connection, originRequestId);
      if (
        request.selectedSourceUuids.length < 1 ||
        request.selectedSourceUuids.length > 3 ||
        new Set(request.selectedSourceUuids).size !== request.selectedSourceUuids.length
      )
        return unavailable();
      const { application, candidates, context } = snapshot(connection, originRequestId);
      const received = Buffer.from(request.libraryContext, 'hex');
      if (
        request.expectedProjectionRevision !== application.projectionRevision ||
        received.length !== context.length ||
        !timingSafeEqual(context, received)
      )
        return unavailable();
      const refs = request.selectedSourceUuids.map((id) => {
        const candidate = candidates.find((c) => c.sourceUuid === id) ?? unavailable();
        return {
          sourceUuid: id,
          finalSnapshotVersion: candidate.finalSnapshotVersion,
          metadataRevision: candidate.metadataRevision,
          candidateSnapshotChecksum: candidate.candidateSnapshotChecksum,
          requestedControllerSeat: application.tabId,
        };
      });
      commit(connection, request, refs, application);
      visits.delete(connection);
    },
    cancel(connection: LocalNetworkConnection, originRequestId: string) {
      assertVisit(connection, originRequestId);
      visits.delete(connection);
    },
  };
}
