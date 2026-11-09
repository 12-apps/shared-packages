import { describe, expect, it } from 'vitest';

import { classifySwipe, swipeAxis } from './swipe';

describe('swipeAxis', () => {
  it('picks the axis that moved further, vertical on a tie', () => {
    expect(swipeAxis(30, 10)).toBe('x');
    expect(swipeAxis(-5, 40)).toBe('y');
    expect(swipeAxis(10, 10)).toBe('y');
  });
});

describe('classifySwipe', () => {
  const distance = 50;

  it('reads direction on the dominant axis once past the distance', () => {
    expect(classifySwipe({ deltaX: -80, deltaY: 10, distance })).toBe('left');
    expect(classifySwipe({ deltaX: 80, deltaY: -10, distance })).toBe('right');
    expect(classifySwipe({ deltaX: 5, deltaY: 90, distance })).toBe('down');
    expect(classifySwipe({ deltaX: 5, deltaY: -90, distance })).toBe('up');
  });

  it('is null for a nudge, or when the other axis dominates a short travel', () => {
    expect(classifySwipe({ deltaX: 30, deltaY: 0, distance })).toBeNull();
    expect(classifySwipe({ deltaX: 40, deltaY: 45, distance })).toBeNull();
  });

  it('accepts a short, fast fling only when the elapsed time is given', () => {
    expect(classifySwipe({ deltaX: -30, deltaY: 0, distance, elapsed: 40 })).toBe('left');
    expect(classifySwipe({ deltaX: -30, deltaY: 0, distance, elapsed: 400 })).toBeNull();
    expect(classifySwipe({ deltaX: -5, deltaY: 0, distance, elapsed: 5 })).toBeNull();
  });
});
