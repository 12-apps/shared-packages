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
/** How often one refusal reason may reach the error tracker: once per window per provider and reason. */
const WEBHOOK_REFUSAL_REPORT_WINDOW_MS = 15 * 60_000;

/** Test seams: the window and the clock. */
interface WebhookLogOptions {
  refusalWindowMs?: number;
  now?: () => number;
}

export function createWebhookLog(log: WebhookLogger, options: WebhookLogOptions = {}) {
  const signersSeen = new Set<string>();
  const refusalWindowMs = options.refusalWindowMs ?? WEBHOOK_REFUSAL_REPORT_WINDOW_MS;
  const now = options.now ?? Date.now;
  /** Per provider and reason: when it last reached WARN, and how many have gone to INFO since. */
  const refusals = new Map<string, { at: number; held: number }>();
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
      /**
       * The pipeline's own refusal reason — the fields tried, never a value.
       *
       * WARN once per window per provider and reason, INFO for the rest of the
       * window, with the count carried on the next WARN. A provider that keeps
       * delivering unsigned (PagBank without `x-authenticity-token`, 2,151 times
       * in 14 days) is one problem, and at one WARN each it filled the error
       * tracker's monthly quota on its own (FUT-3968). Every refusal is still
       * logged, at INFO.
       */
      refused(provider: string, reason: string) {
        const line = `payments.webhook verify refused: ${provider} — ${reason}`;
        const key = `${provider}\u0000${reason}`;
        const at = now();
        const seen = refusals.get(key);
        if (seen && at - seen.at < refusalWindowMs) {
          seen.held += 1;
          log.info(line);
          return;
        }
        const suffix = seen && seen.held > 0 ? ` (${seen.held} more since the last report)` : '';
        refusals.set(key, { at, held: 0 });
        log.warn(`${line}${suffix}`);
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
