import {
  evaluateNpcCompositionConsequences,
  type NpcCompositionConsequenceCatalog,
} from './composition-consequences.js';
import type { NpcCompositionConsequenceResult } from './composition-consequence-types.js';
import type { NpcOrdinaryCompositionInstance } from './ordinary-composition-types.js';
import { readNpcFormalLifeBoundary, type NpcFormalLifeState } from './formal-life-state.js';
import { npcPublicationData as data } from './inventory-publication.js';

export type NpcTaipanPoisonProfileId =
  'POI-TAIPAN-DEADLY' | 'POI-TAIPAN-WEAKENING' | 'POI-TAIPAN-PARALYTIC';
export type NpcTaipanPoisonAbilityId = 'SYM-039' | 'SYM-042' | 'SYM-045';
export type NpcPoisonOrigin =
  | Readonly<{ kind: 'PREPARED'; preparationOperationId: string }>
  | Readonly<{ kind: 'COMMITTED'; originCommitOperationId: string }>;
export interface NpcTaipanModeHistoryAnchor {
  readonly kind: 'GM_FORMAL_INITIAL_TAIPAN_MODE';
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly sourceInstanceId: string;
  readonly acquisitionFactId: string;
  readonly modeOperationId: string;
  readonly effectInstanceId: string;
  readonly activePoisonProfileId: NpcTaipanPoisonProfileId;
  /** No played SYM-181 journal exists in this initial-authoring slice. */
  readonly pendingSwitchOrNull: null;
  readonly reason: string;
  readonly createdAt: string;
}
export interface NpcTaipanModeContext {
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly campaignTimestampOrNull: number | null;
  readonly origin: NpcPoisonOrigin;
  readonly originalCompositionProof: unknown;
  /** Actual version preceding the initial assignment; retained instances cannot be reassigned. */
  readonly previousVersionCompositionProofOrNull: unknown;
  readonly currentCompositionProof: unknown;
}
export type NpcPoisonLifeObservation =
  | Readonly<{ kind: 'NOT_CONFIRMED_DRAFT' }>
  | Readonly<{ kind: 'CARRY_PREVIOUS' }>
  | Readonly<{ kind: 'CONFIRMED'; state: NpcFormalLifeState }>;
export interface NpcPoisonSourceObservation {
  readonly operationId: string;
  readonly kind:
    | 'PREPARATION'
    | 'COMPOSITION_CONFIRMATION'
    | 'COMPOSITION_RESOLUTION'
    | 'LIFE_STATE_SET'
    | 'COMMIT';
  readonly campaignTimestamp: number;
  readonly compositionProof: unknown;
  readonly life: NpcPoisonLifeObservation;
}
export interface NpcPoisonSourceContext {
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly campaignTimestamp: number;
  readonly origin: NpcPoisonOrigin;
  /** Existing target COMMIT only; uncommitted previews explicitly carry null. */
  readonly targetCommitOperationIdOrNull: string | null;
  /** Complete relevant owning prefix from this dose's actual preparation to its target. */
  readonly observations: readonly NpcPoisonSourceObservation[];
  /** Current projection after unrelated owning operations; never another historical event. */
  readonly currentTarget?: Readonly<{
    owningOperationId: string;
    compositionProof: unknown;
    life: Exclude<NpcPoisonLifeObservation, Readonly<{ kind: 'CARRY_PREVIOUS' }>>;
  }>;
}
declare const catalogBrand: unique symbol;
declare const modeBrand: unique symbol;
declare const sourceBrand: unique symbol;
export interface NpcPoisonSourceCatalog {
  readonly [catalogBrand]: true;
}
export interface NpcTaipanModeContribution {
  readonly [modeBrand]: true;
}
export interface NpcPoisonSourceContribution {
  readonly [sourceBrand]: true;
}
interface ModeValue {
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly campaignTimestampOrNull: number | null;
  readonly sourceInstanceId: string;
  readonly modeOperationId: string;
  readonly effectInstanceId: string;
  readonly activePoisonProfileId: NpcTaipanPoisonProfileId;
  readonly sourceAbilityId: NpcTaipanPoisonAbilityId;
  readonly sourceSnapshot: NpcOrdinaryCompositionInstance;
  readonly currentSourceSnapshot: NpcOrdinaryCompositionInstance;
  readonly pendingSwitchOrNull: null;
  readonly origin: NpcPoisonOrigin;
  readonly history: NpcTaipanModeHistoryAnchor;
}
interface SourceValue {
  readonly campaignId: string;
  readonly npcUuid: string;
  readonly campaignTimestamp: number;
  readonly sourceInstanceId: string;
  readonly modeOperationId: string;
  readonly preparationOperationId: string;
  readonly originalCampaignTimestamp: number;
  readonly activePoisonProfileId: NpcTaipanPoisonProfileId;
  readonly sourceAbilityId: NpcTaipanPoisonAbilityId;
  readonly sourceSnapshot: NpcOrdinaryCompositionInstance;
  readonly originalSourceSnapshot: NpcOrdinaryCompositionInstance;
  readonly effectiveSourceSnapshot: NpcOrdinaryCompositionInstance;
  readonly initialPreparationAllowed: boolean;
  readonly currentPreparationAllowed: boolean;
  readonly lifeEvidence: 'NOT_CONFIRMED_DRAFT' | 'CONFIRMED';
  readonly origin: NpcPoisonOrigin;
  readonly targetCommitOperationIdOrNull: string | null;
  readonly resolution: Readonly<{
    kind: 'CURRENT' | 'FROZEN';
    observationOperationId: string;
    unavailableOperationIdOrNull: string | null;
    unavailableReasonOrNull: 'SOURCE_REMOVED' | 'SOURCE_DESTROYED' | 'OWNER_DEAD' | null;
  }>;
}
interface CatalogContext {
  readonly composition: NpcCompositionConsequenceCatalog;
  readonly profiles: ReadonlyMap<NpcTaipanPoisonProfileId, NpcTaipanPoisonAbilityId>;
  readonly labels: ReadonlyMap<string, string>;
}
const catalogs = new WeakMap<NpcPoisonSourceCatalog, CatalogContext>();
const modes = new WeakMap<
  NpcTaipanModeContribution,
  Readonly<{
    catalog: NpcPoisonSourceCatalog;
    value: ModeValue;
    currentProof: unknown;
  }>
