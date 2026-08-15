import type { RealtimeLogger } from "../core/types";

/**
 * Everything the gateway process reads from the environment, resolved once and
 * validated loudly. Ported from the origin host's `apps/realtime-gateway/src/config.ts`.
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
  /**
   * Whether running WITHOUT a cross-process bus was ASKED FOR, rather than merely
   * arrived at.
   *
   * An absent `REDIS_URL` is not consent. A gateway on the inline driver accepts every
   * socket, heartbeats the correct topic names and delivers nothing for ever — the
   * lying transport this package exists to prevent, and the API half refuses exactly
   * this configuration (`../server/resolve-driver.ts`). So the absence has to be
   * DISTINGUISHED from a request for it, and only these three say it out loud:
   *
   *   - `redisUrl` named in the options at all (`redisUrl: null` is the harness and
   *     the gateway's own tests) — naming the key is the consent, whatever its value,
   *     the same test `@repo/prisma`'s soft-delete extension uses for `archivedAt`;
   *   - an explicit `driver` in `startRealtimeGateway`'s options, which never reaches
   *     `createDriver` at all;
   *   - `REALTIME_DRIVER=inline`, the same variable the API half reads.
   *
   * `NODE_ENV === "production"` is deliberately NOT the test. A gateway container
   * missing `REDIS_URL` is a compose/Doppler omission, and a container missing
   * `NODE_ENV` is the same omission one variable over — keying the guard on it would
   * fail open on precisely the deployment it is for.
   */
  inlineConsent: boolean;
  /** Upper bound of simultaneous sockets, per process. */
  maxConnections: number;
  /** The path the upgrade must arrive on. Everything else is destroyed. */
  socketPath: string;
  /** Where the health probe answers. */
  healthPath: string;
}

/**
 * What a host may override; anything omitted comes from the environment.
 *
 * Naming `redisUrl` — even as `null` — is itself the inline opt-in, so an embedded
 * single-process host needs nothing else. `inlineConsent: true` is the way to say it
 * without naming a bus at all.
 */
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
 * Whether inline delivery was asked for — see {@link GatewayConfig.inlineConsent}.
 *
 * `"redisUrl" in input` rather than a value check, because `redisUrl: null` IS the
 * request: a caller that names the key has stated what bus it wants, and `??` cannot
 * tell that apart from the key being absent.
 */
function readInlineConsent(input: GatewayConfigInput): boolean {
  if ("redisUrl" in input || "driver" in input) return true;
  return process.env.REALTIME_DRIVER?.trim().toLowerCase() === "inline";
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
    inlineConsent: input.inlineConsent ?? readInlineConsent(input),
    maxConnections:
      input.maxConnections ??
      readInt("REALTIME_GATEWAY_MAX_CONNECTIONS", DEFAULT_GATEWAY_MAX_CONNECTIONS),
    socketPath: input.socketPath ?? DEFAULT_GATEWAY_SOCKET_PATH,
    healthPath: input.healthPath ?? DEFAULT_GATEWAY_HEALTH_PATH,
  };
}
