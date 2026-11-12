import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { SentientAuthoringCatalog } from '../domain/entities/enemy-template/sentient-authoring.js';
import type { NpcAuthoringSourceCatalog } from './npc-catalog.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import { ENEMY_PLACEHOLDER } from '@shared/enemy-authoring.js';
import { ENEMY_AUTHORING_SOURCE_SEALS } from './enemy-authoring-source-seals.js';
import { array, record, string } from './json-source.js';
import { npcInventoryMetadataChoices } from '../domain/rules/npc-authoring/inventory.js';

export interface EnemyAuthoringSourceCatalog extends SentientAuthoringCatalog {
  readonly assertCurrent: () => void;
  readonly choices: JsonObject;
  readonly art: {
    readonly mediaType: 'image/png';
    readonly sha256: string;
    readonly bytesBase64: string;
  };
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Reuse only issued common arithmetic/item components, never the NPC identity/lifetime builder. */
export function loadEnemyAuthoringSourceCatalog(
  root: string,
  common: NpcAuthoringSourceCatalog,
): EnemyAuthoringSourceCatalog {
  const fail = (detail: string): never => {
    throw new Error('enemy authoring source: ' + detail);
  };
  const assertCurrent = () => {
    for (const [path, expected] of Object.entries(ENEMY_AUTHORING_SOURCE_SEALS))
      if (sha(readFileSync(join(root, path))) !== expected) fail('changed source ' + path);
  };
  assertCurrent();
  const rows = (path: string) =>
    array(
      JSON.parse(readFileSync(join(root, 'generated/spec/character', path), 'utf8')) as unknown,
      path,
    ).map((value) => record(value, path));
  const skills = rows('skills.json'),
    races = rows('races.json'),
    classes = rows('classes.json');
  const label = (entries: readonly Record<string, unknown>[], key: string, value: string) => {
    const matches = entries.filter((row) => row[key] === value);
    if (matches.length !== 1) return fail('missing unique label ' + value);
    return string(matches[0]!['Название'], 'source label');
  };
  const skillLabels = Object.fromEntries(
    common.skills.skills.map((skill) => [
      skill.skillKey,
      label(skills, 'SkillKey', skill.skillKey),
    ]),
  );
  const artRows = array(
    JSON.parse(
      readFileSync(join(root, 'generated/spec/gm-entity-portraits/catalog.json'), 'utf8'),
    ) as unknown,
    'GM art',
  ).map((value) => record(value, 'GM art row'));
  const matching = artRows.filter(
    (row) =>
      row['assetKey'] === ENEMY_PLACEHOLDER &&
      row['entityKind'] === 'SENTIENT' &&
      row['raceCodeOrNull'] === null &&
      row['sexOrNull'] === null,
  );
  if (matching.length !== 1) return fail('SENTIENT placeholder absent/ambiguous');
  const asset = matching[0]!,
    bytes = readFileSync(join(root, 'generated/media', string(asset['mediaPath'], 'art path')));
  const digest = sha(bytes);
  if (digest !== asset['sha256']) return fail('placeholder bytes differ');
  const inventoryMetadata = npcInventoryMetadataChoices(common.inventory);
  if (inventoryMetadata === null) return fail('source-bound inventory metadata unavailable');
  const choices = {
    compositionCatalog: {
      species: common.symbionts.species.map(
        ({ speciesKey, speciesLabel, kind, allowedRaceCodes, slotCost, bindingPolicy }) => ({
          speciesKey,
          name: speciesLabel,
          kind,
          allowedRaceCodes,
          slotCost,
          bindingPolicy,
        }),
      ),
      races: common.symbionts.races,
      levels: common.development.levels.map(({ speciesKey, levelProfileId, level, baseMaxOE }) => ({
        speciesKey,
        levelProfileId,
        level,
        baseMaxOE,
      })),
      nodes: common.development.nodes,
    },
    inventoryMetadata,
    buildOptions: [],
    races: common.skills.races.map((race) => ({
      raceCode: race.raceCode,
      name: label(races, 'RaceCode', race.raceCode),
      classPolicy: race.classPolicy,
    })),
    classes: common.skills.classes.map((c) => ({
      classCode: c.classCode,
      name: label(classes, 'ClassCode', c.classCode),
    })),
    skills: common.skills.skills.map((skill) => ({
      ...skill,
      name: skillLabels[skill.skillKey]!,
      requirements: common.skills.requirements.filter((r) => r.skillKey === skill.skillKey),
    })),
    items: common.inventory.definitions
      .filter((item) => item.inventoryAllowed === true)
      .map((item) => ({
        itemTypeId: item.itemTypeId,
        name: item.name,
        category: item.category,
        equippable: item.equippable,
        composite: item.composite,
        components: item.components,
        armorOrNull: item.armorOrNull,
        catalogueSource: item.catalogueSource,
        profileSource: item.profileSource,
        weaponProfiles: common.inventory.weapons.entries
          .filter((weapon) => weapon.weaponTypeId === item.itemTypeId)
          .map((weapon) => ({
            weaponVariant: weapon.weaponVariant,
            variantLabel: weapon.variantLabel,
            canonicalProfileVersion: weapon.canonicalProfileVersion,
            profileKind: weapon.profileKind,
            template: weapon.template,
          })),
      })),
  } as unknown as JsonObject;
  const freeze = (value: unknown): void => {
    if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(choices);
  return Object.freeze({
    composition: Object.freeze({
      symbionts: common.symbionts,
      development: common.development,
      native: common.nativeSymbionts,
      structural: common.ordinaryComposition,
      rules: array(
        JSON.parse(readFileSync(join(root, 'generated/spec/rules/rules.json'), 'utf8')) as unknown,
        'rules',
      ).map((value) => record(value, 'rule')),
    }),
    equipment: common.equipment,
    skills: common.skills,
    inventory: common.inventory,
    inventoryPublication: common.inventoryPublication,
    passiveHealth: common.passiveHealth,
    skillLabels: Object.freeze(skillLabels),
    choices,
    art: Object.freeze({
      mediaType: 'image/png' as const,
      sha256: digest,
      bytesBase64: bytes.toString('base64'),
    }),
    assertCurrent,
  });
}
