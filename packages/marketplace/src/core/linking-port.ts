import type { MarketplaceCredentials, MarketplaceHttp, OutboundResult } from "./adapter";

/**
 * LINKING a store through the software's OWN marketplace app (FUT-5613): the
 * store authorizes the software's app on the marketplace's portal, and never
 * types a client id, a secret, a webhook key or a webhook address.
 *
 * The flow, as an adapter states it (iFood's "distributed app"):
 *
 * 1. `requestCode`: the app asks for a short code the store types (or a link
 *    that already carries it) on the marketplace's portal, plus a VERIFIER the
 *    engine keeps server-side for that store and never hands the browser.
 * 2. The store authorizes the app on the portal and is shown an
 *    AUTHORIZATION CODE, which it pastes back.
 * 3. `exchange`: the code plus the verifier buy an access token and a refresh
 *    token, stored sealed on the store's connection.
 * 4. `merchants`: which of the marketplace's stores the grant covers; one is
 *    selected at once.
 * 5. `refresh`: a new access token from the refresh token, whenever the
 *    cached one is gone. A rotated refresh token is stored back.
 *
 * The app's own credentials are the HOST's configuration, one pair per
 * marketplace and environment ({@link MarketplaceAppCredentialsPort}), never a
 * store's.
 */

/** What a linking call is handed: the APP's credentials, never a store's. */
export interface LinkCallContext {
  http: MarketplaceHttp;
  credentials: MarketplaceCredentials;
  environment: "SANDBOX" | "PRODUCTION";
  now: Date;
}

/** The code a store types on the marketplace's portal, and the verifier kept for it. */
export interface LinkCode {
  /** Shown to the person: they type it on the portal. */
  userCode: string;
  /** The portal page the code is typed on. */
  verificationUrl: string;
  /** The same page with the code already in it: the link the screen opens. */
  verificationUrlComplete: string;
  /** How long the code lives, in seconds. */
  expiresInSeconds: number;
  /** Kept server-side for this store until the exchange. NEVER sent to a browser. */
  verifier: string;
}

/** What an exchange or a refresh buys. */
export interface LinkGrant {
  accessToken: string;
  /** How long the access token lives, in seconds. */
  expiresInSeconds: number;
  /**
   * The refresh token. An exchange always answers one; a refresh answers one
   * when the marketplace rotates it, and null when the old one stays valid.
   */
  refreshToken: string | null;
}

/** One marketplace store the grant covers. */
export interface LinkedMerchant {
  id: string;
  name: string | null;
  corporateName: string | null;
}

/**
 * A linking call's answer: the value, or why there is none. `refused` is
 * final (the marketplace judged the request: a wrong or used code, a refresh
 * token it no longer honours); `retry` is the network, a 5xx, a rate limit.
 */
export type LinkResult<T> = { kind: "ok"; value: T } | Exclude<OutboundResult, { kind: "accepted" }>;

/** The adapter's half: the marketplace's wire format for each step, and nothing else. */
export interface MarketplaceLinking {
  requestCode(ctx: LinkCallContext): Promise<LinkResult<LinkCode>>;
  exchange(ctx: LinkCallContext, input: { authorizationCode: string; verifier: string }): Promise<LinkResult<LinkGrant>>;
  refresh(ctx: LinkCallContext, input: { refreshToken: string }): Promise<LinkResult<LinkGrant>>;
  merchants(ctx: LinkCallContext, input: { accessToken: string }): Promise<LinkResult<LinkedMerchant[]>>;
}

/**
 * The host's configuration of its OWN app on a marketplace: client id, client
 * secret, and the key the marketplace signs the app's webhook deliveries with.
 * Null (or the port not bound) means the software has no app there, and the
 * linking flow reports itself unavailable; a store's own credentials keep
 * working unchanged either way.
 */
export type MarketplaceAppCredentialsPort = (
  provider: string,
  environment: "SANDBOX" | "PRODUCTION",
) => MarketplaceCredentials | null | Promise<MarketplaceCredentials | null>;
