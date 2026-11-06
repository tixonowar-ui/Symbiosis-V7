import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.11 objects, authorized by decisions 1–2 in #221 / ADR 0078. */
// Intersecting witnesses include the accepted NPC time/import amendment in ADR 0078.
// Intersecting witnesses include the accepted normal-transfer source amendment in ADR 0079.
// Intersecting witnesses include the accepted frozen-recovery source amendment in ADR 0080.
// Intersecting witnesses include the accepted initial NPC trauma source amendment in ADR 0081.
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
    sha256: 'ef5e8a33d082e599e93542a0e6ea48322fe4d9790005ae9b176ba9110d26718d',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-007',
    sha256: '29635bcc369add6538bdefec7d2127d23e9da890f270550d9c2a861f329b5070',
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
    sha256: '1a0677035735da2eb14aac66433a8b8e0e9c93ef099124ec79fb1572d31da6b1',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-017',
    sha256: 'e3855c80eda754608bb46dbd1ffe107be0f21114a9051ab1a47d3bdac5dd89d9',
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
    sha256: 'f6120979ae14952fc419736a6356626aadd0aa5863fade0d10a52bbda79e8200',
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
    sha256: '162db3b81c614d9a1d77750f54a418b0311cb847cdd7920f664b5a2a791e626c',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: 'c1af0f0de034946fb3d730693fcbf0aa2dfe98e37e1ff5dbbc9386345f5688b7',
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
    sha256: '3fad213c7aa15de53ac71b91c70f6a74d0177218d6759ea411b0d70285ed9f93',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-003',
    sha256: '254f3597c3a1b29a8f01c72dbb74271e3c09583a9292b7d539b20f87b709856e',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-007',
    sha256: '4b4662675a222174717e2f5a2814ddc7fec1b4e1b9620e7dd02b83990205c064',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-007',
    sha256: '90534d68b0f0f2884e012dbfbf2e6f46bacffd243e8d02d9a2f4be6c26145ed7',
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
    sha256: '9c0f9df966023f0eb0ecbc220d9aba059a6caffc27053710f9e450018411bb8f',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-016',
    sha256: '5299b63c293963b9809773b3190db1810f628416bde434b6aab7f73828654b8d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-017',
    sha256: 'e1965bad7adde582a7785ddfb4a70e75eee290297dcda23487e5a1ba34c5dcce',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-017',
    sha256: '96e31aac722a85e13549a3b312ca7f86cac594c326d8583bee8a1a7f88431e47',
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
    sha256: 'f534f62076ad2389eccfc53f2e8c1b71c6957671f67b1c1f6f9d6c4789e98501',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-012',
    sha256: '5ed4616028dc6c72113fa7b725ca062f3397038e799cc89325344612624b8492',
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
    sha256: '82d8fe6bdc32cdd47a11f3451403faafd8111e7db868a8c9c409d960a27b8d58',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION',
    sha256: '68417879d4aadb3df8d9ddd09a0d391ad425bb89c8e99884b8311f04b7e89ec0',
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
    sha256: '18db12c1451d221821c094e5b055c83014e56fa91839c371bc56ee6af98563ac',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: 'ef6559268765d8173548889474663ff29a6fa98ebba6a03c5322bc478603ae38',
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
    sha256: '5c3348120a086133d0d54e204ccf3de10df4da2a42c5ea2c3c5a99149db8fad0',
  },
  {
    key: 'registryCoverage',
    sha256: 'c57cfa3010320a34d15b0f07d205e8bacbbf80b5e9ba9f11c99b1f2d318e7366',
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
    sha256: '8b61cdb015bd2f0ff7ecbf7aa0bde5ab9f148efd2ea0692cd0e271d93cbd511e',
  },
  {
    prefix: '### NPC-007 —',
    sha256: '65865fae540ed57441422ef0c838992dbf74e7f66e87824bd24d4ccd8fbea93d',
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
    sha256: '20fd015ba4c6961c3bfbcd24dafafd7ada85ecd31aa0e785f43c5943ac5ab754',
  },
  {
    prefix: '### NPC-017 —',
    sha256: '03a9b44b49e00d3115585a0fafb4deb3d3addd2db570e119267c958c45d917a1',
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
    sha256: 'ce9883a3cbf255dff2ba1a7253611146700a3e9d9ede09844579e6ccb21b4a5a',
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
    sha256: '7bfa401293e5bdd23d84bac23da4b6f3f3ab2b3cdd07fa9c01727092add11ddf',
  },
  {
    prefix: '| REQ-012 |',
    sha256: '9c9c4ebb00da267176d1413776f105529697eff2f777f0dbe508c8e7883b93d1',
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
    sha256: '4546aad8bdc4b611237abeabb8c0998e355ed8c38eb74b5f77c6b82bfef7ce91',
  },
  {
    prefix: '| QA-CHANGE-NPC-003 |',
    sha256: '13180cde6657d7dde018705e899b01c531c0e4f2b54564ec6f40c40fd11f1b86',
  },
  {
    prefix: '| QA-FORM-NPC-007 |',
    sha256: 'f950f6a8a34632703e5193c4332ce30aa2fa2eaa398c926d284048d7b8e9f0dd',
  },
  {
    prefix: '| QA-CHANGE-NPC-007 |',
    sha256: '13fa7774d40c10f5c406d5a65f1212b0e7e3f29fe74719f0cb637fce83751cbe',
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
    sha256: 'ef4519eb5ca408615f5337fcb8d94f40d1a635a90640266e217ce06621584f8a',
  },
  {
    prefix: '| QA-CHANGE-NPC-016 |',
    sha256: '25daada51caada66ec7cabee76fe22fab3de6ab6d5c1ea71209866e67e8c3817',
  },
  {
    prefix: '| QA-FORM-NPC-017 |',
    sha256: '002abf1cb6f2173d6f19a836d1df4fcb3ac57e3a3f7271decdbfa76772394661',
  },
  {
    prefix: '| QA-CHANGE-NPC-017 |',
    sha256: 'bfb5118e7c594c4c2a54c65a7c8a58fcd01426908e60ee6c776e6f03bb2cfeaa',
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
    sha256: '3fb8a68b76b6a7a05b4afb2f5d7092b2ca7943f04182996389009c97e0ac8284',
  },
  {
    prefix: '| QA-REQ-012 |',
    sha256: 'f72e5595db9491a9fd545872a263f024681cf5135757e6787eafb820d8a806df',
  },
  {
    prefix: '| QA-REQ-055 |',
    sha256: '0ba6e842dc2febff9e0163291ccf7e77550dbe451ced829fcb0cbcb23488b1fb',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1 |',
    sha256: '8fef7c1a1a8805f2d78cb834b31d1caf4fff049c436c84b36f5af63f622d804c',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
    sha256: '31ab3cd85bf64742f5afbfb52fdf36d352cb600d2f3ac5fdbbe8581b16ada66c',
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
    sha256: '37f9d8f3d20f951a47ea61c107c2f33943bc6ac9e326bedeca2be06c744cdf6b',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: 'ad16462cddbcb63faf39f21867e764c7ebf03ef250f56f75453c3558f19c8dea',
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
