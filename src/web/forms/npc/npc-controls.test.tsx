import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import type { SkillKey } from '../../../domain/rules/skill-stage/catalog.js';
import type { StatCode } from '@generated/types/character.js';
import type { NpcDraftSection } from '../../../domain/rules/npc-authoring/types.js';
import type {
  NpcEditorStages,
  NpcTraumaEditorRow,
} from '../../../domain/rules/npc-authoring/staged-input.js';
import * as E from './npc-editor-fields.js';
import { NpcPoisonModeFields, NpcPoisonCoatingFields } from './npc-poison-fields.js';
import * as L from './npc-library-content.js';
import * as C from './npc-presentation.js';
import { decodeNpcProjection, npcControlPresentation, NpcArtSession } from './npc-application.js';
import { NPC_FULL_SHEET_FIELDS } from '@shared/npc-presentation.js';
import type {
  NpcArtEdit,
  NpcControlState,
  NpcIdentityPresentation,
  NpcSchemaPresentation,
  NpcStatPresentation,
  NpcSheetPresentation,
  NpcLibraryRow,
  NpcSymbiontsPresentation,
  NpcSymbiontChoice,
  NpcSkillsPresentation,
  NpcInventoryEditorRow,
  NpcInventoryChoices,
  NpcInventoryPresentation,
  NpcAvailableContinuation,
  NpcContinuationIntent,
  NpcItemProfileEditor,
  NpcInitialStatePresentation,
  NpcDiseasePreparationIntent,
  NpcWoundPreparationIntent,
  NpcWoundPreparation,
  NpcFinalReviewPresentation,
} from './npc-presentation.js';

const reactTestGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  ControlledReader.pending = [];
  vi.stubGlobal('FileReader', ControlledReader);
});
afterEach(async () => {
  await close();
  vi.unstubAllGlobals();
});
async function flush(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}
async function render<P extends object>(Component: ComponentType<P>, props: NoInfer<P>) {
  assert(root);
  await flush(() => {
    root?.render(createElement(Component, props));
  });
}
async function close() {
  if (root) {
    const active = root;
    root = null;
    await flush(() => active.unmount());
    container.remove();
  }
}
function present<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined);
  return value;
}
function last<T>(values: readonly T[]): T {
  return present(values.at(-1));
}
function first<T>(values: readonly T[]): T {
  return present(values[0]);
}
function entered<T>(value: NpcDraftSection<T>): Extract<NpcDraftSection<T>, { kind: 'ENTERED' }> {
  assert.equal(value.kind, 'ENTERED');
  assert(value.kind === 'ENTERED');
  return value;
}
function query<T extends Element = HTMLElement>(selector: string): T {
  return present(container.querySelector<T>(selector));
}
function labelled(label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const l = present([...container.querySelectorAll('label')].find((x) => x.textContent === label));
  const field = l.htmlFor
    ? document.getElementById(l.htmlFor)
    : l.querySelector('input,select,textarea');
  assert(
    field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement,
    'missing field ' + label,
  );
  return field;
}
async function change(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const descriptor: { readonly set?: (this: typeof el, value: string) => void } | undefined =
    Object.getOwnPropertyDescriptor(proto, 'value');
  const setter = present(descriptor?.set);
  await flush(() => {
    setter.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  });
}
async function click(label: string) {
  const b = present([...container.querySelectorAll('button')].find((x) => x.textContent === label));
  await flush(() => b.click());
}
const U = { kind: 'UNSET' } as const;
const V = <const T,>(value: T): Readonly<{ kind: 'ENTERED'; value: T }> => ({
  kind: 'ENTERED',
  value,
});
const state: NpcControlState = {
  readOnly: false,
  pending: false,
  dirty: false,
  refusalOrNull: null,
};
function idProps(presentation: NpcIdentityPresentation = identity) {
  const calls: NpcEditorStages['NPC-002'][] = [],
    arts: [string, NpcArtEdit][] = [],
    busy: [string, boolean][] = [];
  return {
    calls,
    arts,
    busy,
    props: {
      presentation,
      onChange: (v: NpcEditorStages['NPC-002']) => {
        calls.push(v);
      },
      onArtEdit: (...a: [string, NpcArtEdit]) => {
        arts.push(a);
      },
      onArtBusy: (...a: [string, boolean]) => {
        busy.push(a);
      },
    },
  };
}
class ControlledReader extends EventTarget {
  static pending: ControlledReader[] = [];
  result: ArrayBuffer | null = null;
  readAsArrayBuffer(_file: Blob) {
    ControlledReader.pending.push(this);
  }
  complete(bytes: readonly number[]) {
    this.result = Uint8Array.from(bytes).buffer;
    this.dispatchEvent(new Event('load'));
  }
  fail() {
    this.dispatchEvent(new Event('error'));
  }
}
async function file(name = 'art.png', size = 8) {
  const input = query<HTMLInputElement>('input[type=file]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([new Uint8Array(size)], name, { type: 'text/plain' })],
  });
  await flush(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  return last(ControlledReader.pending);
}
const PNG = [137, 80, 78, 71, 13, 10, 26, 10],
  JPG = [255, 216, 255, 0];
function expectBoundedArt(expectedSrc: string) {
  const img = query<HTMLImageElement>('img');
  assert.equal(img.getAttribute('src'), expectedSrc);
  assert.equal(img.style.maxWidth, '100%');
  assert.equal(img.style.maxHeight, '240px');
  assert.equal(img.style.height, 'auto');
  assert.equal(img.style.objectFit, 'contain');
}
async function controlled<P extends { readonly input: unknown }>(
  Component: ComponentType<{
    presentation: P;
    onChange: (input: P['input']) => void;
    onAdd: () => void;
    onContinuation: (intent: NpcContinuationIntent) => void;
  }>,
  p: NoInfer<P>,
) {
  const history: P['input'][] = [];
  const props = {
    presentation: p,
    onAdd: () => {},
    onContinuation: (_intent: NpcContinuationIntent) => {},
    onChange: (input: P['input']) => {
      history.push(input);
      props.presentation = { ...props.presentation, input };
    },
  };
  await render(Component, props);
  return { props, history, refresh: () => render(Component, props) };
}
function profile<K extends NpcItemProfileEditor['kind']>(
  value: NpcDraftSection<NpcItemProfileEditor>,
  kind: K,
): Extract<NpcItemProfileEditor, { kind: K }> {
  const p = entered(value).value;
  assert(p.kind === kind);
  return p as Extract<NpcItemProfileEditor, { kind: K }>;
}
function upload(edit: NpcArtEdit): Extract<NpcArtEdit, { kind: 'UPLOAD' }> {
  assert(edit.kind === 'UPLOAD');
  return edit;
}
const identity: NpcIdentityPresentation = {
  bindingKey: 'attempt-A/revision-0',
  input: {
    name: U,
    description: U,
    affiliation: U,
    campaignRole: U,
    sex: U,
    massKg: U,
    artAssetKeyOrNull: U,
  },
  errors: {},
  artOrNull: null,
  state,
};
const schema: NpcSchemaPresentation = {
  input: { raceCode: U, pureClassOrNull: U, anatomyProfileId: U },
  errors: {},
  races: [
    { value: 'PURE', label: 'Чистый' },
    { value: 'UNITED', label: 'Единый' },
    { value: 'FREE', label: 'Свободный' },
  ],
  classes: [
    { value: null, label: 'Без класса' },
    { value: 'SEEKER', label: 'Искатель' },
    { value: 'STALKER', label: 'Сталкер' },
    { value: 'SOLDIER', label: 'Солдат' },
  ],
  anatomies: [{ value: 'STANDARD_HUMANOID', label: 'Гуманоид' }],
  sexLabel: 'Не задано',
  massLabel: 'Не задано',
  massBoundsOrNull: null,
  registryVersion: 'source',
  validationSummary: [],
  state,
};
const codes: readonly StatCode[] = ['S', 'D', 'M', 'Z', 'I', 'W', 'C'];
const stats: NpcStatPresentation = {
  input: { S: U, D: U, M: U, Z: U, I: U, W: U, C: U },
  errors: {},
  labels: { S: 'S', D: 'D', M: 'M', Z: 'Z', I: 'I', W: 'W', C: 'C' },
  perStatMinMax: Object.fromEntries(codes.map((k) => [k, { minimum: 1, maximum: 20 }])) as Record<
    StatCode,
    { minimum: number; maximum: number }
  >,
  derivedPreview: [],
  state,
};
const sheet: NpcSheetPresentation = {
  npcUuid: 'npc-A',
  name: 'Тест',
  displayedVersion: 1,
  currentVersion: 2,
  historyRevision: 2,
  artOrNull: null,
  sections: {
    IDENTITY: [{ label: 'IDENTITY', value: 'host-IDENTITY' }],
    SCHEMA: [{ label: 'SCHEMA', value: 'host-SCHEMA' }],
    STATS: [{ label: 'STATS', value: 'host-STATS' }],
    SYMBIONTS: [{ label: 'SYMBIONTS', value: 'host-SYMBIONTS' }],
    SKILLS: [{ label: 'SKILLS', value: 'host-SKILLS' }],
    INVENTORY: [{ label: 'INVENTORY', value: 'host-INVENTORY' }],
    INITIAL_STATE: [{ label: 'INITIAL_STATE', value: 'host-INITIAL_STATE' }],
  },
  pinnedCombatReferences: [{ label: 'Сохранённый бой', version: 1 }],
};
const rows: readonly NpcLibraryRow[] = [
  {
    npcUuid: 'npc-A',
    name: 'Анна',
    currentVersion: 1,
    statusLabel: 'Сохранён',
    affiliation: 'Гильдия',
    campaignRole: 'Проводник',
    groupLabelOrNull: null,
    locationLabelOrNull: null,
    subLocationLabelOrNull: null,
    sceneLabelOrNull: null,
    artOrNull: null,
  },
  {
    npcUuid: 'npc-B',
    name: 'Борис',
    currentVersion: 2,
    statusLabel: 'Сохранён',
    affiliation: 'Стража',
    campaignRole: 'Начальник',
    groupLabelOrNull: 'Группа',
    locationLabelOrNull: 'Город',
    subLocationLabelOrNull: 'Площадь',
    sceneLabelOrNull: 'Сцена',
    artOrNull: null,
  },
];
const symRow: Extract<NpcEditorStages['NPC-013'], { kind: 'ENTERED' }>['value'][number] = {
  symbiontInstanceId: 'host-instance-A',
  input: {
    speciesKey: U,
    targetLevel: U,
    learnedNodeRefs: U,
    binding: U,
    currentOE: U,
  },
};
const owl: NpcSymbiontChoice = {
  value: 'OWL',
  label: 'Сова',
  levels: [
    { value: 1, label: 'Уровень1' },
    { value: 2, label: 'Уровень2' },
  ],
  nodes: [
    {
      value: 'owl-node-A',
      label: 'Узел совы',
      requirementLabel: 'Требование хоста',
      manualOnly: true,
    },
  ],
  bindings: [
    {
      key: 'owl-left',
      label: 'Левый глаз',
      value: { kind: 'OWL_EYE', side: 'LEFT' },
    },
    {
      key: 'owl-right',
      label: 'Правый глаз',
      value: { kind: 'OWL_EYE', side: 'RIGHT' },
    },
  ],
  artOrNull: null,
  treeArtOrNull: null,
};
const sym: NpcSymbiontsPresentation = {
  bindingKey: 'checked-composition-binding',
  input: V([symRow]),
  species: [owl],
  canAdd: true,
  errors: {},
  computedRows: {},
  compositionSummary: ['Проверка состава хостом ещё не завершена'],
  continuations: [],
  state,
};
const skillView: NpcSkillsPresentation = {
  input: U,
  skills: [
    {
      value: 'GROSS',
      label: 'Грубая сила',
      requirementLabel: 'Требование S от хоста',
    },
  ],
  pools: [
    { value: 'START', label: 'Стартовые слоты' },
    { value: 'TRAINING', label: 'Тренировочные слоты' },
  ],
  errors: [],
  fixedSkills: [{ label: 'Фиксированный навык', value: 'Источник и бонус хоста' }],
  poolUsage: [{ label: 'Стартовые слоты', value: '3 из 5' }],
  validationSummary: [],
  state,
};
const invRow = (): NpcInventoryEditorRow => ({
  itemInstanceId: 'host-item-A',
  input: {
    itemTypeId: U,
    quantity: U,
    equipped: U,
    equippedSlots: U,
    bodyZone: U,
    gripMode: U,
    currentAmmo: U,
    shieldCurrentHP: U,
    broken: U,
    sealed: U,
    linkedSetInstanceId: U,
    componentRole: U,
    qualityRoll: U,
    coatingInstanceIds: U,
    issueReason: U,
  },
  profile: U,
});
const itemChoices: NpcInventoryChoices = {
  itemTypes: [{ value: 'host-item-type', label: 'Предмет из каталога' }],
  profileKinds: [
    { value: 'CATALOG', label: 'Каталог' },
    { value: 'MASTER_WEAPON', label: 'Профиль оружия мастера' },
    { value: 'STRUCTURED_CUSTOM', label: 'Структурированный предмет' },
  ],
  equippedSlots: [
    { value: 'HAND_LEFT', label: 'Левая рука' },
    { value: 'HAND_RIGHT', label: 'Правая рука' },
  ],
  bodyZones: [
    { value: null, label: 'Без зоны' },
    { value: 'HEAD', label: 'Голова' },
  ],
  gripModes: [
    { value: null, label: 'Не применимо' },
    { value: 'ONE_HAND', label: 'Одна рука' },
    { value: 'TWO_HAND', label: 'Две руки' },
  ],
  linkedSets: [
    { value: null, label: 'Нет комплекта' },
    { value: 'host-set-A', label: 'Комплект хоста' },
  ],
  componentRoles: [
    { value: null, label: 'Нет роли' },
    { value: 'SHIELD', label: 'Щит' },
  ],
  coatings: [{ value: 'host-coating-A', label: 'Покрытие хоста' }],
  qualityRolls: [
    { value: null, label: 'Не применимо' },
    { value: 17, label: 'Подтверждённый результат17' },
  ],
  weaponVariants: [{ value: 'ONE_HAND', label: 'Одноручный' }],
  dicePatterns: [
    { value: 'R4', label: 'R4' },
    { value: 'R6+X', label: 'R6+X' },
  ],
  heldSizes: [
    { value: 'FITS_IN_FIST', label: 'Помещается в кулаке' },
    { value: 'LARGE', label: 'Крупный' },
    { value: 'UNKNOWN', label: 'Не установлено' },
  ],
  armorWeights: [
    { value: 'LIGHT', label: 'Лёгкая' },
    { value: 'OTHER', label: 'Другая' },
    { value: 'UNKNOWN', label: 'Не установлено' },
  ],
  flammabilities: [
    { value: 'COMBUSTIBLE', label: 'Горючий' },
    { value: 'NONCOMBUSTIBLE', label: 'Негорючий' },
    { value: 'UNKNOWN', label: 'Не установлено' },
  ],
  stats: codes.map((value) => ({ value, label: value })),
};
const inventory: NpcInventoryPresentation = {
  input: V([invRow()]),
  choices: itemChoices,
  canAdd: true,
  errors: {},
  previewRows: {},
  validationSummary: [],
  state,
};
describe('NPC015 campaign custom profile controls', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const customProfile = (): Extract<NpcItemProfileEditor, { kind: 'STRUCTURED_CUSTOM' }> => ({
    kind: 'STRUCTURED_CUSTOM',
    input: {
      name: U,
      description: U,
      massKg: U,
      heldSizeClass: U,
      armorWeightClass: U,
      flammability: U,
      isIgnitionSource: U,
      isFood: U,
      canReceivePoison: U,
      canReceiveFlammableCoating: U,
    },
    customBonusOrNull: U,
  });
  const customInventory = (): NpcInventoryPresentation => {
    const base = invRow();
    assert(!('itemTypeReference' in base));
    return {
      ...inventory,
      input: V([
        {
          ...base,
          itemInstanceId: id(40),
          input: { ...base.input, itemTypeId: V(null) },
          itemTypeReference: V({
            kind: 'CAMPAIGN_CUSTOM_PROFILE',
            profileId: id(41),
            profileVersionId: id(42),
            version: 1,
            reservationOperationId: id(43),
          }),
          profile: V(customProfile()),
          bonusContainerBinding: U,
          customProfileReason: U,
        },
      ]),
      customPreparationOrNull: {
        capabilityKey: 'custom-current',
        canAdd: true,
        modifierTargets: [],
        versionTargets: [],
        backpackChoices: [{ value: id(44), label: 'Рюкзак NPC' }],
        editableProfileVersionIds: [id(42)],
        errors: [],
        explanation: 'Данные профиля подтверждаются при сохранении НПС.',
      },
    };
  };
  it('reserves a custom item explicitly without creating identities or defaults in the browser', async () => {
    const calls: string[] = [],
      changes: unknown[] = [];
    await render(E.NpcInventoryFields, {
      presentation: customInventory(),
      onAdd: () => {},
      onChange: (v) => changes.push(v),
      onReserveCustomItem: (key) => calls.push(key),
    });
    assert.equal(calls.length, 0);
    assert.equal(changes.length, 0);
    assert.equal(labelled('Название custom-предмета 1').value, '');
    assert.equal(labelled('Рюкзак для бонуса предмета 1').value, '');
    assert(
      ![...container.querySelectorAll('label')].some(
        (label) => label.textContent === 'Тип предмета 1',
      ),
    );
    assert(
      ![...container.querySelectorAll('label')].some(
        (label) => label.textContent === 'Вид профиля предмета 1',
      ),
    );
    await click('Добавить произвольный предмет');
    assert.deepEqual(calls, ['custom-current']);
    assert.equal(changes.length, 0);
  });
  it('uses the actual offered backpack and keeps an explicit outside or no-bonus state', async () => {
    const q = await controlled(E.NpcInventoryFields, customInventory());
    await change(labelled('Название custom-предмета 1'), 'Памятный знак');
    await q.refresh();
    await change(labelled('Рюкзак для бонуса предмета 1'), '2');
    let row = first(entered(last(q.history)).value);
    assert('itemTypeReference' in row);
    assert.deepEqual(
      row.bonusContainerBinding,
      V({ kind: 'BACKPACK', backpackItemInstanceId: id(44) }),
    );
    const original = first(entered(customInventory().input).value);
    assert('itemTypeReference' in original);
    assert.deepEqual(row.itemTypeReference, original.itemTypeReference);
    assert.deepEqual(row.input.itemTypeId, V(null));
    await q.refresh();
    await change(labelled('Рюкзак для бонуса предмета 1'), '1');
    row = first(entered(last(q.history)).value);
    assert('itemTypeReference' in row);
    assert.deepEqual(row.bonusContainerBinding, V({ kind: 'OUTSIDE_BACKPACK' }));
    await q.refresh();
    await change(labelled('Рюкзак для бонуса предмета 1'), '0');
    row = first(entered(last(q.history)).value);
    assert('itemTypeReference' in row);
    assert.deepEqual(row.bonusContainerBinding, V({ kind: 'NOT_APPLICABLE' }));
    assert.deepEqual(profile(row.profile, 'STRUCTURED_CUSTOM').input.name, V('Памятный знак'));
    assert.deepEqual(profile(row.profile, 'STRUCTURED_CUSTOM').customBonusOrNull, U);
  });
  it('keeps committed profile fields read-only and requests the exact previous version', async () => {
    const p = customInventory(),
      custom = present(p.customPreparationOrNull),
      calls: unknown[] = [];
    await render(E.NpcInventoryFields, {
      presentation: {
        ...p,
        customPreparationOrNull: {
          ...custom,
          editableProfileVersionIds: [],
          versionTargets: [
            {
              itemInstanceId: id(40),
              profileId: id(41),
              profileVersionId: id(42),
              label: 'Сохранённый профиль',
            },
          ],
        },
      },
      onChange: () => {},
      onAdd: () => {},
      onReserveCustomProfileVersion: (...args) => calls.push(args),
    });
    assert(labelled('Название custom-предмета 1').matches(':disabled'));
    assert(!labelled('Рюкзак для бонуса предмета 1').matches(':disabled'));
    await click('Создать новую версию профиля предмета 1');
    assert.deepEqual(calls, [['custom-current', id(40), id(41), id(42)]]);
  });
  it('edits a separate canonical modifier without replacing the base profile or physical identity', async () => {
    const p = customInventory(),
      base = invRow();
    assert(!('itemTypeReference' in base));
    const input: NpcInventoryEditorRow = {
      ...base,
      itemInstanceId: id(40),
      input: { ...base.input, itemTypeId: V('ITM-WPN-001') },
      profile: V({ kind: 'CATALOG' }),
      customModifier: {
        reference: V({
          kind: 'CATALOG_CUSTOM_MODIFIER',
          profileId: id(41),
          profileVersionId: id(42),
          version: 1,
          reservationOperationId: id(43),
        }),
        profile: V(customProfile()),
        reason: U,
        bonusContainerBinding: U,
      },
    };
    const q = await controlled(E.NpcInventoryFields, { ...p, input: V([input]) });
    await change(labelled('Название custom-предмета 1'), 'Именной предмет');
    const changed = first(entered(last(q.history)).value);
    assert(!('itemTypeReference' in changed));
    assert.deepEqual(changed.profile, input.profile);
    assert.deepEqual(changed.input, input.input);
    assert.equal(changed.itemInstanceId, input.itemInstanceId);
    assert.deepEqual(
      profile(present(changed.customModifier).profile, 'STRUCTURED_CUSTOM').input.name,
      V('Именной предмет'),
    );
  });
  it.each([true, false])(
    'blocks reservation on an unsent or pending input: %s',
    async (pending) => {
      const calls: string[] = [];
      await render(E.NpcInventoryFields, {
        presentation: {
          ...customInventory(),
          state: { ...state, pending, localEditDirty: !pending },
        },
        onChange: () => {},
        onAdd: () => {},
        onReserveCustomItem: (key) => calls.push(key),
      });
      await click('Добавить произвольный предмет');
      assert.deepEqual(calls, []);
    },
  );
});

