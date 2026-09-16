# Agent context handoff

Built-in bare `codex` and `claude` launchers receive an explicit instruction to read `.hypernovum/SETUP.md`. No permission flags, model selection, global config, or project AGENTS.md are modified. The Codex initial prompt reads context and waits for the task. Claude appends a short instruction while preserving its default prompt.

Custom commands (including commands with existing prompts/options) are left intact. For those, ask the agent to read `.hypernovum/SETUP.md` explicitly. Merely creating that file does not guarantee provider discovery.

Provider contracts checked 2026-09-16:
- https://learn.chatgpt.com/docs/developer-commands?surface=cli (base CLI positional PROMPT)
- https://code.claude.com/docs/en/cli-reference (`--append-system-prompt`)

These adapters do not infer acceptance from a process exit or Stop hook. Saved memory is historical evidence, not executable instructions.
