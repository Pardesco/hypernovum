# Hypervault Frontmatter Schema

Hypervault reads YAML frontmatter from Obsidian vault notes to generate a 3D code city. Each note that matches the project detection rules becomes a building.

This schema is designed to be populated **manually by humans** or **automatically by AI tools** (e.g., Claude Code scanning project directories).

---

## Project Detection

A note is recognized as a project if **any** of these conditions are true:

1. Frontmatter `tags` array contains `project` (or `#project`)
2. Frontmatter field `type` equals `project`

The detection tag can be customized in plugin settings (default: `project`).

---

## Frontmatter Fields

### Required (for detection)

| Field | Type | Purpose |
|-------|------|---------|
| `tags` | `string[]` | Must include `project` (or the configured tag) |
| — OR — | | |
| `type` | `string` | Must be `project` |

### Visual Encoding Fields (all optional)

| Field | Type | Default | Visual Effect |
|-------|------|---------|---------------|
| `title` | `string` | filename | Building label |
| `status` | `string` | `active` | **Building color** (see values below) |
| `priority` | `string` | `medium` | **Building height** (taller = higher priority) |
| `stage` | `string` | same as status | **X-axis position** (pipeline progression) |
| `category` | `string` | `uncategorized` | **Z-axis position** (district clustering) |
| `scope` | `number` | file size estimate | **Base footprint size** (larger = more complex) |
| `health` | `number` (0-100) | derived from status | Health percentage for tooltip |
| `noteCount` | `number` | `1` | Scope fallback + tooltip display |

### Status Values → Building Color

| Value | Aliases | Color |
|-------|---------|-------|
| `active` | `in-progress`, `in progress` | Green (#00ff88) |
| `blocked` | `stalled` | Red (#ff4444) |
| `paused` | `on-hold`, `on hold` | Blue (#4488ff) |
| `complete` | `done`, `completed` | Purple (#aa88ff) |

### Priority Values → Building Height

| Value | Aliases | Stories |
|-------|---------|---------|
| `critical` | `urgent` | 8 (tallest) |
| `high` | — | 5 |
| `medium` | `normal` | 3 |
| `low` | — | 1 (shortest) |

### Stage Values → X-Axis Position

| Value | Aliases | Position |
|-------|---------|----------|
| `backlog` | `planning` | Far left |
| `active` | `in-progress` | Center |
| `paused` | `on-hold` | Center-right |
| `complete` | `done`, `archived` | Far right |

### Category → Z-Axis District

Categories can be any string. Projects sharing the same category are grouped into the same district (cluster) along the Z axis. Examples: `work`, `personal`, `art`, `research`, `client-name`.

---

## Example: Manual Entry

```yaml
---
tags: [project]
title: My Web App
status: active
priority: high
stage: active
category: work
scope: 15
health: 75
noteCount: 12
---
```

## Example: AI-Generated Entry

When an AI tool (like Claude Code) scans a project directory, it should create or update a note in the user's vault with frontmatter like this:

```yaml
---
type: project
title: hypervault
status: active
priority: high
stage: active
category: obsidian-plugins
scope: 30
health: 85
noteCount: 28
---

# hypervault

Obsidian plugin — 3D Code City dashboard for PKM.

- **Stack**: TypeScript, Three.js, Zustand, esbuild
- **Files**: 28 source files
- **Last commit**: 2026-02-04
- **Open issues**: 3
```

## AI Integration Pattern

Hypervault has **no built-in AI**. Instead, AI tools operate externally:

1. User asks their AI assistant: *"Scan my projects and set up Hypervault"*
2. AI reads this schema (SCHEMA.md) to learn the frontmatter format
3. AI scans the user's project directories (analyzing code, git history, READMEs)
4. AI creates/updates notes in the user's Obsidian vault with the correct frontmatter
5. Hypervault reads the frontmatter and renders the city

This keeps the plugin simple and avoids API key configuration. Any AI tool that can read files and write markdown can integrate with Hypervault.
