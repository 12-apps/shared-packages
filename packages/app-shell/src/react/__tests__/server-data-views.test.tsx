// @vitest-environment jsdom
/**
 * The URL is the query.
 *
 * What is on trial is the three decisions that make a server-mode list usable
 * and that a hand-rolled version keeps getting wrong: WHICH params the hook may
 * touch, WHEN it commits (a keystroke debounces, a click does not), and WHAT it
 * merges against — the live URL, not the router's snapshot, because another
 * owner may have written to it while a debounce was in flight.
 *
 * `BrowserRouter` over `MemoryRouter`, deliberately: reading `window.location`
 * IS the behaviour under test, and a memory router leaves it untouched — so the
 * whole suite would pass against a hook that had lost the live read.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type JSX } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { DataViewQuery } from '@12-apps/ui/data-display/DataViews';

import { useServerDataViews } from '../server-data-views';

/** A query as the grid emits one, with only the fields this hook reads set. */
function query(overrides: Partial<DataViewQuery> = {}): DataViewQuery {
  return {
    search: '',
    filters: {},
    sort: null,
    page: 1,
    pageSize: 20,
    ...overrides,
  } as DataViewQuery;
}

type ParamMap = Record<string, string | string[] | undefined>;

/** Renders the live URL, and fires `emit` once mounted. */
function Harness({
  emit,
  toParams,
}: {
  emit: readonly DataViewQuery[];
  toParams?: (value: DataViewQuery) => ParamMap;
}): JSX.Element {
  const location = useLocation();
  const server = useServerDataViews({
    totalCount: 3,
    page: 1,
    pageSize: 20,
    debounceMs: 20,
    toParams: toParams ?? ((value) => ({ q: value.search || undefined })),
  });
  useEffect(() => {
    emit.forEach((value) => server.onQueryChange(value));
    // Empty deps on purpose: emitting ONCE per mount is the subject, and
    // `server` is a fresh object every render, so a dependency on it would
    // re-emit forever and measure React rather than the hook.
  }, []);
  return <div data-testid="url">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(url: string, props: Parameters<typeof Harness>[0], basename?: string): void {
  window.history.replaceState(null, '', url);
  render(
    <BrowserRouter {...(basename ? { basename } : {})}>
      <Harness {...props} />
    </BrowserRouter>,
  );
}

const shown = (): string => screen.getByTestId('url').textContent ?? '';
const live = (): string => `${window.location.pathname}${window.location.search}`;

describe('which params it may touch', () => {
  it('S1: writes the params `toParams` owns', async () => {
    renderAt('/list', { emit: [query({ search: 'abc' })] });
    await waitFor(() => expect(shown()).toBe('/list?q=abc'));
  });

  it('S2: preserves a param it does not own', async () => {
    renderAt('/list?view=grid', { emit: [query({ search: 'abc' })] });
    await waitFor(() => expect(shown()).toContain('q=abc'));
    expect(shown()).toContain('view=grid');
  });

  it('S3: REMOVES an owned param whose value cleared, rather than leaving `?q=`', async () => {
    renderAt('/list?q=old', { emit: [query({ search: '' })] });
    await waitFor(() => expect(shown()).toBe('/list'));
  });

  it('S4: emits an array as repeated params, for values that may contain a comma', async () => {
    renderAt('/list', {
      emit: [query({ page: 2 })],
      toParams: () => ({ role: ['turno, noite', 'caixa'] }),
    });
    await waitFor(() => expect(shown()).toContain('role=turno%2C+noite'));
    expect(shown()).toContain('role=caixa');
  });
});

describe('when it commits', () => {
  it('S5: applies a filter or page change SYNCHRONOUSLY — no keystroke, no wait', () => {
    // Asserted without `waitFor` on purpose: the point is that the URL is
    // already correct on the first tick, because only free text fires per
    // keystroke and a chip click that waited 250ms would feel broken.
    renderAt('/list', {
      emit: [query({ page: 3 })],
      toParams: (value) => ({ page: String(value.page) }),
    });
    expect(shown()).toBe('/list?page=3');
  });

  it('S6: debounces a changed search, so typing is one navigation and not three', async () => {
    vi.useFakeTimers();
    try {
      renderAt('/list', {
        emit: [query({ search: 'a' }), query({ search: 'ab' }), query({ search: 'abc' })],
      });
      expect(shown()).toBe('/list');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30);
      });
      expect(shown()).toBe('/list?q=abc');
    } finally {
      vi.useRealTimers();
    }
  });

  it('S7: merges against the LIVE url, so a param written mid-debounce survives', async () => {
    // The race this exists for: a row click writes `?view=` from another owner
    // while the search debounce is still pending. A hook merging against the
    // router's functional snapshot would commit `?q=` over a snapshot taken
    // before that write, and the row selection would vanish a moment after the
    // operator made it.
    vi.useFakeTimers();
    try {
      renderAt('/list', { emit: [query({ search: 'abc' })] });
      window.history.replaceState(null, '', '/list?view=row-7');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30);
      });
      expect(live()).toContain('view=row-7');
      expect(live()).toContain('q=abc');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the basename comes from the ROUTER', () => {
  it('S8: does not repeat a mounted app’s basename into the path it navigates to', async () => {
    renderAt('/admin/list', { emit: [query({ search: 'abc' })] }, '/admin');
    // The router spells the path `/list`; the address bar keeps `/admin`. A
    // hook reading the BUNDLER's configured base instead would agree only
    // while the two were configured identically, and would double the segment
    // the moment they were not.
    await waitFor(() => expect(shown()).toBe('/list?q=abc'));
    expect(live()).toBe('/admin/list?q=abc');
  });
});
