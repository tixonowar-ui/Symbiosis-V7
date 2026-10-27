export const ARMOR_BODY_ZONES = ['HEAD', 'TORSO', 'ARM_L', 'ARM_R', 'LEG_L', 'LEG_R'] as const;
export type ArmorBodyZone = (typeof ARMOR_BODY_ZONES)[number];

export type ArmorCoverageModel = 'ZONE_ELEMENT' | 'FULL_SUIT';

export interface ArmorBundleCatalogEntry {
  readonly itemId: string;
  readonly name: string;
  readonly coverageModel: ArmorCoverageModel;
}

export interface ArmorBundleCatalog {
  readonly entries: readonly ArmorBundleCatalogEntry[];
}

export interface ArmorBundleSelection {
  readonly itemId: string;
  readonly bodyZoneOrNull: ArmorBodyZone | null;
}

export type ArmorQualityRecommendationKind =
  'MISSING_OR_UNFIT' | 'POOR' | 'ORDINARY' | 'GOOD' | 'EXCEPTIONAL' | 'RARE';

export interface ArmorQualityRecommendation {
  readonly kind: ArmorQualityRecommendationKind;
  readonly label: string;
  readonly range: string;
  readonly rawFace: number;
}

export interface ValidatedArmorBundlePiece {
  readonly itemId: string;
  readonly name: string;
  readonly coverageModel: ArmorCoverageModel;
  readonly bodyZone: ArmorBodyZone | null;
}

export interface ValidatedArmorBundle {
  readonly armorPieces: readonly ValidatedArmorBundlePiece[];
  readonly distinctBodyZones: readonly ArmorBodyZone[];
}

function isArmorBodyZone(value: unknown): value is ArmorBodyZone {
  return typeof value === 'string' && (ARMOR_BODY_ZONES as readonly string[]).includes(value);
}

function invalidArmorBundle(detail: string): never {
  throw new Error(`armor bundle: ${detail}`);
}

export function validateArmorQualityFace(rawFace: number): number {
  if (
    typeof rawFace !== 'number' ||
    !Number.isSafeInteger(rawFace) ||
    rawFace < 1 ||
    rawFace > 20
  ) {
    invalidArmorBundle('quality face must be a safe integer in 1..20');
  }
  return Object.is(rawFace, -0) ? 0 : rawFace;
}

export function recommendArmorQuality(rawFace: number): ArmorQualityRecommendation {
  const face = validateArmorQualityFace(rawFace);
  if (face <= 4) {
    return Object.freeze({
      kind: 'MISSING_OR_UNFIT',
      label: 'Отсутствует/непригоден',
      range: '1–4',
      rawFace: face,
    });
  }
  if (face <= 9) {
    return Object.freeze({ kind: 'POOR', label: 'Плохое', range: '5–9', rawFace: face });
  }
  if (face <= 14) {
    return Object.freeze({ kind: 'ORDINARY', label: 'Обычное', range: '10–14', rawFace: face });
  }
  if (face <= 18) {
    return Object.freeze({ kind: 'GOOD', label: 'Хорошее', range: '15–18', rawFace: face });
  }
  if (face === 19) {
    return Object.freeze({
      kind: 'EXCEPTIONAL',
      label: 'Исключительное',
      range: '19',
      rawFace: face,
    });
  }
  return Object.freeze({ kind: 'RARE', label: 'Редкое', range: '20', rawFace: face });
}

export function validateArmorBundle(
  catalog: ArmorBundleCatalog,
  selections: readonly ArmorBundleSelection[],
): ValidatedArmorBundle {
  if (
    catalog === null ||
    typeof catalog !== 'object' ||
    Array.isArray(catalog) ||
    !Array.isArray(catalog.entries)
  ) {
    invalidArmorBundle('catalog must be an object with an entries array');
  }
  const entries = catalog.entries;
  const ids = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.itemId !== 'string' ||
      entry.itemId.length === 0 ||
      typeof entry.name !== 'string' ||
      entry.name.length === 0 ||
      (entry.coverageModel !== 'ZONE_ELEMENT' && entry.coverageModel !== 'FULL_SUIT')
    ) {
      invalidArmorBundle(`catalog.entries[${String(index)}] is not a valid armor entry`);
    }
    if (ids.has(entry.itemId)) invalidArmorBundle(`duplicate catalog item ${entry.itemId}`);
    ids.add(entry.itemId);
  }
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 6) {
    invalidArmorBundle('selection must contain 1..6 armor pieces');
  }

  const byItemId = new Map(entries.map((entry) => [entry.itemId, entry]));
  const occupiedZones = new Set<ArmorBodyZone>();
  let fullSuitSelected = false;
  const armorPieces: ValidatedArmorBundlePiece[] = [];

  for (const [index, selected] of selections.entries()) {
    const path = `selections[${String(index)}]`;
    if (selected === null || typeof selected !== 'object' || Array.isArray(selected)) {
      invalidArmorBundle(`${path} must be an object`);
    }
    if (typeof selected.itemId !== 'string' || selected.itemId.length === 0) {
      invalidArmorBundle(`${path}.itemId must be a non-empty string`);
    }
    const entry = byItemId.get(selected.itemId);
    if (entry === undefined) {
      const available = entries.map((candidate) => candidate.itemId).join(', ');
      invalidArmorBundle(`unknown armor item ${selected.itemId}; available: ${available}`);
    }
    if (entry.coverageModel === 'FULL_SUIT') {
      if (selected.bodyZoneOrNull !== null) {
        invalidArmorBundle(`${path}.bodyZoneOrNull must be null for a full suit`);
      }
      if (fullSuitSelected || occupiedZones.size > 0) {
        invalidArmorBundle('a full suit cannot be combined with another armor coverage');
      }
      fullSuitSelected = true;
      for (const zone of ARMOR_BODY_ZONES) occupiedZones.add(zone);
      armorPieces.push(Object.freeze({ ...entry, bodyZone: null }));
      continue;
    }

    if (!isArmorBodyZone(selected.bodyZoneOrNull)) {
      const available = ARMOR_BODY_ZONES.join(', ');
      invalidArmorBundle(
        `unrecognized armor body zone ${JSON.stringify(selected.bodyZoneOrNull)}; available: ${available}`,
      );
    }
    const bodyZone = selected.bodyZoneOrNull;
    if (fullSuitSelected || occupiedZones.has(bodyZone)) {
      invalidArmorBundle(`duplicate armor body zone ${bodyZone}`);
    }
    occupiedZones.add(bodyZone);
    armorPieces.push(Object.freeze({ ...entry, bodyZone }));
  }

  return Object.freeze({
    armorPieces: Object.freeze(armorPieces),
    distinctBodyZones: Object.freeze([...occupiedZones]),
  });
}
