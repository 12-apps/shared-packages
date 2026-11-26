import { describe, expect, it } from "vitest";

import type { StatusStep } from "../core/adapter";
import { OutboundRetryError } from "../core/outbound";
import type { OutboundJobPayload } from "../core/outbound-queue";
import { OUTBOUND_GIVE_UP_MS, OUTBOUND_STALE_MS } from "../core/outbound-sweep";
import { TENANT, createHarness, deliverIfood, ifoodPlaced, scriptedHttp, type Harness } from "./harness";

/* eslint-disable test-flakiness/no-test-isolation --
   Every case builds its OWN harness (`createHarness`) inside the case, and its
   engine, database and queue are local to it: the rule reads a call on that
   local (`h.setNow(...)`, `h.seedStatus(...)`) as a write to shared state. */

/**
 * The engine's half of FUT-4653's outbound rows (contract §3 R-out, R-job;
 * §4.4 P3-P18): the host tells the engine a step happened (`informStatus`, one
 * enqueue, no statement), and the `marketplace.outbound` job, action `status`,
 * decides everything else, in order, stopping at the first rule that fails
 * with no row and no call. Each test builds its own harness.
 */

const TOKEN = { status: 200, body: JSON.stringify({ accessToken: "tok-1", expiresIn: 3600 }) };
const FIRST = { attempt: 1, maxAttempts: 3 };
const LAST = { attempt: 3, maxAttempts: 3 };
const API = "https://merchant-api.ifood.com.br/order/v1.0/orders/ext-1";

function ok() {
  return scriptedHttp((request) => (request.url.endsWith("/token") ? TOKEN : { status: 202, body: "" }));
}

const job = (orderId: string, step: StatusStep): OutboundJobPayload => ({ clientId: TENANT, orderId, action: "status", step });

async function acceptedOrder(
  h: Harness,
  deliveredBy: "MERCHANT" | "MARKETPLACE" | null,
): Promise<string> {
  await h.connect();
  const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "ACCEPT" });
  h.patchAcceptance(outcome.orderId, { deliveredBy });
  return outcome.orderId;
}

function statusRows(h: Harness): Record<string, unknown>[] {
  return h.memory.tables.marketplaceStatusUpdate.rows;
}

function calls(http: ReturnType<typeof scriptedHttp>): string[] {
  return http.requests.filter((r) => !r.url.endsWith("/token")).map((r) => `${r.method} ${r.url}`);
}

describe("informStatus: the host's one enqueue", () => {
  it("[P5] queues the status job under the move's own key, with the delay the host asked", async () => {
    const h = createHarness({ statusHolds: () => true });
    const at = new Date("2026-11-11T12:00:03.000Z");

    const queued = await h.engine.informStatus({ clientId: TENANT, orderId: "o1", step: "DISPATCHED", at, delayMs: 15_000 });

    expect(queued).toBe(true);
    expect(h.enqueued).toEqual([
      {
        name: "marketplace.outbound",
        payload: { clientId: TENANT, orderId: "o1", action: "status", step: "DISPATCHED" },
        dedupeKey: `marketplace.outbound:status:DISPATCHED:o1:${at.getTime()}`,
        delayMs: 15_000,
      },
    ]);
  });

  it("a re-dispatch after an undo is a new key", async () => {
    const h = createHarness();
    await h.engine.informStatus({ clientId: TENANT, orderId: "o1", step: "DISPATCHED", at: new Date(1_000) });
    await h.engine.informStatus({ clientId: TENANT, orderId: "o1", step: "DISPATCHED", at: new Date(2_000) });

    expect(new Set(h.enqueued.map((e) => e.dedupeKey)).size).toBe(2);
    expect(h.enqueued[0]?.delayMs).toBeUndefined();
  });

  it("[P12] never throws: a queue that refuses, or throws, is logged and answers false", async () => {
    const down = createHarness({ queueDown: true });
    expect(await down.engine.informStatus({ clientId: TENANT, orderId: "o1", step: "READY", at: new Date(1) })).toBe(false);
    expect(down.logged.some((line) => line.level === "warn")).toBe(true);
    expect(down.memory.tables.marketplaceStatusUpdate.rows).toHaveLength(0);
  });
});

