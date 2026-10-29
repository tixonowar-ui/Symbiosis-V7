import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  createCreationFinalizationSetup,
  creationPropertySummaryRequest,
  creationFinalSaveRequest,
} from '../../tests/fixtures/creation-finalization-stage.js';
import { commitCreationFinalization } from './creation-finalization.js';
import { loadCreationWizardCheckpoint } from './creation-set-decide.js';
import { openPersistenceDatabase } from '../persistence/index.js';
import {
  canonicalPostSaveJson,
  deriveLocalFinalExport,
  loadLocalCharacterExportBaseline,
  postSaveSha256,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';

type Setup = Awaited<ReturnType<typeof createCreationFinalizationSetup>>;
const setups: Setup[] = [];
afterEach(() => {
  for (const p of setups.splice(0)) if (p.setup.database.open) p.setup.database.close();
});
let baseline: LocalCharacterExportBaseline;
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(process.cwd());
});
const owner = {
  ownerContext: 'PLAYER_LOCAL',
  sourceKind: 'LOCAL_FINAL',
  originFormId: 'CHR-040',
  returnFormId: 'CHR-040',
  activeLocalOwnerIdOrNull: 'stored-device',
  masterAuthorityRevisionOrNull: null,
} as const;
async function final(raceChoice: 'FREE' | 'PURE', diceInputMode: 'AUTO' | 'MANUAL', path?: string) {
  const p = await createCreationFinalizationSetup({
    prefix: `export-${raceChoice}-${diceInputMode}`,
    raceChoice,
    diceInputMode,
    ...(path === undefined ? {} : { databasePath: path }),
  });
  setups.push(p);
  let current = commitCreationFinalization(
    p.setup.database,
    creationPropertySummaryRequest(p.current, 'export-summary'),
    'export-summary-receipt',
    p.dependencies,
  );
  current = commitCreationFinalization(
    p.setup.database,
    creationFinalSaveRequest(current, 'export-final'),
    'export-final-receipt',
    p.dependencies,
  );
  return { p, current };
}
const metadata = {
  name: 'Экспортированный персонаж',
  description: 'Сохранённая локальная версия',
  artAssetKeyOrLocalFile: null,
} as const;

