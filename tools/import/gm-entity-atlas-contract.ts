import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.10 objects, authorized by #186 A/B/C/D and ADR 0077. */
// Intersecting witnesses include the accepted NPC time/import amendment in ADR 0078.
// Intersecting witnesses include the accepted normal-transfer source amendment in ADR 0079.
// Intersecting witnesses include the accepted frozen-recovery source amendment in ADR 0080.
// Intersecting witnesses include the accepted initial NPC trauma source amendment in ADR 0081.
// Intersecting witnesses include the accepted NPC source consequences in ADR 0082.
// Intersecting witnesses include the accepted fresh Trogr source clarification in ADR 0083.
// Intersecting witnesses include the accepted custom item source clarification in ADR 0084.
// Intersecting witnesses include the accepted initial life source clarification in ADR 0085.
// Intersecting witnesses include the accepted formal Weaver source clarification in ADR 0086.
// Intersecting witnesses include the accepted initial poison source clarification in ADR 0087.
// ENM-003 SYSTEM_LIBRARY/ABSENT is amended by ADR 0089 / #244.
// SENTIENT pre-V1 initial-plan rebuild is amended by ADR 0092 / #284.
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
    sha256: 'aa06928072f3e89c3a48e7d425bca2f419ed4bb9ea419d8c7f740693575a8ff1',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-007',
    sha256: '36eb8da04cc6a67206bf258d03d93f45c890251e27523411d03fef05b572cb23',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-003',
    sha256: '859aa67cd4a3502631ade617d1210d8c56f7a9c160ba84a5a5bad7cdcb252107',
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
    sha256: '38ccc35751e2bf03cab04dc2f2d2bc1941606137424bbd3bec19df0657de55fb',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-007',
    sha256: '0e98a6e47658221bbc767e772542c7cafacd2c2f60dfee01d55f3e07b0533d7a',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-008',
    sha256: '046345fb81e636ea01224397412aa94bc9b0a5bc4ab0fe42c2931c999c528f02',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-009',
    sha256: 'efcb4d715757eb40b1b74f78ceedc4d020b40a35f5ff5e5123771d00cf087c65',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-010',
    sha256: '96d804ae6cabdb2593ae988503019b2867a4f5ff3b18a4e65f6dc8dc6839ac2c',
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
    sha256: '9cf3928e13c50554c6dde8df07230fb357ab5ecabc09696d350d571c36a6066e',
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
    sha256: '8b1d355b679f4e40b045829ced1209964bce13b585eb01e44b6402e6b675eb89',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NPC-017',
    sha256: '5234b8c871cae4a73a716cc93033c0cffb91caca4f403756a73746fbf5f76595',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-NPC-CREATE',
    sha256: '5e0306eb339f59460b509b1e4c30ea2a2d8103634c076f9ebac7a0cc5c8c9b6d',
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
    sha256: '5b272cfcc132fa52e8c9fe4e862b98e6738f9d730a9373d324f1b56044645c1d',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: 'a4dd2fe694307a11ff2357bd5d586e2cdecf102b98f450907ca132100ed48cab',
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
    sha256: '02d03c8d5f9ce024629873e4522f7b1798a25ed120baa5e37ccf133231745379',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-007',
    sha256: '547b1278c052ee71c838d794bbce00241fd053c5cab468af7f1d1c30f6aba81d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-003',
    sha256: 'f28483b3c720af38519d54a3b7a944f37c21e93d5154e85f77e462f8a45ef6b0',
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
    sha256: 'a9ff7821b296aa99e0e22b796b27dd53c3b5551b5d832cd4602d7e4d5db7d576',
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
    sha256: '33232931edfe075435d4dc1705cbad5d9e261cbf05f8d5fbb167b47abd1ca919',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NPC-017',
    sha256: '2012fadb55b2b63b7cf941ac696be4d81b7c05978df899046bdfbb593e7eb481',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-011',
    sha256: '70e61bb6ce3939fc7c896ab851cc64b986996107df59ef56cf60512b3a9fc4f9',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-012',
    sha256: 'c7db451e65bde6bc11e84b90d82cb6de04af48e2bc79a70808b0ad2d4742e5ea',
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
    sha256: 'b5b75c41bd9997b12bf1688af1af28c7f133eda797379f1886e7eabf8abd5333',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION',
    sha256: '28d03db1f112e088f470dee411e0d7f149f698524194866124859c5139a84c2e',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-ENEMY-DRAFT-PATCH',
    sha256: '9b1839baba743d29e868463448c23da00a94314e2c465d7619f1ac65ebef6e6e',
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
    sha256: 'e1049067a25c070aee1b6a39c1a570e7d6fd6a4d185efb59a3f6d7e68d2ff17b',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-NPC-NEW-VERSION',
    sha256: 'ff52bdc3797d53dfc5ae7231e94ac7704a72f939e21862ec733e3649d50505b4',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-ENEMY-DRAFT-PATCH',
    sha256: '32e40bd085b172e67fbec098804b2f4630af0da314760e549e69bc8e86ffc8da',
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
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-006',
    sha256: 'b8b4821acc36833ba220dc89c6a344555565a5de28f50821d02f7cf52aa0234a',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-ENM-006',
    sha256: '1eb8b92e164d6401f13f68cc8035bd3f9640f4f26ea7053aee797cd86623c4ef',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-007',
    sha256: 'a988865a2d021e087303d512f6e4e2dce949596e53fd57dae8d6f173af237400',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-ENM-007',
    sha256: '3f9720077a390d0718f724e7f8e76eae57bd08f487fe1b650f812d16c5be4991',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-008',
    sha256: 'f0d2024434bbd3a8af5822a7ad767f8a70d271228a044e6b63a88f236352fd40',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-ENM-008',
    sha256: '5d6e0178b89148b547664a9f6070196cdbbb69f57378933143fdeb8cc8e7e25c',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-009',
    sha256: '405d0fffb95a65f1db80ca5e598eaf821ea21d41a7917ce074b01d3875c8cc73',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-ENM-009',
    sha256: '0ae6b4bb97996c4336ff84d96bb0def0d05043648dc1620e9e0a5b71c4897d13',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-ENM-010',
    sha256: '3f1aa6bc9ed6e9cd3dedc74ddc93bb47f5319ae0f8301c33528918a66f7fabf9',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'ENM-020',
    sha256: '3ae64524681f9c289f919afda0064b8ffad90379a56b199c836244b15d4df002',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-ENM-020',
    sha256: '907003c790e64d0d9f600c691508d90a18d702fda5975e84908af2cdfbc5e1a5',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-ENEMY-SENTIENT',
    sha256: '55bb8b00ecfddd3551a9fdea35fddafe0487eb1ed9f058255c52f39a10b00120',
  },
] as const;
const ROOT_SEALS = [
  {
    key: 'atlasVersion',
    sha256: '4941e59530a45cfb89ebc95b9337774fa59f686b963942ea9074a4b9d2379918',
  },
  {
    key: 'releaseDate',
    sha256: 'b3ff15f86190dbe330d60c00616bf86409191308461f59ce0361cf105690d75b',
  },
  {
    key: 'counts',
    sha256: '6caf5d80dedc0ec96dc45f1f0bf07ee70aa2d202734e3f6ed191bbcfdce680cb',
  },
  {
    key: 'transitions',
    sha256: '76d2cf3f7b0e93adaffd28e06efc23883ff19863c023c8530ef003a92abf5c6c',
  },
  {
    key: 'entityLifecycles',
    sha256: 'd582ebdc27fa9551d12c2bcf89412a47aa419d3ac2a3fce846dded90ab293668',
  },
  {
    key: 'registryCoverage',
    sha256: '542803be51f709175371667b25a8a3ba895d12985df6c5887a99d23e4b37bd3c',
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
    sha256: '5130987e275f906db131baf69d9812af15a125ad796a1d0d77b4e850a685aeba',
  },
  {
    prefix: '### NPC-007 —',
    sha256: 'b6a34b02a2ffa4bc31071b67b62147795c747f4d13316473c81850606bbe6e3a',
  },
  {
    prefix: '### ENM-003 —',
    sha256: '2939f23fe651dd4bc455b5fff799714fc27be31f205fc1943b08697c35da7b53',
  },
  {
    prefix: '### ENM-005 —',
    sha256: 'acfdd20632587b1d3ad76afe7b52141ff7d72b851339462c97484c5cd5483a09',
  },
  {
    prefix: '### ENM-006 —',
    sha256: '03934ca99b3d7b9983cc0591b42a20e9729e68b6a8cb5487eed400a2c19564c9',
  },
  {
    prefix: '### ENM-007 —',
    sha256: '432664095a43b6dd9d93e82a3a1b840b73d42a105a32680d9239cd41ed2d27f8',
  },
  {
    prefix: '### ENM-008 —',
    sha256: '16759e65266063df16da1818e6f1c7cddabec08286f6acbd65f3f853a1060007',
  },
  {
    prefix: '### ENM-009 —',
    sha256: 'd91a74a097bd4dfad4a6801bc42765a9d626a6ec42af73b6f2452f3fae33beb4',
  },
  {
    prefix: '### ENM-010 —',
    sha256: '9a5b64b9381c16ff3c125bf36ecfdbc6fd3dd0f0f095648ac4700e739693fd9f',
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
    sha256: 'f880661a65bcc4cf682d963cdf3fba06d03c5411b5341b9f5805926b8d660833',
  },
  {
    prefix: '### NPC-011 —',
    sha256: '2be85324f072c82be4c9608459048c6d22e511aa2a0a6ed02655d76244848353',
  },
  {
    prefix: '### NPC-016 —',
    sha256: 'a54e81c0018b63992c2469873f9454c895dd6e9f553e992de86b844b137bc496',
  },
  {
    prefix: '### NPC-017 —',
    sha256: 'aa07f8f6aa425554783c2ca2c6fbdd822100f97154e75b4ca084cf5de33703ca',
  },
  {
    prefix: '### J-NPC-CREATE —',
    sha256: '102fd9983c20bf0c3fb08af1b45018a0e9ab5797e26e774f63ff7ec4638acaad',
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
  {
    prefix: '### ENM-020 —',
    sha256: '9749c3d8b2871c2d9e6fd3416596a9f87bf33e9f5b61dfa67e3f70a991902fbb',
  },
  {
    prefix: '### J-ENEMY-SENTIENT —',
    sha256: 'e3dfca7a44ad45ba829ed8797c7e4c84647f65b3221df09b68ae135455cfe640',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-011 | Полный NPC wizard без общего stat cap |',
    sha256: 'c9ec7117688b3bc4b4debb4a573e5ca931c8550d2e8edd84027506619d8584e0',
  },
  {
    prefix: '| REQ-012 | NPC list/version/history/duplicate/archive/delete blockers |',
    sha256: '8af775bf3fc80473a38e5a2e3dee4006c396d9cc5f38cced750841e810772a2f',
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
    sha256: '2b1b458c6f6b149a2f7f331528ca73289a18069a12f289d0df8caac199d0ec66',
  },
  {
    prefix: '| QA-FORM-NPC-007 | NPC-007 |',
    sha256: '86928fc91da065dd7fab60096e74f7906dfaf2ec9ca1a400909961e3dde77aac',
  },
  {
    prefix: '| QA-FORM-ENM-003 | ENM-003 |',
    sha256: 'a1d9e6791f78f591b5ccccf9828810d4ba50a3a1add6af568c2778d09cc81476',
  },
  {
    prefix: '| QA-FORM-ENM-005 | ENM-005 |',
    sha256: 'fb7be39d1baef55729629847732c8665f8e02e65cf62a0efa6be30cee10c775a',
  },
  {
    prefix: '| QA-FORM-ENM-010 | ENM-010 |',
    sha256: '827e1dd4eaafe0c43d6d953a3e7779469d21f7823ed06f4523160f5b3616ad90',
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
    sha256: '40b2b2c0555e1c66722aaa22f8b4e249a92b5e59817a9500328f2ddc3b29f64a',
  },
  {
    prefix: '| QA-FORM-NPC-017 | NPC-017 |',
    sha256: '6b0feac8bf9134fa16e959550383998d131958abd7283fc3ae4577bacc7a7afe',
  },
  {
    prefix: '| QA-REQ-011 | REQ-011 |',
    sha256: '6d0fe0919a86d9fb807148b6b99a9dd60a2c702553457b00d38870f16a7acf91',
  },
  {
    prefix: '| QA-REQ-012 | REQ-012 |',
    sha256: 'b32f693cfaa1c0693a8586bbfa90ffbe14b649a3ab98f50307c3d8901989e838',
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
    sha256: '575513bf127f191df767f9a2c9e1590acb0f3c32ec5fa708f467e3663294d335',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION | UI-CMD-NPC-NEW-VERSION |',
    sha256: '8533f4aae3b857d9dc5cdea346f46bce1f143e3ada07589536a410326b0fa7d5',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-ENEMY-DRAFT-PATCH | UI-CMD-ENEMY-DRAFT-PATCH |',
    sha256: '855801a276dbf58ef420b932dbc26bc061e7b97b4975d29aefa3fd8c7277ce62',
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
    sha256: 'caba549f282d55092eddd3008d8724a5a411e71a422a867fcebd2620d4f4c626',
  },
  {
    prefix: '| UI-CMD-NPC-NEW-VERSION | Создать новую полную версию NPC |',
    sha256: '3c7b8c88cac6f133881337c95998b8fdb4f62237165c4e07af80f5516df0ec2b',
  },
  {
    prefix: '| UI-CMD-ENEMY-DRAFT-PATCH | Сохранить этап шаблона врага/монстра |',
    sha256: 'ef738b2bdf0d1183bea9a8cfdebf2724a68001969b16b75af6e6175f94d39121',
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
  {
    prefix: '| QA-FORM-ENM-006 | ENM-006 |',
    sha256: 'bf89b0cded453c7a57a4f19311ade4adf525763db3a5cc6e64d5957c82260f40',
  },
  {
    prefix: '| QA-CHANGE-ENM-006 | ENM-006 |',
    sha256: '8786e450ab2d4488f4bd364f18c20424214724cdd1f6a1999c38f6e3023b24e7',
  },
  {
    prefix: '| QA-FORM-ENM-007 | ENM-007 |',
    sha256: '3dc6b7734dc114e16dd2d009454a86ca03cb924db5cd55afc5c654ddfc40c48c',
  },
  {
    prefix: '| QA-CHANGE-ENM-007 | ENM-007 |',
    sha256: 'ad5c32a681bd931808d559df886dfdfd6cb3f287f32ce8402ab6f6c8a24385bf',
  },
  {
    prefix: '| QA-FORM-ENM-008 | ENM-008 |',
    sha256: '2b491ac0c4b462ae38f260c7ec5940c0d14e96680a6756ea0bb5adbd00d055f7',
  },
  {
    prefix: '| QA-CHANGE-ENM-008 | ENM-008 |',
    sha256: '6962df4379a90a5e11e372ee97b2336dc494e6eb7bbbcceceb923a07019b1167',
  },
  {
    prefix: '| QA-FORM-ENM-009 | ENM-009 |',
    sha256: '4a3a68388dafe690e16eaee393df3c815def73986a65e2815091a7ff6efd6ff3',
  },
  {
    prefix: '| QA-CHANGE-ENM-009 | ENM-009 |',
    sha256: 'c4ccdfdbd0f72f3606762665af221b0ca5191fdd2b9588c292a1ad65cc8b5446',
  },
  {
    prefix: '| QA-CHANGE-ENM-010 | ENM-010 |',
    sha256: 'c6f8ddeb214b263de8a5fb084ad23cc7b617d6587d6b03c7158bc7fed81c59d8',
  },
  {
    prefix: '| QA-FORM-ENM-020 | ENM-020 |',
    sha256: '930fcab05a04b2fc012fbe5c14bb96f83386c12d816110240ace8918057a0011',
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
