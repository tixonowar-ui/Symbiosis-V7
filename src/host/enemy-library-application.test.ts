import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import {
  enemyLibraryProjectionValue,
  type EnemyLibrarySelectionRequest,
} from '@shared/enemy-library.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import type { JsonValue } from '@shared/wire-protocol.js';
import type { FormActionIntentV2Message } from '@shared/wire-v2-protocol.js';
import { campaignCreationHash } from '../persistence/campaign-creation.js';
import { loadCampaignCheckpoint } from '../persistence/store.js';
import { loadLocalCharacterExportBaseline } from './local-character-export.js';
import { validateEnemyLibrarySource } from './enemy-library-application.js';
import { loadEnemySourceCatalog } from './enemy-catalog.js';
import { createEnemyLibraryFixture } from '../../tests/fixtures/enemy-library.js';

let baseline: Awaited<ReturnType<typeof loadLocalCharacterExportBaseline>>;
let catalog: ReturnType<typeof loadEnemySourceCatalog>;
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  catalog = loadEnemySourceCatalog(process.cwd(), baseline);
});
function selection(
  f: ReturnType<typeof createEnemyLibraryFixture>,
  index = 0,
  monster = false,
): EnemyLibrarySelectionRequest {
  const { origin, templateId, catalogVersion, artAssetKey } = (
    monster ? catalog.canonicalTemplates : catalog.systemTemplates
  )[index]!;
  const { revisions } = f.app().project();
  return {
    messageType: 'network.enemy-selection.replace',
    protocolVersion: 3,
    operationId: randomUUID(),
    contextId: f.scope.gmLocalContextId,
    campaignId: f.scope.campaignId,
    sourceFormId: 'ENM-001',
    expectedRevisions: revisions,
    activeTab: monster ? 'MONSTERS' : 'SENTIENT_ENEMIES',
    selectionOrNull: { origin, templateId, catalogVersion, artAssetKey },
  };
}
it('ENM-001/003 persists actual selection, catalog pin and original art through restart without campaign mutation', () => {
  const f = createEnemyLibraryFixture(catalog, baseline);
  try {
    const original = loadCampaignCheckpoint(f.db, f.scope.campaignId),
      receipt = (
        f.db.prepare('SELECT receipt_json FROM campaign_creation_command').get() as {
          receipt_json: string;
        }
      ).receipt_json;
    const initial = enemyLibraryProjectionValue(f.app().project().base.roleFilteredPayload);
    expect(initial.currentUserTemplates).toEqual([]);
    expect(initial.selectedOrNull).toBeNull();
    const request = selection(f, 9);
    f.app().select(request);
    f.nav('ENM-001::CTA::002');
    const card = f.app().project();
    expect(card.base.availableActionKeys).toEqual(['ENM-003::CTA::001']);
    expect(enemyLibraryProjectionValue(card.base.roleFilteredPayload).selectedOrNull).toEqual(
      request.selectionOrNull,
    );
    f.restart();
    expect(f.app().project()).toEqual(card);
    f.nav('ENM-003::CTA::001');
    const back = enemyLibraryProjectionValue(f.app().project().base.roleFilteredPayload);
    expect(back.selectedOrNull).toEqual(request.selectionOrNull);
    f.app().select(request); // Exact technical replay preserves the later safe cursor.
    expect(enemyLibraryProjectionValue(f.app().project().base.roleFilteredPayload).formId).toBe(
      'ENM-001',
    );
    f.nav('ENM-001::CTA::004');
    f.nav('ENM-003::CTA::001');
    f.nav('ENM-001::CTA::013');
    expect(loadCampaignCheckpoint(f.db, f.scope.campaignId)).toEqual(original);
    expect(
      (
        f.db.prepare('SELECT receipt_json FROM campaign_creation_command').get() as {
          receipt_json: string;
        }
      ).receipt_json,
    ).toBe(receipt);
  } finally {
    f.close();
  }
});
it('MONSTERS lists/selects actual canonical records but cannot use Runtime-Pack-only ENM-003', () => {
  const f = createEnemyLibraryFixture(catalog, baseline);
  try {
    const request = selection(f, 1, true);
    f.app().select(request);
    f.restart();
    const p = enemyLibraryProjectionValue(f.app().project().base.roleFilteredPayload);
    expect(p.activeTab).toBe('MONSTERS');
    expect(p.selectedOrNull).toEqual(request.selectionOrNull);
    expect(p.canonicalTemplates[1]!.speciesIdOrNull).not.toBeNull();
    expect(f.app().project().base.availableActionKeys).toEqual(['ENM-001::CTA::013']);
    const before = f.db.serialize();
    expect(() => f.nav('ENM-001::CTA::004')).toThrow();
    expect(f.db.serialize().equals(before)).toBe(true);
  } finally {
    f.close();
  }
});
it('refuses stale, foreign, corrupt and tab-mismatched selections with zero write and no authority leak', () => {
  const f = createEnemyLibraryFixture(catalog, baseline);
  try {
    const request = selection(f);
    f.app().select(request);
    const before = f.db.serialize();
    for (const changed of [
      {
        ...request,
        operationId: randomUUID(),
        selectionOrNull: { ...request.selectionOrNull!, templateId: 'missing' },
      },
      { ...request, operationId: randomUUID(), campaignId: randomUUID() },
      { ...request, operationId: randomUUID(), contextId: randomUUID() },
      { ...selection(f), activeTab: 'MONSTERS' as const },
      {
        ...selection(f),
        selectionOrNull: { ...request.selectionOrNull!, catalogVersion: 'foreign' },
      },
      { ...selection(f), selectionOrNull: { ...request.selectionOrNull!, artAssetKey: 'corrupt' } },
      { ...request, operationId: randomUUID() },
    ]) {
      expect(() => f.app().select(changed)).toThrow();
      expect(f.db.serialize().equals(before)).toBe(true);
    }
    f.loseAuthority();
    expect(() => f.app().project()).toThrow();
    expect(() => f.app().select(selection(f))).toThrow();
    expect(f.db.serialize().equals(before)).toBe(true);
  } finally {
    f.close();
  }
});
it('reads an exact legacy v1 birth through its trusted frozen source proof without adding to old receipts', () => {
  const f = createEnemyLibraryFixture(catalog, baseline, true);
  try {
    const receipt = (
        f.db.prepare('SELECT receipt_json FROM campaign_creation_command').get() as {
          receipt_json: string;
        }
      ).receipt_json,
      birth = loadCampaignCheckpoint(f.db, f.scope.campaignId);
    expect(f.creation.receipt.result).not.toHaveProperty('campaignBirthSchemaVersion');
    f.app().select(selection(f, 3));
    f.restart();
    expect(
      enemyLibraryProjectionValue(f.app().project().base.roleFilteredPayload)
        .defaultSentientCatalogVersion,
    ).toBe(catalog.catalogVersion);
    expect(loadCampaignCheckpoint(f.db, f.scope.campaignId)).toEqual(birth);
    expect(
      (
        f.db.prepare('SELECT receipt_json FROM campaign_creation_command').get() as {
          receipt_json: string;
        }
      ).receipt_json,
    ).toBe(receipt);
  } finally {
    f.close();
  }
});
it.each([
  'MISSING_PAYLOAD_PIN',
  'MISSING_RESULT_PIN',
  'FOREIGN_PAYLOAD_PIN',
  'FOREIGN_RESULT_PIN',
  'FOREIGN_BOTH_PINS',
  'UNKNOWN_BIRTH_VERSION',
] as const)(
  'refuses a new v2 birth with %s even after the relevant durable JSON hashes are recomputed',
  (fault) => {
    const f = createEnemyLibraryFixture(catalog, baseline);
    try {
      const campaign = f.db.prepare('SELECT payload_json FROM campaign').get() as {
        payload_json: string;
      };
      const payload = JSON.parse(campaign.payload_json) as Record<string, JsonValue>;
      expect(payload['schemaVersion']).toBe(2);
      expect(payload['defaultSentientCatalogVersion']).toBe(catalog.catalogVersion);
      const row = f.db
        .prepare('SELECT request_json,receipt_json FROM campaign_creation_command')
        .get() as { request_json: string; receipt_json: string };
      const receipt = JSON.parse(row.receipt_json) as Record<string, JsonValue>,
        result = receipt['result'] as Record<string, JsonValue>;
      expect(result['campaignBirthSchemaVersion']).toBe(2);
      expect(result['defaultSentientCatalogVersion']).toBe(catalog.catalogVersion);
      if (fault === 'FOREIGN_BOTH_PINS') f.nav('ENM-001::CTA::013');
      if (fault === 'MISSING_PAYLOAD_PIN') delete payload['defaultSentientCatalogVersion'];
      if (fault === 'MISSING_RESULT_PIN') delete result['defaultSentientCatalogVersion'];
      if (fault === 'FOREIGN_PAYLOAD_PIN' || fault === 'FOREIGN_BOTH_PINS')
        payload['defaultSentientCatalogVersion'] = 'foreign-catalog';
      if (fault === 'FOREIGN_RESULT_PIN' || fault === 'FOREIGN_BOTH_PINS')
        result['defaultSentientCatalogVersion'] = 'foreign-catalog';
      if (fault === 'UNKNOWN_BIRTH_VERSION') payload['schemaVersion'] = 3;
      const payloadJson = s.canonical(payload);
      const checkpoint = JSON.parse(
        loadCampaignCheckpoint(f.db, f.scope.campaignId).snapshotJson,
      ) as Record<string, JsonValue>;
      f.db.prepare('UPDATE campaign SET payload_json=?').run(payloadJson);
      (checkpoint['campaign'] as Record<string, JsonValue>)['payloadJson'] = payloadJson;
      f.db.prepare('UPDATE campaign_checkpoint SET snapshot_json=?').run(s.canonical(checkpoint));
      f.db
        .prepare('UPDATE campaign_creation_command SET receipt_json=?,journal_sha256=?')
        .run(
          s.canonical(receipt),
          campaignCreationHash({ request: JSON.parse(row.request_json) as unknown, receipt }),
        );
      const damaged = f.db.serialize();
      if (fault === 'FOREIGN_BOTH_PINS')
        expect(f.readCurrent().creationOrigin.payload.defaultSentientCatalogVersion).toBe(
          'foreign-catalog',
        );
      if (fault === 'FOREIGN_BOTH_PINS') {
        expect(f.readCurrent().viewOrNull!.formId).toBe('GM-001');
        expect(() =>
          f.readCurrent((source, state) =>
            validateEnemyLibrarySource(source, state, catalog, baseline),
          ),
        ).toThrow('SOURCE_CHANGED');
      }
      expect(() => f.app().project()).toThrow();
      expect(f.db.serialize().equals(damaged)).toBe(true);
    } finally {
      f.close();
    }
  },
);
it.each(
  (['templateId', 'catalogVersion', 'artAssetKey', 'origin'] as const).flatMap((field) =>
    [false, true].map((laterNull) => ({ field, laterNull })),
  ),
)(
  'refuses rehashed historical $field behind later valid/null selection ($laterNull) after restart',
  ({ field, laterNull }) => {
    const f = createEnemyLibraryFixture(catalog, baseline);
    try {
      f.app().select(selection(f, 1));
      const next = selection(f, 2);
      f.app().select(laterNull ? { ...next, selectionOrNull: null } : next);
      const selected = f.readCurrent().viewOrNull!.enemyLibrary!.selectedOrNull;
      const fresh = selection(f, 3);
      const outsideLibrary = field === 'templateId' && laterNull;
      if (outsideLibrary) f.nav('ENM-001::CTA::013');
      const rows = f.db
        .prepare('SELECT event_id,record_json FROM gm_request_queue_event ORDER BY event_index')
        .all() as { event_id: string; record_json: string }[];
      let changed = false,
        predecessor: string | null = null;
      for (const row of rows) {
        const event = JSON.parse(row.record_json) as Record<string, unknown>;
        const mutation = event['mutation'] as Record<string, unknown>;
        if (mutation['kind'] === 'ENEMY_SELECTION' && !changed) {
          const request = mutation['request'] as Record<string, unknown>;
          const bad = { ...(request['selectionOrNull'] as Record<string, unknown>) };
          bad[field] = field === 'origin' ? 'CANONICAL_BESTIARY' : 'foreign-source';
          request['selectionOrNull'] = bad;
          if (field === 'origin') request['activeTab'] = 'MONSTERS';
          const view = event['view'] as Record<string, unknown>;
          view['enemyLibrary'] = { activeTab: request['activeTab'], selectedOrNull: bad };
          const { snapshotSha256: _ignored, ...document } = view;
          view['snapshotSha256'] = campaignCreationHash(document);
          changed = true;
        }
        event['previousEventSha256OrNull'] = predecessor;
        const sha = campaignCreationHash(event);
        f.db
          .prepare(
            'UPDATE gm_request_queue_event SET record_json=?,record_sha256=? WHERE event_id=?',
          )
          .run(s.canonical(event), sha, row.event_id);
        predecessor = sha;
      }
      expect(changed).toBe(true);
      f.restart();
      // The full structural fold succeeds and has a legitimate current selection.
      // Only the owning source check can reject the now-hidden foreign historical identity.
      expect(f.readCurrent().viewOrNull!.enemyLibrary!.selectedOrNull).toEqual(selected);
      const damaged = f.db.serialize();
      let sourceFailure: unknown;
      expect(() =>
        f.readCurrent((source, state) => {
          try {
            validateEnemyLibrarySource(source, state, catalog, baseline);
          } catch (error) {
            sourceFailure = error;
            throw error;
          }
        }),
      ).toThrow('CORRUPT_STORAGE');
      expect(String(sourceFailure)).toContain('selected identity');
      if (outsideLibrary) expect(f.readCurrent().viewOrNull!.formId).toBe('GM-001');
      expect(() => f.app().project()).toThrow();
      expect(() => f.nav(outsideLibrary ? 'GM-001::CTA::005' : 'ENM-001::CTA::013')).toThrow();
      expect(() => f.app().select(fresh)).toThrow();
      expect(f.db.serialize().equals(damaged)).toBe(true);
    } finally {
      f.close();
    }
  },
);
it.each(
  (['ENM-001::CTA::002', 'ENM-001::CTA::004'] as const).flatMap((key) =>
    [false, true].map((canonical) => ({ key, canonical })),
  ),
)(
  'replays $key after clear/canonical ($canonical) and exit using its historical witness, then rejects changed reuse',
  ({ key, canonical }) => {
    const f = createEnemyLibraryFixture(catalog, baseline);
    try {
      f.app().select(selection(f, 1));
      const first = f.nav(key);
      f.nav('ENM-003::CTA::001');
      const next = selection(f, 1, canonical);
      f.app().select(canonical ? next : { ...next, selectionOrNull: null });
      f.nav('ENM-001::CTA::013');
      f.restart();
      const before = f.db.serialize(),
        request = first.event.request as FormActionIntentV2Message;
      const replay = f.app().navigation(request);
      expect(replay.event).toEqual(first.event);
      expect(replay.current.formId).toBe('GM-001');
      expect(f.db.serialize().equals(before)).toBe(true);
      expect(() =>
        f.app().navigation({
          ...request,
          actionKey: key === 'ENM-001::CTA::002' ? 'ENM-001::CTA::004' : 'ENM-001::CTA::002',
        }),
      ).toThrow();
      expect(f.db.serialize().equals(before)).toBe(true);
    } finally {
      f.close();
    }
  },
);

