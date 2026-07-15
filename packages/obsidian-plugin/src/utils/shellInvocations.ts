/**
 * Pure terminal-invocation construction (no `obsidian` import, so unit-testable).
 * Used by TerminalLauncher.openShell (TRI-006).
 */

export interface ShellInvocation {
  cmd: string;
  args: string[];
  cwd?: string;
}

/**
 * Ordered terminal invocations that open a PLAIN interactive shell (no agent
 * command) in the project directory. macOS is handled separately (AppleScript,
 * not argv), so only 'windows' | 'linux' are built here.
 */
export function buildShellInvocations(
  platform: 'windows' | 'linux',
  projectPath: string,
): ShellInvocation[] {
  if (platform === 'windows') {
    const p = projectPath.replace(/\//g, '\\');
    return [
      { cmd: 'wt.exe', args: ['-d', p] },        // Windows Terminal, cwd via -d
      { cmd: 'cmd.exe', args: ['/k'], cwd: p },  // fallback: plain cmd, cwd via spawn
    ];
  }
  // linux — plain interactive shells, cwd via flag or spawn cwd
  return [
    { cmd: 'gnome-terminal', args: ['--working-directory', projectPath] },
    { cmd: 'konsole', args: ['--workdir', projectPath] },
    { cmd: 'xfce4-terminal', args: ['--working-directory', projectPath] },
    { cmd: 'xterm', args: [], cwd: projectPath },
  ];
}
