/**
 * Development logging, silent by default. Hosts can opt in explicitly with
 * `setDebugLogging(true)`. This avoids browser-global persistence leaking a
 * debug preference across vaults while keeping core platform-agnostic.
 */
let debugEnabled = false;
let debugSink: ((...args: unknown[]) => void) | null = null;

/** Enable or disable chatty operational logs for the current host session. */
export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

/** Supply a host-owned debug sink; core never writes to the console directly. */
export function setDebugSink(sink: ((...args: unknown[]) => void) | null): void {
  debugSink = sink;
}

export function debugLog(...args: unknown[]): void {
  if (debugEnabled) debugSink?.('[Hypernovum]', ...args);
}
