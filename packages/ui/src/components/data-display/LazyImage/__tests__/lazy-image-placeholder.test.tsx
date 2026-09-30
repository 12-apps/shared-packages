import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LazyImage } from '../LazyImage';
import type { LazyImageProps } from '../LazyImage.types';

// FUT-2670: the placeholder is a loading state. With `loadingState="placeholder"`
// it shows from mount until the real image settles, the real image is drawn
// over it, and the caller's `onLoad`/`onError` belong to the real image alone.
const theme = createTheme();
const SRC = '/photo.png';
const PLACEHOLDER = '/photo-tiny.png';
const FADE = 300;

/** jsdom has no IntersectionObserver; this one reports an entry only when told to. */
class StubObserver {
  static readonly instances: StubObserver[] = [];

  private readonly targets: Element[] = [];

  constructor(private readonly callback: IntersectionObserverCallback) {
    StubObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  unobserve() {}

  disconnect() {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  intersect() {
    const entries = this.targets.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

const intersectAll = () => act(() => StubObserver.instances.forEach((observer) => observer.intersect()));
const elapse = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const positionOf = (testId: string) => globalThis.getComputedStyle(screen.getByTestId(testId)).position;
const countOf = (testId: string) => screen.queryAllByTestId(testId).length;

function renderImage(props: Partial<LazyImageProps> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <LazyImage
        src={SRC}
        placeholder={PLACEHOLDER}
        alt="Foto"
        loadingState="placeholder"
        fadeInDuration={FADE}
        data-testid="pic"
        {...props}
      />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  StubObserver.instances.length = 0;
  vi.stubGlobal('IntersectionObserver', StubObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LazyImage placeholder mode (FUT-2670)', () => {
  it('holds the placeholder in flow until the lazy real image has loaded and faded in', () => {
    vi.useFakeTimers();
    const onLoad = vi.fn();
    renderImage({ onLoad });

    expect(screen.getByTestId('pic-placeholder')).toHaveAttribute('alt', 'Foto (loading)');
    expect(positionOf('pic-placeholder')).not.toBe('absolute');
    expect(countOf('pic-img')).toBe(0);

    fireEvent.load(screen.getByTestId('pic-placeholder'));
    expect(onLoad).not.toHaveBeenCalled();

    intersectAll();
    expect(screen.getByTestId('pic-placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('pic-img')).toHaveAttribute('src', SRC);
    expect(positionOf('pic-img')).toBe('absolute');

    fireEvent.load(screen.getByTestId('pic-img'));
    elapse(FADE);
    expect(countOf('pic-placeholder')).toBe(0);
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('shows the placeholder for an eager image until the fade has ended', () => {
    vi.useFakeTimers();
    renderImage({ lazy: false });

    fireEvent.load(screen.getByTestId('pic-img'));
    expect(screen.getByTestId('pic-placeholder')).toBeInTheDocument();

    elapse(FADE);
    expect(countOf('pic-placeholder')).toBe(0);
  });

  it('drops a failing placeholder at once, without calling it an error of the image', () => {
    const onError = vi.fn();
    renderImage({ lazy: false, onError });

    fireEvent.error(screen.getByTestId('pic-placeholder'));
    expect(countOf('pic-placeholder')).toBe(0);
    expect(positionOf('pic-img')).not.toBe('absolute');
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores the placeholder under any other loading state', () => {
    const { container } = renderImage({ loadingState: 'skeleton' });

    expect(screen.getByTestId('pic-skeleton')).toBeInTheDocument();
    expect(container.querySelectorAll(`[src="${PLACEHOLDER}"]`)).toHaveLength(0);
  });

  it('drops the placeholder on load, with no fade to wait for, when fadeIn is off', () => {
    vi.useFakeTimers();
    renderImage({ lazy: false, fadeIn: false });

    fireEvent.load(screen.getByTestId('pic-img'));
    expect(countOf('pic-placeholder')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each<[string, Partial<LazyImageProps>]>([
    ['a skeleton image', { loadingState: 'skeleton' }],
    ['a spinner image', { loadingState: 'spinner' }],
    ['placeholder mode with no placeholder', { placeholder: undefined }],
  ])('schedules nothing when %s loads', (_name, props) => {
    vi.useFakeTimers();
    renderImage({ lazy: false, ...props });

    fireEvent.load(screen.getByTestId('pic-img'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never raises the placeholder over an image that loaded before placeholder mode was on', () => {
    const { rerender } = renderImage({ lazy: false, loadingState: 'skeleton' });
    fireEvent.load(screen.getByTestId('pic-img'));

    rerender(
      <ThemeProvider theme={theme}>
        <LazyImage src={SRC} placeholder={PLACEHOLDER} alt="Foto" loadingState="placeholder" lazy={false} data-testid="pic" />
      </ThemeProvider>,
    );
    expect(countOf('pic-placeholder')).toBe(0);
    expect(positionOf('pic-img')).not.toBe('absolute');
  });

  it('shows the placeholder for an empty lazy src and never an empty <img>', () => {
    renderImage({ src: '' });

    expect(screen.getByTestId('pic-placeholder')).toHaveAttribute('src', PLACEHOLDER);
    expect(countOf('pic-img')).toBe(0);
  });

  // FUT-2774 #2: `usePlaceholderPhase` tracked `retired` as plain `useState(false)`,
  // set once the real image settled and never reset — and the hook took no `src`
  // at all. A mounted instance reused for a new image (a carousel swapping `src`
  // rather than remounting) never showed the placeholder again for it.
  it('brings the placeholder back when src changes on a mounted instance', () => {
    const NEXT_SRC = '/photo-2.png';
    const { rerender } = renderImage({ lazy: false, fadeIn: false });

    fireEvent.load(screen.getByTestId('pic-img'));
    expect(countOf('pic-placeholder')).toBe(0);

    rerender(
      <ThemeProvider theme={theme}>
        <LazyImage
          src={NEXT_SRC}
          placeholder={PLACEHOLDER}
          alt="Foto"
          loadingState="placeholder"
          fadeIn={false}
          lazy={false}
          data-testid="pic"
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('pic-placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('pic-img')).toHaveAttribute('src', NEXT_SRC);
  });
});
