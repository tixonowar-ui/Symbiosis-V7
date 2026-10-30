import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JsonObject, JsonValue } from '@shared/wire-protocol.js';
import type { PostSaveMetadata, PostSaveRequest } from '@shared/local-character-post-save.js';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
} from '../../tests/fixtures/creation-finalization-stage.js';
import {
  loadDeviceId,
  openPersistenceDatabase,
  type LocalCharacter,
  type LocalCharacterCheckpoint,
} from '../persistence/index.js';
import { commitCreationFinalization } from './creation-finalization.js';
import { commitManualComposition } from './creation-manual-composition.js';
import { manualCompositionRequest } from '../../tests/fixtures/manual-symbiont-stage.js';
import { creationFinalizationHash } from './creation-finalization-contract.js';
import { loadCreationWizardCheckpoint } from './creation-set-decide.js';
import {
  canonicalPostSaveJson,
  loadLocalCharacterExportBaseline,
  postSaveSha256,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import { validateArchivedLocalExportDocument } from './local-character-archive-export.js';
import {
  commitLocalPostSave,
  openPlayerPostSave,
  postSaveCommon,
  postSaveRevisions,
  type LocalPostSaveDependencies,
} from './local-character-post-save.js';
import {
  DeviceAdmissionCandidateError,
  prepareOwnedFinalAdmissionCandidate,
  validateFinalAdmissionCandidate,
  type PreparedOwnedFinalAdmissionCandidate,
  type FinalAdmissionCandidateDescriptor,
} from './device-admission-candidate.js';

const limits = { maxWitnessBytes: 16 * 1024 * 1024 };
let baseline: LocalCharacterExportBaseline;
const databases: LocalPostSaveDependencies['database'][] = [];
const directories: string[] = [];
type Source = Awaited<ReturnType<typeof source>>;
const fixtures = new Map<string, Source>();
function dependencies(
  database: LocalPostSaveDependencies['database'],
  catalog: LocalPostSaveDependencies['symbiontCatalog'],
): LocalPostSaveDependencies {
  return {
    database,
    baseline,
    symbiontCatalog: catalog,
    loadCheckpoint: (id) => loadCreationWizardCheckpoint(database, id, catalog.skillStage, catalog),
    resumeForm: (c) => c.nextStageEnvelope.formId,
  };
}
async function source(
  race: 'FREE' | 'PURE' | 'UNITED' = 'FREE',
  mode: 'AUTO' | 'MANUAL' = 'AUTO',
  databasePath = ':memory:',
  final = true,
) {
  const p = await createCreationFinalizationSetup({
    prefix: `candidate-${race}-${mode}`,
    raceChoice: race,
    diceInputMode: mode,
    databasePath,
    ...(race === 'UNITED'
      ? {
          prepareManualComposition: (setup: Parameters<typeof manualCompositionRequest>[0]) =>
            commitManualComposition(
              setup.database,
              manualCompositionRequest(
                setup,
                setup.checkpoint,
                'united-composition',
                ['OWL', 'TICK', 'SPIDER', 'MANTIS'],
                [{ speciesKey: 'OWL', side: 'LEFT' }],
              ),
              'united-composition-receipt',
              {
                catalog: setup.catalog,
                allocateRollRequestId: () => {
                  throw new Error('no Advisor allocation');
                },
                sampleD20: () => {
                  throw new Error('no Advisor roll');
                },
              },
            ),
        }
      : {}),
  });
  databases.push(p.setup.database);
  let current = commitCreationFinalization(
    p.setup.database,
    creationPropertySummaryRequest(p.current, 'candidate-summary'),
    'candidate-summary-receipt',
    p.dependencies,
  );
  if (final)
    current = commitCreationFinalization(
      p.setup.database,
      creationFinalSaveRequest(current, 'candidate-final'),
      'candidate-final-receipt',
      p.dependencies,
    );
  const d = dependencies(p.setup.database, p.setup.catalog);
  const owner = loadDeviceId(d.database);
  const id = current.localCharacter.localCharacterId;
  return { p, d, owner, id, current };
}
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
  for (const race of ['FREE', 'PURE', 'UNITED'] as const)
    for (const mode of ['AUTO', 'MANUAL'] as const)
      fixtures.set(`${race}-${mode}`, await source(race, mode));
});
afterAll(() => {
  for (const db of databases) if (db.open) db.close();
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  return fixtures.get(['FREE', 'AUTO'].join('-'))!;
}
function prepared(s = fixture()) {
  return prepareOwnedFinalAdmissionCandidate(s.d, s.owner, s.id, limits);
}
function receive(
  c: PreparedOwnedFinalAdmissionCandidate,
  witness: unknown = c.canonicalWitnessText,
  descriptor: unknown = c.descriptor,
  document: unknown = c.exportDocument,
  owner: string = fixture().owner,
  useBaseline = baseline,
  maxWitnessBytes = limits.maxWitnessBytes,
) {
  return validateFinalAdmissionCandidate(witness, owner, descriptor, document, useBaseline, {
    maxWitnessBytes,
  });
}
function error(run: () => unknown) {
  try {
    run();
  } catch (caught) {
    expect(caught).toBeInstanceOf(DeviceAdmissionCandidateError);
    const e = caught as DeviceAdmissionCandidateError;
    expect(e.message).toBe(`device admission candidate: ${e.code}:${e.field}`);
    expect(e.cause).toBeUndefined();
    return e;
  }
  throw new Error('candidate unexpectedly accepted');
}
interface Witness {
  schemaVersion: number;
  ownerDeviceId: string;
  localCharacter: LocalCharacter;
  checkpoint: LocalCharacterCheckpoint;
  skillPresentationStage: JsonObject | null;
  symbiontPresentationStage: JsonObject | null;
}
function witness(c: PreparedOwnedFinalAdmissionCandidate): Witness {
  return JSON.parse(c.canonicalWitnessText) as Witness;
}
type MutableJson = { [key: string]: JsonValue };
function row(value: unknown): MutableJson {
  return value as MutableJson;
}
function snapshot(w: Witness) {
  w.checkpoint.snapshotJson = JSON.stringify({
    localCharacter: {
      localCharacterId: w.localCharacter.localCharacterId,
      lifecycleState: w.localCharacter.lifecycleState,
      payloadJson: w.localCharacter.payloadJson,
    },
  });
  w.checkpoint.snapshotSha256 = postSaveSha256(w.checkpoint.snapshotJson);
}
function alterPayload(w: Witness, mutate: (payload: MutableJson) => void) {
  const payload = JSON.parse(w.localCharacter.payloadJson) as MutableJson;
  mutate(payload);
  w.localCharacter.payloadJson = JSON.stringify(payload);
  snapshot(w);
}
function alteredExport(
  c: PreparedOwnedFinalAdmissionCandidate,
  mutate: (document: MutableJson) => void,
) {
  const document = row(structuredClone(c.exportDocument));
  mutate(document);
  delete document['checksum'];
  document['checksum'] = postSaveSha256(canonicalPostSaveJson(document));
  const descriptor: FinalAdmissionCandidateDescriptor = {
    ...c.descriptor,
    exportChecksum: document['checksum'],
    exportBytesSha256: postSaveSha256(`${canonicalPostSaveJson(document)}\n`),
  };
  return { document, descriptor };
}

describe('private FINAL admission candidate evidence', () => {
  it.each(
    ['FREE', 'PURE', 'UNITED'].flatMap((race) =>
      ['AUTO', 'MANUAL'].map((mode) => `${race}-${mode}`),
    ),
  )(
    'replays the original source-backed %s FINAL and exports the same bytes without writes',
    (key) => {
      const s = fixtures.get(key)!;
      const before = s.d.database.serialize();
      const changes = s.d.database.prepare('SELECT total_changes() AS n').get();
      const c = prepared(s);
      const result = receive(c, undefined, undefined, undefined, s.owner);
      expect(result).toEqual({ descriptor: c.descriptor, exportDocument: c.exportDocument });
      expect(Object.keys(result).sort()).toEqual(['descriptor', 'exportDocument']);
      expect(postSaveSha256(c.canonicalWitnessText)).toBe(c.witnessSha256);
      expect(Buffer.byteLength(c.canonicalWitnessText, 'utf8')).toBe(c.byteLength);
      const w = witness(c);
      expect(Object.keys(w).sort()).toEqual(
        [
          'schemaVersion',
          'ownerDeviceId',
          'localCharacter',
          'checkpoint',
          'skillPresentationStage',
          'symbiontPresentationStage',
        ].sort(),
      );
      expect(w.localCharacter).toEqual(s.current.localCharacter);
      expect(w.checkpoint).toEqual(s.current.checkpoint);
      expect(s.d.database.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
      expect(s.d.database.serialize().equals(before)).toBe(true);
      expect(Object.isFrozen(c)).toBe(true);
      expect(Object.isFrozen(c.exportDocument['mechanicsSnapshot'])).toBe(true);
    },
  );

  it('does not allocate a scope/export record and reuses an enclosing read transaction without committing it', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    const sentinel = new Error('outer rollback');
    expect(() =>
      s.d.database.transaction(() => {
        expect(s.d.database.inTransaction).toBe(true);
        prepared(s);
        expect(s.d.database.inTransaction).toBe(true);
        throw sentinel;
      })(),
    ).toThrow(sentinel);
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it('preserves original payload/snapshot strings and actual presentation rows without a copied Durable envelope', () => {
    const s = fixture();
    const c = prepared(s);
    const w = witness(c);
    expect(w.localCharacter.payloadJson).toBe(s.current.localCharacter.payloadJson);
    expect(w.checkpoint.snapshotJson).toBe(s.current.checkpoint.snapshotJson);
    expect(c.canonicalWitnessText).not.toContain('privateKeyPkcs8Base64');
    expect(c.canonicalWitnessText).not.toContain('masterAuthorityRevision');
    expect(c.canonicalWitnessText).not.toContain('sessionTicket');
    expect(row(w)['durablePayload']).toBeUndefined();
  });

  it('reads actual latest metadata, pins its revision and reproduces unchanged bytes after SQLite reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'candidate-reopen-'));
    directories.push(directory);
    const path = join(directory, 'source.sqlite');
    const s = await source('PURE', 'MANUAL', path);
    const original = prepared(s);
    const head = openPlayerPostSave(s.d, s.id, 'CHR-040');
    const values: PostSaveMetadata = {
      name: 'Источник CORE-159 fan',
      description: 'Private own metadata',
      artAssetKeyOrLocalFile: null,
    };
    const request: PostSaveRequest = {
      protocolVersion: 1,
      messageType: 'command.request',
      role: 'player',
      commandKind: 'workflow-command',
      commandId: 'candidate-metadata',
      workflowCommandId: 'UI-CMD-CHAR-LOCAL-METADATA-PATCH',
      expectedRevisions: postSaveRevisions(head),
      payload: {
        ...postSaveCommon(head),
        stage: 'LOCAL_CHARACTER_POST_SAVE',
        variant: 'METADATA_PATCH',
        sourceFormId: 'CHR-040',
        expectedMetadataRevisionOrNull: 0,
        values,
      },
    };
    commitLocalPostSave(s.d, request, 'candidate-metadata-receipt', () => {
      throw new Error('must not allocate');
    });
    const changed = prepared(s);
    expect(changed.descriptor.metadataRevision).toBe(1);
    expect(changed.exportDocument['metadata']).toEqual(values);
    expect(changed.descriptor.sourceChecksum).toBe(original.descriptor.sourceChecksum);
    expect(changed.canonicalWitnessText).toBe(original.canonicalWitnessText);
    expect(changed.descriptor.exportChecksum).not.toBe(original.descriptor.exportChecksum);
    // An immutable old request can still replay its pinned DTO after later metadata writes.
    expect(receive(original, undefined, undefined, undefined, s.owner).descriptor).toEqual(
      original.descriptor,
    );
    s.d.database.close();
    const reopened = openPersistenceDatabase(path);
    databases.push(reopened);
    const d = dependencies(reopened, s.p.setup.catalog);
    expect(prepareOwnedFinalAdmissionCandidate(d, s.owner, s.id, limits)).toEqual(changed);
    expect(receive(changed, undefined, undefined, undefined, s.owner).exportDocument).toEqual(
      changed.exportDocument,
    );
  });

  it('accepts existing non-v4 source and receipt identifiers rather than inventing a UUID filter', () => {
    const c = prepared();
    expect(c.descriptor.sourceUuid).toBe('candidate-FREE-AUTO-character');
    expect(c.descriptor.sourceSnapshotId).toBe('candidate-final-receipt');
    expect(receive(c).descriptor).toEqual(c.descriptor);
  });

  it('enforces exact UTF-8 size bounds on both sides without truncating the original witness', () => {
    const s = fixture();
    const c = prepared(s);
    expect(
      prepareOwnedFinalAdmissionCandidate(s.d, s.owner, s.id, { maxWitnessBytes: c.byteLength }),
    ).toEqual(c);
    expect(
      receive(c, undefined, undefined, undefined, s.owner, baseline, c.byteLength).descriptor,
    ).toEqual(c.descriptor);
    expect(
      error(() =>
        prepareOwnedFinalAdmissionCandidate(s.d, s.owner, s.id, {
          maxWitnessBytes: c.byteLength - 1,
        }),
      ).code,
    ).toBe('WITNESS_TOO_LARGE');
    expect(
      error(() => receive(c, undefined, undefined, undefined, s.owner, baseline, c.byteLength - 1))
        .code,
    ).toBe('WITNESS_TOO_LARGE');
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid explicit size limit %s',
    (maximum) => {
      const s = fixture();
      const c = prepared(s);
      expect(
        error(() =>
          prepareOwnedFinalAdmissionCandidate(s.d, s.owner, s.id, { maxWitnessBytes: maximum }),
        ).field,
      ).toBe('limits');
      expect(
        error(() => receive(c, undefined, undefined, undefined, s.owner, baseline, maximum)).field,
      ).toBe('limits');
    },
  );

  it('rejects a foreign device without writes', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    error(() => prepareOwnedFinalAdmissionCandidate(s.d, 'foreign-device', s.id, limits));
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it('rejects a missing source without writes', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    error(() => prepareOwnedFinalAdmissionCandidate(s.d, s.owner, 'unknown-source', limits));
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it('rejects a real DRAFT after the complete creation path without writes', async () => {
    const draft = await source('FREE', 'MANUAL', ':memory:', false);
    const draftBefore = draft.d.database.serialize();
    error(() => prepared(draft));
    expect(draft.d.database.serialize().equals(draftBefore)).toBe(true);
  });

  it('rejects a checksum-valid VARIANT witness without writes', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    const c = prepared();
    const w = witness(c);
    w.localCharacter.lifecycleState = 'VARIANT';
    snapshot(w);
    error(() => receive(c, canonicalPostSaveJson(w)));
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it('refuses a loader returning another actual character/checkpoint and redacts thrown private errors', () => {
    const s = fixture();
    const other = fixtures.get(['PURE', 'AUTO'].join('-'))!;
    const foreign = { ...s.d, loadCheckpoint: () => other.current };
    error(() => prepareOwnedFinalAdmissionCandidate(foreign, s.owner, s.id, limits));
    const secret = 'PRIVATE_OLD_ART_AND_INVALID_INPUT';
    const e = error(() =>
      prepareOwnedFinalAdmissionCandidate(
        {
          ...s.d,
          loadCheckpoint: () => {
            throw new Error(secret);
          },
        },
        s.owner,
        s.id,
        limits,
      ),
    );
    expect(`${e.message}${e.stack}${JSON.stringify(e)}`).not.toContain(secret);
  });

  it('rejects a loader changing the actual source inside the read transaction and rolls it back', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    const d = {
      ...s.d,
      loadCheckpoint: () => {
        s.d.database
          .prepare(
            'UPDATE local_character SET projectionRevision = projectionRevision + 1 WHERE local_character_id = ?',
          )
          .run(s.id);
        return s.current;
      },
    };
    error(() => prepareOwnedFinalAdmissionCandidate(d, s.owner, s.id, limits));
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it('checks the actual owner binding, not just the singleton device or a supplied owner argument', () => {
    const s = fixture();
    const before = s.d.database.serialize();
    const rollback = new Error('test rollback');
    expect(() =>
      s.d.database.transaction(() => {
        s.d.database
          .prepare(
            'UPDATE local_character_owner SET owner_device_id = ? WHERE local_character_id = ?',
          )
          .run('foreign-device', s.id);
        error(() => prepared(s));
        throw rollback;
      })(),
    ).toThrow(rollback);
    expect(s.d.database.serialize().equals(before)).toBe(true);
  });

  it.each([
    [
      'owner',
      (w: Witness) => {
        w.ownerDeviceId = 'foreign-owner';
      },
    ],
    [
      'schema',
      (w: Witness) => {
        w.schemaVersion = 2;
      },
    ],
    [
      'row ID',
      (w: Witness) => {
        w.localCharacter.localCharacterId = 'foreign-source';
        snapshot(w);
      },
    ],
    [
      'checkpoint owner',
      (w: Witness) => {
        w.checkpoint.localCharacterId = 'foreign-source';
      },
    ],
    [
      'snapshot hash',
      (w: Witness) => {
        w.checkpoint.snapshotSha256 = '0'.repeat(64);
      },
    ],
    [
      'rehashed unrelated snapshot',
      (w: Witness) => {
        w.checkpoint.snapshotJson = '{"localCharacter":{}}';
        w.checkpoint.snapshotSha256 = postSaveSha256(w.checkpoint.snapshotJson);
      },
    ],
    [
      'snapshot field order',
      (w: Witness) => {
        w.checkpoint.snapshotJson = JSON.stringify({
          localCharacter: {
            payloadJson: w.localCharacter.payloadJson,
            lifecycleState: 'FINAL',
            localCharacterId: w.localCharacter.localCharacterId,
          },
        });
        w.checkpoint.snapshotSha256 = postSaveSha256(w.checkpoint.snapshotJson);
      },
    ],
    [
      'state vector',
      (w: Witness) => {
        w.checkpoint.stateRevision++;
      },
    ],
    [
      'both state vectors',
      (w: Witness) => {
        w.checkpoint.stateRevision++;
        w.localCharacter.stateRevision++;
      },
    ],
    [
      'draft revision',
      (w: Witness) => {
        w.checkpoint.checkpointRevision++;
      },
    ],
    [
      'foreign presentation',
      (w: Witness) => {
        w.symbiontPresentationStage = {
          formId: 'CHR-025',
          compositionDraftRevision: 0,
          projectionRevision: 0,
          routeBindings: [{ parameterIndex: 0, source: 'inherited', value: 'foreign' }],
          routeTemplate: '/player/characters/:localCharacterId/create/chr-025',
        };
      },
    ],
  ] as const)('rejects %s even with a canonical wrapper', (_label, mutate) => {
    const c = prepared();
    const w = witness(c);
    mutate(w);
    error(() => receive(c, canonicalPostSaveJson(w)));
  });

  it.each([
    'runtime HP',
    'effective stat',
    'skill bonus',
    'weapon facts',
    'physical receipt',
    'provenance',
    'metadata revision',
  ])('rejects rechecksummed safe DTO %s that has no exact original replay', (target) => {
    const c = prepared();
    const altered = alteredExport(c, (doc) => {
      const mechanics = row(doc['mechanicsSnapshot']);
      if (target === 'runtime HP') row(mechanics['runtime'])['maxHp'] = 99999;
      if (target === 'effective stat') row(mechanics['effectiveStats'])['S'] = 99999;
      if (target === 'skill bonus') row((mechanics['skills'] as JsonObject[])[0])['bonus'] = 99999;
      if (target === 'weapon facts')
        row(row(mechanics['property'])['weapon'])['name'] = 'Unrelated weapon';
      if (target === 'physical receipt')
        row((doc['creationRandomReceipts'] as JsonObject[])[0])['faces'] = [2, 2, 2, 2, 2, 2, 2];
      if (target === 'provenance') row(doc['provenance'])['finalSnapshotVersion'] = 999;
      if (target === 'metadata revision') {
        doc['metadataRevision'] = 1;
        row(doc['provenance'])['metadataRevision'] = 1;
      }
    });
    // These finite, known-schema values are insufficient evidence by themselves.
    validateArchivedLocalExportDocument(altered.document, baseline);
    error(() => receive(c, undefined, altered.descriptor, altered.document));
  });

  it('rejects rewritten mechanics even after the private snapshot and FINAL mechanics hashes are recomputed', () => {
    const c = prepared();
    const w = witness(c);
    alterPayload(w, (payload) => {
      const stage = row(payload['finalizationStage']);
      const finalSnapshot = row(stage['finalMechanicsSnapshotOrNull']);
      row(row(finalSnapshot['mechanics'])['effectiveStats'])['S'] = 99999;
      const snapshotHash = creationFinalizationHash(finalSnapshot);
      row(row(payload['receipt'])['result'])['mechanicsSnapshotHashOrNull'] = snapshotHash;
      const last = (stage['records'] as JsonObject[]).at(-1)!;
      row(row(last['receipt'])['result'])['mechanicsSnapshotHashOrNull'] = snapshotHash;
    });
    error(() => receive(c, canonicalPostSaveJson(w)));
  });

  it('rejects a rechecksummed changed metadata baseline at revision zero', () => {
    const c = prepared();
    const changed = alteredExport(c, (doc) => {
      row(doc['metadata'])['name'] = 'Different baseline name';
    });
    validateArchivedLocalExportDocument(changed.document, baseline);
    error(() => receive(c, undefined, changed.descriptor, changed.document));
  });

  it.each([
    'schemaVersion',
    'sourceUuid',
    'sourceSnapshotId',
    'metadataRevision',
    'sourceChecksum',
    'exportChecksum',
    'exportBytesSha256',
    'baselineVersion',
  ])('rejects a changed or extra descriptor field %s', (key) => {
    const c = prepared();
    error(() =>
      receive(c, undefined, {
        ...c.descriptor,
        [key]: key === 'metadataRevision' ? 999 : 'foreign',
      }),
    );
  });
  it('rejects unknown fields at the wrapper, original row, checkpoint and expected export boundaries', () => {
    const c = prepared();
    for (const target of ['wrapper', 'row', 'checkpoint', 'export'] as const) {
      const w = witness(c);
      const doc = row(structuredClone(c.exportDocument));
      if (target === 'wrapper') row(w)['sessionTicket'] = 'private-foreign';
      if (target === 'row') row(w.localCharacter)['ownerDeviceId'] = 'foreign';
      if (target === 'checkpoint') row(w.checkpoint)['privateKeyPkcs8Base64'] = 'foreign';
      if (target === 'export') doc['privateWitness'] = w.localCharacter.payloadJson;
      error(() => receive(c, canonicalPostSaveJson(w), undefined, doc));
    }
  });
  it('rejects unknown baseline, mixed expected owner and malformed/noncanonical JSON with fixed private errors', () => {
    const c = prepared();
    error(() => receive(c, undefined, undefined, undefined, 'another-owner'));
    error(() =>
      receive(c, undefined, undefined, undefined, fixture().owner, {
        ...baseline,
        baselineVersion: 'foreign-baseline',
      }),
    );
    for (const value of [
      null,
      {},
      'PRIVATE_BAD_INPUT',
      '[1]',
      `${c.canonicalWitnessText}\n`,
      c.canonicalWitnessText.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    ]) {
      const e = error(() => receive(c, value));
      expect(JSON.stringify(e)).not.toContain('PRIVATE_BAD_INPUT');
      expect(e.cause).toBeUndefined();
    }
  });
  it('never invokes caller-supplied export/descriptor accessors and does not return private witness fields', () => {
    const c = prepared();
    const getter = vi.fn(() => {
      throw new Error('PRIVATE_ACCESSOR');
    });
    const doc = { ...c.exportDocument };
    Object.defineProperty(doc, 'metadata', { get: getter, enumerable: true });
    error(() => receive(c, undefined, undefined, doc));
    const d = { ...c.descriptor };
    Object.defineProperty(d, 'sourceUuid', { get: getter, enumerable: true });
    error(() => receive(c, undefined, d));
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(receive(c))).not.toContain('payloadJson');
    expect(JSON.stringify(receive(c))).not.toContain('canonicalWitnessText');
  });
});
