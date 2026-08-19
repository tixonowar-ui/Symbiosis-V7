import type { FormId } from '@generated/types/atlas.js';

/** Issues #62, #97, #110, #111 and #120 implement the wizard through set decisions. */
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
] as const satisfies readonly FormId[];

export type ChrFormId = (typeof CHR_FORM_IDS)[number];

const CHR_FORM_ID_SET: ReadonlySet<string> = new Set(CHR_FORM_IDS);

export function isChrFormId(value: string): value is ChrFormId {
  return CHR_FORM_ID_SET.has(value);
}
