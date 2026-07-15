import { createStore, type StoreApi } from 'zustand/vanilla';

/**
 * Trace-impact overlay state (populated in Phase 5; the slot exists now so
 * the store shape is stable for HighlightManager).
 */
export interface TraceImpactState {
  originPath: string;
}

/**
 * Single source of truth for graph interaction state. Owned by the view,
 * shared with SceneManager and HighlightManager. Stores project note PATHS,
 * never ProjectData objects — paths survive city rebuilds, stale object
 * references do not.
 */
export interface InteractionState {
  /** Persistently focused project (single-click) */
  selectedPath: string | null;
  /** Transient hover (building or its foundation) */
  hoveredPath: string | null;
  /** Transient agent-orb hover (mutually exclusive with hoveredPath in UI) */
  hoveredAgentId: string | null;
  /** Building currently in explicit move mode */
  moveModePath: string | null;
  /** Trace-impact overlay, null when inactive */
  traceImpact: TraceImpactState | null;

  select(path: string | null): void;
  hover(path: string | null): void;
  hoverAgent(id: string | null): void;
  enterMoveMode(path: string): void;
  exitMoveMode(): void;
  setTraceImpact(trace: TraceImpactState | null): void;
  /** Clears selection AND trace overlay (Escape / empty-space click) */
  clearSelection(): void;
}

export type InteractionStore = StoreApi<InteractionState>;

export const createInteractionStore = (): InteractionStore =>
  createStore<InteractionState>((set) => ({
    selectedPath: null,
    hoveredPath: null,
    hoveredAgentId: null,
    moveModePath: null,
    traceImpact: null,

    select: (path) => set({ selectedPath: path }),
    hover: (path) => set({ hoveredPath: path }),
    hoverAgent: (id) => set({ hoveredAgentId: id }),
    enterMoveMode: (path) => set({ moveModePath: path }),
    exitMoveMode: () => set({ moveModePath: null }),
    setTraceImpact: (trace) => set({ traceImpact: trace }),
    clearSelection: () => set({ selectedPath: null, traceImpact: null }),
  }));
