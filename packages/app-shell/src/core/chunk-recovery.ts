/**
 * Route-level code splitting that survives a deploy.
 *
 * Every SPA page is a lazy chunk, so a page is only fetched when the user
 * navigates to it. That fetch happens against the build the OPEN TAB was
 * served — and a deploy replaces the whole `assets/` directory with
 * freshly-hashed filenames. A tab that loaded before the deploy therefore asks
 * for a chunk that no longer exists the moment the user clicks a nav item.
 *
 * A static server answers that request with the SPA history fallback
 * (`try_files {path} /index.html`), so the browser gets `200 text/html` where it
 * expected a module. `import()` rejects, `React.lazy` propagates, and with no
 * boundary above it the whole tree unmounts — a BLANK PAGE that a manual refresh
 * "fixes", because the refresh picks up the new `index.html`.
 *
 * {@link loadRouteChunk} does that refresh for the user: a chunk that fails to
 * load reloads the page once, landing on the current URL with the current build.
 * The one-shot guard matters — if the chunk is broken for a reason a reload
 * cannot fix, reloading again would spin forever, so the second failure inside
 * {@link RELOAD_GUARD_MS} is rethrown for the route error boundary to render.
 *
 * The reload is {@link reloadOntoCurrentBuild}, not a bare `location.reload()`.
 * A plain reload asks for the SAME document URL, and anything between the tab
 * and the server that still holds the pre-deploy document may answer it — and
 * that document names the very chunk that just failed, so the "recovery" lands
 * on the same dead import and the shopper gets the error screen anyway. That is
 * what a production event of this kind IS: the route boundary only reports a
 * stale chunk once the one reload did not help.
 *
 * The server-side half is the host's: keep the history fallback OFF asset paths
 * so a stale chunk 404s honestly instead of masquerading as an HTML document.
 *
 * Framework-free on purpose — it is a promise wrapper, and `React.lazy`'s side
 * of it is `lazyRoute` in `./react`. That split is what lets these cases be
 * asserted without a renderer.
 */

/** sessionStorage key holding the timestamp of the last recovery reload. */
const RELOAD_GUARD_KEY = 'spa:chunk-reload-at';

/**
 * How long one recovery reload suppresses the next. Long enough that a chunk
 * which is genuinely missing (rather than merely stale) cannot loop, short
 * enough that a second deploy later in the same session still self-heals.
 */
const RELOAD_GUARD_MS = 15_000;

/**
 * The query parameter a recovery reload puts on the address.
 *
 * Its VALUE is what does the work: a URL no cache has seen cannot be answered
 * from one, whichever layer was holding the old document — a proxy, a CDN, the
 * browser's heuristic cache for a response that carried no validator, a service
 * worker's offline copy. Busting the URL clears every one of them at once, which
 * is the point: the layer that served the stale document is not observable from
 * the tab, so a fix aimed at one of them would be a guess.
 *
 * {@link clearFreshReloadParam} takes it back off once the new build is running,
 * so it is never bookmarked, shared or read as a real filter.
 */
export const FRESH_RELOAD_PARAM = '_fresh';

/**
 * Browsers disagree on the wording, and the failure arrives as a plain `Error`
 * rather than a typed one, so the message is all there is to go on. Covers
 * Chrome/Firefox ("Failed to fetch dynamically imported module"), Safari
 * ("Importing a module script failed"), Vite's CSS preloader, and the
 * MIME-type rejection the history fallback produces.
 */
const CHUNK_ERROR_PATTERN =
  /dynamically imported module|importing a module script failed|unable to preload|module script|mime type/i;

/** Whether a rejected `import()` looks like a stale/unreachable chunk. */
export function isChunkLoadError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'ChunkLoadError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_PATTERN.test(message);
}

/**
 * Load the current URL again, from the network, whatever is cached.
 *
 * `replace` rather than `assign`: the busted URL is the same page, so it must
 * not leave a second history entry for the back button to step through. Path,
 * the other query parameters and the hash all survive — a shopper who was on
 * `/menu?mesa=4#bebidas` lands on exactly that.
 */
export function reloadOntoCurrentBuild(): void {
  const url = new URL(window.location.href);
  url.searchParams.set(FRESH_RELOAD_PARAM, Date.now().toString(36));
  window.location.replace(url.href);
}

/**
 * Take {@link FRESH_RELOAD_PARAM} back off the address bar.
 *
 * Call it once at boot, BEFORE the router reads the location — `history.
 * replaceState` does not notify a router that is already listening, so one
 * mounted first would keep the parameter in its own copy of the URL and write
 * it back on the next relative navigation. `createWebAppShell` calls it from
 * its factory, which a host runs at module scope, ahead of any render.
 *
 * A no-op on every load that was not a recovery reload.
 */
export function clearFreshReloadParam(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(FRESH_RELOAD_PARAM)) return;
  url.searchParams.delete(FRESH_RELOAD_PARAM);
  window.history.replaceState(window.history.state, '', url.href);
}

/** True when a recovery reload already happened inside the guard window. */
function reloadedRecently(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < RELOAD_GUARD_MS;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Treat that
    // as "already reloaded": without a guard a reload loop is the worse bug.
    return true;
  }
}

/** Records this reload so the next chunk failure does not loop. */
function markReloaded(): void {
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // Ignore — `reloadedRecently` fails closed when storage is unavailable.
  }
}

/**
 * Runs a chunk loader, reloading the page once if the chunk cannot be fetched.
 *
 * The returned promise deliberately never settles on the reload path: the
 * document is being replaced, and leaving the caller suspended keeps the
 * Suspense fallback on screen instead of flashing an error the user would
 * never have time to read.
 */
export async function loadRouteChunk<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (!isChunkLoadError(error) || reloadedRecently()) throw error;
    markReloaded();
    reloadOntoCurrentBuild();
    return new Promise<T>(() => {});
  }
}
