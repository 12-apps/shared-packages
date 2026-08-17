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
 *
 * Every case builds its OWN module and its own deps. `mount()` writes into a
 * process-wide registry, so a module shared across cases would make them
 * order-dependent — and the one case that asserts "nothing is registered yet"
 * would pass or fail on whichever neighbour ran first.
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

/** A fresh module, as a package's own module scope would declare it. */
function paymentsJobs() {
  return defineJobModule<Deps>()({ namespace: "payments", jobs: { watch, expire } });
}

/** A fresh host, whose array is what a handler having run is read off. */
function hostDeps(): Deps {
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
    paymentsJobs();

    expect(listJobs()).toHaveLength(0);
  });

  it("namespaces every name, so two packages cannot collide on `drain`", () => {
    const jobs = paymentsJobs();
    jobs.mount(hostDeps());

    expect(findJob("payments.watch-settlement")).toBeDefined();
    expect(findJob("payments.expire-watches")).toBeDefined();
    expect(jobs.nameOf("watch")).toBe("payments.watch-settlement");
  });

  it("carries the blueprint's policy through, so a host is never asked for it", () => {
    paymentsJobs().mount(hostDeps());

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
    const mounted = paymentsJobs().mount(hostDeps());

    expect(mounted.jobs).toHaveLength(2);
    expect([...mounted.names].sort()).toEqual([
      "payments.expire-watches",
      "payments.watch-settlement",
    ]);
  });

  it("binds the host's deps into the handler", async () => {
    const host = hostDeps();
    const jobs = paymentsJobs();
    configureJobs({ driver: createInlineJobDriver() });
    jobs.mount(host);

    await jobs.enqueue.watch({ chargeId: "ch_1" });

    expect(host.seen).toEqual(["host:ch_1"]);
  });
});

describe("enqueueing from the package's own emit sites", () => {
  it("resolves through the registry at call time, not at mount", async () => {
    // The handle is taken from the module BEFORE anything is mounted, which is
    // the shape a package's emit sites are in — imported, and holding no deps.
    // If it had bound anything at declaration it would be stale by the enqueue.
    const jobs = paymentsJobs();
    const emit = jobs.enqueue.watch;
    const host = hostDeps();

    configureJobs({ driver: createInlineJobDriver() });
    jobs.mount(host);
    const result = await emit({ chargeId: "ch_2" });

    expect(result.enqueued).toBe(true);
    expect(host.seen).toEqual(["host:ch_2"]);
  });

  it("skips rather than throws when the module was never mounted", async () => {
    // Reached from a request path — a charge being raised. A wiring mistake in
    // the deferred half must not fail the money path in front of it.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await paymentsJobs().enqueue.watch({ chargeId: "ch_3" });

    expect(result).toEqual({ enqueued: false, reason: "unregistered" });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("is not mounted"));
  });
});

describe("defineJobModule — refusing what would fail silently", () => {
  it("refuses a blank namespace, which would yield a bare `.name`", () => {
    expect(() => defineJobModule<Deps>()({ namespace: "  ", jobs: { watch } })).toThrow(
      TypeError,
    );
  });

  it("refuses a dotted namespace, which no host could parse back", () => {
    expect(() =>
      defineJobModule<Deps>()({ namespace: "payments.core", jobs: { watch } }),
    ).toThrow(TypeError);
  });
});
