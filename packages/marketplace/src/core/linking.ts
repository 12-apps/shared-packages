import { listMarketplaceIntegrations, readOutboundConnection, type MarketplaceIntegrationView } from "./integration";
import { appCredentialsOf, cacheLinkToken, linkTokenKey, sealLink } from "./link-store";
import type { LinkCallContext, LinkedMerchant, MarketplaceLinking } from "./linking-port";
import { MarketplaceMerchantTakenError, guardMerchantClaim, isUniqueViolation, merchantHeldElsewhere } from "./merchant-claim";
import type { EngineContext, MarketplaceDb } from "./ports";
import type { MarketplaceProvider } from "./types";

/**
 * Linking a store through the software's own app (FUT-5613), as the host
 * calls it: start (the portal code), finish (the authorization code the store
 * pastes back), and choose the marketplace store when the grant covers more
 * than one. The wire format is the adapter's `linking`; the rows, the sealing
 * and the rules are here.
 *
 * The verifier never leaves the server: `start` keeps it sealed in the
 * store's link attempt and answers only what a person reads.
 */

type Environment = "SANDBOX" | "PRODUCTION";

/** Why a linking call did nothing. Vocabulary, not copy: the host words each. */
export type LinkRefusalCode =
  /** No app configured for this marketplace, the adapter links nothing, or the host has no link table. */
  | "UNAVAILABLE"
  /** `finish` with no `start` before it (or after another finish used it). */
  | "NO_LINK_IN_PROGRESS"
  /** The portal code's ten minutes are over: start again. */
  | "LINK_EXPIRED"
  /** The marketplace refused the authorization code (wrong, used, or for another code). */
  | "CODE_REFUSED"
  /** The marketplace refused another call (the code request, the merchant list). */
  | "MARKETPLACE_REFUSED"
  /** `selectMerchant` on a connection that is not linked, or is archived. */
  | "NOT_LINKED"
  /** The merchant is not one the grant covers. */
  | "UNKNOWN_MERCHANT"
  /** Another store's live connection already holds that merchant. */
  | "MERCHANT_TAKEN";

/** A linking call that did nothing: refused for good, or worth trying again. */
export type LinkFailure =
  | { kind: "refused"; code: LinkRefusalCode; status: number | null; message: string | null }
  | { kind: "retry"; reason: string };

/** A linking in progress, as a person sees it: never the verifier. */
export interface LinkPendingView {
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete: string;
  expiresAt: Date;
}

interface AttemptRow {
  environment: string;
  /** Sealed; a new `start` seals a new one, so it tells this attempt from a later one. */
  verifier: string;
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete: string;
  expiresAt: Date;
}

const refused = (code: LinkRefusalCode, status: number | null = null, message: string | null = null): LinkFailure => ({
  kind: "refused",
  code,
  status,
  message,
});

const pendingOf = (row: AttemptRow): LinkPendingView => ({
  userCode: row.userCode,
  verificationUrl: row.verificationUrl,
  verificationUrlComplete: row.verificationUrlComplete,
  expiresAt: row.expiresAt,
});

/** What a linking call needs, or null when linking is unavailable here. */
async function linkingOf(
  ctx: EngineContext,
  provider: MarketplaceProvider,
  environment: Environment,
): Promise<{ linking: MarketplaceLinking; call: LinkCallContext; attempts: NonNullable<MarketplaceDb["marketplaceLinkAttempt"]> } | null> {
  const linking = ctx.registry.get(provider)?.linking;
  if (!linking) return null;
  const attempts = (await ctx.ports.db()).marketplaceLinkAttempt;
  if (!attempts) return null;
  const app = await appCredentialsOf(ctx, provider, environment);
  if (!app) return null;
  return { linking, attempts, call: { http: ctx.ports.http, credentials: app, environment, now: ctx.ports.clock.now() } };
}

const keyOf = (clientId: string, provider: string) => ({ clientId_provider: { clientId, provider } });

