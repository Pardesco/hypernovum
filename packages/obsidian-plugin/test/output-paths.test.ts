import { describe, expect, it } from 'vitest';
import { uniqueOutputName } from '../src/utils/outputPaths';

describe('uniqueOutputName', () => {
  it('returns the plain name when nothing is taken', () => {
    expect(uniqueOutputName('Snapshot 2026-07-25', '.png', () => false)).toBe(
      'Snapshot 2026-07-25.png',
    );
  });

  it('suffixes rather than overwriting an existing file', () => {
    // The snapshot action used to write a fixed per-day filename straight to the
    // vault root, silently replacing the previous capture.
    const taken = new Set(['Snapshot.png']);
    expect(uniqueOutputName('Snapshot', '.png', (c) => taken.has(c))).toBe('Snapshot-2.png');
  });

  it('keeps counting past the first collision', () => {
    const taken = new Set(['S.png', 'S-2.png', 'S-3.png']);
    expect(uniqueOutputName('S', '.png', (c) => taken.has(c))).toBe('S-4.png');
  });

  it('accepts an extension with or without the dot', () => {
    expect(uniqueOutputName('a', 'png', () => false)).toBe('a.png');
    expect(uniqueOutputName('a', '.png', () => false)).toBe('a.png');
  });

  it('gives up after the limit instead of looping forever', () => {
    const result = uniqueOutputName('x', '.png', () => true, 3);
    expect(result).toBe('x-3.png');
  });
});
