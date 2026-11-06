import { deriveNpcBaseStatLayers } from '../../src/domain/rules/npc-authoring/base-stats.js';
import {
  evaluateNpcSkills,
  type NpcSkillProof,
} from '../../src/domain/rules/npc-authoring/skill-evaluation.js';
import { evaluateNpcCompositionConsequences } from '../../src/domain/rules/npc-authoring/composition-consequences.js';
import type {
  NpcCleanHumanoidBuildInput,
  NpcCleanHumanoidComponents,
} from '../../src/domain/rules/npc-authoring/clean-humanoid-sheet.js';
import {
  deriveNpcPureInitialSkills,
  type NpcPureInitialSkillInput,
} from '../../src/domain/rules/npc-authoring/clean-humanoid-sheet.js';

/**
 * Source-backed mechanical fixture. Owning tests must supply their actual identity/fact bindings;
 * these strings neither impersonate a GM nor assert that a durable confirmation occurred.
 */
export function npcCleanHumanoidFixture(
  components: NpcCleanHumanoidComponents,
  binding: Readonly<{
    npcUuid: string;
    owningControllerId: string;
    contextFactId: string;
    compositionJournalId: string;
  }>,
): NpcCleanHumanoidBuildInput {
  const person = {
    name: 'Наблюдатель',
    description: null,
    affiliation: 'Нейтральный',
    campaignRole: 'Свидетель',
    raceCode: 'PURE' as const,
    pureClassOrNull: 'SEEKER' as const,
    sex: 'MALE' as const,
    massKg: 75,
    anatomyProfileId: 'STANDARD_HUMANOID',
    artAssetKeyOrNull: null,
  };
  const baseStats = { S: 10, D: 10, M: 10, C: 10, I: 10, Z: 10, W: 2 };
  const derived = deriveNpcBaseStatLayers(components.baseStats, {
    schema: {
      raceCode: person.raceCode,
      pureClassOrNull: person.pureClassOrNull,
      anatomyProfileId: person.anatomyProfileId,
      sex: person.sex,
      massKg: person.massKg,
    },
    baseStats,
  });
  const skillProof: NpcSkillProof = {
    identityKey: binding.npcUuid,
    contexts: [
      {
        contextFactId: binding.contextFactId,
        ordinal: 1,
        stage: 'START_SELECTION',
        raceCode: person.raceCode,
        classCode: person.pureClassOrNull,
        skillStageStats: derived.skillStageStats,
        permanentStats: derived.skillStageStats,
        effectiveStats: derived.skillStageStats,
        grossGrantSourceOrNull: null,
        facts: [],
      },
    ],
  };
  const skills = evaluateNpcSkills(components.skills, {
    mode: 'CREATE_V1',
    identityKey: binding.npcUuid,
    previousConfirmedProofOrNull: null,
    proof: skillProof,
  });
  const composition = evaluateNpcCompositionConsequences(
    components.compositionConsequences,
    {
      identityKey: binding.npcUuid,
      binding: { journalId: binding.compositionJournalId, raceCode: person.raceCode },
      confirmations: [],
      resolutions: [],
    },
    null,
  );
  return {
    npcUuid: binding.npcUuid,
    owningControllerId: binding.owningControllerId,
    skillProof,
    compositionProof: composition.proof,
    input: {
      identity: person,
      baseStats,
      symbionts: [],
      skills: skills.ledger,
      lifetimeFacts: composition.lifetimeFacts,
      inventory: [],
      initialState: {
        currentHP: 70,
        dead: false,
        currentTraumas: [],
        currentWounds: [],
        effectInstances: [],
        sourceSpecificStates: [],
        deathTimerRollFactOrNull: null,
      },
    },
  };
}

/** Initial selections first become committed at the caller's actual V1 COMMIT, never at navigation. */
export function npcPureInitialSkillFixture(
  components: NpcCleanHumanoidComponents,
  binding: Readonly<{
    npcUuid: string;
    owningControllerId: string;
    contextFactId: string;
    compositionJournalId: string;
    commitOperationId: string;
  }>,
  selection: Readonly<{
    pureClassOrNull: Exclude<NpcPureInitialSkillInput['schema']['pureClassOrNull'], null>;
    baseStats: NpcPureInitialSkillInput['baseStats'];
    selections: NpcPureInitialSkillInput['selections'];
  }>,
): NpcCleanHumanoidBuildInput {
  const initial = npcCleanHumanoidFixture(components, binding);
  const identity = { ...initial.input.identity, pureClassOrNull: selection.pureClassOrNull };
  const skills = deriveNpcPureInitialSkills(
    { baseStats: components.baseStats, skills: components.skills },
    {
      npcUuid: binding.npcUuid,
      commitOperationId: binding.commitOperationId,
      contextFactId: binding.contextFactId,
      schema: {
        raceCode: identity.raceCode,
        pureClassOrNull: identity.pureClassOrNull,
        anatomyProfileId: identity.anatomyProfileId,
        sex: identity.sex,
        massKg: identity.massKg,
      },
      baseStats: selection.baseStats,
      selections: selection.selections,
    },
  );
  return {
    ...initial,
    skillProof: skills.proof,
    input: { ...initial.input, identity, baseStats: selection.baseStats, skills: skills.ledger },
  };
}
