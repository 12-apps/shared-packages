/**
 * The assignability proof — the check the structural twins never had.
 *
 * `@12-apps/payments-backend` restates `@12-apps/jobs`' blueprint shape by
 * hand, and nothing compiles the two against each other; this suite is the
 * missing half for THIS package's twins. If `@12-apps/jobs` reshapes
 * `JobBlueprint` or `JobDefinition`, these assignments stop compiling in
 * this repo, not in a host's incident channel.
 */

import { afterEach, describe, expect, it } from "vitest";
import { clearJobs, defineJob, type JobBlueprint, type JobDefinition } from "@12-apps/jobs";

import { createWiringHost } from "../consumer";
import { memoryEmailPort } from "../ports";
import type { BoundJob, WireJobBlueprint } from "../contract/jobs";
import { notesManifest, notesServerManifest, type NotesJobDeps, type NotesStore } from "./fixture-package";

interface Payload {
  id: string;
}
interface Deps {
  log: string[];
}

const asWire: WireJobBlueprint<Payload, Deps> = {
  name: "sample",
  handle: (payload, deps) => {
    deps.log.push(payload.id);
    return Promise.resolve();
  },
};

// Both directions: a wiring blueprint IS a jobs blueprint, and vice versa.
const wireToJobs: JobBlueprint<Payload, Deps> = asWire;
const jobsToWire: WireJobBlueprint<Payload, Deps> = wireToJobs;

const store: NotesStore = {
  list: () => Promise.resolve([]),
  add: () => Promise.resolve(),
};

describe("the jobs twins against @12-apps/jobs itself", () => {
  afterEach(() => {
    clearJobs();
  });

  it("keeps the blueprint shapes mutually assignable", () => {
    expect(jobsToWire.name).toBe("sample");
  });

  it("hands defineJob a bound job it accepts verbatim", async () => {
    const host = createWiringHost({ name: "api", kind: "server", ports: { email: memoryEmailPort().port } });
    const deps: NotesJobDeps = { store, ran: [] };
    host.adoptServer({
      manifest: notesManifest,
      observability: { declined: "jobs compat is the subject here" },
      server: notesServerManifest,
      bindings: {
        http: { mountPath: "/api/admin/:tenantSlug", config: { store } },
        jobs: { deps },
        email: {},
      },
    });
    const assembled = host.assemble();

    // The one-line integration the contract promises: every adopted
    // package's jobs, registered through the host's own jobs runtime.
    const registered = assembled.jobs.map((job) => defineJob(job));
    expect(registered.map((job) => job.name)).toEqual(["notes.digest"]);

    const definition: JobDefinition<never> | undefined = registered[0]?.definition;
    expect(definition?.schedule?.pattern).toBe("0 7 * * *");
    await definition?.handle(undefined as never, {
      runId: "run-1",
      attempt: 1,
      maxAttempts: 1,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    expect(deps.ran).toEqual(["digest"]);
  });

  it("keeps BoundJob assignable to JobDefinition", () => {
    const bound: BoundJob = {
      name: "notes.noop",
      handle: () => Promise.resolve(),
    };
    const definition: JobDefinition<never> = bound;
    expect(definition.name).toBe("notes.noop");
  });
});
