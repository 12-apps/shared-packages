import { describe, expect, it, vi } from "vitest";

import {
  CHECK_EVERY_MS,
  createUpdateManager,
  updatesSupported,
  type UpdateState,
  type UpdaterPort,
} from "../manager";

const FEED = "https://example.com/feed";

/**
 * The program replacing itself.
 *
 * Every rule here decides something the person cannot see happening, which
 * is why each is worth a case: a check that fires with the switch off is the
 * program overriding a decision; one that fires with no session sends a gated
 * feed an anonymous request; and one that reports an update on macOS promises
 * something Squirrel.Mac will refuse at the last step, on their machine, after
 * the download.
 */

/** A fake updater that records what it was told and lets a case fire events. */
function fakeUpdater(): {
  port: UpdaterPort;
  seen: { feed: string | null; headers: UpdaterPort["requestHeaders"]; checks: number };
  emit: (event: string, payload?: { version?: string; percent?: number }) => void;
} {
  const listeners = new Map<string, (payload: { version?: string; percent?: number }) => void>();
  const seen: { feed: string | null; headers: UpdaterPort["requestHeaders"]; checks: number } = {
    feed: null,
    headers: null,
    checks: 0,
  };
  const port: UpdaterPort = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    requestHeaders: null,
    setFeedURL: (options) => {
      seen.feed = options.url;
    },
    checkForUpdates: () => {
      seen.headers = port.requestHeaders;
      seen.checks += 1;
      return Promise.resolve(null);
    },
    quitAndInstall: () => undefined,
    on: (event, listener) => {
      listeners.set(event, listener);
    },
  };
  return { port, seen, emit: (event, payload) => listeners.get(event)?.(payload ?? {}) };
}

function manager(
  overrides: {
    platform?: NodeJS.Platform;
    settings?: { feedUrl: string | null; autoUpdate: boolean };
    /** No cookie port at all: a public feed. */
    noCookiePort?: boolean;
    cookie?: string | null;
    /** The cookie jar itself throws. */
    cookieFails?: boolean;
  } = {},
): {
  api: ReturnType<typeof createUpdateManager>;
  fake: ReturnType<typeof fakeUpdater>;
  states: UpdateState[];
} {
  const fake = fakeUpdater();
  const states: UpdateState[] = [];
  const api = createUpdateManager({
    updater: fake.port,
    ...(overrides.noCookiePort === true
      ? {}
      : {
          cookie: {
            // `in` rather than `??`: a case that passes `null` means SIGNED
            // OUT, and `null ?? "…"` would hand it the default cookie and test
            // nothing.
            read: () =>
              overrides.cookieFails === true
                ? Promise.reject(new Error("cookie jar gone"))
                : Promise.resolve("cookie" in overrides ? overrides.cookie! : "session=abc"),
          },
        }),
    platform: overrides.platform ?? "win32",
    settings: () => overrides.settings ?? { feedUrl: FEED, autoUpdate: true },
    onState: (state) => states.push(state),
    timers: { set: () => ({}), clear: () => undefined },
  });
  return { api, fake, states };
}

describe("updatesSupported", () => {
  it("is true where an unsigned build can actually install one", () => {
    expect(updatesSupported("win32")).toBe(true);
    expect(updatesSupported("linux")).toBe(true);
  });

  it("is FALSE on macOS, which refuses an unsigned update after downloading it", () => {
    // Reported as unsupported rather than tried: the refusal would land on the
    // user's machine, after the download, at the restart.
    expect(updatesSupported("darwin")).toBe(false);
  });
});

