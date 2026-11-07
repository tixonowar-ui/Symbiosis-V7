import {
  evaluateNpcCompositionConsequences,
  type NpcCompositionConsequenceCatalog,
} from './composition-consequences.js';
import { npcPublicationData as data } from './inventory-publication.js';
import {
  assertNpcFormalWeaverContributionSet,
  compareNpcFormalWeaverExactTimes,
  readNpcFormalWeaverEffectContribution,
  type NpcFormalWeaverBranch,
  type NpcFormalWeaverEffectContribution,
} from './formal-weaver-effects.js';

declare const catalogBrand: unique symbol;
declare const proofBrand: unique symbol;
export interface NpcFunctionalDuplicateCatalog {
  readonly [catalogBrand]: true;
}
export interface NpcFunctionalDuplicateProof {
  readonly [proofBrand]: true;
}
export interface NpcFunctionalDuplicateSnapshot {
  readonly npcUuid: string;
  readonly campaignTimestamp: number;
  readonly sources: readonly Readonly<{
    symbiontInstanceId: string;
    sourceRuleId: 'MON-009' | 'SYM-028' | 'SYM-030';
    effectOriginOrNull:
      | null
      | Readonly<{
          kind: 'PREPARED';
          effectInstanceId: string;
          preparationOperationId: string;
          campaignId: string;
          branch: NpcFormalWeaverBranch;
          deadlineExact: string;
        }>
      | Readonly<{
          kind: 'COMMITTED';
          effectInstanceId: string;
          originCommitOperationId: string;
          sourceOperationId: string;
          campaignId: string;
          branch: NpcFormalWeaverBranch;
          deadlineExact: string;
        }>;
  }>[];
}
const catalogs = new WeakMap<NpcFunctionalDuplicateCatalog, NpcCompositionConsequenceCatalog>();
const issued = new WeakMap<NpcFunctionalDuplicateProof, NpcFunctionalDuplicateSnapshot>();
function fail(detail: string): never {
  throw new Error(`NPC functional duplicate: ${detail}`);
}
function rule(value: unknown, id: string) {
  const matches = data
    .array(value)
    .map((entry) => data.record(entry))
    .filter((entry) => entry['Rule ID'] === id);
  if (matches.length !== 1) return fail(`exact source ${id} required`);
  data.equal('Активно', matches[0]!['Статус']);
  return matches[0]!;
}
export function createNpcFunctionalDuplicateCatalog(
  source: Readonly<{
    compositionConsequences: NpcCompositionConsequenceCatalog;
    rules: unknown;
    developmentNodes: unknown;
  }>,
): NpcFunctionalDuplicateCatalog {
  data.record(source, ['compositionConsequences', 'rules', 'developmentNodes']);
  const nodes = data.array(source.developmentNodes).map((entry) => data.record(entry));
  const learned = nodes.filter((entry) => entry.NodeRef === 'MON-008');
  if (learned.length !== 1) return fail('exact CHIMERA MON-008 node required');
  for (const [key, expected] of Object.entries({
    SpeciesKey: 'CHIMERA',
    NodeRef: 'MON-008',
    AbilityID: 'MON-008',
    'Rule IDs': 'MON-008; MON-009',
    AutomationStatus: 'AUTOMATED_ACCEPTED',
    L: 2,
  }))
    data.equal(expected, learned[0]![key]);
  const chimera = rule(source.rules, 'MON-009');
  data.equal('способность изучена.', chimera['Предусловия']);
  data.equal(
    'сохранить дееспособность; увеличить время до смерти в 4 раза.',
    chimera['Итоговый алгоритм'],
  );
  data.equal(
    'иные причины недееспособности продолжают действовать.\nМножитель ×4 синхронизирован с локальным приоритетом CORE-154.',
    chimera['Исключения / приоритет'],
  );
  const duplicate = rule(source.rules, 'CORE-154');
  data.equal('дубль активен при входе.', duplicate['Предусловия']);
  const algorithm = data.text(duplicate['Итоговый алгоритм']);
  if (
    !algorithm.includes('если временный дубль исчез — запретить действия, таймер оставить.') ||
    !algorithm.includes('[Q-CORE-047]') ||
    !algorithm.includes('Эффекты Ткача и Химеры дублируют все жизненно важные органы')
  )
    return fail('CORE-154 complete functional duplicate semantics required');
  const catalog = Object.freeze({}) as NpcFunctionalDuplicateCatalog;
  catalogs.set(catalog, source.compositionConsequences);
  return catalog;
}
/**
 * Complete current composition proves passive MON-009 or its absence. Temporary Weaver
 * effects require a separately issued lifecycle proof; learned nodes alone are not effects.
 */
