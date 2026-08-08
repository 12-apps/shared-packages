import type { ChargeSnapshot, ProviderName, RefundSnapshot } from './types';

/**
 * The webhook DELIVERY/EVENT shapes — their own module for the same reason as
 * `settlement-hints.ts` and `wallet-types.ts` (the size gate on
 * `core/types.ts`), and re-exported from there so every adapter and host keeps
 * importing them from `core/types`, the one door.
 */

/** An inbound webhook delivery exactly as the HTTP layer received it. */
export interface WebhookDelivery {
  provider: ProviderName;
  /** Raw body BYTES-as-string — signature checks need the unparsed body. */
  rawBody: string;
  /** Lower-cased header map. */
  headers: Record<string, string>;
}

/** Normalized event an adapter extracts from a verified webhook delivery. */
export interface NormalizedWebhookEvent {
  provider: ProviderName;
  /**
   * Provider-side unique id for THIS delivery/event — the inbox dedup key. A
   * provider that lacks one should hash the raw body.
   */
  eventId: string;
  /**
   * `DISPUTE_UPDATED` (FUT-477): a dispute the provider reported — money
   * HELD, not yet moved, so it carries neither snapshot; either would assert
   * an outcome the dispute has not reached. Its terminal outcomes arrive as
   * their own events (`REFUND_UPDATED` when the merchant loses). Hosts that
   * predate the member fall through their default branch, like `UNKNOWN`.
   */
  type: 'CHARGE_UPDATED' | 'REFUND_UPDATED' | 'DISPUTE_UPDATED' | 'UNKNOWN';
  /** Present when the event carries a charge state change. */
  charge?: ChargeSnapshot;
  /** Present when the event carries a refund state change. */
  refund?: RefundSnapshot;
  raw?: unknown;
}
