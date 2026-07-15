/**
 * Development logging, silent by default. Enable from the Obsidian dev
 * console with `localStorage.hypernovumDebug = '1'` (reload not required —
 * checked lazily). Warnings and errors always pass through console directly;
 * this gate is only for chatty operational logs.
 */
let cached: boolean | null = null;

function enabled(): boolean {
  if (cached !== null) return cached;
  try {
    cached = typeof localStorage !== 'undefined' && localStorage.getItem('hypernovumDebug') === '1';
  } catch {
    cached = false;
  }
  return cached;
}

/** Re-check the localStorage flag (e.g. after toggling it in the console) */
export function refreshDebugFlag(): void {
  cached = null;
}

export function debugLog(...args: unknown[]): void {
  if (enabled()) console.log('[Hypernovum]', ...args);
}
