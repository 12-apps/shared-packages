import { describe, expect, it } from "vitest";

import type { MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import { FETCH_REQUEUE_AGE_MS, MARKETPLACE_FETCH_ORDER_JOB, type FetchOrderJobPayload } from "../../core/fetch-order";
import { createIfoodAdapter } from "../../ifood";
import { IFOOD_ADAPTER_COPY_EN_US } from "../../ifood/en-US";
import { TENANT, createHarness, scriptedHttp, type Harness } from "../../__tests__/harness";
import { createNinetyNineFoodAdapter, NINETY_NINE_FOOD_PROVIDER } from "..";
import { NINETY_NINE_FOOD_ADAPTER_COPY_EN_US } from "../en-US";
import { API_BASE, PORTAL, SPEC_MERCHANT_ID, SPEC_ORDER_ID, specEvent, specOrder } from "./fixtures";

/**
 * The engine, unchanged, driven through the 99Food adapter end to end:
 * webhook event → the fetch job → ingest → aceite → the confirm request built
 * → the cancellation request built → the marketplace's answer by event.
 *
 * The owner's rule is the point: "the integration engine must be the same for
 * all integrations. Only an adapter is made for each one." 99Food is
 * registered beside iFood, and nothing below names it outside the adapter.
 */

const P = NINETY_NINE_FOOD_PROVIDER;
const SECOND_ORDER_ID = "0f7a1d7e-9b7c-4c38-a0b1-2f1e1c6f8d11";
const ATTEMPT = { attempt: 1, maxAttempts: 3 };
/** The sandbox URL of the spec order's resource. */
const orderUrl = (action: string): string => `${API_BASE.SANDBOX}/v1/orders/${SPEC_ORDER_ID}/${action}`;
const TOKEN = { status: 200, body: JSON.stringify({ access_token: "tok", token_type: "bearer", expires_in: 3600 }) };

/** 99Food's API as the spec describes it: token, order details, 202 for confirm and cancel. */
function openDelivery(overrides: { order?: (request: MarketplaceHttpRequest) => MarketplaceHttpResponse } = {}) {
  return scriptedHttp((request) => {
    if (request.url.endsWith("/oauth/token")) return TOKEN;
    if (request.method === "GET") {
      if (overrides.order) return overrides.order(request);
      const id = decodeURIComponent(request.url.split("/").pop() ?? "");
      return { status: 200, body: JSON.stringify(specOrder(id)) };
    }
    return { status: 202, body: "" };
  });
}

function harness(options: { http?: ReturnType<typeof scriptedHttp>; queueDown?: boolean } = {}) {
  const http = options.http ?? openDelivery();
  const mounted = createHarness({
    http,
    queueDown: options.queueDown,
    // Like a real queue: a job id it already took is refused.
    dedupeQueue: true,
    cancellationHooks: true,
    adapters: [
      createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US }),
      createNinetyNineFoodAdapter({ copy: NINETY_NINE_FOOD_ADAPTER_COPY_EN_US, apiBaseUrl: API_BASE, portalUrl: PORTAL }),
    ],
  });
  return { h: mounted, http };
}

/** Deliver one Open Delivery event for the tenant, as the webhook route does. */
async function deliver(subject: Harness, payload: unknown) {
  const event = subject.engine.normalize(P, payload);
  if (!event) throw new Error("did not normalize");
  const target = await subject.engine.target(TENANT, P);
  return subject.engine.deliver({
    clientId: TENANT,
    event,
    payload,
    settings: target?.enabled ? { autoAccept: target.autoAccept, ackSlaSeconds: target.ackSlaSeconds } : null,
  });
}

/** Connect 99Food for the tenant, under the spec order's merchant. */
async function connect(subject: Harness, settings: { autoAccept?: boolean } = {}) {
  await subject.connect(P, settings);
  subject.patchIntegration({ externalMerchantId: SPEC_MERCHANT_ID });
}

/** The fetch jobs the queue took so far. */
function fetchJobs(subject: Harness): FetchOrderJobPayload[] {
  return subject.queued
    .filter((job) => job.name === MARKETPLACE_FETCH_ORDER_JOB)
    .map((job) => job.payload as unknown as FetchOrderJobPayload);
}

