# Tandem Terminal — Implementation Plan

## Overview
Split-pane embedded terminal panel inside the Hypervault desktop app. Two xterm.js terminals side by side, each running a different AI coding agent (e.g. Claude Code + Gemini CLI), sharing the same project directory. Enables rapid cross-agent vibe coding without leaving the app.

## Why
- External terminals require alt-tabbing and manual cd'ing
- Copy/paste between two agents in separate windows is clunky
- Tandem mode lets users compare agent outputs, delegate subtasks, or use one agent to review another's work — all in one view

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process                              │
│  ┌─────────────┐  ┌─────────────┐                   │
│  │ node-pty #1  │  │ node-pty #2  │  ← PTY sessions │
│  └──────┬──────┘  └──────┬──────┘                   │
│         │ IPC            │ IPC                       │
├─────────┼────────────────┼──────────────────────────┤
│  Preload Bridge                                     │
│  createTerminal / terminalInput / terminalResize     │
│  destroyTerminal / onTerminalData / onTerminalExit   │
├─────────┼────────────────┼──────────────────────────┤
│  Renderer Process                                   │
│  ┌──────┴──────┐  ┌──────┴──────┐                   │
│  │  xterm.js   │  │  xterm.js   │  ← TandemTerminal │
│  │  (left)     │  │  (right)    │    React component │
│  └─────────────┘  └─────────────┘                   │
└─────────────────────────────────────────────────────┘
```

## Dependencies to Add

```bash
# In packages/desktop
npm install xterm @xterm/addon-fit node-pty
npm install -D @types/node-pty
```

- **xterm** (`@xterm/xterm` v5+) — Terminal emulator UI for the renderer
- **@xterm/addon-fit** — Auto-resize xterm to its container
- **node-pty** — Native pseudoterminal for the main process (spawns real shells)

> `node-pty` is a native addon. It must be marked as `external` in esbuild and shipped unpacked in production builds.

## Files to Create

### 1. `packages/desktop/src/renderer/TandemTerminal.tsx`

React component rendering two side-by-side xterm instances.

**Props:**
```typescript
interface TandemTerminalProps {
  projectDir: string;
  leftAgent: Agent;        // e.g. Claude Code
  rightAgent: Agent;       // e.g. Gemini CLI
  onClose: () => void;
}
```

**Layout:**
```
┌──────────────────────────────────────────────┐
│ TANDEM  [Claude Code ▼] [Gemini CLI ▼]  [×] │  ← header with agent selectors
├──────────────────────┬───────────────────────┤
│                      │                       │
│   xterm left pane    │   xterm right pane    │
│   (agent color       │   (agent color        │
│    themed border)    │    themed border)     │
│                      │                       │
├──────────────────────┴───────────────────────┤
│ [⇄ Swap] [□ Full Left] [□ Full Right]       │  ← toolbar
└──────────────────────────────────────────────┘
```

**Behavior:**
- On mount: calls `createTerminal()` twice (one per pane), each with the agent's `command` and the project's `projectDir`
- Subscribes to `onTerminalData` and routes output to the correct xterm instance by `terminalId`
- On resize (window or splitter drag): calls `terminalResize()` with new cols/rows via the `fit` addon
- On unmount/close: calls `destroyTerminal()` for both sessions
- Agent dropdowns allow swapping which agent runs in which pane (kills old pty, spawns new)

**Theming:**
- Each xterm instance gets a colored top-border matching `agent.color`
- Background matches app glass-morphism (`rgba(5, 10, 20, 0.95)`)
- xterm theme: dark background, agent-colored cursor

**Keyboard:**
- Click a pane to focus it (standard xterm focus)
- `Ctrl+Shift+Left/Right` to switch focus between panes
- `Esc` closes the panel (when neither xterm has focus)

### 2. `packages/desktop/src/main/pty-manager.ts`

Main process module managing PTY sessions.

```typescript
import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';

interface PtySession {
  id: string;
  process: pty.IPty;
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();
  private window: BrowserWindow | null = null;

  setWindow(win: BrowserWindow): void;

  create(opts: {
    terminalId: string;
    projectPath: string;
    command?: string;
    cols?: number;
    rows?: number;
    env?: NodeJS.ProcessEnv;
  }): { ok: boolean; error?: string };

  write(terminalId: string, data: string): void;

  resize(terminalId: string, cols: number, rows: number): void;

  destroy(terminalId: string): void;

  destroyAll(): void;  // cleanup on window close
}
```

**Shell spawning logic:**
- If `command` is provided (e.g. `claude`): spawn the default shell, then immediately write `cd <projectPath> && <command>\n`
- If no command: spawn shell at `projectPath` as cwd
- Windows: `cmd.exe` or `powershell.exe`
- macOS/Linux: user's `$SHELL` or `/bin/bash`
- Always use `cleanEnv()` to strip `CLAUDECODE` and similar vars

**Data flow:**
- `pty.onData(data)` → `mainWindow.webContents.send('hypervault:terminal-data', terminalId, data)`
- `pty.onExit(code)` → `mainWindow.webContents.send('hypervault:terminal-exit', terminalId, code)`

## Files to Modify

### 3. `packages/desktop/esbuild.config.mjs`

Add `node-pty` to main process externals:

```javascript
// In the main process bundle config:
external: ['electron', 'node-pty', ...builtins],
```

### 4. `packages/desktop/src/preload.ts`

Add 5 new IPC methods:

```typescript
// Terminal PTY management
createTerminal: (opts: { terminalId: string; projectPath: string; command?: string; cols?: number; rows?: number }) =>
  ipcRenderer.invoke('hypervault:create-terminal', opts),

