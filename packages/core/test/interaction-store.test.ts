import { describe, it, expect } from 'vitest';
import { createInteractionStore } from '../src/stores/interactionStore';

describe('interactionStore', () => {
  it('select → hover → clear leaves a clean state', () => {
    const store = createInteractionStore();
    const s = () => store.getState();

    s().select('a.md');
    s().hover('b.md');
    expect(s().selectedPath).toBe('a.md');
    expect(s().hoveredPath).toBe('b.md');

    s().clearSelection();
    expect(s().selectedPath).toBeNull();
    expect(s().traceImpact).toBeNull();
    // Hover is transient and NOT cleared by clearSelection
    expect(s().hoveredPath).toBe('b.md');
  });

  it('clearSelection clears trace impact with the selection', () => {
    const store = createInteractionStore();
    store.getState().select('a.md');
    store.getState().setTraceImpact({ originPath: 'a.md' });
    store.getState().clearSelection();
    expect(store.getState().traceImpact).toBeNull();
  });

  it('move mode enter/exit round-trips', () => {
    const store = createInteractionStore();
    store.getState().enterMoveMode('a.md');
    expect(store.getState().moveModePath).toBe('a.md');
    store.getState().exitMoveMode();
    expect(store.getState().moveModePath).toBeNull();
  });

  it('notifies subscribers on selection change only when it changes', () => {
    const store = createInteractionStore();
    let calls = 0;
    store.subscribe((state, prev) => {
      if (state.selectedPath !== prev.selectedPath) calls++;
    });
    store.getState().select('a.md');
    store.getState().hover('x.md');   // must not count
    store.getState().select('b.md');
    store.getState().clearSelection();
    expect(calls).toBe(3);
  });
});