/** CREATED → the fetch job → an ingested order's host id. */
async function arrive(subject: Harness, orderId: string): Promise<string> {
  await deliver(subject, specEvent("CREATED", orderId));
  const job = fetchJobs(subject).at(-1);
  if (!job) throw new Error("no fetch queued");
  const outcome = await subject.engine.runFetchOrder(job, ATTEMPT);
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  return outcome.orderId;
}

describe("the engine through the 99Food adapter, end to end", () => {
  it("[P1] registers beside iFood and takes its webhook at the one route", () => {
    const { h } = harness();
    expect(h.engine.providers()).toEqual(["IFOOD", P]);
    expect(h.engine.knows(P)).toBe(true);
    expect(h.engine.reasons(P)).toHaveLength(11);
    expect(h.engine.suggestReason(P, { itemUnavailable: true })?.code).toBe("UNAVAILABLE_ITEM");
    expect(h.engine.appLink(P, { externalOrderId: SPEC_ORDER_ID, externalDisplayId: "12345" })).toBe(PORTAL);
  });

  it("[P1] records CREATED without calling out, then the fetch job ingests the spec's order", async () => {
    const { h, http } = harness();
    await connect(h);

    const outcome = await deliver(h, specEvent("CREATED"));

    // The request that delivered the event made no call: the fetch is a job's.
    expect(outcome).toEqual({ kind: "awaitingOrder" });
    expect(http.requests).toEqual([]);
    const [job] = fetchJobs(h);
    expect(job).toEqual({ clientId: TENANT, inboxId: expect.any(String) });
    expect(h.enqueued.at(-1)?.dedupeKey).toBe(`${MARKETPLACE_FETCH_ORDER_JOB}:${job?.inboxId}`);
    expect(h.memory.tables.marketplaceInboxEvent.rows[0]).toMatchObject({ status: "PENDING", error: "order details to fetch" });

    const fetched = await h.engine.runFetchOrder(job!, ATTEMPT);

    expect(fetched).toEqual({ kind: "ingested", orderId: "order-1", unmappedSkus: ["22"] });
    expect(http.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://sandbox.od.example.test/oauth/token",
      `GET https://sandbox.od.example.test/v1/orders/${SPEC_ORDER_ID}`,
    ]);
    expect(h.created[0]?.order).toMatchObject({ provider: P, totalCents: 3550, commissionCents: null });
    expect(h.memory.tables.marketplaceInboxEvent.rows[0]?.status).toBe("PROCESSED");
    // The unmapped SKU is a row on the store's attention list, not a refused order.
    expect((await h.engine.menuLinks({ clientId: TENANT, provider: P, unmappedOnly: true })).map((l) => l.externalSku)).toEqual([
      "22",
    ]);
    // On the store's acceptance clock, like any marketplace order.
    expect((await h.engine.pending(TENANT)).map((row) => row.provider)).toEqual([P]);
  });

  it("dedups a redelivered CREATED, and a second fetch of a settled row does nothing", async () => {
    const { h, http } = harness();
    await connect(h);
    await arrive(h, SPEC_ORDER_ID);
    const calls = http.requests.length;

    expect(await deliver(h, specEvent("CREATED"))).toEqual({ kind: "duplicate" });
    expect(await h.engine.runFetchOrder(fetchJobs(h)[0]!, ATTEMPT)).toEqual({
      kind: "skipped",
      reason: "the row is already PROCESSED",
    });
    expect(http.requests).toHaveLength(calls);
    expect(h.created).toHaveLength(1);
  });

  it("[P1] the aceite builds the confirm request: POST /confirm with the host's order code", async () => {
    const { h, http } = harness();
    await connect(h);
    const orderId = await arrive(h, SPEC_ORDER_ID);

    await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });
    expect(h.enqueued.at(-1)).toMatchObject({ name: "marketplace.outbound", payload: { orderId, action: "confirm" } });
    const run = await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, ATTEMPT);

    expect(run).toEqual({ kind: "done", action: "confirm" });
    const confirm = http.requests.at(-1);
    expect(confirm?.method).toBe("POST");
    expect(confirm?.url).toBe(orderUrl("confirm"));
    expect(confirm?.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(confirm?.body ?? "{}")).toEqual({ orderExternalCode: orderId, createdAt: h.clock.at.toISOString() });
    // One token for the fetch and the confirm.
    expect(http.requests.filter((r) => r.url.endsWith("/oauth/token"))).toHaveLength(1);
    expect(h.acceptance(orderId)?.confirmedAt).toEqual(h.clock.at);
  });

  it("[P1] a refusal builds the cancellation request; the CANCELLED event confirms it", async () => {
    const { h, http } = harness();
    await connect(h);
    const orderId = await arrive(h, SPEC_ORDER_ID);

    await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "UNAVAILABLE_ITEM", offendingSkus: ["22"] });
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);

    const request = http.requests.at(-1);
    expect(request?.url).toBe(orderUrl("requestCancellation"));
    expect(JSON.parse(request?.body ?? "{}")).toEqual({ reason: "Item unavailable", code: "UNAVAILABLE_ITEM", mode: "MANUAL" });
    // 202 is "taken": the answer is an event.
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("REQUESTED");

    expect(await deliver(h, specEvent("CANCELLATION_REQUESTED"))).toMatchObject({ kind: "ignored" });
    expect(await deliver(h, specEvent("CANCELLED"))).toEqual({ kind: "cancelled" });
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("CONFIRMED");
    expect(h.cancellationConfirmed).toEqual([orderId]);
  });

  it("CANCELLATION_REQUEST_DENIED fails the store's request, so a person finishes it on 99Food", async () => {
    const { h } = harness();
    await connect(h);
    const orderId = await arrive(h, SECOND_ORDER_ID);
    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "OUTSIDE_DELIVERY_HOURS" });
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);

    expect(await deliver(h, specEvent("CANCELLATION_REQUEST_DENIED", SECOND_ORDER_ID))).toEqual({ kind: "cancellationFailed" });
    expect(h.acceptance(orderId)?.cancellationStatus).toBe("FAILED");
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "REFUSED" }]);
  });

  it("retries a fetch 99Food did not answer, fails it on the last attempt, and the reconciliation re-queues it", async () => {
    const http = openDelivery({ order: () => ({ status: 503, body: "busy" }) });
    const { h } = harness({ http });
    await connect(h);
    await deliver(h, specEvent("CREATED"));
    const [job] = fetchJobs(h);

    await expect(h.engine.runFetchOrder(job!, ATTEMPT)).rejects.toThrow(/busy/);
    expect(await h.engine.runFetchOrder(job!, { attempt: 3, maxAttempts: 3 })).toMatchObject({ kind: "failed" });
    expect(h.memory.tables.marketplaceInboxEvent.rows[0]?.status).toBe("FAILED");
    expect(h.created).toEqual([]);

    // Past the job's own retry span, the sweep re-queues under a FRESH key,
    // which a queue that keeps finished job ids still takes.
    h.clock.at = new Date(h.clock.at.getTime() + FETCH_REQUEUE_AGE_MS + 1);
    const [stored] = await h.engine.retryable();
    expect(await h.engine.reprocess(stored!)).toEqual({ kind: "awaitingOrder" });
    expect(fetchJobs(h)).toHaveLength(2);
    expect(new Set(h.queued.map((job) => job.dedupeKey)).size).toBe(2);
    // The re-queued job fetches again (99Food still answers 503).
    await expect(h.engine.runFetchOrder(fetchJobs(h)[1]!, ATTEMPT)).rejects.toThrow(/busy/);
  });

  it("[N2] the sweep leaves a row still inside the fetch's retry span alone: no attempt spent, nothing queued", async () => {
    const { h } = harness({ queueDown: true });
    await connect(h);
    await deliver(h, specEvent("CREATED"));
    const attempts = h.memory.tables.marketplaceInboxEvent.rows[0]?.attempts;

    const [stored] = await h.engine.retryable();
    expect(await h.engine.reprocess(stored!)).toEqual({ kind: "awaitingOrder" });

    expect(h.memory.tables.marketplaceInboxEvent.rows[0]?.attempts).toBe(attempts);
    expect(h.enqueued.filter((job) => job.name === MARKETPLACE_FETCH_ORDER_JOB)).toHaveLength(1);
  });

  it("[B1] a CANCELLED that outruns the fetch wins: no pedido, no confirm, the CREATED row IGNORED", async () => {
    const { h, http } = harness({ queueDown: true });
    await connect(h, { autoAccept: true });
    await deliver(h, specEvent("CREATED"));
    const created = h.memory.tables.marketplaceInboxEvent.rows[0]!;

    // The fetch is held; 99Food cancels meanwhile.
    expect(await deliver(h, specEvent("CANCELLED"))).toEqual({ kind: "cancelled" });
    expect(await deliver(h, { ...specEvent("CANCELLED"), eventId: "redelivered" })).toEqual({ kind: "cancelled" });
    const outcome = await h.engine.runFetchOrder({ clientId: TENANT, inboxId: String(created.id) }, ATTEMPT);

    expect(outcome).toEqual({ kind: "skipped", reason: "cancelled before its order body arrived" });
    expect(http.requests.some((request) => request.method === "GET")).toBe(true);
    expect(h.created).toEqual([]);
    expect(h.accepted).toEqual([]);
    expect(h.enqueued.filter((job) => job.name === "marketplace.outbound")).toEqual([]);
    expect(created.status).toBe("IGNORED");
  });

  it("[N3] the acceptance window counts from the event's arrival, not from a delayed fetch", async () => {
    const { h } = harness();
    await connect(h);
    const arrived = h.clock.at;
    await deliver(h, specEvent("CREATED"));
    h.clock.at = new Date(arrived.getTime() + 3 * 60_000);

    const outcome = await h.engine.runFetchOrder(fetchJobs(h)[0]!, ATTEMPT);
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);

    expect(h.acceptance(outcome.orderId)?.acknowledgeBy).toEqual(new Date(arrived.getTime() + 300_000));
  });

  it("[N5] refuses, and records, an order naming another merchant than the connection's", async () => {
    const { h } = harness();
    await connect(h);
    h.patchIntegration({ externalMerchantId: "another-merchant" });
    await deliver(h, specEvent("CREATED"));

    const outcome = await h.engine.runFetchOrder(fetchJobs(h)[0]!, ATTEMPT);

    expect(outcome).toMatchObject({ kind: "failed", reason: /names merchant/ });
    expect(h.created).toEqual([]);
    expect(h.memory.tables.marketplaceInboxEvent.rows[0]).toMatchObject({ status: "IGNORED", error: /names merchant/ });
    expect(h.logged.some((line) => line.level === "error" && /names merchant/.test(line.message))).toBe(true);
  });

  it("a held fetch (the host's queue answers no) leaves the row PENDING and says so", async () => {
    const { h, http } = harness({ queueDown: true });
    await connect(h);

    expect(await deliver(h, specEvent("CREATED"))).toEqual({ kind: "awaitingOrder" });
    expect(http.requests).toEqual([]);
    expect(h.memory.tables.marketplaceInboxEvent.rows[0]?.status).toBe("PENDING");
    expect(h.logged.some((line) => line.level === "warn" && line.message.includes(MARKETPLACE_FETCH_ORDER_JOB))).toBe(true);
  });

  it("refuses the fetch with no credentials on file, and skips it while the connection is off", async () => {
    const { h, http } = harness();
    await connect(h);
    await deliver(h, specEvent("CREATED"));
    const [job] = fetchJobs(h);

    h.patchIntegration({ enabled: false });
    expect(await h.engine.runFetchOrder(job!, ATTEMPT)).toEqual({ kind: "skipped", reason: "integration is not enabled" });
    h.patchIntegration({ enabled: true, credentials: "" });
    expect(await h.engine.runFetchOrder(job!, ATTEMPT)).toMatchObject({ kind: "failed", reason: /no credentials/ });
    expect(http.requests).toEqual([]);
  });
});
