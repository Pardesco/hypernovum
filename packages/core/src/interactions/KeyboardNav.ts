/**
 * Focus-aware keyboard navigation.
 * Shortcuts only activate when the 3D canvas has focus,
 * preventing input leakage into background Obsidian notes.
 */
export class KeyboardNav {
  private canvas: HTMLCanvasElement;
  private isFocused = false;
  private boundHandler: (e: KeyboardEvent) => void;

  // Callbacks
  private onCycleBlocked: (() => void) | null = null;
  private onCycleStale: (() => void) | null = null;
  private onResetCamera: (() => void) | null = null;
  private onEscape: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.tabIndex = 0; // Make canvas focusable

    // Focus ring is styled in styles.css via :focus-visible so mouse clicks
    // don't paint an outline around the entire viewport.
    this.canvas.addEventListener('focus', () => {
      this.isFocused = true;
    });

    this.canvas.addEventListener('blur', () => {
      this.isFocused = false;
    });

    this.boundHandler = (e: KeyboardEvent) => this.handleKeyPress(e);
    document.addEventListener('keydown', this.boundHandler);
  }

  setHandlers(handlers: {
    onCycleBlocked?: () => void;
    onCycleStale?: () => void;
    onResetCamera?: () => void;
    onEscape?: () => void;
  }): void {
    this.onCycleBlocked = handlers.onCycleBlocked ?? null;
    this.onCycleStale = handlers.onCycleStale ?? null;
    this.onResetCamera = handlers.onResetCamera ?? null;
    this.onEscape = handlers.onEscape ?? null;
  }

  private handleKeyPress(event: KeyboardEvent): void {
    if (document.activeElement !== this.canvas) return;

    switch (event.key) {
      case 'b':
        event.preventDefault();
        this.onCycleBlocked?.();
        break;
      case 's':
        event.preventDefault();
        this.onCycleStale?.();
        break;
      case ' ':
        event.preventDefault();
        this.onResetCamera?.();
        break;
      case 'Escape':
        event.preventDefault();
        this.onEscape?.();
        break;
    }
  }

  dispose(): void {
    document.removeEventListener('keydown', this.boundHandler);
  }
}
