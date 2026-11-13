import { readdirSync, readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

import { outboundResultOf, type MarketplaceAdapter, type MarketplaceHttpRequest } from "../core/adapter";
import type { NormalizedEvent } from "../core/types";
import { createIfoodAdapter } from "../ifood";
import { IFOOD_ADAPTER_COPY_EN_US } from "../ifood/en-US";
import { TENANT, createHarness, deliverIfood, ifoodPlaced, scriptedHttp, type Harness } from "./harness";
import { pgliteDb } from "./pglite-db";

/**
 * R3-N2 at the engine (FUT-4765): a SYNCHRONOUS marketplace's late answer to
 * the cancellation call in flight, after the sweep timed the request out and
 * the store accepted the order. The accept keeps `cancellation_requested_at`
 * as a tombstone; only the same request's "cancelled", on an order still
 * ACCEPTED, matches it. Driven through a fake synchronous adapter (and iFood,
 * asynchronous), so no marketplace is named by the rule.
 */

/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   The Postgres case reads the committed SQL and boots its own in-memory PGlite inside the case. */

vi.setConfig({ testTimeout: 60_000 });

const SYNC = "SYNC_EATS";
const ATTEMPT = { attempt: 1, maxAttempts: 3 };
const WINDOW_MS = 60_000;

/** A made-up marketplace that answers a cancellation in the response, and cannot cancel after an accept. */
function syncEvent(payload: unknown): NormalizedEvent | null {
  const body = payload as { ref?: string; kind?: string };
  if (!body.ref) return null;
  const placed = body.kind === "new";
  return {
    provider: SYNC,
    eventId: `${body.ref}:${body.kind ?? "?"}`,
    eventType: body.kind ?? "?",
    externalMerchantId: null,
    externalOrderId: body.ref,
    order: placed
      ? {
          provider: SYNC,
          externalOrderId: body.ref,
          externalDisplayId: null,
          buyer: { externalId: null, name: null, phone: null },
          lines: [{ externalSku: "X", name: "X", quantity: 1, unitPriceCents: 900, note: null }],
          totalCents: 900,
          commissionCents: null,
          deliveryDueAt: null,
          placedAt: new Date("2026-11-11T11:00:00.000Z"),
        }
      : null,
    cancelled: body.kind === "voided",
  };
}

const syncAdapter: MarketplaceAdapter = {
  provider: SYNC,
  capabilities: {
    apiConfirm: true,
    apiCancel: true,
    cancelAfterAccept: false,
    asyncCancellationOutcome: false,
    perOrderAppLink: false,
    confirmTakesPreparationTime: false,
  },
  normalize: syncEvent,
  readSignature: () => null,
  verifySignature: () => true,
  cancellationReasons: () => [{ code: "CLOSED", label: "Closed", itemUnavailable: false, needsItems: false }],
  confirm: async (ctx, order) =>
    outboundResultOf(await ctx.http({ method: "PUT", url: `https://sync.test/${order.externalOrderId}/take`, headers: {} })),
  requestCancellation: async (ctx, order) =>
    outboundResultOf(await ctx.http({ method: "PUT", url: `https://sync.test/${order.externalOrderId}/reject`, headers: {} })),
  appLink: () => "https://sync.test/portal",
};

/** Something the fake HTTP does while the reject is in flight, before it answers. */
type InFlight = (mounted: Harness, orderId: string) => Promise<void>;

function mount(inFlight: InFlight | null, options: { status?: number; store?: ReturnType<typeof pgliteDb> } = {}) {
  const slot: { mounted?: Harness; orderId?: string } = {};
  const http = scriptedHttp(async (request: MarketplaceHttpRequest) => {
    if (request.url.endsWith("/reject") && inFlight && slot.mounted && slot.orderId) await inFlight(slot.mounted, slot.orderId);
    return { status: options.status ?? 200, body: "" };
  });
  const mounted = createHarness({
    http,
    cancellationHooks: true,
    cancellationWindowMs: WINDOW_MS,
    ...(options.store ? { store: options.store } : {}),
    adapters: [createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US }), syncAdapter],
  });
  slot.mounted = mounted;
  return { h: mounted, http, slot };
}

/** An order of the fake marketplace, refused by the store: a PENDING request on an AWAITING order. */
async function refused(subject: ReturnType<typeof mount>): Promise<string> {
  const { h: mounted, slot } = subject;
  await mounted.connect(SYNC);
  const event = mounted.engine.normalize(SYNC, { ref: "S-1", kind: "new" });
  const outcome = await mounted.engine.deliver({
    clientId: TENANT,
    event: event!,
    payload: {},
    settings: { autoAccept: false, ackSlaSeconds: 300 },
  });
  if (outcome.kind !== "ingested") throw new Error(outcome.kind);
  slot.orderId = outcome.orderId;
  await mounted.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "REJECT", reasonCode: "CLOSED" });
  return outcome.orderId;
}

/** The R3-N2 race: the window passes, the sweep times the request out, the store accepts. */
const timedOutThenAccepted: InFlight = async (mounted, orderId) => {
  mounted.clock.at = new Date(mounted.clock.at.getTime() + WINDOW_MS + 1);
  await mounted.engine.sweepOutbound();
  await mounted.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });
};