>();
const sources = new WeakMap<
  NpcPoisonSourceContribution,
  Readonly<{
    catalog: NpcPoisonSourceCatalog;
    value: SourceValue;
    targetCompositionProof: unknown;
    targetLifeStateOrNull: NpcFormalLifeState | null;
  }>
>();
export class NpcPoisonSourceError extends Error {
  constructor(detail: string) {
    super('NPC poison source: ' + detail);
    this.name = 'NpcPoisonSourceError';
  }
}
function fail(detail: string): never {
  throw new NpcPoisonSourceError(detail);
}
function context(catalog: NpcPoisonSourceCatalog) {
  return catalogs.get(catalog) ?? fail('issued source catalog required');
}
export function assertNpcPoisonSourceCatalog(catalog: NpcPoisonSourceCatalog): void {
  context(catalog);
}
function one(value: unknown, field: string, id: string) {
  const rows = data
    .array(value)
    .map((r) => data.record(r))
    .filter((r) => r[field] === id);
  return rows.length === 1 ? rows[0]! : fail('exact source ' + id + ' required');
}
function minute(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail('confirmed virtual minute required');
}
function origin(value: unknown): NpcPoisonOrigin {
  const r = data.record(value);
  if (r.kind === 'PREPARED') {
    data.record(r, ['kind', 'preparationOperationId']);
    return { kind: 'PREPARED', preparationOperationId: data.uuid(r.preparationOperationId) };
  }
  if (r.kind === 'COMMITTED') {
    data.record(r, ['kind', 'originCommitOperationId']);
    return { kind: 'COMMITTED', originCommitOperationId: data.uuid(r.originCommitOperationId) };
  }
  return fail('actual preparation or committed origin required');
}
function profile(catalog: NpcPoisonSourceCatalog, value: unknown): NpcTaipanPoisonProfileId {
  return typeof value === 'string' &&
    context(catalog).profiles.has(value as NpcTaipanPoisonProfileId)
    ? (value as NpcTaipanPoisonProfileId)
    : fail('known explicit learned poison profile required');
}
function actual(
  catalog: NpcPoisonSourceCatalog,
  proof: unknown,
  npcUuid: string,
  previous: unknown = null,
) {
  const result = evaluateNpcCompositionConsequences(context(catalog).composition, proof, previous);
  data.equal(npcUuid, result.proof.identityKey);
  return result;
}
function member(result: NpcCompositionConsequenceResult, id: string) {
  const found = result.composition.instances.find((m) => m.symbiontInstanceId === id);
  if (found === undefined || found.speciesKey !== 'TAIPAN')
    return fail('actual same Taipan instance required');
  return found;
}
export function createNpcPoisonSourceCatalog(
  source: Readonly<{
    compositionConsequences: NpcCompositionConsequenceCatalog;
    rules: unknown;
    developmentNodes: unknown;
    poisonProfiles: unknown;
    effectTypes: unknown;
    npcInitialStateForm: unknown;
  }>,
): NpcPoisonSourceCatalog {
  data.record(source, [
    'compositionConsequences',
    'rules',
    'developmentNodes',
    'poisonProfiles',
    'effectTypes',
    'npcInitialStateForm',
  ]);
  const form = data.record(source.npcInitialStateForm);
  data.equal('NPC-016', form.id);
  const clauses = data.array(form.acceptanceCriteria);
  for (const witness of SOURCE_WITNESSES)
    if (!clauses.includes(witness))
      return fail('accepted ADR0087 source delivery absent or changed');
  const profiles = new Map<NpcTaipanPoisonProfileId, NpcTaipanPoisonAbilityId>(),
    labels = new Map<string, string>();
  const modeType = one(source.effectTypes, 'EffectTypeID', 'EFF-SYMBIONT-POISON_MODE');
  for (const [key, expected] of Object.entries({
    Automation: 'AUTOMATED',
    'Schema status': 'DEFINED',
    FamilyCode: 'FAM-SYMBIONT_STATE',
    'Rule refs': 'SYM-181',
    'Stack policy': 'ONE_ACTIVE_MODE',
    'State bucket': 'initialRuntimeState',
    'State writes': 'activePoisonType',
    'Timer policy': 'SOURCE_SPECIFIC_OR_EXPLICIT',
    'Removal policy': 'SWITCH_COMPLETE',
  }))
    data.equal(expected, modeType[key]);
  for (const [id, ability, level, payloadKind, payload] of [
    ['POI-TAIPAN-DEADLY', 'SYM-039', 1, 'PERIODIC_DAMAGE', 'R20/5+L per turn; duration R20/2'],
    [
      'POI-TAIPAN-WEAKENING',
      'SYM-042',
      4,
      'STAT_DEBUFF',
      'K=max(0,R20+L−Z); S/D/M decrease, each not below 1; duration R20/2',
    ],
    [
      'POI-TAIPAN-PARALYTIC',
      'SYM-045',
      7,
      'LIMB_DISABLE',
      'if R20+L>Z: humanoid active limb; duration R20/3; nonhumanoid secondary paralysis skipped',
    ],
  ] as const) {
    const node = one(source.developmentNodes, 'NodeRef', ability);
    for (const [key, expected] of Object.entries({
      SpeciesKey: 'TAIPAN',
      AbilityID: ability,
      'Rule IDs': ability,
      L: level,
      AutomationStatus: 'AUTOMATED_ACCEPTED',
    }))
      data.equal(expected, node[key]);
    const poison = one(source.poisonProfiles, 'PoisonProfileID', id);
    for (const [key, expected] of Object.entries({
      'Source kind': 'SYMBIOTIC',
      'Effect family': 'POISON',
      'Rule refs': ability,
      'Payload kind': payloadKind,
      Payload: payload,
    }))
      data.equal(expected, poison[key]);
    profiles.set(id, ability);
    labels.set(id, data.text(poison['Название']));
  }
  for (const id of ['SYM-039', 'SYM-042', 'SYM-045', 'SYM-181', 'SYM-183', 'CQA-002'])
    data.equal('Активно', one(source.rules, 'Rule ID', id)['Статус']);
  for (const [id, clause] of [
    [
      'SYM-039',
      'При нанесении на оружие урон за ход делится пополам; остальные параметры неизменны.',
    ],
    ['SYM-042', 'На оружии K делится пополам.'],
    ['SYM-045', 'На оружии длительность делится пополам.'],
  ] as const)
    if (!data.text(one(source.rules, 'Rule ID', id)['Итоговый алгоритм']).includes(clause))
      return fail('exact source delivery reduction clause required: ' + id);
  data.equal(
    'Без расхода ОЭ выполнить одну атомарную мирную операцию и зафиксировать на выбранном экземпляре одну дозу текущего яда. На оружии или снаряде доза хранится до первого успешного попадания и затем расходуется; эффективность уменьшается вдвое по профильному правилу, остальные проверки и параметры не меняются. В пище доза хранится до употребления и после проглатывания применяет полный профиль яда.',
    one(source.rules, 'Rule ID', 'SYM-183')['Итоговый алгоритм'],
  );
  data.equal(
    'Мгновенно разрешённый результат не откатывается. Поддерживаемые источником формы, ауры, полёт, маскировка, каналы, управление и контактные зоны прекращаются, когда источник умер, потерял дееспособность, соответствующий симбионт отключён или удалён либо источник исключён с карты. Уже отделённые физические объекты и снаряды, мины, паутина, введённые яды, заражения и автономные эффекты с собственным таймером продолжаются до явного окончания независимо от состояния источника. Пока источник доступен, продолжающийся эффект при каждом применении числовой величины использует текущий L по Q-SYM-006. Если источник погиб, удалён либо его состояние больше нельзя прочитать, L и остальные ещё не вычисленные параметры фиксируются на последнем доступном значении. Прямое правило конкретной способности имеет приоритет.',
    one(source.rules, 'Rule ID', 'CQA-002')['Итоговый алгоритм'],
  );
  data.equal(
    'Нормативная база (действует во всей непротиворечащей части):\nодновременно вырабатывать один тип из {смертельный, ослабляющий, парализующий}; смена завершается через 1 игровой час/6 боевых ходов.\nПриоритетные авторские дельты (заменяют только прямо пересекающиеся ветви):\n[Q-SYM-076] Игрок опционально задаёт новый изученный вид яда в начале своего хода без отдельного действия (для этого у него отображается вариант действия «Сменить тип яда»). В течение следующего часа/6 полных ходов продолжает вырабатываться прежний яд, обычные действия носителя свободны. По окончании таймера активным становится новый вид. Отключение Тайпана или новая команда сбрасывает прогресс и оставляет прежний вид до завершения нового полного таймера.',
    one(source.rules, 'Rule ID', 'SYM-181')['Итоговый алгоритм'],
  );
  const catalog = Object.freeze({}) as NpcPoisonSourceCatalog;
  catalogs.set(catalog, { composition: source.compositionConsequences, profiles, labels });
  return catalog;
}
export function npcTaipanPoisonProfileLabel(
  catalog: NpcPoisonSourceCatalog,
  profileId: unknown,
): string {
  return (
    context(catalog).labels.get(data.text(profileId)) ??
    fail('recognized poison profile label required')
  );
}
export function npcTaipanInitialModeChoices(
  catalog: NpcPoisonSourceCatalog,
  input: Readonly<{
    npcUuid: string;
    compositionProof: unknown;
    previousVersionCompositionProofOrNull: unknown;
  }>,
) {
  data.record(input, ['npcUuid', 'compositionProof', 'previousVersionCompositionProofOrNull']);
  const npcUuid = data.uuid(input.npcUuid),
    current = actual(
      catalog,
      input.compositionProof,
      npcUuid,
      input.previousVersionCompositionProofOrNull,
    );
  if (current.obligationStatus !== 'RESOLVED') return fail('complete actual composition required');
  const prior =
    input.previousVersionCompositionProofOrNull === null
      ? null
      : actual(catalog, input.previousVersionCompositionProofOrNull, npcUuid);
  return data.freeze(
    current.composition.instances
      .filter(
        (m) =>
          m.speciesKey === 'TAIPAN' &&
          !prior?.composition.instances.some((p) => p.symbiontInstanceId === m.symbiontInstanceId),
      )
      .map((m) => ({
        sourceInstanceId: m.symbiontInstanceId,
        acquisitionFactId: m.acquisitionFactId,
        profiles: [...context(catalog).profiles]
          .filter(([, a]) => m.learnedNodeRefs.includes(a))
          .map(([p, a]) => ({ poisonProfileId: p, sourceAbilityId: a })),
      })),
  );
}
/** Complete source roster; a retained mode cannot disappear merely because it is no longer new. */
export function npcTaipanModeSourceRoster(
  catalog: NpcPoisonSourceCatalog,
  input: Readonly<{ npcUuid: string; compositionProof: unknown }>,
): readonly string[] {
  data.record(input, ['npcUuid', 'compositionProof']);
  const result = actual(catalog, input.compositionProof, data.uuid(input.npcUuid));
  if (result.obligationStatus !== 'RESOLVED') return fail('complete actual composition required');
  return data.freeze(
    result.composition.instances
      .filter((member) => member.speciesKey === 'TAIPAN')
      .map((member) => member.symbiontInstanceId),
  );
}
export function deriveNpcTaipanModeContribution(
  catalog: NpcPoisonSourceCatalog,
  history: NpcTaipanModeHistoryAnchor,
  supplied: NpcTaipanModeContext,
): NpcTaipanModeContribution {
  const h = data.record(history, [
    'kind',
    'campaignId',
    'npcUuid',
    'sourceInstanceId',
    'acquisitionFactId',
    'modeOperationId',
    'effectInstanceId',
    'activePoisonProfileId',
    'pendingSwitchOrNull',
    'reason',
    'createdAt',
  ]);
  data.equal('GM_FORMAL_INITIAL_TAIPAN_MODE', h.kind);
  data.equal(null, h.pendingSwitchOrNull);
  const campaignId = data.uuid(h.campaignId),
    npcUuid = data.uuid(h.npcUuid),
    sourceInstanceId = data.uuid(h.sourceInstanceId),
    modeOperationId = data.uuid(h.modeOperationId),
    effectInstanceId = data.uuid(h.effectInstanceId),
    acquisitionFactId = data.uuid(h.acquisitionFactId),
    activePoisonProfileId = profile(catalog, h.activePoisonProfileId);
  if (
    new Set([
      campaignId,
      npcUuid,
      sourceInstanceId,
      modeOperationId,
      effectInstanceId,
      acquisitionFactId,
    ]).size !== 6
  )
    return fail('distinct actual mode identities required');
  const reason = data.text(h.reason),
    createdAt = data.text(h.createdAt);
  if (
    !reason.trim() ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  )
    return fail('explicit reason and canonical saved audit time required');
  data.record(supplied, [
    'campaignId',
    'npcUuid',
    'campaignTimestampOrNull',
    'origin',
    'originalCompositionProof',
    'previousVersionCompositionProofOrNull',
    'currentCompositionProof',
  ]);
  data.equal(campaignId, data.uuid(supplied.campaignId));
  data.equal(npcUuid, data.uuid(supplied.npcUuid));
  const targetMinute =
      supplied.campaignTimestampOrNull === null ? null : minute(supplied.campaignTimestampOrNull),
    actualOrigin = origin(supplied.origin);
  if (actualOrigin.kind === 'PREPARED')
    data.equal(modeOperationId, actualOrigin.preparationOperationId);
  const choices = npcTaipanInitialModeChoices(catalog, {
    npcUuid,
    compositionProof: supplied.originalCompositionProof,
    previousVersionCompositionProofOrNull: supplied.previousVersionCompositionProofOrNull,
  });
  const choice = choices.find((c) => c.sourceInstanceId === sourceInstanceId);
  if (
    choice === undefined ||
    !choice.profiles.some((p) => p.poisonProfileId === activePoisonProfileId)
  )
    return fail('initial mode requires a genuinely new instance and learned profile');
  data.equal(acquisitionFactId, choice.acquisitionFactId);
  const original = member(
    actual(catalog, supplied.originalCompositionProof, npcUuid),
    sourceInstanceId,
  );
  const current = member(
    actual(catalog, supplied.currentCompositionProof, npcUuid, supplied.originalCompositionProof),
    sourceInstanceId,
  );
  const value: ModeValue = data.freeze({
    campaignId,
    npcUuid,
    campaignTimestampOrNull: targetMinute,
    sourceInstanceId,
    modeOperationId,
    effectInstanceId,
    activePoisonProfileId,
    sourceAbilityId: context(catalog).profiles.get(activePoisonProfileId)!,
    sourceSnapshot: original,
    currentSourceSnapshot: current,
    pendingSwitchOrNull: null,
    origin: actualOrigin,
    history: {
      kind: 'GM_FORMAL_INITIAL_TAIPAN_MODE',
      campaignId,
      npcUuid,
      sourceInstanceId,
      acquisitionFactId,
      modeOperationId,
      effectInstanceId,
      activePoisonProfileId,
      pendingSwitchOrNull: null,
      reason,
      createdAt,
    },
  });
  const token = Object.freeze({}) as NpcTaipanModeContribution;
  modes.set(token, {
    catalog,
    value,
    currentProof: actual(catalog, supplied.currentCompositionProof, npcUuid).proof,
  });
  return token;
}
export function readNpcTaipanModeContribution(
  catalog: NpcPoisonSourceCatalog,
  token: NpcTaipanModeContribution,
): ModeValue {
  context(catalog);
  const issued = modes.get(token);
  return issued?.catalog === catalog
    ? issued.value
    : fail('issued mode for this source catalog required');
}
/** Candidate bytes are checked at their actual saved target, using independent owning history. */
export function validateNpcTaipanModeContribution(
  catalog: NpcPoisonSourceCatalog,
  candidate: unknown,
  history: NpcTaipanModeHistoryAnchor,
  supplied: NpcTaipanModeContext,
): NpcTaipanModeContribution {
  const issued = deriveNpcTaipanModeContribution(catalog, history, supplied);
  data.equal(readNpcTaipanModeContribution(catalog, issued), candidate);
  return issued;
}
export function assertNpcTaipanModeTarget(
  catalog: NpcPoisonSourceCatalog,
  token: NpcTaipanModeContribution,
  target: Readonly<{
    campaignId: string;
    npcUuid: string;
    campaignTimestampOrNull: number | null;
    compositionProof: unknown;
  }>,
): void {
  const value = readNpcTaipanModeContribution(catalog, token);
  data.record(target, ['campaignId', 'npcUuid', 'campaignTimestampOrNull', 'compositionProof']);
  data.equal(value.campaignId, data.uuid(target.campaignId));
  data.equal(value.npcUuid, data.uuid(target.npcUuid));
  data.equal(
    value.campaignTimestampOrNull,
    target.campaignTimestampOrNull === null ? null : minute(target.campaignTimestampOrNull),
  );
  data.equal(modes.get(token)!.currentProof, target.compositionProof);
}
export function deriveNpcPoisonSourceContribution(
  catalog: NpcPoisonSourceCatalog,
  mode: NpcTaipanModeContribution,
  supplied: NpcPoisonSourceContext,
): NpcPoisonSourceContribution {
  const selected = readNpcTaipanModeContribution(catalog, mode);
  const hasCurrentTarget = Object.hasOwn(supplied, 'currentTarget');
  data.record(supplied, [
    'campaignId',
    'npcUuid',
    'campaignTimestamp',
    'origin',
    'targetCommitOperationIdOrNull',
    'observations',
    ...(hasCurrentTarget ? ['currentTarget'] : []),
  ]);
  const campaignId = data.uuid(supplied.campaignId),
    npcUuid = data.uuid(supplied.npcUuid),
    campaignTimestamp = minute(supplied.campaignTimestamp),
    actualOrigin = origin(supplied.origin);
  const targetCommitOperationIdOrNull =
    supplied.targetCommitOperationIdOrNull === null
      ? null
      : data.uuid(supplied.targetCommitOperationIdOrNull);
  data.equal(selected.campaignId, campaignId);
  data.equal(selected.npcUuid, npcUuid);
  const rows = data.array(supplied.observations);
  if (rows.length === 0)
    return fail('actual preparation and complete source observations required');
  let previous: NpcCompositionConsequenceResult | null = null,
    previousMinute: number | null = null;
  let original: NpcOrdinaryCompositionInstance | undefined,
    effective: NpcOrdinaryCompositionInstance | undefined;
  let effectiveOperation: string | undefined,
    unavailableOperation: string | null = null,
    unavailableReason: SourceValue['resolution']['unavailableReasonOrNull'] = null;
  let preparationAllowed = false,
    currentPreparationAllowed = false,
    lastLifeKind: string | undefined;
  let lastConfirmedLife: ReturnType<typeof readNpcFormalLifeBoundary> | null = null;
  const operationIds = new Set<string>();
  for (const [index, value] of rows.entries()) {
    const row = data.record(value, [
      'operationId',
      'kind',
      'campaignTimestamp',
      'compositionProof',
      'life',
    ]);
    const operationId = data.uuid(row.operationId),
      at = minute(row.campaignTimestamp);
    if (operationIds.has(operationId)) return fail('duplicate source observation');
    operationIds.add(operationId);
    if (previousMinute !== null && at < previousMinute) return fail('source clock moved backwards');
    if (at > campaignTimestamp) return fail('future source observation');
    const current = actual(catalog, row.compositionProof, npcUuid, previous?.proof ?? null);
    const lifeInput = data.record(row.life);
    let life: ReturnType<typeof readNpcFormalLifeBoundary> | null;
    if (lifeInput.kind === 'CONFIRMED') {
      data.record(lifeInput, ['kind', 'state']);
      life = readNpcFormalLifeBoundary(lifeInput.state);
    } else if (lifeInput.kind === 'NOT_CONFIRMED_DRAFT' || lifeInput.kind === 'CARRY_PREVIOUS') {
      data.record(lifeInput, ['kind']);
      if ((lifeInput.kind === 'NOT_CONFIRMED_DRAFT') !== (lastLifeKind === undefined))
        return fail('life evidence cannot be invented or reverted to unconfirmed');
      life = null;
    } else return fail('explicit recognized life observation required');
    if (life !== null) {
      data.equal(campaignId, life.context.campaignId);
      data.equal(npcUuid, life.context.npcUuid);
      if (life.context.campaignTimestampOrNull !== null)
        data.equal(at, life.context.campaignTimestampOrNull);
    }
    if ((row.kind === 'LIFE_STATE_SET' || row.kind === 'COMMIT') && life === null)
      return fail('actual life evidence required at SET and COMMIT');
    if (row.kind === 'COMMIT' && current.obligationStatus !== 'RESOLVED')
      return fail('COMMIT requires resolved source composition');
    const lifeKind = life?.state.lifeKind ?? lastLifeKind;
    const source = member(current, selected.sourceInstanceId);
    if (index === 0) {
      data.equal('PREPARATION', row.kind);
      data.equal(modes.get(mode)!.currentProof, current.proof);
      original = source;
      preparationAllowed =
        current.obligationStatus === 'RESOLVED' &&
        source.status === 'ACTIVE' &&
        source.effectsEnabled &&
        source.learnedNodeRefs.includes(selected.sourceAbilityId) &&
        lifeKind !== 'DEAD';
      if (!preparationAllowed)
        return fail('original coating preparation requires actual active learned mode source');
    } else {
      const delta = current.proof.confirmations.length - previous!.proof.confirmations.length;
      const resolutionDelta = current.proof.resolutions.length - previous!.proof.resolutions.length;
      if (row.kind === 'COMPOSITION_CONFIRMATION') {
        if (delta !== 1 || resolutionDelta !== 0)
          return fail('missing or combined composition boundary');
        data.equal(operationId, current.proof.confirmations.at(-1)!.input.factId);
      } else if (row.kind === 'COMPOSITION_RESOLUTION') {
        if (delta !== 0 || resolutionDelta !== 1)
          return fail('missing or combined resolution boundary');
        data.equal(operationId, current.proof.resolutions.at(-1)!.factId);
      } else if (row.kind === 'LIFE_STATE_SET' || row.kind === 'COMMIT') {
        if (delta !== 0 || resolutionDelta !== 0) return fail('unobserved composition transition');
        if (row.kind === 'LIFE_STATE_SET')
          data.equal(operationId, life!.state.anchor.initialStateConfirmationId);
      } else return fail('unknown source observation kind');
      if (lifeKind !== lastLifeKind && row.kind !== 'LIFE_STATE_SET')
        return fail('unobserved life transition');
    }
    const reason =
      lifeKind === 'DEAD'
        ? 'OWNER_DEAD'
        : source.status === 'REMOVED'
          ? 'SOURCE_REMOVED'
          : source.status === 'DESTROYED'
            ? 'SOURCE_DESTROYED'
            : null;
    if (source.status === 'ABSORBED') return fail('unsupported Taipan source absorption');
    if (reason !== null) {
      if (unavailableOperation === null) {
        unavailableOperation = operationId;
        unavailableReason = reason;
      }
    } else {
      // CQA-002 uses current values whenever this same source is actually readable and available.
      effective = source;
      effectiveOperation = operationId;
      unavailableOperation = null;
      unavailableReason = null;
    }
    currentPreparationAllowed =
      current.obligationStatus === 'RESOLVED' &&
      source.status === 'ACTIVE' &&
      source.effectsEnabled &&
      source.learnedNodeRefs.includes(selected.sourceAbilityId) &&
      lifeKind !== 'DEAD' &&
      unavailableOperation === null;
    previous = current;
    previousMinute = at;
    lastLifeKind = lifeKind;
    if (life !== null) lastConfirmedLife = life;
  }
  const finalLife = data.record(data.record(rows.at(-1)).life);
  let targetLifeStateOrNull =
    finalLife.kind === 'CONFIRMED' ? readNpcFormalLifeBoundary(finalLife.state).state : null;
  if (hasCurrentTarget) {
    if (targetCommitOperationIdOrNull !== null)
      return fail('saved target cannot substitute a current read for its actual COMMIT');
    const target = data.record(supplied.currentTarget, [
      'owningOperationId',
      'compositionProof',
      'life',
    ]);
    data.uuid(target.owningOperationId);
    data.equal(previous!.proof, target.compositionProof);
    const targetLife = data.record(target.life);
    if (targetLife.kind === 'NOT_CONFIRMED_DRAFT') {
      data.record(targetLife, ['kind']);
      if (lastConfirmedLife !== null) return fail('current read cannot discard proven life');
      targetLifeStateOrNull = null;
    } else if (targetLife.kind === 'CONFIRMED') {
      data.record(targetLife, ['kind', 'state']);
      if (lastConfirmedLife === null) return fail('current read cannot invent a life SET');
      const currentLife = readNpcFormalLifeBoundary(targetLife.state);
      data.equal(campaignId, currentLife.context.campaignId);
      data.equal(npcUuid, currentLife.context.npcUuid);
      data.equal(campaignTimestamp, currentLife.context.campaignTimestampOrNull);
      data.equal(lastConfirmedLife.state.anchor, currentLife.state.anchor);
      data.equal(lastLifeKind, currentLife.state.lifeKind);
      targetLifeStateOrNull = currentLife.state;
    } else return fail('current read requires actual life evidence or proven unconfirmed draft');
  } else if (previousMinute !== campaignTimestamp) return fail('exact target observation required');
  if (targetCommitOperationIdOrNull !== null) {
    if (actualOrigin.kind !== 'COMMITTED')
      return fail('saved target requires actual committed origin');
    const target = data.record(rows.at(-1));
    data.equal('COMMIT', target.kind);
    data.equal(targetCommitOperationIdOrNull, target.operationId);
    data.equal('CONFIRMED', data.record(target.life).kind);
  }
  if (original === undefined || effective === undefined || effectiveOperation === undefined)
    return fail('no proven last available source');
  if (actualOrigin.kind === 'PREPARED')
    data.equal(actualOrigin.preparationOperationId, data.record(rows[0]).operationId);
  else if (
    !rows.some((r) => {
      const v = data.record(r);
      return v.kind === 'COMMIT' && v.operationId === actualOrigin.originCommitOperationId;
    })
  )
    return fail('actual original COMMIT observation required');
  const value: SourceValue = data.freeze({
    campaignId,
    npcUuid,
    campaignTimestamp,
    sourceInstanceId: selected.sourceInstanceId,
    modeOperationId: selected.modeOperationId,
    preparationOperationId: data.uuid(data.record(rows[0]).operationId),
    originalCampaignTimestamp: minute(data.record(rows[0]).campaignTimestamp),
    activePoisonProfileId: selected.activePoisonProfileId,
    sourceAbilityId: selected.sourceAbilityId,
    sourceSnapshot: original,
    originalSourceSnapshot: original,
    effectiveSourceSnapshot: effective,
    initialPreparationAllowed: preparationAllowed,
    currentPreparationAllowed,
    lifeEvidence: lastLifeKind === undefined ? 'NOT_CONFIRMED_DRAFT' : 'CONFIRMED',
    origin: actualOrigin,
    targetCommitOperationIdOrNull,
    resolution: {
      kind: unavailableOperation === null ? 'CURRENT' : 'FROZEN',
      observationOperationId: effectiveOperation,
      unavailableOperationIdOrNull: unavailableOperation,
      unavailableReasonOrNull: unavailableReason,
    },
  });
  const token = Object.freeze({}) as NpcPoisonSourceContribution;
  sources.set(token, {
    catalog,
    value,
    targetCompositionProof: previous!.proof,
    targetLifeStateOrNull,
  });
  return token;
}
export function readNpcPoisonSourceContribution(
  catalog: NpcPoisonSourceCatalog,
  token: NpcPoisonSourceContribution,
): SourceValue {
  context(catalog);
  const issued = sources.get(token);
  return issued?.catalog === catalog
    ? issued.value
    : fail('issued poison source for this catalog required');
}
/** No current-source blocker catch is part of historical validation. */
export function validateNpcPoisonSourceContribution(
  catalog: NpcPoisonSourceCatalog,
  candidate: unknown,
  mode: NpcTaipanModeContribution,
  supplied: NpcPoisonSourceContext,
): NpcPoisonSourceContribution {
  const issued = deriveNpcPoisonSourceContribution(catalog, mode, supplied);
  data.equal(readNpcPoisonSourceContribution(catalog, issued), candidate);
  return issued;
}
/** Full-sheet closure binds the issued source to this actual target, not merely the same NPC ID. */
export function assertNpcPoisonSourceTarget(
  catalog: NpcPoisonSourceCatalog,
  token: NpcPoisonSourceContribution,
  target: Readonly<{ compositionProof: unknown; lifeStateOrNull: NpcFormalLifeState | null }>,
): void {
  const value = readNpcPoisonSourceContribution(catalog, token),
    issued = sources.get(token)!;
  data.record(target, ['compositionProof', 'lifeStateOrNull']);
  data.equal(issued.targetCompositionProof, target.compositionProof);
  if (target.lifeStateOrNull === null) {
    if (value.lifeEvidence !== 'NOT_CONFIRMED_DRAFT' || issued.targetLifeStateOrNull !== null)
      return fail('actual target life cannot be omitted');
  } else {
    if (issued.targetLifeStateOrNull === null)
      return fail('actual current target life observation required');
    data.equal(
      readNpcFormalLifeBoundary(issued.targetLifeStateOrNull),
      readNpcFormalLifeBoundary(target.lifeStateOrNull),
    );
  }
}