describe('source-backed NPC controls and draft intent', () => {
  it('NPC002 UNSET remains blank and sends no defaults', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    assert.equal(labelled('Имя НПС').value, '');
    assert.equal(labelled('Пол НПС').value, '');
    assert.equal(labelled('Масса НПС, кг').value, '');
    assert.equal(q.calls.length, 0);
    assert.equal(container.querySelectorAll('main,dialog').length, 0);
  });
  it('NPC002 entered name remains exact; other UNSET fields unchanged', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    await change(labelled('Имя НПС'), 'Анна');
    assert.deepEqual(last(q.calls).name, V('Анна'));
    assert.deepEqual(last(q.calls).massKg, U);
  });
  it('NPC002 text clearing remains ENTERED empty, not inferred absence', async () => {
    const q = idProps({
      ...identity,
      input: { ...identity.input, name: V('Тест') },
    });
    await render(E.NpcIdentityFields, q.props);
    await change(labelled('Имя НПС'), '');
    assert.deepEqual(last(q.calls).name, V(''));
  });
  it('NPC002 explicit no description enters null', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    await click('Без описания');
    assert.deepEqual(last(q.calls).description, V(null));
  });
  it('NPC002 sex selection and mass preserve entered values', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    await change(labelled('Пол НПС'), '1');
    assert.deepEqual(last(q.calls).sex, V('FEMALE'));
    await change(labelled('Масса НПС, кг'), '60.1');
    assert.deepEqual(last(q.calls).massKg, V(60.1));
  });
  it('NPC002 numeric clear produces UNSET, never zero', async () => {
    const q = idProps({
      ...identity,
      input: { ...identity.input, massKg: V(60.1) },
    });
    await render(E.NpcIdentityFields, q.props);
    await change(labelled('Масса НПС, кг'), '');
    assert.deepEqual(last(q.calls).massKg, U);
  });
  it('NPC002 errors are visible and linked to fields', async () => {
    const q = idProps({ ...identity, errors: { name: ['Имя обязательно'] } });
    await render(E.NpcIdentityFields, q.props);
    const input = labelled('Имя НПС');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert(
      present(input.getAttribute('aria-describedby'))
        .split(' ')
        .some((id) => present(document.getElementById(id)).textContent.includes('Имя обязательно')),
    );
    assert(query('[role=alert]'));
  });
  it('NPC002 actual art helper detects bytes, not MIME/name', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    const r = await file('wrong.txt');
    await flush(() => r.complete(PNG));
    assert.equal(q.arts.length, 1);
    assert.equal(first(q.arts)[0], identity.bindingKey);
    assert.equal(upload(first(q.arts)[1]).file.mediaType, 'image/png');
    assert.equal(upload(first(q.arts)[1]).file.bytesBase64, Buffer.from(PNG).toString('base64'));
    assert.deepEqual(last(q.busy), [identity.bindingKey, false]);
  });
  it('NPC002 newer file wins even when older FileReader finishes later', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    const firstReader = await file(),
      second = await file();
    await flush(() => second.complete(JPG));
    await flush(() => firstReader.complete(PNG));
    assert.equal(q.arts.length, 1);
    assert.equal(upload(first(q.arts)[1]).file.mediaType, 'image/jpeg');
  });
  it('NPC002 clear fences pending file without replacing saved art by default', async () => {
    const q = idProps({
      ...identity,
      artOrNull: {
        status: 'READY',
        assetKey: 'existing',
        checksum: 'a'.repeat(64),
        url: 'blob:existing',
      },
    });
    await render(E.NpcIdentityFields, q.props);
    assert.equal(query('img').getAttribute('src'), 'blob:existing');
    const r = await file();
    await click('Убрать изображение');
    await flush(() => r.complete(PNG));
    assert.deepEqual(q.arts, [[identity.bindingKey, { kind: 'CLEAR' }]]);
  });
  it('NPC002 restored binding fences old file result', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    const r = await file();
    await render(E.NpcIdentityFields, {
      ...q.props,
      presentation: { ...identity, bindingKey: 'attempt-B/revision-0' },
    });
    await flush(() => r.complete(PNG));
    assert.equal(q.arts.length, 0);
  });
  it('NPC002 loss of input access fences pending file and disables fields', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    const r = await file();
    await render(E.NpcIdentityFields, {
      ...q.props,
      presentation: { ...identity, state: { ...state, readOnly: true } },
    });
    await flush(() => r.complete(PNG));
    assert.equal(q.arts.length, 0);
    assert.equal(query<HTMLFieldSetElement>('fieldset').disabled, true);
  });
  it('NPC002 unmount fences pending read and releases busy', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    const r = await file();
    await close();
    await flush(() => r.complete(PNG));
    assert.equal(q.arts.length, 0);
    assert.deepEqual(last(q.busy), [identity.bindingKey, false]);
  });
  it('NPC002 unsupported bytes are visible and do not dispatch upload', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    const r = await file();
    await flush(() => r.complete([1, 2, 3]));
    assert.equal(q.arts.length, 0);
    assert(present(container.textContent).includes('Выберите файл PNG или JPEG'));
  });
  it('NPC002 failed reader is visible and releases busy', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    const r = await file();
    await flush(() => r.fail());
    assert.equal(q.arts.length, 0);
    assert(present(container.textContent).includes('Не удалось прочитать'));
    assert.deepEqual(last(q.busy), [identity.bindingKey, false]);
  });
  it('NPC011 choices do not assign defaults; explicit class null differs from UNSET', async () => {
    const calls: NpcEditorStages['NPC-011'][] = [];
    await render(E.NpcSchemaFields, {
      presentation: schema,
      onChange: (v) => calls.push(v),
    });
    assert.equal(calls.length, 0);
    assert.equal(labelled('Анатомия НПС').value, '');
    await change(labelled('Класс НПС'), '0');
    assert.deepEqual(last(calls).pureClassOrNull, V(null));
    await change(labelled('Класс НПС'), '');
    assert.deepEqual(last(calls).pureClassOrNull, U);
  });
  it('NPC011 changing race does not silently replace class or anatomy', async () => {
    const p: NpcSchemaPresentation = {
      ...schema,
      input: { ...schema.input, pureClassOrNull: V('SOLDIER') },
    };
    const calls: NpcEditorStages['NPC-011'][] = [];
    await render(E.NpcSchemaFields, {
      presentation: p,
      onChange: (v) => calls.push(v),
    });
    await change(labelled('Раса НПС'), '2');
    assert.deepEqual(last(calls).raceCode, V('FREE'));
    assert.deepEqual(last(calls).pureClassOrNull, V('SOLDIER'));
    assert.deepEqual(last(calls).anatomyProfileId, U);
  });
  it('NPC011 an entered unavailable option remains visibly entered, not UNSET', async () => {
    const calls: NpcEditorStages['NPC-011'][] = [];
    await render(E.NpcSchemaFields, {
      presentation: {
        ...schema,
        input: { ...schema.input, pureClassOrNull: V('SOLDIER') },
        classes: [{ value: null, label: 'Без класса' }],
      },
      onChange: (v) => calls.push(v),
    });
    assert.equal(labelled('Класс НПС').value, 'unavailable');
    assert(present(container.textContent).includes('Введённый выбор недоступен: SOLDIER'));
    assert.equal(calls.length, 0);
  });
  it('NPC012 exactly seven blank numeric controls; explicit no total cap', async () => {
    const calls: NpcEditorStages['NPC-012'][] = [];
    await render(E.NpcStatsFields, {
      presentation: stats,
      onChange: (v) => calls.push(v),
    });
    assert.equal(container.querySelectorAll('input[type=number]').length, 7);
    assert([...container.querySelectorAll('input')].every((x) => x.value === ''));
    assert(present(container.textContent).includes('Общего лимита суммы нет'));
    assert.equal(calls.length, 0);
  });
  it('NPC012 invalid entered number is not clipped to per-stat cap', async () => {
    const calls: NpcEditorStages['NPC-012'][] = [];
    await render(E.NpcStatsFields, {
      presentation: stats,
      onChange: (v) => calls.push(v),
    });
    await change(labelled('S'), '25');
    assert.deepEqual(last(calls).S, V(25));
    assert.equal((labelled('S') as HTMLInputElement).max, '20');
  });
  it('NPC012 host-derived preview is displayed without recomputing stats', async () => {
    await render(E.NpcStatsFields, {
      presentation: {
        ...stats,
        derivedPreview: [{ label: 'Итоговый S', value: '27' }],
      },
      onChange: () => assert.fail('unexpected edit'),
    });
    assert(present(container.textContent).includes('27'));
  });
  it('NPC001 search filters visible authorized rows; no invented group/location', async () => {
    await render(L.NpcLibraryContent, {
      presentation: { rows, selectedNpcUuidOrNull: 'npc-A', state },
      onSelect: () => {},
    });
    assert(present(container.textContent).includes('Не назначена'));
    await change(labelled('Поиск НПС'), 'Борис');
    assert.equal(container.querySelectorAll('article').length, 1);
    assert(present(container.textContent).includes('Выбранный НПС не показан'));
    assert(!present(container.textContent).includes('Анна'));
  });
  it('NPC001 selection emits exact UUID without navigating or manufacturing commands', async () => {
    const calls: (string | null)[] = [];
    await render(L.NpcLibraryContent, {
      presentation: { rows, selectedNpcUuidOrNull: null, state },
      onSelect: (v) => calls.push(v),
    });
    await flush(() =>
      present(container.querySelectorAll<HTMLInputElement>('input[type=radio]')[2]).click(),
    );
    assert.deepEqual(calls, ['npc-B']);
    assert.equal(container.querySelectorAll('button,a').length, 0);
  });
  it('NPC003 historical full sheet has all seven host sections and pinned old version', async () => {
    await render(L.NpcSheetContent, { sheet });
    for (const key of C.NPC_SHEET_SECTIONS)
      assert(present(container.textContent).includes('host-' + key));
    assert(present(container.textContent).includes('Историческая версия'));
    assert(present(container.textContent).includes('Сохранённый бой: версия 1'));
    assert.equal(container.querySelectorAll('input,button').length, 0);
  });
  it('NPC007 selecting history cannot restore/mutate; absent reason remains absent', async () => {
    const calls: number[] = [];
    await render(L.NpcHistoryContent, {
      presentation: {
        npcUuid: 'npc-A',
        currentVersion: 2,
        entries: [
          {
            version: 1,
            authorLabel: 'Мастер',
            timestampLabel: 'Время1',
            changeReasonOrNull: null,
          },
          {
            version: 2,
            authorLabel: 'Мастер',
            timestampLabel: 'Время2',
            changeReasonOrNull: 'Правка',
          },
        ],
        selectedVersionOrNull: 2,
        previewOrNull: sheet,
        state,
      },
      onSelect: (v) => calls.push(v),
    });
    await flush(() => query<HTMLInputElement>('input[type=radio]').click());
    assert.deepEqual(calls, [1]);
    assert.equal(container.querySelectorAll('button').length, 0);
    assert.equal((present(container.textContent).match(/Причина:/g) || []).length, 1);
  });
  it('NPC002 image display is bounded without changing the pinned URL', async () => {
    const q = idProps({
      ...identity,
      artOrNull: {
        status: 'READY',
        assetKey: 'kept',
        checksum: 'a'.repeat(64),
        url: 'blob:npc-version-1',
      },
    });
    await render(E.NpcIdentityFields, q.props);
    expectBoundedArt('blob:npc-version-1');
    assert.equal(q.arts.length, 0);
  });
  it('NPC001 portrait display is bounded without changing the authorized URL', async () => {
    await render(L.NpcLibraryContent, {
      presentation: {
        rows: [
          {
            ...first(rows),
            artOrNull: {
              status: 'READY',
              assetKey: 'kept',
              checksum: 'a'.repeat(64),
              url: 'blob:npc-list-1',
            },
          },
        ],
        selectedNpcUuidOrNull: null,
        state,
      },
      onSelect: () => assert.fail('unexpected selection'),
    });
    expectBoundedArt('blob:npc-list-1');
  });
  it('NPC003 historical image display is bounded without replacing its URL', async () => {
    await render(L.NpcSheetContent, {
      sheet: {
        ...sheet,
        artOrNull: {
          status: 'READY',
          assetKey: 'kept',
          checksum: 'a'.repeat(64),
          url: 'blob:npc-history-1',
        },
      },
    });
    expectBoundedArt('blob:npc-history-1');
  });
  it('Only source-scoped action keys; no future NPC005/archive/delete/placement', () => {
    assert.deepEqual(C.NPC_CONTROL_FORM_IDS, [
      'NPC-001',
      'NPC-002',
      'NPC-003',
      'NPC-007',
      'NPC-011',
      'NPC-012',
      'NPC-013',
      'NPC-014',
      'NPC-015',
      'NPC-016',
      'NPC-017',
    ]);
    const atlas = JSON.parse(
      readFileSync('artifacts/atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json', 'utf8'),
    ) as {
      forms: {
        id: string;
        actions: {
          ctaAvailabilityByAction: {
            actionKey: string;
            targetFormId: string;
          }[];
        };
      }[];
    };
    for (const [formId, keys] of Object.entries(C.NPC_CONTROL_ACTION_KEYS)) {
      const form = present(atlas.forms.find((f) => f.id === formId));
      for (const key of keys) {
        const action = form.actions.ctaAvailabilityByAction.find((a) => a.actionKey === key);
        assert(action);
        assert(
          !['NPC-004', 'NPC-005', 'NPC-006', 'NPC-008', 'NPC-009', 'NPC-010', 'CMB-063'].includes(
            action.targetFormId,
          ),
        );
      }
    }
  });
  it('NPC013 host allocates identity; Add dispatches intent without defaults', async () => {
    const edits: NpcEditorStages['NPC-013'][] = [],
      adds: boolean[] = [];
    await render(E.NpcSymbiontsFields, {
      presentation: { ...sym, input: U },
      onChange: (v) => edits.push(v),
      onAdd: () => adds.push(true),
      onContinuation: () => {},
    });
    await click('Добавить экземпляр симбионта');
    assert.equal(adds.length, 1);
    assert.equal(edits.length, 0);
    assert(!container.querySelector('input[type=number]'));
  });
  it('NPC013 new row leaves species/level/OE/binding unset', async () => {
    await render(E.NpcSymbiontsFields, {
      presentation: sym,
      onChange: () => assert.fail('default'),
      onAdd: () => {},
      onContinuation: () => {},
    });
    assert.equal(labelled('Вид симбионта 1').value, '');
    assert.equal(labelled('Целевой уровень симбионта 1').value, '');
    assert.equal(labelled('Текущие ОЭ симбионта 1').value, '');
    assert.equal(labelled('Привязка симбионта 1').value, '');
  });
  it('NPC013 species change does not choose nodes/level or refill OE', async () => {
    const q = await controlled(E.NpcSymbiontsFields, sym);
    await change(labelled('Вид симбионта 1'), '0');
    const row = first(entered(last(q.history)).value);
    assert.deepEqual(row.input.speciesKey, V('OWL'));
    assert.deepEqual(row.input.targetLevel, U);
    assert.deepEqual(row.input.learnedNodeRefs, U);
    assert.deepEqual(row.input.currentOE, U);
  });
  it('NPC013 source node and binding choices emit exact host values', async () => {
    const q = await controlled(E.NpcSymbiontsFields, {
      ...sym,
      input: V([{ ...symRow, input: { ...symRow.input, speciesKey: V('OWL') } }]),
    });
    assert(present(container.textContent).includes('без автоматического действия'));
    await flush(() => query('input[type=checkbox]').click());
    assert.deepEqual(
      first(entered(last(q.history)).value).input.learnedNodeRefs,
      V(['owl-node-A']),
    );
    await q.refresh();
    await change(labelled('Привязка симбионта 1'), '1');
    assert.deepEqual(
      first(entered(last(q.history)).value).input.binding,
      V({ kind: 'OWL_EYE', side: 'RIGHT' }),
    );
  });
  it('NPC013 OE finite input does not impose a new quantization rule', async () => {
    const q = await controlled(E.NpcSymbiontsFields, sym);
    assert.equal((labelled('Текущие ОЭ симбионта 1') as HTMLInputElement).step, 'any');
    await change(labelled('Текущие ОЭ симбионта 1'), '7.25');
    assert.deepEqual(first(entered(last(q.history)).value).input.currentOE, V(7.25));
  });
  it('NPC013 removal changes input only; empty composition is explicit ENTERED', async () => {
    const q = await controlled(E.NpcSymbiontsFields, sym);
    await click('Убрать экземпляр 1 из ввода');
    assert.deepEqual(last(q.history), V([]));
  });
  it('NPC013 absent continuation capability gives no confirm or roll button', async () => {
    await render(E.NpcSymbiontsFields, {
      presentation: sym,
      onChange: () => {},
      onAdd: () => {},
      onContinuation: () => assert.fail('unauthorized'),
    });
    assert(!present(container.textContent).includes('Бросить'));
    assert.equal(container.querySelectorAll('button').length, 4);
  });
  it('NPC013 manual source roll has no default and sends only bound face intent', async () => {
    const calls: NpcContinuationIntent[] = [],
      control: NpcAvailableContinuation = {
        capabilityKey: 'host-cap-A',
        kind: 'FREE_SLOT_ROLL',
        label: 'Подтвердить R6',
        explanation: 'Результат подтверждает хост',
        diceMode: 'MANUAL',
        rolls: [{ key: 'free', label: 'Грань R6', dieSides: 6, input: U, errors: [] }],
      };
    await render(E.NpcSymbiontsFields, {
      presentation: { ...sym, continuations: [control] },
      onChange: () => {},
      onAdd: () => {},
      onContinuation: (v) => calls.push(v),
    });
    assert.equal(labelled('Грань R6').value, '');
    await change(labelled('Грань R6'), '4');
    assert.deepEqual(calls[0], {
      kind: 'SET_MANUAL_FACE',
      capabilityKey: 'host-cap-A',
      rollKey: 'free',
      input: V(4),
    });
    await click('Подтвердить R6');
    assert.deepEqual(calls[1], { kind: 'SUBMIT', capabilityKey: 'host-cap-A' });
  });
  it('NPC013 auto source roll does not expose a client result input', async () => {
    const calls: NpcContinuationIntent[] = [];
    await render(E.NpcSymbiontsFields, {
      presentation: {
        ...sym,
        continuations: [
          {
            capabilityKey: 'host-auto',
            kind: 'ADVISER_IW_ROLLS',
            label: 'Подтвердить I/W',
            explanation: 'Режим AUTO хоста',
            diceMode: 'AUTO',
            rolls: [],
          },
        ],
      },
      onChange: () => {},
      onAdd: () => {},
      onContinuation: (v) => calls.push(v),
    });
    await click('Подтвердить I/W');
    assert.deepEqual(calls, [{ kind: 'SUBMIT', capabilityKey: 'host-auto' }]);
  });
  it('NPC013 adviser skill choices stay explicit and a stale capability draft is not reused', async () => {
    const calls: NpcContinuationIntent[] = [];
    const capability: NpcAvailableContinuation = {
      capabilityKey: 'adviser-choice-A',
      kind: 'ADVISER_SKILLS',
      label: 'Подтвердить навыки Советника',
      explanation: 'Требования и расход проверит хост',
      diceMode: 'NO_ROLL',
      rolls: [],
      skills: {
        choices: [
          {
            value: 'STEALTH',
            label: 'Скрытность',
            requirementLabel: 'Требования из источника',
            maxBonus: 3,
          },
        ],
        selected: [],
        errors: [],
      },
    };
    const props = {
      presentation: { ...sym, continuations: [capability] },
      onChange: () => {},
      onAdd: () => {},
      onContinuation: (intent: NpcContinuationIntent) => calls.push(intent),
    };
    await render(E.NpcSymbiontsFields, props);
    await click('Добавить выбор навыка Советника');
    assert.deepEqual(last(calls), {
      kind: 'SET_SELECTED_SKILLS',
      capabilityKey: capability.capabilityKey,
      input: [{ skillKey: U, targetBonus: U }],
    });
    await render(E.NpcSymbiontsFields, {
      ...props,
      continuationDraft: {
        capabilityKey: capability.capabilityKey,
        manualFaces: {},
        selectedSkills: [{ skillKey: U, targetBonus: U }],
      },
    });
    assert.equal(labelled('Бонус навыка Советника 1').value, '');
    await change(labelled('Навык Советника 1'), '0');
    assert.deepEqual(last(calls), {
      kind: 'SET_SELECTED_SKILLS',
      capabilityKey: capability.capabilityKey,
      input: [{ skillKey: V('STEALTH'), targetBonus: U }],
    });
    await render(E.NpcSymbiontsFields, {
      ...props,
      continuationDraft: {
        capabilityKey: 'expired-adviser-choice',
        manualFaces: {},
        selectedSkills: [{ skillKey: V('STEALTH'), targetBonus: V(3) }],
      },
    });
    assert.equal(
      [...container.querySelectorAll('label')].some(
        (label) => label.textContent === 'Бонус навыка Советника 1',
      ),
      false,
    );
    await click('Подтвердить навыки Советника');
    assert.deepEqual(last(calls), { kind: 'SUBMIT', capabilityKey: capability.capabilityKey });
  });
  it('NPC014 adding skill row sets no skill/bonus/pool defaults', async () => {
    const q = await controlled(E.NpcSkillsFields, skillView);
    await click('Добавить строку навыка');
    assert.deepEqual(last(q.history), V([{ skillKey: U, targetBonus: U, pool: U }]));
  });
  it('NPC014 separate skill/bonus/pool controls preserve values, fixed skills read only', async () => {
    const q = await controlled(E.NpcSkillsFields, {
      ...skillView,
      input: V([{ skillKey: U, targetBonus: U, pool: U }]),
    });
    assert(present(container.textContent).includes('Источник и бонус хоста'));
    await change(labelled('Навык 1'), '0');
    await q.refresh();
    assert(present(container.textContent).includes('Требование S от хоста'));
    await change(labelled('Целевой бонус навыка 1'), '4');
    await q.refresh();
    await change(labelled('Источник слотов навыка 1'), '1');
    assert.deepEqual(first(entered(last(q.history)).value), {
      skillKey: V('GROSS'),
      targetBonus: V(4),
      pool: V('TRAINING'),
    });
  });
  it('NPC014 clearing all selections does not grant free slots or success', async () => {
    const q = await controlled(E.NpcSkillsFields, skillView);
    await click('Без выбранных навыков');
    assert.deepEqual(last(q.history), V([]));
    assert(present(container.textContent).includes('3 из 5'));
  });
  it('NPC014 explicitly selects the Dolphin pool and retains its charge when host capacity becomes zero', async () => {
    const pools: NpcSkillsPresentation['pools'] = [
      ...skillView.pools,
      { value: 'SYM-166', label: 'Дельфин — отдельные слоты навыков' },
    ];
    const q = await controlled(E.NpcSkillsFields, {
      ...skillView,
      pools,
      input: V([{ skillKey: V('GROSS' as SkillKey), targetBonus: V(1), pool: U }]),
      poolUsage: [{ label: 'Дельфин', value: 'Вместимость 5; расход 0' }],
    });
    assert.equal(labelled('Источник слотов навыка 1').value, '');
    await change(labelled('Источник слотов навыка 1'), '2');
    const retained = last(q.history);
    assert.deepEqual(
      retained,
      V([{ skillKey: V('GROSS'), targetBonus: V(1), pool: V('SYM-166') }]),
    );
    const edits: NpcSkillsPresentation['input'][] = [];
    await render(E.NpcSkillsFields, {
      presentation: {
        ...skillView,
        pools,
        input: retained,
        poolUsage: [{ label: 'Дельфин', value: 'Вместимость 0; расход 1; превышение 1' }],
        validationSummary: ['Новые расходы недоступны. Ранее изученный навык сохранён.'],
      },
      onChange: (value) => edits.push(value),
    });
    assert.equal(labelled('Источник слотов навыка 1').value, '2');
    assert.equal(labelled('Целевой бонус навыка 1').value, '1');
    assert(present(container.textContent).includes('Вместимость 0; расход 1; превышение 1'));
    assert(present(container.textContent).includes('Ранее изученный навык сохранён.'));
    assert.deepEqual(edits, []);
  });
  it('NPC015 Add uses host allocation, never creates quantity/equipment/profile', async () => {
    const added: boolean[] = [],
      edits: NpcInventoryPresentation['input'][] = [];
    await render(E.NpcInventoryFields, {
      presentation: { ...inventory, input: U },
      onChange: (v) => edits.push(v),
      onAdd: () => added.push(true),
    });
    await click('Добавить экземпляр предмета');
    assert.deepEqual(added, [true]);
    assert.deepEqual(edits, []);
  });
  it('NPC015 restores an explicitly selected pending item and fences the old capability', async () => {
    const restores: [string, string][] = [];
    const preparation = {
      capabilityKey: 'history-capability-A',
      choices: [
        { value: 'published-item', label: 'Сохранённый предмет' },
        { value: 'pending-item', label: 'Подготовленный предмет — ещё не сохранён' },
      ],
      canSubmit: true,
      errors: [],
      explanation: 'Исходная подготовка сохраняет прежний экземпляр без создания нового.',
    };
    const props = {
      presentation: { ...inventory, restorePreparationOrNull: preparation },
      onChange: () => assert.fail('restore must await the host response'),
      onAdd: () => assert.fail('restore must not allocate another item'),
      onRestore: (capabilityKey: string, itemInstanceId: string) =>
        restores.push([capabilityKey, itemInstanceId]),
    };
    await render(E.NpcInventoryFields, props);
    assert(present(container.textContent).includes('Предметы из истории'));
    assert(present(container.textContent).includes('ещё не сохранён'));
    assert.equal(labelled('Предмет из истории').value, '');
    await click('Вернуть предмет из истории');
    assert.deepEqual(restores, []);
    await change(labelled('Предмет из истории'), '1');
    await click('Вернуть предмет из истории');
    assert.deepEqual(restores, [['history-capability-A', 'pending-item']]);
    await render(E.NpcInventoryFields, {
      ...props,
      presentation: {
        ...inventory,
        restorePreparationOrNull: { ...preparation, capabilityKey: 'history-capability-B' },
      },
    });
    assert.equal(labelled('Предмет из истории').value, '');
    await click('Вернуть предмет из истории');
    assert.deepEqual(restores, [['history-capability-A', 'pending-item']]);
    await change(labelled('Предмет из истории'), '1');
    await click('Вернуть предмет из истории');
    assert.deepEqual(restores, [
      ['history-capability-A', 'pending-item'],
      ['history-capability-B', 'pending-item'],
    ]);
  });
  it('NPC015 blank typed row has no hidden scalar defaults', async () => {
    await render(E.NpcInventoryFields, {
      presentation: inventory,
      onChange: () => assert.fail('default'),
      onAdd: () => {},
    });
    for (const label of [
      'Тип предмета 1',
      'Количество предмета 1',
      'Вид профиля предмета 1',
      'Предмет 1 экипирован',
      'Предмет 1 сломан',
      'Герметичность предмета 1',
      'Подтверждённое качество предмета 1',
    ])
      assert.equal(labelled(label).value, '');
  });
  it('NPC015 zero/negative draft quantity is retained for host error rather than clamped', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    await change(labelled('Количество предмета 1'), '0');
    assert.deepEqual(first(entered(last(q.history)).value).input.quantity, V(0));
    assert.deepEqual(first(entered(last(q.history)).value).input.equipped, U);
    await q.refresh();
    await change(labelled('Количество предмета 1'), '-1');
    assert.deepEqual(first(entered(last(q.history)).value).input.quantity, V(-1));
  });
  it('NPC015 equipment booleans are explicit, not unchecked=false defaults', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    await change(labelled('Предмет 1 экипирован'), '1');
    assert.deepEqual(first(entered(last(q.history)).value).input.equipped, V(false));
    await q.refresh();
    await change(labelled('Герметичность предмета 1'), '2');
    assert.deepEqual(first(entered(last(q.history)).value).input.sealed, V(null));
  });
  it('NPC015 nullable current values distinguish entered zero/null/UNSET', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    await change(labelled('Текущие патроны предмета 1'), '0');
    assert.deepEqual(first(entered(last(q.history)).value).input.currentAmmo, V(0));
    await q.refresh();
    await click('Без значения: Текущие патроны предмета 1');
    assert.deepEqual(first(entered(last(q.history)).value).input.currentAmmo, V(null));
  });
  it('NPC015 quantity/profile-specific errors remain visible and linked', async () => {
    await render(E.NpcInventoryFields, {
      presentation: {
        ...inventory,
        errors: {
          'host-item-A': {
            quantity: ['Количество обязательно'],
            profile: ['Профиль не задан'],
          },
        },
      },
      onChange: () => {},
      onAdd: () => {},
    });
    assert.equal(labelled('Количество предмета 1').getAttribute('aria-invalid'), 'true');
    assert(present(container.textContent).includes('Профиль не задан'));
  });
  it('NPC015 catalogue selection sends kind only, no client-defined published properties', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    await change(labelled('Вид профиля предмета 1'), '0');
    assert.deepEqual(first(entered(last(q.history)).value).profile, V({ kind: 'CATALOG' }));
    await q.refresh();
    assert(
      present(container.textContent).includes('версия берутся из подтверждённого каталога хоста'),
    );
  });
  it('NPC015 master profile begins with UNSET reason and no guessed variants', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    await change(labelled('Вид профиля предмета 1'), '1');
    assert.deepEqual(
      first(entered(last(q.history)).value).profile,
      V({ kind: 'MASTER_WEAPON', reason: U, inputs: [] }),
    );
    await q.refresh();
    await click('Добавить вариант оружейного профиля 1');
    const w = first(profile(first(entered(last(q.history)).value).profile, 'MASTER_WEAPON').inputs);
    assert.deepEqual(w.input.weaponVariantId, U);
    assert.deepEqual(w.damageDefinition, U);
    assert.deepEqual(w.penetrationDefinition, U);
    assert(codes.every((k) => w.statRequirements[k].kind === 'UNSET'));
  });
  it('NPC015 master formula uses closed pattern/X controls, no free expression text', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    await change(labelled('Вид профиля предмета 1'), '1');
    await q.refresh();
    await click('Добавить вариант оружейного профиля 1');
    await q.refresh();
    await change(labelled('Предмет 1, профиль 1: урон: способ задания'), '1');
    await q.refresh();
    await change(labelled('Предмет 1, профиль 1: урон: шаблон формулы'), '1');
    await q.refresh();
    await change(labelled('Предмет 1, профиль 1: урон: константа X'), '3');
    const w = first(profile(first(entered(last(q.history)).value).profile, 'MASTER_WEAPON').inputs);
    assert.deepEqual(
      w.damageDefinition,
      V({ kind: 'MASTER_DICE', pattern: V('R6+X'), constantOrNull: V(3) }),
    );
    assert.deepEqual(w.penetrationDefinition, U);
  });
  it('NPC015 master retains exact explicit absent requirement instead of zero', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    await change(labelled('Вид профиля предмета 1'), '1');
    await q.refresh();
    await click('Добавить вариант оружейного профиля 1');
    await q.refresh();
    await click('Без значения: Предмет 1, профиль 1: требование S');
    assert.deepEqual(
      first(profile(first(entered(last(q.history)).value).profile, 'MASTER_WEAPON').inputs)
        .statRequirements.S,
      V(null),
    );
  });
  it('NPC015 custom profile begins with all semantic flags/mass/bonus UNSET', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    await change(labelled('Вид профиля предмета 1'), '2');
    const custom = profile(first(entered(last(q.history)).value).profile, 'STRUCTURED_CUSTOM');
    assert(Object.values(custom.input).every((v) => v.kind === 'UNSET'));
    assert.deepEqual(custom.customBonusOrNull, U);
  });
  it('NPC015 custom semantic flags and explicit UNKNOWN choice are real controls', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    await change(labelled('Вид профиля предмета 1'), '2');
    await q.refresh();
    await change(labelled('Название custom-предмета 1'), 'Метка');
    await q.refresh();
    await change(labelled('Размер custom-предмета 1'), '2');
    await q.refresh();
    await change(labelled('Предмет 1: пища'), '1');
    const custom = profile(first(entered(last(q.history)).value).profile, 'STRUCTURED_CUSTOM');
    assert.deepEqual(custom.input.name, V('Метка'));
    assert.deepEqual(custom.input.heldSizeClass, V('UNKNOWN'));
    assert.deepEqual(custom.input.isFood, V(false));
    assert.deepEqual(custom.input.canReceivePoison, U);
  });
  it('NPC015 custom bonus is explicit and does not choose stat/value defaults', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    await change(labelled('Вид профиля предмета 1'), '2');
    await q.refresh();
    await change(labelled('Бонус custom-предмета 1'), '1');
    assert.deepEqual(
      profile(first(entered(last(q.history)).value).profile, 'STRUCTURED_CUSTOM').customBonusOrNull,
      V({ customBonusStat: U, customBonusValue: U }),
    );
    await q.refresh();
    await change(labelled('Характеристика бонуса предмета 1'), '4');
    await q.refresh();
    await change(labelled('Величина бонуса предмета 1'), '2.5');
    assert.deepEqual(
      entered(
        profile(first(entered(last(q.history)).value).profile, 'STRUCTURED_CUSTOM')
          .customBonusOrNull,
      ).value,
      { customBonusStat: V('I'), customBonusValue: V(2.5) },
    );
    assert(present(container.textContent).includes('только в рюкзаке'));
  });
  it('NPC015 quality is selected only from host-prepared records, never free numeric roll', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    assert(labelled('Подтверждённое качество предмета 1') instanceof HTMLSelectElement);
    await change(labelled('Подтверждённое качество предмета 1'), '1');
    assert.deepEqual(first(entered(last(q.history)).value).input.qualityRoll, V(17));
  });
  it('NPC015 explicit clothing and quality controls preserve unknown flags and copy only selected placement', async () => {
    const base = invRow();
    assert(!('itemTypeReference' in base));
    const p: NpcInventoryPresentation = {
      ...inventory,
      input: V([{ ...base, input: { ...base.input, itemTypeId: V('RES-EQP-001') } }]),
      choices: {
        ...itemChoices,
        itemTypes: [{ value: 'RES-EQP-001', label: 'Одежда' }],
        qualityTiers: [
          { value: null, label: 'Без категории' },
          { value: 'GOOD', label: 'Хорошее' },
        ],
        clothingRegions: [{ value: 'TORSO', label: 'Корпус одежды' }],
        clothingHermetic: [
          { value: 'UNKNOWN', label: 'Не установлено' },
          { value: true, label: 'Да' },
        ],
        clothingFlammability: [{ value: 'UNKNOWN', label: 'Не установлено' }],
      },
    };
    const q = await controlled(E.NpcInventoryFields, p);
    assert.equal(q.history.length, 0);
    assert.equal(labelled('Категория качества предмета 1').value, '');
    assert.equal(labelled('Герметичность одежды 1').value, '');
    await change(labelled('Категория качества предмета 1'), '0');
    assert.deepEqual(first(entered(last(q.history)).value).qualityTier, V(null));
    await q.refresh();
    await flush(() => (labelled('Корпус одежды') as HTMLInputElement).click());
    await q.refresh();
    await change(labelled('Герметичность одежды 1'), '0');
    await q.refresh();
    await click('Надеть одежду 1 на выбранные зоны');
    const result = first(entered(last(q.history)).value);
    assert.deepEqual(result.input.equipped, V(true));
    assert.deepEqual(result.input.equippedSlots, V(['TORSO']));
    assert.deepEqual(result.input.bodyZone, V(null));
    assert.deepEqual(result.input.sealed, V(null));
    assert.deepEqual(result.input.qualityRoll, U);
    assert.deepEqual(
      result.clothingProperties,
      V({
        coveredRegionIds: V(['TORSO']),
        hermetic: V('UNKNOWN'),
        flammability: U,
      }),
    );
  });
  it('NPC015 incompatible clothing properties remain visible until explicitly removed', async () => {
    const base = invRow();
    assert(!('itemTypeReference' in base));
    const q = await controlled(E.NpcInventoryFields, {
      ...inventory,
      input: V([
        {
          ...base,
          input: { ...base.input, itemTypeId: V('RES-EQP-001') },
          clothingProperties: V({
            coveredRegionIds: V(['TORSO'] as const),
            hermetic: V(false),
            flammability: V('UNKNOWN'),
          }),
        },
      ]),
      choices: {
        ...itemChoices,
        itemTypes: [
          { value: 'RES-EQP-001', label: 'Одежда' },
          { value: 'RES-CON-001', label: 'Другой тип' },
        ],
        clothingRegions: [{ value: 'TORSO' as const, label: 'Корпус одежды' }],
        clothingHermetic: [{ value: false, label: 'Нет' }],
        clothingFlammability: [{ value: 'UNKNOWN' as const, label: 'Не установлено' }],
      },
    });
    await change(labelled('Тип предмета 1'), '1');
    await q.refresh();
    assert(present(container.textContent).includes('Свойства одежды несовместимы'));
    assert.equal(labelled('Герметичность одежды 1').value, '0');
    await click('Удалить свойства одежды 1');
    const result = first(entered(last(q.history)).value);
    assert.equal(Object.hasOwn(result, 'clothingProperties'), false);
    assert.deepEqual(result.input.itemTypeId, V('RES-CON-001'));
  });
  it('NPC015 explicitly records empty coatings without selecting arbitrary prepared identities', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    const fieldset = [...container.querySelectorAll('fieldset')].find(
      (f) =>
        f.querySelector(':scope > legend')?.textContent === 'Подготовленные покрытия предмета 1',
    );
    assert(fieldset);
    assert.equal(fieldset.querySelectorAll('input,select').length, 0);
    await click('Подтвердить отсутствие покрытий предмета 1');
    assert.deepEqual(first(entered(last(q.history)).value).input.coatingInstanceIds, V([]));
  });
  it('NPC015 selected doses are read-only and cannot bypass explicit remove or replacement', async () => {
    const original = first(entered(inventory.input).value);
    assert(!('itemTypeReference' in original));
    const row = {
      ...original,
      input: { ...original.input, coatingInstanceIds: V(['host-coating-A']) },
    };
    const q = await controlled(E.NpcInventoryFields, { ...inventory, input: V([row]) });
    const fieldset = present(
      [...container.querySelectorAll('fieldset')].find(
        (f) =>
          f.querySelector(':scope > legend')?.textContent === 'Подготовленные покрытия предмета 1',
      ),
    );
    assert.equal(fieldset.querySelectorAll('input,select,button').length, 0);
    assert.equal(q.history.length, 0);
    assert(fieldset.querySelector('li'));
  });
  it('NPC015 removing entry changes draft only and never emits delete workflow', async () => {
    const q = await controlled(E.NpcInventoryFields, inventory);
    await click('Убрать экземпляр предмета 1');
    assert.deepEqual(last(q.history), V([]));
  });
  it('NPC013014015 pending/read-only disable editor and continuation interaction', async () => {
    const props = {
      onChange: () => assert.fail('edit'),
      onAdd: () => assert.fail('add'),
      onContinuation: () => assert.fail('roll'),
    };
    for (const element of [
      <E.NpcSymbiontsFields
        {...props}
        presentation={{ ...sym, state: { ...state, pending: true } }}
      />,
      <E.NpcSkillsFields
        {...props}
        presentation={{ ...skillView, state: { ...state, pending: true } }}
      />,
      <E.NpcInventoryFields
        {...props}
        presentation={{ ...inventory, state: { ...state, pending: true } }}
      />,
    ]) {
      assert(root);
      await flush(() => root?.render(element));
      assert.equal(query<HTMLFieldSetElement>('fieldset').disabled, true);
      const button = query('button');
      await flush(() => button.click());
    }
  });
  it('NPC002 failed old read after a new binding cannot show an error or finish its new busy state', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    const stale = await file();
    const changed = {
      ...q.props,
      presentation: { ...identity, bindingKey: 'attempt-B/revision-0' },
    };
    await render(E.NpcIdentityFields, changed);
    const active = await file();
    await flush(() => stale.fail());
    assert.equal(q.arts.length, 0);
    assert(!present(container.textContent).includes('Не удалось прочитать'));
    assert.deepEqual(last(q.busy), ['attempt-B/revision-0', true]);
    await flush(() => active.complete(PNG));
    assert.equal(q.arts.length, 1);
    assert.equal(first(q.arts)[0], 'attempt-B/revision-0');
    assert.deepEqual(last(q.busy), ['attempt-B/revision-0', false]);
  });
  it('NPC002 loss and restoration of input access fences an old failure with the same attempt binding', async () => {
    const q = idProps();
    await render(E.NpcIdentityFields, q.props);
    const stale = await file();
    await render(E.NpcIdentityFields, {
      ...q.props,
      presentation: { ...identity, state: { ...state, readOnly: true } },
    });
    await render(E.NpcIdentityFields, q.props);
    const active = await file();
    await flush(() => stale.fail());
    assert(!present(container.textContent).includes('Не удалось прочитать'));
    assert.deepEqual(last(q.busy), [identity.bindingKey, true]);
    await flush(() => active.complete(PNG));
    assert.equal(q.arts.length, 1);
    assert.deepEqual(last(q.busy), [identity.bindingKey, false]);
  });
});

