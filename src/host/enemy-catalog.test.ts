import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { beforeAll, expect, it } from 'vitest';
import {
  loadLocalCharacterExportBaseline,
  type LocalCharacterExportBaseline,
} from './local-character-export.js';
import { loadEnemySourceCatalog } from './enemy-catalog.js';
import { enemyLibraryProjectionValue, type EnemyLibrarySelection } from '@shared/enemy-library.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
let baseline: LocalCharacterExportBaseline;
beforeAll(async () => {
  baseline = await loadLocalCharacterExportBaseline(projectRoot);
});
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
it('ENM-001 separates 44 exact frozen payloads from 16 canonical species / 17 statblocks', () => {
  const catalog = loadEnemySourceCatalog(projectRoot, baseline);
  expect(catalog.systemTemplates).toHaveLength(44);
  expect(catalog.canonicalTemplates).toHaveLength(17);
  expect(new Set(catalog.canonicalTemplates.map((x) => x.speciesIdOrNull)).size).toBe(16);
  expect(catalog.systemTemplates.every((x) => x.origin === 'SYSTEM_DEFAULT_SENTIENT')).toBe(true);
  expect(catalog.canonicalTemplates.every((x) => x.origin === 'CANONICAL_BESTIARY')).toBe(true);
  const packed = unzipSync(
    readFileSync(
      join(
        projectRoot,
        'artifacts/packs/Symbiosis_V7_Default_Sentient_Enemy_Runtime_Pack_v1.2.zip',
      ),
    ),
  );
  const source = JSON.parse(Buffer.from(packed['runtime-pack/catalog.json']!).toString()) as {
    templates: { systemTemplateId: string; artFile: string; progressionPolicy: string }[];
    payloadSha256BySystemTemplateId: Record<string, string>;
  };
  for (const entry of catalog.systemTemplates) {
    const card = catalog.card(entry),
      payload = source.templates.find((x) => x.systemTemplateId === entry.templateId)!;
    expect(card.payloadSha256).toBe(source.payloadSha256BySystemTemplateId[entry.templateId]);
    expect(payload.progressionPolicy).toBe('NO_XP_PROGRESSION');
    const art = packed['runtime-pack/art/' + payload.artFile]!;
    expect(Buffer.from(card.art.bytesBase64, 'base64').equals(Buffer.from(art))).toBe(true);
    expect(card.art.sha256).toBe(hash(art));
    expect(() =>
      enemyLibraryProjectionValue({
        kind: 'SYSTEM_LIBRARY',
        formId: 'ENM-003',
        contextId: '00000000-0000-4000-8000-000000000001',
        campaignId: '00000000-0000-4000-8000-000000000002',
        campaignStatus: 'PAUSED',
        stateRevision: 1,
        projectionRevision: 1,
        actorVisibilityRevision: 0,
        defaultSentientCatalogVersion: catalog.catalogVersion,
        catalogBaselineVersion: catalog.baselineVersion,
        activeTab: 'SENTIENT_ENEMIES',
        systemTemplates: catalog.systemTemplates,
        canonicalTemplates: catalog.canonicalTemplates,
        currentUserTemplates: [],
        selectedOrNull: {
          origin: entry.origin,
          templateId: entry.templateId,
          catalogVersion: entry.catalogVersion,
          artAssetKey: entry.artAssetKey,
        },
        systemTemplateArtAssetKey: entry.artAssetKey,
        cardOrNull: card,
      }),
    ).not.toThrow();
    expect(JSON.stringify(card.fields)).not.toMatch(
      /itemInstanceTemplateKey|deepCloneOnInstantiation|issuedBy|provenanceRuleId|initialRuntimeState|devourThresholdPolicy|sourceRuleId|profileRuleId/,
    );
    expect(JSON.stringify(card)).not.toMatch(
      /"(?:groupId|location|subLocation|markerRevision|sceneId|combatId|inCombat|preparedActions)"/,
    );
  }
  // The returned arrays/cards cannot rewrite the source held by the host.
  (catalog.systemTemplates[0] as { templateId: string }).templateId = 'foreign';
  expect(catalog.systemTemplates[0]!.templateId).toBe(source.templates[0]!.systemTemplateId);
});
it.each(['origin', 'templateId', 'catalogVersion', 'artAssetKey'] as const)(
  'ENM-003 refuses foreign selected %s rather than assigning a default',
  (key) => {
    const catalog = loadEnemySourceCatalog(projectRoot, baseline);
    const selected = {
      ...catalog.systemTemplates[0]!,
      [key]: 'foreign',
    } as unknown as EnemyLibrarySelection;
    expect(() => catalog.resolve(selected)).toThrow('selected identity');
    expect(() => catalog.card(selected)).toThrow('selected identity');
  },
);
it('refuses corrupted delivered source bytes and detects source drift after the load', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enemy-source-'));
  try {
    mkdirSync(join(directory, 'artifacts/packs'), { recursive: true });
    cpSync(
      join(projectRoot, 'artifacts/CHECKSUMS.sha256'),
      join(directory, 'artifacts/CHECKSUMS.sha256'),
    );
    cpSync(
      join(
        projectRoot,
        'artifacts/packs/Symbiosis_V7_Default_Sentient_Enemy_Runtime_Pack_v1.2.zip',
      ),
      join(directory, 'artifacts/packs/Symbiosis_V7_Default_Sentient_Enemy_Runtime_Pack_v1.2.zip'),
    );
    for (const category of ['sentient', 'bestiary'])
      cpSync(
        join(projectRoot, 'generated/spec', category),
        join(directory, 'generated/spec', category),
        { recursive: true },
      );
    const catalog = loadEnemySourceCatalog(directory, baseline);
    catalog.assertCurrent();
    const file = join(directory, 'generated/spec/sentient/arts.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('ART-SENT-001', 'foreign-art'));
    expect(() => catalog.assertCurrent()).toThrow('source output changed');
    expect(() => loadEnemySourceCatalog(directory, baseline)).toThrow('source output differs');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
