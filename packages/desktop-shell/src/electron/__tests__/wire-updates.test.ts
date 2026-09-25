import { afterEach, describe, expect, it, vi } from "vitest";

import { INSTALL_GRACE_MS, type UpdateBanner, type UpdateManager, type UpdateState } from "../../updates";
import { TEST_MENU_COPY } from "../../updates/__tests__/menu-copy";
import { wireUpdates, type WireUpdatesOptions } from "../wire-updates";
import { entry, recorded } from "./fake-electron";

vi.mock("electron", async () => (await import("./fake-electron")).electronModule);

/**
 * ONE install path.
 *
 * Every way an update gets installed — the host's button, the menu, the manual
 * check's box and the automatic restart — writes the target version into the
 * session marker (`telemetry.installing`) BEFORE the updater quits into the
 * installer. Skipped on any one path, a restart that comes back as the old
 * version is invisible: the next start cannot tell a failed install from a
 * clean one.
 */

const READY: UpdateState = { kind: "ready", version: "2.0.0" };

const BANNER_COPY: WireUpdatesOptions["bannerCopy"] = {
  downloading: (version) => `downloading ${version}`,
  ready: (version) => `ready ${version}`,
  install: "install",
  restartHint: "restarts",
};

interface Harness {
  updates: UpdateManager;
  /** What happened, in order: `installing <v>` from telemetry, `install` from the updater. */
  order: string[];
  crumbs: string[];
  banners: (UpdateBanner | null)[];
  /** Let the pending `telemetry.installing` finish. */
  release(): void;
  emit(state: UpdateState): void;
  shown(): void;
  check: ReturnType<typeof vi.fn>;
}

function harness(overrides: Partial<WireUpdatesOptions> = {}): Harness {
  const order: string[] = [];
  const crumbs: string[] = [];
  const banners: (UpdateBanner | null)[] = [];
  const releases: (() => void)[] = [];
  const held: {
    state: UpdateState;
    onState: (next: UpdateState) => void;
    shown: () => void;
  } = { state: { kind: "idle" }, onState: () => undefined, shown: () => undefined };
  const check = vi.fn(() => Promise.resolve());

  const updates = wireUpdates({
    create: (listener) => {
      held.onState = listener;
      return {
        get state() {
          return held.state;
        },
        check,
        install: () => void order.push("install"),
        stop: () => undefined,
      };
    },
    telemetry: {
      breadcrumb: (text) => void crumbs.push(text),
      // Held open, so a path that did not wait for it would install first.
      installing: (version) => {
        order.push(`installing ${version}`);
        return new Promise<void>((resolve) => releases.push(resolve));
      },
      failedInstall: () => null,
    },
    busy: () => false,
    autoUpdate: () => false,
    menuCopy: TEST_MENU_COPY,
    bannerCopy: BANNER_COPY,
    showBanner: (banner) => void banners.push(banner),
    onWindowShown: (listener) => {
      held.shown = listener;
    },
    ...overrides,
  });
  return {
    updates,
    order,
    crumbs,
    banners,
    check,
    release: () => {
      for (const resolve of releases.splice(0)) resolve();
    },
    emit: (next) => {
      held.state = next;
      held.onState(next);
    },
    shown: () => held.shown(),
  };
}

afterEach(() => {
  recorded.reset();
  vi.useRealTimers();
});

describe("wireUpdates installs through one path", () => {
  it("records the version before installing, from the host's button", async () => {
    const wired = harness();
    wired.emit(READY);

    wired.updates.install();

    expect(wired.order).toEqual(["installing 2.0.0"]);
    wired.release();
    await vi.waitFor(() => expect(wired.order).toEqual(["installing 2.0.0", "install"]));
    expect(wired.crumbs).toContain("installing 2.0.0");
  });

  it("records the version before installing, from the menu", async () => {
    const wired = harness();
    wired.emit(READY);

    entry("Help", "Restart and update")?.click?.();

    expect(wired.order).toEqual(["installing 2.0.0"]);
    wired.release();
    await vi.waitFor(() => expect(wired.order).toEqual(["installing 2.0.0", "install"]));
  });

  it("records the version before installing, from the manual check's box", async () => {
    const wired = harness();
    // The box's first button — restart now — which is the fake's answer.
    wired.emit(READY);

    entry("Help", "Check for updates")?.click?.();

    await vi.waitFor(() => expect(wired.order).toEqual(["installing 2.0.0"]));
    expect(recorded.boxes[0]?.buttons).toEqual(["Restart and update", "Later"]);
    wired.release();
    await vi.waitFor(() => expect(wired.order).toEqual(["installing 2.0.0", "install"]));
  });

  it("records the version before installing, from the automatic restart", async () => {
    vi.useFakeTimers();
    const wired = harness({ autoUpdate: () => true });

    wired.emit(READY);
    await vi.advanceTimersByTimeAsync(INSTALL_GRACE_MS);

    expect(wired.order).toEqual(["installing 2.0.0"]);
    wired.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(wired.order).toEqual(["installing 2.0.0", "install"]);
  });

  it("installs nothing when no version is ready", () => {
    const wired = harness();
    wired.emit({ kind: "none" });

    wired.updates.install();

    expect(wired.order).toEqual([]);
  });
});

describe("wireUpdates reports every state", () => {
  it("pushes the banner and redraws the menu", () => {
    const wired = harness();

    wired.emit(READY);

    expect(wired.banners.at(-1)).toEqual({ text: "ready 2.0.0", action: "install", hint: "restarts" });
    expect(entry("Help", "Restart and update")).toBeDefined();
  });

  it("leaves one breadcrumb per ten percent of a download", () => {
    const wired = harness();

    for (const percent of [1, 4, 9, 12]) {
      wired.emit({ kind: "downloading", version: "2.0.0", percent });
    }

    expect(wired.crumbs).toEqual(["update downloading 2.0.0 0%", "update downloading 2.0.0 10%"]);
  });

  it("asks for an update every time the host's window is shown", () => {
    const wired = harness();

    wired.shown();
    wired.shown();

    expect(wired.check).toHaveBeenCalledTimes(2);
    expect(wired.crumbs).toEqual(["window shown", "window shown"]);
  });
});
