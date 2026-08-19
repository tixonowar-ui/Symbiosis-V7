import { wireCodecPrimitives } from './wire-codec.js';
import type { DecodeResult, EncodeResult, RevisionVector } from './wire-protocol.js';
import type {
  AssignedRouteBinding,
  PresentedBaseForm,
  PresentedLayerForm,
} from './wire-v2-protocol.js';
import { WIRE_PROTOCOL_V3_VERSION } from './wire-v3-protocol.js';
import type {
  ClientToHostV3Message,
  HostToClientV3Message,
  IdentityDraftArtValue,
  IdentityDraftFieldError,
  IdentityDraftPresentation,
  IdentityDraftRefusal,
  IdentityDraftRefusalV3Message,
  IdentityDraftReplaceV3Message,
  IdentityDraftResultV3Message,
  IdentityDraftScope,
  IdentityDraftSex,
  IdentityDraftValues,
  WireV3Vocabulary,
} from './wire-v3-protocol.js';

const LAYER_TYPES = new Set(['banner', 'component', 'dialog', 'overlay', 'specification']);
const BINDING_SOURCES = new Set(['client-selected', 'executor-allocated', 'inherited']);
const IDENTITY_DRAFT_MEDIA_TYPES = new Set(['image/jpeg', 'image/png']);
const IDENTITY_DRAFT_SEXES = new Set<IdentityDraftSex>(['FEMALE', 'MALE']);
const FIELD_REASONS: Readonly<Partial<Record<string, ReadonlySet<string>>>> = {
  artAssetKeyOrLocalFile: new Set([
    'ASSET_NOT_FOUND',
    'EMPTY_ASSET_KEY',
    'FILE_TOO_LARGE',
    'MEDIA_SIGNATURE_MISMATCH',
    'NON_CANONICAL_BASE64',
  ]),
  description: new Set(['EMPTY_NOT_NULL', 'TOO_LONG']),
  massKg: new Set(['NOT_POSITIVE', 'STEP_MISMATCH']),
  name: new Set([
    'BLANK_AFTER_TRIM',
    'CONTROL_CHARACTER',
    'NO_VISIBLE_GRAPHEME',
    'TOO_LONG',
    'UNPAIRED_SURROGATE',
  ]),
};
const IDENTITY_DRAFT_OVERFLOW_AXES = new Set(['draftRevision', 'projectionRevision']);
const REVISION_AXES = ['actorVisibilityRevision', 'projectionRevision', 'stateRevision'] as const;
const IDENTITY_DRAFT_VALUE_KEYS = [
  'age',
  'artAssetKeyOrLocalFile',
  'description',
  'massKg',
  'name',
  'sex',
] as const satisfies readonly (keyof IdentityDraftValues)[];

const {
  abortInvalid: invalid,
  abortUnrecognized: unrecognized,
  encode,
  exact,
  json: jsonValue,
  jsonObject,
  literal,
  oneOf,
  parse,
  record,
  revision: integer,
  revisions,
  string: text,
  validated,
} = wireCodecPrimitives;

const array = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) return invalid(path, 'array', value);
  return value;
};

const stringValue = (value: unknown, path: string): string => {
  if (typeof value !== 'string') return invalid(path, 'string', value);
  return value;
};

const finiteNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return invalid(path, 'finite number', value);
  return Object.is(value, -0) ? 0 : value;
};

const normalizedRevision = (value: unknown, path: string): number => {
  const valueAsInteger = integer(value, path);
  return Object.is(valueAsInteger, -0) ? 0 : valueAsInteger;
};

const normalizedRevisions = (value: unknown, path: string): RevisionVector => {
  const object = exact(value, 'actorVisibilityRevision projectionRevision stateRevision', path);
  const read = (axis: keyof RevisionVector) => normalizedRevision(object[axis], `${path}.${axis}`);
  return {
    actorVisibilityRevision: read('actorVisibilityRevision'),
    projectionRevision: read('projectionRevision'),
    stateRevision: read('stateRevision'),
  };
};

const bindingList = <T extends { readonly parameterIndex: number }>(
  value: unknown,
  path: string,
  read: (item: unknown, itemPath: string) => T,
): readonly T[] => {
  const result = array(value, path).map((item, index) => read(item, `${path}[${String(index)}]`));
  const seen = new Set<number>();
  result.forEach((binding, index) => {
    if (seen.has(binding.parameterIndex)) {
      unrecognized(`${path}[${String(index)}].parameterIndex`, binding.parameterIndex);
    }
    seen.add(binding.parameterIndex);
  });
  return result;
};

const assignedBinding = (value: unknown, path: string): AssignedRouteBinding => {
  const object = exact(value, 'parameterIndex source value', path);
  integer(object['parameterIndex'], `${path}.parameterIndex`);
  oneOf(object['source'], BINDING_SOURCES, `${path}.source`);
  text(object['value'], `${path}.value`);
  return validated(value);
};