/** Whether this store can link this marketplace, and the linking it left in progress, if still live. */
export async function linkState(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; environment?: Environment },
): Promise<{ available: boolean; pending: LinkPendingView | null }> {
  const ready = await linkingOf(ctx, input.provider, input.environment ?? "PRODUCTION");
  if (!ready) return { available: false, pending: null };
  const row = (await ready.attempts.findUnique({ where: keyOf(input.clientId, input.provider) })) as AttemptRow | null;
  const live = row && row.expiresAt.getTime() > ctx.ports.clock.now().getTime();
  return { available: true, pending: live ? pendingOf(row) : null };
}

/** Ask the marketplace for a portal code; keep its verifier, sealed, for this store. Replaces any earlier one. */
export async function startLink(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; environment?: Environment },
): Promise<{ kind: "started"; pending: LinkPendingView } | LinkFailure> {
  const environment = input.environment ?? "PRODUCTION";
  const ready = await linkingOf(ctx, input.provider, environment);
  if (!ready) return refused("UNAVAILABLE");
  const answer = await ready.linking.requestCode(ready.call);
  if (answer.kind === "retry") return answer;
  if (answer.kind === "refused") return refused("MARKETPLACE_REFUSED", answer.status, answer.message);
  const code = answer.value;
  const row = {
    environment,
    verifier: ctx.ports.secrets.seal(code.verifier),
    userCode: code.userCode,
    verificationUrl: code.verificationUrl,
    verificationUrlComplete: code.verificationUrlComplete,
    expiresAt: new Date(ready.call.now.getTime() + code.expiresInSeconds * 1000),
  };
  await ready.attempts.upsert({
    where: keyOf(input.clientId, input.provider),
    create: { clientId: input.clientId, provider: input.provider, ...row },
    update: row,
  });
  return { kind: "started", pending: pendingOf(row) };
}

/**
 * Which merchant a fresh link selects: the only one the grant covers, else
 * the one the connection already named if the grant still covers it, else
 * none (the host asks). A merchant another store holds is never selected.
 */
async function chooseMerchant(
  db: MarketplaceDb,
  input: { clientId: string; provider: string },
  merchants: readonly LinkedMerchant[] | null,
  current: string | null,
): Promise<string | null> {
  if (!merchants) return current;
  const candidate =
    merchants.length === 1 ? merchants[0]!.id : merchants.some((merchant) => merchant.id === current) ? current : null;
  if (candidate === null) return null;
  return (await merchantHeldElsewhere(db, input.clientId, input.provider, candidate)) ? null : candidate;
}

/** A link to save: its tokens, the merchants its grant covers, and the sealed verifier of the attempt it used. */
interface LinkToSave {
  environment: Environment;
  refreshToken: string;
  merchants: readonly LinkedMerchant[] | null;
  verifier: string;
}

/**
 * Save the linked connection, unarchiving it (with its audit line) when the
 * store had disconnected, and remove the attempt it used: only that one, so a
 * `start` that landed meanwhile keeps its code. Answers the sealed blob saved.
 */
async function saveLink(
  ctx: EngineContext,
  input: { clientId: string; provider: string; actorId: string | null; enabled?: boolean },
  link: LinkToSave,
): Promise<string> {
  const now = ctx.ports.clock.now();
  const credentials = sealLink(ctx, link.refreshToken);
  await ctx.ports.transaction(async (db) => {
    const existing = (await db.marketplaceIntegration.findUnique({
      where: keyOf(input.clientId, input.provider),
      select: { archivedAt: true, externalMerchantId: true },
    })) as { archivedAt: Date | null; externalMerchantId: string | null } | null;
    const data = {
      credentials,
      authMode: "LINKED",
      environment: link.environment,
      status: "VERIFIED",
      lastVerifiedAt: now,
      archivedAt: null,
      externalMerchantId: await chooseMerchant(db, input, link.merchants, existing?.externalMerchantId ?? null),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    };
    await db.marketplaceIntegration.upsert({
      where: keyOf(input.clientId, input.provider),
      create: { clientId: input.clientId, provider: input.provider, ackSlaSeconds: ctx.ports.defaultAckSlaSeconds, ...data },
      update: data,
    });
    if (existing?.archivedAt) {
      await ctx.ports.audit.record(
        {
          clientId: input.clientId,
          actorId: input.actorId,
          action: "marketplace.integration.unarchive",
          provider: input.provider,
          reason: "linked again",
          at: now,
        },
        db,
      );
    }
    await db.marketplaceLinkAttempt!.deleteMany({ where: { clientId: input.clientId, provider: input.provider, verifier: link.verifier } });
  });
  return credentials;
}

