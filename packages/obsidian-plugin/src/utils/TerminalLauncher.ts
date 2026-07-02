import { spawn } from 'child_process';
import { Platform } from 'obsidian';
import * as path from 'path';

export interface LaunchResult {
  success: boolean;
  message: string;
  platform: string;
}

export interface LaunchOptions {
  projectPath: string;
  command?: string;  // Default: 'claude'
  projectName?: string;
}

/**
 * Escape for the AppleScript double-quoted string layer: \ and " would
 * otherwise terminate/escape the script string itself.
 */
function escapeAppleScriptString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * POSIX shell single-quote escaping: close quote, escaped quote, reopen.
 * Wraps the value so the shell treats it as one literal argument.
 */
function shellQuote(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Spawn detached and resolve true once the process actually starts, false on
 * spawn failure (e.g. binary not found). spawn() errors are ASYNC — a
 * try/catch around spawn() never sees ENOENT, so fallbacks must wait for the
 * 'spawn'/'error' events.
 */
function spawnDetached(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      ...opts,
      detached: true,
      stdio: 'ignore',
    });
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
    child.once('error', () => resolve(false));
  });
}

/**
 * Cross-platform terminal launcher for launching Claude Code in project directories.
 * Supports Windows Terminal, macOS Terminal, and Linux terminals.
 */
export class TerminalLauncher {

