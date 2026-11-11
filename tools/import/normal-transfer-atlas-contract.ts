import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.12 objects, authorized by decisions 4–5 in #221 / ADR 0079. */
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
    id: 'APP-001',
    sha256: '50bd50d56b25d3e03378061434e5837c7085c4a5fa78c1cfd7139690bfc69e9e',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'APP-002',
    sha256: '7b7fd633ba5d9fc5ccb6eae526cd2c84cc854079f137bef295404d22da832aa5',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-008',
    sha256: 'ec99484348303d30fe77ee18956eb6bfcb35981b8d6d173650123a3391069a21',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-009',
    sha256: 'ea3b7fb49f7ccfdbf2196f1480f27fe846b2bef89d73fb6f8d9d4c0e801039bb',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-010',
    sha256: '9e29bed28c6e2e8fd0ec1deff54d924ed31bf08aaeffb3e430bd006cdf6a98d0',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-024',
    sha256: '28b0a4054e83ffbecc2195c264eb347008bbc33851c700342bdfc06d70d58467',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-025',
    sha256: '385c396df80458323fc0835378660b48ddf8e2068845d7ecc08c0e68414d5c0d',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'CMP-015',
    sha256: '08390f08624271bacc08166eaee854abcdaa6559379660144972a2559125cce5',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'GM-001',
    sha256: '9cf3928e13c50554c6dde8df07230fb357ab5ecabc09696d350d571c36a6066e',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'APP-011',
    sha256: '663696d78911782f915d4422c78098b9789a641ffa6bac4fbbccba01b102c848',
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
    id: 'J-MASTER-TRANSFER',
    sha256: '664bd1cbe62f1848298c4b17506e3629e0ce792c6d7028cb91d7ef7a904d571c',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-031',
    sha256: 'a680e1254f9f174566a2092b8fac21c3e1cdeef9c4924f701819b51f8c7d6d12',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-050',
    sha256: 'd006033582d37e8569017da6b17556425d5904b72af3e79e04cff4d423c88784',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-057',
    sha256: 'ff348257194061ab97b5963049473baa269528848064ecd23a18110d2a7a4880',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-058',
    sha256: '10092dd50dd7d3f8a3d54803c0d929f79985bd3c5d2759ca90ef07081fe3adf8',
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
    id: 'QA-FORM-NET-024',
    sha256: '68a7bf5dd2dcc3d6d8e86f9fdb2a88edf614af2b6889bdbde33234fb1937f0f5',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-025',
    sha256: 'cfb025cd9dbff0b2382cfda9c60a21b44d6e754729199244e00d0746c21c5d59',
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
    id: 'QA-REQ-050',
    sha256: '7a6a03b3e418d06a52a756b3ee098c313e6d70c3b6cd2661e594718f8934a75b',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-057',
    sha256: '213ebd89ee713662d56a7309cc7702a4473996716e4db2a406f80b33968731b1',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-058',
    sha256: 'a80cedc3a3ff2bf17aa07bee5e9bfa193e740e1852580ca7d3f043886b6441f7',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-UNLOCK',
    sha256: '9fdacb9fd265e9ed048a2b4d0a2773c70c9b3632a1ceca58c76b3f1ef4722637',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-COMMIT',
    sha256: '39aa4a31955f5c902dbeda6b5303cedb1daa797f0814b623c72a361c28966d1e',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-QNA-Q-CAMP-009-ROW-296',
    sha256: '80564233f65b416ff0a39150e0e4ce023aaa070fcdc3fd855f5f171e026eca98',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-ACK',
    sha256: '8125cf99f9605554d578c45cee4f1d1770decb00a767424b4c66178ad90b77df',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-CANCEL',
    sha256: '0d33393799401cebb9e15315a9d1592db4958164e529b6e47d3a252d3d632b86',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-RECONNECT',
    sha256: 'fdc5a4cdd835e08f0465a8b48b637eb58e9f9ac3a28ab85e1e5d1b9ac74d8806',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-MASTER-TRANSFER-UNLOCK',
    sha256: 'ed92a4f1f9cbd0551ba05b9c21b30ec1a3e6f3f90cb74bc6e656d7acd00ef1ce',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-MASTER-TRANSFER-COMMIT',
    sha256: '95f89a0f39848fd59692d108f3e5f79c86e6280ffc1f3fbd2485270d2702fa83',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-MASTER-TRANSFER-ACK',
    sha256: '6ff4846ec84238b9155d76441e031103f8ac1dc0f68f0fac171f6ab65a1bfef0',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-MASTER-TRANSFER-CANCEL',
    sha256: 'dfd5aab263b04232c267829844b673807d97cb65f957a7bf667cb13256db0501',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-MASTER-TRANSFER-RECONNECT',
    sha256: '1f05f4671cd5d3457437f6f912ec3d6c37a5efaeb7a9746c991abaf9d95460f0',
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
    key: 'registryCoverage',
    sha256: '542803be51f709175371667b25a8a3ba895d12985df6c5887a99d23e4b37bd3c',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### APP-001 —',
    sha256: '23a0a9bececabbdeb634ba96a28831ab5964ca519fabeecdc3a93e0a3dd64ef9',
  },
  {
    prefix: '### APP-002 —',
    sha256: '5340bbbc62f461158e4ed9348fb13f6f5338da86f3a079d19fa5afb49752bbdd',
  },
  {
    prefix: '### NET-008 —',
    sha256: '5b8a606652f290b792ce7ec9158dff0a0d9320221fc61b57b9a5f3495257f159',
  },
  {
    prefix: '### NET-009 —',
    sha256: '69634fd03bccb4236933317970653433e804d593fae0884190403171f6649bbd',
  },
  {
    prefix: '### NET-010 —',
    sha256: '2496abb37b7fc5cce905fbe6cb47969230984e6a4e81f19107ccd3587b196917',
  },
  {
    prefix: '### NET-024 —',
    sha256: '7278c9c05bbb7df8c0819471134a4f2ecd2783b11dac1de261727db2b6db0ab4',
  },
  {
    prefix: '### NET-025 —',
    sha256: '57e14c614d9d9eec13f65562e485a3fb610ad00d347ee5ecaed4480bf444315d',
  },
  {
    prefix: '### CMP-015 —',
    sha256: '08d62f3540e0acb3217fb36ed3620aee9e67d328ad646b98b9110ea8189c3222',
  },
  {
    prefix: '### GM-001 —',
    sha256: 'f880661a65bcc4cf682d963cdf3fba06d03c5411b5341b9f5805926b8d660833',
  },
  {
    prefix: '### APP-011 —',
    sha256: 'b4a6bde209d34074a50a88719dad22ef2d25be472292df4a18340230673dbdcb',
  },
  {
    prefix: '### J-RECONNECT —',
    sha256: '9fdce05998ad3cbed4c0c7eff834ad47da4b2f8a4b71f9cbd3b297a4b11be48f',
  },
  {
    prefix: '### J-MASTER-TRANSFER —',
    sha256: 'f8c3f7d5a2f7967aa06fccbff649b93163d002475061fc123eac20abb573ab3f',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-031 |',
    sha256: 'fa00a07e9267c4791b21bdd6f1cf3654b5fa8b638a5729df858e05b69453b7c8',
  },
  {
    prefix: '| REQ-050 |',
    sha256: 'f5807b8e982d83f4208bca21c513db7c18802c5c81eb447d342c8bcb511471b4',
  },
  {
    prefix: '| REQ-057 |',
    sha256: 'e45ce1b27798f77ca8e415e035fc9e64aa11407646fe9ccbcc0357f10be7e097',
  },
  {
    prefix: '| REQ-058 |',
    sha256: '9a241514da19a9911a9f033e329ce7e4edf42a1b342f8046ab7719ab9a68cf08',
  },
  {
    prefix: '| QA-FORM-NET-009 |',
    sha256: '34cc5f4ce904d6a14584ab49bfab5ea29b4c2d3453c72ab48161d3f2b05290ff',
  },
  {
    prefix: '| QA-FORM-NET-024 |',
    sha256: '16647b5e38ca1ec423e8ec86c3bcbd2f79ab163bf2085ffe1c95afa0695f91bb',
  },
  {
    prefix: '| QA-FORM-NET-025 |',
    sha256: 'c4992fd1e99853f36b89e2f804ee4b0fe09f5e3cb95e0caf7b537bbfc7d924cb',
  },
  {
    prefix: '| QA-REQ-031 |',
    sha256: '385a1979cbcedbbb66a9f34a6383cc44e5dd58a086d5f86df0a6f6bf844c50c8',
  },
  {
    prefix: '| QA-REQ-050 |',
    sha256: '073fec9fc3db97fcc1f2b17da57af77ad6b4878d8e04056bba7e6067bf4f538b',
  },
  {
    prefix: '| QA-REQ-057 |',
    sha256: '53c0f579423b8dc385525125ec49e57d170bc9d2b46690fd5ab989942f1cf012',
  },
  {
    prefix: '| QA-REQ-058 |',
    sha256: '076065ad09e7e687d47852693407abc24908be496954e8a2aa417af0f4619d9c',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-UNLOCK |',
    sha256: '3f48aff5c61c7414db44010b04237e8ccf879d81ad6eb6b15bbecba15752b56e',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-COMMIT |',
    sha256: '99762fbcb8f10fdc4f7ff52ebbb53e568f903bcd894a62cabaac82417410cdb7',
  },
  {
    prefix: '| QA-QNA-Q-CAMP-009-ROW-296 |',
    sha256: '45716c3bb0ba3826c6467d766d9c3c6783ce8408879464a7be57fcc9692c36f1',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-ACK |',
    sha256: '46a7b348c5cd67f77d193e53bc91ebdfb631571370d17db5c89e025d361e9ae4',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-CANCEL |',
    sha256: 'b3591f1ae2e071dc1014cb66a79dc446f3c16690d1c13f1fb82a8ac8b9f42e93',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-RECONNECT |',
    sha256: '079c05e6d300437a968758e0a72e47811adcb06cfd651d125de6b84809116d2a',
  },
  {
    prefix: '| UI-CMD-MASTER-TRANSFER-UNLOCK | Разблокировать передачу мастера |',
    sha256: '4fad6b631e54c8ac963a6dccb922f947a25750ae74af3d5e3b33561a7d5062a0',
  },
  {
    prefix: '| UI-CMD-MASTER-TRANSFER-COMMIT | Передать полномочия одному преемнику |',
    sha256: 'ce6a149cfc932492389db51fc814f56e8717405eac6ea73cf84c09faef8531f6',
  },
  {
    prefix: '| UI-CMD-MASTER-TRANSFER-ACK | Подтвердить или отклонить принятие роли мастера |',
    sha256: '8dee0f41455e6ab54c0cd63b56b6d4638d4679579776f29a7b08445e572936c4',
  },
  {
    prefix: '| UI-CMD-MASTER-TRANSFER-CANCEL | Отменить передачу до общего commit |',
    sha256: '3fb7b73de58888682ad999e286f0bf1f6652882d14b65a5121462cd7e38479c7',
  },
  {
    prefix: '| UI-CMD-MASTER-TRANSFER-RECONNECT | Переподключиться к подтверждённому преемнику |',
    sha256: '3585a915f010ae1463afd592f3d620b3950502c103758b11f15894cad24027be',
  },
] as const;
const WHERE = 'atlas ADR 0079';

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
    fail(WHERE, label + ' differs from the approved normal master-transfer source contract');
}

/** Whole objects include authority, fields, draft variants and both local route mirrors. */
export function assertAdr0079NormalTransfer(root: JsonObject): void {
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
export function assertAdr0079NormalTransferMarkdown(input: string): void {
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
