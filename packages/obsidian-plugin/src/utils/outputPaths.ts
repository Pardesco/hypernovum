/**
 * Pure filename de-duplication, split out from vaultFiles.ts so it can be unit
 * tested (the `obsidian` module can't be imported under vitest).
 */

/**
 * First free name in the sequence `base.ext`, `base-2.ext`, `base-3.ext`, …
 *
 * `isTaken` is called with each candidate. Bounded so a pathological predicate
 * can't spin forever; the last candidate is returned even if taken, which at
 * worst overwrites — better than hanging a save.
 */
export function uniqueOutputName(
  base: string,
  extension: string,
  isTaken: (candidate: string) => boolean,
  limit = 500,
): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  let candidate = `${base}${ext}`;
  for (let n = 2; n <= limit && isTaken(candidate); n++) {
    candidate = `${base}-${n}${ext}`;
  }
  return candidate;
}
