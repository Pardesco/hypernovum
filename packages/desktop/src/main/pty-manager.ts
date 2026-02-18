import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';

interface PtySession {
  id: string;
  process: pty.IPty;
}

/** Clean env for spawned terminals — strips CLAUDECODE to avoid nested-session errors */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();
  private window: BrowserWindow | null = null;

  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  create(opts: {
    terminalId: string;
    projectPath: string;
    command?: string;
    cols?: number;
    rows?: number;
  }): { ok: boolean; error?: string } {
    try {
      const shell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
      const args = process.platform === 'win32' ? [] : [];
      const env = cleanEnv();

      const term = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: opts.cols || 80,
        rows: opts.rows || 24,
        cwd: opts.projectPath,
        env: env as { [key: string]: string },
      });

      const session: PtySession = { id: opts.terminalId, process: term };
      this.sessions.set(opts.terminalId, session);

      // Stream pty output to renderer (guard against destroyed window)
      term.onData((data: string) => {
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send('pty:data', opts.terminalId, data);
        }
      });

      term.onExit(({ exitCode }: { exitCode: number }) => {
        if (this.window && !this.window.isDestroyed()) {
          this.window.webContents.send('pty:exit', opts.terminalId, exitCode);
        }
        this.sessions.delete(opts.terminalId);
      });

      // If a command was specified, send it after shell starts
      if (opts.command) {
        setTimeout(() => {
          term.write(opts.command + '\r');
        }, 300);
      }

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  write(terminalId: string, data: string): void {
    this.sessions.get(terminalId)?.process.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    try {
      this.sessions.get(terminalId)?.process.resize(cols, rows);
    } catch { /* ignore resize errors */ }
  }

  destroy(terminalId: string): void {
    const session = this.sessions.get(terminalId);
    if (session) {
      session.process.kill();
      this.sessions.delete(terminalId);
    }
  }

  destroyAll(): void {
    for (const session of this.sessions.values()) {
      session.process.kill();
    }
    this.sessions.clear();
  }
}
