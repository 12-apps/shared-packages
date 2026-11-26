import { describe, expect, it } from "vitest";

import type { StatusStep } from "../core/adapter";
import { createNinetyNineFoodAdapter } from "../99food";
import { NINETY_NINE_FOOD_ADAPTER_COPY_EN_US } from "../99food/en-US";
import { API_BASE as OD_BASE, PORTAL as OD_PORTAL, specEvent } from "../99food/__tests__/fixtures";
import { createRappiAdapter } from "../rappi";
import { RAPPI_ADAPTER_COPY_EN_US } from "../rappi/en-US";
import { API_BASE as RAPPI_BASE, PORTAL as RAPPI_PORTAL, PORTAL_ORDER_ID, portalOtherEvent, TOKEN_URL } from "../rappi/__tests__/fixtures";
import { createIfoodAdapter } from "../ifood";
import { IFOOD_ADAPTER_COPY_EN_US } from "../ifood/en-US";
import { TENANT, createHarness, scriptedHttp } from "./harness";

/**
 * The three adapters' status halves (FUT-4653, contract §2): which step each
 * marketplace is told, for which kind of order, and which it is not. Each
 * test mounts its own engine with the three adapters registered.
 */

const FIRST = { attempt: 1, maxAttempts: 3 };
const TOKEN = { status: 200, body: JSON.stringify({ accessToken: "t", access_token: "t", expires_in: 3600 }) };

function mounted() {
  const http = scriptedHttp((request) =>
    request.url.endsWith("/token") || request.url === TOKEN_URL.SANDBOX ? TOKEN : { status: 202, body: "" },
  );
  const h = createHarness({
    http,
    statusHolds: () => true,
    adapters: [
      createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US }),
      createNinetyNineFoodAdapter({ copy: NINETY_NINE_FOOD_ADAPTER_COPY_EN_US, apiBaseUrl: OD_BASE, portalUrl: OD_PORTAL }),
      createRappiAdapter({
        copy: RAPPI_ADAPTER_COPY_EN_US,
        apiBaseUrl: RAPPI_BASE,
        tokenUrl: TOKEN_URL,
        portalUrl: RAPPI_PORTAL,
        amountUnit: "MAJOR_UNITS",
      }),
    ],
  });
  return { h, http };
}

/** An ACCEPTED acceptance of `provider`, written straight to the table, and its order id. */
async function accepted(
  h: ReturnType<typeof mounted>["h"],
  provider: string,
  externalOrderId: string,
  deliveredBy: "MERCHANT" | "MARKETPLACE" | null,
): Promise<string> {
  await h.connect(provider);
  await h.seedAcceptance({
    clientId: TENANT,
    orderId: `order-${provider}`,
    provider,
    externalOrderId,
    status: "ACCEPTED",
    deliveredBy,
  });
  return `order-${provider}`;
}

const run = (h: ReturnType<typeof mounted>["h"], orderId: string, step: StatusStep) =>
  h.engine.runOutbound({ clientId: TENANT, orderId, action: "status", step }, FIRST);

const calls = (http: ReturnType<typeof scriptedHttp>) =>
  http.requests.filter((r) => !r.url.endsWith("/token") && r.url !== TOKEN_URL.SANDBOX).map((r) => `${r.method} ${r.url}`);