const initialStateView: NpcInitialStatePresentation = {
  input: {
    input: {
      currentHP: U,
      effectInstanceIds: U,
      traumaInstanceIds: U,
      woundInstanceIds: U,
      sourceSpecificStateFactIds: U,
      deathConsequenceFactIdOrNull: U,
    },
    currentOeChanges: [],
  },
  errors: {},
  symbionts: [
    {
      symbiontInstanceId: 'same-composition-instance',
      label: 'Сова',
      currentOE: V(5),
      maximumOrNull: 10,
      errors: [],
    },
  ],
  choices: {
    effectInstanceIds: [{ value: 'prepared-effect', label: 'Болезнь от хоста' }],
    traumaInstanceIds: [{ value: 'prepared-trauma', label: 'Травма от хоста' }],
    woundInstanceIds: [{ value: 'prepared-wound', label: 'Рана от хоста' }],
    sourceSpecificStateFactIds: [{ value: 'prepared-special', label: 'Особое состояние от хоста' }],
    deathConsequenceFactIdOrNull: [
      { value: null, label: 'Без последствия смерти' },
      { value: 'prepared-death', label: 'Подтверждённое последствие' },
    ],
  },
  derivedRows: [
    { label: 'Максимум HP', value: 'host-HP' },
    { label: 'Дееспособность', value: 'host-actions' },
  ],
  calendar: {
    requiresCampaignTime: false,
    validationStatus: 'NOT_REQUIRED',
    bindingOrNull: null,
    initialTimeLockOrNull: null,
    messages: [],
  },
  traumaPreparationOrNull: null,
  diseasePreparationOrNull: {
    capabilityKey: 'host-preparation-bound-attempt',
    input: U,
    choices: [
      { value: 'DIS-RHINITIS', label: 'Насморк' },
      { value: 'DIS-PNEUMONIA', label: 'Пневмония' },
    ],
    errors: [],
    canSubmit: false,
    explanation: 'Только формальное назначение с подтверждённым временем.',
  },
  woundPreparationOrNull: null,
  preparationBlockers: [],
  validationSummary: [],
  state,
};
async function initialHarness(p: NpcInitialStatePresentation = initialStateView) {
  const history: NpcEditorStages['NPC-016'][] = [];
  const preparations: NpcDiseasePreparationIntent[] = [];
  const wounds: NpcWoundPreparationIntent[] = [];
  const traumas: string[] = [];
  const props = {
    presentation: p,
    onChange: (input: NpcEditorStages['NPC-016']) => {
      history.push(input);
      props.presentation = { ...props.presentation, input };
    },
    onPreparation: (intent: NpcDiseasePreparationIntent) => {
      preparations.push(intent);
    },
    onTraumaPreparation: (capabilityKey: string) => {
      traumas.push(capabilityKey);
    },
    onWoundPreparation: (intent: NpcWoundPreparationIntent) => {
      wounds.push(intent);
      if (intent.kind === 'SET_INPUT' && props.presentation.woundPreparationOrNull !== null)
        props.presentation = {
          ...props.presentation,
          woundPreparationOrNull: {
            ...props.presentation.woundPreparationOrNull,
            input: intent.input,
          },
        };
    },
  };
  await render(E.NpcInitialStateFields, props);
  return {
    props,
    history,
    preparations,
    wounds,
    traumas,
    refresh: () => render(E.NpcInitialStateFields, props),
  };
}
const stageValid = { label: 'Этап', status: 'VALID', messages: [] } as const;
const finalView: NpcFinalReviewPresentation = {
  binding: {
    editMode: 'CREATE_V1',
    attemptRevision: 3,
    versionBindingOrNull: null,
    resultVersion: 1,
  },
  previewOrNull: {
    name: sheet.name,
    artOrNull: sheet.artOrNull,
    sections: sheet.sections,
    pinnedCombatReferences: sheet.pinnedCombatReferences,
  },
  stages: {
    'NPC-002': stageValid,
    'NPC-011': stageValid,
    'NPC-012': stageValid,
    'NPC-013': stageValid,
    'NPC-014': stageValid,
    'NPC-015': stageValid,
    'NPC-016': stageValid,
    'NPC-017': stageValid,
  },
  fullValidationStatus: 'VALID',
  validationErrors: [],
  calendar: initialStateView.calendar,
  commitStatusLabel: 'Ожидает явного сохранения',
  receiptOrNull: null,
  state,
};
describe('NPC-016 editable initial state and NPC-017 host-validated preview', () => {
  it('renders technical UNSET without HP, death or effect defaults and without derived inputs', async () => {
    const q = await initialHarness();
    assert.equal(labelled('Текущие HP').value, '');
    assert.equal(labelled('Подготовленное последствие смерти').value, '');
    assert.equal(q.history.length, 0);
    assert.equal(q.preparations.length, 0);
    assert.equal(container.querySelectorAll('textarea').length, 0);
    assert.equal(container.querySelectorAll('input[type=number]').length, 2);
    assert(present(container.textContent).includes('host-HP'));
    assert(present(container.textContent).includes('host-actions'));
  });
  it('preserves entered invalid finite HP for host error display without silent clamp', async () => {
    const q = await initialHarness({
      ...initialStateView,
      errors: { currentHP: ['HP вне допустимого диапазона'] },
    });
    await change(labelled('Текущие HP'), '-2.5');
    assert.deepEqual(last(q.history).input.currentHP, V(-2.5));
    await q.refresh();
    assert.equal(labelled('Текущие HP').getAttribute('aria-invalid'), 'true');
    assert(present(container.textContent).includes('HP вне допустимого диапазона'));
  });
  it('clearing HP returns UNSET and does not create zero', async () => {
    const q = await initialHarness({
      ...initialStateView,
      input: {
        ...initialStateView.input,
        input: { ...initialStateView.input.input, currentHP: V(4) },
      },
    });
    await change(labelled('Текущие HP'), '');
    assert.deepEqual(last(q.history).input.currentHP, U);
  });
  it('edits the same composition OE identity, replaces its pending value and preserves HP', async () => {
    const q = await initialHarness();
    await change(labelled('Текущие ОЭ: Сова'), '-1');
    await q.refresh();
    await change(labelled('Текущие ОЭ: Сова'), '3.5');
    assert.deepEqual(last(q.history), {
      input: initialStateView.input.input,
      currentOeChanges: [{ symbiontInstanceId: 'same-composition-instance', currentOE: V(3.5) }],
    });
    await q.refresh();
    await change(labelled('Текущие ОЭ: Сова'), '');
    assert.deepEqual(last(q.history).currentOeChanges, [
      { symbiontInstanceId: 'same-composition-instance', currentOE: U },
    ]);
  });
  for (const [field, label, ref] of [
    ['effectInstanceIds', 'Подготовленные эффекты', 'prepared-effect'],
    ['traumaInstanceIds', 'Подготовленные травмы', 'prepared-trauma'],
    ['woundInstanceIds', 'Подготовленные раны', 'prepared-wound'],
    ['sourceSpecificStateFactIds', 'Подготовленные особые состояния', 'prepared-special'],
  ] as const)
    it(`preserves explicit empty and selected prepared reference for ${field}`, async () => {
      const q = await initialHarness();
      await click(`Не выбирать: ${label}`);
      assert.deepEqual(last(q.history).input[field], V([]));
      await q.refresh();
      const box = present(
        [...container.querySelectorAll('fieldset')].find(
          (f) => f.querySelector(':scope > legend')?.textContent === label,
        ),
      );
      await flush(() => present(box.querySelector<HTMLInputElement>('input')).click());
      assert.deepEqual(last(q.history).input[field], V([ref]));
    });
  it('retains unavailable saved state references visibly instead of deleting them on catalogue change', async () => {
    const q = await initialHarness({
      ...initialStateView,
      input: {
        ...initialStateView.input,
        input: { ...initialStateView.input.input, effectInstanceIds: V(['old-ref']) },
      },
    });
    assert(present(container.textContent).includes('Введённый выбор недоступен: old-ref'));
    assert.equal(q.history.length, 0);
  });
  it('distinguishes death UNSET, explicit no consequence, and a prepared consequence', async () => {
    const q = await initialHarness();
    await change(labelled('Подготовленное последствие смерти'), '0');
    assert.deepEqual(last(q.history).input.deathConsequenceFactIdOrNull, V(null));
    await q.refresh();
    await change(labelled('Подготовленное последствие смерти'), '1');
    assert.deepEqual(last(q.history).input.deathConsequenceFactIdOrNull, V('prepared-death'));
  });
  it('emits only disease selection and capability, never client effect identity, timestamps or schedule', async () => {
    const q = await initialHarness();
    await change(labelled('Болезнь для назначения'), '1');
    assert.deepEqual(q.preparations, [
      {
        kind: 'SET_DISEASE',
        capabilityKey: 'host-preparation-bound-attempt',
        input: V('DIS-PNEUMONIA'),
      },
    ]);
    assert.equal(q.history.length, 0);
    await click('Подготовить выбранную болезнь');
    assert.equal(q.preparations.length, 1);
    q.props.presentation = {
      ...q.props.presentation,
      traumaPreparationOrNull: null,
      diseasePreparationOrNull: {
        ...present(q.props.presentation.diseasePreparationOrNull),
        input: V('DIS-PNEUMONIA'),
        canSubmit: true,
      },
    };
    await q.refresh();
    await click('Подготовить выбранную болезнь');
    assert.deepEqual(last(q.preparations), {
      kind: 'PREPARE',
      capabilityKey: 'host-preparation-bound-attempt',
    });
    assert.equal(q.history.length, 0);
  });
  it('removes preparation controls when the host withdraws the capability and keeps unresolved blockers visible', async () => {
    const q = await initialHarness();
    q.props.presentation = {
      ...q.props.presentation,
      traumaPreparationOrNull: null,
      diseasePreparationOrNull: null,
      preparationBlockers: ['Схема алкоголя ожидает подтверждения источника.'],
    };
    await q.refresh();
    assert(!present(container.textContent).includes('Подготовить выбранную болезнь'));
    assert(
      present(container.textContent).includes('Схема алкоголя ожидает подтверждения источника.'),
    );
    assert.equal(q.preparations.length, 0);
  });
  for (const guard of ['pending', 'readOnly'] as const)
    it(`disables initial state edits and preparation when ${guard}`, async () => {
      const q = await initialHarness({
        ...initialStateView,
        state: { ...state, [guard]: true },
        traumaPreparationOrNull: null,
        diseasePreparationOrNull: {
          ...present(initialStateView.diseasePreparationOrNull),
          canSubmit: true,
        },
      });
      assert(query<HTMLFieldSetElement>('fieldset').disabled);
      await click('Подготовить выбранную болезнь');
      await click('Не выбирать: Подготовленные эффекты');
      assert.equal(q.history.length, 0);
      assert.equal(q.preparations.length, 0);
    });
  it('shows stale bound time and immutable lock without fabricating a time editor or applying a rebase', async () => {
    const q = await initialHarness({
      ...initialStateView,
      calendar: {
        requiresCampaignTime: true,
        validationStatus: 'STALE',
        bindingOrNull: {
          kind: 'PRE_START_INITIAL',
          campaignTimestamp: 2707,
          lobbySnapshotRevision: 'a'.repeat(64),
        },
        initialTimeLockOrNull: {
          campaignTimestamp: 2707,
          sourceNpcUuid: 'kept-npc',
          sourceVersion: 2,
        },
        messages: ['Повторите проверку сохранённой попытки.'],
      },
    });
    assert(present(container.textContent).includes('привязка устарела'));
    assert(present(container.textContent).includes('2707 мин.'));
    assert(present(container.textContent).includes('версия 2'));
    assert.equal(q.history.length, 0);
    assert.equal(container.querySelectorAll('input[type=date],input[type=time]').length, 0);
  });
  it('renders all eight stage results and all seven full-sheet sections without saved-version fiction', async () => {
    await render(L.NpcFinalReviewContent, { presentation: finalView });
    assert.deepEqual(
      [...container.querySelectorAll('[data-npc-stage]')].map((e) =>
        e.getAttribute('data-npc-stage'),
      ),
      C.NPC_VALIDATION_STAGE_IDS,
    );
    for (const section of C.NPC_SHEET_SECTIONS)
      assert(present(container.textContent).includes('host-' + section));
    assert(present(container.textContent).includes('первой версии'));
    assert(!present(container.textContent).includes('Показана версия'));
    assert(!present(container.textContent).includes('Историческая версия'));
    assert(present(container.textContent).includes('Подтверждение сохранения не получено'));
    assert.equal(container.querySelectorAll('button,input,select,textarea').length, 0);
  });
  it('shows APPEND current/next binding and refuses to present missing preview as a complete sheet', async () => {
    await render(L.NpcFinalReviewContent, {
      presentation: {
        ...finalView,
        binding: {
          editMode: 'APPEND_N_PLUS_ONE',
          attemptRevision: 8,
          versionBindingOrNull: { npcUuid: 'same-npc', expectedCurrentVersion: 4 },
          resultVersion: 5,
        },
        previewOrNull: null,
        fullValidationStatus: 'INCOMPLETE',
        stages: {
          ...finalView.stages,
          'NPC-016': {
            label: 'Исходное состояние',
            status: 'INVALID',
            messages: ['Не подтверждено время'],
          },
        },
        validationErrors: ['Восемь этапов ещё не проверены'],
      },
    });
    const t = present(container.textContent);
    assert(t.includes('Текущая версия: 4'));
    assert(t.includes('сохранения: 5'));
    assert(t.includes('Полный лист ещё не подготовлен'));
    assert(t.includes('Не подтверждено время'));
    assert(t.includes('Восемь этапов ещё не проверены'));
    assert.equal(container.querySelectorAll('button').length, 0);
  });
  it('displays confirmed history only from a host receipt, with bounded preview art', async () => {
    await render(L.NpcFinalReviewContent, {
      presentation: {
        ...finalView,
        previewOrNull: {
          ...present(finalView.previewOrNull),
          artOrNull: {
            status: 'READY',
            assetKey: 'prepared',
            checksum: 'b'.repeat(64),
            url: 'blob:npc-preview',
          },
        },
        receiptOrNull: {
          npcUuid: 'saved-npc',
          version: 1,
          historyEntryLabel: 'Мастер · подтверждённая запись',
        },
        commitStatusLabel: 'Сохранено хостом',
      },
    });
    expectBoundedArt('blob:npc-preview');
    assert(present(container.textContent).includes('Сохранена версия 1'));
    assert(present(container.textContent).includes('подтверждённая запись'));
    assert.equal(container.querySelectorAll('button').length, 0);
  });
});

