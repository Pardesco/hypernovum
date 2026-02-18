import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

interface TandemAPI {
  getConfig: () => Promise<{
    projectPath: string;
    leftAgent: { name: string; command: string; color: string };
    rightAgent: { name: string; command: string; color: string };
  }>;
  createTerminal: (opts: { terminalId: string; projectPath: string; command?: string; cols?: number; rows?: number }) => Promise<{ ok: boolean; error?: string }>;
  terminalInput: (terminalId: string, data: string) => void;
  terminalResize: (terminalId: string, cols: number, rows: number) => void;
  destroyTerminal: (terminalId: string) => void;
  onTerminalData: (cb: (terminalId: string, data: string) => void) => void;
  onTerminalExit: (cb: (terminalId: string, exitCode: number) => void) => void;
  copyToClipboard: (text: string) => void;
  readClipboard: () => Promise<string>;
}

declare global {
  interface Window {
    tandem: TandemAPI;
  }
}

async function init() {
  const config = await window.tandem.getConfig();
  const root = document.getElementById('root')!;

  // Build UI
  root.innerHTML = `
    <div class="tandem-container">
      <div class="tandem-header">
        <div class="tandem-agent-label" id="left-label">
          <span class="tandem-agent-dot" id="left-dot"></span>
          <span id="left-name"></span>
        </div>
        <div class="tandem-divider-label">TANDEM</div>
        <div class="tandem-agent-label" id="right-label">
          <span class="tandem-agent-dot" id="right-dot"></span>
          <span id="right-name"></span>
        </div>
      </div>
      <div class="tandem-panes">
        <div class="tandem-pane" id="left-pane">
          <div class="tandem-terminal" id="left-terminal"></div>
        </div>
        <div class="tandem-splitter"></div>
        <div class="tandem-pane" id="right-pane">
          <div class="tandem-terminal" id="right-terminal"></div>
        </div>
      </div>
    </div>
  `;

  // Set labels and colors
  const leftName = document.getElementById('left-name')!;
  const rightName = document.getElementById('right-name')!;
  const leftDot = document.getElementById('left-dot') as HTMLElement;
  const rightDot = document.getElementById('right-dot') as HTMLElement;
  const leftPane = document.getElementById('left-pane') as HTMLElement;
  const rightPane = document.getElementById('right-pane') as HTMLElement;

  leftName.textContent = config.leftAgent.name;
  rightName.textContent = config.rightAgent.name;
  leftDot.style.background = config.leftAgent.color;
  rightDot.style.background = config.rightAgent.color;
  leftPane.style.borderTopColor = config.leftAgent.color;
  rightPane.style.borderTopColor = config.rightAgent.color;

  // Create xterm instances
  const darkTheme = {
    background: '#0c0c14',
    foreground: '#e0e0e0',
    cursor: '#e0e0e0',
    selectionBackground: '#33467080',
    black: '#0c0c14',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#6272a4',
    magenta: '#bd93f9',
    cyan: '#8be9fd',
    white: '#e0e0e0',
    brightBlack: '#44475a',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  };

  const leftTerm = new Terminal({
    theme: { ...darkTheme, cursorAccent: config.leftAgent.color },
    fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
    fontSize: 13,
    cursorBlink: true,
    allowProposedApi: true,
  });

  const rightTerm = new Terminal({
    theme: { ...darkTheme, cursorAccent: config.rightAgent.color },
    fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
    fontSize: 13,
    cursorBlink: true,
    allowProposedApi: true,
  });

  const leftFit = new FitAddon();
  const rightFit = new FitAddon();
  leftTerm.loadAddon(leftFit);
  rightTerm.loadAddon(rightFit);

  leftTerm.open(document.getElementById('left-terminal')!);
  rightTerm.open(document.getElementById('right-terminal')!);

  // Robust initial fit — wait for layout to stabilize, then fit multiple times
  const fitAll = () => {
    try { leftFit.fit(); } catch {}
    try { rightFit.fit(); } catch {}
  };
  // Staggered fits to handle slow initial layout
  requestAnimationFrame(() => {
    fitAll();
    setTimeout(fitAll, 100);
    setTimeout(fitAll, 300);
  });

  const leftId = 'tandem-left';
  const rightId = 'tandem-right';

  // Route pty output to correct terminal
  window.tandem.onTerminalData((terminalId, data) => {
    if (terminalId === leftId) leftTerm.write(data);
    else if (terminalId === rightId) rightTerm.write(data);
  });

  window.tandem.onTerminalExit((terminalId, exitCode) => {
    const label = terminalId === leftId ? config.leftAgent.name : config.rightAgent.name;
    const term = terminalId === leftId ? leftTerm : rightTerm;
    term.write(`\r\n\x1b[90m[${label} exited with code ${exitCode}]\x1b[0m\r\n`);
  });

  // Clipboard: Ctrl+C copies when text selected, Ctrl+V pastes
  function attachClipboard(term: Terminal, terminalId: string) {
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Ctrl+C: copy if there's a selection, otherwise let it pass as SIGINT
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'c') {
        const selection = term.getSelection();
        if (selection) {
          window.tandem.copyToClipboard(selection);
          term.clearSelection();
          return false; // prevent sending to PTY
        }
      }
      // Ctrl+V: paste from clipboard
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
        window.tandem.readClipboard().then((text: string) => {
          if (text) window.tandem.terminalInput(terminalId, text);
        });
        return false; // prevent default
      }
      // Ctrl+A: select all
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'a') {
        term.selectAll();
        return false;
      }
      return true; // let all other keys pass through
    });
  }

  attachClipboard(leftTerm, leftId);
  attachClipboard(rightTerm, rightId);

  // Route terminal input to pty
  leftTerm.onData((data) => window.tandem.terminalInput(leftId, data));
  rightTerm.onData((data) => window.tandem.terminalInput(rightId, data));

  // Create PTY sessions
  const leftResult = await window.tandem.createTerminal({
    terminalId: leftId,
    projectPath: config.projectPath,
    command: config.leftAgent.command,
    cols: leftTerm.cols,
    rows: leftTerm.rows,
  });
  if (!leftResult.ok) {
    leftTerm.write(`\x1b[31mFailed to start ${config.leftAgent.name}: ${leftResult.error}\x1b[0m\r\n`);
  }

  const rightResult = await window.tandem.createTerminal({
    terminalId: rightId,
    projectPath: config.projectPath,
    command: config.rightAgent.command,
    cols: rightTerm.cols,
    rows: rightTerm.rows,
  });
  if (!rightResult.ok) {
    rightTerm.write(`\x1b[31mFailed to start ${config.rightAgent.name}: ${rightResult.error}\x1b[0m\r\n`);
  }

  // Handle resize — debounced, uses ResizeObserver for all layout changes
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const handleResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      fitAll();
      window.tandem.terminalResize(leftId, leftTerm.cols, leftTerm.rows);
      window.tandem.terminalResize(rightId, rightTerm.cols, rightTerm.rows);
    }, 50);
  };

  // ResizeObserver catches window resize, dev tools toggle, splitter drag, etc.
  const panes = document.querySelector('.tandem-panes') as HTMLElement;
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(panes);
  window.addEventListener('resize', handleResize);

  // Splitter drag
  const splitter = document.querySelector('.tandem-splitter') as HTMLElement;
  let dragging = false;

  splitter.addEventListener('mousedown', (e) => {
    dragging = true;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = panes.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(20, Math.min(80, pct));
    leftPane.style.flex = `0 0 ${clamped}%`;
    rightPane.style.flex = `0 0 ${100 - clamped}%`;
    handleResize();
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
  });

  // Focus left terminal by default
  leftTerm.focus();
}

init();
