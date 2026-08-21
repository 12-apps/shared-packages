/**
 * What would a tenant LOSE if their tier changed? — the release gate for
 * enforcing a plan catalog on a fleet that grew up without one.
 *
 * ## Why this is not `plan-impact.ts`
 *
 * That module measures usage against the catalog's RAW per-tier ceilings
 * (derived from the plan catalog, nothing layered on top) and answers "is this
 * tenant over a ceiling". Useful for choosing a tier; wrong for deciding
 * whether it is safe to enforce one.
 *
 * This module asks the RESOLVER instead. That matters because the resolver has
 * three layers the raw ladder knows nothing about:
 *
 *   - a platform **override** can keep a feature alive on a tier that does not
 *     include it, so the raw ladder reports a loss the tenant would never feel;
 *   - a **tenant setting** can have the feature switched off already, so there
 *     is nothing to lose;
 *   - a lifecycle **status** can be suppressing it regardless of tier.
 *
 * Where the two disagree, the resolver is right — it is the thing that will
 * actually run at the gate. "Zero unintended losses" has to be measured
 * against the code that enforces, not against the ladder's raw ceilings alone.
 *
 * Pure on purpose: it takes two already-resolved decision maps and compares
 * them, so it can be unit-tested without a database and reused for any
 * before/after pair (a tier change, an override edit, a catalog change).
 */
import type { EntitlementDecision, RevokePolicy } from '../core/types';
import type { PlanDiffMessages } from './copy';

/** How a capability got smaller. */
type LossKind =
  /** Reachable before, not reachable after. The surface goes away. */
  | 'revoked'
  /** Still reachable, but the ceiling dropped — they cannot grow as far. */
  | 'narrowed';

/** One capability a tenant would lose, and what it would cost them. */
export interface FeatureLoss {
  feature: string;
  kind: LossKind;
  /** The ceiling before/after: a number, `"unlimited"`, or `null` for booleans. */
  before: number | 'unlimited' | null;
  after: number | 'unlimited' | null;
  /**
   * What happens to data they already have. `readonly` keeps it and blocks
   * growth; `hide` takes the surface away entirely. Carried because the two
   * are completely different conversations with a customer, and a gate that
   * collapsed them would make every loss look equally alarming.
   */
  policy: RevokePolicy;
  /** The cheapest tier that would give it back, when one would. */
  requiredPlan: string | null;
}

/**
 * `unlimited` sorts above every number; `null` (a boolean feature) has no
 * ceiling to compare, so it is only ever judged by `enabled`.
 */
function ceiling(limit: number | 'unlimited' | null): number {
  if (limit === 'unlimited') return Number.POSITIVE_INFINITY;
  return limit ?? Number.POSITIVE_INFINITY;
}

/**
 * Every capability that shrinks going from `before` to `after`.
 *
 * Only losses. A tier change that GRANTS something is not the gate's business —
 * the question it answers is whether enforcing is safe, and gaining a feature
 * never blocks a release.
 *
 * Features absent from `after` are skipped rather than reported as revoked: a
 * key the new catalog no longer declares is a catalog change, not something
 * this tenant's tier did to them, and reporting it here would bury the real
 * losses under noise every time a feature is retired.
 */
export function diffDecisions(
  before: Readonly<Record<string, EntitlementDecision<string>>>,
  after: Readonly<Record<string, EntitlementDecision<string>>>,
): FeatureLoss[] {
  const losses: FeatureLoss[] = [];

  for (const [feature, was] of Object.entries(before)) {
    const now = after[feature];
    if (!now) continue;
    if (!was.enabled) continue; // nothing to lose — they could not reach it anyway

    if (!now.enabled) {
      losses.push({
        feature,
        kind: 'revoked',
        before: was.limit,
        after: now.limit,
        policy: now.policy,
        requiredPlan: now.requiredPlan,
      });
      continue;
    }
    if (ceiling(now.limit) < ceiling(was.limit)) {
      losses.push({
        feature,
        kind: 'narrowed',
        before: was.limit,
        after: now.limit,
        policy: now.policy,
        requiredPlan: now.requiredPlan,
      });
    }
  }

  // A vanished surface outranks a tightened ceiling; within a kind,
  // alphabetical so two runs of the gate produce comparable artifacts.
  return losses.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'revoked' ? -1 : 1;
    return a.feature.localeCompare(b.feature);
  });
}