const traumaId = '00000000-0000-4000-8000-000000000081';
const traumaPreparation: NonNullable<NpcInitialStatePresentation['traumaPreparationOrNull']> = {
  capabilityKey: 'host-trauma-assignment',
  canSubmit: true,
  explanation: 'Резервирование новой исходной травмы; параметры вводятся явно.',
  regions: [
    { value: 'HEAD', label: 'Голова' },
    { value: 'TORSO', label: 'Корпус' },
    { value: 'ARM_L', label: 'Левая рука' },
  ],
  retainedIds: [],
  errors: {},
};
describe('NPC015/016 initial poison controls', () => {
  const sourceInstanceId = '00000000-0000-4000-8000-000000000071';
  const targetItemInstanceId = '00000000-0000-4000-8000-000000000072';
  const coatingInstanceId = '00000000-0000-4000-8000-000000000073';
  it('requires an explicit learned initial mode and leaves retained modes read-only', async () => {
    const onSubmit = vi.fn();
    await render(NpcPoisonModeFields, {
      presentation: {
        ...initialStateView,
        poisonModeStates: [
          {
            sourceInstanceId,
            modeFactId: coatingInstanceId,
            sourceLabel: 'Прежний Тайпан',
            poisonProfileId: 'POI-TAIPAN-PARALYTIC',
            explanation: 'Сохранённый таймер не переключается',
            derivedRows: [{ label: 'Режим', value: 'Паралитический' }],
          },
        ],
        poisonModePreparations: [
          {
            capabilityKey: 'new-mode',
            sourceInstanceId,
            sourceLabel: 'Новый Тайпан',
            profileChoices: [{ value: 'POI-TAIPAN-DEADLY', label: 'Смертельный' }],
            input: { poisonProfileId: U, reason: U },
            canSubmit: true,
            errors: {},
            explanation: 'Новый исходный режим',
            derivedRows: [],
          },
        ],
      },
      onSubmit,
    });
    assert.equal(labelled('Вид исходного яда').value, '');
    await click('Задать исходный режим яда');
    assert.equal(onSubmit.mock.calls.length, 0);
    await change(labelled('Вид исходного яда'), 'POI-TAIPAN-DEADLY');
    await change(labelled('Причина исходного режима яда'), 'Исходный режим');
    await click('Задать исходный режим яда');
    assert.deepEqual(onSubmit.mock.calls, [
      [
        {
          capabilityKey: 'new-mode',
          sourceInstanceId,
          poisonProfileId: 'POI-TAIPAN-DEADLY',
          reason: 'Исходный режим',
        },
      ],
    ]);
    assert.equal(container.querySelectorAll('select').length, 1);
    assert.match(container.textContent ?? '', /Сохранённый таймер не переключается/);
  });
  it('requires carrier, surface and separate replacement confirmation before sending intent', async () => {
    const onSubmit = vi.fn(),
      onRemove = vi.fn();
    await render(NpcPoisonCoatingFields, {
      presentation: {
        ...inventory,
        poisonCoatingPreparations: [
          {
            capabilityKey: 'carrier',
            sourceInstanceId,
            sourceLabel: 'Тайпан',
            targetItemInstanceId,
            targetLabel: 'Меч',
            surfaceLabel: 'Режущая кромка',
            replacesCoatingIdOrNull: coatingInstanceId,
            input: { surfaceConfirmed: U, replaceConfirmed: U, reason: U },
            canSubmit: true,
            errors: {},
            explanation: 'Замена реальной дозы',
            derivedRows: [{ label: 'Прежняя доза', value: 'Ослабляющий яд' }],
          },
        ],
      },
      onSubmit,
      onRemove,
    });
    assert.equal(labelled('Источник яда и предмет для покрытия').value, '');
    assert.equal(container.querySelectorAll('button').length, 0);
    await change(labelled('Источник яда и предмет для покрытия'), 'carrier');
    await change(labelled('Причина подготовки покрытия'), 'Замена по решению GM');
    await flush(() => query<HTMLInputElement>('input[type="checkbox"]').click());
    await click('Заменить покрытие');
    assert.equal(onSubmit.mock.calls.length, 0);
    await flush(() =>
      present(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]).click(),
    );
    await click('Заменить покрытие');
    assert.deepEqual(onSubmit.mock.calls, [
      [
        {
          capabilityKey: 'carrier',
          sourceInstanceId,
          targetItemInstanceId,
          surfaceConfirmed: true,
          replacesCoatingIdOrNull: coatingInstanceId,
          replaceConfirmed: true,
          reason: 'Замена по решению GM',
        },
      ],
    ]);
    assert.match(container.textContent ?? '', /Ослабляющий яд/);
    assert.equal(onRemove.mock.calls.length, 0);
  });
  it('removal needs an explicit reason and never claims delivery or consumption', async () => {
    const onSubmit = vi.fn(),
      onRemove = vi.fn();
    await render(NpcPoisonCoatingFields, {
      presentation: {
        ...inventory,
        poisonCoatings: [
          {
            capabilityKey: 'remove-dose',
            coatingInstanceId,
            targetItemInstanceId,
            targetLabel: 'Меч',
            canRemove: true,
            errors: [],
            explanation: 'Сила закреплена по последнему доказанному источнику',
            derivedRows: [
              { label: 'Первоначальный источник', value: 'Тайпан L2' },
              { label: 'Текущая сила', value: 'FROZEN L3' },
            ],
          },
        ],
      },
      onSubmit,
      onRemove,
    });
    await click('Снять покрытие');
    assert.equal(onRemove.mock.calls.length, 0);
    await change(labelled('Причина снятия покрытия'), 'Очистка поверхности');
    await click('Снять покрытие');
    assert.deepEqual(onRemove.mock.calls, [
      [{ capabilityKey: 'remove-dose', coatingInstanceId, reason: 'Очистка поверхности' }],
    ]);
    assert.match(container.textContent ?? '', /Тайпан L2/);
    assert.match(container.textContent ?? '', /FROZEN L3/);
    assert.equal(onSubmit.mock.calls.length, 0);
  });
});

