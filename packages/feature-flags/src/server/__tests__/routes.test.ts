import { describe, expect, it } from "vitest";

import { fakeDb } from "../../__tests__/fake-db";
import { createApiFeatureFlags } from "../index";
import type {
  DirectoryUser,
  FeatureFlagsAuditEvent,
  FeatureFlagsRequest,
  FeatureFlagsRoute,
  FeatureFlagsServerConfig,
} from "../index";
import { EN_US_FEATURE_FLAGS_SERVER_COPY } from "../en-US";
import { PT_BR_FEATURE_FLAGS_SERVER_COPY } from "../pt-BR";

const CATALOG = [
  { key: "delivery-beta", label: "Delivery (beta)", description: "Entrega em teste" },
  { key: "novo-dashboard", label: "Novo dashboard" },
] as const;

const PEOPLE: DirectoryUser[] = [
  { id: "u1", email: "dona@example.com", name: "Dona da Loja" },
  { id: "u2", email: "garcom@example.com", name: null },
];

interface Harness {
  routes: FeatureFlagsRoute[];
  audits: FeatureFlagsAuditEvent[];
  rows: () => readonly unknown[];
}

function harness(
  seed: Parameters<typeof fakeDb>[0] = [],
  overrides: Partial<FeatureFlagsServerConfig> = {},
): Harness {
  const { db, rows } = fakeDb(seed);
  const audits: FeatureFlagsAuditEvent[] = [];
  const { routes } = createApiFeatureFlags({
    db: () => Promise.resolve(db),
    catalog: CATALOG,
    copy: PT_BR_FEATURE_FLAGS_SERVER_COPY,
    directory: {
      getUsers: (ids) => Promise.resolve(PEOPLE.filter((person) => ids.includes(person.id))),
      findUserByEmail: (email) =>
        Promise.resolve(PEOPLE.find((person) => person.email === email) ?? null),
    },
    audit: (event) => {
      audits.push(event);
    },
    ...overrides,
  });
  return { routes, audits, rows };
}

function routeOf(routes: FeatureFlagsRoute[], method: string, path: string): FeatureFlagsRoute {
  const found = routes.find((route) => route.method === method && route.path === path);
  if (!found) throw new Error(`no route ${method} ${path}`);
  return found;
}

function request(partial: Partial<FeatureFlagsRequest> = {}): FeatureFlagsRequest {
  return {
    actor: { email: "root@12-apps.dev" },
    params: {},
    query: {},
    ...partial,
  };
}

describe("createApiFeatureFlags", () => {
  it("declares the six mount-relative routes with /users before /:key", () => {
    const { routes } = harness();
    const listed = routes.map((route) => `${route.method} ${route.path}`);
    expect(listed).toEqual([
      "GET /",
      "GET /users/:userId",
      "GET /:key/grants",
      "POST /:key/grants",
      "PUT /:key/grants/:userId",
      "DELETE /:key/grants/:userId",
    ]);
    // Order is load-bearing for an in-order dispatcher: the static segment
    // must be claimed before the param can swallow it.
    expect(listed.indexOf("GET /users/:userId")).toBeLessThan(listed.indexOf("GET /:key/grants"));
  });

  it("refuses a blank actor on every route — a miswired bridge must not stamp writes", async () => {
    const { routes } = harness();
    for (const route of routes) {
      const response = await route.handle(request({ actor: { email: "  " } }));
      expect(response.status).toBe(401);
    }
  });
});

describe("GET /", () => {
  it("tallies grants per catalog flag, in catalog order, and names orphans", async () => {
    const { routes } = harness([
      { userId: "u1", flagKey: "delivery-beta" },
      { userId: "u2", flagKey: "delivery-beta", enabled: false },
      { userId: "u1", flagKey: "retired-flag" },
    ]);
    const response = await routeOf(routes, "GET", "/").handle(request());
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      flags: [
        {
          key: "delivery-beta",
          label: "Delivery (beta)",
          description: "Entrega em teste",
          grantCount: 2,
          enabledCount: 1,
        },
        {
          key: "novo-dashboard",
          label: "Novo dashboard",
          description: null,
          grantCount: 0,
          enabledCount: 0,
        },
      ],
      orphans: [{ flagKey: "retired-flag", grantCount: 1 }],
    });
  });
});

