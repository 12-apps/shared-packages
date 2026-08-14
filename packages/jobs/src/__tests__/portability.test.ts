/**
 * THE TOY SECOND HOST — the acceptance gate for portability.
 *
 * A complete, runnable astronomical-observatory backend wired to this package
 * with ONLY its own jobs, its own queues, its own schedules and its own
 * observer. It shares not one word with the application this package was
 * extracted from: no restaurants, no orders, no payments, no pt-BR, and its
 * clocks are set in Honolulu rather than in São Paulo.
 *
 * If this suite compiles and passes, the package presumes nothing about a
 * host's domain. It mounts EVERY published entry point — the root runtime,
 * `/server`, `/hono`, `/inline` and `/bullmq` — because a package is portable
 * at the surfaces a consumer actually imports, not at the one its newest
 * factory happens to cover.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearJobs,
  defineJob,
  InvalidJobDefinitionError,
  listJobs,
  NoJobsRegisteredError,
  type RegisteredJob,
} from "../core/registry";
import {
  configureJobs,
  enqueueJob,
  resetJobRuntime,
  startJobWorkers,
  stopJobs,
} from "../core/runtime";
import { DEFAULT_QUEUE, SWEEP_QUEUE } from "../core/queues";
import type { JobEvents } from "../core/types";
import { __testables } from "../drivers/bullmq";
import { createInlineJobDriver } from "../drivers/inline";
import { jobsRouter } from "../hono/index";
import { createSweepLease, type SweepLeaseDb } from "../lease/sweep-lease";
import { JobsConfigError } from "../server/config";
import { createApiJobs } from "../server/create-api-jobs";

afterEach(() => {
  resetJobRuntime();
  clearJobs();
  vi.unstubAllEnvs();
});

/** The observatory's own log sink. */
function observatoryLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** No queue backend configured — an observatory laptop, not the summit rack. */
function stubSummitEnv(): void {
  vi.stubEnv("REDIS_URL", "");
  vi.stubEnv("JOBS_DRIVER", "");
  vi.stubEnv("JOBS_WORKER", "");
  vi.stubEnv("NODE_ENV", "development");
}

/**
 * The observatory's entire "database": plain objects, no ORM anywhere.
 *
 * Every test stands its own up. The scheduling scenarios mutate the plate
 * archive in place, so a shared store would let one case decide what a later
 * one sees — and building the whole host in one small function is itself part
 * of the evidence that the package owns none of it.
 */
interface Observatory {
  plates: { id: string; digitised: boolean }[];
  calibrations: string[];
  alerts: string[];
}

function createObservatory(): Observatory {
  return {
    plates: [
      { id: "plate-1901-orion", digitised: false },
      { id: "plate-1912-lyra", digitised: false },
    ],
    calibrations: [],
    alerts: [],
  };
}

/**
 * The observatory's jobs, declared exactly as its own modules would.
 *
 * `defineJob` at module scope is the registration; here they are built inside
 * a function so each test starts from an empty registry, which is what a fresh
 * process has.
 */
function declareObservatoryJobs(sky: Observatory) {
  const digitisePlate = defineJob<{ plateId: string }>({
    name: "plates.digitise",
    queue: "plate-archive",
    attempts: 3,
    backoff: { type: "exponential", delayMs: 5_000 },
    handle: async ({ plateId }) => {
      const plate = sky.plates.find((candidate) => candidate.id === plateId);
      if (!plate) throw new Error(`no such plate: ${plateId}`);
      plate.digitised = true;
    },
  });

  const calibrateSpectrograph = defineJob({
    name: "spectrograph.calibrate",
    queue: SWEEP_QUEUE,
    concurrency: 1,
    // 03:00 on Mauna Kea, said out loud rather than left to the server's zone.
    schedule: { pattern: "0 3 * * *", timezone: "Pacific/Honolulu" },
    attempts: 1,
    handle: async () => {
      sky.calibrations.push("spectrograph");
    },
  });

  const watchTransients = defineJob({
    name: "transients.watch",
    queue: SWEEP_QUEUE,
    concurrency: 1,
    schedule: { pattern: "*/10 * * * *" },
    attempts: 1,
    handle: async () => {
      sky.alerts.push("supernova candidate");
    },
  });

  return { digitisePlate, calibrateSpectrograph, watchTransients };
}

