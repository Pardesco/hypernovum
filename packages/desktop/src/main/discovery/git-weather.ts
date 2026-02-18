import { execFile } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';

export interface GitWeather {
  projectPath: string;
  // Activity metrics
  commitsLast7d: number;
  commitsLast30d: number;
  lastCommitDate: number;       // timestamp ms
  activeBranch: string;
  // Health signals
  hasUncommittedChanges: boolean;
  hasMergeConflicts: boolean;   // .git/MERGE_HEAD exists
  staleBranchCount: number;     // branches with no commits in 60+ days
  // Hotspot detection
  hotFiles: { path: string; commits: number }[];  // files with 5+ commits in 7d
  churnScore: number;           // 0-100 based on commit frequency
}

/**
 * Run a git command in a project directory and return stdout.
 * Returns null if the command fails.
 */
function gitExec(projectDir: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: projectDir, timeout: 10000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Collect git weather data for a single project.
 * Returns null if the directory is not a git repo.
 */
export async function collectWeather(projectDir: string): Promise<GitWeather | null> {
  // Quick check: is this a git repo?
  if (!existsSync(path.join(projectDir, '.git'))) {
    return null;
  }

  // Run git commands in parallel
  const [
    commits7dStr,
    commits30dStr,
    lastCommitStr,
    activeBranch,
    statusOutput,
    branchOutput,
    hotFilesOutput,
  ] = await Promise.all([
    gitExec(projectDir, ['rev-list', '--count', '--since=7 days ago', 'HEAD']),
    gitExec(projectDir, ['rev-list', '--count', '--since=30 days ago', 'HEAD']),
    gitExec(projectDir, ['log', '-1', '--format=%at']),
    gitExec(projectDir, ['branch', '--show-current']),
    gitExec(projectDir, ['status', '--porcelain']),
    gitExec(projectDir, ['branch', '--format=%(refname:short) %(committerdate:unix)']),
    gitExec(projectDir, ['log', '--since=7 days ago', '--name-only', '--format=']),
  ]);

  const commitsLast7d = parseInt(commits7dStr || '0', 10) || 0;
  const commitsLast30d = parseInt(commits30dStr || '0', 10) || 0;
  const lastCommitDate = lastCommitStr ? parseInt(lastCommitStr, 10) * 1000 : 0;

  // Merge conflicts check
  const hasMergeConflicts = existsSync(path.join(projectDir, '.git', 'MERGE_HEAD'));

  // Stale branches: no commits in 60+ days
  const staleCutoff = Math.floor(Date.now() / 1000) - (60 * 24 * 60 * 60);
  let staleBranchCount = 0;
  if (branchOutput) {
    const lines = branchOutput.split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.trim().split(' ');
      if (parts.length >= 2) {
        const timestamp = parseInt(parts[parts.length - 1], 10);
        if (timestamp && timestamp < staleCutoff) {
          staleBranchCount++;
        }
      }
    }
  }

  // Hot files: count file appearances in recent commits
  const fileCounts = new Map<string, number>();
  if (hotFilesOutput) {
    const lines = hotFilesOutput.split('\n').filter(Boolean);
    for (const file of lines) {
      const trimmed = file.trim();
      if (trimmed) {
        fileCounts.set(trimmed, (fileCounts.get(trimmed) || 0) + 1);
      }
    }
  }

  const hotFiles = Array.from(fileCounts.entries())
    .filter(([, count]) => count >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([filePath, commits]) => ({ path: filePath, commits }));

  // Churn score: 0-100 based on commits in last 7 days
  // 0 commits = 0, 1-2 = 20, 3-5 = 40, 6-10 = 60, 11-20 = 80, 21+ = 100
  let churnScore: number;
  if (commitsLast7d === 0) churnScore = 0;
  else if (commitsLast7d <= 2) churnScore = 20;
  else if (commitsLast7d <= 5) churnScore = 40;
  else if (commitsLast7d <= 10) churnScore = 60;
  else if (commitsLast7d <= 20) churnScore = 80;
  else churnScore = 100;

  return {
    projectPath: projectDir,
    commitsLast7d,
    commitsLast30d,
    lastCommitDate,
    activeBranch: activeBranch || 'HEAD',
    hasUncommittedChanges: (statusOutput || '').length > 0,
    hasMergeConflicts,
    staleBranchCount,
    hotFiles,
    churnScore,
  };
}

export type WeatherUpdateHandler = (weather: GitWeather) => void;

/**
 * Polls git weather for a list of project paths on an interval.
 */
export class GitWeatherCollector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private handlers: WeatherUpdateHandler[] = [];

  on(event: 'weather-update', handler: WeatherUpdateHandler): void {
    if (event === 'weather-update') {
      this.handlers.push(handler);
    }
  }

  off(event: 'weather-update', handler: WeatherUpdateHandler): void {
    if (event === 'weather-update') {
      this.handlers = this.handlers.filter(h => h !== handler);
    }
  }

  /**
   * Collect weather for a single project.
   */
  async collect(projectDir: string): Promise<GitWeather | null> {
    return collectWeather(projectDir);
  }

  /**
   * Start polling all projects on an interval.
   */
  startPolling(projectDirs: string[], intervalMs: number = 30000): void {
    this.stopPolling();

    const poll = async () => {
      for (const dir of projectDirs) {
        const weather = await collectWeather(dir);
        if (weather) {
          for (const handler of this.handlers) {
            handler(weather);
          }
        }
      }
    };

    // Initial poll
    poll();

    this.timer = setInterval(poll, intervalMs);
  }

  /**
   * Stop polling.
   */
  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
