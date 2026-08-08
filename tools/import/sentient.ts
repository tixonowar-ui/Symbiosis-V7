/**
 * Default Sentient Enemy Registry v1.2 and its frozen Runtime Pack →
 * generated/spec/sentient, generated/media/sentient and
 * generated/types/sentient.ts.
 *
 * Both artifacts are frozen by bytes in the delivery manifest and accepted on a
 * forward-compatibility assertion rather than a version match (ADR 0007). The
 * pack is the source for runtime art; the registry declares the SHA-256 each
 * art must have, so the two are checked against each other before anything is
 * written.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { strFromU8 } from 'fflate';
import { openArchive } from './lib/archive.js';
import { banner, tsUnion, writeJson, writeText } from './lib/emit.js';
import { expectCount, fail } from './lib/fail.js';
import { asObject, asString, type JsonObject, type JsonValue } from './lib/json.js';
import { ARTIFACT, MEDIA_DIR, SPEC_DIR, TYPES_DIR } from './lib/paths.js';
import { Workbook } from './lib/workbook.js';

const WHERE = 'sentient';
const SOURCE = 'artifacts/registries/Symbiosis_V7_Default_Sentient_Enemy_Registry_v1.2.xlsx';
const PACK_SOURCE = 'artifacts/packs/Symbiosis_V7_Default_Sentient_Enemy_Runtime_Pack_v1.2.zip';
const PASS = 'PASS';

const TEMPLATES = '01_Шаблоны';
const ARTS = '07_Арты';
const CONTRACT = '08_Контракт';
const PAYLOADS = '12_Payload_JSON';

const EXPECTED_TEMPLATES = 44;
const PACK_FILES = 50;
const PACK_ART_DIR = 'runtime-pack/art/';
const PACK_CATALOG = 'runtime-pack/catalog.json';
const PACK_MANIFEST = 'runtime-pack/package_manifest.json';

/**
 * The tuple the pack was built against. Deliberately older than the current
 * line (Rules v1.7 | Character v1.2 | Items v1.6 | Bestiary v1.4) — that is the
 * whole point of ADR 0007. Recorded here so a silent change is visible.
 */
const PACK_BUILT_AGAINST =
  'Rules v1.6 | Character-Skills-Symbionts v1.1 | Items v1.5_with_icons | Bestiary v1.3 | Sentient v1.2';

/** RTC-011: the frozen payload must keep sentient enemies out of progression. */
const NO_XP_CONTRACT: readonly (readonly [string, string])[] = [
  ['actorType', 'SYSTEM_SENTIENT_ENEMY'],
  ['progressionPolicy', 'NO_XP_PROGRESSION'],
  ['symbiontXpProgressPoints', 'PROHIBITED_FIELD'],
  ['unallocatedSymbiontXp', 'PROHIBITED_FIELD'],
];

/**
 * The same invariants restated per template. The contract sheet says it once;
 * these columns say it 44 times, and a template that drifted would otherwise
 * pass on the strength of the summary alone.
 */
const TEMPLATE_INVARIANTS: readonly (readonly [string, string])[] = [
  ['ActorType', 'SYSTEM_SENTIENT_ENEMY'],
  ['ProgressionPolicy', 'NO_XP_PROGRESSION'],
  ['Immutable', 'true'],
];

const GATES = [
  { sheet: '00_Паспорт', key: 'Метрика', result: 'Проверка', rows: 8 },
  { sheet: '09_QA', key: 'CheckID', result: 'Status', rows: 1195 },
] as const;