describe("the status job, in order", () => {
  it("[P3] READY for a fleet bag: claims, calls iFood once, stamps SENT", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MARKETPLACE");

    const first = await h.engine.runOutbound(job(orderId, "READY"), FIRST);
    const second = await h.engine.runOutbound(job(orderId, "READY"), FIRST);

    expect(first).toEqual({ kind: "done", action: "status" });
    expect(second.kind).toBe("skipped");
    expect(calls(http)).toEqual([`POST ${API}/readyToPickup`]);
    expect(statusRows(h)).toEqual([
      expect.objectContaining({ orderId, provider: "IFOOD", step: "READY", source: "STORE", state: "SENT" }),
    ]);
  });

  it("[P3] READY for a take-out is sent too", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, null);

    const outcome = await h.engine.runOutbound(job(orderId, "READY"), FIRST);

    expect(outcome.kind).toBe("done");
    expect(calls(http)).toEqual([`POST ${API}/readyToPickup`]);
  });

  it("[P3b] READY for a merchant bag: unsupported, no row, no call, not even a token", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");

    const outcome = await h.engine.runOutbound(job(orderId, "READY"), FIRST);

    expect(outcome).toEqual({ kind: "skipped", reason: "the marketplace does not take READY for this order" });
    expect(http.requests).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(0);
    expect(h.holdsAsked).toHaveLength(0);
  });

  it("[P5] DISPATCHED for a merchant bag calls dispatch and stamps SENT", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(outcome.kind).toBe("done");
    expect(calls(http)).toEqual([`POST ${API}/dispatch`]);
    expect(statusRows(h)[0]).toMatchObject({ step: "DISPATCHED", source: "STORE", state: "SENT" });
  });

  it.each(["MARKETPLACE", null] as const)("DISPATCHED for deliveredBy %s: unsupported", async (deliveredBy) => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, deliveredBy);

    expect((await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST)).kind).toBe("skipped");
    expect(http.requests).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(0);
  });

  it("[P8][P14] HANDED_OVER on iFood: unsupported for every kind", async () => {
    for (const deliveredBy of ["MERCHANT", "MARKETPLACE", null] as const) {
      const http = ok();
      const h = createHarness({ http, statusHolds: () => true });
      const orderId = await acceptedOrder(h, deliveredBy);

      expect((await h.engine.runOutbound(job(orderId, "HANDED_OVER"), FIRST)).kind).toBe("skipped");
      expect(http.requests).toHaveLength(0);
      expect(statusRows(h)).toHaveLength(0);
    }
  });

  it.each(["AWAITING", "REJECTED", "EXPIRED"])("R-job 1: an order that is %s sends nothing", async (status) => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");
    h.patchAcceptance(orderId, { status });

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(outcome).toEqual({ kind: "skipped", reason: `the order is ${status}, not ACCEPTED` });
    expect(http.requests).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(0);
    expect(h.holdsAsked).toHaveLength(0);
  });

  it.each(["PENDING", "REQUESTED"])("[P15] R-job 1: a cancellation request %s sends nothing", async (standing) => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");
    h.patchAcceptance(orderId, { cancellationStatus: standing });

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(outcome).toEqual({ kind: "skipped", reason: `a cancellation request is ${standing}` });
    expect(http.requests).toHaveLength(0);
  });

  it("an order with no acceptance sends nothing", async () => {
    const h = createHarness({ statusHolds: () => true });
    await h.connect();
    expect((await h.engine.runOutbound(job("ghost", "READY"), FIRST)).kind).toBe("skipped");
  });

  it("[P6] R-job 3: a dispatch the store undid sends nothing, leaves no row", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => false });
    const orderId = await acceptedOrder(h, "MERCHANT");

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(outcome).toEqual({ kind: "skipped", reason: "the order no longer holds DISPATCHED" });
    expect(h.holdsAsked).toEqual([{ orderId, step: "DISPATCHED" }]);
    expect(http.requests).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(0);
  });

  it("R-job 3: a host that binds no statusHolds cannot tell, so nothing is sent", async () => {
    const http = ok();
    const h = createHarness({ http });
    const orderId = await acceptedOrder(h, "MERCHANT");

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(outcome.kind).toBe("skipped");
    expect(http.requests).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(0);
  });

  it("[P7] R-job 4: dispatch sent, undone, dispatched again: the second job never sends", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");

    await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);
    const again = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(again.kind).toBe("skipped");
    expect(calls(http)).toHaveLength(1);
    expect(statusRows(h)).toHaveLength(1);
  });

  it("[X1] R-job 4: a DSP the marketplace announced first stops our delayed job: one dispatch, no FAILED", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");
    await h.seedStatus({ orderId, step: "DISPATCHED", source: "MARKETPLACE", state: "NOTED" });

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(outcome.kind).toBe("skipped");
    expect(http.requests).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(1);
    expect(statusRows(h)[0]).toMatchObject({ source: "MARKETPLACE", state: "NOTED" });
  });

  it("[P16] R-job 4: after the marketplace's CONCLUDED nothing more is sent for the order", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MARKETPLACE");
    await h.seedStatus({ orderId, step: "CONCLUDED", source: "MARKETPLACE", state: "NOTED" });

    const outcome = await h.engine.runOutbound(job(orderId, "READY"), FIRST);

    expect(outcome.kind).toBe("skipped");
    expect(http.requests).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(1);
  });

  it("R-job 5: a lost claim (another run won the unique) stops with no call", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");
    // The read answers "no row" and the insert then loses: the race the claim guards.
    h.interceptStatusTable({ rival: { orderId, step: "DISPATCHED", source: "STORE", state: "SENT" } });

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(outcome.kind).toBe("skipped");
    expect(http.requests).toHaveLength(0);
    expect(statusRows(h)).toHaveLength(1);
  });

  it("[P18] an order of a marketplace the engine does not know sends nothing", async () => {
    const h = createHarness({ statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");
    h.patchAcceptance(orderId, { provider: "NOPE" });

    expect((await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST)).kind).toBe("skipped");
  });
});

