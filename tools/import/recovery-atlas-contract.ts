import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.13 objects, authorized by decision 3 in #221 / ADR 0080. */
// Intersecting witnesses include the accepted initial NPC trauma source amendment in ADR 0081.
// Intersecting witnesses include the accepted NPC source consequences in ADR 0082.
// Intersecting witnesses include the accepted fresh Trogr source clarification in ADR 0083.
// Intersecting witnesses include the accepted custom item source clarification in ADR 0084.
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NET-008',
    sha256: 'ec99484348303d30fe77ee18956eb6bfcb35981b8d6d173650123a3391069a21',
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
    id: 'NET-026',
    sha256: 'cf2f334e680ea3c5d0da40f59629f39cf062299f67e44fd197f7800c09950062',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'CMP-010',
    sha256: 'e720a863aee987eea1034b0a02a8120da97a6c42b227419c9cad88ef01bfb920',
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
    target: 'journeys',
    key: 'id',
    id: 'J-MASTER-CONFLICT',
    sha256: '409b9c9d7ab7f997c55d809f4b3775f6a1a31f99e149f5be056802a3814fa449',
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
    id: 'QA-FORM-NET-008',
    sha256: '7c0acdbdd08b92bce1d565745f8ecfc7c0f87b08cc97bd632381329f974782ce',
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
    id: 'QA-FORM-NET-026',
    sha256: 'ebbfc036eaa0b0111cc1f9ccd601c9a61769addac7d44f3180e31114c7097ac6',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-CMP-010',
    sha256: '0a9015825f743eb29b1db7787f0dad660d50865107eb33343735a781246b7b1a',
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
    id: 'QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-CANCEL',
    sha256: '0d33393799401cebb9e15315a9d1592db4958164e529b6e47d3a252d3d632b86',
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
    id: 'UI-CMD-MASTER-TRANSFER-CANCEL',
    sha256: 'dfd5aab263b04232c267829844b673807d97cb65f957a7bf667cb13256db0501',
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
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NET-008 —',
    sha256: '5b8a606652f290b792ce7ec9158dff0a0d9320221fc61b57b9a5f3495257f159',
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
    prefix: '### NET-026 —',
    sha256: '10b95bdc7182cafcdb5a60135f2cc7be5f98417a53aa7b04376621ad5c695d04',
  },
  {
    prefix: '### CMP-010 —',
    sha256: 'b5b47dcc4bd570dc798e47a3046889639fbc4cdec0982145377cf28ef0ecadcf',
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
    prefix: '### J-RECONNECT —',
    sha256: '9fdce05998ad3cbed4c0c7eff834ad47da4b2f8a4b71f9cbd3b297a4b11be48f',
  },
  {
    prefix: '### J-MASTER-TRANSFER —',
    sha256: 'f8c3f7d5a2f7967aa06fccbff649b93163d002475061fc123eac20abb573ab3f',
  },
  {
    prefix: '### J-MASTER-CONFLICT —',
    sha256: 'e628b2c3f8bfdb543c5208b41b13165c6bdf476e4a646b0ed53c8a9d1980d70f',
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
    prefix: '| QA-FORM-NET-008 |',
    sha256: 'f22cc381db744d82e4d7f2b2915ac1cb0a55574c535b6daa494359f8b61dffde',
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
    prefix: '| QA-FORM-NET-026 |',
    sha256: '5516cc56bafdd49f43f056d292fcd67c2451a7f3ef385e5fafacd19784b31feb',
  },
  {
    prefix: '| QA-FORM-CMP-010 |',
    sha256: '0abb2fa73e4d1acad097247d7079a1acf7f4418033eeff7ca9cd33942e75cc40',
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
    prefix: '| QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-CANCEL |',
    sha256: 'b3591f1ae2e071dc1014cb66a79dc446f3c16690d1c13f1fb82a8ac8b9f42e93',
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
    prefix: '| UI-CMD-MASTER-TRANSFER-CANCEL | Отменить передачу до общего commit |',
    sha256: '3fb7b73de58888682ad999e286f0bf1f6652882d14b65a5121462cd7e38479c7',
  },
] as const;
const WHERE = 'atlas ADR 0080';

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
    fail(WHERE, label + ' differs from the approved frozen master-recovery source contract');
}

/** Whole objects include authority, fields, draft variants and both local route mirrors. */
export function assertAdr0080Recovery(root: JsonObject): void {
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
export function assertAdr0080RecoveryMarkdown(input: string): void {
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