describe("a second host: an astronomical observatory", () => {
  it("mounts the whole runtime with nothing but its own vocabulary", async () => {
    stubSummitEnv();
    const log = observatoryLog();
    const sky = createObservatory();
    const jobs = declareObservatoryJobs(sky);

    // In a real host `jobs` is `() => import("./jobs")` — the import IS the
    // registration. Here the declarations already ran, so the host passes the
    // references it holds, which the config accepts for exactly this case.
    const api = createApiJobs({
      jobs: [
        jobs.digitisePlate,
        jobs.calibrateSpectrograph,
        jobs.watchTransients,
      ] as RegisteredJob<never>[],
      driver: createInlineJobDriver({ logger: log, await: true }),
      logger: log,
      worker: true,
      installShutdownHooks: false,
    });
    await api.start();

    await jobs.digitisePlate.enqueue({ plateId: "plate-1901-orion" });

    expect(sky.plates[0]?.digitised).toBe(true);
    const [health] = api.routes;
    const response = await health?.handle();
    expect(response?.status).toBe(200);
    expect(response?.body).toMatchObject({
      status: "ok",
      checks: { driver: "inline", jobs: 3, schedules: 2, consuming: true },
    });
  });

  it("serves its health probe through the Hono adapter under its own prefix", async () => {
    stubSummitEnv();
    const log = observatoryLog();
    const sky = createObservatory();
    const jobs = declareObservatoryJobs(sky);
    const api = createApiJobs({
      jobs: [jobs.digitisePlate] as RegisteredJob<never>[],
      logger: log,
    });
    await api.start();

    // The prefix is the host's, not the package's.
    const app = new Hono().route("/ops/telescope/jobs", jobsRouter(api));
    const response = await app.request("/ops/telescope/jobs/health");

    expect(response.status).toBe(200);
    expect((await response.json()) as { status: string }).toMatchObject({ status: "ok" });
  });

  it("runs the root path — configure, register, consume, drain — by hand", async () => {
    // The package root is a first-class entry point, not the factory's
    // plumbing: a host on another framework wires exactly this.
    const log = observatoryLog();
    const sky = createObservatory();
    const jobs = declareObservatoryJobs(sky);
    const driver = createInlineJobDriver({ logger: log, await: true });

    configureJobs({ driver, logger: log });
    await startJobWorkers();
    await jobs.digitisePlate.enqueue({ plateId: "plate-1912-lyra" });
    await stopJobs();

    expect(sky.plates[1]?.digitised).toBe(true);
    expect(listJobs().map((job) => job.name)).toEqual([
      "plates.digitise",
      "spectrograph.calibrate",
      "transients.watch",
    ]);
  });

  it("takes a sweep lease against the observatory's own store", async () => {
    // The lease seam is duck-typed: this host's "database" is two mock
    // functions with the right shape, and no Prisma is anywhere in sight.
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn();
    const db = (): Promise<SweepLeaseDb> =>
      Promise.resolve({ sweepLease: { updateMany, create } });
    const { withSweepLease, holder } = createSweepLease({ db, holder: "dome-north" });

    const outcome = await withSweepLease("transients.watch", 60_000, async () => "swept");

    expect(outcome).toEqual({ ran: true, result: "swept" });
    expect(holder).toBe("dome-north");
    expect(updateMany.mock.calls[0]?.[0].where.name).toBe("transients.watch");
  });

  it("reports its own dead-letters to its own observer", async () => {
    // The package notifies nobody. The observatory wires the moment to its
    // pager, and gets `terminal` to tell a retry from a give-up.
    stubSummitEnv();
    const log = observatoryLog();
    const paged: string[] = [];
    const events: JobEvents = {
      onJobFailed: ({ name, terminal }) => {
        if (terminal) paged.push(name);
      },
    };
    const seeingIsBad = defineJob({
      name: "dome.close",
      attempts: 2,
      handle: async () => {
        throw new Error("the dome motor is jammed");
      },
    });
    const api = createApiJobs({
      jobs: [seeingIsBad] as RegisteredJob<never>[],
      driver: createInlineJobDriver({ logger: log, await: true, events }),
      logger: log,
    });
    await api.start();

    await seeingIsBad.enqueue();

    expect(paged).toEqual(["dome.close"]);
  });

  it("keeps its sweeps single-flight and lets the busy queue use the default", () => {
    const sky = createObservatory();
    const jobs = declareObservatoryJobs(sky);
    const sweeps = listJobs().filter((job) => job.queue === SWEEP_QUEUE);

    expect(sweeps.map((job) => job.name)).toEqual([
      "spectrograph.calibrate",
      "transients.watch",
    ]);
    expect(__testables.resolveConcurrency(sweeps)).toBe(1);
    // The plate archive states nothing, so it takes the driver's default.
    expect(__testables.resolveConcurrency([jobs.digitisePlate.definition])).toBe(
      __testables.DEFAULT_CONCURRENCY,
    );
    // Both queue names are the PACKAGE's vocabulary, composed by the host
    // rather than re-typed: the observatory names `plate-archive` itself and
    // imports the other two.
    expect(new Set([DEFAULT_QUEUE, SWEEP_QUEUE, "plate-archive"]).size).toBe(3);
  });
});

describe("a second host: the guards fire for it too", () => {
  // Portability is not only "it compiles with other nouns". A second host must
  // inherit the same refusals, or the package is portable in shape and
  // fail-open in practice.

  it("refuses an observatory that declares no jobs", () => {
    stubSummitEnv();

    expect(() => createApiJobs({ jobs: [], logger: observatoryLog() })).toThrow(
      JobsConfigError,
    );
  });

  it("refuses a worker with an empty registry on the root path", async () => {
    configureJobs({ driver: createInlineJobDriver({ logger: observatoryLog() }) });

    await expect(startJobWorkers()).rejects.toThrow(NoJobsRegisteredError);
  });

  it("refuses a nightly sweep whose cron pattern would never fire", () => {
    expect(() =>
      defineJob({
        name: "dome.open",
        schedule: { pattern: "@nightly" },
        handle: async () => undefined,
      }),
    ).toThrow(InvalidJobDefinitionError);
  });

  it("refuses to enqueue a job this observatory never registered", async () => {
    const log = observatoryLog();
    const enqueue = vi.fn().mockResolvedValue({ enqueued: true });
    configureJobs({
      logger: log,
      driver: {
        kind: "spy",
        enqueue,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      },
    });

    await expect(
      enqueueJob(
        { name: "telescope.slew", handle: () => Promise.resolve() },
        { target: "M31" },
        {},
      ),
    ).resolves.toEqual({ enqueued: false, reason: "unregistered" });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
