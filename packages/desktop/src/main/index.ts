import { app, BrowserWindow, ipcMain, shell, Menu, dialog, clipboard } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { DiscoveryScanner } from './discovery';
import { GitWeatherCollector } from './discovery';
import { VaultParser } from './vault-parser';
import { PtyManager } from './pty-manager';
import type { ProjectData } from '@hypervault/core';

let mainWindow: BrowserWindow | null = null;
let weatherCollector: GitWeatherCollector | null = null;
let tandemWindow: BrowserWindow | null = null;
let tandemConfig: any = null;
const ptyManager = new PtyManager();

/** Clean env for spawned terminals — strips CLAUDECODE to avoid nested-session errors */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Hypervault Command Center',
    backgroundColor: '#0a0a14',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Merge vault-parsed projects with scanner-discovered projects.
 * Vault data wins when both sources describe the same project (matched by projectDir).
 * Scanner-only projects (no vault note) are included with auto-detected metadata.
 */
function mergeProjects(vaultProjects: ProjectData[], scannedProjects: ProjectData[]): ProjectData[] {
  const merged = new Map<string, ProjectData>();

  // Vault projects take priority — they have hand-crafted metadata
  for (const vp of vaultProjects) {
    const key = vp.projectDir ? path.resolve(vp.projectDir) : vp.path;
    merged.set(key, vp);
  }

  // Add scanner projects that don't have a vault note
  for (const sp of scannedProjects) {
    const key = sp.projectDir ? path.resolve(sp.projectDir) : sp.path;
    if (!merged.has(key)) {
      merged.set(key, sp);
    }
  }

  return Array.from(merged.values());
}

async function scanProjects(scanDir: string): Promise<ProjectData[]> {
  // 1. Try to find vault project notes (rich metadata from .md frontmatter)
  const vaultRoots = VaultParser.findVaultRoots(scanDir);
  console.log('Vault search from:', scanDir, '-> found:', vaultRoots);
  const vaultProjects: ProjectData[] = [];
  for (const root of vaultRoots) {
    vaultProjects.push(...VaultParser.parseVault(root));
  }
  console.log('Vault projects parsed:', vaultProjects.length);

  if (vaultProjects.length > 0) {
    console.log(`Parsed ${vaultProjects.length} projects from vault notes (${vaultRoots.join(', ')})`);
  }

  // 2. Run filesystem discovery scanner
  const scanner = new DiscoveryScanner();
  const result = await scanner.scan({ rootDir: scanDir });

  if (result.errors.length > 0) {
    console.warn('Scan warnings:', result.errors);
  }
  console.log(`Discovered ${result.projects.length} projects from filesystem in ${result.scanDuration}ms`);

  // 3. Merge: vault metadata wins, scanner fills gaps
  const projects = mergeProjects(vaultProjects, result.projects);
  console.log(`Total: ${projects.length} projects (${vaultProjects.length} from vault, ${result.projects.length - (projects.length - vaultProjects.length)} merged with scanner)`);

  return projects;
}

function startWeatherPolling(projects: ProjectData[]): void {
  if (weatherCollector) {
    weatherCollector.stopPolling();
  }

  weatherCollector = new GitWeatherCollector();
  weatherCollector.on('weather-update', (weather) => {
    mainWindow?.webContents.send('hypervault:weather', weather);
  });

  const projectDirs = projects
    .map(p => p.projectDir)
    .filter((d): d is string => !!d);

  if (projectDirs.length > 0) {
    weatherCollector.startPolling(projectDirs, 30000);
  }
}

