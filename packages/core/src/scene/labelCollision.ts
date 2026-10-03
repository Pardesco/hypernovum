/**
 * Greedy screen-space label collision (LBL-001). Pure, so it is tested.
 *
 * District and building labels overlapped at default zoom (the TRADING label
 * sat under Nova Checkout in the demo vault). Each label tick, candidate
 * labels are placed in priority order and any label that would overlap one
 * already placed is hidden for that tick.
 */

/** A label's screen rectangle (CSS px, centre-anchored like CSS2DObject). */
export interface LabelBox {
  id: string;
  /** Centre. */
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
}

/**
 * Priority order (higher wins): district labels, then the selected building,
 * then the hovered one, then labels pinned by context (connected to the
 * selection, warnings, trace), then critical/high priority projects, then the
 * rest.
 */
export const LABEL_PRIORITY = {
  category: 100,
  selected: 90,
  hovered: 80,
  pinned: 70,
  critical: 60,
  high: 50,
  medium: 40,
  low: 30,
} as const;

export function labelPriority(input: {
  isCategory?: boolean;
  selected?: boolean;
  hovered?: boolean;
  pinned?: boolean;
  projectPriority?: string;
}): number {
  if (input.isCategory) return LABEL_PRIORITY.category;
  if (input.selected) return LABEL_PRIORITY.selected;
  if (input.hovered) return LABEL_PRIORITY.hovered;
  if (input.pinned) return LABEL_PRIORITY.pinned;
  switch (input.projectPriority) {
    case 'critical': return LABEL_PRIORITY.critical;
    case 'high': return LABEL_PRIORITY.high;
    case 'low': return LABEL_PRIORITY.low;
    default: return LABEL_PRIORITY.medium;
  }
}

/**
 * Ids of the labels that stay visible. Higher priority places first; ties keep
 * input order (stable), so labels don't flicker between ticks. `pad` is extra
 * clearance in pixels around every box.
 */
export function resolveLabelCollisions(boxes: readonly LabelBox[], pad = 2): Set<string> {
  const order = boxes
    .map((b, i) => ({ b, i }))
    .sort((a, b) => b.b.priority - a.b.priority || a.i - b.i);
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const visible = new Set<string>();
  for (const { b } of order) {
    const r = {
      x0: b.x - b.width / 2 - pad,
      y0: b.y - b.height / 2 - pad,
      x1: b.x + b.width / 2 + pad,
      y1: b.y + b.height / 2 + pad,
    };
    let hit = false;
    for (const p of placed) {
      if (r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0) { hit = true; break; }
    }
    if (hit) continue;
    placed.push(r);
    visible.add(b.id);
  }
  return visible;
}
