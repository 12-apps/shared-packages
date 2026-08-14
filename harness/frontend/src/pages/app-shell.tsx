import { QueryClient } from '@tanstack/react-query';
import { useCallback, useState, type JSX } from 'react';

import { formatBRL, formatMinutesLabel } from '@12-apps/app-shell';
import { createWebAppShell } from '@12-apps/app-shell/react';

import { HARNESS_SHELL_MESSAGES } from '../app-shell/shell-copy';

import { CONSENT_SIGNAL, useConsentSignal } from '../app-shell/consent-signal';
import { CrashCount, CrashingPanel, crashReports } from '../app-shell/crash-on-demand';
import { LazyPanel } from '../app-shell/lazy-panel';

/**
 * The whole wiring a frontend host performs for `@12-apps/app-shell` (12-18).
 *
 * Everything the shell IS — the provider tower and its order, the theme built off a
 * tenant's brand seed, the session, the boundary, the stale-chunk recovery, the consent
 * gate and its accelerator — lives inside the package. This file names the four things
 * that are genuinely the host's: the brand, where a crash is reported, the query
 * client, and how a "terms may have changed" hint reaches the gate.
 *
 * There is no `transport` seam and no stubbed `fetch`, deliberately: the package's
 * default is same-origin, Vite proxies `/api` to `harness/backend`, and so the consent
 * gate below crosses a real socket into the package's own Hono router. The session
 * endpoint is the one thing that genuinely is not there — this harness has no auth
 * surface — and that is worth having on screen rather than stubbed away: a signed-out
 * app is a real state, and `unauthenticated` is the honest answer for it.
 *
 * ## Why the identity is a COOKIE
 *
 * The only identity a browser presents by itself is a cookie the request carries, which
 * is also the reason a real host reads a session cookie.
 *
 * Two details, and neither is a nicety:
 *
 *  - **Its own name.** `harness-actor` belongs to the realtime page, which assigns it
 *    unconditionally at module scope — and every page module is evaluated at boot,
 *    whichever page is showing. A spec here that set `harness-actor` before navigating
 *    would have it overwritten on load, so every case would silently run as the default
 *    user while appearing to test somebody else.
 *  - **Seeded only when ABSENT**, so a spec choosing another vantage keeps it.
 */
if (!document.cookie.includes('harness-consent=')) {
  document.cookie = 'harness-consent=owner; path=/; SameSite=Lax';
}

/**
 * The host's own cache. The shell never invents one — a host's query cache is where a
 * 402→upsell interceptor lives, so a shell-created client would silently drop it.
 */
const queryClient = new QueryClient();

const shell = createWebAppShell({
  // The harness's OWN name. It used to borrow a real tenant of the extraction
  // origin, which is precisely the thing a consumer harness exists to disprove.
  brand: { name: 'Ferragens Norte' },
  // A tenant's white-label seed, chosen because it is UNREADABLE as text on white
  // (1.76:1 against a 4.5:1 floor). The probe below renders what the theme did with it,
  // so the correction is observable in a real browser rather than asserted against a
  // hex in a unit test.
  theme: { override: { primary: '#7ED957' } },
  // Reported through the HOST's reporter, which in a real app is the observability
  // adapter that registers its noise rules. Here it is a store, so a spec can see that
  // a crashed page REPORTED rather than merely rendered.
  onCrash: (error) => crashReports.push(error instanceof Error ? error.message : String(error)),
  queryClient,
  consent: { useSignal: useConsentSignal },
  // Required now, and stated by THIS host in its own words. It used to be
  // omitted, which meant rendering the package's pt-BR default — the extraction
  // origin's copy — while claiming to be an independent consumer. See
  // `../app-shell/shell-copy`.
  messages: HARNESS_SHELL_MESSAGES,
});

/**
 * Built ONCE, at module scope — see `LazyPanel`. This is also the shape a real route
 * table has, which is the thing being demonstrated.
 */
const LazyChunk = shell.lazyRoute(() => import('../app-shell/lazy-chunk'));

/** What the session resolved to — the provider being mounted at all is the claim. */
function SessionProbe(): JSX.Element {
  const { status } = shell.useSession();
  return (
    <section>
      <h3>Session</h3>
      <p data-testid="session-status">{status}</p>
      <p data-testid="brand-name">{shell.brand.name}</p>
    </section>
  );
}

/**
 * The theme, as the browser actually resolved it.
 *
 * `main` is the tenant's hue at a legible lightness; `light` is their exact swatch, kept
 * for decoration. Rendered rather than asserted in a unit test because the theme here is
 * built by the PUBLISHED package against the PUBLISHED `@12-apps/ui`.
 */
function ThemeProbe(): JSX.Element {
  return (
    <section>
      <h3>Theme</h3>
      <p data-testid="palette-main">{shell.theme.palette.primary.main}</p>
      <p data-testid="palette-light">{String(shell.theme.palette.primary.light)}</p>
      <p data-testid="palette-secondary">{shell.theme.palette.secondary.main}</p>
      {/* The four meanings, which no tenant seed may move. */}
      <p data-testid="palette-error">{shell.theme.palette.error.main}</p>
    </section>
  );
}

/** The framework-free formatters, from the root entry. */
function FormatProbe(): JSX.Element {
  return (
    <section>
      <h3>Format</h3>
      <p data-testid="format-money">{formatBRL(123456)}</p>
      <p data-testid="format-minutes">{String(formatMinutesLabel(650))}</p>
      <p data-testid="format-minutes-unset">{String(formatMinutesLabel(0))}</p>
    </section>
  );
}

/**
 * The two controls a spec drives, and the boundary around the page that can crash.
 *
 * The boundary wraps only the crashing panel, which is the honest analogue of what it
 * does in an app: a crashed PAGE stays a crashed page, with the chrome around it still
 * working. Wrapping every probe would mean one click erased the whole screen.
 *
 * It is a SECOND boundary — `shell.Provider` already mounts one around everything as the
 * last resort — and that is exactly the composition an adopter with its own chrome
 * performs. React hands the error to the nearest boundary, so the inner one below
 * catches and the outer never sees it: the spec's `crash-count` of exactly 1, and the
 * single `route-error` that Playwright's strict mode would fail on if there were two,
 * are the proof in a real browser that double-wrapping doubles neither.
 */
function Controls(): JSX.Element {
  const [crashed, setCrashed] = useState(false);
  const [hints, setHints] = useState(0);
  const hint = useCallback(() => {
    CONSENT_SIGNAL.fire();
    setHints((count) => count + 1);
  }, []);

  return (
    <>
      <section>
        <h3>Consent signal</h3>
        <button type="button" data-testid="consent-signal" onClick={hint}>
          Avisar
        </button>
        <p data-testid="consent-signal-count">{hints}</p>
      </section>
      <section>
        <h3>Crash</h3>
        <button type="button" data-testid="crash-now" onClick={() => setCrashed(true)}>
          Quebrar
        </button>
        <CrashCount />
        <shell.RouteErrorBoundary resetKey="app-shell">
          <CrashingPanel crashed={crashed} />
        </shell.RouteErrorBoundary>
      </section>
    </>
  );
}

export function AppShellPage(): JSX.Element {
  return (
    <shell.Provider>
      <h2>App shell</h2>
      <SessionProbe />
      <ThemeProbe />
      <FormatProbe />
      <Controls />
      <LazyPanel Chunk={LazyChunk} />
    </shell.Provider>
  );
}
