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
// Intersecting witnesses include the accepted initial life source clarification in ADR 0085.
// Intersecting witnesses include the accepted formal Weaver source clarification in ADR 0086.
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
    sha256: '3ebf40e03cd0332535ed38bbe26c76bcb4a91111757464c8992b1eeae9626707',
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
    sha256: '6c5a28709be6fd8e4d7785980a9c75dddb65b1845147f4e82430a0b7d2a80b2f',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: 'e7a1ca79aca13158d25ba9062a5ad08ba1ca9eb80f023058067cd2ce83932e1d',
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
    id: 'QA-REQ-055',
    sha256: '351fe4331eed729a67eabd12d33bd98e97fb9ad51639030c58eabbfd00a3b74a',
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
    sha256: 'c99215d27700ba372ff3a4305258fa5d2463f819634a04a040c025a7f497654c',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: '08602042d796d1a6a24bead5040706e4f02ae86c1ec7a26f9a28f02bff3d8ac4',
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
    sha256: 'd99c7420fd95b74c2cc55324701e224a8ac8ecd76b2de238658da768768b63d5',
  },
  {
    key: 'registryCoverage',
    sha256: '7643ff4a89679f8b6f3c709a4e63b74418ea07f597728533993d9e7fcea9a9bf',
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
    sha256: 'af4088a34e50566a708c0c41c49e47e5c2e5354132a3faf98ded72a1d2461e4f',
  },
  {
    prefix: '### NPC-007 —',
    sha256: '2ecd865b497cffda4de4eee70cc7d23935c336cd914e5e7ae7a0bbb730e5ac93',
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
    sha256: '696815ff8017eb60023ce9b0e1f39d73e5c5874668726ebbabc17a71aab9cd65',
  },
  {
    prefix: '### NPC-017 —',
    sha256: '21ce66618fea64667fb0f3bc7f7b0edc5fd77b98349ca1b0f63772449d88a977',
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
    sha256: 'd7312149934d70df8cdf62a7dc7eca31e1c258b2bbce39e46d57bb4026b70700',
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
    sha256: '97f7eae25979c170732f34888a1152898584826c5263167d8e5ccdae26e6b5c9',
  },
  {
    prefix: '| REQ-012 |',
    sha256: '834750a1e33b7976d49573334f5eb5cec0f1cada999b09d43ae32f183e4ada05',
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
    prefix: '| QA-FORM-GM-001 |',
    sha256: 'b5b0098fdec542bed9b216cdc2e5bb1239ada5161b06d8db551534567491db4d',
  },
  {
    prefix: '| QA-FORM-GM-002 |',
    sha256: '2ab9e5393e28f401c239c562f5319b5414020258a412e871de27a575b2ea62d8',
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
    prefix: '| QA-REQ-006 |',
    sha256: '0e5adefeff7dc996b5aaab5a83f078d1ac3f9b5313441bdd278689d2a996e8ae',
  },
  {
    prefix: '| QA-REQ-009 |',
    sha256: '6bb2ef2b9185fe7c46f0c6e16e4e2537dfe601043be701c311b0f5213b069354',
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
    prefix: '| QA-REQ-055 |',
    sha256: '0ba6e842dc2febff9e0163291ccf7e77550dbe451ced829fcb0cbcb23488b1fb',
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
    sha256: '2c29e18f160fbe2b56e713c66527d6f4839ac249d623a1ea4424ba88b15810c7',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: 'ff5146d880677e71e46547cce93cbb8f786fc99ebe9cc2514a59c042043b6274',
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