const formId = (value: unknown, path: string, vocabulary: WireV3Vocabulary) => {
  const candidate = text(value, path);
  if (vocabulary.isFormId(candidate)) return candidate;
  return unrecognized(path, candidate);
};

const presentedForm = (
  value: unknown,
  path: string,
  layer: boolean,
  vocabulary: WireV3Vocabulary,
): PresentedBaseForm | PresentedLayerForm => {
  const object = exact(
    value,
    'availableActionKeys formId formType roleFilteredPayload routeBindings routeTemplate',
    path,
  );
  const id = formId(object['formId'], `${path}.formId`, vocabulary);
  const formType = layer
    ? oneOf<PresentedLayerForm['formType']>(object['formType'], LAYER_TYPES, `${path}.formType`)
    : literal(object['formType'], 'screen', `${path}.formType`);
  const keys = array(object['availableActionKeys'], `${path}.availableActionKeys`);
  const seenKeys = new Set<string>();
  keys.forEach((item, index) => {
    const keyPath = `${path}.availableActionKeys[${String(index)}]`;
    const key = text(item, keyPath);
    if (!vocabulary.isFormActionKey(id, key)) unrecognized(keyPath, key);
    if (seenKeys.has(key)) unrecognized(keyPath, key);
    seenKeys.add(key);
  });
  jsonObject(object['roleFilteredPayload'], `${path}.roleFilteredPayload`);
  const bindings = bindingList(object['routeBindings'], `${path}.routeBindings`, assignedBinding);
  const routeTemplate = text(object['routeTemplate'], `${path}.routeTemplate`);
  if (!vocabulary.isPresentedForm(id, formType, routeTemplate, bindings)) {
    unrecognized(path, jsonValue(value, path));
  }
  return validated(value);
};

const base = (value: unknown): Record<string, unknown> => {
  const object = record(value, '$');
  if (!Object.hasOwn(object, 'protocolVersion')) {
    invalid('$.protocolVersion', 'required field', undefined);
  }
  if (object['protocolVersion'] !== WIRE_PROTOCOL_V3_VERSION) {
    unrecognized('$.protocolVersion', jsonValue(object['protocolVersion'], '$.protocolVersion'));
  }
  if (!Object.hasOwn(object, 'messageType')) invalid('$.messageType', 'required field', undefined);
  text(object['messageType'], '$.messageType');
  return object;
};

const identityDraftScope = (value: unknown, path: string): IdentityDraftScope => {
  const object = exact(value, 'characterDraftId contextId sourceFormId wizardCheckpointId', path);
  literal(object['sourceFormId'], 'CHR-001', `${path}.sourceFormId`);
  text(object['contextId'], `${path}.contextId`);
  text(object['characterDraftId'], `${path}.characterDraftId`);
  text(object['wizardCheckpointId'], `${path}.wizardCheckpointId`);
  return validated(value);
};

const identityDraftArtValue = (value: unknown, path: string): IdentityDraftArtValue => {
  if (value === null) return null;
  const shape = record(value, path);
  const kind = text(shape['kind'], `${path}.kind`);
  if (kind === 'asset-key') {
    const object = exact(value, 'assetKey kind', path);
    return {
      kind: literal(object['kind'], 'asset-key', `${path}.kind`),
      assetKey: stringValue(object['assetKey'], `${path}.assetKey`),
    };
  }
  if (kind === 'local-file') {
    const object = exact(value, 'bytesBase64 kind mediaType', path);
    literal(object['kind'], 'local-file', `${path}.kind`);
    oneOf(object['mediaType'], IDENTITY_DRAFT_MEDIA_TYPES, `${path}.mediaType`);
    stringValue(object['bytesBase64'], `${path}.bytesBase64`);
    return validated(value);
  }
  return unrecognized(`${path}.kind`, kind);
};

const identityDraftSex = (value: unknown, path: string): IdentityDraftSex => {
  if (typeof value !== 'string') return invalid(path, 'string', value);
  if (IDENTITY_DRAFT_SEXES.has(value as IdentityDraftSex)) return value as IdentityDraftSex;
  return unrecognized(path, value);
};

const nullableStringValue = (value: unknown, path: string): string | null =>
  value === null ? null : stringValue(value, path);

const nullableFiniteNumber = (value: unknown, path: string): number | null =>
  value === null ? null : finiteNumber(value, path);

const nullableIdentityDraftSex = (value: unknown, path: string): IdentityDraftSex | null =>
  value === null ? null : identityDraftSex(value, path);

