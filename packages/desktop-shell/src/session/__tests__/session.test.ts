import { describe, expect, it, vi } from "vitest";

import {
  createSessionWatch,
  guardSession,
  isLiveSession,
  type CookieJarPort,
  type SessionCookie,
} from "../index";

const NAME = "__Secure-authjs.session-token";
const NOW = Date.UTC(2026, 8, 22);

describe("isLiveSession", () => {
  it("accepts a session cookie with no expiry", () => {
    expect(isLiveSession([{ name: NAME, value: "abc" }], NAME, NOW)).toBe(true);
  });

  it("rejects one that has expired", () => {
    // The laptop-woken-after-a-weekend case: the jar still holds it.
    const cookie: SessionCookie = { name: NAME, value: "abc", expirationDate: NOW / 1_000 - 1 };
    expect(isLiveSession([cookie], NAME, NOW)).toBe(false);
  });

  it("rejects an empty value, which a cleared cookie leaves behind", () => {
    expect(isLiveSession([{ name: NAME, value: "" }], NAME, NOW)).toBe(false);
  });

  it("ignores every other cookie on the origin", () => {
    expect(isLiveSession([{ name: "cart", value: "abc" }], NAME, NOW)).toBe(false);
  });
});

/** A jar whose contents this test edits between refreshes. */
function memoryJar(initial: SessionCookie[] = []): CookieJarPort & { cookies: SessionCookie[] } {
  const jar = {
    cookies: [...initial],
    get: () => Promise.resolve(jar.cookies),
    remove: (_url: string, name: string) => {
      jar.cookies = jar.cookies.filter((cookie) => cookie.name !== name);
      return Promise.resolve();
    },
  };
  return jar;
}

describe("createSessionWatch", () => {
  const spec = { url: "https://host.test", cookieName: NAME };

  it("reports signed-out, then signed-in, and only on a change", async () => {
    const jar = memoryJar();
    const seen: string[] = [];
    const watch = createSessionWatch({
      jar,
      spec,
      onChange: (state) => seen.push(state),
      setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => undefined,
    });

    await watch.start();
    expect(seen).toEqual(["signed-out"]);

    await watch.refresh();
    expect(seen).toEqual(["signed-out"]);

    jar.cookies.push({ name: NAME, value: "abc" });
    await watch.refresh();
    expect(seen).toEqual(["signed-out", "signed-in"]);
    expect(watch.state).toBe("signed-in");
  });

  it("drops the session locally on sign-out", async () => {
    const jar = memoryJar([{ name: NAME, value: "abc" }]);
    const watch = createSessionWatch({
      jar,
      spec,
      setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => undefined,
    });

    await watch.start();
    expect(watch.state).toBe("signed-in");

    await watch.signOut();
    expect(watch.state).toBe("signed-out");
    expect(jar.cookies).toEqual([]);
  });

  it("subscribes to the jar's own change event when it has one", async () => {
    const on = vi.fn();
    const off = vi.fn();
    const jar: CookieJarPort = { ...memoryJar(), on, off };
    const watch = createSessionWatch({
      jar,
      spec,
      setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => undefined,
    });

    await watch.start();
    expect(on).toHaveBeenCalledWith("changed", expect.any(Function));

    watch.stop();
    expect(off).toHaveBeenCalledWith("changed", expect.any(Function));
  });
});

describe("guardSession", () => {
  it("reports a 401 so the tray can ask for a sign-in", async () => {
    const refusals: number[] = [];
    const guarded = guardSession(
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      () => refusals.push(1),
    );

    const response = await guarded("https://host.test/api/x");
    expect(response.status).toBe(401);
    expect(refusals).toHaveLength(1);
  });

  it("leaves a 403 alone — signing in again cannot grant a permission", async () => {
    const refusals: number[] = [];
    const guarded = guardSession(
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
      () => refusals.push(1),
    );

    await guarded("https://host.test/api/x");
    expect(refusals).toHaveLength(0);
  });
});
