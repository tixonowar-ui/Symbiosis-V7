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
import {
  CUSTOM_MONSTER_PLACEHOLDER,
  CUSTOM_MONSTER_PLACEHOLDER_SHA256,
} from '@shared/custom-monster.js';
import type { CustomMonsterFullCatalog } from '../domain/entities/enemy-template/custom-monster-authoring.js';

export interface EnemyAuthoringSourceCatalog extends SentientAuthoringCatalog {
  readonly assertCurrent: () => void;
  readonly choices: JsonObject;
  readonly monster: CustomMonsterFullCatalog;
  readonly monsterChoices: JsonObject;
  readonly assertMonsterCurrent: () => void;
  readonly monsterArt: EnemyAuthoringSourceCatalog['art'];
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
  const monsterAssets = artRows.filter(
    (row) =>
      row['assetKey'] === CUSTOM_MONSTER_PLACEHOLDER &&
      row['entityKind'] === 'CUSTOM_MONSTER' &&
      row['raceCodeOrNull'] === null &&
      row['sexOrNull'] === null,
  );
  if (monsterAssets.length !== 1) return fail('CUSTOM_MONSTER placeholder absent/ambiguous');
  const monsterAsset = monsterAssets[0]!,
    monsterPath = join(
      root,
      'generated/media',
      string(monsterAsset['mediaPath'], 'monster art path'),
    );
  const monsterBytes = readFileSync(monsterPath);
  if (
    monsterAsset['sha256'] !== CUSTOM_MONSTER_PLACEHOLDER_SHA256 ||
    sha(monsterBytes) !== CUSTOM_MONSTER_PLACEHOLDER_SHA256
  )
    return fail('monster placeholder bytes differ');
  const assertMonsterCurrent = () => {
    if (sha(readFileSync(monsterPath)) !== CUSTOM_MONSTER_PLACEHOLDER_SHA256)
      fail('changed monster placeholder');
  };
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
  const ordinarySpecies = common.symbionts.species.filter((row) => row.kind === 'ORDINARY');
  const ordinaryKeys = new Set(ordinarySpecies.map((row) => row.speciesKey));
  const monsterChoices = {
    compositionCatalog: {
      species: ordinarySpecies.map(
        ({ speciesKey, speciesLabel, kind, allowedRaceCodes, slotCost, bindingPolicy }) => ({
          speciesKey,
          name: speciesLabel,
          kind,
          allowedRaceCodes,
          slotCost,
          bindingPolicy,
        }),
      ),
      races: [],
      levels: common.development.levels
        .filter((row) => ordinaryKeys.has(row.speciesKey))
        .map(({ speciesKey, levelProfileId, level, baseMaxOE }) => ({
          speciesKey,
          levelProfileId,
          level,
          baseMaxOE,
        })),
      nodes: common.development.nodes.filter((row) => ordinaryKeys.has(row.speciesKey)),
    },
    advisorSkills: common.skills.skills
      .filter((row) => row.category === 'SELECTABLE_GENERAL')
      .map((row) => ({
        skillKey: row.skillKey,
        name: skillLabels[row.skillKey],
        maxBonus: row.maxBonus,
        requirements: common.skills.requirements
          .filter((req) => req.skillKey === row.skillKey)
          .map(({ statCode, minValue }) => ({ statCode, minValue })),
      })),
  } as unknown as JsonObject;
  freeze(monsterChoices);
  const ruleRows = array(
    JSON.parse(readFileSync(join(root, 'generated/spec/rules/rules.json'), 'utf8')) as unknown,
    'rules',
  ).map((value) => record(value, 'rule'));
  const monster: CustomMonsterFullCatalog = Object.freeze({
    symbionts: common.symbionts,
    development: common.development,
    native: common.nativeSymbionts,
    passiveHealth: common.passiveHealth,
    rules: ruleRows,
    skills: common.skills,
    skillLabels: Object.freeze(skillLabels),
  });
  return Object.freeze({
    composition: Object.freeze({
      symbionts: common.symbionts,
      development: common.development,
      native: common.nativeSymbionts,
      structural: common.ordinaryComposition,
      rules: ruleRows,
    }),
    equipment: common.equipment,
    skills: common.skills,
    inventory: common.inventory,
    inventoryPublication: common.inventoryPublication,
    passiveHealth: common.passiveHealth,
    skillLabels: Object.freeze(skillLabels),
    choices,
    monster,
    monsterChoices,
    assertMonsterCurrent,
    monsterArt: Object.freeze({
      mediaType: 'image/png' as const,
      sha256: CUSTOM_MONSTER_PLACEHOLDER_SHA256,
      bytesBase64: monsterBytes.toString('base64'),
    }),
    art: Object.freeze({
      mediaType: 'image/png' as const,
      sha256: digest,
      bytesBase64: bytes.toString('base64'),
    }),
    assertCurrent,
  });
}
