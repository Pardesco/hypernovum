/**
 * Rolling frame-time window (pure, no DOM/three). Feeds the performance
 * overlay and the Auto graphics-quality probe (GFX-009).
 */
export class FrameStats {
  private samples: number[] = [];

  constructor(private readonly capacity = 120) {}

  /** Add one sample (ms). Non-finite or negative values are ignored. */
  push(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.push(ms);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  get count(): number {
    return this.samples.length;
  }

  /** Value at quantile q (0–1) of the current window, or 0 when empty. */
  quantile(q: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
    return sorted[i];
  }

  median(): number {
    return this.quantile(0.5);
  }

  clear(): void {
    this.samples = [];
  }
}

/** What the performance overlay shows (and what a host or QA script can read). */
export interface PerfSnapshot {
  /** Median interval between rendered frames (ms). */
  frameMs: number;
  /** 90th-percentile frame interval (ms). */
  frameP90Ms: number;
  /** Median main-thread time spent in one animate() call, render submit included (ms). */
  cpuMs: number;
  fps: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  /** Active graphics tier, when the host uses tiers. */
  tier: string | null;
}

/** One-line-per-metric overlay text. */
export function formatPerfSnapshot(s: PerfSnapshot): string[] {
  const lines = [
    `${s.fps.toFixed(0)} fps · frame ${s.frameMs.toFixed(1)} ms (p90 ${s.frameP90Ms.toFixed(1)})`,
    `cpu ${s.cpuMs.toFixed(2)} ms · ${s.drawCalls} draws · ${formatCount(s.triangles)} tris`,
    `pixel ratio ${s.pixelRatio.toFixed(2)}${s.tier ? ` · ${s.tier}` : ''}`,
  ];
  return lines;
}

function formatCount(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : String(n);
}
