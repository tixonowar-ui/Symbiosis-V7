import { createHash } from 'node:crypto';
import { fail } from './lib/fail.js';
import { asArray, asObject, type JsonObject } from './lib/json.js';

/** Exact reviewed Atlas 1.12 objects, authorized by decisions 4–5 in #221 / ADR 0079. */
const OBJECT_SEALS = [
  {
    target: 'forms',
    key: 'id',
    id: 'APP-001',
    sha256: '50bd50d56b25d3e03378061434e5837c7085c4a5fa78c1cfd7139690bfc69e9e',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'APP-002',
    sha256: '7b7fd633ba5d9fc5ccb6eae526cd2c84cc854079f137bef295404d22da832aa5',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-008',
    sha256: '484e943140500dc1f1652f29c92a31ec27f5e89ed157e4102732b00d757f324c',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-009',
    sha256: 'ea3b7fb49f7ccfdbf2196f1480f27fe846b2bef89d73fb6f8d9d4c0e801039bb',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-010',
    sha256: '9e29bed28c6e2e8fd0ec1deff54d924ed31bf08aaeffb3e430bd006cdf6a98d0',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-024',
    sha256: 'b22e35f765486b82f4b6e288bdba344c320ba985e2d9e054179902a9eacfbdc2',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'NET-025',
    sha256: '630b2c91356fc57dc0e3666a6e143dad70629d09ac41bd74d70c7bb51cc57469',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'CMP-015',
    sha256: 'ee43f433e403a1c14e49d25c51e0e92d3c390c18d0e5dc8ed3d576b301b89b20',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'GM-001',
    sha256: '910889c4e2e7a2935afc0c2149a007228a92476b8015764b2d91546f0affcdba',
  },
  {
    target: 'forms',
    key: 'id',
    id: 'APP-011',
    sha256: '663696d78911782f915d4422c78098b9789a641ffa6bac4fbbccba01b102c848',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-RECONNECT',
    sha256: '407da238722c9eba14a146c8ee82ed5b0e45a72c38a32644b9ebc12b75353c35',
  },
  {
    target: 'journeys',
    key: 'id',
    id: 'J-MASTER-TRANSFER',
    sha256: '2ee714c6391d3b53ce8726336e939299a802b4557691d640f1e185ebd8cf7e08',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-031',
    sha256: 'e92608cdc8fc5fa230c4df3d4664dbb67902862b384737d267b1b5dde1a958be',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-050',
    sha256: '5e5b18fbb54a7041ada2b19b2d58885a695f373078cd3fe3ba3708760eb80252',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-057',
    sha256: 'f2b5f026d91d330d206263327112f35dba6ec500e2324312ef7373bcf74f2b9e',
  },
  {
    target: 'coverageRequirements',
    key: 'requirementId',
    id: 'REQ-058',
    sha256: 'a44311230d5e95c2e25b41b71e7ce21c67d9c6a45cfcf2f5059d98472b34e04d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-009',
    sha256: '644185be1d3db11ff50f24158ae1ba3aebd5a5905c94f16b970421d3bb2b4567',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-024',
    sha256: 'd7e860d4ba0789ad6e1faa802c3f4deeca805a1123d58fb22d76245d810c1369',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-FORM-NET-025',
    sha256: 'c4cc34088c079158adf68f45add5024503a051b919ee9e5dca19868afa5afbca',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-031',
    sha256: 'aa2d5070cd3bdafbbf4e67f221975ddfcca0682921b32b13f0de7ea4f1c42384',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-050',
    sha256: '6d3f9e2d5870b2ae6f7317c4ccf1ed21c0ab0c2b92b656a3c4022443b6331892',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-057',
    sha256: '74df1c491b32e18b8da2a79bf4d86232823e23316dc6667788a4d6176b0264b8',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-REQ-058',
    sha256: 'd81545038ffeb580225c9f0983945569b18eefce5316fb73979bbdc07fafd593',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-UNLOCK',
    sha256: '8d69e74e62e28772383363d29b3d479ba8e1901748b2995db233c7865e472726',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-COMMIT',
    sha256: '2ce72c7a04ab3a4885cbe0760a91ead6c36096b6f70546d94fb037ae73523cd7',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-QNA-Q-CAMP-009-ROW-296',
    sha256: '2124d6e633e2b1e599ef4d2728eab3f6b36c2cf22d48adf02be6af683972eef1',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-ACK',
    sha256: '8125cf99f9605554d578c45cee4f1d1770decb00a767424b4c66178ad90b77df',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-CANCEL',
    sha256: 'e3b0c8398b56b617823ab4463f6e72524338658eeeb08f04c0a4083042b32a6d',
  },
  {
    target: 'qaScenarios',
    key: 'qaId',
    id: 'QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-RECONNECT',
    sha256: 'fdc5a4cdd835e08f0465a8b48b637eb58e9f9ac3a28ab85e1e5d1b9ac74d8806',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-MASTER-TRANSFER-UNLOCK',
    sha256: 'ce93c92675ebe135d0983ca0a194fac9f502c17dbef4401b944d10b6e972ff11',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-MASTER-TRANSFER-COMMIT',
    sha256: '2bceedfd9786ee0dd5c9429fa3e62289056443e3350835f7a9863d8716a50f72',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-MASTER-TRANSFER-ACK',
    sha256: '6ff4846ec84238b9155d76441e031103f8ac1dc0f68f0fac171f6ab65a1bfef0',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-MASTER-TRANSFER-CANCEL',
    sha256: 'cefa0adc7ca9f96d0ccce09b7b043013efa3d733259d2b7bf5017df74c7e8e60',
  },
  {
    target: 'workflowCommands',
    key: 'commandId',
    id: 'UI-CMD-MASTER-TRANSFER-RECONNECT',
    sha256: '1f05f4671cd5d3457437f6f912ec3d6c37a5efaeb7a9746c991abaf9d95460f0',
  },
] as const;
const ROOT_SEALS = [
  {
    key: 'counts',
    sha256: '1824e006901903a81275a8562ec37560238dc9042f4d4588885b51f469ee7e7f',
  },
  {
    key: 'transitions',
    sha256: 'b076cda3f751ed503e635034d769ea179f4a20f6fdd5a654ad9dd0882c1ad15a',
  },
  {
    key: 'registryCoverage',
    sha256: '327b95f752271eb26ca7dbece2c8bb5903486ecb418cc365832437d707256805',
  },
] as const;
const MARKDOWN_SECTIONS = [
  {
    prefix: '### APP-001 —',
    sha256: '23a0a9bececabbdeb634ba96a28831ab5964ca519fabeecdc3a93e0a3dd64ef9',
  },
  {
    prefix: '### APP-002 —',
    sha256: '5340bbbc62f461158e4ed9348fb13f6f5338da86f3a079d19fa5afb49752bbdd',
  },
  {
    prefix: '### NET-008 —',
    sha256: '2327a68fa6fe7f7483d422fe81797511262392f242fc266a6059d5cd224eb1c4',
  },
  {
    prefix: '### NET-009 —',
    sha256: '69634fd03bccb4236933317970653433e804d593fae0884190403171f6649bbd',
  },
  {
    prefix: '### NET-010 —',
    sha256: '2496abb37b7fc5cce905fbe6cb47969230984e6a4e81f19107ccd3587b196917',
  },
  {
    prefix: '### NET-024 —',
    sha256: '773e9ab060877753f771c3772c960a942fbe4fa6782011fedd402cb4b5c6941a',
  },
  {
    prefix: '### NET-025 —',
    sha256: '70601a6810a2cc4ed4b70a80f142c457b20d24f47ffd5cfc587c5d00cf666982',
  },
  {
    prefix: '### CMP-015 —',
    sha256: '577a31e344520d73570a0ba39034b1a5576699e507bff53af3db5f4e3a98707a',
  },
  {
    prefix: '### GM-001 —',
    sha256: 'b6c68faa89e85692134963187c297caeb52b76662968ddd6e81c675130bebf23',
  },
  {
    prefix: '### APP-011 —',
    sha256: 'b4a6bde209d34074a50a88719dad22ef2d25be472292df4a18340230673dbdcb',
  },
  {
    prefix: '### J-RECONNECT —',
    sha256: '4f626cd4ae8fc44b9cbbc6183081b9fbdf3bf4bd1737b52b147dfbad9ebabbaf',
  },
  {
    prefix: '### J-MASTER-TRANSFER —',
    sha256: 'ffb613c7e51c5b7dc6bdc43faf3c053894d7dc6584e7270a6c9102f933d0a7bb',
  },
] as const;
const MARKDOWN_LINES = [
  {
    prefix: '| REQ-031 |',
    sha256: '2e4ed1aee0135011ae92d08548bcb008e7d7df94982a2ac258bb4d0a14eb3786',
  },
  {
    prefix: '| REQ-050 |',
    sha256: '9dee009486c27933791a491f7e593c60a4e7c1886e8e782c18ece566f7221032',
  },
  {
    prefix: '| REQ-057 |',
    sha256: '887f6abb2e755d4ac1b416dcdc51a82b8d67e951e4762efee1c9f3e5926e0b84',
  },
  {
    prefix: '| REQ-058 |',
    sha256: '6f297898d32c157a056c392ef5fc1deceb155fe958d8afd78f9713ab24947322',
  },
  {
    prefix: '| QA-FORM-NET-009 |',
    sha256: '34cc5f4ce904d6a14584ab49bfab5ea29b4c2d3453c72ab48161d3f2b05290ff',
  },
  {
    prefix: '| QA-FORM-NET-024 |',
    sha256: '309d6ab0dc1c27e1f948cd70a5f7d10dceeedc64b21768e3d3046cf829e7da33',
  },
  {
    prefix: '| QA-FORM-NET-025 |',
    sha256: 'd7730c0373b2c2ce5c8b88fdb0d12f5aa3601f760dadf3bb06fcf8208fdf9f51',
  },
  {
    prefix: '| QA-REQ-031 |',
    sha256: '35e7e764ca77738496c8d5638ed2ab203e78e335f8a5940ae687fdb90192b899',
  },
  {
    prefix: '| QA-REQ-050 |',
    sha256: '7ce5bd0d202b601be53c4d9912ddfb40c170c9ecc39f7f4d5f33cc434ae19520',
  },
  {
    prefix: '| QA-REQ-057 |',
    sha256: 'dbb855490f9cedd4f9b5fcfe83bd193db4004048f9c95e7a2c3a45b8aa813805',
  },
  {
    prefix: '| QA-REQ-058 |',
    sha256: '7d2925a5ec4b6fa9c0e83202ad67bcab7e23f69d99064e3d34c3b624386df2da',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-UNLOCK |',
    sha256: 'dc8af07484638df2745c79bfd9fa66a2ea90635ed375d0498ab9592879f36fbe',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-COMMIT |',
    sha256: 'a46da710c75d92e8ae8c5d4ff26d6cdc6146d68310254ce319547ccd4b7f62fb',
  },
  {
    prefix: '| QA-QNA-Q-CAMP-009-ROW-296 |',
    sha256: '934a1557c051dc0812eefe258dd90ae6963d22805b11c224c60a95f1fa5babd7',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-ACK |',
    sha256: '46a7b348c5cd67f77d193e53bc91ebdfb631571370d17db5c89e025d361e9ae4',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-CANCEL |',
    sha256: 'e6c6ab3741acc25b5f26e3b39fa106bca53d515800f33ca9a9077efbc8c23410',
  },
  {
    prefix: '| QA-WORKFLOW-UI-CMD-MASTER-TRANSFER-RECONNECT |',
    sha256: '079c05e6d300437a968758e0a72e47811adcb06cfd651d125de6b84809116d2a',
  },
  {
    prefix: '| UI-CMD-MASTER-TRANSFER-UNLOCK | Разблокировать передачу мастера |',
    sha256: '9d95b11c0df1865c3e5ff6ac03a3f78127e1da332314e4bbc12bc1f2de0610bb',
  },
  {
    prefix: '| UI-CMD-MASTER-TRANSFER-COMMIT | Передать полномочия одному преемнику |',
    sha256: '9e36a5e240aad84b308ff30d922a6ab8113956e4f38dda7e3b838eec97593d10',
  },
  {
    prefix: '| UI-CMD-MASTER-TRANSFER-ACK | Подтвердить или отклонить принятие роли мастера |',
    sha256: '8dee0f41455e6ab54c0cd63b56b6d4638d4679579776f29a7b08445e572936c4',
  },
  {
    prefix: '| UI-CMD-MASTER-TRANSFER-CANCEL | Отменить передачу до общего commit |',
    sha256: '1e13184cdfc40ca914212eeffaaba4603de94117989f963b43284b8fa3b3fae6',
  },
  {
    prefix: '| UI-CMD-MASTER-TRANSFER-RECONNECT | Переподключиться к подтверждённому преемнику |',
    sha256: '3585a915f010ae1463afd592f3d620b3950502c103758b11f15894cad24027be',
  },
] as const;
const WHERE = 'atlas ADR 0079';

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
    fail(WHERE, label + ' differs from the approved normal master-transfer source contract');
}

/** Whole objects include authority, fields, draft variants and both local route mirrors. */
export function assertAdr0079NormalTransfer(root: JsonObject): void {
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
export function assertAdr0079NormalTransferMarkdown(input: string): void {
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
