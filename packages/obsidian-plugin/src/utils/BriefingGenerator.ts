import { moment, type App } from 'obsidian';
import type { ProjectData } from '@hypernovum/core';

/**
 * Generate a daily briefing note from the current project data: status
 * counts, projects needing attention, the open quest board, and Git heat.
 * Pure data digest — no AI involved; agents (or the user) act on it.
 * Returns the vault path of the written note.
 */
export async function generateDailyBriefing(app: App, projects: ProjectData[]): Promise<string> {
  const date = moment().format('YYYY-MM-DD');
  const notePath = `Hypernovum Briefing ${date}.md`;

  const byStatus = (status: string) => projects.filter((p) => p.status === status);
  const stale = projects
    .filter((p) => p.status !== 'complete' && Date.now() - p.lastModified > 30 * 86400000)
    .sort((a, b) => a.lastModified - b.lastModified);
  const quested = projects.filter((p) => p.questions && p.questions.length > 0);
  const questTotal = quested.reduce((sum, p) => sum + (p.questions?.length ?? 0), 0);
  const hot = projects
    .filter((p) => (p.gitActivity?.commitsLast7d ?? 0) > 0)
    .sort((a, b) => (b.gitActivity?.commitsLast7d ?? 0) - (a.gitActivity?.commitsLast7d ?? 0))
    .slice(0, 5);

  const link = (p: ProjectData) => `[[${p.path.replace(/\.md$/, '')}|${p.title}]]`;
  const daysAgo = (ms: number) => Math.floor((Date.now() - ms) / 86400000);

  const lines: string[] = [
    `# Hypernovum Briefing — ${date}`,
    '',
    `> Generated from ${projects.length} project notes. Regenerate anytime: command palette → "Generate daily briefing".`,
    '',
    '## Status',
    '',
    `- **Active:** ${byStatus('active').length}`,
    `- **Blocked:** ${byStatus('blocked').length}${byStatus('blocked').length ? ' — ' + byStatus('blocked').map(link).join(', ') : ''}`,
    `- **Paused:** ${byStatus('paused').length}`,
    `- **Complete:** ${byStatus('complete').length}`,
    '',
    '## Needs attention',
    '',
  ];

  if (stale.length === 0 && byStatus('blocked').length === 0) {
    lines.push('Nothing stale or blocked. The city is healthy.');
  } else {
    for (const p of byStatus('blocked')) {
      lines.push(`- 🟥 ${link(p)} is **blocked**`);
    }
    for (const p of stale.slice(0, 8)) {
      lines.push(`- 🕸️ ${link(p)} untouched for ${daysAgo(p.lastModified)} days`);
    }
    if (stale.length > 8) lines.push(`- …and ${stale.length - 8} more stale projects`);
  }

  lines.push('', `## Quest board (${questTotal} open)`, '');
  if (questTotal === 0) {
    lines.push('No open research quests. Post one by adding a `questions:` list to a project note.');
  } else {
    for (const p of quested) {
      for (const q of p.questions ?? []) {
        lines.push(`- ◆ ${link(p)}: ${q}`);
      }
    }
  }

  lines.push('', '## Git heat (7 days)', '');
  if (hot.length === 0) {
    lines.push('No commit activity detected in the last 7 days.');
  } else {
    for (const p of hot) {
      lines.push(`- 🔥 ${link(p)} — ${p.gitActivity?.commitsLast7d} commits (branch \`${p.gitActivity?.activeBranch ?? '?'}\`)`);
    }
  }

  lines.push('');
  await app.vault.adapter.write(notePath, lines.join('\n'));
  return notePath;
}
