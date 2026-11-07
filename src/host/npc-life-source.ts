import { createHash } from 'node:crypto';
import { networkApplicationStorage as s } from '../persistence/network-local-application.js';

/** Only exact delivered forms can enable the accepted initial life/Weaver contract. */
export function npcInitialLifeSourceAvailable(form: unknown): boolean {
  const digest = createHash('sha256').update(s.canonical(form)).digest('hex');
  // B12 adds only the reviewed custom-inventory acceptance/transition witnesses.
  // Neither predecessor authorizes the #237/#239 life contract.
  if (digest === '6365a7959dc15e889477662f2ef7e3481efa73c8a0fb3b6d5ea5fc7ab8ec0d15') return false;
  if (digest === '873ec35af41e7b12f0ba4a83f33a4834b4d61f0afe8c3cffdda4042812454dc1') return false;
  // Atlas 1.18/B13, merged source #237/#239; exact NPC-016 import object seal.
  if (digest === 'b4ac957e2715da8c46d6a76f3b643f785e738580b0c63923eab6cccaf6bbd1d7') return true;
  // Accepted B14 adds #240 while retaining the exact B13 life/Weaver witnesses.
  if (digest === '8b1d355b679f4e40b045829ced1209964bce13b585eb01e44b6402e6b675eb89') return true;
  throw new Error('NPC initial life source: unrecognized NPC-016 delivery');
}
/** No capability is enabled by a version label or a prefix match. */
export function npcInitialPoisonSourceAvailable(form: unknown): boolean {
  const digest = createHash('sha256').update(s.canonical(form)).digest('hex');
  if (digest === '8b1d355b679f4e40b045829ced1209964bce13b585eb01e44b6402e6b675eb89') return true;
  npcInitialLifeSourceAvailable(form);
  return false;
}
