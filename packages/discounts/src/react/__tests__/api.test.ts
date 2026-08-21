import { describe, expect, it } from "vitest";

import { createDiscountsApiClient, toWriteBody, type DiscountFormPayload } from "../api";
import { createFormatters } from "../format";
import type { DiscountsTransport } from "../transport";

/**
 * The FORM's shape becoming the API's — the one coercion in this surface that
 * has a rule worth stating, and the one whose mistakes are silent.
 *
 * A blank field means "no value" (`null`), never zero, because `0` is a real
 * and DIFFERENT answer for a limit or a minimum: a blank cap means anyone may
 * redeem it and a zero cap means nobody may. Folding the two is the most
 * expensive thing this file could get wrong, and nothing about it looks wrong.
 */

const formatters = createFormatters("pt-BR", "BRL");

function payload(overrides: Partial<DiscountFormPayload> = {}): DiscountFormPayload {
  return {
    name: "  Dez por cento  ",
    type: "PERCENTAGE",
    percentOff: "12,5",
    amountOff: "",
    bundlePrice: "",
    freeUnits: "",
    maxComboApplications: "",
    scope: "ORDER",
    trigger: "AUTOMATIC",
    code: "",
    startsAt: "",
    endsAt: "",
    minSubtotal: "",
    usageLimit: "",
    perBuyerLimit: "",
    stackable: true,
    active: true,
    categoryIds: [],
    menuItemIds: [],
    comboRequirements: [],
    ...overrides,
  };
}

const body = (overrides: Partial<DiscountFormPayload> = {}) =>
  toWriteBody(payload(overrides), formatters);

describe("blank is null, and null is not zero", () => {
  it("A1: sends null for every cap and minimum left blank", () => {
    expect(body()).toMatchObject({
      minSubtotalCents: null,
      usageLimit: null,
      perBuyerLimit: null,
      startsAt: null,
      endsAt: null,
    });
  });

  it("A2: still sends a real zero the operator actually typed", () => {
    // Not the same answer, and the surface must not decide it is.
    expect(body({ usageLimit: "0" }).usageLimit).toBe(0);
  });
});

describe("the units the columns store", () => {
  it("A3: turns a typed percentage into basis points, exactly", () => {
    // The `Math.round` after the ×100 is what keeps "12,5" exactly 1250 rather
    // than 1249.9999999999998.
    expect(body().percentOffBp).toBe(1_250);
  });

  it("A4: turns a money amount into integer cents", () => {
    expect(body({ type: "FIXED_AMOUNT", amountOff: "19,90" }).amountOffCents).toBe(1_990);
  });

  it("A5: truncates a cap rather than sending a fraction", () => {
    expect(body({ usageLimit: "10,7" }).usageLimit).toBe(10);
  });

  it("A6: trims the name, so a stray space is not part of the identity", () => {
    expect(body().name).toBe("Dez por cento");
  });
});

describe("only the branch that applies is sent", () => {
  it("A7: nulls the value column the chosen type does not use", () => {
    expect(body()).toMatchObject({ percentOffBp: 1_250, amountOffCents: null });
    expect(body({ type: "FIXED_AMOUNT", amountOff: "5,00" })).toMatchObject({
      percentOffBp: null,
      amountOffCents: 500,
    });
  });

  it("A8: drops a coupon left behind by the other trigger", () => {
    expect(body({ trigger: "AUTOMATIC", code: "LEFTOVER" }).code).toBeNull();
    expect(body({ trigger: "CODE", code: " BEMVINDO10 " }).code).toBe("BEMVINDO10");
  });

  it("A9: narrows the target lists to the scope on the way OUT too", () => {
    // Leaving a stale id list on a rule whose scope changed is how a promotion
    // goes on covering something its own screen no longer shows.
    const ids = { categoryIds: ["c1"], menuItemIds: ["m1"] };
    expect(body({ scope: "ORDER", ...ids })).toMatchObject({ categoryIds: [], menuItemIds: [] });
    expect(body({ scope: "CATEGORY", ...ids })).toMatchObject({
      categoryIds: ["c1"],
      menuItemIds: [],
    });
    expect(body({ scope: "ITEM", ...ids })).toMatchObject({
      categoryIds: [],
      menuItemIds: ["m1"],
    });
  });
});

/** A transport that records the calls, so the paths are the subject. */
function recordingTransport(): { calls: string[]; transport: DiscountsTransport } {
  const calls: string[] = [];
  return {
    calls,
    transport: {
      get: <T,>(path: string): Promise<T> => {
        calls.push(`GET ${path}`);
        return Promise.resolve({ data: [] } as T);
      },
      send: (path, method) => {
        calls.push(`${method} ${path}`);
        return Promise.resolve({ ok: true, data: null as never });
      },
    },
  };
}

describe("where the client calls", () => {
  it("A10: builds every path off the ONE mount the host named", async () => {
    const { calls, transport } = recordingTransport();
    const api = createDiscountsApiClient("/api/admin/minha-loja", transport, formatters);
    await api.list("q=x");
    await api.targets();
    await api.create(payload());
    await api.update("d 1", payload());
    await api.remove("d 1");
    expect(calls).toEqual([
      "GET /api/admin/minha-loja/discounts?q=x",
      "GET /api/admin/minha-loja/discounts/targets",
      "POST /api/admin/minha-loja/discounts",
      // Encoded: an id is opaque, and one carrying a space or a slash would
      // otherwise address a different endpoint entirely.
      "PATCH /api/admin/minha-loja/discounts/d%201",
      "DELETE /api/admin/minha-loja/discounts/d%201",
    ]);
  });

  it("A11: omits the query string entirely when there is no query", async () => {
    const { calls, transport } = recordingTransport();
    await createDiscountsApiClient("/api/admin/loja", transport, formatters).list("");
    expect(calls).toEqual(["GET /api/admin/loja/discounts"]);
  });

  it("A12: unwraps the targets envelope, so a screen reads the collections", async () => {
    const transport: DiscountsTransport = {
      get: <T,>(): Promise<T> => Promise.resolve({ data: [{ targetType: "ITEM" }] } as T),
      send: () => Promise.resolve({ ok: true, data: null as never }),
    };
    const groups = await createDiscountsApiClient("/api", transport, formatters).targets();
    expect(groups).toEqual([{ targetType: "ITEM" }]);
  });

  it("A13: returns the PAGE as-is, because the page IS the envelope", async () => {
    // `{ data, pagination }` is the whole payload, not a `data` to unwrap; a
    // client that unwrapped it would hand the grid its rows with no pagination.
    const page = { data: [], pagination: { page: 1 } };
    const transport: DiscountsTransport = {
      get: <T,>(): Promise<T> => Promise.resolve(page as T),
      send: () => Promise.resolve({ ok: true, data: null as never }),
    };
    expect(await createDiscountsApiClient("/api", transport, formatters).list("")).toBe(page);
  });
});
