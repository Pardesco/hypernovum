import { execFile } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import type { WeatherData } from '@hypernovum/core';

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
    ] = await Promise.all([
      gitExec(projectPath, ['branch', '--show-current']),
      gitExec(projectPath, ['log', '-1', '--format=%ct']),
      gitExec(projectPath, ['rev-list', '--count', `--since=${sinceDate(7)}`, 'HEAD']),
      gitExec(projectPath, ['rev-list', '--count', `--since=${sinceDate(30)}`, 'HEAD']),
      gitExec(projectPath, ['status', '--porcelain']),
      gitExec(projectPath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']),
    ]);

    const lastCommitSeconds = parseCount(lastCommitRaw);
    const lastCommitDate = lastCommitSeconds > 0 ? lastCommitSeconds * 1000 : 0;
    const commitsLast7d = parseCount(commits7Raw);
    const commitsLast30d = parseCount(commits30Raw);
    const heat = heatFromCommitAge(lastCommitDate);
    const churn = Math.min(100, Math.max(heat, commitsLast7d * 12 + commitsLast30d * 2));

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
    };
  }
}
