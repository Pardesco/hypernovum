/**
 * Pure fleet-merge logic — no `obsidian` import, so it is unit-testable.
 *
 * Normalizes the v2 per-session snapshots (<vault>/.hypernovum/agents/*.json)
 * into one AgentPresence list: freshest-first, deduped by session id, capped.
 */

/** v2 snapshot file shape written by scripts/heartbeat.js (§7.4). */
export interface HeartbeatSnapshotV2 {
  version: number;
  sessionId: string;
  name?: string;
  agentType?: string;
  project: string | null;
  state?: string;
  action: string | null;
  tool?: string | null;
  file?: string | null;
  sessionStart: number;
  lastPing: number;
  branch?: string;
  dirtyAtStart?: boolean;
  stoppedAt?: number;
}

/** One agent's presence, normalized from a v2 snapshot (§7.5 subset). */
export interface AgentPresence {
  id: string;                 // sessionId (or 'legacy')
  name?: string;
  agentType?: string;
  project: string | null;
  /**
   * Agent working directory, when the heartbeat reported one. Matched against
   * resolved project directories — more reliable than the project *name*, which
   * only matches when a project's title equals its folder basename.
   */
  cwd?: string | null;
  action: string | null;
  state?: string;             // explicit snapshot state; undefined → registry infers
  tool?: string | null;
  file?: string | null;
  lastPing: number;
  sessionStart?: number;
  dirtyAtStart?: boolean;
  branch?: string;
  active: boolean;            // snapshot did not signal stop/complete
}

/** Max sessions surfaced to the UI per poll (freshest first). */
export const FLEET_CAP = 32;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Parse one v2 snapshot object into a presence. Returns null when the object
 * is unusable (missing id/ping) so the caller can count it as degraded data.
 */
export function parseSnapshotToPresence(value: unknown): AgentPresence | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = str(raw.sessionId);
  const lastPing = Number(raw.lastPing);
  if (!id || !Number.isFinite(lastPing) || lastPing <= 0) return null;

  const state = str(raw.state);
  return {
    id,
    name: str(raw.name),
    agentType: str(raw.agentType),
    project: raw.project == null ? null : strOrNull(raw.project),
    cwd: raw.cwd == null ? null : strOrNull(raw.cwd),
    action: strOrNull(raw.action),
    state,
    tool: raw.tool == null ? null : strOrNull(raw.tool),
    file: raw.file == null ? null : strOrNull(raw.file),
    lastPing,
    sessionStart: Number(raw.sessionStart) || lastPing,
    dirtyAtStart: typeof raw.dirtyAtStart === 'boolean' ? raw.dirtyAtStart : undefined,
    branch: str(raw.branch),
    active: state !== 'complete' && state !== 'failed' && raw.stoppedAt == null,
  };
}

/** Sort presences freshest-first, dedupe by session id, and cap. */
export function mergeFleet(
  v2: AgentPresence[],
  cap: number = FLEET_CAP,
): AgentPresence[] {
  const merged = [...v2];

  merged.sort((a, b) => b.lastPing - a.lastPing);

  // Dedupe by id, keeping the freshest — guards against a duplicate sneaking in
  // (e.g. a half-written snapshot momentarily visible under two names).
  const seen = new Set<string>();
  const deduped: AgentPresence[] = [];
  for (const p of merged) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    deduped.push(p);
  }
  return deduped.slice(0, cap);
}
