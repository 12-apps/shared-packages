import type { ComponentType } from 'react';

/** Remembers, for this tab, WHEN a reload was last spent on a missing chunk. */
const RELOADED_KEY = '12-apps-ui:usable-modal-chunk-reload';

/**
 * How long a reload counts as spent. Inside it, a chunk still missing after the
 * reload is not a deploy but a broken build: render nothing rather than loop.
 * Past it, a missing chunk is the NEXT deploy — a tab open for days meets one a
 * day — and earns its own reload; a flag kept for the tab's life would leave
 * the modal silently dead after the second deploy.
 */
export const RELOAD_SPENT_MS = 5 * 60 * 1000;

type Module<P> = { default: ComponentType<P> };

/** Renders nothing: what a surface becomes when its chunk cannot be had at all. */
const Nothing = (): null => null;

function readReloaded(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(RELOADED_KEY));
    return at > 0 && Date.now() - at < RELOAD_SPENT_MS;
  } catch {
    return true;
  }
}

function writeReloaded(value: boolean): void {
  try {
    if (value) window.sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
    else window.sessionStorage.removeItem(RELOADED_KEY);
  } catch {
    // Storage refused (private mode, quota): the reload guard is lost, not the modal.
  }
}

/**
 * A lazy loader that survives a deploy. Every deploy replaces a host's hashed
 * chunks, so a tab opened before it asks for a file that is gone. The import is
 * tried twice; then the page reloads ONCE onto the current build (the same
 * answer as a host's own route loader); if that already happened in this tab
 * in the last `RELOAD_SPENT_MS`,
 * the modal renders nothing rather than handing the failure to the host's
 * error boundary and losing the whole page for opening a modal.
 */
export function recoverChunk<P>(load: () => Promise<Module<P>>): () => Promise<Module<P>> {
  return async () => {
    try {
      const loaded = await load().catch(() => load());
      writeReloaded(false);
      return loaded;
    } catch {
      if (typeof window === 'undefined' || readReloaded()) return { default: Nothing };
      writeReloaded(true);
      window.location.reload();
      // The page is going away; nothing should render in the meantime.
      return new Promise<Module<P>>(() => undefined);
    }
  };
}
