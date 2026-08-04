/**
 * Narrowing helpers for data that arrives as `any`: `JSON.parse` results,
 * Obsidian frontmatter, and anything else read off disk.
 *
 * These don't add runtime validation the callers didn't already have — the
 * fuzz tests already prove the parsers tolerate garbage. They make the *types*
 * say so, which is what turns a wall of `no-unsafe-*` warnings back into
 * reviewable code and stops a typo'd key from silently reading `undefined`.
 */

/** A JSON object, safe to index with a string. */
export type Json = Record<string, unknown>;

/** Narrow to an indexable object. Arrays and null are rejected. */
export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `JSON.parse` that yields `unknown` and returns null instead of throwing. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Parse to an object, or null if the text is unparseable or isn't one. */
export function parseJsonObject(text: string): Json | null {
  const parsed = parseJson(text);
  return isRecord(parsed) ? parsed : null;
}

/** The value as a string, or undefined if it isn't one. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The value as a finite number, or undefined. Numeric strings are accepted. */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** The value as a boolean, or undefined if it isn't one. */
export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** The value as an array of strings; non-strings are dropped. */
export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === 'string');
}

/** A nested object property, or undefined when it's absent or not an object. */
export function recordAt(source: Json, key: string): Json | undefined {
  const value = source[key];
  return isRecord(value) ? value : undefined;
}
