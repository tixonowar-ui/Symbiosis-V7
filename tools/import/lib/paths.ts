/**
 * Where the pipeline reads from and writes to.
 *
 * Artifact filenames carry versions, so they are listed once here rather than
 * being rebuilt from string fragments at each call site: a delivery that bumps a
 * version fails loudly in one place.
 */
import { join } from 'node:path';
import { ARTIFACTS_DIR, REPO_ROOT } from '../../checksums/manifest.js';

export { ARTIFACTS_DIR, REPO_ROOT };

export const GENERATED_DIR = join(REPO_ROOT, 'generated');
export const SPEC_DIR = join(GENERATED_DIR, 'spec');
export const TYPES_DIR = join(GENERATED_DIR, 'types');
export const SEED_DIR = join(GENERATED_DIR, 'seed');
export const MEDIA_DIR = join(GENERATED_DIR, 'media');

const REGISTRIES = join(ARTIFACTS_DIR, 'registries');
const ATLAS = join(ARTIFACTS_DIR, 'atlas');
const PACKS = join(ARTIFACTS_DIR, 'packs');

export const ARTIFACT = {
  atlasJson: join(ATLAS, 'Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json'),
  atlasMd: join(ATLAS, 'Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md'),
  rules: join(REGISTRIES, 'Symbiosis_V7_Executable_Rules_Registry_v1.7.xlsx'),
  character: join(REGISTRIES, 'Symbiosis_V7_Character_Skills_Symbionts_Registry_v1.2.xlsx'),
  items: join(REGISTRIES, 'Symbiosis_V7_Item_Registry_v1.6_with_icons.xlsx'),
  effects: join(REGISTRIES, 'Symbiosis_V7_Effects_and_Diseases_Registry_v1.2.xlsx'),
  bestiary: join(REGISTRIES, 'Symbiosis_V7_Canonical_Bestiary_Registry_v1.4.xlsx'),
  sentient: join(REGISTRIES, 'Symbiosis_V7_Default_Sentient_Enemy_Registry_v1.2.xlsx'),
  soundtrack: join(REGISTRIES, 'Symbiosis_V7_Soundtrack_Playback_Registry_v1.1.xlsx'),
  qna: join(REGISTRIES, 'Symbiosis_V7_All_Questions_and_Answers_Registry_v1.2.xlsx'),
  manifest: join(REGISTRIES, 'Symbiosis_V7_Delivery_Manifest_v1.2.xlsx'),
  audit: join(REGISTRIES, 'Symbiosis_V7_Cross_Registry_Audit_Report_v1.2.xlsx'),
  runtimePack: join(PACKS, 'Symbiosis_V7_Default_Sentient_Enemy_Runtime_Pack_v1.2.zip'),
} as const;
