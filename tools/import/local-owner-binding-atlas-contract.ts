import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fail } from './lib/fail.js';
import {
  asArray,
  asObject,
  jsonSha256,
  ownerAtlasSeal,
  type JsonObject,
  type JsonValue,
  type OwnerAtlasWitness,
} from './lib/json.js';

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
  modeActions: {
    b18: '2e80b6cf2f78fd2c580fdca63f69e0e3a0c2c737a2e9cf7224cdc91e14f28060',
    b19: '34a11f5acc9929bbd7dbbd5d33dd184058d3f8ffe5644955fc51462e79cec605',
    b20: 'cf9f98c242775c1fd2efce662fdc304920f4e0cb45ceccdc6663db55c1809fba',
  },
} as const;
const ROW_SEALS: Record<keyof typeof ID_FIELDS, Readonly<Record<string, OwnerAtlasWitness>>> = {
  forms: {
    'APP-003': {
      b18: '26eedeeca75aa66b0b6a32d575c969baca24546db44730bff5333afe1c229fe6',
      b19: '9641c691ebc1da4f63da3af1a64e027d437bee6b9f790ee4a22d06a53b4b5688',
      b20: '8d0da07fb4768cfa8f2a47a26e83fde9d6c8484f9a73f3f5d86a6d32c8476651',
    },
    'APP-004': {
      b18: '14d68285828f8a0966678c456eaceeed90e2b3b08fd06a8fc2e9586da1a40fd3',
      b19: '91c83515c61e4e0a20ac6cc52383dae16eee159e9913183f3761cccb1c08818d',
      b20: '9883d789059ca94173b4b77f4f54cc5d58ed3beac22b658524a443c5982742e3',
    },
    'CMP-009': {
      b18: '894a1189aea796ecd8aa0898171dcfffc7a0ff424562e4c91b0af7a509024b46',
      b19: '838d5a5bfa047bed0e46fba1df13992aec32154535ea4cd181c8a3ac7f7d5543',
      b20: 'f7ff86f4debc5f9cb26f2f871c945d3d48466673c910da1acd7eb7d87bb9214e',
    },
    'PLY-030': {
      b18: 'd672645e2d901274d1e84716857868e784ea679a1faa488cc27b8792c27911a4',
      b19: '521b14cc875348b5d886def33b38333acb99f7e5bde72fed4982e202fa48d5fe',
      b20: '72ff40fd26fae74f1c9ff7110e7ece5cea42109657a45ee7437b1413e97b8fb8',
    },
    'NET-003': {
      b18: '152b78134a44ce40a990c581293402c014fb5effaa2a27b8c328df13725c745f',
      b19: 'c689349559084c5686e5eeb56a7a689fd7caf3ba3407fc8eb7b516a6a9f2f766',
    },
  },
  journeys: {
    'J-LOCAL-SEATS': {
      b18: '2fc91405cc46c6f505c720d4d0f51c2cc6c570166f9862726b96805888d2f191',
      b19: '23402306941fe616bf67dda8d31dd6b3ce6720bf954552f105122d8ebdf96001',
      b20: 'c9747ec9311f3592b5f0364a5bc6e1a8c313c9e12eae16e698789387b14d7911',
    },
  },
  coverageRequirements: {
    'REQ-003': '8c0f1e21e7910fe3fd57af77c556bdcb46cd70614ab91ef1162f5603f896e6e6',
    'REQ-006': {
      b18: '253fb042ddd15f43965016fc16393c5a9be92a5e2171acfa2c8f6e93508e74af',
      b19: 'bd33eac4d0763b23a9a15f32c93a275e633b47d9760e06db9cc1bca51e5c148e',
    },
    'REQ-009': {
      b18: 'c4553925c86d2a48705a5e8796bf3d63502499c483167ff3ba6c6cd05674778f',
      b19: '89085b7446e73c138cba5d43a5ebed63e5e5de2e82f4fb38ddc5601d7094fdff',
    },
    'REQ-010': {
      b18: '31758668abea13b7a70a6f22e3041ffb4a75e3d96bd17f3c1ac55a3ea02298a1',
      b19: '8f653b72cb6b04f1e887ba46a027d458392854270e223583edf756047de81abb',
      b20: '40de3b8c4467ba5626a4752d4dae7983da16b420da00e3a716275d47a7d8e7d9',
    },
    'REQ-029': 'c346c644b9ddd85da1488e18302238018b8a8483ff9cf8d72d5789004b659acc',
    'REQ-052': {
      b18: '0bcc17c5940183c1e828e7ef6eb9b3bf90a0e6d412985dc69cde2f8ab0c59163',
      b19: 'a6fdf3eae65db6ff1415fe4d1d8f43a2ed2da28f53f6a370f9c8895b6b0fb6bd',
      b20: '4711e0db81919cfc24c98e5ccd994e3fb7d9a8c38dc686cb6e6387292ffcb60b',
    },
    'REQ-060': '1bcb5344a4ef33802295a7ec36fe6d52e318d3aa4b9c7f1eccca6a57b839926b',
    'REQ-063': 'eb9e6f5c1c590e176356acd68b86a35ffe6e07510db60d4fa8ad45a98679b301',
    'REQ-084': '7c6e08e533aaf99ff5b094b2d6843008162afd5c2f719edd7d944eb1f35e0782',
  },
  qaScenarios: {
    'QA-FORM-APP-003': {
      b18: 'a5b6b609e3d9d08cae84ba044a131044c0f27ae4789c01a2f1f77f17917c4396',
      b19: '01b52339563ed15b54734d84d65b3b70722990e19d721f01b768e45359dfd22d',
      b20: 'd2e4a21bcece36aa930c916cd9b5871a7c8cce660d75b51d37c9a3cae473d5a7',
    },
    'QA-FORM-APP-004': '8d7f1f93364794c1650b68e47dc51b6f5106f3db18187139448ecfc29d2e8fa0',
    'QA-FORM-CMP-009': '4a295ef7a42e6d6b29c9938fb2cd8cfa692b488ea59586f91f84446108369da7',
    'QA-FORM-PLY-030': {
      b18: '0c0db3e03bfc0194ddceab93aec0fb1745662277ddc09d657089448599190903',
      b19: '759bd9cfa1a57bf5f945efa63cbc7ff95079cc31f926e62528365d10c54267dc',
      b20: '5c569036430f93fd2706b69731b47de03a239da47d7da15089ec7f4f55337594',
    },
    'QA-REQ-006': '5325030e32c78bd69143f2625437cae32103fca07fb01ec58b709fcc43ef5104',
    'QA-REQ-010': {
      b18: '2f04531b3d2adbabcd1a9160cf14fd9f076c9d59d4a459be1c573fe78cce787a',
      b19: '7b2c0bb058303302789746581bde742f29405e02531ec87aa133e7b46395d252',
      b20: '1a756467879c5e49f9d693d7eff53e89611b462d8a0968cde8c4d5c7133232aa',
    },
    'QA-WORKFLOW-UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK': {
      b18: 'ed2332c0e68e664fdfb27fe81c0237bfa3821cb188c8d3cb7f96f86388cfba5d',
      b19: 'a57485b83de4de24f1f5ba3d1e07db22d3bb3ed04a04b36421a40e6b26324536',
      b20: 'ba782379715cfa6a7859e9c9182b013810245736f7ad116cafc914b38de66645',
    },
    'QA-WORKFLOW-UI-CMD-LOCAL-OWNER-PROFILE-CREATE':
      '601f0268252455e79489c162f3e6c27207e64c50d88def2f99b7adca3b3a5bd5',
    'QA-WORKFLOW-UI-CMD-LOCAL-OWNER-BIND-FINALS':
      '29d5e450ff4a00634f9eac8f7d45dade8c3f7216de1869b9c2ff4f5c254fd52f',
    'QA-LOCAL-OWNER-LIFETIME': {
      b19: '6d954ffc856cfdc28ec9cb132dea246ab7b3092844b6a17cf70ea29225bdad30',
      b20: '98ca0e401741a058ce33d3b93026cd27f76d80878f4300b39af770d0e68e55b1',
    },
    'QA-LOCAL-OWNER-TARGET': '89081b2c588693f3d0b99fbd96f88ab87aae6bc39eebef6479fa4ade026b1533',
    'QA-LOCAL-OWNER-PRIVACY': '50169f1ff82d3db49f40e54a07e63a3a2564768228ec6db4cebdc42806a47c81',
    'QA-LOCAL-OWNER-ATOMICITY': '80812167996d7ce5b41b9f63470363a429f8f80bd42c71b0415dd619c4f8b7b2',
    'QA-LOCAL-OWNER-RESUME': 'd4e46930cfebaf4f094a229175df02d830796f3fdda6d3c4593b67ca7d460923',
    'QA-LOCAL-OWNER-ADMISSION': {
      b19: '4382552836f0367e1f691f1d28a8d0f29772639e9230e7ea4991996662f32df7',
      b20: '4f1c9493a617f836d897eb62eefa7f8784074857b05ae792d233a6d76ae0918f',
    },
  },
  workflowCommands: {
    'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK': {
      b18: 'a807fd2e6621b6bd6d97c12091afeb8ce12ca763db35f5bca955e76bafdb55cb',
      b19: 'a269aa6c75a06344390a3389462b8d1ec0080390e249b95d17f85781d75d83d6',
      b20: '7ae6a5c721df736ade1f317723f83669d5fffb96c7ed4959f6e1ca43dd476015',
    },
    'UI-CMD-LOCAL-OWNER-PROFILE-CREATE':
      '20df171acb649bc6a28d37172b0b29b15622b616256b72522793ce502eb96899',
    'UI-CMD-LOCAL-OWNER-BIND-FINALS':
      'e0cf3aad7da729258588fe8236e161c3c5f308185e97598f82007e212ccd96e6',
  },
} as const;
const ROUTES_SHA256 = {
  b18: '5e674a6d1ff67f7b08054279d24f5a241b1aa6b2116a3b1b73e4bab4ad6e90d6',
  b19: 'a50f340e961a64ad7b17c06c0f29d87f84f4418921e1dd20042352a075f0b6a9',
  b20: '654b887c464f66f35fb0b8e5ce40d6a0c45d376cb46fec60d3b520b58c809b99',
};
const MARKDOWN_SEALS = {
  '### Передача локальных FINAL конкретному профилю — B18 (#249, ADR 0095)': {
    b18: '650f4d999cf752880fa18608a02a90ff336a4467f503d8dff0cc0f0521b08ab0',
    b19: '646c58bb70d62c2dc0c4cc184426bc4e1abe874c9b855519ae33c8fadda4ef18',
    b20: 'dbac105b9bf2f93162372e30b9c92fc140679afe4e5adf1d52368695fbb55110',
  },
  '### APP-003 —': {
    b18: '3ce1a2ad02bf3bdeef3334aa6cc00b867b5bed4e0b32a4dcc09b69ad76901ee4',
    b19: '0c080e4bc0c79e424b78224249741ca0ba55ed3f33b33d45efb75c13be09c232',
    b20: '0b8f2f34c2497bc22f0dcff2a04f0a438268106593cd55bf2b95053c46f07558',
  },
  '### APP-004 —': {
    b18: 'e6c827174a1e30fd78691eb4ec68cf00dca2c9f5a0c3ee9c6137110f469afe03',
    b19: '28423282318cb468f53aa0382d0dabc1cb9a2daa0eb7c512b5c6edeb22f58d4e',
    b20: 'cc1c8546fd866cd92293b6a0ddbc7523014510bbe0136a87321071f17625cd00',
  },
  '### CMP-009 —': {
    b18: 'f13f3b32d9b9766f1567d6dc3324f1fee5b108c3d7f6599fe8801b009bb70f92',
    b19: '8e048e052f93675ab62f5092309e6a0e18a885f8b44f1ea107f770173f88e9dd',
    b20: '0d4298458ba339e88175962a3558f0e40c51de2ee831e76a376a34ddfe98e05e',
  },
  '### PLY-030 —': {
    b18: '8c40db93fd643386f857190a0a284731c4a3e7c20165c85053139caaa95b5a5b',
    b19: '45a98eb07c7cbefc46d624e9b3e49ad2d19d7341604e30272ade38d11502d844',
    b20: 'a8e39750f947dda636d11149d4c5c4010ba3f563bc97ebc24f6640096326a9f9',
  },
  '### NET-003 —': {
    b18: '7d10455c77c4f3fd9e198685f8169469d8d5ad67b2ff000192edc89354f1d5a8',
    b19: '1c80d9d1c43774310909cda16d4f15458c9a19e2b43ff4ec69e3869db099f9eb',
  },
  '### J-LOCAL-SEATS —': {
    b18: '8925122df3029020c68889fe2146ddbe45e6e3f1798d3a6b4cc3b4f1d79b39e3',
    b19: '40b2d0e3c6e80c2dc3075cef687875bb18e0c3cee3baf6546869a2bda2848e52',
    b20: 'd148d98b36bc7b4b437a503d5c8158ef86669a220ef5502e9928860dd124ecc3',
  },
  '| REQ-003 |': '808d97c7c13a6e482dcb992a99c80114f920da7f5a70c63a67cd6935c4cb98d8',
  '| REQ-006 |': {
    b18: 'c1a0114f7e02a130ad5db0b79553bc97f13803aae6717c9b075544196d803bac',
    b19: '303e3e60e1b7f583472943eb9e7ab88fd32a5ed7a82df423f26ba0d19a924acc',
  },
  '| REQ-009 |': {
    b18: 'fafe8a7f839bf2d0f3d1206777d0ee2e181e9a17f5e0788b11a80eb72260ba14',
    b19: '35d9a900652d5237b3ca2d9b2d105b4665b45b70a95aaf09b84a49103aee167e',
  },
  '| REQ-010 |': {
    b18: '88ddfb4b86ff3198e00c02d14e8f8741460f24495b9b7c3f3bb9479c94dc6a1e',
    b19: '11d0e03142cb940a018ecb8bba2e22990c3337c0b6313d7d23546334ba6100d5',
    b20: '9257e711ae14fa3f632e1dfc6abd388c210e87cfe2d4a0dd34bcd4a3ff3325f2',
  },
  '| REQ-029 |': '79f655215f8df4d2622969d4b994c1a3018c4f7e41e8d9abbd6086a4224a8815',
  '| REQ-052 |': {
    b18: '9b9ac7949e4185c8b3533e0315a0f454576cd34e2a9e678cc6696b5746ad3fc8',
    b19: '1cc6eefe4550fc216431845aa95bcd756ea9ab1fa446f7401724d4490a51688f',
    b20: 'd53f501de63d38121cade1e913f9121f50e5795162fd855af95176c2c58e590e',
  },
  '| REQ-060 |': '896596d1ae48b27ff8afbec503e07b6eea42c3a9467d49939cd30d0c5127e2ee',
  '| REQ-063 |': '14cf1fd646e7f2541a41ff55aa87aaaac45161e9ebe93cdf62212baa7b04efbc',
  '| REQ-084 |': '1438ca9a5700903b7322bdfd96c1e9431c655299da438ba65f73d383cf8d348a',
  '| QA-FORM-APP-003 |': {
    b18: '88d4a00fbffa74db9b60cd1f65ac2e87827938be9e5327cc4788e2046fd2aa6f',
    b19: '499dd21a194bd91a257dcc10a465e3531e82334c81445dacb47e38f7cc2db083',
    b20: 'aae67c584e1e3ddd8321b4a07f9d1071db69595f3e1d54da060f257b39ea50ec',
  },
  '| QA-FORM-APP-004 |': '491c6992260c16c9b79dc8fa738ee1e060000d01168c34230a4dd401822c322d',
  '| QA-FORM-CMP-009 |': '19951f6099f5cef73c7a727137133479ccf7ffc5a24391cb99ec051917be5346',
  '| QA-FORM-PLY-030 |': {
    b18: '4959514d817c5357ee27bd493c7a9ce7f6ee8dc49c0c194c98d0d2e72d06486e',
    b19: '1aa88cc9471cc22db34a1a1bb9020250b9963bee7a898069928abda34b5f6ea2',
    b20: '9c6084dcad2fa4c7df14129ba1eb69f38ce1a0174206c628bf0d9c056ddfbfc4',
  },
  '| QA-REQ-006 |': 'e4c2b7b72f63e58c3989c83d753cc26ebfe4daa3724c9abcd8721df3020e5aaa',
  '| QA-REQ-010 |': {
    b18: 'e853803982b4a7030de77194d423243512eee7db6be26f496425ca7d0bf2a4e9',
    b19: '1e3eac535aecf0822687e4cbb361684f9ec5f611823996618e939aae13c6752b',
    b20: 'f8ec3b8f6b1ca0913f48d91d884525f23ae4f0f383d00bd0924ce136f0e1f20c',
  },
  '| QA-WORKFLOW-UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK |': {
    b18: 'cd1b27468e1e33c303192c1fd016498acd8e74fa13945d1e20556fdecc550dfb',
    b19: '0a59abb2aa106831d28b1cbe523bba6bb41ebda6eaeca0d76aa202af86f24992',
    b20: '05f1c5553ce127a4e19d884d80011eadcb6b69d89d3473ed77e3a04d7aff21c3',
  },
  '| QA-WORKFLOW-UI-CMD-LOCAL-OWNER-PROFILE-CREATE |':
    '0e2fdf1ca691a3344c07966a9b5ab49ad1ee1942d1f2b35497b2ae11ea1e312d',
  '| QA-WORKFLOW-UI-CMD-LOCAL-OWNER-BIND-FINALS |':
    'a54d78024aa4ac38ca7690b7d46af31056a0ecaf90511f0656d928865bef4ac8',
  '| QA-LOCAL-OWNER-LIFETIME |': {
    b19: 'ccd3af108bef6a3d6c420bfa33ffd9da52bb8c7a83e3aa8e18da131bdf3e16cc',
    b20: 'e5dc14218529947a562be504916b6ea62199727305ce3c28f502cf63b64f33f0',
  },
  '| QA-LOCAL-OWNER-TARGET |': '6124a799869b596499ace3b2f11e9ce04c005969ff4ae08babef4ca6f79360e4',
  '| QA-LOCAL-OWNER-PRIVACY |': '4dfc31e8d84446a536fdf2776f2873fcba16d1bc6ead680566f3946f903a5905',
  '| QA-LOCAL-OWNER-ATOMICITY |':
    'd42c3ded357d9e84964d089d5c3e3334bc6755562730fe8df377782e2306a90c',
  '| QA-LOCAL-OWNER-RESUME |': '7ebf46141a40b1c37b57ea1f8eaa98963ac0f109d52637c4b4423929ae467d88',
  '| QA-LOCAL-OWNER-ADMISSION |': {
    b19: '3ceac16ac933d2f81acfdd51502368dd5fd2595cd8dd34880412026508c0b36c',
    b20: '448acd2c3306f0f9781d172af34c62aaef9f73d26d7d19e1f724a2b8d120eca7',
  },
  '| UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK | Подтвердить локальную privacy-передачу активного контекста |':
    {
      b18: 'ff3733826637a5a66141a08205773c532d1dc16ff9be5eec8db3d35f244a96f0',
      b19: '71bfdc9455eea1ee02c7bf12599eab85552d933b65bb7d03db438a3fccfa79f8',
      b20: 'daf7fb3cc01dfcd946b63667acdcfcf4f283421938c9b01a25185d6834bb1d5f',
    },
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

export function assertLocalOwnerBindingDeclaration(
  value: JsonValue | undefined,
  version: JsonValue | undefined = '1.25',
): void {
  const path = 'globalContracts.localOwnerBinding';
  const declaration = asObject(value, WHERE, path);
  if (!isDeepStrictEqual(Object.keys(declaration).sort(), Object.keys(DECLARATION_SEALS).sort()))
    fail(WHERE, `${path} has missing or unknown sections`);
  for (const [field, expected] of Object.entries(DECLARATION_SEALS)) {
    if (jsonDigest(declaration[field]) !== ownerAtlasSeal(version, expected))
      fail(WHERE, `${path}.${field} differs from the approved binding declaration`);
  }
}

export function assertAdr0095LocalOwnerBinding(root: JsonObject): void {
  const global = asObject(root['globalContracts'], WHERE, 'globalContracts');
  const version = root['atlasVersion'];
  assertLocalOwnerBindingDeclaration(global['localOwnerBinding'], version);
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
      if (jsonDigest(matches[0]) !== ownerAtlasSeal(version, expected))
        fail(WHERE, `${target}.${id} differs from the approved source`);
    }
  }

  const routes = asArray(root['transitions'], WHERE, 'transitions')
    .map((value) => asObject(value, WHERE, 'transitions[]'))
    .filter((edge) =>
      [edge['from'], edge['to']].some((id) => typeof id === 'string' && OWNER_FORMS.has(id)),
    );
  if (jsonDigest(routes) !== ownerAtlasSeal(version, ROUTES_SHA256))
    fail(WHERE, 'local-owner transitions differ from the approved source');
}

export function assertAdr0095LocalOwnerMarkdown(input: string): void {
  const markdown = input.replaceAll('\r\n', '\n');
  const version = /^# Symbiosis V7 — Web UI Screen Atlas v(1\.\d+)\n/.exec(markdown)?.[1];
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
    if (digest(markdown.slice(start + 1, end)) !== ownerAtlasSeal(version, expected))
      fail(WHERE, `${prefix} differs from the approved Markdown`);
  }
}