describe("GET /:key/grants", () => {
  it("pages newest-first and resolves people through the host directory", async () => {
    const { routes } = harness([
      { userId: "u1", flagKey: "delivery-beta", note: "primeira testadora" },
      { userId: "u2", flagKey: "delivery-beta" },
      { userId: "gone", flagKey: "delivery-beta" },
    ]);
    const route = routeOf(routes, "GET", "/:key/grants");
    const response = await route.handle(
      request({ params: { key: "delivery-beta" }, query: { page: "1", perPage: "2" } }),
    );
    expect(response.status).toBe(200);
    const body = response.body as {
      items: Array<{ userId: string; email: string | null }>;
      total: number;
    };
    expect(body.total).toBe(3);
    expect(body.items.map((item) => item.userId)).toEqual(["gone", "u2"]);
    // A user the directory no longer knows keeps the grant VISIBLE with a
    // null email — hiding it would strand an unrevokable row.
    expect(body.items[0]?.email).toBeNull();

    const page2 = await route.handle(
      request({ params: { key: "delivery-beta" }, query: { page: "2", perPage: "2" } }),
    );
    const second = page2.body as { items: Array<{ userId: string; note: string | null }> };
    expect(second.items.map((item) => item.userId)).toEqual(["u1"]);
    expect(second.items[0]?.note).toBe("primeira testadora");
  });

  it("answers 404 for a key outside the catalog", async () => {
    const { routes } = harness();
    const response = await routeOf(routes, "GET", "/:key/grants").handle(
      request({ params: { key: "nope" } }),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /:key/grants", () => {
  it("grants by email: 201, enabled, stamped with the acting superadmin", async () => {
    const { routes, audits } = harness();
    const response = await routeOf(routes, "POST", "/:key/grants").handle(
      request({
        params: { key: "delivery-beta" },
        body: { email: "dona@example.com", note: "beta da entrega" },
      }),
    );
    expect(response.status).toBe(201);
    const { grant } = response.body as { grant: Record<string, unknown> };
    expect(grant).toMatchObject({
      userId: "u1",
      email: "dona@example.com",
      flagKey: "delivery-beta",
      enabled: true,
      note: "beta da entrega",
      grantedBy: "root@12-apps.dev",
    });
    expect(audits).toEqual([
      { action: "granted", flagKey: "delivery-beta", userId: "u1", actor: "root@12-apps.dev" },
    ]);
  });

  it("re-granting an existing grant re-enables it and audits as an update", async () => {
    const { routes, audits } = harness([
      { userId: "u1", flagKey: "delivery-beta", enabled: false, note: "pausada" },
    ]);
    const response = await routeOf(routes, "POST", "/:key/grants").handle(
      request({ params: { key: "delivery-beta" }, body: { email: "dona@example.com" } }),
    );
    expect(response.status).toBe(200);
    const { grant } = response.body as { grant: Record<string, unknown> };
    // Re-enabled, and the absent note field left the stored note alone.
    expect(grant).toMatchObject({ enabled: true, note: "pausada" });
    expect(audits[0]?.action).toBe("updated");
  });

  it("answers 422 for a malformed email and 404 for an unknown person", async () => {
    const { routes } = harness();
    const route = routeOf(routes, "POST", "/:key/grants");
    const invalid = await route.handle(
      request({ params: { key: "delivery-beta" }, body: { email: "not-an-email" } }),
    );
    expect(invalid.status).toBe(422);
    const missing = await route.handle(
      request({ params: { key: "delivery-beta" }, body: { email: "quem@example.com" } }),
    );
    expect(missing.status).toBe(404);
    expect((missing.body as { error: string }).error).toBe("user_not_found");
  });
});

describe("PUT /:key/grants/:userId", () => {
  it("toggles enabled and clears a note with an explicit null", async () => {
    const { routes, audits } = harness([
      { userId: "u1", flagKey: "delivery-beta", note: "primeira" },
    ]);
    const route = routeOf(routes, "PUT", "/:key/grants/:userId");
    const response = await route.handle(
      request({
        params: { key: "delivery-beta", userId: "u1" },
        body: { enabled: false, note: null },
      }),
    );
    expect(response.status).toBe(200);
    expect((response.body as { grant: Record<string, unknown> }).grant).toMatchObject({
      enabled: false,
      note: null,
      grantedBy: "root@12-apps.dev",
    });
    expect(audits[0]?.action).toBe("updated");
  });

  it("is update-only: an absent grant is 404, never a silent creation", async () => {
    const { routes, rows } = harness();
    const response = await routeOf(routes, "PUT", "/:key/grants/:userId").handle(
      request({ params: { key: "delivery-beta", userId: "typo" }, body: { enabled: true } }),
    );
    expect(response.status).toBe(404);
    expect(rows()).toHaveLength(0);
  });

  it("answers 422 for a non-boolean enabled", async () => {
    const { routes } = harness([{ userId: "u1", flagKey: "delivery-beta" }]);
    const response = await routeOf(routes, "PUT", "/:key/grants/:userId").handle(
      request({ params: { key: "delivery-beta", userId: "u1" }, body: { enabled: "sim" } }),
    );
    expect(response.status).toBe(422);
  });
});

describe("DELETE /:key/grants/:userId", () => {
  it("revokes with a bodiless 204 and audits", async () => {
    const { routes, audits, rows } = harness([{ userId: "u1", flagKey: "delivery-beta" }]);
    const response = await routeOf(routes, "DELETE", "/:key/grants/:userId").handle(
      request({ params: { key: "delivery-beta", userId: "u1" } }),
    );
    expect(response).toEqual({ status: 204, body: undefined });
    expect(rows()).toHaveLength(0);
    expect(audits).toEqual([
      { action: "revoked", flagKey: "delivery-beta", userId: "u1", actor: "root@12-apps.dev" },
    ]);
  });

  it("answers 404 for a grant that does not exist", async () => {
    const { routes } = harness();
    const response = await routeOf(routes, "DELETE", "/:key/grants/:userId").handle(
      request({ params: { key: "delivery-beta", userId: "u1" } }),
    );
    expect(response.status).toBe(404);
  });
});

describe("GET /users/:userId", () => {
  it("lists one person's grants, labelling retired keys null instead of hiding them", async () => {
    const { routes } = harness([
      { userId: "u1", flagKey: "delivery-beta" },
      { userId: "u1", flagKey: "retired-flag" },
    ]);
    const response = await routeOf(routes, "GET", "/users/:userId").handle(
      request({ params: { userId: "u1" } }),
    );
    expect(response.status).toBe(200);
    const body = response.body as { grants: Array<{ flagKey: string; label: string | null }> };
    const byKey = new Map(body.grants.map((grant) => [grant.flagKey, grant.label]));
    expect(byKey.get("delivery-beta")).toBe("Delivery (beta)");
    expect(byKey.get("retired-flag")).toBeNull();
  });
});

describe("one mount, two languages", () => {
  /**
   * The property the resolver form of the copy port exists for: this surface is
   * a lazy singleton in every host that has one, so a `copy` chosen when it was
   * BUILT answers in the same language for the life of the process. Every case
   * above would pass either way — which is exactly why this one is here.
   */
  function bilingual(): Harness {
    return harness([], {
      // The shape `@12-apps/i18n`'s `localeCopy(PACK)` returns, spelled out
      // here so this package keeps no dependency on it.
      copy: ({ locale }) =>
        locale === "en-US" ? EN_US_FEATURE_FLAGS_SERVER_COPY : PT_BR_FEATURE_FLAGS_SERVER_COPY,
    });
  }

  const errorOf = async (
    routes: FeatureFlagsRoute[],
    locale: string | undefined,
  ): Promise<string> => {
    const response = await routeOf(routes, "GET", "/:key/grants").handle(
      request({ params: { key: "nao-existe" }, ...(locale === undefined ? {} : { locale }) }),
    );
    return (response.body as { message: string }).message;
  };

  it("answers the same mount in each caller's language", async () => {
    const { routes } = bilingual();
    expect(await errorOf(routes, "pt-BR")).toBe(PT_BR_FEATURE_FLAGS_SERVER_COPY.unknownFlag);
    expect(await errorOf(routes, "en-US")).toBe(EN_US_FEATURE_FLAGS_SERVER_COPY.unknownFlag);
  });

  it("hands an absent locale to the resolver rather than refusing", async () => {
    // A host with one audience populates nothing. Not a misconfiguration — the
    // resolver decides what no answer means, and here it means the default.
    const { routes } = bilingual();
    expect(await errorOf(routes, undefined)).toBe(PT_BR_FEATURE_FLAGS_SERVER_COPY.unknownFlag);
  });

  it("leaves a plain-value host byte-identical", async () => {
    // The whole compatibility claim: a host that passes words, not a resolver,
    // behaves exactly as it did before the field widened.
    const { routes } = harness();
    expect(await errorOf(routes, "en-US")).toBe(PT_BR_FEATURE_FLAGS_SERVER_COPY.unknownFlag);
  });

  it("still refuses an incomplete resolver at ASSEMBLY, not at the first request", () => {
    // The property a resolver could most easily have cost. Construction
    // validation renders the resolver with no locale and checks THAT.
    expect(() =>
      harness([], { copy: () => ({ ...PT_BR_FEATURE_FLAGS_SERVER_COPY, unknownFlag: "  " }) }),
    ).toThrow(/unknownFlag/);
  });
});
