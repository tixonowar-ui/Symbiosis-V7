import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.8 objects, authorized by #206 and ADR 0073. */
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NET-006',
    sha256: '3cda0d6a4e536f146eb65f182bba2b4541f4f5fbbc05f5db9ccea8c50f128208',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-016',
    sha256: '9bff79e1f862ba9adce745e95094d969266a22f24b4f28b18b7f04183010eb22',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'CMP-006',
    sha256: 'a5d5520c38da3eba9dc9f19011abf466d17fe5de49c4067325997ccfaa9639d0',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'CMP-007',
    sha256: '9d3872aedf3adc1625c054f23b52d21eaa8477a2c14f94bdc8ac80f734336400',
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
    sha256: 'a0ef300a6b243d5a9fb03fed6f7efa184c3f38270963b33315dff8ef29c52376',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-JOIN-REVIEW',
    sha256: '67a8c2f7e590c27abd1492f5c69272fb26a6d3f8794a6a3a626f8a7b6ddac77e',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-CAMPAIGN-CREATE',
    sha256: '9580c813049257fc11a6275eb55aea69584f458e5342e02ad5394b43d026c51a',
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
    id: 'REQ-007',
    sha256: '2f62bb81eec48b0a894a2fa347d0219b8a5338d7daad777180f54996c2915d2c',
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
    sha256: '0d50e1bc2e5b73b951490762838a25c66837b9252292da6bbeb0b6c2d77e0e6b',
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
    sha256: '84c2beae810c803e6e3966d94cf69f0da7027de1f035bde2c98b1e219b47e747',
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
    sha256: '4e9b1b502cea861c630031861ff0c46690ca3f13897b739b393129a10a770d38',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-CAMPAIGN-READY-SET',
    sha256: 'f5e4e77ad0e07cca5e4ebf7a50f118b4dbebc8e59e654d6bfdd39e9270962d4c',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-CAMPAIGN-INITIAL-TIME-SET',
    sha256: 'd53635ba70a91d4f6cfba6663479cb13617eed1cd7f56dc877f4a35e27c1bab0',
  },
] as const;
const ROOT_SEALS = [
  {
    key: 'counts',
    sha256: 'fe6e06c3698c1413714789a6d2c24220467c816897e37b7812713024f6b6c97e',
  },
  {
    key: 'transitions',
    sha256: 'baf51cb230695e0edd72e553ed2a1e67a8e0dfdd02c579a6bcefd250f2ba2bbd',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NET-006 —',
    sha256: '9a6451ee0457601034797f0225e61a526e0d0f0a5e4719002cfe4299e253cdd7',
  },
  {
    prefix: '### NET-016 —',
    sha256: 'd5dcf25c260b57ac4c84e5b9afd4cf873b2f6ef957722372dfa88f252539f3c6',
  },
  {
    prefix: '### CMP-006 —',
    sha256: '885670269a42298d9ffa45a2bc3e1eabfd02a829aceaea38132ef6cc5a230f9c',
  },
  {
    prefix: '### CMP-007 —',
    sha256: '8664dd196c8a7ca9d6301bc579cfae8fffafeb16a25ad9ce825f1071c35e649b',
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
    sha256: 'da0063f55f0a96514bbc2744e2a5884e0899098395d0f871c436cd3995eca574',
  },
  {
    prefix: '### J-JOIN-REVIEW —',
    sha256: '413aebb71d6652a693388b6d288e6afc6e399b5b58cbd5d266646defdf2b60d2',
  },
  {
    prefix: '### J-CAMPAIGN-CREATE —',
    sha256: 'd6d11a3b90fde3748163eac1957b92c2ed4fda03c9f6bd937a945c5b243f630f',
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
    prefix: '| REQ-007 | Создание/host/preflight/start кампании без выбора правил |',
    sha256: 'ee99fec108d4bc4dab0e700773016b2e4eae94760bebf68b2ccffc57bd57ec3e',
  },
  {
    prefix:
      '| REQ-009 | 0–3 local players, вход из активной мирной/боевой сцены и отдельная GM-tab только на host |',
    sha256: 'ef40a043e091d8a9e6e0233a0f0573853e489e47e7403ce774083722c75f5eda',
  },
  {
    prefix:
      '| REQ-055 | Самостоятельная обязательная ветвь: Host/port/QR, capacity, permitted campaign settings и disconnect client |',
    sha256: 'c97d56f36f532d63debfd230aa87715d317c61393d7a4ae964dd6ceafd295780',
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
    sha256: '437b687445d3ed57a1959b43db484a54ee0c068743328719b15247dbfff7fa1f',
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
    sha256: '5b9a3cd18a50f86ab8857a7cb9eebb421087d943f256bfc5c82ff8eceec17b5c',
  },
  {
    prefix:
      '| UI-CMD-CAMPAIGN-READY-SET | Подтвердить или отменить готовность своего ACTIVE-набора |',
    sha256: '5d0ac86fd5b1bcf8aea9445f135604c45a7032d44424014829f2437d010159b2',
  },
  {
    prefix: '| UI-CMD-CAMPAIGN-INITIAL-TIME-SET | Сохранить начальное виртуальное время кампании |',
    sha256: 'e8b38f0c0eae30bb0e24840d2406c2892413fdceb9030adccbb755c44db74ef4',
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