const TABLES = [
  { sheet: TEMPLATES, out: 'templates.json', key: 'SystemTemplateID', rows: 44 },
  { sheet: '02_Характеристики', out: 'stats.json', key: 'SystemTemplateID', rows: 44 },
  { sheet: '03_Навыки', out: 'skills.json', key: 'SystemTemplateID', rows: 93 },
  { sheet: '04_Симбионты', out: 'symbionts.json', key: 'SystemTemplateID', rows: 71 },
  { sheet: '05_Имущество', out: 'equipment.json', key: 'SystemTemplateID', rows: 169 },
  { sheet: '06_Профили_оружия', out: 'weapon-profiles.json', key: 'ProfileVersionID', rows: 17 },
  { sheet: ARTS, out: 'arts.json', key: 'ArtAssetID', rows: 44 },
  { sheet: CONTRACT, out: 'contract.json', key: 'ContractKey', rows: 34 },
  { sheet: '09_QA', out: 'qa.json', key: 'CheckID', rows: 1195 },
  { sheet: '10_Справочники', out: 'dictionaries.json', key: 'Dictionary', rows: 65 },
  { sheet: '11_Источники', out: 'sources.json', key: 'Источник', rows: 7 },
  { sheet: PAYLOADS, out: 'payloads.json', key: 'SystemTemplateID', rows: 44 },
] as const;

export interface SentientImport {
  readonly templates: number;
  readonly arts: number;
  readonly packFiles: number;
  readonly bytesWritten: number;
  readonly mediaBytes: number;
  readonly files: readonly string[];
}

