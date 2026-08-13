import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  OAuthClientStore,
  StoredOAuthClient,
  TokenEndpointAuthMethod,
} from "./stores";

/**
 * Client registration and the open-redirect guard (12-23, ported from
 * future-pay's `lib/mcp/oauth/clients.ts`).
 *
 * A registered client is an external host (a Claude.ai / ChatGPT connector) from
 * RFC 7591 dynamic client registration, or a static registration an operator
 * created out of band. A confidential client's secret is generated HERE, returned
 * exactly once, and stored only as a SHA-256 hash — it is never persisted in
 * plaintext, never logged, and never re-derivable.
 */

/** Default grant types for a registered client (OAuth 2.1 code + refresh). */
const DEFAULT_GRANT_TYPES = ["authorization_code", "refresh_token"] as const;

/** Bytes of entropy for a generated confidential-client secret (→ 64 hex). */
const CLIENT_SECRET_BYTES = 32;

/** RFC 7591 registration input (the durable subset the store persists). */
export interface RegisterClientInput {
  /** The exact-match redirect-uri allowlist (open-redirect guard). */
  redirectUris: string[];
  clientName?: string | null;
  /**
   * `none` (public PKCE client, the default) or `client_secret_basic`
   * (confidential — a secret is generated and its hash stored).
   */
  tokenEndpointAuthMethod?: TokenEndpointAuthMethod;
  /** Grant types; defaults to authorization_code + refresh_token. */
  grantTypes?: string[];
  scopes: string[];
}

/**
 * The registration RESULT. `clientSecret` is present (plaintext, ONCE) only for a
 * confidential client — it is never stored and never returned again.
 */
export interface RegisteredClient {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  clientName: string | null;
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  grantTypes: string[];
  scopes: string[];
}

/** SHA-256 hex digest — the at-rest form of the client secret. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Register an OAuth client under a generated `clientId`. For a confidential
 * client a random secret is generated and its hash stored; the plaintext is
 * returned once.
 */
export async function registerClient(
  store: OAuthClientStore,
  input: RegisterClientInput,
): Promise<RegisteredClient> {
  const clientId = randomUUID();
  const authMethod: TokenEndpointAuthMethod = input.tokenEndpointAuthMethod ?? "none";
  const grantTypes = input.grantTypes ?? [...DEFAULT_GRANT_TYPES];

  // Only a confidential client gets a secret; a public PKCE client has none.
  const clientSecret =
    authMethod === "client_secret_basic"
      ? randomBytes(CLIENT_SECRET_BYTES).toString("hex")
      : undefined;

  const row = await store.create({
    clientId,
    clientSecretHash: clientSecret ? hashSecret(clientSecret) : null,
    redirectUris: input.redirectUris,
    clientName: input.clientName ?? null,
    tokenEndpointAuthMethod: authMethod,
    grantTypes,
    scopes: input.scopes,
  });

  return {
    clientId: row.clientId,
    ...(clientSecret ? { clientSecret } : {}),
    redirectUris: row.redirectUris,
    clientName: row.clientName,
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod as TokenEndpointAuthMethod,
    grantTypes: row.grantTypes,
    scopes: row.scopes,
  };
}

/**
 * Open-redirect guard: a redirect target is accepted ONLY when it EXACTLY equals a
 * registered `redirect_uri`. No normalization, no prefix, no trailing-slash
 * leniency — an intercepted authorization request must not be steerable to any URI
 * the client did not register.
 */
export function matchesRedirectUri(
  client: Pick<StoredOAuthClient, "redirectUris">,
  redirectUri: string,
): boolean {
  if (!redirectUri) return false;
  return client.redirectUris.includes(redirectUri);
}

/**
 * Provider attribution rules: the canonical root domains that own each host's
 * OAuth callback. A redirect host matches a root only as the exact domain or a
 * real (dot-guarded) subdomain — never a suffix, so `evilchatgpt.com` never
 * matches `chatgpt.com`.
 */
export interface ProviderAttributionRule {
  roots: readonly string[];
  provider: string;
}

/** future-pay's rules, and a sane default for any host talking to the same two. */
export const DEFAULT_PROVIDER_ROOTS: readonly ProviderAttributionRule[] = [
  { roots: ["claude.ai", "anthropic.com"], provider: "claude" },
  { roots: ["chatgpt.com", "openai.com"], provider: "chatgpt" },
];

/** Whether `host` is exactly `root` or a real subdomain of it (dot-guarded). */
function hostMatchesRoot(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`);
}

/**
 * Best-effort provider attribution from a client's redirect URIs: the host that
 * owns the callback (`claude.ai` → claude, `chatgpt.com` → chatgpt). Returns
 * `null` when nothing matches — the UI then falls back to what the owner
 * completed the flow with, and a self-report (the `announce` path) can attribute
 * it later.
 */
export function providerFromRedirectUris(
  redirectUris: readonly string[],
  rules: readonly ProviderAttributionRule[] = DEFAULT_PROVIDER_ROOTS,
): string | null {
  for (const uri of redirectUris) {
    let host: string;
    try {
      host = new URL(uri).host.toLowerCase();
    } catch {
      continue;
    }
    const match = rules.find((rule) => rule.roots.some((root) => hostMatchesRoot(host, root)));
    if (match) return match.provider;
  }
  return null;
}
