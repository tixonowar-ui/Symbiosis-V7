import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.10 objects, authorized by #186 A/B/C/D and ADR 0077. */
// Intersecting witnesses include the accepted NPC time/import amendment in ADR 0078.
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-001',
    sha256: 'b2a6d21695bb13fc395b146f5a0286999207549333d4f25680b698720c917d97',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-002',
    sha256: 'e215e4f4452b70ad60be954b311fdf1f99b8bad1e8e377496071dbfe5aef7a0a',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-003',
    sha256: '753b3326f215709af997303b64fa18c12a666f37eeca70c1bc43eb10d86ab6f3',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-007',
    sha256: '1ab6880cba42d81223411851e1dfdb11f5f7842255b8cc3e4cc5212f9d6632d7',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-003',
    sha256: '83644c8c00fe209c92241581604782e97af03e2acbe94d8ceffdb6506cc4a880',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-005',
    sha256: 'e384196c972b001e86c7a475eff1b3dd7fbbc02615b8bfa4b0c4310655498b83',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-006',
    sha256: 'b0ec2a80f14b119c1f4c9d45953467b355b31c2e2b21740c03d66d1140605f3c',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-007',
    sha256: '080998d7544ca5f8e0ca11f656e3436233a7ceb982af8baf9025682c31302911',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-008',
    sha256: '50bec713d817021dcb6a459a14a8b310326d6c3c1c2b2110347f03667442736b',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-009',
    sha256: '58466dd0f39eedefaa86a9d62ced1cdaf07ac9a61bfd193676aa747ffe741c8d',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-010',
    sha256: 'a46ec27eb288e749385cdc07788c9452d72b7f7c85876d9716aa105bd9aaf3b6',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-011',
    sha256: 'b5bda9c734c10e3e5de929abb10a826223f7ef148671fe6d445ebdfa816e03fc',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-012',
    sha256: '089fad982aa322babb97e144c5dcad12f0703a4eb483a80745b0e0565bae57cd',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-013',
    sha256: '2f20d0c42425d164d2c673510c09123edcd8c756c47b74b7995da796c1c7156a',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-014',
    sha256: '6378387e4a20833d897332018b51502aa6732278b4bc24a02190c7ea13058ac3',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-015',
    sha256: 'c1cc454de6e5ddea0849a1e8e268e59ccd9aba25f13284136353714b6001fe08',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-016',
    sha256: 'c41d7b9a3b99cb3727ccad30f50e6ebb284275a5aa886043a0f3d40de3f16f38',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-017',
    sha256: '95de68aa1f44ba5d3cd217bf3998da2a64795cb676304c957ae973b5cdd8489b',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-018',
    sha256: '9f8b2bd0f6bba1cd3a8d58e283e2d80920f64709d3d9533b4508f0fce275b890',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-019',
    sha256: '5585b567fa9885ed6c979fd08757fbbb8dba7ecc5b4dd446d36f3138ed1a59d4',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'GM-001',
    sha256: '6984ca06ccb3f59e57bfabd6a32ccb8994caf8ffe2872e6394e0cb86b01760f4',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-011',
    sha256: '95ebedbf020217b15617f2d4aca096dcedc340546db22e94638d0322dc8afffb',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-016',
    sha256: 'c4b5860104af8012bac9ce0cc115f29da6fd356564227f358454b38e7a77c966',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-017',
    sha256: 'f69b52a037ea8dc294d6119ce516e64f682ccd0fa354b943ed1d84804d773202',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-NPC-CREATE',
    sha256: '3bedb527333ab59a75e6506d8fc380932a62422ca9931386196fa0b7537325ea',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-ENEMY-MONSTER',
    sha256: 'bc994bebf60e0ce584ae93c106c3f8fad3c8b7d452e1d89aec62b7b9d8e0a102',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-NPC-HISTORY-LIFECYCLE',
    sha256: '5c4dd25de6dce98bf1209b6116a41b2c8c2522c6ba290552f430e5e830f999fd',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-TEMPLATE-LIFECYCLE',
    sha256: '6bef5147ef9da6569c78f19f13a469f4b30cacb344e362acf3eb1c6b4a4603c5',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-011',
    sha256: '4be72050975fad267e27fb92ca9a01ebd0463ba34fc64e62ab1da357331805bb',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: '58597faedbb6e6927948515d8fca2540b464bc09f70aebbbaa529f025c05aef0',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-013',
    sha256: '96b261dc8ee34d7fc120be5c2311c7981c51e20d577fd80d913ce83736073940',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-014',
    sha256: 'f6a581bdd132bb294885b237290ee7b42d556a540665a268fa221f1173f302a7',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-015',
    sha256: 'faf2c40eb7aef4dabd24a20a5c92f32976c78e4dbcef29567c20dd1a778e6f6b',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-065',
    sha256: '8937fd86119a8ec437aa623aef1f2942d6e9f93c37bec6124f95bada0593945c',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-001',
    sha256: 'b56a264b0d1e091345c157db78aed6bfd61621b4e7887fbb7fc285ed7ca952c7',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-002',
    sha256: 'ce9c03d8e71a080f6e9ee013d1f4307bcab1c4139599758539c17ea6dae96093',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-003',
    sha256: 'e4172367c19ed13e75881d45385319638b49a7baea4741e7b97c1684bacf2115',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-007',
    sha256: 'f481d155af662a1ef915145288b3abefc7eec7de37be26f7180d7b56af940da6',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-003',
    sha256: '5a66a141b05b1eeb4b21effd57ff237683be9a8b3257e6fb8243e261521b0d56',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-005',
    sha256: '09da8faa10cdddb593af3b251bbee1ef2f09f536fa27f09964a1d4a6f059bd52',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-010',
    sha256: 'a11bc5ebd1ffd6daee5034adb0755b63cc00dc5bb3217b27032a1bfcc641f90c',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-011',
    sha256: '52f5605cd42eb95573ab522386a25fd31de54d2cefc47ec1cd0def0bb5375126',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-012',
    sha256: '066b38ae64865fc010aefc2aaf5a08cbc72375c02931e0c6721a92c22825b62b',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-013',
    sha256: '59cf36ab5147f2b452be9d743e9c8cb74dd651a1bb34dd1a577ff67cc5a2b6eb',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-016',
    sha256: '08520174fabe7046e8b2a5e660da536e0acb83ad082454befaad6597518d8329',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-017',
    sha256: '12905b2a34688dd50756971b771f3f8d22a81c90a75abda49e7d2170e707d314',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-018',
    sha256: 'a858e87d0f2459a4800cce0daeaf51d276aa8199232ee7bbc5c892d0fd9afd42',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-019',
    sha256: 'd29bf87d0eb74aede0f78c7ca6b134e7e5fd257824c26365ae41917f245e54a8',
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
    id: 'QA-FORM-NPC-011',
    sha256: '7f1de8d3fb5824d9746c834e147a153e5d0c036ff4c9b6b2f40c426672139bc7',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-016',
    sha256: 'd0dbd869b326cbfc0144b3a9b04257ee3404be4d0a33a4e2ab54aeeea4f26382',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-017',
    sha256: '2b9c198c5e3b85e93b6bb9fd2662e1b060619e9fb06d5fc5f4282fee3b2af0eb',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-011',
    sha256: 'adab2dcf19037e721ac4762525eaca51bc6e3c0cad65153c7eeb87a838bb345e',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-012',
    sha256: '67cf86be42cf6fb5854a24703c12cf306b4a7240eedf7c2f5473d491d0d3e689',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-013',
    sha256: '592f5b78da9a8afb3edec2e3fb9b73ef376a422f5986200cfab8bfcf8ccb2546',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-014',
    sha256: '7c78109c2bcdcf382a941e7803cc2b88c28d5cbe753576014bd743516f777b27',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-015',
    sha256: 'f4b8a05985cc1c15620940285429733807871aee84105f0f20c5d842e033892e',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-065',
    sha256: 'f4db7f114427b3da1a972cefed05b4011c74c10361577d541069f3e3fbb59a37',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1',
    sha256: 'b084bc135fe6c89d527a6d05d1aeaf7a403da49bf42a7e9737671a02e77e7125',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION',
    sha256: '5d9668a4d2c9c2902e1ed57eeb1920585e630ed984315caef4987e5b4f56ef50',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-ENEMY-DRAFT-PATCH',
    sha256: 'd3a8df5b5d90c99cdee0b2e8aaf82bb79d51b49a82c7433324f0319ac31dd293',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-ENEMY-NEW-VERSION',
    sha256: '5fb69b7dacd49bb76dddd878df83d5e2295079361999adfe175b1548d7fbcb59',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-MONSTER-STATS-ROLL-ONCE',
    sha256: '9d4a995b06b38fdb60c2c6ffede4ebdd4e9645c0aec4ee2324df8dd8a1de791b',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-QNA-Q-CHAR-010-ROW-306',
    sha256: '3cb38e4d92f2e6cb3409284dcebf1bb248cef7b022a942c6951f93d1c16ef6ae',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-COMMIT-V1',
    sha256: '06c9f96b9cf29207f6677fe49006169e66749f28ba2fdcb76b07ad9e52cb4daa',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: 'd3a36fd6dee6a6d424e2d679859c4ec64bb3b97e77767468f707b0769fe54b82',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-ENEMY-DRAFT-PATCH',
    sha256: '0bfd7c410ebfb877d9d119afdf41c6927a8794f1bc8de027ddc39c34d9f39685',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-ENEMY-COMMIT-V1',
    sha256: '9f6309b56c11b0b19268f911f0d2b95971c0ac6ddc463a62afb8fa06a74b8085',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-ENEMY-NEW-VERSION',
    sha256: 'c3166ed1086c4608042a95019e2564c6a91cb020003233fda05a7e52769f375b',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-MONSTER-STATS-ROLL-ONCE',
    sha256: 'a34cadf4a9e47a78fc429fd7eec257f64944ad5b1eb2140e3c26d451c77782a4',
  },
] as const;
const ROOT_SEALS = [
  {
    key: 'atlasVersion',
    sha256: 'a65dbaa4b2233299407978f82b1d2d718aa85695e23c41f3981eb9223bf25a96',
  },
  {
    key: 'releaseDate',
    sha256: '5fcb572b528519139e2387488eb3b6ebaf08e890f45e59c93ac2161bba96e0e4',
  },
  {
    key: 'counts',
    sha256: '0ce9ee6815a54ce2c7f7075be20a8cd5c14d5822d764c970393d7087ca45fa04',
  },
  {
    key: 'transitions',
    sha256: '978077d54e8e43652a5bc0dfccd413c2553199cb926722cd504450abae504a06',
  },
  {
    key: 'entityLifecycles',
    sha256: 'd582ebdc27fa9551d12c2bcf89412a47aa419d3ac2a3fce846dded90ab293668',
  },
  {
    key: 'registryCoverage',
    sha256: 'db5ead24bcdbccc46283c104e3a2ea46b1acd0c3ef13cc4642f5adb7a4a2e73e',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NPC-001 —',
    sha256: '5a272dedb989747842985d966c90aafd7cc77d4ddbb50edb39676e2073a6c2a2',
  },
  {
    prefix: '### NPC-002 —',
    sha256: '0002d73319e6d7529fd03b832db2e84ab83a0d64312a185d25f898f5da196515',
  },
  {
    prefix: '### NPC-003 —',
    sha256: '843edf4823e4f7c612dcced28a8dc189a300cf5359a5d3a668662fd5783d4e4e',
  },
  {
    prefix: '### NPC-007 —',
    sha256: '0bc843a0741a7b518fd916e874aa13ca12f6a1bc67fcc47c05298566f731a318',
  },
  {
    prefix: '### ENM-003 —',
    sha256: '337948db1c07d9a8e85bcbefa113534c989feb1b52c866977cd6ff9b7e5009bb',
  },
  {
    prefix: '### ENM-005 —',
    sha256: 'acfdd20632587b1d3ad76afe7b52141ff7d72b851339462c97484c5cd5483a09',
  },
  {
    prefix: '### ENM-006 —',
    sha256: 'cfbfbe2f8db06c372a5bef49d3b61357a6e89015572ee8ea936def5550c3b5a1',
  },
  {
    prefix: '### ENM-007 —',
    sha256: '4a3635529f5a0a767881855fbc836c5b5cd236de771d2d70fff69768f27b4b75',
  },
  {
    prefix: '### ENM-008 —',
    sha256: 'ba76d81c84b7a757a4998877083c84e7e39225fad00f51bb8d11a1abf47bf25e',
  },
  {
    prefix: '### ENM-009 —',
    sha256: 'bcdda3a4e5de0fd166045f8e4bb80cf55d9a51a7bfa8d0beb2c31d91a9b42458',
  },
  {
    prefix: '### ENM-010 —',
    sha256: '9290db70fadbd497bc11e7b3fdb8e46a20d63fc6b87b1cb1538dd4d5e571a8c3',
  },
  {
    prefix: '### ENM-011 —',
    sha256: '15177b5f3d49bc47b79755e5be3e6a737ce826cd6a5bcfcdf3420671b68e210b',
  },
  {
    prefix: '### ENM-012 —',
    sha256: 'e109fb9ad80f456958e4ccf698b2e15a771c4dd8ee807742f7f6112a1f6497bc',
  },
  {
    prefix: '### ENM-013 —',
    sha256: 'fede1fb00383b2cfedd8b79a775c9b4ed8858cae31e14fd9399c34be57e8d6ec',
  },
  {
    prefix: '### ENM-014 —',
    sha256: 'a50bc0b70d928b03b25a8c1923d73829ee6d41cd8330acb8424fda8c5ace7752',
  },
  {
    prefix: '### ENM-015 —',
    sha256: '34fe267abf54bb6154c0a39d93762f2dffb46b50354b31ddf214148e17b299a8',
  },
  {
    prefix: '### ENM-016 —',
    sha256: '2c39461fdb9fa15195a5343e37387fc551870f9ce38994e2705bc3f14de0d104',
  },
  {
    prefix: '### ENM-017 —',
    sha256: '6b2ae0361936dbe2998a3c6bc2c75bfbaca9f919b346feb365acda0baf46e786',
  },
  {
    prefix: '### ENM-018 —',
    sha256: '49076b18c5c21bd5c9aea7f198025f8c78c0d19143f7d14547b188404df78765',
  },
  {
    prefix: '### ENM-019 —',
    sha256: '8f2631099d30edcb0bf13b34c347c24a9487a7fb781ab7f7ada7273a9599bbd0',
  },
  {
    prefix: '### GM-001 —',
    sha256: '0351909542206b6c4abd2f67ae2f85da598e965b6c11034f092ed8a629c35c3f',
  },
  {
    prefix: '### NPC-011 —',
    sha256: '2be85324f072c82be4c9608459048c6d22e511aa2a0a6ed02655d76244848353',
  },
  {
    prefix: '### NPC-016 —',
    sha256: '6bf8ed0a66fe019fd4ae90925e12311d6d828f393a52997fd6ece917a068df79',
  },
  {
    prefix: '### NPC-017 —',
    sha256: '7c99ec1dba3497c5aedd392b5b360e8c0ac0c0d8b3802b10f4fc7f2434fc95a7',
  },
  {
    prefix: '### J-NPC-CREATE —',
    sha256: 'fc62c61d6b54897362a583b943be294984864d35166ae12fb061d7cb5c7b8793',
  },
  {
    prefix: '### J-ENEMY-MONSTER —',
    sha256: 'bd0ccb54787b74527669e2df60440c2ec51b0e958e1f9227672b46f3a298fd9d',
  },
  {
    prefix: '### J-NPC-HISTORY-LIFECYCLE —',
    sha256: '9afd0df378b7f6f3c8cf2585bd3df83ff6a4fb9c7fbb1d8a7bff9553f0cc2c79',
  },
  {
    prefix: '### J-TEMPLATE-LIFECYCLE —',
    sha256: '66e29c98260c5a0ab9d584e8492e873028c23bf29dde59427db1b83f1d677ffe',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-011 | Полный NPC wizard без общего stat cap |',
    sha256: '5032b21da61ba54f1bba7d94f1095c5dcdd696bff94ba5caa53cac748600aea3',
  },
  {
    prefix: '| REQ-012 | NPC list/version/history/duplicate/archive/delete blockers |',
    sha256: 'ae3a7c0cdff65710841350ce73c1f2bd786e888c857ed6791812b459e2f96527',
  },
  {
    prefix: '| REQ-013 | Справочник системных и пользовательских врагов |',
    sha256: '79db41a8288756f6c2ff68c9e41068728dacdea05ffdb83fd801e8709b116658',
  },
  {
    prefix: '| REQ-014 | Создание полного врага-мыслящего |',
    sha256: 'a7c7232e630ac96d6864603b48d31a5bd2b4337e1d3154c2ede5a97eef54788e',
  },
  {
    prefix: '| REQ-015 | Создание произвольного монстра |',
    sha256: '2981b5b1959cd2b0d9a7fea30d8b069aeec61f96cc8f6140628fe6fb8982b3ee',
  },
  {
    prefix:
      '| REQ-065 | Самостоятельная обязательная ветвь: System template, version history и safe catalog boundaries |',
    sha256: '51a7485732a3575ed6d057dd604e3c6c000de66bf965b6ac618ef8ce838b953f',
  },
  {
    prefix: '| QA-FORM-NPC-001 | NPC-001 |',
    sha256: '8fb686deee4001cdd95d5b19c0c6851fb9ab8588f5ee0b1a2f49974bf56374b7',
  },
  {
    prefix: '| QA-FORM-NPC-002 | NPC-002 |',
    sha256: '999a489662eb3edb8be517fa922fe41b59cae35ef991da6068c9182682cc86f6',
  },
  {
    prefix: '| QA-FORM-NPC-003 | NPC-003 |',
    sha256: '39f251ba4bac9406e40ec0ef5eadc8ab397b038c23213ef1086ebcb1c684b191',
  },
  {
    prefix: '| QA-FORM-NPC-007 | NPC-007 |',
    sha256: 'dad76a6d118e15b79e435a6b87406c235517523aee795c2d58498b7cbf6ae876',
  },
  {
    prefix: '| QA-FORM-ENM-003 | ENM-003 |',
    sha256: 'ac8485bd9aa25dc3a48f461a08d8729ee879661e8ce28d7c84683e39e3efdc56',
  },
  {
    prefix: '| QA-FORM-ENM-005 | ENM-005 |',
    sha256: 'fb7be39d1baef55729629847732c8665f8e02e65cf62a0efa6be30cee10c775a',
  },
  {
    prefix: '| QA-FORM-ENM-010 | ENM-010 |',
    sha256: '69da3617fe991c682b013ebb118ce7829b9d8eef79f861f1ffabb26daa711ed8',
  },
  {
    prefix: '| QA-FORM-ENM-011 | ENM-011 |',
    sha256: '89c852d8752915892266dced36d77d6ee884e4b570b5a49d0d820c2a145083b1',
  },
  {
    prefix: '| QA-FORM-ENM-012 | ENM-012 |',
    sha256: '06b131bea4dae46fd0a3516d3613e7850668481ce76eddd2acdc12267424583e',
  },
  {
    prefix: '| QA-FORM-ENM-013 | ENM-013 |',
    sha256: '35e7eafb8779ddfcc8e763191719de8350b6f5780b7b1e8f70987713812a0c0d',
  },
  {
    prefix: '| QA-FORM-ENM-016 | ENM-016 |',
    sha256: '37b2ea7f3b58ffb243eaa7d283bb8c5dc43ddfd61a042f6fa428e84056ce63e1',
  },
  {
    prefix: '| QA-FORM-ENM-017 | ENM-017 |',
    sha256: '55cae64ba0d3fea57a6da18763f54de581c041ab87816f8562aa1fe2f4f2cd40',
  },
  {
    prefix: '| QA-FORM-ENM-018 | ENM-018 |',
    sha256: '8f19760d04c84a965a437a26379c8b292ef046e5f24a359722e513c0e67a87ae',
  },
  {
    prefix: '| QA-FORM-ENM-019 | ENM-019 |',
    sha256: 'b9f062e52ffce8b79d898ae59c857c2e24df699f57f8b7a987a7d4c5f89be210',
  },
  {
    prefix: '| QA-FORM-GM-001 | GM-001 |',
    sha256: 'b5b0098fdec542bed9b216cdc2e5bb1239ada5161b06d8db551534567491db4d',
  },
  {
    prefix: '| QA-FORM-NPC-011 | NPC-011 |',
    sha256: 'dc60591b662971d8aa27f5c0857d5714bc5eac0eaa2133d47bbe2a315337be3f',
  },
  {
    prefix: '| QA-FORM-NPC-016 | NPC-016 |',
    sha256: '59f2ca9ca77ca2dac71303121f8bfb40b2d1677f32b1564fdf7d1cdd6df15c34',
  },
  {
    prefix: '| QA-FORM-NPC-017 | NPC-017 |',
    sha256: '277fc4ac2f19d2eb3ffce39e07fb8b3ee24f168e9743f0afd16c174de54b2276',
  },
  {
    prefix: '| QA-REQ-011 | REQ-011 |',
    sha256: '95e9b0566db2ff077d97df3a50d6326aa66f50bcbd658f722d61025176928744',
  },
  {
    prefix: '| QA-REQ-012 | REQ-012 |',
    sha256: 'f27b909f8803b3f2b6152ebad982f2751254897f325b4a890014008b0b848507',
  },
  {
    prefix: '| QA-REQ-013 | REQ-013 |',
    sha256: '2f47bf3562b4cf6a1ba907d3e5ce6d75ca2b527b58af27755297d84ca87d7834',
  },
  {
    prefix: '| QA-REQ-014 | REQ-014 |',
    sha256: 'ba9c10eda3e2b275402bab878f106f5ac53a0dd08b23ac9b7fba38cba9f082e8',
  },
  {
    prefix: '| QA-REQ-015 | REQ-015 |',
    sha256: 'cc6618d4e2ef7e037edbbd824cf13085b38763ec25147092d96287d4316540ef',
  },
  {
    prefix: '| QA-REQ-065 | REQ-065 |',
    sha256: '2c81d9498997b41ec5454b78ac36fb19ede948faff8b2c5388ea87e644755ba5',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1 | UI-CMD-NPC-COMMIT-V1 |',
    sha256: '4b7019cdb47cacdcb755b62e21981a890ce74254c477999f232840cd4fedadee',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION | UI-CMD-NPC-NEW-VERSION |',
    sha256: '3831397403127069a98dc0c8dc0775ba7605216a65ad5a9a568c8739eaca00cd',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-ENEMY-DRAFT-PATCH | UI-CMD-ENEMY-DRAFT-PATCH |',
    sha256: '9c41d291b98997a38ae4b9f4a9ed3447e127562d9bf9be3f92014f17d6da3709',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-ENEMY-NEW-VERSION | UI-CMD-ENEMY-NEW-VERSION |',
    sha256: '8fb7f99a05f7802f45c71f1212da3a0c916ddf877d885df9a88800278fa4f59c',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-MONSTER-STATS-ROLL-ONCE | UI-CMD-MONSTER-STATS-ROLL-ONCE |',
    sha256: '0552b79ebb42a077471c177b5e0ef6fbfc09d3929202bd71d5ce7980d5bccfda',
  },
  {
    prefix: '| QA-QNA-Q-CHAR-010-ROW-306 | Q-CHAR-010#row-306 |',
    sha256: 'cc458b1b6a92a281b26d78f4cf5251233192e06ec5e9d4636338397100fe52c3',
  },
  {
    prefix: '| UI-CMD-NPC-COMMIT-V1 | Атомарно сохранить первую версию постоянного НПС |',
    sha256: '60783cee7e6e68ea9b60ce7d5e4a47ee611c141ebfc490c88a4ce2b14b0ab42d',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: 'dc269a72d0a7034e554b16a89f435a151a0c5183894a3e93d3ecb8315c56de74',
  },
  {
    prefix: '| UI-CMD-ENEMY-DRAFT-PATCH | Сохранить этап шаблона врага/монстра |',
    sha256: '2b557da3ddd01e5c51b28c3e4dd1589bf7acba718cfef62423aab03da36e35a9',
  },
  {
    prefix: '| UI-CMD-ENEMY-COMMIT-V1 | Сохранить первую версию шаблона врага/монстра |',
    sha256: 'bf7d5c4da693ac33652b9aba1db9e68a279b970b85c7aa954cb99f2bbbeb822c',
  },
  {
    prefix: '| UI-CMD-ENEMY-NEW-VERSION | Выпустить новую версию пользовательского шаблона |',
    sha256: '42b374eaf95eaae2db225aa0e0aeb240383b17f00eaa66f063d5894dd0752eea',
  },
  {
    prefix: '| UI-CMD-MONSTER-STATS-ROLL-ONCE | Однократно сгенерировать характеристики монстра |',
    sha256: '26e3c349728a5e9fc54e116c3d338be20c1ec6eaec472952098d4cb7a384b0b6',
  },
  {
    prefix: '| enemyTemplate |',
    sha256: 'd2c34ef699c8ed1090549080f773e1cfdb56bdff086eb40ad6f660f2eb215a5e',
  },
  {
    prefix: '| 306 | Q-CHAR-010 |',
    sha256: '4817f92e353b6baf779692eeb2f230c8af60ee4e5027baddab263a2fa3d5dee3',
  },
] as const;
const WHERE = 'atlas ADR 0077';

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
    fail(WHERE, label + ' differs from the approved GM source contract');
}

/** Whole objects include authority, fields, draft variants and both local route mirrors. */
export function assertAdr0077GmSources(root: JsonObject): void {
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
export function assertAdr0077GmSourcesMarkdown(input: string): void {
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
