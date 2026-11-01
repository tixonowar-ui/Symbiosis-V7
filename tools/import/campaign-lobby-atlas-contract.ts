import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.8 objects, authorized by #206 and ADR 0073. */
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NET-006',
    sha256: '1b5a0bf1340a9cc7eb5235402f9646d9fbceacc6b0b4352a86f3e6dc7925b939',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-016',
    sha256: '9e3a3e326232c43b8d98930907a341353219ddfdf8a2b940d0dd434028990e36',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'CMP-007',
    sha256: '816d125b27a675119399a0656f9377ee406631618adb9745c4d3895b1a464ee4',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'PLY-001',
    sha256: '85ab67627d8b1e2f8da1dc1133337673e017e01deab5e70a6fce6578fcd0d412',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'GRP-001',
    sha256: 'b7e3fe87ec1700cdca22ae3adfc94a4e983901d023799d1116a7875a627f6656',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'GM-001',
    sha256: '111b79e4ea1068d8e0ca18bad797803a18923295eaaf2528a3e390807c82736b',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-JOIN-REVIEW',
    sha256: 'a003a0ce46d4ad35594bf8e7a3ea85fb67baef51ba8ed4f0b5ac49e7e587cc8c',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-CAMPAIGN-CREATE',
    sha256: 'ae992e5dff5091fbb60d055db4d7b9e3bda734d5e0b25a68c3bc059a48427115',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-HOST-PUBLISH-SETTINGS',
    sha256: '9dbf5a84f29aab54de0f276202a8784136f8d28901b90c55f5de991d477e5a73',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-004',
    sha256: '5c7db3c10982159dbafcf89b576ac704f3f58acc6f3d96e988ba5b01505f82c1',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-009',
    sha256: '64a1b8f79c92a5b66f34ee164b7b36675ccdf5ed0832d75eb6025e2d22cad143',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-055',
    sha256: 'f12b53da4b98b8a2e0859bfce163da7bf985e468dfae8c7ad988ceb201aa9de2',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-006',
    sha256: 'ee0c9a9bab7fbddc766469825e6bd673c1f5c60b2c12dda91182cb17346fb102',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-016',
    sha256: '0fc87d6d5fffd8e1508af0c5bd60a4f59bd5ef6d4055223373e2c8a248f26923',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-CMP-007',
    sha256: '16d36a75d4b51b6db1c969ee52b9c264370dde3a39562decd91fc1420e45b665',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-PLY-001',
    sha256: 'bc290e3dfcf49f0f1bdee593a1ad272235dafc084edef880abd233fa71c2803c',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-GRP-001',
    sha256: '1828e1e8f91ea6e39886402f0832db7631a3a0626ca9577c23389d6aca03d900',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-GM-001',
    sha256: '1d4683c9a5d699c021539cf5ecec47c7889769e4175bf1ab9cbf9c5cb198d032',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-004',
    sha256: '777cba2548337654782f8df1c163009637c53e4200c0d5ee7de80b10731df79e',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-055',
    sha256: 'ea47883d0a3e7c68d468bbb28076a5365e6309a45512fbcfa983045637d29d91',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-CAMPAIGN-START',
    sha256: '4cd1038f8e0aff371064f1ce3fec6295c9c7b253f4617fcd2e6f578cc289dbae',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-CAMPAIGN-READY-SET',
    sha256: '5c11a78f5c5ff8922394cbea59bf4acf20e9c0808f98f85c6485c8ebe4f7a2b2',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
    sha256: 'afcc173abd7e9d58b228ed3a04a02d6f1878da1f088038fba8530fe56738956a',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-CAMPAIGN-START',
    sha256: 'da38269aa41f26eed3e7a1736763fa5362b4b5f6f1d338a4960f62237babc7cd',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-CAMPAIGN-READY-SET',
    sha256: '8d9c7d00683f4f29915e4cd09fc43260116e8d7ad548b935434dfce6828900e5',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
    sha256: '7588e897957e22b6a2775e480d6380fdaaff2165eea2410a40aa1156b0f02974',
  },
] as const;
const ROOT_SEALS = [
  {
    key: 'counts',
    sha256: '6a2a702f05d67702304a1406013121cc7a43377d86fc061a49002988f87860e3',
  },
  {
    key: 'transitions',
    sha256: '251214fea1268480ad7f42cf6452d10390364a4c8737a0114b615a0434a35a4a',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NET-006 —',
    sha256: 'c1dbb888574a721d3558ab00f54f14309337912905b78224495f80fafc304f1e',
  },
  {
    prefix: '### NET-016 —',
    sha256: '594c5af2f66192dc785a0df62982a1142de7422b3bd1af749ffae45d99af36c5',
  },
  {
    prefix: '### CMP-007 —',
    sha256: '22c9a3e3da89309601cbff3a1fd6ac42a86a659fa0076ea24cb73c408f711a4e',
  },
  {
    prefix: '### PLY-001 —',
    sha256: '3875b197c9be67b0daafe1334fbdee24df5d07d598e7dd193e3b9ce1fe12ee21',
  },
  {
    prefix: '### GRP-001 —',
    sha256: 'd8833ea8d41b281198454949a70df320d4c9fc5cbf3785349a400c527b9035bf',
  },
  {
    prefix: '### GM-001 —',
    sha256: 'fe1f060372f4043d3b9be05b170deb968da512e9ac01be457bec41e49413aa8a',
  },
  {
    prefix: '### J-JOIN-REVIEW —',
    sha256: '40a8a8824dd7ff70993b07c495fad7c01e7cf84da24a34db872a3735916c8655',
  },
  {
    prefix: '### J-CAMPAIGN-CREATE —',
    sha256: '5aa77d2a987f70971e558a65cc3632c074d2a278f53fd2e426aedcc71cf69c85',
  },
  {
    prefix: '### J-HOST-PUBLISH-SETTINGS —',
    sha256: 'efa13345d3715a690299a3a16bf4370016ce1838c9f58dd1c611e98c3e2f1b32',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-004 | Подключение игрока к кампании |',
    sha256: 'd3ec96be40d1c9a7b60a6a22f68ae53878cf6ffed303dd323bae6342864a5eae',
  },
  {
    prefix:
      '| REQ-009 | 0–3 local players, вход из активной мирной/боевой сцены и отдельная GM-tab только на host |',
    sha256: 'ef40a043e091d8a9e6e0233a0f0573853e489e47e7403ce774083722c75f5eda',
  },
  {
    prefix:
      '| REQ-055 | Самостоятельная обязательная ветвь: Host/port/QR, capacity, permitted campaign settings и disconnect client |',
    sha256: 'ab00979636ad0921d5a9ddcc33be5abe6a4a71fe7c12d31d1cd59219b7cd332b',
  },
  {
    prefix: '| QA-FORM-NET-006 | NET-006 |',
    sha256: 'a8e522c66e36c114061118d058a78432970bbc8f5201944963f720002b878b1c',
  },
  {
    prefix: '| QA-FORM-NET-016 | NET-016 |',
    sha256: '0c7a410526206d753eca1aff626d8a126e92d07cdb653ea9fb6b18c2d245cf7b',
  },
  {
    prefix: '| QA-FORM-CMP-007 | CMP-007 |',
    sha256: 'dd5368da1d00d29c62fde4239e45518705f4058322d5e36c394d975c3eebe915',
  },
  {
    prefix: '| QA-FORM-PLY-001 | PLY-001 |',
    sha256: '63075f4598f05f4a18fbbf17fe760639add57ecc7626f39758ee1db0d8029ff4',
  },
  {
    prefix: '| QA-FORM-GRP-001 | GRP-001 |',
    sha256: '3a5d1e09d3c299865add1c5dc609a22abc6367ec5eb283e537c1baecb65f79e0',
  },
  {
    prefix: '| QA-FORM-GM-001 | GM-001 |',
    sha256: '66fac60551655ae81b0dc8fe8e46951f60c2167bdf4787d10c698b4012c15c1d',
  },
  {
    prefix: '| QA-REQ-004 | REQ-004 |',
    sha256: '1267dc962affa7ba7cb67890c6103e306b0c56f28c43091e72c578f9fa626f11',
  },
  {
    prefix: '| QA-REQ-055 | REQ-055 |',
    sha256: 'f6f4a9b67ea3cfde26f046dea7348fe399a926d6e3ca855a1c507d2d9ef5f4f4',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-CAMPAIGN-START | UI-CMD-CAMPAIGN-START |',
    sha256: '5a0d4444ad05dc036e26141acb23cc9022445f4568ab56e5e1a3c5a9db879ae2',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-CAMPAIGN-READY-SET | UI-CMD-CAMPAIGN-READY-SET |',
    sha256: 'e7a0d050edb91b3dd65fe07fb7cbf6dcad792e009f3cc9c7e9cb86868e5446b2',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-CAMPAIGN-INITIAL-TIME-SET | UI-CMD-CAMPAIGN-INITIAL-TIME-SET |',
    sha256: '266caff06f46cdb8175e0b7c2048ff4c3a3922efeb273af8de863f7ed0a78da7',
  },
  {
    prefix: '| UI-CMD-CAMPAIGN-START | Запустить подготовленную кампанию |',
    sha256: '090a01e9252a4703722acc298fbada37e265b53db6632e85c88fa65dc45ad3dc',
  },
  {
    prefix:
      '| UI-CMD-CAMPAIGN-READY-SET | Подтвердить или отменить готовность своего ACTIVE-набора |',
    sha256: '28244907f9be0bda3968b50271047ad1e78e5b2297001a32dbe9b12e9d86e805',
  },
  {
    prefix: '| UI-CMD-CAMPAIGN-INITIAL-TIME-SET | Сохранить начальное виртуальное время кампании |',
    sha256: 'c8f60f06f00346234236b79961312ec0c8da80a13dae78bf42a1718e08c7da5b',
  },
] as const;
const WHERE = 'atlas ADR 0073';

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
    fail(WHERE, label + ' differs from the approved lobby/Start contract');
}

/** Whole objects include authority, fields, draft variants and both local route mirrors. */
export function assertAdr0073LobbyStart(root: JsonObject): void {
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
export function assertAdr0073LobbyStartMarkdown(input: string): void {
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
