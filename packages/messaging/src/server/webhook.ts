import type { WireRawResponse, WireRequest, WireResponse, WireRoute, WireRouteAnswer } from "@12-apps/wiring";

import type { MessagingEngine } from "../core/engine";
import { errorText } from "../core/errors";
import type { MessagingLogger } from "../core/ports";

/**
 * The webhook routes, one pair per channel the engine serves:
 *
 * - `GET  /webhooks/messaging/:channel` — the channel's subscription handshake;
 * - `POST /webhooks/messaging/:channel` — a delivery.
 *
 * ONE URL per channel, not per tenant: a channel like WhatsApp delivers every
 * connected account's events to the single callback configured on the app, so
 * the tenant cannot come from the path. It is resolved later, in the job, from
 * the event's own account id against the connections — and an account nobody
 * connected resolves to nobody.
 *
 * The POST, in order: refuse an unknown channel (404); verify the signature
 * over the RAW bytes, and on a bad one answer 401 and STORE NOTHING (fail
 * closed); persist the raw body; answer 200; the job processes it. Nothing is
 * parsed or resolved before the row exists. A store failure answers 500 so the
 * channel redelivers. Bodies are machine codes: the reader is a server.
 */

export interface MessagingApiConfig {
  /** The mounted engine (`createMessagingEngine`). */
  engine: Pick<MessagingEngine, "adapter" | "receive">;
  /** The manifest's `messaging` namespace. */
  logger: MessagingLogger;
}

const refuse = (status: number, error: string): WireResponse => ({ status, body: { error } });

function handshake(config: MessagingApiConfig, request: WireRequest<unknown>): WireRouteAnswer {
  const channel = request.params.channel ?? "";
  const adapter = config.engine.adapter(channel);
  if (!adapter) return refuse(404, "unknown_channel");
  const answer = adapter.handshake(request.query);
  if (!answer) return refuse(404, "no_handshake");
  if (!answer.ok) {
    config.logger.warn(`messaging.webhook: ${channel} handshake refused`);
    return refuse(403, "forbidden");
  }
  // The challenge is echoed as the bare body, which a JSON envelope would break.
  const raw: WireRawResponse = {
    response: new Response(answer.challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }),
  };
  return raw;
}

async function deliver(config: MessagingApiConfig, request: WireRequest<unknown>): Promise<WireResponse> {
  const channel = request.params.channel ?? "";
  const adapter = config.engine.adapter(channel);
  if (!adapter) return refuse(404, "unknown_channel");
  const raw = request.request;
  if (!raw) return refuse(400, "raw_request_required");

  const rawBody = await raw.text();
  if (!adapter.verify({ rawBody, header: (name) => raw.headers.get(name) })) {
    config.logger.warn(`messaging.webhook: ${channel} signature rejected`);
    return refuse(401, "unauthorized");
  }
  try {
    const { fresh } = await config.engine.receive(channel, rawBody);
    return { status: 200, body: { received: true, duplicate: !fresh } };
  } catch (error) {
    config.logger.error(`messaging.webhook: ${channel} delivery not stored: ${errorText(error)}`);
    return refuse(500, "not_stored");
  }
}

/** The two webhook descriptors. Public by design (`kind: "webhook"`): a channel cannot sign in. */
export function webhookRoutes(config: MessagingApiConfig): WireRoute<unknown, WireRouteAnswer>[] {
  return [
    {
      method: "GET",
      path: "/webhooks/messaging/:channel",
      kind: "webhook",
      handle: async (request) => handshake(config, request),
    },
    {
      method: "POST",
      path: "/webhooks/messaging/:channel",
      kind: "webhook",
      handle: (request) => deliver(config, request),
    },
  ];
}
