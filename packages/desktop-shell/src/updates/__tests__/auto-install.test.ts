import { describe, expect, it } from "vitest";

import {
  INSTALL_GRACE_MS,
  INSTALL_RETRY_MS,
  createAutoInstall,
} from "../auto-install";

function clock() {
  const pending: { run: () => void; ms: number }[] = [];
  return {
    later: (run: () => void, ms: number) => void pending.push({ run, ms }),
    next: () => pending.shift(),
    pending,
  };
}

describe("an update that installs itself", () => {
  it("restarts into a ready version after the grace, with nobody pressing anything", () => {
    const timers = clock();
    const installed: string[] = [];
    const feed = createAutoInstall({
      autoUpdate: () => true,
      busy: () => false,
      install: (version) => installed.push(version),
      later: timers.later,
    });

    feed({ kind: "ready", version: "0.1.67" });

    expect(timers.pending.map((timer) => timer.ms)).toEqual([INSTALL_GRACE_MS]);
    timers.next()?.run();
    expect(installed).toEqual(["0.1.67"]);
  });

  it("never restarts in the middle of work — it waits and tries again", () => {
    const timers = clock();
    const installed: string[] = [];
    let working = true;
    const feed = createAutoInstall({
      autoUpdate: () => true,
      busy: () => working,
      install: (version) => installed.push(version),
      later: timers.later,
    });

    feed({ kind: "ready", version: "0.1.67" });
    timers.next()?.run();

    expect(installed).toEqual([]);
    expect(timers.pending.map((timer) => timer.ms)).toEqual([INSTALL_RETRY_MS]);
    working = false;
    timers.next()?.run();
    expect(installed).toEqual(["0.1.67"]);
  });

  it("leaves it to the button when automatic updates are switched off", () => {
    const timers = clock();
    const feed = createAutoInstall({
      autoUpdate: () => false,
      busy: () => false,
      install: () => {
        throw new Error("must not install");
      },
      later: timers.later,
    });

    feed({ kind: "ready", version: "0.1.67" });

    expect(timers.pending).toEqual([]);
  });

  it("schedules one restart per version, however often the state repeats", () => {
    const timers = clock();
    const feed = createAutoInstall({
      autoUpdate: () => true,
      busy: () => false,
      install: () => undefined,
      later: timers.later,
    });

    feed({ kind: "downloading", version: "0.1.67", percent: 99 });
    feed({ kind: "ready", version: "0.1.67" });
    feed({ kind: "ready", version: "0.1.67" });

    expect(timers.pending).toHaveLength(1);
  });

  it("never retries by itself a version that already failed to install here", () => {
    // Otherwise a failing installer quits the agent on every boot, and the
    // machine is left with the agent down at every start.
    const timers = clock();
    const feed = createAutoInstall({
      autoUpdate: () => true,
      busy: () => false,
      failedBefore: () => "0.1.67",
      install: () => {
        throw new Error("must not install");
      },
      later: timers.later,
    });

    feed({ kind: "ready", version: "0.1.67" });
    expect(timers.pending).toEqual([]);

    feed({ kind: "ready", version: "0.1.68" });
    expect(timers.pending).toHaveLength(1);
  });
});
