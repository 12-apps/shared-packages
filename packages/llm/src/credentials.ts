/**
 * Credential strategies, interchangeable behind one interface.
 *
 * - `apiKey`: a static secret the HOST supplies, read at call time through a
 *   resolver (or given directly). The package never persists it, logs it or
 *   puts it in an error message.
 * - `oauth`: an access token the host provides, with its expiry, plus a
 *   refresh hook. Before a call the package refreshes a token that is within
 *   `refreshSkewMs` of expiring; after a 401 it refreshes once and retries
 *   once. It never runs a login flow: obtaining the first token, storing the
 *   refreshed one and choosing which provider's login is allowed at all are
 *   the host's (see the README's terms note).
 *
 * Which strategies a provider accepts is the ADAPTER's declaration
 * (`ProviderAdapter.credentialKinds`), checked when the client is created.
 */

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
  afterUnauthorized(): Promise<ResolvedCredential | null>;
}

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
  const refresh = async (reason: RefreshReason) =>
    new ResolvedCredential("oauth", nonEmpty((await credentials.refresh(reason)).accessToken, "OAuth refresh"));
  return {
    kind: "oauth",
    async current() {
      const token = await credentials.token();
      const expiring = token.expiresAt !== undefined && token.expiresAt - now() <= skew;
      if (expiring) return refresh("expiring");
      return new ResolvedCredential("oauth", nonEmpty(token.accessToken, "OAuth token provider"));
    },
    afterUnauthorized: () => refresh("unauthorized"),
  };
}
