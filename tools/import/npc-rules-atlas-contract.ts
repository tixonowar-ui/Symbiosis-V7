import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.15 objects, authorized by #224/#226/#227/#232 / ADR 0082. */
// Intersecting witnesses include the accepted fresh Trogr source clarification in ADR 0083.
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-003',
    sha256: '594576c20c07b5224fbbc11795e2efeec5e6fffe486d214146fa6288d4816630',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-007',
    sha256: 'cc7502ea3bb5a197279a7dda9a95c3f48654d859e765ce16cd9b11af2ee1f33f',
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
    sha256: 'd8cf73a4783b520a10af439c24466a6847553bbbdefd3f24579815d3e83ef3fe',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-015',
    sha256: '116b8f1abc53aa6afd43179aef0bf50f1ea95debc7914acc579e89f7ea487f81',
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
    sha256: '767ab10f4f53ab7e77b639eaeaed4ef209d1323628d2f9f222188dfd16510f47',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-NPC-CREATE',
    sha256: '9e8c8ca769c4576db7952f0a6d63bd08e1fbbc1a2b449b4cb346f94e5990a033',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-011',
    sha256: '727736d46b19371dc6bee3e3553b8f53da75a70fcf7c3079a7816a75b2bee495',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: 'dd0674a9d7f44e74c2181596eb416bb74cd25f620c80fd810a8b9109e4a1a9e2',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-003',
    sha256: '3b80a98c000dbb5ec943495c01284b2976ca99ce07e12982f864214404204ee9',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-003',
    sha256: '5e9787f97a6a63bfd158c39550405a964d524de4206824c87bd8ac3a0e52474e',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-007',
    sha256: 'ac91b494239f5eb128d8f19574058ce0c8d6be77d1e72792d60566895aaca864',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-007',
    sha256: 'fcf34876368aaa31837689aacedc8a108484d4a52a3aa3ff20a74f7d89f5b949',
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
    sha256: '68adfe4834b57e58701586a20630daeca1013730d815f5cadb1d72db5e77a0fd',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-014',
    sha256: 'aac0c8680f0324ee0c563f8cdccfab417c321b73578190446d95740a797d46b7',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-015',
    sha256: '4dccd7ce7cc254aa6237cf5d00a4a4e64c48138f2246375a57667f82573e8a1d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-015',
    sha256: '26e39700c3ce0c49d58c29fcedde4fffd637a6c462e3407de15d0163f3356f5d',
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
    sha256: 'e702ce7af3d24045042edb84e5207c9f396fe140e18518f5b0587a31b139c171',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-017',
    sha256: 'fd08abbf51bf730cd62b997d5aa234e63747faa100c860e13b0bb1b631dc73fd',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-011',
    sha256: '1a9c5472c18ae0d4e550c864d952cc89d623652198b76f48a168c0af7d5b37fc',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-012',
    sha256: 'd37961d5cbb9b26658eee356753210145600f1c97b9a2086cab9d865156bc7ad',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1',
    sha256: 'eaa85a5868909731a8cbd33b9225e5f8f081a59ca1b87066d17fafc5cc5bb05d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION',
    sha256: 'b053583efd9c452ccde8faf116c995ea40bb1aa8d37d8f1ae3a35844b4e11e7e',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-COMMIT-V1',
    sha256: 'f707bad46d59d54cd566f58ee33c0bbd76238e6436c0e72bc8e281bf643907cb',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: 'a1e946fc013c9ec591af1de19fb5e6ad07fd62842b7840d07b979a96a727c098',
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
    sha256: '9dd9bbdccade7312f84a8689e3f312bcb0c91c46e168d30d7a5e2dfe21b5f8f3',
  },
  {
    key: 'registryCoverage',
    sha256: '8542af9faa630e9945805bec06b674e76ee766468e0f704532ec9009ecc3035f',
  },
  {
    key: 'globalContracts',
    sha256: '30ef0ac22392b9bb908a80f34572a600d0dca85cd1ff7d62cdf4c6b49df4af44',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NPC-003 —',
    sha256: 'e9ad0ecd4c04790a9aaed26f9b1340f6532997403dd30901311f69a14998c724',
  },
  {
    prefix: '### NPC-007 —',
    sha256: '4fb9137229b7317f2137e25e8dde0f555e5c487aba9841d3288d1f9db81347aa',
  },
  {
    prefix: '### NPC-013 —',
    sha256: '0bebf76e17ac8ea3fe6f65e412e029463500effbb0bf5bcfdaace0adb951d803',
  },
  {
    prefix: '### NPC-014 —',
    sha256: 'f4d99057e7b4633c38d0d97bdc06e607ffac713d7ed20877514c64ebbaa65565',
  },
  {
    prefix: '### NPC-015 —',
    sha256: 'eacf8e512a8f97e300173af83208936bfc4cf9bf58f327503a254325a248a881',
  },
  {
    prefix: '### NPC-016 —',
    sha256: 'b394929f70fc58b757ec38b293acf2c5bc0fe7e6ab6bb48c7cac4c3128f55188',
  },
  {
    prefix: '### NPC-017 —',
    sha256: '0848d06695fe6d62e2b24ec0908ae40305a7e8257470fe7b072c07a59a541b9f',
  },
  {
    prefix: '### J-NPC-CREATE —',
    sha256: '9db22901f1af67e829e98abd1c88c6273ece5e4ab03a292bdbcc94ae54c474c4',
  },
  {
    prefix: '### GM-014 —',
    sha256: '4fa51b4fa90564bcf429b87a77233433e736f57d4d42d16535fcdcfb78c758a4',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-011 |',
    sha256: '0f0612627afd55af7620fa547b47e1a4441143da576478da0d019b51903f29ab',
  },
  {
    prefix: '| REQ-012 |',
    sha256: 'd0c6400a95bbc63798279be537e47b28ec794c3a278468d61b850ea1f7de8932',
  },
  {
    prefix: '| QA-FORM-NPC-003 |',
    sha256: 'ce6fb767a16409972e37cf662806fbd7b78a6cf56deb117359d69cfaee0f6cba',
  },
  {
    prefix: '| QA-CHANGE-NPC-003 |',
    sha256: 'bb12e90c0aa26c68fddb009d29b69abd1b9c08464d4e8d8cd535723cd2e1f1ab',
  },
  {
    prefix: '| QA-FORM-NPC-007 |',
    sha256: '9c2a585a02e19a1a33ef09e4236d4318597f1337fc4f2d7820f46af1b51beb1c',
  },
  {
    prefix: '| QA-CHANGE-NPC-007 |',
    sha256: '86236f990fc61c47953652b8c24f6936b50d6ddc089e83c8bbd1a516bdb74d52',
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
    sha256: '32dd7d3a0b1d37d6c089b715811549a704f285977410defc3e93e619ca4f2c10',
  },
  {
    prefix: '| QA-CHANGE-NPC-014 |',
    sha256: '5c6edb08f4e88b0629b44b4c7844d11a6c47969e80f89c069853422535fff794',
  },
  {
    prefix: '| QA-FORM-NPC-015 |',
    sha256: 'c279c211dd212a865e59637ed1f5dc9c6cee2ba5387381dc6d89f1c92cd95a34',
  },
  {
    prefix: '| QA-CHANGE-NPC-015 |',
    sha256: 'e2cc7b476f18ee3f02259c9afa038617b109440bc86ccb1414d500a932cf67cf',
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
    sha256: 'cdbe534829323a83b15fb378950e6ef6c455e565a83782ee3ca733e738f28e61',
  },
  {
    prefix: '| QA-CHANGE-NPC-017 |',
    sha256: '19a2876868a4baff4b21d0eec7cd7806a0dbc8faef575c31d92ed7e25e4bdc4e',
  },
  {
    prefix: '| QA-REQ-011 |',
    sha256: 'c9cfcf1793c0f78abb57292bfb3bec3a7730b2a36088670eb7fe5a9df105675b',
  },
  {
    prefix: '| QA-REQ-012 |',
    sha256: '85a775df0499f9e11e16e87e035db7d28f9b3bea2b2b4db4a62bbe6f75e09e9f',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1 |',
    sha256: '45f076fcd0f6db11c52a66822c6ebbac288c44613942f34fe08b4be63fe475e7',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
    sha256: '20ba7236672bef6cff5a031684db6c300cd8f8506ec6622ca2ab4e68ca240fa9',
  },
  {
    prefix: '| UI-CMD-NPC-COMMIT-V1 | Атомарно сохранить первую версию постоянного НПС |',
    sha256: '7122dcca164e6284437e5b388baeaec750ceb43df0f5a4ccda15118fa56e8968',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: '7da1c86fb174aebd3c7ab349fe0cfff07cb9927363054ef14e10a34a26135832',
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
