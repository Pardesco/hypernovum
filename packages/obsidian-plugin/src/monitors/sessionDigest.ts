/**
 * Pure session-digest logic (SES-002/003). Parses a session's JSONL event log
 * into a compact digest — no fs/obsidian, so it is unit-testable. SessionReader
 * handles the file reads.
 */

import { parseJsonObject } from '../utils/json';

export interface ActivityEvent {
  t: number;
  sessionId: string;
  kind: 'session-start' | 'ping' | 'stop';
  name?: string;
  project?: string;
  state?: string;
  tool?: string;
  file?: string;
}

export interface SessionDigest {
  sessionId: string;
  name?: string;
  project?: string;
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
  for (const e of sorted) {
    if (e.file) files.add(e.file);
    if (e.name) name = e.name;
    if (e.project) project = e.project;
  }

  return {
    sessionId: first.sessionId,
    name,
    project,
    startT: first.t,
    endT: last.t,
    durationMs: Math.max(0, last.t - first.t),
    filesTouched: [...files],
    ended: sorted.some((e) => e.kind === 'stop'),
  };
}
