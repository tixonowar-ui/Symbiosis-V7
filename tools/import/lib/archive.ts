/**
 * Reading ZIP containers — see ADR 0014.
 *
 * Two uses: embedded media inside xlsx workbooks (`xl/media/`, 64 item icons and
 * 16 bestiary artworks) and the frozen Runtime Pack. Both are plain ZIP, so one
 * fflate wrapper covers them.
 */
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { fail } from './fail.js';

export interface ArchiveEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export function openArchive(path: string, label: string): Map<string, Uint8Array> {
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(new Uint8Array(readFileSync(path)));
  } catch (cause) {
    fail(label, `cannot unzip: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const out = new Map<string, Uint8Array>();
  // Directory entries carry no payload and would otherwise be counted as files.
  for (const [name, bytes] of Object.entries(unpacked)) {
    if (name.endsWith('/')) continue;
    out.set(name, bytes);
  }
  return out;
}

/** Media embedded in an OOXML package, sorted by path for reproducible output. */
export function embeddedMedia(path: string, label: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const [name, bytes] of openArchive(path, label)) {
    if (name.startsWith('xl/media/')) entries.push({ path: name, bytes });
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
