import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject, type JsonValue } from './lib/json.js';

const WHERE = 'atlas ADR 0095';
const OWNER_FORMS = new Set(['APP-003', 'APP-004', 'CMP-009', 'PLY-030']);
const ID_FIELDS = {
  forms: 'id',
  journeys: 'id',
  coverageRequirements: 'requirementId',
  qaScenarios: 'qaId',
  workflowCommands: 'commandId',
} as const;

// Reviewed B18 witnesses include both local route mirrors, server availability, and the independent Markdown.
const DECLARATION_SEALS = {
  source: '2debd80be816d3560eb65ec08a4c1ce70be4b205d6569e743c3705b2eea09693',
  profile: '70173bd88884a3716cab8319f8691c61e213597e9ed468bfce1495f565bbad5f',
  selector: '097ec8f197ccaf863720aee046da98f59dfa85555de10bd660ef28b54ca07322',
  binding: '96565af7ab06e79f69f9f57db016991738d02263464197935d5697b048d79108',
  curtains: '236ba6d70e067d11e5e79d5da875d387cf57a667c7905630f1d38fb9acddb986',
  continuation: '31e4a6811464e400f9f106845882798ee531865f97ce0ab62e083c8c9a1d566b',
  admission: '7c5660a14f895fd8a6e01a6a97e841f02f69401637a589376149ae2bf73e8513',
  boundaries: '9247c1dfa8a43ae31b81861d1b1f06ee8ff1f506d7379f9b06889ba2257b1f81',
  modeActions: '2e80b6cf2f78fd2c580fdca63f69e0e3a0c2c737a2e9cf7224cdc91e14f28060',
} as const;
const ROW_SEALS = {
  forms: {
    'APP-003': '26eedeeca75aa66b0b6a32d575c969baca24546db44730bff5333afe1c229fe6',
    'APP-004': '14d68285828f8a0966678c456eaceeed90e2b3b08fd06a8fc2e9586da1a40fd3',
    'CMP-009': '894a1189aea796ecd8aa0898171dcfffc7a0ff424562e4c91b0af7a509024b46',
    'PLY-030': 'd672645e2d901274d1e84716857868e784ea679a1faa488cc27b8792c27911a4',
    'NET-003': '152b78134a44ce40a990c581293402c014fb5effaa2a27b8c328df13725c745f',
  },
  journeys: {
    'J-LOCAL-SEATS': '2fc91405cc46c6f505c720d4d0f51c2cc6c570166f9862726b96805888d2f191',
  },
  coverageRequirements: {
    'REQ-003': '8c0f1e21e7910fe3fd57af77c556bdcb46cd70614ab91ef1162f5603f896e6e6',
    'REQ-006': '253fb042ddd15f43965016fc16393c5a9be92a5e2171acfa2c8f6e93508e74af',
    'REQ-009': 'c4553925c86d2a48705a5e8796bf3d63502499c483167ff3ba6c6cd05674778f',
    'REQ-010': '31758668abea13b7a70a6f22e3041ffb4a75e3d96bd17f3c1ac55a3ea02298a1',
    'REQ-029': 'c346c644b9ddd85da1488e18302238018b8a8483ff9cf8d72d5789004b659acc',
    'REQ-052': '0bcc17c5940183c1e828e7ef6eb9b3bf90a0e6d412985dc69cde2f8ab0c59163',
    'REQ-060': '1bcb5344a4ef33802295a7ec36fe6d52e318d3aa4b9c7f1eccca6a57b839926b',
    'REQ-063': 'eb9e6f5c1c590e176356acd68b86a35ffe6e07510db60d4fa8ad45a98679b301',
    'REQ-084': '7c6e08e533aaf99ff5b094b2d6843008162afd5c2f719edd7d944eb1f35e0782',
  },
  qaScenarios: {
    'QA-FORM-APP-003': 'a5b6b609e3d9d08cae84ba044a131044c0f27ae4789c01a2f1f77f17917c4396',
    'QA-FORM-APP-004': '8d7f1f93364794c1650b68e47dc51b6f5106f3db18187139448ecfc29d2e8fa0',
    'QA-FORM-CMP-009': '4a295ef7a42e6d6b29c9938fb2cd8cfa692b488ea59586f91f84446108369da7',
    'QA-FORM-PLY-030': '0c0db3e03bfc0194ddceab93aec0fb1745662277ddc09d657089448599190903',
    'QA-REQ-006': '5325030e32c78bd69143f2625437cae32103fca07fb01ec58b709fcc43ef5104',
    'QA-REQ-010': '2f04531b3d2adbabcd1a9160cf14fd9f076c9d59d4a459be1c573fe78cce787a',
    'QA-WORKFLOW-UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK':
      'ed2332c0e68e664fdfb27fe81c0237bfa3821cb188c8d3cb7f96f86388cfba5d',
    'QA-WORKFLOW-UI-CMD-LOCAL-OWNER-PROFILE-CREATE':
      '601f0268252455e79489c162f3e6c27207e64c50d88def2f99b7adca3b3a5bd5',
    'QA-WORKFLOW-UI-CMD-LOCAL-OWNER-BIND-FINALS':
      '29d5e450ff4a00634f9eac8f7d45dade8c3f7216de1869b9c2ff4f5c254fd52f',
    'QA-LOCAL-OWNER-LIFETIME': '6d954ffc856cfdc28ec9cb132dea246ab7b3092844b6a17cf70ea29225bdad30',
    'QA-LOCAL-OWNER-TARGET': '89081b2c588693f3d0b99fbd96f88ab87aae6bc39eebef6479fa4ade026b1533',
    'QA-LOCAL-OWNER-PRIVACY': '50169f1ff82d3db49f40e54a07e63a3a2564768228ec6db4cebdc42806a47c81',
    'QA-LOCAL-OWNER-ATOMICITY': '80812167996d7ce5b41b9f63470363a429f8f80bd42c71b0415dd619c4f8b7b2',
    'QA-LOCAL-OWNER-RESUME': 'd4e46930cfebaf4f094a229175df02d830796f3fdda6d3c4593b67ca7d460923',
    'QA-LOCAL-OWNER-ADMISSION': '4382552836f0367e1f691f1d28a8d0f29772639e9230e7ea4991996662f32df7',
  },
  workflowCommands: {
    'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK':
      'a807fd2e6621b6bd6d97c12091afeb8ce12ca763db35f5bca955e76bafdb55cb',
    'UI-CMD-LOCAL-OWNER-PROFILE-CREATE':
      '20df171acb649bc6a28d37172b0b29b15622b616256b72522793ce502eb96899',
    'UI-CMD-LOCAL-OWNER-BIND-FINALS':
      'e0cf3aad7da729258588fe8236e161c3c5f308185e97598f82007e212ccd96e6',
  },
} as const;
const ROUTES_SHA256 = '5e674a6d1ff67f7b08054279d24f5a241b1aa6b2116a3b1b73e4bab4ad6e90d6';
const MARKDOWN_SEALS = {
  '### Передача локальных FINAL конкретному профилю — B18 (#249, ADR 0095)':
    '650f4d999cf752880fa18608a02a90ff336a4467f503d8dff0cc0f0521b08ab0',
  '### APP-003 —': '3ce1a2ad02bf3bdeef3334aa6cc00b867b5bed4e0b32a4dcc09b69ad76901ee4',
  '### APP-004 —': 'e6c827174a1e30fd78691eb4ec68cf00dca2c9f5a0c3ee9c6137110f469afe03',
  '### CMP-009 —': 'f13f3b32d9b9766f1567d6dc3324f1fee5b108c3d7f6599fe8801b009bb70f92',
  '### PLY-030 —': '8c40db93fd643386f857190a0a284731c4a3e7c20165c85053139caaa95b5a5b',
  '### NET-003 —': '7d10455c77c4f3fd9e198685f8169469d8d5ad67b2ff000192edc89354f1d5a8',
  '### J-LOCAL-SEATS —': '8925122df3029020c68889fe2146ddbe45e6e3f1798d3a6b4cc3b4f1d79b39e3',
  '| REQ-003 |': '808d97c7c13a6e482dcb992a99c80114f920da7f5a70c63a67cd6935c4cb98d8',
  '| REQ-006 |': 'c1a0114f7e02a130ad5db0b79553bc97f13803aae6717c9b075544196d803bac',
  '| REQ-009 |': 'fafe8a7f839bf2d0f3d1206777d0ee2e181e9a17f5e0788b11a80eb72260ba14',
  '| REQ-010 |': '88ddfb4b86ff3198e00c02d14e8f8741460f24495b9b7c3f3bb9479c94dc6a1e',
  '| REQ-029 |': '79f655215f8df4d2622969d4b994c1a3018c4f7e41e8d9abbd6086a4224a8815',
  '| REQ-052 |': '9b9ac7949e4185c8b3533e0315a0f454576cd34e2a9e678cc6696b5746ad3fc8',
  '| REQ-060 |': '896596d1ae48b27ff8afbec503e07b6eea42c3a9467d49939cd30d0c5127e2ee',
  '| REQ-063 |': '14cf1fd646e7f2541a41ff55aa87aaaac45161e9ebe93cdf62212baa7b04efbc',
  '| REQ-084 |': '1438ca9a5700903b7322bdfd96c1e9431c655299da438ba65f73d383cf8d348a',
  '| QA-FORM-APP-003 |': '88d4a00fbffa74db9b60cd1f65ac2e87827938be9e5327cc4788e2046fd2aa6f',
  '| QA-FORM-APP-004 |': '491c6992260c16c9b79dc8fa738ee1e060000d01168c34230a4dd401822c322d',
  '| QA-FORM-CMP-009 |': '19951f6099f5cef73c7a727137133479ccf7ffc5a24391cb99ec051917be5346',
  '| QA-FORM-PLY-030 |': '4959514d817c5357ee27bd493c7a9ce7f6ee8dc49c0c194c98d0d2e72d06486e',
  '| QA-REQ-006 |': 'e4c2b7b72f63e58c3989c83d753cc26ebfe4daa3724c9abcd8721df3020e5aaa',
  '| QA-REQ-010 |': 'e853803982b4a7030de77194d423243512eee7db6be26f496425ca7d0bf2a4e9',
  '| QA-WORKFLOW-UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK |':
    'cd1b27468e1e33c303192c1fd016498acd8e74fa13945d1e20556fdecc550dfb',
  '| QA-WORKFLOW-UI-CMD-LOCAL-OWNER-PROFILE-CREATE |':
    '0e2fdf1ca691a3344c07966a9b5ab49ad1ee1942d1f2b35497b2ae11ea1e312d',
  '| QA-WORKFLOW-UI-CMD-LOCAL-OWNER-BIND-FINALS |':
    'a54d78024aa4ac38ca7690b7d46af31056a0ecaf90511f0656d928865bef4ac8',
  '| QA-LOCAL-OWNER-LIFETIME |': 'ccd3af108bef6a3d6c420bfa33ffd9da52bb8c7a83e3aa8e18da131bdf3e16cc',
  '| QA-LOCAL-OWNER-TARGET |': '6124a799869b596499ace3b2f11e9ce04c005969ff4ae08babef4ca6f79360e4',
  '| QA-LOCAL-OWNER-PRIVACY |': '4dfc31e8d84446a536fdf2776f2873fcba16d1bc6ead680566f3946f903a5905',
  '| QA-LOCAL-OWNER-ATOMICITY |':
    'd42c3ded357d9e84964d089d5c3e3334bc6755562730fe8df377782e2306a90c',
  '| QA-LOCAL-OWNER-RESUME |': '7ebf46141a40b1c37b57ea1f8eaa98963ac0f109d52637c4b4423929ae467d88',
  '| QA-LOCAL-OWNER-ADMISSION |':
    '3ceac16ac933d2f81acfdd51502368dd5fd2595cd8dd34880412026508c0b36c',
  '| UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK | Подтвердить локальную privacy-передачу активного контекста |':
    'ff3733826637a5a66141a08205773c532d1dc16ff9be5eec8db3d35f244a96f0',
  '| UI-CMD-LOCAL-OWNER-PROFILE-CREATE | Создать локальный профиль с явной меткой |':
    'e1552344e1ee6545a97e8cfc092c8d979628212bfe3a706c806533bf3ce231a7',
  '| UI-CMD-LOCAL-OWNER-BIND-FINALS | Привязать выбранные финальные листы к локальному профилю |':
    'c59894ece83e29c2331398d6e8484fc3a99e00e577d657f6dbfd723794a85d17',
} as const;

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function jsonDigest(value: JsonValue | undefined): string {
  if (value === undefined) fail(WHERE, 'missing contract value');
  // JSON object field order is not semantic. Workflow fields and selected route order are.
  return digest(
    JSON.stringify(value, (_key, member: unknown): unknown => {
      if (member === null || typeof member !== 'object' || Array.isArray(member)) return member;
      const record = member as JsonObject;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    }),
  );
}

