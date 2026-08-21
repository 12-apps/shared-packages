/**
 * `@12-apps/jobs`'s wiring compliance, asserted HERE rather than in jobs'
 * own suite: wiring already devDepends on jobs (the blueprint-compat pair in
 * `jobs-compat.test.ts`), so an edge back from jobs would close a turbo
 * build cycle. The manifest stays untyped pure data over there, and this
 * file gives it the same "fails in a test run before any host sees it"
 * guarantee — one package over, along the dependency edge that exists.
 */

import { describe, expect, it } from "vitest";

import { jobsManifest } from "@12-apps/jobs/manifest";
import jobsPackageJson from "@12-apps/jobs/package.json";
import type { WireEnvVar } from "../contract/env";
import type { PackageManifest } from "../contract/manifest";
import { assertDbMirror, assertEnvMirror, assertExportsMirror, defineManifest } from "../producer";

const manifest: PackageManifest = jobsManifest;
/** Read afresh per test — the flakiness lane refuses shared test-scope bindings. */
function declaredEnvOf(): readonly WireEnvVar[] {
  return jobsManifest.env;
}

describe("the jobs manifest, through wiring's own producer", () => {
  it("passes the producer assertions", () => {
    expect(defineManifest(manifest)).toBe(manifest);
  });

  it("declares a pure-data manifest: identity, env and db, no runtime inventory", () => {
    expect(manifest.name).toBe("@12-apps/jobs");
    expect(manifest.contract).toBe(1);
    // Hosts mount the queue directly today; declaring `server` would oblige
    // every one of them to adopt or decline through the consumer.
    expect(manifest.server).toBeUndefined();
    expect(manifest.web).toBeUndefined();
  });

  it("declares the SweepLease partial — composed mode, migrations alongside", () => {
    // The one capability the tarball shipped that no manifest said so: the
    // lease table `withSweepLease` claims its names in. Composed, because the
    // lease names a JOB — no relation into any host table.
    expect(manifest.db).toEqual({
      partial: "prisma/jobs.prisma",
      migrations: "prisma/migrations",
    });
  });

  it("declares the env surface — every key optional, because absence selects a driver", () => {
    const names = declaredEnvOf().map((declared) => declared.name);
    expect(names).toEqual(["REDIS_URL", "JOBS_DRIVER", "JOBS_WORKER", "JOBS_QUEUE_PREFIX"]);
    expect(declaredEnvOf().some((declared) => declared.required)).toBe(false);
    // The consumer flag rides on the process that runs the queue.
    expect(declaredEnvOf().find((declared) => declared.name === "JOBS_WORKER")?.scope).toBe("worker");
  });

  it("mirrors env and db into package.json, and the exports map matches the declarations", () => {
    expect(() => assertDbMirror(manifest, jobsPackageJson)).not.toThrow();
    expect(() => assertEnvMirror(manifest, jobsPackageJson)).not.toThrow();
    expect(() => assertExportsMirror(manifest, jobsPackageJson)).not.toThrow();
  });
});
