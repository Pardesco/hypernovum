import { App, Modal, Setting } from 'obsidian';

export type AgentFeaturesConsent = 'granted' | 'denied';

/**
 * First-run consent. Hypernovum's agent layer runs local processes (`git`, a
 * binary probe, a terminal emulator, the configured agent CLI) and reads project
 * folders outside the vault. That's disclosed in the README, but it shouldn't
 * simply default to on — the user picks here, once.
 */
export class FirstRunModal extends Modal {
  private onChoose: (choice: AgentFeaturesConsent) => void | Promise<void>;
  private chosen = false;

  constructor(app: App, onChoose: (choice: AgentFeaturesConsent) => void | Promise<void>) {
    super(app);
    this.onChoose = onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hypernovum-firstrun');

    contentEl.createEl('h2', { text: 'Welcome to Hypernovum' });
    contentEl.createEl('p', {
      text:
        'Hypernovum renders your vault as a 3D city. It can also act as an agent-ops ' +
        'dashboard — which means running a few things on this machine.',
    });

    const list = contentEl.createEl('ul', { cls: 'hypernovum-firstrun-list' });
    for (const item of [
      'Runs read-only git commands in folders you link with projectDir.',
      'Checks whether claude / codex / agy are installed on your PATH.',
      'Opens a terminal and launches your chosen agent CLI when you ask it to.',
      'Reads SKILL.md files in your vault and in ~/.claude/skills/.',
      'Writes a .hypernovum/SETUP.md into a project folder when you launch an agent there.',
    ]) {
      list.createEl('li', { text: item });
    }

    contentEl.createEl('p', {
      cls: 'hypernovum-firstrun-note',
      text: 'Hypernovum makes no network requests: no telemetry, no analytics, no remote calls.',
    });
    contentEl.createEl('p', {
      text:
        'Choosing "Visualization only" turns vault mode on: none of the above runs, ' +
        'and the actions that would are hidden. Turn vault mode off in ' +
        'Settings → Hypernovum at any point to enable the agent layer.',
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Visualization only')
          .onClick(() => this.choose('denied')),
      )
      .addButton((btn) =>
        btn
          .setButtonText('Enable agent features')
          .setCta()
          .onClick(() => this.choose('granted')),
      );
  }

  private choose(choice: AgentFeaturesConsent): void {
    this.chosen = true;
    void this.onChoose(choice);
    this.close();
  }

  onClose(): void {
    // Dismissing without choosing is the conservative answer, not a re-prompt loop.
    if (!this.chosen) void this.onChoose('denied');
    this.contentEl.empty();
  }
}
