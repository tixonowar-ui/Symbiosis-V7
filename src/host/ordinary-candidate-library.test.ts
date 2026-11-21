import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ordinarySeatControlValue,
  ordinarySeatViewValue,
  type OrdinarySeatControlV3Message,
} from '../shared/ordinary-seat.js';
import type { LocalNetworkApplication } from '../persistence/network-local-application.js';
import type { LocalNetworkConnection } from './network-application.js';
import { createOrdinaryCandidateLibrary } from './ordinary-candidate-library.js';

function libraryFixture() {
  const networkScopeId = randomUUID(),
    tabId = randomUUID(),
    origin = randomUUID();
  const revisions = { projectionRevision: 8, stateRevision: 4, actorVisibilityRevision: 2 };
  const initial: LocalNetworkApplication = {
    schemaVersion: 1,
    ownerDeviceId: randomUUID(),
    networkScopeId,
    tabId,
    formId: 'NET-003',
    ...revisions,
    draftRevision: 1,
    addressOrQrPayload: '',
    cancelReason: '',
    selectedCandidates: [],
    selectedCampaignIdOrNull: null,
    requestedControllerSeatOrNull: null,
    plannedAttemptIdOrNull: null,
    lastAttemptIdOrNull: null,
    preparedBatchOrNull: null,
    pendingCommandIdOrNull: null,
    diagnosticCodeOrNull: null,
    shellExitOrNull: null,
    requestOrNull: null,
    sessionOrNull: {
      technicalSessionId: randomUUID(),
      attemptId: randomUUID(),
      receiptId: randomUUID(),
      connectionRevision: 0,
      campaignProof: { campaignId: randomUUID(), checkpointSha256: 'a'.repeat(64), revisions },
    },
  };
  const candidates = ['First', 'Second', 'Third', 'Fourth'].map((name) => ({
    sourceUuid: randomUUID(),
    name,
    finalSnapshotVersion: 1,
    metadataRevision: 2,
    candidateSnapshotChecksum: 'b'.repeat(64),
    requestedControllerSeat: tabId,
  }));
  const source = { application: initial, candidates };
  const connection: LocalNetworkConnection = {
    networkScopeId,
    contextId: randomUUID(),
    executableWorkflowCommandIds: [],
    trusted: () => true,
  };
  const write = vi.fn();
  const library = createOrdinaryCandidateLibrary(() => source, write);
  const view = library.open(connection, origin);
  const request: Extract<OrdinarySeatControlV3Message, { operation: 'RETURN_LIBRARY' }> = {
    messageType: 'ordinary.seat.control',
    protocolVersion: 3,
    operation: 'RETURN_LIBRARY',
    requestId: randomUUID(),
    expectedProjectionRevision: view.revision,
    libraryContext: view.libraryContext,
    selectedSourceUuids: candidates.slice(0, 3).map((candidate) => candidate.sourceUuid),
  };
  return { connection, library, request, view, origin, source, write };
}

describe('ordinary pre-admission owner library', () => {
  it('projects only owner candidate names and IDs and returns exactly the chosen FINAL versions to the original draft', () => {
    const f = libraryFixture();
    expect(ordinarySeatViewValue(f.view)).toEqual(f.view);
    expect(f.view.candidates).toEqual(
      f.source.candidates.map(({ sourceUuid, name }) => ({ sourceUuid, name })),
    );
    expect(ordinarySeatControlValue(f.request)).toEqual(f.request);
    f.library.apply(f.connection, f.origin, f.request);
    expect(() => f.library.apply(f.connection, f.origin, f.request)).toThrow();
    expect(f.write).toHaveBeenCalledExactlyOnceWith(
      f.connection,
      f.request,
      f.source.candidates.slice(0, 3).map((c) => ({
        sourceUuid: c.sourceUuid,
        finalSnapshotVersion: c.finalSnapshotVersion,
        metadataRevision: c.metadataRevision,
        candidateSnapshotChecksum: c.candidateSnapshotChecksum,
        requestedControllerSeat: f.source.application.tabId,
      })),
      f.source.application,
    );
  });
  it('rejects a foreign socket, route, FINAL, fourth member, duplicate, changed checksum or stale source before writing', () => {
    const f = libraryFixture();
    expect(() =>
      f.library.apply({ ...f.connection, contextId: randomUUID() }, f.origin, f.request),
    ).toThrow();
    expect(() => f.library.apply(f.connection, randomUUID(), f.request)).toThrow();
    expect(() =>
      f.library.apply(f.connection, f.origin, {
        ...f.request,
        selectedSourceUuids: [randomUUID()],
      }),
    ).toThrow();
    for (const selectedSourceUuids of [
      [],
      [...f.request.selectedSourceUuids, randomUUID()],
      [f.request.selectedSourceUuids[0], f.request.selectedSourceUuids[0]],
    ])
      expect(() => ordinarySeatControlValue({ ...f.request, selectedSourceUuids })).toThrow();
    expect(() => ordinarySeatViewValue({ ...f.view, candidates: f.source.candidates })).toThrow();
    expect(() =>
      f.library.apply(f.connection, f.origin, {
        ...f.request,
        expectedProjectionRevision: f.request.expectedProjectionRevision - 1,
      }),
    ).toThrow();
    f.source.candidates[0]!.candidateSnapshotChecksum = 'c'.repeat(64);
    expect(() => f.library.apply(f.connection, f.origin, f.request)).toThrow();
    expect(f.write).not.toHaveBeenCalled();
    f.library.cancel(f.connection, f.origin);
    expect(() => f.library.cancel(f.connection, f.origin)).toThrow();
  });
});
