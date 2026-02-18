import { App, debounce } from 'obsidian';

/**
 * Watches vault metadata changes and debounces updates
 * to prevent constant re-renders when editing notes.
 */
export class MetadataExtractor {
  private app: App;
  private onUpdate: () => void;
  private debouncedUpdate: () => void;

  constructor(app: App, onUpdate: () => void, debounceMs = 2000) {
    this.app = app;
    this.onUpdate = onUpdate;
    this.debouncedUpdate = debounce(this.onUpdate, debounceMs, true);
  }

  /** Start watching for metadata changes */
  startWatching(): void {
    this.app.metadataCache.on('changed', this.handleChange);
    this.app.vault.on('rename', this.handleChange);
    this.app.vault.on('delete', this.handleChange);
    this.app.vault.on('create', this.handleChange);
  }

  /** Stop watching for metadata changes */
  stopWatching(): void {
    this.app.metadataCache.off('changed', this.handleChange);
    this.app.vault.off('rename', this.handleChange);
    this.app.vault.off('delete', this.handleChange);
    this.app.vault.off('create', this.handleChange);
  }

  private handleChange = (): void => {
    this.debouncedUpdate();
  };
}