describe("how a call ends", () => {
  it("[P10] a 4xx: the row is FAILED, logged at error, never retried, nothing thrown", async () => {
    const http = scriptedHttp((request) => (request.url.endsWith("/token") ? TOKEN : { status: 409, body: "no" }));
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(outcome).toMatchObject({ kind: "failed", action: "status" });
    expect(statusRows(h)[0]).toMatchObject({ state: "FAILED" });
    expect(h.logged.some((line) => line.level === "error")).toBe(true);
    expect(calls(http)).toHaveLength(1);
    // Never sent twice, even by a later job.
    expect((await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST)).kind).toBe("skipped");
    expect(calls(http)).toHaveLength(1);
  });

  it("[P11] a 5xx is retried on the row it owns; the second answer stamps SENT", async () => {
    // The token, a 503, then (the token cached) a 202.
    const http = scriptedHttp([TOKEN, { status: 503, body: "busy" }, { status: 202, body: "" }]);
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");

    await expect(h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST)).rejects.toBeInstanceOf(OutboundRetryError);
    expect(statusRows(h)[0]).toMatchObject({ state: "SENDING" });
    const second = await h.engine.runOutbound(job(orderId, "DISPATCHED"), { attempt: 2, maxAttempts: 3 });

    expect(second.kind).toBe("done");
    expect(statusRows(h)).toHaveLength(1);
    expect(statusRows(h)[0]).toMatchObject({ state: "SENT" });
    expect(calls(http)).toHaveLength(2);
  });

  it("[P11] the last attempt of a 5xx stamps FAILED", async () => {
    const http = scriptedHttp((request) => (request.url.endsWith("/token") ? TOKEN : { status: 500, body: "down" }));
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), LAST);

    expect(outcome.kind).toBe("failed");
    expect(statusRows(h)[0]).toMatchObject({ state: "FAILED" });
  });

  it("a throw on the last attempt (a database blip while stamping) still ends FAILED, never SENDING", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");
    const table = h.memory.tables.marketplaceStatusUpdate;
    h.interceptStatusTable({ failFirstStamp: "database blip" });

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), LAST);

    expect(outcome).toMatchObject({ kind: "failed", action: "status", reason: "database blip" });
    expect(table.rows[0]).toMatchObject({ state: "FAILED" });
    expect(h.logged.some((line) => line.level === "error")).toBe(true);
  });

  it("no credentials on file: refused for good, FAILED, no call", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");
    h.patchIntegration({ credentials: "" });

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(outcome.kind).toBe("failed");
    expect(statusRows(h)[0]).toMatchObject({ state: "FAILED" });
    expect(http.requests).toHaveLength(0);
  });

  it("a host with no status table composed sends nothing", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await acceptedOrder(h, "MERCHANT");
    h.dropStatusTable();

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(outcome.kind).toBe("skipped");
    expect(http.requests).toHaveLength(0);
  });
});

