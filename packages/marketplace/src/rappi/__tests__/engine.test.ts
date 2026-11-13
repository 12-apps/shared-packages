import { describe, expect, it } from "vitest";

import type { MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import { createIfoodAdapter } from "../../ifood";
import { IFOOD_ADAPTER_COPY_EN_US } from "../../ifood/en-US";
import { createNinetyNineFoodAdapter } from "../../99food";
import { NINETY_NINE_FOOD_ADAPTER_COPY_EN_US } from "../../99food/en-US";
import { TENANT, createHarness, scriptedHttp, type Harness } from "../../__tests__/harness";
import { createRappiAdapter, RAPPI_CANCELLATION_ANSWER_WINDOW_MS, RAPPI_PROVIDER } from "..";
import { RAPPI_ADAPTER_COPY_EN_US } from "../en-US";
import { API_BASE, AUTH_BASE, PORTAL, PORTAL_ORDER_ID, PORTAL_STORE_ID, portalCancel, portalOrder, portalOtherEvent } from "./fixtures";

/**
 * The engine, unchanged but for R3-N2, driven through the Rappi adapter end to
 * end: NEW_ORDER webhook → ingest → aceite → take → reject (answered in the
 * response) → ORDER_EVENT_CANCEL.
 *
 * The owner's rule is the point: "the integration engine must be the same for
 * all integrations: iFood, Rappi, 99. Only an adapter is made for each one."
 * Rappi is registered beside iFood and 99Food, and nothing below names it
 * outside the adapter.
 */

const P = RAPPI_PROVIDER;
const ATTEMPT = { attempt: 1, maxAttempts: 3 };
const ORDERS = `${API_BASE.SANDBOX}/api/v2/restaurants-integrations-public-api/orders`;
const TOKEN = { status: 200, body: JSON.stringify({ access_token: "tok" }) };

/** Rappi's API as the portal describes it: a token, then 200 for take and reject. */
function rappiApi(
  answer: (request: MarketplaceHttpRequest) => MarketplaceHttpResponse | Promise<MarketplaceHttpResponse> = () => ({
    status: 200,
    body: "",
  }),
) {
  return scriptedHttp((request) => (request.url.startsWith(AUTH_BASE.SANDBOX) ? TOKEN : answer(request)));
}

function harness(options: { http?: ReturnType<typeof scriptedHttp> } = {}) {
  const http = options.http ?? rappiApi();
  const mounted = createHarness({
    http,
    dedupeQueue: true,
    // A host that requests first and cancels on the marketplace's answer (FUT-4758).
    cancellationHooks: true,
    adapters: [
      createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US }),
      createNinetyNineFoodAdapter({
        copy: NINETY_NINE_FOOD_ADAPTER_COPY_EN_US,
        apiBaseUrl: { SANDBOX: "https://od.example.test", PRODUCTION: "https://od.example.test" },
        portalUrl: "https://od-portal.example.test",
      }),
      createRappiAdapter({
        copy: RAPPI_ADAPTER_COPY_EN_US,
        apiBaseUrl: API_BASE,
        authBaseUrl: AUTH_BASE,
        portalUrl: PORTAL,
        amountUnit: "MINOR_UNITS",
      }),
    ],
  });
  return { h: mounted, http };
}

/** Deliver one Rappi webhook body for the tenant, as the webhook route does once the signature passed. */
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

/** Connect Rappi for the tenant, under the portal sample's store. */
async function connect(subject: Harness, settings: { autoAccept?: boolean } = {}) {
  await subject.connect(P, settings);
  subject.patchIntegration({ externalMerchantId: PORTAL_STORE_ID });
}

/** NEW_ORDER → an ingested order's host id. */
async function arrive(subject: Harness, orderId = PORTAL_ORDER_ID): Promise<string> {
  const outcome = await deliver(subject, portalOrder(orderId));
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  return outcome.orderId;
}

