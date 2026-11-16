/**
 * Credential strategies, interchangeable behind one interface.
 *
 * - `apiKey`: a static secret the HOST supplies, read at call time through a
 *   resolver (or given directly). The package never persists it, logs it or
 *   puts it in an error message.
 * - `oauth`: an access token the host provides, with its expiry, plus a
 *   refresh hook. Before a call the package refreshes a token that is within
 *   `refreshSkewMs` of expiring; after a 401 it refreshes once and retries
 *   once. A refresh is SINGLE-FLIGHT per session (B1): concurrent calls that
 *   find the token expiring, or get a 401, share one `refresh()` — providers
 *   rotate the refresh token on use, and two refreshes racing can revoke the
 *   login. A 401 on a token older than the last refresh adopts that refresh
 *   instead of starting another. It never runs a login flow: obtaining the first token, storing the
 *   refreshed one and choosing which provider's login is allowed at all are
 *   the host's (see the README's terms note).
 *
 * Which strategies a provider accepts is the ADAPTER's declaration
 * (`ProviderAdapter.credentialKinds`), checked when the client is created.
 */

import { CredentialRevokedError } from "./errors";

export type CredentialKind = "apiKey" | "oauth";

type MaybePromise<T> = T | Promise<T>;

export interface ApiKeyCredentials {
  kind: "apiKey";
  /** The key, or a resolver the package calls before every request. */
  apiKey: string | (() => MaybePromise<string>);
}

export interface OAuthToken {
  accessToken: string;
  /** Epoch milliseconds; omitted when the token does not say. */
  expiresAt?: number;
}

export type RefreshReason = "expiring" | "unauthorized";

export interface OAuthCredentials {
  kind: "oauth";
  /** The host's current token. Called before every request. */
  token: () => MaybePromise<OAuthToken>;
  /**
   * Obtain a fresh token. The host stores it so `token()` returns it next
   * time; the package only uses it for the call in flight.
   */
  refresh: (reason: RefreshReason) => MaybePromise<OAuthToken>;
  /** How close to expiry a token is refreshed first. Default 60 s. */
  refreshSkewMs?: number;
  /**
   * The host's "this account was disconnected" check, called before a token is
   * handed out and again after a refresh lands. Once it returns true,
   * `current()` and `afterUnauthorized()` throw `CredentialRevokedError`, and a
   * refresh that was in flight is discarded: never returned, never cached.
   */
  isRevoked?: () => MaybePromise<boolean>;
}

export type Credentials = ApiKeyCredentials | OAuthCredentials;

const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/**
 * The secret an adapter sends on ONE request. Its value is non-enumerable and
 * it prints as `[credential apiKey]`, so a log line, a JSON dump or an error
 * context that captures it carries no secret.
 */
export class ResolvedCredential {
  readonly kind: CredentialKind;
  declare readonly secret: string;

  constructor(kind: CredentialKind, secret: string) {
    this.kind = kind;
    Object.defineProperty(this, "secret", { value: secret, enumerable: false });
  }

  toJSON(): string {
    return this.toString();
  }

  toString(): string {
    return `[credential ${this.kind}]`;
  }

  [INSPECT](): string {
    return this.toString();
  }
}

export interface CredentialSessionOptions {
  now?: () => number;
}

/**
 * Wraps one strategy for the client: `current()` before a request,
 * `afterUnauthorized()` once after a 401 (null when nothing can be renewed).
 */
export interface CredentialSession {
  readonly kind: CredentialKind;
  current(): Promise<ResolvedCredential>;
  /** `used` is the credential the 401 answered, so a refresh made since is adopted. */
  afterUnauthorized(used: ResolvedCredential): Promise<ResolvedCredential | null>;
}

/** Which refresh each OAuth credential came from (0: the host's token as read). */
const generations = new WeakMap<ResolvedCredential, number>();

function nonEmpty(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`@12-apps/llm: the host's ${what} returned no value.`);
  }
  return value;
}

export function createCredentialSession(
  credentials: Credentials,
  options: CredentialSessionOptions = {},
): CredentialSession {
  const now = options.now ?? Date.now;
  if (credentials.kind === "apiKey") {
    const read = async () =>
      nonEmpty(
        typeof credentials.apiKey === "function" ? await credentials.apiKey() : credentials.apiKey,
        "API key",
      );
    return {
      kind: "apiKey",
      current: async () => new ResolvedCredential("apiKey", await read()),
      afterUnauthorized: async () => null,
    };
  }
  const skew = credentials.refreshSkewMs ?? 60_000;
  const oauth = credentials;
  let generation = 0;
  let latest: ResolvedCredential | null = null;
  let inFlight: Promise<ResolvedCredential> | null = null;
  let revoked = false;
  const assertLive = async (): Promise<void> => {
    if (revoked || (await oauth.isRevoked?.())) {
      revoked = true;
      latest = null;
      throw new CredentialRevokedError();
    }
  };
  const stamped = (secret: string, of: number): ResolvedCredential => {
    const credential = new ResolvedCredential("oauth", secret);
    generations.set(credential, of);
    return credential;
  };
  // One refresh at a time: every caller that needs one while it runs awaits the same promise.
  const refresh = (reason: RefreshReason): Promise<ResolvedCredential> => {
    inFlight ??= (async () => {
      await assertLive();
      const secret = nonEmpty((await oauth.refresh(reason)).accessToken, "OAuth refresh");
      await assertLive(); // disconnected while the refresh ran: its result is discarded
      generation += 1;
      latest = stamped(secret, generation);
      return latest;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  return {
    kind: "oauth",
    async current() {
      await assertLive();
      if (inFlight) return inFlight;
      const of = generation; // before the await: a refresh that lands meanwhile makes this token older
      const token = await oauth.token();
      const expiring = token.expiresAt !== undefined && token.expiresAt - now() <= skew;
      if (expiring) return refresh("expiring");
      return stamped(nonEmpty(token.accessToken, "OAuth token provider"), of);
    },
    async afterUnauthorized(used) {
      await assertLive();
      if (inFlight) return inFlight;
      // A refresh finished after this call's token was read: that token is the answer, not another rotation.
      if (latest && (generations.get(used) ?? 0) < generation) return latest;
      return refresh("unauthorized");
    },
  };
}
