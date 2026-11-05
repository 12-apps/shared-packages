/**
 * A denial's `Retry-After` through the WIRE VIEW, the path every wiring host
 * mounts. Wiring's JSON half is `{ status, body }` only, so a header left on it
 * would be dropped by `wireAnswer`; the view must hand it over as a raw
 * `{ response }`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { wireAnswer } from "@12-apps/wiring/consumer";

import { resetRealtimeRuntime } from "../../core/runtime";
import { createInlineRealtimeDriver } from "../../drivers/inline";
import { PT_BR_EVENTS_MESSAGES } from "../../server/pt-BR";
import { EventsDenial } from "../../server/types";
import { createWireApiEvents } from "../server";

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

afterEach(() => {
  resetRealtimeRuntime();
});

function wired(denial: EventsDenial) {
  return createWireApiEvents({
    messages: PT_BR_EVENTS_MESSAGES,
    logger: silentLogger,
    driver: createInlineRealtimeDriver({ logger: silentLogger }),
    ticketSecret: "wire-secret",
    installSignalHooks: false,
    surfaces: [
      {
        name: "admin",
        path: "/admin/:tenantSlug/realtime",
        domains: ["kitchen"],
        authorize: async () => {
          throw denial;
        },
      },
    ],
  });
}

/** What reached the wire, as plain values, so each case asserts on its own result. */
interface WireOutcome {
  status: number;
  retryAfter: string | null;
  body: unknown;
}

async function answerOf(denial: EventsDenial, method: "GET" | "POST"): Promise<WireOutcome> {
  const api = wired(denial);
  await api.start();
  const route = api.routes.find((candidate) => candidate.method === method);
  if (!route) throw new Error(`no ${method} route`);
  const answer = await route.handle({
    // The view never reads the actor; the contract types it `never` for this package.
    actor: undefined as never,
    params: { tenantSlug: "loja-a" },
    query: { topics: "kitchen" },
  });
  await api.stop();
  const response = wireAnswer(answer);
  return {
    status: response.status,
    retryAfter: response.headers.get("Retry-After"),
    body: await response.json(),
  };
}

describe("createWireApiEvents — a denial's Retry-After survives wiring", () => {
  it.each(["GET", "POST"] as const)(
    "sends Retry-After with the status and the unwrapped body (%s)",
    async (method) => {
      await expect(
        answerOf(new EventsDenial(429, "Muitas tentativas.", { retryAfterSeconds: 30 }), method),
      ).resolves.toEqual({ status: 429, retryAfter: "30", body: { error: "Muitas tentativas." } });
    },
  );

  it("answers a denial without the option exactly as before, with no Retry-After", async () => {
    await expect(
      answerOf(new EventsDenial(403, "Sem permissão para o tópico: kitchen."), "POST"),
    ).resolves.toEqual({
      status: 403,
      retryAfter: null,
      body: { error: "Sem permissão para o tópico: kitchen." },
    });
  });
});
