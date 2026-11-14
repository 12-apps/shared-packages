import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from "@12-apps/wiring/producer";
import { createWiringHost } from "@12-apps/wiring/consumer";

import packageJson from "../../../package.json";
import { createHarness, silent } from "../../__tests__/harness";
import { textMessage } from "../../__tests__/fixtures";
import { createApiMessaging } from "../../server";
import { MESSAGING_JOBS } from "../../server/jobs";
import { messagingManifest } from "..";
import { messagingServerManifest } from "../server";

/**
 * The wiring-compliance suite: the producer's assertions (the contract is a
 * type-only dependency, so they run here), the mirrors into package.json, the
 * job blueprints, and an adoption by a real wiring host.
 */

describe("the manifests", () => {
  it("pass the producer assertions", () => {
    expect(defineManifest(messagingManifest)).toBe(messagingManifest);
    expect(defineServerManifest(messagingManifest, messagingServerManifest)).toBe(messagingServerManifest);
  });

  it("declare the identity, the inventory, the namespace and the db, and nothing else", () => {
    expect(messagingManifest).toEqual({
      name: "@12-apps/messaging",
      contract: 1,
      db: { partial: "prisma/messaging.prisma", migrations: "prisma/migrations" },
      observability: { namespace: "messaging" },
      server: ["http", "jobs"],
    });
    // Declined by design: conversations and phone numbers stay off the agent surface.
    expect(messagingManifest).not.toHaveProperty("mcp");
  });

  it("mirror the db capability, the env absence and the exports map into package.json", () => {
    expect(() => assertDbMirror(messagingManifest, packageJson)).not.toThrow();
    expect(() => assertEnvMirror(messagingManifest, packageJson)).not.toThrow();
    expect(() => assertExportsMirror(messagingManifest, packageJson)).not.toThrow();
    expect(packageJson.files).toContain("prisma");
    expect(Object.keys(packageJson.exports)).toEqual(expect.arrayContaining([".", "./whatsapp", "./server"]));
  });

  it("name NO host table in the partial: tenant and staff ids are by-value strings", () => {
    /* eslint-disable-next-line test-flakiness/no-unmocked-fs --
       the SHIPPED partial is the subject: a mocked read would assert against
       a fixture and pass forever while the published file said anything. */
    const partial = readFileSync(new URL("../../../prisma/messaging.prisma", import.meta.url), "utf8");
    const relations = [...partial.matchAll(/@relation\(fields: \[(\w+)\], references: \[id\]/gu)].map((match) => match[1]);
    // Both relations point at tables of this package: a message to its conversation, a conversation to its connection.
    expect(relations).toEqual(["connectionId", "conversationId"]);
    expect(partial).not.toMatch(/model (Client|User|Tenant)\b/u);
  });

  it("serve only the two webhook routes, both public by kind", () => {
    const h = createHarness();
    const routes = createApiMessaging({ engine: h.engine, logger: silent }).routes;
    expect(routes.map((route) => `${route.method} ${route.path} ${route.kind}`)).toEqual([
      "GET /webhooks/messaging/:channel webhook",
      "POST /webhooks/messaging/:channel webhook",
    ]);
  });
});

describe("the job blueprints", () => {
  it("bind under the messaging namespace with the connector's cadence", () => {
    expect(MESSAGING_JOBS.namespace).toBe("messaging");
    const { "process-delivery": process, "reconcile-inbox": reconcile, retention } = MESSAGING_JOBS.blueprints;
    expect(process).toMatchObject({ attempts: 5, backoff: { type: "exponential" } });
    expect(process.schedule).toBeUndefined();
    expect(reconcile.schedule?.pattern).toBe("*/5 * * * *");
    expect(retention.schedule?.pattern).toBe("*/10 * * * *");
  });

  it("are adopted by a wiring host and run the engine: a delivery is processed by the bound job", async () => {
    const h = createHarness();
    await h.connect();
    const host = createWiringHost({ name: "test-host", kind: "server", ports: { loggerFor: () => silent } });
    host.adoptServer({
      manifest: messagingManifest,
      server: messagingServerManifest,
      bindings: {
        http: { mountPath: "/api", config: { engine: h.engine, logger: silent } },
        jobs: { deps: { engine: h.engine } },
      },
    });
    const wired = host.assemble();

    expect(wired.jobs.map((job) => job.name).sort()).toEqual([
      "messaging.process-delivery",
      "messaging.reconcile-inbox",
      "messaging.retention",
    ]);
    expect(wired.routes).toHaveLength(2);

    await h.post(textMessage("Oi"));
    const [queued] = h.queued;
    const job = wired.jobs.find((candidate) => candidate.name === queued!.name)!;
    await job.handle(queued!.payload as never, { runId: "r", attempt: 1, maxAttempts: 5, logger: silent });
    expect(h.dump().messages).toHaveLength(1);
  });
});
