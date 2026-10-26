/**
 * Images embedded in an xlsx sheet, resolved to the rows they are anchored to.
 *
 * Pairing images with rows by sorting `xl/media/` would be wrong twice over:
 * the names sort lexicographically (`image10.png` before `image2.png`), and
 * nothing guarantees that upload order matches row order. OOXML records the
 * real anchoring, so the relationship chain is followed instead:
 *
 *   workbook.xml            sheet name → rId
 *   _rels/workbook.xml.rels rId        → worksheets/sheetN.xml
 *   worksheets/_rels/…rels  sheet      → drawings/drawingK.xml
 *   drawings/drawingK.xml   anchor     → row + rId
 *   drawings/_rels/…rels    rId        → media/imageM.png
 *
 * Every link is checked; a break anywhere stops the import.
 */
import { strFromU8 } from 'fflate';
import { fail } from './fail.js';
import { openArchive } from './archive.js';

const DRAWING_REL_TYPE = '/drawing';

export interface AnchoredImage {
  /** Zero-based sheet row the image is anchored to. */
  readonly row: number;
  /**
   * Zero-based sheet column. Needed when pictures are laid out in a grid rather
   * than one per row — the bestiary gallery puts two arts side by side.
   */
  readonly col: number;
  /** Path inside the package, e.g. `xl/media/image1.png`. */
  readonly source: string;
  readonly bytes: Uint8Array;
}

function read(zip: ReadonlyMap<string, Uint8Array>, path: string, label: string): string {
  const bytes = zip.get(path);
  if (bytes === undefined) {
    fail(label, `${path} not found in the package`);
  }
  return strFromU8(bytes);
}

/**
 * Packs the resolved target and the relationship type into one map value.
 * NUL cannot occur in either field, so it separates them unambiguously. It is
 * written as an escape, not as a raw byte: a literal NUL in the source would
 * make git treat this file as binary — see issue #18.
 */
const FIELD_SEPARATOR = '\u0000';

/** `Id` → `Target`, with targets resolved relative to `baseDir`. */
function relationships(xml: string, baseDir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = match[1] ?? '';
    const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    const type = /\bType="([^"]+)"/.exec(attrs)?.[1] ?? '';
    if (id === undefined || target === undefined) continue;
    out.set(id, resolve(baseDir, target) + FIELD_SEPARATOR + type);
  }
  return out;
}

function resolve(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseDir.split('/').filter((p) => p !== '');
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

function targetOf(value: string | undefined): string | undefined {
  return value?.split(FIELD_SEPARATOR)[0];
}

function typeOf(value: string | undefined): string {
  return value?.split(FIELD_SEPARATOR)[1] ?? '';
}

export function anchoredImages(
  archivePath: string,
  sheetName: string,
  label: string,
): AnchoredImage[] {
  const zip = openArchive(archivePath, label);

  // workbook.xml: sheet name → relationship id
  const workbook = read(zip, 'xl/workbook.xml', label);
  const sheetEntry = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].find((m) => {
    const name = /\bname="([^"]*)"/.exec(m[1] ?? '')?.[1];
    return name !== undefined && decodeXml(name) === sheetName;
  });
  if (sheetEntry === undefined) {
    fail(label, `sheet ${JSON.stringify(sheetName)} not listed in xl/workbook.xml`);
  }
  const sheetRid = /\br:id="([^"]+)"/.exec(sheetEntry[1] ?? '')?.[1];
  if (sheetRid === undefined) {
    fail(label, `sheet ${JSON.stringify(sheetName)} has no r:id in xl/workbook.xml`);
  }

  const workbookRels = relationships(read(zip, 'xl/_rels/workbook.xml.rels', label), 'xl');
  const sheetPath = targetOf(workbookRels.get(sheetRid));
  if (sheetPath === undefined) {
    fail(label, `relationship ${sheetRid} for sheet ${JSON.stringify(sheetName)} is unresolved`);
  }

  // sheet rels → drawing
  const sheetDir = sheetPath.slice(0, sheetPath.lastIndexOf('/'));
  const sheetFile = sheetPath.slice(sheetPath.lastIndexOf('/') + 1);
  const sheetRelsPath = `${sheetDir}/_rels/${sheetFile}.rels`;
  const sheetRels = relationships(read(zip, sheetRelsPath, label), sheetDir);
  const drawingPath = [...sheetRels.values()]
    .filter((v) => typeOf(v).endsWith(DRAWING_REL_TYPE))
    .map((v) => targetOf(v))
    .find((v) => v !== undefined);
  if (drawingPath === undefined) {
    fail(label, `sheet ${JSON.stringify(sheetName)} has no drawing relationship`);
  }

  // drawing anchors → row + image
  const drawingDir = drawingPath.slice(0, drawingPath.lastIndexOf('/'));
  const drawingFile = drawingPath.slice(drawingPath.lastIndexOf('/') + 1);
  const drawingRels = relationships(
    read(zip, `${drawingDir}/_rels/${drawingFile}.rels`, label),
    drawingDir,
  );
  const drawing = read(zip, drawingPath, label);

  const images: AnchoredImage[] = [];
  for (const anchor of drawing.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?(oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?\1>/g,
  )) {
    const block = anchor[0];
    const row =
      /<(?:[A-Za-z_][\w.-]*:)?from>[\s\S]*?<(?:[A-Za-z_][\w.-]*:)?row>(\d+)<\/(?:[A-Za-z_][\w.-]*:)?row>/.exec(
        block,
      )?.[1];
    const col =
      /<(?:[A-Za-z_][\w.-]*:)?from>[\s\S]*?<(?:[A-Za-z_][\w.-]*:)?col>(\d+)<\/(?:[A-Za-z_][\w.-]*:)?col>/.exec(
        block,
      )?.[1];
    const rid = /r:embed="([^"]+)"/.exec(block)?.[1];
    if (row === undefined || col === undefined || rid === undefined) {
      fail(label, `${drawingPath}: an anchor is missing its position or image reference`);
    }
    const source = targetOf(drawingRels.get(rid));
    if (source === undefined) {
      fail(label, `${drawingPath}: image relationship ${rid} is unresolved`);
    }
    const bytes = zip.get(source);
    if (bytes === undefined) {
      fail(label, `${source} referenced by ${drawingPath} is not in the package`);
    }
    images.push({ row: Number(row), col: Number(col), source, bytes });
  }

  // Position, not row alone: a gallery may place several pictures on one row.
  const positions = new Set(images.map((i) => `${String(i.row)}:${String(i.col)}`));
  if (positions.size !== images.length) {
    fail(label, `two images share an anchor position in ${JSON.stringify(sheetName)}`);
  }

  return images.sort((a, b) => a.row - b.row || a.col - b.col);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