function emptyTraumaRow(): NpcTraumaEditorRow {
  return {
    traumaInstanceId: traumaId,
    input: { regionId: U, traumaValue: U, reason: U },
    head: U,
  };
}
function traumaView(row: NpcTraumaEditorRow = emptyTraumaRow()): NpcInitialStatePresentation {
  return {
    ...initialStateView,
    input: {
      ...initialStateView.input,
      input: {
        ...initialStateView.input.input,
        traumaInstanceIds: V([]),
        traumaInputs: V([row]),
      },
    },
    choices: {
      ...initialStateView.choices,
      traumaInstanceIds: [{ value: traumaId, label: 'Травма, зарезервированная хостом' }],
    },
    traumaPreparationOrNull: traumaPreparation,
  };
}
function lastTrauma(history: readonly NpcEditorStages['NPC-016'][]): NpcTraumaEditorRow {
  return first(entered(present(last(history).input.traumaInputs)).value);
}
describe('NPC-016 initial trauma controls', () => {
  it('emits only the preparation capability and keeps the host-reserved row unselected and unset', async () => {
    const q = await initialHarness(traumaView());
    assert.equal(labelled('Зона травмы').value, '');
    assert.equal(labelled('Величина травмы').value, '');
    assert.equal(labelled('Причина травмы').value, '');
    assert(!container.textContent?.includes('Одноразовый штраф головы'));
    assert.equal(q.history.length, 0);
    await click('Добавить новую исходную травму');
    assert.deepEqual(q.traumas, ['host-trauma-assignment']);
    assert.deepEqual(q.props.presentation.input.input.traumaInstanceIds, V([]));
    assert.deepEqual(q.props.presentation.input.input.traumaInputs, V([emptyTraumaRow()]));
    assert.equal(q.history.length, 0);
    assert.equal(q.preparations.length, 0);
    assert.equal(q.wounds.length, 0);
  });
  for (const guard of ['pending', 'readOnly', 'localEditDirty'] as const)
    it(`does not reserve another trauma while ${guard}`, async () => {
      const q = await initialHarness({ ...traumaView(), state: { ...state, [guard]: true } });
      const button = present(
        [...container.querySelectorAll('button')].find(
          (b) => b.textContent === 'Добавить новую исходную травму',
        ),
      );
      assert(button.matches(':disabled'));
      await click('Добавить новую исходную травму');
      assert.equal(q.traumas.length, 0);
      assert.equal(q.history.length, 0);
    });
  it('withdraws the reserve control with its host capability and respects a disabled capability', async () => {
    const q = await initialHarness({
      ...traumaView(),
      traumaPreparationOrNull: { ...traumaPreparation, canSubmit: false },
    });
    await click('Добавить новую исходную травму');
    assert.equal(q.traumas.length, 0);
    q.props.presentation = { ...q.props.presentation, traumaPreparationOrNull: null };
    await q.refresh();
    assert(!container.textContent?.includes('Добавить новую исходную травму'));
    assert.equal(q.history.length, 0);
  });
  it('preserves partial HEAD fields and explicit pending or consumed penalty without creating a trauma result', async () => {
    const q = await initialHarness(traumaView());
    await change(labelled('Зона травмы'), '0');
    await q.refresh();
    assert.deepEqual(lastTrauma(q.history), {
      ...emptyTraumaRow(),
      input: { ...emptyTraumaRow().input, regionId: V('HEAD') },
    });
    assert.equal(labelled('Одноразовый штраф головы').value, '');
    assert.equal(labelled('Оглушение головы').value, '');
    await change(labelled('Одноразовый штраф головы'), '0');
    await q.refresh();
    assert.deepEqual(lastTrauma(q.history).head, V({ penalty: V('PENDING'), stun: U }));
    await change(labelled('Одноразовый штраф головы'), '1');
    await q.refresh();
    await change(labelled('Величина травмы'), '7.5');
    await q.refresh();
    await change(labelled('Причина травмы'), 'Сохранённое исходное состояние');
    assert.deepEqual(lastTrauma(q.history), {
      traumaInstanceId: traumaId,
      input: {
        regionId: V('HEAD'),
        traumaValue: V(7.5),
        reason: V('Сохранённое исходное состояние'),
      },
      head: V({ penalty: V('CONSUMED'), stun: U }),
    });
    assert.deepEqual(last(q.history).input.traumaInstanceIds, V([]));
    assert.equal(q.traumas.length, 0);
  });
  it('preserves exact decimal minutes as text, clears to UNSET, and drops the timer on explicit ABSENT', async () => {
    const q = await initialHarness(
      traumaView({
        ...emptyTraumaRow(),
        input: { ...emptyTraumaRow().input, regionId: V('HEAD') },
      }),
    );
    await change(labelled('Оглушение головы'), '1');
    await q.refresh();
    assert.equal(labelled('Остаток оглушения, минуты').value, '');
    assert.deepEqual(
      lastTrauma(q.history).head,
      V({ penalty: U, stun: V({ status: 'ACTIVE', remainingMinutes: U }) }),
    );
    const exact = '0.100000000000000005';
    await change(labelled('Остаток оглушения, минуты'), exact);
    await q.refresh();
    assert.equal(labelled('Остаток оглушения, минуты').value, exact);
    assert.deepEqual(
      lastTrauma(q.history).head,
      V({ penalty: U, stun: V({ status: 'ACTIVE', remainingMinutes: V(exact) }) }),
    );
    await change(labelled('Остаток оглушения, минуты'), '');
    await q.refresh();
    assert.deepEqual(
      lastTrauma(q.history).head,
      V({ penalty: U, stun: V({ status: 'ACTIVE', remainingMinutes: U }) }),
    );
    await change(labelled('Остаток оглушения, минуты'), exact);
    await q.refresh();
    await change(labelled('Оглушение головы'), '0');
    await q.refresh();
    assert.deepEqual(lastTrauma(q.history).head, V({ penalty: U, stun: V({ status: 'ABSENT' }) }));
    assert(!container.textContent?.includes('Остаток оглушения, минуты'));
    await change(labelled('Оглушение головы'), '1');
    await q.refresh();
    assert.equal(labelled('Остаток оглушения, минуты').value, '');
    assert.deepEqual(
      lastTrauma(q.history).head,
      V({ penalty: U, stun: V({ status: 'ACTIVE', remainingMinutes: U }) }),
    );
  });
  it('removes head-only choices when an explicit region changes to TORSO and states that HP is already final', async () => {
    const q = await initialHarness(
      traumaView({
        traumaInstanceId: traumaId,
        input: { regionId: V('HEAD'), traumaValue: V(7), reason: V('Исходная травма') },
        head: V({
          penalty: V('PENDING'),
          stun: V({ status: 'ACTIVE', remainingMinutes: V('1.25') }),
        }),
      }),
    );
    await change(labelled('Зона травмы'), '1');
    await q.refresh();
    assert.deepEqual(lastTrauma(q.history).head, U);
    assert.deepEqual(lastTrauma(q.history).input, {
      regionId: V('TORSO'),
      traumaValue: V(7),
      reason: V('Исходная травма'),
    });
    assert(!container.textContent?.includes('Одноразовый штраф головы'));
    assert(!container.textContent?.includes('Остаток оглушения, минуты'));
    assert(
      container.textContent?.includes(
        'Текущие HP уже итоговые. Урон корпуса повторно не применяется.',
      ),
    );
  });
  it('disables retained parameters with a reason while keeping new reservation and explicit deselection separate', async () => {
    const retained: NpcTraumaEditorRow = {
      traumaInstanceId: traumaId,
      input: { regionId: V('HEAD'), traumaValue: V(7), reason: V('Историческая травма') },
      head: V({
        penalty: V('CONSUMED'),
        stun: V({ status: 'ACTIVE', remainingMinutes: V('0.125') }),
      }),
    };
    const p = traumaView(retained),
      q = await initialHarness({
        ...p,
        input: { ...p.input, input: { ...p.input.input, traumaInstanceIds: V([traumaId]) } },
        traumaPreparationOrNull: { ...traumaPreparation, retainedIds: [traumaId] },
      });
    for (const label of [
      'Зона травмы',
      'Величина травмы',
      'Причина травмы',
      'Одноразовый штраф головы',
      'Оглушение головы',
      'Остаток оглушения, минуты',
    ])
      assert(labelled(label).matches(':disabled'), label);
    assert(
      container.textContent?.includes('Сохранённая травма: исходные параметры и время неизменны.'),
    );
    assert(container.textContent?.includes('Для нового значения добавьте новую травму'));
    await click('Добавить новую исходную травму');
    assert.deepEqual(q.traumas, ['host-trauma-assignment']);
    assert.equal(q.history.length, 0);
    await click('Не выбирать: Подготовленные травмы');
    assert.deepEqual(last(q.history).input.traumaInstanceIds, V([]));
    assert.deepEqual(last(q.history).input.traumaInputs, V([retained]));
  });
});

