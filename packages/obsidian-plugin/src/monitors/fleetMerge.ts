/**
 * Pure fleet-merge logic — no `obsidian` import, so it is unit-testable.
 *
 * Reads two presence sources and produces one normalized AgentPresence list:
 *   1. v2 per-session snapshots  (<vault>/.hypernovum/agents/*.json)
 *   2. the legacy single-status file (.hypernovum-status.json)
 *
 * Legacy support keeps existing users' unmodified hooks rendering (as the
 * anonymous 'legacy' agent) for one release; see plan §7.4 migration path.
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
  objective?: string;
  plannedFiles?: string[];
  sessionStart: number;
  lastPing: number;
  branch?: string;
  dirtyAtStart?: boolean;
  stoppedAt?: number;
}

/** One agent's presence, normalized across v2 + legacy sources (§7.5 subset). */
export interface AgentPresence {
  id: string;                 // sessionId (or 'legacy')
  name?: string;
  agentType?: string;
  project: string | null;
  action: string | null;
  state?: string;             // explicit snapshot state; undefined → registry infers
  tool?: string | null;
  file?: string | null;
  lastPing: number;
  sessionStart?: number;
  dirtyAtStart?: boolean;
  branch?: string;
  objective?: string;
  plannedFiles?: string[];
  active: boolean;            // snapshot did not signal stop/complete
  legacy: boolean;
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
export function parseSnapshotToPresence(raw: any): AgentPresence | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.sessionId);
  const lastPing = Number(raw.lastPing);
  if (!id || !Number.isFinite(lastPing) || lastPing <= 0) return null;

  const state = str(raw.state);
  return {
    id,
    name: str(raw.name),
    agentType: str(raw.agentType),
    project: raw.project == null ? null : strOrNull(raw.project),
    action: strOrNull(raw.action),
    state,
    tool: raw.tool == null ? null : strOrNull(raw.tool),
    file: raw.file == null ? null : strOrNull(raw.file),
    lastPing,
    sessionStart: Number(raw.sessionStart) || lastPing,
    dirtyAtStart: typeof raw.dirtyAtStart === 'boolean' ? raw.dirtyAtStart : undefined,
    branch: str(raw.branch),
    objective: str(raw.objective),
    plannedFiles: Array.isArray(raw.plannedFiles)
      ? raw.plannedFiles.filter((f: unknown): f is string => typeof f === 'string')
      : undefined,
    active: state !== 'complete' && state !== 'failed' && raw.stoppedAt == null,
    legacy: false,
  };
}

/**
 * Convert the legacy single-status file into a presence (id 'legacy').
 * Mirrors the old anonymous-agent behavior. Returns null if unusable.
 */
export function legacyToPresence(raw: any): AgentPresence | null {
  if (!raw || typeof raw !== 'object') return null;
  const lastPing = Number(raw.lastPing);
  if (!Number.isFinite(lastPing) || lastPing <= 0) return null;
  return {
    id: 'legacy',
    name: str(raw.name),
    project: raw.project == null ? null : strOrNull(raw.project),
    action: strOrNull(raw.action),
    tool: raw.tool == null ? null : strOrNull(raw.tool),
    file: raw.file == null ? null : strOrNull(raw.file),
    lastPing,
    active: raw.active !== false,
    legacy: true,
  };
}

/**
 * Merge v2 presences with the legacy presence, dedupe, sort freshest-first,
 * and cap. The legacy entry is dropped when any v2 session already claims the
 * same project with an equal-or-fresher ping (avoids a duplicate anonymous orb
 * for a session that has upgraded to v2 heartbeats).
 */
export function mergeFleet(
  v2: AgentPresence[],
  legacy: AgentPresence | null,
  cap: number = FLEET_CAP,
): AgentPresence[] {
  const merged = [...v2];

  if (legacy) {
    const supersededByV2 = v2.some(
      (p) =>
        p.project != null &&
        legacy.project != null &&
        p.project === legacy.project &&
        p.lastPing >= legacy.lastPing,
    );
    if (!supersededByV2) merged.push(legacy);
  }

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