describe("check", () => {
  it("carries the agent's session, because the feed is not anonymous", async () => {
    const run = manager();

    await run.api.check();

    expect(run.fake.seen.checks).toBe(1);
    expect(run.fake.seen.headers).toEqual({ Cookie: "session=abc" });
    expect(run.fake.seen.feed).toBe(FEED);
  });

  it("does NOT check when automatic updates are switched off", async () => {
    const run = manager({ settings: { feedUrl: FEED, autoUpdate: false } });

    await run.api.check();

    expect(run.fake.seen.checks).toBe(0);
    expect(run.api.state).toEqual({ kind: "off" });
  });

  it("checks anyway when a person is the one asking", async () => {
    // Somebody who turned it off and then pressed the button has plainly asked.
    const run = manager({ settings: { feedUrl: FEED, autoUpdate: false } });

    await run.api.check({ manual: true });

    expect(run.fake.seen.checks).toBe(1);
  });

  it("stays quiet with no feed yet and with no session", async () => {
    // Both are already being said elsewhere — the host's setup and the
    // shell's own signed-out state — and a second sentence about the same
    // thing is noise on a window somebody opens once a month.
    const noFeed = manager({ settings: { feedUrl: null, autoUpdate: true } });
    await noFeed.api.check();
    expect(noFeed.fake.seen.checks).toBe(0);
    expect(noFeed.api.state).toEqual({ kind: "idle" });

    const signedOut = manager({ cookie: null });
    await signedOut.api.check();
    expect(signedOut.fake.seen.checks).toBe(0);
    expect(signedOut.fake.seen.headers).toBeNull();
  });

  it("asks a public feed with no header and no signed-out check when there is no cookie port", async () => {
    const run = manager({ noCookiePort: true });

    await run.api.check();

    expect(run.fake.seen.checks).toBe(1);
    expect(run.fake.seen.headers).toBeNull();
    expect(run.fake.seen.feed).toBe(FEED);
  });

  it("reports unsupported on macOS without asking the network", async () => {
    const run = manager({ platform: "darwin" });

    await run.api.check();

    expect(run.fake.seen.checks).toBe(0);
    expect(run.api.state).toEqual({ kind: "unsupported" });
  });

  it("answers a refused check with a state, never a thrown rejection", async () => {
    // An unhandled rejection in a tray process takes the agent's work down
    // with it, and a machine with no internet for an hour is ordinary.
    const run = manager();
    run.fake.port.checkForUpdates = () => Promise.reject(new Error("getaddrinfo ENOTFOUND"));

    await expect(run.api.check()).resolves.toBeUndefined();
    expect(run.api.state).toEqual({ kind: "failed" });
  });
});

describe("the updater's own events", () => {
  it("downloads in the background, and installs only through install() — never silently on quit", () => {
    // Install-on-quit never happens to a tray program and leaves no record
    // when it fails; the explicit path is the one the crash reports follow.
    const run = manager();

    expect(run.fake.port.autoDownload).toBe(true);
    expect(run.fake.port.autoInstallOnAppQuit).toBe(false);
  });

  it("reports an available update as DOWNLOADING, because it already is", () => {
    const run = manager();

    run.fake.emit("update-available", { version: "0.1.42" });

    // `percent: null` and not 0: nothing has moved yet, and the window draws
    // that as an indeterminate bar rather than one parked at the start.
    expect(run.api.state).toEqual({ kind: "downloading", version: "0.1.42", percent: null });
  });

  it("carries the download's progress, keeping the version the event omits", () => {
    const run = manager();
    run.fake.emit("update-available", { version: "0.1.42" });

    run.fake.emit("download-progress", { percent: 37.4 });

    expect(run.api.state).toEqual({ kind: "downloading", version: "0.1.42", percent: 37.4 });
  });

  it("ignores progress that lands after the download finished", () => {
    const run = manager();
    run.fake.emit("update-available", { version: "0.1.42" });
    run.fake.emit("update-downloaded", { version: "0.1.42" });

    run.fake.emit("download-progress", { percent: 99 });

    expect(run.api.state).toEqual({ kind: "ready", version: "0.1.42" });
  });

  it("carries each event through to the window", () => {
    const run = manager();

    run.fake.emit("update-not-available");
    expect(run.api.state).toEqual({ kind: "none" });
    run.fake.emit("update-downloaded", { version: "0.1.42" });
    expect(run.api.state).toEqual({ kind: "ready", version: "0.1.42" });
    run.fake.emit("error");
    expect(run.api.state).toEqual({ kind: "failed" });

    expect(run.states).toHaveLength(3);
  });
});

