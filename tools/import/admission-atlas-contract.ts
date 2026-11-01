import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact admission objects from ADR 0071; overlapping lobby fields updated by #206 / ADR 0073. */
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'APP-002',
    sha256: 'af0f79172f6043c5b4a9e81f2b34b516e1966209bac6de7a6a3f26b9c8d18e13',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-003',
    sha256: 'b72d15abed1dbca729e4663327d99882094fc5167843712d2fac008b2d9093d8',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-005',
    sha256: '25a84b55052fd17885fb99b25c2fd02daa5bcb2da8dbdb014689785aa774113c',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-006',
    sha256: '1b5a0bf1340a9cc7eb5235402f9646d9fbceacc6b0b4352a86f3e6dc7925b939',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-007',
    sha256: '67a3ff95c8f4d4fa0cb37e9666cba71a98c9274bee10cc06ef5d10d033c2132c',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-027',
    sha256: '931da0f2e3b1d028f24ddcd97f5f8e7eb451898c2f136d83944ae32a89674a6d',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-017',
    sha256: 'b70e547cb4203cbb402daa3ffff2454a557f405d290fec987ad59b56ec2362a8',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-018',
    sha256: 'dd058f0a28e9cf23fd2715640fb22a70b249077c8e4832d26ebf9626c69eba77',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-019',
    sha256: '678e7e6fbf39b424296ed6985b6637e160569ff4a90993678bf577439f3fe966',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-020',
    sha256: '4cf6540b8f4ed6625e3d133719c78f29d7734df06a5c4e55d3d95c204ab2bfc5',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-021',
    sha256: '6ac2b7a915e478cb4f8b33661f11e681e61aee77a276c1917a22ea98bfca742e',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-022',
    sha256: 'e34e0fd710b373122a7b35db8d1c90305e691f4da4e0ac9fc44c7704c5550603',
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
    id: 'PLY-030',
    sha256: 'c93d07345cecc582615d9bb5f448ad1247b09f40fe39be0c97ca1afa90640282',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'GM-019',
    sha256: '954794e345490519d8fc4a72191853101fa785f4a1763c206572f9caf5460b9f',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'GM-020',
    sha256: 'b069e93cbddfdad1d5896c4a0916270da6ad199ce102b84e4b3fc6276c881843',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'GM-021',
    sha256: 'ba0d80537cd6e79c702eb79828c41eac7f96095c72fd88babd42a6fd962c1a7d',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-JOIN-REVIEW',
    sha256: 'a003a0ce46d4ad35594bf8e7a3ea85fb67baef51ba8ed4f0b5ac49e7e587cc8c',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-005',
    sha256: 'da6e8aa199d9bbd46c7bf82a95cc35984ee056e1095762fdb9601d7393274bef',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-006',
    sha256: '6b4c8166d3bcff95861b87b4e1567d7c5f5b7d5e594bced96798c139a19baad9',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-010',
    sha256: '4bfa7b10e7c02e9d721ff843c33284dbcb7289eafa2a17d44d109a46672b0c12',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-021',
    sha256: 'f12abbd444f59f37c1d58f87aae25cab965542ae354441e418147e814ff3b1d2',
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
    id: 'QA-FORM-NET-007',
    sha256: '4e6b3d616bf051867955287298c75e91201d1ed1d8040a1e28e0e240af358d8e',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-027',
    sha256: 'e717d306c78ebecf3dfa07c8d6e808704301c5a69614a69a5bbf67859d7b34d4',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-017',
    sha256: '5f547af70d3267c7ff58b6ab11bcb4db4b9c3e7df3f935e3612acab5dfc55be0',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-018',
    sha256: '67744429103ac3567098a2b2041be043358a9f8589ff898109bd19528f097aad',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-019',
    sha256: 'aa38b9f1b846e31475f8c900f7b6be5f730535cf452a59b86b8146ac3a7821cb',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-020',
    sha256: '61d4bec8448c9f45d1723f11a280bbb92903a018f4c569833b283bd4246c2ed6',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-021',
    sha256: '4b620700e67acb7e0d44405574ecb01906af3e9575edda13812e2b8ecbe1ac79',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-022',
    sha256: '9f308407e443229fa11c4c8804f24788c126a12ba28f636f6d2bb1d0e20a4f48',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-GM-019',
    sha256: '7d76575fdfa57300184a6080031bcaf6b5da62224cc897990fe9fb3f795426dd',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-GM-020',
    sha256: '5e4ac38fcdd6f4abe88dc8c4456db2bf99b8a65b62eede7a84cf5e0cbc9d8a6f',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-005',
    sha256: '4a95e6fe23aa6c4880c38162cf0992a3c4a3e84aa89b930e9d5e202fe655b730',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-ADMISSION-PLAYER-DECIDE',
    sha256: '69a7266541eca326a9da2be522357f07cc9931cad105c77507fb03db89edab87',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
    sha256: '3faa99d04438e713c7c741e923560f9c65c02b70fccfcc00184752bf518aca44',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-ADMISSION-REVIEW-OPEN',
    sha256: 'd071deab540d21e31a48b79e131fe83e78b38ea6fca0e8bbaa1d9587501b9c42',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-ADMISSION-PLAYER-DECIDE',
    sha256: '112381d5ddb3c56e2570fc79047009b89fdbf769fa8ac09e365646f2ef33a77f',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-GM-WEAPON-REQUEST-RESOLVE',
    sha256: '187ccf570c43488aff556791508bd9ed67052ab627f2e62b48fa2467837c3124',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-ADMISSION-REVIEW-OPEN',
    sha256: 'd4602c47191e22da2e88b4c0444ebc2ec202c3abe59fe4306b0ba62b33facb6d',
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
    prefix: '### APP-002 —',
    sha256: '6b8d07191583c2e467b7c2a8b4e1b8c3578d9591db4577e40e148e74ba479207',
  },
  {
    prefix: '### NET-003 —',
    sha256: 'd887986e75119810dd94cb6713b2cda7acbc31c6087f1444d782e538194f4b64',
  },
  {
    prefix: '### NET-005 —',
    sha256: '38766a60d94ee321113cbed0749f8bbb9f941ad4d3fcd1084737251fefea45c6',
  },
  {
    prefix: '### NET-006 —',
    sha256: 'c1dbb888574a721d3558ab00f54f14309337912905b78224495f80fafc304f1e',
  },
  {
    prefix: '### NET-007 —',
    sha256: '609afb8173a70314c471b87792b07211cc61e1388010926bd2e777bd5d83eba2',
  },
  {
    prefix: '### NET-027 —',
    sha256: 'a2ccd32eaa50e32a05fc1cda18f139ed9a0961cd6387fd91621d56213494c3c9',
  },
  {
    prefix: '### NET-017 —',
    sha256: 'ca5e1d11051d6c8dee431255360d1f0ed3d643c8d39dd43312f2a0c66a129f9a',
  },
  {
    prefix: '### NET-018 —',
    sha256: 'e7b6b61e1e209b15ac939f184bdfb2ba8a1a4cab6afc389efe7005c8bd39103a',
  },
  {
    prefix: '### NET-019 —',
    sha256: '4ac450790787c5025c622b147c9fd04b303d52c724d799543006bc6022fcd6b0',
  },
  {
    prefix: '### NET-020 —',
    sha256: '95af73016ac060f39a1378e35aeb86b1b39864578b0ce4a76295e24d0220bafb',
  },
  {
    prefix: '### NET-021 —',
    sha256: '6e5eb3952b153e166dcc49ca4e8996fffd3f46dd718437059a4ad849565eb2f6',
  },
  {
    prefix: '### NET-022 —',
    sha256: '6f909dd5fcc8d8af3675c875b6a879a6a6dad3bd2e76e504bf95e2cdf779fc87',
  },
  {
    prefix: '### PLY-001 —',
    sha256: '3875b197c9be67b0daafe1334fbdee24df5d07d598e7dd193e3b9ce1fe12ee21',
  },
  {
    prefix: '### PLY-030 —',
    sha256: 'c92c86d42b3ff3d017796755460b909ff7d70fb3c39c8899fbf26988222d96e1',
  },
  {
    prefix: '### GM-019 —',
    sha256: 'a2a271e36b025a31f9d3116e6178ba2ffbf9d34d119235a755ce49569d9c0cef',
  },
  {
    prefix: '### GM-020 —',
    sha256: '96884eacb9d353fa2a7cb21645271d8e26df7c0e9e0b9de2ed7ecb1e8f8c358e',
  },
  {
    prefix: '### GM-021 —',
    sha256: '56a892c1fce1ba00f4b0bb48c1d41501e49b7a6df912e670f4326e7ebe8e7706',
  },
  {
    prefix: '### J-JOIN-REVIEW —',
    sha256: '40a8a8824dd7ff70993b07c495fad7c01e7cf84da24a34db872a3735916c8655',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-005 | GM review, campaign copy diff и атомарный AdmissionBatch |',
    sha256: 'd8332dc70b6b92cc0470371b158a8f64178560a5700fab47e8f3e737c52d43e9',
  },
  {
    prefix: '| REQ-006 | Master-import требует owner/device/seat link |',
    sha256: '5ee196f14d83f5c3c9a741ecf83e8962de3ef7226a6e2fa73581b6eabbac4b13',
  },
  {
    prefix: '| REQ-010 | Первоначальное заявление local player на host до player tab |',
    sha256: 'd43c4822fc780a48672e813443170ee5149f01c5b1909e07cf7a2cd7ec879ebd',
  },
  {
    prefix: '| REQ-021 | GM inventory give/remove/edit/weapon/story/repair/consumables |',
    sha256: 'ed68cab58adefd8455dd39b77ee53aeb1bcdf165609dded758a096f199c2ba0b',
  },
  {
    prefix: '| QA-FORM-NET-006 | NET-006 |',
    sha256: 'a8e522c66e36c114061118d058a78432970bbc8f5201944963f720002b878b1c',
  },
  {
    prefix: '| QA-FORM-NET-007 | NET-007 |',
    sha256: '7333a04434852b39ddf7de2a16137c2f90b599b2c20cc235db436492bda36a2e',
  },
  {
    prefix: '| QA-FORM-NET-027 | NET-027 |',
    sha256: '922da8afc4f76d7e1fc9b536cc6d35b770ad7ea070ad8c5cc65ec29e60fc1114',
  },
  {
    prefix: '| QA-FORM-NET-017 | NET-017 |',
    sha256: '60153299e34cfa4148d03f1143166cf0f392590593edb854b76b18afa18b155e',
  },
  {
    prefix: '| QA-FORM-NET-018 | NET-018 |',
    sha256: '95ee07a7d0f12d1098a6a8b8470cf7c623c902666116da86949b56e2df4ff2aa',
  },
  {
    prefix: '| QA-FORM-NET-019 | NET-019 |',
    sha256: 'e6fbbfdfc9419e0835afc04c555c70bded5c4a9a94b3c0cc6dceb5838b8553fe',
  },
  {
    prefix: '| QA-FORM-NET-020 | NET-020 |',
    sha256: '6a19f31d74ba5ae10cac4fc58b1df7cf774b432037075c5aec92395de2125bb8',
  },
  {
    prefix: '| QA-FORM-NET-021 | NET-021 |',
    sha256: '59495fdc09223d5c97ea61aa0c073715a273918c49637da9e524da66fa6946b8',
  },
  {
    prefix: '| QA-FORM-NET-022 | NET-022 |',
    sha256: '7ccc489e8c186646b0655dbb0fd2558482ac50d624bf8c73f746c1ecfc13ab63',
  },
  {
    prefix: '| QA-FORM-GM-019 | GM-019 |',
    sha256: 'a8c6fb7e93b4ad6b0043f2cdc3d0d2e7d0f116e4e6a2ae61fbe4ce3b4d349fa5',
  },
  {
    prefix: '| QA-FORM-GM-020 | GM-020 |',
    sha256: '9e0291016ce494cea89d1af36f8b0b3b0a0af8a68f0ac1c4a7edc87a63d3182a',
  },
  {
    prefix: '| QA-REQ-005 | REQ-005 |',
    sha256: '538731120d929cca85fadeb2221afbba0efcd093893aa47183d7261c4b6e1918',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-ADMISSION-PLAYER-DECIDE | UI-CMD-ADMISSION-PLAYER-DECIDE |',
    sha256: '01197f1d10bf4ef96c040a01037e8916284fda5838fdac0a290c49b009891351',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-GM-WEAPON-REQUEST-RESOLVE | UI-CMD-GM-WEAPON-REQUEST-RESOLVE |',
    sha256: 'c1e5af20d7ff2bce9a1f36bc736c526ec991f4017533b7de946956533de94784',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-ADMISSION-REVIEW-OPEN | UI-CMD-ADMISSION-REVIEW-OPEN |',
    sha256: '14309baec02e98922334ec17648a19d5d01c026f715d0b46139d60bc1336e7ab',
  },
  {
    prefix: '| UI-CMD-ADMISSION-PLAYER-DECIDE | Принять либо отклонить полный campaign-copy diff |',
    sha256: 'bd39689ddd1ba14bb306f410eacdf531436c1eb40a75cf6617d72b6d4e9a59e7',
  },
  {
    prefix:
      '| UI-CMD-GM-WEAPON-REQUEST-RESOLVE | Утвердить или типизированно переопределить оружейную заявку |',
    sha256: '8c182da1465df3a7fddd437ca71e2fd2cd97bffcc09551035826c7e425be8a90',
  },
  {
    prefix:
      '| UI-CMD-ADMISSION-REVIEW-OPEN | Открыть отдельные рабочие копии для рассмотрения допуска |',
    sha256: '4c4f37aa9ca977f3f5072f306b8d5d2cf551e0d2e1d68abe1e2384e1875394a5',
  },
] as const;
const WHERE = 'atlas ADR 0071';

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
    fail(WHERE, label + ' differs from the approved admission contract');
}

/** Whole objects include authority, fields, draft variants and both local route mirrors. */
export function assertAdr0071Admission(root: JsonObject): void {
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
export function assertAdr0071AdmissionMarkdown(input: string): void {
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
