import { execFile } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import type { WeatherData, RecentCommit } from '@hypernovum/core';

/** Parse `git log -N --format=%h%x09%ct%x09%s` (tab-separated) into commits. */
export function parseRecentCommits(raw: string | null): RecentCommit[] {
  if (!raw) return [];
  const out: RecentCommit[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [hash, ts, ...rest] = line.split('\t');
    const seconds = parseInt(ts, 10);
    if (!hash || !Number.isFinite(seconds)) continue;
    out.push({ hash, ts: seconds * 1000, subject: rest.join('\t') });
  }
  return out;
}

/**
 * Parse `git rev-list --count --left-right @{upstream}...HEAD` → "behind\tahead".
 * Returns null/null when there is no upstream (command errored → raw null).
 */
export function parseAheadBehind(raw: string | null): { ahead: number | null; behind: number | null } {
  if (!raw) return { ahead: null, behind: null };
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return { ahead: null, behind: null };
  const behind = parseInt(parts[0], 10);
  const ahead = parseInt(parts[1], 10);
  return {
    behind: Number.isFinite(behind) ? behind : null,
    ahead: Number.isFinite(ahead) ? ahead : null,
  };
}

function gitExec(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 8000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function sinceDate(days: number): string {
  return `${days} days ago`;
}

function parseCount(raw: string | null): number {
  if (!raw) return 0;
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function heatFromCommitAge(lastCommitDate: number): number {
  if (!lastCommitDate) return 0;
  const hours = (Date.now() - lastCommitDate) / 3_600_000;
  if (hours < 24) return 90;
  if (hours < 7 * 24) return 65;
  if (hours < 30 * 24) return 35;
  return 5;
}

export class GitActivityCollector {
  async collect(projectPath: string): Promise<WeatherData | null> {
    if (!existsSync(projectPath)) return null;
    if (!existsSync(path.join(projectPath, '.git'))) return null;

    const [
      branch,
      lastCommitRaw,
      commits7Raw,
      commits30Raw,
      statusRaw,
      mergeHeadRaw,
      recentCommitsRaw,
      aheadBehindRaw,
    ] = await Promise.all([
      gitExec(projectPath, ['branch', '--show-current']),
      gitExec(projectPath, ['log', '-1', '--format=%ct']),
      gitExec(projectPath, ['rev-list', '--count', `--since=${sinceDate(7)}`, 'HEAD']),
      gitExec(projectPath, ['rev-list', '--count', `--since=${sinceDate(30)}`, 'HEAD']),
      gitExec(projectPath, ['status', '--porcelain']),
      gitExec(projectPath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']),
      gitExec(projectPath, ['log', '-3', '--format=%h%x09%ct%x09%s']),
      // Errors (→ null) when there is no upstream — common for local-only repos.
      gitExec(projectPath, ['rev-list', '--count', '--left-right', '@{upstream}...HEAD']),
    ]);

    const lastCommitSeconds = parseCount(lastCommitRaw);
    const lastCommitDate = lastCommitSeconds > 0 ? lastCommitSeconds * 1000 : 0;
    const commitsLast7d = parseCount(commits7Raw);
    const commitsLast30d = parseCount(commits30Raw);
    const heat = heatFromCommitAge(lastCommitDate);
    const churn = Math.min(100, Math.max(heat, commitsLast7d * 12 + commitsLast30d * 2));
    const { ahead, behind } = parseAheadBehind(aheadBehindRaw);

    return {
      projectPath,
      commitsLast7d,
      commitsLast30d,
      lastCommitDate,
      hasUncommittedChanges: !!statusRaw,
      hasMergeConflicts: !!mergeHeadRaw,
      staleBranchCount: lastCommitDate && Date.now() - lastCommitDate > 30 * 24 * 60 * 60 * 1000 ? 1 : 0,
      churnScore: churn,
      activeBranch: branch || undefined,
      recentCommits: parseRecentCommits(recentCommitsRaw),
      ahead,
      behind,
    };
  }
}
