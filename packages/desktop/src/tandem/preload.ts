import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('tandem', {
  // Get launch config passed from main window
  getConfig: () => ipcRenderer.invoke('tandem:get-config'),

  // PTY management
  createTerminal: (opts: { terminalId: string; projectPath: string; command?: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke('tandem:create-terminal', opts),
  terminalInput: (terminalId: string, data: string) =>
    ipcRenderer.send('tandem:terminal-input', terminalId, data),
  terminalResize: (terminalId: string, cols: number, rows: number) =>
    ipcRenderer.send('tandem:terminal-resize', terminalId, cols, rows),
  destroyTerminal: (terminalId: string) =>
    ipcRenderer.send('tandem:destroy-terminal', terminalId),

  // PTY output
  onTerminalData: (cb: (terminalId: string, data: string) => void) =>
    ipcRenderer.on('pty:data', (_e, terminalId: string, data: string) => cb(terminalId, data)),
  onTerminalExit: (cb: (terminalId: string, exitCode: number) => void) =>
    ipcRenderer.on('pty:exit', (_e, terminalId: string, exitCode: number) => cb(terminalId, exitCode)),

  // Clipboard
  copyToClipboard: (text: string) =>
    ipcRenderer.send('hypervault:copy-to-clipboard', text),
  readClipboard: () =>
    ipcRenderer.invoke('tandem:read-clipboard'),
});
