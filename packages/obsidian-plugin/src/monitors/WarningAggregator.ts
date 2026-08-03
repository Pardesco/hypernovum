/**
 * Warning aggregator (TRI-001).
 *
 * Pure `computeWarnings(projects, sessions, conflicts, degraded)` implementing
 * the §11 triage catalog with a severity ramp. Everything is recomputed each
 * call (nothing persisted). Consumers (Needs-Attention lens, inspector rows)
 * decide layout; helpers here provide the per-project top warning and the
 * anti-overwhelm badge count.
 */

import type { ProjectData } from '@hypernovum/core';
import type { AgentSession, AgentState } from './AgentRegistry';
import type { ConflictRecord } from './ConflictDetector';
import { resolveProjectRef } from './dependencyMatch';

export type WarningType =
  | 'merge-conflict' | 'agents-same-file' | 'agent-failed' | 'blocked'
  | 'agent-waiting' | 'uncommitted' | 'behind-upstream' | 'stale-project'
  | 'stale-agent' | 'broken-link' | 'degraded-data';

export type WarningSeverity = 'high' | 'medium' | 'low';

export type WarningActionKind =
  | 'focus' | 'open-note' | 'launch-agent' | 'open-terminal' | 'show-conflict';

export interface WarningItem {
  key: string;
  projectPath: string | null;   // null = vault-level (e.g. degraded data)
  type: WarningType;
  severity: WarningSeverity;
  message: string;
  action: { label: string; kind: WarningActionKind };
}

const RANK: Record<WarningSeverity, number> = { high: 3, medium: 2, low: 1 };

/** Numeric severity for sorting (high first). */
function severityRank(s: WarningSeverity): number {
  return RANK[s];
}

const STALE_DAYS = 30;
const WORKING_STATES = new Set<AgentState>([
  'starting', 'planning', 'reading', 'editing', 'running', 'testing', 'reviewing', 'waiting', 'blocked',
]);

function daysSince(ms: number): number {
  if (!ms || ms <= 0) return Infinity;
  return (Date.now() - ms) / (1000 * 60 * 60 * 24);
}

function displayName(s: AgentSession): string {
  return s.name || s.sessionId;
}

/**
 * Compute the full warning list (unsorted-by-project, sorted by severity).
 * @param degradedCount unreadable agent/manifest files this poll (→ degraded-data).
 */
