/** Agent data model for the Agents Panel */

export interface Agent {
  id: string;
  name: string;
  command: string;
  color: string;
  icon: string;
  builtin: boolean;
  detected: boolean;
  installHint?: string;
  /** Whether this agent runs in a terminal (CLI). Non-terminal agents are excluded from tandem. */
  terminalBased?: boolean;
}

export interface AgentsConfig {
  activeAgentId: string | null;
  customAgents: Agent[];
  hiddenBuiltins: string[];
  agentOrder: string[];
}

export const KNOWN_AGENTS: Omit<Agent, 'detected'>[] = [
  { id: 'claude',      name: 'Claude Code',  command: 'claude',      color: '#da7756', icon: 'C', builtin: true, terminalBased: true,  installHint: 'npm i -g @anthropic-ai/claude-code' },
  { id: 'antigravity', name: 'Antigravity',  command: 'antigravity', color: '#4285f4', icon: 'A', builtin: true, terminalBased: false, installHint: 'npm i -g antigravity' },
  { id: 'gemini',      name: 'Gemini CLI',   command: 'gemini',      color: '#4285f4', icon: 'G', builtin: true, terminalBased: true,  installHint: 'npm i -g @google/gemini-cli' },
  { id: 'codex',       name: 'Codex CLI',    command: 'codex',       color: '#10a37f', icon: 'X', builtin: true, terminalBased: true,  installHint: 'npm i -g @openai/codex' },
  { id: 'cursor',      name: 'Cursor',       command: 'cursor',      color: '#7c3aed', icon: 'U', builtin: true, terminalBased: false, installHint: 'Download from cursor.com' },
  { id: 'aider',       name: 'Aider',        command: 'aider',       color: '#14b8a6', icon: 'A', builtin: true, terminalBased: true,  installHint: 'pipx install aider-chat' },
];

export const DEFAULT_AGENTS_CONFIG: AgentsConfig = {
  activeAgentId: null,
  customAgents: [],
  hiddenBuiltins: [],
  agentOrder: [],
};