app.whenReady().then(async () => {
  createWindow();

  // Scan CWD (or first CLI arg after electron path) for projects
  const scanDir = process.argv.find((arg, i) => i > 0 && !arg.startsWith('-') && !arg.endsWith('.js'))
    || process.cwd();

  // Scan immediately but hold results until renderer is ready
  const scanPromise = scanProjects(scanDir);
  let latestProjects: ProjectData[] = [];

  // Wait for renderer to signal ready, then send cached scan results
  ipcMain.on('hypervault:renderer-ready', async () => {
    latestProjects = await scanPromise;
    mainWindow?.webContents.send('hypervault:scan-complete', latestProjects);
    startWeatherPolling(latestProjects);
  });

  // IPC: rescan
  ipcMain.on('hypervault:rescan', async () => {
    latestProjects = await scanProjects(scanDir);
    mainWindow?.webContents.send('hypervault:scan-complete', latestProjects);
    startWeatherPolling(latestProjects);
  });

  // IPC: launch terminal at project path (optionally running a command)
  ipcMain.on('hypervault:launch-terminal', (_e, { projectPath, command }: { projectPath: string; command?: string }) => {
    const { exec } = require('child_process');
    const env = cleanEnv();
    if (command) {
      // Launch terminal with the specified agent command
      if (process.platform === 'win32') {
        exec(`start cmd /k "cd /d ${projectPath} && ${command}"`, { cwd: projectPath, env });
      } else if (process.platform === 'darwin') {
        exec(`osascript -e 'tell app "Terminal" to do script "cd \\"${projectPath}\\" && ${command}"'`, { env });
      } else {
        exec(`x-terminal-emulator --working-directory="${projectPath}" -e "${command}"`, { cwd: projectPath, env });
      }
    } else {
      // Plain terminal
      if (process.platform === 'win32') {
        exec(`start cmd /k "cd /d ${projectPath}"`, { env });
      } else if (process.platform === 'darwin') {
        exec(`open -a Terminal "${projectPath}"`, { env });
      } else {
        exec(`x-terminal-emulator --working-directory="${projectPath}" || xterm -e "cd '${projectPath}' && bash"`, { env });
      }
    }
  });

  // IPC: open file explorer at project path
  ipcMain.on('hypervault:open-explorer', (_e, { projectPath }: { projectPath: string }) => {
    shell.openPath(projectPath);
  });

  // IPC: right-click context menu on building
  ipcMain.on('hypervault:context-menu', (_e, opts: {
    projectPath: string; title: string; x: number; y: number;
    agentName?: string; agentCommand?: string;
  }) => {
    const { projectPath, agentName, agentCommand } = opts;
    const { exec } = require('child_process');
    const env = cleanEnv();

    const agentLabel = agentName || 'Claude Code';
    const agentCmd = agentCommand || 'claude';

    const menu = Menu.buildFromTemplate([
      {
        label: `Launch ${agentLabel}`,
        click: () => {
          if (process.platform === 'win32') {
            exec(`start cmd /k "cd /d ${projectPath} && ${agentCmd}"`, { cwd: projectPath, env });
          } else if (process.platform === 'darwin') {
            exec(`osascript -e 'tell app "Terminal" to do script "cd \\"${projectPath}\\" && ${agentCmd}"'`, { env });
          } else {
            exec(`x-terminal-emulator --working-directory="${projectPath}" -e "${agentCmd}"`, { cwd: projectPath, env });
          }
        },
      },
      {
        label: `Open in Explorer`,
        click: () => {
          shell.openPath(projectPath);
        },
      },
      {
        label: `Open in Terminal`,
        click: () => {
          if (process.platform === 'win32') {
            exec(`start cmd /k "cd /d ${projectPath}"`, { env });
          } else if (process.platform === 'darwin') {
            exec(`open -a Terminal "${projectPath}"`, { env });
          } else {
            exec(`x-terminal-emulator --working-directory="${projectPath}"`, { env });
          }
        },
      },
      { type: 'separator' },
      {
        label: `Focus Camera`,
        click: () => {
          mainWindow?.webContents.send('hypervault:focus-project', projectPath);
        },
      },
    ]);

    menu.popup({ window: mainWindow! });
  });

  // IPC: save layout positions to JSON file
  ipcMain.on('hypervault:save-layout', (_e, positions: unknown[]) => {
    try {
      const fs = require('fs');
      const layoutPath = path.join(app.getPath('userData'), 'layout.json');
      fs.writeFileSync(layoutPath, JSON.stringify(positions, null, 2));
      console.log('Layout saved to', layoutPath);
    } catch (err) {
      console.error('Failed to save layout:', err);
    }
  });

  // IPC: orb right-click menu — pick folder + launch agent
  ipcMain.on('hypervault:orb-menu', (_e, opts: { x: number; y: number; agentCommand?: string }) => {
    const { exec } = require('child_process');
    const env = cleanEnv();
    const agentCmd = opts.agentCommand || 'claude';

    const menu = Menu.buildFromTemplate([
      {
        label: 'New Project',
        click: async () => {
          const result = await dialog.showOpenDialog(mainWindow!, {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select folder for new project',
          });
          if (result.canceled || result.filePaths.length === 0) return;
          const folder = result.filePaths[0];
          if (process.platform === 'win32') {
            exec(`start cmd /k "cd /d ${folder} && ${agentCmd}"`, { cwd: folder, env });
          } else if (process.platform === 'darwin') {
            exec(`osascript -e 'tell app "Terminal" to do script "cd \\"${folder}\\" && ${agentCmd}"'`, { env });
          } else {
            exec(`x-terminal-emulator --working-directory="${folder}" -e "${agentCmd}"`, { cwd: folder, env });
          }
        },
      },
      {
        label: 'Rescan Projects',
        click: async () => {
          latestProjects = await scanProjects(scanDir);
          mainWindow?.webContents.send('hypervault:scan-complete', latestProjects);
          startWeatherPolling(latestProjects);
        },
      },
    ]);

    menu.popup({ window: mainWindow! });
  });

  // IPC: read file contents (for Holodeck Editor)
  ipcMain.handle('hypervault:read-file', async (_e, filePath: string) => {
    const fs = require('fs/promises');
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return { ok: true, content };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // IPC: write file contents (for Holodeck Editor)
  ipcMain.handle('hypervault:write-file', async (_e, filePath: string, content: string) => {
    const fs = require('fs/promises');
    try {
      await fs.writeFile(filePath, content, 'utf8');
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // IPC: list files in a project directory (for Holodeck Editor file tree)
  ipcMain.handle('hypervault:list-files', async (_e, dirPath: string) => {
    const fs = require('fs');
    const fsp = require('fs/promises');
    const ignoreDirs = new Set([
      'node_modules', '.git', 'dist', 'build', 'vendor', '__pycache__',
      '.venv', 'venv', 'target', '.next', '.obsidian', '.svelte-kit',
    ]);
    const results: { path: string; name: string; isDir: boolean }[] = [];

    const walk = async (dir: string, depth: number) => {
      if (depth > 3) return;
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') && entry.isDirectory()) continue;
          if (entry.isDirectory() && ignoreDirs.has(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          results.push({ path: fullPath, name: entry.name, isDir: entry.isDirectory() });
          if (entry.isDirectory()) {
            await walk(fullPath, depth + 1);
          }
        }
      } catch { /* permission denied */ }
    };

    await walk(dirPath, 0);
    return results;
  });

  // IPC: open tandem terminal window
  ipcMain.on('hypervault:open-tandem', (_e, config: {
    projectPath: string;
    leftAgent: { name: string; command: string; color: string };
    rightAgent: { name: string; command: string; color: string };
  }) => {
    tandemConfig = config;

    // If tandem window already exists, focus it
    if (tandemWindow && !tandemWindow.isDestroyed()) {
      tandemWindow.focus();
      return;
    }

    tandemWindow = new BrowserWindow({
      width: 1200,
      height: 600,
      title: `Tandem: ${config.leftAgent.name} + ${config.rightAgent.name}`,
      backgroundColor: '#0c0c14',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'tandem', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Remove menu bar entirely on the tandem window
    tandemWindow.setMenu(null);

    ptyManager.setWindow(tandemWindow);
    tandemWindow.loadFile(path.join(__dirname, '..', 'tandem', 'index.html'));

    tandemWindow.on('closed', () => {
      ptyManager.destroyAll();
      tandemWindow = null;
      tandemConfig = null;
    });
  });

  // Tandem IPC handlers
  ipcMain.handle('tandem:get-config', () => tandemConfig);

  ipcMain.handle('tandem:create-terminal', (_e, opts: {
    terminalId: string; projectPath: string; command?: string; cols?: number; rows?: number;
  }) => {
    return ptyManager.create(opts);
  });

  ipcMain.on('tandem:terminal-input', (_e, terminalId: string, data: string) => {
    ptyManager.write(terminalId, data);
  });

  ipcMain.on('tandem:terminal-resize', (_e, terminalId: string, cols: number, rows: number) => {
    ptyManager.resize(terminalId, cols, rows);
  });

  ipcMain.on('tandem:destroy-terminal', (_e, terminalId: string) => {
    ptyManager.destroy(terminalId);
  });

  // IPC: copy text to system clipboard
  ipcMain.on('hypervault:copy-to-clipboard', (_e, text: string) => {
    clipboard.writeText(text);
  });

  // IPC: read clipboard text (for tandem terminal paste)
  ipcMain.handle('tandem:read-clipboard', () => {
    return clipboard.readText();
  });

  // IPC: detect which agent CLIs are installed on PATH
  ipcMain.handle('hypervault:detect-agents', async (_e, commands: string[]) => {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const results: Record<string, boolean> = {};
    await Promise.all(commands.map(cmd =>
      new Promise<void>(resolve => {
        execFile(whichCmd, [cmd], (err) => {
          results[cmd] = !err;
          resolve();
        });
      })
    ));
    return results;
  });

  // IPC: load agents config from userData
  ipcMain.handle('hypervault:load-agents-config', async () => {
    const configPath = path.join(app.getPath('userData'), 'agents.json');
    try {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  });

  // IPC: save agents config to userData
  ipcMain.on('hypervault:save-agents-config', (_e, config: unknown) => {
    const configPath = path.join(app.getPath('userData'), 'agents.json');
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      console.error('Failed to save agents config:', err);
    }
  });

  // macOS: re-create window if dock icon clicked with no windows
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (weatherCollector) {
    weatherCollector.stopPolling();
  }
  ptyManager.destroyAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
