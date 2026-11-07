import {
  createNpcAlcoholEffect,
  validateNpcAlcoholEffect,
  type NpcAlcoholCodecCatalog,
  type NpcAlcoholEffectInstance,
  type NpcAlcoholHistoryAnchor,
} from './alcohol-effects.js';
import {
  createNpcInitialHpModeEffect,
  deriveNpcCombinedHpModes,
  npcHpModeStatProfileForComponent,
  type NpcCombinedHpModeCatalog,
  type NpcCombinedHpModeComponent,
  type NpcHpMode,
  type NpcHpModeEffectInstance,
  type NpcHpModeHistoryAnchor,
  type NpcHpModeSourceEvidence,
  type NpcRegenerationHealingTimer,
} from './combined-hp-modes.js';
import {
  readNpcInitialEffectPreparation,
  type NpcInitialEffectPreparation,
  type NpcInitialEffectPreparationInput,
} from './initial-effect-preparation.js';
import type { NpcInitialTraumaCalendarAnchor } from './initial-trauma.js';
import type { NpcInventoryPublicationContext } from './inventory-publication.js';
import {
  deriveNpcOrdinaryHpModeSource,
  readNpcOrdinaryRuntimeBasis,
} from './npc-ordinary-humanoid-sheet.js';
import type { NpcOrdinaryProofResult } from './ordinary-humanoid-proof.js';
import { npcPublicationData as data } from './inventory-publication.js';
import {
  createNpcFormalControlEffect,
  validateNpcFormalControlEffect,
  type NpcFormalControlCatalog,
  type NpcFormalControlEffectInstance,
  type NpcFormalControlHistoryAnchor,
  type NpcFormalControlKind,
} from './formal-control-effects.js';
import {
  readNpcFormalControlComposition,
  type NpcFormalControlComposition,
} from './formal-control-composition.js';