terminalInput: (terminalId: string, data: string) =>
  ipcRenderer.send('hypervault:terminal-input', { terminalId, data }),

terminalResize: (terminalId: string, cols: number, rows: number) =>
  ipcRenderer.send('hypervault:terminal-resize', { terminalId, cols, rows }),

destroyTerminal: (terminalId: string) =>
  ipcRenderer.send('hypervault:destroy-terminal', { terminalId }),

onTerminalData: (cb: (terminalId: string, data: string) => void) =>
  ipcRenderer.on('hypervault:terminal-data', (_e, terminalId: string, data: string) => cb(terminalId, data)),

onTerminalExit: (cb: (terminalId: string, exitCode: number) => void) =>
  ipcRenderer.on('hypervault:terminal-exit', (_e, terminalId: string, exitCode: number) => cb(terminalId, exitCode)),
```

### 5. `packages/desktop/src/renderer/types.d.ts`

Extend `HypervaultAPI`:

```typescript
createTerminal: (opts: { terminalId: string; projectPath: string; command?: string; cols?: number; rows?: number }) => Promise<{ ok: boolean; error?: string }>;
terminalInput: (terminalId: string, data: string) => void;
terminalResize: (terminalId: string, cols: number, rows: number) => void;
destroyTerminal: (terminalId: string) => void;
onTerminalData: (cb: (terminalId: string, data: string) => void) => void;
onTerminalExit: (cb: (terminalId: string, exitCode: number) => void) => void;
```

### 6. `packages/desktop/src/main/index.ts`

- Import and instantiate `PtyManager`
- Register 4 IPC handlers: `create-terminal` (handle), `terminal-input` (on), `terminal-resize` (on), `destroy-terminal` (on)
- Call `ptyManager.destroyAll()` in `window-all-closed`

### 7. `packages/desktop/src/renderer/App.tsx`

New state and UI:

```typescript
const [showTandem, setShowTandem] = useState(false);
const [tandemRightAgent, setTandemRightAgent] = useState<Agent | null>(null);
```

Add `<TandemTerminal>` to JSX (rendered as a bottom drawer or full overlay):

```tsx
{showTandem && activeAgent && selectedProject?.projectDir && (
  <TandemTerminal
    projectDir={selectedProject.projectDir}
    leftAgent={activeAgent}
    rightAgent={tandemRightAgent || activeAgent}
    onClose={() => setShowTandem(false)}
  />
)}
```

### 8. `packages/desktop/src/renderer/AgentsPanel.tsx`

Add a "Tandem" button next to the existing "Launch" button:

```tsx
<button className="agents-tandem-btn" onClick={onOpenTandem}>
  Tandem ⇄
</button>
```

New prop: `onOpenTandem: () => void` — triggers `setShowTandem(true)` in App.

### 9. `packages/desktop/src/renderer/styles.css`

New styles for:
- `.tandem-panel` — bottom drawer (40-50vh), glass-morphism bg, slide-up animation
- `.tandem-header` — agent selectors, close button
- `.tandem-panes` — flex row, 50/50 split
- `.tandem-pane` — individual xterm container with colored top-border
- `.tandem-toolbar` — swap/maximize buttons
- xterm theme overrides to match Hypervault dark aesthetic

## Implementation Steps

### Phase 1: PTY Backend (main process)
1. `npm install node-pty` in `packages/desktop`
2. Add `node-pty` to esbuild externals
3. Create `src/main/pty-manager.ts`
4. Add IPC handlers in `src/main/index.ts`
5. Update preload + types
6. **Test:** Verify pty spawns and echoes data back through IPC

### Phase 2: Single Terminal Pane (renderer)
1. `npm install @xterm/xterm @xterm/addon-fit`
2. Create basic `TandemTerminal.tsx` with ONE xterm instance
3. Wire xterm.onData → terminalInput, onTerminalData → xterm.write
4. Add fit addon for auto-resize
5. Add panel to App.tsx, button to AgentsPanel
6. **Test:** Launch single embedded terminal with an agent

### Phase 3: Tandem Mode (split panes)
1. Extend `TandemTerminal.tsx` to two panes
2. Add agent selector dropdowns per pane
3. Add swap/maximize toolbar
4. Style split layout + agent-colored borders
5. **Test:** Two agents running side by side

### Phase 4: Polish
1. Add draggable splitter between panes
2. Add "Copy last output" button per pane
3. Keyboard shortcuts for pane switching
4. Handle terminal exit/restart gracefully
5. Persist tandem preferences (last-used agent pair)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `node-pty` native build fails on user's machine | Ship prebuilt binaries via `electron-rebuild`, or fall back to external terminal launch |
| xterm performance with large output (e.g. `npm install`) | xterm.js handles this well natively; set scrollback limit (e.g. 5000 lines) |
| Agent CLIs that don't work in pty (e.g. Cursor is a desktop app) | Only show Tandem button for agents where `agent.detected === true` and command is a CLI tool; add `terminalCompatible: boolean` flag to Agent interface |
| Two heavy AI agents consuming resources simultaneously | User's choice; could add a resource warning tooltip |
| Shell detection across platforms | Use `process.env.SHELL` on Unix, `cmd.exe` on Windows; allow user override in settings later |

## Future Extensions
- **3+ panes** — Grid layout for power users running 3-4 agents
- **Shared context** — Auto-copy selected text from one pane to the other's input
- **Session recording** — Log terminal sessions for review
- **Agent handoff** — "Send this task to the other agent" button that pastes a prompt
- **Terminal in building** — Click a building → embedded terminal opens pre-cd'd to that project
