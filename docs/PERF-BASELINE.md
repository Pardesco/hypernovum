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

Enable timings in the browser console: `localStorage.hypernovumDebug = '1'`, reload.

## Scenarios

- **S25** — 25 projects, 5 categories
- **M100** — 100 projects, 10 categories, ~backlinks
- **L250** — 250 projects, dense edges, 4 synthetic agents at 1 Hz

## Targets (from §13) — fill in observed

| Operation | Target | S25 | M100 | L250 |
|-----------|--------|-----|------|------|
| Search keystroke → refresh | ≤1 per 200ms pause, <50ms @ M100 | | | |
| Lens/filter switch | <50ms @ M100, <150ms @ L250, zero geometry disposal | | | |
| Hover update | <2ms, zero allocation | | | |
| Focus/selection change | <10ms @ L250 | | | |
| Label visibility tick (4Hz) | <1ms @ L250 | | | |
| Heartbeat poll | ≤33 file reads / 500ms @ 32-session cap | | | |
| Dependency scan | <300ms cold, <20ms warm | | | |
| Edge rebuild | <80ms @ 250 edges | | | |
| City init (rebuildCity) | ≤ baseline +10% (classic) | | | |
| TowerLoft generation | <150ms @ L250 cold | | | |
| Steady-state FPS (bloom on) | ≥50 @ M100, ≥30 @ L250 | | | |

## Hardware

> Record: CPU / GPU / OS / Obsidian version.

## Notes

- **PERF-002** (incremental visibility) is on `feat/incremental-visibility`, not yet
  merged — with it, lens/filter/search should hit the "zero geometry disposal"
  targets. Without it (current master), those switches do a full rebuild.
