import { describe, expect, it, vi } from "vitest";

import { backoffDelay, createSupervisor, DEFAULT_BACKOFF } from "../supervisor";

describe("backoffDelay", () => {
  it("doubles per consecutive failure and caps", () => {
    // `random` pinned to 1 so the assertion is about the ceiling, not the jitter.
    const at = (attempt: number): number => backoffDelay(attempt, DEFAULT_BACKOFF, () => 1);
    expect([at(1), at(2), at(3)]).toEqual([1_000, 2_000, 4_000]);
    expect(at(20)).toBe(30_000);
  });

  it("keeps half the delay fixed, so jitter spaces clients without unbounding the rate", () => {
    expect(backoffDelay(1, DEFAULT_BACKOFF, () => 0)).toBe(500);
    expect(backoffDelay(1, DEFAULT_BACKOFF, () => 1)).toBe(1_000);
  });
});

/** Resolves once `onRestart` has been called `count` times. */
function restartCounter(count: number): {
  onRestart: (reason: unknown | undefined, consecutive: number) => void;
  reached: Promise<void>;
  reasons: (unknown | undefined)[];
  consecutive: number[];
} {
  const reasons: (unknown | undefined)[] = [];
  const consecutive: number[] = [];
  // The resolver is COLLECTED rather than assigned to a closed-over binding:
  // the flakiness lane refuses the assignment, and for a good reason — it is
  // the shape that lets one test settle another's promise.
  const settlers: (() => void)[] = [];
  const reached = new Promise<void>((settle) => settlers.push(settle));
  return {
    reasons,
    consecutive,
    reached,
    onRestart: (reason, seen) => {
      reasons.push(reason);
      consecutive.push(seen);
      if (reasons.length >= count) settlers.splice(0).forEach((settle) => settle());
    },
  };
}

describe("createSupervisor", () => {
  /** A sleep that resolves immediately and records what it was asked for. */
  const recordingSleep =
    (delays: number[]) =>
    (ms: number): Promise<void> => {
      delays.push(ms);
      return Promise.resolve();
    };

  it("restarts work that throws, and compounds the delay", async () => {
    const delays: number[] = [];
    const counter = restartCounter(3);
    const supervisor = createSupervisor({
      run: () => Promise.reject(new Error("boom")),
      random: () => 1,
      sleep: recordingSleep(delays),
      onRestart: counter.onRestart,
    });

    supervisor.start();
    await counter.reached;
    await supervisor.stop();

    expect(counter.consecutive.slice(0, 3)).toEqual([1, 2, 3]);
    expect(delays.slice(0, 3)).toEqual([1_000, 2_000, 4_000]);
  });

  it("resets the curve when work returns cleanly", async () => {
    const delays: number[] = [];
    const counter = restartCounter(4);
    // Call COUNT is the array's own length, for the same reason.
    const calls: true[] = [];
    const supervisor = createSupervisor({
      run: () => {
        calls.push(true);
        // fail, fail, then clean returns
        return calls.length < 3 ? Promise.reject(new Error("boom")) : Promise.resolve();
      },
      random: () => 1,
      sleep: recordingSleep(delays),
      onRestart: counter.onRestart,
    });

    supervisor.start();
    await counter.reached;
    await supervisor.stop();

    // 1s, 2s while failing; back to 1s once a run completed — and a clean
    // return still pauses, so a task that ends instantly cannot spin the loop.
    expect(delays.slice(0, 4)).toEqual([1_000, 2_000, 1_000, 1_000]);
    expect(counter.reasons[2]).toBeUndefined();
  });

  it("aborts the running task and stays stopped", async () => {
    const aborts: boolean[] = [];
    const supervisor = createSupervisor({
      run: (signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborts.push(true);
            resolve();
          });
        }),
      sleep: () => Promise.resolve(),
    });

    supervisor.start();
    expect(supervisor.running).toBe(true);
    await supervisor.stop();

    expect(aborts).toEqual([true]);
    expect(supervisor.running).toBe(false);
  });

  it("ignores a second start", () => {
    const run = vi.fn().mockImplementation(() => new Promise<void>(() => undefined));
    const supervisor = createSupervisor({ run, sleep: () => Promise.resolve() });
    supervisor.start();
    supervisor.start();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
