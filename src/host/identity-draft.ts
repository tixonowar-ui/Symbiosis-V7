import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import type { RevisionVector } from '@shared/wire-protocol.js';
import type {
  IdentityDraftRefusalV3Message,
  IdentityDraftReplaceV3Message,
  IdentityDraftScope,
  IdentityDraftValues,
} from '@shared/wire-v3-protocol.js';
const MAX_LOCAL_FILE_BYTES = 12 * 1024 * 1024;
const NAME_SEGMENTER = new Intl.Segmenter('und', { granularity: 'grapheme' });
const INVISIBLE_CODE_POINT = /^(?:\p{White_Space}|\p{Default_Ignorable_Code_Point})$/u;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
type IdentityDraftRefusal = IdentityDraftRefusalV3Message['refusal'];
type FieldError = Extract<IdentityDraftRefusal, { readonly code: 'INVALID_FIELD' }>['error'];
type Checked<T> =
  { readonly ok: true; readonly value: T } | { readonly error: FieldError; readonly ok: false };
export interface IdentityDraftApplicationContext {
  readonly advanceProjectionRevision: () => RevisionVector;
  readonly capabilityAvailable: boolean;
  readonly currentRevisions: () => RevisionVector;
  readonly currentScope: () => IdentityDraftScope | null;
}
export interface IdentityDraftAccepted {
  readonly checkpointEligible: boolean;
  readonly draftRevision: number;
  readonly draftUpdateId: string;
  readonly kind: 'accepted';
  readonly projectionChanged: boolean;
  readonly replayed: boolean;
  readonly revisions: RevisionVector;
  readonly scope: IdentityDraftScope;
  readonly values: IdentityDraftValues;
}
export interface IdentityDraftRejected {
  readonly draftUpdateId: string;
  readonly kind: 'refused';
  readonly refusal: IdentityDraftRefusal;
  readonly replayed: boolean;
  readonly revisions: RevisionVector;
  readonly scope: IdentityDraftScope;
}
export type IdentityDraftApplicationOutcome = IdentityDraftAccepted | IdentityDraftRejected;
type DraftState = { draftRevision: number; values: IdentityDraftValues };
interface JournalEntry {
  readonly outcome: IdentityDraftApplicationOutcome;
  readonly request: IdentityDraftReplaceV3Message;
}
const initialValues = (): IdentityDraftValues => ({
  age: null,
  artAssetKeyOrLocalFile: null,
  description: null,
  massKg: null,
  name: null,
  sex: null,
});
const copy = <T>(value: T): T => structuredClone(value);
const scopeKey = (scope: IdentityDraftScope): string =>
  JSON.stringify([
    scope.sourceFormId,
    scope.contextId,
    scope.characterDraftId,
    scope.wizardCheckpointId,
  ]);
const normalizedNumber = (value: number | null): number | null =>
  Object.is(value, -0) ? 0 : value;
