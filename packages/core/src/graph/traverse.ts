import type { GraphEdge } from '../types';

/**
 * Bounded, cycle-safe impact traversal (IMP-001, §7.10).
 *
 * Directed edges are normalized to a prerequisite → dependent relation:
 *   - depends-on  (dependent → dependency):  prereq = to,   dependent = from
 *   - blocked-by  (blocker   → blocked):     prereq = from, dependent = to
 * Backlink (undirected) and agent edges are ignored — impact is a dependency
 * question. `upstream` = the origin's prerequisites (what it needs);
 * `downstream` = its dependents (what it affects). Both walks are visited-set
 * guarded (cycles safe) and capped by depth and total node count.
 */

export interface TraceNode {
  path: string;
  depth: number;
}

export interface TraceImpactResult {
  origin: string;
  upstream: TraceNode[];    // dependencies / blockers
  downstream: TraceNode[];  // dependents / blocked
  edges: GraphEdge[];       // directed edges touched on the traced paths
  truncated: boolean;
}

export interface TraceOptions {
  maxDepth?: number;
  maxNodes?: number;
}

interface NormalizedEdge {
  prereq: string;
  dependent: string;
  edge: GraphEdge;
}

function push(map: Map<string, NormalizedEdge[]>, key: string, value: NormalizedEdge): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

export function collectImpact(
  edges: GraphEdge[],
  origin: string,
  opts: TraceOptions = {},
): TraceImpactResult {
  const maxDepth = opts.maxDepth ?? 3;
  const maxNodes = opts.maxNodes ?? 50;

  // Adjacency: upstream walks dependent → prereq; downstream walks prereq → dependent.
  const up = new Map<string, NormalizedEdge[]>();
  const down = new Map<string, NormalizedEdge[]>();
  for (const e of edges) {
    let n: NormalizedEdge | null = null;
    if (e.type === 'depends-on') n = { prereq: e.to, dependent: e.from, edge: e };
    else if (e.type === 'blocked-by') n = { prereq: e.from, dependent: e.to, edge: e };
    if (!n) continue;
    push(up, n.dependent, n);
    push(down, n.prereq, n);
  }

  const usedEdges = new Set<GraphEdge>();
  const budget = { remaining: maxNodes };
  let truncated = false;

  const walk = (adj: Map<string, NormalizedEdge[]>, next: (n: NormalizedEdge) => string): TraceNode[] => {
    const found = new Map<string, number>(); // path → shallowest depth
    let frontier = [origin];
    let depth = 0;

    while (frontier.length > 0) {
      depth++;
      if (depth > maxDepth) {
        // Stopped at the depth cap — truncated iff any new node lies beyond it.
        for (const node of frontier) {
          for (const n of adj.get(node) ?? []) {
            const t = next(n);
            if (t !== origin && !found.has(t)) { truncated = true; break; }
          }
          if (truncated) break;
        }
        break;
      }

      const nextFrontier: string[] = [];
      for (const node of frontier) {
        for (const n of adj.get(node) ?? []) {
          const target = next(n);
          usedEdges.add(n.edge);
          if (target === origin || found.has(target)) continue;
          if (budget.remaining <= 0) { truncated = true; continue; }
          found.set(target, depth);
          budget.remaining--;
          nextFrontier.push(target);
        }
      }
      frontier = nextFrontier;
    }

    return [...found.entries()]
      .map(([path, d]) => ({ path, depth: d }))
      .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  };

  const upstream = walk(up, (n) => n.prereq);
  const downstream = walk(down, (n) => n.dependent);

  return { origin, upstream, downstream, edges: [...usedEdges], truncated };
}
