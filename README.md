# Hypernovum

A 3D project dashboard for [Obsidian](https://obsidian.md). Visualize notes as a code city, track Git activity, inspect project status, and launch AI coding agents from your vault.

Each project in your vault becomes a building. Status maps to color, priority to height, category to district. A central **Neural Core** pulses with activity as you work, and **Data Arteries** flow from the core to buildings when files change.

![Hypernovum Obsidian Plugin](site/assets/obsidian-app.png)

## Features

### City Visualization
- **Bin-packed layout** with category districts, block outlines, and drag handles for rearranging
- **Procedural architecture** — each category gets a unique silhouette (helix towers, data shards, ziggurats, quant blades, hex hives, memory cores)
- **Cyberpunk shader system** with procedural windows, decay dithering, and bloom post-processing
- **Smart labels** with CSS2D rendering and leader lines
- **Hover tooltips** showing status, priority, health, and tech stack

### Interactions
- **Search and filters** for quickly narrowing the city by title, status, priority, category, path, or stack
- **Visual layers** for status, read-only Git activity, and memory-ready projects
- **Project inspector** with note/folder/agent/context/focus actions
- **Click** a building to open its note
- **Right-click** a building for context menu (Launch Agent, Inspect Project, Open in Explorer, Open Note, Focus Camera)
- **Right-click** the Neural Core orb to launch Claude Code in any folder via OS folder picker
- **Double-click** a building to enter move mode (reposition individual buildings)
- **Drag handles** to rearrange entire category blocks
- **Scroll** to zoom, **right-drag** to pan
- **Keyboard shortcuts**: cycle blocked/stale projects, reset camera

### Neural Core & Data Arteries
- Central **geodesic wireframe sphere** with RGB chromatic split and rotating rings
- **Data Arteries** — animated tube geometry flowing from core to buildings on file changes
- **City states**: IDLE (cyan) / STREAMING (cyan fast) / BULK_UPDATE (gold)

### Claude Code Integration
- **Activity Monitor** polls `.hypernovum-status.json` for real-time Claude Code status
- **Persistent streaming artery** while Claude is actively working on a project
- **Activity indicator overlay** shows current project and action
- **Terminal Launcher** for launching Claude Code, Codex, Gemini CLI, Aider, or a custom agent command
- **Agent context handoff** writes `.hypernovum/SETUP.md` with project metadata, Git signals, and memory context pointers before launch
- **Heartbeat script** (`scripts/heartbeat.js`) for Claude Code hooks integration

### Git & Memory Signals
- **Read-only Git activity layer** shows recent commit velocity, branch, working-tree state, stale projects, and merge conflict signals
- **Memory-ready filter** finds projects that already have `.hypernovum/MEMORY_CONTEXT.md`
- **Funding metadata** is included for users who want to support the free plugin

### HUD
- **HYPERNOVUM** neon title with flashing block cursor at top center
- **Legend panel** showing status colors and priority heights
- **Controls hint** overlay
- **Save Layout** button for persisting block positions

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
projectDir: C:\Users\me\projects\my-project   # Windows
# projectDir: /Users/me/projects/my-project   # macOS
# projectDir: /home/me/projects/my-project    # Linux
---
```

## AI Integration

Hypernovum has **no built-in AI**. External AI tools (Claude Code, etc.) read `SCHEMA.md` to learn the frontmatter format, scan your project directories, and write frontmatter to vault notes. Hypernovum renders the result.

The `scripts/heartbeat.js` script can be wired into Claude Code hooks to enable real-time activity visualization:

```bash
# macOS / Linux
node scripts/heartbeat.js --vault="/Users/you/Documents/MyVault" --project="my-project" --action="editing"

# Windows (PowerShell)
node scripts/heartbeat.js --vault="C:\Users\you\Documents\MyVault" --project="my-project" --action="editing"
```

The heartbeat file (`.hypernovum-status.json`) is written to the vault root, so the `--vault` flag must point to your actual vault folder regardless of platform.

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
