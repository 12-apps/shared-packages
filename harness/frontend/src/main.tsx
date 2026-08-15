import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CssBaseline } from '@12-apps/ui/mui/CssBaseline';
import { ThemeProvider } from '@12-apps/ui/mui/styles';

import { PAGES } from './pages/registry';
import { HarnessShell } from './shell/harness-shell';
import { harnessTheme } from './shell/theme';

/**
 * The harness shell: a panel of every published surface, one page each.
 *
 * Routing is the hash, not react-router. A router would be a dependency the
 * harness carries but none of the packages under test require, and every
 * dependency here is one more thing that can explain a failure that is supposed
 * to be about OUR packages. `location.hash` needs nothing.
 *
 * `ThemeProvider` + `CssBaseline` are the exception, and they are not chrome:
 * they are the mounting a host performs, in the same order the origin host's
 * `apps/admin/src/App.tsx` performs it. Without them, every package under test
 * renders against MUI's stock palette instead of the design system's, so a
 * page that looks right here would look wrong in the only place it ships.
 *
 * The chrome itself lives in `shell/` — see `harness-nav.tsx` for what it takes
 * from the admin sidebar and what it leaves behind.
 */
function useHashSlug(fallback: string) {
  // The slug is the FIRST segment of the hash's path; anything after `?` is the
  // page's own query. The OAuth callback comes back to a page carrying
  // `?connected=`/`?code=`, exactly as the origin host's admin does — and a
  // fragment-only navigation is what keeps the in-page mount alive across the
  // provider hop.
  //
  // Only the first segment, because a page may own a URL SPACE rather than a
  // single URL: `pages/report-builder.tsx` mounts a router at its own slug, so
  // the reports surface writes `#/report-builder/harness/reports/r1` and the
  // shell has to still find `report-builder` in it. Reading the whole path
  // looked that string up as a page name and found none. Every other page is a
  // plain slug, whose path has one segment and is returned unchanged.
  const read = () => {
    const path = window.location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
    return (path.split('/')[0] ?? '') || fallback;
  };
  const [slug, setSlug] = useState(read);
  useEffect(() => {
    const onChange = () => setSlug(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  });
  return slug;
}

function Shell() {
  const slug = useHashSlug(PAGES[0].slug);
  const page = PAGES.find((candidate) => candidate.slug === slug);

  return (
    <ThemeProvider theme={harnessTheme}>
      <CssBaseline />
      <HarnessShell activeSlug={slug}>
        <div data-testid="harness-page" data-page={page?.slug ?? 'unknown'}>
          {/* An unknown slug is a spec pointing at a page that was renamed or
              removed. Saying so beats rendering the first page, which would let
              that spec keep passing against something it is not asking for. */}
          {page ? <page.Component /> : <p data-testid="harness-unknown-page">No harness page named “{slug}”.</p>}
        </div>
      </HarnessShell>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Shell />);
