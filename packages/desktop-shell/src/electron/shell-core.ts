import type { Session } from "electron";

import { createSessionWatch, guardSession, type SessionWatch } from "../session";
import {
  deriveShellStatus,
  INITIAL_SHELL_STATE,
  type ShellState,
  type ShellStatus,
} from "../status";

import type { ShellContext } from "./types";
import type { WindowManager } from "./windows";

/**
 * The shell's state and its one connection to the host — everything that is
 * true whether or not a tray was ever drawn.
 *
 * Split from `./shell` because the two have different reasons to change: this
 * is the session and the status, and that is Electron's chrome. It also makes
 * the ORDER of events legible, which the combined file did not: a cookie
 * appears, the session flips, the status is re-derived, the app is told, and
 * only then does anything repaint.
 */

interface ShellCore {
  status(): ShellStatus;
  /** Merge a patch and repaint, but only when the derived STATUS changed. */
  update(patch: Partial<ShellState>): void;
  /** Install the repaint. Called once, after the tray exists. */
  onRender(render: (status: ShellStatus) => void): void;
  context: ShellContext;
  watch: SessionWatch;
}

interface ShellCoreOptions {
  baseUrl: string;
  cookieName: string;
  shellSession: Session;
  windows: WindowManager;
  /** The window key the sign-in page is filed under, hidden once a session lands. */
  signInKey: string;
  onSignedIn?: (context: ShellContext) => void | Promise<void>;
  onSignedOut?: () => void | Promise<void>;
  onStatus?: (status: ShellStatus, state: ShellState) => void;
}

export function createShellCore(options: ShellCoreOptions): ShellCore {
  const state: ShellState = { ...INITIAL_SHELL_STATE };
  const hooks: { render: (status: ShellStatus) => void } = { render: () => undefined };

  function update(patch: Partial<ShellState>): void {
    const before = deriveShellStatus(state);
    Object.assign(state, patch);
    const after = deriveShellStatus(state);
    if (after === before) return;
    hooks.render(after);
    options.onStatus?.(after, { ...state });
  }

  const context: ShellContext = {
    fetch: guardSession(shellFetch(options.shellSession), () => {
      // The server has the last word on a session, ahead of any cookie we can
      // see: re-reading the jar is what turns its refusal into the tray state
      // and stops the work.
      void watch.refresh();
    }),
    baseUrl: options.baseUrl,
    setLink: (link) => update({ link }),
    setFault: (fault) => update({ fault }),
    openWindow: (spec) => void options.windows.open(spec),
    session: options.shellSession,
  };

  const watch = createSessionWatch({
    jar: options.shellSession.cookies,
    spec: { url: options.baseUrl, cookieName: options.cookieName },
    onChange: (next) => {
      update({ session: next });
      if (next === "signed-in") {
        // The window has done its job; leaving a sign-in page open behind a
        // successful sign-in is how somebody signs in twice.
        options.windows.hide(options.signInKey);
        void options.onSignedIn?.(context);
        return;
      }
      update({ link: "disconnected", fault: null });
      void options.onSignedOut?.();
    },
  });

  return {
    status: () => deriveShellStatus(state),
    update,
    onRender: (render) => {
      hooks.render = render;
    },
    context,
    watch,
  };
}

/**
 * The SHELL SESSION's own fetch — `shellSession.fetch`, never `net.fetch`.
 *
 * That binding is the whole point: the cookie the sign-in window obtained
 * rides every request with nothing to copy, where a fetch bound to anything
 * else shares nothing with that window and is permanently signed out.
 *
 * **It has to be the session object's method.** `net.fetch` is bound to the
 * DEFAULT session, and the sign-in window writes its cookies into
 * `persist:<appId>` — so a shell built on `net.fetch` signs in successfully,
 * reports `signed-in` from the jar it watches, and then 401s on every request
 * it makes. Measured in one process, same URL, cookie planted in the
 * partition: `net.fetch` 401 with an empty default jar, `shellSession.fetch`
 * 200. Nothing in the shell notices, because `guardSession` reads that 401 as
 * "the session went away" and asks the watch to re-read a jar that still holds
 * a live cookie.
 *
 * A `URL` is normalised to a string first. The session's fetch takes the web
 * signature minus that one member, and passing one through reaches it as an
 * object with no `url` — a request to the process's own base rather than an
 * error anybody would notice.
 */
function shellFetch(shellSession: Session): typeof globalThis.fetch {
  return (input, init) =>
    shellSession.fetch(
      (input instanceof URL ? input.toString() : input) as never,
      init as never,
    ) as unknown as Promise<Response>;
}
