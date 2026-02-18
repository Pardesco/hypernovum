import type { ProjectData, WeatherData } from '@hypervault/core';

interface FileEntry {
  path: string;
  name: string;
  isDir: boolean;
}

interface HypervaultAPI {
  onScanComplete: (cb: (projects: ProjectData[]) => void) => void;
  onWeatherUpdate: (cb: (weather: WeatherData) => void) => void;
  ready: () => void;
  rescan: () => void;
  launchTerminal: (opts: { projectPath: string; command?: string }) => void;
  openExplorer: (opts: { projectPath: string }) => void;
  showContextMenu: (opts: {
    projectPath: string; title: string; x: number; y: number;
    agentName?: string; agentCommand?: string;
  }) => void;
  saveLayout: (positions: import('@hypervault/core').BlockPosition[]) => void;
  showOrbMenu: (opts: { x: number; y: number; agentCommand?: string }) => void;
  readFile: (filePath: string) => Promise<{ ok: boolean; content?: string; error?: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>;
  listFiles: (dirPath: string) => Promise<FileEntry[]>;
  openTandem: (config: {
    projectPath: string;
    leftAgent: { name: string; command: string; color: string };
    rightAgent: { name: string; command: string; color: string };
  }) => void;
  copyToClipboard: (text: string) => void;
  detectAgents: (commands: string[]) => Promise<Record<string, boolean>>;
  loadAgentsConfig: () => Promise<import('./agents').AgentsConfig | null>;
  saveAgentsConfig: (config: import('./agents').AgentsConfig) => void;
}

declare global {
  interface Window {
    hypervault: HypervaultAPI;
  }
}
