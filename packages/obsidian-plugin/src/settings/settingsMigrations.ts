/**
 * Pure, obsidian-free settings migrations, so they can be unit-tested.
 * `HypernovumPlugin.loadSettings()` applies them once per load.
 */

/**
 * Display names a release shipped for a preset agent, keyed by the agent's
 * command — the command is the stored identity; the name is display only.
 */
const RENAMED_AGENTS: Record<string, Record<string, string>> = {
  // TXT-001 (0.6.1): OpenAI's tool is the Codex CLI; sessions already say "Codex".
  codex: { 'GPT Codex': 'Codex CLI' },
};

/**
 * The current display name for a persisted preset agent, or null when the
 * stored name needs no change. Custom names (and custom commands) are never
 * touched — only an exact, previously shipped preset name is replaced.
 */
export function migrateAgentName(command: string, name: string): string | null {
  return RENAMED_AGENTS[command]?.[name] ?? null;
}
