import { describe, expect, it } from "vitest";

import type { EntitlementDecision } from "../../core/types";

import {
  collectFlags,
  describeLoss,
  diffDecisions,
  parseGatePolicy,
  summarizeDiff,
  type TenantDiff,
} from "../plan-diff";

/**
 * The release gate reports only what a tenant would LOSE, resolved
 * through the real engine rather than the tier table.
 */
function decision(
  over: Partial<EntitlementDecision<string>> & { feature: string },
): EntitlementDecision<string> {
  return {
    enabled: true,
    reason: "enabled",
    policy: "hide",
    limit: null,
    requiredPlan: null,
    ...over,
  };
}

/** A decision map from `[feature, enabled, limit]` triples. */
function map(
  entries: readonly [string, boolean, (number | "unlimited" | null)?][],
): Record<string, EntitlementDecision<string>> {
  return Object.fromEntries(
    entries.map(([feature, enabled, limit = null]) => [
      feature,
      decision({ feature, enabled, limit, reason: enabled ? "enabled" : "not-entitled" }),
    ]),
  );
}

describe("diffDecisions", () => {
  it("reports nothing when every capability survives", () => {
    const same = map([["a", true], ["b", true, 5]]);
    expect(diffDecisions(same, same)).toEqual([]);
  });

  it("reports a capability that disappears", () => {
    const losses = diffDecisions(map([["a", true]]), map([["a", false]]));
    expect(losses).toHaveLength(1);
    expect(losses[0]?.kind).toBe("revoked");
  });

  it("reports a ceiling that drops", () => {
    const losses = diffDecisions(map([["a", true, 100]]), map([["a", true, 20]]));
    expect(losses[0]).toMatchObject({ kind: "narrowed", before: 100, after: 20 });
  });

  it("treats losing `unlimited` for a number as narrowing", () => {
    // The commonest real downgrade, and one a naive `<` on the raw values gets
    // wrong — "unlimited" is not a number.
    const losses = diffDecisions(map([["a", true, "unlimited"]]), map([["a", true, 100]]));
    expect(losses[0]).toMatchObject({ kind: "narrowed", before: "unlimited", after: 100 });
  });

  it("says nothing when a ceiling RISES", () => {
    expect(diffDecisions(map([["a", true, 20]]), map([["a", true, 100]]))).toEqual([]);
    expect(diffDecisions(map([["a", true, 20]]), map([["a", true, "unlimited"]]))).toEqual([]);
  });

  it("says nothing when a capability is GAINED", () => {
    // Gaining a feature never blocks a release, so it is not the gate's business.
    expect(diffDecisions(map([["a", false]]), map([["a", true]]))).toEqual([]);
  });

  it("says nothing about a feature the tenant could not reach anyway", () => {
    // Already off before the change — there is nothing to lose, whatever the
    // new tier says. This is what stops the gate reporting phantom losses for
    // every feature a tenant had switched off themselves.
    expect(diffDecisions(map([["a", false]]), map([["a", false]]))).toEqual([]);
  });

  it("ignores a feature the new catalog no longer declares", () => {
    // A retired key is a catalog change, not something this tier did to this
    // tenant. Reporting it would bury the real losses every time one is dropped.
    expect(diffDecisions(map([["gone", true]]), {})).toEqual([]);
  });

  it("orders vanished surfaces before tightened ceilings", () => {
    const losses = diffDecisions(
      map([["zeta", true, 100], ["alpha", true]]),
      map([["zeta", true, 5], ["alpha", false]]),
    );
    expect(losses.map((l) => l.feature)).toEqual(["alpha", "zeta"]);
  });

  it("carries the revoke policy, because the two fates are not the same", () => {
    // `readonly` keeps their data and blocks growth; `hide` takes the surface
    // away. Collapsing them would make every loss read as equally alarming.
    const before = map([["a", true]]);
    const after = { a: decision({ feature: "a", enabled: false, policy: "readonly" }) };
    expect(diffDecisions(before, after)[0]?.policy).toBe("readonly");
  });

  it("carries the tier that would give it back", () => {
    const before = map([["a", true]]);
    const after = { a: decision({ feature: "a", enabled: false, requiredPlan: "pro" }) };
    expect(diffDecisions(before, after)[0]?.requiredPlan).toBe("pro");
  });
});

describe("describeLoss", () => {
  it("says the data survives for a readonly revoke", () => {
    const line = describeLoss({
      feature: "stations.online",
      kind: "revoked",
      before: null,
      after: null,
      policy: "readonly",
      requiredPlan: "pro",
    });
    expect(line).toContain("mantém o que já tem");
    expect(line).toContain("pro");
  });

  it("says the surface disappears for a hide revoke", () => {
    const line = describeLoss({
      feature: "alerts.digest",
      kind: "revoked",
      before: null,
      after: null,
      policy: "hide",
      requiredPlan: null,
    });
    expect(line).toContain("a área some");
    // No plan would give it back, so it must not dangle an upsell.
    expect(line).not.toContain("volta no");
  });

  it("shows both ends of a narrowed ceiling", () => {
    const line = describeLoss({
      feature: "stations.online",
      kind: "narrowed",
      before: "unlimited",
      after: 100,
      policy: "readonly",
      requiredPlan: null,
    });
    expect(line).toContain("unlimited → 100");
  });
});

