import { beforeAll, describe, expect, it } from 'vitest';
import { loadNpcAuthoringSourceCatalog, type NpcAuthoringSourceCatalog } from './npc-catalog.js';
import { createNpcDiseasePreparation, npcEditorForItemAttempt } from './npc-item-preparation.js';
import {
  createEmptyNpcEditorDraft,
  applyNpcStageInput,
  readNpcEditorDraft,
  type NpcEditorCatalog,
} from '../domain/rules/npc-authoring/staged-input.js';
import type { NpcAttemptReadContext } from '../persistence/npc-child-identities.js';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import type { DiseaseId } from '@generated/types/effects.js';

let sources: NpcAuthoringSourceCatalog,
  base: NpcEditorCatalog,
  preparation: ReturnType<typeof createNpcDiseasePreparation>;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = (v: unknown) => s.object(JSON.parse(s.canonical(v)) as unknown) as JsonObject;
const context = (): NpcAttemptReadContext => ({
  scope: { campaignId: id(1), ownerDeviceId: id(2), gmLocalContextId: id(3) },
  npcDraftId: id(4),
  candidateNpcUuid: id(5),
  revision: 8,
  operationId: id(6),
  inheritedVersionOrNull: null,
  itemBindings: [],
  pendingItemOrNull: null,
  effectBindings: [],
  pendingEffectOrNull: null,
  symbiontBindings: [],
  pendingSymbiontOrNull: null,
  woundBindings: [],
  pendingWoundOrNull: null,
  traumaBindings: [],
  pendingTraumaOrNull: null,
});
beforeAll(async () => {
  sources = await loadNpcAuthoringSourceCatalog(process.cwd());
  base = { skills: sources.skills, development: sources.development };
  preparation = createNpcDiseasePreparation(base, sources.inventory, sources.diseaseEffects);
});
describe('source-bound disease intent preparation without a runtime effect', () => {
  it('offers distinct actual disease names and never the trace-only disease or generic effect type', () => {
    expect(preparation.choices).toHaveLength(9);
    expect(new Set(preparation.choices.map((c) => c.diseaseId)).size).toBe(9);
    expect(preparation.choices).toContainEqual({
      diseaseId: 'DIS-POISONING',
      nameRu: 'Отравление',
    });
    expect(preparation.choices).toContainEqual({ diseaseId: 'DIS-PNEUMONIA', nameRu: 'Пневмония' });
    expect(preparation.choices.map((c) => c.diseaseId)).not.toContain('DIS-PESTILENCE');
    expect(
      preparation.choices.every((c) => c.nameRu.length > 0 && c.nameRu !== 'EFF-DISEASE-INSTANCE'),
    ).toBe(true);
  });
  it.each([
    'DIS-FEVER',
    'DIS-FLATULENCE',
    'DIS-ITCHY_SKIN_GROWTHS',
    'DIS-MIGRAINE',
    'DIS-PNEUMONIA',
    'DIS-POISONING',
    'DIS-RHINITIS',
    'DIS-SCABIES',
    'DIS-SKIN_GROWTHS',
  ] as const)('reserves supported %s without a clock, payload or auto-selection', (diseaseId) => {
    const values = json(createEmptyNpcEditorDraft()),
      scope = context(),
      before = s.canonical({ values, scope });
    expect(() => preparation.validate(values, diseaseId, scope)).not.toThrow();
    const result = preparation.apply(values, diseaseId, id(7), scope, id(8));
    expect(result).toEqual(values);
    expect(s.canonical({ values, scope })).toBe(before);
    expect(readNpcEditorDraft(base, result).initialState.effectInstanceIds).toEqual({
      kind: 'UNSET',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /startsAt|createdAt|effectTypeId|tickSchedule|targetActorId/,
    );
  });
  it('rejects trace-only PESTILENCE and unknown intent before any assigned identity is used', () => {
    const values = json(createEmptyNpcEditorDraft());
    expect(() => preparation.validate(values, 'DIS-PESTILENCE', context())).toThrow();
    expect(() => preparation.validate(values, 'UNKNOWN' as DiseaseId, context())).toThrow();
  });
  it('does not reuse an item or disease binding identity, and rejects a concurrent pending allocation', () => {
    const values = json(createEmptyNpcEditorDraft()),
      ctx = context();
    const bound = {
      ...ctx,
      effectBindings: [
        {
          effectInstanceId: id(7),
          diseaseId: 'DIS-RHINITIS' as const,
          originOperationId: id(9),
          originDraftId: id(4),
          originEventSha256: 'a'.repeat(64),
        },
      ],
    };
    expect(() => preparation.apply(values, 'DIS-RHINITIS', id(7), bound, id(8))).toThrow();
    const item = {
      ...ctx,
      itemBindings: [
        {
          itemInstanceId: id(7),
          originOperationId: id(9),
          originDraftId: id(4),
          originEventSha256: 'a'.repeat(64),
        },
      ],
    };
    expect(() => preparation.apply(values, 'DIS-RHINITIS', id(7), item, id(8))).toThrow();
    expect(() =>
      preparation.validate(values, 'DIS-RHINITIS', {
        ...ctx,
        pendingEffectOrNull: {
          effectInstanceId: id(7),
          diseaseId: 'DIS-RHINITIS',
          operationId: id(8),
          npcDraftId: id(4),
        },
      }),
    ).toThrow();
  });
  it('permits separate selection only after a checked context exposes the prepared binding', () => {
    const values = createEmptyNpcEditorDraft(),
      ctx = context();
    const input = {
      input: {
        ...values.initialState,
        effectInstanceIds: { kind: 'ENTERED' as const, value: [id(7)] },
      },
      currentOeChanges: [],
    };
    expect(() =>
      applyNpcStageInput(
        npcEditorForItemAttempt(base, sources.inventory, ctx),
        values,
        'NPC-016',
        input,
      ),
    ).toThrow();
    const owned = {
      ...ctx,
      effectBindings: [
        {
          effectInstanceId: id(7),
          diseaseId: 'DIS-RHINITIS' as const,
          originOperationId: id(9),
          originDraftId: id(4),
          originEventSha256: 'a'.repeat(64),
        },
      ],
    };
    const selected = applyNpcStageInput(
      npcEditorForItemAttempt(base, sources.inventory, owned),
      values,
      'NPC-016',
      input,
    );
    expect(selected.initialState.effectInstanceIds).toEqual(input.input.effectInstanceIds);
    expect(selected.initialState.currentHP).toEqual({ kind: 'UNSET' });
  });
});
