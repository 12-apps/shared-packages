import { afterEach, describe, expect, it, vi } from "vitest";

import { clearJobs, defineJob, type RegisteredJob } from "../../core/registry";
import { resetJobRuntime } from "../../core/runtime";
import { createApiJobs } from "../../server/create-api-jobs";
import { jobsRouter } from "../index";

/**
 * The Hono adapter carries the descriptor's own status and body — it never
 * reinterprets either, which is what lets a probe trust the 503.
 */

afterEach(() => {
  resetJobRuntime();
  clearJobs();
  vi.unstubAllEnvs();
});

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** One declared job — `createApiJobs` refuses a config that names none. */
function oneJob(name = "test.declared"): RegisteredJob<never>[] {
  return [defineJob({ name, handle: async () => undefined }) as RegisteredJob<never>];
}

describe("jobsRouter", () => {
  it("serves the health route with the handler's status and body", async () => {
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("JOBS_DRIVER", "");
    vi.stubEnv("JOBS_WORKER", "");
    vi.stubEnv("NODE_ENV", "development");
    const api = createApiJobs({ jobs: oneJob(), logger: silent });
    await api.start();

    const app = jobsRouter(api);
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; checks: { driver: string } };
    expect(body.status).toBe("ok");
    expect(body.checks.driver).toBe("inline");
  });

  it("answers 503 for a runtime nobody started", async () => {
    const api = createApiJobs({ jobs: oneJob(), logger: silent });

    const app = jobsRouter(api);
    const response = await app.request("/health");

    expect(response.status).toBe(503);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("degraded");
  });
});
