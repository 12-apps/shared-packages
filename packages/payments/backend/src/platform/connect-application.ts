import type { OAuthAppCredentialsResolver } from '../config/oauth';
import type { PaymentEnvironment } from '../core/types';
import { pagbankApiBase } from '../providers/pagbank-api-base';

/**
 * The platform's PagBank Connect APPLICATION, consulted per environment
 * (FUT-479, packaged by FUT-573).
 *
 * The application every store authorizes against is registered by hand; its
 * id/secret live in the host's secret store, and nothing in the product could
 * say what is actually registered, in which environment, or — the expensive
 * one — with which `redirect_uri`. PagBank re-validates the redirect URI on
 * the token exchange BYTE FOR BYTE, so a registered value that differs from
 * the callback the deployment answers on is a silent OAuth failure. This
 * module asks PagBank (`GET /oauth2/application/{client_id}`, partner
 * account-token bearer) and computes that mismatch, per environment — sandbox
 * and production are SEPARATE applications with separate id/secret pairs,
 * which is why credentials resolve through the same per-environment
 * {@link OAuthAppCredentialsResolver} the OAuth connect service takes.
 *
 * READ-ONLY on purpose. `POST /oauth2/application` exists, but consult +
 * mismatch delivers the diagnostic value with none of the risk of minting an
 * application by accident; creation stays a deliberate manual act.
 *
 * The consult response schema is NOT published — PagBank's reference documents
 * the request and stops. Parsing is therefore defensive: the handful of fields
 * creation accepts are picked out when they look right, everything else is
 * carried in `extra` so the operator still sees whatever PagBank said, and any
 * key that smells like a credential is dropped before the payload leaves the
 * server. Server-only.
 */

/** How long a consult may hang before the whole screen answers without it. */
const CONSULT_TIMEOUT_MS = 10_000;

/** Keys that must never travel to the browser, whatever the schema turns out to be. */
const SECRET_KEY_RE = /secret|token|password|credential/i;

/** The one provider with this consult surface today. */
const PROVIDER = 'pagbank';

/** What PagBank reports about a registered application — parsed defensively. */
export interface RegisteredConnectApplication {
  name: string | null;
  description: string | null;
  site: string | null;
  /** The registered callback — the value the mismatch flag is computed from. */
  redirectUri: string | null;
  logo: string | null;
  /** Every other key the undocumented response carried, secret-looking ones removed. */
  extra: Record<string, unknown>;
}

/** One environment's application, as the deployment can see it. */
export interface ConnectApplicationStatus {
  environment: PaymentEnvironment;
  /** Whether the deployment holds an application id/secret pair for the environment. */
  configured: boolean;
  /** The `client_id` the environment names (not a secret; identifies the application). */
  clientId: string | null;
  application: RegisteredConnectApplication | null;
  /**
   * `true` when the registered `redirect_uri` differs (byte-for-byte — that is
   * how PagBank compares it on the token exchange) from the deployment's
   * callback; `null` while unknown (unconfigured, consult failed, or the
   * response carried no recognizable redirect URI).
   */
  redirectUriMismatch: boolean | null;
  /** pt-BR reason the consult could not answer, for the operator. */
  error: string | null;
}

/** The whole screen's payload: both environments plus the expected callback. */
export interface ConnectApplicationReport {
  provider: typeof PROVIDER;
  /** The callback THIS deployment actually uses — what must be registered. */
  expectedRedirectUri: string;
  environments: ConnectApplicationStatus[];
}

/** Everything the consult needs from the host — credentials arrive per call. */
export interface ConsultConnectApplicationsDeps {
  /**
   * The platform's application credentials, per environment — the SAME
   * resolver `createOAuthConnectService` takes, so the screen reports on
   * exactly the application the connect flow would use. `null` for an
   * environment means "not configured here", and that environment is
   * reported as such without a network call.
   */
  appCredentials: OAuthAppCredentialsResolver;
  /** The OAuth callback this deployment answers on — what must be registered. */
  expectedRedirectUri: string;
  /** Override the consult origin per environment. Defaults to PagBank's hosts. */
  apiBaseFor?: (environment: PaymentEnvironment) => string;
  /**
   * The four sentences this consult can put in front of the platform's own
   * operator (FUT-760).
   *
   * REQUIRED, and that is the change: `missingAccountTokenMessage` used to be
   * OPTIONAL with a pt-BR default, which is the precise anti-pattern the copy
   * gate exists to end — a host that says nothing ships another product's
   * Portuguese and nothing fails. Naming a configuration surface is also the
   * one thing only the host can do: "informe o campo accountToken" is right
   * for a deployment that stores credentials in a database and wrong for one
   * that sets env vars.
   */
  copy: ConnectApplicationCopy;
}

/** Every sentence {@link consultConnectApplications} can produce. */
export interface ConnectApplicationCopy {
  /**
   * No account token for this environment, so the consult never left the
   * process — and the sentence has to say where to put one, which is a fact
   * about the host's configuration surface, not about PagBank.
   */
  missingAccountToken: string;
  /** PagBank answered, with a status we did not expect and its own body. */
  consultFailed(status: number, detail: string): string;
  /** PagBank answered 2xx with something that is not an object. */
  unexpectedShape: string;
  /** The consult never reached PagBank at all. */
  unreachable: string;
}

