import type { FormId } from '@generated/types/atlas.js';

/** Issues #62 and #97 implement the first two published CHR wizard forms. */
export const CHR_FORM_IDS = ['CHR-001', 'CHR-010'] as const satisfies readonly FormId[];

export type ChrFormId = (typeof CHR_FORM_IDS)[number];

const CHR_FORM_ID_SET: ReadonlySet<string> = new Set(CHR_FORM_IDS);

export function isChrFormId(value: string): value is ChrFormId {
  return CHR_FORM_ID_SET.has(value);
}
