/**
 * Agent session registry (AGT-003).
 *
 * Consumes the merged fleet (AgentPresence[]) each poll and maintains a
 * coherent Map<sessionId, AgentSession> with:
 *   - the §10 lifecycle state (explicit state wins when fresh; else inferred
 *     from tool/action; else the age ladder waiting → stale → disconnected),
 *   - accumulated filesTouched per (session, project),
 *   - stable startedAt (reset only when a same-id session restarts).
 *
 * The state-derivation is a pure exported function so §10 can be table-tested;
 * the class only handles accumulation and project resolution.
 */

import type { AgentPresence } from './fleetMerge';

export type AgentState =
  | 'starting' | 'planning' | 'reading' | 'editing' | 'running' | 'testing'
  | 'reviewing' | 'waiting' | 'blocked' | 'complete' | 'failed'
  | 'stale' | 'disconnected';

export interface AgentSession {
  sessionId: string;
  name: string;
  agentType?: string;
  projectPath: string | null;         // resolved to a ProjectData.path
  state: AgentState;
  action: string | null;
  tool?: string | null;
  file?: string | null;
  filesTouched: Map<string /*projectPath*/, Set<string>>;
  sessionStart: number;
  lastPing: number;
  dirtyAtStart?: boolean;
}

// §10 timing bands
export const FRESH_MS = 10_000;          // explicit state / tool inference window
export const WAITING_MAX_MS = 120_000;   // 10s–120s → waiting
export const DISCONNECT_MS = 15 * 60_000; // >15min → disconnected (removed)

/** Live states that an explicit fresh snapshot may assert directly. */
const LIVE_STATES = new Set<AgentState>([
  'starting', 'planning', 'reading', 'editing', 'running', 'testing', 'reviewing', 'waiting',
]);

/** Infer a working state from the tool/action when no explicit state is given. */
export function inferStateFromTool(tool?: string | null, action?: string | null): AgentState {
  const a = (action ?? '').toLowerCase();
  if (a.includes('test')) return 'testing';
  switch (tool) {
    case 'Edit': case 'Write': case 'NotebookEdit': return 'editing';
    case 'Read': case 'Grep': case 'Glob': return 'reading';
    case 'Bash': case 'PowerShell': return 'running';
    default: return 'running';
  }
}

/**
 * Derive the displayed §10 state for a presence at time `now`.
 * Deterministic and side-effect-free.
 */
export function deriveAgentState(presence: AgentPresence, now: number): AgentState {
  const age = now - presence.lastPing;
  const explicit = presence.state as AgentState | undefined;

  // Sticky terminal/blocked states (rule 5). complete never goes stale (fades
  // visually, row persists 24h); failed/blocked stay red until the session
  // ages past the waiting window, then join the stale ladder.
  if (explicit === 'complete') return 'complete';
  if (explicit === 'failed') return age <= WAITING_MAX_MS ? 'failed' : 'stale';
  if (explicit === 'blocked') return age <= WAITING_MAX_MS ? 'blocked' : 'stale';

  // Disconnect ladder end (rule 4).
  if (age > DISCONNECT_MS) return 'disconnected';

  // Fresh: explicit live state wins (rule 1), else infer from tool/action (rule 2).
  if (age <= FRESH_MS) {
    if (explicit && LIVE_STATES.has(explicit)) return explicit;
    return inferStateFromTool(presence.tool, presence.action);
  }

  // 10s–120s → waiting (rule 3); 120s–15min → stale (rule 4).
  return age <= WAITING_MAX_MS ? 'waiting' : 'stale';
}

/** Forward-slash + trim; conflict detection normalizes further against project dir. */
function normalizeFile(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

export class AgentRegistry {
  private sessions = new Map<string, AgentSession>();

  /**
   * @param resolveProject maps a presence to a ProjectData.path (or null).
   *   Injected by the view so the registry stays obsidian-free.
   */
  constructor(private resolveProject: (presence: AgentPresence) => string | null) {}

  /**
   * Reconcile the registry against this poll's full fleet and return the
   * current session snapshots. Sessions absent from the fleet (file pruned or
   * off the 32-cap) and disconnected sessions are dropped.
   */
  update(presences: AgentPresence[], now: number): AgentSession[] {
    const seen = new Set<string>();

    for (const p of presences) {
      seen.add(p.id);
      const projectPath = this.resolveProject(p);
      const start = p.sessionStart;

      let s = this.sessions.get(p.id);
      // New session, or a same-id session that restarted (fresh sessionStart).
      if (!s || (start !== undefined && s.sessionStart !== start)) {
        s = {
          sessionId: p.id,
          name: p.name ?? 'Agent',
          agentType: p.agentType,
          projectPath,
          state: 'starting',
          action: p.action,
          tool: p.tool,
          file: p.file,
          filesTouched: new Map(),
          sessionStart: start ?? p.lastPing,
          lastPing: p.lastPing,
          dirtyAtStart: p.dirtyAtStart,
        };
        this.sessions.set(p.id, s);
      }

      // Update mutable fields.
      if (p.name) s.name = p.name;
      if (p.agentType) s.agentType = p.agentType;
      s.projectPath = projectPath;
      s.action = p.action;
      s.tool = p.tool;
      s.file = p.file;
      s.lastPing = p.lastPing;
      if (s.dirtyAtStart === undefined && p.dirtyAtStart !== undefined) s.dirtyAtStart = p.dirtyAtStart;
      s.state = deriveAgentState(p, now);

      // Accumulate filesTouched per (session, project).
      if (p.file && projectPath) {
        let set = s.filesTouched.get(projectPath);
        if (!set) { set = new Set(); s.filesTouched.set(projectPath, set); }
        set.add(normalizeFile(p.file));
      }
    }

    // Drop sessions gone from the fleet, and any that aged to disconnected.
    for (const [id, s] of this.sessions) {
      if (!seen.has(id) || s.state === 'disconnected') this.sessions.delete(id);
    }

    return [...this.sessions.values()];
  }

  getSessions(): AgentSession[] {
    return [...this.sessions.values()];
  }

  /** Sessions resolved to a given project (active + recently-completed). */
  sessionsForProject(projectPath: string): AgentSession[] {
    return [...this.sessions.values()].filter((s) => s.projectPath === projectPath);
  }

  clear(): void {
    this.sessions.clear();
  }
}