/**
 * {@link saveLink}, and once more with no merchant chosen when another
 * store's write of the same merchant won the race (the unique index refused
 * this one): the code is spent, so the tokens are kept whatever happens to the
 * merchant, and the store chooses one afterwards.
 */
async function saveLinkKeepingTokens(
  ctx: EngineContext,
  input: { clientId: string; provider: string; actorId: string | null; enabled?: boolean },
  link: LinkToSave,
): Promise<string> {
  try {
    return await saveLink(ctx, input, link);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    ctx.ports.logger.warn(`marketplace.link: ${input.provider} merchant of ${input.clientId} taken meanwhile; none chosen`);
    return saveLink(ctx, input, { ...link, merchants: [] });
  }
}

/** The connection as every read surface sees it, after a link wrote it. */
async function viewOf(ctx: EngineContext, clientId: string, provider: string): Promise<MarketplaceIntegrationView> {
  const [view] = await listMarketplaceIntegrations(ctx, clientId, { providers: [provider] });
  if (!view) throw new Error(`The ${provider} connection of ${clientId} was not saved.`);
  return view;
}

/** What `finishLink` answers: the connection, and the merchants the grant covers (null when they could not be listed). */
export interface LinkFinished {
  kind: "linked";
  integration: MarketplaceIntegrationView;
  merchants: LinkedMerchant[] | null;
}

/**
 * Exchange the authorization code the store pasted, with the verifier kept at
 * `start`, for its tokens; store them on the connection (LINKED, VERIFIED,
 * unarchived) and select the merchant when the grant covers only one. A
 * refused code keeps the attempt, so the person can paste again inside the
 * ten minutes.
 */
export async function finishLink(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; authorizationCode: string; actorId: string | null; enabled?: boolean },
): Promise<LinkFinished | LinkFailure> {
  const opened = await openAttempt(ctx, input);
  if ("kind" in opened) return opened;
  const { ready, environment, verifier, sealedVerifier } = opened;
  const exchanged = await ready.linking.exchange(ready.call, { authorizationCode: input.authorizationCode.trim(), verifier });
  if (exchanged.kind === "retry") return exchanged;
  if (exchanged.kind === "refused") return refused("CODE_REFUSED", exchanged.status, exchanged.message);
  const grant = exchanged.value;
  if (grant.refreshToken === null) return refused("CODE_REFUSED", null, "the marketplace answered no refresh token");

  // The code is spent: from here on the tokens are saved whatever the merchant list says.
  const listed = await ready.linking.merchants(ready.call, { accessToken: grant.accessToken });
  const merchants = listed.kind === "ok" ? listed.value : null;
  if (listed.kind !== "ok") {
    ctx.ports.logger.warn(`marketplace.link: ${input.provider} merchants of ${input.clientId} not listed (${listed.kind})`);
  }
  const sealed = await saveLinkKeepingTokens(ctx, input, { environment, refreshToken: grant.refreshToken, merchants, verifier: sealedVerifier });
  await cacheLinkToken(ctx, { ...input, sealed }, linkTokenKey(input.provider, environment, input.clientId), grant);
  ctx.ports.publishChanged(input.clientId);
  return { kind: "linked", integration: await viewOf(ctx, input.clientId, input.provider), merchants };
}

type Ready = NonNullable<Awaited<ReturnType<typeof linkingOf>>>;

