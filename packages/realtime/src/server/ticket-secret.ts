import type { RealtimeLogger } from "../core/types";

/**
 * The secret both halves of the WebSocket handshake share: the API surface
 * signs a connection ticket with it, the gateway verifies with it. Ported
 * from future-pay's `apps/web/lib/realtime/ticket-secret.ts`.
 *
 * ## Why it falls back to AUTH_SECRET
 *
 * A dedicated `REALTIME_TICKET_SECRET` is the right thing to configure — a
 * secret with one job is a secret you can rotate without logging anybody out.
 * But requiring it would mean the WebSocket transport silently fails to start
 * in every environment nobody remembered to update: dev, preview boxes, the
 * e2e stack. Falling back to `AUTH_SECRET` — already required everywhere,
 * already deployment-scoped, and already the thing protecting the session the
 * ticket is derived from — means the transport works out of the box and a
 * deployment can tighten it later.
 *
 * The gateway's config (`../gateway/config.ts`) resolves the two in the SAME
 * order, on purpose: the halves must agree, and a mismatch would show up as
 * every socket being refused with no other symptom.
 */

/** How a factory names its secret: a literal, a resolver, or "read the env". */
export type TicketSecretSource = string | (() => string | null) | undefined;

export function createTicketSecretResolver(
  source: TicketSecretSource,
  logger: RealtimeLogger,
): () => string | null {
  let warned = false;

  return () => {
    if (typeof source === "string") return source || null;
    if (typeof source === "function") return source();

    const dedicated = process.env.REALTIME_TICKET_SECRET?.trim();
    if (dedicated) return dedicated;

    const authSecret = process.env.AUTH_SECRET?.trim();
    if (authSecret) {
      if (!warned) {
        warned = true;
        logger.info(
          "REALTIME_TICKET_SECRET is unset; signing connection tickets with AUTH_SECRET.",
        );
      }
      return authSecret;
    }

    if (!warned) {
      warned = true;
      logger.error(
        "neither REALTIME_TICKET_SECRET nor AUTH_SECRET is set; the WebSocket transport is unavailable.",
      );
    }
    return null;
  };
}
