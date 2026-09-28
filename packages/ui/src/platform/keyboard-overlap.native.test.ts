import { describe, expect, it } from 'vitest';

import { keyboardOverlap } from './keyboard-overlap.native';

describe('keyboardOverlap (FUT-3021)', () => {
  it('is nothing until both the view and the keyboard have been measured', () => {
    expect(keyboardOverlap(null, null)).toBe(0);
    expect(keyboardOverlap(640, null)).toBe(0);
    expect(keyboardOverlap(null, 340)).toBe(0);
  });

  it('is the part of the view below the keyboard\'s top edge', () => {
    // Edge-to-edge: the window keeps the full 640 and the keyboard covers 300.
    expect(keyboardOverlap(640, 340)).toBe(300);
  });

  it('is nothing when the window already stops at, or above, the keyboard', () => {
    // A resized window ends where the keyboard starts; a status bar the window
    // sits under moves its bottom further up still.
    expect(keyboardOverlap(340, 340)).toBe(0);
    expect(keyboardOverlap(316, 340)).toBe(0);
  });
});
