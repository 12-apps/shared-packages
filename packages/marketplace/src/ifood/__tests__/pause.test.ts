import { describe, expect, it } from "vitest";

import type { AdapterCallContext, MarketplaceHttpRequest, MarketplaceHttpResponse } from "../../core/adapter";
import { createNinetyNineFoodAdapter } from "../../99food";
import { NINETY_NINE_FOOD_ADAPTER_COPY_EN_US } from "../../99food/en-US";
import { API_BASE as OD_BASE, PORTAL as OD_PORTAL } from "../../99food/__tests__/fixtures";
import { createRappiAdapter } from "../../rappi";
import { RAPPI_ADAPTER_COPY_EN_US } from "../../rappi/en-US";
import { API_BASE as RAPPI_BASE, PORTAL as RAPPI_PORTAL, TOKEN_URL as RAPPI_TOKEN } from "../../rappi/__tests__/fixtures";
import { createIfoodAdapter, ifoodLocalTime } from "..";
import { IFOOD_ADAPTER_COPY_EN_US } from "../en-US";

/**
 * Each adapter's half of the store pause (FUT-4851), read off the requests it
 * sends a fake HTTP client: iFood's interruptions (list, create, delete), and
 * the two switches, Rappi's store availability and Open Delivery's merchant
 * status, offered only when the host opts in.
 */

const INTERRUPTIONS = "https://merchant-api.ifood.com.br/merchant/v1.0/merchants/merchant-1/interruptions";
const NOW = new Date("2026-11-13T15:00:00.000Z");
const UNTIL = new Date("2026-11-13T15:25:00.000Z");

function context(answer: (request: MarketplaceHttpRequest) => MarketplaceHttpResponse) {
  const sent: MarketplaceHttpRequest[] = [];
  const ctx: AdapterCallContext = {
    http: async (request) => {
      sent.push(request);
      if (/oauth\/token|token\/login|\/oauth\/token$/u.test(request.url)) {
        return { status: 200, body: JSON.stringify({ accessToken: "tok", access_token: "tok", expiresIn: 3600 }) };
      }
      return answer(request);
    },
    credentials: { clientId: "app", clientSecret: "secret", webhookSecret: null },
    environment: "SANDBOX",
    tokens: new Map(),
    now: NOW,
  };
  return { ctx, sent: () => sent.filter((request) => !/token/u.test(request.url)) };
}

const ifood = createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US });
const request = { merchantId: "merchant-1", until: UNTIL, reason: "Cozinha cheia", key: "key-1", timeZone: "America/Sao_Paulo" };

