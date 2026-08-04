import { describe, expect, it } from "vitest";

import type { AnyJobDefinition } from "../../core/types";
import { __testables } from "../bullmq";

/**
 * The queue-concurrency rule. Pinned on its own because getting it wrong is
 * SILENT: a job that asked for single-flight would simply run concurrently,
 * and nothing would fail — the sweeps would just start racing each other again.
 */
const { resolveConcurrency, DEFAULT_CONCURRENCY } = __testables;

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
});