describe("[P13] the outbound sweep and a job that died after its claim", () => {
  async function stuck(h: Harness, ageMs: number, state = "SENDING"): Promise<string> {
    const orderId = await acceptedOrder(h, "MERCHANT");
    await h.seedStatus({ orderId, step: "DISPATCHED", source: "STORE", state, ageMs });
    return orderId;
  }

  it("re-queues a SENDING row older than 10 minutes under its own per-pass key", async () => {
    const h = createHarness({ dedupeQueue: true, statusHolds: () => true });
    const orderId = await stuck(h, OUTBOUND_STALE_MS + 1_000);
    h.enqueued.length = 0;

    const first = await h.engine.sweepOutbound();
    const key = `marketplace.outbound:status:DISPATCHED:${orderId}:sweep:${h.clock.at.getTime()}`;

    expect(first.requeued).toBe(1);
    expect(h.enqueued).toEqual([
      expect.objectContaining({ payload: { clientId: TENANT, orderId, action: "status", step: "DISPATCHED" }, dedupeKey: key }),
    ]);
    h.setNow(new Date(h.clock.at.getTime() + 60_000));
    expect((await h.engine.sweepOutbound()).requeued).toBe(1);
  });

  it("leaves a younger SENDING row, and a settled one, alone", async () => {
    const young = createHarness({ statusHolds: () => true });
    await stuck(young, 60_000);
    young.enqueued.length = 0;
    expect((await young.engine.sweepOutbound()).requeued).toBe(0);
    expect(young.enqueued).toHaveLength(0);

    const settled = createHarness({ statusHolds: () => true });
    await stuck(settled, OUTBOUND_STALE_MS * 2, "SENT");
    settled.enqueued.length = 0;
    expect((await settled.engine.sweepOutbound()).requeued).toBe(0);
  });

  it("gives up on a SENDING row older than 24 hours: FAILED, logged at error, counted", async () => {
    const h = createHarness({ statusHolds: () => true });
    await stuck(h, OUTBOUND_GIVE_UP_MS + 1_000);
    h.enqueued.length = 0;

    const swept = await h.engine.sweepOutbound();

    expect(swept).toMatchObject({ requeued: 0, givenUp: 1 });
    expect(statusRows(h)[0]).toMatchObject({ state: "FAILED" });
    expect(h.enqueued).toHaveLength(0);
    expect(h.logged.some((line) => line.level === "error")).toBe(true);
  });

  it("the re-queued job runs on the SENDING row it owns and sends", async () => {
    const http = ok();
    const h = createHarness({ http, statusHolds: () => true });
    const orderId = await stuck(h, OUTBOUND_STALE_MS + 1_000);

    const outcome = await h.engine.runOutbound(job(orderId, "DISPATCHED"), FIRST);

    expect(outcome.kind).toBe("done");
    expect(statusRows(h)[0]).toMatchObject({ state: "SENT" });
  });
});
