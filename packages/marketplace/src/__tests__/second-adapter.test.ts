import { describe, expect, it } from "vitest";

import { outboundResultOf, type MarketplaceAdapter } from "../core/adapter";
import type { NormalizedEvent } from "../core/types";
import { createIfoodAdapter } from "../ifood";
import { IFOOD_ADAPTER_COPY_EN_US } from "../ifood/en-US";
import { TENANT, createHarness, scriptedHttp } from "./harness";

/**
 * The owner's rule, as a test: "the integration engine must be the same for
 * all integrations. Only an adapter is made for each one."
 *
 * A FAKE second marketplace is registered beside iFood — a different wire
 * format, a different signature header, a synchronous cancellation, a
 * per-order app link — and driven through ingest, confirm and cancel by the
 * engine exactly as it is. Nothing in this file touches engine code: if a
 * second marketplace ever needs an engine change, this suite is where it shows.
 */

const ACME = "ACME_EATS";

/** A made-up marketplace whose wire format looks nothing like iFood's. */
function acmeEvent(payload: unknown): NormalizedEvent | null {
  const body = payload as { event?: string; ref?: string; shop?: string; basket?: { sku: string; qty: number; price: number }[] };
  if (!body.ref || !body.event) return null;
  const placed = body.event === "new";
  return {
    provider: ACME,
    eventId: `${body.ref}:${body.event}`,
    eventType: body.event,
    externalMerchantId: body.shop ?? null,
    externalOrderId: body.ref,
    order: placed
      ? {
          provider: ACME,
          externalOrderId: body.ref,
          externalDisplayId: null,
          buyer: { externalId: null, name: null, phone: null },
          lines: (body.basket ?? []).map((line) => ({
            externalSku: line.sku,
            name: line.sku,
            quantity: line.qty,
            unitPriceCents: line.price,
            note: null,
          })),
          totalCents: (body.basket ?? []).reduce((sum, line) => sum + line.qty * line.price, 0),
          commissionCents: null,
          deliveryDueAt: null,
          placedAt: new Date("2026-11-11T11:00:00.000Z"),
        }
      : null,
    cancelled: body.event === "voided",
  };
}

const acmeAdapter: MarketplaceAdapter = {
  provider: ACME,
  capabilities: {
    apiConfirm: true,
    apiCancel: true,
    cancelAfterAccept: false,
    asyncCancellationOutcome: false,
    perOrderAppLink: true,
    confirmTakesPreparationTime: true,
  },
  normalize: acmeEvent,
  readSignature: (header) => header("x-acme-hmac"),
  verifySignature: (_raw, signature, secret) => secret === null || signature === `ok:${secret}`,
  cancellationReasons: () => [
    { code: "OUT_OF_STOCK", label: "Out of stock", itemUnavailable: true, needsItems: true },
    { code: "CLOSED", label: "Closed", itemUnavailable: false, needsItems: false },
  ],
  confirm: async (ctx, order, _input) =>
    outboundResultOf(
      await ctx.http({
        method: "PUT",
        // Its confirm states the preparation time; 20 when the store gave none.
        url: `https://api.acme.test/orders/${order.externalOrderId}/take/${_input.preparationMinutes ?? 20}`,
        headers: { "X-App": ctx.credentials.clientId },
      }),
    ),
  requestCancellation: async (ctx, order, input) =>
    outboundResultOf(
      await ctx.http({
        method: "PUT",
        url: `https://api.acme.test/orders/${order.externalOrderId}/reject`,
        headers: { "X-App": ctx.credentials.clientId },
        body: JSON.stringify({ type: input.reason.code, items_skus: input.offendingSkus }),
      }),
    ),
  appLink: (order) => `https://partners.acme.test/orders/${encodeURIComponent(order.externalOrderId)}`,
};

function harness() {
  const http = scriptedHttp((request) =>
    request.url.startsWith("https://api.acme.test/") ? { status: 200, body: "{}" } : { status: 500, body: "" },
  );
  const mounted = createHarness({
    http,
    adapters: [createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US }), acmeAdapter],
  });
  return { h: mounted, http };
}

