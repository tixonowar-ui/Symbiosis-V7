import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.14 objects, authorized by #228 / ADR 0081. */
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-003',
    sha256: 'ef5e8a33d082e599e93542a0e6ea48322fe4d9790005ae9b176ba9110d26718d',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-007',
    sha256: '29635bcc369add6538bdefec7d2127d23e9da890f270550d9c2a861f329b5070',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-016',
    sha256: '1a0677035735da2eb14aac66433a8b8e0e9c93ef099124ec79fb1572d31da6b1',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-017',
    sha256: 'e3855c80eda754608bb46dbd1ffe107be0f21114a9051ab1a47d3bdac5dd89d9',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-NPC-CREATE',
    sha256: 'f6120979ae14952fc419736a6356626aadd0aa5863fade0d10a52bbda79e8200',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-011',
    sha256: '162db3b81c614d9a1d77750f54a418b0311cb847cdd7920f664b5a2a791e626c',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: 'c1af0f0de034946fb3d730693fcbf0aa2dfe98e37e1ff5dbbc9386345f5688b7',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-003',
    sha256: '3fad213c7aa15de53ac71b91c70f6a74d0177218d6759ea411b0d70285ed9f93',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-003',
    sha256: '254f3597c3a1b29a8f01c72dbb74271e3c09583a9292b7d539b20f87b709856e',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-007',
    sha256: '4b4662675a222174717e2f5a2814ddc7fec1b4e1b9620e7dd02b83990205c064',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-007',
    sha256: '90534d68b0f0f2884e012dbfbf2e6f46bacffd243e8d02d9a2f4be6c26145ed7',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-016',
    sha256: '9c0f9df966023f0eb0ecbc220d9aba059a6caffc27053710f9e450018411bb8f',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-016',
    sha256: '5299b63c293963b9809773b3190db1810f628416bde434b6aab7f73828654b8d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-017',
    sha256: 'e1965bad7adde582a7785ddfb4a70e75eee290297dcda23487e5a1ba34c5dcce',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-017',
    sha256: '96e31aac722a85e13549a3b312ca7f86cac594c326d8583bee8a1a7f88431e47',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-011',
    sha256: 'f534f62076ad2389eccfc53f2e8c1b71c6957671f67b1c1f6f9d6c4789e98501',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-012',
    sha256: '5ed4616028dc6c72113fa7b725ca062f3397038e799cc89325344612624b8492',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1',
    sha256: '82d8fe6bdc32cdd47a11f3451403faafd8111e7db868a8c9c409d960a27b8d58',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION',
    sha256: '68417879d4aadb3df8d9ddd09a0d391ad425bb89c8e99884b8311f04b7e89ec0',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-COMMIT-V1',
    sha256: '18db12c1451d221821c094e5b055c83014e56fa91839c371bc56ee6af98563ac',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: 'ef6559268765d8173548889474663ff29a6fa98ebba6a03c5322bc478603ae38',
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
    sha256: '5c3348120a086133d0d54e204ccf3de10df4da2a42c5ea2c3c5a99149db8fad0',
  },
  {
    key: 'registryCoverage',
    sha256: 'c57cfa3010320a34d15b0f07d205e8bacbbf80b5e9ba9f11c99b1f2d318e7366',
  },
  {
    key: 'globalContracts',
    sha256: '30ef0ac22392b9bb908a80f34572a600d0dca85cd1ff7d62cdf4c6b49df4af44',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NPC-003 —',
    sha256: '8b61cdb015bd2f0ff7ecbf7aa0bde5ab9f148efd2ea0692cd0e271d93cbd511e',
  },
  {
    prefix: '### NPC-007 —',
    sha256: '65865fae540ed57441422ef0c838992dbf74e7f66e87824bd24d4ccd8fbea93d',
  },
  {
    prefix: '### NPC-016 —',
    sha256: '20fd015ba4c6961c3bfbcd24dafafd7ada85ecd31aa0e785f43c5943ac5ab754',
  },
  {
    prefix: '### NPC-017 —',
    sha256: '03a9b44b49e00d3115585a0fafb4deb3d3addd2db570e119267c958c45d917a1',
  },
  {
    prefix: '### J-NPC-CREATE —',
    sha256: 'ce9883a3cbf255dff2ba1a7253611146700a3e9d9ede09844579e6ccb21b4a5a',
  },
  {
    prefix: '### GM-014 —',
    sha256: '4fa51b4fa90564bcf429b87a77233433e736f57d4d42d16535fcdcfb78c758a4',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-011 |',
    sha256: '7bfa401293e5bdd23d84bac23da4b6f3f3ab2b3cdd07fa9c01727092add11ddf',
  },
  {
    prefix: '| REQ-012 |',
    sha256: '9c9c4ebb00da267176d1413776f105529697eff2f777f0dbe508c8e7883b93d1',
  },
  {
    prefix: '| QA-FORM-NPC-003 |',
    sha256: '4546aad8bdc4b611237abeabb8c0998e355ed8c38eb74b5f77c6b82bfef7ce91',
  },
  {
    prefix: '| QA-CHANGE-NPC-003 |',
    sha256: '13180cde6657d7dde018705e899b01c531c0e4f2b54564ec6f40c40fd11f1b86',
  },
  {
    prefix: '| QA-FORM-NPC-007 |',
    sha256: 'f950f6a8a34632703e5193c4332ce30aa2fa2eaa398c926d284048d7b8e9f0dd',
  },
  {
    prefix: '| QA-CHANGE-NPC-007 |',
    sha256: '13fa7774d40c10f5c406d5a65f1212b0e7e3f29fe74719f0cb637fce83751cbe',
  },
  {
    prefix: '| QA-FORM-NPC-016 |',
    sha256: 'ef4519eb5ca408615f5337fcb8d94f40d1a635a90640266e217ce06621584f8a',
  },
  {
    prefix: '| QA-CHANGE-NPC-016 |',
    sha256: '25daada51caada66ec7cabee76fe22fab3de6ab6d5c1ea71209866e67e8c3817',
  },
  {
    prefix: '| QA-FORM-NPC-017 |',
    sha256: '002abf1cb6f2173d6f19a836d1df4fcb3ac57e3a3f7271decdbfa76772394661',
  },
  {
    prefix: '| QA-CHANGE-NPC-017 |',
    sha256: 'bfb5118e7c594c4c2a54c65a7c8a58fcd01426908e60ee6c776e6f03bb2cfeaa',
  },
  {
    prefix: '| QA-REQ-011 |',
    sha256: '3fb8a68b76b6a7a05b4afb2f5d7092b2ca7943f04182996389009c97e0ac8284',
  },
  {
    prefix: '| QA-REQ-012 |',
    sha256: 'f72e5595db9491a9fd545872a263f024681cf5135757e6787eafb820d8a806df',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1 |',
    sha256: '8fef7c1a1a8805f2d78cb834b31d1caf4fff049c436c84b36f5af63f622d804c',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
    sha256: '31ab3cd85bf64742f5afbfb52fdf36d352cb600d2f3ac5fdbbe8581b16ada66c',
  },
  {
    prefix: '| UI-CMD-NPC-COMMIT-V1 | Атомарно сохранить первую версию постоянного НПС |',
    sha256: '37f9d8f3d20f951a47ea61c107c2f33943bc6ac9e326bedeca2be06c744cdf6b',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: 'ad16462cddbcb63faf39f21867e764c7ebf03ef250f56f75453c3558f19c8dea',
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
