import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';
import { parseSessionLines, parseSessionDigest, type SessionDigest } from './sessionDigest';

/**
 * Reads session JSONL logs on demand (SES-002). Lazy — only called when the
 * inspector opens a project, so scanning the sessions dir is cheap enough.
 */
export class SessionReader {
  private cache = new Map<string, { size: number; mtime: number; digest: SessionDigest | null }>();
  /** Most recent session digest whose events reference the project, or null. */
  readLatestForProject(
    sessionsDir: string,
    matches: (project: string | undefined) => boolean,
  ): SessionDigest | null {
    if (!existsSync(sessionsDir)) return null;
    let files: string[];
    try {
      files = readdirSync(sessionsDir);
    } catch {
      return null;
    }

    let best: SessionDigest | null = null;
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      try {
        const file = path.join(sessionsDir, name);
        const stat = statSync(file);
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
        const cached = this.cache.get(file);
        const digest = cached && cached.size === stat.size && cached.mtime === stat.mtimeMs
          ? cached.digest : parseSessionDigest(parseSessionLines(readFileSync(file, 'utf8')));
        this.cache.set(file, { size: stat.size, mtime: stat.mtimeMs, digest });
        if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
        if (!digest || !matches(digest.project)) continue;
        if (!best || digest.endT > best.endT) best = digest;
      } catch { /* skip unreadable log */ }
    }
    return best;
  }
}
