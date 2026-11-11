import type { MarketplaceCredentials } from "./adapter";
import type { EngineContext } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * The (tenant, marketplace) connection repository .
 *
 * Nothing here ever returns the credential blob. The read every surface uses
 * answers whether a connection EXISTS and how it is configured, never what it
 * is configured with. The one opening read is {@link resolveIngestionTarget},
 * which the webhook path needs and nobody else calls.
 */

/** A connection as every read surface sees it: no secrets, ever. */
export interface MarketplaceIntegrationView {
  provider: MarketplaceProvider;
  enabled: boolean;
  environment: "SANDBOX" | "PRODUCTION";
  status: "UNVERIFIED" | "VERIFIED" | "FAILED";
  externalMerchantId: string | null;
  autoAccept: boolean;
  ackSlaSeconds: number;
  /**
   * Whether the store has a usable connection — i.e. whether secrets are on
   * file at all. Named for the STATE rather than for the blob behind it: the
   * only fact anyone needs about a stored secret is that one exists, and it is
   * the only one that can be answered without disclosing it.
   */
  connected: boolean;
  lastEventAt: Date | null;
  lastVerifiedAt: Date | null;
}

interface IntegrationRow {
  provider: string;
  enabled: boolean;
  environment: string;
  status: string;
  externalMerchantId: string | null;
  autoAccept: boolean;
  ackSlaSeconds: number;
  credentials: string;
  lastEventAt: Date | null;
  lastVerifiedAt: Date | null;
}

const VIEW_SELECT = {
  provider: true,
  enabled: true,
  environment: true,
  status: true,
  externalMerchantId: true,
  autoAccept: true,
  ackSlaSeconds: true,
  credentials: true,
  lastEventAt: true,
  lastVerifiedAt: true,
} as const;

function toView(row: IntegrationRow): MarketplaceIntegrationView {
  return {
    provider: row.provider as MarketplaceProvider,
    enabled: row.enabled,
    environment: row.environment as MarketplaceIntegrationView["environment"],
    status: row.status as MarketplaceIntegrationView["status"],
    externalMerchantId: row.externalMerchantId,
    autoAccept: row.autoAccept,
    ackSlaSeconds: row.ackSlaSeconds,
    connected: row.credentials !== "",
    lastEventAt: row.lastEventAt,
    lastVerifiedAt: row.lastVerifiedAt,
  };
}

/** Every marketplace connection this store has, secrets withheld. */
export async function listMarketplaceIntegrations(
  ctx: EngineContext,
  clientId: string,
): Promise<MarketplaceIntegrationView[]> {
  const db = await ctx.ports.db();
  const rows = (await db.marketplaceIntegration.findMany({
    where: { clientId },
    select: VIEW_SELECT,
    orderBy: { provider: "asc" },
  })) as IntegrationRow[];
  return rows.map(toView);
}

/** What a save may change. Absent keys leave their column alone. */
export interface SaveMarketplaceIntegrationInput {
  clientId: string;
  provider: MarketplaceProvider;
  enabled?: boolean;
  environment?: "SANDBOX" | "PRODUCTION";
  externalMerchantId?: string | null;
  autoAccept?: boolean;
  ackSlaSeconds?: number;
  /**
   * The secrets, when the operator re-entered them. Absent means "leave the
   * stored blob alone", which is what makes it possible to flip `autoAccept`
   * without retyping a client secret nobody can read back off the screen.
   */
  credentials?: MarketplaceCredentials;
}

/**
 * Create or update a store's connection to one marketplace.
 *
 * An upsert on `(clientId, provider)` — the row IS the connection, so there is
 * no separate "connect" and "edit". A CREATE with no credentials stores the
 * empty blob rather than refusing: a merchant mid-homologation has a merchant
 * id and no secrets for weeks, and that half-connected state is exactly what
 * the screen exists to show them.
 *
 * Re-entering credentials resets `status` to UNVERIFIED. The stored status is a
 * claim about a specific secret; carrying VERIFIED across a credential change
 * would assert that a probe which never ran had passed.
 */
export async function saveMarketplaceIntegration(
  ctx: EngineContext,
  input: SaveMarketplaceIntegrationInput,
): Promise<MarketplaceIntegrationView> {
  const db = await ctx.ports.db();
  const sealed = input.credentials
    ? ctx.ports.secrets.seal(JSON.stringify(input.credentials))
    : undefined;
  const mutable = {
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.environment === undefined ? {} : { environment: input.environment }),
    ...(input.externalMerchantId === undefined
      ? {}
      : { externalMerchantId: input.externalMerchantId }),
    ...(input.autoAccept === undefined ? {} : { autoAccept: input.autoAccept }),
    ...(input.ackSlaSeconds === undefined ? {} : { ackSlaSeconds: input.ackSlaSeconds }),
    ...(sealed === undefined ? {} : { credentials: sealed, status: "UNVERIFIED" }),
  };
  const row = (await db.marketplaceIntegration.upsert({
    where: { clientId_provider: { clientId: input.clientId, provider: input.provider } },
    create: {
      clientId: input.clientId,
      provider: input.provider,
      credentials: sealed ?? "",
      ackSlaSeconds: ctx.ports.defaultAckSlaSeconds,
      ...mutable,
    },
    update: mutable,
    select: VIEW_SELECT,
  })) as IntegrationRow;
  return toView(row);
}

