import type { FormId } from '@generated/types/atlas.js';

/** Issues #62, #97, #110, #111, #120, #122, #126 and #144 implement the wizard through skills. */
export const CHR_FORM_IDS = [
  'CHR-001',
  'CHR-010',
  'CHR-016',
  'CHR-036',
  'CHR-002',
  'CHR-003',
  'CHR-004',
  'CHR-005',
  'CHR-006',
  'CHR-007',
  'CHR-008',
  'CHR-028',
  'CHR-009',
  'CHR-011',
  'CHR-012',
  'CHR-013',
  'CHR-014',
  'CHR-015',
  'CHR-017',
  'CHR-018',
  'CHR-019',
  'CHR-042',
  'CHR-020',
  'CHR-041',
  'CHR-021',
  'CHR-022',
  'CHR-023',
  'CHR-024',
  'CHR-031',
  'CHR-038',
  'CHR-037',
] as const satisfies readonly FormId[];

export type ChrFormId = (typeof CHR_FORM_IDS)[number];

const CHR_FORM_ID_SET: ReadonlySet<string> = new Set(CHR_FORM_IDS);

export function isChrFormId(value: string): value is ChrFormId {
  return CHR_FORM_ID_SET.has(value);
}