describe("iFood: interruptions", () => {
  it("states the capability as an interruption with no extend", () => {
    expect(ifood.availability?.kind).toBe("interruption");
    expect(ifood.availability?.extend).toBeUndefined();
  });

  it("writes times as the store's wall clock with its offset", () => {
    expect(ifoodLocalTime(UNTIL, "America/Sao_Paulo")).toBe("2026-11-13T12:25:00-03:00");
    expect(ifoodLocalTime(UNTIL, "UTC")).toBe("2026-11-13T15:25:00+00:00");
  });

  it("lists first, then creates one with the key as its id, the reason, and the store's start and end", async () => {
    const { ctx, sent } = context((req) =>
      req.method === "GET" ? { status: 200, body: "[]" } : { status: 201, body: JSON.stringify({ id: "key-1" }) },
    );
    expect(await ifood.availability!.pause(ctx, request)).toEqual({ kind: "paused", externalId: "key-1", until: UNTIL });
    const [list, create] = sent();
    expect(list).toMatchObject({ method: "GET", url: INTERRUPTIONS, headers: { Authorization: "Bearer tok" } });
    expect(create).toMatchObject({ method: "POST", url: INTERRUPTIONS });
    expect(JSON.parse(create!.body!)).toEqual({
      id: "key-1",
      description: "Cozinha cheia",
      start: "2026-11-13T12:00:00-03:00",
      end: "2026-11-13T12:25:00-03:00",
    });
  });

  it("creates nothing when an interruption under the key already stands (a lost answer)", async () => {
    const { ctx, sent } = context(() => ({ status: 200, body: JSON.stringify([{ id: "by-hand" }, { id: "key-1" }]) }));
    expect(await ifood.availability!.pause(ctx, request)).toEqual({ kind: "paused", externalId: "key-1", until: UNTIL });
    expect(sent().map((req) => req.method)).toEqual(["GET"]);
  });

  it("reads a 4xx as a refusal and a 5xx or a timeout as a retry", async () => {
    const refused = context((req) => (req.method === "GET" ? { status: 200, body: "[]" } : { status: 400, body: "overlap" }));
    expect(await ifood.availability!.pause(refused.ctx, request)).toEqual({ kind: "refused", status: 400, message: "overlap" });
    const down = context(() => ({ status: 503, body: "down" }));
    expect(await ifood.availability!.pause(down.ctx, request)).toMatchObject({ kind: "retry" });
    const lost = context(() => {
      throw new Error("socket hang up");
    });
    expect(await ifood.availability!.pause(lost.ctx, request)).toEqual({ kind: "retry", reason: "socket hang up" });
  });

  it("deletes exactly its own interruption, and a 404 is already gone", async () => {
    const { ctx, sent } = context(() => ({ status: 204, body: "" }));
    expect(await ifood.availability!.resume(ctx, { merchantId: "merchant-1", externalId: "key-1", key: null, sent: null })).toEqual({ kind: "accepted" });
    expect(sent()).toEqual([expect.objectContaining({ method: "DELETE", url: `${INTERRUPTIONS}/key-1` })]);
    const gone = context(() => ({ status: 404, body: "" }));
    expect(await ifood.availability!.resume(gone.ctx, { merchantId: "merchant-1", externalId: "key-1", key: null, sent: null })).toEqual({ kind: "accepted" });
  });

  it("finds an interruption a lost answer created by its key, and deletes nothing when none stands", async () => {
    const found = context((req) => (req.method === "GET" ? { status: 200, body: JSON.stringify([{ id: "key-1" }]) } : { status: 204, body: "" }));
    expect(await ifood.availability!.resume(found.ctx, { merchantId: "merchant-1", externalId: null, key: "key-1", sent: null })).toEqual({ kind: "accepted" });
    expect(found.sent().map((req) => `${req.method} ${req.url}`)).toEqual([`GET ${INTERRUPTIONS}`, `DELETE ${INTERRUPTIONS}/key-1`]);

    const none = context(() => ({ status: 200, body: JSON.stringify([{ id: "by-hand" }]) }));
    expect(await ifood.availability!.resume(none.ctx, { merchantId: "merchant-1", externalId: null, key: "key-1", sent: null })).toEqual({ kind: "accepted" });
    expect(none.sent().map((req) => req.method)).toEqual(["GET"]);
  });
});

describe("iFood assigning its own ids (B1): a lost create answer never makes a second interruption", () => {
  /** iFood as a store of interruptions that names each one itself and drops the first create's answer. */
  function ifoodAssigningIds() {
    const stored = new Map<string, { description: string; start: string; end: string }>();
    const state = { next: 0, loseNext: true };
    const { ctx, sent } = context((req) => {
      if (req.method === "GET") {
        return { status: 200, body: JSON.stringify([...stored].map(([id, body]) => ({ id, ...body }))) };
      }
      if (req.method === "POST") {
        state.next += 1;
        const id = `ifood-${state.next}`;
        const body = JSON.parse(req.body!) as { description: string; start: string; end: string };
        stored.set(id, { description: body.description, start: body.start, end: body.end });
        if (state.loseNext) {
          state.loseNext = false;
          throw new Error("socket hang up");
        }
        return { status: 201, body: JSON.stringify({ id }) };
      }
      const id = decodeURIComponent(req.url.split("/").pop()!);
      return { status: stored.delete(id) ? 204 : 404, body: "" };
    });
    return { ctx, sent, stored };
  }

  it("finds the interruption the lost answer created by its end and description, and creates no second one", async () => {
    const ifoodSide = ifoodAssigningIds();
    // A hand-made interruption with the same reason but another end is not ours.
    ifoodSide.stored.set("by-hand", { description: "Cozinha cheia", start: "x", end: "2026-11-13T18:00:00-03:00" });
    expect(await ifood.availability!.pause(ifoodSide.ctx, request)).toEqual({ kind: "retry", reason: "socket hang up" });
    expect(await ifood.availability!.pause(ifoodSide.ctx, request)).toEqual({ kind: "paused", externalId: "ifood-1", until: UNTIL });
    expect([...ifoodSide.stored.keys()].sort()).toEqual(["by-hand", "ifood-1"]);
  });

  it("deletes, on a resume by key, the interruption the lost answer created, and leaves the hand-made one", async () => {
    const ifoodSide = ifoodAssigningIds();
    ifoodSide.stored.set("by-hand", { description: "Fechado", start: "x", end: "2026-11-13T12:25:00-03:00" });
    expect(await ifood.availability!.pause(ifoodSide.ctx, request)).toMatchObject({ kind: "retry" });
    const ref = { merchantId: "merchant-1", externalId: null, key: "key-1", sent: { until: UNTIL, reason: "Cozinha cheia", timeZone: "America/Sao_Paulo" } };
    expect(await ifood.availability!.resume(ifoodSide.ctx, ref)).toEqual({ kind: "accepted" });
    expect([...ifoodSide.stored.keys()]).toEqual(["by-hand"]);
  });

  it("recognises an end iFood echoes in UTC or without its offset", async () => {
    for (const end of ["2026-11-13T15:25:00Z", "2026-11-13T12:25:00", "2026-11-13T15:25:00.000+00:00"]) {
      const { ctx } = context(() => ({ status: 200, body: JSON.stringify([{ id: "ifood-7", description: "Cozinha cheia", end }]) }));
      expect(await ifood.availability!.pause(ctx, request)).toEqual({ kind: "paused", externalId: "ifood-7", until: UNTIL });
    }
  });
});

