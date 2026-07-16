import { describe, it, expect } from 'vitest';
import { collectImpact } from '../src/graph/traverse';
import type { GraphEdge } from '../src/types';

// depends-on X→Y means X depends on Y (Y is upstream/prerequisite of X).
const dep = (from: string, to: string): GraphEdge =>
  ({ from, to, type: 'depends-on', direction: 'directed', source: 'deterministic' });
// blocked-by X→Y means X blocks Y (X is upstream/prerequisite of Y).
const block = (from: string, to: string): GraphEdge =>
  ({ from, to, type: 'blocked-by', direction: 'directed', source: 'deterministic' });
const backlink = (from: string, to: string): GraphEdge =>
  ({ from, to, type: 'backlink', direction: 'undirected', source: 'deterministic' });

const paths = (nodes: { path: string }[]) => nodes.map((n) => n.path).sort();

describe('collectImpact', () => {
  it('separates upstream (dependencies) from downstream (dependents)', () => {
    // app depends on lib; ui depends on app.  origin = app
    const r = collectImpact([dep('app', 'lib'), dep('ui', 'app')], 'app');
    expect(paths(r.upstream)).toEqual(['lib']);     // app needs lib
    expect(paths(r.downstream)).toEqual(['ui']);    // ui needs app
    expect(r.truncated).toBe(false);
  });

  it('records depth per node', () => {
    // a→b→c→d (each depends on the next). origin=a → upstream b(1) c(2) d(3)
    const r = collectImpact([dep('a', 'b'), dep('b', 'c'), dep('c', 'd')], 'a', { maxDepth: 5 });
    expect(r.upstream).toEqual([
      { path: 'b', depth: 1 }, { path: 'c', depth: 2 }, { path: 'd', depth: 3 },
    ]);
  });

  it('blocked-by contributes: blocker is upstream, blocked is downstream', () => {
    // x blocks y. origin=y → upstream x; origin=x → downstream y
    expect(paths(collectImpact([block('x', 'y')], 'y').upstream)).toEqual(['x']);
    expect(paths(collectImpact([block('x', 'y')], 'x').downstream)).toEqual(['y']);
  });

  it('ignores backlink/agent edges', () => {
    const r = collectImpact([backlink('a', 'b')], 'a');
    expect(r.upstream).toEqual([]);
    expect(r.downstream).toEqual([]);
  });

  it('is cycle-safe (a→b→a)', () => {
    const r = collectImpact([dep('a', 'b'), dep('b', 'a')], 'a', { maxDepth: 10 });
    expect(paths(r.upstream)).toEqual(['b']); // b, then b→a loops back to origin (excluded)
    expect(r.truncated).toBe(false);
  });

  it('handles diamonds without double-counting', () => {
    // a→b, a→c, b→d, c→d
    const r = collectImpact([dep('a', 'b'), dep('a', 'c'), dep('b', 'd'), dep('c', 'd')], 'a', { maxDepth: 5 });
    expect(paths(r.upstream)).toEqual(['b', 'c', 'd']);
    expect(r.upstream.find((n) => n.path === 'd')?.depth).toBe(2); // shallowest depth
  });

  it('truncates at maxDepth and flags it', () => {
    const r = collectImpact([dep('a', 'b'), dep('b', 'c'), dep('c', 'd')], 'a', { maxDepth: 2 });
    expect(paths(r.upstream)).toEqual(['b', 'c']); // d is beyond depth 2
    expect(r.truncated).toBe(true);
  });

  it('does NOT flag truncation when the graph ends exactly at maxDepth', () => {
    const r = collectImpact([dep('a', 'b'), dep('b', 'c')], 'a', { maxDepth: 2 });
    expect(paths(r.upstream)).toEqual(['b', 'c']);
    expect(r.truncated).toBe(false);
  });

  it('truncates at maxNodes', () => {
    const edges = ['b', 'c', 'd', 'e'].map((t) => dep('a', t));
    const r = collectImpact(edges, 'a', { maxNodes: 2 });
    expect(r.upstream.length).toBe(2);
    expect(r.truncated).toBe(true);
  });

  it('returns empty for a disconnected origin', () => {
    const r = collectImpact([dep('x', 'y')], 'lonely');
    expect(r.upstream).toEqual([]);
    expect(r.downstream).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it('collects the traversed edges for highlighting', () => {
    const edges = [dep('app', 'lib'), dep('ui', 'app')];
    const r = collectImpact(edges, 'app');
    expect(r.edges).toContain(edges[0]);
    expect(r.edges).toContain(edges[1]);
  });
});
