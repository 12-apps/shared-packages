import type {
  ChargeStore,
  WebhookAttemptSource,
  WebhookEventHandler,
  WebhookInbox,
} from './ports';
import type {
  MerchantRef,
  NormalizedWebhookEvent,
  ProviderName,
  ResolvedCredentials,
  WebhookDelivery,
} from './types';
import type { CredentialStore } from './ports';
import type { PaymentProviderAdapter } from './provider';
import { CredentialsError, WebhookVerificationError } from './errors';

/**
 * The POST-VERIFICATION half of the inbound webhook pipeline — record, apply,
 * notify, settle — factored out so the two ways a delivery can reach it run
 * the identical sequence:
 *
 *   - the live path (`gateway.handleWebhook`), which verifies the signature
 *     and parses the body first;
 *   - the replay sweep (`webhook-replay.ts`), which re-reads rows THIS
 *     function recorded and re-parses their stored bodies.
 *
 * Sharing it is not DRY for its own sake. The sequence encodes the money
 * invariants (dedup on settled-only, ownership-scoped upsert, mark-failed
 * before rethrowing); a replay that reimplemented it would be a second,
 * quietly diverging definition of "apply a webhook", and the copy that drifts
 * is the one that runs when something has already gone wrong.
 */

/** Ports the ingest needs — a structural subset of `PaymentsGatewayConfig`. */
interface WebhookIngestDeps {
  charges: ChargeStore;
  webhooks: WebhookInbox;
  onWebhookEvent?: WebhookEventHandler;
}

/**
 * A failure, boxed. The box exists so `failure` can be tested for PRESENCE
 * without inspecting the value: a handler that throws `undefined` (or an empty
 * string, or 0) would be indistinguishable from success under a bare
 * `unknown | undefined` field, and "the host handler threw a falsy value" is
 * not a case worth silently reporting as an applied charge.
 */
interface WebhookIngestFailure {
  readonly error: unknown;
}

interface WebhookIngestOutcome {
  /** Events applied and settled by THIS call, in delivery order. */
  processed: NormalizedWebhookEvent[];
  /**
   * Set when the ingest stopped on a failure. RETURNED rather than thrown
   * because the two callers need opposite things from it: the live path
   * rethrows (the provider must see a non-2xx and redeliver), while the sweep
   * logs it and moves to the next row.
   *
   * When this is set the inbox row is ALREADY marked FAILED and its attempt
   * already counted — a caller must not mark it again, or one sweep pass would
   * burn two of the row's bounded attempts and halve its retry budget.
   */
  failure?: WebhookIngestFailure;
}

/**
 * @param source which path is running this ingest. It is REQUIRED, and not
 * defaulted, because it decides whose retry budget a failure spends: the two
 * callers are bounded by unrelated things (see `WebhookAttemptSource`), and a
 * default would silently pick one of them for whichever caller is added next.
 */
export async function ingestWebhookEvents(
  deps: WebhookIngestDeps,
  merchant: MerchantRef,
  delivery: WebhookDelivery,
  events: readonly NormalizedWebhookEvent[],
  source: WebhookAttemptSource,
): Promise<WebhookIngestOutcome> {
  const processed: NormalizedWebhookEvent[] = [];
  for (const event of events) {
    const { id, duplicate, settled } = await deps.webhooks.record(merchant, delivery, event.eventId);
    // Skip only a delivery that was already APPLIED. A previous attempt that
    // failed mid-handler must be retryable: the provider's redelivery — and
    // now the replay sweep — is the only recovery path, and swallowing it
    // strands the charge.
    //
    // Note this check reads the row as it is RIGHT NOW, not as some earlier
    // query saw it. That is what makes the same guard also close the replay
    // sweep's read-then-write window (see `webhook-replay.ts`).
    if (duplicate && settled) continue;
    try {
      const charge = event.charge
        ? await deps.charges.upsertByProviderChargeId(merchant, event.charge)
        : null;
      await deps.onWebhookEvent?.(event, charge, merchant);
      await deps.webhooks.markProcessed(id);
      processed.push(event);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await deps.webhooks.markFailed(id, detail, source);
      return { processed, failure: { error } };
    }
  }
  return { processed };
}

/** What a resolved inbound delivery needs: which adapter, and which secrets. */
interface ListeningTarget {
  adapter: PaymentProviderAdapter;
  creds: ResolvedCredentials;
}

