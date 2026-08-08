/**
 * artifacts/ → generated/
 *
 *   npm run import
 *
 * Order matters. The checksum gate runs before a single artifact byte is read:
 * importing from a drifted source would produce a `generated/` that looks valid
 * and is not. Everything downstream fails closed — see tools/import/lib/fail.ts.
 */
import { describeFailure, verify } from '../checksums/manifest.js';
import { importAtlas } from './atlas.js';
import { importCharacter } from './character.js';
import { importBestiary } from './bestiary.js';
import { importEffects } from './effects.js';
import { importItems } from './items.js';
import { ImportError } from './lib/fail.js';
import { importRules } from './rules.js';
import { importSentient } from './sentient.js';

async function gate(): Promise<void> {
  const result = await verify();
  const failure = describeFailure(result);
  if (failure !== null) {
    console.error(failure);
    throw new ImportError('checksums', 'artifacts/ failed verification; import aborted');
  }
  console.log(`checksums: OK, ${result.tracked} artifact(s) verified`);
}

async function main(): Promise<number> {
  await gate();

  // Rules first: it is the senior source of mechanics and every other registry
  // references its Rule IDs.
  const rules = await importRules();
  console.log(
    `rules:     ${String(rules.activeIds.length)} active, ` +
      `${String(rules.tombstoneIds.length)} tombstone`,
  );

  // Character references rule ids, so it validates against the catalogue Rules
  // just produced rather than trusting them.
  const character = await importCharacter(rules.catalogue);
  console.log(
    `character: ${String(character.payloads)} payload entities, ` +
      `${String(character.xpSections)} XP contract sections`,
  );

  const items = await importItems(rules.catalogue);
  console.log(
    `items:     ${String(items.items)} item types, ${String(items.icons)} icons ` +
      `(${(items.mediaBytes / 1024).toFixed(0)} KiB → generated/media/items)`,
  );

  const effects = await importEffects(rules.catalogue);
  console.log(
    `effects:   ${String(effects.effectTypes)} effect types ` +
      `(${String(effects.modeled)} modeled, ${String(effects.notModeled)} not)`,
  );

  const bestiary = await importBestiary(rules.catalogue);
  console.log(
    `bestiary:  ${String(bestiary.species)} species, ${String(bestiary.templates)} templates, ` +
      `${String(bestiary.arts)} arts (${(bestiary.mediaBytes / 1024 / 1024).toFixed(1)} MiB)`,
  );

  const sentient = await importSentient();
  console.log(
    `sentient:  ${String(sentient.templates)} frozen templates, ${String(sentient.arts)} arts, ` +
      `pack ${String(sentient.packFiles)} files (${(sentient.mediaBytes / 1024 / 1024).toFixed(1)} MiB)`,
  );

  const atlas = await importAtlas();
  console.log(`atlas:     ${String(atlas.formIds.length)} forms`);

  const files = [
    ...rules.files,
    ...character.files,
    ...items.files,
    ...effects.files,
    ...bestiary.files,
    ...sentient.files,
    ...atlas.files,
  ];
  const bytes =
    rules.bytesWritten +
    character.bytesWritten +
    items.bytesWritten +
    effects.bytesWritten +
    bestiary.bytesWritten +
    sentient.bytesWritten +
    atlas.bytesWritten;
  const mib = (bytes / 1024 / 1024).toFixed(2);
  console.log(`written:   ${mib} MiB across ${String(files.length)} file(s) + media`);
  return 0;
}

try {
  process.exit(await main());
} catch (error) {
  if (error instanceof ImportError) {
    console.error(`\nimport failed — ${error.message}`);
    process.exit(1);
  }
  throw error;
}