export function assertLocalOwnerBindingDeclaration(value: JsonValue | undefined): void {
  const path = 'globalContracts.localOwnerBinding';
  const declaration = asObject(value, WHERE, path);
  if (!isDeepStrictEqual(Object.keys(declaration).sort(), Object.keys(DECLARATION_SEALS).sort()))
    fail(WHERE, `${path} has missing or unknown sections`);
  for (const [field, expected] of Object.entries(DECLARATION_SEALS)) {
    if (jsonDigest(declaration[field]) !== expected)
      fail(WHERE, `${path}.${field} differs from the approved binding declaration`);
  }
}

export function assertAdr0095LocalOwnerBinding(root: JsonObject): void {
  const global = asObject(root['globalContracts'], WHERE, 'globalContracts');
  assertLocalOwnerBindingDeclaration(global['localOwnerBinding']);
  const registry = asObject(root['registryCoverage'], WHERE, 'registryCoverage');
  for (const target of Object.keys(ID_FIELDS) as (keyof typeof ID_FIELDS)[]) {
    const rows = asArray(
      (target === 'workflowCommands' ? registry : root)[target],
      WHERE,
      target,
    ).map((value) => asObject(value, WHERE, target));
    for (const [id, expected] of Object.entries(ROW_SEALS[target])) {
      const matches = rows.filter((row) => row[ID_FIELDS[target]] === id);
      if (matches.length !== 1)
        fail(WHERE, `${target}: expected one ${id}, found ${String(matches.length)}`);
      if (jsonDigest(matches[0]) !== expected)
        fail(WHERE, `${target}.${id} differs from the approved source`);
    }
  }

  const routes = asArray(root['transitions'], WHERE, 'transitions')
    .map((value) => asObject(value, WHERE, 'transitions[]'))
    .filter((edge) =>
      [edge['from'], edge['to']].some((id) => typeof id === 'string' && OWNER_FORMS.has(id)),
    );
  if (jsonDigest(routes) !== ROUTES_SHA256)
    fail(WHERE, 'local-owner transitions differ from the approved source');
}

export function assertAdr0095LocalOwnerMarkdown(input: string): void {
  const markdown = input.replaceAll('\r\n', '\n');
  for (const [prefix, expected] of Object.entries(MARKDOWN_SEALS)) {
    const anchor = '\n' + prefix;
    const start = markdown.indexOf(anchor);
    if (start < 0 || markdown.indexOf(anchor, start + anchor.length) !== -1)
      fail(WHERE, `${prefix} must occur exactly once in Markdown`);
    const after = start + anchor.length;
    const ends = prefix.startsWith('### ')
      ? [markdown.indexOf('\n### ', after), markdown.indexOf('\n## ', after)]
      : [markdown.indexOf('\n', after)];
    const end = Math.min(markdown.length, ...ends.filter((position) => position >= 0));
    if (digest(markdown.slice(start + 1, end)) !== expected)
      fail(WHERE, `${prefix} differs from the approved Markdown`);
  }
}