type Retained<E, H> = Readonly<{
  kind: 'RETAINED';
  originCommitOperationId: string;
  effect: E;
  history: H;
}>;
export interface NpcHumanoidRuntimeEffectPreview {
  readonly npcUuid: string;
  readonly campaignTimestampOrNull: number | null;
  readonly calendarAnchorOrNull: NpcInitialTraumaCalendarAnchor | null;
  readonly preparationBasis: NpcInitialEffectPreparation;
  readonly alcohol: readonly (
    | Retained<NpcAlcoholEffectInstance, NpcAlcoholHistoryAnchor>
    | Readonly<{
        kind: 'PREPARED';
        sourceOperationId: string;
        preparedAt: string;
        effectInstanceId: string;
        reason: string;
      }>
  )[];
  readonly hpModes: readonly (
    | Retained<NpcHpModeEffectInstance, NpcHpModeHistoryAnchor>
    | Readonly<{
        kind: 'PREPARED';
        sourceOperationId: string;
        preparedAt: string;
        effectInstanceId: string;
        mode: NpcHpMode;
        sourceInstanceId: string;
        reason: string;
        remainingMinutes: string;
      }>
  )[];
  readonly hpModeSourceOrNull: NpcHpModeSourceEvidence | null;
  readonly provenHealingTimers: readonly NpcRegenerationHealingTimer[];
  readonly formalControls?: readonly (
    | Retained<NpcFormalControlEffectInstance, NpcFormalControlHistoryAnchor>
    | Readonly<{
        kind: 'PREPARED';
        sourceOperationId: string;
        preparedAt: string;
        effectInstanceId: string;
        controlKind: NpcFormalControlKind;
        remainingMinutes: string;
        reason: string;
      }>
  )[];
}
export interface NpcHumanoidRuntimePreviewState {
  readonly kind: 'UNCOMMITTED_RUNTIME_SELECTION';
  readonly effects: readonly (
    NpcAlcoholEffectInstance | NpcHpModeEffectInstance | NpcFormalControlEffectInstance
  )[];
  readonly hpModesOrNull: NpcCombinedHpModeComponent | null;
}
function fail(detail: string): never {
  throw new Error(`NPC runtime preview: ${detail}`);
}
/** PREPARED projections use real reservation/preparation identities, never a future COMMIT. */
export function deriveNpcHumanoidRuntimePreview(
  catalogs: Readonly<{
    alcohol: NpcAlcoholCodecCatalog;
    hpModes: NpcCombinedHpModeCatalog;
    formalControls?: NpcFormalControlCatalog;
  }>,
  input: Readonly<{
    context: NpcHumanoidRuntimeEffectPreview;
    basisInput: NpcInitialEffectPreparationInput;
    currentHP: unknown;
    ordinaryBasisOrNull: Readonly<{ proof: NpcOrdinaryProofResult; baseMaxHP: number }> | null;
    formalControlCompositionOrNull?: NpcFormalControlComposition | null;
  }>,
  inventoryContext: NpcInventoryPublicationContext | null = null,
): NpcHumanoidRuntimePreviewState {
  const c = input.context;
  data.record(c, [
    'npcUuid',
    'campaignTimestampOrNull',
    'calendarAnchorOrNull',
    'preparationBasis',
    'alcohol',
    'hpModes',
    'hpModeSourceOrNull',
    'provenHealingTimers',
    ...(Object.hasOwn(c, 'formalControls') ? ['formalControls'] : []),
  ]);
  data.equal(input.basisInput.npcUuid, data.uuid(c.npcUuid));
  const minute = c.campaignTimestampOrNull;
  if (typeof minute !== 'number' || !Number.isSafeInteger(minute) || minute < 0)
    return fail('actual current campaign minute required');
  const ids = new Set<string>(),
    operations = new Set<string>();
  const reserve = (id: string, operation: string | null) => {
    data.uuid(id);
    if (ids.has(id)) return fail('duplicate selected effect identity');
    ids.add(id);
    if (operation !== null) {
      data.uuid(operation);
      if (operations.has(operation)) return fail('duplicate preparation operation');
      operations.add(operation);
    }
  };
  const scope = { targetActorId: c.npcUuid, campaignTimestampOrNull: minute, dead: false };
  const prepareAlcohol = () =>
    c.alcohol.map((entry) => {
      if (entry.kind === 'RETAINED') {
        data.record(entry, ['kind', 'originCommitOperationId', 'effect', 'history']);
        data.uuid(entry.originCommitOperationId);
        reserve(entry.effect.effectInstanceId, null);
        return validateNpcAlcoholEffect(catalogs.alcohol, entry.effect, scope, entry.history);
      }
      data.record(entry, ['kind', 'sourceOperationId', 'preparedAt', 'effectInstanceId', 'reason']);
      data.equal('PREPARED', entry.kind);
      reserve(entry.effectInstanceId, entry.sourceOperationId);
      const result = createNpcAlcoholEffect(
        catalogs.alcohol,
        {
          effectInstanceIdOrNull: entry.effectInstanceId,
          createdAtOrNull: entry.preparedAt,
          effectiveZ: basis.effectiveStats.Z,
          reason: entry.reason,
        },
        { ...scope, kind: 'NEW_FORMAL_ASSIGNMENT', poisonResponse: basis.poisonResponse },
      );
      if (result.kind !== 'ACTIVE')
        return fail(
          'prepared alcohol no longer has an active source effect; explicit new confirmation required',
        );
      return result.effect;
    });
  let hpModesOrNull: NpcCombinedHpModeComponent | null = null;
  if (c.hpModes.length === 0) {
    data.equal(null, c.hpModeSourceOrNull);
    data.equal([], c.provenHealingTimers);
  } else {
    if (input.ordinaryBasisOrNull === null) return fail('complete source composition required');
    const ordinary = readNpcOrdinaryRuntimeBasis(input.ordinaryBasisOrNull);
    data.equal(c.npcUuid, ordinary.proof.npcUuid);
    const source = deriveNpcOrdinaryHpModeSource(ordinary.proof);
    data.equal(source, c.hpModeSourceOrNull);
    const histories: NpcHpModeHistoryAnchor[] = [];
    const effects = c.hpModes.map((entry) => {
      if (entry.kind === 'RETAINED') {
        data.record(entry, ['kind', 'originCommitOperationId', 'effect', 'history']);
        data.uuid(entry.originCommitOperationId);
        reserve(entry.effect.effectInstanceId, null);
        histories.push(entry.history);
        return entry.effect;
      }
      data.record(entry, [
        'kind',
        'sourceOperationId',
        'preparedAt',
        'effectInstanceId',
        'mode',
        'sourceInstanceId',
        'reason',
        'remainingMinutes',
      ]);
      data.equal('PREPARED', entry.kind);
      reserve(entry.effectInstanceId, entry.sourceOperationId);
      const calendar = c.calendarAnchorOrNull;
      if (calendar === null) return fail('fresh mode requires actual calendar anchor');
      data.equal(minute, calendar.campaignTimestamp);
      const history: NpcHpModeHistoryAnchor = {
        effectInstanceId: entry.effectInstanceId,
        npcUuid: c.npcUuid,
        sourceInstanceId: entry.sourceInstanceId,
        mode: entry.mode,
        initialStateConfirmationId: entry.sourceOperationId,
        reason: entry.reason,
        createdAt: entry.preparedAt,
        calendarAnchor: calendar,
        remainingMinutes: entry.remainingMinutes,
        revision: 1,
      };
      histories.push(history);
      return createNpcInitialHpModeEffect(catalogs.hpModes, history, source);
    });
    if (typeof input.currentHP !== 'number') return fail('explicit current HP required');
    hpModesOrNull = deriveNpcCombinedHpModes(catalogs.hpModes, {
      baseMaxHP: ordinary.baseMaxHP,
      currentHP: input.currentHP,
      modes: effects,
      histories,
      source,
      campaignTimestamp: minute,
      healingTimers: c.provenHealingTimers,
      provenHealingTimers: c.provenHealingTimers,
    });
  }
  const basis = readNpcInitialEffectPreparation(
    c.preparationBasis,
    input.basisInput,
    hpModesOrNull === null ? null : npcHpModeStatProfileForComponent(hpModesOrNull),
    inventoryContext,
  );
  const alcohol = prepareAlcohol();
  const controls = (c.formalControls ?? []).map((entry) => {
    const catalog = catalogs.formalControls ?? fail('formal control source catalog required');
    const composition = readNpcFormalControlComposition(input.formalControlCompositionOrNull);
    data.equal(c.npcUuid, composition.npcUuid);
    if (composition.poisonControlResponse === 'IMMUNE')
      return fail('current source is immune to the selected decoction control');
    const controlContext = { npcUuid: c.npcUuid, campaignTimestamp: minute, dead: false };
    if (entry.kind === 'RETAINED') {
      data.record(entry, ['kind', 'originCommitOperationId', 'effect', 'history']);
      data.uuid(entry.originCommitOperationId);
      reserve(entry.effect.effectInstanceId, null);
      return validateNpcFormalControlEffect(catalog, entry.effect, entry.history, controlContext);
    }
    data.record(entry, [
      'kind',
      'sourceOperationId',
      'preparedAt',
      'effectInstanceId',
      'controlKind',
      'remainingMinutes',
      'reason',
    ]);
    data.equal('PREPARED', entry.kind);
    reserve(entry.effectInstanceId, entry.sourceOperationId);
    if (c.calendarAnchorOrNull === null)
      return fail('actual calendar anchor required for prepared control');
    return createNpcFormalControlEffect(
      catalog,
      {
        kind: 'GM_FORMAL_INITIAL_CONTROL',
        effectInstanceId: entry.effectInstanceId,
        npcUuid: c.npcUuid,
        controlKind: entry.controlKind,
        initialStateConfirmationId: entry.sourceOperationId,
        reason: entry.reason,
        createdAt: entry.preparedAt,
        calendarAnchor: c.calendarAnchorOrNull,
        remainingMinutes: entry.remainingMinutes,
        revision: 1,
      },
      controlContext,
    );
  });
  if (ids.size === 0) return fail('nonempty prepared/retained selection required');
  return data.freeze({
    kind: 'UNCOMMITTED_RUNTIME_SELECTION',
    effects: [...alcohol, ...(hpModesOrNull?.modes ?? []), ...controls],
    hpModesOrNull,
  });
}
