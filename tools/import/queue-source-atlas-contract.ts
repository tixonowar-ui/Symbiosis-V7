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
// Intersecting witnesses include the accepted initial poison source clarification in ADR 0087.
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'NET-016',
    sha256: '2b7c4d6da6b9008d9aa75f4c93f0cf9e3880901eef32ff9931291b073b4ec19e',
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
    sha256: '72ff40fd26fae74f1c9ff7110e7ece5cea42109657a45ee7437b1413e97b8fb8',
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
    id: 'GM-001',
    sha256: 'ed471b2a4d012676560ba374f0bc60943794dc5e959f19d8aa51f809e469e0ba',
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
    sha256: '5e0306eb339f59460b509b1e4c30ea2a2d8103634c076f9ebac7a0cc5c8c9b6d',
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
    sha256: 'bd33eac4d0763b23a9a15f32c93a275e633b47d9760e06db9cc1bca51e5c148e',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-009',
    sha256: '89085b7446e73c138cba5d43a5ebed63e5e5de2e82f4fb38ddc5601d7094fdff',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-011',
    sha256: '9059f1aee10156f1125796ff3e5e526a722120da4c2e91a6540a0aeb7beae594',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-012',
    sha256: '2e6869b70c139ec0c143b2b845073c85aecc0c029c996d6e8e68a7fcb0fe848e',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-055',
    sha256: '744ce4616caf774e119c2a44e45480bf59905b8e751784fe388639106e755810',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-016',
    sha256: 'd3e2247159593b73e269b80d5275fc28eb6be001dc7aac9830e33f6607e03050',
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
    sha256: '5c569036430f93fd2706b69731b47de03a239da47d7da15089ec7f4f55337594',
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
    sha256: '02d03c8d5f9ce024629873e4522f7b1798a25ed120baa5e37ccf133231745379',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-003',
    sha256: 'c147db5f94c17e45458a3bfc664fd34196875006a96067e4d179153e2a8c0a13',
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
    id: 'QA-CHANGE-NPC-007',
    sha256: '31b1c1a768482976fccb6a4eb7e13808f237f0564f60f8fc02a26397dbd425a5',
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
    sha256: '33232931edfe075435d4dc1705cbad5d9e261cbf05f8d5fbb167b47abd1ca919',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-CHANGE-NPC-016',
    sha256: 'a0e0dbf387cd0e426c589c30d8119e3a863e58b8eebd06cee538e375581f4a4a',
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
    id: 'QA-CHANGE-NPC-017',
    sha256: '5e4c44866d5f9f41c0718da8eaeeb4e9ad321fd11b745569f3e9dab36bb80fee',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-006',
    sha256: '5325030e32c78bd69143f2625437cae32103fca07fb01ec58b709fcc43ef5104',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-009',
    sha256: '9c69cbb9068440f3c04b9fec3544bcf050d61bb0c36d9c715c18ea1d1308109a',
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
    id: 'QA-REQ-055',
    sha256: '351fe4331eed729a67eabd12d33bd98e97fb9ad51639030c58eabbfd00a3b74a',
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
    id: 'QA-WORKFLOW-UI-CMD-CAMPAIGN-START',
    sha256: '6e78399dd454b5ce9e37a7f817a0565a002121dac8998e0b5548b5e463e84172',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK',
    sha256: 'ba782379715cfa6a7859e9c9182b013810245736f7ad116cafc914b38de66645',
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
    id: 'UI-CMD-CAMPAIGN-START',
    sha256: '1a16ab92a7e3571c2681738114da765437cf5cb6468140582988fbfb27a52c2c',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK',
    sha256: '7ae6a5c721df736ade1f317723f83669d5fffb96c7ed4959f6e1ca43dd476015',
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
    sha256: 'bf748a085136c77d7af91433c6bea36f4b2484fbc1df41b06fa2f9c83e062819',
  },
  {
    key: 'transitions',
    sha256: '21de208d98d9b353f1e7bf3a4cf62afa4222e503768adf4e9082c7b3c2d41563',
  },
  {
    // ADR 0092 / #284 changes only the intersecting SENTIENT PATCH witness.
    // ADR0094 / #288 changes only intersecting ENM017 PATCH/NEW-VERSION witnesses.
    key: 'registryCoverage',
    sha256: '2e2415528c3b661ea6a83fb3275d375b41d42f95a43230c7152e3b7e556ed534',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### NET-016 —',
    sha256: 'b5b954a18473dc3e71217dd96c79a99b1aa6692a729587482c7d471046038e56',
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
    sha256: 'a8e39750f947dda636d11149d4c5c4010ba3f563bc97ebc24f6640096326a9f9',
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
    prefix: '### GM-001 —',
    sha256: '8fc629e94fddecafd79dc89a2e5d9fa41b91ce100e11deed4c25c07e61041724',
  },
  {
    prefix: '### GM-002 —',
    sha256: '724f00ccbc97f9b5d62b2241ad74495d3db1d3117c31e45fcf5f74fdab80bbbb',
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
    prefix: '### J-GM-IMPORT-ADMISSION —',
    sha256: '110e478c237f041eae70832afa5b588e3c81b554c00ac9ebc10fbd4264635ce7',
  },
  {
    prefix: '### J-CAMPAIGN-CREATE —',
    sha256: 'ced4eff0f8ec279a85d42bfe5469a8320f9a90d7bb4749795468c989425b29e2',
  },
  {
    prefix: '### J-NPC-CREATE —',
    sha256: '102fd9983c20bf0c3fb08af1b45018a0e9ab5797e26e774f63ff7ec4638acaad',
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
    sha256: '303e3e60e1b7f583472943eb9e7ab88fd32a5ed7a82df423f26ba0d19a924acc',
  },
  {
    prefix: '| REQ-009 |',
    sha256: '35d9a900652d5237b3ca2d9b2d105b4665b45b70a95aaf09b84a49103aee167e',
  },
  {
    prefix: '| REQ-011 |',
    sha256: 'fa3eec12110d3ab88d4a9f6415a71a9c2ef81e517ff38ed3b07acbe450473523',
  },
  {
    prefix: '| REQ-012 |',
    sha256: '0641540589b84c8e3cce2e690e3c2cba259c14839f8958d6b53315f0e7e84ddf',
  },
  {
    prefix: '| REQ-055 |',
    sha256: '8e038ed0dff631861f885341eccd9c4b2c41a95622d1d1e3a084487907420751',
  },
  {
    prefix: '| QA-FORM-NET-016 |',
    sha256: 'bac6ad0e82aaf436cb9b369f09c495baf185e0df52572af242d8b25f0e1b4e35',
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
    sha256: '9c6084dcad2fa4c7df14129ba1eb69f38ce1a0174206c628bf0d9c056ddfbfc4',
  },
  {
    prefix: '| QA-CHANGE-PLY-030 |',
    sha256: '6d08170003a9a6ef2b7e0cdb1cdc6f8ff9a8554c640adc21f9381cc7c3790d1a',
  },
  {
    prefix: '| QA-FORM-NPC-003 |',
    sha256: '2b1b458c6f6b149a2f7f331528ca73289a18069a12f289d0df8caac199d0ec66',
  },
  {
    prefix: '| QA-CHANGE-NPC-003 |',
    sha256: '269e4f8b0ea304f7b073d14a968fc541e8315923e8dad26c81d3bfd9af2ae44a',
  },
  {
    prefix: '| QA-FORM-NPC-007 |',
    sha256: '86928fc91da065dd7fab60096e74f7906dfaf2ec9ca1a400909961e3dde77aac',
  },
  {
    prefix: '| QA-CHANGE-NPC-007 |',
    sha256: '825250d9e7832223ae4c6e0e95337fb94f2b41c508117dcda9945b51b37d63ca',
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
    sha256: '40b2b2c0555e1c66722aaa22f8b4e249a92b5e59817a9500328f2ddc3b29f64a',
  },
  {
    prefix: '| QA-CHANGE-NPC-016 |',
    sha256: 'ba968613efb1edc85c4e3cc0ca78b3595fa86513e05b295b543dec51b97ca7ff',
  },
  {
    prefix: '| QA-FORM-NPC-017 |',
    sha256: '6b0feac8bf9134fa16e959550383998d131958abd7283fc3ae4577bacc7a7afe',
  },
  {
    prefix: '| QA-CHANGE-NPC-017 |',
    sha256: 'd2f595920fc41b9d198aef3a0b3ca8ad1436ca6f970b8696545d14a3a8a4c374',
  },
  {
    prefix: '| QA-REQ-006 |',
    sha256: 'e4c2b7b72f63e58c3989c83d753cc26ebfe4daa3724c9abcd8721df3020e5aaa',
  },
  {
    prefix: '| QA-REQ-009 |',
    sha256: '8f5d7a29ac56081c240b7cbc765faf2a529c930e9b3932545e617f1e70ed5918',
  },
  {
    prefix: '| QA-REQ-011 |',
    sha256: '6d0fe0919a86d9fb807148b6b99a9dd60a2c702553457b00d38870f16a7acf91',
  },
  {
    prefix: '| QA-REQ-012 |',
    sha256: 'b32f693cfaa1c0693a8586bbfa90ffbe14b649a3ab98f50307c3d8901989e838',
  },
  {
    prefix: '| QA-REQ-055 |',
    sha256: '0ba6e842dc2febff9e0163291ccf7e77550dbe451ced829fcb0cbcb23488b1fb',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-COMMIT-V1 |',
    sha256: '575513bf127f191df767f9a2c9e1590acb0f3c32ec5fa708f467e3663294d335',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-NPC-NEW-VERSION |',
    sha256: '8533f4aae3b857d9dc5cdea346f46bce1f143e3ada07589536a410326b0fa7d5',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-CAMPAIGN-START |',
    sha256: '02e716fb2aad9cfb230312b821df962b65cff07386113a8501483083a6d926f3',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK |',
    sha256: '05f1c5553ce127a4e19d884d80011eadcb6b69d89d3473ed77e3a04d7aff21c3',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-CAMPAIGN-INITIAL-TIME-SET |',
    sha256: '5ea239ee4919daf7e079e887f3fc1a17db20b8463c598b19ea331b2eb017b278',
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
    prefix: '| UI-CMD-CAMPAIGN-START | Запустить подготовленную кампанию |',
    sha256: '0910b58da01910739533b110ac5aad4bd0bb24e6bd4b7d0ae65984d4fa1f0bb8',
  },
  {
    prefix:
      '| UI-CMD-LOCAL-CONTEXT-HANDOFF-ACK | Подтвердить локальную privacy-передачу активного контекста |',
    sha256: 'daf7fb3cc01dfcd946b63667acdcfcf4f283421938c9b01a25185d6834bb1d5f',
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
