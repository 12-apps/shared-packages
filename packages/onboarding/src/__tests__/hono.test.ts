/* eslint-disable test-flakiness/no-test-isolation -- `app` is a local const from
   `mounted()`, a new Hono app per case; the rule matches the identifier across the
   file rather than its scope. */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createOnboardingApiStore, fetchOnboardingState } from "../api-store";
import { onboardingRouter } from "../hono/index";

import { fakeOnboardingDb } from "./fake-db";

/**
 * The Hono adapter, driven by the package's OWN client (12-23).
 *
 * This is the seam FUT-740 taught us to test: each published half against a
 * body it wrote itself is exactly the blindness that shipped three criticals.
 * So the store's `fetch` is routed into the mount — a real router, real
 * parsing, real statuses — and the assertions are about what came back out.
 */

const TENANT = "minha-loja";
const FEATURE = "ai_integration";

function mounted(options?: { actor?: { userId: string; clientId: string } | null }): {
  app: Hono;
  fetchImpl: typeof fetch;
} {
  const db = fakeOnboardingDb();
  const app = new Hono();
  const onboarding = onboardingRouter({
    db: async () => db,
    featureKeys: [FEATURE],
    resetEnabled: () => true,
    resolveActor: () =>
      options?.actor === undefined ? { userId: "user-1", clientId: "tenant-a" } : options.actor,
  });
  app.route("/api/admin/:tenantSlug", onboarding.router);

  // The store's URLs are origin-relative; give them an origin the router can
  // route, and hand the response straight back.
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) =>
    app.request(`http://harness.test${String(url)}`, init)) as unknown as typeof fetch;
  return { app, fetchImpl };
}

describe("onboardingRouter", () => {
  it("round-trips a save through the mount and back into the store", async () => {
    const { fetchImpl } = mounted();
    const store = createOnboardingApiStore({
      apiBase: `/api/admin/${TENANT}`,
      featureKey: FEATURE,
      fetchImpl,
    });

    const saved = await store.save({ status: "in_progress", step: "host", data: { host: "claude" } });
    expect(saved.status).toBe("in_progress");
    expect(saved.step).toBe("host");

    // And the same mount reads it back — the store's GET path is the route's.
    const read = await fetchOnboardingState({
      apiBase: `/api/admin/${TENANT}`,
      featureKey: FEATURE,
      fetchImpl,
    });
    expect(read?.data).toEqual({ host: "claude" });
    expect(read?.startedAt).toBeInstanceOf(Date);
  });

  it("401s before any handler runs when the host resolves no actor", async () => {
    const { app } = mounted({ actor: null });
    const response = await app.request(`/api/admin/${TENANT}/onboarding/${FEATURE}`);
    expect(response.status).toBe(401);
  });

  it("carries the handler's status, not a flattened 200", async () => {
    const { app } = mounted();
    const unknownFeature = await app.request(`/api/admin/${TENANT}/onboarding/outra`);
    expect(unknownFeature.status).toBe(404);

    const malformed = await app.request(`/api/admin/${TENANT}/onboarding/${FEATURE}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);
  });
});