  /**
   * Launch a terminal with Claude Code in the specified project directory.
   */
  static async launch(options: LaunchOptions): Promise<LaunchResult> {
    const { projectPath, command = 'claude', projectName } = options;
    const platform = this.getPlatform();


    try {
      switch (platform) {
        case 'windows':
          return await this.launchWindows(projectPath, command, projectName);
        case 'macos':
          return await this.launchMacOS(projectPath, command, projectName);
        case 'linux':
          return await this.launchLinux(projectPath, command, projectName);
        default:
          return {
            success: false,
            message: `Unsupported platform: ${platform}`,
            platform,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Hypernovum] Terminal launch failed:', message);
      return {
        success: false,
        message,
        platform,
      };
    }
  }

  /**
   * Get the current platform.
   */
  private static getPlatform(): 'windows' | 'macos' | 'linux' | 'unknown' {
    if (Platform.isWin) return 'windows';
    if (Platform.isMacOS) return 'macos';
    if (Platform.isLinux) return 'linux';
    return 'unknown';
  }

  /**
   * Launch Windows Terminal with Claude Code.
   * Falls back to cmd.exe if Windows Terminal isn't available.
   */
  private static async launchWindows(
    projectPath: string,
    command: string,
    projectName?: string
  ): Promise<LaunchResult> {
    // Normalize path for Windows
    const normalizedPath = projectPath.replace(/\//g, '\\');
    const title = projectName || path.basename(projectPath);

    // Try Windows Terminal first. Everything goes as argv — no shell:true, so
    // metacharacters in the path/title can't be interpreted by an outer shell.
    // (`command` is intentionally a command line; cmd /k runs it as such.)
    const wtOk = await spawnDetached('wt.exe', [
      '-d', normalizedPath,
      '--title', title,
      'cmd', '/k', command,
    ]);
    if (wtOk) {
      return {
        success: true,
        message: `Launched Windows Terminal in ${title}`,
        platform: 'windows',
      };
    }

    // Fallback: plain cmd window. cwd via options — nothing interpolated.
    const cmdOk = await spawnDetached('cmd.exe', ['/k', command], { cwd: normalizedPath });
    if (cmdOk) {
      return {
        success: true,
        message: `Launched cmd.exe in ${projectPath}`,
        platform: 'windows',
      };
    }

    return { success: false, message: 'Could not launch a terminal', platform: 'windows' };
  }

  /**
   * Launch macOS terminal with Claude Code.
   * Tries iTerm2 first, falls back to Terminal.app.
   */
  private static async launchMacOS(
    projectPath: string,
    command: string,
    projectName?: string
  ): Promise<LaunchResult> {
    // Two escaping layers: the inner SHELL command (path single-quoted so the
    // shell sees one literal), then the whole thing escaped for the
    // AppleScript double-quoted string it gets embedded in ('"' would
    // otherwise terminate the script string).
    const shellCommand = `cd ${shellQuote(projectPath)} && ${command}`;
    const cdAndRun = escapeAppleScriptString(shellCommand);

    // Try iTerm2 first — most popular macOS terminal for developers
    const iTermScript = `
      if application "iTerm" is running then
        tell application "iTerm"
          activate
          set newWindow to (create window with default profile)
          tell current session of newWindow
            write text "${cdAndRun}"
          end tell
        end tell
        return "ok"
      else
        return "not running"
      end if
    `;

    try {
      const iTermResult = await this.runOsascript(iTermScript);
      if (iTermResult === 'ok') {
        return {
          success: true,
          message: `Launched iTerm2 in ${projectName || projectPath}`,
          platform: 'macos',
        };
      }
    } catch {
      // iTerm2 not available, fall through
    }

    // Fallback: Terminal.app
    const terminalScript = `
      tell application "Terminal"
        activate
        do script "${cdAndRun}"
      end tell
    `;

    const ok = await spawnDetached('osascript', ['-e', terminalScript]);
    return {
      success: ok,
      message: ok
        ? `Launched Terminal.app in ${projectName || projectPath}`
        : 'Could not launch a terminal',
      platform: 'macos',
    };
  }

  /**
   * Run an AppleScript and return its stdout output (trimmed).
   */
  private static runOsascript(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.on('close', (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`osascript exited with code ${code}`));
      });
      child.on('error', reject);
    });
  }

  /**
   * Launch Linux terminal with Claude Code.
   * Tries common terminal emulators in order of preference.
   */
  private static async launchLinux(
    projectPath: string,
    command: string,
    projectName?: string
  ): Promise<LaunchResult> {
    // Common Linux terminal emulators in order of preference. Working
    // directory goes via flag or spawn cwd — the project path is never
    // interpolated into a shell string. (`command` is intentionally a command
    // line, executed by the inner bash -c.)
    const runCommand = `${command}; exec bash`;
    const terminals: { cmd: string; args: string[]; cwd?: string }[] = [
      { cmd: 'gnome-terminal', args: ['--working-directory', projectPath, '--', 'bash', '-c', runCommand] },
      { cmd: 'konsole', args: ['--workdir', projectPath, '-e', 'bash', '-c', runCommand] },
      { cmd: 'xfce4-terminal', args: ['--working-directory', projectPath, '-x', 'bash', '-c', runCommand] },
      { cmd: 'xterm', args: ['-e', 'bash', '-c', runCommand], cwd: projectPath },
    ];

    for (const terminal of terminals) {
      const ok = await spawnDetached(terminal.cmd, terminal.args, { cwd: terminal.cwd });
      if (ok) {
        return {
          success: true,
          message: `Launched ${terminal.cmd} in ${projectName || projectPath}`,
          platform: 'linux',
        };
      }
    }

    return {
      success: false,
      message: 'No supported terminal emulator found',
      platform: 'linux',
    };
  }

  /**
   * Open just the folder in the system file explorer.
   */
  static async openInExplorer(projectPath: string): Promise<LaunchResult> {
    const platform = this.getPlatform();

    try {
      switch (platform) {
        case 'windows':
          spawn('explorer', [projectPath.replace(/\//g, '\\')], { detached: true, stdio: 'ignore' }).unref();
          break;
        case 'macos':
          spawn('open', [projectPath], { detached: true, stdio: 'ignore' }).unref();
          break;
        case 'linux':
          spawn('xdg-open', [projectPath], { detached: true, stdio: 'ignore' }).unref();
          break;
        default:
          return { success: false, message: 'Unsupported platform', platform };
      }

      return { success: true, message: `Opened ${projectPath}`, platform };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message, platform };
    }
  }
}
