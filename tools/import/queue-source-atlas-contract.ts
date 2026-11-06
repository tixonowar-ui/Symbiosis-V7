import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.11 objects, authorized by decisions 1–2 in #221 / ADR 0078. */
// Intersecting witnesses include the accepted NPC time/import amendment in ADR 0078.
// Intersecting witnesses include the accepted normal-transfer source amendment in ADR 0079.
// Intersecting witnesses include the accepted frozen-recovery source amendment in ADR 0080.
// Intersecting witnesses include the accepted initial NPC trauma source amendment in ADR 0081.
// Intersecting witnesses include the accepted NPC source consequences in ADR 0082.
// Intersecting witnesses include the accepted fresh Trogr source clarification in ADR 0083.
// Intersecting witnesses include the accepted custom item source clarification in ADR 0084.
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NET-016',
    sha256: 'ef4090461c958c718888daf0a2be9b1b9af7a6927f773a0cab92955293f0d239',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-018',
    sha256: 'c881977adb18e2c77a78e098c22e96a4b0b9023a7924e2325d1bc986d87682aa',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-019',
    sha256: 'eada98fe4c06201a883518c296999f8d6f094ce5e199d501d434b089116e9f95',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'PLY-030',
    sha256: 'b54d89dd2b58491ef338424c7095dadb3caa4676ab699e9ad6d58af467473cd6',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-003',
    sha256: '9d74aba980af6abb7e5c57aed109773260e046081b877d0ead3b86c53459957d',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-007',
    sha256: '70b99d0e7513b52be9fc1b805800f4199541bdd20be1785a9ac176e53a68a4ef',
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
    id: 'GM-002',
    sha256: 'a17861cd5d9c39810135cec1e7213aec88799d8e65e40e2189dd72cf31c2d312',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-016',
    sha256: '873ec35af41e7b12f0ba4a83f33a4834b4d61f0afe8c3cffdda4042812454dc1',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-017',
    sha256: '12cd01c265451aed66cd8e9d7f560bba4955d37560368d6279ee7ec63f7d53e8',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-GM-IMPORT-ADMISSION',
    sha256: '4f59fb96f9abd5eb72517d4e2fc3896972cd82f927557d4aeab571cb2d476770',
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
    id: 'J-NPC-CREATE',
    sha256: 'ef2fee0c8cf75d0dce724b443c95e777c024c7a8dcbfe1a2c3480b2cb63d5986',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-GM-CHAR-OPS',
    sha256: 'b299211aea60be3c8be4f24e5974ff1eeeb60f20ee86feed8dca14cb31e83102',
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
    id: 'REQ-006',
    sha256: '7c51e510d6406614166d3bcf3a8b70f05b805c4feb8a7d11bfa7db51d5d7343c',
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
    id: 'REQ-011',
    sha256: 'c36d4bb600d3b9dae0de520265d72c5d9c2089436111cb3f1157bd7fa8adaa60',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: 'bdcf9f8227f5d4eabfae3a4e61bd4987ad8b7ac26fb82aba747ec87f6fbcb310',
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
    id: 'QA-FORM-NET-016',
    sha256: '2f31c4b548bc2210b50cb950c68ec38d4e9d2849592d5c39297445b20a8902b8',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NET-016',
    sha256: '1c272e0e36f74a30385a4e8626fb956f6c7dced495b8842577980b263a9e0fea',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NET-018',
    sha256: '49420d85a7805fc46fe220981d9688c4a8508a78a6d309b28bbea8c010aabf29',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NET-019',
    sha256: '9f4c999ac3ab30572b5f1517a58785bd258c192ec32341b753d291dff8acb1ca',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-PLY-030',
    sha256: 'fa3c258500d56c9b5eb4315d7cb8ebb771e25ee9899b48c1dbe9ef9cd1c6edec',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-PLY-030',
    sha256: '6195e933b3344709f3df618f21fa8ad6bc1dbd9ca3f8afa876f910e5d3158e49',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-003',
    sha256: '56dffa0955938c488a86ebc215290424da9b637a7cdb393ab3eef962a8f7356c',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-003',
    sha256: 'eda8dfd1169e0c7170a7ee9c2a9aafb522a21fc4d3ee4ef0509c282432eb86f1',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-007',
    sha256: '5dd25965f6c34436687f0c45663425983f1622208eb99e88624e22a67a8e4c31',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-007',
    sha256: '1e851b55999fc760e21e16556fca1842fc5a4dbfd30cdd68f60c31ab65ec13d0',
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
    id: 'QA-FORM-GM-002',
    sha256: 'd0a043c9c90ff546258d637b99784b9fb8e075a11b81ec1a181066078ef33788',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-016',
    sha256: 'be6aecb1fb06c63214c988ca69fcac6b96039311dab8602a5dfe7012ff411ff6',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-016',
    sha256: '62d1d24a91f2c50dcde0d11743b3361a1d628cbc847dc881a62ac4eec1b567c1',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-017',
    sha256: 'e1e8b225a326267bdad6aacf1389a34c353b951d07f00effcff4ba019c9cb698',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-017',
    sha256: 'cf21605b8d3cb8085bfa5f185ef984045ebd3e7c39072eb5c7da2bff1793192a',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-006',
    sha256: '41423d4e10045a4f4e015d2616f7e3757b75e7c82afaec6106cdd2e0779f2e3f',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-009',
    sha256: '96324459365f6709f7b0d6c7ae90ef6bb14ea996a32cdbe23665ffbc7e06cea4',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-011',
    sha256: '3b161a3333ec236eeb052fcebdc47be4dda0cfeb4f49cccf742001553d9c27f0',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-012',
    sha256: '85ded72be22eab38952bfeaf379d2df8f7c2ca039c4f909ef90f3ea26db34a44',
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
    id: 'QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1',
    sha256: 'e77475a88f762fe68e67c02e9b03f2cc6cadd54204c8f59b1d031313a8a817ed',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION',
    sha256: 'f98b42acc7c82d3ede56e8eefb5e1b43f9de0298d10407e6b9e8f5508270cbb0',
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
    id: 'QA-WORKFLOW-UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK',
    sha256: 'd32e272aec15e637e151c2e80c3b55dd43d87a580583f7048e5a57dc1b6bc032',
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
    id: 'UI-CMD-NPC-COMMIT-V1',
    sha256: '70a4a1c5807b9474f8d71e8b4a3af52a9f22bb0f532f5408ff620d3c8859e64a',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: '06bfae017b94e8fc8e8bf9355e66cf1f7a22c0ca8af65a2775f0540c70cac3ab',
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
    id: 'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK',
    sha256: '369df38729e4cb1b90117a21cc1c5867d9bc316da9f315021ca7b1d64b33c2d9',
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
    prefix: '### NET-016 —',
    sha256: '48a4d637301563b4d6fc4d64480420975eca0f3d3b8cebc89fcda2e38bfbb8f8',
  },
  {
    prefix: '### NET-018 —',
    sha256: 'd2d436a5677301742c0e8fc17f416622b1ebdd6376493ba8e7a4f705ccacd51f',
  },
  {
    prefix: '### NET-019 —',
    sha256: '6c832e45b0eef825f3156b62f1b9548c959ddfa6c1f91146f0afd0f908671e58',
  },
  {
    prefix: '### PLY-030 —',
    sha256: 'a36ee4bcace06a0f0e65dbdd74510f6810162c54d7fe2f97c3fa83c23f3a44aa',
  },
  {
    prefix: '### NPC-003 —',
    sha256: 'ad07462c4cbcb2ad7e7561d6ad71297c63cd615570d40eb3da53320478286a0a',
  },
  {
    prefix: '### NPC-007 —',
    sha256: '94d8dedd331b5e9d15645a5259bb6e0fb6e2e0b6b1542d52433433d62874cb50',
  },
  {
    prefix: '### GM-001 —',
    sha256: 'f880661a65bcc4cf682d963cdf3fba06d03c5411b5341b9f5805926b8d660833',
  },
  {
    prefix: '### GM-002 —',
    sha256: '724f00ccbc97f9b5d62b2241ad74495d3db1d3117c31e45fcf5f74fdab80bbbb',
  },
  {
    prefix: '### NPC-016 —',
    sha256: 'eeb31feb535dc85d7808d50e27c447c963820dbfd41f9edc4fcfb8bc16f63b83',
  },
  {
    prefix: '### NPC-017 —',
    sha256: '1e3db0fda4268019781710f2f5260c9f786ac9dfb9a9f0b1ae87419424dbe476',
  },
  {
    prefix: '### J-GM-IMPORT-ADMISSION —',
    sha256: '110e478c237f041eae70832afa5b588e3c81b554c00ac9ebc10fbd4264635ce7',
  },
  {
    prefix: '### J-CAMPAIGN-CREATE —',
    sha256: 'ced4eff0f8ec279a85d42bfe5469a8320f9a90d7bb4749795468c989425b29e2',
  },
  {
    prefix: '### J-NPC-CREATE —',
    sha256: '7bc2fb4207600bae1bcf84a778b7a01a252615241ba4cc412ee14429d2dc73c4',
  },
  {
    prefix: '### J-GM-CHAR-OPS —',
    sha256: '37eccb2831c2904fcfedf99eac1c36d82104fb6f838188d4d26e83591fd5ccb6',
  },
  {
    prefix: '### J-HOST-PUBLISH-SETTINGS —',
    sha256: '0a19c33bab85b7ec26e9df2510d1a54d08e8f56cf63f58b48adcf9a669059243',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-006 |',
    sha256: '2a77c4df115db3955ab92425de612c9416617a3a514b0c0285a995c638e309f6',
  },
  {
    prefix: '| REQ-009 |',
    sha256: '7976e40c2b2d29c972d2873570006d217066d65778218a442375ffdd00e8b8da',
  },
  {
    prefix: '| REQ-011 |',
    sha256: 'bc30550ec397f2cba9c5d2534f4fb61891a4d387951e8b33478918bc14f97f3e',
  },
  {
    prefix: '| REQ-012 |',
    sha256: 'b977f439a924092178f9d17ef4a98184963028cd5fdce8f6c7b4766bd29e00d6',
  },
  {
    prefix: '| REQ-055 |',
    sha256: '846b8025a23789276d38d4595f075e302bbe33b8b3d0847ec200da9428d9b1df',
  },
  {
    prefix: '| QA-FORM-NET-016 |',
    sha256: '505b9868d4d8daf52381876cf5cff4fd0d94fd232323fb072bc272d978fd4a65',
  },
  {
    prefix: '| QA-CHANGE-NET-016 |',
    sha256: 'a848b0711fff993fa13d8fbf89287b7b9d0b967c4c2bb4e2329926bb99a2b8c0',
  },
  {
    prefix: '| QA-CHANGE-NET-018 |',
    sha256: '170190e5617cbed6c2436c9fcf3a37f64d5384f4304ef98c431accffcb976adf',
  },
  {
    prefix: '| QA-CHANGE-NET-019 |',
    sha256: '62a1b248d43bed0e74709d260120e3e69e00b8bf0abb3102ccac441b20fc2da3',
  },
  {
    prefix: '| QA-FORM-PLY-030 |',
    sha256: '55bba95ad3e8b6d3e06ca06c2f883f775df218942d2e1227c906db10766e99b3',
  },
  {
    prefix: '| QA-CHANGE-PLY-030 |',
    sha256: '6d08170003a9a6ef2b7e0cdb1cdc6f8ff9a8554c640adc21f9381cc7c3790d1a',
  },
  {
    prefix: '| QA-FORM-NPC-003 |',
    sha256: 'a584118675cd5229030084c9cbc16c44709eac747aed3a09259953d18ec4b75b',
  },
  {
    prefix: '| QA-CHANGE-NPC-003 |',
    sha256: 'abdc3c04f479f19e8cdc97432d8095acf77da009a46b5cb8463433814386f0c8',
  },
  {
    prefix: '| QA-FORM-NPC-007 |',
    sha256: 'a1e5db1f06220a257069ec377abb6a6f186eeab09d4f615015049240593771b3',
  },
  {
    prefix: '| QA-CHANGE-NPC-007 |',
    sha256: '353930ddd08403a08aeff1ed936108be758ed61d895278b7bb58248621a8fbd2',
  },
  {
    prefix: '| QA-FORM-GM-001 |',
    sha256: 'b5b0098fdec542bed9b216cdc2e5bb1239ada5161b06d8db551534567491db4d',
  },
  {
    prefix: '| QA-FORM-GM-002 |',
    sha256: '2ab9e5393e28f401c239c562f5319b5414020258a412e871de27a575b2ea62d8',
  },
  {
    prefix: '| QA-FORM-NPC-016 |',
    sha256: '74599eec6376f6445ea8a6420ca90c095e0f39dd31b21beb91abf25ab8d994db',
  },
  {
    prefix: '| QA-CHANGE-NPC-016 |',
    sha256: '893c804ac63c3e109c295143367ba6d85d6335b22fc578c55a8965ad0668befd',
  },
  {
    prefix: '| QA-FORM-NPC-017 |',
    sha256: '852fdea5e859e2a38a479fa0168f50ab81b6cb103fc4becee22c3b4cb27751ed',
  },
  {
    prefix: '| QA-CHANGE-NPC-017 |',
    sha256: 'e4e5aa41360a508a54ba697db299bc77635f7ee6c0ed4874bc28bd98ee205b5d',
  },
  {
    prefix: '| QA-REQ-006 |',
    sha256: '0e5adefeff7dc996b5aaab5a83f078d1ac3f9b5313441bdd278689d2a996e8ae',
  },
  {
    prefix: '| QA-REQ-009 |',
    sha256: '6bb2ef2b9185fe7c46f0c6e16e4e2537dfe601043be701c311b0f5213b069354',
  },
  {
    prefix: '| QA-REQ-011 |',
    sha256: '2882d11aa09b84b3101cae495972950fea0f57c08d1eefabd866187ccaf3becd',
  },
  {
    prefix: '| QA-REQ-012 |',
    sha256: '8bb1e068862876c2cf0067c49e4f8c25c60e8320d81a8a77b6762ba78d6b0e5a',
  },
  {
    prefix: '| QA-REQ-055 |',
    sha256: '0ba6e842dc2febff9e0163291ccf7e77550dbe451ced829fcb0cbcb23488b1fb',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1 |',
    sha256: 'd41a98d9317ff77fbdbf117fc2b7609c7a9f76da914ab8e9070368d73e6b940c',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
    sha256: '143dfc96be23b8580f059991ec4e3f4e3130109b5f9eddd36bbb8d4623d2d4c9',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-CAMPAIGN-START |',
    sha256: '02e716fb2aad9cfb230312b821df962b65cff07386113a8501483083a6d926f3',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK |',
    sha256: '4fc05362a346dfcd85278d8722182a90bc3ec4b90f75a1ad8f6daebeb657165c',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-CAMPAIGN-INITIAL-TIME-SET |',
    sha256: '5ea239ee4919daf7e079e887f3fc1a17db20b8463c598b19ea331b2eb017b278',
  },
  {
    prefix: '| UI-CMD-NPC-COMMIT-V1 | Атомарно сохранить первую версию постоянного НПС |',
    sha256: '8e301b3d944fe9835b6b535ccb821a74e7bb3a38d98780beb9f4bd1b53bdbef5',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: '779294513d0ed96a7f5bcc3b97f42214250f57250d0b7124eced8111d4ae7950',
  },
  {
    prefix: '| UI-CMD-CAMPAIGN-START | Запустить подготовленную кампанию |',
    sha256: '0910b58da01910739533b110ac5aad4bd0bb24e6bd4b7d0ae65984d4fa1f0bb8',
  },
  {
    prefix:
      '| UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK | Подтвердить локальную privacy-передачу активного контекста |',
    sha256: '030aa99f511173f3893a7ced1b7b311dc7884509d45e093bfb2e53a9f3b06956',
  },
  {
    prefix: '| UI-CMD-CAMPAIGN-INITIAL-TIME-SET | Сохранить начальное виртуальное время кампании |',
    sha256: '2ee310e42c08f3b25633b7d0449e8243c2816cb645aef8e3d5ec516d40478b5b',
  },
] as const;
const WHERE = 'atlas ADR 0078';

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
    fail(WHERE, label + ' differs from the approved queue source contract');
}

/** Whole objects include authority, fields, draft variants and both local route mirrors. */
export function assertAdr0078QueueSources(root: JsonObject): void {
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
export function assertAdr0078QueueSourcesMarkdown(input: string): void {
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
