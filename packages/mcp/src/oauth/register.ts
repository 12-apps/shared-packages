import { registerClient, type RegisterClientInput } from "./clients";
import type { McpOauthContext } from "./context";
import type { TokenEndpointAuthMethod } from "./stores";

/**
 * RFC 7591 Dynamic Client Registration (12-23, ported from the origin host's
 * `app/api/oauth/register/route.ts`).
 *
 * An external host (a Claude.ai / ChatGPT connector) self-registers by POSTing RFC
 * 7591 client metadata as JSON; on success a public `client_id` (and, for a
 * confidential client, a one-time `client_secret`) is returned so the host can run
 * the Authorization Code + PKCE flow.
 *
 * Security, unchanged:
 *   - **The gate answers 403 here, not 404.** Open DCR is an operator opt-in, and
 *     RFC 7591 registration explicitly refuses with `access_denied` so a probing
 *     host learns the endpoint exists but registration is closed — the documented
 *     static-client path is used instead.
 *   - **No privilege escalation via metadata:** registration can only set
 *     `redirect_uris`, an auth method the token endpoint actually supports, the
 *     supported grant types, and a scope SUBSET of the AS's advertised scopes. Any
 *     attempt to widen is rejected, never silently coerced. Identity is never
 *     client-supplied.
 *   - **Secret hygiene:** a confidential client's secret is generated server-side,
 *     returned once, and stored only as a SHA-256 hash.
 */

/** RFC 7591 §3.2.2 registration error codes this endpoint can emit. */
type RegistrationErrorCode = "invalid_redirect_uri" | "invalid_client_metadata";

/** The RFC 7591 §3.2.1 client-information success response. */
interface RegistrationSuccessResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  token_endpoint_auth_method: TokenEndpointAuthMethod;
  redirect_uris: string[];
  grant_types: string[];
  scope: string;
  client_name?: string;
}

/** Auth methods the token endpoint can actually enforce (RFC 7591 §2). */
const SUPPORTED_AUTH_METHODS: readonly TokenEndpointAuthMethod[] = [
  "none",
  "client_secret_basic",
];

/** Grant types the AS supports (mirrors the AS discovery metadata). */
const SUPPORTED_GRANT_TYPES: readonly string[] = ["authorization_code", "refresh_token"];

const DEFAULT_GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
const DEFAULT_AUTH_METHOD: TokenEndpointAuthMethod = "none";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

/** A JSON error response in the RFC 7591 §3.2.2 shape. */
function registrationError(
  error: RegistrationErrorCode,
  status: number,
  description?: string,
): Response {
  const body: { error: RegistrationErrorCode; error_description?: string } = { error };
  if (description) body.error_description = description;
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS } });
}

/** Whether a value is a syntactically valid absolute URI (scheme + authority). */
function isAbsoluteUri(value: string): boolean {
  try {
    const url = new URL(value);
    // An absolute redirect target must carry a scheme AND an authority — reject
    // opaque/relative forms so an intercepted request can never be re-steered.
    return Boolean(url.protocol) && Boolean(url.host);
  } catch {
    return false;
  }
}

/** The RFC 7591 client-metadata fields this endpoint reads. */
interface ClientMetadata {
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
  grant_types?: unknown;
  scope?: unknown;
  client_name?: unknown;
}

/** A validated registration input, or a typed rejection to return verbatim. */
type ValidationResult =
  | { ok: true; input: RegisterClientInput }
  | { ok: false; response: Response };

/** A per-field validator result: the accepted value, or a rejection response. */
type FieldResult<T> = { ok: true; value: T } | { ok: false; response: Response };

function accept<T>(value: T): FieldResult<T> {
  return { ok: true, value };
}

function reject<T>(response: Response): FieldResult<T> {
  return { ok: false, response };
}

/**
 * `redirect_uris` — REQUIRED, a non-empty array whose every entry is an absolute
 * URI. Any failure maps to `invalid_redirect_uri` (RFC 7591 §3.2.2).
 */
function validateRedirectUris(raw: unknown): FieldResult<string[]> {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    !raw.every((uri): uri is string => typeof uri === "string" && isAbsoluteUri(uri))
  ) {
    return reject(
      registrationError(
        "invalid_redirect_uri",
        400,
        "redirect_uris must be a non-empty array of absolute URIs",
      ),
    );
  }
  return accept([...raw]);
}