export function deriveNpcFunctionalDuplicateProof(
  catalog: NpcFunctionalDuplicateCatalog,
  input: Readonly<{
    npcUuid: string;
    campaignTimestamp: number;
    compositionProof: unknown;
    temporaryEffects: readonly NpcFormalWeaverEffectContribution[];
    campaignId?: string;
  }>,
): NpcFunctionalDuplicateProof {
  const source = catalogs.get(catalog) ?? fail('issued source catalog required');
  data.record(input, [
    'npcUuid',
    'campaignTimestamp',
    'compositionProof',
    'temporaryEffects',
    ...(Object.hasOwn(input, 'campaignId') ? ['campaignId'] : []),
  ]);
  const npcUuid = data.uuid(input.npcUuid),
    now = input.campaignTimestamp;
  if (typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0)
    return fail('confirmed exact virtual minute required');
  data.array(input.temporaryEffects);
  assertNpcFormalWeaverContributionSet(input.temporaryEffects);
  const actual = evaluateNpcCompositionConsequences(source, input.compositionProof, null);
  data.equal(npcUuid, actual.proof.identityKey);
  if (actual.obligationStatus !== 'RESOLVED') return fail('complete actual composition required');
  const sources: NpcFunctionalDuplicateSnapshot['sources'][number][] = actual.composition.instances
    .filter(
      (member) =>
        member.speciesKey === 'CHIMERA' &&
        member.effectsEnabled &&
        member.learnedNodeRefs.includes('MON-008'),
    )
    .map((member) => ({
      symbiontInstanceId: member.symbiontInstanceId,
      sourceRuleId: 'MON-009',
      effectOriginOrNull: null,
    }));
  for (const effect of input.temporaryEffects) {
    const checked = readNpcFormalWeaverEffectContribution(effect);
    data.equal(npcUuid, checked.context.npcUuid);
    data.equal(now, checked.context.campaignTimestamp);
    data.equal(data.uuid(input.campaignId), checked.context.campaignId);
    data.equal(input.compositionProof, checked.context.currentCompositionProof);
    const common = {
      effectInstanceId: checked.history.effectInstanceId,
      campaignId: checked.history.campaignId,
      branch: checked.history.branch,
      deadlineExact: checked.effect.expiresAt.campaignTimestampExact,
    };
    sources.push({
      symbiontInstanceId: checked.history.sourceInstanceId,
      sourceRuleId:
        checked.history.branch === 'DUPLICATED_ORGANS_PROTECTION' ? 'SYM-030' : 'SYM-028',
      effectOriginOrNull:
        checked.context.origin.kind === 'PREPARED'
          ? {
              ...common,
              kind: 'PREPARED',
              preparationOperationId: checked.context.origin.preparationOperationId,
            }
          : {
              ...common,
              kind: 'COMMITTED',
              originCommitOperationId: checked.context.origin.originCommitOperationId,
              sourceOperationId: checked.history.sourceOperationId,
            },
    });
  }
  const proof = Object.freeze({}) as NpcFunctionalDuplicateProof;
  issued.set(proof, data.freeze({ npcUuid, campaignTimestamp: now, sources }));
  return proof;
}
export function readNpcFunctionalDuplicateProof(proof: unknown): NpcFunctionalDuplicateSnapshot {
  if (proof === null || typeof proof !== 'object')
    return fail('issued actual duplicate proof required');
  return (
    issued.get(proof as NpcFunctionalDuplicateProof) ??
    fail('issued actual duplicate proof required')
  );
}
/** ADR0086 rejects an incompatible death deadline; it never extends a retained timer. */
export function readNpcFunctionalDuplicateRequiredDeathDeadline(proof: unknown): string | null {
  let required: string | null = null;
  for (const source of readNpcFunctionalDuplicateProof(proof).sources) {
    const origin = source.effectOriginOrNull;
    if (origin === null || origin.branch !== 'REPLACEMENT_RECOVERY') continue;
    if (required === null || compareNpcFormalWeaverExactTimes(origin.deadlineExact, required) > 0)
      required = origin.deadlineExact;
  }
  return required;
}
/** Passive snapshots predate this field; each temporary origin carries its actual campaign. */
export function assertNpcFunctionalDuplicateCampaign(proof: unknown, campaignId: string): void {
  const campaign = data.uuid(campaignId);
  for (const source of readNpcFunctionalDuplicateProof(proof).sources)
    if (source.effectOriginOrNull !== null)
      data.equal(campaign, source.effectOriginOrNull.campaignId);
}