const woundPreparation: NpcWoundPreparation = {
  capabilityKey: 'host-wound-assignment',
  input: { woundType: U, regionId: U, damagePerTick: U },
  typeChoices: [
    { value: 'GENERIC', label: 'Рана' },
    { value: 'BLEEDING', label: 'Кровотечение' },
  ],
  regionChoices: [
    { value: 'HEAD', label: 'Голова' },
    { value: 'ARM_L', label: 'Левая рука' },
  ],
  errors: {},
  canSubmit: false,
  explanation: 'Явное назначение мастером.',
};
describe('NPC-016 wound preparation controls', () => {
  it('starts with no type, region or damage default and keeps assignment separate from selected wounds', async () => {
    const q = await initialHarness({
      ...initialStateView,
      woundPreparationOrNull: woundPreparation,
    });
    assert.equal(labelled('Вид раны').value, '');
    assert.equal(labelled('Область раны').value, '');
    assert(!container.textContent?.includes('Урон кровотечения за тик'));
    await change(labelled('Вид раны'), '1');
    await q.refresh();
    assert.equal(labelled('Урон кровотечения за тик').value, '');
    await change(labelled('Область раны'), '1');
    assert.deepEqual(last(q.wounds), {
      kind: 'SET_INPUT',
      capabilityKey: 'host-wound-assignment',
      input: { woundType: V('BLEEDING'), regionId: V('ARM_L'), damagePerTick: U },
    });
    assert.equal(q.history.length, 0);
  });
  it('keeps a negative or fractional input for a host refusal, preserves zero, and clears to UNSET', async () => {
    const q = await initialHarness({
      ...initialStateView,
      woundPreparationOrNull: {
        ...woundPreparation,
        input: { ...woundPreparation.input, woundType: V('BLEEDING') },
        errors: { damagePerTick: ['Урон должен быть неотрицательным.'] },
      },
    });
    for (const value of [-2.5, 0, 1.5]) {
      await change(labelled('Урон кровотечения за тик'), String(value));
      assert.equal(last(q.wounds).kind, 'SET_INPUT');
      const lastInput = last(q.wounds);
      assert(lastInput.kind === 'SET_INPUT');
      assert.deepEqual(lastInput.input.damagePerTick, V(value));
      await q.refresh();
    }
    assert.equal(labelled('Урон кровотечения за тик').getAttribute('aria-invalid'), 'true');
    await change(labelled('Урон кровотечения за тик'), '');
    const cleared = last(q.wounds);
    assert(cleared.kind === 'SET_INPUT');
    assert.deepEqual(cleared.input.damagePerTick, U);
    assert.equal(q.history.length, 0);
  });
  it('does not silently discard hidden bleeding input when the type changes', async () => {
    const q = await initialHarness({
      ...initialStateView,
      woundPreparationOrNull: {
        ...woundPreparation,
        input: { woundType: V('BLEEDING'), regionId: V('HEAD'), damagePerTick: V(3) },
      },
    });
    await change(labelled('Вид раны'), '0');
    await q.refresh();
    assert(!container.textContent?.includes('Урон кровотечения за тик'));
    const hidden = last(q.wounds);
    assert(hidden.kind === 'SET_INPUT');
    assert.deepEqual(hidden.input.damagePerTick, V(3));
    await change(labelled('Вид раны'), '1');
    await q.refresh();
    assert.equal(labelled('Урон кровотечения за тик').value, '3');
  });
  it('submits only the host capability after confirmation, without creating a wound or selecting it', async () => {
    const q = await initialHarness({
      ...initialStateView,
      woundPreparationOrNull: woundPreparation,
    });
    await click('Подготовить рану');
    assert.equal(q.wounds.length, 0);
    q.props.presentation = {
      ...q.props.presentation,
      woundPreparationOrNull: { ...woundPreparation, canSubmit: true },
    };
    await q.refresh();
    await click('Подготовить рану');
    assert.deepEqual(q.wounds, [{ kind: 'PREPARE', capabilityKey: 'host-wound-assignment' }]);
    assert.equal(q.history.length, 0);
    assert.equal(q.preparations.length, 0);
  });
  for (const guard of ['readOnly', 'pending'] as const)
    it(`blocks wound preparation when ${guard}`, async () => {
      const q = await initialHarness({
        ...initialStateView,
        state: { ...state, [guard]: true },
        woundPreparationOrNull: { ...woundPreparation, canSubmit: true },
      });
      await click('Подготовить рану');
      assert.equal(q.wounds.length, 0);
    });
  it('withdraws the preparation controls when the host capability is absent', async () => {
    const q = await initialHarness({
      ...initialStateView,
      woundPreparationOrNull: woundPreparation,
    });
    q.props.presentation = { ...q.props.presentation, woundPreparationOrNull: null };
    await q.refresh();
    assert(!container.textContent?.includes('Подготовить рану'));
    assert.equal(q.wounds.length, 0);
  });
});