describe("the engine through the Rappi adapter, end to end", () => {
  it("[P1] registers beside iFood and 99Food and takes its webhooks at the one route", () => {
    const { h } = harness();
    expect(h.engine.providers()).toEqual(["IFOOD", "NINETY_NINE_FOOD", P]);
    expect(h.engine.reasons(P)).toHaveLength(6);
    expect(h.engine.suggestReason(P, { itemUnavailable: true })?.code).toBe("ITEM_OUT_OF_STOCK");
    expect(h.engine.appLink(P, { externalOrderId: PORTAL_ORDER_ID, externalDisplayId: PORTAL_ORDER_ID })).toBe(PORTAL);
  });

  it("[P1] ingests the NEW_ORDER the webhook carries, calling nobody, and dedups its redelivery", async () => {
    const { h, http } = harness();
    await connect(h);

    expect(await deliver(h, portalOrder())).toEqual({ kind: "ingested", orderId: "order-1", unmappedSkus: ["1234", "2089918082"] });
    expect(await deliver(h, portalOrder())).toEqual({ kind: "duplicate" });

    expect(http.requests).toEqual([]);
    expect(h.created).toHaveLength(1);
    expect(h.created[0]?.order).toMatchObject({ provider: P, totalCents: 204180, commissionCents: null });
    expect((await h.engine.pending(TENANT)).map((row) => row.provider)).toEqual([P]);
    // The deadline counts from the arrival.
    expect(h.acceptance("order-1")?.acknowledgeBy).toEqual(new Date(h.clock.at.getTime() + 300_000));
  });

  it("[P1] the aceite takes the order on Rappi with the stated cooking time", async () => {
    const { h, http } = harness();
    await connect(h);
    const orderId = await arrive(h);

    await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT", preparationMinutes: 25 });
    expect(await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, ATTEMPT)).toEqual({
      kind: "done",
      action: "confirm",
    });

    expect(http.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST ${AUTH_BASE.SANDBOX}/restaurants/auth/v1/token/login/integrations`,
      `PUT ${ORDERS}/${PORTAL_ORDER_ID}/take/25`,
    ]);
    expect(http.requests[1]?.headers["x-authorization"]).toBe("Bearer tok");
    expect(h.acceptance(orderId)?.confirmedAt).toEqual(h.clock.at);
  });

  it("[P1] a refusal rejects on Rappi, and the 200 IS the answer: cancelled here at once, told once", async () => {
    const { h, http } = harness();
    await connect(h);
    const orderId = await arrive(h);

    await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "ITEM_OUT_OF_STOCK", offendingSkus: ["1234"] });
    expect(h.acceptance(orderId)).toMatchObject({ status: "AWAITING", cancellationStatus: "PENDING" });
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);

    const reject = http.requests.at(-1);
    expect(`${reject?.method} ${reject?.url}`).toBe(`PUT ${ORDERS}/${PORTAL_ORDER_ID}/reject`);
    expect(JSON.parse(reject?.body ?? "{}")).toEqual({ reason: "Item unavailable", cancel_type: "ITEM_OUT_OF_STOCK", items_skus: ["1234"] });
    expect(h.acceptance(orderId)).toMatchObject({ status: "REJECTED", cancellationStatus: "CONFIRMED" });
    expect(h.cancellationConfirmed).toEqual([orderId]);
    expect(h.refused).toEqual([]);

    // Rappi's own cancel event for the same order afterwards changes nothing and tells nobody twice.
    expect(await deliver(h, portalCancel(PORTAL_ORDER_ID, PORTAL_STORE_ID))).toEqual({ kind: "cancelled" });
    expect(h.cancellationConfirmed).toEqual([orderId]);
  });

  it("a reject Rappi refuses (400, the order is no longer SENT) FAILS the request: the order stays, the portal link", async () => {
    const { h } = harness({ http: rappiApi(() => ({ status: 400, body: "Invalid state transition" })) });
    await connect(h);
    const orderId = await arrive(h);

    await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "ORDER_TOTAL_INCORRECT" });
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);

    expect(h.acceptance(orderId)).toMatchObject({ status: "AWAITING", cancellationStatus: "FAILED", cancellationFailureReason: "REFUSED" });
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "REFUSED" }]);
    expect((await h.engine.orderStates(TENANT, [orderId])).get(orderId)?.appUrl).toBe(PORTAL);
  });

  it("[P1] a cancel after take has no public endpoint: FAILED at once, nothing sent, the portal opens", async () => {
    const { h, http } = harness();
    await connect(h);
    const orderId = await arrive(h);
    await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });
    const calls = http.requests.length;

    const cancel = await h.engine.recordStoreCancellation({ clientId: TENANT, orderId, reasonCode: "ORDER_MISSING_INFORMATION" });

    expect(cancel).toMatchObject({ kind: "decided", status: "ACCEPTED", cancellation: "FAILED" });
    expect(h.enqueued.filter((job) => job.payload.action === "requestCancellation")).toEqual([]);
    expect(http.requests).toHaveLength(calls);
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "REFUSED" }]);
  });

  it("[P1] ORDER_EVENT_CANCEL cancels the order Rappi cancelled; ORDER_OTHER_EVENT is recorded and ignored", async () => {
    const { h } = harness();
    await connect(h);
    const orderId = await arrive(h);

    expect(await deliver(h, portalOtherEvent(PORTAL_ORDER_ID))).toMatchObject({ kind: "ignored" });
    expect(await deliver(h, portalCancel(PORTAL_ORDER_ID, PORTAL_STORE_ID))).toEqual({ kind: "cancelled" });

    expect(h.acceptance(orderId)?.status).toBe("REJECTED");
    expect(h.refused).toEqual([{ orderId, reason: "CANCELLED" }]);
  });

  it("[N5] settles a NEW_ORDER naming another store FAILED, and ingests it once the connection's id is corrected", async () => {
    const { h } = harness();
    await connect(h);
    h.patchIntegration({ externalMerchantId: "another-store" });

    const outcome = await deliver(h, portalOrder());

    expect(outcome).toMatchObject({ kind: "failed", reason: /names merchant 30000011/ });
    expect(h.created).toEqual([]);
    expect(h.memory.tables.marketplaceInboxEvent.rows[0]).toMatchObject({ status: "FAILED", error: /names merchant/ });
    expect(h.logged.some((line) => line.level === "error" && /names merchant/.test(line.message))).toBe(true);

    h.patchIntegration({ externalMerchantId: PORTAL_STORE_ID });
    const [stored] = await h.engine.retryable();
    expect(await h.engine.reprocess(stored!)).toMatchObject({ kind: "ingested" });
  });

  it("[R3-N2] a 'rejected' that lands after the sweep timed the request out AND the store accepted still cancels the order", async () => {
    const box: { h?: Harness; orderId?: string } = {};
    const http = rappiApi(async (request) => {
      const { h, orderId } = box;
      if (request.url.endsWith("/reject") && h && orderId) {
        // While the reject is in flight: the window passes, the sweep times the
        // request out, and the store, told so, accepts the order.
        h.clock.at = new Date(h.clock.at.getTime() + RAPPI_CANCELLATION_ANSWER_WINDOW_MS + 1);
        await h.engine.sweepOutbound();
        expect(h.acceptance(orderId)).toMatchObject({ status: "AWAITING", cancellationStatus: "FAILED", cancellationFailureReason: "TIMEOUT" });
        expect(await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" })).toMatchObject({
          kind: "decided",
          status: "ACCEPTED",
        });
        expect(h.acceptance(orderId)).toMatchObject({ status: "ACCEPTED", cancellationStatus: null });
      }
      return { status: 200, body: "" };
    });
    const { h } = harness({ http });
    box.h = h;
    await connect(h);
    const orderId = await arrive(h);
    box.orderId = orderId;
    await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "ORDER_TOTAL_INCORRECT" });

    // The reject reaches Rappi, which answers "Order successfully rejected" — late.
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);

    // Rappi rejected it, so it is cancelled here too, and the host hears it once.
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "TIMEOUT" }]);
    expect(h.accepted).toEqual([orderId]);
    expect(h.acceptance(orderId)).toMatchObject({ status: "REJECTED", cancellationStatus: "CONFIRMED", cancellationFailureReason: null });
    expect(h.cancellationConfirmed).toEqual([orderId]);
    // The take the accept queued is no longer owed.
    expect(await h.engine.runOutbound({ clientId: TENANT, orderId, action: "confirm" }, ATTEMPT)).toMatchObject({ kind: "skipped" });
    expect(http.requests.some((request) => request.url.includes("/take/"))).toBe(false);
  });

  it("[R3-N2] the tombstone is matched only by a cancellation: a late refusal leaves the accepted order as it is", async () => {
    const box: { h?: Harness; orderId?: string } = {};
    const http = rappiApi(async (request) => {
      const { h, orderId } = box;
      if (request.url.endsWith("/reject") && h && orderId) {
        h.clock.at = new Date(h.clock.at.getTime() + RAPPI_CANCELLATION_ANSWER_WINDOW_MS + 1);
        await h.engine.sweepOutbound();
        await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });
      }
      return { status: 400, body: "Invalid state transition" };
    });
    const { h } = harness({ http });
    box.h = h;
    await connect(h);
    const orderId = await arrive(h);
    box.orderId = orderId;
    await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "ORDER_TOTAL_INCORRECT" });

    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);

    // Rappi refused the reject: the accepted order stands, and the host heard only the timeout.
    expect(h.acceptance(orderId)).toMatchObject({ status: "ACCEPTED", cancellationStatus: null });
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "TIMEOUT" }]);
    expect(h.cancellationConfirmed).toEqual([]);
  });
});
