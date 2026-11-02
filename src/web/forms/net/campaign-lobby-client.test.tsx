import {
  admissionMechanicalChanges,
  admissionMechanicalSheetValue,
} from '@shared/campaign-admission-sheet.js';
import { admissionLobbyBlockers } from '@shared/campaign-admission-proposal.js';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import source from '../../../../tests/fixtures/campaign-lobby-owner.json';
import type { JsonObject, CommandReceipt } from '@shared/wire-protocol.js';
import {
  campaignLobbyGmProjectionValue,
  campaignLobbyPlayerProjectionValue,
  campaignPeaceProjectionValue,
  campaignLobbyPlayerActions,
  campaignLobbyGmActions,
} from '@shared/campaign-lobby-presentation.js';
import { admissionOwnerProjectionValue } from '@shared/campaign-admission-presentation.js';
import { admissionOwnerMonotonic, admissionOwnerActions } from './admission-client.js';
import {
  campaignOwnerMonotonic,
  lobbyReadyBrowserCommand,
  lobbyReadyBrowserReceipt,
  lobbyReadyDestination,
} from './admission-client.js';
import { CampaignLobbyFields, CampaignOwnerFields } from './admission-fields.js';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';

// Captured from network-application.test.ts: actual admitted FINAL, Ready, explicit time,
// Start and authenticated owner publication. No game sheet values are synthesized here.
const id = '00000000-0000-4000-8000-000000000173';
const asJson = (value: unknown) => value as JsonObject;
const supported = [
  'UI-CMD-CAMPAIGN-READY-SET',
  'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
  'UI-CMD-CAMPAIGN-START',
] as const;
type OwnerSnapshot = Omit<ConfirmedProjectionSnapshot, 'formId' | 'projection'> & {
  formId: 'NET-005' | 'NET-006' | 'NET-027' | 'PLY-001';
  projection: JsonObject;
};
function snapshot(formId: OwnerSnapshot['formId'], value: unknown): OwnerSnapshot {
  const projection = asJson(value),
    p = projection;
  return {
    formId,
    path: '/',
    projection,
    revisions: {
      stateRevision: Number(p['stateRevision']),
      projectionRevision: Number(p['projectionRevision']),
      actorVisibilityRevision: Number(p['actorVisibilityRevision']),
    },
    layers: [],
    availableActionKeys:
      formId === 'NET-006'
        ? campaignLobbyPlayerActions(campaignLobbyPlayerProjectionValue(p), supported)
        : [],
    executableWorkflowCommandIds: supported,
  };
}
const lobby = () => snapshot('NET-006', structuredClone(source.lobbySource));
const peace = () => snapshot('PLY-001', structuredClone(source.peace));
const advanced = (s: OwnerSnapshot) => ({
  ...s,
  revisions: {
    ...s.revisions,
    stateRevision: s.revisions.stateRevision + 1,
    projectionRevision: s.revisions.projectionRevision + 1,
  },
});
describe('closed #173 owner and shared GM projections', () => {
  it('validates actual source-backed admission, lobby, PEACE and both GM variants', () => {
    expect(() => admissionOwnerProjectionValue('NET-027', source.admissionSource)).not.toThrow();
    expect(() => campaignLobbyPlayerProjectionValue(source.lobbySource)).not.toThrow();
    expect(() => campaignPeaceProjectionValue(source.peace)).not.toThrow();
    for (const p of [source.gmBeforeStart, source.gmStarted])
      expect(() => campaignLobbyGmProjectionValue(p)).not.toThrow();
    expect(campaignOwnerMonotonic(peace(), lobby())).toBe(true);
    expect(campaignOwnerMonotonic(peace(), snapshot('NET-027', source.admissionSource))).toBe(true);
  });
  it.each([
    'combatId',
    'combatActor',
    'turn',
    'reactionWindow',
    'markerId',
    'markerRevision',
    'coordinates',
    'localLighting',
    'gmPrivateMetadata',
  ])('refuses an invented PEACE field %s', (key) => {
    expect(() => campaignPeaceProjectionValue({ ...source.peace, [key]: 0 })).toThrow();
  });
  it('refuses independently inconsistent GM roster/group/scene mirrors', () => {
    for (const mutate of [
      (p: typeof source.gmStarted) => {
        p.groups[0]!.members = [];
      },
      (p: typeof source.gmStarted) => {
        p.activeCampaignCharacters[0]!.groupId = id;
      },
      (p: typeof source.gmStarted) => {
        p.activePeaceSceneOrNull.includedCopies[0]!.controller.deviceId = id;
      },
      (p: typeof source.gmStarted) => {
        p.activePeaceSceneOrNull.campaignTimestamp++;
      },
      (p: typeof source.gmStarted) => {
        p.admissionBatches[0]!.campaignCharacterIds = [];
      },
    ]) {
      const p = structuredClone(source.gmStarted);
      mutate(p);
      expect(() => campaignLobbyGmProjectionValue(p)).toThrow();
    }
  });
  it('refuses a valid-shape sibling identity, sheet, group or location on entry to PEACE', () => {
    for (const mutate of [
      (p: typeof source.peace) => {
        p.campaignCharacterId = id;
        p.effectiveController.campaignCharacterId = id;
      },
      (p: typeof source.peace) => {
        p.mechanicalSheet.identity.name = 'Different admitted character';
      },
      (p: typeof source.peace) => {
        p.groupId = id;
      },
      (p: typeof source.peace) => {
        p.location.location = 'Changed assignment';
        p.mechanicalSheet.locationAssignmentOrNull.location = 'Changed assignment';
      },
    ]) {
      const p = structuredClone(source.peace);
      mutate(p);
      expect(() => campaignPeaceProjectionValue(p)).not.toThrow();
      expect(campaignOwnerMonotonic(snapshot('PLY-001', p), lobby())).toBe(false);
    }
  });
  it('refuses a first blocked proposal entering PEACE before an ACCEPT receipt', () => {
    const before = structuredClone(source.admissionSource),
      proposal = before.publication.proposalOrNull,
      diff = proposal.fullCampaignCopyDiffs[0]!;
    // Only an explicit review decision is changed; all mechanical values remain source-backed.
    diff.afterSheet.massReview.decision = 'PENDING_MASTER_APPROVAL';
    const after = admissionMechanicalSheetValue(diff.afterSheet);
    Object.assign(diff, {
      changes: admissionMechanicalChanges(admissionMechanicalSheetValue(diff.beforeSheet), after),
      blockers: admissionLobbyBlockers(
        after,
        diff.reviewCopyIdOrNull,
        diff.campaignCharacterIdOrNull,
      ),
    });
    proposal.blockers = proposal.fullCampaignCopyDiffs.flatMap((d) => d.blockers);
    before.fullCampaignCopyDiffs = proposal.fullCampaignCopyDiffs;
    before.blockers = proposal.blockers;
    expect(before.receiptOrNull).toBeNull();
    expect(proposal.blockers.length).toBeGreaterThan(0);
    expect(() => admissionOwnerProjectionValue('NET-027', before)).not.toThrow();
    const forged = { ...source.peace, mechanicalSheet: after };
    expect(() => campaignPeaceProjectionValue(forged)).not.toThrow();
    expect(campaignOwnerMonotonic(snapshot('PLY-001', forged), snapshot('NET-027', before))).toBe(
      false,
    );
  });
  it('requires the same request on a skipped NET-005 owner update', () => {
    const p = source.lobbySource;
    const before = {
      ...snapshot('NET-005', {
        ...p,
        campaignIdOrNull: p.campaignId,
        requestId: p.requestIdOrNull,
        requestStatus: 'IN_REVIEW',
      }),
      revisions: {
        stateRevision: p.stateRevision - 1,
        projectionRevision: p.projectionRevision - 1,
        actorVisibilityRevision: p.actorVisibilityRevision,
      },
    };
    expect(admissionOwnerMonotonic(lobby(), before)).toBe(true);
    expect(admissionOwnerMonotonic(peace(), before)).toBe(true);
    expect(
      admissionOwnerMonotonic(lobby(), {
        ...before,
        projection: { ...before.projection, requestId: id },
      }),
    ).toBe(false);
  });
  it('permits only context replacement on quiet reconnect, never scene or revision rollback', () => {
    const before = peace(),
      next = {
        ...before,
        projection: { ...before.projection, contextId: id, technicalSessionAvailable: false },
      };
    expect(campaignOwnerMonotonic(next, before, true)).toBe(true);
    expect(campaignOwnerMonotonic(next, before, false)).toBe(false);
    expect(campaignOwnerMonotonic(advanced(lobby()), before, true)).toBe(false);
    expect(
      campaignOwnerMonotonic(
        { ...next, revisions: { ...next.revisions, stateRevision: 0 } },
        before,
        true,
      ),
    ).toBe(false);
    expect(
      campaignOwnerMonotonic(
        { ...advanced(next), projection: { ...next.projection, sceneId: id } },
        before,
        true,
      ),
    ).toBe(false);
    const old = lobby(),
      regressed = advanced(old);
    regressed.projection = {
      ...old.projection,
      lobby: {
        ...source.lobbySource.lobby,
        readinessRevision: source.lobbySource.lobby.readinessRevision - 1,
      },
    };
    expect(campaignOwnerMonotonic(regressed, old)).toBe(false);
  });
});
describe('Ready control and immutable receipt correlation', () => {
  it('keeps only historical return actions on HOSTING owner panels', () => {
    const p = {
      ...source.admissionSource,
      campaignStatus: 'HOSTING',
      startStatus: 'STARTED',
      technicalSessionAvailable: true,
    };
    expect(() => admissionOwnerProjectionValue('NET-027', p)).not.toThrow();
    expect(admissionOwnerActions('NET-027', asJson(p), ['UI-CMD-ADMISSION-PLAYER-DECIDE'])).toEqual(
      [],
    );
    expect(
      admissionOwnerActions('NET-027', asJson({ ...p, decision: 'ACCEPT' }), supported),
    ).toEqual(['NET-027::CTA::001']);
    expect(
      admissionOwnerActions('NET-027', asJson({ ...p, decision: 'DECLINE' }), supported),
    ).toEqual(['NET-027::CTA::002']);
    expect(admissionOwnerActions('NET-007', asJson(p), supported)).toEqual([
      'NET-007::CTA::001',
      'NET-007::CTA::003',
    ]);
  });
  function command() {
    const before = lobby(),
      request = lobbyReadyBrowserCommand(before, 'NET-006::CTA::003', id);
    const receipt: CommandReceipt = {
      commandId: id,
      receiptId: id,
      revisions: {
        ...before.revisions,
        stateRevision: before.revisions.stateRevision + 2,
        projectionRevision: before.revisions.projectionRevision + 2,
      },
      result: {
        operation: 'CAMPAIGN_READY_SET',
        networkScopeId: source.lobbySource.networkScopeId,
        remoteReceipt: {
          receiptId: id,
          commandId: id,
          campaignId: source.lobbySource.campaignId,
          lobbySnapshotRevision: source.lobbySource.lobby.lobbySnapshotRevision,
          readinessRevision: source.lobbySource.lobby.readinessRevision + 1,
          committedAt: '2026-11-02T00:00:00.000Z',
          workflowCommandId: 'UI-CMD-CAMPAIGN-READY-SET',
          ownerDeviceId: source.lobbySource.deviceId,
          includedCampaignCharacterIds: source.lobbySource.lobby.includedCampaignCharacterIds,
          ready: true,
        },
      },
    };
    return { before, request, receipt };
  }
  it('sends only the authorized campaign/snapshot/boolean and refuses unavailable Ready', () => {
    const { before, request } = command();
    expect(request.payload).toEqual({
      campaignId: source.lobbySource.campaignId,
      expectedLobbySnapshotRevision: source.lobbySource.lobby.lobbySnapshotRevision,
      ready: true,
    });
    expect(() =>
      lobbyReadyBrowserCommand({ ...before, availableActionKeys: [] }, 'NET-006::CTA::003', id),
    ).toThrow();
    const p = campaignLobbyPlayerProjectionValue(source.lobbySource);
    expect(campaignLobbyPlayerActions({ ...p, pendingCommandIdOrNull: id }, supported)).toEqual([]);
    expect(
      campaignLobbyPlayerActions({ ...p, technicalSessionAvailable: false }, supported),
    ).toEqual(['NET-006::CTA::001']);
    expect(
      campaignLobbyGmActions(
        'NET-016',
        {
          ...campaignLobbyGmProjectionValue(source.gmBeforeStart),
          conflictingOperationPending: true,
        },
        supported,
      ),
    ).toEqual([]);
  });
  it('binds receipt to the original whole device set and keeps a stale ACK destination pending', () => {
    const { before, request, receipt } = command();
    expect(lobbyReadyBrowserReceipt(receipt, request, before)).toEqual(receipt);
    const changed = {
      ...receipt,
      result: {
        ...receipt.result,
        remoteReceipt: {
          ...(receipt.result['remoteReceipt'] as JsonObject),
          includedCampaignCharacterIds: [id],
        },
      },
    };
    expect(() => lobbyReadyBrowserReceipt(changed, request, before)).toThrow();
    const stale = {
      ...advanced(before),
      revisions: receipt.revisions,
      projection: { ...before.projection, pendingCommandIdOrNull: id },
    };
    expect(
      lobbyReadyDestination(stale, request, before, receipt, false, source.lobbySource.contextId),
    ).toBe(false);
    expect(
      lobbyReadyDestination(peace(), request, before, receipt, false, source.lobbySource.contextId),
    ).toBe(true);
  });
  it('accepts replay before a later read-only NET-027 without casting it to lobby', () => {
    const { before, request, receipt } = command();
    const old = structuredClone(source.admissionSource) as unknown as JsonObject;
    const accepted = asJson(source.admissionReceipt)['receipt'] as JsonObject;
    const remote = (accepted['result'] as JsonObject)['remoteReceipt'] as JsonObject;
    Object.assign(old, {
      receiptOrNull: remote,
      ownCampaignCopies: remote['copies'],
      controllerBindings: (remote['controllerProofOrNull'] as JsonObject)['controllerBindings'],
      campaignRevisionOrNull: remote['campaignRevision'],
      decision: 'ACCEPT',
      decisionReceiptId: remote['receiptId'],
      result: 'PLAYER_ACCEPTED',
      pendingCommandIdOrNull: null,
    });
    // Build the current legacy panel from the real original receipt, then let its closed
    // validator determine whether a field was omitted; no arbitrary sheet is accepted.
    const later = {
      ...snapshot('NET-027', old),
      revisions: {
        ...receipt.revisions,
        stateRevision: receipt.revisions.stateRevision + 1,
        projectionRevision: receipt.revisions.projectionRevision + 1,
      },
    };
    expect(() => admissionOwnerProjectionValue('NET-027', old)).not.toThrow();
    expect(lobbyReadyDestination(later, request, before, receipt, true, id)).toBe(true);
  });
});
describe('visible #173 fields', () => {
  it('renders empty explicit time inputs and no file picker in the shared GM panel', () => {
    const root = document.createElement('div');
    root.innerHTML = renderToStaticMarkup(
      <CampaignLobbyFields
        formId="NET-016"
        projection={asJson(source.gmBeforeStart)}
        onTimeChange={() => {}}
      />,
    );
    const inputs = [...root.querySelectorAll('input')];
    expect(inputs).toHaveLength(3);
    expect(inputs.every((input) => input.value === '')).toBe(true);
    expect(root.querySelector('input[type="file"]')).toBeNull();
  });
  it('shows the committed owner sheet, actual time/location and explicit absent map/combat context', () => {
    const html = renderToStaticMarkup(
      <CampaignOwnerFields formId="PLY-001" projection={asJson(source.peace)} />,
    );
    expect(html).toContain('День 2');
    expect(html).toContain('21:07');
    expect(html).toContain('Лагерь');
    expect(html).toContain('Маркер на карте не задан. Боевой контекст отсутствует.');
    expect(html).toContain(source.peace.mechanicalSheet.identity.name);
    expect(html).not.toMatch(/markerRevision|combatActor|gmPrivate|campaignCharacterId/);
  });
});
