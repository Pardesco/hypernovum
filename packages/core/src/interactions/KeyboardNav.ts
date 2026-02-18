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
  private onJumpToProject: ((index: number) => void) | null = null;
  private onResetCamera: (() => void) | null = null;
  private onDebugFlow: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.canvas.tabIndex = 0; // Make canvas focusable

    this.canvas.addEventListener('focus', () => {
      this.isFocused = true;
      this.canvas.style.outline = '3px solid #00ffff';
    });

    this.canvas.addEventListener('blur', () => {
      this.isFocused = false;
      this.canvas.style.outline = 'none';
    });

    this.boundHandler = (e: KeyboardEvent) => this.handleKeyPress(e);
    document.addEventListener('keydown', this.boundHandler);
  }

  setHandlers(handlers: {
    onCycleBlocked?: () => void;
    onCycleStale?: () => void;
    onJumpToProject?: (index: number) => void;
    onResetCamera?: () => void;
    onDebugFlow?: () => void;
  }): void {
    this.onCycleBlocked = handlers.onCycleBlocked ?? null;
    this.onCycleStale = handlers.onCycleStale ?? null;
    this.onJumpToProject = handlers.onJumpToProject ?? null;
    this.onResetCamera = handlers.onResetCamera ?? null;
    this.onDebugFlow = handlers.onDebugFlow ?? null;
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
      case '1':
      case '2':
      case '3':
        event.preventDefault();
        this.onJumpToProject?.(parseInt(event.key) - 1);
        break;
      case ' ':
        event.preventDefault();
        this.onResetCamera?.();
        break;
      case 't':
      case 'T':
        event.preventDefault();
        this.onDebugFlow?.();
        break;
    }
  }

  dispose(): void {
    document.removeEventListener('keydown', this.boundHandler);
  }
}
