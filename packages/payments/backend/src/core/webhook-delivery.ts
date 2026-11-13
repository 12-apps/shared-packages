import type { WebhookEventHandler } from './ports';

/**
 * What one live delivery may add to the gateway's own reaction (FUT-4864): a
 * second {@link WebhookEventHandler}, run after `onWebhookEvent` for each
 * event of THAT delivery, inside the same ingest — its failure fails the inbox
 * row and the provider redelivers, exactly as the gateway's handler's does.
 *
 * It exists so a host can bind a reaction from where it receives a webhook
 * (its route) instead of from where it builds the gateway: billing's
 * subscription refund reacts to a PLATFORM refund update this way. It is per
 * delivery, never stored: `replayWebhooks` runs only `onWebhookEvent`, so a
 * row this handler failed on is recovered by the provider's redelivery, and a
 * replay that settles it first skips that redelivery — a reaction bound here
 * must be one a later read can also reach (billing's confirmation sweep).
 */
export interface WebhookDeliveryOptions {
  onWebhookEvent?: WebhookEventHandler;
}

/** The gateway's config with one delivery's extra handler composed after its own. */
export function withDeliveryHandler<C extends { onWebhookEvent?: WebhookEventHandler }>(config: C, options?: WebhookDeliveryOptions): C {
  const extra = options?.onWebhookEvent;
  if (!extra) return config;
  const own = config.onWebhookEvent;
  return {
    ...config,
    onWebhookEvent: async (event, charge, merchant) => {
      await own?.(event, charge, merchant);
      await extra(event, charge, merchant);
    },
  };
}
