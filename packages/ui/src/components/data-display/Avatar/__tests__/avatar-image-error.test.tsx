/**
 * A broken `src` shows the fallback whichever side reports the failure first
 * (FUT-4467). MUI's Avatar probes the src with its own `new Image()` and, once
 * that probe errors, stops rendering the `<img>` — so the `<img>`'s own `error`
 * event, the one `slotProps.img.onError` listens to, may never fire. jsdom loads
 * no images, so `Image` is replaced by one that fails as soon as it is given a
 * src: exactly the order in which the CI Storybook run left the avatar blank.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Avatar } from '../Avatar';

class FailingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onerror?.());
  }
}

class LoadingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe('Avatar with a src that fails to load', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', FailingImage);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the fallback when the image probe fails before the <img> does', async () => {
    render(<Avatar src="https://example.test/broken.jpg" fallback="ERR" dataTestId="a" />);
    await waitFor(() => {
      expect(screen.getByTestId('a')).toHaveTextContent('ERR');
      expect(screen.queryByTestId('a-loading')).not.toBeInTheDocument();
    });
  });

  it('shows the fallback for a new src that fails after one that loaded', async () => {
    vi.stubGlobal('Image', LoadingImage);
    const { rerender } = render(<Avatar src="https://example.test/ok.jpg" fallback="ERR" dataTestId="a" />);
    await waitFor(() => expect(screen.queryByTestId('a-loading')).not.toBeInTheDocument());

    vi.stubGlobal('Image', FailingImage);
    await act(async () => {
      rerender(<Avatar src="https://example.test/broken.jpg" fallback="ERR" dataTestId="a" />);
    });
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('ERR'));
  });
});
