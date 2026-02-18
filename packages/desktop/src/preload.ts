import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('hypervault', {
  // Main → Renderer listeners
  onScanComplete: (cb: (data: unknown) => void) =>
    ipcRenderer.on('hypervault:scan-complete', (_e, data) => cb(data)),
  onWeatherUpdate: (cb: (data: unknown) => void) =>
    ipcRenderer.on('hypervault:weather', (_e, data) => cb(data)),

  // Renderer → Main sends
  ready: () => ipcRenderer.send('hypervault:renderer-ready'),
  rescan: () => ipcRenderer.send('hypervault:rescan'),
  launchTerminal: (opts: { projectPath: string; command?: string }) =>
    ipcRenderer.send('hypervault:launch-terminal', opts),
  openExplorer: (opts: { projectPath: string }) =>
    ipcRenderer.send('hypervault:open-explorer', opts),
  saveLayout: (positions: unknown[]) =>
    ipcRenderer.send('hypervault:save-layout', positions),
  showContextMenu: (opts: {
    projectPath: string; title: string; x: number; y: number;
    agentName?: string; agentCommand?: string;
  }) =>
    ipcRenderer.send('hypervault:context-menu', opts),
  showOrbMenu: (opts: { x: number; y: number; agentCommand?: string }) =>
    ipcRenderer.send('hypervault:orb-menu', opts),

  // Tandem terminal
  openTandem: (config: {
    projectPath: string;
    leftAgent: { name: string; command: string; color: string };
    rightAgent: { name: string; command: string; color: string };
  }) => ipcRenderer.send('hypervault:open-tandem', config),

  // Clipboard
  copyToClipboard: (text: string) =>
    ipcRenderer.send('hypervault:copy-to-clipboard', text),

  // Agent detection & config
  detectAgents: (commands: string[]) =>
    ipcRenderer.invoke('hypervault:detect-agents', commands),
  loadAgentsConfig: () =>
    ipcRenderer.invoke('hypervault:load-agents-config'),
  saveAgentsConfig: (config: unknown) =>
    ipcRenderer.send('hypervault:save-agents-config', config),

  // Async file I/O (for Holodeck Editor)
  readFile: (filePath: string) =>
    ipcRenderer.invoke('hypervault:read-file', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('hypervault:write-file', filePath, content),
  listFiles: (dirPath: string) =>
    ipcRenderer.invoke('hypervault:list-files', dirPath),
});
