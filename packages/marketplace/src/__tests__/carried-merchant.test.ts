import { describe, expect, it, vi } from "vitest";

import type { MarketplaceAdapter } from "../core/adapter";
import type { NormalizedEvent } from "../core/types";
import { createIfoodAdapter } from "../ifood";
import { IFOOD_ADAPTER_COPY_EN_US } from "../ifood/en-US";
import { TENANT, createHarness, ifoodPlaced, type Harness } from "./harness";

/**
 * The merchant check on an order the EVENT CARRIES (FUT-4765), at the engine:
 * the rule a fetched order was already held to. An order naming another
 * merchant than the connection's is settled FAILED for the reconciliation
 * sweep; an order naming none is not judged and costs no read; a connection
 * that states no merchant judges nothing. The read is the one column: no
 * credentials are opened per order. Driven through a fake adapter.
 */

const CARRY = "CARRY_EATS";

function carryEvent(payload: unknown): NormalizedEvent | null {
  const body = payload as { ref?: string; merchant?: string | null };
  if (!body.ref) return null;
  return {
    provider: CARRY,
    eventId: `${body.ref}:new`,
    eventType: "new",
    externalMerchantId: body.merchant ?? null,
    externalOrderId: body.ref,
    order: {
      provider: CARRY,
      externalOrderId: body.ref,
      externalDisplayId: null,
      ...(body.merchant === undefined ? {} : { externalMerchantId: body.merchant }),
      buyer: { externalId: null, name: null, phone: null },
      lines: [{ externalSku: "X", name: "X", quantity: 1, unitPriceCents: 900, note: null }],
      totalCents: 900,
      commissionCents: null,
      deliveryDueAt: null,
      placedAt: new Date("2026-11-11T11:00:00.000Z"),
    },
    cancelled: false,
  };
}

const carryAdapter: MarketplaceAdapter = {
  provider: CARRY,
  capabilities: {
    apiConfirm: false,
    apiCancel: false,
    cancelAfterAccept: false,
    asyncCancellationOutcome: false,
    perOrderAppLink: false,
    confirmTakesPreparationTime: false,
  },
  normalize: carryEvent,
  readSignature: () => null,
  verifySignature: () => true,
  cancellationReasons: () => [],
  confirm: async () => ({ kind: "accepted" }),
  requestCancellation: async () => ({ kind: "accepted" }),
  appLink: () => "https://carry.test/portal",
};

async function mounted(merchant: string | null = "store-1"): Promise<Harness> {
  const subject = createHarness({ adapters: [createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US }), carryAdapter] });
  await subject.connect(CARRY);
  subject.patchIntegration({ externalMerchantId: merchant });
  return subject;
}

function deliver(subject: Harness, payload: { ref: string; merchant?: string | null }) {
  const event = subject.engine.normalize(CARRY, payload);
  return subject.engine.deliver({ clientId: TENANT, event: event!, payload, settings: { autoAccept: false, ackSlaSeconds: 300 } });
}

describe("the merchant check on a carried order", () => {
  it("settles an order naming another merchant FAILED, ingests nothing, and logs it", async () => {
    const h = await mounted();

    const outcome = await deliver(h, { ref: "C-1", merchant: "store-2" });

    expect(outcome).toMatchObject({ kind: "failed", reason: /names merchant store-2/ });
    expect(h.created).toEqual([]);
    expect(h.memory.tables.marketplaceInboxEvent.rows[0]).toMatchObject({ status: "FAILED", error: /names merchant store-2/ });
    expect(h.logged.some((line) => line.level === "error" && /names merchant store-2/.test(line.message))).toBe(true);
  });

  it("ingests an order naming the connection's merchant, reading one column and opening no credentials", async () => {
    const h = await mounted();
    // Credentials that would throw if opened: the check must not open them.
    h.patchIntegration({ credentials: "not-sealed" });

    expect(await deliver(h, { ref: "C-1", merchant: "store-1" })).toMatchObject({ kind: "ingested" });
  });

  it("does not read the connection for an order that names no merchant", async () => {
    const h = await mounted();
    const reads = vi.spyOn(h.memory.tables.marketplaceIntegration, "findUnique");

    expect(await deliver(h, { ref: "C-1" })).toMatchObject({ kind: "ingested" });
    expect(reads).not.toHaveBeenCalled();
  });

  it("ingests whatever merchant the order names when the connection states none", async () => {
    const h = await mounted(null);

    expect(await deliver(h, { ref: "C-1", merchant: "store-9" })).toMatchObject({ kind: "ingested" });
  });

  it("leaves iFood as it was: its orders name no merchant, so no read and no judgement", async () => {
    const h = createHarness();
    await h.connect();
    h.patchIntegration({ externalMerchantId: "someone-else" });
    const payload = ifoodPlaced("ext-1");
    const event = h.engine.normalize("IFOOD", payload);
    const reads = vi.spyOn(h.memory.tables.marketplaceIntegration, "findUnique");

    const outcome = await h.engine.deliver({ clientId: TENANT, event: event!, payload, settings: { autoAccept: false, ackSlaSeconds: 300 } });

    expect(outcome).toMatchObject({ kind: "ingested" });
    expect(reads).not.toHaveBeenCalled();
  });
});
