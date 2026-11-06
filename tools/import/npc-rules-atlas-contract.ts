import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.15 objects, authorized by #224/#226/#227/#232 / ADR 0082. */
// Intersecting witnesses include the accepted fresh Trogr source clarification in ADR 0083.
// Intersecting witnesses include the accepted custom item source clarification in ADR 0084.
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-003',
    sha256: '9d74aba980af6abb7e5c57aed109773260e046081b877d0ead3b86c53459957d',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-007',
    sha256: '70b99d0e7513b52be9fc1b805800f4199541bdd20be1785a9ac176e53a68a4ef',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-013',
    sha256: 'dfbcddaaa6cc41c81ad1f5dee69245c8d4241af90b90f76aebcaa8f35cb01e26',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-014',
    sha256: 'de2fb3c17806a7c53ebc5df381663e59dd77633574c7df283fd3a4639a2919ac',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-015',
    sha256: 'ac31c32acf591f06808c167057251ddcf6b1e8f23a1f53cd4cd4b9880231ec27',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-016',
    sha256: '873ec35af41e7b12f0ba4a83f33a4834b4d61f0afe8c3cffdda4042812454dc1',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-017',
    sha256: '12cd01c265451aed66cd8e9d7f560bba4955d37560368d6279ee7ec63f7d53e8',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-NPC-CREATE',
    sha256: 'ef2fee0c8cf75d0dce724b443c95e777c024c7a8dcbfe1a2c3480b2cb63d5986',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-011',
    sha256: 'c36d4bb600d3b9dae0de520265d72c5d9c2089436111cb3f1157bd7fa8adaa60',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: 'bdcf9f8227f5d4eabfae3a4e61bd4987ad8b7ac26fb82aba747ec87f6fbcb310',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-003',
    sha256: '56dffa0955938c488a86ebc215290424da9b637a7cdb393ab3eef962a8f7356c',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-003',
    sha256: 'eda8dfd1169e0c7170a7ee9c2a9aafb522a21fc4d3ee4ef0509c282432eb86f1',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-007',
    sha256: '5dd25965f6c34436687f0c45663425983f1622208eb99e88624e22a67a8e4c31',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-007',
    sha256: '1e851b55999fc760e21e16556fca1842fc5a4dbfd30cdd68f60c31ab65ec13d0',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-013',
    sha256: '86c3c2b458fb53ca596dd2d90a67a6711fdce061ed42b31b498ed006424603fa',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-013',
    sha256: '54aa91b99dc0f89985970ec870fec47f9f4b6a7c73b12e3b27a8c5316049f0ea',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-014',
    sha256: '552e661f4c4e09d0492fc76237ea04cffa1adbb45765eb7f4b905bd7770514ea',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-014',
    sha256: '7da9166161b1e7ef196b7fa8cb65dd64b33ba9aca1d52e664a15af4266c3c2ee',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-015',
    sha256: '8c945b60e59212638cfe699d04fbc6944256d26c51de19bd8df16d9032623d1a',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-015',
    sha256: '7d169d4aec3f4153b5a01c53a319bb01846225989ee26f5ab919e9c1ed47d3ea',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-016',
    sha256: 'be6aecb1fb06c63214c988ca69fcac6b96039311dab8602a5dfe7012ff411ff6',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-016',
    sha256: '62d1d24a91f2c50dcde0d11743b3361a1d628cbc847dc881a62ac4eec1b567c1',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-017',
    sha256: 'e1e8b225a326267bdad6aacf1389a34c353b951d07f00effcff4ba019c9cb698',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-017',
    sha256: 'cf21605b8d3cb8085bfa5f185ef984045ebd3e7c39072eb5c7da2bff1793192a',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-011',
    sha256: '3b161a3333ec236eeb052fcebdc47be4dda0cfeb4f49cccf742001553d9c27f0',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-012',
    sha256: '85ded72be22eab38952bfeaf379d2df8f7c2ca039c4f909ef90f3ea26db34a44',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1',
    sha256: 'e77475a88f762fe68e67c02e9b03f2cc6cadd54204c8f59b1d031313a8a817ed',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION',
    sha256: 'f98b42acc7c82d3ede56e8eefb5e1b43f9de0298d10407e6b9e8f5508270cbb0',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-COMMIT-V1',
    sha256: '70a4a1c5807b9474f8d71e8b4a3af52a9f22bb0f532f5408ff620d3c8859e64a',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: '06bfae017b94e8fc8e8bf9355e66cf1f7a22c0ca8af65a2775f0540c70cac3ab',
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
    sha256: 'f3869b71e58597b08c93237cc3293476b118b3be0022de41214638707b957678',
  },
  {
    key: 'registryCoverage',
    sha256: '84f0b172c4c63e32407dea4642a166cdfef83729e7e4db151d5a37b5c2669260',
  },
  {
    key: 'globalContracts',
    sha256: '30ef0ac22392b9bb908a80f34572a600d0dca85cd1ff7d62cdf4c6b49df4af44',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NPC-003 —',
    sha256: 'ad07462c4cbcb2ad7e7561d6ad71297c63cd615570d40eb3da53320478286a0a',
  },
  {
    prefix: '### NPC-007 —',
    sha256: '94d8dedd331b5e9d15645a5259bb6e0fb6e2e0b6b1542d52433433d62874cb50',
  },
  {
    prefix: '### NPC-013 —',
    sha256: '0bebf76e17ac8ea3fe6f65e412e029463500effbb0bf5bcfdaace0adb951d803',
  },
  {
    prefix: '### NPC-014 —',
    sha256: 'f0aaea84df25006e087eeb8c04e3c9b06edd0360973c0820170018f353d9f2fc',
  },
  {
    prefix: '### NPC-015 —',
    sha256: 'bd8afb2587f8c0d1338c963b93ff74690d36d3271be4368bd7002bcce13c6a51',
  },
  {
    prefix: '### NPC-016 —',
    sha256: 'eeb31feb535dc85d7808d50e27c447c963820dbfd41f9edc4fcfb8bc16f63b83',
  },
  {
    prefix: '### NPC-017 —',
    sha256: '1e3db0fda4268019781710f2f5260c9f786ac9dfb9a9f0b1ae87419424dbe476',
  },
  {
    prefix: '### J-NPC-CREATE —',
    sha256: '7bc2fb4207600bae1bcf84a778b7a01a252615241ba4cc412ee14429d2dc73c4',
  },
  {
    prefix: '### GM-014 —',
    sha256: '4fa51b4fa90564bcf429b87a77233433e736f57d4d42d16535fcdcfb78c758a4',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-011 |',
    sha256: 'bc30550ec397f2cba9c5d2534f4fb61891a4d387951e8b33478918bc14f97f3e',
  },
  {
    prefix: '| REQ-012 |',
    sha256: 'b977f439a924092178f9d17ef4a98184963028cd5fdce8f6c7b4766bd29e00d6',
  },
  {
    prefix: '| QA-FORM-NPC-003 |',
    sha256: 'a584118675cd5229030084c9cbc16c44709eac747aed3a09259953d18ec4b75b',
  },
  {
    prefix: '| QA-CHANGE-NPC-003 |',
    sha256: 'abdc3c04f479f19e8cdc97432d8095acf77da009a46b5cb8463433814386f0c8',
  },
  {
    prefix: '| QA-FORM-NPC-007 |',
    sha256: 'a1e5db1f06220a257069ec377abb6a6f186eeab09d4f615015049240593771b3',
  },
  {
    prefix: '| QA-CHANGE-NPC-007 |',
    sha256: '353930ddd08403a08aeff1ed936108be758ed61d895278b7bb58248621a8fbd2',
  },
  {
    prefix: '| QA-FORM-NPC-013 |',
    sha256: 'adf721966f22c8972b3eca4042b6cdc5d5ed819416994f2c19514ce4b36cf9f7',
  },
  {
    prefix: '| QA-CHANGE-NPC-013 |',
    sha256: '7f1ad151b5ce76b5b07c441e646032bfc0bd9ca5ceab151b1732c1d4c979bd8a',
  },
  {
    prefix: '| QA-FORM-NPC-014 |',
    sha256: '788ccdd83b428d76be1f50ce11ac47827b0eac78992c061412160c6d26b0d356',
  },
  {
    prefix: '| QA-CHANGE-NPC-014 |',
    sha256: '81620729b205f0eef446679a34ed68d99de4092926f1df257343c96ea19413e5',
  },
  {
    prefix: '| QA-FORM-NPC-015 |',
    sha256: '921102f9278084ea84abd637589421b2ac4a4e3d5ea9350a304de7eac7658569',
  },
  {
    prefix: '| QA-CHANGE-NPC-015 |',
    sha256: 'f70bf210673307915c7df3cb0d91b7337d1fd61ead5e56883e6793700e33f3f8',
  },
  {
    prefix: '| QA-FORM-NPC-016 |',
    sha256: '74599eec6376f6445ea8a6420ca90c095e0f39dd31b21beb91abf25ab8d994db',
  },
  {
    prefix: '| QA-CHANGE-NPC-016 |',
    sha256: '893c804ac63c3e109c295143367ba6d85d6335b22fc578c55a8965ad0668befd',
  },
  {
    prefix: '| QA-FORM-NPC-017 |',
    sha256: '852fdea5e859e2a38a479fa0168f50ab81b6cb103fc4becee22c3b4cb27751ed',
  },
  {
    prefix: '| QA-CHANGE-NPC-017 |',
    sha256: 'e4e5aa41360a508a54ba697db299bc77635f7ee6c0ed4874bc28bd98ee205b5d',
  },
  {
    prefix: '| QA-REQ-011 |',
    sha256: '2882d11aa09b84b3101cae495972950fea0f57c08d1eefabd866187ccaf3becd',
  },
  {
    prefix: '| QA-REQ-012 |',
    sha256: '8bb1e068862876c2cf0067c49e4f8c25c60e8320d81a8a77b6762ba78d6b0e5a',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1 |',
    sha256: 'd41a98d9317ff77fbdbf117fc2b7609c7a9f76da914ab8e9070368d73e6b940c',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
    sha256: '143dfc96be23b8580f059991ec4e3f4e3130109b5f9eddd36bbb8d4623d2d4c9',
  },
  {
    prefix: '| UI-CMD-NPC-COMMIT-V1 | Атомарно сохранить первую версию постоянного НПС |',
    sha256: '8e301b3d944fe9835b6b535ccb821a74e7bb3a38d98780beb9f4bd1b53bdbef5',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: '779294513d0ed96a7f5bcc3b97f42214250f57250d0b7124eced8111d4ae7950',
  },
] as const;
const WHERE = 'atlas ADR 0082';

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
    fail(WHERE, label + ' differs from the approved NPC source consequences contract');
}

/** Whole objects include authority, fields, draft variants and both local route mirrors. */
export function assertAdr0082NpcRules(root: JsonObject): void {
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
export function assertAdr0082NpcRulesMarkdown(input: string): void {
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
