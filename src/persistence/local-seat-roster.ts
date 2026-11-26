import type Database from 'better-sqlite3';
import type { AdmissionFullCopyDiff } from '@shared/campaign-admission-proposal.js';
import { localAdmissionTabStorage, readOwnedLocalNetworkTabAnchor } from './network-local-tab.js';
import {
  localLobbyState,
  readLocalAdmissionPresentation,
  type LocalAdmissionRead,
} from './local-campaign-admission.js';
import { networkApplicationStorage as s } from './network-local-application.js';
import { readHostLocalCharacterOwner, readHostLocalScopeOwner } from './host-local-seat.js';

export interface OrdinarySeatBinding {
  readonly localControllerSeatId: string;
  readonly networkScopeId: string;
  readonly campaignId: string;
  readonly campaignCharacterId: string;
  readonly admissionReceiptId: string;
}
export interface OrdinaryActiveSeat extends OrdinarySeatBinding {
  readonly targetContextId: string;
  readonly sceneId: string;
  readonly handoffId: string;
  readonly handoffReceiptId: string;
  readonly name: string;
  readonly sheet: AdmissionFullCopyDiff['afterSheet'];
}

/** Only the receiver of the authenticated #172 decision has this publication + tab history.
 * UNBOUND also describes real extra prepared tabs, so tab lifecycle alone is never proof. */
export function admittedOrdinarySeats(
  db: Database.Database,
  owner: string,
  inspect?: (binding: OrdinarySeatBinding, admission: LocalAdmissionRead) => void,
  hostLocal = false,
) {
  const rows = db
    .prepare<[string], { network_scope_id: string }>(
      'SELECT network_scope_id FROM local_network_tab WHERE owner_device_id=? AND retirement_command_id IS NULL ORDER BY rowid LIMIT 4',
    )
    .all(owner);
  if (rows.length > 3) return s.fail('UNAVAILABLE');
  const tabs = rows.map(({ network_scope_id }) => {
    const tab = readOwnedLocalNetworkTabAnchor(db, owner, network_scope_id) ?? s.fail();
    const entry = localAdmissionTabStorage.entryAnchor(db, owner, tab.entryCommandId) ?? s.fail();
    return { tab, entry };
  });
  const result: { binding: OrdinarySeatBinding; diff: AdmissionFullCopyDiff }[] = [];
  const provenExtras = new Set<string>();
  for (const { tab, entry } of tabs) {
    if (entry.request.admissionEntry !== undefined) continue;
    const admission = readLocalAdmissionPresentation(db, {
      ownerDeviceId: owner,
      networkScopeId: tab.networkScopeId,
    })?.admission;
    if (!admission) continue;
    for (const extra of admission.additionalTabs) provenExtras.add(extra.tabId);
    const receipt = admission.receiptOrNull;
    if (receipt?.decision !== 'ACCEPT' || admission.returnedOrNull !== null) continue;
    const sameInstallation = admission.record.hostIdentity.ownerDeviceId === owner;
    const profileOwnerId = sameInstallation
      ? readHostLocalScopeOwner(db, owner, tab.networkScopeId)
      : null;
    if (
      (sameInstallation && !profileOwnerId) ||
      receipt.requestOwnerDeviceId !== owner ||
      receipt.copies.length !== admission.additionalTabs.length + 1
    )
      return s.fail('FOREIGN_OWNER');
    const batchTabs = [tab, ...admission.additionalTabs];
    for (const [index, copy] of receipt.copies.entries()) {
      const controller = copy.controllerBindingOrNull;
      const bound = batchTabs[index]!;
      const diff = admission.record.publication.proposalOrNull?.fullCampaignCopyDiffs[index];
      if (
        !copy.occupiesCampaignPlace ||
        !controller ||
        controller.deviceId !== owner ||
        controller.inputLaneId !== bound.tabId ||
        controller.localControllerSeatId !== bound.tabId ||
        controller.campaignCharacterId !== copy.campaignCharacterId ||
        diff?.campaignCharacterIdOrNull !== copy.campaignCharacterId ||
        (profileOwnerId !== null &&
          readHostLocalCharacterOwner(db, owner, diff.sourceUuid) !== profileOwnerId) ||
        !tabs.some(
          (t) => t.tab.tabId === bound.tabId && t.tab.networkScopeId === bound.networkScopeId,
        ) ||
        result.some(
          ({ binding }) =>
            binding.campaignCharacterId === copy.campaignCharacterId ||
            binding.localControllerSeatId === bound.tabId,
        )
      )
        return s.fail('FOREIGN_OWNER');
      const binding = {
        localControllerSeatId: bound.tabId,
        networkScopeId: bound.networkScopeId,
        campaignId: receipt.campaignId,
        campaignCharacterId: copy.campaignCharacterId,
        admissionReceiptId: receipt.receiptId,
      };
      if (sameInstallation !== hostLocal) continue;
      inspect?.(binding, admission);
      result.push({ binding, diff });
    }
  }
  if (
    tabs.some(
      ({ tab, entry }) =>
        entry.request.admissionEntry !== undefined && !provenExtras.has(tab.tabId),
    )
  )
    return s.fail();
  return result;
}

/** The original SUBMIT tab supplies the profile for all of its admitted child tabs. */
export function readHostLocalRoster(db: Database.Database, owner: string, campaignId: string) {
  return s.read(db, owner, () =>
    admittedOrdinarySeats(db, owner, undefined, true)
      .filter(({ binding }) => binding.campaignId === campaignId)
      .map(({ binding, diff }) => ({
        binding,
        diff,
        profileOwnerId:
          readHostLocalCharacterOwner(db, owner, diff.sourceUuid) ?? s.fail('FOREIGN_OWNER'),
      })),
  );
}

export function readOrdinarySceneRoster(
  db: Database.Database,
  owner: string,
  source: { seatId: string; scopeId: string; campaignId: string; sceneId: string },
) {
  return s.read(db, owner, () => {
    let included: readonly string[] = [];
    const seats = admittedOrdinarySeats(db, owner, (binding, admission) => {
      if (
        binding.localControllerSeatId !== source.seatId ||
        binding.networkScopeId !== source.scopeId ||
        binding.campaignId !== source.campaignId
      )
        return;
      const scene = localLobbyState(admission).observations.find(
        (observation) =>
          observation.selectedCopy.controller.localControllerSeatId === source.seatId,
      );
      // #172 also admits blocked PROPOSED copies. Only ACTIVE copies enter the
      // immutable #173 Start checkpoint attested by the owner's scene observation.
      if (
        scene?.campaignStarted &&
        scene.peaceOrNull?.sceneId === source.sceneId &&
        scene.ownerDeviceId === owner &&
        scene.campaignId === source.campaignId &&
        scene.selectedCopy.campaignCharacterId === binding.campaignCharacterId &&
        scene.includedCampaignCharacterIds.includes(binding.campaignCharacterId)
      )
        included = scene.includedCampaignCharacterIds;
    }).filter(({ binding }) => binding.campaignId === source.campaignId);
    const roster = seats.map(({ binding }, index) => ({
      seatId: binding.localControllerSeatId,
      ordinal: index + 1,
    }));
    const eligibleTargetSeatIds = seats
      .filter(
        ({ binding }) =>
          binding.localControllerSeatId !== source.seatId &&
          included.includes(binding.campaignCharacterId),
      )
      .map(({ binding }) => binding.localControllerSeatId);
    return { roster, eligibleTargetSeatIds };
  });
}