describe("99Food (Open Delivery v1.7.1)", () => {
  const OD = (id: string, action: string) => `POST ${OD_BASE.SANDBOX}/v1/orders/${id}/${action}`;

  it("[O12] DISPATCHED and CONCLUDED events name their lifecycle; the engine applies them", async () => {
    const followed = createHarness({
      lifecycle: ["moved"],
      adapters: [createNinetyNineFoodAdapter({ copy: NINETY_NINE_FOOD_ADAPTER_COPY_EN_US, apiBaseUrl: OD_BASE, portalUrl: OD_PORTAL })],
    });
    await followed.connect("NINETY_NINE_FOOD");
    await followed.seedAcceptance({
      clientId: TENANT,
      orderId: "o-od",
      provider: "NINETY_NINE_FOOD",
      externalOrderId: "od-1",
      status: "ACCEPTED",
      deliveredBy: "MERCHANT",
    });

    for (const [type, lifecycle] of [["DISPATCHED", "DISPATCHED"], ["CONCLUDED", "CONCLUDED"], ["CONFIRMED", null]] as const) {
      const payload = specEvent(type, "od-1");
      const event = followed.engine.normalize("NINETY_NINE_FOOD", payload);
      expect(event?.lifecycle ?? null).toBe(lifecycle);
    }
    const payload = specEvent("DISPATCHED", "od-1");
    const target = await followed.engine.target(TENANT, "NINETY_NINE_FOOD");
    const outcome = await followed.engine.deliver({
      clientId: TENANT,
      event: followed.engine.normalize("NINETY_NINE_FOOD", payload)!,
      payload,
      settings: { autoAccept: false, ackSlaSeconds: 300, followStatus: target?.followStatus },
    });

    expect(outcome).toEqual({ kind: "moved", orderId: "o-od", lifecycle: "DISPATCHED" });
  });

  it("[P8b] READY for every kind, DISPATCHED for a merchant bag", async () => {
    const { h, http } = mounted();
    const orderId = await accepted(h, "NINETY_NINE_FOOD", "od-1", "MERCHANT");

    expect((await run(h, orderId, "READY")).kind).toBe("done");
    expect((await run(h, orderId, "DISPATCHED")).kind).toBe("done");

    expect(calls(http)).toEqual([OD("od-1", "readyForPickup"), OD("od-1", "dispatch")]);
  });

  it.each([
    ["MERCHANT", "delivered"],
    [null, "pickedUp"],
  ] as const)("[P8b] HANDED_OVER for deliveredBy %s calls %s", async (deliveredBy, action) => {
    const { h, http } = mounted();
    const orderId = await accepted(h, "NINETY_NINE_FOOD", "od-1", deliveredBy);

    expect((await run(h, orderId, "HANDED_OVER")).kind).toBe("done");

    expect(calls(http)).toEqual([OD("od-1", action)]);
  });

  it("[P8b] a fleet bag is not handed over by the store, and is not dispatched by it either", async () => {
    const { h, http } = mounted();
    const orderId = await accepted(h, "NINETY_NINE_FOOD", "od-1", "MARKETPLACE");

    expect((await run(h, orderId, "HANDED_OVER")).kind).toBe("skipped");
    expect((await run(h, orderId, "DISPATCHED")).kind).toBe("skipped");
    expect((await run(h, orderId, "READY")).kind).toBe("done");

    expect(calls(http)).toEqual([OD("od-1", "readyForPickup")]);
  });

  it("a take-out is never dispatched", async () => {
    const { h, http } = mounted();
    const orderId = await accepted(h, "NINETY_NINE_FOOD", "od-1", null);

    expect((await run(h, orderId, "DISPATCHED")).kind).toBe("skipped");
    expect(calls(http)).toEqual([]);
  });
});

describe("Rappi", () => {
  it("[O11] maps no lifecycle: an `event` payload stays an event the engine does not follow", () => {
    const { h } = mounted();
    const event = h.engine.normalize("RAPPI", portalOtherEvent());
    expect(event?.lifecycle ?? null).toBeNull();
  });

  it("[P14] READY is a POST to ready-for-pickup; DISPATCHED and HANDED_OVER have no endpoint", async () => {
    const { h, http } = mounted();
    const orderId = await accepted(h, "RAPPI", PORTAL_ORDER_ID, "MARKETPLACE");

    expect((await run(h, orderId, "READY")).kind).toBe("done");
    expect((await run(h, orderId, "DISPATCHED")).kind).toBe("skipped");
    expect((await run(h, orderId, "HANDED_OVER")).kind).toBe("skipped");

    expect(calls(http)).toEqual([`POST ${RAPPI_BASE.SANDBOX}/orders/${PORTAL_ORDER_ID}/ready-for-pickup`]);
    expect(http.requests.find((r) => r.url.endsWith("ready-for-pickup"))?.headers["x-authorization"]).toBe("Bearer t");
  });
});

describe("the steps each adapter states", () => {
  it("[P14] statusSteps says what each marketplace is told at all", () => {
    const { h } = mounted();
    expect(h.engine.adapter("IFOOD")?.capabilities.statusSteps).toEqual(["READY", "DISPATCHED"]);
    expect(h.engine.adapter("NINETY_NINE_FOOD")?.capabilities.statusSteps).toEqual(["READY", "DISPATCHED", "HANDED_OVER"]);
    expect(h.engine.adapter("RAPPI")?.capabilities.statusSteps).toEqual(["READY"]);
  });
});
