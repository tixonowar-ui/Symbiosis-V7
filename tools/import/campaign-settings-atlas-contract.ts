import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.9 objects, authorized by #208 and ADR 0075. */
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NET-009',
    sha256: '56b038287c05198a4bd7112ce1423e4a6c8ec2e5ca27cfe3a08270e1a95df905',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'CMP-006',
    sha256: '35c4b902dc81530c480842beb94b976b6c3ba5bad406b55dba482dd40d084ea9',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'CMP-007',
    sha256: '2f50972c30ad61e2dbc5f2902588dda68b0376a37a1881afe52100ccf3a88e65',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'CMP-008',
    sha256: 'c0b304dced72f846552644ddd1b529ac8d954f5a478bc80384a6b7c5360b1578',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-CAMPAIGN-LIFECYCLE',
    sha256: 'aea8e59e3100015ae14367e94eaf08cade8ff7fa7958fa9a90e8309752a35681',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-RECONNECT',
    sha256: '5ffd0b1dcdc4495995693f61130b66c40cae1352ecbe4850a26834a2a414dc85',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-HOST-PUBLISH-SETTINGS',
    sha256: 'c47e9023095feb62be359bf9aae0226e95da285c32fe376cb37731fd98b13352',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-008',
    sha256: '4943ceef53ee2cafd6d87ebc8b5cf86f8dde7615e033d081708801cb79085eca',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-055',
    sha256: '923f7b7d34c5127942e82e12ed6713c4bfef1fc13656c60976da4dd5eb0a5836',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-009',
    sha256: '59fb3906540994024d40958c51c55561068c9870e46c0ec2d550c9e5b47b2ee0',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-CMP-006',
    sha256: 'dc5959213eede32c0bfeb94abf240e268eeb3d723c2b347a7e5cb7d744787589',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-CMP-007',
    sha256: '437288d5250f2dc355f8d344447c2572af310282e87cea113d7ce0bdb2c9163b',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-CMP-008',
    sha256: 'a8e9dfee0e8f14da5c11118d444817fa0e803874c4ff5d5b5c3d4a5b8e32f545',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-007',
    sha256: '3f86f033aa81d555b47fbce279aa5ab5fe2dfcce6d3f462885e4d2b78e2f9441',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-008',
    sha256: 'cfc7d01bf9f99f901f2744a17a4506dd47198fc51d91d761622ceffa3e36517d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-031',
    sha256: '6806722493d9335c6d1a6438fdff1ef89dde47a44f60daaa34875b9c1d799224',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-055',
    sha256: 'ff5764c6b7469c41fa29b56960ef3c3778b5ca945753a4b86a12c2dc8c7c469c',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-CAMPAIGN-SETTINGS-SET',
    sha256: '32bb93f1d41d2f55253e0fa8895ab6dd17413b65b1f7385e06ee1c9c794a1f58',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-CAMPAIGN-SETTINGS-SET',
    sha256: '47769f507fffd16a04e77f998f21a6d623202a1dcd8e3d8245855eb8b047a651',
  },
] as const;
const ROOT_SEALS = [
  {
    key: 'counts',
    sha256: '54b6e3b18dd158c04150627167fc92ebac52bc8d517bc657049eaf7883fc2fd8',
  },
  {
    key: 'transitions',
    sha256: '06f993f58a72306651ded752b876e63e97fc46a291df44524247d890af6c882f',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NET-009 —',
    sha256: '11f7aa012863423c47db8de81ac9d1012a0df7cfd40c323e0ef5a6c8250b9d50',
  },
  {
    prefix: '### CMP-006 —',
    sha256: '671a8c1f6d95d67effdf170f2656486bae95a4e040866302a549baa37306b0ba',
  },
  {
    prefix: '### CMP-007 —',
    sha256: '29714b94b83d539bf7d440d406aef54b61e657844f501bd7e4bb376128b49a61',
  },
  {
    prefix: '### CMP-008 —',
    sha256: '31856cd2d64ca388f6f57fe30ea058a32bf4ba05a1c190558c4a0710cbf4a297',
  },
  {
    prefix: '### J-CAMPAIGN-LIFECYCLE —',
    sha256: '9aee0d73b8e9dac60036cd132223cdb466de7f47547e3b5f006c6d05ab6a666c',
  },
  {
    prefix: '### J-RECONNECT —',
    sha256: 'cd173bc7f2c52fb797c4d9f711a07f6f5763a2e5efd6a433083542c553b75c04',
  },
  {
    prefix: '### J-HOST-PUBLISH-SETTINGS —',
    sha256: '723d00bed95a1cb009cebb5b21453b097ed631d46bb88d045c31b658d0f2eab0',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-008 | Пауза, checkpoint, состав, завершение и immutable archive |',
    sha256: '627ac6e92eaaa42f0306567dce3184c41ca28721238ee58fc00a4145663adf66',
  },
  {
    prefix:
      '| REQ-055 | Самостоятельная обязательная ветвь: Host/port/QR, capacity, permitted campaign settings и disconnect client |',
    sha256: '099c49643e1659f103c03eda53be1cbdfa68a633868e54d485808b6caa95b19c',
  },
  {
    prefix: '| QA-FORM-NET-009 | NET-009 |',
    sha256: 'f579c4837dc98cf714506dc1fcffd6de639fa109db9f38b2512ab4d2cbb6e6c1',
  },
  {
    prefix: '| QA-FORM-CMP-006 | CMP-006 |',
    sha256: 'e534a8dedf3dcae62772ec90bea20eb857e671924f3e6a8b0995f0b21d9bb054',
  },
  {
    prefix: '| QA-FORM-CMP-007 | CMP-007 |',
    sha256: '721cc837055c278590f6d6e051bba630fd3680cb3a5bb6133196d71d69c4383c',
  },
  {
    prefix: '| QA-FORM-CMP-008 | CMP-008 |',
    sha256: '453ff3f2f989ec5c9301c920a2fad91f25104bd228af0fb5505db26409a989ae',
  },
  {
    prefix: '| QA-REQ-007 | REQ-007 |',
    sha256: '20c11296b2b1de34927adbb37baef3654b99ce6d4dd9d60777e2a1c69a7f0ae3',
  },
  {
    prefix: '| QA-REQ-008 | REQ-008 |',
    sha256: 'e358e8af408077e01bfbc409a50586ad943fa99e44f638c2fe6dea1330edeb98',
  },
  {
    prefix: '| QA-REQ-031 | REQ-031 |',
    sha256: 'b3658c0e1153357658fd0d4245ca8cde58dc110d98ecc5a2735f0ffcb56a4ec8',
  },
  {
    prefix: '| QA-REQ-055 | REQ-055 |',
    sha256: 'e0ed28975cc3f86fbcb3e91c3b6eda029009812a853a67af1758e685452bdf40',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-CAMPAIGN-SETTINGS-SET | UI-CMD-CAMPAIGN-SETTINGS-SET |',
    sha256: '6db38199f7d355db787931066ce39c8bec3d9d40e44f2f9f181789ee10f9f8fd',
  },
  {
    prefix: '| UI-CMD-CAMPAIGN-SETTINGS-SET | Сохранить безопасные настройки кампании |',
    sha256: '00c290d89bb1a6adbd824430544a322aeaaf5d9d5fa348c86f8bed10a05f4d81',
  },
] as const;
const WHERE = 'atlas ADR 0075';

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
    fail(WHERE, label + ' differs from the approved campaign settings contract');
}

/** Whole objects include authority, fields, draft variants and both local route mirrors. */
export function assertAdr0075CampaignSettings(root: JsonObject): void {
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
export function assertAdr0075CampaignSettingsMarkdown(input: string): void {
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
