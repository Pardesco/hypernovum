# Hypernovum — Agent Ops for Your Second Brain

A **3D IDE and agent-ops dashboard** for [Obsidian](https://obsidian.md), built on **Three.js**. Hypernovum turns your vault — your **second brain** — into a living cyberpunk code city: visualize projects and their backlinks in 3D, dispatch **AI coding agents** (Claude Code, GPT Codex, Antigravity CLI) with full vault context, post research quests for agents to resolve, and watch your entire fleet work in real time.

Each project note becomes a building. Status maps to color, priority to height, category to district, vault backlinks to glowing **Neural Link** arcs. A central **Neural Core** pulses with activity as you work, **Data Arteries** flow to buildings when files change, and every active agent orbits its building as a colored orb.

![Hypernovum Obsidian Plugin](site/assets/obsidian-app.png)

## Features

### City Visualization
- **Bin-packed layout** with category districts, block outlines, and drag handles for rearranging
- **Procedural architecture** — each category gets a unique silhouette (helix towers, data shards, ziggurats, quant blades, hex hives, memory cores)
- **Cyberpunk shader system** with procedural windows, decay dithering, and bloom post-processing
- **Smart labels** with CSS2D rendering and leader lines
- **Hover tooltips** showing status, priority, health, and tech stack

### Second Brain & Agent Ops
- **Prepare vault for AI agents** — one click writes a marker-fenced `AGENTS.md` at the vault root: project schema, live inventory, quest board, skills roster, and heartbeat protocol, so any CLI agent instantly understands your second brain
- **Quest board**: a `questions:` list in project frontmatter renders as a floating gold quest marker over the building, shows in the inspector and tooltip, and is published to agents via AGENTS.md — resolving a quest (move it to `answered:`) fires an emerald shockwave at the building
- **Abilities roster**: agent skills (`SKILL.md` files in vault or `~/.claude/skills/`) listed in the agents panel — click to copy an invocation
- **Neural Links**: toggle vault backlinks between projects as pulsing violet knowledge arcs — your knowledge graph as city infrastructure
- **Agent fleet presence**: every v2 heartbeat session gets its own state-colored orb with an identity tooltip (name/state/action/file); two agents touching the same file surface a deterministic conflict ring and inspector row
- **Daily briefing**: one command writes a digest note — status counts, blocked/stale attention list, quest board, git heat

### Interactions
- **Single-click** a building to **select + focus** it — the city dims around your selection and connected neighbors stay lit; the camera doesn't move. **Double-click** opens the note. *(This changed in 0.4 — click no longer opens; a one-time hint appears.)*
- **Esc** or a click on empty ground clears the selection; **Move building** is a right-click menu item.
- **Right-click** menu: Launch agent · Inspect · Move building · **Trace impact** · Open folder · Open terminal · Copy path · Add quest · Open note · Focus camera.
- **Search and filters** narrow the city by title, status, priority, category, path, or stack — filtered-out buildings hide in place (no re-shuffling).
- **Scan lenses** (dropdown): status, **Needs Attention** (triage), Git activity, memory-ready, task-progress ramp, recency heatmap, tech-stack — with an adaptive legend. A **⚠ badge** jumps to the attention lens.
- **Saved lens presets**: three defaults (Active Work / Needs Attention / Agents) plus "Save current view".
- **EDGES chips** toggle the typed project graph: Backlinks · Deps · Blocked · Agents.
- **Project inspector**: git signals + recent commits, warnings, dependency sections (Depends on / Used by / Blocked by / Blocks), agent activity, and a last-session digest. **City overview** (nothing selected) shows district analytics, a fleet summary, an attention list, and a recent-activity feed.
- **Building style** (settings): Classic silhouettes or **Parametric** data-true towers (opt-in, applies live).
- **Snapshot**: one click saves a clean cinematic PNG (title card, no HUD) into your vault.
- **Drag handles** rearrange category blocks; **scroll** to zoom, **right-drag** to pan; **keyboard** cycles blocked/stale projects + resets camera.

### Neural Core & Data Arteries
- Central **geodesic wireframe sphere** with RGB chromatic split and rotating rings
- **Data Arteries** — animated tube geometry flowing from core to buildings on file changes
- **City states**: IDLE (cyan) / STREAMING (cyan fast) / BULK_UPDATE (gold)

### Claude Code Integration
- **Activity Monitor** polls `.hypernovum/agents/` (v2 per-session snapshots) plus the legacy `.hypernovum-status.json` for real-time agent status
- **Persistent streaming artery** while Claude is actively working on a project
- **Activity indicator overlay** shows current project and action
- **Terminal Launcher** for launching Claude Code, GPT Codex, Antigravity CLI, or a custom agent command
- **Agent context handoff** writes `.hypernovum/SETUP.md` with project metadata, Git signals, and memory context pointers before launch
- **Heartbeat script** (`scripts/heartbeat.js`) for Claude Code hooks integration

### Git & Memory Signals
- **Read-only Git activity layer** shows recent commit velocity, branch, working-tree state, stale projects, and merge conflict signals
- **Memory-ready filter** finds projects that already have `.hypernovum/MEMORY_CONTEXT.md`
- **Funding metadata** is included for users who want to support the free plugin

### HUD
- **HYPERNOVUM** neon title with flashing block cursor at top center
- **Adaptive SCAN-MODE legend** that re-renders per visual layer (status chips, gradient ramps, live stack roster)
- **Controls hint** overlay with all mouse and keyboard shortcuts
- **Save Layout** and **Snapshot** buttons

## Platform Support

| Platform | Terminal Emulators | Notes |
|----------|-------------------|-------|
| **Windows** | Windows Terminal, cmd.exe | Tries `wt` first, falls back to `cmd` |
| **macOS** | iTerm2, Terminal.app | Tries iTerm2 first (if running), falls back to Terminal.app |
| **Linux** | gnome-terminal, konsole, xfce4-terminal, xterm | Tries each in order until one succeeds |

All features — Neural Core, Data Arteries, Claude Code integration, context menus — work identically on every platform. The only difference is which terminal emulator opens.

## Frontmatter Schema

Projects are detected by frontmatter tag `project` or field `type: project`. See [SCHEMA.md](SCHEMA.md) for the full field reference.

```yaml
---
tags: [project]
title: My Project
status: active
priority: high
category: web-apps
stack: [TypeScript, React, Vite]
questions:            # optional research quests for AI agents
  - "Which vector DB fits this workload?"
projectDir: C:\Users\me\projects\my-project   # Windows
# projectDir: /Users/me/projects/my-project   # macOS
# projectDir: /home/me/projects/my-project    # Linux
---
```

## AI Integration

Hypernovum has **no built-in AI**. External AI tools (Claude Code, etc.) read `SCHEMA.md` to learn the frontmatter format, scan your project directories, and write frontmatter to vault notes. Hypernovum renders the result.

**Prepare vault for AI agents** (command palette, settings, or the agents panel) writes an `AGENTS.md` at the vault root containing the frontmatter schema, a live inventory of your projects, and instructions for making agent activity visible in the city — so any CLI agent launched in the vault immediately understands your second brain. Safe to re-run: only the marked Hypernovum section is regenerated; the rest of an existing `AGENTS.md` is preserved.

The `scripts/heartbeat.js` script wires into Claude Code hooks to render each agent
session as a named, stateful orb. **Heartbeat v2** gives every session its own
snapshot file (`.hypernovum/agents/<sessionId>.json`), so any number of agents run
concurrently without clobbering each other:

```bash
# per ping (pass --id so every ping updates the same orb)
node scripts/heartbeat.js --vault="/path/to/MyVault" --id="$CLAUDE_SESSION_ID" \
  --name="Claude Code" --agent-type=claude --project="my-project" \
  --state=editing --tool=Edit --file=src/x.ts

# on finish
node scripts/heartbeat.js --vault="/path/to/MyVault" --id="$CLAUDE_SESSION_ID" --stop
```

The orb is colored by `--state` (working / waiting / blocked / complete / stale),
carries an identity tooltip, and — when two sessions send overlapping `--file`
values on one project — surfaces a deterministic conflict in the city. The
`--vault` flag must point to your actual vault folder regardless of platform. See
the `AGENTS.md` / per-project `.hypernovum/SETUP.md` that Hypernovum generates for
ready-to-paste hook JSON.

> **Legacy:** the older single-file `.hypernovum-status.json` is still read for one
> release, so existing hooks keep working (as an anonymous agent). v2 adds
> identity, lifecycle state, and conflict detection.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

Built with [Three.js](https://threejs.org/), [Zustand](https://github.com/pmndrs/zustand), and the [Obsidian Plugin API](https://docs.obsidian.md/).

## Hypernovum Pro

This Obsidian plugin remains free and open source. For a standalone desktop experience beyond Obsidian — featuring full Engram Persistent Agent Memory, AI agent management, MCP server integration, Tandem Terminal, broader project scanning, and more — check out [Hypernovum Pro](https://studio.pardesco.com/hypernovum).

![Hypernovum Pro](site/assets/hypernovum-pro.gif)

![Hypernovum Pro Dashboard](site/assets/pro-app2.png)

## License

[AGPL-3.0](LICENSE) — Free to use, modify, and distribute. Any modified version that is deployed must also be open-sourced under AGPL-3.0.

---

*Keywords: agent ops, second brain, 3D IDE, Three.js IDE, Obsidian plugin, AI agents, Claude Code, agentic coding, code city, knowledge graph visualization, project dashboard, PKM, developer tools*
