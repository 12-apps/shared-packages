import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createIfoodAdapter } from "..";
import { IFOOD_ADAPTER_COPY_PT_BR } from "../pt-BR";
import { IFOOD_ADAPTER_COPY_EN_US } from "../en-US";
import { normalizeIfoodEvent as normalizeWith, verifyIfoodSignature } from "../normalize";

/** The adapter's normalizer with the pt-BR pack's missing-number words. */
const normalizeIfoodEvent = (payload: unknown) =>
  normalizeWith(payload, { missingStreetNumber: IFOOD_ADAPTER_COPY_PT_BR.missingStreetNumber });

/**
 * The adapter is where an incoming order is most likely to be silently
 * mis-read, so these cases are mostly about what happens to a PAYLOAD THAT IS
 * NOT QUITE RIGHT — a missing field, a price as a string, an item with no SKU.
 * Every one of them is an order somebody paid for.
 */

const SECRET = "shh";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

describe("verifyIfoodSignature", () => {
  it("accepts a correctly signed body", () => {
    const body = '{"orderId":"1"}';
    expect(verifyIfoodSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("accepts the `sha256=` prefixed form providers commonly send", () => {
    const body = '{"orderId":"1"}';
    expect(verifyIfoodSignature(body, `sha256=${sign(body)}`, SECRET)).toBe(true);
  });

  it("refuses a body that changed after signing", () => {
    const signature = sign('{"orderId":"1"}');
    expect(verifyIfoodSignature('{"orderId":"2"}', signature, SECRET)).toBe(false);
  });

  it("refuses an unsigned delivery once a secret is configured", () => {
    expect(verifyIfoodSignature('{"orderId":"1"}', null, SECRET)).toBe(false);
  });

  it("accepts an unsigned delivery while no secret is configured", () => {
    // A merchant mid-homologation has no secret for weeks. Refusing here would
    // make the connection untestable during exactly the period it is being set
    // up; the half-configured state is shown on the integration screen instead.
    expect(verifyIfoodSignature('{"orderId":"1"}', null, null)).toBe(true);
  });

  it("refuses a signature of the wrong length without comparing it", () => {
    expect(verifyIfoodSignature('{"orderId":"1"}', "abc", SECRET)).toBe(false);
  });
});

describe("normalizeIfoodEvent", () => {
  const placed = {
    id: "evt-1",
    code: "PLC",
    merchantId: "merch-1",
    orderId: "ord-1",
    order: {
      displayId: "4821",
      createdAt: "2026-08-12T10:00:00.000Z",
      customer: { id: "cust-9", name: "Ana", phone: { number: "11999999999" } },
      items: [
        { externalCode: "SKU-1", name: "X-Salada", quantity: 2, unitPrice: 19.9 },
        { externalCode: "SKU-2", name: "Coca 350ml", quantity: 1, unitPrice: 6.5 },
      ],
      total: { orderAmount: 46.3, commission: 5.55 },
      delivery: { deliveryDateTime: "2026-08-12T10:40:00.000Z" },
    },
  };

  /** The same order as iFood sends it when the contract states no totals. */
  function withoutTotal(): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...placed.order };
    delete copy.total;
    return copy;
  }

  it("normalizes a placed order into the canonical shape", () => {
    const event = normalizeIfoodEvent(placed);

    expect(event).not.toBeNull();
    expect(event?.provider).toBe("IFOOD");
    expect(event?.externalOrderId).toBe("ord-1");
    expect(event?.externalMerchantId).toBe("merch-1");
    expect(event?.order?.externalDisplayId).toBe("4821");
    expect(event?.order?.buyer).toEqual({
      externalId: "cust-9",
      name: "Ana",
      phone: "11999999999",
    });
    expect(event?.order?.lines).toHaveLength(2);
    expect(event?.order?.deliveryDueAt?.toISOString()).toBe("2026-08-12T10:40:00.000Z");
  });

  it("converts decimal reais to cents by ROUNDING, not truncating", () => {
    // 19.9 * 100 is 1989.9999… in IEEE-754, so truncation would bill 19.89 —
    // a cent lost per line, on every order, always the store's way.
    const event = normalizeIfoodEvent(placed);

    expect(event?.order?.lines[0]?.unitPriceCents).toBe(1990);
    expect(event?.order?.totalCents).toBe(4630);
    expect(event?.order?.commissionCents).toBe(555);
  });

  it("prefers iFood's stated total over the sum of the lines", () => {
    // The two disagree on real orders — delivery fees and iFood's own
    // promotions live in the total and not in the lines — and the number that
    // has to match the buyer's receipt is iFood's.
    const event = normalizeIfoodEvent({
      ...placed,
      order: { ...placed.order, total: { orderAmount: 51.3 } },
    });

    expect(event?.order?.totalCents).toBe(5130);
    expect(event?.order?.commissionCents).toBeNull();
  });

  it("falls back to the line sum only when iFood states no total", () => {
    const event = normalizeIfoodEvent({ ...placed, order: withoutTotal() });

    expect(event?.order?.totalCents).toBe(1990 * 2 + 650);
  });

  it("distinguishes 'iFood took nothing' from 'iFood did not say'", () => {
    const event = normalizeIfoodEvent({ ...placed, order: withoutTotal() });

    // NULL, never 0: only one of these two claims is safe to put in a margin
    // report, and a fabricated zero is indistinguishable from a real one.
    expect(event?.order?.commissionCents).toBeNull();
  });

  it("keeps a line whose SKU is missing rather than dropping the food", () => {
    const event = normalizeIfoodEvent({
      ...placed,
      order: { ...placed.order, items: [{ name: "Item sem código", quantity: 1, price: 10 }] },
    });

    // An unmapped line is recoverable; a dropped line is not, because nothing
    // downstream can tell that food is missing from the ticket.
    expect(event?.order?.lines[0]?.externalSku).toBe("Item sem código");
    expect(event?.order?.lines[0]?.unitPriceCents).toBe(1000);
  });

  it("recognizes a cancellation and carries no order body", () => {
    const event = normalizeIfoodEvent({ id: "evt-2", code: "CAN", orderId: "ord-1" });

    expect(event?.cancelled).toBe(true);
    expect(event?.order).toBeNull();
  });

  it("carries no order body for an event type this ingestion does not act on", () => {
    const event = normalizeIfoodEvent({ id: "evt-3", code: "DSP", orderId: "ord-1" });

    expect(event?.order).toBeNull();
    expect(event?.cancelled).toBe(false);
  });

  it("refuses only a payload with no order id at all", () => {
    expect(normalizeIfoodEvent({ code: "PLC" })).toBeNull();
  });

  it("derives a STABLE event id when iFood sends none, so a redelivery still dedups", () => {
    const first = normalizeIfoodEvent({ code: "PLC", orderId: "ord-1" });
    const second = normalizeIfoodEvent({ code: "PLC", orderId: "ord-1" });

    expect(first?.eventId).toBe("ord-1:PLC");
    expect(second?.eventId).toBe(first?.eventId);
  });

  it("survives a payload with an items field that is not an array", () => {
    const event = normalizeIfoodEvent({ code: "PLC", orderId: "ord-1", order: { items: null } });

    // No throw, no order — the delivery is recorded and a human can look at the
    // stored payload. A TypeError here would 500 the webhook and provoke iFood
    // into redelivering the same unreadable body.
    expect(event?.order).toBeNull();
  });
});

/**
 * How the order reaches the buyer  and where it goes : the
 * three payloads the triage posted, one per case.
 */
describe("normalizeIfoodEvent — order type, who delivers, the address", () => {
  function placedWith(order: Record<string, unknown>): unknown {
    return {
      id: "evt-type",
      code: "PLC",
      merchantId: "merch-1",
      orderId: "ord-type",
      order: {
        displayId: "7001",
        createdAt: "2026-11-03T06:13:00.000Z",
        items: [{ externalCode: "SKU-1", name: "Repro", quantity: 1, unitPrice: 10 }],
        total: { orderAmount: 10 },
        ...order,
      },
    };
  }

  it("reads a take-out as TAKEOUT with no deliverer and no address", () => {
    const event = normalizeIfoodEvent(placedWith({ orderType: "TAKEOUT", takeout: { mode: "DEFAULT" } }));
    expect(event?.order).toMatchObject({ orderType: "TAKEOUT", deliveredBy: null, deliveryAddress: null });
  });

  it("reads a delivery iFood's own fleet carries", () => {
    const event = normalizeIfoodEvent(
      placedWith({ orderType: "DELIVERY", delivery: { deliveredBy: "IFOOD", deliveryAddress: { streetName: "Rua Frota", streetNumber: "9", neighborhood: "Centro" } } }),
    );
    expect(event?.order).toMatchObject({ orderType: "DELIVERY", deliveredBy: "MARKETPLACE" });
  });

  it("reads the store's own delivery with its address, reference included", () => {
    const event = normalizeIfoodEvent(
      placedWith({
        orderType: "DELIVERY",
        delivery: {
          deliveredBy: "MERCHANT",
          deliveryAddress: { streetName: "Rua iFood", streetNumber: "11", neighborhood: "Centro", city: "São Paulo", postalCode: "01310-100", reference: "ao lado da praça" },
        },
      }),
    );
    expect(event?.order).toMatchObject({
      orderType: "DELIVERY",
      deliveredBy: "MERCHANT",
      deliveryAddress: {
        street: "Rua iFood",
        number: "11",
        neighborhood: "Centro",
        complement: null,
        reference: "ao lado da praça",
        postalCode: "01310100",
        city: "São Paulo",
        state: null,
      },
    });
  });

  it("reads nothing it was not told: no type, no deliverer, no street is no address", () => {
    const event = normalizeIfoodEvent(placedWith({ delivery: { deliveryAddress: { neighborhood: "Centro" } } }));
    expect(event?.order).toMatchObject({ orderType: null, deliveredBy: null, deliveryAddress: null });
  });

  it("keeps the door of an address with no number, in the host's words for it", () => {
    const event = normalizeIfoodEvent(
      placedWith({ delivery: { deliveredBy: "MERCHANT", deliveryAddress: { streetName: "Rua sem número", neighborhood: "Centro", reference: "portão azul" } } }),
    );
    expect(event?.order?.deliveryAddress).toMatchObject({ street: "Rua sem número", number: "s/n", neighborhood: "Centro", reference: "portão azul" });
  });
});


/** A fresh adapter per case, with the en-US pack. */
const anAdapter = () => createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US });

