import { describe, expect, it } from "vitest";

import type { MarketplaceAdapter } from "../core/adapter";
import type { CatalogueReader, CatalogueReadContext } from "../core/catalogue-read-port";
import { centsFromMajor } from "../core/catalogue-read-port";
import { TENANT, createHarness, scriptedHttp } from "./harness";

/**
 * Reading a store's menu off a marketplace (FUT-951), through the engine with a
 * FAKE marketplace and nothing in the engine naming it: the engine resolves the
 * store's own connection (merchant id, opened credentials) and hands it to the
 * adapter's `catalogueReader`. A marketplace with no reader is UNSUPPORTED.
 */

const READY = "READY";
const BARE = "BARE";

function fakeAdapter(provider: string, catalogueReader?: CatalogueReader): MarketplaceAdapter {
  return {
    provider,
    capabilities: {
      apiConfirm: false,
      apiCancel: false,
      cancelAfterAccept: false,
      asyncCancellationOutcome: false,
      perOrderAppLink: false,
      confirmTakesPreparationTime: false,
    },
    normalize: () => null,
    readSignature: () => null,
    verifySignature: () => false,
    cancellationReasons: () => [],
    confirm: async () => ({ kind: "accepted" }),
    requestCancellation: async () => ({ kind: "accepted" }),
    ...(catalogueReader ? { catalogueReader } : {}),
    appLink: () => "https://portal.test/",
  };
}

function mount(read: CatalogueReader["read"]) {
  const seen: CatalogueReadContext[] = [];
  const reader: CatalogueReader = {
    read: async (ctx) => {
      seen.push(ctx);
      return read(ctx);
    },
  };
  const h = createHarness({ http: scriptedHttp([{ status: 200, body: "{}" }]), adapters: [fakeAdapter(READY, reader), fakeAdapter(BARE)] });
  return { h, seen };
}

const SNAPSHOT = { kind: "snapshot" as const, snapshot: { categories: [], notices: [] } };

describe("reading a marketplace's catalogue", () => {
  it("hands the adapter the store's own connection: merchant id, opened credentials, environment, the host's HTTP client", async () => {
    const { h, seen } = mount(async () => SNAPSHOT);
    await h.connect(READY);

    const result = await h.engine.readCatalogue({ clientId: TENANT, provider: READY });

    expect(result).toEqual(SNAPSHOT);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      externalMerchantId: "merchant-READY",
      credentials: { clientId: "app-id", clientSecret: "app-secret" },
      environment: "SANDBOX",
    });
  });

  it("passes the adapter's refusal and retry through as they are", async () => {
    const refusal = { kind: "refused" as const, code: "NOT_AUTHORIZED" as const, status: 403, message: "no" };
    const refused = mount(async () => refusal);
    await refused.h.connect(READY);
    expect(await refused.h.engine.readCatalogue({ clientId: TENANT, provider: READY })).toEqual(refusal);

    const later = mount(async () => ({ kind: "retry", reason: "status 429: slow down" }));
    await later.h.connect(READY);
    expect(await later.h.engine.readCatalogue({ clientId: TENANT, provider: READY })).toEqual({ kind: "retry", reason: "status 429: slow down" });
  });

  it("an adapter that throws is a retry, not a crash", async () => {
    const { h } = mount(async () => {
      throw new Error("boom");
    });
    await h.connect(READY);

    expect(await h.engine.readCatalogue({ clientId: TENANT, provider: READY })).toEqual({ kind: "retry", reason: "boom" });
  });

  it("refuses before any call: no reader, no connection, an archived one, credentials that do not open", async () => {
    const engineRefusal = (code: string) => ({ kind: "refused", code, status: null, message: null });
    const { h, seen } = mount(async () => SNAPSHOT);
    await h.connect(BARE);

    expect(await h.engine.readCatalogue({ clientId: TENANT, provider: BARE })).toEqual(engineRefusal("UNSUPPORTED"));
    expect(await h.engine.readCatalogue({ clientId: TENANT, provider: "NOBODY" })).toEqual(engineRefusal("UNSUPPORTED"));
    expect(await h.engine.readCatalogue({ clientId: TENANT, provider: READY })).toEqual(engineRefusal("NOT_CONNECTED"));

    await h.connect(READY);
    h.patchIntegration({ credentials: "garbage" });
    expect(await h.engine.readCatalogue({ clientId: TENANT, provider: READY })).toEqual(engineRefusal("CREDENTIALS"));
    h.patchIntegration({ credentials: "" });
    expect(await h.engine.readCatalogue({ clientId: TENANT, provider: READY })).toEqual(engineRefusal("CREDENTIALS"));
    h.patchIntegration({ archivedAt: new Date("2026-11-10T00:00:00.000Z") });
    expect(await h.engine.readCatalogue({ clientId: TENANT, provider: READY })).toEqual(engineRefusal("NOT_CONNECTED"));

    expect(seen).toEqual([]);
    expect(h.http.requests).toEqual([]);
  });
});

describe("centsFromMajor", () => {
  it.each([
    [25.9, 2590],
    [0, 0],
    [1.005, 101],
    [0.125, 13],
    [19.99, 1999],
    [1234.5, 123450],
  ])("%s in the major unit is %i cents, rounded half up", (value, cents) => {
    expect(centsFromMajor(value)).toBe(cents);
  });

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY], ["10"], [null], [undefined]])("%s is no price", (value) => {
    expect(centsFromMajor(value)).toBeNull();
  });
});
