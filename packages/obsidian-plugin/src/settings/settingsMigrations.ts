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

/** Layout generations (LAY-001): 1 = one category per row (0.x), 2 = shelf packing. */
export type LayoutVersion = 1 | 2;
export const CURRENT_LAYOUT_VERSION: LayoutVersion = 2;

/**
 * Which layout a stored config should use (LAY-001).
 *
 * Saved block positions are OFFSETS from the default layout's positions, so a
 * new default would move every saved layout. A config with real (non-zero)
 * saved offsets and no recorded version keeps the 0.x packer and renders
 * exactly as before; everyone else, and every new install, gets the shelf
 * layout. "Reset city layout" moves a legacy config over explicitly.
 */
export function layoutVersionFor(stored: { layoutVersion?: unknown; blockPositions?: unknown } | null): LayoutVersion {
  if (stored?.layoutVersion === 1 || stored?.layoutVersion === 2) return stored.layoutVersion;
  const positions = Array.isArray(stored?.blockPositions) ? (stored.blockPositions as unknown[]) : [];
  const customised = positions.some((p) => {
    const o = p as { offsetX?: unknown; offsetZ?: unknown } | null;
    return !!o && ((typeof o.offsetX === 'number' && o.offsetX !== 0) || (typeof o.offsetZ === 'number' && o.offsetZ !== 0));
  });
  return customised ? 1 : CURRENT_LAYOUT_VERSION;
}
