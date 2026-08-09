import type { FormId } from '@generated/types/atlas.js';

/**
 * Issue #33 implements exactly the APP domain. Keeping every atlas ID literal
 * here makes that boundary visible to both TypeScript and traceability scans.
 */
export const APP_FORM_IDS = [
  'APP-001',
  'APP-002',
  'APP-003',
  'APP-004',
  'APP-005',
  'APP-006',
  'APP-007',
  'APP-008',
  'APP-009',
  'APP-010',
  'APP-011',
] as const satisfies readonly FormId[];

export type AppFormId = (typeof APP_FORM_IDS)[number];

const APP_FORM_ID_SET: ReadonlySet<string> = new Set(APP_FORM_IDS);

export function isAppFormId(value: string): value is AppFormId {
  return APP_FORM_ID_SET.has(value);
}
