/**
 * Deterministic conflict detection (AGT-007).
 *
 * Pure: given the current agent sessions and the projects, produce a stable,
 * deduped list of ConflictRecords. No AI, no heuristics beyond the §7.6 rules.
 * Clobbering is NOT checked — the v2 heartbeat format eliminates it structurally.
 */

import type { ProjectData } from '@hypernovum/core';
import type { AgentSession, AgentState } from './AgentRegistry';

export type ConflictKind =
  | 'same-file' | 'overlapping-files' | 'same-project'
  | 'stale-context' | 'complete-while-conflicted';

export interface ConflictRecord {
  key: string;                 // stable dedupe key (kind + sorted ids + path)
  kind: ConflictKind;
  severity: 'high' | 'medium' | 'info';
  sessions: string[];          // sessionIds involved (1 or 2)
  projectPaths: string[];
  files?: string[];            // offending intersection (capped list)
  message: string;
}

// overlapping-files thresholds (tunable)
const OVERLAP_MIN_COUNT = 3;
const OVERLAP_MIN_RATIO = 0.3;
const MAX_FILES_LISTED = 8;

/** A session counts as "working" for overlap/same-project checks. */
const WORKING_STATES = new Set<AgentState>([
  'starting', 'planning', 'reading', 'editing', 'running', 'testing', 'reviewing', 'waiting', 'blocked',
]);

function isWorking(s: AgentSession): boolean {
  return WORKING_STATES.has(s.state);
}

/** Normalize a file key against the project dir so relative/absolute forms match. */
function normalize(file: string, projectDir?: string): string {
  let f = file.replace(/\\/g, '/').toLowerCase().trim();
  if (projectDir) {
    const dir = projectDir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    if (dir && f.startsWith(dir + '/')) f = f.slice(dir.length + 1);
  }
  return f.replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Files a session touched on a given project, normalized. */
function normalizedFiles(s: AgentSession, projectPath: string, projectDir?: string): Set<string> {
  const raw = s.filesTouched.get(projectPath);
  if (!raw) return new Set();
  return new Set([...raw].map((f) => normalize(f, projectDir)));
}

function intersect(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const x of a) if (b.has(x)) out.push(x);
  return out.sort();
}

function displayName(s: AgentSession): string {
  return s.name || (s.legacy ? 'Agent' : s.sessionId);
}

/**
 * Compute conflicts across the current sessions. Deterministic and deduped.
 * @param projects used for git state (dirty / merge conflicts) and projectDir.
 */
export function detectConflicts(sessions: AgentSession[], projects: ProjectData[]): ConflictRecord[] {
  const byPath = new Map<string, ProjectData>();
  for (const p of projects) byPath.set(p.path, p);

  const records = new Map<string, ConflictRecord>();
  const add = (r: ConflictRecord) => { if (!records.has(r.key)) records.set(r.key, r); };

  // --- Pairwise checks over working sessions sharing a project ---
  const working = sessions.filter(isWorking);
  for (let i = 0; i < working.length; i++) {
    for (let j = i + 1; j < working.length; j++) {
      const a = working[i];
      const b = working[j];
      if (!a.projectPath || a.projectPath !== b.projectPath) continue;

      const projectPath = a.projectPath;
      const project = byPath.get(projectPath);
      const pair = [a.sessionId, b.sessionId].sort();

      const filesA = normalizedFiles(a, projectPath, project?.projectDir);
      const filesB = normalizedFiles(b, projectPath, project?.projectDir);
      const shared = intersect(filesA, filesB);

      if (shared.length >= 1) {
        // A lone shared file is always the acute same-file (high) signal;
        // broad overlap (≥3 files, or ≥2 at ≥30% of the smaller set) is the
        // softer overlapping-files (medium) awareness signal.
        const ratio = shared.length / Math.min(filesA.size, filesB.size || 1);
        const isOverlap =
          shared.length >= OVERLAP_MIN_COUNT ||
          (shared.length >= 2 && ratio >= OVERLAP_MIN_RATIO);
        if (!isOverlap) {
          add({
            key: `same-file|${pair.join('|')}|${shared[0]}`,
            kind: 'same-file',
            severity: 'high',
            sessions: pair,
            projectPaths: [projectPath],
            files: shared.slice(0, MAX_FILES_LISTED),
            message: `${displayName(a)} and ${displayName(b)} both touched ${shared[0]}`,
          });
        } else {
          add({
            key: `overlapping-files|${pair.join('|')}`,
            kind: 'overlapping-files',
            severity: 'medium',
            sessions: pair,
            projectPaths: [projectPath],
            files: shared.slice(0, MAX_FILES_LISTED),
            message: `${displayName(a)} and ${displayName(b)} overlap on ${shared.length} files`,
          });
        }
      } else {
        // Same project, no file overlap → informational co-presence.
        add({
          key: `same-project|${pair.join('|')}|${projectPath}`,
          kind: 'same-project',
          severity: 'info',
          sessions: pair,
          projectPaths: [projectPath],
          message: `${displayName(a)} and ${displayName(b)} are both working in ${project?.title ?? projectPath}`,
        });
      }
    }
  }

  // --- Per-session checks against git state ---
  for (const s of sessions) {
    if (!s.projectPath) continue;
    const project = byPath.get(s.projectPath);
    if (!project) continue;
    const git = project.gitActivity;

    // stale-context: a working session that started on a dirty tree.
    if (isWorking(s) && s.dirtyAtStart) {
      add({
        key: `stale-context|${s.sessionId}|${s.projectPath}`,
        kind: 'stale-context',
        severity: 'info',
        sessions: [s.sessionId],
        projectPaths: [s.projectPath],
        message: `${displayName(s)} started on a dirty working tree in ${project.title}`,
      });
    }

    // complete-while-conflicted: session finished while the repo is mid-merge.
    if (s.state === 'complete' && git?.hasMergeConflicts) {
      add({
        key: `complete-while-conflicted|${s.sessionId}|${s.projectPath}`,
        kind: 'complete-while-conflicted',
        severity: 'high',
        sessions: [s.sessionId],
        projectPaths: [s.projectPath],
        message: `${displayName(s)} completed while ${project.title} has an unresolved merge`,
      });
    }
  }

  return [...records.values()];
}
