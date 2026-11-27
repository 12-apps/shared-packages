import { describe, expect, it } from "vitest";

import type { MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import {
  FETCH_REQUEUE_AGE_MS,
  FetchOrderRetryError,
  MARKETPLACE_FETCH_ORDER_JOB,
  type FetchOrderJobPayload,
} from "../../core/fetch-order";
import { TENANT, createHarness, deliverIfood, ifoodPlaced, scriptedHttp, type Harness } from "../../__tests__/harness";
import { IFOOD_ADAPTER_COPY_EN_US } from "../en-US";
import { normalizeIfoodEvent } from "../normalize";
import { IFOOD_MERCHANT, IFOOD_ORDER_ID, ifoodDocumentedOrder, ifoodPlacedById } from "./fixtures";

/**
 * FUT-5800: iFood's events carry only the order id, so a PLACED is recorded,
 * the order is fetched by the `marketplace.fetch-order` job after the commit
 * (`GET /order/v1.0/orders/{id}`), and ingested once. Replayed with the shapes
 * iFood documents for the event and the order (fixtures, no real data).
 */

const ATTEMPT = { attempt: 1, maxAttempts: 3 };
const LAST = { attempt: 3, maxAttempts: 3 };
const ORDER_URL = `https://merchant-api.ifood.com.br/order/v1.0/orders/${IFOOD_ORDER_ID}`;

type Answer = (request: MarketplaceHttpRequest, call: number) => MarketplaceHttpResponse;

/** iFood's API: the token grant, and the order read answered by `order` (the documented order by default). */
function ifoodApi(options: { order?: Answer; token?: Answer } = {}) {
  let reads = 0;
  let grants = 0;
  return scriptedHttp((request) => {
    if (request.url.endsWith("/oauth/token")) {
      grants += 1;
      return options.token ? options.token(request, grants) : { status: 200, body: JSON.stringify({ accessToken: `tok-${grants}`, expiresIn: 3600 }) };
    }
    reads += 1;
    return options.order ? options.order(request, reads) : { status: 200, body: JSON.stringify(ifoodDocumentedOrder()) };
  });
}

/** A harness connected to iFood under the fixtures' merchant. */
async function connected(http: ReturnType<typeof scriptedHttp>): Promise<Harness> {
  const h = createHarness({ http, dedupeQueue: true });
  await h.connect("IFOOD");
  h.patchIntegration({ externalMerchantId: IFOOD_MERCHANT });
  return h;
}

function fetchJobs(h: Harness): FetchOrderJobPayload[] {
  return h.queued.filter((job) => job.name === MARKETPLACE_FETCH_ORDER_JOB).map((job) => job.payload as FetchOrderJobPayload);
}

function inboxRow(h: Harness, eventId: string): Record<string, unknown> | undefined {
  return h.memory.tables.marketplaceInboxEvent.rows.find((row) => row.eventId === eventId);
}

function integrationStatus(h: Harness): unknown {
  return h.memory.tables.marketplaceIntegration.rows[0]?.status;
}

const gets = (http: ReturnType<typeof scriptedHttp>) => http.requests.filter((r) => r.method === "GET");

describe("iFood PLACED by id → fetched → ingested (FUT-5800)", () => {
  it("[F1] marks a PLACED without items orderToFetch, and one with items not", () => {
    const options = { missingStreetNumber: IFOOD_ADAPTER_COPY_EN_US.missingStreetNumber };
    const byId = normalizeIfoodEvent(ifoodPlacedById(), options);
    expect(byId).toMatchObject({ eventId: "evt-plc-1", eventType: "PLACED", externalOrderId: IFOOD_ORDER_ID, order: null, orderToFetch: true });
    expect(byId?.externalMerchantId).toBe(IFOOD_MERCHANT);
    const carried = normalizeIfoodEvent(ifoodPlaced("ord-1"), options);
    expect(carried?.order).not.toBeNull();
    expect(carried?.orderToFetch).toBeUndefined();
    // A non-PLACED event without a body is never fetched.
    expect(normalizeIfoodEvent({ id: "e", code: "CFM", orderId: "o" }, options)?.orderToFetch).toBeUndefined();
  });

  it("[F2] records the PLACED without calling iFood, then the job reads the order and ingests it", async () => {
    const http = ifoodApi();
    const h = await connected(http);

    expect(await deliverIfood(h, ifoodPlacedById())).toEqual({ kind: "awaitingOrder" });
    expect(http.requests).toEqual([]);
    expect(inboxRow(h, "evt-plc-1")).toMatchObject({ status: "PENDING", error: "order details to fetch" });
    const [job] = fetchJobs(h);
    expect(job).toBeDefined();
    expect(h.queued[0]?.dedupeKey).toBe(`${MARKETPLACE_FETCH_ORDER_JOB}:${job!.inboxId}`);

    const outcome = await h.engine.runFetchOrder(job!, ATTEMPT);

    expect(outcome).toMatchObject({ kind: "ingested", orderId: "order-1" });
    const [read] = gets(http);
    expect(read?.url).toBe(ORDER_URL);
    expect(read?.headers.Authorization).toBe("Bearer tok-1");
    expect(inboxRow(h, "evt-plc-1")?.status).toBe("PROCESSED");
    const order = h.created[0]!.order;
    expect(order).toMatchObject({
      provider: "IFOOD",
      externalOrderId: IFOOD_ORDER_ID,
      externalDisplayId: "8321",
      externalMerchantId: IFOOD_MERCHANT,
      buyer: { externalId: "cust-doc-1", name: "Cliente Teste", phone: "0800 000 0000" },
      totalCents: 6290,
      subtotalCents: 5790,
      deliveryFeeCents: 500,
      orderType: "DELIVERY",
      deliveredBy: "MERCHANT",
      pickupCode: null,
      deliveryAddress: { street: "Rua Exemplo", number: "100", neighborhood: "Centro", postalCode: "01001000", city: "São Paulo" },
    });
    expect(order.lines).toEqual([
      { externalSku: "PIZZA-G", name: "Pizza grande", quantity: 1, unitPriceCents: 4590, note: "Sem cebola" },
      { externalSku: "REFRI-LATA", name: "Refrigerante lata", quantity: 2, unitPriceCents: 600, note: null },
    ]);
  });

  it("[F3] lands the same order a PLACED carrying its body lands", async () => {
    const fetchedHarness = await connected(ifoodApi());
    await deliverIfood(fetchedHarness, ifoodPlacedById());
    await fetchedHarness.engine.runFetchOrder(fetchJobs(fetchedHarness)[0]!, ATTEMPT);

    const carriedHarness = await connected(ifoodApi());
    const carried = { ...ifoodPlacedById(), id: "evt-plc-carried", order: ifoodDocumentedOrder() };
    expect(await deliverIfood(carriedHarness, carried)).toMatchObject({ kind: "ingested" });

    const { externalMerchantId: _merchant, ...fetched } = fetchedHarness.created[0]!.order;
    expect(fetched).toEqual(carriedHarness.created[0]!.order);
    expect(fetchedHarness.created[0]!.lines).toEqual(carriedHarness.created[0]!.lines);
  });

  it("[F4] ingests ONE order when the webhook delivers the PLACED again, or the same order under another event", async () => {
    const http = ifoodApi();
    const h = await connected(http);
    await deliverIfood(h, ifoodPlacedById());

    // iFood redelivers the same event: a duplicate, nothing queued, nobody called.
    expect(await deliverIfood(h, ifoodPlacedById())).toEqual({ kind: "duplicate" });
    expect(fetchJobs(h)).toHaveLength(1);
    expect(http.requests).toEqual([]);

    await h.engine.runFetchOrder(fetchJobs(h)[0]!, ATTEMPT);
    // The job delivered twice by the queue: the row is settled, nothing is fetched again.
    expect(await h.engine.runFetchOrder(fetchJobs(h)[0]!, ATTEMPT)).toMatchObject({ kind: "skipped" });
    // The same order under another event id: fetched again, still one order.
    await deliverIfood(h, { ...ifoodPlacedById(), id: "evt-plc-2" });
    expect(await h.engine.runFetchOrder(fetchJobs(h)[1]!, ATTEMPT)).toMatchObject({ kind: "ingested", orderId: "order-1" });

    expect(h.created).toHaveLength(1);
    expect(gets(http)).toHaveLength(2);
  });

  it("[F5] answers no 2xx and queues nothing when the delivery cannot be recorded", async () => {
    const http = ifoodApi();
    const h = await connected(http);
    const table = h.memory.tables.marketplaceInboxEvent;
    table.create = async () => {
      throw new Error("database is down");
    };

    await expect(deliverIfood(h, ifoodPlacedById())).rejects.toThrow("database is down");

    expect(fetchJobs(h)).toEqual([]);
    expect(http.requests).toEqual([]);
  });

  it("[F6] retries a 5xx, then the last attempt settles the row FAILED", async () => {
    const http = ifoodApi({ order: () => ({ status: 503, body: "unavailable" }) });
    const h = await connected(http);
    await deliverIfood(h, ifoodPlacedById());
    const [job] = fetchJobs(h);

    await expect(h.engine.runFetchOrder(job!, ATTEMPT)).rejects.toBeInstanceOf(FetchOrderRetryError);
    expect(inboxRow(h, "evt-plc-1")?.status).toBe("PENDING");

    const last = await h.engine.runFetchOrder(job!, LAST);
    expect(last).toMatchObject({ kind: "failed" });
    expect(inboxRow(h, "evt-plc-1")).toMatchObject({ status: "FAILED" });
    expect(String(inboxRow(h, "evt-plc-1")?.error)).toContain("order fetch failed: status 503");
    // A marketplace outage is not our credentials.
    expect(integrationStatus(h)).toBe("UNVERIFIED");
    expect(h.created).toEqual([]);
  });

  it("[F7] retries a 404 (an order not served yet), and ingests once iFood serves it", async () => {
    const http = ifoodApi({
      order: (_request, call) =>
        call === 1 ? { status: 404, body: "not found" } : { status: 200, body: JSON.stringify(ifoodDocumentedOrder()) },
    });
    const h = await connected(http);
    await deliverIfood(h, ifoodPlacedById());
    const [job] = fetchJobs(h);

    await expect(h.engine.runFetchOrder(job!, ATTEMPT)).rejects.toBeInstanceOf(FetchOrderRetryError);
    expect(await h.engine.runFetchOrder(job!, { attempt: 2, maxAttempts: 3 })).toMatchObject({ kind: "ingested" });
  });

  it("[F8] re-queued by the sweep until the row's attempts are spent, then left FAILED for good", async () => {
    const http = ifoodApi({ order: () => ({ status: 500, body: "boom" }) });
    const h = await connected(http);
    await deliverIfood(h, ifoodPlacedById());
    await h.engine.runFetchOrder(fetchJobs(h)[0]!, LAST);

    let at = h.clock.at.getTime();
    for (let pass = 0; pass < 10; pass += 1) {
      at += FETCH_REQUEUE_AGE_MS + 1;
      h.setNow(new Date(at));
      for (const row of await h.engine.retryable()) {
        expect(await h.engine.reprocess(row)).toEqual({ kind: "awaitingOrder" });
        await h.engine.runFetchOrder(fetchJobs(h).at(-1)!, LAST);
      }
    }

    expect(await h.engine.retryable()).toEqual([]);
    expect(inboxRow(h, "evt-plc-1")).toMatchObject({ status: "FAILED" });
    // Bounded: never more reads than the inbox's attempt bound allows.
    expect(gets(http).length).toBeLessThanOrEqual(5);
  });

  it("[F9] a 401 forgets the token and reads once more with a new one", async () => {
    const http = ifoodApi({
      order: (request) =>
        request.headers.Authorization === "Bearer tok-1"
          ? { status: 401, body: "expired" }
          : { status: 200, body: JSON.stringify(ifoodDocumentedOrder()) },
    });
    const h = await connected(http);
    await deliverIfood(h, ifoodPlacedById());

    expect(await h.engine.runFetchOrder(fetchJobs(h)[0]!, ATTEMPT)).toMatchObject({ kind: "ingested" });
    expect(gets(http).map((r) => r.headers.Authorization)).toEqual(["Bearer tok-1", "Bearer tok-2"]);
    expect(integrationStatus(h)).toBe("UNVERIFIED");
  });

  it("[F10] a second 401 is our credentials refused: FAILED connection, no queue retry, no loop", async () => {
    const http = ifoodApi({ order: () => ({ status: 401, body: "unauthorized" }) });
    const h = await connected(http);
    await deliverIfood(h, ifoodPlacedById());

    // The FIRST attempt already ends it: retrying would hit the same wall.
    const outcome = await h.engine.runFetchOrder(fetchJobs(h)[0]!, ATTEMPT);

    expect(outcome).toMatchObject({ kind: "failed" });
    expect(String(inboxRow(h, "evt-plc-1")?.error)).toContain("order fetch failed: refused 401");
    expect(integrationStatus(h)).toBe("FAILED");
    expect(h.published).toContain(TENANT);
    expect(gets(http)).toHaveLength(2);
    // The sweep does not touch it again before its own cadence.
    expect(await h.engine.reprocess((await h.engine.retryable())[0]!)).toEqual({ kind: "awaitingOrder" });
    expect(fetchJobs(h)).toHaveLength(1);
  });

  it("[F11] a token grant iFood refuses is our credentials refused too", async () => {
    const http = ifoodApi({ token: () => ({ status: 401, body: "invalid_client" }) });
    const h = await connected(http);
    await deliverIfood(h, ifoodPlacedById());

    expect(await h.engine.runFetchOrder(fetchJobs(h)[0]!, ATTEMPT)).toMatchObject({ kind: "failed" });
    expect(integrationStatus(h)).toBe("FAILED");
    expect(gets(http)).toEqual([]);
  });

  it("[F12] refuses an order naming another merchant than the connection's", async () => {
    const http = ifoodApi({
      order: () => ({ status: 200, body: JSON.stringify({ ...ifoodDocumentedOrder(), merchant: { id: "someone-else", name: "X" } }) }),
    });
    const h = await connected(http);
    await deliverIfood(h, ifoodPlacedById());

    expect(await h.engine.runFetchOrder(fetchJobs(h)[0]!, ATTEMPT)).toMatchObject({ kind: "failed" });
    expect(h.created).toEqual([]);
    expect(integrationStatus(h)).toBe("UNVERIFIED");
  });

  it("[F13] a CANCELLED that outran the fetch wins: nothing is ingested", async () => {
    const http = ifoodApi();
    const h = await connected(http);
    await deliverIfood(h, ifoodPlacedById());
    await deliverIfood(h, { id: "evt-can-1", code: "CAN", fullCode: "CANCELLED", orderId: IFOOD_ORDER_ID, merchantId: IFOOD_MERCHANT });

    expect(await h.engine.runFetchOrder(fetchJobs(h)[0]!, ATTEMPT)).toMatchObject({ kind: "skipped" });
    expect(h.created).toEqual([]);
  });
});
