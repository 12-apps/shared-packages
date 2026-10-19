import type { IntakeFreshness, NormalizedWebhookEvent, ResolvedCredentials, WebhookDelivery } from './types';

/**
 * An adapter's webhook handling — `PaymentProviderAdapter['webhook']`. Its own
 * module purely so `provider.ts` stays inside the size gate, the same reason
 * `settlement-hints.ts` is one.
 */
export interface ProviderWebhookHandling {
  verify(delivery: WebhookDelivery, credentials: ResolvedCredentials): Promise<boolean>;
  /**
   * Which credential FIELD authenticated a verified delivery (`'token'`,
   * `'platformWebhookSecret'`…), never its value — or null when none did.
   * Optional: an adapter with one possible secret has nothing to report. It
   * exists for a provider that does not document which account signs
   * (PagBank under Connect, FUT-678), so the first real delivery measures it.
   */
  signer?(delivery: WebhookDelivery, credentials: ResolvedCredentials): string | null;
  /**
   * Replay-tolerance for the LIVE intake path ONLY (FUT-690) — is this
   * delivery's signed timestamp within the provider's documented skew
   * window right now?
   *
   * A separate member, and NOT part of `verify`, is the design constraint:
   * the replay sweep re-runs `verify` over rows the inbox stored HOURS
   * earlier and must keep succeeding forever (see `webhook-replay.ts`), so
   * a skew window inside `verify` would re-reject exactly the stranded rows
   * that sweep exists to finish. Only `runWebhookPipeline` consults this,
   * before anything durable exists, and refuses a stale delivery the same
   * fail-closed way it refuses a bad signature.
   *
   * `nowMs` is a parameter so the policy is testable against a fixed clock;
   * the pipeline reads the real clock at its call site. Synchronous on
   * purpose — it is a header inspection, never a network call. Adapters
   * whose scheme carries no timestamp simply omit it.
   */
  intakeFreshness?(delivery: WebhookDelivery, nowMs: number): IntakeFreshness;
  /**
   * Credentials are passed because a body is not always its own authority:
   * an adapter for an UNSIGNED provider can only report an amount it re-read
   * from the provider, and the amount is load-bearing (a host's shortfall
   * guard compares it against what the order is worth). Adapters whose
   * deliveries are signed simply ignore the second argument.
   */
  parse(
    delivery: WebhookDelivery,
    credentials: ResolvedCredentials,
  ): Promise<NormalizedWebhookEvent[]>;
}
