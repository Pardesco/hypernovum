import { describe, it, expect } from 'vitest';
import { LABEL_PRIORITY, labelPriority, resolveLabelCollisions, type LabelBox } from '../src/scene/labelCollision';

const box = (id: string, x: number, y: number, priority: number, width = 80, height = 18): LabelBox =>
  ({ id, x, y, width, height, priority });

describe('labelPriority (LBL-001)', () => {
  it('orders category > selected > hovered > pinned > critical/high > rest', () => {
    const order = [
      labelPriority({ isCategory: true }),
      labelPriority({ selected: true, projectPriority: 'low' }),
      labelPriority({ hovered: true }),
      labelPriority({ pinned: true }),
      labelPriority({ projectPriority: 'critical' }),
      labelPriority({ projectPriority: 'high' }),
      labelPriority({ projectPriority: 'medium' }),
      labelPriority({ projectPriority: 'low' }),
    ];
    expect([...order].sort((a, b) => b - a)).toEqual(order);
    expect(labelPriority({})).toBe(LABEL_PRIORITY.medium);
  });
});

describe('resolveLabelCollisions (LBL-001)', () => {
  it('keeps non-overlapping labels', () => {
    const v = resolveLabelCollisions([box('a', 0, 0, 40), box('b', 200, 0, 40), box('c', 0, 100, 40)]);
    expect([...v].sort()).toEqual(['a', 'b', 'c']);
  });

  it('a district label beats the building label it overlaps (TRADING vs Nova Checkout)', () => {
    const v = resolveLabelCollisions([
      box('Nova Checkout', 100, 100, labelPriority({ projectPriority: 'high' })),
      box('TRADING', 110, 105, labelPriority({ isCategory: true })),
    ]);
    expect([...v]).toEqual(['TRADING']);
  });

  it('the selected building wins over a critical one, and hovered over the rest', () => {
    const v = resolveLabelCollisions([
      box('critical', 0, 0, labelPriority({ projectPriority: 'critical' })),
      box('selected', 10, 0, labelPriority({ selected: true })),
      box('plain', 300, 0, labelPriority({})),
      box('hovered', 305, 2, labelPriority({ hovered: true })),
    ]);
    expect([...v].sort()).toEqual(['hovered', 'selected']);
  });

  it('is stable for equal priorities (first in input order wins)', () => {
    const v = resolveLabelCollisions([box('first', 0, 0, 40), box('second', 5, 0, 40)]);
    expect([...v]).toEqual(['first']);
  });

  it('treats padding as clearance', () => {
    // 80 px wide boxes 82 px apart: clear with pad 0, colliding with pad 2.
    expect(resolveLabelCollisions([box('a', 0, 0, 40), box('b', 82, 0, 40)], 0).size).toBe(2);
    expect(resolveLabelCollisions([box('a', 0, 0, 40), box('b', 82, 0, 40)], 2).size).toBe(1);
  });
});
