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
    sha256: '9e8c8ca769c4576db7952f0a6d63bd08e1fbbc1a2b449b4cb346f94e5990a033',
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
    sha256: '727736d46b19371dc6bee3e3553b8f53da75a70fcf7c3079a7816a75b2bee495',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: 'dd0674a9d7f44e74c2181596eb416bb74cd25f620c80fd810a8b9109e4a1a9e2',
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
    id: 'QA-REQ-055',
    sha256: '351fe4331eed729a67eabd12d33bd98e97fb9ad51639030c58eabbfd00a3b74a',
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
    sha256: 'f707bad46d59d54cd566f58ee33c0bbd76238e6436c0e72bc8e281bf643907cb',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: 'a1e946fc013c9ec591af1de19fb5e6ad07fd62842b7840d07b979a96a727c098',
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
    sha256: '9dd9bbdccade7312f84a8689e3f312bcb0c91c46e168d30d7a5e2dfe21b5f8f3',
  },
  {
    key: 'registryCoverage',
    sha256: '8542af9faa630e9945805bec06b674e76ee766468e0f704532ec9009ecc3035f',
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
    sha256: 'e9ad0ecd4c04790a9aaed26f9b1340f6532997403dd30901311f69a14998c724',
  },
  {
    prefix: '### NPC-007 —',
    sha256: '4fb9137229b7317f2137e25e8dde0f555e5c487aba9841d3288d1f9db81347aa',
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
    sha256: 'b394929f70fc58b757ec38b293acf2c5bc0fe7e6ab6bb48c7cac4c3128f55188',
  },
  {
    prefix: '### NPC-017 —',
    sha256: '0848d06695fe6d62e2b24ec0908ae40305a7e8257470fe7b072c07a59a541b9f',
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
    sha256: '9db22901f1af67e829e98abd1c88c6273ece5e4ab03a292bdbcc94ae54c474c4',
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
    sha256: '0f0612627afd55af7620fa547b47e1a4441143da576478da0d019b51903f29ab',
  },
  {
    prefix: '| REQ-012 |',
    sha256: 'd0c6400a95bbc63798279be537e47b28ec794c3a278468d61b850ea1f7de8932',
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
    prefix: '| QA-FORM-GM-001 |',
    sha256: 'b5b0098fdec542bed9b216cdc2e5bb1239ada5161b06d8db551534567491db4d',
  },
  {
    prefix: '| QA-FORM-GM-002 |',
    sha256: '2ab9e5393e28f401c239c562f5319b5414020258a412e871de27a575b2ea62d8',
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
    prefix: '| QA-REQ-006 |',
    sha256: '0e5adefeff7dc996b5aaab5a83f078d1ac3f9b5313441bdd278689d2a996e8ae',
  },
  {
    prefix: '| QA-REQ-009 |',
    sha256: '6bb2ef2b9185fe7c46f0c6e16e4e2537dfe601043be701c311b0f5213b069354',
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
    prefix: '| QA-REQ-055 |',
    sha256: '0ba6e842dc2febff9e0163291ccf7e77550dbe451ced829fcb0cbcb23488b1fb',
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
    sha256: '7122dcca164e6284437e5b388baeaec750ceb43df0f5a4ccda15118fa56e8968',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: '7da1c86fb174aebd3c7ab349fe0cfff07cb9927363054ef14e10a34a26135832',
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
