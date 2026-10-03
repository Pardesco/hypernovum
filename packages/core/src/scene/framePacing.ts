/**
 * Idle and background frame pacing (GFX-008). Pure, so the policy is tested.
 *
 * Obsidian stays open all day, and the city used to render at full display
 * rate the whole time it was on screen. Now: full rate while the user is
 * interacting (and briefly after), ~30 fps once the city has been left alone,
 * and ~5 fps — enough for orbs and pulses to stay alive — while Obsidian
 * itself is in the background.
 */

/** No input for this long (ms) and the city drops to the idle rate. */
export const IDLE_AFTER_MS = 5000;
/** Minimum interval between rendered frames when idle (~30 fps). */
export const IDLE_FRAME_MS = 1000 / 30;
/** Minimum interval when the Obsidian window is unfocused (~5 fps). */
export const BACKGROUND_FRAME_MS = 1000 / 5;

export interface PacingInput {
  now: number;
  /** Last pointer/wheel/key input on the city, or camera motion (ms timestamp). */
  lastActivityAt: number;
  /** The Obsidian window has focus. */
  focused: boolean;
  /** Something needs every frame (the Auto quality probe measuring frame times). */
  needsFullRate: boolean;
}

/** Minimum ms between rendered frames right now; 0 = render every display frame. */
export function minFrameInterval(i: PacingInput): number {
  if (i.needsFullRate) return 0;
  if (!i.focused) return BACKGROUND_FRAME_MS;
  if (i.now - i.lastActivityAt > IDLE_AFTER_MS) return IDLE_FRAME_MS;
  return 0;
}

/**
 * Whether to render this display frame. The 2 ms slack keeps a 30 fps target
 * from landing on every third 60 Hz frame (20 fps) because of rAF jitter.
 */
export function shouldRenderFrame(now: number, lastRenderAt: number, minInterval: number): boolean {
  return minInterval <= 0 || now - lastRenderAt >= minInterval - 2;
}
