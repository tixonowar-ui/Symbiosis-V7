import {
  recommendArmorQuality,
  validateArmorQualityFace,
  type ArmorQualityRecommendation,
} from './armor-bundle.js';

export interface FiveStartingPositionsCatalogEntry {
  readonly itemTypeIdOrStoryType: string;
  readonly kind: 'CATALOGUE' | 'STORY';
  readonly name: string;
}

export interface FiveStartingPositionsCatalog {
  readonly entries: readonly FiveStartingPositionsCatalogEntry[];
}

export interface FiveStartingPositionSelection {
  readonly positionId: string;
  readonly itemTypeIdOrStoryType: string;
  readonly quantity: number;
  readonly storyDescriptionOrNull: string | null;
}

export interface ValidatedFiveStartingPosition extends FiveStartingPositionSelection {
  readonly kind: 'CATALOGUE' | 'STORY';
  readonly name: string;
}

export type PositionQualityRecommendation = ArmorQualityRecommendation;

// AQA-012 and GEN-010 allow prose, never rule identifiers or a mechanical payload.
// Rejecting before commit preserves the player's actual text instead of silently rewriting it.
const INTERNAL_TEXT =
  /\b(?:CORE|SYM|MON|AQ\d?|AQA|CQA|Q[A-Z0-9]*|USR|OP|REQ|F-WPN|ITM|RES|CVD|RG|GEN|NAR|MOD)-[A-Z0-9-]+\b|Источник|(?:action)?availabilityTrace|masterPredicate|gmFinalization/i;

function fail(detail: string): never {
  throw new Error(`five starting positions: ${detail}`);
}

export function validateStartingPositionPublicText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0)
    return fail('description must contain text');
  if (INTERNAL_TEXT.test(value))
    return fail('description contains internal source or diagnostic notation');
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return fail(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmptyId(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0)
    return fail(`${path} must be a non-empty identifier`);
}

export function validateFiveStartingPositionsCatalog(catalog: FiveStartingPositionsCatalog): void {
  const value = object(catalog, 'catalog');
  if (Object.keys(value).join(',') !== 'entries' || !Array.isArray(value['entries']))
    return fail('catalog must contain only an entries array');
  const ids = new Set<string>();
  let storyCount = 0;
  for (const entry of value['entries']) {
    const row = object(entry, 'catalog entry');
    if (Object.keys(row).sort().join(',') !== 'itemTypeIdOrStoryType,kind,name')
      return fail('catalog entry contains unexpected fields');
    nonEmptyId(row['itemTypeIdOrStoryType'], 'catalog type');
    validateStartingPositionPublicText(row['name']);
    const type = row['itemTypeIdOrStoryType'];
    if (ids.has(type)) return fail('catalog contains duplicate types');
    ids.add(type);
    if (row['kind'] === 'STORY' && type === 'GEN-010') storyCount++;
    else if (row['kind'] !== 'CATALOGUE' || !/^(?:ITM|RES)-[A-Z]+-\d{3}$/.test(type))
      return fail('catalog type or kind is not recognized');
  }
  if (storyCount !== 1) return fail('catalog must contain the supplied descriptive category');
}

/** AQ2-003: five positions, not five distinct item types; identical types keep separate rolls. */
export function validateFiveStartingPositions(
  catalog: FiveStartingPositionsCatalog,
  selections: readonly FiveStartingPositionSelection[],
): readonly ValidatedFiveStartingPosition[] {
  validateFiveStartingPositionsCatalog(catalog);
  if (!Array.isArray(selections) || selections.length !== 5)
    return fail('exactly five positions are required');
  const byType = new Map(catalog.entries.map((entry) => [entry.itemTypeIdOrStoryType, entry]));
  const ids = new Set<string>();
  const result: ValidatedFiveStartingPosition[] = [];
  for (const [index, selection] of selections.entries()) {
    const path = `positions[${String(index)}]`;
    const row = object(selection, path);
    const keys = Object.keys(row).sort().join(',');
    if (
      keys !== 'itemTypeIdOrStoryType,positionId,quantity,storyDescriptionOrNull' &&
      keys !== 'itemTypeIdOrStoryType,kind,name,positionId,quantity,storyDescriptionOrNull'
    )
      return fail(`${path} contains missing or unexpected fields`);
    nonEmptyId(row['positionId'], `${path}.positionId`);
    nonEmptyId(row['itemTypeIdOrStoryType'], `${path}.itemTypeIdOrStoryType`);
    if (ids.has(row['positionId'])) return fail('position identifiers must be distinct');
    ids.add(row['positionId']);
    const entry = byType.get(row['itemTypeIdOrStoryType']);
    if (entry === undefined) return fail(`${path} has an unavailable item type`);
    const quantity = row['quantity'];
    if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0)
      return fail(`${path}.quantity must be a positive safe integer`);
    if (Object.hasOwn(row, 'name') && (row['name'] !== entry.name || row['kind'] !== entry.kind))
      return fail(`${path} does not match its catalog entry`);
    const description = row['storyDescriptionOrNull'];
    if (entry.kind === 'STORY') validateStartingPositionPublicText(description);
    else if (description !== null) return fail(`${path} must not contain a story description`);
    result.push(
      Object.freeze({
        positionId: row['positionId'],
        itemTypeIdOrStoryType: entry.itemTypeIdOrStoryType,
        quantity,
        storyDescriptionOrNull: description,
        name: entry.name,
        kind: entry.kind,
      }),
    );
  }
  return Object.freeze(result);
}

/** CORE-173 and QUALITY use the same exact scale as armor; AQ2-004 keeps it descriptive. */
export const recommendPositionQuality = (rawFace: number): PositionQualityRecommendation =>
  recommendArmorQuality(rawFace);
export const validatePositionQualityFace = (rawFace: number): number =>
  validateArmorQualityFace(rawFace);
