import { Hono } from "hono";

import type { JobsRoute } from "../server/create-api-jobs";

/**
 * `@12-apps/jobs/hono` — the jobs endpoints as a mountable router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is
 * the adapter for the framework we happen to use. It lives behind its own
 * subpath with `hono` as an OPTIONAL peer, so a host on Express — or one that
 * mounts the descriptors itself — never resolves Hono at all. Importing the
 * package root or `/server` does not reach this file.
 *
 * A host writes:
 *
 *     const jobsApi = createApiJobs({ jobs: () => import("./jobs") });
 *     await jobsApi.start();
 *     app.route("/api/internal/jobs", jobsRouter(jobsApi));
 *
 * It takes the API INSTANCE rather than the config, deliberately: the host
 * must call `start()` on the same instance whose routes report health, and a
 * router that built its own would answer for a runtime nobody started.
 *
 * Auth stays the host's: mount this under whatever guard the deployment's
 * internal probes live behind (future-pay's `/api/internal/*` is answered
 * only machine-to-machine; the reverse proxy 404s it from the internet).
 */
export function jobsRouter(api: { routes: JobsRoute[] }): Hono {
  const app = new Hono();
  for (const route of api.routes) {
    // Every route today is a GET; a future method would extend this dispatch,
    // and forgetting to would fail the mount loudly rather than 404 quietly.
    if (route.method !== "GET") {
      throw new Error(`jobsRouter cannot mount a ${String(route.method)} route.`);
    }
    app.get(route.path, async (c) => {
      const response = await route.handle();
      // The status travels with the body the handler chose; this adapter
      // never reinterprets either.
      return c.json(response.body as Record<string, unknown>, response.status as 200);
    });
  }
  return app;
}
