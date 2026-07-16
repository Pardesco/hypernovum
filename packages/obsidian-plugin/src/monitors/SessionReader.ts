import { existsSync, readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { parseSessionLines, parseSessionDigest, type SessionDigest } from './sessionDigest';

/**
 * Reads session JSONL logs on demand (SES-002). Lazy — only called when the
 * inspector opens a project, so scanning the sessions dir is cheap enough.
 */
export class SessionReader {
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
        const events = parseSessionLines(readFileSync(path.join(sessionsDir, name), 'utf8'));
        const digest = parseSessionDigest(events);
        if (!digest || !matches(digest.project)) continue;
        if (!best || digest.endT > best.endT) best = digest;
      } catch { /* skip unreadable log */ }
    }
    return best;
  }
}
