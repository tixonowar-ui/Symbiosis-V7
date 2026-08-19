import type { FormId } from '@generated/types/atlas.js';

/** Issues #62, #97, #110 and #111 implement the wizard through creation-critical rolls. */
export const CHR_FORM_IDS = [
  'CHR-001',
  'CHR-010',
  'CHR-016',
  'CHR-036',
  'CHR-002',
  'CHR-003',
  'CHR-004',
] as const satisfies readonly FormId[];

export type ChrFormId = (typeof CHR_FORM_IDS)[number];

const CHR_FORM_ID_SET: ReadonlySet<string> = new Set(CHR_FORM_IDS);

export function isChrFormId(value: string): value is ChrFormId {
  return CHR_FORM_ID_SET.has(value);
}
