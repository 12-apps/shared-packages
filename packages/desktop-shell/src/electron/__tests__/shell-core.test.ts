import type { Session } from "electron";
import { describe, expect, it } from "vitest";

import { createShellCore } from "../shell-core";
import type { WindowManager } from "../windows";

/**
 * One session, or none.
 *
 * The shell watches a cookie jar and makes requests, and both have to come
 * from the SAME Electron session or the agent signs in and then behaves as
 * though it had not. That failure is silent in both directions: the jar says
 * `signed-in`, so the tray is green and the app starts its work; every request
 * 401s, and `guardSession` reads each one as "the session went away" and asks
 * the watch to re-read the jar — which still holds a live cookie. The loop
 * spins for ever reporting health.
 *
 * `shellSession.fetch` is what makes the two agree. `net.fetch` is bound to the
 * DEFAULT session and was what shipped in 1.0.0 and 1.0.1.
 *
 * Nothing here needs Electron: `shell-core` imports only the `Session` TYPE,
 * which is precisely because the session arrives as a port.
 */

/** A recording stand-in for the shell's partition. */
function fakeSession(calls: string[]): {
  session: Session;
  cookies: { holds: { name: string; value: string }[] };
} {
  const cookies = { holds: [] as { name: string; value: string }[] };
  const session = {
    fetch: (input: unknown) => {
      calls.push(String(input));
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
    cookies: {
      get: () => Promise.resolve(cookies.holds),
      remove: () => Promise.resolve(),
      on: () => {},
      off: () => {},
    },
  } as unknown as Session;
  return { session, cookies };
}

const windows: WindowManager = {
  open: () => ({}) as never,
  hide: () => {},
  beginQuit: () => {},
};

function core(calls: string[], session: Session): ReturnType<typeof createShellCore> {
  return createShellCore({
    baseUrl: "https://shop.example.com",
    cookieName: "authjs.session-token",
    shellSession: session,
    windows,
    signInKey: "sign-in",
  });
}

describe("the shell's fetch", () => {
  it("goes through the session that holds the cookies, not the default one", async () => {
    const calls: string[] = [];
    const { session } = fakeSession(calls);
    // eslint-disable-next-line test-flakiness/no-unmocked-network -- `fakeSession` IS the mock; this call reaches a recording stub and no socket, and asserting WHICH fetch it reached is the whole point of the file
    await core(calls, session).context.fetch("https://shop.example.com/api/admin/tenants");
    expect(calls).toEqual(["https://shop.example.com/api/admin/tenants"]);
  });

  it("normalises a URL, which the session's fetch does not accept", async () => {
    // Passed through as an object it reaches the session with no `url` — a
    // request to the process's own base rather than an error anybody notices.
    const calls: string[] = [];
    const { session } = fakeSession(calls);
    await core(calls, session).context.fetch(new URL("https://shop.example.com/api/lojas"));
    expect(calls).toEqual(["https://shop.example.com/api/lojas"]);
  });

  it("watches the jar of that same session", async () => {
    const calls: string[] = [];
    const { session, cookies } = fakeSession(calls);
    const shell = core(calls, session);
    cookies.holds.push({ name: "authjs.session-token", value: "live" });
    await shell.watch.refresh();
    expect(shell.watch.state).toBe("signed-in");
  });
});
