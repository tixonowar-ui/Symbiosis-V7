import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fail } from './lib/fail.js';
import { asArray, asObject, jsonSha256, type JsonObject, type JsonValue } from './lib/json.js';

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
  modeActions: '34a11f5acc9929bbd7dbbd5d33dd184058d3f8ffe5644955fc51462e79cec605',
} as const;
const ROW_SEALS = {
  forms: {
    'APP-003': '9641c691ebc1da4f63da3af1a64e027d437bee6b9f790ee4a22d06a53b4b5688',
    'APP-004': '91c83515c61e4e0a20ac6cc52383dae16eee159e9913183f3761cccb1c08818d',
    'CMP-009': '838d5a5bfa047bed0e46fba1df13992aec32154535ea4cd181c8a3ac7f7d5543',
    'PLY-030': '521b14cc875348b5d886def33b38333acb99f7e5bde72fed4982e202fa48d5fe',
    'NET-003': 'c689349559084c5686e5eeb56a7a689fd7caf3ba3407fc8eb7b516a6a9f2f766',
  },
  journeys: {
    'J-LOCAL-SEATS': '23402306941fe616bf67dda8d31dd6b3ce6720bf954552f105122d8ebdf96001',
  },
  coverageRequirements: {
    'REQ-003': '8c0f1e21e7910fe3fd57af77c556bdcb46cd70614ab91ef1162f5603f896e6e6',
    'REQ-006': 'bd33eac4d0763b23a9a15f32c93a275e633b47d9760e06db9cc1bca51e5c148e',
    'REQ-009': '89085b7446e73c138cba5d43a5ebed63e5e5de2e82f4fb38ddc5601d7094fdff',
    'REQ-010': '8f653b72cb6b04f1e887ba46a027d458392854270e223583edf756047de81abb',
    'REQ-029': 'c346c644b9ddd85da1488e18302238018b8a8483ff9cf8d72d5789004b659acc',
    'REQ-052': 'a6fdf3eae65db6ff1415fe4d1d8f43a2ed2da28f53f6a370f9c8895b6b0fb6bd',
    'REQ-060': '1bcb5344a4ef33802295a7ec36fe6d52e318d3aa4b9c7f1eccca6a57b839926b',
    'REQ-063': 'eb9e6f5c1c590e176356acd68b86a35ffe6e07510db60d4fa8ad45a98679b301',
    'REQ-084': '7c6e08e533aaf99ff5b094b2d6843008162afd5c2f719edd7d944eb1f35e0782',
  },
  qaScenarios: {
    'QA-FORM-APP-003': '01b52339563ed15b54734d84d65b3b70722990e19d721f01b768e45359dfd22d',
    'QA-FORM-APP-004': '8d7f1f93364794c1650b68e47dc51b6f5106f3db18187139448ecfc29d2e8fa0',
    'QA-FORM-CMP-009': '4a295ef7a42e6d6b29c9938fb2cd8cfa692b488ea59586f91f84446108369da7',
    'QA-FORM-PLY-030': '759bd9cfa1a57bf5f945efa63cbc7ff95079cc31f926e62528365d10c54267dc',
    'QA-REQ-006': '5325030e32c78bd69143f2625437cae32103fca07fb01ec58b709fcc43ef5104',
    'QA-REQ-010': '7b2c0bb058303302789746581bde742f29405e02531ec87aa133e7b46395d252',
    'QA-WORKFLOW-UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK':
      'a57485b83de4de24f1f5ba3d1e07db22d3bb3ed04a04b36421a40e6b26324536',
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
      'a269aa6c75a06344390a3389462b8d1ec0080390e249b95d17f85781d75d83d6',
    'UI-CMD-LOCAL-OWNER-PROFILE-CREATE':
      '20df171acb649bc6a28d37172b0b29b15622b616256b72522793ce502eb96899',
    'UI-CMD-LOCAL-OWNER-BIND-FINALS':
      'e0cf3aad7da729258588fe8236e161c3c5f308185e97598f82007e212ccd96e6',
  },
} as const;
const ROUTES_SHA256 = 'a50f340e961a64ad7b17c06c0f29d87f84f4418921e1dd20042352a075f0b6a9';
const MARKDOWN_SEALS = {
  '### Передача локальных FINAL конкретному профилю — B18 (#249, ADR 0095)':
    '646c58bb70d62c2dc0c4cc184426bc4e1abe874c9b855519ae33c8fadda4ef18',
  '### APP-003 —': '0c080e4bc0c79e424b78224249741ca0ba55ed3f33b33d45efb75c13be09c232',
  '### APP-004 —': '28423282318cb468f53aa0382d0dabc1cb9a2daa0eb7c512b5c6edeb22f58d4e',
  '### CMP-009 —': '8e048e052f93675ab62f5092309e6a0e18a885f8b44f1ea107f770173f88e9dd',
  '### PLY-030 —': '45a98eb07c7cbefc46d624e9b3e49ad2d19d7341604e30272ade38d11502d844',
  '### NET-003 —': '1c80d9d1c43774310909cda16d4f15458c9a19e2b43ff4ec69e3869db099f9eb',
  '### J-LOCAL-SEATS —': '40b2d0e3c6e80c2dc3075cef687875bb18e0c3cee3baf6546869a2bda2848e52',
  '| REQ-003 |': '808d97c7c13a6e482dcb992a99c80114f920da7f5a70c63a67cd6935c4cb98d8',
  '| REQ-006 |': '303e3e60e1b7f583472943eb9e7ab88fd32a5ed7a82df423f26ba0d19a924acc',
  '| REQ-009 |': '35d9a900652d5237b3ca2d9b2d105b4665b45b70a95aaf09b84a49103aee167e',
  '| REQ-010 |': '11d0e03142cb940a018ecb8bba2e22990c3337c0b6313d7d23546334ba6100d5',
  '| REQ-029 |': '79f655215f8df4d2622969d4b994c1a3018c4f7e41e8d9abbd6086a4224a8815',
  '| REQ-052 |': '1cc6eefe4550fc216431845aa95bcd756ea9ab1fa446f7401724d4490a51688f',
  '| REQ-060 |': '896596d1ae48b27ff8afbec503e07b6eea42c3a9467d49939cd30d0c5127e2ee',
  '| REQ-063 |': '14cf1fd646e7f2541a41ff55aa87aaaac45161e9ebe93cdf62212baa7b04efbc',
  '| REQ-084 |': '1438ca9a5700903b7322bdfd96c1e9431c655299da438ba65f73d383cf8d348a',
  '| QA-FORM-APP-003 |': '499dd21a194bd91a257dcc10a465e3531e82334c81445dacb47e38f7cc2db083',
  '| QA-FORM-APP-004 |': '491c6992260c16c9b79dc8fa738ee1e060000d01168c34230a4dd401822c322d',
  '| QA-FORM-CMP-009 |': '19951f6099f5cef73c7a727137133479ccf7ffc5a24391cb99ec051917be5346',
  '| QA-FORM-PLY-030 |': '1aa88cc9471cc22db34a1a1bb9020250b9963bee7a898069928abda34b5f6ea2',
  '| QA-REQ-006 |': 'e4c2b7b72f63e58c3989c83d753cc26ebfe4daa3724c9abcd8721df3020e5aaa',
  '| QA-REQ-010 |': '1e3eac535aecf0822687e4cbb361684f9ec5f611823996618e939aae13c6752b',
  '| QA-WORKFLOW-UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK |':
    '0a59abb2aa106831d28b1cbe523bba6bb41ebda6eaeca0d76aa202af86f24992',
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
    '71bfdc9455eea1ee02c7bf12599eab85552d933b65bb7d03db438a3fccfa79f8',
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
  return jsonSha256(value);
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
