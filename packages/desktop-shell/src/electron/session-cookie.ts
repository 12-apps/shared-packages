import type { SessionCookiePort } from "../updates";

import type { ShellContext } from "./types";

/**
 * The signed-in session, held so the UPDATER can borrow it.
 *
 * `electron-updater` is a plain Node HTTP client and knows nothing about
 * Electron's cookie jar, but a gated update feed wants the same session as
 * every other route that hands out an executable. So the cookie is read out of
 * the shell's partition and handed over as a header before each check — read
 * afresh every time, because it rotates and because the person can sign out.
 *
 * The host sets `current` from `onSessionStart` (`context.session`) and back
 * to `null` on sign-out.
 */
export interface SessionRef {
  current: ShellContext["session"] | null;
}

/** A {@link SessionCookiePort} over the shell's partition: `name=value`, or `null`. */
export function sessionCookieReader(ref: SessionRef, cookieName: string): SessionCookiePort {
  return {
    read: async () => {
      const session = ref.current;
      if (session === null) return null;
      const [cookie] = await session.cookies.get({ name: cookieName });
      return cookie === undefined ? null : `${cookie.name}=${cookie.value}`;
    },
  };
}