describe('private portrait availability never blocks NPC controls', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const reference = { assetKey: 'npc-upload:' + 'a'.repeat(64), checksum: 'a'.repeat(64) };
  function fixture(form: 'NPC-001' | 'NPC-002', refused: boolean) {
    const scope = {
      projectionRole: 'gm' as const,
      contextId: id(1),
      campaignId: id(2),
      stateRevision: 0,
      projectionRevision: 2,
      actorVisibilityRevision: 0,
    };
    const raw = {
      ...scope,
      formId: form,
      campaignStatus: 'PAUSED',
      campaignPhase: 'PRE_START',
      libraryRevision: 2,
      attemptOrNull:
        form === 'NPC-002'
          ? {
              npcDraftId: id(3),
              candidateNpcUuid: id(4),
              attemptRevision: 2,
              draftRevision: 2,
              stage: 'NPC-002',
              editMode: 'CREATE_V1',
              versionBindingOrNull: null,
            }
          : null,
      content:
        form === 'NPC-002'
          ? { input: identity.input, errors: {}, artOrNull: reference }
          : {
              selectedNpcUuidOrNull: null,
              rows: rows.map((row, index) => ({
                ...row,
                npcUuid: id(index + 10),
                artOrNull: reference,
                groupLabelOrNull: null,
                locationLabelOrNull: null,
                subLocationLabelOrNull: null,
                sceneLabelOrNull: null,
                groupIdOrNull: null,
                locationIdOrNull: null,
                subLocationIdOrNull: null,
                sceneIdOrNull: null,
                markerRevisionOrNull: null,
              })),
            },
    };
    const d = decodeNpcProjection(form, raw, scope);
    assert(d.ok);
    const session = new NpcArtSession();
    session.setProjection(d.value);
    const target =
      form === 'NPC-002'
        ? { kind: 'ATTEMPT' as const, npcDraftId: id(3), expectedAttemptRevision: 2 }
        : { kind: 'VERSION' as const, npcUuid: id(10), version: 1 };
    const request = session.begin(id(20), target, reference);
    if (refused)
      assert.equal(
        session.accept({
          ...request,
          messageType: 'network.npc-art.refusal',
          code: 'NOT_AVAILABLE',
        }),
        'REFUSED',
      );
    return { session, projection: d.value, view: npcControlPresentation(d.value, state, session) };
  }
  it.each([false, true])(
    'library selection remains usable with delayed/refused read=%s',
    async (refused) => {
      const f = fixture('NPC-001', refused),
        selected: (string | null)[] = [];
      assert(f.view.formId === 'NPC-001');
      await render(L.NpcLibraryContent, {
        presentation: f.view.presentation,
        onSelect: (value) => selected.push(value),
      });
      assert.equal(container.querySelectorAll('img').length, 0);
      assert.equal(container.querySelectorAll('input[type=radio]').length, 3);
      assert(!present(container.textContent).includes('Изображение отсутствует'));
      assert(
        present(container.textContent).includes(
          refused ? 'Изображение НПС недоступно.' : 'Изображение НПС загружается',
        ),
      );
      await flush(() => query<HTMLInputElement>('article input[type=radio]').click());
      assert.deepEqual(selected, [id(10)]);
      assert.deepEqual(f.view.presentation.state, state);
      f.session.dispose();
    },
  );
  it.each([false, true])(
    'identity edits and art clear remain usable with delayed/refused read=%s',
    async (refused) => {
      const f = fixture('NPC-002', refused);
      assert(f.view.formId === 'NPC-002');
      const q = idProps(f.view.presentation);
      await render(E.NpcIdentityFields, q.props);
      assert.equal(query<HTMLFieldSetElement>('fieldset').disabled, false);
      await change(labelled('Имя НПС'), 'Новое имя');
      assert.deepEqual(last(q.calls).name, V('Новое имя'));
      await click('Убрать изображение');
      assert.deepEqual(last(q.arts), [f.view.presentation.bindingKey, { kind: 'CLEAR' }]);
      assert.equal(container.querySelectorAll('img').length, 0);
      assert(!present(container.textContent).includes('Изображение отсутствует'));
      assert.deepEqual(f.view.presentation.state, state);
      f.session.dispose();
    },
  );
  it.each(['LOADING', 'UNAVAILABLE'] as const)(
    'full saved sheet and final validation remain visible while portrait is %s',
    async (status) => {
      const art = { ...reference, status };
      await render(L.NpcSheetContent, { sheet: { ...sheet, artOrNull: art } });
      for (const key of Object.keys(NPC_FULL_SHEET_FIELDS))
        assert(present(container.textContent).includes('host-' + key));
      assert.equal(container.querySelectorAll('img').length, 0);
      assert(!present(container.textContent).includes('Изображение отсутствует'));
      await render(L.NpcFinalReviewContent, {
        presentation: {
          ...finalView,
          previewOrNull: { ...present(finalView.previewOrNull), artOrNull: art },
        },
      });
      assert(present(container.textContent).includes('Ожидает явного сохранения'));
      for (const key of Object.keys(NPC_FULL_SHEET_FIELDS))
        assert(present(container.textContent).includes('host-' + key));
      assert.equal(container.querySelectorAll('img').length, 0);
    },
  );
});

