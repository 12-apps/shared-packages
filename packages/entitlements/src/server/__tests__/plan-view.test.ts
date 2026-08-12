import { describe, expect, it } from "vitest";

import type { EntitlementDecision } from "../../core/types";

import { buildTenantPlanView, formatPrice } from "../plan-view";

/**
 * The store's view of its own plan (FUT-408). What is being protected here is
 * mostly WORDING and what is withheld — the two ways this screen could mislead
 * a customer are selling them an upgrade that fixes nothing, and showing them
 * an operator's sentence.
 */
const PRICING = [
  { key: "free", name: "Gratuito", priceCents: 0 },
  { key: "basic", name: "Basic", priceCents: 5900 },
  { key: "pro", name: "Pro", priceCents: 9900 },
];

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
  planKey = "basic",
  describe = describeNothing,
) {
  return buildTenantPlanView(
    planKey,
    Object.fromEntries(decisions.map((d) => [d.feature, d])),
    PRICING,
    describe,
  );
}

describe("buildTenantPlanView", () => {
  it("names the tier and its price from the catalog", () => {
    const result = view([], "basic");
    expect(result).toMatchObject({
      planKey: "basic",
      name: "Basic",
      priceCents: 5900,
      price: "R$ 59,00",
    });
  });

  it("falls back to the raw key when pricing has no row for it", () => {
    // A retired or custom key must still render a page rather than a blank.
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
    // A store can neither buy nor fix it, so the row is dropped entirely.
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

  it("never names the settings screen the switch lives on", () => {
    // This note used to end "em Configuração › Recursos" for EVERY key. That
    // screen holds the three `lifecycle.*` toggles and nothing else, so a store
    // sent there over mesas, comandas, observações, esgotados or troca de mesa
    // found no such switch and read the denial as our bug. The API cannot
    // verify an admin route, so it no longer claims one; apps/admin resolves
    // the destination per feature (lib/tenant-switch-locations.ts).
    const result = view([decision({ feature: "a", enabled: false, reason: "disabled-by-tenant" })]);
    const note = result.features[0]?.note ?? "";
    expect(note).toBe("Desligado por você nas configurações da loja");
    expect(note).not.toContain("Recursos");
    expect(note).not.toContain("›");
  });

  it("offers an upgrade ONLY where upgrading is the remedy", () => {
    // A store that switched a feature off must not be sold a tier to get it
    // back — the fix is the switch. Same for a suspended account.
    const result = view([
      decision({ feature: "a", enabled: false, reason: "not-entitled", requiredPlan: "pro" }),
      decision({
        feature: "b",
        enabled: false,
        reason: "disabled-by-tenant",
        requiredPlan: "pro",
      }),
      decision({ feature: "c", enabled: false, reason: "restricted", requiredPlan: "pro" }),
    ]);
    const byKey = Object.fromEntries(result.features.map((f) => [f.feature, f]));
    expect(byKey.a?.requiredPlan).toBe("pro");
    // …and the COMMERCIAL name, so the store never reads a raw key.
    expect(byKey.a?.requiredPlanLabel).toBe("Pro");
    expect(byKey.b?.requiredPlan).toBeNull();
    expect(byKey.c?.requiredPlan).toBeNull();
  });

  it("falls back to the key when the catalog has no name for that tier", () => {
    const result = view([
      decision({ feature: "a", enabled: false, reason: "not-entitled", requiredPlan: "max" }),
    ]);
    // "max" is absent from PRICING here — a label is still produced rather
    // than a blank, which would read as "available on plan ___".
    expect(result.features[0]?.requiredPlanLabel).toBe("max");
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

  it("leads with what the store HAS", () => {
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
    const result = view([decision({ feature: "a", limit: 100 })], "basic", () => "Faz coisas");
    expect(result.features[0]).toMatchObject({ limit: 100, description: "Faz coisas" });
  });
});

describe("the over-quota state (FUT-396 / FUT-333)", () => {
  const overQuota = (used: number, nextPlan: string | null = "pro") =>
    buildTenantPlanView(
      "basic",
      { "catalog.products": decision({ feature: "catalog.products", limit: 100 }) },
      PRICING,
      describeNothing,
      { "catalog.products": { used, nextPlan } },
    );

  it("says the FUT-396 words when the store holds MORE than its ceiling", () => {
    // Grandfathered or downgraded: the feature IS in the plan, so
    // "Não incluído" would be a lie, and plain "Incluído" would hide that
    // creates refuse. The agreed copy: keep everything, cannot add more.
    const [row] = overQuota(340).features;
    expect(row?.note).toBe(
      "Seu plano inclui 100 e sua loja tem 340. Todos continuam ativos — para criar novos, assine o Pro.",
    );
    expect(row?.used).toBe(340);
    // The one state where the upsell hangs off an ENABLED row — and it names
    // the tier whose ceiling clears what they HOLD, resolved by the caller.
    expect(row?.requiredPlan).toBe("pro");
    expect(row?.requiredPlanLabel).toBe("Pro");
    expect(row?.enabled).toBe(true);
  });

  it("drops the upsell clause when no tier would raise the ceiling", () => {
    const [row] = overQuota(340, null).features;
    expect(row?.note).toBe("Seu plano inclui 100 e sua loja tem 340. Todos continuam ativos.");
    expect(row?.requiredPlan).toBeNull();
  });

  it("does NOT banner a store exactly AT its ceiling", () => {
    // Full is not over: the agreed banner condition is used > limit. At the
    // ceiling the row still says "Incluído" and carries used/limit for the UI.
    const [row] = overQuota(100).features;
    expect(row?.note).toBe("Incluído no seu plano");
    expect(row?.used).toBe(100);
  });

  it("never banners an unlimited or unmeasured quota", () => {
    const unlimited = buildTenantPlanView(
      "basic",
      { a: decision({ feature: "a", limit: "unlimited" }) },
      PRICING,
      describeNothing,
      { a: { used: 9999, nextPlan: "pro" } },
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
      "free",
      { a: decision({ feature: "a", enabled: false, reason: "not-entitled", limit: 0 }) },
      PRICING,
      describeNothing,
      {},
    );
    expect(result.features[0]?.note).toBe("Não incluído no seu plano");
  });
});

describe("formatPrice", () => {
  it("reads as Brazilian currency", () => {
    expect(formatPrice(5900)).toBe("R$ 59,00");
    expect(formatPrice(24900)).toBe("R$ 249,00");
  });

  it("says Grátis rather than R$ 0,00", () => {
    expect(formatPrice(0)).toBe("Grátis");
  });

  it("says nothing for a tier with no price on record", () => {
    // A custom or retired key — inventing "R$ 0,00" would read as free.
    expect(formatPrice(null)).toBeNull();
  });
});
