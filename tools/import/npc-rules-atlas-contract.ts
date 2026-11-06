import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.15 objects, authorized by #224/#226/#227/#232 / ADR 0082. */
// Intersecting witnesses include the accepted fresh Trogr source clarification in ADR 0083.
// Intersecting witnesses include the accepted custom item source clarification in ADR 0084.
// Intersecting witnesses include the accepted initial life source clarification in ADR 0085.
// Intersecting witnesses include the accepted formal Weaver source clarification in ADR 0086.
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-003',
    sha256: 'bd33f998ef4a33888e07671643a8b4672b8ab00a32e303a8811f9cbcac58b26d',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-007',
    sha256: '32d766438e10128bc85b78fb9ad48238ad3e8340729be92a5a8280a42983cf63',
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
    sha256: 'b4ac957e2715da8c46d6a76f3b643f785e738580b0c63923eab6cccaf6bbd1d7',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-017',
    sha256: '50cf3d68c309dc7fc081ccf904c871bc18932825420bf916aeb203861917fcfb',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-NPC-CREATE',
    sha256: '3ebf40e03cd0332535ed38bbe26c76bcb4a91111757464c8992b1eeae9626707',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-011',
    sha256: '6c5a28709be6fd8e4d7785980a9c75dddb65b1845147f4e82430a0b7d2a80b2f',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: 'e7a1ca79aca13158d25ba9062a5ad08ba1ca9eb80f023058067cd2ce83932e1d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-003',
    sha256: 'c99cba15734de938943e29a71f510045651ec81b1542d1ed46bcb2387d9c9fe8',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-003',
    sha256: 'c9d1da04d29977f2f3b9ae87d4d5a3cade86df120cc05a7429c0a6139810c035',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-007',
    sha256: '4457c15644e512342e6b8ea9131b0848aa727b2a2235651c4db98756f28c08a8',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-007',
    sha256: '34c1ac80d4d70cc4c7f9e32404a60150ead2afefca46b50cafd8526b8c480484',
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
    sha256: 'fc495607ae85c5e38e762fe0fa121144d8545454ff7945815d851ea1cfc3e1a0',
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
    sha256: '81f63d92dd2370234781706cdbb2ae5ebe8d5b21fbd8c0b85070514318fc088a',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-016',
    sha256: '8f1a9998aebe274932c5cfb1346e76729e55653569030369faa1c930e73c70a3',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-017',
    sha256: 'db536db3883cf5f4dd2c066dc225efbdb80de2cadbd4fc49d625179b8af1017f',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-017',
    sha256: '510e5b2fd28d5bfa21ec0765e280b371587f8b34d4423041bad9f3c75a57dc46',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-011',
    sha256: '4cd22ffade61a500bad4927cd6843c71f9fbbf8f871bbc81b6d06bca29cbf25b',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-012',
    sha256: 'f93a0bcbcf01314c3604fd643007c7b41a2c2a50ba1f054911968cce56fa4f9d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1',
    sha256: '4c75da1d654cfb1c30a8705ba2890b6545d12785d4c12505f54defeead35712b',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION',
    sha256: '6cbb7f8a776b44cfc003ce4ab15f45a0c5f29a3674d0ac51548d700d87ff4739',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-COMMIT-V1',
    sha256: 'c99215d27700ba372ff3a4305258fa5d2463f819634a04a040c025a7f497654c',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: '08602042d796d1a6a24bead5040706e4f02ae86c1ec7a26f9a28f02bff3d8ac4',
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
    sha256: 'd99c7420fd95b74c2cc55324701e224a8ac8ecd76b2de238658da768768b63d5',
  },
  {
    key: 'registryCoverage',
    sha256: '7643ff4a89679f8b6f3c709a4e63b74418ea07f597728533993d9e7fcea9a9bf',
  },
  {
    key: 'globalContracts',
    sha256: '30ef0ac22392b9bb908a80f34572a600d0dca85cd1ff7d62cdf4c6b49df4af44',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NPC-003 —',
    sha256: 'af4088a34e50566a708c0c41c49e47e5c2e5354132a3faf98ded72a1d2461e4f',
  },
  {
    prefix: '### NPC-007 —',
    sha256: '2ecd865b497cffda4de4eee70cc7d23935c336cd914e5e7ae7a0bbb730e5ac93',
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
    sha256: '696815ff8017eb60023ce9b0e1f39d73e5c5874668726ebbabc17a71aab9cd65',
  },
  {
    prefix: '### NPC-017 —',
    sha256: '21ce66618fea64667fb0f3bc7f7b0edc5fd77b98349ca1b0f63772449d88a977',
  },
  {
    prefix: '### J-NPC-CREATE —',
    sha256: 'd7312149934d70df8cdf62a7dc7eca31e1c258b2bbce39e46d57bb4026b70700',
  },
  {
    prefix: '### GM-014 —',
    sha256: '4fa51b4fa90564bcf429b87a77233433e736f57d4d42d16535fcdcfb78c758a4',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-011 |',
    sha256: '97f7eae25979c170732f34888a1152898584826c5263167d8e5ccdae26e6b5c9',
  },
  {
    prefix: '| REQ-012 |',
    sha256: '834750a1e33b7976d49573334f5eb5cec0f1cada999b09d43ae32f183e4ada05',
  },
  {
    prefix: '| QA-FORM-NPC-003 |',
    sha256: 'c83e9b399c9925dcb14db580ba0f756dc0021afff7f731dc8109c663509b7b0f',
  },
  {
    prefix: '| QA-CHANGE-NPC-003 |',
    sha256: '85e305f0e39d87127d44dce18e84ff26bbf3d83736ce17b3d44bd28b40f278f6',
  },
  {
    prefix: '| QA-FORM-NPC-007 |',
    sha256: '7d83bbd4085b5007b8b4c5e86769fe3360ec80a7cff8581e27d583d929e270a1',
  },
  {
    prefix: '| QA-CHANGE-NPC-007 |',
    sha256: '6a8ce60c598c2e6822892ec1baad055ac440c15e409b72dc3fa7157b6dc5e484',
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
    sha256: 'e7799dba716887897aa9e6bf867996ae14e32931eadfb3c2580097b1f45c9756',
  },
  {
    prefix: '| QA-CHANGE-NPC-015 |',
    sha256: 'f70bf210673307915c7df3cb0d91b7337d1fd61ead5e56883e6793700e33f3f8',
  },
  {
    prefix: '| QA-FORM-NPC-016 |',
    sha256: 'fd2cde7d916495d344a2f4011b6f7e6a874fb94a48367c956f15df8bcca9d434',
  },
  {
    prefix: '| QA-CHANGE-NPC-016 |',
    sha256: 'c530f299dfd977b01236ac903b58d260bbc6e8b5b30f679d142d607e2e4b98c9',
  },
  {
    prefix: '| QA-FORM-NPC-017 |',
    sha256: '5ed74c957fa4347c20b21a704507d87ca92b32f7c0c9f7a6e5b175aaf7488e75',
  },
  {
    prefix: '| QA-CHANGE-NPC-017 |',
    sha256: '4fa090f12f95cd9bcf1ffc09607c52a2c1209ec5ad18483c50c33adb32426355',
  },
  {
    prefix: '| QA-REQ-011 |',
    sha256: 'da1e12b3597ba0cf585da3ba25256fda1a4e7883abe917e583fe26200c128d23',
  },
  {
    prefix: '| QA-REQ-012 |',
    sha256: '9e3da943b13847e64847fb583e78a46078ba9e7b5c2418bcacf39ef4490aa6ee',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1 |',
    sha256: '818273f0146afdab8b7b4c47a74f33eca5a50b519dafb11bf72794095a636f12',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
    sha256: '6c31dabc102bc8188d0065115f14a7ebb6ff47901c9cec80ba868df27fc43160',
  },
  {
    prefix: '| UI-CMD-NPC-COMMIT-V1 | Атомарно сохранить первую версию постоянного НПС |',
    sha256: '2c29e18f160fbe2b56e713c66527d6f4839ac249d623a1ea4424ba88b15810c7',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: 'ff5146d880677e71e46547cce93cbb8f786fc99ebe9cc2514a59c042043b6274',
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
