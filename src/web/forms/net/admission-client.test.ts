import { describe, expect, it } from 'vitest';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { AdmissionGmClientV3Message } from '@shared/campaign-admission-review.js';
import type { ConfirmedProjectionSnapshot } from '../../ws-client.js';
import {
  admissionDraftDestinationMatches,
  admissionOwnerActions,
  admissionOwnerMonotonic,
  admissionOwnerDecisionDestination,
} from './admission-client.js';
import type { AdmissionOwnerCommand } from '@shared/campaign-admission-presentation.js';
import { admissionJsonEqual } from '@shared/campaign-admission-codec.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// The closed snapshot decoder runs before this correlation check. These fixtures isolate
// the fields that correlate a sent draft with its result; they do not emulate game sheets.
function snapshot(formId: string, projection: JsonObject): ConfirmedProjectionSnapshot {
  return { formId, projection, layers: [] } as unknown as ConfirmedProjectionSnapshot;
}
const common = {
  protocolVersion: 3 as const,
  draftUpdateId: 'draft',
  contextId: id(1),
  campaignId: id(2),
  admissionBatchId: id(3),
  expectedRevisions: { stateRevision: 4, projectionRevision: 7, actorVisibilityRevision: 0 },
};
const values = { selectedReviewCopyId: id(4), rejectionReason: 'А', weaponDraftOrNull: null };
describe('admission draft result correlation at the applied vector', () => {
  it('accepts reordered VIEW members but refuses different selected copy, reason, form or batch', () => {
    const request = {
      ...common,
      messageType: 'network.admission-view.replace',
      sourceFormId: 'NET-022',
      values,
    } as const;
    const projection = {
      admissionBatchId: id(3),
      viewValues: { weaponDraftOrNull: null, rejectionReason: 'А', selectedReviewCopyId: id(4) },
    };
    const before = snapshot('NET-022', projection);
    expect(admissionDraftDestinationMatches(before, before, request)).toBe(true);
    for (const changed of [
      { ...projection, viewValues: { ...values, rejectionReason: 'Б' } },
      { ...projection, viewValues: { ...values, selectedReviewCopyId: id(5) } },
      { ...projection, admissionBatchId: id(8) },
    ])
      expect(admissionDraftDestinationMatches(snapshot('NET-022', changed), before, request)).toBe(
        false,
      );
    expect(admissionDraftDestinationMatches(snapshot('NET-021', projection), before, request)).toBe(
      false,
    );
  });
  it('binds EDIT to the complete sent inputs and exact next review revision', () => {
    const inputs = {
      massReview: { massKg: 75, decision: 'APPROVED' },
      moneyReview: { amountOrNull: 42, status: 'FINAL' },
    };
    const request = {
      ...common,
      messageType: 'network.admission-review.edit',
      sourceFormId: 'NET-019',
      expectedReviewRevision: 3,
      intent: { kind: 'EDIT', reviewCopyId: id(4), inputs },
    } as unknown as AdmissionGmClientV3Message;
    const projection = {
      admissionBatchId: id(3),
      selectedReviewCopyId: id(4),
      reviewRevisionOrNull: 4,
      reviewDraft: {
        moneyReview: { status: 'FINAL', amountOrNull: 42 },
        massReview: { decision: 'APPROVED', massKg: 75 },
      },
    };
    const before = snapshot('NET-019', projection);
    expect(admissionDraftDestinationMatches(before, before, request)).toBe(true);
    for (const changed of [
      { ...projection, reviewRevisionOrNull: 3 },
      { ...projection, selectedReviewCopyId: id(8) },
      {
        ...projection,
        reviewDraft: { ...inputs, moneyReview: { status: 'FINAL', amountOrNull: 43 } },
      },
    ])
      expect(admissionDraftDestinationMatches(snapshot('NET-019', changed), before, request)).toBe(
        false,
      );
  });
  it('accepts one new bound item identity without letting the response relabel existing items', () => {
    const original = { reviewItemId: id(7), sourceEntryIdOrNull: 'source-item' },
      added = { reviewItemId: id(8), sourceEntryIdOrNull: null };
    const p = {
      admissionBatchId: id(3),
      selectedReviewCopyId: id(4),
      reviewRevisionOrNull: 4,
      reviewItemIdentities: [original],
    };
    const request = {
      ...common,
      messageType: 'network.admission-review.edit',
      sourceFormId: 'NET-019',
      expectedReviewRevision: 3,
      intent: { kind: 'ALLOCATE_ITEM', reviewCopyId: id(4) },
    } as const;
    const before = snapshot('NET-019', p);
    const matches = (items: JsonObject[]) =>
      admissionDraftDestinationMatches(
        snapshot('NET-019', { ...p, reviewItemIdentities: items }),
        before,
        request,
      );
    expect(matches([{ ...original }, added])).toBe(true);
    expect(matches([original, original])).toBe(false);
    expect(matches([original, { ...added, sourceEntryIdOrNull: 'invented' }])).toBe(false);
    expect(matches([{ ...original, sourceEntryIdOrNull: null }, added])).toBe(false);
    expect(matches([original, added, { ...added, reviewItemId: id(9) }])).toBe(false);
  });
  it('accepts exactly one fresh group ID and preserves the existing ordered group identities', () => {
    const p = { admissionBatchId: id(3), reviewRevisionOrNull: 2, groupDraftIds: [id(7)] };
    const request = {
      ...common,
      messageType: 'network.admission-review.edit',
      sourceFormId: 'NET-020',
      expectedReviewRevision: 1,
      intent: { kind: 'ALLOCATE_GROUP' },
    } as const;
    const before = snapshot('NET-020', p);
    expect(
      admissionDraftDestinationMatches(
        snapshot('NET-020', { ...p, groupDraftIds: [id(7), id(8)] }),
        before,
        request,
      ),
    ).toBe(true);
    for (const ids of [[id(7), id(7)], [id(8), id(7)], [], [id(7), id(8), id(9)]])
      expect(
        admissionDraftDestinationMatches(
          snapshot('NET-020', { ...p, groupDraftIds: ids }),
          before,
          request,
        ),
      ).toBe(false);
  });
});
describe('whole-batch owner presentation actions', () => {
  it('requires journal progress for owner changes and reserves executor-context replacement for reconnect', () => {
    const revisions = { stateRevision: 9, projectionRevision: 12, actorVisibilityRevision: 0 };
    const projection: JsonObject = {
      contextId: id(1),
      networkScopeId: id(2),
      controllerSeat: id(3),
      deviceId: id(4),
      publication: { immutable: 'source' },
      receiptOrNull: null,
      pendingCommandIdOrNull: null,
      technicalSessionAvailable: true,
      capacityRecheck: null,
      campaignRevisionOrNull: 1,
    };
    const original = { ...snapshot('NET-027', projection), revisions };
    const sameVector = (patch: JsonObject, formId = 'NET-027') => ({
      ...snapshot(formId, { ...projection, ...patch }),
      revisions,
    });
    expect(
      admissionOwnerMonotonic(
        sameVector({ technicalSessionAvailable: false, campaignRevisionOrNull: 2 }),
        original,
      ),
    ).toBe(true);
    expect(
      admissionOwnerMonotonic(sameVector({ pendingCommandIdOrNull: 'new-command' }), original),
    ).toBe(false);
    expect(
      admissionOwnerMonotonic(
        sameVector({ receiptOrNull: { commandId: 'new-command' } }, 'NET-006'),
        original,
      ),
    ).toBe(false);
    expect(admissionOwnerMonotonic(sameVector({ contextId: id(8) }), original)).toBe(false);
    expect(admissionOwnerMonotonic(sameVector({ contextId: id(8) }), original, true)).toBe(true);
    expect(
      admissionOwnerMonotonic(
        {
          ...sameVector({ pendingCommandIdOrNull: 'new-command' }),
          revisions: { ...revisions, stateRevision: 10, projectionRevision: 13 },
        },
        original,
      ),
    ).toBe(true);
    expect(
      admissionOwnerMonotonic(
        {
          ...sameVector({ pendingCommandIdOrNull: 'new-command' }),
          revisions: { ...revisions, stateRevision: 10 },
        },
        original,
      ),
    ).toBe(false);
    const terminal = {
      ...sameVector({ receiptOrNull: { commandId: 'new-command' } }, 'NET-006'),
      revisions: { ...revisions, stateRevision: 10, projectionRevision: 13 },
    };
    const command = {
      commandId: 'new-command',
      payload: { networkScopeId: id(2), decision: 'ACCEPT', expectedCampaignRevision: 1 },
    } as unknown as AdmissionOwnerCommand;
    expect(admissionOwnerDecisionDestination(terminal, command, original)).toBe(false);
    const recoveredPending = {
      ...terminal,
      formId: 'NET-027' as const,
      projection: { ...projection, contextId: id(8), pendingCommandIdOrNull: command.commandId },
    };
    expect(admissionOwnerDecisionDestination(recoveredPending, command, original, null, true)).toBe(
      true,
    );
    expect(
      admissionOwnerDecisionDestination(recoveredPending, command, original, null, false, id(8)),
    ).toBe(true);
    expect(
      admissionOwnerDecisionDestination(recoveredPending, command, original, null, false, id(9)),
    ).toBe(false);
    expect(original.projection['contextId']).toBe(id(1));
  });
  const available = {
    technicalSessionAvailable: true,
    capacityRecheck: { fitsCurrentCapacity: true },
    pendingCommandIdOrNull: null,
    decision: null,
  };
  it('requires live confirmed capacity and a capability, retaining DECLINE when the batch does not fit', () => {
    const caps = ['UI-CMD-ADMISSION-PLAYER-DECIDE'];
    expect(admissionOwnerActions('NET-027', available, caps)).toEqual([
      'NET-027::CTA::003',
      'NET-027::CTA::004',
    ]);
    expect(
      admissionOwnerActions(
        'NET-027',
        { ...available, capacityRecheck: { fitsCurrentCapacity: false } },
        caps,
      ),
    ).toEqual(['NET-027::CTA::004']);
    for (const changed of [
      { ...available, capacityRecheck: null },
      { ...available, technicalSessionAvailable: false },
      { ...available, pendingCommandIdOrNull: 'pending' },
    ])
      expect(admissionOwnerActions('NET-027', changed, caps)).toEqual([]);
    expect(admissionOwnerActions('NET-027', available, [])).toEqual([]);
    expect(admissionOwnerActions('NET-027', { ...available, decision: 'ACCEPT' }, [])).toEqual([
      'NET-027::CTA::001',
    ]);
    expect(admissionOwnerActions('NET-027', { ...available, decision: 'DECLINE' }, [])).toEqual([
      'NET-027::CTA::002',
    ]);
  });
  it('compares decoded nested JSON independently of member order while preserving array order and null', () => {
    expect(
      admissionJsonEqual({ a: 1, b: [{ x: 2, y: 3 }, null] }, { b: [{ y: 3, x: 2 }, null], a: 1 }),
    ).toBe(true);
    expect(admissionJsonEqual({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(admissionJsonEqual([1, 2], [2, 1])).toBe(false);
    expect(admissionJsonEqual(null, {})).toBe(false);
  });
});