/** The store's live attempt, opened: its verifier and the app to exchange it with. */
async function openAttempt(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider },
): Promise<{ ready: Ready; environment: Environment; verifier: string; sealedVerifier: string } | LinkFailure> {
  const attempts = (await ctx.ports.db()).marketplaceLinkAttempt;
  if (!attempts) return refused("UNAVAILABLE");
  const attempt = (await attempts.findUnique({ where: keyOf(input.clientId, input.provider) })) as AttemptRow | null;
  if (!attempt) return refused("NO_LINK_IN_PROGRESS");
  const environment: Environment = attempt.environment === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
  const ready = await linkingOf(ctx, input.provider, environment);
  if (!ready) return refused("UNAVAILABLE");
  if (attempt.expiresAt.getTime() <= ready.call.now.getTime()) return refused("LINK_EXPIRED");
  return { ready, environment, verifier: ctx.ports.secrets.open(attempt.verifier), sealedVerifier: attempt.verifier };
}

/** A linked connection's call context and a live access token, through its own grant. */
async function grantCall(
  ctx: EngineContext,
  clientId: string,
  provider: MarketplaceProvider,
): Promise<{ call: LinkCallContext; accessToken: string } | LinkFailure> {
  const views = await listMarketplaceIntegrations(ctx, clientId, { providers: [provider] });
  if (views[0]?.authMode !== "LINKED") return refused("NOT_LINKED");
  const connection = await readOutboundConnection(ctx, clientId, provider).catch(() => null);
  if (!connection?.grant) return refused("UNAVAILABLE");
  const token = await connection.grant.accessToken();
  if ("token" in token) {
    const call = { http: ctx.ports.http, credentials: connection.credentials, environment: connection.environment, now: ctx.ports.clock.now() };
    return { call, accessToken: token.token };
  }
  if (token.kind === "retry") return token;
  return token.kind === "refused" ? refused("NOT_LINKED", token.status, token.message) : refused("NOT_LINKED");
}

/** The merchants a linked connection's grant covers, listed through the grant itself. */
async function grantMerchants(
  ctx: EngineContext,
  clientId: string,
  provider: MarketplaceProvider,
): Promise<LinkedMerchant[] | LinkFailure> {
  const linking = ctx.registry.get(provider)?.linking;
  if (!linking) return refused("UNAVAILABLE");
  const granted = await grantCall(ctx, clientId, provider);
  if ("kind" in granted) return granted;
  const listed = await linking.merchants(granted.call, { accessToken: granted.accessToken });
  if (listed.kind === "ok") return listed.value;
  return listed.kind === "retry" ? listed : refused("MARKETPLACE_REFUSED", listed.status, listed.message);
}

/** The merchants a linked connection covers, for the screen's choice. */
export async function linkedMerchants(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider },
): Promise<{ kind: "listed"; merchants: LinkedMerchant[] } | LinkFailure> {
  const merchants = await grantMerchants(ctx, input.clientId, input.provider);
  return Array.isArray(merchants) ? { kind: "listed", merchants } : merchants;
}

/** Choose which marketplace store a linked connection is (the grant covers more than one). */
export async function selectLinkedMerchant(
  ctx: EngineContext,
  input: { clientId: string; provider: MarketplaceProvider; merchantId: string },
): Promise<{ kind: "selected"; integration: MarketplaceIntegrationView } | LinkFailure> {
  const merchants = await grantMerchants(ctx, input.clientId, input.provider);
  if (!Array.isArray(merchants)) return merchants;
  if (!merchants.some((merchant) => merchant.id === input.merchantId)) return refused("UNKNOWN_MERCHANT");
  const db = await ctx.ports.db();
  if (await merchantHeldElsewhere(db, input.clientId, input.provider, input.merchantId)) return refused("MERCHANT_TAKEN");
  // A race lost between the check and the write: the unique index refuses it, read as the same refusal.
  const write = () =>
    db.marketplaceIntegration.updateMany({
      where: { clientId: input.clientId, provider: input.provider, authMode: "LINKED", archivedAt: null },
      data: { externalMerchantId: input.merchantId },
    });
  const taken = await guardMerchantClaim(ctx, { ...input, merchantId: input.merchantId }, write).then(
    () => false,
    (error: unknown) => {
      if (error instanceof MarketplaceMerchantTakenError) return true;
      throw error;
    },
  );
  if (taken) return refused("MERCHANT_TAKEN");
  ctx.ports.publishChanged(input.clientId);
  return { kind: "selected", integration: await viewOf(ctx, input.clientId, input.provider) };
}
