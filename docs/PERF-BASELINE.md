# Performance Baseline (HRD-001 / §13)

Record numbers from a **live run** — the tooling here only builds the fixtures.

## How to run

```bash
# 1. Generate a synthetic vault (25 / 100 / 250 projects)
node scripts/gen-test-vault.mjs --out ./perf-vault --count 100
#    → drop perf-vault into an Obsidian vault, open the Hypernovum city

# 2. (fleet scenario) drive 4 concurrent agents at 1 Hz for 60s
node scripts/spawn-agents.mjs --vault "C:/path/to/Vault" --agents 4 --duration 60
```

Live numbers: run the command **Hypernovum: Toggle performance overlay**. It shows
fps, the median / p90 frame interval, main-thread time per frame, draw calls and
triangles for the whole frame (shadow pass and every post pass included), the
pixel ratio and the graphics tier.

Comparable GPU cost (what the tables below use): pause the loop and time synced
renders from the developer console, with the city open and settled for ~6 s.

```js
const sm = app.workspace.getLeavesOfType('hypernovum-view')[0].view.sceneManager;
const r = sm.renderer, gl = r.getContext(), px = new Uint8Array(4), ts = [];
sm.setRenderingEnabled(false);
const prev = r.info.autoReset; r.info.autoReset = false;
for (let i = 0; i < 90; i++) {
  r.info.reset();
  const t0 = performance.now();
  if (sm.renderFrame) sm.renderFrame(); else if (sm.composer) sm.composer.render(); else r.render(sm.scene, sm.camera);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // waits for the GPU
  ts.push(performance.now() - t0);
}
r.info.autoReset = prev; sm.setRenderingEnabled(true);
ts.sort((a, b) => a - b);
({ medianMs: ts[45], calls: r.info.render.calls, triangles: r.info.render.triangles });
```

The `readPixels` makes each sample wait for the GPU, so this is the real cost of a
frame, not the vsync-capped rAF interval.

## Scenarios

- **S25** — 25 projects (the generator spreads them over 10 categories)
- **M100** — 100 projects, 10 categories, ~backlinks
- **L250** — 250 projects, dense edges, 4 synthetic agents at 1 Hz (the 0.7 pass
  below ran L250 without the synthetic agents)

## Targets (from §13) — fill in observed

Observed on the 0.7 dev build (`feat/next-pass-0.7`) unless marked; blank = not
measured in that pass.

| Operation | Target | S25 | M100 | L250 |
|-----------|--------|-----|------|------|
| Search keystroke → refresh | ≤1 per 200ms pause, <50ms @ M100 | | | |
| Lens/filter switch | <50ms @ M100, <150ms @ L250, zero geometry disposal | | | |
| Hover update | <2ms, zero allocation | | | |
| Focus/selection change | <10ms @ L250 | | | |
| Label visibility tick (4Hz) | <1ms @ L250 | | | 0.2 ms median, 0.4 ms p90 (with the LBL-001 collision pass) |
| Heartbeat poll | ≤33 file reads / 500ms @ 32-session cap | | | |
| Dependency scan | <300ms cold, <20ms warm | | | |
| Edge rebuild | <80ms @ 250 edges | | | |
| City init (rebuildCity) | ≤ baseline +10% (classic) | | | |
| TowerLoft generation | <150ms @ L250 cold | | | |
| Steady-state FPS (bloom on) | ≥50 @ M100, ≥30 @ L250 | 143 (display-capped) | 143 (display-capped) | 143 (display-capped) |

## Graphics pass before/after (0.6.0 vs 0.7 dev, 2026-10-03)

Same machine, same Obsidian session for each 0.6.0 / dev pair, isolated profile,
1864×990 canvas (1920×1080 window). "1x"/"2x" = device scale factor. GPU-synced
frame ms from the snippet above (median of 80); draw calls and triangles for a whole
frame. The dev build defaults to the **Auto** tier, which picks **High** on this
machine (pixel ratio capped at 1.5, so "Auto 2x" renders 2796×1485); **Ultra** 2x is
the same resolution as 0.6.0 2x.

| Scenario | Build / tier | Frame ms 1x | Frame ms 2x | Draw calls | Triangles |
|---|---|---|---|---|---|
| S25 | 0.6.0 | 1.5–2.6 | 1.7–2.0 | 287 | 16.4k |
| S25 | dev Auto (High) | 1.6–1.7 | 2.1–2.2 | 248 | 20.8k |
| S25 | dev Ultra | — | 2.6–3.0 | 248 | 20.8k |
| S25 | dev Low | 1.4 | — | 233 | 9.2k |
| M100 | 0.6.0 | 3.2–3.8 | 3.1 | 801 | 62.3k |
| M100 | dev Auto (High) | 2.8–2.9 | 3.3–4.2 | 634 | 81.0k |
| M100 | dev Ultra | — | 3.7–3.9 | 634 | 81.0k |
| M100 | dev Low | 2.0–2.2 | — | 619 | 34.0k |
| L250 | 0.6.0 | 5.0 | 5.4 | 1540 | 116.5k |
| L250 | dev Auto (High) | 4.6 | 5.4 | 1140 | 147.7k |
| L250 | dev Ultra | — | 5.4 | 1140 | 147.7k |
| L250 | dev Low | 4.0 | — | 1125 | 50.7k |

Ranges are the spread across repeated paired runs: at 1–5 ms the GPU's boost
state moves single runs by ±0.5 ms, so compare within a row pair, not across
sessions.

Main-thread time per frame on the dev build (perf overlay): S25 ~1.2 ms, M100
~2.6 ms, L250 ~5.0 ms (High); Low saves ~0.3 ms.

What moved the numbers:

- **Draw calls −14 to −26%**: the shadow map is no longer re-rendered every
  frame (GFX-007: one extra draw per caster), and graph arcs are one mesh per edge
  type (GFX-010). Per building there are still ~5 draws (tower, edge glow, roof
  detail, foundation, foundation wireframe) — batching those is the remaining
  draw-call work (see the plan doc).
- **Frame cost at 1x equal or lower** despite adding 4x MSAA to the bloom path
  (GFX-001): the static shadow map pays for it.
- **At 2x on Ultra, +0–75% GPU** versus 0.6.0 (most in small cities, where the
  fixed MSAA and post-pass cost dominates; L250 is level), because 0.6.0 rendered
  its bloom path without any antialiasing. Auto/High caps the pixel ratio at 1.5.
- **Triangles up on High**: wide antialiased lines (GFX-004) are drawn as
  quads. Low keeps 1 px lines (−44 to −56% triangles vs 0.6.0).
- **Idle pacing (GFX-008)** is the biggest real-world saving: after 5 s without
  input the city renders at ~30 fps instead of display rate (measured 29 fps vs
  143 fps active on a ~144 Hz display), and ~5 fps while Obsidian is unfocused.

The rAF interval was display-bound for every build and scenario here (7 ms on a
~144 Hz panel), so steady-state FPS is the display rate everywhere.

## Hardware

- **0.7 graphics pass (2026-10-03):** Intel Core i7-14700K, NVIDIA RTX 5070 Ti,
  Windows 11, Obsidian 1.13.7 (isolated profile, demo harness
  `demo-videos/obsidian-showcase-2026-10`).

## Notes

- **PERF-002** (incremental visibility) is on `feat/incremental-visibility`, not yet
  merged — with it, lens/filter/search should hit the "zero geometry disposal"
  targets. Without it (current master), those switches do a full rebuild.
- The old note to set `localStorage.hypernovumDebug` never matched any code; use the
  performance overlay command above.
