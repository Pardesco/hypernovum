import { App, Modal, Notice, Setting } from 'obsidian';
import {
  buildClaudeHookJson,
  buildManualPingCommand,
  type HeartbeatPaths,
} from '../utils/heartbeatDocs';

type InstallAction = 'created' | 'updated' | 'current';

const ACTION_TEXT: Record<InstallAction, string> = {
  created: 'Heartbeat script installed.',
  updated: 'Heartbeat script updated to the current version.',
  current: 'Heartbeat script is already up to date.',
};

/**
 * Shows the resolved heartbeat wiring after installing the script: the hook JSON
 * to merge into ~/.claude/settings.json, plus a one-liner to test with first.
 *
 * We deliberately do NOT write to ~/.claude/settings.json ourselves — that's the
 * user's global agent config, outside the vault, and silently editing it isn't
 * something a vault plugin should do. Copy buttons, not automatic merges.
 */
export class HeartbeatHooksModal extends Modal {
  private paths: HeartbeatPaths;
  private action: InstallAction;

  constructor(app: App, paths: HeartbeatPaths, action: InstallAction) {
    super(app);
    this.paths = paths;
    this.action = action;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hypernovum-hooks-modal');

    contentEl.createEl('h2', { text: 'Agent heartbeat hooks' });
    contentEl.createEl('p', { text: ACTION_TEXT[this.action] });

    const pathRow = contentEl.createDiv({ cls: 'hypernovum-hooks-path' });
    pathRow.createSpan({ text: 'Script: ' });
    pathRow.createEl('code', { text: this.paths.scriptPath });

    contentEl.createEl('h3', { text: '1 · Test it' });
    contentEl.createEl('p', {
      text:
        'Run this in a terminal, then open the code city — an orb should appear on the ' +
        'matching building for about 10 seconds.',
    });
    this.addCopyBlock(
      contentEl,
      buildManualPingCommand(this.paths, 'My Project'),
      'Copy test command',
    );

    contentEl.createEl('h3', { text: '2 · Wire it into Claude Code' });
    contentEl.createEl('p', {
      text: 'Merge this into ~/.claude/settings.json to report every session automatically.',
    });
    this.addCopyBlock(contentEl, buildClaudeHookJson(this.paths), 'Copy hook JSON');

    contentEl.createEl('p', {
      cls: 'hypernovum-hooks-note',
      text:
        'Other agents work the same way — call the script from any hook or wrapper, ' +
        'passing a stable --id per session. See AGENTS.md for the full flag reference.',
    });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText('Done').setCta().onClick(() => this.close()),
    );
  }

  private addCopyBlock(parent: HTMLElement, text: string, buttonLabel: string): void {
    const block = parent.createDiv({ cls: 'hypernovum-hooks-block' });
    const pre = block.createEl('pre');
    pre.createEl('code', { text });
    const btn = block.createEl('button', { cls: 'hypernovum-hooks-copy', text: buttonLabel });
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(text);
      new Notice('Copied to clipboard');
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