/**
 * Resolve an adapter + the CANDIDATE credential sets for an INBOUND delivery.
 *
 * Listening is not routing. Enablement decides where a NEW charge goes; a
 * delivery is about money that has ALREADY moved, so refusing one because the
 * provider is not in the failover chain loses information we cannot get back.
 * The single gate cost money twice: every ACTIVATION confirmation was rejected
 * (the provider is by definition not yet enabled — enabling is what the charge
 * earns), and an owner pausing a provider with a payment outstanding had its
 * notifications refused so the order never confirmed. Neither left a trace,
 * because verification precedes the inbox.
 *
 * Several sets, not one, for the same before-the-inbox reason (FUT-678): a
 * store flipped SANDBOX→PRODUCTION still has deliveries in flight signed under
 * the environment it just left, and a verify that only knows the active
 * secret rejects them before anything durable exists. The store answers with
 * every environment's credentials (`listListeningCredentials`, active first);
 * hosts without that method keep exactly the single-set behaviour.
 *
 * Falls back to the charging lookup when a host has implemented neither
 * listening read, so nobody silently loses their enablement gate by upgrading.
 */
async function resolveForListening(
  deps: {
    providers: { get(provider: ProviderName): PaymentProviderAdapter };
    credentials: CredentialStore;
  },
  chargingFallback: () => Promise<ListeningTarget>,
  merchant: MerchantRef,
  provider: ProviderName,
): Promise<{ adapter: PaymentProviderAdapter; candidates: ResolvedCredentials[] }> {
  const notConnected = () =>
    new CredentialsError(
      provider,
      `Provider ${provider} is not connected for ${merchant.kind}:${merchant.id}`,
    );

  const listAll = deps.credentials.listListeningCredentials;
  if (listAll) {
    const candidates = await listAll.call(deps.credentials, merchant, provider);
    if (candidates.length === 0) throw notConnected();
    return { adapter: deps.providers.get(provider), candidates };
  }

  const listen = deps.credentials.getConnectedCredentials;
  if (!listen) {
    const target = await chargingFallback();
    return { adapter: target.adapter, candidates: [target.creds] };
  }

  const creds = await listen.call(deps.credentials, merchant, provider);
  if (!creds) throw notConnected();
  return { adapter: deps.providers.get(provider), candidates: [creds] };
}

/**
 * The first candidate credential set `webhook.verify` accepts the delivery
 * under, or null when none does. Sequential on purpose — candidates are
 * ordered (active environment first) and, for an unsigned provider whose
 * verify is a live call back to it, one confirmation is all that may be spent.
 *
 * Shared by the live path and the replay sweep so "which secret authenticates
 * a delivery" has exactly one definition — the sweep re-verifies stored rows,
 * and a copy that drifted would re-reject precisely the flipped-environment
 * rows this exists to keep.
 */
export async function verifiedCredentials(
  adapter: PaymentProviderAdapter,
  delivery: WebhookDelivery,
  candidates: readonly ResolvedCredentials[],
): Promise<ResolvedCredentials | null> {
  for (const creds of candidates) {
    if (await adapter.webhook.verify(delivery, creds)) return creds;
  }
  return null;
}

/**
 * The LIVE inbound path: verify the signature, parse, then hand off to the
 * shared post-verification ingest.
 *
 * The replay sweep runs the same verify → parse pair over stored rows, which is
 * why the two share only the ingest below rather than the whole sequence: this
 * one has a merchant and an arbitrary body handed to it by an HTTP request,
 * that one re-reads bytes the inbox already holds. A failure here is charged to
 * the LIVE budget — the provider's redeliveries must not spend the sweep's.
 */
export async function runWebhookPipeline(
  deps: WebhookIngestDeps & {
    providers: { get(provider: ProviderName): PaymentProviderAdapter };
    credentials: CredentialStore;
  },
  chargingFallback: (provider: ProviderName) => Promise<ListeningTarget>,
  merchant: MerchantRef,
  delivery: WebhookDelivery,
): Promise<NormalizedWebhookEvent[]> {
  // LISTENING, not routing — see `resolveForListening` for what the single
  // gate cost, and why a refusal here left no trace of any kind.
  const { adapter, candidates } = await resolveForListening(
    deps,
    () => chargingFallback(delivery.provider),
    merchant,
    delivery.provider,
  );
  const creds = await verifiedCredentials(adapter, delivery, candidates);
  if (!creds) throw new WebhookVerificationError(adapter.name);

  // Parsed under the credentials that VERIFIED it — for an adapter whose parse
  // re-reads the provider (unsigned deliveries), the environment that signed
  // is the one that must be asked.
  const events = await adapter.webhook.parse(delivery, creds);
  const outcome = await ingestWebhookEvents(deps, merchant, delivery, events, 'LIVE');
  // Rethrown verbatim, exactly as this function always did: the HTTP layer
  // turns it into a non-2xx so the provider redelivers, and the inbox row is
  // already FAILED with its attempt counted.
  if (outcome.failure) throw outcome.failure.error;
  return outcome.processed;
}
