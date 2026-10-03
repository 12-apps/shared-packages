// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAttentionAlerts } from '../react/alerts';

/**
 * The gesture that unlocks audio schedules a check 250ms later. A host that
 * unmounts first must take that check with it: left running, it fired against
 * a torn-down page — in one adopter's suite, after jsdom was gone, as an
 * unhandled `window is not defined` that failed an unrelated shard.
 */
function Host(): null {
  useAttentionAlerts([], { sound: 'all', vibration: 'off' });
  return null;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the audio unlock check', () => {
  it('is cancelled when the host unmounts before it runs', () => {
    vi.useFakeTimers();
    const { unmount } = render(<Host />);
    fireEvent.click(document.body);
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('still runs while the host is mounted', () => {
    vi.useFakeTimers();
    render(<Host />);
    fireEvent.click(document.body);

    vi.advanceTimersByTime(250);

    expect(vi.getTimerCount()).toBe(0);
  });
});
