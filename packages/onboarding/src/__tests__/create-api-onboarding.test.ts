/* eslint-disable test-flakiness/no-test-isolation -- `db` comes from `harness()`,
   which builds a FRESH in-memory store per case; the rule matches the identifier
   across the file rather than its scope. */
import { describe, expect, it } from "vitest";
import { PT_BR_ONBOARDING_MESSAGES } from "../server/pt-BR";

import { createApiOnboarding } from "../server/create-api-onboarding";
import type { OnboardingRoute } from "../server/context";
import type { OnboardingStateSnapshot } from "../types";

import { fakeOnboardingDb, type FakeOnboardingDb } from "./fake-db";

/**
 * The progress surface (12-23) — the port of the origin host's
 * `app/api/admin/[tenantSlug]/onboarding/[featureKey]/__tests__/route.test.ts`,
 * now against the package's own descriptors instead of a Next route.
 *
 * The cases that matter are the ones the host used to own by accident: which
 * operation stamps which timestamp, what a typo'd feature key answers, and that
 * the actor — not a query param — is the tenant isolation.
 */

const USER = "user-1";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const FEATURE = "ai_integration";

interface Harness {
  db: FakeOnboardingDb;
  get: (
    featureKey: string,
    actor?: { userId: string; clientId: string },
  ) => Promise<{ status: number; body: unknown }>;
  patch: (
    featureKey: string,
    body: unknown,
    actor?: { userId: string; clientId: string },
  ) => Promise<{ status: number; body: unknown }>;
}

function harness(options?: {
  featureKeys?: readonly string[];
  resetEnabled?: () => boolean;
}): Harness {
  const db = fakeOnboardingDb();
  const api = createApiOnboarding({
    messages: PT_BR_ONBOARDING_MESSAGES,
    db: async () => db,
    ...(options?.featureKeys ? { featureKeys: options.featureKeys } : {}),
    ...(options?.resetEnabled ? { resetEnabled: options.resetEnabled } : {}),
  });
  const route = (method: OnboardingRoute["method"]): OnboardingRoute => {
    const found = api.routes.find((candidate) => candidate.method === method);
    if (!found) throw new Error(`no ${method} route`);
    return found;
  };
  const defaultActor = { userId: USER, clientId: TENANT_A };
  return {
    db,
    get: (featureKey, actor = defaultActor) =>
      route("GET").handle({ actor, params: { featureKey }, query: {} }),
    patch: (featureKey, body, actor = defaultActor) =>
      route("PATCH").handle({ actor, params: { featureKey }, query: {}, body }),
  };
}

/** The `{ data }` envelope, narrowed. */
function snapshotOf(body: unknown): OnboardingStateSnapshot | null {
  return (body as { data: OnboardingStateSnapshot | null }).data;
}

describe("routes — the surface's own contract", () => {
  it("mounts GET and PATCH on the same path, in that order", () => {
    // The packaged store builds these URLs; the SHAPE is part of the contract.
    const api = createApiOnboarding({ messages: PT_BR_ONBOARDING_MESSAGES, db: async () => fakeOnboardingDb() });
    expect(api.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /onboarding/:featureKey",
      "PATCH /onboarding/:featureKey",
    ]);
  });
});

describe("GET — reading progress", () => {
  it("answers null before any progress, not 404", async () => {
    // `null` is what the provider's `initialState` takes; a 404 would make a
    // first visit indistinguishable from a broken mount.
    const { get } = harness();
    const response = await get(FEATURE);
    expect(response.status).toBe(200);
    expect(snapshotOf(response.body)).toBeNull();
  });

  it("404s a feature key the host never declared", async () => {
    const { get } = harness({ featureKeys: [FEATURE] });
    const response = await get("nao_existe");
    expect(response.status).toBe(404);
  });

  it("accepts any feature key when the host declares none", async () => {
    const { get } = harness();
    expect((await get("anything")).status).toBe(200);
  });
});

