import type { WebhookPipelineObserver } from './webhook-pipeline';

/** The two levels these lines are written at — a host passes its own logger. */
export interface WebhookLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** How a request identified itself — enough to find it, nothing sensitive. */
export interface WebhookArrival {
  /** The store's slug, or the label of a platform route ("platform-homologacao"). */
  tenantSlug: string;
  provider: string;
  bytes: number;
}

/**
 * One log line per inbound payment webhook — arrival and outcome — plus the
 * one line that names which secret signed (FUT-678).
 *
 * A refused delivery leaves NO trace anywhere else: verification runs before
 * the durable inbox, so a refusal is never recorded, and the silence reads
 * exactly like "the provider never called us". These lines make "did they
 * call?" and "did we refuse them?" answerable separately. Refusals are WARN
 * rather than ERROR: a provider retrying a delivery already settled is
 * ordinary, and burying the interesting refusals under routine noise at ERROR
 * would recreate the problem from the other direction.
 *
 * Nothing sensitive is logged — never the body, the headers or a stack. The
 * signer line names a credential FIELD, never its value.
 *
 * Shared rather than host-written (FUT-3722): every host logs these same
 * lines, only through its own logger.
 */
export function createWebhookLog(log: WebhookLogger) {
  const signersSeen = new Set<string>();
  return {
    logWebhookArrival({ tenantSlug, provider, bytes }: WebhookArrival): void {
      log.info(`payments.webhook received: ${provider} for ${tenantSlug} (${bytes} bytes)`);
    },
    logWebhookAccepted(arrival: WebhookArrival, status: number): void {
      log.info(`payments.webhook accepted: ${arrival.provider} for ${arrival.tenantSlug} → ${status}`);
    },
    logWebhookRefused(arrival: WebhookArrival, reason: string): void {
      log.warn(`payments.webhook refused: ${arrival.provider} for ${arrival.tenantSlug} — ${reason}`);
    },
    /**
     * A delivery addressed to a store that does not exist. The RESPONSE stays
     * indistinguishable from a bad signature, so an unknown slug never tells a
     * prober which stores exist; the log may say it plainly, because a
     * misconfigured webhook URL is otherwise invisible.
     */
    logWebhookUnknownTenant(tenantSlug: string, provider: string): void {
      log.warn(`payments.webhook refused: ${provider} for unknown store "${tenantSlug}"`);
    },
    /**
     * Wire as `PaymentsGatewayConfig.webhookObserver`. Names which credential
     * field authenticated a provider's deliveries, once per provider and field
     * per process — WARN so it reaches the error tracker where the refusals
     * land, once so a store's ordinary traffic adds one line, not one per
     * delivery.
     */
    observer: {
      /** The pipeline's own refusal reason — the fields tried, never a value. */
      refused(provider: string, reason: string) {
        log.warn(`payments.webhook verify refused: ${provider} — ${reason}`);
      },
      accepted(provider: string, _events: number, signer?: string | null) {
        if (!signer) return;
        const key = `${provider}:${signer}`;
        if (signersSeen.has(key)) return;
        signersSeen.add(key);
        log.warn(`payments.webhook signer: ${provider} deliveries verify under ${signer}`);
      },
    } satisfies WebhookPipelineObserver,
  };
}
