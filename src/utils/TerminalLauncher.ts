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
 * Escape a string for safe embedding in AppleScript single-quoted strings.
 * Replaces \ with \\ and ' with '\'' (end quote, escaped quote, start quote).
 */
function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
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

    console.log(`[Hypervault] Launching terminal for: ${projectPath} on ${platform}`);

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
      console.error('[Hypervault] Terminal launch failed:', message);
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

    // Try Windows Terminal first (wt), fall back to cmd
    try {
      // Windows Terminal with tab title
      const title = projectName || path.basename(projectPath);
      const child = spawn('wt', [
        '-d', normalizedPath,
        '--title', title,
        'cmd', '/k', command
      ], {
        detached: true,
        stdio: 'ignore',
        shell: true,
      });
      child.unref();

      return {
        success: true,
        message: `Launched Windows Terminal in ${title}`,
        platform: 'windows',
      };
    } catch (wtError) {
      // Fallback to basic cmd
      console.log('[Hypervault] Windows Terminal not found, using cmd.exe');

      const child = spawn('cmd', [
        '/c', 'start', 'cmd', '/k',
        `cd /d "${normalizedPath}" && ${command}`
      ], {
        detached: true,
        stdio: 'ignore',
        shell: true,
      });
      child.unref();

      return {
        success: true,
        message: `Launched cmd.exe in ${projectPath}`,
        platform: 'windows',
      };
    }
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
    const safePath = escapeAppleScript(projectPath);
    const safeCommand = escapeAppleScript(command);
    const cdAndRun = `cd '${safePath}' && ${safeCommand}`;

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
        do script "cd '${safePath}' && ${safeCommand}"
      end tell
    `;

    const child = spawn('osascript', ['-e', terminalScript], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return {
      success: true,
      message: `Launched Terminal.app in ${projectName || projectPath}`,
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
    // Common Linux terminal emulators in order of preference
    const terminals = [
      { cmd: 'gnome-terminal', args: ['--working-directory', projectPath, '--', 'bash', '-c', `${command}; exec bash`] },
      { cmd: 'konsole', args: ['--workdir', projectPath, '-e', 'bash', '-c', `${command}; exec bash`] },
      { cmd: 'xfce4-terminal', args: ['--working-directory', projectPath, '-e', `bash -c "${command}; exec bash"`] },
      { cmd: 'xterm', args: ['-e', `cd "${projectPath}" && ${command} && bash`] },
    ];

    for (const terminal of terminals) {
      try {
        const child = spawn(terminal.cmd, terminal.args, {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();

        return {
          success: true,
          message: `Launched ${terminal.cmd} in ${projectName || projectPath}`,
          platform: 'linux',
        };
      } catch {
        // Try next terminal
        continue;
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
