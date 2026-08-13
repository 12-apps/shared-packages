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
    window.location.reload();
    return new Promise<T>(() => {});
  }
}
