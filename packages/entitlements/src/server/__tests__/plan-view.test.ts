import { describe, expect, it } from "vitest";

import type { EntitlementDecision } from "../../core/types";

import { buildTenantPlanView } from "../plan-view";

/**
 * The tenant's view of their own plan. What is being protected here is mostly
 * WORDING and what is withheld — the two ways this screen could mislead a
 * customer are selling them an upgrade that fixes nothing, and showing them an
 * operator's sentence.
 *
 * The tiers and the currency are a foreign host's, deliberately: the module
 * used to ship a BRL formatter as the default, so a suite written in that same
 * currency could not have noticed.
 */
const PRICING = [
  { key: "hobby", name: "Hobby", priceCents: 0 },
  { key: "station", name: "Station", priceCents: 5900 },
  { key: "network", name: "Network", priceCents: 9900 },
];

/** The HOST's currency wording — required config, never the package's. */
const priceLabel = (cents: number | null): string | null =>
  cents === null ? null : `${(cents / 100).toFixed(2)} cr`;

function decision(over: Partial<EntitlementDecision<string>> & { feature: string }) {
  return {
    enabled: true,
    reason: "enabled" as const,
    policy: "hide" as const,
    limit: null,
    requiredPlan: null,
    ...over,
  };
}

const describeNothing = (): string | null => null;

function view(
  decisions: EntitlementDecision<string>[],
  planKey = "station",
  describe = describeNothing,
) {
  return buildTenantPlanView(
    planKey,
    Object.fromEntries(decisions.map((d) => [d.feature, d])),
    PRICING,
    describe,
    {},
    priceLabel,
  );
}

describe("buildTenantPlanView", () => {
  it("names the tier and its price from the catalog", () => {
    const result = view([], "station");
    expect(result).toMatchObject({
      planKey: "station",
      name: "Station",
      priceCents: 5900,
      price: "59.00 cr",
    });
  });

  it("words the price with the HOST's labeller and nothing else", () => {
    // The property that replaces the deleted `formatPrice` suite: this module
    // no longer knows a currency, so whatever it prints has to have come from
    // the caller. A host in another currency used to get "R$" regardless.
    const result = buildTenantPlanView(
      "station",
      {},
      PRICING,
      describeNothing,
      {},
      () => "seiscentos florins",
    );
    expect(result.price).toBe("seiscentos florins");
    expect(result.priceCents).toBe(5900);
  });

  it("falls back to the raw key when pricing has no row for it", () => {
    // A retired or custom key must still render a page rather than a blank.
    // `assertApiEntitlementsConfig` refuses a ladder with an unnamed tier, so
    // this path is only ever reached by a key the ladder no longer declares.
    const result = view([], "legacy");
    expect(result).toMatchObject({
      planKey: "legacy",
      name: "legacy",
      priceCents: null,
      price: null,
    });
  });

  it("hides a feature this build does not support", () => {
    // "Não existe no código" is a sentence for an operator debugging a gate.
    // A tenant can neither buy nor fix it, so the row is dropped entirely.
    const result = view([
      decision({ feature: "ghost", enabled: false, reason: "not-supported" }),
      decision({ feature: "real" }),
    ]);
    expect(result.features.map((f) => f.feature)).toEqual(["real"]);
  });

  it("distinguishes 'not in your plan' from 'you turned this off'", () => {
    // The distinction the scattered copy lost, and the reason this exists:
    // one is fixed by upgrading, the other by a toggle they already own.
    const result = view([
      decision({ feature: "a", enabled: false, reason: "not-entitled" }),
      decision({ feature: "b", enabled: false, reason: "disabled-by-tenant" }),
    ]);
    const byKey = Object.fromEntries(result.features.map((f) => [f.feature, f]));
    expect(byKey.a?.note).toContain("Não incluído");
    expect(byKey.b?.note).toContain("Desligado por você");
    // The same answer as a code, so the SPA branches on this and not on the
    // prose — it is what decides whether a row earns a link to the settings
    // screen holding the switch.
    expect(byKey.a?.reason).toBe("not-entitled");
    expect(byKey.b?.reason).toBe("disabled-by-tenant");
  });

  it("names neither the settings screen nor what the tenant is", () => {
    // This note used to end "em Configuração › Recursos" for EVERY key, naming
    // one host's screen; a tenant sent there over a different feature found no
    // such switch and read the denial as our bug. It then said "da loja",
    // which is one host's word for its customers. The API can verify neither,
    // so it claims neither: the SPA resolves the destination per feature.
    const result = view([decision({ feature: "a", enabled: false, reason: "disabled-by-tenant" })]);
    const note = result.features[0]?.note ?? "";
    expect(note).toBe("Desligado por você nas configurações");
    expect(note).not.toContain("Recursos");
    expect(note).not.toContain("›");
    expect(note).not.toContain("loja");
  });

  it("offers an upgrade ONLY where upgrading is the remedy", () => {
    // A tenant who switched a feature off must not be sold a tier to get it
    // back — the fix is the switch. Same for a suspended account.
    const result = view([
      decision({ feature: "a", enabled: false, reason: "not-entitled", requiredPlan: "network" }),
      decision({
        feature: "b",
        enabled: false,
        reason: "disabled-by-tenant",
        requiredPlan: "network",
      }),
      decision({ feature: "c", enabled: false, reason: "restricted", requiredPlan: "network" }),
    ]);
    const byKey = Object.fromEntries(result.features.map((f) => [f.feature, f]));
    expect(byKey.a?.requiredPlan).toBe("network");
    // …and the COMMERCIAL name, so the tenant never reads a raw key.
    expect(byKey.a?.requiredPlanLabel).toBe("Network");
    expect(byKey.b?.requiredPlan).toBeNull();
    expect(byKey.c?.requiredPlan).toBeNull();
  });

  it("falls back to the key when the catalog has no name for that tier", () => {
    const result = view([
      decision({ feature: "a", enabled: false, reason: "not-entitled", requiredPlan: "legacy" }),
    ]);
    // "legacy" is absent from PRICING here — a label is still produced rather
    // than a blank, which would read as "available on plan ___".
    expect(result.features[0]?.requiredPlanLabel).toBe("legacy");
  });

  it("never dangles an upsell when no tier would grant it", () => {
    const result = view([
      decision({ feature: "a", enabled: false, reason: "not-entitled", requiredPlan: null }),
    ]);
    expect(result.features[0]?.requiredPlan).toBeNull();
    expect(result.features[0]?.requiredPlanLabel).toBeNull();
  });

  it("explains a suspension as a suspension, not as a plan limit", () => {
    const result = view([
      decision({ feature: "a", enabled: false, reason: "restricted" }),
      decision({ feature: "b", enabled: false, reason: "suspended" }),
    ]);
    const byKey = Object.fromEntries(result.features.map((f) => [f.feature, f]));
    expect(byKey.a?.note).toContain("pendência financeira");
    expect(byKey.b?.note).toContain("suporte");
  });

  it("leads with what the tenant HAS", () => {
    // A plan screen that opens with a list of denials reads as a sales pitch.
    const result = view([
      decision({ feature: "zeta", enabled: false, reason: "not-entitled" }),
      decision({ feature: "alpha" }),
    ]);
    expect(result.features.map((f) => f.feature)).toEqual(["alpha", "zeta"]);
  });

  it("orders alphabetically within each group, so the page is stable", () => {
    const result = view([
      decision({ feature: "b" }),
      decision({ feature: "a" }),
      decision({ feature: "z", enabled: false, reason: "not-entitled" }),
      decision({ feature: "y", enabled: false, reason: "not-entitled" }),
    ]);
    expect(result.features.map((f) => f.feature)).toEqual(["a", "b", "y", "z"]);
  });

  it("carries the quota ceiling and the catalog's description", () => {
    const result = view([decision({ feature: "a", limit: 100 })], "station", () => "Faz coisas");
    expect(result.features[0]).toMatchObject({ limit: 100, description: "Faz coisas" });
  });
});