describe("the accept leaves a tombstone of the request it clears", () => {
  it("an ACCEPT after a FAILED request keeps cancellation_requested_at and clears the other four columns", async () => {
    const subject = mount(null, { status: 400 });
    const { h } = subject;
    const orderId = await refused(subject);
    const requestedAt = h.acceptance(orderId)?.cancellationRequestedAt;
    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);
    expect(h.acceptance(orderId)).toMatchObject({ cancellationStatus: "FAILED", cancellationFailureReason: "REFUSED" });

    await h.engine.decide({ clientId: TENANT, orderId, decision: "ACCEPT" });

    expect(requestedAt).toBeInstanceOf(Date);
    expect(h.acceptance(orderId)).toMatchObject({
      status: "ACCEPTED",
      cancellationStatus: null,
      cancellationReasonCode: null,
      cancellationOffendingSkus: null,
      cancellationFailureReason: null,
      cancellationRequestedAt: requestedAt,
    });
  });

  it("an ACCEPT on a row with no request writes none of the request's columns", async () => {
    const { h } = mount(null);
    await h.connect(SYNC);
    const event = h.engine.normalize(SYNC, { ref: "S-2", kind: "new" });
    const outcome = await h.engine.deliver({ clientId: TENANT, event: event!, payload: {}, settings: { autoAccept: false, ackSlaSeconds: 300 } });
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);

    await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "ACCEPT" });

    expect(h.acceptance(outcome.orderId)).toMatchObject({ status: "ACCEPTED", cancellationStatus: null, cancellationRequestedAt: null });
  });
});

describe("a synchronous late answer to the call in flight", () => {
  it("[R3-N2] confirms the tombstone of the same request on an order still ACCEPTED, told once", async () => {
    const subject = mount(timedOutThenAccepted);
    const { h } = subject;
    const orderId = await refused(subject);

    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);

    expect(h.accepted).toEqual([orderId]);
    expect(h.cancellationFailed).toEqual([{ orderId, reason: "TIMEOUT" }]);
    expect(h.acceptance(orderId)).toMatchObject({ status: "REJECTED", cancellationStatus: "CONFIRMED" });
    expect(h.cancellationConfirmed).toEqual([orderId]);
    expect(h.refused).toEqual([]);
  });

  it("does not confirm a tombstone of ANOTHER instant", async () => {
    const subject = mount(async (mounted, orderId) => {
      await timedOutThenAccepted(mounted, orderId);
      // Another request's instant, set on this case's own harness (created inside the case).
      // eslint-disable-next-line test-flakiness/no-test-isolation
      mounted.patchAcceptance(orderId, { cancellationRequestedAt: new Date(mounted.clock.at.getTime() - 1) });
    });
    const { h } = subject;
    const orderId = await refused(subject);

    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);

    expect(h.acceptance(orderId)).toMatchObject({ status: "ACCEPTED", cancellationStatus: null });
    expect(h.cancellationConfirmed).toEqual([]);
  });

  it("[R1-1] does not confirm a tombstone the marketplace's own cancel already REJECTED: one host callback", async () => {
    const subject = mount(async (mounted, orderId) => {
      await timedOutThenAccepted(mounted, orderId);
      // The marketplace's cancel event lands before the call's answer.
      const event = mounted.engine.normalize(SYNC, { ref: "S-1", kind: "voided" });
      await mounted.engine.deliver({ clientId: TENANT, event: event!, payload: {}, settings: { autoAccept: false, ackSlaSeconds: 300 } });
    });
    const { h } = subject;
    const orderId = await refused(subject);

    await h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);

    expect(h.acceptance(orderId)?.status).toBe("REJECTED");
    expect(h.refused).toEqual([{ orderId, reason: "CANCELLED" }]);
    expect(h.cancellationConfirmed).toEqual([]);
  });

  it("an ASYNCHRONOUS adapter's 2xx never touches a tombstone (its REQUESTED is PENDING-only)", async () => {
    const box: { h?: Harness; orderId?: string } = {};
    const http = scriptedHttp(async (request) => {
      if (request.url.endsWith("/token")) return { status: 200, body: JSON.stringify({ accessToken: "t", expiresIn: 3600 }) };
      if (request.url.endsWith("/requestCancellation") && box.h && box.orderId) {
        await timedOutThenAccepted(box.h, box.orderId);
      }
      return { status: 202, body: "" };
    });
    const h = createHarness({ http, cancellationHooks: true, cancellationWindowMs: WINDOW_MS });
    box.h = h;
    await h.connect();
    const outcome = await deliverIfood(h, ifoodPlaced("ext-1"));
    if (outcome.kind !== "ingested") throw new Error(outcome.kind);
    box.orderId = outcome.orderId;
    await h.engine.decide({ clientId: TENANT, orderId: outcome.orderId, decision: "REJECT", reasonCode: "503" });

    await h.engine.runOutbound({ clientId: TENANT, orderId: outcome.orderId, action: "requestCancellation" }, ATTEMPT);

    expect(h.acceptance(outcome.orderId)).toMatchObject({ status: "ACCEPTED", cancellationStatus: null });
    expect(h.cancellationConfirmed).toEqual([]);
  });
});

const MIGRATIONS = new URL("../../prisma/migrations/", import.meta.url);

describe("the tombstone on real Postgres", () => {
  it("[R3-N2] matches the TIMESTAMP(3) instant the job read, meeting every CHECK", async () => {
    const pg = new PGlite();
    for (const dir of readdirSync(MIGRATIONS).sort()) {
      await pg.exec(readFileSync(new URL(`${dir}/migration.sql`, MIGRATIONS), "utf8"));
    }
    const subject = mount(timedOutThenAccepted, { store: pgliteDb(pg) });
    const orderId = await refused(subject);

    await subject.h.engine.runOutbound({ clientId: TENANT, orderId, action: "requestCancellation" }, ATTEMPT);

    const row = await pg.query<Record<string, unknown>>(
      "SELECT status, cancellation_status, cancellation_requested_at FROM marketplace_acceptances WHERE order_id = $1",
      [orderId],
    );
    expect(row.rows[0]).toMatchObject({ status: "REJECTED", cancellation_status: "CONFIRMED" });
    expect(subject.h.cancellationConfirmed).toEqual([orderId]);
  });
});
