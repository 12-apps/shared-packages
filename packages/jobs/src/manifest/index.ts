/**
 * `@12-apps/jobs/manifest` — the SHARED wiring manifest.
 *
 * A pure-data manifest: identity, the env surface and the db contribution.
 * The runtime capabilities deliberately stay UNDECLARED for now — hosts mount
 * this package directly (`createJobs`, the Hono adapter) rather than through
 * the wiring consumer, and inventorying `server` here would oblige every one
 * of them to adopt or decline it. The env declaration carries its own weight
 * today: the exact `process.env` keys the queue reads, mirrored into
 * `package.json` for tooling that cannot execute TypeScript, so a host's
 * `.env.example` can stop rotting by hand.
 *
 * The db contribution is the SweepLease partial — the single-flight lease
 * table `withSweepLease` claims its names in. It was the one capability this
 * package shipped that no manifest said so: the partial and its migration
 * rode the tarball while every host discovered them through a sync script's
 * comment, which is exactly the silent-arrival the declaration (and its
 * `package.json` mirror, readable by plain-Node assemblers) exists to end.
 * Host-agnostic by construction: the lease names a JOB, so the model carries
 * no relation into any host table — the `composed` mode's qualification.
 *
 * Every key is OPTIONAL by this package's own design: absence selects the
 * inline/off driver and logs the decision — it never throws. Config always
 * wins over env (`config.x ?? process.env.Y`). `NODE_ENV` is read too, but
 * it is platform vocabulary, not a contribution.
 *
 * This package depends on `@12-apps/wiring` in NEITHER direction — wiring
 * already devDepends on jobs for its blueprint-compat suite, so an edge back
 * would close a turbo build cycle. The manifest is therefore untyped pure
 * data here, and the producer assertions (defineManifest, both mirrors, the
 * exports tripwire) run in WIRING's own suite, which imports this subpath —
 * the same "fails in a test run before any host sees it" guarantee, one
 * package over, along the dependency edge that already exists.
 */

export const jobsManifest = {
  name: "@12-apps/jobs",
  contract: 1,
  db: { partial: "prisma/jobs.prisma", migrations: "prisma/migrations" },
  env: [
    { name: "REDIS_URL", description: "Set it and the queue turns itself on; unset selects the inline/off driver." },
    { name: "JOBS_DRIVER", description: "bullmq | inline | off; unset picks by REDIS_URL and NODE_ENV." },
    { name: "JOBS_WORKER", scope: "worker", description: "\"1\" on the ONE process that consumes the queue and runs schedules." },
    { name: "JOBS_QUEUE_PREFIX", description: "Optional key prefix, to share one Redis across environments." },
  ],
} as const;