const copyRequest = (request: IdentityDraftReplaceV3Message): IdentityDraftReplaceV3Message => ({
  ...request,
  expectedDraftRevision: normalizedNumber(request.expectedDraftRevision)!,
  expectedRevisions: {
    actorVisibilityRevision: normalizedNumber(request.expectedRevisions.actorVisibilityRevision)!,
    projectionRevision: normalizedNumber(request.expectedRevisions.projectionRevision)!,
    stateRevision: normalizedNumber(request.expectedRevisions.stateRevision)!,
  },
  scope: copy(request.scope),
  values: {
    ...copy(request.values),
    age: normalizedNumber(request.values.age),
    massKg: normalizedNumber(request.values.massKg),
  },
});
const invalid = (error: FieldError): Checked<never> => ({ error, ok: false });
function canonicalName(value: string | null): Checked<string | null> {
  if (value === null) return { ok: true, value };
  const trimmed = value.trim();
  if (trimmed.length === 0) return invalid({ field: 'name', reason: 'BLANK_AFTER_TRIM' });
  for (const point of trimmed) {
    const code = point.codePointAt(0)!;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return invalid({ field: 'name', reason: 'CONTROL_CHARACTER' });
    }
  }
  for (let index = 0; index < trimmed.length; index += 1) {
    const unit = trimmed.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = trimmed.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        return invalid({ field: 'name', reason: 'UNPAIRED_SURROGATE' });
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return invalid({ field: 'name', reason: 'UNPAIRED_SURROGATE' });
    }
  }
  let visible = 0;
  for (const { segment } of NAME_SEGMENTER.segment(trimmed)) {
    if ([...segment].some((point) => !INVISIBLE_CODE_POINT.test(point))) visible += 1;
  }
  if (visible === 0) return invalid({ field: 'name', reason: 'NO_VISIBLE_GRAPHEME' });
  if (visible > 64) return invalid({ field: 'name', reason: 'TOO_LONG' });
  return { ok: true, value: trimmed };
}
function canonicalDescription(value: string | null): Checked<string | null> {
  if (value === null) return { ok: true, value };
  if (value.length === 0) return invalid({ field: 'description', reason: 'EMPTY_NOT_NULL' });
  if ([...value].length > 2000) return invalid({ field: 'description', reason: 'TOO_LONG' });
  return { ok: true, value };
}
function canonicalArt(
  value: IdentityDraftValues['artAssetKeyOrLocalFile'],
  catalogKeys: ReadonlySet<string>,
): Checked<IdentityDraftValues['artAssetKeyOrLocalFile']> {
  if (value === null) return { ok: true, value };
  if (value.kind === 'asset-key') {
    if (value.assetKey.length === 0)
      return invalid({ field: 'artAssetKeyOrLocalFile', reason: 'EMPTY_ASSET_KEY' });
    return catalogKeys.has(value.assetKey)
      ? { ok: true, value: { ...value } }
      : invalid({ field: 'artAssetKeyOrLocalFile', reason: 'ASSET_NOT_FOUND' });
  }
  if (value.bytesBase64.length % 4 !== 0 || !BASE64.test(value.bytesBase64))
    return invalid({ field: 'artAssetKeyOrLocalFile', reason: 'NON_CANONICAL_BASE64' });
  const bytes = Buffer.from(value.bytesBase64, 'base64');
  if (bytes.toString('base64') !== value.bytesBase64)
    return invalid({ field: 'artAssetKeyOrLocalFile', reason: 'NON_CANONICAL_BASE64' });
  if (bytes.byteLength > MAX_LOCAL_FILE_BYTES)
    return invalid({ field: 'artAssetKeyOrLocalFile', reason: 'FILE_TOO_LARGE' });
  const signature = value.mediaType === 'image/png' ? PNG_SIGNATURE : JPEG_SIGNATURE;
  return signature.every((byte, index) => bytes[index] === byte)
    ? { ok: true, value: { ...value } }
    : invalid({ field: 'artAssetKeyOrLocalFile', reason: 'MEDIA_SIGNATURE_MISMATCH' });
}
function canonicalValues(
  values: IdentityDraftValues,
  catalogKeys: ReadonlySet<string>,
): Checked<IdentityDraftValues> {
  const name = canonicalName(values.name);
  if (!name.ok) return name;
  const description = canonicalDescription(values.description);
  if (!description.ok) return description;
  const art = canonicalArt(values.artAssetKeyOrLocalFile, catalogKeys);
  if (!art.ok) return art;
  if (values.age !== null && !Number.isFinite(values.age))
    throw new TypeError('decoded identity draft age must be finite');
  if (values.massKg !== null && !Number.isFinite(values.massKg))
    throw new TypeError('decoded identity draft massKg must be finite');
  if (values.massKg !== null && values.massKg <= 0)
    return invalid({ field: 'massKg', reason: 'NOT_POSITIVE' });
  if (
    values.massKg !== null &&
    !Number.isInteger(values.massKg) &&
    !Number.isInteger(values.massKg * 10)
  )
    return invalid({ field: 'massKg', reason: 'STEP_MISMATCH' });
  return {
    ok: true,
    value: {
      age: normalizedNumber(values.age),
      artAssetKeyOrLocalFile: art.value,
      description: description.value,
      massKg: normalizedNumber(values.massKg),
      name: name.value,
      sex: values.sex,
    },
  };
}
export function identityDraftOverflowAxis(draft: number, projection: number) {
  if (draft === Number.MAX_SAFE_INTEGER) return 'draftRevision' as const;
  return projection === Number.MAX_SAFE_INTEGER ? ('projectionRevision' as const) : null;
}
export function createIdentityDraftRuntime(catalogKeys: ReadonlySet<string>) {
  const drafts = new Map<string, DraftState>();
  const journal = new Map<string, JournalEntry>();
  const apply = (
    request: IdentityDraftReplaceV3Message,
    context: IdentityDraftApplicationContext,
  ): IdentityDraftApplicationOutcome => {
    let checkedRevisions: RevisionVector | null = null;
    const current = () => (checkedRevisions ??= context.currentRevisions());
    const recorded = journal.get(request.draftUpdateId);
    if (recorded !== undefined) {
      if (!isDeepStrictEqual(recorded.request, copyRequest(request))) {
        return {
          draftUpdateId: request.draftUpdateId,
          kind: 'refused',
          refusal: { code: 'IDEMPOTENCY_CONFLICT', detail: 'PAYLOAD_MISMATCH' },
          replayed: false,
          revisions: copy(current()),
          scope: copy(request.scope),
        };
      }
      return recorded.outcome.kind === 'accepted'
        ? { ...recorded.outcome, projectionChanged: false, replayed: true }
        : { ...recorded.outcome, replayed: true };
    }
    const finish = (outcome: IdentityDraftApplicationOutcome): IdentityDraftApplicationOutcome => {
      journal.set(request.draftUpdateId, { outcome, request: copyRequest(request) });
      return outcome;
    };
    const refuse = (refusal: IdentityDraftRefusal): IdentityDraftRejected =>
      finish({
        draftUpdateId: request.draftUpdateId,
        kind: 'refused',
        refusal,
        replayed: false,
        revisions: copy(current()),
        scope: copy(request.scope),
      }) as IdentityDraftRejected;
    const state = drafts.get(scopeKey(request.scope));
    const assigned = isDeepStrictEqual(request.scope, context.currentScope());
    if (state === undefined || !assigned) return refuse({ code: 'DRAFT_UNAVAILABLE' });
    if (request.expectedDraftRevision !== state.draftRevision) {
      return refuse({
        actual: state.draftRevision,
        code: 'STALE_DRAFT',
        expected: request.expectedDraftRevision,
      });
    }
    if (!isDeepStrictEqual(request.expectedRevisions, current())) {
      return refuse({
        actual: copy(current()),
        code: 'STALE_REVISION',
        expected: copy(request.expectedRevisions),
      });
    }
    const canonical = canonicalValues(request.values, catalogKeys);
    if (!canonical.ok) return refuse({ code: 'INVALID_FIELD', error: canonical.error });
    const changed = !isDeepStrictEqual(state.values, canonical.value);
    const overflowAxis = changed
      ? identityDraftOverflowAxis(state.draftRevision, current().projectionRevision)
      : null;
    if (overflowAxis !== null) return refuse({ axis: overflowAxis, code: 'REVISION_OVERFLOW' });
    const revisions = changed
      ? {
          ...current(),
          projectionRevision: current().projectionRevision + 1,
        }
      : copy(current());
    if (changed) {
      const advanced = context.advanceProjectionRevision();
      if (!isDeepStrictEqual(advanced, revisions)) {
        throw new Error(
          `identity draft projection advance returned ${JSON.stringify(advanced)}, expected ${JSON.stringify(revisions)}`,
        );
      }
      state.draftRevision += 1;
      state.values = copy(canonical.value);
    }
    return finish({
      checkpointEligible:
        context.capabilityAvailable &&
        canonical.value.name !== null &&
        canonical.value.age !== null &&
        canonical.value.sex !== null &&
        canonical.value.massKg !== null,
      draftRevision: state.draftRevision,
      draftUpdateId: request.draftUpdateId,
      kind: 'accepted',
      projectionChanged: changed,
      replayed: false,
      revisions,
      scope: copy(request.scope),
      values: copy(state.values),
    });
  };
  return {
    apply,
    readScope: (scope: IdentityDraftScope) => {
      const state = drafts.get(scopeKey(scope));
      return state === undefined
        ? null
        : { draftRevision: state.draftRevision, values: copy(state.values) };
    },
    registerScope: (scope: IdentityDraftScope) => {
      const key = scopeKey(scope);
      if (!drafts.has(key)) drafts.set(key, { draftRevision: 0, values: initialValues() });
    },
    unregisterScope: (scope: IdentityDraftScope) => drafts.delete(scopeKey(scope)),
  };
}
export type IdentityDraftRuntime = ReturnType<typeof createIdentityDraftRuntime>;
