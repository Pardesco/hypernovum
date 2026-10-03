/**
 * Pure session-digest logic (SES-002/003). Parses a session's JSONL event log
 * into a compact digest — no fs/obsidian, so it is unit-testable. SessionReader
 * handles the file reads.
 */

import { parseJsonObject } from '../utils/json';
import { samePath } from '../utils/projectPaths';

export interface ActivityEvent {
  t: number;
  sessionId: string;
  kind: 'session-start' | 'ping' | 'stop';
  name?: string;
  project?: string;
  /** Agent working directory (heartbeat 0.6.1+; absent in older logs). */
  cwd?: string;
  state?: string;
  tool?: string;
  file?: string;
}

export interface SessionDigest {
  sessionId: string;
  name?: string;
  project?: string;
  /** Last working directory the session reported, when its log carries one. */
  cwd?: string;
  startT: number;
  endT: number;
  durationMs: number;
  filesTouched: string[];
  ended: boolean;          // saw a stop event
}

/** Parse JSONL text into events, skipping malformed lines. */
export function parseSessionLines(text: string): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const e = parseJsonObject(trimmed); // null on a torn/garbage line
    if (!e) continue;
    if (typeof e.t === 'number' && typeof e.sessionId === 'string') {
      out.push(e as unknown as ActivityEvent);
    }
  }
  return out;
}

/** Reduce a session's events into a digest, or null if there are none. */
export function parseSessionDigest(events: ActivityEvent[]): SessionDigest | null {
  if (events.length === 0) return null;
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const files = new Set<string>();
  let name: string | undefined;
  let project: string | undefined;
  let cwd: string | undefined;
  for (const e of sorted) {
    if (e.file) files.add(e.file);
    if (e.name) name = e.name;
    if (e.project) project = e.project;
    if (typeof e.cwd === 'string' && e.cwd) cwd = e.cwd;
  }

  return {
    sessionId: first.sessionId,
    name,
    project,
    cwd,
    startT: first.t,
    endT: last.t,
    durationMs: Math.max(0, last.t - first.t),
    filesTouched: [...files],
    ended: sorted.some((e) => e.kind === 'stop'),
  };
}

/**
 * Whether a session digest belongs to a project (AGT-011).
 *
 * The working directory is checked first, against the project's resolved
 * folder — the same rule that puts a live orb on a building — so a session
 * pinged with `--cwd` and no `--project` gets its "Last session" row even when
 * the project's title differs from its folder name. Name matching (title or
 * folder basename) remains the fallback for logs written before 0.6.1.
 */
export function digestMatchesProject(
  digest: Pick<SessionDigest, 'project' | 'cwd'>,
  target: { title: string; dir: string | null },
): boolean {
  if (target.dir && digest.cwd && samePath(target.dir, digest.cwd)) return true;
  if (!digest.project) return false;
  const p = digest.project.toLowerCase();
  const dirBase = target.dir?.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase();
  return p === target.title.toLowerCase() || (!!dirBase && p === dirBase);
}
