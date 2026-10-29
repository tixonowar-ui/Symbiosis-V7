export type StartingWealthRecommendationKind =
  'NONE' | 'SMALL' | 'ORDINARY' | 'LARGE' | 'EXCEPTIONAL' | 'RARE_FORTUNE';

export interface StartingMoneyScaleEntry {
  readonly kind: StartingWealthRecommendationKind;
  readonly minFace: number;
  readonly maxFace: number;
  readonly range: string;
  readonly label: string;
}

export interface StartingMoneyCatalog {
  readonly dieSides: 20;
  readonly gmFinalizationRequired: true;
  readonly wealthScale: readonly StartingMoneyScaleEntry[];
}

export interface StartingWealthRecommendation {
  readonly kind: StartingWealthRecommendationKind;
  readonly label: string;
  readonly range: string;
  readonly rawFace: number;
}

/** CORE-172/Q-CORE-052 supplies money labels separately from the QUALITY dictionary. */
export const CANONICAL_STARTING_MONEY_CATALOG: StartingMoneyCatalog = Object.freeze({
  dieSides: 20,
  gmFinalizationRequired: true,
  wealthScale: Object.freeze([
    Object.freeze({ kind: 'NONE', minFace: 1, maxFace: 4, range: '1–4', label: 'нет денег' }),
    Object.freeze({ kind: 'SMALL', minFace: 5, maxFace: 9, range: '5–9', label: 'малая сумма' }),
    Object.freeze({ kind: 'ORDINARY', minFace: 10, maxFace: 14, range: '10–14', label: 'обычная' }),
    Object.freeze({ kind: 'LARGE', minFace: 15, maxFace: 18, range: '15–18', label: 'крупная' }),
    Object.freeze({
      kind: 'EXCEPTIONAL',
      minFace: 19,
      maxFace: 19,
      range: '19',
      label: 'исключительная',
    }),
    Object.freeze({
      kind: 'RARE_FORTUNE',
      minFace: 20,
      maxFace: 20,
      range: '20',
      label: 'редкое состояние',
    }),
  ] as const),
});

function fail(detail: string): never {
  throw new Error(`starting money: ${detail}`);
}

export function validateMoneyFace(rawFace: number): number {
  if (typeof rawFace !== 'number' || !Number.isSafeInteger(rawFace) || rawFace < 1 || rawFace > 20)
    return fail('money face must be a safe integer in 1..20');
  return rawFace;
}

export function validateStartingMoneyCatalog(catalog: StartingMoneyCatalog): void {
  if (
    catalog === null ||
    typeof catalog !== 'object' ||
    Array.isArray(catalog) ||
    Object.keys(catalog).sort().join(',') !== 'dieSides,gmFinalizationRequired,wealthScale' ||
    catalog.dieSides !== 20 ||
    catalog.gmFinalizationRequired !== true ||
    !Array.isArray(catalog.wealthScale) ||
    catalog.wealthScale.length !== CANONICAL_STARTING_MONEY_CATALOG.wealthScale.length
  )
    return fail('expected the canonical money recommendation catalog');
  for (const [index, expected] of CANONICAL_STARTING_MONEY_CATALOG.wealthScale.entries()) {
    const actual: unknown = catalog.wealthScale[index];
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual))
      return fail(`wealthScale[${String(index)}] must be a scale entry`);
    const row = actual as Record<string, unknown>;
    if (
      Object.keys(row).sort().join(',') !== 'kind,label,maxFace,minFace,range' ||
      row['kind'] !== expected.kind ||
      row['label'] !== expected.label ||
      row['range'] !== expected.range ||
      row['minFace'] !== expected.minFace ||
      row['maxFace'] !== expected.maxFace
    )
      return fail(`wealthScale[${String(index)}] differs from the supplied money scale`);
  }
}

/** A recommendation carries no amount, approval or currency mutation, even for natural 1/20. */
export function recommendStartingWealth(
  rawFace: number,
  catalog: StartingMoneyCatalog = CANONICAL_STARTING_MONEY_CATALOG,
): StartingWealthRecommendation {
  const face = validateMoneyFace(rawFace);
  validateStartingMoneyCatalog(catalog);
  const entry = catalog.wealthScale.find(
    ({ minFace, maxFace }) => face >= minFace && face <= maxFace,
  );
  if (entry === undefined) return fail(`no wealth recommendation for face ${String(face)}`);
  return Object.freeze({ kind: entry.kind, label: entry.label, range: entry.range, rawFace: face });
}
