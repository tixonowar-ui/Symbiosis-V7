import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.9 objects, authorized by #208 and ADR 0075. */
// Intersecting witnesses include the accepted NPC time/import amendment in ADR 0078.
// Intersecting witnesses include the accepted normal-transfer source amendment in ADR 0079.
// Intersecting witnesses include the accepted frozen-recovery source amendment in ADR 0080.
// Intersecting witnesses include the accepted initial NPC trauma source amendment in ADR 0081.
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
    id: 'NET-009',
    sha256: 'ea3b7fb49f7ccfdbf2196f1480f27fe846b2bef89d73fb6f8d9d4c0e801039bb',
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
    sha256: '49967269ebad7d06f85e28da6ad4b8f564c4831957f7120511c7738fb7f68883',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-HOST-PUBLISH-SETTINGS',
    sha256: '5ec5300e107e11358b0c3db8e4e092f9e65b860b2bd9ae5a4debbdf7adf56023',
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
    sha256: 'ac558316349496594e4fa933b980288cfacf259e3b3d0ba08037aa8135c52551',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-009',
    sha256: '644185be1d3db11ff50f24158ae1ba3aebd5a5905c94f16b970421d3bb2b4567',
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
    sha256: 'e779f1bb2ee5d51724c470454dd16bb27878e0f37e1af54cfdf3ff165d9a4111',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-055',
    sha256: '351fe4331eed729a67eabd12d33bd98e97fb9ad51639030c58eabbfd00a3b74a',
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
    sha256: '6caf5d80dedc0ec96dc45f1f0bf07ee70aa2d202734e3f6ed191bbcfdce680cb',
  },
  {
    key: 'transitions',
    sha256: '76d2cf3f7b0e93adaffd28e06efc23883ff19863c023c8530ef003a92abf5c6c',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NET-009 —',
    sha256: '69634fd03bccb4236933317970653433e804d593fae0884190403171f6649bbd',
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
    sha256: '9fdce05998ad3cbed4c0c7eff834ad47da4b2f8a4b71f9cbd3b297a4b11be48f',
  },
  {
    prefix: '### J-HOST-PUBLISH-SETTINGS —',
    sha256: '0a19c33bab85b7ec26e9df2510d1a54d08e8f56cf63f58b48adcf9a669059243',
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
    sha256: '846b8025a23789276d38d4595f075e302bbe33b8b3d0847ec200da9428d9b1df',
  },
  {
    prefix: '| QA-FORM-NET-009 | NET-009 |',
    sha256: '34cc5f4ce904d6a14584ab49bfab5ea29b4c2d3453c72ab48161d3f2b05290ff',
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
    sha256: '385a1979cbcedbbb66a9f34a6383cc44e5dd58a086d5f86df0a6f6bf844c50c8',
  },
  {
    prefix: '| QA-REQ-055 | REQ-055 |',
    sha256: '0ba6e842dc2febff9e0163291ccf7e77550dbe451ced829fcb0cbcb23488b1fb',
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
