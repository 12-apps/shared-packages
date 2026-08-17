import { afterEach, describe, expect, it, vi } from "vitest";

import { createInlineJobDriver } from "../../drivers/inline";
import { defineJobModule, type JobBlueprint } from "../module";
import { clearJobs, findJob, listJobs } from "../registry";
import { configureJobs, resetJobRuntime } from "../runtime";

/**
 * The package-side seam: a package declares blueprints, a host binds its deps.
 *
 * What these pin is the split itself — that declaring registers NOTHING, that
 * the host's one line is the whole integration, and that the package can
 * enqueue its own work from a module that holds no deps. Each of those is a
 * property a host could otherwise satisfy by accident and lose silently.
 */

interface Deps {
  readonly seen: string[];
  readonly label: string;
}

const watch: JobBlueprint<{ chargeId: string }, Deps> = {
  name: "watch-settlement",
  attempts: 3,
  backoff: { type: "exponential", delayMs: 5_000 },
  handle: async ({ chargeId }, deps) => {
    deps.seen.push(`${deps.label}:${chargeId}`);
  },
};

const expire: JobBlueprint<void, Deps> = {
  name: "expire-watches",
  queue: "sweeps",
  concurrency: 1,
  schedule: { pattern: "*/5 * * * *" },
  handle: async (_payload, deps) => {
    deps.seen.push(`${deps.label}:expired`);
  },
};

const module = defineJobModule<Deps>()({
  namespace: "payments",
  jobs: { watch, expire },
});

function deps(): Deps {
  return { seen: [], label: "host" };
}

afterEach(() => {
  clearJobs();
  resetJobRuntime();
  vi.restoreAllMocks();
});

describe("defineJobModule", () => {
  it("registers nothing until a host mounts it", () => {
    // The whole point of a blueprint: importing a package must not put work
    // into a registry the host never asked to run.
    expect(listJobs()).toHaveLength(0);
  });

  it("namespaces every name, so two packages cannot collide on `drain`", () => {
    module.mount(deps());

    expect(findJob("payments.watch-settlement")).toBeDefined();
    expect(findJob("payments.expire-watches")).toBeDefined();
    expect(module.nameOf("watch")).toBe("payments.watch-settlement");
  });

  it("carries the blueprint's policy through, so a host is never asked for it", () => {
    module.mount(deps());

    // The retry policy, the queue, the schedule and the concurrency are the
    // package's decisions. A host that had to restate them is a host that can
    // get them wrong — which is the failure this seam exists to remove.
    expect(findJob("payments.watch-settlement")).toMatchObject({
      attempts: 3,
      backoff: { type: "exponential", delayMs: 5_000 },
    });
    expect(findJob("payments.expire-watches")).toMatchObject({
      queue: "sweeps",
      concurrency: 1,
      schedule: { pattern: "*/5 * * * *" },
    });
  });

  it("answers the jobs and their wire names for createApiJobs", () => {
    const mounted = module.mount(deps());

    expect(mounted.jobs).toHaveLength(2);
    expect([...mounted.names].sort()).toEqual([
      "payments.expire-watches",
      "payments.watch-settlement",
    ]);
  });

  it("binds the host's deps into the handler", async () => {
    const host = deps();
    configureJobs({ driver: createInlineJobDriver() });
    module.mount(host);

    await module.enqueue.watch({ chargeId: "ch_1" });

    expect(host.seen).toEqual(["host:ch_1"]);
  });
});

describe("enqueueing from the package's own emit sites", () => {
  it("resolves through the registry at call time, not at mount", async () => {
    // `module.enqueue.watch` was captured when the module was DECLARED, above,
    // long before this mount — which is the shape a package's emit sites are
    // in. If the handle had bound anything at declaration it would be stale.
    const host = deps();
    configureJobs({ driver: createInlineJobDriver() });
    module.mount(host);

    const result = await module.enqueue.watch({ chargeId: "ch_2" });

    expect(result.enqueued).toBe(true);
    expect(host.seen).toEqual(["host:ch_2"]);
  });

  it("skips rather than throws when the module was never mounted", async () => {
    // Reached from a request path — a charge being raised. A wiring mistake in
    // the deferred half must not fail the money path in front of it.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await module.enqueue.watch({ chargeId: "ch_3" });

    expect(result).toEqual({ enqueued: false, reason: "unregistered" });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("is not mounted"));
  });
});

describe("defineJobModule — refusing what would fail silently", () => {
  it("refuses a blank namespace, which would yield a bare `.name`", () => {
    expect(() =>
      defineJobModule<Deps>()({ namespace: "  ", jobs: { watch } }),
    ).toThrow(TypeError);
  });

  it("refuses a dotted namespace, which no host could parse back", () => {
    expect(() =>
      defineJobModule<Deps>()({ namespace: "payments.core", jobs: { watch } }),
    ).toThrow(TypeError);
  });
});
