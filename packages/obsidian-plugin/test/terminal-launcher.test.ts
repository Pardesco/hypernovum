import { describe, it, expect } from 'vitest';
import { buildShellInvocations } from '../src/utils/shellInvocations';

describe('buildShellInvocations (TRI-006, no agent command)', () => {
  it('windows: wt with -d, then cmd /k with cwd, backslash-normalized', () => {
    const inv = buildShellInvocations('windows', 'C:/repos/app');
    expect(inv[0]).toEqual({ cmd: 'wt.exe', args: ['-d', 'C:\\repos\\app'] });
    expect(inv[1]).toEqual({ cmd: 'cmd.exe', args: ['/k'], cwd: 'C:\\repos\\app' });
    // no agent command anywhere
    expect(JSON.stringify(inv)).not.toContain('claude');
  });

  it('linux: interactive shells with the dir via flag or cwd, no bash -c wrapper', () => {
    const inv = buildShellInvocations('linux', '/home/u/app');
    expect(inv[0]).toEqual({ cmd: 'gnome-terminal', args: ['--working-directory', '/home/u/app'] });
    expect(inv.find((i) => i.cmd === 'xterm')).toEqual({ cmd: 'xterm', args: [], cwd: '/home/u/app' });
    // no 'bash -c' run wrapper (that was the agent-launch path)
    expect(inv.some((i) => i.args.includes('-c'))).toBe(false);
  });
});