it('avoids catalog file reads outside ENM with no selection history but checks the first tentative entry and rolls back a source fault', () => {
  let calls = 0,
    fault = false;
  const observedCatalog = {
    ...catalog,
    assertCurrent() {
      calls++;
      if (fault) throw Error('catalog source fault');
      catalog.assertCurrent();
    },
  };
  const f = createEnemyLibraryFixture(observedCatalog, baseline);
  const observe = () =>
    f.readCurrent((source, state) =>
      validateEnemyLibrarySource(source, state, observedCatalog, baseline),
    );
  try {
    f.nav('ENM-001::CTA::013');
    expect(f.readCurrent().viewOrNull!.formId).toBe('GM-001');
    calls = 0;
    fault = true;
    expect(observe).not.toThrow();
    expect(calls).toBe(0);
    const before = f.db.serialize();
    expect(() => f.nav('GM-001::CTA::005')).toThrow();
    expect(calls).toBe(1);
    expect(f.db.serialize().equals(before)).toBe(true);
    expect(f.readCurrent().viewOrNull!.formId).toBe('GM-001');
    fault = false;
    f.nav('GM-001::CTA::005');
    calls = 0;
    fault = true;
    expect(() => f.app().project()).toThrow();
    expect(calls).toBe(1);
  } finally {
    f.close();
  }
});
it.each([false, true])(
  'rechecks file freshness outside ENM after a historical selection, including null (%s)',
  (nullSelection) => {
    let calls = 0,
      fault = false;
    const observedCatalog = {
      ...catalog,
      assertCurrent() {
        calls++;
        if (fault) throw Error('catalog source fault');
        catalog.assertCurrent();
      },
    };
    const f = createEnemyLibraryFixture(observedCatalog, baseline);
    try {
      const request = selection(f);
      f.app().select(nullSelection ? { ...request, selectionOrNull: null } : request);
      f.nav('ENM-001::CTA::013');
      f.restart();
      expect(f.readCurrent().viewOrNull!.formId).toBe('GM-001');
      calls = 0;
      fault = true;
      const before = f.db.serialize();
      expect(() =>
        f.readCurrent((source, state) =>
          validateEnemyLibrarySource(source, state, observedCatalog, baseline),
        ),
      ).toThrow('CORRUPT_STORAGE');
      expect(calls).toBe(1);
      expect(f.db.serialize().equals(before)).toBe(true);
    } finally {
      f.close();
    }
  },
);