describe("the switches: offered only when the host opts in", () => {
  const rappiConfig = { copy: RAPPI_ADAPTER_COPY_EN_US, apiBaseUrl: RAPPI_BASE, tokenUrl: RAPPI_TOKEN, portalUrl: RAPPI_PORTAL, amountUnit: "MINOR_UNITS" as const };
  const odConfig = { copy: NINETY_NINE_FOOD_ADAPTER_COPY_EN_US, apiBaseUrl: OD_BASE, portalUrl: OD_PORTAL };

  it("has no capability by default", () => {
    expect(createRappiAdapter(rappiConfig).availability).toBeUndefined();
    expect(createNinetyNineFoodAdapter(odConfig).availability).toBeUndefined();
  });

  it("Rappi: turns the store off and on through the synchronous availability call, judging this store's result", async () => {
    const rappi = createRappiAdapter({ ...rappiConfig, pauseByStoreSwitch: true });
    expect(rappi.availability?.kind).toBe("switch");
    const ok = context(() => ({ status: 200, body: JSON.stringify({ results: [{ store_id: "store-9", operation_result: true }] }) }));
    expect(await rappi.availability!.pause(ok.ctx, { ...request, merchantId: "store-9" })).toEqual({ kind: "paused", externalId: null, until: UNTIL });
    const [put] = ok.sent();
    expect(put).toMatchObject({ method: "PUT", url: `${RAPPI_BASE.SANDBOX}/availability/stores/enable`, headers: { "x-authorization": "Bearer tok" } });
    expect(JSON.parse(put!.body!)).toEqual({ stores: [{ store_id: "store-9", is_enabled: false }] });

    const suspended = context(() => ({
      status: 200,
      body: JSON.stringify({ results: [{ store_id: "store-9", operation_result: false, operation_result_message: "store suspended" }] }),
    }));
    expect(await rappi.availability!.resume(suspended.ctx, { merchantId: "store-9", externalId: null, key: null, sent: null })).toEqual({
      kind: "refused",
      status: 200,
      message: "store suspended",
    });
    expect(JSON.parse(suspended.sent()[0]!.body!)).toEqual({ stores: [{ store_id: "store-9", is_enabled: true }] });
  });

  it("99Food: pushes Open Delivery's merchantStatus", async () => {
    const od = createNinetyNineFoodAdapter({ ...odConfig, pauseByStoreSwitch: true });
    const { ctx, sent } = context(() => ({ status: 204, body: "" }));
    expect(await od.availability!.pause(ctx, request)).toEqual({ kind: "paused", externalId: null, until: UNTIL });
    expect(await od.availability!.resume(ctx, { merchantId: "merchant-1", externalId: null, key: null, sent: null })).toEqual({ kind: "accepted" });
    expect(sent().map((req) => [req.method, req.url, JSON.parse(req.body!)])).toEqual([
      ["POST", `${OD_BASE.SANDBOX}/v1/merchantUpdate`, { merchantStatus: "UNAVAILABLE" }],
      ["POST", `${OD_BASE.SANDBOX}/v1/merchantUpdate`, { merchantStatus: "AVAILABLE" }],
    ]);
  });
});