/** `token_endpoint_auth_method` — optional; defaults to `none`. */
function validateAuthMethod(raw: unknown): FieldResult<TokenEndpointAuthMethod> {
  if (raw === undefined || raw === null) return accept(DEFAULT_AUTH_METHOD);
  if (
    typeof raw !== "string" ||
    !SUPPORTED_AUTH_METHODS.includes(raw as TokenEndpointAuthMethod)
  ) {
    return reject(
      registrationError(
        "invalid_client_metadata",
        400,
        `unsupported token_endpoint_auth_method (supported: ${SUPPORTED_AUTH_METHODS.join(", ")})`,
      ),
    );
  }
  return accept(raw as TokenEndpointAuthMethod);
}

/** `grant_types` — optional; defaults to code+refresh. */
function validateGrantTypes(raw: unknown): FieldResult<string[]> {
  if (raw === undefined || raw === null) return accept([...DEFAULT_GRANT_TYPES]);
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    !raw.every(
      (grant): grant is string =>
        typeof grant === "string" && SUPPORTED_GRANT_TYPES.includes(grant),
    )
  ) {
    return reject(
      registrationError(
        "invalid_client_metadata",
        400,
        `unsupported grant_types (supported: ${SUPPORTED_GRANT_TYPES.join(", ")})`,
      ),
    );
  }
  return accept([...raw]);
}

/**
 * `scope` — optional space-delimited string; every requested scope must be in the
 * AS's supported set. An explicit empty request falls back to the full set.
 */
function validateScopes(raw: unknown, supportedScopes: readonly string[]): FieldResult<string[]> {
  if (raw === undefined || raw === null) return accept([...supportedScopes]);
  if (typeof raw !== "string") {
    return reject(
      registrationError("invalid_client_metadata", 400, "scope must be a space-delimited string"),
    );
  }
  const requested = raw.split(/\s+/).filter(Boolean);
  const supported = new Set<string>(supportedScopes);
  if (!requested.every((scope) => supported.has(scope))) {
    return reject(
      registrationError(
        "invalid_client_metadata",
        400,
        `scope must be a subset of: ${supportedScopes.join(" ")}`,
      ),
    );
  }
  return accept(requested.length > 0 ? requested : [...supportedScopes]);
}

/**
 * Validate RFC 7591 client metadata strictly, by composing the per-field
 * validators. `redirect_uris` failures map to `invalid_redirect_uri`; every other
 * unsupported-metadata failure maps to `invalid_client_metadata`.
 */
function validateMetadata(
  metadata: ClientMetadata,
  supportedScopes: readonly string[],
): ValidationResult {
  const redirectUris = validateRedirectUris(metadata.redirect_uris);
  if (!redirectUris.ok) return redirectUris;

  const authMethod = validateAuthMethod(metadata.token_endpoint_auth_method);
  if (!authMethod.ok) return authMethod;

  const grantTypes = validateGrantTypes(metadata.grant_types);
  if (!grantTypes.ok) return grantTypes;

  const scopes = validateScopes(metadata.scope, supportedScopes);
  if (!scopes.ok) return scopes;

  const clientNameRaw = metadata.client_name;
  const clientName = typeof clientNameRaw === "string" ? clientNameRaw : null;

  return {
    ok: true,
    input: {
      redirectUris: redirectUris.value,
      clientName,
      tokenEndpointAuthMethod: authMethod.value,
      grantTypes: grantTypes.value,
      scopes: scopes.value,
    },
  };
}

/** The refusal a closed registration endpoint answers with. */
export function registrationDisabled(): Response {
  return new Response(
    JSON.stringify({
      error: "access_denied",
      error_description: "dynamic client registration is disabled",
    }),
    { status: 403, headers: { ...JSON_HEADERS } },
  );
}

/** `POST <register>` — the whole endpoint. */
export async function registerEndpoint(
  context: McpOauthContext,
  request: Request,
): Promise<Response> {
  // Parse the JSON body. A malformed body is unusable metadata → 400.
  let metadata: ClientMetadata;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return registrationError(
        "invalid_client_metadata",
        400,
        "request body must be a JSON object",
      );
    }
    metadata = parsed as ClientMetadata;
  } catch {
    return registrationError("invalid_client_metadata", 400, "request body must be valid JSON");
  }

  const validated = validateMetadata(metadata, context.scopes);
  if (!validated.ok) return validated.response;

  const registered = await registerClient(context.stores.clients, validated.input);

  const responseBody: RegistrationSuccessResponse = {
    client_id: registered.clientId,
    ...(registered.clientSecret ? { client_secret: registered.clientSecret } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: registered.tokenEndpointAuthMethod,
    redirect_uris: registered.redirectUris,
    grant_types: registered.grantTypes,
    scope: registered.scopes.join(" "),
    ...(registered.clientName ? { client_name: registered.clientName } : {}),
  };

  return new Response(JSON.stringify(responseBody), {
    status: 201,
    headers: { ...JSON_HEADERS },
  });
}
