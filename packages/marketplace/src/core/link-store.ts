import type { AdapterGrant, AdapterTokenCache, MarketplaceCredentials, OutboundResult } from "./adapter";
import type { LinkGrant } from "./linking-port";
import type { EngineContext } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * A LINKED connection's secrets and tokens (FUT-5613).
 *
 * The sealed `credentials` blob of a linked connection holds the store's
 * refresh token and nothing of the app: the app's client id and secret are
 * the host's configuration (`appCredentials`), read at each use so a rotation
 * there reaches every store at once. The access token lives in the engine's
 * per-process token cache only, like every other marketplace token.
 */

/** How a connection authenticates. */
export type MarketplaceAuthMode = "CREDENTIALS" | "LINKED";

/** A token is renewed this long before the marketplace says it expires. */
const TOKEN_MARGIN_MS = 60_000;

/** The blob a linked connection stores, sealed. The empty app fields keep 1.x readers' shape. */
export function sealLink(ctx: EngineContext, refreshToken: string): string {
  return ctx.ports.secrets.seal(JSON.stringify({ clientId: "", clientSecret: "", webhookSecret: null, refreshToken }));
}

/** The refresh token a linked connection's blob holds. Throws when it holds none, or will not open. */
export function openLinkRefreshToken(ctx: EngineContext, sealed: string): string {
  const parsed: unknown = JSON.parse(ctx.ports.secrets.open(sealed));
  const token = typeof parsed === "object" && parsed !== null ? (parsed as { refreshToken?: unknown }).refreshToken : null;
  if (typeof token !== "string" || token === "") throw new Error("The linked connection holds no refresh token.");
  return token;
}

/** The software's own app on this marketplace, or null when the host configured none. */
export async function appCredentialsOf(
  ctx: EngineContext,
  provider: MarketplaceProvider,
  environment: "SANDBOX" | "PRODUCTION",
): Promise<MarketplaceCredentials | null> {
  const port = ctx.ports.appCredentials;
  if (!port) return null;
  const credentials = await port(provider, environment);
  return credentials && credentials.clientId !== "" && credentials.clientSecret !== "" ? credentials : null;
}

/** Where a linked connection's access token sits in the cache: per store, never per app. */
export const linkTokenKey = (provider: string, environment: string, clientId: string): string =>
  `LINK:${provider}:${environment}:${clientId}`;

/** Put a fresh access token in the cache. */
export function cacheLinkToken(ctx: EngineContext, key: string, grant: LinkGrant): void {
  const expiresAt = ctx.ports.clock.now().getTime() + Math.max(grant.expiresInSeconds, 1) * 1000;
  ctx.tokens.set(key, { token: grant.accessToken, expiresAt });
}

/** One refresh per connection at a time, per token cache (that is, per engine). */
const inflight = new WeakMap<AdapterTokenCache, Map<string, Promise<{ token: string } | OutboundResult>>>();

/** Who a grant is for. */
interface LinkedConnection {
  clientId: string;
  provider: MarketplaceProvider;
  environment: "SANDBOX" | "PRODUCTION";
  refreshToken: string;
  app: MarketplaceCredentials;
}

/** Store a rotated refresh token back on the live connection. */
async function storeRotated(ctx: EngineContext, link: LinkedConnection, refreshToken: string): Promise<void> {
  const db = await ctx.ports.db();
  await db.marketplaceIntegration.updateMany({
    where: { clientId: link.clientId, provider: link.provider, authMode: "LINKED", archivedAt: null },
    data: { credentials: sealLink(ctx, refreshToken) },
  });
}

/**
 * The marketplace no longer honours the refresh token: the store must link
 * again. The connection reads FAILED, which is what the screen shows.
 */
async function markLinkFailed(ctx: EngineContext, link: LinkedConnection): Promise<void> {
  const db = await ctx.ports.db();
  await db.marketplaceIntegration.updateMany({
    where: { clientId: link.clientId, provider: link.provider, authMode: "LINKED" },
    data: { status: "FAILED" },
  });
  ctx.ports.publishChanged(link.clientId);
}

async function refreshOnce(ctx: EngineContext, link: LinkedConnection, key: string): Promise<{ token: string } | OutboundResult> {
  const linking = ctx.registry.get(link.provider)?.linking;
  if (!linking) return { kind: "refused", status: 0, message: "this marketplace links no store", own: true };
  const answer = await linking.refresh(
    { http: ctx.ports.http, credentials: link.app, environment: link.environment, now: ctx.ports.clock.now() },
    { refreshToken: link.refreshToken },
  );
  if (answer.kind === "retry") return answer;
  if (answer.kind === "refused") {
    await markLinkFailed(ctx, link);
    return { ...answer, own: true };
  }
  cacheLinkToken(ctx, key, answer.value);
  const rotated = answer.value.refreshToken;
  if (rotated !== null && rotated !== link.refreshToken) {
    // The new token is already in hand; a failed write costs a re-link only if
    // the marketplace also revoked the old one, so it is logged, never thrown.
    await storeRotated(ctx, link, rotated).catch((error: unknown) =>
      ctx.ports.logger.error(
        `marketplace.link: ${link.provider} rotated refresh token of ${link.clientId} not stored: ` +
          (error instanceof Error ? error.message : String(error)),
      ),
    );
  }
  return { token: answer.value.accessToken };
}

/** The grant an outbound call of a linked connection is handed. */
export function linkGrant(ctx: EngineContext, link: LinkedConnection): AdapterGrant {
  const key = linkTokenKey(link.provider, link.environment, link.clientId);
  return {
    key,
    accessToken: async () => {
      const cached = ctx.tokens.get(key);
      if (cached && cached.expiresAt > ctx.ports.clock.now().getTime() + TOKEN_MARGIN_MS) return { token: cached.token };
      let running = inflight.get(ctx.tokens);
      if (!running) {
        running = new Map();
        inflight.set(ctx.tokens, running);
      }
      const pending = running.get(key);
      if (pending) return pending;
      const call = refreshOnce(ctx, link, key)
        .catch((error: unknown): OutboundResult => ({
          kind: "retry",
          reason: error instanceof Error ? error.message : String(error),
        }))
        .finally(() => running.delete(key));
      running.set(key, call);
      return call;
    },
  };
}