describe("PATCH — the three operations", () => {
  it("save persists status, step and a shallow-merged data payload", async () => {
    const { patch } = harness();
    await patch(FEATURE, { op: "save", status: "in_progress", step: "host", data: { host: "claude" } });
    const second = await patch(FEATURE, { op: "save", step: "confirm", data: { seen: true } });

    const snapshot = snapshotOf(second.body);
    expect(snapshot?.step).toBe("confirm");
    // Merged, not replaced — the earlier key survives.
    expect(snapshot?.data).toEqual({ host: "claude", seen: true });
    // Status carries over when the patch omits it.
    expect(snapshot?.status).toBe("in_progress");
  });

  it("stamps startedAt once and completedAt on completion", async () => {
    const { patch } = harness();
    const first = snapshotOf((await patch(FEATURE, { op: "save", status: "in_progress" })).body);
    expect(first?.startedAt).toBeInstanceOf(Date);
    expect(first?.completedAt).toBeNull();

    const done = snapshotOf((await patch(FEATURE, { op: "save", status: "completed" })).body);
    expect(done?.completedAt).toBeInstanceOf(Date);
    // The original start is never re-stamped: it is when the user began.
    expect(done?.startedAt?.getTime()).toBe(first?.startedAt?.getTime());
  });

  it("dismiss marks the feature dismissed without touching data", async () => {
    const { patch } = harness();
    await patch(FEATURE, { op: "save", status: "in_progress", data: { host: "claude" } });
    const snapshot = snapshotOf((await patch(FEATURE, { op: "dismiss" })).body);
    expect(snapshot?.status).toBe("dismissed");
    expect(snapshot?.data).toEqual({ host: "claude" });
  });

  it("reset wipes the row and reads back as a clean first run", async () => {
    const { patch, db } = harness({ resetEnabled: () => true });
    await patch(FEATURE, { op: "save", status: "completed", step: "done" });
    const snapshot = snapshotOf((await patch(FEATURE, { op: "reset" })).body);
    expect(snapshot).toEqual({
      featureKey: FEATURE,
      status: "not_started",
      step: null,
      data: {},
      startedAt: null,
      completedAt: null,
    });
    expect(db.rows()).toEqual([]);
  });

  it("refuses reset when the host says this deployment is not development", async () => {
    const { patch, db } = harness({ resetEnabled: () => false });
    await patch(FEATURE, { op: "save", status: "completed" });
    const response = await patch(FEATURE, { op: "reset" });
    expect(response.status).toBe(403);
    // pt-BR product copy, verbatim from the origin host's route.
    expect(response.body).toEqual({ error: "Reset de onboarding indisponível em produção." });
    // And the row is still there — a refused reset must not half-delete.
    expect(db.rows()).toHaveLength(1);
  });

  it("400s an unknown operation, a bad status and a non-object data", async () => {
    const { patch } = harness();
    for (const body of [
      undefined,
      {},
      { op: "explode" },
      { op: "save", status: "almost" },
      { op: "save", data: ["not", "an", "object"] },
      { op: "save", step: 7 },
    ]) {
      expect((await patch(FEATURE, body)).status).toBe(400);
    }
  });
});

describe("isolation — the actor IS the scope", () => {
  it("keeps the same user's progress independent per tenant", async () => {
    const { patch, get } = harness();
    await patch(FEATURE, { op: "save", status: "completed" }, { userId: USER, clientId: TENANT_A });
    await patch(FEATURE, { op: "save", status: "in_progress" }, { userId: USER, clientId: TENANT_B });

    const inA = snapshotOf((await get(FEATURE, { userId: USER, clientId: TENANT_A })).body);
    const inB = snapshotOf((await get(FEATURE, { userId: USER, clientId: TENANT_B })).body);
    expect(inA?.status).toBe("completed");
    expect(inB?.status).toBe("in_progress");
  });

  it("does not leak another tenant's row to the same user", async () => {
    const { patch, get } = harness();
    await patch(FEATURE, { op: "save", status: "completed" }, { userId: USER, clientId: TENANT_A });
    expect(snapshotOf((await get(FEATURE, { userId: USER, clientId: TENANT_B })).body)).toBeNull();
  });

  it("scopes a reset to the acting tenant only", async () => {
    const { patch, get } = harness({ resetEnabled: () => true });
    await patch(FEATURE, { op: "save", status: "completed" }, { userId: USER, clientId: TENANT_A });
    await patch(FEATURE, { op: "save", status: "completed" }, { userId: USER, clientId: TENANT_B });

    await patch(FEATURE, { op: "reset" }, { userId: USER, clientId: TENANT_A });

    expect(snapshotOf((await get(FEATURE, { userId: USER, clientId: TENANT_A })).body)).toBeNull();
    expect(
      snapshotOf((await get(FEATURE, { userId: USER, clientId: TENANT_B })).body)?.status,
    ).toBe("completed");
  });
});

describe("repository — the reach-out list the routes do not expose", () => {
  it("scopes the mid-integration list to a single tenant", async () => {
    const db = fakeOnboardingDb();
    const api = createApiOnboarding({ messages: PT_BR_ONBOARDING_MESSAGES, db: async () => db });
    await api.repository.upsertOnboardingState(USER, TENANT_A, FEATURE, { status: "in_progress" });
    await api.repository.upsertOnboardingState(USER, TENANT_B, FEATURE, { status: "in_progress" });

    const inA = await api.repository.listOnboardingByStatus(TENANT_A, FEATURE, "in_progress");
    expect(inA).toHaveLength(1);
    expect(inA[0]?.clientId).toBe(TENANT_A);
  });
});
