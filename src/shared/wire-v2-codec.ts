import { wireCodecPrimitives } from './wire-codec.js';
import { WIRE_PROTOCOL_V2_VERSION } from './wire-v2-protocol.js';
import type {
  AddressableRouteIntentV2Message,
  AssignedRouteBinding,
  ClientSelectedRouteBinding,
  ClientToHostV2Message,
  FormActionIntentV2Message,
  HostToClientV2Message,
  IdentityDraftArtValue,
  IdentityDraftFieldError,
  IdentityDraftPresentation,
  IdentityDraftRefusal,
  IdentityDraftRefusalV2Message,
  IdentityDraftReplaceV2Message,
  IdentityDraftResultV2Message,
  IdentityDraftScope,
  IdentityDraftValues,
  PresentedBaseForm,
  PresentedLayerForm,
  ProjectionSnapshotV2Message,
  SessionReconnectCapabilitiesV2Message,
  SessionReconnectV2Message,
  WireV2Vocabulary,
} from './wire-v2-protocol.js';
import type {
  DecodeResult,
  EncodeResult,
  RevisionVector,
  WorkflowCommandId,
} from './wire-protocol.js';

const LAYER_TYPES = new Set(['banner', 'component', 'dialog', 'overlay', 'specification']);
const BINDING_SOURCES = new Set(['client-selected', 'executor-allocated', 'inherited']);
const ASSIGNMENT_REASONS = new Set([
  'ADDRESSABLE_ROUTE',
  'COMMAND_DESTINATION',
  'FORM_ACTION',
  'HOST_SYSTEM_EVENT',
  'RECONNECT',
]);
const IDENTITY_DRAFT_MEDIA_TYPES = new Set(['image/jpeg', 'image/png']);
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

