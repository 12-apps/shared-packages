import type { RealtimeLogger } from "../core/types";

/**
 * Everything the gateway process reads from the environment, resolved once and
 * validated loudly. Ported from future-pay's `apps/realtime-gateway/src/config.ts`.
 *
 * The gateway is deliberately tiny in what it needs: a port, the shared ticket
 * secret, and the bus. It has NO database URL, NO session secret and NO RBAC
 * configuration — because it makes no authorization decisions (see `./index.ts`).
 * If a future change wants one of those here, that is the signal that the decision
 * drifted to the wrong side of the seam.
 */

export interface GatewayConfig {
  port: number;
  /** Shared with the API surface, which signs the tickets this process verifies. */
  ticketSecret: string;
  /** Redis for the cross-process bus, or null to run the inline driver. */
  redisUrl: string | null;
  /** Upper bound of simultaneous sockets, per process. */
  maxConnections: number;
  /** The path the upgrade must arrive on. Everything else is destroyed. */
  socketPath: string;
  /** Where the health probe answers. */
  healthPath: string;
}

/** What a host may override; anything omitted comes from the environment. */
export type GatewayConfigInput = Partial<GatewayConfig> & { logger?: RealtimeLogger };

export const DEFAULT_GATEWAY_PORT = 3100;
export const DEFAULT_GATEWAY_MAX_CONNECTIONS = 2_000;
export const DEFAULT_GATEWAY_SOCKET_PATH = "/ws";
export const DEFAULT_GATEWAY_HEALTH_PATH = "/health";

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/**
 * The ticket secret, in the SAME fallback order as the API side's
 * `createTicketSecretResolver`: a dedicated secret is the right thing to configure, but
 * requiring it would make the transport fail to start in every environment nobody
 * remembered to update. The two sides MUST agree, so the order is identical on purpose.
 */
function resolveTicketSecret(explicit: string | undefined): string {
  const secret =
    explicit?.trim() ||
    process.env.REALTIME_TICKET_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    "";
  if (!secret) {
    throw new Error(
      "neither REALTIME_TICKET_SECRET nor AUTH_SECRET is set — the gateway cannot verify tickets",
    );
  }
  return secret;
}

/**
 * Resolve the gateway's configuration.
 *
 * Explicit values win; everything else is read from the environment AT CALL TIME (never
 * at module load), so a host that sets variables in its own bootstrap is not racing an
 * import.
 *
 * Throws when no ticket secret can be found: unlike the API side — where a missing secret
 * means "no WebSocket transport, fall back to SSE" — a gateway with no secret can verify
 * nothing and would refuse every socket with no other symptom. Failing to start is the
 * honest version of that.
 */
export function readGatewayConfig(input: GatewayConfigInput = {}): GatewayConfig {
  const ticketSecret = resolveTicketSecret(input.ticketSecret);

  return {
    port: input.port ?? readInt("REALTIME_GATEWAY_PORT", DEFAULT_GATEWAY_PORT),
    ticketSecret,
    redisUrl: input.redisUrl ?? (process.env.REDIS_URL?.trim() || null),
    maxConnections:
      input.maxConnections ??
      readInt("REALTIME_GATEWAY_MAX_CONNECTIONS", DEFAULT_GATEWAY_MAX_CONNECTIONS),
    socketPath: input.socketPath ?? DEFAULT_GATEWAY_SOCKET_PATH,
    healthPath: input.healthPath ?? DEFAULT_GATEWAY_HEALTH_PATH,
  };
}
