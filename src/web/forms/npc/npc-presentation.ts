export * from '@shared/npc-presentation.js';
import type { IdentityDraftArtValue } from '@shared/index.js';
import type { NpcDraftSection } from '../../../domain/rules/npc-authoring/types.js';
import type {
  NpcArtPresentation as NpcArtReference,
  NpcLibraryRow as NpcLibraryRowData,
  NpcSheetPresentation as NpcSheetPresentationData,
  NpcFullSheetPreview as NpcFullSheetPreviewData,
  NpcPreparedDiseaseId,
  NpcWoundPreparationInput,
  NpcIdentityPresentation as NpcIdentityPresentationData,
  NpcSchemaPresentation as NpcSchemaPresentationData,
  NpcStatPresentation as NpcStatPresentationData,
  NpcLibraryPresentation as NpcLibraryPresentationData,
  NpcHistoryPresentation as NpcHistoryPresentationData,
  NpcSymbiontsPresentation as NpcSymbiontsPresentationData,
  NpcSkillsPresentation as NpcSkillsPresentationData,
  NpcInventoryPresentation as NpcInventoryPresentationData,
  NpcInitialStatePresentation as NpcInitialStatePresentationData,
  NpcFinalReviewPresentation as NpcFinalReviewPresentationData,
} from '@shared/npc-presentation.js';

export interface NpcControlState {
  readonly readOnly: boolean;
  readonly pending: boolean;
  readonly dirty: boolean;
  /** Local unsubmitted editor input; distinct from an in-flight preparation/file read. */
  readonly localEditDirty?: boolean;
  readonly refusalOrNull: string | null;
}
export type NpcArtEdit =
  | Readonly<{ kind: 'CLEAR' }>
  | Readonly<{
      kind: 'UPLOAD';
      file: Extract<IdentityDraftArtValue, { kind: 'local-file' }>;
    }>;
export type NpcContinuationIntent =
  | Readonly<{
      kind: 'SET_MANUAL_FACE';
      capabilityKey: string;
      rollKey: string;
      input: NpcDraftSection<number>;
    }>
  | Readonly<{
      kind: 'SET_SELECTED_SKILLS';
      capabilityKey: string;
      input: readonly NpcCompositionSkillDraft[];
    }>
  | Readonly<{ kind: 'SUBMIT'; capabilityKey: string }>;
export interface NpcCompositionSkillDraft {
  readonly skillKey: NpcDraftSection<string>;
  readonly targetBonus: NpcDraftSection<number>;
}
/** Local, unsubmitted choices are fenced by the host-issued continuation identity. */
export interface NpcContinuationDraft {
  readonly capabilityKey: string;
  readonly manualFaces: Readonly<Record<string, NpcDraftSection<number>>>;
  readonly selectedSkills: readonly NpcCompositionSkillDraft[] | null;
}
export type NpcDiseasePreparationIntent =
  | Readonly<{
      kind: 'SET_DISEASE';
      capabilityKey: string;
      input: NpcDraftSection<NpcPreparedDiseaseId>;
    }>
  | Readonly<{ kind: 'PREPARE'; capabilityKey: string }>;
export type NpcWoundPreparationIntent =
  | Readonly<{ kind: 'SET_INPUT'; capabilityKey: string; input: NpcWoundPreparationInput }>
  | Readonly<{ kind: 'PREPARE'; capabilityKey: string }>;
/** Created by the browser art session from validated private WS bytes, never copied from wire. */
export type NpcArtPresentation = NpcArtReference &
  (
    | Readonly<{ status: 'LOADING' }>
    | Readonly<{ status: 'UNAVAILABLE' }>
    | Readonly<{ status: 'READY'; url: `blob:${string}` }>
  );
export interface NpcLibraryRow extends Omit<NpcLibraryRowData, 'artOrNull'> {
  readonly artOrNull: NpcArtPresentation | null;
}
export interface NpcSheetPresentation extends Omit<NpcSheetPresentationData, 'artOrNull'> {
  readonly artOrNull: NpcArtPresentation | null;
}
export interface NpcFullSheetPreview extends Omit<NpcFullSheetPreviewData, 'artOrNull'> {
  readonly artOrNull: NpcArtPresentation | null;
}
export interface NpcIdentityPresentation extends Omit<NpcIdentityPresentationData, 'artOrNull'> {
  readonly artOrNull: NpcArtPresentation | null;
  /** Local file-read fence derived from the checked scope, attempt and projection revision. */
  readonly bindingKey: string;
  readonly state: NpcControlState;
}
export interface NpcSchemaPresentation extends NpcSchemaPresentationData {
  readonly state: NpcControlState;
}
export interface NpcStatPresentation extends NpcStatPresentationData {
  readonly state: NpcControlState;
}
export interface NpcLibraryPresentation extends Omit<NpcLibraryPresentationData, 'rows'> {
  readonly rows: readonly NpcLibraryRow[];
  readonly state: NpcControlState;
}
export interface NpcHistoryPresentation extends Omit<NpcHistoryPresentationData, 'previewOrNull'> {
  readonly previewOrNull: NpcSheetPresentation | null;
  readonly state: NpcControlState;
}
export interface NpcSymbiontsPresentation extends NpcSymbiontsPresentationData {
  readonly state: NpcControlState;
  /** Revisions and authority bind local continuation choices even if a capability label repeats. */
  readonly bindingKey: string;
}
export interface NpcSkillsPresentation extends NpcSkillsPresentationData {
  readonly state: NpcControlState;
}
export interface NpcInventoryPresentation extends NpcInventoryPresentationData {
  readonly state: NpcControlState;
}
export interface NpcInitialStatePresentation extends NpcInitialStatePresentationData {
  readonly state: NpcControlState;
}
export interface NpcFinalReviewPresentation extends Omit<
  NpcFinalReviewPresentationData,
  'previewOrNull'
> {
  readonly previewOrNull: NpcFullSheetPreview | null;
  readonly state: NpcControlState;
}