/**
 * When the program asks on its own: once a day, plus the start and every time
 * the window is shown — which is the host's wiring, and each of those is just
 * another `check()` subject to the rules below.
 */
describe("cadence", () => {
  it("asks once a day, not every six hours", () => {
    expect(CHECK_EVERY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("arms that timer, and the tick is an automatic check", async () => {
    const fake = fakeUpdater();
    const armed: { ms: number | null; tick: (() => void) | null } = { ms: null, tick: null };
    const api = createUpdateManager({
      updater: fake.port,
      cookie: { read: () => Promise.resolve("session=abc") },
      platform: "win32",
      settings: () => ({ feedUrl: FEED, autoUpdate: false }),
      timers: {
        set: (run, ms) => {
          armed.ms = ms;
          armed.tick = run;
          return {};
        },
        clear: () => undefined,
      },
    });

    expect(armed.ms).toBe(CHECK_EVERY_MS);
    armed.tick?.();
    await vi.waitFor(() => expect(api.state).toEqual({ kind: "off" }));
    // Automatic, so the switch holds: the tick answered `off` and asked nothing.
    expect(fake.seen.checks).toBe(0);
  });
});

/**
 * A check must never undo a download.
 *
 * With a check on every window open, the skipped check's `off` used to land
 * on top of a version already on disk and take "restart and update" out of
 * the menu on the next tray click.
 */
describe("a version on its way", () => {
  it("keeps READY when the switch is off and the window is opened", async () => {
    const run = manager({ settings: { feedUrl: FEED, autoUpdate: false } });
    run.fake.emit("update-downloaded", { version: "0.1.56" });

    await run.api.check();

    expect(run.api.state).toEqual({ kind: "ready", version: "0.1.56" });
  });

  it("keeps READY when signed out, which would otherwise answer idle", async () => {
    const run = manager({ cookie: null });
    run.fake.emit("update-downloaded", { version: "0.1.56" });

    await run.api.check({ manual: true });

    expect(run.api.state).toEqual({ kind: "ready", version: "0.1.56" });
  });

  it("does not ask again while a download runs, even when asked by hand", async () => {
    const run = manager();
    run.fake.emit("update-available", { version: "0.1.56" });
    run.fake.emit("download-progress", { percent: 40 });

    await run.api.check({ manual: true });

    expect(run.fake.seen.checks).toBe(0);
    expect(run.api.state).toEqual({ kind: "downloading", version: "0.1.56", percent: 40 });
  });

  it("answers a double-click with ONE check", async () => {
    const run = manager();

    await Promise.all([run.api.check(), run.api.check()]);

    expect(run.fake.seen.checks).toBe(1);
  });

  it("asks again once the previous check has finished, even if the updater stayed silent", async () => {
    // An unpackaged updater resolves with no event, leaving `checking` behind.
    // Blocking on that STATE would stop every later check for good.
    const run = manager();

    await run.api.check();
    await run.api.check();

    expect(run.api.state).toEqual({ kind: "checking" });
    expect(run.fake.seen.checks).toBe(2);
  });

  it("asks again after a failure", async () => {
    const run = manager();
    run.fake.emit("error");

    await run.api.check();

    expect(run.fake.seen.checks).toBe(1);
  });
});

describe("installing and failing", () => {
  it("installs silently and comes back up — the machine must not be left with no agent", () => {
    const run = manager();
    const calls: unknown[][] = [];
    run.fake.port.quitAndInstall = (...args: unknown[]) => void calls.push(args);

    run.api.install();

    expect(calls).toEqual([[true, true]]);
  });

  it("answers a session read that rejects with a failed check, never an unhandled rejection", async () => {
    const run = manager({ cookieFails: true });

    await expect(run.api.check()).resolves.toBeUndefined();
    expect(run.states.at(-1)).toEqual({ kind: "failed" });
    expect(run.fake.seen.checks).toBe(0);
  });
});