describe('canonical final character export', () => {
  it('uses exact baseline bytes and source runtime provenance, with deterministic finite JSON', () => {
    expect(baseline.baselineVersion).toBe(
      `sha256:${postSaveSha256(readFileSync('artifacts/CHECKSUMS.sha256'))}`,
    );
    expect(baseline.registryVersion).toBe('1.2');
    expect(baseline.builtAgainstTuple).toContain('Rules v1.6');
    expect(canonicalPostSaveJson({ z: [-0, 'я'], a: { y: 2, x: 1 } })).toBe(
      '{"a":{"x":1,"y":2},"z":[0,"я"]}',
    );
    const sparse: number[] = [];
    sparse.length = 2;
    for (const value of [NaN, Infinity, undefined, { a: undefined }, new Date(), sparse])
      expect(() => canonicalPostSaveJson(value)).toThrow();
  });
  it.each(['FREE', 'PURE'] as const)(
    'exports %s with exact property receipts and named mechanics, without internal identifiers',
    async (race) => {
      const { p, current } = await final(race, 'AUTO');
      const before = current.localCharacter.payloadJson;
      const result = deriveLocalFinalExport(current, metadata, 2, owner, baseline);
      const dto = JSON.parse(result.contentText) as Record<string, unknown>;
      const { checksum, ...body } = dto;
      expect(checksum).toBe(postSaveSha256(canonicalPostSaveJson(body)));
      expect(result.bytesSha256).toBe(postSaveSha256(result.contentText));
      expect(result.contentText.endsWith('\n')).toBe(true);
      expect(result.contentText.startsWith('\uFEFF')).toBe(false);
      expect(result.sourceSnapshotId).toBe('export-final-receipt');
      expect(result.finalSnapshotVersion).toBe(current.receipt.result.draftRevision);
      expect(result.provenance['sourceChecksum']).toBe(
        current.finalizationStage!.records.at(-1)!.receipt.result.mechanicsSnapshotHashOrNull,
      );
      expect(
        result.creationRandomReceipts.filter((r) =>
          [
            'ARMOR_BUNDLE_QUALITY',
            'STARTING_WEAPON_QUALITY',
            'STARTING_MONEY',
            'FIVE_STARTING_POSITION_QUALITY',
          ].includes(r['kind'] as string),
        ),
      ).toHaveLength(8);
      expect(result.creationRandomReceipts.every((r) => r['diceInputMode'] === 'AUTO')).toBe(true);
      expect(result.mechanicsSnapshot['runtime']).toMatchObject({
        equippedItems: [],
        alive: true,
        wounds: [],
      });
      expect(result.mechanicsSnapshot['manufacturingReceipts']).toHaveLength(
        race === 'FREE' ? 3 : 0,
      );
      const forbidden =
        /learnedNodeRefs|Rule IDs|Источник|availability|profileRuleId|SYM-\d+|CORE-\d+|SKL-\d+|checkpointOwnerId|correctionHeadHash/u;
      expect(result.contentText).not.toMatch(forbidden);
      if (race === 'FREE') {
        const species = result.mechanicsSnapshot['symbionts'] as readonly {
          readonly learnedNodes: readonly { readonly label: string; readonly level: number }[];
        }[];
        expect(species[0]!.learnedNodes[0]!.label).toBeTypeOf('string');
        expect(species[0]!.learnedNodes[0]!.level).toBe(1);
      }
      expect(deriveLocalFinalExport(current, metadata, 2, owner, baseline)).toEqual(result);
      expect(
        loadCreationWizardCheckpoint(
          p.setup.database,
          p.setup.characterDraftId,
          p.setup.catalog.skillStage,
          p.setup.catalog,
        ).localCharacter.payloadJson,
      ).toBe(before);
    },
  );
  it('is byte-identical after real SQLite reopen and changes metadata without changing mechanics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'character-export-'));
    try {
      const path = join(directory, 'state.sqlite');
      const { p, current } = await final('FREE', 'MANUAL', path);
      const first = deriveLocalFinalExport(current, metadata, 0, owner, baseline);
      p.setup.database.close();
      const db = openPersistenceDatabase(path);
      try {
        const reloaded = loadCreationWizardCheckpoint(
          db,
          p.setup.characterDraftId,
          p.setup.catalog.skillStage,
          p.setup.catalog,
        );
        expect(deriveLocalFinalExport(reloaded, metadata, 0, owner, baseline).contentText).toBe(
          first.contentText,
        );
        const updated = deriveLocalFinalExport(
          reloaded,
          { ...metadata, name: 'Новое имя' },
          1,
          owner,
          baseline,
        );
        expect(updated.checksum).not.toBe(first.checksum);
        expect(updated.mechanicsSnapshot).toEqual(first.mechanicsSnapshot);
        expect(updated.creationRandomReceipts).toEqual(first.creationRandomReceipts);
        expect(updated.creationRandomReceipts.every((r) => r['diceInputMode'] === 'MANUAL')).toBe(
          true,
        );
      } finally {
        db.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('refuses a draft, mixed owner and checksum-valid corrupted final history', async () => {
    const { p, current } = await final('PURE', 'MANUAL');
    expect(() => deriveLocalFinalExport(p.current, metadata, 0, owner, baseline)).toThrow();
    expect(() =>
      deriveLocalFinalExport(
        current,
        metadata,
        0,
        { ...owner, activeLocalOwnerIdOrNull: '' },
        baseline,
      ),
    ).toThrow();
    const payload = JSON.parse(current.localCharacter.payloadJson) as {
      finalizationStage: {
        finalMechanicsSnapshotOrNull: { mechanics: { effectiveStats: { S: number } } };
      };
    };
    payload.finalizationStage.finalMechanicsSnapshotOrNull.mechanics.effectiveStats.S++;
    const payloadJson = JSON.stringify(payload);
    const snapshot = JSON.parse(current.checkpoint.snapshotJson) as {
      localCharacter: { payloadJson: string };
    };
    snapshot.localCharacter.payloadJson = payloadJson;
    const snapshotJson = JSON.stringify(snapshot);
    expect(() =>
      deriveLocalFinalExport(
        {
          ...current,
          localCharacter: { ...current.localCharacter, payloadJson },
          checkpoint: {
            ...current.checkpoint,
            snapshotJson,
            snapshotSha256: postSaveSha256(snapshotJson),
          },
        },
        metadata,
        0,
        owner,
        baseline,
      ),
    ).toThrow();
  });
});
