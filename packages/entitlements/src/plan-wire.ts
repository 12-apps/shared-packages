/**
 * The wire shapes the plan surface serves and the SPA renders — types and pure
 * parsers only, importable from BOTH entries (`./server` builds them, `./react`
 * renders them). One module, so the two halves of the contract cannot drift.
 *
 * Money appears here only as DISPLAY DATA a host's billing already computed
 * (`priceCents`, a formatted `price` string). The package stores no price,
 * computes no charge and owns no billing model — `Plan`, `Subscription` and
 * the plan-change lead are the HOST's tables, reached through ports.
 */

/** The reasons a store can be shown (`not-supported` rows are dropped). */
export type TenantFeatureReason =
  | 'enabled'
  | 'not-entitled'
  | 'disabled-by-tenant'
  | 'restricted'
  | 'suspended';

/** One capability as the STORE should read it. */
export interface TenantFeatureView {
  feature: string;
  description: string | null;
  enabled: boolean;
  /** Why it reads the way it does, phrased for a customer. */
  note: string;
  /**
   * Branch on this, never on `note`: `disabled-by-tenant` is the only denial
   * the store fixes themselves, and it is the row that earns a link to the
   * settings screen holding the switch.
   */
  reason: TenantFeatureReason;
  limit: number | 'unlimited' | null;
  /** Live usage, when the feature is a quota the server measured. */
  used: number | null;
  /** The cheapest tier that would turn this on — only when upgrading helps. */
  requiredPlan: string | null;
  /** That tier's COMMERCIAL name — the raw key must never face a customer. */
  requiredPlanLabel: string | null;
}

/** The whole answer to "what am I on, and what do I get". */
export interface TenantPlanView {
  planKey: string;
  name: string;
  priceCents: number | null;
  /** Already formatted (`"R$ 59,00"` / `"Grátis"`), or null when unpriced. */
  price: string | null;
  features: TenantFeatureView[];
}

/** One line on a pricing card. */
export interface ComparisonLine {
  label: string;
  included: boolean;
  /** `"até 100"` / `"ilimitado"`, or null for a plain on/off capability. */
  detail: string | null;
}

/** A titled block within a card. */
export interface ComparisonSection {
  title: string;
  lines: ComparisonLine[];
}

/** One pricing card — a tier as a store compares it. */
export interface ComparisonTier {
  key: string;
  name: string;
  priceCents: number | null;
  price: string | null;
  /** What this tier is FOR — the question a feature list cannot answer. */
  pitch: string;
  headline: string;
  headlineUnit: string;
  current: boolean;
  /** Costs more than the store's tier, so it can be asked for. */
  upgrade: boolean;
  recommended: boolean;
  sections: ComparisonSection[];
}

/** The plan screen's whole payload: the store's status AND the comparison. */
export interface TenantPlanPayload extends TenantPlanView {
  comparison: ComparisonTier[];
}

/** The store's open plan-change request, or null when nobody has asked. */
export interface OpenPlanRequest {
  id: string;
  requestedPlanKey: string;
  createdAt: string;
}

/** `POST plan/request` — the ask, as the client sends it. */
export interface PlanChangeRequestBody {
  requestedPlan: string;
  /** The feature whose denial prompted the ask, when one did. */
  feature?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// The 402 body, parsed — the reactive half of the upsell surface
// ---------------------------------------------------------------------------

/**
 * Why a surface is locked. Mirrors the entitlement reasons the wire can carry,
 * plus `quota-exceeded` (a 402 whose decision reason is `enabled` — the
 * feature is owned, its ceiling is spent). Upsell copy branches on this, and
 * ONLY the plan-gap reasons may render an upgrade CTA.
 */
export type UpsellReason =
  | 'not-entitled'
  | 'quota-exceeded'
  | 'restricted'
  | 'suspended'
  | 'disabled-by-tenant';

/** What a raised upsell tells the prompt surface. */
export interface UpsellPrompt {
  feature: string;
  /** The cheapest plan that would grant it — null when no upgrade fixes it. */
  requiredPlan: string | null;
  reason: UpsellReason;
  /** Present for `quota-exceeded` only. */
  quota?: { used: number; limit: number | 'unlimited' | null };
}

/** The machine half of the 402 body (see `server/wire.ts`, the producer). */
interface PaymentRequiredBody {
  code?: unknown;
  feature?: unknown;
  reason?: unknown;
  requiredPlan?: unknown;
  used?: unknown;
  limit?: unknown;
}

const ENTITLEMENT_REASONS: readonly UpsellReason[] = [
  'not-entitled',
  'restricted',
  'suspended',
];

function entitlementReasonOf(raw: unknown): UpsellReason {
  const match = ENTITLEMENT_REASONS.find((reason) => reason === raw);
  // An unrecognized reason on a genuine 402 still IS a plan denial — the
  // upgrade-pitch branch is the safe default for the status.
  return match ?? 'not-entitled';
}

function quotaOf(body: PaymentRequiredBody): UpsellPrompt['quota'] {
  const limit =
    typeof body.limit === 'number' || body.limit === 'unlimited' ? body.limit : null;
  return { used: typeof body.used === 'number' ? body.used : 0, limit };
}

/**
 * Map a failed request to an upsell prompt, or `null` for everything that is
 * not a plan denial. Deliberately parses the 402 BODY rather than consulting a
 * (possibly stale) snapshot — the body is self-sufficient. Only status 402
 * with the two entitlement codes qualifies: `disabled-by-tenant` arrives as a
 * 409 and `not-supported` as a 404, and neither is something to sell.
 */
export function upsellPromptFromPaymentRequired(
  status: number,
  rawBody: unknown,
): UpsellPrompt | null {
  if (status !== 402) return null;
  const body = (rawBody ?? {}) as PaymentRequiredBody;
  if (typeof body.feature !== 'string' || body.feature === '') return null;
  if (body.code !== 'entitlement_required' && body.code !== 'quota_exceeded') return null;

  const requiredPlan = typeof body.requiredPlan === 'string' ? body.requiredPlan : null;
  if (body.code === 'quota_exceeded') {
    return { feature: body.feature, requiredPlan, reason: 'quota-exceeded', quota: quotaOf(body) };
  }
  return { feature: body.feature, requiredPlan, reason: entitlementReasonOf(body.reason) };
}
