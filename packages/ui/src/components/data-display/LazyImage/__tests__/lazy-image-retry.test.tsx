import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { LazyImage } from '../LazyImage';
import type { LazyImageProps } from '../LazyImage.types';

// FUT-2774 #1: `handleImageError` set `currentSrc` to a cache-busted
// `${src}?retry=N` on retry, but `useImageSource`'s visibility effect ran on
// every `currentSrc` change and its guard (`state.currentSrc === src`) never
// matched the cache-busted value — so the SAME render immediately overwrote
// it back to the plain `src`, the exact string the <img> already had when it
// errored. No new request ever went out; only `retryCount` kept climbing.
const theme = createTheme();
const SRC = '/photo.png';

function renderImage(props: Partial<LazyImageProps> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <LazyImage
        src={SRC}
        alt="Foto"
        lazy={false}
        retryOnError
        maxRetries={2}
        retryDelay={500}
        data-testid="pic"
        {...props}
      />
    </ThemeProvider>,
  );
}

const currentSrc = () => screen.getByTestId('pic-img').getAttribute('src');
const elapse = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('LazyImage retry (FUT-2774 #1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts on the plain src', () => {
    renderImage();
    expect(currentSrc()).toBe(SRC);
  });

  it('changes the rendered <img> src to a new cache-busted value and stays there', () => {
    renderImage();

    fireEvent.error(screen.getByTestId('pic-img'));
    elapse(500);

    expect(currentSrc()).toBe(`${SRC}?retry=1`);
  });

  it('cache-busts again on a second retry rather than reverting between attempts', () => {
    renderImage();

    fireEvent.error(screen.getByTestId('pic-img'));
    elapse(500);
    expect(currentSrc()).toBe(`${SRC}?retry=1`);

    fireEvent.error(screen.getByTestId('pic-img'));
    elapse(500);
    expect(currentSrc()).toBe(`${SRC}?retry=2`);
  });

  it('gives up once maxRetries is spent and shows the fallback', () => {
    renderImage({ fallback: '/fallback.png' });

    fireEvent.error(screen.getByTestId('pic-img'));
    elapse(500);
    fireEvent.error(screen.getByTestId('pic-img'));
    elapse(500);
    fireEvent.error(screen.getByTestId('pic-img'));

    expect(screen.getByTestId('pic-fallback')).toBeInTheDocument();
  });

  it('never re-requests when retryOnError is off', async () => {
    // Real timers: giving up is synchronous (no `retryDelay` involved), and
    // `waitFor`'s own polling needs a clock that actually advances.
    vi.useRealTimers();
    renderImage({ retryOnError: false });
    expect(screen.getByTestId('pic-img')).toBeInTheDocument();

    fireEvent.error(screen.getByTestId('pic-img'));

    await waitFor(() => expect(screen.queryByTestId('pic-img')).not.toBeInTheDocument());
  });
});
