import { describe, expect, it } from 'vitest';

import { overflowOf } from './Button.native';

// FUT-3775: a clipped Android button that turned enabled painted its fill and
// no label. Android never clips; iOS and the web keep the ripple's clip unless
// the pulse or the glow needs room outside the box.
describe('Button (native) overflow', () => {
  it('never clips on Android, pulse or not', () => {
    expect(overflowOf(false, 'android')).toBe('visible');
    expect(overflowOf(true, 'android')).toBe('visible');
  });

  it('clips elsewhere unless the pulse or the glow needs the room', () => {
    expect(overflowOf(false, 'ios')).toBe('hidden');
    expect(overflowOf(false, 'web')).toBe('hidden');
    expect(overflowOf(true, 'ios')).toBe('visible');
  });
});
