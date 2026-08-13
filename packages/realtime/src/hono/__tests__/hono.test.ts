/* eslint-disable test-flakiness/no-test-isolation -- every fixture here is built INSIDE its
   own `it` (`mounted()`), so there is no state shared between cases. The rule's heuristic
   reads any `const` inside a `describe` as describe-level and then flags ordinary method
   calls on it; the same allowance `packages/prisma/package.test.ts` makes for the same
   misread. Isolation is enforced by construction — a fresh fixture per test — plus the
   `afterEach` resets below. */
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { resetRealtimeRuntime } from "../../core/runtime";
import { createInlineRealtimeDriver } from "../../drivers/inline";
import { EventsDenial } from "../../server/types";
import { eventsRouter } from "../index";

/**
 * The Hono adapter, over a real router.
 *
 * The one thing this adapter must not do is touch a stream's body: a re-serialized SSE
 * response is a request that never finishes, which fails as "the page hangs" rather than
 * as anything a stack trace would explain.
 */

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

afterEach(() => {
  resetRealtimeRuntime();
});

async function mounted(options: { denyWith?: EventsDenial } = {}) {
  const events = eventsRouter({
    logger: silentLogger,
    driver: createInlineRealtimeDriver({ logger: silentLogger }),
    ticketSecret: "hono-secret",
    installSignalHooks: false,
    surfaces: [
      {
        name: "admin",
        path: "/admin/:tenantSlug/realtime",
        domains: ["kitchen"],
        authorize: async ({ params }) => {
          if (options.denyWith) throw options.denyWith;
          return {
            subjectId: params.tenantSlug ?? "",
            topics: [`tenant:${params.tenantSlug ?? ""}:kitchen`],
          };
        },
      },
    ],
  });
  await events.start();
  const app = new Hono();
  app.route("/api", events.router);
  return { app, events };
}

describe("eventsRouter", () => {
  it("mounts the stream and the ticket route under the host's prefix", async () => {
    const { app, events } = await mounted();
    const response = await app.request("/api/admin/loja-a/realtime?topics=kitchen");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    await response.body?.cancel();
    await events.stop();
  });

  it("returns the stream Response VERBATIM, body and all", async () => {
    const { app, events } = await mounted();
    const response = await app.request("/api/admin/loja-a/realtime?topics=kitchen");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("the adapter dropped the stream body");
    // The preamble proves the body is the package's stream rather than a re-serialization.
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(": connected");
    await reader.cancel();
    await events.stop();
  });

  it("wraps a ticket in the { data } success envelope", async () => {
    const { app, events } = await mounted();
    const response = await app.request("/api/admin/loja-a/realtime/ticket?topics=kitchen", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ticket: expect.any(String) as unknown as string, expiresInSeconds: 30 },
    });
    await events.stop();
  });

  it("leaves a denial UNWRAPPED, at the seam's own status", async () => {
    const { app, events } = await mounted({
      denyWith: new EventsDenial(403, "Sem permissão para o tópico: kitchen."),
    });
    const response = await app.request("/api/admin/loja-a/realtime?topics=kitchen");
    expect(response.status).toBe(403);
    // `{ error }`, never `{ data }`: the success envelope is for payloads, and a denial
    // has none.
    expect(await response.json()).toEqual({ error: "Sem permissão para o tópico: kitchen." });
    await events.stop();
  });

  it("answers 404 for a path no surface claims", async () => {
    const { app, events } = await mounted();
    expect((await app.request("/api/admin/loja-a/realtime/nope")).status).toBe(404);
    await events.stop();
  });

  it("refuses the ticket route on GET — minting a credential is a POST", async () => {
    const { app, events } = await mounted();
    // A GET would be cacheable, prefetchable and replayable out of a history entry.
    expect((await app.request("/api/admin/loja-a/realtime/ticket?topics=kitchen")).status).toBe(404);
    await events.stop();
  });

  it("passes the route params through, so the tenant comes from the PATH", async () => {
    const { app, events } = await mounted();
    const response = await app.request("/api/admin/outra-loja/realtime/ticket?topics=kitchen", {
      method: "POST",
    });
    const body = (await response.json()) as { data: { ticket: string } };
    const { verifyRealtimeTicket } = await import("../../core/ticket");
    expect(verifyRealtimeTicket(body.data.ticket, "hono-secret")?.topics).toEqual([
      "tenant:outra-loja:kitchen",
    ]);
    await events.stop();
  });
});
