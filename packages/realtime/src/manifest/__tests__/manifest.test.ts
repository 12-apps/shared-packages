/**
 * The wiring-compliance suite (the report-builder shape): the manifest is a
 * plain `satisfies`-checked value with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 */

import { describe, expect, it, vi } from "vitest";
import type { WireEnvVar, WireJobContext } from "@12-apps/wiring";
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
  defineWebManifest,
} from "@12-apps/wiring/producer";

import packageJson from "../../../package.json";
import { REALTIME_JOBS } from "../../jobs";
import { realtimeManifest } from "../index";
import { realtimeServerManifest } from "../server";
import { realtimeWebManifest } from "../web";

/** Read afresh per test — the flakiness lane refuses shared test-scope bindings. */
function declaredEnvOf(): readonly WireEnvVar[] {
  return realtimeManifest.env;
}

describe("the realtime manifest", () => {
  it("passes the producer assertions — the contract is a devDependency, so the check lives here", () => {
    expect(defineManifest(realtimeManifest)).toBe(realtimeManifest);
    expect(defineServerManifest(realtimeManifest, realtimeServerManifest)).toBe(
      realtimeServerManifest,
    );
    expect(defineWebManifest(realtimeManifest, realtimeWebManifest)).toBe(realtimeWebManifest);
  });

  it("declares the full runtime inventory, the outbox partial and the namespace", () => {
    expect(realtimeManifest.name).toBe("@12-apps/realtime");
    expect(realtimeManifest.contract).toBe(1);
    expect(realtimeManifest.server).toEqual(["http", "jobs"]);
    expect(realtimeManifest.web).toEqual(["surface"]);
    expect(realtimeManifest.db).toEqual({
      partial: "prisma/realtime.prisma",
      migrations: "prisma/migrations",
    });
    expect(realtimeManifest.observability).toEqual({ namespace: "realtime" });
  });

  it("splits scopes by process: gateway vars ride worker, API vars ride server", () => {
    const byName = new Map(declaredEnvOf().map((declared) => [declared.name, declared]));
    expect(byName.get("REALTIME_GATEWAY_PORT")?.scope).toBe("worker");
    expect(byName.get("REALTIME_GATEWAY_MAX_CONNECTIONS")?.scope).toBe("worker");
    // The API side degrades by design (no secret means no WS transport), so
    // nothing is `required` — the gateway enforces its own boot requirement,
    // which is stricter than any assemble-time check could be.
    expect(declaredEnvOf().some((declared) => declared.required)).toBe(false);
    expect(byName.get("REALTIME_TICKET_SECRET")?.secret).toBe(true);
    // AUTH_SECRET stays undeclared here: it is @12-apps/auth's contribution,
    // and this package only falls back to it.
    expect(byName.has("AUTH_SECRET")).toBe(false);
  });

  it("mirrors env into package.json, and the exports map matches the declarations", () => {
    expect(() => assertDbMirror(realtimeManifest, packageJson)).not.toThrow();
    expect(() => assertEnvMirror(realtimeManifest, packageJson)).not.toThrow();
    expect(() => assertExportsMirror(realtimeManifest, packageJson)).not.toThrow();
  });
});

function stubContext(): WireJobContext & {
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
} {
  return {
    runId: "run-1",
    attempt: 1,
    maxAttempts: 1,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("the http wire view", () => {
  it("renames kind to transport and forwards params, query and the raw request", async () => {
    const { routes } = realtimeServerManifest.http.create({
      surfaces: [
        { path: "/events", domains: ["orders"] },
      ] as never,
      messages: {
        invalidTopics: "topics?",
        unknownTopic: "unknown",
        tooManyTopics: "too many",
        connectionLimit: "cap",
        realtimeOff: "off",
        noTicketSecret: "no secret",
      } as never,
      installSignalHooks: false,
    });
    expect(routes.map((route) => `${route.method} ${route.path} (${route.transport})`)).toEqual([
      "GET /events (stream)",
      "POST /events/ticket (json)",
    ]);
    // The ticket route without ?topics= answers the surface's own 400 —
    // through the WIRE shape, proving the context crossed the view intact.
    const ticket = routes.find((route) => route.transport === "json");
    const answer = await ticket?.handle({ actor: undefined as never, params: {}, query: {} });
    if (answer === undefined || !("status" in answer)) throw new Error("expected the JSON half");
    expect(answer.status).toBe(400);
  });
});

describe("the outbox blueprints", () => {
  it("declares the sub-minute drain and the daily purge, both no-retry", () => {
    expect(realtimeServerManifest.jobs).toBe(REALTIME_JOBS);
    expect(REALTIME_JOBS.namespace).toBe("realtime");
    expect(REALTIME_JOBS.blueprints.outboxDrain).toMatchObject({
      name: "outbox-drain",
      interval: { everyMs: 10_000 },
      attempts: 1,
    });
    expect(REALTIME_JOBS.blueprints.outboxDrain).not.toHaveProperty("schedule");
    expect(REALTIME_JOBS.blueprints.outboxPurge).toMatchObject({
      name: "outbox-purge",
      schedule: { pattern: "0 4 * * *" },
      attempts: 1,
    });
  });

  it("drains until the outbox says stop, and a quiet tick logs nothing", async () => {
    const context = stubContext();
    const drain = vi
      .fn()
      .mockResolvedValueOnce({ published: 100, failed: 0, contended: 0, more: true, aborted: false })
      .mockResolvedValueOnce({ published: 3, failed: 0, contended: 0, more: false, aborted: false });
    await REALTIME_JOBS.blueprints.outboxDrain.handle(
      undefined as never,
      { outbox: { drain, purgePublished: vi.fn() }, purgeRetentionMs: 1 },
      context,
    );
    expect(drain).toHaveBeenCalledTimes(2);
    expect(context.logger.info).not.toHaveBeenCalled();
    expect(context.logger.error).not.toHaveBeenCalled();
  });

  it("reports failures across the whole pass, and purges with the host's retention", async () => {
    const context = stubContext();
    const drain = vi
      .fn()
      .mockResolvedValue({ published: 2, failed: 1, contended: 0, more: false, aborted: false });
    await REALTIME_JOBS.blueprints.outboxDrain.handle(
      undefined as never,
      { outbox: { drain, purgePublished: vi.fn() }, purgeRetentionMs: 1 },
      context,
    );
    expect(context.logger.error).toHaveBeenCalledWith(
      "realtime outbox drain: 1 failed, 2 published",
    );
    const purgePublished = vi.fn().mockResolvedValue(7);
    await REALTIME_JOBS.blueprints.outboxPurge.handle(
      undefined as never,
      { outbox: { drain, purgePublished }, purgeRetentionMs: 604_800_000 },
      stubContext(),
    );
    expect(purgePublished).toHaveBeenCalledWith(604_800_000);
  });
});
