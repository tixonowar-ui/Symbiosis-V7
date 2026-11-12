import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.14 objects, authorized by #228 / ADR 0081. */
// Intersecting witnesses include the accepted NPC source consequences in ADR 0082.
// Intersecting witnesses include the accepted fresh Trogr source clarification in ADR 0083.
// Intersecting witnesses include the accepted custom item source clarification in ADR 0084.
// Intersecting witnesses include the accepted initial life source clarification in ADR 0085.
// Intersecting witnesses include the accepted formal Weaver source clarification in ADR 0086.
// Intersecting witnesses include the accepted initial poison source clarification in ADR 0087.
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-003',
    sha256: 'aa06928072f3e89c3a48e7d425bca2f419ed4bb9ea419d8c7f740693575a8ff1',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-007',
    sha256: '36eb8da04cc6a67206bf258d03d93f45c890251e27523411d03fef05b572cb23',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-016',
    sha256: '8b1d355b679f4e40b045829ced1209964bce13b585eb01e44b6402e6b675eb89',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-017',
    sha256: '5234b8c871cae4a73a716cc93033c0cffb91caca4f403756a73746fbf5f76595',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-NPC-CREATE',
    sha256: '5e0306eb339f59460b509b1e4c30ea2a2d8103634c076f9ebac7a0cc5c8c9b6d',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-011',
    sha256: '5b272cfcc132fa52e8c9fe4e862b98e6738f9d730a9373d324f1b56044645c1d',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: 'a4dd2fe694307a11ff2357bd5d586e2cdecf102b98f450907ca132100ed48cab',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-003',
    sha256: '02d03c8d5f9ce024629873e4522f7b1798a25ed120baa5e37ccf133231745379',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-003',
    sha256: 'c147db5f94c17e45458a3bfc664fd34196875006a96067e4d179153e2a8c0a13',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-007',
    sha256: '547b1278c052ee71c838d794bbce00241fd053c5cab468af7f1d1c30f6aba81d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-007',
    sha256: '31b1c1a768482976fccb6a4eb7e13808f237f0564f60f8fc02a26397dbd425a5',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-016',
    sha256: '33232931edfe075435d4dc1705cbad5d9e261cbf05f8d5fbb167b47abd1ca919',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-016',
    sha256: 'a0e0dbf387cd0e426c589c30d8119e3a863e58b8eebd06cee538e375581f4a4a',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-017',
    sha256: '2012fadb55b2b63b7cf941ac696be4d81b7c05978df899046bdfbb593e7eb481',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-017',
    sha256: '5e4c44866d5f9f41c0718da8eaeeb4e9ad321fd11b745569f3e9dab36bb80fee',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-011',
    sha256: '70e61bb6ce3939fc7c896ab851cc64b986996107df59ef56cf60512b3a9fc4f9',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-012',
    sha256: 'c7db451e65bde6bc11e84b90d82cb6de04af48e2bc79a70808b0ad2d4742e5ea',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1',
    sha256: 'b5b75c41bd9997b12bf1688af1af28c7f133eda797379f1886e7eabf8abd5333',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION',
    sha256: '28d03db1f112e088f470dee411e0d7f149f698524194866124859c5139a84c2e',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-COMMIT-V1',
    sha256: 'e1049067a25c070aee1b6a39c1a570e7d6fd6a4d185efb59a3f6d7e68d2ff17b',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: 'ff52bdc3797d53dfc5ae7231e94ac7704a72f939e21862ec733e3649d50505b4',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'GM-014',
    sha256: 'a7a24349c93e3acfffbb3217e6fd2772cb040766cb1d8cd50255139c1f5b4911',
  },
] as const;
const ROOT_SEALS = [
  {
    key: 'counts',
    sha256: '6caf5d80dedc0ec96dc45f1f0bf07ee70aa2d202734e3f6ed191bbcfdce680cb',
  },
  {
    key: 'transitions',
    sha256: '76d2cf3f7b0e93adaffd28e06efc23883ff19863c023c8530ef003a92abf5c6c',
  },
  {
    // ADR 0092 / #284 changes only the intersecting SENTIENT PATCH witness.
    // ADR0094 / #288 changes only intersecting ENM017 PATCH/NEW-VERSION witnesses.
    key: 'registryCoverage',
    sha256: 'd7ec2e4d9d8f4bbb1d969bb829486f536d2e4420bb28648a13d540e0168cfcb7',
  },
  {
    key: 'globalContracts',
    sha256: '30ef0ac22392b9bb908a80f34572a600d0dca85cd1ff7d62cdf4c6b49df4af44',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NPC-003 —',
    sha256: '5130987e275f906db131baf69d9812af15a125ad796a1d0d77b4e850a685aeba',
  },
  {
    prefix: '### NPC-007 —',
    sha256: 'b6a34b02a2ffa4bc31071b67b62147795c747f4d13316473c81850606bbe6e3a',
  },
  {
    prefix: '### NPC-016 —',
    sha256: 'a54e81c0018b63992c2469873f9454c895dd6e9f553e992de86b844b137bc496',
  },
  {
    prefix: '### NPC-017 —',
    sha256: 'aa07f8f6aa425554783c2ca2c6fbdd822100f97154e75b4ca084cf5de33703ca',
  },
  {
    prefix: '### J-NPC-CREATE —',
    sha256: '102fd9983c20bf0c3fb08af1b45018a0e9ab5797e26e774f63ff7ec4638acaad',
  },
  {
    prefix: '### GM-014 —',
    sha256: '4fa51b4fa90564bcf429b87a77233433e736f57d4d42d16535fcdcfb78c758a4',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-011 |',
    sha256: 'c9ec7117688b3bc4b4debb4a573e5ca931c8550d2e8edd84027506619d8584e0',
  },
  {
    prefix: '| REQ-012 |',
    sha256: '8af775bf3fc80473a38e5a2e3dee4006c396d9cc5f38cced750841e810772a2f',
  },
  {
    prefix: '| QA-FORM-NPC-003 |',
    sha256: '2b1b458c6f6b149a2f7f331528ca73289a18069a12f289d0df8caac199d0ec66',
  },
  {
    prefix: '| QA-CHANGE-NPC-003 |',
    sha256: '269e4f8b0ea304f7b073d14a968fc541e8315923e8dad26c81d3bfd9af2ae44a',
  },
  {
    prefix: '| QA-FORM-NPC-007 |',
    sha256: '86928fc91da065dd7fab60096e74f7906dfaf2ec9ca1a400909961e3dde77aac',
  },
  {
    prefix: '| QA-CHANGE-NPC-007 |',
    sha256: '825250d9e7832223ae4c6e0e95337fb94f2b41c508117dcda9945b51b37d63ca',
  },
  {
    prefix: '| QA-FORM-NPC-016 |',
    sha256: '40b2b2c0555e1c66722aaa22f8b4e249a92b5e59817a9500328f2ddc3b29f64a',
  },
  {
    prefix: '| QA-CHANGE-NPC-016 |',
    sha256: 'ba968613efb1edc85c4e3cc0ca78b3595fa86513e05b295b543dec51b97ca7ff',
  },
  {
    prefix: '| QA-FORM-NPC-017 |',
    sha256: '6b0feac8bf9134fa16e959550383998d131958abd7283fc3ae4577bacc7a7afe',
  },
  {
    prefix: '| QA-CHANGE-NPC-017 |',
    sha256: 'd2f595920fc41b9d198aef3a0b3ca8ad1436ca6f970b8696545d14a3a8a4c374',
  },
  {
    prefix: '| QA-REQ-011 |',
    sha256: '6d0fe0919a86d9fb807148b6b99a9dd60a2c702553457b00d38870f16a7acf91',
  },
  {
    prefix: '| QA-REQ-012 |',
    sha256: 'b32f693cfaa1c0693a8586bbfa90ffbe14b649a3ab98f50307c3d8901989e838',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1 |',
    sha256: '575513bf127f191df767f9a2c9e1590acb0f3c32ec5fa708f467e3663294d335',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
    sha256: '8533f4aae3b857d9dc5cdea346f46bce1f143e3ada07589536a410326b0fa7d5',
  },
  {
    prefix: '| UI-CMD-NPC-COMMIT-V1 | Атомарно сохранить первую версию постоянного НПС |',
    sha256: 'caba549f282d55092eddd3008d8724a5a411e71a422a867fcebd2620d4f4c626',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: '3c7b8c88cac6f133881337c95998b8fdb4f62237165c4e07af80f5516df0ec2b',
  },
] as const;
const WHERE = 'atlas ADR 0081';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(object)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(object[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? '<undefined>';
}
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function check(value: string, expected: string, label: string): void {
  if (digest(value) !== expected)
    fail(WHERE, label + ' differs from the approved initial NPC trauma source contract');
}

/** Whole objects include authority, fields, draft variants and both local route mirrors. */
export function assertAdr0081InitialTrauma(root: JsonObject): void {
  for (const seal of ROOT_SEALS) check(canonical(root[seal.key]), seal.sha256, seal.key);
  for (const seal of OBJECT_SEALS) {
    const container =
      seal.target === 'workflowCommands'
        ? asObject(root['registryCoverage'], WHERE, 'registryCoverage')
        : root;
    const matches = asArray(container[seal.target], WHERE, seal.target)
      .map((value) => asObject(value, WHERE, seal.target))
      .filter((row) => row[seal.key] === seal.id);
    if (matches.length !== 1) fail(WHERE, seal.id + ' must occur exactly once');
    check(canonical(matches[0]), seal.sha256, seal.id);
  }
}

/** Normalize transport line endings only; source punctuation and table escaping remain normative. */
export function assertAdr0081InitialTraumaMarkdown(input: string): void {
  const markdown = input.replaceAll('\r\n', '\n');
  for (const seal of MARKDOWN_SECTIONS) {
    const start = markdown.indexOf(seal.prefix);
    if (start < 0 || markdown.indexOf(seal.prefix, start + seal.prefix.length) >= 0)
      fail(WHERE, seal.prefix + ' must occur exactly once');
    const end = Math.min(
      ...[
        markdown.indexOf('\n### ', start + seal.prefix.length),
        markdown.indexOf('\n## ', start + seal.prefix.length),
        markdown.length,
      ].filter((value) => value >= 0),
    );
    check(markdown.slice(start, end), seal.sha256, seal.prefix);
  }
  const rows = markdown.split('\n');
  for (const seal of MARKDOWN_LINES) {
    const matches = rows.filter((row) => row.startsWith(seal.prefix));
    if (matches.length !== 1) fail(WHERE, seal.prefix + ' must occur exactly once');
    check(matches[0]!, seal.sha256, seal.prefix);
  }
}
