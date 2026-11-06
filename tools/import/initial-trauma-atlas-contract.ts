import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.14 objects, authorized by #228 / ADR 0081. */
// Intersecting witnesses include the accepted NPC source consequences in ADR 0082.
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-003',
    sha256: '2e4dae8b9824f00b5ac4e6be49f2fcd49d031f20c6787be24fe9b1010ccf1380',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-007',
    sha256: '65dce1a13d430f59f55cf27cbf29245defba3eb29dcca238e2278bd11d3f99c8',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-016',
    sha256: '6365a7959dc15e889477662f2ef7e3481efa73c8a0fb3b6d5ea5fc7ab8ec0d15',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-017',
    sha256: 'f4c7f07addd72f0d2d6a5eeb9c6d15f43078bb45ed9498aa3f645f87e53316cd',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-NPC-CREATE',
    sha256: '7a4facd61a479f90b5a62a1180601ad5a475d537890a3cc086d9cb43477beb21',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-011',
    sha256: '960809d92345795f0595a399bc5cfb15fdd868d4dd5c14f69a8b57448eee3ca9',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: '067781bfe4d9d39e91aaa2e6295a1782a237af0933da7fb4e8e76a243e8c8de1',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-003',
    sha256: 'dfe53b03af1469f8bd48eacb9c23610fc3ddd5cced8ec7b3bb94ef3b364198d8',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-003',
    sha256: 'deed6798d64c9d32cdb5d8dd25df09bfa9b851d110cc49cdeeda914681b84a1d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-007',
    sha256: '5f613f41c290a04c12d20e0bd1417900a383c4666428f2f6d8d53ac0baac0115',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-007',
    sha256: 'eb642fbe9dc7e4a395066895a269eb48fbe6a5768fe4b6a8dd7eba9cbd892ed7',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-016',
    sha256: '421a5da01e61db0e503d0c57e5706020d9a1dde15353004c557f0556649efe77',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-016',
    sha256: '0ca8b2d4bd700397109ae5b798132d4b0f3aa2b72d977be9af6be9fa4928de11',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-017',
    sha256: '71982f4ce0f1be0aaf88eacda91a1b76edc82e17739c6e0ba172b17c479168d8',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-017',
    sha256: 'c31381f6d65da8120a981873ba0eda108d19895a3e639c8ca709e56855853604',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-011',
    sha256: '0cd73ff6ace86aba2a74815177379f79b477f638c81b8021bbb4199704aa1bd1',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-012',
    sha256: '51c2cb4b2ce4d51e13e576ae3d320b3c5c439cf710ff63a15a9f62b8d76543f7',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1',
    sha256: '9d4d378cbb3c1db21438f8ce20013c7be691eae55a0d584e836822c80cf090a8',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION',
    sha256: '621007bc9423a042cfb827272972e30a94da1a93c6ad7fbe61a54aa0fd881db5',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-COMMIT-V1',
    sha256: 'e1e7d2bee7c71fd1c4f0780311975c773d7bcccb206623906b3bb4c026080c1f',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: '865280bf7115961dae9e15b06d9497e25eab2edeb85161b498b3a9fdf49c677a',
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
    sha256: '3ba27fd45599e0af62d2e585bf47dd2677ef308eeec6261cbeca5341fb4d0473',
  },
  {
    key: 'registryCoverage',
    sha256: 'b6f7f5e05d0e5f144ca3c43343a6d4d11bbb623fd019243751aa435c3f6ce5b4',
  },
  {
    key: 'globalContracts',
    sha256: '30ef0ac22392b9bb908a80f34572a600d0dca85cd1ff7d62cdf4c6b49df4af44',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NPC-003 —',
    sha256: '29df0e03dc1479f23a8b04dcc4bb0f80f5c89283959e379db78bfa3b49b9936a',
  },
  {
    prefix: '### NPC-007 —',
    sha256: '1f97efce900d05d233a5713b95e06042a65cc76c74a3ba0b72f503b0195d553f',
  },
  {
    prefix: '### NPC-016 —',
    sha256: 'b394929f70fc58b757ec38b293acf2c5bc0fe7e6ab6bb48c7cac4c3128f55188',
  },
  {
    prefix: '### NPC-017 —',
    sha256: '81f23ef3cce3fe588b78218e4fcc730e07fe3810a565595dda86f92ac9124a40',
  },
  {
    prefix: '### J-NPC-CREATE —',
    sha256: '0f6f989cf498b51c46d44ce868320a19cd02d9bc9daf617435fd59b4debd7227',
  },
  {
    prefix: '### GM-014 —',
    sha256: '4fa51b4fa90564bcf429b87a77233433e736f57d4d42d16535fcdcfb78c758a4',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-011 |',
    sha256: 'a7a54e7ce747e295929110dfc389e955087fb88e3bfe8737098ab5cffe1b32b4',
  },
  {
    prefix: '| REQ-012 |',
    sha256: '5ef03f15c61e2b6fa7af87df8518a825692e19023739716b2c6bc079dd2e7f28',
  },
  {
    prefix: '| QA-FORM-NPC-003 |',
    sha256: '484f089c609ac67d6a814ec0294e74fd60d12a332874b2c4f1f70c69f9426fe2',
  },
  {
    prefix: '| QA-CHANGE-NPC-003 |',
    sha256: 'f098e8a983ea434306f7a3beb24416ae8948cca960990d3d5d54aa5065649b27',
  },
  {
    prefix: '| QA-FORM-NPC-007 |',
    sha256: '641f84bb105fa61b238748c045d17bc2de1efcd816ee0c5ae889504cbb1c48b8',
  },
  {
    prefix: '| QA-CHANGE-NPC-007 |',
    sha256: 'bc289bfb6fe3716822111e35b6dd4f4c351684354582eba421505379ee881203',
  },
  {
    prefix: '| QA-FORM-NPC-016 |',
    sha256: '91f49d74fc35280abdcdbea7ad5aff2937f93bd1f3deeed27e86642e1de5dc26',
  },
  {
    prefix: '| QA-CHANGE-NPC-016 |',
    sha256: '32993eee7543e583502effabd2ae63159eb8ab21aab3419be3a4c47f71936d72',
  },
  {
    prefix: '| QA-FORM-NPC-017 |',
    sha256: '703b40b6d84e11b42a1d7ab14754a442b3685022e62e6f4896a32eec3963a1c9',
  },
  {
    prefix: '| QA-CHANGE-NPC-017 |',
    sha256: '3700e4d34eb570c922851ae2e8c2920d488d93950f5cdd881f0b7da58f0358cd',
  },
  {
    prefix: '| QA-REQ-011 |',
    sha256: 'f7c50ee9c582a6ccac0ab504f124d9212abb186b74934739eb902235e7e31394',
  },
  {
    prefix: '| QA-REQ-012 |',
    sha256: '73238d7c8176eabdd9f96eac45a2eacfad3ded000323060ab345ecd5e6bfaeda',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1 |',
    sha256: 'd47726f1dac90e81fe91fa904264db3a727f808d960f237548cf065c3b9a161a',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
    sha256: 'd68f0a7ad21b7feef778192b88c1d0a9044ece947d5f3a734d681e51dfc602ec',
  },
  {
    prefix: '| UI-CMD-NPC-COMMIT-V1 | Атомарно сохранить первую версию постоянного НПС |',
    sha256: '3f9d1e7889d7b8e747fad81fbd4471a0e8da92f01141822e8ef0b4ec08aaea53',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: 'a69162e5cc9b15fc58f7104deac30b776dc7d78c8290161778bd4b94c19b1196',
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