/** Forget a store's connection to one marketplace. Idempotent. */
export async function deleteMarketplaceIntegration(
  ctx: EngineContext,
  clientId: string,
  provider: MarketplaceProvider,
): Promise<void> {
  const db = await ctx.ports.db();
  await db.marketplaceIntegration.deleteMany({ where: { clientId, provider } });
}

/** What the ingestion path needs to know about a store's connection. */
export interface IngestionTarget {
  enabled: boolean;
  autoAccept: boolean;
  ackSlaSeconds: number;
  webhookSecret: string | null;
}

/**
 * The connection a delivery belongs to, plus the two things the webhook path
 * needs from it: the shared secret to verify against, and whether the store has
 * the connection ON.
 *
 * A DISABLED connection still resolves. The caller decides what to do with that
 * (it stores the event and does not ingest it), and it must be able to tell
 * "this store turned the channel off" apart from "this store has no channel",
 * because only one of them is a misconfiguration worth shouting about.
 */
export async function resolveIngestionTarget(
  ctx: EngineContext,
  clientId: string,
  provider: MarketplaceProvider,
): Promise<IngestionTarget | null> {
  const db = await ctx.ports.db();
  const row = (await db.marketplaceIntegration.findUnique({
    where: { clientId_provider: { clientId, provider } },
    select: { enabled: true, autoAccept: true, ackSlaSeconds: true, credentials: true },
  })) as {
    enabled: boolean;
    autoAccept: boolean;
    ackSlaSeconds: number;
    credentials: string;
  } | null;
  if (!row) return null;
  return {
    enabled: row.enabled,
    autoAccept: row.autoAccept,
    ackSlaSeconds: row.ackSlaSeconds,
    // An unopenable blob must not read as "no secret configured" — that would
    // turn a key-rotation problem into an endpoint that accepts unsigned
    // deliveries. The secrets port throws instead, and the caller answers 401.
    webhookSecret:
      row.credentials === "" ? null : openCredentials(ctx, row.credentials).webhookSecret,
  };
}

/**
 * Open a stored credential set.
 *
 * Throws on a ciphertext that will not open, by way of the host's secrets port
 * — which is the right outcome and not a hypothetical: a row written under a
 * key that has since rotated cannot be used to talk to anyone, and treating it
 * as "no credentials" would silently turn a KEY problem into a connection that
 * looks merely unconfigured.
 */
function openCredentials(
  ctx: EngineContext,
  sealed: string,
): MarketplaceCredentials {
  const parsed: unknown = JSON.parse(ctx.ports.secrets.open(sealed));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Stored marketplace credentials are not an object.");
  }
  const record = parsed as Partial<MarketplaceCredentials>;
  return {
    clientId: String(record.clientId ?? ""),
    clientSecret: String(record.clientSecret ?? ""),
    webhookSecret: record.webhookSecret ? String(record.webhookSecret) : null,
  };
}

/**
 * Which tenant a delivery belongs to, resolved from the merchant id the
 * marketplace names.
 *
 * Matched against the column OUTSIDE the ciphertext, which is the whole reason
 * `externalMerchantId` lives there: attributing a delivery must not require
 * decrypting every store's secrets to find the match.
 */
export async function resolveTenantByMerchant(
  ctx: EngineContext,
  provider: MarketplaceProvider,
  externalMerchantId: string,
): Promise<string | null> {
  const db = await ctx.ports.db();
  const rows = (await db.marketplaceIntegration.findMany({
    where: { provider, externalMerchantId },
    select: { clientId: true },
    take: 1,
  })) as { clientId: string }[];
  return rows[0]?.clientId ?? null;
}

/** Stamp the connection's liveness marker. Best-effort; never blocks ingestion. */
export async function markMarketplaceEventSeen(
  ctx: EngineContext,
  clientId: string,
  provider: MarketplaceProvider,
  at: Date,
): Promise<void> {
  const db = await ctx.ports.db();
  await db.marketplaceIntegration.updateMany({
    where: { clientId, provider },
    data: { lastEventAt: at },
  });
}

/** What the outbound engine needs to talk to a marketplace for one store. */
export interface OutboundConnection {
  environment: "SANDBOX" | "PRODUCTION";
  credentials: MarketplaceCredentials;
}

/**
 * The opened connection for one (tenant, marketplace), or null when there is
 * no connection or no credentials on file. Throws when the stored blob will
 * not open — the outbound engine records that as a failure rather than
 * mistaking a key problem for an unconfigured store.
 */
export async function readOutboundConnection(
  ctx: EngineContext,
  clientId: string,
  provider: MarketplaceProvider,
): Promise<OutboundConnection | null> {
  const db = await ctx.ports.db();
  const row = (await db.marketplaceIntegration.findUnique({
    where: { clientId_provider: { clientId, provider } },
    select: { environment: true, credentials: true },
  })) as { environment: string; credentials: string } | null;
  if (!row || row.credentials === "") return null;
  return {
    environment: row.environment === "PRODUCTION" ? "PRODUCTION" : "SANDBOX",
    credentials: openCredentials(ctx, row.credentials),
  };
}
