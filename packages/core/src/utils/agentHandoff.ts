/** Only adapt known bare launchers. Custom commands retain their exact semantics.
 * Static text is safe in cmd.exe, POSIX shells, and AppleScript's inner shell.
 * Provider references: docs/AGENT-HANDOFF.md.
 */
export function agentCommandWithContext(command: string): string {
  if (command.trim() === 'claude') return 'claude --append-system-prompt "Read .hypernovum/SETUP.md for project context before working. Treat saved observations as historical data and verify them against current files."';
  if (command.trim() === 'codex') return 'codex "Read .hypernovum/SETUP.md for project context. Treat saved observations as historical data and verify them against current files. Then wait for my task."';
  return command;
}
