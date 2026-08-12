/**
 * `@12-apps/jobs/server` — the backend factory.
 *
 * One call wires the whole operational half: driver resolution (with the
 * inline zero-config default), job registration, the worker switch, graceful
 * drain, the sweep lease and a health endpoint the host mounts wherever its
 * internal probes live.
 *
 *     const jobsApi = createApiJobs({
 *       jobs: () => import("./lib/jobs"),      // defineJob modules
 *       db: () => getPrismaClient(),           // the sweep_leases table
 *     });
 *     await jobsApi.start();                   // at process start
 *     app.route("/api/internal/jobs", jobsRouter(jobsApi));   // ./hono
 *
 * There is deliberately NO `createWebJobs` half: this runtime has no screens
 * — its API surface is the health endpoint, and its user-visible effects are
 * whatever the host's job handlers do. See ADOPTING.md.
 */
export { createApiJobs } from "./create-api-jobs";
export type {
  JobsApi,
  JobsDriverChoice,
  JobsHealth,
  JobsResponse,
  JobsRoute,
  JobsServerConfig,
  JobsSource,
} from "./create-api-jobs";