/**
 * The wire boundary validates the representation locally so a lower-layer
 * brand does not reverse the dependency direction.
 */
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const {
  abortInvalid: invalid,
  abortUnrecognized: unrecognized,
  capabilityId,
  encode,
  exact,
  json: jsonValue,
  jsonObject,
  literal,
  list,
  oneOf,
  parse,
  record,
  revision: integer,
  revisions,
  role,
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

const clientBinding = (value: unknown, path: string): ClientSelectedRouteBinding => {
  const object = exact(value, 'parameterIndex source value', path);
  integer(object['parameterIndex'], `${path}.parameterIndex`);
  literal(object['source'], 'client-selected', `${path}.source`);
  text(object['value'], `${path}.value`);
  return validated(value);
};

const assignedBinding = (value: unknown, path: string): AssignedRouteBinding => {
  const object = exact(value, 'parameterIndex source value', path);
  integer(object['parameterIndex'], `${path}.parameterIndex`);
  oneOf(object['source'], BINDING_SOURCES, `${path}.source`);
  text(object['value'], `${path}.value`);
  return validated(value);
};

const formId = (value: unknown, path: string, vocabulary: WireV2Vocabulary) => {
  const candidate = text(value, path);
  if (vocabulary.isFormId(candidate)) return candidate;
  return unrecognized(path, candidate);
};

const deviceId = (value: unknown, path: string): string => {
  const candidate = text(value, path);
  if (DEVICE_ID_PATTERN.test(candidate)) return candidate;
  return unrecognized(path, candidate);
};

const workflowCommandId = (
  value: unknown,
  path: string,
  vocabulary: WireV2Vocabulary,
): WorkflowCommandId => {
  const candidate = text(value, path);
  if (vocabulary.isWorkflowCommandId(candidate)) return candidate;
  return unrecognized(path, candidate);
};

const presentedForm = (
  value: unknown,
  path: string,
  layer: boolean,
  vocabulary: WireV2Vocabulary,
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

const presentation = (value: unknown, vocabulary: WireV2Vocabulary): void => {
  const object = exact(value, 'assignment base layers', '$.presentation');
  const assignment = exact(
    object['assignment'],
    'correlationId reason',
    '$.presentation.assignment',
  );
  text(assignment['correlationId'], '$.presentation.assignment.correlationId');
  oneOf(assignment['reason'], ASSIGNMENT_REASONS, '$.presentation.assignment.reason');
  presentedForm(object['base'], '$.presentation.base', false, vocabulary);
  array(object['layers'], '$.presentation.layers').forEach((item, index) =>
    presentedForm(item, `$.presentation.layers[${String(index)}]`, true, vocabulary),
  );
};

const base = (value: unknown): Record<string, unknown> => {
  const object = record(value, '$');
  if (!Object.hasOwn(object, 'protocolVersion')) {
    invalid('$.protocolVersion', 'required field', undefined);
  }
  if (object['protocolVersion'] !== WIRE_PROTOCOL_V2_VERSION) {
    unrecognized('$.protocolVersion', jsonValue(object['protocolVersion'], '$.protocolVersion'));
  }
  if (!Object.hasOwn(object, 'messageType')) invalid('$.messageType', 'required field', undefined);
  text(object['messageType'], '$.messageType');
  return object;
};

const formActionIntent = (
  value: unknown,
  vocabulary: WireV2Vocabulary,
): FormActionIntentV2Message => {
  const object = exact(
    value,
    'actionKey expectedProjectionRevision messageType navigationRequestId protocolVersion sourceFormId',
  );
  literal(object['messageType'], 'navigation.form-action', '$.messageType');
  const sourceFormId = formId(object['sourceFormId'], '$.sourceFormId', vocabulary);
  const actionKey = text(object['actionKey'], '$.actionKey');
  if (!vocabulary.isFormActionKey(sourceFormId, actionKey)) {
    unrecognized('$.actionKey', actionKey);
  }
  integer(object['expectedProjectionRevision'], '$.expectedProjectionRevision');
  text(object['navigationRequestId'], '$.navigationRequestId');
  return validated(value);
};

const routeIntent = (
  value: unknown,
  vocabulary: WireV2Vocabulary,
): AddressableRouteIntentV2Message => {
  const object = exact(
    value,
    'bindings expectedProjectionRevision messageType navigationRequestId protocolVersion routeTemplate',
  );
  literal(object['messageType'], 'navigation.addressable-route', '$.messageType');
  const bindings = bindingList(object['bindings'], '$.bindings', clientBinding);
  integer(object['expectedProjectionRevision'], '$.expectedProjectionRevision');
  text(object['navigationRequestId'], '$.navigationRequestId');
  const routeTemplate = text(object['routeTemplate'], '$.routeTemplate');
  if (!vocabulary.isAddressableRouteTemplate(routeTemplate)) {
    return unrecognized('$.routeTemplate', routeTemplate);
  }
  if (!vocabulary.isClientRouteBindings(routeTemplate, bindings)) {
    unrecognized('$.bindings', jsonValue(object['bindings'], '$.bindings'));
  }
  return validated(value);
};

const sessionReconnect = (value: unknown): SessionReconnectV2Message => {
  const object = exact(
    value,
    'deviceId knownRevisions messageType protocolVersion reconnectRequestId supportedWorkflowCommandIds unacknowledgedCommandIds',
  );
  literal(object['messageType'], 'session.reconnect', '$.messageType');
  deviceId(object['deviceId'], '$.deviceId');
  revisions(object['knownRevisions'], '$.knownRevisions');
  text(object['reconnectRequestId'], '$.reconnectRequestId');
  list(object['supportedWorkflowCommandIds'], '$.supportedWorkflowCommandIds', capabilityId);
  list(object['unacknowledgedCommandIds'], '$.unacknowledgedCommandIds', text);
  return validated(value);
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

const nullableStringValue = (value: unknown, path: string): string | null =>
  value === null ? null : stringValue(value, path);

const nullableFiniteNumber = (value: unknown, path: string): number | null =>
  value === null ? null : finiteNumber(value, path);

const identityDraftValues = (value: unknown, path: string): IdentityDraftValues => {
  const object = exact(value, 'age artAssetKeyOrLocalFile description massKg name', path);
  return {
    name: nullableStringValue(object['name'], `${path}.name`),
    description: nullableStringValue(object['description'], `${path}.description`),
    artAssetKeyOrLocalFile: identityDraftArtValue(
      object['artAssetKeyOrLocalFile'],
      `${path}.artAssetKeyOrLocalFile`,
    ),
    age: nullableFiniteNumber(object['age'], `${path}.age`),
    massKg: nullableFiniteNumber(object['massKg'], `${path}.massKg`),
  };
};

const identityDraftReplace = (value: unknown): IdentityDraftReplaceV2Message => {
  const object = exact(
    value,
    'draftUpdateId expectedDraftRevision expectedRevisions messageType protocolVersion scope values',
  );
  literal(object['messageType'], 'character.identity-draft.replace', '$.messageType');
  return {
    protocolVersion: WIRE_PROTOCOL_V2_VERSION,
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

const refusalPayload = (value: unknown, path: string, route: boolean): void => {
  const object = record(value, path);
  const code = text(object['code'], `${path}.code`);
  if (code === 'NAVIGATION_UNAVAILABLE' || (route && code === 'INVALID_BINDINGS')) {
    exact(value, 'code', path);
  } else if (code === 'IDEMPOTENCY_CONFLICT') {
    const conflict = exact(value, 'code detail', path);
    literal(conflict['detail'], 'PAYLOAD_MISMATCH', `${path}.detail`);
  } else if (code === 'STALE_PROJECTION') {
    const stale = exact(value, 'actualProjectionRevision code expectedProjectionRevision', path);
    integer(stale['actualProjectionRevision'], `${path}.actualProjectionRevision`);
    integer(stale['expectedProjectionRevision'], `${path}.expectedProjectionRevision`);
  } else {
    unrecognized(`${path}.code`, code);
  }
};

const refusalMessage = (value: unknown, route: boolean): HostToClientV2Message => {
  const object = exact(
    value,
    'messageType navigationRequestId presentationUnchanged protocolVersion refusal revisions',
  );
  literal(
    object['messageType'],
    route ? 'navigation.addressable-route.refusal' : 'navigation.form-action.refusal',
    '$.messageType',
  );
  text(object['navigationRequestId'], '$.navigationRequestId');
  literal(object['presentationUnchanged'], true, '$.presentationUnchanged');
  refusalPayload(object['refusal'], '$.refusal', route);
  revisions(object['revisions'], '$.revisions');
  return validated(value);
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
  vocabulary: WireV2Vocabulary,
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
  const bindingPath = `${path}.base.routeBindings[${bindingIndex}]`;
  literal(binding.source, 'executor-allocated', `${bindingPath}.source`);
  literal(binding.value, scope.characterDraftId, `${bindingPath}.value`);
  const payload = identityBase.roleFilteredPayload;
  const payloadPath = `${path}.base.roleFilteredPayload`;
  const characterPath = `${payloadPath}.characterDraftId`;
  literal(payload['characterDraftId'], scope.characterDraftId, characterPath);
  const checkpointPath = `${payloadPath}.wizardCheckpointId`;
  literal(payload['wizardCheckpointId'], scope.wizardCheckpointId, checkpointPath);
  const draftPath = `${payloadPath}.draftRevision`;
  const payloadDraftRevision = integer(payload['draftRevision'], draftPath);
  if (payloadDraftRevision !== draftRevision) {
    unrecognized(draftPath, payloadDraftRevision);
  }
  return {
    base: identityBase as PresentedBaseForm,
    layers: identityLayers as readonly PresentedLayerForm[],
  };
};

const identityDraftResult = (
  value: unknown,
  vocabulary: WireV2Vocabulary,
): IdentityDraftResultV2Message => {
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

const identityDraftRefusalMessage = (value: unknown): IdentityDraftRefusalV2Message => {
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
      if (refusal.actual[axis] !== currentRevisions[axis])
        unrecognized(`$.refusal.actual.${axis}`, refusal.actual[axis]);
    }
  }
  return validated(value);
};

const snapshot = (value: unknown, vocabulary: WireV2Vocabulary): ProjectionSnapshotV2Message => {
  const object = exact(value, 'messageType presentation projectionRole protocolVersion revisions');
  literal(object['messageType'], 'projection.snapshot', '$.messageType');
  presentation(object['presentation'], vocabulary);
  if (object['projectionRole'] !== null) role(object['projectionRole'], '$.projectionRole');
  revisions(object['revisions'], '$.revisions');
  return validated(value);
};

const sessionReconnectCapabilities = (
  value: unknown,
  vocabulary: WireV2Vocabulary,
): SessionReconnectCapabilitiesV2Message => {
  const object = exact(
    value,
    'executableWorkflowCommandIds messageType protocolVersion reconnectRequestId revisions',
  );
  literal(object['messageType'], 'session.reconnect.capabilities', '$.messageType');
  list(object['executableWorkflowCommandIds'], '$.executableWorkflowCommandIds', (entry, path) =>
    workflowCommandId(entry, path, vocabulary),
  );
  text(object['reconnectRequestId'], '$.reconnectRequestId');
  revisions(object['revisions'], '$.revisions');
  return validated(value);
};

const clientValue = (value: unknown, vocabulary: WireV2Vocabulary): ClientToHostV2Message => {
  const object = base(value);
  if (object['messageType'] === 'navigation.form-action') {
    return formActionIntent(value, vocabulary);
  }
  if (object['messageType'] === 'navigation.addressable-route') {
    return routeIntent(value, vocabulary);
  }
  if (object['messageType'] === 'character.identity-draft.replace') {
    return identityDraftReplace(value);
  }
  if (object['messageType'] === 'session.reconnect') return sessionReconnect(value);
  return unrecognized('$.messageType', text(object['messageType'], '$.messageType'));
};

const hostValue = (value: unknown, vocabulary: WireV2Vocabulary): HostToClientV2Message => {
  const object = base(value);
  if (object['messageType'] === 'navigation.form-action.refusal') {
    return refusalMessage(value, false);
  }
  if (object['messageType'] === 'navigation.addressable-route.refusal') {
    return refusalMessage(value, true);
  }
  if (object['messageType'] === 'session.reconnect.capabilities') {
    return sessionReconnectCapabilities(value, vocabulary);
  }
  if (object['messageType'] === 'character.identity-draft.result') {
    return identityDraftResult(value, vocabulary);
  }
  if (object['messageType'] === 'character.identity-draft.refusal') {
    return identityDraftRefusalMessage(value);
  }
  if (object['messageType'] === 'projection.snapshot') return snapshot(value, vocabulary);
  return unrecognized('$.messageType', text(object['messageType'], '$.messageType'));
};

export const decodeClientMessageV2 = (
  source: string,
  vocabulary: WireV2Vocabulary,
): DecodeResult<ClientToHostV2Message> => parse(source, (value) => clientValue(value, vocabulary));

export const decodeHostMessageV2 = (
  source: string,
  vocabulary: WireV2Vocabulary,
): DecodeResult<HostToClientV2Message> => parse(source, (value) => hostValue(value, vocabulary));

export const encodeClientMessageV2 = (
  value: ClientToHostV2Message,
  vocabulary: WireV2Vocabulary,
): EncodeResult => encode(value, (candidate) => clientValue(candidate, vocabulary));

export const encodeHostMessageV2 = (
  value: HostToClientV2Message,
  vocabulary: WireV2Vocabulary,
): EncodeResult => encode(value, (candidate) => hostValue(candidate, vocabulary));
