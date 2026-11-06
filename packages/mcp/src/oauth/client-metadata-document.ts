import { ClientMetadataDocumentError } from "./client-metadata-errors";
import type { StoredOAuthClient } from "./stores";

/**
 * The document half of Client ID Metadata Documents (FUT-4522): what a fetched
 * document must say to be a client here, and the client it becomes.
 *
 * Only a PUBLIC client: `token_endpoint_auth_method` absent or `none`, and no
 * secret in it — a document anyone can read cannot hold a shared secret. The
 * grant types and scopes are cut to what this server serves; a document may
 * narrow them, never widen them.
 */

const MAX_CLIENT_NAME_LENGTH = 200;
const MAX_REDIRECT_URIS = 20;

/** The only grant types this server issues; anything else a document lists is ignored. */
const SUPPORTED_GRANT_TYPES = ["authorization_code", "refresh_token"] as const;

type Doc = Record<string, unknown>;

function refuse(reason: string): never {
  throw new ClientMetadataDocumentError(reason);
}

function isAbsoluteWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function asObject(document: unknown): Doc {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    refuse("document is not a JSON object");
  }
  return document as Doc;
}

/** Any method that rests on a shared secret, which a public document cannot hold (draft-03 §4.1). */
function isSharedSecretMethod(method: unknown): boolean {
  return typeof method === "string" && method.startsWith("client_secret");
}

/**
 * The client authentication the document allows, which must come out as `none`
 * (draft-03 §4.1, §5): this server authenticates a document client with nothing,
 * so a document that allows only something else is refused, and one that lists
 * a shared-secret method at all is refused outright.
 *
 * - `token_endpoint_auth_methods_supported`, when present, must be a list that
 *   includes `none` and no shared-secret method; `none` is then chosen from it.
 * - `token_endpoint_auth_method`, when present with that list, must be one of
 *   its entries (the draft's consistency rule) and not a shared-secret method.
 * - With no list, the single method must be absent or `none`.
 */
function checkPublicClient(doc: Doc): void {
  if ("client_secret" in doc || "client_secret_expires_at" in doc) refuse("document carries a client secret");
  const single = doc.token_endpoint_auth_method;
  const listed = doc.token_endpoint_auth_methods_supported;
  if (listed !== undefined) {
    checkListedMethods(listed, single);
    return;
  }
  if ((single ?? "none") !== "none") refuse(`unsupported token_endpoint_auth_method (${String(single)})`);
}

/** The `token_endpoint_auth_methods_supported` half of {@link checkPublicClient}. */
function checkListedMethods(listed: unknown, single: unknown): void {
  if (!Array.isArray(listed) || !listed.includes("none")) {
    refuse("document token_endpoint_auth_methods_supported does not include none");
  }
  if (listed.some(isSharedSecretMethod) || isSharedSecretMethod(single)) {
    refuse("document allows a shared-secret auth method");
  }
  if (single !== undefined && !listed.includes(single)) {
    refuse("document token_endpoint_auth_method is not in token_endpoint_auth_methods_supported");
  }
}

function redirectUrisOf(doc: Doc): string[] {
  const uris = doc.redirect_uris;
  const valid = Array.isArray(uris) && uris.length > 0 && uris.length <= MAX_REDIRECT_URIS &&
    uris.every(isAbsoluteWebUrl);
  if (!valid) refuse("document redirect_uris is not a list of absolute URLs");
  return [...(uris as string[])];
}

function grantTypesOf(doc: Doc): string[] {
  const listed = doc.grant_types;
  const grants = Array.isArray(listed)
    ? SUPPORTED_GRANT_TYPES.filter((grant) => listed.includes(grant))
    : ["authorization_code"];
  if (!grants.includes("authorization_code")) refuse("document does not allow authorization_code");
  if (Array.isArray(doc.response_types) && !doc.response_types.includes("code")) {
    refuse("document does not allow response_type code");
  }
  return grants;
}

function clientNameOf(doc: Doc): string | null {
  const name = typeof doc.client_name === "string" ? doc.client_name.trim() : "";
  return name ? name.slice(0, MAX_CLIENT_NAME_LENGTH) : null;
}

function scopesOf(doc: Doc, served: readonly string[]): string[] {
  if (typeof doc.scope !== "string") return [...served];
  const requested = doc.scope.split(/\s+/).filter(Boolean);
  return served.filter((scope) => requested.includes(scope));
}

/**
 * Turn a fetched document into the client it describes, or throw naming the rule
 * it broke. `served` is what this server serves: `scope` in the document may
 * narrow it, never widen it. A missing `client_name` is kept as `null` — whether
 * a nameless client may proceed is the host's eligibility decision.
 */
export function clientFromMetadataDocument(
  clientId: string,
  document: unknown,
  served: readonly string[],
): StoredOAuthClient {
  const doc = asObject(document);
  if (doc.client_id !== clientId) refuse("document client_id does not match its URL");
  checkPublicClient(doc);
  return {
    clientId,
    clientSecretHash: null,
    redirectUris: redirectUrisOf(doc),
    clientName: clientNameOf(doc),
    tokenEndpointAuthMethod: "none",
    grantTypes: grantTypesOf(doc),
    scopes: scopesOf(doc, served),
  };
}