async function deliverAcme(subject: ReturnType<typeof harness>["h"], payload: unknown) {
  const event = subject.engine.normalize(ACME, payload);
  if (!event) throw new Error("did not normalize");
  const target = await subject.engine.target(TENANT, ACME);
  return subject.engine.deliver({
    clientId: TENANT,
    event,
    payload,
    settings: target?.enabled ? { autoAccept: target.autoAccept, ackSlaSeconds: target.ackSlaSeconds } : null,
  });
}

describe("a second marketplace is an adapter and nothing else", () => {
  it("registers beside iFood and is reachable through every engine entry", () => {
    const { h } = harness();
    expect(h.engine.providers()).toEqual(["IFOOD", ACME]);
    expect(h.engine.knows(ACME)).toBe(true);
    expect(h.engine.adapter(ACME)?.capabilities.perOrderAppLink).toBe(true);
    expect(h.engine.reasons(ACME).map((reason) => reason.code)).toEqual(["OUT_OF_STOCK", "CLOSED"]);
    expect(h.engine.readSignature(ACME, (name) => (name === "x-acme-hmac" ? "ok:s" : null))).toBe("ok:s");
    expect(h.engine.verifySignature(ACME, "{}", "ok:s", "s")).toBe(true);
    expect(h.engine.appLink(ACME, { externalOrderId: "A 1", externalDisplayId: null })).toBe(
      "https://partners.acme.test/orders/A%201",
    );
  });

  it("ingests through the same inbox, SKU map and clock", async () => {
    const { h } = harness();
    await h.connect(ACME);
    const payload = { event: "new", ref: "A-1", shop: "merchant-ACME_EATS", basket: [{ sku: "X", qty: 1, price: 900 }] };

    const outcome = await deliverAcme(h, payload);
    const redelivered = await deliverAcme(h, payload);

    expect(outcome).toMatchObject({ kind: "ingested", unmappedSkus: ["X"] });
    expect(redelivered).toEqual({ kind: "duplicate" });
    expect(h.created).toHaveLength(1);
    expect(await h.engine.tenantFor(ACME, "merchant-ACME_EATS")).toBe(TENANT);
    expect((await h.engine.pending(TENANT)).map((row) => row.provider)).toEqual([ACME]);
    expect((await h.engine.menuLinks({ clientId: TENANT, provider: ACME, unmappedOnly: true })).length).toBe(1);
  });

  it("confirms through its own API on accept", async () => {
    const { h, http } = harness();
    await h.connect(ACME);
    const outcome = await deliverAcme(h, { event: "new", ref: "A-1", basket: [{ sku: "X", qty: 1, price: 900 }] });
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);

    await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "ACCEPT" });
    const run = await h.engine.runOutbound(
      { clientId: TENANT, orderId: outcome.orderId, action: "confirm" },
      { attempt: 1, maxAttempts: 3 },
    );

    expect(run).toEqual({ kind: "done", action: "confirm" });
    expect(http.requests.map((r) => `${r.method} ${r.url}`)).toEqual(["PUT https://api.acme.test/orders/A-1/take/20"]);
    expect(h.acceptance(outcome.orderId)?.confirmedAt).toEqual(h.clock.at);
  });

  it("cancels with its own reason, and a synchronous answer is CONFIRMED at once", async () => {
    const { h, http } = harness();
    await h.connect(ACME);
    const outcome = await deliverAcme(h, { event: "new", ref: "A-1", basket: [{ sku: "X", qty: 1, price: 900 }] });
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);

    const decided = await h.engine.decide({
      clientId: TENANT,
      orderId: outcome.orderId,
      decision: "REJECT",
      reasonCode: "OUT_OF_STOCK",
      offendingSkus: ["X"],
    });
    expect(decided).toMatchObject({
      kind: "decided",
      cancellation: "PENDING",
      reasonCode: "OUT_OF_STOCK",
      offendingSkus: ["X"],
    });
    // iFood's codes are not this marketplace's.
    expect(
      await h.engine.recordStoreCancellation({ clientId: TENANT, orderId: outcome.orderId, reasonCode: "503" }),
    ).toEqual({ kind: "stale", reason: "ALREADY_DECIDED", status: "REJECTED" });

    await h.engine.runOutbound(
      { clientId: TENANT, orderId: outcome.orderId, action: "requestCancellation" },
      { attempt: 1, maxAttempts: 3 },
    );

    expect(JSON.parse(http.requests[0]?.body ?? "{}")).toEqual({ type: "OUT_OF_STOCK", items_skus: ["X"] });
    expect(h.acceptance(outcome.orderId)?.cancellationStatus).toBe("CONFIRMED");
  });

  it("[B4] refuses an item reason with no items, or with an item the order does not carry, writing nothing", async () => {
    const { h } = harness();
    await h.connect(ACME);
    const outcome = await deliverAcme(h, { event: "new", ref: "A-1", basket: [{ sku: "X", qty: 1, price: 900 }] });
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);
    const orderId = outcome.orderId;

    const none = await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "OUT_OF_STOCK" });
    const stranger = await h.engine.decideMany({
      clientId: TENANT,
      decisions: [{ orderId, decision: "REJECT", reasonCode: "OUT_OF_STOCK", offendingSkus: ["X", "NOT-IN-ORDER"] }],
    });

    expect(none).toEqual({ kind: "invalidReason", problem: "ITEMS_REQUIRED", validCodes: [] });
    expect(stranger).toEqual({
      kind: "refused",
      problems: [{ path: ["decisions", 0, "offendingSkus", 1], code: "UNKNOWN_ITEM" }],
    });
    expect(h.acceptance(orderId)).toMatchObject({ status: "AWAITING", cancellationStatus: null });
    // A reason that needs no items takes none.
    expect(await h.engine.decide({ clientId: TENANT, orderId, decision: "REJECT", reasonCode: "CLOSED" })).toMatchObject({
      kind: "decided",
      offendingSkus: [],
    });
  });

  it("[N8] feeds the stated preparation time to a marketplace whose confirm takes one", async () => {
    const { h, http } = harness();
    await h.connect(ACME);
    const outcome = await deliverAcme(h, { event: "new", ref: "A-1", basket: [{ sku: "X", qty: 1, price: 900 }] });
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);

    await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "ACCEPT", preparationMinutes: 35 });
    await h.engine.runOutbound(
      { clientId: TENANT, orderId: outcome.orderId, action: "confirm" },
      { attempt: 1, maxAttempts: 3 },
    );

    expect(http.requests[0]?.url).toBe("https://api.acme.test/orders/A-1/take/35");
  });

  it("stamps FAILED at once when its API cannot cancel after an accept, and queues nothing", async () => {
    const { h, http } = harness();
    await h.connect(ACME);
    const outcome = await deliverAcme(h, { event: "new", ref: "A-1", basket: [{ sku: "X", qty: 1, price: 900 }] });
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);
    await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "ACCEPT" });

    const result = await h.engine.recordStoreCancellation({
      clientId: TENANT,
      orderId: outcome.orderId,
      reasonCode: "CLOSED",
    });

    expect(result).toMatchObject({ kind: "decided", cancellation: "FAILED" });
    expect(h.enqueued.map((job) => job.payload.action)).toEqual(["confirm"]);
    expect(http.requests).toHaveLength(0);
    const state = (await h.engine.orderStates(TENANT, [outcome.orderId])).get(outcome.orderId);
    expect(state?.appUrl).toBe("https://partners.acme.test/orders/A-1");
  });

  it("takes the marketplace's own cancellation event through the same path", async () => {
    const { h } = harness();
    await h.connect(ACME);
    const outcome = await deliverAcme(h, { event: "new", ref: "A-1", basket: [{ sku: "X", qty: 1, price: 900 }] });
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);

    expect(await deliverAcme(h, { event: "voided", ref: "A-1" })).toEqual({ kind: "cancelled" });
    expect(h.refused).toEqual([{ orderId: outcome.orderId, reason: "CANCELLED" }]);
  });

  it("leaves iFood untouched: each provider's codes and URLs stay its own", () => {
    const { h } = harness();
    expect(h.engine.reasons("IFOOD")[0]?.code).toBe("501");
    expect(h.engine.normalize(ACME, { orderId: "ifood-shaped", code: "PLC" })).toBeNull();
  });
});