/** One tenant's line in the gate's report. */
export interface TenantDiff {
  clientId: string;
  slug: string;
  /** The tier they are on now, and the one being proposed. */
  from: string;
  to: string;
  losses: FeatureLoss[];
}

/**
 * Render one loss the way an operator needs to read it: what goes, and whether
 * their data goes with it. The sentence is the HOST's (`messages.lossLine`, a
 * factory of the whole loss — the pack satisfies it): what to say about a
 * `readonly` versus a `hide` revoke is wording, and the wording used to be
 * compiled in. What stays here is the contract that one loss is one line.
 */
export function describeLoss(loss: FeatureLoss, messages: PlanDiffMessages): string {
  return messages.lossLine(loss);
}

/**
 * The gate's verdict. Zero losses across the fleet is the release condition;
 * anything else is the list somebody has to sign off on first.
 */
export function summarizeDiff(diffs: readonly TenantDiff[]): {
  tenants: number;
  losing: number;
  losses: number;
} {
  const losing = diffs.filter((diff) => diff.losses.length > 0);
  return {
    tenants: diffs.length,
    losing: losing.length,
    losses: losing.reduce((total, diff) => total + diff.losses.length, 0),
  };
}

/** The gate's two questions, and the label that goes in the artifact. */
type GatePolicy =
  | { kind: 'by-usage'; label: 'by-usage' }
  | { kind: 'cutover'; tier: string; label: string };

/**
 * Every `--flag` occurrence, with the value that followed it.
 *
 * Written because judging flags ad hoc kept producing the SAME defect in new
 * clothes — an artifact quietly answering a different question than the
 * invocation asked. Four shapes reached that outcome:
 *
 *   `--by-usage --tier`          value is `undefined`, reads as flag-absent
 *   `--tier basic --tier pro`    only the first value is seen
 *   `--tier=pro`                 not matched by an `arg === "--tier"` test
 *   `--by-usage --tier=pro`      the conflict is invisible for the same reason
 *
 * Collecting occurrences once, in both spellings, removes the class rather
 * than the instance. A flag with no value maps to `undefined` so "typed with
 * nothing after it" stays distinguishable from "never typed".
 */
export function collectFlags(argv: readonly string[]): Map<string, (string | undefined)[]> {
  const flags = new Map<string, (string | undefined)[]>();
  let index = 0;

  while (index < argv.length) {
    const token = argv[index] ?? '';
    index += 1;
    if (!token.startsWith('--')) continue; // a value already consumed, or stray

    const equals = token.indexOf('=');
    const name = equals === -1 ? token : token.slice(0, equals);
    let value = equals === -1 ? undefined : token.slice(equals + 1);

    // Space form: the next token is this flag's value unless it is a flag.
    if (equals === -1) {
      const next = argv[index];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        index += 1;
      }
    }
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return flags;
}

/**
 * A switch: typed exactly once, carrying nothing.
 *
 * `--by-usage=pro` means the operator believed it took a value;
 * `--by-usage --by-usage` that they lost track of what they typed. Either way
 * the invocation is not the one the artifact would claim to answer.
 */
function isBareSwitch(occurrences: readonly (string | undefined)[]): boolean {
  return occurrences.length === 1 && occurrences[0] === undefined;
}

/** The single value a flag carried, or `undefined` if absent, repeated, or bare. */
function onlyValue(occurrences: readonly (string | undefined)[]): string | undefined {
  return occurrences.length === 1 ? occurrences[0] : undefined;
}

/**
 * Parse the gate's policy, or `null` when the request is not answerable.
 *
 * Refuses anything ambiguous rather than picking for the operator. The output
 * is an artifact somebody attaches to a go/no-go decision, and one that
 * silently validated a different policy than was asked for is worse than no
 * artifact — they would hold evidence for the wrong question and not know it.
 */
export function parseGatePolicy(
  flags: ReadonlyMap<string, (string | undefined)[]>,
  isTier: (value: string | undefined) => boolean,
): GatePolicy | null {
  const usage = flags.get('--by-usage') ?? [];
  const tiers = flags.get('--tier') ?? [];

  if (usage.length > 0 && tiers.length > 0) return null; // two policies, one artifact
  if (usage.length > 0) {
    return isBareSwitch(usage) ? { kind: 'by-usage', label: 'by-usage' } : null;
  }

  const tier = onlyValue(tiers);
  if (tier === undefined || !isTier(tier)) return null;
  return { kind: 'cutover', tier, label: `cutover:${tier}` };
}
