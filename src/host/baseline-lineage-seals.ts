/** ADR0068: reviewed exact source bytes and approved Atlas-only successor. */
export const BASELINE_LINEAGE_SEALS = {
  historicalBaselineVersion:
    'sha256:4ed1aadbbfffe96b5f90d919c6cb1074a03c9aefddb33dcf094408ad69a0e149',
  successorBaselineVersion:
    'sha256:0fb6bf63fa399d7715fa75ae251dce83d3cdff670688bb025228756a2478343f',
  successorAtlas: {
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
      'b74d81999c106883d7094ec7720f65af075d7930f17c3256fcbb3611b451feb3',
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
      '057462be4694e7623b1225bd8efe9cd620bef9510c3a849a1e344ef017d7ceb0',
  },
  // ADR 0071 / #199 authorizes this exact Atlas-only successor, not a version range.
  admissionBaselineVersion:
    'sha256:86556630d19ca9d3581f182c153d0a520016d143612a999e9c8417d073a6182f',
  admissionAtlas: {
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
      '04a372d909c2ca576651047ef4c6e90d59b3372e54a3ff05c6852a2371764c01',
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
      '26669e296a3b1117925e7efce4704977b79e8d94d3693be234a1ba7cbb9c54e5',
  },
  // ADR 0073 / #206: exact approved lobby/Start source delivery.
  lobbyBaselineVersion: 'sha256:eff116587643326c61b73c9fb1c650aec1aca40bd755a68eb1cccc449a2462ac',
  lobbyAtlas: {
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
      'cfa313d7f1755ccfad06fa09c5161f8a7cac3ea01df95e4418da2dca1c1c1ff7',
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
      '22f048c80d11a947bb814a156a2d58b91c3cbd35f1ebe8b240191bac0c63b811',
  },
  // ADR 0075 / #208: exact approved safe-settings source delivery.
  settingsBaselineVersion:
    'sha256:a72bbea3faa6ba11e0eaac7f1ea5d7a2f7d2b0197c345c55f3ed360e1ab3f24b',
  settingsAtlas: {
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
      'd354cce5f0e00d6554cafac000518cef2ff6bfecc1641f58647579b096c6e484',
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
      '6a11ef9453cdd4fbe861a7c65b6c9227cc928b5c40aebaa784ead2eca7e41e89',
  },
  // ADR 0077 / #186: exact Atlas plus three approved GM art paths; no mechanics change.
  gmSourceBaselineVersion:
    'sha256:8487957025cf3bb29f892f057b924d7f44c5db214e8ea3fda427132e78e0f40c',
  gmSourceAtlas: {
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
      'a4f23d8282acecdf1e8209b53cc8fab196c169db14d9b31af4d504666b45003a',
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
      '8b66f22b88eda02345ad3e0933d218467da533c801f8781f2d349a4260aae558',
  },
  // ADR 0078 / #221: exact Atlas-only successor; prior GM art and mechanics remain sealed.
  queueSourceBaselineVersion:
    'sha256:0fc96e57886ef0051667f48f9ada58b1152f7ae8ca0b547397879fadd32779ab',
  queueSourceAtlas: {
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
      '3097f40e94901d1928591e7b967e80e9c57be09b015af38869eaa96120751563',
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
      'a8972fe03778ed8869580d162bf08f44b6d793e49c35e78b95732901905169fd',
  },
  // ADR 0079 / #221: exact normal-transfer Atlas successor; no new art or mechanics.
  normalTransferBaselineVersion:
    'sha256:00cf6b3773528c767d3e1b05488a521497745b2e8d6a7d0c5ab1667b7424bacc',
  normalTransferAtlas: {
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
      '2a31ca54a27096f0b8a704c59a38e7c16cbf585def5211e7a3700a0db8799deb',
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
      '53be8e781e116e9467f3a90fedd240884f4875884c2de7056a1bda0ee411d1ea',
  },
  // ADR 0080 / #221: exact recovery Atlas successor; no new art or mechanics.
  recoveryBaselineVersion:
    'sha256:2f47b6aca09e5826fe502a6fc12661e415e5fae2fcecea1a3aaf1ebfd39bf8f7',
  recoveryAtlas: {
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
      '7ba06a64842204b0df1e1ca5e21403093d66beb702a8bb156ea6b2f34a0695e8',
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
      'e9d130077f6d3178a15d0054394b387dff4c892a10f79644e52f2dc539bcbc77',
  },
  // ADR 0081 / #228: exact initial NPC trauma source; no old snapshot rewrite.
  initialTraumaBaselineVersion:
    'sha256:d19b288a208943da83b2e25569adfa96fc7ef7722d5539e776509ff19d4719b2',
  initialTraumaAtlas: {
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
      'badcb72c2667fd12ece51e782ab932600189ceeb0e3969b757a90717f112a47a',
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
      '8b9438fcc70c37e2a0091de408403f689696f1b3a9b314b37816b1d36446d387',
  },
  // ADR 0082 / #224, #226, #227, #232: exact NPC source clarification; saved bytes remain unchanged.
  npcRulesBaselineVersion:
    'sha256:ab8f52c27442a697b098d9863e0ed90e6b2a4b8a7995aadd55ee57ad9a6860c9',
  npcRulesAtlas: {
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
      '5b79638b2b555523fa730849f2f1a4acb07f33f6604bb3ef488a3a47cfd4364b',
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
      '18c21dd61b4bdf6651f563fd7a0a4de0592ade88cd98c54a1165ff6a253b7f32',
  },
  // ADR 0083 / #234: exact fresh Trogr death source; historical versions and receipts remain sealed.
  freshTrogrBaselineVersion:
    'sha256:66e56c0be943bb52978a933571bfb98db6eeaa6264819a0cfbdcdcaaf44a9e7c',
  freshTrogrAtlas: {
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.json':
      'edd42440dcbb0f5c32e0bd38844b4d0411ef77e8358fc043340f03d721f7dec1',
    'atlas/Symbiosis_V7_Web_UI_Screen_Atlas_v1.2.md':
      '5fe7a5d7eef07610047e80050a9aa9be31ede6d1545739d97ce84561ca03b0ed',
  },
  gmSourceAddedArtifacts: {
    'gm-entity-portraits/manifest.json':
      '30b4df3f3bc7ffeff017fc28538dcf09f98c1e032ff94cd1e9cfc141c4714554',
    'gm-entity-portraits/symbiosis_placeholder_monster.png':
      '563c23e0190bff9b5498bc0ec46830f9209fa1d181fe163e3ea76edbab7e7e86',
    'gm-entity-portraits/symbiosis_placeholder_sentient_enemy.png':
      '5da7ee70db7c47dabfa92522e5bc8c9855c8a0c7596764d00b8b24cebd570a3f',
  },
  replayCatalogDigests: {
    'generated/spec/character/classes.json':
      '6bfdb854b7d3158c882017a2b89314795dd88f674b540a91e89fdea1db0c62e6',
    'generated/spec/character/development-nodes.json':
      '01fda838194b43c40e063f07e06d9a9b3de3b132cb4c2937333eab3cfe3c06db',
    'generated/spec/character/dictionaries.json':
      'c11666e947bc2aa516a1d3b2975d522a6a0916dfe95523ac83a6441ad5630320',
    'generated/spec/character/incompatibilities.json':
      '25e934656fdf3d73e9c9592cc45a41bb835307eeed48fbb99838155df46374cc',
    'generated/spec/character/modifiers.json':
      '77c4feb7aac0e5d0b0cc8262506c272ac43a09dd33eb8d6207abafd653f36a88',
    'generated/spec/character/races.json':
      '39aa6bc6cc397bd522b9e06f39d66f1a3a6abc53ddf4eb7ec87f7caef17a5ca5',
    'generated/spec/character/runtime-contracts.json':
      '056ef3b035bb19a681203313b6adaa906d648b890ef1424b32137dd7aa83e64d',
    'generated/spec/character/skill-requirements.json':
      'f625e9c4cf9a4be7c9349091593416b4d014699268ed8ab9ed365c5d7eee8fc3',
    'generated/spec/character/skills.json':
      'c98d4e0a19edc5118feeac2e9aa7d874642048bf368f09a623c820d22faaf59f',
    'generated/spec/character/stats.json':
      'a09452c21b1634ac08c660dd17ace1a5de3e9f8c6750b6c134d3cfc7b83b2469',
    'generated/spec/character/symbionts.json':
      'bb90ac96379ec554f57c7c409ccb978455b379de4c3e28b1ab3c257e62bd37ce',
    'generated/spec/rules/rules.json':
      'f570c4d5109aedab4bb5c2a41423dd07d53d5151f748b8ec78272463de10797d',
    'generated/spec/items/armor-profiles.json':
      'f2934bfb9f9322e1d914bbd9a71797e52fed94b9ec1c4ee088b703fc49c3365b',
    'generated/spec/items/catalogue.json':
      'd3737b0fd63ff047fcd14e2973386ff625b4f6574b37046476c4eb315fb6322f',
    'generated/spec/items/combat-values.json':
      '8e7bc66d96e46cfd62d47c1cea433409a903d356ac510408e470db57cda1f302',
    'generated/spec/items/dictionaries.json':
      'e759a86271f3fbe235ff744a4f9105587af9c99c13c836f054f207728cc7397e',
    'generated/spec/items/formula-ranges.json':
      '4f808737c1cc64fb6b640514bec2ddd58dd2afcde86ecdf65e537f94c6304ba4',
    'generated/spec/items/formulas.json':
      '2bd7acef8cc40ed626108bf6d1676e24fc2796f9aeec1699e68dbb281edc5282',
    'generated/spec/items/instance-model.json':
      '3a43f8da22cf02eac3cc02497ac6a5c4cc28b01fad76170cc851d8ab861d91be',
    'generated/spec/items/open-catalogue.json':
      '3a58e70175bc13b7f6c2bd30c047bd7675b2ed9bd966029990d0395705ea1718',
    'generated/spec/items/operations.json':
      'edf261545b14b1949d71bd830a4529f587ef1688eef841ebb81521e17a894135',
    'generated/spec/items/rule-trace.json':
      '6e25faf3b671505cb3cbe50f66604eb748ed768310b25ccb011bb908506f2069',
    'generated/spec/items/weapon-fields.json':
      'eefbc6b0bd18c8050e37c5b57d3aefe39607b4ff4e0ba0ae25b11cd7e9f06665',
    'generated/spec/items/weapon-profiles.json':
      '2e188b0c8329ffa2c9d1681ba91918b47b447231450b1cbdd9e1e52477dd52ff',
  },
  runtimeTuple: {
    registryVersion: '1.2',
    catalogVersion: 'SYMBIOSIS_CHARACTER_SKILLS_SYMBIONTS_V1.2',
    builtAgainstTuple:
      'Rules v1.6 | Character-Skills-Symbionts v1.1 | Items v1.5_with_icons | Bestiary v1.3 | Sentient v1.2',
  },
} as const;
