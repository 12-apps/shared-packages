import type { WireRequest, WireResponse, WireRoute } from "@12-apps/wiring";

import type { IngestionTarget } from "../core/integration";
import type { MarketplaceApiConfig } from "./http";

/**
 * `POST /webhooks/marketplace/:tenantSlug/:provider` — inbound deliveries for
 * ONE store, from any registered marketplace.
 *
 * PUBLIC by design (`kind: "webhook"`): a marketplace cannot authenticate as a
 * user. The store is attributed from the URL slug, then the delivery is
 * verified against THAT store's secret, through the provider's own adapter
 * (which header carries the signature, and how it is computed) — the route
 * itself knows no marketplace.
 *
 * It answers 2xx for almost everything, deliberately. A marketplace
 * redelivers on any non-2xx, so the only failures worth signalling are the
 * ones a redelivery could fix: a genuine processing failure answers 500, and
 * the inbox row it left is retried by the sweep regardless. Refusals (unknown
 * slug, no connection, bad signature) answer 401, indistinguishably, so a
 * prober cannot learn which stores exist. The bodies are machine codes: the
 * reader is a server, not a person.
 */

const UNAUTHORIZED: WireResponse = { status: 401, body: { error: "unauthorized" } };

/**
 * The tenant the slug names and its connection to this marketplace, or the
 * 401 that ends the request. A blob that will not open is a 401 too, logged:
 * a key problem must never read as "no secret configured".
 */
async function connectionOf(
  config: MarketplaceApiConfig,
  tenantSlug: string,
  provider: string,
): Promise<{ clientId: string; target: IngestionTarget } | WireResponse> {
  const clientId = await config.tenantBySlug(tenantSlug);
  if (!clientId) {
    config.logger.warn(`marketplace.webhook: unknown tenant slug "${tenantSlug}" (${provider})`);
    return UNAUTHORIZED;
  }
  try {
    const target = await config.engine.target(clientId, provider);
    // No connection at all: refused rather than stored — without one there is
    // no secret to verify against.
    return target ? { clientId, target } : UNAUTHORIZED;
  } catch (error) {
    config.logger.error(
      `marketplace.webhook: ${tenantSlug} ${provider} credentials do not open: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return UNAUTHORIZED;
  }
}

/** The verified, parsed delivery, or the answer that ends the request. */
async function admit(
  config: MarketplaceApiConfig,
  request: WireRequest<unknown>,
): Promise<{ clientId: string; provider: string; payload: unknown; target: IngestionTarget } | WireResponse> {
  const { tenantSlug = "", provider = "" } = request.params;
  const { engine } = config;
  if (!engine.knows(provider)) return { status: 404, body: { error: "unknown_provider" } };
  const raw = request.request;
  if (!raw) return { status: 400, body: { error: "raw_request_required" } };

  const connection = await connectionOf(config, tenantSlug, provider);
  if ("status" in connection) return connection;
  const rawBody = await raw.text();
  const signature = engine.readSignature(provider, (name) => raw.headers.get(name));
  if (!engine.verifySignature(provider, rawBody, signature, connection.target.webhookSecret)) {
    config.logger.warn(`marketplace.webhook: ${tenantSlug} ${provider} signature rejected`);
    return UNAUTHORIZED;
  }
  try {
    return { ...connection, provider, payload: JSON.parse(rawBody) as unknown };
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
}

/** Record and act on one verified delivery. */
async function handleWebhook(config: MarketplaceApiConfig, request: WireRequest<unknown>): Promise<WireResponse> {
  const admitted = await admit(config, request);
  if ("status" in admitted) return admitted;
  const { clientId, provider, payload, target } = admitted;
  const { engine } = config;

  const event = engine.normalize(provider, payload);
  if (!event) {
    // Nothing the adapter can key on. 200: redelivering an unreadable payload
    // produces an identical unreadable payload.
    config.logger.warn(`marketplace.webhook: ${provider} payload did not normalize`);
    return { status: 200, body: { received: true, ignored: "unrecognized_payload" } };
  }
  const outcome = await engine.deliver({
    clientId,
    event,
    payload,
    // A DISABLED connection still stores its deliveries and ingests nothing;
    // the retry sweep ingests them if the store turns it back on.
    settings: target.enabled ? { autoAccept: target.autoAccept, ackSlaSeconds: target.ackSlaSeconds } : null,
  });
  if (outcome.kind === "failed") {
    return { status: 500, body: { received: true, error: outcome.reason } };
  }
  return { status: 200, body: { received: true, outcome: outcome.kind } };
}

/** The webhook descriptor. Raw body required: signatures are computed over bytes. */
export function webhookRoute(config: MarketplaceApiConfig): WireRoute<unknown> {
  return {
    method: "POST",
    path: "/webhooks/marketplace/:tenantSlug/:provider",
    kind: "webhook",
    handle: (request) => handleWebhook(config, request),
  };
}