describe("the over-quota state", () => {
  const overQuota = (used: number, nextPlan: string | null = "network") =>
    buildTenantPlanView(
      "station",
      { "stations.online": decision({ feature: "stations.online", limit: 100 }) },
      PRICING,
      describeNothing,
      { "stations.online": { used, nextPlan } },
      priceLabel,
    );

  it("says the agreed over-quota words when the tenant holds MORE than its ceiling", () => {
    // Grandfathered or downgraded: the feature IS in the plan, so
    // "Não incluído" would be a lie, and plain "Incluído" would hide that
    // creates refuse. The agreed copy: keep everything, cannot add more.
    const [row] = overQuota(340).features;
    expect(row?.note).toBe(
      "Seu plano inclui 100 e você tem 340. Todos continuam ativos — para criar novos, assine o Network.",
    );
    expect(row?.used).toBe(340);
    // The one state where the upsell hangs off an ENABLED row — and it names
    // the tier whose ceiling clears what they HOLD, resolved by the caller.
    expect(row?.requiredPlan).toBe("network");
    expect(row?.requiredPlanLabel).toBe("Network");
    expect(row?.enabled).toBe(true);
  });

  it("drops the upsell clause when no tier would raise the ceiling", () => {
    const [row] = overQuota(340, null).features;
    expect(row?.note).toBe("Seu plano inclui 100 e você tem 340. Todos continuam ativos.");
    expect(row?.requiredPlan).toBeNull();
  });

  it("does NOT banner a tenant exactly AT its ceiling", () => {
    // Full is not over: the agreed banner condition is used > limit. At the
    // ceiling the row still says "Incluído" and carries used/limit for the UI.
    const [row] = overQuota(100).features;
    expect(row?.note).toBe("Incluído no seu plano");
    expect(row?.used).toBe(100);
  });

  it("never banners an unlimited or unmeasured quota", () => {
    const unlimited = buildTenantPlanView(
      "station",
      { a: decision({ feature: "a", limit: "unlimited" }) },
      PRICING,
      describeNothing,
      { a: { used: 9999, nextPlan: "network" } },
      priceLabel,
    );
    expect(unlimited.features[0]?.note).toBe("Incluído no seu plano");

    const unmeasured = view([decision({ feature: "a", limit: 100 })]);
    expect(unmeasured.features[0]?.note).toBe("Incluído no seu plano");
    expect(unmeasured.features[0]?.used).toBeNull();
  });

  it("keeps the not-entitled wording for a quota the plan does not grant", () => {
    // Zero-quota tier: the entitlement layer denies before usage is read —
    // that is a plan gap, not an overage, and reads as one.
    const result = buildTenantPlanView(
      "hobby",
      { a: decision({ feature: "a", enabled: false, reason: "not-entitled", limit: 0 }) },
      PRICING,
      describeNothing,
      {},
      priceLabel,
    );
    expect(result.features[0]?.note).toBe("Não incluído no seu plano");
  });
});