describe("the iFood adapter", () => {
  it("[P1] states its capabilities as booleans and links to an https page", () => {
    const adapter = anAdapter();
    expect(adapter.provider).toBe("IFOOD");
    expect(adapter.capabilities).toEqual({
      apiConfirm: true,
      apiCancel: true,
      cancelAfterAccept: true,
      asyncCancellationOutcome: true,
      perOrderAppLink: false,
      confirmTakesPreparationTime: false,
    });
    expect(adapter.appLink({ externalOrderId: "ord-1", externalDisplayId: "4821" })).toMatch(/^https:\/\//);
  });

  it("serves iFood's twelve reasons, offline, labelled from the host's pack, with 503 as item-unavailable", () => {
    const adapter = anAdapter();
    const reasons = adapter.cancellationReasons();
    expect(reasons.map((reason) => reason.code)).toEqual([
      "501", "502", "503", "504", "505", "506", "507", "508", "509", "511", "512", "513",
    ]);
    expect(reasons.filter((reason) => reason.itemUnavailable).map((reason) => reason.code)).toEqual(["503"]);
    expect(reasons[2]?.label).toBe(IFOOD_ADAPTER_COPY_EN_US.reasonLabels["503"]);
    const ptBr = createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_PT_BR }).cancellationReasons();
    expect(ptBr[2]?.label).toBe(IFOOD_ADAPTER_COPY_PT_BR.reasonLabels["503"]);
  });

  it("reads its signature from x-ifood-signature, then x-signature", () => {
    const adapter = anAdapter();
    const headers: Record<string, string> = { "x-signature": "b" };
    expect(adapter.readSignature((name) => headers[name] ?? null)).toBe("b");
    headers["x-ifood-signature"] = "a";
    expect(adapter.readSignature((name) => headers[name] ?? null)).toBe("a");
  });

  it("maps CANCELLATION_REQUEST_FAILED (and its short code) to a FAILED outcome, CANCELLED to CONFIRMED", () => {
    const adapter = anAdapter();
    expect(adapter.normalize({ code: "CARF", orderId: "o" })?.cancellationOutcome).toBe("FAILED");
    expect(adapter.normalize({ fullCode: "CANCELLATION_REQUEST_FAILED", orderId: "o" })?.cancellationOutcome).toBe(
      "FAILED",
    );
    expect(adapter.normalize({ code: "CAN", orderId: "o" })?.cancellationOutcome).toBe("CONFIRMED");
    expect(adapter.normalize({ code: "PLC", orderId: "o" })?.cancellationOutcome).toBeNull();
  });
});
