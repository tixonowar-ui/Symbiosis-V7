import type { FormActionIntentV2Message, ProjectionSnapshotV2Message } from '../shared/index.js';
import { CAMPAIGN_LOBBY_GM_NAV_TARGETS } from '../shared/campaign-lobby.js';
import { CAMPAIGN_LIFECYCLE_NAV_TARGETS } from '../shared/campaign-lifecycle.js';
import {
  ADMISSION_GM_NAV_TARGETS,
  admissionGmPresentationValue,
  isAdmissionGmForm,
} from '../shared/campaign-admission-presentation.js';

type Snapshot = ProjectionSnapshotV2Message;
type Action = FormActionIntentV2Message['actionKey'];
type Form = FormActionIntentV2Message['sourceFormId'];

// A hand-back may cross from the queue to the lobby. Use the same guarded
// presentation transitions as a GM and preserve their durable revisions.
const routes = {
  ...CAMPAIGN_LOBBY_GM_NAV_TARGETS,
  'CMP-007::CTA::003': CAMPAIGN_LIFECYCLE_NAV_TARGETS['CMP-007::CTA::003'],
  'CMP-008::CTA::009': CAMPAIGN_LIFECYCLE_NAV_TARGETS['CMP-008::CTA::009'],
  'CMP-006::CTA::002': 'NET-017',
  'NET-017::CTA::009': 'CMP-006',
} as const;

type ReturnAction = keyof typeof routes;

function pathToTarget(source: Form, target: string): ReturnAction[] {
  const queue: { form: Form; path: ReturnAction[] }[] = [{ form: source, path: [] }];
  const visited = new Set<Form>([source]);
  for (const item of queue) {
    if (item.form === target) return item.path;
    for (const [action, form] of Object.entries(routes)) {
      if (!visited.has(form) && action.startsWith(item.form + '::')) {
        visited.add(form);
        queue.push({ form, path: [...item.path, action as keyof typeof routes] });
      }
    }
  }
  throw new Error('GM hand-back destination is unavailable from the saved campaign form');
}

export async function restoreHostSeatGmForm(
  initial: Snapshot,
  origin: { readonly campaignId: string; readonly gmContextId: string },
  destination: string,
  correlationId: string,
  reason: Snapshot['presentation']['assignment']['reason'],
  navigate: (request: FormActionIntentV2Message) => Promise<Snapshot>,
): Promise<Snapshot> {
  let view = initial;
  const { campaignId, gmContextId } = origin;
  function checkCampaign() {
    const base = view.presentation.base;
    const payload = base.roleFilteredPayload;
    const contextId = payload[base.formId === 'CMP-006' ? 'gmLocalContextId' : 'contextId'];
    if (
      view.projectionRole !== 'gm' ||
      payload['campaignId'] !== campaignId ||
      contextId !== gmContextId
    )
      throw new Error('GM hand-back does not belong to the bound campaign');
  }
  async function transition(action: Action, expectedForm: Form) {
    const form = view.presentation.layers.at(-1) ?? view.presentation.base;
    if (
      form.roleFilteredPayload['campaignId'] !== campaignId ||
      !form.availableActionKeys.includes(action)
    )
      throw new Error('GM hand-back source no longer permits the saved destination');
    const navigationRequestId = correlationId + '/' + action;
    view = await navigate({
      messageType: 'navigation.form-action',
      protocolVersion: 2,
      sourceFormId: form.formId,
      actionKey: action,
      expectedProjectionRevision: view.revisions.projectionRevision,
      navigationRequestId,
    });
    checkCampaign();
    const { base, layers, assignment } = view.presentation;
    if (isAdmissionGmForm(base.formId)) admissionGmPresentationValue(base, layers, view.revisions);
    else if (layers.length > 0) throw new Error('GM hand-back reached an unexpected dialog');
    if (
      assignment.reason !== 'FORM_ACTION' ||
      assignment.correlationId !== navigationRequestId ||
      (layers.at(-1) ?? base).formId !== expectedForm
    )
      throw new Error('GM hand-back navigation did not confirm its expected destination');
  }
  checkCampaign();
  if (destination !== 'CURRENT' && isAdmissionGmForm(view.presentation.base.formId)) {
    const { base, layers } = view.presentation;
    admissionGmPresentationValue(base, layers, view.revisions);
    // After a committed rejection the cancel action disappears. Return through
    // its parent dialog without submitting or cancelling another decision.
    const dialog = layers.at(-1);
    if (dialog?.formId === 'NET-022' && !dialog.availableActionKeys.includes('NET-022::CTA::002')) {
      await transition('NET-022::CTA::001', ADMISSION_GM_NAV_TARGETS['NET-022::CTA::001']);
    }
    const active = view.presentation.layers.at(-1) ?? view.presentation.base;
    const exit = active.availableActionKeys.find(
      (key) =>
        Object.hasOwn(ADMISSION_GM_NAV_TARGETS, key) &&
        ADMISSION_GM_NAV_TARGETS[key as keyof typeof ADMISSION_GM_NAV_TARGETS] === 'NET-017',
    );
    if (!exit) throw new Error('The saved admission presentation has no confirmed queue return');
    await transition(exit, 'NET-017');
  }
  if (destination !== 'CURRENT') {
    if (view.presentation.layers.length !== 0)
      throw new Error('GM hand-back requires the current dialog to be resolved');
    for (const action of pathToTarget(view.presentation.base.formId, destination))
      await transition(action, routes[action]);
    if (view.presentation.base.formId !== destination)
      throw new Error('GM hand-back did not reach the requested destination');
  }
  return { ...view, presentation: { ...view.presentation, assignment: { correlationId, reason } } };
}
