import {
  networkGmRequestProjectionValue,
  networkGmRequestDraftValues,
  networkGmRequestDecisionReceiptValue,
} from '@shared/network-application-codec.js';
import type {
  Net017Projection,
  NetworkGmRequestDraftValues,
  NetworkGmRequestDraftReplaceV3Message,
  NetworkGmRequestDraftRefusal,
  NetworkGmRequestDecisionReceipt,
  NetworkGmAcceptToReviewPayload,
  NetworkGmRejectRequestPayload,
} from '@shared/network-application.js';
import { CAMPAIGN_ADMISSION_FORM_IDS } from '@shared/campaign-admission-review.js';
import {
  admissionBrowserCommand,
  admissionBrowserReceipt,
  admissionBrowserDraft,
  admissionDraftDestinationMatches,
  admissionOwnerActions,
  isAdmissionWorkflow,
  type AdmissionBrowserRequest,
  type AdmissionBrowserEdit,
  admissionOwnerBrowserCommand,
  admissionOwnerBrowserReceipt,
  admissionOwnerMonotonic,
  admissionOwnerDecisionDestination,
} from './forms/net/admission-client.js';
import type { AdmissionGmClientV3Message } from '@shared/campaign-admission-review.js';
import {
  ADMISSION_GM_WORKFLOW_IDS,
  ADMISSION_GM_NAV_TARGETS,
  admissionGmPresentationValue,
  admissionGmProjectionValue,
  isAdmissionGmForm,
  isAdmissionOwnerForm,
  admissionOwnerProjectionValue,
  type AdmissionOwnerCommand,
} from '@shared/campaign-admission-presentation.js';
import {
  networkGmRequestDraftFromProjection,
  networkGmAcceptToReviewPayload,
  networkGmRejectRequestPayload,
  type NetworkGmRequestEditState,
} from './forms/net/network-application.js';
import {
  CAMPAIGN_CREATE_ACTION_KEY,
  GM_CONTEXT_STORAGE_KEY,
  campaignCreateDestinationMatches,
  campaignDraftResultMatches,
  campaignEditFromProjection,
  campaignEditIsSendable,
  decodeCampaignCreateReceipt,
  decodeCampaignProjection,
  expectedCampaignActions,
  isCampaignCreationForm,
  isCampaignEditableForm,
  sameCampaignRevisions,
  type CampaignEdit,
} from './forms/cmp/campaign-create.js';
import type { CampaignDraftClientState } from './forms/cmp/campaign-create-fields.js';
import {
  NETWORK_APPLICATION_FORM_IDS,
  type NetworkCommandResult,
  type NetworkWorkflowRequest,
  type NetworkDraftRefusal,
} from '@shared/network-application.js';
import {
  NETWORK_WORKFLOW_COMMAND_IDS,
  NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS,
  NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
} from '@shared/device-admission.js';
import type {
  NetworkDraftReplaceV3Message,
  NetworkLocalContextResumeV3Message,
} from '@shared/device-admission.js';
import type { NetworkDraftClientState } from './forms/net/network-fields.js';
import {
  NETWORK_CONTEXT_STORAGE_KEY,
  decodeNetworkProjection,
  expectedNetworkActions,
  isNetworkApplicationForm,
  isNetworkEditableForm,
  networkDraftResultMatches,
  networkEditFromProjection,
  networkEditIsSendable,
  networkOpenPayload,
  networkSubmitPayload,
  networkCancelPayload,
  decodeNetworkCommandReceipt,
  networkCommandDestinationMatches,
  sameNetworkRevisions,
  type NetworkEdit,
} from './forms/net/network-application.js';
import {
  CAMPAIGN_CREATE_COMMAND_ID,
  type CampaignCreateRequest,
  type CampaignCreateResult,
  type CampaignDraftReplaceV3Message,
  type CampaignDraftRefusal,
  type CampaignLocalContextResumeV3Message,
} from '@shared/campaign-creation.js';
import {
  decodePostSaveProjection,
  expectedPostSaveActions,
  isPostSaveForm,
  LIBRARY_ROUTES,
  POST_SAVE_ACTIONS,
  postSavePayload,
  decodePostSaveTerminal,
  postSaveDestinationMatches,
  postSaveReceiptUnchanged,
} from './forms/chr/post-save.js';
import {
  POST_SAVE_COMMAND_IDS,
  type PostSaveProjection,
  type PostSaveMetadata,
  type PostSavePayload,
  type PostSaveRequest,
  type PostSaveDraftRequest,
  type PostSaveCommandResult,
} from '@shared/local-character-post-save.js';
import {
  decodeCreationCorrectionProjection,
  expectedCreationCorrectionActionKeys,
  creationCorrectionPayload,
  CORRECTION_COMMANDS,
  type CreationCorrectionProjection,
  type CreationCorrectionVariant,
} from './forms/chr/creation-correction.js';
import {
  decodeChr032Projection,
  decodeChr025Projection,
  expectedChr032ActionKeys,
  expectedChr025ActionKeys,
  creationPropertySummaryPayload,
  creationFinalSavePayload,
  CREATION_FINAL_SAVE_TRANSITION,
  decodeCreationFinalizationTerminal,
  creationFinalizationSnapshotMatchesReceipt,
  type Chr032Projection,
  type Chr025Projection,
  type CreationFinalizationRequest,
} from './forms/chr/creation-validation.js';
import {
  CHR_037_CONFIRM_ACTION_KEY,
  CHR_037_RETURN_ACTION_KEY,
  CHR_037_ROLL_ACTION_KEY,
  decodeChr037Projection,
  expectedChr037ActionKeys,
  decodeFiveStartingPositionsTerminal,
  fiveStartingPositionsRollPayload,
  fiveStartingPositionsCheckpointPayload,
  type Chr037Projection,
  type FiveStartingPositionSelection,
  type FiveStartingPositionsRequest,
} from './forms/chr/five-starting-positions.js';
import {
  decodeChr038Projection,
  expectedChr038ActionKeys,
  decodeStartingMoneyTerminal,
  startingMoneyRollPayload,
  startingMoneyCheckpointPayload,
  CHR_038_ROLL_ACTION_KEY,
  CHR_038_CONFIRM_ACTION_KEY,
  CHR_038_RETURN_ACTION_KEY,
  type Chr038Projection,
  type StartingMoneyRequest,
} from './forms/chr/starting-money.js';
import { FORM_IDS } from '@generated/types/atlas.js';
import type { ActionKey, FormId } from '@generated/types/atlas.js';
import {
  decodeHostMessage,
  decodeHostMessageV2,
  decodeHostMessageV3,
  encodeClientMessage,
  encodeClientMessageV2,
  encodeClientMessageV3,
  WIRE_PROTOCOL_VERSION,
  WIRE_PROTOCOL_V2_VERSION,
  WIRE_PROTOCOL_V3_VERSION,
} from '@shared/index.js';
import { calculateSkillSlotCost } from '../domain/rules/skill-stage/skills.js';
import type {
  AddressableRouteIntentV2Message,
  AddressableRouteRefusalV2Message,
  AddressableRouteTemplate,
  CommandReceipt,
  CommandRefusalMessage,
  DecodeRefusal,
  DecodeResult,
  FormActionIntentV2Message,
  FormActionRefusalV2Message,
  HostToClientMessage,
  IdentityDraftValues,
  JsonObject,
  JsonValue,
  ProjectionSnapshotV2Message,
  ProtocolRefusalMessage,
  ProtocolVocabulary,
  RevisionVector,
  SessionReconnectCapabilitiesV2Message,
  SessionReconnectV2Message,
  WireV3Vocabulary,
  WorkflowCommandRequestMessage,
  WorkflowCommandId,
} from '@shared/index.js';

import { isImplementedFormActionKey, presentedFormDefinition } from './forms/index.js';
import { getAtlasFormModel } from './renderer/atlas-data.js';
import type { SupportedPresentationFormId } from './forms/index.js';
import {
  advisorCheckpointPayload,
  advisorCheckpointSnapshotMatchesReceipt,
  advisorIntelligenceFloorRollPayload,
  advisorIntelligenceFloorSnapshotMatchesReceipt,
  advisorSkillSelectionDraftFromSnapshot,
  CHR_020_MONSTER_DRAFT_ACTION_KEY,
  CHR_020_ROLL_COMMIT_ACTION_KEY,
  CHR_020_SIDE_DRAFT_ACTION_KEY,
  CHR_041_CHECKPOINT_ACTION_KEY,
  CHR_041_INTELLIGENCE_FLOOR_ACTION_KEY,
  CHR_041_SKILL_DRAFT_ACTION_KEY,
  cycleRandomMonster,
  decodeAdvisorIntelligenceFloorRollTerminal,
  decodeChr017Projection,
  decodeChr019Projection,
  decodeChr020Projection,
  decodeChr041Projection,
  decodeSymbiontAdvisorCheckpointTerminal,
  decodeSymbiontRollCommitTerminal,
  exactSymbiontActionKeys,
  expectedChr017ActionKeys,
  expectedChr020ActionKeys,
  expectedChr041ActionKeys,
  isAdvisorSkillSlots,
  isSpeciesKey,
  randomRollCommitPayload,
  randomSymbiontDraftFromSnapshot,
  replaceAdvisorSkillCandidate,
  replaceRandomManualFace,
  replaceRandomSideSpecies,
  symbiontRollSnapshotMatchesReceipt,
  toggleAdvisorSkillSelection,
  toggleRandomSide,
} from './forms/chr/random-symbionts.js';
import type {
  AdvisorIntelligenceFloorRollPayload,
  AdvisorIntelligenceFloorRollRequest,
  AdvisorIntelligenceFloorRollResult,
  AdvisorSkillSelectionDraft,
  Chr017Projection,
  Chr019Projection,
  Chr020Projection,
  Chr041Projection,
  RandomSymbiontDraft,
  SymbiontAdvisorCheckpointRequest,
  SymbiontAdvisorCheckpointResult,
  SymbiontRollCommitPayload,
  SymbiontRollCommitRequest,
  SymbiontRollCommitResult,
  SymbiontSide,
  SymbiontSpeciesKey,
  SymbioticMonsterSpeciesKey,
} from './forms/chr/random-symbionts.js';
import {
  CHR_017_MANUAL_CARD_ACTION_KEY,
  CHR_018_MANUAL_ADD_ACTION_KEY,
  CHR_018_MANUAL_BINDING_ACTION_KEY,
  CHR_041_MANUAL_IW_ACTION_KEY,
  CHR_042_MANUAL_CONFIRM_ACTION_KEY,
  decodeChr017ManualProjection,
  decodeChr018Projection,
  decodeChr019ManualProjection,
  decodeChr042Projection,
  decodeManualAdvisorIwTerminal,
  decodeManualAdvisorSkillTerminal,
  decodeManualCompositionTerminal,
  decodeManualInteractionConfirmationTerminal,
  expectedChr017ManualActionKeys,
  expectedChr018ActionKeys,
  expectedChr019ManualActionKeys,
  isManualChr017Projection,
  manualAdvisorIwPayload,
  manualAdvisorIwSnapshotMatchesReceipt,
  manualAdvisorSkillPayload,
  manualAdvisorSkillSnapshotMatchesReceipt,
  manualCompositionDraftFromSnapshot,
  manualCompositionPayload,
  manualCompositionSnapshotMatchesReceipt,
  manualInteractionConfirmationPayload,
  replaceManualBindingSide,
  toggleManualCompositionSpecies,
} from './forms/chr/manual-symbionts.js';
import type {
  Chr018Projection,
  Chr042Projection,
  ManualAdvisorIwRequest,
  ManualAdvisorIwResult,
  ManualAdvisorSkillRequest,
  ManualAdvisorSkillResult,
  ManualCompositionDraft,
  ManualCompositionRequest,
  ManualCompositionResult,
  ManualInteractionConfirmationRequest,
  ManualInteractionConfirmationResult,
  ManualChr017Projection,
  ManualChr019Projection,
} from './forms/chr/manual-symbionts.js';
import {
  addArmorPiece,
  armorBundleCheckpointPayload,
  armorBundleDraftFromSnapshot,
  armorBundleQualityPayload,
  CHR_019_ARMOR_ENTRY_ACTION_KEY,
  CHR_021_CONFIRM_ACTION_KEY,
  CHR_021_ROLL_ACTION_KEY,
  decodeArmorBundleCheckpointTerminal,
  decodeArmorBundleQualityTerminal,
  decodeChr021Projection,
  expectedChr019EntryActionKeys,
  expectedChr021ActionKeys,
  removeArmorPiece,
} from './forms/chr/armor-bundle.js';
import {
  CHR_022_ROLL_ACTION_KEY,
  CHR_022_CONFIRM_ACTION_KEY,
  CHR_022_PURE_CONFIRM_ACTION_KEY,
  decodeChr022Projection,
  expectedChr022ActionKeys,
  decodeStartingWeaponTerminal,
  selectStartingWeapon,
  startingWeaponDraftFromSnapshot,
  startingWeaponQualityPayload,
  startingWeaponCheckpointPayload,
  startingWeaponEntryPayload,
} from './forms/chr/starting-weapon.js';
import {
  CHR_023_SUBMIT_ACTION_KEY,
  CHR_024_ACKNOWLEDGE_ACTION_KEY,
  CHR_031_RETURN_ACTION_KEY,
  WEAPON_PROFILE_SUBMIT_WORKFLOW,
  decodeChr023Projection,
  decodeChr024Projection,
  decodeChr031Projection,
  decodeWeaponProfileTerminal,
  expectedChr023ActionKeys,
  expectedChr024ActionKeys,
  weaponProfileAcknowledgePayload,
  weaponProfileEntryPayload,
  weaponProfileSubmitPayload,
  type Chr023Projection,
  type Chr024Projection,
  type Chr031Projection,
  type WeaponProfileInputs,
  type WeaponProfileRequest,
} from './forms/chr/weapon-profile.js';
import type {
  Chr022Projection,
  StartingWeaponDraft,
  StartingWeaponQualityRequest,
  StartingWeaponCheckpointRequest,
  StartingWeaponEntryRequest,
  StartingWeaponSnapshotSource,
} from './forms/chr/starting-weapon.js';
import type {
  ArmorBundleCheckpointRequest,
  ArmorBundleDraft,
  ArmorBundleQualityRollRequest,
  ArmorBundleSnapshotSource,
  Chr021Projection,
} from './forms/chr/armor-bundle.js';
import {
  IdentityDraftClient,
  type IdentityDraftClientState,
  type IdentityDraftSnapshot,
} from './identity-draft-client.js';

export type { IdentityDraftClientState, IdentityDraftValues };
export type {
  AdvisorSkillSelectionDraft,
  Chr017Projection,
  Chr018Projection,
  Chr019Projection,
  Chr020Projection,
  Chr041Projection,
  Chr042Projection,
  ManualCompositionDraft,
  RandomSymbiontDraft,
  SymbiontSide,
  SymbioticMonsterSpeciesKey,
};

const FORM_ID_SET: ReadonlySet<string> = new Set(FORM_IDS);

const INHERITED_CHARACTER_WIZARD_FORM_IDS: ReadonlySet<FormId> = new Set([
  'CHR-002',
  'CHR-003',
  'CHR-004',
  'CHR-005',
  'CHR-006',
  'CHR-007',
  'CHR-008',
  'CHR-009',
  'CHR-011',
  'CHR-012',
  'CHR-013',
  'CHR-015',
  'CHR-017',
  'CHR-018',
  'CHR-019',
  'CHR-020',
  'CHR-041',
  'CHR-042',
  'CHR-021',
  'CHR-022',
  'CHR-023',
  'CHR-024',
  'CHR-038',
  'CHR-037',
  'CHR-032',
  'CHR-025',
  'CHR-026',
  'CHR-039',
  'CHR-040',
  'CHR-010',
  'CHR-016',
  'CHR-036',
]);

const CHR_014_ROUTE =
  '/player/characters/:localCharacterId/create/chr-014/:skillId' as AddressableRouteTemplate;
const CHR_018_ROUTE =
  '/player/characters/:localCharacterId/create/chr-018/:speciesKey' as AddressableRouteTemplate;

export const WEB_PROTOCOL_VOCABULARY: ProtocolVocabulary & WireV3Vocabulary = {
  isAddressableRouteTemplate: (value): value is AddressableRouteTemplate =>
    value === CHR_014_ROUTE ||
    value === CHR_018_ROUTE ||
    (Object.values(LIBRARY_ROUTES) as readonly string[]).includes(value),
  isClientRouteBindings: (routeTemplate, bindings) =>
    (Object.values(LIBRARY_ROUTES) as readonly string[]).includes(routeTemplate)
      ? bindings.length === 1 &&
        bindings[0]?.parameterIndex === 0 &&
        bindings[0].source === 'client-selected' &&
        UUID_PATTERN.test(bindings[0].value)
      : (routeTemplate === CHR_014_ROUTE || routeTemplate === CHR_018_ROUTE) &&
        bindings.length === 1 &&
        bindings[0]?.parameterIndex === 1 &&
        bindings[0].source === 'client-selected' &&
        (routeTemplate === CHR_014_ROUTE
          ? isPublicSkillId(bindings[0].value)
          : isSpeciesKey(bindings[0].value)),
  isFormActionKey: isImplementedFormActionKey,
  isFormId: (value): value is FormId => FORM_ID_SET.has(value),
  isHostTransition: (value) =>
    value.from === CREATION_FINAL_SAVE_TRANSITION.from &&
    value.to === CREATION_FINAL_SAVE_TRANSITION.to &&
    value.kind === CREATION_FINAL_SAVE_TRANSITION.kind &&
    value.trigger === CREATION_FINAL_SAVE_TRANSITION.trigger &&
    getAtlasFormModel('CHR-025').actions.items.some(
      ({ transition }) =>
        transition !== null &&
        transition.from === value.from &&
        transition.to === value.to &&
        transition.kind === value.kind &&
        transition.trigger === value.trigger,
    ),
  isPresentedForm: (formId, formType, routeTemplate, bindings) => {
    const definition = presentedFormDefinition(formId);
    if (definition === null || formType !== definition.type || routeTemplate !== definition.route)
      return false;
    if ((CAMPAIGN_ADMISSION_FORM_IDS as readonly string[]).includes(formId)) {
      if (formType === 'dialog') return bindings.length === 0;
      const binding = bindings[0];
      return (
        bindings.length === 1 &&
        binding?.parameterIndex === 0 &&
        binding.source === 'inherited' &&
        DEVICE_ID_PATTERN.test(binding.value)
      );
    }
    if (formId === 'NET-017')
      return (
        bindings.length === 1 &&
        bindings[0]?.parameterIndex === 0 &&
        bindings[0].source === 'inherited' &&
        UUID_PATTERN.test(bindings[0].value)
      );
    if ((NETWORK_APPLICATION_FORM_IDS as readonly string[]).includes(formId)) {
      const binding = bindings[0];
      if (bindings.length !== 1 || binding?.parameterIndex !== 0 || binding.source !== 'inherited')
        return false;
      if (formId === 'CHR-027') return binding.value.length > 0;
      return (
        DEVICE_ID_PATTERN.test(binding.value) ||
        (['NET-001', 'NET-002', 'NET-011'].includes(formId) &&
          binding.value.startsWith('unbound:') &&
          DEVICE_ID_PATTERN.test(binding.value.slice(8)))
      );
    }
    if (formId === 'CHR-014' || formId === 'CHR-018') {
      const character = bindings[0];
      const selected = bindings[1];
      return (
        bindings.length === 2 &&
        character?.parameterIndex === 0 &&
        character.source === 'inherited' &&
        UUID_PATTERN.test(character.value) &&
        selected?.parameterIndex === 1 &&
        selected.source === 'client-selected' &&
        (formId === 'CHR-014' ? isPublicSkillId(selected.value) : isSpeciesKey(selected.value))
      );
    }
    if (isCampaignCreationForm(formId) && formId !== 'APP-011') {
      const binding = bindings[0];
      return (
        bindings.length === 1 &&
        binding?.parameterIndex === 0 &&
        binding.source === 'inherited' &&
        (formId === 'CMP-006'
          ? UUID_PATTERN.test(binding.value)
          : binding.value.startsWith('draft:') && UUID_PATTERN.test(binding.value.slice(6)))
      );
    }
    if (formId !== 'CHR-001' && !INHERITED_CHARACTER_WIZARD_FORM_IDS.has(formId)) {
      return bindings.length === 0;
    }
    const binding = bindings[0];
    return (
      bindings.length === 1 &&
      binding !== undefined &&
      binding.parameterIndex === 0 &&
      binding.source === (formId === 'CHR-001' ? 'executor-allocated' : 'inherited') &&
      UUID_PATTERN.test(binding.value)
    );
  },
  isWorkflowCommandId: (value): value is WorkflowCommandId =>
    value === 'UI-CMD-ADMISSION-PLAYER-DECIDE' ||
    (NETWORK_WORKFLOW_COMMAND_IDS as readonly string[]).includes(value) ||
    (NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS as readonly string[]).includes(value) ||
    (ADMISSION_GM_WORKFLOW_IDS as readonly string[]).includes(value) ||
    value === CAMPAIGN_CREATE_COMMAND_ID ||
    value === IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID ||
    value === SET_DECIDE_WORKFLOW_COMMAND_ID ||
    value === ROLL_COMMIT_WORKFLOW_COMMAND_ID ||
    value === WEAPON_PROFILE_SUBMIT_WORKFLOW ||
    (Object.values(POST_SAVE_COMMAND_IDS) as readonly string[]).includes(value),
};

const NO_KNOWN_REVISIONS = {
  actorVisibilityRevision: 0,
  projectionRevision: 0,
  stateRevision: 0,
} as const satisfies RevisionVector;
const DEVICE_ID_KEYS = new Set(['deviceId']);
const DEVICE_ID_ERROR_KEYS = new Set(['error']);
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-WIZARD-CHECKPOINT' as const;
const SET_DECIDE_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-CREATION-SET-DECIDE' as const;
const ROLL_COMMIT_WORKFLOW_COMMAND_ID = 'UI-CMD-CHAR-CREATION-ROLL-COMMIT' as const;
const IDENTITY_CHECKPOINT_ACTION_KEY = 'CHR-001::CTA::001' as const;
const CHR_010_INITIAL_ACTION_KEYS = [
  'CHR-010::CTA::004',
  'CHR-010::CTA::005',
  'CHR-010::CTA::006',
] as const satisfies readonly ActionKey[];
const CHR_016_INITIAL_ACTION_KEYS = [
  'CHR-016::CTA::003',
  'CHR-016::CTA::004',
] as const satisfies readonly ActionKey[];
const CHR_036_INITIAL_ACTION_KEYS = [
  'CHR-036::CTA::004',
  'CHR-036::CTA::005',
] as const satisfies readonly ActionKey[];
const CHR_002_INITIAL_ACTION_KEYS = [
  'CHR-002::CTA::003',
  'CHR-002::CTA::004',
  'CHR-002::CTA::005',
] as const satisfies readonly ActionKey[];
const CHR_003_ROLL_COMMIT_ACTION_KEY = 'CHR-003::CTA::002' as const;
const CHR_004_ROLL_COMMIT_ACTION_KEY = 'CHR-004::CTA::001' as const;
const CHR_003_PENDING_ACTION_KEYS = [
  CHR_003_ROLL_COMMIT_ACTION_KEY,
] as const satisfies readonly ActionKey[];
const CHR_004_PENDING_ACTION_KEYS = [
  CHR_004_ROLL_COMMIT_ACTION_KEY,
] as const satisfies readonly ActionKey[];
const CREATION_SET_DECISION_FORM_IDS = ['CHR-005', 'CHR-006', 'CHR-007', 'CHR-008'] as const;
type CreationSetDecisionFormId = (typeof CREATION_SET_DECISION_FORM_IDS)[number];
const CREATION_SET_DECISION_FORM_ID_SET: ReadonlySet<string> = new Set(
  CREATION_SET_DECISION_FORM_IDS,
);
const CHR_028_ACTION_KEYS = [
  'CHR-028::CTA::001',
  'CHR-028::CTA::002',
] as const satisfies readonly ActionKey[];
const STAT_CODES = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'] as const;
const PURE_CLASSES = ['SEEKER', 'STALKER', 'SOLDIER'] as const satisfies readonly PureClass[];
const CHR_011_SELECTOR_ACTION_KEYS = [
  'CHR-011::CTA::003',
  'CHR-011::CTA::004',
  'CHR-011::CTA::005',
] as const satisfies readonly ActionKey[];
const CHR_013_CARD_ACTION_KEY = 'CHR-013::CTA::001' as const;
const CHR_013_ACTION_KEYS = [
  CHR_013_CARD_ACTION_KEY,
  'CHR-013::CTA::002',
] as const satisfies readonly ActionKey[];
const CHR_014_ADD_ACTION_KEY = 'CHR-014::CTA::001' as const;
const CHR_014_RETURN_ACTION_KEY = 'CHR-014::CTA::002' as const;
const CHR_014_ACTION_KEYS = [
  CHR_014_ADD_ACTION_KEY,
  CHR_014_RETURN_ACTION_KEY,
] as const satisfies readonly ActionKey[];
const CHR_014_READ_ONLY_ACTION_KEYS = [
  CHR_014_RETURN_ACTION_KEY,
] as const satisfies readonly ActionKey[];
const CHR_015_INITIAL_ACTION_KEYS = ['CHR-015::CTA::003'] as const satisfies readonly ActionKey[];
const CHR_015_MUTABLE_ACTION_KEYS = [
  'CHR-015::CTA::003',
  'CHR-015::CTA::002',
] as const satisfies readonly ActionKey[];
const CHR_015_CONFIRM_ACTION_KEY = 'CHR-015::CTA::001' as const;
const CHR_015_TOGGLE_ACTION_KEY = 'CHR-015::CTA::003' as const;
const PURE_CLASS_BY_SELECTOR = new Map<ActionKey, PureClass>([
  ['CHR-011::CTA::003', 'SEEKER'],
  ['CHR-011::CTA::004', 'STALKER'],
  ['CHR-011::CTA::005', 'SOLDIER'],
]);
/** ADR 0043 section 2 and Atlas CTA keys; validation only, never host mechanics authority. */
const CREATION_SET_DECISION_FORMS = {
  'CHR-005': {
    acceptActionKey: 'CHR-005::CTA::001',
    alternateActionKey: 'CHR-005::CTA::002',
    alternateDecision: 'USE_POINT_BUY_90',
    attempt: 1,
    method: 'CLASSIC',
    receiptKey: 'acceptedSetReceiptId',
    transitionKind: 'CLASSIC_TO_90',
  },
  'CHR-006': {
    acceptActionKey: 'CHR-006::CTA::001',
    alternateActionKey: 'CHR-006::CTA::002',
    alternateDecision: 'GO_ATTEMPT_2',
    attempt: 1,
    method: 'ADVENTUROUS',
    receiptKey: 'setReceiptId',
    transitionKind: 'ADVENTUROUS_TO_SECOND',
  },
  'CHR-007': {
    acceptActionKey: 'CHR-007::CTA::001',
    alternateActionKey: 'CHR-007::CTA::002',
    alternateDecision: 'USE_POINT_BUY_85',
    attempt: 2,
    method: 'ADVENTUROUS',
    receiptKey: 'setReceiptId',
    transitionKind: 'ADVENTUROUS_TO_85',
  },
  'CHR-008': {
    acceptActionKey: 'CHR-008::CTA::001',
    alternateActionKey: 'CHR-008::CTA::002',
    alternateDecision: 'GO_NEXT_ATTEMPT',
    attempt: null,
    method: 'ALL_OR_NOTHING',
    receiptKey: 'setReceiptId',
    transitionKind: 'ALL_OR_NOTHING_NEXT',
  },
} as const satisfies Readonly<
  Record<
    CreationSetDecisionFormId,
    {
      readonly acceptActionKey: ActionKey;
      readonly alternateActionKey: ActionKey;
      readonly alternateDecision:
        'GO_ATTEMPT_2' | 'GO_NEXT_ATTEMPT' | 'USE_POINT_BUY_85' | 'USE_POINT_BUY_90';
      readonly attempt: 1 | 2 | null;
      readonly method: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
      readonly receiptKey: 'acceptedSetReceiptId' | 'setReceiptId';
      readonly transitionKind:
        'ADVENTUROUS_TO_85' | 'ADVENTUROUS_TO_SECOND' | 'ALL_OR_NOTHING_NEXT' | 'CLASSIC_TO_90';
    }
  >
>;
const NO_ACTION_KEYS = [] as const satisfies readonly ActionKey[];
const EMPTY_BRANCH_CACHE_HASH = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';

/**
 * Sources: generated/spec/atlas/forms-by-id.json["APP-001"].requiredFields
 * for the four host-owned values (`formId` is the projection identity), and
 * generated/spec/atlas/forms-by-id.json["APP-001"].guardStates for
 * `bootState=BOOTING|READY|ERROR`.
 */
const APP_001_KEYS = new Set([
  'baselineCompatibility',
  'bootState',
  'buildVersion',
  'formId',
  'integrityStatus',
]);
const APP_001_BOOT_STATES: ReadonlySet<string> = new Set(['BOOTING', 'READY', 'ERROR']);
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const BASELINE_COMPATIBILITY_KEYS = new Set([
  'builtAgainstTuple',
  'catalogVersion',
  'registryVersion',
]);
const BASELINE_VALUE_KEYS = new Set(['status', 'value']);
const INTEGRITY_STATUS_KEYS = new Set(['changed', 'missing', 'ok', 'tracked', 'untracked']);

export interface BaselineValue extends JsonObject {
  readonly status: 'PASS';
  readonly value: string;
}

export interface BaselineCompatibility extends JsonObject {
  readonly builtAgainstTuple: BaselineValue;
  readonly catalogVersion: BaselineValue;
  readonly registryVersion: BaselineValue;
}

export interface IntegrityStatus extends JsonObject {
  readonly changed: readonly string[];
  readonly missing: readonly string[];
  readonly ok: boolean;
  readonly tracked: number;
  readonly untracked: readonly string[];
}

export interface App001Projection extends JsonObject {
  readonly baselineCompatibility: BaselineCompatibility;
  readonly bootState: 'BOOTING' | 'ERROR' | 'READY';
  readonly buildVersion: string;
  readonly formId: 'APP-001';
  readonly integrityStatus: IntegrityStatus;
}

export interface App004Projection extends JsonObject {
  readonly libraryEntries: readonly {
    readonly localCharacterId: string;
    readonly lifecycleState: 'DRAFT' | 'FINAL' | 'VARIANT';
    readonly name: string | null;
    readonly selectionFormId: 'CHR-026' | 'CHR-040' | 'CHR-001';
  }[];
  readonly campaignAuthority: false;
  readonly draftCharacterIds: readonly string[];
  readonly finalCharacterIds: readonly string[];
  readonly handoffIdOrNull: null;
  readonly handoffReceiptIdOrNull: null;
  readonly launchContext: 'PLAYER_MENU';
  readonly localCharacterLibraryRevision: number;
  readonly localOwnerIdOrNull: null;
  readonly projectionRevision: number;
  readonly returnContext: 'PLAYER_MENU';
  readonly stateRevision: number;
}

export interface Chr010Projection extends JsonObject {
  readonly ancientOptionSerialized: false;
  readonly characterDraftId: string;
  readonly choiceLockStatus: 'UNLOCKED';
  readonly commandId: null;
  readonly draftRevision: number;
  readonly raceConsequenceOptions: readonly RaceConsequenceOptionProjection[];
  readonly raceChoice: null;
  readonly raceConsequencesPreview: null;
  readonly wizardCheckpointId: string;
}

export interface Chr016Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly choiceLockStatus: 'UNLOCKED';
  readonly commandId: null;
  readonly draftRevision: number;
  readonly modeConsequences: null;
  readonly modeConsequenceOptions: readonly ModeConsequenceOptionProjection[];
  readonly raceChoice: 'FREE' | 'UNITED';
  readonly symbiontAcquisitionMode: null;
  readonly wizardCheckpointId: string;
}

export interface Chr036Projection extends JsonObject {
  readonly appliesToAllCreationRolls: true;
  readonly characterDraftId: string;
  readonly choiceLockStatus: 'UNLOCKED';
  readonly commandId: null;
  readonly diceInputMode: null;
  readonly draftRevision: number;
  readonly wizardCheckpointId: string;
}

export interface Chr002Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly choiceLockStatus: 'UNLOCKED';
  readonly commandId: null;
  readonly draftRevision: number;
  readonly methodConsequences: null;
  readonly methodConsequenceOptions: readonly MethodConsequenceOptionProjection[];
  readonly statMethod: null;
  readonly wizardCheckpointId: string;
}

export interface LabeledStatModifierProjection extends JsonObject {
  readonly delta: number;
  readonly statCode: StatCode;
  readonly statLabel: string;
}

export type StatModifierEffectProjection =
  | { readonly kind: 'NO_STAT_MODIFIERS' }
  | {
      readonly entries: readonly LabeledStatModifierProjection[];
      readonly kind: 'ADDITIVE_STAT_MODIFIERS';
    };

export interface ModeConsequencesProjection extends JsonObject {
  readonly baseSymbiontSlots: number;
  readonly raceChoice: 'FREE' | 'UNITED';
  readonly raceLabel: string;
  readonly statModifiers: StatModifierEffectProjection;
}

export interface ModeConsequenceOptionProjection extends JsonObject {
  readonly modeConsequences: ModeConsequencesProjection;
  readonly symbiontAcquisitionMode: 'MANUAL' | 'RANDOM';
}

export type RaceStatModifiersByAcquisitionModeProjection =
  | { readonly kind: 'NOT_APPLICABLE' }
  | {
      readonly alternatives: readonly ModeConsequenceOptionProjection[];
      readonly kind: 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE';
    };

export type GrantedSkillsProjection =
  | { readonly kind: 'NO_GRANTED_SKILLS' }
  | {
      readonly entries: readonly [
        {
          readonly skillId: string;
          readonly skillLabel: string;
        },
      ];
      readonly kind: 'GRANTED_SKILLS';
    };

export interface RaceConsequencesPreviewProjection extends JsonObject {
  readonly allocationXpMultiplier: number;
  readonly baseSymbiontSlots: number;
  readonly classPolicy: 'NO_CLASS' | 'REQUIRED_PURE_CLASS';
  readonly directXpMultiplier: number;
  readonly grantedSkills: GrantedSkillsProjection;
  readonly raceLabel: string;
  readonly raceStatModifiersByAcquisitionMode: RaceStatModifiersByAcquisitionModeProjection;
  readonly symbiontXpPolicy: 'STANDARD_XP_AWARD' | 'XP_AWARD_X2';
  readonly symbioticMonsterAllowed: boolean;
}

export interface RaceConsequenceOptionProjection extends JsonObject {
  readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
  readonly raceConsequencesPreview: RaceConsequencesPreviewProjection;
}

export interface RejectedSetConsequencesProjection extends JsonObject {
  readonly creationCriticalConsequencesDiscarded: true;
  readonly irreversible: true;
  readonly setValuesDiscarded: true;
}

export type MethodTerminalRuleProjection =
  | {
      readonly afterAttempt: number;
      readonly exactTotal: number;
      readonly kind: 'POINT_BUY_AFTER_REJECTION';
    }
  | { readonly attemptIndex: number; readonly kind: 'MANDATORY_ACCEPT' };

export interface MethodConsequencesProjection extends JsonObject {
  readonly maximumAttempts: number;
  readonly rejectedSet: RejectedSetConsequencesProjection;
  readonly terminalRule: MethodTerminalRuleProjection;
}

export interface MethodConsequenceOptionProjection extends JsonObject {
  readonly methodConsequences: MethodConsequencesProjection;
  readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
}

export interface NaturalCriticalQueueItem extends JsonObject {
  readonly originFace: 1 | 20;
  readonly setEntryIndex: number;
}

export interface Chr003Projection extends JsonObject {
  readonly attemptIndex: number;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly commandId: null;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly draftRevision: number;
  readonly facesOrManualInputs: readonly (number | null)[];
  readonly naturalCriticalQueue: readonly NaturalCriticalQueueItem[];
  readonly setRollReceiptId: string | null;
  readonly setRollRequestId: string;
  readonly shownResultLocked: boolean;
  readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
  readonly wizardCheckpointId: string;
}

export interface Chr004Projection extends JsonObject {
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly commandId: null;
  readonly confirmationFace: number | null;
  readonly confirmationReceiptId: string | null;
  readonly confirmationRollRequestId: string;
  readonly criticalQueueIndex: number;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly draftRevision: number;
  readonly originFace: 1 | 20;
  readonly returnDecisionFormId: 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008';
  readonly setRollReceiptId: string;
  readonly wizardCheckpointId: string;
}

export interface CharacterSetDecisionProjection extends JsonObject {
  readonly acceptedSetReceiptId?: string;
  readonly attemptIndex?: number;
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly decision:
    | 'ACCEPT_SET'
    | 'GO_ATTEMPT_2'
    | 'GO_NEXT_ATTEMPT'
    | 'PENDING'
    | 'USE_POINT_BUY_85'
    | 'USE_POINT_BUY_90';
  readonly decisionReceiptIdOrNull: string | null;
  readonly draftRevision: number;
  readonly fifthAttemptMandatoryAccept?: boolean;
  readonly setReceiptId?: string;
  readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
  readonly wizardCheckpointId: string;
}

export interface CharacterSetAbandonmentConsequences extends JsonObject {
  readonly creationCriticalConsequencesDiscarded: true;
  readonly exactPointBuyTotalOrNull: 85 | 90 | null;
  readonly nextAttemptIndexOrNull: 2 | 3 | 4 | 5 | null;
  readonly setValuesDiscarded: true;
}

export interface Chr028Projection extends JsonObject {
  readonly abandonedSetReceiptIds: readonly [string];
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly decision: 'CONFIRM' | null;
  readonly decisionReceiptIdOrNull: string | null;
  readonly draftRevision: number;
  readonly irreversibleConsequences: CharacterSetAbandonmentConsequences;
  readonly originDecisionFormId: CreationSetDecisionFormId;
  readonly transitionKind:
    'ADVENTUROUS_TO_85' | 'ADVENTUROUS_TO_SECOND' | 'ALL_OR_NOTHING_NEXT' | 'CLASSIC_TO_90';
  readonly wizardCheckpointId: string;
}

export type StatCode = (typeof STAT_CODES)[number];
export type StatMap<T extends JsonValue> = Readonly<Record<StatCode, T>>;
export type StatAssignmentMode = 'POINT_BUY_85' | 'POINT_BUY_90' | 'ROLLED_BIJECTION';
export type PureClass = 'SEEKER' | 'SOLDIER' | 'STALKER';

export interface StatModifierProjection extends JsonObject {
  readonly delta: number;
  readonly statCode: StatCode;
}

export interface MandatoryClassSkillProjection extends JsonObject {
  readonly bonus: number;
  readonly skillKey: string;
  readonly slotCost: number;
}

export interface ClassConsequencesProjection extends JsonObject {
  readonly statModifiers: readonly StatModifierProjection[];
}

export interface PureClassOptionProjection extends JsonObject {
  readonly classConsequences: ClassConsequencesProjection;
  readonly mandatoryClassSkill: MandatoryClassSkillProjection;
  readonly pureClass: PureClass;
}

export interface RolledAssignmentSourceEntry extends JsonObject {
  readonly creationCriticalPenaltyOrNull: -1 | -2 | -3 | -4 | -5 | null;
  readonly setEntryIndex: number;
  readonly value: number;
}

export interface RolledBijectionProof extends JsonObject {
  readonly assignedSetEntryIndexByStat: null;
  readonly kind: 'ROLLED_BIJECTION';
  readonly sourceEntries: readonly RolledAssignmentSourceEntry[];
}

export interface ExactSumProof extends JsonObject {
  readonly actualTotal: null;
  readonly kind: 'EXACT_SUM';
  readonly requiredTotal: 85 | 90;
}

export interface Chr009Projection extends JsonObject {
  readonly C: null;
  readonly D: null;
  readonly I: null;
  readonly M: null;
  readonly S: null;
  readonly W: null;
  readonly Z: null;
  readonly assignmentMode: StatAssignmentMode;
  readonly assignmentValidation: null;
  readonly bijectionProofOrExactSum: ExactSumProof | RolledBijectionProof;
  readonly characterDraftId: string;
  readonly commandId: null;
  readonly draftRevision: number;
  readonly eachValueRange: { readonly maximum: 20; readonly minimum: 1 } | null;
  readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
  readonly sourceSetReceiptIdOrNull: string | null;
  readonly wizardCheckpointId: string;
}

export interface Chr011Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly classConsequences: null;
  readonly classOptions: readonly PureClassOptionProjection[];
  readonly commandId: null;
  readonly draftRevision: number;
  readonly mandatoryClassSkill: null;
  readonly pureClass: null;
  readonly raceChoice: 'PURE';
  readonly wizardCheckpointId: string;
}

export interface Chr012Projection extends JsonObject {
  readonly baseStats: StatMap<number>;
  readonly characterDraftId: string;
  readonly classModifiersOrNull: readonly StatModifierProjection[] | null;
  readonly commandId: null;
  readonly draftRevision: number;
  readonly mandatoryClassSkillOrNull: MandatoryClassSkillProjection | null;
  readonly raceModifiers: readonly StatModifierProjection[];
  readonly skillStageStats: StatMap<number>;
  readonly symbiontModifiersExcluded: true;
  readonly wizardCheckpointId: string;
}

export interface SkillLevelOptionProjection extends JsonObject {
  readonly slotCost: number;
  readonly targetBonus: number;
}

export interface SkillRequirementProjection extends JsonObject {
  readonly currentValue: number;
  readonly minValue: number;
  readonly satisfied: boolean;
  readonly statCode: StatCode;
  readonly statLabel: string;
}

export type MissingSkillPenaltyProjection =
  | { readonly kind: 'NO_MISSING_SKILL_PENALTY' }
  | { readonly kind: 'MISSING_SKILL_PENALTY'; readonly value: number };

export interface SkillCardSummaryProjection extends JsonObject {
  readonly bonusDomainScope: string;
  readonly eligibility: 'ELIGIBLE' | 'REQUIREMENTS_NOT_MET';
  readonly levelOptions: readonly SkillLevelOptionProjection[];
  readonly missingSkillPenalty: MissingSkillPenaltyProjection;
  readonly requirements: readonly SkillRequirementProjection[];
  readonly skillId: string;
  readonly skillLabel: string;
}

export interface FixedSkillProjection extends JsonObject {
  readonly bonus: number;
  readonly skillId: string;
  readonly skillLabel: string;
  readonly slotCost: number;
}

export interface SkillSlotSourcesProjection extends JsonObject {
  readonly mandatoryClassSkillOrNull: FixedSkillProjection | null;
  readonly racialFreeSkills: readonly FixedSkillProjection[];
  readonly requiredSlotCount: number;
}

export interface Chr013Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly commandId: null;
  readonly draftRevision: number;
  readonly eligibleSkillIds: readonly string[];
  readonly selectedSkillIdOrNull: null;
  readonly skillCardSummaries: readonly SkillCardSummaryProjection[];
  readonly skillStageStats: StatMap<number>;
  readonly slotSources: SkillSlotSourcesProjection;
  readonly wizardCheckpointId: string;
}

export interface SelectedSkillProjection extends JsonObject {
  readonly skillId: string;
  readonly slotCost: number;
  readonly targetBonus: number;
}

export interface Chr014Projection extends JsonObject {
  readonly bonusDomainScope: string;
  readonly characterDraftId: string;
  readonly eligibility: 'ELIGIBLE' | 'INELIGIBLE_READ_ONLY';
  readonly eligibleSkillIds: readonly string[];
  readonly freeSources: { readonly kind: 'NO_FREE_SOURCE' };
  readonly levelsAndBonuses: readonly SkillLevelOptionProjection[];
  readonly missingSkillPenalty: MissingSkillPenaltyProjection;
  readonly requirements: readonly SkillRequirementProjection[];
  readonly selectedSkills: readonly SelectedSkillProjection[];
  readonly selectionRevision: number;
  readonly skillId: string;
  readonly skillLabel: string;
  readonly skillStageValues: StatMap<number>;
  readonly slotCost: null;
  readonly slotSources: SkillSlotSourcesProjection;
  readonly wizardCheckpointId: string;
}

export interface CharacterSkillCardDraft {
  readonly formId: 'CHR-014';
  readonly targetBonus: number | null;
}

export interface SkillOptionProjection extends JsonObject {
  readonly bonusDomainScope: string;
  readonly levelOptions: readonly SkillLevelOptionProjection[];
  readonly missingSkillPenalty: MissingSkillPenaltyProjection;
  readonly skillId: string;
  readonly skillLabel: string;
}

export interface PaidSkillUsageEntryProjection extends JsonObject {
  readonly bonus: number;
  readonly skillId: string;
  readonly skillLabel: string;
  readonly slotCost: number;
  readonly source: 'CLASS_MANDATORY' | 'SELECTED';
}

export interface PaidSlotUsageProjection extends JsonObject {
  readonly entries: readonly PaidSkillUsageEntryProjection[];
  readonly usedSlotCount: number;
}

export type SkillSelectionValidation =
  | {
      readonly kind: 'UNDERFILLED';
      readonly missingSlotCount: number;
      readonly requiredSlotCount: number;
      readonly usedSlotCount: number;
    }
  | {
      readonly kind: 'EXACT';
      readonly requiredSlotCount: number;
      readonly usedSlotCount: number;
    }
  | {
      readonly excessSlotCount: number;
      readonly kind: 'OVERFILLED';
      readonly requiredSlotCount: number;
      readonly usedSlotCount: number;
    };

export interface Chr015Projection extends JsonObject {
  readonly characterDraftId: string;
  readonly commandId: string | null;
  readonly draftRevision: number;
  readonly eligibleSkillIds: readonly string[];
  readonly mandatoryClassSkillOrNull: FixedSkillProjection | null;
  readonly paidSlotUsage: PaidSlotUsageProjection;
  readonly racialFreeSkillIds: readonly string[];
  readonly racialFreeSkills: readonly FixedSkillProjection[];
  readonly requiredSlotCount: number;
  readonly selectedSkillIds: readonly string[];
  readonly selectedSkills: readonly SelectedSkillProjection[];
  readonly selectionCheckpoint: 'NONE' | 'PARTIAL' | 'EXACT';
  readonly selectionValidation: SkillSelectionValidation;
  readonly skillOptions: readonly SkillOptionProjection[];
  readonly wizardCheckpointId: string;
}

export interface CharacterSkillSelectionDraft {
  readonly candidateSkillIdOrNull: string | null;
  readonly candidateTargetBonusOrNull: number | null;
  readonly formId: 'CHR-015';
  readonly paidSlotUsage: PaidSlotUsageProjection;
  readonly selectedSkillIds: readonly string[];
  readonly selectedSkills: readonly SelectedSkillProjection[];
  readonly selectionValidation: SkillSelectionValidation;
}

export type StatAssignmentValidation = 'ASSIGNMENT_INVALID' | 'READY_TO_CHECKPOINT';

export interface CharacterStatAssignmentDraft {
  readonly assignmentMode: StatAssignmentMode;
  readonly formId: 'CHR-009';
  readonly valuesByStat: StatMap<number | null>;
  readonly validation: StatAssignmentValidation;
}

export type CharacterCreationRollDraft =
  | { readonly faces: readonly (number | null)[]; readonly formId: 'CHR-003' }
  | { readonly face: number | null; readonly formId: 'CHR-004' };

export type CharacterCreationChoiceDraft =
  | {
      readonly confirmationActionKey: 'CHR-010::CTA::001' | 'CHR-010::CTA::002';
      readonly consequence: RaceConsequencesPreviewProjection;
      readonly formId: 'CHR-010';
      readonly value: 'FREE' | 'PURE' | 'UNITED';
    }
  | {
      readonly confirmationActionKey: 'CHR-016::CTA::001';
      readonly consequence: ModeConsequencesProjection;
      readonly formId: 'CHR-016';
      readonly value: 'MANUAL' | 'RANDOM';
    }
  | {
      readonly confirmationActionKey: 'CHR-036::CTA::001';
      readonly consequence: null;
      readonly formId: 'CHR-036';
      readonly value: 'AUTO' | 'MANUAL';
    }
  | {
      readonly confirmationActionKey: 'CHR-002::CTA::001';
      readonly consequence: MethodConsequencesProjection;
      readonly formId: 'CHR-002';
      readonly value: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
    }
  | {
      readonly classConsequences: ClassConsequencesProjection;
      readonly confirmationActionKey: 'CHR-011::CTA::001';
      readonly consequence: null;
      readonly formId: 'CHR-011';
      readonly mandatoryClassSkill: MandatoryClassSkillProjection;
      readonly value: PureClass;
    };

type CharacterCreationSelectorChoice =
  | Omit<Extract<CharacterCreationChoiceDraft, { readonly formId: 'CHR-010' }>, 'consequence'>
  | Omit<Extract<CharacterCreationChoiceDraft, { readonly formId: 'CHR-016' }>, 'consequence'>
  | Extract<CharacterCreationChoiceDraft, { readonly formId: 'CHR-036' }>
  | Omit<Extract<CharacterCreationChoiceDraft, { readonly formId: 'CHR-002' }>, 'consequence'>;

const CHARACTER_CREATION_SELECTOR_CHOICES: ReadonlyMap<ActionKey, CharacterCreationSelectorChoice> =
  new Map([
    [
      'CHR-010::CTA::004',
      {
        confirmationActionKey: 'CHR-010::CTA::001',
        formId: 'CHR-010',
        value: 'UNITED',
      },
    ],
    [
      'CHR-010::CTA::005',
      {
        confirmationActionKey: 'CHR-010::CTA::001',
        formId: 'CHR-010',
        value: 'FREE',
      },
    ],
    [
      'CHR-010::CTA::006',
      {
        confirmationActionKey: 'CHR-010::CTA::002',
        formId: 'CHR-010',
        value: 'PURE',
      },
    ],
    [
      'CHR-016::CTA::003',
      {
        confirmationActionKey: 'CHR-016::CTA::001',
        formId: 'CHR-016',
        value: 'MANUAL',
      },
    ],
    [
      'CHR-016::CTA::004',
      {
        confirmationActionKey: 'CHR-016::CTA::001',
        formId: 'CHR-016',
        value: 'RANDOM',
      },
    ],
    [
      'CHR-036::CTA::004',
      {
        confirmationActionKey: 'CHR-036::CTA::001',
        consequence: null,
        formId: 'CHR-036',
        value: 'AUTO',
      },
    ],
    [
      'CHR-036::CTA::005',
      {
        confirmationActionKey: 'CHR-036::CTA::001',
        consequence: null,
        formId: 'CHR-036',
        value: 'MANUAL',
      },
    ],
    [
      'CHR-002::CTA::003',
      {
        confirmationActionKey: 'CHR-002::CTA::001',
        formId: 'CHR-002',
        value: 'CLASSIC',
      },
    ],
    [
      'CHR-002::CTA::004',
      {
        confirmationActionKey: 'CHR-002::CTA::001',
        formId: 'CHR-002',
        value: 'ADVENTUROUS',
      },
    ],
    [
      'CHR-002::CTA::005',
      {
        confirmationActionKey: 'CHR-002::CTA::001',
        formId: 'CHR-002',
        value: 'ALL_OR_NOTHING',
      },
    ],
  ]);

function characterCreationSelectorChoice(
  snapshot: ConfirmedProjectionSnapshot,
  actionKey: ActionKey,
): CharacterCreationChoiceDraft | undefined {
  const selector = CHARACTER_CREATION_SELECTOR_CHOICES.get(actionKey);
  if (selector !== undefined) {
    if (selector.formId !== snapshot.formId) return undefined;
    switch (selector.formId) {
      case 'CHR-010': {
        const option = (snapshot.projection as Chr010Projection).raceConsequenceOptions.find(
          ({ raceChoice }) => raceChoice === selector.value,
        );
        return option === undefined
          ? undefined
          : { ...selector, consequence: option.raceConsequencesPreview };
      }
      case 'CHR-016': {
        const option = (snapshot.projection as Chr016Projection).modeConsequenceOptions.find(
          ({ symbiontAcquisitionMode }) => symbiontAcquisitionMode === selector.value,
        );
        return option === undefined
          ? undefined
          : { ...selector, consequence: option.modeConsequences };
      }
      case 'CHR-036':
        return selector;
      case 'CHR-002': {
        const option = (snapshot.projection as Chr002Projection).methodConsequenceOptions.find(
          ({ statMethod }) => statMethod === selector.value,
        );
        return option === undefined
          ? undefined
          : { ...selector, consequence: option.methodConsequences };
      }
    }
  }
  if (snapshot.formId !== 'CHR-011') return undefined;
  const pureClass = PURE_CLASS_BY_SELECTOR.get(actionKey);
  if (pureClass === undefined) return undefined;
  const option = (snapshot.projection as Chr011Projection).classOptions.find(
    (candidate) => candidate.pureClass === pureClass,
  );
  if (option === undefined) return undefined;
  return {
    classConsequences: option.classConsequences,
    confirmationActionKey: 'CHR-011::CTA::001',
    consequence: null,
    formId: 'CHR-011',
    mandatoryClassSkill: option.mandatoryClassSkill,
    value: pureClass,
  };
}

interface IdentityCheckpointPayload extends JsonObject {
  readonly age: number;
  readonly artAssetKeyOrLocalFile: IdentityDraftValues['artAssetKeyOrLocalFile'];
  readonly characterDraftId: string;
  readonly description: string | null;
  readonly draftRevision: number;
  readonly massKg: number;
  readonly name: string;
  readonly sex: Exclude<IdentityDraftValues['sex'], null>;
  readonly stage: 'IDENTITY';
  readonly wizardCheckpointId: string;
}

type IdentityCheckpointRequest = WorkflowCommandRequestMessage<
  typeof IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  IdentityCheckpointPayload
>;

interface IdentityCheckpointResult extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: 0;
  readonly draftRevision: number;
  readonly nextFormId: 'CHR-010';
  readonly stage: 'IDENTITY';
}

interface StatAssignmentCheckpointCommonPayload extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly sourceFormId: 'CHR-009';
  readonly stage: 'STAT_ASSIGNMENT';
  readonly wizardCheckpointId: string;
}

interface RolledStatAssignmentCheckpointPayload extends StatAssignmentCheckpointCommonPayload {
  readonly setEntryIndexByStat: StatMap<number>;
}

interface PointBuyStatAssignmentCheckpointPayload extends StatAssignmentCheckpointCommonPayload {
  readonly pointBuyStats: StatMap<number>;
}

type StatAssignmentCheckpointPayload =
  PointBuyStatAssignmentCheckpointPayload | RolledStatAssignmentCheckpointPayload;
type StatAssignmentCheckpointRequest = WorkflowCommandRequestMessage<
  typeof IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  StatAssignmentCheckpointPayload
>;

interface SkillSelectionCheckpointInput extends JsonObject {
  readonly skillId: string;
  readonly targetBonus: number;
}

interface SkillSelectionCheckpointPayload extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly selectedSkills: readonly SkillSelectionCheckpointInput[];
  readonly sourceFormId: 'CHR-014' | 'CHR-015';
  readonly stage: 'SKILLS';
  readonly wizardCheckpointId: string;
}

type SkillSelectionCheckpointRequest = WorkflowCommandRequestMessage<
  typeof IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
  SkillSelectionCheckpointPayload
>;
type CheckpointRequest =
  | IdentityCheckpointRequest
  | ManualAdvisorSkillRequest
  | ManualCompositionRequest
  | ManualInteractionConfirmationRequest
  | SkillSelectionCheckpointRequest
  | StatAssignmentCheckpointRequest
  | SymbiontAdvisorCheckpointRequest;

interface RolledStatAssignmentResultEntry extends RolledAssignmentSourceEntry {
  readonly statCode: StatCode;
}

interface StatAssignmentCheckpointResult extends JsonObject {
  readonly assignmentMode: StatAssignmentMode;
  readonly baseStats: StatMap<number>;
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly nextFormId: 'CHR-011' | 'CHR-012';
  readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
  readonly rolledAssignmentsOrNull: readonly RolledStatAssignmentResultEntry[] | null;
  readonly sourceFormId: 'CHR-009';
  readonly sourceSetReceiptIdOrNull: string | null;
  readonly stage: 'STAT_ASSIGNMENT';
}

interface DurableSelectedSkillResult extends JsonObject {
  readonly skillKey: string;
  readonly targetBonus: number;
}

interface DurableLearnedSkillResult extends JsonObject {
  readonly bonus: number;
  readonly skillKey: string;
  readonly slotCost: number;
  readonly source: 'CLASS_MANDATORY' | 'RACE_GRANTED' | 'SELECTED';
}

interface SkillSelectionCheckpointResult extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly learnedSkills: readonly DurableLearnedSkillResult[];
  readonly nextFormId: 'CHR-015' | 'CHR-017';
  readonly requiredSlotCount: number;
  readonly selectedSkills: readonly DurableSelectedSkillResult[];
  readonly sourceFormId: 'CHR-014' | 'CHR-015';
  readonly stage: 'SKILLS';
  readonly usedSlotCount: number;
}

type CheckpointResult =
  | IdentityCheckpointResult
  | ManualAdvisorSkillResult
  | ManualCompositionResult
  | ManualInteractionConfirmationResult
  | SkillSelectionCheckpointResult
  | StatAssignmentCheckpointResult
  | SymbiontAdvisorCheckpointResult;

interface PendingCheckpoint {
  readonly assignmentDraft: CharacterStatAssignmentDraft | null;
  readonly request: CheckpointRequest;
  readonly receipt: CommandReceipt<CheckpointResult> | null;
  readonly skillSelectionDraft: CharacterSkillSelectionDraft | null;
  readonly sourceSnapshot: ConfirmedProjectionSnapshot;
}

interface SetDecisionCommonPayload extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly sourceFormId: 'CHR-002' | 'CHR-010' | 'CHR-016' | 'CHR-036';
  readonly stage: 'RACE_AND_METHOD';
  readonly wizardCheckpointId: string;
}

interface RaceDecisionPayload extends SetDecisionCommonPayload {
  readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
  readonly sourceFormId: 'CHR-010';
}

interface SymbiontAcquisitionDecisionPayload extends SetDecisionCommonPayload {
  readonly sourceFormId: 'CHR-016';
  readonly symbiontAcquisitionMode: 'MANUAL' | 'RANDOM';
}

interface DiceInputDecisionPayload extends SetDecisionCommonPayload {
  readonly diceInputMode: 'AUTO' | 'MANUAL';
  readonly sourceFormId: 'CHR-036';
}

interface StatMethodDecisionPayload extends SetDecisionCommonPayload {
  readonly sourceFormId: 'CHR-002';
  readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
}

interface PureClassDecisionPayload extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly pureClass: PureClass;
  readonly sourceFormId: 'CHR-011';
  readonly stage: 'STAT_ASSIGNMENT';
  readonly wizardCheckpointId: string;
}

type SetDecisionPayload =
  | DiceInputDecisionPayload
  | PureClassDecisionPayload
  | RaceDecisionPayload
  | StatRollAcceptSetPayload
  | StatRollDialogDecisionPayload
  | StatMethodDecisionPayload
  | SymbiontAcquisitionDecisionPayload;
type RaceMethodSetDecisionPayload = Exclude<
  SetDecisionPayload,
  PureClassDecisionPayload | StatRollAcceptSetPayload | StatRollDialogDecisionPayload
>;

interface StatRollDecisionCommonPayload extends JsonObject {
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly stage: 'STAT_ROLLS';
  readonly wizardCheckpointId: string;
}

interface StatRollAcceptSetPayload extends StatRollDecisionCommonPayload {
  readonly decision: 'ACCEPT_SET';
  readonly sourceFormId: CreationSetDecisionFormId;
}

interface StatRollDialogDecisionPayload extends StatRollDecisionCommonPayload {
  readonly decision: 'CANCEL' | 'CONFIRM';
  readonly sourceFormId: 'CHR-028';
}

type SetDecisionRequest = WorkflowCommandRequestMessage<
  typeof SET_DECIDE_WORKFLOW_COMMAND_ID,
  SetDecisionPayload
>;

interface SetDecisionResultCommon extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly sourceFormId: 'CHR-002' | 'CHR-010' | 'CHR-016' | 'CHR-036';
  readonly stage: 'RACE_AND_METHOD';
}

interface RaceDecisionResult extends SetDecisionResultCommon {
  readonly nextFormId: 'CHR-016' | 'CHR-036';
  readonly raceChoice: 'FREE' | 'PURE' | 'UNITED';
  readonly sourceFormId: 'CHR-010';
}

interface SymbiontAcquisitionDecisionResult extends SetDecisionResultCommon {
  readonly nextFormId: 'CHR-036';
  readonly sourceFormId: 'CHR-016';
  readonly symbiontAcquisitionMode: 'MANUAL' | 'RANDOM';
}

interface DiceInputDecisionResult extends SetDecisionResultCommon {
  readonly diceInputMode: 'AUTO' | 'MANUAL';
  readonly nextFormId: 'CHR-002';
  readonly sourceFormId: 'CHR-036';
}

interface StatMethodDecisionResult extends SetDecisionResultCommon {
  readonly branchUuid: string;
  readonly nextFormId: 'CHR-003';
  readonly setRollRequestId: string;
  readonly sourceFormId: 'CHR-002';
  readonly statMethod: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC';
}

interface PureClassDecisionResult extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly classConsequences: ClassConsequencesProjection;
  readonly draftRevision: number;
  readonly mandatoryClassSkill: MandatoryClassSkillProjection;
  readonly nextFormId: 'CHR-012';
  readonly pureClass: PureClass;
  readonly sourceFormId: 'CHR-011';
  readonly stage: 'STAT_ASSIGNMENT';
}

type SetDecisionResult =
  | CreationSetAbandonmentResult
  | CreationSetAcceptanceResult
  | CreationSetCancelResult
  | DiceInputDecisionResult
  | PureClassDecisionResult
  | RaceDecisionResult
  | StatMethodDecisionResult
  | SymbiontAcquisitionDecisionResult;

interface StatRollSetDecisionResultCommon extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly stage: 'STAT_ROLLS';
}

interface CreationSetAcceptanceResult extends StatRollSetDecisionResultCommon {
  readonly acceptedSetReceiptId: string;
  readonly assignmentMode: 'ROLLED_BIJECTION';
  readonly decision: 'ACCEPT_SET';
  readonly nextFormId: 'CHR-009';
  readonly sourceFormId: CreationSetDecisionFormId;
}

interface CreationSetAbandonmentResult extends StatRollSetDecisionResultCommon {
  readonly abandonedSetReceiptIds: readonly [string];
  readonly alternateDecision:
    'GO_ATTEMPT_2' | 'GO_NEXT_ATTEMPT' | 'USE_POINT_BUY_85' | 'USE_POINT_BUY_90';
  readonly assignmentModeOrNull: 'POINT_BUY_85' | 'POINT_BUY_90' | null;
  readonly decision: 'CONFIRM';
  readonly irreversibleConsequences: CharacterSetAbandonmentConsequences;
  readonly nextAttemptIndexOrNull: 2 | 3 | 4 | 5 | null;
  readonly nextFormId: 'CHR-003' | 'CHR-009';
  readonly nextSetRollRequestIdOrNull: string | null;
  readonly originDecisionFormId: CreationSetDecisionFormId;
  readonly sourceFormId: 'CHR-028';
  readonly sourceSetReceiptIdOrNull: null;
  readonly transitionKind: Chr028Projection['transitionKind'];
}

interface CreationSetCancelResult extends StatRollSetDecisionResultCommon {
  readonly decision: 'CANCEL';
  readonly decisionReceiptIdOrNull: null;
  readonly nextFormId: CreationSetDecisionFormId;
  readonly originDecisionFormId: CreationSetDecisionFormId;
  readonly sourceFormId: 'CHR-028';
}

interface PendingSetDecision {
  readonly choice: CharacterCreationChoiceDraft | null;
  readonly request: SetDecisionRequest;
  readonly receipt: CommandReceipt<SetDecisionResult> | null;
  readonly sourceSnapshot: ConfirmedProjectionSnapshot;
}

interface RollCommitCommonPayload extends JsonObject {
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly draftRevision: number;
  readonly sourceFormId: 'CHR-003' | 'CHR-004';
  readonly stage: 'STAT_ROLLS';
  readonly wizardCheckpointId: string;
}

interface SetRollCommitPayload extends RollCommitCommonPayload {
  readonly manualFacesOrNull: readonly number[] | null;
  readonly setRollRequestId: string;
  readonly sourceFormId: 'CHR-003';
}

interface ConfirmationRollCommitPayload extends RollCommitCommonPayload {
  readonly confirmationRollRequestId: string;
  readonly criticalQueueIndex: number;
  readonly manualFaceOrNull: number | null;
  readonly setRollReceiptId: string;
  readonly sourceFormId: 'CHR-004';
}

type RollCommitPayload =
  | AdvisorIntelligenceFloorRollPayload
  | ConfirmationRollCommitPayload
  | ManualAdvisorIwRequest['payload']
  | SetRollCommitPayload
  | SymbiontRollCommitPayload;
type RollCommitRequest = WorkflowCommandRequestMessage<
  typeof ROLL_COMMIT_WORKFLOW_COMMAND_ID,
  RollCommitPayload
>;

interface RollCommitResultCommon extends JsonObject {
  readonly branchCacheHash: typeof EMPTY_BRANCH_CACHE_HASH;
  readonly branchUuid: string;
  readonly characterDraftId: string;
  readonly checkpointId: string;
  readonly checkpointOwnerId: string;
  readonly checkpointRevision: number;
  readonly draftRevision: number;
  readonly sourceFormId: 'CHR-003' | 'CHR-004';
  readonly stage: 'STAT_ROLLS';
}

interface SetRollCommitResult extends RollCommitResultCommon {
  readonly confirmationRollRequestIdOrNull: string | null;
  readonly diceInputModeSnapshot: 'AUTO' | 'MANUAL';
  readonly faces: readonly number[];
  readonly naturalCriticalQueue: readonly NaturalCriticalQueueItem[];
  readonly nextFormId: 'CHR-003' | 'CHR-004';
  readonly setRollReceiptId: string;
  readonly setRollRequestId: string;
  readonly shownResultLocked: true;
  readonly sourceFormId: 'CHR-003';
}

interface ConfirmationRollCommitResult extends RollCommitResultCommon {
  readonly confirmationFace: number;
  readonly confirmationReceiptId: string;
  readonly confirmationRollRequestId: string;
  readonly criticalQueueIndex: number;
  readonly nextConfirmationRollRequestIdOrNull: string | null;
  readonly nextFormId: 'CHR-004';
  readonly originFace: 1 | 20;
  readonly outcomeOrNull: JsonObject | null;
  readonly returnDecisionFormId: 'CHR-005' | 'CHR-006' | 'CHR-007' | 'CHR-008';
  readonly setRollReceiptId: string;
  readonly sourceFormId: 'CHR-004';
}

type RollCommitResult =
  | AdvisorIntelligenceFloorRollResult
  | ConfirmationRollCommitResult
  | ManualAdvisorIwResult
  | SetRollCommitResult
  | SymbiontRollCommitResult;

interface PendingRollCommit {
  readonly receipt: CommandReceipt<RollCommitResult> | null;
  readonly request: RollCommitRequest;
  readonly sourceProjection:
    Chr003Projection | Chr004Projection | Chr020Projection | Chr041Projection;
  readonly sourceSnapshot: ConfirmedProjectionSnapshot;
}

type SymbiontPresentationFormId =
  'CHR-017' | 'CHR-018' | 'CHR-019' | 'CHR-020' | 'CHR-041' | 'CHR-042';

interface ConfirmedProjectionSnapshotBase {
  readonly availableActionKeys: readonly ActionKey[];
  readonly executableWorkflowCommandIds: readonly WorkflowCommandId[];
  readonly formId: Exclude<SupportedPresentationFormId, SymbiontPresentationFormId>;
  readonly layers: readonly ConfirmedPresentationLayer[];
  readonly path: string;
  readonly projection: JsonObject;
  readonly revisions: RevisionVector;
}

type ConfirmedSymbiontProjectionSnapshot<
  FormId extends SymbiontPresentationFormId = SymbiontPresentationFormId,
> = FormId extends SymbiontPresentationFormId
  ? Omit<ConfirmedProjectionSnapshotBase, 'formId' | 'projection'> & {
      readonly formId: FormId;
      readonly projection: FormId extends 'CHR-017'
        ? Chr017Projection | ManualChr017Projection
        : FormId extends 'CHR-018'
          ? Chr018Projection
          : FormId extends 'CHR-019'
            ? Chr019Projection | ManualChr019Projection
            : FormId extends 'CHR-020'
              ? Chr020Projection
              : FormId extends 'CHR-041'
                ? Chr041Projection
                : Chr042Projection;
    }
  : never;

export type ConfirmedProjectionSnapshot =
  ConfirmedProjectionSnapshotBase | ConfirmedSymbiontProjectionSnapshot<SymbiontPresentationFormId>;

interface ConfirmedAbandonmentLayer {
  readonly availableActionKeys: readonly ActionKey[];
  readonly formId: 'CHR-028';
  readonly path: '@dialog/chr-028';
  readonly projection: Chr028Projection;
}
interface ConfirmedInvalidWeaponProfileLayer {
  readonly availableActionKeys: readonly ActionKey[];
  readonly formId: 'CHR-031';
  readonly path: '@dialog/chr-031';
  readonly projection: Chr031Projection;
}
export type ConfirmedPresentationLayer =
  | ConfirmedAbandonmentLayer
  | ConfirmedInvalidWeaponProfileLayer
  | {
      readonly formId: 'NET-020' | 'NET-021' | 'NET-022';
      readonly path: string;
      readonly projection: JsonObject;
      readonly availableActionKeys: readonly ActionKey[];
    };

export type WebClientState =
  | { readonly kind: 'awaiting-snapshot' }
  | { readonly kind: 'client-error'; readonly detail: string }
  | { readonly kind: 'connecting' }
  | {
      readonly code: number | null;
      readonly detail: string;
      readonly kind: 'disconnected';
      readonly snapshot: ConfirmedProjectionSnapshot | null;
    }
  | {
      readonly kind: 'command-refusal';
      readonly refusal: CommandRefusalMessage['refusal'];
      readonly snapshot: ConfirmedProjectionSnapshot;
    }
  | {
      readonly kind: 'host-refusal';
      readonly refusal: DecodeRefusal;
      readonly snapshot: ConfirmedProjectionSnapshot | null;
    }
  | {
      readonly detail: string;
      readonly kind: 'protocol-error';
      readonly refusal: DecodeRefusal;
      readonly snapshot: ConfirmedProjectionSnapshot | null;
    }
  | {
      readonly kind: 'navigation-refusal';
      readonly refusal:
        AddressableRouteRefusalV2Message['refusal'] | FormActionRefusalV2Message['refusal'];
      readonly snapshot: ConfirmedProjectionSnapshot;
    }
  | { readonly kind: 'ready'; readonly snapshot: ConfirmedProjectionSnapshot };

export type FormActionRequestResult =
  { readonly ok: false; readonly detail: string } | { readonly ok: true };

export interface ProjectionConnection {
  replaceAdmissionDraft(edit: AdmissionBrowserEdit): FormActionRequestResult;
  replaceNetworkGmRequestDraft(values: NetworkGmRequestDraftValues): FormActionRequestResult;
  replaceNetworkDraft(edit: NetworkEdit): FormActionRequestResult;
  setNetworkInputPending(pending: boolean): void;
  chooseLocalRole(role: 'player' | 'gm'): FormActionRequestResult;
  replaceCampaignDraft(edit: CampaignEdit): FormActionRequestResult;
  setCampaignInputPending(pending: boolean): void;
  submitPostSave(
    variant: PostSavePayload['variant'],
    values?: PostSaveMetadata,
  ): FormActionRequestResult;
  selectLibraryCharacter(localCharacterId: string): FormActionRequestResult;
  submitCreationCorrection(
    variant: CreationCorrectionVariant,
    values: JsonObject,
  ): { readonly ok: true } | { readonly ok: false; readonly detail: string };
  rollFiveStartingPosition(
    positions: readonly FiveStartingPositionSelection[],
    positionId: string,
    manualFaceOrNull: number | null,
  ): FormActionRequestResult;
  submitWeaponProfile(inputs: WeaponProfileInputs): FormActionRequestResult;
  replaceStartingWeaponSelection(
    weaponTypeId: string,
    weaponVariant: string,
  ): FormActionRequestResult;
  disconnect(): void;
  reconnect(): FormActionRequestResult;
  replaceAdvisorSkillCandidate(
    skillId: string | null,
    targetBonus: number | null,
  ): FormActionRequestResult;
  replaceConfirmationManualFace(value: number | null): FormActionRequestResult;
  replaceManualBindingSide(side: SymbiontSide): FormActionRequestResult;
  replaceRandomManualFace(value: number | null): FormActionRequestResult;
  replaceRandomSideSpecies(species: 'OWL' | 'EEL' | null): FormActionRequestResult;
  addArmorBundleSelection(
    itemId: string,
    bodyZoneOrNull: 'HEAD' | 'TORSO' | 'ARM_L' | 'ARM_R' | 'LEG_L' | 'LEG_R' | null,
  ): FormActionRequestResult;
  removeArmorBundleSelection(
    bodyZoneOrNull: 'HEAD' | 'TORSO' | 'ARM_L' | 'ARM_R' | 'LEG_L' | 'LEG_R' | null,
  ): FormActionRequestResult;
  replaceSetManualFace(index: number, value: number | null): FormActionRequestResult;
  replaceIdentityDraft(values: IdentityDraftValues): FormActionRequestResult;
  replaceSkillCardLevel(targetBonus: number | null): FormActionRequestResult;
  replaceSkillSelectionCandidate(
    skillId: string | null,
    targetBonus: number | null,
  ): FormActionRequestResult;
  requestFormAction(
    actionKey: ActionKey,
    manualFacesOrNull?: number | readonly [number, number] | null,
  ): FormActionRequestResult;
  requestSkillCard(skillId: string): FormActionRequestResult;
  requestSymbiontCard(speciesKey: SymbiontSpeciesKey): FormActionRequestResult;
  replaceStatAssignmentValue(statCode: StatCode, value: number | null): FormActionRequestResult;
  toggleManualCompositionSpecies(
    speciesKey: SymbiontSpeciesKey,
    included: boolean,
  ): FormActionRequestResult;
}

function refused<T>(refusal: DecodeRefusal): DecodeResult<T> {
  return { ok: false, refusal };
}

function unrecognized<T>(path: string, value: JsonValue): DecodeResult<T> {
  return refused({ code: 'UNRECOGNIZED', path, value });
}

function wireType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactObjectKeys(
  value: JsonObject,
  expectedKeys: ReadonlySet<string>,
  path: string,
): DecodeResult<null> {
  for (const key of Object.keys(value)) {
    if (expectedKeys.has(key)) continue;
    const unexpected = value[key];
    if (unexpected === undefined) {
      return refused({
        actualType: 'undefined',
        code: 'INVALID_SHAPE',
        expected: 'JSON value',
        path: `${path}.${key}`,
      });
    }
    return refused({ code: 'UNRECOGNIZED', path: `${path}.${key}`, value: unexpected });
  }
  return { ok: true, value: null };
}

function decodeBaselineValue(value: unknown, path: string): DecodeResult<BaselineValue> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object with status and value',
      path,
    });
  }
  const keys = exactObjectKeys(value, BASELINE_VALUE_KEYS, path);
  if (!keys.ok) return keys;
  const status = value['status'];
  if (typeof status !== 'string') {
    return refused({
      actualType: wireType(status),
      code: 'INVALID_SHAPE',
      expected: 'string literal PASS',
      path: `${path}.status`,
    });
  }
  if (status !== 'PASS') {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.status`, value: status });
  }
  const baselineValue = value['value'];
  if (typeof baselineValue !== 'string') {
    return refused({
      actualType: wireType(baselineValue),
      code: 'INVALID_SHAPE',
      expected: 'string',
      path: `${path}.value`,
    });
  }
  return { ok: true, value: value as BaselineValue };
}

function decodeBaselineCompatibility(
  value: unknown,
  path: string,
): DecodeResult<BaselineCompatibility> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object',
      path,
    });
  }
  const keys = exactObjectKeys(value, BASELINE_COMPATIBILITY_KEYS, path);
  if (!keys.ok) return keys;
  for (const key of ['builtAgainstTuple', 'catalogVersion', 'registryVersion'] as const) {
    const baselineValue = decodeBaselineValue(value[key], `${path}.${key}`);
    if (!baselineValue.ok) return baselineValue;
  }
  return { ok: true, value: value as BaselineCompatibility };
}

function decodeStringList(value: unknown, path: string): DecodeResult<readonly string[]> {
  if (!Array.isArray(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'array of strings',
      path,
    });
  }
  for (const [index, entry] of value.entries()) {
    if (typeof entry === 'string') continue;
    return refused({
      actualType: wireType(entry),
      code: 'INVALID_SHAPE',
      expected: 'string',
      path: `${path}[${String(index)}]`,
    });
  }
  return { ok: true, value: value as string[] };
}

function decodeIntegrityStatus(value: unknown, path: string): DecodeResult<IntegrityStatus> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object',
      path,
    });
  }
  const keys = exactObjectKeys(value, INTEGRITY_STATUS_KEYS, path);
  if (!keys.ok) return keys;
  for (const key of ['changed', 'missing', 'untracked'] as const) {
    const list = decodeStringList(value[key], `${path}.${key}`);
    if (!list.ok) return list;
  }
  const ok = value['ok'];
  if (typeof ok !== 'boolean') {
    return refused({
      actualType: wireType(ok),
      code: 'INVALID_SHAPE',
      expected: 'boolean',
      path: `${path}.ok`,
    });
  }
  const tracked = value['tracked'];
  if (typeof tracked !== 'number') {
    return refused({
      actualType: wireType(tracked),
      code: 'INVALID_SHAPE',
      expected: 'non-negative safe integer',
      path: `${path}.tracked`,
    });
  }
  if (!Number.isSafeInteger(tracked) || tracked < 0) {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.tracked`, value: tracked });
  }
  return { ok: true, value: value as IntegrityStatus };
}

function decodeApp001Projection(value: JsonObject, path: string): DecodeResult<App001Projection> {
  const keys = exactObjectKeys(value, APP_001_KEYS, path);
  if (!keys.ok) return keys;

  const formId = value['formId'];
  if (typeof formId !== 'string') {
    return refused({
      actualType: wireType(formId),
      code: 'INVALID_SHAPE',
      expected: 'string literal APP-001',
      path: `${path}.formId`,
    });
  }
  if (formId !== 'APP-001') {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.formId`, value: formId });
  }

  const buildVersion = value['buildVersion'];
  if (typeof buildVersion !== 'string') {
    return refused({
      actualType: wireType(buildVersion),
      code: 'INVALID_SHAPE',
      expected: 'string',
      path: `${path}.buildVersion`,
    });
  }

  const baselineCompatibility = decodeBaselineCompatibility(
    value['baselineCompatibility'],
    `${path}.baselineCompatibility`,
  );
  if (!baselineCompatibility.ok) return baselineCompatibility;

  const integrityStatus = decodeIntegrityStatus(
    value['integrityStatus'],
    `${path}.integrityStatus`,
  );
  if (!integrityStatus.ok) return integrityStatus;

  const bootState = value['bootState'];
  if (typeof bootState !== 'string') {
    return refused({
      actualType: wireType(bootState),
      code: 'INVALID_SHAPE',
      expected: 'BOOTING | READY | ERROR',
      path: `${path}.bootState`,
    });
  }
  if (!APP_001_BOOT_STATES.has(bootState)) {
    return refused({ code: 'UNRECOGNIZED', path: `${path}.bootState`, value: bootState });
  }

  return { ok: true, value: value as App001Projection };
}

type FieldPredicate = (value: JsonValue) => boolean;

function decodeProjection(
  value: JsonObject,
  path: string,
  fields: Readonly<Record<string, FieldPredicate>>,
): DecodeResult<JsonObject> {
  const keys = exactObjectKeys(value, new Set(Object.keys(fields)), path);
  if (!keys.ok) return keys;
  for (const [key, valid] of Object.entries(fields)) {
    const field = value[key];
    if (field === undefined) {
      return refused({
        actualType: 'undefined',
        code: 'INVALID_SHAPE',
        expected: 'required JSON value',
        path: `${path}.${key}`,
      });
    }
    if (!valid(field)) return unrecognized(`${path}.${key}`, field);
  }
  return { ok: true, value };
}

function decodeApp002Projection(value: JsonObject, path: string, revisions: RevisionVector) {
  const result = decodeProjection(value, path, {
    contextId: (field) => typeof field === 'string' && DEVICE_ID_PATTERN.test(field),
    deviceId: (field) => typeof field === 'string' && DEVICE_ID_PATTERN.test(field),
    projectionRevision: (field) => field === revisions.projectionRevision,
    stateRevision: (field) => field === revisions.stateRevision,
  });
  const contextId = value['contextId'];
  if (result.ok && contextId !== undefined && contextId === value['deviceId']) {
    return unrecognized<JsonObject>(`${path}.contextId`, contextId);
  }
  return result;
}

function isCanonicalCharacterIdList(value: JsonValue): value is readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return false;
  const ids = value as string[];
  return (
    new Set(ids).size === ids.length &&
    ids.every((entry, index) => index === 0 || ids[index - 1]! < entry)
  );
}

function decodeApp004Projection(
  value: JsonObject,
  path: string,
  revisions: RevisionVector,
): DecodeResult<JsonObject> {
  const result = decodeProjection(value, path, {
    campaignAuthority: (field) => field === false,
    libraryEntries: (field) =>
      Array.isArray(field) &&
      field.every(
        (entry) =>
          isJsonObject(entry) &&
          decodeProjection(entry, `${path}.libraryEntries`, {
            localCharacterId: (id) => typeof id === 'string' && UUID_PATTERN.test(id),
            lifecycleState: (s) => s === 'DRAFT' || s === 'FINAL' || s === 'VARIANT',
            name: (n) => n === null || isNonEmptyString(n),
            selectionFormId: (f) =>
              f ===
              (entry['lifecycleState'] === 'DRAFT'
                ? 'CHR-026'
                : entry['lifecycleState'] === 'FINAL'
                  ? 'CHR-040'
                  : 'CHR-001'),
          }).ok,
      ),
    draftCharacterIds: isCanonicalCharacterIdList,
    finalCharacterIds: isCanonicalCharacterIdList,
    handoffIdOrNull: (field) => field === null,
    handoffReceiptIdOrNull: (field) => field === null,
    launchContext: (field) => field === 'PLAYER_MENU',
    localCharacterLibraryRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    localOwnerIdOrNull: (field) => field === null,
    projectionRevision: (field) => field === revisions.projectionRevision,
    returnContext: (field) => field === 'PLAYER_MENU',
    stateRevision: (field) => field === revisions.stateRevision,
  });
  if (!result.ok) return result;
  const draftIds = value['draftCharacterIds'] as readonly string[];
  const finalIds = value['finalCharacterIds'] as readonly string[];
  const entries = value['libraryEntries'] as App004Projection['libraryEntries'];
  if (
    entries.length !== draftIds.length + finalIds.length ||
    new Set(entries.map((e) => e.localCharacterId)).size !== entries.length ||
    entries.some(
      (e) => !(e.lifecycleState === 'FINAL' ? finalIds : draftIds).includes(e.localCharacterId),
    )
  )
    return unrecognized(`${path}.libraryEntries`, value['libraryEntries']!);
  const draftIdSet = new Set(draftIds);
  const duplicate = finalIds.find((id) => draftIdSet.has(id));
  return duplicate === undefined
    ? result
    : unrecognized(`${path}.finalCharacterIds`, [...finalIds]);
}

function isIdentityArt(value: JsonValue): boolean {
  if (value === null) return true;
  if (!isJsonObject(value) || typeof value['kind'] !== 'string') return false;
  if (value['kind'] === 'asset-key') {
    return (
      Object.keys(value).sort().join(',') === 'assetKey,kind' &&
      typeof value['assetKey'] === 'string'
    );
  }
  return (
    value['kind'] === 'local-file' &&
    Object.keys(value).sort().join(',') === 'bytesBase64,kind,mediaType' &&
    typeof value['bytesBase64'] === 'string' &&
    (value['mediaType'] === 'image/png' || value['mediaType'] === 'image/jpeg')
  );
}

function decodeChr001Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    age: (field) => field === null || (typeof field === 'number' && Number.isFinite(field)),
    ...(Object.hasOwn(value, 'identityDraftScope')
      ? {
          identityDraftScope: (field: JsonValue) =>
            isJsonObject(field) &&
            decodeProjection(field, `${path}.identityDraftScope`, {
              sourceFormId: (v) => v === 'CHR-001',
              contextId: (v) => typeof v === 'string' && UUID_PATTERN.test(v),
              characterDraftId: (v) => v === characterDraftId,
              wizardCheckpointId: (v) => v === value['wizardCheckpointId'],
            }).ok,
        }
      : {}),
    anatomyProfile: (field) => field === 'STANDARD_HUMANOID',
    artAssetKeyOrLocalFile: isIdentityArt,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null,
    description: (field) => field === null || typeof field === 'string',
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    massApprovalStatus: (field) => field === 'PENDING_GM',
    massKg: (field) =>
      field === null ||
      (typeof field === 'number' &&
        Number.isFinite(field) &&
        field > 0 &&
        (Number.isInteger(field) || Number.isInteger(field * 10))),
    name: (field) => field === null || typeof field === 'string',
    sex: (field) => field === null || field === 'MALE' || field === 'FEMALE',
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function isPositiveSafeInteger(value: JsonValue): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function decodeLabeledStatModifiers(
  value: JsonValue,
  path: string,
  statLabels: Map<StatCode, string>,
): DecodeResult<readonly LabeledStatModifierProjection[]> {
  if (!Array.isArray(value) || value.length === 0) return unrecognized(path, value);
  const entries = value as readonly JsonValue[];
  const seen = new Set<StatCode>();
  let previousOrder = -1;
  for (const [index, entry] of entries.entries()) {
    const itemPath = `${path}[${String(index)}]`;
    if (!isJsonObject(entry)) return unrecognized(itemPath, entry);
    const shape = decodeProjection(entry, itemPath, {
      delta: (field) => typeof field === 'number' && Number.isSafeInteger(field),
      statCode: (field) => typeof field === 'string' && STAT_CODES.includes(field as StatCode),
      statLabel: (field) => typeof field === 'string' && field.trim().length > 0,
    });
    if (!shape.ok) return shape;
    const statCode = entry['statCode'] as StatCode;
    const statLabel = entry['statLabel'] as string;
    const order = STAT_CODES.indexOf(statCode);
    if (seen.has(statCode) || order <= previousOrder) {
      return unrecognized(`${itemPath}.statCode`, statCode);
    }
    const previousLabel = statLabels.get(statCode);
    if (previousLabel !== undefined && previousLabel !== statLabel) {
      return unrecognized(`${itemPath}.statLabel`, statLabel);
    }
    statLabels.set(statCode, statLabel);
    previousOrder = order;
    seen.add(statCode);
  }
  return {
    ok: true,
    value: value as unknown as readonly LabeledStatModifierProjection[],
  };
}

function decodeStatModifierEffect(
  value: JsonValue,
  path: string,
  statLabels: Map<StatCode, string>,
): DecodeResult<StatModifierEffectProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  if (value['kind'] === 'NO_STAT_MODIFIERS') {
    const shape = decodeProjection(value, path, {
      kind: (field) => field === 'NO_STAT_MODIFIERS',
    });
    return shape.ok ? { ok: true, value: value as StatModifierEffectProjection } : shape;
  }
  if (value['kind'] !== 'ADDITIVE_STAT_MODIFIERS') {
    return unrecognized(`${path}.kind`, value['kind']!);
  }
  const entries = decodeLabeledStatModifiers(value['entries']!, `${path}.entries`, statLabels);
  if (!entries.ok) return entries;
  const shape = decodeProjection(value, path, {
    entries: (field) => field === value['entries'],
    kind: (field) => field === 'ADDITIVE_STAT_MODIFIERS',
  });
  return shape.ok ? { ok: true, value: value as StatModifierEffectProjection } : shape;
}

function decodeModeConsequences(
  value: JsonValue,
  path: string,
  expectedRaceChoice: 'FREE' | 'UNITED',
  statLabels: Map<StatCode, string>,
): DecodeResult<ModeConsequencesProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const modifiers = decodeStatModifierEffect(
    value['statModifiers']!,
    `${path}.statModifiers`,
    statLabels,
  );
  if (!modifiers.ok) return modifiers;
  const shape = decodeProjection(value, path, {
    baseSymbiontSlots: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    raceChoice: (field) => field === expectedRaceChoice,
    raceLabel: (field) => typeof field === 'string' && field.trim().length > 0,
    statModifiers: (field) => field === value['statModifiers'],
  });
  return shape.ok ? { ok: true, value: value as ModeConsequencesProjection } : shape;
}

function decodeModeConsequenceOptions(
  value: JsonValue,
  path: string,
  expectedRaceChoice: 'FREE' | 'UNITED',
  statLabels: Map<StatCode, string>,
): DecodeResult<readonly ModeConsequenceOptionProjection[]> {
  if (!Array.isArray(value) || value.length !== 2) return unrecognized(path, value);
  const expectedModes = ['MANUAL', 'RANDOM'] as const;
  const options = value as readonly JsonValue[];
  let raceLabel: string | null = null;
  let baseSymbiontSlots: number | null = null;
  for (const [index, option] of options.entries()) {
    const optionPath = `${path}[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const mode = expectedModes[index]!;
    if (option['symbiontAcquisitionMode'] !== mode) {
      return unrecognized(
        `${optionPath}.symbiontAcquisitionMode`,
        option['symbiontAcquisitionMode']!,
      );
    }
    const consequence = decodeModeConsequences(
      option['modeConsequences']!,
      `${optionPath}.modeConsequences`,
      expectedRaceChoice,
      statLabels,
    );
    if (!consequence.ok) return consequence;
    const shape = decodeProjection(option, optionPath, {
      modeConsequences: (field) => field === option['modeConsequences'],
      symbiontAcquisitionMode: (field) => field === mode,
    });
    if (!shape.ok) return shape;
    const expectedModifierKind =
      expectedRaceChoice === 'FREE' && mode === 'RANDOM'
        ? 'NO_STAT_MODIFIERS'
        : 'ADDITIVE_STAT_MODIFIERS';
    if (consequence.value.statModifiers.kind !== expectedModifierKind) {
      return unrecognized(
        `${optionPath}.modeConsequences.statModifiers.kind`,
        consequence.value.statModifiers.kind,
      );
    }
    if (
      (raceLabel !== null && consequence.value.raceLabel !== raceLabel) ||
      (baseSymbiontSlots !== null && consequence.value.baseSymbiontSlots !== baseSymbiontSlots)
    ) {
      return unrecognized(`${optionPath}.modeConsequences`, option['modeConsequences']!);
    }
    raceLabel = consequence.value.raceLabel;
    baseSymbiontSlots = consequence.value.baseSymbiontSlots;
  }
  return {
    ok: true,
    value: value as unknown as readonly ModeConsequenceOptionProjection[],
  };
}

function decodeRaceConsequencesPreview(
  value: JsonValue,
  path: string,
  expectedRaceChoice: 'FREE' | 'PURE' | 'UNITED',
  statLabels: Map<StatCode, string>,
): DecodeResult<RaceConsequencesPreviewProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const grantedSkills = value['grantedSkills'];
  if (!isJsonObject(grantedSkills)) return unrecognized(`${path}.grantedSkills`, grantedSkills!);
  if (expectedRaceChoice === 'UNITED') {
    const entries = grantedSkills['entries'];
    if (!Array.isArray(entries) || entries.length !== 1) {
      return unrecognized(`${path}.grantedSkills.entries`, entries!);
    }
    const entry = (entries as readonly JsonValue[])[0]!;
    if (!isJsonObject(entry)) return unrecognized(`${path}.grantedSkills.entries[0]`, entry);
    const decodedEntry = decodeProjection(entry, `${path}.grantedSkills.entries[0]`, {
      skillId: isPublicSkillId,
      skillLabel: isNonEmptyString,
    });
    if (!decodedEntry.ok) return decodedEntry;
    const decodedGranted = decodeProjection(grantedSkills, `${path}.grantedSkills`, {
      entries: (field) => field === entries,
      kind: (field) => field === 'GRANTED_SKILLS',
    });
    if (!decodedGranted.ok) return decodedGranted;
  } else {
    const decodedNone = decodeProjection(grantedSkills, `${path}.grantedSkills`, {
      kind: (field) => field === 'NO_GRANTED_SKILLS',
    });
    if (!decodedNone.ok) return decodedNone;
  }
  const raceModifiersByMode = value['raceStatModifiersByAcquisitionMode'];
  if (!isJsonObject(raceModifiersByMode)) {
    return unrecognized(`${path}.raceStatModifiersByAcquisitionMode`, raceModifiersByMode!);
  }
  if (expectedRaceChoice === 'PURE') {
    const notApplicable = decodeProjection(
      raceModifiersByMode,
      `${path}.raceStatModifiersByAcquisitionMode`,
      { kind: (field) => field === 'NOT_APPLICABLE' },
    );
    if (!notApplicable.ok) return notApplicable;
  } else {
    const alternatives = decodeModeConsequenceOptions(
      raceModifiersByMode['alternatives']!,
      `${path}.raceStatModifiersByAcquisitionMode.alternatives`,
      expectedRaceChoice,
      statLabels,
    );
    if (!alternatives.ok) return alternatives;
    const depends = decodeProjection(
      raceModifiersByMode,
      `${path}.raceStatModifiersByAcquisitionMode`,
      {
        alternatives: (field) => field === raceModifiersByMode['alternatives'],
        kind: (field) => field === 'DEPENDS_ON_SYMBIONT_ACQUISITION_MODE',
      },
    );
    if (!depends.ok) return depends;
    for (const [index, alternative] of alternatives.value.entries()) {
      if (
        alternative.modeConsequences.raceLabel !== value['raceLabel'] ||
        alternative.modeConsequences.baseSymbiontSlots !== value['baseSymbiontSlots']
      ) {
        return unrecognized(
          `${path}.raceStatModifiersByAcquisitionMode.alternatives[${String(index)}].modeConsequences`,
          alternative.modeConsequences,
        );
      }
    }
  }
  const expectedClassPolicy = expectedRaceChoice === 'PURE' ? 'REQUIRED_PURE_CLASS' : 'NO_CLASS';
  const expectedXpPolicy = expectedRaceChoice === 'FREE' ? 'XP_AWARD_X2' : 'STANDARD_XP_AWARD';
  const shape = decodeProjection(value, path, {
    allocationXpMultiplier: isPositiveSafeInteger,
    baseSymbiontSlots: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    classPolicy: (field) => field === expectedClassPolicy,
    directXpMultiplier: isPositiveSafeInteger,
    grantedSkills: (field) => field === grantedSkills,
    raceLabel: (field) => typeof field === 'string' && field.trim().length > 0,
    raceStatModifiersByAcquisitionMode: (field) => field === raceModifiersByMode,
    symbiontXpPolicy: (field) => field === expectedXpPolicy,
    symbioticMonsterAllowed: (field) => typeof field === 'boolean',
  });
  return shape.ok ? { ok: true, value: value as RaceConsequencesPreviewProjection } : shape;
}

export function decodeRaceConsequenceOptions(
  value: JsonValue,
  path: string,
): DecodeResult<readonly RaceConsequenceOptionProjection[]> {
  if (!Array.isArray(value) || value.length !== 3) return unrecognized(path, value);
  const expectedRaceChoices = ['UNITED', 'FREE', 'PURE'] as const;
  const options = value as readonly JsonValue[];
  const statLabels = new Map<StatCode, string>();
  for (const [index, option] of options.entries()) {
    const optionPath = `${path}[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const raceChoice = expectedRaceChoices[index]!;
    if (option['raceChoice'] !== raceChoice) {
      return unrecognized(`${optionPath}.raceChoice`, option['raceChoice']!);
    }
    const consequences = decodeRaceConsequencesPreview(
      option['raceConsequencesPreview']!,
      `${optionPath}.raceConsequencesPreview`,
      raceChoice,
      statLabels,
    );
    if (!consequences.ok) return consequences;
    const shape = decodeProjection(option, optionPath, {
      raceChoice: (field) => field === raceChoice,
      raceConsequencesPreview: (field) => field === option['raceConsequencesPreview'],
    });
    if (!shape.ok) return shape;
  }
  return {
    ok: true,
    value: value as unknown as readonly RaceConsequenceOptionProjection[],
  };
}

function decodeMethodTerminalRule(
  value: JsonValue,
  path: string,
  method: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC',
  maximumAttempts: number,
): DecodeResult<MethodTerminalRuleProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  if (method === 'ALL_OR_NOTHING') {
    const shape = decodeProjection(value, path, {
      attemptIndex: (field) => isPositiveSafeInteger(field) && field === maximumAttempts,
      kind: (field) => field === 'MANDATORY_ACCEPT',
    });
    return shape.ok ? { ok: true, value: value as MethodTerminalRuleProjection } : shape;
  }
  const shape = decodeProjection(value, path, {
    afterAttempt: (field) => isPositiveSafeInteger(field) && field === maximumAttempts,
    exactTotal: isPositiveSafeInteger,
    kind: (field) => field === 'POINT_BUY_AFTER_REJECTION',
  });
  return shape.ok ? { ok: true, value: value as MethodTerminalRuleProjection } : shape;
}

function decodeMethodConsequences(
  value: JsonValue,
  path: string,
  method: 'ADVENTUROUS' | 'ALL_OR_NOTHING' | 'CLASSIC',
): DecodeResult<MethodConsequencesProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const maximumAttempts = value['maximumAttempts'];
  if (!isPositiveSafeInteger(maximumAttempts!)) {
    return unrecognized(`${path}.maximumAttempts`, maximumAttempts!);
  }
  const rejectedSet = value['rejectedSet'];
  if (!isJsonObject(rejectedSet)) return unrecognized(`${path}.rejectedSet`, rejectedSet!);
  const rejectedShape = decodeProjection(rejectedSet, `${path}.rejectedSet`, {
    creationCriticalConsequencesDiscarded: (field) => field === true,
    irreversible: (field) => field === true,
    setValuesDiscarded: (field) => field === true,
  });
  if (!rejectedShape.ok) return rejectedShape;
  const terminal = decodeMethodTerminalRule(
    value['terminalRule']!,
    `${path}.terminalRule`,
    method,
    maximumAttempts,
  );
  if (!terminal.ok) return terminal;
  const shape = decodeProjection(value, path, {
    maximumAttempts: (field) => field === maximumAttempts,
    rejectedSet: (field) => field === rejectedSet,
    terminalRule: (field) => field === value['terminalRule'],
  });
  return shape.ok ? { ok: true, value: value as MethodConsequencesProjection } : shape;
}

function decodeMethodConsequenceOptions(
  value: JsonValue,
  path: string,
): DecodeResult<readonly MethodConsequenceOptionProjection[]> {
  if (!Array.isArray(value) || value.length !== 3) return unrecognized(path, value);
  const expectedMethods = ['CLASSIC', 'ADVENTUROUS', 'ALL_OR_NOTHING'] as const;
  const options = value as readonly JsonValue[];
  for (const [index, option] of options.entries()) {
    const optionPath = `${path}[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const method = expectedMethods[index]!;
    if (option['statMethod'] !== method) {
      return unrecognized(`${optionPath}.statMethod`, option['statMethod']!);
    }
    const consequences = decodeMethodConsequences(
      option['methodConsequences']!,
      `${optionPath}.methodConsequences`,
      method,
    );
    if (!consequences.ok) return consequences;
    const shape = decodeProjection(option, optionPath, {
      methodConsequences: (field) => field === option['methodConsequences'],
      statMethod: (field) => field === method,
    });
    if (!shape.ok) return shape;
  }
  return {
    ok: true,
    value: value as unknown as readonly MethodConsequenceOptionProjection[],
  };
}

function decodeChr010Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const options = decodeRaceConsequenceOptions(
    value['raceConsequenceOptions']!,
    `${path}.raceConsequenceOptions`,
  );
  if (!options.ok) return options;
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    ancientOptionSerialized: (field) => field === false,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    choiceLockStatus: (field) => field === 'UNLOCKED',
    commandId: (field) => field === null,
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    raceConsequenceOptions: (field) => field === value['raceConsequenceOptions'],
    raceChoice: (field) => field === null,
    raceConsequencesPreview: (field) => field === null,
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function decodeChr016Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const raceChoice = value['raceChoice'];
  if (raceChoice !== 'FREE' && raceChoice !== 'UNITED') {
    return unrecognized(`${path}.raceChoice`, raceChoice!);
  }
  const options = decodeModeConsequenceOptions(
    value['modeConsequenceOptions']!,
    `${path}.modeConsequenceOptions`,
    raceChoice,
    new Map<StatCode, string>(),
  );
  if (!options.ok) return options;
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    choiceLockStatus: (field) => field === 'UNLOCKED',
    commandId: (field) => field === null,
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    modeConsequences: (field) => field === null,
    modeConsequenceOptions: (field) => field === value['modeConsequenceOptions'],
    raceChoice: (field) => field === raceChoice,
    symbiontAcquisitionMode: (field) => field === null,
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function decodeChr036Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    appliesToAllCreationRolls: (field) => field === true,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    choiceLockStatus: (field) => field === 'UNLOCKED',
    commandId: (field) => field === null,
    diceInputMode: (field) => field === null,
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function decodeChr002Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const options = decodeMethodConsequenceOptions(
    value['methodConsequenceOptions']!,
    `${path}.methodConsequenceOptions`,
  );
  if (!options.ok) return options;
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    choiceLockStatus: (field) => field === 'UNLOCKED',
    commandId: (field) => field === null,
    draftRevision: (field) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    methodConsequences: (field) => field === null,
    methodConsequenceOptions: (field) => field === value['methodConsequenceOptions'],
    statMethod: (field) => field === null,
    wizardCheckpointId: (field) =>
      typeof field === 'string' &&
      field.trim().length > 0 &&
      field !== 'NONE' &&
      field !== ZERO_UUID &&
      field !== characterDraftId,
  });
}

function decodeStatMap<T extends JsonValue>(
  value: JsonValue,
  path: string,
  validValue: (entry: JsonValue) => entry is T,
): DecodeResult<StatMap<T>> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const keys = exactObjectKeys(value, new Set(STAT_CODES), path);
  if (!keys.ok) return keys;
  for (const statCode of STAT_CODES) {
    const entry = value[statCode];
    if (entry === undefined || !validValue(entry)) {
      return unrecognized(`${path}.${statCode}`, entry ?? null);
    }
  }
  return { ok: true, value: value as StatMap<T> };
}

function decodeStatModifiers(
  value: JsonValue,
  path: string,
): DecodeResult<readonly StatModifierProjection[]> {
  if (!Array.isArray(value)) return unrecognized(path, value);
  const entries = value as readonly JsonValue[];
  const seen = new Set<StatCode>();
  for (const [index, entry] of entries.entries()) {
    const itemPath = `${path}[${String(index)}]`;
    if (!isJsonObject(entry)) return unrecognized(itemPath, entry);
    const keys = exactObjectKeys(entry, new Set(['delta', 'statCode']), itemPath);
    if (!keys.ok) return keys;
    const statCode = entry['statCode'];
    const delta = entry['delta'];
    if (
      typeof statCode !== 'string' ||
      !STAT_CODES.includes(statCode as StatCode) ||
      seen.has(statCode as StatCode)
    ) {
      return unrecognized(`${itemPath}.statCode`, statCode!);
    }
    if (typeof delta !== 'number' || !Number.isSafeInteger(delta) || delta === 0) {
      return unrecognized(`${itemPath}.delta`, delta!);
    }
    seen.add(statCode as StatCode);
  }
  return { ok: true, value: value as unknown as readonly StatModifierProjection[] };
}

function decodeMandatoryClassSkill(
  value: JsonValue,
  path: string,
): DecodeResult<MandatoryClassSkillProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const decoded = decodeProjection(value, path, {
    bonus: (field) => typeof field === 'number' && Number.isSafeInteger(field),
    skillKey: isNonEmptyString,
    slotCost: (field) => isSafeIntegerAtLeast(field, 0),
  });
  return decoded.ok ? { ok: true, value: value as MandatoryClassSkillProjection } : decoded;
}

function decodeChr009Proof(
  value: JsonValue,
  path: string,
  mode: StatAssignmentMode,
): DecodeResult<ExactSumProof | RolledBijectionProof> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  if (mode !== 'ROLLED_BIJECTION') {
    const decoded = decodeProjection(value, path, {
      actualTotal: (field) => field === null,
      kind: (field) => field === 'EXACT_SUM',
      requiredTotal: (field) => field === (mode === 'POINT_BUY_90' ? 90 : 85),
    });
    return decoded.ok ? { ok: true, value: value as ExactSumProof } : decoded;
  }
  const sourceEntries = value['sourceEntries'];
  if (!Array.isArray(sourceEntries) || sourceEntries.length !== STAT_CODES.length) {
    return unrecognized(`${path}.sourceEntries`, sourceEntries!);
  }
  const entries = sourceEntries as readonly JsonValue[];
  for (const [index, entry] of entries.entries()) {
    const itemPath = `${path}.sourceEntries[${String(index)}]`;
    if (!isJsonObject(entry)) return unrecognized(itemPath, entry);
    const decoded = decodeProjection(entry, itemPath, {
      creationCriticalPenaltyOrNull: (field) =>
        field === null ||
        (typeof field === 'number' && Number.isSafeInteger(field) && field <= -1 && field >= -5),
      setEntryIndex: (field) => field === index,
      value: (field) => typeof field === 'number' && Number.isSafeInteger(field),
    });
    if (!decoded.ok) return decoded;
  }
  const decoded = decodeProjection(value, path, {
    assignedSetEntryIndexByStat: (field) => field === null,
    kind: (field) => field === 'ROLLED_BIJECTION',
    sourceEntries: (field) => field === sourceEntries,
  });
  return decoded.ok ? { ok: true, value: value as unknown as RolledBijectionProof } : decoded;
}

function decodeChr009Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const mode = value['assignmentMode'];
  if (mode !== 'ROLLED_BIJECTION' && mode !== 'POINT_BUY_90' && mode !== 'POINT_BUY_85') {
    return unrecognized(`${path}.assignmentMode`, mode!);
  }
  const proof = decodeChr009Proof(
    value['bijectionProofOrExactSum']!,
    `${path}.bijectionProofOrExactSum`,
    mode,
  );
  if (!proof.ok) return proof;
  const characterDraftId = value['characterDraftId'];
  const result = decodeProjection(value, path, {
    C: (field) => field === null,
    D: (field) => field === null,
    I: (field) => field === null,
    M: (field) => field === null,
    S: (field) => field === null,
    W: (field) => field === null,
    Z: (field) => field === null,
    assignmentMode: (field) => field === mode,
    assignmentValidation: (field) => field === null,
    bijectionProofOrExactSum: (field) => field === value['bijectionProofOrExactSum'],
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    eachValueRange: (field) =>
      mode === 'ROLLED_BIJECTION'
        ? field === null
        : isJsonObject(field) && sameJson(field, { maximum: 20, minimum: 1 }),
    raceChoice: (field) => field === 'FREE' || field === 'PURE' || field === 'UNITED',
    sourceSetReceiptIdOrNull: (field) =>
      mode === 'ROLLED_BIJECTION' ? isNonEmptyString(field) : field === null,
    wizardCheckpointId: (field) => isNonEmptyString(field) && field !== characterDraftId,
  });
  if (!result.ok) return result;
  const ids = [
    characterDraftId,
    value['wizardCheckpointId'],
    value['sourceSetReceiptIdOrNull'],
  ].filter((entry): entry is string => typeof entry === 'string');
  return new Set(ids).size === ids.length
    ? result
    : unrecognized(`${path}.sourceSetReceiptIdOrNull`, value['sourceSetReceiptIdOrNull']!);
}

function decodeChr011Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const options = value['classOptions'];
  if (!Array.isArray(options) || options.length !== PURE_CLASSES.length) {
    return unrecognized(`${path}.classOptions`, options!);
  }
  const entries = options as readonly JsonValue[];
  const skillKeys = new Set<string>();
  for (const [index, option] of entries.entries()) {
    const optionPath = `${path}.classOptions[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const consequences = option['classConsequences'];
    if (!isJsonObject(consequences)) {
      return unrecognized(`${optionPath}.classConsequences`, consequences!);
    }
    const consequenceShape = decodeProjection(consequences, `${optionPath}.classConsequences`, {
      statModifiers: (field) => field === consequences['statModifiers'],
    });
    if (!consequenceShape.ok) return consequenceShape;
    const modifiers = decodeStatModifiers(
      consequences['statModifiers']!,
      `${optionPath}.classConsequences.statModifiers`,
    );
    if (!modifiers.ok) return modifiers;
    const mandatory = decodeMandatoryClassSkill(
      option['mandatoryClassSkill']!,
      `${optionPath}.mandatoryClassSkill`,
    );
    if (!mandatory.ok) return mandatory;
    if (skillKeys.has(mandatory.value.skillKey)) {
      return unrecognized(`${optionPath}.mandatoryClassSkill.skillKey`, mandatory.value.skillKey);
    }
    skillKeys.add(mandatory.value.skillKey);
    const optionShape = decodeProjection(option, optionPath, {
      classConsequences: (field) => field === consequences,
      mandatoryClassSkill: (field) => field === option['mandatoryClassSkill'],
      pureClass: (field) => field === PURE_CLASSES[index],
    });
    if (!optionShape.ok) return optionShape;
  }
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    classConsequences: (field) => field === null,
    classOptions: (field) => field === value['classOptions'],
    commandId: (field) => field === null,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    mandatoryClassSkill: (field) => field === null,
    pureClass: (field) => field === null,
    raceChoice: (field) => field === 'PURE',
    wizardCheckpointId: (field) => isNonEmptyString(field) && field !== characterDraftId,
  });
}

function decodeChr012Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const integer = (entry: JsonValue): entry is number =>
    typeof entry === 'number' && Number.isSafeInteger(entry);
  const base = decodeStatMap(value['baseStats']!, `${path}.baseStats`, integer);
  if (!base.ok) return base;
  const skill = decodeStatMap(value['skillStageStats']!, `${path}.skillStageStats`, integer);
  if (!skill.ok) return skill;
  const race = decodeStatModifiers(value['raceModifiers']!, `${path}.raceModifiers`);
  if (!race.ok) return race;
  const classValue = value['classModifiersOrNull'];
  let classModifiers: readonly StatModifierProjection[] = [];
  if (classValue !== null) {
    const decodedClassModifiers = decodeStatModifiers(classValue!, `${path}.classModifiersOrNull`);
    if (!decodedClassModifiers.ok) return decodedClassModifiers;
    classModifiers = decodedClassModifiers.value;
  }
  const mandatory = value['mandatoryClassSkillOrNull'];
  let mandatorySkill: MandatoryClassSkillProjection | null = null;
  if (mandatory !== null) {
    const decodedMandatory = decodeMandatoryClassSkill(
      mandatory!,
      `${path}.mandatoryClassSkillOrNull`,
    );
    if (!decodedMandatory.ok) return decodedMandatory;
    mandatorySkill = decodedMandatory.value;
  }
  if (
    (classValue === null) !== (mandatorySkill === null) ||
    (classValue !== null && race.value.length !== 0)
  ) {
    return unrecognized(`${path}.classModifiersOrNull`, classValue!);
  }
  for (const statCode of STAT_CODES) {
    const modifierTotal = [...race.value, ...classModifiers]
      .filter((modifier) => modifier.statCode === statCode)
      .reduce((total, modifier) => total + modifier.delta, 0);
    if (skill.value[statCode] !== base.value[statCode] + modifierTotal) {
      return unrecognized(`${path}.skillStageStats.${statCode}`, skill.value[statCode]);
    }
  }
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    baseStats: (field) => field === value['baseStats'],
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    classModifiersOrNull: (field) => field === classValue,
    commandId: (field) => field === null,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    mandatoryClassSkillOrNull: (field) => field === mandatory,
    raceModifiers: (field) => field === value['raceModifiers'],
    skillStageStats: (field) => field === value['skillStageStats'],
    symbiontModifiersExcluded: (field) => field === true,
    wizardCheckpointId: (field) => isNonEmptyString(field) && field !== characterDraftId,
  });
}

function isPublicSkillId(value: JsonValue): value is string {
  return isNonEmptyString(value) && !/^(?:CORE|Q|REQ|SKL)-/u.test(value);
}

function decodeSkillLevelOptions(
  value: JsonValue,
  path: string,
): DecodeResult<readonly SkillLevelOptionProjection[]> {
  if (!Array.isArray(value)) return unrecognized(path, value);
  for (const [index, option] of (value as readonly JsonValue[]).entries()) {
    const optionPath = `${path}[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const decoded = decodeProjection(option, optionPath, {
      slotCost: (field) => isSafeIntegerAtLeast(field, 1),
      targetBonus: (field) => field === index + 1,
    });
    if (!decoded.ok) return decoded;
    if (index > 0) {
      const previous = value[index - 1] as JsonObject;
      if ((option['slotCost'] as number) < (previous['slotCost'] as number)) {
        return unrecognized(`${optionPath}.slotCost`, option['slotCost']!);
      }
    }
  }
  return { ok: true, value: value as unknown as readonly SkillLevelOptionProjection[] };
}

function decodeFixedSkill(
  value: JsonValue,
  path: string,
  expectedSlotCost: 0 | 1,
): DecodeResult<FixedSkillProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const decoded = decodeProjection(value, path, {
    bonus: (field) => isSafeIntegerAtLeast(field, 1),
    skillId: isPublicSkillId,
    skillLabel: isNonEmptyString,
    slotCost: (field) => field === expectedSlotCost,
  });
  return decoded.ok ? { ok: true, value: value as FixedSkillProjection } : decoded;
}

function decodeRacialFreeSkills(
  value: JsonValue,
  path: string,
): DecodeResult<readonly FixedSkillProjection[]> {
  if (!Array.isArray(value) || value.length > 1) return unrecognized(path, value);
  for (const [index, skill] of (value as readonly JsonValue[]).entries()) {
    const decoded = decodeFixedSkill(skill, `${path}[${String(index)}]`, 0);
    if (!decoded.ok) return decoded;
  }
  return { ok: true, value: value as unknown as readonly FixedSkillProjection[] };
}

function decodeMissingSkillPenalty(
  value: JsonValue,
  path: string,
): DecodeResult<MissingSkillPenaltyProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  if (value['kind'] === 'NO_MISSING_SKILL_PENALTY') {
    const decoded = decodeProjection(value, path, {
      kind: (field) => field === 'NO_MISSING_SKILL_PENALTY',
    });
    return decoded.ok ? { ok: true, value: value as MissingSkillPenaltyProjection } : decoded;
  }
  if (value['kind'] === 'MISSING_SKILL_PENALTY') {
    const decoded = decodeProjection(value, path, {
      kind: (field) => field === 'MISSING_SKILL_PENALTY',
      value: (field) => typeof field === 'number' && Number.isSafeInteger(field),
    });
    return decoded.ok ? { ok: true, value: value as MissingSkillPenaltyProjection } : decoded;
  }
  return unrecognized(`${path}.kind`, value['kind']!);
}

function decodeSkillRequirements(
  value: JsonValue,
  path: string,
  skillStageStats: StatMap<number>,
  statLabels: Map<StatCode, string> = new Map(),
): DecodeResult<readonly SkillRequirementProjection[]> {
  if (!Array.isArray(value) || value.length === 0) return unrecognized(path, value);
  let previousStatOrder = -1;
  for (const [index, requirement] of (value as readonly JsonValue[]).entries()) {
    const requirementPath = `${path}[${String(index)}]`;
    if (!isJsonObject(requirement)) return unrecognized(requirementPath, requirement);
    const decoded = decodeProjection(requirement, requirementPath, {
      currentValue: (field) => typeof field === 'number' && Number.isSafeInteger(field),
      minValue: (field) => isSafeIntegerAtLeast(field, 1),
      satisfied: (field) => typeof field === 'boolean',
      statCode: (field) => typeof field === 'string' && STAT_CODES.includes(field as StatCode),
      statLabel: isNonEmptyString,
    });
    if (!decoded.ok) return decoded;
    const statCode = requirement['statCode'] as StatCode;
    const order = STAT_CODES.indexOf(statCode);
    const statLabel = requirement['statLabel'] as string;
    if (order <= previousStatOrder || requirement['currentValue'] !== skillStageStats[statCode]) {
      return unrecognized(`${requirementPath}.statCode`, statCode);
    }
    const previousLabel = statLabels.get(statCode);
    if (previousLabel !== undefined && previousLabel !== statLabel) {
      return unrecognized(`${requirementPath}.statLabel`, statLabel);
    }
    previousStatOrder = order;
    statLabels.set(statCode, statLabel);
    const currentValue = requirement['currentValue'];
    const minValue = requirement['minValue'];
    if (typeof currentValue !== 'number' || typeof minValue !== 'number') {
      return unrecognized(requirementPath, requirement);
    }
    if (requirement['satisfied'] !== currentValue >= minValue) {
      return unrecognized(`${requirementPath}.satisfied`, requirement['satisfied']!);
    }
  }
  return { ok: true, value: value as unknown as readonly SkillRequirementProjection[] };
}

function decodeSkillCardSummaries(
  value: JsonValue,
  path: string,
  skillStageStats: StatMap<number>,
): DecodeResult<readonly SkillCardSummaryProjection[]> {
  if (!Array.isArray(value) || value.length !== 41) return unrecognized(path, value);
  const ids = new Set<string>();
  const statLabels = new Map<StatCode, string>();
  let missingSkillPenaltyCount = 0;
  for (const [index, card] of (value as readonly JsonValue[]).entries()) {
    const cardPath = `${path}[${String(index)}]`;
    if (!isJsonObject(card)) return unrecognized(cardPath, card);
    const skillId = card['skillId'];
    if (!isPublicSkillId(skillId!) || ids.has(skillId)) {
      return unrecognized(`${cardPath}.skillId`, skillId!);
    }
    ids.add(skillId);
    const levels = decodeSkillLevelOptions(card['levelOptions']!, `${cardPath}.levelOptions`);
    if (!levels.ok) return levels;
    const missingSkillPenalty = decodeMissingSkillPenalty(
      card['missingSkillPenalty']!,
      `${cardPath}.missingSkillPenalty`,
    );
    if (!missingSkillPenalty.ok) return missingSkillPenalty;
    if (missingSkillPenalty.value.kind === 'MISSING_SKILL_PENALTY') {
      missingSkillPenaltyCount += 1;
    }
    const requirements = decodeSkillRequirements(
      card['requirements']!,
      `${cardPath}.requirements`,
      skillStageStats,
      statLabels,
    );
    if (!requirements.ok) return requirements;
    const eligibility = card['eligibility'];
    const expectedEligibility = requirements.value.every(({ satisfied }) => satisfied)
      ? 'ELIGIBLE'
      : 'REQUIREMENTS_NOT_MET';
    const decoded = decodeProjection(card, cardPath, {
      bonusDomainScope: isNonEmptyString,
      eligibility: (field) => field === expectedEligibility,
      levelOptions: (field) => field === card['levelOptions'],
      missingSkillPenalty: (field) => field === card['missingSkillPenalty'],
      requirements: (field) => field === requirements.value,
      skillId: (field) => field === skillId,
      skillLabel: isNonEmptyString,
    });
    if (!decoded.ok) return decoded;
    if (eligibility !== expectedEligibility) {
      return unrecognized(`${cardPath}.eligibility`, eligibility!);
    }
  }
  if (missingSkillPenaltyCount !== 15) return unrecognized(path, value);
  return { ok: true, value: value as unknown as readonly SkillCardSummaryProjection[] };
}

function decodeChr013Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const integer = (entry: JsonValue): entry is number =>
    typeof entry === 'number' && Number.isSafeInteger(entry);
  const stats = decodeStatMap(value['skillStageStats']!, `${path}.skillStageStats`, integer);
  if (!stats.ok) return stats;
  const cards = decodeSkillCardSummaries(
    value['skillCardSummaries']!,
    `${path}.skillCardSummaries`,
    stats.value,
  );
  if (!cards.ok) return cards;
  const expectedEligibleIds = cards.value
    .filter(({ eligibility }) => eligibility === 'ELIGIBLE')
    .map(({ skillId }) => skillId);
  if (!sameJson(value['eligibleSkillIds']!, expectedEligibleIds)) {
    return unrecognized(`${path}.eligibleSkillIds`, value['eligibleSkillIds']!);
  }
  const slotSources = value['slotSources'];
  if (!isJsonObject(slotSources)) return unrecognized(`${path}.slotSources`, slotSources!);
  const mandatoryValue = slotSources['mandatoryClassSkillOrNull'];
  if (mandatoryValue !== null) {
    const mandatory = decodeFixedSkill(
      mandatoryValue!,
      `${path}.slotSources.mandatoryClassSkillOrNull`,
      1,
    );
    if (!mandatory.ok) return mandatory;
    if (expectedEligibleIds.includes(mandatory.value.skillId)) {
      return unrecognized(
        `${path}.slotSources.mandatoryClassSkillOrNull.skillId`,
        mandatory.value.skillId,
      );
    }
  }
  const racial = decodeRacialFreeSkills(
    slotSources['racialFreeSkills']!,
    `${path}.slotSources.racialFreeSkills`,
  );
  if (!racial.ok) return racial;
  if (mandatoryValue !== null && racial.value.length !== 0) {
    return unrecognized(`${path}.slotSources.racialFreeSkills`, slotSources['racialFreeSkills']!);
  }
  const fixedIds = [
    ...(mandatoryValue === null ? [] : [(mandatoryValue as FixedSkillProjection).skillId]),
    ...racial.value.map(({ skillId }) => skillId),
  ];
  if (fixedIds.some((skillId) => cards.value.some((card) => card.skillId === skillId))) {
    return unrecognized(`${path}.slotSources.racialFreeSkills`, slotSources['racialFreeSkills']!);
  }
  const decodedSlotSources = decodeProjection(slotSources, `${path}.slotSources`, {
    mandatoryClassSkillOrNull: (field) => field === mandatoryValue,
    racialFreeSkills: (field) => field === slotSources['racialFreeSkills'],
    requiredSlotCount: (field) => isSafeIntegerAtLeast(field, 1),
  });
  if (!decodedSlotSources.ok) return decodedSlotSources;
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    eligibleSkillIds: (field) => field === value['eligibleSkillIds'],
    selectedSkillIdOrNull: (field) => field === null,
    skillCardSummaries: (field) => field === value['skillCardSummaries'],
    skillStageStats: (field) => field === value['skillStageStats'],
    slotSources: (field) => field === slotSources,
    wizardCheckpointId: (field) => isNonEmptyString(field) && field !== characterDraftId,
  });
}

function decodeChr014SlotSources(
  value: JsonValue,
  path: string,
  eligibleSkillIds: readonly string[],
): DecodeResult<SkillSlotSourcesProjection> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const mandatoryValue = value['mandatoryClassSkillOrNull'];
  if (mandatoryValue !== null) {
    const mandatory = decodeFixedSkill(mandatoryValue!, `${path}.mandatoryClassSkillOrNull`, 1);
    if (!mandatory.ok) return mandatory;
    if (eligibleSkillIds.includes(mandatory.value.skillId)) {
      return unrecognized(`${path}.mandatoryClassSkillOrNull.skillId`, mandatory.value.skillId);
    }
  }
  const racial = decodeRacialFreeSkills(value['racialFreeSkills']!, `${path}.racialFreeSkills`);
  if (!racial.ok) return racial;
  if (
    (mandatoryValue !== null && racial.value.length !== 0) ||
    racial.value.some(({ skillId }) => eligibleSkillIds.includes(skillId))
  ) {
    return unrecognized(`${path}.racialFreeSkills`, value['racialFreeSkills']!);
  }
  const decoded = decodeProjection(value, path, {
    mandatoryClassSkillOrNull: (field) => field === mandatoryValue,
    racialFreeSkills: (field) => field === value['racialFreeSkills'],
    requiredSlotCount: (field) => isSafeIntegerAtLeast(field, 1),
  });
  return decoded.ok ? { ok: true, value: value as SkillSlotSourcesProjection } : decoded;
}

function decodeChr014Projection(
  value: JsonObject,
  path: string,
  characterRouteBinding: JsonValue | undefined,
  skillRouteBinding: JsonValue | undefined,
): DecodeResult<Chr014Projection> {
  const integer = (entry: JsonValue): entry is number =>
    typeof entry === 'number' && Number.isSafeInteger(entry);
  const stats = decodeStatMap(value['skillStageValues']!, `${path}.skillStageValues`, integer);
  if (!stats.ok) return stats;
  const requirements = decodeSkillRequirements(
    value['requirements']!,
    `${path}.requirements`,
    stats.value,
  );
  if (!requirements.ok) return requirements;
  const expectedEligibility = requirements.value.every(({ satisfied }) => satisfied)
    ? 'ELIGIBLE'
    : 'INELIGIBLE_READ_ONLY';
  const eligibleValue = value['eligibleSkillIds'];
  if (!Array.isArray(eligibleValue))
    return unrecognized(`${path}.eligibleSkillIds`, eligibleValue!);
  const eligibleSkillIds: string[] = [];
  for (const [index, skillId] of (eligibleValue as readonly JsonValue[]).entries()) {
    if (!isPublicSkillId(skillId) || eligibleSkillIds.includes(skillId)) {
      return unrecognized(`${path}.eligibleSkillIds[${String(index)}]`, skillId);
    }
    eligibleSkillIds.push(skillId);
  }
  const skillId = value['skillId'];
  if (
    !isPublicSkillId(skillId!) ||
    skillId !== skillRouteBinding ||
    (expectedEligibility === 'ELIGIBLE' && !eligibleSkillIds.includes(skillId))
  ) {
    return unrecognized(`${path}.skillId`, skillId!);
  }
  const levels = decodeSkillLevelOptions(value['levelsAndBonuses']!, `${path}.levelsAndBonuses`);
  if (!levels.ok) return levels;
  const slotSources = decodeChr014SlotSources(
    value['slotSources']!,
    `${path}.slotSources`,
    eligibleSkillIds,
  );
  if (!slotSources.ok) return slotSources;
  const availableSlotCount =
    slotSources.value.requiredSlotCount -
    (slotSources.value.mandatoryClassSkillOrNull?.slotCost ?? 0);
  const selectedValue = value['selectedSkills'];
  if (!Array.isArray(selectedValue)) return unrecognized(`${path}.selectedSkills`, selectedValue!);
  const selectedSkills: SelectedSkillProjection[] = [];
  let previousOptionIndex = -1;
  for (const [index, selected] of (selectedValue as readonly JsonValue[]).entries()) {
    const selectedPath = `${path}.selectedSkills[${String(index)}]`;
    if (!isJsonObject(selected)) return unrecognized(selectedPath, selected);
    const selectedId = selected['skillId'];
    const optionIndex = typeof selectedId === 'string' ? eligibleSkillIds.indexOf(selectedId) : -1;
    const targetBonus = selected['targetBonus'];
    if (
      optionIndex <= previousOptionIndex ||
      typeof targetBonus !== 'number' ||
      !isSafeIntegerAtLeast(targetBonus, 1) ||
      calculateSkillSlotCost(targetBonus) > availableSlotCount
    ) {
      return unrecognized(selectedPath, selected);
    }
    const decoded = decodeProjection(selected, selectedPath, {
      skillId: (field) => field === selectedId,
      slotCost: (field) => field === calculateSkillSlotCost(targetBonus),
      targetBonus: (field) => field === targetBonus,
    });
    if (!decoded.ok) return decoded;
    selectedSkills.push(selected as unknown as SelectedSkillProjection);
    previousOptionIndex = optionIndex;
  }
  const fixedIds = [
    ...(slotSources.value.mandatoryClassSkillOrNull === null
      ? []
      : [slotSources.value.mandatoryClassSkillOrNull.skillId]),
    ...slotSources.value.racialFreeSkills.map(({ skillId: fixedId }) => fixedId),
  ];
  if (
    fixedIds.includes(skillId) ||
    selectedSkills.some((entry) => fixedIds.includes(entry.skillId))
  ) {
    return unrecognized(`${path}.slotSources`, value['slotSources']!);
  }
  const usedSlotCount =
    (slotSources.value.mandatoryClassSkillOrNull?.slotCost ?? 0) +
    selectedSkills.reduce((total, entry) => total + entry.slotCost, 0);
  const remainingSlots = slotSources.value.requiredSlotCount - usedSlotCount;
  if (remainingSlots < 0 || levels.value.some(({ slotCost }) => slotCost > remainingSlots)) {
    return unrecognized(`${path}.levelsAndBonuses`, value['levelsAndBonuses']!);
  }
  const freeSources = value['freeSources'];
  if (!isJsonObject(freeSources)) return unrecognized(`${path}.freeSources`, freeSources!);
  const decodedFreeSources = decodeProjection(freeSources, `${path}.freeSources`, {
    kind: (field) => field === 'NO_FREE_SOURCE',
  });
  if (!decodedFreeSources.ok) return decodedFreeSources;
  const missingSkillPenalty = decodeMissingSkillPenalty(
    value['missingSkillPenalty']!,
    `${path}.missingSkillPenalty`,
  );
  if (!missingSkillPenalty.ok) return missingSkillPenalty;
  const characterDraftId = value['characterDraftId'];
  const decoded = decodeProjection(value, path, {
    bonusDomainScope: isNonEmptyString,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === characterRouteBinding,
    eligibility: (field) => field === expectedEligibility,
    eligibleSkillIds: (field) => field === eligibleValue,
    freeSources: (field) => field === freeSources,
    levelsAndBonuses: (field) => field === value['levelsAndBonuses'],
    missingSkillPenalty: (field) => field === value['missingSkillPenalty'],
    requirements: (field) => field === requirements.value,
    selectedSkills: (field) => field === selectedValue,
    selectionRevision: (field) => isSafeIntegerAtLeast(field, 0),
    skillId: (field) => field === skillId,
    skillLabel: isNonEmptyString,
    skillStageValues: (field) => field === value['skillStageValues'],
    slotCost: (field) => field === null,
    slotSources: (field) => field === value['slotSources'],
    wizardCheckpointId: (field) => isNonEmptyString(field) && field !== characterDraftId,
  });
  return decoded.ok ? { ok: true, value: value as Chr014Projection } : decoded;
}

function skillSelectionValidation(
  requiredSlotCount: number,
  usedSlotCount: number,
): SkillSelectionValidation {
  if (usedSlotCount < requiredSlotCount) {
    return {
      kind: 'UNDERFILLED',
      missingSlotCount: requiredSlotCount - usedSlotCount,
      requiredSlotCount,
      usedSlotCount,
    };
  }
  if (usedSlotCount > requiredSlotCount) {
    return {
      excessSlotCount: usedSlotCount - requiredSlotCount,
      kind: 'OVERFILLED',
      requiredSlotCount,
      usedSlotCount,
    };
  }
  return { kind: 'EXACT', requiredSlotCount, usedSlotCount };
}

function decodeSkillOptions(
  value: JsonValue,
  path: string,
): DecodeResult<readonly SkillOptionProjection[]> {
  if (!Array.isArray(value)) return unrecognized(path, value);
  const ids = new Set<string>();
  for (const [index, option] of (value as readonly JsonValue[]).entries()) {
    const optionPath = `${path}[${String(index)}]`;
    if (!isJsonObject(option)) return unrecognized(optionPath, option);
    const skillId = option['skillId'];
    if (!isPublicSkillId(skillId!) || ids.has(skillId)) {
      return unrecognized(`${optionPath}.skillId`, skillId!);
    }
    ids.add(skillId);
    const levels = decodeSkillLevelOptions(option['levelOptions']!, `${optionPath}.levelOptions`);
    if (!levels.ok) return levels;
    const missingSkillPenalty = decodeMissingSkillPenalty(
      option['missingSkillPenalty']!,
      `${optionPath}.missingSkillPenalty`,
    );
    if (!missingSkillPenalty.ok) return missingSkillPenalty;
    const decoded = decodeProjection(option, optionPath, {
      bonusDomainScope: isNonEmptyString,
      levelOptions: (field) => field === option['levelOptions'],
      missingSkillPenalty: (field) => field === option['missingSkillPenalty'],
      skillId: (field) => field === skillId,
      skillLabel: isNonEmptyString,
    });
    if (!decoded.ok) return decoded;
  }
  return { ok: true, value: value as unknown as readonly SkillOptionProjection[] };
}

function decodeChr015Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const requiredSlotCount = value['requiredSlotCount'];
  if (!isSafeIntegerAtLeast(requiredSlotCount!, 1)) {
    return unrecognized(`${path}.requiredSlotCount`, requiredSlotCount!);
  }
  const options = decodeSkillOptions(value['skillOptions']!, `${path}.skillOptions`);
  if (!options.ok) return options;
  const eligibleSkillIds = options.value.map(({ skillId }) => skillId);
  if (!sameJson(value['eligibleSkillIds']!, eligibleSkillIds)) {
    return unrecognized(`${path}.eligibleSkillIds`, value['eligibleSkillIds']!);
  }
  const optionById = new Map(options.value.map((option) => [option.skillId, option]));
  const mandatoryValue = value['mandatoryClassSkillOrNull'];
  let mandatory: FixedSkillProjection | null = null;
  if (mandatoryValue !== null) {
    const decodedMandatory = decodeFixedSkill(
      mandatoryValue!,
      `${path}.mandatoryClassSkillOrNull`,
      1,
    );
    if (!decodedMandatory.ok) return decodedMandatory;
    mandatory = decodedMandatory.value;
    if (optionById.has(mandatory.skillId)) {
      return unrecognized(`${path}.mandatoryClassSkillOrNull.skillId`, mandatory.skillId);
    }
  }
  const racial = decodeRacialFreeSkills(value['racialFreeSkills']!, `${path}.racialFreeSkills`);
  if (!racial.ok) return racial;
  if (
    !sameJson(
      value['racialFreeSkillIds']!,
      racial.value.map(({ skillId }) => skillId),
    )
  ) {
    return unrecognized(`${path}.racialFreeSkillIds`, value['racialFreeSkillIds']!);
  }
  if (
    (mandatory !== null && racial.value.length !== 0) ||
    racial.value.some(({ skillId }) => optionById.has(skillId))
  ) {
    return unrecognized(`${path}.racialFreeSkills`, value['racialFreeSkills']!);
  }
  const selectedValue = value['selectedSkills'];
  if (!Array.isArray(selectedValue)) return unrecognized(`${path}.selectedSkills`, selectedValue!);
  const selectedSkills: SelectedSkillProjection[] = [];
  let previousOptionIndex = -1;
  for (const [index, selected] of (selectedValue as readonly JsonValue[]).entries()) {
    const selectedPath = `${path}.selectedSkills[${String(index)}]`;
    if (!isJsonObject(selected)) return unrecognized(selectedPath, selected);
    const skillId = selected['skillId'];
    const option = typeof skillId === 'string' ? optionById.get(skillId) : undefined;
    const optionIndex = option === undefined ? -1 : options.value.indexOf(option);
    const matchingLevel = option?.levelOptions.find(
      ({ slotCost, targetBonus }) =>
        slotCost === selected['slotCost'] && targetBonus === selected['targetBonus'],
    );
    if (option === undefined || optionIndex <= previousOptionIndex || matchingLevel === undefined) {
      return unrecognized(`${selectedPath}.skillId`, skillId!);
    }
    const decoded = decodeProjection(selected, selectedPath, {
      skillId: (field) => field === skillId,
      slotCost: (field) => field === matchingLevel.slotCost,
      targetBonus: (field) => field === matchingLevel.targetBonus,
    });
    if (!decoded.ok) return decoded;
    selectedSkills.push(selected as unknown as SelectedSkillProjection);
    previousOptionIndex = optionIndex;
  }
  if (
    !sameJson(
      value['selectedSkillIds']!,
      selectedSkills.map(({ skillId }) => skillId),
    )
  ) {
    return unrecognized(`${path}.selectedSkillIds`, value['selectedSkillIds']!);
  }
  if (value['commandId'] === null && selectedSkills.length !== 0) {
    return unrecognized(`${path}.selectedSkills`, selectedValue);
  }
  const expectedUsageEntries: PaidSkillUsageEntryProjection[] = [
    ...(mandatory === null ? [] : [{ ...mandatory, source: 'CLASS_MANDATORY' as const }]),
    ...selectedSkills.map((selected) => ({
      bonus: selected.targetBonus,
      skillId: selected.skillId,
      skillLabel: optionById.get(selected.skillId)!.skillLabel,
      slotCost: selected.slotCost,
      source: 'SELECTED' as const,
    })),
  ];
  const usedSlotCount = expectedUsageEntries.reduce((sum, entry) => sum + entry.slotCost, 0);
  const paidSlotUsage = value['paidSlotUsage'];
  if (!isJsonObject(paidSlotUsage)) {
    return unrecognized(`${path}.paidSlotUsage`, paidSlotUsage!);
  }
  const decodedUsage = decodeProjection(paidSlotUsage, `${path}.paidSlotUsage`, {
    entries: (field) => sameJson(field, expectedUsageEntries),
    usedSlotCount: (field) => field === usedSlotCount,
  });
  if (!decodedUsage.ok) return decodedUsage;
  const expectedValidation = skillSelectionValidation(requiredSlotCount, usedSlotCount);
  if (!isJsonObject(value['selectionValidation'])) {
    return unrecognized(`${path}.selectionValidation`, value['selectionValidation']!);
  }
  const decodedValidation = decodeProjection(
    value['selectionValidation'],
    `${path}.selectionValidation`,
    Object.fromEntries(
      Object.entries(expectedValidation).map(([key, expected]) => [
        key,
        (field: JsonValue) => field === expected,
      ]),
    ),
  );
  if (!decodedValidation.ok) return decodedValidation;
  const commandId = value['commandId'];
  if (commandId === undefined) {
    return refused({
      actualType: 'undefined',
      code: 'INVALID_SHAPE',
      expected: 'null or non-empty command id',
      path: `${path}.commandId`,
    });
  }
  if (commandId !== null && !isNonEmptyString(commandId)) {
    return unrecognized(`${path}.commandId`, commandId);
  }
  const selectionCheckpoint = value['selectionCheckpoint'];
  if (
    (selectionCheckpoint !== 'NONE' &&
      selectionCheckpoint !== 'PARTIAL' &&
      selectionCheckpoint !== 'EXACT') ||
    (selectionCheckpoint === 'NONE' && (commandId !== null || selectedSkills.length !== 0)) ||
    (selectionCheckpoint !== 'NONE' && commandId === null) ||
    (selectionCheckpoint === 'PARTIAL' && expectedValidation.kind === 'OVERFILLED') ||
    (selectionCheckpoint === 'EXACT' && expectedValidation.kind !== 'EXACT')
  ) {
    return unrecognized(`${path}.selectionCheckpoint`, selectionCheckpoint!);
  }
  const characterDraftId = value['characterDraftId'];
  return decodeProjection(value, path, {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === commandId,
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    eligibleSkillIds: (field) => field === value['eligibleSkillIds'],
    mandatoryClassSkillOrNull: (field) => field === mandatoryValue,
    paidSlotUsage: (field) => field === paidSlotUsage,
    racialFreeSkillIds: (field) => field === value['racialFreeSkillIds'],
    racialFreeSkills: (field) => field === value['racialFreeSkills'],
    requiredSlotCount: (field) => field === requiredSlotCount,
    selectedSkillIds: (field) => field === value['selectedSkillIds'],
    selectedSkills: (field) => field === selectedValue,
    selectionCheckpoint: (field) => field === selectionCheckpoint,
    ...(Object.hasOwn(value, 'pureEquipmentInitializationRequired')
      ? {
          pureEquipmentInitializationRequired: (field: JsonValue | undefined) =>
            field === true && selectionCheckpoint === 'EXACT',
        }
      : {}),
    selectionValidation: (field) => field === value['selectionValidation'],
    skillOptions: (field) => field === value['skillOptions'],
    wizardCheckpointId: (field) => isNonEmptyString(field) && field !== characterDraftId,
  });
}

function isSafeIntegerAtLeast(value: JsonValue, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function isFace(value: JsonValue): value is number {
  return isSafeIntegerAtLeast(value, 1) && value <= 20;
}

function isNonEmptyString(value: JsonValue): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function decodeFaceSlots(
  value: JsonValue,
  path: string,
  nullable: boolean,
): DecodeResult<readonly (number | null)[]> {
  if (!Array.isArray(value) || value.length !== 7) {
    return unrecognized(path, value);
  }
  const entries = value as readonly JsonValue[];
  for (const [index, face] of entries.entries()) {
    if (isFace(face) || (nullable && face === null)) continue;
    return unrecognized(`${path}[${String(index)}]`, face);
  }
  return { ok: true, value: value as readonly (number | null)[] };
}

function decodeNaturalCriticalQueue(
  value: JsonValue,
  path: string,
  faces: readonly (number | null)[],
): DecodeResult<readonly NaturalCriticalQueueItem[]> {
  if (!Array.isArray(value)) return unrecognized(path, value);
  const expected = faces.flatMap((face, setEntryIndex) =>
    face === 1 || face === 20 ? [{ originFace: face, setEntryIndex }] : [],
  );
  if (value.length !== expected.length) return unrecognized(path, value);
  const entries = value as readonly JsonValue[];
  for (const [index, item] of entries.entries()) {
    if (!isJsonObject(item)) return unrecognized(`${path}[${String(index)}]`, item);
    const keys = exactObjectKeys(
      item,
      new Set(['originFace', 'setEntryIndex']),
      `${path}[${String(index)}]`,
    );
    if (!keys.ok) return keys;
    const expectedItem = expected[index]!;
    if (
      item['setEntryIndex'] !== expectedItem.setEntryIndex ||
      item['originFace'] !== expectedItem.originFace
    ) {
      return unrecognized(`${path}[${String(index)}]`, item);
    }
  }
  return { ok: true, value: value as unknown as readonly NaturalCriticalQueueItem[] };
}

function decodeChr003Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const nullableSlots = value['setRollReceiptId'] === null;
  const faces = decodeFaceSlots(
    value['facesOrManualInputs']!,
    `${path}.facesOrManualInputs`,
    nullableSlots,
  );
  if (!faces.ok) return faces;
  const queue = decodeNaturalCriticalQueue(
    value['naturalCriticalQueue']!,
    `${path}.naturalCriticalQueue`,
    faces.value,
  );
  if (!queue.ok) return queue;
  const characterDraftId = value['characterDraftId'];
  const wizardCheckpointId = value['wizardCheckpointId'];
  const branchUuid = value['branchUuid'];
  const setRollRequestId = value['setRollRequestId'];
  const result = decodeProjection(value, path, {
    attemptIndex: (field) => isSafeIntegerAtLeast(field, 1),
    branchUuid: isNonEmptyString,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null,
    diceInputModeSnapshot: (field) => field === 'AUTO' || field === 'MANUAL',
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    facesOrManualInputs: (field) => field === value['facesOrManualInputs'],
    naturalCriticalQueue: (field) => field === value['naturalCriticalQueue'],
    setRollReceiptId: (field) => field === null || isNonEmptyString(field),
    setRollRequestId: isNonEmptyString,
    shownResultLocked: (field) => typeof field === 'boolean',
    statMethod: (field) =>
      field === 'CLASSIC' || field === 'ADVENTUROUS' || field === 'ALL_OR_NOTHING',
    wizardCheckpointId: isNonEmptyString,
  });
  if (!result.ok) return result;
  if (
    [characterDraftId, wizardCheckpointId, branchUuid, setRollRequestId].some(
      (entry, index, entries) => entries.indexOf(entry) !== index,
    )
  ) {
    return unrecognized(`${path}.setRollRequestId`, setRollRequestId!);
  }
  const pending = value['setRollReceiptId'] === null;
  if (
    (pending &&
      (value['shownResultLocked'] !== false ||
        faces.value.some((face) => face !== null) ||
        queue.value.length !== 0)) ||
    (!pending && (value['shownResultLocked'] !== true || faces.value.some((face) => face === null)))
  ) {
    return unrecognized(`${path}.shownResultLocked`, value['shownResultLocked']!);
  }
  return result;
}

function decodeChr004Projection(
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const characterDraftId = value['characterDraftId'];
  const wizardCheckpointId = value['wizardCheckpointId'];
  const branchUuid = value['branchUuid'];
  const setRollReceiptId = value['setRollReceiptId'];
  const confirmationRollRequestId = value['confirmationRollRequestId'];
  const result = decodeProjection(value, path, {
    branchUuid: isNonEmptyString,
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null,
    confirmationFace: (field) => field === null || isFace(field),
    confirmationReceiptId: (field) => field === null || isNonEmptyString(field),
    confirmationRollRequestId: isNonEmptyString,
    criticalQueueIndex: (field) => isSafeIntegerAtLeast(field, 0),
    diceInputModeSnapshot: (field) => field === 'AUTO' || field === 'MANUAL',
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    originFace: (field) => field === 1 || field === 20,
    returnDecisionFormId: (field) =>
      field === 'CHR-005' || field === 'CHR-006' || field === 'CHR-007' || field === 'CHR-008',
    setRollReceiptId: isNonEmptyString,
    wizardCheckpointId: isNonEmptyString,
  });
  if (!result.ok) return result;
  const ids = [
    characterDraftId,
    wizardCheckpointId,
    branchUuid,
    setRollReceiptId,
    confirmationRollRequestId,
  ];
  if (ids.some((entry, index) => ids.indexOf(entry) !== index)) {
    return unrecognized(`${path}.confirmationRollRequestId`, confirmationRollRequestId!);
  }
  if ((value['confirmationFace'] === null) !== (value['confirmationReceiptId'] === null)) {
    return unrecognized(`${path}.confirmationReceiptId`, value['confirmationReceiptId']!);
  }
  return result;
}

function isCreationSetDecisionFormId(value: string): value is CreationSetDecisionFormId {
  return CREATION_SET_DECISION_FORM_ID_SET.has(value);
}

function decodeCharacterSetDecisionProjection(
  formId: CreationSetDecisionFormId,
  value: JsonObject,
  path: string,
  routeBinding: JsonValue | undefined,
): DecodeResult<JsonObject> {
  const rule = CREATION_SET_DECISION_FORMS[formId];
  const fields: Record<string, FieldPredicate> = {
    characterDraftId: (field) =>
      typeof field === 'string' && UUID_PATTERN.test(field) && field === routeBinding,
    commandId: (field) => field === null || isNonEmptyString(field),
    decision: (field) =>
      field === 'PENDING' || field === 'ACCEPT_SET' || field === rule.alternateDecision,
    decisionReceiptIdOrNull: (field) => field === null || isNonEmptyString(field),
    draftRevision: (field) => isSafeIntegerAtLeast(field, 0),
    [rule.receiptKey]: isNonEmptyString,
    statMethod: (field) => field === rule.method,
    wizardCheckpointId: isNonEmptyString,
  };
  if (formId !== 'CHR-005') {
    fields['attemptIndex'] = (field) =>
      formId === 'CHR-008' ? isSafeIntegerAtLeast(field, 1) && field <= 5 : field === rule.attempt;
  }
  if (formId === 'CHR-008') {
    fields['fifthAttemptMandatoryAccept'] = (field) => field === (value['attemptIndex'] === 5);
  }
  const decoded = decodeProjection(value, path, fields);
  if (!decoded.ok) return decoded;
  const pending = value['decision'] === 'PENDING';
  if (
    pending !== (value['decisionReceiptIdOrNull'] === null) ||
    pending !== (value['commandId'] === null)
  ) {
    return unrecognized(`${path}.decisionReceiptIdOrNull`, value['decisionReceiptIdOrNull']!);
  }
  const ids = [
    value['characterDraftId'],
    value['wizardCheckpointId'],
    value[rule.receiptKey],
    value['decisionReceiptIdOrNull'],
    value['commandId'],
  ].filter((entry): entry is string => typeof entry === 'string');
  if (new Set(ids).size !== ids.length) {
    return unrecognized(`${path}.${rule.receiptKey}`, value[rule.receiptKey]!);
  }
  return decoded;
}

function expectedAbandonmentConsequences(
  formId: CreationSetDecisionFormId,
  projection: JsonObject,
): CharacterSetAbandonmentConsequences {
  switch (formId) {
    case 'CHR-005':
      return {
        creationCriticalConsequencesDiscarded: true,
        exactPointBuyTotalOrNull: 90,
        nextAttemptIndexOrNull: null,
        setValuesDiscarded: true,
      };
    case 'CHR-006':
      return {
        creationCriticalConsequencesDiscarded: true,
        exactPointBuyTotalOrNull: null,
        nextAttemptIndexOrNull: 2,
        setValuesDiscarded: true,
      };
    case 'CHR-007':
      return {
        creationCriticalConsequencesDiscarded: true,
        exactPointBuyTotalOrNull: 85,
        nextAttemptIndexOrNull: null,
        setValuesDiscarded: true,
      };
    case 'CHR-008':
      return {
        creationCriticalConsequencesDiscarded: true,
        exactPointBuyTotalOrNull: null,
        nextAttemptIndexOrNull: ((projection['attemptIndex'] as 1 | 2 | 3 | 4) + 1) as
          2 | 3 | 4 | 5,
        setValuesDiscarded: true,
      };
  }
}

function decodeAbandonmentConsequences(
  value: JsonValue,
  path: string,
  expected: CharacterSetAbandonmentConsequences,
): DecodeResult<CharacterSetAbandonmentConsequences> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const decoded = decodeProjection(value, path, {
    creationCriticalConsequencesDiscarded: (field) =>
      field === expected.creationCriticalConsequencesDiscarded,
    exactPointBuyTotalOrNull: (field) => field === expected.exactPointBuyTotalOrNull,
    nextAttemptIndexOrNull: (field) => field === expected.nextAttemptIndexOrNull,
    setValuesDiscarded: (field) => field === expected.setValuesDiscarded,
  });
  return decoded.ok ? { ok: true, value: value as CharacterSetAbandonmentConsequences } : decoded;
}

function decodeChr028Projection(
  value: JsonObject,
  path: string,
  originFormId: CreationSetDecisionFormId,
  originProjection: JsonObject,
): DecodeResult<Chr028Projection> {
  const rule = CREATION_SET_DECISION_FORMS[originFormId];
  const consequences = expectedAbandonmentConsequences(originFormId, originProjection);
  const decodedConsequences = decodeAbandonmentConsequences(
    value['irreversibleConsequences']!,
    `${path}.irreversibleConsequences`,
    consequences,
  );
  if (!decodedConsequences.ok) return decodedConsequences;
  const setReceiptId = originProjection[rule.receiptKey];
  const receiptIds = value['abandonedSetReceiptIds'];
  const decoded = decodeProjection(value, path, {
    abandonedSetReceiptIds: (field) =>
      Array.isArray(field) && field.length === 1 && field[0] === setReceiptId,
    characterDraftId: (field) => field === originProjection['characterDraftId'],
    commandId: (field) => field === null || isNonEmptyString(field),
    decision: (field) => field === null || field === 'CONFIRM',
    decisionReceiptIdOrNull: (field) => field === null || isNonEmptyString(field),
    draftRevision: (field) => field === originProjection['draftRevision'],
    irreversibleConsequences: (field) => field === value['irreversibleConsequences'],
    originDecisionFormId: (field) => field === originFormId,
    transitionKind: (field) => field === rule.transitionKind,
    wizardCheckpointId: (field) => field === originProjection['wizardCheckpointId'],
  });
  if (!decoded.ok) return decoded;
  const warning = value['decision'] === null;
  if (
    warning !== (value['decisionReceiptIdOrNull'] === null) ||
    warning !== (value['commandId'] === null) ||
    originProjection['decision'] !== (warning ? 'PENDING' : rule.alternateDecision) ||
    (!warning && originFormId !== 'CHR-005' && originFormId !== 'CHR-007')
  ) {
    return unrecognized(`${path}.decision`, value['decision']!);
  }
  if (!Array.isArray(receiptIds))
    return unrecognized(`${path}.abandonedSetReceiptIds`, receiptIds!);
  const ids = [
    value['characterDraftId'],
    value['wizardCheckpointId'],
    receiptIds[0],
    value['decisionReceiptIdOrNull'],
    value['commandId'],
  ].filter((entry): entry is string => typeof entry === 'string');
  if (new Set(ids).size !== ids.length) {
    return unrecognized(`${path}.abandonedSetReceiptIds`, receiptIds);
  }
  return { ok: true, value: value as unknown as Chr028Projection };
}

function exactActionKeys(
  actual: readonly ActionKey[],
  expected: readonly ActionKey[],
  path: string,
): DecodeResult<null> {
  if (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
    return { ok: true, value: null };
  return unrecognized(path, [...actual]);
}

function expectedCreationSetDecisionActionKeys(
  formId: CreationSetDecisionFormId,
  projection: JsonObject,
  executableWorkflowCommandIds: readonly WorkflowCommandId[],
): readonly ActionKey[] {
  if (
    projection['decision'] !== 'PENDING' ||
    !executableWorkflowCommandIds.includes(SET_DECIDE_WORKFLOW_COMMAND_ID)
  ) {
    return NO_ACTION_KEYS;
  }
  const rule = CREATION_SET_DECISION_FORMS[formId];
  return formId === 'CHR-008' && projection['fifthAttemptMandatoryAccept'] === true
    ? [rule.acceptActionKey]
    : [rule.acceptActionKey, rule.alternateActionKey];
}

function decodePresentationLayers(
  message: ProjectionSnapshotV2Message,
  baseFormId: SupportedPresentationFormId,
  baseProjection: JsonObject,
  executableWorkflowCommandIds: readonly WorkflowCommandId[],
): DecodeResult<readonly ConfirmedPresentationLayer[]> {
  const layers = message.presentation.layers;
  if (layers.length === 0) return { ok: true, value: [] };
  if (isAdmissionGmForm(baseFormId)) {
    try {
      admissionGmPresentationValue(message.presentation.base, layers, message.revisions);
      return {
        ok: true,
        value: layers.map((layer) => ({
          formId: layer.formId as 'NET-020' | 'NET-021' | 'NET-022',
          path: layer.routeTemplate,
          projection: layer.roleFilteredPayload,
          availableActionKeys: layer.availableActionKeys,
        })),
      };
    } catch {
      return unrecognized('$.presentation.layers', null);
    }
  }
  if (baseFormId === 'CHR-023' && layers.length === 1 && layers[0]?.formId === 'CHR-031') {
    const layer = layers[0];
    const decoded = decodeChr031Projection(
      layer.roleFilteredPayload,
      '$.presentation.layers[0].roleFilteredPayload',
    );
    if (!decoded.ok) return decoded;
    if (
      layer.routeBindings.length !== 0 ||
      decoded.value.characterDraftId !== baseProjection['characterDraftId'] ||
      decoded.value.requestId !== baseProjection['requestId'] ||
      decoded.value.weaponTypeId !== baseProjection['weaponTypeId'] ||
      decoded.value.draftRevision !== baseProjection['draftRevision'] ||
      baseProjection['requestStatus'] !== 'DRAFT'
    )
      return unrecognized(
        '$.presentation.layers[0].roleFilteredPayload',
        layer.roleFilteredPayload,
      );
    const actions = exactActionKeys(
      layer.availableActionKeys,
      [CHR_031_RETURN_ACTION_KEY],
      '$.presentation.layers[0].availableActionKeys',
    );
    if (!actions.ok) return actions;
    return {
      ok: true,
      value: [
        {
          formId: 'CHR-031',
          path: '@dialog/chr-031',
          projection: decoded.value,
          availableActionKeys: [...layer.availableActionKeys],
        },
      ],
    };
  }
  if (!isCreationSetDecisionFormId(baseFormId) || layers.length !== 1) {
    return unrecognized(
      '$.presentation.layers',
      layers.map((layer) => layer.formId),
    );
  }
  if (baseFormId === 'CHR-008' && baseProjection['fifthAttemptMandatoryAccept'] === true) {
    return unrecognized('$.presentation.layers[0].formId', layers[0]!.formId);
  }
  const layer = layers[0]!;
  if (layer.formId !== 'CHR-028') {
    return unrecognized('$.presentation.layers[0].formId', layer.formId);
  }
  if (layer.routeBindings.length !== 0) {
    return unrecognized(
      '$.presentation.layers[0].routeBindings',
      layer.routeBindings as unknown as JsonValue,
    );
  }
  const projection = decodeChr028Projection(
    layer.roleFilteredPayload,
    '$.presentation.layers[0].roleFilteredPayload',
    baseFormId,
    baseProjection,
  );
  if (!projection.ok) return projection;
  const expectedActions =
    projection.value.decision === null &&
    executableWorkflowCommandIds.includes(SET_DECIDE_WORKFLOW_COMMAND_ID)
      ? CHR_028_ACTION_KEYS
      : NO_ACTION_KEYS;
  const actions = exactActionKeys(
    layer.availableActionKeys,
    expectedActions,
    '$.presentation.layers[0].availableActionKeys',
  );
  if (!actions.ok) return actions;
  return {
    ok: true,
    value: [
      {
        availableActionKeys: [...layer.availableActionKeys],
        formId: 'CHR-028',
        path: '@dialog/chr-028',
        projection: projection.value,
      },
    ],
  };
}

function decodeConfirmedSnapshot(
  message: ProjectionSnapshotV2Message,
  executableWorkflowCommandIds: readonly WorkflowCommandId[],
): DecodeResult<ConfirmedProjectionSnapshot> {
  const base = message.presentation.base;
  const expectedRole =
    base.formId === 'APP-001'
      ? null
      : base.formId === 'NET-017' ||
          isCampaignCreationForm(base.formId) ||
          isAdmissionGmForm(base.formId)
        ? 'gm'
        : base.formId === 'APP-010' &&
            base.roleFilteredPayload['ownerContext'] === 'GM_ARCHIVE_EXPORT'
          ? 'gm'
          : 'player';
  if (message.projectionRole !== expectedRole) {
    return unrecognized('$.projectionRole', message.projectionRole);
  }
  if (
    message.projectionRole !== 'gm' &&
    (executableWorkflowCommandIds.includes(CAMPAIGN_CREATE_COMMAND_ID) ||
      [...NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS, ...ADMISSION_GM_WORKFLOW_IDS].some((id) =>
        executableWorkflowCommandIds.includes(id),
      ))
  )
    return unrecognized('$.executableWorkflowCommandIds', CAMPAIGN_CREATE_COMMAND_ID);
  let projection: DecodeResult<JsonObject>;
  if (isAdmissionOwnerForm(base.formId)) {
    try {
      const p = admissionOwnerProjectionValue(base.formId, base.roleFilteredPayload);
      if (
        message.presentation.layers.length !== 0 ||
        base.routeBindings.length !== 1 ||
        base.routeBindings[0]?.parameterIndex !== 0 ||
        base.routeBindings[0].source !== 'inherited' ||
        base.routeBindings[0]?.value !== p['campaignId'] ||
        !sameNetworkRevisions(message.revisions, p as unknown as RevisionVector)
      )
        return unrecognized('$.presentation', null);
      const actions = exactSymbiontActionKeys(
        base.availableActionKeys,
        admissionOwnerActions(base.formId, p, executableWorkflowCommandIds),
        '$.presentation.base.availableActionKeys',
      );
      if (!actions.ok) return actions;
      projection = { ok: true, value: p };
    } catch {
      return unrecognized('$.presentation', null);
    }
  } else if (isAdmissionGmForm(base.formId)) {
    try {
      admissionGmPresentationValue(base, message.presentation.layers, message.revisions);
      projection = {
        ok: true,
        value: admissionGmProjectionValue(base.formId, base.roleFilteredPayload),
      };
    } catch {
      return unrecognized('$.presentation', null);
    }
  } else if (base.formId === 'NET-017') {
    const p = gmRequestProjection(base.roleFilteredPayload);
    if (p === null) return unrecognized('$.presentation.base.roleFilteredPayload', null);
    if (
      message.presentation.layers.length !== 0 ||
      base.routeBindings.length !== 1 ||
      base.routeBindings[0]?.parameterIndex !== 0 ||
      base.routeBindings[0].source !== 'inherited' ||
      base.routeBindings[0].value !== p.campaignId ||
      message.revisions.stateRevision !== p.stateRevision ||
      message.revisions.projectionRevision !== p.projectionRevision ||
      message.revisions.actorVisibilityRevision > message.revisions.stateRevision ||
      p.projectionRevision < p.stateRevision
    )
      return unrecognized('$.revisions', null);
    const actions = exactSymbiontActionKeys(
      base.availableActionKeys,
      expectedGmRequestActions(p, executableWorkflowCommandIds),
      '$.presentation.base.availableActionKeys',
    );
    if (!actions.ok) return actions;
    projection = { ok: true, value: p };
  } else if (isNetworkApplicationForm(base.formId)) {
    projection = decodeNetworkProjection(
      base.roleFilteredPayload,
      '$.presentation.base.roleFilteredPayload',
      base.formId,
    );
    if (projection.ok) {
      const p = projection.value;
      const binding =
        base.formId === 'CHR-027'
          ? p['localCharacterUuid']
          : (p['campaignIdOrNull'] ?? `unbound:${p['networkScopeId'] as string}`);
      if (
        message.presentation.layers.length !== 0 ||
        base.routeBindings.length !== 1 ||
        base.routeBindings[0]?.parameterIndex !== 0 ||
        base.routeBindings[0].source !== 'inherited' ||
        base.routeBindings[0].value !== binding ||
        !sameNetworkRevisions(message.revisions, p as unknown as RevisionVector)
      )
        return unrecognized('$.presentation.base.routeBindings', null);
      const actions = exactSymbiontActionKeys(
        base.availableActionKeys,
        expectedNetworkActions(base.formId, p, executableWorkflowCommandIds),
        '$.presentation.base.availableActionKeys',
      );
      if (!actions.ok) return actions;
    }
  } else if (isCampaignCreationForm(base.formId)) {
    projection = decodeCampaignProjection(
      base.roleFilteredPayload,
      '$.presentation.base.roleFilteredPayload',
      base.formId,
    );
    if (projection.ok) {
      const p = projection.value;
      const invalidRevisions =
        base.formId === 'APP-011'
          ? message.revisions.stateRevision !== 0 || message.revisions.actorVisibilityRevision !== 0
          : base.formId === 'CMP-006'
            ? message.revisions.projectionRevision < message.revisions.stateRevision ||
              message.revisions.actorVisibilityRevision > message.revisions.stateRevision
            : p['draftRevision'] !== message.revisions.stateRevision ||
              message.revisions.projectionRevision < message.revisions.stateRevision ||
              message.revisions.actorVisibilityRevision !== 0;
      if (invalidRevisions) return unrecognized('$.revisions', null);
      const expectedBinding =
        base.formId === 'APP-011'
          ? null
          : base.formId === 'CMP-006'
            ? p['campaignId']
            : `draft:${p['campaignDraftId'] as string}`;
      if (
        message.presentation.layers.length !== 0 ||
        (expectedBinding === null
          ? base.routeBindings.length !== 0
          : base.routeBindings[0]?.value !== expectedBinding)
      )
        return unrecognized('$.presentation.base.routeBindings', null);
      const actions = exactSymbiontActionKeys(
        base.availableActionKeys,
        expectedCampaignActions(base.formId, p, executableWorkflowCommandIds),
        '$.presentation.base.availableActionKeys',
      );
      if (!actions.ok) return actions;
    }
  } else if (isPostSaveForm(base.formId)) {
    const decoded = decodePostSaveProjection(
      base.roleFilteredPayload,
      '$.presentation.base.roleFilteredPayload',
      base.formId,
      message.projectionRole,
      message.revisions,
    );
    projection = decoded;
    if (decoded.ok) {
      const actions = exactSymbiontActionKeys(
        base.availableActionKeys,
        expectedPostSaveActions(
          base.formId,
          decoded.value,
          executableWorkflowCommandIds,
          base.availableActionKeys.includes('CHR-040::CTA::002'),
        ),
        '$.presentation.base.availableActionKeys',
      );
      if (!actions.ok) return actions;
    }
  } else if (Object.hasOwn(base.roleFilteredPayload, 'correctionContext')) {
    const decoded = decodeCreationCorrectionProjection(
      base.roleFilteredPayload,
      '$.presentation.base.roleFilteredPayload',
      base.formId,
    );
    projection = decoded;
    if (decoded.ok) {
      const actions = exactSymbiontActionKeys(
        base.availableActionKeys,
        expectedCreationCorrectionActionKeys(decoded.value, {
          checkpoint: executableWorkflowCommandIds.includes(
            IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
          ),
          setDecide: executableWorkflowCommandIds.includes(SET_DECIDE_WORKFLOW_COMMAND_ID),
          rollCommit: executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID),
        }),
        '$.presentation.base.availableActionKeys',
      );
      if (!actions.ok) return actions;
    }
  } else
    switch (base.formId) {
      case 'APP-001':
        projection = decodeApp001Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            base.availableActionKeys.includes('APP-001::CTA::002')
              ? ['APP-001::CTA::001', 'APP-001::CTA::002', 'APP-001::CTA::003', 'APP-001::CTA::004']
              : ['APP-001::CTA::001', 'APP-001::CTA::003', 'APP-001::CTA::004'],
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'APP-002':
        projection = decodeApp002Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          message.revisions,
        );
        break;
      case 'APP-004':
        projection = decodeApp004Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          message.revisions,
        );
        break;
      case 'CHR-001':
        projection = decodeChr001Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        break;
      case 'CHR-010':
        projection = decodeChr010Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            CHR_010_INITIAL_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-016':
        projection = decodeChr016Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            CHR_016_INITIAL_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-036':
        projection = decodeChr036Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            CHR_036_INITIAL_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-002':
        projection = decodeChr002Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            CHR_002_INITIAL_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-003':
        projection = decodeChr003Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            projection.value['setRollReceiptId'] === null &&
              executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID)
              ? CHR_003_PENDING_ACTION_KEYS
              : NO_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-004':
        projection = decodeChr004Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            projection.value['confirmationReceiptId'] === null &&
              executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID)
              ? CHR_004_PENDING_ACTION_KEYS
              : NO_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-005':
      case 'CHR-006':
      case 'CHR-007':
      case 'CHR-008':
        projection = decodeCharacterSetDecisionProjection(
          base.formId,
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            expectedCreationSetDecisionActionKeys(
              base.formId,
              projection.value,
              executableWorkflowCommandIds,
            ),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-009':
        projection = decodeChr009Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const forwardAction =
            projection.value['raceChoice'] === 'PURE'
              ? ('CHR-009::CTA::001' as const)
              : ('CHR-009::CTA::002' as const);
          const actions = exactActionKeys(
            base.availableActionKeys,
            executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID)
              ? [forwardAction]
              : NO_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-011':
        projection = decodeChr011Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            CHR_011_SELECTOR_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-012':
        projection = decodeChr012Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            NO_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-013':
        projection = decodeChr013Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            CHR_013_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-014': {
        const decoded = decodeChr014Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
          base.routeBindings[1]?.value,
        );
        projection = decoded;
        if (decoded.ok) {
          const eligible =
            decoded.value.eligibility === 'ELIGIBLE' &&
            decoded.value.levelsAndBonuses.length > 0 &&
            executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID);
          const actions = exactActionKeys(
            base.availableActionKeys,
            eligible ? CHR_014_ACTION_KEYS : CHR_014_READ_ONLY_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-015':
        projection = decodeChr015Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
          base.routeBindings[0]?.value,
        );
        if (projection.ok) {
          const actions = exactActionKeys(
            base.availableActionKeys,
            projection.value['selectionCheckpoint'] === 'EXACT'
              ? projection.value['pureEquipmentInitializationRequired'] === true
                ? [CHR_015_CONFIRM_ACTION_KEY]
                : NO_ACTION_KEYS
              : projection.value['selectionCheckpoint'] === 'PARTIAL'
                ? CHR_015_MUTABLE_ACTION_KEYS
                : CHR_015_INITIAL_ACTION_KEYS,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      case 'CHR-017': {
        const manual = base.roleFilteredPayload['symbiontAcquisitionModeOrNull'] === 'MANUAL';
        const decoded = manual
          ? decodeChr017ManualProjection(
              base.roleFilteredPayload,
              '$.presentation.base.roleFilteredPayload',
            )
          : decodeChr017Projection(
              base.roleFilteredPayload,
              '$.presentation.base.roleFilteredPayload',
            );
        projection = decoded;
        if (decoded.ok) {
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            isManualChr017Projection(decoded.value)
              ? expectedChr017ManualActionKeys(decoded.value)
              : expectedChr017ActionKeys(decoded.value),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-018': {
        const decoded = decodeChr018Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
        );
        projection = decoded;
        if (decoded.ok) {
          if (
            decoded.value.speciesKey !== base.routeBindings[1]?.value ||
            decoded.value.characterDraftId !== base.routeBindings[0]?.value
          ) {
            return unrecognized(
              '$.presentation.base.roleFilteredPayload.speciesKey',
              decoded.value.speciesKey,
            );
          }
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            expectedChr018ActionKeys(
              decoded.value,
              executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID),
            ),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-019': {
        const duplicate = base.roleFilteredPayload['duplicatePolicy'];
        const manual = isJsonObject(duplicate) && duplicate['kind'] === 'FORBIDDEN';
        const decoded = manual
          ? decodeChr019ManualProjection(
              base.roleFilteredPayload,
              '$.presentation.base.roleFilteredPayload',
            )
          : decodeChr019Projection(
              base.roleFilteredPayload,
              '$.presentation.base.roleFilteredPayload',
            );
        projection = decoded;
        if (decoded.ok) {
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            decoded.value.duplicatePolicy.kind === 'FORBIDDEN'
              ? expectedChr019ManualActionKeys(base.availableActionKeys)
              : decoded.value.raceChoice === 'PURE'
                ? ['CHR-019::CTA::004']
                : expectedChr019EntryActionKeys(base.availableActionKeys),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-042': {
        const decoded = decodeChr042Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
        );
        projection = decoded;
        if (decoded.ok) {
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            [
              ...(base.availableActionKeys.includes(CHR_042_MANUAL_CONFIRM_ACTION_KEY) &&
              executableWorkflowCommandIds.includes(SET_DECIDE_WORKFLOW_COMMAND_ID)
                ? [CHR_042_MANUAL_CONFIRM_ACTION_KEY]
                : []),
              'CHR-042::CTA::002',
            ],
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-020': {
        const decoded = decodeChr020Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
        );
        projection = decoded;
        if (decoded.ok) {
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            expectedChr020ActionKeys(
              decoded.value,
              executableWorkflowCommandIds,
              base.availableActionKeys,
            ),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-041': {
        const decoded = decodeChr041Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
        );
        projection = decoded;
        if (decoded.ok) {
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            expectedChr041ActionKeys(decoded.value, executableWorkflowCommandIds),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-032':
      case 'CHR-025': {
        const decoded =
          base.formId === 'CHR-032'
            ? decodeChr032Projection(
                base.roleFilteredPayload,
                '$.presentation.base.roleFilteredPayload',
              )
            : decodeChr025Projection(
                base.roleFilteredPayload,
                '$.presentation.base.roleFilteredPayload',
              );
        projection = decoded;
        if (decoded.ok) {
          const expected =
            base.formId === 'CHR-032'
              ? expectedChr032ActionKeys(
                  decoded.value as Chr032Projection,
                  executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID),
                )
              : expectedChr025ActionKeys(
                  decoded.value as Chr025Projection,
                  true,
                  executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID),
                );
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            expected,
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-037': {
        const decoded = decodeChr037Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
        );
        projection = decoded;
        if (decoded.ok) {
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            expectedChr037ActionKeys(decoded.value, {
              rollCommit: executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID),
              checkpoint: executableWorkflowCommandIds.includes(
                IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
              ),
            }),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-038': {
        const decoded = decodeChr038Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
        );
        projection = decoded;
        if (decoded.ok) {
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            expectedChr038ActionKeys(decoded.value, {
              rollCommit: executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID),
              checkpoint: executableWorkflowCommandIds.includes(
                IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
              ),
            }),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-023': {
        const decoded = decodeChr023Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
        );
        projection = decoded;
        if (decoded.ok) {
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            expectedChr023ActionKeys(
              decoded.value,
              executableWorkflowCommandIds.includes(WEAPON_PROFILE_SUBMIT_WORKFLOW),
            ),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-024': {
        const decoded = decodeChr024Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
        );
        projection = decoded;
        if (decoded.ok) {
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            expectedChr024ActionKeys(
              decoded.value,
              executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID),
            ),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-022': {
        const decoded = decodeChr022Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
        );
        projection = decoded;
        if (decoded.ok) {
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            expectedChr022ActionKeys(decoded.value, {
              rollCommit: executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID),
              checkpoint: executableWorkflowCommandIds.includes(
                IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
              ),
            }),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      case 'CHR-021': {
        const decoded = decodeChr021Projection(
          base.roleFilteredPayload,
          '$.presentation.base.roleFilteredPayload',
        );
        projection = decoded;
        if (decoded.ok) {
          const actions = exactSymbiontActionKeys(
            base.availableActionKeys,
            expectedChr021ActionKeys(decoded.value, {
              rollCommit: executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID),
              checkpoint: executableWorkflowCommandIds.includes(
                IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
              ),
            }),
            '$.presentation.base.availableActionKeys',
          );
          if (!actions.ok) return actions;
        }
        break;
      }
      default:
        return unrecognized('$.presentation.base.formId', base.formId);
    }
  if (!projection.ok) return projection;
  if (
    base.formId === 'CHR-001' &&
    !Object.hasOwn(base.roleFilteredPayload, 'correctionContext') &&
    base.availableActionKeys.includes(IDENTITY_CHECKPOINT_ACTION_KEY) &&
    !executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID)
  ) {
    return unrecognized('$.presentation.base.availableActionKeys', [...base.availableActionKeys]);
  }
  if (
    base.formId === 'CHR-001' &&
    !Object.hasOwn(base.roleFilteredPayload, 'correctionContext') &&
    base.availableActionKeys.includes(IDENTITY_CHECKPOINT_ACTION_KEY)
  ) {
    const value = projection.value;
    if (
      typeof value['name'] !== 'string' ||
      typeof value['age'] !== 'number' ||
      (value['sex'] !== 'MALE' && value['sex'] !== 'FEMALE') ||
      typeof value['massKg'] !== 'number'
    ) {
      return unrecognized('$.presentation.base.availableActionKeys', [...base.availableActionKeys]);
    }
  }
  const layers = decodePresentationLayers(
    message,
    base.formId as SupportedPresentationFormId,
    projection.value,
    executableWorkflowCommandIds,
  );
  if (!layers.ok) return layers;
  let path = base.routeTemplate;
  const orderedBindings = [...base.routeBindings].sort(
    (left, right) => left.parameterIndex - right.parameterIndex,
  );
  for (const binding of orderedBindings) {
    path = path.replace(/:[^/]+/u, encodeURIComponent(binding.value));
  }
  const common = {
    availableActionKeys: [...base.availableActionKeys],
    executableWorkflowCommandIds: [...executableWorkflowCommandIds],
    path,
    revisions: { ...message.revisions },
  } as const;
  return {
    ok: true,
    value: {
      ...common,
      formId: base.formId,
      layers: layers.value,
      projection: projection.value,
    } as ConfirmedProjectionSnapshot,
  };
}

function identitySnapshot(
  snapshot: ConfirmedProjectionSnapshot,
  contextId: string | null,
): IdentityDraftSnapshot | null {
  if (snapshot.formId !== 'CHR-001' || contextId === null) return null;
  const value = snapshot.projection;
  return {
    draftRevision: value['draftRevision'] as number,
    revisions: snapshot.revisions,
    scope: {
      characterDraftId: value['characterDraftId'] as string,
      contextId,
      sourceFormId: 'CHR-001',
      wizardCheckpointId: value['wizardCheckpointId'] as string,
    },
    values: {
      age: value['age'] as number | null,
      artAssetKeyOrLocalFile: value[
        'artAssetKeyOrLocalFile'
      ] as IdentityDraftValues['artAssetKeyOrLocalFile'],
      description: value['description'] as string | null,
      massKg: value['massKg'] as number | null,
      name: value['name'] as string | null,
      sex: value['sex'] as IdentityDraftValues['sex'],
    },
  };
}

function creationRollDraftFromSnapshot(
  snapshot: ConfirmedProjectionSnapshot,
): CharacterCreationRollDraft | null {
  if (
    snapshot.formId === 'CHR-003' &&
    snapshot.projection['diceInputModeSnapshot'] === 'MANUAL' &&
    snapshot.projection['setRollReceiptId'] === null
  ) {
    return {
      faces: [...(snapshot.projection['facesOrManualInputs'] as readonly (number | null)[])],
      formId: 'CHR-003',
    };
  }
  if (
    snapshot.formId === 'CHR-004' &&
    snapshot.projection['diceInputModeSnapshot'] === 'MANUAL' &&
    snapshot.projection['confirmationReceiptId'] === null
  ) {
    return { face: snapshot.projection['confirmationFace'] as number | null, formId: 'CHR-004' };
  }
  return null;
}

function emptyStatDraftValues(): StatMap<null> {
  return { S: null, D: null, M: null, Z: null, I: null, W: null, C: null };
}

function validateStatAssignmentDraft(
  assignmentMode: StatAssignmentMode,
  valuesByStat: StatMap<number | null>,
): StatAssignmentValidation {
  const values = STAT_CODES.map((statCode) => valuesByStat[statCode]);
  if (values.some((value) => value === null)) return 'ASSIGNMENT_INVALID';
  const complete = values as number[];
  if (
    complete.some(
      (value) =>
        !Number.isSafeInteger(value) ||
        value < (assignmentMode === 'ROLLED_BIJECTION' ? 0 : 1) ||
        value > (assignmentMode === 'ROLLED_BIJECTION' ? 6 : 20),
    )
  ) {
    return 'ASSIGNMENT_INVALID';
  }
  if (assignmentMode === 'ROLLED_BIJECTION') {
    return new Set(complete).size === STAT_CODES.length
      ? 'READY_TO_CHECKPOINT'
      : 'ASSIGNMENT_INVALID';
  }
  const requiredTotal = assignmentMode === 'POINT_BUY_90' ? 90 : 85;
  return complete.reduce((total, value) => total + value, 0) === requiredTotal
    ? 'READY_TO_CHECKPOINT'
    : 'ASSIGNMENT_INVALID';
}

function creationStatAssignmentDraftFromSnapshot(
  snapshot: ConfirmedProjectionSnapshot,
): CharacterStatAssignmentDraft | null {
  if (snapshot.formId !== 'CHR-009') return null;
  const assignmentMode = snapshot.projection['assignmentMode'] as StatAssignmentMode;
  return {
    assignmentMode,
    formId: 'CHR-009',
    validation: 'ASSIGNMENT_INVALID',
    valuesByStat: emptyStatDraftValues(),
  };
}

function creationSkillSelectionDraftFromSnapshot(
  snapshot: ConfirmedProjectionSnapshot,
): CharacterSkillSelectionDraft | null {
  if (snapshot.formId !== 'CHR-015') return null;
  const projection = snapshot.projection as Chr015Projection;
  if (
    projection.selectionCheckpoint === 'EXACT' &&
    projection['pureEquipmentInitializationRequired'] !== true
  )
    return null;
  return {
    candidateSkillIdOrNull: null,
    candidateTargetBonusOrNull: null,
    formId: 'CHR-015',
    paidSlotUsage: projection.paidSlotUsage,
    selectedSkillIds: [...projection.selectedSkillIds],
    selectedSkills: [...projection.selectedSkills],
    selectionValidation: projection.selectionValidation,
  };
}

function paidSlotUsageForSkillSelection(
  projection: Chr015Projection,
  selectedSkills: readonly SelectedSkillProjection[],
): PaidSlotUsageProjection {
  const optionById = new Map(projection.skillOptions.map((option) => [option.skillId, option]));
  const entries: PaidSkillUsageEntryProjection[] = [
    ...(projection.mandatoryClassSkillOrNull === null
      ? []
      : [{ ...projection.mandatoryClassSkillOrNull, source: 'CLASS_MANDATORY' as const }]),
    ...selectedSkills.map((selected) => ({
      bonus: selected.targetBonus,
      skillId: selected.skillId,
      skillLabel: optionById.get(selected.skillId)!.skillLabel,
      slotCost: selected.slotCost,
      source: 'SELECTED' as const,
    })),
  ];
  return {
    entries,
    usedSlotCount: entries.reduce((sum, entry) => sum + entry.slotCost, 0),
  };
}

function toggleSkillSelectionDraft(
  projection: Chr015Projection,
  draft: CharacterSkillSelectionDraft,
): CharacterSkillSelectionDraft {
  const skillId = draft.candidateSkillIdOrNull;
  if (skillId === null) throw new Error('CHR-015 requires an explicit skill candidate');
  const existing = draft.selectedSkills.find((selected) => selected.skillId === skillId);
  let selectedSkills: readonly SelectedSkillProjection[];
  if (existing !== undefined) {
    selectedSkills = draft.selectedSkills.filter((selected) => selected.skillId !== skillId);
  } else {
    const option = projection.skillOptions.find((candidate) => candidate.skillId === skillId);
    const level = option?.levelOptions.find(
      ({ targetBonus }) => targetBonus === draft.candidateTargetBonusOrNull,
    );
    if (option === undefined || level === undefined) {
      throw new Error('CHR-015 requires a host-signed skill and target bonus candidate');
    }
    const selected = { skillId, slotCost: level.slotCost, targetBonus: level.targetBonus };
    selectedSkills = projection.skillOptions.flatMap((candidate) => {
      if (candidate.skillId === skillId) return [selected];
      const retained = draft.selectedSkills.find((entry) => entry.skillId === candidate.skillId);
      return retained === undefined ? [] : [retained];
    });
  }
  const paidSlotUsage = paidSlotUsageForSkillSelection(projection, selectedSkills);
  return {
    candidateSkillIdOrNull: null,
    candidateTargetBonusOrNull: null,
    formId: 'CHR-015',
    paidSlotUsage,
    selectedSkillIds: selectedSkills.map(({ skillId: selectedSkillId }) => selectedSkillId),
    selectedSkills,
    selectionValidation: skillSelectionValidation(
      projection.requiredSlotCount,
      paidSlotUsage.usedSlotCount,
    ),
  };
}

function completeManualRollDraft(draft: CharacterCreationRollDraft | null): boolean {
  if (draft === null) return false;
  return draft.formId === 'CHR-003'
    ? draft.faces.length === 7 && draft.faces.every((face) => face !== null && isFace(face))
    : draft.face !== null && isFace(draft.face);
}

function visibleSnapshotCore(
  snapshot: ConfirmedProjectionSnapshot,
  identity: IdentityDraftClient | null,
  commandPending = false,
  creationChoice: CharacterCreationChoiceDraft | null = null,
  creationRollDraft: CharacterCreationRollDraft | null = null,
  statAssignmentDraft: CharacterStatAssignmentDraft | null = null,
  skillSelectionDraft: CharacterSkillSelectionDraft | null = null,
  randomSymbiontDraft: RandomSymbiontDraft | null = null,
  advisorSkillSelectionDraft: AdvisorSkillSelectionDraft | null = null,
  skillCardDraft: CharacterSkillCardDraft | null = null,
  manualCompositionDraft: ManualCompositionDraft | null = null,
): ConfirmedProjectionSnapshot {
  if (Object.hasOwn(snapshot.projection, 'correctionContext') || isPostSaveForm(snapshot.formId))
    return commandPending ? { ...snapshot, availableActionKeys: [] } : snapshot;
  if (snapshot.formId === 'CHR-001' && (identity?.state.dirty === true || commandPending)) {
    return {
      ...snapshot,
      availableActionKeys: snapshot.availableActionKeys.filter(
        (key) => key !== IDENTITY_CHECKPOINT_ACTION_KEY,
      ),
    };
  }
  const visibleLayers = commandPending
    ? snapshot.layers.map((layer) => ({ ...layer, availableActionKeys: NO_ACTION_KEYS }))
    : snapshot.layers;
  const presentation =
    visibleLayers === snapshot.layers ? snapshot : { ...snapshot, layers: visibleLayers };
  let availableActionKeys = [...snapshot.availableActionKeys];
  if (snapshot.formId === 'CHR-003') {
    const executable =
      !commandPending &&
      snapshot.executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID) &&
      (snapshot.projection['diceInputModeSnapshot'] === 'AUTO' ||
        (creationRollDraft?.formId === 'CHR-003' && completeManualRollDraft(creationRollDraft)));
    if (!executable) {
      availableActionKeys = availableActionKeys.filter(
        (key) => key !== CHR_003_ROLL_COMMIT_ACTION_KEY,
      );
    }
  } else if (snapshot.formId === 'CHR-004') {
    const executable =
      !commandPending &&
      snapshot.executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID) &&
      (snapshot.projection['diceInputModeSnapshot'] === 'AUTO' ||
        (creationRollDraft?.formId === 'CHR-004' && completeManualRollDraft(creationRollDraft)));
    if (!executable) {
      availableActionKeys = availableActionKeys.filter(
        (key) => key !== CHR_004_ROLL_COMMIT_ACTION_KEY,
      );
    }
  } else if (isCreationSetDecisionFormId(snapshot.formId) && commandPending) {
    availableActionKeys = [];
  } else if (snapshot.formId === 'CHR-011' && commandPending) {
    availableActionKeys = [];
  } else if (
    snapshot.formId === 'CHR-009' &&
    (commandPending || statAssignmentDraft?.validation !== 'READY_TO_CHECKPOINT')
  ) {
    availableActionKeys = [];
  } else if (snapshot.formId === 'CHR-013') {
    availableActionKeys = availableActionKeys.filter((key) => key !== CHR_013_CARD_ACTION_KEY);
  } else if (snapshot.formId === 'CHR-014') {
    const projection = snapshot.projection as Chr014Projection;
    const signedLevel = projection.levelsAndBonuses.some(
      ({ targetBonus }) => targetBonus === skillCardDraft?.targetBonus,
    );
    if (commandPending || skillCardDraft?.formId !== 'CHR-014' || !signedLevel) {
      availableActionKeys = availableActionKeys.filter((key) => key !== CHR_014_ADD_ACTION_KEY);
    }
  } else if (snapshot.formId === 'CHR-015') {
    const projection = snapshot.projection as Chr015Projection;
    const candidateSkillId = skillSelectionDraft?.candidateSkillIdOrNull;
    const selectedCandidate = skillSelectionDraft?.selectedSkills.some(
      ({ skillId }) => skillId === candidateSkillId,
    );
    const candidateOption = projection.skillOptions.find(
      ({ skillId }) => skillId === candidateSkillId,
    );
    const signedLevel = candidateOption?.levelOptions.some(
      ({ targetBonus }) => targetBonus === skillSelectionDraft?.candidateTargetBonusOrNull,
    );
    if (
      commandPending ||
      skillSelectionDraft === null ||
      projection.selectionCheckpoint === 'EXACT' ||
      (!selectedCandidate && signedLevel !== true)
    ) {
      availableActionKeys = availableActionKeys.filter((key) => key !== CHR_015_TOGGLE_ACTION_KEY);
    }
    if (
      !commandPending &&
      projection.selectionCheckpoint !== 'EXACT' &&
      skillSelectionDraft?.selectionValidation.kind === 'EXACT' &&
      snapshot.executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID)
    ) {
      availableActionKeys.push(CHR_015_CONFIRM_ACTION_KEY);
    }
  } else if (snapshot.formId === 'CHR-020') {
    const projection = snapshot.projection;
    const monsterRequired = snapshot.availableActionKeys.includes(CHR_020_MONSTER_DRAFT_ACTION_KEY);
    const manualFace = randomSymbiontDraft?.manualFaceOrNull;
    const manualReady =
      projection.diceInputModeSnapshot === 'AUTO' ||
      (manualFace !== null && manualFace !== undefined && isFace(manualFace));
    const monsterReady =
      !monsterRequired || randomSymbiontDraft?.selectedMonsterSpeciesKeyOrNull != null;
    const executable =
      !commandPending &&
      randomSymbiontDraft !== null &&
      snapshot.executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID) &&
      projection.randomStatus !== 'COMMITTED' &&
      (projection.randomStatus === 'BINDING' || (manualReady && monsterReady));
    if (!executable) {
      availableActionKeys = availableActionKeys.filter(
        (key) => key !== CHR_020_ROLL_COMMIT_ACTION_KEY,
      );
    }
    if (commandPending || randomSymbiontDraft === null) {
      availableActionKeys = availableActionKeys.filter(
        (key) => key !== CHR_020_SIDE_DRAFT_ACTION_KEY && key !== CHR_020_MONSTER_DRAFT_ACTION_KEY,
      );
    }
  } else if (snapshot.formId === 'CHR-018') {
    const included = manualCompositionDraft?.entries.some(
      (entry) => entry.speciesKey === snapshot.projection.speciesKey,
    );
    if (commandPending || manualCompositionDraft === null || included !== true) {
      availableActionKeys = availableActionKeys.filter(
        (key) => key !== CHR_018_MANUAL_ADD_ACTION_KEY,
      );
    }
    if (commandPending || manualCompositionDraft === null) {
      availableActionKeys = availableActionKeys.filter(
        (key) => key !== CHR_018_MANUAL_BINDING_ACTION_KEY,
      );
    }
  } else if (snapshot.formId === 'CHR-041') {
    const pendingIntelligenceFloor =
      'compositionDraftRevision' in snapshot.projection &&
      snapshot.projection.trogrSuppressionState.kind === 'SUPPRESSED' &&
      snapshot.projection.trogrSuppressionState.rollReceiptIdOrNull === null;
    if (commandPending || pendingIntelligenceFloor) {
      availableActionKeys = availableActionKeys.filter(
        (key) => key !== CHR_041_CHECKPOINT_ACTION_KEY && key !== CHR_041_SKILL_DRAFT_ACTION_KEY,
      );
    }
    if (commandPending) {
      availableActionKeys = availableActionKeys.filter(
        (key) =>
          key !== CHR_041_INTELLIGENCE_FLOOR_ACTION_KEY && key !== CHR_041_MANUAL_IW_ACTION_KEY,
      );
    }
    const slots = snapshot.projection.advisorSlotsAndSkills;
    const candidateOption = !isAdvisorSkillSlots(slots)
      ? undefined
      : slots.skillOptions.find(
          ({ skillId }) => skillId === advisorSkillSelectionDraft?.candidateSkillIdOrNull,
        );
    const signedLevel = candidateOption?.levelOptions.some(
      ({ targetBonus }) => targetBonus === advisorSkillSelectionDraft?.candidateTargetBonusOrNull,
    );
    if (commandPending || advisorSkillSelectionDraft === null || signedLevel !== true) {
      availableActionKeys = availableActionKeys.filter(
        (key) => key !== CHR_041_SKILL_DRAFT_ACTION_KEY,
      );
    }
    if (
      commandPending ||
      advisorSkillSelectionDraft?.selectionValidation.kind !== 'EXACT' ||
      !snapshot.executableWorkflowCommandIds.includes(IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID)
    ) {
      availableActionKeys = availableActionKeys.filter(
        (key) => key !== CHR_041_CHECKPOINT_ACTION_KEY,
      );
    }
  }
  const visible =
    availableActionKeys.length === snapshot.availableActionKeys.length &&
    availableActionKeys.every((key, index) => key === snapshot.availableActionKeys[index])
      ? presentation
      : { ...presentation, availableActionKeys };
  if (
    commandPending ||
    creationChoice === null ||
    creationChoice.formId !== snapshot.formId ||
    !snapshot.executableWorkflowCommandIds.includes(SET_DECIDE_WORKFLOW_COMMAND_ID)
  ) {
    return visible;
  }
  return {
    ...visible,
    availableActionKeys: [creationChoice.confirmationActionKey, ...availableActionKeys],
  };
}

function activePresentedForm(snapshot: ConfirmedProjectionSnapshot): {
  readonly availableActionKeys: readonly ActionKey[];
  readonly formId: SupportedPresentationFormId;
  readonly projection: JsonObject;
} {
  return snapshot.layers.at(-1) ?? snapshot;
}

function sameBasePresentation(
  left: ConfirmedProjectionSnapshot,
  right: ConfirmedProjectionSnapshot,
): boolean {
  return (
    left.formId === right.formId &&
    left.path === right.path &&
    left.availableActionKeys.length === right.availableActionKeys.length &&
    left.availableActionKeys.every((key, index) => key === right.availableActionKeys[index]) &&
    sameJson(left.projection, right.projection)
  );
}

function decodeReconnectSnapshot(
  message: ProjectionSnapshotV2Message,
  capabilities: SessionReconnectCapabilitiesV2Message,
  requestId: string,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (capabilities.reconnectRequestId !== requestId) {
    return unrecognized('$.reconnectRequestId', capabilities.reconnectRequestId);
  }
  if (message.presentation.assignment.correlationId !== requestId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'RECONNECT') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  if (
    capabilities.revisions.actorVisibilityRevision !== message.revisions.actorVisibilityRevision ||
    capabilities.revisions.projectionRevision !== message.revisions.projectionRevision ||
    capabilities.revisions.stateRevision !== message.revisions.stateRevision
  ) {
    return unrecognized('$.revisions', { ...message.revisions });
  }
  return decodeConfirmedSnapshot(message, capabilities.executableWorkflowCommandIds);
}

function pendingNetworkCancelSnapshotMatches(
  next: ConfirmedProjectionSnapshot,
  source: ConfirmedProjectionSnapshot,
  request: NetworkWorkflowRequest,
  reconnect: boolean,
): boolean {
  if (
    request.workflowCommandId !== 'UI-CMD-DEVICE-REQUEST-CANCEL' ||
    source.formId !== 'NET-005' ||
    next.formId !== 'NET-005'
  )
    return false;
  const p = source.projection,
    n = next.projection,
    payload = request.payload;
  return (
    n['networkScopeId'] === p['networkScopeId'] &&
    n['networkScopeId'] === payload.networkScopeId &&
    n['deviceId'] === p['deviceId'] &&
    n['controllerSeat'] === p['controllerSeat'] &&
    p['contextId'] === payload.contextId &&
    (reconnect || n['contextId'] === payload.contextId) &&
    n['draftRevision'] === p['draftRevision'] &&
    n['draftRevision'] === payload.expectedDraftRevision &&
    n['campaignIdOrNull'] === p['campaignIdOrNull'] &&
    n['connectionState'] === 'CONNECTING' &&
    n['pendingCommandIdOrNull'] === request.commandId &&
    n['commandId'] === request.commandId &&
    n['sessionId'] === p['sessionId'] &&
    n['sessionId'] === payload.technicalSessionId &&
    n['requestId'] === p['requestId'] &&
    n['requestId'] === payload.requestId &&
    n['requestRevision'] === p['requestRevision'] &&
    n['requestRevision'] === payload.requestRevision &&
    n['requestOwnerDeviceId'] === p['requestOwnerDeviceId'] &&
    n['requestStatus'] === 'PENDING' &&
    n['cancelReason'] === p['cancelReason'] &&
    n['cancelReason'] === payload.reason &&
    n['gmMessage'] === p['gmMessage'] &&
    sameJson(n['batchCharacterSummaries']!, p['batchCharacterSummaries']!) &&
    next.revisions.stateRevision === source.revisions.stateRevision + 1 &&
    next.revisions.projectionRevision >= source.revisions.projectionRevision + 1 &&
    next.revisions.actorVisibilityRevision === source.revisions.actorVisibilityRevision
  );
}

function decodeAddressableRouteSnapshot(
  message: ProjectionSnapshotV2Message,
  pending: AddressableRouteIntentV2Message,
  previous: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (message.presentation.assignment.correlationId !== pending.navigationRequestId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'ADDRESSABLE_ROUTE') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  if (previous.formId === 'APP-004') {
    const selectedId = pending.bindings[0]?.value;
    const entry = (previous.projection as App004Projection).libraryEntries.find(
      (e) => e.localCharacterId === selectedId,
    );
    const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
    if (!decoded.ok) return decoded;
    return entry !== undefined &&
      pending.routeTemplate === LIBRARY_ROUTES[entry.selectionFormId] &&
      decoded.value.formId === entry.selectionFormId &&
      decoded.value.layers.length === 0 &&
      (entry.selectionFormId === 'CHR-001'
        ? decoded.value.projection['characterDraftId']
        : decoded.value.projection['sourceEntityId']) === selectedId
      ? decoded
      : unrecognized('$.presentation.base.roleFilteredPayload', decoded.value.projection);
  }
  if (
    message.revisions.stateRevision !== previous.revisions.stateRevision ||
    message.revisions.actorVisibilityRevision !== previous.revisions.actorVisibilityRevision ||
    message.revisions.projectionRevision !== previous.revisions.projectionRevision + 1
  ) {
    return unrecognized('$.revisions', { ...message.revisions });
  }
  const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
  if (!decoded.ok) return decoded;
  if (Object.hasOwn(previous.projection, 'correctionContext')) {
    const p = previous.projection as CreationCorrectionProjection,
      n = decoded.value.projection as CreationCorrectionProjection;
    return previous.formId === 'CHR-017' &&
      decoded.value.formId === 'CHR-018' &&
      pending.routeTemplate === CHR_018_ROUTE &&
      p.eligibleSymbiontSpecies.some((v) => v.speciesKey === pending.bindings[0]?.value) &&
      n.correctionHeadHash === p.correctionHeadHash &&
      n.summaryReceiptIdOrNull === p.summaryReceiptIdOrNull &&
      n.characterDraftId === p.characterDraftId &&
      n.wizardCheckpointId === p.wizardCheckpointId &&
      n.draftRevision === p.draftRevision
      ? decoded
      : unrecognized('$.presentation.base.roleFilteredPayload', n);
  }

  if (previous.formId === 'CHR-017') {
    const source = previous.projection;
    if (
      decoded.value.formId !== 'CHR-018' ||
      pending.routeTemplate !== CHR_018_ROUTE ||
      source.symbiontAcquisitionModeOrNull !== 'MANUAL' ||
      !previous.availableActionKeys.includes(CHR_017_MANUAL_CARD_ACTION_KEY)
    ) {
      return unrecognized('$.presentation.base.formId', decoded.value.formId);
    }
    const destination = decoded.value.projection;
    const speciesKey = pending.bindings[0]?.value;
    if (
      destination.speciesKey !== speciesKey ||
      !source.eligibleSymbiontSpecies.some((entry) => entry.speciesKey === speciesKey) ||
      destination.characterDraftId !== source.characterDraftId ||
      destination.compositionDraftRevision > source.draftRevision
    ) {
      return unrecognized('$.presentation.base.roleFilteredPayload', destination);
    }
    return decoded;
  }
  if (previous.formId !== 'CHR-013' || decoded.value.formId !== 'CHR-014') {
    return unrecognized('$.presentation.base.formId', decoded.value.formId);
  }
  const source = previous.projection as Chr013Projection;
  const destination = decoded.value.projection as Chr014Projection;
  const skillId = pending.bindings[0]?.value;
  const summary = source.skillCardSummaries.find((card) => card.skillId === skillId);
  if (summary === undefined) {
    return unrecognized('$.presentation.base.roleFilteredPayload', destination);
  }
  const remainingSlots =
    source.slotSources.requiredSlotCount -
    (source.slotSources.mandatoryClassSkillOrNull?.slotCost ?? 0) -
    destination.selectedSkills.reduce((total, selected) => total + selected.slotCost, 0);
  const expectedLevels = summary.levelOptions.filter(({ slotCost }) => slotCost <= remainingSlots);
  if (
    remainingSlots < 0 ||
    destination.skillId !== skillId ||
    destination.characterDraftId !== source.characterDraftId ||
    destination.wizardCheckpointId !== source.wizardCheckpointId ||
    destination.selectionRevision !== source.draftRevision ||
    destination.selectedSkills.some((selected) => {
      const previousCard = source.skillCardSummaries.find(
        (candidate) => candidate.skillId === selected.skillId,
      );
      return (
        previousCard === undefined ||
        !previousCard.levelOptions.some(
          (level) =>
            level.slotCost === selected.slotCost && level.targetBonus === selected.targetBonus,
        )
      );
    }) ||
    !sameJson(destination.skillStageValues, source.skillStageStats) ||
    !sameJson(destination.eligibleSkillIds, source.eligibleSkillIds) ||
    !sameJson(destination.slotSources, source.slotSources) ||
    !sameJson(destination.requirements, summary.requirements) ||
    !sameJson(destination.levelsAndBonuses, expectedLevels) ||
    destination.bonusDomainScope !== summary.bonusDomainScope ||
    destination.skillLabel !== summary.skillLabel ||
    !sameJson(destination.missingSkillPenalty, summary.missingSkillPenalty)
  ) {
    return unrecognized('$.presentation.base.roleFilteredPayload', destination);
  }
  return decoded;
}

function decodeFormActionSnapshot(
  message: ProjectionSnapshotV2Message,
  pending: FormActionIntentV2Message,
  previous: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (message.presentation.assignment.correlationId !== pending.navigationRequestId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'FORM_ACTION') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  if (isAdmissionOwnerForm(pending.sourceFormId)) {
    const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
    if (!decoded.ok) return decoded;
    const target = (
      {
        'NET-006::CTA::001': 'NET-027',
        'NET-007::CTA::001': 'NET-027',
        'NET-027::CTA::001': 'NET-006',
        'NET-027::CTA::002': 'NET-007',
        'NET-007::CTA::002': 'NET-003',
        'NET-007::CTA::003': 'APP-002',
      } as Record<string, string>
    )[pending.actionKey];
    if (
      target !== decoded.value.formId ||
      previous.formId !== pending.sourceFormId ||
      decoded.value.projection['deviceId'] !== previous.projection['deviceId']
    )
      return unrecognized('$.presentation', null);
    if (target === 'APP-002') return decoded;
    if (target === 'NET-003')
      return decoded.value.projection['networkScopeId'] === previous.projection['networkScopeId'] &&
        decoded.value.projection['campaignIdOrNull'] === previous.projection['campaignId'] &&
        decoded.value.revisions.stateRevision > previous.revisions.stateRevision &&
        decoded.value.revisions.projectionRevision > previous.revisions.projectionRevision
        ? decoded
        : unrecognized('$.presentation', null);
    return admissionOwnerMonotonic(decoded.value, previous) &&
      decoded.value.revisions.stateRevision > previous.revisions.stateRevision &&
      decoded.value.revisions.projectionRevision > previous.revisions.projectionRevision
      ? decoded
      : unrecognized('$.presentation', null);
  }
  if (
    isAdmissionGmForm(pending.sourceFormId) ||
    (pending.sourceFormId === 'NET-017' &&
      Object.hasOwn(ADMISSION_GM_NAV_TARGETS, pending.actionKey))
  ) {
    const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
    if (!decoded.ok) return decoded;
    const target =
      ADMISSION_GM_NAV_TARGETS[pending.actionKey as keyof typeof ADMISSION_GM_NAV_TARGETS];
    if (
      activePresentedForm(previous).formId !== pending.sourceFormId ||
      activePresentedForm(decoded.value).formId !== target ||
      !gmQueueMonotonic(decoded.value, previous) ||
      decoded.value.revisions.stateRevision < previous.revisions.stateRevision ||
      decoded.value.revisions.projectionRevision < previous.revisions.projectionRevision + 1
    )
      return unrecognized('$.presentation', null);
    return decoded;
  }
  if (
    (previous.formId === 'CMP-006' && pending.actionKey === 'CMP-006::CTA::002') ||
    (previous.formId === 'NET-017' && pending.actionKey === 'NET-017::CTA::009')
  ) {
    const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
    if (!decoded.ok) return decoded;
    const target = previous.formId === 'CMP-006' ? 'NET-017' : 'CMP-006';
    if (
      pending.sourceFormId !== previous.formId ||
      decoded.value.formId !== target ||
      !gmQueueMonotonic(decoded.value, previous) ||
      decoded.value.revisions.projectionRevision < previous.revisions.projectionRevision + 1
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', null);
    if (previous.formId === 'CMP-006') {
      const p = gmRequestProjection(decoded.value.projection);
      if (
        p === null ||
        p.returnContext.originFormId !== 'CMP-006' ||
        p.returnContext.creationReceiptId !== previous.projection['creationReceiptId']
      )
        return unrecognized('$.returnContext', null);
    } else {
      const p = gmRequestProjection(previous.projection);
      if (
        p === null ||
        p.returnContext.originFormId !== 'CMP-006' ||
        decoded.value.projection['creationReceiptId'] !== p.returnContext.creationReceiptId
      )
        return unrecognized('$.returnContext', null);
    }
    return decoded;
  }
  if (
    isNetworkApplicationForm(previous.formId) ||
    pending.actionKey === 'APP-002::CTA::003' ||
    pending.actionKey === 'CHR-040::CTA::002'
  ) {
    const targets: Partial<Record<ActionKey, FormId>> = {
      'APP-002::CTA::003': 'NET-001',
      'CHR-040::CTA::002': 'CHR-027',
      'NET-001::CTA::001': 'NET-002',
      'NET-001::CTA::002': 'NET-003',
      'NET-001::CTA::003': 'APP-002',
      'NET-002::CTA::001': 'NET-001',
      'NET-002::CTA::002': 'NET-003',
      'NET-002::CTA::004': 'APP-002',
      'NET-003::CTA::001': 'NET-004',
      'NET-003::CTA::002': 'CHR-027',
      'NET-003::CTA::003': 'NET-005',
      'NET-004::CTA::001': 'NET-003',
      'NET-004::CTA::003': 'NET-003',
      'NET-005::CTA::003': 'NET-003',
      'NET-011::CTA::004': 'NET-002',
      'NET-011::CTA::005': 'APP-002',
      'CHR-027::CTA::001': 'NET-004',
      'CHR-027::CTA::002': 'CHR-040',
    };
    const target = targets[pending.actionKey];
    if (target === undefined || pending.sourceFormId !== previous.formId)
      return unrecognized('$.presentation.base.formId', null);
    const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
    if (!decoded.ok) return decoded;
    if (decoded.value.formId !== target || decoded.value.layers.length !== 0)
      return unrecognized('$.presentation.base.formId', null);
    const p = previous.projection,
      n = decoded.value.projection;
    if (pending.actionKey === 'APP-002::CTA::003' || pending.actionKey === 'CHR-040::CTA::002') {
      // The first FINAL entry pins its candidate through one data/presentation NAVIGATE event.
      const freshFinalEntry =
        n['campaignIdOrNull'] === null &&
        n['connectionState'] === 'NO_TECHNICAL_SESSION' &&
        n['draftRevision'] === 0 &&
        sameNetworkRevisions(decoded.value.revisions, {
          stateRevision: 1,
          projectionRevision: 1,
          actorVisibilityRevision: 0,
        });
      const retainedFinalEntry =
        n['campaignIdOrNull'] !== null &&
        (n['connectionState'] === 'CONNECTED_TECHNICAL' || n['connectionState'] === 'LOST') &&
        decoded.value.revisions.stateRevision > 0 &&
        decoded.value.revisions.projectionRevision > decoded.value.revisions.stateRevision;
      if (
        (previous.formId === 'APP-002' &&
          (!sameNetworkRevisions(decoded.value.revisions, NO_KNOWN_REVISIONS) ||
            n['deviceId'] !== p['deviceId'])) ||
        (previous.formId === 'CHR-040' &&
          (n['pendingCommandIdOrNull'] !== null ||
            n['commandId'] !== null ||
            (!freshFinalEntry && !retainedFinalEntry) ||
            n['localCharacterUuid'] !== p['localCharacterUuid'] ||
            n['finalSnapshotVersion'] !== p['finalSnapshotVersion'] ||
            n['candidateSnapshotChecksum'] !== (p['provenance'] as JsonObject)['sourceChecksum']))
      )
        return unrecognized('$.presentation.base.roleFilteredPayload', null);
      return decoded;
    }
    if (!isNetworkApplicationForm(target)) {
      if (target === 'APP-002')
        return n['deviceId'] === p['deviceId']
          ? decoded
          : unrecognized('$.presentation.base.roleFilteredPayload', null);
      return n['localCharacterUuid'] === p['localCharacterUuid'] &&
        n['finalSnapshotVersion'] === p['finalSnapshotVersion'] &&
        (n['provenance'] as JsonObject)['sourceChecksum'] === p['candidateSnapshotChecksum']
        ? decoded
        : unrecognized('$.presentation.base.roleFilteredPayload', null);
    }
    if (
      pending.actionKey === 'NET-005::CTA::003' &&
      (p['requestStatus'] !== 'REJECTED' ||
        p['connectionState'] !== 'CONNECTED_TECHNICAL' ||
        p['pendingCommandIdOrNull'] !== null ||
        n['pendingCommandIdOrNull'] !== null ||
        n['campaignIdOrNull'] !== p['campaignIdOrNull'] ||
        n['sessionId'] !== p['sessionId'] ||
        n['ownRequestIdOrNull'] !== null)
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', null);
    const prepare =
      pending.actionKey === 'NET-003::CTA::001' || pending.actionKey === 'CHR-027::CTA::001';
    if (
      n['networkScopeId'] !== p['networkScopeId'] ||
      n['deviceId'] !== p['deviceId'] ||
      n['controllerSeat'] !== p['controllerSeat'] ||
      n['contextId'] !== p['contextId'] ||
      n['draftRevision'] !== p['draftRevision'] ||
      !sameNetworkRevisions(decoded.value.revisions, {
        ...previous.revisions,
        stateRevision: previous.revisions.stateRevision + (prepare ? 1 : 0),
        projectionRevision: previous.revisions.projectionRevision + 1,
      })
    )
      return unrecognized('$.revisions', null);
    if (prepare) {
      const batch = n['batchCharacterSummaries'] as readonly JsonObject[];
      if (previous.formId === 'CHR-027') {
        const single = batch[0];
        if (
          batch.length !== 1 ||
          single === undefined ||
          single['sourceUuid'] !== p['localCharacterUuid'] ||
          single['candidateSnapshotChecksum'] !== p['candidateSnapshotChecksum'] ||
          n['campaignIdOrNull'] !== p['selectedCampaignId']
        )
          return unrecognized('$.presentation.base.roleFilteredPayload', null);
      } else {
        const selected = p['selectedCandidates'] as readonly JsonObject[];
        if (
          batch.length !== selected.length ||
          selected.some((entry, index) =>
            Object.keys(entry).some((key) => batch[index]?.[key] !== entry[key]),
          )
        )
          return unrecognized('$.presentation.base.roleFilteredPayload', null);
      }
    }
    return decoded;
  }
  if (isCampaignCreationForm(previous.formId) || pending.actionKey === 'APP-001::CTA::002') {
    const targets: Partial<Record<ActionKey, string>> = {
      'APP-001::CTA::002': 'APP-011',
      'APP-011::CTA::001': 'APP-001',
      'APP-011::CTA::006': 'CMP-001',
      'CMP-001::CTA::001': 'CMP-002',
      'CMP-001::CTA::002': 'APP-011',
      'CMP-002::CTA::001': 'CMP-001',
      'CMP-002::CTA::002': 'CMP-003',
      'CMP-003::CTA::001': 'CMP-002',
      'CMP-003::CTA::002': 'CMP-004',
      'CMP-004::CTA::001': 'CMP-003',
      'CMP-004::CTA::002': 'CMP-005',
      'CMP-005::CTA::002': 'CMP-004',
    };
    const decoded = decodeConfirmedSnapshot(
      message,
      pending.actionKey === 'APP-011::CTA::001'
        ? previous.executableWorkflowCommandIds.filter(
            (id) =>
              id !== CAMPAIGN_CREATE_COMMAND_ID &&
              !NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS.some((gmId) => gmId === id),
          )
        : previous.executableWorkflowCommandIds,
    );
    if (!decoded.ok) return decoded;
    if (
      pending.sourceFormId !== previous.formId ||
      decoded.value.formId !== targets[pending.actionKey] ||
      decoded.value.layers.length !== 0
    )
      return unrecognized('$.presentation.base.formId', decoded.value.formId);
    const source = previous.projection,
      target = decoded.value.projection;
    if (pending.actionKey === 'APP-001::CTA::002')
      return decoded.value.revisions.stateRevision === 0 &&
        decoded.value.revisions.actorVisibilityRevision === 0
        ? decoded
        : unrecognized('$.revisions', null);
    if (pending.actionKey === 'APP-011::CTA::001') return decoded;
    if (
      target['gmLocalContextId'] !== source['gmLocalContextId'] ||
      target['hostDeviceId'] !== source['hostDeviceId'] ||
      target['masterAuthorityRevision'] !== source['masterAuthorityRevision']
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', null);
    if (pending.actionKey === 'APP-011::CTA::006')
      return target['draftRevision'] === 0 &&
        sameCampaignRevisions(decoded.value.revisions, NO_KNOWN_REVISIONS)
        ? decoded
        : unrecognized('$.revisions', null);
    // MENU owns an independent persisted vector, unavailable after a browser restart.
    if (pending.actionKey === 'CMP-001::CTA::002') return decoded;
    return target['campaignDraftId'] === source['campaignDraftId'] &&
      target['draftRevision'] === source['draftRevision'] &&
      sameCampaignRevisions(decoded.value.revisions, {
        ...previous.revisions,
        projectionRevision: previous.revisions.projectionRevision + 1,
      })
      ? decoded
      : unrecognized('$.revisions', null);
  }
  if (isPostSaveForm(previous.formId) || pending.actionKey === 'CHR-025::CTA::009') {
    const targets: Partial<Record<ActionKey, FormId>> = {
      'CHR-026::CTA::001': 'APP-009',
      'CHR-026::CTA::002': 'APP-004',
      'APP-009::CTA::002': 'APP-004',
      'CHR-039::CTA::001': 'CHR-017',
      'CHR-039::CTA::002': 'CHR-019',
      'CHR-039::CTA::003': 'CHR-032',
      'CHR-039::CTA::004': 'CHR-025',
      'CHR-040::CTA::001': 'APP-010',
      'CHR-040::CTA::003': 'APP-004',
      'APP-010::CTA::001': 'APP-004',
      'APP-010::CTA::002': 'CHR-040',
      'APP-010::CTA::003': 'CMP-012',
      'CHR-025::CTA::009': 'CHR-039',
    };
    const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
    if (!decoded.ok) return decoded;
    const p = previous.projection,
      n = decoded.value.projection;
    const owner = p['sourceEntityId'] ?? p['characterDraftId'];
    if (
      p['postSaveScopeId'] !== undefined &&
      p['postSaveScopeId'] === n['postSaveScopeId'] &&
      (message.revisions.stateRevision !== previous.revisions.stateRevision ||
        message.revisions.actorVisibilityRevision !== previous.revisions.actorVisibilityRevision ||
        message.revisions.projectionRevision !== previous.revisions.projectionRevision + 1)
    )
      return unrecognized('$.revisions', { ...message.revisions });
    if (decoded.value.formId !== targets[pending.actionKey] || decoded.value.layers.length !== 0)
      return unrecognized('$.presentation.base.formId', decoded.value.formId);
    if (
      decoded.value.formId !== 'APP-004' &&
      (decoded.value.formId as string) !== 'CMP-012' &&
      (n['sourceEntityId'] ?? n['characterDraftId']) !== owner
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', n);
    if (
      previous.formId === 'CHR-039' &&
      (decoded.value.formId !== p['returnFormId'] ||
        n['wizardCheckpointId'] !== p['wizardCheckpointId'] ||
        n['draftRevision'] !== p['draftRevision'])
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', n);
    if (
      decoded.value.formId === 'CHR-039' &&
      (n['returnFormId'] !== previous.formId ||
        n['wizardCheckpointId'] !== p['wizardCheckpointId'] ||
        n['draftRevision'] !== p['draftRevision'])
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', n);
    if (
      decoded.value.formId === 'APP-010' &&
      (n['originFormId'] !== previous.formId || n['ownerContext'] !== 'PLAYER_LOCAL')
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', n);
    return decoded;
  }
  if (
    message.revisions.stateRevision !== previous.revisions.stateRevision ||
    message.revisions.actorVisibilityRevision !== previous.revisions.actorVisibilityRevision ||
    message.revisions.projectionRevision !== previous.revisions.projectionRevision + 1
  ) {
    return unrecognized('$.revisions', { ...message.revisions });
  }
  const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
  if (!decoded.ok) return decoded;
  if (
    Object.hasOwn(previous.projection, 'correctionContext') ||
    Object.hasOwn(decoded.value.projection, 'correctionContext') ||
    previous.formId === 'CHR-025' ||
    previous.formId === 'CHR-032' ||
    (previous.formId === 'CHR-037' && previous.projection['summaryEntryMode'] === 'RESUME')
  ) {
    const targets: Partial<Record<ActionKey, string>> = {
      'CHR-025::CTA::001': 'CHR-001',
      'CHR-025::CTA::002': 'CHR-010',
      'CHR-025::CTA::003': 'CHR-009',
      'CHR-025::CTA::004': 'CHR-015',
      'CHR-025::CTA::005': 'CHR-019',
      'CHR-025::CTA::006': 'CHR-032',
      'CHR-032::CTA::001': 'CHR-025',
      'CHR-032::CTA::002': 'CHR-021',
      'CHR-032::CTA::003': 'CHR-022',
      'CHR-032::CTA::004': 'CHR-038',
      'CHR-032::CTA::005': 'CHR-037',
      'CHR-037::CTA::001': 'CHR-032',
      'CHR-009::CTA::003': 'CHR-010',
      'CHR-017::CTA::002': 'CHR-019',
      'CHR-017::CTA::003': 'CHR-020',
      'CHR-017::CTA::006': 'CHR-015',
      'CHR-018::CTA::002': 'CHR-017',
      'CHR-019::CTA::004': 'CHR-017',
      'CHR-019::CTA::002': 'CHR-042',
      'CHR-042::CTA::002': 'CHR-019',
    };
    const p = previous.projection,
      n = decoded.value.projection;
    if (
      decoded.value.formId !== targets[pending.actionKey] ||
      decoded.value.layers.length !== 0 ||
      n['characterDraftId'] !== p['characterDraftId'] ||
      n['wizardCheckpointId'] !== p['wizardCheckpointId'] ||
      n['draftRevision'] !== p['draftRevision'] ||
      (n['correctionHeadHash'] !== undefined &&
        p['correctionHeadHash'] !== undefined &&
        n['correctionHeadHash'] !== p['correctionHeadHash']) ||
      (n['summaryReceiptIdOrNull'] !== undefined &&
        p['summaryReceiptIdOrNull'] !== undefined &&
        n['summaryReceiptIdOrNull'] !== p['summaryReceiptIdOrNull'])
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', n);
    if (previous.formId === 'CHR-037' && decoded.value.formId === 'CHR-032') {
      const positions = previous.projection as Chr037Projection,
        summary = decoded.value.projection as Chr032Projection;
      const rows = summary.fivePositions.map((row) => {
        const { ownershipState: _ownership, ...rest } = row;
        return rest;
      });
      if (
        summary.propertyCheckpointReceiptId !== positions.positionsCheckpointReceiptIdOrNull ||
        !sameJson(rows, positions.positions)
      )
        return unrecognized('$.presentation.base.roleFilteredPayload', n);
    }
    return decoded;
  }

  if (pending.sourceFormId === 'CHR-014' && pending.actionKey === CHR_014_RETURN_ACTION_KEY) {
    if (previous.formId !== 'CHR-014' || decoded.value.formId !== 'CHR-013') {
      return unrecognized('$.presentation.base.formId', decoded.value.formId);
    }
    const source = previous.projection as Chr014Projection;
    const destination = decoded.value.projection as Chr013Projection;
    if (
      decoded.value.layers.length !== 0 ||
      destination.characterDraftId !== source.characterDraftId ||
      destination.wizardCheckpointId !== source.wizardCheckpointId ||
      destination.draftRevision !== source.selectionRevision ||
      destination.selectedSkillIdOrNull !== null ||
      !sameJson(destination.eligibleSkillIds, source.eligibleSkillIds) ||
      !sameJson(destination.slotSources, source.slotSources) ||
      !sameJson(destination.skillStageStats, source.skillStageValues)
    ) {
      return unrecognized('$.presentation.base.roleFilteredPayload', destination);
    }
  }
  if (pending.sourceFormId === 'CHR-013' && pending.actionKey === 'CHR-013::CTA::002') {
    const source = previous.projection as Chr013Projection;
    if (decoded.value.formId !== 'CHR-015' || decoded.value.layers.length !== 0) {
      return unrecognized('$.presentation.base.formId', decoded.value.formId);
    }
    const destination = decoded.value.projection as Chr015Projection;
    const expectedOptions = source.skillCardSummaries
      .filter(({ eligibility }) => eligibility === 'ELIGIBLE')
      .map(({ bonusDomainScope, levelOptions, missingSkillPenalty, skillId, skillLabel }) => ({
        bonusDomainScope,
        levelOptions,
        missingSkillPenalty,
        skillId,
        skillLabel,
      }));
    if (
      destination.characterDraftId !== source.characterDraftId ||
      destination.wizardCheckpointId !== source.wizardCheckpointId ||
      destination.draftRevision !== source.draftRevision ||
      (destination.selectionCheckpoint !== 'NONE' &&
        destination.selectionCheckpoint !== 'PARTIAL') ||
      !sameJson(destination.eligibleSkillIds, source.eligibleSkillIds) ||
      !sameJson(destination.skillOptions, expectedOptions) ||
      !sameJson(
        destination.mandatoryClassSkillOrNull,
        source.slotSources.mandatoryClassSkillOrNull,
      ) ||
      !sameJson(destination.racialFreeSkills, source.slotSources.racialFreeSkills) ||
      destination.requiredSlotCount !== source.slotSources.requiredSlotCount ||
      (destination.selectionCheckpoint === 'NONE'
        ? destination.selectedSkills.length !== 0
        : destination.selectedSkills.length === 0)
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.skillOptions',
        destination.skillOptions,
      );
    }
  }
  if (
    isCreationSetDecisionFormId(pending.sourceFormId) &&
    pending.actionKey === CREATION_SET_DECISION_FORMS[pending.sourceFormId].alternateActionKey
  ) {
    if (
      previous.layers.length !== 0 ||
      decoded.value.layers.length !== 1 ||
      !sameBasePresentation(decoded.value, previous)
    ) {
      return unrecognized(
        '$.presentation.layers',
        message.presentation.layers.map((layer) => layer.formId),
      );
    }
  }
  if (pending.sourceFormId === 'CHR-017' && pending.actionKey === 'CHR-017::CTA::003') {
    const source = previous.projection;
    if (
      previous.formId !== 'CHR-017' ||
      decoded.value.formId !== 'CHR-020' ||
      source.symbiontAcquisitionModeOrNull !== 'RANDOM' ||
      decoded.value.projection.characterDraftId !== source.characterDraftId ||
      decoded.value.projection.wizardCheckpointId !== source.wizardCheckpointId ||
      decoded.value.projection.draftRevision !== source.draftRevision ||
      decoded.value.projection.randomStatus !== 'NOT_STARTED'
    ) {
      return unrecognized('$.presentation.base.formId', decoded.value.formId);
    }
    return decoded;
  }
  if (
    (pending.sourceFormId === 'CHR-022' && pending.actionKey === 'CHR-022::CTA::003') ||
    (pending.sourceFormId === 'CHR-021' && pending.actionKey === 'CHR-021::CTA::001')
  ) {
    const source = previous.projection;
    const destination = decoded.value.projection;
    const resume = pending.sourceFormId === 'CHR-021';
    if (
      previous.formId !== pending.sourceFormId ||
      decoded.value.formId !== (resume ? 'CHR-022' : 'CHR-021') ||
      previous.layers.length !== 0 ||
      decoded.value.layers.length !== 0 ||
      destination['characterDraftId'] !== source['characterDraftId'] ||
      destination['wizardCheckpointId'] !== source['wizardCheckpointId'] ||
      destination['draftRevision'] !== source['draftRevision'] ||
      (resume
        ? source['weaponEntryMode'] !== 'RESUME'
        : destination['weaponEntryMode'] !== 'RESUME')
    ) {
      return unrecognized('$.presentation.base.roleFilteredPayload', destination);
    }
    return decoded;
  }
  if (
    (pending.sourceFormId === 'CHR-037' && pending.actionKey === CHR_037_RETURN_ACTION_KEY) ||
    (pending.sourceFormId === 'CHR-038' && pending.actionKey === CHR_038_CONFIRM_ACTION_KEY)
  ) {
    const returning = pending.sourceFormId === 'CHR-037';
    const positions = (
      returning ? previous.projection : decoded.value.projection
    ) as Chr037Projection;
    const money = (returning ? decoded.value.projection : previous.projection) as Chr038Projection;
    if (
      previous.formId !== pending.sourceFormId ||
      decoded.value.formId !== (returning ? 'CHR-038' : 'CHR-037') ||
      previous.layers.length !== 0 ||
      decoded.value.layers.length !== 0 ||
      money.positionsEntryMode !== 'RESUME' ||
      (positions.positionsCheckpointReceiptIdOrNull !== null &&
        positions.summaryEntryMode !== 'RESUME') ||
      positions.moneyCheckpointReceiptId !== money.moneyCheckpointReceiptIdOrNull ||
      positions.moneyRollRequestId !== money.moneyRollRequestId ||
      positions.moneyRollReceiptId !== money.moneyRollReceiptIdOrNull ||
      positions.diceInputModeSnapshot !== money.diceInputModeSnapshot ||
      positions.characterDraftId !== money.characterDraftId ||
      positions.wizardCheckpointId !== money.wizardCheckpointId ||
      positions.draftRevision !== money.draftRevision ||
      !sameJson(positions.positions, money.positionsOrNull)
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', decoded.value.projection);
    return decoded;
  }
  if (pending.sourceFormId === 'CHR-038' && pending.actionKey === CHR_038_RETURN_ACTION_KEY) {
    const money = previous.projection as Chr038Projection;
    const weapon = decoded.value.projection as Chr022Projection;
    if (
      previous.formId !== 'CHR-038' ||
      decoded.value.formId !== 'CHR-022' ||
      previous.layers.length !== 0 ||
      decoded.value.layers.length !== 0 ||
      money.moneyCheckpointReceiptIdOrNull !== null ||
      weapon.weaponProfileEntryMode !== 'RESUME' ||
      weapon.moneyRollRequestIdOrNull !== money.moneyRollRequestId ||
      weapon.moneyRollReceiptIdOrNull !== money.moneyRollReceiptIdOrNull ||
      weapon.weaponCheckpointReceiptIdOrNull !== money.weaponCheckpointReceiptId ||
      weapon.nextFormId !== money.weaponProfileFormId ||
      weapon.characterDraftId !== money.characterDraftId ||
      weapon.wizardCheckpointId !== money.wizardCheckpointId ||
      weapon.draftRevision !== money.draftRevision
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', decoded.value.projection);
    return decoded;
  }
  if (
    (pending.sourceFormId === 'CHR-023' && pending.actionKey === CHR_023_SUBMIT_ACTION_KEY) ||
    (pending.sourceFormId === 'CHR-024' && pending.actionKey === CHR_024_ACKNOWLEDGE_ACTION_KEY)
  ) {
    const profile = previous.projection as Chr023Projection | Chr024Projection;
    const money = decoded.value.projection as Chr038Projection;
    const receiptId =
      pending.sourceFormId === 'CHR-023'
        ? (profile as Chr023Projection).profileReceiptIdOrNull
        : (profile as Chr024Projection).acknowledgedReceiptIdOrNull;
    if (
      previous.formId !== pending.sourceFormId ||
      decoded.value.formId !== 'CHR-038' ||
      previous.layers.length !== 0 ||
      decoded.value.layers.length !== 0 ||
      profile.moneyEntryMode !== 'RESUME' ||
      (money.moneyCheckpointReceiptIdOrNull !== null &&
        (money.positionsEntryMode !== 'RESUME' ||
          money.positionsOrNull === null ||
          money.positionsOrNull.some((position) => position.qualityRollReceiptId === null))) ||
      money.weaponProfileFormId !== pending.sourceFormId ||
      money.profileReceiptId !== receiptId ||
      money.moneyRollRequestId !== profile.moneyRollRequestIdOrNull ||
      money.moneyRollReceiptIdOrNull !== profile.moneyRollReceiptIdOrNull ||
      money.weaponCheckpointReceiptId !== profile.weaponCheckpointReceiptId ||
      money.characterDraftId !== profile.characterDraftId ||
      money.wizardCheckpointId !== profile.wizardCheckpointId ||
      money.draftRevision !== profile.draftRevision
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', decoded.value.projection);
    return decoded;
  }
  if (pending.sourceFormId === 'CHR-031' && pending.actionKey === CHR_031_RETURN_ACTION_KEY) {
    if (
      previous.formId !== 'CHR-023' ||
      previous.layers.length !== 1 ||
      previous.layers[0]?.formId !== 'CHR-031' ||
      decoded.value.formId !== 'CHR-023' ||
      decoded.value.layers.length !== 0 ||
      !sameJson(previous.projection, decoded.value.projection)
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', decoded.value.projection);
    return decoded;
  }
  if (
    (pending.sourceFormId === 'CHR-023' && pending.actionKey === 'CHR-023::CTA::002') ||
    (pending.sourceFormId === 'CHR-024' && pending.actionKey === 'CHR-024::CTA::002') ||
    (pending.sourceFormId === 'CHR-022' &&
      (pending.actionKey === 'CHR-022::CTA::001' || pending.actionKey === 'CHR-022::CTA::002'))
  ) {
    const returning = pending.sourceFormId !== 'CHR-022';
    const weapon = (returning ? decoded.value.projection : previous.projection) as Chr022Projection;
    const profile = (returning ? previous.projection : decoded.value.projection) as
      Chr023Projection | Chr024Projection;
    if (
      previous.formId !== pending.sourceFormId ||
      previous.layers.length !== 0 ||
      decoded.value.layers.length !== 0 ||
      (returning
        ? decoded.value.formId !== 'CHR-022'
        : decoded.value.formId !== (weapon.raceChoice === 'PURE' ? 'CHR-024' : 'CHR-023')) ||
      weapon.weaponProfileEntryMode !== 'RESUME' ||
      weapon.weaponProfileRequestIdOrNull !== profile.requestId ||
      weapon.moneyRollRequestIdOrNull !== profile.moneyRollRequestIdOrNull ||
      weapon.moneyRollReceiptIdOrNull !== profile.moneyRollReceiptIdOrNull ||
      weapon.weaponTypeId !== profile.weaponTypeId ||
      weapon.weaponVariant !== profile.weaponVariantId ||
      weapon.weaponQualityRollRequestId !== profile.weaponQualityRollRequestId ||
      weapon.weaponQualityRollReceiptIdOrNull !== profile.weaponQualityRollReceiptId ||
      weapon.weaponCheckpointReceiptIdOrNull !== profile.weaponCheckpointReceiptId ||
      weapon.characterDraftId !== profile.characterDraftId ||
      weapon.wizardCheckpointId !== profile.wizardCheckpointId ||
      weapon.draftRevision !== profile.draftRevision
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', decoded.value.projection);
    return decoded;
  }
  if (
    (previous.projection['raceChoice'] === 'PURE' &&
      (pending.sourceFormId === 'CHR-017' || pending.sourceFormId === 'CHR-019')) ||
    (pending.sourceFormId === 'CHR-021' &&
      pending.actionKey === 'CHR-021::CTA::002' &&
      decoded.value.projection['raceChoice'] === 'PURE')
  ) {
    const source = previous.projection;
    const destination = decoded.value.projection;
    const target =
      pending.actionKey === 'CHR-017::CTA::004'
        ? 'CHR-021'
        : pending.actionKey === 'CHR-017::CTA::006'
          ? 'CHR-015'
          : pending.actionKey === 'CHR-019::CTA::004'
            ? 'CHR-017'
            : pending.actionKey === 'CHR-021::CTA::002'
              ? 'CHR-019'
              : null;
    if (
      target === null ||
      previous.formId !== pending.sourceFormId ||
      decoded.value.formId !== target ||
      previous.layers.length !== 0 ||
      decoded.value.layers.length !== 0 ||
      destination['characterDraftId'] !== source['characterDraftId'] ||
      destination['wizardCheckpointId'] !== source['wizardCheckpointId'] ||
      destination['draftRevision'] !== source['draftRevision'] ||
      (target === 'CHR-021' && source['pureCompositionCheckpointed'] !== true) ||
      (target === 'CHR-015' && destination['pureEquipmentInitializationRequired'] !== true) ||
      (target === 'CHR-017' && destination['pureCompositionCheckpointed'] !== true)
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', destination);
    return decoded;
  }
  if (
    pending.sourceFormId === 'CHR-017' ||
    pending.sourceFormId === 'CHR-018' ||
    pending.sourceFormId === 'CHR-019' ||
    pending.sourceFormId === 'CHR-042'
  ) {
    if (previous.formId !== pending.sourceFormId) {
      return unrecognized('$.presentation.base.formId', previous.formId);
    }
    const source: JsonObject = previous.projection;
    const destination: JsonObject = decoded.value.projection;
    const sourceRevision = source['draftRevision'] ?? source['compositionDraftRevision'];
    let expectedForm: SupportedPresentationFormId;
    switch (pending.actionKey) {
      case 'CHR-017::CTA::002':
        expectedForm = 'CHR-019';
        break;
      case 'CHR-018::CTA::002':
      case 'CHR-019::CTA::004':
        expectedForm = 'CHR-017';
        break;
      case 'CHR-019::CTA::001':
        expectedForm = 'CHR-021';
        break;
      case 'CHR-019::CTA::002':
        expectedForm = 'CHR-042';
        break;
      case 'CHR-042::CTA::002':
        expectedForm = 'CHR-019';
        break;
      default:
        return unrecognized('$.request.actionKey', pending.actionKey);
    }
    if (
      decoded.value.formId !== expectedForm ||
      decoded.value.layers.length !== 0 ||
      previous.layers.length !== 0 ||
      destination['characterDraftId'] !== source['characterDraftId'] ||
      (pending.sourceFormId !== 'CHR-018' &&
        destination['wizardCheckpointId'] !== source['wizardCheckpointId']) ||
      destination['draftRevision'] !== sourceRevision
    ) {
      return unrecognized('$.presentation.base.roleFilteredPayload', destination);
    }
    const fields = [
      'bindings',
      'speciesKeys',
      'symbiontInstancesDraft',
      'slotUsageAndCapacity',
    ] as const;
    const duplicate = destination['duplicatePolicy'];
    const after =
      pending.sourceFormId === 'CHR-042'
        ? source['compositionAfter']
        : destination['compositionAfter'];
    let contentMatches: boolean;
    if (pending.sourceFormId === 'CHR-017') {
      contentMatches =
        isJsonObject(duplicate) &&
        duplicate['kind'] === 'FORBIDDEN' &&
        sameJson(destination['bindings']!, source['manualCompositionDraft']!);
    } else if (pending.sourceFormId === 'CHR-018') {
      contentMatches = destination['symbiontAcquisitionModeOrNull'] === 'MANUAL';
    } else if (pending.sourceFormId === 'CHR-019') {
      contentMatches =
        pending.actionKey === 'CHR-019::CTA::001'
          ? source['armorBundleEntryMode'] === 'RESUME' &&
            destination['nextFormId'] === 'CHR-021' &&
            destination['qualityRollReceiptIdOrNull'] !== null &&
            destination['bundleCheckpointReceiptIdOrNull'] === null
          : pending.actionKey === 'CHR-019::CTA::002'
            ? isJsonObject(after) && fields.every((key) => sameJson(after[key]!, source[key]!))
            : destination['symbiontAcquisitionModeOrNull'] === 'MANUAL' &&
              sameJson(destination['manualCompositionDraft']!, source['bindings']!);
    } else {
      contentMatches =
        isJsonObject(duplicate) &&
        duplicate['kind'] === 'FORBIDDEN' &&
        isJsonObject(after) &&
        fields.every((key) => sameJson(destination[key]!, after[key]!));
    }
    if (!contentMatches) {
      return unrecognized('$.presentation.base.roleFilteredPayload', destination);
    }
  }
  return decoded;
}

function decodeCheckpointTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.replay' | 'command.result' }
  >,
  pending: PendingCheckpoint,
): DecodeResult<CommandReceipt<CheckpointResult>> {
  if ((pending.request.payload as JsonObject)['stage'] === 'FINALIZATION')
    return decodeCreationFinalizationTerminal(
      message,
      pending.request,
      pending.sourceSnapshot,
    ) as DecodeResult<CommandReceipt<CheckpointResult>>;
  if (
    (pending.request.payload as { readonly variant?: string }).variant ===
    'FIVE_STARTING_POSITIONS_CHECKPOINT'
  )
    return decodeFiveStartingPositionsTerminal(
      message,
      pending.request as unknown as FiveStartingPositionsRequest,
      pending.sourceSnapshot,
    ) as DecodeResult<CommandReceipt<CheckpointResult>>;
  if (
    (pending.request.payload as { readonly variant?: string }).variant ===
    'STARTING_MONEY_CHECKPOINT'
  )
    return decodeStartingMoneyTerminal(
      message,
      pending.request as unknown as StartingMoneyRequest,
      pending.sourceSnapshot,
    ) as DecodeResult<CommandReceipt<CheckpointResult>>;
  if (
    ['WEAPON_PROFILE_ENTRY', 'WEAPON_PROFILE_SUBMIT', 'WEAPON_PROFILE_ACKNOWLEDGE'].includes(
      (pending.request.payload as { readonly variant?: string }).variant ?? '',
    )
  ) {
    return decodeWeaponProfileTerminal(
      message,
      pending.request as unknown as WeaponProfileRequest,
      pending.sourceSnapshot,
    ) as DecodeResult<CommandReceipt<CheckpointResult>>;
  }
  if (
    pending.request.payload.stage === 'SYMBIONTS' &&
    ['STARTING_WEAPON_ENTRY', 'STARTING_WEAPON_CHECKPOINT'].includes(
      (pending.request.payload as { readonly variant?: string }).variant ?? '',
    )
  ) {
    return decodeStartingWeaponTerminal(
      message,
      pending.request as unknown as StartingWeaponEntryRequest | StartingWeaponCheckpointRequest,
      pending.sourceSnapshot,
    ) as DecodeResult<CommandReceipt<CheckpointResult>>;
  }
  if (
    pending.request.payload.stage === 'SYMBIONTS' &&
    'variant' in pending.request.payload &&
    pending.request.payload.variant === 'MANUAL_INTERACTION_CONFIRMATION'
  ) {
    return decodeManualInteractionConfirmationTerminal(
      message,
      pending.request as ManualInteractionConfirmationRequest,
      pending.sourceSnapshot,
    );
  }
  if (
    pending.request.payload.stage === 'SYMBIONTS' &&
    'variant' in pending.request.payload &&
    (pending.request.payload as { readonly variant: string }).variant === 'ARMOR_BUNDLE_ENTRY'
  ) {
    const receipt = message.receipt;
    if (receipt.commandId !== pending.request.commandId) {
      return unrecognized('$.receipt.commandId', receipt.commandId);
    }
    if (receipt.receiptId.trim().length === 0) {
      return unrecognized('$.receipt.receiptId', receipt.receiptId);
    }
    const result = receipt.result;
    if (
      result['variant'] !== 'ARMOR_BUNDLE_ENTRY' ||
      result['sourceFormId'] !== 'CHR-019' ||
      result['nextFormId'] !== 'CHR-021' ||
      result['stage'] !== 'SYMBIONTS'
    ) {
      return unrecognized('$.receipt.result.variant', result['variant'] ?? null);
    }
    return { ok: true, value: receipt as CommandReceipt<CheckpointResult> };
  }
  if (
    pending.request.payload.stage === 'SYMBIONTS' &&
    'variant' in pending.request.payload &&
    (pending.request.payload as { readonly variant: string }).variant === 'ARMOR_BUNDLE_CHECKPOINT'
  ) {
    return decodeArmorBundleCheckpointTerminal(
      message,
      pending.request as unknown as ArmorBundleCheckpointRequest,
      pending.sourceSnapshot as unknown as ArmorBundleSnapshotSource,
    ) as DecodeResult<CommandReceipt<CheckpointResult>>;
  }
  if (pending.request.payload.stage === 'SYMBIONTS' && 'variant' in pending.request.payload) {
    return pending.request.payload.variant === 'MANUAL_COMPOSITION'
      ? decodeManualCompositionTerminal(
          message,
          pending.request as ManualCompositionRequest,
          pending.sourceSnapshot,
        )
      : decodeManualAdvisorSkillTerminal(
          message,
          pending.request as ManualAdvisorSkillRequest,
          pending.sourceSnapshot,
        );
  }
  if (pending.request.payload.stage === 'SYMBIONTS') {
    return decodeSymbiontAdvisorCheckpointTerminal(
      message,
      pending.request as SymbiontAdvisorCheckpointRequest,
      pending.sourceSnapshot,
    );
  }
  const receipt = message.receipt;
  if (receipt.commandId !== pending.request.commandId) {
    return unrecognized('$.receipt.commandId', receipt.commandId);
  }
  if (receipt.receiptId.trim().length === 0) {
    return unrecognized('$.receipt.receiptId', receipt.receiptId);
  }
  const payload = pending.request.payload;
  if (payload.stage === 'IDENTITY') {
    const result = decodeProjection(receipt.result, '$.receipt.result', {
      branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
      characterDraftId: (field) => field === payload.characterDraftId,
      checkpointId: (field) => field === payload.wizardCheckpointId,
      checkpointOwnerId: (field) => field === payload.characterDraftId,
      checkpointRevision: (field) => field === 0,
      draftRevision: (field) => field === payload.draftRevision,
      nextFormId: (field) => field === 'CHR-010',
      stage: (field) => field === 'IDENTITY',
    });
    if (!result.ok) return result;
    if (
      receipt.revisions.stateRevision !== 0 ||
      receipt.revisions.projectionRevision !== 0 ||
      receipt.revisions.actorVisibilityRevision !== 0
    ) {
      return unrecognized('$.receipt.revisions', { ...receipt.revisions });
    }
    return { ok: true, value: receipt as CommandReceipt<IdentityCheckpointResult> };
  }
  if (payload.stage === 'SKILLS') {
    const sourceFormId = pending.sourceSnapshot.formId;
    if (
      (sourceFormId !== 'CHR-014' && sourceFormId !== 'CHR-015') ||
      payload.sourceFormId !== sourceFormId
    ) {
      return unrecognized('$.receipt.result.sourceFormId', receipt.result['sourceFormId']!);
    }
    const source = pending.sourceSnapshot.projection as Chr014Projection | Chr015Projection;
    const slotSources: SkillSlotSourcesProjection =
      sourceFormId === 'CHR-014'
        ? (source as Chr014Projection).slotSources
        : {
            mandatoryClassSkillOrNull: (source as Chr015Projection).mandatoryClassSkillOrNull,
            racialFreeSkills: (source as Chr015Projection).racialFreeSkills,
            requiredSlotCount: (source as Chr015Projection).requiredSlotCount,
          };
    let selectedWithCost: readonly SelectedSkillProjection[];
    let usedSlotCount: number;
    if (sourceFormId === 'CHR-014') {
      const card = source as Chr014Projection;
      if (
        card.eligibility !== 'ELIGIBLE' ||
        card.selectedSkills.some((entry) => entry.skillId === card.skillId)
      ) {
        return unrecognized('$.receipt.result.sourceFormId', receipt.result['sourceFormId']!);
      }
      const currentById = new Map(card.selectedSkills.map((entry) => [entry.skillId, entry]));
      if (currentById.size !== card.selectedSkills.length) {
        return unrecognized('$.receipt.result.selectedSkills', receipt.result['selectedSkills']!);
      }
      const decorated: SelectedSkillProjection[] = [];
      let additions = 0;
      for (const selected of payload.selectedSkills) {
        const existing = currentById.get(selected.skillId);
        if (existing !== undefined) {
          if (existing.targetBonus !== selected.targetBonus) {
            return unrecognized(
              '$.receipt.result.selectedSkills',
              receipt.result['selectedSkills']!,
            );
          }
          decorated.push(existing);
          continue;
        }
        additions += 1;
        const level = card.levelsAndBonuses.find(
          ({ targetBonus }) => targetBonus === selected.targetBonus,
        );
        if (selected.skillId !== card.skillId || level === undefined) {
          return unrecognized('$.receipt.result.selectedSkills', receipt.result['selectedSkills']!);
        }
        decorated.push({
          skillId: selected.skillId,
          slotCost: level.slotCost,
          targetBonus: selected.targetBonus,
        });
      }
      let previousOptionIndex = -1;
      for (const selected of decorated) {
        const optionIndex = card.eligibleSkillIds.indexOf(selected.skillId);
        if (optionIndex <= previousOptionIndex) {
          return unrecognized('$.receipt.result.selectedSkills', receipt.result['selectedSkills']!);
        }
        previousOptionIndex = optionIndex;
      }
      if (additions !== 1 || decorated.length !== card.selectedSkills.length + 1) {
        return unrecognized('$.receipt.result.selectedSkills', receipt.result['selectedSkills']!);
      }
      selectedWithCost = decorated;
      usedSlotCount =
        (slotSources.mandatoryClassSkillOrNull?.slotCost ?? 0) +
        decorated.reduce((total, entry) => total + entry.slotCost, 0);
      if (usedSlotCount > slotSources.requiredSlotCount) {
        return unrecognized('$.receipt.result.usedSlotCount', receipt.result['usedSlotCount']!);
      }
    } else {
      const draft = pending.skillSelectionDraft;
      if (
        ((source as Chr015Projection).selectionCheckpoint === 'EXACT' &&
          source['pureEquipmentInitializationRequired'] !== true) ||
        draft === null ||
        draft.selectionValidation.kind !== 'EXACT'
      ) {
        return unrecognized('$.receipt.result.sourceFormId', receipt.result['sourceFormId']!);
      }
      selectedWithCost = draft.selectedSkills;
      usedSlotCount = draft.selectionValidation.usedSlotCount;
    }
    const expectedSelectedSkills = payload.selectedSkills.map(({ skillId, targetBonus }) => ({
      skillKey: skillId,
      targetBonus,
    }));
    const expectedLearnedSkills: DurableLearnedSkillResult[] = [
      ...slotSources.racialFreeSkills.map(({ bonus, skillId, slotCost }) => ({
        bonus,
        skillKey: skillId,
        slotCost,
        source: 'RACE_GRANTED' as const,
      })),
      ...(slotSources.mandatoryClassSkillOrNull === null
        ? []
        : [
            {
              bonus: slotSources.mandatoryClassSkillOrNull.bonus,
              skillKey: slotSources.mandatoryClassSkillOrNull.skillId,
              slotCost: slotSources.mandatoryClassSkillOrNull.slotCost,
              source: 'CLASS_MANDATORY' as const,
            },
          ]),
      ...selectedWithCost.map(({ skillId, slotCost, targetBonus }) => ({
        bonus: targetBonus,
        skillKey: skillId,
        slotCost,
        source: 'SELECTED' as const,
      })),
    ];
    const result = decodeProjection(receipt.result, '$.receipt.result', {
      branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
      branchUuid: isNonEmptyString,
      characterDraftId: (field) => field === payload.characterDraftId,
      checkpointId: (field) => field === payload.wizardCheckpointId,
      checkpointOwnerId: (field) => field === payload.characterDraftId,
      checkpointRevision: (field) => isSafeIntegerAtLeast(field, 1),
      draftRevision: (field) => field === payload.draftRevision + 1,
      learnedSkills: (field) => sameJson(field, expectedLearnedSkills),
      nextFormId: (field) => field === (sourceFormId === 'CHR-014' ? 'CHR-015' : 'CHR-017'),
      requiredSlotCount: (field) => field === slotSources.requiredSlotCount,
      selectedSkills: (field) => sameJson(field, expectedSelectedSkills),
      sourceFormId: (field) => field === sourceFormId,
      stage: (field) => field === 'SKILLS',
      usedSlotCount: (field) => field === usedSlotCount,
      ...(Object.hasOwn(receipt.result, 'pureArmorBundleId') ||
      Object.hasOwn(receipt.result, 'pureArmorQualityRollRequestId')
        ? {
            pureArmorBundleId: (field: JsonValue | undefined) =>
              sourceFormId === 'CHR-015' && field !== undefined && isNonEmptyString(field),
            pureArmorQualityRollRequestId: (field: JsonValue | undefined) =>
              sourceFormId === 'CHR-015' &&
              field !== undefined &&
              isNonEmptyString(field) &&
              field !== receipt.result['pureArmorBundleId'],
          }
        : {}),
    });
    if (!result.ok) return result;
    const ids = [
      payload.characterDraftId,
      payload.wizardCheckpointId,
      pending.request.commandId,
      receipt.receiptId,
      receipt.result['branchUuid'],
    ];
    if (new Set(ids).size !== ids.length) {
      return unrecognized('$.receipt.result.branchUuid', receipt.result['branchUuid']!);
    }
    const expected = pending.request.expectedRevisions;
    if (
      receipt.revisions.stateRevision !== expected.stateRevision + 1 ||
      receipt.revisions.projectionRevision !== expected.projectionRevision + 1 ||
      receipt.revisions.actorVisibilityRevision !== expected.actorVisibilityRevision
    ) {
      return unrecognized('$.receipt.revisions', { ...receipt.revisions });
    }
    return { ok: true, value: receipt as CommandReceipt<SkillSelectionCheckpointResult> };
  }
  const source = pending.sourceSnapshot.projection as Chr009Projection;
  const assignmentMode = source.assignmentMode;
  const baseStats = decodeStatMap(
    receipt.result['baseStats']!,
    '$.receipt.result.baseStats',
    (entry): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry),
  );
  if (!baseStats.ok) return baseStats;
  const rolledAssignments = receipt.result['rolledAssignmentsOrNull'];
  if (assignmentMode === 'ROLLED_BIJECTION') {
    const setEntryIndexByStat = payload['setEntryIndexByStat'];
    if (
      !Array.isArray(rolledAssignments) ||
      rolledAssignments.length !== STAT_CODES.length ||
      source.bijectionProofOrExactSum.kind !== 'ROLLED_BIJECTION' ||
      !isJsonObject(setEntryIndexByStat)
    ) {
      return unrecognized('$.receipt.result.rolledAssignmentsOrNull', rolledAssignments!);
    }
    const indexMap = decodeStatMap(
      setEntryIndexByStat,
      '$.request.payload.setEntryIndexByStat',
      (entry): entry is number => isSafeIntegerAtLeast(entry, 0) && entry <= 6,
    );
    if (!indexMap.ok) return indexMap;
    const entries = rolledAssignments as readonly JsonValue[];
    for (const [index, statCode] of STAT_CODES.entries()) {
      const entry = entries[index]!;
      const selectedIndex = indexMap.value[statCode];
      const sourceEntry = source.bijectionProofOrExactSum.sourceEntries[selectedIndex];
      if (
        !isJsonObject(entry) ||
        sourceEntry === undefined ||
        !sameJson(entry, { ...sourceEntry, statCode }) ||
        baseStats.value[statCode] !== sourceEntry.value
      ) {
        return unrecognized(`$.receipt.result.rolledAssignmentsOrNull[${String(index)}]`, entry);
      }
    }
  } else if (
    rolledAssignments !== null ||
    payload['pointBuyStats'] === undefined ||
    !sameJson(baseStats.value, payload['pointBuyStats'])
  ) {
    return unrecognized('$.receipt.result.rolledAssignmentsOrNull', rolledAssignments!);
  }
  const nextFormId = source.raceChoice === 'PURE' ? 'CHR-011' : 'CHR-012';
  const result = decodeProjection(receipt.result, '$.receipt.result', {
    assignmentMode: (field) => field === assignmentMode,
    baseStats: (field) => field === receipt.result['baseStats'],
    branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
    branchUuid: isNonEmptyString,
    characterDraftId: (field) => field === payload.characterDraftId,
    checkpointId: (field) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field) => field === payload.characterDraftId,
    checkpointRevision: (field) => isSafeIntegerAtLeast(field, 1),
    draftRevision: (field) => field === payload.draftRevision + 1,
    nextFormId: (field) => field === nextFormId,
    raceChoice: (field) => field === source.raceChoice,
    rolledAssignmentsOrNull: (field) => field === rolledAssignments,
    sourceFormId: (field) => field === 'CHR-009',
    sourceSetReceiptIdOrNull: (field) => field === source.sourceSetReceiptIdOrNull,
    stage: (field) => field === 'STAT_ASSIGNMENT',
  });
  if (!result.ok) return result;
  const ids = [
    payload.characterDraftId,
    payload.wizardCheckpointId,
    pending.request.commandId,
    receipt.receiptId,
    receipt.result['branchUuid'],
    source.sourceSetReceiptIdOrNull,
  ].filter((entry): entry is string => typeof entry === 'string');
  if (new Set(ids).size !== ids.length) {
    return unrecognized('$.receipt.result.branchUuid', receipt.result['branchUuid']!);
  }
  const expected = pending.request.expectedRevisions;
  if (
    receipt.revisions.stateRevision !== expected.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== expected.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !== expected.actorVisibilityRevision
  ) {
    return unrecognized('$.receipt.revisions', { ...receipt.revisions });
  }
  return { ok: true, value: receipt as CommandReceipt<StatAssignmentCheckpointResult> };
}

function sameCheckpointReceipt(
  left: CommandReceipt<CheckpointResult>,
  right: CommandReceipt<CheckpointResult>,
): boolean {
  return sameJson(left as unknown as JsonValue, right as unknown as JsonValue);
}

function expectedSetDecisionNextForm(
  payload: RaceMethodSetDecisionPayload,
): 'CHR-002' | 'CHR-003' | 'CHR-016' | 'CHR-036' {
  switch (payload.sourceFormId) {
    case 'CHR-002':
      return 'CHR-003';
    case 'CHR-010':
      return payload.raceChoice === 'PURE' ? 'CHR-036' : 'CHR-016';
    case 'CHR-016':
      return 'CHR-036';
    case 'CHR-036':
      return 'CHR-002';
  }
}

function decodeStatRollSetDecisionTerminal(
  receipt: CommandReceipt<JsonObject>,
  pending: PendingSetDecision,
  payload: StatRollAcceptSetPayload | StatRollDialogDecisionPayload,
): DecodeResult<CommandReceipt<SetDecisionResult>> {
  const source = pending.sourceSnapshot;
  const active = activePresentedForm(source);
  const durable = payload.decision !== 'CANCEL';
  const common = {
    branchCacheHash: (field: JsonValue) => field === EMPTY_BRANCH_CACHE_HASH,
    branchUuid: isNonEmptyString,
    characterDraftId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointId: (field: JsonValue) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointRevision: (field: JsonValue) => isSafeIntegerAtLeast(field, 1),
    draftRevision: (field: JsonValue) => field === payload.draftRevision + (durable ? 1 : 0),
    sourceFormId: (field: JsonValue) => field === payload.sourceFormId,
    stage: (field: JsonValue) => field === 'STAT_ROLLS',
  };
  let decoded: DecodeResult<JsonObject>;
  if (payload.sourceFormId !== 'CHR-028') {
    if (active.formId !== payload.sourceFormId || source.layers.length !== 0) {
      return unrecognized('$.receipt.result.sourceFormId', payload.sourceFormId);
    }
    const rule = CREATION_SET_DECISION_FORMS[payload.sourceFormId];
    decoded = decodeProjection(receipt.result, '$.receipt.result', {
      ...common,
      acceptedSetReceiptId: (field) => field === source.projection[rule.receiptKey],
      assignmentMode: (field) => field === 'ROLLED_BIJECTION',
      decision: (field) => field === 'ACCEPT_SET',
      nextFormId: (field) => field === 'CHR-009',
    });
  } else {
    if (active.formId !== 'CHR-028' || source.layers.length !== 1) {
      return unrecognized('$.receipt.result.sourceFormId', payload.sourceFormId);
    }
    const dialog = active.projection as Chr028Projection;
    const originRule = CREATION_SET_DECISION_FORMS[dialog.originDecisionFormId];
    if (payload.decision === 'CANCEL') {
      decoded = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        decision: (field) => field === 'CANCEL',
        decisionReceiptIdOrNull: (field) => field === null,
        nextFormId: (field) => field === dialog.originDecisionFormId,
        originDecisionFormId: (field) => field === dialog.originDecisionFormId,
      });
    } else {
      const pointBuy = dialog.irreversibleConsequences.exactPointBuyTotalOrNull;
      const nextAttempt = dialog.irreversibleConsequences.nextAttemptIndexOrNull;
      decoded = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        abandonedSetReceiptIds: (field) => sameJson(field, dialog.abandonedSetReceiptIds),
        alternateDecision: (field) => field === originRule.alternateDecision,
        assignmentModeOrNull: (field) =>
          field === (pointBuy === 90 ? 'POINT_BUY_90' : pointBuy === 85 ? 'POINT_BUY_85' : null),
        decision: (field) => field === 'CONFIRM',
        irreversibleConsequences: (field) => sameJson(field, dialog.irreversibleConsequences),
        nextAttemptIndexOrNull: (field) => field === nextAttempt,
        nextFormId: (field) => field === (nextAttempt === null ? 'CHR-009' : 'CHR-003'),
        nextSetRollRequestIdOrNull: (field) =>
          nextAttempt === null ? field === null : isNonEmptyString(field),
        originDecisionFormId: (field) => field === dialog.originDecisionFormId,
        sourceSetReceiptIdOrNull: (field) => field === null,
        transitionKind: (field) => field === dialog.transitionKind,
      });
    }
  }
  if (!decoded.ok) return decoded;
  const sourceSetReceiptIds =
    payload.decision === 'CANCEL'
      ? (active.projection as Chr028Projection).abandonedSetReceiptIds
      : [];
  const resultIds = [
    payload.characterDraftId,
    payload.wizardCheckpointId,
    pending.request.commandId,
    receipt.receiptId,
    receipt.result['branchUuid'],
    receipt.result['acceptedSetReceiptId'],
    receipt.result['nextSetRollRequestIdOrNull'],
    ...(Array.isArray(receipt.result['abandonedSetReceiptIds'])
      ? (receipt.result['abandonedSetReceiptIds'] as readonly JsonValue[])
      : []),
    ...sourceSetReceiptIds,
  ].filter((entry): entry is string => typeof entry === 'string');
  if (new Set(resultIds).size !== resultIds.length) {
    return unrecognized('$.receipt.result.branchUuid', receipt.result['branchUuid']!);
  }
  const expected = pending.request.expectedRevisions;
  if (
    receipt.revisions.stateRevision !== expected.stateRevision + (durable ? 1 : 0) ||
    receipt.revisions.projectionRevision !== expected.projectionRevision + (durable ? 1 : 0) ||
    receipt.revisions.actorVisibilityRevision !== expected.actorVisibilityRevision
  ) {
    return unrecognized('$.receipt.revisions', { ...receipt.revisions });
  }
  return { ok: true, value: receipt as CommandReceipt<SetDecisionResult> };
}

function decodeSetDecisionTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.replay' | 'command.result' }
  >,
  pending: PendingSetDecision,
): DecodeResult<CommandReceipt<SetDecisionResult>> {
  const receipt = message.receipt;
  if (receipt.commandId !== pending.request.commandId) {
    return unrecognized('$.receipt.commandId', receipt.commandId);
  }
  if (receipt.receiptId.trim().length === 0) {
    return unrecognized('$.receipt.receiptId', receipt.receiptId);
  }
  const payload = pending.request.payload;
  if (payload.stage === 'STAT_ROLLS') {
    return decodeStatRollSetDecisionTerminal(receipt, pending, payload);
  }
  if (payload.stage === 'STAT_ASSIGNMENT') {
    const option = (pending.sourceSnapshot.projection as Chr011Projection).classOptions.find(
      (candidate) => candidate.pureClass === payload.pureClass,
    );
    if (pending.sourceSnapshot.formId !== 'CHR-011' || option === undefined) {
      return unrecognized('$.receipt.result.sourceFormId', payload.sourceFormId);
    }
    const result = decodeProjection(receipt.result, '$.receipt.result', {
      branchCacheHash: (field) => field === EMPTY_BRANCH_CACHE_HASH,
      branchUuid: isNonEmptyString,
      characterDraftId: (field) => field === payload.characterDraftId,
      checkpointId: (field) => field === payload.wizardCheckpointId,
      checkpointOwnerId: (field) => field === payload.characterDraftId,
      checkpointRevision: (field) => isSafeIntegerAtLeast(field, 1),
      classConsequences: (field) => sameJson(field, option.classConsequences),
      draftRevision: (field) => field === payload.draftRevision + 1,
      mandatoryClassSkill: (field) => sameJson(field, option.mandatoryClassSkill),
      nextFormId: (field) => field === 'CHR-012',
      pureClass: (field) => field === payload.pureClass,
      sourceFormId: (field) => field === 'CHR-011',
      stage: (field) => field === 'STAT_ASSIGNMENT',
    });
    if (!result.ok) return result;
    const ids = [
      payload.characterDraftId,
      payload.wizardCheckpointId,
      pending.request.commandId,
      receipt.receiptId,
      receipt.result['branchUuid'] as string,
    ];
    if (new Set(ids).size !== ids.length) {
      return unrecognized('$.receipt.receiptId', receipt.receiptId);
    }
    const expected = pending.request.expectedRevisions;
    if (
      receipt.revisions.stateRevision !== expected.stateRevision + 1 ||
      receipt.revisions.projectionRevision !== expected.projectionRevision + 1 ||
      receipt.revisions.actorVisibilityRevision !== expected.actorVisibilityRevision
    ) {
      return unrecognized('$.receipt.revisions', { ...receipt.revisions });
    }
    return { ok: true, value: receipt as CommandReceipt<SetDecisionResult> };
  }
  const expectedNextForm = expectedSetDecisionNextForm(payload);
  const common = {
    branchCacheHash: (field: JsonValue) => field === EMPTY_BRANCH_CACHE_HASH,
    characterDraftId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointId: (field: JsonValue) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointRevision: (field: JsonValue) =>
      typeof field === 'number' && Number.isSafeInteger(field) && field >= 1,
    draftRevision: (field: JsonValue) => field === payload.draftRevision + 1,
    nextFormId: (field: JsonValue) => field === expectedNextForm,
    sourceFormId: (field: JsonValue) => field === payload.sourceFormId,
    stage: (field: JsonValue) => field === 'RACE_AND_METHOD',
  };
  let result: DecodeResult<JsonObject>;
  switch (payload.sourceFormId) {
    case 'CHR-010':
      result = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        raceChoice: (field) => field === payload.raceChoice,
      });
      break;
    case 'CHR-016':
      result = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        symbiontAcquisitionMode: (field) => field === payload.symbiontAcquisitionMode,
      });
      break;
    case 'CHR-036':
      result = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        diceInputMode: (field) => field === payload.diceInputMode,
      });
      break;
    case 'CHR-002':
      result = decodeProjection(receipt.result, '$.receipt.result', {
        ...common,
        branchUuid: isNonEmptyString,
        setRollRequestId: isNonEmptyString,
        statMethod: (field) => field === payload.statMethod,
      });
      if (result.ok) {
        const branchUuid = receipt.result['branchUuid'];
        const setRollRequestId = receipt.result['setRollRequestId'];
        const ids = [
          payload.characterDraftId,
          payload.wizardCheckpointId,
          pending.request.commandId,
          receipt.receiptId,
          branchUuid,
          setRollRequestId,
        ];
        if (ids.some((entry, index) => ids.indexOf(entry) !== index)) {
          return unrecognized('$.receipt.result.setRollRequestId', setRollRequestId!);
        }
      }
      break;
  }
  if (!result.ok) return result;
  const expectedRevisions = pending.request.expectedRevisions;
  if (
    receipt.revisions.stateRevision !== expectedRevisions.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== expectedRevisions.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !== expectedRevisions.actorVisibilityRevision
  ) {
    return unrecognized('$.receipt.revisions', { ...receipt.revisions });
  }
  return { ok: true, value: receipt as CommandReceipt<SetDecisionResult> };
}

function sameSetDecisionReceipt(
  left: CommandReceipt<SetDecisionResult>,
  right: CommandReceipt<SetDecisionResult>,
): boolean {
  return sameJson(left as unknown as JsonValue, right as unknown as JsonValue);
}

function decodeCreationCriticalOutcome(
  value: JsonValue,
  path: string,
  originFace: 1 | 20,
): DecodeResult<JsonObject> {
  if (!isJsonObject(value)) return unrecognized(path, value);
  const result = decodeProjection(value, path, {
    creationCriticalPenaltyOrNull: (field) =>
      field === null || (typeof field === 'number' && Number.isSafeInteger(field)),
    criticalGrade: (field) => isSafeIntegerAtLeast(field, 0) && field <= 5,
    criticalPolarity: (field) => field === 'FAILURE' || field === 'NONE' || field === 'SUCCESS',
    setEntryIndex: (field) => isSafeIntegerAtLeast(field, 0) && field <= 6,
    value: (field) => typeof field === 'number' && Number.isSafeInteger(field),
  });
  if (!result.ok) return result;
  const grade = value['criticalGrade'] as number;
  const polarity = value['criticalPolarity'];
  const penalty = value['creationCriticalPenaltyOrNull'];
  const resolvedValue = value['value'];
  const valid =
    (polarity === 'NONE' && grade === 0 && penalty === null && resolvedValue === originFace) ||
    (polarity === 'SUCCESS' &&
      originFace === 20 &&
      grade >= 1 &&
      penalty === null &&
      resolvedValue === 20 + grade) ||
    (polarity === 'FAILURE' &&
      originFace === 1 &&
      grade >= 1 &&
      penalty === -grade &&
      resolvedValue === 1);
  return valid ? { ok: true, value } : unrecognized(`${path}.criticalPolarity`, polarity!);
}

function decodeRollCommitTerminal(
  message: Extract<
    HostToClientMessage,
    { readonly messageType: 'command.replay' | 'command.result' }
  >,
  pending: PendingRollCommit,
): DecodeResult<CommandReceipt<RollCommitResult>> {
  if (
    (pending.request.payload as { readonly variant?: string }).variant ===
    'FIVE_STARTING_POSITIONS_ROLL'
  )
    return decodeFiveStartingPositionsTerminal(
      message,
      pending.request as unknown as FiveStartingPositionsRequest,
      pending.sourceSnapshot,
    ) as DecodeResult<CommandReceipt<RollCommitResult>>;
  if ((pending.request.payload as { readonly variant?: string }).variant === 'STARTING_MONEY_ROLL')
    return decodeStartingMoneyTerminal(
      message,
      pending.request as unknown as StartingMoneyRequest,
      pending.sourceSnapshot,
    ) as DecodeResult<CommandReceipt<RollCommitResult>>;
  if (
    pending.request.payload.stage === 'SYMBIONTS' &&
    (pending.request.payload as { readonly variant?: string }).variant === 'STARTING_WEAPON_QUALITY'
  ) {
    return decodeStartingWeaponTerminal(
      message,
      pending.request as unknown as StartingWeaponQualityRequest,
      pending.sourceSnapshot,
    ) as DecodeResult<CommandReceipt<RollCommitResult>>;
  }
  if (
    pending.request.payload.stage === 'SYMBIONTS' &&
    (pending.request.payload as { readonly variant?: string }).variant === 'ARMOR_BUNDLE_QUALITY'
  ) {
    return decodeArmorBundleQualityTerminal(
      message,
      pending.request as unknown as ArmorBundleQualityRollRequest,
      pending.sourceSnapshot as unknown as ArmorBundleSnapshotSource,
    ) as DecodeResult<CommandReceipt<RollCommitResult>>;
  }
  if (
    pending.request.payload.stage === 'SYMBIONTS' &&
    pending.request.payload.variant === 'TROGR_SUPPRESSION_B'
  ) {
    return decodeAdvisorIntelligenceFloorRollTerminal(
      message,
      pending.request as AdvisorIntelligenceFloorRollRequest,
      pending.sourceSnapshot,
    );
  }
  if (pending.request.payload.stage === 'SYMBIONTS') {
    return pending.request.payload.variant === 'ADVISOR_IW'
      ? decodeManualAdvisorIwTerminal(
          message,
          pending.request as ManualAdvisorIwRequest,
          pending.sourceSnapshot,
        )
      : decodeSymbiontRollCommitTerminal(
          message,
          pending.request as SymbiontRollCommitRequest,
          pending.sourceSnapshot,
        );
  }
  const receipt = message.receipt;
  if (receipt.commandId !== pending.request.commandId) {
    return unrecognized('$.receipt.commandId', receipt.commandId);
  }
  if (receipt.receiptId.trim().length === 0) {
    return unrecognized('$.receipt.receiptId', receipt.receiptId);
  }
  const payload = pending.request.payload;
  const common = {
    branchCacheHash: (field: JsonValue) => field === EMPTY_BRANCH_CACHE_HASH,
    branchUuid: (field: JsonValue) => field === payload.branchUuid,
    characterDraftId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointId: (field: JsonValue) => field === payload.wizardCheckpointId,
    checkpointOwnerId: (field: JsonValue) => field === payload.characterDraftId,
    checkpointRevision: (field: JsonValue) => isSafeIntegerAtLeast(field, 1),
    draftRevision: (field: JsonValue) => field === payload.draftRevision + 1,
    sourceFormId: (field: JsonValue) => field === payload.sourceFormId,
    stage: (field: JsonValue) => field === 'STAT_ROLLS',
  };
  let result: DecodeResult<JsonObject>;
  if (payload.sourceFormId === 'CHR-003') {
    const faces = decodeFaceSlots(receipt.result['faces']!, '$.receipt.result.faces', false);
    if (!faces.ok) return faces;
    const queue = decodeNaturalCriticalQueue(
      receipt.result['naturalCriticalQueue']!,
      '$.receipt.result.naturalCriticalQueue',
      faces.value,
    );
    if (!queue.ok) return queue;
    result = decodeProjection(receipt.result, '$.receipt.result', {
      ...common,
      confirmationRollRequestIdOrNull: (field) => field === null || isNonEmptyString(field),
      diceInputModeSnapshot: (field) =>
        field === (payload.manualFacesOrNull === null ? 'AUTO' : 'MANUAL'),
      faces: (field) => field === receipt.result['faces'],
      naturalCriticalQueue: (field) => field === receipt.result['naturalCriticalQueue'],
      nextFormId: (field) => field === (queue.value.length === 0 ? 'CHR-003' : 'CHR-004'),
      setRollReceiptId: (field) => field === receipt.receiptId,
      setRollRequestId: (field) => field === payload.setRollRequestId,
      shownResultLocked: (field) => field === true,
    });
    if (!result.ok) return result;
    if (
      payload.manualFacesOrNull !== null &&
      !sameJson(payload.manualFacesOrNull, receipt.result['faces']!)
    ) {
      return unrecognized('$.receipt.result.faces', receipt.result['faces']!);
    }
    const confirmationId = receipt.result['confirmationRollRequestIdOrNull'];
    if ((queue.value.length === 0) !== (confirmationId === null)) {
      return unrecognized('$.receipt.result.confirmationRollRequestIdOrNull', confirmationId!);
    }
  } else {
    const source = pending.sourceProjection;
    if (source['commandId'] !== null || !('originFace' in source)) {
      return unrecognized('$.receipt.result.sourceFormId', payload.sourceFormId);
    }
    const confirmationSource = source as Chr004Projection;
    const outcomeValue = receipt.result['outcomeOrNull'];
    if (outcomeValue !== null && outcomeValue !== undefined) {
      const outcome = decodeCreationCriticalOutcome(
        outcomeValue,
        '$.receipt.result.outcomeOrNull',
        confirmationSource.originFace,
      );
      if (!outcome.ok) return outcome;
    }
    result = decodeProjection(receipt.result, '$.receipt.result', {
      ...common,
      confirmationFace: (field) =>
        isFace(field) && (payload.manualFaceOrNull === null || field === payload.manualFaceOrNull),
      confirmationReceiptId: (field) => field === receipt.receiptId,
      confirmationRollRequestId: (field) => field === payload.confirmationRollRequestId,
      criticalQueueIndex: (field) => field === payload.criticalQueueIndex,
      nextConfirmationRollRequestIdOrNull: (field) => field === null || isNonEmptyString(field),
      nextFormId: (field) => field === 'CHR-004',
      originFace: (field) => field === confirmationSource.originFace,
      outcomeOrNull: (field) => field === null || isJsonObject(field),
      returnDecisionFormId: (field) => field === confirmationSource.returnDecisionFormId,
      setRollReceiptId: (field) => field === payload.setRollReceiptId,
    });
    if (!result.ok) return result;
    if (
      receipt.result['outcomeOrNull'] === null &&
      receipt.result['nextConfirmationRollRequestIdOrNull'] === null
    ) {
      return unrecognized(
        '$.receipt.result.nextConfirmationRollRequestIdOrNull',
        receipt.result['nextConfirmationRollRequestIdOrNull']!,
      );
    }
  }
  const expectedRevisions = pending.request.expectedRevisions;
  if (
    receipt.revisions.stateRevision !== expectedRevisions.stateRevision + 1 ||
    receipt.revisions.projectionRevision !== expectedRevisions.projectionRevision + 1 ||
    receipt.revisions.actorVisibilityRevision !== expectedRevisions.actorVisibilityRevision
  ) {
    return unrecognized('$.receipt.revisions', { ...receipt.revisions });
  }
  return { ok: true, value: receipt as CommandReceipt<RollCommitResult> };
}

function sameJson(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    const leftEntries = left as readonly JsonValue[];
    const rightEntries = right as readonly JsonValue[];
    return (
      leftEntries.length === rightEntries.length &&
      leftEntries.every((entry, index) => sameJson(entry, rightEntries[index]!))
    );
  }
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key]!, right[key]!))
  );
}

function sameRollCommitReceipt(
  left: CommandReceipt<RollCommitResult>,
  right: CommandReceipt<RollCommitResult>,
): boolean {
  return sameJson(left as unknown as JsonValue, right as unknown as JsonValue);
}

function startingWeaponSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt,
): DecodeResult<ConfirmedProjectionSnapshot> {
  const result = receipt.result;
  if (
    result['variant'] === 'STARTING_WEAPON_CHECKPOINT' &&
    (snapshot.formId === 'CHR-023' || snapshot.formId === 'CHR-024')
  ) {
    const projection = snapshot.projection as Chr023Projection | Chr024Projection;
    if (
      projection.commandId !== receipt.commandId ||
      projection.characterDraftId !== result['characterDraftId'] ||
      projection.wizardCheckpointId !== result['checkpointId'] ||
      projection.draftRevision !== result['draftRevision'] ||
      projection.weaponTypeId !== result['weaponTypeId'] ||
      projection.weaponVariantId !== result['weaponVariant'] ||
      projection.weaponCheckpointReceiptId !== receipt.receiptId ||
      projection.weaponQualityRollRequestId !== result['weaponQualityRollRequestId'] ||
      projection.weaponQualityRollReceiptId !== result['weaponQualityRollReceiptId'] ||
      projection.requestId !== result['weaponProfileRequestId'] ||
      projection.nextFormId !== result['nextFormId'] ||
      !sameJson({ ...snapshot.revisions }, { ...receipt.revisions }) ||
      snapshot.layers.length !== 0
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', projection);
    return { ok: true, value: snapshot };
  }
  if (snapshot.formId !== 'CHR-022')
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  const projection = snapshot.projection as Chr022Projection;
  const entry = result['variant'] === 'STARTING_WEAPON_ENTRY';
  const checkpoint = result['variant'] === 'STARTING_WEAPON_CHECKPOINT';
  if (
    projection.commandId !== receipt.commandId ||
    projection.characterDraftId !== result['characterDraftId'] ||
    projection.wizardCheckpointId !== result['checkpointId'] ||
    projection.draftRevision !== result['draftRevision'] ||
    projection.weaponQualityRollRequestId !== result['weaponQualityRollRequestId'] ||
    projection.nextFormId !== result['nextFormId'] ||
    (entry
      ? projection.weaponQualityRollReceiptIdOrNull !== null ||
        projection.weaponCheckpointReceiptIdOrNull !== null
      : projection.weaponTypeId !== result['weaponTypeId'] ||
        projection.weaponVariant !== result['weaponVariant'] ||
        !sameJson(projection.qualityRecommendation, result['qualityRecommendation']!) ||
        projection.weaponQualityRollReceiptIdOrNull !==
          (checkpoint ? result['weaponQualityRollReceiptId'] : receipt.receiptId) ||
        projection.weaponCheckpointReceiptIdOrNull !== (checkpoint ? receipt.receiptId : null)) ||
    snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
    snapshot.revisions.stateRevision !== receipt.revisions.stateRevision ||
    snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision
  )
    return unrecognized('$.presentation.base.roleFilteredPayload', projection);
  return { ok: true, value: snapshot };
}

function startingMoneySnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (snapshot.formId === 'CHR-037') {
    const projection = snapshot.projection as Chr037Projection;
    const result = receipt.result;
    if (
      result['variant'] !== 'STARTING_MONEY_CHECKPOINT' ||
      snapshot.layers.length !== 0 ||
      projection.characterDraftId !== result['characterDraftId'] ||
      projection.wizardCheckpointId !== result['checkpointId'] ||
      projection.draftRevision !== result['draftRevision'] ||
      projection.commandId !== receipt.commandId ||
      projection.moneyCheckpointReceiptId !== receipt.receiptId ||
      projection.moneyRollRequestId !== result['moneyRollRequestId'] ||
      projection.moneyRollReceiptId !== result['moneyRollReceiptId'] ||
      projection.diceInputModeSnapshot !== result['diceInputModeSnapshot'] ||
      projection.positionsCheckpointReceiptIdOrNull !== null ||
      projection.positions.some(
        (p) => p.itemTypeIdOrStoryType !== null || p.qualityRollReceiptId !== null,
      ) ||
      projection.nextFormId !== 'CHR-037' ||
      !sameJson({ ...snapshot.revisions }, { ...receipt.revisions })
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', projection);
    return { ok: true, value: snapshot };
  }
  if (snapshot.formId !== 'CHR-038' || snapshot.layers.length !== 0)
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  const projection = snapshot.projection as Chr038Projection;
  const result = receipt.result;
  const roll = result['variant'] === 'STARTING_MONEY_ROLL';
  if (
    projection.characterDraftId !== result['characterDraftId'] ||
    projection.wizardCheckpointId !== result['checkpointId'] ||
    projection.draftRevision !== result['draftRevision'] ||
    projection.commandId !== receipt.commandId ||
    projection.moneyRollRequestId !== result['moneyRollRequestId'] ||
    projection.diceInputModeSnapshot !== result['diceInputModeSnapshot'] ||
    projection.profileReceiptId !== result['profileReceiptId'] ||
    projection.weaponCheckpointReceiptId !== result['weaponCheckpointReceiptId'] ||
    !sameJson(projection.wealthRecommendation, result['wealthRecommendation'] ?? null) ||
    projection.moneyRollReceiptIdOrNull !==
      (roll ? receipt.receiptId : result['moneyRollReceiptId']) ||
    projection.moneyCheckpointReceiptIdOrNull !== (roll ? null : receipt.receiptId) ||
    projection.nextFormId !== result['nextFormId'] ||
    !sameJson({ ...snapshot.revisions }, { ...receipt.revisions })
  )
    return unrecognized('$.presentation.base.roleFilteredPayload', projection);
  return { ok: true, value: snapshot };
}

function fiveStartingPositionsSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (
    snapshot.formId === 'CHR-032' &&
    receipt.result['variant'] === 'FIVE_STARTING_POSITIONS_CHECKPOINT'
  ) {
    const p = snapshot.projection as Chr032Projection,
      r = receipt.result;
    const rows = p.fivePositions.map((row) => {
      const { ownershipState: _ownership, ...rest } = row;
      return rest;
    });
    return snapshot.layers.length === 0 &&
      p.propertyCheckpointReceiptId === receipt.receiptId &&
      p.commandId === receipt.commandId &&
      p.characterDraftId === r['characterDraftId'] &&
      p.wizardCheckpointId === r['checkpointId'] &&
      p.draftRevision === r['draftRevision'] &&
      p.summaryEntryMode === 'INITIAL' &&
      sameJson(rows, r['positions']!) &&
      sameJson({ ...snapshot.revisions }, { ...receipt.revisions })
      ? { ok: true, value: snapshot }
      : unrecognized('$.presentation.base.roleFilteredPayload', p);
  }
  if (snapshot.formId !== 'CHR-037' || snapshot.layers.length !== 0)
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  const p = snapshot.projection as Chr037Projection,
    result = receipt.result;
  const checkpointed = result['variant'] === 'FIVE_STARTING_POSITIONS_CHECKPOINT';
  if (
    p.characterDraftId !== result['characterDraftId'] ||
    p.wizardCheckpointId !== result['checkpointId'] ||
    p.draftRevision !== result['draftRevision'] ||
    p.commandId !== receipt.commandId ||
    p.moneyCheckpointReceiptId !== result['moneyCheckpointReceiptId'] ||
    p.moneyRollRequestId !== result['moneyRollRequestId'] ||
    p.moneyRollReceiptId !== result['moneyRollReceiptId'] ||
    p.diceInputModeSnapshot !== result['diceInputModeSnapshot'] ||
    !sameJson(p.positions, result['positions']!) ||
    p.positionsCheckpointReceiptIdOrNull !== (checkpointed ? receipt.receiptId : null) ||
    p.nextFormId !== result['nextFormId'] ||
    !sameJson({ ...snapshot.revisions }, { ...receipt.revisions })
  )
    return unrecognized('$.presentation.base.roleFilteredPayload', p);
  return { ok: true, value: snapshot };
}

function weaponProfileSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  const result = receipt.result;
  if (snapshot.formId === 'CHR-038') {
    const money = snapshot.projection as Chr038Projection;
    if (
      (result['outcome'] !== 'SUBMITTED' && result['outcome'] !== 'ACKNOWLEDGED') ||
      snapshot.layers.length !== 0 ||
      money.commandId !== receipt.commandId ||
      money.profileReceiptId !== receipt.receiptId ||
      money.weaponCheckpointReceiptId !== source.projection['weaponCheckpointReceiptId'] ||
      money.weaponProfileFormId !== source.formId ||
      money.characterDraftId !== result['characterDraftId'] ||
      money.wizardCheckpointId !== result['checkpointId'] ||
      money.draftRevision !== result['draftRevision'] ||
      money.moneyRollRequestId !== result['moneyRollRequestId'] ||
      money.moneyRollReceiptIdOrNull !== null ||
      money.nextFormId !== 'CHR-038' ||
      !sameJson({ ...snapshot.revisions }, { ...receipt.revisions })
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', money);
    return { ok: true, value: snapshot };
  }
  if (snapshot.formId !== 'CHR-023' && snapshot.formId !== 'CHR-024')
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  const projection = snapshot.projection as Chr023Projection | Chr024Projection;
  if (
    projection.commandId !== receipt.commandId ||
    projection.characterDraftId !== result['characterDraftId'] ||
    projection.wizardCheckpointId !== result['checkpointId'] ||
    projection.draftRevision !== result['draftRevision'] ||
    projection.requestId !== result['requestId'] ||
    (result['variant'] !== 'WEAPON_PROFILE_ENTRY' &&
      (projection.weaponTypeId !== result['weaponTypeId'] ||
        projection.weaponVariantId !== result['weaponVariant'])) ||
    projection.nextFormId !== result['nextFormId'] ||
    !sameJson({ ...snapshot.revisions }, { ...receipt.revisions })
  )
    return unrecognized('$.presentation.base.roleFilteredPayload', projection);
  if (result['variant'] === 'WEAPON_PROFILE_ENTRY') {
    if (
      projection.weaponCheckpointReceiptId !== result['weaponCheckpointReceiptId'] ||
      snapshot.layers.length !== 0 ||
      (snapshot.formId === 'CHR-023'
        ? (projection as Chr023Projection).requestStatus !== 'DRAFT'
        : (projection as Chr024Projection).acknowledgedReceiptIdOrNull !== null)
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', projection);
  } else if (result['outcome'] === 'INVALID') {
    const layer = snapshot.layers[0];
    if (
      snapshot.formId !== 'CHR-023' ||
      snapshot.layers.length !== 1 ||
      layer?.formId !== 'CHR-031' ||
      !sameJson(layer.projection.invalidFieldSet, result['invalidFieldSet']!) ||
      !sameJson(layer.projection.humanExplanations, result['humanExplanations']!) ||
      (projection as Chr023Projection).requestStatus !== 'DRAFT'
    )
      return unrecognized(
        '$.presentation.layers',
        snapshot.layers.map((entry) => entry.formId),
      );
  } else if (result['outcome'] === 'SUBMITTED') {
    if (
      snapshot.formId !== 'CHR-023' ||
      snapshot.layers.length !== 0 ||
      (projection as Chr023Projection).profileReceiptIdOrNull !== receipt.receiptId ||
      !sameJson(
        (projection as Chr023Projection).proposedWeaponProfile,
        isJsonObject(result['profileOrNull']) ? (result['profileOrNull']['facts'] ?? null) : null,
      ) ||
      !sameJson(
        (projection as Chr023Projection).reachabilityProof,
        result['proofOrNull'] ?? null,
      ) ||
      !sameJson(
        (projection as Chr023Projection).independentManufacturingDiceReceipts,
        result['independentManufacturingDiceReceipts']!,
      )
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', projection);
  } else if (result['outcome'] === 'ACKNOWLEDGED') {
    if (
      snapshot.formId !== 'CHR-024' ||
      snapshot.layers.length !== 0 ||
      (projection as Chr024Projection).acknowledgedReceiptIdOrNull !== receipt.receiptId ||
      (projection as Chr024Projection).canonicalProfileVersion !==
        result['canonicalProfileVersion'] ||
      !sameJson(
        (projection as Chr024Projection).fixedProfile,
        isJsonObject(result['profileOrNull']) ? (result['profileOrNull']['facts'] ?? null) : null,
      )
    )
      return unrecognized('$.presentation.base.roleFilteredPayload', projection);
  } else return unrecognized('$.receipt.result.outcome', result['outcome'] ?? null);
  return { ok: true, value: snapshot };
}

function armorBundleSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<CheckpointResult>,
): DecodeResult<ConfirmedProjectionSnapshot> {
  const result = receipt.result as unknown as {
    readonly variant: string;
    readonly characterDraftId: string;
    readonly checkpointId: string;
    readonly draftRevision: number;
    readonly armorBundleId: string;
    readonly nextFormId: string;
  };
  if (result.variant === 'ARMOR_BUNDLE_CHECKPOINT' && snapshot.formId === 'CHR-022') {
    const projection = snapshot.projection as Chr022Projection;
    if (
      projection.commandId !== receipt.commandId ||
      projection.characterDraftId !== result.characterDraftId ||
      projection.wizardCheckpointId !== result.checkpointId ||
      projection.draftRevision !== result.draftRevision ||
      projection.nextFormId !== 'CHR-022' ||
      result.nextFormId !== 'CHR-022' ||
      projection.weaponQualityRollReceiptIdOrNull !== null ||
      projection.weaponCheckpointReceiptIdOrNull !== null ||
      (Object.hasOwn(receipt.result, 'weaponQualityRollRequestId') &&
        projection.weaponQualityRollRequestId !== receipt.result['weaponQualityRollRequestId']) ||
      !sameJson({ ...snapshot.revisions }, { ...receipt.revisions })
    ) {
      return unrecognized('$.presentation.base.roleFilteredPayload', projection);
    }
    return { ok: true, value: snapshot };
  }
  if (snapshot.formId !== 'CHR-021') {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  const projection = snapshot.projection as Chr021Projection;
  if (
    projection.commandId !== receipt.commandId ||
    projection.characterDraftId !== result.characterDraftId ||
    projection.wizardCheckpointId !== result.checkpointId ||
    projection.draftRevision !== result.draftRevision ||
    projection.armorBundleId !== result.armorBundleId ||
    projection.ownershipState !== 'OWNED_NOT_EQUIPPED' ||
    ((result.variant === 'ARMOR_BUNDLE_ENTRY' ||
      result.variant === 'MANUAL_INTERACTION_CONFIRMATION') &&
      (projection.qualityRollReceiptIdOrNull !== null ||
        projection.bundleCheckpointReceiptIdOrNull !== null ||
        result.nextFormId !== 'CHR-021')) ||
    (result.variant === 'ARMOR_BUNDLE_CHECKPOINT' &&
      (projection.bundleCheckpointReceiptIdOrNull !== receipt.receiptId ||
        result.nextFormId !== 'CHR-022'))
  ) {
    return unrecognized('$.presentation.base.roleFilteredPayload', projection);
  }
  if (
    snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
    snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision ||
    snapshot.revisions.stateRevision !== receipt.revisions.stateRevision
  ) {
    return unrecognized('$.revisions', { ...snapshot.revisions });
  }
  return { ok: true, value: snapshot };
}

function checkpointSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<CheckpointResult>,
  sourceSnapshot: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  const result = receipt.result;
  if ((result as JsonObject)['stage'] === 'FINALIZATION')
    return creationFinalizationSnapshotMatchesReceipt(snapshot, receipt)
      ? { ok: true, value: snapshot }
      : unrecognized('$.presentation.base.roleFilteredPayload', snapshot.projection);
  if ((result as { readonly variant?: string }).variant === 'FIVE_STARTING_POSITIONS_CHECKPOINT')
    return fiveStartingPositionsSnapshotMatchesReceipt(snapshot, receipt);
  if ((result as { readonly variant?: string }).variant === 'STARTING_MONEY_CHECKPOINT')
    return startingMoneySnapshotMatchesReceipt(snapshot, receipt);
  if (
    ['WEAPON_PROFILE_ENTRY', 'WEAPON_PROFILE_SUBMIT', 'WEAPON_PROFILE_ACKNOWLEDGE'].includes(
      (result as { readonly variant?: string }).variant ?? '',
    )
  ) {
    return weaponProfileSnapshotMatchesReceipt(snapshot, receipt, sourceSnapshot);
  }
  if (
    result.stage === 'SYMBIONTS' &&
    ['STARTING_WEAPON_ENTRY', 'STARTING_WEAPON_CHECKPOINT'].includes(
      (result as { readonly variant?: string }).variant ?? '',
    )
  ) {
    return startingWeaponSnapshotMatchesReceipt(snapshot, receipt);
  }
  if (
    result.stage === 'SYMBIONTS' &&
    'variant' in result &&
    (result.variant === 'ARMOR_BUNDLE_ENTRY' ||
      result.variant === 'MANUAL_INTERACTION_CONFIRMATION' ||
      result.variant === 'ARMOR_BUNDLE_CHECKPOINT')
  ) {
    return armorBundleSnapshotMatchesReceipt(snapshot, receipt);
  }
  if (result.stage === 'SYMBIONTS' && 'variant' in result) {
    return result.variant === 'MANUAL_COMPOSITION'
      ? manualCompositionSnapshotMatchesReceipt(
          snapshot,
          receipt as CommandReceipt<ManualCompositionResult>,
        )
      : manualAdvisorSkillSnapshotMatchesReceipt(
          snapshot,
          receipt as CommandReceipt<ManualAdvisorSkillResult>,
        );
  }
  if (result.stage === 'SYMBIONTS') {
    return advisorCheckpointSnapshotMatchesReceipt(
      snapshot,
      receipt as CommandReceipt<SymbiontAdvisorCheckpointResult>,
    );
  }
  if (result.stage === 'SKILLS') {
    if (
      result.sourceFormId === 'CHR-015' &&
      result.nextFormId === 'CHR-017' &&
      snapshot.formId === 'CHR-017'
    ) {
      const projection = snapshot.projection;
      if (
        sourceSnapshot.formId !== 'CHR-015' ||
        snapshot.layers.length !== 0 ||
        projection.characterDraftId !== result.characterDraftId ||
        projection.wizardCheckpointId !== result.checkpointId ||
        projection.draftRevision !== result.draftRevision ||
        !sameJson({ ...snapshot.revisions }, { ...receipt.revisions }) ||
        (projection.raceChoice === 'PURE' &&
          (projection['pureCompositionCheckpointed'] !== true ||
            !isNonEmptyString(result['pureArmorBundleId'] ?? null) ||
            !isNonEmptyString(result['pureArmorQualityRollRequestId'] ?? null)))
      )
        return unrecognized('$.presentation.base.roleFilteredPayload', projection);
      return { ok: true, value: snapshot };
    }
    if (snapshot.formId !== 'CHR-015') {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
    const projection = snapshot.projection as Chr015Projection;
    if (sourceSnapshot.formId !== result.sourceFormId) {
      return unrecognized('$.presentation.base.formId', sourceSnapshot.formId);
    }
    const source = sourceSnapshot.projection as Chr014Projection | Chr015Projection;
    const slotSources: SkillSlotSourcesProjection =
      result.sourceFormId === 'CHR-014'
        ? (source as Chr014Projection).slotSources
        : {
            mandatoryClassSkillOrNull: (source as Chr015Projection).mandatoryClassSkillOrNull,
            racialFreeSkills: (source as Chr015Projection).racialFreeSkills,
            requiredSlotCount: (source as Chr015Projection).requiredSlotCount,
          };
    const projectedSelection = projection.selectedSkills.map(({ skillId, targetBonus }) => ({
      skillKey: skillId,
      targetBonus,
    }));
    if (
      projection.commandId !== receipt.commandId ||
      projection.characterDraftId !== result.characterDraftId ||
      projection.wizardCheckpointId !== result.checkpointId ||
      projection.draftRevision !== result.draftRevision ||
      projection.requiredSlotCount !== result.requiredSlotCount ||
      projection.paidSlotUsage.usedSlotCount !== result.usedSlotCount ||
      projection.selectionCheckpoint !==
        (result.sourceFormId === 'CHR-014' ? 'PARTIAL' : 'EXACT') ||
      (result.sourceFormId === 'CHR-015' && projection.selectionValidation.kind !== 'EXACT') ||
      !sameJson(projectedSelection, result.selectedSkills) ||
      !sameJson(projection.eligibleSkillIds, source.eligibleSkillIds) ||
      (result.sourceFormId === 'CHR-015' &&
        !sameJson(projection.skillOptions, (source as Chr015Projection).skillOptions)) ||
      !sameJson(projection.mandatoryClassSkillOrNull, slotSources.mandatoryClassSkillOrNull) ||
      !sameJson(
        projection.racialFreeSkillIds,
        slotSources.racialFreeSkills.map(({ skillId }) => skillId),
      ) ||
      !sameJson(projection.racialFreeSkills, slotSources.racialFreeSkills)
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.selectedSkills',
        projection.selectedSkills,
      );
    }
    if (
      snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
      snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision ||
      snapshot.revisions.stateRevision !== receipt.revisions.stateRevision
    ) {
      return unrecognized('$.revisions', { ...snapshot.revisions });
    }
    return { ok: true, value: snapshot };
  }
  let advance = 0;
  if (result.stage === 'IDENTITY') {
    if (snapshot.formId !== 'CHR-010') {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
  } else if (result.nextFormId === 'CHR-011') {
    if (snapshot.formId === 'CHR-012') {
      advance = 1;
    } else if (snapshot.formId !== 'CHR-011') {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
  } else if (snapshot.formId !== 'CHR-012') {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  const projection = snapshot.projection;
  for (const [key, expected] of [
    ['characterDraftId', result.characterDraftId],
    ['wizardCheckpointId', result.checkpointId],
    ['draftRevision', result.draftRevision + advance],
  ] as const) {
    if (projection[key] !== expected) {
      return unrecognized(`$.presentation.base.roleFilteredPayload.${key}`, projection[key]!);
    }
  }
  if (result.stage === 'STAT_ASSIGNMENT') {
    if (
      (snapshot.formId === 'CHR-011' && projection['raceChoice'] !== 'PURE') ||
      (snapshot.formId === 'CHR-012' &&
        (!sameJson(projection['baseStats']!, result.baseStats) ||
          (advance === 0 &&
            (projection['classModifiersOrNull'] !== null ||
              projection['mandatoryClassSkillOrNull'] !== null)) ||
          (advance === 1 &&
            (projection['classModifiersOrNull'] === null ||
              projection['mandatoryClassSkillOrNull'] === null))))
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.baseStats',
        projection['baseStats']!,
      );
    }
    if (
      snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
      snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision + advance ||
      snapshot.revisions.stateRevision !== receipt.revisions.stateRevision + advance
    ) {
      return unrecognized('$.revisions', { ...snapshot.revisions });
    }
  } else if (
    snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
    snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision ||
    snapshot.revisions.stateRevision !== receipt.revisions.stateRevision
  ) {
    return unrecognized('$.revisions', { ...snapshot.revisions });
  }
  return { ok: true, value: snapshot };
}

function setDecisionSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<SetDecisionResult>,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (receipt.result.stage === 'STAT_ROLLS') {
    const result = receipt.result;
    const projection = snapshot.projection;
    const exactReceiptRevisions = (projectionOffset: number) =>
      snapshot.revisions.actorVisibilityRevision === receipt.revisions.actorVisibilityRevision &&
      snapshot.revisions.projectionRevision ===
        receipt.revisions.projectionRevision + projectionOffset &&
      snapshot.revisions.stateRevision === receipt.revisions.stateRevision;
    if (result.decision === 'CANCEL') {
      if (
        snapshot.formId !== result.originDecisionFormId ||
        snapshot.layers.length !== 0 ||
        !sameBasePresentation(snapshot, source) ||
        !exactReceiptRevisions(1)
      ) {
        return unrecognized('$.presentation.base.formId', snapshot.formId);
      }
      return { ok: true, value: snapshot };
    }
    if (!exactReceiptRevisions(0)) {
      return unrecognized('$.revisions', { ...snapshot.revisions });
    }
    if (
      projection['characterDraftId'] !== result.characterDraftId ||
      projection['wizardCheckpointId'] !== result.checkpointId ||
      projection['draftRevision'] !== result.draftRevision
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.draftRevision',
        projection['draftRevision'],
      );
    }
    if (result.decision === 'ACCEPT_SET') {
      if (
        snapshot.formId !== 'CHR-009' ||
        snapshot.layers.length !== 0 ||
        projection['assignmentMode'] !== 'ROLLED_BIJECTION' ||
        projection['sourceSetReceiptIdOrNull'] !== result.acceptedSetReceiptId
      ) {
        return unrecognized('$.presentation.base.formId', snapshot.formId);
      }
      return { ok: true, value: snapshot };
    }
    if (result.nextFormId === 'CHR-003') {
      if (
        snapshot.formId !== 'CHR-003' ||
        snapshot.layers.length !== 0 ||
        projection['branchUuid'] !== result.branchUuid ||
        projection['attemptIndex'] !== result.nextAttemptIndexOrNull ||
        projection['setRollRequestId'] !== result.nextSetRollRequestIdOrNull
      ) {
        return unrecognized('$.presentation.base.formId', snapshot.formId);
      }
      return { ok: true, value: snapshot };
    }
    if (
      snapshot.formId !== 'CHR-009' ||
      snapshot.layers.length !== 0 ||
      projection['assignmentMode'] !== result.assignmentModeOrNull ||
      projection['sourceSetReceiptIdOrNull'] !== null
    ) {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
    return { ok: true, value: snapshot };
  }
  if (receipt.result.stage === 'STAT_ASSIGNMENT') {
    const projection = snapshot.projection;
    if (
      snapshot.formId !== 'CHR-012' ||
      snapshot.layers.length !== 0 ||
      projection['characterDraftId'] !== receipt.result.characterDraftId ||
      projection['wizardCheckpointId'] !== receipt.result.checkpointId ||
      projection['draftRevision'] !== receipt.result.draftRevision ||
      !sameJson(
        projection['classModifiersOrNull']!,
        receipt.result.classConsequences.statModifiers,
      ) ||
      !sameJson(projection['mandatoryClassSkillOrNull']!, receipt.result.mandatoryClassSkill)
    ) {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
    if (
      snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
      snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision ||
      snapshot.revisions.stateRevision !== receipt.revisions.stateRevision
    ) {
      return unrecognized('$.revisions', { ...snapshot.revisions });
    }
    return { ok: true, value: snapshot };
  }
  let advance: number | null = null;
  switch (receipt.result.sourceFormId) {
    case 'CHR-010':
      if (receipt.result.nextFormId === 'CHR-016') {
        advance =
          snapshot.formId === 'CHR-016'
            ? 0
            : snapshot.formId === 'CHR-036'
              ? 1
              : snapshot.formId === 'CHR-002'
                ? 2
                : null;
      } else {
        advance = snapshot.formId === 'CHR-036' ? 0 : snapshot.formId === 'CHR-002' ? 1 : null;
      }
      break;
    case 'CHR-016':
      advance = snapshot.formId === 'CHR-036' ? 0 : snapshot.formId === 'CHR-002' ? 1 : null;
      break;
    case 'CHR-036':
      advance = snapshot.formId === 'CHR-002' ? 0 : null;
      break;
    case 'CHR-002': {
      if (snapshot.formId !== 'CHR-003' && snapshot.formId !== 'CHR-004') break;
      const currentDraftRevision = snapshot.projection['draftRevision'];
      if (
        typeof currentDraftRevision === 'number' &&
        Number.isSafeInteger(currentDraftRevision) &&
        currentDraftRevision >= receipt.result.draftRevision
      ) {
        advance = currentDraftRevision - receipt.result.draftRevision;
      }
      break;
    }
  }
  if (advance === null) {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  const projection = snapshot.projection;
  for (const [key, expected] of [
    ['characterDraftId', receipt.result.characterDraftId],
    ['wizardCheckpointId', receipt.result.checkpointId],
    ['draftRevision', receipt.result.draftRevision + advance],
  ] as const) {
    if (projection[key] !== expected) {
      return unrecognized(`$.presentation.base.roleFilteredPayload.${key}`, projection[key]);
    }
  }
  if (
    snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
    snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision + advance ||
    snapshot.revisions.stateRevision !== receipt.revisions.stateRevision + advance
  ) {
    return unrecognized('$.revisions', { ...snapshot.revisions });
  }
  if (
    receipt.result.sourceFormId === 'CHR-010' &&
    snapshot.formId === 'CHR-016' &&
    projection['raceChoice'] !== receipt.result.raceChoice
  ) {
    return unrecognized(
      '$.presentation.base.roleFilteredPayload.raceChoice',
      projection['raceChoice'],
    );
  }
  if (receipt.result.sourceFormId === 'CHR-002') {
    const expectedFields = [
      ['branchUuid', receipt.result.branchUuid],
      ...(snapshot.formId === 'CHR-003'
        ? ([
            ['setRollRequestId', receipt.result.setRollRequestId],
            ['statMethod', receipt.result.statMethod],
            ['attemptIndex', 1],
          ] as const)
        : []),
    ] as const;
    for (const [key, expected] of expectedFields) {
      if (projection[key] !== expected) {
        return unrecognized(`$.presentation.base.roleFilteredPayload.${key}`, projection[key]!);
      }
    }
  }
  return { ok: true, value: snapshot };
}

function reconnectSnapshotMatchesUnjournaledCancel(
  snapshot: ConfirmedProjectionSnapshot,
  pending: PendingSetDecision,
): DecodeResult<ConfirmedProjectionSnapshot> {
  const payload = pending.request.payload;
  const source = pending.sourceSnapshot;
  const dialog = source.layers[0];
  if (
    payload.stage !== 'STAT_ROLLS' ||
    payload.decision !== 'CANCEL' ||
    source.layers.length !== 1 ||
    dialog === undefined ||
    snapshot.formId !== dialog.projection.originDecisionFormId ||
    snapshot.layers.length !== 0 ||
    !sameBasePresentation(snapshot, source)
  ) {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  if (
    snapshot.revisions.actorVisibilityRevision !== source.revisions.actorVisibilityRevision ||
    snapshot.revisions.stateRevision !== source.revisions.stateRevision ||
    snapshot.revisions.projectionRevision < source.revisions.projectionRevision
  ) {
    return unrecognized('$.revisions', { ...snapshot.revisions });
  }
  return { ok: true, value: snapshot };
}

function rollCommitSnapshotMatchesReceipt(
  snapshot: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<RollCommitResult>,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  const result = receipt.result;
  if ((result as { readonly variant?: string }).variant === 'FIVE_STARTING_POSITIONS_ROLL')
    return fiveStartingPositionsSnapshotMatchesReceipt(snapshot, receipt);
  if ((result as { readonly variant?: string }).variant === 'STARTING_MONEY_ROLL')
    return startingMoneySnapshotMatchesReceipt(snapshot, receipt);
  if (
    result.stage === 'SYMBIONTS' &&
    (result as { readonly variant?: string }).variant === 'STARTING_WEAPON_QUALITY'
  ) {
    return startingWeaponSnapshotMatchesReceipt(snapshot, receipt);
  }
  if (
    result.stage === 'SYMBIONTS' &&
    (result as { readonly variant?: string }).variant === 'ARMOR_BUNDLE_QUALITY'
  ) {
    const checkpointReceipt = receipt as unknown as CommandReceipt<CheckpointResult>;
    const matched = armorBundleSnapshotMatchesReceipt(snapshot, checkpointReceipt);
    if (!matched.ok) return matched;
    const projection = snapshot.projection as Chr021Projection;
    const rollResult = result as unknown as {
      readonly qualityRollRequestId: string;
      readonly qualityRecommendation: { readonly rawFace: number } | null;
    };
    if (
      projection.qualityRollRequestId !== rollResult.qualityRollRequestId ||
      projection.qualityRecommendation === null ||
      projection.qualityRecommendation.rawFace !== rollResult.qualityRecommendation?.rawFace ||
      projection.bundleCheckpointReceiptIdOrNull !== null
    ) {
      return unrecognized('$.presentation.base.roleFilteredPayload', projection);
    }
    return matched;
  }
  if (result.stage === 'SYMBIONTS' && result.variant === 'TROGR_SUPPRESSION_B') {
    return advisorIntelligenceFloorSnapshotMatchesReceipt(
      snapshot,
      receipt as CommandReceipt<AdvisorIntelligenceFloorRollResult>,
      source,
    );
  }
  if (result.stage === 'SYMBIONTS') {
    return result.variant === 'ADVISOR_IW'
      ? manualAdvisorIwSnapshotMatchesReceipt(
          snapshot,
          receipt as CommandReceipt<ManualAdvisorIwResult>,
          source,
        )
      : symbiontRollSnapshotMatchesReceipt(
          snapshot,
          receipt as CommandReceipt<SymbiontRollCommitResult>,
        );
  }
  if (snapshot.formId !== 'CHR-003' && snapshot.formId !== 'CHR-004') {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  if (result.sourceFormId === 'CHR-003') {
    if (result.nextFormId === 'CHR-003' && snapshot.formId !== 'CHR-003') {
      return unrecognized('$.presentation.base.formId', snapshot.formId);
    }
  } else if (snapshot.formId !== 'CHR-004') {
    return unrecognized('$.presentation.base.formId', snapshot.formId);
  }
  const projection = snapshot.projection;
  const currentDraftRevision = projection['draftRevision'];
  if (
    typeof currentDraftRevision !== 'number' ||
    !Number.isSafeInteger(currentDraftRevision) ||
    currentDraftRevision < result.draftRevision
  ) {
    return unrecognized(
      '$.presentation.base.roleFilteredPayload.draftRevision',
      currentDraftRevision!,
    );
  }
  const advance = currentDraftRevision - result.draftRevision;
  for (const [key, expected] of [
    ['characterDraftId', result.characterDraftId],
    ['wizardCheckpointId', result.checkpointId],
    ['branchUuid', result.branchUuid],
  ] as const) {
    if (projection[key] !== expected) {
      return unrecognized(`$.presentation.base.roleFilteredPayload.${key}`, projection[key]!);
    }
  }
  if (
    snapshot.revisions.actorVisibilityRevision !== receipt.revisions.actorVisibilityRevision ||
    snapshot.revisions.projectionRevision !== receipt.revisions.projectionRevision + advance ||
    snapshot.revisions.stateRevision !== receipt.revisions.stateRevision + advance
  ) {
    return unrecognized('$.revisions', { ...snapshot.revisions });
  }
  if (result.sourceFormId === 'CHR-003') {
    if (projection['setRollReceiptId'] !== result.setRollReceiptId) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.setRollReceiptId',
        projection['setRollReceiptId']!,
      );
    }
    if (
      snapshot.formId === 'CHR-003' &&
      (projection['setRollRequestId'] !== result.setRollRequestId ||
        !sameJson(projection['facesOrManualInputs']!, result.faces) ||
        !sameJson(projection['naturalCriticalQueue']!, result.naturalCriticalQueue) ||
        projection['shownResultLocked'] !== true)
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.setRollRequestId',
        projection['setRollRequestId']!,
      );
    }
    if (
      advance === 0 &&
      snapshot.formId === 'CHR-004' &&
      projection['confirmationRollRequestId'] !== result.confirmationRollRequestIdOrNull
    ) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.confirmationRollRequestId',
        projection['confirmationRollRequestId']!,
      );
    }
  } else {
    if (projection['setRollReceiptId'] !== result.setRollReceiptId) {
      return unrecognized(
        '$.presentation.base.roleFilteredPayload.setRollReceiptId',
        projection['setRollReceiptId']!,
      );
    }
    if (advance === 0) {
      const nextRequestId = result.nextConfirmationRollRequestIdOrNull;
      const terminal = nextRequestId === null;
      if (
        projection['confirmationRollRequestId'] !==
          (terminal ? result.confirmationRollRequestId : nextRequestId) ||
        projection['confirmationFace'] !== (terminal ? result.confirmationFace : null) ||
        projection['confirmationReceiptId'] !== (terminal ? result.confirmationReceiptId : null) ||
        projection['returnDecisionFormId'] !== result.returnDecisionFormId ||
        (terminal &&
          (projection['criticalQueueIndex'] !== result.criticalQueueIndex ||
            projection['originFace'] !== result.originFace))
      ) {
        return unrecognized(
          '$.presentation.base.roleFilteredPayload.confirmationRollRequestId',
          projection['confirmationRollRequestId']!,
        );
      }
    }
  }
  return { ok: true, value: snapshot };
}

function decodeCommandDestinationSnapshot(
  message: ProjectionSnapshotV2Message,
  pending: PendingCheckpoint & {
    readonly receipt: CommandReceipt<CheckpointResult>;
  },
  previous: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (message.presentation.assignment.correlationId !== pending.request.commandId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'COMMAND_DESTINATION') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
  return decoded.ok
    ? checkpointSnapshotMatchesReceipt(decoded.value, pending.receipt, pending.sourceSnapshot)
    : decoded;
}

function decodeSetDecisionDestinationSnapshot(
  message: ProjectionSnapshotV2Message,
  pending: PendingSetDecision & {
    readonly receipt: CommandReceipt<SetDecisionResult>;
  },
  previous: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (message.presentation.assignment.correlationId !== pending.request.commandId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'COMMAND_DESTINATION') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
  return decoded.ok
    ? setDecisionSnapshotMatchesReceipt(decoded.value, pending.receipt, previous)
    : decoded;
}

function decodeRollCommitDestinationSnapshot(
  message: ProjectionSnapshotV2Message,
  pending: PendingRollCommit & {
    readonly receipt: CommandReceipt<RollCommitResult>;
  },
  previous: ConfirmedProjectionSnapshot,
): DecodeResult<ConfirmedProjectionSnapshot> {
  if (message.presentation.assignment.correlationId !== pending.request.commandId) {
    return unrecognized(
      '$.presentation.assignment.correlationId',
      message.presentation.assignment.correlationId,
    );
  }
  if (message.presentation.assignment.reason !== 'COMMAND_DESTINATION') {
    return unrecognized('$.presentation.assignment.reason', message.presentation.assignment.reason);
  }
  const decoded = decodeConfirmedSnapshot(message, previous.executableWorkflowCommandIds);
  return decoded.ok
    ? rollCommitSnapshotMatchesReceipt(decoded.value, pending.receipt, pending.sourceSnapshot)
    : decoded;
}

function decodeDeviceIdentity(value: unknown): DecodeResult<string> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object with deviceId',
      path: '$',
    });
  }
  const keys = exactObjectKeys(value, DEVICE_ID_KEYS, '$');
  if (!keys.ok) return keys;
  const deviceId = value['deviceId'];
  if (typeof deviceId !== 'string') {
    return refused({
      actualType: wireType(deviceId),
      code: 'INVALID_SHAPE',
      expected: 'canonical lowercase UUID v4',
      path: '$.deviceId',
    });
  }
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    return unrecognized('$.deviceId', deviceId);
  }
  return { ok: true, value: deviceId };
}

function decodeDeviceIdentityError(value: unknown): DecodeResult<string> {
  if (!isJsonObject(value)) {
    return refused({
      actualType: wireType(value),
      code: 'INVALID_SHAPE',
      expected: 'JSON object with error',
      path: '$',
    });
  }
  const keys = exactObjectKeys(value, DEVICE_ID_ERROR_KEYS, '$');
  if (!keys.ok) return keys;
  const detail = value['error'];
  if (typeof detail !== 'string' || detail.length === 0) {
    return refused({
      actualType: wireType(detail),
      code: 'INVALID_SHAPE',
      expected: 'non-empty error string',
      path: '$.error',
    });
  }
  return { ok: true, value: detail };
}

export function stateSocketUrl(pageHref: string): string {
  const url = new URL('/state', pageHref);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else throw new Error(`web client cannot derive a WebSocket URL from ${url.protocol}`);
  return url.href;
}

function deviceIdentityUrl(pageHref: string): string {
  return new URL('/device-identity', pageHref).href;
}

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unavailableContextStorage(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'SecurityError' || error.name === 'QuotaExceededError')
  );
}

function readGmContextTicket(): string | null {
  try {
    return window.sessionStorage?.getItem(GM_CONTEXT_STORAGE_KEY) ?? null;
  } catch (error: unknown) {
    if (!unavailableContextStorage(error)) throw error;
    return null;
  }
}

function storeGmContextTicket(contextId: string | null): void {
  try {
    if (contextId === null) window.sessionStorage?.removeItem(GM_CONTEXT_STORAGE_KEY);
    else window.sessionStorage?.setItem(GM_CONTEXT_STORAGE_KEY, contextId);
  } catch (error: unknown) {
    if (!unavailableContextStorage(error)) throw error;
    // This optional locator is not authority; the connection retains its signed context in memory.
  }
}

function networkContextTicket(value?: string | null): string | null {
  try {
    if (value === undefined)
      return window.sessionStorage?.getItem(NETWORK_CONTEXT_STORAGE_KEY) ?? null;
    if (value === null) window.sessionStorage?.removeItem(NETWORK_CONTEXT_STORAGE_KEY);
    else window.sessionStorage?.setItem(NETWORK_CONTEXT_STORAGE_KEY, value);
  } catch (error: unknown) {
    if (!unavailableContextStorage(error)) throw error;
  }
  return null;
}
export const LOCAL_ROLE_CHOICE_DETAIL = 'Выберите роль для восстановления этого окна.';

function createRequestId(
  prefix: 'command' | 'identity' | 'navigation' | 'reconnect' | 'campaign-draft' | 'network-draft',
): string {
  const entropy = crypto.getRandomValues(new Uint32Array(4));
  return `${prefix}-${[...entropy].map((value) => value.toString(16).padStart(8, '0')).join('')}`;
}

/** The same ID crosses the private peer codec; Web Crypto randomUUID needs a secure context. */
function createNetworkCommandId(): string | null {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  } catch {
    return null;
  }
}

function envelopeProtocolVersion(source: string): unknown {
  try {
    const value: unknown = JSON.parse(source);
    return isJsonObject(value) ? value['protocolVersion'] : undefined;
  } catch {
    return undefined;
  }
}

function identityCheckpointPayload(
  snapshot: ConfirmedProjectionSnapshot,
): IdentityCheckpointPayload {
  const value = snapshot.projection;
  return {
    stage: 'IDENTITY',
    characterDraftId: value['characterDraftId'] as string,
    wizardCheckpointId: value['wizardCheckpointId'] as string,
    draftRevision: value['draftRevision'] as number,
    name: value['name'] as string,
    description: value['description'] as string | null,
    artAssetKeyOrLocalFile: value[
      'artAssetKeyOrLocalFile'
    ] as IdentityDraftValues['artAssetKeyOrLocalFile'],
    age: value['age'] as number,
    sex: value['sex'] as Exclude<IdentityDraftValues['sex'], null>,
    massKg: value['massKg'] as number,
  };
}

function statAssignmentCheckpointPayload(
  snapshot: ConfirmedProjectionSnapshot,
  draft: CharacterStatAssignmentDraft | null,
): StatAssignmentCheckpointPayload {
  if (
    snapshot.formId !== 'CHR-009' ||
    draft === null ||
    draft.assignmentMode !== snapshot.projection['assignmentMode'] ||
    draft.validation !== 'READY_TO_CHECKPOINT'
  ) {
    throw new Error('CHR-009 requires a complete valid local assignment');
  }
  const values = draft.valuesByStat as StatMap<number>;
  const common = {
    characterDraftId: snapshot.projection['characterDraftId'] as string,
    draftRevision: snapshot.projection['draftRevision'] as number,
    sourceFormId: 'CHR-009',
    stage: 'STAT_ASSIGNMENT',
    wizardCheckpointId: snapshot.projection['wizardCheckpointId'] as string,
  } as const;
  return draft.assignmentMode === 'ROLLED_BIJECTION'
    ? { ...common, setEntryIndexByStat: values }
    : { ...common, pointBuyStats: values };
}

function skillCardCheckpointPayload(
  snapshot: ConfirmedProjectionSnapshot,
  draft: CharacterSkillCardDraft | null,
): SkillSelectionCheckpointPayload {
  if (snapshot.formId !== 'CHR-014' || draft?.formId !== 'CHR-014') {
    throw new Error('CHR-014 requires an explicit signed level');
  }
  const projection = snapshot.projection as Chr014Projection;
  const level = projection.levelsAndBonuses.find(
    ({ targetBonus }) => targetBonus === draft.targetBonus,
  );
  if (
    projection.eligibility !== 'ELIGIBLE' ||
    level === undefined ||
    projection.selectedSkills.some(({ skillId }) => skillId === projection.skillId)
  ) {
    throw new Error('CHR-014 requires an eligible skill and a host-signed level');
  }
  const selectedSkills = [
    ...projection.selectedSkills.map(({ skillId, targetBonus }) => ({ skillId, targetBonus })),
    { skillId: projection.skillId, targetBonus: level.targetBonus },
  ].sort(
    (left, right) =>
      projection.eligibleSkillIds.indexOf(left.skillId) -
      projection.eligibleSkillIds.indexOf(right.skillId),
  );
  return {
    characterDraftId: projection.characterDraftId,
    draftRevision: projection.selectionRevision,
    selectedSkills,
    sourceFormId: 'CHR-014',
    stage: 'SKILLS',
    wizardCheckpointId: projection.wizardCheckpointId,
  };
}

function skillSelectionCheckpointPayload(
  snapshot: ConfirmedProjectionSnapshot,
  draft: CharacterSkillSelectionDraft | null,
): SkillSelectionCheckpointPayload {
  if (
    snapshot.formId !== 'CHR-015' ||
    (snapshot.projection['selectionCheckpoint'] === 'EXACT' &&
      snapshot.projection['pureEquipmentInitializationRequired'] !== true) ||
    draft === null ||
    draft.selectionValidation.kind !== 'EXACT'
  ) {
    throw new Error('CHR-015 requires an exact valid local skill selection');
  }
  return {
    characterDraftId: snapshot.projection['characterDraftId'] as string,
    draftRevision: snapshot.projection['draftRevision'] as number,
    selectedSkills: draft.selectedSkills.map(({ skillId, targetBonus }) => ({
      skillId,
      targetBonus,
    })),
    sourceFormId: 'CHR-015',
    stage: 'SKILLS',
    wizardCheckpointId: snapshot.projection['wizardCheckpointId'] as string,
  };
}

function setDecisionPayload(
  snapshot: ConfirmedProjectionSnapshot,
  choice: CharacterCreationChoiceDraft,
): SetDecisionPayload {
  if (choice.formId !== snapshot.formId) {
    throw new Error(`character creation choice ${choice.formId} does not match ${snapshot.formId}`);
  }
  if (choice.formId === 'CHR-011') {
    return {
      characterDraftId: snapshot.projection['characterDraftId'] as string,
      draftRevision: snapshot.projection['draftRevision'] as number,
      pureClass: choice.value,
      sourceFormId: 'CHR-011',
      stage: 'STAT_ASSIGNMENT',
      wizardCheckpointId: snapshot.projection['wizardCheckpointId'] as string,
    };
  }
  const common = {
    characterDraftId: snapshot.projection['characterDraftId'] as string,
    draftRevision: snapshot.projection['draftRevision'] as number,
    stage: 'RACE_AND_METHOD',
    wizardCheckpointId: snapshot.projection['wizardCheckpointId'] as string,
  } as const;
  switch (choice.formId) {
    case 'CHR-010':
      return { ...common, raceChoice: choice.value, sourceFormId: choice.formId };
    case 'CHR-016':
      return {
        ...common,
        sourceFormId: choice.formId,
        symbiontAcquisitionMode: choice.value,
      };
    case 'CHR-036':
      return { ...common, diceInputMode: choice.value, sourceFormId: choice.formId };
    case 'CHR-002':
      return { ...common, sourceFormId: choice.formId, statMethod: choice.value };
  }
}

function statRollSetDecisionPayload(
  snapshot: ConfirmedProjectionSnapshot,
  actionKey: ActionKey,
): StatRollAcceptSetPayload | StatRollDialogDecisionPayload | null {
  const active = activePresentedForm(snapshot);
  const common = {
    characterDraftId: active.projection['characterDraftId'] as string,
    draftRevision: active.projection['draftRevision'] as number,
    stage: 'STAT_ROLLS',
    wizardCheckpointId: active.projection['wizardCheckpointId'] as string,
  } as const;
  if (isCreationSetDecisionFormId(active.formId)) {
    const rule = CREATION_SET_DECISION_FORMS[active.formId];
    return actionKey === rule.acceptActionKey
      ? { ...common, decision: 'ACCEPT_SET', sourceFormId: active.formId }
      : null;
  }
  if (active.formId !== 'CHR-028') return null;
  if (actionKey === 'CHR-028::CTA::001') {
    return { ...common, decision: 'CONFIRM', sourceFormId: 'CHR-028' };
  }
  return actionKey === 'CHR-028::CTA::002'
    ? { ...common, decision: 'CANCEL', sourceFormId: 'CHR-028' }
    : null;
}

function rollCommitPayload(
  snapshot: ConfirmedProjectionSnapshot,
  draft: CharacterCreationRollDraft | null,
): RollCommitPayload {
  const common = {
    branchUuid: snapshot.projection['branchUuid'] as string,
    characterDraftId: snapshot.projection['characterDraftId'] as string,
    draftRevision: snapshot.projection['draftRevision'] as number,
    stage: 'STAT_ROLLS',
    wizardCheckpointId: snapshot.projection['wizardCheckpointId'] as string,
  } as const;
  if (snapshot.formId === 'CHR-003') {
    const manualFacesOrNull =
      snapshot.projection['diceInputModeSnapshot'] === 'AUTO'
        ? null
        : draft?.formId === 'CHR-003' && completeManualRollDraft(draft)
          ? (draft.faces as readonly number[])
          : null;
    if (snapshot.projection['diceInputModeSnapshot'] === 'MANUAL' && manualFacesOrNull === null) {
      throw new Error('CHR-003 requires seven complete MANUAL faces');
    }
    return {
      ...common,
      manualFacesOrNull,
      setRollRequestId: snapshot.projection['setRollRequestId'] as string,
      sourceFormId: 'CHR-003',
    };
  }
  if (snapshot.formId === 'CHR-004') {
    const manualFaceOrNull =
      snapshot.projection['diceInputModeSnapshot'] === 'AUTO'
        ? null
        : draft?.formId === 'CHR-004' && completeManualRollDraft(draft)
          ? draft.face
          : null;
    if (snapshot.projection['diceInputModeSnapshot'] === 'MANUAL' && manualFaceOrNull === null) {
      throw new Error('CHR-004 requires one complete MANUAL face');
    }
    return {
      ...common,
      confirmationRollRequestId: snapshot.projection['confirmationRollRequestId'] as string,
      criticalQueueIndex: snapshot.projection['criticalQueueIndex'] as number,
      manualFaceOrNull,
      setRollReceiptId: snapshot.projection['setRollReceiptId'] as string,
      sourceFormId: 'CHR-004',
    };
  }
  throw new Error(`ROLL-COMMIT is unavailable on ${snapshot.formId}`);
}

type NetworkGmDecisionRequest =
  | WorkflowCommandRequestMessage<
      'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW',
      NetworkGmAcceptToReviewPayload
    >
  | WorkflowCommandRequestMessage<'UI-CMD-DEVICE-REQUEST-REJECT', NetworkGmRejectRequestPayload>;
type GmBrowserRequest = NetworkGmDecisionRequest | AdmissionBrowserRequest;
export interface NetworkGmRequestDraftClientState extends NetworkGmRequestEditState {
  readonly lastRefusal: NetworkGmRequestDraftRefusal | null;
}
function gmRequestProjection(p: JsonObject): Net017Projection | null {
  try {
    return networkGmRequestProjectionValue(p);
  } catch {
    return null;
  }
}
function expectedGmRequestActions(
  p: Net017Projection,
  caps: readonly WorkflowCommandId[],
): readonly ActionKey[] {
  if (p.commandId !== null) return [];
  return [
    ...(caps.includes('UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW') &&
    networkGmAcceptToReviewPayload(p) !== null
      ? ['NET-017::CTA::007' as const]
      : []),
    ...(caps.includes('UI-CMD-DEVICE-REQUEST-REJECT') &&
    networkGmRejectRequestPayload(p) !== null &&
    p.selectedAdmissionOrNull?.published !== true
      ? ['NET-017::CTA::008' as const]
      : []),
    ...(p.requests.find((row) => row.requestId === p.selectedRequestIdOrNull)?.requestStatus ===
      'IN_REVIEW' && p.selectedAdmissionOrNull !== null
      ? [
          ...(!p.selectedAdmissionOrNull.published && caps.includes('UI-CMD-ADMISSION-REVIEW-OPEN')
            ? ['NET-017::CTA::010' as const]
            : []),
          ...(p.selectedAdmissionOrNull.hasProposed
            ? [
                'NET-017::CTA::001' as const,
                'NET-017::CTA::002' as const,
                'NET-017::CTA::003' as const,
                'NET-017::CTA::004' as const,
              ]
            : []),
        ]
      : []),
    'NET-017::CTA::009',
  ];
}
function gmQueueScope(
  s: ConfirmedProjectionSnapshot,
): { contextId: string; campaignId: string } | null {
  const contextId =
    s.formId === 'NET-017' || isAdmissionGmForm(s.formId)
      ? s.projection['contextId']
      : s.formId === 'CMP-006'
        ? s.projection['gmLocalContextId']
        : null;
  const campaignId = s.projection['campaignId'];
  return typeof contextId === 'string' && typeof campaignId === 'string'
    ? { contextId, campaignId }
    : null;
}
function gmQueueMonotonic(
  next: ConfirmedProjectionSnapshot,
  previous: ConfirmedProjectionSnapshot,
): boolean {
  const a = gmQueueScope(next),
    b = gmQueueScope(previous);
  if (
    a === null ||
    b === null ||
    a.contextId !== b.contextId ||
    a.campaignId !== b.campaignId ||
    next.revisions.actorVisibilityRevision < previous.revisions.actorVisibilityRevision ||
    next.revisions.stateRevision < previous.revisions.stateRevision ||
    next.revisions.projectionRevision < previous.revisions.projectionRevision
  )
    return false;
  if (
    (isAdmissionGmForm(next.formId) || isAdmissionGmForm(previous.formId)) &&
    sameCampaignRevisions(next.revisions, previous.revisions) &&
    (next.formId !== previous.formId ||
      !sameJson(next.projection, previous.projection) ||
      next.layers.length !== previous.layers.length ||
      next.layers.some(
        (layer, i) =>
          layer.formId !== previous.layers[i]?.formId ||
          !sameJson(layer.projection, previous.layers[i].projection),
      ))
  )
    return false;
  if (next.formId === 'NET-017' && previous.formId === 'NET-017') {
    const n = gmRequestProjection(next.projection),
      p = gmRequestProjection(previous.projection);
    if (
      n === null ||
      p === null ||
      n.requestQueueRevision < p.requestQueueRevision ||
      !sameJson(n.returnContext, p.returnContext)
    )
      return false;
    for (const old of p.requests) {
      const row = n.requests.find((r) => r.requestId === old.requestId);
      if (row === undefined) {
        if (n.requestQueueRevision === p.requestQueueRevision) return false;
        continue;
      }
      if (
        row.requestOwnerDeviceId !== old.requestOwnerDeviceId ||
        row.requestRevision < old.requestRevision ||
        row.requestedCandidateCount !== old.requestedCandidateCount ||
        !sameJson(row.batchCharacterSummaries, old.batchCharacterSummaries)
      )
        return false;
      if (
        row.requestRevision === old.requestRevision &&
        (row.requestStatus !== old.requestStatus ||
          row.decisionReceiptIdOrNull !== old.decisionReceiptIdOrNull ||
          row.gmMessageOrNull !== old.gmMessageOrNull)
      )
        return false;
    }
    if (
      n.requestQueueRevision === p.requestQueueRevision &&
      n.requests.some((row) => !p.requests.some((old) => old.requestId === row.requestId))
    )
      return false;
    if (sameCampaignRevisions(next.revisions, previous.revisions) && !sameJson(n, p)) return false;
  }
  if (
    next.formId === 'CMP-006' &&
    previous.formId === 'CMP-006' &&
    !sameGmCampaignBirth(next.projection, previous.projection)
  )
    return false;
  return true;
}
function sameGmCampaignBirth(a: JsonObject, b: JsonObject): boolean {
  const { hostBindRecovery: _oldRecovery, ...old } = a,
    { hostBindRecovery: _nextRecovery, ...next } = b;
  return sameJson(old, next);
}
function gmDecisionReceipt(
  value: CommandReceipt<JsonObject>,
  request: GmBrowserRequest,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<CommandReceipt> {
  if (isAdmissionWorkflow(request.workflowCommandId)) {
    try {
      return {
        ok: true,
        value: admissionBrowserReceipt(value, request as AdmissionBrowserRequest, source),
      };
    } catch {
      return unrecognized('$.receipt', null);
    }
  }
  return preliminaryGmDecisionReceipt(value, request as NetworkGmDecisionRequest, source);
}
function preliminaryGmDecisionReceipt(
  value: CommandReceipt<JsonObject>,
  request: NetworkGmDecisionRequest,
  source: ConfirmedProjectionSnapshot,
): DecodeResult<CommandReceipt<NetworkGmRequestDecisionReceipt>> {
  const p = gmRequestProjection(source.projection),
    row = p?.requests.find((r) => r.requestId === request.payload.requestId);
  if (p === null || row === undefined) return unrecognized('$.receipt.result', null);
  let result: NetworkGmRequestDecisionReceipt;
  try {
    result = networkGmRequestDecisionReceiptValue(value.result, row.batchCharacterSummaries);
  } catch {
    return unrecognized('$.receipt.result', null);
  }
  if (
    value.commandId !== request.commandId ||
    value.receiptId !== result.receiptId ||
    result.commandId !== request.commandId ||
    result.workflowCommandId !== request.workflowCommandId ||
    result.campaignId !== request.payload.campaignId ||
    result.requestId !== request.payload.requestId ||
    result.requestOwnerDeviceId !== row.requestOwnerDeviceId ||
    result.beforeRequestStatus !== row.requestStatus ||
    result.beforeRequestRevision !== request.payload.requestRevision ||
    (request.workflowCommandId === 'UI-CMD-DEVICE-REQUEST-REJECT' &&
      result.decisionReasonOrNull !== request.payload.reason) ||
    !sameCampaignRevisions(value.revisions, {
      stateRevision: request.expectedRevisions.stateRevision + 1,
      projectionRevision: request.expectedRevisions.projectionRevision + 1,
      actorVisibilityRevision: request.expectedRevisions.actorVisibilityRevision,
    })
  )
    return unrecognized('$.receipt', null);
  return { ok: true, value: { ...value, result } };
}
export function gmDecisionDestination(
  next: ConfirmedProjectionSnapshot,
  source: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt,
  replay: boolean,
): boolean {
  const workflow = receipt.result['workflowCommandId'];
  if (typeof workflow !== 'string' || !isAdmissionWorkflow(workflow))
    return preliminaryGmDecisionDestination(
      next,
      source,
      receipt as CommandReceipt<NetworkGmRequestDecisionReceipt>,
      replay,
    );
  if (
    !gmQueueMonotonic(next, source) ||
    (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).some(
      (axis) => next.revisions[axis] < receipt.revisions[axis],
    )
  )
    return false;
  if (!sameCampaignRevisions(next.revisions, receipt.revisions)) return true;
  const active = activePresentedForm(next),
    target =
      workflow === 'UI-CMD-ADMISSION-REVIEW-OPEN'
        ? 'NET-018'
        : workflow === 'UI-CMD-GM-WEAPON-REQUEST-RESOLVE'
          ? 'NET-019'
          : workflow === 'UI-CMD-ADMISSION-GM-ACCEPT'
            ? 'NET-021'
            : 'NET-022';
  const p = active.projection,
    result = receipt.result;
  if (active.formId !== target || p['admissionBatchId'] !== result['admissionBatchId'])
    return false;
  if (workflow === 'UI-CMD-ADMISSION-GM-ACCEPT')
    return (
      p['published'] === true &&
      p['editable'] === false &&
      p['proposalChecksum'] === result['proposalChecksumOrNull'] &&
      sameJson(
        (p['proposedCampaignCopies'] as readonly JsonObject[]).map(
          (copy) => copy['campaignCharacterIdOrNull']!,
        ),
        result['campaignCharacterIds']!,
      )
    );
  if (workflow === 'UI-CMD-ADMISSION-GM-REJECT')
    return p['editable'] === false && p['reason'] === result['reasonOrNull'];
  if (workflow === 'UI-CMD-ADMISSION-REVIEW-OPEN') {
    const original = result['originalOpenReceipt'] as JsonObject;
    return sameJson(
      (p['batchReviewCopies'] as readonly JsonObject[]).map((copy) => copy['reviewCopyId']!),
      (original['reviewCopies'] as readonly JsonObject[]).map((copy) => copy['reviewCopyId']!),
    );
  }
  return (
    p['selectedReviewCopyId'] === result['reviewCopyId'] &&
    p['reviewRevisionOrNull'] === result['reviewRevision'] &&
    (p['viewValues'] as JsonObject)['weaponDraftOrNull'] === null &&
    ((p['reviewDraft'] as JsonObject)['weaponDecisionRefs'] as readonly JsonObject[]).some(
      (ref) => ref['decisionReceiptId'] === receipt.receiptId,
    )
  );
}
function preliminaryGmDecisionDestination(
  next: ConfirmedProjectionSnapshot,
  source: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<NetworkGmRequestDecisionReceipt>,
  _replay: boolean,
): boolean {
  if (
    !gmQueueMonotonic(next, source) ||
    next.revisions.stateRevision < receipt.revisions.stateRevision ||
    next.revisions.projectionRevision < receipt.revisions.projectionRevision
  )
    return false;
  const old = gmRequestProjection(source.projection);
  if (old === null) return false;
  const later = !sameCampaignRevisions(next.revisions, receipt.revisions);
  if (next.formId === 'CMP-006')
    return (
      later &&
      old.returnContext.originFormId === 'CMP-006' &&
      next.projection['creationReceiptId'] === old.returnContext.creationReceiptId
    );
  if (isAdmissionGmForm(next.formId))
    return later && receipt.result.afterRequestStatus === 'IN_REVIEW';
  const p = gmRequestProjection(next.projection),
    row = p?.requests.find((r) => r.requestId === receipt.result.requestId);
  if (
    p === null ||
    row === undefined ||
    p.requestQueueRevision < old.requestQueueRevision + 1 ||
    row.requestOwnerDeviceId !== receipt.result.requestOwnerDeviceId ||
    row.requestRevision < receipt.result.requestRevision
  )
    return false;
  if (row.requestRevision === receipt.result.requestRevision)
    return (
      row.requestStatus === receipt.result.afterRequestStatus &&
      row.decisionReceiptIdOrNull === receipt.receiptId &&
      row.gmMessageOrNull === receipt.result.decisionReasonOrNull
    );
  return (
    receipt.result.afterRequestStatus === 'IN_REVIEW' &&
    row.requestStatus === 'REJECTED' &&
    row.requestRevision === receipt.result.requestRevision + 1 &&
    row.decisionReceiptIdOrNull !== null &&
    row.gmMessageOrNull !== null &&
    row.gmMessageOrNull.trim().length > 0
  );
}
function gmCampaignCreateDestination(
  next: ConfirmedProjectionSnapshot,
  receipt: CommandReceipt<CampaignCreateResult>,
): boolean {
  const r = receipt.result;
  if (next.formId === 'CMP-006')
    return (
      campaignCreateDestinationMatches(next.formId, next.projection, r.targetRevisions, receipt) &&
      next.revisions.stateRevision >= r.targetRevisions.stateRevision &&
      next.revisions.projectionRevision >= r.targetRevisions.projectionRevision &&
      next.revisions.actorVisibilityRevision === r.targetRevisions.actorVisibilityRevision
    );
  const p = next.formId === 'NET-017' ? gmRequestProjection(next.projection) : null;
  return (
    p !== null &&
    p.contextId === r.gmLocalContextId &&
    p.campaignId === r.campaignId &&
    p.returnContext.originFormId === 'CMP-006' &&
    p.returnContext.creationReceiptId === receipt.receiptId &&
    next.revisions.stateRevision >= receipt.revisions.stateRevision &&
    next.revisions.projectionRevision >= receipt.revisions.projectionRevision &&
    next.revisions.actorVisibilityRevision === receipt.revisions.actorVisibilityRevision
  );
}
function ownerRequestPush(
  next: ConfirmedProjectionSnapshot,
  old: ConfirmedProjectionSnapshot,
): boolean {
  if (next.formId !== 'NET-005' || old.formId !== 'NET-005') return false;
  const n = next.projection,
    p = old.projection;
  for (const key of [
    'deviceId',
    'networkScopeId',
    'contextId',
    'controllerSeat',
    'campaignIdOrNull',
    'sessionId',
    'requestId',
    'requestOwnerDeviceId',
    'batchCharacterSummaries',
  ] as const)
    if (!sameJson(n[key] ?? null, p[key] ?? null)) return false;
  if (
    next.revisions.actorVisibilityRevision !== old.revisions.actorVisibilityRevision ||
    next.revisions.stateRevision < old.revisions.stateRevision ||
    next.revisions.projectionRevision < old.revisions.projectionRevision ||
    typeof n['requestRevision'] !== 'number' ||
    typeof p['requestRevision'] !== 'number' ||
    n['requestRevision'] < p['requestRevision']
  )
    return false;
  const before = p['requestStatus'],
    after = n['requestStatus'];
  if (sameCampaignRevisions(next.revisions, old.revisions) && !sameJson(n, p)) return false;
  if (n['requestRevision'] === p['requestRevision'])
    return after === before && n['gmMessage'] === p['gmMessage'];
  return (
    (before === 'PENDING' &&
      ((after === 'IN_REVIEW' && n['requestRevision'] === p['requestRevision'] + 1) ||
        (after === 'REJECTED' && n['requestRevision'] <= p['requestRevision'] + 2))) ||
    (before === 'IN_REVIEW' &&
      after === 'REJECTED' &&
      n['requestRevision'] === p['requestRevision'] + 1)
  );
}

export function connectProjection(
  onState: (state: WebClientState) => void,
  onIdentityDraft: (state: IdentityDraftClientState | null) => void = () => {},
  onCreationChoiceDraft: (value: CharacterCreationChoiceDraft | null) => void = () => {},
  onCreationRollDraft: (value: CharacterCreationRollDraft | null) => void = () => {},
  onStatAssignmentDraft: (value: CharacterStatAssignmentDraft | null) => void = () => {},
  onSkillSelectionDraft: (value: CharacterSkillSelectionDraft | null) => void = () => {},
  onRandomSymbiontDraft: (value: RandomSymbiontDraft | null) => void = () => {},
  onAdvisorSkillSelectionDraft: (value: AdvisorSkillSelectionDraft | null) => void = () => {},
  onSkillCardDraft: (value: CharacterSkillCardDraft | null) => void = () => {},
  onManualCompositionDraft: (value: ManualCompositionDraft | null) => void = () => {},
  onArmorBundleDraft: (value: ArmorBundleDraft | null) => void = () => {},
  onStartingWeaponDraft: (value: StartingWeaponDraft | null) => void = () => {},
  onPostSaveDownload: (
    value: NonNullable<PostSaveCommandResult['downloadOrNull']>,
  ) => void = () => {},
  onPostSaveCommitted: (value: PostSaveCommandResult) => void = () => {},
  onCampaignDraft: (value: CampaignDraftClientState | null) => void = () => {},
  onNetworkDraft: (value: NetworkDraftClientState | null) => void = () => {},
  onNetworkGmRequestDraft: (value: NetworkGmRequestDraftClientState | null) => void = () => {},
): ProjectionConnection {
  let deviceId: string | null = null;
  let disposed = false;
  let identity: IdentityDraftClient | null = null;
  let terminal = false;
  let lastSnapshot: ConfirmedProjectionSnapshot | null = null;
  let gmLocalContextId: string | null = null;
  let networkScopeId: string | null = null;
  let pendingOwnerCommand: {
    request: AdmissionOwnerCommand;
    source: ConfirmedProjectionSnapshot;
    receipt: CommandReceipt | null;
  } | null = null;
  let gmEdit: NetworkGmRequestDraftValues | null = null;
  let pendingAdmissionDraft: {
    request: AdmissionGmClientV3Message;
    source: ConfirmedProjectionSnapshot;
  } | null = null;
  let gmEditVersion = 0;
  let gmDraftRefusal: NetworkGmRequestDraftRefusal | null = null;
  let gmTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingGmDraft: {
    request: NetworkGmRequestDraftReplaceV3Message;
    editVersion: number;
  } | null = null;
  let pendingGmCommand: {
    request: GmBrowserRequest;
    receipt: CommandReceipt | null;
    source: ConfirmedProjectionSnapshot;
    replay: boolean;
  } | null = null;
  let pendingGmRefusal: {
    request: GmBrowserRequest;
    source: ConfirmedProjectionSnapshot;
    refusal: CommandRefusalMessage;
  } | null = null;
  const gmQueueHeads = new Map<
    string,
    { revisions: RevisionVector; queueRevision: number | null; birth: JsonObject | null }
  >();
  const ownGmQueue = (next: ConfirmedProjectionSnapshot): boolean => {
    const scope = gmQueueScope(next);
    if (scope === null || scope.contextId !== gmLocalContextId) return false;
    const key = JSON.stringify(scope),
      old = gmQueueHeads.get(key),
      p = next.formId === 'NET-017' ? gmRequestProjection(next.projection) : null;
    if (next.formId === 'CMP-006' && next.projection['hostDeviceId'] !== deviceId) return false;
    if (
      old !== undefined &&
      (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).some(
        (axis) => next.revisions[axis] < old.revisions[axis],
      )
    )
      return false;
    if (
      old?.queueRevision !== null &&
      old?.queueRevision !== undefined &&
      p !== null &&
      p.requestQueueRevision < old.queueRevision
    )
      return false;
    if (old?.birth !== null && old?.birth !== undefined) {
      if (next.formId === 'CMP-006' && !sameGmCampaignBirth(old.birth, next.projection))
        return false;
      if (
        p !== null &&
        p.returnContext.originFormId === 'CMP-006' &&
        p.returnContext.creationReceiptId !== old.birth['creationReceiptId']
      )
        return false;
    }
    return true;
  };
  const rememberGmQueue = (next: ConfirmedProjectionSnapshot): void => {
    const scope = gmQueueScope(next);
    if (scope === null) return;
    const key = JSON.stringify(scope),
      old = gmQueueHeads.get(key),
      p = next.formId === 'NET-017' ? gmRequestProjection(next.projection) : null;
    gmQueueHeads.set(key, {
      revisions: next.revisions,
      queueRevision: p?.requestQueueRevision ?? old?.queueRevision ?? null,
      birth: next.formId === 'CMP-006' ? next.projection : (old?.birth ?? null),
    });
  };

  let contextChoiceRequired = false;
  let networkEdit: NetworkEdit | null = null;
  let networkEditVersion = 0;
  let networkInputPending = false;
  let networkRefusal: NetworkDraftRefusal | null = null;
  let networkTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingNetworkDraft: { request: NetworkDraftReplaceV3Message; editVersion: number } | null =
    null;
  let pendingNetworkCommand: {
    request: NetworkWorkflowRequest;
    receipt: CommandReceipt<NetworkCommandResult> | null;
    replay: boolean;
    source: ConfirmedProjectionSnapshot;
  } | null = null;
  let absentNetworkCommandId: string | null = null;
  let pendingNetworkRefusal: {
    request: NetworkWorkflowRequest;
    source: ConfirmedProjectionSnapshot;
    refusal: CommandRefusalMessage;
  } | null = null;
  let campaignEdit: CampaignEdit | null = null;
  let campaignEditVersion = 0;
  let campaignSecretClearSequence = 0;
  let campaignInputPending = false;
  let campaignRefusal: CampaignDraftRefusal | null = null;
  let campaignTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCampaignDraft: { request: CampaignDraftReplaceV3Message; editVersion: number } | null =
    null;
  let pendingCampaignCreate: {
    request: CampaignCreateRequest;
    receipt: CommandReceipt<CampaignCreateResult> | null;
    source: ConfirmedProjectionSnapshot;
  } | null = null;
  let pendingCheckpoint: PendingCheckpoint | null = null;
  let pendingPostSave: {
    request: PostSaveRequest | PostSaveDraftRequest;
    receipt: CommandReceipt<PostSaveCommandResult> | null;
    source: ConfirmedProjectionSnapshot;
  } | null = null;
  const downloadedReceipts = new Set<string>();
  let pendingSetDecision: PendingSetDecision | null = null;
  let pendingRollCommit: PendingRollCommit | null = null;
  let pendingFormAction: FormActionIntentV2Message | null = null;
  let pendingAddressableRoute: AddressableRouteIntentV2Message | null = null;
  let playerContextId: string | null = null;
  let creationChoiceDraft: CharacterCreationChoiceDraft | null = null;
  let creationRollDraft: CharacterCreationRollDraft | null = null;
  let statAssignmentDraft: CharacterStatAssignmentDraft | null = null;
  let skillSelectionDraft: CharacterSkillSelectionDraft | null = null;
  let randomSymbiontDraft: RandomSymbiontDraft | null = null;
  let advisorSkillSelectionDraft: AdvisorSkillSelectionDraft | null = null;
  let skillCardDraft: CharacterSkillCardDraft | null = null;
  let manualCompositionDraft: ManualCompositionDraft | null = null;
  let armorBundleDraft: ArmorBundleDraft | null = null;
  let startingWeaponDraft: StartingWeaponDraft | null = null;
  let socket: WebSocket | null = null;
  let stagedCapabilities: SessionReconnectCapabilitiesV2Message | null = null;
  const commandPending = () =>
    pendingOwnerCommand !== null ||
    pendingAdmissionDraft !== null ||
    pendingGmDraft !== null ||
    pendingGmCommand !== null ||
    pendingGmRefusal !== null ||
    pendingNetworkDraft !== null ||
    pendingNetworkCommand !== null ||
    pendingNetworkRefusal !== null ||
    networkInputPending ||
    pendingCampaignDraft !== null ||
    pendingCampaignCreate !== null ||
    campaignInputPending ||
    pendingPostSave !== null ||
    pendingCheckpoint !== null ||
    pendingSetDecision !== null ||
    pendingRollCommit !== null;
  const visibleSnapshotBase = (
    snapshot: ConfirmedProjectionSnapshot,
    identityValue: IdentityDraftClient | null,
    pending = false,
    choice: CharacterCreationChoiceDraft | null = null,
    roll: CharacterCreationRollDraft | null = null,
    assignment: CharacterStatAssignmentDraft | null = null,
    skills: CharacterSkillSelectionDraft | null = null,
  ): ConfirmedProjectionSnapshot => {
    const visible = visibleSnapshotCore(
      snapshot,
      identityValue,
      pending,
      choice,
      roll,
      assignment,
      skills,
      randomSymbiontDraft,
      advisorSkillSelectionDraft,
      skillCardDraft,
      manualCompositionDraft,
    );
    if (isAdmissionGmForm(snapshot.formId) || isAdmissionOwnerForm(snapshot.formId))
      return {
        ...visible,
        availableActionKeys: pending ? [] : visible.availableActionKeys,
        layers: visible.layers.map((layer) => ({
          ...layer,
          availableActionKeys: pending ? [] : layer.availableActionKeys,
        })),
      };
    if (snapshot.formId === 'NET-017')
      return {
        ...visible,
        availableActionKeys: pending || gmEdit !== null ? [] : visible.availableActionKeys,
      };
    if (isNetworkApplicationForm(snapshot.formId))
      return {
        ...visible,
        availableActionKeys:
          pending || networkInputPending || networkEdit !== null ? [] : visible.availableActionKeys,
      };
    if (!isCampaignCreationForm(snapshot.formId)) return visible;
    const continueKey = (
      {
        'CMP-001': 'CMP-001::CTA::001',
        'CMP-002': 'CMP-002::CTA::002',
        'CMP-003': 'CMP-003::CTA::002',
        'CMP-004': 'CMP-004::CTA::002',
        'CMP-005': CAMPAIGN_CREATE_ACTION_KEY,
      } as const
    )[snapshot.formId as 'CMP-001' | 'CMP-002' | 'CMP-003' | 'CMP-004' | 'CMP-005'];
    return {
      ...visible,
      availableActionKeys:
        pending || campaignInputPending
          ? []
          : campaignEdit !== null
            ? visible.availableActionKeys.filter((key) => key !== continueKey)
            : visible.availableActionKeys,
    };
  };
  const publishCampaignDraft = () =>
    onCampaignDraft(
      lastSnapshot !== null && isCampaignEditableForm(lastSnapshot.formId)
        ? {
            values:
              campaignEdit?.variant === 'SECRET' ||
              campaignEdit?.variant !==
                campaignEditFromProjection(lastSnapshot.formId, lastSnapshot.projection)?.variant
                ? null
                : campaignEdit,
            dirty: campaignEdit !== null || campaignInputPending,
            pending: pendingCampaignDraft !== null,
            lastRefusal: campaignRefusal,
            secretClearSequence: campaignSecretClearSequence,
          }
        : null,
    );
  const clearCampaignDraft = () => {
    if (campaignTimer !== null) clearTimeout(campaignTimer);
    campaignTimer = null;
    campaignEdit = null;
    pendingCampaignDraft = null;
    campaignInputPending = false;
    campaignRefusal = null;
    campaignSecretClearSequence += 1;
  };
  const publishNetworkDraft = () =>
    onNetworkDraft(
      lastSnapshot !== null && isNetworkEditableForm(lastSnapshot.formId)
        ? {
            values:
              networkEdit?.variant ===
              networkEditFromProjection(lastSnapshot.formId, lastSnapshot.projection)?.variant
                ? networkEdit
                : null,
            dirty: networkEdit !== null || networkInputPending,
            pending: pendingNetworkDraft !== null,
            lastRefusal: networkRefusal,
          }
        : null,
    );
  const clearNetworkDraft = () => {
    if (networkTimer !== null) clearTimeout(networkTimer);
    networkTimer = null;
    networkEdit = null;
    pendingNetworkDraft = null;
    networkInputPending = false;
    networkRefusal = null;
  };
  const publishGmDraft = () => {
    const p =
      lastSnapshot?.formId === 'NET-017' ? gmRequestProjection(lastSnapshot.projection) : null;
    onNetworkGmRequestDraft(
      p === null
        ? null
        : {
            values: gmEdit ?? networkGmRequestDraftFromProjection(p),
            dirty: gmEdit !== null,
            pending:
              pendingGmDraft !== null || pendingGmCommand !== null || pendingGmRefusal !== null,
            lastRefusal: gmDraftRefusal,
          },
    );
  };
  let gmDraftRefresh: NetworkGmRequestDraftReplaceV3Message | null = null;
  let gmDraftRebaseAttempted = false;
  const clearGmDraft = () => {
    gmDraftRefresh = null;
    if (gmTimer !== null) clearTimeout(gmTimer);
    gmTimer = null;
    gmEdit = null;
    pendingGmDraft = null;
    gmDraftRefusal = null;
  };
  const discardDisconnectedGmInput = () => {
    if (gmTimer !== null) clearTimeout(gmTimer);
    gmTimer = null;
    if (pendingGmDraft === null && gmDraftRefresh === null) gmEdit = null;
    publishGmDraft();
  };
  const flushGmDraft = (): void => {
    if (gmTimer !== null) clearTimeout(gmTimer);
    gmTimer = null;
    if (
      disposed ||
      terminal ||
      lastSnapshot?.formId !== 'NET-017' ||
      gmLocalContextId === null ||
      gmEdit === null ||
      pendingGmDraft !== null ||
      pendingGmCommand !== null ||
      pendingGmRefusal !== null ||
      pendingFormAction !== null ||
      pendingAddressableRoute !== null ||
      socket?.readyState !== WebSocket.OPEN
    )
      return;
    const p = gmRequestProjection(lastSnapshot.projection);
    if (p === null || p.contextId !== gmLocalContextId) return;
    if (sameJson(gmEdit, networkGmRequestDraftFromProjection(p))) {
      gmEdit = null;
      publishGmDraft();
      notifyReady();
      return;
    }
    // A new selection clears the old reason at the host. Preserve text typed after that local selection for a second, correctly based draft.
    const values =
      gmEdit.selectedRequestIdOrNull === p.selectedRequestIdOrNull
        ? gmEdit
        : { selectedRequestIdOrNull: gmEdit.selectedRequestIdOrNull, decisionReason: '' };
    const editVersion = sameJson(values, gmEdit) ? gmEditVersion : gmEditVersion - 1;
    const request: NetworkGmRequestDraftReplaceV3Message = {
      protocolVersion: 3,
      messageType: 'network.gm-request-draft.replace',
      draftUpdateId: createRequestId('network-draft'),
      scope: { gmLocalContextId, campaignId: p.campaignId, sourceFormId: 'NET-017' },
      expectedRevisions: { ...lastSnapshot.revisions },
      expectedRequestQueueRevision: p.requestQueueRevision,
      values,
    };
    const encoded = encodeClientMessageV3(request, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok) {
      gmDraftRefusal = { code: 'DRAFT_UNAVAILABLE' };
      publishGmDraft();
      notifyReady();
      return;
    }
    pendingGmDraft = { request, editVersion };
    try {
      socket.send(encoded.text);
    } catch {
      socket.close(1000, 'GM draft delivery interrupted');
    }
    publishGmDraft();
    notifyReady();
  };

  const discardDisconnectedNetworkInput = () => {
    if (networkTimer !== null) clearTimeout(networkTimer);
    networkTimer = null;
    if (pendingNetworkDraft === null) networkEdit = null;
    networkInputPending = false;
    publishNetworkDraft();
  };
  const discardDisconnectedCampaignInput = () => {
    if (campaignTimer !== null) clearTimeout(campaignTimer);
    campaignTimer = null;
    if (pendingCampaignDraft?.request.variant === 'SECRET' || campaignEdit?.variant === 'SECRET')
      clearCampaignDraft();
    else if (pendingCampaignDraft === null) campaignEdit = null;
    campaignInputPending = false;
    publishCampaignDraft();
  };
  const visibleLast = () =>
    lastSnapshot === null
      ? null
      : visibleSnapshotBase(
          lastSnapshot,
          identity,
          commandPending(),
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        );

  const closeAfterTerminalState = () => {
    if (
      socket !== null &&
      (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
    ) {
      socket.close(1002, 'wire frame refused');
    }
  };

  const failProtocol = (refusal: DecodeRefusal, detail: string) => {
    if (disposed || terminal) return;
    terminal = true;
    pendingOwnerCommand = null;
    pendingAdmissionDraft = null;
    clearGmDraft();
    pendingGmCommand = null;
    pendingGmRefusal = null;
    publishGmDraft();
    pendingCheckpoint = null;
    clearNetworkDraft();
    publishNetworkDraft();
    pendingNetworkCommand = null;
    pendingNetworkRefusal = null;
    clearCampaignDraft();
    publishCampaignDraft();
    pendingCampaignCreate = null;
    pendingPostSave = null;
    pendingSetDecision = null;
    pendingRollCommit = null;
    pendingFormAction = null;
    pendingAddressableRoute = null;
    stagedCapabilities = null;
    const response = {
      messageType: 'protocol.refusal',
      protocolVersion: WIRE_PROTOCOL_VERSION,
      refusal,
      relatedCommandId: null,
    } as const satisfies ProtocolRefusalMessage;
    const encoded = encodeClientMessage(response, WEB_PROTOCOL_VOCABULARY);
    let deliveryDetail = '';
    if (!encoded.ok) {
      deliveryDetail = ` Checked refusal could not be encoded: ${JSON.stringify(encoded.refusal)}.`;
    } else if (socket === null || socket.readyState !== WebSocket.OPEN) {
      deliveryDetail = ` Checked refusal was not sent because socket state is ${String(socket?.readyState)}.`;
    } else {
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        deliveryDetail = ` Checked refusal could not be sent: ${diagnostic(error)}.`;
      }
    }
    onState({
      detail: `${detail}${deliveryDetail}`,
      kind: 'protocol-error',
      refusal,
      snapshot: visibleLast(),
    });
    closeAfterTerminalState();
  };
  const failUnexpected = (path: string, value: JsonValue, detail: string): void =>
    failProtocol({ code: 'UNRECOGNIZED', path, value }, detail);

  const sendIdentity = (request: ReturnType<IdentityDraftClient['edit']>): boolean => {
    if (request === null || socket === null || socket.readyState !== WebSocket.OPEN) return false;
    const encoded = encodeClientMessageV3(request, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok)
      throw new Error(`identity draft encoding failed: ${JSON.stringify(encoded.refusal)}`);
    socket.send(encoded.text);
    return true;
  };

  const flushCampaignDraft = (): void => {
    campaignTimer = null;
    if (
      disposed ||
      terminal ||
      lastSnapshot === null ||
      !isCampaignEditableForm(lastSnapshot.formId) ||
      campaignEdit === null ||
      pendingCampaignDraft !== null ||
      campaignInputPending ||
      pendingFormAction !== null ||
      pendingAddressableRoute !== null ||
      pendingCampaignCreate !== null ||
      socket?.readyState !== WebSocket.OPEN ||
      !campaignEditIsSendable(campaignEdit)
    )
      return;
    if (
      campaignEdit.variant !== 'SECRET' &&
      sameJson(
        campaignEdit,
        campaignEditFromProjection(lastSnapshot.formId, lastSnapshot.projection),
      )
    ) {
      campaignEdit = null;
      publishCampaignDraft();
      notifyReady();
      return;
    }
    const request = {
      messageType: 'campaign.draft.replace',
      protocolVersion: 3,
      draftUpdateId: createRequestId('campaign-draft'),
      scope: {
        gmLocalContextId: lastSnapshot.projection['gmLocalContextId'],
        campaignDraftId: lastSnapshot.projection['campaignDraftId'],
        sourceFormId: lastSnapshot.formId,
      },
      expectedDraftRevision: lastSnapshot.projection['draftRevision'],
      expectedRevisions: { ...lastSnapshot.revisions },
      ...campaignEdit,
    } as CampaignDraftReplaceV3Message;
    const encoded = encodeClientMessageV3(request, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok) {
      campaignRefusal = { code: 'DRAFT_UNAVAILABLE' };
      publishCampaignDraft();
      notifyReady();
      return;
    }
    pendingCampaignDraft = { request, editVersion: campaignEditVersion };
    try {
      socket.send(encoded.text);
    } catch {
      clearCampaignDraft();
      campaignRefusal = { code: 'DRAFT_UNAVAILABLE' };
    }
    publishCampaignDraft();
    notifyReady();
  };

  const flushNetworkDraft = (): void => {
    if (networkTimer !== null) clearTimeout(networkTimer);
    networkTimer = null;
    if (
      disposed ||
      terminal ||
      lastSnapshot === null ||
      !isNetworkEditableForm(lastSnapshot.formId) ||
      networkEdit === null ||
      pendingNetworkDraft !== null ||
      networkInputPending ||
      pendingNetworkCommand !== null ||
      pendingFormAction !== null ||
      pendingAddressableRoute !== null ||
      socket?.readyState !== WebSocket.OPEN ||
      !networkEditIsSendable(networkEdit) ||
      networkEdit.variant !==
        networkEditFromProjection(lastSnapshot.formId, lastSnapshot.projection)?.variant
    )
      return;
    if (
      sameJson(networkEdit, networkEditFromProjection(lastSnapshot.formId, lastSnapshot.projection))
    ) {
      networkEdit = null;
      publishNetworkDraft();
      notifyReady();
      return;
    }
    const request = {
      messageType: 'network.draft.replace',
      protocolVersion: 3,
      draftUpdateId: createRequestId('network-draft'),
      scope: {
        networkScopeId,
        contextId: lastSnapshot.projection['contextId'],
        sourceFormId: lastSnapshot.formId,
      },
      expectedDraftRevision: lastSnapshot.projection['draftRevision'],
      expectedRevisions: { ...lastSnapshot.revisions },
      ...networkEdit,
    } as NetworkDraftReplaceV3Message;
    const encoded = encodeClientMessageV3(request, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok) {
      networkRefusal = { code: 'DRAFT_UNAVAILABLE' };
      publishNetworkDraft();
      notifyReady();
      return;
    }
    pendingNetworkDraft = { request, editVersion: networkEditVersion };
    try {
      socket.send(encoded.text);
    } catch {
      socket.close(1000, 'network draft delivery interrupted');
    }
    publishNetworkDraft();
    notifyReady();
  };

  const adoptSnapshot = (next: ConfirmedProjectionSnapshot, reconnect: boolean): void => {
    const previous = lastSnapshot;
    if (next.formId !== 'NET-017' && pendingGmDraft === null) clearGmDraft();
    if (next.formId === 'NET-017' && gmEdit !== null) {
      const p = gmRequestProjection(next.projection);
      if (
        p !== null &&
        gmEdit.selectedRequestIdOrNull !== null &&
        !p.requests.some((r) => r.requestId === gmEdit!.selectedRequestIdOrNull)
      ) {
        gmEdit = { selectedRequestIdOrNull: null, decisionReason: '' };
        gmEditVersion++;
      }
    }
    rememberGmQueue(next);
    const networkExit =
      networkScopeId !== null && (next.formId === 'APP-002' || next.formId === 'CHR-040');
    if (
      pendingNetworkDraft === null &&
      (previous?.formId !== next.formId ||
        previous?.projection['networkScopeId'] !== next.projection['networkScopeId'] ||
        (networkEdit !== null &&
          (!isNetworkEditableForm(next.formId) ||
            networkEdit.variant !==
              networkEditFromProjection(next.formId, next.projection)?.variant)))
    )
      clearNetworkDraft();
    if (isNetworkApplicationForm(next.formId) || isAdmissionOwnerForm(next.formId)) {
      networkScopeId = next.projection['networkScopeId'] as string;
      networkContextTicket(networkScopeId);
      gmLocalContextId = null;
      storeGmContextTicket(null);
    } else if (networkExit || next.formId === 'NET-017' || isCampaignCreationForm(next.formId)) {
      if (networkScopeId !== null) {
        networkScopeId = null;
        networkContextTicket(null);
      }
    }
    const campaignLaunch =
      previous?.formId === 'APP-001' && next.formId === 'APP-011' && !reconnect;
    const campaignExit = previous?.formId === 'APP-011' && next.formId === 'APP-001' && !reconnect;
    const sameCampaignDraft =
      previous !== null &&
      previous.formId === next.formId &&
      previous.projection['campaignDraftId'] !== undefined &&
      previous.projection['campaignDraftId'] === next.projection['campaignDraftId'];
    if (!sameCampaignDraft && pendingCampaignDraft === null) clearCampaignDraft();
    if (isCampaignCreationForm(next.formId)) {
      gmLocalContextId = next.projection['gmLocalContextId'] as string;
      try {
        storeGmContextTicket(gmLocalContextId);
      } catch {
        failUnexpected(
          '$.gmLocalContextId',
          null,
          'The GM context ticket could not be stored for this tab.',
        );
        return;
      }
    } else if (next.formId === 'NET-017' || isAdmissionGmForm(next.formId)) {
      const p =
        next.formId === 'NET-017'
          ? gmRequestProjection(next.projection)
          : admissionGmProjectionValue(next.formId, next.projection);
      if (p === null || p.contextId !== gmLocalContextId) {
        failUnexpected('$.contextId', null, 'GM queue changed the owned ticket.');
        return;
      }
      storeGmContextTicket(gmLocalContextId);
    } else if (next.formId === 'APP-001') {
      gmLocalContextId = null;
      storeGmContextTicket(null);
    }
    pendingCampaignCreate = null;
    const postSaveReceipt = pendingPostSave?.receipt;
    if (postSaveReceipt !== null && postSaveReceipt !== undefined)
      onPostSaveCommitted(postSaveReceipt.result);
    if (
      postSaveReceipt !== null &&
      postSaveReceipt !== undefined &&
      postSaveReceipt.result.downloadOrNull !== null &&
      !downloadedReceipts.has(postSaveReceipt.receiptId)
    ) {
      downloadedReceipts.add(postSaveReceipt.receiptId);
      onPostSaveDownload(postSaveReceipt.result.downloadOrNull);
    }
    pendingPostSave = null;
    const checkpointResult = pendingCheckpoint?.receipt?.result;
    const committedCompositionRevision =
      checkpointResult?.stage === 'SYMBIONTS' &&
      'variant' in checkpointResult &&
      checkpointResult.variant === 'MANUAL_COMPOSITION' &&
      typeof checkpointResult.compositionDraftRevision === 'number'
        ? checkpointResult.compositionDraftRevision
        : undefined;
    lastSnapshot = next;
    if (pendingCheckpoint !== null) pendingCheckpoint = null;
    if (pendingSetDecision !== null) pendingSetDecision = null;
    if (pendingRollCommit !== null) pendingRollCommit = null;
    pendingAddressableRoute = null;
    creationChoiceDraft = null;
    const correction = Object.hasOwn(next.projection, 'correctionContext');
    onCreationChoiceDraft(creationChoiceDraft);
    creationRollDraft = correction ? null : creationRollDraftFromSnapshot(next);
    onCreationRollDraft(creationRollDraft);
    statAssignmentDraft = correction ? null : creationStatAssignmentDraftFromSnapshot(next);
    onStatAssignmentDraft(statAssignmentDraft);
    skillSelectionDraft = correction ? null : creationSkillSelectionDraftFromSnapshot(next);
    onSkillSelectionDraft(skillSelectionDraft);
    randomSymbiontDraft = correction ? null : randomSymbiontDraftFromSnapshot(next);
    onRandomSymbiontDraft(randomSymbiontDraft);
    advisorSkillSelectionDraft = correction ? null : advisorSkillSelectionDraftFromSnapshot(next);
    onAdvisorSkillSelectionDraft(advisorSkillSelectionDraft);
    skillCardDraft = next.formId === 'CHR-014' ? { formId: 'CHR-014', targetBonus: null } : null;
    onSkillCardDraft(skillCardDraft);
    manualCompositionDraft = correction
      ? null
      : manualCompositionDraftFromSnapshot(
          next,
          reconnect ? null : manualCompositionDraft,
          committedCompositionRevision,
        );
    onManualCompositionDraft(manualCompositionDraft);
    armorBundleDraft =
      next.formId === 'CHR-021'
        ? armorBundleDraftFromSnapshot(next.projection as Chr021Projection)
        : null;
    onArmorBundleDraft(armorBundleDraft);
    startingWeaponDraft =
      next.formId === 'CHR-022'
        ? startingWeaponDraftFromSnapshot(next.projection as Chr022Projection)
        : null;
    onStartingWeaponDraft(startingWeaponDraft);
    if (next.formId === 'APP-001') playerContextId = null;
    else if (next.formId === 'APP-002') playerContextId = next.projection['contextId'] as string;
    else if (next.formId === 'CHR-001' && isJsonObject(next.projection['identityDraftScope']))
      playerContextId = next.projection['identityDraftScope']['contextId'] as string;
    const draft = correction ? null : identitySnapshot(next, playerContextId);
    let replay = null;
    if (draft === null) identity = null;
    else if (identity === null || !reconnect)
      identity = new IdentityDraftClient(draft, () => createRequestId('identity'));
    else replay = identity.resumeAfterSnapshot(draft);
    onIdentityDraft(identity?.state ?? null);
    publishCampaignDraft();
    publishNetworkDraft();
    publishGmDraft();
    onState({
      kind: 'ready',
      snapshot: visibleSnapshotBase(
        next,
        identity,
        commandPending() || campaignLaunch,
        creationChoiceDraft,
        creationRollDraft,
        statAssignmentDraft,
        skillSelectionDraft,
      ),
    });
    sendIdentity(replay);
    if ((campaignLaunch || campaignExit) && deviceId !== null) {
      const oldSocket = socket;
      openTransport(deviceId);
      oldSocket?.close(1000, 'launch capability negotiation');
    } else if (
      reconnect &&
      pendingAdmissionDraft !== null &&
      socket?.readyState === WebSocket.OPEN
    ) {
      const encoded = encodeClientMessageV3(pendingAdmissionDraft.request, WEB_PROTOCOL_VOCABULARY);
      if (encoded.ok) socket.send(encoded.text);
      else
        failUnexpected('$.admission', null, 'The original admission draft could not be replayed.');
    } else if (reconnect && gmDraftRefresh !== null) {
      const original = gmDraftRefresh;
      gmDraftRefresh = null;
      const p = next.formId === 'NET-017' ? gmRequestProjection(next.projection) : null;
      if (
        p !== null &&
        p.contextId === original.scope.gmLocalContextId &&
        p.campaignId === original.scope.campaignId &&
        p.requestQueueRevision === original.expectedRequestQueueRevision &&
        next.revisions.stateRevision === original.expectedRevisions.stateRevision &&
        next.revisions.actorVisibilityRevision ===
          original.expectedRevisions.actorVisibilityRevision &&
        next.revisions.projectionRevision > original.expectedRevisions.projectionRevision
      )
        flushGmDraft();
      else {
        gmEdit = null;
        publishGmDraft();
        notifyReady();
      }
    } else if (
      reconnect &&
      (pendingGmDraft !== null ||
        (pendingGmCommand !== null && pendingGmCommand.receipt === null)) &&
      socket?.readyState === WebSocket.OPEN
    ) {
      const encoded =
        pendingGmDraft !== null
          ? encodeClientMessageV3(pendingGmDraft.request, WEB_PROTOCOL_VOCABULARY)
          : pendingGmCommand !== null
            ? encodeClientMessage(pendingGmCommand.request, WEB_PROTOCOL_VOCABULARY)
            : null;
      if (encoded?.ok) socket.send(encoded.text);
      else
        failUnexpected(
          '$.network.gm-request',
          null,
          'The exact pending GM delivery could not be replayed.',
        );
    } else if (
      reconnect &&
      pendingNetworkCommand !== null &&
      absentNetworkCommandId === pendingNetworkCommand.request.commandId &&
      socket?.readyState === WebSocket.OPEN
    ) {
      absentNetworkCommandId = null;
      const encoded = encodeClientMessage(pendingNetworkCommand.request, WEB_PROTOCOL_VOCABULARY);
      if (encoded.ok) socket.send(encoded.text);
      else
        failUnexpected(
          '$.command.request',
          null,
          'The original unseen network intention could not be replayed.',
        );
    } else if (reconnect && pendingNetworkDraft !== null && socket?.readyState === WebSocket.OPEN) {
      const encoded = encodeClientMessageV3(pendingNetworkDraft.request, WEB_PROTOCOL_VOCABULARY);
      if (encoded.ok) socket.send(encoded.text);
      else
        failUnexpected(
          '$.network.draft.replace',
          null,
          'The pending network draft could not be replayed.',
        );
    } else if (
      reconnect &&
      pendingCampaignDraft !== null &&
      socket?.readyState === WebSocket.OPEN
    ) {
      const encoded = encodeClientMessageV3(pendingCampaignDraft.request, WEB_PROTOCOL_VOCABULARY);
      if (encoded.ok) socket.send(encoded.text);
      else
        failUnexpected(
          '$.campaign.draft.replace',
          null,
          'The pending campaign draft could not be replayed.',
        );
    }
  };

  const attachSocket = (
    activeSocket: WebSocket,
    requestId: string,
    reconnectText: string,
    resumedNetworkScopeId: string | null,
  ): void => {
    let expectingCapabilities = true;
    socket = activeSocket;

    activeSocket.onopen = () => {
      if (disposed || terminal || socket !== activeSocket) return;
      try {
        activeSocket.send(reconnectText);
      } catch (error: unknown) {
        socket = null;
        onState({
          code: null,
          detail: `session.reconnect could not be sent: ${diagnostic(error)}`,
          kind: 'disconnected',
          snapshot: visibleLast(),
        });
        return;
      }
      onState({ kind: 'awaiting-snapshot' });
    };

    activeSocket.onmessage = (event) => {
      if (disposed || terminal || socket !== activeSocket) return;
      const frame: unknown = event.data as unknown;
      if (typeof frame !== 'string') {
        failProtocol(
          {
            actualType: wireType(frame),
            code: 'INVALID_SHAPE',
            expected: 'text application frame',
            path: '$',
          },
          'Host sent a binary wire frame.',
        );
        return;
      }

      if (envelopeProtocolVersion(frame) === WIRE_PROTOCOL_VERSION) {
        const decoded = decodeHostMessage(frame, WEB_PROTOCOL_VOCABULARY);
        if (!decoded.ok) {
          failProtocol(decoded.refusal, 'Host frame did not decode as wire v1.');
          return;
        }
        if (stagedCapabilities !== null) {
          failUnexpected(
            '$.messageType',
            decoded.value.messageType,
            'A wire v1 frame interrupted the staged reconnect pair.',
          );
          return;
        }
        const message = decoded.value;
        if (message.messageType === 'command.result' || message.messageType === 'command.replay') {
          if (pendingOwnerCommand !== null) {
            try {
              const receipt = admissionOwnerBrowserReceipt(
                message.receipt,
                pendingOwnerCommand.request,
                pendingOwnerCommand.source,
              );
              if (
                pendingOwnerCommand.receipt !== null &&
                !sameJson(
                  pendingOwnerCommand.receipt as unknown as JsonObject,
                  receipt as unknown as JsonObject,
                )
              )
                throw new Error('changed original admission receipt');
              pendingOwnerCommand = { ...pendingOwnerCommand, receipt };
            } catch {
              failUnexpected('$.receipt', null, 'Invalid whole-batch decision receipt');
            }
            return;
          } else if (pendingGmCommand !== null) {
            const receipt = gmDecisionReceipt(
              message.receipt,
              pendingGmCommand.request,
              pendingGmCommand.source,
            );
            if (!receipt.ok) {
              failProtocol(receipt.refusal, 'Host sent an invalid GM decision receipt.');
              return;
            }
            if (
              pendingGmCommand.receipt !== null &&
              (message.messageType !== 'command.replay' ||
                pendingGmCommand.receipt.commandId !== receipt.value.commandId ||
                pendingGmCommand.receipt.receiptId !== receipt.value.receiptId ||
                !sameCampaignRevisions(
                  pendingGmCommand.receipt.revisions,
                  receipt.value.revisions,
                ) ||
                !sameJson(pendingGmCommand.receipt.result, receipt.value.result))
            ) {
              failUnexpected('$.receipt', null, 'Host changed the original GM decision receipt.');
              return;
            }
            pendingGmCommand = {
              ...pendingGmCommand,
              receipt: receipt.value,
              replay: message.messageType === 'command.replay',
            };
          } else if (pendingNetworkCommand !== null) {
            const receipt = decodeNetworkCommandReceipt(
              message.receipt,
              pendingNetworkCommand.request,
            );
            if (!receipt.ok) {
              failProtocol(receipt.refusal, 'Host sent an invalid network command receipt.');
              return;
            }
            if (
              pendingNetworkCommand.receipt !== null &&
              (message.messageType !== 'command.replay' ||
                JSON.stringify(pendingNetworkCommand.receipt) !== JSON.stringify(receipt.value))
            ) {
              failUnexpected('$.receipt', null, 'Host changed a network command receipt.');
              return;
            }
            pendingNetworkCommand = {
              ...pendingNetworkCommand,
              receipt: receipt.value,
              replay: message.messageType === 'command.replay',
            };
          } else if (pendingCampaignCreate !== null) {
            const receipt = decodeCampaignCreateReceipt(
              message.receipt,
              pendingCampaignCreate.request,
              pendingCampaignCreate.source.projection,
            );
            if (!receipt.ok) {
              failProtocol(receipt.refusal, 'Host sent an invalid campaign creation receipt.');
              return;
            }
            if (
              pendingCampaignCreate.receipt !== null &&
              (message.messageType !== 'command.replay' ||
                JSON.stringify(pendingCampaignCreate.receipt) !== JSON.stringify(receipt.value))
            ) {
              failUnexpected('$.receipt', null, 'Host changed a campaign creation receipt.');
              return;
            }
            pendingCampaignCreate = { ...pendingCampaignCreate, receipt: receipt.value };
          } else if (pendingPostSave !== null) {
            const receipt = decodePostSaveTerminal(
              message,
              pendingPostSave.request,
              pendingPostSave.source.projection,
            );
            if (!receipt.ok) {
              failProtocol(receipt.refusal, 'Host sent an invalid post-save receipt.');
              return;
            }
            if (
              receipt.value.result.restoredCheckpointOrNull !== null &&
              receipt.value.result.restoredCheckpointOrNull.ownerDeviceId !== deviceId
            ) {
              failUnexpected(
                '$.receipt.result.restoredCheckpointOrNull.ownerDeviceId',
                receipt.value.result.restoredCheckpointOrNull.ownerDeviceId,
                'Restored checkpoint belongs to another device.',
              );
              return;
            }
            if (
              pendingPostSave.receipt !== null &&
              (message.messageType !== 'command.replay' ||
                !postSaveReceiptUnchanged(pendingPostSave.receipt, receipt.value))
            ) {
              failUnexpected(
                '$.receipt',
                message.receipt.receiptId,
                'Host changed a confirmed post-save receipt.',
              );
              return;
            }
            pendingPostSave = { ...pendingPostSave, receipt: receipt.value };
          } else if (pendingCheckpoint !== null) {
            if (pendingCheckpoint.receipt !== null && message.messageType !== 'command.replay') {
              failUnexpected(
                '$.messageType',
                message.messageType,
                'Host sent a second non-replay wizard checkpoint terminal.',
              );
              return;
            }
            const receipt = decodeCheckpointTerminal(message, pendingCheckpoint);
            if (!receipt.ok) {
              failProtocol(receipt.refusal, 'Host sent an invalid wizard checkpoint receipt.');
              return;
            }
            if (
              pendingCheckpoint.receipt !== null &&
              !sameCheckpointReceipt(pendingCheckpoint.receipt, receipt.value)
            ) {
              failUnexpected(
                '$.receipt.receiptId',
                receipt.value.receiptId,
                'Host replay changed the confirmed wizard checkpoint receipt.',
              );
              return;
            }
            pendingCheckpoint = { ...pendingCheckpoint, receipt: receipt.value };
          } else if (pendingSetDecision !== null) {
            if (pendingSetDecision.receipt !== null && message.messageType !== 'command.replay') {
              failUnexpected(
                '$.messageType',
                message.messageType,
                'Host sent a second non-replay SET-DECIDE terminal.',
              );
              return;
            }
            const receipt = decodeSetDecisionTerminal(message, pendingSetDecision);
            if (!receipt.ok) {
              failProtocol(receipt.refusal, 'Host sent an invalid SET-DECIDE receipt.');
              return;
            }
            if (
              pendingSetDecision.receipt !== null &&
              !sameSetDecisionReceipt(pendingSetDecision.receipt, receipt.value)
            ) {
              failUnexpected(
                '$.receipt.receiptId',
                receipt.value.receiptId,
                'Host replay changed the confirmed SET-DECIDE receipt.',
              );
              return;
            }
            pendingSetDecision = { ...pendingSetDecision, receipt: receipt.value };
          } else if (pendingRollCommit !== null) {
            if (pendingRollCommit.receipt !== null && message.messageType !== 'command.replay') {
              failUnexpected(
                '$.messageType',
                message.messageType,
                'Host sent a second non-replay ROLL-COMMIT terminal.',
              );
              return;
            }
            const receipt = decodeRollCommitTerminal(message, pendingRollCommit);
            if (!receipt.ok) {
              failProtocol(receipt.refusal, 'Host sent an invalid ROLL-COMMIT receipt.');
              return;
            }
            if (
              pendingRollCommit.receipt !== null &&
              !sameRollCommitReceipt(pendingRollCommit.receipt, receipt.value)
            ) {
              failUnexpected(
                '$.receipt.receiptId',
                receipt.value.receiptId,
                'Host replay changed the confirmed ROLL-COMMIT receipt.',
              );
              return;
            }
            pendingRollCommit = { ...pendingRollCommit, receipt: receipt.value };
          } else {
            failUnexpected(
              '$.messageType',
              message.messageType,
              'Host sent a command terminal without exactly one pending wizard command.',
            );
            return;
          }
          if (lastSnapshot !== null && !expectingCapabilities) {
            onState({
              kind: 'ready',
              snapshot: visibleSnapshotBase(
                lastSnapshot,
                identity,
                true,
                creationChoiceDraft,
                creationRollDraft,
                statAssignmentDraft,
                skillSelectionDraft,
              ),
            });
          }
          return;
        }
        if (message.messageType === 'command.refusal') {
          if (
            pendingOwnerCommand !== null &&
            message.commandId === pendingOwnerCommand.request.commandId
          ) {
            if (pendingOwnerCommand.receipt !== null) {
              failUnexpected('$.commandId', null, 'Admission refusal followed a committed receipt');
              return;
            }
            pendingOwnerCommand = null;
            if (!expectingCapabilities && lastSnapshot !== null) {
              onState({
                kind: 'command-refusal',
                refusal: message.refusal,
                snapshot: visibleSnapshotBase(lastSnapshot, identity, false),
              });
              if (deviceId !== null) {
                const old = socket;
                openTransport(deviceId);
                old?.close(1000, 'refresh admission decision refusal');
              }
            }
            return;
          }
          const matchesGm =
            (pendingGmCommand !== null &&
              pendingGmCommand.receipt === null &&
              pendingGmCommand.request.commandId === message.commandId) ||
            pendingGmRefusal?.request.commandId === message.commandId;
          const matchesNetworkCommand =
            (pendingNetworkCommand !== null &&
              pendingNetworkCommand.receipt === null &&
              message.commandId === pendingNetworkCommand.request.commandId) ||
            pendingNetworkRefusal?.request.commandId === message.commandId;
          const matchesCampaignCreate =
            pendingCampaignCreate !== null &&
            pendingCampaignCreate.receipt === null &&
            message.commandId === pendingCampaignCreate.request.commandId;
          const matchesPostSave =
            pendingPostSave !== null &&
            pendingPostSave.receipt === null &&
            message.commandId === pendingPostSave.request.commandId;
          const matchesCheckpoint =
            pendingCheckpoint !== null &&
            pendingCheckpoint.receipt === null &&
            message.commandId === pendingCheckpoint.request.commandId;
          const matchesSetDecision =
            pendingSetDecision !== null &&
            pendingSetDecision.receipt === null &&
            message.commandId === pendingSetDecision.request.commandId;
          const matchesRollCommit =
            pendingRollCommit !== null &&
            pendingRollCommit.receipt === null &&
            message.commandId === pendingRollCommit.request.commandId;
          if (
            (!matchesGm &&
              !matchesNetworkCommand &&
              !matchesCampaignCreate &&
              !matchesPostSave &&
              !matchesCheckpoint &&
              !matchesSetDecision &&
              !matchesRollCommit) ||
            lastSnapshot === null
          ) {
            failUnexpected(
              '$.commandId',
              message.commandId,
              'Host command refusal does not match the pending wizard command.',
            );
            return;
          }
          if (matchesGm) {
            // Resume reports absence with GUARD_REJECTED before the paired current view. The original intention remains retryable once that pair is verified.
            if (
              expectingCapabilities &&
              pendingGmCommand?.receipt === null &&
              message.lastLifecycleState === null &&
              message.refusal.code === 'GUARD_REJECTED'
            )
              return;
            if (
              pendingGmRefusal !== null &&
              JSON.stringify(pendingGmRefusal.refusal) !== JSON.stringify(message)
            ) {
              failUnexpected('$.commandId', null, 'Host changed a terminal GM refusal.');
              return;
            }
            if (pendingGmCommand !== null)
              pendingGmRefusal = {
                request: pendingGmCommand.request,
                source: pendingGmCommand.source,
                refusal: message,
              };
            pendingGmCommand = null;
            publishGmDraft();
          }
          if (matchesCheckpoint) pendingCheckpoint = null;
          if (matchesNetworkCommand) {
            // Resume absence is not a terminal outcome for an intention the host has never seen.
            if (
              expectingCapabilities &&
              pendingNetworkCommand?.receipt === null &&
              message.lastLifecycleState === null &&
              message.refusal.code === 'GUARD_REJECTED'
            ) {
              absentNetworkCommandId = message.commandId;
              return;
            }
            if (
              pendingNetworkRefusal !== null &&
              JSON.stringify(pendingNetworkRefusal.refusal) !== JSON.stringify(message)
            ) {
              failUnexpected('$.commandId', null, 'Host changed a terminal network refusal.');
              return;
            }
            if (pendingNetworkCommand !== null)
              pendingNetworkRefusal = {
                request: pendingNetworkCommand.request,
                source: pendingNetworkCommand.source,
                refusal: message,
              };
            pendingNetworkCommand = null;
          }
          if (matchesCampaignCreate) pendingCampaignCreate = null;
          if (matchesPostSave) pendingPostSave = null;
          if (matchesSetDecision) pendingSetDecision = null;
          if (matchesRollCommit) pendingRollCommit = null;
          if (!expectingCapabilities) {
            onState({
              kind: 'command-refusal',
              refusal: message.refusal,
              snapshot: visibleSnapshotBase(
                lastSnapshot,
                identity,
                commandPending(),
                creationChoiceDraft,
                creationRollDraft,
                statAssignmentDraft,
                skillSelectionDraft,
              ),
            });
          }
          return;
        }
        if (message.messageType === 'protocol.refusal') {
          terminal = true;
          clearGmDraft();
          publishGmDraft();
          clearNetworkDraft();
          publishNetworkDraft();
          clearCampaignDraft();
          publishCampaignDraft();
          onState({
            kind: 'host-refusal',
            refusal: message.refusal,
            snapshot: visibleLast(),
          });
          closeAfterTerminalState();
          return;
        }
        failUnexpected(
          '$.messageType',
          message.messageType,
          'Host sent a wire v1 message that this reconnect did not request.',
        );
        return;
      }

      if (envelopeProtocolVersion(frame) === WIRE_PROTOCOL_V3_VERSION) {
        const decoded = decodeHostMessageV3(frame, WEB_PROTOCOL_VOCABULARY);
        if (!decoded.ok) {
          failProtocol(decoded.refusal, 'Host frame did not decode as wire v3.');
          return;
        }
        const message = decoded.value;
        if (expectingCapabilities || stagedCapabilities !== null) {
          failUnexpected(
            '$.messageType',
            message.messageType,
            'A wire v3 frame interrupted the staged reconnect pair.',
          );
          return;
        }
        if (
          message.messageType === 'network.admission-draft.result' ||
          message.messageType === 'network.admission-draft.refusal'
        ) {
          const pending = pendingAdmissionDraft;
          if (
            pending === null ||
            lastSnapshot === null ||
            message.draftUpdateId !== pending.request.draftUpdateId ||
            message.contextId !== pending.request.contextId ||
            message.contextId !== gmLocalContextId ||
            message.campaignId !== pending.request.campaignId ||
            message.admissionBatchId !== pending.request.admissionBatchId
          ) {
            failUnexpected(
              '$.admission',
              null,
              'Admission draft response changed its owner or correlation.',
            );
            return;
          }
          if (message.messageType === 'network.admission-draft.refusal') {
            pendingAdmissionDraft = null;
            onState({
              kind: 'command-refusal',
              refusal: { code: 'GUARD_REJECTED' },
              snapshot: visibleSnapshotBase(lastSnapshot, identity, commandPending()),
            });
            if (deviceId !== null) {
              const old = socket;
              openTransport(deviceId);
              old?.close(1000, 'refresh admission refusal');
            }
            return;
          }
          const decoded = decodeConfirmedSnapshot(
            {
              messageType: 'projection.snapshot',
              protocolVersion: 2,
              projectionRole: 'gm',
              revisions: message.revisions,
              presentation: {
                assignment: { reason: 'FORM_ACTION', correlationId: message.draftUpdateId },
                ...message.presentation,
              },
            },
            lastSnapshot.executableWorkflowCommandIds,
          );
          const source = activePresentedForm(pending.source),
            increment =
              pending.request.messageType === 'network.admission-view.replace' &&
              sameJson(
                source.projection['viewValues']!,
                pending.request.values as unknown as JsonObject,
              )
                ? 0
                : 1,
            expected = {
              stateRevision: pending.request.expectedRevisions.stateRevision + increment,
              projectionRevision: pending.request.expectedRevisions.projectionRevision + increment,
              actorVisibilityRevision: pending.request.expectedRevisions.actorVisibilityRevision,
            };
          if (!decoded.ok) {
            failProtocol(decoded.refusal, 'Invalid admission draft presentation.');
            return;
          }
          if (
            !sameCampaignRevisions(message.appliedRevisions, expected) ||
            !ownGmQueue(decoded.value) ||
            !gmQueueMonotonic(decoded.value, lastSnapshot) ||
            (sameCampaignRevisions(message.revisions, message.appliedRevisions) &&
              !admissionDraftDestinationMatches(decoded.value, pending.source, pending.request))
          ) {
            failUnexpected(
              '$.admission',
              null,
              'Admission draft receipt or current scope regressed.',
            );
            return;
          }
          pendingAdmissionDraft = null;
          adoptSnapshot(decoded.value, false);
          return;
        }
        if (
          message.messageType === 'network.gm-request-draft.result' ||
          message.messageType === 'network.gm-request-draft.refusal'
        ) {
          const pending = pendingGmDraft;
          if (
            pending === null ||
            lastSnapshot === null ||
            message.draftUpdateId !== pending.request.draftUpdateId ||
            !sameJson({ ...message.scope }, { ...pending.request.scope }) ||
            message.scope.gmLocalContextId !== gmLocalContextId
          ) {
            failUnexpected(
              '$.network.gm-request-draft',
              null,
              'GM draft response does not match the outstanding owner scope.',
            );
            return;
          }
          if (message.messageType === 'network.gm-request-draft.refusal') {
            pendingGmDraft = null;
            const technicalAdvance =
              message.refusal.code === 'STALE_REVISION' &&
              message.refusal.actual.stateRevision ===
                pending.request.expectedRevisions.stateRevision &&
              message.refusal.actual.actorVisibilityRevision ===
                pending.request.expectedRevisions.actorVisibilityRevision &&
              message.refusal.actual.projectionRevision >
                pending.request.expectedRevisions.projectionRevision;
            if (technicalAdvance && !gmDraftRebaseAttempted) {
              gmDraftRefresh = pending.request;
              gmDraftRebaseAttempted = true;
              gmEdit ??= pending.request.values;
            } else gmEdit = null;
            gmDraftRefusal = message.refusal;
            publishGmDraft();
            notifyReady();
            if (deviceId !== null) {
              const old = socket;
              openTransport(deviceId);
              old?.close(1000, 'refresh GM draft refusal');
            }
            return;
          }
          const candidate = decodeConfirmedSnapshot(
            {
              protocolVersion: 2,
              messageType: 'projection.snapshot',
              projectionRole: 'gm',
              revisions: message.revisions,
              presentation: {
                assignment: { reason: 'FORM_ACTION', correlationId: message.draftUpdateId },
                ...message.presentation,
              },
            },
            lastSnapshot.executableWorkflowCommandIds,
          );
          const expected = {
            stateRevision:
              pending.request.expectedRevisions.stateRevision + (message.changed ? 1 : 0),
            projectionRevision:
              pending.request.expectedRevisions.projectionRevision + (message.changed ? 1 : 0),
            actorVisibilityRevision: pending.request.expectedRevisions.actorVisibilityRevision,
          };
          if (!candidate.ok) {
            failProtocol(candidate.refusal, 'Host sent an invalid GM draft current view.');
            return;
          }
          const p =
            candidate.value.formId === 'NET-017'
              ? gmRequestProjection(candidate.value.projection)
              : null;
          if (
            !sameCampaignRevisions(message.appliedRevisions, expected) ||
            message.appliedRequestQueueRevision !== pending.request.expectedRequestQueueRevision ||
            !ownGmQueue(candidate.value) ||
            !gmQueueMonotonic(candidate.value, lastSnapshot) ||
            (sameCampaignRevisions(message.revisions, message.appliedRevisions) &&
              p !== null &&
              !sameJson(networkGmRequestDraftFromProjection(p), pending.request.values))
          ) {
            failUnexpected(
              '$.network.gm-request-draft.result',
              null,
              'GM draft applied facts or current view changed owner/revision.',
            );
            return;
          }
          pendingGmDraft = null;
          gmDraftRefusal = null;
          if (gmEditVersion === pending.editVersion) gmEdit = null;
          adoptSnapshot(candidate.value, false);
          if (gmEdit !== null) flushGmDraft();
          return;
        }

        if (
          message.messageType === 'network.draft.result' ||
          message.messageType === 'network.draft.refusal'
        ) {
          const pending = pendingNetworkDraft;
          if (
            pending === null ||
            lastSnapshot === null ||
            message.draftUpdateId !== pending.request.draftUpdateId ||
            message.scope.networkScopeId !== pending.request.scope.networkScopeId ||
            message.scope.contextId !== pending.request.scope.contextId ||
            message.scope.sourceFormId !== pending.request.scope.sourceFormId
          ) {
            failUnexpected(
              '$.network.draft',
              null,
              'Network draft response does not match the outstanding update.',
            );
            return;
          }
          if (message.messageType === 'network.draft.refusal') {
            pendingNetworkDraft = null;
            networkEdit = null;
            networkRefusal = message.refusal;
            publishNetworkDraft();
            notifyReady();
            return;
          }
          const candidate = decodeConfirmedSnapshot(
            {
              protocolVersion: 2,
              messageType: 'projection.snapshot',
              projectionRole: 'player',
              revisions: message.revisions,
              presentation: {
                assignment: { correlationId: message.draftUpdateId, reason: 'FORM_ACTION' },
                ...message.presentation,
              },
            },
            lastSnapshot.executableWorkflowCommandIds,
          );
          if (!candidate.ok) {
            failProtocol(candidate.refusal, 'Host sent an invalid network draft view.');
            return;
          }
          if (
            !networkDraftResultMatches(message, pending.request, candidate.value.projection) ||
            (sameNetworkRevisions(candidate.value.revisions, lastSnapshot.revisions) &&
              (candidate.value.formId !== lastSnapshot.formId ||
                !sameJson(candidate.value.projection, lastSnapshot.projection))) ||
            (sameNetworkRevisions(message.appliedRevisions, message.revisions) &&
              message.appliedDraftRevision === message.draftRevision &&
              !sameJson(
                networkEditFromProjection(
                  pending.request.scope.sourceFormId,
                  candidate.value.projection,
                ),
                { variant: pending.request.variant, values: pending.request.values },
              )) ||
            candidate.value.projection['deviceId'] !== deviceId ||
            candidate.value.projection['networkScopeId'] !== networkScopeId ||
            candidate.value.projection['contextId'] !== lastSnapshot.projection['contextId'] ||
            candidate.value.projection['controllerSeat'] !==
              lastSnapshot.projection['controllerSeat'] ||
            (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).some(
              (axis) => candidate.value.revisions[axis] < lastSnapshot!.revisions[axis],
            )
          ) {
            failUnexpected(
              '$.network.draft.result',
              null,
              'Network draft event or current view does not match its owner.',
            );
            return;
          }
          pendingNetworkDraft = null;
          networkRefusal = null;
          if (networkEditVersion === pending.editVersion) networkEdit = null;
          adoptSnapshot(candidate.value, false);
          if (networkEdit !== null) flushNetworkDraft();
          return;
        }
        if (
          message.messageType === 'campaign.draft.result' ||
          message.messageType === 'campaign.draft.refusal'
        ) {
          const pending = pendingCampaignDraft;
          if (
            pending === null ||
            lastSnapshot === null ||
            message.draftUpdateId !== pending.request.draftUpdateId ||
            message.scope.gmLocalContextId !== pending.request.scope.gmLocalContextId ||
            message.scope.campaignDraftId !== pending.request.scope.campaignDraftId ||
            message.scope.sourceFormId !== pending.request.scope.sourceFormId
          ) {
            failUnexpected(
              '$.campaign.draft',
              null,
              'Campaign draft response does not match its pending scope.',
            );
            return;
          }
          if (message.messageType === 'campaign.draft.refusal') {
            pendingCampaignDraft = null;
            campaignRefusal = message.refusal;
            if (pending.request.variant === 'SECRET') {
              campaignEdit = null;
              campaignSecretClearSequence += 1;
            }
            publishCampaignDraft();
            notifyReady();
            return;
          }
          const candidate = decodeConfirmedSnapshot(
            {
              protocolVersion: 2,
              messageType: 'projection.snapshot',
              projectionRole: 'gm',
              revisions: message.revisions,
              presentation: {
                assignment: { correlationId: message.draftUpdateId, reason: 'FORM_ACTION' },
                ...message.presentation,
              },
            },
            lastSnapshot.executableWorkflowCommandIds,
          );
          if (!candidate.ok) {
            failProtocol(candidate.refusal, 'Host sent an invalid campaign draft view.');
            return;
          }
          if (
            !campaignDraftResultMatches(message, pending.request, candidate.value.projection) ||
            candidate.value.projection['hostDeviceId'] !== deviceId ||
            candidate.value.projection['gmLocalContextId'] !== gmLocalContextId ||
            (lastSnapshot.projection['campaignDraftId'] ===
              candidate.value.projection['campaignDraftId'] &&
              (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).some(
                (axis) => candidate.value.revisions[axis] < lastSnapshot!.revisions[axis],
              ))
          ) {
            failUnexpected(
              '$.campaign.draft.result',
              null,
              'Campaign draft event or current view is not bound to the pending update.',
            );
            return;
          }
          pendingCampaignDraft = null;
          campaignRefusal = null;
          if (pending.request.variant === 'SECRET') {
            campaignEdit = null;
            campaignSecretClearSequence += 1;
          } else if (campaignEditVersion === pending.editVersion) campaignEdit = null;
          adoptSnapshot(candidate.value, false);
          if (campaignEdit !== null) flushCampaignDraft();
          return;
        }
        if (message.messageType === 'character.identity-draft.result') {
          if (identity === null || lastSnapshot === null) return;
          const candidate = decodeConfirmedSnapshot(
            {
              messageType: 'projection.snapshot',
              presentation: {
                assignment: { correlationId: message.draftUpdateId, reason: 'FORM_ACTION' },
                ...message.presentation,
              },
              projectionRole: message.projectionRole,
              protocolVersion: WIRE_PROTOCOL_V2_VERSION,
              revisions: message.revisions,
            },
            lastSnapshot.executableWorkflowCommandIds,
          );
          if (!candidate.ok) {
            failProtocol(candidate.refusal, 'Host sent an invalid identity draft result.');
            return;
          }
          const draft = identitySnapshot(candidate.value, playerContextId);
          if (draft === null) return;
          const outstanding = identity.state.outstanding;
          const applicable =
            outstanding?.draftUpdateId === message.draftUpdateId &&
            message.scope.contextId === playerContextId &&
            outstanding.scope.contextId === message.scope.contextId &&
            outstanding.scope.characterDraftId === message.scope.characterDraftId &&
            outstanding.scope.wizardCheckpointId === message.scope.wizardCheckpointId &&
            message.draftRevision >= (lastSnapshot.projection['draftRevision'] as number) &&
            (['stateRevision', 'projectionRevision', 'actorVisibilityRevision'] as const).every(
              (axis) => message.revisions[axis] >= lastSnapshot!.revisions[axis],
            );
          const next = identity.receiveResult(message, draft.values);
          if (applicable) lastSnapshot = candidate.value;
          onIdentityDraft(identity.state);
          onState({
            kind: 'ready',
            snapshot: visibleSnapshotBase(
              lastSnapshot,
              identity,
              commandPending(),
              creationChoiceDraft,
              creationRollDraft,
              statAssignmentDraft,
              skillSelectionDraft,
            ),
          });
          sendIdentity(next);
          return;
        }
        if (identity === null || lastSnapshot === null) return;
        const next = identity.receiveRefusal(message);
        onIdentityDraft(identity.state);
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            commandPending(),
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        sendIdentity(next);
        return;
      }

      const decoded = decodeHostMessageV2(frame, WEB_PROTOCOL_VOCABULARY);
      if (!decoded.ok) {
        failProtocol(decoded.refusal, 'Host frame did not decode as wire v2.');
        return;
      }
      const message = decoded.value;
      if (
        (expectingCapabilities &&
          message.messageType !== 'session.reconnect.capabilities' &&
          !(
            message.messageType === 'projection.snapshot' &&
            message.presentation.assignment.reason === 'COMMAND_DESTINATION' &&
            message.presentation.assignment.correlationId ===
              (pendingGmRefusal?.request.commandId ??
                pendingGmCommand?.request.commandId ??
                pendingNetworkRefusal?.request.commandId ??
                pendingNetworkCommand?.request.commandId)
          )) ||
        (stagedCapabilities !== null && message.messageType !== 'projection.snapshot')
      ) {
        failUnexpected(
          '$.messageType',
          message.messageType,
          'A wire v2 frame interrupted the staged reconnect pair.',
        );
        return;
      }
      if (message.messageType === 'session.reconnect.capabilities') {
        if (!expectingCapabilities || stagedCapabilities !== null) {
          failUnexpected(
            '$.messageType',
            message.messageType,
            'Host sent an extra reconnect capability frame.',
          );
          return;
        }
        expectingCapabilities = false;
        if (message.reconnectRequestId !== requestId) {
          failUnexpected(
            '$.reconnectRequestId',
            message.reconnectRequestId,
            'Host capability frame belongs to another reconnect attempt.',
          );
          return;
        }
        stagedCapabilities = message;
        return;
      }
      if (message.messageType === 'projection.snapshot') {
        if (message.presentation.assignment.reason === 'HOST_SYSTEM_EVENT') {
          if (expectingCapabilities || stagedCapabilities !== null || lastSnapshot === null) {
            failUnexpected('$.messageType', null, 'System refresh interrupted reconnect.');
            return;
          }
          const candidate = decodeConfirmedSnapshot(
            message,
            lastSnapshot.executableWorkflowCommandIds,
          );
          if (!candidate.ok) {
            failProtocol(candidate.refusal, 'Invalid current system view.');
            return;
          }
          const gm =
            (lastSnapshot.formId === 'NET-017' || isAdmissionGmForm(lastSnapshot.formId)) &&
            (candidate.value.formId === 'NET-017' || isAdmissionGmForm(candidate.value.formId)) &&
            /^network-gm-view:[0-9a-f]{64}$/u.test(message.presentation.assignment.correlationId) &&
            ownGmQueue(candidate.value) &&
            gmQueueMonotonic(candidate.value, lastSnapshot);
          const player =
            /^network-owner-view:[0-9a-f]{64}$/u.test(
              message.presentation.assignment.correlationId,
            ) &&
            candidate.value.projection['deviceId'] === deviceId &&
            (ownerRequestPush(candidate.value, lastSnapshot) ||
              admissionOwnerMonotonic(candidate.value, lastSnapshot));
          if (!gm && !player) {
            failUnexpected(
              '$.presentation.assignment',
              null,
              'System refresh changed the active family or owner.',
            );
            return;
          }
          if (pendingOwnerCommand !== null) {
            if (
              !admissionOwnerDecisionDestination(
                candidate.value,
                pendingOwnerCommand.request,
                pendingOwnerCommand.source,
                pendingOwnerCommand.receipt,
                false,
                lastSnapshot.projection['contextId'] as string,
              )
            ) {
              failUnexpected(
                '$.presentation',
                null,
                'Owner update changed the pending batch decision',
              );
              return;
            }
            if (candidate.value.projection['receiptOrNull'] !== null) pendingOwnerCommand = null;
          }
          adoptSnapshot(candidate.value, false);
          return;
        }
        let snapshot: DecodeResult<ConfirmedProjectionSnapshot>;
        const reconnecting = stagedCapabilities !== null;
        if (reconnecting) {
          const capabilities = stagedCapabilities!;
          stagedCapabilities = null;
          snapshot = decodeReconnectSnapshot(message, capabilities, requestId);
          if (
            snapshot.ok &&
            resumedNetworkScopeId !== null &&
            !isNetworkApplicationForm(snapshot.value.formId) &&
            !isAdmissionOwnerForm(snapshot.value.formId)
          ) {
            const next = snapshot.value,
              p = next.projection,
              previous = lastSnapshot;
            // A retired scope resumes its audited exit, whose shell owns a separate vector.
            const ownClosedExit =
              pendingNetworkDraft === null &&
              pendingNetworkCommand === null &&
              pendingNetworkRefusal === null &&
              next.layers.length === 0 &&
              (next.formId === 'APP-002'
                ? p['deviceId'] === deviceId && previous?.formId !== 'CHR-027'
                : next.formId === 'CHR-040' &&
                  (previous === null ||
                    (previous.formId === 'CHR-027' &&
                      p['localCharacterUuid'] === previous.projection['localCharacterUuid'] &&
                      p['finalSnapshotVersion'] === previous.projection['finalSnapshotVersion'] &&
                      (p['provenance'] as JsonObject)['sourceChecksum'] ===
                        previous.projection['candidateSnapshotChecksum'])));
            if (!ownClosedExit)
              snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
          }
          if (
            snapshot.ok &&
            (isNetworkApplicationForm(snapshot.value.formId) ||
              isAdmissionOwnerForm(snapshot.value.formId)) &&
            (snapshot.value.projection['deviceId'] !== deviceId ||
              (networkScopeId !== null &&
                snapshot.value.projection['networkScopeId'] !== networkScopeId))
          )
            snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
          if (
            snapshot.ok &&
            isCampaignCreationForm(snapshot.value.formId) &&
            (snapshot.value.projection['gmLocalContextId'] !== gmLocalContextId ||
              snapshot.value.projection['hostDeviceId'] !== deviceId)
          )
            snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
          if (
            snapshot.ok &&
            (snapshot.value.formId === 'NET-017' || isAdmissionGmForm(snapshot.value.formId)) &&
            !ownGmQueue(snapshot.value)
          )
            snapshot = unrecognized('$.presentation.base.roleFilteredPayload.contextId', null);
          if (
            snapshot.ok &&
            gmQueueScope(snapshot.value) !== null &&
            lastSnapshot !== null &&
            gmQueueScope(lastSnapshot) !== null &&
            gmQueueScope(snapshot.value)?.campaignId === gmQueueScope(lastSnapshot)?.campaignId &&
            !gmQueueMonotonic(snapshot.value, lastSnapshot)
          )
            snapshot = unrecognized('$.revisions', null);
          if (
            snapshot.ok &&
            (pendingGmCommand !== null || pendingGmRefusal !== null || pendingGmDraft !== null)
          ) {
            const source = pendingGmCommand?.source ?? pendingGmRefusal?.source ?? lastSnapshot;
            if (
              source === null ||
              !ownGmQueue(snapshot.value) ||
              !gmQueueMonotonic(snapshot.value, source) ||
              (pendingGmCommand?.receipt !== null &&
                pendingGmCommand?.receipt !== undefined &&
                !gmDecisionDestination(
                  snapshot.value,
                  pendingGmCommand.source,
                  pendingGmCommand.receipt,
                  true,
                ))
            )
              snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
          } else if (snapshot.ok && pendingNetworkRefusal !== null) {
            if (
              !isNetworkApplicationForm(snapshot.value.formId) ||
              snapshot.value.projection['networkScopeId'] !==
                pendingNetworkRefusal.source.projection['networkScopeId'] ||
              snapshot.value.revisions.stateRevision <
                pendingNetworkRefusal.source.revisions.stateRevision ||
              snapshot.value.revisions.projectionRevision <
                pendingNetworkRefusal.source.revisions.projectionRevision ||
              snapshot.value.revisions.actorVisibilityRevision !==
                pendingNetworkRefusal.source.revisions.actorVisibilityRevision
            )
              snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
          } else if (
            snapshot.ok &&
            pendingNetworkCommand !== null &&
            absentNetworkCommandId === pendingNetworkCommand.request.commandId
          ) {
            const original = pendingNetworkCommand.source,
              next = snapshot.value;
            const oldPayload = { ...original.projection, contextId: next.projection['contextId']! };
            if (
              next.formId !== original.formId ||
              next.projection['pendingCommandIdOrNull'] !== null ||
              [
                'networkScopeId',
                'deviceId',
                'controllerSeat',
                'campaignIdOrNull',
                'sessionId',
                'requestId',
              ].some((key) => next.projection[key] !== original.projection[key]) ||
              next.revisions.stateRevision < original.revisions.stateRevision ||
              next.revisions.projectionRevision < original.revisions.projectionRevision ||
              next.revisions.actorVisibilityRevision !==
                original.revisions.actorVisibilityRevision ||
              (sameNetworkRevisions(next.revisions, original.revisions) &&
                !sameJson(oldPayload, next.projection))
            )
              snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
          } else if (snapshot.ok && pendingNetworkCommand !== null) {
            if (
              pendingNetworkCommand.receipt !== null
                ? !networkCommandDestinationMatches(
                    snapshot.value.formId,
                    snapshot.value.projection,
                    snapshot.value.revisions,
                    pendingNetworkCommand.receipt,
                    pendingNetworkCommand.request,
                    true,
                  )
                : pendingNetworkCommand.request.workflowCommandId === 'UI-CMD-DEVICE-REQUEST-CANCEL'
                  ? !pendingNetworkCancelSnapshotMatches(
                      snapshot.value,
                      pendingNetworkCommand.source,
                      pendingNetworkCommand.request,
                      true,
                    )
                  : snapshot.value.projection['pendingCommandIdOrNull'] !==
                    pendingNetworkCommand.request.commandId
            )
              snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
          } else if (snapshot.ok && pendingNetworkDraft !== null) {
            if (
              snapshot.value.projection['networkScopeId'] !==
              pendingNetworkDraft.request.scope.networkScopeId
            )
              snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
          } else if (snapshot.ok && pendingCampaignCreate !== null) {
            if (
              pendingCampaignCreate.receipt === null ||
              !gmCampaignCreateDestination(snapshot.value, pendingCampaignCreate.receipt)
            )
              snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
          } else if (snapshot.ok && pendingCampaignDraft !== null) {
            if (
              snapshot.value.projection['campaignDraftId'] !==
                pendingCampaignDraft.request.scope.campaignDraftId ||
              snapshot.value.projection['gmLocalContextId'] !==
                pendingCampaignDraft.request.scope.gmLocalContextId
            )
              snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
          } else if (snapshot.ok && pendingPostSave !== null) {
            if (
              pendingPostSave.receipt === null ||
              !postSaveDestinationMatches(snapshot.value, pendingPostSave.receipt)
            )
              snapshot = unrecognized(
                '$.presentation.base.roleFilteredPayload',
                snapshot.value.projection,
              );
          } else if (snapshot.ok && pendingCheckpoint !== null) {
            if (pendingCheckpoint.receipt === null) {
              snapshot = unrecognized('$.messageType', message.messageType);
            } else {
              snapshot = checkpointSnapshotMatchesReceipt(
                snapshot.value,
                pendingCheckpoint.receipt,
                pendingCheckpoint.sourceSnapshot,
              );
            }
          } else if (snapshot.ok && pendingSetDecision !== null) {
            if (pendingSetDecision.receipt === null) {
              snapshot = reconnectSnapshotMatchesUnjournaledCancel(
                snapshot.value,
                pendingSetDecision,
              );
            } else {
              snapshot = setDecisionSnapshotMatchesReceipt(
                snapshot.value,
                pendingSetDecision.receipt,
                pendingSetDecision.sourceSnapshot,
              );
            }
          } else if (snapshot.ok && pendingRollCommit !== null) {
            if (pendingRollCommit.receipt === null) {
              snapshot = unrecognized('$.messageType', message.messageType);
            } else {
              snapshot = rollCommitSnapshotMatchesReceipt(
                snapshot.value,
                pendingRollCommit.receipt,
                pendingRollCommit.sourceSnapshot,
              );
            }
          }
        } else if (pendingOwnerCommand !== null) {
          snapshot = decodeConfirmedSnapshot(
            message,
            pendingOwnerCommand.source.executableWorkflowCommandIds,
          );
          if (
            snapshot.ok &&
            (message.presentation.assignment.reason !== 'COMMAND_DESTINATION' ||
              message.presentation.assignment.correlationId !==
                pendingOwnerCommand.request.commandId ||
              !admissionOwnerDecisionDestination(
                snapshot.value,
                pendingOwnerCommand.request,
                pendingOwnerCommand.source,
                pendingOwnerCommand.receipt,
                false,
                lastSnapshot?.projection['contextId'] as string | undefined,
              ))
          )
            snapshot = unrecognized('$.presentation', null);
        } else if (pendingGmCommand !== null || pendingGmRefusal !== null) {
          const pending = pendingGmCommand ?? pendingGmRefusal!;
          snapshot = decodeConfirmedSnapshot(message, pending.source.executableWorkflowCommandIds);
          if (
            snapshot.ok &&
            (message.presentation.assignment.reason !== 'COMMAND_DESTINATION' ||
              message.presentation.assignment.correlationId !== pending.request.commandId ||
              !ownGmQueue(snapshot.value) ||
              !gmQueueMonotonic(snapshot.value, pending.source) ||
              (pendingGmCommand !== null &&
                (pendingGmCommand.receipt === null ||
                  !gmDecisionDestination(
                    snapshot.value,
                    pendingGmCommand.source,
                    pendingGmCommand.receipt,
                    pendingGmCommand.replay,
                  ))))
          )
            snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
        } else if (pendingNetworkRefusal !== null) {
          snapshot = decodeConfirmedSnapshot(
            message,
            pendingNetworkRefusal.source.executableWorkflowCommandIds,
          );
          if (
            snapshot.ok &&
            (message.presentation.assignment.reason !== 'COMMAND_DESTINATION' ||
              message.presentation.assignment.correlationId !==
                pendingNetworkRefusal.request.commandId ||
              !isNetworkApplicationForm(snapshot.value.formId) ||
              snapshot.value.projection['networkScopeId'] !==
                pendingNetworkRefusal.source.projection['networkScopeId'] ||
              snapshot.value.revisions.stateRevision <
                pendingNetworkRefusal.source.revisions.stateRevision ||
              snapshot.value.revisions.projectionRevision <
                pendingNetworkRefusal.source.revisions.projectionRevision ||
              snapshot.value.revisions.actorVisibilityRevision !==
                pendingNetworkRefusal.source.revisions.actorVisibilityRevision)
          )
            snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
        } else if (pendingNetworkCommand !== null && pendingNetworkCommand.receipt === null) {
          snapshot = decodeConfirmedSnapshot(
            message,
            pendingNetworkCommand.source.executableWorkflowCommandIds,
          );
          const original = pendingNetworkCommand.source;
          const unresolvedMatches =
            snapshot.ok &&
            (pendingNetworkCommand.request.workflowCommandId === 'UI-CMD-DEVICE-REQUEST-CANCEL'
              ? pendingNetworkCancelSnapshotMatches(
                  snapshot.value,
                  original,
                  pendingNetworkCommand.request,
                  false,
                )
              : snapshot.value.formId === 'NET-011' &&
                snapshot.value.projection['errorCode'] === 'UNCONFIRMED_OUTCOME' &&
                snapshot.value.projection['pendingCommandIdOrNull'] ===
                  pendingNetworkCommand.request.commandId &&
                snapshot.value.projection['networkScopeId'] ===
                  original.projection['networkScopeId'] &&
                snapshot.value.projection['controllerSeat'] ===
                  original.projection['controllerSeat'] &&
                snapshot.value.projection['draftRevision'] ===
                  original.projection['draftRevision'] &&
                snapshot.value.revisions.stateRevision === original.revisions.stateRevision + 1 &&
                snapshot.value.revisions.projectionRevision >=
                  original.revisions.projectionRevision + 1 &&
                snapshot.value.revisions.actorVisibilityRevision ===
                  original.revisions.actorVisibilityRevision);
          if (
            snapshot.ok &&
            (message.presentation.assignment.reason !== 'COMMAND_DESTINATION' ||
              message.presentation.assignment.correlationId !==
                pendingNetworkCommand.request.commandId ||
              !unresolvedMatches)
          )
            snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
        } else if (pendingNetworkCommand !== null && pendingNetworkCommand.receipt !== null) {
          snapshot = decodeConfirmedSnapshot(
            message,
            pendingNetworkCommand.source.executableWorkflowCommandIds,
          );
          if (
            snapshot.ok &&
            (message.presentation.assignment.reason !== 'COMMAND_DESTINATION' ||
              message.presentation.assignment.correlationId !==
                pendingNetworkCommand.request.commandId ||
              !networkCommandDestinationMatches(
                snapshot.value.formId,
                snapshot.value.projection,
                snapshot.value.revisions,
                pendingNetworkCommand.receipt,
                pendingNetworkCommand.request,
                pendingNetworkCommand.replay,
              ))
          )
            snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
        } else if (pendingCampaignCreate !== null && pendingCampaignCreate.receipt !== null) {
          snapshot = decodeConfirmedSnapshot(
            message,
            pendingCampaignCreate.source.executableWorkflowCommandIds,
          );
          if (
            snapshot.ok &&
            (message.presentation.assignment.reason !== 'COMMAND_DESTINATION' ||
              message.presentation.assignment.correlationId !==
                pendingCampaignCreate.request.commandId ||
              snapshot.value.projection['hostDeviceId'] !== deviceId ||
              !gmCampaignCreateDestination(snapshot.value, pendingCampaignCreate.receipt))
          )
            snapshot = unrecognized('$.presentation.base.roleFilteredPayload', null);
        } else if (pendingPostSave !== null && pendingPostSave.receipt !== null) {
          snapshot = decodeConfirmedSnapshot(
            message,
            pendingPostSave.source.executableWorkflowCommandIds,
          );
          if (
            snapshot.ok &&
            (message.presentation.assignment.reason !== 'COMMAND_DESTINATION' ||
              message.presentation.assignment.correlationId !== pendingPostSave.request.commandId ||
              !postSaveDestinationMatches(snapshot.value, pendingPostSave.receipt))
          )
            snapshot = unrecognized(
              '$.presentation.base.roleFilteredPayload',
              snapshot.value.projection,
            );
        } else if (
          pendingCheckpoint !== null &&
          pendingCheckpoint.receipt !== null &&
          lastSnapshot !== null
        ) {
          snapshot = decodeCommandDestinationSnapshot(
            message,
            pendingCheckpoint as PendingCheckpoint & {
              readonly receipt: CommandReceipt<CheckpointResult>;
            },
            lastSnapshot,
          );
        } else if (
          pendingSetDecision !== null &&
          pendingSetDecision.receipt !== null &&
          lastSnapshot !== null
        ) {
          snapshot = decodeSetDecisionDestinationSnapshot(
            message,
            pendingSetDecision as PendingSetDecision & {
              readonly receipt: CommandReceipt<SetDecisionResult>;
            },
            lastSnapshot,
          );
        } else if (
          pendingRollCommit !== null &&
          pendingRollCommit.receipt !== null &&
          lastSnapshot !== null
        ) {
          snapshot = decodeRollCommitDestinationSnapshot(
            message,
            pendingRollCommit as PendingRollCommit & {
              readonly receipt: CommandReceipt<RollCommitResult>;
            },
            lastSnapshot,
          );
        } else if (pendingAddressableRoute !== null && lastSnapshot !== null) {
          snapshot = decodeAddressableRouteSnapshot(message, pendingAddressableRoute, lastSnapshot);
          pendingAddressableRoute = null;
        } else {
          if (stagedCapabilities !== null || pendingFormAction === null) {
            failUnexpected(
              '$.messageType',
              message.messageType,
              'Form-action snapshot arrived without exactly one pending form action.',
            );
            return;
          }
          snapshot = decodeFormActionSnapshot(message, pendingFormAction, lastSnapshot!);
          pendingFormAction = null;
        }
        if (!snapshot.ok) {
          failProtocol(snapshot.refusal, 'Host sent an invalid projection snapshot.');
          return;
        }
        if (
          isCampaignCreationForm(snapshot.value.formId) &&
          snapshot.value.projection['hostDeviceId'] !== deviceId
        ) {
          failUnexpected(
            '$.presentation.base.roleFilteredPayload.hostDeviceId',
            null,
            'Campaign context belongs to another device.',
          );
          return;
        }
        if (
          (isNetworkApplicationForm(snapshot.value.formId) ||
            isAdmissionOwnerForm(snapshot.value.formId)) &&
          snapshot.value.projection['deviceId'] !== deviceId
        ) {
          failUnexpected(
            '$.presentation.base.roleFilteredPayload.deviceId',
            null,
            'Network view belongs to another installation.',
          );
          return;
        }
        if (
          gmQueueScope(snapshot.value) !== null &&
          gmQueueScope(snapshot.value) !== null &&
          !ownGmQueue(snapshot.value)
        ) {
          failUnexpected(
            '$.contextId',
            null,
            'GM queue changed owner or regressed its durable head.',
          );
          return;
        }
        if (pendingOwnerCommand !== null) {
          if (
            !admissionOwnerDecisionDestination(
              snapshot.value,
              pendingOwnerCommand.request,
              pendingOwnerCommand.source,
              pendingOwnerCommand.receipt,
              reconnecting,
              lastSnapshot?.projection['contextId'] as string | undefined,
            )
          ) {
            failUnexpected('$.presentation', null, 'Invalid recovered owner decision');
            return;
          }
          if (snapshot.value.projection['receiptOrNull'] !== null) pendingOwnerCommand = null;
        }
        if (pendingGmCommand?.receipt !== null && pendingGmCommand?.receipt !== undefined)
          pendingGmCommand = null;
        pendingGmRefusal = null;
        pendingNetworkRefusal = null;
        if (pendingNetworkCommand?.receipt !== null && pendingNetworkCommand?.receipt !== undefined)
          pendingNetworkCommand = null;
        if (expectingCapabilities) {
          lastSnapshot = snapshot.value;
          return;
        }
        adoptSnapshot(snapshot.value, reconnecting);
        return;
      }
      if (message.messageType === 'navigation.addressable-route.refusal') {
        if (
          lastSnapshot === null ||
          pendingAddressableRoute === null ||
          message.navigationRequestId !== pendingAddressableRoute.navigationRequestId
        ) {
          failUnexpected(
            '$.navigationRequestId',
            message.navigationRequestId,
            'Host addressable-route refusal does not match the pending request.',
          );
          return;
        }
        pendingAddressableRoute = null;
        onState({
          kind: 'navigation-refusal',
          refusal: message.refusal,
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            commandPending(),
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return;
      }
      if (message.messageType === 'navigation.form-action.refusal') {
        if (
          lastSnapshot === null ||
          pendingFormAction === null ||
          message.navigationRequestId !== pendingFormAction.navigationRequestId
        ) {
          failUnexpected(
            '$.navigationRequestId',
            message.navigationRequestId,
            'Host form-action refusal does not match the pending request.',
          );
          return;
        }
        pendingFormAction = null;
        onState({
          kind: 'navigation-refusal',
          refusal: message.refusal,
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            commandPending(),
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return;
      }
      failUnexpected(
        '$.messageType',
        (message as { readonly messageType: string }).messageType,
        'Host sent a wire v2 message that this reconnect did not request.',
      );
    };

    activeSocket.onerror = () => {
      if (disposed || terminal || socket !== activeSocket) return;
      socket = null;
      pendingFormAction = null;
      pendingAddressableRoute = null;
      stagedCapabilities = null;
      discardDisconnectedCampaignInput();
      discardDisconnectedNetworkInput();
      discardDisconnectedGmInput();
      onState({
        code: null,
        detail: 'WebSocket transport reported an error.',
        kind: 'disconnected',
        snapshot: visibleLast(),
      });
    };

    activeSocket.onclose = (event) => {
      if (disposed || terminal || socket !== activeSocket) return;
      socket = null;
      pendingFormAction = null;
      pendingAddressableRoute = null;
      stagedCapabilities = null;
      discardDisconnectedCampaignInput();
      discardDisconnectedNetworkInput();
      discardDisconnectedGmInput();
      const reason = event.reason.length === 0 ? 'no close reason' : event.reason;
      onState({
        code: event.code,
        detail: `WebSocket closed with code ${String(event.code)}: ${reason}.`,
        kind: 'disconnected',
        snapshot: visibleLast(),
      });
    };
  };

  const openTransport = (currentDeviceId: string): void => {
    const requestId = createRequestId('reconnect');
    const reconnect = {
      deviceId: currentDeviceId,
      knownRevisions: lastSnapshot?.revisions ?? NO_KNOWN_REVISIONS,
      messageType: 'session.reconnect',
      protocolVersion: WIRE_PROTOCOL_V2_VERSION,
      reconnectRequestId: requestId,
      supportedWorkflowCommandIds: [
        IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        SET_DECIDE_WORKFLOW_COMMAND_ID,
        ROLL_COMMIT_WORKFLOW_COMMAND_ID,
        WEAPON_PROFILE_SUBMIT_WORKFLOW,
        ...Object.values(POST_SAVE_COMMAND_IDS),
        ...NETWORK_WORKFLOW_COMMAND_IDS,
        'UI-CMD-ADMISSION-PLAYER-DECIDE',
      ],
      unacknowledgedCommandIds:
        pendingOwnerCommand !== null
          ? [pendingOwnerCommand.request.commandId]
          : pendingGmCommand !== null
            ? [pendingGmCommand.request.commandId]
            : pendingGmRefusal !== null
              ? [pendingGmRefusal.request.commandId]
              : pendingNetworkCommand !== null
                ? [pendingNetworkCommand.request.commandId]
                : pendingNetworkRefusal !== null
                  ? [pendingNetworkRefusal.request.commandId]
                  : pendingCampaignCreate !== null
                    ? [pendingCampaignCreate.request.commandId]
                    : pendingPostSave !== null
                      ? [pendingPostSave.request.commandId]
                      : pendingCheckpoint !== null
                        ? [pendingCheckpoint.request.commandId]
                        : pendingSetDecision !== null
                          ? [pendingSetDecision.request.commandId]
                          : pendingRollCommit !== null
                            ? [pendingRollCommit.request.commandId]
                            : [],
    } as const satisfies SessionReconnectV2Message;
    const gmResume: CampaignLocalContextResumeV3Message | null =
      gmLocalContextId === null
        ? null
        : {
            messageType: 'campaign.local-context.resume',
            protocolVersion: 3,
            gmLocalContextId,
            reconnectRequestId: requestId,
            knownRevisions: reconnect.knownRevisions,
            supportedWorkflowCommandIds: [
              CAMPAIGN_CREATE_COMMAND_ID,
              ...NETWORK_GM_REQUEST_REVIEW_WORKFLOW_IDS,
              ...ADMISSION_GM_WORKFLOW_IDS,
            ],
            unacknowledgedCommandIds: reconnect.unacknowledgedCommandIds,
          };
    const networkResume: NetworkLocalContextResumeV3Message | null =
      networkScopeId === null
        ? null
        : {
            messageType: 'network.local-context.resume',
            protocolVersion: 3,
            networkScopeId,
            reconnectRequestId: requestId,
            knownRevisions: reconnect.knownRevisions,
            supportedWorkflowCommandIds: NETWORK_LOCAL_SUPPORTED_WORKFLOW_IDS,
            unacknowledgedCommandIds: reconnect.unacknowledgedCommandIds,
          };
    const encoded =
      networkResume !== null
        ? encodeClientMessageV3(networkResume, WEB_PROTOCOL_VOCABULARY)
        : gmResume === null
          ? encodeClientMessageV2(reconnect, WEB_PROTOCOL_VOCABULARY)
          : encodeClientMessageV3(gmResume, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok)
      throw new Error(
        `session.reconnect failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
      );
    stagedCapabilities = null;
    attachSocket(
      new WebSocket(stateSocketUrl(window.location.href)),
      requestId,
      encoded.text,
      networkResume?.networkScopeId ?? null,
    );
  };

  const start = async (): Promise<void> => {
    const response = await fetch(deviceIdentityUrl(window.location.href), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      const source: unknown = await response.json();
      const endpointError = decodeDeviceIdentityError(source);
      if (!endpointError.ok) {
        throw new Error(
          `device identity request returned HTTP ${String(response.status)} with invalid diagnostic: ${JSON.stringify(endpointError.refusal)}`,
        );
      }
      throw new Error(
        `device identity request returned HTTP ${String(response.status)}: ${endpointError.value}`,
      );
    }
    const source: unknown = await response.json();
    const identity = decodeDeviceIdentity(source);
    if (!identity.ok) {
      throw new Error(`device identity response refused: ${JSON.stringify(identity.refusal)}`);
    }
    if (disposed) return;
    deviceId = identity.value;
    const ticket = readGmContextTicket();
    if (ticket !== null && UUID_PATTERN.test(ticket)) gmLocalContextId = ticket;
    else if (ticket !== null) storeGmContextTicket(null);
    const networkTicket = networkContextTicket();
    if (networkTicket !== null && DEVICE_ID_PATTERN.test(networkTicket))
      networkScopeId = networkTicket;
    else if (networkTicket !== null) networkContextTicket(null);
    if (gmLocalContextId !== null && networkScopeId !== null) {
      contextChoiceRequired = true;
      throw new Error(LOCAL_ROLE_CHOICE_DETAIL);
    }
    openTransport(deviceId);
  };

  void start().catch((error: unknown) => {
    if (disposed || terminal) return;
    terminal = true;
    onState({ kind: 'client-error', detail: diagnostic(error) });
    closeAfterTerminalState();
  });

  const notifyReady = (): void => {
    if (lastSnapshot === null) return;
    onState({
      kind: 'ready',
      snapshot: visibleSnapshotBase(
        lastSnapshot,
        identity,
        commandPending(),
        creationChoiceDraft,
        creationRollDraft,
        statAssignmentDraft,
        skillSelectionDraft,
      ),
    });
  };
  const sendManualRequest = (
    request: ManualAdvisorIwRequest | ManualAdvisorSkillRequest | ManualCompositionRequest,
  ): FormActionRequestResult => {
    if (lastSnapshot === null || socket === null || socket.readyState !== WebSocket.OPEN) {
      return { ok: false, detail: 'WebSocket is not open' };
    }
    const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok) {
      return {
        ok: false,
        detail: `manual symbiont command failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
      };
    }
    const roll = request.payload.variant === 'ADVISOR_IW';
    if (roll) {
      pendingRollCommit = {
        receipt: null,
        request: request as ManualAdvisorIwRequest,
        sourceProjection: lastSnapshot.projection as Chr041Projection,
        sourceSnapshot: lastSnapshot,
      };
    } else {
      pendingCheckpoint = {
        assignmentDraft: null,
        receipt: null,
        request: request as ManualCompositionRequest | ManualAdvisorSkillRequest,
        skillSelectionDraft: null,
        sourceSnapshot: lastSnapshot,
      };
    }
    try {
      socket.send(encoded.text);
    } catch (error: unknown) {
      if (roll) pendingRollCommit = null;
      else pendingCheckpoint = null;
      return {
        ok: false,
        detail: `manual symbiont command could not be sent: ${diagnostic(error)}`,
      };
    }
    notifyReady();
    return { ok: true };
  };

  const submitPostSave = (
    variant: PostSavePayload['variant'],
    values?: PostSaveMetadata,
  ): FormActionRequestResult => {
    if (disposed || terminal || lastSnapshot === null || !isPostSaveForm(lastSnapshot.formId))
      return { ok: false, detail: 'no active post-save source' };
    if (commandPending() || pendingFormAction !== null || pendingAddressableRoute !== null)
      return { ok: false, detail: 'another transition is pending' };
    if (socket === null || socket.readyState !== WebSocket.OPEN)
      return { ok: false, detail: 'WebSocket is not open' };
    if (
      !lastSnapshot.availableActionKeys.includes(POST_SAVE_ACTIONS[variant]) ||
      !lastSnapshot.executableWorkflowCommandIds.includes(POST_SAVE_COMMAND_IDS[variant])
    )
      return { ok: false, detail: 'post-save action is unavailable' };
    let request: PostSaveRequest;
    try {
      request = {
        messageType: 'command.request',
        protocolVersion: WIRE_PROTOCOL_VERSION,
        commandKind: 'workflow-command',
        commandId: createRequestId('command'),
        role: lastSnapshot.projection['ownerContext'] === 'GM_ARCHIVE_EXPORT' ? 'gm' : 'player',
        expectedRevisions: { ...lastSnapshot.revisions },
        workflowCommandId: POST_SAVE_COMMAND_IDS[variant],
        payload: postSavePayload(
          lastSnapshot.formId,
          lastSnapshot.projection as PostSaveProjection,
          variant,
          values,
        ),
      };
    } catch (error: unknown) {
      return { ok: false, detail: diagnostic(error) };
    }
    const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
    if (!encoded.ok) return { ok: false, detail: JSON.stringify(encoded.refusal) };
    pendingPostSave = { request, receipt: null, source: lastSnapshot };
    try {
      socket.send(encoded.text);
    } catch (error: unknown) {
      pendingPostSave = null;
      return { ok: false, detail: diagnostic(error) };
    }
    notifyReady();
    return { ok: true };
  };
  return {
    chooseLocalRole: (role) => {
      if (
        disposed ||
        !contextChoiceRequired ||
        deviceId === null ||
        (role !== 'player' && role !== 'gm')
      )
        return { ok: false, detail: 'local role choice is unavailable' };
      if (role === 'player') {
        gmLocalContextId = null;
        storeGmContextTicket(null);
      } else {
        networkScopeId = null;
        networkContextTicket(null);
      }
      contextChoiceRequired = false;
      terminal = false;
      openTransport(deviceId);
      return { ok: true };
    },
    replaceAdmissionDraft: (edit) => {
      if (
        disposed ||
        terminal ||
        stagedCapabilities !== null ||
        lastSnapshot === null ||
        socket?.readyState !== WebSocket.OPEN ||
        commandPending() ||
        pendingFormAction !== null ||
        pendingAddressableRoute !== null ||
        gmQueueScope(lastSnapshot)?.contextId !== gmLocalContextId
      )
        return { ok: false, detail: 'Admission input is unavailable' };
      let request: AdmissionGmClientV3Message;
      try {
        request = admissionBrowserDraft(lastSnapshot, edit, createRequestId('network-draft'));
      } catch {
        return { ok: false, detail: 'Admission fields are invalid' };
      }
      const encoded = encodeClientMessageV3(request, WEB_PROTOCOL_VOCABULARY);
      if (!encoded.ok) return { ok: false, detail: 'Admission input could not be encoded' };
      pendingAdmissionDraft = { request, source: lastSnapshot };
      try {
        socket.send(encoded.text);
      } catch {
        socket.close(1000, 'admission draft interrupted');
      }
      notifyReady();
      return { ok: true };
    },
    replaceNetworkGmRequestDraft: (values) => {
      if (
        disposed ||
        terminal ||
        lastSnapshot?.formId !== 'NET-017' ||
        socket?.readyState !== WebSocket.OPEN ||
        pendingGmCommand !== null ||
        pendingGmRefusal !== null ||
        pendingFormAction !== null ||
        pendingAddressableRoute !== null
      )
        return { ok: false, detail: 'GM queue input is unavailable' };
      const p = gmRequestProjection(lastSnapshot.projection);
      if (p === null || p.contextId !== gmLocalContextId)
        return { ok: false, detail: 'GM queue owner is not confirmed' };
      let checked: NetworkGmRequestDraftValues;
      try {
        checked = networkGmRequestDraftValues(values);
      } catch {
        return { ok: false, detail: 'GM draft values are invalid' };
      }
      if (
        checked.selectedRequestIdOrNull !== null &&
        !p.requests.some((r) => r.requestId === checked.selectedRequestIdOrNull)
      )
        return { ok: false, detail: 'GM request selection is stale' };
      const previous = gmEdit ?? networkGmRequestDraftFromProjection(p);
      if (checked.selectedRequestIdOrNull !== previous.selectedRequestIdOrNull)
        checked = { selectedRequestIdOrNull: checked.selectedRequestIdOrNull, decisionReason: '' };
      gmEdit = checked;
      gmEditVersion++;
      gmDraftRebaseAttempted = false;
      gmDraftRefusal = null;
      if (gmTimer !== null) clearTimeout(gmTimer);
      gmTimer = setTimeout(flushGmDraft, 250);
      publishGmDraft();
      notifyReady();
      return { ok: true };
    },
    replaceNetworkDraft: (edit) => {
      if (
        disposed ||
        terminal ||
        lastSnapshot === null ||
        !isNetworkEditableForm(lastSnapshot.formId) ||
        lastSnapshot.projection['networkScopeId'] !== networkScopeId ||
        socket?.readyState !== WebSocket.OPEN
      )
        return { ok: false, detail: 'no confirmed editable network scope' };
      if (
        pendingNetworkCommand !== null ||
        pendingNetworkRefusal !== null ||
        pendingFormAction !== null ||
        pendingAddressableRoute !== null ||
        lastSnapshot.projection['pendingCommandIdOrNull'] !== null
      )
        return { ok: false, detail: 'network delivery is awaiting confirmation' };
      if (
        !networkEditIsSendable(edit) ||
        edit.variant !==
          networkEditFromProjection(lastSnapshot.formId, lastSnapshot.projection)?.variant
      )
        return { ok: false, detail: 'network values do not belong to this form' };
      networkEdit = edit;
      networkEditVersion += 1;
      networkRefusal = null;
      if (networkTimer !== null) clearTimeout(networkTimer);
      networkTimer = setTimeout(flushNetworkDraft, 250);
      publishNetworkDraft();
      notifyReady();
      return { ok: true };
    },
    setNetworkInputPending: (pending) => {
      if (
        disposed ||
        terminal ||
        lastSnapshot === null ||
        !isNetworkEditableForm(lastSnapshot.formId)
      )
        return;
      networkInputPending = pending;
      publishNetworkDraft();
      notifyReady();
      if (!pending && networkEdit !== null && networkTimer === null) flushNetworkDraft();
    },
    replaceCampaignDraft: (edit) => {
      if (
        disposed ||
        terminal ||
        lastSnapshot === null ||
        !isCampaignEditableForm(lastSnapshot.formId) ||
        gmLocalContextId !== lastSnapshot.projection['gmLocalContextId'] ||
        socket?.readyState !== WebSocket.OPEN
      )
        return { ok: false, detail: 'no confirmed editable campaign draft' };
      if (
        pendingFormAction !== null ||
        pendingCampaignCreate !== null ||
        pendingAddressableRoute !== null
      )
        return { ok: false, detail: 'campaign navigation is awaiting confirmation' };
      const expectedVariant = (
        {
          'CMP-001': 'METADATA',
          'CMP-002': 'HOST',
          'CMP-003': 'SECRET',
          'CMP-004': 'MODE',
        } as const
      )[lastSnapshot.formId];
      if (edit.variant !== expectedVariant)
        return { ok: false, detail: 'campaign values do not belong to this form' };
      campaignEdit = edit;
      if (
        edit.variant === 'SECRET' &&
        edit.values.masterTransferPassword === '' &&
        edit.values.masterTransferPasswordConfirmation === '' &&
        pendingCampaignDraft === null
      )
        campaignEdit = null;
      campaignEditVersion += 1;
      campaignRefusal = null;
      if (campaignTimer !== null) clearTimeout(campaignTimer);
      campaignTimer = campaignEdit === null ? null : setTimeout(flushCampaignDraft, 250);
      publishCampaignDraft();
      notifyReady();
      return { ok: true };
    },
    setCampaignInputPending: (pending) => {
      if (
        disposed ||
        terminal ||
        lastSnapshot === null ||
        !isCampaignEditableForm(lastSnapshot.formId)
      )
        return;
      campaignInputPending = pending;
      publishCampaignDraft();
      notifyReady();
      if (!pending && campaignEdit !== null && campaignTimer === null) flushCampaignDraft();
    },
    submitPostSave,
    selectLibraryCharacter: (localCharacterId) => {
      if (
        disposed ||
        terminal ||
        lastSnapshot?.formId !== 'APP-004' ||
        commandPending() ||
        pendingFormAction !== null ||
        pendingAddressableRoute !== null
      )
        return { ok: false, detail: 'library selection is unavailable' };
      if (socket === null || socket.readyState !== WebSocket.OPEN)
        return { ok: false, detail: 'WebSocket is not open' };
      const entry = (lastSnapshot.projection as App004Projection).libraryEntries.find(
        (e) => e.localCharacterId === localCharacterId,
      );
      if (entry === undefined)
        return { ok: false, detail: 'character is absent from the confirmed library' };
      const request = {
        messageType: 'navigation.addressable-route',
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        routeTemplate: LIBRARY_ROUTES[entry.selectionFormId] as AddressableRouteTemplate,
        bindings: [{ parameterIndex: 0, source: 'client-selected', value: localCharacterId }],
        expectedProjectionRevision: lastSnapshot.revisions.projectionRevision,
        navigationRequestId: createRequestId('navigation'),
      } as const satisfies AddressableRouteIntentV2Message;
      const encoded = encodeClientMessageV2(request, WEB_PROTOCOL_VOCABULARY);
      if (!encoded.ok) return { ok: false, detail: JSON.stringify(encoded.refusal) };
      pendingAddressableRoute = request;
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        pendingAddressableRoute = null;
        return { ok: false, detail: diagnostic(error) };
      }
      return { ok: true };
    },
    disconnect: () => {
      if (disposed) return;
      disposed = true;
      clearGmDraft();
      pendingGmCommand = null;
      pendingGmRefusal = null;
      clearNetworkDraft();
      pendingNetworkCommand = null;
      pendingNetworkRefusal = null;
      clearCampaignDraft();
      pendingCampaignCreate = null;
      pendingFormAction = null;
      pendingAddressableRoute = null;
      stagedCapabilities = null;
      if (
        socket !== null &&
        (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
      ) {
        socket.close(1000, 'web client unmounted');
      }
    },
    toggleManualCompositionSpecies: (speciesKey, included) => {
      if (disposed || terminal || lastSnapshot === null) {
        return { ok: false, detail: 'projection connection is closed' };
      }
      if (commandPending() || pendingFormAction !== null || pendingAddressableRoute !== null) {
        return { ok: false, detail: 'manual composition is frozen while delivery is pending' };
      }
      try {
        manualCompositionDraft = toggleManualCompositionSpecies(
          lastSnapshot,
          manualCompositionDraft,
          speciesKey,
          included,
        );
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
      onManualCompositionDraft(manualCompositionDraft);
      notifyReady();
      return { ok: true };
    },
    replaceManualBindingSide: (side) => {
      if (disposed || terminal || lastSnapshot === null) {
        return { ok: false, detail: 'projection connection is closed' };
      }
      if (commandPending() || pendingFormAction !== null || pendingAddressableRoute !== null) {
        return { ok: false, detail: 'manual binding is frozen while delivery is pending' };
      }
      if (!lastSnapshot.availableActionKeys.includes(CHR_018_MANUAL_BINDING_ACTION_KEY)) {
        return { ok: false, detail: 'CHR-018 binding draft is unavailable' };
      }
      try {
        manualCompositionDraft = replaceManualBindingSide(
          lastSnapshot,
          manualCompositionDraft,
          side,
        );
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
      onManualCompositionDraft(manualCompositionDraft);
      notifyReady();
      return { ok: true };
    },
    requestSymbiontCard: (speciesKey) => {
      if (disposed || terminal || lastSnapshot === null) {
        return { ok: false, detail: 'projection connection is closed' };
      }
      if (
        lastSnapshot.formId !== 'CHR-017' ||
        (lastSnapshot.projection['correctionContext'] === undefined
          ? lastSnapshot.projection.symbiontAcquisitionModeOrNull
          : lastSnapshot.projection['creationMode']) !== 'MANUAL' ||
        !lastSnapshot.availableActionKeys.includes(CHR_017_MANUAL_CARD_ACTION_KEY)
      ) {
        return { ok: false, detail: 'no active CHR-017 manual catalog scope' };
      }
      if (
        !lastSnapshot.projection.eligibleSymbiontSpecies.some(
          (entry) => entry.speciesKey === speciesKey,
        )
      ) {
        return { ok: false, detail: 'speciesKey is absent from the confirmed manual catalog' };
      }
      if (pendingAddressableRoute !== null || pendingFormAction !== null || commandPending()) {
        return { ok: false, detail: 'another wizard transition is awaiting host delivery' };
      }
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return { ok: false, detail: 'WebSocket is not open' };
      }

      const request = {
        bindings: [{ parameterIndex: 1, source: 'client-selected', value: speciesKey }],
        expectedProjectionRevision: lastSnapshot.revisions.projectionRevision,
        messageType: 'navigation.addressable-route',
        navigationRequestId: createRequestId('navigation'),
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        routeTemplate: CHR_018_ROUTE,
      } as const satisfies AddressableRouteIntentV2Message;
      const encoded = encodeClientMessageV2(request, WEB_PROTOCOL_VOCABULARY);
      if (!encoded.ok) {
        return {
          ok: false,
          detail: `addressable route failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
        };
      }
      pendingAddressableRoute = request;
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        pendingAddressableRoute = null;
        return { ok: false, detail: `addressable route could not be sent: ${diagnostic(error)}` };
      }
      return { ok: true };
    },
    reconnect: () => {
      if (disposed || terminal || deviceId === null)
        return { ok: false, detail: 'projection connection cannot reconnect' };
      if (socket !== null) return { ok: false, detail: 'WebSocket is already open or connecting' };
      try {
        openTransport(deviceId);
        return { ok: true };
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
    },
    replaceConfirmationManualFace: (value) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-004' ||
        creationRollDraft?.formId !== 'CHR-004' ||
        lastSnapshot.projection['diceInputModeSnapshot'] !== 'MANUAL' ||
        lastSnapshot.projection['confirmationReceiptId'] !== null
      ) {
        return { ok: false, detail: 'no active CHR-004 MANUAL input scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'confirmation input is frozen while delivery is pending' };
      }
      if (value !== null && !Number.isFinite(value)) {
        return { ok: false, detail: 'confirmation face must be finite' };
      }
      creationRollDraft = { face: value, formId: 'CHR-004' };
      onCreationRollDraft(creationRollDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshotBase(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
    },
    replaceSetManualFace: (index, value) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-003' ||
        creationRollDraft?.formId !== 'CHR-003' ||
        lastSnapshot.projection['diceInputModeSnapshot'] !== 'MANUAL' ||
        lastSnapshot.projection['setRollReceiptId'] !== null
      ) {
        return { ok: false, detail: 'no active CHR-003 MANUAL input scope' };
      }
      if (!Number.isSafeInteger(index) || index < 0 || index >= 7) {
        return { ok: false, detail: 'CHR-003 input index must be in 0..6' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'set inputs are frozen while delivery is pending' };
      }
      if (value !== null && !Number.isFinite(value)) {
        return { ok: false, detail: 'set face must be finite' };
      }
      const faces = [...creationRollDraft.faces];
      faces[index] = value;
      creationRollDraft = { faces, formId: 'CHR-003' };
      onCreationRollDraft(creationRollDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshotBase(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
    },
    replaceIdentityDraft: (values) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return { ok: false, detail: 'WebSocket is not open' };
      }
      if (identity === null) return { ok: false, detail: 'no active CHR-001 draft scope' };
      if (commandPending())
        return { ok: false, detail: 'identity is frozen while checkpoint delivery is pending' };
      if ([values.age, values.massKg].some((value) => value !== null && !Number.isFinite(value)))
        return { ok: false, detail: 'identity draft numbers must be finite' };
      const request = identity.edit(values);
      onIdentityDraft(identity.state);
      if (lastSnapshot !== null)
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            commandPending(),
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
      try {
        return request === null || sendIdentity(request)
          ? { ok: true }
          : { ok: false, detail: 'WebSocket is not open' };
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
    },
    replaceStatAssignmentValue: (statCode, value) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-009' ||
        statAssignmentDraft === null ||
        !STAT_CODES.includes(statCode)
      ) {
        return { ok: false, detail: 'no active CHR-009 assignment scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'stat assignment is frozen while delivery is pending' };
      }
      if (value !== null && !Number.isFinite(value)) {
        return { ok: false, detail: 'stat assignment value must be finite' };
      }
      const valuesByStat = { ...statAssignmentDraft.valuesByStat, [statCode]: value };
      statAssignmentDraft = {
        ...statAssignmentDraft,
        validation: validateStatAssignmentDraft(statAssignmentDraft.assignmentMode, valuesByStat),
        valuesByStat,
      };
      onStatAssignmentDraft(statAssignmentDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshotBase(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
    },
    replaceRandomManualFace: (value) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-020' ||
        randomSymbiontDraft === null ||
        lastSnapshot.projection.diceInputModeSnapshot !== 'MANUAL' ||
        (lastSnapshot.projection.randomStatus !== 'NOT_STARTED' &&
          lastSnapshot.projection.randomStatus !== 'PENDING')
      ) {
        return { ok: false, detail: 'no active CHR-020 MANUAL input scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'random input is frozen while delivery is pending' };
      }
      try {
        randomSymbiontDraft = replaceRandomManualFace(randomSymbiontDraft, value);
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
      onRandomSymbiontDraft(randomSymbiontDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshotBase(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
    },
    replaceStartingWeaponSelection: (weaponTypeId, weaponVariant) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-022' ||
        startingWeaponDraft === null ||
        !lastSnapshot.availableActionKeys.includes(CHR_022_ROLL_ACTION_KEY)
      ) {
        return { ok: false, detail: 'no active editable CHR-022 weapon scope' };
      }
      if (commandPending())
        return { ok: false, detail: 'weapon selection is frozen while delivery is pending' };
      try {
        startingWeaponDraft = selectStartingWeapon(
          lastSnapshot.projection as Chr022Projection,
          weaponTypeId,
          weaponVariant,
        );
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
      onStartingWeaponDraft(startingWeaponDraft);
      notifyReady();
      return { ok: true };
    },
    addArmorBundleSelection: (itemId, bodyZoneOrNull) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-021' ||
        armorBundleDraft === null ||
        (lastSnapshot.projection as Chr021Projection).qualityRollReceiptIdOrNull !== null
      ) {
        return { ok: false, detail: 'no active editable CHR-021 armor scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'armor selection is frozen while delivery is pending' };
      }
      try {
        armorBundleDraft = addArmorPiece(
          armorBundleDraft,
          lastSnapshot.projection as Chr021Projection,
          itemId,
          bodyZoneOrNull,
        );
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
      onArmorBundleDraft(armorBundleDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshotBase(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
    },
    removeArmorBundleSelection: (bodyZoneOrNull) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-021' ||
        armorBundleDraft === null ||
        (lastSnapshot.projection as Chr021Projection).qualityRollReceiptIdOrNull !== null
      ) {
        return { ok: false, detail: 'no active editable CHR-021 armor scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'armor selection is frozen while delivery is pending' };
      }
      armorBundleDraft = removeArmorPiece(armorBundleDraft, bodyZoneOrNull);
      onArmorBundleDraft(armorBundleDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshotBase(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
    },
    replaceRandomSideSpecies: (species) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-020' ||
        randomSymbiontDraft === null ||
        !lastSnapshot.availableActionKeys.includes(CHR_020_SIDE_DRAFT_ACTION_KEY)
      ) {
        return { ok: false, detail: 'no active CHR-020 side selection scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'side selection is frozen while delivery is pending' };
      }
      if (
        species !== null &&
        !lastSnapshot.projection.drawnSpeciesAndBindings.some(
          (entry) => entry.speciesKey === species,
        )
      ) {
        return { ok: false, detail: 'side species is absent from the signed bindings' };
      }
      try {
        randomSymbiontDraft = replaceRandomSideSpecies(randomSymbiontDraft, species);
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
      onRandomSymbiontDraft(randomSymbiontDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshotBase(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
    },
    replaceAdvisorSkillCandidate: (skillId, targetBonus) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-041' ||
        lastSnapshot.projection.acknowledged ||
        advisorSkillSelectionDraft === null
      ) {
        return { ok: false, detail: 'no active CHR-041 skill selection scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'Advisor skill selection is frozen while delivery is pending' };
      }
      try {
        advisorSkillSelectionDraft = replaceAdvisorSkillCandidate(
          lastSnapshot.projection,
          advisorSkillSelectionDraft,
          skillId,
          targetBonus,
        );
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
      onAdvisorSkillSelectionDraft(advisorSkillSelectionDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshotBase(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
    },
    replaceSkillCardLevel: (targetBonus) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (lastSnapshot?.formId !== 'CHR-014' || skillCardDraft === null) {
        return { ok: false, detail: 'no active CHR-014 level selection scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'skill card is frozen while delivery is pending' };
      }
      const projection = lastSnapshot.projection as Chr014Projection;
      if (
        targetBonus !== null &&
        !projection.levelsAndBonuses.some((level) => level.targetBonus === targetBonus)
      ) {
        return { ok: false, detail: 'target bonus is absent from signed levelsAndBonuses' };
      }
      skillCardDraft = { formId: 'CHR-014', targetBonus };
      onSkillCardDraft(skillCardDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshotBase(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
    },
    replaceSkillSelectionCandidate: (skillId, targetBonus) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (
        lastSnapshot?.formId !== 'CHR-015' ||
        lastSnapshot.projection['selectionCheckpoint'] === 'EXACT' ||
        skillSelectionDraft === null
      ) {
        return { ok: false, detail: 'no active CHR-015 skill selection scope' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'skill selection is frozen while delivery is pending' };
      }
      if (skillId === null) {
        if (targetBonus !== null) {
          return { ok: false, detail: 'a target bonus requires an explicit skill candidate' };
        }
      } else {
        const projection = lastSnapshot.projection as Chr015Projection;
        const option = projection.skillOptions.find((candidate) => candidate.skillId === skillId);
        if (option === undefined) {
          return { ok: false, detail: 'skill candidate is absent from signed skillOptions' };
        }
        const selected = skillSelectionDraft.selectedSkills.find(
          (candidate) => candidate.skillId === skillId,
        );
        if (
          targetBonus !== null &&
          selected?.targetBonus !== targetBonus &&
          !option.levelOptions.some((level) => level.targetBonus === targetBonus)
        ) {
          return { ok: false, detail: 'target bonus is absent from signed levelOptions' };
        }
      }
      skillSelectionDraft = {
        ...skillSelectionDraft,
        candidateSkillIdOrNull: skillId,
        candidateTargetBonusOrNull: targetBonus,
      };
      onSkillSelectionDraft(skillSelectionDraft);
      onState({
        kind: 'ready',
        snapshot: visibleSnapshotBase(
          lastSnapshot,
          identity,
          false,
          creationChoiceDraft,
          creationRollDraft,
          statAssignmentDraft,
          skillSelectionDraft,
        ),
      });
      return { ok: true };
    },
    requestSkillCard: (skillId) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (lastSnapshot?.formId !== 'CHR-013') {
        return { ok: false, detail: 'no active CHR-013 skill catalog scope' };
      }
      if (pendingAddressableRoute !== null) {
        return { ok: false, detail: 'an addressable route is already awaiting host confirmation' };
      }
      if (pendingFormAction !== null || commandPending()) {
        return { ok: false, detail: 'another wizard transition is awaiting host delivery' };
      }
      if (!lastSnapshot.availableActionKeys.includes(CHR_013_CARD_ACTION_KEY)) {
        return { ok: false, detail: 'CHR-013 card navigation is not available' };
      }
      const projection = lastSnapshot.projection as Chr013Projection;
      if (
        !isPublicSkillId(skillId) ||
        !projection.skillCardSummaries.some((card) => card.skillId === skillId)
      ) {
        return { ok: false, detail: 'skillId is absent from the confirmed skill catalog' };
      }
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return { ok: false, detail: 'WebSocket is not open' };
      }
      const request = {
        bindings: [{ parameterIndex: 1, source: 'client-selected', value: skillId }],
        expectedProjectionRevision: lastSnapshot.revisions.projectionRevision,
        messageType: 'navigation.addressable-route',
        navigationRequestId: createRequestId('navigation'),
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        routeTemplate: CHR_014_ROUTE,
      } as const satisfies AddressableRouteIntentV2Message;
      const encoded = encodeClientMessageV2(request, WEB_PROTOCOL_VOCABULARY);
      if (!encoded.ok) {
        return {
          ok: false,
          detail: `addressable route failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
        };
      }
      pendingAddressableRoute = request;
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        pendingAddressableRoute = null;
        return { ok: false, detail: `addressable route could not be sent: ${diagnostic(error)}` };
      }
      return { ok: true };
    },
    submitCreationCorrection: (variant, values) => {
      if (
        disposed ||
        terminal ||
        lastSnapshot === null ||
        !Object.hasOwn(lastSnapshot.projection, 'correctionContext')
      )
        return { ok: false, detail: 'no active correction context' };
      if (commandPending() || pendingFormAction !== null || pendingAddressableRoute !== null)
        return { ok: false, detail: 'another transition is pending' };
      if (socket === null || socket.readyState !== WebSocket.OPEN)
        return { ok: false, detail: 'WebSocket is not open' };
      const p = lastSnapshot.projection as CreationCorrectionProjection;
      const [, action, workflow] = CORRECTION_COMMANDS[variant];
      if (
        !lastSnapshot.availableActionKeys.includes(action) ||
        !lastSnapshot.executableWorkflowCommandIds.includes(workflow)
      )
        return { ok: false, detail: 'correction action is unavailable' };
      let request: CreationFinalizationRequest;
      try {
        request = {
          messageType: 'command.request',
          protocolVersion: WIRE_PROTOCOL_VERSION,
          commandKind: 'workflow-command',
          commandId: createRequestId('command'),
          expectedRevisions: { ...lastSnapshot.revisions },
          role: 'player',
          workflowCommandId: workflow,
          payload: creationCorrectionPayload(p, variant, values),
        };
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
      const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
      if (!encoded.ok) return { ok: false, detail: JSON.stringify(encoded.refusal) };
      pendingCheckpoint = {
        assignmentDraft: null,
        receipt: null,
        request: request as unknown as PendingCheckpoint['request'],
        skillSelectionDraft: null,
        sourceSnapshot: lastSnapshot,
      };
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        pendingCheckpoint = null;
        return { ok: false, detail: diagnostic(error) };
      }
      notifyReady();
      return { ok: true };
    },
    rollFiveStartingPosition: (positions, positionId, manualFaceOrNull) => {
      if (
        disposed ||
        terminal ||
        socket === null ||
        socket.readyState !== WebSocket.OPEN ||
        pendingFormAction !== null ||
        pendingAddressableRoute !== null ||
        commandPending()
      )
        return { ok: false, detail: 'five positions delivery is unavailable' };
      if (
        lastSnapshot?.formId !== 'CHR-037' ||
        lastSnapshot.layers.length !== 0 ||
        !lastSnapshot.availableActionKeys.includes(CHR_037_ROLL_ACTION_KEY) ||
        !lastSnapshot.executableWorkflowCommandIds.includes(ROLL_COMMIT_WORKFLOW_COMMAND_ID)
      )
        return { ok: false, detail: 'no active five positions roll' };
      let request: FiveStartingPositionsRequest;
      try {
        request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: ROLL_COMMIT_WORKFLOW_COMMAND_ID,
          payload: fiveStartingPositionsRollPayload(
            lastSnapshot.projection as Chr037Projection,
            positions,
            positionId,
            manualFaceOrNull,
          ),
        };
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
      const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
      if (!encoded.ok)
        return {
          ok: false,
          detail: 'five positions failed checked encoding: ' + JSON.stringify(encoded.refusal),
        };
      pendingRollCommit = {
        receipt: null,
        request: request as unknown as PendingRollCommit['request'],
        sourceProjection: lastSnapshot.projection as unknown as Chr003Projection,
        sourceSnapshot: lastSnapshot,
      };
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        pendingRollCommit = null;
        return { ok: false, detail: diagnostic(error) };
      }
      notifyReady();
      return { ok: true };
    },
    submitWeaponProfile: (inputs) => {
      if (
        disposed ||
        terminal ||
        socket === null ||
        socket.readyState !== WebSocket.OPEN ||
        pendingFormAction !== null ||
        pendingAddressableRoute !== null ||
        commandPending()
      )
        return { ok: false, detail: 'weapon profile delivery is unavailable' };
      if (
        lastSnapshot?.formId !== 'CHR-023' ||
        lastSnapshot.layers.length !== 0 ||
        !lastSnapshot.availableActionKeys.includes(CHR_023_SUBMIT_ACTION_KEY) ||
        !lastSnapshot.executableWorkflowCommandIds.includes(WEAPON_PROFILE_SUBMIT_WORKFLOW)
      )
        return { ok: false, detail: 'no active editable weapon profile request' };
      let request: WeaponProfileRequest;
      try {
        request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: WEAPON_PROFILE_SUBMIT_WORKFLOW,
          payload: weaponProfileSubmitPayload(lastSnapshot.projection as Chr023Projection, inputs),
        };
      } catch (error: unknown) {
        return { ok: false, detail: diagnostic(error) };
      }
      const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
      if (!encoded.ok)
        return {
          ok: false,
          detail: `weapon profile failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
        };
      pendingCheckpoint = {
        assignmentDraft: null,
        receipt: null,
        request: request as unknown as PendingCheckpoint['request'],
        skillSelectionDraft: null,
        sourceSnapshot: lastSnapshot,
      };
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        pendingCheckpoint = null;
        return { ok: false, detail: diagnostic(error) };
      }
      notifyReady();
      return { ok: true };
    },
    requestFormAction: (actionKey, manualFacesOrNull) => {
      if (disposed || terminal) return { ok: false, detail: 'projection connection is closed' };
      if (lastSnapshot === null)
        return { ok: false, detail: 'no confirmed projection is available' };
      if (pendingAddressableRoute !== null) {
        return { ok: false, detail: 'an addressable route is already awaiting host confirmation' };
      }
      if (pendingFormAction !== null) {
        return { ok: false, detail: 'a form action is already awaiting host confirmation' };
      }
      if (commandPending()) {
        return { ok: false, detail: 'a wizard command is awaiting host delivery' };
      }
      const visible = visibleSnapshotBase(
        lastSnapshot,
        identity,
        false,
        creationChoiceDraft,
        creationRollDraft,
        statAssignmentDraft,
        skillSelectionDraft,
      );
      const activeForm = activePresentedForm(visible);
      if (!activeForm.availableActionKeys.includes(actionKey)) {
        return {
          ok: false,
          detail: `action ${JSON.stringify(actionKey)} is absent from the confirmed availableActionKeys`,
        };
      }
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return { ok: false, detail: 'WebSocket is not open' };
      }
      if (actionKey === 'NET-027::CTA::003' || actionKey === 'NET-027::CTA::004') {
        let request: AdmissionOwnerCommand;
        try {
          request = admissionOwnerBrowserCommand(
            lastSnapshot,
            actionKey,
            createRequestId('command'),
          );
        } catch {
          return { ok: false, detail: 'Whole-batch proposal is not confirmed' };
        }
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) return { ok: false, detail: 'Whole-batch intention failed encoding' };
        pendingOwnerCommand = { request, source: lastSnapshot, receipt: null };
        try {
          socket.send(encoded.text);
        } catch {
          socket.close(1000, 'admission decision interrupted');
        }
        notifyReady();
        return { ok: true };
      }
      if (
        ['NET-017::CTA::010', 'NET-021::CTA::005', 'NET-022::CTA::003', 'GM-019::CTA::005'].some(
          (key) => key === actionKey,
        )
      ) {
        let request: AdmissionBrowserRequest | null;
        try {
          request = admissionBrowserCommand(lastSnapshot, actionKey, createRequestId('command'));
        } catch {
          return { ok: false, detail: 'Admission input is not confirmed' };
        }
        if (request === null || gmQueueScope(lastSnapshot)?.contextId !== gmLocalContextId)
          return { ok: false, detail: 'Admission capability or owner is unavailable' };
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) return { ok: false, detail: 'Admission command could not be encoded' };
        pendingGmCommand = { request, receipt: null, source: lastSnapshot, replay: false };
        try {
          socket.send(encoded.text);
        } catch {
          socket.close(1000, 'admission delivery interrupted');
        }
        notifyReady();
        return { ok: true };
      }
      if (
        activeForm.formId === 'NET-017' &&
        (actionKey === 'NET-017::CTA::007' || actionKey === 'NET-017::CTA::008')
      ) {
        const p = gmRequestProjection(lastSnapshot.projection);
        if (p === null || p.contextId !== gmLocalContextId || gmEdit !== null)
          return { ok: false, detail: 'GM queue input is not confirmed' };
        const workflow =
          actionKey === 'NET-017::CTA::007'
            ? 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW'
            : 'UI-CMD-DEVICE-REQUEST-REJECT';
        if (!lastSnapshot.executableWorkflowCommandIds.includes(workflow))
          return { ok: false, detail: 'GM decision capability is unavailable' };
        const envelope = {
          protocolVersion: 1 as const,
          messageType: 'command.request' as const,
          commandKind: 'workflow-command' as const,
          role: 'gm' as const,
          commandId: createRequestId('command'),
          expectedRevisions: { ...lastSnapshot.revisions },
        };
        let request: NetworkGmDecisionRequest;
        if (workflow === 'UI-CMD-DEVICE-REQUEST-ACCEPT-TO-REVIEW') {
          const payload = networkGmAcceptToReviewPayload(p);
          if (payload === null) return { ok: false, detail: 'GM accept payload is unavailable' };
          request = { ...envelope, workflowCommandId: workflow, payload };
        } else {
          const payload = networkGmRejectRequestPayload(p);
          if (payload === null) return { ok: false, detail: 'GM reject payload is unavailable' };
          request = { ...envelope, workflowCommandId: workflow, payload };
        }
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) return { ok: false, detail: 'GM decision could not be encoded' };
        pendingGmCommand = { request, receipt: null, source: lastSnapshot, replay: false };
        try {
          socket.send(encoded.text);
        } catch {
          socket.close(1000, 'GM decision delivery interrupted');
        }
        publishGmDraft();
        notifyReady();
        return { ok: true };
      }

      if (isNetworkApplicationForm(activeForm.formId)) {
        if (actionKey === 'NET-002::CTA::005')
          return { ok: false, detail: 'QR input is a local action' };
        let networkRequest: NetworkWorkflowRequest | null = null;
        const envelope = {
          messageType: 'command.request',
          protocolVersion: WIRE_PROTOCOL_VERSION,
          commandKind: 'workflow-command',
          role: 'player',
          expectedRevisions: { ...lastSnapshot.revisions },
        } as const;
        if (actionKey === 'NET-002::CTA::003' || actionKey === 'NET-011::CTA::003') {
          const payload = networkOpenPayload(activeForm.formId, lastSnapshot.projection);
          if (
            payload === null ||
            !lastSnapshot.executableWorkflowCommandIds.includes('UI-CMD-CONNECTION-OPEN')
          )
            return { ok: false, detail: 'new network connection is unavailable' };
          const commandId = createNetworkCommandId();
          if (commandId === null) return { ok: false, detail: 'network command ID is unavailable' };
          networkRequest = {
            ...envelope,
            commandId,
            workflowCommandId: 'UI-CMD-CONNECTION-OPEN',
            payload,
          };
        } else if (actionKey === 'NET-004::CTA::002') {
          const payload = networkSubmitPayload(activeForm.formId, lastSnapshot.projection);
          if (
            payload === null ||
            !lastSnapshot.executableWorkflowCommandIds.includes('UI-CMD-DEVICE-REQUEST-SUBMIT')
          )
            return { ok: false, detail: 'network request submission is unavailable' };
          const commandId = createNetworkCommandId();
          if (commandId === null) return { ok: false, detail: 'network command ID is unavailable' };
          networkRequest = {
            ...envelope,
            commandId,
            workflowCommandId: 'UI-CMD-DEVICE-REQUEST-SUBMIT',
            payload,
          };
        } else if (actionKey === 'NET-005::CTA::001') {
          const payload = networkCancelPayload(
            activeForm.formId,
            lastSnapshot.projection,
            lastSnapshot.projection['cancelReason'] as string,
          );
          if (
            payload === null ||
            !lastSnapshot.executableWorkflowCommandIds.includes('UI-CMD-DEVICE-REQUEST-CANCEL')
          )
            return { ok: false, detail: 'network request cancellation is unavailable' };
          const commandId = createNetworkCommandId();
          if (commandId === null) return { ok: false, detail: 'network command ID is unavailable' };
          networkRequest = {
            ...envelope,
            commandId,
            workflowCommandId: 'UI-CMD-DEVICE-REQUEST-CANCEL',
            payload,
          };
        }
        if (networkRequest !== null) {
          const encoded = encodeClientMessage(networkRequest, WEB_PROTOCOL_VOCABULARY);
          if (!encoded.ok) return { ok: false, detail: 'network command could not be encoded' };
          pendingNetworkCommand = {
            request: networkRequest,
            receipt: null,
            replay: false,
            source: lastSnapshot,
          };
          try {
            socket.send(encoded.text);
          } catch {
            socket.close(1000, 'network command delivery interrupted');
          }
          notifyReady();
          return { ok: true };
        }
      }
      if (activeForm.formId === 'CMP-005' && actionKey === CAMPAIGN_CREATE_ACTION_KEY) {
        const p = lastSnapshot.projection;
        if (
          !lastSnapshot.executableWorkflowCommandIds.includes(CAMPAIGN_CREATE_COMMAND_ID) ||
          p['validationStatus'] !== 'READY_TO_CREATE' ||
          p['gmLocalContextId'] !== gmLocalContextId ||
          gmLocalContextId === null
        )
          return { ok: false, detail: 'campaign creation capability or preflight is unavailable' };
        const request: CampaignCreateRequest = {
          messageType: 'command.request',
          protocolVersion: WIRE_PROTOCOL_VERSION,
          commandKind: 'workflow-command',
          workflowCommandId: CAMPAIGN_CREATE_COMMAND_ID,
          commandId: createRequestId('command'),
          role: 'gm',
          expectedRevisions: { ...lastSnapshot.revisions },
          payload: {
            stage: 'CAMPAIGN_CREATE',
            sourceFormId: 'CMP-005',
            gmLocalContextId,
            campaignDraftId: p['campaignDraftId'] as string,
            draftRevision: p['draftRevision'] as number,
            preflightLeaseId: (p['hostBindPreflight'] as JsonObject)['leaseIdOrNull'] as string,
          },
        };
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) return { ok: false, detail: 'campaign creation could not be encoded' };
        pendingCampaignCreate = { request, receipt: null, source: lastSnapshot };
        try {
          socket.send(encoded.text);
        } catch {
          pendingCampaignCreate = null;
          return { ok: false, detail: 'campaign creation could not be sent' };
        }
        notifyReady();
        return { ok: true };
      }
      if (isPostSaveForm(activeForm.formId)) {
        const variant = (Object.keys(POST_SAVE_ACTIONS) as PostSavePayload['variant'][]).find(
          (v) => POST_SAVE_ACTIONS[v] === actionKey,
        );
        if (variant !== undefined)
          return variant === 'METADATA_PATCH'
            ? { ok: false, detail: 'metadata confirmation requires explicit field values' }
            : submitPostSave(variant);
      }
      if (activeForm.formId === 'CHR-025' && actionKey === 'CHR-025::CTA::008') {
        if (
          !lastSnapshot.executableWorkflowCommandIds.includes(
            IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
          )
        )
          return { ok: false, detail: 'checkpoint capability unavailable' };
        const p = lastSnapshot.projection;
        const request: PostSaveDraftRequest = {
          messageType: 'command.request',
          protocolVersion: WIRE_PROTOCOL_VERSION,
          commandKind: 'workflow-command',
          role: 'player',
          commandId: createRequestId('command'),
          expectedRevisions: { ...lastSnapshot.revisions },
          workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
          payload: {
            stage: 'LOCAL_CHARACTER_POST_SAVE',
            variant: 'SAVE_VALID_DRAFT',
            sourceFormId: 'CHR-025',
            characterDraftId: p['characterDraftId'] as string,
            wizardCheckpointId: p['wizardCheckpointId'] as string,
            draftRevision: p['draftRevision'] as number,
          },
        };
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) return { ok: false, detail: JSON.stringify(encoded.refusal) };
        pendingPostSave = { request, receipt: null, source: lastSnapshot };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingPostSave = null;
          return { ok: false, detail: diagnostic(error) };
        }
        notifyReady();
        return { ok: true };
      }
      if (Object.hasOwn(lastSnapshot.projection, 'correctionContext')) {
        const navigation: readonly ActionKey[] = [
          'CHR-009::CTA::003',
          'CHR-017::CTA::002',
          'CHR-017::CTA::003',
          'CHR-017::CTA::006',
          'CHR-018::CTA::002',
          'CHR-019::CTA::004',
          'CHR-019::CTA::002',
          'CHR-042::CTA::002',
        ];
        if (!navigation.includes(actionKey))
          return { ok: false, detail: 'correction command requires explicit corrected values' };
        const request = {
          actionKey,
          expectedProjectionRevision: lastSnapshot.revisions.projectionRevision,
          messageType: 'navigation.form-action',
          navigationRequestId: createRequestId('navigation'),
          protocolVersion: WIRE_PROTOCOL_V2_VERSION,
          sourceFormId: activeForm.formId,
        } as const satisfies FormActionIntentV2Message;
        const encoded = encodeClientMessageV2(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) return { ok: false, detail: JSON.stringify(encoded.refusal) };
        pendingFormAction = request;
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingFormAction = null;
          return { ok: false, detail: diagnostic(error) };
        }
        return { ok: true };
      }
      if (
        (activeForm.formId === 'CHR-032' &&
          actionKey === 'CHR-032::CTA::001' &&
          lastSnapshot.projection['summaryEntryMode'] === 'INITIAL') ||
        (activeForm.formId === 'CHR-025' && actionKey === 'CHR-025::CTA::007')
      ) {
        const final = activeForm.formId === 'CHR-025';
        let request: CreationFinalizationRequest;
        try {
          const common = {
            commandId: createRequestId('command'),
            expectedRevisions: { ...lastSnapshot.revisions },
            messageType: 'command.request' as const,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            role: 'player' as const,
          };
          request = final
            ? {
                ...common,
                commandKind: 'operation-command',
                transition: CREATION_FINAL_SAVE_TRANSITION,
                payload: creationFinalSavePayload(lastSnapshot.projection as Chr025Projection),
              }
            : {
                ...common,
                commandKind: 'workflow-command',
                workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
                payload: creationPropertySummaryPayload(
                  lastSnapshot.projection as Chr032Projection,
                ),
              };
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok)
          return {
            ok: false,
            detail: 'finalization encoding failed: ' + JSON.stringify(encoded.refusal),
          };
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request: request as unknown as PendingCheckpoint['request'],
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return { ok: false, detail: diagnostic(error) };
        }
        notifyReady();
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-037' &&
        lastSnapshot.formId === 'CHR-037' &&
        actionKey === CHR_037_CONFIRM_ACTION_KEY &&
        lastSnapshot.projection['summaryEntryMode'] !== 'RESUME'
      ) {
        let request: FiveStartingPositionsRequest;
        try {
          request = {
            commandId: createRequestId('command'),
            commandKind: 'workflow-command',
            expectedRevisions: { ...lastSnapshot.revisions },
            messageType: 'command.request',
            protocolVersion: WIRE_PROTOCOL_VERSION,
            role: 'player',
            workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
            payload: fiveStartingPositionsCheckpointPayload(
              lastSnapshot.projection as Chr037Projection,
            ),
          };
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok)
          return {
            ok: false,
            detail:
              'five positions checkpoint failed checked encoding: ' +
              JSON.stringify(encoded.refusal),
          };
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request: request as unknown as PendingCheckpoint['request'],
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return { ok: false, detail: diagnostic(error) };
        }
        notifyReady();
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-038' &&
        lastSnapshot.formId === 'CHR-038' &&
        (actionKey === CHR_038_ROLL_ACTION_KEY ||
          (actionKey === CHR_038_CONFIRM_ACTION_KEY &&
            (lastSnapshot.projection as Chr038Projection).positionsEntryMode !== 'RESUME'))
      ) {
        const roll = actionKey === CHR_038_ROLL_ACTION_KEY;
        let request: StartingMoneyRequest;
        try {
          const common = {
            commandId: createRequestId('command'),
            commandKind: 'workflow-command' as const,
            expectedRevisions: { ...lastSnapshot.revisions },
            messageType: 'command.request' as const,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            role: 'player' as const,
          };
          const projection = lastSnapshot.projection as Chr038Projection;
          request = roll
            ? {
                ...common,
                workflowCommandId: ROLL_COMMIT_WORKFLOW_COMMAND_ID,
                payload: startingMoneyRollPayload(
                  projection,
                  typeof manualFacesOrNull === 'number' ? manualFacesOrNull : null,
                ),
              }
            : {
                ...common,
                workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
                payload: startingMoneyCheckpointPayload(projection),
              };
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok)
          return {
            ok: false,
            detail: 'starting money failed checked encoding: ' + JSON.stringify(encoded.refusal),
          };
        if (roll)
          pendingRollCommit = {
            receipt: null,
            request: request as unknown as PendingRollCommit['request'],
            sourceProjection: lastSnapshot.projection as unknown as Chr003Projection,
            sourceSnapshot: lastSnapshot,
          };
        else
          pendingCheckpoint = {
            assignmentDraft: null,
            receipt: null,
            request: request as unknown as PendingCheckpoint['request'],
            skillSelectionDraft: null,
            sourceSnapshot: lastSnapshot,
          };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          if (roll) pendingRollCommit = null;
          else pendingCheckpoint = null;
          return { ok: false, detail: diagnostic(error) };
        }
        notifyReady();
        return { ok: true };
      }
      if (
        (activeForm.formId === 'CHR-024' &&
          lastSnapshot.formId === 'CHR-024' &&
          actionKey === CHR_024_ACKNOWLEDGE_ACTION_KEY &&
          (lastSnapshot.projection as Chr024Projection).acknowledgedReceiptIdOrNull === null) ||
        (activeForm.formId === 'CHR-022' &&
          lastSnapshot.formId === 'CHR-022' &&
          (actionKey === CHR_022_CONFIRM_ACTION_KEY ||
            actionKey === CHR_022_PURE_CONFIRM_ACTION_KEY) &&
          (lastSnapshot.projection as Chr022Projection).weaponProfileEntryMode === 'INITIAL')
      ) {
        let request: WeaponProfileRequest;
        try {
          const common = {
            commandId: createRequestId('command'),
            commandKind: 'workflow-command' as const,
            expectedRevisions: { ...lastSnapshot.revisions },
            messageType: 'command.request' as const,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            role: 'player' as const,
            workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
          };
          request =
            lastSnapshot.formId === 'CHR-024'
              ? {
                  ...common,
                  payload: weaponProfileAcknowledgePayload(
                    lastSnapshot.projection as Chr024Projection,
                  ),
                }
              : {
                  ...common,
                  payload: weaponProfileEntryPayload(lastSnapshot.projection as Chr022Projection),
                };
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok)
          return {
            ok: false,
            detail: `weapon profile failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request: request as unknown as PendingCheckpoint['request'],
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return { ok: false, detail: diagnostic(error) };
        }
        notifyReady();
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-018' &&
        lastSnapshot.formId === 'CHR-018' &&
        actionKey === CHR_018_MANUAL_ADD_ACTION_KEY
      ) {
        let payload: ManualCompositionRequest['payload'];
        try {
          payload = manualCompositionPayload(lastSnapshot, manualCompositionDraft);
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const request: ManualCompositionRequest = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        };
        return sendManualRequest(request);
      }
      if (activeForm.formId === 'CHR-014' && actionKey === CHR_014_ADD_ACTION_KEY) {
        let payload: SkillSelectionCheckpointPayload;
        try {
          payload = skillCardCheckpointPayload(lastSnapshot, skillCardDraft);
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        } as const satisfies SkillSelectionCheckpointRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `skill card checkpoint failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request,
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return {
            ok: false,
            detail: `skill card checkpoint could not be sent: ${diagnostic(error)}`,
          };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (activeForm.formId === 'CHR-015' && actionKey === CHR_015_TOGGLE_ACTION_KEY) {
        if (skillSelectionDraft === null) {
          return { ok: false, detail: 'no active CHR-015 skill selection draft' };
        }
        try {
          skillSelectionDraft = toggleSkillSelectionDraft(
            lastSnapshot.projection as Chr015Projection,
            skillSelectionDraft,
          );
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        onSkillSelectionDraft(skillSelectionDraft);
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            false,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-020' &&
        lastSnapshot.formId === 'CHR-020' &&
        actionKey === CHR_020_SIDE_DRAFT_ACTION_KEY
      ) {
        if (randomSymbiontDraft === null) {
          return { ok: false, detail: 'no active CHR-020 side draft' };
        }
        try {
          randomSymbiontDraft = toggleRandomSide(randomSymbiontDraft);
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        onRandomSymbiontDraft(randomSymbiontDraft);
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            false,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-020' &&
        lastSnapshot.formId === 'CHR-020' &&
        actionKey === CHR_020_MONSTER_DRAFT_ACTION_KEY
      ) {
        if (randomSymbiontDraft === null) {
          return { ok: false, detail: 'no active CHR-020 monster draft' };
        }
        randomSymbiontDraft = cycleRandomMonster(randomSymbiontDraft);
        onRandomSymbiontDraft(randomSymbiontDraft);
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            false,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-041' &&
        lastSnapshot.formId === 'CHR-041' &&
        actionKey === CHR_041_SKILL_DRAFT_ACTION_KEY
      ) {
        if (advisorSkillSelectionDraft === null) {
          return { ok: false, detail: 'no active CHR-041 skill selection draft' };
        }
        try {
          advisorSkillSelectionDraft = toggleAdvisorSkillSelection(
            lastSnapshot.projection,
            advisorSkillSelectionDraft,
          );
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        onAdvisorSkillSelectionDraft(advisorSkillSelectionDraft);
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            false,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      const selectedChoice = characterCreationSelectorChoice(lastSnapshot, actionKey);
      if (selectedChoice !== undefined && selectedChoice.formId === activeForm.formId) {
        creationChoiceDraft = selectedChoice;
        onCreationChoiceDraft(creationChoiceDraft);
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            false,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (activeForm.formId === 'CHR-001' && actionKey === IDENTITY_CHECKPOINT_ACTION_KEY) {
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload: identityCheckpointPayload(lastSnapshot),
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        } as const satisfies IdentityCheckpointRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `identity checkpoint failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request,
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return {
            ok: false,
            detail: `identity checkpoint could not be sent: ${diagnostic(error)}`,
          };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (activeForm.formId === 'CHR-009') {
        let payload: StatAssignmentCheckpointPayload;
        try {
          payload = statAssignmentCheckpointPayload(lastSnapshot, statAssignmentDraft);
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        } as const satisfies StatAssignmentCheckpointRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `stat assignment checkpoint failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingCheckpoint = {
          assignmentDraft: statAssignmentDraft,
          receipt: null,
          request,
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return {
            ok: false,
            detail: `stat assignment checkpoint could not be sent: ${diagnostic(error)}`,
          };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-041' &&
        lastSnapshot.formId === 'CHR-041' &&
        actionKey === CHR_041_CHECKPOINT_ACTION_KEY
      ) {
        if ('compositionDraftRevision' in lastSnapshot.projection) {
          let payload: ManualAdvisorSkillRequest['payload'];
          try {
            payload = manualAdvisorSkillPayload(lastSnapshot, advisorSkillSelectionDraft);
          } catch (error: unknown) {
            return { ok: false, detail: diagnostic(error) };
          }
          return sendManualRequest({
            commandId: createRequestId('command'),
            commandKind: 'workflow-command',
            expectedRevisions: { ...lastSnapshot.revisions },
            messageType: 'command.request',
            payload,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            role: 'player',
            workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
          });
        }
        let payload: SymbiontAdvisorCheckpointRequest['payload'];
        try {
          payload = advisorCheckpointPayload(lastSnapshot, advisorSkillSelectionDraft);
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        } as const satisfies SymbiontAdvisorCheckpointRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `Advisor checkpoint failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request,
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return {
            ok: false,
            detail: `Advisor checkpoint could not be sent: ${diagnostic(error)}`,
          };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (activeForm.formId === 'CHR-015' && actionKey === CHR_015_CONFIRM_ACTION_KEY) {
        let payload: SkillSelectionCheckpointPayload;
        try {
          payload = skillSelectionCheckpointPayload(lastSnapshot, skillSelectionDraft);
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        } as const satisfies SkillSelectionCheckpointRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `skill selection checkpoint failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request,
          skillSelectionDraft,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return {
            ok: false,
            detail: `skill selection checkpoint could not be sent: ${diagnostic(error)}`,
          };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (
        creationChoiceDraft !== null &&
        creationChoiceDraft.formId === activeForm.formId &&
        creationChoiceDraft.confirmationActionKey === actionKey
      ) {
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload: setDecisionPayload(lastSnapshot, creationChoiceDraft),
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: SET_DECIDE_WORKFLOW_COMMAND_ID,
        } as const satisfies SetDecisionRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `SET-DECIDE failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingSetDecision = {
          choice: creationChoiceDraft,
          receipt: null,
          request,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingSetDecision = null;
          return {
            ok: false,
            detail: `SET-DECIDE could not be sent: ${diagnostic(error)}`,
          };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      const statRollDecision = statRollSetDecisionPayload(lastSnapshot, actionKey);
      if (statRollDecision !== null) {
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload: statRollDecision,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: SET_DECIDE_WORKFLOW_COMMAND_ID,
        } as const satisfies SetDecisionRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `SET-DECIDE failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingSetDecision = {
          choice: null,
          receipt: null,
          request,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingSetDecision = null;
          return {
            ok: false,
            detail: `SET-DECIDE could not be sent: ${diagnostic(error)}`,
          };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-041' &&
        lastSnapshot.formId === 'CHR-041' &&
        actionKey === CHR_041_MANUAL_IW_ACTION_KEY
      ) {
        const input: unknown = manualFacesOrNull;
        if (input !== null && input !== undefined && !Array.isArray(input)) {
          return { ok: false, detail: 'CHR-041 I/W requires exactly two faces or AUTO' };
        }
        if (Array.isArray(input) && input.length !== 2) {
          return { ok: false, detail: 'CHR-041 I/W requires exactly two faces' };
        }
        const faces: readonly [number, number] | null = Array.isArray(input)
          ? [input[0], input[1]]
          : null;
        let payload: ManualAdvisorIwRequest['payload'];
        try {
          payload = manualAdvisorIwPayload(lastSnapshot, faces);
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        return sendManualRequest({
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload,
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: ROLL_COMMIT_WORKFLOW_COMMAND_ID,
        });
      }
      if (
        activeForm.formId === 'CHR-042' &&
        lastSnapshot.formId === 'CHR-042' &&
        actionKey === CHR_042_MANUAL_CONFIRM_ACTION_KEY
      ) {
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload: manualInteractionConfirmationPayload(lastSnapshot),
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: SET_DECIDE_WORKFLOW_COMMAND_ID,
        } as const satisfies ManualInteractionConfirmationRequest;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `interaction confirmation failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request,
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return {
            ok: false,
            detail: `interaction confirmation could not be sent: ${diagnostic(error)}`,
          };
        }
        notifyReady();
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-019' &&
        actionKey === CHR_019_ARMOR_ENTRY_ACTION_KEY &&
        (lastSnapshot.projection as unknown as { readonly armorBundleEntryMode?: string | null })
          .armorBundleEntryMode !== 'RESUME'
      ) {
        const projection = lastSnapshot.projection as unknown as {
          readonly characterDraftId: string;
          readonly wizardCheckpointId: string;
          readonly draftRevision: number;
        };
        const request = {
          commandId: createRequestId('command'),
          commandKind: 'workflow-command',
          expectedRevisions: { ...lastSnapshot.revisions },
          messageType: 'command.request',
          payload: {
            characterDraftId: projection.characterDraftId,
            draftRevision: projection.draftRevision,
            sourceFormId: 'CHR-019',
            stage: 'SYMBIONTS',
            variant: 'ARMOR_BUNDLE_ENTRY',
            wizardCheckpointId: projection.wizardCheckpointId,
          },
          protocolVersion: WIRE_PROTOCOL_VERSION,
          role: 'player',
          workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
        } as const;
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `armor bundle entry failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request: request as unknown as PendingCheckpoint['request'],
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return {
            ok: false,
            detail: `armor bundle entry could not be sent: ${diagnostic(error)}`,
          };
        }
        notifyReady();
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-021' &&
        lastSnapshot.formId === 'CHR-021' &&
        actionKey === CHR_021_ROLL_ACTION_KEY
      ) {
        const face = typeof manualFacesOrNull === 'number' ? manualFacesOrNull : null;
        let request: ArmorBundleQualityRollRequest;
        try {
          request = {
            commandId: createRequestId('command'),
            commandKind: 'workflow-command',
            expectedRevisions: { ...lastSnapshot.revisions },
            messageType: 'command.request',
            payload: armorBundleQualityPayload(
              lastSnapshot as unknown as ArmorBundleSnapshotSource,
              armorBundleDraft ??
                armorBundleDraftFromSnapshot(lastSnapshot.projection as Chr021Projection),
              face,
            ),
            protocolVersion: WIRE_PROTOCOL_VERSION,
            role: 'player',
            workflowCommandId: ROLL_COMMIT_WORKFLOW_COMMAND_ID,
          };
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `armor bundle roll failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingRollCommit = {
          receipt: null,
          request: request as unknown as PendingRollCommit['request'],
          sourceProjection: lastSnapshot.projection as unknown as Chr003Projection,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingRollCommit = null;
          return { ok: false, detail: `armor bundle roll could not be sent: ${diagnostic(error)}` };
        }
        notifyReady();
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-021' &&
        lastSnapshot.formId === 'CHR-021' &&
        actionKey === CHR_021_CONFIRM_ACTION_KEY &&
        (lastSnapshot.projection as Chr021Projection).weaponEntryMode !== 'RESUME'
      ) {
        let request: WorkflowCommandRequestMessage<
          'UI-CMD-CHAR-WIZARD-CHECKPOINT',
          ArmorBundleCheckpointRequest['payload'] | StartingWeaponEntryRequest['payload']
        >;
        try {
          request = {
            commandId: createRequestId('command'),
            commandKind: 'workflow-command',
            expectedRevisions: { ...lastSnapshot.revisions },
            messageType: 'command.request',
            payload:
              (lastSnapshot.projection as Chr021Projection).weaponEntryMode === 'INITIAL'
                ? startingWeaponEntryPayload(lastSnapshot.projection as Chr021Projection)
                : armorBundleCheckpointPayload(
                    lastSnapshot as unknown as ArmorBundleSnapshotSource,
                  ),
            protocolVersion: WIRE_PROTOCOL_VERSION,
            role: 'player',
            workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
          };
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `armor bundle checkpoint failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingCheckpoint = {
          assignmentDraft: null,
          receipt: null,
          request: request as unknown as PendingCheckpoint['request'],
          skillSelectionDraft: null,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingCheckpoint = null;
          return {
            ok: false,
            detail: `armor bundle checkpoint could not be sent: ${diagnostic(error)}`,
          };
        }
        notifyReady();
        return { ok: true };
      }
      if (
        activeForm.formId === 'CHR-022' &&
        lastSnapshot.formId === 'CHR-022' &&
        (lastSnapshot.projection as Chr022Projection).weaponProfileEntryMode !== 'RESUME' &&
        (actionKey === CHR_022_ROLL_ACTION_KEY ||
          actionKey === CHR_022_CONFIRM_ACTION_KEY ||
          actionKey === CHR_022_PURE_CONFIRM_ACTION_KEY)
      ) {
        const roll = actionKey === CHR_022_ROLL_ACTION_KEY;
        let request: StartingWeaponQualityRequest | StartingWeaponCheckpointRequest;
        try {
          const source = lastSnapshot as unknown as StartingWeaponSnapshotSource;
          const common = {
            commandId: createRequestId('command'),
            commandKind: 'workflow-command' as const,
            expectedRevisions: { ...lastSnapshot.revisions },
            messageType: 'command.request' as const,
            protocolVersion: WIRE_PROTOCOL_VERSION,
            role: 'player' as const,
          };
          request = roll
            ? {
                ...common,
                workflowCommandId: ROLL_COMMIT_WORKFLOW_COMMAND_ID,
                payload: startingWeaponQualityPayload(
                  source,
                  startingWeaponDraft ?? startingWeaponDraftFromSnapshot(source.projection),
                  typeof manualFacesOrNull === 'number' ? manualFacesOrNull : null,
                ),
              }
            : {
                ...common,
                workflowCommandId: IDENTITY_CHECKPOINT_WORKFLOW_COMMAND_ID,
                payload: startingWeaponCheckpointPayload(source),
              };
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok)
          return {
            ok: false,
            detail: `starting weapon failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        if (roll) {
          pendingRollCommit = {
            receipt: null,
            request: request as unknown as PendingRollCommit['request'],
            sourceProjection: lastSnapshot.projection as unknown as Chr003Projection,
            sourceSnapshot: lastSnapshot,
          };
        } else {
          pendingCheckpoint = {
            assignmentDraft: null,
            receipt: null,
            request: request as unknown as PendingCheckpoint['request'],
            skillSelectionDraft: null,
            sourceSnapshot: lastSnapshot,
          };
        }
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          if (roll) pendingRollCommit = null;
          else pendingCheckpoint = null;
          return { ok: false, detail: `starting weapon could not be sent: ${diagnostic(error)}` };
        }
        notifyReady();
        return { ok: true };
      }
      if (
        (activeForm.formId === 'CHR-003' && actionKey === CHR_003_ROLL_COMMIT_ACTION_KEY) ||
        (activeForm.formId === 'CHR-004' && actionKey === CHR_004_ROLL_COMMIT_ACTION_KEY) ||
        (activeForm.formId === 'CHR-020' && actionKey === CHR_020_ROLL_COMMIT_ACTION_KEY) ||
        (activeForm.formId === 'CHR-041' &&
          lastSnapshot.formId === 'CHR-041' &&
          actionKey === CHR_041_INTELLIGENCE_FLOOR_ACTION_KEY)
      ) {
        let request: RollCommitRequest;
        try {
          request = {
            commandId: createRequestId('command'),
            commandKind: 'workflow-command',
            expectedRevisions: { ...lastSnapshot.revisions },
            messageType: 'command.request',
            payload:
              activeForm.formId === 'CHR-020'
                ? randomRollCommitPayload(lastSnapshot, randomSymbiontDraft)
                : activeForm.formId === 'CHR-041'
                  ? advisorIntelligenceFloorRollPayload(
                      lastSnapshot,
                      typeof manualFacesOrNull === 'number' ? manualFacesOrNull : null,
                    )
                  : rollCommitPayload(lastSnapshot, creationRollDraft),
            protocolVersion: WIRE_PROTOCOL_VERSION,
            role: 'player',
            workflowCommandId: ROLL_COMMIT_WORKFLOW_COMMAND_ID,
          };
        } catch (error: unknown) {
          return { ok: false, detail: diagnostic(error) };
        }
        const encoded = encodeClientMessage(request, WEB_PROTOCOL_VOCABULARY);
        if (!encoded.ok) {
          return {
            ok: false,
            detail: `ROLL-COMMIT failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
          };
        }
        pendingRollCommit = {
          receipt: null,
          request,
          sourceProjection: lastSnapshot.projection as unknown as
            Chr003Projection | Chr004Projection | Chr020Projection | Chr041Projection,
          sourceSnapshot: lastSnapshot,
        };
        try {
          socket.send(encoded.text);
        } catch (error: unknown) {
          pendingRollCommit = null;
          return { ok: false, detail: `ROLL-COMMIT could not be sent: ${diagnostic(error)}` };
        }
        onState({
          kind: 'ready',
          snapshot: visibleSnapshotBase(
            lastSnapshot,
            identity,
            true,
            creationChoiceDraft,
            creationRollDraft,
            statAssignmentDraft,
            skillSelectionDraft,
          ),
        });
        return { ok: true };
      }
      const request = {
        actionKey,
        expectedProjectionRevision: lastSnapshot.revisions.projectionRevision,
        messageType: 'navigation.form-action',
        navigationRequestId: createRequestId('navigation'),
        protocolVersion: WIRE_PROTOCOL_V2_VERSION,
        sourceFormId: activeForm.formId,
      } as const satisfies FormActionIntentV2Message;
      const encoded = encodeClientMessageV2(request, WEB_PROTOCOL_VOCABULARY);
      if (!encoded.ok) {
        return {
          ok: false,
          detail: `form action failed checked encoding: ${JSON.stringify(encoded.refusal)}`,
        };
      }
      pendingFormAction = request;
      if (activeForm.formId === 'NET-017') {
        clearGmDraft();
        publishGmDraft();
      }
      if (isCampaignCreationForm(activeForm.formId)) {
        clearCampaignDraft();
        publishCampaignDraft();
      }
      if (isNetworkApplicationForm(activeForm.formId)) {
        clearNetworkDraft();
        publishNetworkDraft();
      }
      try {
        socket.send(encoded.text);
      } catch (error: unknown) {
        pendingFormAction = null;
        return { ok: false, detail: `form action could not be sent: ${diagnostic(error)}` };
      }
      return { ok: true };
    },
  };
}
