import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnemyLibraryContent } from './enemy-library-content.js';
import { expect, it } from 'vitest';
import {
  enemyLibraryProjectionValue,
  type EnemyLibraryProjection,
  type EnemyLibrarySelectionRequest,
} from '@shared/enemy-library.js';
import type { JsonObject } from '@shared/wire-protocol.js';
import { presentedFormDefinition, availableFormActions } from '../index.js';
import { enemyLibrarySelectionConfirmed } from './enemy-library-confirmation.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = {
  origin: 'SYSTEM_DEFAULT_SENTIENT' as const,
  templateId: 'SENT-PURE-STK-001',
  catalogVersion: 'SYMBIOSIS_SENTIENT_DEFAULTS_V1.2',
  artAssetKey: 'ART-SENT-001',
  displayName: 'Сталкер с парой Кенси в полной коже',
  speciesIdOrNull: null,
  summary: 'Мобильный стрелок по нескольким целям',
};
const selected = {
  origin: entry.origin,
  templateId: entry.templateId,
  catalogVersion: entry.catalogVersion,
  artAssetKey: entry.artAssetKey,
};
function fixture(): EnemyLibraryProjection {
  return {
    kind: 'SYSTEM_LIBRARY',
    formId: 'ENM-001',
    contextId: id(1),
    campaignId: id(2),
    campaignStatus: 'PAUSED',
    activeTab: 'SENTIENT_ENEMIES',
    stateRevision: 5,
    projectionRevision: 10,
    actorVisibilityRevision: 0,
    defaultSentientCatalogVersion: entry.catalogVersion,
    catalogBaselineVersion: 'sha256:' + '0'.repeat(64),
    systemTemplates: [entry],
    canonicalTemplates: [],
    currentUserTemplates: [],
    selectedOrNull: selected,
    cardOrNull: null,
  };
}
const json = (value: unknown) => value as JsonObject;
const request = (): EnemyLibrarySelectionRequest => ({
  messageType: 'network.enemy-selection.replace',
  protocolVersion: 3,
  operationId: id(3),
  contextId: id(1),
  campaignId: id(2),
  sourceFormId: 'ENM-001',
  expectedRevisions: { stateRevision: 4, projectionRevision: 9, actorVisibilityRevision: 0 },
  activeTab: 'SENTIENT_ENEMIES',
  selectionOrNull: selected,
});
const assignment = { reason: 'FORM_ACTION', correlationId: id(3) };
const candidate = (p = fixture()) => ({
  formId: p.formId,
  projection: json(p),
  revisions: {
    stateRevision: p.stateRevision,
    projectionRevision: p.projectionRevision,
    actorVisibilityRevision: p.actorVisibilityRevision,
  },
});
it('registers real ENM-001/003 routes and the host-filtered source CTA vocabulary', () => {
  for (const form of ['ENM-001', 'ENM-003'] as const)
    expect(presentedFormDefinition(form)?.route).toBe(
      `/master/campaigns/:campaignId/enemy-catalog/${form.toLowerCase()}`,
    );
  expect(availableFormActions('ENM-003', ['ENM-003::CTA::001'])).toHaveLength(1);
  expect(
    availableFormActions('ENM-001', [
      'ENM-001::CTA::002',
      'ENM-001::CTA::004',
      'ENM-001::CTA::013',
    ]),
  ).toHaveLength(3);
});
it('confirms only an ACK-paired current source selection, including an unchanged explicit selection', () => {
  expect(enemyLibrarySelectionConfirmed(candidate(), assignment, request(), true)).toBe(true);
  expect(enemyLibrarySelectionConfirmed(candidate(), assignment, request(), false)).toBe(false);
  const noOp = fixture();
  expect(
    enemyLibrarySelectionConfirmed(
      candidate(noOp),
      assignment,
      { ...request(), expectedRevisions: candidate(noOp).revisions },
      true,
    ),
  ).toBe(true);
});
it.each([
  'form',
  'scope',
  'context',
  'correlation',
  'revision',
  'payloadRevision',
  'selected',
  'tab',
] as const)(
  'refuses a correlated but invalid %s host selection confirmation without throwing',
  (fault) => {
    const p = fixture(),
      frame = candidate(p),
      requestValue = request(),
      assigned = { ...assignment };
    if (fault === 'form') {
      frame.formId = 'GM-001' as never;
      frame.projection = {};
    }
    if (fault === 'scope') frame.projection = json({ ...p, campaignId: id(90) });
    if (fault === 'context') frame.projection = json({ ...p, contextId: id(90) });
    if (fault === 'correlation') assigned.correlationId = id(90);
    if (fault === 'revision') frame.revisions.projectionRevision = 8;
    if (fault === 'payloadRevision') frame.projection = json({ ...p, projectionRevision: 8 });
    if (fault === 'selected') frame.projection = json({ ...p, selectedOrNull: null });
    if (fault === 'tab') frame.projection = json({ ...p, activeTab: 'MONSTERS' });
    expect(() => enemyLibrarySelectionConfirmed(frame, assigned, requestValue, true)).not.toThrow();
    expect(enemyLibrarySelectionConfirmed(frame, assigned, requestValue, true)).toBe(false);
  },
);
it.each([
  'selected',
  'tab',
  'cardTemplate',
  'cardName',
  'pinnedCatalog',
  'artKey',
  'artMedia',
  'artHash',
  'artBytes',
  'placement',
  'structuredField',
  'unknownField',
] as const)(
  'refuses malformed source-bound card %s instead of rendering an alternate selection',
  (fault) => {
    const p = {
      ...fixture(),
      formId: 'ENM-003',
      systemTemplateArtAssetKey: entry.artAssetKey,
      cardOrNull: {
        template: { ...entry },
        payloadSha256: '0'.repeat(64),
        art: { mediaType: 'image/png', sha256: '0'.repeat(64), bytesBase64: 'cG5n' },
        fields: [],
      },
    };
    expect(() => enemyLibraryProjectionValue(p)).not.toThrow();
    if (fault === 'selected') p.selectedOrNull = null;
    if (fault === 'tab') p.activeTab = 'MONSTERS';
    if (fault === 'cardTemplate') p.cardOrNull.template.templateId = 'SENT-PURE-STK-002';
    if (fault === 'cardName') p.cardOrNull.template.displayName = 'foreign name';
    if (fault === 'pinnedCatalog') {
      p.systemTemplates = [{ ...entry, catalogVersion: 'foreign-version' }];
      p.selectedOrNull = { ...selected, catalogVersion: 'foreign-version' };
      p.cardOrNull.template.catalogVersion = 'foreign-version';
    }
    if (fault === 'artKey') p.systemTemplateArtAssetKey = 'foreign-art';
    if (fault === 'artMedia') p.cardOrNull.art.mediaType = 'image/jpeg';
    if (fault === 'artHash') p.cardOrNull.art.sha256 = 'corrupt';
    if (fault === 'artBytes') p.cardOrNull.art.bytesBase64 = 'invalid base64';
    if (fault === 'placement') Object.assign(p, { groupId: id(90) });
    if (fault === 'structuredField')
      Object.assign(p.cardOrNull, { fields: [{ label: 'baseStats', value: 'not-json' }] });
    if (fault === 'unknownField')
      Object.assign(p.cardOrNull, { fields: [{ label: 'unknown', value: 'anything' }] });
    expect(() => enemyLibraryProjectionValue(p)).toThrow();
  },
);