export function computeWarnings(
  projects: ProjectData[],
  sessions: AgentSession[],
  conflicts: ConflictRecord[],
  degradedCount = 0,
): WarningItem[] {
  const items: WarningItem[] = [];
  const byPath = new Map<string, ProjectData>();
  for (const p of projects) byPath.set(p.path, p);
  const refList = projects.map((p) => ({ path: p.path, title: p.title }));

  // Projects that legitimately have a dirty tree because an agent is mid-work.
  const projectsWithWorkingAgent = new Set<string>();
  for (const s of sessions) {
    if (s.projectPath && WORKING_STATES.has(s.state)) projectsWithWorkingAgent.add(s.projectPath);
  }

  // --- Per-project git + status warnings ---
  for (const p of projects) {
    const git = p.gitActivity;

    if (git?.hasMergeConflicts) {
      items.push({
        key: `merge-conflict|${p.path}`, projectPath: p.path, type: 'merge-conflict', severity: 'high',
        message: 'Merge in progress / conflicted',
        action: { label: 'Open terminal', kind: 'open-terminal' },
      });
    }

    // Resolve blocked_by refs → blocker titles; unresolved → broken-link (low).
    const blockerTitles: string[] = [];
    for (const ref of p.blockedBy ?? []) {
      const targetPath = resolveProjectRef(ref, refList);
      if (targetPath) {
        blockerTitles.push(byPath.get(targetPath)?.title ?? targetPath);
      } else {
        items.push({
          key: `broken-link|${p.path}|${ref}`, projectPath: p.path, type: 'broken-link', severity: 'low',
          message: `blocked_by target not found: ${ref}`,
          action: { label: 'Open note', kind: 'open-note' },
        });
      }
    }

    if (p.status === 'blocked') {
      items.push({
        key: `blocked|${p.path}`, projectPath: p.path, type: 'blocked', severity: 'high',
        message: blockerTitles.length ? `Blocked by ${blockerTitles.join(', ')}` : 'Blocked',
        action: { label: 'Focus', kind: 'focus' },
      });
    }

    if (git?.hasUncommittedChanges && !projectsWithWorkingAgent.has(p.path)) {
      items.push({
        key: `uncommitted|${p.path}`, projectPath: p.path, type: 'uncommitted', severity: 'medium',
        message: 'Uncommitted changes',
        action: { label: 'Open terminal', kind: 'open-terminal' },
      });
    }

    if (git && git.behind != null && git.behind > 0) {
      items.push({
        key: `behind-upstream|${p.path}`, projectPath: p.path, type: 'behind-upstream', severity: 'medium',
        message: `Branch ${git.behind} behind upstream`,
        action: { label: 'Open terminal', kind: 'open-terminal' },
      });
    }

    if (p.status === 'active') {
      const d = daysSince(git?.lastCommitDate ?? p.lastModified ?? 0);
      if (d > STALE_DAYS && Number.isFinite(d)) {
        items.push({
          key: `stale-project|${p.path}`, projectPath: p.path, type: 'stale-project', severity: 'low',
          message: `No activity for ${Math.round(d)} days`,
          action: { label: 'Open note', kind: 'open-note' },
        });
      }
    }
  }

  // --- Agent conflict warnings ---
  for (const c of conflicts) {
    if (c.kind === 'same-file' || c.kind === 'overlapping-files') {
      items.push({
        key: `conflict|${c.key}`, projectPath: c.projectPaths[0] ?? null, type: 'agents-same-file',
        severity: c.severity === 'high' ? 'high' : 'medium',
        message: c.message,
        action: { label: 'Show conflict', kind: 'show-conflict' },
      });
    }
  }

  // --- Per-agent state warnings ---
  for (const s of sessions) {
    if (s.state === 'failed') {
      items.push({
        key: `agent-failed|${s.sessionId}`, projectPath: s.projectPath, type: 'agent-failed', severity: 'high',
        message: `${displayName(s)} reported failure`,
        action: { label: 'Open note', kind: 'open-note' },
      });
    } else if (s.state === 'waiting') {
      items.push({
        key: `agent-waiting|${s.sessionId}`, projectPath: s.projectPath, type: 'agent-waiting', severity: 'medium',
        message: `${displayName(s)} may be waiting on input`,
        action: { label: 'Focus', kind: 'focus' },
      });
    } else if (s.state === 'stale') {
      items.push({
        key: `stale-agent|${s.sessionId}`, projectPath: s.projectPath, type: 'stale-agent', severity: 'low',
        message: `${displayName(s)} heartbeat stale`,
        action: { label: 'Focus', kind: 'focus' },
      });
    }
  }

  // --- Vault-level degraded data ---
  if (degradedCount > 0) {
    items.push({
      key: 'degraded-data', projectPath: null, type: 'degraded-data', severity: 'low',
      message: `${degradedCount} unreadable data file${degradedCount === 1 ? '' : 's'} (see console)`,
      action: { label: 'Open note', kind: 'open-note' },
    });
  }

  return items.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

/**
 * One warning per project — the highest-severity one — for the city overview
 * (§11: overview shows each project's top warning only). Vault-level warnings
 * (null projectPath) are keyed under an empty string.
 */
export function topWarningPerProject(warnings: WarningItem[]): WarningItem[] {
  const top = new Map<string, WarningItem>();
  for (const w of warnings) {
    const key = w.projectPath ?? '';
    const cur = top.get(key);
    if (!cur || severityRank(w.severity) > severityRank(cur.severity)) top.set(key, w);
  }
  return [...top.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

/** Badge count = high + medium only (§11: Low never contributes to the ⚠ badge). */
export function warningBadgeCount(warnings: WarningItem[]): number {
  return warnings.filter((w) => w.severity !== 'low').length;
}

/** Highest severity present among a project's warnings (for lens coloring). */
export function topSeverityByProject(warnings: WarningItem[]): Map<string, WarningSeverity> {
  const out = new Map<string, WarningSeverity>();
  for (const w of warnings) {
    if (!w.projectPath) continue;
    const cur = out.get(w.projectPath);
    if (!cur || severityRank(w.severity) > severityRank(cur)) out.set(w.projectPath, w.severity);
  }
  return out;
}