function text(record: JsonObject, column: string): string {
  const value = record[column];
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fail(WHERE, `column ${JSON.stringify(column)} holds a non-scalar value`);
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export async function importSentient(): Promise<SentientImport> {
  const book = Workbook.open(ARTIFACT.sentient, WHERE);

  // --- gates --------------------------------------------------------------
  for (const gate of GATES) {
    const rows = book.table(gate.sheet, 2, [gate.key, gate.result]).records(gate.key);
    expectCount(WHERE, `${gate.sheet} rows`, rows.length, gate.rows);
    const failures = rows.filter((row) => text(row, gate.result) !== PASS);
    if (failures.length > 0) {
      fail(
        WHERE,
        `${gate.sheet}: ${String(failures.length)} row(s) do not report ${PASS}: ` +
          failures
            .slice(0, 5)
            .map((row) => `${text(row, gate.key)} → ${text(row, gate.result)}`)
            .join('; '),
      );
    }
  }

  // --- tables -------------------------------------------------------------
  const collected = new Map<string, JsonObject[]>();
  const dir = join(SPEC_DIR, 'sentient');
  let bytes = 0;
  const files: string[] = [];

  for (const table of TABLES) {
    const rows = book.table(table.sheet, 2, [table.key]).records(table.key);
    expectCount(WHERE, `${table.sheet} rows`, rows.length, table.rows);
    collected.set(table.sheet, rows);
    bytes += await writeJson(join(dir, table.out), rows);
    files.push(`generated/spec/sentient/${table.out}`);
  }

  const templateIds = new Set(
    (collected.get(TEMPLATES) ?? []).map((row) => text(row, 'SystemTemplateID')),
  );
  expectCount(WHERE, 'system templates', templateIds.size, EXPECTED_TEMPLATES);

  for (const sheet of [
    '02_Характеристики',
    '03_Навыки',
    '04_Симбионты',
    '05_Имущество',
    ARTS,
    PAYLOADS,
  ]) {
    (collected.get(sheet) ?? []).forEach((row, index) => {
      const id = text(row, 'SystemTemplateID');
      if (id !== '' && !templateIds.has(id)) {
        fail(WHERE, `${sheet}[${String(index)}]: unknown SystemTemplateID ${JSON.stringify(id)}`);
      }
    });
  }

  assertAdr0007Contract(collected.get(CONTRACT) ?? []);
  assertTemplateInvariants(collected.get(TEMPLATES) ?? []);

  // --- frozen runtime pack ------------------------------------------------
  const pack = openArchive(ARTIFACT.runtimePack, `${WHERE}/pack`);
  expectCount(WHERE, 'runtime pack files', pack.size, PACK_FILES);

  assertForwardCompatibility(pack);
  const mediaBytes = await extractArts(pack, collected.get(ARTS) ?? []);
  assertPayloadAgreement(pack, collected.get(PAYLOADS) ?? []);

  bytes += await writeJson(join(dir, 'meta.json'), {
    source: SOURCE,
    packSource: PACK_SOURCE,
    registryVersion: 'v1.2',
    templates: templateIds.size,
    arts: (collected.get(ARTS) ?? []).length,
    packFiles: pack.size,
    packBuiltAgainst: PACK_BUILT_AGAINST,
    forwardCompatibilityAsserted: true,
    gatesAllPass: true,
    mediaDir: 'generated/media/sentient',
  });
  files.push('generated/spec/sentient/meta.json');

  bytes += await writeText(join(TYPES_DIR, 'sentient.ts'), renderTypes(collected));
  files.push('generated/types/sentient.ts');

  return {
    templates: templateIds.size,
    arts: (collected.get(ARTS) ?? []).length,
    packFiles: pack.size,
    bytesWritten: bytes,
    mediaBytes,
    files,
  };
}

/**
 * RTC-011. The registry states these as contract keys; ADR 0007 depends on them
 * holding. A frozen artifact that starts allowing progression is not a frozen
 * artifact, so a change here stops the import instead of flowing through.
 */
export function assertAdr0007Contract(contract: readonly JsonObject[]): void {
  const declared = new Map(
    contract.map((row) => [text(row, 'ContractKey'), text(row, 'Нормативное значение')]),
  );
  for (const [key, expected] of NO_XP_CONTRACT) {
    const actual = declared.get(key);
    if (actual === undefined) {
      fail(WHERE, `${CONTRACT}: contract key ${JSON.stringify(key)} is missing; ADR 0007 needs it`);
    }
    if (actual !== expected) {
      fail(
        WHERE,
        `${CONTRACT}: ${key} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}. ` +
          'ADR 0007 records sentient enemies as excluded from progression.',
      );
    }
  }
}

/** RTC-011 restated per template, so one drifted row cannot hide behind the summary. */
export function assertTemplateInvariants(templates: readonly JsonObject[]): void {
  templates.forEach((template, index) => {
    const id = text(template, 'SystemTemplateID');
    for (const [column, expected] of TEMPLATE_INVARIANTS) {
      const actual = text(template, column);
      if (actual !== expected) {
        fail(
          WHERE,
          `${TEMPLATES}[${String(index)}] ${id}: ${column} is ${JSON.stringify(actual)}, ` +
            `expected ${JSON.stringify(expected)}. ADR 0007 depends on it.`,
        );
      }
    }
  });
}

/**
 * ADR 0007: the pack is accepted because it asserts forward compatibility, not
 * because its dependency tuple matches the current line — it deliberately does
 * not. This checks the tuple is the frozen one, and never that it equals today's
 * versions; requiring that would reject a valid pack.
 */
function assertForwardCompatibility(pack: ReadonlyMap<string, Uint8Array>): void {
  const raw = pack.get(PACK_MANIFEST);
  if (raw === undefined) {
    fail(WHERE, `${PACK_MANIFEST} is missing from the runtime pack`);
  }
  const manifest = asObject(JSON.parse(strFromU8(raw)) as JsonValue, WHERE, PACK_MANIFEST);
  const tuple = asString(manifest['dependencyTuple'], WHERE, `${PACK_MANIFEST}.dependencyTuple`);
  if (tuple !== PACK_BUILT_AGAINST) {
    fail(
      WHERE,
      `the pack declares builtAgainst ${JSON.stringify(tuple)}, but ADR 0007 records ` +
        `${JSON.stringify(PACK_BUILT_AGAINST)}. A reissued pack needs the ADR revisited.`,
    );
  }
}

/**
 * Art comes from the pack, which ADR 0007 makes the source for exact system art.
 * The registry independently declares the SHA-256 each file must have, so the
 * two statements are compared before a byte is written.
 */
async function extractArts(
  pack: ReadonlyMap<string, Uint8Array>,
  artRows: readonly JsonObject[],
): Promise<number> {
  const outDir = join(MEDIA_DIR, 'sentient');
  await mkdir(outDir, { recursive: true });

  const packArts = [...pack.keys()].filter((name) => name.startsWith(PACK_ART_DIR));
  expectCount(WHERE, 'arts in the runtime pack', packArts.length, EXPECTED_TEMPLATES);

  let written = 0;
  const used = new Set<string>();

  for (const row of artRows) {
    const runtimeFile = text(row, 'Runtime-файл');
    const declaredSha = text(row, 'SHA-256 PNG').toLowerCase();
    const artId = text(row, 'ArtAssetID');
    if (runtimeFile === '' || declaredSha === '') {
      fail(WHERE, `${ARTS}: ${artId} has no runtime file name or declared SHA-256`);
    }

    const bytes = pack.get(PACK_ART_DIR + runtimeFile);
    if (bytes === undefined) {
      fail(WHERE, `${ARTS}: ${artId} names ${runtimeFile}, which is not in the runtime pack`);
    }
    const actual = sha256(bytes);
    if (actual !== declaredSha) {
      fail(
        WHERE,
        `${ARTS}: ${runtimeFile} hashes to ${actual}, but the registry declares ${declaredSha}. ` +
          'The frozen pack and the registry disagree.',
      );
    }
    if (used.has(runtimeFile)) {
      fail(WHERE, `${ARTS}: ${runtimeFile} is claimed by more than one art row`);
    }
    used.add(runtimeFile);

    await writeFile(join(outDir, runtimeFile), bytes);
    written += bytes.byteLength;
  }

  expectCount(WHERE, 'arts written', used.size, EXPECTED_TEMPLATES);
  return written;
}

/** The pack's catalogue and the registry must agree on every payload digest. */
function assertPayloadAgreement(
  pack: ReadonlyMap<string, Uint8Array>,
  payloadRows: readonly JsonObject[],
): void {
  const raw = pack.get(PACK_CATALOG);
  if (raw === undefined) {
    fail(WHERE, `${PACK_CATALOG} is missing from the runtime pack`);
  }
  const catalog = asObject(JSON.parse(strFromU8(raw)) as JsonValue, WHERE, PACK_CATALOG);
  const digests = asObject(
    catalog['payloadSha256BySystemTemplateId'],
    WHERE,
    `${PACK_CATALOG}.payloadSha256BySystemTemplateId`,
  );

  for (const row of payloadRows) {
    const id = text(row, 'SystemTemplateID');
    const declared = text(row, 'Payload SHA-256').toLowerCase();
    const inPack = asString(
      digests[id],
      WHERE,
      `${PACK_CATALOG}.payloadSha256BySystemTemplateId[${JSON.stringify(id)}]`,
    ).toLowerCase();
    if (declared !== inPack) {
      fail(
        WHERE,
        `payload digest for ${id} is ${declared} in the registry but ${inPack} in the pack`,
      );
    }
  }
}

function renderTypes(collected: ReadonlyMap<string, JsonObject[]>): string {
  const codes = (sheet: string, column: string): string[] =>
    [...new Set((collected.get(sheet) ?? []).map((r) => text(r, column)))]
      .filter((v) => v !== '')
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return [
    banner(SOURCE),
    '',
    tsUnion(
      'SystemTemplateId',
      codes(TEMPLATES, 'SystemTemplateID'),
      '44 frozen system templates: 12 pure, 16 free, 16 united.',
    ),
    '',
    tsUnion('SentientArtAssetId', codes(ARTS, 'ArtAssetID')),
    '',
    tsUnion('SentientContractKey', codes(CONTRACT, 'ContractKey')),
    '',
    tsUnion('SentientGroup', codes(TEMPLATES, 'Группа')),
    '',
  ].join('\n');
}
