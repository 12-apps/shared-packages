import type { SessionState } from "../status";

/**
 * `@12-apps/desktop-shell/session` — signing a DESKTOP agent in, without a
 * second way to sign in.
 *
 * ## The rule this module exists to keep
 *
 * A desktop app must not collect a password. The moment it does, the product
 * has two authentication paths: the web one — with its rate limits, its
 * lockout, its e-mail verification, its OAuth buttons, its reset flow, its
 * copy in every language the host ships — and a text field in a native window
 * that has none of those and will never be kept level with the first.
 *
 * So the agent **opens the host's own sign-in page in a window** and watches
 * for the session cookie to appear. Every one of those behaviours is inherited
 * rather than reimplemented, a provider added on the web is available here the
 * same day, and this package contains no credential handling at all — the
 * grep for `password` in this directory returning nothing is the invariant.
 *
 * ## What is actually here
 *
 * Two small things, and their smallness is the point:
 *
 *  1. **A watch.** Is the cookie there, and is it still in date? That is the
 *     whole of "am I signed in" for a cookie-session host.
 *  2. **A sign-out.** Remove the cookie, which the host's own sign-out page
 *     would also do; doing it locally means an agent can drop a session it can
 *     no longer reach the server to end.
 *
 * ## Ports, not Electron
 *
 * The jar is an interface that Electron's `session.cookies` satisfies
 * structurally. Nothing here imports Electron, so the whole module is tested
 * on a machine with no display.
 */

/** One cookie, narrowed to what deciding "signed in" needs. */
export interface SessionCookie {
  name: string;
  value: string;
  /** Epoch SECONDS, as Electron reports it. Absent on a session cookie. */
  expirationDate?: number;
}

/** Electron's `Cookies` surface, narrowed. */
export interface CookieJarPort {
  get(filter: { url?: string; name?: string }): Promise<SessionCookie[]>;
  remove(url: string, name: string): Promise<void>;
  /** Present on Electron's jar; absent on a plain double. */
  on?(event: "changed", listener: () => void): void;
  off?(event: "changed", listener: () => void): void;
}

export interface SessionSpec {
  /** The origin the cookie belongs to — the host's own base URL. */
  url: string;
  /**
   * The cookie name.
   *
   * Taken as CONFIG rather than derived, because the derivation belongs to
   * whichever auth library the host runs and this package must not encode one.
   * An Auth.js host passes `sessionCookieName(...)` from its auth package,
   * which mirrors the `__Secure-` prefix rule the server side already applies —
   * a name guessed here instead would fail silently, which is the worst way for
   * a session check to be wrong.
   */
  cookieName: string;
}

/**
 * Is this cookie a usable session right now?
 *
 * The expiry check is not belt-and-braces. A jar hands back what it stored,
 * and a clock that moved — a laptop woken after a weekend, a machine whose
 * time synced late — is exactly the case where an agent would otherwise report
 * itself signed in and start getting 401s it has no state for.
 */
export function isLiveSession(
  cookies: readonly SessionCookie[],
  cookieName: string,
  nowMs: number,
): boolean {
  const cookie = cookies.find((candidate) => candidate.name === cookieName);
  if (!cookie || cookie.value.length === 0) return false;
  if (cookie.expirationDate === undefined) return true;
  return cookie.expirationDate * 1_000 > nowMs;
}

export interface SessionWatchOptions {
  jar: CookieJarPort;
  spec: SessionSpec;
  /** Called on every CHANGE of state, never on a re-confirmation. */
  onChange?: (state: SessionState) => void;
  /**
   * The poll floor, in ms.
   *
   * The jar's `changed` event covers a sign-in and a sign-out promptly, so
   * this is not the mechanism — it is the backstop for the one case an event
   * cannot cover: a cookie that simply reached its expiry while nothing
   * happened. Minutes, not seconds; nothing here is urgent.
   */
  pollMs?: number;
  now?: () => number;
  setInterval?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

export interface SessionWatch {
  /** The last known answer. `unknown` until the first {@link refresh}. */
  readonly state: SessionState;
  /** Read the jar now and report. */
  refresh(): Promise<SessionState>;
  /** Begin watching. Refreshes once immediately. */
  start(): Promise<void>;
  stop(): void;
  /** Drop the session locally; the next refresh reports `signed-out`. */
  signOut(): Promise<void>;
}

const DEFAULT_POLL_MS = 5 * 60_000;

export function createSessionWatch(options: SessionWatchOptions): SessionWatch {
  const now = options.now ?? Date.now;
  const start = options.setInterval ?? setInterval;
  const stop = options.clearInterval ?? clearInterval;
  let state: SessionState = "unknown";
  let timer: ReturnType<typeof setInterval> | null = null;
  let listener: (() => void) | null = null;

  async function refresh(): Promise<SessionState> {
    // Filtered by URL rather than by name: a jar asked for a name it does not
    // hold answers with an empty list either way, and asking by URL keeps the
    // one round trip able to see a cookie that was renamed under us.
    const cookies = await options.jar.get({ url: options.spec.url });
    const next: SessionState = isLiveSession(cookies, options.spec.cookieName, now())
      ? "signed-in"
      : "signed-out";
    if (next !== state) {
      state = next;
      options.onChange?.(next);
    }
    return next;
  }

  return {
    get state(): SessionState {
      return state;
    },
    refresh,
    async start(): Promise<void> {
      if (timer === null) timer = start(() => void refresh(), options.pollMs ?? DEFAULT_POLL_MS);
      if (listener === null && options.jar.on) {
        listener = (): void => void refresh();
        options.jar.on("changed", listener);
      }
      await refresh();
    },
    stop(): void {
      if (timer !== null) stop(timer);
      timer = null;
      if (listener !== null) options.jar.off?.("changed", listener);
      listener = null;
    },
    async signOut(): Promise<void> {
      await options.jar.remove(options.spec.url, options.spec.cookieName);
      await refresh();
    },
  };
}

/**
 * Wrap a fetch so that a REFUSED request updates the session instead of
 * being counted as a network fault.
 *
 * Without this, an expired session presents as a background loop retrying for
 * ever against a 401 — the agent looks busy, the tray says `online`, and
 * nothing tells the person the one thing they could fix. `onUnauthorized`
 * exists to flip that into `signed-out`, which is a tray icon that asks.
 *
 * ONLY 401. A 403 is a permission the account does not have, which signing in
 * again cannot change; treating it as a session problem would put somebody in
 * a loop of successful sign-ins that fix nothing.
 */
export function guardSession(
  fetchImpl: typeof globalThis.fetch,
  onUnauthorized: () => void,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (response.status === 401) onUnauthorized();
    return response;
  };
}