const readIdentityDraftValues = (
  object: Record<string, unknown>,
  path: string,
): IdentityDraftValues => ({
  name: nullableStringValue(object['name'], `${path}.name`),
  description: nullableStringValue(object['description'], `${path}.description`),
  artAssetKeyOrLocalFile: identityDraftArtValue(
    object['artAssetKeyOrLocalFile'],
    `${path}.artAssetKeyOrLocalFile`,
  ),
  age: nullableFiniteNumber(object['age'], `${path}.age`),
  sex: nullableIdentityDraftSex(object['sex'], `${path}.sex`),
  massKg: nullableFiniteNumber(object['massKg'], `${path}.massKg`),
});

const identityDraftValues = (value: unknown, path: string): IdentityDraftValues =>
  readIdentityDraftValues(
    exact(value, 'age artAssetKeyOrLocalFile description massKg name sex', path),
    path,
  );

const identityDraftPayloadValues = (value: unknown, path: string): void => {
  const object = record(value, path);
  for (const key of IDENTITY_DRAFT_VALUE_KEYS) {
    if (!Object.prototype.propertyIsEnumerable.call(object, key)) {
      invalid(`${path}.${key}`, 'required enumerable field', undefined);
    }
  }
  readIdentityDraftValues(object, path);
};

const identityDraftReplace = (value: unknown): IdentityDraftReplaceV3Message => {
  const object = exact(
    value,
    'draftUpdateId expectedDraftRevision expectedRevisions messageType protocolVersion scope values',
  );
  literal(object['messageType'], 'character.identity-draft.replace', '$.messageType');
  return {
    protocolVersion: WIRE_PROTOCOL_V3_VERSION,
    messageType: 'character.identity-draft.replace',
    draftUpdateId: text(object['draftUpdateId'], '$.draftUpdateId'),
    scope: identityDraftScope(object['scope'], '$.scope'),
    expectedDraftRevision: normalizedRevision(
      object['expectedDraftRevision'],
      '$.expectedDraftRevision',
    ),
    expectedRevisions: normalizedRevisions(object['expectedRevisions'], '$.expectedRevisions'),
    values: identityDraftValues(object['values'], '$.values'),
  };
};

const identityDraftFieldError = (value: unknown, path: string): IdentityDraftFieldError => {
  const object = exact(value, 'field reason', path);
  const field = text(object['field'], `${path}.field`);
  const reasons = Object.hasOwn(FIELD_REASONS, field) ? FIELD_REASONS[field] : undefined;
  if (reasons === undefined) return unrecognized(`${path}.field`, field);
  oneOf(object['reason'], reasons, `${path}.reason`);
  return validated(value);
};

const identityDraftRefusal = (value: unknown, path: string): IdentityDraftRefusal => {
  const shape = record(value, path);
  const code = text(shape['code'], `${path}.code`);
  if (code === 'INVALID_FIELD') {
    const object = exact(value, 'code error', path);
    return { code, error: identityDraftFieldError(object['error'], `${path}.error`) };
  }
  if (code === 'STALE_DRAFT') {
    const object = exact(value, 'actual code expected', path);
    integer(object['expected'], `${path}.expected`);
    integer(object['actual'], `${path}.actual`);
    return validated(value);
  }
  if (code === 'STALE_REVISION') {
    const object = exact(value, 'actual code expected', path);
    revisions(object['expected'], `${path}.expected`);
    revisions(object['actual'], `${path}.actual`);
    return validated(value);
  }
  if (code === 'IDEMPOTENCY_CONFLICT') {
    const object = exact(value, 'code detail', path);
    literal(object['detail'], 'PAYLOAD_MISMATCH', `${path}.detail`);
    return validated(value);
  }
  if (code === 'DRAFT_UNAVAILABLE') {
    exact(value, 'code', path);
    return validated(value);
  }
  if (code === 'REVISION_OVERFLOW') {
    const object = exact(value, 'axis code', path);
    oneOf(object['axis'], IDENTITY_DRAFT_OVERFLOW_AXES, `${path}.axis`);
    return validated(value);
  }
  return unrecognized(`${path}.code`, code);
};

