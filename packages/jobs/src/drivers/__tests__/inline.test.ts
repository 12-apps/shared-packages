import { describe, expect, it, vi } from "vitest";

import type { AnyJobDefinition } from "../../core/types";
import { createInlineJobDriver } from "../inline";

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function definition(overrides: Partial<AnyJobDefinition> = {}): AnyJobDefinition {
  return { name: "a.job", handle: () => Promise.resolve(), ...overrides };
}

describe("inline driver", () => {
  it("awaits the handler so a test sees the side effect", async () => {
    const seen: string[] = [];
    const driver = createInlineJobDriver({ logger: silentLogger() });

    await driver.enqueue(
      definition({ handle: (payload) => {
        seen.push(payload as string);
        return Promise.resolve();
      } }),
      "one",
      {},
    );

    expect(seen).toEqual(["one"]);
  });

  it("retries up to `attempts` and records the run", async () => {
    const handle = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(undefined);
    const driver = createInlineJobDriver({ logger: silentLogger() });

    await driver.enqueue(definition({ attempts: 3, handle }), undefined, {});

    expect(handle).toHaveBeenCalledTimes(2);
    expect(driver.runs).toEqual([
      { name: "a.job", payload: undefined, attempts: 2, error: undefined },
    ]);
  });

  it("swallows a handler that fails every attempt, logging it once", async () => {
    const logger = silentLogger();
    const handle = vi.fn().mockRejectedValue(new Error("permanent"));
    const driver = createInlineJobDriver({ logger });

    await expect(
      driver.enqueue(definition({ attempts: 2, handle }), undefined, {}),
    ).resolves.toEqual({ enqueued: true });

    expect(handle).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(driver.runs[0]?.error).toBeInstanceOf(Error);
  });

  it("warns that a delay is ignored instead of silently dropping it", async () => {
    const logger = silentLogger();
    const driver = createInlineJobDriver({ logger });

    await driver.enqueue(definition(), undefined, { delayMs: 3_000 });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("ignored a 3000ms delay"),
    );
  });

  it("warns that registered schedules will never fire", async () => {
    const logger = silentLogger();
    const driver = createInlineJobDriver({ logger });

    await driver.start([definition({ schedule: { pattern: "0 * * * *" } })]);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("a.job"));
  });
});
