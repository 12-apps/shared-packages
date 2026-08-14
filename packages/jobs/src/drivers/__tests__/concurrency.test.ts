import { UnrecoverableError } from "bullmq";
import { describe, expect, it } from "vitest";

import { assertValidRetention, InvalidJobRetentionError } from "../../core/retention";
import type { AnyJobDefinition, JobRetention } from "../../core/types";
import { DEFAULT_JOB_RETENTION, retentionOptions } from "../bullmq-policy";
import { __testables } from "../bullmq";

/**
 * The three BullMQ policy rules that are SILENT when wrong: a job that asked
 * for single-flight simply running concurrently (nothing fails — the sweeps
 * just start racing each other again), a dead-letter reporting itself as one
 * more retry (nothing fails — the host's pager just never goes off), and a
 * retention window that stops bounding the backend instead of shrinking it
 * (nothing fails — Redis fills up weeks later and starts refusing writes).
 */
const { resolveConcurrency, isTerminalFailure, DEFAULT_CONCURRENCY } = __testables;

function job(overrides: Partial<AnyJobDefinition> = {}): AnyJobDefinition {
  return { name: "a.job", handle: () => Promise.resolve(), ...overrides };
}

describe("resolveConcurrency", () => {
  it("falls back to the default when no job on the queue states one", () => {
    expect(resolveConcurrency([job(), job({ name: "b.job" })])).toBe(DEFAULT_CONCURRENCY);
  });

  it("honours a stated 1 instead of raising it to the default", () => {
    // The regression this exists for: `Math.max(DEFAULT, ...)` silently turns
    // single-flight back into the default and undoes the guarantee.
    expect(resolveConcurrency([job({ concurrency: 1 })])).toBe(1);
  });

  it("takes the highest STATED value when several are given", () => {
    expect(
      resolveConcurrency([job({ concurrency: 1 }), job({ name: "b.job", concurrency: 4 })]),
    ).toBe(4);
  });

  it("ignores a stated value alongside unstated ones rather than averaging in the default", () => {
    expect(resolveConcurrency([job({ concurrency: 2 }), job({ name: "b.job" })])).toBe(2);
  });

  it("ignores a nonsensical value", () => {
    expect(resolveConcurrency([job({ concurrency: 0 })])).toBe(DEFAULT_CONCURRENCY);
    expect(resolveConcurrency([job({ concurrency: -3 })])).toBe(DEFAULT_CONCURRENCY);
  });

  it("takes the host's own default when one is configured, and still yields to a stated value", () => {
    // `defaultConcurrency` is the host's operational knob. It replaces the
    // package's number where none is stated, and never overrides one that is.
    expect(resolveConcurrency([job(), job({ name: "b.job" })], 12)).toBe(12);
    expect(resolveConcurrency([job({ concurrency: 1 })], 12)).toBe(1);
  });
});

describe("retentionOptions", () => {
  // BullMQ derives its count trim from the number it is given, so a NEGATIVE
  // count removes one job per completion instead of holding the set at a
  // ceiling — the unbounded completed-set the default exists to prevent,
  // reached through a config knob this PR is what adds.

  it("passes a sane window straight through", () => {
    expect(
      retentionOptions({
        completed: { ageSeconds: 60, count: 10 },
        failed: { ageSeconds: 120, count: 20 },
      }),
    ).toEqual({
      removeOnComplete: { age: 60, count: 10 },
      removeOnFail: { age: 120, count: 20 },
    });
  });

  it("refuses NaN — the likeliest way in, from an unset env var", () => {
    // `ageSeconds: Number(process.env.JOBS_KEEP_H)` with the variable unset.
    expect(() =>
      retentionOptions({
        completed: { ageSeconds: Number.NaN, count: 10 },
        failed: { ageSeconds: 120, count: 20 },
      }),
    ).toThrow(InvalidJobRetentionError);
  });

  it("refuses a non-positive count, which stops bounding rather than shrinking", () => {
    for (const count of [0, -1]) {
      expect(() =>
        retentionOptions({
          completed: { ageSeconds: 60, count },
          failed: { ageSeconds: 120, count: 20 },
        }),
      ).toThrow(/retention\.completed\.count/);
    }
  });

  it("checks the failed half too, not just the completed one", () => {
    expect(() =>
      retentionOptions({
        completed: { ageSeconds: 60, count: 10 },
        failed: { ageSeconds: -120, count: 20 },
      }),
    ).toThrow(/retention\.failed\.ageSeconds/);
  });

  it("refuses a structurally malformed window rather than reading undefined off it", () => {
    expect(() =>
      retentionOptions({ completed: { ageSeconds: 60, count: 10 } } as JobRetention),
    ).toThrow(/retention\.failed/);
  });

  it("accepts an omitted retention and the package default", () => {
    expect(() => assertValidRetention(undefined)).not.toThrow();
    expect(() => retentionOptions(DEFAULT_JOB_RETENTION)).not.toThrow();
  });
});

describe("isTerminalFailure", () => {
  // `terminal` is what a host keys its pager on: a dead-letter is worth waking
  // somebody for, and a retry that will happen in five seconds is not.

  it("is false while attempts remain", () => {
    expect(isTerminalFailure(1, 3, new Error("transient"))).toBe(false);
    expect(isTerminalFailure(2, 3, new Error("transient"))).toBe(false);
  });

  it("is true once the budget is spent", () => {
    expect(isTerminalFailure(3, 3, new Error("permanent"))).toBe(true);
    // Defensive: a driver reporting more attempts than the budget is still done.
    expect(isTerminalFailure(4, 3, new Error("permanent"))).toBe(true);
  });

  it("is true for an unrecoverable failure however many attempts remain", () => {
    // The unregistered-name path throws this, and BullMQ will not retry it —
    // reporting it as non-terminal would promise a retry that never comes.
    expect(
      isTerminalFailure(1, 5, new UnrecoverableError("No handler registered")),
    ).toBe(true);
  });
});
