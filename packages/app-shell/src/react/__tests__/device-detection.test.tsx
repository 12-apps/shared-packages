// @vitest-environment jsdom
/**
 * The hook, and the reason it is a hook at all.
 *
 * The Apple sign-in button is shown only on Apple devices, but it is rendered
 * OPTIMISTICALLY before hydration so it never flashes in on a fast device — which
 * means a caller has to be able to tell the two phases apart. `isHydrated` is that,
 * and it is the only thing this module adds: the detection itself is
 * `@12-apps/auth`'s, imported rather than re-implemented, because a
 * second copy of "does an iPad claim to be a Mac" is how the two answers drift.
 */
import { render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDeviceDetection } from '../device-detection';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function withUserAgent(userAgent: string): void {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}

function Probe(): JSX.Element {
  const { isAppleDevice, isIOS, isHydrated } = useDeviceDetection();
  return (
    <p data-testid="probe">{`${String(isAppleDevice)}/${String(isIOS)}/${String(isHydrated)}`}</p>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDeviceDetection', () => {
  it('recognises an iPhone, and reports hydration once the effect has run', async () => {
    withUserAgent(IPHONE);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('true/true/true'));
  });

  it('does not claim an Android device', async () => {
    withUserAgent(ANDROID);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('false/false/true'));
  });
});
