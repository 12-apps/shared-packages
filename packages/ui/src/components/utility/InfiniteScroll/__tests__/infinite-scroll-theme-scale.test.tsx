/**
 * THE PREFETCH DISTANCE FOLLOWS THE THEME (FUT-2598).
 *
 * `threshold` (default 150) is design px, scaled with the theme's type scale:
 * a denser theme puts more rows in the same distance, so a raw 150px would ask
 * for the next page at a different point in the list than the design meant.
 * `IntersectionObserver.rootMargin` only takes px, so it gets `remPx`.
 *
 * The theme is a NON-default one (`fontSize: 12`) — at MUI's default a design
 * px is a CSS px and nothing here could fail.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { remPx } from '../../../../tokens/relative';
import { InfiniteScroll } from '../InfiniteScroll';

const theme = createTheme({ typography: { fontSize: 12 } });

/** Install an observer that records the options it was built with. */
function recordObserverOptions(): IntersectionObserverInit[] {
  const recorded: IntersectionObserverInit[] = [];
  class RecordingObserver {
    constructor(_callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
      recorded.push(options);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('IntersectionObserver', RecordingObserver);
  return recorded;
}

function renderScroller(threshold?: number) {
  return render(
    <ThemeProvider theme={theme}>
      <InfiniteScroll
        hasMore
        loading={false}
        loadMore={() => undefined}
        loadingText="Carregando"
        endText="Fim"
        threshold={threshold}
      >
        <div>linha</div>
      </InfiniteScroll>
    </ThemeProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('InfiniteScroll under a non-default type scale', () => {
  it('scales the default 150 design px into the observer margin', () => {
    const seen = recordObserverOptions();
    renderScroller();
    expect(seen.at(-1)?.rootMargin).toBe(`${remPx(theme, 150)}px`);
  });

  it("scales a caller's threshold the same way", () => {
    const seen = recordObserverOptions();
    renderScroller(300);
    expect(seen.at(-1)?.rootMargin).toBe(`${remPx(theme, 300)}px`);
  });
});
