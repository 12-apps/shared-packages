/**
 * SERVER-MODE wiring for an admin list: the URL is the query.
 *
 * A `DataViewsGrid` in server mode does not filter or sort anything itself — it
 * EMITS a {@link DataViewQuery} whenever the operator changes a filter, the
 * sort or the page, and the host is expected to go and fetch that page. This
 * hook is the standard way to do that in a router-driven SPA: it maps the query
 * into search params and replaces them, and the page's query hook — keyed on
 * those params — re-fetches.
 *
 * Putting the state in the URL rather than in component state is what makes a
 * filtered list linkable, reloadable and back-button-able, which is most of what
 * separates an admin list somebody can work in from one they fight.
 *
 * Params the mapping does not OWN are preserved; an owned param whose value
 * cleared is removed, so a dropped filter does not linger in the URL.
 */
import { useEffect, useRef } from 'react';
import { useHref, useNavigate } from 'react-router-dom';

import type { DataViewQuery, DataViewServer } from '@12-apps/ui/data-display/DataViews';

import { stripTrailingSlashes } from '../core/paths';

interface ServerDataViewsInput {
  /** Unpaginated total from the backend — drives the counter and page count. */
  totalCount: number;
  /** Current 1-based page. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /**
   * Map the table's {@link DataViewQuery} into backend search params.
   *
   * Return every param the table OWNS, using `undefined` for an inactive one so
   * it is REMOVED from the URL rather than left behind as `?type=`. An array
   * value is emitted as repeated params (`?key=a&key=b`), for lists whose
   * members may themselves contain a comma.
   */
  toParams: (query: DataViewQuery) => Record<string, string | string[] | undefined>;
  /** Debounce before pushing a changed SEARCH to the URL. Default 250ms. */
  debounceMs?: number;
}

export function useServerDataViews(input: ServerDataViewsInput): DataViewServer {
  const navigate = useNavigate();
  /**
   * The router's basename, read from the ROUTER rather than from the bundler.
   *
   * `useHref('/')` resolves the app's root through whatever basename the
   * `RouterProvider` was given, so this works for a router mounted under a path
   * and for one at the origin alike. The alternative — reading the bundler's
   * configured base — is a second source for the same fact that only agrees
   * while the two are configured identically, and it makes the module
   * unloadable outside that bundler.
   */
  const basename = stripTrailingSlashes(useHref('/'));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSearch = useRef<string | null>(null);

  // Cancel a pending debounce on unmount, so a late timer cannot replace the
  // params of a page that is no longer on screen.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onQueryChange = (query: DataViewQuery): void => {
    const apply = (): void => {
      // Merge against the LIVE URL rather than the router's functional
      // `previous`. A debounced search commits from a `setTimeout` scheduled
      // BEFORE an interleaving update from another owner of the URL (a row
      // click writing `?view=`, a dialog writing `?edit=`), and the router's
      // functional snapshot can lag that update — so reading `window.location`
      // is what actually preserves a param somebody else just set. Without it,
      // clicking a row during the search debounce loses the `?view=` a moment
      // later, when the search commits its `?q=`.
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(input.toParams(query))) {
        if (value === undefined || value === '' || value.length === 0) {
          params.delete(key);
        } else if (Array.isArray(value)) {
          params.delete(key);
          value.forEach((entry) => params.append(key, entry));
        } else {
          params.set(key, value);
        }
      }
      // The live PATH too, for the same reason as the live search — and it is
      // `setSearchParams` that made this necessary: it rebuilds the URL on the
      // router's pathname, which can still be the one the app just left. That
      // is invisible while every writer sits on one constant path, and stops
      // being invisible the moment a list gains a detail route: a debounced
      // filter landing just after the editor closed puts the record back in the
      // URL with the list on screen.
      const search = params.toString();
      void navigate(`${livePathname(basename)}${search ? `?${search}` : ''}`, { replace: true });
    };

    // Only the free-text search debounces, because only it fires per keystroke.
    // A filter chip or a page number leaves the search text unchanged and so
    // applies SYNCHRONOUSLY — no timer, no wait. The empty-string baseline
    // covers the first emit too: without it the very first typed character
    // would skip the debounce and cost an extra request.
    const searchChanged = query.search !== (lastSearch.current ?? '');
    lastSearch.current = query.search;
    if (timer.current) clearTimeout(timer.current);
    if (searchChanged) {
      timer.current = setTimeout(apply, input.debounceMs ?? 250);
    } else {
      apply();
    }
  };

  return {
    totalCount: input.totalCount,
    page: input.page,
    pageSize: input.pageSize,
    onQueryChange,
  };
}

/** The live path as the ROUTER spells it — i.e. with the basename removed. */
function livePathname(basename: string): string {
  const path = window.location.pathname;
  return basename && path.startsWith(basename) ? path.slice(basename.length) || '/' : path;
}
