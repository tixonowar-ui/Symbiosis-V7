import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RaceCode } from '@generated/types/character.js';
import type { CampaignArtValue } from '@shared/campaign-creation.js';
import { campaignArtChecksum } from './campaign-draft-validation.js';
import { readJsonFile } from './json-source.js';

/** ADR 0077 / artifacts/gm-entity-portraits/manifest.json: UNITED → unified is explicit. */
const NPC_DEFAULTS = [
  ['FREE', 'FEMALE', 'symbiosis_placeholder_free_female'],
  ['FREE', 'MALE', 'symbiosis_placeholder_free_male'],
  ['PURE', 'FEMALE', 'symbiosis_placeholder_pure_female'],
  ['PURE', 'MALE', 'symbiosis_placeholder_pure_male'],
  ['UNITED', 'FEMALE', 'symbiosis_placeholder_unified_female'],
  ['UNITED', 'MALE', 'symbiosis_placeholder_unified_male'],
] as const;
export interface NpcResolvedArt {
  readonly assetKey: string;
  readonly mediaType: 'image/png' | 'image/jpeg';
  readonly sha256: string;
  readonly bytesBase64: string;
}
export interface NpcArtCatalog {
  readonly defaults: readonly Readonly<{
    raceCode: RaceCode;
    sex: 'FEMALE' | 'MALE';
    art: NpcResolvedArt;
  }>[];
}
function fail(detail: string): never {
  throw new Error(`NPC art: ${detail}`);
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return fail('plain data record required');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    return fail('unexpected or missing fields');
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (field === undefined || !field.enumerable || !Object.hasOwn(field, 'value'))
      return fail('own data fields required');
    result[key] = field.value as unknown;
  }
  return result;
}
function text(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : fail('nonempty string required');
}
/** Host preparation checks real bytes before any durable attempt mutation; no race default is needed. */
export function readNpcUploadedArt(value: unknown): NpcResolvedArt {
  const row = record(value, ['kind', 'mediaType', 'bytesBase64']);
  if (
    row.kind !== 'local-file' ||
    (row.mediaType !== 'image/png' && row.mediaType !== 'image/jpeg')
  )
    return fail('unknown upload kind/media type');
  const art: CampaignArtValue = {
    kind: 'local-file',
    mediaType: row.mediaType,
    bytesBase64: text(row.bytesBase64),
  };
  // ADR 0077 keeps the existing PNG/JPEG byte interpretation and 12 MiB transport bound.
  const sha256 = campaignArtChecksum(art);
  if (sha256 === null) return fail('upload checksum absent');
  return Object.freeze({
    assetKey: `npc-upload:${sha256}`,
    mediaType: art.mediaType,
    sha256,
    bytesBase64: art.bytesBase64,
  });
}
const issued = new WeakSet<NpcArtCatalog>();
function checkedCatalog(catalog: NpcArtCatalog): NpcArtCatalog {
  return issued.has(catalog) ? catalog : fail('host-loaded art catalog required');
}
/** Read before the SQL transaction; the returned bytes remain pinned even if a source file later changes. */
export async function loadNpcArtCatalog(projectRoot: string): Promise<NpcArtCatalog> {
  const raw = await readJsonFile(
    join(projectRoot, 'generated/spec/gm-entity-portraits/catalog.json'),
    'NPC art',
  );
  if (!Array.isArray(raw)) return fail('imported catalog must be an array');
  const rows: readonly unknown[] = raw;
  const entries = rows.map((row) =>
    record(row, ['assetKey', 'entityKind', 'mediaPath', 'raceCodeOrNull', 'sexOrNull', 'sha256']),
  );
  const npcRows = entries.filter((row) => row.entityKind === 'NPC');
  if (npcRows.length !== NPC_DEFAULTS.length)
    return fail('exact six approved NPC mappings required');
  const defaults = await Promise.all(
    NPC_DEFAULTS.map(async ([raceCode, sex, assetKey]) => {
      const matches = npcRows.filter(
        (row) => row.raceCodeOrNull === raceCode && row.sexOrNull === sex,
      );
      const row = matches[0];
      if (
        matches.length !== 1 ||
        row === undefined ||
        row.assetKey !== assetKey ||
        row.mediaPath !== `local-character-portraits/${assetKey}.png`
      )
        return fail(`invalid source mapping ${raceCode}/${sex}`);
      const sha256 = text(row.sha256);
      if (!/^[0-9a-f]{64}$/u.test(sha256)) return fail('invalid source checksum');
      const bytes = await readFile(join(projectRoot, 'generated/media', text(row.mediaPath)));
      if (createHash('sha256').update(bytes).digest('hex') !== sha256)
        return fail(`source bytes differ for ${assetKey}`);
      const validated = readNpcUploadedArt({
        kind: 'local-file',
        mediaType: 'image/png',
        bytesBase64: bytes.toString('base64'),
      });
      return Object.freeze({ raceCode, sex, art: Object.freeze({ ...validated, assetKey }) });
    }),
  );
  const catalog: NpcArtCatalog = Object.freeze({ defaults: Object.freeze(defaults) });
  issued.add(catalog);
  return catalog;
}
/** Historical reads validate the pinned choice; they never resolve today's race/sex default. */
export function readNpcRetainedArt(catalog: NpcArtCatalog, value: unknown): NpcResolvedArt {
  const row = record(value, ['assetKey', 'mediaType', 'sha256', 'bytesBase64']);
  const assetKey = text(row.assetKey);
  const checked = readNpcUploadedArt({
    kind: 'local-file',
    mediaType: row.mediaType,
    bytesBase64: row.bytesBase64,
  });
  if (row.sha256 !== checked.sha256) return fail('saved art checksum differs');
  const known = checkedCatalog(catalog).defaults.find(
    (entry) => entry.art.assetKey === assetKey,
  )?.art;
  if (known !== undefined) {
    if (
      known.sha256 !== checked.sha256 ||
      known.mediaType !== checked.mediaType ||
      known.bytesBase64 !== checked.bytesBase64
    )
      return fail('saved default bytes differ');
    return known;
  }
  if (assetKey !== checked.assetKey) return fail('unknown saved asset key');
  return checked;
}
/** INHERIT is the N+1 opening choice; REPLACE/null is the explicit clear action. */
export function resolveNpcVersionArt(
  catalog: NpcArtCatalog,
  choice: unknown,
  context: {
    readonly raceCode: RaceCode;
    readonly sex: 'FEMALE' | 'MALE';
    readonly previousArtOrNull: NpcResolvedArt | null;
  },
): NpcResolvedArt {
  checkedCatalog(catalog);
  const scope = record(context, ['raceCode', 'sex', 'previousArtOrNull']);
  const defaultArt = catalog.defaults.find(
    (entry) => entry.raceCode === scope.raceCode && entry.sex === scope.sex,
  )?.art;
  if (defaultArt === undefined) return fail('unknown race/sex mapping');
  if (choice === null || typeof choice !== 'object') return fail('explicit art choice required');
  const kind = Object.getOwnPropertyDescriptor(choice, 'kind');
  if (kind === undefined || !Object.hasOwn(kind, 'value')) return fail('art choice kind required');
  const discriminant: unknown = kind.value;
  if (discriminant === 'INHERIT') {
    record(choice, ['kind']);
    if (scope.previousArtOrNull === null) return fail('new NPC cannot inherit absent art');
    return readNpcRetainedArt(catalog, scope.previousArtOrNull);
  }
  if (discriminant !== 'REPLACE') return fail('unknown art choice');
  const selected = record(choice, ['kind', 'value']).value;
  if (selected === null) return defaultArt;
  if (typeof selected !== 'object') return fail('invalid replacement');
  const selectedKind = Object.getOwnPropertyDescriptor(selected, 'kind');
  if (selectedKind === undefined || !Object.hasOwn(selectedKind, 'value'))
    return fail('replacement kind required');
  if (selectedKind.value === 'local-file') return readNpcUploadedArt(selected);
  const asset = record(selected, ['kind', 'assetKey']);
  if (asset.kind !== 'asset-key') return fail('unknown replacement kind');
  return (
    catalog.defaults.find((entry) => entry.art.assetKey === asset.assetKey)?.art ??
    fail('unknown selected asset key')
  );
}
