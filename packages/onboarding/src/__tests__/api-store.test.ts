/* eslint-disable test-flakiness/no-test-isolation -- `calls` is a local const
   created INSIDE each case (the recording fetch stub's log); the rule matches the
   identifier across the file rather than its scope. Nothing here outlives a case. */
import { describe, expect, it, vi } from "vitest";

import { createOnboardingApiStore, fetchOnboardingState } from "../api-store";

/**
 * The store and the endpoints are two halves of ONE contract (12-23), and the
 * failure this file guards lives exactly between them: a store that POSTs
 * `{ status }` while the route reads `PATCH { op }` passes both packages' own
 * suites and works nowhere. So these cases assert the WIRE — the method, the
 * URL, the body keys — not just that a promise resolves.
 *
 * `fetchImpl` is injected rather than stubbing the global: mutating a global
 * from a `vi.fn` is the cross-test coupling the flakiness gate exists to stop.
 */

const BASE = "/api/admin/minha-loja";
const FEATURE = "ai_integration";

interface Call {
  url: string;
  init?: RequestInit;
}

function recorder(response: () => Response): { calls: Call[]; fetchImpl: typeof fetch } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function snapshotResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      data: {
        featureKey: FEATURE,
        status: "in_progress",
        step: "host",
        data: { host: "claude" },
        startedAt: "2026-08-12T10:00:00.000Z",
        completedAt: null,
        ...overrides,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("createOnboardingApiStore", () => {
  it("saves with PATCH { op: 'save' } at the package's own path", async () => {
    const { calls, fetchImpl } = recorder(() => snapshotResponse());
    const store = createOnboardingApiStore({ apiBase: BASE, featureKey: FEATURE, fetchImpl });

    await store.save({ status: "in_progress", step: "host", data: { host: "claude" } });

    expect(calls[0]?.url).toBe(`${BASE}/onboarding/${FEATURE}`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      op: "save",
      status: "in_progress",
      step: "host",
      data: { host: "claude" },
    });
  });

  it("revives the wire's ISO dates into Date fields", async () => {
    const { fetchImpl } = recorder(() =>
      snapshotResponse({ completedAt: "2026-08-12T11:00:00.000Z" }),
    );
    const store = createOnboardingApiStore({ apiBase: BASE, featureKey: FEATURE, fetchImpl });

    const snapshot = await store.save({ status: "completed" });
    expect(snapshot.startedAt).toBeInstanceOf(Date);
    expect(snapshot.completedAt?.toISOString()).toBe("2026-08-12T11:00:00.000Z");
  });

  it("sends dismiss and reset as their own operations", async () => {
    const { calls, fetchImpl } = recorder(() => snapshotResponse());
    const store = createOnboardingApiStore({ apiBase: BASE, featureKey: FEATURE, fetchImpl });

    await store.dismiss();
    await store.reset();
    expect(calls.map((call) => JSON.parse(String(call.init?.body)).op)).toEqual([
      "dismiss",
      "reset",
    ]);
  });

  it("throws on a refused write, which is what the provider's contract expects", async () => {
    const { fetchImpl } = recorder(() => new Response(null, { status: 403 }));
    const store = createOnboardingApiStore({ apiBase: BASE, featureKey: FEATURE, fetchImpl });
    // Resolving here would report a refused reset as a successful one, and the
    // provider would keep showing a clean first run that was never persisted.
    await expect(store.reset()).rejects.toThrow(/403/);
  });

  it("escapes a feature key so a slash cannot climb the path", async () => {
    const { calls, fetchImpl } = recorder(() => snapshotResponse());
    const store = createOnboardingApiStore({
      apiBase: BASE,
      featureKey: "../../roles",
      fetchImpl,
    });
    await store.dismiss();
    expect(calls[0]?.url).toBe(`${BASE}/onboarding/..%2F..%2Froles`);
  });
});

describe("fetchOnboardingState", () => {
  it("reads the snapshot for the first paint", async () => {
    const { fetchImpl } = recorder(() => snapshotResponse());
    const state = await fetchOnboardingState({ apiBase: BASE, featureKey: FEATURE, fetchImpl });
    expect(state?.status).toBe("in_progress");
  });

  it("answers null for no progress, a refusal, or an offline read", async () => {
    const nulled = new Response(JSON.stringify({ data: null }), { status: 200 });
    for (const response of [
      (): Response => nulled.clone(),
      (): Response => new Response(null, { status: 401 }),
    ]) {
      const { fetchImpl } = recorder(response);
      expect(
        await fetchOnboardingState({ apiBase: BASE, featureKey: FEATURE, fetchImpl }),
      ).toBeNull();
    }

    // A thrown fetch (offline) must not take the first paint with it.
    const throwing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(
      await fetchOnboardingState({ apiBase: BASE, featureKey: FEATURE, fetchImpl: throwing }),
    ).toBeNull();
  });
});