describe('NPC poison controls respect current local control state', () => {
  for (const guard of ['readOnly', 'pending', 'dirty', 'localEditDirty'] as const)
    it(`blocks mode, carrier, coating and removal while ${guard}, keeping saved facts visible`, async () => {
      const sourceInstanceId = '00000000-0000-4000-8000-000000000081';
      const targetItemInstanceId = '00000000-0000-4000-8000-000000000082';
      const coatingInstanceId = '00000000-0000-4000-8000-000000000083';
      const onMode = vi.fn(),
        onSubmit = vi.fn(),
        onRemove = vi.fn();
      const mode: NpcInitialStatePresentation = {
        ...initialStateView,
        state,
        poisonModeStates: [
          {
            sourceInstanceId,
            modeFactId: coatingInstanceId,
            sourceLabel: 'Прежний Тайпан',
            poisonProfileId: 'POI-TAIPAN-PARALYTIC',
            explanation: 'Сохранённый режим без переключения',
            derivedRows: [
              { label: 'Исходный режим', value: 'Паралитический яд из сохранённого факта' },
            ],
          },
        ],
        poisonModePreparations: [
          {
            capabilityKey: 'current-new-mode',
            sourceInstanceId,
            sourceLabel: 'Новый Тайпан',
            profileChoices: [{ value: 'POI-TAIPAN-DEADLY', label: 'Смертельный' }],
            input: { poisonProfileId: V('POI-TAIPAN-DEADLY'), reason: V('Явно выбранный режим') },
            canSubmit: true,
            errors: {},
            explanation: 'Предложенный исходный режим',
            derivedRows: [],
          },
        ],
      };
      await render(NpcPoisonModeFields, { presentation: mode, onSubmit: onMode });
      const modeButton = () =>
        present(
          [...container.querySelectorAll('button')].find(
            (b) => b.textContent === 'Задать исходный режим яда',
          ),
        );
      assert(!modeButton().matches(':disabled'));
      await render(NpcPoisonModeFields, {
        presentation: { ...mode, state: { ...state, [guard]: true } },
        onSubmit: onMode,
      });
      assert(labelled('Вид исходного яда').matches(':disabled'));
      assert(labelled('Причина исходного режима яда').matches(':disabled'));
      assert(modeButton().matches(':disabled'));
      await click('Задать исходный режим яда');
      assert.equal(onMode.mock.calls.length, 0);
      assert.match(container.textContent ?? '', /Паралитический яд из сохранённого факта/);
      assert.match(container.textContent ?? '', /Сохранённый режим без переключения/);
      await render(NpcPoisonModeFields, { presentation: mode, onSubmit: onMode });
      await click('Задать исходный режим яда');
      assert.deepEqual(onMode.mock.calls, [
        [
          {
            capabilityKey: 'current-new-mode',
            sourceInstanceId,
            poisonProfileId: 'POI-TAIPAN-DEADLY',
            reason: 'Явно выбранный режим',
          },
        ],
      ]);

      const coating: NpcInventoryPresentation = {
        ...inventory,
        state,
        poisonCoatingPreparations: [
          {
            capabilityKey: 'current-carrier',
            sourceInstanceId,
            sourceLabel: 'Тайпан',
            targetItemInstanceId,
            targetLabel: 'Меч',
            surfaceLabel: 'Режущая кромка',
            replacesCoatingIdOrNull: null,
            input: {
              surfaceConfirmed: V(true),
              replaceConfirmed: V(false),
              reason: V('Явная подготовка'),
            },
            canSubmit: true,
            errors: {},
            explanation: 'Подготовленная доза без атаки',
            derivedRows: [{ label: 'Источник', value: 'Текущий Тайпан L2' }],
          },
        ],
        poisonCoatings: [
          {
            capabilityKey: 'current-removal',
            coatingInstanceId,
            targetItemInstanceId: '00000000-0000-4000-8000-000000000084',
            targetLabel: 'Другой меч',
            canRemove: true,
            errors: [],
            explanation: 'Сохранённая доза не расходуется повторно',
            derivedRows: [{ label: 'Сила', value: 'FROZEN L3 из подтверждённого источника' }],
          },
        ],
      };
      await render(NpcPoisonCoatingFields, { presentation: coating, onSubmit, onRemove });
      await change(labelled('Источник яда и предмет для покрытия'), 'current-carrier');
      await change(labelled('Причина снятия покрытия'), 'Явное снятие');
      for (const button of container.querySelectorAll('button'))
        assert(!button.matches(':disabled'));
      await render(NpcPoisonCoatingFields, {
        presentation: { ...coating, state: { ...state, [guard]: true } },
        onSubmit,
        onRemove,
      });
      const controls = container.querySelectorAll('select,input,textarea,button');
      assert(controls.length > 0);
      for (const control of controls) assert(control.matches(':disabled'));
      await click('Подготовить покрытие');
      await click('Снять покрытие');
      assert.equal(onSubmit.mock.calls.length, 0);
      assert.equal(onRemove.mock.calls.length, 0);
      assert.match(container.textContent ?? '', /FROZEN L3 из подтверждённого источника/);
      assert.match(container.textContent ?? '', /Сохранённая доза не расходуется повторно/);
      assert.match(container.textContent ?? '', /Текущий Тайпан L2/);
      await render(NpcPoisonCoatingFields, { presentation: coating, onSubmit, onRemove });
      await click('Подготовить покрытие');
      await click('Снять покрытие');
      assert.deepEqual(onSubmit.mock.calls, [
        [
          {
            capabilityKey: 'current-carrier',
            sourceInstanceId,
            targetItemInstanceId,
            surfaceConfirmed: true,
            replacesCoatingIdOrNull: null,
            replaceConfirmed: false,
            reason: 'Явная подготовка',
          },
        ],
      ]);
      assert.deepEqual(onRemove.mock.calls, [
        [
          {
            capabilityKey: 'current-removal',
            coatingInstanceId,
            reason: 'Явное снятие',
          },
        ],
      ]);
    });
});
