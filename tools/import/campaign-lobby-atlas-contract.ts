import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.8 objects, authorized by #206 and ADR 0073. */
// Intersecting witnesses include the accepted NPC time/import amendment in ADR 0078.
// Intersecting witnesses include the accepted normal-transfer source amendment in ADR 0079.
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
    sha256: 'ef4090461c958c718888daf0a2be9b1b9af7a6927f773a0cab92955293f0d239',
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
    sha256: '910889c4e2e7a2935afc0c2149a007228a92476b8015764b2d91546f0affcdba',
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
    sha256: '5661011b8e9cf72ba525be378401fa258c7aadd1f0843b1b2934f08e36c7e446',
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
    sha256: 'ab1b20157b90b487dbdc76ba9dd0201c6d83985f343860e0997376ee43833f16',
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
    id: 'QA-FORM-NET-006',
    sha256: 'ee0c9a9bab7fbddc766469825e6bd673c1f5c60b2c12dda91182cb17346fb102',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-016',
    sha256: '2f31c4b548bc2210b50cb950c68ec38d4e9d2849592d5c39297445b20a8902b8',
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
    sha256: 'd53fbad47e4b6e2e55849386432aa2119c37fd747365b0b296b8ba753ebbeea4',
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
    sha256: '351fe4331eed729a67eabd12d33bd98e97fb9ad51639030c58eabbfd00a3b74a',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-CAMPAIGN-START',
    sha256: '6e78399dd454b5ce9e37a7f817a0565a002121dac8998e0b5548b5e463e84172',
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
    sha256: '73e2b42bd9ff3fc38110141eb27a300aca86f3f25407eed61446f2b38c7d2c7a',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-CAMPAIGN-START',
    sha256: '1a16ab92a7e3571c2681738114da765437cf5cb6468140582988fbfb27a52c2c',
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
    sha256: '2c9a1ae3bdb8023aa8a80530ec00533d7d3d678ed96c213ec8773ac5bb6d0d75',
  },
] as const;
const ROOT_SEALS = [
  {
    key: 'counts',
    sha256: '1824e006901903a81275a8562ec37560238dc9042f4d4588885b51f469ee7e7f',
  },
  {
    key: 'transitions',
    sha256: 'b076cda3f751ed503e635034d769ea179f4a20f6fdd5a654ad9dd0882c1ad15a',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NET-006 —',
    sha256: '9a6451ee0457601034797f0225e61a526e0d0f0a5e4719002cfe4299e253cdd7',
  },
  {
    prefix: '### NET-016 —',
    sha256: '48a4d637301563b4d6fc4d64480420975eca0f3d3b8cebc89fcda2e38bfbb8f8',
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
    prefix: '### PLY-001 —',
    sha256: '3875b197c9be67b0daafe1334fbdee24df5d07d598e7dd193e3b9ce1fe12ee21',
  },
  {
    prefix: '### GRP-001 —',
    sha256: 'd8833ea8d41b281198454949a70df320d4c9fc5cbf3785349a400c527b9035bf',
  },
  {
    prefix: '### GM-001 —',
    sha256: 'b6c68faa89e85692134963187c297caeb52b76662968ddd6e81c675130bebf23',
  },
  {
    prefix: '### J-JOIN-REVIEW —',
    sha256: '413aebb71d6652a693388b6d288e6afc6e399b5b58cbd5d266646defdf2b60d2',
  },
  {
    prefix: '### J-CAMPAIGN-CREATE —',
    sha256: 'ced4eff0f8ec279a85d42bfe5469a8320f9a90d7bb4749795468c989425b29e2',
  },
  {
    prefix: '### J-HOST-PUBLISH-SETTINGS —',
    sha256: '0a19c33bab85b7ec26e9df2510d1a54d08e8f56cf63f58b48adcf9a669059243',
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
    sha256: '7976e40c2b2d29c972d2873570006d217066d65778218a442375ffdd00e8b8da',
  },
  {
    prefix:
      '| REQ-055 | Самостоятельная обязательная ветвь: Host/port/QR, capacity, permitted campaign settings и disconnect client |',
    sha256: '846b8025a23789276d38d4595f075e302bbe33b8b3d0847ec200da9428d9b1df',
  },
  {
    prefix: '| QA-FORM-NET-006 | NET-006 |',
    sha256: 'a8e522c66e36c114061118d058a78432970bbc8f5201944963f720002b878b1c',
  },
  {
    prefix: '| QA-FORM-NET-016 | NET-016 |',
    sha256: '505b9868d4d8daf52381876cf5cff4fd0d94fd232323fb072bc272d978fd4a65',
  },
  {
    prefix: '| QA-FORM-CMP-007 | CMP-007 |',
    sha256: '721cc837055c278590f6d6e051bba630fd3680cb3a5bb6133196d71d69c4383c',
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
    sha256: 'b5b0098fdec542bed9b216cdc2e5bb1239ada5161b06d8db551534567491db4d',
  },
  {
    prefix: '| QA-REQ-004 | REQ-004 |',
    sha256: '1267dc962affa7ba7cb67890c6103e306b0c56f28c43091e72c578f9fa626f11',
  },
  {
    prefix: '| QA-REQ-055 | REQ-055 |',
    sha256: '0ba6e842dc2febff9e0163291ccf7e77550dbe451ced829fcb0cbcb23488b1fb',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-CAMPAIGN-START | UI-CMD-CAMPAIGN-START |',
    sha256: '02e716fb2aad9cfb230312b821df962b65cff07386113a8501483083a6d926f3',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-CAMPAIGN-READY-SET | UI-CMD-CAMPAIGN-READY-SET |',
    sha256: 'e7a0d050edb91b3dd65fe07fb7cbf6dcad792e009f3cc9c7e9cb86868e5446b2',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-CAMPAIGN-INITIAL-TIME-SET | UI-CMD-CAMPAIGN-INITIAL-TIME-SET |',
    sha256: '5ea239ee4919daf7e079e887f3fc1a17db20b8463c598b19ea331b2eb017b278',
  },
  {
    prefix: '| UI-CMD-CAMPAIGN-START | Запустить подготовленную кампанию |',
    sha256: '0910b58da01910739533b110ac5aad4bd0bb24e6bd4b7d0ae65984d4fa1f0bb8',
  },
  {
    prefix:
      '| UI-CMD-CAMPAIGN-READY-SET | Подтвердить или отменить готовность своего ACTIVE-набора |',
    sha256: '5d0ac86fd5b1bcf8aea9445f135604c45a7032d44424014829f2437d010159b2',
  },
  {
    prefix: '| UI-CMD-CAMPAIGN-INITIAL-TIME-SET | Сохранить начальное виртуальное время кампании |',
    sha256: '2ee310e42c08f3b25633b7d0449e8243c2816cb645aef8e3d5ec516d40478b5b',
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