const identityDraftPresentation = (
  value: unknown,
  path: string,
  vocabulary: WireV3Vocabulary,
  scope: IdentityDraftScope,
  draftRevision: number,
): IdentityDraftPresentation => {
  const object = exact(value, 'base layers', path);
  const identityBase = presentedForm(object['base'], `${path}.base`, false, vocabulary);
  const identityLayers = array(object['layers'], `${path}.layers`).map((item, index) =>
    presentedForm(item, `${path}.layers[${String(index)}]`, true, vocabulary),
  );
  literal(identityBase.formId, 'CHR-001', `${path}.base.formId`);
  const bindingIndex = identityBase.routeBindings.findIndex(
    (binding) => binding.parameterIndex === 0,
  );
  if (bindingIndex === -1) {
    return invalid(
      `${path}.base.routeBindings`,
      'characterDraftId binding at parameterIndex 0',
      identityBase.routeBindings,
    );
  }
  const binding = identityBase.routeBindings[bindingIndex];
  if (binding === undefined) return invalid(`${path}.base.routeBindings`, 'binding', undefined);
  const bindingPath = `${path}.base.routeBindings[${String(bindingIndex)}]`;
  literal(binding.source, 'executor-allocated', `${bindingPath}.source`);
  literal(binding.value, scope.characterDraftId, `${bindingPath}.value`);
  const payload = identityBase.roleFilteredPayload;
  const payloadPath = `${path}.base.roleFilteredPayload`;
  literal(payload['characterDraftId'], scope.characterDraftId, `${payloadPath}.characterDraftId`);
  literal(
    payload['wizardCheckpointId'],
    scope.wizardCheckpointId,
    `${payloadPath}.wizardCheckpointId`,
  );
  const draftPath = `${payloadPath}.draftRevision`;
  const payloadDraftRevision = integer(payload['draftRevision'], draftPath);
  if (payloadDraftRevision !== draftRevision) unrecognized(draftPath, payloadDraftRevision);
  identityDraftPayloadValues(payload, payloadPath);
  return {
    base: identityBase as PresentedBaseForm,
    layers: identityLayers as readonly PresentedLayerForm[],
  };
};

const identityDraftResult = (
  value: unknown,
  vocabulary: WireV3Vocabulary,
): IdentityDraftResultV3Message => {
  const object = exact(
    value,
    'draftRevision draftUpdateId messageType presentation projectionRole protocolVersion revisions scope',
  );
  literal(object['messageType'], 'character.identity-draft.result', '$.messageType');
  text(object['draftUpdateId'], '$.draftUpdateId');
  const scope = identityDraftScope(object['scope'], '$.scope');
  const draftRevision = integer(object['draftRevision'], '$.draftRevision');
  revisions(object['revisions'], '$.revisions');
  literal(object['projectionRole'], 'player', '$.projectionRole');
  identityDraftPresentation(
    object['presentation'],
    '$.presentation',
    vocabulary,
    scope,
    draftRevision,
  );
  return validated(value);
};

const identityDraftRefusalMessage = (value: unknown): IdentityDraftRefusalV3Message => {
  const object = exact(
    value,
    'draftUpdateId messageType presentationUnchanged protocolVersion refusal revisions scope',
  );
  literal(object['messageType'], 'character.identity-draft.refusal', '$.messageType');
  text(object['draftUpdateId'], '$.draftUpdateId');
  identityDraftScope(object['scope'], '$.scope');
  const currentRevisions = revisions(object['revisions'], '$.revisions');
  literal(object['presentationUnchanged'], true, '$.presentationUnchanged');
  const refusal = identityDraftRefusal(object['refusal'], '$.refusal');
  if (refusal.code === 'STALE_REVISION') {
    for (const axis of REVISION_AXES) {
      if (refusal.actual[axis] !== currentRevisions[axis]) {
        unrecognized(`$.refusal.actual.${axis}`, refusal.actual[axis]);
      }
    }
  }
  return validated(value);
};

const clientValue = (value: unknown): ClientToHostV3Message => {
  const object = base(value);
  if (object['messageType'] === 'character.identity-draft.replace') {
    return identityDraftReplace(value);
  }
  return unrecognized('$.messageType', text(object['messageType'], '$.messageType'));
};

const hostValue = (value: unknown, vocabulary: WireV3Vocabulary): HostToClientV3Message => {
  const object = base(value);
  if (object['messageType'] === 'character.identity-draft.result') {
    return identityDraftResult(value, vocabulary);
  }
  if (object['messageType'] === 'character.identity-draft.refusal') {
    return identityDraftRefusalMessage(value);
  }
  return unrecognized('$.messageType', text(object['messageType'], '$.messageType'));
};

export const decodeClientMessageV3 = (
  source: string,
  _vocabulary: WireV3Vocabulary,
): DecodeResult<ClientToHostV3Message> => parse(source, clientValue);

export const decodeHostMessageV3 = (
  source: string,
  vocabulary: WireV3Vocabulary,
): DecodeResult<HostToClientV3Message> => parse(source, (value) => hostValue(value, vocabulary));

export const encodeClientMessageV3 = (
  value: ClientToHostV3Message,
  _vocabulary: WireV3Vocabulary,
): EncodeResult => encode(value, clientValue);

export const encodeHostMessageV3 = (
  value: HostToClientV3Message,
  vocabulary: WireV3Vocabulary,
): EncodeResult => encode(value, (candidate) => hostValue(candidate, vocabulary));