const SOURCE_WITNESSES: readonly string[] = [
  'ADR0087 Taipan mode: для каждого нового экземпляра Тайпана initial activePoisonType задаётся отдельным явным выбором изученного SYM-039/042/045 без default, даже если покрытия не создаются. Это formal initial-state assignment, не сыгранная смена SYM-181 и не вымышленный прошедший час. Retained экземпляр сохраняет независимо доказанный activePoisonType и прежний pending mode/timer/anchor, если он был; OPEN/N+1 не сбрасывают таймер и не делают pending тип активным. Изменение существующего режима остаётся SYM-181; initial authoring не обходит его время. Недоказанный режим не восстанавливается из последнего coating или другого экземпляра.',
  'ADR0087 dose profile: effectFamily=POISON, poisonSourceKind=SYMBIOTIC, actual source instance, learned rule/profile ID и immutable original source snapshot сохраняются отдельно от current/frozen source context. deliveryKind=COATING и carrier/surface типизированы. R20 урона/ослабления/длительности, Z и anatomy будущей цели явно ABSENT, не 0 и не fake rolls. Доза хранит исходную формулу: половина на оружии/снаряде либо полный профиль в пище применяется только при будущем delivery; для SYM-045 половинится длительность, SYM-042 K, SYM-039 periodic damage. До delivery числовой результат не вычисляется, halving не применяется дважды.',
  'ADR0087 current source: N+1 сохраняет original coating ID/source snapshot/appliedAt/consume condition/history. Original snapshot не замораживает силу дозы: CQA-002/Q-SYM-006 требуют текущий L при будущем вычислении ещё не рассчитанной величины, пока источник доступен. При гибели/удалении/нечитаемости источника ещё не вычисленные параметры замораживаются на последнем доказанном доступном значении с настоящими history/event references. Initial preparation не заменяет недоказанный last-available L; другой новый Тайпан не заменяет прежний source. Отключённый, но читаемый источник не считается недоступным. Отделённое покрытие не удаляется автоматически вместе с source; прямое правило способности сильнее. Original snapshot при этом неизменен.',
  'ADR0087 replay: new assignment требует актуального source/его действующего режима и новой операции; sole current authenticated campaign GM, actual campaign/NPC/attempt/version/physical graph и clock повторно проверяются на COMMIT. Exact replay возвращает прежний receipt/IDs, changed/stale/foreign request не пишет ничего; restart не наносит и не расходует дозу. Retained mode/pending timer и coating origins независимо читаются из настоящей истории, candidate references не доказывают себя. Старые snapshots, FINAL, receipts и legacy отсутствие новых полей не переписываются.',
];