/** First string under any of `keys`, or null — the undocumented-schema picker. */
function pickString(body: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

/** The alternate spellings each known creation field might come back under. */
const FIELD_KEYS = {
  name: ['name'],
  description: ['description'],
  site: ['site'],
  redirectUri: ['redirect_uri', 'redirectUri', 'redirect_url'],
  logo: ['logo', 'logo_url'],
} as const;

/** Map the undocumented consult body onto the fields creation accepts. */
function parseApplication(body: Record<string, unknown>): RegisteredConnectApplication {
  const known = new Set<string>(Object.values(FIELD_KEYS).flat());
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (known.has(key) || SECRET_KEY_RE.test(key)) continue;
    extra[key] = value;
  }
  return {
    name: pickString(body, FIELD_KEYS.name),
    description: pickString(body, FIELD_KEYS.description),
    site: pickString(body, FIELD_KEYS.site),
    redirectUri: pickString(body, FIELD_KEYS.redirectUri),
    logo: pickString(body, FIELD_KEYS.logo),
    extra,
  };
}

/** A non-2xx consult, summarized for the operator without echoing the whole body. */
async function consultFailure(res: Response, copy: ConnectApplicationCopy): Promise<string> {
  const body = await res.text().catch(() => '');
  // The body is PagBank's own, truncated but never reworded — it is the part
  // an operator forwards to support. Only the frame around it is the host's.
  return copy.consultFailed(res.status, body.trim() === '' ? '' : body.slice(0, 300));
}

/** An unanswerable environment, in the one shape the report carries. */
function unanswered(
  environment: PaymentEnvironment,
  configured: boolean,
  clientId: string | null,
  error: string | null,
): ConnectApplicationStatus {
  return {
    environment,
    configured,
    clientId,
    application: null,
    redirectUriMismatch: null,
    error,
  };
}

/** The consult call itself: one environment, one application, or one reason. */
async function fetchApplication(
  apiBase: string,
  clientId: string | null,
  accountToken: string,
  copy: ConnectApplicationCopy,
): Promise<{ application: RegisteredConnectApplication } | { error: string }> {
  const res = await fetch(`${apiBase}/oauth2/application/${encodeURIComponent(clientId ?? '')}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accountToken}` },
    signal: AbortSignal.timeout(CONSULT_TIMEOUT_MS),
  });
  if (!res.ok) return { error: await consultFailure(res, copy) };
  const body: unknown = await res.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: copy.unexpectedShape };
  }
  return { application: parseApplication(body as Record<string, unknown>) };
}

/**
 * Byte-for-byte, like PagBank's own re-validation on the token exchange.
 * Unknown (null) when the response named no redirect URI at all — the schema is
 * undocumented, so absence must not read as "matches".
 */
function mismatchOf(
  application: RegisteredConnectApplication,
  expectedRedirectUri: string,
): boolean | null {
  if (application.redirectUri === null) return null;
  return application.redirectUri !== expectedRedirectUri;
}

/**
 * Consult ONE environment's application. Never throws: an environment that
 * cannot answer (unconfigured, missing account token, network failure, non-2xx)
 * comes back with `error`/`application: null` so the other environment still
 * renders — the screen exists precisely for the moments something is broken.
 */
async function consultEnvironment(
  deps: ConsultConnectApplicationsDeps,
  environment: PaymentEnvironment,
): Promise<ConnectApplicationStatus> {
  const credentials = deps.appCredentials(PROVIDER, environment);
  if (!credentials) return unanswered(environment, false, null, null);

  const clientId = credentials.fields.clientId ?? null;
  // Same auth as every Connect call: the PARTNER's account token in a Bearer
  // header. Without it PagBank answers 401 invalid_token whatever else is
  // sent, so fail with the cause named instead of relaying that riddle.
  const accountToken = credentials.fields.accountToken;
  if (!accountToken) {
    return unanswered(environment, true, clientId, deps.copy.missingAccountToken);
  }

  // Still overridable per call for tests and proxies; the default is now the
  // package's single spelling of PagBank's hosts rather than a fourth copy.
  const apiBase = deps.apiBaseFor?.(environment) ?? pagbankApiBase(environment);
  try {
    const result = await fetchApplication(apiBase, clientId, accountToken, deps.copy);
    if ('error' in result) return unanswered(environment, true, clientId, result.error);
    return {
      environment,
      configured: true,
      clientId,
      application: result.application,
      redirectUriMismatch: mismatchOf(result.application, deps.expectedRedirectUri),
      error: null,
    };
  } catch {
    return unanswered(environment, true, clientId, deps.copy.unreachable);
  }
}

/**
 * Both environments' applications plus the callback the deployment answers on.
 * The two consults run in parallel; each fails independently.
 */
export async function consultConnectApplications(
  deps: ConsultConnectApplicationsDeps,
): Promise<ConnectApplicationReport> {
  const environments = await Promise.all(
    (['SANDBOX', 'PRODUCTION'] as const).map((environment) =>
      consultEnvironment(deps, environment),
    ),
  );
  return { provider: PROVIDER, expectedRedirectUri: deps.expectedRedirectUri, environments };
}