describe("summarizeDiff", () => {
  const diff = (slug: string, losses: number): TenantDiff => ({
    clientId: `id-${slug}`,
    slug,
    from: "free",
    to: "basic",
    losses: Array.from({ length: losses }, (_, i) => ({
      feature: `f${i}`,
      kind: "revoked" as const,
      before: null,
      after: null,
      policy: "hide" as const,
      requiredPlan: null,
    })),
  });

  it("reports a clean fleet as zero losing", () => {
    const summary = summarizeDiff([diff("a", 0), diff("b", 0)]);
    expect(summary).toEqual({ tenants: 2, losing: 0, losses: 0 });
  });

  it("counts tenants and losses separately", () => {
    // One tenant losing three things is a different conversation from three
    // tenants losing one each, so the headline must not conflate them.
    const summary = summarizeDiff([diff("a", 3), diff("b", 0), diff("c", 1)]);
    expect(summary).toEqual({ tenants: 3, losing: 2, losses: 4 });
  });
});

describe("collectFlags", () => {
  it("reads both spellings the same way", () => {
    expect(collectFlags(["--tier", "pro"]).get("--tier")).toEqual(["pro"]);
    expect(collectFlags(["--tier=pro"]).get("--tier")).toEqual(["pro"]);
  });

  it("keeps every occurrence rather than the first", () => {
    expect(collectFlags(["--tier", "basic", "--tier=pro"]).get("--tier")).toEqual([
      "basic",
      "pro",
    ]);
  });

  it("distinguishes a valueless flag from an absent one", () => {
    // The distinction the earlier ad-hoc parsing could not make, and the reason
    // `--by-usage --tier` slipped through as by-usage.
    expect(collectFlags(["--tier"]).get("--tier")).toEqual([undefined]);
    expect(collectFlags([]).has("--tier")).toBe(false);
  });

  it("does not swallow the next FLAG as a value", () => {
    const flags = collectFlags(["--tier", "--json"]);
    expect(flags.get("--tier")).toEqual([undefined]);
    expect(flags.has("--json")).toBe(true);
  });

  it("records a bare switch with no value", () => {
    expect(collectFlags(["--by-usage"]).get("--by-usage")).toEqual([undefined]);
  });

  it("accepts an empty value in the equals form without losing the flag", () => {
    expect(collectFlags(["--tier="]).get("--tier")).toEqual([""]);
  });
});

describe("parseGatePolicy", () => {
  const isTier = (v: string | undefined): boolean => v === "basic" || v === "pro";
  const parse = (argv: string[]): unknown => parseGatePolicy(collectFlags(argv), isTier);

  it("accepts by-usage on its own", () => {
    expect(parse(["--by-usage"])).toEqual({ kind: "by-usage", label: "by-usage" });
  });

  it("accepts a cutover in either spelling, labelled with the tier", () => {
    // The label lands in the artifact, so it has to name the tier — "cutover"
    // alone would not say which rollout was validated.
    const expected = { kind: "cutover", tier: "pro", label: "cutover:pro" };
    expect(parse(["--tier", "pro"])).toEqual(expected);
    expect(parse(["--tier=pro"])).toEqual(expected);
  });

  it("REFUSES two policies at once, in every spelling", () => {
    // A clean artifact for by-usage, handed to someone who believes the
    // fixed-tier rollout was validated, is evidence for the wrong question.
    expect(parse(["--by-usage", "--tier", "pro"])).toBeNull();
    expect(parse(["--by-usage", "--tier=pro"])).toBeNull();
    expect(parse(["--by-usage", "--tier"])).toBeNull();
  });

  it("REFUSES a --by-usage that carries a value", () => {
    // A switch does not take one, so `--by-usage=pro` means the operator
    // believed it did — and would otherwise get a by-usage artifact for what
    // they thought was a cutover request.
    expect(parse(["--by-usage=pro"])).toBeNull();
    expect(parse(["--by-usage=" ])).toBeNull();
  });

  it("REFUSES a repeated --by-usage", () => {
    expect(parse(["--by-usage", "--by-usage"])).toBeNull();
  });

  it("REFUSES a repeated --tier rather than taking the first", () => {
    expect(parse(["--tier", "basic", "--tier", "pro"])).toBeNull();
    expect(parse(["--tier=basic", "--tier=pro"])).toBeNull();
  });

  it("refuses a valueless --tier on its own", () => {
    expect(parse(["--tier"])).toBeNull();
    expect(parse(["--tier="])).toBeNull();
  });

  it("refuses neither, and an unknown tier", () => {
    expect(parse([])).toBeNull();
    expect(parse(["--tier", "bogus"])).toBeNull();
    expect(parse(["--tier=bogus"])).toBeNull();
  });

  it("is unbothered by other flags", () => {
    expect(parse(["--json", "--tier=pro"])).toEqual({
      kind: "cutover",
      tier: "pro",
      label: "cutover:pro",
    });
  });
});
