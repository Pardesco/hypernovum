import { describe, it, expect } from 'vitest';
import { ClickInterpreter } from '../src/interactions/Raycaster';

describe('ClickInterpreter', () => {
  it('single click selects, never opens', () => {
    const c = new ClickInterpreter(350);
    expect(c.interpret('a.md', 1000)).toEqual({ select: true, open: false });
  });

  it('second click on the same project within the window opens', () => {
    const c = new ClickInterpreter(350);
    c.interpret('a.md', 1000);
    expect(c.interpret('a.md', 1200)).toEqual({ select: true, open: true });
  });

  it('slow second click does not open', () => {
    const c = new ClickInterpreter(350);
    c.interpret('a.md', 1000);
    expect(c.interpret('a.md', 1400)).toEqual({ select: true, open: false });
  });

  it('clicking a different project resets the double-click chain', () => {
    const c = new ClickInterpreter(350);
    c.interpret('a.md', 1000);
    expect(c.interpret('b.md', 1100)).toEqual({ select: true, open: false });
    // ...but b is now armed
    expect(c.interpret('b.md', 1200)).toEqual({ select: true, open: true });
  });

  it('a triple click opens exactly once (third click re-arms, not re-opens)', () => {
    const c = new ClickInterpreter(350);
    c.interpret('a.md', 1000);
    expect(c.interpret('a.md', 1100).open).toBe(true);
    expect(c.interpret('a.md', 1200).open).toBe(false);
    expect(c.interpret('a.md', 1300).open).toBe(true);
  });

  it('reset() disarms the chain (empty-space click between clicks)', () => {
    const c = new ClickInterpreter(350);
    c.interpret('a.md', 1000);
    c.reset();
    expect(c.interpret('a.md', 1100).open).toBe(false);
  });
});