it('renders Russian sheet facts without a recursive technical payload dump', () => {
  const p = {
    ...fixture(),
    formId: 'ENM-003',
    systemTemplateArtAssetKey: entry.artAssetKey,
    cardOrNull: {
      template: entry,
      payloadSha256: '0'.repeat(64),
      art: { mediaType: 'image/png', sha256: '0'.repeat(64), bytesBase64: 'cG5n' },
      fields: [
        { label: 'race', value: 'PURE' },
        {
          label: 'skills',
          value: [
            { skillName: 'Стрельба', bonus: 4, slotCost: 4, note: 'Два Кенси; раздельные цели.' },
          ],
        },
        {
          label: 'symbionts',
          value: [{ speciesName: 'Ткач', targetLevel: 4, effectiveLevel: 4, maxOE: 200 }],
        },
        { label: 'items', value: [{ itemName: 'Кенси', equipSlot: 'HAND_L', currentAmmo: 8 }] },
      ],
    },
  };
  const html = renderToStaticMarkup(
    createElement(EnemyLibraryContent, { projection: json(p), onSelect() {} }),
  );
  for (const text of [
    'Чистые',
    'Стрельба',
    'бонус 4',
    'стоимость слотов 4',
    'Ткач',
    'максимум ОЭ 200',
    'Кенси',
    'Левая рука',
    'боезапас 8',
  ])
    expect(html).toContain(text);
  expect(html).not.toMatch(
    /skillName|slotCost|speciesName|targetLevel|equipSlot|HAND_L|deepCloneOnInstantiation|provenanceRuleId|initialRuntimeState/,
  );
});
